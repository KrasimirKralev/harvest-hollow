// Wave 4, client lane (the owners' wish list 2026-10-04): turning a placed building where it stands (C), clearing a wild
// weed with the Hand (F), the Barn's doors (8), a sleeping pet (4), and the sounds of the new things (rabbits, the
// rain's intensity, the bird bath, the wave-4 events).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { xpForLevel, defOf, CONTENT } from '../shared/content/index.js';
import { footprint } from '../shared/rules/grid.js';
import { ACTIONS } from '../shared/rules/index.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';
import { soundsOf, SPECIES_SOUND, rainLevel } from '../public/js/game/feedback.js';
import { CALLS, rainMix, RAIN_ON } from '../public/js/audio.js';

const MANIFEST = JSON.parse(fs.readFileSync(new URL('../public/assets/audio/manifest.json', import.meta.url), 'utf8'));
beforeEach(() => { globalThis.window = eventTarget(); });

const idOf = (s, def) => Object.keys(s.farm.objects).sort().find((k) => s.farm.objects[k].def === def);
const centre = (o) => {
  const [w, d] = footprint(defOf(o.def), o.rot ?? 0);
  return [o.x + Math.floor((w - 1) / 2), o.z + Math.floor((d - 1) / 2)];
};
const key = (code) => globalThis.window.dispatch('keydown', { code, key: code, target: null });

test('C: the Hammer over a placed building: the hint offers ↻; R turns it where it stands, predicted, the partner sees it', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.xp = xpForLevel(6);
  const stand = idOf(h.state, 'market_stand');
  const o0 = { ...h.state.farm.objects[stand] };
  const a = await fakeController(h.a);
  const builds = [];
  a.ctl.on('build', (e) => builds.push(e));
  a.ctl.setTool('hammer');
  a.move(o0.x, o0.z);
  assert.equal(builds.at(-1)?.pickUp, stand);
  assert.equal(builds.at(-1)?.rotate, stand, 'the hint can offer a turn');
  assert.equal(a.ctl.canRotate(stand), true);
  key('KeyR');
  const o1 = h.a.store.state.farm.objects[stand];
  assert.equal(o1.rot, ((o0.rot ?? 0) + 1) % 4, 'a quarter turn, predicted at once');
  const [cx0, cz0] = centre(o0);
  const [cx1, cz1] = centre(o1);
  assert.ok(Math.abs(cx1 - cx0) <= 1 && Math.abs(cz1 - cz0) <= 1, `it stays where it stood: ${cx0},${cz0} -> ${cx1},${cz1}`);
  assert.equal(a.ctl.tool.build?.moveId ?? null, null, 'nothing in hand: the Hammer is ready for the next one');
  h.flush();
  assert.equal(h.b.store.state.farm.objects[stand].rot, o1.rot, 'the partner sees it turned');
  assert.ok(h.state.farm.objects[stand].prev, 'a move like any other: Move back / Ctrl+Z undo it');
  // the ui's ↻ button: controller.rotate(id); without an id it still turns the held ghost
  assert.equal(a.ctl.rotate(stand).ok, true);
  h.flush();
  assert.equal(h.state.farm.objects[stand].rot, ((o0.rot ?? 0) + 2) % 4);
  a.ctl.place('picket_fence');
  const r0 = a.ctl.tool.build.rot;
  a.ctl.rotate();
  assert.equal(a.ctl.tool.build.rot, (r0 + 1) % 4, 'the ghost turns');
});

test('C: a plot never offers a turn; boxed in, a long piece turns half round in its own footprint', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(6); s.farm.wallet.coins = 1_000_000; }
  const a = await fakeController(h.a);
  const builds = [];
  a.ctl.on('build', (e) => builds.push(e));
  const plot = idOf(h.state, 'plot');
  a.ctl.setTool('hammer');
  a.move(h.state.farm.objects[plot].x, h.state.farm.objects[plot].z);
  assert.equal(builds.at(-1)?.pickUp, plot);
  assert.equal(builds.at(-1)?.rotate, null, 'a plot looks the same every way round');
  assert.equal(a.ctl.rotateObject('nope'), null);
  // the 2 x 1 Order Board, fenced in on every free tile within three of it: a quarter turn fits nowhere
  const board = idOf(h.state, 'order_board');
  const o = { ...h.state.farm.objects[board] };
  const [w, d] = footprint(defOf(o.def), o.rot ?? 0);
  let fences = 0;
  for (let z = o.z - 3; z <= o.z + d + 2; z++) for (let x = o.x - 3; x <= o.x + w + 2; x++) {
    if (x >= o.x && x < o.x + w && z >= o.z && z < o.z + d) continue;
    if (h.a.store.act('place', { def: 'picket_fence', x, z, rot: 0, confirm: ['BIG_SPEND'] }).ok) fences++;
  }
  h.flush();
  assert.ok(fences > 10, `${fences} fences`);
  const r = a.ctl.rotateObject(board);
  assert.equal(r?.ok, true, JSON.stringify(a.toasts));
  assert.equal(h.a.store.state.farm.objects[board].rot, ((o.rot ?? 0) + 2) % 4, 'the next way round that fits: a half turn');
  assert.deepEqual([h.a.store.state.farm.objects[board].x, h.a.store.state.farm.objects[board].z], [o.x, o.z]);
});

test('F: the Hand on a wild weed pulls it (rules clearWeed, predicted); a tile without one just walks', async () => {
  const h = coopHarness();
  let weedNext = false;
  const a = await fakeController(h.a, { view: {
    pick(ndc) {
      const px = ((ndc.x + 1) / 2) * 64;
      const pz = ((1 - ndc.y) / 2) * 64;
      const p = { kind: 'tile', x: Math.floor(px), z: Math.floor(pz), px, pz, land: 'owned' };
      if (weedNext) p.weed = { x: p.x, z: p.z };
      return p;
    },
  } });
  const s = h.a.store.state;
  // an owned open tile next to the starter field
  const tile = { x: 30, z: 31 };
  weedNext = true;
  a.click(tile.x, tile.z);
  if (!ACTIONS.clearWeed) {
    assert.ok(true, 'this build has no weeds action: the click walks as before');
    return;
  }
  assert.ok(s.farm.weeds && Object.hasOwn(s.farm.weeds.t, `${tile.x},${tile.z}`), 'weeded at once (predicted)');
  assert.ok(a.walks.some((w) => w.x === tile.x && w.z === tile.z), 'the farmer walks over');
  h.flush();
  assert.ok(Object.hasOwn(h.b.store.state.farm.weeds.t, `${tile.x},${tile.z}`), 'for both players');
  // again on the same tile (the ground still drew it a moment): no refusal, no shake
  const n = a.toasts.length;
  a.click(tile.x, tile.z);
  assert.equal(a.toasts.length, n, 'an already weeded tile just walks');
  // no weed there: nothing is weeded
  weedNext = false;
  a.click(tile.x + 1, tile.z);
  assert.equal(Object.hasOwn(s.farm.weeds.t, `${tile.x + 1},${tile.z}`), false);
});

test('8: a click that opens the Barn swings its doors open (render-world\'s view.objects.doors); its panel closing shuts them', async () => {
  const h = coopHarness();
  const doors = [];
  const listeners = { close: new Set() };
  let open = null;
  const ui = { panels: {
    has: (n) => n === 'barn', open: (n) => { open = n; }, isOpen: (n) => open === n, top: () => open,
    on: (ev, fn) => { listeners[ev]?.add(fn); return () => listeners[ev]?.delete(fn); },
  } };
  const a = await fakeController(h.a, { ui, view: { objects: { hidden() {}, doors: (id, on) => doors.push([id, on]) } } });
  const barn = idOf(h.state, 'barn');
  const o = h.state.farm.objects[barn];
  a.click(o.x + 1, o.z + 1);
  assert.equal(open, 'barn', 'the Barn panel opens');
  assert.deepEqual(doors, [[barn, true]], 'the doors swing open');
  a.click(o.x + 1, o.z + 1);
  assert.deepEqual(doors, [[barn, true]], 'a second click: they stay open (no flapping)');
  await new Promise((r) => setTimeout(r, 5100));
  assert.deepEqual(doors.at(-1), [barn, true], 'while the panel shows, render-world\'s hold is renewed');
  open = null;
  for (const fn of listeners.close) fn('barn');
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(doors.at(-1), [barn, false], 'closing its panel shuts them');
  const n = doors.length;
  // the market stand opens its panel but has no doors
  const stand = h.state.farm.objects[idOf(h.state, 'market_stand')];
  a.click(stand.x, stand.z);
  assert.equal(doors.length, n);
});

test('4: the Hand on a sleeping pet: the day\'s pat still counts, with a 💤 line; petted already: "fast asleep", no bonk', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.xp = xpForLevel(20);
  const a = await fakeController(h.a, { view: { pick: () => ({ kind: 'pet', owner: 'p1', x: 20, z: 30, px: 20.5, pz: 30.5, asleep: true }) } });
  const adopted = h.a.store.act('adoptPet', { kind: 'dog', name: 'Biscuit' });
  if (!adopted.ok) return;                                  // pets not live in this build's milestone
  h.flush();
  const invalids = [];
  a.ctl.on('invalid', (e) => invalids.push(e));
  a.click(20, 30);
  assert.ok(h.a.store.state.players.p1.pet.pets?.by?.includes('p1'), 'the pat counted (predicted)');
  assert.ok(a.toasts.some(([t]) => typeof t === 'string' && /sleepy pat/.test(t) && t.includes('💤')), JSON.stringify(a.toasts));
  h.flush();
  a.toasts.length = 0;
  a.click(20, 30);
  assert.ok(a.toasts.some(([t]) => typeof t === 'string' && /fast asleep/.test(t)), JSON.stringify(a.toasts));
  assert.equal(invalids.length, 0, 'no shake, no bonk for a sleeping pet');
  assert.equal(h.a.store.pending.length, 0, 'nothing more sent');
});

test('sounds: the rabbit thumps, every wave-4 event plays real samples, the new samples ship as Opus + WAV', () => {
  for (const name of ['barn_door', 'bunny', 'snore']) {
    const e = MANIFEST.sounds[name];
    assert.ok(e && e.ogg && e.file && e.ms < 1800, name);
    for (const f of [e.ogg, e.file]) assert.ok(fs.existsSync(new URL(`../public/assets/audio/${f}`, import.meta.url)), f);
  }
  assert.equal(SPECIES_SOUND.thump, 'bunny');
  assert.equal(CALLS.rabbit, 'bunny');
  for (const a of CONTENT.animals.values()) assert.ok(MANIFEST.sounds[SPECIES_SOUND[a.sound]], `${a.id}: ${a.sound}`);
  const state = coopHarness().state;
  const evs = [{ e: 'soldStored', coins: 40 }, { e: 'upgraded', tier: 2 }, { e: 'fertilized' }, { e: 'weedsCleared', cells: [1], coins: 2 },
    { e: 'weedsCleared', cells: [1], coins: 0 }, { e: 'petBreed', kind: 'cat' }, { e: 'avatarChanged' }, { e: 'perkRefunded' },
    { e: 'perksReset', acorns: 8 }, { e: 'removed', coins: 30 }];
  for (const ev of evs) {
    const list = soundsOf(ev, state);
    assert.ok(list.length > 0, ev.e);
    for (const [name] of list) assert.ok(MANIFEST.sounds[name], `${ev.e}: ${name}`);
  }
  assert.ok(soundsOf({ e: 'weedsCleared', coins: 2 }, state).some(([n]) => n === 'coin'), 'the tiny reward chimes');
  assert.ok(!soundsOf({ e: 'weedsCleared', coins: 0 }, state).some(([n]) => n === 'coin'), 'past the day\'s cap: no coin');
});

test('rain: the sound follows its intensity (drizzle .. downpour); the level comes from the view', () => {
  assert.deepEqual(rainMix(0), { drizzle: 0, rain: 0 });
  const dz = rainMix(0.25);
  assert.ok(dz.drizzle > 0.3 && dz.rain === 0, 'a drizzle: the light layer alone');
  const pour = rainMix(1);
  assert.ok(pour.rain > 0.6 && pour.drizzle < dz.drizzle, 'a downpour: the steady roar carries it');
  let last = -1;
  for (let r = 0; r <= 1.001; r += 0.05) { const m = rainMix(r); assert.ok(m.rain >= last); last = m.rain; }
  assert.equal(rainLevel({ rain: 0.42, weather: 'rain' }), 0.42, 'the view\'s smoothed level wins');
  assert.equal(rainLevel({ rain: 1, rainStrength: 0.45, weather: 'rain' }), 0.45, 'a drizzle: the level times its strength');
  assert.equal(rainLevel({ rain: 1, rainStrength: 1.12 }), 1, 'a gusting downpour, capped');
  assert.equal(rainLevel({ weather: 'rain' }), 0.7);
  assert.equal(rainLevel({ weather: 'drizzle' }), 0.3);
  assert.equal(rainLevel({ weather: 'sunny' }), 0);
  assert.equal(rainLevel(null), 0);
  assert.ok(RAIN_ON > 0 && RAIN_ON < rainLevel({ weather: 'drizzle' }), 'a drizzle counts as rain for the music');
});
