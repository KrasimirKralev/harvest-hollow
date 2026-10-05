// render-world, wave 3 (M2): the land features of expansions 5-15 (the Willow Pond and its fishing dock, the riding
// track, the olive terraces, the red maple ridge, Sunset Hill, the goat rocks, the picnic clearing, the oak edge),
// each parcel's own ground, the village's Town Projects 5-24 and the Festival Pavilion, Restoration 4-6, the farmhouse
// interior and Grandma's visit. Pure and deterministic (no DOM, no GPU).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT, T0 } from './helpers.js';
import { CONTENT, INTERIOR } from '../shared/content/index.js';
import { TILE_M, FARM_MIN, FARM_MAX } from '../shared/content/config.js';
import { setManifest } from '../public/js/render/assets.js';
import * as WS from '../public/js/render/world-state.js';
import { heightAt, WATER_Y, POND, POND_DOCK, ORCHARD_POND, TERRACES, terraceRisers, SUMMIT, RIDING, PLACES, WATER_SHEETS, refinedAxis,
  parcelGround, PARCEL_GROUND, landTiles, boundaryEdges, liveRects, padDist, PAD_OWNER, MOWN_PADS, FEATURE_TRACKS } from '../public/js/render/ground.js';
import { FEATURE_ZONES, inFeatureZone, featureItems, dockSeats, createLandFeatures, LOOKOUT, STAND_INS as LAND_GEO } from '../public/js/render/land-features.js';
import { forestSpot } from '../public/js/render/scene.js';
import { TOWN_SLOTS, COTTAGES, PAVILION_SLOT, LANDMARK_HALF, wetFootprints, createTown } from '../public/js/render/town-view.js';
import { LANDMARKS, LIGHTS, pavilionGeometry, PAVILION_TIERS } from '../public/js/render/town-landmarks.js';
import { windpumpGeometry, farmhouseDressing, SITES, createRestoration } from '../public/js/render/restoration-view.js';
import { FAIR_GROUNDS, grandstandGeometry, ferrisWheelGeometry } from '../public/js/render/fair-view.js';
import { ROOM, BUILT_IN, BUILT_IN_DEFS, SPOTS, itemPlacement, standKind, createInterior, overDresser } from '../public/js/render/interior-view.js';
import { taxiAt, porchOf, strollSpot, ARRIVAL } from '../public/js/render/grandma-view.js';
import { bandKeys, createBatch } from '../public/js/render/instancing.js';
import { createObjectsView, dockPoolGeometry } from '../public/js/render/objects-view.js';
import { models } from '../public/js/render/models.js';

setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8')));
// node has no model files to fetch: the batches keep their placeholders quietly (the layout is what is tested)
models.ready = async () => {};

const H = 3_600_000;
const lvl = (n) => CONTENT.levels[Math.min(n, CONTENT.levels.length) - 1].xp;
const farm = (extra = {}, level = 40) => ({ meta: { farmSeed: 1, tz: 'Europe/Sofia', createdAt: T0 }, farm: { xp: lvl(level), expansions: ['home'], objects: {}, ...extra }, players: {} });
const M2 = (fn) => { WS.setLivePredicate((d) => !d || !d.m || ['M1a', 'M1b', 'M2'].includes(d.m)); try { return fn(); } finally { WS.setLivePredicate(null); } };
const farm0 = FARM_MIN * TILE_M; const farm1 = FARM_MAX * TILE_M;
const inFarm = (x, z) => x > farm0 && x < farm1 && z > farm0 && z < farm1;
const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const rectM = (id) => { const [x, z, w, d] = CONTENT.expansions.get(id).rects[0]; return [x * TILE_M, z * TILE_M, (x + w) * TILE_M, (z + d) * TILE_M]; };

// ---------------------------------------------------------------------------------------------------
test('the farm board stays flat: every M2 land shape lives in the decorative ring (GDD §2.4)', () => {
  for (let x = farm0; x <= farm1; x += 2) for (let z = farm0; z <= farm1; z += 2) assert.ok(Math.abs(heightAt(x, z)) < 1e-9, `farm ground at ${x},${z} is flat`);
  // the Hollow Meadow (Restoration 3's land) is flat too, so the pond keeps south of it
  for (let x = 0; x <= 16; x += 1) for (let z = 16; z <= 48; z += 1) assert.ok(Math.abs(heightAt(x, z)) < 0.02, `meadow flat at ${x},${z}`);
});

test('the Willow Pond: water in the ring beside the parcel, the dock out of the parcel\'s west edge over it', () => {
  assert.ok(heightAt(POND.x, POND.z) < WATER_Y - 1, 'deep in the middle');
  const [x0, z0, , z1] = rectM('willow_pond');
  // the dock leaves the parcel's west edge on one of its rows, and reaches the water
  assert.equal(POND_DOCK.x, x0);
  assert.equal(POND_DOCK.tx * TILE_M, x0);
  assert.ok(POND_DOCK.tz * TILE_M >= z0 && (POND_DOCK.tz + 1) * TILE_M <= z1, 'the dock row is the parcel\'s');
  assert.ok(heightAt(POND_DOCK.x - POND_DOCK.len + 0.5, POND_DOCK.z) < WATER_Y - 0.3, 'the dock end stands in water');
  assert.ok(heightAt(POND_DOCK.x - 0.5, POND_DOCK.z) > WATER_Y + 0.2, 'its land end on the bank');
  for (const s of dockSeats()) assert.ok(s.x < POND_DOCK.x && s.x > POND_DOCK.x - POND_DOCK.len, 'two seats on the dock end');
  // the rules' fishing spot (content) is the dock's land end, where the farmers walk to cast
  assert.deepEqual(CONTENT.expansions.get('willow_pond').feature.fishingSpot, { x: POND_DOCK.tx, z: POND_DOCK.tz });
  // the water sheet covers the pond on its own fine grid
  const sheet = WATER_SHEETS.find(([a, b, c, d]) => POND.x > a && POND.x < b && POND.z > c && POND.z < d);
  assert.ok(sheet && sheet[4] <= 1, 'a 1 m water grid over the pond');
  // and the terrain mesh has vertex rows across the pond (a round bank, not an 8 m polygon)
  const xs = refinedAxis([0, 8, 16], [[POND.x - 9, POND.x + 9, 1.5]]);
  assert.ok(xs.filter((v) => v > POND.x - POND.rx && v < POND.x + POND.rx).length >= 8);
});

test('the fence opens where the dock leaves the farm (only while the Willow Pond is owned)', () => {
  const land = landTiles(['home', 'willow_pond'], () => true);
  const gap = boundaryEdges(land).find(([x0, z0, x1, z1]) => x0 === POND_DOCK.tx && x1 === POND_DOCK.tx && z0 === POND_DOCK.tz && z1 === POND_DOCK.tz + 1);
  assert.ok(gap, 'the dock tile is on the farm boundary (ground.js skips that rail)');
});

test('the Olive Terrace: flat bands climbing the hill, each a rise higher, the risers at the walls', () => {
  const T = TERRACES;
  const risers = terraceRisers();
  assert.equal(risers.length, T.n);
  for (let i = 0; i < T.n; i++) {
    const zBand = T.z1 - (i + 0.55) * T.step;
    for (const x of [T.x0 + 2, (T.x0 + T.x1) / 2, T.x1 - 2]) assert.ok(Math.abs(heightAt(x, zBand) - (i + 1) * T.rise) < 0.02, `band ${i} level at x ${x}`);
  }
  assert.ok(Math.abs(heightAt(32, T.z1 + 1)) < 0.05, 'below the first wall the margin is flat');
  for (const z of risers) assert.ok(z < T.z1 + 0.01 && z > T.z1 - T.n * T.step);
});

test('Sunset Hill and the Maple Ridge lookout stand outside the farm; the summit is flat on top', () => {
  assert.ok(Math.abs(heightAt(SUMMIT.x, SUMMIT.z) - SUMMIT.h) < 0.05);
  assert.ok(Math.abs(heightAt(SUMMIT.x + SUMMIT.top * 0.7, SUMMIT.z) - SUMMIT.h) < 0.05);
  assert.ok(!inFarm(SUMMIT.x, SUMMIT.z + SUMMIT.r) || heightAt(SUMMIT.x, farm0) === 0);
  assert.ok(!inFarm(LOOKOUT.x, LOOKOUT.z));
});

test('feature zones: outside the farmable square, forest-free, beside their own parcel', () => {
  const rects = liveRects(() => true);
  for (const [id, [x0, z0, x1, z1]] of Object.entries(FEATURE_ZONES)) {
    assert.ok(CONTENT.expansions.get(id), `${id} is an expansion`);
    const cx = (x0 + x1) / 2; const cz = (z0 + z1) / 2;
    assert.ok(inFeatureZone(cx, cz));
    assert.equal(forestSpot(cx, cz, rects), null, `${id}: the forest keeps out`);
    // the zone touches its parcel's 8 m neighbourhood
    const [px0, pz0, px1, pz1] = rectM(id);
    const dx = Math.max(px0 - x1, 0, x0 - px1); const dz = Math.max(pz0 - z1, 0, z0 - pz1);
    assert.ok(Math.hypot(dx, dz) < 8, `${id}: next to its parcel`);
  }
});

test('feature items: deterministic, owned and wild differ, nothing stands on the farm or in water that should not', () => {
  const FLOATS = new Set(['hh-lily', 'hh-lily-pad', 'prop:rowboat', 'prop:fishing_dock', 'prop:reeds', 'debris:rock']);
  for (const id of Object.keys(FEATURE_ZONES)) {
    const own = featureItems(id, true);
    const wild = featureItems(id, false);
    assert.deepEqual(featureItems(id, true), own, `${id}: deterministic`);
    assert.ok(own.length > 0, `${id}: a feature`);
    for (const it of [...own, ...wild]) {
      assert.ok(Number.isFinite(it.x) && Number.isFinite(it.z), `${id}: finite`);
      if (it.key === 'prop:fishing_dock') continue;           // the dock leaves the farm through its gate
      assert.ok(!inFarm(it.x, it.z), `${id}: ${it.key} at ${it.x.toFixed(1)},${it.z.toFixed(1)} is outside the farm`);
      if (!FLOATS.has(it.key) && it.y === undefined) assert.ok(heightAt(it.x, it.z) > WATER_Y + 0.1, `${id}: ${it.key} on dry land`);
    }
  }
  // the riding track's fence keeps a gate toward the farm
  const rails = featureItems('stable_paddock', true).filter((it) => it.key === 'hh-white-rail');
  assert.ok(rails.length >= 24 && rails.every((r) => r.x < RIDING.x + RIDING.rx + 2.2 + 0.01));
  assert.ok(!rails.some((r) => r.x > RIDING.x + RIDING.rx + 2 && Math.abs(r.z - RIDING.z) < 0.5), 'a gate on the farm side');
});

test('each owned parcel gets its own ground; nothing on land the farm does not own', () => {
  const t = parcelGround(['home', 'bee_glade', 'maple_ridge']);
  const N = 64;
  const [bx, bz] = CONTENT.expansions.get('bee_glade').rects[0];
  assert.equal(t[(bz + 1) * N + bx + 1] - 1, Object.keys(PARCEL_GROUND).indexOf('bee_glade'));
  const [sx, sz] = CONTENT.expansions.get('sunset_hill').rects[0];
  assert.equal(t[(sz + 1) * N + sx + 1], 0, 'not owned: plain lawn');
  for (const g of Object.values(PARCEL_GROUND)) { assert.ok(g.share > 0 && g.share < 1); assert.ok(g.kinds.every((k) => k >= 1 && k <= 9)); }
  // the M2 pads and paths belong to their expansion or project
  for (const k of [...Object.keys(MOWN_PADS), 'paddock', 'picnic', 'orchard']) assert.ok(PAD_OWNER[k], k);
  for (const tr of FEATURE_TRACKS) assert.ok(CONTENT.expansions.get(tr[4]) || tr[4].startsWith('restore:'), tr[4]);
});

test('the land view: wild until bought, the feature after, the fishing dock and the horse-show ring as places', () => {
  const scenery = createBatch({ name: 's', material: new THREE.MeshBasicMaterial() });
  const lf = createLandFeatures({ scenery });
  M2(() => {
    lf.setState(farm({ expansions: ['home'] }), T0);
    assert.deepEqual(lf.stats().owned, []);
    assert.ok(lf.places().every((p) => !p.live), 'nothing to click on wild land');
    lf.sync([], new Set(['expansions']), farm({ expansions: ['home', 'willow_pond', 'stable_paddock'] }), T0);
    assert.deepEqual(lf.stats().owned.sort(), ['stable_paddock', 'willow_pond']);
    const live = Object.fromEntries(lf.places().map((p) => [p.place, p.live]));
    assert.equal(live.fishing, true);
    assert.equal(live.horseshow, true);
    assert.ok(lf.owners().has('willow_pond'));
  });
  // a cast rings the pond for a while
  assert.equal(lf.onEvent({ e: 'fishCast', by: 'p1' }), true);
  assert.equal(lf.onEvent({ e: 'harvested' }), false);
  assert.ok(lf.ripples().length >= 1);
});

// ---------------------------------------------------------------------------------------------------
test('Town Projects 5-24: a landmark of its own for every project, in its slot, dry, within budget', () => {
  for (const p of CONTENT.townProjects.values()) {
    assert.ok(TOWN_SLOTS[p.id], `${p.id}: a slot`);
    if (p.n <= 4) continue;
    assert.equal(typeof LANDMARKS[p.id], 'function', `${p.id}: a stand-in`);
    const g = LANDMARKS[p.id]();
    g.computeBoundingBox();
    const b = g.boundingBox;
    const s = TOWN_SLOTS[p.id][3] || 1;
    assert.ok(Math.max(-b.min.x, b.max.x) * s < 7 && Math.max(-b.min.z, b.max.z) * s < 7, `${p.id}: fits its plot`);
    assert.ok(tris(g) < 2600, `${p.id}: ${tris(g)} triangles`);
    assert.ok(Array.isArray(LIGHTS[p.id]), `${p.id}: night lights listed`);
  }
  assert.deepEqual(wetFootprints(), [], 'no landmark, cottage or the pavilion over the bank');
});

test('the Festival Pavilion: tier n - 24 of the Town Projects; built tiers show, the next waits in scaffold', () => {
  M2(() => {
    assert.deepEqual(WS.pavilionView(farm({ town: { n: 24, cur: null } }), T0), { live: false, tiers: 0, building: null });
    assert.equal(WS.pavilionView(farm({ town: { n: 27, cur: null } }), T0).tiers, 3);
    const w = WS.pavilionView(farm({ town: { n: 25, cur: { id: 'festival_pavilion', n: 26, buildAt: T0 + H } } }), T0);
    assert.deepEqual([w.tiers, w.building], [1, 2]);
    assert.equal(WS.pavilionView(farm({ town: { n: 25, cur: { id: 'festival_pavilion', n: 26, buildAt: T0 - 1 } } }), T0).tiers, 2, 'built the next day');
    // the village lists all 24 landmarks once n passes 24
    assert.equal(WS.townView(farm({ town: { n: 30, cur: null } }), T0).built.length, 24);
  });
  // every tier adds to the last, and they stay cheap (the far village batch)
  let prev = 0;
  for (let t = 1; t <= PAVILION_TIERS; t++) { const n = tris(pavilionGeometry(t)); assert.ok(n > prev, `tier ${t} adds`); assert.ok(n < 5000); prev = n; }
  assert.equal(tris(pavilionGeometry(12)), tris(pavilionGeometry(PAVILION_TIERS)), 'later tiers repeat the last look');
  // its spot is clear of the other landmarks
  for (const [id, [x, z]] of Object.entries(TOWN_SLOTS)) assert.ok(Math.hypot(x - PAVILION_SLOT[0], z - PAVILION_SLOT[1]) > 7, `pavilion clear of ${id}`);
  void COTTAGES; void LANDMARK_HALF;
});

test('the village view draws the pavilion and its tiers', () => {
  const scenery = createBatch({ name: 's', material: new THREE.MeshBasicMaterial() });
  const town = createTown({ scenery });
  M2(() => {
    town.setState(farm({ town: { n: 24, cur: null } }, 40), T0);
    const a = town.stats();
    town.sync([], new Set(['town']), farm({ town: { n: 28, cur: null } }, 40), T0);
    const b = town.stats();
    assert.equal(a.pavilion, 0);
    assert.equal(b.pavilion, 4);
    assert.ok(b.instances > a.instances - 2, 'the pavilion stands (a cottage gave way)');
  });
});

// ---------------------------------------------------------------------------------------------------
test('Restoration 4-6: the windpump grows stage by stage; the farmhouse gets scaffold, then its dressing', () => {
  const sizes = [0, 1, 2, 3, 4].map((s) => tris(windpumpGeometry(s)));
  assert.equal(new Set(sizes).size, 5, 'every stage of the windpump differs');
  assert.equal(tris(farmhouseDressing(0)), 0);
  assert.ok(tris(farmhouseDressing(2)) > 0 && tris(farmhouseDressing(4)) > tris(farmhouseDressing(2)));
  assert.ok(!inFarm(SITES.orchard_pond.x, SITES.orchard_pond.z), 'the windpump stands off the farm');
  assert.ok(heightAt(ORCHARD_POND.x, ORCHARD_POND.z) < WATER_Y - 1, 'the Orchard Pond holds water');
  assert.ok(padDist(SITES.orchard_pond.x, SITES.orchard_pond.z, PLACES.orchard.pad) < 0, 'on its pad');
  // the grandstand and the Ferris wheel sit on the fair's pad
  for (const [x, z] of [FAIR_GROUNDS.stand, FAIR_GROUNDS.wheel]) assert.ok(padDist(x, z, PLACES.fair.pad) < 0);
  assert.ok(tris(grandstandGeometry(3)) > tris(grandstandGeometry(2)));
  assert.ok(tris(ferrisWheelGeometry()) < 3000);
  const scenery = createBatch({ name: 's', material: new THREE.MeshBasicMaterial() });
  const dyn = createBatch({ name: 'd', material: new THREE.MeshBasicMaterial() });
  const r = createRestoration({ scenery, dyn });
  const done = { b: { a: 1, b: 1, c: 1, d: 1 }, done: T0 - 1 };
  M2(() => {
    r.setState(farm({ restore: {}, objects: { f: { def: 'farmhouse', x: 17, z: 25, rot: 0 } } }, 40), T0);
    assert.equal(r.stages.orchard_pond, 0);
    r.sync([], new Set(['restore']), farm({ restore: { orchard_pond: done, farmhouse: { b: { a: 1, b: 1 } } }, objects: { f: { def: 'farmhouse', x: 17, z: 25, rot: 0 } } }, 40), T0);
    assert.equal(r.stages.orchard_pond, 4);
    assert.equal(r.stages.farmhouse, 2);
    assert.ok(r.update(0.1, T0, { motion: 'full' }) >= 1, 'the restored windpump turns');
    assert.ok(r.places().some((p) => p.args.id === 'orchard_pond' && p.live));
  });
});

// ---------------------------------------------------------------------------------------------------
test('the interior: open once Grandma\'s Farmhouse is restored; its items read from farm.interior', () => {
  const s = farm({ restore: { farmhouse: { b: { a: 1, b: 1, c: 1, d: 1 }, done: T0 - 1 } }, interior: { items: { b: { def: 'armchair', x: 6, z: 2, rot: 1 }, a: { def: 'lamp', x: 8, z: 2 }, bad: { def: 'x' } } } });
  M2(() => {
    assert.equal(WS.interiorView(farm(), T0).live, false);
    const v = WS.interiorView(s, T0);
    assert.equal(v.live, true);
    assert.deepEqual(v.items.filter((i) => !i.id.startsWith('fx.')).map((i) => i.id), ['a', 'b'], 'sorted ids, malformed items skipped');
    // the room's fixed pieces arrive with it (content INTERIOR.fixed) when the state has none yet
    assert.deepEqual(v.items.filter((i) => i.id.startsWith('fx.')).map((i) => i.def).sort(), INTERIOR.fixed.map((f) => f.def).sort());
    // the rules' items win: a moved duet table and a wall piece on a slot
    const r = WS.interiorView(farm({ restore: s.farm.restore, interior: { items: { 'fx.5': { def: 'duet_table', x: 6, z: 5 }, w1: { def: 'cuckoo_clock', wall: 'left', at: 7 } }, tray: {} } }), T0);
    assert.deepEqual(r.items.find((i) => i.id === 'fx.5'), { id: 'fx.5', def: 'duet_table', x: 6, z: 5, rot: 0, by: null });
    assert.deepEqual(r.items.find((i) => i.id === 'w1'), { id: 'w1', def: 'cuckoo_clock', wall: 'left', at: 7, by: null });
    assert.equal(r.items.filter((i) => i.def === 'duet_table').length, 1, 'no second table from the defaults');
    // also a flat map and an explicit open flag
    assert.equal(WS.interiorView(farm({ house: { open: true, q: { def: 'sofa', x: 1, z: 6 } } }), T0).items.filter((i) => i.id === 'q').length, 1);
  });
  // the room is content's room; the shell's own pieces sit on content's cells and slots
  assert.deepEqual([ROOM.w, ROOM.d], INTERIOR.grid);
  for (const f of INTERIOR.fixed) if (!f.wall && f.def in BUILT_IN_DEFS) assert.ok(BUILT_IN.some(([x, z]) => x === f.x && z === f.z), `${f.def} on its cells`);
  // placement: a 2 x 1 piece turned a quarter stands on its turned footprint; rugs lift off the boards; wall pieces
  // hang on their wall, centred on their slots
  assert.deepEqual(itemPlacement({ x: 3, z: 4, rot: 1 }, { size: [2, 1], layer: 'object' }), { x: 3.5, z: 5, y: 0, yaw: Math.PI / 2, wall: null });
  assert.ok(itemPlacement({ x: 3, z: 4 }, { size: [3, 3], layer: 'floor' }).y > 0);
  assert.deepEqual(itemPlacement({ wall: 'back', at: 6 }, { size: [2, 1], layer: 'wall' }, true), { x: 7, z: 0.06, y: 0, yaw: 0, wall: 'back' });
  const lw = itemPlacement({ wall: 'left', at: 7 }, { size: [1, 1], layer: 'wall' });
  assert.deepEqual([lw.x, lw.z, lw.yaw, lw.y], [0.06, 7.5, Math.PI / 2, 1.7]);
  assert.equal(standKind('grandma_rocker'), 'rocker');
  assert.equal(standKind('oak_bookshelf'), 'shelf');
  assert.equal(standKind('mystery_thing'), 'crate');
  for (const [x, z] of BUILT_IN) assert.ok(x >= 0 && x < ROOM.w && z >= 0 && z < ROOM.d);
});

test('the interior picks its furniture, its spots and the floor cell under the pointer', () => {
  const room = createInterior({});
  room.resize(16 / 9);
  M2(() => room.setState(farm({ restore: { farmhouse: { b: {}, done: T0 - 1 } }, interior: { items: { sofa: { def: 'sofa', x: 6, z: 5 } } } }), { me: 'p1', now: T0 }));
  const toNdc = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(room.camera); return { x: v.x, y: v.y }; };
  const sofa = room.pick(toNdc(6.5, 0.3, 5.5));
  assert.deepEqual([sofa.kind, sofa.id, sofa.def], ['item', 'sofa', 'sofa']);
  assert.ok(sofa.cell, 'the floor cell under the pointer rides along');
  const fire = room.pick(toNdc(5, 0.8, 0.5));
  assert.deepEqual([fire.kind, fire.id, fire.item], ['spot', 'fire', 'fx.0'], 'the hearth is a spot that names its fixed item');
  assert.equal(room.pick(toNdc(9.0, 1.2, 0.2)).id, 'door');
  // a wall slot between the pieces (the back wall above x = 7, the Ribbon Wall's slot is 6-7: an item there)
  const w = room.pick(toNdc(3.3, 2.9, 0.05));
  assert.deepEqual([w.kind, w.wall, w.at], ['wall', 'back', 3]);
  const f = room.pick(toNdc(3.5, 0, 2.5));
  assert.deepEqual([f.kind, f.x, f.z, f.inside], ['floor', 3, 2, true]);
  for (const id of Object.keys(SPOTS)) assert.ok(SPOTS[id].box.length === 6);
  // the camera turns within its limits, the ghost shows and hides
  for (let i = 0; i < 10; i++) room.rotate(1);
  room.update(5, T0, { night: 0 });
  room.ghost('armchair', { x: 2, z: 2, rot: 0 }, true);
  room.ghost(null);
  assert.ok(room.stats().items >= 3, 'the sofa, the dresser, the duet table and the Ribbon Wall');
  // a wall piece hung above the keepsake dresser turns its hutch into a low sideboard (and back when it goes)
  const hutchShown = () => room.scene.children.filter((m) => m.isMesh && m.geometry && m.visible).length;
  assert.ok(overDresser(2, 2) && overDresser(0, 2) && !overDresser(3, 1) && !overDresser(Number.NaN));
  const before = hutchShown();
  const hung = (items) => M2(() => room.setState(farm({ restore: { farmhouse: { b: {}, done: T0 - 1 } }, interior: { items } }), { me: 'p1', now: T0 }));
  hung({ sofa: { def: 'sofa', x: 6, z: 5 }, pic: { def: 'valley_painting', wall: 'back', at: 1 } });
  assert.equal(hutchShown(), before, 'one shape swapped for the other');
  const dresser = room.pick(toNdc(2, 2.0, 0.3));
  assert.ok(!dresser || dresser.kind !== 'item' || dresser.def !== 'keepsake_shelf', 'the low sideboard no longer reaches 2 m');
  hung({ sofa: { def: 'sofa', x: 6, z: 5 } });
  assert.equal(room.pick(toNdc(2, 2.0, 0.3)).def, 'keepsake_shelf', 'the hutch is back');
  // the room's camera never pans, so every screen shape sees the whole room: its corners (floor and wall tops) fit
  for (const aspect of [16 / 9, 4 / 3, 1, 0.75, 390 / 844]) {
    const r = createInterior({});
    r.resize(aspect);
    r.update(1, T0, { night: 0 });
    for (const [x, y, z] of [[0, 0, 0], [ROOM.w, 0, 0], [0, 0, ROOM.d], [ROOM.w, 0, ROOM.d], [0, 2.6, ROOM.d], [ROOM.w, 2.6, 0], [0, 2.6, 0]]) {
      const v = new THREE.Vector3(x, y, z).project(r.camera);
      assert.ok(Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, `aspect ${aspect.toFixed(2)}: corner ${x},${y},${z} on screen (${v.x.toFixed(2)}, ${v.y.toFixed(2)})`);
    }
  }
});

test('Grandma\'s visit: the taxi at the gate, then her stroll round the farm (rules farm.grandma, or quest E10)', () => {
  const at = T0 + 10 * H;
  const s = farm({ quests: { active: {}, done: { e10: at }, owed: {} } });
  assert.equal(WS.grandmaVisit(s, at - 1).phase, 'none');
  assert.equal(WS.grandmaVisit(s, at + 1000).phase, 'arriving');
  assert.equal(WS.grandmaVisit(s, at + WS.GRANDMA.arriveMs + 1).phase, 'visiting');
  assert.equal(WS.grandmaVisit(s, at + WS.GRANDMA.stayMs + 1).phase, 'none', 'she goes home after her stay (content: 72 h)');
  assert.equal(WS.grandmaVisit(farm({ grandma: { from: at, until: at + H } }), at + 2 * H).phase, 'none', 'a rules window wins');
  // the taxi drives in, waits level with the farmhouse, drives off; invisible outside the arrival
  const stop = 36;
  assert.ok(taxiAt(0.05, stop).x < taxiAt(0.2, stop).x);
  assert.equal(taxiAt(ARRIVAL.in + 0.05, stop).x, stop);
  assert.equal(taxiAt(ARRIVAL.leave - 0.01, stop).x, stop);
  assert.ok(taxiAt(0.9, stop).x > stop);
  assert.equal(taxiAt(1.2, stop).visible, false);
  // the porch is in front of the farmhouse, whichever way it faces
  const p = porchOf({ x: 36, z: 54, yaw: 0 });
  assert.ok(p.z > 54 + 4 && Math.abs(p.x - 36) < 1);
  const q = porchOf({ x: 36, z: 54, yaw: Math.PI / 2 });
  assert.ok(q.x > 36 + 4);
  // something stands by the door: she takes the next free spot, never a tile with an object on it
  const busy = (tx, tz) => !(tz === Math.floor((54 + 4.8) / TILE_M) && tx === Math.floor(36.2 / TILE_M));
  const r = porchOf({ x: 36, z: 54, yaw: 0 }, busy);
  assert.ok(r && busy(Math.floor(r.x / TILE_M), Math.floor(r.z / TILE_M)) && Math.abs(r.x - 36) > 1);
  assert.equal(porchOf({ x: 36, z: 54, yaw: 0 }, () => false), null, 'no free spot: she stays inside');
  // her stroll: beside the nearest plot, fruit tree, home or bench, on a free tile, facing it; the parlour is inside
  const farmS = { farm: { objects: { p: { def: 'plot', x: 22, z: 30, rot: 0 }, t: { def: 'apple_tree', x: 30, z: 30, rot: 0 }, far: { def: 'apple_tree', x: 50, z: 50, rot: 0 } } } };
  const house = { x: 36, z: 54, yaw: 0 };
  const f = strollSpot(farmS, house, 'field');
  assert.ok(Math.abs(Math.floor(f.x / TILE_M) - 22) <= 1 && Math.abs(Math.floor(f.z / TILE_M) - 30) <= 1, 'beside the plot');
  assert.ok(!(Math.floor(f.x / TILE_M) === 22 && Math.floor(f.z / TILE_M) === 30), 'not on it');
  const o = strollSpot(farmS, house, 'orchard');
  assert.ok(Math.hypot(o.x - 62, o.z - 62) < 5, 'the nearer tree');
  assert.equal(strollSpot(farmS, house, 'parlour'), null);
  assert.deepEqual(strollSpot(farmS, house, 'barnyard'), porchOf(house), 'no home: the porch');
  // the visit's stop follows the rules' clock: one stop an hour
  const g = farm({ grandma: { at: T0, until: T0 + 72 * H, met: {}, left: false, gift: null } });
  assert.equal(WS.grandmaVisit(g, T0 + 10_000).phase, 'arriving');
  assert.equal(WS.grandmaVisit(g, T0 + 1.5 * H).stop, 'field');
  assert.equal(WS.grandmaVisit(g, T0 + 5.5 * H).stop, 'parlour');
  assert.equal(WS.grandmaVisit(farm({ grandma: { at: T0, until: T0 + 72 * H, met: {}, left: true, gift: null } }), T0 + H).phase, 'none', 'gone home');
});

test('the decor Fishing Dock stands over a little pool of its own, inside its footprint, gone when it is moved away', () => {
  const g = dockPoolGeometry();
  g.computeBoundingBox();
  assert.ok(g.boundingBox.max.x <= TILE_M * 1.0 + 0.4 && g.boundingBox.min.x >= -TILE_M && Math.abs(g.boundingBox.min.z) <= TILE_M, 'within the 2 x 2 tiles');
  const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
  const view = createObjectsView(layers, { now: () => T0 + 1 });
  const st = (objs) => ({ meta: { farmSeed: 1, tz: 'Europe/Sofia' }, farm: { expansions: ['home'], objects: objs }, players: {} });
  view.setState(st({ w: { def: 'well', x: 30, z: 30, rot: 0, placedAt: T0, by: 'p1' } }));
  const base = view.stats().statics;
  view.setState(st({ w: { def: 'well', x: 30, z: 30, rot: 0, placedAt: T0, by: 'p1' }, d: { def: 'pond_dock', x: 24, z: 30, rot: 0, placedAt: T0, by: 'p1' } }));
  assert.equal(view.stats().statics, base + 2, 'the dock and its pool');
  view.sync(['d'], new Set(['objects']), st({ w: { def: 'well', x: 30, z: 30, rot: 0, placedAt: T0, by: 'p1' } }));
  assert.equal(view.stats().statics, base, 'both go with it');
});

test('budgets: the M2 world additions stay small next to GDD §8.6 (<= 300k visible triangles)', () => {
  // all twenty landmarks, the pavilion at its last tier, the land features' own stand-ins
  let n = 0;
  for (const f of Object.values(LANDMARKS)) n += tris(f());
  n += tris(pavilionGeometry(8));
  assert.ok(n < 32_000, `the whole M2 village is ${n} triangles`);
  // the land features' stand-ins, every zone owned (52 maples, 36 wall runs, the olive rows ...)
  let f = 0;
  for (const id of Object.keys(FEATURE_ZONES)) for (const it of featureItems(id, true)) { const g = LAND_GEO[it.key]; if (g) f += tris(g()); }
  assert.ok(f < 45_000, `the land features are ${f} triangles`);
  void models;
});

test('the far band draws the buildings\' far twins in the main pass; callers keep seeing the logical key', () => {
  const calls = [];
  const fake = { add: (k) => { calls.push(['add', k]); return calls.length; }, setKey: (h, k) => calls.push(['setKey', h, k]), remove: () => {}, keyOf: () => 'raw' };
  const band = bandKeys(fake, (k) => (k === 'building:dairy' ? 'building:dairy:far' : k));
  const h = fake.add('building:dairy');
  const p = fake.add('hh:dock_pool');
  assert.equal(fake.keyOf(h), 'building:dairy');
  band.set(true);
  assert.deepEqual(calls.filter((c) => c[0] === 'setKey').map((c) => c[2]), ['building:dairy:far', 'hh:dock_pool']);
  assert.equal(fake.keyOf(h), 'building:dairy', 'the logical key (objects-view compares it on every sync)');
  fake.add('building:dairy');
  assert.equal(calls.at(-1)[1], 'building:dairy:far', 'new instances in the far band come in far');
  fake.setKey(p, 'building:dairy');
  assert.deepEqual(calls.at(-1), ['setKey', p, 'building:dairy:far']);
  band.set(false);
  assert.equal(calls.at(-1)[2], 'building:dairy');
  // per instance, in the near and mid bands: beyond 60 m of the eye (with +-5 % hysteresis) an instance draws its twin
  const real = createBatch({ name: 't', material: new THREE.MeshBasicMaterial(), instances: 8, vertices: 1 << 10 });
  real.define('a', new THREE.BoxGeometry(1, 1, 1));
  real.define('a:far', new THREE.BoxGeometry(1, 1, 1));
  const lod = bandKeys(real, (k) => `${k}:far`, { far: 60 });
  const m = (x) => new THREE.Matrix4().makeTranslation(x, 0, 0);
  const near = real.add('a', m(10));
  const away = real.add('a', m(80));
  lod.setEye({ x: 0, y: 0, z: 0 });
  assert.deepEqual([lod.isFar(near), lod.isFar(away)], [false, true]);
  assert.equal(real.keyOf(away), 'a', 'callers still see the logical key');
  lod.setEye({ x: 0, y: 0, z: 0 }, 0.5);
  assert.equal(lod.isFar(away), false, 'a phone-scaled distance pulls the twin back in');
  lod.setEye({ x: 0, y: 0, z: 0 }, 1);
  real.setMatrix(away, m(59));
  assert.equal(lod.isFar(away), true, 'inside the hysteresis it stays a twin');
  real.setMatrix(away, m(56));
  assert.equal(lod.isFar(away), false);
  assert.equal(real.add('a', m(200)) !== undefined && lod.isFar(2), true, 'a new far instance arrives as a twin');
});
