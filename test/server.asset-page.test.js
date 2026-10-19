// Option 2's page (option2#D11 test 3, release 1.0 O1, critique#5, #25): the host variant of index.html points every
// static file at the public host and checks every one of them against THIS server's own bytes (SHA-256, each module
// once, in the import map; attributes on the entry script and stylesheets), keeps the manifest and the icons home,
// fits 36 KB gzip, and carries the watchdog; the self variant carries none of that, only (when an asset origin is set)
// the once-per-browser support probe; the server picks the variant per request (server/asset-origin.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { StaticFiles, fileOf } from '../server/static.js';
import { testServer, ROOT } from './helpers/server.js';
import { loadConfig } from '../server/config.js';
import { ASSET_PENDING as SCAN_PENDING } from './rel-infra.pending.js';

const quiet = { info() {}, warn() {}, error() {}, log() {} };
const sf = new StaticFiles({ root: ROOT, log: quiet });
const BASE = `https://hh.example.app/b/${sf.build}`;
const host = sf.indexHtml('index.html', BASE);
const self = sf.indexHtml();
const html = String(host.body);
const mapOf = (h) => JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(h)[1]);
const sri = (abs) => `sha256-${crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('base64')}`;
/** The file behind a host URL (the repo layout under /b/<build>/). */
const fileOfHost = (u) => {
  assert.ok(u.startsWith(`${BASE}/`), u);
  const rest = u.slice(BASE.length).split('?')[0];
  const f = fileOf(ROOT, rest.startsWith('/public/') ? rest.slice('/public'.length) : rest);
  assert.ok(f && fs.existsSync(f.abs), `${u} is a file`);
  return f.abs;
};

test('host variant: no static src/href/srcset stays on this server except the manifest and the icons', () => {
  const tags = [...html.matchAll(/<(script|link|img|source)\b[^>]*>/gi)].map((m) => m[0]);
  for (const tag of tags) {
    for (const [, attr, url] of tag.matchAll(/\b(src|href|srcset)=["']([^"']+)["']/gi)) {
      if (!url.startsWith('/') || url.startsWith('//')) continue;
      assert.match(tag, /rel=["'](manifest|icon|apple-touch-icon|shortcut icon)["']/, `<${tag.slice(1, 40)} ${attr}="${url}"> stays home`);
    }
  }
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<script type="module" src="https:\/\/hh\.example\.app\/b\/[0-9a-f]{16}\/public\/js\/main\.js" integrity="sha256-/);
});

test('host variant: the import map keeps its keys, every value is on the host, every module has its integrity (once)', () => {
  const sm = mapOf(String(self.body));
  const hm = mapOf(html);
  assert.deepEqual(Object.keys(hm.imports).sort(), Object.keys(sm.imports).sort(), 'keys unchanged (ui/harness/link.js reads them)');
  for (const [k, v] of Object.entries(hm.imports)) assert.ok(v.startsWith(`${BASE}/`), `${k} -> ${v}`);
  const modules = new Set(Object.values(hm.imports).filter((v) => !v.endsWith('/')));
  for (const u of modules) assert.equal(hm.integrity[u], sri(fileOfHost(u)), `integrity of ${u}`);
  for (const [u, v] of Object.entries(hm.integrity)) {
    assert.match(v, /^sha256-[A-Za-z0-9+/]{43}=$/, 'SHA-256, not 384');
    assert.equal(v, sri(fileOfHost(u)));
  }
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"([^>]*)>/g)];
  assert.ok(preloads.length > 100);
  for (const [, u, rest] of preloads) {
    assert.ok(hm.integrity[u], `preload ${u} is covered by the map`);
    assert.doesNotMatch(rest, /integrity/, 'each hash once: no attribute on preloads (the map applies to them)');
  }
  for (const [, u, rest] of html.matchAll(/<link rel="stylesheet" href="([^"]+)"([^>]*)>/g)) {
    assert.match(rest, new RegExp(` integrity="${sri(fileOfHost(u)).replace(/[+/]/g, '\\$&')}" crossorigin="anonymous"`), u);
  }
  const lazyCss = JSON.parse(/<script type="application\/json" id="hh-sri">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(lazyCss['/css/panels-w4.css'], sri(path.join(ROOT, 'public/css/panels-w4.css')), 'a lazily linked stylesheet too');
});

test('host variant: the size budget (36 KB gzip, at a real host name) and the head: base, referrer, preconnect, watchdog', () => {
  assert.ok(host.gz.length <= 36 * 1024, `host page ${host.gz.length} B gzip > 36 KB`);
  const real = sf.indexHtml('index.html', `https://harvest-hollow.up.railway.app/b/${sf.build}`);
  assert.ok(real.gz.length <= 36 * 1024, `host page at the real host name ${real.gz.length} B gzip > 36 KB`);
  // the pack index rides as a file on the host (5.6 KB gzip of the budget); the self page keeps it inline
  assert.doesNotMatch(html, /id="hh-packs"/);
  assert.match(html, new RegExp(`<meta name="hh-packs" content="${BASE}/public/assets/packs/index\\.json">`));
  assert.match(String(self.body), /<script type="application\/json" id="hh-packs">\{/);
  const head = html.slice(0, html.indexOf('<script type="importmap">'));
  assert.match(head, new RegExp(`<meta name="hh-assets" content="${BASE}/public">`));
  assert.match(head, /<meta name="referrer" content="same-origin">/);
  assert.match(head, /<link rel="preconnect" href="https:\/\/hh\.example\.app" crossorigin>/);
  assert.ok(head.indexOf('hh.assetsFell') > 0, 'the watchdog runs before any host file is asked for');
  assert.ok(head.indexOf('hh.assetsFell') < html.indexOf('rel="stylesheet"'));
  assert.notEqual(host.etag, self.etag, 'the two variants have different ETags');
});

test('self variant: none of it (no host, no integrity, no watchdog); the probe only when asked', () => {
  const s = String(self.body);
  assert.doesNotMatch(s, /hh-assets|integrity|hh\.assetsFell|referrer|preconnect|sri-probe/);
  const p = String(sf.indexHtml('index.html', null, { probe: true }).body);
  assert.match(p, /\/sri-probe/);
  assert.match(p, /hh_sri=1/);
  assert.equal(sf.indexHtml('index.html', BASE), host, 'memoized per variant');
});

test('the watchdog: a failed host file or a 10 s stall before the game runs sends the tab to ?assets=self, once', () => {
  const code = /<script>(\(function\(\)\{var B=[\s\S]*?)<\/script>/.exec(html)[1];
  const run = () => {
    const ctx = { listeners: {}, replaced: null, cookie: '', store: {}, timers: [], t: 0 };
    const sandbox = {
      performance: { now: () => ctx.t },
      location: { href: 'https://farm.example.net/?slot=p1', search: '?slot=p1', replace: (u) => { ctx.replaced = u; } },
      sessionStorage: { getItem: (k) => ctx.store[k] ?? null, setItem: (k, v) => { ctx.store[k] = v; } },
      addEventListener: (type, fn) => { ctx.listeners[type] = fn; },
      setInterval: (fn) => { ctx.timers.push(fn); return 1; },
      clearInterval: () => {},
      PerformanceObserver: class { constructor(cb) { ctx.po = cb; } observe() {} },
      console: { warn() {} },
      URL,
      Date,
      Number,
      String,
    };
    sandbox.window = sandbox;
    Object.defineProperty(sandbox, 'document', { value: { set cookie(v) { ctx.cookie = v; } } });
    vm.runInNewContext(code, sandbox);
    return { ctx, sandbox };
  };
  const a = run();
  a.ctx.listeners.error({ target: { tagName: 'SCRIPT', src: `${BASE}/public/js/main.js` } });
  assert.equal(a.ctx.replaced, 'https://farm.example.net/?slot=p1&assets=self');
  assert.match(a.ctx.cookie, /^hh_assets=self; Max-Age=600; Path=\/; SameSite=Lax$/);
  const b = run();
  b.ctx.listeners.error({ target: { tagName: 'IMG', src: 'https://farm.example.net/x.png' } });
  assert.equal(b.ctx.replaced, null, 'a file from this server is none of its business');
  b.ctx.t = 10_500;
  for (const f of b.ctx.timers) f();
  assert.match(b.ctx.replaced, /assets=self/, 'a 10 s stall');
  // one host module hangs while other host files keep arriving: the 60 s deadline still falls back
  const d = run();
  for (const t of [9000, 18000, 27000, 36000, 45000, 54000]) {
    d.ctx.t = t;
    d.ctx.po({ getEntries: () => [{ name: `${BASE}/public/assets/art/x.webp` }] });
    for (const f of d.ctx.timers) f();
  }
  assert.equal(d.ctx.replaced, null, 'a slow but moving load is left alone');
  d.ctx.t = 60_500;
  for (const f of d.ctx.timers) f();
  assert.match(d.ctx.replaced, /assets=self/, 'the game not started after 60 s');
  const c = run();
  c.sandbox.__hh = {};
  c.ctx.t = 60_000;
  for (const f of c.ctx.timers) f();
  c.ctx.listeners.error({ target: { tagName: 'LINK', rel: 'stylesheet', href: `${BASE}/public/css/x.css` } });
  assert.equal(c.ctx.replaced, null, 'the game is running: Reload is main.js\'s business');
});

test('fonts: each font preload is the URL its stylesheet asks for (relative url()s), else fonts are blocked by CORS', (t) => {
  if ([...SCAN_PENDING.keys()].some((f) => f.endsWith('.css'))) {
    t.diagnostic('waiting for ui-shell: style.css / shell.css / farm.css still use root url()s (scan PENDING); strict once clean');
    return;
  }
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  const fontUrls = new Set();
  for (const u of sheets) {
    const css = fs.readFileSync(fileOfHost(u), 'utf8');
    for (const [, x] of css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g)) fontUrls.add(new URL(x, u).href);
  }
  for (const [, u] of html.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)) assert.ok(fontUrls.has(u), `preload ${u} matches a url() in a stylesheet`);
});

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { 'accept-encoding': 'identity', ...headers } }, (res) => {
      const c = [];
      res.on('data', (x) => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode, h: res.headers, body: Buffer.concat(c).toString() }));
    }).on('error', reject);
  });
}

test('per request: an origin that matches gives the host page only to a public name with the support cookie', async () => {
  const s = await testServer({ assets: { ...loadConfig({}).assets, origin: 'https://hh.example.app', probe: 'http://127.0.0.1:9' } });
  try {
    const o = s.hh.assetOrigin;
    assert.ok(o, 'HH_ASSET_ORIGIN set: an AssetOrigin');
    await (o.inflight ?? Promise.resolve());          // its first real check (an unreachable test origin) ends first
    o.stop();
    o.state = 'match';
    const pub = { host: 'farm.example.net' };
    const variant = async (headers, q = '') => {
      const r = await get(s.port, `/${q}`, headers);
      return /<meta name="hh-assets"/.test(r.body) ? 'host' : /\/sri-probe/.test(r.body) ? 'self+probe' : 'self';
    };
    assert.equal(await variant({ ...pub, cookie: 'hh_sri=1' }), 'host');
    // the host page names the first view's model packs (the Farmbox knows its farm): the browser starts them early
    const hostPage = (await get(s.port, '/', { ...pub, cookie: 'hh_sri=1' })).body;
    const hint = /<meta name="hh-first-packs" content="([^"]+)">/.exec(hostPage)?.[1].split(',');
    assert.ok(hint && hint.includes('models-avatars') && hint.every((id) => /^models-(crops|homes|buildings|avatars|animals|trees|props)$/.test(id)),
      `a hint of high-use families (${hint})`);
    assert.doesNotMatch((await get(s.port, '/', { host: `127.0.0.1:${s.port}` })).body, /hh-first-packs/, 'never on a self page');
    assert.equal(await variant(pub), 'self+probe', 'no support cookie: the self page, which runs the probe');
    assert.equal(await variant({ host: `127.0.0.1:${s.port}`, cookie: 'hh_sri=1' }), 'self+probe', 'the LAN stays self');
    assert.equal(await variant({ ...pub, cookie: 'hh_sri=1; hh_assets=self' }), 'self+probe', 'after a fallback');
    assert.equal(await variant({ ...pub, cookie: 'hh_sri=1' }, '?assets=self'), 'self+probe');
    o.state = 'mismatch';
    assert.equal(await variant({ ...pub, cookie: 'hh_sri=1' }), 'self+probe', 'another build on the host');
    const hostRes = await get(s.port, '/', { ...pub, cookie: 'hh_sri=1' });
    assert.equal(hostRes.h['cache-control'], 'private, no-cache', 'a page that varies by cookie is never shared by a cache');
    assert.match(hostRes.h.vary, /Cookie/);
    const st = JSON.parse((await get(s.port, '/api/status')).body);
    assert.deepEqual(Object.keys(st.assets).sort(), ['checkedAt', 'origin', 'state']);
    assert.equal(st.assets.origin, 'https://hh.example.app');
    const probe = await get(s.port, '/sri-probe');
    assert.equal(probe.status, 200);
    assert.equal(probe.h['cache-control'], 'no-store');
    const map = mapOf(probe.body);
    const hash = async (u) => `sha256-${crypto.createHash('sha256').update((await get(s.port, u)).body).digest('base64')}`;
    assert.equal(map.integrity['/sri-probe/ok.js'], await hash('/sri-probe/ok.js'), 'the right hash');
    assert.equal(map.integrity['/sri-probe/ok2.js'], await hash('/sri-probe/ok2.js'), 'the right hash after the wrong one');
    assert.notEqual(map.integrity['/sri-probe/bad.js'], await hash('/sri-probe/bad.js'), 'a wrong one');
    assert.match(probe.body, /fetch\('\/sri-probe\/bad\.js'/, 'bad.js must be reachable: a failed request is no proof');
    assert.match(probe.body, /reach && ran === 5/);
  } finally {
    await s.close();
  }
});

test('without HH_ASSET_ORIGIN the page is exactly today\'s (no probe, assets null)', async () => {
  const s = await testServer();
  try {
    const r = await get(s.port, '/', { host: 'farm.example.net', cookie: 'hh_sri=1' });
    assert.doesNotMatch(r.body, /hh-assets|sri-probe/);
    assert.equal(r.h['cache-control'], 'no-cache', 'unchanged headers');
    assert.equal(JSON.parse((await get(s.port, '/api/status')).body).assets, null);
  } finally {
    await s.close();
  }
});

test('the pack index as a file: at the root (revalidated, no CORS) and under /b/ (pinned, CORS), the same as inline', async () => {
  const s = await testServer();
  try {
    const inline = JSON.parse(/<script type="application\/json" id="hh-packs">([\s\S]*?)<\/script>/.exec((await get(s.port, '/')).body)[1]);
    const root = await get(s.port, '/assets/packs/index.json');
    assert.equal(root.status, 200);
    assert.deepEqual(JSON.parse(root.body), inline);
    assert.equal(root.h['cache-control'], 'no-cache');
    assert.equal(root.h['access-control-allow-origin'], undefined);
    const pinned = await get(s.port, `/b/${s.hh.static.build}/public/assets/packs/index.json`);
    assert.equal(pinned.status, 200);
    assert.deepEqual(JSON.parse(pinned.body), inline);
    assert.equal(pinned.h['access-control-allow-origin'], '*');
    assert.equal(pinned.h['cache-control'], 'public, max-age=31536000, immutable');
  } finally {
    await s.close();
  }
});
