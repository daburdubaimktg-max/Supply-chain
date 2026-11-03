import { el, kpi, chart, filterBar, PALETTE, COLOR_HEX } from '../components.js';
import { COLLECTIONS, PERF_STATUS, PROJECT_STATUS } from '../../core/models.js';
import { enrichedTasks, projectRows, isOpenTask } from '../taskQuery.js';
import { countsBy, avgBy } from '../../core/performance.js';

export function render(ctx, root) {
  const { store, nav } = ctx;
  const state = ctx.state.exec || (ctx.state.exec = { project: '', brand: '', department: '', fpr: '', from: '', to: '' });
  const projects = projectRows(store);
  const allTasks = enrichedTasks(store);
  const stks = store.all(COLLECTIONS.stakeholders);

  const draw = () => {
    body.replaceChildren();
    const tasks = allTasks.filter((t) => (!state.project || t.projectId === state.project) && (!state.brand || t.brand === state.brand) && (!state.department || t.department === state.department) && (!state.fpr || t.fprId === state.fpr)
      && (!state.from || (t.plannedEnd || '') >= state.from) && (!state.to || (t.plannedStart || '') <= state.to));
    const pids = new Set(tasks.map((t) => t.projectId));
    const prjs = projects.filter((p) => pids.has(p.id) || (!tasks.length && !state.project && !state.brand && !state.department && !state.fpr));
    const active = tasks.filter((t) => t.isActive !== false && t.status !== 'NOT_REQUIRED');
    const completed = active.filter((t) => t.status === 'COMPLETED');
    const overdue = active.filter((t) => t.perf === PERF_STATUS.OVERDUE);
    const blocked = active.filter((t) => t.perf === PERF_STATUS.BLOCKED);
    const pending = active.filter(isOpenTask);
    const pct = active.length ? Math.round((completed.length / active.length) * 100) : 0;
    const q = (extra) => `tasks?${new URLSearchParams({ ...(state.project ? { project: state.project } : {}), ...(state.department ? { department: state.department } : {}), ...(state.fpr ? { fpr: state.fpr } : {}), ...extra })}`;
    body.append(el('div', { class: 'kpis' },
      kpi('Total projects', prjs.length, '', () => nav('portfolio')),
      kpi('Active projects', prjs.filter((p) => [PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.PLANNING].includes(p.status)).length, 'blue', () => nav('portfolio?status=active')),
      kpi('Completed projects', prjs.filter((p) => p.status === PROJECT_STATUS.COMPLETED).length, 'green', () => nav('portfolio?status=COMPLETED')),
      kpi('Delayed projects', prjs.filter((p) => p.summary.isDelayed).length, 'red', () => nav('portfolio?flag=delayed')),
      kpi('Projects at risk', prjs.filter((p) => !p.summary.isDelayed && (p.summary.atRisk > 0 || p.summary.launchRisk) && p.status !== PROJECT_STATUS.COMPLETED).length, 'amber', () => nav('portfolio?flag=risk')),
      kpi('Total tasks', active.length, 'grey', () => nav(q({}))),
      kpi('Completed tasks', completed.length, 'green', () => nav(q({ status: 'COMPLETED' }))),
      kpi('Pending tasks', pending.length, 'blue', () => nav(q({ status: 'open' }))),
      kpi('Overdue tasks', overdue.length, 'red', () => nav(q({ perf: PERF_STATUS.OVERDUE }))),
      kpi('Blocked tasks', blocked.length, 'grey', () => nav(q({ perf: PERF_STATUS.BLOCKED }))),
      kpi('Overall completion', `${pct}%`, 'green')));

    const box = (title, w = 1) => { const c = el('div', { class: 'chart-box' }); body.append(el('div', { class: 'card', style: { gridColumn: `span ${w}` } }, el('h3', {}, title), c)); return c; };
    const grid = el('div', { class: 'grid grid-3' }); body.append(grid);
    const mk = (title) => { const c = el('div', { class: 'chart-box' }); grid.append(el('div', { class: 'card', style: { marginBottom: 0 } }, el('h3', {}, title), c)); return c; };
    void box;
    const ps = countsBy(prjs, (p) => p.status.replace(/_/g, ' '));
    chart(mk('Project status distribution'), { type: 'doughnut', data: { labels: [...ps.keys()], datasets: [{ data: [...ps.values()], backgroundColor: [...ps.keys()].map((k) => ({ 'IN PROGRESS': COLOR_HEX.blue, COMPLETED: COLOR_HEX.green, PLANNING: COLOR_HEX.grey, 'ON HOLD': COLOR_HEX.amber, CANCELLED: COLOR_HEX.red }[k] || '#999')) }] } });
    const bc = countsBy(prjs, (p) => p.brand);
    chart(mk('Brand-wise project count'), { type: 'bar', data: { labels: [...bc.keys()], datasets: [{ label: 'Projects', data: [...bc.values()], backgroundColor: PALETTE[0] }] }, options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } } } } });
    const dp = countsBy(pending, (t) => t.department);
    chart(mk('Department-wise pending tasks'), { type: 'bar', data: { labels: [...dp.keys()], datasets: [{ label: 'Pending', data: [...dp.values()], backgroundColor: PALETTE[4] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } } } } });
    const fp = countsBy(pending, (t) => t.fprName);
    chart(mk('FPR-wise open tasks'), { type: 'bar', data: { labels: [...fp.keys()], datasets: [{ label: 'Open', data: [...fp.values()], backgroundColor: PALETTE[5] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } } } } });
    const onTime = completed.filter((t) => t.perf === PERF_STATUS.COMPLETED_ON_TIME).length; const late = completed.length - onTime; const delayedOpen = pending.filter((t) => t.metrics.delayDays > 0).length;
    chart(mk('On-time vs delayed tasks'), { type: 'pie', data: { labels: ['Completed on time', 'Completed late', 'Open & delayed', 'Open on track'], datasets: [{ data: [onTime, late, delayedOpen, pending.length - delayedOpen], backgroundColor: [COLOR_HEX.green, COLOR_HEX.red, COLOR_HEX.amber, COLOR_HEX.blue] }] } });
    const months = new Map();
    for (const p of prjs.filter((p) => p.actualEndDate)) { const k = p.actualEndDate.slice(0, 7); months.set(k, (months.get(k) || 0) + 1); }
    for (const t of completed) { const k = (t.actualEnd || '').slice(0, 7); if (k) months.set(k, months.get(k) || 0); }
    const mk2 = [...months.keys()].sort();
    chart(mk('Monthly project completion'), { type: 'line', data: { labels: mk2, datasets: [{ label: 'Projects closed', data: mk2.map((k) => months.get(k)), borderColor: COLOR_HEX.green, backgroundColor: COLOR_HEX.green, tension: .3 }, { label: 'Tasks completed', data: mk2.map((k) => completed.filter((t) => (t.actualEnd || '').startsWith(k)).length), borderColor: COLOR_HEX.blue, tension: .3 }] }, options: { scales: { y: { ticks: { precision: 0 } } } } });
    const ad = avgBy(active.filter((t) => t.metrics.delayDays != null), (t) => t.department, (t) => t.metrics.delayDays);
    chart(mk('Average delay by department (working days)'), { type: 'bar', data: { labels: [...ad.keys()], datasets: [{ label: 'Avg delay', data: [...ad.values()], backgroundColor: COLOR_HEX.red }] }, options: { plugins: { legend: { display: false } } } });
  };

  const departments = Array.from(new Set(allTasks.map((t) => t.department))).sort();
  root.append(filterBar([
    { key: 'project', label: 'Project', type: 'select', options: projects.map((p) => ({ value: p.id, label: `${p.projectCode} ${p.name}` })), allLabel: 'All projects' },
    { key: 'brand', label: 'Brand', type: 'select', options: Array.from(new Set(projects.map((p) => p.brand))).sort().map((b) => ({ value: b, label: b })), allLabel: 'All brands' },
    { key: 'department', label: 'Department', type: 'select', options: departments.map((d) => ({ value: d, label: d })), allLabel: 'All departments' },
    { key: 'fpr', label: 'FPR', type: 'select', options: stks.map((s) => ({ value: s.id, label: s.employeeName })), allLabel: 'All FPRs' },
    { key: 'from', label: 'Planned end from', type: 'date' }, { key: 'to', label: 'Planned start to', type: 'date' },
  ], state, draw));
  const body = el('div'); root.append(body);
  draw();
}
