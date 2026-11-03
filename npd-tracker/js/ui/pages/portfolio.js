import { el, table, fmt, progressBar, badge, filterBar, guard, toast } from '../components.js';
import { projectRows } from '../taskQuery.js';
import { PROJECT_STATUS } from '../../core/models.js';
import { projectStatusBadge, newProjectWizard } from '../projectForms.js';
import { ACTIONS } from '../../core/auth.js';

export function render(ctx, root, { query }) {
  const { store, nav, auth, excel } = ctx;
  const state = ctx.state.portfolio || (ctx.state.portfolio = { q: '', brand: '', kind: '', status: '', flag: '' });
  if (query.status) state.status = query.status; if (query.flag) state.flag = query.flag;
  const rows = projectRows(store);
  const body = el('div');
  const draw = () => {
    const q = state.q.toLowerCase();
    const data = rows.filter((p) => (!q || `${p.projectCode} ${p.name} ${p.brand} ${p.category} ${p.ownerName}`.toLowerCase().includes(q))
      && (!state.brand || p.brand === state.brand) && (!state.kind || p.kind === state.kind)
      && (!state.status || (state.status === 'active' ? [PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.PLANNING].includes(p.status) : p.status === state.status))
      && (!state.flag || (state.flag === 'delayed' ? p.summary.isDelayed : (p.summary.atRisk > 0 || p.summary.launchRisk) && p.status !== PROJECT_STATUS.COMPLETED)));
    body.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, `Project register (${data.length})`), el('div', { class: 'btn-group' },
        el('button', { class: 'btn btn-sm', onClick: guard(async () => excel.exportProjectStatus(data.map((p) => ({ 'Project ID': p.projectCode, Name: p.name, Brand: p.brand, Category: p.category, Type: p.kind, Owner: p.ownerName, 'Launch Date': p.launchDate, 'Actual Start': p.actualStartDate, 'Planned End': p.plannedEndDate, 'Actual End': p.actualEndDate, 'Completion %': p.summary.completionPct, 'Delayed Tasks': p.summary.delayedTasks, Overdue: p.summary.overdue, Status: p.status })))) }, '⬇ Export status report'),
        auth.can(ACTIONS.CREATE_PROJECT) ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => newProjectWizard(ctx) }, '+ New project') : null)),
      table([
        { key: 'projectCode', label: 'Project ID', class: 'nowrap', render: (p) => el('span', {}, p.projectCode, p.isSample ? [' ', badge('SAMPLE', 'outline')] : null) },
        { key: 'name', label: 'Project name' }, { key: 'brand', label: 'Brand' }, { key: 'category', label: 'Category' }, { key: 'kind', label: 'NPD / Transition' }, { key: 'ownerName', label: 'Owner' },
        { key: 'launchDate', label: 'Launch', render: (p) => el('span', { class: p.summary.launchRisk ? 'badge red' : '' }, fmt(p.launchDate)) },
        { key: 'actualStartDate', label: 'Actual start', render: (p) => fmt(p.actualStartDate) }, { key: 'plannedEndDate', label: 'Planned end', render: (p) => fmt(p.plannedEndDate) }, { key: 'actualEndDate', label: 'Actual end', render: (p) => fmt(p.actualEndDate) },
        { key: 'pct', label: 'Completion', sortValue: (p) => p.summary.completionPct, render: (p) => progressBar(p.summary.completionPct) },
        { key: 'delayed', label: 'Delayed tasks', class: 'num', sortValue: (p) => p.summary.delayedTasks, render: (p) => p.summary.delayedTasks ? badge(p.summary.delayedTasks, 'red') : '0' },
        { key: 'status', label: 'Status', render: (p) => el('span', {}, projectStatusBadge(p), p.summary.isDelayed ? [' ', badge('DELAYED', 'red')] : (p.summary.atRisk ? [' ', badge('AT RISK', 'amber')] : null)) },
      ], data, { onRowClick: (p) => nav(`project/${p.id}`), sortKey: 'projectCode', emptyText: 'No projects match. Create one with “+ New Project”.' })));
  };
  root.append(filterBar([
    { key: 'q', label: 'Search', placeholder: 'ID, name, brand, owner…' },
    { key: 'brand', label: 'Brand', type: 'select', options: Array.from(new Set(rows.map((p) => p.brand))).sort().map((b) => ({ value: b, label: b })), allLabel: 'All brands' },
    { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'NPD', label: 'NPD' }, { value: 'Transition', label: 'Transition' }], allLabel: 'NPD & Transition' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active (planning + in progress)' }].concat(Object.values(PROJECT_STATUS).map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))), allLabel: 'All statuses' },
    { key: 'flag', label: 'Flag', type: 'select', options: [{ value: 'delayed', label: 'Delayed' }, { value: 'risk', label: 'At risk' }], allLabel: 'Any' },
  ], state, draw), body);
  draw();
  void toast;
}
