// Collections, the album (GDD §5.5): 2 % rolls keyed only on replicated counters, the pity after 40 dry rolls, who
// found each item, a completed set's Acorns, display piece and perk, duplicates traded 3 -> 1, and the grinding
// guards (only produced goods roll; a refused, re-sent or undone action never rolls again).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION_RULES, collectionOf, questOf, isLive } from '../shared/content/index.js';
import { CELEBRATIONS } from '../shared/rules/index.js';
import { perkOf, albumView, missingOf, dupesOf, setOfItem } from '../shared/rules/actions/album.js';
import { farmAt, put, give, credit, act, actOk, evs, valid, plain, forceM1bGoals, T0, MIN } from './helpers/rules-goals.js';

before(forceM1bGoals);

const egg = (o = {}) => ({ e: 'collected', id: 'h', animal: 'chicken', item: 'egg', qty: 1, xp: 0, ribbon: false, ...o });

test('an eligible event rolls its sets; finds are confirmed-only and record who found them', () => {
  const s = farmAt(12);
  let found = null;
  for (let i = 0; i < 60 && !found; i++) {
    const tx = credit(s, [egg()], { pid: i % 2 ? 'p2' : 'p1', now: T0 + i * MIN });
    found = tx.events.find((e) => e.e === 'albumFind');
  }
  assert.ok(found, 'the pity guarantees a feather within 41 eligible collections');
  assert.ok(CELEBRATIONS.has('albumFind') && CELEBRATIONS.has('albumSet'));
  const st = s.farm.album.sets.feathers;
  assert.equal(st.items[found.item].by, found.by);
  assert.equal(st.items[found.item].n, 1);
  assert.equal(s.farm.stats.albumItems, 1);
  assert.equal(st.pity, 0, 'a new item resets the pity');
  valid(s);
});

test('pity: after 40 dry rolls the next eligible roll always drops a missing item', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const s = farmAt(12, { seed });
    // a drag over a full coop: 20 eligible collections in one action
    for (let i = 0; i < 40 && missingOf(s, collectionOf('feathers')).length > 0; i++) {
      credit(s, Array.from({ length: 20 }, () => egg()), { now: T0 + i * MIN });
      const st = s.farm.album.sets.feathers;
      assert.ok(st.pity <= COLLECTION_RULES.pity, `seed ${seed}: ${st.pity} dry rolls in a row`);
    }
    assert.equal(missingOf(s, collectionOf('feathers')).length, 0, `seed ${seed}: the set completes`);
    assert.ok(s.farm.album.sets.feathers.r <= 5 * (COLLECTION_RULES.pity + 1));
  }
});

test('a completed set pays 5 Acorns, its display piece and its permanent perk (Recipe Cards: +2 % craft XP)', () => {
  const s = farmAt(12);
  const set = collectionOf('recipe_cards');
  const acorns = s.farm.wallet.acorns;
  let done = null;
  const bread = { e: 'crafted', id: 'b', building: 'bakery', recipe: 'bread', item: 'bread', qty: 1, xp: 0 };
  for (let i = 0; i < 40 && !done; i++) {
    const tx = credit(s, Array.from({ length: 10 }, () => bread), { now: T0 + i * MIN });
    done = tx.events.find((e) => e.e === 'albumSet');
  }
  assert.ok(done);
  assert.equal(done.set, 'recipe_cards');
  assert.ok(s.farm.wallet.acorns >= acorns + COLLECTION_RULES.acorns);
  assert.equal(s.farm.storage[set.display], 1, 'the display piece waits in the build tray');
  assert.equal(s.farm.stats.setsCompleted, 1);
  assert.equal(perkOf(s, 'craftXpBp'), 200);
  assert.equal(perkOf(s, 'bonusEggBp'), 0, 'only completed sets count');
  // the perk: a crafted good's XP +2 %
  const xp = s.farm.xp;
  credit(s, [{ e: 'crafted', id: 'b', building: 'bakery', recipe: 'bread', item: 'bread', qty: 1, xp: 100 }],
    { now: T0 + 999 * MIN });
  assert.equal(s.farm.xp - xp, 102);
  assert.ok(s.farm.ribbons.collector?.t >= 1, 'Collector: Bronze at the first set');
  valid(s);
});

test('grinding guards: feed and compost never roll; a refused action rolls nothing; the roll is the same on replay', () => {
  const s = farmAt(12);
  credit(s, Array.from({ length: 50 }, () => ({ e: 'crafted', id: 'f', building: 'feed_mill', recipe: 'chicken_feed',
    item: 'chicken_feed', qty: 3, xp: 0 })), { now: T0 });
  assert.equal(s.farm.album.sets.recipe_cards, undefined, 'feed batches are upkeep, not crafting');
  // a refused action (an Almanac reroll before the level) changes nothing, the counters included
  const before = plain(s.farm.album);
  assert.equal(act(s, 'albumTrade', { set: 'feathers', want: 'speckled_feather' }, { now: T0 }).code, 'NO_ITEMS');
  assert.deepEqual(plain(s.farm.album), before);
  // the same state and the same event roll the same: client prediction == server, replay == live
  const a = farmAt(12, { seed: 9 });
  const b = farmAt(12, { seed: 9 });
  for (let i = 0; i < 12; i++) {
    credit(a, Array.from({ length: 10 }, () => egg()), { now: T0 + i * MIN, pid: 'p1' });
    credit(b, Array.from({ length: 10 }, () => egg()), { now: T0 + i * MIN + 7, pid: 'p1', seq: 500 + i });
  }
  const strip = (x) => JSON.stringify(plain(x), (k, v) => (k === 'at' || k === 'done' ? undefined : v));
  assert.equal(strip(a.farm.album), strip(b.farm.album), 'rolls key on the set counter, never on now or seq');
});

test('a farm below the album level, or a set not in this build, rolls nothing', () => {
  const s = farmAt(COLLECTION_RULES.unlock - 1);
  credit(s, Array.from({ length: 50 }, () => egg()), { now: T0 });
  assert.deepEqual(s.farm.album.sets, {});
  const t = farmAt(12);
  credit(t, Array.from({ length: 80 }, () => ({ e: 'collected', id: 'd', animal: 'duck', item: 'duck_egg', qty: 1,
    xp: 0 })), { now: T0 });
  if (isLive(collectionOf('pond_treasures'))) assert.ok(t.farm.album.sets.pond_treasures, 'ducks feed Pond Treasures (M2)');
  else assert.equal(t.farm.album.sets.pond_treasures, undefined, 'Pond Treasures is an M2 set');
  assert.ok(t.farm.album.sets.feathers, 'ducks feed the Feathers set');
});

test('duplicates trade 3 -> 1 missing item of the same set, never the last copy of a found item', () => {
  const s = farmAt(12);
  s.farm.album.sets.feathers = { r: 5, pity: 0, done: null, items: {
    speckled_feather: { by: 'p1', at: T0, n: 3 }, barred_feather: { by: 'p2', at: T0, n: 2 } } };
  assert.equal(dupesOf(s, collectionOf('feathers')), 3);
  assert.equal(act(s, 'albumTrade', { set: 'feathers', want: 'barred_feather' }, { now: T0 }).code, 'ALREADY_DONE');
  assert.equal(act(s, 'albumTrade', { set: 'feathers', want: 'rusty_trowel' }, { now: T0 }).code, 'BAD_ARGS');
  const r = actOk(s, 'albumTrade', { set: 'feathers', want: 'golden_feather_piece' }, { now: T0, pid: 'p2' });
  assert.equal(evs(r, 'albumFind')[0].how, 'trade');
  const it = s.farm.album.sets.feathers.items;
  assert.deepEqual([it.speckled_feather.n, it.barred_feather.n, it.golden_feather_piece.n], [1, 1, 1]);
  assert.equal(it.golden_feather_piece.by, 'p2');
  assert.equal(act(s, 'albumTrade', { set: 'feathers', want: 'copper_feather' }, { now: T0 }).code, 'NO_ITEMS');
  valid(s);
});

test('Grandma\'s recipe card from A7 goes into the album; the view lists sets with who found what', () => {
  assert.equal(setOfItem('recipe_bread').id, 'recipe_cards');
  const s = farmAt(12);
  // A7 one bread short of done (whatever its exact task list): every make task full but the last unit of bread
  const n = {};
  questOf('a7').tasks.forEach((t, i) => { if (t.verb === 'make') n[String(i)] = t.qty - (t.ref === 'bread' ? 1 : 0); });
  s.farm.quests.active = { a7: { at: T0, n } };
  put(s, 'bakery');
  credit(s, [{ e: 'crafted', id: 'b', building: 'bakery', recipe: 'bread', item: 'bread', qty: 1, xp: 0 }],
    { now: T0 + 11 * MIN });
  assert.ok(s.farm.quests.done.a7, 'A7 complete');
  assert.equal(s.farm.album.sets.recipe_cards.items.recipe_bread.by, 'p1');
  const v = albumView(s).find((x) => x.id === 'recipe_cards');
  assert.ok(v.items.find((i) => i.id === 'recipe_bread').n === 1);
  give(s, 'egg', 1);
  valid(s);
});
