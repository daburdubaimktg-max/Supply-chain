// SAMPLE projects (clearly labelled, deletable). Created through the normal
// Actions API so they exercise the same code paths as real projects.

import { COLLECTIONS } from './models.js';
import { addCalendarDays, today as todayStr } from './calendar.js';

export async function seedSampleProjects(actions, auth) {
  const store = actions.store;
  const admin = store.all(COLLECTIONS.stakeholders).find((s) => s.role === 'Administrator');
  const prevUser = auth.user;
  auth.signIn(admin.id);
  const today = todayStr();
  const byName = (name) => store.all(COLLECTIONS.stakeholders).find((s) => s.employeeName === name);

  const a = await actions.createProject({
    name: '[SAMPLE] Herbal Toothpaste 150g Relaunch', brand: 'Brand A', category: 'Oral Care', categoryHead: 'Marketing Head',
    kind: 'NPD', projectType: 'New Variant', size: '150g', variant: 'Herbal Mint', productDescription: 'Sample NPD project generated from the activity master.',
    ownerId: byName('Bharath')?.id, launchDate: addCalendarDays(today, 150), priority: 'High', anchorDate: addCalendarDays(today, -30), isSample: true,
  });
  // Progress a few tasks so the dashboard shows real states.
  const tasksA = () => store.where(COLLECTIONS.projectTasks, (t) => t.projectId === a.id).sort((x, y) => x.activityNo - y.activityNo);
  const byNo = (no) => tasksA().find((t) => t.activityNo === no);
  await actions.startTask(byNo(1).id); await actions.submitForApproval(byNo(1).id, 'Brief ready');
  await actions.approveTask(byNo(1).id, 'Approved');
  await actions.startTask(byNo(2).id); await actions.submitForApproval(byNo(2).id); await actions.approveTask(byNo(2).id);
  await actions.startTask(byNo(3).id); await actions.completeTask(byNo(3).id);
  await actions.startTask(byNo(4).id); await actions.completeTask(byNo(4).id);
  await actions.startTask(byNo(7).id); await actions.completeTask(byNo(7).id);
  await actions.startTask(byNo(5).id);          // in progress (packaging closure)
  await actions.startTask(byNo(13).id);         // barcodes in progress
  await actions.startTask(byNo(14).id);         // PM codes in progress
  await actions.markNotRequired(byNo(6).id, 'Existing mould reused – no new mould development needed');
  await actions.addComment(byNo(5).id, 'Supplier shortlisted; awaiting closure sign-off from Packaging Head.');
  // Backdate a couple of actual dates so delays/overdue appear (direct store write, audited)
  for (const [no, start, end] of [[1, -30, -20], [2, -20, -20], [3, -19, -19], [4, -19, -8], [7, -18, -18], [5, -18, null], [13, -7, null], [14, -7, null]]) {
    const t = byNo(no);
    await store.update(COLLECTIONS.projectTasks, t.id, {
      actualStart: addCalendarDays(today, start), ...(end != null ? { actualEnd: addCalendarDays(today, end) } : {}),
    }, { auditSummary: 'Sample data: back-dated actual dates' });
  }
  await store.update(COLLECTIONS.projects, a.id, { actualStartDate: addCalendarDays(today, -30) }, { auditSummary: 'Sample data: back-dated project start' });
  await actions.recalculate(a.id, { reason: 'Sample data', skipAudit: true });

  const b = await actions.createProject({
    name: '[SAMPLE] Shampoo 400ml Pack Transition', brand: 'Brand B', category: 'Hair Care', categoryHead: 'Marketing Head',
    kind: 'Transition', projectType: 'Pack Change', size: '400ml', variant: 'Anti-Dandruff', productDescription: 'Sample Transition project with backward scheduling from launch date.',
    ownerId: byName('Mayuresh')?.id, launchDate: addCalendarDays(today, 200), priority: 'Medium', anchorDate: today, schedulingMode: 'BACKWARD', isSample: true,
  });
  const tasksB = store.where(COLLECTIONS.projectTasks, (t) => t.projectId === b.id);
  const bFg = tasksB.find((t) => t.activityNo === 4);
  await actions.changeFpr(bFg.id, byName('Marketing Head').id); // different FPR for the same activity in another project
  await actions.updateTask(tasksB.find((t) => t.activityNo === 5).id, { expectedDuration: 12 });

  if (prevUser) auth.signIn(prevUser.id);
  return [a, b];
}
