// Browser acceptance test (Playwright). Serve npd-tracker/ over HTTP first:
//   cd npd-tracker && python3 -m http.server 8123 &   then   node tests/browser-acceptance.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto('http://localhost:8123/index.html'); await p.waitForTimeout(2000);
  const ok = (n, c) => console.log(c ? 'PASS' : 'FAIL', n);
  // New project through the wizard
  await p.click('#btn-new-project'); await p.waitForSelector('.modal');
  await p.fill('input[name=name]', 'UI Test Project'); await p.fill('input[name=brand]', 'Brand C');
  await p.click('.modal-foot .btn-primary'); await p.waitForSelector('text=step 2 of 2');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1500);
  ok('wizard created project + navigated', /#\/project\//.test(await p.evaluate(() => location.hash)));
  const pid = await p.evaluate(() => window.npd.store.all('projects').find(x => x.name === 'UI Test Project')?.id);
  const n = await p.evaluate(i => window.npd.store.where('projectTasks', t => t.projectId === i).length, pid);
  ok('30 tasks generated (' + n + ')', n === 30);
  // add task through the form
  await p.evaluate(h => location.hash = h, '#/project-config?project=' + pid); await p.waitForTimeout(700);
  await p.click('text=+ Add task'); await p.waitForSelector('.modal');
  await p.fill('input[name=name]', 'Artwork Final Approval'); await p.selectOption('select[name=department]', 'Marketing');
  await p.fill('input[name=expectedDuration]', '4');
  await p.selectOption('select[name=predecessorIds]', { label: '23 · Vendor Proof Approval' });
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1200);
  const t = await p.evaluate(i => { const s = window.npd.store; const t = s.where('projectTasks', x => x.projectId === i && x.name === 'Artwork Final Approval')[0]; return t && { d: t.expectedDuration, deps: s.where('taskDependencies', d => d.taskId === t.id).length, start: t.plannedStart }; }, pid);
  ok('new task with predecessor + schedule ' + JSON.stringify(t), t && t.d === 4 && t.deps === 1 && t.start);
  // persistence
  await p.reload(); await p.waitForTimeout(1800);
  ok('persists after refresh', await p.evaluate(i => !!window.npd.store.where('projectTasks', x => x.projectId === i && x.name === 'Artwork Final Approval').length, pid));
  // role restriction: Management
  const mgmt = await p.evaluate(() => window.npd.store.all('stakeholders').find(s => s.role === 'Management').id);
  await p.selectOption('#user-select', mgmt); await p.waitForTimeout(500);
  await p.evaluate(h => location.hash = h, '#/tasks'); await p.waitForTimeout(900);
  ok('management sees no Start/Edit buttons', (await p.locator('#content button:has-text("Start")').count()) === 0 && (await p.locator('#content button:has-text("Edit")').count()) === 0);
  ok('management has no New Project button', !(await p.isVisible('#btn-new-project')));
  // admin: open task panel & start
  const adm = await p.evaluate(() => window.npd.store.all('stakeholders').find(s => s.role === 'Administrator').id);
  await p.selectOption('#user-select', adm); await p.waitForTimeout(400);
  const tid = await p.evaluate(i => window.npd.store.where('projectTasks', x => x.projectId === i && x.activityNo === 1)[0].id, pid);
  await p.evaluate(h => location.hash = h, '#/tasks?task=' + tid); await p.waitForTimeout(900);
  await p.click('#slide-panel button:has-text("Start Task")'); await p.waitForTimeout(900);
  const started = await p.evaluate(([i, id]) => ({ a: window.npd.store.get('projectTasks', id).actualStart, pj: window.npd.store.get('projects', i).actualStartDate }), [pid, tid]);
  ok('Start captured actual dates ' + JSON.stringify(started), started.a && started.pj);
  console.log('ERRORS', JSON.stringify(errs.slice(0, 8)));
  await b.close();
})();
