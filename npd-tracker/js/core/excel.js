// Excel import / export via SheetJS (loaded from CDN in index.html as window.XLSX).
// Imports are validated and previewed; nothing is written until the user confirms.

import { COLLECTIONS, TASK_STATUS } from './models.js';
import { classifyTask, taskMetrics } from './performance.js';

function xlsx() {
  if (typeof window === 'undefined' || !window.XLSX) throw new Error('Excel library (SheetJS) is not loaded – check your internet connection.');
  return window.XLSX;
}

function download(wb, filename) {
  xlsx().writeFile(wb, filename);
}

function sheetFromRows(rows, name, wb) {
  const ws = xlsx().utils.json_to_sheet(rows);
  const cols = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length + 2))) }));
  ws['!cols'] = cols;
  xlsx().utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

export class Excel {
  constructor(store, actions) { this.store = store; this.actions = actions; }

  stkName(id) { return this.store.get(COLLECTIONS.stakeholders, id)?.employeeName || ''; }
  stkByName(name) { return this.store.all(COLLECTIONS.stakeholders).find((s) => s.employeeName.toLowerCase() === String(name || '').trim().toLowerCase()); }
  stkByEmail(email) { return this.store.all(COLLECTIONS.stakeholders).find((s) => s.email.toLowerCase() === String(email || '').trim().toLowerCase()); }

  taskRows(projectId) {
    const project = this.store.get(COLLECTIONS.projects, projectId);
    const tasks = this.store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId).sort((a, b) => a.sequence - b.sequence);
    const deps = this.store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === projectId);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const cal = this.store.calendar(); const cfg = this.store.config();
    return tasks.map((t) => {
      const m = taskMetrics(t, cal);
      return {
        'Project ID': project.projectCode, 'Project Name': project.name, Brand: project.brand,
        'Task ID': t.activityNo, Activity: t.name, Department: t.department, FPR: this.stkName(t.fprId), Approver: this.stkName(t.approverId),
        Predecessors: deps.filter((d) => d.taskId === t.id).map((d) => `${byId.get(d.predecessorId)?.activityNo}${d.type !== 'FS' ? d.type : ''}${d.lagDays ? `+${d.lagDays}` : ''}`).join(', '),
        'Expected Duration': t.expectedDuration, 'Planned Start': t.plannedStart, 'Planned End': t.plannedEnd,
        'Forecast Start': t.forecastStart, 'Forecast End': t.forecastEnd, 'Actual Start': t.actualStart, 'Actual Completion': t.actualEnd,
        'Actual Duration': m.actualDuration ?? '', 'Delay Days': m.delayDays ?? '',
        'Task Status': t.status, 'Performance': classifyTask(t, { tasksById: byId, deps, cal, config: cfg }), 'Approval Status': t.approvalStatus,
        Mandatory: t.isMandatory ? 'Yes' : 'No', 'Approval Required': t.approvalRequired ? 'Yes' : 'No', Critical: t.isCritical ? 'Yes' : 'No', Priority: t.priority,
      };
    });
  }

  exportProjectTasks(projectId) {
    const wb = xlsx().utils.book_new();
    const project = this.store.get(COLLECTIONS.projects, projectId);
    sheetFromRows(this.taskRows(projectId), 'Tasks', wb);
    const deps = this.store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === projectId);
    const byId = new Map(this.store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId).map((t) => [t.id, t]));
    sheetFromRows(deps.map((d) => ({ 'Task ID': byId.get(d.taskId)?.activityNo, Task: byId.get(d.taskId)?.name, 'Predecessor ID': byId.get(d.predecessorId)?.activityNo, Predecessor: byId.get(d.predecessorId)?.name, Type: d.type, 'Lag Days': d.lagDays })), 'Dependencies', wb);
    download(wb, `${project.projectCode}_tasks.xlsx`);
  }

  exportGantt(projectId) {
    const wb = xlsx().utils.book_new();
    const project = this.store.get(COLLECTIONS.projects, projectId);
    const rows = this.taskRows(projectId).map((r) => ({ 'Task ID': r['Task ID'], Activity: r.Activity, Department: r.Department, FPR: r.FPR, 'Planned Start': r['Planned Start'], 'Planned End': r['Planned End'], 'Forecast End': r['Forecast End'], 'Actual Start': r['Actual Start'], 'Actual Completion': r['Actual Completion'], Status: r.Performance, Critical: r.Critical, Predecessors: r.Predecessors }));
    sheetFromRows(rows, 'Gantt', wb);
    download(wb, `${project.projectCode}_gantt.xlsx`);
  }

  exportDelayReport() {
    const wb = xlsx().utils.book_new();
    const rows = [];
    for (const p of this.store.all(COLLECTIONS.projects)) rows.push(...this.taskRows(p.id).filter((r) => Number(r['Delay Days']) > 0 || r.Performance === 'OVERDUE'));
    sheetFromRows(rows.length ? rows : [{ Info: 'No delayed tasks' }], 'Delays', wb);
    download(wb, `NPD_delay_report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  exportProjectStatus(summaries) {
    const wb = xlsx().utils.book_new();
    sheetFromRows(summaries, 'Project Status', wb);
    download(wb, `NPD_project_status_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  exportActivityMaster() {
    const wb = xlsx().utils.book_new();
    const acts = this.store.all(COLLECTIONS.activityMaster).sort((a, b) => a.sequence - b.sequence);
    const deps = this.store.all(COLLECTIONS.masterDependencies);
    const byId = new Map(acts.map((a) => [a.id, a]));
    sheetFromRows(acts.map((a) => ({
      'Activity ID': a.activityNo, 'Activity Name': a.name, Department: a.department, 'Default FPR': this.stkName(a.defaultFprId),
      'Expected Duration (Days)': a.expectedDuration, 'Predecessor Activity ID': deps.filter((d) => d.taskId === a.id).map((d) => `${byId.get(d.predecessorId)?.activityNo}${d.type !== 'FS' ? d.type : ''}${d.lagDays ? `+${d.lagDays}` : ''}`).join(', '),
      Mandatory: a.isMandatory ? 'Yes' : 'No', 'Approval Required': a.approvalRequired ? 'Yes' : 'No', Active: a.isActive === false ? 'No' : 'Yes', Description: a.description, Instructions: a.instructions,
    })), 'Activity Master', wb);
    download(wb, 'NPD_activity_master.xlsx');
  }

  exportStakeholders() {
    const wb = xlsx().utils.book_new();
    sheetFromRows(this.store.all(COLLECTIONS.stakeholders).map((s) => ({
      'Employee Name': s.employeeName, Department: s.department, Designation: s.designation, Email: s.email, Role: s.role,
      'Manager Email': this.store.get(COLLECTIONS.stakeholders, s.managerId)?.email || '', 'Backup FPR Email': this.store.get(COLLECTIONS.stakeholders, s.backupFprId)?.email || '', Active: s.isActive === false ? 'No' : 'Yes',
    })), 'Stakeholders', wb);
    download(wb, 'NPD_stakeholders.xlsx');
  }

  // ---- Import --------------------------------------------------------------
  async readWorkbook(file) {
    const buf = await file.arrayBuffer();
    const wb = xlsx().read(buf, { type: 'array' });
    const out = {};
    for (const name of wb.SheetNames) out[name] = xlsx().utils.sheet_to_json(wb.Sheets[name], { defval: '' });
    return out;
  }

  // Parses "4, 9FF+1, 14" style predecessor text into [{no, type, lag}]
  parsePreds(text) {
    return String(text || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*(?:\+\s*(-?\d+))?$/i);
      if (!m) return { error: `Cannot parse predecessor "${s}"` };
      return { no: Number(m[1]), type: (m[2] || 'FS').toUpperCase(), lag: Number(m[3] || 0) };
    });
  }

  // Validate activity-master rows. Returns { rows:[{row, record, preds, errors, action}], errors }
  validateActivityMaster(rows) {
    const existing = this.store.all(COLLECTIONS.activityMaster);
    const seen = new Set();
    const out = rows.map((r, i) => {
      const errors = [];
      const no = Number(r['Activity ID'] ?? r['Activity No'] ?? r.activityNo);
      const name = String(r['Activity Name'] ?? r.Activity ?? r.name ?? '').trim();
      if (!Number.isInteger(no) || no <= 0) errors.push('Activity ID must be a positive integer');
      if (!name) errors.push('Activity Name is required');
      if (seen.has(no)) errors.push(`Duplicate Activity ID ${no} in file`); seen.add(no);
      const dur = Number(r['Expected Duration (Days)'] ?? r['Expected Duration'] ?? r.Duration ?? 0);
      if (!Number.isFinite(dur) || dur < 0) errors.push('Duration must be >= 0');
      const fprName = r['Default FPR'] ?? r.FPR ?? '';
      const fpr = fprName ? (this.stkByName(fprName) || this.stkByEmail(fprName)) : null;
      if (fprName && !fpr) errors.push(`Unknown FPR "${fprName}" – add to Stakeholder Master first`);
      const preds = this.parsePreds(r['Predecessor Activity ID'] ?? r.Predecessors ?? '');
      preds.filter((p) => p.error).forEach((p) => errors.push(p.error));
      const match = existing.find((a) => Number(a.activityNo) === no);
      return {
        row: i + 2, errors, action: match ? 'UPDATE' : 'ADD', existingId: match?.id,
        record: { activityNo: no, name, department: String(r.Department || match?.department || '').trim(), defaultFprId: fpr?.id ?? match?.defaultFprId ?? null, expectedDuration: dur, isMandatory: yes(r.Mandatory, match?.isMandatory ?? true), approvalRequired: yes(r['Approval Required'], match?.approvalRequired ?? false), description: r.Description ?? match?.description ?? '', instructions: r.Instructions ?? match?.instructions ?? '' },
        preds: preds.filter((p) => !p.error),
      };
    });
    const nos = new Set(out.map((o) => o.record.activityNo).concat(existing.map((a) => Number(a.activityNo))));
    for (const o of out) for (const p of o.preds) if (!nos.has(p.no)) o.errors.push(`Predecessor ${p.no} does not exist`);
    return { rows: out, errors: out.flatMap((o) => o.errors.map((e) => `Row ${o.row}: ${e}`)) };
  }

  async commitActivityMaster(validated) {
    if (validated.errors.length) throw new Error('Fix validation errors before importing.');
    const results = { added: 0, updated: 0, deps: 0 };
    await this.store.batch(async () => {
      const idByNo = new Map(this.store.all(COLLECTIONS.activityMaster).map((a) => [Number(a.activityNo), a.id]));
      for (const o of validated.rows) {
        if (o.action === 'UPDATE') { await this.actions.updateActivity(o.existingId, o.record); results.updated += 1; }
        else { const a = await this.actions.addActivity(o.record); idByNo.set(o.record.activityNo, a.id); results.added += 1; }
      }
      for (const o of validated.rows) {
        const id = idByNo.get(o.record.activityNo);
        const current = this.store.where(COLLECTIONS.masterDependencies, (d) => d.taskId === id);
        for (const d of current) await this.actions.removeMasterDependency(d.id);
        for (const p of o.preds) { await this.actions.addMasterDependency(id, idByNo.get(p.no), p.type, p.lag); results.deps += 1; }
      }
    });
    return results;
  }

  validateStakeholders(rows) {
    const out = rows.map((r, i) => {
      const errors = [];
      const name = String(r['Employee Name'] ?? r.Name ?? '').trim();
      const email = String(r.Email ?? r['Email ID'] ?? '').trim();
      if (!name) errors.push('Employee Name is required');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid Email is required');
      const match = this.stkByEmail(email);
      const role = String(r.Role || match?.role || 'FPR').trim();
      if (!['Administrator', 'Department Head', 'FPR', 'Management'].includes(role)) errors.push(`Unknown role "${role}"`);
      return { row: i + 2, errors, action: match ? 'UPDATE' : 'ADD', existingId: match?.id, managerEmail: r['Manager Email'] || '', backupEmail: r['Backup FPR Email'] || '',
        record: { employeeName: name, email, department: String(r.Department || match?.department || '').trim(), designation: r.Designation ?? match?.designation ?? '', role, isActive: yes(r.Active, true) } };
    });
    return { rows: out, errors: out.flatMap((o) => o.errors.map((e) => `Row ${o.row}: ${e}`)) };
  }

  async commitStakeholders(validated) {
    if (validated.errors.length) throw new Error('Fix validation errors before importing.');
    const results = { added: 0, updated: 0 };
    await this.store.batch(async () => {
      for (const o of validated.rows) {
        if (o.action === 'UPDATE') { await this.actions.updateStakeholder(o.existingId, o.record); results.updated += 1; }
        else { await this.actions.addStakeholder(o.record); results.added += 1; }
      }
      for (const o of validated.rows) {
        const me = this.stkByEmail(o.record.email);
        const upd = {};
        if (o.managerEmail) { const m = this.stkByEmail(o.managerEmail); if (m && m.id !== me.id) upd.managerId = m.id; }
        if (o.backupEmail) { const b = this.stkByEmail(o.backupEmail); if (b && b.id !== me.id) upd.backupFprId = b.id; }
        if (Object.keys(upd).length) await this.actions.updateStakeholder(me.id, upd);
      }
    });
    return results;
  }

  // Project task import: updates existing project tasks matched by Task ID (activityNo) and adds new rows.
  validateProjectTasks(projectId, rows) {
    const tasks = this.store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId);
    const out = rows.map((r, i) => {
      const errors = [];
      const no = Number(r['Task ID'] ?? r['Activity ID']);
      const name = String(r.Activity ?? r['Task Name'] ?? r['Activity Name'] ?? '').trim();
      if (!Number.isInteger(no)) errors.push('Task ID must be an integer');
      if (!name) errors.push('Activity name is required');
      const dur = Number(r['Expected Duration'] ?? r['Expected Duration (Days)'] ?? 0);
      if (!Number.isFinite(dur) || dur < 0) errors.push('Duration must be >= 0');
      const fprName = r.FPR || '';
      const fpr = fprName ? (this.stkByName(fprName) || this.stkByEmail(fprName)) : null;
      if (fprName && !fpr) errors.push(`Unknown FPR "${fprName}"`);
      const preds = this.parsePreds(r.Predecessors ?? '');
      preds.filter((p) => p.error).forEach((p) => errors.push(p.error));
      const match = tasks.find((t) => Number(t.activityNo) === no);
      if (match && match.actualStart && Number(match.expectedDuration) !== dur) errors.push(`Task ${no} already started – duration change will be applied but actual dates are preserved`);
      return { row: i + 2, errors: errors.filter((e) => !e.includes('preserved')), warnings: errors.filter((e) => e.includes('preserved')), action: match ? 'UPDATE' : 'ADD', existingId: match?.id,
        record: { activityNo: no, name, department: String(r.Department || match?.department || '').trim(), fprId: fpr?.id ?? match?.fprId ?? null, expectedDuration: dur, isMandatory: yes(r.Mandatory, match?.isMandatory ?? true), approvalRequired: yes(r['Approval Required'], match?.approvalRequired ?? false), priority: r.Priority || match?.priority || 'Medium' },
        preds: preds.filter((p) => !p.error) };
    });
    return { rows: out, errors: out.flatMap((o) => o.errors.map((e) => `Row ${o.row}: ${e}`)), warnings: out.flatMap((o) => o.warnings.map((e) => `Row ${o.row}: ${e}`)) };
  }

  async commitProjectTasks(projectId, validated) {
    if (validated.errors.length) throw new Error('Fix validation errors before importing.');
    const results = { added: 0, updated: 0, deps: 0 };
    await this.store.batch(async () => {
      for (const o of validated.rows) {
        if (o.action === 'UPDATE') { const { fprId, ...rest } = o.record; await this.actions.updateTask(o.existingId, rest); if (fprId && fprId !== this.store.get(COLLECTIONS.projectTasks, o.existingId).fprId) await this.actions.changeFpr(o.existingId, fprId); results.updated += 1; }
        else { await this.actions.addTask(projectId, o.record); results.added += 1; }
      }
      const byNo = new Map(this.store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId).map((t) => [Number(t.activityNo), t.id]));
      for (const o of validated.rows) {
        if (!o.preds.length && o.action === 'UPDATE') continue;
        const id = byNo.get(o.record.activityNo);
        for (const d of this.store.where(COLLECTIONS.taskDependencies, (x) => x.taskId === id)) await this.actions.removeDependency(d.id);
        for (const p of o.preds) { if (byNo.has(p.no)) { await this.actions.addDependency(projectId, id, byNo.get(p.no), p.type, p.lag); results.deps += 1; } }
      }
    });
    return results;
  }

  // Dependencies-only import for a project: Task ID, Predecessor ID, Type, Lag Days (replaces the task's predecessor list)
  validateDependencySheet(projectId, rows) {
    const byNo = new Map(this.store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId).map((t) => [Number(t.activityNo), t.id]));
    const out = rows.map((r, i) => {
      const errors = [];
      const t = Number(r['Task ID']); const p = Number(r['Predecessor ID']);
      if (!byNo.has(t)) errors.push(`Unknown Task ID ${t}`);
      if (!byNo.has(p)) errors.push(`Unknown Predecessor ID ${p}`);
      const type = String(r.Type || 'FS').toUpperCase();
      if (!['FS', 'SS', 'FF', 'SF'].includes(type)) errors.push(`Invalid type ${type}`);
      return { row: i + 2, errors, taskId: byNo.get(t), predecessorId: byNo.get(p), type, lagDays: Number(r['Lag Days'] || 0) };
    });
    return { rows: out, errors: out.flatMap((o) => o.errors.map((e) => `Row ${o.row}: ${e}`)) };
  }

  async commitDependencySheet(projectId, validated) {
    if (validated.errors.length) throw new Error('Fix validation errors before importing.');
    let n = 0;
    await this.store.batch(async () => {
      const touched = new Set(validated.rows.map((r) => r.taskId));
      for (const id of touched) for (const d of this.store.where(COLLECTIONS.taskDependencies, (x) => x.taskId === id)) await this.actions.removeDependency(d.id);
      for (const r of validated.rows) { await this.actions.addDependency(projectId, r.taskId, r.predecessorId, r.type, r.lagDays); n += 1; }
    });
    return { deps: n };
  }
}

function yes(v, dflt) {
  if (v === '' || v == null) return dflt;
  return /^(y|yes|true|1)$/i.test(String(v).trim());
}

export { TASK_STATUS };
