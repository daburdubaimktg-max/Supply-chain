// Business actions: everything that changes data goes through here so that
// permissions, validation, scheduling, audit trail and history are
// applied consistently. The UI never writes to the store directly.

import {
  COLLECTIONS, TASK_STATUS, APPROVAL_STATUS, PROJECT_STATUS,
  makeTask, makeDependency, makeProject, makeActivity, makeStakeholder, newId, nowIso,
} from './models.js';
import { ACTIONS } from './auth.js';
import { validateDependencies } from './dependencies.js';
import { computeSchedule, scheduleImpact } from './scheduler.js';
import { blockingPredecessors } from './performance.js';
import { today as todayStr } from './calendar.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Actions {
  constructor(store, auth) {
    this.store = store;
    this.auth = auth;
  }

  // ---- helpers ---------------------------------------------------------------
  user() { return this.auth.user; }
  project(id) { const p = this.store.get(COLLECTIONS.projects, id); if (!p) throw new Error('Project not found'); return p; }
  task(id) { const t = this.store.get(COLLECTIONS.projectTasks, id); if (!t) throw new Error('Task not found'); return t; }
  projectTasks(projectId) { return this.store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId); }
  projectDeps(projectId) { return this.store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === projectId); }
  masterActivities() { return this.store.all(COLLECTIONS.activityMaster); }
  masterDeps() { return this.store.all(COLLECTIONS.masterDependencies); }
  nextProjectCode() {
    const n = this.store.all(COLLECTIONS.projects).length + 1;
    return `NPD-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`;
  }

  async history(taskId, event, details = {}) {
    return this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: this.task(taskId).projectId, event, ...details });
  }

  // ---- Projects --------------------------------------------------------------
  // opts: { activityIds: [...master ids] (default: all active), fprOverrides: {activityId: fprId},
  //         durationOverrides: {activityId: n}, templateId }
  async createProject(data, opts = {}) {
    this.auth.assert(ACTIONS.CREATE_PROJECT);
    if (!data.name || !data.brand) throw new Error('Project name and brand are required.');
    const project = makeProject({
      ...data,
      projectCode: data.projectCode || this.nextProjectCode(),
      anchorDate: data.anchorDate || todayStr(),
      ownerId: data.ownerId || this.user()?.id || null,
      status: PROJECT_STATUS.PLANNING,
    }, this.user());

    let source;
    if (opts.templateId) {
      const tpl = this.store.get(COLLECTIONS.templates, opts.templateId);
      if (!tpl) throw new Error('Template not found');
      source = { activities: tpl.tasks, deps: tpl.dependencies, fromTemplate: true };
    } else {
      const acts = this.masterActivities().filter((a) => a.isActive !== false && (!opts.activityIds || opts.activityIds.includes(a.id)));
      source = { activities: acts, deps: this.masterDeps(), fromTemplate: false };
    }

    await this.store.batch(async () => {
      await this.store.insert(COLLECTIONS.projects, project, { auditSummary: `Created project ${project.projectCode} – ${project.name}` });
      const idMap = new Map(); // source id -> new task id
      for (const a of source.activities) {
        const srcId = source.fromTemplate ? a.templateTaskId : a.id;
        const t = makeTask({
          projectId: project.id,
          activityId: source.fromTemplate ? a.activityId : a.id,
          activityNo: a.activityNo,
          sequence: a.sequence ?? a.activityNo,
          name: a.name,
          department: a.department,
          fprId: opts.fprOverrides?.[srcId] ?? (source.fromTemplate ? a.fprId : a.defaultFprId),
          backupFprId: source.fromTemplate ? a.backupFprId : (this.store.get(COLLECTIONS.stakeholders, a.defaultFprId)?.backupFprId || null),
          approverId: source.fromTemplate ? a.approverId : (this.store.get(COLLECTIONS.stakeholders, a.defaultFprId)?.managerId || null),
          expectedDuration: opts.durationOverrides?.[srcId] ?? a.expectedDuration,
          isMandatory: opts.mandatoryOverrides?.[srcId] ?? a.isMandatory,
          approvalRequired: opts.approvalOverrides?.[srcId] ?? a.approvalRequired,
          description: a.description, instructions: a.instructions,
        }, this.user());
        idMap.set(srcId, t.id);
        await this.store.insert(COLLECTIONS.projectTasks, t, { audit: false });
      }
      for (const d of source.deps) {
        const sid = source.fromTemplate ? d.templateTaskId : d.taskId;
        const pid = source.fromTemplate ? d.templatePredecessorId : d.predecessorId;
        if (!idMap.has(sid) || !idMap.has(pid)) continue; // predecessor not selected => dependency dropped
        await this.store.insert(COLLECTIONS.taskDependencies, makeDependency({
          projectId: project.id, taskId: idMap.get(sid), predecessorId: idMap.get(pid), type: d.type, lagDays: d.lagDays,
        }, this.user()), { audit: false });
      }
      await this.store.append(COLLECTIONS.auditLog, {
        collection: COLLECTIONS.projectTasks, recordId: project.id, projectId: project.id, action: 'GENERATE',
        summary: `Generated ${idMap.size} tasks from ${source.fromTemplate ? 'template' : 'activity master'}`, changes: [],
      });
      await this.recalculate(project.id, { persistBaseline: true, reason: 'Initial schedule' });
    });
    return this.project(project.id);
  }

  async updateProject(projectId, changes, { expectedVersion, reason } = {}) {
    this.auth.assert(ACTIONS.EDIT_PROJECT);
    const before = this.project(projectId);
    const protectedFields = ['actualStartDate', 'actualEndDate', 'actualStartBy', 'actualEndBy', 'closureHistory'];
    for (const f of protectedFields) {
      if (f in changes && changes[f] !== before[f]) {
        if (!this.auth.isAdmin() || !reason) throw new Error(`Changing ${f} requires administrator rights and a reason (audited correction).`);
      }
    }
    const after = await this.store.update(COLLECTIONS.projects, projectId, changes, { expectedVersion, reason, auditSummary: `Updated project ${before.projectCode}` });
    if (['anchorDate', 'launchDate', 'schedulingMode'].some((f) => f in changes && changes[f] !== before[f])) {
      await this.recalculate(projectId, { reason: 'Project dates changed' });
    }
    return after;
  }

  async deleteProject(projectId) {
    this.auth.assert(ACTIONS.CREATE_PROJECT);
    const p = this.project(projectId);
    await this.store.batch(async () => {
      for (const t of this.projectTasks(projectId)) await this.store.remove(COLLECTIONS.projectTasks, t.id, { audit: false });
      for (const d of this.projectDeps(projectId)) await this.store.remove(COLLECTIONS.taskDependencies, d.id, { audit: false });
      await this.store.remove(COLLECTIONS.projects, projectId, { auditSummary: `Deleted project ${p.projectCode} and its tasks` });
    });
  }

  // Recompute planned/forecast dates for a project; never touches actual dates.
  async recalculate(projectId, { persistBaseline = false, reason = 'Recalculate', skipAudit = false } = {}) {
    const project = this.project(projectId);
    const tasks = this.projectTasks(projectId);
    const deps = this.projectDeps(projectId);
    const cal = this.store.calendar();
    const before = this._snapshot(tasks);
    const result = computeSchedule(project, tasks, deps, cal);
    await this.store.batch(async () => {
      for (const t of tasks) {
        const s = result.schedule.get(t.id);
        if (!s) {
          if (t.plannedStart !== null && t.status === TASK_STATUS.NOT_REQUIRED) continue;
          continue;
        }
        const changes = {};
        for (const k of ['plannedStart', 'plannedEnd', 'forecastStart', 'forecastEnd', 'isCritical']) if (t[k] !== s[k]) changes[k] = s[k];
        if (Object.keys(changes).length) await this.store.update(COLLECTIONS.projectTasks, t.id, changes, { audit: false });
      }
      const pc = {};
      if (project.plannedEndDate !== result.projectPlannedEnd) pc.plannedEndDate = result.projectPlannedEnd;
      if (project.forecastEndDate !== result.projectForecastEnd) pc.forecastEndDate = result.projectForecastEnd;
      if (Object.keys(pc).length) await this.store.update(COLLECTIONS.projects, projectId, pc, { audit: false });
      const impact = scheduleImpact(before, result, new Map(tasks.map((t) => [t.id, t])), cal);
      if (!skipAudit && (impact.changes.length || persistBaseline)) {
        await this.store.append(COLLECTIONS.auditLog, {
          collection: 'schedule', recordId: projectId, projectId, action: 'RESCHEDULE',
          summary: `${reason}: ${impact.changes.length} task date(s) changed; project end ${impact.projectEndBefore || '—'} → ${impact.projectEndAfter || '—'}`,
          changes: impact.changes.slice(0, 50).map((c) => ({ field: c.name, from: c.from ? `${c.from.start}→${c.from.end}` : null, to: c.to ? `${c.to.start}→${c.to.end}` : null })),
        });
      }
      if (persistBaseline) {
        await this.store.append(COLLECTIONS.scheduleBaselines, {
          projectId, name: reason, snapshot: Array.from(result.schedule, ([id, s]) => ({ taskId: id, ...s })), projectPlannedEnd: result.projectPlannedEnd,
        });
      }
    });
    return result;
  }

  _snapshot(tasks) {
    const schedule = new Map();
    for (const t of tasks) if (t.plannedStart) schedule.set(t.id, { plannedStart: t.plannedStart, plannedEnd: t.plannedEnd });
    const ends = tasks.map((t) => t.plannedEnd).filter(Boolean).sort();
    return { schedule, projectPlannedEnd: ends[ends.length - 1] || null };
  }

  // Preview the effect of hypothetical task/dependency changes without saving.
  previewImpact(projectId, { taskChanges = {}, depsAdd = [], depsRemove = [], depsUpdate = {} } = {}) {
    const project = this.project(projectId);
    const tasks = this.projectTasks(projectId).map((t) => (taskChanges[t.id] ? { ...t, ...taskChanges[t.id] } : t));
    let deps = this.projectDeps(projectId).filter((d) => !depsRemove.includes(d.id)).map((d) => (depsUpdate[d.id] ? { ...d, ...depsUpdate[d.id] } : d));
    deps = deps.concat(depsAdd.map((d) => ({ id: newId('tmp'), projectId, type: 'FS', lagDays: 0, ...d })));
    const errors = validateDependencies(tasks, deps, null, { projectId });
    if (errors.length) return { errors, impact: null };
    const cal = this.store.calendar();
    const before = this._snapshot(this.projectTasks(projectId));
    const after = computeSchedule(project, tasks, deps, cal);
    return { errors: [], impact: scheduleImpact(before, after, new Map(tasks.map((t) => [t.id, t])), cal), warnings: after.warnings };
  }

  async saveBaseline(projectId, name) {
    this.auth.assert(ACTIONS.EDIT_PROJECT);
    const tasks = this.projectTasks(projectId);
    return this.store.append(COLLECTIONS.scheduleBaselines, {
      projectId, name: name || `Baseline ${nowIso().slice(0, 10)}`,
      snapshot: tasks.map((t) => ({ taskId: t.id, plannedStart: t.plannedStart, plannedEnd: t.plannedEnd })),
      projectPlannedEnd: this.project(projectId).plannedEndDate,
    });
  }

  // ---- Templates -------------------------------------------------------------
  async saveAsTemplate(projectId, name, description = '') {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const tasks = this.projectTasks(projectId).filter((t) => t.isActive !== false);
    const deps = this.projectDeps(projectId);
    const ids = new Set(tasks.map((t) => t.id));
    const tpl = {
      id: newId('tpl'), name, description, sourceProjectId: projectId,
      tasks: tasks.map((t) => ({
        templateTaskId: t.id, activityId: t.activityId, activityNo: t.activityNo, sequence: t.sequence, name: t.name,
        department: t.department, fprId: t.fprId, backupFprId: t.backupFprId, approverId: t.approverId,
        expectedDuration: t.expectedDuration, isMandatory: t.isMandatory, approvalRequired: t.approvalRequired,
        description: t.description, instructions: t.instructions,
      })),
      dependencies: deps.filter((d) => ids.has(d.taskId) && ids.has(d.predecessorId)).map((d) => ({
        templateTaskId: d.taskId, templatePredecessorId: d.predecessorId, type: d.type, lagDays: d.lagDays,
      })),
    };
    return this.store.insert(COLLECTIONS.templates, tpl, { auditSummary: `Saved template "${name}" from project` });
  }

  async deleteTemplate(id) { this.auth.assert(ACTIONS.EDIT_MASTER); return this.store.remove(COLLECTIONS.templates, id, { auditSummary: 'Deleted template' }); }

  // ---- Activity master -------------------------------------------------------
  async addActivity(data) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    if (!data.name) throw new Error('Activity name is required.');
    const existingNos = this.masterActivities().map((a) => Number(a.activityNo));
    const no = data.activityNo ? Number(data.activityNo) : Math.max(0, ...existingNos) + 1;
    if (existingNos.includes(no)) throw new Error(`Activity number ${no} already exists.`);
    const act = makeActivity({ ...data, activityNo: no, sequence: data.sequence ?? no }, this.user());
    return this.store.insert(COLLECTIONS.activityMaster, act, { auditSummary: `Added activity ${no} – ${act.name}` });
  }

  async updateActivity(id, changes, { expectedVersion } = {}) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const before = this.store.get(COLLECTIONS.activityMaster, id);
    if (!before) throw new Error('Activity not found');
    if ('activityNo' in changes && Number(changes.activityNo) !== Number(before.activityNo)) {
      if (this.masterActivities().some((a) => a.id !== id && Number(a.activityNo) === Number(changes.activityNo))) throw new Error('Activity number already in use.');
    }
    // Master changes never touch existing projects (see applyMasterToProjects)
    return this.store.update(COLLECTIONS.activityMaster, id, changes, { expectedVersion, auditSummary: `Edited master activity ${before.activityNo} – ${before.name}` });
  }

  async setActivityActive(id, active) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const a = this.store.get(COLLECTIONS.activityMaster, id);
    return this.store.update(COLLECTIONS.activityMaster, id, { isActive: active }, { auditSummary: `${active ? 'Activated' : 'Deactivated'} master activity ${a.activityNo} – ${a.name}` });
  }

  // Data-integrity rule: an activity used by any project task cannot be deleted – deactivate instead.
  async deleteActivity(id) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const a = this.store.get(COLLECTIONS.activityMaster, id);
    const used = this.store.where(COLLECTIONS.projectTasks, (t) => t.activityId === id).length;
    if (used) throw new Error(`"${a.name}" is used by ${used} project task(s). Deactivate it instead of deleting.`);
    await this.store.batch(async () => {
      for (const d of this.masterDeps().filter((d) => d.taskId === id || d.predecessorId === id)) await this.store.remove(COLLECTIONS.masterDependencies, d.id, { audit: false });
      await this.store.remove(COLLECTIONS.activityMaster, id, { auditSummary: `Deleted master activity ${a.activityNo} – ${a.name}` });
    });
  }

  async addMasterDependency(taskId, predecessorId, type = 'FS', lagDays = 0) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const dep = makeDependency({ projectId: null, taskId, predecessorId, type, lagDays }, this.user());
    const errors = validateDependencies(this.masterActivities(), this.masterDeps(), dep);
    if (errors.length) throw new Error(errors.join(' '));
    return this.store.insert(COLLECTIONS.masterDependencies, dep, { auditSummary: `Master dependency: ${this._actName(taskId)} ← ${this._actName(predecessorId)} (${type}${lagDays ? `+${lagDays}` : ''})` });
  }

  async updateMasterDependency(id, changes) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const before = this.store.get(COLLECTIONS.masterDependencies, id);
    const cand = { ...before, ...changes };
    const errors = validateDependencies(this.masterActivities(), this.masterDeps(), cand);
    if (errors.length) throw new Error(errors.join(' '));
    return this.store.update(COLLECTIONS.masterDependencies, id, changes, { auditSummary: 'Edited master dependency' });
  }

  async removeMasterDependency(id) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const d = this.store.get(COLLECTIONS.masterDependencies, id);
    return this.store.remove(COLLECTIONS.masterDependencies, id, { auditSummary: `Removed master dependency ${this._actName(d.taskId)} ← ${this._actName(d.predecessorId)}` });
  }

  _actName(id) { return this.store.get(COLLECTIONS.activityMaster, id)?.name || id; }

  // Preview what applying the master to an existing project would change.
  previewMasterApply(projectId) {
    const tasks = this.projectTasks(projectId);
    const acts = this.masterActivities().filter((a) => a.isActive !== false);
    const changes = [];
    for (const a of acts) {
      const t = tasks.find((x) => x.activityId === a.id);
      if (!t) { changes.push({ kind: 'ADD', activity: a, detail: `Add "${a.name}" (${a.expectedDuration}d, ${a.department})` }); continue; }
      const diffs = [];
      if (t.name !== a.name) diffs.push(`name "${t.name}" → "${a.name}"`);
      if (t.department !== a.department) diffs.push(`department ${t.department} → ${a.department}`);
      if (Number(t.expectedDuration) !== Number(a.expectedDuration)) diffs.push(`duration ${t.expectedDuration} → ${a.expectedDuration}`);
      if (t.fprId !== a.defaultFprId) diffs.push('default FPR differs');
      if (t.isMandatory !== a.isMandatory) diffs.push(`mandatory ${t.isMandatory} → ${a.isMandatory}`);
      if (t.approvalRequired !== a.approvalRequired) diffs.push(`approval ${t.approvalRequired} → ${a.approvalRequired}`);
      if (diffs.length) changes.push({ kind: 'UPDATE', activity: a, task: t, detail: `${a.name}: ${diffs.join(', ')}` });
    }
    return changes;
  }

  // Apply master changes to a project after explicit confirmation. `fields` chooses what to copy.
  async applyMasterToProject(projectId, { addMissing = true, fields = ['name', 'department', 'expectedDuration', 'isMandatory', 'approvalRequired'], applyFpr = false } = {}) {
    this.auth.assert(ACTIONS.EDIT_MASTER);
    const changes = this.previewMasterApply(projectId);
    await this.store.batch(async () => {
      const tasks = this.projectTasks(projectId);
      for (const c of changes) {
        if (c.kind === 'ADD' && addMissing) {
          const a = c.activity;
          const t = makeTask({
            projectId, activityId: a.id, activityNo: a.activityNo, sequence: a.sequence, name: a.name, department: a.department,
            fprId: a.defaultFprId, expectedDuration: a.expectedDuration, isMandatory: a.isMandatory, approvalRequired: a.approvalRequired,
            description: a.description, instructions: a.instructions,
          }, this.user());
          await this.store.insert(COLLECTIONS.projectTasks, t, { auditSummary: `Added "${a.name}" from master` });
          // bring master deps for this activity where counterpart exists
          const all = this.projectTasks(projectId);
          for (const d of this.masterDeps().filter((d) => d.taskId === a.id || d.predecessorId === a.id)) {
            const succ = d.taskId === a.id ? t : all.find((x) => x.activityId === d.taskId);
            const pred = d.predecessorId === a.id ? t : all.find((x) => x.activityId === d.predecessorId);
            if (succ && pred) await this.store.insert(COLLECTIONS.taskDependencies, makeDependency({ projectId, taskId: succ.id, predecessorId: pred.id, type: d.type, lagDays: d.lagDays }, this.user()), { audit: false });
          }
        } else if (c.kind === 'UPDATE') {
          const upd = {};
          for (const f of fields) if (c.task[f] !== c.activity[f]) upd[f] = c.activity[f];
          if (applyFpr && c.task.fprId !== c.activity.defaultFprId) upd.fprId = c.activity.defaultFprId;
          if (Object.keys(upd).length) await this.store.update(COLLECTIONS.projectTasks, c.task.id, upd, { auditSummary: `Applied master changes to "${c.task.name}"` });
        }
      }
      void tasks;
      await this.recalculate(projectId, { reason: 'Applied master changes' });
    });
    return changes;
  }

  // ---- Project tasks ---------------------------------------------------------
  async addTask(projectId, data) {
    this.auth.assert(ACTIONS.EDIT_TASK);
    this.project(projectId);
    if (!data.name) throw new Error('Task name is required.');
    const nos = this.projectTasks(projectId).map((t) => Number(t.activityNo) || 0);
    const t = makeTask({ ...data, projectId, activityNo: data.activityNo ?? Math.max(0, ...nos) + 1, sequence: data.sequence ?? Math.max(0, ...nos) + 1 }, this.user());
    await this.store.batch(async () => {
      await this.store.insert(COLLECTIONS.projectTasks, t, { auditSummary: `Added task "${t.name}" to project` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId: t.id, projectId, event: 'CREATED', details: `Task created by ${this.user()?.name}` });
      await this.recalculate(projectId, { reason: `Task "${t.name}" added` });
    });
    return this.task(t.id);
  }

  async updateTask(taskId, changes, { expectedVersion, reason, confirmImpact = true } = {}) {
    const before = this.task(taskId);
    this.auth.assert(ACTIONS.EDIT_TASK, { task: before });
    const allowed = this.auth.editableTaskFields();
    const protectedFields = ['actualStart', 'actualEnd', 'actualStartBy', 'actualEndBy', 'status', 'approvalStatus', 'projectId', 'id'];
    for (const f of Object.keys(changes)) {
      if (protectedFields.includes(f)) throw new Error(`Field "${f}" is managed by task actions and cannot be edited directly.`);
      if (allowed && !allowed.has(f)) throw new Error(`Your role may not edit "${f}".`);
    }
    if ('fprId' in changes && changes.fprId !== before.fprId) return this.changeFpr(taskId, changes.fprId, { ...changes, expectedVersion });
    const summaryParts = [];
    for (const [k, v] of Object.entries(changes)) if (before[k] !== v) summaryParts.push(`${k}: ${before[k] ?? '—'} → ${v ?? '—'}`);
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, changes, { expectedVersion, reason, auditSummary: `Edited task "${before.name}" (${summaryParts.join('; ') || 'no change'})` });
      if (summaryParts.length) await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: before.projectId, event: 'EDITED', details: summaryParts.join('; ') });
      if (['expectedDuration', 'manualPlannedStart', 'isActive', 'isMandatory'].some((f) => f in changes)) {
        await this.recalculate(before.projectId, { reason: `Task "${before.name}" edited` });
      }
    });
    return after;
  }

  async changeFpr(taskId, newFprId, extra = {}) {
    const before = this.task(taskId);
    this.auth.assert(ACTIONS.EDIT_FPR, { task: before });
    const { expectedVersion, ...rest } = extra;
    const oldFpr = this.store.get(COLLECTIONS.stakeholders, before.fprId);
    const newFpr = this.store.get(COLLECTIONS.stakeholders, newFprId);
    if (newFprId && !newFpr) throw new Error('Unknown stakeholder');
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, { ...rest, fprId: newFprId }, {
        expectedVersion, auditSummary: `FPR changed on "${before.name}": ${oldFpr?.employeeName || '—'} → ${newFpr?.employeeName || '—'}`,
      });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: before.projectId, event: 'FPR_CHANGED', details: `${oldFpr?.employeeName || '—'} → ${newFpr?.employeeName || '—'}`, from: before.fprId, to: newFprId });
    });
    return after;
  }

  async setTaskActive(taskId, active, reason = '') {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.EDIT_TASK, { task: t });
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, { isActive: active }, { reason, auditSummary: `${active ? 'Activated' : 'Deactivated'} task "${t.name}"` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: active ? 'ACTIVATED' : 'DEACTIVATED', details: reason });
      await this.recalculate(t.projectId, { reason: `Task "${t.name}" ${active ? 'activated' : 'deactivated'}` });
    });
    return after;
  }

  async removeTask(taskId, reason = '') {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.EDIT_TASK, { task: t });
    if (t.actualStart) throw new Error('A task that has been started cannot be removed – mark it Not Required or deactivate it instead.');
    await this.store.batch(async () => {
      for (const d of this.projectDeps(t.projectId).filter((d) => d.taskId === taskId || d.predecessorId === taskId)) await this.store.remove(COLLECTIONS.taskDependencies, d.id, { audit: false });
      await this.store.remove(COLLECTIONS.projectTasks, taskId, { reason, auditSummary: `Removed task "${t.name}" from project` });
      await this.recalculate(t.projectId, { reason: `Task "${t.name}" removed` });
    });
  }

  // NOT REQUIRED: the task is skipped for this project. Dependents treat it as satisfied.
  async markNotRequired(taskId, reason) {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.MARK_NOT_REQUIRED, { task: t });
    if (!reason) throw new Error('A reason is required to mark a task Not Required.');
    if (t.status === TASK_STATUS.COMPLETED) throw new Error('Completed tasks cannot be marked Not Required – reopen first.');
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, { status: TASK_STATUS.NOT_REQUIRED, previousStatus: t.status, notRequiredReason: reason }, { reason, auditSummary: `Marked "${t.name}" NOT REQUIRED` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: 'NOT_REQUIRED', details: reason, from: t.status, to: TASK_STATUS.NOT_REQUIRED });
      await this.recalculate(t.projectId, { reason: `"${t.name}" marked Not Required` });
      await this._checkProjectClosure(t.projectId);
    });
    return after;
  }

  async restoreRequired(taskId, reason = '') {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.MARK_NOT_REQUIRED, { task: t });
    if (t.status !== TASK_STATUS.NOT_REQUIRED) return t;
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, { status: t.previousStatus || TASK_STATUS.NOT_STARTED, notRequiredReason: null }, { reason, auditSummary: `Restored "${t.name}" as required` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: 'RESTORED', details: reason, from: TASK_STATUS.NOT_REQUIRED, to: t.previousStatus || TASK_STATUS.NOT_STARTED });
      await this.recalculate(t.projectId, { reason: `"${t.name}" restored` });
      await this._reopenProjectIfClosed(t.projectId, `Task "${t.name}" restored as required`);
    });
    return after;
  }

  // ---- Dependencies (project) ------------------------------------------------
  async addDependency(projectId, taskId, predecessorId, type = 'FS', lagDays = 0) {
    this.auth.assert(ACTIONS.EDIT_DEPENDENCIES);
    const dep = makeDependency({ projectId, taskId, predecessorId, type, lagDays: Number(lagDays) }, this.user());
    const tasks = this.projectTasks(projectId);
    for (const id of [taskId, predecessorId]) {
      const other = this.store.get(COLLECTIONS.projectTasks, id);
      if (other && other.projectId !== projectId) throw new Error(`"${other.name}" belongs to another project (cross-project references are not allowed).`);
    }
    const errors = validateDependencies(tasks, this.projectDeps(projectId), dep, { projectId });
    if (errors.length) throw new Error(errors.join(' '));
    const name = (id) => tasks.find((t) => t.id === id)?.name || id;
    let rec;
    await this.store.batch(async () => {
      rec = await this.store.insert(COLLECTIONS.taskDependencies, dep, { auditSummary: `Added predecessor: "${name(taskId)}" ← "${name(predecessorId)}" (${type}, lag ${lagDays})` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId, event: 'PREDECESSOR_ADDED', details: `${name(predecessorId)} (${type}, lag ${lagDays})` });
      await this.recalculate(projectId, { reason: `Dependency added to "${name(taskId)}"` });
    });
    return rec;
  }

  async updateDependency(id, changes) {
    this.auth.assert(ACTIONS.EDIT_DEPENDENCIES);
    const before = this.store.get(COLLECTIONS.taskDependencies, id);
    if (!before) throw new Error('Dependency not found');
    const cand = { ...before, ...changes, lagDays: Number(changes.lagDays ?? before.lagDays) };
    const tasks = this.projectTasks(before.projectId);
    const errors = validateDependencies(tasks, this.projectDeps(before.projectId), cand, { projectId: before.projectId });
    if (errors.length) throw new Error(errors.join(' '));
    const name = (x) => tasks.find((t) => t.id === x)?.name || x;
    let rec;
    await this.store.batch(async () => {
      rec = await this.store.update(COLLECTIONS.taskDependencies, id, cand, { auditSummary: `Edited predecessor of "${name(before.taskId)}": ${name(before.predecessorId)} ${before.type}+${before.lagDays} → ${name(cand.predecessorId)} ${cand.type}+${cand.lagDays}` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId: before.taskId, projectId: before.projectId, event: 'PREDECESSOR_CHANGED', details: `${name(before.predecessorId)} ${before.type}+${before.lagDays} → ${name(cand.predecessorId)} ${cand.type}+${cand.lagDays}` });
      await this.recalculate(before.projectId, { reason: `Dependency changed on "${name(before.taskId)}"` });
    });
    return rec;
  }

  async removeDependency(id) {
    this.auth.assert(ACTIONS.EDIT_DEPENDENCIES);
    const d = this.store.get(COLLECTIONS.taskDependencies, id);
    if (!d) return;
    const tasks = this.projectTasks(d.projectId);
    const name = (x) => tasks.find((t) => t.id === x)?.name || x;
    await this.store.batch(async () => {
      await this.store.remove(COLLECTIONS.taskDependencies, id, { auditSummary: `Removed predecessor: "${name(d.taskId)}" ← "${name(d.predecessorId)}"` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId: d.taskId, projectId: d.projectId, event: 'PREDECESSOR_REMOVED', details: name(d.predecessorId) });
      await this.recalculate(d.projectId, { reason: `Dependency removed from "${name(d.taskId)}"` });
    });
  }

  // ---- Task lifecycle --------------------------------------------------------
  eligibility(task) {
    const tasks = this.projectTasks(task.projectId);
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const blocking = blockingPredecessors(task, tasksById, this.projectDeps(task.projectId));
    return { blocked: blocking.length > 0, blocking };
  }

  async startTask(taskId) {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.START_TASK, { task: t });
    if (t.isActive === false) throw new Error('Task is inactive.');
    if (t.status === TASK_STATUS.NOT_REQUIRED) throw new Error('Task is marked Not Required.');
    if (![TASK_STATUS.NOT_STARTED, TASK_STATUS.BLOCKED, TASK_STATUS.ON_HOLD].includes(t.status)) throw new Error(`Task cannot be started from status ${t.status}.`);
    const { blocked, blocking } = this.eligibility(t);
    if (blocked) {
      throw new Error(`Task is blocked by: ${blocking.map((b) => b.name).join(', ')}`);
    }
    const ts = nowIso();
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, {
        status: TASK_STATUS.IN_PROGRESS, actualStart: ts.slice(0, 10), actualStartTime: ts, actualStartBy: this.user().name,
      }, { auditSummary: `STARTED "${t.name}"` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: 'STARTED', details: `Started by ${this.user().name}`, from: t.status, to: TASK_STATUS.IN_PROGRESS });
      await this._captureProjectStart(t.projectId, ts);
      await this.recalculate(t.projectId, { reason: `"${t.name}" started`, skipAudit: true });
    });
    return after;
  }

  async submitForApproval(taskId, note = '') {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.SUBMIT_TASK, { task: t });
    if (!t.approvalRequired) return this.completeTask(taskId, note);
    if (t.status !== TASK_STATUS.IN_PROGRESS) throw new Error('Only in-progress tasks can be submitted for approval.');
    const ts = nowIso();
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, {
        status: TASK_STATUS.PENDING_APPROVAL, approvalStatus: APPROVAL_STATUS.PENDING, submittedAt: ts, submittedBy: this.user().name, rejectionReason: null,
      }, { auditSummary: `SUBMITTED "${t.name}" for approval` });
      await this.store.append(COLLECTIONS.approvalHistory, { taskId, projectId: t.projectId, action: 'SUBMITTED', by: this.user().name, note });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: 'SUBMITTED', details: note, from: t.status, to: TASK_STATUS.PENDING_APPROVAL });
    });
    return after;
  }

  async approveTask(taskId, note = '') {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.APPROVE_TASK, { task: t });
    if (t.status !== TASK_STATUS.PENDING_APPROVAL) throw new Error('Task is not pending approval.');
    await this.store.append(COLLECTIONS.approvalHistory, { taskId, projectId: t.projectId, action: 'APPROVED', by: this.user().name, note });
    return this._complete(t, { approvalStatus: APPROVAL_STATUS.APPROVED }, note);
  }

  async rejectTask(taskId, reason) {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.APPROVE_TASK, { task: t });
    if (t.status !== TASK_STATUS.PENDING_APPROVAL) throw new Error('Task is not pending approval.');
    if (!reason) throw new Error('A rejection reason is required.');
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, { status: TASK_STATUS.IN_PROGRESS, approvalStatus: APPROVAL_STATUS.REJECTED, rejectionReason: reason }, { reason, auditSummary: `REJECTED "${t.name}": ${reason}` });
      await this.store.append(COLLECTIONS.approvalHistory, { taskId, projectId: t.projectId, action: 'REJECTED', by: this.user().name, note: reason });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: 'REJECTED', details: reason, from: TASK_STATUS.PENDING_APPROVAL, to: TASK_STATUS.IN_PROGRESS });
    });
    return after;
  }

  async completeTask(taskId, note = '') {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.COMPLETE_TASK, { task: t });
    if (t.status !== TASK_STATUS.IN_PROGRESS && t.status !== TASK_STATUS.PENDING_APPROVAL) throw new Error('Only in-progress tasks can be completed. Start the task first.');
    if (t.approvalRequired && t.approvalStatus !== APPROVAL_STATUS.APPROVED) {
      if (t.status === TASK_STATUS.PENDING_APPROVAL) throw new Error('Task is awaiting approval – the approver must approve it.');
      if (!this.auth.can(ACTIONS.APPROVE_TASK, { task: t })) throw new Error('This task requires approval – submit it for approval.');
      // approver completing directly counts as approval
      await this.store.append(COLLECTIONS.approvalHistory, { taskId, projectId: t.projectId, action: 'APPROVED', by: this.user().name, note: note || 'Approved on completion' });
      return this._complete(t, { approvalStatus: APPROVAL_STATUS.APPROVED }, note);
    }
    if (t.status !== TASK_STATUS.IN_PROGRESS && t.status !== TASK_STATUS.PENDING_APPROVAL) throw new Error('Only in-progress tasks can be completed. Start the task first.');
    return this._complete(t, {}, note);
  }

  async _complete(t, extra, note) {
    const ts = nowIso();
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, t.id, {
        status: TASK_STATUS.COMPLETED, actualEnd: ts.slice(0, 10), actualEndTime: ts, actualEndBy: this.user().name, actualStart: t.actualStart || ts.slice(0, 10), ...extra,
      }, { auditSummary: `COMPLETED "${t.name}"` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId: t.id, projectId: t.projectId, event: 'COMPLETED', details: note || `Completed by ${this.user().name}`, from: t.status, to: TASK_STATUS.COMPLETED });
      await this.recalculate(t.projectId, { reason: `"${t.name}" completed`, skipAudit: true });
      await this._checkProjectClosure(t.projectId);
    });
    return after;
  }

  async reopenTask(taskId, reason) {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.REOPEN_TASK, { task: t });
    if (t.status !== TASK_STATUS.COMPLETED) throw new Error('Only completed tasks can be reopened.');
    if (!reason) throw new Error('A reopening reason is required.');
    const ts = nowIso();
    let after;
    await this.store.batch(async () => {
      const reopenHistory = [...(t.reopenHistory || []), { at: ts, by: this.user().name, reason, previousStatus: t.status, previousActualEnd: t.actualEnd, previousActualEndBy: t.actualEndBy, previousApprovalStatus: t.approvalStatus }];
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, {
        status: TASK_STATUS.IN_PROGRESS, actualEnd: null, actualEndTime: null, actualEndBy: null,
        approvalStatus: t.approvalRequired ? APPROVAL_STATUS.NOT_SUBMITTED : APPROVAL_STATUS.NOT_REQUIRED, reopenHistory,
      }, { reason, auditSummary: `REOPENED "${t.name}": ${reason}` });
      await this.store.append(COLLECTIONS.approvalHistory, { taskId, projectId: t.projectId, action: 'REOPENED', by: this.user().name, note: reason });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: 'REOPENED', details: reason, from: TASK_STATUS.COMPLETED, to: TASK_STATUS.IN_PROGRESS });
      await this._reopenProjectIfClosed(t.projectId, `Task "${t.name}" reopened: ${reason}`);
      await this.recalculate(t.projectId, { reason: `"${t.name}" reopened` });
    });
    return after;
  }

  async holdTask(taskId, reason, hold = true) {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.EDIT_TASK, { task: t });
    if (hold && ![TASK_STATUS.NOT_STARTED, TASK_STATUS.IN_PROGRESS].includes(t.status)) throw new Error('Only not-started or in-progress tasks can be put on hold.');
    if (!hold && t.status !== TASK_STATUS.ON_HOLD) return t;
    const to = hold ? TASK_STATUS.ON_HOLD : (t.actualStart ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.NOT_STARTED);
    let after;
    await this.store.batch(async () => {
      after = await this.store.update(COLLECTIONS.projectTasks, taskId, { status: to, holdReason: hold ? reason : null }, { reason, auditSummary: `${hold ? 'ON HOLD' : 'RESUMED'} "${t.name}"` });
      await this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: hold ? 'ON_HOLD' : 'RESUMED', details: reason, from: t.status, to });
    });
    return after;
  }

  async addComment(taskId, text) {
    const t = this.task(taskId);
    this.auth.assert(ACTIONS.ADD_COMMENT, { task: t });
    if (!text?.trim()) throw new Error('Comment cannot be empty.');
    await this.store.append(COLLECTIONS.comments, { taskId, projectId: t.projectId, text: text.trim() });
    return this.store.append(COLLECTIONS.taskHistory, { taskId, projectId: t.projectId, event: 'COMMENT', details: text.trim() });
  }

  async addProjectComment(projectId, text) {
    this.auth.assert(ACTIONS.ADD_COMMENT);
    if (!text?.trim()) throw new Error('Comment cannot be empty.');
    return this.store.append(COLLECTIONS.comments, { taskId: null, projectId, text: text.trim() });
  }


  // ---- Automatic project dates ----------------------------------------------
  async _captureProjectStart(projectId, ts) {
    const p = this.project(projectId);
    if (p.actualStartDate) return; // captured once, never overwritten
    await this.store.update(COLLECTIONS.projects, projectId, {
      actualStartDate: ts.slice(0, 10), actualStartTime: ts, actualStartBy: this.user().name, status: PROJECT_STATUS.IN_PROGRESS,
    }, { auditSummary: `Project actual start captured automatically (${ts.slice(0, 10)})` });
  }

  projectClosureCheck(projectId) {
    const tasks = this.projectTasks(projectId).filter((t) => t.isActive !== false && t.status !== TASK_STATUS.NOT_REQUIRED);
    const mandatory = tasks.filter((t) => t.isMandatory);
    const open = mandatory.filter((t) => t.status !== TASK_STATUS.COMPLETED);
    const unapproved = mandatory.filter((t) => t.approvalRequired && t.approvalStatus !== APPROVAL_STATUS.APPROVED);
    return { canClose: mandatory.length > 0 && open.length === 0 && unapproved.length === 0, open, unapproved, mandatory: mandatory.length };
  }

  async _checkProjectClosure(projectId) {
    const p = this.project(projectId);
    if (p.status === PROJECT_STATUS.COMPLETED) return;
    const { canClose } = this.projectClosureCheck(projectId);
    if (!canClose) return;
    const ts = nowIso();
    const closure = { closedAt: ts, closedBy: this.user().name, event: 'CLOSED' };
    await this.store.update(COLLECTIONS.projects, projectId, {
      status: PROJECT_STATUS.COMPLETED, actualEndDate: ts.slice(0, 10), actualEndTime: ts, actualEndBy: this.user().name,
      closureHistory: [...(p.closureHistory || []), closure],
    }, { auditSummary: `Project ${p.projectCode} closed automatically – all mandatory tasks complete` });
  }

  async _reopenProjectIfClosed(projectId, why) {
    const p = this.project(projectId);
    if (p.status !== PROJECT_STATUS.COMPLETED) return;
    await this.store.update(COLLECTIONS.projects, projectId, {
      status: PROJECT_STATUS.IN_PROGRESS, actualEndDate: null, actualEndBy: null,
      closureHistory: [...(p.closureHistory || []), { reopenedAt: nowIso(), reopenedBy: this.user().name, event: 'REOPENED', reason: why, previousActualEnd: p.actualEndDate }],
    }, { reason: why, auditSummary: `Project ${p.projectCode} reopened: ${why}` });
  }

  // ---- Stakeholders ----------------------------------------------------------
  async addStakeholder(data) {
    this.auth.assert(ACTIONS.EDIT_STAKEHOLDERS);
    if (!data.employeeName) throw new Error('Employee name is required.');
    if (!EMAIL_RE.test(data.email || '')) throw new Error('A valid e-mail address is required.');
    if (this.store.all(COLLECTIONS.stakeholders).some((s) => s.email.toLowerCase() === data.email.toLowerCase())) throw new Error('E-mail already exists.');
    return this.store.insert(COLLECTIONS.stakeholders, makeStakeholder(data, this.user()), { auditSummary: `Added stakeholder ${data.employeeName}` });
  }

  async updateStakeholder(id, changes, { expectedVersion } = {}) {
    this.auth.assert(ACTIONS.EDIT_STAKEHOLDERS);
    if ('email' in changes && !EMAIL_RE.test(changes.email || '')) throw new Error('A valid e-mail address is required.');
    if ('managerId' in changes && changes.managerId === id) throw new Error('A stakeholder cannot be their own manager.');
    const s = this.store.get(COLLECTIONS.stakeholders, id);
    return this.store.update(COLLECTIONS.stakeholders, id, changes, { expectedVersion, auditSummary: `Edited stakeholder ${s.employeeName}` });
  }

  // ---- Configuration ---------------------------------------------------------
  async updateConfig(changes) {
    this.auth.assert(ACTIONS.CONFIGURE_SYSTEM);
    const cfg = this.store.config();
    return this.store.update(COLLECTIONS.systemConfig, cfg.id, changes, { auditSummary: 'System configuration changed' });
  }

  async updateCalendar(changes) {
    this.auth.assert(ACTIONS.CONFIGURE_SYSTEM);
    const cal = this.store.calendar();
    const after = await this.store.update(COLLECTIONS.workingCalendar, cal.id, changes, { auditSummary: 'Working calendar changed' });
    await this.store.batch(async () => {
      for (const p of this.store.all(COLLECTIONS.projects)) await this.recalculate(p.id, { reason: 'Calendar changed' });
    });
    return after;
  }

  async recalculateAll() {
    await this.store.batch(async () => {
      for (const p of this.store.all(COLLECTIONS.projects)) await this.recalculate(p.id, { reason: 'Bulk recalculation', skipAudit: true });
    });
  }
}
