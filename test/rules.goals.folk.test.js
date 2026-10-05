// The townsfolk board and Friendship (GDD §5.3, L21): three requests every Monday by the order rules, paid like an
// order plus Friendship; requests leave with the week; liked-item gifts once a day; Friendship gifts every 2 points;
// golden orders and chain quests befriend their giver; an item is in at most two open orders, the board included.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { TOWNSFOLK, ORDERS, npcOf, itemOf } from '../shared/content/index.js';
import { CELEBRATIONS } from '../shared/rules/index.js';
import { folkView, friendshipOf, townsfolk } from '../shared/rules/actions/folk.js';
import { openItems } from '../shared/rules/orders-board.js';
import { weekOf } from '../shared/rules/coop.js';
import {
  farmAt, give, runDue, act, actOk, evs, valid, credit, forceM1bGoals, MONDAY, HOUR, DAY,
} from './helpers/rules-goals.js';

before(forceM1bGoals);

function boardFarm(level = 21) {
  const s = farmAt(level, { now: MONDAY });
  runDue(s, MONDAY);
  return s;
}

test('every Monday three different townsfolk post 2-3 goods worth about E x 0.25 h, paid 1.5 x V (70 % coins)', () => {
  const s = boardFarm();
  const posts = Object.values(s.farm.folk.posts);
  assert.equal(posts.length, TOWNSFOLK.postsPerWeek);
  assert.equal(new Set(posts.map((p) => p.npc)).size, posts.length, 'three different people');
  for (const p of posts) {
    assert.ok(townsfolk(21).includes(p.npc));
    const k = Object.keys(p.items).length;
    assert.ok(k >= 1 && k <= 3, JSON.stringify(p.items));
    let v = 0;
    for (const [i, q] of Object.entries(p.items)) v += itemOf(i).sell * q;
    assert.equal(p.value, Math.floor((v * TOWNSFOLK.payBp) / 10_000));
    assert.equal(p.coins, Math.floor((p.value * TOWNSFOLK.coinShareBp) / 10_000));
  }
  // an item sits in at most two open orders, Mabel's board and the townsfolk board together (GDD §9 #14)
  for (const [item, n] of openItems(s)) assert.ok(n <= ORDERS.maxOpenPerItem, `${item} in ${n} open orders`);
  assert.equal(folkView(s, MONDAY).posts.length, 3);
  valid(s);
});

test('nothing before L21; reaching it posts this week\'s requests at once', () => {
  const s = farmAt(20, { now: MONDAY });
  runDue(s, MONDAY);
  assert.deepEqual(s.farm.folk.posts, {});
  assert.equal(act(s, 'folkFill', { i: 0, n: 0 }, { now: MONDAY }).code, 'LOCKED');
});

test('a request pays once, to whoever hands it in; a stale or last week\'s request answers NOT_FOUND', () => {
  const s = boardFarm();
  const p = s.farm.folk.posts['0'];
  for (const [i, q] of Object.entries(p.items)) give(s, i, q);
  assert.equal(act(s, 'folkFill', { i: 0, n: p.n + 1 }, { now: MONDAY + HOUR }).code, 'NOT_FOUND');
  const coins = s.farm.wallet.coins;
  const xp = s.farm.xp;
  const r = actOk(s, 'folkFill', { i: 0, n: p.n }, { now: MONDAY + HOUR, pid: 'p2' });
  const ev = evs(r, 'folkFilled')[0];
  assert.equal(s.farm.wallet.coins, coins + p.coins);
  assert.ok(s.farm.xp >= xp + p.xp);
  assert.equal(ev.npc, p.npc);
  assert.equal(friendshipOf(s, p.npc), TOWNSFOLK.friendship.request);
  assert.deepEqual(s.farm.folk.posts['0'].done.by, 'p2');
  assert.equal(act(s, 'folkFill', { i: 0, n: p.n }, { now: MONDAY + HOUR }).code, 'ALREADY_DONE');
  // the next week replaces the board: last week's request has left
  const p1 = s.farm.folk.posts['1'];
  for (const [i, q] of Object.entries(p1.items)) give(s, i, q);
  runDue(s, MONDAY + 7 * DAY);
  assert.equal(s.farm.folk.w, weekOf(s, MONDAY + 7 * DAY));
  assert.notEqual(s.farm.folk.posts['1']?.n, p1.n);
  assert.equal(act(s, 'folkFill', { i: 1, n: p1.n }, { now: MONDAY + 7 * DAY + HOUR }).code, 'NOT_FOUND');
  valid(s);
});

test('Friendship: a liked gift once a day, gifts every 2 points (decor or a recipe card), capped at 10', () => {
  const s = boardFarm();
  const npc = 'rosie';
  const like = npcOf(npc).likes[0];
  give(s, like, 20);
  give(s, 'wheat', 5);
  assert.equal(act(s, 'folkGift', { npc, item: 'wheat' }, { now: MONDAY + HOUR }).code, 'BAD_ARGS', 'not a liked good');
  assert.equal(act(s, 'folkGift', { npc: 'hazel', item: like }, { now: MONDAY + HOUR }).code, 'BAD_ARGS');
  actOk(s, 'folkGift', { npc, item: like }, { now: MONDAY + HOUR });
  assert.equal(act(s, 'folkGift', { npc, item: like }, { now: MONDAY + 2 * HOUR, pid: 'p2' }).code, 'ALREADY_DONE',
    'one gift a day per townsperson, for the farm');
  const r = actOk(s, 'folkGift', { npc, item: like }, { now: MONDAY + DAY });
  const step = evs(r, 'friendship')[0];
  assert.ok(step && CELEBRATIONS.has('friendship'));
  assert.equal(step.v, 2);
  const g = TOWNSFOLK.friendship.rewards[npc][0];
  if (g.decor) assert.equal(s.farm.storage[g.decor], 1);
  let d = 2;
  for (; friendshipOf(s, npc) < TOWNSFOLK.friendship.max; d++) actOk(s, 'folkGift', { npc, item: like }, { now: MONDAY + d * DAY });
  assert.equal(d, TOWNSFOLK.friendship.max, 'ten gifts on ten days');
  assert.equal(act(s, 'folkGift', { npc, item: like }, { now: MONDAY + 30 * DAY }).code, 'ALREADY_DONE',
    'best friends: no gift that would only cost the good');
  const cards = TOWNSFOLK.friendship.rewards[npc].filter((x) => x.card).map((x) => x.card);
  assert.deepEqual(s.farm.folk.cards[npc] ?? [], cards);
  assert.equal(s.farm.inventory[like], 20 - TOWNSFOLK.friendship.max, 'every gift left the Barn');
  const tomLike = npcOf('tom').likes[0];
  give(s, tomLike, 1);
  s.farm.keep[tomLike] = { n: 1, by: 'p2' };
  assert.equal(act(s, 'folkGift', { npc: 'tom', item: tomLike }, { now: MONDAY + 30 * DAY }).code, 'RESERVED');
  actOk(s, 'folkGift', { npc: 'tom', item: tomLike, confirm: ['RESERVED'] }, { now: MONDAY + 30 * DAY });
  valid(s);
});

test('a golden order befriends its giver (+1); a chain card from a townsperson +2', () => {
  const s = boardFarm();
  credit(s, [{ e: 'orderFilled', slot: 0, n: 1, coins: 1, xp: 1, acorns: 1, golden: true, giver: 'mabel', simple: false,
    value: 1, items: {}, helped: null }], { now: MONDAY + HOUR });
  assert.equal(friendshipOf(s, 'mabel'), TOWNSFOLK.friendship.goldenOrder);
  // F1 "The Barge Arrives" is Captain Reed's card
  s.farm.quests.active.f1 = { at: MONDAY, n: { 0: 2 } };
  credit(s, [{ e: 'bargeLoaded', i: 0, item: 'apple', qty: 1, coins: 1, xp: 1, helped: null }], { now: MONDAY + HOUR });
  assert.ok(s.farm.quests.done.f1);
  assert.equal(friendshipOf(s, 'reed'), TOWNSFOLK.friendship.chainQuest);
  valid(s);
});

test('a "Need help" flag on a request: the OTHER player filling it adds 10 % XP and a Heart each', () => {
  const s = boardFarm();
  const p = s.farm.folk.posts['0'];
  actOk(s, 'folkFlag', { i: 0, n: p.n }, { now: MONDAY + HOUR, pid: 'p1' });
  assert.equal(act(s, 'folkFlag', { i: 0, n: p.n }, { now: MONDAY + HOUR, pid: 'p2' }).code, 'OCCUPIED');
  for (const [i, q] of Object.entries(p.items)) give(s, i, q);
  const h1 = s.players.p1.hearts;
  const r = actOk(s, 'folkFill', { i: 0, n: p.n }, { now: MONDAY + HOUR, pid: 'p2' });
  assert.equal(evs(r, 'folkFilled')[0].xp, p.xp + Math.floor(p.xp / 10));
  assert.equal(evs(r, 'folkFilled')[0].helped, 'p1');
  assert.equal(s.players.p1.hearts, h1 + 1);
  assert.equal(s.farm.folk.posts['0'].flag, null);
  assert.equal(s.farm.stats.partnerFlagsFilled, 1);
  valid(s);
});

test('RC-11: handing in all three requests brings a fresh board at once, once a week', () => {
  const s = boardFarm();
  const fillAll = (now) => {
    for (const [k, p] of Object.entries(s.farm.folk.posts)) {
      if (p.done !== null) continue;
      for (const [item, q] of Object.entries(p.items)) give(s, item, q);
      actOk(s, 'folkFill', { i: Number(k), n: p.n }, { now });
    }
  };
  const first = Object.values(s.farm.folk.posts).map((p) => p.n);
  assert.ok(first.length > 0, 'the board posted');
  fillAll(MONDAY + HOUR);
  const second = Object.values(s.farm.folk.posts);
  assert.ok(second.length > 0 && second.every((p) => p.done === null && !first.includes(p.n)), 'a fresh board');
  assert.equal(s.farm.folk.r, s.farm.folk.w);
  fillAll(MONDAY + 2 * HOUR);
  assert.ok(Object.values(s.farm.folk.posts).every((p) => p.done !== null), 'only one refresh a week');
  valid(s);
  runDue(s, MONDAY + 7 * DAY);                        // next Monday: the usual new board
  assert.ok(Object.values(s.farm.folk.posts).every((p) => p.done === null));
});
