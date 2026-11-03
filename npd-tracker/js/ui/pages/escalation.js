// Escalation Centre: read-only view of tasks that need attention (no e-mail features).
import { el, table, fmt, statusBadge, badge } from '../components.js';
import { enrichedTasks, isOpenTask } from '../taskQuery.js';
import { PERF_STATUS, TASK_STATUS } from '../../core/models.js';
import { diffWorkingDays, today } from '../../core/calendar.js';

export function render(ctx, root) {
  const { store } = ctx;
  const cal = store.calendar(); const cfg = store.config();
  const soon = Number(cfg.dueSoonThresholdDays ?? 2);
  const tasks = enrichedTasks(store).filter(isOpenTask);
  const t0 = today();
  const overdue = tasks.filter((t) => t.perf === PERF_STATUS.OVERDUE);
  const dueToday = tasks.filter((t) => t.plannedEnd === t0);
  const dueSoon = tasks.filter((t) => { const d = diffWorkingDays(t0, t.plannedEnd, cal); return d > 0 && d <= soon; });
  const blocked = tasks.filter((t) => t.perf === PERF_STATUS.BLOCKED);
  const pendingApproval = tasks.filter((t) => t.status === TASK_STATUS.PENDING_APPROVAL);
  const cols = (extra = []) => [
    { key: 'projectCode', label: 'Project' }, { key: 'name', label: 'Task' }, { key: 'department', label: 'Dept' }, { key: 'fprName', label: 'FPR' },
    { key: 'plannedEnd', label: 'Planned end', render: (t) => fmt(t.plannedEnd) }, { key: 'delay', label: 'Delay (wd)', class: 'num', sortValue: (t) => t.metrics.delayDays, render: (t) => t.metrics.delayDays ? badge(t.metrics.delayDays, 'red') : '0' },
    { key: 'perf', label: 'Status', render: (t) => statusBadge(t.perf) }, ...extra,
  ];
  const section = (title, rows, color, extra) => el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', {}, title, ' ', badge(rows.length, color))), table(cols(extra), rows, { onRowClick: (t) => ctx.openTask(t.id), sortKey: 'plannedEnd', emptyText: 'None' }));
  root.append(
    el('div', { class: 'card' }, el('h3', {}, 'Tasks that need attention'), el('div', { class: 'small muted' }, `Overdue, due today, due within ${soon} working days, blocked, and waiting for approval. Click a task to open it. Thresholds are set in Audit & Configuration.`)),
    el('div', { class: 'kpis' }, [['Overdue', overdue.length, 'red'], ['Due today', dueToday.length, 'amber'], [`Due in next ${soon} wd`, dueSoon.length, 'amber'], ['Blocked', blocked.length, 'grey'], ['Approval pending', pendingApproval.length, 'purple']].map(([l, v, c]) => el('div', { class: `kpi ${c}` }, el('div', { class: 'kpi-label' }, l), el('div', { class: 'kpi-value' }, v)))),
    section('Overdue tasks', overdue, 'red'), section('Tasks due today', dueToday, 'amber'), section(`Tasks due in the next ${soon} working days`, dueSoon, 'amber'),
    section('Blocked tasks', blocked, 'grey', [{ key: 'blk', label: 'Waiting for', render: (t) => t.predecessors.filter((p) => p.status !== 'COMPLETED' && p.status !== 'NOT_REQUIRED').map((p) => p.name).join(', ') }]),
    section('Approval pending', pendingApproval, 'purple', [{ key: 'approverName', label: 'Approver' }, { key: 'submittedAt', label: 'Submitted', render: (t) => t.submittedAt ? new Date(t.submittedAt).toLocaleString() : '—' }]));
}
