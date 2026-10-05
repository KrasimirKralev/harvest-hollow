// Phone + desktop co-op E2E (mobile wave 2026-10-03, input lane). Starts its own HH_DEV server on --port (default 3604)
// with a temp data dir holding a level-5 fixture farm (as tools/e2e-coop.mjs), opens ONE headless Chrome with two
// contexts: D, a desktop (1366 x 768, mouse, localhost) and P, a phone (Puppeteer device emulation: iPhone 13 by
// default, touch on, isMobile, over the LAN address when there is one: not a secure context, like the partner's real
// phone). P is driven with REAL touch input (CDP Input.dispatchTouchEvent: one and two fingers), D with the real mouse.
// Steps:
//    1. both join; P's page is a touch page (coarse pointer, touch points); its wake lock is skipped on http and its
//       fullscreen toggle is there; the web app manifest is served
//    2. the controller's camera projection agrees with view.pick on P (two-finger gestures depend on it)
//    3. P drag-paints Wheat across four plots with a finger; D sees all four
//    4. time warp; P drag-harvests them with the Sickle; both barns rise
//    5. D (mouse) plants a plot while P watches: the desktop path still works side by side
//    6. P: one finger on grass pans (and glides), a pinch zooms, a twist turns the view a quarter, a double tap focuses;
//       the page itself never zooms (visualViewport.scale stays 1)
//    7. P: a long press on a growing plot shows its tooltip (soft: the ui decides how long a tooltip lives) and plants
//       nothing; a tap plants, and the growing crop's long-press card pulls it up ("Pull it up": no Shift on a phone);
//       a tap on open ground walks the farmer there
//    8. P opens the Market with a tap on the dock, swipes the card list (panels still scroll), buys a decor piece with a
//       tap: build mode starts with the ghost in view, a tap moves it to a free spot, ✓ places it; D sees it
//    9. P picks the piece up again with the Hammer (tap), carries the ghost with a finger, ✓ puts it down; D sees the move
//   9b. the Barn by touch (owner 2026-10-04): a Hammer tap picks it up, a tap moves the ghost, ✓ puts it down; D sees it
//       and moves it back
//   10. landscape: the phone turns; a tap still lands on the right tile
//   11. CPU x4 (a mid-range phone): input -> first frame on P (SwiftShader: functional, not a measurement)
// Prints one JSON line { ok, steps, skipped, latencies, errors, files } and exits non-zero on any failure.
//
//   node tools/e2e-mobile.mjs --port 3604 [--device "iPhone 13" | "Pixel 7" | "Galaxy S8"] [--screens dir] [--slow N]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { createFarm, validateState } from '../shared/rules/state.js';
import { runAction, makeCtx } from '../shared/rules/index.js';
import { cropOf, xpForLevel } from '../shared/content/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 3604);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const DEVICE = String(args.device || 'iPhone 13');
// phones Puppeteer does not list: the brief's Pixel 7 and the largest iPhone (430 x 932)
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DEVICES = {
  ...KnownDevices,
  'Pixel 7': { userAgent: ANDROID_UA, viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: false } },
  'iPhone 15 Pro Max': { userAgent: IOS_UA, viewport: { width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false } },
};
if (!DEVICES[DEVICE]) throw new Error(`unknown device "${DEVICE}"`);
const screens = path.resolve(args.screens || path.join(ROOT, 'docs', 'qa', 'mobile', 'input', 'e2e'));
fs.mkdirSync(screens, { recursive: true });
const SLOW = Math.max(1, Number(args.slow || process.env.HH_E2E_SLOW || 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-e2e-mobile-'));
const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
const TZ = 'Europe/Sofia';
const WHEAT = cropOf('wheat');
const TOUCH_DOUBLE_MS = 400;                 // a little over game/touch.js TOUCH.doubleMs: two taps this far apart are two taps

const steps = [];
const skipped = [];
const latencies = {};
const errors = [];
const files = [];
let server = null;
let serverLog = '';

function check(name, cond, detail = '') {
  steps.push({ name, ok: Boolean(cond), ...(detail ? { detail } : {}) });
  if (!cond) throw new Error(`step failed: ${name}${detail ? ` (${detail})` : ''}`);
}
const skip = (name, why) => skipped.push({ name, why });
const waitFor = (page, fn, arg, timeout = 10_000) => page.waitForFunction(fn, { timeout: timeout * SLOW, polling: 30 }, arg);
const st = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__hh.state)));
const inv = (s, item) => (s.farm.inventory[item] ?? 0) + (s.farm.overflow?.[item] ?? 0);

// ---- fixture + server ---------------------------------------------------------------------------------------------
async function writeFixture(dir) {
  const now = Date.now();
  const s = createFarm(4242, now, TZ);
  s.farm.xp = xpForLevel(5);
  s.farm.wallet.coins = 8000;
  for (const [item, n] of [['wheat', 40], ['corn', 12], ['carrot', 12]]) s.farm.inventory[item] = (s.farm.inventory[item] ?? 0) + n;
  const { dueSystemActions } = await import('../shared/rules/system.js');
  let v = s.meta.version;
  for (let pass = 0; pass < 8; pass++) {
    const due = dueSystemActions(s, now);
    if (!due.length) break;
    for (const a of due) {
      const r = runAction(s, a, makeCtx(s, { now, pid: 'sys', cid: 'sys', seq: v + 1, grace: 250 }));
      if (r.ok) { v += 1; s.meta.version = v; }
    }
  }
  const problems = validateState(s, { now });
  if (problems.length) throw new Error(`fixture farm is invalid: ${problems.slice(0, 5).join('; ')}`);
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify({ schema: s.schema, savedAt: now, version: s.meta.version, state: s, server: {} }));
}
async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_TZ: TZ }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 100 && !serverLog.includes('running at') && server.exitCode === null; i++) await sleep(100);
  if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-1200)}`);
}
async function stopServer() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  s.kill('SIGTERM');
  await new Promise((r) => s.once('exit', r));
}

// ---- page helpers ----------------------------------------------------------------------------------------------------
async function syncClock(page, target) {
  await page.evaluate(async (t) => {
    for (let i = 0; i < 80 && window.__hh.serverNow() < t; i++) { window.__hh.net.ping(); await new Promise((r) => setTimeout(r, 50)); }
  }, target);
}
async function warp(A, B, ms) {
  const target = await A.evaluate((x) => window.__hh.dev.warp(x), ms);
  await syncClock(B, target - 100);
}
/** Ease the camera to a tile and wait until it is there (or stops: the pan bounds clamp it). Two SwiftShader pages share
 * one CPU, so frames (and the camera's easing) can be slow: "no change in 150 ms" is not "settled". */
async function look(page, x, z) {
  await page.evaluate(([a, b]) => window.__hh.view.focus(a, b), [x, z]);
  let last = null;
  let still = 0;
  for (let i = 0; i < 80 * SLOW; i++) {
    await sleep(150);
    const c = await page.evaluate(() => window.__hh.view.camera.get());
    if (Math.abs(c.tx / 2 - x) < 0.03 && Math.abs(c.tz / 2 - z) < 0.03) break;
    still = last && Math.abs(c.tx - last.tx) < 0.005 && Math.abs(c.tz - last.tz) < 0.005 ? still + 1 : 0;
    if (still >= 8) break;
    last = c;
  }
  await sleep(200);
}
/**
 * CSS px of a point over the canvas whose pick IS tile (tx, tz) and that no HUD element covers (on a phone the HUD
 * takes a good part of the screen); null when none is on screen.
 */
const tileAt = (page, tx, tz) => page.evaluate(([a, b]) => {
  const c = document.getElementById('world').getBoundingClientRect();
  const p0 = window.__hh.view.toScreen(a + 0.5, b + 0.5, 0.1);
  for (let r = 0; r < 40; r += 2) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      const x = p0.x + dx; const y = p0.y + dy;
      if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue;
      // a finger needs room: the point and a ring round it are all canvas (no HUD button at the edge of the fingertip)
      if (![[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]].every(([a, b]) => document.elementFromPoint(x + a, y + b)?.id === 'world')) continue;
      const p = window.__hh.view.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 });
      if (p && p.x === a && p.z === b) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
}, [tx, tz]);
/** The middle of an element, when it is on screen and on top there (once it stopped moving: sheets slide in). */
async function spotOf(page, sel) {
  let last = null;
  for (let i = 0; i < 25; i++) {
    const at = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x: Math.round(x), y: Math.round(y), onTop: Boolean(top && (top === el || el.contains(top))) };
    }, sel);
    if (!at) return null;
    if (last && Math.abs(at.x - last.x) < 1 && Math.abs(at.y - last.y) < 1) return at.onTop ? { x: at.x, y: at.y } : null;
    last = at;
    await sleep(150);
  }
  return null;
}
async function shot(page, name) {
  const f = path.join(screens, `${name}.png`);
  await page.screenshot({ path: f });
  files.push(f);
  return f;
}

/**
 * A trace of what the page did with the input since the last call (installed on the first call): where each pointer
 * event landed, and the controller's events. Returns the trace so far as JSON and starts a new one.
 */
async function trace(page) {
  return page.evaluate(() => {
    if (!window.__trace) {
      window.__trace = [];
      const t0 = () => Math.round(performance.now());
      for (const t of ['pointerdown', 'pointerup', 'pointercancel']) {
        window.addEventListener(t, (e) => window.__trace.push([t, e.pointerType, e.pointerId, e.target.id || String(e.target.className).slice(0, 30),
          Math.round(e.clientX), Math.round(e.clientY), Math.round(e.timeStamp), t0()]), true);
      }
      for (const n of ['hover', 'walk', 'invalid', 'command', 'stroke', 'build']) {
        window.__hh.controller.on(n, (p) => window.__trace.push([n, p ? (p.id ?? p.cmd ?? p.verb ?? p.kind ?? `${p.x},${p.z}`) : null, t0()]));
      }
    }
    const out = JSON.stringify(window.__trace);
    window.__trace.length = 0;
    return out;
  });
}

/** Real touches through CDP (one or two fingers). */
async function fingers(page) {
  const cdp = await page.createCDPSession();
  const send = (type, pts, timestamp) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 7, radiusY: 7, force: 1 })),
    ...(timestamp ? { timestamp } : {}),
  });
  const line = (a, b, n) => Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n }));
  return {
    cdp,
    /** A tap with a phone's own timing (the finger down for holdMs), however late the busy page handles it. */
    async tap(p, holdMs = 50) {
      const t = Date.now() / 1000;
      await send('touchStart', [p], t);
      await sleep(holdMs);
      await send('touchEnd', [], t + holdMs / 1000);
    },
    /** Two quick taps with a phone's own timing (down 40 ms, 110 ms between the taps), whatever the page's lag. */
    async doubleTap(p) {
      const t = Date.now() / 1000;
      await send('touchStart', [p], t);
      await send('touchEnd', [], t + 0.04);
      await send('touchStart', [p], t + 0.15);
      await send('touchEnd', [], t + 0.19);
    },
    /**
     * One finger through the points (each segment in `n` moves, `ms` apart). flick: the events carry a phone's own
     * timing (a move every 16 ms, the lift 16 ms after the last one): SwiftShader handles each event late, and a
     * glide is measured on the events' time, as on a real phone.
     */
    async drag(points, { n = 5, ms = 16, endPause = 0, flick = false, rest = 0 } = {}) {
      let t = flick ? Date.now() / 1000 : 0;
      const at = () => (flick ? (t += 0.016) : undefined);
      await send('touchStart', [points[0]], at());
      for (let i = 1; i < points.length; i++) {
        for (const p of line(points[i - 1], points[i], n)) { await send('touchMove', [p], at()); if (!flick) await sleep(ms); }
      }
      // the finger rests where it is for `rest` seconds of its own time before it lifts (no glide)
      if (rest && flick) { t += rest; await send('touchMove', [points.at(-1)], t); }
      if (endPause) await sleep(endPause);
      await send('touchEnd', [], at());
    },
    /** Two fingers from (a0, b0) to (a1, b1) in n steps. */
    async two(a0, b0, a1, b1, { n = 10, ms = 16, at = null } = {}) {
      await send('touchStart', [{ ...a0, id: 0 }, { ...b0, id: 1 }]);
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const pts = at ? at(k) : [{ x: a0.x + (a1.x - a0.x) * k, y: a0.y + (a1.y - a0.y) * k }, { x: b0.x + (b1.x - b0.x) * k, y: b0.y + (b1.y - b0.y) * k }];
        await send('touchMove', [{ ...pts[0], id: 0 }, { ...pts[1], id: 1 }]);
        await sleep(ms);
      }
      await send('touchEnd', []);
    },
    async hold(p, ms) {
      const t = Date.now() / 1000;
      await send('touchStart', [p], t);
      await sleep(ms);
      return () => send('touchEnd', [], t + ms / 1000);
    },
  };
}

// ---- the run -------------------------------------------------------------------------------------------------------
let browser;
try {
  await writeFixture(dataDir);
  await startServer();
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const open = async (tag, host, slot, name, setup) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await setup(page);
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    await page.goto(`http://${host}:${port}/?slot=${slot}&name=${name}&quality=low`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => window.__hh && window.__hh.pid && window.__hh.state && window.__hh.controller, null, 60_000);
    // the guide's cards ("I know farming"): this run is about input, not the tutorial
    await page.evaluate(() => { window.__hh.act('tutSkip', { all: 'yes' }); window.__hh.ui.panels?.closeAll?.(); });
    return page;
  };

  // 1. both join -------------------------------------------------------------------------------------------------------
  const D = await open('D', 'localhost', 'p1', 'Rowan', (p) => p.setViewport({ width: 1366, height: 768 }));
  const P = await open('P', lanIp || 'localhost', 'p2', 'Desi', (p) => p.emulate(DEVICES[DEVICE]));
  const F = await fingers(P);
  await Promise.all([D, P].map((p) => waitFor(p, () => window.__hh.view.stats().fps > 0, null, 30_000).catch(() => {})));
  await sleep(1200);
  const env = await P.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches, touch: navigator.maxTouchPoints, secure: isSecureContext,
    wake: window.__hh.device?.wakeLock?.available ?? null, fs: window.__hh.device?.fullscreen?.available ?? null,
    touchFirst: window.__hh.device?.touchFirst ?? null, w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
  }));
  check(`P is a touch page (${DEVICE})`, env.coarse && env.touch > 0 && env.touchFirst === true, JSON.stringify(env));
  check('P on the LAN address skips the wake lock (not a secure context)', !lanIp || (env.secure === false && env.wake === false),
    lanIp ? `secure ${env.secure}, wake lock ${env.wake}` : 'no LAN interface: localhost is a secure context');
  if (env.fs === true) check('P has the fullscreen toggle (Chrome)', true);
  else skip('fullscreen toggle', `document.fullscreenEnabled is false in this browser (${DEVICE} emulation)`);
  const man = await P.evaluate(async () => {
    const r = await fetch('/manifest.webmanifest');
    return { status: r.status, type: r.headers.get('content-type'), json: await r.json().catch(() => null),
      linked: Boolean(document.querySelector('link[rel="manifest"]')) };
  });
  check('the web app manifest is served', man.status === 200 && /manifest\+json|json/.test(man.type || '') && man.json?.display === 'standalone',
    `${man.status} ${man.type}`);
  if (!man.linked) skip('index.html links the manifest', 'layout lane: <link rel="manifest"> not in index.html yet (docs/agent-notes/mobile-input.md)');
  await shot(P, 'p-01-joined');

  // 2. the projection two-finger gestures use agrees with view.pick ---------------------------------------------------
  const proj = await P.evaluate(async () => {
    const { groundAt } = await import('/js/game/touch.js');
    const h = window.__hh;
    const cam = h.view.camera.get();
    const r = document.getElementById('world').getBoundingClientRect();
    let worst = 0;
    for (const x of [-0.8, -0.3, 0, 0.4, 0.9]) {
      for (const y of [-0.9, -0.4, 0, 0.5, 0.9]) {
        const p = h.view.pick({ x, y });
        const g = groundAt(cam, { x, y }, r.width / r.height, Number.isFinite(cam.fov) ? cam.fov : 30);
        if (!p || !g) return { worst: Infinity };
        worst = Math.max(worst, Math.abs(g.x / 2 - p.px), Math.abs(g.z / 2 - p.pz));
      }
    }
    return { worst };
  });
  check('the touch ground projection matches view.pick (tiles)', proj.worst < 0.05, String(proj.worst));

  // 3. P paints Wheat across four plots with one finger --------------------------------------------------------------
  const s0 = await st(P);
  const plots = Object.keys(s0.farm.objects).filter((id) => s0.farm.objects[id].def === 'plot' && !s0.farm.objects[id].crop)
    .sort((a, b) => (s0.farm.objects[a].z - s0.farm.objects[b].z) || (s0.farm.objects[a].x - s0.farm.objects[b].x));
  const O = (id) => s0.farm.objects[id];
  const row = plots.filter((id) => O(id).z === O(plots[0]).z).slice(0, 4);
  check('the fixture has a row of four empty plots', row.length === 4, String(row.length));
  await look(P, O(row[1]).x + 1, O(row[1]).z + 0.5);
  // the Seed Bag from the tool tray with a tap (the layout may move the tray: fall back to the controller, noted)
  const seedBtn = await spotOf(P, '[data-tool="seed_bag"]');
  if (seedBtn) {
    await F.tap(seedBtn);
    await sleep(300);
  } else skip('tap the Seed Bag in the tool tray', 'the button is not on screen in this layout; setTool used');
  await P.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  await P.evaluate(() => window.__hh.ui.panels?.closeAll?.());
  await sleep(200);
  const pts = [];
  for (const id of row) pts.push(await tileAt(P, O(id).x, O(id).z));
  check('the row is on the phone screen, clear of the HUD', pts.every(Boolean), JSON.stringify(pts));
  const coins0 = s0.farm.wallet.coins;
  await F.drag(pts, { n: 4 });
  const predicted = await P.evaluate((ids) => ids.filter((id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat').length, row);
  check('one finger planted the whole row on P (predicted)', predicted === 4, `${predicted}/4`);
  const tPlant = Date.now();
  await waitFor(D, (ids) => ids.every((id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat'), row);
  latencies.fingerStrokeToDesktopMs = Date.now() - tPlant;
  await Promise.all([D, P].map((p) => waitFor(p, () => window.__hh.pending === 0)));
  const [a3, b3] = [await st(D), await st(P)];
  check('coins dropped by four seeds on both screens', a3.farm.wallet.coins === coins0 - 4 * WHEAT.seed && b3.farm.wallet.coins === coins0 - 4 * WHEAT.seed,
    `${a3.farm.wallet.coins}/${b3.farm.wallet.coins} from ${coins0}`);
  await shot(P, 'p-02-planted');

  // 4. warp; P harvests the row with the Sickle, one finger ------------------------------------------------------------
  const readyAt = Math.max(...row.map((id) => b3.farm.objects[id].crop.readyAt));
  await warp(D, P, readyAt - (await D.evaluate(() => window.__hh.serverNow())) + 400);
  await P.evaluate(() => window.__hh.controller.setTool('sickle'));
  await sleep(300);
  const hp = [];
  for (const id of [...row].reverse()) hp.push(await tileAt(P, O(id).x, O(id).z));
  const wheat0 = inv(b3, 'wheat');
  // haptics: count the vibration pulses the harvest asks for (Android has navigator.vibrate; iOS has none)
  await P.evaluate(() => {
    window.__vib = [];
    try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vib.push(p); return true; } }); } catch { /* read-only */ }
  });
  await F.drag(hp, { n: 4 });
  await waitFor(D, (ids) => ids.every((id) => window.__hh.state.farm.objects[id].crop === null), row);
  await Promise.all([D, P].map((p) => waitFor(p, () => window.__hh.pending === 0)));
  const h4 = await st(D);
  check('P harvested the row with one finger; D sees it in the barn', inv(h4, 'wheat') >= wheat0 + 4 * WHEAT.yield, `${inv(h4, 'wheat')} vs ${wheat0}`);
  const vib = await P.evaluate(() => window.__vib);
  check('the harvest buzzed the phone (short pulses, throttled)', vib.length >= 1 && vib.every((p) => typeof p === 'number' && p <= 20), JSON.stringify(vib));
  await shot(P, 'p-03-harvested');

  // 5. D plants a plot with the mouse while P watches -----------------------------------------------------------------
  const dPlot = plots[4];
  await look(D, O(dPlot).x + 0.5, O(dPlot).z + 0.5);
  await D.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  const dp = await tileAt(D, O(dPlot).x, O(dPlot).z);
  check('D sees the plot', Boolean(dp));
  await D.mouse.move(dp.x, dp.y);
  await D.mouse.down();
  // the press itself plants (GDD §7.1: a mouse press on a target acts at once); the button is still down here
  const dPred = await waitFor(D, (id) => window.__hh.state.farm.objects[id].crop?.def ?? false, dPlot, 3000)
    .then((h) => h.jsonValue(), () => D.evaluate((id) => ({ crop: window.__hh.state.farm.objects[id].crop, tool: window.__hh.controller.tool,
      hover: window.__hh.controller.hover }), dPlot));
  await D.mouse.up();
  check('the mouse still plants on press on the desktop', dPred === 'wheat', JSON.stringify(dPred));
  await waitFor(P, (id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat', dPlot);
  check("P sees D's planting", true);
  // build mode with a mouse: the ghost follows the cursor; the touch bar never shows on the desktop
  await D.evaluate(() => window.__hh.controller.place('picket_fence'));
  await D.mouse.move(dp.x + 40, dp.y + 30);
  await sleep(300);
  const deskBar = await D.evaluate(() => { const b = document.getElementById('touch-build'); return Boolean(b && !b.hidden); });
  await D.evaluate(() => window.__hh.controller.cancel());
  check('the desktop never shows the touch build bar', !deskBar);

  // 6. camera gestures on P -----------------------------------------------------------------------------------------------
  await P.evaluate(() => window.__hh.controller.setTool('hand'));
  await look(P, 28, 34);
  const cam = () => P.evaluate(() => window.__hh.view.camera.get());
  // a canvas point over open grass near the middle of the screen (the field, fences and the HUD are not grass)
  const grass = (page, { below = 0, away = null } = {}) => page.evaluate(([lo, far]) => {
    const c = document.getElementById('world').getBoundingClientRect();
    const pts = [];
    for (let dy = -220; dy <= 220; dy += 12) for (let dx = -150; dx <= 150; dx += 12) pts.push([dx, dy]);
    pts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [dx, dy] of pts) {
      const x = innerWidth / 2 + dx; const y = innerHeight / 2 + dy + lo;
      // a finger needs room: the point and a ring round it are all canvas (no HUD button at the edge of the fingertip)
      if (![[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]].every(([a, b]) => document.elementFromPoint(x + a, y + b)?.id === 'world')) continue;
      const p = window.__hh.view.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 });
      if (far && Math.hypot(p?.px - far.x, p?.pz - far.z) < 3) continue;
      if (p && p.kind === 'tile' && !p.place && !p.note && p.land === 'owned') return { x, y, px: p.px, pz: p.pz };
    }
    return null;
  }, [below, away]);
  const free = await grass(P, { below: 60 });
  check('open grass in the middle of the phone screen', Boolean(free));
  // grab the ground: a slow drag that rests before it lets go (no glide) leaves the grabbed ground point under the finger
  const groundUnder = (q) => P.evaluate((pt) => {
    const c = document.getElementById('world').getBoundingClientRect();
    const p = window.__hh.view.pick({ x: ((pt.x - c.left) / c.width) * 2 - 1, y: -((pt.y - c.top) / c.height) * 2 + 1 });
    return p ? { x: p.px, z: p.pz } : null;
  }, q);
  const grabbed = await groundUnder(free);
  const endPt = { x: free.x, y: free.y - 140 };
  const c0 = await cam();
  await F.drag([free, endPt], { n: 10, flick: true, rest: 0.25 });
  await sleep(400);
  const c1 = await cam();
  const after = await groundUnder(endPt);
  const moved = Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz);
  const slip = Math.hypot(after.x - grabbed.x, after.z - grabbed.z);
  check('one finger on grass pans the view, the grabbed ground stays under the finger', moved > 2 && slip < 0.35,
    `moved ${moved.toFixed(2)} m, slip ${slip.toFixed(2)} tiles`);
  // a flick: the view glides on after the finger lets go (the camera's own glide, at the controller's velocity)
  const glides0 = await P.evaluate(() => window.__hh.view.stats().glides ?? 0);
  await F.drag([free, endPt], { n: 10, flick: true });
  await sleep(1500);
  const glides1 = await P.evaluate(() => window.__hh.view.stats().glides ?? 0);
  const c2 = await cam();
  check('a flick glides on after the finger lets go', glides1 > glides0, `glides ${glides0} -> ${glides1}, camera ${Math.hypot(c2.tx - c1.tx, c2.tz - c1.tz).toFixed(1)} m`);
  await shot(P, 'p-04a-after-flick');
  await look(P, 28, 34);
  const cx = Math.round((await P.evaluate(() => innerWidth)) / 2);
  const cy = free.y - 40;
  const d0 = (await cam()).dist;
  await F.two({ x: cx, y: cy - 50 }, { x: cx, y: cy + 50 }, { x: cx, y: cy - 130 }, { x: cx, y: cy + 130 });
  await sleep(800);
  const d1 = (await cam()).dist;
  check('spreading two fingers zooms in', d1 < d0 * 0.7, `${d0.toFixed(1)} -> ${d1.toFixed(1)}`);
  await F.two({ x: cx, y: cy - 130 }, { x: cx, y: cy + 130 }, { x: cx, y: cy - 60 }, { x: cx, y: cy + 60 });
  await sleep(800);
  const d2 = (await cam()).dist;
  check('pinching zooms out', d2 > d1 * 1.5, `${d1.toFixed(1)} -> ${d2.toFixed(1)}`);
  const k0 = (await cam()).k;
  const R = 90;
  await F.two({ x: cx - R, y: cy }, { x: cx + R, y: cy }, null, null, { n: 12, at: (k) => {
    const a = k * (Math.PI / 3);
    return [{ x: cx - R * Math.cos(a), y: cy - R * Math.sin(a) }, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }];
  } });
  await sleep(900);
  const k1 = (await cam()).k;
  check('a clockwise two-finger twist turns the view one quarter', k1 === k0 + 1, `${k0} -> ${k1}`);
  const scale = await P.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1));
  check('the page itself never zoomed', Math.abs(scale - 1) < 1e-6, String(scale));
  await shot(P, 'p-04-gestures');
  // a double tap focuses the camera there (on open grass: the first tap walks the farmer, the second focuses)
  const g6 = await grass(P);
  if (g6) {
    const before = await cam();
    await trace(P);
    await F.doubleTap(g6);
    await sleep(1200);
    const cf = await cam();
    // where view.focus on that ground point takes the camera (the pan bounds may hold it short of the point)
    await look(P, g6.px, g6.pz);
    const want = await cam();
    const off = Math.hypot(cf.tx - want.tx, cf.tz - want.tz) / 2;
    const went = Math.hypot(before.tx - want.tx, before.tz - want.tz) / 2;
    check('a double tap focuses the camera there', off < 0.6 && (went > 0.5 ? Math.hypot(cf.tx - before.tx, cf.tz - before.tz) > 0.5 : true),
      `${off.toFixed(2)} tiles from the focus; the focus was ${went.toFixed(2)} tiles away${off < 0.6 ? '' : ` ${await trace(P)}`}`);
  } else skip('double tap', 'no open grass clear of the HUD');

  // 7. long press = tooltip, nothing planted; a tap on grass walks ------------------------------------------------------
  await P.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  const emptyPlot = plots[6];
  await look(P, O(emptyPlot).x + 0.5, O(emptyPlot).z + 0.5);
  const ep = await tileAt(P, O(emptyPlot).x, O(emptyPlot).z);
  if (ep) {
    const lift = await F.hold(ep, 700);
    const tip = await P.evaluate(() => { const t = document.getElementById('tip'); return t && !t.hidden ? t.textContent : null; });
    await shot(P, 'p-05-longpress');
    await lift();
    await sleep(150);
    const planted = await P.evaluate((id) => window.__hh.state.farm.objects[id].crop, emptyPlot);
    check('a long press plants nothing', planted === null);
    if (tip) check('a long press shows the tooltip', /plot|wheat|empty/i.test(tip), tip.slice(0, 80));
    else skip('long-press tooltip text', 'the ui did not show #tip (layout lane: tooltip placement for touch)');
    // 7b. a phone has no Shift: a tap plants, then the long-press card of the growing crop offers "Pull it up"
    await sleep(TOUCH_DOUBLE_MS);
    await F.tap(ep);
    await waitFor(P, (id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat', emptyPlot);
    await Promise.all([D, P].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    await P.evaluate(() => window.__hh.controller.setTool('hand'));
    // the first harvest's "Quest complete!" card may pop up over the farm: put it away first
    await sleep(600);
    await P.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); for (const x of document.querySelectorAll('#banners .x')) x.click(); });
    await waitFor(P, (pt) => document.elementFromPoint(pt.x, pt.y)?.id === 'world', ep, 4000).catch(() => null);
    const lift7 = await F.hold(ep, 700);
    await lift7();
    // the card's button, once it stopped moving (two reads 200 ms apart agree)
    const pullSpot = () => P.evaluate(() => {
      const b = document.querySelector('#tip:not([hidden]) .tip-act');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2); const y = Math.round(r.top + r.height / 2);
      return document.elementFromPoint(x, y) === b ? { x, y } : null;
    });
    let pullAt = null;
    for (let i = 0, last = null; i < 20 && !pullAt; i++) {
      const at = await pullSpot();
      if (at && last && at.x === last.x && at.y === last.y) pullAt = at;
      last = at;
      await sleep(200);
    }
    await shot(P, 'p-05b-pull-card');
    check('the long-press card of a growing crop offers "Pull it up" (tappable)', Boolean(pullAt), pullAt ? '' : JSON.stringify(await P.evaluate((pt, id) => ({
      at: document.elementFromPoint(pt.x, pt.y)?.className ?? null, can: window.__hh.controller.canUproot(id), input: window.__hh.controller.input,
      tip: document.getElementById('tip').hidden ? null : document.getElementById('tip').textContent }), ep, emptyPlot)));
    await P.evaluate(() => { window.__pull = []; document.querySelector('#tip .tip-act')?.addEventListener('click', () => window.__pull.push('click'), true);
      for (const t of ['pointerdown', 'pointerup', 'click']) window.addEventListener(t, (e) => window.__pull.push(`${t}:${e.target?.className ?? e.target?.id}`), true); });
    await F.tap(pullAt);
    const pulled = await waitFor(D, (id) => window.__hh.state.farm.objects[id].crop === null, emptyPlot).then(() => true, () => false);
    check('a tap on "Pull it up" pulls the crop up; D sees the empty plot', pulled, pulled ? '' : JSON.stringify(await P.evaluate((id) => ({
      events: window.__pull, crop: window.__hh.state.farm.objects[id].crop, can: window.__hh.controller.canUproot(id),
      tip: document.getElementById('tip').hidden ? null : document.getElementById('tip').innerHTML.slice(0, 300) }), emptyPlot)));
    check('the card goes away after the pull', await P.evaluate(() => document.getElementById('tip').hidden));
    // 7c. the Hand tapped on the empty plot opens the seed picker under the finger; the browser's click after the
    // touch must not land on a seed card and plant (a ghost click)
    await sleep(TOUCH_DOUBLE_MS);
    await F.tap(ep);
    const picker = await waitFor(P, () => { const p = document.querySelector('.seed-pop'); return Boolean(p && !p.hidden); }, null, 4000).then(() => true, () => false);
    await sleep(600);
    const ghost = await P.evaluate((id) => ({ crop: window.__hh.state.farm.objects[id].crop?.def ?? null, tool: window.__hh.controller.tool?.id ?? window.__hh.controller.tool }), emptyPlot);
    await shot(P, 'p-05c-seed-picker');
    check('a Hand tap on an empty plot opens the seed picker', picker);
    check('the tap that opened the picker chose nothing (no ghost click on a seed card)', ghost.crop === null && ghost.tool === 'hand', JSON.stringify(ghost));
    await P.keyboard.press('Escape');
  } else skip('long press', 'the plot is under the HUD in this layout');
  await P.evaluate(() => window.__hh.controller.setTool('hand'));
  const me7 = await P.evaluate(() => ({ x: window.__hh.avatar.pose.x, z: window.__hh.avatar.pose.z }));
  const g7 = await grass(P, { away: me7 });
  if (g7) {
    await P.evaluate(() => { window.__walks = []; window.__hh.controller.on('walk', (w) => window.__walks.push(w)); });
    await sleep(TOUCH_DOUBLE_MS);
    await trace(P);
    await F.tap(g7);
    await sleep(300);
    const w7 = await P.evaluate(() => window.__walks.at(-1) ?? null);
    const ok7 = w7 && Math.hypot(w7.x - g7.px, w7.z - g7.pz) < 0.6;
    check('a tap on open ground walks the farmer there', ok7, `${JSON.stringify(w7)}${ok7 ? '' : ` ${await trace(P)}`}`);
  } else skip('tap to walk', 'no open owned ground clear of the HUD');

  // 8. the Market by tap, a swipe in its list, buy decor, place it with the ghost by touch -------------------------------
  await P.evaluate(() => window.__hh.ui.panels?.closeAll?.());
  await sleep(300);
  let marketBtn = await spotOf(P, '[data-dock="market"]');
  // the phone layout keeps the dock in the farm menu (layout lane): open it first
  const menuBtn = marketBtn ? null : await spotOf(P, '#m-menu-btn');
  if (menuBtn) {
    await F.tap(menuBtn);
    await sleep(600);
    await shot(P, 'p-06a-menu');
    // the full-screen tile (a user gesture: a real tap) turns full screen on, and off again
    const fsTile = await P.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /full screen/i.test(x.textContent) && x.getBoundingClientRect().width);
      if (!b) return null;
      b.dataset.e2eFs = '1';
      return true;
    });
    if (fsTile) {
      const fsAt = await spotOf(P, '[data-e2e-fs]');
      if (fsAt) {
        await F.tap(fsAt);
        const on = await waitFor(P, () => Boolean(document.fullscreenElement), null, 4000).then(() => true, () => false);
        check('the Full screen tile goes full screen on a tap (Fullscreen API, user gesture)', on);
        await P.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});
        await sleep(500);
        // headless Chrome's device emulation does not survive a full-screen round trip (touch scrolling stops until the
        // device is emulated again; emulating it again restores it: a test-rig artifact); put the phone back
        await P.emulate(DEVICES[DEVICE]);
        await sleep(600);
      } else skip('full screen tile', 'not on screen');
    } else skip('full screen tile', 'the farm menu has no Full screen tile in this layout');
    if (!(await P.evaluate(() => window.__hh.ui.panels.top?.() === 'menu'))) {
      const again = await spotOf(P, '#m-menu-btn');
      if (again) { await F.tap(again); await sleep(600); }
    }
    marketBtn = await spotOf(P, '[data-dock="market"]');
  }
  if (marketBtn) await F.tap(marketBtn);
  else {
    skip('tap the Market in the dock', `the dock button is not on screen in this layout (top panel ${await P.evaluate(() => String(window.__hh.ui.panels.top?.()))}, `
      + `button ${await P.evaluate(() => { const b = document.querySelector('[data-dock="market"]'); if (!b) return 'missing'; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} under ${t?.className}`; })}); opened through ui.panels`);
    await P.evaluate(() => window.__hh.ui.panels.open('market'));
  }
  const opened = await waitFor(P, () => window.__hh.ui.panels.top?.() === 'market', null, 6000).then(() => true, () => false);
  check('P opened the Market', opened, await P.evaluate(() => String(window.__hh.ui.panels.top?.() ?? null)));
  // the Decor tab with a tap (once more if the sheet was still settling), else through the panel API (noted)
  const decorOn = () => P.evaluate(() => document.getElementById('panel-market-tab-decor')?.getAttribute('aria-selected') === 'true');
  for (let i = 0; i < 2 && !(await decorOn()); i++) {
    const decorTab = await spotOf(P, '#panel-market-tab-decor');
    if (decorTab) await F.tap(decorTab);
    await waitFor(P, () => document.getElementById('panel-market-tab-decor')?.getAttribute('aria-selected') === 'true', null, 2500).catch(() => {});
  }
  if (!(await decorOn())) {
    skip('tap the Decor tab', 'the tab did not take the tap in this layout; opened through ui.panels');
    await P.evaluate(() => window.__hh.ui.panels.open('market', { tab: 'decor' }));
  }
  await sleep(500);
  await shot(P, 'p-06-market');
  // panels still scroll under a finger (touch-action on the canvas only); first the sheet finishes sliding in
  let lastTop = null;
  for (let i = 0; i < 30; i++) {
    const top = await P.evaluate(() => document.getElementById('panel-market-tab-decor')?.closest('.hh-panel')?.getBoundingClientRect().top ?? null);
    if (top !== null && lastTop !== null && Math.abs(top - lastTop) < 0.5) break;
    lastTop = top;
    await sleep(200);
  }
  const sc = await P.evaluate(() => {
    const panel = document.getElementById('panel-market-tab-decor')?.closest('.hh-panel') ?? document;
    const cands = [...panel.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 20
      && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.getBoundingClientRect().height > 100);
    const el = cands[0];
    if (!el) return null;
    el.dataset.e2eScroll = '1';
    el.scrollTop = 0;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.7), h: r.height };
  });
  if (sc) {
    await F.drag([{ x: sc.x, y: sc.y }, { x: sc.x, y: sc.y - Math.min(220, sc.h * 0.5) }], { n: 8, ms: 16 });
    await sleep(500);
    const top = await P.evaluate(() => document.querySelector('[data-e2e-scroll]')?.scrollTop ?? 0);
    const what = top > 20 ? '' : await P.evaluate((q) => { const el = document.elementFromPoint(q.x, q.y); return `${el?.tagName}.${el?.className} in ${document.querySelector('[data-e2e-scroll]')?.className}`; }, sc);
    check('a finger swipe scrolls the panel', top > 20, `scrollTop ${top} ${what}`);
  } else skip('panel scroll', 'the Market list fits the screen in this layout');
  const decor = await P.evaluate(() => {
    const btns = [...document.querySelectorAll('.hh-panel [data-place]')].filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    const b = btns[0];
    if (!b) return null;
    b.dataset.e2ePick = '1';
    return b.dataset.place;
  });
  check('a decor piece P can buy', Boolean(decor));
  const buyBtn = await spotOf(P, '[data-e2e-pick]');
  if (buyBtn) await F.tap(buyBtn);
  else await P.evaluate(() => document.querySelector('[data-e2e-pick]').click());
  await waitFor(P, () => Boolean(window.__hh.controller.tool.build), null, 5000);
  await sleep(400);
  const bar0 = await P.evaluate(() => { const b = document.getElementById('touch-build'); return b && !b.hidden; });
  check('build mode on a phone: the ghost is in view with the ✓ ⟳ ✕ bar under it', bar0);
  await shot(P, 'p-07-ghost');
  // a free spot near the middle, tap it: the ghost goes there; ✓ places it
  const spot = await P.evaluate(async (def) => {
    const g = await import('/shared/rules/grid.js');
    const h = window.__hh;
    const c = document.getElementById('world').getBoundingClientRect();
    for (let dy = -160; dy <= 160; dy += 16) {
      for (let dx = -120; dx <= 120; dx += 16) {
        const x = innerWidth / 2 + dx; const y = innerHeight / 2 + dy;
        if (![[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]].every(([a, b]) => document.elementFromPoint(x + a, y + b)?.id === 'world')) continue;
        const p = h.view.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 });
        if (!p || p.kind !== 'tile') continue;
        const bar = document.getElementById('touch-build').getBoundingClientRect();
        if (x > bar.left - 30 && x < bar.right + 30 && y > bar.top - 30 && y < bar.bottom + 30) continue;
        if (g.canPlace(h.state, def, p.x, p.z, 0) === null) return { x, y, tx: p.x, tz: p.z };
      }
    }
    return null;
  }, decor);
  check('a free spot on screen for the piece', Boolean(spot));
  await trace(P);
  await F.tap(spot);
  await sleep(300);
  const ghost = await P.evaluate(() => window.__hh.controller.hover);
  const early = await P.evaluate(([def, x, z]) => Object.values(window.__hh.state.farm.objects).some((o) => o.def === def && o.x === x && o.z === z),
    [decor, spot.tx, spot.tz]);
  const okG = ghost && ghost.x === spot.tx && ghost.z === spot.tz && !early;
  check('a tap moved the ghost to the free spot (nothing bought yet)', okG, `${JSON.stringify(ghost)}${okG ? '' : ` spot ${JSON.stringify(spot)} ${await trace(P)}`}`);
  const coinsB = (await st(P)).farm.wallet.coins;
  const okBtn = await spotOf(P, '#touch-build .tb-place');
  check('the ✓ is on screen', Boolean(okBtn));
  await F.tap(okBtn);
  const placedId = await waitFor(P, ([def, x, z]) => Object.entries(window.__hh.state.farm.objects)
    .find(([, o]) => o.def === def && o.x === x && o.z === z)?.[0] ?? false, [decor, spot.tx, spot.tz], 5000).then((h) => h.jsonValue());
  check('✓ bought and placed the piece where the ghost stood', Boolean(placedId), String(placedId));
  await waitFor(D, (id) => Boolean(window.__hh.state.farm.objects[id]), placedId);
  const coinsA = (await st(P)).farm.wallet.coins;
  check('D sees the piece P bought', true, `coins ${coinsB} -> ${coinsA}`);
  await sleep(300);
  await shot(P, 'p-08-placed');
  await P.evaluate(() => window.__hh.controller.cancel());

  // 9. move it by touch: Hammer tap picks it up, a finger carries the ghost, ✓ puts it down ------------------------------
  await P.evaluate(() => window.__hh.controller.setTool('hammer'));
  await look(P, spot.tx + 0.5, spot.tz + 0.5);
  const piece = await tileAt(P, spot.tx, spot.tz);
  if (piece) {
    await F.tap(piece);
    await sleep(300);
    check('a Hammer tap picks the piece up', await P.evaluate((id) => window.__hh.controller.tool.build?.moveId === id, placedId));
    const to = await P.evaluate(async ([def, id, gx, gz]) => {
      const g = await import('/shared/rules/grid.js');
      const h = window.__hh;
      for (let r = 2; r < 6; r++) for (const [dx, dz] of [[r, 0], [0, r], [-r, 0], [0, -r]]) {
        if (g.canPlace(h.state, def, gx + dx, gz + dz, 0, id) === null) {
          const s = h.view.toScreen(gx + dx + 0.5, gz + dz + 0.5, 0);
          const el = document.elementFromPoint(s.x, s.y);
          // clear of the band along the edges where a carried ghost makes the view follow (render lane's note)
          const inside = s.x > 72 && s.x < innerWidth - 72 && s.y > 72 && s.y < innerHeight - 72;
          if (el && el.id === 'world' && inside) return { tx: gx + dx, tz: gz + dz };
        }
      }
      return null;
    }, [decor, placedId, spot.tx, spot.tz]);
    if (to) {
      // the finger starts on the piece and ends where the ghost should ride above it (the ghost rides lift px higher)
      const lift = await P.evaluate(() => 56);
      const target = await P.evaluate(([x, z]) => window.__hh.view.toScreen(x + 0.5, z + 0.5, 0), [to.tx, to.tz]);
      const end = { x: Math.round(target.x), y: Math.round(target.y + lift) };
      await trace(P);
      await F.drag([piece, end], { n: 12, flick: true });
      await sleep(300);
      const ghostAt = await P.evaluate(() => window.__hh.controller.hover);
      await shot(P, 'p-09-carried');
      const done = await spotOf(P, '#touch-build .tb-place');
      if (done) await F.tap(done);
      await sleep(300);
      const s9 = await st(P);
      const o9 = s9.farm.objects[placedId];
      check('a finger carried the ghost and ✓ put the piece down there', o9 && (o9.x !== spot.tx || o9.z !== spot.tz),
        `ghost ${JSON.stringify(ghostAt)} -> ${o9 ? `${o9.x},${o9.z}` : 'gone'} to ${JSON.stringify(to)} ${await trace(P)}`);
      await waitFor(D, ([id, x, z]) => { const o = window.__hh.state.farm.objects[id]; return o && o.x === x && o.z === z; }, [placedId, o9.x, o9.z]);
      check('D sees the move', true);
    } else skip('carry the ghost', 'no free spot on screen next to the piece');
    await P.evaluate(() => window.__hh.controller.cancel());
  } else skip('move by touch', 'the piece is under the HUD in this layout');

  // 9b. the Barn moves by touch (owner request 2026-10-04): a Hammer tap on the Barn picks it up (no "Put it away" for a
  // landmark), a tap moves the ghost to a free spot, ✓ puts it down; D sees it there; D's Move back puts it home again
  {
    await P.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); window.__hh.controller.setTool('hammer'); });
    const barn = await P.evaluate(() => Object.keys(window.__hh.state.farm.objects).find((k) => window.__hh.state.farm.objects[k].def === 'barn'));
    const b0 = (await st(P)).farm.objects[barn];
    await look(P, b0.x + 2, b0.z + 3);
    // a fingertip spot on the Barn itself (its pick is the Barn and the ring round the fingertip is all canvas)
    const onBarn = await P.evaluate(([id, x0, z0]) => {
      const h = window.__hh;
      const c = document.getElementById('world').getBoundingClientRect();
      const p0 = h.view.toScreen(x0 + 2, z0 + 2, 1.2);
      for (let r = 0; r < 120; r += 4) {
        for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
          const x = p0.x + dx; const y = p0.y + dy;
          if (![[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]].every(([a, b]) => document.elementFromPoint(x + a, y + b)?.id === 'world')) continue;
          const p = h.view.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 });
          if (p && p.id === id) return { x: Math.round(x), y: Math.round(y) };
        }
      }
      return null;
    }, [barn, b0.x, b0.z]);
    if (onBarn) {
      await F.tap(onBarn);
      await sleep(300);
      check('a Hammer tap picks the Barn up', await P.evaluate((id) => window.__hh.controller.tool.build?.moveId === id, barn), await trace(P));
      check('no "Put it away" for the Barn (landmarks are moved, never stored)', await P.evaluate(() => {
        const b = document.querySelector('#touch-build .tb-away');
        return !b || b.hidden;
      }));
      // a free spot on screen: the ghost centres the 4 x 4 footprint on the tapped tile (min corner one up-left of it)
      const to = await P.evaluate(async ([id, x0, z0]) => {
        const g = await import('/shared/rules/grid.js');
        const h = window.__hh;
        const c = document.getElementById('world').getBoundingClientRect();
        const bar = document.getElementById('touch-build')?.getBoundingClientRect();
        for (let r = 4; r < 12; r++) {
          for (const [dx, dz] of [[-r, 0], [0, r], [r, 0], [0, -r], [-r, r], [r, r]]) {
            const x = x0 + dx; const z = z0 + dz;
            if (g.canFit(h.state, 'barn', x, z, 0, id) !== null) continue;
            const s = h.view.toScreen(x + 1.5, z + 1.5, 0);
            if (!s || s.x < 40 || s.y < 90 || s.x > innerWidth - 40 || s.y > innerHeight - 160) continue;
            if (bar && s.x > bar.left - 30 && s.x < bar.right + 30 && s.y > bar.top - 30 && s.y < bar.bottom + 30) continue;
            if (![[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]].every(([a, b]) => document.elementFromPoint(s.x + a, s.y + b)?.id === 'world')) continue;
            const p = h.view.pick({ x: ((s.x - c.left) / c.width) * 2 - 1, y: -((s.y - c.top) / c.height) * 2 + 1 });
            if (p && p.x === x + 1 && p.z === z + 1) return { x: Math.round(s.x), y: Math.round(s.y), tx: x, tz: z };
          }
        }
        return null;
      }, [barn, b0.x, b0.z]);
      if (to) {
        await F.tap(to);
        await sleep(400);
        await shot(P, 'p-09b-barn-ghost');
        const done = await spotOf(P, '#touch-build .tb-place');
        check('the ✓ is on screen while the Barn is carried', Boolean(done));
        await F.tap(done);
        await sleep(200);
        const o = (await st(P)).farm.objects[barn];
        check('✓ put the Barn down where the ghost stood (predicted at once)', o.x === to.tx && o.z === to.tz, `${o.x},${o.z} want ${to.tx},${to.tz} ${await trace(P)}`);
        await waitFor(D, ([id, x, z]) => window.__hh.state.farm.objects[id]?.x === x && window.__hh.state.farm.objects[id]?.z === z, [barn, to.tx, to.tz]);
        check('D sees the Barn at its new spot', true);
        await look(P, to.tx + 2, to.tz + 2);
        await shot(P, 'p-09b-barn-moved');
        const back = await D.evaluate((id) => window.__hh.controller.moveBack(id), barn);
        check('D\'s Move back is accepted', Boolean(back && back.ok), JSON.stringify(back));
        await waitFor(P, ([id, x, z]) => window.__hh.state.farm.objects[id]?.x === x && window.__hh.state.farm.objects[id]?.z === z, [barn, b0.x, b0.z]);
        check('P sees the Barn back where it stood', true);
      } else skip('the Barn by touch', 'no free spot on screen next to the Barn');
      await P.evaluate(() => window.__hh.controller.cancel());
    } else skip('the Barn by touch', 'the Barn is under the HUD in this layout');
    await P.evaluate(() => window.__hh.controller.setTool('hand'));
  }

  // 10. landscape: the canvas is measured again, a tap still lands on its tile ---------------------------------------------
  const dev = DEVICES[DEVICE];
  await P.setViewport({ ...dev.viewport, width: dev.viewport.height, height: dev.viewport.width, isLandscape: true });
  await sleep(1200);
  await P.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  const lp = plots[7];
  await look(P, O(lp).x + 0.5, O(lp).z + 0.5);
  const lpt = await tileAt(P, O(lp).x, O(lp).z);
  if (lpt) {
    await F.tap(lpt);
    await waitFor(P, (id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat', lp, 4000).catch(() => {});
    check('landscape: a tap plants the plot under the finger', await P.evaluate((id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat', lp));
  } else skip('landscape tap', 'the plot is under the HUD in landscape');
  check('landscape reaches CSS (data-orient)', await P.evaluate(() => document.documentElement.dataset.orient === 'landscape'));
  await shot(P, 'p-10-landscape');
  await P.setViewport(dev.viewport);
  await sleep(800);

  // 11. a mid-range phone: CPU x4, input -> first frame ---------------------------------------------------------------------
  await F.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await P.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  const more = plots.slice(8, 12);
  if (more.length) await look(P, O(more[0]).x + 1, O(more[0]).z + 0.5);
  for (const id of more) {
    const q = await tileAt(P, O(id).x, O(id).z);
    if (q) { await F.tap(q); await sleep(250); }
  }
  await F.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  latencies.phone = await P.evaluate(() => window.__hh.controller.latency());
  latencies.desktop = await D.evaluate(() => window.__hh.controller.latency());
  await Promise.all([D, P].map((p) => waitFor(p, () => window.__hh.pending === 0)));
  const [fd, fp] = [await st(D), await st(P)];
  check('both converged', JSON.stringify(fd) === JSON.stringify(fp));
  await shot(P, 'p-11-final');
  await shot(D, 'd-11-final');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(JSON.stringify({ ok: true, device: DEVICE, steps: steps.length, skipped, latencies, errors, files }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message, device: DEVICE, steps, skipped, latencies, errors, files }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
}
