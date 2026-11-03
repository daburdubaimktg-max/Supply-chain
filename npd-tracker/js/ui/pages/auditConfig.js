import { el, table, badge, filterBar, formModal, confirmDialog, guard, toast } from '../components.js';
import { COLLECTIONS } from '../../core/models.js';
import { ACTIONS } from '../../core/auth.js';

export function render(ctx, root) {
  const { store, auth, actions } = ctx;
  const cfg = store.config(); const cal = store.calendar();
  const isAdmin = auth.can(ACTIONS.CONFIGURE_SYSTEM);
  const audit = store.all(COLLECTIONS.auditLog).slice().reverse();
  const projects = new Map(store.all(COLLECTIONS.projects).map((p) => [p.id, p]));
  const taskName = (id) => store.get(COLLECTIONS.projectTasks, id)?.name || '';
  const state = ctx.state.audit || (ctx.state.audit = { q: '', action: '', project: '', user: '' });
  const body = el('div');
  const draw = () => {
    const q = state.q.toLowerCase();
    const rows = audit.filter((a) => (!q || `${a.summary} ${a.user} ${a.collection} ${JSON.stringify(a.changes)}`.toLowerCase().includes(q)) && (!state.action || a.action === state.action) && (!state.project || a.projectId === state.project) && (!state.user || a.user === state.user));
    body.replaceChildren(table([
      { key: 'timestamp', label: 'When', class: 'nowrap', render: (a) => new Date(a.timestamp).toLocaleString() }, { key: 'user', label: 'User' },
      { key: 'action', label: 'Action', render: (a) => badge(a.action, { CREATE: 'green', UPDATE: 'blue', DELETE: 'red', RESCHEDULE: 'amber', GENERATE: 'purple', SEED: 'grey' }[a.action] || 'grey') },
      { key: 'projectId', label: 'Project', render: (a) => projects.get(a.projectId)?.projectCode || '' }, { key: 'collection', label: 'Record', render: (a) => `${a.collection}${a.taskId && taskName(a.taskId) ? ` · ${taskName(a.taskId)}` : ''}` },
      { key: 'summary', label: 'Summary' },
      { key: 'changes', label: 'Changes (before → after)', sortable: false, render: (a) => a.changes?.length ? el('details', {}, el('summary', { class: 'small' }, `${a.changes.length} field(s)`), el('ul', { class: 'plain small' }, a.changes.slice(0, 20).map((c) => el('li', {}, el('strong', {}, c.field), `: ${fmtVal(c.from)} → ${fmtVal(c.to)}`)))) : (a.reason ? el('span', { class: 'small muted' }, `Reason: ${a.reason}`) : '') },
    ], rows, { maxRows: 500, emptyText: 'No audit entries' }));
  };
  const users = Array.from(new Set(audit.map((a) => a.user)));
  root.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', {}, `Audit history (${audit.length} entries, append-only)`), el('span', { class: 'small muted' }, 'Previous & new FPR, dependencies, durations, dates, reopenings, approvals, user and timestamp')),
    filterBar([{ key: 'q', label: 'Search' }, { key: 'action', label: 'Action', type: 'select', options: ['CREATE', 'UPDATE', 'DELETE', 'RESCHEDULE', 'GENERATE'].map((a) => ({ value: a, label: a })) }, { key: 'project', label: 'Project', type: 'select', options: [...projects.values()].map((p) => ({ value: p.id, label: p.projectCode })) }, { key: 'user', label: 'User', type: 'select', options: users.map((u) => ({ value: u, label: u })) }], state, draw), body));
  draw();

  // ---- System configuration ------------------------------------------------
  const cfgCard = el('div', { class: 'card' });
  const renderCfg = () => cfgCard.replaceChildren(
    el('div', { class: 'card-head' }, el('h3', {}, 'System configuration'), isAdmin ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => formModal({
      title: 'Edit system configuration', wide: true,
      fields: [
        { name: 'companyName', label: 'System title', value: cfg.companyName },
        { name: 'dueSoonThresholdDays', label: 'Due-soon threshold (working days)', type: 'number', min: 0, value: cfg.dueSoonThresholdDays },
        { name: 'atRiskThresholdDays', label: 'At-risk threshold (forecast beyond plan, wd)', type: 'number', min: 0, value: cfg.atRiskThresholdDays },
        { name: 'reminderBeforeDays', label: 'Reminder before deadline (wd)', type: 'number', min: 0, value: cfg.reminderBeforeDays },
        { name: 'escalationAfterDays', label: 'Escalate to manager after (wd overdue)', type: 'number', min: 0, value: cfg.escalationAfterDays },
        { name: 'significantChangeDays', label: 'Confirm schedule changes ≥ (wd shift)', type: 'number', min: 0, value: cfg.significantChangeDays },
        { name: 'escalationLevels', label: 'Escalation levels (JSON)', type: 'textarea', value: JSON.stringify(cfg.escalationLevels, null, 0), span2: true, hint: '[{"level":1,"afterDays":3,"recipient":"manager"}, …] recipients: manager | departmentHead | projectOwner' },
        { name: 'dashboardUrl', label: 'Dashboard URL (in e-mails)', value: cfg.notifications?.dashboardUrl, span2: true },
        { name: 'ccProjectOwner', label: 'CC project owner on notifications', type: 'checkbox', value: cfg.notifications?.ccProjectOwner },
        { name: 'notificationsEnabled', label: 'Notifications enabled', type: 'checkbox', value: cfg.notifications?.enabled !== false },
        { name: 'emailAutomation', label: 'E-mail automation', type: 'select', options: [{ value: 'logged', label: 'Prototype – log only (not sent)' }, { value: 'powerautomate', label: 'Production – queue for Power Automate (requires flow)' }], value: cfg.emailAutomation },
        { name: 'dataAdapter', label: 'Data adapter', type: 'select', options: [{ value: 'localStorage', label: 'Prototype – browser storage' }, { value: 'sharepoint', label: 'Production – SharePoint Lists (requires configuration)' }], value: cfg.dataAdapter },
        { name: 'spApi', label: 'SharePoint API base URL', value: cfg.sharepoint?.apiBaseUrl || '', span2: true, hint: 'Secure backend endpoint; never put client secrets here' },
      ],
      onSubmit: async (v) => { let lv; try { lv = JSON.parse(v.escalationLevels); } catch { throw new Error('Escalation levels must be valid JSON'); }
        await actions.updateConfig({ companyName: v.companyName, dueSoonThresholdDays: v.dueSoonThresholdDays, atRiskThresholdDays: v.atRiskThresholdDays, reminderBeforeDays: v.reminderBeforeDays, escalationAfterDays: v.escalationAfterDays, significantChangeDays: v.significantChangeDays, escalationLevels: lv, notifications: { ...cfg.notifications, dashboardUrl: v.dashboardUrl, ccProjectOwner: v.ccProjectOwner, enabled: v.notificationsEnabled }, emailAutomation: v.emailAutomation, dataAdapter: v.dataAdapter, sharepoint: { ...(cfg.sharepoint || {}), apiBaseUrl: v.spApi } });
        toast('Configuration saved' + (v.dataAdapter === 'sharepoint' ? ' – reload to attempt SharePoint connection' : ''), 'success'); return true; },
    }) }, '✎ Edit') : null),
    el('dl', { class: 'kv' }, ...[['Due-soon threshold', `${cfg.dueSoonThresholdDays} wd`], ['At-risk threshold', `${cfg.atRiskThresholdDays} wd`], ['Reminder before deadline', `${cfg.reminderBeforeDays} wd`], ['Escalation after', `${cfg.escalationAfterDays} wd overdue`], ['Escalation levels', (cfg.escalationLevels || []).map((l) => `L${l.level} @${l.afterDays}d → ${l.recipient}`).join(' · ')], ['Significant change confirmation', `≥ ${cfg.significantChangeDays} wd`], ['Data adapter', `${cfg.dataAdapter} ${store.adapter.isProduction ? '(connected)' : '(prototype – browser storage)'}`], ['E-mail automation', cfg.emailAutomation === 'powerautomate' ? 'Power Automate queue' : 'Logged only (prototype)'], ['Notifications', cfg.notifications?.enabled === false ? 'Disabled' : 'Enabled']].flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
  renderCfg();

  // ---- Working calendar -------------------------------------------------------
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', {}, 'Working calendar'), isAdmin ? el('div', { class: 'btn-group' },
      el('button', { class: 'btn btn-sm', onClick: () => formModal({ title: 'Weekend days', fields: [{ name: 'weekendDays', label: 'Non-working weekdays', type: 'multiselect', options: days.map((d, i) => ({ value: String(i), label: d })), value: (cal.weekendDays || []).map(String), span2: true }], onSubmit: async (v) => { await actions.updateCalendar({ weekendDays: v.weekendDays.map(Number) }); toast('Calendar updated – all schedules recalculated', 'success'); return true; } }) }, 'Weekend days'),
      el('button', { class: 'btn btn-sm btn-primary', onClick: () => formModal({ title: 'Add holiday', fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'type', label: 'Type', type: 'select', options: [{ value: 'Public', label: 'Public holiday' }, { value: 'Company', label: 'Company holiday' }] }], onSubmit: async (v) => { await actions.updateCalendar({ holidays: [...(cal.holidays || []), v].sort((a, b) => a.date.localeCompare(b.date)) }); toast('Holiday added – schedules recalculated', 'success'); return true; } }) }, '+ Holiday')) : null),
    el('p', { class: 'small' }, `Non-working days: ${(cal.weekendDays || []).map((d) => days[d]).join(', ')}`),
    table([{ key: 'date', label: 'Date' }, { key: 'name', label: 'Holiday' }, { key: 'type', label: 'Type' }, { key: 'x', label: '', sortable: false, render: (h) => isAdmin ? el('button', { class: 'btn btn-xs btn-danger', onClick: guard(async () => { await actions.updateCalendar({ holidays: cal.holidays.filter((x) => x !== h) }); toast('Removed', 'success'); }) }, 'Remove') : null }], cal.holidays || [], { sortKey: 'date' }));

  // ---- Data tools ----------------------------------------------------------------
  const tools = el('div', { class: 'card' }, el('h3', {}, 'Data tools (prototype)'), el('p', { class: 'small muted' }, `Adapter: ${store.adapter.label}. Data persists in this browser across refreshes. Records: ${Object.values(COLLECTIONS).map((c) => `${c} ${store.all(c).length}`).join(' · ')}`),
    el('div', { class: 'btn-group' },
      el('button', { class: 'btn btn-sm', onClick: guard(async () => { const data = await store.exportAll(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = el('a', { href: URL.createObjectURL(blob), download: `npd_tracker_backup_${new Date().toISOString().slice(0, 10)}.json` }); a.click(); }) }, '⬇ Backup all data (JSON)'),
      isAdmin ? el('button', { class: 'btn btn-sm', onClick: () => { const input = el('input', { type: 'file', accept: '.json' }); input.onchange = guard(async () => { const data = JSON.parse(await input.files[0].text()); if (!(await confirmDialog({ title: 'Restore backup', message: 'Replace ALL current data with this backup? Current data will be overwritten.', danger: true, okText: 'Restore' }))) return; await store.adapter.importAll(data); location.reload(); }); input.click(); } }, '⬆ Restore backup') : null,
      auth.can(ACTIONS.RESET_DATA) ? el('button', { class: 'btn btn-sm btn-danger', onClick: guard(async () => { if (!(await confirmDialog({ title: 'Reset all data', message: 'Delete everything in this browser and reload the initial baseline (30 activities + sample projects)?', danger: true, okText: 'Reset' }))) return; await store.resetAll(); location.reload(); }) }, 'Reset to initial baseline') : null,
      auth.can(ACTIONS.RESET_DATA) ? el('button', { class: 'btn btn-sm', onClick: guard(async () => { const samples = store.all(COLLECTIONS.projects).filter((p) => p.isSample); if (!samples.length) { toast('No sample projects', 'info'); return; } if (!(await confirmDialog({ title: 'Delete sample projects', message: `Delete ${samples.length} SAMPLE project(s)?`, danger: true, okText: 'Delete' }))) return; for (const s of samples) await actions.deleteProject(s.id); toast('Sample projects deleted', 'success'); }) }, 'Delete SAMPLE projects') : null));
  root.append(el('div', { class: 'grid grid-2' }, cfgCard, calCard), tools);
}

function fmtVal(v) { if (v == null || v === '') return '—'; if (typeof v === 'object') return JSON.stringify(v).slice(0, 80); return String(v).slice(0, 80); }
