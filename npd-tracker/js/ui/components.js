// Small DOM helpers and reusable UI components (no framework).

import { formatDate } from '../core/calendar.js';
import { STATUS_COLORS } from '../core/performance.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = formatDate;

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
export const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstElementChild; };

export function badge(text, color = 'grey') { return el('span', { class: `badge ${color}` }, text); }
export function statusBadge(perf) { return badge(perf, STATUS_COLORS[perf] || 'grey'); }
export function yesNo(v) { return v ? badge('Yes', 'green') : badge('No', 'grey'); }

export function kpi(label, value, color = '', onClick) {
  return el('div', { class: `kpi ${color}`, onClick, title: onClick ? 'Click to filter' : undefined }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value' }, value));
}

export function progressBar(pct) {
  return el('div', { class: 'flex', style: { gap: '6px' } }, el('div', { class: 'progress', style: { flex: '1' } }, el('div', { style: { width: `${pct}%` } })), el('span', { class: 'small muted' }, `${pct}%`));
}

// Sortable table. columns: [{ key, label, render?(row), sortValue?(row), class? }]
export function table(columns, rows, { onRowClick, rowClass, emptyText = 'No records', sortKey, sortDesc = false, maxRows } = {}) {
  const state = { key: sortKey, desc: sortDesc };
  const wrap = el('div', { class: 'table-wrap' });
  const render = () => {
    let data = rows.slice();
    if (state.key) {
      const col = columns.find((c) => c.key === state.key);
      const sv = col?.sortValue || ((r) => r[state.key]);
      data.sort((a, b) => { const x = sv(a); const y = sv(b); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (state.desc ? -1 : 1); });
    }
    if (maxRows) data = data.slice(0, maxRows);
    const t = el('table', { class: 'tbl' });
    t.append(el('thead', {}, el('tr', {}, columns.map((c) => el('th', {
      class: `${c.class || ''} ${state.key === c.key ? `sorted ${state.desc ? 'desc' : ''}` : ''}`,
      onClick: () => { if (c.sortable === false) return; if (state.key === c.key) state.desc = !state.desc; else { state.key = c.key; state.desc = false; } render(); },
    }, c.label)))));
    const tb = el('tbody');
    if (!data.length) tb.append(el('tr', {}, el('td', { colspan: columns.length, class: 'empty' }, emptyText)));
    for (const r of data) {
      const tr = el('tr', { class: `${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}` }, columns.map((c) => {
        const v = c.render ? c.render(r) : r[c.key];
        return el('td', { class: c.class || '' }, v == null ? '—' : v);
      }));
      if (onRowClick) tr.addEventListener('click', (e) => { if (e.target.closest('button, a, input, select')) return; onRowClick(r); });
      tb.append(tr);
    }
    t.append(tb);
    wrap.replaceChildren(t);
  };
  render();
  return wrap;
}

// ---- Modal ----------------------------------------------------------------
const modalRoot = () => document.getElementById('modal-root');

export function openModal({ title, body, footer, wide = false, onClose }) {
  // close(): programmatic close (callers already hold their result). dismiss(): user cancelled -> onClose.
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', esc1); };
  const dismiss = () => { if (!backdrop.isConnected) return; close(); onClose?.(); };
  const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) dismiss(); } },
    el('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'btn btn-ghost', onClick: dismiss, 'aria-label': 'Close' }, '✕')),
      el('div', { class: 'modal-body' }, body),
      footer ? el('div', { class: 'modal-foot' }, footer) : null));
  modalRoot().append(backdrop);
  function esc1(e) { if (e.key === 'Escape') dismiss(); }
  document.addEventListener('keydown', esc1);
  return { close, backdrop };
}

export function confirmDialog({ title = 'Please confirm', message, okText = 'Confirm', okClass = 'btn-primary', danger = false, body }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: body || el('div', { html: typeof message === 'string' ? esc(message).replace(/\n/g, '<br>') : '' }, typeof message !== 'string' ? message : null),
      footer: [
        el('button', { class: 'btn', onClick: () => { m.close(); resolve(false); } }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'btn-danger' : okClass}`, onClick: () => { m.close(); resolve(true); } }, okText),
      ],
      onClose: () => resolve(false),
    });
  });
}

export function promptDialog({ title, label = 'Reason', required = true, placeholder = '', okText = 'Submit', multiline = true }) {
  return new Promise((resolve) => {
    const input = multiline ? el('textarea', { placeholder }) : el('input', { placeholder });
    const err = el('div', { class: 'error-text' });
    const m = openModal({
      title,
      body: el('div', { class: 'field' }, el('label', {}, label), input, err),
      footer: [
        el('button', { class: 'btn', onClick: () => { m.close(); resolve(null); } }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onClick: () => { if (required && !input.value.trim()) { err.textContent = 'This field is required.'; return; } m.close(); resolve(input.value.trim()); } }, okText),
      ],
      onClose: () => resolve(null),
    });
    setTimeout(() => input.focus(), 30);
  });
}

// Form modal. fields: [{ name, label, type: 'text'|'number'|'date'|'select'|'checkbox'|'textarea'|'multiselect', options:[{value,label}], value, required, hint, span2, disabled }]
// onSubmit(values) may throw -> error shown. Returns promise of values or null.
export function formModal({ title, fields, submitText = 'Save', wide = false, onSubmit, intro }) {
  return new Promise((resolve) => {
    const inputs = {};
    const err = el('div', { class: 'error-text' });
    const grid = el('div', { class: 'form-grid' });
    if (intro) grid.append(el('div', { class: 'span2' }, intro));
    for (const f of fields) {
      let input;
      if (f.type === 'select') {
        input = el('select', { name: f.name, disabled: f.disabled }, (f.options || []).map((o) => el('option', { value: o.value ?? '', selected: String(o.value ?? '') === String(f.value ?? '') }, o.label)));
      } else if (f.type === 'multiselect') {
        input = el('select', { name: f.name, multiple: true, size: Math.min(6, (f.options || []).length || 2), disabled: f.disabled }, (f.options || []).map((o) => el('option', { value: o.value, selected: (f.value || []).includes(o.value) }, o.label)));
      } else if (f.type === 'checkbox') {
        input = el('input', { type: 'checkbox', name: f.name, checked: Boolean(f.value), disabled: f.disabled });
      } else if (f.type === 'textarea') {
        input = el('textarea', { name: f.name, disabled: f.disabled }, f.value ?? '');
      } else if (f.type === 'custom') {
        input = f.node;
      } else {
        input = el('input', { type: f.type || 'text', name: f.name, value: f.value ?? '', min: f.min, max: f.max, step: f.step, placeholder: f.placeholder, disabled: f.disabled });
      }
      inputs[f.name] = input;
      const wrap = el('div', { class: `field ${f.type === 'checkbox' ? 'inline' : ''} ${f.span2 ? 'span2' : ''}` });
      if (f.type === 'checkbox') { wrap.append(input, el('label', {}, f.label)); } else { wrap.append(el('label', {}, f.label, f.required ? ' *' : ''), input); }
      if (f.hint) wrap.append(el('div', { class: 'hint' }, f.hint));
      grid.append(wrap);
    }
    const read = () => {
      const v = {};
      for (const f of fields) {
        const i = inputs[f.name];
        if (f.type === 'checkbox') v[f.name] = i.checked;
        else if (f.type === 'multiselect') v[f.name] = Array.from(i.selectedOptions).map((o) => o.value);
        else if (f.type === 'number') v[f.name] = i.value === '' ? null : Number(i.value);
        else if (f.type === 'custom') v[f.name] = f.read ? f.read(i) : undefined;
        else v[f.name] = i.value;
      }
      return v;
    };
    const submit = async () => {
      err.textContent = '';
      const v = read();
      for (const f of fields) if (f.required && (v[f.name] === '' || v[f.name] == null || (Array.isArray(v[f.name]) && !v[f.name].length))) { err.textContent = `${f.label} is required.`; return; }
      try {
        setLoading(true);
        const r = onSubmit ? await onSubmit(v) : v;
        m.close(); resolve(r === undefined ? v : r);
      } catch (e) { err.textContent = e.message || String(e); } finally { setLoading(false); }
    };
    const m = openModal({
      title, wide,
      body: el('form', { onSubmit: (e) => { e.preventDefault(); submit(); } }, grid, err),
      footer: [el('button', { class: 'btn', onClick: () => { m.close(); resolve(null); } }, 'Cancel'), el('button', { class: 'btn btn-primary', onClick: submit }, submitText)],
      onClose: () => resolve(null),
    });
    const first = Object.values(inputs).find((i) => i && !i.disabled);
    setTimeout(() => first?.focus?.(), 30);
  });
}

// ---- Slide panel -------------------------------------------------------------
export function openPanel(contentNode) {
  const p = document.getElementById('slide-panel'); const b = document.getElementById('slide-backdrop');
  p.replaceChildren(contentNode); p.classList.add('open'); p.setAttribute('aria-hidden', 'false'); b.classList.add('open');
  b.onclick = closePanel;
}
export function closePanel() {
  const p = document.getElementById('slide-panel'); const b = document.getElementById('slide-backdrop');
  p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); b.classList.remove('open');
  setTimeout(() => { if (!p.classList.contains('open')) p.replaceChildren(); }, 250);
}
export function panelIsOpen() { return document.getElementById('slide-panel').classList.contains('open'); }

// ---- Toast / loader --------------------------------------------------------
export function toast(msg, type = 'info', ms = 3500) {
  const t = el('div', { class: `toast ${type}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
export function setLoading(on) { document.getElementById('loader').classList.toggle('on', on); }

// Wrap an async handler: loader + error toast
export function guard(fn) {
  return async (...args) => {
    try { setLoading(true); return await fn(...args); } catch (e) { console.error(e); toast(e.message || String(e), 'error', 6000); return undefined; } finally { setLoading(false); }
  };
}

export function filterBar(defs, state, onChange) {
  const bar = el('div', { class: 'filters' });
  for (const d of defs) {
    let input;
    if (d.type === 'select') input = el('select', { onChange: (e) => { state[d.key] = e.target.value; onChange(); } }, [{ value: '', label: d.allLabel || `All ${d.label}` }, ...d.options].map((o) => el('option', { value: o.value, selected: String(state[d.key] ?? '') === String(o.value) }, o.label)));
    else input = el('input', { type: d.type || 'text', value: state[d.key] ?? '', placeholder: d.placeholder, onInput: (e) => { state[d.key] = e.target.value; onChange(); } });
    bar.append(el('div', { class: 'field' }, el('label', {}, d.label), input));
  }
  bar.append(el('button', { class: 'btn btn-sm', onClick: () => { for (const d of defs) state[d.key] = ''; onChange(); } }, 'Clear'));
  return bar;
}

export function chart(canvasParent, config) {
  if (typeof window.Chart === 'undefined') { canvasParent.append(el('div', { class: 'empty' }, 'Chart.js not loaded (offline?)')); return null; }
  const c = el('canvas'); canvasParent.append(c);
  return new window.Chart(c, { ...config, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }, ...(config.options || {}) } });
}

export const PALETTE = ['#1d4ed8', '#15803d', '#b45309', '#b91c1c', '#6d28d9', '#0891b2', '#64748b', '#db2777', '#4d7c0f', '#9333ea'];
export const COLOR_HEX = { green: '#15803d', amber: '#d97706', red: '#dc2626', grey: '#9ca3af', blue: '#2563eb', purple: '#7c3aed' };
