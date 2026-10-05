// M1b long-term sinks: the Restoration Ledger (projects 1-3) and Town Projects (1-4), GDD §5.9, §9 #50.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m1b, withDefs } from './helpers/rules-economy.js';

const M = await m1b();
const { content, economy, restoration, town } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { sys } = M.helpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const { dayIndex } = await import('../shared/rules/calendar.js');
const { put } = await import('./helpers/rules-goals.js');
const { producers, producerUnits } = await import('../shared/rules/orders-board.js');
const BIG = { confirm: ['BIG_SPEND'] };
const DAY = 24 * HOUR;
const GREENHOUSE = { id: 'greenhouse', name: 'Old Greenhouse', kind: 'landmark', layer: 'ground', size: [6, 4],
  shop: false, movable: true, panel: null, greenhouse: { plots: 12 }, model: 'landmarks/greenhouse' };
const withGreenhouse = (fn) => (content.defOf('greenhouse')?.greenhouse ? fn()
  : withDefs(content, 'landmarks', [GREENHOUSE], fn));

function farm(level, o = {}) {
  const s = farmAt(level, { coins: 50_000_000, acorns: 200, ...o });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  return s;
}
const project = (id) => content.CONTENT.restoration.get(id);
const slotIndex = (p, b, item) => project(p).bundles.find((x) => x.id === b).slots.findIndex((x) => x.item === item);

/** Fill every bundle of a project but `skip` (direct state: the donations themselves are tested below). */
function fillOthers(s, pid, skip) {
  const r = s.farm.restore[pid] ?? { s: {}, b: {} };
  for (const b of project(pid).bundles) if (b.id !== skip) r.b[b.id] = T0;
  s.farm.restore[pid] = r;
}

test('the ledger opens at L16, one project at a time, in order', () => {
  const s = farm(15);
  assert.equal(restoration.openProject(s), null);
  assert.equal(run(s, 'donate', { project: 'greenhouse', bundle: 'seedlings', slot: 0, qty: 1 }).code, 'LOCKED');
  s.farm.xp = content.xpForLevel(22);
  assert.equal(restoration.openProject(s).id, 'greenhouse', 'the Mill Wheel waits for the Greenhouse');
  give(s, 'wheat', 5);
  assert.equal(run(s, 'donate', { project: 'mill_wheel', bundle: 'grain', slot: 0, qty: 1 }).code, 'LOCKED');
  const l = restoration.ledgerOf(s);
  // M1b's three projects; an M2 build lists Restoration 4-6 after them, every one locked behind the Greenhouse
  assert.deepEqual(l.slice(0, 3).map((p) => [p.id, p.status]), [['greenhouse', 'open'], ['mill_wheel', 'locked'],
    ['stone_bridge', 'locked']]);
  assert.ok(l.slice(3).every((p) => p.status === 'locked'), 'later projects wait their turn');
});

test('donating gives what the slot still needs from what the Barn holds; who gave what is kept', () => {
  const s = farm(16);
  const i = slotIndex('greenhouse', 'seedlings', 'wheat');
  give(s, 'wheat', 12);
  const r = must(s, 'donate', { project: 'greenhouse', bundle: 'seedlings', slot: i, qty: 50 });
  assert.deepEqual(evs(r, 'donated')[0], { e: 'donated', project: 'greenhouse', bundle: 'seedlings', slot: i, by: 'p1',
    qty: 12, item: 'wheat' });
  assert.equal(s.farm.inventory.wheat, undefined);
  give(s, 'wheat', 30);
  s.farm.keep.wheat = { n: 25, by: 'p2' };                        // Keep N: a bundle needs no confirm (GDD §6.3)
  must(s, 'donate', { project: 'greenhouse', bundle: 'seedlings', slot: i, qty: 50 }, { pid: 'p2' });
  assert.deepEqual(s.farm.restore.greenhouse.s.seedlings[String(i)], { n: 20, by: { p1: 12, p2: 8 } });
  assert.equal(s.farm.inventory.wheat, 22);
  assert.equal(run(s, 'donate', { project: 'greenhouse', bundle: 'seedlings', slot: i, qty: 1 }).code, 'ALREADY_DONE');
  assert.equal(run(s, 'donate', { project: 'greenhouse', bundle: 'seedlings', slot: 1, qty: 1 }).code, 'NO_ITEMS');
  assert.equal(run(s, 'donate', { project: 'greenhouse', bundle: 'nope', slot: 0, qty: 1 }).code, 'BAD_ARGS');
  assert.deepEqual(validateState(s), []);
});

test('a bundle completes at `need` full slots; its partly given slots come back; the project completes last', () => {
  withGreenhouse(() => {
    const s = farm(16);
    const p = project('greenhouse');
    const b = p.bundles.find((x) => x.id === 'orchard_gift');          // 3 of 4 fruit slots
    for (const slot of b.slots) give(s, slot.item, slot.qty);
    // two slots full, the third half, the fourth partly
    must(s, 'donate', { project: 'greenhouse', bundle: b.id, slot: 0, qty: b.slots[0].qty });
    must(s, 'donate', { project: 'greenhouse', bundle: b.id, slot: 1, qty: b.slots[1].qty });
    must(s, 'donate', { project: 'greenhouse', bundle: b.id, slot: 3, qty: 3 });
    fillOthers(s, 'greenhouse', b.id);
    const r = must(s, 'donate', { project: 'greenhouse', bundle: b.id, slot: 2, qty: 99 }, { pid: 'p2' });
    const done = evs(r, 'bundleDone')[0];
    assert.deepEqual(done.back, [{ item: b.slots[3].item, qty: 3 }], 'the partial slot went back');
    assert.equal(s.farm.inventory[b.slots[3].item], b.slots[3].qty, 'all of it');
    assert.equal(evs(r, 'projectDone').length, 1);
    assert.ok(economy.projectDone(s, 'greenhouse'));
    assert.equal(s.farm.storage.greenhouse, 1, 'the Greenhouse waits in the build tray');
    assert.equal(run(s, 'donate', { project: 'greenhouse', bundle: b.id, slot: 3, qty: 1 }).code, 'ALREADY_DONE');
    assert.equal(restoration.openProject(s), null, 'the Mill Wheel opens at L19');
    s.farm.xp = content.xpForLevel(19);
    assert.equal(restoration.openProject(s).id, 'mill_wheel');
    assert.deepEqual(validateState(s), []);
  });
});

test('a coin slot is E(level) x hours of coins, given in parts, with the BIG_SPEND heads-up', () => {
  const s = farm(16, { coins: 3000 });
  const p = project('greenhouse');
  const b = p.bundles.find((x) => x.id === 'glass');
  const i = b.slots.findIndex((x) => x.coinsHoursBp);
  const need = content.eHours(p.unlock, b.slots[i].coinsHoursBp);
  assert.equal(restoration.slotNeed(p, b.slots[i]).need, need);
  must(s, 'donate', { project: 'greenhouse', bundle: 'glass', slot: i, qty: 500 });
  assert.equal(s.farm.stats['coins.spent'], 500);
  assert.equal(run(s, 'donate', { project: 'greenhouse', bundle: 'glass', slot: i, qty: 2000 }).code, 'BIG_SPEND');
  const r = must(s, 'donate', { project: 'greenhouse', bundle: 'glass', slot: i, qty: 2000, ...BIG });
  assert.equal(evs(r, 'bigSpend').length, 1);
  assert.equal(slotHave(s, 'greenhouse', 'glass', i), 2500);
  assert.equal(s.farm.stats['coins.spent'], 2500);
});
const slotHave = (s, p, b, i) => restoration.slotHave(s, p, b, i);

test('the Mill Wheel: Feed Mill and Windmill recipes take 20 % less time', () => {
  const s = farm(19);
  const mill = placeDef(s, 'mill', BIG);
  give(s, 'wheat', 30);
  must(s, 'craft', { id: mill, recipe: 'flour' });
  const ms = content.CONTENT.recipes.get('flour').ms;
  assert.equal(s.farm.objects[mill].queue[0].e - T0, ms);
  s.farm.restore.greenhouse = { s: {}, b: {}, done: T0 };
  s.farm.restore.mill_wheel = { s: {}, b: {}, done: T0 };
  must(s, 'craft', { id: mill, recipe: 'flour' }, { now: T0 + ms });
  const q = s.farm.objects[mill].queue.at(-1);
  assert.equal(q.e - q.s, ms - ms / 5);
  assert.equal(economy.recipeCutBp(s, 'chicken_feed'), 2000);
  assert.equal(economy.recipeCutBp(s, 'bread'), 0);
});

test('the Stone Bridge: the Hollow Meadow is land, +6 plot cap, and its wildflowers are bee forage x3', () => {
  const s = farm(22);
  const p = project('stone_bridge');
  const [x, z] = p.reward.land.rects[0];
  assert.equal(M.grid.inLand(s, x, z), false);
  const cap = M.decor.ownCap(s, content.defOf('plot'));
  s.farm.restore.greenhouse = { s: {}, b: {}, done: T0 };
  s.farm.restore.mill_wheel = { s: {}, b: {}, done: T0 };
  s.farm.restore.stone_bridge = { s: {}, b: {}, done: T0 };
  resetGrid(s);
  assert.equal(M.grid.inLand(s, x, z), true);
  assert.ok(M.grid.landRects(s).some((r) => r[0] === x && r[1] === z));
  assert.equal(M.decor.ownCap(s, content.defOf('plot')), cap + 6);
  // a hive at the meadow's edge counts its wildflowers
  const hive = placeDef(s, 'beehive', { at: [x + 7, z + 2], confirm: ['BIG_SPEND'] });
  assert.equal(M.animals.forageNear(s, hive), 3);
  assert.deepEqual(validateState(s), []);
});

test('Fair-prize slots fill from blue-ribbon goods produced while the Stone Bridge is open', () => {
  const s = farm(22);
  s.farm.restore.greenhouse = { s: {}, b: {}, done: T0 };
  s.farm.restore.mill_wheel = { s: {}, b: {}, done: T0 };
  assert.equal(restoration.openProject(s).id, 'stone_bridge');
  assert.equal(run(s, 'donate', { project: 'stone_bridge', bundle: 'fair_prizes', slot: 0, qty: 1 }).code, 'BAD_ARGS',
    'a Fair-prize slot is not given, it is grown');
  // golden seeds make sure blue ribbons
  const plots = ['home.0.0', 'home.0.1', 'home.0.2', 'home.0.3'];
  s.farm.golden = 4;
  must(s, 'plant', { ids: plots, crop: 'wheat', golden: true });
  const r = must(s, 'harvest', { ids: plots }, { now: T0 + HOUR });
  const d = evs(r, 'donated').filter((e) => e.deed);
  assert.equal(d.reduce((n, e) => n + e.qty, 0), 3, 'three blue-ribbon crops fill the slot; the fourth is not needed');
  assert.deepEqual(s.farm.restore.stone_bridge.s.fair_prizes['0'], { n: 3, by: { p1: 3 } });
});

// ---- Town Projects ------------------------------------------------------------------------------------------------

/**
 * The producers of `items` straight into the farm (a building with its inputs in the Barn, a home with adult animals
 * and their feed, mature trees): Town Projects ask only for goods the farm can make now (wave-2 QA RC-02).
 */
function producersFor(s, items, n = 2) {
  for (const id of items) {
    const it = content.itemOf(id);
    if (it.kind === 'craft') {
      const r = content.recipeOf(it.source);
      if (!Object.values(s.farm.objects).some((o) => o.def === r.building)) put(s, r.building);
      for (const i of Object.keys(r.inputs ?? {})) give(s, i, 50);
    } else if (it.kind === 'animal') {
      const a = content.animalOf(it.source);
      const home = put(s, a.homes[0]);
      for (let k = 0; k < n; k++) put(s, a.id, { home, adultAt: T0 - HOUR });
      if (a.feed) give(s, a.feed, 50);
    } else if (it.kind === 'fruit') {
      for (let k = 0; k < n; k++) put(s, it.source);
    }
  }
  return s;
}

/** A L20 farm that made `goods` today (rules-goals' made log: item -> farm day) and owns their producers. */
function townFarm(goods = ['bread', 'cheese', 'egg', 'apple'], level = 20) {
  const s = farm(level);
  const day = dayIndex(T0, s.meta.tz);
  for (const g of goods) s.farm.made[g] = day;
  return producersFor(s, goods.filter((g) => content.itemOf(g)?.kind !== 'crop'));
}

test('Ollie posts the next project at L20 once the farm made three eligible goods in the last 14 days', () => {
  const s = townFarm(['bread', 'wheat']);                       // raw crops never count
  producersFor(s, ['cheese', 'apple']);
  assert.equal(town.townPostCode(s, T0), 'NOT_READY');
  s.farm.made.cheese = dayIndex(T0, s.meta.tz) - 13;
  s.farm.made.apple = dayIndex(T0, s.meta.tz) - 14;             // 15 days ago: too old
  assert.equal(town.townPostCode(s, T0), 'NOT_READY');
  s.farm.made.egg = dayIndex(T0, s.meta.tz);
  assert.equal(town.townPostCode(s, T0), 'NOT_READY', 'Eggs made, but no hen left: never asked for (RC-02)');
  producersFor(s, ['egg']);
  assert.deepEqual(town.townCandidates(s, T0), ['bread', 'cheese', 'egg']);
  assert.ok(M.expansions.econDue(s, T0).some((a) => a.type === '_townPost'));
  const r = sys(s, '_townPost', {}, T0);
  const ev = evs(r, 'townPosted')[0];
  assert.equal(ev.project, 'ferry_landing');
  assert.equal(ev.n, 1);
  assert.deepEqual(ev.goods.map((g) => g.item).sort(), ['bread', 'cheese', 'egg']);
  assert.equal(ev.coins, town.townCoins(1, 20));
  // the goods are worth at most about E x 2 h in all, and each is at most 4 h of what the farm's producers make
  // (wave-2 QA RC-02: 798 Milk was 798 producer-hours)
  const value = ev.goods.reduce((n, g) => n + g.qty * content.itemOf(g.item).sell, 0);
  const target = content.eHours(20, content.TOWN_PROJECT_RULES.goodsHoursBp);
  assert.ok(value > 0 && value < target * 1.2, `${value} vs ${target}`);
  const P = producers(s, T0);
  for (const g of ev.goods) {
    const cap = producerUnits(P, g.item, content.TOWN_PROJECT_RULES.producerCapMs);
    assert.ok(g.qty >= 1 && g.qty <= cap, JSON.stringify(g));
  }
  assert.equal(town.townPostCode(s, T0), 'ALREADY_DONE', 'one at a time');
  assert.deepEqual(validateState(s), []);
  assert.equal(townFarm([], 19).farm.town.cur, null);
  assert.equal(town.townPostCode(townFarm(['bread', 'cheese', 'egg'], 19), T0), 'LOCKED');
});

test('the couple gives the goods piece by piece and funds the coins; it is built a day after the last piece', () => {
  const s = townFarm();
  sys(s, '_townPost', {}, T0);
  const cur = s.farm.town.cur;
  for (const g of cur.goods) give(s, g.item, g.qty + 5);
  const [g0, g1, g2] = cur.goods;
  must(s, 'townGive', { item: g0.item, qty: 1 });
  must(s, 'townGive', { item: g0.item, qty: 999 }, { pid: 'p2' });
  assert.deepEqual(s.farm.town.cur.goods[0], { ...g0, got: g0.qty, by: { p1: 1, p2: g0.qty - 1 } });
  assert.equal(run(s, 'townGive', { item: g0.item, qty: 1 }).code, 'ALREADY_DONE');
  assert.equal(run(s, 'townGive', { item: 'wheat', qty: 1 }).code, 'BAD_ARGS');
  must(s, 'townGive', { item: g1.item, qty: g1.qty });
  must(s, 'townGive', { item: g2.item, qty: g2.qty });
  s.farm.wallet.coins = 2 * cur.coins;
  assert.equal(run(s, 'townFund', { coins: cur.coins }).code, 'BIG_SPEND');
  must(s, 'townFund', { coins: 1000 });
  const r = must(s, 'townFund', { coins: cur.coins * 2, ...BIG }, { pid: 'p2', now: T0 + HOUR });
  assert.equal(s.farm.town.cur.paid, cur.coins, 'never more than asked');
  assert.deepEqual(s.farm.town.cur.by, { p1: 1000, p2: cur.coins - 1000 });
  assert.equal(evs(r, 'townReady')[0].buildAt, T0 + HOUR + DAY);
  assert.equal(run(s, 'townFund', { coins: 1 }).code, 'ALREADY_DONE');
  assert.equal(sys(s, '_townBuild', {}, T0 + HOUR + DAY - 1).code, 'NOT_READY');
  assert.ok(M.expansions.econNextDueAt(s, T0 + 2 * HOUR) <= T0 + HOUR + DAY);
  const acorns = s.farm.wallet.acorns;
  const b = sys(s, '_townBuild', {}, T0 + HOUR + DAY);
  const ev = evs(b, 'townBuilt')[0];
  assert.equal(ev.project, 'ferry_landing');
  assert.equal(ev.id, 'ferry_landing');
  assert.equal(ev.acorns, 5);
  assert.ok(s.farm.wallet.acorns >= acorns + 5, 'the 5 Acorns (a ribbon the build earns may add more)');
  assert.equal(s.farm.storage.ferry_landing_souvenir, 1);
  assert.deepEqual(s.farm.town, { n: 1, cur: null });
  // the next one is posted (goods made recently), with more coins
  const next = sys(s, '_townPost', {}, T0 + HOUR + DAY + 1);
  assert.equal(evs(next, 'townPosted')[0].n, 2);
  assert.ok(s.farm.town.cur.coins > cur.coins - 1);
  assert.deepEqual(validateState(s), []);
});

test('only Town Projects 1-4 are M1b: after the fourth, nothing more is posted (an M2 build posts the fifth)', () => {
  const s = townFarm();
  s.farm.town.n = 4;
  const fifth = [...content.CONTENT.townProjects.values()].find((p) => p.n === 5);
  if (content.isLive(fifth)) {
    assert.equal(town.nextTownProject(s)?.id, fifth.id, 'M2: Town Project 5 follows the fourth');
    return;
  }
  assert.equal(town.nextTownProject(s), null);
  assert.equal(town.townPostCode(s, T0), 'LOCKED');
});

test('the goods are rolled on a replicated counter: same farm, same roll; the counter moves each post', () => {
  const a = townFarm(['bread', 'cheese', 'egg', 'apple', 'milk', 'butter']);
  const b = townFarm(['bread', 'cheese', 'egg', 'apple', 'milk', 'butter']);
  sys(a, '_townPost', {}, T0);
  sys(b, '_townPost', {}, T0);
  assert.deepEqual(a.farm.town.cur.goods, b.farm.town.cur.goods);
  assert.equal(a.farm.rolls.town, 1);
});

test('"Need help" on a bundle slot (L23): my own flag toggles; the partner filling it is a Heart each', () => {
  const s = farm(22);
  const i = slotIndex('greenhouse', 'seedlings', 'wheat');
  const at = { project: 'greenhouse', bundle: 'seedlings', slot: i };
  assert.equal(run(s, 'restoreFlag', at).code, 'LOCKED', 'flags open at L23');
  s.farm.xp = content.xpForLevel(23);
  must(s, 'restoreFlag', at);
  assert.equal(restoration.flagOf(s, at), 'p1');
  assert.equal(run(s, 'restoreFlag', at, { pid: 'p2' }).code, 'OCCUPIED', 'the partner cannot take my flag down');
  must(s, 'restoreFlag', at);
  assert.equal(restoration.flagOf(s, at), null, 'a second press takes it down');
  assert.equal(s.farm.restore.greenhouse?.f, undefined, 'no empty flag maps are left behind');
  must(s, 'restoreFlag', at);
  const need = project('greenhouse').bundles.find((x) => x.id === 'seedlings').slots[i].qty;
  give(s, 'wheat', need);
  const h1 = s.players.p1.hearts;
  const h2 = s.players.p2.hearts;
  must(s, 'donate', { ...at, qty: need - 1 }, { pid: 'p2' });
  assert.equal(restoration.flagOf(s, at), 'p1', 'a part-filled slot keeps its flag');
  assert.equal(s.players.p2.hearts, h2);
  const r = must(s, 'donate', { ...at, qty: 1 }, { pid: 'p2' });
  assert.equal(evs(r, 'donated')[0].helped, 'p1');
  assert.equal(restoration.flagOf(s, at), null, 'the full slot drops its flag');
  assert.equal(s.players.p1.hearts, h1 + 1);
  assert.equal(s.players.p2.hearts, h2 + 1);
  assert.equal(restoration.ledgerOf(s)[0].bundles.find((b) => b.id === 'seedlings').slots[i].flag, null);
  assert.deepEqual(validateState(s), []);
  // my own flag filled by me pays nothing extra
  const j = project('greenhouse').bundles.find((x) => x.id === 'seedlings').slots.findIndex((x, k) => k !== i && x.item);
  const at2 = { ...at, slot: j };
  must(s, 'restoreFlag', at2);
  const it = project('greenhouse').bundles.find((x) => x.id === 'seedlings').slots[j];
  give(s, it.item, it.qty);
  const r2 = must(s, 'donate', { ...at2, qty: it.qty });
  assert.equal(evs(r2, 'donated')[0].helped, undefined);
  assert.deepEqual(validateState(s), []);
});

test('RC-13: "Need help" pays only when the partner gave over half the slot; unflag / reflag repeats nothing', () => {
  const s = farm(23);
  const i = slotIndex('greenhouse', 'seedlings', 'wheat');               // 20 Wheat
  const at = { project: 'greenhouse', bundle: 'seedlings', slot: i };
  const need = project('greenhouse').bundles.find((x) => x.id === 'seedlings').slots[i].qty;
  give(s, 'wheat', need);
  const h = [s.players.p1.hearts, s.players.p2.hearts];
  must(s, 'donate', { ...at, qty: need - 1 });                           // I give 19
  must(s, 'restoreFlag', at);
  must(s, 'restoreFlag', at);                                            // unflag
  must(s, 'restoreFlag', at);                                            // and flag again
  const r = must(s, 'donate', { ...at, qty: 1 }, { pid: 'p2' });          // the partner's one token unit fills it
  assert.equal(evs(r, 'donated')[0].helped, undefined, 'one unit is no help');
  assert.deepEqual([s.players.p1.hearts, s.players.p2.hearts], h);
  assert.equal(restoration.flagOf(s, at), null, 'the full slot drops its flag');
  // a real help: the partner gives 11 of 20
  const j = slotIndex('greenhouse', 'seedlings', 'carrot');
  const at2 = { ...at, slot: j };
  const need2 = project('greenhouse').bundles.find((x) => x.id === 'seedlings').slots[j].qty;
  give(s, 'carrot', need2);
  must(s, 'donate', { ...at2, qty: need2 - Math.floor(need2 / 2) - 1 });
  must(s, 'restoreFlag', at2);
  const r2 = must(s, 'donate', { ...at2, qty: need2 }, { pid: 'p2' });
  assert.equal(evs(r2, 'donated')[0].helped, 'p1');
  assert.deepEqual([s.players.p1.hearts, s.players.p2.hearts], [h[0] + 1, h[1] + 1]);
});
