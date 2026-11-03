import { el, filterBar, guard } from '../components.js';
import { enrichedTasks } from '../taskQuery.js';
import { renderGantt } from '../gantt/ganttChart.js';
import { COLLECTIONS, PERF_STATUS } from '../../core/models.js';

export function render(ctx, root, { query }) {
  const { store, excel } = ctx;
  const projects = store.all(COLLECTIONS.projects);
  const state = ctx.state.gantt || (ctx.state.gantt = { project: projects[0]?.id || '', brand: '', department: '', fpr: '', perf: '', zoom: 'week', group: 'department' });
  if (query.project) state.project = query.project;
  if (!projects.find((p) => p.id === state.project)) state.project = projects[0]?.id || '';
  const all = enrichedTasks(store);
  const body = el('div');
  const draw = () => {
    body.replaceChildren();
    let rows = all.filter((t) => t.isActive !== false && (!state.project || t.projectId === state.project) && (!state.brand || t.brand === state.brand) && (!state.department || t.department === state.department) && (!state.fpr || t.fprId === state.fpr) && (!state.perf || t.perf === state.perf));
    if (!state.project) rows = rows.map((r) => ({ ...r, name: `${r.projectCode}: ${r.name}` }));
    const deps = store.all(COLLECTIONS.taskDependencies).filter((d) => !state.project || d.projectId === state.project);
    const p = store.get(COLLECTIONS.projects, state.project);
    body.append(el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('div', {}, el('h3', {}, p ? `${p.projectCode} · ${p.name}` : 'All projects'), p ? el('div', { class: 'small muted' }, `Scheduling: ${p.schedulingMode} · anchor ${p.anchorDate || '—'} · launch ${p.launchDate || '—'} · planned end ${p.plannedEndDate || '—'} · forecast end ${p.forecastEndDate || '—'}`) : null),
        el('div', { class: 'btn-group' },
          ['day', 'week', 'month'].map((z) => el('button', { class: `btn btn-sm ${state.zoom === z ? 'btn-primary' : ''}`, onClick: () => { state.zoom = z; draw(); } }, z[0].toUpperCase() + z.slice(1))),
          el('button', { class: 'btn btn-sm', onClick: () => { state.zoom = state.zoom === 'day' ? 'week' : 'month'; draw(); } }, '－ Zoom out'),
          el('button', { class: 'btn btn-sm', onClick: () => { state.zoom = state.zoom === 'month' ? 'week' : 'day'; draw(); } }, '＋ Zoom in'),
          el('select', { style: { width: 'auto' }, onChange: (e) => { state.group = e.target.value; draw(); } }, [['department', 'Group: department'], ['projectCode', 'Group: project'], ['fprName', 'Group: FPR'], ['', 'No grouping']].map(([v, l]) => el('option', { value: v, selected: state.group === v }, l))),
          p ? el('button', { class: 'btn btn-sm', onClick: guard(async () => excel.exportGantt(p.id)) }, '⬇ Export Gantt') : null)),
      (() => { const c = el('div'); renderGantt(c, rows, deps, { zoom: state.zoom, groupBy: state.group || null, onTaskClick: (r) => ctx.openTask(r.id) }); return c; })(),
      el('p', { class: 'small muted mt' }, 'Click a task row or bar to open it. Authorised users can change dates, durations, dependencies and FPR from the task panel; the chart refreshes automatically after every update.')));
  };
  const stks = store.all(COLLECTIONS.stakeholders);
  root.append(filterBar([
    { key: 'project', label: 'Project', type: 'select', options: projects.map((p) => ({ value: p.id, label: `${p.projectCode} ${p.name}` })), allLabel: 'All projects' },
    { key: 'brand', label: 'Brand', type: 'select', options: Array.from(new Set(projects.map((p) => p.brand))).sort().map((b) => ({ value: b, label: b })), allLabel: 'All brands' },
    { key: 'department', label: 'Department', type: 'select', options: Array.from(new Set(all.map((t) => t.department))).sort().map((d) => ({ value: d, label: d })), allLabel: 'All departments' },
    { key: 'fpr', label: 'FPR', type: 'select', options: stks.map((s) => ({ value: s.id, label: s.employeeName })), allLabel: 'All FPRs' },
    { key: 'perf', label: 'Status', type: 'select', options: Object.values(PERF_STATUS).map((s) => ({ value: s, label: s })), allLabel: 'All statuses' },
  ], state, draw), body);
  draw();
}
