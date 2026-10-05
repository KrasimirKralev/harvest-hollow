// Content registry: validation, own-key and live-only lookups, the hash, level math and the helper lookups
// (tech §8.1, wave-1 content brief).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, CONTENT_HASH, PLACEABLES, MILESTONE, MILESTONES, validateContent, lookup, isLive, live, liveAt,
  levelFromXp, levelRow, xpForLevel, cropOf, itemOf, defOf, recipesOf, classMembers, usesOf, unlocksAt, plotCapOf,
  plotPrice, eHours, masteryStars, personalLevelFromXp, titleFor, orderSlotsAt, barnCapacity, treeCapAt, homeCountAt,
  expansionObjects, contentKinds, treeOf, homeOf, buildingOf, ORDERS,
} from '../shared/content/index.js';
import { tablesClone } from './helpers/content.js';

test('shipped content is valid, frozen and hashed', () => {
  assert.deepEqual(validateContent(), []);
  assert.ok(['M1a', 'M1b', 'M2'].includes(MILESTONE), MILESTONE);
  assert.deepEqual([...MILESTONES], ['M1a', 'M1b', 'M2', 'M3']);
  assert.ok(Object.isFrozen(cropOf('wheat')));
  assert.ok(Object.isFrozen(cropOf('wheat').stages));
  assert.ok(Object.isFrozen(CONTENT.levels) && Object.isFrozen(CONTENT.levels[0]));
  assert.ok(Object.isFrozen(ORDERS.slots));
  assert.match(CONTENT_HASH, /^[0-9a-f]{8}$/);
  for (const fam of contentKinds().filter((k) => k !== 'placeables')) {
    assert.throws(() => CONTENT[fam].set('x', {}), /read-only/, fam);
    assert.throws(() => CONTENT[fam].clear(), /read-only/, fam);
  }
});

test('every family of the whole game exists as data, every def carries a milestone', () => {
  // + the owners' wave-4 additions (2026-10-04): 3 crops, the Pomegranate Tree, Rabbit Greens, the Rabbit and its Hutch,
  // 12 recipes (the Fertilizer and the new goods' uses)
  // + wave 4b: the Rainbow Tree (an Acorn shop relic)
  const sizes = { crops: 21, trees: 15, feeds: 4, animals: 10, homes: 10, buildings: 17, recipes: 117, expansions: 16 };
  for (const [fam, n] of Object.entries(sizes)) assert.equal(CONTENT[fam].size, n, fam);
  assert.equal(CONTENT.levels.length, 40);
  assert.equal(CONTENT.barn.length, 10);
  assert.equal(CONTENT.quests.size, 64);
  assert.equal(CONTENT.ribbons.size, 70);
  for (const fam of contentKinds().filter((k) => k !== 'placeables')) {
    for (const d of CONTENT[fam].values()) assert.ok(MILESTONES.includes(d.m), `${fam}.${d.id}.m`);
  }
});

test('lookups are own-key only; lookup() answers live content only', () => {
  for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(lookup('crops', id), undefined);
    assert.equal(cropOf(id), undefined);
    assert.equal(itemOf(id), undefined);
    assert.equal(defOf(id), undefined);
  }
  assert.equal(lookup('nope', 'wheat'), undefined);
  assert.equal(lookup('placeables', 'plot'), PLACEABLES.get('plot'));
  // later content exists but no action argument may name it (the schema validator uses lookup): M2 before the M2
  // build, the festival crops of M3 after it
  const m2 = MILESTONE === 'M2';
  assert.ok(cropOf('watermelon'));
  assert.equal(lookup('crops', 'watermelon'), m2 ? cropOf('watermelon') : undefined);
  assert.equal(lookup('items', 'olive_oil') !== undefined, m2);
  assert.equal(lookup('placeables', 'oil_press') !== undefined, m2);
  assert.equal(lookup('recipes', 'olive_bread') !== undefined, m2);
  assert.equal(lookup('ribbons', 'festive'), undefined, 'M3 stays out of every build here');
  assert.equal(lookup('crops', 'cabbage'), cropOf('cabbage'));
  assert.ok(defOf('oil_press'), 'defOf resolves any milestone (state may hold it after an upgrade)');
});

test('isLive, live() and liveAt() follow the milestone', () => {
  assert.equal(isLive({ m: 'M1a' }), true);
  assert.equal(isLive({ m: MILESTONE }), true);
  assert.equal(isLive({ m: 'M2' }), MILESTONE === 'M2');
  assert.equal(isLive({ m: 'M3' }), false);
  assert.equal(isLive({ id: 'fixture' }), true, 'test fixtures without m are live');
  assert.equal(isLive(undefined), false);
  assert.ok(live('crops').some((c) => c.id === 'cabbage'));
  assert.equal(live('crops').some((c) => c.id === 'watermelon'), MILESTONE === 'M2');
  assert.equal(live('crops').some((c) => c.id === 'oats'), MILESTONE !== 'M1a');
  assert.deepEqual(liveAt('crops', 3).map((c) => c.id), ['wheat', 'carrot', 'corn']);
  assert.ok(Object.isFrozen(live('crops')));
  assert.deepEqual(live('nope'), []);
});

test('unlocksAt lists live content and systems, never later milestones', () => {
  const at2 = unlocksAt(2).map((u) => `${u.family}:${u.id}`);
  assert.ok(at2.includes('crops:carrot') && at2.includes('features:orders'));
  assert.equal(unlocksAt(26).length === 0, MILESTONE !== 'M2', 'L26 content is M2: nothing new before the M2 build');
  assert.equal(unlocksAt(26).some((u) => u.id === 'walnut_tree'), MILESTONE === 'M2');
  assert.equal(unlocksAt(13).some((u) => u.id === 'oats'), MILESTONE !== 'M1a', 'L13 content is M1b');
  const at12 = unlocksAt(12).map((u) => `${u.family}:${u.id}`);
  for (const want of ['crops:cabbage', 'animals:sheep', 'homes:pasture', 'buildings:weaver', 'barn:3',
    'tools:wide_sickle']) {
    assert.ok(at12.includes(want), want);
  }
  assert.ok(!unlocksAt(1).some((u) => u.family === 'decor' && u.id === 'jam_shelf'), 'reward decor is not an unlock');
});

test('recipesOf, classMembers and usesOf', () => {
  assert.deepEqual(recipesOf('mill').map((r) => r.id), MILESTONE === 'M1a' ? ['flour', 'cornmeal', 'sugar']
    : ['flour', 'cornmeal', 'sugar', 'oat_flakes']);
  assert.deepEqual(recipesOf('feed_mill').map((r) => r.id), MILESTONE === 'M1a' ? ['chicken_feed', 'livestock_feed']
    : ['chicken_feed', 'livestock_feed', 'rabbit_greens', 'pig_slop']);
  assert.equal(recipesOf('bakery').some((r) => r.id === 'walnut_cookies'), MILESTONE === 'M2',
    'M2 recipes are listed only in the M2 build');
  assert.equal(recipesOf('bakery').some((r) => r.id === 'granola_bar'), MILESTONE !== 'M1a');
  const grain = classMembers('grain');
  assert.deepEqual(grain, { M1a: ['wheat', 'corn', 'sunflower'], M1b: ['wheat', 'corn', 'oats', 'sunflower'],
    M2: ['wheat', 'corn', 'oats', 'rice', 'sunflower'] }[MILESTONE], 'live grains, cheapest first');
  assert.ok(classMembers('produce').includes('apple') && !classMembers('produce').includes('wood'));
  assert.ok(usesOf('wheat').includes('flour') && usesOf('wheat').includes('chicken_feed'));
  assert.ok(usesOf('chicken_feed').includes('chicken'));
  assert.deepEqual(usesOf('nope'), []);
});

test('validateContent catches broken tables', () => {
  const broken = [
    [(t) => { t.crops[0].growMs = 0; }, 'growMs'],
    [(t) => { t.crops.push({ ...t.crops[0] }); }, 'duplicate'],
    [(t) => { t.crops[0].stages = [0, 0.5, 0.4, 1]; }, 'stages'],
    [(t) => { t.levels[2].xp = t.levels[1].xp; }, 'xp'],
    [(t) => { t.crops[0].id = 'Bad Id'; }, 'bad id'],
    [(t) => { t.crops[0].sell = 1; t.crops[0].yield = 1; }, 'seed'],
    [(t) => { t.recipes.find((r) => r.id === 'bread').inputs = { flour: 1, honey: 1 }; }, 'needs honey'],
    [(t) => { t.recipes.find((r) => r.id === 'bread').inputs = { unobtainium: 1 }; }, 'unknown input'],
    [(t) => { t.recipes.find((r) => r.id === 'bread').sell = 40; }, 'R3'],
    [(t) => { t.items.find((i) => i.id === 'chicken_feed').sellable = true; }, 'R5'],
    [(t) => { t.crops.find((c) => c.id === 'oats').m = 'M1a'; }, 'oats'],
    [(t) => { t.quests.find((q) => q.id === 'a6').tasks[0].ref = 'cherry_tree'; }, 'cherry_tree'],
    [(t) => { t.quests.find((q) => q.id === 'a3').giver = 'nobody'; }, 'giver'],
    [(t) => { t.ribbons.find((r) => r.id === 'rainbow_harvest').tiers = [6, 12, t.crops.length + 1]; }, 'R11'],
    [(t) => { t.expansions[1].rects = [[44, 24, 8, 16]]; }, 'overlaps'],
    [(t) => { t.expansions[5].rects = [[8, 8, 8, 8]]; }, 'touch'],
    [(t) => { t.levels[5].E = t.levels[4].E - 1; }, 'R9'],
    [(t) => { t.decor.find((d) => d.id === 'jam_shelf').cost = 10; }, 'reward decor'],
    [(t) => { t.animals.find((a) => a.id === 'cow').feed = 'pig_slop2'; }, 'unknown feed'],
    [(t) => { t.feeds[0].classes = [{ cls: 'nuts', qty: 3 }]; }, 'class nuts'],
    [(t) => { t.expansionDebris.creekside[0].x = 2; }, 'leaves the land'],
  ];
  for (const [mutate, needle] of broken) {
    const t = tablesClone();
    mutate(t);
    const errs = validateContent(t);
    assert.ok(errs.some((e) => e.includes(needle)),
      `expected a problem mentioning "${needle}", got ${JSON.stringify(errs.slice(0, 4))}`);
  }
  assert.deepEqual(validateContent(tablesClone()), [], 'the clone itself is valid');
});

test('levelFromXp at every boundary, and beyond the table (Legacy)', () => {
  assert.equal(levelFromXp(0), 1);
  for (const row of CONTENT.levels) {
    assert.equal(levelFromXp(row.xp), row.level);
    if (row.xp > 0) assert.equal(levelFromXp(row.xp - 1), row.level - 1);
    assert.equal(xpForLevel(row.level), row.xp);
  }
  const top = CONTENT.levels.at(-1);
  const step = top.xp - CONTENT.levels.at(-2).xp;
  assert.equal(step, 480_000, 'Legacy levels cost the L39 -> 40 requirement (GDD §4.6)');
  assert.equal(levelFromXp(top.xp + step), top.level + 1);
  assert.equal(levelFromXp(top.xp + step - 1), top.level);
  assert.equal(xpForLevel(top.level + 2), top.xp + 2 * step);
  assert.equal(levelRow(99), top);
  assert.equal(levelRow(0), CONTENT.levels[0]);
});

test('GDD §4.6 table spot checks: L2 at 25 XP, L5 at 680, L10 at 7,960, L12 at 15,160', () => {
  assert.equal(xpForLevel(2), 25);
  assert.equal(xpForLevel(5), 680);
  // the final pass (2026-10-04) moved L9-L11 by 100-300 XP for the Level-up Bloom and took it back at L11, so L12-L15
  // stay where a live farm passed them
  assert.equal(xpForLevel(10), 7960);
  assert.equal(xpForLevel(12), 15_160);
  assert.equal(xpForLevel(15), 45_060);
  assert.deepEqual([levelRow(5).coins, levelRow(5).acorns], [1400, 5]);
  assert.equal(levelRow(1).coins, 0, 'nobody reaches level 1: no reward row');
});

test('plot cap and plot prices (GDD §3.10)', () => {
  assert.equal(plotCapOf(1, 0), 16);
  assert.equal(plotCapOf(5, 1), 28);
  assert.equal(plotCapOf(20, 8), 92);
  assert.equal(plotCapOf(40, 15), 164);
  assert.equal(plotCapOf(60, 15), 164, 'Legacy levels keep the L40 cap');
  for (let n = 1; n <= 16; n++) assert.equal(plotPrice(n), 0);
  const gdd = { 17: 25, 20: 30, 30: 45, 40: 65, 60: 140, 80: 310, 100: 670, 120: 1500, 140: 3200, 164: 8300 };
  for (const [n, p] of Object.entries(gdd)) assert.equal(plotPrice(Number(n)), p, `plot ${n}`);
  for (let n = 17; n < 170; n++) assert.ok(plotPrice(n + 1) >= plotPrice(n));
});

test('E-hours, mastery stars, personal levels and titles', () => {
  assert.equal(eHours(5, 10_000), 9300);
  assert.equal(eHours(10, 1000), 2500);
  assert.equal(eHours(1, 200), 44);
  const wheat = cropOf('wheat');
  assert.equal(masteryStars(wheat, 49, 5), 0);
  assert.equal(masteryStars(wheat, 50, 5), 1);
  assert.equal(masteryStars(wheat, 750, 5), 3);
  assert.equal(masteryStars(wheat, 9999, 35), MILESTONE === 'M2' ? 4 : 3, 'Gold is M2: capped at 3 before it');
  assert.equal(masteryStars(wheat, 9999, 29), 3, 'Gold only from L30');
  assert.equal(masteryStars(undefined, 5, 1), 0);
  assert.equal(personalLevelFromXp(0), 1);
  assert.equal(personalLevelFromXp(CONTENT.levels[9].personalXp), 10);
  assert.equal(personalLevelFromXp(CONTENT.levels[9].personalXp - 1), 9);
  assert.equal(titleFor(1), 'Greenhorn');
  assert.equal(titleFor(11), 'Harvest Hand');
  assert.equal(titleFor(99), 'Living Legend');
});

test('order slots, barn capacity, tree and home caps', () => {
  assert.deepEqual([1, 2, 5, 9, 14, 20, 28, 35].map(orderSlotsAt), [0, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual([0, 1, 2, 3, 10, 11].map(barnCapacity), [200, 320, 440, 560, 1400, 1400]);
  assert.deepEqual([4, 10, 39, 40, 60].map((L) => treeCapAt(treeOf('apple_tree'), L)), [4, 5, 7, 8, 8]);
  assert.equal(homeCountAt(homeOf('coop'), 1), 1);
  assert.equal(homeCountAt(homeOf('cow_barn'), 6), 0);
  assert.deepEqual([12, 13, 15, 16, 31, 40].map((L) => homeCountAt(homeOf('beehive'), L)), [0, 2, 2, 3, 8, 8]);
  assert.equal(buildingOf('mill').secondCopy.at, 16);
});

test('expansionObjects: free objects then debris, with stable object ids', () => {
  assert.deepEqual(expansionObjects('home'), []);
  assert.deepEqual(expansionObjects('nope'), []);
  const objs = expansionObjects('old_orchard');
  assert.deepEqual(objs.slice(0, 2).map((o) => [o.id, o.def, o.mature]), [['exp2.0', 'apple_tree', true], ['exp2.1',
    'apple_tree', true]]);
  assert.equal(objs.length, 2 + 15);
  assert.ok(objs.slice(2).every((o) => o.origin === 'expansion' && /^exp2\.\d+$/.test(o.id)));
  assert.equal(new Set(objs.map((o) => o.id)).size, objs.length);
});

test('pluralOf: item names read right in counts (feed lines, task lines)', async () => {
  const { pluralOf } = await import('../shared/content/index.js');
  assert.equal(pluralOf('Egg', 1), 'Egg');
  assert.equal(pluralOf('Egg', 2), 'Eggs');
  assert.equal(pluralOf('Strawberry', 3), 'Strawberries');
  // M1b goods and animals (wave 2)
  assert.equal(pluralOf('Sheep', 2), 'Sheep');
  assert.equal(pluralOf('Honey', 2), 'Honey');
  assert.equal(pluralOf('Peach', 3), 'Peaches');
  assert.equal(pluralOf('Wool Scarf', 2), 'Wool Scarves');
  assert.equal(pluralOf('Pig Slop', 6), 'Pig Slop');
  assert.equal(pluralOf('Truffle', 3), 'Truffles');
  assert.equal(pluralOf('Potato', 4), 'Potatoes');
  assert.equal(pluralOf('Wheat', 32), 'Wheat');
  assert.equal(pluralOf('Chicken Feed', 6), 'Chicken Feed');
  assert.equal(pluralOf('Pancakes', 2), 'Pancakes');
  assert.equal(pluralOf('Wooden Crate', 2), 'Wooden Crates');
});

test('decor cards speak to players: no design notes ("§", "pure juice", "bee forage") (RC-27)', () => {
  const notes = [...CONTENT.decor.values()].filter((d) => /§|juice|forage/i.test(d.text ?? '')).map((d) => d.id);
  assert.deepEqual(notes, []);
  assert.equal(CONTENT.decor.get('sunset_bench').text, 'A seat for Golden Hour, for the two of you');
  assert.equal(CONTENT.decor.get('wind_chime').text, 'Chimes when you point at it');
});

test('pet goods and pet homes wait for the pets (M1b); L10 still unlocks something (RC-30, R8)', () => {
  for (const id of ['dog_biscuit', 'cat_treat', 'dog_house', 'cat_basket']) {
    const d = CONTENT.recipes.get(id) ?? CONTENT.decor.get(id);
    assert.equal(d.m, 'M1b', id);
    assert.equal(isLive(d), MILESTONE !== 'M1a', `${id} is live exactly from M1b`);
  }
  assert.ok(unlocksAt(10).length > 0);
});
