// Dependency validation engine + graph helpers.
// Works for both the master (projectId null, nodes = activities) and a project
// (nodes = project tasks). `nodes` is the list of records; `deps` the dependency rows.

import { DEP_TYPES } from './models.js';

export function buildGraph(nodes, deps) {
  const ids = new Set(nodes.map((n) => n.id));
  const preds = new Map();   // taskId -> [dep]
  const succs = new Map();   // predecessorId -> [dep]
  for (const id of ids) { preds.set(id, []); succs.set(id, []); }
  for (const d of deps) {
    if (preds.has(d.taskId)) preds.get(d.taskId).push(d);
    if (succs.has(d.predecessorId)) succs.get(d.predecessorId).push(d);
  }
  return { ids, preds, succs };
}

// Returns an array of error strings (empty => valid).
// `candidate` is an optional new/changed dependency to validate against the existing set.
export function validateDependencies(nodes, deps, candidate = null, { projectId = null } = {}) {
  const errors = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const all = candidate ? [...deps.filter((d) => d.id !== candidate.id), candidate] : deps;

  const check = (d) => {
    const errs = [];
    if (!d.taskId || !d.predecessorId) errs.push('Missing task or predecessor reference.');
    if (d.taskId === d.predecessorId) errs.push('A task cannot depend on itself.');
    if (!nodeMap.has(d.taskId)) errs.push(`Invalid task reference: ${d.taskId}`);
    if (!nodeMap.has(d.predecessorId)) errs.push(`Invalid predecessor reference: ${d.predecessorId}`);
    const t = nodeMap.get(d.taskId); const p = nodeMap.get(d.predecessorId);
    if (t && t.isActive === false) errs.push(`Task "${t.name}" is inactive.`);
    if (p && p.isActive === false) errs.push(`Predecessor "${p.name}" is inactive.`);
    if (projectId && t && t.projectId && t.projectId !== projectId) errs.push(`Task "${t.name}" belongs to another project.`);
    if (projectId && p && p.projectId && p.projectId !== projectId) errs.push(`Predecessor "${p.name}" belongs to another project (cross-project references are not allowed).`);
    if (!DEP_TYPES.includes(d.type)) errs.push(`Invalid dependency type "${d.type}".`);
    if (!Number.isFinite(Number(d.lagDays))) errs.push('Lag days must be a number.');
    return errs;
  };

  if (candidate) {
    errors.push(...check(candidate));
    const dup = deps.find((d) => d.id !== candidate.id && d.taskId === candidate.taskId && d.predecessorId === candidate.predecessorId);
    if (dup) errors.push('This predecessor relationship already exists (duplicate).');
  } else {
    const seen = new Set();
    for (const d of all) {
      errors.push(...check(d));
      const k = `${d.taskId}|${d.predecessorId}`;
      if (seen.has(k)) errors.push(`Duplicate dependency ${k}.`);
      seen.add(k);
    }
  }

  const cycle = findCycle(nodes, all);
  if (cycle) {
    const names = cycle.map((id) => nodeMap.get(id)?.name || id).join(' → ');
    errors.push(`Circular dependency detected: ${names}`);
  }
  return Array.from(new Set(errors));
}

// Returns the cycle path (array of ids) or null.
export function findCycle(nodes, deps) {
  const { preds } = buildGraph(nodes, deps);
  const WHITE = 0; const GREY = 1; const BLACK = 2;
  const color = new Map(nodes.map((n) => [n.id, WHITE]));
  const stack = [];
  let found = null;
  const dfs = (id) => {
    color.set(id, GREY); stack.push(id);
    for (const d of preds.get(id) || []) {
      const p = d.predecessorId;
      if (!color.has(p)) continue;
      if (color.get(p) === GREY) { found = stack.slice(stack.indexOf(p)).concat(p); return true; }
      if (color.get(p) === WHITE && dfs(p)) return true;
    }
    stack.pop(); color.set(id, BLACK);
    return false;
  };
  for (const n of nodes) if (color.get(n.id) === WHITE && dfs(n.id)) break;
  return found;
}

// Topological order (predecessors first). Throws on cycle.
export function topoSort(nodes, deps) {
  const { preds, succs } = buildGraph(nodes, deps);
  const indeg = new Map();
  for (const n of nodes) indeg.set(n.id, (preds.get(n.id) || []).filter((d) => indeg.has(d.predecessorId) || preds.has(d.predecessorId)).length);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const d of succs.get(id) || []) {
      indeg.set(d.taskId, indeg.get(d.taskId) - 1);
      if (indeg.get(d.taskId) === 0) queue.push(d.taskId);
    }
  }
  if (order.length !== nodes.length) throw new Error('Circular dependency – cannot order tasks.');
  return order;
}

export function upstream(id, deps, depth = Infinity) {
  const out = new Set();
  const walk = (x, d) => {
    if (d <= 0) return;
    for (const dep of deps.filter((q) => q.taskId === x)) {
      if (!out.has(dep.predecessorId)) { out.add(dep.predecessorId); walk(dep.predecessorId, d - 1); }
    }
  };
  walk(id, depth);
  return Array.from(out);
}

export function downstream(id, deps, depth = Infinity) {
  const out = new Set();
  const walk = (x, d) => {
    if (d <= 0) return;
    for (const dep of deps.filter((q) => q.predecessorId === x)) {
      if (!out.has(dep.taskId)) { out.add(dep.taskId); walk(dep.taskId, d - 1); }
    }
  };
  walk(id, depth);
  return Array.from(out);
}
