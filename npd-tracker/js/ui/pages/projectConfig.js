import { el, table, badge, yesNo, fmt, statusBadge, formModal, promptDialog, confirmDialog, guard, toast, openModal } from '../components.js';
import { COLLECTIONS, TASK_STATUS } from '../../core/models.js';
import { ACTIONS } from '../../core/auth.js';
import { enrichedTasks } from '../taskQuery.js';
import { editTask, addTaskForm } from '../taskPanel.js';
import { editProjectForm } from '../projectForms.js';

export function projectSelector(ctx, state, onChange) {
  const projects = ctx.store.all(COLLECTIONS.projects);
  if (!projects.find((p) => p.id === state.project)) state.project = projects[0]?.id || '';
  return el('div', { class: 'filters' }, el('div', { class: 'field' }, el('label', {}, 'Project'), el('select', { onChange: (e) => { state.project = e.target.value; onChange(); } }, projects.map((p) => el('option', { value: p.id, selected: p.id === state.project }, `${p.projectCode} · ${p.name} (${p.brand})`)))));
}

export function render(ctx, root, { query }) {
  const { store, auth, actions, excel } = ctx;
  const state = ctx.state.pcfg || (ctx.state.pcfg = { project: '' });
  if (query.project) state.project = query.project;
  const body = el('div');
  const draw = () => {
    body.replaceChildren();
    const p = store.get(COLLECTIONS.projects, state.project);
    if (!p) { body.append(el('div', { class: 'empty' }, 'No projects yet. Create one with “+ New Project”.')); return; }
    const rows = enrichedTasks(store, { projectId: p.id }).sort((a, b) => a.sequence - b.sequence);
    const canEdit = auth.can(ACTIONS.EDIT_TASK); const isAdmin = auth.isAdmin();
    const stks = store.all(COLLECTIONS.stakeholders).filter((s) => s.isActive !== false);
    const fprSelect = (t) => auth.can(ACTIONS.EDIT_FPR, { task: t.task }) ? el('select', { style: { width: '150px' }, onChange: guard(async (e) => { await actions.changeFpr(t.id, e.target.value || null); toast(`FPR changed – ${store.get(COLLECTIONS.stakeholders, e.target.value)?.employeeName || 'none'} notified`, 'success'); }) }, [{ value: '', label: '—' }].concat(stks.map((s) => ({ value: s.id, label: s.employeeName }))).map((o) => el('option', { value: o.value, selected: (t.fprId || '') === o.value }, o.label))) : t.fprName;
    const durInput = (t) => canEdit && (isAdmin || auth.editableTaskFields()?.has('expectedDuration')) ? el('input', { type: 'number', min: 0, value: t.expectedDuration, style: { width: '64px' }, onChange: guard(async (e) => { await actions.updateTask(t.id, { expectedDuration: Number(e.target.value) }); toast('Duration updated – schedule recalculated', 'success'); }) }) : t.expectedDuration;
    const importTasks = () => {
      const input = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
      input.onchange = guard(async () => {
        const sheets = await excel.readWorkbook(input.files[0]);
        const v = excel.validateProjectTasks(p.id, sheets.Tasks || Object.values(sheets)[0]);
        const dv = sheets.Dependencies ? excel.validateDependencySheet(p.id, sheets.Dependencies) : null;
        const m = openModal({ title: `Import tasks into ${p.projectCode} – preview`, wide: true, body: el('div', {},
          v.errors.length ? el('div', { class: 'notice error' }, el('ul', { class: 'plain' }, v.errors.map((e) => el('li', {}, e)))) : el('div', { class: 'notice success' }, `${v.rows.filter((r) => r.action === 'ADD').length} new task(s), ${v.rows.filter((r) => r.action === 'UPDATE').length} update(s)${dv ? `, ${dv.rows.length} dependency row(s)` : ''}. Existing records are only changed after you confirm.`),
          v.warnings.length ? el('div', { class: 'notice warn' }, el('ul', { class: 'plain' }, v.warnings.map((e) => el('li', {}, e)))) : null,
          dv?.errors.length ? el('div', { class: 'notice error' }, el('ul', { class: 'plain' }, dv.errors.map((e) => el('li', {}, e)))) : null,
          table([{ key: 'row', label: 'Row' }, { key: 'action', label: 'Action', render: (r) => badge(r.action, r.action === 'ADD' ? 'green' : 'blue') }, { key: 'no', label: '#', render: (r) => r.record.activityNo }, { key: 'name', label: 'Task', render: (r) => r.record.name }, { key: 'fpr', label: 'FPR', render: (r) => store.get(COLLECTIONS.stakeholders, r.record.fprId)?.employeeName || '—' }, { key: 'dur', label: 'Days', render: (r) => r.record.expectedDuration }, { key: 'preds', label: 'Preds', render: (r) => r.preds.map((x) => x.no).join(', ') }], v.rows)),
          footer: [el('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), el('button', { class: 'btn btn-primary', disabled: v.errors.length > 0 || (dv?.errors.length > 0), onClick: guard(async () => { const r = await excel.commitProjectTasks(p.id, v); if (dv) await excel.commitDependencySheet(p.id, dv); m.close(); toast(`Imported ${r.added} new, ${r.updated} updated`, 'success'); }) }, 'Confirm import')] });
      });
      input.click();
    };
    body.append(el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('div', {}, el('h3', {}, `${p.projectCode} · ${p.name}`), el('div', { class: 'small muted' }, `${p.brand} · ${p.kind} · ${rows.length} tasks · ${store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === p.id).length} dependencies · scheduling ${p.schedulingMode} from ${p.schedulingMode === 'BACKWARD' ? `launch ${fmt(p.launchDate)}` : `anchor ${fmt(p.anchorDate)}`}`)),
        el('div', { class: 'btn-group' },
          auth.can(ACTIONS.EDIT_PROJECT) ? el('button', { class: 'btn btn-sm', onClick: () => editProjectForm(ctx, p) }, '✎ Project settings') : null,
          el('button', { class: 'btn btn-sm', onClick: () => ctx.nav(`dependencies?project=${p.id}`) }, 'Dependencies →'),
          el('button', { class: 'btn btn-sm', onClick: guard(async () => excel.exportProjectTasks(p.id)) }, '⬇ Export'),
          canEdit ? el('button', { class: 'btn btn-sm', onClick: importTasks }, '⬆ Import Excel') : null,
          isAdmin ? el('button', { class: 'btn btn-sm', onClick: guard(async () => { const n = await promptDialog({ title: 'Save as template', label: 'Template name', multiline: false }); if (n) { await actions.saveAsTemplate(p.id, n); toast('Template saved – available in the New Project wizard', 'success'); } }) }, 'Save as template') : null,
          isAdmin ? el('button', { class: 'btn btn-sm', onClick: guard(async () => { await actions.recalculate(p.id, { reason: 'Manual recalculation' }); toast('Schedule recalculated', 'success'); }) }, '↻ Recalculate') : null,
          canEdit ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => addTaskForm(ctx, p.id) }, '+ Add task') : null)),
      table([
        { key: 'sequence', label: 'Seq', class: 'num' }, { key: 'activityNo', label: '#', class: 'num' }, { key: 'name', label: 'Task', render: (t) => el('span', {}, t.name, t.activityId ? null : [' ', badge('project-specific', 'outline')]) },
        { key: 'department', label: 'Department' }, { key: 'fprId', label: 'FPR (editable)', sortable: false, render: fprSelect }, { key: 'approverName', label: 'Approver' },
        { key: 'expectedDuration', label: 'Days', sortable: false, render: durInput }, { key: 'predecessorText', label: 'Preds' },
        { key: 'plannedStart', label: 'Planned', render: (t) => `${fmt(t.plannedStart)} → ${fmt(t.plannedEnd)}` },
        { key: 'isMandatory', label: 'Mandatory', render: (t) => yesNo(t.isMandatory) }, { key: 'approvalRequired', label: 'Approval', render: (t) => yesNo(t.approvalRequired) },
        { key: 'perf', label: 'Status', render: (t) => statusBadge(t.perf) },
        { key: 'actions', label: 'Actions', sortable: false, class: 'actions', render: (t) => el('div', { class: 'btn-group' },
          canEdit ? el('button', { class: 'btn btn-xs', onClick: () => editTask(ctx, t.task) }, 'Edit') : null,
          el('button', { class: 'btn btn-xs', onClick: () => ctx.openTask(t.id, { tab: 'dependencies' }) }, 'Deps'),
          canEdit && t.status !== TASK_STATUS.NOT_REQUIRED && t.status !== TASK_STATUS.COMPLETED && auth.can(ACTIONS.MARK_NOT_REQUIRED, { task: t.task }) ? el('button', { class: 'btn btn-xs', onClick: guard(async () => { const r = await promptDialog({ title: 'Mark Not Required', label: 'Reason' }); if (r) { await actions.markNotRequired(t.id, r); toast('Marked Not Required', 'success'); } }) }, 'Not req.') : null,
          canEdit && t.status === TASK_STATUS.NOT_REQUIRED ? el('button', { class: 'btn btn-xs', onClick: guard(async () => { await actions.restoreRequired(t.id); toast('Restored', 'success'); }) }, 'Restore') : null,
          canEdit ? el('button', { class: 'btn btn-xs', onClick: guard(async () => { await actions.setTaskActive(t.id, t.isActive === false); toast(t.isActive === false ? 'Activated' : 'Deactivated', 'success'); }) }, t.isActive === false ? 'Activate' : 'Deactivate') : null,
          canEdit && !t.actualStart ? el('button', { class: 'btn btn-xs btn-danger', onClick: guard(async () => { if (await confirmDialog({ title: 'Remove task', message: `Remove "${t.name}" from this project? Its dependencies are removed and the schedule recalculated.`, danger: true, okText: 'Remove' })) { await actions.removeTask(t.id, 'Removed via project configuration'); toast('Task removed', 'success'); } }) }, 'Remove') : null) },
      ], rows, { sortKey: 'sequence', rowClass: (t) => t.isActive === false ? 'inactive' : '', onRowClick: (t) => ctx.openTask(t.id) })));
    const tpls = store.all(COLLECTIONS.templates);
    if (tpls.length && isAdmin) body.append(el('div', { class: 'card' }, el('h3', {}, 'Saved templates'), table([{ key: 'name', label: 'Template' }, { key: 'tasks', label: 'Tasks', render: (t) => t.tasks.length }, { key: 'dependencies', label: 'Dependencies', render: (t) => t.dependencies.length }, { key: 'createdBy', label: 'Created by' }, { key: 'actions', label: '', sortable: false, render: (t) => el('button', { class: 'btn btn-xs btn-danger', onClick: guard(async () => { await actions.deleteTemplate(t.id); toast('Template deleted', 'success'); }) }, 'Delete') }], tpls)));
  };
  root.append(projectSelector(ctx, state, draw), body);
  draw();
  void formModal;
}
