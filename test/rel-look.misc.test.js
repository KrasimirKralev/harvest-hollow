// render-look (release 1.0): the first reveal (G12), the ?stats=1 readout (G14), console warnings and idle CPU (F6a),
// the rainbow beyond the wall (G10) and the ripen moment (G11a). Pure logic and fakes: no DOM, no WebGL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT } from './helpers.js';
import * as RN from '../public/js/render/renderer.js';
import * as BARGE from '../public/js/render/barge-view.js';
import * as IDX from '../public/js/render/index.js';

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('G12: view.ready() resolves after the first frame AND the in-view models, and times out on its own', async () => {
  assert.ok(exists('public/js/render/ready.js'), 'render/ready.js exists');
  const { createReadyGate } = await import('../public/js/render/ready.js');
  const g = createReadyGate();
  let done = null;
  const p = g.wait({ timeoutMs: 5000 }).then((r) => { done = r; });
  let release;
  g.models(new Promise((r) => { release = r; }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, null, 'nothing yet');
  g.frame();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, null, 'a frame alone is not enough while the models load');
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, null, 'the models alone are not enough: they must have been drawn');
  g.frame();
  await p;
  assert.equal(done.reason, 'ready');
  // a gate whose models never come resolves at its timeout (the curtain never hangs)
  const g2 = createReadyGate();
  g2.frame();
  g2.models(new Promise(() => {}));
  const r2 = await g2.wait({ timeoutMs: 30 });
  assert.equal(r2.reason, 'timeout');
  // a wait asked after it was ready resolves at once
  const r3 = await g.wait({ timeoutMs: 1 });
  assert.equal(r3.reason, 'ready');
});

test('G14: the ?stats=1 readout exists only with the parameter, and shows fps, tier and draw calls', async () => {
  assert.ok(exists('public/js/render/stats-hud.js'), 'render/stats-hud.js exists');
  const { mountStatsHud } = await import('../public/js/render/stats-hud.js');
  const made = [];
  const doc = { createElement: (tag) => { const el = { tag, style: {}, textContent: '', setAttribute() {}, remove() { this.removed = true; } }; made.push(el); return el; },
    body: { append: (el) => { el.attached = true; } } };
  const stats = () => ({ fps: 58, tier: 'high', calls: 47, profile: 'phone' });
  const timers = [];
  const setInt = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  assert.equal(mountStatsHud({ search: '', doc, stats, setInterval: setInt }), null, 'nothing without ?stats=1');
  assert.equal(mountStatsHud({ search: '?slot=p1', doc, stats, setInterval: setInt }), null);
  assert.equal(made.length, 0, 'no element created');
  const el = mountStatsHud({ search: '?slot=p1&stats=1', doc, stats, setInterval: setInt });
  assert.ok(el && el.attached, 'a corner element');
  assert.equal(timers[0][1], 500, 'updated twice a second');
  timers[0][0]();
  assert.match(el.textContent, /58/);
  assert.match(el.textContent, /high/);
  assert.match(el.textContent, /47/);
});

test('F6a: no three.js warning from the barge hull (toNonIndexed on a non-indexed geometry)', () => {
  assert.equal(typeof BARGE.bargeHullGeometry, 'function', 'barge-view exports bargeHullGeometry');
  const warns = [];
  const w = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try { BARGE.bargeHullGeometry(); } finally { console.warn = w; }
  assert.deepEqual(warns.filter((x) => /toNonIndexed/.test(x)), []);
});

test('F6a: the shader warm-up compiles in parallel only where KHR_parallel_shader_compile exists (no warning)', async () => {
  assert.equal(typeof RN.warmupCompile, 'function', 'renderer.js exports warmupCompile');
  const calls = [];
  const fake = (has) => ({ extensions: { has: (n) => has && n === 'KHR_parallel_shader_compile' },
    compileAsync: async () => { calls.push('async'); }, compile: () => { calls.push('sync'); } });
  await RN.warmupCompile(fake(false), {}, {});
  await RN.warmupCompile(fake(true), {}, {});
  assert.deepEqual(calls, ['sync', 'async']);
});

test('F6a: after the idle time ambient that travels drops to 12 fps, and to 6 after two minutes', () => {
  const base = { input: false, feedback: false, lastWant: RN.WANT.MOVING, dirty: false, blurred: false, ambientFps: 20, interactiveFps: 60, calmFps: 12 };
  assert.equal(RN.capFps({ ...base, idle: false }), 20, 'awake: the ambient rate');
  assert.ok(RN.capFps({ ...base, idle: true }) <= 12, 'idle: the calm rate');
  assert.ok(RN.capFps({ ...base, idle: true, idleLong: true }) <= 6, 'two minutes idle: 6 fps');
  assert.equal(RN.capFps({ ...base, idle: true, input: true }), 60, 'input wakes it at once');
  assert.ok(RN.LOOP.idleLongMs >= 120_000);
});

test('G10: the rainbow never crosses the owned farm: it fades out over owned land (per pixel, with a margin), depth-tested', () => {
  // (QA r1 R-04 replaced rainbowPlacement with rainbowArc, where the view shows free land: test/rel-look.qa1.test.js)
  const p = IDX.RAINBOW;
  assert.equal(p.depthTest, true);
  assert.equal(p.farmFade, true, 'the arc fades where the ground behind it is the farm');
  assert.ok(p.marginM >= 4, 'with a margin round the farm');
  // the pixel check (rainbow pixels over the farm = 0 at the close and far frames) is tools/look-perf.mjs --check
});

test('G11a: a ripe Wheat field reads warmer and richer than other ripe crops (instance colour)', async () => {
  const OV = await import('../public/js/render/objects-view.js');
  assert.equal(typeof OV.ripeColorOf, 'function', 'objects-view exports ripeColorOf(cropId)');
  const w = OV.ripeColorOf('wheat'); const o = OV.ripeColorOf('cabbage');
  assert.ok(w.r - w.b > 0.02 && o.r - o.b > 0.02, 'both still read as ripe to the pulse shader (r - b > 0.02)');
  assert.ok(w.r / w.b > o.r / o.b, 'wheat is warmer');
  void THREE;
});

test('P-05 (ui-shell, M9): view.pulse(tiles) breathes rings apart from the brush, and draws nothing while empty', async () => {
  assert.equal(typeof IDX.view.pulse, 'function', 'the facade has view.pulse');
  const { createRings } = await import('../public/js/render/objects-view.js');
  const layer = new THREE.Group();
  const r = createRings(layer, { name: 'pulseRings', breath: 0.38 });
  const mesh = layer.children[0];
  assert.equal(mesh.visible, false, 'no draw call before a ring is set');
  r.set([{ x: 1, z: 1, r: 1.2, k: 1 }]);
  assert.equal(mesh.visible, true);
  r.set([]);
  assert.equal(mesh.visible, false, 'cleared: no draw call');
});

test('P-07 (ui-shell, S7): view.fx.float(pos, text, opts) floats a refusal\'s reason at an object (facade, additive)', () => {
  assert.equal(typeof IDX.view.fx.float, 'function', 'the facade has view.fx.float');
  assert.doesNotThrow(() => IDX.view.fx.float({ x: 1, z: 2 }, 'Wheat · ready in 42 s'), 'a no-op before init');
});

