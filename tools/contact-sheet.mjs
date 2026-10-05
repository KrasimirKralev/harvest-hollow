#!/usr/bin/env node
// Render a labelled contact sheet of glTF/GLB models with headless Chrome + three.js.
//   node tools/contact-sheet.mjs <list.json> <out.png> [--cols 8] [--cell 220]
// list.json: [{ "path": "/abs/file.glb", "label": "Cow" }, ...]. Every model is framed to fill
// its cell; animated models are posed 0.4 s into an idle-like clip so nothing shows a T-pose.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [listFile, outPng] = args;
const cols = Number(opt('--cols', 8));
const cell = Number(opt('--cell', 220));
const threeDir = opt('--three', process.env.THREE_DIR || path.resolve('node_modules/three'));
const puppeteerFrom = opt('--puppeteer', process.env.PUPPETEER_FROM || path.resolve('node_modules'));
const require = createRequire(path.join(puppeteerFrom, 'x.js'));
const puppeteer = require('puppeteer-core');

const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const MIME = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.html': 'text/html' };

const page = `<!doctype html><html><body style="margin:0;background:#fff">
<canvas id="sheet"></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const list = ${JSON.stringify(list.map((m, i) => ({ url: `/m/${i}/${encodeURIComponent(path.basename(m.path))}`, label: m.label })))};
const COLS = ${cols}, CELL = ${cell}, LABEL = 30;
const rows = Math.ceil(list.length / COLS);
const sheet = document.getElementById('sheet');
sheet.width = COLS * CELL; sheet.height = rows * (CELL + LABEL);
const ctx = sheet.getContext('2d');
ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, sheet.width, sheet.height);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(CELL, CELL); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe3f5');
scene.add(new THREE.HemisphereLight('#ffffff', '#7a6a4f', 2.2));
const sun = new THREE.DirectionalLight('#fff4e0', 2.6); sun.position.set(3, 5, 4); scene.add(sun);
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const loader = new GLTFLoader();
const pick = (clips) => clips.find((c) => /idle/i.test(c.name)) || clips.find((c) => /walk/i.test(c.name)) || clips[0];
for (let i = 0; i < list.length; i++) {
  const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * (CELL + LABEL);
  let err = null;
  try {
    const gltf = await loader.loadAsync(list[i].url);
    const root = gltf.scene;
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(pick(gltf.animations)).play();
      mixer.update(0.4);
    }
    // FBX2glTF maps Phong to metallic 0.4, which renders dark without an env map; the game will
    // override the same way, so preview what the game will show.
    root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { if ('metalness' in m) { m.metalness = 0; m.roughness = Math.max(0.6, m.roughness); } } });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) || 1;
    cam.position.copy(center).add(new THREE.Vector3(1.1, 0.75, 1.5).normalize().multiplyScalar(r * 2.6));
    cam.near = r / 100; cam.far = r * 100; cam.updateProjectionMatrix();
    cam.lookAt(center);
    scene.add(root);
    renderer.render(scene, cam);
    scene.remove(root);
    ctx.drawImage(renderer.domElement, x, y);
    ctx.fillStyle = '#555'; ctx.font = '11px sans-serif';
    ctx.fillText(size.x.toFixed(2) + ' x ' + size.y.toFixed(2) + ' x ' + size.z.toFixed(2), x + 4, y + CELL - 6);
  } catch (e) { err = String(e.message || e).slice(0, 40); }
  ctx.fillStyle = err ? '#b00' : '#222'; ctx.font = 'bold 13px sans-serif';
  ctx.fillText((err ? 'ERR ' : '') + list[i].label.slice(0, 30), x + 4, y + CELL + 18);
  if (err) { ctx.font = '11px sans-serif'; ctx.fillText(err, x + 4, y + CELL / 2); }
}
window.__done = true;
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = null;
  if (url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page); }
  if (url.startsWith('/three/')) file = path.join(threeDir, url.slice(7));
  else if (url.startsWith('/m/')) {
    const [, , idx, ...rest] = url.split('/');
    const base = list[Number(idx)] && path.dirname(list[Number(idx)].path);
    if (base) file = path.join(base, rest.join('/'));
  }
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: '/opt/google/chrome/chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
try {
  const tab = await browser.newPage();
  tab.on('pageerror', (e) => console.error('pageerror', e.message));
  await tab.goto(`http://127.0.0.1:${port}/`);
  await tab.waitForFunction('window.__done === true', { timeout: 600000 });
  const dataUrl = await tab.evaluate(() => document.getElementById('sheet').toDataURL('image/png'));
  fs.writeFileSync(outPng, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${outPng} (${list.length} models)`);
} finally {
  await browser.close();
  server.close();
}
