// New-project wizard and project edit form.
import { el, formModal, openModal, toast, setLoading, badge } from './components.js';
import { COLLECTIONS, PRIORITIES, PROJECT_KINDS, SCHEDULING_MODES, PROJECT_STATUS } from '../core/models.js';
import { today } from '../core/calendar.js';

function brands(store) { return Array.from(new Set(store.all(COLLECTIONS.projects).map((p) => p.brand))).sort(); }
function categories(store) { return Array.from(new Set(store.all(COLLECTIONS.projects).map((p) => p.category).filter(Boolean))).sort(); }

export async function newProjectWizard(ctx) {
  const { store, actions, nav } = ctx;
  const stks = store.all(COLLECTIONS.stakeholders).filter((s) => s.isActive !== false);
  const templates = store.all(COLLECTIONS.templates);
  const activities = store.all(COLLECTIONS.activityMaster).filter((a) => a.isActive !== false).sort((a, b) => a.sequence - b.sequence);
  const nameOf = (id) => store.get(COLLECTIONS.stakeholders, id)?.employeeName || '—';

  // Step 1 – project info
  const info = await formModal({
    title: 'New project – step 1 of 2: project information', wide: true,
    fields: [
      { name: 'name', label: 'Project name', required: true, span2: true },
      { name: 'brand', label: 'Brand', required: true, placeholder: brands(store).join(', ') || 'e.g. Brand A' },
      { name: 'category', label: 'Category', placeholder: categories(store).join(', ') || 'e.g. Oral Care' },
      { name: 'categoryHead', label: 'Category head' },
      { name: 'kind', label: 'NPD / Transition', type: 'select', options: PROJECT_KINDS.map((k) => ({ value: k, label: k })) },
      { name: 'projectType', label: 'Project type', placeholder: 'e.g. New Variant, Pack Change' },
      { name: 'size', label: 'Size' }, { name: 'variant', label: 'Variant' },
      { name: 'ownerId', label: 'Project owner', type: 'select', options: stks.map((s) => ({ value: s.id, label: s.employeeName })), value: ctx.auth.user.id },
      { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), value: 'Medium' },
      { name: 'schedulingMode', label: 'Scheduling', type: 'select', options: [{ value: 'FORWARD', label: 'Forward – from anchor/start date' }, { value: 'BACKWARD', label: 'Backward – from launch date' }] },
      { name: 'anchorDate', label: 'Anchor / planned start date', type: 'date', value: today(), required: true },
      { name: 'launchDate', label: 'Target launch date', type: 'date' },
      { name: 'templateId', label: 'Start from', type: 'select', options: [{ value: '', label: 'Standard activity master' }].concat(templates.map((t) => ({ value: t.id, label: `Template: ${t.name}` }))) },
      { name: 'productDescription', label: 'Product description', type: 'textarea', span2: true },
    ],
    submitText: 'Next: select activities →',
    onSubmit: (v) => { if (v.schedulingMode === 'BACKWARD' && !v.launchDate) throw new Error('Backward scheduling needs a launch date.'); return v; },
  });
  if (!info) return null;

  // Step 2 – activity selection + per-project overrides
  const source = info.templateId ? store.get(COLLECTIONS.templates, info.templateId).tasks.map((t) => ({ ...t, id: t.templateTaskId, defaultFprId: t.fprId })) : activities;
  const rows = source.map((a) => ({ a, include: true, fprId: a.defaultFprId, duration: a.expectedDuration, mandatory: a.isMandatory, approval: a.approvalRequired }));
  const tbody = el('tbody');
  const render = () => tbody.replaceChildren(...rows.map((r) => el('tr', { style: { opacity: r.include ? 1 : 0.45 } },
    el('td', {}, el('input', { type: 'checkbox', checked: r.include, onChange: (e) => { r.include = e.target.checked; render(); } })),
    el('td', { class: 'num' }, r.a.activityNo), el('td', {}, r.a.name), el('td', {}, r.a.department),
    el('td', {}, el('select', { onChange: (e) => { r.fprId = e.target.value || null; } }, [{ value: '', label: '—' }].concat(stks.map((s) => ({ value: s.id, label: s.employeeName }))).map((o) => el('option', { value: o.value, selected: (r.fprId || '') === o.value }, o.label)))),
    el('td', {}, el('input', { type: 'number', min: 0, value: r.duration, style: { width: '70px' }, onChange: (e) => { r.duration = Number(e.target.value); } })),
    el('td', {}, el('input', { type: 'checkbox', checked: r.mandatory, onChange: (e) => { r.mandatory = e.target.checked; } })),
    el('td', {}, el('input', { type: 'checkbox', checked: r.approval, onChange: (e) => { r.approval = e.target.checked; } })))));
  render();
  return new Promise((resolve) => {
    const err = el('div', { class: 'error-text' });
    const m = openModal({
      title: 'New project – step 2 of 2: activities, FPRs & durations', wide: true,
      body: el('div', {},
        el('p', { class: 'small muted' }, `Untick activities that do not apply. Dependencies between selected activities are copied from the ${info.templateId ? 'template' : 'master'}; more tasks can be added after creation. Default FPRs are starting references only.`),
        el('div', { class: 'flex mb' }, el('button', { class: 'btn btn-sm', onClick: () => { rows.forEach((r) => { r.include = true; }); render(); } }, 'Select all'), el('button', { class: 'btn btn-sm', onClick: () => { rows.forEach((r) => { r.include = false; }); render(); } }, 'Clear all')),
        el('div', { class: 'table-wrap', style: { maxHeight: '55vh', overflowY: 'auto' } }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ['', '#', 'Activity', 'Department', 'FPR', 'Days', 'Mandatory', 'Approval'].map((h) => el('th', {}, h)))), tbody)), err),
      footer: [
        el('button', { class: 'btn', onClick: () => { m.close(); resolve(null); } }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onClick: async () => {
          const sel = rows.filter((r) => r.include);
          if (!sel.length) { err.textContent = 'Select at least one activity.'; return; }
          try {
            setLoading(true);
            const { templateId, ...data } = info;
            const p = await actions.createProject(data, {
              templateId: templateId || undefined,
              activityIds: templateId ? undefined : sel.map((r) => r.a.id),
              fprOverrides: Object.fromEntries(sel.map((r) => [r.a.id, r.fprId])),
              durationOverrides: Object.fromEntries(sel.map((r) => [r.a.id, r.duration])),
              mandatoryOverrides: Object.fromEntries(sel.map((r) => [r.a.id, r.mandatory])),
              approvalOverrides: Object.fromEntries(sel.map((r) => [r.a.id, r.approval])),
            });
            if (templateId) {
              // template path: remove unticked tasks after creation
              const created = store.where(COLLECTIONS.projectTasks, (t) => t.projectId === p.id);
              for (const r of rows.filter((x) => !x.include)) { const t = created.find((c) => c.name === r.a.name && c.activityNo === r.a.activityNo); if (t) await actions.removeTask(t.id, 'Not selected at creation'); }
            }
            m.close(); toast(`Project ${p.projectCode} created with ${sel.length} tasks – schedule and Gantt generated`, 'success');
            nav(`project/${p.id}`); resolve(p);
          } catch (e) { err.textContent = e.message; } finally { setLoading(false); }
        } }, 'Create project & generate schedule'),
      ],
      onClose: () => resolve(null),
    });
  });
}

export async function editProjectForm(ctx, project) {
  const { store, actions } = ctx;
  const stks = store.all(COLLECTIONS.stakeholders).filter((s) => s.isActive !== false);
  const r = await formModal({
    title: `Edit project ${project.projectCode}`, wide: true,
    fields: [
      { name: 'name', label: 'Project name', required: true, value: project.name, span2: true },
      { name: 'brand', label: 'Brand', required: true, value: project.brand }, { name: 'category', label: 'Category', value: project.category },
      { name: 'categoryHead', label: 'Category head', value: project.categoryHead }, { name: 'kind', label: 'NPD / Transition', type: 'select', options: PROJECT_KINDS.map((k) => ({ value: k, label: k })), value: project.kind },
      { name: 'projectType', label: 'Project type', value: project.projectType }, { name: 'size', label: 'Size', value: project.size }, { name: 'variant', label: 'Variant', value: project.variant },
      { name: 'ownerId', label: 'Project owner', type: 'select', options: stks.map((s) => ({ value: s.id, label: s.employeeName })), value: project.ownerId },
      { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), value: project.priority },
      { name: 'status', label: 'Status', type: 'select', options: Object.values(PROJECT_STATUS).map((s) => ({ value: s, label: s.replace(/_/g, ' ') })), value: project.status, hint: 'COMPLETED is set automatically when all mandatory tasks finish' },
      { name: 'schedulingMode', label: 'Scheduling', type: 'select', options: SCHEDULING_MODES.map((s) => ({ value: s, label: s })), value: project.schedulingMode },
      { name: 'anchorDate', label: 'Anchor / planned start', type: 'date', value: project.anchorDate, required: true },
      { name: 'launchDate', label: 'Target launch date', type: 'date', value: project.launchDate || '' },
      { name: 'productDescription', label: 'Product description', type: 'textarea', value: project.productDescription, span2: true },
    ],
    onSubmit: async (v) => {
      const changes = {};
      for (const [k, val] of Object.entries(v)) if ((val || null) !== (project[k] || null)) changes[k] = val || null;
      if (!Object.keys(changes).length) return true;
      await actions.updateProject(project.id, changes, { expectedVersion: project.version });
      toast('Project updated', 'success');
      return true;
    },
  });
  return Boolean(r);
}

export function projectStatusBadge(p) {
  const map = { PLANNING: 'grey', IN_PROGRESS: 'blue', ON_HOLD: 'amber', COMPLETED: 'green', CANCELLED: 'red' };
  return badge(p.status.replace(/_/g, ' '), map[p.status] || 'grey');
}
