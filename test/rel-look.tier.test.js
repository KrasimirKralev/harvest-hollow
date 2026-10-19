// render-look (release 1.0): the auto tier keeps a 60 fps laptop at medium or better (G1, M23), and the tier the owners'
// browsers remember from HEAD never starts 1.0 at Low (M25, critique#4). Pure logic: no DOM, no WebGL, no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RN from '../public/js/render/renderer.js';

const { createAutoTier, loadTier, noteAutoTier, AUTO } = RN;

/** A fake localStorage for one test. */
function withStorage(seed, fn) {
  const store = new Map(Object.entries(seed));
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null };
  try { return fn(store); } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
}

/** Feed `secs` of 60 Hz frames: GPU ms each, and the rendered interval when the auto tier takes one. */
function run(a, secs, gpuMs, intervalMs) {
  let changed = null;
  const dt = intervalMs / 1000;
  for (let t = 0; t < secs && !changed; t += dt) {
    if (typeof a.interval === 'function') a.interval(intervalMs);
    changed = a.feed(gpuMs, dt);
  }
  return changed;
}

test('G1: a laptop that renders every frame (16.7 ms) keeps its tier even at a 15 ms GPU p90 (HEAD dropped at 12 ms)', () => {
  const a = createAutoTier('high', { kind: 'desktop' });
  assert.equal(run(a, 30, 15, 16.7), null, 'no frame missed: no downgrade');
  assert.equal(a.tier, 'high');
});

test('G1: drop only when frames are really missed: GPU p90 > 17 ms and the rendered interval p50 > 18 ms for 8 s', () => {
  assert.equal(AUTO.dropMs, 17);
  assert.equal(AUTO.climbMs, 11);
  assert.equal(AUTO.dropS, 8);
  const a = createAutoTier('high', { kind: 'desktop' });
  // a busy CPU (33 ms intervals) with a light GPU: not the GPU's fault, no drop
  assert.equal(run(a, 30, 9, 33), null, 'missed frames with GPU headroom never drop');
  // a heavy GPU at 60 Hz intervals: no frame missed, no drop
  assert.equal(run(a, 30, 19, 16.7), null);
  // both: the GPU is over budget and the frames are missed
  let secs = 0;
  let t = null;
  for (let i = 0; i < 60 * 20 && !t; i++) { a.interval(25); t = a.feed(19, 0.025); secs += 0.025; }
  assert.equal(t, 'medium');
  assert.ok(secs >= 8 && secs < 9.5, `dropped after ${secs.toFixed(2)} s`);
});

test('G1: a desktop never auto-drops below medium unless the GPU p90 exceeds 25 ms', () => {
  const a = createAutoTier('medium', { kind: 'desktop' });
  assert.equal(run(a, 30, 22, 30), null, 'a 22 ms GPU at medium stays medium on a desktop');
  assert.equal(run(a, 30, 28, 34), 'low', 'past 25 ms it may go to low');
  const p = createAutoTier('medium', { kind: 'phone' });
  assert.equal(run(p, 30, 22, 30), 'low', 'a phone may still go to low');
});

test('G1: no interactive frames (an idle farm) is no evidence: nothing drops', () => {
  const a = createAutoTier('high', { kind: 'desktop' });
  let t = null;
  for (let i = 0; i < 2000 && !t; i++) t = a.feed(30, 0.05);
  assert.equal(t, null, 'GPU over budget but no rendered-interval evidence');
});

test('M25: the auto-tier key is versioned; HEAD\'s remembered {"tier":"low","n":2} boots a desktop at medium or better', () => {
  withStorage({ 'hh.quality.auto': JSON.stringify({ tier: 'low', n: 2 }) }, (store) => {
    const t = loadTier('auto');
    assert.ok(t === 'high' || t === 'medium', `boots at ${t}`);
    assert.ok(RN.bootTier('auto', { kind: 'desktop', gpu: 'high' }) !== 'low', 'bootTier too');
    noteAutoTier('medium');
    assert.ok(store.has('hh.quality.auto2'), 'the new key is written');
    assert.ok(!store.has('hh.quality.auto'), 'the old key is gone');
  });
});

test('M25: two sessions that settled lower are still remembered under the new key', () => {
  withStorage({ 'hh.quality.auto2': JSON.stringify({ tier: 'medium', n: 2 }) }, () => {
    assert.equal(loadTier('auto'), 'medium');
    assert.equal(loadTier('high'), 'high', 'a picked tier always wins');
  });
});
