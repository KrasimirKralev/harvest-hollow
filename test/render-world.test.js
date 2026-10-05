// render-world: the pure logic behind the 3D world (deterministic, no DOM, no sleeps): the sky clock, weather,
// zoom bands, camera maths, ground ownership, object looks and their time-driven schedule, picking, batches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT, T0 } from './helpers.js';
import { CONTENT, cropOf, isLive } from '../shared/content/index.js';
import { TILE_M, FARM_MIN, FARM_MAX } from '../shared/content/config.js';
import { setManifest } from '../public/js/render/assets.js';
import { models } from '../public/js/render/models.js';
import { phaseAt, phaseAtHour, skyAt, CYCLE, angleDeg, hexLinear, skyClock } from '../public/js/render/daynight.js';
import { weatherAt, createWeather, setWeatherSource, HOUR_MS } from '../public/js/render/weather.js';
import { bandFor, createLod, LOD } from '../public/js/render/lod.js';
import { pitchFor, clampTarget, zoomToward, CAM } from '../public/js/render/camera.js';
import { heightAt, landTiles, boundaryEdges, saleSigns, WATER_Y, riverZ, wildOnSale, liveRects, liveUnionDist, LAWN } from '../public/js/render/ground.js';
import { forestSpot } from '../public/js/render/scene.js';
import { visualOf, createHeap, fenceLinks, productOf, staticKey, plotGeometry, createObjectsView, hashId, waterPin, glintsOf, doorProps } from '../public/js/render/objects-view.js';
import { rayPick } from '../public/js/render/picking.js';
import { createBatch, grownCapacity } from '../public/js/render/instancing.js';
import { slotKey, badgeSize } from '../public/js/render/badges.js';
import { createAutoTier, createIntervalTier, QUALITY, loadTier, noteAutoTier, capFps, startLoop, LOOP } from '../public/js/render/renderer.js';
import { particleWant } from '../public/js/render/fx.js';
import { easeToward, SEASON_INDEX } from '../public/js/render/world-uniforms.js';

setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8')));

// ---------------------------------------------------------------------------------------------------
test('the 40-minute sky cycle: 4 dawn, 26 day, 4 dusk, 6 night, on server time only', () => {
  assert.equal(CYCLE.total, 40 * 60_000);
  const base = Math.floor(T0 / CYCLE.total) * CYCLE.total;
  const at = (min) => phaseAt(base + min * 60_000);
  assert.equal(at(0).phase, 'dawn');
  assert.equal(at(3.99).phase, 'dawn');
  assert.equal(at(4).phase, 'day');
  assert.equal(at(29.99).phase, 'day');
  assert.equal(at(30).phase, 'dusk');
  assert.equal(at(34).phase, 'night');
  assert.equal(at(40).phase, 'dawn', 'the cycle repeats');
  assert.ok(Math.abs(at(17).k - 0.5) < 1e-9, 'k is the progress inside the phase');
  // both screens: a pure function of the server clock
  assert.deepEqual(skyAt(base + 777_000), skyAt(base + 777_000));
});

test('night is moonlit and never dark; day is brightest; golden hour warms without darkening', () => {
  const base = Math.floor(T0 / CYCLE.total) * CYCLE.total;
  const day = skyAt(base + 12 * 60_000);
  const night = skyAt(base + 37 * 60_000);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.equal(day.night, 0);
  assert.equal(night.night, 1);
  assert.ok(night.sunI > 0.8 && night.hemiI >= 1.2, 'moonlight keeps every crop readable');
  assert.ok(day.sunI > night.sunI);
  assert.ok(lum(night.hemiSky) > 0.2, 'the fill light at night stays bright lavender');
  for (const s of [day, night]) assert.ok(Math.abs(Math.hypot(...s.sunDir) - 1) < 1e-9 && s.sunDir[1] > 0.2, 'the light is above the farm');
  const gold = skyAt(base + 12 * 60_000, { gold: 1 });
  assert.ok(gold.horizon[0] > day.horizon[0] && gold.horizon[2] < day.horizon[2], 'golden: a warmer horizon');
  // QA wave 2 RD-05 ("mustard"): the light does it: a lower, warmer key (long shadows) against a cool, weaker fill;
  // the frame stays within 15 % of noon
  assert.ok(gold.sunDir[1] < day.sunDir[1] - 0.15, 'Golden Hour: the sun sits lower (longer shadows)');
  assert.ok(gold.sunColor[0] / gold.sunColor[2] > day.sunColor[0] / day.sunColor[2] * 1.2, 'a warmer key light');
  assert.ok(gold.sunI >= day.sunI * 0.8 && gold.sunI <= day.sunI * 1.2, 'the key stays near noon\'s (it comes in lower)');
  const bright = (s) => (s.sunI * 0.6 + s.hemiI) * s.exposure;
  assert.ok(bright(gold) >= bright(day) * 0.85, 'Golden Hour never really dims the farm');
  assert.ok(gold.hemiSky[2] >= gold.hemiSky[0] * 0.9, 'Golden Hour keeps a cool fill: the warmth is in the key light, not a yellow wash');
  const rain = skyAt(base + 12 * 60_000, { weather: { rain: 1, cloud: 1 } });
  assert.ok(rain.sunI < day.sunI * 0.6, 'rain softens the sun');
  // modes
  assert.equal(skyAt(base + 37 * 60_000, { mode: 'day' }).phase, 'day', 'Always day');
  assert.equal(skyAt(base, { mode: 'real', localHour: 22 }).phase, 'night');
  assert.equal(phaseAtHour(6).phase, 'dawn');
  assert.equal(phaseAtHour(12).phase, 'day');
  assert.equal(phaseAtHour(19.5).phase, 'dusk');
  assert.equal(phaseAtHour(2).phase, 'night');
  assert.ok(Math.abs(angleDeg([1, 0, 0], [0, 1, 0]) - 90) < 1e-9);
  assert.deepEqual(hexLinear('#FFFFFF'), [1, 1, 1]);
});

test('the sun moves in steps the static shadow cache can afford (>= 0.5 deg per refresh, slow by day)', () => {
  const base = Math.floor(T0 / CYCLE.total) * CYCLE.total;
  let refreshes = 0;
  let last = skyAt(base + 4 * 60_000).sunDir;
  for (let s = 4 * 60; s <= 30 * 60; s += 1) {
    const d = skyAt(base + s * 1000).sunDir;
    if (angleDeg(last, d) >= 0.5) { refreshes++; last = d; }
  }
  assert.ok(refreshes > 10 && refreshes < 200, `${refreshes} shadow refreshes over the 26-minute day`);
});

// ---------------------------------------------------------------------------------------------------
test('weather: deterministic per farm and hour, with the GDD distribution (70 / 15 / 12 / 3 %)', () => {
  const n = { sunny: 0, cloudy: 0, rain: 0, windy: 0 };
  const H = 40_000;
  for (let h = 0; h < H; h++) n[weatherAt(12345, h)]++;
  assert.ok(Math.abs(n.sunny / H - 0.7) < 0.02, `sunny ${n.sunny / H}`);
  assert.ok(Math.abs(n.cloudy / H - 0.15) < 0.015, `cloudy ${n.cloudy / H}`);
  assert.ok(Math.abs(n.rain / H - 0.12) < 0.015, `rain ${n.rain / H}`);
  assert.ok(Math.abs(n.windy / H - 0.03) < 0.01, `windy ${n.windy / H}`);
  assert.equal(weatherAt(7, 99), weatherAt(7, 99));
  let differ = 0;
  for (let h = 0; h < 200; h++) if (weatherAt(1, h) !== weatherAt(2, h)) differ++;
  assert.ok(differ > 40, 'two farms have different weather');
});

test('weather on screen: showers build, ground stays wet and dries slowly; the rules source wins when set', () => {
  const w = createWeather();
  const seed = 5;
  let h = 0;
  while (weatherAt(seed, h) !== 'sunny' || weatherAt(seed, h + 1) !== 'rain' || weatherAt(seed, h + 2) !== 'sunny') h++;
  const t0 = h * HOUR_MS;
  let lv = w.update(t0 + HOUR_MS - 1000, 0.016, { farmSeed: seed });
  assert.equal(lv.kind, 'sunny');
  assert.equal(lv.rain, 0, 'the first frame shows the weather as it is');
  for (let i = 0; i < 10; i++) lv = w.update(t0 + HOUR_MS + i * 1000, 1, { farmSeed: seed });
  assert.equal(lv.kind, 'rain');
  assert.ok(lv.rain > 0.4 && lv.rain < 0.6, `rain builds over ~20 s (${lv.rain})`);
  for (let i = 0; i < 60; i++) lv = w.update(t0 + HOUR_MS + 10_000 + i * 1000, 1, { farmSeed: seed });
  assert.equal(lv.rain, 1);
  assert.ok(lv.wet > 0.95);
  for (let i = 0; i < 60; i++) lv = w.update(t0 + 2 * HOUR_MS + i * 1000, 1, { farmSeed: seed });
  assert.equal(lv.rain, 0, 'the shower ends');
  assert.ok(lv.wet > 0.5 && lv.wet < 0.8, `the ground dries over minutes (${lv.wet})`);
  w.force('windy');
  assert.equal(w.update(t0, 0.016, { farmSeed: seed }).wind, 1.6, 'windy: sway x1.6, at once when forced');
  setWeatherSource(() => 'rain');
  try {
    const w2 = createWeather();
    assert.equal(w2.update(0, 0.016, { farmSeed: 1 }).kind, 'rain');
  } finally { setWeatherSource(null); }
});

// ---------------------------------------------------------------------------------------------------
test('zoom bands: near < 35 m <= mid < 60 m <= far, with 10 % hysteresis', () => {
  assert.equal(bandFor(20), 'near');
  assert.equal(bandFor(40), 'mid');
  assert.equal(bandFor(80), 'far');
  assert.equal(bandFor(36, 'near'), 'near', 'stays near until 10 % past the edge');
  assert.equal(bandFor(LOD.near * 1.11, 'near'), 'mid');
  assert.equal(bandFor(33, 'mid'), 'mid');
  assert.equal(bandFor(31, 'mid'), 'near');
  assert.equal(bandFor(58, 'far'), 'far');
  assert.equal(bandFor(53, 'far'), 'mid');
  assert.equal(bandFor(20, 'far'), 'near', 'a big jump lands in the right band');
  const lod = createLod();
  assert.equal(lod.update(55), 'mid');
  assert.equal(lod.update(56), null, 'unchanged: no work');
});

test('camera maths: pitch 36..54 deg, pan clamped to the owned land + 6 m, zoom keeps the cursor point', () => {
  assert.ok(Math.abs(pitchFor(CAM.minDist) - 36 * Math.PI / 180) < 1e-9);
  assert.ok(Math.abs(pitchFor(CAM.maxDist) - 54 * Math.PI / 180) < 1e-9);
  assert.ok(pitchFor(500) <= pitchFor(CAM.maxDist) + 1e-12);
  const b = { x0: 16, z0: 24, x1: 40, z1: 40 };
  assert.deepEqual(clampTarget({ x: 0, z: 200 }, b), { x: 16 * TILE_M - 6, z: 40 * TILE_M + 6 });
  assert.deepEqual(clampTarget({ x: 50, z: 60 }, b), { x: 50, z: 60 });
  // zooming in by f about an anchor: the anchor's offset from the target scales by f
  const t = { x: 50, z: 60 };
  const a = { x: 70, z: 50 };
  const z = zoomToward(t, a, 0.5);
  assert.deepEqual(z, { x: 60, z: 55 });
  assert.deepEqual(zoomToward(t, a, 1), t);
});

// ---------------------------------------------------------------------------------------------------
test('ground: the farm is flat, the river runs below the water line, the hills rise outside', () => {
  for (let x = FARM_MIN * TILE_M; x <= FARM_MAX * TILE_M; x += 4) {
    for (let z = FARM_MIN * TILE_M; z <= FARM_MAX * TILE_M; z += 4) assert.equal(heightAt(x, z), 0, `flat farm at ${x},${z}`);
  }
  for (let x = -40; x < 200; x += 10) assert.ok(heightAt(x, riverZ(x)) < WATER_Y - 1, `river bed at x ${x}`);
  assert.ok(heightAt(-60, 40) > 3, 'western hills');
  assert.ok(heightAt(60, -60) > 3, 'northern hills');
});

test('land: owned, for sale and later land per tile; the boundary is closed; one signpost per live parcel for sale', () => {
  const owned = ['home'];
  const t = landTiles(owned);
  const count = (v) => t.reduce((n, x) => n + (x === v ? 1 : 0), 0);
  const home = CONTENT.expansions.get('home');
  assert.equal(count(1), home.rects.reduce((n, r) => n + r[2] * r[3], 0));
  const liveForSale = [...CONTENT.expansions.values()].filter((e) => isLive(e) && !owned.includes(e.id));
  assert.equal(count(2), liveForSale.reduce((n, e) => n + e.rects.reduce((m, r) => m + r[2] * r[3], 0), 0));
  assert.equal(count(1) + count(2) + count(3), (FARM_MAX - FARM_MIN) ** 2, 'every farmable tile is classified');
  // the fence: every corner of the boundary has an even degree (a closed loop around the owned land)
  const edges = boundaryEdges(t);
  assert.equal(edges.length, 2 * (24 + 16), 'the homestead is a 24 x 16 rectangle');
  const deg = new Map();
  for (const [x0, z0, x1, z1] of edges) for (const k of [`${x0},${z0}`, `${x1},${z1}`]) deg.set(k, (deg.get(k) || 0) + 1);
  for (const [k, d] of deg) assert.equal(d % 2, 0, `corner ${k}`);
  // signs
  const signs = saleSigns(owned);
  assert.deepEqual(signs.map((s) => s.id).sort(), liveForSale.map((e) => e.id).sort());
  for (const s of signs) {
    const e = CONTENT.expansions.get(s.id);
    assert.ok(e.rects.some(([x, z, w, d]) => s.x > x && s.z > z && s.x < x + w && s.z < z + d), `${s.id} sign stands on its parcel`);
  }
  // buying a parcel moves its land to owned and its sign away
  const t2 = landTiles(['home', 'creekside']);
  assert.equal(t2.reduce((n, x) => n + (x === 1 ? 1 : 0), 0), count(1) + 8 * 16);
  assert.ok(!saleSigns(['home', 'creekside']).some((s) => s.id === 'creekside'));
});

// ---------------------------------------------------------------------------------------------------
const NOW = T0;
const plotWith = (crop, p, extra = {}) => {
  const c = cropOf(crop);
  return { def: 'plot', x: 20, z: 30, rot: 0, placedAt: NOW - 1e6, by: 'p1', cycle: 0,
    crop: { def: crop, plantedAt: NOW - c.growMs * p, readyAt: NOW + c.growMs * (1 - p), by: 'p1', cycle: 0, ...extra } };
};
const defOf = (id) => [...CONTENT.plots.values(), ...CONTENT.trees.values(), ...CONTENT.buildings.values(),
  ...CONTENT.landmarks.values(), ...CONTENT.decor.values(), ...CONTENT.homes.values(), ...CONTENT.animals.values()].find((d) => d.id === id);

test('object looks: plots show the crop stage, ready crops their last stage, wet and composted soil', () => {
  const plot = defOf('plot');
  assert.deepEqual(visualOf({ def: 'plot', x: 0, z: 0, rot: 0, crop: null }, plot, NOW).crop, null);
  const seeded = visualOf(plotWith('wheat', 0.01), plot, NOW);
  assert.equal(seeded.crop, 'crop:wheat:0');
  assert.equal(seeded.ready, false);
  assert.ok(seeded.nextAt > NOW, 'a growing crop schedules its next look');
  const ready = visualOf(plotWith('carrot', 1), plot, NOW);
  assert.equal(ready.crop, 'crop:carrot:3');
  assert.equal(ready.ready, true);
  assert.equal(ready.nextAt, null, 'a ready crop waits for the player, not the clock');
  assert.equal(visualOf(plotWith('corn', 0.5, { water: 'p1' }), plot, NOW).wet, true);
  assert.equal(visualOf(plotWith('corn', 0.5, { tend: 'p2' }), plot, NOW).wet, true, 'a partner tend wets the soil too');
  assert.equal(visualOf(plotWith('corn', 0.5), plot, NOW).wet, false);
  assert.equal(visualOf({ ...plotWith('corn', 0.5), compost: true }, plot, NOW).compost, true, 'compost lives on the plot');
  assert.equal(visualOf({ def: 'plot', x: 0, z: 0, rot: 0, crop: null, compost: true }, plot, NOW).compost, true);
  // the scheduled time is exactly when the look changes
  const o = plotWith('pumpkin', 0.2);
  const v = visualOf(o, plot, NOW);
  const before = visualOf(o, plot, v.nextAt - 1);
  const after = visualOf(o, plot, v.nextAt);
  assert.notEqual(before.crop, after.crop, 'nextAt is a stage boundary');
  assert.equal(visualOf(o, plot, NOW).crop, before.crop, 'nothing changes before it');
});

test('object looks: trees grow sapling -> young -> mature, ripen, and a chopped pine regrows from its stump', () => {
  const apple = defOf('apple_tree');
  const placed = NOW;
  const sap = apple.saplingCycles * apple.cycleMs;
  const tree = { def: 'apple_tree', x: 10, z: 10, rot: 0, placedAt: placed, by: 'p1', cycle: 0, startedAt: placed, readyAt: placed + sap };
  assert.equal(visualOf(tree, apple, placed + 1).state, 'sapling');
  assert.equal(visualOf(tree, apple, placed + sap * 0.75).state, 'young');
  assert.equal(visualOf(tree, apple, placed + sap * 0.25).nextAt, placed + sap / 2);
  const mature = { ...tree, startedAt: placed + sap, readyAt: placed + sap + apple.cycleMs };
  assert.equal(visualOf(mature, apple, placed + sap + 10).state, 'mature');
  const ripe = visualOf(mature, apple, placed + sap + apple.cycleMs);
  assert.equal(ripe.state, 'ready');
  assert.equal(ripe.ready, true);
  assert.equal(ripe.key, 'tree:apple_tree:ready');
  assert.equal(visualOf({ ...tree, mature: true, readyAt: NOW + 1000 }, apple, NOW).state, 'mature', 'a free mature tree skips the sapling years');
  const pine = defOf('pine');
  const chopped = { def: 'pine', x: 0, z: 0, rot: 0, placedAt: NOW - 1e9, cycle: 3, startedAt: NOW, readyAt: NOW + pine.cycleMs, mature: true };
  assert.equal(visualOf(chopped, pine, NOW + 1).state, 'stump');
  assert.equal(visualOf(chopped, pine, NOW + pine.cycleMs * 0.5).state, 'young');
  assert.equal(visualOf(chopped, pine, NOW + pine.cycleMs * 0.9).state, 'mature');
  assert.equal(visualOf(chopped, pine, NOW + pine.cycleMs).state, 'ready');
});

test('object looks: production buildings work, fill their tray and say so; the barn shows its upgrades', () => {
  const bakery = defOf('bakery');
  const o = { def: 'bakery', x: 0, z: 0, rot: 0, queue: [
    { r: 'bread', s: NOW - 60_000, e: NOW - 1000, by: 'p1' },
    { r: 'bread', s: NOW - 1000, e: NOW + 60_000, by: 'p1' },
    { r: 'cookies', s: NOW + 60_000, e: NOW + 120_000, by: 'p2' },
  ] };
  const v = visualOf(o, bakery, NOW);
  assert.equal(v.working, true);
  assert.equal(v.ready, true);
  assert.equal(v.done, 1);
  assert.equal(v.doneItem, 'bread');
  assert.equal(v.nextAt, NOW + 60_000, 'the next look change: the running item finishes');
  const idle = visualOf({ ...o, queue: [] }, bakery, NOW);
  assert.equal(idle.working, false);
  assert.equal(idle.ready, false);
  assert.equal(productOf('bread'), 'bread');
  assert.equal(staticKey('barn', 0), 'building:barn');
  assert.equal(staticKey('barn', 2), 'building:barn:2');
  assert.equal(staticKey('barn', 9), 'building:barn:3');
  assert.equal(visualOf({ def: 'chicken', home: 'h' }, defOf('chicken'), NOW), null, 'animals are drawn by animals-view');
});

test('the visual-change heap pops due ids in time order and nothing early', () => {
  const h = createHeap();
  const seen = [];
  for (const [at, id] of [[50, 'c'], [10, 'a'], [30, 'b'], [10, 'a2'], [70, 'd']]) h.push(at, id);
  assert.equal(h.peek(), 10);
  h.popDue(9, (id) => seen.push(id));
  assert.deepEqual(seen, []);
  h.popDue(30, (id, at) => seen.push(`${id}@${at}`));
  assert.deepEqual(seen.sort(), ['a2@10', 'a@10', 'b@30']);
  assert.equal(h.size, 2);
  h.popDue(Infinity, (id) => seen.push(id));
  assert.equal(h.size, 0);
});

test('fences join their neighbours; plot mounds are cheap and BatchedMesh-compatible', () => {
  const N = 64;
  const tiles = new Set([10 * N + 10, 10 * N + 11, 11 * N + 10]);
  assert.deepEqual(fenceLinks(tiles, 10, 10), { e: true, s: true, w: false, n: false });
  assert.deepEqual(fenceLinks(tiles, 11, 10), { e: false, s: false, w: true, n: false });
  const g = plotGeometry();
  assert.ok(g.getIndex().count / 3 <= 80, `${g.getIndex().count / 3} triangles per plot`);
  for (const a of ['position', 'normal', 'color', 'sway']) assert.ok(g.getAttribute(a), a);
  assert.ok(g.boundingBox.max.y < 0.2 && g.boundingBox.max.x <= 0.92 + 1e-6, 'a low mound inside its tile');
  assert.equal(hashId('plot.1'), hashId('plot.1'));
  assert.notEqual(hashId('plot.1'), hashId('plot.2'));
});

// ---------------------------------------------------------------------------------------------------
function farmState(objects, expansions = ['home']) {
  return { meta: { farmSeed: 1, tz: 'Europe/Sofia' }, farm: { expansions, objects }, players: {} };
}

test('objects view: crops change stage exactly when due, without polling, and ready crops twinkle', () => {
  const ready = models.ready;
  models.ready = () => new Promise(() => {});                 // keep placeholders: no GLB loading in Node
  try {
    let now = NOW;
    const twinkles = new Map();
    const fx = { twinkle: (k, p) => (p ? twinkles.set(k, p) : twinkles.delete(k)), burst() {} };
    const layers = Object.fromEntries(['ground', 'crops', 'objects'].map((n) => [n, new THREE.Group()]));
    const view = createObjectsView(layers, { fx, now: () => now });
    const c = cropOf('wheat');
    const objects = {
      a: { def: 'plot', x: 24, z: 30, rot: 0, placedAt: NOW, by: 'p1', cycle: 0, crop: { def: 'wheat', plantedAt: NOW, readyAt: NOW + c.growMs, by: 'p1', cycle: 0 } },
      b: { def: 'plot', x: 25, z: 30, rot: 0, placedAt: NOW, by: 'p1', cycle: 0, crop: null },
    };
    const state = farmState(objects);
    view.setState(state);
    assert.equal(view.inspect('a').cropKey, 'crop:wheat:0');
    assert.equal(view.inspect('b').cropKey, null);
    assert.equal(view.stats().scheduled, 1, 'only the growing crop is scheduled');
    const due = view.inspect('a').nextAt;
    now = due - 1;
    view.update(0.016, 1000);
    assert.equal(view.inspect('a').cropKey, 'crop:wheat:0', 'not a millisecond early');
    now = due;
    view.update(0.016, 1016);
    assert.equal(view.inspect('a').cropKey, 'crop:wheat:1', 'the stage changes when it comes due');
    now = NOW + c.growMs + 5;
    view.update(0.016, 1032);
    assert.equal(view.inspect('a').cropKey, 'crop:wheat:3');
    assert.equal(view.inspect('a').ready, true);
    assert.ok(twinkles.has('a#0') && twinkles.has('a#1') && twinkles.has('a#2'), 'a ready crop: three staggered glints (visual-05)');
    assert.equal(view.stats().scheduled, 0, 'nothing left to wait for');
    // harvest: the crop goes, the twinkle goes, the plot stays
    objects.a.crop = null;
    view.sync(['a'], new Set(['objects']), state);
    assert.equal(view.inspect('a').cropKey, null);
    assert.ok(![0, 1, 2].some((i) => twinkles.has(`a#${i}`)), 'harvested: the glints are gone');
    // a removed object leaves the view
    delete objects.b;
    view.sync(['b'], new Set(['objects']), state);
    assert.equal(view.inspect('b'), null);
    assert.equal(view.stats().soil, 1);
  } finally { models.ready = ready; }
});

test('objects view: picking proxies for tall objects follow rotation; fences auto-join', () => {
  const ready = models.ready;
  models.ready = () => new Promise(() => {});
  try {
    const layers = Object.fromEntries(['ground', 'crops', 'objects'].map((n) => [n, new THREE.Group()]));
    const view = createObjectsView(layers, { now: () => NOW });
    const objects = {
      barn: { def: 'cow_barn', x: 20, z: 30, rot: 1, placedAt: NOW, by: 'p1' },
      f1: { def: 'picket_fence', x: 30, z: 30, rot: 0, placedAt: NOW, by: 'p1' },
      f2: { def: 'picket_fence', x: 31, z: 30, rot: 0, placedAt: NOW, by: 'p1' },
      f3: { def: 'picket_fence', x: 33, z: 30, rot: 0, placedAt: NOW, by: 'p1' },
    };
    view.setState(farmState(objects));
    const p = view.proxies().find((q) => q.id === 'barn');
    assert.ok(p, 'the cow barn is tall enough for a proxy');
    // a 4 x 3 footprint turned once covers 3 x 4 tiles: x 20..23, z 30..34 (metres x2)
    assert.ok(p.box.min.x >= 20 * TILE_M - 0.01 && p.box.max.x <= 23 * TILE_M + 0.01, `x ${p.box.min.x}..${p.box.max.x}`);
    assert.ok(p.box.min.z >= 30 * TILE_M - 0.01 && p.box.max.z <= 34 * TILE_M + 0.01, `z ${p.box.min.z}..${p.box.max.z}`);
    assert.equal(view.inspect('f1').extra, 3, 'post + two rail sections toward its east neighbour');
    assert.equal(view.inspect('f2').extra, 1, 'the west neighbour owns the shared span');
    assert.equal(view.inspect('f3').key, 'decor:picket_fence', 'a lone piece is the full section');
  } finally { models.ready = ready; }
});

test('picking: animals win over the home they stand in, otherwise the nearest tall box', () => {
  const ray = new THREE.Ray(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0));
  const box = (id, x0, x1) => ({ id, box: new THREE.Box3(new THREE.Vector3(x0, 0, -1), new THREE.Vector3(x1, 3, 1)) });
  assert.equal(rayPick(ray, { proxies: [box('coop', -2, 2)], animals: [{ id: 'hen', x: 0, z: 0, r: 0.4, h: 0.7 }] }).id, 'hen');
  assert.equal(rayPick(ray, { proxies: [box('coop', -2, 2)], animals: [{ id: 'hen', x: 5, z: 0, r: 0.4, h: 0.7 }] }).id, 'coop');
  assert.equal(rayPick(ray, { proxies: [box('far', 3, 5)] }), null);
  const slanted = new THREE.Ray(new THREE.Vector3(-20, 20, 0), new THREE.Vector3(1, -1, 0).normalize());
  assert.equal(rayPick(slanted, { proxies: [box('back', 1, 3), box('front', -4, -2)] }).id, 'front', 'the box closer to the camera');
});

// ---------------------------------------------------------------------------------------------------
test('batches grow by doubling, swap keys in place and keep their bookkeeping', () => {
  assert.equal(grownCapacity(8, 9), 16);
  assert.equal(grownCapacity(8, 100), 128);
  const b = createBatch({ name: 't', material: new THREE.MeshBasicMaterial(), instances: 2, vertices: 64, indices: 128 });
  b.define('k:a', plotGeometry());
  b.define('k:b', plotGeometry());
  const m = new THREE.Matrix4();
  const hs = [];
  for (let i = 0; i < 5; i++) hs.push(b.add(i % 2 ? 'k:a' : 'k:b', m));
  assert.equal(b.count, 5);
  assert.ok(b.stats().maxInstances >= 5 && b.stats().maxVertices >= 2 * plotGeometry().getAttribute('position').count, 'capacity grew');
  b.setKey(hs[0], 'k:a');
  assert.equal(b.keyOf(hs[0]), 'k:a');
  b.remove(hs[1]);
  b.remove(hs[1]);                                             // twice is harmless
  assert.equal(b.count, 4);
  const again = b.add('k:a', m);
  assert.equal(b.count, 5);
  assert.equal(b.keyOf(again), 'k:a');
});

test('auto quality follows the GPU, not the frame interval: drop after 5 s over 12 ms, climb after 30 s under 6 ms (RD-26)', () => {
  const a = createAutoTier('high');
  let t = null;
  // a loaded CPU makes 33 ms frames, but the GPU takes 5 ms: the tier stays (the old interval tier dropped here)
  for (let i = 0; i < 30 * 60 && !t; i++) t = a.feed(5, 1 / 30);
  assert.equal(t, null, 'GPU headroom: no downgrade whatever the frame rate');
  let secs = 0;
  for (let i = 0; i < 400 && !t; i++) { t = a.feed(14, 1 / 30); secs += 1 / 30; }
  assert.equal(t, 'medium');
  assert.ok(secs >= 5 && secs < 6.5, `dropped after ${secs.toFixed(2)} s over budget`);
  for (let i = 0; i < 400 && a.tier !== 'low'; i++) a.feed(20, 1 / 30);
  assert.equal(a.tier, 'low');
  assert.equal(a.feed(40, 5), null, 'nothing below low');
  let up = null;
  for (let i = 0; i < 60 * 60 && !up; i++) up = a.feed(3, 1 / 30);
  assert.equal(up, null, 'medium failed here once: no ping-pong back up');
  const b = createAutoTier('low');
  let climbed = null;
  secs = 0;
  for (let i = 0; i < 60 * 60 && !climbed; i++) { climbed = b.feed(4, 1 / 30); secs += 1 / 30; }
  assert.equal(climbed, 'medium', 'a GPU at < 6 ms for 30 s climbs a tier');
  assert.ok(secs >= 30 && secs < 32, `climbed after ${secs.toFixed(1)} s`);
  assert.equal(b.feed(Number.NaN, 1), null, 'garbage times are ignored');
  // a long idle gap between two frames is not 10 s over budget
  const c = createAutoTier('high');
  for (let i = 0; i < 10; i++) c.feed(15, 1 / 30);
  assert.equal(c.feed(15, 10), null, 'one gap counts at most 0.25 s');
  // the fallback without a timer: only a sustained sub-30 fps drops, and never climbs
  const f = createIntervalTier('high');
  let ft = null;
  for (let i = 0; i < 60 * 30 && !ft; i++) ft = f.feed(25, 1 / 40);
  assert.equal(ft, null, '40 fps on a busy machine keeps the tier');
  for (let i = 0; i < 60 * 30 && !ft; i++) ft = f.feed(45, 1 / 22);
  assert.equal(ft, 'medium');
  for (const q of Object.values(QUALITY)) assert.ok(q.ambientFps <= 30 && q.pixelRatio <= 1.25);
});

test('auto quality: one contended session never sticks; two in a row do; an explicit tier is honoured', () => {
  const store = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    assert.equal(loadTier('auto'), 'high');
    noteAutoTier('low');
    assert.equal(loadTier('auto'), 'high', 'a downgrade from one session is not persisted');
    assert.equal(loadTier('medium'), 'medium', 'an explicit ?quality= wins');
    assert.equal(loadTier('high'), 'high');
  } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
});

test('frame pacing: the cap is decided before any work; a dirty static farm shows within one ambient frame (RD-01/02)', () => {
  const base = { input: false, feedback: false, lastWant: 1, dirty: false, blurred: false, ambientFps: 30, interactiveFps: 60 };
  assert.equal(capFps(base), 30, 'ambient life: the tier cap');
  assert.equal(capFps({ ...base, lastWant: 2 }), 60, 'feedback in flight: interactive');
  assert.equal(capFps({ ...base, lastWant: 0 }), LOOP.pollFps, 'static: a slow poll for time-driven changes');
  assert.equal(capFps({ ...base, lastWant: 0, dirty: true }), 30, 'a store change does not wait for the poll');
  assert.equal(capFps({ ...base, blurred: true }), 10, 'a blurred window: 10 fps');
  assert.equal(capFps({ ...base, blurred: true, lastWant: 2 }), 10, 'feedback in a blurred window: still 10 fps');
  assert.equal(capFps({ ...base, blurred: true, input: true }), 60, 'the player\'s own input is never capped');
});

test('frame pacing on a 144 Hz display: ticks and renders at the cap, dt in wall time (RD-02, performance-05)', () => {
  let cb = null;
  const renderer = { setAnimationLoop: (fn) => { cb = fn; } };
  const prevPerf = globalThis.performance;
  let wants = 1;
  let ticks = 0; let renders = 0; let walked = 0;
  const stop = startLoop({ renderer, want: () => { ticks++; return wants; }, frame: (dt) => { renders++; walked += dt * 3; },
    isDirty: () => false, clearDirty: () => {}, blurred: () => false, ambientFps: () => 30, interactiveFps: () => 60 });
  for (let i = 0; i < 144 * 4; i++) cb(1000 + i * (1000 / 144));      // 4 s of a 144 Hz display, ambient
  assert.ok(ticks >= 4 * 27 && ticks <= 4 * 31, `ambient: ${ticks} ticks in 4 s (a frame that will not render does no work)`);
  assert.equal(renders, ticks);
  assert.ok(Math.abs(walked - 4 * 3) < 0.35, `walking at 3 tiles/s covers ${walked.toFixed(2)} tiles in 4 s (was 36 %)`);
  ticks = 0; renders = 0; walked = 0; wants = 2;
  for (let i = 0; i < 144 * 4; i++) cb(5000 + i * (1000 / 144));
  assert.ok(renders >= 4 * 54 && renders <= 4 * 61, `interactive: ${renders} renders in 4 s`);
  assert.ok(Math.abs(walked - 12) < 0.4, `interactive walk ${walked.toFixed(2)} tiles in 4 s`);
  ticks = 0; renders = 0; wants = 0;
  for (let i = 0; i < 144 * 4; i++) cb(12000 + i * (1000 / 144));
  assert.ok(ticks <= 4 * LOOP.pollFps + 2 && renders <= 1, `static and clean: ${ticks} polls, ${renders} renders`);
  void stop; void prevPerf;
});

test('particles: ambient life (smoke, petals, rain, snow) never asks for the interactive rate (RD-01)', () => {
  const pools = [{ aliveUntil: 0, ambientUntil: 10 }, { aliveUntil: 0, ambientUntil: 0 }];
  assert.equal(particleWant(pools, 5), 1, 'only ambient particles alive: the ambient cap');
  assert.equal(particleWant([{ aliveUntil: 6, ambientUntil: 10 }], 5), 2, 'a harvest burst: interactive');
  assert.equal(particleWant(pools, 11), 0, 'all dead: idle');
  assert.equal(particleWant(pools, 11, { twinkles: 4 }), 1, 'ripe glints: ambient');
  assert.equal(particleWant(pools, 11, { twinkles: 4, motion: 'still' }), 0, 'Still: glints do not animate');
  assert.equal(particleWant(pools, 11, { busy: true }), 2, 'a produce pop in flight');
});

test('water pins and ripe glints: who sees which pin, three staggered glints (RD-08, RD-15)', () => {
  const dry = { thirsty: true, tendBy: null };
  assert.equal(waterPin(dry, 'p1'), 'need');
  assert.equal(waterPin(dry, 'p1', true), null, 'no pins while it rains');
  assert.equal(waterPin({ thirsty: false, tendBy: 'p1' }, 'p1'), null, 'I watered it: my own tend is not allowed (R17)');
  assert.equal(waterPin({ thirsty: false, tendBy: 'p1' }, 'p2'), 'tend', 'Mia watered it: my tend still adds 5 %');
  assert.equal(waterPin({ thirsty: false, tendBy: 'sys' }, 'p2'), 'tend', 'the rain or a Sprinkler watered it: either can tend');
  assert.equal(waterPin({ thirsty: false, tendBy: null }, 'p1'), null);
  const g = glintsOf(123456, 1.2);
  assert.equal(g.length, 3);
  assert.ok(g[0].size > g[1].size && g[1].size === g[2].size, 'a lead glint and two small ones');
  assert.ok(Math.abs(((g[1].phase - g[0].phase + 1) % 1) - 0.33) < 1e-9, 'staggered by a third of a beat');
  assert.ok(g.every((x) => x.color === '#FFE6A0'), 'warm cream for every crop, never the crop hue (QA wave 2 RD-09)');
  assert.ok(g[0].size <= 0.45 && g[1].size <= 0.2, 'RD-09: the lead glint 50-65 % smaller (was 0.9), the others tiny motes');
  assert.equal(glintsOf(1, 1, true)[0].color, '#FFD84A', 'golden seeds keep their gold');
  // visualOf marks thirsty crops: >= 30 min, unwatered, not ripe
  const c = cropOf('potato');
  const plot = { def: 'plot', x: 1, z: 1, rot: 0, crop: { def: 'potato', plantedAt: NOW, readyAt: NOW + c.growMs, by: 'p1', cycle: 0 } };
  assert.ok(c.growMs >= 30 * 60_000);
  assert.equal(visualOf(plot, { kind: 'plot', id: 'plot' }, NOW + 1).thirsty, true);
  const wet = { ...plot, crop: { ...plot.crop, water: 'p1' } };
  assert.equal(visualOf(wet, { kind: 'plot', id: 'plot' }, NOW + 1).tendBy, 'p1');
  const wheat = { ...plot, crop: { def: 'wheat', plantedAt: NOW, readyAt: NOW + cropOf('wheat').growMs, by: 'p1', cycle: 0 } };
  assert.equal(visualOf(wheat, { kind: 'plot', id: 'plot' }, NOW + 1).thirsty, false, 'the fast loop has no water click tax');
});

test('door props: only on free owned tiles beside the door, never in front of it (RD-23)', () => {
  const def = { size: [3, 3], kind: 'building' };
  for (let rot = 0; rot < 4; rot++) {
    const o = { x: 10, z: 10, rot };
    const all = doorProps(o, def, 0xdeadbeef, () => true);
    assert.ok(all.length >= 3 && all.length <= 5, `rot ${rot}: ${all.length} props`);
    for (const p of all) {
      const tx = Math.floor(p.x / TILE_M); const tz = Math.floor(p.z / TILE_M);
      assert.ok(!(tx >= 10 && tx < 13 && tz >= 10 && tz < 13), 'never inside the footprint');
      const doorTile = [[11, 13], [13, 11], [11, 9], [9, 11]][rot];
      assert.ok(!(tx === doorTile[0] && tz === doorTile[1]), `rot ${rot}: the door stays clear`);
    }
    assert.deepEqual(doorProps(o, def, 0xdeadbeef, () => true), all, 'deterministic on both screens');
  }
  assert.equal(doorProps({ x: 10, z: 10, rot: 0 }, def, 7, () => false).length, 0, 'no free tile: no props');
});

test('screen-stable badges and need bubbles (RD-09, RD-11)', () => {
  const px = (dist, scale = 1) => (badgeSize(dist, scale) * 900) / (2 * dist * Math.tan((CAM.fov / 2) * Math.PI / 180));
  // QA wave 2 RD-09: ~58 px (40 % less area than the old ~75 px), never under a 44 px target
  for (const d of [18, 35, 55, 70]) assert.ok(px(d) >= 44 && px(d) <= 66, `${px(d).toFixed(0)} px at ${d} m`);
  assert.ok(px(90) >= 44, 'still readable zoomed out');
});

test('the sky clock starts at the farm\'s birth: a new farm opens in morning light (RD-04)', () => {
  for (const createdAt of [T0, T0 + 17 * 60_000, T0 + 36 * 60_000]) {
    const p = phaseAt(skyClock(createdAt, createdAt));
    assert.equal(p.phase, 'day', `a farm created at ${createdAt} opens in the day`);
    assert.ok(p.k < 0.05);
  }
  assert.equal(skyClock(5, undefined), 5, 'no state yet: the shared epoch clock');
  // night stays >= 60 % as bright as noon (lights: sun + hemisphere, times exposure)
  const base = Math.floor(T0 / CYCLE.total) * CYCLE.total;
  const lum = (s) => (s.sunI * 0.6 + s.hemiI) * s.exposure;
  assert.ok(lum(skyAt(base + 37 * 60_000)) >= 0.6 * lum(skyAt(base + 13 * 60_000)), 'never dark');
});

test('the forest frames the clearing: it starts at the land the farm can own, the land for sale is overgrown (RD-03)', () => {
  const rects = liveRects();
  const N = 64;
  const near = (x, z) => liveUnionDist(x, z, rects);
  // inside a live expansion: no forest; just outside (2.5-14 m): the tall edge rows
  assert.equal(forestSpot(40 * TILE_M, 30 * TILE_M, rects), null, 'never on land the farm can own');
  // 6 m west of the live land's west edge, along the farm (the edge moves west as milestones add parcels; the M2 Willow
  // Pond and its land features take part of that edge, so look along it)
  const westEdges = [];
  for (let z = 40; z < 112; z += 4) {
    const xs = rects.filter((r) => z >= r[1] && z < r[3]).map((r) => r[0]);
    if (xs.length) westEdges.push(forestSpot(Math.min(...xs) - 6, z, rects));
  }
  assert.ok(westEdges.some((sp) => sp && sp.row === 'edge'), 'trees 6 m west of the live land');
  for (let x = -40; x < 170; x += 7) for (let z = -40; z < 112; z += 7) {
    const sp = forestSpot(x, z, rects);
    if (sp) assert.ok(near(x, z) >= 2.5, 'a setback from the live land');
  }
  // every owned edge has trees within 14 m (on sale land or in the forest)
  const owned = ['home'];
  const land = landTiles(owned);
  const signs = saleSigns(owned);
  const wild = wildOnSale(land, signs, () => 'x');
  assert.ok(wild.length > 20, `overgrowth on the land for sale (${wild.length})`);
  for (const w of wild) {
    const tx = Math.floor(w.x / TILE_M); const tz = Math.floor(w.z / TILE_M);
    assert.equal(land[tz * N + tx], 2, 'only on land for sale');
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) assert.notEqual(land[(tz + dz) * N + tx + dx], 1, '2 tiles clear of the fence');
  }
  // buying a parcel clears its overgrowth
  const bought = wildOnSale(landTiles(['home', 'creekside']), saleSigns(['home', 'creekside']), () => 'x');
  const onCreek = (w) => w.x >= 40 * TILE_M && w.x < 48 * TILE_M && w.z >= 24 * TILE_M && w.z < 40 * TILE_M;
  assert.ok(wild.some(onCreek) && !bought.some(onCreek), 'the creekside trees go when it is bought');
  // the lawn palette is a meadow, not neon (visual-02: HSV saturation <= 0.55)
  for (const hex of [LAWN.grassLit, LAWN.grassVar, LAWN.meadow]) {
    const c = new THREE.Color(hex);
    const max = Math.max(c.r, c.g, c.b); const min = Math.min(c.r, c.g, c.b);
    const srgb = new THREE.Color(hex).convertLinearToSRGB();
    const smax = Math.max(srgb.r, srgb.g, srgb.b); const smin = Math.min(srgb.r, srgb.g, srgb.b);
    assert.ok((smax - smin) / smax <= 0.6, `${hex} saturation ${((smax - smin) / smax).toFixed(2)}`);
    void max; void min;
  }
});

test('small pure helpers: eased hands of wind, badge atlas keys, seasons', () => {
  assert.equal(easeToward(0, 10, 8, 0), 0);
  assert.ok(Math.abs(easeToward(0, 10, 8, 10) - 10) < 1e-9);
  const a = easeToward(0, 10, 8, 0.1);
  const b = easeToward(easeToward(0, 10, 8, 0.05), 10, 8, 0.05);
  assert.ok(Math.abs(a - b) < 1e-9, 'frame-rate independent');
  assert.equal(slotKey('bread', 'ready', 1), 'bread|ready|0');
  assert.equal(slotKey('bread', 'full', 3), 'bread|full|3');
  assert.equal(slotKey('egg', 'bogus'), 'egg|ready|0');
  assert.deepEqual(Object.keys(SEASON_INDEX), ['spring', 'summer', 'autumn', 'winter']);
});
