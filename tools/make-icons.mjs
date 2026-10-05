#!/usr/bin/env node
// Icon renderer (render-life lane): renders every item and def to transparent PNGs (128 px and 64 px) with one
// consistent 3/4 camera and soft light in headless Chrome, using the game's own material look
// (public/js/render/models.js), and writes public/assets/icons/<id>.png, icons/64/<id>.png and
// icons/manifest.json. Also renders labelled contact sheets for visual review.
//
//   node tools/make-icons.mjs                      every icon (needs tools/build-assets.mjs to have run: item
//                                                  models live in node_modules/.cache/hh-assets/items/)
//   node tools/make-icons.mjs --only <regex>       a subset of icon ids
//   node tools/make-icons.mjs --sheet <out.png> [--keys <regex>] [--cols 8] [--cell 220] [--items]
//                                                  contact sheet of model keys (or of icon ids with --items)
//   node tools/make-icons.mjs --icon-sheet <out.png>   contact sheet of the finished icon PNGs
// Chrome: /opt/google/chrome/chrome (or CHROME=...). The private static server listens on the render-life
// port 3507 (wave 3) (HH_ICON_PORT overrides) on loopback only and stops when the run ends.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'public', 'assets', 'models');
const ICONS = path.join(ROOT, 'public', 'assets', 'icons');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'hh-assets');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.html': 'text/html', '.wasm': 'application/wasm' };
const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/assets/', path.join(ROOT, 'public', 'assets')],
  ['/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/models/', MODELS],
  ['/cache/', CACHE],
  ['/icons/', ICONS],
  ['/js/', path.join(ROOT, 'public', 'js')],
  ['/shared/', path.join(ROOT, 'shared')],
];

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{ "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }</script>
<style>html,body{margin:0;background:transparent}</style></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { models, canonicalGeometry, LOOK } from '/js/render/models.js';
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const R = 320;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(R, R);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#DCEBFF', '#9A8A62', 1.55));
const sun = new THREE.DirectionalLight('#FFF1D6', 2.6); sun.position.set(-3, 5, 4); scene.add(sun);
const cam = new THREE.PerspectiveCamera(22, 1, 0.01, 1000);
const files = new Map();
async function gltf(url) { if (!files.has(url)) files.set(url, new Promise((res, rej) => loader.load(url, res, undefined, rej))); return files.get(url); }
function findKey(root, key) { let hit = null; root.traverse((o) => { if (!hit && o.userData && o.userData.key === key) hit = o; }); return hit; }
async function objectFor(job) {
  const g = await gltf(job.url);
  g.scene.updateMatrixWorld(true);
  const node = job.key ? findKey(g.scene, job.key) : g.scene;
  if (!node) throw new Error('no node ' + job.key + ' in ' + job.url);
  if (node.isMesh) {
    const geo = canonicalGeometry(node);
    const mat = models.createMaterial({ side: THREE.DoubleSide });
    return new THREE.Mesh(geo, mat);
  }
  const clone = (await import('three/addons/utils/SkeletonUtils.js')).clone(node);
  clone.traverse((o) => { if (o.isMesh) { const vc = !!o.geometry.getAttribute('color'); o.material = models.createMaterial({ vertexColors: vc, color: vc ? 0xffffff : o.material.color }); o.frustumCulled = false; } });
  clone.position.set(0, 0, 0);
  return clone;
}
// 3/4 view: yaw 35 deg toward +x, pitch 24 deg; fit the bounding sphere with a margin.
window.renderJob = async (job) => {
  const obj = new THREE.Group();
  obj.add(await objectFor(job));
  for (const w of job.with || []) obj.add(await objectFor(w));
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const yaw = (job.yaw ?? 35) * Math.PI / 180, pitch = (job.pitch ?? 24) * Math.PI / 180;
  const dist = sphere.radius / Math.sin((cam.fov * Math.PI / 180) / 2) * (job.margin ?? 1.02);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  cam.position.copy(sphere.center).addScaledVector(dir, dist);
  cam.near = dist / 50; cam.far = dist * 4; cam.updateProjectionMatrix();
  cam.lookAt(sphere.center);
  renderer.render(scene, cam);
  scene.remove(obj);
  const src = renderer.domElement;
  const out = {};
  for (const size of job.sizes || [128, 64]) {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const x = c.getContext('2d');
    const pad = Math.round(size * 0.06), inner = size - pad * 2;
    // sticker look: soft drop shadow + thin warm-dark outline, then the render on top
    const tmp = document.createElement('canvas'); tmp.width = size; tmp.height = size;
    const t = tmp.getContext('2d'); t.imageSmoothingQuality = 'high';
    t.drawImage(src, pad, pad, inner, inner);
    const o = Math.max(1, Math.round(size / 64));
    const sil = document.createElement('canvas'); sil.width = size; sil.height = size;
    const s = sil.getContext('2d'); s.drawImage(tmp, 0, 0); s.globalCompositeOperation = 'source-in'; s.fillStyle = 'rgba(58,34,18,0.85)'; s.fillRect(0, 0, size, size);
    x.save(); x.shadowColor = 'rgba(40,24,10,0.35)'; x.shadowBlur = size / 20; x.shadowOffsetY = size / 40;
    for (const [dx, dy] of [[o,0],[-o,0],[0,o],[0,-o],[o,o],[-o,-o],[o,-o],[-o,o]]) x.drawImage(sil, dx, dy);
    x.restore();
    x.drawImage(tmp, 0, 0);
    out[size] = c.toDataURL('image/png');
  }
  if (job.raw) out.raw = src.toDataURL('image/png');
  return out;
};
window.ready = true;
</script></body></html>`;

// ---------------------------------------------------------------------------------------------------
// The render-life lab: a private scene with the game's own modules (models, animals-view, avatars-view,
// fx) on a plain lawn, driven by a fixed clock so screenshots are reproducible. Not the game (render-world
// owns the real scene); it exists to look at this lane's work before render-world wires it in.
const LAB_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{ "imports": { "three": "/vendor/three/build/three.module.js", "three/addons/": "/vendor/three/examples/jsm/" } }</script>
<style>html,body{margin:0;background:#cfe8ff;overflow:hidden;font-family:sans-serif} canvas{display:block}
#overlay{position:fixed;inset:0;pointer-events:none;overflow:hidden}
#hud-barn-pill,#hud-coins-pill{position:fixed;top:14px;padding:6px 14px;border-radius:999px;background:#fff6dc;border:3px solid #a8713a;font-weight:800}
#hud-coins-pill{right:150px}#hud-barn-pill{right:20px}</style></head><body>
<canvas id="c"></canvas><div id="overlay"></div><div id="hud-coins-pill">coins</div><div id="hud-barn-pill">barn</div>
<script type="module">
import * as THREE from 'three';
import { models } from '/js/render/models.js';
import { createAnimalsView } from '/js/render/animals-view.js';
import { createAvatarsView } from '/js/render/avatars-view.js';
import { createFx } from '/js/render/fx.js';
import { initIcons } from '/js/render/icons.js';
const TILE = 2;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#D6F1FF'); scene.fog = new THREE.Fog('#D6F1FF', 160, 300);
const layers = {}; for (const n of ['objects', 'animals', 'avatars', 'fx', 'ui3d']) { layers[n] = new THREE.Group(); scene.add(layers[n]); }
scene.add(new THREE.HemisphereLight('#CFE8FF', '#8C7A4B', 1.3));
const sun = new THREE.DirectionalLight('#FFF1D6', 2.8); sun.position.set(14, 70, 84); sun.target.position.set(64, 0, 64);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
sun.shadow.intensity = 0.6; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
// lawn: a painted-ish canvas grass texture
const gc = document.createElement('canvas'); gc.width = gc.height = 256; const gx = gc.getContext('2d');
gx.fillStyle = '#7CC243'; gx.fillRect(0, 0, 256, 256);
for (let i = 0; i < 2600; i++) { gx.fillStyle = ['#72B83C', '#86CA4C', '#6CB03A', '#8DD052'][i % 4]; gx.globalAlpha = 0.35; gx.fillRect(Math.random() * 256, Math.random() * 256, 3, 6); }
const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace; gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(24, 24);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(256, 256), new THREE.MeshLambertMaterial({ map: gt }));
ground.rotation.x = -Math.PI / 2; ground.position.set(64, 0, 64); ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.5, 600);
function look(tx, tz, dist = 40, yawDeg = 45, pitchDeg = 46) {
  const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
  camera.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, tz + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(tx, 0, tz); camera.updateMatrixWorld(); window.labFocus = { x: tx, z: tz, dist };
}
const v3 = new THREE.Vector3();
const toScreenM = (mx, mz, my = 0) => { v3.set(mx, my, mz).project(camera); return { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight, visible: v3.z < 1 && Math.abs(v3.x) <= 1.1 && Math.abs(v3.y) <= 1.1 }; };
const overlay = document.getElementById('overlay');
let serverNow = 1790000000000;
const fx = createFx(layers.fx, overlay, toScreenM);
const avatars = createAvatarsView(layers, overlay, (x, z, y) => toScreenM(x * TILE, z * TILE, y));
avatars.setNow(() => serverNow); avatars.setFx(fx);
const animals = createAnimalsView(layers, overlay, toScreenM, { now: () => serverNow });
animals.setFx(fx);
fx.setLocator((pid) => avatars.screenPosOf(pid));
const statics = [];
async function place(key, x, z, rot = 0) {
  await models.ready([key]);
  const c = models.clone(key); if (!c) return null;
  c.object.position.set(x, 0, z); c.object.rotation.y = rot * Math.PI / 2;
  c.object.castShadow = true; c.object.receiveShadow = true;
  layers.objects.add(c.object); statics.push(c.object); return c.object;
}
window.lab = { THREE, models, fx, avatars, animals, look, place, layers, scene,
  setNow(t) { serverNow = t; }, now: () => serverNow,
  step(seconds, dt = 1 / 30) { for (let t = 0; t < seconds; t += dt) { serverNow += dt * 1000; animals.update(dt); avatars.update(dt); fx.update(dt); } this.render(); },
  render() { const f = window.labFocus; if (f) animals.setFocus(f.x, f.z, f.dist); renderer.render(scene, camera); },
};
await models.init(); await initIcons().catch(() => {});
window.labReady = true;
</script></body></html>`;

export function startServer(port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
    if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url === '/lab') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(LAB_PAGE); return; }
    for (const [prefix, dir] of MOUNTS) {
      if (!url.startsWith(prefix)) continue;
      const file = path.normalize(path.join(dir, url.slice(prefix.length)));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) break;
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export async function withPage(fn) {
  const port = Number(process.env.HH_ICON_PORT || 3507);
  const server = await startServer(port);
  try {
    // A headless Chrome on a loaded machine (several agents, swap full) sometimes loses its first frame at launch
    // ("Navigating frame was detached"): relaunch up to three times before giving up. Only the launch and the
    // first page load are retried; a failure inside `fn` is the caller's.
    let browser = null; let page = null; let errors = null;
    for (let attempt = 1; ; attempt++) {
      browser = await puppeteer.launch({
        executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
      });
      try {
        page = await browser.newPage();
        errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.ready === true, { timeout: 30000 });
        break;
      } catch (err) {
        await browser.close().catch(() => {});
        if (attempt >= 3) throw err;
        console.error(`make-icons: chrome launch failed (${err.message}), retrying`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    try { return await fn(page, errors); } finally { await browser.close(); }
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function dataUrlToBuffer(u) { return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'); }

// ---------------------------------------------------------------------------------------------------
// Contact sheets (visual review): a grid of labelled cells, composed in the page.
async function sheet(page, jobs, out, { cols = 8, cell = 220 } = {}) {
  const imgs = [];
  for (const j of jobs) {
    try {
      const r = await page.evaluate((job) => window.renderJob(job), { ...j, sizes: [cell] });
      imgs.push({ label: j.label, src: r[cell], note: j.note || '' });
    } catch (err) { imgs.push({ label: `${j.label} ERROR`, src: null, note: String(err.message).slice(0, 60) }); }
  }
  const png = await page.evaluate(async (list, cols, cell) => {
    const rows = Math.ceil(list.length / cols);
    const c = document.createElement('canvas'); c.width = cols * cell; c.height = rows * (cell + 34);
    const x = c.getContext('2d');
    x.fillStyle = '#F3EFE6'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < list.length; i++) {
      const cx = (i % cols) * cell, cy = Math.floor(i / cols) * (cell + 34);
      x.fillStyle = '#BFE2F2'; x.fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
      if (list[i].src) {
        const im = new Image(); im.src = list[i].src; await im.decode(); x.drawImage(im, cx, cy, cell, cell);
      }
      x.fillStyle = '#222'; x.font = 'bold 13px sans-serif'; x.fillText(list[i].label.slice(0, 30), cx + 4, cy + cell + 15);
      x.fillStyle = '#555'; x.font = '11px sans-serif'; x.fillText(list[i].note.slice(0, 36), cx + 4, cy + cell + 29);
    }
    return c.toDataURL('image/png');
  }, imgs, cols, cell);
  fs.writeFileSync(out, dataUrlToBuffer(png));
  return out;
}

function modelJobs(re) {
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
  return Object.entries(m.keys).filter(([k]) => re.test(k)).map(([k, e]) => ({
    url: `/models/${e.file}`, key: e.kind === 'skinned' && !flag('skinned') && e.rigidNode ? `${k}#rigid` : k,
    label: k, note: `${e.tris}t ${e.size.map((v) => v.toFixed(1)).join('x')}m`,
    with: k.startsWith('crop:') && m.keys.plot ? [{ url: `/models/${m.keys.plot.file}`, key: 'plot' }] : undefined,
    yaw: opt('yaw') ? Number(opt('yaw')) : undefined, pitch: opt('pitch') ? Number(opt('pitch')) : undefined,
  }));
}

function itemJobs(re) {
  const list = JSON.parse(fs.readFileSync(path.join(CACHE, 'items', 'items.json'), 'utf8'));
  return list.filter((it) => re.test(it.id)).map((it) => ({ url: `/cache/items/${it.file}`, key: it.key, label: it.id,
    note: `${it.tris}t ${it.src || ''}`.slice(0, 36), yaw: it.yaw, pitch: it.pitch, margin: it.margin }));
}

// ---------------------------------------------------------------------------------------------------
// Icons: every entry of the icon list written by build-assets (items + defs + tools + currencies).
async function icons(page, re) {
  const list = JSON.parse(fs.readFileSync(path.join(CACHE, 'items', 'icons.json'), 'utf8'));
  fs.mkdirSync(path.join(ICONS, '64'), { recursive: true });
  const man = fs.existsSync(path.join(ICONS, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(ICONS, 'manifest.json'), 'utf8')) : { ids: {} };
  const ids = { ...man.ids };
  let n = 0;
  for (const it of list) {
    if (!re.test(it.id)) continue;
    const job = it.model ? { url: `/models/${it.model.file}`, key: it.model.key } : { url: `/cache/items/${it.file}`, key: it.key };
    const r = await page.evaluate((j) => window.renderJob(j), { ...job, yaw: it.yaw, pitch: it.pitch, margin: it.margin, sizes: [128, 64] });
    fs.writeFileSync(path.join(ICONS, `${it.id}.png`), dataUrlToBuffer(r[128]));
    fs.writeFileSync(path.join(ICONS, '64', `${it.id}.png`), dataUrlToBuffer(r[64]));
    ids[it.id] = { kind: it.kind, ...(it.name ? { name: it.name } : {}) };
    n++;
  }
  const hash = (await import('node:crypto')).createHash('sha1');
  for (const id of Object.keys(ids).sort()) {
    const f = path.join(ICONS, `${id}.png`);
    if (fs.existsSync(f)) hash.update(fs.readFileSync(f));
  }
  const sorted = Object.fromEntries(Object.keys(ids).sort().map((k) => [k, ids[k]]));
  fs.writeFileSync(path.join(ICONS, 'manifest.json'), `${JSON.stringify({ version: 1, hash: hash.digest('hex').slice(0, 10), size: [128, 64], ids: sorted }, null, 1)}\n`);
  return n;
}

async function iconSheet(page, out, cols = 12) {
  const man = JSON.parse(fs.readFileSync(path.join(ICONS, 'manifest.json'), 'utf8'));
  const ids = Object.keys(man.ids);
  const cells = ids.map((id) => ({ id, src: `data:image/png;base64,${fs.readFileSync(path.join(ICONS, `${id}.png`)).toString('base64')}`, small: `data:image/png;base64,${fs.readFileSync(path.join(ICONS, '64', `${id}.png`)).toString('base64')}` }));
  const png = await page.evaluate(async (list, cols) => {
    const cw = 150, ch = 172;
    const rows = Math.ceil(list.length / cols);
    const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * ch;
    const x = c.getContext('2d');
    x.fillStyle = '#F6EBD2'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < list.length; i++) {
      const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
      const im = new Image(); im.src = list[i].src; await im.decode(); x.drawImage(im, cx + 2, cy + 2, 128, 128);
      const sm = new Image(); sm.src = list[i].small; await sm.decode(); x.drawImage(sm, cx + 112, cy + 96, 32, 32);
      x.fillStyle = '#3A2A1A'; x.font = '12px sans-serif'; x.fillText(list[i].id.slice(0, 22), cx + 4, cy + 146);
    }
    return c.toDataURL('image/png');
  }, cells, cols);
  fs.writeFileSync(out, dataUrlToBuffer(png));
  return { out, count: ids.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const res = await withPage(async (page, errors) => {
    if (opt('sheet')) {
      const re = new RegExp(opt('keys', '.'));
      const jobs = flag('items') ? itemJobs(re) : modelJobs(re);
      const out = await sheet(page, jobs, path.resolve(opt('sheet')), { cols: Number(opt('cols', 8)), cell: Number(opt('cell', 220)) });
      return { ok: errors.length === 0, sheet: out, cells: jobs.length, errors };
    }
    if (opt('lab')) {
      const mod = await import(path.resolve(opt('lab')));
      await page.setViewport({ width: Number(opt('w', 1400)), height: Number(opt('h', 850)) });
      await page.goto(`http://127.0.0.1:${process.env.HH_ICON_PORT || 3507}/lab`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.labReady === true, { timeout: 30000 });
      const shots = [];
      const shot = async (file) => { await page.screenshot({ path: file }); shots.push(file); };
      await mod.default({ page, shot, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
      return { ok: errors.length === 0, shots, errors };
    }
    if (opt('icon-sheet')) {
      const r = await iconSheet(page, path.resolve(opt('icon-sheet')), Number(opt('cols', 12)));
      return { ok: errors.length === 0, ...r, errors };
    }
    const n = await icons(page, new RegExp(opt('only', '.')));
    return { ok: errors.length === 0, icons: n, errors };
  });
  console.log(JSON.stringify({ ...res, ms: Date.now() - t0 }));
  if (!res.ok) process.exitCode = 1;
}
