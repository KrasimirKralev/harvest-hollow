// render-look, QA round 3 R3-01 (docs/qa/release/qa-r3/fix-render-look.md, breaker br#1): a model or the model manifest
// that fails to load once is asked for again, and the boxes drawn meanwhile are counted. No DOM, no WebGL: the batches
// and the objects view run on three's CPU side; the model files come from disk through a fetcher that fails at first.
// The order matters (one process per file): the count runs first, while this process has no manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT } from './helpers.js';
import { setFetcher, resetAssetCache } from '../public/js/render/assets.js';
import * as M from '../public/js/render/models.js';
import { createBatch } from '../public/js/render/instancing.js';
import { createObjectsView } from '../public/js/render/objects-view.js';
import { createTown } from '../public/js/render/town-view.js';
import * as WS from '../public/js/render/world-state.js';
import { CONTENT } from '../shared/content/index.js';

const { models } = M;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// /assets/... from disk; the first `fail[kind]` calls of each kind throw like a dropped link (fetch's TypeError)
function flakyDisk(fail) {
  const calls = { manifest: 0, model: 0 };
  const fetcher = async (url) => {
    const kind = /manifest\.json/.test(url) ? 'manifest' : 'model';
    calls[kind]++;
    if (calls[kind] <= (fail[kind] || 0)) throw new TypeError('Failed to fetch');
    const rel = decodeURIComponent(url.split('?')[0]).replace(/^.*\/assets\//, '');
    const file = path.join(ROOT, 'public', 'assets', rel);
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const buf = fs.readFileSync(file);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  return { fetcher, calls };
}
/** Run fn with console.error / console.warn captured. */
async function quietly(fn) {
  const logs = { error: [], warn: [] };
  const { error, warn } = console;
  console.error = (...a) => logs.error.push(a.map((x) => String(x?.message ?? x)).join(' '));
  console.warn = (...a) => logs.warn.push(a.map((x) => String(x?.message ?? x)).join(' '));
  try { await fn(logs); } finally { console.error = error; console.warn = warn; }
  return logs;
}
const NOW = Date.UTC(2026, 9, 13, 18);
const farmState = (objects) => ({ meta: { farmSeed: 1, tz: 'Europe/Sofia', createdAt: NOW }, farm: { expansions: ['home'], objects }, players: {} });

test('R3-01: with the manifest lost, the boxes the farm draws are counted (the farmhouse a home box, a crop a box), quietly', async () => {
  assert.equal(models.loaded?.() ?? false, false, 'this process has no manifest yet');
  const logs = await quietly(async () => {
    const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
    const view = createObjectsView(layers, { now: () => NOW });
    view.setState(farmState({
      house: { def: 'farmhouse', x: 18, z: 26, rot: 0, placedAt: NOW, by: 'p1' },
      plot: { def: 'plot', x: 24, z: 30, rot: 0, placedAt: NOW, by: 'p1', cycle: 0,
        crop: { def: 'wheat', plantedAt: NOW - 1e9, readyAt: NOW - 1, by: 'p1', cycle: 0 } },
    }));
    const all = () => true;
    const home = (k) => /^(?:building|missing):(farmhouse|barn)(:|$)/.test(k);
    assert.ok(view.keysWhere(all, { all: true }).some(home), `the farmhouse is in view as a key (${view.keysWhere(all, { all: true })})`);
    assert.equal(view.placeholdersWhere(all, home), 1, 'the farmhouse box counts as the home still tan');
    assert.equal(view.placeholdersWhere(all), 2, 'the farmhouse and the wheat are boxes (HEAD counted 0: models.has() is false without a manifest)');
  });
  assert.deepEqual(logs.error, [], 'no console.error for boxes the lost manifest explains');
});

// the village across the river: its square's pieces are drawn only when the manifest names them (town-view SQUARE)
const lvl = (n) => CONTENT.levels[Math.min(n, CONTENT.levels.length) - 1].xp;
const townFarm = { meta: { farmSeed: 1, tz: 'Europe/Sofia', createdAt: NOW }, farm: { xp: lvl(40), expansions: ['home'], objects: {}, town: { n: 24, cur: null } }, players: {} };
const M2 = (fn) => { WS.setLivePredicate((d) => !d || !d.m || ['M1a', 'M1b', 'M2'].includes(d.m)); try { return fn(); } finally { WS.setLivePredicate(null); } };
const town = createTown({ scenery: createBatch({ name: 'town', material: new THREE.MeshBasicMaterial() }) });
let townLost = null;
test('R3-01: the village square drawn while the manifest is lost (its pieces skipped)', () => {
  M2(() => town.setState(townFarm, NOW));
  townLost = town.stats().instances;
  assert.ok(townLost >= 0);
});

test('R3-01: the retry waits 1, 2, 4, 8, 16, then 30 s; only a failure the link explains is retried for good', () => {
  assert.equal(typeof M.retryDelay, 'function', 'models.js exports retryDelay(n)');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 12].map((n) => M.retryDelay(n)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(M.networkFailure(new TypeError('Failed to fetch')), true);
  assert.equal(M.networkFailure(new Error('model crops/wheat.glb: HTTP 502')), true);
  assert.equal(M.networkFailure(new Error('manifest /assets/models/manifest.json: HTTP 404')), true);
  assert.equal(M.networkFailure(new Error('THREE.GLTFLoader: Unsupported asset')), false, 'a file that does not parse');
});

test('R3-01: a manifest and a model that fail at first still arrive, and the placeholder swaps without any new call', async () => {
  M.setRetryTiming?.({ firstMs: 5, maxMs: 40 });
  resetAssetCache();
  const { fetcher, calls } = flakyDisk({ manifest: 2, model: 2 });
  setFetcher(fetcher);
  const batch = createBatch({ name: 'r3', material: new THREE.MeshBasicMaterial(), instances: 4, vertices: 1 << 15, indices: 1 << 16 });
  const swapped = [];
  batch.onSwap((k) => swapped.push(k));
  let h;
  const logs = await quietly(async () => {
    await assert.rejects(models.init(), 'the first manifest try fails');
    h = batch.add('crop:wheat:3', new THREE.Matrix4());
    if (batch.placeholderAt) assert.equal(batch.placeholderAt(h), true, 'a box while nothing is in');
    for (let i = 0; i < 300 && !swapped.length; i++) await sleep(10);
  });
  assert.ok(models.loaded?.() ?? false, `the manifest arrived (${calls.manifest} manifest calls)`);
  assert.deepEqual(swapped, ['crop:wheat:3'], `the wheat placeholder swapped to its model (${calls.model} model calls; HEAD: never)`);
  assert.equal(batch.placeholderAt(h), false, 'the instance draws the model now');
  assert.ok(calls.model >= 3, 'the model was asked for again after its failures');
  assert.ok(!logs.error.some((l) => /keeping its placeholder|placeholders only/.test(l)), `no error per batch or for the manifest: ${logs.error}`);
  M.setRetryTiming?.();
});

test('R3-01: models.ensure() waits out failures for a view that clones a model (the farmer, the portraits)', async () => {
  M.setRetryTiming?.({ firstMs: 5, maxMs: 40 });
  resetAssetCache();
  models.dispose();
  const { fetcher, calls } = flakyDisk({ manifest: 1, model: 3 });
  setFetcher(fetcher);
  await quietly(async () => {
    assert.equal(typeof models.ensure, 'function', 'models.ensure(keys)');
    await models.init().catch(() => {});
    await models.ensure(['avatar:farmer_b']);
  });
  assert.ok(models.isReady('avatar:farmer_b'), `the farmer is ready after ${calls.model} model calls`);
  M.setRetryTiming?.();
});

test('R3-01: after a late manifest the village rebuilds with its models (the square was missing for the session)', () => {
  assert.ok(models.loaded(), 'the manifest is in by now');
  assert.ok(models.epoch >= 1, `a late arrival counted (epoch ${models.epoch})`);
  M2(() => town.setState(townFarm, NOW));
  const now = town.stats().instances;
  assert.ok(now > townLost, `the square's pieces are drawn now (${townLost} -> ${now} instances)`);
});
