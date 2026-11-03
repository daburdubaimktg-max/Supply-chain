import { el, table, fmt, statusBadge, badge, guard, toast } from '../components.js';
import { enrichedTasks, isOpenTask } from '../taskQuery.js';
import { COLLECTIONS, PERF_STATUS, TASK_STATUS, NOTIFICATION_TYPES } from '../../core/models.js';
import { diffWorkingDays, today } from '../../core/calendar.js';
import { ACTIONS } from '../../core/auth.js';

export function render(ctx, root) {
  const { store, actions, auth } = ctx;
  const cal = store.calendar(); const cfg = store.config();
  const tasks = enrichedTasks(store).filter(isOpenTask);
  const t0 = today();
  const esc = new Map();
  for (const n of store.all(COLLECTIONS.notificationLog).filter((n) => n.type === NOTIFICATION_TYPES.ESCALATION)) esc.set(n.taskId, Math.max(esc.get(n.taskId) || 0, n.payload?.escalationLevel || 1));
  const overdue = tasks.filter((t) => t.perf === PERF_STATUS.OVERDUE);
  const dueToday = tasks.filter((t) => t.plannedEnd === t0);
  const dueSoon = tasks.filter((t) => { const d = diffWorkingDays(t0, t.plannedEnd, cal); return d > 0 && d <= Number(cfg.reminderBeforeDays ?? 2); });
  const blocked = tasks.filter((t) => t.perf === PERF_STATUS.BLOCKED);
  const pendingApproval = tasks.filter((t) => t.status === TASK_STATUS.PENDING_APPROVAL);
  const escalated = overdue.filter((t) => esc.has(t.id) || diffWorkingDays(t.plannedEnd, t0, cal) > Number(cfg.escalationAfterDays ?? 3));
  const cols = (extra = []) => [
    { key: 'projectCode', label: 'Project' }, { key: 'name', label: 'Task' }, { key: 'department', label: 'Dept' }, { key: 'fprName', label: 'FPR' },
    { key: 'plannedEnd', label: 'Planned end', render: (t) => fmt(t.plannedEnd) }, { key: 'delay', label: 'Delay (wd)', class: 'num', sortValue: (t) => t.metrics.delayDays, render: (t) => t.metrics.delayDays ? badge(t.metrics.delayDays, 'red') : '0' },
    { key: 'perf', label: 'Status', render: (t) => statusBadge(t.perf) }, ...extra,
  ];
  const section = (title, rows, color, extra) => el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', {}, title, ' ', badge(rows.length, color))), table(cols(extra), rows, { onRowClick: (t) => ctx.openTask(t.id), sortKey: 'plannedEnd', emptyText: 'None 🎉' }));
  const notes = store.all(COLLECTIONS.notificationLog).slice().reverse();
  root.append(
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, 'Reminder & escalation rules'), el('div', { class: 'small muted' }, `Reminder ${cfg.reminderBeforeDays} working days before deadline · due-today reminder · overdue e-mail daily · escalation after ${cfg.escalationAfterDays} working days (${(cfg.escalationLevels || []).map((l) => `L${l.level}: ${l.afterDays}d → ${l.recipient}`).join(', ')})`)),
      el('div', { class: 'btn-group' }, el('span', { class: 'badge amber' }, cfg.emailAutomation === 'powerautomate' ? 'Queued for Power Automate' : 'PROTOTYPE: logged, not e-mailed'), auth.can(ACTIONS.ESCALATE) || auth.isAdmin() ? el('button', { class: 'btn btn-sm btn-primary', onClick: guard(async () => { const c = await actions.notifier.runScheduledChecks(); toast(`${c.length} new notification(s) logged`, 'success'); }) }, '▶ Run scheduled checks now') : null))),
    el('div', { class: 'kpis' }, [['Overdue', overdue.length, 'red'], ['Due today', dueToday.length, 'amber'], [`Due in next ${cfg.reminderBeforeDays} wd`, dueSoon.length, 'amber'], ['Blocked', blocked.length, 'grey'], ['Approval pending', pendingApproval.length, 'purple'], ['Escalated', escalated.length, 'red']].map(([l, v, c]) => el('div', { class: `kpi ${c}` }, el('div', { class: 'kpi-label' }, l), el('div', { class: 'kpi-value' }, v)))),
    section('Overdue tasks', overdue, 'red'), section('Tasks due today', dueToday, 'amber'), section(`Tasks due in the next ${cfg.reminderBeforeDays} working days`, dueSoon, 'amber'),
    section('Blocked tasks', blocked, 'grey', [{ key: 'blk', label: 'Waiting for', render: (t) => t.predecessors.filter((p) => p.status !== 'COMPLETED' && p.status !== 'NOT_REQUIRED').map((p) => p.name).join(', ') }]),
    section('Approval pending', pendingApproval, 'purple', [{ key: 'approverName', label: 'Approver' }, { key: 'submittedAt', label: 'Submitted', render: (t) => t.submittedAt ? new Date(t.submittedAt).toLocaleString() : '—' }]),
    section('Escalated tasks', escalated, 'red', [{ key: 'lvl', label: 'Level', render: (t) => `L${esc.get(t.id) || 1}` }, { key: 'to', label: 'Escalated to', render: (t) => store.get(COLLECTIONS.stakeholders, t.escalationId || store.get(COLLECTIONS.stakeholders, t.fprId)?.managerId)?.employeeName || '—' }]),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', {}, `E-mail notification history (${notes.length})`)),
      table([
        { key: 'timestamp', label: 'When', render: (n) => new Date(n.timestamp).toLocaleString() }, { key: 'type', label: 'Type', render: (n) => badge(n.type.replace(/_/g, ' '), { OVERDUE: 'red', ESCALATION: 'red', UPCOMING_REMINDER: 'amber', DUE_TODAY: 'amber', TASK_COMPLETED: 'green', APPROVAL_REQUESTED: 'purple' }[n.type] || 'blue') },
        { key: 'subject', label: 'Subject' }, { key: 'recipient', label: 'To' }, { key: 'cc', label: 'CC' }, { key: 'emailStatus', label: 'E-mail status', render: (n) => badge(n.emailStatus, n.emailStatus === 'SENT' ? 'green' : n.emailStatus === 'FAILED' ? 'red' : 'outline') }, { key: 'errorDetails', label: 'Error' },
        { key: 'open', label: '', sortable: false, render: (n) => n.taskId ? el('button', { class: 'btn btn-xs', onClick: () => ctx.openTask(n.taskId, { tab: 'notifications' }) }, 'Task') : null },
      ], notes, { maxRows: 300 })));
}
