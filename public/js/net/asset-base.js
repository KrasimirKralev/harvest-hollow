// Where the static game files come from (option 2, docs/qa/release/option2.md D6). With no <meta name="hh-assets"> in
// the page (the farm server alone, a LAN page, a browser that has not proven import-map integrity, option 2 switched off)
// every URL stays exactly what it was. With it (server/static.js renders it only when the public host serves this
// very build), the page's static files come from '<host>/b/<build>/public'. Owned by the infra lane; every lane routes
// the /assets/, /css/ and /js/ URLs it builds at runtime through assetUrl() (release-scope §7.4, enforced by
// test/rel-infra.client-asset-urls.scan.test.js). The API, the socket, mods and the manifest never come through here:
// they stay on the page's own origin.
//
//   ASSET_BASE                      '<host>/b/<build>/public' or ''
//   assetUrl('/assets/x.png')       ASSET_BASE + '/assets/x.png' (only a root path moves)
//   assetPath(url)                  the inverse: the base stripped off a URL assetUrl() built
//   assetIntegrity('/css/x.css')    the stylesheet's integrity value on a host page ('' elsewhere): ensureStylesheet()
//                                   links a host stylesheet with it and crossOrigin 'anonymous'
//   fetchAsset(url, init?, fetcher?) fetch(url); a host file that fails (network error, 404, 5xx) is fetched again from
//                                   this server's root path (the data fallback: the content gate guarantees the page's
//                                   build is this server's build), and the host is reported failed
//   noteHostFailure(why)            the host failed us after the boot: once per page, 'hh:assets-failed' on window
//                                   (main.js offers "Reload" there; a failed lazy import() cannot be retried in place)

/** The meta's content without a trailing slash, or '' (no meta, or no document at all: node tests, a worker). */
function readBase() {
  const raw = globalThis.document?.querySelector?.('meta[name="hh-assets"]')?.getAttribute('content') ?? '';
  return raw.trim().replace(/\/+$/, '');
}

/** This page's asset base, read once when the module loads: the server renders it into the page it serves. */
export const ASSET_BASE = readBase();

/**
 * '/assets/x.png' -> ASSET_BASE + '/assets/x.png'. Only a root path moves: '//host/x', 'https://…', 'data:…', a
 * relative path or a non-string comes back unchanged.
 */
export function assetUrl(path) {
  if (!ASSET_BASE || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path;
  return `${ASSET_BASE}${path}`;
}

/** The inverse of assetUrl(): the base stripped off a URL it built; any other URL comes back unchanged. */
export function assetPath(url) {
  if (!ASSET_BASE || typeof url !== 'string' || !url.startsWith(ASSET_BASE)) return url;
  const rest = url.slice(ASSET_BASE.length);
  return rest.startsWith('/') ? rest : url;
}

let sri;
/** The integrity value the server computed for a stylesheet ('/css/x.css', with or without ?v=), '' without one. */
export function assetIntegrity(path) {
  if (!ASSET_BASE) return '';
  if (sri === undefined) {
    try { sri = JSON.parse(globalThis.document?.getElementById?.('hh-sri')?.textContent || '{}') || {}; } catch { sri = {}; }
  }
  const key = typeof path === 'string' ? assetPath(path).split('?')[0] : '';
  return Object.hasOwn(sri, key) ? sri[key] : '';
}

let failed = false;
/** The host failed after the boot (see the header): tell the page once. */
export function noteHostFailure(why = '') {
  if (failed || !ASSET_BASE) return;
  failed = true;
  try { console.warn(`the asset host failed (${why}); this page's next files come from this server`); } catch { /* no console */ }
  try { globalThis.dispatchEvent?.(new CustomEvent('hh:assets-failed', { detail: { why } })); } catch { /* no DOM */ }
}

/** A URL on the asset host (the base's origin): the host's root (packs) or anything under the base. */
export function onHost(url) {
  if (!ASSET_BASE || typeof url !== 'string') return false;
  try { return new URL(url, globalThis.location?.href).origin === new URL(ASSET_BASE).origin; } catch { return false; }
}

/** The same file on this server: '<host>/b/<build>/public/x' -> '/x', '<host>/assets/packs/…' -> '/assets/packs/…'. */
export function selfUrl(url) {
  if (!onHost(url)) return url;
  if (url.startsWith(ASSET_BASE)) return assetPath(url);
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

/**
 * fetch() with the data fallback (see the header). Resolves with the host's response when it is ok, else with this
 * server's; rejects only when this server fails too (or when the URL was never on the host).
 */
export async function fetchAsset(url, init, fetcher = (u, i) => fetch(u, i)) {
  if (!onHost(url)) return fetcher(url, init);
  try {
    const r = await fetcher(url, init);
    if (r && (r.ok || r.status === 304)) return r;
    noteHostFailure(`HTTP ${r?.status} ${selfUrl(url)}`);
  } catch (err) {
    noteHostFailure(`${err?.message || err} ${selfUrl(url)}`);
  }
  return fetcher(selfUrl(url), init);
}
