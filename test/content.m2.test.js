// M2 content audit (wave 3, content brief): every M2 family is complete against GDD §3, §4.6-4.8, §5, §6.2 and §10
// (L26-40), the new M2 rule data (fishing, duel, rested XP, the farmhouse interior, Grandma's visit, the track and
// Legacy rewards, the Festival Pavilion) is consistent, and the flip gate: a build that plays M2 has rules for every
// live M2 system. Holds for MILESTONE 'M1b' and 'M2' alike (the gate's rules check runs only once M2 is live).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, MILESTONE, FAIR, BREEDING, NURSERY, PERKS, RESTED, SEASONAL_TRACK, LEGACY, FESTIVAL_PAVILION, FISHING,
  DUEL, INTERIOR, GRANDMA_VISIT, MASTERY, TOWN_PROJECT_RULES, COLLECTION_RULES, DAILY_GIFT, TUTORIAL, COOP, ORDERS,
  STORY_BEATS, isLive, live, validateContent, questOf, decorOf, furnitureOf, featureOf, levelFromXp, xpForLevel,
  masteryStars, cropOf, eHours, levelRow, unlocksAt,
} from '../shared/content/index.js';
import { tablesClone, upTo, LAST_LEVEL } from './helpers/content.js';

const m2 = (fam) => [...CONTENT[fam].values()].filter((d) => d.m === 'M2');
const sortedText = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).sort().join(', ');
const H = 10_000;

test('crops, trees and the Alpaca of L26-40 are GDD §3.1 / §3.2 / §3.4', () => {
  const crops = { watermelon: [27, 960, 503, 2, 629, 157, '10/50/150/500', 'summer'],
    pepper: [31, 300, 311, 3, 259, 97, '11/55/170/570', 'summer'],
    rice: [35, 480, 400, 3, 333, 125, '10/50/150/500', 'autumn'] };
  assert.deepEqual(m2('crops').map((c) => c.id), Object.keys(crops));
  for (const [id, [L, min, seed, y, sell, xp, mastery, season]] of Object.entries(crops)) {
    const c = cropOf(id);
    assert.deepEqual([c.unlock, c.growMs / 60_000, c.seed, c.yield, c.sell, c.xp, c.mastery.join('/'), c.season],
      [L, min, seed, y, sell, xp, mastery, season], id);
  }
  const trees = { walnut_tree: [26, 10_000, 12, 6, 'walnut', 291, false],
    olive_tree: [30, 11_000, 12, 6, 'olive', 304, true], maple_tree: [34, 11_000, 10, 6, 'maple_sap', 292, false],
    cocoa_tree: [36, 13_000, 16, 6, 'cocoa', 368, true], fig_tree: [39, 11_000, 9, 5, 'fig', 351, true] };
  assert.deepEqual(m2('trees').map((t) => t.id), Object.keys(trees));
  for (const [id, [L, cost, cycleH, y, product, sell, flowering]] of Object.entries(trees)) {
    const t = CONTENT.trees.get(id);
    assert.deepEqual([t.unlock, t.cost, t.cycleMs / 3_600_000, t.yield, t.product, CONTENT.items.get(product).sell,
      t.flowering], [L, cost, cycleH, y, product, sell, flowering], id);
  }
  const a = CONTENT.animals.get('alpaca');
  assert.deepEqual([a.unlock, a.baby, a.adult, a.babyMs / 3_600_000, a.feed, a.feedQty, a.cycleMs / 3_600_000,
    a.product, CONTENT.items.get(a.product).sell, a.premium, CONTENT.items.get(a.premium).sell, a.prizedAt, a.homes],
  [33, 3100, 5000, 6, 'livestock_feed', 2, 5, 'alpaca_fiber', 318, 'royal_fiber', 1272, 25, ['paddock']]);
  const p = CONTENT.homes.get('paddock');
  assert.deepEqual([p.unlock, p.size, p.cost, p.capacity, p.capacityMax, p.upgradeCost], [33, [4, 4], 88_000, 4, 8,
    50_000]);
  assert.deepEqual([...BREEDING.species].sort(), ['alpaca', 'chicken', 'cow', 'duck', 'goat', 'horse', 'pig',
    'sheep']);
});

test('the Oil Press, Sugar Shack and Chocolatier and the 29 M2 recipes are GDD §3.5 (hampers included)', () => {
  const buildings = { oil_press: [30, 180_000, [2, 5], [55_000, 88_000, 140_000]],
    sugar_shack: [34, 210_000, [2, 4], [65_000, 100_000]],
    chocolatier: [36, 250_000, [2, 5], [70_000, 110_000, 180_000]] };
  assert.deepEqual(m2('buildings').map((b) => b.id), Object.keys(buildings));
  for (const [id, [L, cost, slots, slotCosts]] of Object.entries(buildings)) {
    const b = CONTENT.buildings.get(id);
    assert.deepEqual([b.unlock, b.cost, b.slots, b.slotCosts, b.size], [L, cost, slots, slotCosts, [3, 3]], id);
  }
  assert.equal(CONTENT.buildings.get('feed_mill').secondCopy.at, 31, 'GDD §3.5 rule 7: a second Feed Mill at L31');
  assert.equal(CONTENT.buildings.get('pie_oven').secondCopy.at, 33, 'a second Pie Oven at L33');
  // [level, building, minutes, inputs, tier] from the GDD's recipe tables
  const R = {
    walnut_cookies: [26, 'bakery', 45, 'butter 1, flour 1, walnut 1'],
    olive_bread: [30, 'bakery', 30, 'flour 1, olive 2'],
    maple_pancakes: [34, 'bakery', 30, 'egg 2, flour 1, maple_syrup 1'],
    watermelon_salad: [27, 'kitchen', 45, 'goat_cheese 1, watermelon 2'],
    potato_chips: [30, 'kitchen', 45, 'potato 2, sunflower_oil 1'],
    stuffed_peppers: [31, 'kitchen', 60, 'cheese 1, pepper 2, tomato 1'],
    maple_fudge: [34, 'kitchen', 60, 'butter 1, maple_syrup 1, walnut 1'],
    rice_pudding: [35, 'kitchen', 45, 'milk 1, rice 2, sugar 1'],
    risotto: [35, 'kitchen', 90, 'butter 1, rice 2, truffle 1', 'T4'],
    hot_cocoa: [36, 'kitchen', 30, 'chocolate 1, milk 1'],
    pickled_peppers: [31, 'preserves', 120, 'onion 1, pepper 3'],
    fig_jam: [39, 'preserves', 60, 'fig 3, sugar 1'],
    alpaca_yarn: [33, 'weaver', 40, 'alpaca_fiber 1', 'T2'],
    alpaca_plush: [33, 'sewing', 90, 'alpaca_fiber 2, cotton_cloth 1'],
    alpaca_shawl: [33, 'sewing', 180, 'alpaca_yarn 2, lavender_dye 1', 'T4'],
    walnut_honey_cake: [26, 'pie_oven', 240, 'egg 1, flour 1, honey 1, walnut 2'],
    chocolate_cake: [36, 'pie_oven', 180, 'butter 1, chocolate 1, egg 2, flour 1'],
    fig_tart: [39, 'pie_oven', 150, 'fig 3, flour 1, goat_cheese 1'],
    watermelon_juice: [27, 'juice_press', 30, 'watermelon 2'],
    spa_basket: [26, 'packing', 180, 'cotton_tote 1, lavender_candle 1, lavender_soap 1, wooden_crate 1', 'T4'],
    cozy_winter_gift: [28, 'packing', 180, 'cookies 2, honey_candle 1, sweater 1, wooden_crate 1', 'T4'],
    harvest_hamper: [32, 'packing', 270,
      'lavender_candle 1, pumpkin_pie 1, truffle_oil 1, walnut_honey_cake 1, wooden_crate 1', 'T4'],
    gourmet_hamper: [37, 'packing', 240,
      'chocolate_cake 1, goat_cheese 1, maple_fudge 1, olive_bread 1, wooden_crate 1', 'T4'],
    sunflower_oil: [30, 'oil_press', 60, 'sunflower 3', 'T2'],
    olive_oil: [30, 'oil_press', 90, 'olive 4', 'T2'],
    truffle_oil: [32, 'oil_press', 180, 'olive_oil 1, truffle 1', 'T4'],
    maple_syrup: [34, 'sugar_shack', 60, 'maple_sap 2', 'T2'],
    chocolate: [36, 'chocolatier', 60, 'cocoa 2, milk 1, sugar 1', 'T2'],
    chocolate_truffles: [37, 'chocolatier', 45, 'chocolate 1, cream 1'],
  };
  assert.deepEqual(m2('recipes').map((r) => r.id).sort(), Object.keys(R).sort());
  for (const [id, [L, b, minutes, inputs, tier = 'T3']] of Object.entries(R)) {
    const r = CONTENT.recipes.get(id);
    assert.deepEqual([r.unlock, r.building, r.ms / 60_000, sortedText(r.inputs), r.tier, r.out], [L, b, minutes,
      inputs, tier, 1], id);
  }
  // every M2 good has a use or an order: no M2 raw good is a dead end (R4 for the new crops, fruit and fibre)
  for (const id of ['watermelon', 'pepper', 'rice', 'walnut', 'olive', 'maple_sap', 'cocoa', 'fig', 'alpaca_fiber']) {
    const uses = [...CONTENT.recipes.values()].filter((r) => Object.hasOwn(r.inputs, id));
    assert.ok(uses.length >= 1, `${id} feeds a recipe`);
  }
});

test('expansions 11-15, Barn upgrades 8-10 and Gold mastery are GDD §3.9 / §3.6 / §4.8', () => {
  const E = { stable_paddock: [11, 27, 560_000, 11, 2, 'make picnic_basket 2'],
    walnut_grove: [12, 30, 660_000, 12, 2, 'harvest walnut 30'], olive_terrace: [13, 33, 800_000, 13, 2,
      'make olive_oil 4'], maple_ridge: [14, 36, 950_000, 14, 2, 'make maple_syrup 3'],
    sunset_hill: [15, 39, 1_200_000, 15, 3, 'make gourmet_hamper 2'] };
  assert.deepEqual(m2('expansions').map((e) => e.id), Object.keys(E));
  for (const [id, [k, L, cost, planks, crates, proof]] of Object.entries(E)) {
    const e = CONTENT.expansions.get(id);
    assert.deepEqual([e.k, e.unlock, e.cost, e.planks, e.crates, e.proof.map((t) => `${t.verb} ${t.ref} ${t.qty}`)
      .join('; ')], [k, L, cost, planks, crates, proof], id);
  }
  assert.deepEqual(CONTENT.expansions.get('walnut_grove').free.map((f) => [f.def, f.mature]),
    [['walnut_tree', true], ['walnut_tree', true]]);
  assert.equal(CONTENT.expansions.get('sunset_hill').feature.goldenHourBonusMs, 600_000, 'Golden Hour +10 min');
  assert.deepEqual(CONTENT.barn.filter((b) => b.m === 'M2').map((b) => [b.n, b.unlock, b.capacity, b.cost, b.planks,
    b.crates]), [[8, 27, 1160, 160_000, 9, 2], [9, 30, 1280, 200_000, 10, 2], [10, 33, 1400, 260_000, 11, 2]]);
  assert.deepEqual([MASTERY.goldFrom, MASTERY.goldM, MASTERY.rewards[3].acorns], [30, 'M2', 3]);
  const wheat = cropOf('wheat');
  assert.equal(masteryStars(wheat, wheat.mastery[3], 29), 3, 'no Gold before L30');
  assert.equal(masteryStars(wheat, wheat.mastery[3], 30), upTo('M2', MILESTONE) ? 4 : 3, 'Gold from L30 in M2');
  assert.equal(decorOf('mastery_sign_gold').m, 'M2');
});

test('Grand decor and the M2 coin and Acorn decor are GDD §3.8 (Golden Hour seats where the GDD says)', () => {
  const G = { grand_windmill: [20, 60_000, 80, [3, 3]], flower_maze: [23, 120_000, 100, [4, 4]],
    koi_pond: [26, 180_000, 120, [3, 3], 2], carousel: [29, 290_000, 150, [4, 4]],
    treehouse: [31, 410_000, 170, [3, 3], 2], clock_tower: [33, 550_000, 190, [2, 2]],
    orangery: [35, 700_000, 210, [4, 3]], arbor_of_lights: [37, 870_000, 230, [3, 2], 2],
    bath_house: [39, 1_100_000, 250, [4, 4], 2], golden_gate: [40, 1_300_000, 300, [3, 1]] };
  const grand = [...CONTENT.decor.values()].filter((d) => d.tier === 'grand');
  assert.deepEqual(grand.map((d) => d.id), Object.keys(G));
  for (const [id, [L, cost, beauty, size, seats]] of Object.entries(G)) {
    const d = decorOf(id);
    assert.deepEqual([d.unlock, d.cost, d.beauty10 / 10, d.size, d.effect.seats, d.m, d.shop], [L, cost, beauty, size,
      seats, 'M2', true], id);
  }
  for (const [id, L, cost, beauty] of [['gazebo', 26, 4800, 60], ['pond_dock', 28, 2500, 30],
    ['statue_cow', 32, 4500, 50], ['hot_air_balloon', 38, 8900, 90]]) {
    assert.deepEqual([decorOf(id).unlock, decorOf(id).cost, decorOf(id).beauty10 / 10], [L, cost, beauty], id);
  }
  assert.deepEqual([decorOf('golden_cow_statue').acorns, decorOf('golden_cow_statue').unlock], [60, 30]);
  // GDD §3.8 v2 H4: Grand decor is priced at 0.5-4 hours of income at its level
  for (const d of grand) {
    const hrs = d.cost / levelRow(d.unlock).E;
    assert.ok(hrs >= 0.45 && hrs <= 4.1, `${d.id}: ${hrs.toFixed(2)} E-hours`);
  }
  const carousel = CONTENT.decorSets.get('carousel_set');
  assert.deepEqual([carousel.unlock, carousel.m, carousel.pieces], [29, 'M2', ['carousel', 'gazebo', 'statue_cow',
    'golden_cow_statue']]);
});

test('Restoration 4-6 are GDD §5.9 to the item, with their rewards', () => {
  const want = {
    orchard_pond: { n: 4, unlock: 25, bundles: [
      ['fruit', 4, 'apple 10, cherry 10, peach 10, pear 10, plum 10, lemon 10'],
      ['pond', 3, 'duck_egg 10, custard 2, lemon_meringue_pie 2, golden_feather 1'],
      ['press', 3, 'apple_juice 4, orange_juice 4, lemonade 4, pear_nectar 3'],
      ['candles', 2, 'honey_candle 3, lavender_candle 3, lavender_soap 2']] },
    fair_grounds: { n: 5, unlock: 28, bundles: [
      ['pies', 4, 'apple_pie 2, cherry_pie 2, pumpkin_pie 2, blueberry_pie 2, peach_cobbler 2, plum_cake 2'],
      ['textiles', 3, 'sweater 2, picnic_blanket 2, quilt 1, wool_pillow 2'],
      ['hampers', 2, 'breakfast_hamper 1, picnic_basket 1, spa_basket 1'],
      ['livestock', 3, 'golden_egg 1, cream_top_milk 1, silk_wool 1, black_truffle 1']] },
    farmhouse: { n: 6, unlock: 34, bundles: [
      ['comfort', 3, 'quilt 2, alpaca_shawl 2, honey_candle 3, wool_pillow 2'],
      ['larder', 4, 'truffle_oil 2, maple_syrup 2, olive_oil 2, plum_jam 3, pickled_peppers 2, goat_cheese 2'],
      ['sweets', 3, 'maple_fudge 2, wedding_cake 2, cookies 3, walnut_honey_cake 2'],
      ['woodwork', 3, 'planks 30, wooden_crate 8, toy_horse 2']] },
  };
  for (const [id, p] of Object.entries(want)) {
    const r = CONTENT.restoration.get(id);
    assert.deepEqual([r.m, r.n, r.unlock], ['M2', p.n, p.unlock], id);
    assert.deepEqual(r.bundles.map((b) => [b.id, b.need, b.slots.map((s) => `${s.item} ${s.qty}`).join(', ')]),
      p.bundles, id);
  }
  assert.equal(CONTENT.restoration.get('orchard_pond').reward.treeCycleBp, 1000, 'irrigation: trees -10 % cycle');
  assert.deepEqual({ ...CONTENT.restoration.get('fair_grounds').reward }, { fairPlatinum: true, topLeague: true,
    fairEntriesPerItem: 1 });
  const fh = CONTENT.restoration.get('farmhouse').reward;
  assert.deepEqual([fh.interior, fh.kitchenSlots, fh.beat], [true, 1, 'grandma_visits']);
  assert.equal(INTERIOR.needsProject, 'farmhouse');
  assert.equal(FAIR.medals.at(-1).needsProject, 'fair_grounds');
  assert.equal(FAIR.league.topNeedsProject, 'fair_grounds');
});

test('Town Projects 5-24 and the Festival Pavilion (GDD §5.9: one at a time, the same formula after the 24th)', () => {
  const tps = m2('townProjects');
  assert.equal(tps.length, 20);
  assert.deepEqual(tps.map((p) => p.n), Array.from({ length: 20 }, (_, i) => i + 5));
  assert.equal(new Set([...CONTENT.townProjects.values()].map((p) => p.name)).size, 24, 'every landmark distinct');
  for (const p of tps) {
    assert.ok(p.text.length > 20 && p.text.endsWith('.'), `${p.id} says what it brings`);
    assert.equal(decorOf(p.souvenir)?.m, 'M2', `${p.id} souvenir`);
  }
  assert.equal(TOWN_PROJECT_RULES.repeatable, 'festival_pavilion');
  assert.equal(FESTIVAL_PAVILION.after, 24);
  assert.ok(FESTIVAL_PAVILION.tiers.length >= 6 && FESTIVAL_PAVILION.tiers.every((t) => t.name && t.text));
  assert.equal(decorOf(FESTIVAL_PAVILION.souvenir).m, 'M2');
  // the coin side keeps growing by half an hour per project: the 25th project (Pavilion tier 1) is E x 22 h
  const hoursBp = (n) => TOWN_PROJECT_RULES.coinsHoursBaseBp + TOWN_PROJECT_RULES.coinsHoursStepBp * (n - 1);
  assert.equal(hoursBp(25), 22 * H);
});

test('the County Fair league, Platinum and the horse show are GDD §5.6', () => {
  const L = FAIR.league;
  assert.deepEqual([L.unlock, L.m, L.leagues, L.npcMinBp, L.npcSpreadBp, L.promote, L.demote, L.acornsPerTier,
    L.start], [27, 'M2', 5, 6000, 7000, 2, 1, 1, 1]);
  assert.deepEqual(L.farms, ['Brambleton', 'Oakhurst', 'Mill Creek', 'Cobble Hill', 'Fennimore']);
  assert.deepEqual(L.npcs.map((n) => n.name), L.farms);
  assert.equal(L.names.length, 5);
  const plat = FAIR.medals.at(-1);
  assert.deepEqual([plat.id, plat.atBp, plat.acorns, plat.goldenHourMs, plat.m], ['platinum', 14_000, 6, 86_400_000,
    'M2']);
  assert.deepEqual([FAIR.points.horseShowMul, FAIR.points.horseShowFrom, FAIR.points.hamperMul,
    FAIR.points.hamperFrom], [2, 25, 2, 32]);
  assert.deepEqual([FAIR.horseShow.unlock, FAIR.horseShow.item, FAIR.horseShow.ring], [25, 'show_ribbon',
    'stable_paddock']);
});

test('breeding coats, the Nursery, perks and rested XP are GDD §3.4 / §4.7', () => {
  assert.deepEqual(BREEDING.coats.map((c) => [c.id, c.bp]), [['white', 4000], ['brown', 3000], ['spotted', 2500],
    ['golden', 500]]);
  assert.equal(BREEDING.coats.reduce((s, c) => s + c.bp, 0), H);
  assert.deepEqual([BREEDING.unlock, BREEDING.timeMul, BREEDING.goldenPity, BREEDING.cost.bottles,
    BREEDING.cost.poultryFeed], [28, 2, 20, 2, 2]);
  assert.deepEqual(BREEDING.seasonCoats.map((c) => c.season), ['spring', 'summer', 'autumn', 'winter']);
  assert.deepEqual([NURSERY.unlock, NURSERY.steps, NURSERY.stepGapMs, NURSERY.personalities],
    [19, ['feed', 'play', 'groom'], 600_000, ['sleepy', 'playful', 'grumpy']]);
  assert.deepEqual(NURSERY.specialties.map((s) => s.id), ['bountiful', 'tidy']);
  assert.deepEqual([PERKS.pointsEvery, PERKS.maxPoints, PERKS.costs, PERKS.respecMs], [2, 20, [1, 1, 2, 2, 3],
    604_800_000]);
  assert.equal(PERKS.costs.reduce((a, b) => a + b, 0), 9, '9 points per tree: two whole trees with 20 points');
  assert.deepEqual(PERKS.trees.grower, [{ cropXpBp: 500 }, { seedBp: 1000 }, { bonusUnitBp: 500 }, { waterBp: 500 },
    { ribbonBp: 300 }]);
  assert.deepEqual(PERKS.trees.rancher, [{ animalXpBp: 500 }, { babyBp: 1500 }, { doubleBp: 500 },
    { freeFeedBp: 1000 }, { prizedSoonerBp: 2000 }]);
  assert.deepEqual(PERKS.trees.orchardist, [{ treeXpBp: 500 }, { treeWaterBp: 500 }, { bonusFruitBp: 1000 },
    { treeCostBp: 1000 }, { heirloomAt: 45 }]);
  assert.deepEqual(PERKS.trees.artisan, [{ craftXpBp: 500 }, { queueTimeBp: 500 }, { doubleBp: 500 },
    { craftSellBp: 500 }, { duetSecondBp: 1000 }]);
  // §4.7: 5 % of a personal level's requirement per 8 h away, capped at 150 %, doubles personal XP until used
  assert.deepEqual([RESTED.bp, RESTED.perMs, RESTED.capBp, RESTED.bonusMul], [500, 8 * 3_600_000, 15_000, 2]);
  assert.equal(COOP.partnerBottle.bp, 2000, '§6.2 #12: the partner bottle cuts 20 % more');
});

test('the Seasonal Ribbon Track, Legacy levels and the last four collection sets (GDD §5.9, §5.5)', () => {
  const T = SEASONAL_TRACK;
  assert.deepEqual([T.unlock, T.tiers, T.tierHours, T.acornTiers, T.acorns, T.leftoverCoinsHoursBp],
    [24, 30, 1, [10, 20, 30], 5, 500]);
  assert.equal(T.rewards.length, 30);
  assert.equal(T.rewards.filter((r) => r.coat === 'season').length, 1, 'one season-exclusive coat');
  assert.ok(T.rewards.some((r) => r.goldenSeeds) && T.rewards.some((r) => r.decor), 'decor and Golden Seeds');
  for (const id of Object.values(DAILY_GIFT.seasonDecor)) assert.ok(decorOf(id), 'the season\'s planter exists');
  // the track's coins are a small share of a season: at most 2 E-hours over 30 tiers
  assert.ok(T.rewards.reduce((s, r) => s + (r.coinsHoursBp ?? 0), 0) <= 2 * H);
  assert.equal(LEGACY.from, 41);
  assert.equal(LEGACY.pool.length, 5);
  assert.ok(decorOf('legacy_statue'));
  const step = xpForLevel(40) - xpForLevel(39);
  assert.equal(step, 480_000, 'Legacy: the L39 -> 40 requirement, flat (final pass: was 660k)');
  assert.equal(levelFromXp(xpForLevel(40) + 3 * step), 43);
  const sets = { pond_treasures: ['sea_glass snail_shell old_bottle frog_figurine silver_spoon', 'collect:duck fish'],
    fair_rosettes: ['yellow_rosette red_rosette blue_rosette purple_rosette rainbow_rosette', 'enter:fair'],
    old_coins: ['copper_penny silver_sixpence old_florin gold_sovereign lucky_coin', 'sell'],
    love_notes: ['first_note pressed_flower ticket_stub polaroid ribbon_letter', 'coop'] };
  assert.deepEqual(m2('collections').map((c) => c.id).sort(), Object.keys(sets).sort());
  for (const [id, [items, from]] of Object.entries(sets)) {
    const c = CONTENT.collections.get(id);
    assert.deepEqual([c.items.map((x) => x.id).join(' '), c.from.join(' ')], [items, from], id);
    assert.equal(decorOf(c.display).m, 'M2');
  }
  assert.equal(CONTENT.collections.size, 12, 'GDD §5.5: 12 sets x 5 items');
  assert.equal(COLLECTION_RULES.dropBp, 200);
});

test('the Fishing Dock and the Friendly Duel never pay an economy item (GDD §6.2 #21, §6.3)', () => {
  assert.equal(FISHING.unlock, CONTENT.expansions.get('willow_pond').unlock, 'from Willow Pond\'s dock (L21)');
  assert.equal(decorOf(FISHING.spots.decor).unlock, 28, 'or the Fishing Dock decor (L28)');
  assert.equal(FISHING.cooldownMs, 3_600_000, 'once per hour per player');
  assert.equal(FISHING.castMs, 20_000, 'a calm 20-s timing cast');
  assert.equal(FISHING.fish.reduce((s, f) => s + f.weightBp, 0), H);
  for (const f of FISHING.fish) assert.equal(CONTENT.items.has(f.id), false, `${f.id} is no item`);
  assert.ok(CONTENT.collections.get(FISHING.collectionSet).from.includes('fish'));
  assert.equal(DUEL.kinds.length, 3);
  assert.deepEqual(DUEL.kinds.map((k) => k.credit), ['planter', 'queuer', 'filler'],
    'credit goes where taking the partner\'s work never helps');
  assert.equal(DUEL.crown.ms, 7 * 86_400_000);
  assert.ok(decorOf(DUEL.rewards.firstDecor));
  assert.ok(Object.keys(DUEL.rewards).every((k) => ['hearts', 'firstDecor'].includes(k)), 'no coins, goods or XP');
});

test('the farmhouse interior: a room that fits its fixed pieces, a catalog that is a sink and never a source', () => {
  const shop = [...CONTENT.furniture.values()].filter((f) => f.shop);
  assert.ok(shop.length >= 30, 'a catalog worth browsing');
  const E34 = levelRow(34).E;
  for (const f of shop) {
    const hrs = f.cost / E34;
    assert.ok(hrs >= 0.005 && hrs <= 0.2, `${f.id}: ${hrs.toFixed(3)} E(34)-hours`);
    const digits = String(f.cost).replace(/0+$/, '');
    assert.ok(digits.length <= 2, `${f.id}: ${f.cost} has two significant digits`);
    assert.equal(f.model, `furniture/${f.id}`);
  }
  const total = shop.reduce((s, f) => s + f.cost * f.max, 0) / E34;
  assert.ok(total >= 1 && total <= 3, `the whole catalog is ${total.toFixed(2)} E(34)-hours`);
  for (const f of CONTENT.furniture.values()) {
    for (const k of ['xp', 'beauty10', 'sell', 'effect']) assert.equal(f[k], undefined, `${f.id}.${k}: no economy`);
  }
  assert.ok(CONTENT.furniture.get(GRANDMA_VISIT.gift.furniture).shop === false);
  assert.deepEqual(questOf('h7').rewards.furniture, ['memory_frame']);
  assert.equal(furnitureOf('memory_frame').shop, false);
  // every fixed piece is placed once, and the GDD's three inside features are there
  for (const id of ['memory_wall', 'ribbon_wall', 'keepsake_shelf', 'duet_table']) {
    assert.ok(INTERIOR.fixed.some((x) => x.def === id), id);
  }
  assert.ok(isLive(CONTENT.furniture.get('sofa')) === upTo('M2', MILESTONE));
});

test('Grandma\'s visit: E10 completes the story with a stay, a line at every stop and a farewell gift', () => {
  assert.equal(GRANDMA_VISIT.quest, 'e10');
  assert.equal(questOf('e10').rewards.beat, GRANDMA_VISIT.beat);
  assert.ok(STORY_BEATS.some((b) => b.id === GRANDMA_VISIT.beat && b.m === 'M2'));
  for (const k of ['arrive', ...GRANDMA_VISIT.stops, 'leave']) {
    assert.ok(GRANDMA_VISIT.lines[k].length >= 2, `${k}: at least two lines`);
  }
  assert.ok(GRANDMA_VISIT.stayMs >= 24 * 3_600_000, 'she stays long enough for both farmers to meet her');
  assert.equal(GRANDMA_VISIT.letter.body.length, 2);
});

test('quests L26-40 are GDD §5.3 (chains B-H), each with a full letter, and every M2 story beat exists', () => {
  const Q = {
    b6: [27, 'make 2 watermelon_juice; make 1 watermelon_salad', 300_000, 38_000],
    b7: [31, 'make 2 pickled_peppers; make 1 stuffed_peppers', 350_000, 44_000],
    b8: [35, 'make 2 rice_pudding; make 1 risotto', 540_000, 68_000],
    b9: [37, 'make 1 gourmet_hamper; deliver 1 gourmet_hamper', 730_000, 91_000],
    c8: [28, 'breed 1 cow', 300_000, 38_000],
    c9: [33, 'build 1 paddock; buy 2 alpaca; make 1 alpaca_yarn', 500_000, 63_000],
    d6: [30, 'build 1 oil_press; make 2 olive_oil', 330_000, 41_000],
    d7: [34, 'plant 1 maple_tree; build 1 sugar_shack; make 2 maple_syrup', 520_000, 65_000],
    d8: [36, 'plant 1 cocoa_tree; build 1 chocolatier; make 1 chocolate_cake', 700_000, 88_000],
    d9: [39, 'plant 1 fig_tree; make 1 fig_tart', 800_000, 100_000],
    e8: [28, 'complete 3 town_project', 500_000, 63_000],
    e9: [34, 'complete 2 bundle', 650_000, 81_000],
    e10: [38, 'complete 1 project', 870_000, 110_000],
    g4: [27, 'reach 2 league', 300_000, 38_000],
    g5: [32, 'enter 2 hamper', 350_000, 44_000],
    h6: [30, 'together 1 dock', 220_000, 28_000],
    h7: [39, 'together 1 bench', 320_000, 40_000],
  };
  assert.deepEqual(m2('quests').map((q) => q.id).sort(), Object.keys(Q).sort());
  assert.equal(CONTENT.quests.size, 64, 'GDD §5.3: 64 quests in 8 chains');
  for (const [id, [L, tasks, coins, xp]] of Object.entries(Q)) {
    const q = questOf(id);
    assert.deepEqual([q.level, q.tasks.map((t) => `${t.verb} ${t.qty} ${t.ref}`).join('; '), q.coins, q.xp],
      [L, tasks, coins, xp], id);
    // a letter in the character's voice: a greeting, two paragraphs, a sign-off and a closing line (like M1b's)
    assert.equal(q.letter.body.length, 2, `${id}: two paragraphs`);
    assert.ok(q.letter.body.every((p) => p.length >= 80), `${id}: real paragraphs`);
    assert.ok(q.done.length >= 25, `${id}: a closing line`);
  }
  const R = (id) => questOf(id).rewards;
  assert.deepEqual(R('b6').decor, ['melon_awning']);
  assert.deepEqual([R('b9').decor, R('b9').acorns], [['gold_scale'], 3]);
  assert.equal(R('c8').name, 'cow');
  assert.deepEqual([R('d6').decor, R('d6').beat], [['olive_jar'], 'liquid_gold']);
  assert.deepEqual(R('d9').decor, ['fig_crate']);
  assert.equal(R('e8').acorns, 3);
  assert.deepEqual([R('e10').acorns, R('e10').beat], [5, 'grandma_visits']);
  assert.deepEqual(R('g5').decor, ['hamper_rosette']);
  assert.equal(R('h6').hearts, 2);
  assert.deepEqual([R('h7').hearts, R('h7').memory], [3, true]);
  for (const q of CONTENT.quests.values()) assert.ok(q.level <= LAST_LEVEL.M2, `${q.id} at or below L40`);
});

test('ribbons: all 63 GDD ribbons and the 7 hidden ones exist; the M2 ones have their GDD tiers', () => {
  const all = [...CONTENT.ribbons.values()];
  assert.deepEqual(all.filter((r) => !r.hidden).map((r) => r.n).sort((a, b) => a - b),
    Array.from({ length: 63 }, (_, i) => i + 1));
  assert.equal(all.filter((r) => r.hidden).length, 7);
  const T = { showcase: [500, 2000, 6000], golden_touch: [1, 5, 15], league_climber: [2, 4, 5],
    season_ticket: [30, 90, 240], equal_partners: [2, 10, 30] };
  assert.deepEqual(m2('ribbons').map((r) => r.id).sort(), Object.keys(T).sort());
  for (const [id, tiers] of Object.entries(T)) assert.deepEqual(CONTENT.ribbons.get(id).tiers, tiers, id);
  // only the festivals' ribbons wait for M3
  assert.deepEqual(all.filter((r) => r.m === 'M3').map((r) => r.id).sort(), ['festive', 'pumpkin_royalty']);
});

test('every M2 system has a drip-feed card, a first-use tip where it has a panel, and every L26-40 level unlocks', () => {
  for (const f of m2('features')) {
    assert.ok(f.card && f.card.title && f.card.text.length >= 40, `${f.id} has a card`);
    assert.ok(f.card.text.length <= 160, `${f.id}: a card is short (${f.card.text.length})`);
    assert.ok(f.unlock <= LAST_LEVEL.M2, f.id);
  }
  for (const id of ['grand_sickle', 'perks_panel', 'nursery_panel', 'breeding_panel', 'fishing', 'league_panel',
    'track_panel', 'duel_panel', 'interior']) {
    assert.ok(TUTORIAL.firstUse.some((t) => t.id === id && t.m === 'M2'), `first-use tip ${id}`);
  }
  // R8: every level of L26-40 unlocks something in an M2 build (content tables, M2 included)
  const fams = ['crops', 'trees', 'animals', 'homes', 'buildings', 'recipes', 'decor', 'tools', 'expansions',
    'features'];
  for (let L = 26; L <= 40; L++) {
    const n = fams.reduce((s, fam) => s + [...CONTENT[fam].values()].filter((d) => upTo(d.m, 'M2')
      && d.unlock === L && d.shop !== false).length, 0);
    assert.ok(n >= 1, `L${L} unlocks something`);
    if (MILESTONE === 'M2') assert.ok(unlocksAt(L).length >= 1, `L${L} banner`);
  }
  // the M2 order slots and gourmet orders of GDD §5.2
  assert.deepEqual(ORDERS.slots.slice(-2), [[28, 8], [35, 9]]);
  assert.deepEqual([ORDERS.gourmet.from, ORDERS.gourmet.payBp], [37, 17_000]);
  assert.equal(featureOf('legacy').unlock, 40);
});

test('the validator catches broken M2 data (furniture, track rewards, the fishing table)', () => {
  const cases = [
    [(t) => { t.furniture.find((f) => f.id === 'sofa').size = [20, 1]; }, 'larger than the room'],
    [(t) => { t.furniture.find((f) => f.id === 'sofa').cost = 0; }, 'a shop piece costs coins'],
    [(t) => { t.furniture.push({ ...t.furniture.find((f) => f.id === 'sofa'), id: 'coop' }); }, 'also a placeable'],
    [(t) => { t.furniture.find((f) => f.id === 'fireplace').fixed = false; }, 'no fixed furniture'],
    [(t) => { t.rules.SEASONAL_TRACK.rewards[3] = { outfit: true }; }, 'unknown reward key outfit'],
    [(t) => { t.rules.SEASONAL_TRACK.rewards.pop(); }, 'one reward per tier'],
    [(t) => { t.rules.LEGACY.pool[4] = { decor: 'no_such_statue' }; }, 'decor no_such_statue'],
    [(t) => { t.rules.FISHING.fish[0].weightBp += 1; }, 'sum to 10000'],
    [(t) => { t.rules.DUEL.kinds[1].count = 'craft:no_oven'; }, 'count craft:no_oven'],
    [(t) => { t.rules.GRANDMA_VISIT.lines.orchard = []; }, 'lines.orchard'],
    [(t) => { t.quests.find((q) => q.id === 'h7').rewards.furniture = ['sofa']; }, 'reward furniture sofa'],
  ];
  for (const [mutate, expect] of cases) {
    const t = tablesClone();
    mutate(t);
    assert.ok(validateContent(t).some((e) => e.includes(expect)), `expected "${expect}"`);
  }
});

// Flip gate (as content.m1b's): M2 feature -> the rules actions it needs. The rule lanes of wave 3 named them in
// docs/agent-notes/w3-rules-economy.md and w3-rules-goals.md; passive systems (rested XP, Gold mastery, Legacy) need
// only the action that already carries them.
const SUPPORT = {
  perks: ['perkPick', 'perkRespec'],
  rested_xp: ['harvest'],
  nursery: ['nurse', 'nursePick'],
  grand_decor: ['place'],
  fishing: ['cast', 'reel'],
  seasonal_track: ['trackClaim', '_track'],
  horse_show: ['fairEnter'],
  restoration_4: ['donate'],
  fair_league: ['_fair'],
  breeding: ['breed', 'breedCollect'],
  restoration_5: ['donate'],
  friendly_duel: ['duelInvite', 'duelAccept'],
  carousel_set: ['_beauty'],
  gold_mastery: ['harvest'],
  second_feed_mill: ['place'],
  hamper_double: ['fairEnter'],
  second_pie_oven: ['place'],
  restoration_6: ['donate', 'furnish'],
  gourmet_orders: ['_orders'],
  showcase: ['_beauty'],
  sunset_gazebo: ['sit'],
  legacy: ['harvest'],
};

test('flip gate: every M2 system has an entry here, and once M2 is live the rules register its actions', async () => {
  for (const f of m2('features')) assert.ok(Object.hasOwn(SUPPORT, f.id), `M2 feature ${f.id} needs a SUPPORT entry`);
  if (!upTo('M2', MILESTONE)) {
    // nothing of M2 is reachable before the flip (every action argument goes through lookup())
    for (const f of m2('features')) assert.equal(isLive(f), false, f.id);
    assert.equal(live('furniture').length, 0);
    return;
  }
  const { ACTIONS } = await import('../shared/rules/index.js');
  for (const f of live('features').filter((x) => x.m === 'M2')) {
    for (const type of SUPPORT[f.id]) assert.ok(Object.hasOwn(ACTIONS, type), `${f.id} needs the rules action ${type}`);
  }
});

test('the M2 coin sinks hold through L40: land, buildings, Grand decor, projects and the room are hours of income', () => {
  // GDD §5.9 / Appendix E: the late game's coin sinks (Town Projects ~10-17 E-hours each, expansions 2.6-3.6 E-hours,
  // the three buildings ~1 E-hour, Grand decor 0.5-4, the furniture catalog ~1.4 at L34) — sized against E(L)
  const ex = m2('expansions').map((e) => e.cost / levelRow(e.unlock).E);
  for (const h of ex) assert.ok(h >= 2 && h <= 4, `expansion ${h.toFixed(2)} E-hours`);
  for (const b of m2('buildings')) {
    const h = b.cost / levelRow(b.unlock).E;
    assert.ok(h >= 0.6 && h <= 1.2, `${b.id}: ${h.toFixed(2)} E-hours`);
  }
  // a Town Project at L30 costs E(30) x (10 + 0.5 (n - 1)) h of coins: the 13th about 16 hours of play
  assert.equal(eHours(30, TOWN_PROJECT_RULES.coinsHoursBaseBp + 12 * TOWN_PROJECT_RULES.coinsHoursStepBp),
    eHours(30, 16 * H));
});
