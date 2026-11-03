// DataStore: in-memory cache over a persistence adapter.
// - CRUD with optimistic concurrency (record.version must match on update)
// - append-only audit log written on every create/update/delete
// - pub/sub so UI pages re-render after any change

import { COLLECTIONS, newId, nowIso } from './models.js';
import { LocalStorageAdapter } from './adapters/localStorageAdapter.js';

export class ConflictError extends Error {
  constructor(msg) { super(msg); this.name = 'ConflictError'; }
}

export class DataStore {
  constructor(adapter = new LocalStorageAdapter()) {
    this.adapter = adapter;
    this.data = {};
    this.listeners = new Set();
    this.currentUser = { id: null, name: 'system', role: 'Administrator' };
    this._batchDepth = 0;
    this._dirty = new Set();
    this._auditEnabled = true;
    for (const c of Object.values(COLLECTIONS)) this.data[c] = [];
  }

  async load() {
    for (const c of Object.values(COLLECTIONS)) {
      this.data[c] = (await this.adapter.load(c)) || [];
    }
    return this;
  }

  isEmpty() {
    return this.data[COLLECTIONS.activityMaster].length === 0 && this.data[COLLECTIONS.projects].length === 0;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(collection) {
    if (this._batchDepth > 0) { this._dirty.add(collection); return; }
    for (const fn of this.listeners) fn(collection);
  }

  // Group many writes into one persist + one notify
  async batch(fn) {
    this._batchDepth += 1;
    try {
      return await fn();
    } finally {
      this._batchDepth -= 1;
      if (this._batchDepth === 0) {
        const dirty = Array.from(this._dirty);
        this._dirty.clear();
        for (const c of dirty) await this.adapter.save(c, this.data[c]);
        for (const c of dirty) for (const fn of this.listeners) fn(c);
      }
    }
  }

  async persist(collection) {
    if (this._batchDepth > 0) { this._dirty.add(collection); return; }
    await this.adapter.save(collection, this.data[collection]);
    this.notify(collection);
  }

  // Reads -------------------------------------------------------------------
  all(collection) { return this.data[collection]; }
  get(collection, id) { return this.data[collection].find((r) => r.id === id) || null; }
  where(collection, pred) { return this.data[collection].filter(pred); }
  config() { return this.data[COLLECTIONS.systemConfig][0] || {}; }
  calendar() { return this.data[COLLECTIONS.workingCalendar][0] || { weekendDays: [0, 6], holidays: [] }; }

  // Writes ------------------------------------------------------------------
  async insert(collection, record, { audit = true, auditSummary } = {}) {
    const ts = nowIso();
    const rec = {
      version: 1,
      isActive: true,
      createdBy: this.currentUser.name,
      createdAt: ts,
      modifiedBy: this.currentUser.name,
      modifiedAt: ts,
      ...record,
    };
    if (!rec.id) rec.id = newId(collection.slice(0, 3));
    if (this.get(collection, rec.id)) throw new ConflictError(`Duplicate id ${rec.id} in ${collection}`);
    this.data[collection].push(rec);
    if (audit && this._auditEnabled) this._audit(collection, rec.id, 'CREATE', null, rec, auditSummary);
    await this.persist(collection);
    return rec;
  }

  async update(collection, id, changes, { expectedVersion, audit = true, auditSummary, reason } = {}) {
    const idx = this.data[collection].findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`${collection}/${id} not found`);
    const before = this.data[collection][idx];
    if (expectedVersion != null && before.version !== expectedVersion) {
      throw new ConflictError(`Record was modified by ${before.modifiedBy} at ${before.modifiedAt}. Reload and try again.`);
    }
    const after = {
      ...before,
      ...changes,
      version: before.version + 1,
      modifiedBy: this.currentUser.name,
      modifiedAt: nowIso(),
    };
    this.data[collection][idx] = after;
    if (audit && this._auditEnabled) this._audit(collection, id, 'UPDATE', before, after, auditSummary, reason);
    await this.persist(collection);
    return after;
  }

  async remove(collection, id, { audit = true, auditSummary, reason } = {}) {
    const idx = this.data[collection].findIndex((r) => r.id === id);
    if (idx < 0) return false;
    const before = this.data[collection][idx];
    this.data[collection].splice(idx, 1);
    if (audit && this._auditEnabled) this._audit(collection, id, 'DELETE', before, null, auditSummary, reason);
    await this.persist(collection);
    return true;
  }

  // Append-only logs -----------------------------------------------------------
  async append(collection, record) {
    const rec = { id: newId(collection.slice(0, 3)), timestamp: nowIso(), user: this.currentUser.name, ...record };
    this.data[collection].push(rec);
    await this.persist(collection);
    return rec;
  }

  _audit(collection, recordId, action, before, after, summary, reason) {
    const changes = diffRecords(before, after);
    this.data[COLLECTIONS.auditLog].push({
      id: newId('aud'),
      timestamp: nowIso(),
      user: this.currentUser.name,
      userId: this.currentUser.id,
      collection,
      recordId,
      action,
      summary: summary || `${action} ${collection}`,
      reason: reason || null,
      changes,
      projectId: after?.projectId || before?.projectId || (collection === COLLECTIONS.projects ? recordId : null),
      taskId: collection === COLLECTIONS.projectTasks ? recordId : (after?.taskId || before?.taskId || null),
    });
    if (this._batchDepth > 0) this._dirty.add(COLLECTIONS.auditLog);
    else this.adapter.save(COLLECTIONS.auditLog, this.data[COLLECTIONS.auditLog]);
  }

  async resetAll() {
    await this.adapter.clearAll();
    for (const c of Object.values(COLLECTIONS)) this.data[c] = [];
    this.notify('*');
  }

  async exportAll() { return this.adapter.exportAll(Object.values(COLLECTIONS)); }
}

const SKIP = new Set(['version', 'modifiedAt', 'modifiedBy']);
export function diffRecords(before, after) {
  const out = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, from: a ?? null, to: b ?? null });
  }
  return out;
}
