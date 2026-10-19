// render-look, QA round 1 (docs/qa/release/qa-r1/fix-render-look.md): R-01 three.js warnings at load, R-02 the lawn's
// camouflage, R-03 shadow acne on roofs, R-04 the rainbow on a big farm, R-05 golden hour and dusk, R-06 the camera
// under reduced motion. Pure logic, shader source and fakes: no DOM, no WebGL (the pixel lines are tools/look-perf.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const RENDER = path.join(ROOT, 'public/js/render');

test('R-01 (F6a): the parcel ground (clover, pebbles, leaves, mushrooms) is built without a three.js warning', async () => {
  const G = await import('../public/js/render/ground.js');
  assert.equal(typeof G.parcelGroundGeometries, 'function', 'ground.js exports parcelGroundGeometries()');
  const warns = [];
  const w = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  let geos;
  try { geos = G.parcelGroundGeometries(); } finally { console.warn = w; }
  assert.deepEqual(warns, [], 'no console.warn while building them');
  for (const [k, g] of Object.entries(geos)) assert.ok(g.getAttribute('position').count > 0, `${k} has vertices`);
});

test('R-01: no render file calls toNonIndexed() on a polyhedron (three builds those without an index: it warns)', () => {
  const bad = [];
  for (const f of fs.readdirSync(RENDER).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(RENDER, f), 'utf8');
    const re = /new THREE\.(?:Octahedron|Icosahedron|Tetrahedron|Dodecahedron|Polyhedron)Geometry\([^)]*\)\s*\.toNonIndexed\(\)/g;
    for (const m of src.matchAll(re)) bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(bad, []);
});

test('R-06: under reduced or still motion a focus is a cut (no 500 ms glide); full motion still eases', async () => {
  const { createCamera } = await import('../public/js/render/camera.js');
  for (const mode of ['reduced', 'still']) {
    const cam = createCamera({ x: 80, z: 80 });
    assert.equal(typeof cam.setMotion, 'function', 'camera exposes setMotion(mode)');
    cam.setMotion(mode);
    cam.focus(25, 30);
    const g = cam.get();
    assert.ok(Math.abs(g.tx - 50) < 1e-6 && Math.abs(g.tz - 60) < 1e-6, `${mode}: the target is there at once (${g.tx}, ${g.tz})`);
    cam.update(1 / 60);
    assert.ok(Math.abs(cam.get().tx - 50) < 1e-6, `${mode}: and stays (no tween left)`);
  }
  const cam = createCamera({ x: 80, z: 80 });
  cam.setMotion('full');
  cam.focus(25, 30);
  assert.ok(Math.abs(cam.get().tx - 80) < 1e-6, 'full: the glide starts where the camera was');
});

test('R-06: view.setMotion passes the motion setting to the camera', () => {
  const src = fs.readFileSync(path.join(RENDER, 'index.js'), 'utf8');
  const body = src.slice(src.indexOf('  setMotion(mode) {'), src.indexOf('  setDayCycle(mode) {'));
  assert.match(body, /R\.cam[^\n]*setMotion/, 'setMotion(mode) reaches R.cam');
});

test('R-02: the lawn clumps are a gentle swing with soft edges (a 2x swing behind a hard edge read as camouflage)', async () => {
  const G = await import('../public/js/render/ground.js');
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const swing = lum(G.LAWN_CLUMP.light) / lum(G.LAWN_CLUMP.dark);
  assert.ok(swing <= 1.35, `light / dark clump luminance ${swing.toFixed(2)} <= 1.35 (QA r1: 1.90)`);
  assert.ok(swing >= 1.1, `still a clump layer (${swing.toFixed(2)} >= 1.1)`);
  const src = fs.readFileSync(path.join(RENDER, 'ground.js'), 'utf8');
  const m = src.match(/float clump = smoothstep\( ([\d.]+), ([\d.]+),/);
  assert.ok(m, 'the clump edge is a smoothstep');
  assert.ok(Number(m[2]) - Number(m[1]) >= 0.5, `the clump edge is wide (${m[1]}-${m[2]}; QA r1: 0.36-0.64)`);
});

test('R-05: golden hour is not lifted over noon, and dusk is its own evening (softer warm key, cooler fill, harder split)', async () => {
  const DN = await import('../public/js/render/daynight.js');
  const MIN = 60_000;
  const base = Math.floor(Date.UTC(2026, 9, 14) / DN.CYCLE.total) * DN.CYCLE.total;
  const noon = DN.skyAt(base + 13 * MIN); const golden = DN.skyAt(base + 30 * MIN); const dusk = DN.skyAt(base + 32.4 * MIN);
  // the cause QA r1 named: the golden key's exposure 1.22 made golden brighter than noon (pixels: tools/look-perf.mjs)
  assert.ok(golden.exposure <= 1.1 * noon.exposure, `golden exposure ${golden.exposure.toFixed(2)} <= 1.1 x noon`);
  const blueness = (c) => c[2] / Math.max(1e-6, c[0]);
  assert.ok(blueness(dusk.hemiSky) > 1.15 * blueness(golden.hemiSky), 'the dusk fill is clearly cooler than golden\'s');
  assert.ok(dusk.sunI < golden.sunI * 0.7, 'a softer key at dusk (its own light, not a dimmed golden)');
  assert.ok(dusk.grade.split > golden.grade.split + 0.3, `a harder split tone at dusk (${dusk.grade.split} vs ${golden.grade.split})`);
  const warm = (c) => c[0] / Math.max(1e-6, c[2]);
  assert.ok(warm(dusk.sunColor) > warm(golden.sunColor), 'the dusk sun is warmer than golden\'s');
});

test('R-03: a face turned from the sun never reads its own depth (the terminator rule on the statics\' material)', async () => {
  const G = await import('../public/js/render/ground.js');
  assert.equal(typeof G.terminatorShadows, 'function', 'ground.js exports terminatorShadows(shader)');
  const sh = { fragmentShader: '#include <lights_fragment_begin>\nvoid main() {}' };
  G.terminatorShadows(sh);
  assert.ok(!sh.fragmentShader.includes('#include <lights_fragment_begin>'), 'the light loop is replaced');
  assert.match(sh.fragmentShader, /mix\( 1\.0 - directionalLightShadow\.shadowIntensity, getShadow\([^;]*smoothstep\( 0\.0, 0\.3, dot\( geometryNormal, directLight\.direction \) \)/,
    'past the terminator the sun is the shadowed amount, blending into the map over N.L 0-0.3 (0.15 still striped on High)');
  const src = fs.readFileSync(path.join(RENDER, 'objects-view.js'), 'utf8');
  assert.match(src, /addShaderPatch\(staticMat, 'hh-terminator', terminatorShadows/, 'the statics\' material takes it');
});

test('R-03: a building casts its shadow through the model it draws (a far-band twin\'s roof striped the full roof)', async () => {
  const THREE = await import('three');
  const { models } = await import('../public/js/render/models.js');
  const { createObjectsView } = await import('../public/js/render/objects-view.js');
  // the browser knows the manifest's far-band keys (building:dairy:far ...): so does this test
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/models/manifest.json'), 'utf8'));
  assert.ok(manifest.keys['building:dairy:far'] && manifest.keys['building:bakery:far'], 'the far-band models exist');
  const { ready, has } = models;
  models.ready = () => new Promise(() => {});
  models.has = (k) => Boolean(manifest.keys[k]);
  try {
    const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
    const { batches: b } = createObjectsView(layers, { now: () => 0 });
    const twinKeys = () => { const out = []; for (let h = 0; h < 64; h++) { const k = b.shadowTwins.keyOf(h); if (k) out.push(k); } return out; };
    const before = new Set(twinKeys());
    const h = b.statics.add('building:dairy', new THREE.Matrix4());
    const added = twinKeys().filter((k) => !before.has(k) || k === 'building:dairy');
    assert.equal(b.statics.keyOf(h), 'building:dairy');
    assert.deepEqual(added, ['building:dairy'], 'the twin carries the drawn key, not its :far model');
    b.statics.setKey(h, 'building:bakery');
    assert.ok(twinKeys().includes('building:bakery') && !twinKeys().includes('building:bakery:far'), 'and follows a key change');
  } finally { models.ready = ready; models.has = has; }
});

test('R-04: the rainbow stands where the view shows land the farm does not own (G10 kept: never over the farm)', async () => {
  const IDX = await import('../public/js/render/index.js');
  assert.equal(typeof IDX.rainbowArc, 'function', 'index.js exports rainbowArc(freeAt, aspect)');
  const A = 16 / 9;
  // the band's samples of an arc (its upper half, the part the end fade leaves): share of the on-screen ones that are free
  const band = (arc, freeAt) => {
    let vis = 0; let free = 0;
    for (let k = 0; k < 48; k++) {
      const a = Math.PI * (0.12 + 0.76 * (k + 0.5) / 48);
      const x = arc.cx + Math.cos(a) * arc.r * 0.94; const y = arc.cy + Math.sin(a) * arc.r * 0.94;
      if (Math.abs(x) > A || Math.abs(y) > 1) continue;
      vis++; if (freeAt(x, y)) free++;
    }
    return { vis, free };
  };
  // the owners' default view (desktop, measured): only a sliver along the top-left shows the woods beyond the farm
  const corner = (x, y) => x < -0.25 && y > 1 - 0.36 * ((x + 0.25) / (-A + 0.25));
  const arc = IDX.rainbowArc(corner, A);
  assert.ok(arc, 'an arc fits the sliver');
  const b = band(arc, corner);
  assert.ok(b.free >= 12, `a long stretch of its band lies over the free land (${b.free} of ${b.vis} samples)`);
  assert.ok(arc.cy + arc.r >= 0.5, 'its crown is in the top quarter of the frame');
  // the arc it replaces (the middle of the view, crown at 90 % height) has nothing over that sliver
  assert.equal(band({ cx: 0, cy: 0.8 - 1.92, r: 1.92 }, corner).free, 0, 'the QA r1 arc: 0 free (gone on the owners\' farm)');
  // a view of open country: a big arc
  const open = IDX.rainbowArc(() => true, A);
  assert.ok(open && open.r >= 1.2, 'a big arc where nothing is owned');
  // a view of the farm only: no arc (the farm's land never carries one)
  assert.equal(IDX.rainbowArc(() => false, A), null);
});
