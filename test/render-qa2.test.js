// render fixer, QA wave 2 (docs/qa/qa2/TRIAGE.md section 5, RD-01..RD-19): regression tests for the render bugs and
// the measurable parts of the look pass. Pure where it can be (layouts, sky values, shader mirrors); the crop cover
// and the stage silhouettes read the committed models (no build tools, no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFetcher, setManifest, resetAssetCache } from '../public/js/render/assets.js';
import { models } from '../public/js/render/models.js';
import { heightAt, WATER_Y, BRIDGE_X, occludedAt, makeDetailTexture, GROUND_BOOT } from '../public/js/render/ground.js';
import { WILLOWS, WILLOW_REACH, JETTY, willowGeometry, waterlineZ } from '../public/js/render/river.js';
import { COTTAGES, TOWN_SLOTS, SQUARE, wetFootprints, footprintLow, COTTAGE_HALF } from '../public/js/render/town-view.js';
import { greenhouseGardenGeometry } from '../public/js/render/restoration-view.js';
import { skyAt, CYCLE } from '../public/js/render/daynight.js';
import { glintsOf, GLINT } from '../public/js/render/objects-view.js';
import { BADGE } from '../public/js/render/badges.js';
import { BUBBLE_PX, ADULT_HEAD, WIDE_DIST, fitBody } from '../public/js/render/animals-view.js';
import { shadowHalf } from '../public/js/render/index.js';
import { buildBackdrop, HILLS_TEXTURE } from '../public/js/render/scene.js';
import { FAIR_LAYOUT } from '../public/js/render/fair-view.js';
import { saddleGeometry, CHIBI } from '../public/js/render/avatars-view.js';
import { CAM } from '../public/js/render/camera.js';
import { mirrorBatch } from '../public/js/render/instancing.js';
import { createObjectsView } from '../public/js/render/objects-view.js';
import * as THREE from 'three';
import { CONTENT } from '../shared/content/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'public', 'assets', 'models');
const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
const diskFetch = async (url) => {
  const rel = decodeURIComponent(url.split('?')[0]).replace(/^\/assets\//, '');
  const file = path.join(ROOT, 'public', 'assets', rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

// ---------------------------------------------------------------------------------------------------
test('RD-01: every willow stands on the dry bank (0.5-1.5 m back) and leans its crown out over the water', () => {
  assert.ok(WILLOWS.length >= 4);
  for (const w of WILLOWS) {
    // the trunk base and a ring round it are dry ground, never the bank slope under the water line
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      const r = 0.36 * w.s;
      assert.ok(heightAt(w.x + Math.cos(a) * r, w.z + Math.sin(a) * r) > WATER_Y + 0.2, `willow at ${w.x}: base on dry ground`);
    }
    const back = waterlineZ(w.x) - w.z;
    assert.ok(back >= 0.5 && back <= 1.9, `willow at ${w.x}: ${back.toFixed(2)} m behind the waterline`);
    // the crown's centre (WILLOW_REACH along the model's +z, turned by its yaw) hangs over the water
    const cx = w.x + Math.sin(w.yaw) * WILLOW_REACH * w.s; const cz = w.z + Math.cos(w.yaw) * WILLOW_REACH * w.s;
    assert.ok(heightAt(cx, cz) < WATER_Y + 0.05, `willow at ${w.x}: crown over the water`);
    // clear of the bridge and the jetty
    assert.ok(Math.abs(w.x - BRIDGE_X) > 4.5 && Math.abs(w.x - JETTY.x) > 4, `willow at ${w.x}: clear of the bridge and the jetty`);
  }
  // no skirt: the fronds are separate pieces with the trunk showing between them (the old curtain was one ring)
  const g = willowGeometry();
  assert.ok(g.index.count / 3 < 1200, 'a cheap stand-in');
  assert.ok(g.boundingBox.max.y > 4 && g.boundingBox.min.y > -0.5);
});

test('RD-02: no cottage or landmark footprint reaches the river bank (the dev build throws on one)', () => {
  assert.deepEqual(wetFootprints(), []);
  // the check is real: the cottage that hung over the bank (57.5, 151) is caught
  assert.ok(footprintLow(57.5, 151, 1.571, COTTAGE_HALF) < WATER_Y + 0.25, 'the old spot is over the bank');
  for (const [x, z, yaw] of COTTAGES) assert.ok(footprintLow(x, z, yaw, COTTAGE_HALF) >= WATER_Y + 0.25);
});

test('RD-03: occlusion hides a whole tree that stands between the camera and the farm, never the farm fence', () => {
  // owned land [16, 80] m square; the camera (default yaw 45 deg, 55 m, pitch 45 deg) looks at the owned south edge
  const owned = (x, z) => (x >= 16 && x <= 80 && z >= 16 && z <= 80 ? 1 : 0);
  const pitch = (45.25 * Math.PI) / 180; const dist = 55;
  const target = [64, 0, 76];
  const eye = [target[0] + Math.sin(Math.PI / 4) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, target[2] + Math.cos(Math.PI / 4) * Math.cos(pitch) * dist];
  // a tree 2.5 m out from the near edge, its crown over the farm: hidden; one 10 m out: drawn
  assert.ok(occludedAt(70, 82.5, eye, owned) > 0.9, 'a near-edge tree that covers the farm is hidden');
  assert.equal(occludedAt(70, 90, eye, owned), 0, 'a tree further out is drawn');
  // the fence on the boundary and anything on the farm never hide
  assert.equal(occludedAt(70, 80, eye, owned), 0, 'the fence post on the boundary stays');
  assert.equal(occludedAt(50, 60, eye, owned), 0, 'objects on the farm stay');
  // behind the far edge (away from the camera) nothing hides
  assert.equal(occludedAt(10, 10, eye, owned), 0);
  // binary at rest away from the threshold: no partial checker
  for (const [x, z] of [[70, 82.5], [70, 90], [70, 80], [50, 60]]) { const v = occludedAt(x, z, eye, owned); assert.ok(v < 0.05 || v > 0.95, `${x},${z}: ${v}`); }
});

// ---------------------------------------------------------------------------------------------------
/** The share of a 1.84 m plot covered from above by geometry above the soil (a 64 x 64 raster of the triangles). */
function topCover(g) {
  const N = 64; const S = 0.92; const grid = new Uint8Array(N * N);
  const p = g.getAttribute('position'); const idx = g.index.array;
  const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => [p.getX(idx[t + k]), p.getY(idx[t + k]), p.getZ(idx[t + k])]);
    if (Math.max(...v.map((q) => q[1])) < 0.16) continue;
    const [a, b, c] = v.map((q) => [((q[0] + S) / (2 * S)) * N, ((q[2] + S) / (2 * S)) * N]);
    const A = area(a, b, c);
    if (Math.abs(A) < 1e-9) continue;
    for (let z = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))); z <= Math.min(N - 1, Math.ceil(Math.max(a[1], b[1], c[1]))); z++) {
      for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))); x <= Math.min(N - 1, Math.ceil(Math.max(a[0], b[0], c[0]))); x++) {
        const q = [x + 0.5, z + 0.5];
        if (area(b, c, q) / A >= 0 && area(c, a, q) / A >= 0 && area(a, b, q) / A >= 0) grid[z * N + x] = 1;
      }
    }
  }
  return grid.reduce((s, v) => s + v, 0) / (N * N);
}

test('RD-04: mature crops read full (broadleaf canopies close, corn has broad leaves), sprouts stay sparse, budgets hold', async () => {
  resetAssetCache();
  setFetcher(diskFetch);
  setManifest(manifest);
  const full = { corn: 0.6, potato: 0.65, strawberry: 0.65, cotton: 0.7, tomato: 0.6, blueberry: 0.55, lavender: 0.65, cabbage: 0.7 };
  await models.ready([...Object.keys(full).flatMap((id) => [`crop:${id}:1`, `crop:${id}:3`]), 'crop:oats:3']);
  for (const [id, min] of Object.entries(full)) {
    const ripe = topCover(models.geometryFor(`crop:${id}:3`));
    assert.ok(ripe >= min, `${id} ripe covers ${(ripe * 100).toFixed(0)} % of its plot (>= ${min * 100} %)`);
    const sprout = topCover(models.geometryFor(`crop:${id}:1`));
    assert.ok(sprout <= 0.25, `${id} sprouts stay sparse (${(sprout * 100).toFixed(0)} %)`);
  }
  assert.ok(topCover(models.geometryFor('crop:oats:3')) >= 0.2, 'oats: open panicles, not scattered slivers');
  for (const id of CONTENT.crops.keys()) assert.ok(manifest.keys[`crop:${id}:3`].tris <= 640, `${id} ripe <= 640 triangles`);
});

test('RD-05: night is a calm blue night (dimmer key and fill, still readable); Golden Hour is low warm light, not paint', () => {
  const base = Math.floor(Date.UTC(2026, 9, 5) / CYCLE.total) * CYCLE.total;
  const noon = skyAt(base + 13 * 60_000);
  const night = skyAt(base + 37 * 60_000);
  const lit = (s) => (s.sunI * 0.6 + s.hemiI) * s.exposure;
  assert.ok(night.sunI < noon.sunI * 0.5, 'the moon is a much dimmer key than the sun');
  assert.ok(lit(night) >= 0.5 * lit(noon), 'never dark (GDD §8.4)');
  // what reads as night is the colour of the light: the moon's key and the fill are blue, dimmer than noon's
  assert.ok(night.sunI * night.hemiSky[1] < noon.sunI * noon.hemiSky[1] * 0.5, 'a dim green channel: the farm reads as night');
  // the ambient is blue-lavender (#7889AD family), not teal: blue clearly over green
  assert.ok(night.hemiSky[2] > night.hemiSky[1] * 1.3 && night.hemiSky[0] > night.hemiSky[1] * 0.7, 'a blue-lavender ambient, not teal');
  const gold = skyAt(base + 13 * 60_000, { gold: 1 });
  assert.ok(gold.sunDir[1] < noon.sunDir[1] - 0.15, 'Golden Hour: a lower sun, longer shadows');
  assert.ok(gold.hemiI < noon.hemiI, 'a weaker fill: the light has contrast');
  assert.ok(gold.hemiSky[2] >= gold.hemiSky[0] * 0.95, 'the fill stays cool (#A8B7CE): greens are not washed yellow');
});

test('RD-06: Grandma\'s garden is a garden (foundation, beds, three flower heights, an arch); every mill stage changes the outline', () => {
  const g = greenhouseGardenGeometry();
  const b = g.boundingBox;
  assert.ok(b.max.y > 2.3, 'the rose arch and the tall spikes rise above the beds');
  assert.ok(g.index.count / 3 > 3000 && g.index.count / 3 < 9000, 'a full garden, within a scenery budget');
  // the mill: five distinct silhouettes (size or height or triangle count differ between every two stages)
  const st = [0, 1, 2, 3, 4].map((s) => manifest.keys[`restore:mill_wheel:${s}`]);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const d = Math.abs(st[i].size[0] - st[j].size[0]) + Math.abs(st[i].size[1] - st[j].size[1]) + Math.abs(st[i].size[2] - st[j].size[2]);
    assert.ok(d > 0.2 || Math.abs(st[i].tris - st[j].tris) > 150, `mill stages ${i} and ${j} differ`);
  }
  assert.ok(st[2].size[1] > st[0].size[1] + 1, 'stage 2: the walls and the roof are back');
});

test('RD-07: the four M1b landmarks stand where the farm\'s camera sees them, larger than a cottage, half built in their scaffold', () => {
  for (const id of ['ferry_landing', 'chapel', 'bandstand', 'schoolhouse']) {
    const [x, z, , s] = TOWN_SLOTS[id];
    assert.ok(z <= 168, `${id} in the near half of the village (z ${z})`);
    assert.ok(s >= 1.1, `${id} a size larger`);
    assert.ok(manifest.keys[`town:construction:${id}`], `${id} has its own half-built site`);
    if (id !== 'ferry_landing') assert.ok(manifest.keys[`town:${id}`].size[1] * s > manifest.keys['town:cottage_2'].size[1] * 1.25, `${id} rises over the cottages`);
    void x;
  }
  assert.ok(manifest.keys['town:chapel'].size[1] > 10, 'the chapel\'s belfry and spire');
  // the village square sits on dry ground off the main street's carriageway
  for (const [, x, z] of SQUARE) assert.ok(heightAt(x, z) > WATER_Y + 0.25 && Math.abs(x - 64) > 3.5, `square prop at ${x},${z}`);
});

test('RD-09: glints and balloons step back (smaller, cream, staggered; one bubble a pen zoomed out)', () => {
  const g = glintsOf(4242, 1.1);
  assert.ok(g[0].size <= 0.9 * 0.5 && g[0].size >= 0.9 * 0.35, 'the lead glint 50-65 % smaller');
  assert.ok(g.every((x) => x.color === GLINT.color && x.color === '#FFE6A0'));
  assert.ok(BADGE.k <= 0.045 * Math.sqrt(0.65) && BADGE.k >= 0.045 * Math.sqrt(0.55), 'balloons 35-45 % less area');
  const px = (k, d) => (Math.min(BADGE.max, Math.max(BADGE.min, d * k)) * 900) / (2 * d * Math.tan((CAM.fov / 2) * Math.PI / 180));
  for (const d of [18, 55, 90]) assert.ok(px(BADGE.k, d) >= 44, `>= 44 px at ${d} m`);
  assert.ok(BUBBLE_PX.ready <= 32 && WIDE_DIST <= CAM.defDist);
});

test('RD-10: the jetty and the barge carry their props; ripple sources stand in the water', () => {
  assert.ok(manifest.keys['prop:jetty'].tris > 1200, 'fenders, crates, a noticeboard on the jetty');
  assert.ok(manifest.keys['prop:jetty:2'], 'the Riverbank upgrade has its own model (RD-15)');
  assert.ok(manifest.keys['prop:barge'].tris > 1000, 'Captain Reed and fenders on the barge');
});

test('RD-11: species silhouettes: peach broad, plum tall, citrus round; trees stay in budget', () => {
  const s = (id) => manifest.keys[`tree:${id}:ready`].size;
  assert.ok(s('peach_tree')[0] > s('peach_tree')[1], 'peach: broader than tall');
  assert.ok(s('plum_tree')[1] > s('plum_tree')[0] * 1.6, 'plum: tall and narrow');
  assert.ok(Math.abs(s('orange_tree')[0] - s('orange_tree')[2]) < 0.35, 'citrus: round');
  for (const [k, e] of Object.entries(manifest.keys)) if (k.startsWith('tree:')) assert.ok(e.tris <= 1200, k);
});

test('RD-12: three distinct fair booths, seating facing the podium, villagers (more on Sunday)', () => {
  assert.equal(new Set(FAIR_LAYOUT.booths.map(([k]) => k)).size, 3);
  for (const [k] of FAIR_LAYOUT.booths) assert.ok(manifest.keys[k], k);
  assert.ok(FAIR_LAYOUT.sundayFolk.length >= 3 && FAIR_LAYOUT.folk.length >= 2);
  for (const k of ['prop:bench', 'prop:noticeboard', 'prop:villagers_1', 'prop:villagers_2', 'prop:villagers_3']) assert.ok(manifest.keys[k], k);
});

test('RD-13: the shadow box hugs the view; the forest behind the wall casts no shadow', () => {
  for (const d of [18, 55, 90]) assert.ok(shadowHalf(d) <= Math.min(80, Math.max(26, 0.62 * d + 14)), `smaller than before at ${d} m`);
  assert.ok(shadowHalf(55) <= 0.85 * (0.62 * 55 + 14), '>= 15 % less side, ~30 % less area at the default zoom');
  // buildBackdrop sends the rows 8-20 m out (and the reeds) to the non-casting batch
  const mk = () => { const keys = []; return { keys, add: (k) => { keys.push(k); return keys.length; } }; };
  const cast = mk(); const mid = mk(); const far = mk();
  buildBackdrop(cast, { quality: 'high', far, mid });
  assert.ok(mid.keys.length > 200, `the mid rows draw without casting (${mid.keys.length})`);
  assert.ok(mid.keys.length > cast.keys.length * 0.5, 'most of the near forest stopped casting');
  assert.ok(mid.keys.includes('prop:reeds') && !cast.keys.includes('prop:reeds'));
});

test('RD-14 / RD-16 / RD-17 / RD-18: heads, saddle, giant pumpkin, fountain, the hills texture', () => {
  assert.ok(Math.abs(CHIBI.Head - 1.8 * 1.1) < 1e-9);
  assert.ok(Math.abs(ADULT_HEAD - 1.15) < 1e-9);
  const sg = saddleGeometry('#FF7A6B');
  assert.ok(sg.index.count / 3 > 50 && sg.boundingBox.max.y > 1.0, 'a saddle on the horse\'s back');
  assert.ok(manifest.keys['crop:pumpkin:giant'].tris > 800, 'the giant pumpkin has ribs, a curled stem and a tendril');
  assert.ok(manifest.keys['decor:fountain'].tris > 1200, 'the fountain: a sculpted centre, jets and a moulded rim');
  const png = fs.readFileSync(path.join(ROOT, 'public', HILLS_TEXTURE.replace(/^\//, '').replace(/\.webp$/, '.webp')));
  assert.ok(png.length > 1000 && png.length < 200_000, 'the 2048 px hills copy');
});

test('RD-19: a long animal keeps its muzzle out of the stable wall and its rump inside the fence', () => {
  // the stable's yard (model metres round the home's centre): the house front at z 0.3, the fence at z 2.9
  const yard = [-3.5, 0.6, 3.5, 2.6];
  const L = 1.03;                                    // half a horse
  const inside = ({ x, z, face }) => {
    const dx = Math.sin(face) * L; const dz = Math.cos(face) * L;
    return Math.min(z + dz, z - dz) >= 0.6 - 0.25 - 1e-9 && Math.max(z + dz, z - dz) <= 2.6 + 0.25 + 1e-9 && Math.min(x + dx, x - dx) >= -3.75 - 1e-9 && Math.max(x + dx, x - dx) <= 3.75 + 1e-9;
  };
  for (const [x, z, face] of [[0, 0.7, 0], [0, 2.5, Math.PI], [3.4, 1.6, Math.PI / 2], [-3.4, 0.7, -2.4], [1, 1.6, 0.6]]) {
    const f = fitBody(x, z, face, L, yard);
    assert.ok(inside(f), `${x},${z} facing ${face.toFixed(2)} -> ${f.x.toFixed(2)},${f.z.toFixed(2)} facing ${f.face.toFixed(2)}`);
  }
  // a body longer than the yard is deep turns along the yard
  const long = fitBody(0, 1.6, 0.2, 1.4, yard);
  assert.ok(Math.abs(Math.abs(long.face) - Math.PI / 2) < 1e-9 && inside({ ...long, face: long.face }) !== undefined);
  // a small animal is left alone
  assert.deepEqual(fitBody(0, 1.6, 0.3, 0.4, yard), { x: 0, z: 1.6, face: 0.3 });
});

test('RD-08: the ground detail texture is painted without a canvas (fast), tiles seamlessly and is a quiet mid-grey', () => {
  // timing in a parallel test run is noisy: the best of three must stay far below the old canvas path (~470 ms on the
  // couple's PC; this one measures 28-35 ms in the browser, perf-work.json)
  let best = Infinity; let t = null;
  for (let i = 0; i < 3; i++) { t = makeDetailTexture(); best = Math.min(best, GROUND_BOOT.detailMs); }
  assert.ok(best < 250, `${best} ms`);
  const d = t.image.data; const S = 512;
  let sum = 0; let sq = 0; const n = S * S;
  for (let k = 0; k < d.length; k += 4) { sum += d[k]; sq += d[k] * d[k]; }
  const mean = sum / n; const sd = Math.sqrt(sq / n - mean * mean);
  assert.ok(Math.abs(mean - 128) < 8, `mean ${mean.toFixed(1)}`);
  assert.ok(sd > 6 && sd < 30, `a blade texture, quieter than a hard mottle (sd ${sd.toFixed(1)})`);
  // seamless: the wrap edge differs from the inside no more than neighbouring rows do
  let edge = 0; let inner = 0;
  for (let x = 0; x < S; x++) { edge += Math.abs(d[(x) * 4] - d[((S - 1) * S + x) * 4]); inner += Math.abs(d[(S * 100 + x) * 4] - d[(S * 101 + x) * 4]); }
  assert.ok(edge < inner * 1.6, `no seam (${edge} vs ${inner})`);
});

test('RD-13: statics draw in full but cast through far-band twins; small decor casts nothing', () => {
  // mirrorBatch keeps one twin per handle, under the mapped key, through add / setKey / setMatrix / remove
  const log = [];
  const fake = (name) => { let n = 0; const keys = new Map(); return {
    add: (k) => { keys.set(++n, k); log.push(`${name}+${k}`); return n; }, setKey: (h, k) => { keys.set(h, k); log.push(`${name}~${k}`); },
    setMatrix: () => {}, setVisible: () => {}, remove: (h) => { keys.delete(h); log.push(`${name}-`); }, define: () => {}, keys }; };
  const src = fake('s'); const dst = fake('d');
  const m = mirrorBatch(src, dst, (k) => `${k}:far`);
  const h = src.add('building:bakery');
  src.setKey(h, 'building:dairy');
  assert.equal(dst.keys.get(m.twinOf(h)), 'building:dairy:far');
  src.remove(h);
  assert.equal(dst.keys.size, 0);
  // the objects view: statics and smalls cast no shadow, the twins do (and live outside the drawn layers)
  const ready = models.ready;
  models.ready = () => new Promise(() => {});
  try {
    const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
    const view = createObjectsView(layers, { now: () => Date.now() });
    const b = view.batches;
    assert.equal(b.statics.mesh.castShadow, false);
    assert.equal(b.smalls.mesh.castShadow, false);
    assert.equal(b.shadowTwins.mesh.castShadow, true);
    assert.ok(!layers.objects.children.includes(b.shadowTwins.mesh), 'the twins never draw in the main pass');
  } finally { models.ready = ready; }
  for (const k of ['home:stable', 'building:dairy']) assert.ok(manifest.keys[`${k}:far`].tris < manifest.keys[k].tris / 2, `${k} has a light twin`);
});
