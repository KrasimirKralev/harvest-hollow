// progress.processEvents: XP, levels, personal levels, mastery stars, Together Combo, Spark, stats, the feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, cropOf, levelRow, xpForLevel, levelFromXp, personalLevelFromXp, MASTERY, COOP, eHours } from '../shared/content/index.js';
import { CELEBRATIONS, FX_EVENTS, setBloom, getBloom, starsOf } from '../shared/rules/progress.js';
import { ECON_EVENT_NAMES } from '../shared/rules/events.js';
import { feedRows } from '../shared/rules/feed.js';
import { makeFarm, farmAt, credit, valid, T0, MIN } from './helpers/rules-goals.js';

const harvested = (crop, o = {}) => ({ e: 'harvested', id: 'home.0.0', crop, qty: cropOf(crop).yield, planter: 'p1',
  xp: cropOf(crop).xp, fresh: false, ribbon: false, bonus: 0, star: 0, ...o });

test('every economy event is an FX event; the celebrations are the closed set', () => {
  for (const e of ECON_EVENT_NAMES) assert.ok(FX_EVENTS.has(e), e);
  for (const e of CELEBRATIONS) assert.ok(!FX_EVENTS.has(e), `${e} is both`);
  assert.deepEqual([...CELEBRATIONS].sort(), ['achievement', 'albumFind', 'albumSet', 'bargeRow', 'bloomed', 'duelEnded',
    'duet', 'fairCeremony', 'friendship', 'levelUp', 'mastery', 'questDone', 'together', 'trackTier']);
});

test('a harvest credits stats, farm XP, the 40/60 personal split and the mastery count', () => {
  const s = farmAt(4);
  const xp0 = s.farm.xp;
  const corn = cropOf('corn');
  credit(s, [harvested('corn', { planter: 'p1' })], { pid: 'p2' });
  assert.equal(s.farm.xp, xp0 + corn.xp);
  const toPlanter = Math.floor(corn.xp * 0.4);
  assert.equal(s.players.p1.xp, toPlanter);
  assert.equal(s.players.p2.xp, corn.xp - toPlanter);
  assert.equal(s.farm.stats['harvest.corn'], 1);
  assert.equal(s.farm.stats.cropsHarvested, 1);
  assert.equal(s.players.p2.stats['harvest.corn'], 1);
  assert.equal(s.players.p1.stats.plantingsHarvested, 1, 'Green Thumb counts the planter');
  assert.equal(s.farm.mastery.corn, 1);
  valid(s);
});

test('a drag stroke is one feed line; a partner stroke on my planting gives a Heart each, at most 10 a day', () => {
  const s = farmAt(4);
  for (let i = 0; i < 5; i++) credit(s, [harvested('wheat', { id: `home.0.${i}` })], { pid: 'p2', now: T0 + i * 100 });
  const rows = feedRows(s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1].p, 5);
  assert.equal(rows[0][1].q, 5 * cropOf('wheat').yield);
  assert.equal(s.players.p1.hearts, 1);
  assert.equal(s.players.p2.hearts, 1);
  assert.equal(s.players.p2.stats.bestHarvestStroke, 5);
  // 20 more strokes (each 3 s apart: new lines): the daily cap holds
  for (let i = 0; i < 20; i++) credit(s, [harvested('wheat')], { pid: 'p2', now: T0 + 10_000 + i * 3000 });
  assert.equal(s.players.p1.hearts, COOP.teamworkHarvest.heartsPerDay);
  assert.equal(s.players.p2.hearts, COOP.teamworkHarvest.heartsPerDay);
  // a new farm day resets the cap
  credit(s, [harvested('wheat')], { pid: 'p2', now: T0 + 86_400_000 });
  assert.equal(s.players.p2.hearts, COOP.teamworkHarvest.heartsPerDay + 1);
  // my own planting: no teamwork heart
  credit(s, [harvested('wheat', { planter: 'p2' })], { pid: 'p2', now: T0 + 86_500_000 });
  assert.equal(s.players.p2.hearts, COOP.teamworkHarvest.heartsPerDay + 1);
  valid(s);
});

test('a level-up grants (never earns) the level coins, adds Acorns, calls the Bloom once and celebrates', () => {
  const s = makeFarm();
  const calls = [];
  const economyBloom = getBloom();
  setBloom((tx, ctx, before, after) => calls.push([before, after]));
  try {
    s.farm.xp = xpForLevel(2) - 1;
    const coins = s.farm.wallet.coins;
    const acorns = s.farm.wallet.acorns;
    const tx = credit(s, [harvested('wheat')]);
    assert.equal(levelFromXp(s.farm.xp), 2);
    assert.equal(s.farm.wallet.coins, coins + levelRow(2).coins);
    assert.equal(s.farm.wallet.acorns, acorns + levelRow(2).acorns);
    assert.equal(s.farm.stats['coins.granted'], levelRow(2).coins);
    assert.equal(s.farm.stats['coins.earned'], undefined);
    const ups = tx.events.filter((e) => e.e === 'levelUp' && e.scope === 'farm');
    assert.deepEqual(ups.map((e) => e.level), [2]);
    assert.deepEqual(calls, [[1, 2]]);
    assert.ok(feedRows(s).some(([, r]) => r.k === 'level' && r.level === 2));
  } finally {
    setBloom(economyBloom);
  }
  valid(s);
});

test('a jump over several levels pays every level once, in order', () => {
  const s = makeFarm();
  const tx = credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(4) + 3, coins: 0 }]);
  assert.deepEqual(tx.events.filter((e) => e.e === 'levelUp' && e.scope === 'farm').map((e) => e.level), [2, 3, 4]);
  const want = levelRow(2).coins + levelRow(3).coins + levelRow(4).coins;
  // the level coins, once each (an Almanac task the clearing also finished pays its own, separately)
  const level = Object.values(s.farm.ledger.rows).filter((r) => r.reason === 'level').map((r) => r.n);
  assert.deepEqual(level, [levelRow(2).coins, levelRow(3).coins, levelRow(4).coins]);
  const almanac = Object.values(s.farm.ledger.rows).filter((r) => r.reason === 'almanac').reduce((n, r) => n + r.n, 0);
  assert.equal(s.farm.stats['coins.granted'], want + almanac);
});

test('personal levels emit a player levelUp with the title', () => {
  const s = makeFarm();
  const need = CONTENT.levels[1].personalXp;
  const tx = credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: need, coins: 0 }]);
  assert.equal(personalLevelFromXp(s.players.p1.xp), 2);
  const up = tx.events.find((e) => e.e === 'levelUp' && e.scope === 'player');
  assert.equal(up.pid, 'p1');
  assert.equal(up.level, 2);
  assert.equal(typeof up.title, 'string');
});

test('mastery stars pay only from L7, catch up at L7, and are capped by E (GDD §4.8)', () => {
  const s = makeFarm();
  const wheat = cropOf('wheat');
  s.farm.mastery.wheat = wheat.mastery[0] - 1;
  credit(s, [harvested('wheat')]);
  assert.equal(starsOf(s, 'wheat'), 0, 'no stars before the mastery level');
  s.farm.xp = xpForLevel(MASTERY.unlock) - 1;
  const coins = s.farm.stats['coins.granted'] ?? 0;
  const tx = credit(s, [harvested('wheat')]);
  assert.equal(starsOf(s, 'wheat'), 1, 'the star earned before L7 is paid at L7');
  const star = tx.events.filter((e) => e.e === 'mastery');
  assert.deepEqual(star.map((e) => [e.id, e.star]), [['wheat', 1]]);
  const L = levelFromXp(s.farm.xp);
  const want = Math.min(MASTERY.rewards[0].coinsV * wheat.sell, eHours(L, MASTERY.rewards[0].coinsHoursBp));
  assert.equal((s.farm.stats['coins.granted'] ?? 0) - coins - levelRow(MASTERY.unlock).coins, want);
  // more harvests do not pay the same star twice
  credit(s, [harvested('wheat')]);
  assert.equal(starsOf(s, 'wheat'), 1);
  valid(s);
});

test('star 3 gives an Acorn and a Mastery Sign into the build tray', () => {
  const s = farmAt(8);
  const wheat = cropOf('wheat');
  s.farm.mastery.wheat = wheat.mastery[2] - 1;
  s.farm.stars.wheat = 2;
  const acorns = s.farm.wallet.acorns;
  const signs = s.farm.storage?.mastery_sign ?? 0;
  const tx = credit(s, [harvested('wheat')]);
  assert.equal(starsOf(s, 'wheat'), 3);
  // +1 Acorn for the star, +1 for Crop Master Bronze (one crop at star 3), in the same transaction
  assert.equal(s.farm.wallet.acorns, acorns + 1 + 1);
  assert.deepEqual(tx.events.filter((e) => e.e === 'achievement').map((e) => [e.id, e.tier]), [['crop_master', 1]]);
  assert.equal(s.farm.storage.mastery_sign, signs + 1);
});

test('Together Combo: +10 % XP on productive deeds near the partner, capped per day; the meter pays at 25', () => {
  const s = farmAt(4);
  const near = { recent: { p2: { harvest: 9 } }, online: ['p1', 'p2'] };
  const corn = cropOf('corn');
  const xp0 = s.farm.xp;
  credit(s, [harvested('corn', { planter: 'p1' })], { pid: 'p1', ext: near });
  assert.equal(s.farm.xp - xp0, corn.xp + Math.floor(corn.xp / 10));
  assert.equal(s.farm.stats.comboActions, 1);
  // far away (> 8 tiles: squared distance 65) or the actor's own other tab: no combo
  const xp1 = s.farm.xp;
  credit(s, [harvested('corn')], { pid: 'p1', ext: { recent: { p2: { harvest: 65 } } } });
  credit(s, [harvested('corn')], { pid: 'p1', ext: { recent: { p1: { harvest: 0 } } } });
  assert.equal(s.farm.xp - xp1, 2 * corn.xp);
  // the meter: 25 combo actions in a day pay 1 Compost
  for (let i = 1; i < 25; i++) credit(s, [harvested('wheat')], { pid: 'p1', ext: near, now: T0 + i });
  assert.equal(s.farm.coop.combo.n, 25);
  // a reward is never lost: Compost waits in the Barn until composting unlocks (L8)
  assert.equal(s.farm.inventory.compost, 1);
  const t = farmAt(8);
  for (let i = 0; i < 25; i++) credit(t, [harvested('wheat')], { pid: 'p2', ext: { recent: { p1: { tend: 1 } } }, now: T0 + i });
  assert.equal(t.farm.inventory.compost, 1);
  // the XP bonus stops after maxPerDay actions
  const u = farmAt(4);
  u.players.p1.caps = { d: s.farm.daily.day, combo: COOP.combo.maxPerDay };
  const xp2 = u.farm.xp;
  credit(u, [harvested('corn')], { pid: 'p1', ext: near });
  assert.equal(u.farm.xp - xp2, corn.xp);
});

test('a High-five Spark adds 10 % personal XP while it lasts, never farm XP', () => {
  const s = farmAt(4);
  s.players.p1.spark = T0 + 10 * MIN;
  const corn = cropOf('corn');
  const farm0 = s.farm.xp;
  credit(s, [harvested('corn', { planter: 'p1' })], { pid: 'p1' });
  assert.equal(s.farm.xp - farm0, corn.xp);
  assert.equal(s.players.p1.xp, corn.xp + Math.floor(corn.xp / 10));
  credit(s, [harvested('corn', { planter: 'p1' })], { pid: 'p1', now: T0 + 11 * MIN });
  assert.equal(s.players.p1.xp, 2 * corn.xp + Math.floor(corn.xp / 10));
});

test('Side by Side: togetherMin minutes add up to hours; Night Owls needs both online after midnight', () => {
  const s = farmAt(2);
  credit(s, [], { ext: { togetherMin: 59 } });
  assert.equal(s.farm.stats.hoursTogether, undefined);
  const tx = credit(s, [], { ext: { togetherMin: 2 } });
  assert.equal(s.farm.stats.togetherMin, 61);
  assert.equal(s.farm.stats.hoursTogether, 1);
  assert.equal(s.players.p2.stats.hoursTogether, 1);
  assert.ok(tx);
  // 00:30 local (Europe/Sofia, UTC+3 in October): 21:30 UTC
  const night = Date.UTC(2026, 9, 6, 21, 30);
  credit(s, [], { now: night, ext: { online: ['p1'] } });
  assert.equal(s.farm.stats.nightOwls, undefined);
  credit(s, [], { now: night, ext: { online: ['p1', 'p2'] } });
  assert.equal(s.farm.stats.nightOwls, 1);
});

test('a crafted good, a feed batch and the Compost Bin count separately', () => {
  const s = farmAt(8);
  credit(s, [{ e: 'crafted', id: 'b', building: 'mill', recipe: 'flour', item: 'flour', qty: 1, xp: 6, double: false, first: true }]);
  credit(s, [{ e: 'crafted', id: 'f', building: 'feed_mill', recipe: 'chicken_feed', item: 'chicken_feed', qty: 6, xp: 1 }]);
  credit(s, [{ e: 'crafted', id: 'c', building: 'compost_bin', recipe: 'compost', item: 'compost', qty: 3, xp: 0 }]);
  assert.equal(s.farm.stats.goodsCrafted, 1);
  assert.equal(s.farm.stats['craft.flour'], 1);
  assert.equal(s.farm.stats.feedMade, 6);
  assert.equal(s.farm.stats.compostMade, 3);
  assert.equal(s.farm.mastery.flour, 1);
  assert.equal(s.farm.mastery.chicken_feed, undefined, 'feed has no mastery track');
});

test('a level-up in the middle of a drag does not split the stroke (one feed line, Clean Sweep counts every plot)', () => {
  const s = makeFarm();
  s.farm.xp = xpForLevel(2) - 3;
  const events = Array.from({ length: 10 }, (_, i) => harvested('wheat', { id: `home.0.${i}`, planter: 'p1' }));
  credit(s, events, { pid: 'p1' });
  const rows = feedRows(s);
  const strokes = rows.filter(([, r]) => r.k === 'harvest');
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0][1].p, 10);
  assert.ok(rows.some(([, r]) => r.k === 'level'), 'the level-up line is there too');
  assert.equal(s.players.p1.stats.bestHarvestStroke, 10);
});

test('one click on a pen: "collected" and "tended" lines each grow instead of alternating line by line', () => {
  const s = farmAt(4);
  for (let i = 0; i < 3; i++) {
    credit(s, [
      { e: 'collected', id: `hen.${i}`, animal: 'chicken', item: 'egg', qty: 1, ribbon: false, bonus: 0, by: 'p1' },
      { e: 'fed', id: `hen.${i}`, animal: 'chicken', feed: 'chicken_feed', by: 'p1' },
    ], { pid: 'p1', now: T0 + i * 50 });
  }
  const kinds = feedRows(s).map(([, r]) => r.k).filter((k) => k === 'collect' || k === 'tend');
  assert.ok(kinds.length <= 2, `one line per kind, got ${kinds.join(',')}`);
  const eggs = feedRows(s).find(([, r]) => r.k === 'collect');
  assert.equal(eggs[1].q, 3);
});
