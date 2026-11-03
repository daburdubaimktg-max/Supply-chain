import { el, chart, table, fmt, badge, COLOR_HEX, PALETTE } from '../components.js';
import { enrichedTasks, projectRows, isOpenTask } from '../taskQuery.js';
import { PERF_STATUS } from '../../core/models.js';
import { countsBy, avgBy } from '../../core/performance.js';
import { diffWorkingDays } from '../../core/calendar.js';

export function render(ctx, root) {
  const { store } = ctx;
  const tasks = enrichedTasks(store).filter((t) => t.isActive !== false && t.status !== 'NOT_REQUIRED');
  const projects = projectRows(store);
  const cal = store.calendar();
  const completed = tasks.filter((t) => t.status === 'COMPLETED');
  const grid = el('div', { class: 'grid grid-2' });
  const mk = (title) => { const c = el('div', { class: 'chart-box' }); grid.append(el('div', { class: 'card', style: { marginBottom: 0 } }, el('h3', {}, title), c)); return c; };
  const groups = (keyFn) => { const g = new Map(); for (const t of tasks) { const k = keyFn(t); if (!g.has(k)) g.set(k, { total: 0, done: 0, onTime: 0, overdue: 0 }); const e = g.get(k); e.total += 1; if (t.status === 'COMPLETED') { e.done += 1; if (t.perf === PERF_STATUS.COMPLETED_ON_TIME) e.onTime += 1; } if (t.perf === PERF_STATUS.OVERDUE) e.overdue += 1; } return g; };
  const byFpr = groups((t) => t.fprName); const byDept = groups((t) => t.department);
  const stacked = (c, g) => chart(c, { type: 'bar', data: { labels: [...g.keys()], datasets: [{ label: 'Completed', data: [...g.values()].map((e) => e.done), backgroundColor: COLOR_HEX.green }, { label: 'Open', data: [...g.values()].map((e) => e.total - e.done), backgroundColor: COLOR_HEX.grey }] }, options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { precision: 0 } } } } });
  stacked(mk('FPR-wise task completion'), byFpr); stacked(mk('Department-wise completion'), byDept);
  const avgDur = avgBy(completed, (t) => t.department, (t) => t.metrics.actualDuration); const avgPlanned = avgBy(completed, (t) => t.department, (t) => t.metrics.plannedDuration);
  chart(mk('Average duration by department (planned vs actual, working days)'), { type: 'bar', data: { labels: [...avgDur.keys()], datasets: [{ label: 'Planned', data: [...avgDur.keys()].map((k) => avgPlanned.get(k) || 0), backgroundColor: COLOR_HEX.blue }, { label: 'Actual', data: [...avgDur.values()], backgroundColor: COLOR_HEX.amber }] } });
  const avgDelay = avgBy(tasks.filter((t) => t.metrics.delayDays != null), (t) => t.fprName, (t) => t.metrics.delayDays);
  chart(mk('Average delay by FPR (working days)'), { type: 'bar', data: { labels: [...avgDelay.keys()], datasets: [{ label: 'Avg delay', data: [...avgDelay.values()], backgroundColor: COLOR_HEX.red }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
  const ot = [...byDept.entries()].map(([k, e]) => [k, e.done ? Math.round((e.onTime / e.done) * 100) : 0]);
  chart(mk('On-time completion % by department'), { type: 'bar', data: { labels: ot.map((x) => x[0]), datasets: [{ label: 'On-time %', data: ot.map((x) => x[1]), backgroundColor: COLOR_HEX.green }] }, options: { plugins: { legend: { display: false } }, scales: { y: { max: 100 } } } });
  const od = countsBy(tasks.filter((t) => t.perf === PERF_STATUS.OVERDUE), (t) => t.fprName);
  chart(mk('Overdue tasks by FPR'), { type: 'bar', data: { labels: [...od.keys()], datasets: [{ label: 'Overdue', data: [...od.values()], backgroundColor: COLOR_HEX.red }] }, options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { precision: 0 } } } } });
  const pd = countsBy(tasks.filter(isOpenTask), (t) => t.department);
  chart(mk('Pending tasks by department'), { type: 'doughnut', data: { labels: [...pd.keys()], datasets: [{ data: [...pd.values()], backgroundColor: PALETTE }] } });
  const pv = projects.filter((p) => p.actualStartDate && p.plannedEndDate);
  chart(mk('Planned vs actual / forecast project duration (working days)'), { type: 'bar', data: { labels: pv.map((p) => p.projectCode), datasets: [{ label: 'Planned', data: pv.map((p) => diffWorkingDays(p.anchorDate || p.actualStartDate, p.plannedEndDate, cal)), backgroundColor: COLOR_HEX.blue }, { label: p => 'Actual / forecast', data: pv.map((p) => diffWorkingDays(p.actualStartDate, p.actualEndDate || p.forecastEndDate || p.plannedEndDate, cal)), backgroundColor: COLOR_HEX.amber }].map((d) => ({ ...d, label: typeof d.label === 'function' ? 'Actual / forecast' : d.label })) } });
  root.append(el('div', { class: 'kpis' },
    el('div', { class: 'kpi green' }, el('div', { class: 'kpi-label' }, 'On-time completion'), el('div', { class: 'kpi-value' }, `${completed.length ? Math.round((completed.filter((t) => t.perf === PERF_STATUS.COMPLETED_ON_TIME).length / completed.length) * 100) : 0}%`)),
    el('div', { class: 'kpi amber' }, el('div', { class: 'kpi-label' }, 'Avg task delay (open, wd)'), el('div', { class: 'kpi-value' }, (tasks.filter(isOpenTask).reduce((s, t) => s + (t.metrics.delayDays || 0), 0) / Math.max(1, tasks.filter(isOpenTask).length)).toFixed(1))),
    el('div', { class: 'kpi red' }, el('div', { class: 'kpi-label' }, 'Overdue tasks'), el('div', { class: 'kpi-value' }, tasks.filter((t) => t.perf === PERF_STATUS.OVERDUE).length)),
    el('div', { class: 'kpi blue' }, el('div', { class: 'kpi-label' }, 'Launch-date adherence'), el('div', { class: 'kpi-value' }, `${projects.filter((p) => p.launchDate).length ? Math.round((projects.filter((p) => p.launchDate && (p.actualEndDate ? p.actualEndDate <= p.launchDate : (p.plannedEndDate || '') <= p.launchDate)).length / projects.filter((p) => p.launchDate).length) * 100) : 0}%`))),
  grid,
  el('div', { class: 'card mt' }, el('h3', {}, 'Launch-date adherence by project'), table([
    { key: 'projectCode', label: 'Project' }, { key: 'name', label: 'Name' }, { key: 'brand', label: 'Brand' }, { key: 'launchDate', label: 'Launch', render: (p) => fmt(p.launchDate) }, { key: 'plannedEndDate', label: 'Planned end', render: (p) => fmt(p.plannedEndDate) }, { key: 'forecastEndDate', label: 'Forecast end', render: (p) => fmt(p.forecastEndDate) }, { key: 'actualEndDate', label: 'Actual end', render: (p) => fmt(p.actualEndDate) },
    { key: 'adh', label: 'Adherence', render: (p) => { if (!p.launchDate) return el('span', { class: 'muted' }, 'no launch date'); const ref = p.actualEndDate || p.forecastEndDate || p.plannedEndDate; const d = diffWorkingDays(p.launchDate, ref, cal); return d <= 0 ? badge(`On time (${-d} wd buffer)`, 'green') : badge(`${d} wd late`, 'red'); } },
  ], projects, { onRowClick: (p) => ctx.nav(`project/${p.id}`) })));
}
