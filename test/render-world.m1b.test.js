// render-world, wave 2 (M1b): the world places and what they read from the state (pure, deterministic, no DOM):
// the barge's schedule and crates, the Fair's medal pennant and fireworks, the village's landmarks, the restoration
// stages and the Hollow Meadow, giant-crop blocks, Farm Beauty, the decor-set glow, the quiet water pins, the
// grouped door props, world-place picking and the terrain the places stand on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT, T0 } from './helpers.js';
import { CONTENT, cropOf, isLive, levelFromXp } from '../shared/content/index.js';
import { TILE_M, FARM_MIN, FARM_MAX } from '../shared/content/config.js';
import { setManifest } from '../public/js/render/assets.js';
import { models } from '../public/js/render/models.js';
import * as WS from '../public/js/render/world-state.js';
import { bargePose } from '../public/js/render/barge-view.js';
import { JETTY } from '../public/js/render/river.js';
import { fireworksOn, medalColor, FAIR_LAYOUT } from '../public/js/render/fair-view.js';
import { TOWN_SLOTS, COTTAGES } from '../public/js/render/town-view.js';
import { SITES, greenhouseGeometry, millGeometry, stoneBridgeGeometry, wheelGeometry } from '../public/js/render/restoration-view.js';
import { heightAt, riverZ, riverHalf, laneZ, PLACES, padDist, padMask, landTiles, WATER_Y } from '../public/js/render/ground.js';
import { forestSpot } from '../public/js/render/scene.js';
import { liveRects } from '../public/js/render/ground.js';
import { placeAt, createPicker } from '../public/js/render/picking.js';
import { createObjectsView, doorProps } from '../public/js/render/objects-view.js';
import { merge, box, flag } from '../public/js/render/world-kit.js';

setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8')));

const TZ = 'Europe/Sofia';
const MON_0600 = Date.UTC(2026, 9, 5, 3, 0, 0);          // Monday 5 October 2026, 06:00 in Sofia (UTC+3)
const H = 3_600_000;
const lvl = (n) => CONTENT.levels[Math.min(n, CONTENT.levels.length) - 1].xp;
const farm = (extra = {}, level = 22) => ({ meta: { farmSeed: 1, tz: TZ, createdAt: T0 }, farm: { xp: lvl(level), expansions: ['home'], objects: {}, ...extra }, players: {} });
/** Preview M1b content (the game's MILESTONE may still be M1a while the rules lanes land). */
function m1b(fn) {
  WS.setLivePredicate((d) => !d.m || ['M1a', 'M1b'].includes(d.m));
  try { return fn(); } finally { WS.setLivePredicate(null); }
}

// ---------------------------------------------------------------------------------------------------
test('the farm week clock: Monday 06:00 in the farm zone, whatever the machine zone', () => {
  assert.equal(WS.localWeekMs(MON_0600, TZ), 6 * H);
  assert.equal(WS.localWeekMs(MON_0600 - 7 * H, TZ), 6 * 24 * H + 23 * H, 'Sunday 23:00');
  assert.equal(WS.localWeekMs(MON_0600, 'UTC'), 3 * H, 'the same instant is 03:00 in UTC');
});

test('Captain Reed docks Monday 06:00 and casts off Sunday 20:00 (GDD §5.7); in between the barge sails', () => {
  assert.equal(WS.bargeAt(MON_0600 - 60_000, TZ).phase, 'away', 'Monday 05:59: not yet');
  const a = WS.bargeAt(MON_0600 + 10_000, TZ);
  assert.equal(a.phase, 'arriving');
  assert.ok(Math.abs(a.k - 10_000 / WS.BARGE_MOVE.arriveMs) < 1e-9);
  assert.equal(WS.bargeAt(MON_0600 + H, TZ).phase, 'docked');
  const castOff = MON_0600 + 6 * 24 * H + 14 * H;        // Sunday 20:00
  assert.equal(WS.bargeAt(castOff - 1000, TZ).phase, 'docked');
  assert.equal(WS.bargeAt(castOff + 1000, TZ).phase, 'leaving');
  assert.equal(WS.bargeAt(castOff + WS.BARGE_MOVE.leaveMs + 1, TZ).phase, 'away');
});

test('the barge view: loaded crates from farm.barge.crates; live only with the feature (nothing unsupported reachable)', () => {
  const s = farm({ barge: { w: 1, rows: 2, crates: { 0: { item: 'bread', qty: 4, by: 'p1' }, 1: { item: 'jam', qty: 2, by: null }, 4: { item: 'milk', qty: 6, by: 'p2' } } } });
  const live = m1b(() => WS.bargeView(s, MON_0600 + H));
  assert.equal(live.live, true);
  assert.equal(live.phase, 'docked');
  assert.equal(live.crates.filter((c) => c.loaded).length, 2);
  assert.deepEqual(live.crates.map((c) => c.row), [0, 0, 1], 'row = floor(i / 3)');
  const before = m1b(() => WS.bargeView(farm({}, 14), MON_0600 + H));
  assert.equal(before.live, false, 'L14: the barge is not part of the farm yet');
  assert.equal(before.phase, 'away');
  if (!isLive(CONTENT.features.get('barge'))) assert.equal(WS.bargeView(s, MON_0600 + H).live, false, 'this milestone has no barge');
});

test('the barge sails in to the jetty, rides at its mooring, swings round and sails away west', () => {
  const m = JETTY.mooring;
  const docked = bargePose({ phase: 'docked', k: 1 }, m, 0);
  assert.equal(docked.visible, true);
  assert.ok(Math.abs(docked.x - m.x) < 1e-9 && Math.abs(docked.z - m.z) < 1e-9);
  const end = bargePose({ phase: 'arriving', k: 1 }, m, 0);
  assert.ok(Math.abs(end.x - m.x) < 1e-6 && Math.abs(end.z - m.z) < 1e-6 && Math.abs(end.yaw) < 1e-6, 'arrival ends exactly at the mooring, bow along the jetty');
  const start = bargePose({ phase: 'arriving', k: 0 }, m, 0);
  assert.ok(start.x < m.x - 100, 'it comes from far upstream');
  const turn = bargePose({ phase: 'leaving', k: 0.25 }, m, 0);
  assert.ok(Math.abs(turn.yaw - Math.PI) < 1e-6, 'bow to the west after the swing');
  assert.equal(bargePose({ phase: 'away', k: 0 }, m, 0).visible, false);
  // always on the water: the path never leaves the river
  for (let k = 0; k <= 1; k += 0.05) {
    for (const phase of ['arriving', 'leaving']) {
      const p = bargePose({ phase, k }, m, 0);
      if (!p.visible) continue;
      assert.ok(Math.abs(p.z - riverZ(p.x)) < riverHalf(p.x) - 1.8, `${phase} ${k.toFixed(2)}: in the channel (x ${p.x.toFixed(1)})`);
    }
  }
  assert.ok(heightAt(m.x, m.z) < WATER_Y - 0.8, 'the mooring is deep water');
  assert.ok(heightAt(JETTY.x, JETTY.z1) < WATER_Y, 'the jetty reaches the water');
});

test('the Fair pennant flies the medal reached this week (points x10 / W); fireworks for ten minutes at the ceremony', () => {
  const at = (p, W = 400) => m1b(() => WS.fairView(farm({ fair: { cur: { w: 1, W, p, ent: { pie: 3 }, open: true }, last: null } }), MON_0600 + H));
  assert.equal(at(0).medal, null, 'no points: no medal yet');
  assert.equal(at(800).medal.id, 'bronze1', '80 points of 400 = 20 %: Bronze I');
  assert.equal(at(2400).medal.rank, 'silver', '60 %: Silver');
  assert.equal(at(4000).medal.id, 'gold2', '100 %: Gold II');
  assert.ok(at(9000).medal.rank !== 'platinum', 'Platinum needs the Town Fair Grounds (M2)');
  assert.equal(at(800).entries, 3);
  assert.notEqual(medalColor('gold'), medalColor('silver'));
  const close = MON_0600 + 6 * 24 * H + 14 * H;
  assert.equal(fireworksOn(close - 1000, TZ), false);
  assert.equal(fireworksOn(close + 60_000, TZ), true);
  assert.equal(fireworksOn(close + 11 * 60_000, TZ), false);
  const v = m1b(() => WS.fairView(farm({ fair: { cur: null, last: { w: 1, medal: 'silver1', at: close } } }), close + 1000));
  assert.equal(v.ceremonyAt, close);
  assert.equal(m1b(() => WS.fairView(farm({}, 13), MON_0600)).live, false, 'L13: the Fair is not open yet');
});

test('the Hollow Village: landmarks of built Town Projects, a scaffold while one waits for tomorrow', () => {
  const v = m1b(() => WS.townView(farm({ town: { n: 2, cur: { id: 'bandstand', n: 3, buildAt: MON_0600 + 2 * H } } }), MON_0600));
  assert.deepEqual(v.built.map((b) => b.id), ['ferry_landing', 'chapel']);
  assert.equal(v.building.id, 'bandstand');
  const later = m1b(() => WS.townView(farm({ town: { n: 2, cur: { id: 'bandstand', n: 3, buildAt: MON_0600 + 2 * H } } }), MON_0600 + 3 * H));
  assert.deepEqual(later.built.map((b) => b.id), ['ferry_landing', 'chapel', 'bandstand'], 'the landmark shows the moment buildAt passes');
  assert.equal(later.building, null);
  // every landmark has its own dry spot, clear of the cottages and of the main street
  for (const [id, [x, z]] of Object.entries(TOWN_SLOTS)) {
    if (id !== 'ferry_landing') assert.ok(heightAt(x, z) > WATER_Y + 0.12, `${id} stands on land`);
    // the M1b landmarks have their own ground; a later one takes a cottage's spot (the cottage gives way when it is built)
    if (CONTENT.townProjects.get(id).m === 'M1b') for (const [cx, cz] of COTTAGES) assert.ok(Math.hypot(cx - x, cz - z) >= 7, `${id} clear of the cottage at ${cx},${cz}`);
    assert.ok(Math.abs(x - 64) > 4 || z > 186, `${id} keeps the main street over the bridge clear`);
  }
  for (const p of CONTENT.townProjects.values()) assert.ok(TOWN_SLOTS[p.id], `a spot for ${p.id}`);
});

test('restoration stages: bundles finished (b: { bundle: at }), 4 when done; the Stone Bridge brings the Hollow Meadow', () => {
  const s = farm({ restore: { greenhouse: { s: {}, b: { seedlings: T0, glass: T0 } }, mill_wheel: { s: {}, b: {} }, stone_bridge: { s: {}, b: { timber: T0, woolly: T0, sweet: T0, fair_prizes: T0 }, done: T0 } } });
  const v = m1b(() => WS.restorationView(s, T0 + 1));
  const by = Object.fromEntries(v.map((p) => [p.id, p]));
  assert.equal(by.greenhouse.stage, 2);
  assert.equal(by.mill_wheel.stage, 0);
  assert.equal(by.stone_bridge.stage, 4);
  assert.equal(by.greenhouse.live, true, 'L22: the Ledger is open');
  assert.equal(m1b(() => WS.restorationView(farm({}, 15), T0)).every((p) => !p.live), true, 'L15: the ruins are scenery only');
  assert.equal(WS.meadowOwned(s), true);
  const land = landTiles(['home'], undefined, m1b(() => WS.rewardLandRects(s)));
  const [mx, mz] = CONTENT.restoration.get('stone_bridge').reward.land.rects[0];
  assert.equal(land[(mz + 2) * 64 + mx + 2], 1, 'the meadow is farm land');
  assert.equal(landTiles(['home'], undefined, WS.rewardLandRects(farm({})))[(mz + 2) * 64 + mx + 2], 0, 'not before');
  // stand-in geometry exists for every stage, with the canonical attribute set
  for (let st = 0; st <= 4; st++) {
    for (const g of [greenhouseGeometry(st), millGeometry(st), stoneBridgeGeometry(st)]) {
      for (const a of ['position', 'normal', 'color', 'sway']) assert.ok(g.getAttribute(a), `${a} at stage ${st}`);
      assert.ok(g.getAttribute('position').count / 3 < 6000, 'a stand-in stays within the building budget');
    }
  }
  assert.ok(wheelGeometry(true).getAttribute('position').count < wheelGeometry(false).getAttribute('position').count, 'the ruined wheel lost paddles');
});

test('giant crops: the nine plots of a block (crop.giant = anchorId) become one 3 x 3 giant', () => {
  const objects = {};
  const c = cropOf('pumpkin');
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
    const id = `p${dx}${dz}`;
    objects[id] = { def: 'plot', x: 20 + dx, z: 30 + dz, rot: 0, cycle: 0, crop: { def: 'pumpkin', plantedAt: T0, readyAt: T0 + c.growMs, by: 'p1', cycle: 0, giant: 'p00' } };
  }
  objects.other = { def: 'plot', x: 24, z: 30, rot: 0, cycle: 0, crop: { def: 'pumpkin', plantedAt: T0, readyAt: T0 + c.growMs, by: 'p1', cycle: 0 } };
  const g = WS.giantBlocks({ farm: { objects } }, T0 + 1);
  assert.equal(g.size, 1);
  const b = g.get('p00');
  assert.equal(b.ids.length, 9);
  assert.equal(b.x, 20); assert.equal(b.z, 30);
  assert.equal(b.ready, false);
  assert.equal(WS.giantBlocks({ farm: { objects } }, T0 + c.growMs + 1).get('p00').ready, true);
});

test('the objects view draws a giant as one bed and one plant; the members leave their own mounds', () => {
  const ready = models.ready;
  models.ready = () => new Promise(() => {});
  try {
    const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
    const view = createObjectsView(layers, { now: () => T0 + 1 });
    const objects = {};
    const c = cropOf('pumpkin');
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
      objects[`p${dx}${dz}`] = { def: 'plot', x: 20 + dx, z: 30 + dz, rot: 0, cycle: 0, placedAt: T0, by: 'p1', crop: { def: 'pumpkin', plantedAt: T0, readyAt: T0 + c.growMs, by: 'p1', cycle: 0, giant: 'p00' } };
    }
    view.setState({ meta: { farmSeed: 1, tz: TZ }, farm: { expansions: ['home'], objects }, players: {} });
    assert.equal(view.stats().soil, 1, 'one 3 x 3 bed for nine plots');
    assert.equal(view.stats().crops, 1, 'one giant plant');
  } finally { models.ready = ready; }
});

test('quiet water pins: a summary drop per thirsty field; per-plot pins only with the Watering Can (visual-after A6)', () => {
  const ready = models.ready;
  models.ready = () => new Promise(() => {});
  try {
    const set = new Map();
    const badges = { set: (k, b) => (b ? set.set(k, b) : set.delete(k)), update() { return 0; }, count: 0 };
    const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
    const view = createObjectsView(layers, { badges, now: () => T0 + 1 });
    const c = cropOf('pumpkin');
    assert.ok(c.growMs >= 30 * 60_000);
    const objects = {};
    for (let i = 0; i < 6; i++) objects[`a${i}`] = { def: 'plot', x: 20 + (i % 3), z: 30 + Math.floor(i / 3), rot: 0, cycle: 0, placedAt: T0, by: 'p1', crop: { def: 'pumpkin', plantedAt: T0, readyAt: T0 + c.growMs, by: 'p1', cycle: 0 } };
    objects.lone = { def: 'plot', x: 30, z: 36, rot: 0, cycle: 0, placedAt: T0, by: 'p1', crop: { def: 'pumpkin', plantedAt: T0, readyAt: T0 + c.growMs, by: 'p1', cycle: 0 } };
    view.setState({ meta: { farmSeed: 1, tz: TZ }, farm: { expansions: ['home'], objects }, players: {} });
    view.update(0.016, 1000);
    const pins = () => [...set.keys()].filter((k) => k.endsWith('#w'));
    const fields = () => [...set.keys()].filter((k) => k.startsWith('field#'));
    assert.equal(pins().length, 0, 'no per-plot pins with the Hand');
    assert.equal(fields().length, 2, 'one drop for the six-plot field, one for the lone plot');
    view.setTool('watering_can');
    view.update(0.016, 1100);
    assert.equal(pins().length, 7, 'the can shows every dry crop');
    assert.equal(fields().length, 0);
    assert.ok(set.get('a0#w').scale <= 0.3, '~18 px pins');
    view.setTool('hand');
    view.hover('a1');
    view.update(0.016, 1200);
    assert.deepEqual(pins(), ['a1#w'], 'the hovered crop shows its own pin');
    view.setRaining(true);
    view.update(0.016, 1300);
    assert.equal(fields().length + pins().length, 0, 'no pins in the rain');
  } finally { models.ready = ready; }
});

test('door props: one working corner per building, its goods piled together (visual-after A3)', () => {
  const def = { size: [3, 3], kind: 'building', id: 'dairy' };
  for (let rot = 0; rot < 4; rot++) {
    const all = doorProps({ x: 10, z: 10, rot }, def, 0x5eed1, () => true);
    assert.ok(all.length >= 3 && all.length <= 5);
    const tiles = new Set(all.map((p) => `${Math.floor(p.x / TILE_M)},${Math.floor(p.z / TILE_M)}`));
    assert.equal(tiles.size, 1, `rot ${rot}: one tile, one pile`);
    assert.ok(all.filter((p) => p.key === 'prop:milk_can').length >= 2, 'the dairy keeps its milk cans by the door');
  }
});

test('world-place picking: the nearest LIVE place the ray meets', () => {
  const ray = new THREE.Ray(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, -1, 0));
  const box = (x0, x1) => new THREE.Box3(new THREE.Vector3(x0, 0, -1), new THREE.Vector3(x1, 5, 1));
  assert.equal(placeAt(ray, [{ place: 'fair', box: box(-1, 1), live: false }]), null, 'a place before its level is scenery');
  const hit = placeAt(ray, [{ place: 'fair', box: box(-1, 1), live: true, args: { a: 1 } }, { place: 'barge', box: box(5, 6), live: true }]);
  assert.equal(hit.place, 'fair');
  assert.deepEqual(hit.args, { a: 1 });
  // through the picker: a tile pick under a place carries it
  const cam = new THREE.PerspectiveCamera(30, 1, 1, 900);
  cam.position.set(PLACES.fair.x, 60, PLACES.fair.z + 0.01); cam.lookAt(PLACES.fair.x, 0, PLACES.fair.z); cam.updateMatrixWorld();
  const pick = createPicker(cam, { places: () => [{ place: 'fair', args: {}, box: new THREE.Box3(new THREE.Vector3(PLACES.fair.x - 5, 0, PLACES.fair.z - 5), new THREE.Vector3(PLACES.fair.x + 5, 6, PLACES.fair.z + 5)), live: true }] });
  const p = pick(null, { x: 0, y: 0 });
  assert.equal(p.kind, 'tile');
  assert.equal(p.place, 'fair');
});

test('the places stand on flat cleared ground off the farm, the lane and the river', () => {
  const farm0 = FARM_MIN * TILE_M; const farm1 = FARM_MAX * TILE_M;
  const rects = liveRects(() => true);
  for (const [name, p] of Object.entries(PLACES)) {
    const [cx, cz] = p.pad;
    // (the mill stands down the bank so its wheel reaches the water: its landward half is flat)
    const fz = name === 'mill' ? cz + 1 : cz;
    assert.ok(Math.abs(heightAt(cx, fz)) < 0.05, `${name}: flat at its centre (${heightAt(cx, fz).toFixed(2)})`);
    assert.equal(forestSpot(cx, cz, rects), null, `${name}: no forest on its pad`);
    assert.ok(!(cx > farm0 && cx < farm1 && cz > farm0 && cz < farm1), `${name}: outside the farmable square`);
    assert.ok(padMask(cx, cz) === 1);
  }
  // the greenhouse (8 m deep) sits between the lane (2.5 m half-width) and the water
  const gh = SITES.greenhouse;
  assert.ok(gh.z - 4 > laneZ(gh.x) + 2.5, 'greenhouse: clear of the lane');
  assert.ok(heightAt(gh.x, gh.z) > WATER_Y + 0.3, 'greenhouse: on dry land');
  // the mill stands on the far bank facing the farm: its wheel (2.15 m out on the river side) turns in the water
  const ml = SITES.mill_wheel;
  assert.ok(heightAt(ml.x, ml.z - 2.15) < WATER_Y - 0.2, 'the mill wheel dips into the river');
  assert.ok(heightAt(ml.x, ml.z + 1.8) > WATER_Y + 0.3, 'the mill house stands on the bank');
  for (const [cx, cz] of COTTAGES) assert.ok(Math.hypot(cx - ml.x, cz - ml.z) > 7, 'no cottage on the mill');
  assert.ok(padDist(SITES.greenhouse.x, SITES.greenhouse.z, PLACES.greenhouse.pad) < 0);
  // the river is still a river everywhere (the greenhouse bend included)
  for (let x = -40; x < 200; x += 5) assert.ok(heightAt(x, riverZ(x)) < WATER_Y - 1, `river bed at x ${x}`);
  // the Fair grounds: the tent, the stalls and the arch on the pad
  for (const [x, z] of [FAIR_LAYOUT.tent, ...FAIR_LAYOUT.stalls, FAIR_LAYOUT.arch]) assert.ok(padDist(x, z, PLACES.fair.pad) < 0);
});

test('Farm Beauty and decor sets: the rules helpers when exported, a content estimate otherwise', () => {
  const objects = {
    f1: { def: 'flower_bed', x: 20, z: 30, rot: 0, placedAt: T0, by: 'p1' },
    f2: { def: 'flower_bed', x: 21, z: 30, rot: 0, placedAt: T0, by: 'p1' },
    b: { def: 'bird_bath', x: 22, z: 30, rot: 0, placedAt: T0, by: 'p1' },
  };
  const s = farm({ objects, beauty: { stars: 0 } }, 20);
  const b = WS.beautyOf(s);
  assert.ok(b.score > 0 && Number.isFinite(b.stars));
  assert.equal(WS.starsFor(0), 0);
  assert.equal(WS.starsFor(400), 3);
  // the set glow: which sets a def belongs to (live sets only)
  const sets = m1b(() => WS.setsOfDef('flower_bed'));
  assert.ok(sets.some((st) => st.id === 'cottage_garden'));
  if (!isLive(CONTENT.decorSets.get('cottage_garden'))) assert.equal(WS.setsOfDef('flower_bed').length, 0, 'no set glow before M1b');
  void levelFromXp;
});

test('world-kit merges parts into the canonical static attributes; a flag sways at its free end', () => {
  const g = merge([box(1, 1, 1, '#ff0000'), flag(1, 0.5, '#00ff00', { x: 3, y: 2, rz: -Math.PI / 2 })]);
  for (const a of ['position', 'normal', 'color', 'sway']) assert.ok(g.getAttribute(a));
  const sw = g.getAttribute('sway').array;
  assert.equal(sw[0], 0, 'the box is rigid');
  assert.ok(Math.max(...sw) > 1, 'the flag tip sways');
  assert.equal(g.getIndex().count, g.getAttribute('position').count);
});
