// Application bootstrap: store → seed → auth → router → pages.
import { DataStore } from './core/store.js';
import { LocalStorageAdapter } from './core/adapters/localStorageAdapter.js';
import { SharePointAdapter } from './core/adapters/sharePointAdapter.js';
import { seedMasters } from './core/seed.js';
import { seedSampleProjects } from './core/sampleData.js';
import { Auth } from './core/auth.js';
import { Actions } from './core/actions.js';
import { Excel } from './core/excel.js';
import { COLLECTIONS } from './core/models.js';
import { Router } from './ui/router.js';
import { el, toast, setLoading, closePanel, panelIsOpen } from './ui/components.js';
import { newProjectWizard } from './ui/projectForms.js';
import { openTaskPanel } from './ui/taskPanel.js';
import { ACTIONS } from './core/auth.js';

import * as executive from './ui/pages/executive.js';
import * as portfolio from './ui/pages/portfolio.js';
import * as gantt from './ui/pages/gantt.js';
import * as tasks from './ui/pages/tasks.js';
import * as activityMaster from './ui/pages/activityMaster.js';
import * as projectConfig from './ui/pages/projectConfig.js';
import * as dependencies from './ui/pages/dependencies.js';
import * as stakeholders from './ui/pages/stakeholders.js';
import * as analytics from './ui/pages/analytics.js';
import * as escalation from './ui/pages/escalation.js';
import * as projectDetail from './ui/pages/projectDetail.js';
import * as audit from './ui/pages/auditConfig.js';

const PAGES = {
  executive: { title: 'Executive Overview', mod: executive },
  portfolio: { title: 'Project Portfolio', mod: portfolio },
  gantt: { title: 'Interactive Gantt Chart', mod: gantt },
  tasks: { title: 'Task Management', mod: tasks },
  'activity-master': { title: 'Activity Master Management', mod: activityMaster },
  'project-config': { title: 'Project Task Configuration', mod: projectConfig },
  dependencies: { title: 'Dependency Management', mod: dependencies },
  stakeholders: { title: 'FPR & Stakeholder Management', mod: stakeholders },
  analytics: { title: 'Performance Analytics', mod: analytics },
  escalation: { title: 'Escalation Centre', mod: escalation },
  project: { title: 'Project Details', mod: projectDetail, nav: 'portfolio' },
  audit: { title: 'Audit & Configuration', mod: audit },
};

async function boot() {
  setLoading(true);
  const store = new DataStore(new LocalStorageAdapter());
  await store.load();
  const auth = new Auth(store);
  const actions = new Actions(store, auth);
  const excel = new Excel(store, actions);
  if (store.isEmpty()) {
    await seedMasters(store);
    auth.restore();
    await seedSampleProjects(actions, auth);
    toast('Initial baseline loaded: 30 activities, dependency matrix, stakeholders and 2 SAMPLE projects', 'success', 6000);
  }
  auth.restore();

  // Production adapter switch (only effective when configured – see docs/SHAREPOINT-INTEGRATION.md)
  const cfg = store.config();
  if (cfg.dataAdapter === 'sharepoint') {
    const sp = new SharePointAdapter(cfg.sharepoint || {});
    if (sp.configured()) { store.adapter = sp; await store.load(); }
    else toast('SharePoint adapter selected but not configured – using browser storage.', 'warn', 6000);
  }
  updateBadges(store);

  const router = new Router(route);
  const ctx = { store, auth, actions, excel, nav: (p) => router.go(p), openTask: (id, o) => openTaskPanel(ctx, id, o), rerender: () => router.dispatch(), state: {} };
  window.npd = ctx; // for debugging / acceptance tests

  let current = null;
  function route({ page, params, query }) {
    const def = PAGES[page] || PAGES.executive;
    document.getElementById('page-title').textContent = def.title;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === (def.nav || page)));
    document.getElementById('sidebar').classList.remove('open');
    const content = document.getElementById('content');
    content.replaceChildren();
    current = { page, params, query };
    try { def.mod.render(ctx, content, { params, query }); } catch (e) { console.error(e); content.append(el('div', { class: 'notice error' }, `Page error: ${e.message}`)); }
    if (query.task) openTaskPanel(ctx, query.task);
  }

  // re-render current page on data changes (debounced)
  let timer = null;
  store.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => { updateBadges(store); if (current && !document.querySelector('.modal-backdrop')) route(current); }, 60); });

  // user picker
  const sel = document.getElementById('user-select');
  const fillUsers = () => {
    sel.replaceChildren(...auth.users().map((u) => el('option', { value: u.id, selected: u.id === auth.user?.id }, `${u.employeeName} – ${u.role}`)));
    document.getElementById('user-role').textContent = `${auth.user?.role || ''}${auth.user?.department ? ` · ${auth.user.department}` : ''}`;
    document.getElementById('btn-new-project').style.display = auth.can(ACTIONS.CREATE_PROJECT) ? '' : 'none';
  };
  fillUsers();
  sel.addEventListener('change', () => { auth.signIn(sel.value); fillUsers(); closePanel(); toast(`Signed in as ${auth.user.name} (${auth.user.role}) – prototype login`, 'info'); router.dispatch(); });
  store.subscribe((c) => { if (c === COLLECTIONS.stakeholders) fillUsers(); });

  document.getElementById('btn-new-project').addEventListener('click', () => newProjectWizard(ctx));
  document.getElementById('menu-btn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('global-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') router.go(`tasks?q=${encodeURIComponent(e.target.value)}`); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelIsOpen()) closePanel(); });

  // scheduled notification checks (production: Power Automate recurrence flow)
  await actions.notifier.runScheduledChecks();
  setLoading(false);
  router.dispatch();
}

function updateBadges(store) {
  const cfg = store.config();
  const a = document.getElementById('adapter-badge'); const e = document.getElementById('email-badge'); const b = document.getElementById('proto-banner');
  const prodData = store.adapter?.isProduction;
  a.textContent = prodData ? 'PRODUCTION · SharePoint Lists' : 'PROTOTYPE · browser storage';
  a.classList.toggle('prod', Boolean(prodData));
  const prodMail = cfg.emailAutomation === 'powerautomate';
  e.textContent = prodMail ? 'E-mail: Power Automate queue' : 'E-mail: logged only (not sent)';
  e.classList.toggle('prod', prodMail);
  b.style.display = prodData && prodMail ? 'none' : '';
}

boot().catch((e) => { console.error(e); setLoading(false); document.getElementById('content').append(el('div', { class: 'notice error' }, `Failed to start: ${e.message}`)); });
