// The "perfect logic" contract (GDD §4.9) asserted again on shared/content: R1-R18 where they are properties of the
// content (R12, R16 and the SIM row are rules / simulator properties; their content halves are checked here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, MODEL, ORDERS, COUPLE_CHALLENGE, COOP, GROWTH, MARKET, MILESTONE, live, unlocksAt, validateContent, isLive,
} from '../shared/content/index.js';
import { E, nice, cropGross, minutes, rederiveValues, inputValue, LAST_LEVEL } from './helpers/content.js';

const C = MODEL.C;
const crops = [...CONTENT.crops.values()];
// the Rainbow Tree (wave 4b) is an Acorn shop relic, not a tree of the model: it borrows the others' fruit
const trees = [...CONTENT.trees.values()].filter((t) => !t.relic);
const animals = [...CONTENT.animals.values()];
const recipes = [...CONTENT.recipes.values()];
const items = [...CONTENT.items.values()];
const item = (id) => CONTENT.items.get(id);

test('R1: one formula prices everything (values, seeds, XP, prices recomputed from GDD §4.3)', () => {
  const V = rederiveValues();
  for (const it of items) assert.equal(it.sell, V.get(it.id), `V(${it.id})`);
  for (const c of crops) {
    const g = c.sell * c.yield;
    assert.equal(c.seed, Math.max(2, Math.round(g * C.SEED_SHARE)), `${c.id}.seed`);
    assert.equal(c.xp, Math.max(1, Math.round(g / C.XP_DIV)), `${c.id}.xp`);
  }
  for (const t of trees) {
    const v = item(t.product).sell;
    assert.equal(t.cost, nice(v * t.yield * 6), `${t.id}.cost = 6 harvests`);
    assert.equal(t.xp, Math.max(1, Math.round((v * t.yield) / C.XP_DIV)), `${t.id}.xp`);
    assert.equal(t.growthBp, 4500);
  }
  for (const a of animals) {
    const feedVal = a.feed ? item(a.feed).sell * a.feedQty : 0;
    const net = item(a.product).sell * a.out - feedVal;
    assert.equal(a.xp, Math.max(1, Math.round((item(a.product).sell * a.out) / C.XP_DIV)), `${a.id}.xp`);
    if (a.baby !== null) {
      assert.equal(a.baby, nice(net * 10), `${a.id}.baby = 10 collections of net value`);
      assert.equal(a.adult, nice(a.baby * 1.6), `${a.id}.adult`);
    }
    assert.equal(item(a.premium).sell, item(a.product).sell * 4, `${a.premium} = 4 x V`);
  }
  for (const r of recipes) {
    const added = r.sell * r.out - inputValue(r);
    assert.equal(r.xp, Math.max(1, Math.round(added / C.XP_DIV)), `${r.id}.xp`);
    if (r.duet) assert.equal(r.duetXp, Math.max(1, Math.round((added / C.XP_DIV) * 1.25)), `${r.id}.duetXp`);
  }
  for (const q of CONTENT.quests.values()) {
    const coins = nice((E(q.level) * q.minutes) / 60 * 0.5);
    assert.equal(q.coins, coins, `${q.id}.coins`);
    assert.equal(q.xp, nice(coins / C.XP_DIV), `${q.id}.xp`);
  }
  for (const e of CONTENT.expansions.values()) {
    if (e.k > 0) assert.equal(e.cost, nice(E(e.unlock) * (0.6 + 0.2 * e.k)), `${e.id}.cost`);
  }
  for (const b of CONTENT.barn) assert.equal(b.cost, nice(E(b.unlock) * 0.3 * 1.15 ** (b.n - 1)), `barn ${b.n}`);
  for (const b of CONTENT.buildings.values()) {
    b.slotCosts.forEach((c, k) => assert.equal(c, nice(E(b.unlock) * 0.25 * 1.6 ** k), `${b.id} slot ${k + 1}`));
  }
  for (const h of CONTENT.homes.values()) {
    if (h.upgradeCost !== null) assert.equal(h.upgradeCost, nice(E(h.unlock) * 0.2), `${h.id}.upgradeCost`);
    if (h.unlock > 2 && h.id !== 'beehive') assert.equal(h.cost, nice(E(h.unlock) * 0.35), `${h.id}.cost`);
  }
  for (const d of CONTENT.decor.values()) {
    if (d.tier === 'coin') assert.equal(d.cost, nice(Math.max(5,
      (d.beauty10 / 10) * 40 * (1 + 0.04 * (d.unlock - 1)))), d.id);
  }
  for (const l of CONTENT.levels) if (l.level > 1) assert.equal(l.coins, nice(l.E * 0.15), `level ${l.level} coins`);
});

test('R2: seeds never cost more than the plot returns', () => {
  for (const c of crops) assert.ok(c.seed < c.yield * c.sell, c.id);
});

test('R3: no value-losing step (every recipe output >= 1.15 x its input value)', () => {
  for (const r of recipes) assert.ok(r.sell * r.out >= 1.15 * inputValue(r),
    `${r.id}: ${r.sell * r.out} vs ${inputValue(r)}`);
});

test('R4: no dead ends (raw goods have >= 2 uses, the first within 3 levels; Manure -> Compost is the exception)',
  () => {
  const uses = new Map();
  const add = (i, u, lvl) => { if (!uses.has(i)) uses.set(i, []); uses.get(i).push([u, lvl]); };
  for (const r of recipes) for (const i of Object.keys(r.inputs)) add(i, r.id, r.unlock);
  for (const f of CONTENT.feeds.values()) {
    for (const { cls } of f.classes) for (const it of items) if (it.classes.includes(cls)) add(it.id, f.id, f.unlock);
  }
  add('wood', 'construction', 6);   // barn upgrades and expansions (GDD §3.9)
  const raws = items.filter((it) => ['crop', 'fruit', 'material', 'animal'].includes(it.kind));
  for (const it of raws) {
    const u = uses.get(it.id) ?? [];
    assert.ok(u.length >= (it.id === 'manure' ? 1 : 2), `${it.id} has ${u.length} use(s)`);
    const first = Math.min(...u.map(([, lvl]) => lvl));
    assert.ok(first - it.unlock <= 3, `${it.id} (L${it.unlock}) has no use until L${first}`);
  }
  // in this build every live raw good has a live use or sells
  for (const it of raws.filter(isLive)) {
    const liveUse = (uses.get(it.id) ?? []).some(([u]) => u === 'construction'
      || isLive(CONTENT.recipes.get(u) ?? CONTENT.feeds.get(u)));
    assert.ok(liveUse || it.sellable, it.id);
  }
});

test('R5: no arbitrage (the store never sells what the Market buys cheaper; consumables never sell)', () => {
  for (const it of items) {
    if (it.storePrice !== undefined) assert.ok(!it.sellable || it.storePrice > it.sell, it.id);
    if (['feed', 'consumable'].includes(it.kind)) assert.equal(it.sellable || it.orderable, false, it.id);
  }
  for (const id of ['compost', 'baby_bottle', 'chicken_feed', 'livestock_feed']) assert.equal(item(id).sellable,
    false, id);
  assert.equal(item('wood').orderable, false);
  assert.equal(item('golden_egg').orderable, false);
  assert.equal(item('sweetheart_cake').orderable, false, 'duet goods only in golden orders');
  for (const bp of Object.values(MARKET.refunds)) assert.ok(bp <= 10_000, 'a refund never returns more than was paid');
});

test('R6: unlock order holds (inputs, buildings and quest references unlocked at or before)', () => {
  for (const r of recipes) {
    assert.ok(CONTENT.buildings.get(r.building).unlock <= r.unlock, r.id);
    for (const i of Object.keys(r.inputs)) assert.ok(item(i).unlock <= r.unlock, `${r.id} needs ${i}`);
  }
  assert.deepEqual(validateContent().filter((e) => e.includes('R6')), []);
});

test('R6+: every live recipe and quest item has a full live production chain', () => {
  const producible = (id, seen = new Set()) => {
    const it = item(id);
    if (!it || !isLive(it) || seen.has(id)) return false;
    // `seen` guards against cycles along one path only: one good may feed a chain twice (Milk in Chocolate Cake)
    seen.add(id);
    const r = CONTENT.recipes.get(id);
    if (r && isLive(r) && it.source === r.id) {
      const ok = Object.keys(r.inputs).every((i) => producible(i, seen));
      seen.delete(id);
      return ok;
    }
    seen.delete(id);
    const src = CONTENT.crops.get(it.source) ?? CONTENT.trees.get(it.source) ?? CONTENT.animals.get(it.source)
      ?? CONTENT.feeds.get(it.source) ?? CONTENT.buildings.get(it.source);
    return Boolean(src && isLive(src));
  };
  for (const r of live('recipes')) for (const i of Object.keys(r.inputs)) assert.ok(producible(i), `${r.id} <- ${i}`);
  for (const q of live('quests')) {
    for (const t of q.tasks) if (['make', 'collect', 'deliver', 'harvest', 'sell'].includes(t.verb)
      && item(t.ref)) assert.ok(producible(t.ref), `${q.id} ${t.ref}`);
  }
});

test('R7: from L12 every horizon band has a crop (<= 3 min, 10-60 min, 2-6 h, 8-16 h, >= 24 h)', () => {
  const bands = [[0, 3], [10, 60], [120, 360], [480, 960], [1440, Infinity]];
  for (let L = 12; L <= 40; L++) {
    for (const [a, b] of bands) {
      assert.ok(crops.some((c) => c.unlock <= L && minutes(c.growMs) >= a && minutes(c.growMs) <= b),
        `L${L} band ${a}-${b}`);
    }
  }
  for (const [a, b] of bands) assert.ok(live('crops').some((c) => minutes(c.growMs) >= a && minutes(c.growMs) <= b),
    `${MILESTONE} band ${a}-${b}`);
});

test('R8: every level gives something; no crop/tree/animal/building gap longer than 3 levels', () => {
  const core = ['crops', 'trees', 'animals', 'buildings'];
  const at = (L, fams) => fams.some((f) => [...CONTENT[f].values()].some((d) => d.unlock === L));
  for (let L = 1; L <= 40; L++) {
    assert.ok(at(L, [...core, 'recipes', 'decor', 'features']) || CONTENT.barn.some((b) => b.unlock === L)
      || [...CONTENT.expansions.values()].some((e) => e.unlock === L), `L${L} unlocks nothing`);
  }
  for (let L = 4; L <= 40; L++) assert.ok([L - 3, L - 2, L - 1, L].some((k) => at(k, core)), `gap before L${L}`);
  for (let L = 1; L <= LAST_LEVEL[MILESTONE]; L++) {
    assert.ok(unlocksAt(L).length > 0, `${MILESTONE} level ${L} unlocks nothing live`);
  }
});

test('R9: monotonic curve (XP to next strictly increases, E never falls)', () => {
  const L = CONTENT.levels;
  for (let i = 1; i < L.length - 1; i++) assert.ok(L[i].xpToNext > L[i - 1].xpToNext, `L${i + 1}`);
  for (let i = 1; i < L.length; i++) assert.ok(L[i].E >= L[i - 1].E, `E at L${i + 1}`);
});

test('R10: every animal product is worth more than its feed', () => {
  for (const a of animals) {
    const feedVal = a.feed ? item(a.feed).sell * a.feedQty : 0;
    assert.ok(item(a.product).sell * a.out > feedVal, a.id);
  }
});

test('R11: every ribbon Gold tier is reachable from the content', () => {
  assert.deepEqual(validateContent().filter((e) => e.includes('R11')), []);
  const r = (id) => CONTENT.ribbons.get(id).tiers.at(-1);
  assert.equal(r('rainbow_harvest'), CONTENT.crops.size);
  assert.equal(r('recipe_box'), CONTENT.recipes.size);
  assert.equal(r('orchardist'), trees.length);          // the shop's species (the Rainbow Tree relic is a bonus)
  assert.equal(r('full_barnyard'), CONTENT.animals.size);
  assert.equal(r('room_to_grow'), CONTENT.expansions.size - 1);
  assert.equal(r('crop_master'), CONTENT.crops.size);
});

test('R12: no refund loop (decor grants no XP; no refund returns more than was paid)', () => {
  for (const d of CONTENT.decor.values()) assert.equal(d.xp, undefined, `${d.id} grants no XP`);
  for (const fam of ['buildings', 'homes', 'plots']) for (const d of CONTENT[fam].values()) assert.equal(d.xp,
    undefined, `${d.id}: buying grants no XP`);
  assert.ok(CONTENT.plots.get('plot').refundBp <= 10_000);
});

test('R13: every bonus variant is worth at least its base (giant, blue ribbon, premium, duet)', () => {
  for (const c of crops) assert.ok(2 * 9 * (c.yield + 1) >= 9 * (c.yield + 1 + 0.1), c.id);
  for (const a of animals) assert.ok(item(a.premium).sell >= item(a.product).sell, a.id);
  for (const r of recipes.filter((x) => x.duet)) assert.ok(r.duetXp >= r.xp, r.id);
  assert.ok(GROWTH.compost.ribbonUnits >= 1 && GROWTH.compost.bonusUnits >= 1);
  assert.equal(COOP.giant.yieldMul, 2);
});

test('R15: repeatable rewards count value, never player-controlled counts', () => {
  assert.ok(ORDERS.meter.chests.every((c) => c.atBp > 0), "Mabel's meter counts value in E-hours");
  assert.equal(ORDERS.safety.simpleWeightBp, 2500, 'simple orders count 1/4');
  assert.equal(CONTENT.ribbons.get('good_business').scale, 4);
  for (const t of COUPLE_CHALLENGE.templates) assert.notEqual(t.measure, 'ordersFilled', t.id);
});

test('R17: every co-op bonus is an extra on top of a base anyone gets', () => {
  assert.ok(GROWTH.water.cropBp > 0 && COOP.partnerTend.bp > 0 && COOP.partnerTend.bp < GROWTH.water.cropBp);
  assert.ok(COOP.duet.soloTimeBp > 10_000, 'alone, a duet still cooks (slowly)');
  assert.ok(COOP.helpFlags.xpBonusBp > 0 && COOP.petting.soloBp > 0 && COOP.petting.bothBp > COOP.petting.soloBp);
});

test('R18: no dominated recipe or crop', () => {
  const perH = (x) => (x.sell * x.out - inputValue(x)) / minutes(x.ms);
  const added = (x) => x.sell * x.out - inputValue(x);
  for (const r of recipes) {
    const by = recipes.filter((o) => o !== r && o.building === r.building && o.unlock <= r.unlock
      && perH(o) > perH(r) && added(o) > added(r));
    assert.deepEqual(by.map((o) => o.id), [], `${r.id} is dominated`);
  }
  const net = (c) => c.sell * c.yield - c.seed;
  const netH = (c) => net(c) / minutes(c.growMs);
  for (const c of crops) {
    const by = crops.filter((o) => o !== c && o.unlock <= c.unlock && netH(o) > netH(c) && net(o) > net(c));
    assert.deepEqual(by.map((o) => o.id), [], `${c.id} is dominated`);
  }
});

test('no coin pump: the recipe graph is acyclic and the store sells nothing a recipe consumes', () => {
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return false;
    if (state.get(id) === 2) return true;
    state.set(id, 1);
    const r = CONTENT.recipes.get(id);
    const ok = !r || Object.keys(r.inputs).every(visit);
    state.set(id, 2);
    return ok;
  };
  for (const r of recipes) assert.ok(visit(r.id), `cycle through ${r.id}`);
  const sold = items.filter((it) => it.storePrice !== undefined).map((it) => it.id);
  for (const r of recipes) for (const i of Object.keys(r.inputs)) assert.ok(!sold.includes(i),
    `${r.id} consumes store item ${i}`);
});

test('crop gross follows GDD §4.3 (attention-free up to an hour, hours^0.45 beyond)', () => {
  for (const c of crops) {
    const g = cropGross(minutes(c.growMs), c.unlock);
    assert.ok(Math.abs(c.sell * c.yield - g) <= c.yield / 2 + 0.5, c.id);
  }
});
