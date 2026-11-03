import { el, table, badge, yesNo, formModal, confirmDialog, guard, toast, openModal } from '../components.js';
import { COLLECTIONS, DEP_TYPES } from '../../core/models.js';
import { ACTIONS } from '../../core/auth.js';
import { renderDepNetwork } from '../depNetwork.js';

export function render(ctx, root) {
  const { store, auth, actions, excel } = ctx;
  const canEdit = auth.can(ACTIONS.EDIT_MASTER);
  const acts = store.all(COLLECTIONS.activityMaster).sort((a, b) => a.sequence - b.sequence);
  const deps = store.all(COLLECTIONS.masterDependencies);
  const byId = new Map(acts.map((a) => [a.id, a]));
  const name = (id) => store.get(COLLECTIONS.stakeholders, id)?.employeeName || '—';
  const stks = store.all(COLLECTIONS.stakeholders).filter((s) => s.isActive !== false);
  const departments = Array.from(new Set(stks.map((s) => s.department).concat(acts.map((a) => a.department)))).sort();

  const activityForm = (a = {}) => formModal({
    title: a.id ? `Edit activity ${a.activityNo} – ${a.name}` : 'Add new activity', wide: true,
    fields: [
      { name: 'activityNo', label: 'Activity number', type: 'number', value: a.activityNo ?? Math.max(0, ...acts.map((x) => Number(x.activityNo))) + 1, required: true },
      { name: 'sequence', label: 'Sequence (display order)', type: 'number', value: a.sequence ?? Math.max(0, ...acts.map((x) => Number(x.sequence))) + 1 },
      { name: 'name', label: 'Activity name', value: a.name, required: true, span2: true },
      { name: 'department', label: 'Department', type: 'custom', node: el('input', { list: 'dept-list', value: a.department || '' }), read: (n) => n.value, required: true },
      { name: 'defaultFprId', label: 'Default FPR', type: 'select', options: [{ value: '', label: '— none —' }].concat(stks.map((s) => ({ value: s.id, label: `${s.employeeName} (${s.department})` }))), value: a.defaultFprId || '', hint: 'Starting reference only – assigned per project' },
      { name: 'expectedDuration', label: 'Expected duration (working days)', type: 'number', min: 0, value: a.expectedDuration ?? 1, required: true, hint: '0 = milestone / date-based' },
      { name: 'isMandatory', label: 'Mandatory', type: 'checkbox', value: a.isMandatory ?? true },
      { name: 'approvalRequired', label: 'Approval required', type: 'checkbox', value: a.approvalRequired ?? false },
      { name: 'description', label: 'Description', type: 'textarea', value: a.description, span2: true },
      { name: 'instructions', label: 'Task instructions', type: 'textarea', value: a.instructions, span2: true },
    ],
    onSubmit: async (v) => { if (a.id) await actions.updateActivity(a.id, v, { expectedVersion: a.version }); else await actions.addActivity(v); toast(a.id ? 'Activity updated (existing projects unchanged)' : 'Activity added', 'success'); return true; },
  });
  root.append(el('datalist', { id: 'dept-list' }, departments.map((d) => el('option', { value: d }))));

  const depForm = (dep) => formModal({
    title: dep ? 'Edit default dependency' : 'Add default dependency',
    fields: [
      { name: 'taskId', label: 'Activity (successor)', type: 'select', options: acts.map((a) => ({ value: a.id, label: `${a.activityNo} · ${a.name}` })), value: dep?.taskId, required: true, span2: true, disabled: Boolean(dep) },
      { name: 'predecessorId', label: 'Predecessor', type: 'select', options: acts.map((a) => ({ value: a.id, label: `${a.activityNo} · ${a.name}` })), value: dep?.predecessorId, required: true, span2: true },
      { name: 'type', label: 'Type', type: 'select', options: DEP_TYPES.map((t) => ({ value: t, label: t })), value: dep?.type || 'FS' },
      { name: 'lagDays', label: 'Lag (working days)', type: 'number', value: dep?.lagDays ?? 0 },
    ],
    onSubmit: async (v) => { if (dep) await actions.updateMasterDependency(dep.id, { predecessorId: v.predecessorId, type: v.type, lagDays: Number(v.lagDays || 0) }); else await actions.addMasterDependency(v.taskId, v.predecessorId, v.type, Number(v.lagDays || 0)); toast('Default dependency saved', 'success'); return true; },
  });

  const applyToProjects = async () => {
    const projects = store.all(COLLECTIONS.projects).filter((p) => p.status !== 'COMPLETED');
    const checks = projects.map((p) => ({ p, box: el('input', { type: 'checkbox' }), changes: actions.previewMasterApply(p.id) }));
    const opts = { addMissing: el('input', { type: 'checkbox', checked: true }), fpr: el('input', { type: 'checkbox' }) };
    const m = openModal({
      title: 'Apply master changes to existing projects – preview', wide: true,
      body: el('div', {},
        el('div', { class: 'notice warn' }, 'Master changes never update projects automatically. Review the differences below and tick the projects to update. Actual dates are never changed; schedules will be recalculated.'),
        el('div', { class: 'flex mb' }, el('label', { class: 'flex small' }, opts.addMissing, 'Add activities missing from the project'), el('label', { class: 'flex small' }, opts.fpr, 'Also apply default FPR (overwrites project FPR)')),
        ...checks.map((c) => el('div', { class: 'card', style: { padding: '10px' } }, el('label', { class: 'flex' }, c.box, el('strong', {}, `${c.p.projectCode} · ${c.p.name}`), el('span', { class: 'muted small' }, `${c.changes.length} difference(s)`)),
          c.changes.length ? el('ul', { class: 'plain small' }, c.changes.map((ch) => el('li', {}, badge(ch.kind, ch.kind === 'ADD' ? 'green' : 'blue'), ' ', ch.detail))) : el('div', { class: 'small muted' }, 'In sync with master')))),
      footer: [el('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), el('button', { class: 'btn btn-primary', onClick: guard(async () => {
        const sel = checks.filter((c) => c.box.checked); if (!sel.length) { toast('Select at least one project', 'warn'); return; }
        for (const c of sel) await actions.applyMasterToProject(c.p.id, { addMissing: opts.addMissing.checked, applyFpr: opts.fpr.checked });
        m.close(); toast(`Master applied to ${sel.length} project(s)`, 'success');
      }) }, 'Apply to selected projects')],
    });
  };

  const importMaster = () => {
    const input = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    input.onchange = guard(async () => {
      const sheets = await excel.readWorkbook(input.files[0]);
      const rows = sheets['Activity Master'] || Object.values(sheets)[0];
      const v = excel.validateActivityMaster(rows);
      const m = openModal({ title: 'Import activity master – preview', wide: true, body: el('div', {},
        v.errors.length ? el('div', { class: 'notice error' }, el('strong', {}, `${v.errors.length} validation error(s) – nothing imported:`), el('ul', { class: 'plain' }, v.errors.map((e) => el('li', {}, e)))) : el('div', { class: 'notice success' }, `${v.rows.filter((r) => r.action === 'ADD').length} new, ${v.rows.filter((r) => r.action === 'UPDATE').length} updates. Predecessor lists in the file replace existing default dependencies for those activities.`),
        table([{ key: 'row', label: 'Row' }, { key: 'action', label: 'Action', render: (r) => badge(r.action, r.action === 'ADD' ? 'green' : 'blue') }, { key: 'no', label: '#', render: (r) => r.record.activityNo }, { key: 'name', label: 'Name', render: (r) => r.record.name }, { key: 'dept', label: 'Dept', render: (r) => r.record.department }, { key: 'dur', label: 'Days', render: (r) => r.record.expectedDuration }, { key: 'preds', label: 'Preds', render: (r) => r.preds.map((p) => `${p.no}${p.type !== 'FS' ? p.type : ''}${p.lag ? `+${p.lag}` : ''}`).join(', ') }], v.rows)),
        footer: [el('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), el('button', { class: 'btn btn-primary', disabled: v.errors.length > 0, onClick: guard(async () => { const r = await excel.commitActivityMaster(v); m.close(); toast(`Imported: ${r.added} added, ${r.updated} updated, ${r.deps} dependencies`, 'success'); }) }, 'Confirm import')] });
    });
    input.click();
  };

  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, `Global activity master (${acts.length} activities, ${acts.filter((a) => a.isActive !== false).length} active)`), el('div', { class: 'small muted' }, 'One editable standard template for all new projects. Changes here do not alter existing projects unless you explicitly apply them.')),
      el('div', { class: 'btn-group' },
        el('button', { class: 'btn btn-sm', onClick: guard(async () => excel.exportActivityMaster()) }, '⬇ Export'),
        canEdit ? el('button', { class: 'btn btn-sm', onClick: importMaster }, '⬆ Import Excel') : null,
        canEdit ? el('button', { class: 'btn btn-sm', onClick: applyToProjects }, 'Apply to existing projects…') : null,
        canEdit ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => activityForm() }, '+ Add activity') : null)),
    table([
      { key: 'activityNo', label: '#', class: 'num' }, { key: 'sequence', label: 'Seq', class: 'num' }, { key: 'name', label: 'Activity' }, { key: 'department', label: 'Department' },
      { key: 'defaultFprId', label: 'Default FPR', render: (a) => name(a.defaultFprId) }, { key: 'expectedDuration', label: 'Days', class: 'num', render: (a) => a.expectedDuration === 0 ? badge('milestone', 'outline') : a.expectedDuration },
      { key: 'preds', label: 'Default predecessors', render: (a) => deps.filter((d) => d.taskId === a.id).map((d) => `${byId.get(d.predecessorId)?.activityNo}${d.type !== 'FS' ? d.type : ''}${d.lagDays ? `+${d.lagDays}` : ''}`).join(', ') || '—' },
      { key: 'isMandatory', label: 'Mandatory', render: (a) => yesNo(a.isMandatory) }, { key: 'approvalRequired', label: 'Approval', render: (a) => yesNo(a.approvalRequired) },
      { key: 'isActive', label: 'Active', render: (a) => a.isActive === false ? badge('Inactive', 'grey') : badge('Active', 'green') },
      { key: 'actions', label: 'Actions', sortable: false, class: 'actions', render: (a) => canEdit ? el('div', { class: 'btn-group' },
        el('button', { class: 'btn btn-xs', onClick: () => activityForm(a) }, 'Edit'),
        el('button', { class: 'btn btn-xs', onClick: guard(async () => { await actions.setActivityActive(a.id, a.isActive === false); toast(a.isActive === false ? 'Activated' : 'Deactivated – excluded from future templates', 'success'); }) }, a.isActive === false ? 'Activate' : 'Deactivate'),
        el('button', { class: 'btn btn-xs btn-danger', onClick: guard(async () => { if (await confirmDialog({ title: 'Delete activity', message: `Delete "${a.name}" from the master? Only allowed when no project task references it.`, danger: true, okText: 'Delete' })) { await actions.deleteActivity(a.id); toast('Deleted', 'success'); } }) }, 'Delete')) : el('span', { class: 'muted small' }, 'read-only') },
    ], acts, { sortKey: 'sequence', rowClass: (a) => a.isActive === false ? 'inactive' : '' })));

  const net = el('div');
  renderDepNetwork(net, acts.filter((a) => a.isActive !== false).map((a) => ({ ...a, perf: 'NOT STARTED', fprName: name(a.defaultFprId) })), deps, { onClick: (a) => canEdit && activityForm(a) });
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', {}, `Default dependency matrix (${deps.length} relationships, all editable)`), canEdit ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => depForm() }, '+ Add dependency') : null),
    table([
      { key: 'taskId', label: 'Activity', render: (d) => `${byId.get(d.taskId)?.activityNo} · ${byId.get(d.taskId)?.name}`, sortValue: (d) => byId.get(d.taskId)?.sequence },
      { key: 'predecessorId', label: 'Predecessor', render: (d) => `${byId.get(d.predecessorId)?.activityNo} · ${byId.get(d.predecessorId)?.name}` },
      { key: 'type', label: 'Type' }, { key: 'lagDays', label: 'Lag', class: 'num' },
      { key: 'actions', label: '', sortable: false, class: 'actions', render: (d) => canEdit ? el('div', { class: 'btn-group' }, el('button', { class: 'btn btn-xs', onClick: () => depForm(d) }, 'Edit'), el('button', { class: 'btn btn-xs btn-danger', onClick: guard(async () => { await actions.removeMasterDependency(d.id); toast('Removed', 'success'); }) }, 'Remove')) : null },
    ], deps, { sortKey: 'taskId' }),
    el('h4', { class: 'mt' }, 'Dependency network'), net));
}
