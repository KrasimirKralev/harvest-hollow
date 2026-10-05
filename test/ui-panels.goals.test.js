// ui-panels: the Journal's and the Order Board's view models (public/js/ui/panels/goals-model.js) on a farm built
// through the real rules: letters, ribbons, mastery, the ledger, the feed, the week, and Mabel's board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyFarm, act, due, MIN, HOUR } from './helpers/ui-panels.js';
import { live, questOf, ORDERS, DAILY_GIFT, COUPLE_CHALLENGE } from '../shared/content/index.js';
import { LEDGER_MAX } from '../shared/content/config.js';
import * as questsA from '../shared/rules/actions/quests.js';
import * as ordersA from '../shared/rules/actions/orders.js';
import * as G from '../public/js/ui/panels/goals-model.js';
import { I } from '../public/js/ui/panels/intents.js';

const NOW = 1_800_000_000_000;
const farm = () => storyFarm({ now: NOW });

test('letters: active cards with the rules\' task progress, giver portraits, rewards; answered ones newest first', () => {
  const { state: s } = farm();
  const v = G.storyView(s, NOW);
  // Letters lists chains A-E; the side chains (F, G, H) sit on This week / Together (GDD §5.3)
  assert.deepEqual(v.active.map((q) => q.id).sort(),
    Object.keys(s.farm.quests.active).filter((id) => G.questTab(questOf(id)) === 'story').sort());
  for (const q of v.active) {
    assert.ok(q.letter && q.letter.greeting, `${q.id} has its letter`);
    assert.ok(q.giver && q.giver.portrait, `${q.id} has a giver portrait`);
    q.tasks.forEach((t, i) => {
      const p = questsA.taskProgress(s, q.id, i, NOW);
      if (t.verb === 'fill') assert.equal(t.have, Math.floor(p.have / 4));
      else assert.equal(t.have, p.have, `${q.id} task ${i}`);
      assert.equal(t.done, p.done);
      assert.doesNotMatch(t.line, /undefined|_/, t.line);
    });
    assert.equal(q.coins, questOf(q.id).coins);
  }
  const done = v.done.map((q) => q.at);
  assert.deepEqual(done, [...done].sort((a, b) => b - a));
  assert.ok(v.done.every((q) => q.finished && q.tasks.every((t) => t.done)));
});

test('task lines read as English for every live quest', () => {
  for (const q of live('quests')) {
    for (const t of q.tasks) {
      const line = G.taskLine(t);
      assert.doesNotMatch(line, /undefined|null|_/, `${q.id}: ${line}`);
    }
  }
  assert.equal(G.counted(3, 'egg'), '3 Eggs');
  assert.equal(G.counted(6, 'wheat'), '6 Wheat');
  assert.equal(G.counted(1, 'wooden_crate'), '1 Wooden Crate');
  assert.equal(G.counted(2, 'wooden_crate'), '2 Wooden Crates');
  assert.equal(G.counted(4, 'strawberry'), '4 Strawberries');
  assert.equal(G.rewardPhrases({ acorns: 5, hearts: 2, items: { compost: 6 } }).join(', '), '5 Acorns, 2 Hearts each, 6 Compost');
});

test('ribbons: every live ribbon, hidden ones stay secret until earned, tiers and next thresholds', () => {
  const { state: s } = farm();
  const rows = G.ribbonsView(s, 'p1');
  assert.equal(rows.length, live('ribbons').length);
  for (const r of rows) {
    if (r.hidden) { assert.equal(r.name, undefined, 'a secret ribbon shows no name'); continue; }
    assert.equal(r.next, r.tier < r.tiers.length ? r.tiers[r.tier] : null);
    assert.ok(r.pct >= 0 && r.pct <= 1);
  }
  s.farm.ribbons.cream_of_the_crop = { t: 1, at: NOW, by: 'p1' };
  const v = G.ribbonsView(s, 'p1').find((r) => r.id === 'cream_of_the_crop');
  assert.equal(v.tier, 1);
  assert.equal(v.next, v.tiers[1]);
  assert.equal(G.ribbonWall(s).points >= 1, true);
});

test('mastery book: only unlocked defs, stars from the content thresholds', () => {
  const { state: s } = farm();
  s.farm.mastery.wheat = 260;
  const b = G.masteryBook(s);
  const wheat = b.families.find((f) => f.id === 'crops').rows.find((r) => r.id === 'wheat');
  assert.equal(wheat.stars, 2);
  assert.equal(wheat.next, 750);
  for (const f of b.families) for (const r of f.rows) assert.ok(r.pct >= 0 && r.pct <= 1, r.id);
});

test('ledger: newest first, neutral words, one line per stroke', () => {
  const { state: s } = farm();
  const plots = Object.keys(s.farm.objects).sort().filter((id) => s.farm.objects[id].def === 'plot');
  // a fresh planting stroke by p2: harvest-free plots get re-planted after a harvest below
  const t = NOW + 3 * HOUR;
  due(s, t);
  for (const id of plots) act(s, 'harvest', { id }, { now: t, pid: 'p2' });
  for (const id of plots.slice(0, 6)) act(s, 'plant', { id, crop: 'wheat' }, { now: t + 1000, pid: 'p2' });
  const rows = G.ledgerView(s, 200);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].i > rows[i].i, 'newest first');
  const seeds = rows.find((r) => r.reason === 'seed' && r.by === 'p2');
  assert.ok(seeds && seeds.count >= 6, 'the six plantings of one stroke are one line');
  for (const r of rows) assert.doesNotMatch(r.text, /undefined|:/, r.text);
  assert.equal(G.ledgerText('wish:in'), 'Set aside for the Wishlist');
  assert.equal(G.ledgerText('slot:bakery'), 'A new slot for the Bakery');
  assert.equal(G.ledgerText('buy:cow'), 'Bought a Cow');
  assert.equal(G.ledgerText('buy:bakery'), 'Bought the Bakery');
  assert.ok(rows.length <= LEDGER_MAX);
});

test('feed: every row kind the rules write reads as a sentence', () => {
  const kinds = [
    { k: 'harvest', item: 'wheat', q: 24, p: 12 }, { k: 'tree', item: 'apple', q: 5 }, { k: 'collect', item: 'egg', q: 3 },
    { k: 'tend', q: 4 }, { k: 'craft', item: 'bread', q: 2 }, { k: 'sell', item: 'egg', q: 3, c: 246 },
    { k: 'order', c: 2008, x: 62, g: true }, { k: 'level', level: 7 }, { k: 'buy', def: 'bakery', c: 2600 },
    { k: 'expand', def: 'creekside' }, { k: 'ribbon', id: 'cream_of_the_crop', t: 1 }, { k: 'quest', id: 'a1' },
    { k: 'keepsake', item: 'sunflower', to: 'p2' }, { k: 'note', x: 3, z: 4 }, { k: 'golden' }, { k: 'hf', a: 'p1', b: 'p2' },
    { k: 'gift', day: 3 }, { k: 'chest', what: 'meter', i: 0 }, { k: 'name', what: 'farm', text: 'Clover Hill' },
    { k: 'wish', what: 'deposit', c: 500 }, { k: 'wish', what: 'bought', def: 'bakery', c: 2600 }, { k: 'keep', item: 'egg', q: 4 },
    { k: 'keep', item: 'egg', q: 0 },
  ];
  for (const row of kinds) assert.doesNotMatch(G.feedText(row), /undefined|null|NaN/, row.k);
  const { state: s } = farm();
  const v = G.feedView(s);
  assert.ok(v.length > 0 && v.every((x) => Number.isSafeInteger(x.i)));
});

test('this week: gift calendar, Farm Weeks, the Almanac and the Together task', () => {
  const { state: s } = farm();
  const g = G.giftView(s, NOW);
  assert.equal(g.days.length, DAILY_GIFT.days.length);
  assert.equal(g.claimed, false);
  assert.equal(g.days.filter((d) => d.today).length, 1);
  assert.ok(act(s, 'claimGift', {}, { now: NOW }).ok);
  const g2 = G.giftView(s, NOW);
  assert.equal(g2.claimed, true);
  const a = G.almanacView(s, 'p1');
  assert.equal(a.open, true);
  assert.ok(a.tasks.length > 0 && a.tasks.every((t) => !/undefined/.test(t.line)));
  assert.ok(a.together && a.together.qty > 0);
  const c = G.challengeView(s);
  assert.equal(c.unlock, COUPLE_CHALLENGE.unlock);
  assert.ok(G.weeksView(s).minDays > 0);
});

test('Mabel\'s board: slots in order, shortfall and the instant-refill price from the rules', () => {
  const { state: s } = farm();
  const slots = G.boardSlots(s);
  assert.deepEqual(slots.map((x) => x.i), [...slots.map((x) => x.i)].sort((a, b) => a - b));
  for (const x of slots.filter((y) => y.order)) {
    const want = Object.entries(ordersA.orderShortfall(s, x.order)).map(([item, n]) => ({ item, n }));
    assert.deepEqual(G.shortfall(s, x.order), want);
  }
  const ready = slots.find((x) => x.order && G.shortfall(s, x.order).length === 0);
  if (ready) {
    // the panel's own intent: the slot AND the order the player saw (RC-07)
    const it = I.fillOrder(ready.i, ready.order.n);
    assert.ok(act(s, it.type, it.args, { now: NOW }).ok, 'a slot the board shows as ready really fills');
  }
  assert.equal(G.rushPrice(s, NOW), 0, 'the first refill of a day is free');
  const waiting = G.boardSlots(s).find((x) => !x.order);
  if (waiting) {
    assert.ok(act(s, 'orderRush', { slot: waiting.i }, { now: NOW + MIN }).ok);
    assert.equal(G.rushPrice(s, NOW + MIN), ORDERS.refillAcorns);
  }
});

test('dock badges: deliverable orders, a letter or gift waiting, an overflowing barn', async () => {
  const { badgesFor } = await import('../public/js/ui/panels/badges.js');
  const { state: s } = farm();
  const b = badgesFor(s, 'p1', NOW);
  const ready = G.boardSlots(s).filter((x) => x.order && G.shortfall(s, x.order).length === 0).length;
  assert.equal(b.orders, ready || null);
  assert.equal(b.journal, '!', 'the Daily Gift of the day is still closed');
  assert.equal(b.barn, null);
  s.farm.overflow.wheat = 500;
  assert.equal(badgesFor(s, 'p1', NOW).barn, '!');
  assert.deepEqual(badgesFor(null, 'p1', NOW), { orders: null, journal: null, barn: null, market: null });
  // the partner asks to use the coins of my wish: the Market says "!" for me, not for the one who asked (UI-10)
  s.farm.wishlist = { 'w.1': { def: 'bakery', coins: 300, by: 'p1', at: NOW, release: { by: 'p2', at: NOW } } };
  assert.equal(badgesFor(s, 'p1', NOW).market, '!');
  assert.equal(badgesFor(s, 'p2', NOW).market, null);
});

test('story beats: a finished chapter keeps its story, read per player', () => {
  const { state: s } = storyFarm({ now: NOW, level: 11 });
  const v = G.storyView(s, NOW);
  const beat = v.beats.find((b) => b.id === 'two_pairs');
  assert.ok(beat, 'A11 done keeps "Two Pairs of Hands"');
  assert.ok(beat.text.length > 20 && beat.from);
  assert.equal(G.beatSeen(s, 'p1', 'two_pairs'), false);
  assert.ok(act(s, 'markSeen', { kind: 'beat', id: 'two_pairs' }, { now: NOW, pid: 'p1' }).ok);
  assert.equal(G.beatSeen(s, 'p1', 'two_pairs'), true);
  assert.equal(G.beatSeen(s, 'p2', 'two_pairs'), false, 'seen flags are per player');
});
