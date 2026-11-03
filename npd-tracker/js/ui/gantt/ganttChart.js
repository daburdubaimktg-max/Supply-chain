// Custom SVG Gantt: rows grouped by department, planned/forecast/actual bars,
// milestones, dependency connectors, critical path, day/week/month zoom.
import { el, COLOR_HEX } from '../components.js';
import { STATUS_COLORS } from '../../core/performance.js';
import { parseDate, toDateStr, addCalendarDays, today as todayStr } from '../../core/calendar.js';
import { PERF_STATUS } from '../../core/models.js';

const ROW_H = 30; const HEAD_H = 44; const LEFT_PAD = 6;
const ZOOM = { day: 28, week: 9, month: 2.2 }; // px per calendar day

export function renderGantt(container, rows, deps, { zoom = 'week', onTaskClick, groupBy = 'department', showForecast = true, showCritical = true } = {}) {
  container.replaceChildren();
  rows = rows.filter((r) => r.status !== 'NOT_REQUIRED' && r.plannedStart); // skipped tasks are not scheduled
  if (!rows.length) { container.append(el('div', { class: 'empty' }, 'No tasks to display.')); return; }
  const pxDay = ZOOM[zoom] || ZOOM.week;
  const dates = rows.flatMap((r) => [r.plannedStart, r.plannedEnd, r.forecastStart, r.forecastEnd, r.actualStart, r.actualEnd]).filter(Boolean).sort();
  const today = todayStr();
  let start = addCalendarDays(dates[0] < today ? dates[0] : today, -7);
  let end = addCalendarDays(dates[dates.length - 1] > today ? dates[dates.length - 1] : today, 14);
  // align start to Monday
  while (parseDate(start).getDay() !== 1) start = addCalendarDays(start, -1);
  const totalDays = Math.round((parseDate(end) - parseDate(start)) / 86400000) + 1;
  const width = Math.max(600, totalDays * pxDay);
  const x = (d) => Math.round((parseDate(d) - parseDate(start)) / 86400000) * pxDay;

  // grouping
  const groups = new Map();
  for (const r of rows) { const g = groupBy ? (r[groupBy] || 'Other') : 'All tasks'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const lines = []; // {type:'group'|'task', row}
  for (const [g, list] of groups) { lines.push({ type: 'group', label: g, count: list.length }); for (const r of list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) lines.push({ type: 'task', row: r }); }
  const height = lines.length * ROW_H;
  const rowY = new Map(); lines.forEach((l, i) => { if (l.type === 'task') rowY.set(l.row.id, i * ROW_H); });

  // left column
  const left = el('div', { class: 'gantt-left' }, el('div', { class: 'gantt-head' }, 'Task / FPR'));
  for (const l of lines) {
    if (l.type === 'group') { left.append(el('div', { class: 'gantt-row group' }, `${l.label} (${l.count})`)); continue; }
    const r = l.row;
    left.append(el('div', { class: `gantt-row ${onTaskClick ? 'clickable' : ''}`, title: `${r.name}\nFPR: ${r.fprName}\nPlanned ${r.plannedStart} → ${r.plannedEnd}`, onClick: () => onTaskClick?.(r) },
      el('span', { class: 'muted' }, r.activityNo), el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name), el('span', { class: 'muted small', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, r.fprName)));
  }

  // right (svg)
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', width); svg.setAttribute('height', HEAD_H + height);
  const g = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
  // header + grid
  svg.append(g('rect', { x: 0, y: 0, width, height: HEAD_H, fill: '#f8fafc' }));
  for (let i = 0; i < totalDays; i += 1) {
    const d = addCalendarDays(start, i); const dt = parseDate(d); const X = i * pxDay;
    const weekend = dt.getDay() === 0 || dt.getDay() === 6;
    if (weekend && pxDay >= 4) svg.append(g('rect', { x: X, y: HEAD_H, width: pxDay, height, fill: '#f8fafc' }));
    if (zoom === 'day') { svg.append(g('line', { x1: X, y1: HEAD_H - 14, x2: X, y2: HEAD_H + height, stroke: '#eef2f7' })); svg.append(g('text', { x: X + pxDay / 2, y: HEAD_H - 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#64748b' }, String(dt.getDate()))); }
    if (dt.getDay() === 1) { svg.append(g('line', { x1: X, y1: zoom === 'day' ? HEAD_H - 24 : HEAD_H - 14, x2: X, y2: HEAD_H + height, stroke: '#e5e7eb' })); if (zoom !== 'month') svg.append(g('text', { x: X + 3, y: zoom === 'day' ? HEAD_H - 28 : HEAD_H - 4, 'font-size': 10, fill: '#64748b' }, `${dt.getDate()}/${dt.getMonth() + 1}`)); }
    if (dt.getDate() === 1) { svg.append(g('line', { x1: X, y1: 0, x2: X, y2: HEAD_H + height, stroke: '#cbd5e1' })); svg.append(g('text', { x: X + 4, y: 14, 'font-size': 11, 'font-weight': 600, fill: '#334155' }, dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))); }
  }
  // row separators / group bands
  lines.forEach((l, i) => { const Y = HEAD_H + i * ROW_H; if (l.type === 'group') svg.append(g('rect', { x: 0, y: Y, width, height: ROW_H, fill: '#f1f5f9' })); svg.append(g('line', { x1: 0, y1: Y + ROW_H, x2: width, y2: Y + ROW_H, stroke: '#f1f5f9' })); });
  // today
  const tx = x(today); svg.append(g('line', { x1: tx, y1: 0, x2: tx, y2: HEAD_H + height, stroke: '#dc2626', 'stroke-dasharray': '4 3' })); svg.append(g('text', { x: tx + 3, y: HEAD_H + 10, 'font-size': 10, fill: '#dc2626' }, 'Today'));

  const barColor = (r) => COLOR_HEX[STATUS_COLORS[r.perf]] || COLOR_HEX.grey;
  const bars = new Map();
  for (const l of lines) {
    if (l.type !== 'task') continue;
    const r = l.row; const Y = HEAD_H + rowY.get(r.id);
    const ps = x(r.plannedStart); const pe = x(r.plannedEnd) + pxDay;
    const milestone = Number(r.expectedDuration) === 0;
    const crit = showCritical && r.isCritical;
    const grp = g('g', { class: 'bar', style: 'cursor:pointer' });
    grp.addEventListener('click', () => onTaskClick?.(r));
    const title = g('title', {}, `${r.activityNo} ${r.name}\n${r.perf}\nPlanned: ${r.plannedStart} → ${r.plannedEnd}\nForecast: ${r.forecastStart || '—'} → ${r.forecastEnd || '—'}\nActual: ${r.actualStart || '—'} → ${r.actualEnd || '—'}\nFPR: ${r.fprName}`);
    grp.append(title);
    if (milestone) {
      const cx = ps + pxDay / 2; const cy = Y + ROW_H / 2;
      grp.append(g('polygon', { points: `${cx},${cy - 8} ${cx + 8},${cy} ${cx},${cy + 8} ${cx - 8},${cy}`, fill: barColor(r), stroke: crit ? '#dc2626' : '#fff', 'stroke-width': crit ? 2 : 1 }));
      bars.set(r.id, { x1: cx - 8, x2: cx + 8, y: cy });
    } else {
      grp.append(g('rect', { x: ps, y: Y + 8, width: Math.max(3, pe - ps), height: 14, rx: 3, fill: barColor(r), opacity: r.perf === PERF_STATUS.NOT_REQUIRED ? 0.3 : 0.85, stroke: crit ? '#dc2626' : 'none', 'stroke-width': 2 }));
      if (showForecast && r.forecastStart && r.forecastEnd && (r.forecastStart !== r.plannedStart || r.forecastEnd !== r.plannedEnd) && !r.actualEnd) {
        grp.append(g('rect', { x: x(r.forecastStart), y: Y + 23, width: Math.max(3, x(r.forecastEnd) + pxDay - x(r.forecastStart)), height: 4, rx: 2, fill: '#f59e0b' }));
      }
      if (r.actualStart) {
        const ae = r.actualEnd || today;
        grp.append(g('rect', { x: x(r.actualStart), y: Y + 3, width: Math.max(3, x(ae) + pxDay - x(r.actualStart)), height: 4, rx: 2, fill: r.actualEnd ? '#15803d' : '#2563eb' }));
      }
      if (pxDay >= 9) grp.append(g('text', { x: pe + 4, y: Y + 19, 'font-size': 10, fill: '#475569' }, r.fprName));
      bars.set(r.id, { x1: ps, x2: pe, y: Y + 15 });
    }
    svg.append(grp);
  }
  // dependency connectors
  const defs = g('defs'); const marker = g('marker', { id: 'arrow', markerWidth: 6, markerHeight: 6, refX: 5, refY: 3, orient: 'auto' }); marker.append(g('path', { d: 'M0,0 L6,3 L0,6 z', fill: '#64748b' })); defs.append(marker); svg.prepend(defs);
  for (const d of deps) {
    const a = bars.get(d.predecessorId); const b = bars.get(d.taskId);
    if (!a || !b) continue;
    const fromX = d.type === 'SS' || d.type === 'SF' ? a.x1 : a.x2;
    const toX = d.type === 'FF' || d.type === 'SF' ? b.x2 : b.x1;
    const midX = fromX + 8;
    const path = toX > fromX + 10
      ? `M${fromX},${a.y} H${midX} V${b.y} H${toX}`
      : `M${fromX},${a.y} H${fromX + 8} V${(a.y + b.y) / 2} H${toX - 8} V${b.y} H${toX}`;
    svg.append(g('path', { d: path, fill: 'none', stroke: '#94a3b8', 'stroke-width': 1, 'marker-end': 'url(#arrow)', opacity: 0.8 }));
  }

  const right = el('div', { class: 'gantt-right' }, svg);
  const wrap = el('div', { class: 'gantt' }, left, right);
  container.append(wrap, el('div', { class: 'gantt-legend' },
    el('span', { style: '--lg:#15803d' }, 'Completed'), el('span', { style: '--lg:#2563eb' }, 'In progress'), el('span', { style: '--lg:#d97706' }, 'Due soon / at risk'),
    el('span', { style: '--lg:#dc2626' }, 'Overdue'), el('span', { style: '--lg:#9ca3af' }, 'Not started / blocked'), el('span', { style: '--lg:#7c3aed' }, 'Pending approval'),
    el('span', { style: '--lg:#f59e0b' }, 'thin amber = forecast'), el('span', { style: '--lg:#15803d' }, 'thin top bar = actual'), el('span', { style: 'border:2px solid #dc2626; --lg:transparent' }, 'red outline = critical path'), el('span', { style: '--lg:#fff' }, '◆ milestone (0 days)')));
  // scroll to today
  setTimeout(() => { right.scrollLeft = Math.max(0, tx - 200); }, 0);
}
