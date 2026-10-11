// Wave 5 (the owners' wish list), the rules half: babies in the pen (pair, pairCancel, `_pen`), the dog stays home
// (petStay), and the one-time land migration onto fewer, bigger parcels (`_land`, shared/rules/land.js), proven on
// a copy of the owners' real save with a fixture land table (content's own table is checked by the same test once
// it has retired rows: `real content` below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { farmAt, give, must, run, evs, placeDef, obj, T0, HOUR, MIN } from './helpers/rules.js';
import { sys, plain, ROOT } from './helpers.js';
import { ERR } from '../shared/net/protocol.js';
import { CONTENT, animalOf, plotCapOf, levelFromXp, xpForLevel } from '../shared/content/index.js';
import { RULES_VERSION, FX_EVENTS } from '../shared/rules/index.js';
import { validateState } from '../shared/rules/state.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { occupantsOf, capacityOf, inLand, objTiles, landRects } from '../shared/rules/grid.js';
import { dueSystemActions, nextSystemDueAt } from '../shared/rules/system.js';
import { PEN, penView, pairMs, pensDue } from '../shared/rules/actions/pen.js';
import { petHomeId, petStays } from '../shared/rules/actions/pets.js';
import { homeGrowth } from '../shared/rules/actions/animals.js';
import { nextExpansion, expandCode } from '../shared/rules/actions/expansions.js';
import { ownCap } from '../shared/rules/actions/decor.js';
import { landPlan, __resetLand } from '../shared/rules/land.js';
import * as C from '../shared/content/index.js';
import { WORLD_TILES } from '../shared/content/config.js';
import { defOf } from '../shared/content/index.js';
import { backfill } from '../server/migrations.js';

const BIG = { confirm: ['BIG_SPEND'] };

test('wave 5: RULES_VERSION 13 and every new event is registered', () => {
  assert.ok(RULES_VERSION >= 13);
  for (const e of ['paired', 'pairCancelled', 'penBorn', 'petStay', 'landRedrawn']) assert.ok(FX_EVENTS.has(e), e);
});

// ---- babies in the pen ------------------------------------------------------------------------------------------

/** A farm at `level` with a coop holding `n` adult hens and some Chicken Feed. */
function henFarm(level = PEN.unlock, n = 2) {
  const s = farmAt(level);
  const coop = placeDef(s, 'coop');
  for (let i = 0; i < n; i++) must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, ...BIG });
  give(s, 'chicken_feed', 10);
  return { s, coop };
}

test('pen: the defaults are the owners\' (from about level 8, one bottle item, the species\' baby time)', () => {
  assert.equal(PEN.unlock, 8);
  assert.equal(PEN.qty, 1);
  const s = farmAt(8);
  assert.equal(pairMs(s, 'chicken', T0), animalOf('chicken').babyMs);
});

test('pen: pair refusals name what is missing', () => {
  const low = henFarm(PEN.unlock - 1);
  assert.equal(run(low.s, 'pair', { home: low.coop }).code, ERR.LOCKED);
  const one = henFarm(PEN.unlock, 1);
  assert.equal(run(one.s, 'pair', { home: one.coop }).code, ERR.NOT_FOUND, 'one hen has nobody to pair with');
  const { s, coop } = henFarm();
  assert.equal(run(s, 'pair', { home: 'nope' }).code, ERR.NOT_FOUND);
  const [a, b] = occupantsOf(s, coop);
  assert.equal(run(s, 'pair', { home: coop, a, b: a }).code, ERR.BAD_ARGS);
  assert.equal(run(s, 'pair', { home: coop, a }).code, ERR.BAD_ARGS, 'both parents or neither');
  s.farm.inventory.chicken_feed = 0;
  assert.equal(run(s, 'pair', { home: coop }).code, ERR.NO_ITEMS);
  give(s, 'chicken_feed', 3);
  must(s, 'pair', { home: coop, a, b });
  assert.equal(run(s, 'pair', { home: coop }).code, ERR.OCCUPIED, 'one pairing per home');
});

test('pen: a baby (still growing) cannot be a parent', () => {
  const s = farmAt(PEN.unlock);
  const coop = placeDef(s, 'coop');
  must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, ...BIG });
  must(s, 'buyAnimal', { def: 'chicken', home: coop, ...BIG });
  give(s, 'chicken_feed', 5);
  assert.equal(run(s, 'pair', { home: coop }).code, ERR.NOT_READY);
});

test('pen: a full home grows one room step with the pairing (price folded, `max` guards it); full grown = CAP', () => {
  const { s, coop } = henFarm();
  for (let i = occupantsOf(s, coop).length; i < capacityOf(s, coop); i++) {
    must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, ...BIG });
  }
  const g = homeGrowth(s, coop);
  assert.equal(g.code, null);
  const v = penView(s, coop, T0);
  assert.equal(v.code, null);
  assert.equal(v.coins, g.coins);
  assert.equal(run(s, 'pair', { home: coop, max: g.coins - 1, ...BIG }).code, ERR.PRICE);
  const cap = capacityOf(s, coop);
  const coins = s.farm.wallet.coins;
  const r = must(s, 'pair', { home: coop, max: g.coins, ...BIG });
  assert.equal(capacityOf(s, coop), g.next);
  assert.ok(capacityOf(s, coop) > cap);
  assert.equal(s.farm.wallet.coins, coins - g.coins);
  assert.equal(evs(r, 'homeGrew').length, 1);
  assert.equal(evs(r, 'paired')[0].step, g.coins);
  assert.deepEqual(validateState(s, { now: T0 }), []);
  // grow it to the end, fill it: then the pairing is refused with the growth's own code
  const t = T0 + animalOf('chicken').babyMs;
  sys(s, '_pen', {}, t);
  while (homeGrowth(s, coop).code === null) must(s, 'upgradeHome', { id: coop, ...BIG }, { now: t });
  for (let i = occupantsOf(s, coop).length; i < capacityOf(s, coop); i++) {
    s.farm.objects[`fill.${i}`] = { ...s.farm.objects[occupantsOf(s, coop)[0]], placedAt: T0, adultAt: T0, rcpt: undefined };
    delete s.farm.objects[`fill.${i}`].rcpt;
  }
  give(s, 'chicken_feed', 2);
  const code = homeGrowth(s, coop).code;
  assert.ok([ERR.CAP, ERR.BLOCKED, ERR.OUT_OF_BOUNDS].includes(code));
  assert.equal(run(s, 'pair', { home: coop, ...BIG }, { now: t }).code, code);
});

test('pen: pair -> after the baby time a baby appears in that home on its own; it grows like a bought baby', () => {
  const { s, coop } = henFarm();
  const [a, b] = occupantsOf(s, coop);
  const feed0 = s.farm.inventory.chicken_feed;
  const coins0 = s.farm.wallet.coins;
  const v = penView(s, coop, T0);
  assert.equal(v.code, null);
  assert.deepEqual(v.pick, [a, b]);
  assert.deepEqual(v.cost, { item: 'chicken_feed', qty: 1 });
  const r = must(s, 'pair', { home: coop });
  const ev = evs(r, 'paired')[0];
  assert.deepEqual({ home: ev.home, species: ev.species, a: ev.a, b: ev.b, item: ev.item, qty: ev.qty },
    { home: coop, species: 'chicken', a, b, item: 'chicken_feed', qty: 1 });
  assert.equal(s.farm.inventory.chicken_feed, feed0 - 1);
  assert.equal(s.farm.wallet.coins, coins0, 'cheap: one feed item, no coins');
  assert.equal(obj(s, a).rcpt, undefined, 'the parents\' full undo ends');
  const readyAt = obj(s, coop).pair.readyAt;
  assert.equal(readyAt, T0 + animalOf('chicken').babyMs);
  assert.deepEqual(validateState(s, { now: T0 }), []);
  assert.equal(dueSystemActions(s, readyAt - 1).some((d) => d.type === '_pen'), false);
  assert.equal(nextSystemDueAt(s, T0 + 1) <= readyAt, true);
  assert.ok(dueSystemActions(s, readyAt).some((d) => d.type === '_pen'));
  const before = occupantsOf(s, coop).length;
  const born = sys(s, '_pen', {}, readyAt);
  assert.equal(born.ok, true, born.code);
  const pb = evs(born, 'penBorn')[0];
  assert.equal(pb.home, coop);
  assert.equal(pb.pid, 'p1');
  assert.deepEqual(pb.parents, [a, b]);
  const baby = obj(s, pb.id);
  assert.equal(baby.def, 'chicken');
  assert.equal(baby.home, coop);
  assert.equal(baby.baby, true);
  assert.equal(baby.free, true, 'never counted as bought: the shop price does not move');
  assert.equal(baby.adultAt, readyAt + animalOf('chicken').babyMs);
  assert.equal(obj(s, coop).pair, undefined);
  assert.equal(occupantsOf(s, coop).length, before + 1);
  assert.equal(s.farm.stats.penBabies, 1);
  const row = Object.values(s.farm.feed.rows).find((x) => x.k === 'pen');
  assert.deepEqual({ by: row.by, def: row.def, id: row.id }, { by: 'p1', def: 'chicken', id: pb.id });
  assert.equal(dueSystemActions(s, readyAt).some((d) => d.type === '_pen'), false, 'the condition cleared');
  // named like any animal, by either player; bottled like any baby
  must(s, 'nameAnimal', { id: pb.id, name: 'Пиленце' }, { pid: 'p2', now: readyAt + 1 });
  must(s, 'bottle', { id: pb.id }, { now: readyAt + 2 });
  assert.deepEqual(validateState(s, { now: readyAt + 2 }), []);
  // the parents can pair again
  must(s, 'pair', { home: coop }, { now: readyAt + 3 });
});

test('pen: a baby due in a home that filled up meanwhile waits for room, then comes', () => {
  const { s, coop } = henFarm();
  must(s, 'pair', { home: coop });
  for (let i = occupantsOf(s, coop).length; i < capacityOf(s, coop); i++) {
    must(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, ...BIG });
  }
  const at = obj(s, coop).pair.readyAt;
  assert.deepEqual(pensDue(s, at), []);
  assert.equal(penView(s, coop, at).waiting, true);
  assert.equal(sys(s, '_pen', {}, at).code, ERR.NOT_READY);
  must(s, 'upgradeHome', { id: coop, ...BIG }, { now: at + 1 });
  assert.deepEqual(pensDue(s, at + 2), [coop]);
  assert.equal(sys(s, '_pen', {}, at + 2).ok, true);
});

test('pen: pairCancel before it is due gives the feed back; a due baby is not cancelled', () => {
  const { s, coop } = henFarm();
  must(s, 'pair', { home: coop });
  const feed = s.farm.inventory.chicken_feed;
  const r = must(s, 'pairCancel', { home: coop }, { pid: 'p2', now: T0 + MIN });
  assert.equal(evs(r, 'pairCancelled')[0].qty, 1);
  assert.equal(s.farm.inventory.chicken_feed, feed + 1);
  assert.equal(run(s, 'pairCancel', { home: coop }).code, ERR.NOT_FOUND);
  must(s, 'pair', { home: coop }, { now: T0 + 2 * MIN });
  assert.equal(run(s, 'pairCancel', { home: coop }, { now: T0 + 2 * MIN + animalOf('chicken').babyMs }).code,
    ERR.ALREADY_DONE);
});

test('pen: two homes due at once each get their baby in one `_pen`, ids distinct; replay is deterministic', () => {
  const { s, coop } = henFarm();
  const barn = placeDef(s, 'cow_barn', BIG);
  for (let i = 0; i < 2; i++) must(s, 'buyAnimal', { def: 'cow', adult: true, home: barn, ...BIG });
  give(s, 'baby_bottle', 3);
  must(s, 'pair', { home: coop });
  must(s, 'pair', { home: barn });
  const twin = structuredClone(plain(s));
  const at = T0 + animalOf('cow').babyMs;
  const r = sys(s, '_pen', {}, at);
  const ids = evs(r, 'penBorn').map((e) => e.id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  sys(twin, '_pen', {}, at);
  assert.deepEqual(plain(twin), plain(s));
});

// ---- the dog stays home -------------------------------------------------------------------------------------------

test('petStay: either player tells a pet to stay; it is remembered, validated and toggles back', () => {
  const s = farmAt(12);
  must(s, 'adoptPet', { kind: 'dog', name: 'Rex' });
  assert.equal(petHomeId(s, 'p1'), null, 'no doghouse: the porch (the renderer\'s sleeping bed)');
  const house = placeDef(s, 'dog_house', BIG);
  assert.equal(petHomeId(s, 'p1'), house);
  const r = must(s, 'petStay', { stay: true, owner: 'p1' }, { pid: 'p2' });
  assert.deepEqual(evs(r, 'petStay')[0], { e: 'petStay', pid: 'p1', kind: 'dog', stay: true, home: house, by: 'p2' });
  assert.equal(petStays(s, 'p1'), true);
  assert.deepEqual(validateState(s, { now: T0 }), []);
  assert.equal(run(s, 'petStay', { stay: true }).code, ERR.ALREADY_DONE);
  must(s, 'petBreed', { breed: 'husky' });
  assert.deepEqual(validateState(s, { now: T0 }), [], 'stay and breed together');
  must(s, 'petStay', { stay: false });
  assert.equal(s.players.p1.pet.stay, undefined);
  assert.equal(petStays(s, 'p1'), false);
  assert.equal(run(s, 'petStay', { stay: true }, { pid: 'p2' }).code, ERR.NOT_FOUND, 'p2 has no pet');
  assert.equal(run(s, 'petStay', { stay: 'yes' }).code, ERR.BAD_ARGS);
});

// ---- land: fewer, bigger parcels (content's model: pieces in farm.expansions, parcels bought whole) -------------

/** A copy of the owners' save (`.scratch/box-save/farm.json`, read only), else a built L18 farm like it. */
function ownersSave() {
  const f = path.join(ROOT, '.scratch/box-save/farm.json');
  if (fs.existsSync(f)) {
    const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
    const s = snap.state;
    backfill(s, { now: snap.savedAt });
    resetGrid(s);
    return { s, now: snap.savedAt + 1000 };
  }
  const s = farmAt(18);
  s.farm.expansions = ['home', 'creekside', 'old_orchard', 'cow_hill'];
  s.farm.proofs = { sunflower_rise: { at: T0, n: {} } };
  resetGrid(s);
  return { s, now: T0 };
}

const tilesOwned = (s) => {
  const out = new Set();
  for (let z = 0; z < WORLD_TILES; z++) for (let x = 0; x < WORLD_TILES; x++) if (inLand(s, x, z)) out.add(z * WORLD_TILES + x);
  return out;
};

test('land: the owners\' save completes its parcels: no tile, coin, object or plot lost; validateState []', () => {
  __resetLand();
  const { s, now } = ownersSave();
  const before = plain(s);
  const tiles0 = tilesOwned(s);
  const level = levelFromXp(s.farm.xp);
  const cap0 = ownCap(s, defOf('plot'));
  assert.deepEqual(validateState(s, { now }), [], 'the save loads as it is');
  const due = dueSystemActions(s, now);
  assert.equal(due[0]?.type, '_land', 'first, before anything reads the land');
  const r = sys(s, '_land', {}, now);
  assert.equal(r.ok, true, r.code);
  const ev = evs(r, 'landRedrawn')[0];
  assert.deepEqual(ev.from, before.farm.expansions);
  assert.deepEqual(ev.added, ['fair_lane'], 'Orchard Lane was half owned: Fairground Lane comes free');
  assert.deepEqual(s.farm.expansions, [...before.farm.expansions, 'fair_lane']);
  if (typeof C.landAfterMigration === 'function') {
    assert.deepEqual(s.farm.expansions, C.landAfterMigration(before.farm.expansions), 'the rules and content agree');
  }
  assert.deepEqual(s.farm.wallet, before.farm.wallet, 'coins and Acorns untouched');
  const tiles1 = tilesOwned(s);
  for (const k of tiles0) assert.ok(tiles1.has(k), `tile ${k} was owned and still is`);
  assert.ok(tiles1.size > tiles0.size);
  for (const id of Object.keys(before.farm.objects)) assert.ok(s.farm.objects[id], `${id} kept`);
  for (const [id, o] of Object.entries(s.farm.objects)) {
    if (!Number.isFinite(o.x)) continue;
    for (const [x, z] of objTiles(o, defOf(o.def))) assert.ok(inLand(s, x, z), `${id} inside the farm`);
  }
  assert.ok(ownCap(s, defOf('plot')) >= cap0, 'the plot cap is never lower');
  assert.equal(s.farm.proofs.sunflower_rise, undefined, 'the old piece card ...');
  assert.equal(s.farm.proofs.sunny_glade?.at, before.farm.proofs.sunflower_rise.at, '... is its parcel\'s, started then');
  if (typeof C.proofAfterMigration === 'function') {
    assert.deepEqual(s.farm.proofs, C.proofAfterMigration(before.farm.proofs, s.farm.expansions));
  }
  assert.deepEqual(validateState(s, { now }), []);
  assert.equal(landPlan(s), null, 'once');
  assert.equal(dueSystemActions(s, now).some((d) => d.type === '_land'), false);
  assert.equal(nextExpansion(s).id, 'sunny_glade');
  const row = Object.values(s.farm.feed.rows).find((x) => x.k === 'land');
  assert.deepEqual({ by: row.by, q: row.q }, { by: 'sys', q: 1 });
  void level;
});

test('land: a farm owning whole parcels (or only the Homestead) has nothing to migrate', () => {
  const s = farmAt(10);
  assert.equal(landPlan(s), null);
  s.farm.expansions = ['home', 'creekside', 'cow_hill'];
  resetGrid(s);
  assert.equal(landPlan(s), null);
  assert.equal(nextExpansion(s).id, 'orchard_lane');
});

test('land: an old piece card maps its counts onto the parcel\'s tasks (proofFrom); gifted pieces bring their free objects', () => {
  const s = farmAt(14);
  s.farm.expansions = ['home', 'creekside', 'cow_hill', 'old_orchard', 'fair_lane', 'sunflower_rise'];
  s.farm.proofs = { bee_glade: { at: T0 - HOUR, n: { 0: 3 } } };
  resetGrid(s);
  const p = landPlan(s);
  assert.deepEqual(p.added, ['bee_glade']);
  assert.deepEqual(p.drop, ['bee_glade'], 'its parcel is owned whole now: the card goes');
  assert.deepEqual(p.cards, {});
  const r = sys(s, '_land', {}, T0);
  const objs = evs(r, 'landRedrawn')[0].objects;
  assert.ok(objs.length > 0, 'the wild hive and the clover come with Bee Glade');
  assert.ok(objs.every((id) => defOf(s.farm.objects[id].def).kind !== 'debris'), 'never its debris');
  assert.deepEqual(validateState(s, { now: T0 }), []);
  const s2 = farmAt(14);
  s2.farm.expansions = ['home', 'creekside', 'cow_hill', 'old_orchard'];
  s2.farm.proofs = { sunflower_rise: { at: T0 - HOUR, n: { 0: 2 } } };
  resetGrid(s2);
  sys(s2, '_land', {}, T0);
  const j = C.CONTENT.parcels.get('sunny_glade').proofFrom.sunflower_rise[0];
  assert.deepEqual(s2.farm.proofs, { sunny_glade: { at: T0 - HOUR, n: { [j]: 2 } } });
});

test('land: a parcel is opened and bought whole; a piece id names its parcel; deeds count on the parcel\'s card', () => {
  const s = farmAt(13, { coins: 2_000_000 });
  s.farm.expansions = ['home', 'creekside', 'cow_hill', 'old_orchard', 'fair_lane'];
  resetGrid(s);
  const glade = C.CONTENT.parcels.get('sunny_glade');
  assert.equal(run(s, 'expand', { expansion: 'sunny_glade', ...BIG }).code, ERR.NOT_READY, 'its card is not open');
  assert.equal(run(s, 'expand', { expansion: 'riverside_woods', ...BIG }).code, ERR.LOCKED, 'in order');
  assert.equal(run(s, 'expand', { expansion: 'nope' }).code, ERR.BAD_ARGS);
  must(s, 'openExpansion', { expansion: 'bee_glade' });
  assert.ok(s.farm.proofs.sunny_glade, 'a piece opens its parcel\'s card');
  assert.equal(run(s, 'openExpansion', { expansion: 'sunny_glade' }).code, ERR.ALREADY_DONE);
  // finish the tasks (deeds and state), then buy
  glade.proof.forEach((t, i) => { if (t.verb !== 'own') s.farm.proofs.sunny_glade.n[String(i)] = t.qty; });
  for (const t of glade.proof) if (t.verb === 'own') for (let i = 0; i < t.qty; i++) placeDef(s, t.ref, BIG);
  give(s, 'planks', glade.planks);
  give(s, 'wooden_crate', glade.crates);
  const coins = s.farm.wallet.coins;
  const r = must(s, 'expand', { expansion: 'sunny_glade', ...BIG }, { now: T0 + 24 * HOUR });
  const ev = evs(r, 'expanded')[0];
  assert.deepEqual(ev.pieces, glade.pieces);
  assert.equal(ev.coins, glade.cost);
  assert.equal(s.farm.wallet.coins, coins - glade.cost);
  for (const x of glade.pieces) assert.ok(s.farm.expansions.includes(x));
  assert.equal(s.farm.proofs.sunny_glade, undefined);
  assert.ok(Object.values(s.farm.objects).some((o) => o.def === 'scarecrow' && o.free), 'Sunflower Rise\'s scarecrow');
  assert.equal(nextExpansion(s).id, 'riverside_woods');
  assert.deepEqual(validateState(s, { now: T0 }), []);
});
