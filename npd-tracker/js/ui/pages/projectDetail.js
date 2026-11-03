import { el, table, fmt, badge, progressBar, chart, guard, toast, confirmDialog, promptDialog, COLOR_HEX } from '../components.js';
import { COLLECTIONS, PROJECT_STATUS } from '../../core/models.js';
import { ACTIONS } from '../../core/auth.js';
import { enrichedTasks, projectRows } from '../taskQuery.js';
import { renderGantt } from '../gantt/ganttChart.js';
import { renderDepNetwork } from '../depNetwork.js';
import { editProjectForm, projectStatusBadge } from '../projectForms.js';
import { addTaskForm } from '../taskPanel.js';

export function render(ctx, root, { params }) {
  const { store, auth, actions, excel } = ctx;
  const p = projectRows(store).find((x) => x.id === params[0]);
  if (!p) { root.append(el('div', { class: 'empty' }, 'Project not found. ', el('a', { href: '#/portfolio' }, 'Back to portfolio'))); return; }
  const rows = enrichedTasks(store, { projectId: p.id }).sort((a, b) => a.sequence - b.sequence);
  const deps = store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === p.id);
  const s = p.summary; const closure = actions.projectClosureCheck(p.id);
  const kv = (k, v) => [el('dt', {}, k), el('dd', {}, v ?? '—')];
  const stname = (id) => store.get(COLLECTIONS.stakeholders, id)?.employeeName || '—';
  const deptStats = new Map();
  for (const t of rows.filter((t) => t.isActive !== false && t.status !== 'NOT_REQUIRED')) { const e = deptStats.get(t.department) || { total: 0, done: 0 }; e.total += 1; if (t.status === 'COMPLETED') e.done += 1; deptStats.set(t.department, e); }
  const gantt = el('div'); renderGantt(gantt, rows.filter((r) => r.isActive !== false), deps, { zoom: 'week', onTaskClick: (r) => ctx.openTask(r.id) });
  const net = el('div'); renderDepNetwork(net, rows.filter((r) => r.isActive !== false), deps, { onClick: (n) => ctx.openTask(n.id, { tab: 'dependencies' }) });
  const history = store.all(COLLECTIONS.taskHistory).filter((h) => h.projectId === p.id).slice().reverse();
  const approvals = store.all(COLLECTIONS.approvalHistory).filter((h) => h.projectId === p.id).slice().reverse();
  const comments = store.all(COLLECTIONS.comments).filter((c) => c.projectId === p.id && !c.taskId).slice().reverse();
  const taskName = (id) => rows.find((t) => t.id === id)?.name || id;
  const ta = el('textarea', { placeholder: 'Add a project comment…', style: { minHeight: '50px' } });
  const deptChart = el('div', { class: 'chart-box', style: { height: '200px' } });
  root.append(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('div', {}, el('div', { class: 'small muted' }, el('a', { href: '#/portfolio' }, '← Portfolio'), ` · ${p.projectCode}`, p.isSample ? [' ', badge('SAMPLE DATA', 'outline')] : null), el('h2', {}, p.name), el('div', { class: 'flex' }, projectStatusBadge(p), badge(p.kind, 'blue'), s.isDelayed ? badge('DELAYED', 'red') : null, s.launchRisk ? badge('LAUNCH AT RISK', 'amber') : null)),
        el('div', { class: 'btn-group' },
          auth.can(ACTIONS.EDIT_PROJECT) ? el('button', { class: 'btn btn-sm', onClick: () => editProjectForm(ctx, p.project) }, '✎ Edit project') : null,
          el('button', { class: 'btn btn-sm', onClick: () => ctx.nav(`project-config?project=${p.id}`) }, 'Configure tasks'), el('button', { class: 'btn btn-sm', onClick: () => ctx.nav(`dependencies?project=${p.id}`) }, 'Dependencies'), el('button', { class: 'btn btn-sm', onClick: () => ctx.nav(`gantt?project=${p.id}`) }, 'Full Gantt'),
          auth.can(ACTIONS.EDIT_TASK) ? el('button', { class: 'btn btn-sm', onClick: () => addTaskForm(ctx, p.id) }, '+ Add task') : null,
          el('button', { class: 'btn btn-sm', onClick: guard(async () => excel.exportProjectTasks(p.id)) }, '⬇ Export'),
          auth.isAdmin() ? el('button', { class: 'btn btn-sm', onClick: guard(async () => { const n = await promptDialog({ title: 'Save schedule baseline', label: 'Baseline name', multiline: false }); if (n) { await actions.saveBaseline(p.id, n); toast('Baseline saved', 'success'); } }) }, 'Save baseline') : null,
          auth.can(ACTIONS.CREATE_PROJECT) ? el('button', { class: 'btn btn-sm btn-danger', onClick: guard(async () => { if (await confirmDialog({ title: 'Delete project', message: `Delete ${p.projectCode} and all its tasks, dependencies and history links? This cannot be undone.`, danger: true, okText: 'Delete project' })) { await actions.deleteProject(p.id); toast('Project deleted', 'success'); ctx.nav('portfolio'); } }) }, 'Delete') : null)),
      el('div', { class: 'grid grid-3' },
        el('dl', { class: 'kv' }, kv('Brand', p.brand), kv('Category', p.category), kv('Category head', p.categoryHead), kv('Type', `${p.kind} · ${p.projectType || ''}`), kv('Size / variant', `${p.size || '—'} / ${p.variant || '—'}`), kv('Owner', p.ownerName), kv('Priority', p.priority), kv('Created', `${fmt(p.createdAt)} by ${p.createdBy}`)),
        el('dl', { class: 'kv' }, kv('Scheduling', `${p.schedulingMode} from ${p.schedulingMode === 'BACKWARD' ? 'launch date' : `anchor ${fmt(p.anchorDate)}`}`), kv('Launch date', fmt(p.launchDate)), kv('Actual start', p.actualStartDate ? `${fmt(p.actualStartDate)} (auto, by ${p.actualStartBy})` : badge('not started', 'grey')), kv('Planned end', fmt(p.plannedEndDate)), kv('Forecast end', fmt(p.forecastEndDate)), kv('Actual end', p.actualEndDate ? `${fmt(p.actualEndDate)} (auto, by ${p.actualEndBy})` : '—'), kv('Closure', closure.canClose ? badge('All mandatory tasks complete', 'green') : `${closure.open.length} mandatory open, ${closure.unapproved.length} awaiting approval`)),
        el('div', {}, el('h4', {}, 'Completion'), progressBar(s.completionPct), el('div', { class: 'small muted mt' }, `${s.completed}/${s.total} tasks · ${s.overdue} overdue · ${s.blocked} blocked · ${s.atRisk} at risk`), el('h4', { class: 'mt' }, 'Department-wise progress'), deptChart)),
      p.productDescription ? el('p', { class: 'mt' }, p.productDescription) : null,
      p.closureHistory?.length ? el('div', { class: 'mt small' }, el('h4', {}, 'Closure record'), el('ul', { class: 'plain' }, p.closureHistory.map((c) => el('li', {}, c.event === 'CLOSED' ? `Closed ${new Date(c.closedAt).toLocaleString()} by ${c.closedBy}` : `Reopened ${new Date(c.reopenedAt).toLocaleString()} by ${c.reopenedBy}: ${c.reason}`)))) : null),
    el('div', { class: 'card' }, el('h3', {}, 'Gantt chart'), gantt),
    el('div', { class: 'card' }, el('h3', {}, 'Task list'), table([
      { key: 'activityNo', label: '#', class: 'num' }, { key: 'name', label: 'Task' }, { key: 'department', label: 'Dept' }, { key: 'fprName', label: 'FPR' }, { key: 'predecessorText', label: 'Preds' },
      { key: 'plannedStart', label: 'Planned', render: (t) => `${fmt(t.plannedStart)} → ${fmt(t.plannedEnd)}` }, { key: 'actualStart', label: 'Actual', render: (t) => `${fmt(t.actualStart)} → ${fmt(t.actualEnd)}` }, { key: 'delay', label: 'Delay', class: 'num', render: (t) => t.metrics.delayDays || '0' }, { key: 'perf', label: 'Status', render: (t) => badge(t.perf, { OVERDUE: 'red', 'IN PROGRESS': 'blue', 'COMPLETED ON TIME': 'green', 'COMPLETED LATE': 'green', 'DUE SOON': 'amber', 'AT RISK': 'amber', 'PENDING APPROVAL': 'purple' }[t.perf] || 'grey') },
    ], rows, { onRowClick: (t) => ctx.openTask(t.id), sortKey: 'sequence', rowClass: (t) => t.isActive === false ? 'inactive' : '' })),
    el('div', { class: 'card' }, el('h3', {}, 'Dependency network'), net),
    el('div', { class: 'grid grid-2' },
      el('div', { class: 'card' }, el('h3', {}, `Task history (${history.length})`), el('ul', { class: 'timeline', style: { maxHeight: '360px', overflowY: 'auto' } }, history.slice(0, 200).map((h) => el('li', {}, el('div', { class: 'when' }, `${new Date(h.timestamp).toLocaleString()} · ${h.user}`), el('a', { href: '#', onClick: (e) => { e.preventDefault(); ctx.openTask(h.taskId, { tab: 'history' }); } }, taskName(h.taskId)), `: ${h.event.replace(/_/g, ' ')}${h.details ? ` – ${h.details}` : ''}`)))),
      el('div', {}, el('div', { class: 'card' }, el('h3', {}, `Approval history (${approvals.length})`), el('ul', { class: 'timeline', style: { maxHeight: '200px', overflowY: 'auto' } }, approvals.map((h) => el('li', {}, el('div', { class: 'when' }, `${new Date(h.timestamp).toLocaleString()} · ${h.by}`), `${taskName(h.taskId)}: ${h.action}${h.note ? ` – ${h.note}` : ''}`))), approvals.length ? null : el('p', { class: 'muted small' }, 'No approvals yet.')),
        el('div', { class: 'card' }, el('h3', {}, `Project comments (${comments.length})`), el('ul', { class: 'timeline' }, comments.map((c) => el('li', {}, el('div', { class: 'when' }, `${new Date(c.timestamp).toLocaleString()} · ${c.user}`), c.text))), auth.can(ACTIONS.ADD_COMMENT) ? el('div', {}, ta, el('button', { class: 'btn btn-sm mt', onClick: guard(async () => { await actions.addProjectComment(p.id, ta.value); toast('Comment added', 'success'); }) }, 'Add comment')) : null))));
  chart(deptChart, { type: 'bar', data: { labels: [...deptStats.keys()], datasets: [{ label: 'Done', data: [...deptStats.values()].map((e) => e.done), backgroundColor: COLOR_HEX.green }, { label: 'Open', data: [...deptStats.values()].map((e) => e.total - e.done), backgroundColor: COLOR_HEX.grey }] }, options: { indexAxis: 'y', scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true } }, plugins: { legend: { display: false } } } });
  void PROJECT_STATUS;
}
