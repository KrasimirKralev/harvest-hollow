// M2 long-term systems (GDD §3.6, §3.9, §4.8, §5.9): expansions 11-15 and barn upgrades 8-10, Restoration 4-6 (the
// Orchard Pond's irrigation, Grandma's Farmhouse: the room and the duet table's Kitchen slot), Town Projects 5-24 and
// the Festival Pavilion, Gold mastery, Grand decor and Showcase beauty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m2 } from './helpers/rules-economy-m2.js';

const M = await m2();
const { content, town, crafting, beauty, interior } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { sys } = M.helpers;
const { validateState } = M.state;
const { resetGrid } = M.gridCache;
const { dayIndex } = await import('../shared/rules/calendar.js');
const BIG = { confirm: ['BIG_SPEND'] };
const DAY = 24 * HOUR;

function farm(level, o = {}) {
  const s = farmAt(level, { coins: 900_000_000, acorns: 500, ...o });
  s.farm.expansions = content.live('expansions').map((e) => e.id);
  resetGrid(s);
  return s;
}
const project = (id) => content.CONTENT.restoration.get(id);
/** Mark projects done (setup) up to and excluding `upTo`, and every bundle of `upTo` but its last. */
function nearlyDone(s, upTo) {
  for (const p of [...content.live('restoration')].sort((a, b) => a.n - b.n)) {
    if (p.id === upTo) {
      s.farm.restore[p.id] = { s: {}, b: Object.fromEntries(p.bundles.slice(0, -1).map((b) => [b.id, T0])) };
      return p.bundles.at(-1);
    }
    s.farm.restore[p.id] = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, T0])), done: T0 };
  }
  return null;
}
/** Give the last bundle of the open project its goods (or coins) and donate them, so the project completes. */
function finish(s, pid, last, o = {}) {
  let r = null;
  for (let i = 0; i < last.need; i++) {
    const slot = last.slots[i];
    if (slot.item) give(s, slot.item, slot.qty);
    r = must(s, 'donate', { project: pid, bundle: last.id, slot: i, qty: 1_000_000, ...BIG }, o);
  }
  return r;
}

test('expansions 11-15: each opens at its level with its coins, Planks, Crates and proof task', () => {
  const s = farm(40);
  s.farm.expansions = content.live('expansions').filter((e) => e.k <= 10).map((e) => e.id);
  resetGrid(s);
  for (const e of content.live('expansions').filter((x) => x.k >= 11).sort((a, b) => a.k - b.k)) {
    assert.equal(e.m, 'M2');
    give(s, 'planks', e.planks);
    give(s, 'wooden_crate', e.crates);
    must(s, 'openExpansion', { expansion: e.id });
    assert.equal(run(s, 'expand', { expansion: e.id, ...BIG }).code, 'NOT_READY', `${e.id}: the proof first`);
    s.farm.proofs[e.id].n = Object.fromEntries(e.proof.map((t, i) => [String(i), t.qty]));
    const coins = s.farm.wallet.coins;
    must(s, 'expand', { expansion: e.id, ...BIG });
    assert.equal(coins - s.farm.wallet.coins, e.cost);
  }
  assert.equal(s.farm.expansions.length, content.live('expansions').length);
  assert.deepEqual(validateState(s), []);
});

test('an M2 proof counts the deed it names: Walnut harvests, Olive Oil, Maple Syrup, Gourmet Hampers', () => {
  const s = farm(39);
  s.farm.expansions = content.live('expansions').filter((e) => e.k <= 11).map((e) => e.id);
  resetGrid(s);
  must(s, 'openExpansion', { expansion: 'olive_terrace' });
  const press = placeDef(s, 'oil_press', BIG);
  const oil = content.recipeOf('olive_oil');
  for (const [k, n] of Object.entries(oil.inputs)) give(s, k, n * 2);
  must(s, 'craft', { id: press, recipe: 'olive_oil' });
  must(s, 'collectTray', { id: press }, { now: T0 + oil.ms * 2 });
  assert.equal(s.farm.proofs.olive_terrace.n['0'], oil.out);
});

test('barn upgrades 8-10 at L27 / 30 / 33, +120 each, to 1,400', () => {
  const s = farm(26);
  s.farm.barn = 7;
  give(s, 'planks', 40);
  give(s, 'wooden_crate', 10);
  assert.equal(run(s, 'upgradeBarn', BIG).code, 'LOCKED');
  for (const [lvl, cap] of [[27, 1160], [30, 1280], [33, 1400]]) {
    s.farm.xp = content.xpForLevel(lvl);
    must(s, 'upgradeBarn', BIG);
    assert.equal(M.economy.barnCap(s), cap);
  }
  assert.equal(run(s, 'upgradeBarn', BIG).code, 'CAP');
});

test('Restoration 4, the Orchard Pond: every tree cycle started after it is 10 % shorter', () => {
  const s = farm(25);
  const last = nearlyDone(s, 'orchard_pond');
  const before = M.economy.startCutBp(s, 'apple_tree', T0);
  finish(s, 'orchard_pond', last);
  assert.equal(M.economy.projectDone(s, 'orchard_pond'), true);
  assert.equal(M.economy.startCutBp(s, 'apple_tree', T0) - before, project('orchard_pond').reward.treeCycleBp);
  assert.equal(M.economy.startCutBp(s, 'cow', T0), M.economy.startCutBp(farm(25), 'cow', T0), 'trees only');
  // a tree started now carries the cut, and so does every later cycle (harvestTree re-reads startCutBp)
  const tree = placeDef(s, 'apple_tree', BIG, { now: T0 + MIN });
  const def = content.treeOf('apple_tree');
  const o = s.farm.objects[tree];
  assert.equal(o.cut, M.economy.startCutBp(s, 'apple_tree', T0 + MIN));
  assert.equal(o.readyAt - o.matureAt, def.cycleMs - Math.floor((def.cycleMs * o.cut) / 10_000));
  assert.deepEqual(validateState(s), []);
});

test('Restoration 6, Grandma\'s Farmhouse: the room opens with its fixed pieces; every Kitchen gets +1 slot', () => {
  const s = farm(34);
  const k1 = placeDef(s, 'kitchen', BIG);
  must(s, 'upgradeSlot', { id: k1, ...BIG });
  const slots = s.farm.objects[k1].slots;
  const price = crafting.slotPrice(s.farm.objects[k1]);
  const last = nearlyDone(s, 'farmhouse');
  assert.equal(interior.interiorOpen(s), false);
  assert.equal(run(s, 'furnish', { def: 'armchair', x: 0, z: 0 }).code, 'LOCKED');
  const r = finish(s, 'farmhouse', last);
  assert.ok(evs(r, 'projectDone').length === 1);
  assert.ok(evs(r, 'interiorOpened').length === 1);
  assert.equal(interior.interiorOpen(s), true);
  assert.equal(Object.keys(s.farm.interior.items).length, content.INTERIOR.fixed.length);
  // the duet table: one more slot on the Kitchen that stands, without changing what the next bought slot costs
  assert.equal(s.farm.objects[k1].slots, slots + 1);
  assert.equal(s.farm.objects[k1].xs, 1);
  assert.equal(crafting.slotPrice(s.farm.objects[k1]), price);
  assert.equal(crafting.slotMax(s.farm.objects[k1]), content.defOf('kitchen').slots[1] + 1);
  assert.deepEqual(evs(r, 'slotGranted').map((e) => e.id), [k1]);
  // a second Kitchen placed later comes with it
  const o = M.decor.newObject(s, content.defOf('kitchen'), 0, 0, 0, T0, 'p1');
  assert.equal(o.slots, content.defOf('kitchen').slots[0] + 1);
  assert.equal(o.xs, 1);
  // the slots are real: the Kitchen queues one more item than it bought slots for
  const recipe = content.recipesOf('kitchen').find((x) => x.unlock <= 34 && x.inputs);
  for (let i = 0; i < slots + 1; i++) {
    for (const [it, n] of Object.entries(recipe.inputs)) give(s, it, n);
    must(s, 'craft', { id: k1, recipe: recipe.id });
  }
  for (const [it, n] of Object.entries(recipe.inputs)) give(s, it, n);
  assert.equal(run(s, 'craft', { id: k1, recipe: recipe.id }).code, 'QUEUE_FULL');
  assert.deepEqual(validateState(s), []);
});

test('Town Projects 5-24 post and build in order; after the 24th the Festival Pavilion repeats', () => {
  const s = farm(38);
  const P = content.FESTIVAL_PAVILION;
  s.farm.town.n = 4;
  assert.equal(town.nextTownProject(s).id, 'lighthouse');
  s.farm.town.n = 23;
  assert.equal(town.nextTownProject(s).id, 'festival_arch');
  s.farm.town.n = P.after;
  const p1 = town.nextTownProject(s);
  assert.deepEqual([p1.id, p1.tier, p1.souvenir], [content.TOWN_PROJECT_RULES.repeatable, 1, P.souvenir]);
  // the whole round: posted from goods the farm made and can make, given, funded, built a day later
  const dairy = placeDef(s, 'dairy', BIG);
  placeDef(s, 'feed_mill', BIG);
  placeDef(s, 'cow_barn', BIG);
  must(s, 'buyAnimal', { def: 'cow', adult: true, ...BIG });
  placeDef(s, 'coop', BIG);
  must(s, 'buyAnimal', { def: 'chicken', adult: true, ...BIG });
  placeDef(s, 'apple_tree', BIG);
  const day = dayIndex(T0, s.meta.tz);
  for (const g of ['cheese', 'butter', 'egg', 'milk', 'apple']) s.farm.made[g] = day;
  assert.ok(dairy);
  const r = sys(s, '_townPost', {}, T0);
  assert.equal(r.ok, true, `${r.code} ${town.townCandidates(s, T0)}`);
  const cur = s.farm.town.cur;
  assert.equal(cur.id, 'festival_pavilion');
  assert.equal(cur.n, P.after + 1);
  assert.deepEqual(validateState(s), []);
  for (const g of cur.goods) { give(s, g.item, g.qty); must(s, 'townGive', { item: g.item, qty: g.qty }); }
  must(s, 'townFund', { coins: cur.coins, ...BIG });
  const b = sys(s, '_townBuild', {}, T0 + DAY);
  const built = evs(b, 'townBuilt')[0];
  assert.deepEqual([built.project, built.tier, built.souvenir], ['festival_pavilion', 1, P.souvenir]);
  const p2 = town.nextTownProject(s);
  assert.deepEqual([p2.tier, p2.souvenir, p2.n], [2, null, P.after + 2]);
  assert.ok(town.townCoins(p2.n, 38) > town.townCoins(p1.n, 38), 'the formula keeps counting');
  s.farm.town.n = P.after + P.tiers.length + 3;
  assert.match(town.nextTownProject(s).name, /tier \d+$/);
  assert.deepEqual(validateState(s), []);
});

test('Gold mastery from L30: crops +5 blue-ribbon points, animals +5 premium points, recipes +5 % XP', () => {
  const s = farm(29);
  const wheat = content.cropOf('wheat');
  s.farm.mastery.wheat = wheat.mastery[3];
  assert.equal(M.economy.starsOf(s, 'wheat'), 3, 'Gold waits for L30');
  s.farm.xp = content.xpForLevel(30);
  assert.equal(M.economy.starsOf(s, 'wheat'), 4);
  const fx = M.economy.masteryEffects('crops', 4);
  assert.equal(fx.ribbonBp, 500);
  assert.equal(M.economy.masteryEffects('animals', 4).premiumBp, 500);
  assert.equal(M.economy.masteryEffects('recipes', 4).xpBp, 500);
  // a recipe at Gold pays 5 % more XP at the tray
  const bakery = placeDef(s, 'bakery', BIG);
  const bread = content.recipeOf('bread');
  s.farm.mastery.bread = bread.mastery[3];
  for (const [k, n] of Object.entries(bread.inputs)) give(s, k, n);
  must(s, 'craft', { id: bakery, recipe: 'bread' });
  const c = must(s, 'collectTray', { id: bakery }, { now: T0 + bread.ms });
  assert.equal(evs(c, 'crafted')[0].xp, bread.xp + Math.floor((bread.xp * 500) / 10_000));
});

test('Grand decor counts its beauty like any decor; Showcase points start past the fifth star', () => {
  const s = farm(40);
  const b0 = beauty.beautyOf(s, T0).score;
  placeDef(s, 'koi_pond', BIG);
  const koi = content.defOf('koi_pond');
  assert.equal(koi.tier, 'grand');
  assert.equal(beauty.beautyOf(s, T0).score - b0, Math.floor(koi.beauty10 / 10));
  assert.equal(run(s, 'masterwork', { id: Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'koi_pond'),
    ...BIG }).code, 'LOCKED', 'Masterwork is for coin decor');
  for (const id of ['bath_house', 'golden_gate', 'orangery', 'carousel', 'treehouse', 'clock_tower',
    'arbor_of_lights', 'flower_maze', 'grand_windmill']) placeDef(s, id, BIG);
  const b = beauty.beautyOf(s, T0);
  assert.equal(b.showcase, Math.max(0, b.score - content.FARM_BEAUTY.stars.at(-1)));
  assert.deepEqual(validateState(s), []);
});

test('generic crafting runs every M2 recipe and hamper: queued with its inputs, collected with its output', () => {
  const s = farm(40);
  s.farm.barn = 10;
  const at = new Map();
  for (const r of content.live('recipes').filter((x) => x.m === 'M2')) {
    let id = at.get(r.building);
    if (!id) {
      id = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === r.building) ?? placeDef(s, r.building, BIG);
      at.set(r.building, id);
    }
    for (const [k, n] of Object.entries(r.inputs ?? {})) give(s, k, n);
    const q = run(s, 'craft', { id, recipe: r.id }, { now: T0 });
    assert.equal(q.ok, true, `${r.building}/${r.id}: ${q.code}`);
    const c = must(s, 'collectTray', { id }, { now: T0 + 30 * DAY });
    const got = evs(c, 'crafted').find((e) => e.recipe === r.id);
    assert.ok(got && got.qty >= r.out, `${r.id} collected`);
  }
  assert.ok(at.has('oil_press') && at.has('sugar_shack') && at.has('chocolatier'));
  assert.ok(content.live('recipes').some((x) => x.m === 'M2' && /hamper/.test(x.id)), 'hampers are M2 recipes');
  assert.deepEqual(validateState(s), []);
});

test('second Feed Mill from L31 and second Pie Oven from L33; the Grand Sickle from L26', () => {
  const s = farm(30);
  placeDef(s, 'feed_mill', BIG);
  placeDef(s, 'pie_oven', BIG);
  assert.equal(M.decor.buyPrice(s, 'feed_mill').code, 'CAP');
  s.farm.xp = content.xpForLevel(31);
  assert.equal(M.decor.buyPrice(s, 'feed_mill').coins, content.defOf('feed_mill').secondCopy.cost);
  placeDef(s, 'feed_mill', BIG);
  assert.equal(M.decor.buyPrice(s, 'pie_oven').code, 'CAP');
  s.farm.xp = content.xpForLevel(33);
  placeDef(s, 'pie_oven', BIG);
  const t = farm(25);
  assert.equal(run(t, 'buyTool', { tool: 'grand_sickle', ...BIG }).code, 'LOCKED');
  t.farm.xp = content.xpForLevel(26);
  must(t, 'buyTool', { tool: 'grand_sickle', ...BIG });
  assert.deepEqual(validateState(s), []);
});
