// M2 input (wave 3, client lane): the Fishing Dock's calm cast (GDD §6.2 #21), the Breeding Barn's matchmaker and the
// Nursery's care steps (§3.4), the farmhouse room's furniture (§5.9 Restoration 6), the Friendly Duel's invitation, the
// perk point, and the M2 sounds (the alpaca's hum, the cast / bite / reel / splash, the horse show's post horn, the
// duel's bell and crown, the room's fire and clock). Pure parts always run; the flows through the real controller and
// the real rules run when the M2 systems are live in this build (MILESTONE 'M2'), and are skipped with the reason
// otherwise (the client lane runs them on a copy of the tree with the milestone flipped as well).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { castPhase, CAST, isDockDef, dockOf, waterPoint, seatPoint, ROD_TOOL, pondSpot, turn } from '../public/js/game/fishing.js';
import { phaseText, catchTitle, starsOf, fmtWait } from '../public/js/game/fishing-hud.js';
import { pairable, partnersFor, animalName, pairWords } from '../public/js/game/pairing.js';
import { spotFor, interiorOpenNow, PIECE_PANELS } from '../public/js/game/interior.js';
import { inviteLine } from '../public/js/game/m2-moments.js';
import { describe, verbsFor, CLIENT_VERBS, ONCE_VERBS, dockText } from '../public/js/game/targets.js';
import { SPECIES_SOUND, STEP_SOUND, soundsOf, horseShowRan } from '../public/js/game/feedback.js';
import { createAvatar } from '../public/js/game/avatar.js';
import { CALLS, INDOOR_K } from '../public/js/audio.js';
import { CONTENT, FISHING, DUEL, INTERIOR, NURSERY, BREEDING, isLive, xpForLevel, defOf, furnitureOf, animalOf, featureOf }
  from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';

const MANIFEST = JSON.parse(fs.readFileSync(new URL('../public/assets/audio/manifest.json', import.meta.url), 'utf8'));
const M2_SOUNDS = ['hum', 'cast', 'reel', 'plop', 'bite', 'fish_splash', 'show_fanfare', 'duel_start', 'duel_win', 'amb_interior',
  'door', 'furnish', 'brush', 'squeak', 'perk'];
const fishingLive = isLive(FISHING) && isLive(featureOf('fishing') ?? FISHING);
const breedingLive = isLive(BREEDING) && isLive(featureOf('breeding'));
const nurseryLive = isLive(NURSERY) && isLive(featureOf('nursery'));
const interiorLive = isLive(INTERIOR);
const notLive = (what) => `${what} is not live in this build (MILESTONE before M2): run on the M2 copy`;

/** Put the same object into the server state and both clients' predicted states (a fixture, not an action). */
function inject(h, id, o) {
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.objects[id] = structuredClone(o);
}
function each(h, fn) { for (const s of [h.state, h.a.store.state, h.b.store.state]) fn(s); }
function level(h, L) { each(h, (s) => { s.farm.xp = xpForLevel(L); s.farm.wallet.coins = 2_000_000; }); }
function spotFor2(state, def, x0 = 14, z0 = 14) {
  for (let z = z0; z < 60; z++) for (let x = x0; x < 60; x++) if (canPlace(state, def, x, z, 0) === null) return { x, z };
  throw new Error(`no spot for ${def}`);
}

// ---- sounds ----------------------------------------------------------------------------------------------------------
test('every M2 sound ships as Ogg Opus with its WAV; the reel and the room are seamless loops', () => {
  for (const name of M2_SOUNDS) {
    const e = MANIFEST.sounds[name];
    assert.ok(e, `${name} is in the manifest`);
    assert.ok(e.ogg && e.file, `${name} has Ogg and WAV`);
    for (const f of [e.ogg, e.file]) assert.ok(fs.existsSync(new URL(`../public/assets/audio/${f}`, import.meta.url)), f);
  }
  assert.equal(MANIFEST.sounds.reel.loop, true);
  assert.equal(MANIFEST.sounds.amb_interior.loop, true);
  assert.ok(MANIFEST.sounds.hum.ms < 1500 && MANIFEST.sounds.plop.ms < 600 && MANIFEST.sounds.furnish.ms < 500, 'short, soft sounds');
});

test('the alpaca hums: its distant call and its species sound are real samples; every species has one', () => {
  assert.equal(CALLS.alpaca, 'hum');
  assert.equal(SPECIES_SOUND.hum, 'hum');
  for (const a of CONTENT.animals.values()) {
    const s = SPECIES_SOUND[a.sound];
    assert.ok(s && MANIFEST.sounds[s], `${a.id}: sound ${a.sound} -> ${s}`);
  }
  assert.ok(INDOOR_K > 0 && INDOOR_K < 0.5, 'indoors the farm is heard through the walls');
});

test('every M2 event plays real samples (fishing, nursery, breeding, the room, the duel, perks, the track, Grandma)', () => {
  const state = coopHarness().state;
  const evs = [
    { e: 'fishCast' }, { e: 'fishCaught', grade: 2 }, { e: 'fishCaught', record: true }, { e: 'fishTogether' },
    ...['feed', 'play', 'groom'].map((step) => ({ e: 'nursed', step, animal: 'cow' })), { e: 'nurseDone', animal: 'alpaca' },
    { e: 'breedStarted', species: 'alpaca' }, { e: 'breedCancelled' }, { e: 'bred', golden: true, animal: 'cow' },
    { e: 'animalNamed' }, { e: 'furnished' }, { e: 'furnishMoved' }, { e: 'furnishStored' }, { e: 'furnishRefunded' },
    { e: 'interiorOpened' }, { e: 'duelInvited' }, { e: 'duelAccepted' }, { e: 'duelDeclined' }, { e: 'duelEnded', scored: true },
    { e: 'perkPicked' }, { e: 'perksReset' }, { e: 'trackTier' }, { e: 'trackClaimed' }, { e: 'coatWorn' },
    { e: 'grandmaArrived' }, { e: 'grandmaLeft' }, { e: 'bottled', partner: true },
  ];
  for (const ev of evs) {
    const list = soundsOf(ev, state);
    assert.ok(list.length > 0, `${ev.e} makes a sound`);
    for (const [name] of list) assert.ok(MANIFEST.sounds[name], `${ev.e}: ${name} is a sample`);
  }
  assert.deepEqual(soundsOf({ e: 'nursed', step: 'play' }, state).map(([n]) => n)[0], 'squeak');
  assert.deepEqual(soundsOf({ e: 'nursed', step: 'groom' }, state).map(([n]) => n)[0], 'brush');
  assert.deepEqual(soundsOf({ e: 'duelEnded', scored: false }, state), [], 'a duel nobody scored in ends quietly');
  for (const list of Object.values(STEP_SOUND)) for (const [n] of list) assert.ok(MANIFEST.sounds[n]);
});

test('the horse show: the ceremony says so itself, else the closed week held Show Ribbons (feature live)', () => {
  const state = coopHarness().state;
  assert.equal(horseShowRan(state, { show: true }), true);
  assert.equal(horseShowRan(state, { show: false }), false);
  state.farm.fair = { cur: { w: 5, ent: { show_ribbon: 2 } } };
  assert.equal(horseShowRan(state, { w: 5 }), isLive(CONTENT.features.get('horse_show')));
  assert.equal(horseShowRan(state, { w: 6 }), false, 'another week');
  state.farm.fair.cur.ent = { apple_pie: 3 };
  assert.equal(horseShowRan(state, { w: 5 }), false);
});

// ---- fishing -----------------------------------------------------------------------------------------------------------
test('castPhase follows the rules\' bite: cast, wait, bite (goodMs + a little), late; after the reel: reel, done', () => {
  const c = { at: 10_000, bite: 18_000 };
  assert.equal(castPhase(10_100, c).phase, 'cast');
  assert.equal(castPhase(10_000 + CAST.castMs + 1, c).phase, 'wait');
  assert.equal(castPhase(17_999, c).phase, 'wait');
  assert.equal(castPhase(18_000, c).phase, 'bite');
  assert.equal(castPhase(18_000 + CAST.hookMs - 1, c).phase, 'bite');
  assert.equal(castPhase(18_000 + CAST.hookMs, c).phase, 'late');
  assert.ok(CAST.hookMs >= (FISHING?.goodMs ?? 1200), 'the hook window covers the rules\' good grade');
  assert.ok(CAST.lateMs + (FISHING?.biteMs?.[1] ?? 15_000) <= 20_000, 'even a missed bite reels in within the calm 20 s');
  assert.equal(castPhase(20_500, null, 20_000).phase, 'reel');
  assert.equal(castPhase(20_000 + CAST.reelMs + 10, null, 20_000).phase, 'done');
  assert.equal(castPhase(20_000 + CAST.reelMs + CAST.doneMs + 10, null, 20_000).phase, 'idle');
  // a bite that comes almost at once still shows a short cast before it
  assert.equal(castPhase(10_000, { at: 10_000, bite: 10_200 }).phase, 'cast');
  assert.equal(castPhase(10_200, { at: 10_000, bite: 10_200 }).phase, 'bite');
});

test('the card\'s words: tap on a phone, the catch by name and size, a record, the old boot, the hourly rest', () => {
  assert.match(phaseText('bite', { input: 'touch' }).sub, /Tap/);
  assert.match(phaseText('bite', { input: 'mouse' }).sub, /Space/);
  assert.equal(catchTitle({ fish: 'perch', cm: 31 }), `A 31 cm ${FISHING?.fish?.find((f) => f.id === 'perch')?.name ?? 'perch'}!`);
  assert.match(phaseText('done', { c: { fish: 'pike', cm: 99, record: true, grade: 2 } }).sub, /record/i);
  if (FISHING?.fish?.some((f) => f.joke)) {
    const boot = FISHING.fish.find((f) => f.joke);
    assert.equal(catchTitle({ fish: boot.id, cm: 28, joke: true }), `${boot.name}!`);
  }
  assert.match(phaseText('seated', { wait: 42 * 60_000 }).sub, /in 42 min/);
  assert.match(phaseText('late').title, /Still on the line/);
  assert.deepEqual([0, 1, 2].map(starsOf), [1, 2, 3]);
  assert.equal(fmtWait(65 * 60_000), 'in 1 h 5 min');
  assert.equal(fmtWait(10_000), 'in a moment');
});

test('the dock: its water lies off its end by its turn; the farmer sits at that end facing it; the rod in each phase', () => {
  const near = (p, q) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.z - q.z) < 1e-9;
  const d0 = { x: 10, z: 10, w: 2, d: 2, rot: 0 };
  // the pond_dock model: the pier runs out from the +z edge, the pond fills the -z half (rot 0)
  assert.ok(near(waterPoint(d0), { x: 10.9, z: 10.2 }), JSON.stringify(waterPoint(d0)));
  assert.ok(Math.abs(Math.abs(seatPoint(d0).f) - Math.PI) < 1e-9, 'rot 0 faces -z, out over the pond');
  assert.ok(seatPoint(d0).z > waterPoint(d0).z, 'the farmer sits on the pier, the bobber floats beyond it');
  const d1 = { ...d0, rot: 1 };
  assert.ok(near(waterPoint(d1), { x: 10.2, z: 11.1 }), JSON.stringify(waterPoint(d1)));
  assert.deepEqual(turn([0, -1], 1), [-1, 0]);
  assert.deepEqual(turn([0, -1], 2), [0, 1]);
  assert.deepEqual(turn([0, -1], 3), [1, 0]);
  for (const ph of ['seated', 'cast', 'wait', 'bite', 'late', 'reel', 'done']) assert.match(ROD_TOOL[ph], /^rod(_[a-z]+)?$/);
  const dockDef = defOf(FISHING?.spots?.decor ?? 'pond_dock');
  assert.ok(isDockDef(dockDef), 'the Fishing Dock decor is a fishing place');
  assert.ok(!isDockDef(defOf('sunset_bench')));
});

test('the Hand on a Fishing Dock fishes (a client verb, once per press); a bench still seats', () => {
  const h = coopHarness();
  level(h, 30);
  const now = h.clock.now();
  const sp = spotFor2(h.state, 'pond_dock');
  inject(h, 'dk1', { def: 'pond_dock', x: sp.x, z: sp.z, rot: 0, placedAt: now, by: 'p1' });
  const t = describe(h.a.store.state, 'dk1', now, 'p1');
  assert.equal(t.dock, true);
  assert.deepEqual(verbsFor('hand', t), ['fish']);
  assert.ok(CLIENT_VERBS.has('fish') && ONCE_VERBS.has('fish'));
  assert.deepEqual(dockOf(h.a.store.state, 'dk1'), { id: 'dk1', x: sp.x, z: sp.z, w: 2, d: 2, rot: 0 });
  const bsp = spotFor2(h.state, 'sunset_bench', 30, 30);
  inject(h, 'bn1', { def: 'sunset_bench', x: bsp.x, z: bsp.z, rot: 0, placedAt: now, by: 'p1' });
  assert.deepEqual(verbsFor('hand', describe(h.a.store.state, 'bn1', now, 'p1')), ['sit']);
  // the world tooltip's dock line: how to fish, the hour's rest, the partner fishing right now
  const s = h.a.store.state;
  assert.match(dockText(s, 'dk1', 'p1', now), /sit on the dock and cast/);
  assert.equal(dockText(s, 'bn1', 'p1', now), null);
  s.players.p1.fish = { cast: null, at: now - 20 * 60_000, day: 0 };
  assert.match(dockText(s, 'dk1', 'p1', now), /next cast in 40 min/);
  s.players.p1.fish = { cast: null, at: 0, day: 0 };
  s.players.p2.fish = { cast: { spot: 'dk1', at: now - 5000, bite: now + 4000 }, at: 0, day: 0 };
  assert.match(dockText(s, 'dk1', 'p1', now), /Mia is fishing: cast now to fish together/);
});

test('fishing, start to finish: walk on, cast, the bite on the rules\' clock, hook, the catch on both screens', { skip: fishingLive ? false : notLive('fishing') }, async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  level(h, 30);
  const now = h.clock.now();
  const sp = spotFor2(h.state, 'pond_dock');
  inject(h, 'dk1', { def: 'pond_dock', x: sp.x, z: sp.z, rot: 0, placedAt: now, by: 'p1' });
  const f = await fakeController(h.a, { onArrive: 'record' });
  const phases = [];
  f.ctl.fishing.on('phase', (e) => phases.push(e.phase));
  // the Hand on the dock: the farmer walks over first; nothing is sent before arriving
  f.ctl.actOn({ kind: 'object', id: 'dk1', x: sp.x, z: sp.z });
  assert.equal(f.ctl.fishing.active, true);
  assert.equal(h.a.toServer.length, 0, 'nothing goes out before the farmer sits');
  f.walks.at(-1).onArrive();
  assert.deepEqual(phases.slice(0, 2), ['seated', 'cast']);
  const cast = h.a.store.state.players.p1.fish.cast;
  assert.ok(cast && cast.bite > now, 'the rules rolled the bite (predicted)');
  h.flush();
  assert.equal(h.state.players.p1.fish.cast.bite, cast.bite, 'the server rolled the same bite');
  // a press before the bite only says "wait"
  const hints = [];
  f.ctl.fishing.on('hint', (e) => hints.push(e.text));
  assert.equal(f.ctl.fishing.press(), true);
  assert.match(hints.at(-1), /Wait/);
  // time passes to the bite: the frame clock turns the phase
  h.clock.set(cast.bite + 200);
  f.frame();
  assert.equal(f.ctl.fishing.phase, 'bite');
  // Space hooks it (a click or a tap would too)
  window.dispatch('keydown', { key: ' ', code: 'Space', target: null, preventDefault() {} });
  assert.equal(f.ctl.fishing.phase, 'reel');
  const caught = f.ctl.fishing.catch;
  assert.ok(caught && caught.fish && caught.grade === 2, `a perfect strike: ${JSON.stringify(caught)}`);
  h.flush();
  const rec = h.b.store.state.farm.fishing;
  assert.equal(rec.n, 1, 'the partner\'s screen has the catch');
  assert.equal(rec.records[caught.fish].by, 'p1');
  // the reel, the catch on the card, then the farmer stays seated, resting the line for an hour
  h.clock.advance(CAST.reelMs + 10);
  f.frame();
  assert.equal(f.ctl.fishing.phase, 'done');
  h.clock.advance(CAST.doneMs + 10);
  f.frame();
  assert.equal(f.ctl.fishing.phase, 'seated');
  assert.ok(f.ctl.fishing.nextAt() > h.clock.now(), 'the hourly rest');
  assert.equal(f.ctl.fishing.again(), false, 'no second cast within the hour');
  // Esc gets the farmer up
  window.dispatch('keydown', { key: 'Escape', code: 'Escape', target: null });
  assert.equal(f.ctl.fishing.active, false);
});

test('fishing: a missed bite is still a fish (it reels itself in); leaving mid-cast spends nothing', { skip: fishingLive ? false : notLive('fishing') }, async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  level(h, 30);
  const now = h.clock.now();
  const sp = spotFor2(h.state, 'pond_dock');
  inject(h, 'dk1', { def: 'pond_dock', x: sp.x, z: sp.z, rot: 0, placedAt: now, by: 'p1' });
  const f = await fakeController(h.a, { onArrive: 'now' });
  f.ctl.fishing.start('dk1');
  const cast = h.a.store.state.players.p1.fish.cast;
  h.clock.set(cast.bite + CAST.hookMs + 50);
  f.frame();
  assert.equal(f.ctl.fishing.phase, 'late');
  h.clock.set(cast.bite + CAST.lateMs + 10);
  f.frame();
  assert.equal(f.ctl.fishing.phase, 'reel', 'it reeled itself in');
  assert.equal(f.ctl.fishing.catch.grade, 0, 'grade 0: the line came back anyway, with a fish');
  // a second farmer: leaves before the bite -> no catch, no rest; the next cast is allowed at once
  const g = await fakeController(h.b, { onArrive: 'now' });
  h.flush();
  g.ctl.fishing.start('dk1');
  assert.ok(h.b.store.state.players.p2.fish.cast, 'her line is in');
  g.ctl.setTool('sickle');
  assert.equal(g.ctl.fishing.active, false, 'another tool gets her up');
  assert.equal(g.ctl.fishing.code({ id: 'dk1' }), null, 'nothing was spent: she may cast again');
});

test('the Willow Pond\'s spot: a tile next to it (or render-world\'s place) casts at the pond', { skip: fishingLive ? false : notLive('fishing') }, async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  level(h, 30);
  const pond = FISHING.spots.expansion;
  each(h, (s) => { if (!s.farm.expansions.includes(pond)) s.farm.expansions.push(pond); });
  const spot = pondSpot(h.a.store.state, pond);
  assert.ok(spot, 'the pond has its spot');
  const f = await fakeController(h.a, { onArrive: 'now' });
  f.ctl.actOn({ kind: 'tile', x: spot.x, z: spot.z, px: spot.x + 0.5, pz: spot.z + 0.6 });
  assert.equal(f.ctl.fishing.at?.pond, pond);
  assert.equal(h.a.store.state.players.p1.fish.cast?.spot, pond);
  f.ctl.fishing.stop();
  // render-world's place, with its dock's seats (tiles + facing): p1 takes the first, the bobber floats where she faces
  const seats = [{ x: 5.15, z: 28.3, f: -Math.PI / 2 }, { x: 5.15, z: 28.7, f: -Math.PI / 2 }];
  f.ctl.actOn({ kind: 'tile', x: 3, z: 3, px: 3.5, pz: 3.5, place: 'fishing', placeArgs: { pond, seats } });
  const at = f.ctl.fishing.at;
  assert.equal(at?.pond, pond, 'render-world\'s place');
  assert.deepEqual([at.x, at.z], [5.15, 28.3]);
  assert.ok(Math.abs(at.water.x - (5.15 - 1.4)) < 1e-9 && Math.abs(at.water.z - 28.3) < 1e-9, 'west of the seat, where she faces');
});

// ---- breeding and the nursery ------------------------------------------------------------------------------------------
/** A cow barn with three adult cows and a calf, Baby Bottles in the Barn. */
function barnFarm(L = 30) {
  const h = coopHarness();
  level(h, L);
  const now = h.clock.now();
  const sp = spotFor2(h.state, 'cow_barn');
  inject(h, 'cb1', { def: 'cow_barn', x: sp.x, z: sp.z, rot: 0, placedAt: now, by: 'p1', level: 2 });
  const cow = (id, adult) => inject(h, id, { def: 'cow', home: 'cb1', placedAt: now - 1e7, by: 'p1', adultAt: adult ? now - 1000 : now + 3e6,
    fedAt: adult ? now - 1000 : null, readyAt: adult ? now + 3_600_000 : null, cycle: 0, cut: 0 });
  cow('cw1', true); cow('cw2', true); cow('cf1', false);
  each(h, (s) => { s.farm.inventory.baby_bottle = 12; });
  return { h, sp, now };
}

test('pairable: grown-ups of a breedable kind; a calf not yet; partners are the other adults of its kind', () => {
  const { h, now } = barnFarm();
  const s = h.a.store.state;
  assert.equal(pairable(s, 'cw1', now), null);
  assert.equal(pairable(s, 'cf1', now), 'NOT_READY');
  assert.equal(pairable(s, 'cb1', now), 'NOT_FOUND', 'a home is no animal');
  assert.deepEqual(partnersFor(s, 'cw1', now), ['cw2']);
  assert.equal(animalName(s, 'cw1'), animalOf('cow').name);
  assert.equal(pairWords(s, 'cw1', 'cw2'), 'Two Cows');
  s.farm.names = { cw1: { name: 'Daisy', by: 'p1', at: now } };
  assert.equal(animalName(s, 'cw1'), 'Daisy');
  assert.equal(pairWords(s, 'cw1', 'cw2'), 'Daisy and a Cow');
  s.farm.names.cw2 = { name: 'Clover', by: 'p2', at: now };
  assert.equal(pairWords(s, 'cw1', 'cw2'), 'Daisy and Clover');
});

test('the matchmaker: pick one cow, then another: the breeding starts; the partner sees it; Esc ends the mode', { skip: breedingLive ? false : notLive('the Breeding Barn') }, async () => {
  globalThis.window ??= eventTarget();
  const { h, sp } = barnFarm();
  const f = await fakeController(h.a);
  const seen = [];
  f.ctl.pairing.on('pair', (p) => seen.push(p));
  assert.equal(f.ctl.pairing.start(), true);
  assert.equal(f.ctl.mode, 'pairing');
  assert.match(seen.at(-1).text, /Pick two adults/);
  assert.ok(f.calls.highlight.at(-1)[0].length >= 12, 'the eligible homes glow');
  // a click on the barn picks its first adult; a click on another cow pairs them
  f.ctl.actOn({ kind: 'object', id: 'cb1', x: sp.x, z: sp.z });
  assert.equal(f.ctl.pairing.first, 'cw1');
  assert.match(seen.at(-1).text, /Now pick another adult Cow/);
  f.ctl.actOn({ kind: 'object', id: 'cf1', x: sp.x, z: sp.z });
  assert.equal(f.ctl.pairing.first, 'cw1', 'a calf is refused, the first pick stays');
  f.ctl.actOn({ kind: 'object', id: 'cw2', x: sp.x, z: sp.z });
  assert.equal(f.ctl.pairing.active, false, `done (${JSON.stringify(f.toasts.at(-1))})`);
  assert.deepEqual({ a: h.a.store.state.farm.breed.cur.a, b: h.a.store.state.farm.breed.cur.b }, { a: 'cw1', b: 'cw2' });
  h.flush();
  assert.equal(h.b.store.state.farm.breed.cur.by, 'p1', 'the partner sees the breeding');
  assert.equal(h.b.store.state.farm.inventory.baby_bottle, 10, 'two bottles');
  // a second pair while one is in the barn: the reason, no action
  f.ctl.pairing.start('cw1');
  f.ctl.actOn({ kind: 'object', id: 'cw2', x: sp.x, z: sp.z });
  assert.match(String(f.toasts.at(-1)[0]), /one at a time/);
  window.dispatch('keydown', { key: 'Escape', code: 'Escape', target: null });
  assert.equal(f.ctl.pairing.active, false, 'Esc ends it');
});

test('the Nursery: the Hand gives a carded baby its next step first; a full card asks for the personality', { skip: nurseryLive ? false : notLive('the Nursery') }, async () => {
  globalThis.window ??= eventTarget();
  const { h, sp, now } = barnFarm(30);
  each(h, (s) => { s.farm.objects.cf1.nurse = { n: 1, at: now - 700_000, by: ['p1'] }; });
  const t = describe(h.a.store.state, 'cf1', now, 'p1');
  assert.deepEqual(t.care, { n: 1, of: 3, next: 'play', at: now - 700_000 + NURSERY.stepGapMs, picked: false });
  assert.deepEqual(verbsFor('hand', t), ['nurse', 'bottle', 'pet']);
  const opened = [];
  const ui = { panels: { has: (n) => n === 'nursery', open: (n, a) => opened.push([n, a]) } };
  const f = await fakeController(h.a, { ui });
  f.ctl.actOn({ kind: 'object', id: 'cf1', x: sp.x, z: sp.z });
  assert.equal(h.a.store.state.farm.objects.cf1.nurse.n, 2, 'the Play step');
  // the next step is 10 minutes away: the Hand bottles meanwhile (the bottle's own rules)
  const t2 = describe(h.a.store.state, 'cf1', h.a.store.now(), 'p1');
  assert.equal(t2.care.next, 'groom');
  // a full card: the Hand opens the pick
  each(h, (s) => { s.farm.objects.cf1.nurse = { n: 3, at: now, by: ['p1'] }; });
  assert.deepEqual(verbsFor('hand', describe(h.a.store.state, 'cf1', now, 'p1')), ['nursePick']);
  f.ctl.actOn({ kind: 'object', id: 'cf1', x: sp.x, z: sp.z });
  assert.deepEqual(opened.at(-1), ['nursery', { id: 'cf1', pick: true }]);
});

// ---- the farmhouse room -----------------------------------------------------------------------------------------------
test('spotFor: floor pieces centred under the pointer (turned), wall pieces on a slot or the nearer wall', () => {
  const sofa = furnitureOf('sofa');
  assert.deepEqual(spotFor(sofa, { kind: 'floor', x: 6.4, z: 3.7 }, 0), { x: 5, z: 3, rot: 0 });
  assert.deepEqual(spotFor(sofa, { kind: 'floor', x: 6.4, z: 3.7 }, 1), { x: 6, z: 2, rot: 1 });
  const painting = furnitureOf('valley_painting');
  assert.deepEqual(spotFor(painting, { kind: 'wall', wall: 'back', at: 3 }), { wall: 'back', at: 3 });
  assert.deepEqual(spotFor(painting, { kind: 'floor', x: 4.2, z: 0.5 }), { wall: 'back', at: 4 });
  assert.deepEqual(spotFor(painting, { kind: 'floor', x: 0.3, z: 5.5 }), { wall: 'left', at: 5 });
  assert.equal(spotFor(sofa, null), null);
  assert.ok(PIECE_PANELS.ribbon_wall.includes('ribbonwall'));
});

test('the room: the Hand on the farmhouse goes in once it is open; a piece placed is on the partner\'s screen', { skip: interiorLive ? false : notLive('the farmhouse room') }, async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  level(h, 36);
  const now = h.clock.now();
  const fh = Object.entries(h.state.farm.objects).find(([, o]) => o.def === 'farmhouse');
  assert.ok(fh, 'the starter farm has its farmhouse');
  assert.equal(interiorOpenNow(h.a.store.state), false, 'closed before Restoration 6');
  each(h, (s) => { s.farm.restore[INTERIOR.needsProject] = { done: now - 1000, b: {}, s: {} }; });
  assert.equal(interiorOpenNow(h.a.store.state), true);
  const ghosts = [];
  let inside = 0;
  const room = {
    enter() { inside++; }, exit() { inside--; }, ghost: (...a) => ghosts.push(a),
    pick: (ndc) => ({ kind: 'floor', x: (ndc.x + 1) * 6, z: (1 - ndc.y) * 4 }),
  };
  const f = await fakeController(h.a, { onArrive: 'now', view: { interior: room } });
  f.ctl.actOn({ kind: 'object', id: fh[0], x: fh[1].x, z: fh[1].z });
  assert.equal(f.ctl.interior.inside, true);
  assert.equal(inside, 1, 'the view went inside');
  assert.equal(f.ctl.mode, 'interior');
  // a piece from the catalog: the ghost follows the pointer over the floor, a click puts it down (bought)
  assert.equal(f.ctl.interior.place('armchair'), true);
  f.ctl.interior.hover({ x: 0.5, y: 0.25 });                     // floor tile (9, 3)
  assert.ok(ghosts.at(-1)[0] === 'armchair' && ghosts.at(-1)[2] === true, 'a green ghost');
  const coins0 = h.a.store.state.farm.wallet.coins;
  f.ctl.interior.confirm();
  const items = Object.values(h.a.store.state.farm.interior.items).filter((it) => it.def === 'armchair');
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].x, items[0].z], [9, 3]);
  assert.equal(h.a.store.state.farm.wallet.coins, coins0 - furnitureOf('armchair').cost);
  h.flush();
  assert.ok(Object.values(h.b.store.state.farm.interior.items).some((it) => it.def === 'armchair' && it.x === 9), 'the partner sees it');
  // Esc leaves (nothing held); the view comes back out
  window.dispatch('keydown', { key: 'Escape', code: 'Escape', target: null });
  assert.equal(f.ctl.interior.inside, false);
  assert.equal(inside, 0);
  // the room's door (render-world's spot) leaves too
  f.ctl.interior.enter();
  assert.equal(f.ctl.interior.inside, true);
  room.pick = () => ({ kind: 'spot', id: 'door' });
  f.ctl.interior.at({ x: 0, y: 0 });
  assert.equal(f.ctl.interior.inside, false, 'out through the door');
});

// ---- the duel and the moments -----------------------------------------------------------------------------------------
test('the duel invitation in words, from content', () => {
  const h = coopHarness();
  const line = inviteLine(h.state, { by: 'p1', kind: 'pumpkins' });
  assert.match(line, /Rowan/);
  if (DUEL?.kinds?.some((k) => k.id === 'orders' && /^[aeiou]/i.test(k.name))) {
    assert.match(inviteLine(h.state, { by: 'p1', kind: 'orders' }), / an /, 'the article goes with the duel\'s name');
  }
  assert.match(line, new RegExp(DUEL?.kinds?.find((k) => k.id === 'pumpkins')?.name ?? 'Duel'));
});

test('the partner\'s duel invitation reaches me once, with a one-click answer', { skip: isLive(DUEL) ? false : notLive('Friendly Duel') }, async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  level(h, 32);
  const { createM2Moments } = await import('../public/js/game/m2-moments.js');
  const notices = [];
  const ui = { notice: (t, o) => notices.push([t, o]), toast() {}, panels: { has: () => false } };
  const f = await fakeController(h.b);
  const m = createM2Moments({ store: h.b.store, ui, controller: f.ctl });
  const r = h.a.store.act('duelInvite', { kind: 'orders' });
  assert.equal(r.ok, true, r.code);
  h.flush();
  m.check();
  m.check();
  assert.equal(notices.length, 1, 'once');
  // the invitation is a function: a language switch while it is up asks it again (ui/toasts.js)
  assert.equal(typeof notices[0][0], 'function');
  assert.match(notices[0][0](), /Rowan challenges you/);
  notices[0][1].action.fn();
  h.flush();
  assert.equal(h.state.farm.duel.cur.ok, true, 'accepted from the notice');
  m.dispose();
});

test('world places of M2 open their panels by the ui\'s names (the horse-show ring is ui-league\'s horseShow)', async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  const opened = [];
  const ui = { panels: { has: (n) => ['horseShow', 'farmhouse'].includes(n), open: (n, a) => opened.push([n, a]) } };
  const f = await fakeController(h.a, { ui });
  f.ctl.actOn({ kind: 'tile', x: 3, z: 3, px: 3.5, pz: 3.5, place: 'horseshow', placeArgs: {} });
  assert.deepEqual(opened.at(-1), ['horseShow', {}]);
  // Grandma on the porch (render-world's place 'farmhouse' with its tab)
  f.ctl.actOn({ kind: 'tile', x: 3, z: 3, px: 3.5, pz: 3.5, place: 'farmhouse', placeArgs: { tab: 'grandma' } });
  assert.deepEqual(opened.at(-1), ['farmhouse', { tab: 'grandma' }]);
});

test('the bred baby is ready: one notice, and its button brings it home (no breeding panel: straight through the rules)', { skip: breedingLive ? false : notLive('the Breeding Barn') }, async () => {
  globalThis.window ??= eventTarget();
  const { h } = barnFarm();
  const { createM2Moments } = await import('../public/js/game/m2-moments.js');
  const notices = [];
  const ui = { notice: (t, o) => notices.push([t, o]), toast() {}, panels: { has: () => false } };
  const f = await fakeController(h.b);
  const m = createM2Moments({ store: h.b.store, ui, controller: f.ctl });
  const r = h.a.store.act('breed', { a: 'cw1', b: 'cw2' });
  assert.equal(r.ok, true, r.code);
  h.flush();
  m.check();
  assert.equal(notices.length, 0, 'not before it is ready');
  h.clock.set(h.state.farm.breed.cur.readyAt + 1000);
  m.check();
  m.check();
  assert.equal(notices.length, 1, 'once');
  assert.match(notices[0][0], /baby cow is ready in the Breeding Barn/);
  notices[0][1].action.fn();
  h.flush();
  assert.equal(h.state.farm.breed.cur, null, 'brought home');
  assert.ok(Object.values(h.state.farm.objects).some((o) => o.def === 'cow' && o.coat && o.by === 'p2'), 'the newborn with its coat, by Mia');
  m.dispose();
});

test('a personal level-up that leaves a perk point says so once, with the perks panel one click away', { skip: isLive(featureOf('perks')) ? false : notLive('perks') }, async () => {
  globalThis.window ??= eventTarget();
  const h = coopHarness();
  level(h, 30);
  const { personalLevelFromXp, xpForLevel: farmXp } = await import('../shared/content/index.js');
  // a personal level of 8: 4 points, none spent (personal thresholds are 0.6 x the farm table)
  const pxp = Math.ceil(farmXp(8) * 0.6) + 10;
  each(h, (s) => { s.players.p1.xp = pxp; });
  assert.ok(personalLevelFromXp(pxp) >= 2);
  const { createM2Moments } = await import('../public/js/game/m2-moments.js');
  const notices = [];
  const opened = [];
  const ui = { notice: (t, o) => notices.push([t, o]), toast() {}, panels: { has: (n) => n === 'perks', open: (n) => opened.push(n) } };
  const f = await fakeController(h.a);
  const m = createM2Moments({ store: h.a.store, ui, controller: f.ctl });
  h.a.store.emit('celebrate', { ev: { e: 'levelUp', scope: 'player', pid: 'p1', level: personalLevelFromXp(pxp) }, by: 'p1' });
  h.a.store.emit('celebrate', { ev: { e: 'levelUp', scope: 'player', pid: 'p1', level: personalLevelFromXp(pxp) }, by: 'p1' });
  assert.equal(notices.length, 1, 'once for the same points');
  assert.match(notices[0][0], /perk points? to spend/);
  notices[0][1].action.fn();
  assert.deepEqual(opened, ['perks']);
  m.dispose();
});
