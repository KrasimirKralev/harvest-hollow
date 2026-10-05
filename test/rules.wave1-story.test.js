// Wave-1 QA RC-01 (mechanics-02): the first evening runs two PARALLEL tracks (GDD §7.4). Fields (A1, A2, A4) and
// Barnyard (A3: Coop, feed, feed the hens) meet at A5; no card waits on a 20-minute egg cycle; the scripted first
// order counts for A4 and Flour made before A5 opens counts for A5 (one-off retro credit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueSystemActions } from '../shared/rules/system.js';
import { questOf, xpForLevel } from '../shared/content/index.js';
import { makeFarm, must, sys, T0 } from './helpers.js';
import { credit } from './helpers/rules-goals.js';
import { idsOf, placeDef, give } from './helpers/rules.js';

const runSys = (s, now) => {
  for (let i = 0; i < 10; i++) {
    const due = dueSystemActions(s, now);
    if (!due.length) return;
    for (const d of due) sys(s, d.type, d.args, now);
  }
};

test('content: A3 has no egg task, A4 follows A2, A5 follows A3 and A4, A6 asks for the eggs', () => {
  assert.ok(!questOf('a3').tasks.some((t) => t.ref === 'egg'));
  assert.deepEqual(questOf('a3').tasks.at(-1), { verb: 'tend', ref: 'chicken', qty: 2 });
  assert.equal(questOf('a4').after, 'a2');
  assert.equal(questOf('a5').after, 'a4');
  assert.deepEqual(questOf('a5').alsoAfter, ['a3']);
  assert.ok(questOf('a6').tasks.some((t) => t.verb === 'collect' && t.ref === 'egg'));
});

test('Fields track: A4 runs beside A3 and Mabel\'s scripted first order completes it', () => {
  const s = makeFarm();
  const plots = idsOf(s, 'plot');
  let now = T0;
  for (let round = 0; round < 2; round++) {
    must(s, 'plant', { ids: plots, crop: 'wheat' }, { pid: 'p1', now });
    now += 60_000;
    must(s, 'harvest', { ids: plots }, { pid: 'p1', now });
  }
  must(s, 'sell', { item: 'wheat', qty: 10 }, { pid: 'p1', now });
  runSys(s, now);
  assert.ok(s.farm.quests.done.a1 && s.farm.quests.done.a2);
  assert.ok(s.farm.quests.active.a3, 'A3 (Barnyard) is open');
  assert.ok(s.farm.quests.active.a4, 'A4 (Fields) is open beside it');
  assert.deepEqual(s.farm.orders.slots['0'].order.items, { wheat: 8 });
  must(s, 'orderFill', { slot: 0, n: s.farm.orders.slots['0'].order.n }, { pid: 'p1', now });
  assert.ok(s.farm.quests.done.a4, 'the scripted first order is the A4 lesson');
  assert.ok(!s.farm.quests.active.a5 && !s.farm.quests.done.a5, 'A5 waits for A3 too');
});

test('A4 opened after the first order was filled: the fill is credited once at acceptance', () => {
  const s = makeFarm();
  for (const id of ['a1']) s.farm.quests.done[id] = T0;
  s.farm.quests.active = { a2: { at: T0, n: {} } };
  s.farm.stats.ordersQ = 4;                              // the scripted order, filled while A2 was still open
  s.farm.xp = xpForLevel(2);
  give(s, 'wheat', 10);
  must(s, 'sell', { item: 'wheat', qty: 10 }, { pid: 'p1' });
  assert.ok(s.farm.quests.done.a2);
  assert.ok(s.farm.quests.done.a4, 'A4 completes on acceptance from the retro credit');
});

test('Barnyard: A3 completes on feeding the two free hens (no eggs); A5 opens after A3 AND A4 with retro Flour', () => {
  const s = makeFarm();
  s.farm.quests.active = { a3: { at: T0, n: { 1: 1 } }, a4: { at: T0, n: {} } };
  s.farm.quests.done = { a1: T0, a2: T0 };
  s.farm.xp = xpForLevel(3);
  s.farm.quests.owed = { chicken: 2 };
  s.farm.stats['craft.flour'] = 2;                       // two Flour made before A5 could open
  const coop = placeDef(s, 'coop');
  assert.equal(s.farm.quests.owed.chicken ?? 0, 0, 'the owed hens moved in');
  give(s, 'chicken_feed', 6);
  must(s, 'tend', { id: coop }, { pid: 'p2' });
  assert.ok(s.farm.quests.done.a3, 'feeding both hens finishes A3');
  assert.ok(!s.farm.quests.active.a5, 'A5 still waits for A4');
  credit(s, [{ e: 'orderFilled', slot: 0, items: { wheat: 8 }, coins: 10, xp: 1, value: 10, simple: false, by: 'p1' }]);
  assert.ok(s.farm.quests.done.a4);
  assert.ok(s.farm.quests.active.a5, 'A5 opens once both tracks are done');
  assert.equal(s.farm.quests.active.a5.n['1'], 2, 'Flour made before A5 opened is credited once');
});
