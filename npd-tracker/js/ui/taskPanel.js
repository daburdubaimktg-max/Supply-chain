// Slide-out task detail panel with action buttons, edit form, dependencies and history.
import { el, fmt, badge, statusBadge, yesNo, openPanel, closePanel, guard, promptDialog, confirmDialog, formModal, toast } from './components.js';
import { COLLECTIONS, TASK_STATUS, APPROVAL_STATUS, PRIORITIES, DEP_TYPES } from '../core/models.js';
import { ACTIONS } from '../core/auth.js';
import { classifyTask, taskMetrics, blockingPredecessors } from '../core/performance.js';
import { diffWorkingDays } from '../core/calendar.js';

export function openTaskPanel(ctx, taskId, { tab = 'details' } = {}) {
  const { store, auth, actions } = ctx;
  const task = store.get(COLLECTIONS.projectTasks, taskId);
  if (!task) { toast('Task not found', 'error'); return; }
  const project = store.get(COLLECTIONS.projects, task.projectId);
  const stk = (id) => store.get(COLLECTIONS.stakeholders, id);
  const name = (id) => stk(id)?.employeeName || '—';
  const tasks = store.where(COLLECTIONS.projectTasks, (t) => t.projectId === task.projectId);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const deps = store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === task.projectId);
  const cal = store.calendar(); const cfg = store.config();
  const perf = classifyTask(task, { tasksById, deps, cal, config: cfg });
  const metrics = taskMetrics(task, cal);
  const blocking = blockingPredecessors(task, tasksById, deps);
  const refresh = (t = tab) => openTaskPanel(ctx, taskId, { tab: t });
  const run = (fn, msg) => guard(async () => { await fn(); if (msg) toast(msg, 'success'); refresh(); });

  // ---- action buttons (only rendered when the current user may perform them) ----
  const btns = [];
  const can = (a) => auth.can(a, { task });
  const isNR = task.status === TASK_STATUS.NOT_REQUIRED;
  if (!isNR && [TASK_STATUS.NOT_STARTED, TASK_STATUS.BLOCKED].includes(task.status) && can(ACTIONS.START_TASK)) {
    btns.push(el('button', { class: 'btn btn-primary', disabled: blocking.length > 0, title: blocking.length ? `Blocked by ${blocking.map((b) => b.name).join(', ')}` : 'Captures actual start date & user', onClick: run(() => actions.startTask(taskId), 'Task started – actual start date captured') }, '▶ Start Task'));
  }
  if (task.status === TASK_STATUS.ON_HOLD && can(ACTIONS.EDIT_TASK)) btns.push(el('button', { class: 'btn btn-primary', onClick: run(() => actions.holdTask(taskId, '', false), 'Task resumed') }, 'Resume'));
  if (task.status === TASK_STATUS.IN_PROGRESS) {
    if (task.approvalRequired && task.approvalStatus !== APPROVAL_STATUS.APPROVED && can(ACTIONS.SUBMIT_TASK)) {
      btns.push(el('button', { class: 'btn btn-primary', onClick: guard(async () => { const note = await promptDialog({ title: 'Submit for approval', label: 'Note to approver (optional)', required: false, okText: 'Submit' }); if (note === null) return; await actions.submitForApproval(taskId, note); toast('Submitted for approval', 'success'); refresh(); }) }, '⇪ Submit for Approval'));
    }
    if ((!task.approvalRequired || task.approvalStatus === APPROVAL_STATUS.APPROVED || can(ACTIONS.APPROVE_TASK)) && can(ACTIONS.COMPLETE_TASK)) {
      btns.push(el('button', { class: 'btn btn-success', onClick: guard(async () => { if (!(await confirmDialog({ title: 'Complete task', message: `Mark "${task.name}" as completed? The actual completion date and your identity will be captured.`, okText: 'Complete', okClass: 'btn-success' }))) return; await actions.completeTask(taskId); toast('Task completed', 'success'); refresh(); }) }, '✓ Complete'));
    }
    if (can(ACTIONS.EDIT_TASK)) btns.push(el('button', { class: 'btn', onClick: guard(async () => { const r = await promptDialog({ title: 'Put task on hold', label: 'Reason' }); if (r === null) return; await actions.holdTask(taskId, r, true); refresh(); }) }, 'Hold'));
  }
  if (task.status === TASK_STATUS.PENDING_APPROVAL && can(ACTIONS.APPROVE_TASK)) {
    btns.push(el('button', { class: 'btn btn-success', onClick: guard(async () => { const note = await promptDialog({ title: 'Approve task', label: 'Approval note (optional)', required: false, okText: 'Approve' }); if (note === null) return; await actions.approveTask(taskId, note); toast('Approved & completed', 'success'); refresh(); }) }, '✓ Approve'));
    btns.push(el('button', { class: 'btn btn-danger', onClick: guard(async () => { const r = await promptDialog({ title: 'Reject task', label: 'Rejection reason (required)', okText: 'Reject' }); if (r === null) return; await actions.rejectTask(taskId, r); toast('Rejected – returned to FPR', 'warn'); refresh(); }) }, '✕ Reject'));
  }
  if (task.status === TASK_STATUS.COMPLETED && can(ACTIONS.REOPEN_TASK)) {
    btns.push(el('button', { class: 'btn btn-warn', onClick: guard(async () => { const r = await promptDialog({ title: 'Reopen task', label: 'Reopening reason (required)', okText: 'Reopen' }); if (r === null) return; await actions.reopenTask(taskId, r); toast('Task reopened', 'warn'); refresh(); }) }, '↺ Reopen'));
  }
  if (!isNR && task.status !== TASK_STATUS.COMPLETED && can(ACTIONS.MARK_NOT_REQUIRED)) {
    btns.push(el('button', { class: 'btn', title: 'Skip this task for this project; dependants are released', onClick: guard(async () => { const r = await promptDialog({ title: 'Mark task Not Required', label: 'Why is this task not required for this project?' }); if (r === null) return; await actions.markNotRequired(taskId, r); toast('Marked Not Required', 'success'); refresh(); }) }, 'Not Required'));
  }
  if (isNR && can(ACTIONS.MARK_NOT_REQUIRED)) btns.push(el('button', { class: 'btn', onClick: guard(async () => { await actions.restoreRequired(taskId, 'Restored from panel'); refresh(); }) }, 'Restore as Required'));
  if (can(ACTIONS.EDIT_TASK)) btns.push(el('button', { class: 'btn', onClick: () => editTask(ctx, task).then((ok) => ok && refresh()) }, '✎ Edit'));
  btns.push(el('button', { class: 'btn', onClick: () => refresh('history') }, 'View History'));

  const tabs = ['details', 'dependencies', 'history'];
  const tabBar = el('div', { class: 'tabs' }, tabs.map((t) => el('button', { class: t === tab ? 'active' : '', onClick: () => refresh(t) }, t[0].toUpperCase() + t.slice(1))));

  let body;
  if (tab === 'details') {
    body = el('div', {},
      blocking.length ? el('div', { class: 'notice warn' }, `Blocked – waiting for: ${blocking.map((b) => b.name).join(', ')}`) : null,
      task.rejectionReason && task.approvalStatus === APPROVAL_STATUS.REJECTED ? el('div', { class: 'notice error' }, `Rejected: ${task.rejectionReason}`) : null,
      isNR ? el('div', { class: 'notice info' }, `Not required: ${task.notRequiredReason || ''}`) : null,
      task.holdReason && task.status === TASK_STATUS.ON_HOLD ? el('div', { class: 'notice warn' }, `On hold: ${task.holdReason}`) : null,
      el('dl', { class: 'kv' },
        kv('Project', `${project.projectCode} · ${project.name}`), kv('Brand', project.brand), kv('Department', task.department),
        kv('FPR', name(task.fprId)), kv('Backup FPR', name(task.backupFprId)), kv('Approver', name(task.approverId)),
        kv('Expected duration', `${task.expectedDuration} working day(s)${task.expectedDuration === 0 ? ' – milestone' : ''}`),
        kv('Planned', `${fmt(task.plannedStart)} → ${fmt(task.plannedEnd)}`), kv('Forecast', `${fmt(task.forecastStart)} → ${fmt(task.forecastEnd)}`),
        kv('Actual start', task.actualStart ? `${fmt(task.actualStart)} by ${task.actualStartBy}` : '—'), kv('Actual completion', task.actualEnd ? `${fmt(task.actualEnd)} by ${task.actualEndBy}` : '—'),
        kv('Actual duration', metrics.actualDuration != null ? `${metrics.actualDuration} d` : '—'), kv('Delay', metrics.delayDays ? badge(`${metrics.delayDays} working day(s)`, 'red') : badge('0', 'green')),
        kv('Status', task.status.replace(/_/g, ' ')), kv('Approval', task.approvalStatus.replace(/_/g, ' ')), kv('Mandatory', yesNo(task.isMandatory)), kv('Approval required', yesNo(task.approvalRequired)),
        kv('Priority', task.priority), kv('Critical path', yesNo(task.isCritical)), kv('Slack', task.plannedEnd && task.forecastEnd ? `${diffWorkingDays(task.forecastEnd, task.plannedEnd, cal)} d` : '—')),
      task.description ? el('div', { class: 'panel-section mt' }, el('h4', {}, 'Description'), el('p', {}, task.description)) : null,
      task.instructions ? el('div', { class: 'panel-section' }, el('h4', {}, 'Instructions'), el('p', { style: { whiteSpace: 'pre-wrap' } }, task.instructions)) : null,
      commentsSection(ctx, task, refresh));
  } else if (tab === 'dependencies') {
    body = dependenciesSection(ctx, task, tasks, deps, refresh);
  } else if (tab === 'history') {
    const hist = store.all(COLLECTIONS.taskHistory).filter((h) => h.taskId === taskId);
    const audit = store.all(COLLECTIONS.auditLog).filter((a) => a.recordId === taskId || a.taskId === taskId);
    const approvals = store.all(COLLECTIONS.approvalHistory).filter((h) => h.taskId === taskId);
    const items = [
      { when: task.createdAt, who: task.createdBy, text: 'Task created' },
      ...hist.map((h) => ({ when: h.timestamp, who: h.user, text: `${h.event.replace(/_/g, ' ')}${h.details ? ` – ${h.details}` : ''}` })),
      ...audit.filter((a) => a.action === 'UPDATE' && a.changes.length).map((a) => ({ when: a.timestamp, who: a.user, text: `${a.summary}`, changes: a.changes })),
    ].sort((a, b) => a.when < b.when ? -1 : 1);
    body = el('div', {},
      el('h4', {}, 'Approval history (immutable)'),
      approvals.length ? el('ul', { class: 'timeline mb' }, approvals.map((h) => el('li', {}, el('div', { class: 'when' }, `${new Date(h.timestamp).toLocaleString()} · ${h.by}`), `${h.action}${h.note ? ` – ${h.note}` : ''}`))) : el('p', { class: 'muted small mb' }, 'No approval events.'),
      el('h4', {}, 'Full history'),
      el('ul', { class: 'timeline' }, items.map((i) => el('li', {}, el('div', { class: 'when' }, `${new Date(i.when).toLocaleString()} · ${i.who}`), i.text,
        i.changes ? el('ul', { class: 'plain small muted' }, i.changes.slice(0, 8).map((c) => el('li', {}, `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`))) : null))));
  }

  const panel = el('div', {},
    el('div', { class: 'panel-head' },
      el('div', {}, el('div', { class: 'small muted' }, `Task ${task.activityNo} · ${project.projectCode}`), el('h3', {}, task.name), el('div', { class: 'flex', style: { marginTop: '4px' } }, statusBadge(perf), task.isCritical ? badge('CRITICAL PATH', 'red') : null, task.isActive === false ? badge('INACTIVE', 'grey') : null)),
      el('button', { class: 'btn btn-ghost', onClick: closePanel, 'aria-label': 'Close' }, '✕')),
    el('div', { class: 'panel-body' }, el('div', { class: 'btn-group mb' }, btns), tabBar, body));
  openPanel(panel);
}

function kv(k, v) { return [el('dt', {}, k), el('dd', {}, v)]; }

function commentsSection(ctx, task, refresh) {
  const { store, auth, actions } = ctx;
  const comments = store.all(COLLECTIONS.comments).filter((c) => c.taskId === task.id);
  const ta = el('textarea', { placeholder: 'Add a comment…', style: { minHeight: '50px' } });
  return el('div', { class: 'panel-section mt' }, el('h4', {}, `Comments (${comments.length})`),
    comments.length ? el('ul', { class: 'timeline mb' }, comments.map((c) => el('li', {}, el('div', { class: 'when' }, `${new Date(c.timestamp).toLocaleString()} · ${c.user}`), c.text))) : null,
    auth.can(ACTIONS.ADD_COMMENT, { task }) ? el('div', {}, ta, el('button', { class: 'btn btn-sm mt', onClick: guard(async () => { await actions.addComment(task.id, ta.value); refresh(); }) }, 'Add comment')) : null);
}

function dependenciesSection(ctx, task, tasks, deps, refresh) {
  const { auth, actions, store } = ctx;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preds = deps.filter((d) => d.taskId === task.id);
  const succs = deps.filter((d) => d.predecessorId === task.id);
  const canEdit = auth.can(ACTIONS.EDIT_DEPENDENCIES);
  const satisfied = (d) => { const p = byId.get(d.predecessorId); if (!p) return false; if (p.status === TASK_STATUS.NOT_REQUIRED) return true; return (d.type === 'SS' || d.type === 'SF') ? Boolean(p.actualStart) || p.status === TASK_STATUS.COMPLETED : p.status === TASK_STATUS.COMPLETED; };
  const row = (d) => el('tr', {},
    el('td', {}, `${byId.get(d.predecessorId)?.activityNo ?? ''} ${byId.get(d.predecessorId)?.name || d.predecessorId}`),
    el('td', {}, d.type), el('td', { class: 'num' }, d.lagDays),
    el('td', {}, satisfied(d) ? badge('Satisfied', 'green') : badge('Waiting', 'amber')),
    el('td', { class: 'actions' }, canEdit ? [
      el('button', { class: 'btn btn-xs', onClick: () => editDependency(ctx, d, tasks).then((ok) => ok && refresh('dependencies')) }, 'Edit'),
      el('button', { class: 'btn btn-xs btn-danger', onClick: guard(async () => { if (!(await confirmDialog({ title: 'Remove predecessor', message: 'Remove this dependency? Downstream dates will be recalculated.', danger: true, okText: 'Remove' }))) return; await actions.removeDependency(d.id); toast('Predecessor removed – schedule recalculated', 'success'); refresh('dependencies'); }) }, 'Remove'),
    ] : null));
  return el('div', {},
    el('div', { class: 'card-head' }, el('h4', {}, `Predecessors (${preds.length})`), canEdit ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => addDependency(ctx, task, tasks).then((ok) => ok && refresh('dependencies')) }, '+ Add predecessor') : null),
    el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ['Predecessor', 'Type', 'Lag', 'Status', ''].map((h) => el('th', {}, h)))), el('tbody', {}, preds.length ? preds.map(row) : el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'No predecessors – can start at project anchor date.')))),
    el('h4', { class: 'mt' }, `Downstream dependent tasks (${succs.length})`),
    el('ul', { class: 'plain small' }, succs.map((d) => { const s = byId.get(d.taskId); return el('li', {}, el('a', { href: '#', onClick: (e) => { e.preventDefault(); openTaskPanel(ctx, s.id, { tab: 'dependencies' }); } }, `${s?.activityNo} ${s?.name}`), ` (${d.type}${d.lagDays ? `+${d.lagDays}` : ''})`); })),
    !succs.length ? el('p', { class: 'muted small' }, 'No dependent tasks.') : null,
    el('p', { class: 'small muted mt' }, `Store: one record per predecessor relationship (${store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === task.projectId).length} in this project).`));
}

export async function addDependency(ctx, task, tasks) {
  const { actions } = ctx;
  const options = tasks.filter((t) => t.id !== task.id && t.isActive !== false).sort((a, b) => a.sequence - b.sequence).map((t) => ({ value: t.id, label: `${t.activityNo} · ${t.name}` }));
  const r = await formModal({
    title: `Add predecessor to "${task.name}"`,
    fields: [
      { name: 'predecessorId', label: 'Predecessor task', type: 'select', options, required: true, span2: true },
      { name: 'type', label: 'Dependency type', type: 'select', options: DEP_TYPES.map((t) => ({ value: t, label: { FS: 'Finish-to-Start (FS)', SS: 'Start-to-Start (SS)', FF: 'Finish-to-Finish (FF)', SF: 'Start-to-Finish (SF)' }[t] })), value: 'FS' },
      { name: 'lagDays', label: 'Lag (working days)', type: 'number', value: 0, step: 1 },
    ],
    submitText: 'Preview & add',
    onSubmit: async (v) => {
      const preview = actions.previewImpact(task.projectId, { depsAdd: [{ taskId: task.id, predecessorId: v.predecessorId, type: v.type, lagDays: Number(v.lagDays || 0) }] });
      if (preview.errors.length) throw new Error(preview.errors.join('\n'));
      const ok = await confirmImpact(ctx, preview.impact, 'Add predecessor');
      if (!ok) return null;
      await actions.addDependency(task.projectId, task.id, v.predecessorId, v.type, Number(v.lagDays || 0));
      toast('Predecessor added – schedule recalculated', 'success');
      return true;
    },
  });
  return Boolean(r);
}

export async function editDependency(ctx, dep, tasks) {
  const { actions } = ctx;
  const succ = tasks.find((t) => t.id === dep.taskId);
  const options = tasks.filter((t) => t.id !== dep.taskId && t.isActive !== false).sort((a, b) => a.sequence - b.sequence).map((t) => ({ value: t.id, label: `${t.activityNo} · ${t.name}` }));
  const r = await formModal({
    title: `Edit predecessor of "${succ?.name}"`,
    fields: [
      { name: 'predecessorId', label: 'Predecessor task', type: 'select', options, value: dep.predecessorId, required: true, span2: true },
      { name: 'type', label: 'Dependency type', type: 'select', options: DEP_TYPES.map((t) => ({ value: t, label: t })), value: dep.type },
      { name: 'lagDays', label: 'Lag (working days)', type: 'number', value: dep.lagDays, step: 1 },
    ],
    onSubmit: async (v) => {
      const preview = actions.previewImpact(dep.projectId, { depsUpdate: { [dep.id]: { predecessorId: v.predecessorId, type: v.type, lagDays: Number(v.lagDays || 0) } } });
      if (preview.errors.length) throw new Error(preview.errors.join('\n'));
      const ok = await confirmImpact(ctx, preview.impact, 'Change dependency');
      if (!ok) return null;
      await actions.updateDependency(dep.id, { predecessorId: v.predecessorId, type: v.type, lagDays: Number(v.lagDays || 0) });
      toast('Dependency updated – schedule recalculated', 'success');
      return true;
    },
  });
  return Boolean(r);
}

// Shows schedule impact and asks for confirmation when the change is significant.
export async function confirmImpact(ctx, impact, title) {
  const cfg = ctx.store.config();
  const significant = Math.abs(impact.endShift) >= Number(cfg.significantChangeDays ?? 5) || impact.changes.length >= 10;
  if (!impact.changes.length) return true;
  const body = el('div', {},
    el('p', {}, `${impact.changes.length} task date(s) will change. Project end: ${fmt(impact.projectEndBefore)} → ${fmt(impact.projectEndAfter)} (${impact.endShift > 0 ? '+' : ''}${impact.endShift} working days).`),
    significant ? el('div', { class: 'notice warn' }, 'This is a significant schedule change to an active project.') : null,
    el('div', { class: 'table-wrap', style: { maxHeight: '300px', overflowY: 'auto' } }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ['Task', 'Before', 'After', 'Shift'].map((h) => el('th', {}, h)))),
      el('tbody', {}, impact.changes.map((c) => el('tr', {}, el('td', {}, c.name), el('td', {}, c.from ? `${fmt(c.from.start)} → ${fmt(c.from.end)}` : 'new'), el('td', {}, `${fmt(c.to.start ?? c.to.plannedStart)} → ${fmt(c.to.end ?? c.to.plannedEnd)}`), el('td', { class: 'num' }, c.shiftDays ?? '')))))));
  return confirmDialog({ title: `${title} – schedule impact`, body, okText: 'Apply changes' });
}

export async function editTask(ctx, task) {
  const { store, auth, actions } = ctx;
  const allowed = auth.editableTaskFields();
  const stks = store.all(COLLECTIONS.stakeholders).filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: `${s.employeeName} (${s.department})` }));
  const noOne = [{ value: '', label: '— none —' }];
  const departments = Array.from(new Set(store.all(COLLECTIONS.stakeholders).map((s) => s.department).concat(store.all(COLLECTIONS.activityMaster).map((a) => a.department)))).sort();
  const dis = (f) => allowed ? !allowed.has(f) : false;
  const fields = [
    { name: 'name', label: 'Task name', required: true, value: task.name, disabled: dis('name'), span2: true },
    { name: 'activityNo', label: 'Activity number', type: 'number', value: task.activityNo, disabled: dis('activityNo') },
    { name: 'sequence', label: 'Sequence', type: 'number', value: task.sequence, disabled: dis('sequence') },
    { name: 'department', label: 'Department', type: 'select', options: departments.map((d) => ({ value: d, label: d })), value: task.department, disabled: dis('department') },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), value: task.priority, disabled: dis('priority') },
    { name: 'fprId', label: 'FPR', type: 'select', options: noOne.concat(stks), value: task.fprId || '', disabled: dis('fprId') },
    { name: 'backupFprId', label: 'Backup FPR', type: 'select', options: noOne.concat(stks), value: task.backupFprId || '', disabled: dis('backupFprId') },
    { name: 'approverId', label: 'Approver', type: 'select', options: noOne.concat(stks), value: task.approverId || '', disabled: dis('approverId') },
    { name: 'expectedDuration', label: 'Expected duration (working days)', type: 'number', min: 0, value: task.expectedDuration, disabled: dis('expectedDuration'), hint: '0 = milestone' },
    { name: 'manualPlannedStart', label: 'Pin planned start (optional)', type: 'date', value: task.manualPlannedStart || '', disabled: dis('manualPlannedStart'), hint: 'Overrides computed start unless a dependency forbids it' },
    { name: 'isMandatory', label: 'Mandatory for project closure', type: 'checkbox', value: task.isMandatory, disabled: dis('isMandatory') },
    { name: 'approvalRequired', label: 'Approval required', type: 'checkbox', value: task.approvalRequired, disabled: dis('approvalRequired') },
    { name: 'description', label: 'Description', type: 'textarea', value: task.description, disabled: dis('description'), span2: true },
    { name: 'instructions', label: 'Instructions', type: 'textarea', value: task.instructions, disabled: dis('instructions'), span2: true },
  ];
  const r = await formModal({
    title: `Edit task – ${task.name}`, fields, wide: true,
    intro: allowed ? el('div', { class: 'notice info' }, `Your role (${auth.user.role}) can edit: ${Array.from(allowed).join(', ')}. Other fields are shown read-only.`) : null,
    onSubmit: async (v) => {
      const changes = {};
      for (const f of fields) {
        if (f.disabled) continue;
        let val = v[f.name];
        if (['fprId', 'backupFprId', 'approverId'].includes(f.name)) val = val || null;
        if (f.name === 'manualPlannedStart') val = val || null;
        if (JSON.stringify(val) !== JSON.stringify(task[f.name] ?? (f.type === 'multiselect' ? [] : null)) && !(val === null && task[f.name] == null)) changes[f.name] = val;
      }
      if (!Object.keys(changes).length) return true;
      if ('expectedDuration' in changes || 'manualPlannedStart' in changes) {
        const preview = actions.previewImpact(task.projectId, { taskChanges: { [task.id]: changes } });
        if (preview.errors.length) throw new Error(preview.errors.join('\n'));
        if (!(await confirmImpact(ctx, preview.impact, 'Edit task'))) return null;
      }
      await actions.updateTask(task.id, changes, { expectedVersion: task.version });
      toast('Task updated', 'success');
      return true;
    },
  });
  return Boolean(r);
}

export async function addTaskForm(ctx, projectId) {
  const { store, actions } = ctx;
  const stks = store.all(COLLECTIONS.stakeholders).filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: `${s.employeeName} (${s.department})` }));
  const departments = Array.from(new Set(store.all(COLLECTIONS.stakeholders).map((s) => s.department).concat(store.all(COLLECTIONS.activityMaster).map((a) => a.department)))).sort();
  const tasks = store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId);
  const r = await formModal({
    title: 'Add project-specific task', wide: true,
    fields: [
      { name: 'name', label: 'Task name', required: true, span2: true },
      { name: 'department', label: 'Department', type: 'select', options: departments.map((d) => ({ value: d, label: d })), required: true },
      { name: 'fprId', label: 'FPR', type: 'select', options: [{ value: '', label: '— none —' }].concat(stks) },
      { name: 'approverId', label: 'Approver', type: 'select', options: [{ value: '', label: '— none —' }].concat(stks) },
      { name: 'expectedDuration', label: 'Expected duration (working days)', type: 'number', min: 0, value: 1, required: true },
      { name: 'sequence', label: 'Sequence (position)', type: 'number', value: Math.max(0, ...tasks.map((t) => Number(t.sequence) || 0)) + 1 },
      { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), value: 'Medium' },
      { name: 'predecessorIds', label: 'Predecessors (FS, lag 0 – edit later for other types)', type: 'multiselect', options: tasks.filter((t) => t.isActive !== false).sort((a, b) => a.sequence - b.sequence).map((t) => ({ value: t.id, label: `${t.activityNo} · ${t.name}` })), span2: true },
      { name: 'isMandatory', label: 'Mandatory', type: 'checkbox', value: true },
      { name: 'approvalRequired', label: 'Approval required', type: 'checkbox', value: false },
      { name: 'description', label: 'Description', type: 'textarea', span2: true },
      { name: 'instructions', label: 'Instructions', type: 'textarea', span2: true },
    ],
    onSubmit: async (v) => {
      const { predecessorIds, ...data } = v;
      data.fprId = data.fprId || null; data.approverId = data.approverId || null;
      const t = await actions.addTask(projectId, data);
      for (const p of predecessorIds || []) await actions.addDependency(projectId, t.id, p, 'FS', 0);
      toast(`Task "${t.name}" added`, 'success');
      return t;
    },
  });
  return r;
}
