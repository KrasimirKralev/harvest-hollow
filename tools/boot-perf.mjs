#!/usr/bin/env node
// Boot measurement over a modelled link (release 1.0, infra; release-scope §8): how long a cold, warm or post-deploy
// boot takes to show the painting, run main.js, open the socket, get the welcome, become PLAYABLE (the boot curtain has
// lifted and a dock button answers a click: elementFromPoint at its centre is the button and the click opens its
// panel), complete the dock and draw every model (assets pending() held at 0 for 1.5 s); bytes by host, bytes over the
// slow link (the relay's counter), and the page's gzip size. Desktop 1366x768 or iPhone 13 (touch, notch insets); a
// new farm or a copy of the owners' save; the self path (the Farmbox alone) or option 2 (game files from the public
// host). Every number here is advisory: the integrator's quiet-window run counts (scope §2.2).
//
//   node tools/boot-perf.mjs [--root <tree>] [--device desktop|iphone13] [--farm new|owners] [--save <dir>]
//        [--link funnel|fast|<KB/s>,<rttMs>] [--option2] [--host-link cloud|<KB/s>,<rttMs>] [--runs 3]
//        [--pass cold|warm|deploy|all] [--self] [--shots 5,10,20,40] [--out <dir>] [--label <name>] [--gpu gl|swiftshader]
//        [--lang en|bg] [--timeout 300]
// Ports (infra's block, or HH_PORT_BASE's): the "Farmbox" server :4513 behind its relay :4512, the "public host" :4510
// behind :4511.
// Run it through .scratch/release/browser-slot.sh (one headless browser at a time). Prints one JSON line (medians)
// and writes <out>/<label>.json plus a markdown table.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startThrottle } from './throttle-proxy.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const puppeteer = require('puppeteer-core');
export const { KnownDevices } = puppeteer;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (a) => {
  const s = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
// a block of four ports: infra's 4510-4513 by default; HH_PORT_BASE=4520 runs the lab on the integrator's block
const PORT_BASE = Number(process.env.HH_PORT_BASE) || 4510;
export const PORTS = { host: PORT_BASE, hostProxy: PORT_BASE + 1, farmboxProxy: PORT_BASE + 2, farmbox: PORT_BASE + 3 };
export const LINKS = { funnel: [85, 100], cloud: [550, 60], fast: [0, 0] };
export const loadavg = () => fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');

/** "85,100" | "funnel" -> [KB/s, rttMs] */
export function parseLink(s, dflt = 'funnel') {
  const v = s ?? dflt;
  if (LINKS[v]) return LINKS[v];
  const [k, r] = String(v).split(',').map(Number);
  if (!Number.isFinite(k)) throw new Error(`bad link ${v}`);
  return [k, Number.isFinite(r) ? r : 100];
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

/** Copy a save directory (never edit the original) into `dest`; with no `src` an empty data dir (a new farm). */
export function freshData(dest, src = null) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (src) {
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(path.join(dest, 'incidents'), { recursive: true, force: true });
  } else fs.mkdirSync(dest, { recursive: true });
  return dest;
}

/**
 * Start a server from `root` (spawned node process, stopped by its own PID). Resolves once it prints its banner.
 * @returns {Promise<{ pid: number, port: number, log: () => string, stop: () => Promise<void> }>}
 */
export async function startServer({ root = REPO, port, dataDir, env = {}, multi = false }) {
  if (port < PORT_BASE || port > PORT_BASE + 3) throw new Error(`port ${port}: this lab uses ${PORT_BASE}-${PORT_BASE + 3} only`);
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HH_HOST: '127.0.0.1', HH_DATA_DIR: dataDir, HH_DEV: '1',
      HH_HARNESS_MOCK: '1', HH_TELEMETRY: 'off', ...(multi ? { HH_MODE: 'multi', HH_STARS_URL: 'off' } : {}), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 300 && !/running at|localhost:\d+/.test(log) && proc.exitCode === null; i++) await sleep(100);
  if (proc.exitCode !== null || !/running at|localhost:\d+/.test(log)) {
    proc.kill('SIGTERM');
    throw new Error(`server :${port} did not start: ${log.slice(-1200)}`);
  }
  return {
    pid: proc.pid, port, proc, log: () => log,
    async stop() {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(15000)]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    },
  };
}

/** GET a URL on 127.0.0.1 (a JSON body, or the raw response with `raw`). */
export function get(port, p, { headers = {}, raw = false, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (raw) return resolve({ status: res.statusCode, headers: res.headers, body });
        try { resolve(JSON.parse(body.toString('utf8'))); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** A token for slot `slot` on the farm at `port` ("this is me on a new device"; the farmer must be offline). */
export async function slotToken(port, slot = 'p1', name = 'Rowan') {
  const { WebSocket } = await import(path.join(REPO, 'node_modules/ws/wrapper.mjs'));
  const { PROTOCOL_VERSION } = await import(path.join(REPO, 'shared/net/protocol.js'));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const t = setTimeout(() => { ws.terminate(); reject(new Error('token: timeout')); }, 20000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION, cid: `bp${slot}${Date.now() % 1e4}`.slice(0, 8),
      claim: { slot, name, reclaim: true } })));
    ws.on('message', (raw) => {
      const list = (() => { const m = JSON.parse(String(raw)); return m.t === 'b' ? m.list : [m]; })();
      for (const m of list) {
        if (m.t === 'welcome' && m.token) { clearTimeout(t); ws.close(); resolve(m.token); }
        else if (m.t === 'deny') { clearTimeout(t); ws.close(); reject(new Error(`token: denied ${m.code}`)); }
      }
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

export const GPU_ARGS = {
  gl: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'],
  swiftshader: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
};

export function launch({ gpu = 'gl', hostRules = null, extra = [] } = {}) {
  return puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new', protocolTimeout: 900_000,
    args: ['--no-sandbox', ...(GPU_ARGS[gpu] || GPU_ARGS.gl), '--mute-audio', '--autoplay-policy=no-user-gesture-required',
      ...(hostRules ? [`--host-resolver-rules=${hostRules}`] : []), ...extra],
  });
}

/** Installed before any page script: paint, painting, main.js, welcome, curtain, dock, models. */
function recorder() {
  const M = (window.__bp = { t: {}, errors: [] });
  const mark = (k) => { if (M.t[k] == null) M.t[k] = Math.round(performance.now()); };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') M.t.fcp = Math.round(e.startTime); })
      .observe({ type: 'paint', buffered: true });
  } catch { /* no paint timing */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (/\/welcome-couple(_960)?\.webp/.test(e.name) && e.responseEnd > 0 && M.t.painting == null) M.t.painting = Math.round(e.responseEnd);
      }
    }).observe({ type: 'resource', buffered: true });
  } catch { /* no resource timing */ }
  let zeroSince = null;
  let assetsMod = null;
  let importing = false;
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const poll = () => {
    const hh = window.__hh;
    if (hh) mark('main');
    if (hh && hh.state) mark('welcome');
    if (M.t.welcome != null) {
      const boot = document.getElementById('boot');
      const cs = boot && getComputedStyle(boot);
      if (!boot || boot.hidden || cs.display === 'none' || Number(cs.opacity) === 0 || cs.visibility === 'hidden') mark('curtain');
      // the dock is complete when Market, Barn and Orders are on screen (desktop), or on a phone when the phone bar's
      // menu is on screen and the panels have registered (their buttons live in the menu there)
      const dock = ['market', 'barn', 'orders'].every((n) => visible(document.querySelector(`[data-dock="${n}"]`)))
        || (visible(document.getElementById('m-menu-btn')) && Boolean(hh.ui?.panels?.has?.('market')));
      if (dock) mark('dock');
      let pending = null;
      if (typeof hh.assetsPending === 'function') pending = hh.assetsPending();
      else if (assetsMod) pending = assetsMod.pending();
      else if (!importing) {
        importing = true;
        import('/js/render/assets.js').then((m) => { assetsMod = m; }, (err) => { M.errors.push(`recorder import: ${err.message}`); });
      }
      if (pending === 0) { zeroSince ??= performance.now(); if (performance.now() - zeroSince >= 1500) M.t.models ??= Math.round(zeroSince); }
      else if (pending !== null) zeroSince = null;
    }
    setTimeout(poll, 50);
  };
  setTimeout(poll, 0);
}

/**
 * The dock button the playable check clicks: the first visible of Market, Barn, Orders, then any dock button, then the
 * phone bar's menu (#m-menu-btn: on a phone the panels open from there).
 */
async function dockTarget(page) {
  return page.evaluate(() => {
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    for (const sel of ['[data-dock="market"]', '[data-dock="barn"]', '[data-dock="orders"]', '[data-dock]', '#m-menu-btn']) {
      for (const el of document.querySelectorAll(sel)) {
        const r = vis(el);
        if (!r) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { sel, name: el.dataset.dock || el.id, x, y, hit: Boolean(hit && (hit === el || el.contains(hit))) };
      }
    }
    return null;
  });
}

/**
 * Open a page and measure one boot. `ctx`: a browser context to reuse (warm, post-deploy). Returns the run record.
 */
export async function measureBoot({ browser, ctx = null, url, device = 'desktop', tokens = null, lang = null, cookies = [],
  timeoutS = 300, shotsAt = [], shotPrefix = null, waitModels = true, onCdp = null }) {
  const context = ctx || await browser.createBrowserContext();
  const page = await context.newPage();
  if (device === 'iphone13') {
    await page.emulate(KnownDevices['iPhone 13']);
  } else await page.setViewport({ width: 1366, height: 768 });
  const cdp = await page.createCDPSession();
  if (device === 'iphone13') {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, topMax: 47, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 } })
      .catch(() => { /* older Chrome: no inset override */ });
  }
  if (cookies.length) await page.setCookie(...cookies);
  await page.evaluateOnNewDocument((tok, l) => {
    try { if (tok) localStorage.setItem('hh.tokens', JSON.stringify(tok)); } catch { /* storage blocked */ }
    try { if (l) localStorage.setItem('hh.lang', l); } catch { /* storage blocked */ }
  }, tokens, lang);
  await page.evaluateOnNewDocument(recorder);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 300)); });
  await cdp.send('Network.enable');
  const reqs = new Map();
  let t0 = null;
  let wsOpen = null;
  cdp.on('Network.requestWillBeSent', (e) => {
    t0 ??= e.timestamp;
    reqs.set(e.requestId, { url: e.request.url, start: e.timestamp, type: e.type });
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) Object.assign(r, { status: e.response.status, cache: Boolean(e.response.fromDiskCache || e.response.fromMemoryCache), type: e.type,
      acao: e.response.headers['access-control-allow-origin'] ?? e.response.headers['Access-Control-Allow-Origin'] ?? null });
  });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.end = e.timestamp; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.failed = e.errorText; r.end = e.timestamp; } });
  cdp.on('Network.webSocketHandshakeResponseReceived', (e) => { if (wsOpen == null && t0 != null) wsOpen = Math.round((e.timestamp - t0) * 1000); });
  if (onCdp) onCdp(cdp, page);
  const started = Date.now();
  const shots = [];
  page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutS * 1000 }).catch((err) => errors.push(`goto: ${err.message}`));
  let playable = null;
  let clickTries = 0;
  const dismissed = [];
  const pendingShots = [...shotsAt].sort((a, b) => a - b);
  for (;;) {
    await sleep(100);
    const el = Date.now() - started;
    while (pendingShots.length && el >= pendingShots[0] * 1000) {
      const s = pendingShots.shift();
      if (shotPrefix) {
        const f = `${shotPrefix}-t${String(s).padStart(3, '0')}s.png`;
        await page.screenshot({ path: f }).catch(() => {});
        shots.push(f);
      }
    }
    const m = await page.evaluate(() => (window.__bp ? { ...window.__bp.t } : {})).catch(() => ({}));
    if (playable == null && m.curtain != null && clickTries < 200) {
      // a card the game opens by itself at boot (the welcome-back recap, a first-run sheet) is closed the way a player
      // does (Escape) before the dock is tried; what was closed is recorded
      const opened0 = await page.evaluate(() => window.__hh?.ui?.panels?.top?.() ?? null).catch(() => null);
      if (opened0) {
        dismissed.push(opened0);
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(300);
        continue;
      }
      const tgt = await dockTarget(page).catch(() => null);
      if (tgt && tgt.hit) {
        clickTries++;
        const at = await page.evaluate(() => performance.now()).catch(() => null);
        if (device === 'iphone13') await page.touchscreen.tap(tgt.x, tgt.y).catch(() => {});
        else await page.mouse.click(tgt.x, tgt.y).catch(() => {});
        const opened = await page.waitForFunction(() => Boolean(window.__hh?.ui?.panels?.top?.()), { timeout: 3000, polling: 50 })
          .then(() => true, () => false);
        if (opened) {
          playable = { at: Math.round(at), dock: tgt.name };
          await page.keyboard.press('Escape').catch(() => {});
          await page.evaluate(() => { const p = window.__hh?.ui?.panels; const top = p?.top?.(); if (top) p.close?.(top); }).catch(() => {});
        }
      }
    }
    const done = playable != null && (!waitModels || m.models != null) && (shotsAt.length === 0 || pendingShots.length === 0);
    if (done) break;
    if (el > timeoutS * 1000) { errors.push(`timeout after ${timeoutS} s (playable ${playable ? 'yes' : 'no'}, models ${m.models ?? 'no'})`); break; }
  }
  const t = await page.evaluate(() => ({ ...window.__bp.t, recorderErrors: window.__bp.errors })).catch(() => ({}));
  const meta = await page.evaluate(() => ({ assets: document.querySelector('meta[name="hh-assets"]')?.content ?? null, href: location.href,
    title: document.title })).catch(() => ({}));
  const byHost = {};
  let total = 0;
  for (const r of reqs.values()) {
    if (String(r.url).startsWith('data:')) continue;
    let host = 'other';
    try { host = new URL(r.url).host; } catch { /* odd */ }
    byHost[host] ??= { n: 0, bytes: 0, cached: 0, failed: 0 };
    byHost[host].n++;
    byHost[host].bytes += r.bytes || 0;
    if (r.cache) byHost[host].cached++;
    if (r.failed || (r.status && r.status >= 400)) byHost[host].failed++;
    total += r.bytes || 0;
  }
  const failed = [...reqs.values()].filter((r) => r.failed || (r.status && r.status >= 400)).map((r) => `${r.status ?? r.failed} ${r.url}`).slice(0, 40);
  const milestones = { fcp: t.fcp ?? null, painting: t.painting ?? null, main: t.main ?? null, socketOpen: wsOpen, welcome: t.welcome ?? null,
    curtain: t.curtain ?? null, playable: playable?.at ?? null, dock: t.dock ?? null, models: t.models ?? null };
  return { page, context, cdp, milestones, playableDock: playable?.dock ?? null, dismissed, bytes: { total, byHost }, requests: reqs.size, failed,
    errors: [...errors, ...(t.recorderErrors || [])], meta, shots, reqs };
}

/** A contact sheet of screenshots (rows of `cols`), drawn by the browser itself (no image library). */
export async function contactSheet(browser, files, out, { cols = 4, width = 480, labels = null } = {}) {
  if (!files.length) return null;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const cells = files.map((f, i) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${
    (labels ? labels[i] : path.basename(f)).replace(/</g, '&lt;')}</figcaption></figure>`).join('');
  await page.setViewport({ width: cols * (width + 8), height: 300 });
  await page.setContent(`<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${width}px);gap:8px;padding:4px;
    font:bold 16px sans-serif;color:#ff0}figure{margin:0;position:relative}img{width:${width}px;display:block}
    figcaption{position:absolute;left:0;top:0;background:#000;padding:2px 6px}</style>${cells}`, { waitUntil: 'load' });
  await page.screenshot({ path: out, fullPage: true });
  await ctx.close();
  return out;
}

/** The page as a browser gets it: { gzipBytes, rawBytes, html } (the Host header picks the variant). */
export async function pageSize(port, { host = null, cookie = '' } = {}) {
  const r = await get(port, '/', { raw: true, headers: { 'accept-encoding': 'gzip', ...(host ? { host } : {}), ...(cookie ? { cookie } : {}) } });
  const zlib = await import('node:zlib');
  const html = r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body).toString('utf8') : r.body.toString('utf8');
  return { gzipBytes: r.headers['content-encoding'] === 'gzip' ? r.body.length : zlib.gzipSync(r.body, { level: 6 }).length, rawBytes: Buffer.byteLength(html), html };
}

/** The lab: the Farmbox (single mode) behind its relay, and with `option2` the public host (multi mode) behind its own. */
export async function startLab({ root = REPO, hostRoot = null, farm = 'new', save = null, link = 'funnel', hostLink = 'cloud', option2 = false,
  scratch, farmboxEnv = {}, hostEnv = {} }) {
  fs.mkdirSync(scratch, { recursive: true });
  const lab = { servers: [], proxies: [] };
  const [jk, jr] = parseLink(link);
  const jData = freshData(path.join(scratch, 'farmbox-data'), farm === 'owners' ? save : null);
  if (option2) {
    const [hk, hr] = parseLink(hostLink, 'cloud');
    lab.host = await startServer({ root: hostRoot || root, port: PORTS.host, dataDir: freshData(path.join(scratch, 'host-data')), multi: true, env: hostEnv });
    lab.servers.push(lab.host);
    lab.hostProxy = await startThrottle({ listen: PORTS.hostProxy, target: PORTS.host, kbps: hk, rttMs: hr });
    lab.proxies.push(lab.hostProxy);
  }
  lab.farmbox = await startServer({ root, port: PORTS.farmbox, dataDir: jData, env: {
    ...(option2 ? { HH_ASSET_ORIGIN: `http://cloud.test:${PORTS.hostProxy}`, HH_ASSET_PROBE: `http://127.0.0.1:${PORTS.host}`, HH_ASSET_CHECK_MS: '5000' } : {}),
    ...farmboxEnv } });
  lab.servers.push(lab.farmbox);
  lab.farmboxProxy = await startThrottle({ listen: PORTS.farmboxProxy, target: PORTS.farmbox, kbps: jk, rttMs: jr });
  lab.proxies.push(lab.farmboxProxy);
  lab.tokens = farm === 'owners' ? { p1: await slotToken(PORTS.farmbox, 'p1') } : null;
  lab.url = (q = '') => `http://farmbox.test:${PORTS.farmboxProxy}/${farm === 'owners' ? '?slot=p1' : '?slot=p1&name=Rowan'}${q}`;
  lab.hostRules = `MAP farmbox.test 127.0.0.1, MAP cloud.test 127.0.0.1`;
  lab.stop = async () => {
    for (const p of lab.proxies) await p.stop().catch(() => {});
    for (const s of lab.servers) await s.stop().catch(() => {});
  };
  return lab;
}

/** Wait until the Farmbox's /api/status says `assets.state === want` (option 2), or throw. */
export async function waitAssets(want = 'match', timeoutMs = 20000) {
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < timeoutMs) {
    st = await get(PORTS.farmbox, '/api/status').catch(() => null);
    if (st?.assets?.state === want) return st.assets;
    await sleep(250);
  }
  throw new Error(`assets.state is ${st?.assets?.state ?? 'absent'}, wanted ${want}`);
}

export const SUPPORT_COOKIE = { name: 'hh_sri', value: '1', domain: 'farmbox.test', path: '/' };

function table(rows) {
  const keys = ['fcp', 'painting', 'main', 'socketOpen', 'welcome', 'curtain', 'playable', 'dock', 'models'];
  const s = (ms) => (ms == null ? '-' : (ms / 1000).toFixed(1));
  const lines = [`| run | ${keys.join(' | ')} | total MiB | Farmbox link KB | host KB | page gzip KB | errors |`,
    `|---|${keys.map(() => '---').join('|')}|---|---|---|---|---|`];
  for (const r of rows) {
    lines.push(`| ${r.label} | ${keys.map((k) => s(r.milestones[k])).join(' | ')} | ${(r.bytes.total / 1048576).toFixed(2)} | ${
      r.overFarmbox == null ? '-' : (r.overFarmbox / 1024).toFixed(1)} | ${r.hostBytes == null ? '-' : (r.hostBytes / 1024).toFixed(0)} | ${
      r.pageGzip == null ? '-' : (r.pageGzip / 1024).toFixed(1)} | ${r.errors.length} |`);
  }
  return lines.join('\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const root = path.resolve(a.root || REPO);
  const device = a.device || 'desktop';
  const farm = a.farm || 'new';
  const save = path.resolve(a.save || path.join(REPO, '.scratch/box-save-1013'));
  const runs = Number(a.runs || 3);
  const passes = a.pass === 'all' ? ['cold', 'warm'] : [a.pass || 'cold'];
  const option2 = Boolean(a.option2);
  const label = a.label || `${option2 ? 'opt2' : 'self'}-${device}-${farm}-${a.link || 'funnel'}`;
  const out = path.resolve(a.out || path.join(REPO, 'docs/qa/release/build/infra/boot-perf'));
  const scratch = path.join(REPO, '.scratch/rb-infra/boot-perf', label);
  const shotsAt = a.shots ? String(a.shots).split(',').map(Number).filter(Number.isFinite) : [];
  fs.mkdirSync(out, { recursive: true });
  const record = { label, root, device, farm, link: a.link || 'funnel', option2, runs: [], load: [loadavg()], at: new Date().toISOString() };
  let browser = null;
  const allShots = [];
  try {
    browser = await launch({ gpu: a.gpu || 'gl', hostRules: 'MAP farmbox.test 127.0.0.1, MAP cloud.test 127.0.0.1' });
    for (let i = 1; i <= runs; i++) {
      const lab = await startLab({ root, farm, save, link: a.link || 'funnel', hostLink: a['host-link'] || 'cloud', option2, scratch });
      try {
        if (option2) await waitAssets('match', 30000);
        let ctx = null;
        for (const pass of passes) {
          lab.farmboxProxy.reset();
          lab.hostProxy?.reset();
          const cookies = option2 && !a.self ? [SUPPORT_COOKIE] : [];
          const r = await measureBoot({ browser, ctx, url: lab.url(a.self ? '&assets=self' : ''), device, tokens: lab.tokens, lang: a.lang || null,
            cookies: pass === 'cold' ? cookies : [], timeoutS: Number(a.timeout || 300), shotsAt: pass === 'cold' && i === 1 ? shotsAt : [],
            shotPrefix: path.join(out, `${label}-r${i}-${pass}`) });
          ctx = r.context;
          allShots.push(...r.shots);
          const ps = await pageSize(PORTS.farmbox, { host: `farmbox.test:${PORTS.farmboxProxy}`, cookie: option2 && !a.self ? 'hh_sri=1' : '' }).catch(() => null);
          const row = { label: `${label} r${i} ${pass}`, pass, milestones: r.milestones, playableDock: r.playableDock, bytes: r.bytes, requests: r.requests,
            overFarmbox: lab.farmboxProxy.counters.down, hostBytes: lab.hostProxy ? lab.hostProxy.counters.down : null,
            pageGzip: ps?.gzipBytes ?? null, assetsMeta: r.meta.assets, errors: r.errors, failed: r.failed, load: loadavg() };
          record.runs.push(row);
          console.error(JSON.stringify({ run: row.label, ...row.milestones, MiB: +(r.bytes.total / 1048576).toFixed(2),
            farmboxKB: +(row.overFarmbox / 1024).toFixed(1), errors: r.errors.length, load: row.load }));
          await r.page.close().catch(() => {});
        }
        await ctx?.close().catch(() => {});
      } finally {
        await lab.stop();
      }
    }
    if (allShots.length) {
      record.sheet = await contactSheet(browser, allShots, path.join(out, `${label}-sheet.png`), { labels: allShots.map((f) => path.basename(f, '.png').replace(`${label}-`, '')) });
    }
  } finally {
    await browser?.close().catch(() => {});
  }
  record.load.push(loadavg());
  const med = {};
  for (const pass of passes) {
    const rows = record.runs.filter((r) => r.pass === pass);
    med[pass] = { milestones: {}, totalMiB: +(median(rows.map((r) => r.bytes.total)) / 1048576).toFixed(2),
      overFarmboxKB: +(median(rows.map((r) => r.overFarmbox)) / 1024).toFixed(1),
      hostKB: rows[0]?.hostBytes == null ? null : +(median(rows.map((r) => r.hostBytes)) / 1024).toFixed(0),
      pageGzipKB: rows[0]?.pageGzip == null ? null : +(median(rows.map((r) => r.pageGzip)) / 1024).toFixed(1),
      errors: rows.reduce((n, r) => n + r.errors.length, 0) };
    for (const k of Object.keys(rows[0]?.milestones || {})) med[pass].milestones[k] = median(rows.map((r) => r.milestones[k]));
  }
  record.median = med;
  fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(record, null, 1));
  const md = `# boot-perf ${label}\n\nroot ${path.relative(REPO, root) || '.'}, ${record.at}, load ${record.load.join(' -> ')}\n\n${table(record.runs)}\n\n` +
    `Medians: ${JSON.stringify(med)}\n`;
  fs.writeFileSync(path.join(out, `${label}.md`), md);
  console.log(JSON.stringify({ label, median: med, load: record.load, out: path.relative(REPO, path.join(out, `${label}.json`)) }));
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // exit explicitly: a keep-alive socket or a timer of a stopped lab must not keep a finished measurement alive
  main().then(() => process.exit(process.exitCode ?? 0), (err) => { console.error(err); process.exit(1); });
}
