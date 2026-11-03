import { el, table, fmt, statusBadge, badge, filterBar, guard, toast, promptDialog, confirmDialog } from '../components.js';
import { enrichedTasks, isOpenTask } from '../taskQuery.js';
import { COLLECTIONS, PERF_STATUS, TASK_STATUS, APPROVAL_STATUS } from '../../core/models.js';
import { ACTIONS } from '../../core/auth.js';
import { editTask } from '../taskPanel.js';

export function render(ctx, root, { query }) {
  const { store, auth, actions, excel } = ctx;
  const state = ctx.state.tasks || (ctx.state.tasks = { q: '', project: '', brand: '', department: '', fpr: '', perf: '', status: '', mine: '' });
  for (const k of ['q', 'project', 'department', 'fpr', 'perf', 'status']) if (query[k] != null) state[k] = query[k];
  const projects = store.all(COLLECTIONS.projects);
  const all = enrichedTasks(store);
  const body = el('div');
  const draw = () => {
    const q = state.q.toLowerCase();
    const rows = all.filter((t) => (!q || `${t.projectCode} ${t.projectName} ${t.name} ${t.fprName} ${t.department} ${t.activityNo}`.toLowerCase().includes(q))
      && (!state.project || t.projectId === state.project) && (!state.brand || t.brand === state.brand) && (!state.department || t.department === state.department) && (!state.fpr || t.fprId === state.fpr)
      && (!state.perf || t.perf === state.perf) && (!state.status || (state.status === 'open' ? isOpenTask(t) : t.status === state.status))
      && (!state.mine || t.fprId === auth.user.id || t.approverId === auth.user.id || t.backupFprId === auth.user.id));
    const act = (t) => {
      const b = [];
      const c = (a) => auth.can(a, { task: t.task });
      const run = (fn, msg) => guard(async () => { await fn(); if (msg) toast(msg, 'success'); });
      if ([TASK_STATUS.NOT_STARTED, TASK_STATUS.BLOCKED].includes(t.status) && c(ACTIONS.START_TASK)) b.push(el('button', { class: 'btn btn-xs btn-primary', disabled: t.perf === PERF_STATUS.BLOCKED, title: t.perf === PERF_STATUS.BLOCKED ? 'Blocked by predecessors' : '', onClick: run(() => actions.startTask(t.id), 'Started') }, 'Start'));
      if (t.status === TASK_STATUS.IN_PROGRESS && t.approvalRequired && t.approvalStatus !== APPROVAL_STATUS.APPROVED && c(ACTIONS.SUBMIT_TASK)) b.push(el('button', { class: 'btn btn-xs btn-primary', onClick: run(() => actions.submitForApproval(t.id), 'Submitted for approval') }, 'Submit'));
      if (t.status === TASK_STATUS.IN_PROGRESS && (!t.approvalRequired || t.approvalStatus === APPROVAL_STATUS.APPROVED || c(ACTIONS.APPROVE_TASK)) && c(ACTIONS.COMPLETE_TASK)) b.push(el('button', { class: 'btn btn-xs btn-success', onClick: guard(async () => { if (await confirmDialog({ title: 'Complete task', message: `Complete "${t.name}"?`, okText: 'Complete', okClass: 'btn-success' })) { await actions.completeTask(t.id); toast('Completed', 'success'); } }) }, 'Complete'));
      if (t.status === TASK_STATUS.PENDING_APPROVAL && c(ACTIONS.APPROVE_TASK)) {
        b.push(el('button', { class: 'btn btn-xs btn-success', onClick: run(() => actions.approveTask(t.id), 'Approved') }, 'Approve'));
        b.push(el('button', { class: 'btn btn-xs btn-danger', onClick: guard(async () => { const r = await promptDialog({ title: 'Reject task', label: 'Reason' }); if (r) { await actions.rejectTask(t.id, r); toast('Rejected', 'warn'); } }) }, 'Reject'));
      }
      if (t.status === TASK_STATUS.COMPLETED && c(ACTIONS.REOPEN_TASK)) b.push(el('button', { class: 'btn btn-xs btn-warn', onClick: guard(async () => { const r = await promptDialog({ title: 'Reopen task', label: 'Reason' }); if (r) { await actions.reopenTask(t.id, r); toast('Reopened', 'warn'); } }) }, 'Reopen'));
      if (c(ACTIONS.EDIT_TASK)) b.push(el('button', { class: 'btn btn-xs', onClick: () => editTask(ctx, t.task) }, 'Edit'));
      b.push(el('button', { class: 'btn btn-xs', onClick: () => ctx.openTask(t.id, { tab: 'history' }) }, 'History'));
      return el('div', { class: 'btn-group' }, b);
    };
    body.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, `Tasks (${rows.length})`), el('div', { class: 'btn-group' },
        el('label', { class: 'small flex' }, el('input', { type: 'checkbox', checked: Boolean(state.mine), onChange: (e) => { state.mine = e.target.checked ? '1' : ''; draw(); } }), ' My tasks only'),
        state.project ? el('button', { class: 'btn btn-sm', onClick: guard(async () => excel.exportProjectTasks(state.project)) }, '⬇ Export tasks (Excel)') : el('span', { class: 'small muted' }, 'Select a project to export'))),
      table([
        { key: 'projectCode', label: 'Project', class: 'nowrap', render: (t) => el('span', { title: t.projectName }, t.projectCode) }, { key: 'brand', label: 'Brand' },
        { key: 'activityNo', label: '#', class: 'num' }, { key: 'name', label: 'Activity', render: (t) => el('span', {}, t.name, t.isCritical ? [' ', badge('CP', 'red')] : null, !t.isMandatory ? [' ', badge('optional', 'outline')] : null) },
        { key: 'department', label: 'Department' }, { key: 'fprName', label: 'FPR' }, { key: 'predecessorText', label: 'Preds', class: 'nowrap' },
        { key: 'plannedStart', label: 'Planned start', render: (t) => fmt(t.plannedStart) }, { key: 'plannedEnd', label: 'Planned end', render: (t) => fmt(t.plannedEnd) },
        { key: 'actualStart', label: 'Actual start', render: (t) => fmt(t.actualStart) }, { key: 'actualEnd', label: 'Actual completion', render: (t) => fmt(t.actualEnd) },
        { key: 'expectedDuration', label: 'Exp. days', class: 'num' }, { key: 'actualDuration', label: 'Act. days', class: 'num', sortValue: (t) => t.metrics.actualDuration, render: (t) => t.metrics.actualDuration ?? '—' },
        { key: 'delay', label: 'Delay', class: 'num', sortValue: (t) => t.metrics.delayDays, render: (t) => t.metrics.delayDays ? badge(t.metrics.delayDays, 'red') : '0' },
        { key: 'perf', label: 'Task status', render: (t) => statusBadge(t.perf) }, { key: 'approvalStatus', label: 'Approval', render: (t) => t.approvalRequired ? badge(t.approvalStatus.replace(/_/g, ' '), { APPROVED: 'green', PENDING_APPROVAL: 'purple', REJECTED: 'red' }[t.approvalStatus] || 'grey') : el('span', { class: 'muted small' }, 'n/a') },
        { key: 'actions', label: 'Actions', sortable: false, class: 'actions', render: act },
      ], rows, { onRowClick: (t) => ctx.openTask(t.id), sortKey: 'plannedStart', rowClass: (t) => t.isActive === false ? 'inactive' : '' })));
  };
  root.append(filterBar([
    { key: 'q', label: 'Search', placeholder: 'task, project, FPR…' },
    { key: 'project', label: 'Project', type: 'select', options: projects.map((p) => ({ value: p.id, label: `${p.projectCode} ${p.name}` })), allLabel: 'All projects' },
    { key: 'brand', label: 'Brand', type: 'select', options: Array.from(new Set(projects.map((p) => p.brand))).sort().map((b) => ({ value: b, label: b })), allLabel: 'All brands' },
    { key: 'department', label: 'Department', type: 'select', options: Array.from(new Set(all.map((t) => t.department))).sort().map((d) => ({ value: d, label: d })), allLabel: 'All departments' },
    { key: 'fpr', label: 'FPR', type: 'select', options: store.all(COLLECTIONS.stakeholders).map((s) => ({ value: s.id, label: s.employeeName })), allLabel: 'All FPRs' },
    { key: 'perf', label: 'Performance', type: 'select', options: Object.values(PERF_STATUS).map((s) => ({ value: s, label: s })), allLabel: 'All' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open (not completed)' }].concat(Object.values(TASK_STATUS).map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))), allLabel: 'All' },
  ], state, draw), body);
  draw();
}
