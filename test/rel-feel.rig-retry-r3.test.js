// QA r3 (life-feel half of render-look's R3-01, br#1, must): a model that failed to load once was never asked for
// again. A 4 s offline blip after the welcome left Desi's own farmer a capsule for the session ("rig failed to load,
// keeping the placeholder", render/avatars-view.js), and a lost manifest did the same to every farmer and pet.
// Now the rig and the pet try again after 1, 2, 4 … 30 s (retryMs) and at once on `online`. The real avatars view is
// built here with the shipped GLBs served from disk; the fetcher fails the first tries like a dropped link.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { installDom } from './ui-qa2-dom.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const document = installDom();
const realCreate = document.createElement.bind(document);
// a 2D canvas is only painted into (the blob and halo textures): a stand-in context is enough
document.createElement = (tag) => {
  if (tag !== 'canvas') return realCreate(tag);
  // every drawing call answers (and returns a gradient-like stand-in); property writes are kept
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => ({ addColorStop() {} })), set: (o, k, v) => { o[k] = v; return true; } });
  return { width: 0, height: 0, style: {}, getContext: () => ctx };
};
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);

const { setFetcher, resetAssetCache } = await import('../public/js/render/assets.js');
const { createAvatarsView, retryMs } = await import('../public/js/render/avatars-view.js');

/** Serve /assets/... from disk; `failing(url)` says which requests fail now (a TypeError, as fetch does offline). */
let failing = () => false;
let asked = [];
setFetcher(async (url) => {
  asked.push(url);
  if (failing(url)) throw new TypeError('Failed to fetch');
  const rel = decodeURIComponent(String(url).split('?')[0]).replace(/^.*\/assets\//, '');
  const file = path.join(ROOT, 'public', 'assets', rel);
  if (!String(url).includes('/assets/') || !fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

const settle = async (ok, rounds = 400) => {
  for (let i = 0; i < rounds && !ok(); i++) await new Promise((r) => setImmediate(r));
  return ok();
};
function view() {
  const layers = { avatars: new THREE.Group(), ui3d: new THREE.Group(), fx: new THREE.Group() };
  const v = createAvatarsView(layers, realCreate('div'), () => ({ x: 0, y: 0, visible: false }));
  const farmer = () => layers.avatars.children.find((o) => o.name === 'avatar-p1');
  const placeholder = () => farmer()?.children[0];
  const pet = () => layers.avatars.children.find((o) => o.name === 'pet-p1');
  return { v, farmer, placeholder, pet };
}
const PLAYERS = { p1: { name: 'Ana', color: '#FF7A6B', avatar: { body: 'farmer_a' }, pet: { kind: 'dog', name: 'Rex' } } };
// a lost file is said once as a warning (and assets.js says a lost manifest): expected here, kept out of the output
const quiet = () => {
  const [w, e] = [console.warn, console.error];
  console.warn = () => {};
  console.error = (...a) => { if (!/failed to load|Failed to fetch/.test(String(a[0]))) e(...a); };
  return () => { console.warn = w; console.error = e; };
};

test('R3-01: the wait before each new try: 1, 2, 4, 8, 16, then 30 s', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 12].map(retryMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('R3-01: model files lost twice while the farm loads: the farmer\'s rig and the pet come on the third try', async () => {
  const restore = quiet();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    resetAssetCache();
    let glbFails = 0;
    failing = (url) => /\.glb/.test(url) && glbFails++ < 4;            // the rig, its sickle and the dog: two rounds lost
    const { v, placeholder, pet } = view();
    v.setPlayers(PLAYERS, 'p1');
    await settle(() => glbFails >= 2);
    await settle(() => false, 40);
    assert.equal(placeholder().visible, true, 'the first try failed: the capsule for now');
    for (const ms of [1000, 2000, 4000]) { mock.timers.tick(ms); await settle(() => placeholder().visible === false, 80); }
    assert.equal(await settle(() => placeholder().visible === false), true, 'the rig came after the link did (the capsule hidden)');
    assert.ok(await settle(() => (pet()?.children[0]?.children.length ?? 0) > 0), 'and the dog\'s body');
  } finally { mock.timers.reset(); restore(); failing = () => false; }
});

test('R3-01: the manifest lost at load: the rig comes when the link is back (`online`), without waiting for the timer', async () => {
  const restore = quiet();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    resetAssetCache();
    let down = true;
    failing = () => down;
    asked = [];
    const { v, placeholder } = view();
    v.setPlayers({ p1: { name: 'Ana', color: '#FF7A6B', avatar: { body: 'farmer_b' } } }, 'p1');
    await settle(() => asked.length > 0);
    await settle(() => false, 40);
    assert.equal(placeholder().visible, true, 'no manifest: the capsule');
    down = false;
    globalThis.dispatchEvent(new Event('online'));
    assert.equal(await settle(() => placeholder().visible === false), true, 'the rig, as soon as the link came back');
  } finally { mock.timers.reset(); restore(); failing = () => false; }
});
