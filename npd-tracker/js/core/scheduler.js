// Central scheduling engine.
//
// computeSchedule(project, tasks, deps, calendar, { today }) returns a map
// taskId -> { plannedStart, plannedEnd, forecastStart, forecastEnd, isCritical, slack }
// It never mutates input and never touches actual dates – callers persist results.
//
// Rules
//  - Only active tasks that are not NOT_REQUIRED are scheduled. A NOT_REQUIRED
//    predecessor is treated as satisfied at the project anchor (it adds no delay).
//  - Duration 0 => milestone (start = end).
//  - FS: succ.start >= pred.end + lag (+1 working day, i.e. next working day after pred.end)
//    SS: succ.start >= pred.start + lag
//    FF: succ.end   >= pred.end + lag
//    SF: succ.end   >= pred.start + lag
//  - Forward mode anchors at project.anchorDate (or launchDate fallback / today).
//  - Backward mode schedules as-late-as-possible so that the last task ends on launchDate.
//  - manualPlannedStart on a task overrides the computed start (task is "pinned"), unless
//    that would violate a dependency, in which case the dependency wins (and the engine reports it).
//  - Forecast: actual dates where present; in-progress tasks forecast end = max(plannedEnd, today + remaining);
//    not-started tasks are pushed by forecast of predecessors; never before today.

import {
  addWorkingDays, endDateFor, startDateFor, nextWorkingDay, prevWorkingDay, maxDate, minDate,
  diffWorkingDays, today as todayStr,
} from './calendar.js';
import { topoSort, buildGraph } from './dependencies.js';
import { TASK_STATUS } from './models.js';

const isSchedulable = (t) => t.isActive !== false && t.status !== TASK_STATUS.NOT_REQUIRED;

function constraintFor(dep, predStart, predEnd, cal, duration) {
  // returns { minStart, minEnd }
  const lag = Number(dep.lagDays || 0);
  switch (dep.type) {
    case 'SS': return { minStart: addWorkingDays(predStart, lag, cal), minEnd: null };
    case 'FF': return { minStart: null, minEnd: addWorkingDays(predEnd, lag, cal) };
    case 'SF': return { minStart: null, minEnd: addWorkingDays(predStart, lag, cal) };
    case 'FS':
    default: {
      // next working day after pred end, plus lag
      const base = duration === undefined ? predEnd : predEnd;
      return { minStart: addWorkingDays(base, lag + 1, cal), minEnd: null };
    }
  }
}

function backwardConstraintFor(dep, succStart, succEnd, cal) {
  // For predecessor given successor dates: returns { maxStart, maxEnd }
  const lag = Number(dep.lagDays || 0);
  switch (dep.type) {
    case 'SS': return { maxStart: addWorkingDays(succStart, -lag, cal), maxEnd: null };
    case 'FF': return { maxStart: null, maxEnd: addWorkingDays(succEnd, -lag, cal) };
    case 'SF': return { maxStart: addWorkingDays(succEnd, -lag, cal), maxEnd: null };
    case 'FS':
    default: return { maxStart: null, maxEnd: addWorkingDays(succStart, -(lag + 1), cal) };
  }
}

export function computeSchedule(project, allTasks, allDeps, cal, opts = {}) {
  const today = opts.today || todayStr();
  const tasks = allTasks.filter(isSchedulable);
  const idSet = new Set(tasks.map((t) => t.id));
  const deps = allDeps.filter((d) => idSet.has(d.taskId) && idSet.has(d.predecessorId));
  const order = topoSort(tasks, deps);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const { preds, succs } = buildGraph(tasks, deps);
  const anchor = nextWorkingDay(project.anchorDate || project.launchDate || today, cal);
  const result = new Map();
  const warnings = [];

  // ---- Forward pass (planned, ASAP) -----------------------------------------
  const planned = new Map();
  for (const id of order) {
    const t = byId.get(id);
    const dur = Number(t.expectedDuration || 0);
    let minStart = anchor;
    let minEnd = null;
    for (const d of preds.get(id)) {
      const p = planned.get(d.predecessorId);
      if (!p) continue;
      const c = constraintFor(d, p.start, p.end, cal);
      if (c.minStart) minStart = maxDate(minStart, c.minStart);
      if (c.minEnd) minEnd = maxDate(minEnd, c.minEnd);
    }
    if (minEnd) {
      const sFromEnd = startDateFor(minEnd, dur, cal);
      minStart = maxDate(minStart, sFromEnd);
    }
    let start = minStart;
    if (t.manualPlannedStart) {
      const pinned = nextWorkingDay(t.manualPlannedStart, cal);
      if (pinned >= minStart) start = pinned;
      else warnings.push({ taskId: id, message: `Pinned start ${t.manualPlannedStart} violates a dependency; dependency wins.` });
    }
    const end = endDateFor(start, dur, cal);
    planned.set(id, { start, end });
  }

  // ---- Backward mode: shift everything so project ends on launch date -------
  if (project.schedulingMode === 'BACKWARD' && project.launchDate) {
    const late = new Map();
    const target = prevWorkingDay(project.launchDate, cal);
    for (const id of [...order].reverse()) {
      const t = byId.get(id);
      const dur = Number(t.expectedDuration || 0);
      let maxEnd = target;
      let maxStart = null;
      for (const d of succs.get(id)) {
        const s = late.get(d.taskId);
        if (!s) continue;
        const c = backwardConstraintFor(d, s.start, s.end, cal);
        if (c.maxEnd) maxEnd = minDate(maxEnd, c.maxEnd);
        if (c.maxStart) maxStart = minDate(maxStart, c.maxStart);
      }
      if (maxStart) maxEnd = minDate(maxEnd, endDateFor(maxStart, dur, cal));
      const start = startDateFor(maxEnd, dur, cal);
      late.set(id, { start, end: endDateFor(start, dur, cal) });
    }
    for (const id of order) {
      const l = late.get(id);
      const t = byId.get(id);
      if (t.manualPlannedStart) continue; // pinned tasks keep forward dates
      planned.set(id, l);
    }
    const earliest = minDate(...Array.from(late.values()).map((v) => v.start));
    if (earliest && earliest < today) warnings.push({ taskId: null, message: `Backward schedule requires starting on ${earliest}, which is in the past.` });
  }

  // ---- Critical path (longest path by duration, zero slack) -----------------
  const projectEnd = maxDate(...Array.from(planned.values()).map((v) => v.end));
  const lateFinish = new Map();
  for (const id of [...order].reverse()) {
    const t = byId.get(id);
    const dur = Number(t.expectedDuration || 0);
    let lf = projectEnd;
    for (const d of succs.get(id)) {
      const s = lateFinish.get(d.taskId);
      if (!s) continue;
      const sDur = Number(byId.get(d.taskId).expectedDuration || 0);
      const sLateStart = startDateFor(s, sDur, cal);
      const c = backwardConstraintFor(d, sLateStart, s, cal);
      if (c.maxEnd) lf = minDate(lf, c.maxEnd);
      if (c.maxStart) lf = minDate(lf, endDateFor(c.maxStart, dur, cal));
    }
    lateFinish.set(id, lf);
  }

  // ---- Forecast pass --------------------------------------------------------
  const forecast = new Map();
  for (const id of order) {
    const t = byId.get(id);
    const dur = Number(t.expectedDuration || 0);
    const p = planned.get(id);
    let fs; let fe;
    if (t.status === TASK_STATUS.COMPLETED && t.actualEnd) {
      fs = t.actualStart || p.start; fe = t.actualEnd;
    } else if (t.actualStart) {
      fs = t.actualStart;
      const elapsed = diffWorkingDays(t.actualStart, today, cal);
      const remaining = Math.max(0, dur - 1 - Math.max(0, elapsed));
      const naturalEnd = endDateFor(fs, dur, cal);
      fe = maxDate(naturalEnd, addWorkingDays(today, remaining, cal));
    } else {
      let minStart = maxDate(p.start, nextWorkingDay(today, cal));
      let minEnd = null;
      for (const d of preds.get(id)) {
        const f = forecast.get(d.predecessorId);
        if (!f) continue;
        const c = constraintFor(d, f.start, f.end, cal);
        if (c.minStart) minStart = maxDate(minStart, c.minStart);
        if (c.minEnd) minEnd = maxDate(minEnd, c.minEnd);
      }
      if (minEnd) minStart = maxDate(minStart, startDateFor(minEnd, dur, cal));
      fs = minStart; fe = endDateFor(fs, dur, cal);
    }
    forecast.set(id, { start: fs, end: fe });
  }

  for (const id of order) {
    const p = planned.get(id);
    const f = forecast.get(id);
    const slack = diffWorkingDays(p.end, lateFinish.get(id), cal);
    result.set(id, {
      plannedStart: p.start,
      plannedEnd: p.end,
      forecastStart: f.start,
      forecastEnd: f.end,
      slack,
      isCritical: slack <= 0,
    });
  }
  const forecastEnd = maxDate(...Array.from(forecast.values()).map((v) => v.end));
  return { schedule: result, projectPlannedEnd: projectEnd, projectForecastEnd: forecastEnd, warnings, anchor };
}

// Compare two schedules and describe what moved (for confirmation dialogs / audit).
export function scheduleImpact(before, after, tasksById, cal) {
  const changes = [];
  for (const [id, b] of after.schedule) {
    const a = before?.schedule?.get(id);
    if (!a) { changes.push({ taskId: id, name: tasksById.get(id)?.name, kind: 'NEW', from: null, to: b }); continue; }
    if (a.plannedStart !== b.plannedStart || a.plannedEnd !== b.plannedEnd) {
      changes.push({
        taskId: id, name: tasksById.get(id)?.name, kind: 'MOVED',
        from: { start: a.plannedStart, end: a.plannedEnd },
        to: { start: b.plannedStart, end: b.plannedEnd },
        shiftDays: diffWorkingDays(a.plannedEnd, b.plannedEnd, cal),
      });
    }
  }
  const endShift = before?.projectPlannedEnd && after.projectPlannedEnd ? diffWorkingDays(before.projectPlannedEnd, after.projectPlannedEnd, cal) : 0;
  const maxShift = changes.reduce((m, c) => Math.max(m, Math.abs(c.shiftDays || 0)), 0);
  return { changes, endShift, maxShift, projectEndBefore: before?.projectPlannedEnd || null, projectEndAfter: after.projectPlannedEnd };
}
