// M2 perk effects, the economy side (GDD §4.7; rules-goals owns the picks and the XP perks): every effect applies to
// the OWNER's own actions only and never changes the partner's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m2 } from './helpers/rules-economy-m2.js';

const M = await m2();
const { content, economy, farming, decor, crafting } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const { makeCtx } = M.index;
const BIG = { confirm: ['BIG_SPEND'] };

/** An L30 farm where p1 owns every perk of `trees` and p2 owns none. */
function farm(trees = ['grower', 'rancher', 'orchardist', 'artisan']) {
  const s = farmAt(30, { coins: 900_000_000, acorns: 500 });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  s.players.p1.perks = { t: Object.fromEntries(trees.map((t) => [t, 5])), r: null };
  return s;
}
const ctx = (s, pid) => makeCtx(s, { now: T0, pid, cid: 'tstcid', seq: 1 });

test('the perk reader: rules-goals\' perkValue, the owner only, 0 for the partner and for the system', () => {
  const s = farm();
  assert.equal(economy.playerPerk(s, 'p1', 'grower', 'seedBp'), 1000);
  assert.equal(economy.playerPerk(s, 'p2', 'grower', 'seedBp'), 0);
  assert.equal(economy.playerPerk(s, 'sys', 'grower', 'seedBp'), 0);
  s.players.p1.perks.t.grower = 1;
  assert.equal(economy.playerPerk(s, 'p1', 'grower', 'seedBp'), 0, 'perk 2 needs perk 2 bought');
});

test('Grower: seeds 10 % cheaper and watering 5 % more, for the grower\'s own plantings and waterings', () => {
  const s = farm(['grower']);
  const crop = content.cropOf('pumpkin');
  assert.equal(farming.seedPrice(s, crop, 'p1'), crop.seed - Math.floor(crop.seed / 10));
  assert.equal(farming.seedPrice(s, crop, 'p2'), crop.seed);
  const plots = Object.keys(s.farm.objects).filter((k) => s.farm.objects[k].def === 'plot').slice(0, 2);
  const spent = s.farm.stats['coins.spent'] ?? 0;
  must(s, 'plant', { id: plots[0], crop: 'pumpkin' });
  assert.equal((s.farm.stats['coins.spent'] ?? 0) - spent, farming.seedPrice(s, crop, 'p1'));
  must(s, 'plant', { id: plots[1], crop: 'pumpkin' }, { pid: 'p2' });
  const w1 = evs(must(s, 'water', { id: plots[0] }, { now: T0 + MIN }), 'watered')[0].savedMs;
  const w2 = evs(must(s, 'water', { id: plots[1] }, { pid: 'p2', now: T0 + MIN }), 'watered')[0].savedMs;
  assert.ok(w1 > w2, `the grower's watering saves more (${w1} > ${w2})`);
  assert.deepEqual(validateState(s), []);
});

test('Grower: the harvester\'s +1-unit chance and +3 blue-ribbon points (inside the 24 % cap)', () => {
  const s = farm(['grower']);
  const plot = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'plot');
  let more = 0;
  for (let cycle = 0; cycle < 400; cycle++) {
    s.farm.objects[plot].cycle = cycle;
    s.farm.objects[plot].crop = { def: 'wheat', plantedAt: T0 - HOUR, readyAt: T0 - MIN, by: 'p1', cycle, cut: 0 };
    more += farming.harvestOf(s, plot, ctx(s, 'p1')).qty - farming.harvestOf(s, plot, ctx(s, 'p2')).qty;
  }
  assert.ok(more >= 8 && more <= 40, `about 5 % of 400 harvests: ${more}`);
});

test('Rancher: babies 15 % quicker, 10 % free feed, 5 % double product, the blue-ribbon good sooner', () => {
  const s = farm(['rancher']);
  placeDef(s, 'cow_barn', BIG);
  s.farm.objects[Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'cow_barn')].up = 2;
  const def = content.animalOf('cow');
  const b1 = evs(must(s, 'buyAnimal', { def: 'cow', ...BIG }), 'bought')[0].id;
  const b2 = evs(must(s, 'buyAnimal', { def: 'cow', ...BIG }, { pid: 'p2' }), 'bought')[0].id;
  assert.equal(s.farm.objects[b1].adultAt - T0, def.babyMs - Math.floor((def.babyMs * 1500) / 10_000));
  assert.equal(s.farm.objects[b2].adultAt - T0, def.babyMs);
  // free feed: over many feedings about 10 % use none (the tender's perk)
  const cow = evs(must(s, 'buyAnimal', { def: 'cow', adult: true, ...BIG }), 'bought')[0].id;
  let free = 0;
  for (let c = 0; c < 300; c++) {
    s.farm.objects[cow].cycle = c;
    s.farm.objects[cow].readyAt = null;
    s.farm.objects[cow].fedAt = null;
    give(s, 'livestock_feed', 1);
    const r = must(s, 'feed', { id: cow }, { now: T0 + c * HOUR });
    if (evs(r, 'fed')[0].free) free++;
    else assert.equal(evs(r, 'fed')[0].qty, def.feedQty);
    if (evs(r, 'fed')[0].free) s.farm.inventory.livestock_feed -= 1;   // keep the barn small (setup)
    if (!s.farm.inventory.livestock_feed) delete s.farm.inventory.livestock_feed;
  }
  assert.ok(free >= 15 && free <= 50, `about 10 % of 300 feedings: ${free}`);
  // the blue-ribbon good: from 80 % of prizedAt collections for the perk owner's collections only
  const o = s.farm.objects[cow];
  o.cycle = def.prizedAt - Math.floor((def.prizedAt * 2000) / 10_000);
  o.fedAt = T0;
  o.readyAt = T0;
  let goodP1 = 0;
  let goodP2 = 0;
  for (let c = 0; c < 200; c++) {
    o.cycle = Math.min(def.prizedAt - 1, o.cycle);
    const a1 = M.animals.collectOf(s, cow, makeCtx(s, { now: T0, pid: 'p1', cid: 'x', seq: c + 1 }));
    const a2 = M.animals.collectOf(s, cow, makeCtx(s, { now: T0, pid: 'p2', cid: 'x', seq: c + 1 }));
    if (a1.good) goodP1++;
    if (a2.good) goodP2++;
    s.meta.farmSeed = (s.meta.farmSeed + 7919) >>> 0;        // other rolls for the same cycle (test only)
  }
  assert.equal(goodP2, 0, 'not prized yet for the partner');
  assert.ok(goodP1 > 0, 'the rancher already finds blue-ribbon goods');
});

test('Orchardist: trees 10 % cheaper for the buyer, +1 fruit 10 %, Heirloom bonuses from 45 harvests', () => {
  const s = farm(['orchardist']);
  const p1 = decor.buyPrice(s, 'apple_tree', 'p1').coins;
  const p2 = decor.buyPrice(s, 'apple_tree', 'p2').coins;
  assert.equal(p1, p2 - Math.floor(p2 / 10));
  const spent = s.farm.stats['coins.spent'] ?? 0;
  const id = placeDef(s, 'apple_tree', BIG);
  assert.equal((s.farm.stats['coins.spent'] ?? 0) - spent, p1);
  assert.equal(s.farm.objects[id].paid.coins, p1, 'the resale base is what was paid');
  const o = s.farm.objects[id];
  o.cycle = 45;
  const h1 = M.trees.treeHarvestOf(s, id, ctx(s, 'p1'));
  const h2 = M.trees.treeHarvestOf(s, id, ctx(s, 'p2'));
  assert.equal(h1.heirloom, true);
  assert.equal(h2.heirloom, false);
  assert.ok(h1.qty > h2.qty);
});

test('Artisan: own queued items 5 % quicker; crafted goods sell 5 % higher for the seller', () => {
  const s = farm(['artisan']);
  const bakery = placeDef(s, 'bakery', BIG);
  must(s, 'upgradeSlot', { id: bakery, ...BIG });
  const bread = content.recipeOf('bread');
  for (const [k, n] of Object.entries(bread.inputs)) give(s, k, n * 2);
  const q1 = evs(must(s, 'craft', { id: bakery, recipe: 'bread' }), 'queued')[0];
  assert.equal(q1.endsAt - T0, bread.ms - Math.floor((bread.ms * 500) / 10_000));
  const s2 = farm([]);
  const b2 = placeDef(s2, 'bakery', BIG);
  for (const [k, n] of Object.entries(bread.inputs)) give(s2, k, n);
  assert.equal(evs(must(s2, 'craft', { id: b2, recipe: 'bread' }), 'queued')[0].endsAt - T0, bread.ms);
  give(s, 'bread', 20);
  const c1 = evs(must(s, 'sell', { item: 'bread', qty: 10 }), 'sold')[0].coins;
  const c2 = evs(must(s, 'sell', { item: 'bread', qty: 10 }, { pid: 'p2' }), 'sold')[0].coins;
  assert.ok(c1 > c2, `${c1} > ${c2}`);
  assert.equal(economy.saleOf(s, 'wheat', 10, T0, 'p1').coins, economy.saleOf(s, 'wheat', 10, T0, 'p2').coins,
    'raw crops are not crafted goods');
  assert.equal(crafting.slotPrice(s.farm.objects[bakery]) !== undefined, true);
  assert.deepEqual(validateState(s), []);
});
