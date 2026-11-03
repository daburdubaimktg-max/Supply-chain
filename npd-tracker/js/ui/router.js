// Hash router: #/page/param1/param2?query
export class Router {
  constructor(onRoute) { this.onRoute = onRoute; window.addEventListener('hashchange', () => this.dispatch()); }
  parse() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    const q = Object.fromEntries(new URLSearchParams(query));
    return { page: parts[0] || 'executive', params: parts.slice(1), query: q };
  }
  go(path) { location.hash = `#/${path.replace(/^\//, '')}`; }
  dispatch() { this.onRoute(this.parse()); }
}
