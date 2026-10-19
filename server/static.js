// Static files: the build identity (SV-03) and cheap loads and reloads (SV-05).
//
// BUILD_HASH: a hash over the bytes of every file under public/ and shared/ (plus the three.js version), computed
// once at boot. It goes into `welcome.buildHash`, `/api/status.buildHash` and the page itself
// (<meta name="hh-build">), so an open tab can tell that the server now runs other game files (a deploy, a forgotten
// RULES_VERSION bump) and reload once (public/js/net/content-gate.js).
//
// index.html is rendered by the server (the file stays the ui lane's; it is never edited on disk):
//   - <meta name="hh-build" content="<BUILD_HASH>"> after <head>
//   - the page's import map gains one entry per module the client can load (found by scanning the imports from
//     the module entry, through the page's own map): `/js/x.js` -> `/js/x.js?v=<content hash>`. Every import, relative
//     or bare, then resolves to a versioned URL that is cached for a year (`immutable`); a changed file gets a new
//     URL, so a reload never runs stale code and an unchanged one costs no request at all.
//   - <link rel="modulepreload"> for the static graph right after the import map: the module waterfall (depth ~8)
//     becomes one parallel fetch. The page's own modulepreload links are dropped (unversioned, they would resolve
//     modules before the map and load them twice under two URLs).
//   - the entry script, stylesheets, icons and <img> get `?v=<content hash>` too. Preloads stay as they are (they
//     must match the URL the CSS asks for).
// Content hashes are cached by (size, mtime) and re-checked at every index.html request, so editing a file while
// the server runs is picked up by the next page load (dev), never served stale from an immutable URL.
//
// Caching: a `?v=` URL is `immutable` when v is the file's current content hash, or for /assets/ files (their
// manifests' content hashes, written by the asset tools); any other `?v=` (an old hash) revalidates. Unversioned game
// files revalidate (`no-cache` + ETag). /vendor/three without a version: a week, as before.
//
// Asset packs (qa2 SV-03): a cold load asked for ~90 GLB and 87 OGG files one by one (HTTP/1.1, six at a time). Every
// model family directory (public/assets/models/<family>/*.glb) and the Ogg sounds (public/assets/audio/*.ogg) is also
// served as ONE pack: GET /assets/packs/<id>.bin?v=<v> is the member files concatenated in name order. The index
// { <id>: { dir, v, files: { <name>: [offset, length] } } } is inlined into index.html as
// <script type="application/json" id="hh-packs">, so a loader slices a member out of its pack without a request of
// its own (public/js/net/packs.js). v hashes the members' names and content: a rebuilt model changes only its own
// family's pack. Model variants (`<key>-<variant>.glb`: upgrade tiers, pet breeds) are no members: they load one by one
// when a farm first shows them. A pack URL with an older v answers 404 (its offsets no longer hold): the loader falls back to the
// single file. Packs are built on first request and kept in memory (raw + gzip).
//
// Compression: js/mjs/json/css/html/svg/glb/wav and other text-like files of 1 KB and more are served gzip'ed
// (`Vary: Accept-Encoding`) from an in-memory cache (zlib, no dependency), when the client accepts it, the request
// has no Range, and gzip saves at least 10 %.
//
// Option 2 (release 1.0, docs/qa/release/option2.md D4-D9; server/asset-origin.js decides per request):
//   - serveBuild(): GET/HEAD /b/<BUILD_HASH>/{public,shared,vendor/three}/<file> serves that file to any origin (CORS,
//     CORP, Timing-Allow-Origin, immutable: the prefix pins the bytes), only when <BUILD_HASH> is this server's build;
//     anything else under /b/ is 404 no-store. The repo's own layout under the prefix, because every client module
//     imports shared/ with one '..' more than its URL depth (at an origin's root the browser clamps it, under a prefix
//     it would eat a segment: option2#3). Packs keep their own content version at the root and get the same three
//     headers there (an unchanged model family stays cached across deploys: option2#10). No CORS anywhere else.
//   - indexHtml(name, base): the HOST variant points every static file at <base> (the import map's values, the
//     module preloads, the entry script, stylesheets, images, sources and preloads; the manifest and the icons stay),
//     gives every module in the graph an import-map `integrity` entry (SHA-256, each once: Chrome applies it to the
//     modulepreload fetches too) and the entry script and stylesheets an `integrity` attribute, all computed from THIS
//     server's own files, so a public host that serves anything else cannot run code here. It adds
//     <meta name="hh-assets">, `referrer: same-origin`, a preconnect and the watchdog (falls back to this server on a
//     failed or stalled host file, once per tab, with ?assets=self and a 10-minute cookie).
//   - the SELF variant with `probe` loads /sri-probe once per browser: a page whose import map gives a probe module a
//     deliberately wrong hash; a browser that refuses it (and runs the correct one) gets the hh_sri cookie, and only
//     such a browser is ever sent the host variant (the support rule, critique#25).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(zlib.gzip);
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';
export const VENDOR_CACHE = `public, max-age=${7 * 24 * 3600}`;
const COMPRESSIBLE = new Set(['.js', '.mjs', '.json', '.css', '.html', '.svg', '.glb', '.wav', '.txt', '.map', '.gltf', '.obj']);
const MIN_GZIP_BYTES = 1024;
const GZ_CACHE_MAX = 96 * 1024 * 1024;
/** Mount points, most specific first: URL prefix -> directory under the repo root. */
const MOUNTS = [['/vendor/three/', 'node_modules/three/'], ['/shared/', 'shared/'], ['/', 'public/']];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/** A pack URL (qa2 SV-03, above): /assets/packs/<id>.bin */
const PACK_RE = /^\/assets\/packs\/([a-z0-9_-]+)\.bin$/;
/** The pack index as a file (option 2's host page asks for it instead of carrying it inline). */
const PACK_INDEX_PATH = '/assets/packs/index.json';
/** Option 2: /b/<build>/<repo path> (above). */
const BUILD_RE = /^\/b\/([0-9a-f]{16})(\/.*)$/;
/** The headers that let another origin use a static game file (and read its timing), on /b/ and versioned packs only. */
function crossOrigin(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Timing-Allow-Origin', '*');
}

/**
 * The pack layout of a tree: [{ id, url, abs, ext }] for every model family directory and the Ogg sounds. Members
 * are read when the index is built (packIndex).
 */
export function packSpecs(root) {
  const out = [];
  const models = path.join(root, 'public/assets/models');
  let fams = [];
  try {
    fams = fs.readdirSync(models, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  } catch { /* no models */ }
  // a model variant (`<key>-<variant>.glb`: an upgrade tier, a pet breed; wave 4) is shown only once a farm has it, so it
  // stays out of its family's pack and loads as a file of its own when it is first drawn: the pack (fetched whole and
  // kept for the session) would otherwise carry every tier and breed into every boot (+2.4 MB; integration wave 4)
  for (const f of fams) if (/^[a-z0-9_-]+$/.test(f)) out.push({ id: `models-${f}`, url: `/assets/models/${f}/`, abs: path.join(models, f), ext: '.glb', variants: false });
  if (fs.existsSync(path.join(root, 'public/assets/audio'))) {
    out.push({ id: 'audio', url: '/assets/audio/', abs: path.join(root, 'public/assets/audio'), ext: '.ogg' });
  }
  return out;
}

function threeVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'node_modules/three/package.json'), 'utf8')).version || '?';
  } catch {
    return '?';
  }
}

const buildCache = new Map();

/** The BUILD_HASH of a tree (16 hex). Computed once per root and process (~0.1 s for 26 MB). */
export function buildHash(root) {
  if (buildCache.has(root)) return buildCache.get(root);
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) {
        h.update(`${r}\0`);
        h.update(fs.readFileSync(path.join(root, r)));
        h.update('\0');
      }
    }
  };
  walk('public');
  walk('shared');
  h.update(`three@${threeVersion(root)}`);
  const out = h.digest('hex').slice(0, 16);
  buildCache.set(root, out);
  return out;
}

/** The file behind a URL path ({ abs, prefix }), or null (outside every mount, traversal, dotfiles). */
export function fileOf(root, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.split('/').some((seg) => seg.startsWith('.'))) return null;
  for (const [prefix, dir] of MOUNTS) {
    if (!p.startsWith(prefix)) continue;
    const base = path.join(root, dir);
    const abs = path.join(base, p.slice(prefix.length));
    if (!abs.startsWith(base)) return null;
    return { abs, prefix };
  }
  return null;
}

// Imports, read line by line (a full JS tokenizer is not worth it here; the client's modules keep the usual layout):
// a line that starts with `import`/`export ... from '...'`, `import '...'`, or `} from '...'` (the end of a multi-line
// import) is static; `import('...')` with a literal on a line that is not a comment is dynamic. Comment lines (`//`,
// `/*`, ` *`) never count, so JSDoc types like `{import('../x.js').T}` are not imports.
const STATIC_LINE = /^\s*(?:(?:import|export)\b[^'"]*?\bfrom\s*|import\s*)(['"])([^'"]+)\1|\}\s*from\s*(['"])([^'"]+)\3\s*;?\s*$/;
const DYNAMIC_IN_LINE = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/** [{ spec, dynamic }] of one module's source. */
export function importsOf(src) {
  const out = [];
  for (const line of src.split('\n')) {
    if (COMMENT_LINE.test(line)) continue;
    const m = STATIC_LINE.exec(line);
    if (m) out.push({ spec: m[2] ?? m[4], dynamic: false });
    DYNAMIC_IN_LINE.lastIndex = 0;
    for (let d = DYNAMIC_IN_LINE.exec(line); d; d = DYNAMIC_IN_LINE.exec(line)) out.push({ spec: d[2], dynamic: true });
  }
  return out;
}

/** Resolve a specifier the way the browser does with this import map ({ imports }), from module URL `from`. */
function resolveSpec(spec, from, imports) {
  if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
    return new URL(spec, `http://x${from}`).pathname;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return null;           // http:, data:, node: ...
  if (Object.hasOwn(imports, spec)) return new URL(imports[spec].split('?')[0], 'http://x/').pathname;
  let best = null;
  for (const key of Object.keys(imports)) if (key.endsWith('/') && spec.startsWith(key) && (!best || key.length > best.length)) best = key;
  return best ? new URL(imports[best] + spec.slice(best.length), 'http://x/').pathname : null;
}

/**
 * The host variant's inline watchdog (option2#D7, with the three changes of #7): before the game's code has run
 * (window.__hh), a host script, module preload or stylesheet that fails (a 404 after a deploy there, an integrity
 * mismatch, a blocked or dead host), no host file finished for 10 s (a stall, not a slow but moving load), or the game
 * not started after 60 s at all (one module hanging while others trickle in), sends this tab to the same page with
 * every file from this server: ?assets=self (works where cookies are blocked) plus a 10-minute cookie, once per tab and
 * minute (no reload loop).
 */
function watchdog(base) {
  return `(function(){var B=${JSON.stringify(base)},K='hh.assetsFell',done=false,last=performance.now();
function fall(why){if(done||window.__hh)return;done=true;if(/[?&]assets=self\\b/.test(location.search))return;
try{var w=Number(sessionStorage.getItem(K))||0;if(Date.now()-w<60000)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){}
try{document.cookie='hh_assets=self; Max-Age=600; Path=/; SameSite=Lax'}catch(e){}
try{console.warn('game files from the asset host failed ('+why+'): loading them from this server')}catch(e){}
var u=new URL(location.href);u.searchParams.set('assets','self');location.replace(u.href)}
addEventListener('error',function(e){var t=e.target;if(!t||!t.tagName)return;var u=t.src||t.href||'';if(u.indexOf(B)!==0)return;
if(t.tagName==='SCRIPT'||(t.tagName==='LINK'&&/stylesheet|modulepreload|preload/.test(t.rel)))fall(t.tagName.toLowerCase()+' '+u.slice(B.length))},true);
try{new PerformanceObserver(function(l){l.getEntries().forEach(function(x){if(x.name.indexOf(B)===0)last=performance.now()})}).observe({type:'resource',buffered:true})}catch(e){last=Infinity}
var iv=setInterval(function(){if(window.__hh||done){clearInterval(iv);return}if(performance.now()-last>10000)fall('no file from the asset host for 10 s');
else if(performance.now()>60000)fall('the game has not started after 60 s')},1000)})();`;
}

/**
 * The self variant's support probe: /sri-probe in a hidden frame after the boot (the header), until the browser has
 * the cookie; a browser that failed it is asked again after a week, not on every page.
 */
const PROBE_LOADER = "(function(){try{if(/(?:^|;\\s*)hh_sri=1/.test(document.cookie))return;"
  + "if(Date.now()-(Number(localStorage.getItem('hh.sriProbedAt'))||0)<6048e5)return}catch(e){return}"
  + "addEventListener('load',function(){setTimeout(function(){var f=document.createElement('iframe');f.hidden=true;"
  + "f.setAttribute('aria-hidden','true');f.tabIndex=-1;f.src='/sri-probe';document.body.appendChild(f);"
  + "setTimeout(function(){f.remove()},20000)},4000)})})();";

export class StaticFiles {
  /** @param {{ root: string, log?: Console }} o */
  constructor({ root, log = console }) {
    this.root = root;
    this.log = log;
    this.build = buildHash(root);
    /** abs -> { size, mtimeMs, mtime, hash, gz?: Promise<Buffer|null>, gzLen } */
    this.files = new Map();
    this.gzBytes = 0;
    /** the last rendered index.html and what it depended on */
    this.page = null;
    /** id -> { v, body: Buffer, gz: Promise<Buffer|null> } built pack bodies (SV-03) */
    this.packBodies = new Map();
  }

  /**
   * One pack's index entry { dir, v, files } (null when it has no members) and its deps [[abs, hash]]. Members are
   * hashed through info() (cached by size and mtime): one stat per member once the files are known.
   */
  packEntry(sp) {
    let names;
    try {
      names = fs.readdirSync(sp.abs).filter((n) => n.endsWith(sp.ext) && !n.startsWith('.') && !(sp.variants === false && n.includes('-'))).sort();
    } catch {
      return { entry: null, deps: [] };
    }
    const files = {};
    const deps = [];
    const h = crypto.createHash('sha256');
    let off = 0;
    for (const n of names) {
      const abs = path.join(sp.abs, n);
      const e = this.info(abs);
      if (!e) continue;
      files[n] = [off, e.size];
      off += e.size;
      h.update(`${n}\0${e.hash}\0`);
      deps.push([abs, e.hash]);
    }
    return { entry: off > 0 ? { dir: sp.url, v: h.digest('hex').slice(0, 12), files } : null, deps };
  }

  /** The pack index (see the header): { index: { id: { dir, v, files } }, deps: [[abs, hash]] }. */
  packIndex() {
    const index = {};
    const deps = [];
    for (const sp of packSpecs(this.root)) {
      const r = this.packEntry(sp);
      if (r.entry) index[sp.id] = r.entry;
      deps.push(...r.deps);
    }
    return { index, deps };
  }

  /** The body of pack `id` at version `v` (null: the current one), built once; null when `v` is not current. */
  packBody(id, v) {
    const sp = packSpecs(this.root).find((x) => x.id === id);
    const cur = sp && this.packEntry(sp).entry;
    if (!cur || (v !== null && v !== cur.v)) return null;
    const have = this.packBodies.get(id);
    if (have && have.v === cur.v) return have;
    const body = Buffer.concat(Object.keys(cur.files).map((n) => fs.readFileSync(path.join(sp.abs, n))));
    // a member rewritten while it was read: its offsets (or its content under this v) would lie; the next request
    // (or the next page, with the new index) gets the rebuilt pack
    const after = this.packEntry(sp).entry;
    if (!after || after.v !== cur.v || body.length !== Object.values(cur.files).reduce((a, [, len]) => a + len, 0)) return null;
    const entry = { v: cur.v, body, gz: null };
    entry.gz = gzipAsync(body, { level: 6 }).then((z) => (z.length <= body.length * 0.9 ? z : null), () => null);
    this.packBodies.set(id, entry);
    return entry;
  }

  /**
   * Express middleware for GET/HEAD /assets/packs/<id>.bin?v=<v> (immutable at the current v, 404 for an old one), and
   * /assets/packs/index.json: the index the game page inlines, as a file (option 2's host page loads it from the host:
   * 5.6 KB gzip of the 36 KB page budget; under /b/ it is pinned to this build, at the root it revalidates).
   */
  servePacks() {
    return (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path === PACK_INDEX_PATH) {
        const body = Buffer.from(JSON.stringify(this.packIndex().index));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', res.locals.buildPinned ? IMMUTABLE : REVALIDATE);
        res.setHeader('ETag', `"packs-${sha(body).slice(0, 16)}"`);
        if (req.fresh) return res.status(304).end();
        const z = acceptsGzip(req) ? zlib.gzipSync(body, { level: 6 }) : null;
        if (z) { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); }
        res.setHeader('Content-Length', (z || body).length);
        return req.method === 'HEAD' ? res.end() : res.end(z || body);
      }
      const m = PACK_RE.exec(req.path);
      if (!m) return next();
      const v = typeof (req.query || {}).v === 'string' ? req.query.v : null;
      // a pack at a content version is the same bytes for any page of any host (option 2 loads it from the public
      // host's root, so it stays cached across deploys); an unversioned pack is this server's own business
      if (v || res.locals.buildPinned) crossOrigin(res);
      let entry;
      try {
        entry = this.packBody(m[1], v);
      } catch (err) {
        this.log.warn('asset pack could not be built', { pack: m[1], err: err.message });
        entry = null;
      }
      if (!entry) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'no such pack (or an older version)' });
      return entry.gz.then((z) => {
        if (res.headersSent) return undefined;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', v || res.locals.buildPinned ? IMMUTABLE : REVALIDATE);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('ETag', `"pack-${entry.v}${z ? '-gz' : ''}"`);
        if (req.fresh) return res.status(304).end();
        const gz = Boolean(z) && !req.headers.range && acceptsGzip(req);
        const body = gz ? z : entry.body;
        if (gz) res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', body.length);
        return req.method === 'HEAD' ? res.end() : res.end(body);
      });
    };
  }

  /**
   * Express middleware for /b/<build>/... (option 2, see the header): this build's static files with CORS, 404
   * no-store for anything else. `enabled: false` (HH_ASSET_HOST=off, the kill switch) answers 404 for all of /b/, so
   * every Farmbox's handshake says mismatch and serves itself.
   */
  serveBuild({ enabled = true } = {}) {
    return (req, res, next) => {
      if (!req.path.startsWith('/b/')) return next();
      crossOrigin(res);
      const notFound = () => res.status(404).set('Cache-Control', 'no-store').type('text').send('Not found');
      const m = BUILD_RE.exec(req.path);
      if (!enabled || !m || m[1] !== this.build) return notFound();
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(204).end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
      const rest = m[2];
      const inner = rest.startsWith('/public/') ? rest.slice('/public'.length)
        : rest.startsWith('/shared/') || rest.startsWith('/vendor/three/') ? rest : null;
      if (!inner || !/^\/(js|css|assets|shared|vendor\/three)\//.test(inner) || /\.html?$/i.test(inner)) return notFound();
      if (!PACK_RE.test(inner) && inner !== PACK_INDEX_PATH) {
        const f = fileOf(this.root, inner);
        if (!f || !this.info(f.abs)) return notFound();
      }
      res.locals.buildPinned = true;
      const q = req.url.indexOf('?');
      req.url = inner + (q >= 0 ? req.url.slice(q) : '');
      return next();
    };
  }

  /**
   * The support probe (the header): GET /sri-probe is a tiny page whose import map lets one module in with its right
   * SHA-256 and refuses another with a wrong one; a browser where the right one runs and the wrong one does not gets
   * the hh_sri cookie (a year; Safari keeps script cookies a week, the probe then runs again). It shows its result, so
   * a person can open it on a phone. /sri-probe/ok.js and /sri-probe/bad.js are its modules. Never cached.
   */
  serveSriProbe() {
    const ok = 'globalThis.__hhProbe = (globalThis.__hhProbe || 0) | 1;\n';
    const bad = 'globalThis.__hhProbe = (globalThis.__hhProbe || 0) | 2;\n';
    const ok2 = 'globalThis.__hhProbe = (globalThis.__hhProbe || 0) | 4;\n';
    const sri = (s) => `sha256-${crypto.createHash('sha256').update(s).digest('base64')}`;
    const map = JSON.stringify({ imports: { 'hh-probe-ok': '/sri-probe/ok.js', 'hh-probe-bad': '/sri-probe/bad.js', 'hh-probe-ok2': '/sri-probe/ok2.js' },
      integrity: { '/sri-probe/ok.js': sri(ok), '/sri-probe/bad.js': sri('not this file'), '/sri-probe/ok2.js': sri(ok2) } });
    const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Integrity check</title>
<script type="importmap">${map}</script></head>
<body style="font:16px system-ui,sans-serif;margin:2rem"><p id="r">…</p>
<script type="module">
let ran = 0;
// bad.js must be reachable (a failed request is no proof of integrity), the right module before and after it must run,
// and bad.js (a wrong hash in the map) must not: only then does this browser enforce import-map integrity
let reach = false;
try { reach = (await fetch('/sri-probe/bad.js', { cache: 'no-store' })).ok; } catch { reach = false; }
try { await import('hh-probe-ok'); } catch { /* refused */ }
try { await import('hh-probe-bad'); } catch { /* refused: what we want */ }
try { await import('hh-probe-ok2'); } catch { /* refused */ }
ran = globalThis.__hhProbe || 0;
const yes = reach && ran === 5;
if (yes) document.cookie = 'hh_sri=1; Max-Age=31536000; Path=/; SameSite=Lax';
try { localStorage.setItem('hh.sriProbedAt', String(Date.now())); } catch { /* storage blocked: the probe runs again */ }
document.getElementById('r').textContent = yes ? 'import-map integrity: supported' : \`import-map integrity: not supported (\${ran})\`;
try { if (parent !== window) parent.postMessage({ hhSri: yes }, location.origin); } catch { /* no parent */ }
</script></body></html>
`;
    return (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const body = req.path === '/sri-probe' || req.path === '/sri-probe/' ? page
        : req.path === '/sri-probe/ok.js' ? ok : req.path === '/sri-probe/bad.js' ? bad : req.path === '/sri-probe/ok2.js' ? ok2 : null;
      if (body === null) return next();
      res.setHeader('Cache-Control', 'no-store');
      res.type(body === page ? 'html' : 'text/javascript');
      return res.send(body);
    };
  }

  /** Stat + content hash (12 hex) of a file, cached by (size, mtime); null when it is not a readable file. */
  info(abs) {
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    const c = this.files.get(abs);
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c;
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      return null;
    }
    if (c && c.gzLen) this.gzBytes -= c.gzLen;
    // one digest per file read: the 12-hex content version and the integrity value (option 2) come from it
    const d = crypto.createHash('sha256').update(buf).digest();
    const e = { size: st.size, mtimeMs: st.mtimeMs, mtime: st.mtime, hash: d.toString('hex').slice(0, 12), sri: `sha256-${d.toString('base64')}`,
      gz: null, gzLen: 0 };
    this.files.set(abs, e);
    return e;
  }

  /** The gzip body of a file (cached), or null when gzip does not save at least 10 %. */
  gz(abs, e) {
    if (!e.gz) {
      e.gz = (async () => {
        const raw = await fs.promises.readFile(abs);
        const z = await gzipAsync(raw, { level: 6 });
        if (z.length > raw.length * 0.9) return null;
        if (this.files.get(abs) === e) {
          e.gzLen = z.length;
          this.gzBytes += z.length;
          this.trim(abs);
        }
        return z;
      })().catch((err) => {
        e.gz = null;
        this.log.warn('gzip failed; serving the file as is', { file: abs, err: err.message });
        return null;
      });
    }
    return e.gz;
  }

  /** Keep the gzip cache under GZ_CACHE_MAX (oldest entries first, never `keep`). */
  trim(keep) {
    for (const [abs, e] of this.files) {
      if (this.gzBytes <= GZ_CACHE_MAX) return;
      if (abs === keep || !e.gzLen) continue;
      this.gzBytes -= e.gzLen;
      e.gz = null;
      e.gzLen = 0;
    }
  }

  /** Cache-Control for a request of `urlPath` (its file `file`, current info `e`) with `query`; `pinned`: under /b/. */
  cacheControl(query, urlPath, file, e, pinned = false) {
    if (pinned) return IMMUTABLE;                              // /b/<build>/...: the path pins the content (option 2)
    const v = typeof query.v === 'string' ? query.v : null;
    if (v && (v === e.hash || (file.prefix === '/' && urlPath.startsWith('/assets/')))) return IMMUTABLE;
    if (v) return REVALIDATE;                                    // an old hash: the newest file, revalidated
    return file.prefix === '/vendor/three/' ? VENDOR_CACHE : REVALIDATE;
  }

  /** `url?v=<hash>` for a local URL path, or the URL unchanged when it is not a file. */
  versioned(url) {
    const f = fileOf(this.root, url);
    const e = f && this.info(f.abs);
    return e ? `${url}?v=${e.hash}` : url;
  }

  /**
   * The module graph of a page: every module reachable from `entry` through `imports` (static, and dynamic with a
   * literal specifier). Returns { all: Map<url, abs>, statics: Set<url>, bare: Map<spec, url> }.
   */
  graph(entry, imports) {
    const all = new Map();
    const statics = new Set();
    const bare = new Map();
    const queue = [[entry, true]];
    while (queue.length) {
      const [url, isStatic] = queue.shift();
      if (all.has(url)) {
        if (isStatic && !statics.has(url)) { statics.add(url); queue.push([url, true]); }
        continue;
      }
      const f = fileOf(this.root, url);
      if (!f || !this.info(f.abs)) continue;
      all.set(url, f.abs);
      if (isStatic) statics.add(url);
      let src;
      try {
        src = fs.readFileSync(f.abs, 'utf8');
      } catch {
        continue;
      }
      for (const { spec, dynamic } of importsOf(src)) {
        const to = resolveSpec(spec, url, imports);
        if (!to || !/\.m?js$/.test(to)) continue;
        if (!spec.startsWith('.') && !spec.startsWith('/')) bare.set(spec, to);
        queue.push([to, isStatic && !dynamic]);
      }
    }
    return { all, statics, bare };
  }

  /**
   * index.html as served (see the header), or null when public/index.html is missing. Memoized per input.
   * `name`: another page under public/ rendered the same way (the multi-farm landing page, server/multi.js).
   * `base` (option 2): '<origin>/b/<build>' renders the HOST variant (every static file from there, with integrity);
   * null the self variant. `probe`: the self variant also loads /sri-probe once per browser (the support rule).
   */
  indexHtml(name = 'index.html', base = null, { probe = false, hint = null } = {}) {
    const abs = path.join(this.root, 'public', name);
    const me = this.info(abs);
    if (!me) return null;
    const first = base && Array.isArray(hint) ? hint.filter((id) => /^[a-z0-9_-]+$/.test(id)).join(',') : '';
    const key = `${name}|${base || ''}|${probe && !base ? 'p' : ''}|${first}`;
    const memo = key === 'index.html|||' ? this.page : this.pages?.get(key);
    if (memo && memo.hash === me.hash && memo.deps.every(([a, h]) => { const e = this.info(a); return e && e.hash === h; })) return memo;
    let html = fs.readFileSync(abs, 'utf8');
    const deps = [];
    const dep = (a) => { const e = this.info(a); if (e) deps.push([a, e.hash]); return e; };
    // the host variant's URL of a root path: the repo's layout under the build prefix (see the header)
    const toAsset = (u) => (u.startsWith('/shared/') || u.startsWith('/vendor/three/') ? `${base}${u}` : `${base}/public${u}`);
    const local = (u) => u.startsWith('/') && !u.startsWith('//');
    // the page's own import map (the ui lane's), merged
    const mapRe = /<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i;
    const mm = mapRe.exec(html);
    let map = { imports: {} };
    if (mm) {
      try {
        map = JSON.parse(mm[1]);
        map.imports ??= {};
      } catch (err) {
        this.log.warn('index.html: the import map is not JSON; serving it unchanged', { err: err.message });
        map = null;
      }
    }
    const entryRe = /<script\b[^>]*\btype=["']module["'][^>]*>/gi;
    const entries = [];
    for (let m = entryRe.exec(html); m; m = entryRe.exec(html)) {
      const src = /\bsrc=["']([^"'?#]+)["']/.exec(m[0]);
      if (src && src[1].startsWith('/')) entries.push(src[1]);
    }
    const sri = new Map();             // host variant: URL as the page names it -> integrity value
    let preload = '';
    if (map) {
      const imports = { ...map.imports };
      const statics = new Set();
      for (const entry of entries) {
        const g = this.graph(entry, map.imports);
        for (const [url, a] of g.all) {
          const e = dep(a);
          if (!e) continue;
          imports[url] = base ? toAsset(url) : `${url}?v=${e.hash}`;
          if (base) sri.set(imports[url], e.sri);
        }
        for (const [spec, url] of g.bare) if (imports[url]) imports[spec] = imports[url];
        for (const url of g.statics) if (url !== entry && imports[url]) statics.add(imports[url]);
      }
      // the page's own entries (bare specifiers, prefixes like three/addons/) follow the files to the host
      if (base) for (const k of Object.keys(imports)) if (local(imports[k]) && !imports[k].startsWith(base)) imports[k] = toAsset(imports[k]);
      const out = { ...map, imports };
      if (base) out.integrity = { ...(map.integrity || {}), ...Object.fromEntries(sri) };
      const json = JSON.stringify(out, null, base ? 0 : 1);
      const tag = `<script type="importmap">\n${json}\n</script>`;
      preload = [...statics].sort().map((u) => `<link rel="modulepreload" href="${u}">`).join('\n');
      // The page's own module preloads go: unversioned, and before the map, they resolve modules the map then
      // cannot remap ("rule removed as it conflicted with already resolved module specifiers"), so one module ends
      // up loaded under two URLs. The versioned set below replaces them.
      html = html.replace(/[ \t]*<link\b[^>]*\brel=["']modulepreload["'][^>]*>[ \t]*\r?\n?/gi, '');
      if (mm) html = html.replace(mapRe, () => `${tag}\n${preload}`);
      else html = html.replace(/<\/head>/i, () => `${tag}\n${preload}\n</head>`);
    }
    // the entry script, stylesheets, icons and images: versioned (preloads are left alone, see the header); in the host
    // variant on the host (the icons stay: the tab and the home screen ask this server for them), the entry script and
    // the stylesheets with integrity
    html = html.replace(/<(script|img|link)\b[^>]*>/gi, (tag, el) => {
      let rel = null;
      if (/^link$/i.test(el)) {
        rel = /\brel=["']([^"']+)["']/i.exec(tag);
        if (!rel || !/^(stylesheet|icon|shortcut icon|apple-touch-icon)$/i.test(rel[1].trim())) return tag;
        rel = rel[1].trim().toLowerCase();
      }
      return tag.replace(/\b(src|href)=(["'])(\/[^"'?#]*)\2/i, (all, attr, q, url) => {
        const f = fileOf(this.root, url);
        const e = f && dep(f.abs);
        if (!e) return all;
        if (!base || (rel && rel !== 'stylesheet')) return `${attr}=${q}${url}?v=${e.hash}${q}`;
        const at = toAsset(url);
        if (/^script$/i.test(el)) return `${attr}=${q}${at}${q} integrity="${e.sri}"`;
        if (rel === 'stylesheet') return `${attr}=${q}${at}${q} integrity="${e.sri}" crossorigin="anonymous"`;
        return `${attr}=${q}${at}${q}`;
      });
    });
    if (base) {
      // the font and painting preloads and the <picture> sources: the same URL the CSS (relative url()s) and the
      // <img> ask for, on the host
      html = html.replace(/<link\b[^>]*\brel=["']preload["'][^>]*>/gi, (tag) => tag.replace(/\bhref=(["'])(\/[^"'?#]*)\1/i,
        (all, q, url) => (fileOf(this.root, url) && this.info(fileOf(this.root, url).abs) ? `href=${q}${toAsset(url)}${q}` : all)));
      html = html.replace(/<(source|img)\b[^>]*\bsrcset=[^>]*>/gi, (tag) => tag.replace(/\bsrcset=(["'])([^"']*)\1/i, (all, q, set) =>
        `srcset=${q}${set.split(',').map((part) => part.trim().replace(/^(\/[^\s?#]*)/, (u) => (local(u) ? toAsset(u) : u))).join(', ')}${q}`));
    }
    // the asset packs (SV-03): their index rides in the game page; a changed model re-renders it (deps). Another page
    // (the multi-farm landing page) loads no models: no index there (it was 5.7 KB of the front door's 10 KB gzip)
    let meta = `<meta name="hh-build" content="${this.build}">`;
    if (base) {
      const origin = new URL(base).origin;
      meta += `\n  <meta name="hh-assets" content="${base}/public">\n  <meta name="referrer" content="same-origin">`;
      meta += `\n  <link rel="preconnect" href="${origin}" crossorigin>`;
      // the model packs this farm's first view needs (server/http.js): the browser starts them before the welcome
      if (first) meta += `\n  <meta name="hh-first-packs" content="${first}">`;
      // the stylesheets a page links later (ensureStylesheet) get their integrity from here (net/asset-base.js)
      const css = {};
      for (const f of this.cssFiles()) { const e = dep(f.abs); if (e) css[f.url] = e.sri; }
      meta += `\n  <script type="application/json" id="hh-sri">${JSON.stringify(css)}</script>`;
      meta += `\n  <script>${watchdog(base)}</script>`;
    }
    if (name === 'index.html') {
      const packs = this.packIndex();
      deps.push(...packs.deps);
      // the host page names the index on the host instead of carrying it (the page budget; net/packs.js loads it)
      if (base) meta += `\n  <meta name="hh-packs" content="${base}/public${PACK_INDEX_PATH}">`;
      else meta += `\n  <script type="application/json" id="hh-packs">${JSON.stringify(packs.index).replace(/</g, '\\u003c')}</script>`;
    }
    html = /<meta\s+charset=[^>]*>/i.test(html)
      ? html.replace(/<meta\s+charset=[^>]*>/i, (m) => `${m}\n  ${meta}`)
      : html.replace(/<head(\s[^>]*)?>/i, (h) => `${h}\n  ${meta}`);
    if (probe && !base) html = html.replace(/<\/body>/i, () => `<script>${PROBE_LOADER}</script>\n</body>`);
    const body = Buffer.from(html);
    const page = { hash: me.hash, deps, body, etag: `"${sha(body).slice(0, 16)}"`, gz: zlib.gzipSync(body, { level: 6 }) };
    if (key === 'index.html|||') this.page = page;
    else (this.pages ??= new Map()).set(key, page);
    return page;
  }

  /** The models manifest (public/assets/models/manifest.json), parsed once per content; null without one. */
  modelManifest() {
    const abs = path.join(this.root, 'public/assets/models/manifest.json');
    const e = this.info(abs);
    if (!e) return null;
    if (this.manifestMemo?.hash !== e.hash) {
      try { this.manifestMemo = { hash: e.hash, json: JSON.parse(fs.readFileSync(abs, 'utf8')) }; } catch { this.manifestMemo = { hash: e.hash, json: null }; }
    }
    return this.manifestMemo.json;
  }

  /** [{ url: '/css/x.css', abs }] for every stylesheet under public/css (the host variant's lazy-link integrity). */
  cssFiles() {
    const dir = path.join(this.root, 'public', 'css');
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.css')).sort(); } catch { /* none */ }
    return names.map((n) => ({ url: `/css/${n}`, abs: path.join(dir, n) }));
  }

  /**
   * Answer a rendered page ({ body, gz, etag } from indexHtml or derived from it): no-cache + ETag, gzip when
   * accepted, HEAD without a body.
   */
  sendPage(req, res, page, { varies = false } = {}) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // option 2: the page differs by cookie (the support proof, the fallback): no shared cache may hand one browser's
    // variant to another
    res.setHeader('Cache-Control', varies ? `private, ${REVALIDATE}` : REVALIDATE);
    res.setHeader('Vary', varies ? 'Accept-Encoding, Cookie' : 'Accept-Encoding');
    res.setHeader('ETag', page.etag);
    if (req.fresh) return res.status(304).end();
    const gz = acceptsGzip(req);
    const body = gz ? page.gz : page.body;
    if (gz) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', body.length);
    return req.method === 'HEAD' ? res.end() : res.end(body);
  }

  /**
   * Express middleware for GET/HEAD of `/` and `/index.html`. `variantOf(req)` (option 2, server/http.js): null, or
   * { base, probe } for this request (server/asset-origin.js baseFor).
   */
  serveIndex(variantOf = () => null) {
    return (req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || (req.path !== '/' && req.path !== '/index.html')) return next();
      let page;
      let v = null;
      try {
        v = variantOf(req);
        page = this.indexHtml('index.html', v?.base ?? null, { probe: Boolean(v?.probe), hint: v?.hint ?? null });
      } catch (err) {
        this.log.error('index.html could not be rendered; serving the file as is', err);
        return next();
      }
      if (!page) return next();
      return this.sendPage(req, res, page, { varies: Boolean(v) });
    };
  }

  /**
   * Express middleware for every other file: decides Cache-Control (res.locals.cacheControl, used by the
   * express.static fallback too) and answers compressible files gzip'ed.
   */
  serveFiles() {
    return (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const file = fileOf(this.root, req.path);
      const e = file && this.info(file.abs);
      if (!e) return next();
      const cc = this.cacheControl(req.query || {}, req.path, file, e, Boolean(res.locals.buildPinned));
      res.locals.cacheControl = cc;
      const ext = path.extname(file.abs).toLowerCase();
      if (!COMPRESSIBLE.has(ext)) return next();
      res.setHeader('Vary', 'Accept-Encoding');
      if (e.size < MIN_GZIP_BYTES || req.headers.range || !acceptsGzip(req)) return next();
      this.gz(file.abs, e).then((z) => {
        if (!z || res.headersSent) return next();
        res.type(ext);
        res.setHeader('Cache-Control', cc);
        res.setHeader('Last-Modified', e.mtime.toUTCString());
        res.setHeader('ETag', `"${e.hash}-gz"`);
        if (req.fresh) return res.status(304).end();
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', z.length);
        return req.method === 'HEAD' ? res.end() : res.end(z);
      }, next);
      return undefined;
    };
  }
}

/** True when the request accepts gzip (q > 0). */
export function acceptsGzip(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  return ae.split(',').some((part) => {
    const [enc, ...params] = part.trim().split(';');
    if (enc.trim().toLowerCase() !== 'gzip' && enc.trim() !== '*') return false;
    const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}
