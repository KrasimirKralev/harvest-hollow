// QA r3 integration (R3-01, render-look's Cross-lane patch for life-feel's views): a surprise box or a crate drawn while
// the model manifest was lost wore the stand-in box for the session, even after the manifest came. A late manifest now
// re-keys them to the real model (hidden until its file is in, then shown).
import { test } from 'node:test';
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
const { models } = await import('../public/js/render/models.js');
const { createGiftView } = await import('../public/js/render/gift-view.js');
const { createCrates } = await import('../public/js/render/crates-view.js');
const { makeFarm, T0 } = await import('./helpers.js');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8'));
setFetcher(async (url) => {
  const rel = decodeURIComponent(String(url).split('?')[0]).replace(/^.*\/assets\//, '');
  const file = path.join(ROOT, 'public', 'assets', rel);
  // the manifest stays lost until the test hands it over with setManifest
  if (/manifest\.json/.test(rel) || !String(url).includes('/assets/') || !fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});
const settle = async (ok, rounds = 400) => { for (let i = 0; i < rounds && !ok(); i++) await new Promise((r) => setImmediate(r)); return ok(); };
function fakeDyn() {
  const live = new Map();
  let n = 0;
  return {
    live,
    define() {},
    add(key, m) { const h = n++; live.set(h, { key, visible: true, m: m.clone() }); return h; },
    remove(h) { live.delete(h); },
    setKey(h, key) { const r = live.get(h); if (r) r.key = key; },
    setMatrix(h, m) { const r = live.get(h); if (r) r.m = m.clone(); },
    setColor() {},
    setVisible(h, v) { const r = live.get(h); if (r) r.visible = v; },
  };
}
const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

test('R3-01: a surprise box and a crate drawn without the manifest wear the model once a late manifest comes', async () => {
  const restore = quiet();
  try {
    resetAssetCache();
    const s = makeFarm();
    s.players.p2.color = '#FF7A6B';
    s.farm.gifts = { 'gift.p2.1': { by: 'p2', to: 'p1', item: 'rose', at: T0 } };
    s.farm.objects['gift.p2.1'] = { def: 'gift_box', x: 20, z: 30, rot: 0, placedAt: T0, by: 'p2' };
    s.farm.crates = { c1: { id: 'c1', x: 22, z: 30, at: T0 - 60_000, by: 'p1', item: 'coins', q: 10 } };
    const gd = fakeDyn();
    const cd = fakeDyn();
    const gifts = createGiftView({ dyn: gd, fx: null });
    const crates = createCrates({ dyn: cd, fx: null });
    gifts.setState(s, T0);
    crates.setState?.(s, T0);
    if (!cd.live.size) crates.sync?.(new Set(), new Set(['*']), s);
    const keys = (d) => [...d.live.values()].map((r) => r.key);
    assert.ok(keys(gd).length === 4 && keys(gd).every((k) => k.startsWith('hh:')), `stand-ins first: ${keys(gd)}`);
    assert.ok(keys(cd).some((k) => k === 'hh:prop:loot_crate'), `the crate's stand-in: ${keys(cd)}`);
    // the manifest is asked for again (models' backoff), and arrives
    const late = models.whenLoaded();
    setManifest(manifest);
    await models.whenLoaded();
    await late;
    const real = (d) => keys(d).every((k) => !k.startsWith('hh:'));
    assert.equal(await settle(() => real(gd)), true, `gift re-keyed: ${keys(gd)}`);
    assert.equal(await settle(() => real(cd)), true, `crate re-keyed: ${keys(cd)}`);
    const shown = (d, re) => [...d.live.values()].filter((r) => re.test(r.key) && r.visible).length;
    assert.equal(await settle(() => shown(gd, /gift_box/) === 4), true, 'the four parts show once the file is in');
    assert.equal(await settle(() => shown(cd, /loot_crate$/) === 1), true, 'the crate body shows once the file is in');
  } finally { restore(); }
});
