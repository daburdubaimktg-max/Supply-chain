// Enriched task rows shared by many pages (joins project, FPR, performance class, metrics).
import { COLLECTIONS, TASK_STATUS } from '../core/models.js';
import { classifyTask, taskMetrics, projectSummary } from '../core/performance.js';

export function enrichedTasks(store, { projectId } = {}) {
  const cal = store.calendar(); const cfg = store.config();
  const projects = new Map(store.all(COLLECTIONS.projects).map((p) => [p.id, p]));
  const stks = new Map(store.all(COLLECTIONS.stakeholders).map((s) => [s.id, s]));
  const tasks = store.all(COLLECTIONS.projectTasks).filter((t) => !projectId || t.projectId === projectId);
  const byProject = new Map();
  for (const t of tasks) { if (!byProject.has(t.projectId)) byProject.set(t.projectId, []); byProject.get(t.projectId).push(t); }
  const out = [];
  for (const [pid, list] of byProject) {
    const tasksById = new Map(store.where(COLLECTIONS.projectTasks, (t) => t.projectId === pid).map((t) => [t.id, t]));
    const deps = store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === pid);
    const project = projects.get(pid);
    for (const t of list) {
      const preds = deps.filter((d) => d.taskId === t.id).map((d) => tasksById.get(d.predecessorId)).filter(Boolean);
      out.push({
        ...t, task: t, project, projectCode: project?.projectCode, projectName: project?.name, brand: project?.brand,
        fprName: stks.get(t.fprId)?.employeeName || '—', approverName: stks.get(t.approverId)?.employeeName || '—',
        perf: classifyTask(t, { tasksById, deps, cal, config: cfg }), metrics: taskMetrics(t, cal),
        predecessorText: preds.map((p) => p.activityNo).join(', '), predecessors: preds,
      });
    }
  }
  return out;
}

export function projectRows(store) {
  const cal = store.calendar(); const cfg = store.config();
  const stks = new Map(store.all(COLLECTIONS.stakeholders).map((s) => [s.id, s]));
  return store.all(COLLECTIONS.projects).map((p) => {
    const tasks = store.where(COLLECTIONS.projectTasks, (t) => t.projectId === p.id);
    const deps = store.where(COLLECTIONS.taskDependencies, (d) => d.projectId === p.id);
    const s = projectSummary(p, tasks, deps, cal, cfg);
    return { ...p, project: p, ownerName: stks.get(p.ownerId)?.employeeName || '—', summary: s };
  });
}

export function isOpenTask(t) { return t.isActive !== false && ![TASK_STATUS.COMPLETED, TASK_STATUS.NOT_REQUIRED].includes(t.status); }
