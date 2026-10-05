// Ribbons (GDD §5.4): tiers by scope, rewards, T ribbons for both, P per player, hidden ribbons, titles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { CONTENT, RIBBON_REWARDS, ribbonOf, isLive, xpForLevel, cropOf } from '../shared/content/index.js';
import { ribbonPoints, titlesOf, ribbonValue, groveCount } from '../shared/rules/actions/ribbons.js';
import { makeFarm, farmAt, put, credit, act, actOk, valid, T0 } from './helpers/rules-goals.js';
import { notLiveDef } from './helpers/content.js';

const harvested = (crop, o = {}) => ({ e: 'harvested', id: 'home.0.0', crop, qty: 2, planter: 'p1', xp: 0,
  fresh: false, ribbon: false, bonus: 0, star: 0, ...o });

test('an F ribbon: Bronze at the first tier pays 1 Acorn and a Ribbon Point, once', () => {
  const s = makeFarm();
  const r = ribbonOf('cream_of_the_crop');
  s.farm.stats.cropsHarvested = r.tiers[0] - 1;
  const acorns = s.farm.wallet.acorns;
  const tx = credit(s, [harvested('wheat')]);
  assert.deepEqual(s.farm.ribbons.cream_of_the_crop, { t: 1, at: T0 });
  assert.equal(s.farm.wallet.acorns, acorns + RIBBON_REWARDS.F[0].acorns);
  assert.equal(ribbonPoints(s), RIBBON_REWARDS.F[0].points);
  const ach = tx.events.filter((e) => e.e === 'achievement');
  assert.deepEqual(ach.map((e) => [e.id, e.tier, e.scope]), [['cream_of_the_crop', 1, 'F']]);
  credit(s, [harvested('wheat')]);
  assert.equal(s.farm.wallet.acorns, acorns + RIBBON_REWARDS.F[0].acorns, 'paid once');
});

test('crossing two tiers at once pays both, Silver adds the rosette decor', () => {
  const s = makeFarm();
  const r = ribbonOf('cream_of_the_crop');
  s.farm.stats.cropsHarvested = r.tiers[1] - 1;
  const acorns = s.farm.wallet.acorns;
  credit(s, [harvested('wheat')]);
  assert.equal(s.farm.ribbons.cream_of_the_crop.t, 2);
  assert.equal(s.farm.wallet.acorns, acorns + RIBBON_REWARDS.F[0].acorns + RIBBON_REWARDS.F[1].acorns);
  assert.equal(s.farm.storage.ribbon_rosette, 1);
});

test('a P ribbon is each player\'s own (Green Thumb counts plantings harvested by anyone)', () => {
  const s = makeFarm();
  s.players.p1.stats.plantingsHarvested = ribbonOf('green_thumb').tiers[0] - 1;
  credit(s, [harvested('wheat', { planter: 'p1' })], { pid: 'p2' });
  assert.equal(s.players.p1.ribbons.green_thumb.t, 1);
  assert.equal(s.players.p2.ribbons.green_thumb, undefined);
  assert.equal(s.players.p1.hearts, RIBBON_REWARDS.P[0].hearts + 1, 'Bronze Hearts (+1 teamwork Heart)');
  valid(s);
});

test('a T ribbon pays both players the P reward and the farm the F reward once', () => {
  const s = makeFarm();
  s.farm.stats.highFives = ribbonOf('high_five').tiers[0] - 1;
  const acorns = s.farm.wallet.acorns;
  credit(s, [{ e: 'together', kind: 'highFive', a: 'p1', b: 'p2', until: T0, hearts: 0 }]);
  assert.equal(s.farm.ribbons.high_five.t, 1);
  assert.equal(s.farm.wallet.acorns, acorns + RIBBON_REWARDS.F[0].acorns);
  assert.equal(s.players.p1.hearts, RIBBON_REWARDS.P[0].hearts);
  assert.equal(s.players.p2.hearts, RIBBON_REWARDS.P[0].hearts);
});

test('distinct and state ribbons: Rainbow Harvest counts crop kinds; Level Up reads the farm level', () => {
  const s = makeFarm();
  const crops = [...CONTENT.crops.values()].filter(isLive).slice(0, ribbonOf('rainbow_harvest').tiers[0]);
  for (const c of crops) credit(s, [harvested(c.id)]);
  assert.equal(s.farm.ribbons.rainbow_harvest.t, 1);
  credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(10) - s.farm.xp, coins: 0 }]);
  assert.equal(s.farm.ribbons.level_up.t, 1);
});

test('Good Business counts quarter orders (simple orders 1/4, R15)', () => {
  const s = farmAt(2);
  const fill = (simple) => credit(s, [{ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp: 1, acorns: 0, golden: false, simple,
    helped: null, value: 4, items: { wheat: 1 } }]);
  for (let i = 0; i < 24; i++) fill(false);
  for (let i = 0; i < 3; i++) fill(true);
  assert.equal(ribbonValue(s, ribbonOf('good_business')), 24);
  assert.equal(s.farm.ribbons.good_business, undefined);
  fill(true);
  assert.equal(s.farm.ribbons.good_business.t, 1);
});

test('groves: four same-species trees in an exact 4x4 block', () => {
  const s = farmAt(6);
  const at = [[20, 20], [22, 20], [20, 22]];
  for (const [x, z] of at) put(s, 'apple_tree', { x, z });
  assert.equal(groveCount(s), 0);
  put(s, 'pine', { x: 22, z: 22 });
  assert.equal(groveCount(s), 0, 'a different species');
  put(s, 'apple_tree', { x: 24, z: 22 });
  assert.equal(groveCount(s), 0);
  const t = farmAt(6);
  for (const [x, z] of [...at, [22, 22]]) put(t, 'apple_tree', { x, z });
  assert.equal(groveCount(t), 1);
});

test('hidden ribbons pay 3 Acorns once; Early Bird is a harvest between 04:00 and 07:00 farm time', () => {
  const s = makeFarm();
  const early = Date.UTC(2026, 9, 6, 3, 30);                        // 06:30 in Sofia
  const acorns = s.farm.wallet.acorns;
  credit(s, [harvested('wheat')], { now: early });
  assert.equal(s.farm.ribbons.early_bird.t, 1);
  assert.equal(s.farm.wallet.acorns, acorns + RIBBON_REWARDS.hidden.acorns);
  const late = Date.UTC(2026, 9, 6, 6, 30);                         // 09:30
  const t = makeFarm();
  credit(t, [harvested('wheat')], { now: late });
  assert.equal(t.farm.ribbons.early_bird, undefined);
});

test('titles: a Gold ribbon\'s title can be worn; unearned ones cannot', () => {
  const s = makeFarm();
  assert.equal(act(s, 'titlePick', { ribbon: 'green_thumb' }).code, ERR.LOCKED);
  assert.equal(act(s, 'titlePick', {}).code, ERR.ALREADY_DONE);
  s.players.p1.ribbons.green_thumb = { t: 3, at: T0 };
  s.farm.ribbons.cream_of_the_crop = { t: 3, at: T0 };
  assert.deepEqual(titlesOf(s, 'p1'), ['cream_of_the_crop', 'green_thumb']);
  assert.deepEqual(titlesOf(s, 'p2'), ['cream_of_the_crop'], 'farm titles are for both, personal ones are mine');
  actOk(s, 'titlePick', { ribbon: 'green_thumb' });
  assert.equal(s.players.p1.title, 'green_thumb');
  actOk(s, 'titlePick', {});
  assert.equal(s.players.p1.title, null);
  assert.equal(act(s, 'titlePick', { ribbon: notLiveDef('ribbons').id }).code, ERR.BAD_ARGS, 'a later milestone\'s ribbon');
  valid(s);
});

test('every live ribbon reads a counter the rules actually write (no unreachable ribbon)', () => {
  const written = new Set(['cropsHarvested', 'plantingsHarvested', 'harvest.*', 'harvestLong', 'freshHarvests',
    'prizedHarvests', 'seasonsHundred', 'treesHarvested', 'treeSpecies', 'grovesFormed', 'animalsCollected',
    'babiesRaised' /* the economy's grewUp event */, 'prizedAnimals', 'animalSpecies', 'animalsNamed', 'animalsPetted', 'goodsCrafted', 'craft.*',
    'recipesStar3', 'feedMade', 'coins.earned', 'ordersQ', 'demandSold', 'wishesBought', 'wish.*', 'debrisCleared',
    'expansionsBought', 'buildsAndSlots', 'cropsStar3', 'almanacDone', 'farmWeeksBest', 'daysPlayed', 'level',
    'personalLevel', 'partnerFlagsFilled', 'keepsakesGiven', 'duets', 'goldenHours', 'highFives', 'hoursTogether',
    'comboActions', 'placed.scarecrow', 'earlyHarvests', 'nightOwls', 'named.chicken', 'thanksSent',
    'bestHarvestStroke',
    // M1b: giants, Heirlooms, bees, pets, hampers, the Barge, Farm Beauty, the album, Restoration, the Fair, Teamwork,
    // the Memory Book and the Town Projects
    'giantsFelled', 'heirloomTrees', 'collect.*', 'petFedDays', 'premiumGoodsMade', 'bargeRows', 'bargeStreak',
    'beautyStars', 'setsCompleted', 'albumItems', 'bundlesDone', 'projectsDone', 'bestMedal', 'medalWeeks',
    'teamworkFelled', 'memoryPages', 'townProjects',
    // M2: Showcase points, items at Gold ★, the best NPC league, Ribbon Track tiers, Equal Partners barge weeks
    'showcasePoints', 'goldStars', 'bestLeague', 'seasonTiers', 'equalWeeks']);
  const counted = (stat) => written.has(stat) || written.has(`${stat.split('.')[0]}.*`);
  for (const r of CONTENT.ribbons.values()) if (isLive(r)) assert.ok(counted(r.stat), `${r.id} reads ${r.stat}`);
  assert.ok(cropOf('wheat'));
});

test('holdings ribbons (Orchardist, Builder) count only objects past their undo window (no buy-refund ribbons)', () => {
  const s = farmAt(11);
  const rcpt = { coins: 100, acorns: 0, until: T0 + 600_000 };
  for (const def of ['apple_tree', 'pine', 'cherry_tree']) put(s, def, { rcpt, paid: { coins: 100, acorns: 0 } });
  credit(s, [{ e: 'placed', id: 'x', def: 'cherry_tree', kind: 'tree', x: 0, z: 0, rot: 0, coins: 100, acorns: 0 }], { now: T0 + 1 });
  assert.equal(s.farm.ribbons.orchardist, undefined);
  credit(s, [], { now: T0 + 600_000 + 60_000 });
  assert.equal(s.farm.ribbons.orchardist.t, 1);
  // Builder: five settled buildings or homes (plus slots bought)
  const t = farmAt(9);
  for (const def of ['feed_mill', 'mill', 'bakery', 'sawmill']) put(t, def);
  credit(t, [{ e: 'slotUpgraded', id: 'x', def: 'mill', slots: 3, coins: 830 }]);
  assert.equal(t.farm.ribbons.builder.t, 1);
});

test('Wishful Thinking counts DIFFERENT things bought through the Wishlist, not a buy-and-sell loop (RC-15)', () => {
  const s = farmAt(9);
  const wishBought = (def) => ({ e: 'wishBought', id: `w${def}`, def, coins: 20, by: 'p1' });
  for (let i = 0; i < 5; i++) credit(s, [wishBought('dirt_path')]);
  assert.equal(s.farm.ribbons.wishful_thinking, undefined, 'five Dirt Paths are one thing');
  credit(s, [wishBought('picket_fence')]);
  credit(s, [wishBought('flower_bed')]);
  assert.equal(s.farm.ribbons.wishful_thinking.t, 1, 'three different things: Bronze');
  assert.deepEqual(CONTENT.ribbons.get('wishful_thinking').tiers, [3, 8, 15]);
});
