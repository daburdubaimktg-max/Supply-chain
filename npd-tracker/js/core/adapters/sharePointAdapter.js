// PRODUCTION adapter (STUB – NOT CONFIGURED).
//
// Same interface as LocalStorageAdapter. When Microsoft 365 is available, this
// adapter reads/writes SharePoint Lists through Microsoft Graph using a token
// obtained by MSAL (Entra ID) in the browser, or – preferred – through a thin
// server-side API that holds the credentials and validates writes.
//
// See docs/SHAREPOINT-INTEGRATION.md for list schemas and the full contract.
// Credentials, client secrets and access tokens must never be placed in this file.

export class SharePointAdapter {
  constructor(config = {}) {
    this.name = 'sharepoint';
    this.isProduction = true;
    this.label = 'SharePoint Lists';
    this.siteUrl = config.siteUrl || '';
    this.apiBaseUrl = config.apiBaseUrl || '';   // secure backend endpoint, e.g. https://api.example.com/npd
    this.listMap = config.listMap || {};         // collection -> SharePoint list name
    this.getToken = config.getToken || null;     // async () => bearer token from MSAL
  }

  configured() {
    return Boolean(this.apiBaseUrl && this.getToken);
  }

  async request(method, path, body) {
    if (!this.configured()) {
      throw new Error('SharePoint adapter is not configured. See docs/SHAREPOINT-INTEGRATION.md');
    }
    const token = await this.getToken();
    const res = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`SharePoint API ${method} ${path} failed: ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  // Intended contract (backend maps collection -> SharePoint list):
  //   GET    /lists/{collection}           -> all records
  //   PUT    /lists/{collection}           -> replace collection (bulk, used by prototype-style sync)
  // Production should instead use per-record endpoints with ETag / version checks:
  //   POST   /lists/{collection}/items
  //   PATCH  /lists/{collection}/items/{id}   (If-Match: version)
  async load(collection) {
    const list = this.listMap[collection] || collection;
    return this.request('GET', `/lists/${encodeURIComponent(list)}`);
  }

  async save(collection, records) {
    const list = this.listMap[collection] || collection;
    return this.request('PUT', `/lists/${encodeURIComponent(list)}`, records);
  }

  async clearAll() {
    throw new Error('clearAll is not permitted against SharePoint.');
  }

  async exportAll(collections) {
    const out = {};
    for (const c of collections) out[c] = await this.load(c);
    return out;
  }

  async importAll() {
    throw new Error('Bulk import must go through the validated server-side import endpoint.');
  }
}
