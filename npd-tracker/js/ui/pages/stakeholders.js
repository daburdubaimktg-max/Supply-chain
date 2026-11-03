import { el, table, badge, formModal, guard, toast, openModal } from '../components.js';
import { COLLECTIONS, ROLES } from '../../core/models.js';
import { ACTIONS } from '../../core/auth.js';

export function render(ctx, root) {
  const { store, auth, actions, excel } = ctx;
  const canEdit = auth.can(ACTIONS.EDIT_STAKEHOLDERS);
  const stks = store.all(COLLECTIONS.stakeholders);
  const name = (id) => store.get(COLLECTIONS.stakeholders, id)?.employeeName || '—';
  const tasks = store.all(COLLECTIONS.projectTasks);
  const departments = Array.from(new Set(stks.map((s) => s.department))).sort();
  root.append(el('datalist', { id: 'dept-list2' }, departments.map((d) => el('option', { value: d }))));
  const form = (s = {}) => formModal({
    title: s.id ? `Edit stakeholder – ${s.employeeName}` : 'Create stakeholder', wide: true,
    fields: [
      { name: 'employeeName', label: 'Employee name', value: s.employeeName, required: true },
      { name: 'email', label: 'E-mail ID', type: 'email', value: s.email, required: true, hint: 'Used for all notifications' },
      { name: 'department', label: 'Department', type: 'custom', node: el('input', { list: 'dept-list2', value: s.department || '' }), read: (n) => n.value, required: true },
      { name: 'designation', label: 'Designation', value: s.designation },
      { name: 'role', label: 'Role', type: 'select', options: Object.values(ROLES).map((r) => ({ value: r, label: r })), value: s.role || ROLES.FPR },
      { name: 'managerId', label: 'Manager (escalation)', type: 'select', options: [{ value: '', label: '— none —' }].concat(stks.filter((x) => x.id !== s.id).map((x) => ({ value: x.id, label: x.employeeName }))), value: s.managerId || '' },
      { name: 'backupFprId', label: 'Backup FPR', type: 'select', options: [{ value: '', label: '— none —' }].concat(stks.filter((x) => x.id !== s.id).map((x) => ({ value: x.id, label: x.employeeName }))), value: s.backupFprId || '' },
      { name: 'isActive', label: 'Active', type: 'checkbox', value: s.isActive !== false },
    ],
    onSubmit: async (v) => { const data = { ...v, managerId: v.managerId || null, backupFprId: v.backupFprId || null }; if (s.id) await actions.updateStakeholder(s.id, data, { expectedVersion: s.version }); else await actions.addStakeholder(data); toast('Stakeholder saved', 'success'); return true; },
  });
  const importFile = () => {
    const input = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    input.onchange = guard(async () => {
      const sheets = await excel.readWorkbook(input.files[0]);
      const v = excel.validateStakeholders(Object.values(sheets)[0]);
      const m = openModal({ title: 'Import stakeholders – preview', wide: true, body: el('div', {},
        v.errors.length ? el('div', { class: 'notice error' }, el('ul', { class: 'plain' }, v.errors.map((e) => el('li', {}, e)))) : el('div', { class: 'notice success' }, `${v.rows.filter((r) => r.action === 'ADD').length} new, ${v.rows.filter((r) => r.action === 'UPDATE').length} update(s) (matched by e-mail).`),
        table([{ key: 'row', label: 'Row' }, { key: 'action', label: 'Action', render: (r) => badge(r.action, r.action === 'ADD' ? 'green' : 'blue') }, { key: 'n', label: 'Name', render: (r) => r.record.employeeName }, { key: 'e', label: 'Email', render: (r) => r.record.email }, { key: 'd', label: 'Dept', render: (r) => r.record.department }, { key: 'r', label: 'Role', render: (r) => r.record.role }], v.rows)),
        footer: [el('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), el('button', { class: 'btn btn-primary', disabled: v.errors.length > 0, onClick: guard(async () => { const r = await excel.commitStakeholders(v); m.close(); toast(`Imported ${r.added} new, ${r.updated} updated`, 'success'); }) }, 'Confirm import')] });
    });
    input.click();
  };
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, `Stakeholder master (${stks.length})`), el('div', { class: 'small muted' }, 'FPR dropdowns on every task are sourced from this list. E-mail addresses are validated. Managers receive escalations; backup FPRs are CC’d.')),
      el('div', { class: 'btn-group' }, el('button', { class: 'btn btn-sm', onClick: guard(async () => excel.exportStakeholders()) }, '⬇ Export'), canEdit ? el('button', { class: 'btn btn-sm', onClick: importFile }, '⬆ Import Excel') : null, canEdit ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => form() }, '+ Create stakeholder') : null)),
    table([
      { key: 'employeeName', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'email', label: 'E-mail' },
      { key: 'role', label: 'Role', render: (s) => badge(s.role, { Administrator: 'red', 'Department Head': 'purple', FPR: 'blue', Management: 'grey' }[s.role]) },
      { key: 'managerId', label: 'Manager', render: (s) => name(s.managerId) }, { key: 'backupFprId', label: 'Backup FPR', render: (s) => name(s.backupFprId) },
      { key: 'open', label: 'Open tasks', class: 'num', sortValue: (s) => tasks.filter((t) => t.fprId === s.id && !['COMPLETED', 'NOT_REQUIRED'].includes(t.status)).length, render: (s) => { const n = tasks.filter((t) => t.fprId === s.id && !['COMPLETED', 'NOT_REQUIRED'].includes(t.status)).length; return n ? el('a', { href: `#/tasks?fpr=${s.id}&status=open` }, n) : '0'; } },
      { key: 'isActive', label: 'Status', render: (s) => s.isActive === false ? badge('Inactive', 'grey') : badge('Active', 'green') },
      { key: 'actions', label: '', sortable: false, class: 'actions', render: (s) => canEdit ? el('div', { class: 'btn-group' }, el('button', { class: 'btn btn-xs', onClick: () => form(s) }, 'Edit'), el('button', { class: 'btn btn-xs', onClick: guard(async () => { await actions.updateStakeholder(s.id, { isActive: s.isActive === false }); toast(s.isActive === false ? 'Activated' : 'Deactivated', 'success'); }) }, s.isActive === false ? 'Activate' : 'Deactivate')) : null },
    ], stks, { sortKey: 'employeeName', rowClass: (s) => s.isActive === false ? 'inactive' : '' })));
}
