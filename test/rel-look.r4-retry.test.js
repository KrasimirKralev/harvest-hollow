// render-look, QA round 4 R4-02 (docs/qa/release/qa-r4/fix-render-look.md, breaker br#3): a flapping link (20 online /
// offline flips in 5 s) pushed the next model try 30 s out, so the boxes stayed ~27 s after the link was fine. Every
// `online` wake ended the wait early, and the try it started (which fails: the interface is up before the route is)
// still advanced the backoff. Now a woken try does not count and the next wait is the first one again (models.js
// whenLoaded / ensure, instancing.js scheduleRetry). No DOM, no WebGL: the `online` events come from an EventTarget on
// globalThis and the files from disk through a fetcher that fails while the "link" is down. Real retry timings
// (RETRY.firstMs 1 s, cap 30 s). One process per file: the manifest test runs first, while this process has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// the page's `online` events (models.js wires them on its first wait): set up before any render module runs
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);

const THREE = await import('three');
const { ROOT } = await import('./helpers.js');
const { setFetcher, resetAssetCache, setManifest } = await import('../public/js/render/assets.js');
const M = await import('../public/js/render/models.js');
const { createBatch } = await import('../public/js/render/instancing.js');
const { models } = M;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** /assets/... from disk; while `link[kind]` is false every call of that kind throws like a dropped link. */
function linkDisk(link) {
  const calls = { manifest: 0, model: 0 };
  const fetcher = async (url) => {
    const kind = /manifest\.json/.test(url) ? 'manifest' : 'model';
    calls[kind]++;
    if (!link[kind]) throw new TypeError('Failed to fetch');
    const rel = decodeURIComponent(url.split('?')[0]).replace(/^.*\/assets\//, '');
    const file = path.join(ROOT, 'public', 'assets', rel);
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const buf = fs.readFileSync(file);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  return { fetcher, calls };
}
/** Run fn with console.warn / console.error captured (the link warnings are expected). */
async function quietly(fn) {
  const { error, warn } = console;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
}
/** The breaker's flap: `n` online wakes 40 ms apart, each one's try failing (the route is not up yet). */
async function flap(n) {
  for (let i = 0; i < n; i++) { globalThis.dispatchEvent(new Event('online')); await sleep(40); }
}
/** ms until cond() holds, polled every 20 ms, or null after `maxMs`. */
async function within(cond, maxMs) {
  const t0 = performance.now();
  while (performance.now() - t0 < maxMs) { if (cond()) return Math.round(performance.now() - t0); await sleep(20); }
  return cond() ? Math.round(performance.now() - t0) : null;
}

test('R4-02: after 12 failed wakes the manifest arrives within 2 s of the link working (HEAD: the next try 30 s out)', async () => {
  M.setRetryTiming?.();
  resetAssetCache();
  const link = { manifest: false, model: true };
  const { fetcher, calls } = linkDisk(link);
  setFetcher(fetcher);
  await quietly(async () => {
    await assert.rejects(models.init(), 'the first manifest try fails (the link is down)');
    await flap(12);
  });
  assert.ok(calls.manifest >= 12, `one try per wake during the flap (${calls.manifest} manifest calls)`);
  assert.equal(models.loaded(), false, 'nothing arrived while the link was down');
  link.manifest = true;                                  // the link is fine from here
  const ms = await quietly(() => within(() => models.loaded(), 2500));
  assert.ok(ms !== null && ms <= 2000, `the manifest arrived ${ms === null ? 'not within 2.5 s' : `${ms} ms`} after the link came back (${calls.manifest} manifest calls)`);
});

test('R4-02: a placeholder whose model failed through 12 wakes swaps within 2 s of the link working (instancing.js)', async () => {
  // independent of the test above (on HEAD its manifest is still 30 s out): the manifest from disk if it is not in
  if (!models.loaded()) setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/models/manifest.json'), 'utf8')));
  assert.ok(models.loaded(), 'the manifest is in');
  const link = { manifest: true, model: false };
  const { fetcher, calls } = linkDisk(link);
  setFetcher(fetcher);
  const batch = createBatch({ name: 'r4', material: new THREE.MeshBasicMaterial(), instances: 4, vertices: 1 << 15, indices: 1 << 16 });
  const swapped = [];
  batch.onSwap((k) => swapped.push(k));
  let h;
  await quietly(async () => {
    h = batch.add('crop:wheat:3', new THREE.Matrix4());
    await sleep(60);
    await flap(12);
  });
  assert.equal(batch.placeholderAt(h), true, 'still a box while the link is down');
  assert.ok(calls.model >= 12, `asked again on every wake (${calls.model} model calls)`);
  link.model = true;
  const ms = await quietly(() => within(() => swapped.length > 0, 2500));
  assert.ok(ms !== null && ms <= 2000, `the wheat swapped ${ms === null ? 'not within 2.5 s' : `${ms} ms`} after the link came back (${calls.model} model calls)`);
  assert.equal(batch.placeholderAt(h), false, 'the instance draws the model now');
});

test('R4-02: models.ensure() waits out a flapping link the same way (the farmer, the portraits)', async () => {
  const link = { manifest: true, model: false };
  const { fetcher, calls } = linkDisk(link);
  setFetcher(fetcher);
  let done = false;
  const p = quietly(() => models.ensure(['avatar:farmer_a']).then(() => { done = true; }));
  await quietly(async () => { await sleep(60); await flap(12); });
  assert.equal(done, false, 'not while the link is down');
  link.model = true;
  const ms = await within(() => done, 2500);
  await Promise.race([p, sleep(1)]);
  assert.ok(ms !== null && ms <= 2000, `the farmer arrived ${ms === null ? 'not within 2.5 s' : `${ms} ms`} after the link came back (${calls.model} model calls)`);
});
