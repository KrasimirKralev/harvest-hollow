// Story cards (GDD §5.3): automatic acceptance, deed and holding counts, completion and rewards, deliver,
// start rewards (A3's hens, A6's sapling), no double claims, never a dead end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { CONTENT, questOf, isLive, xpForLevel, cropOf, levelFromXp } from '../shared/content/index.js';
import { STORY_SLOTS, takeOwed, questReady, taskProgress, unseenBeats, tabOf } from '../shared/rules/actions/quests.js';
import { Tx } from '../shared/rules/tx.js';
import { makeFarm, farmAt, credit, put, give, act, actOk, evs, valid, T0 } from './helpers/rules-goals.js';
import { notLiveDef } from './helpers/content.js';

const harvested = (crop, qty = cropOf(crop).yield) => ({ e: 'harvested', id: 'home.0.0', crop, qty, planter: 'p1',
  xp: cropOf(crop).xp, fresh: false, ribbon: false, bonus: 0, star: 0 });
const planted = (crop) => ({ e: 'planted', id: 'home.0.0', crop });

test('a new farm starts with A1 on the board, and only A1', () => {
  const s = makeFarm();
  assert.deepEqual(Object.keys(s.farm.quests.active), ['a1']);
  valid(s);
});

test('A1: deeds since acceptance count; completion pays earned coins + XP and opens the next card', () => {
  const s = makeFarm();
  const a1 = questOf('a1');
  for (let i = 0; i < 5; i++) credit(s, [planted('wheat')]);
  assert.equal(s.farm.quests.active.a1.n['0'], 5);
  credit(s, [planted('wheat')]);
  assert.ok(taskProgress(s, 'a1', 0, T0).done);
  const coins = s.farm.wallet.coins;
  const tx = credit(s, [harvested('wheat', 2), harvested('wheat', 2), harvested('wheat', 2)]);
  assert.ok(s.farm.quests.done.a1);
  assert.equal(s.farm.wallet.coins - coins, a1.coins);
  assert.equal(s.farm.stats['coins.earned'], a1.coins, 'quest coins count as earned (GDD §5.4)');
  assert.deepEqual(tx.events.filter((e) => e.e === 'questDone').map((e) => e.id), ['a1']);
  assert.ok(s.farm.quests.active.a2, 'the chain continues');
  // never claimed twice
  credit(s, [harvested('wheat', 20)]);
  assert.equal(s.farm.stats['coins.earned'], a1.coins);
  valid(s);
});

test('state verbs count holdings: a coop placed before A3 completes its task at once', () => {
  const s = makeFarm();
  s.farm.quests.done.a1 = T0;
  s.farm.quests.done.a2 = T0;
  delete s.farm.quests.active.a1;
  put(s, 'coop');
  s.farm.quests.active.a3 = { at: T0, n: {} };
  assert.ok(taskProgress(s, 'a3', 0, T0).done, 'place 1 coop counts the coop already on the farm');
  assert.ok(!questReady(s, 'a3', T0));
});

test('A3 owes two free hens when accepted; the economy takes them as a home gains room', () => {
  const s = makeFarm();
  s.farm.quests.active = {};
  s.farm.quests.done = { a1: T0 };
  const tx = credit(s, [{ e: 'sold', item: 'wheat', qty: 10, coins: 20 }]);   // nothing to do with a2: just an action
  assert.ok(tx);
  // a2 is accepted by the next acceptance pass (completion or level-up): drive it with a level-up
  s.farm.xp = xpForLevel(2) - 1;
  credit(s, [harvested('wheat', 1)]);
  assert.ok(s.farm.quests.active.a2);
  for (let i = 0; i < 10; i++) credit(s, [{ e: 'sold', item: 'wheat', qty: 1, coins: 2 }]);
  assert.ok(s.farm.quests.done.a2);
  assert.ok(s.farm.quests.active.a3, 'A3 accepted when A2 completed');
  assert.equal(s.farm.quests.owed.chicken, 2);
  const t = new Tx(s);
  assert.equal(takeOwed(t, 'chicken', 1), 1);
  assert.equal(takeOwed(t, 'chicken', 5), 1);
  assert.equal(takeOwed(t, 'chicken', 5), 0);
  assert.equal(s.farm.quests.owed.chicken, undefined);
  t.rollback();
  assert.equal(s.farm.quests.owed.chicken, 2);
  valid(s);
});

test('at most three story cards; lower levels first; quests of later milestones never appear', () => {
  const s = farmAt(12);
  s.farm.quests.active = {};
  // mark the A chain up to a9 done so several chains compete
  for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']) s.farm.quests.done[id] = T0;
  s.farm.xp = xpForLevel(12) - 1;
  s.farm.xp = xpForLevel(11);
  credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(12) - xpForLevel(11), coins: 0 }]);
  // the side chains (F, G, H: M1b) open by themselves and never take a story slot
  const all = Object.keys(s.farm.quests.active);
  for (const id of all) assert.ok(isLive(questOf(id)) && questOf(id).level <= 12);
  const active = all.filter((id) => tabOf(questOf(id)) === 'story');
  assert.equal(active.length, STORY_SLOTS);
  assert.ok(active.every((id) => !['F', 'G', 'H'].includes(questOf(id).chain)));
  const lv = active.map((id) => questOf(id).level);
  assert.deepEqual(lv, [...lv].sort((a, b) => a - b).slice(0, lv.length), 'the lowest levels are picked first');
});

test('deliver: the card completes only by the questDeliver action, which consumes the goods', () => {
  const s = farmAt(6);
  s.farm.quests.active = { b2: { at: T0, n: { 1: 2 } } };
  s.farm.quests.done = { b1: T0 };
  put(s, 'juice_press');
  assert.equal(act(s, 'questDeliver', { id: 'b2' }).code, ERR.NOT_READY);
  give(s, 'apple_juice', 1);
  const coins = s.farm.wallet.coins;
  const r = actOk(s, 'questDeliver', { id: 'b2' });
  assert.equal(s.farm.inventory.apple_juice, undefined);
  assert.ok(s.farm.quests.done.b2);
  assert.equal(s.farm.wallet.coins - coins, questOf('b2').coins);
  assert.deepEqual(evs(r, 'questDone').map((e) => e.id), ['b2']);
  assert.equal(act(s, 'questDeliver', { id: 'b2' }).code, ERR.ALREADY_DONE);
  assert.equal(act(s, 'questDeliver', { id: 'c1' }).code, ERR.NOT_FOUND, 'not on the board');
  assert.equal(act(s, 'questDeliver', { id: notLiveDef('quests').id }).code, ERR.BAD_ARGS,
    'a quest of a later milestone fails the schema');
  valid(s);
});

test('A6 gives its apple sapling into the build tray when accepted; A11 queues the story beat for each player', () => {
  const s = farmAt(4);
  s.farm.quests.active = {};
  for (const id of ['a1', 'a2', 'a3', 'a4']) s.farm.quests.done[id] = T0;
  s.farm.quests.active.a5 = { at: T0, n: { 1: 3 } };
  const before = s.farm.storage?.apple_tree ?? 0;
  put(s, 'mill');
  credit(s, [{ e: 'placed', id: 'm', def: 'mill', kind: 'building', x: 1, z: 1, rot: 0, coins: 0, acorns: 0 }]);
  assert.ok(s.farm.quests.done.a5);
  assert.ok(s.farm.quests.active.a6);
  assert.equal(s.farm.storage.apple_tree, before + 1);
  // a11's beat: after completion both players have it unseen
  s.farm.quests.done.a11 = T0;
  assert.deepEqual(unseenBeats(s, 'p1'), ['two_pairs']);
  actOk(s, 'markSeen', { kind: 'beat', id: 'two_pairs' }, { pid: 'p1' });
  assert.deepEqual(unseenBeats(s, 'p1'), []);
  assert.deepEqual(unseenBeats(s, 'p2'), ['two_pairs']);
});

test('every live story quest can be completed from content the farm unlocks by its level (no dead end)', () => {
  const verbsCounted = new Set(['plant', 'harvest', 'sell', 'place', 'build', 'own', 'make', 'collect', 'deliver', 'buy',
    'raise', 'fill', 'clear', 'expand', 'upgrade', 'empty', 'fertilize', 'tend',
    // M1b (chain E: Restoration bundles / projects, Town Projects, Farm Beauty stars)
    'complete', 'reach',
    // M2 (C8: the Breeding Barn)
    'breed']);
  for (const q of CONTENT.quests.values()) {
    if (!isLive(q) || !['A', 'B', 'C', 'D', 'E'].includes(q.chain)) continue;
    for (const t of q.tasks) {
      assert.ok(verbsCounted.has(t.verb), `${q.id}: verb ${t.verb} is not counted`);
      if (['make', 'collect', 'harvest', 'sell', 'deliver'].includes(t.verb) && !['prized', 'demand'].includes(t.ref)) {
        const it = CONTENT.items.get(t.ref);
        assert.ok(it && isLive(it) && it.unlock <= q.level, `${q.id}: ${t.ref} is not available at L${q.level}`);
      }
    }
  }
});

test('levels gate cards: a farm that levels up past several cards gets them in chain order', () => {
  const s = makeFarm();
  s.farm.quests.active = {};
  for (const id of ['a1', 'a2', 'a3', 'a4']) s.farm.quests.done[id] = T0;
  credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(3), coins: 0 }]);
  assert.equal(levelFromXp(s.farm.xp), 3);
  assert.deepEqual(Object.keys(s.farm.quests.active).sort(), ['a5', 'b1']);
});

test('doable first: a card whose goods the farm can make now beats a lower-level card that has to wait', () => {
  const s = farmAt(11);
  s.farm.quests.active = {};
  s.farm.quests.done = {};
  for (const q of CONTENT.quests.values()) {
    if (isLive(q) && !['a11', 'b3', 'd1', 'e3'].includes(q.id) && q.level <= 11) s.farm.quests.done[q.id] = T0;
  }
  give(s, 'cherry_jam', 1);                                         // d1's goods are within reach (in the Barn)
  credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(12) - s.farm.xp, coins: 0 }]);
  const picked = Object.keys(s.farm.quests.active).filter((id) => tabOf(questOf(id)) === 'story').sort();
  assert.ok(picked.includes('d1'), `${picked}`);
  assert.equal(picked.length, STORY_SLOTS);
  assert.ok(!picked.includes('b3') || !picked.includes('a11'), 'two waiting cards do not both beat a doable one');
});

test('A3\'s two hens move in at once when the Coop is already placed (no waiting for a later home event)', () => {
  const s = makeFarm();
  put(s, 'coop');
  s.farm.quests.active = { a2: { at: T0, n: { 0: 9 } } };
  s.farm.quests.done = { a1: T0 };
  credit(s, [{ e: 'sold', item: 'wheat', qty: 1, coins: 2 }]);
  assert.ok(s.farm.quests.active.a3);
  const hens = Object.values(s.farm.objects).filter((o) => o.def === 'chicken');
  assert.equal(hens.length, 2);
  assert.ok(hens.every((o) => o.free === true && o.adultAt <= T0));
  assert.equal(s.farm.quests.owed.chicken, undefined);
  valid(s);
});
