import { el, table, badge, guard, toast, confirmDialog } from '../components.js';
import { COLLECTIONS, TASK_STATUS } from '../../core/models.js';
import { ACTIONS } from '../../core/auth.js';
import { enrichedTasks } from '../taskQuery.js';
import { addDependency, editDependency } from '../taskPanel.js';
import { renderDepNetwork } from '../depNetwork.js';
import { validateDependencies } from '../../core/dependencies.js';
import { projectSelector } from './projectConfig.js';

export function render(ctx, root, { query }) {
  const { store, auth, actions } = ctx;
  const state = ctx.state.deps || (ctx.state.deps = { project: '', focus: '' });
  if (query.project) state.project = query.project;
  const body = el('div');
  const draw = () => {
    body.replaceChildren();
    const p = store.get(COLLECTIONS.projects, state.project);
    if (!p) { body.append(el('div', { class: 'empty' }, 'No projects yet.')); return; }
    const rows = enrichedTasks(store, { projectId: p.id }).sort((a, b) => a.sequence - b.sequence);
    const deps = store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === p.id);
    const byId = new Map(rows.map((t) => [t.id, t]));
    const canEdit = auth.can(ACTIONS.EDIT_DEPENDENCIES);
    const errors = validateDependencies(rows.map((r) => r.task), deps, null, { projectId: p.id });
    const satisfied = (d) => { const pr = byId.get(d.predecessorId); if (!pr) return false; if (pr.status === TASK_STATUS.NOT_REQUIRED) return true; return (d.type === 'SS' || d.type === 'SF') ? Boolean(pr.actualStart) || pr.status === 'COMPLETED' : pr.status === 'COMPLETED'; };
    const depStatus = (t) => { const ps = deps.filter((d) => d.taskId === t.id); if (!ps.length) return badge('Independent', 'outline'); return ps.every(satisfied) ? badge('Ready', 'green') : badge(`Waiting (${ps.filter((d) => !satisfied(d)).length})`, 'amber'); };
    const net = el('div');
    renderDepNetwork(net, rows.filter((r) => r.isActive !== false), deps, { highlightId: state.focus, onClick: (n) => { state.focus = state.focus === n.id ? '' : n.id; draw(); } });
    body.append(
      errors.length ? el('div', { class: 'notice error' }, el('strong', {}, 'Invalid relationships detected:'), el('ul', { class: 'plain' }, errors.map((e) => el('li', {}, e)))) : el('div', { class: 'notice success' }, `All ${deps.length} dependency relationships are valid (no cycles, duplicates or invalid references).`),
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, `Dependency editor – ${p.projectCode} · ${p.name}`), el('span', { class: 'small muted' }, 'Click a row to focus it in the network · dependencies are per project')),
        table([
          { key: 'activityNo', label: '#', class: 'num' }, { key: 'name', label: 'Task' },
          { key: 'preds', label: 'Current predecessors', sortable: false, render: (t) => el('div', { class: 'flex' }, deps.filter((d) => d.taskId === t.id).map((d) => el('span', { class: `badge ${satisfied(d) ? 'green' : 'amber'}`, title: `${byId.get(d.predecessorId)?.name}` },
            `${byId.get(d.predecessorId)?.activityNo} ${d.type}${d.lagDays ? `+${d.lagDays}` : ''}`,
            canEdit ? [' ', el('a', { href: '#', title: 'Edit', onClick: (e) => { e.preventDefault(); editDependency(ctx, d, rows.map((r) => r.task)); } }, '✎'), ' ', el('a', { href: '#', title: 'Remove', onClick: guard(async (e) => { e.preventDefault(); if (await confirmDialog({ title: 'Remove predecessor', message: `Remove ${byId.get(d.predecessorId)?.name} as a predecessor of ${t.name}?`, danger: true, okText: 'Remove' })) { await actions.removeDependency(d.id); toast('Removed – schedule recalculated', 'success'); } }) }, '✕')] : null)),
            canEdit ? el('button', { class: 'btn btn-xs', onClick: () => addDependency(ctx, t.task, rows.map((r) => r.task)) }, '+ Add') : null) },
          { key: 'down', label: 'Downstream tasks', sortable: false, render: (t) => deps.filter((d) => d.predecessorId === t.id).map((d) => byId.get(d.taskId)?.activityNo).join(', ') || '—' },
          { key: 'status', label: 'Dependency status', sortable: false, render: depStatus },
          { key: 'slack', label: 'Critical', render: (t) => t.isCritical ? badge('CP', 'red') : '' },
        ], rows, { sortKey: 'activityNo', onRowClick: (t) => { state.focus = state.focus === t.id ? '' : t.id; draw(); }, rowClass: (t) => t.id === state.focus ? 'focus' : '' })),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', {}, 'Dependency network'), el('span', { class: 'small muted' }, 'Arrows point from predecessor to dependent task · red outline = critical path · click to focus')), net),
      el('div', { class: 'card' }, el('h3', {}, 'Schedule impact preview'), el('p', { class: 'small muted' }, 'Every add / change / remove shows the affected tasks and the project end-date shift before it is saved, then recalculates downstream dates, updates blocked/available status, refreshes the Gantt and writes an audit record. Actual start and completion dates are never changed by the scheduler.')));
  };
  root.append(projectSelector(ctx, state, () => { state.focus = ''; draw(); }), body);
  draw();
}
