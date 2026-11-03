// Task delay & performance engine + KPI aggregation. Pure functions.

import { diffWorkingDays, today as todayStr } from './calendar.js';
import { TASK_STATUS, PERF_STATUS, APPROVAL_STATUS, PROJECT_STATUS } from './models.js';

export const STATUS_COLORS = {
  [PERF_STATUS.NOT_STARTED]: 'grey',
  [PERF_STATUS.BLOCKED]: 'grey',
  [PERF_STATUS.IN_PROGRESS]: 'blue',
  [PERF_STATUS.DUE_SOON]: 'amber',
  [PERF_STATUS.AT_RISK]: 'amber',
  [PERF_STATUS.OVERDUE]: 'red',
  [PERF_STATUS.PENDING_APPROVAL]: 'purple',
  [PERF_STATUS.COMPLETED_ON_TIME]: 'green',
  [PERF_STATUS.COMPLETED_LATE]: 'green',
  [PERF_STATUS.ON_HOLD]: 'grey',
  [PERF_STATUS.NOT_REQUIRED]: 'grey',
};

// Is every predecessor of this task satisfied?  NOT_REQUIRED or inactive predecessors count as satisfied.
export function blockingPredecessors(task, tasksById, deps) {
  const out = [];
  for (const d of deps.filter((q) => q.taskId === task.id)) {
    const p = tasksById.get(d.predecessorId);
    if (!p || p.isActive === false || p.status === TASK_STATUS.NOT_REQUIRED) continue;
    const satisfied = (d.type === 'SS' || d.type === 'SF')
      ? Boolean(p.actualStart) || p.status === TASK_STATUS.COMPLETED
      : p.status === TASK_STATUS.COMPLETED;
    if (!satisfied) out.push(p);
  }
  return out;
}

export function isBlocked(task, tasksById, deps) {
  return blockingPredecessors(task, tasksById, deps).length > 0;
}

export function classifyTask(task, { tasksById, deps, cal, config, today = todayStr() }) {
  const dueSoon = Number(config?.dueSoonThresholdDays ?? 2);
  const atRisk = Number(config?.atRiskThresholdDays ?? 0);
  if (task.isActive === false || task.status === TASK_STATUS.NOT_REQUIRED) return PERF_STATUS.NOT_REQUIRED;
  if (task.status === TASK_STATUS.ON_HOLD) return PERF_STATUS.ON_HOLD;
  if (task.status === TASK_STATUS.COMPLETED) {
    const delay = task.plannedEnd && task.actualEnd ? diffWorkingDays(task.plannedEnd, task.actualEnd, cal) : 0;
    return delay > 0 ? PERF_STATUS.COMPLETED_LATE : PERF_STATUS.COMPLETED_ON_TIME;
  }
  if (task.status === TASK_STATUS.PENDING_APPROVAL) {
    if (task.plannedEnd && diffWorkingDays(task.plannedEnd, today, cal) > 0) return PERF_STATUS.OVERDUE;
    return PERF_STATUS.PENDING_APPROVAL;
  }
  const overdueDays = task.plannedEnd ? diffWorkingDays(task.plannedEnd, today, cal) : 0;
  if (overdueDays > 0) return PERF_STATUS.OVERDUE;
  if (task.status === TASK_STATUS.NOT_STARTED && tasksById && deps && isBlocked(task, tasksById, deps)) return PERF_STATUS.BLOCKED;
  if (task.plannedEnd && -overdueDays <= dueSoon) return PERF_STATUS.DUE_SOON;
  if (task.forecastEnd && task.plannedEnd && diffWorkingDays(task.plannedEnd, task.forecastEnd, cal) > atRisk) return PERF_STATUS.AT_RISK;
  if (task.status === TASK_STATUS.IN_PROGRESS) return PERF_STATUS.IN_PROGRESS;
  return PERF_STATUS.NOT_STARTED;
}

export function taskMetrics(task, cal, today = todayStr()) {
  const plannedDuration = task.plannedStart && task.plannedEnd ? diffWorkingDays(task.plannedStart, task.plannedEnd, cal) + 1 : null;
  const actualDuration = task.actualStart && task.actualEnd ? diffWorkingDays(task.actualStart, task.actualEnd, cal) + 1 : null;
  let delayDays = null;
  if (task.status === TASK_STATUS.COMPLETED && task.actualEnd && task.plannedEnd) delayDays = diffWorkingDays(task.plannedEnd, task.actualEnd, cal);
  else if (task.status !== TASK_STATUS.NOT_REQUIRED && task.plannedEnd) delayDays = Math.max(0, diffWorkingDays(task.plannedEnd, today, cal));
  return { plannedDuration, actualDuration, delayDays };
}

export function countsBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it) ?? 'Unknown'; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

export function avgBy(items, keyFn, valFn) {
  const m = new Map();
  for (const it of items) {
    const v = valFn(it); if (v == null) continue;
    const k = keyFn(it) ?? 'Unknown';
    const e = m.get(k) || { sum: 0, n: 0 }; e.sum += v; e.n += 1; m.set(k, e);
  }
  return new Map(Array.from(m, ([k, e]) => [k, Math.round((e.sum / e.n) * 10) / 10]));
}

// Project-level roll-up
export function projectSummary(project, tasks, deps, cal, config, today = todayStr()) {
  const active = tasks.filter((t) => t.isActive !== false && t.status !== TASK_STATUS.NOT_REQUIRED);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const classes = active.map((t) => classifyTask(t, { tasksById, deps, cal, config, today }));
  const completed = active.filter((t) => t.status === TASK_STATUS.COMPLETED).length;
  const overdue = classes.filter((c) => c === PERF_STATUS.OVERDUE).length;
  const atRisk = classes.filter((c) => c === PERF_STATUS.AT_RISK || c === PERF_STATUS.DUE_SOON).length;
  const blocked = classes.filter((c) => c === PERF_STATUS.BLOCKED).length;
  const delayedTasks = active.filter((t) => taskMetrics(t, cal, today).delayDays > 0).length;
  const completionPct = active.length ? Math.round((completed / active.length) * 100) : 0;
  const plannedEnd = project.plannedEndDate || null;
  const isDelayed = project.status !== PROJECT_STATUS.COMPLETED && (overdue > 0 || (plannedEnd && diffWorkingDays(plannedEnd, today, cal) > 0));
  const launchRisk = project.launchDate && plannedEnd && plannedEnd > project.launchDate;
  return { total: active.length, completed, overdue, atRisk, blocked, delayedTasks, completionPct, isDelayed, launchRisk };
}

export function pendingApproval(task) { return task.approvalStatus === APPROVAL_STATUS.PENDING; }
