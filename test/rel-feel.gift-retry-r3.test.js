// QA r3 (R3-01 sibling in life-feel's files, br#1): the gift box's and the crate's model file that failed to load
// (a blip while the farm loads) counted as "loaded" with the waiting records still hidden, so a surprise on the porch
// stayed invisible for the session. Now the load is tried again after 1, 2, 4 … 30 s, or at once on `online`, and the
// waiting box shows when its file comes. The shipped manifest and GLBs are served from disk; the fetcher fails first.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFxDom } from './helpers/life-feel.js';

installFxDom();
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { setFetcher, setManifest, resetAssetCache } = await import('../public/js/render/assets.js');
const { createGiftView } = await import('../public/js/render/gift-view.js');
const { createCrates } = await import('../public/js/render/crates-view.js');
const { makeFarm, T0 } = await import('./helpers.js');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8'));
let down = 0;                       // how many more model requests fail
setFetcher(async (url) => {
  if (/\.glb|\/packs\//.test(url) && down > 0) { down--; throw new TypeError('Failed to fetch'); }
  const rel = decodeURIComponent(String(url).split('?')[0]).replace(/^.*\/assets\//, '');
  const file = path.join(ROOT, 'public', 'assets', rel);
  if (!String(url).includes('/assets/') || !fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});
const settle = async (ok, rounds = 300) => { for (let i = 0; i < rounds && !ok(); i++) await new Promise((r) => setImmediate(r)); return ok(); };
function fakeDyn() {
  const live = new Map();
  let n = 0;
  return {
    live,
    define() {},
    add(key, m) { const h = n++; live.set(h, { key, visible: true, m: m.clone() }); return h; },
    remove(h) { live.delete(h); },
    setMatrix(h, m) { const r = live.get(h); if (r) r.m = m.clone(); },
    setColor() {},
    setVisible(h, v) { const r = live.get(h); if (r) r.visible = v; },
  };
}
const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

test('R3-01 sibling: a surprise waiting while its file fails twice shows once the file comes (not hidden for the session)', async () => {
  const restore = quiet();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    resetAssetCache();
    setManifest(manifest);
    down = 2;
    const s = makeFarm();
    s.players.p2.color = '#FF7A6B';
    s.farm.gifts = { 'gift.p2.1': { by: 'p2', to: 'p1', item: 'rose', at: T0 } };
    s.farm.objects['gift.p2.1'] = { def: 'gift_box', x: 20, z: 30, rot: 0, placedAt: T0, by: 'p2' };
    const dyn = fakeDyn();
    const gifts = createGiftView({ dyn, fx: null });
    gifts.setState(s, T0);
    const shown = () => [...dyn.live.values()].filter((r) => r.visible).length;
    await settle(() => down === 0);
    await settle(() => false, 40);
    assert.equal(shown(), 0, 'its file failed: the box waits, hidden (no placeholder)');
    for (const ms of [1000, 2000, 4000]) { mock.timers.tick(ms); await settle(() => shown() === 4, 100); }
    assert.equal(shown(), 4, 'the box, all four parts, once its file came');
  } finally { mock.timers.reset(); restore(); down = 0; }
});

test('R3-01 sibling: a crate waiting while its file fails shows when the link is back (`online`)', async () => {
  const restore = quiet();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    resetAssetCache();
    setManifest(manifest);
    down = 1_000;                     // the link stays down until `online`
    const dyn = fakeDyn();
    const crates = createCrates({ dyn, fx: null });
    const s = makeFarm();
    s.farm.crates = { c1: { id: 'c1', x: 22, z: 30, at: T0 - 60_000, by: 'p1', item: 'coins', q: 10 } };
    crates.setState?.(s, T0);
    if (!dyn.live.size) crates.sync?.(new Set(), new Set(['*']), s);
    assert.ok(dyn.live.size > 0, 'a crate record');
    await settle(() => false, 60);
    const body = () => [...dyn.live.values()].find((r) => /loot_crate$/.test(r.key));
    assert.equal(body()?.visible, false, 'waiting, hidden');
    down = 0;
    globalThis.dispatchEvent(new Event('online'));
    assert.equal(await settle(() => body()?.visible === true), true, 'shown once the link came back');
  } finally { mock.timers.reset(); restore(); down = 0; }
});
