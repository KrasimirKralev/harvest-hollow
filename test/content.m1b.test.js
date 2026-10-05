// M1b content audit (wave 2, content brief): every M1b family is complete against GDD §3, §5.3-5.9 and §10, the new
// validation rules fire, and the flip gate: a build that plays M1b has rules for every live M1b system.
// Holds for MILESTONE 'M1a' and 'M1b' alike (the gate's rules check runs only once M1b is live).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT, MILESTONE, FAIR, BARGE, TOWNSFOLK, TOWN_PROJECT_RULES, FARM_BEAUTY, MASTERWORK, COLLECTION_RULES,
  COLLECTION_SOURCES, COOP, DEBRIS_RULES, TUTORIAL, ALMANAC, ORDERS, PETS, HEARTS_SHOP, STORY_BEATS, QUEST_VERBS,
  isLive, live, validateContent, questOf, npcOf, recipeOf, buildingOf, decorOf, eHours,
} from '../shared/content/index.js';
import { LETTER_ART, SPECIAL_REFS } from '../shared/content/story.js';
import { tablesClone, upTo, LAST_LEVEL } from './helpers/content.js';

const m1b = (fam) => [...CONTENT[fam].values()].filter((d) => d.m === 'M1b');
const H = 10_000;   // one hour in E-hour basis points

test('Restoration projects 1-3 are GDD §5.9 to the item (any N of M; coin slot E(16) x 0.5 h)', () => {
  const want = {
    greenhouse: { n: 1, unlock: 16, bundles: [
      ['seedlings', 5, 'wheat 20, carrot 20, corn 10, strawberry 6, tomato 9, potato 6, pumpkin 2'],
      ['glass', 3, 'planks 12, wooden_crate 2, coins 5000'],
      ['orchard_gift', 3, 'apple 10, cherry 8, orange 8, lemon 8, apple_juice 4, cherry_jam 2'],   // wave-2 QA D2
      ['kitchen_garden', 3, 'veggie_soup 3, pumpkin_soup 2, coleslaw 2, ketchup 3, sauerkraut 2']] },
    mill_wheel: { n: 2, unlock: 19, bundles: [
      ['grain', 4, 'wheat 30, corn 20, oats 15, sunflower 6, sugarcane 10'],
      ['bakehouse', 3, 'bread 6, corn_bread 3, cookies 3, blueberry_muffin 2, granola_bar 2'],
      ['millwright', 2, 'planks 16, wooden_crate 4'],
      ['dairy', 3, 'milk 8, butter 4, cheese 3, yogurt 3']] },
    stone_bridge: { n: 3, unlock: 22, bundles: [
      ['timber', 2, 'planks 24, wooden_crate 6'],
      ['woolly', 3, 'wool 6, yarn 6, scarf 2, sweater 1'],
      ['sweet', 3, 'strawberry_jam 3, cherry_jam 3, orange_marmalade 3, honey 3, ice_cream 2'],
      ['fair_prizes', 2, 'prized_crop 3, prized_animal_good 1, prized_fruit 1']] },
  };
  const slotText = (sl) => (sl.item ? `${sl.item} ${sl.qty}` : sl.special ? `${sl.special} ${sl.qty}`
    : `coins ${sl.coinsHoursBp}`);
  for (const [id, p] of Object.entries(want)) {
    const r = CONTENT.restoration.get(id);
    assert.equal(r.m, 'M1b', id);
    assert.equal(r.n, p.n, id);
    assert.equal(r.unlock, p.unlock, id);
    assert.deepEqual(r.bundles.map((b) => [b.id, b.need, b.slots.map(slotText).join(', ')]), p.bundles, id);
  }
  assert.equal(CONTENT.restoration.get('greenhouse').reward.greenhouse.plots, 12);
  assert.equal(eHours(16, 5000), Math.floor((CONTENT.levels[15].E * 5000 + 5000) / H),
    'the coin slot is E(16) x 0.5 h');
  assert.deepEqual(CONTENT.restoration.get('mill_wheel').reward.buildingTimeBp, { feed_mill: 2000, mill: 2000 });
  assert.equal(CONTENT.restoration.get('stone_bridge').reward.land.plotCap, 6);
  // the Greenhouse arrives as a placeable frame (rules-economy: actions/restoration.js greenhouseDef)
  const gh = [...CONTENT.landmarks.values()].find((d) => d.greenhouse);
  assert.equal(gh.id, 'greenhouse');
  assert.deepEqual(gh.size, [6, 4]);
  assert.equal(gh.layer, 'ground');
  assert.equal(gh.greenhouse.plots, 12);
  assert.equal(gh.m, 'M1b');
  for (const r of live('restoration')) assert.ok(r.unlock <= LAST_LEVEL[MILESTONE]);
});

test('Town Projects 1-4 and their rules are GDD §5.9 (E x 2 h of goods, E x (10 + 0.5 (n-1)) h of coins)', () => {
  assert.deepEqual(m1b('townProjects').map((p) => [p.id, p.n]), [['ferry_landing', 1], ['chapel', 2],
    ['bandstand', 3], ['schoolhouse', 4]]);
  assert.equal(CONTENT.townProjects.size, 24);
  for (const p of CONTENT.townProjects.values()) {
    assert.ok(typeof p.text === 'string' && p.text.length > 20, `${p.id} says what it brings`);
    assert.equal(decorOf(p.souvenir)?.m, p.m, `${p.id} souvenir`);
  }
  assert.deepEqual({ ...TOWN_PROJECT_RULES }, {
    unlock: 20, m: 'M1b', goodsHoursBp: 2 * H, goods: 3, madeWithinMs: 14 * 24 * 3_600_000, coinsHoursBaseBp: 10 * H,
    coinsHoursStepBp: H / 2, buildMs: 24 * 3_600_000, acorns: 5, repeatable: 'festival_pavilion',
    // wave-2 QA RC-02 capped a good at 4 h of production; the final pass (2026-10-04) at 2 h, so the first project is
    // built before L23 on the real rules (tools/real-sim.mjs --checks)
    producerCapMs: 2 * 3_600_000,
  });
});

test('Farm Beauty, decor sets and Masterwork are GDD §5.9 / §3.8', () => {
  assert.deepEqual([...FARM_BEAUTY.stars], [50, 150, 400, 900, 1800]);
  assert.deepEqual([...FARM_BEAUTY.copyBp], [10_000, 5000, 2500]);
  assert.equal(FARM_BEAUTY.pathBp, 1000);
  assert.equal(FARM_BEAUTY.setBp, 2500);
  assert.equal(FARM_BEAUTY.building, 3);
  assert.equal(FARM_BEAUTY.tree, 2);
  assert.equal(FARM_BEAUTY.starAcorns, 3);
  assert.equal(FARM_BEAUTY.orderCoinsBpPerStar * FARM_BEAUTY.stars.length, 500, '+1 % a star, at most +5 %');
  assert.equal(FARM_BEAUTY.unlock, 18);
  assert.deepEqual([...MASTERWORK.priceMul], [4, 16]);
  assert.deepEqual([...MASTERWORK.beautyBp], [15_000, 20_000]);
  assert.deepEqual(m1b('decorSets').map((s) => s.id), ['cottage_garden', 'harvest_fair', 'winter_lights']);
  const seen = new Set();
  for (const s of CONTENT.decorSets.values()) {
    assert.ok(s.pieces.length >= 4 && s.pieces.length <= 6, s.id);
    for (const id of s.pieces) {
      assert.ok(!seen.has(id), `${id} is in two sets`);
      seen.add(id);
      const d = decorOf(id);
      assert.ok(d.shop || d.source?.startsWith('quest:'), `${s.id}: ${id} can be had on demand`);
      if (s.m === 'M1b') assert.ok((d.shop ? d.unlock : questOf(d.source.slice(6)).level) <= 25, `${s.id}: ${id}`);
    }
  }
});

test('the validator catches decor sets that cannot be completed', () => {
  const cases = [
    [(t) => { t.decorSets.find((s) => s.id === 'harvest_fair').pieces[4] = 'pumpkin_lanterns'; }, 'on demand'],
    [(t) => { t.decorSets.find((s) => s.id === 'winter_lights').pieces[0] = 'scarecrow'; }, 'also in'],
    [(t) => { t.decorSets.find((s) => s.id === 'winter_lights').pieces[0] = 'gazebo'; }, 'is M2'],
    [(t) => { t.decorSets.find((s) => s.id === 'cottage_garden').pieces.length = 3; }, '4-6 pieces'],
  ];
  for (const [mutate, want] of cases) {
    const t = tablesClone();
    mutate(t);
    assert.ok(validateContent(t).some((e) => e.includes(want)), want);
  }
});

test('collections: the 8 M1b sets of GDD §5.5, 5 items each, sources that exist by M1b', () => {
  assert.deepEqual(m1b('collections').map((c) => c.id), ['recipe_cards', 'butterflies', 'lost_tools', 'feathers',
    'heirloom_seeds', 'fossils', 'honey_jars', 'buttons']);
  assert.equal(CONTENT.collections.size, 12);
  assert.deepEqual({ ...COLLECTION_RULES }, { unlock: 10, dropBp: 200, goldMul: 2, pity: 40, tradeIn: 3, acorns: 5,
    longCropMs: 4 * 3_600_000, oldCoinRollCoins: 100 });
  for (const c of CONTENT.collections.values()) {
    assert.equal(c.items.length, 5, c.id);
    assert.ok(c.perkText && Object.keys(c.perk).length, `${c.id} perk`);
    for (const tok of c.from) assert.ok(upTo(COLLECTION_SOURCES[tok.split(':')[0]], c.m), `${c.id} ${tok}`);
  }
  // A7's recipe card is the Recipe Cards set's Bread card (it is granted once collections are live)
  assert.ok(CONTENT.collections.get('recipe_cards').items.some((x) => x.id === questOf('a7').rewards.collection));
  const t = tablesClone();
  t.collections.find((c) => c.id === 'feathers').from.push('fish');
  assert.ok(validateContent(t).some((e) => e.includes('fish is a M2 system')));
  const t2 = tablesClone();
  t2.collections.find((c) => c.id === 'buttons').from.push('craft:oil_press');
  assert.ok(validateContent(t2).some((e) => e.includes('craft:oil_press is M2')));
});

test('County Fair and River Barge numbers are GDD §5.6 / §5.7', () => {
  assert.equal(FAIR.unlock, 14);
  assert.equal(FAIR.targetHoursBp, 1600, 'W = nice(E x 0.16 / 100) (wave-2 QA D2, measured on tools/real-sim.mjs)');
  assert.equal(FAIR.payBp, 15_000);
  assert.deepEqual([FAIR.closeDay, FAIR.closeHour], [6, 20], 'Sunday 20:00');
  assert.deepEqual(FAIR.medals.map((m) => m.atBp), [2000, 3500, 5000, 6000, 7000, 8000, 9000, 10_000, 11_500,
    14_000]);
  assert.deepEqual(FAIR.medals.map((m) => m.acorns ?? 0), [0, 0, 0, 2, 2, 2, 4, 4, 4, 6]);
  assert.equal(FAIR.medals.at(-1).m, 'M2', 'Platinum needs the Fair Grounds (M2)');
  assert.equal(FAIR.points.maxEntriesPerItem, 10);
  assert.equal(FAIR.points.duetMul, 2);
  assert.equal(FAIR.league.m, 'M2', 'no NPC league in M1b');
  assert.equal(BARGE.unlock, 15);
  assert.deepEqual([BARGE.dockDay, BARGE.dockHour, BARGE.castOffDay, BARGE.castOffHour], [0, 6, 6, 20]);
  // wave-2 QA D2: a row per 3 hours played; the final pass (2026-10-04): crates of E x 0.08 h capped by 30 minutes of
  // one producer, a never-made good as likely as a made one (a full row every other week on the real rules)
  assert.deepEqual([BARGE.cratesPerRow, BARGE.rowsMin, BARGE.rowsMax, BARGE.playMsPerRow], [3, 1, 3, 3 * 3_600_000]);
  assert.equal(BARGE.crateHoursBp, 800);
  assert.equal(BARGE.producerCapMs, 30 * 60_000);
  assert.equal(BARGE.neverMadeMul, 1);
  assert.equal(BARGE.payBp, 16_000);
  assert.equal(BARGE.xpShareBp, 2000);
  assert.deepEqual([BARGE.horseBp, BARGE.horseMaxBp], [500, 2000]);
  assert.deepEqual({ ...BARGE.row }, { coinsHoursBp: 2500, riverbankBp: 2500, acorns: 1, chestShareDiv: 3 });
  assert.deepEqual({ ...BARGE.chest }, { tiers: 5, acornsBase: 1, compostPerTier: 3, decorFrom: 3 });
  assert.equal(BARGE.helpFlags, 3);
});

test('townsfolk board and Friendship (GDD §5.3, L21): every townsperson pays a gift every 2 Friendship', () => {
  assert.equal(TOWNSFOLK.unlock, 21);
  assert.equal(TOWNSFOLK.postsPerWeek, 3);
  assert.deepEqual([...TOWNSFOLK.goods], [2, 3]);
  assert.equal(TOWNSFOLK.valueHoursBp, 2500);                 // wave-2 QA D2: about two orders
  assert.equal(TOWNSFOLK.payBp, 15_000);
  assert.equal(TOWNSFOLK.coinShareBp, 7000);                   // 30 % XP like an order (wave-2 QA RC-11)
  const fr = TOWNSFOLK.friendship;
  assert.deepEqual([fr.max, fr.rewardEvery, fr.goldenOrder, fr.request, fr.chainQuest, fr.giftPerDay],
    [10, 2, 1, 1, 2, 1]);
  const folk = [...CONTENT.npcs.values()].filter((n) => n.townsfolk);
  assert.equal(folk.length, 10);
  for (const n of folk) {
    const rw = fr.rewards[n.id];
    assert.equal(rw.length, 5, n.id);
    assert.equal(rw.filter((g) => g.decor).length, 3, `${n.id}: decor at 2, 6 and 10`);
    for (const g of rw) if (g.card) assert.ok(n.likes.includes(g.card), `${n.id} card ${g.card}`);
    assert.equal(n.likes.length, 3, n.id);
    assert.ok(n.lines.length >= 3, `${n.id} has three lines`);
  }
  const t = tablesClone();
  t.npcs.find((n) => n.id === 'pip').likes = ['carrot_juice', 'popcorn'];
  assert.ok(validateContent(t).some((e) => e.includes('likes 3 goods')));
});

test('M1b production: the 4 buildings, both duets, second copies and giant crops (GDD §3.5, §6.2 #7-#8)', () => {
  assert.deepEqual(m1b('buildings').map((b) => [b.id, b.unlock]), [['sewing', 14], ['pie_oven', 15],
    ['chandlery', 16], ['packing', 20]]);
  for (const b of m1b('buildings')) assert.ok(m1b('recipes').some((r) => r.building === b.id), `${b.id} has recipes`);
  for (const [id, L] of [['harvest_feast', 15], ['wedding_cake', 25]]) {
    const r = recipeOf(id);
    assert.equal(r.m, 'M1b');
    assert.equal(r.unlock, L);
    assert.equal(r.tier, 'duet');
    assert.ok(r.duetXp > r.xp);
  }
  assert.equal(COOP.duet.soloTimeBp, 20_000, 'a duet slow-cooks alone in 2 x time');
  assert.equal(buildingOf('mill').secondCopy.at, 16);
  assert.equal(buildingOf('dairy').secondCopy.at, 18);
  for (const id of ['second_windmill', 'second_dairy']) assert.equal(CONTENT.features.get(id).m, 'M1b');
  assert.deepEqual({ ...COOP.giant }, { from: 20, block: 3, plantWindowMs: 60_000, chanceBp: 2000, yieldMul: 2,
    hp: 60, fairPoints: 25, m: 'M1b' });
  assert.deepEqual([DEBRIS_RULES.chopDamage, DEBRIS_RULES.teamworkChopDamage, DEBRIS_RULES.teamworkWindowMs],
    [10, 15, 2000], 'a Giant is felled with the boulder chop rule');
  assert.equal(CONTENT.features.get('giant_crops').unlock, 20);
});

test('quests to L25: every M1b card is a full illustrated letter with a giver who speaks by then', () => {
  const cards = [...CONTENT.quests.values()].filter((q) => q.level <= 25 && q.m !== 'M2');
  for (const q of cards) {
    assert.ok(LETTER_ART.includes(q.letter.art), q.id);
    assert.ok(typeof q.done === 'string' && q.done.length > 10, `${q.id} done line`);
    const giver = npcOf(q.giver);
    assert.ok(upTo(giver.m, q.m), `${q.id} giver ${q.giver}`);
    if (q.m === 'M1b') {
      assert.ok(q.letter.body.length >= 2, `${q.id}: a letter of two paragraphs at least`);
      assert.ok(q.letter.body.join(' ').length >= 150, `${q.id}: the letter tells the story`);
    }
    if (q.chain !== 'H') assert.ok(giver.from <= q.level, `${q.id}: ${q.giver} speaks from L${giver.from}`);
    for (const t of q.tasks) {
      for (const ref of [t.ref].flat()) {
        if (QUEST_VERBS[t.verb].refs.includes(`special:${ref}`)) assert.ok(upTo(SPECIAL_REFS[ref], q.m), q.id);
      }
    }
    if (q.rewards.beat) assert.ok(upTo(STORY_BEATS.find((b) => b.id === q.rewards.beat).m, q.m), `${q.id} beat`);
  }
  // the chains reach L25 and F / G / H exist for the This-week and Together tabs
  for (const ch of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    assert.ok(m1b('quests').some((q) => q.chain === ch), `chain ${ch} continues in M1b`);
  }
  assert.ok(m1b('quests').some((q) => q.level === 25), 'a chapter lands at L25');
  // the first evening's graph (RC-01): C0 opens Dr. Fern's chain at L5, A7 bakes three loaves
  assert.deepEqual(questOf('c0').tasks, [{ verb: 'collect', ref: 'egg', qty: 4 }, { verb: 'make', ref: 'chicken_feed',
    qty: 2 }]);
  assert.equal(questOf('c1').after, 'c0');
  assert.deepEqual(questOf('a7').tasks.map((t) => `${t.verb} ${t.ref} ${t.qty}`), ['build bakery 1', 'make bread 3']);
});

test('ribbons to L25: the ones whose counters M1b feeds are M1b, every Bronze is reachable with M1b content', () => {
  assert.deepEqual(m1b('ribbons').map((r) => r.id), ['giant_among_us', 'heirloom_keeper', 'busy_bees', 'best_friends',
    'hamper_maker', 'captains_friend', 'full_steam', 'picture_perfect', 'collector', 'album_pages', 'restorer',
    'hollow_reborn', 'fair_contender', 'fair_regular', 'teamwork', 'our_story', 'village_builders']);
  // finite sources counted within M1b (a Bronze must not wait for M2)
  const bronze = (id) => CONTENT.ribbons.get(id).tiers[0];
  assert.ok(bronze('restorer') <= m1b('restoration').reduce((s, p) => s + p.bundles.length, 0));
  assert.ok(bronze('hollow_reborn') <= m1b('restoration').length);
  assert.ok(bronze('village_builders') <= m1b('townProjects').length);
  assert.ok(bronze('collector') <= m1b('collections').length);
  assert.ok(bronze('album_pages') <= m1b('collections').length * 5);
  assert.ok(bronze('picture_perfect') <= FARM_BEAUTY.stars.length);
  assert.ok(bronze('fair_contender') <= 9, 'Bronze I without Platinum');
});

test('drip-feed cards and first-use tips for every new M1b system', () => {
  for (const f of m1b('features')) {
    assert.ok(f.card && f.card.title && f.card.text.length >= 40, `${f.id} has a one-card explanation`);
    assert.ok(f.card.text.length <= 140, `${f.id}: one card, short`);
  }
  for (const id of ['seed_spreader', 'fair_panel', 'barge_panel', 'restoration_panel', 'town_panel',
    'townsfolk_panel', 'collections_panel', 'beehive', 'pig_pen']) {
    assert.ok(TUTORIAL.firstUse.some((t) => t.id === id), `first-use tip ${id}`);
  }
});

test('the first evening (RC-01): the Almanac from L3, a quick order on its own 5-minute timer', () => {
  assert.equal(ALMANAC.unlock, 3);
  assert.equal(CONTENT.features.get('almanac').unlock, 3);
  for (const t of ALMANAC.templates) if (t.m === 'M1a') assert.ok(t.unlock <= 4, t.id);
  assert.ok(ALMANAC.chest.coinsBp > 0 && ALMANAC.unlocks.compost === 8, 'a level-3 chest is never empty');
  assert.equal(ORDERS.quick.refillMs, 5 * 60_000);
  assert.ok(ORDERS.quick.refillMs < ORDERS.refillMs);
  assert.equal(ORDERS.quick.readyMinutes, 15);
});

test('pets are M1b (rules-economy builds them), the Hearts shop waits for M2', () => {
  assert.equal(PETS.m, 'M1b');
  assert.equal(HEARTS_SHOP.m, 'M2');
});

// ---- the flip gate --------------------------------------------------------------------------------------------
/**
 * What the rules must register before a system's content may be live: action types in `ACTIONS` (player and
 * system). Systems whose rules are the generic ones (crafting a new building's recipes, a new animal's cycle, a
 * second building copy) need nothing new and map to []. A new M1b feature without an entry fails the gate.
 */
const SUPPORT = {
  pets: ['adoptPet', 'feedPet', 'petPet', '_petFind'],
  // owner wish 6 (wave 4): a breed chosen when adopting, changeable in the pet panel
  pet_breeds: ['adoptPet', 'petBreed'],
  collections: ['albumTrade'],
  bees: ['tend'],
  county_fair: ['fairEnter', '_fair'],
  barge: ['bargeLoad', 'bargeFlag', '_barge'],
  restoration: ['donate'],
  second_windmill: ['place'],
  truffles: ['tend'],
  farm_beauty: ['_beauty'],
  decor_sets: ['_beauty'],
  masterwork: ['masterwork'],
  second_dairy: ['place'],
  giant_crops: ['plant', 'chop'],
  town_projects: ['townGive', 'townFund', '_townPost', '_townBuild'],
  townsfolk: ['folkFill', 'folkGift'],
  heirloom_fruit: ['harvestTree'],
  // GDD §6.2 #3 / L23: "Need help" flags on Restoration bundle slots (rules-economy, asked in w2-content.md)
  bundle_flags: ['donate', 'restoreFlag'],
};

test('flip gate: every M1b system has an entry here, and once M1b is live the rules register its actions', async () => {
  for (const f of m1b('features')) assert.ok(Object.hasOwn(SUPPORT, f.id), `M1b feature ${f.id} needs a SUPPORT entry`);
  if (MILESTONE === 'M1a') {
    // nothing of M1b is reachable in an M1a build (every action argument goes through lookup(); see milestones test)
    for (const f of m1b('features')) assert.equal(isLive(f), false, f.id);
    return;
  }
  const { ACTIONS } = await import('../shared/rules/index.js');
  for (const f of live('features').filter((x) => x.m === 'M1b')) {
    for (const type of SUPPORT[f.id]) assert.ok(Object.hasOwn(ACTIONS, type), `${f.id} needs the rules action ${type}`);
  }
});
