// Release 1.0, owner request 2026-10-19 ("Give the balloon drops some rare powerups sometime. Be creative."): a crate a
// FARMER opens holds a rare power-up besides its loot (about 1 in 12.5), for the whole farm: the Rainbow Watering Can,
// Lucky Ladybugs, the Busy-Bee Swarm, Mabel's Golden Ticket and the Shooting Star (shared/rules/powerups.js). The rates,
// each effect, the caps and stacking, co-op replication (one opens, both get it and are told), validateState and the
// backfill of the owners' saves (copies). RED before the change: crateOpened carries no `pu`, farm.powerups is unknown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { farmAt, must, run, evs, placeDef, idsOf, obj, T0, HOUR, MIN, allLand } from './helpers/rules.js';
import { sys, coopHarness, ROOT, tmpDataDir } from './helpers.js';
import { give, runDue, runTwin } from './helpers/rules-goals.js';
import { CRATES, GROWTH, cropOf, animalOf, treeOf, eHours, levelFromXp } from '../shared/content/index.js';
import { RULES_VERSION, makeCtx } from '../shared/rules/index.js';
import { validateState, createFarm, FARM_KEYS } from '../shared/rules/state.js';
import { startCutBp, cutMs } from '../shared/rules/economy.js';
import { crateLoot, crateSpot, passOf, dropMomentOf, cratesOn } from '../shared/rules/actions/crates.js';
import { plantPreview, harvestOf } from '../shared/rules/actions/farming.js';
import {
  powerupOf, powerupIds, powerupPick, livePowerups, powerupOn, ticketBonus, powerupsOk,
} from '../shared/rules/powerups.js';
import { feedRows } from '../shared/rules/feed.js';
import { backfill } from '../server/migrations.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { Persist } from '../server/persist.js';
import { loadFarm } from '../server/app.js';

const P = CRATES.powerups;
const ctxOf = (s, o = {}) => makeCtx(s, { now: T0, pid: 'p1', cid: 'tstcid', seq: 1, ...o });

/** A farm at L14 with all its land, an apple tree (the Swarm has life to help) and the crate pass before T0's. */
function puFarm(level = 14) {
  const s = farmAt(level);
  allLand(s);
  placeDef(s, 'apple_tree');
  s.farm.crates.k = passOf(T0) - 1;
  return s;
}

/** The first balloon pass after `from` whose crate holds power-up `kind` for `pid` (pure: the crate's own keys). */
function passWith(s, kind, pid = 'p1', from = passOf(T0)) {
  const ctx = ctxOf(s, { pid });
  for (let k = from + 1; k < from + 50_000; k++) if (powerupPick(s, ctx, k) === kind) return k;
  throw new Error(`no ${kind} in 50,000 passes`);
}

/** Put pass `k`'s crate on its tile (setup: as `_crate` would) and return its id. */
function putCrate(s, k, now = T0) {
  const spot = crateSpot(s, k, ctxOf(s).rng);
  const id = `crate.${k.toString(36)}`;
  s.farm.objects[id] = { def: CRATES.def, x: spot[0], z: spot[1], rot: 0, placedAt: now, by: 'sys', k, until: now + CRATES.keepMs };
  resetGrid(s);
  return id;
}

/** `pid` opens a crate holding `kind` at `now`; returns the crateOpened event. */
function openWith(s, kind, { pid = 'p1', now = T0 } = {}) {
  const id = putCrate(s, passWith(s, kind, pid), now);
  const r = must(s, 'openCrate', { id }, { pid, now });
  return evs(r, 'crateOpened')[0];
}

// ---- the roll -----------------------------------------------------------------------------------------------------

test('powerups: content has the five kinds with a usable cap each; the roll is about 1 in 12.5 of the crates', () => {
  // the content's shape (shared/rules/powerups.js knows exactly these five; checked here, not in the eager content)
  assert.deepEqual([...powerupIds()], ['rainbow', 'ladybugs', 'swarm', 'ticket', 'star']);
  assert.equal(P.bp, 800);
  const pos = (n) => Number.isSafeInteger(n) && n > 0;
  const EFFECT = { rainbow: ['cropBp'], ladybugs: ['bonusBp'], swarm: ['timeBp'], ticket: ['coinsBp', 'capEBp'], star: [] };
  for (const id of powerupIds()) {
    const row = powerupOf(id);
    assert.ok(pos(row.w) && pos(row.ms), id);
    assert.ok(row.n === undefined ? pos(row.capMs) && row.capMs >= row.ms : pos(row.n) && pos(row.maxN) && row.maxN >= row.n,
      `${id} has a cap`);
    for (const k of EFFECT[id]) assert.ok(pos(row[k]) && row[k] <= 10_000, `${id}.${k}`);
  }
  const s = puFarm();
  const ctx = ctxOf(s);
  const N = 40_000;
  const n = {};
  let any = 0;
  for (let k = 1; k <= N; k++) {
    const pu = powerupPick(s, ctx, k);
    if (!pu) continue;
    any++;
    n[pu] = (n[pu] ?? 0) + 1;
  }
  const rate = any / N;
  assert.ok(rate > 0.07 && rate < 0.09, `about 8 % of the crates (${(rate * 100).toFixed(2)} %)`);
  const total = P.kinds.reduce((a, x) => a + x.w, 0);
  for (const x of P.kinds) {
    const share = (n[x.id] ?? 0) / any;
    assert.ok(Math.abs(share - x.w / total) < 0.03, `${x.id}: ${(share * 100).toFixed(1)} % of the power-ups`);
  }
});

test('powerups: never in a crate that goes to the Barn by itself; no Swarm on a farm with no animal or tree', () => {
  const s = puFarm();
  const sysCtx = ctxOf(s, { pid: 'sys' });
  for (let k = 1; k <= 5000; k++) assert.equal(powerupPick(s, sysCtx, k), null);
  const bare = farmAt(14);
  const ctx = ctxOf(bare);
  for (let k = 1; k <= 20_000; k++) assert.notEqual(powerupPick(bare, ctx, k), 'swarm');
});

test('powerups: the crate\'s coins, XP and extra roll exactly as before (the power-up has keys of its own)', () => {
  const s = puFarm();
  const k = passWith(s, 'rainbow');
  const id = putCrate(s, k);
  const keys = [];
  const ctx = ctxOf(s);
  const spy = { ...ctx, rng: (...a) => { keys.push(a.slice(2).join('.')); return ctx.rng(...a); } };
  const loot = crateLoot(s, id, spy);
  assert.equal(loot.pu, 'rainbow');
  const own = keys.filter((x) => x.startsWith('powerup'));
  assert.deepEqual(own, ['powerup', 'powerupKind']);
  // golden values from HEAD 201a97a's own crateLoot (the tree before the power-ups) for a p1 opener on this farm: two
  // plain passes, one holding a Rainbow Watering Can, one a Shooting Star; coins, XP and extra must not move
  const HEAD_LOOT = [
    [2983335, null, { coins: 2605, xp: 111, extra: { k: 'goldenSeeds', n: 1 } }],
    [2983336, null, { coins: 2303, xp: 91, extra: { k: 'acorns', n: 2 } }],
    [2983358, 'rainbow', { coins: 1870, xp: 127, extra: null }],
    [2983394, 'star', { coins: 1750, xp: 128, extra: { k: 'fertilizer', n: 1, item: 'fertilizer' } }],
  ];
  for (const [pass, pu, want] of HEAD_LOOT) {
    const cid = putCrate(s, pass);
    const got = crateLoot(s, cid, ctxOf(s));
    assert.deepEqual({ coins: got.coins, xp: got.xp, extra: got.extra }, want, `pass ${pass}`);
    assert.equal(got.pu, pu, `pass ${pass}`);
    delete s.farm.objects[cid];
    resetGrid(s);
  }
});

// ---- opening one ---------------------------------------------------------------------------------------------------

test('powerups: opening a crate with one starts it for the farm, names it on the event and the feed line', () => {
  const s = puFarm();
  const ev = openWith(s, 'ladybugs', { pid: 'p2' });
  assert.equal(ev.pu, 'ladybugs');
  assert.equal(ev.puUntil, T0 + powerupOf('ladybugs').ms);
  assert.deepEqual(s.farm.powerups.ladybugs, { at: T0, until: T0 + powerupOf('ladybugs').ms, by: 'p2' });
  const [[, row]] = feedRows(s, 1);
  assert.equal(row.k, 'crate');
  assert.equal(row.by, 'p2', 'the feed line names who found it');
  assert.equal(row.pu, 'ladybugs');
  // both farmers see the same power-up at work
  assert.deepEqual(livePowerups(s, T0 + MIN).map((x) => x.id), ['ladybugs']);
  assert.deepEqual(validateState(s), []);
  assert.equal(livePowerups(s, T0 + powerupOf('ladybugs').ms).length, 0, 'over at its end');
});

// ---- the five effects ------------------------------------------------------------------------------------------------

test('rainbow: a crop planted while it lasts is watered at planting and grows faster; the partner may still tend', () => {
  const s = puFarm();
  const [a, b, c] = idsOf(s, 'plot');
  must(s, 'plant', { id: a, crop: 'potato' }, { now: T0 - MIN });
  const plainMs = obj(s, a).crop.readyAt - obj(s, a).crop.plantedAt;
  openWith(s, 'rainbow');
  const promised = plantPreview(s, 'potato', b, 'p2', T0 + MIN).readyAt;
  must(s, 'plant', { id: b, crop: 'potato' }, { pid: 'p2', now: T0 + MIN });
  const crop = obj(s, b).crop;
  assert.equal(crop.water, 'sys', 'watered at planting');
  assert.equal(crop.readyAt, promised, 'the seed card promised the clock the crop keeps');
  const cut = obj(s, a).crop.cut + GROWTH.water.cropBp + powerupOf('rainbow').cropBp;
  assert.equal(crop.cut, cut);
  assert.equal(crop.readyAt - crop.plantedAt, cutMs(cropOf('potato').growMs, cut));
  assert.ok(crop.readyAt - crop.plantedAt < plainMs);
  // a Sprinkler's water: the other farmer may still add the partner tend (-5 %)
  const r = must(s, 'water', { id: b }, { pid: 'p1', now: T0 + 2 * MIN });
  assert.equal(evs(r, 'watered')[0].tend, false, 'a tend after the Can helps no partner, like after a Sprinkler');
  // a quick crop (under 30 minutes) is not watered (it needs none) but still grows faster
  must(s, 'plant', { id: c, crop: 'wheat' }, { now: T0 + 2 * MIN });
  assert.equal(obj(s, c).crop.water, undefined);
  assert.equal(obj(s, c).crop.cut >= powerupOf('rainbow').cropBp, true);
  // after its end nothing: the running timers keep what they got
  const d = idsOf(s, 'plot')[3];
  const end = s.farm.powerups.rainbow.until;
  const kept = obj(s, b).crop.readyAt;
  must(s, 'plant', { id: d, crop: 'potato' }, { now: end });
  assert.equal(obj(s, d).crop.water, undefined);
  assert.equal(obj(s, d).crop.cut, obj(s, a).crop.cut, 'planted after its end: the plain cut');
  assert.equal(obj(s, b).crop.readyAt, kept, 'what it gave stays');
});

test('ladybugs: a crop harvested while they stay has their chance of one more unit (keyed on the plot and cycle)', () => {
  const s = puFarm();
  openWith(s, 'ladybugs');
  const now = T0 + MIN;
  let lady = 0;
  let n = 0;
  for (const id of idsOf(s, 'plot')) {
    const p = obj(s, id);
    for (let cyc = 0; cyc < 60; cyc++) {
      p.cycle = cyc;
      p.crop = { def: 'wheat', plantedAt: T0 - HOUR, readyAt: T0 - MIN, by: 'p1', cycle: cyc, cut: 0 };
      const h = harvestOf(s, id, ctxOf(s, { now }));
      n++;
      if (h.lady) lady++;
      assert.equal(harvestOf(s, id, ctxOf(s, { now })).lady, h.lady, 'the same roll every time (a reload never re-rolls)');
      const after = harvestOf(s, id, ctxOf(s, { now: s.farm.powerups.ladybugs.until }));
      assert.equal(after.lady, undefined, 'gone once they flew off');
    }
    p.crop = null;
  }
  const rate = lady / n;
  assert.ok(Math.abs(rate - powerupOf('ladybugs').bonusBp / 10_000) < 0.04, `about 25 % (${(rate * 100).toFixed(1)} %)`);
  // the harvest itself: the event says which bonus unit was theirs
  const id = idsOf(s, 'plot').find((x) => {
    const p = obj(s, x);
    p.crop = { def: 'wheat', plantedAt: T0 - HOUR, readyAt: T0 - MIN, by: 'p1', cycle: p.cycle, cut: 0 };
    return harvestOf(s, x, ctxOf(s, { now })).lady;
  });
  for (const x of idsOf(s, 'plot')) if (x !== id) obj(s, x).crop = null;
  const r = must(s, 'harvest', { id }, { pid: 'p2', now });
  const ev = evs(r, 'harvested')[0];
  assert.equal(ev.lady, true);
  assert.equal(ev.qty, cropOf('wheat').yield + ev.bonus);
});

test('swarm: animal goods and fruit cycles that START while it buzzes take 25 % less time; crops and recipes do not', () => {
  const s = puFarm();
  const now = T0 + MIN;
  const before = { tree: startCutBp(s, 'apple_tree', now), animal: startCutBp(s, 'chicken', now),
    crop: startCutBp(s, 'potato', now), recipe: startCutBp(s, 'bread', now) };
  openWith(s, 'swarm');
  const bp = powerupOf('swarm').timeBp;
  assert.equal(startCutBp(s, 'apple_tree', now), before.tree + bp);
  assert.equal(startCutBp(s, 'chicken', now), before.animal + bp);
  assert.equal(startCutBp(s, 'potato', now), before.crop);
  assert.equal(startCutBp(s, 'bread', now), before.recipe);
  // a fruit tree's next cycle, started by its harvest while the swarm buzzes
  const tree = idsOf(s, 'apple_tree')[0];
  const o = obj(s, tree);
  o.matureAt = o.startedAt = o.readyAt = T0;
  must(s, 'harvestTree', { id: tree }, { pid: 'p2', now });
  assert.equal(obj(s, tree).readyAt, now + cutMs(treeOf('apple_tree').cycleMs, before.tree + bp));
  assert.equal(startCutBp(s, 'chicken', s.farm.powerups.swarm.until), before.animal, 'over at its end');
  assert.ok(animalOf('chicken').cycleMs > 0);
});

test('ticket: the next order filled pays +50 % of its coins on top (granted), once; a second waits for the next', () => {
  const s = puFarm();
  runDue(s, T0);
  const slot = Object.keys(s.farm.orders.slots).find((k) => s.farm.orders.slots[k].order);
  const o = s.farm.orders.slots[slot].order;
  openWith(s, 'ticket', { pid: 'p2' });
  assert.equal(s.farm.powerups.ticket.n, 1);
  for (const [item, q] of Object.entries(o.items)) give(s, item, q);
  const coins = s.farm.wallet.coins;
  const granted = s.farm.stats['coins.granted'] ?? 0;
  const bonus = ticketBonus(s, o.coins, T0 + MIN);
  assert.equal(bonus, Math.min(Math.floor(o.coins / 2), eHours(levelFromXp(s.farm.xp), powerupOf('ticket').capEBp)));
  const r = must(s, 'orderFill', { slot: Number(slot), n: o.n }, { pid: 'p1', now: T0 + MIN });
  const ev = r.tx.events.find((e) => e.e === 'orderFilled');
  assert.equal(ev.ticket, bonus);
  assert.equal(ev.coins >= o.coins, true, 'the order\'s own coins stay its own');
  assert.equal(s.farm.wallet.coins - coins, ev.coins + bonus);
  assert.equal((s.farm.stats['coins.granted'] ?? 0) - granted, bonus, 'a reward: granted, not earned');
  assert.equal(s.farm.powerups.ticket, undefined, 'used up');
  const [[, row]] = feedRows(s, 5).filter(([, x]) => x.k === 'order');
  assert.equal(row.tk, bonus);
  // the cap: an order worth far more than an E-hour gets at most capEBp of one
  assert.equal(ticketBonus({ ...s, farm: { ...s.farm, powerups: { ticket: { at: T0, until: T0 + HOUR, by: 'p1', n: 1 } } } },
    100_000_000, T0), eHours(levelFromXp(s.farm.xp), powerupOf('ticket').capEBp));
});

test('star: the next balloon passes each drop a crate for sure; a pass with no room keeps the use', () => {
  const s = puFarm();
  // a pass whose own roll would NOT drop a crate
  const ctx = ctxOf(s);
  openWith(s, 'star', { now: T0 });
  assert.equal(s.farm.powerups.star.n, 2);
  for (const id of cratesOn(s)) delete s.farm.objects[id];
  resetGrid(s);
  let k = passOf(T0) + 1;
  while (Math.floor(ctx.rng('crate', k) * 10_000) < CRATES.dropBp) k++;
  s.farm.crates.k = k - 1;
  const r = sys(s, '_crate', {}, dropMomentOf(k));
  const dropped = evs(r, 'crateDropped');
  assert.equal(dropped.length, 1, 'a pass that would have flown empty drops one');
  assert.equal(dropped[0].star, true);
  assert.equal(s.farm.powerups.star.n, 1);
  // the farm is full (maxOpen crates wait): the star keeps its use for a pass with room
  while (cratesOn(s).length < CRATES.maxOpen) putCrate(s, k + 1000 + cratesOn(s).length, dropMomentOf(k));
  const full = sys(s, '_crate', {}, dropMomentOf(k + 1));
  assert.equal(evs(full, 'crateDropped').length, 0);
  assert.equal(s.farm.powerups.star.n, 1);
  for (const id of cratesOn(s)) delete s.farm.objects[id];
  resetGrid(s);
  sys(s, '_crate', {}, dropMomentOf(k + 2));
  assert.equal(s.farm.powerups.star, undefined, 'its last use spent');
  assert.equal(cratesOn(s).length, 1);
  assert.deepEqual(validateState(s), []);
});

// ---- caps and stacking -----------------------------------------------------------------------------------------------

test('stacking: a second of a timed kind adds its time up to the cap; a counted kind adds uses up to maxN', () => {
  const s = puFarm();
  const rb = powerupOf('rainbow');
  openWith(s, 'rainbow', { now: T0 });
  assert.equal(s.farm.powerups.rainbow.until, T0 + rb.ms);
  openWith(s, 'rainbow', { now: T0 + 5 * MIN, pid: 'p2' });
  assert.equal(s.farm.powerups.rainbow.until, Math.min(T0 + 2 * rb.ms, T0 + 5 * MIN + rb.capMs));
  assert.equal(s.farm.powerups.rainbow.by, 'p2', 'the latest finder');
  openWith(s, 'rainbow', { now: T0 + 6 * MIN });
  assert.equal(s.farm.powerups.rainbow.until, T0 + 6 * MIN + rb.capMs, 'never past the cap');
  // after it ran out a new one starts fresh
  openWith(s, 'rainbow', { now: T0 + 3 * HOUR });
  assert.equal(s.farm.powerups.rainbow.until, T0 + 3 * HOUR + rb.ms);
  const tk = powerupOf('ticket');
  for (let i = 0; i < 4; i++) openWith(s, 'ticket', { now: T0 + i * MIN });
  assert.equal(s.farm.powerups.ticket.n, tk.maxN, 'at most maxN orders');
  assert.equal(s.farm.powerups.ticket.until, T0 + 3 * MIN + tk.ms, 'lasts ms from the last one found');
  const st = powerupOf('star');
  for (let i = 0; i < 3; i++) openWith(s, 'star', { now: T0 + i * MIN });
  assert.equal(s.farm.powerups.star.n, st.maxN);
  // an expired counted one starts over (its old uses are gone)
  openWith(s, 'ticket', { now: T0 + 3 * MIN + tk.ms + 1 });
  assert.equal(s.farm.powerups.ticket.n, tk.n);
  assert.deepEqual(validateState(s), []);
});

test('validateState: farm.powerups is checked for its shape only, so a later retune never flags a save', () => {
  assert.ok(FARM_KEYS.has('powerups'));
  const s = puFarm();
  const isPid = (p) => p === 'p1' || p === 'p2';
  // well-formed entries pass, including a kind a later content retires and a count above a lowered maxN
  for (const ok of [{}, undefined, { rainbow: { at: 1, until: 2, by: 'p1' } }, { ticket: { at: 1, until: 2, by: 'p1', n: 2 } },
    { glitter: { at: 1, until: 2, by: 'p1' } }, { star: { at: 1, until: 2, by: 'p1', n: 9 } }, { ticket: { at: 1, until: 2, by: 'p1' } }]) {
    assert.equal(powerupsOk(ok, isPid), true, JSON.stringify(ok));
  }
  for (const bad of [{ star: { at: 1, until: 2, by: 'p1', n: 0 } }, { star: { at: 1, until: 2, by: 'p1', n: 1.5 } },
    { rainbow: { at: -1, until: 2, by: 'p1' } }, { rainbow: { at: 1, until: 2, by: 'p9' } },
    { rainbow: { at: 1, until: 2, by: 'p1', x: 1 } }, { rainbow: null }, { 'Bad Id': { at: 1, until: 2, by: 'p1' } }, [], null]) {
    s.farm.powerups = bad;
    assert.ok(validateState(s).includes('farm.powerups'), JSON.stringify(bad));
  }
  // an unknown kind does nothing; a count above the current cap works at the cap (and is spent from there)
  s.farm.powerups = { glitter: { at: T0, until: T0 + HOUR, by: 'p1' }, star: { at: T0, until: T0 + HOUR, by: 'p1', n: 9 } };
  assert.deepEqual(livePowerups(s, T0 + MIN).map((x) => [x.id, x.n]), [['star', powerupOf('star').maxN]]);
});

test('invariants: a power-up crate, a rainbow planting, a lady harvest, a ticket order and a star pass decide the same on a key-reversed twin', () => {
  const s = puFarm();
  runDue(s, T0);
  runTwin(s, 'openCrate', { id: putCrate(s, passWith(s, 'swarm', 'p2')) }, { pid: 'p2', now: T0 });
  for (const kind of ['ticket', 'ladybugs', 'rainbow']) runTwin(s, 'openCrate', { id: putCrate(s, passWith(s, kind)) }, { now: T0 + MIN });
  // the Rainbow Watering Can's planting
  const [a, b] = idsOf(s, 'plot');
  runTwin(s, 'plant', { ids: [a, b], crop: 'potato' }, { pid: 'p2', now: T0 + 2 * MIN });
  assert.equal(obj(s, a).crop.water, 'sys', 'the twin planted with the Can at work');
  // a harvest whose ladybug roll fires
  const now = T0 + 3 * MIN;
  const lady = idsOf(s, 'plot').slice(2).find((id) => {
    const p = obj(s, id);
    p.crop = { def: 'wheat', plantedAt: T0 - HOUR, readyAt: T0 - MIN, by: 'p1', cycle: p.cycle, cut: 0 };
    return harvestOf(s, id, ctxOf(s, { now })).lady;
  });
  for (const id of idsOf(s, 'plot').slice(2)) if (id !== lady) obj(s, id).crop = null;
  assert.equal(evs(runTwin(s, 'harvest', { id: lady }, { pid: 'p1', now }), 'harvested')[0].lady, true);
  // a ticket order
  const slot = Object.keys(s.farm.orders.slots).find((k) => s.farm.orders.slots[k].order);
  const o = s.farm.orders.slots[slot].order;
  for (const [item, q] of Object.entries(o.items)) give(s, item, q);
  assert.ok(evs(runTwin(s, 'orderFill', { slot: Number(slot), n: o.n }, { pid: 'p2', now }), 'orderFilled')[0].ticket > 0);
  // a Shooting Star's pass: one whose own roll would fly empty drops a crate
  for (const id of cratesOn(s)) delete s.farm.objects[id];
  resetGrid(s);
  s.farm.powerups.star = { at: now, until: now + 3 * HOUR, by: 'p1', n: 2 };
  const rng = ctxOf(s).rng;
  let k = passOf(now) + 1;
  while (Math.floor(rng('crate', k) * 10_000) < CRATES.dropBp) k++;
  s.farm.crates.k = k - 1;
  const dropped = evs(runTwin(s, '_crate', {}, { pid: 'sys', now: dropMomentOf(k) }), 'crateDropped');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].star, true);
  assert.equal(s.farm.powerups.star.n, 1);
});

// ---- co-op replication -----------------------------------------------------------------------------------------------

test('co-op: Rowan opens it (predicted), Mia\'s screen gets the power-up, the event that names it and the feed line', () => {
  const h = coopHarness();
  const st = h.state;
  st.farm.xp = 1_000_000;
  const k = (() => {
    const ctx = makeCtx(st, { now: h.clock.now(), pid: 'p1', cid: 'aaaaaa', seq: 1 });
    for (let i = passOf(h.clock.now()); i < passOf(h.clock.now()) + 50_000; i++) if (powerupPick(st, ctx, i) === 'rainbow') return i;
    throw new Error('none');
  })();
  const id = `crate.${k.toString(36)}`;
  const spot = crateSpot(st, k, makeCtx(st, { now: h.clock.now(), pid: 'sys' }).rng);
  st.farm.objects[id] = { def: CRATES.def, x: spot[0], z: spot[1], rot: 0, placedAt: h.clock.now(), by: 'sys', k,
    until: h.clock.now() + CRATES.keepMs };
  resetGrid(st);
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  const seen = { a: [], b: [] };
  h.a.store.on('fx', (x) => seen.a.push(x));
  h.b.store.on('fx', (x) => seen.b.push(x));
  h.a.store.act('openCrate', { id });
  // Rowan's own screen: predicted at once
  assert.equal(h.a.store.state.farm.powerups.rainbow.by, 'p1');
  assert.equal(seen.a.find((x) => x.ev.e === 'crateOpened')?.ev.pu, 'rainbow');
  h.flush();
  for (const c of [h.a, h.b]) {
    assert.deepEqual(c.store.state.farm.powerups, st.farm.powerups, `${c.key} holds the server's power-up`);
    assert.deepEqual(livePowerups(c.store.state, h.clock.now()).map((x) => x.id), ['rainbow']);
    const [[, row]] = feedRows(c.store.state, 1);
    assert.equal(row.pu, 'rainbow');
    assert.equal(row.by, 'p1');
  }
  const mia = seen.b.find((x) => x.ev.e === 'crateOpened');
  assert.equal(mia.ev.pu, 'rainbow', 'the partner is told');
  assert.equal(mia.by, 'p1');
  assert.equal(powerupOn(st, 'rainbow', h.clock.now()).by, 'p1');
});

// ---- saves: backfill, the owners' farms, RULES_VERSION -----------------------------------------------------------------

test('migration: an older save gets farm.powerups {} from the backfill; RULES_VERSION 15', () => {
  assert.ok(RULES_VERSION >= 15);
  const s = createFarm(7, T0);
  delete s.farm.powerups;
  assert.ok(validateState(s).some((x) => /powerups/.test(x)) === false, 'absent is fine until the backfill');
  const filled = backfill(s, { now: T0 });
  assert.ok(filled.includes('farm.powerups'));
  assert.deepEqual(s.farm.powerups, {});
  assert.deepEqual(validateState(s), []);
});

const SAVES = ['.scratch/box-save-1013', '.scratch/box-save-1013-late'].map((d) => path.join(ROOT, d));
const quiet = { info() {}, warn() {}, error() {}, log() {} };

for (const src of SAVES) {
  test(`migration: the owners' save ${path.basename(src)} (a copy) boots with farm.powerups, valid, nothing lost`,
    { skip: !fs.existsSync(path.join(src, 'farm.json')) && 'the owners\' save copy is not on this machine' }, async () => {
      const dir = tmpDataDir('powerups-save');      // a COPY: the owners' save is never written
      try {
        for (const f of fs.readdirSync(src)) {
          const from = path.join(src, f);
          if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, f));
        }
        const before = JSON.parse(fs.readFileSync(path.join(src, 'farm.json'), 'utf8')).state;
        assert.equal(before.farm.powerups, undefined, 'the save predates the power-ups');
        const persist = new Persist(dir, { log: quiet });
        const { state } = loadFarm(persist, { tz: before.meta.tz, log: quiet });
        assert.deepEqual(validateState(state), []);
        assert.deepEqual(state.farm.powerups, {});
        assert.equal(state.farm.wallet.coins >= before.farm.wallet.coins, true);
        assert.equal(state.farm.wallet.acorns >= before.farm.wallet.acorns, true);
        assert.equal(state.farm.xp >= before.farm.xp, true);
        for (const [id, o] of Object.entries(before.farm.objects)) assert.equal(state.farm.objects[id]?.def, o.def, `object ${id}`);
        for (const [item, n] of Object.entries(before.farm.inventory)) assert.ok((state.farm.inventory[item] ?? 0) >= n, item);
        assert.deepEqual(Object.keys(state.players).sort(), Object.keys(before.players).sort());
        for (const k of Object.keys(before.farm)) assert.ok(Object.hasOwn(state.farm, k), `farm.${k} kept`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
}
