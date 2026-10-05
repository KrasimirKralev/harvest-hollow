// M1b input (wave 2, client lane): giant crops are felled one chop per press (never nine chops in one drag), bee
// colonies are collected and never fed or petted, riding a horse (GDD §3.4 Horse: cosmetic, x1.8), decor sets placed
// piece by piece (GDD §3.8), world places open their panels, and the new sounds exist for every new species.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, verbsFor, giantText, rideText, adultHorses, ONCE_VERBS } from '../public/js/game/targets.js';
import { createAvatar, RIDE_SPEED_K, RIDE_TOOL } from '../public/js/game/avatar.js';
import { setSpot } from '../public/js/game/controller.js';
import { SPECIES_SOUND, BUILDING_SOUND, villageBuilt, soundsOf } from '../public/js/game/feedback.js';
import { ECON_EVENTS } from '../shared/rules/events.js';
import { GOALS_EVENTS, CELEBRATIONS } from '../shared/rules/progress.js';
import { CALLS } from '../public/js/audio.js';
import { CONTENT, defOf, xpForLevel, cropOf } from '../shared/content/index.js';
import { AVATAR_SPEED } from '../shared/content/config.js';
import { canPlace, tileOwner } from '../shared/rules/grid.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';

const MANIFEST = JSON.parse(fs.readFileSync(new URL('../public/assets/audio/manifest.json', import.meta.url), 'utf8'));

/** Put the same object into the server state and both clients' predicted states (a fixture, not an action). */
function inject(h, id, o) {
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.objects[id] = structuredClone(o);
}
/** A free spot for def near (x0, z0) by the shared rules. */
function spotFor(state, def, x0 = 12, z0 = 12) {
  for (let z = z0; z < 60; z++) for (let x = x0; x < 60; x++) if (canPlace(state, def, x, z, 0) === null) return { x, z };
  throw new Error(`no spot for ${def}`);
}
function level(h, L) {
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(L); s.farm.wallet.coins = 900_000; }
}

// ---- giant crops -------------------------------------------------------------------------------------------------
/** Nine wheat plots in a 3 x 3 block whose crops form one ripe Giant (anchor = the min corner), plus a plain plot. */
function giantFarm({ ripe = true } = {}) {
  const h = coopHarness();
  level(h, 20);
  const now = h.clock.now();
  const x0 = 30; const z0 = 40;
  const ids = [];
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) ids.push(`gp${dz}${dx}`);
  const anchor = ids[0];
  ids.forEach((id, i) => {
    const crop = { def: 'wheat', plantedAt: now - 120_000, readyAt: ripe ? now - 1000 : now + 600_000, by: 'p1', cycle: 0, giant: anchor };
    if (id === anchor) crop.hp = 60;
    inject(h, id, { def: 'plot', x: x0 + (i % 3), z: z0 + Math.floor(i / 3), rot: 0, placedAt: now - 200_000, by: 'p1', cycle: 0, crop });
  });
  return { h, ids, anchor, x0, z0 };
}

test('a giant crop: the Hand, the Sickle and the Axe fell it, the Seed Bag, Can and Scoop leave it alone, Shift never uproots it', () => {
  const { h, ids, anchor } = giantFarm();
  const s = h.a.store.state;
  const now = h.a.store.now();
  for (const id of ids) {
    const t = describe(s, id, now, 'p1');
    assert.equal(t.giant, anchor, `${id} names its anchor`);
    assert.equal(t.ready, true);
    assert.deepEqual(verbsFor('hand', t), ['fell']);
    assert.deepEqual(verbsFor('axe', t), ['fell']);
    assert.deepEqual(verbsFor('sickle', t), ['fell'], 'the Sickle fells a ripe Giant too');
    for (const tool of ['seed_bag', 'watering_can', 'compost_scoop']) assert.deepEqual(verbsFor(tool, t), [], tool);
    assert.deepEqual(verbsFor('hand', t, { shift: true }), [], 'Shift + Hand never uproots a Giant');
  }
  assert.equal(describe(s, anchor, now, 'p1').hp, 60);
  assert.ok(ONCE_VERBS.has('fell'), 'one chop per press');
  assert.match(giantText(s, ids[4], now), /A Giant Wheat! .*60 left.*together/);
});

test('a growing giant offers nothing but its tooltip (no watering of single plots, no harvest)', () => {
  const { h, ids } = giantFarm({ ripe: false });
  const t = describe(h.a.store.state, ids[4], h.a.store.now(), 'p1');
  assert.equal(t.growing, true);
  assert.deepEqual(verbsFor('hand', t), []);
  assert.deepEqual(verbsFor('axe', t), []);
  assert.match(giantText(h.a.store.state, ids[4], h.a.store.now()), /growing here/);
});

test('an Axe drag across all nine plots of a Giant is ONE press: at most one chop goes out', async () => {
  globalThis.window ??= eventTarget();
  const { h, x0, z0 } = giantFarm();
  const f = await fakeController(h.a);
  f.ctl.setTool('axe');
  const seq0 = h.a.store.seq;
  f.down(x0, z0);
  for (const [dx, dz] of [[1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2], [2, 2]]) f.move(x0 + dx, z0 + dz);
  f.up(x0 + 2, z0 + 2);
  assert.ok(h.a.store.seq - seq0 <= 1, `${h.a.store.seq - seq0} chop actions for one drag`);
  const { giantLive } = await import('../shared/rules/actions/giant.js');
  if (giantLive(h.a.store.state)) {
    // the M1b build: exactly one chop, on the anchor, 10 hp (60 -> 50)
    assert.equal(h.a.store.seq - seq0, 1, 'one chop');
    h.flush();
    assert.equal(h.state.farm.objects.gp00.crop.hp, 50, 'the server took one chop off the anchor');
  }
});

// ---- bees ----------------------------------------------------------------------------------------------------------
test('a bee colony is collected when its honey is ready, and never fed, bottled or petted', () => {
  const h = coopHarness();
  level(h, 13);
  const now = h.clock.now();
  const sp = spotFor(h.state, 'beehive');
  inject(h, 'hive1', { def: 'beehive', x: sp.x, z: sp.z, rot: 0, placedAt: now, by: 'p1' });
  inject(h, 'hive1.b', { def: 'bee', home: 'hive1', placedAt: now, by: 'p1', adultAt: now, fedAt: now - 7e6, readyAt: now - 1000, cycle: 0, cut: 0, free: true });
  const s = h.a.store.state;
  const t = describe(s, 'hive1.b', now, 'p1');
  assert.equal(t.colony, true);
  assert.equal(t.hungry, false);
  assert.deepEqual(verbsFor('hand', t), ['tend']);
  assert.deepEqual(verbsFor('basket', t), ['collect']);
  assert.deepEqual(verbsFor('feed_scoop', t), [], 'nothing to feed');
  const busy = describe({ ...s, farm: { ...s.farm, objects: { ...s.farm.objects, 'hive1.b': { ...s.farm.objects['hive1.b'], readyAt: now + 9e6 } } } }, 'hive1.b', now, 'p1');
  assert.equal(busy.hungry, false, 'a working colony is not hungry');
  assert.deepEqual(verbsFor('hand', busy), [], 'a working colony: the Hand opens the hive panel, never pets bees');
  const home = describe(s, 'hive1', now, 'p1');
  assert.equal(home.anyReady, true);
  assert.deepEqual(verbsFor('hand', home), ['tend']);
});

// ---- riding --------------------------------------------------------------------------------------------------------
function stableFarm({ horses = [{ adult: true }] } = {}) {
  const h = coopHarness();
  level(h, 25);
  const now = h.clock.now();
  const sp = spotFor(h.state, 'stable', 20, 20);
  inject(h, 'st1', { def: 'stable', x: sp.x, z: sp.z, rot: 0, placedAt: now, by: 'p1' });
  // working adults (fed, product not ready yet): nothing to tend, so the Hand pets, then rides
  horses.forEach((x, i) => inject(h, `hz${i}`, { def: 'horse', home: 'st1', placedAt: now - 1e7, by: 'p1', adultAt: x.adult ? now - 1000 : now + 3e6,
    fedAt: x.adult ? now - 1000 : null, readyAt: x.adult ? now + 6 * 3_600_000 : null, cycle: 0, cut: 0, ...(x.extra || {}) }));
  return { h, sp };
}

test('ride: the farmer walks to the Stable and mounts on arrival; V gets off; a foal cannot be ridden', async () => {
  globalThis.window ??= eventTarget();
  const { h, sp } = stableFarm({ horses: [{ adult: true }, { adult: false }] });
  const f = await fakeController(h.a);
  assert.equal(adultHorses(h.a.store.state, h.a.store.now()), 1);
  assert.equal(f.ctl.rideCode('hz1'), 'NOT_READY', 'a foal');
  assert.equal(f.ctl.rideCode(), null);
  const rides = [];
  f.ctl.on('ride', (e) => rides.push(e));
  assert.equal(f.ctl.ride(), true);
  assert.equal(f.ctl.riding, null, 'not before the farmer reaches the Stable');
  const w = f.walks.at(-1);
  assert.deepEqual([w.x, w.z], [sp.x, sp.z], 'walks to the Stable');
  w.onArrive();
  assert.equal(f.ctl.riding, 'hz0');
  assert.deepEqual(rides.map((r) => r.riding), [true]);
  window.dispatch('keydown', { key: 'v', code: 'KeyV', target: null });
  assert.equal(f.ctl.riding, null, 'V gets off');
  assert.equal(rides.at(-1).riding, false);
  assert.match(rideText(h.a.store.state, 'hz0', 'p1', { now: h.a.store.now() }), /Click to ride \(V\)/);
  assert.match(rideText(h.a.store.state, 'hz1', 'p1', { now: h.a.store.now() }), /Too young/);
});

test('ride: one adult horse and the partner on it -> "every horse has a rider"; no horse -> the Stable is named', async () => {
  globalThis.window ??= eventTarget();
  const { h } = stableFarm();
  const f = await fakeController(h.a);
  // the partner's presence says she rides (main.js feeds peerTool from the `pr` rows)
  const { createController } = await import('../public/js/game/controller.js');
  const toasts = [];
  const ctl = createController({ store: h.a.store, view: { onFrame() {}, ghost: { show() {}, hide() {}, update() {} }, grid() {}, objects: { hidden() {} }, highlight() {}, fx: { play() {} }, partner: { pose: () => null } },
    avatar: { pose: { x: 0, z: 0 }, setCursor() {}, setTool() {}, walkTo() {} }, canvas: Object.assign(eventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 640 }) }),
    send() {}, toast: (t) => toasts.push(t), peerTool: (pid) => (pid === 'p2' ? RIDE_TOOL : null) });
  assert.equal(ctl.rideCode(), 'OCCUPIED');
  assert.equal(ctl.ride(), false);
  assert.match(String(toasts.at(-1)), /Every horse has a rider/);
  const empty = coopHarness();
  level(empty, 25);
  const g = await fakeController(empty.a);
  assert.equal(g.ctl.rideCode(), 'LOCKED');
  g.ctl.ride();
  assert.match(String(g.toasts.at(-1)[0]), /Stable/);
  void f;
});

test('ride: the Hand on an adult horse already petted today rides it; sitting on a bench gets the rider off', async () => {
  globalThis.window ??= eventTarget();
  const { h } = stableFarm();
  // petted today by p1: the Hand's first verb (pet) is refused, the next one (ride) runs
  const day = (await import('../shared/rules/calendar.js')).dayIndex(h.clock.now(), h.state.meta.tz);
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.objects.hz0.pet = { day, by: ['p1'] };
  const t = describe(h.a.store.state, 'hz0', h.a.store.now(), 'p1');
  assert.deepEqual(verbsFor('hand', t), ['pet', 'ride']);
  const f = await fakeController(h.a, { onArrive: 'now' });
  const st = h.state.farm.objects.st1;
  f.click(st.x + 1, st.z + 1);                       // the Stable's tile stands for its horse (the home's occupants)
  // a click on the home tends/pets its animals, not a ride: ride needs the horse itself (an animal pick) or V
  assert.equal(f.ctl.riding, null);
  // the horse itself (render-life animal pickables): drive actOn with an animal pick
  f.ctl.actOn({ kind: 'object', id: 'hz0', x: st.x, z: st.z });
  assert.equal(f.ctl.riding, 'hz0', 'the Hand on the petted horse rides it');
  // a bench: sitting gets off the horse first
  const bsp = spotFor(h.state, 'sunset_bench', 10, 10);
  const r = h.a.store.act('place', { def: 'sunset_bench', x: bsp.x, z: bsp.z, rot: 0 });
  assert.equal(r.ok, true, r.code);
  h.flush();
  f.ctl.actOn({ kind: 'object', id: tileOwner(h.a.store.state, bsp.x, bsp.z), x: bsp.x, z: bsp.z });
  assert.equal(f.ctl.riding, null, 'off the horse to sit');
});

test('avatar: riding walks at x1.8 and the presence frames carry tool "horse" (the partner sees the rider)', () => {
  let t = 1000;
  const frames = [];
  const sent = [];
  const poses = [];
  const view = { me: { update: (p) => poses.push({ ...p }) }, onFrame(fn) { frames.push(fn); } };
  const av = createAvatar({ view, send: (m) => sent.push(m), pid: 'p1', clock: () => t });
  const run = (ms) => { for (let k = 0; k < ms / 16; k++) { t += 16; for (const fn of frames) fn(0.016, t); } };
  run(32);
  av.setTool('sickle');
  av.setRiding(true);
  run(80);
  assert.equal(sent.at(-1).tool, RIDE_TOOL, 'mounted: the tool slot says horse');
  assert.equal(poses.at(-1).ride, true, 'my own view gets ride: true');
  const x0 = av.pose.x;
  av.walkTo(x0 + 11, av.pose.z, 1, 1);
  run(1000);
  const moved = av.pose.x - x0;
  assert.ok(Math.abs(moved - AVATAR_SPEED * RIDE_SPEED_K) < 0.15, `rode ${moved.toFixed(2)} tiles in 1 s`);
  av.setRiding(false);
  run(80);
  assert.equal(sent.at(-1).tool, 'sickle', 'on foot again: the real tool');
});

// ---- decor sets ------------------------------------------------------------------------------------------------------
test('placeSet: the set comes out piece by piece; the build hint says how many and whether the spot is in range', async () => {
  globalThis.window ??= eventTarget();
  const set = [...CONTENT.decorSets.values()].find((x) => x.m === 'M1b' && x.pieces.every((p) => defOf(p)));
  assert.ok(set, 'an M1b decor set');
  const h = coopHarness();
  level(h, Math.max(set.unlock, ...set.pieces.map((p) => defOf(p).unlock ?? 1)));
  const f = await fakeController(h.a);
  const builds = [];
  f.ctl.on('build', (e) => { if (e) builds.push(e); });
  if (!set.pieces.every((p) => defOf(p) && (defOf(p).m === 'M1a' || defOf(p).m === 'M1b'))) return;
  const live = (await import('../shared/content/index.js')).isLive;
  if (!live(set)) {
    assert.equal(f.ctl.placeSet(set.id), false, 'a set that is not live yet is not offered');
    return;
  }
  assert.equal(f.ctl.placeSet(set.id), true);
  assert.equal(f.ctl.tool.build.def, set.pieces[0]);
  const sp = spotFor(h.a.store.state, set.pieces[0], 30, 30);
  f.move(sp.x, sp.z);
  f.click(sp.x, sp.z);
  h.flush();
  assert.ok(Object.values(h.state.farm.objects).some((o) => o.def === set.pieces[0]), 'the first piece stands');
  const out = new Set(Object.values(h.a.store.state.farm.objects).map((o) => o.def));
  const next = set.pieces.find((x) => !out.has(x));
  assert.equal(f.ctl.tool.build.def, next, 'the next piece that is not out yet follows (a starter fence counts as out)');
  f.move(sp.x + 3, sp.z);
  const hint = builds.at(-1);
  assert.equal(hint.set.id, set.id);
  const { footprint } = await import('../shared/rules/grid.js');
  const [w, d] = footprint(defOf(next), 0);
  const want = setSpot(h.a.store.state, set, hint.x, hint.z, w, d, next);
  assert.deepEqual([hint.set.placed, hint.set.near], [want.out, want.near], 'the hint is the set search at the ghost');
  assert.ok(hint.set.placed >= 1, 'the first piece is out');
  f.move(sp.x + 3 + set.radius + 4, sp.z);
  assert.equal(builds.at(-1).set.near, false, 'too far from the first piece');
});

test('setSpot: in range = one copy of every other piece can be picked within the radius of this spot and of each other', () => {
  const set = { id: 's', radius: 6, pieces: ['bird_bath', 'flower_bed', 'wheelbarrow'] };
  const objects = { a: { def: 'bird_bath', x: 10, z: 10, rot: 0 }, b: { def: 'flower_bed', x: 15, z: 10, rot: 0 },
    // a second flower bed far away (like the starter farm's fences: many copies, most of them elsewhere)
    c: { def: 'flower_bed', x: 40, z: 40, rot: 0 } };
  const state = { farm: { objects } };
  const r1 = setSpot(state, set, 13, 12, 1, 1, 'wheelbarrow');
  assert.equal(r1.near, true);
  assert.deepEqual(r1.ids.sort(), ['a', 'b'], 'the copies it would join');
  assert.equal(r1.out, 2, 'two of three pieces are out');
  assert.equal(setSpot(state, set, 3, 10, 1, 1, 'wheelbarrow').near, false, 'near a but 11 from the nearest flower bed');
  // two pieces each in range of the spot but 12 apart from each other: no group
  const apart = { farm: { objects: { a: { def: 'bird_bath', x: 10, z: 10, rot: 0 }, b: { def: 'flower_bed', x: 22, z: 10, rot: 0 } } } };
  assert.equal(setSpot(apart, set, 16, 10, 1, 1, 'wheelbarrow').near, false);
});

// ---- world places --------------------------------------------------------------------------------------------------------
test('a Hand click on a live world place opens its panel with its args (Fair tent, barge, village, restoration)', async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  const opened = [];
  const ui = { panels: { has: () => true, open: (n, a) => opened.push([n, a]), top: () => null } };
  const f = await fakeController(h.a, { ui, view: { pick: () => ({ kind: 'tile', x: 70, z: 70, px: 70.5, pz: 70.5, place: 'restoration', placeArgs: { id: 'greenhouse' } }) } });
  f.click(70, 70);
  assert.deepEqual(opened.at(-1), ['restoration', { id: 'greenhouse' }]);
});

// ---- sounds ----------------------------------------------------------------------------------------------------------------
test('every live species has its call and its sample; the M1b buildings have their own recipe sounds', () => {
  for (const a of CONTENT.animals.values()) {
    if (a.m !== 'M1a' && a.m !== 'M1b') continue;
    assert.ok(SPECIES_SOUND[a.sound], `${a.id}: sound ${a.sound}`);
    assert.ok(MANIFEST.sounds[SPECIES_SOUND[a.sound]], `${a.id}: ${SPECIES_SOUND[a.sound]} in the manifest`);
    assert.ok(CALLS[a.id] && MANIFEST.sounds[CALLS[a.id]], `${a.id}: ambience call`);
  }
  for (const [b, snd] of Object.entries(BUILDING_SOUND)) {
    assert.ok(defOf(b), `building ${b}`);
    assert.ok(MANIFEST.sounds[snd], `${snd} in the manifest`);
  }
  for (const n of ['fanfare', 'barge_horn', 'crate', 'ferry_bell', 'find', 'bundle', 'lights_on', 'giant_fall', 'dig', 'splash', 'hooves',
    'amb_water', 'amb_bells', 'woof', 'meow']) assert.ok(MANIFEST.sounds[n], n);
  assert.equal(MANIFEST.sounds.hooves.loop, true);
  assert.equal(MANIFEST.sounds.amb_water.loop, true);
});

test('village bells ring once a Town Project stands (built time in the past)', () => {
  assert.equal(villageBuilt({ farm: {} }, 10), 0);
  assert.equal(villageBuilt({ farm: { town: { built: { chapel: 5, bandstand: 50 } } } }, 10), 1);
  assert.equal(villageBuilt({ farm: { town: { n: 2, cur: null } } }, 10), 2, 'the rules count built projects in town.n');
  assert.equal(villageBuilt({ farm: { town: { n: 0, cur: { id: 'chapel' } } } }, 10), 0);
  void cropOf;
});

test('every sound the feedback layer plays for an event is a real sample (M1b events and their aliases included)', () => {
  const state = { farm: { objects: { a1: { def: 'pig', home: 'h' }, a2: { def: 'duck', home: 'h' } } }, players: {} };
  const names = new Set([...Object.keys(ECON_EVENTS), ...Object.keys(GOALS_EVENTS), ...CELEBRATIONS,
    'giant', 'giantFormed', 'giantChopped', 'giantFelled', 'fairEntered', 'fairMedal', 'fairCeremony', 'bargeDocked', 'bargeCastOff',
    'bargeLoaded', 'bargeRow', 'bargeFlagged', 'albumFind', 'found', 'collectionDone', 'albumSet', 'donated', 'bundleDone', 'projectDone',
    'townBuilt', 'townGiven', 'townFunded', 'masterworked', 'beautyStar', 'decorSet', 'colonyCycle']);
  const missing = [];
  for (const e of names) {
    for (const ev of [{ e, id: 'a1', animal: 'pig', building: 'sewing' }, { e, id: 'a2', animal: 'duck', building: 'kitchen' }]) {
      for (const [snd] of soundsOf(ev, state)) if (!MANIFEST.sounds[snd]) missing.push(`${e} -> ${snd}`);
    }
  }
  assert.deepEqual(missing, []);
  // the M1b moments are not silent
  for (const e of ['giantFelled', 'fairEntered', 'bargeLoaded', 'bargeRow', 'donated', 'bundleDone', 'projectDone', 'townBuilt', 'masterworked']) {
    assert.ok(soundsOf({ e }, state).length > 0, `${e} plays something`);
  }
  assert.deepEqual(soundsOf({ e: 'collected', id: 'a1', animal: 'pig' }, state).map(([n]) => n), ['dig', 'oink'], 'a truffle dig');
  assert.deepEqual(soundsOf({ e: 'collected', id: 'a2', animal: 'duck' }, state).map(([n]) => n), ['splash', 'quack']);
  assert.deepEqual(soundsOf({ e: 'queued', building: 'sewing' }, state).map(([n]) => n), ['sew']);
});

test('the Hand on a pet pets it once a day, then gives its treat; afterwards it says so (never a silent dead click)', async () => {
  globalThis.window ??= eventTarget();
  const { petsLive } = await import('../shared/rules/actions/pets.js');
  const h = coopHarness();
  level(h, 12);
  for (const s of [h.state, h.a.store.state, h.b.store.state]) {
    s.players.p2.pet = { kind: 'dog', name: 'Biscuit', at: h.clock.now(), fed: null, pets: null, treasure: null };
    s.farm.inventory.dog_biscuit = 2;
  }
  const f = await fakeController(h.a);
  const seq0 = h.a.store.seq;
  const pick = { kind: 'pet', owner: 'p2', x: 30, z: 30, px: 30.5, pz: 30.5 };
  f.ctl.actOn(pick);
  if (!petsLive(h.a.store.state)) {
    assert.equal(h.a.store.seq, seq0, 'pets not live in this build: nothing is sent');
    assert.equal(f.toasts.length, 0, 'and no misleading line');
    return;
  }
  assert.equal(h.a.store.state.players.p2.pet.pets?.by?.includes('p1'), true, 'petted');
  f.ctl.actOn(pick);
  assert.notEqual(h.a.store.state.players.p2.pet.fed, null, 'the second click gives the treat');
  f.ctl.actOn(pick);
  assert.match(String(f.toasts.at(-1)?.[0]), /Biscuit/);
});

test('the Fair ceremony plays the fanfare and the festive piece once per Fair week, live or from the queued card', async () => {
  const { createFeedback } = await import('../public/js/game/feedback.js');
  const L = {};
  const store = { on: (n, fn) => { (L[n] ??= []).push(fn); return () => {}; }, state: { farm: { objects: {} }, players: {}, meta: {} }, pid: 'p1',
    now: () => 0 };
  const P = {};
  const ui = { toast() {}, notice() {}, panels: { on: (n, fn) => { (P[n] ??= []).push(fn); } } };
  let festive = 0;
  const audio = { play() {}, ladder() {}, coins() {}, duck() {}, setScene() {}, festive: () => { festive++; } };
  const fb = createFeedback({ store, controller: { on() { return () => {}; }, stroke: null }, view: { toScreen: () => ({ visible: true, x: 0 }), fx: { play() {} }, stats: () => ({}) }, audio, ui });
  const fx = (ev, local = false) => { for (const fn of L.fx ?? []) fn({ ev, by: 'sys', local }); };
  fx({ e: 'fairCeremony', w: 2900, medal: 'silver_1' });
  assert.equal(festive, 1, 'the live ceremony');
  fx({ e: 'fairCeremony', w: 2900, medal: 'silver_1' });
  for (const fn of P.open ?? []) fn('fairCeremony', { ev: { e: 'fairCeremony', w: 2900 } });
  assert.equal(festive, 1, 'the same week: the card opening after it stays quiet');
  for (const fn of P.open ?? []) fn('fairCeremony', { ev: { e: 'fairCeremony', w: 2901 } });
  assert.equal(festive, 2, 'next week (the queued card of a partner who was away) plays again');
  fx({ e: 'fairCeremony', w: 2902 }, true);
  assert.equal(festive, 2, 'a predicted (local) event never celebrates');
  fb.dispose();
});

test('the Memory Book keeps a picture per confirmed page, once; a photo page keeps the photo just taken', async () => {
  const { createMemory, openPictures } = await import('../public/js/game/memory.js');
  const L = {};
  const store = { on: (n, fn) => { (L[n] ??= []).push(fn); }, state: { meta: { farmSeed: 7 } }, pid: 'p1' };
  let captures = 0;
  const view = { capture: async () => { captures++; return new Blob([`shot${captures}`], { type: 'image/png' }); } };
  const mem = createMemory({ store, view, idb: null });
  const fx = (ev, local = false) => { for (const fn of L.fx) fn({ ev, by: ev.by, local }); };
  fx({ e: 'memoryPage', n: 0, k: 'level', by: 'sys' }, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(captures, 0, 'a predicted page takes no picture (it may still be refused)');
  fx({ e: 'memoryPage', n: 0, k: 'level', by: 'sys' });
  fx({ e: 'memoryPage', n: 0, k: 'level', by: 'sys' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(captures, 1, 'one snapshot per page');
  assert.equal(mem.count(), 1);
  mem.photo(new Blob(['my photo'], { type: 'image/png' }));
  fx({ e: 'memoryPage', n: 1, k: 'photo', by: 'p1' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(captures, 1, 'the photo page keeps the photo, no new snapshot');
  const pics = openPictures(null);
  await pics.put('k', new Blob(['x']));
  assert.ok(await pics.get('k'), 'works without IndexedDB (private mode)');
  assert.equal(await mem.picture(5), null, 'a page this browser never saw has no picture');
  assert.ok(typeof (await mem.picture(1)) === 'string', 'an object URL for a kept page');
});
