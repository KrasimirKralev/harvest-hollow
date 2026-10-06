// The landing page's living farm (public/landing.html, the orb): a short silent loop of the real 3D farm, slowly
// orbiting, recorded from the game itself. A multi-mode host on --port (default 4133) with the level-12 QA fixture farm
// (test/fixtures/save-m1a-l12.json, as tools/landing-assets.mjs stages it), one headless Chrome:
//   1. the farm page, every HUD layer hidden, a fixed sky (--hour, sunny), the camera on the farm's heart;
//   2. a virtual clock drives the game's animation loop: each captured frame is exactly 1/fps of game time later and the
//      camera has turned 360/frames degrees, however slowly SwiftShader renders (so the loop is seamless and smooth);
//   3. the frames are played into a canvas at the real frame rate and recorded by Chrome's own MediaRecorder: WebM (VP9)
//      for Chrome, Firefox and Android, MP4 (H.264) for Safari; outside the orb's circle each frame is one flat colour,
//      which costs the encoder nothing. No ffmpeg, no image dependency.
// Writes public/assets/landing/farm-orbit.webm, farm-orbit.mp4 and the poster farm-orbit.webp (the first frame).
//
//   node tools/landing-video.mjs [--port 4133] [--frames 360] [--fps 24] [--size 480] [--hour 18.08]
//        [--dist 1.35] [--tilt 0] [--kbps 600] [--kbps-mp4 1000] [--preview ['h,d,t;h,d,t']]
//        [--reuse]
//        --preview: a few stills (hour, distance factor, tilt) to .scratch/landing-video/, no video
//        --reuse: encode the frames of the last run again (.scratch/landing-video/frames), e.g. at another --kbps
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 4133);
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const FRAMES = Number(args.frames || 360);
const FPS = Number(args.fps || 24);
const SIZE = Number(args.size || 480);             // the video's side (px); the game renders at 1.75x and is scaled down
const RENDER = Math.round(SIZE * 1.75);
const HOUR = Number(args.hour ?? 18.08);           // the game's light a few minutes before dusk: warm, still bright
const DIST = Number(args.dist || 1.35);            // a zoom factor on the default distance (> 1: farther)
const TILT = Number(args.tilt || 0);               // extra tilt, degrees
// MediaRecorder's VP9 lands a little under its target; Chrome's software H.264 lands far under (and looks blocky at the
// same number), so each codec has its own
const KBPS = { webm: Number(args.kbps || 600), mp4: Number(args['kbps-mp4'] || 1000) };
const OUT = path.join(ROOT, 'public', 'assets', 'landing');
const SCRATCH = path.join(ROOT, '.scratch', 'landing-video');
const FILL = '#2A1458';                            // outside the circle (never seen: the orb clips it)
const GRADE = 'saturate(1.14) contrast(1.05)';     // a touch more colour for the page's sunset
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SCRATCH, { recursive: true });

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

/**
 * A virtual clock for the page, off until __vt.start(): performance.now() and requestAnimationFrame then answer to
 * __vt.step(ms) only, so every rendered frame is exactly `ms` of game time after the last one.
 */
function virtualClock() {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let on = false;
  let now = 0;
  let queue = [];
  let next = 1e9;
  performance.now = () => (on ? now : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!on) return realRaf(cb);
    const id = next++;
    queue.push([id, cb]);
    return id;
  };
  window.cancelAnimationFrame = (id) => { if (id >= 1e9) queue = queue.filter(([i]) => i !== id); else realCancel(id); };
  window.__vt = {
    start() { now = realNow(); on = true; },
    step(ms) {
      now += ms;
      const q = queue;
      queue = [];
      for (const [, cb] of q) cb(now);
      return q.length;
    },
  };
}

async function farmPage(browser, farm) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: RENDER, height: RENDER, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`pageerror: ${e.message}`));
  await page.evaluateOnNewDocument((id, t) => {
    try {
      localStorage.setItem(`hh.f.${id}.tokens`, JSON.stringify({ p1: t }));
      localStorage.setItem('hh.settings', JSON.stringify({ muted: true }));
    } catch { /* none */ }
  }, farm.id, farm.tokens.p1);
  await page.evaluateOnNewDocument(virtualClock);
  await page.goto(`http://localhost:${port}/f/${farm.id}?quality=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__hh?.pid && window.__hh.controller && window.__hh.state), { timeout: 120_000 });
  // nothing but the world: no HUD, panels, cards, labels or the farmers' name tags
  await page.addStyleTag({ content: 'body > :not(#world) { visibility: hidden !important; }' });
  return page;
}

/** The camera on the farm's heart (fields, farmhouse, barn, the animals), at `hour` on a sunny day. */
async function stage(page, { hour, dist, tilt }) {
  const at = new Date();
  at.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  await page.evaluate((t, d, tl) => {
    const v = window.__hh.view;
    window.__hh.ui.panels.closeAll();
    v.setWeather?.('sunny');
    v.setClock?.(t);
    v.camera.resetOrbit?.();
    v.focus(27, 32.5);
    if (d !== 1) v.camera.zoom(d);
    if (tl) v.camera.orbit(0, (tl * Math.PI) / 180);
  }, at.getTime(), dist, tilt);
  await sleep(3500);
}

const frameShot = (page) => page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: RENDER, height: RENDER } });
const twoFrames = (page) => page.evaluate(() => new Promise((r) => {
  // the real compositor (the page's own rAF is virtual now): two macrotask turns let the drawn frame be presented
  setTimeout(() => setTimeout(r, 16), 16);
}));

async function preview(page) {
  const out = [];
  const set = typeof args.preview === 'string' ? args.preview.split(';').map((s) => s.split(',').map(Number))
    : [[HOUR, DIST, TILT], [HOUR - 1, DIST, TILT], [HOUR + 0.5, DIST, TILT], [HOUR, DIST * 0.8, TILT], [HOUR, DIST * 1.25, TILT], [HOUR, DIST, TILT + 8]];
  for (const [hour, dist, tilt] of set) {
    await stage(page, { hour, dist, tilt });
    const f = path.join(SCRATCH, `preview-h${hour}-d${dist.toFixed(2)}-t${tilt}.jpg`);
    fs.writeFileSync(f, await frameShot(page));
    out.push(path.relative(ROOT, f));
    await page.evaluate((d, tl) => { if (d !== 1) window.__hh.view.camera.zoom(1 / d); if (tl) window.__hh.view.camera.orbit(0, (-tl * Math.PI) / 180); }, dist, tilt);
  }
  return out;
}

async function record(page, dir) {
  await stage(page, { hour: HOUR, dist: DIST, tilt: TILT });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => window.__vt.start());
  // a few game frames first: the loop settles on the virtual clock
  for (let i = 0; i < 6; i++) { await page.evaluate((ms) => window.__vt.step(ms), 1000 / FPS); await twoFrames(page); }
  const turn = (2 * Math.PI) / FRAMES;
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((a, ms) => { window.__hh.view.camera.orbit(a, 0); window.__vt.step(ms); }, i === 0 ? 0 : turn, 1000 / FPS);
    await twoFrames(page);
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), await frameShot(page));
    if (i % 60 === 0) console.error(`frame ${i}/${FRAMES}`);
  }
}

/** The frames in `dir` -> WebM, MP4 and the poster (see the header). */
async function encode(browser, dir) {
  // the encoder: a blank HTML page, the frames as JPEG blobs, played at the real frame rate
  const enc = await (await browser.createBrowserContext()).newPage();
  await enc.goto('about:blank');
  await enc.evaluate(() => { window.__frames = []; });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  for (let i = 0; i < files.length; i += 20) {
    const chunk = files.slice(i, i + 20).map((f) => fs.readFileSync(path.join(dir, f)).toString('base64'));
    await enc.evaluate((list) => { for (const b64 of list) window.__frames.push(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' })); }, chunk);
  }
  const out = {};
  for (const [ext, mime] of [['webm', 'video/webm;codecs=vp9'], ['mp4', 'video/mp4;codecs=avc1.4D401F']]) {
    const b64 = await enc.evaluate(async (m, size, fps, kbps, fill, grade) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      const GRADE = grade;
      const paint = (bmp) => {
        g.fillStyle = fill;
        g.fillRect(0, 0, size, size);
        g.save();
        g.beginPath();
        g.arc(size / 2, size / 2, size / 2 + 2, 0, Math.PI * 2);
        g.clip();
        g.filter = GRADE;
        g.drawImage(bmp, 0, 0, size, size);
        g.restore();
      };
      const stream = c.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const rec = new MediaRecorder(stream, { mimeType: m, videoBitsPerSecond: kbps * 1000 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      const done = new Promise((r) => { rec.onstop = r; });
      let bmp = await createImageBitmap(window.__frames[0]);
      paint(bmp);
      rec.start();
      const t0 = performance.now();
      for (let i = 0; i < window.__frames.length; i++) {
        paint(bmp);
        track.requestFrame();
        const nextBmp = i + 1 < window.__frames.length ? createImageBitmap(window.__frames[i + 1]) : null;
        const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
        await new Promise((r) => setTimeout(r, Math.max(0, wait)));
        if (nextBmp) bmp = await nextBmp;
      }
      rec.stop();
      await done;
      const blob = new Blob(parts, { type: m });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, mime, SIZE, FPS, KBPS[ext], FILL, GRADE);
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(path.join(OUT, `farm-orbit.${ext}`), buf);
    out[ext] = +(buf.length / 1024).toFixed(1);
  }
  // the poster: the first frame, WebP, painted the same way
  const poster = await enc.evaluate(async (size, fill, grade) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.fillStyle = fill;
    g.fillRect(0, 0, size, size);
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 + 2, 0, Math.PI * 2);
    g.clip();
    g.filter = grade;
    g.drawImage(await createImageBitmap(window.__frames[0]), 0, 0, size, size);
    return c.toDataURL('image/webp', 0.72).split(',')[1];
  }, SIZE, FILL, GRADE);
  const pbuf = Buffer.from(poster, 'base64');
  fs.writeFileSync(path.join(OUT, 'farm-orbit.webp'), pbuf);
  out.poster = +(pbuf.length / 1024).toFixed(1);
  return out;
}

let browser;
const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hh-landing-video-'));
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const dir = path.join(SCRATCH, 'frames');
  let result;
  if (args.reuse) result = { kb: await encode(browser, dir) };
  else {
    const farm = await fixtureFarm(dataDir);
    const page = await farmPage(browser, farm);
    await sleep(4000);
    if (args.preview) result = { preview: await preview(page) };
    else {
      await record(page, dir);
      await page.browserContext().close();
      result = { kb: await encode(browser, dir) };
    }
  }
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err && err.stack || err), server: serverLog.slice(-1200) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
