// M2 leisure economy: the farmhouse interior (Restoration 6; content INTERIOR + the furniture catalog) and the
// Fishing Dock (GDD §6.2 #21: casts with a cooldown, no Fish item, Pond Treasures rolls, fishing together).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m2 } from './helpers/rules-economy-m2.js';

const M = await m2();
const { content, fishing, interior } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const { runAction, makeCtx } = M.index;
const { Tx } = await import('../shared/rules/tx.js');
const BIG = { confirm: ['BIG_SPEND'] };
const { INTERIOR, FISHING, SAFETY } = content;

function farm(level, o = {}) {
  const s = farmAt(level, { coins: 900_000_000, acorns: 500, ...o });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  return s;
}
/** A farm whose Grandma's Farmhouse is done, with the room opened through the real reward path. */
function withRoom(level = 34) {
  const s = farm(level);
  for (const p of [...content.live('restoration')].sort((a, b) => a.n - b.n)) {
    s.farm.restore[p.id] = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, T0])), done: T0 };
  }
  interior.openInterior(new Tx(s), { now: T0, pid: 'p1' });
  return s;
}
const spentOf = (s) => s.farm.stats['coins.spent'] ?? 0;
const itemIds = (s, def) => Object.keys(s.farm.interior.items).filter((k) => s.farm.interior.items[k].def === def);

test('the room: fixed pieces where content puts them; the duet table moves but never leaves', () => {
  const s = withRoom();
  assert.equal(Object.keys(s.farm.interior.items).length, INTERIOR.fixed.length);
  assert.deepEqual(validateState(s), []);
  const table = itemIds(s, 'duet_table')[0];
  const hearth = itemIds(s, 'fireplace')[0];
  assert.equal(run(s, 'furnishStore', { id: table }).code, 'LOCKED');
  assert.equal(run(s, 'furnishMove', { id: hearth, x: 0, z: 2 }).code, 'LOCKED');
  must(s, 'furnishMove', { id: table, x: 6, z: 4 });
  assert.equal(run(s, 'furnishMove', { id: table, x: 6, z: 4 }).code, 'ALREADY_DONE');
  assert.equal(run(s, 'furnishMove', { id: table, x: 8, z: 4 }).code, 'OUT_OF_BOUNDS');
  assert.deepEqual(validateState(s), []);
});

test('furnish: bought from the catalog, placed on a free spot of its layer; wall pieces hang on wall slots', () => {
  const s = withRoom();
  const spent = spentOf(s);
  const r = must(s, 'furnish', { def: 'armchair', x: 0, z: 6 });
  const e = evs(r, 'furnished')[0];
  assert.equal(spentOf(s) - spent, content.furnitureOf('armchair').cost);
  assert.equal(e.fromTray, false);
  assert.equal(run(s, 'furnish', { def: 'footstool', x: 0, z: 6 }).code, 'OCCUPIED');
  // a rug lies under furniture (its own layer), but not where the door and hearth need room for objects
  must(s, 'furnish', { def: 'rag_rug', x: 0, z: 5 });
  assert.equal(run(s, 'furnish', { def: 'footstool', x: 8, z: 1 }).code, 'BLOCKED', 'the door stays clear');
  must(s, 'furnish', { def: 'hall_runner', x: 5, z: 5 });
  // walls: slot ranges, the chimney breast, the size in slots
  assert.equal(run(s, 'furnish', { def: 'cuckoo_clock', wall: 'back', at: 5 }).code, 'BLOCKED');
  assert.equal(run(s, 'furnish', { def: 'cuckoo_clock', wall: 'left', at: 1 }).code, 'OCCUPIED', 'the Memory wall');
  assert.equal(run(s, 'furnish', { def: 'quilt_hanging', wall: 'left', at: 7 }).code, 'OUT_OF_BOUNDS');
  must(s, 'furnish', { def: 'cuckoo_clock', wall: 'back', at: 3 });
  // the args must fit the layer
  assert.equal(run(s, 'furnish', { def: 'cuckoo_clock', x: 1, z: 1 }).code, 'BAD_ARGS');
  assert.equal(run(s, 'furnish', { def: 'armchair', wall: 'back', at: 3 }).code, 'BAD_ARGS');
  // rotation swaps the footprint
  must(s, 'furnish', { def: 'sofa', x: 9, z: 2, rot: 1 });
  // reward pieces are not for sale; `max` caps the catalog
  assert.equal(run(s, 'furnish', { def: 'hazel_portrait', wall: 'left', at: 7 }).code, 'LOCKED');
  assert.equal(run(s, 'furnish', { def: 'armchair', x: 6, z: 6 }).code, 'CAP');
  must(s, 'furnish', { def: 'fern_pot', x: 0, z: 0 });
  must(s, 'furnish', { def: 'fern_pot', x: 3, z: 0 });
  assert.equal(run(s, 'furnish', { def: 'fern_pot', x: 7, z: 0 }).code, 'CAP');
  assert.deepEqual(validateState(s), []);
});

test('the 10-minute undo refunds a purchase in full; stored pieces come back from the tray for free', () => {
  const s = withRoom();
  must(s, 'furnish', { def: 'footstool', x: 0, z: 0 });               // (the farm's first action of the day)
  const start = s.farm.wallet.coins;
  const id = evs(must(s, 'furnish', { def: 'piano', x: 6, z: 6 }), 'furnished')[0].id;
  must(s, 'furnishMove', { id, x: 6, z: 5 });
  must(s, 'furnishRefund', { id }, { now: T0 + SAFETY.undoMs - 1 });
  assert.equal(s.farm.wallet.coins, start, 'every coin back');
  const id2 = evs(must(s, 'furnish', { def: 'piano', x: 6, z: 6 }), 'furnished')[0].id;
  assert.equal(run(s, 'furnishRefund', { id: id2 }, { now: T0 + SAFETY.undoMs }).code, 'NOT_REFUNDABLE');
  const paid = s.farm.wallet.coins;
  must(s, 'furnishStore', { id: id2 });
  assert.equal(s.farm.interior.tray.piano, 1);
  assert.equal(s.farm.wallet.coins, paid, 'storing never pays');
  const r = must(s, 'furnish', { def: 'piano', x: 6, z: 3 });
  assert.equal(evs(r, 'furnished')[0].fromTray, true);
  assert.equal(s.farm.wallet.coins, paid, 'from the tray for free');
  assert.equal(s.farm.interior.tray.piano, undefined);
  assert.deepEqual(validateState(s), []);
});

test('the tray: Grandma\'s reward piece is placed from it for free; furniture never mints coins', () => {
  const s = withRoom();
  assert.equal(interior.giveFurniture(new Tx(s), 'hazel_portrait'), true);
  const coins = spentOf(s);
  const r = must(s, 'furnish', { def: 'hazel_portrait', wall: 'left', at: 7 });
  assert.equal(evs(r, 'furnished')[0].fromTray, true);
  assert.equal(spentOf(s), coins);
  assert.equal(s.farm.interior.tray.hazel_portrait, undefined);
  const id = evs(r, 'furnished')[0].id;
  assert.equal(run(s, 'furnishRefund', { id }).code, 'NOT_REFUNDABLE');
  assert.deepEqual(validateState(s), []);
});

// ---- the Fishing Dock ----------------------------------------------------------------------------------------

test('fishing opens with Willow Pond (L21); a cast, a bite, a reel: a fish for the trophy board, no item', () => {
  const s = farm(20);
  assert.equal(run(s, 'cast', { pond: 'willow_pond' }).code, 'LOCKED');
  s.farm.xp = content.xpForLevel(21);
  assert.equal(run(s, 'cast', { pond: 'goat_rocks' }).code, 'NOT_FOUND', 'no pond there');
  assert.equal(run(s, 'cast', {}).code, 'BAD_ARGS');
  assert.equal(run(s, 'reel', {}).code, 'NOT_FOUND', 'no line in the water');
  const c = evs(must(s, 'cast', { pond: 'willow_pond' }), 'fishCast')[0];
  const [b0, b1] = FISHING.biteMs;
  assert.ok(c.bite >= T0 + b0 && c.bite <= T0 + b1);
  const inv = structuredClone(s.farm.inventory);
  const r = must(s, 'reel', {}, { now: c.bite, grace: 0 });
  const f = evs(r, 'fishCaught')[0];
  assert.equal(f.grade, 2);
  assert.ok(FISHING.fish.some((x) => x.id === f.fish));
  const sp = FISHING.fish.find((x) => x.id === f.fish);
  assert.ok(f.cm >= sp.cm[0] + Math.floor(((sp.cm[1] - sp.cm[0]) * FISHING.gradeFloorBp[2]) / 10_000)
    && f.cm <= sp.cm[1], 'a perfect reel lifts the size floor');
  assert.equal(f.record, true);
  assert.equal(f.weekBest, true);
  assert.deepEqual(s.farm.inventory, inv, 'never an economy item');
  assert.deepEqual(s.farm.fishing.records[f.fish], { cm: f.cm, by: 'p1', at: c.bite });
  assert.equal(s.farm.fishing.n, 1);
  // once an hour each: the partner may fish now
  assert.equal(run(s, 'cast', { pond: 'willow_pond' }, { now: c.bite + MIN }).code, 'COOLDOWN');
  must(s, 'cast', { pond: 'willow_pond' }, { pid: 'p2', now: c.bite + MIN });
  must(s, 'cast', { pond: 'willow_pond' }, { now: c.bite + HOUR });
  assert.deepEqual(validateState(s), []);
});

test('reel grades: perfect, good, and a late or early reel still lands a fish (never punishing)', () => {
  for (const [off, grade] of [[0, 2], [FISHING.perfectMs, 2], [FISHING.perfectMs + 1, 1], [-FISHING.goodMs, 1],
    [FISHING.goodMs + 1, 0], [-8000, 0], [60_000, 0]]) {
    assert.equal(fishing.gradeOf(T0, T0 + off), grade, `${off}`);
  }
  const s = farm(21);
  const c = evs(must(s, 'cast', { pond: 'willow_pond' }), 'fishCast')[0];
  const r = must(s, 'reel', {}, { now: c.bite + 30_000, grace: 0 });
  assert.equal(evs(r, 'fishCaught')[0].grade, 0);
  assert.equal(s.farm.fishing.n, 1);
});

test('the catch is deterministic on the farm counter: the same state and reel give the same fish', () => {
  const a = farm(21);
  const b = farm(21);
  for (const s of [a, b]) {
    const c = evs(must(s, 'cast', { pond: 'willow_pond' }), 'fishCast')[0];
    must(s, 'reel', {}, { now: c.bite + 500, grace: 0 });
  }
  assert.deepEqual(a.farm.fishing, b.farm.fishing);
  assert.equal(a.farm.rolls.fish, 1);
  assert.equal(a.farm.rolls.fishBite, 1);
});

test('a Fishing Dock decor is a spot from L28; the avatar must stand at it as the server sees it', () => {
  const s = farm(28);
  const dock = placeDef(s, 'pond_dock', BIG);
  const ctx = (near) => makeCtx(s, { now: T0, pid: 'p1', cid: 'tstcid', seq: 900 + near, ext: { near }, grace: 250 });
  assert.equal(runAction(s, { type: 'cast', args: { id: dock } }, ctx(FISHING.sitRadius * 10 + 1)).code, 'TOO_FAR');
  assert.equal(runAction(s, { type: 'cast', args: { id: dock } }, ctx(FISHING.sitRadius * 10)).ok, true);
  const s27 = farm(27);
  s27.farm.objects.d1 = { ...s.farm.objects[dock] };
  assert.equal(run(s27, 'cast', { id: 'd1' }).code, 'LOCKED', 'the decor dock is an L28 spot');
  assert.deepEqual(fishing.fishingSpots(s).length >= 2, true);
});

test('fishing together: both lines in at one spot within 20 s: the together deed and a Heart each, once a day', () => {
  const s = farm(30);
  const h = { p1: s.players.p1.hearts, p2: s.players.p2.hearts };
  const c1 = evs(must(s, 'cast', { pond: 'willow_pond' }), 'fishCast')[0];
  const r = must(s, 'cast', { pond: 'willow_pond' }, { pid: 'p2', now: T0 + FISHING.together.windowMs });
  const t = evs(r, 'fishTogether')[0];
  assert.deepEqual(t.pids, ['p1', 'p2']);
  assert.deepEqual(t.hearts, ['p1', 'p2']);
  assert.equal(s.players.p1.hearts, h.p1 + 1);
  assert.equal(s.players.p2.hearts, h.p2 + 1);
  // both land; an hour later they fish together again the same day: the deed, but no second Heart
  must(s, 'reel', {}, { now: c1.bite });
  must(s, 'reel', {}, { pid: 'p2', now: c1.bite + 1000 });
  must(s, 'cast', { pond: 'willow_pond' }, { now: c1.bite + HOUR });
  const r2 = must(s, 'cast', { pond: 'willow_pond' }, { pid: 'p2', now: c1.bite + HOUR + 5000 });
  assert.deepEqual(evs(r2, 'fishTogether')[0].hearts, []);
  assert.equal(s.players.p1.hearts, h.p1 + 1);
  // too far apart in time: no together
  const s2 = farm(30);
  must(s2, 'cast', { pond: 'willow_pond' });
  const r3 = must(s2, 'cast', { pond: 'willow_pond' }, { pid: 'p2', now: T0 + FISHING.together.windowMs + 1 });
  assert.equal(evs(r3, 'fishTogether').length, 0);
  assert.deepEqual(validateState(s), []);
});

test('exploits: recasting cannot fish for a better catch; a furnish-refund loop mints nothing', () => {
  const s = farm(21);
  const ctx = M.index.makeCtx(s, { now: T0, pid: 'p1', cid: 'x', seq: 1 });
  const want = fishing.catchOf(s, ctx, 0);
  for (let i = 0; i < 6; i++) must(s, 'cast', { pond: 'willow_pond' }, { now: T0 + i * 1000 });
  const c = M.fishing.lineOf(s, 'p1');
  const f = evs(must(s, 'reel', {}, { now: c.at + 60_000, grace: 0 }), 'fishCaught')[0];
  assert.equal(f.fish, want.fish, 'the species comes from the catch counter, not from the cast');
  assert.equal(f.cm, want.cm);
  assert.equal(run(s, 'cast', { pond: 'willow_pond' }, { now: c.at + 61_000 }).code, 'COOLDOWN');
  const r = withRoom();
  must(r, 'furnish', { def: 'footstool', x: 0, z: 0 });                 // (the farm's first action of the day)
  const st = r.farm.stats;
  const [spent, back, coins] = [st['coins.spent'] ?? 0, st['coins.refunded'] ?? 0, r.farm.wallet.coins];
  for (let i = 0; i < 4; i++) {
    const id = evs(must(r, 'furnish', { def: 'gramophone', x: 3, z: 3 }, { now: T0 + i * MIN }), 'furnished')[0].id;
    must(r, 'furnishRefund', { id }, { now: T0 + i * MIN + 1 });
  }
  assert.equal((st['coins.spent'] ?? 0) - spent, (st['coins.refunded'] ?? 0) - back, 'every coin back, no more');
  assert.equal(r.farm.wallet.coins, coins);
  assert.ok(M.rulesHelpers.ledgerBalanced(r, 900_000_000));
});
