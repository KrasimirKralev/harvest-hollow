// The landing page's pictures (public/landing.html: the "Screenshots" viewer, the wide logo), made from the game itself:
// a multi-mode host on --port (default 4103) with the level-12 QA fixture farm (test/fixtures/save-m1a-l12.json, its
// farmers renamed Ana and Leo) as one farm, both farmers connected, one headless Chrome. Writes WebP into
// public/assets/landing/:
//   shot-<n>-<name>.webp (1600 x 1000), shot-<n>-<name>_960.webp      the five screenshots
//   logo-wide_560.webp, logo-wide_880.webp, logo-wide_1120.webp        the wide logo (srcset), from assets/art/logo-wide.png
// Encoding is Chrome's own (canvas.toDataURL('image/webp')): no image dependency. The orbiting farm in the page's orb
// comes from tools/landing-video.mjs.
//
//   node tools/landing-assets.mjs [--port 4103] [--only logo|shots] [--keep <dir>]   (--keep: also the raw PNGs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 4103);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const OUT = path.join(ROOT, 'public', 'assets', 'landing');
const KEEP = typeof args.keep === 'string' ? path.resolve(args.keep) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (KEEP) fs.mkdirSync(KEEP, { recursive: true });
const written = [];

const W = 1280;
const H = 800;
const DSF = 1.25;          // 1600 x 1000 masters

/** PNG bytes -> WebP bytes at `width` (the height follows), encoded by the page's canvas. */
async function webp(page, png, width, quality = 0.8) {
  const b64 = await page.evaluate(async (src, w, q) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
    // halve in steps: one big jump down aliases the HUD's thin outlines
    let cur = img;
    let cw = img.naturalWidth;
    let ch = img.naturalHeight;
    while (cw / 2 >= w) {
      const c = new OffscreenCanvas(Math.round(cw / 2), Math.round(ch / 2));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(cur, 0, 0, c.width, c.height);
      cur = c; cw = c.width; ch = c.height;
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, w, h);
    return c.toDataURL('image/webp', q).split(',')[1];
  }, `data:image/png;base64,${png.toString('base64')}`, width, quality);
  return Buffer.from(b64, 'base64');
}

function save(name, buf) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, buf);
  written.push({ file: path.relative(ROOT, file), kb: +(buf.length / 1024).toFixed(1) });
}

async function logos(browser) {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const src = fs.readFileSync(path.join(ROOT, 'public/assets/art/logo-wide.png'));
  for (const [w, q] of [[560, 0.84], [880, 0.8], [1120, 0.78]]) save(`logo-wide_${w}.webp`, await webp(page, src, w, q));
  await page.close();
}

// ---- the fixture farm on a multi-mode host -------------------------------------------------------------------------
let server = null;
let serverLog = '';
async function startServer(dataDir) {
  serverLog = '';
  server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HH_MODE: 'multi', HH_DATA_DIR: dataDir,
    HH_DEV: '1', NODE_ENV: 'development', HH_TZ: 'Europe/Sofia', HH_FARM_IDLE_MS: '3600000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 150 && !serverLog.includes('running at') && server.exitCode === null; i++) await sleep(100);
  if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-800)}`);
}
async function stopServer() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  s.kill('SIGTERM');
  await new Promise((r) => s.once('exit', r));
}

/** A farm made through the API, then its save replaced by the fixture (two farmers, fresh tokens). */
async function fixtureFarm(dataDir) {
  await startServer(dataDir);
  const res = await fetch(`http://localhost:${port}/api/farms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const { id } = await res.json();
  await stopServer();
  const dir = path.join(dataDir, 'farms', id);
  for (const f of fs.readdirSync(dir)) if (/journal|^backups?$/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/save-m1a-l12.json'), 'utf8'));
  const st = fx.state;
  st.players.p1.name = 'Ana';
  st.players.p2.name = 'Leo';
  st.farm.name = 'Willow Creek';
  const tokens = { p1: crypto.randomBytes(32).toString('hex'), p2: crypto.randomBytes(32).toString('hex') };
  const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const at = fx.now ?? Date.now();
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify({ schema: st.schema, savedAt: at, version: st.meta.version, state: st,
    server: { auth: { p1: { tokenHash: hash(tokens.p1) }, p2: { tokenHash: hash(tokens.p2) } }, clients: {}, clock: { lastNow: at } } }));
  const metaFile = path.join(dir, 'farm-meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(metaFile, 'utf8')), members: 2, reserve: null, lastSeenAt: Date.now() }));
  await startServer(dataDir);
  return { id, tokens };
}

async function farmer(browser, farm, pid, device) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (device) await page.emulate(device); else await page.setViewport({ width: W, height: H, deviceScaleFactor: DSF });
  page.on('pageerror', (e) => console.error(`${pid} pageerror: ${e.message}`));
  await page.evaluateOnNewDocument((id, p, t) => {
    try { localStorage.setItem(`hh.f.${id}.tokens`, JSON.stringify({ [p]: t })); localStorage.setItem('hh.settings', JSON.stringify({ muted: true })); } catch { /* none */ }
  }, farm.id, pid, farm.tokens[pid]);
  await page.goto(`http://localhost:${port}/f/${farm.id}?quality=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__hh?.pid && window.__hh.controller && window.__hh.state), { timeout: 120_000 });
  return page;
}

/** No panel, card or ribbon over the farm (the drip-fed tip cards come back, so this runs before every shot). */
const clean = (page) => page.evaluate(() => {
  window.__hh.ui.panels.closeAll();
  document.querySelectorAll('.unlock-banner, .rosette, .bloom-banner, .banner-more, .toast').forEach((e) => e.remove());
});

async function shots(browser) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-landing-assets-'));
  try {
    const farm = await fixtureFarm(dataDir);
    const A = await farmer(browser, farm, 'p1', null);
    const B = await farmer(browser, farm, 'p2', KnownDevices['iPhone 13']);
    const conv = await browser.newPage();
    await conv.goto('about:blank');
    await sleep(4000);
    // the same light every time: a sunny afternoon (the real clock's weather and hour vary run to run)
    const afternoon = new Date();
    afternoon.setHours(15, 30, 0, 0);
    for (const p of [A, B]) {
      await p.evaluate((t) => { window.__hh.view.setWeather?.('sunny'); window.__hh.view.setClock?.(t); }, afternoon.getTime());
      // the drip-fed tip cards queue up again whenever one leaves: keep their column out of the pictures
      await p.addStyleTag({ content: '#banners { visibility: hidden !important; }' });
      await clean(p);
    }
    const objs = await A.evaluate(() => Object.fromEntries(Object.entries(window.__hh.state.farm.objects).filter(([, o]) => o.x !== undefined)
      .map(([id, o]) => [id, { def: o.def, x: o.x, z: o.z }])));
    const of = (def) => Object.entries(objs).filter(([, o]) => o.def === def);
    const center = (list) => [list.reduce((s, [, o]) => s + o.x, 0) / list.length, list.reduce((s, [, o]) => s + o.z, 0) / list.length];
    const masters = [];
    const shot = async (n, name, page = A) => {
      await clean(page);
      await sleep(900);
      const png = Buffer.from(await page.screenshot({ type: 'png' }));
      if (KEEP) fs.writeFileSync(path.join(KEEP, `shot-${n}-${name}.png`), png);
      masters.push([n, name, png]);
      return png;
    };
    const placeBoth = async ([ax, az], [bx, bz]) => {
      await A.evaluate((x, z) => { window.__hh.avatar.place(x, z); window.__hh.avatar.flush?.(); }, ax, az);
      await B.evaluate((x, z) => { window.__hh.avatar.place(x, z); window.__hh.avatar.flush?.(); }, bx, bz);
      await sleep(1200);
    };

    // 1. the farm in full swing: pond, sheep, fields, the farmhouse, both farmers
    await placeBoth([21.2, 27.4], [22.1, 28.1]);
    const plots = center(of('plot'));
    await A.evaluate((x, z) => { window.__hh.view.focus(x, z); window.__hh.view.camera.zoom(1.45); }, plots[0] - 3, plots[1] - 2);
    await sleep(2500);
    const overview = await shot(1, 'farm');
    await A.evaluate(() => window.__hh.view.camera.zoom(1 / 1.45));

    // 2. two farmers side by side on the path by the field, a heart and a wave
    const near = of('dirt_path').map(([, o]) => [o.x + 0.5, o.z + 0.5])
      .sort((a, b) => Math.hypot(a[0] - plots[0], a[1] - plots[1]) - Math.hypot(b[0] - plots[0], b[1] - plots[1]));
    const spot = near[0];
    const next = near.find((q) => q !== spot && Math.hypot(q[0] - spot[0], q[1] - spot[1]) <= 1.01) ?? [spot[0] + 0.8, spot[1]];
    await placeBoth([spot[0] - 0.25, spot[1]], [next[0] + 0.25, next[1]]);
    await A.evaluate((x, z) => { window.__hh.view.focus(x, z); window.__hh.view.camera.zoom(0.55); }, (spot[0] + next[0]) / 2, (spot[1] + next[1]) / 2 - 1.5);
    await sleep(2500);
    await clean(A);
    await B.evaluate(() => window.__hh.controller.emote?.('heart'));
    await A.evaluate(() => window.__hh.controller.emote?.('wave'));
    await sleep(800);
    await shot(2, 'together');
    await A.evaluate(() => window.__hh.view.camera.zoom(1 / 0.55));

    // 3. the barnyard: chickens, cows, sheep
    const coop = center(of('coop'));
    const cows = center(of('cow_barn'));
    await A.evaluate((x, z) => { window.__hh.view.focus(x, z); window.__hh.view.camera.zoom(0.75); }, (coop[0] + cows[0]) / 2, (coop[1] + cows[1]) / 2 + 0.5);
    await sleep(2500);
    await shot(3, 'animals');
    await A.evaluate(() => window.__hh.view.camera.zoom(1 / 0.75));

    // 4. the bakery: bread and pies from your own harvest
    const [bakeryId, bakery] = of('bakery')[0];
    await A.evaluate((x, z) => window.__hh.view.focus(x, z), bakery.x, bakery.z);
    await sleep(1500);
    await clean(A);
    await A.evaluate((id) => window.__hh.ui.panels.open('building', { id }), bakeryId);
    await sleep(1800);
    const png4 = Buffer.from(await A.screenshot({ type: 'png' }));
    masters.push([4, 'bakery', png4]);
    if (KEEP) fs.writeFileSync(path.join(KEEP, 'shot-4-bakery.png'), png4);
    await A.evaluate(() => window.__hh.ui.panels.closeAll());

    // 5. the same farm on a phone, framed on the desktop view
    await B.evaluate((x, z) => window.__hh.view.focus(x, z), plots[0] - 1, plots[1]);
    await sleep(2500);
    await clean(B);
    await sleep(900);
    const phone = Buffer.from(await B.screenshot({ type: 'png' }));
    const frame = await browser.newPage();
    await frame.setViewport({ width: W, height: H, deviceScaleFactor: DSF });
    await frame.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;
      background:url(data:image/png;base64,${overview.toString('base64')}) center/cover">
      <div style="position:absolute;inset:0;backdrop-filter:blur(6px) saturate(1.1);background:rgba(255,236,200,.28)"></div>
      <div style="position:absolute;left:50%;top:50%;width:330px;height:714px;transform:translate(-50%,-50%) rotate(-4deg);border-radius:52px;
        background:#2b1d10;padding:14px;box-shadow:0 30px 60px rgba(40,24,10,.45),0 0 0 3px #5a3215 inset">
        <img src="data:image/png;base64,${phone.toString('base64')}" style="display:block;width:100%;height:100%;object-fit:cover;border-radius:40px">
        <div style="position:absolute;left:50%;top:22px;width:96px;height:26px;transform:translateX(-50%);border-radius:14px;background:#2b1d10"></div>
      </div></body></html>`, { waitUntil: 'load' });
    await sleep(300);
    const png5 = Buffer.from(await frame.screenshot({ type: 'png' }));
    masters.push([5, 'phone', png5]);
    if (KEEP) fs.writeFileSync(path.join(KEEP, 'shot-5-phone.png'), png5);
    await frame.close();

    for (const [n, name, png] of masters) {
      save(`shot-${n}-${name}.webp`, await webp(conv, png, W * DSF, 0.8));
      save(`shot-${n}-${name}_960.webp`, await webp(conv, png, 960, 0.78));
    }
  } finally {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  if (args.only !== 'shots') await logos(browser);
  if (args.only !== 'logo') await shots(browser);
  console.log(JSON.stringify({ ok: true, written }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err && err.stack || err), written, server: serverLog.slice(-1200) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
}
