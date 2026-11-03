// Working-day calendar. Dates are handled as 'YYYY-MM-DD' strings (no timezone drift).
// calendar = { weekendDays: [0,6], holidays: [{date:'2026-12-25', name:'Christmas', type:'Public'|'Company'}] }

export function toDateStr(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() { return toDateStr(new Date()); }

export function addCalendarDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function compareDates(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
export function maxDate(...ds) { return ds.filter(Boolean).sort().pop() || null; }
export function minDate(...ds) { return ds.filter(Boolean).sort()[0] || null; }

export function isWorkingDay(s, cal) {
  const d = parseDate(s);
  if ((cal.weekendDays || [0, 6]).includes(d.getDay())) return false;
  if ((cal.holidays || []).some((h) => h.date === s)) return false;
  return true;
}

export function nextWorkingDay(s, cal) {
  let d = s;
  while (!isWorkingDay(d, cal)) d = addCalendarDays(d, 1);
  return d;
}

export function prevWorkingDay(s, cal) {
  let d = s;
  while (!isWorkingDay(d, cal)) d = addCalendarDays(d, -1);
  return d;
}

// Add n working days to a date. n may be negative. Returns the date on which
// the n-th working day lands (day 0 = the start date itself, rolled to a working day).
export function addWorkingDays(s, n, cal) {
  let d = n >= 0 ? nextWorkingDay(s, cal) : prevWorkingDay(s, cal);
  let remaining = Math.abs(Math.trunc(n));
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    d = addCalendarDays(d, step);
    if (isWorkingDay(d, cal)) remaining -= 1;
  }
  return d;
}

// Number of working days strictly after `from` up to and including `to`.
// Negative when `to` is before `from`.
export function diffWorkingDays(from, to, cal) {
  if (!from || !to) return 0;
  if (from === to) return 0;
  const sign = compareDates(to, from) > 0 ? 1 : -1;
  let count = 0;
  let d = from;
  while (d !== to) {
    d = addCalendarDays(d, sign);
    if (isWorkingDay(d, cal)) count += 1;
  }
  return count * sign;
}

// End date of a task that starts on `start` and lasts `duration` working days.
// A duration of 0 is a milestone (end = start). Duration 1 = starts and ends same day.
export function endDateFor(start, duration, cal) {
  const s = nextWorkingDay(start, cal);
  if (duration <= 0) return s;
  return addWorkingDays(s, duration - 1, cal);
}

export function startDateFor(end, duration, cal) {
  const e = prevWorkingDay(end, cal);
  if (duration <= 0) return e;
  return addWorkingDays(e, -(duration - 1), cal);
}

export function formatDate(s) {
  if (!s) return '—';
  const d = parseDate(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
