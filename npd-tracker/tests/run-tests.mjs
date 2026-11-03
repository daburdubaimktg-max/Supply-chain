// Core engine tests. Run: node npd-tracker/tests/run-tests.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DataStore, ConflictError } from '../js/core/store.js';
import { LocalStorageAdapter } from '../js/core/adapters/localStorageAdapter.js';
import { seedMasters } from '../js/core/seed.js';
import { Auth, ACTIONS } from '../js/core/auth.js';
import { Actions } from '../js/core/actions.js';
import { COLLECTIONS, TASK_STATUS, PROJECT_STATUS, APPROVAL_STATUS, ROLES } from '../js/core/models.js';
import { addWorkingDays, diffWorkingDays, endDateFor, isWorkingDay } from '../js/core/calendar.js';
import { validateDependencies, findCycle, topoSort } from '../js/core/dependencies.js';
import { computeSchedule } from '../js/core/scheduler.js';
import { classifyTask } from '../js/core/performance.js';
import { seedSampleProjects } from '../js/core/sampleData.js';

const cal = { weekendDays: [0, 6], holidays: [{ date: '2026-01-01', name: 'NY' }] };

async function freshApp() {
  globalThis.__npdMemoryStorage = undefined;
  const store = new DataStore(new LocalStorageAdapter());
  await store.load();
  await seedMasters(store);
  const auth = new Auth(store);
  auth.restore();
  const actions = new Actions(store, auth);
  return { store, auth, actions };
}
const stk = (store, name) => store.all(COLLECTIONS.stakeholders).find((s) => s.employeeName === name);
const taskNo = (store, projectId, no) => store.where(COLLECTIONS.projectTasks, (t) => t.projectId === projectId && t.activityNo === no)[0];

test('calendar: working-day arithmetic honours weekends and holidays', () => {
  assert.equal(isWorkingDay('2026-01-03', cal), false); // Saturday
  assert.equal(isWorkingDay('2026-01-01', cal), false); // holiday
  assert.equal(addWorkingDays('2025-12-31', 1, cal), '2026-01-02'); // skips holiday
  assert.equal(addWorkingDays('2026-01-02', 1, cal), '2026-01-05'); // Fri -> Mon
  assert.equal(endDateFor('2026-01-05', 5, cal), '2026-01-09');
  assert.equal(endDateFor('2026-01-05', 0, cal), '2026-01-05'); // milestone
  assert.equal(diffWorkingDays('2026-01-05', '2026-01-12', cal), 5);
  assert.equal(diffWorkingDays('2026-01-12', '2026-01-05', cal), -5);
});

test('dependencies: validator catches self, duplicate, missing, cycle, cross-project', () => {
  const nodes = [{ id: 'a', name: 'A', projectId: 'p' }, { id: 'b', name: 'B', projectId: 'p' }, { id: 'c', name: 'C', projectId: 'q' }];
  const deps = [{ id: 'd1', taskId: 'b', predecessorId: 'a', type: 'FS', lagDays: 0 }];
  assert.ok(validateDependencies(nodes, deps, { id: 'x', taskId: 'a', predecessorId: 'a', type: 'FS', lagDays: 0 }).some((e) => /itself/.test(e)));
  assert.ok(validateDependencies(nodes, deps, { id: 'x', taskId: 'b', predecessorId: 'a', type: 'FS', lagDays: 0 }).some((e) => /duplicate/i.test(e)));
  assert.ok(validateDependencies(nodes, deps, { id: 'x', taskId: 'b', predecessorId: 'zzz', type: 'FS', lagDays: 0 }).some((e) => /Invalid predecessor/.test(e)));
  assert.ok(validateDependencies(nodes, deps, { id: 'x', taskId: 'a', predecessorId: 'b', type: 'FS', lagDays: 0 }).some((e) => /Circular/.test(e)));
  assert.ok(validateDependencies(nodes, deps, { id: 'x', taskId: 'b', predecessorId: 'c', type: 'FS', lagDays: 0 }, { projectId: 'p' }).some((e) => /another project/.test(e)));
  assert.equal(validateDependencies(nodes, deps, { id: 'x', taskId: 'b', predecessorId: 'a', type: 'SS', lagDays: 2 }).length, 1); // only duplicate
  assert.equal(findCycle(nodes, deps), null);
  assert.deepEqual(topoSort(nodes.slice(0, 2), deps), ['a', 'b']);
});

test('scheduler: FS/SS/FF/SF with lag, milestones, backward mode', () => {
  const project = { anchorDate: '2026-01-05', schedulingMode: 'FORWARD' };
  const tasks = [
    { id: 't1', name: 'T1', expectedDuration: 5, status: 'NOT_STARTED' },
    { id: 't2', name: 'T2', expectedDuration: 0, status: 'NOT_STARTED' },
    { id: 't3', name: 'T3', expectedDuration: 3, status: 'NOT_STARTED' },
    { id: 't4', name: 'T4', expectedDuration: 2, status: 'NOT_STARTED' },
    { id: 't5', name: 'T5', expectedDuration: 4, status: 'NOT_STARTED' },
  ];
  const deps = [
    { taskId: 't2', predecessorId: 't1', type: 'FS', lagDays: 0 },
    { taskId: 't3', predecessorId: 't1', type: 'SS', lagDays: 2 },
    { taskId: 't4', predecessorId: 't1', type: 'FF', lagDays: 1 },
    { taskId: 't5', predecessorId: 't1', type: 'FS', lagDays: 3 },
  ];
  const r = computeSchedule(project, tasks, deps, cal, { today: '2026-01-05' });
  const s = (id) => r.schedule.get(id);
  assert.equal(s('t1').plannedStart, '2026-01-05'); assert.equal(s('t1').plannedEnd, '2026-01-09');
  assert.equal(s('t2').plannedStart, '2026-01-12'); assert.equal(s('t2').plannedEnd, '2026-01-12'); // milestone next working day
  assert.equal(s('t3').plannedStart, '2026-01-07'); // SS + 2
  assert.equal(s('t4').plannedEnd, '2026-01-12'); // FF + 1
  assert.equal(s('t5').plannedStart, '2026-01-15'); // FS + lag 3 => 12,13,14 lag -> 15
  assert.equal(r.projectPlannedEnd, '2026-01-20');
  assert.ok(s('t5').isCritical);

  const back = computeSchedule({ ...project, schedulingMode: 'BACKWARD', launchDate: '2026-03-02' }, tasks, deps, cal, { today: '2026-01-05' });
  assert.equal(back.projectPlannedEnd, '2026-03-02'); // ends on launch date (Mon 2 Mar is a working day)
  assert.equal(computeSchedule({ ...project, schedulingMode: 'BACKWARD', launchDate: '2026-02-28' }, tasks, deps, cal, { today: '2026-01-05' }).projectPlannedEnd, '2026-02-27'); // Sat launch -> Fri
  assert.ok(back.schedule.get('t1').plannedStart > '2026-01-05');
});

test('scheduler: NOT_REQUIRED predecessor does not delay successors', () => {
  const project = { anchorDate: '2026-01-05' };
  const tasks = [
    { id: 'a', name: 'A', expectedDuration: 10, status: TASK_STATUS.NOT_REQUIRED },
    { id: 'b', name: 'B', expectedDuration: 2, status: 'NOT_STARTED' },
  ];
  const r = computeSchedule(project, tasks, [{ taskId: 'b', predecessorId: 'a', type: 'FS', lagDays: 0 }], cal, { today: '2026-01-05' });
  assert.equal(r.schedule.get('b').plannedStart, '2026-01-05');
  assert.equal(r.schedule.has('a'), false);
});

test('seed: 30 activities and the dependency matrix load and schedule without cycles', async () => {
  const { store, actions } = await freshApp();
  assert.equal(store.all(COLLECTIONS.activityMaster).length, 30);
  assert.equal(store.all(COLLECTIONS.masterDependencies).length, 38);
  const bom = store.get(COLLECTIONS.activityMaster, 'act_16');
  const preds = store.where(COLLECTIONS.masterDependencies, (d) => d.taskId === bom.id).map((d) => d.predecessorId).sort();
  assert.deepEqual(preds, ['act_04', 'act_09', 'act_14']);
  const p = await actions.createProject({ name: 'P', brand: 'B', anchorDate: '2026-01-05' });
  const tasks = store.where(COLLECTIONS.projectTasks, (t) => t.projectId === p.id);
  assert.equal(tasks.length, 30);
  assert.equal(store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === p.id).length, 38);
  assert.ok(tasks.every((t) => t.plannedStart && t.plannedEnd));
  const last = taskNo(store, p.id, 30);
  assert.equal(store.get(COLLECTIONS.projects, p.id).plannedEndDate, last.plannedEnd);
  assert.ok(last.isCritical);
});

test('acceptance 1-18: two projects, independent task/FPR/duration/dependency config, audit', async () => {
  const { store, actions } = await freshApp();
  const A = await actions.createProject({ name: 'Project A', brand: 'Brand A', anchorDate: '2026-01-05' });
  const B = await actions.createProject({ name: 'Project B', brand: 'Brand B', anchorDate: '2026-01-05' });
  const bharath = stk(store, 'Bharath'); const mayuresh = stk(store, 'Mayuresh');
  const vpaA = taskNo(store, A.id, 23); const vpaB = taskNo(store, B.id, 23);

  const tA = await actions.addTask(A.id, { name: 'Artwork Final Approval', department: 'Marketing', fprId: bharath.id, expectedDuration: 4, approvalRequired: true });
  const tB = await actions.addTask(B.id, { name: 'Artwork Final Approval', department: 'Packaging', fprId: mayuresh.id, expectedDuration: 7 });
  await actions.addDependency(A.id, tA.id, vpaA.id, 'FS', 0);
  await actions.addDependency(B.id, tB.id, vpaB.id, 'FS', 0);

  const a1 = store.get(COLLECTIONS.projectTasks, tA.id); const b1 = store.get(COLLECTIONS.projectTasks, tB.id);
  assert.equal(a1.expectedDuration, 4); assert.equal(b1.expectedDuration, 7);
  assert.equal(a1.fprId, bharath.id); assert.equal(b1.fprId, mayuresh.id);
  assert.equal(a1.plannedStart, addWorkingDays(vpaA.plannedEnd, 1, store.calendar()));
  assert.equal(diffWorkingDays(a1.plannedStart, a1.plannedEnd, store.calendar()), 3);
  assert.equal(diffWorkingDays(b1.plannedStart, b1.plannedEnd, store.calendar()), 6);

  // changing A must not affect B
  await actions.updateTask(tA.id, { expectedDuration: 10 });
  assert.equal(store.get(COLLECTIONS.projectTasks, tB.id).expectedDuration, 7);

  // second predecessor + type change + validation + removal + downstream recalculation
  const proofing = taskNo(store, A.id, 24);
  const dep2 = await actions.addDependency(A.id, tA.id, proofing.id, 'FS', 0);
  await assert.rejects(() => actions.addDependency(A.id, tA.id, proofing.id, 'FS', 0), /duplicate/i);
  await assert.rejects(() => actions.addDependency(A.id, proofing.id, tA.id, 'FS', 0), /Circular/);
  await assert.rejects(() => actions.addDependency(A.id, tA.id, tA.id, 'FS', 0), /itself/);
  await assert.rejects(() => actions.addDependency(A.id, tA.id, vpaB.id, 'FS', 0), /another project/);
  await actions.updateDependency(dep2.id, { type: 'SS', lagDays: 1 });
  assert.equal(store.get(COLLECTIONS.taskDependencies, dep2.id).type, 'SS');
  const beforeRemove = store.get(COLLECTIONS.projectTasks, tA.id).plannedStart;
  await actions.removeDependency(dep2.id);
  const afterRemove = store.get(COLLECTIONS.projectTasks, tA.id).plannedStart;
  assert.ok(afterRemove <= beforeRemove);
  assert.equal(store.where(COLLECTIONS.taskDependencies, (d) => d.taskId === tA.id).length, 1);

  // downstream recalculation: lengthen Vendor Proof Approval and check the new task moves
  const before = store.get(COLLECTIONS.projectTasks, tA.id).plannedStart;
  await actions.updateTask(vpaA.id, { expectedDuration: 13 });
  const after = store.get(COLLECTIONS.projectTasks, tA.id).plannedStart;
  assert.equal(diffWorkingDays(before, after, store.calendar()), 10);

  // FPR change -> audit trail records previous and new FPR
  await actions.changeFpr(tA.id, mayuresh.id);
  const aud = store.all(COLLECTIONS.auditLog).filter((x) => x.recordId === tA.id && x.action === 'UPDATE');
  assert.ok(aud.some((x) => x.changes.some((c) => c.field === 'fprId' && c.from === bharath.id && c.to === mayuresh.id)));
});

test('acceptance 19-27: lifecycle, approvals, auto project dates, blocked, optional, NOT REQUIRED', async () => {
  const { store, auth, actions } = await freshApp();
  const P = await actions.createProject({ name: 'Lifecycle', brand: 'Brand A', anchorDate: '2026-01-05' }, { activityIds: ['act_01', 'act_02', 'act_03', 'act_04', 'act_13'] });
  const t1 = taskNo(store, P.id, 1); const t2 = taskNo(store, P.id, 2); const t3 = taskNo(store, P.id, 3); const t4 = taskNo(store, P.id, 4); const t13 = taskNo(store, P.id, 13);
  assert.equal(store.get(COLLECTIONS.projects, P.id).actualStartDate, null);

  // blocked: FG Code depends on NPPF
  await assert.rejects(() => actions.startTask(t4.id), /blocked/);

  const started = await actions.startTask(t1.id);
  assert.equal(started.status, TASK_STATUS.IN_PROGRESS);
  assert.ok(started.actualStart); assert.equal(started.actualStartBy, auth.user.name);
  const proj = store.get(COLLECTIONS.projects, P.id);
  assert.ok(proj.actualStartDate); assert.equal(proj.status, PROJECT_STATUS.IN_PROGRESS);

  // approval flow
  await assert.rejects(() => actions.completeTask(t2.id), /Start the task|requires approval|awaiting/);
  await actions.startTask(t2.id);
  const secondStart = store.get(COLLECTIONS.projects, P.id).actualStartDate;
  assert.equal(secondStart, proj.actualStartDate); // not overwritten
  await actions.submitForApproval(t2.id);
  assert.equal(store.get(COLLECTIONS.projectTasks, t2.id).approvalStatus, APPROVAL_STATUS.PENDING);
  await assert.rejects(() => actions.rejectTask(t2.id, ''), /reason/);
  await actions.rejectTask(t2.id, 'Missing SRP sheet');
  assert.equal(store.get(COLLECTIONS.projectTasks, t2.id).status, TASK_STATUS.IN_PROGRESS);
  await actions.submitForApproval(t2.id);
  await actions.approveTask(t2.id, 'ok');
  const t2done = store.get(COLLECTIONS.projectTasks, t2.id);
  assert.equal(t2done.status, TASK_STATUS.COMPLETED); assert.ok(t2done.actualEnd);
  assert.equal(store.all(COLLECTIONS.approvalHistory).filter((h) => h.taskId === t2.id).map((h) => h.action).join(','), 'SUBMITTED,REJECTED,SUBMITTED,APPROVED');

  // t1 approval required: complete directly by admin counts as approval
  await actions.completeTask(t1.id);
  await actions.startTask(t3.id); await actions.completeTask(t3.id);
  await actions.startTask(t4.id); await actions.completeTask(t4.id);
  // t13 optional: mark not required -> project should close
  await actions.updateTask(t13.id, { isMandatory: false });
  assert.equal(store.get(COLLECTIONS.projects, P.id).status, PROJECT_STATUS.IN_PROGRESS);
  await actions.markNotRequired(t13.id, 'Barcode unchanged');
  assert.equal(store.get(COLLECTIONS.projectTasks, t13.id).status, TASK_STATUS.NOT_REQUIRED);
  // closure happens when every mandatory task is complete (t13 is optional & not required)
  const closed = store.get(COLLECTIONS.projects, P.id);
  assert.equal(closed.status, PROJECT_STATUS.COMPLETED); assert.ok(closed.actualEndDate);

  // reopen -> project reopens, closure record preserved
  await assert.rejects(() => actions.reopenTask(t4.id, ''), /reason/);
  await actions.reopenTask(t4.id, 'Code rejected by SAP');
  const reopened = store.get(COLLECTIONS.projects, P.id);
  assert.equal(reopened.status, PROJECT_STATUS.IN_PROGRESS);
  assert.equal(reopened.closureHistory.length, 2);
  assert.equal(reopened.closureHistory[0].event, 'CLOSED');
  const t4r = store.get(COLLECTIONS.projectTasks, t4.id);
  assert.equal(t4r.actualEnd, null); assert.equal(t4r.reopenHistory.length, 1); assert.ok(t4r.reopenHistory[0].previousActualEnd);
  await actions.completeTask(t4.id);
  assert.equal(store.get(COLLECTIONS.projects, P.id).closureHistory.length, 3);

  const hist = store.all(COLLECTIONS.taskHistory).filter((h) => h.taskId === t4.id).map((h) => h.event);
  assert.deepEqual(hist, ['STARTED', 'COMPLETED', 'REOPENED', 'COMPLETED']);
});

test('acceptance 29-30: permissions enforced; concurrent edits detected', async () => {
  const { store, auth, actions } = await freshApp();
  const P = await actions.createProject({ name: 'Perm', brand: 'Brand A', anchorDate: '2026-01-05' });
  const fg = taskNo(store, P.id, 4);   // FPR Bharath, Marketing
  const nppf = taskNo(store, P.id, 2);
  const mayuresh = stk(store, 'Mayuresh');
  auth.signIn(mayuresh.id);
  await assert.rejects(() => actions.startTask(nppf.id), /Permission denied/);
  await assert.rejects(() => actions.addActivity({ name: 'X' }), /Permission denied/);
  await assert.rejects(() => actions.addDependency(P.id, fg.id, nppf.id), /Permission denied/);
  auth.signIn(stk(store, 'Bharath').id);
  await actions.startTask(nppf.id);
  await assert.rejects(() => actions.updateTask(nppf.id, { expectedDuration: 9 }), /may not edit/);
  await actions.updateTask(nppf.id, { description: 'note' });
  auth.signIn(stk(store, 'Management Viewer').id);
  await assert.rejects(() => actions.startTask(fg.id), /Permission denied/);
  assert.equal(auth.can(ACTIONS.VIEW_ALL), true);
  auth.signIn(stk(store, 'Marketing Head').id);
  await actions.submitForApproval(nppf.id);
  await actions.approveTask(nppf.id);

  // concurrency: stale version rejected
  auth.signIn(stk(store, 'System Administrator').id);
  const v = store.get(COLLECTIONS.projectTasks, fg.id).version;
  await actions.updateTask(fg.id, { priority: 'High' }, { expectedVersion: v });
  await assert.rejects(() => actions.updateTask(fg.id, { priority: 'Low' }, { expectedVersion: v }), ConflictError);
});

test('master: edit/add/deactivate/delete rules; master changes do not touch projects; apply with preview', async () => {
  const { store, actions } = await freshApp();
  const P = await actions.createProject({ name: 'M', brand: 'Brand A', anchorDate: '2026-01-05' });
  await actions.updateActivity('act_04', { expectedDuration: 15, name: 'FG Code (SAP)' });
  assert.equal(taskNo(store, P.id, 4).expectedDuration, 8);
  assert.equal(taskNo(store, P.id, 4).name, 'FG Code');
  const newAct = await actions.addActivity({ name: 'Artwork Final Approval', department: 'Marketing', expectedDuration: 4, approvalRequired: true });
  await actions.addMasterDependency(newAct.id, 'act_23', 'FS', 0);
  await assert.rejects(() => actions.addMasterDependency('act_23', newAct.id), /Circular/);
  await assert.rejects(() => actions.deleteActivity('act_04'), /used by/);
  await actions.setActivityActive('act_03', false);
  const preview = actions.previewMasterApply(P.id);
  assert.ok(preview.some((c) => c.kind === 'ADD' && c.activity.id === newAct.id));
  assert.ok(preview.some((c) => c.kind === 'UPDATE' && c.activity.id === 'act_04'));
  await actions.applyMasterToProject(P.id);
  assert.equal(taskNo(store, P.id, 4).expectedDuration, 15);
  const added = store.where(COLLECTIONS.projectTasks, (t) => t.projectId === P.id && t.activityId === newAct.id)[0];
  assert.ok(added); assert.equal(store.where(COLLECTIONS.taskDependencies, (d) => d.taskId === added.id).length, 1);
  await actions.deleteActivity(newAct.id).catch(() => {});
  const P2 = await actions.createProject({ name: 'M2', brand: 'Brand B', anchorDate: '2026-01-05' });
  assert.equal(taskNo(store, P2.id, 3), undefined); // deactivated activity not copied
  const tpl = await actions.saveAsTemplate(P.id, 'Tpl');
  const P3 = await actions.createProject({ name: 'FromTpl', brand: 'Brand C', anchorDate: '2026-01-05' }, { templateId: tpl.id });
  assert.equal(store.where(COLLECTIONS.projectTasks, (t) => t.projectId === P3.id).length, store.where(COLLECTIONS.projectTasks, (t) => t.projectId === P.id).length);
});

test('performance: task classification (overdue, blocked)', async () => {
  const { store, actions } = await freshApp();
  const P = await actions.createProject({ name: 'N', brand: 'Brand A', anchorDate: '2025-12-01' });
  const cfg = store.config(); const c = store.calendar();
  const t1 = taskNo(store, P.id, 1);
  const tasksById = new Map(store.where(COLLECTIONS.projectTasks, (t) => t.projectId === P.id).map((t) => [t.id, t]));
  const deps = store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === P.id);
  assert.equal(classifyTask(t1, { tasksById, deps, cal: c, config: cfg, today: '2026-02-01' }), 'OVERDUE');
  assert.equal(classifyTask(taskNo(store, P.id, 4), { tasksById, deps, cal: c, config: cfg, today: '2025-11-01' }), 'BLOCKED');
});

test('sample data: two SAMPLE projects seed through the public API and persist after reload', async () => {
  const { store, auth, actions } = await freshApp();
  const [a, b] = await seedSampleProjects(actions, auth);
  assert.ok(a.isSample && b.isSample);
  assert.equal(store.get(COLLECTIONS.projects, a.id).status, PROJECT_STATUS.IN_PROGRESS);
  const store2 = new DataStore(new LocalStorageAdapter());
  await store2.load();
  assert.equal(store2.all(COLLECTIONS.projects).length, 2);
  assert.equal(store2.where(COLLECTIONS.projectTasks, (t) => t.projectId === a.id).length, 30);
});
