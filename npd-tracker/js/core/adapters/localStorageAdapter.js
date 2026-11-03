// PROTOTYPE persistence: each collection is saved as JSON in window.localStorage.
// Implements the same interface as sharePointAdapter so the store can switch
// adapters without UI changes. Works in Node (tests) with an in-memory map.

const PREFIX = 'npd_tracker::';

function getBackend() {
  if (typeof localStorage !== 'undefined') return localStorage;
  if (!globalThis.__npdMemoryStorage) {
    const m = new Map();
    globalThis.__npdMemoryStorage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      key: (i) => Array.from(m.keys())[i] ?? null,
      get length() { return m.size; },
      clear: () => m.clear(),
    };
  }
  return globalThis.__npdMemoryStorage;
}

export class LocalStorageAdapter {
  constructor() {
    this.name = 'localStorage';
    this.isProduction = false;
    this.label = 'PROTOTYPE – browser storage';
  }

  async load(collection) {
    const raw = getBackend().getItem(PREFIX + collection);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  async save(collection, records) {
    getBackend().setItem(PREFIX + collection, JSON.stringify(records));
  }

  async clearAll() {
    const b = getBackend();
    const keys = [];
    for (let i = 0; i < b.length; i += 1) {
      const k = b.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => b.removeItem(k));
  }

  async exportAll(collections) {
    const out = {};
    for (const c of collections) out[c] = await this.load(c);
    return out;
  }

  async importAll(data) {
    for (const [c, records] of Object.entries(data)) await this.save(c, records);
  }
}
