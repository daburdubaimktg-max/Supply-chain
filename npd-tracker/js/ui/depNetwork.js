// Dependency network visualisation (layered DAG drawn in SVG).
import { el, COLOR_HEX } from './components.js';
import { STATUS_COLORS } from '../core/performance.js';
import { topoSort } from '../core/dependencies.js';

export function renderDepNetwork(container, nodes, deps, { onClick, highlightId } = {}) {
  container.replaceChildren();
  if (!nodes.length) { container.append(el('div', { class: 'empty' }, 'No tasks.')); return; }
  let order;
  try { order = topoSort(nodes, deps); } catch { container.append(el('div', { class: 'notice error' }, 'Circular dependency – cannot draw network.')); return; }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const level = new Map();
  for (const id of order) {
    const preds = deps.filter((d) => d.taskId === id && byId.has(d.predecessorId));
    level.set(id, preds.length ? Math.max(...preds.map((d) => level.get(d.predecessorId) + 1)) : 0);
  }
  const cols = new Map();
  for (const id of order) { const l = level.get(id); if (!cols.has(l)) cols.set(l, []); cols.get(l).push(id); }
  const W = 150; const H = 40; const GX = 60; const GY = 16;
  const pos = new Map();
  let maxRows = 0;
  for (const [l, ids] of cols) { ids.sort((a, b) => (byId.get(a).sequence ?? 0) - (byId.get(b).sequence ?? 0)); ids.forEach((id, i) => pos.set(id, { x: l * (W + GX) + 10, y: i * (H + GY) + 10 })); maxRows = Math.max(maxRows, ids.length); }
  const width = cols.size * (W + GX) + 20; const height = maxRows * (H + GY) + 20;
  const NS = 'http://www.w3.org/2000/svg';
  const g = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
  const svg = g('svg', { width, height });
  const defs = g('defs'); const m = g('marker', { id: 'dep-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' }); m.append(g('path', { d: 'M0,0 L8,4 L0,8 z', fill: '#64748b' })); defs.append(m); svg.append(defs);
  const related = new Set();
  if (highlightId) { related.add(highlightId); deps.forEach((d) => { if (d.taskId === highlightId) related.add(d.predecessorId); if (d.predecessorId === highlightId) related.add(d.taskId); }); }
  for (const d of deps) {
    const a = pos.get(d.predecessorId); const b = pos.get(d.taskId); if (!a || !b) continue;
    const hl = highlightId && (d.taskId === highlightId || d.predecessorId === highlightId);
    const x1 = a.x + W; const y1 = a.y + H / 2; const x2 = b.x; const y2 = b.y + H / 2; const c = (x2 - x1) / 2;
    svg.append(g('path', { d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`, fill: 'none', stroke: hl ? '#1d4ed8' : '#cbd5e1', 'stroke-width': hl ? 2 : 1.2, 'marker-end': 'url(#dep-arrow)' }));
    if (d.type !== 'FS' || d.lagDays) svg.append(g('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 3, 'font-size': 9, fill: '#475569', 'text-anchor': 'middle' }, `${d.type}${d.lagDays ? `+${d.lagDays}` : ''}`));
  }
  for (const n of nodes) {
    const p = pos.get(n.id); if (!p) continue;
    const grp = g('g', { style: 'cursor:pointer' });
    grp.addEventListener('click', () => onClick?.(n));
    const dim = highlightId && !related.has(n.id);
    const color = COLOR_HEX[STATUS_COLORS[n.perf]] || '#9ca3af';
    grp.append(g('rect', { x: p.x, y: p.y, width: W, height: H, rx: 6, fill: n.id === highlightId ? '#dbeafe' : '#fff', stroke: n.isCritical ? '#dc2626' : color, 'stroke-width': n.id === highlightId ? 2.5 : 1.5, opacity: dim ? 0.35 : 1 }));
    grp.append(g('rect', { x: p.x, y: p.y, width: 6, height: H, rx: 3, fill: color, opacity: dim ? 0.35 : 1 }));
    grp.append(g('text', { x: p.x + 12, y: p.y + 16, 'font-size': 11, 'font-weight': 600, fill: '#111827', opacity: dim ? 0.4 : 1 }, `${n.activityNo}. ${n.name.length > 20 ? `${n.name.slice(0, 19)}…` : n.name}`));
    grp.append(g('text', { x: p.x + 12, y: p.y + 31, 'font-size': 10, fill: '#64748b', opacity: dim ? 0.4 : 1 }, `${n.expectedDuration}d · ${n.fprName || ''}`));
    const t = g('title', {}, `${n.name}\n${n.perf}\n${n.plannedStart || ''} → ${n.plannedEnd || ''}`); grp.append(t);
    svg.append(grp);
  }
  container.append(el('div', { class: 'depnet' }, svg));
}
