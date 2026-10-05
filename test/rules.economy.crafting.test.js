// Production buildings (GDD §3.3 Feed Mill classes, §3.5 rules 1-10, §6.2 #7 duets, §9 #5, #16, #36-#39).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { recipeOf, feedOf, defOf, classMembers, COOP, MARKET } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { inputsFor, slotPrice } from '../shared/rules/actions/crafting.js';
import { available, mulBp, cutMs } from '../shared/rules/economy.js';
import { run, must, T0, farmAt, give, placeDef, evs, allLand, MIN } from './helpers/rules.js';

function bakeryFarm(level = 10) {
  const s = farmAt(level);
  allLand(s);
  const id = placeDef(s, 'bakery', { confirm: ['BIG_SPEND'] });
  return { s, id };
}

test('craft: inputs consumed at queueing, sequential timing, slots cap queued + finished goods', () => {
  const { s, id } = bakeryFarm(4);
  const bread = recipeOf('bread');
  give(s, 'flour', 5);
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 });
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 + MIN });
  const q = s.farm.objects[id].queue;
  assert.deepEqual(q.map((x) => [x.s, x.e]), [[T0, T0 + bread.ms], [T0 + bread.ms, T0 + 2 * bread.ms]]);
  assert.equal(available(s, 'flour'), 3, 'inputs leave the Barn at once (§9 #16)');
  assert.equal(run(s, 'craft', { id, recipe: 'bread' }).code, ERR.QUEUE_FULL);
  assert.equal(run(s, 'craft', { id, recipe: 'flour' }).code, ERR.BAD_ARGS, 'flour is made at the Windmill');
  assert.equal(run(s, 'craft', { id, recipe: 'cookies' }).code, ERR.LOCKED);
  assert.equal(run(s, 'craft', { id, recipe: 'nonsense' }).code, ERR.BAD_ARGS);
  assert.equal(run(s, 'craft', { id: 'home.0.0', recipe: 'bread' }).code, ERR.NOT_FOUND);
  assert.deepEqual(validateState(s), []);
});

test('collectTray: finished goods in order into the Barn, XP per item, "first" once; waits at 2 x capacity', () => {
  const { s, id } = bakeryFarm(4);
  const bread = recipeOf('bread');
  give(s, 'flour', 2);
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 });
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 });
  assert.equal(run(s, 'collectTray', { id }, { now: T0 + bread.ms - 251 }).code, ERR.NOT_READY);
  const r = must(s, 'collectTray', { id }, { now: T0 + bread.ms });
  assert.equal(evs(r, 'crafted').length, 1, 'only the finished one');
  assert.equal(evs(r, 'crafted')[0].first, true);
  assert.equal(evs(r, 'crafted')[0].xp, bread.xp);
  assert.equal(s.farm.objects[id].queue.length, 1);
  s.farm.inventory.wheat = MARKET.barn.start - (s.farm.inventory.bread ?? 0);
  s.farm.overflow.wheat = MARKET.barn.start;
  assert.equal(run(s, 'collectTray', { id }, { now: T0 + 2 * bread.ms }).code, ERR.STORAGE_FULL);
  s.farm.overflow.wheat -= 1;
  const r2 = must(s, 'collectTray', { id }, { now: T0 + 2 * bread.ms });
  assert.equal(evs(r2, 'crafted')[0].first, false);
  assert.equal(s.farm.objects[id].made, 2);
});

test('cancel: only items not yet started; inputs back in full; later items re-time', () => {
  const { s, id } = bakeryFarm(10);
  give(s, 'flour', 3);
  give(s, 'egg', 3);
  give(s, 'sugar', 1);
  must(s, 'upgradeSlot', { id });
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 });
  must(s, 'craft', { id, recipe: 'cookies' }, { now: T0 });
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 });
  const q0 = s.farm.objects[id].queue;
  assert.deepEqual(q0.map((q) => q.k), [0, 1, 2], 'every queue item has a stable key');
  assert.equal(run(s, 'cancel', { id, k: q0[0].k }, { now: T0 + 1 }).code, ERR.ALREADY_DONE, 'started: in the pot');
  assert.equal(run(s, 'cancel', { id, k: 5 }).code, ERR.NOT_FOUND);
  assert.equal(run(s, 'cancel', { id, index: 1 }).code, ERR.BAD_ARGS, 'never by index (RC-06)');
  const r = must(s, 'cancel', { id, k: q0[1].k }, { now: T0 + 1 });
  assert.deepEqual(evs(r, 'cancelled')[0].recipe, 'cookies');
  assert.equal(available(s, 'sugar'), 1);
  assert.equal(available(s, 'egg'), 3);
  const q1 = s.farm.objects[id].queue;
  assert.equal(q1.length, 2);
  assert.equal(q1[1].s, q0[0].e, 'the bread behind it moved up');
  assert.equal(q1[1].e - q1[1].s, q0[2].e - q0[2].s);
  assert.deepEqual(q1.map((q) => q.k), [0, 2], 'keys survive the re-timing');
  assert.deepEqual(validateState(s), []);
  // a stale or simultaneous second cancel of the same item answers NOT_FOUND and never removes another item (RC-06)
  assert.equal(run(s, 'cancel', { id, k: q0[1].k }, { now: T0 + 1 }).code, ERR.NOT_FOUND);
  assert.equal(s.farm.objects[id].queue.length, 2);
  must(s, 'craft', { id, recipe: 'cookies' }, { now: T0 + 1 });
  assert.equal(s.farm.objects[id].queue.at(-1).k, 3, 'a new item never re-uses a cancelled key');
});

test('Feed Mill: classes take the cheapest members first, skip kept units and "not for feed" items', () => {
  const s = farmAt(7);
  allLand(s);
  const mill = placeDef(s, 'feed_mill');
  const grain = classMembers('grain');
  assert.equal(grain[0], 'wheat');
  give(s, 'wheat', 2);
  give(s, 'corn', 5);
  assert.deepEqual(inputsFor(s, feedOf('chicken_feed')), { wheat: 2, corn: 1 });
  must(s, 'keep', { item: 'wheat', n: 1 });
  assert.deepEqual(inputsFor(s, feedOf('chicken_feed')), { wheat: 1, corn: 2 });
  must(s, 'noFeed', { item: 'wheat', on: true });
  assert.deepEqual(inputsFor(s, feedOf('chicken_feed')), { corn: 3 });
  assert.equal(run(s, 'noFeed', { item: 'egg', on: true }).code, ERR.BAD_ARGS, 'eggs are no feed ingredient');
  must(s, 'craft', { id: mill, recipe: 'chicken_feed' }, { now: T0 });
  const r = must(s, 'collectTray', { id: mill }, { now: T0 + feedOf('chicken_feed').ms });
  assert.equal(evs(r, 'crafted')[0].qty, feedOf('chicken_feed').out);
  assert.equal(available(s, 'chicken_feed'), feedOf('chicken_feed').out);
  // livestock feed needs 2 grain + 1 root
  give(s, 'carrot', 1);
  assert.deepEqual(inputsFor(s, feedOf('livestock_feed')), { corn: 2, carrot: 1 });
  assert.equal(inputsFor(s, { classes: [{ cls: 'root', qty: 2 }] }), null);
});

test('duet: the first press waits; the OTHER player within 3 s starts it at normal time, +25 % XP', () => {
  const { s, id } = bakeryFarm(10);
  const cake = recipeOf('sweetheart_cake');
  for (const [item, n] of Object.entries(cake.inputs)) give(s, item, n * 2);
  let r = must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p1', now: T0 });
  assert.equal(evs(r, 'duetPressed').length, 1);
  assert.equal(s.farm.objects[id].queue.length, 0, 'nothing consumed on a lone press');
  r = must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p1', now: T0 + 500 });
  assert.equal(s.farm.objects[id].joint.at, T0 + 500, 'the same player pressing again only refreshes (§9 #36)');
  r = must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p2', now: T0 + 500 + COOP.duet.windowMs });
  assert.equal(evs(r, 'duet').length, 0, 'the duet credit waits for the collect (RC-02)');
  const q = s.farm.objects[id].queue[0];
  assert.equal(q.duet, true);
  assert.deepEqual(q.pair, ['p1', 'p2']);
  assert.equal(q.e - q.s, cake.ms);
  const c = must(s, 'collectTray', { id }, { pid: 'p1', now: q.e });
  assert.equal(evs(c, 'crafted')[0].xp, cake.xp + mulBp(cake.xp, COOP.duet.xpBonusBp));
  assert.deepEqual(evs(c, 'duet'), [{ e: 'duet', id, building: 'bakery', recipe: 'sweetheart_cake', a: 'p1', b: 'p2',
    by: 'p1' }], 'paid once, when the cooked cake is collected');
  // a lapsed press starts over; alone the recipe slow-cooks in 2 x time with normal XP
  must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p1', now: T0 });
  must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p2', now: T0 + COOP.duet.windowMs + 1 });
  assert.equal(s.farm.objects[id].joint.by, 'p2');
  s.farm.objects[id].joint = undefined;
  delete s.farm.objects[id].joint;
  must(s, 'craft', { id, recipe: 'sweetheart_cake' }, { now: T0 + 10 * MIN });
  const slow = s.farm.objects[id].queue.at(-1);
  assert.equal(slow.slow, true);
  assert.equal(slow.e - slow.s, cake.ms * 2);
  assert.equal(run(s, 'duet', { id, recipe: 'bread' }).code, ERR.BAD_ARGS, 'bread is no duet');
});

test('slots: coins only, apply at once, up to the max', () => {
  const { s, id } = bakeryFarm(10);
  const def = defOf('bakery');
  for (let k = def.slots[0]; k < def.slots[1]; k++) {
    const p = slotPrice(s.farm.objects[id]);
    assert.equal(p, def.slotCosts[k - def.slots[0]]);
    const c = s.farm.wallet.coins;
    must(s, 'upgradeSlot', { id, confirm: ['BIG_SPEND'] });
    assert.equal(s.farm.wallet.coins, c - p);
  }
  assert.equal(run(s, 'upgradeSlot', { id }).code, ERR.CAP);
  assert.deepEqual(validateState(s), []);
});

test('recipe mastery ★2 cuts the time at queueing; ★3 doubles on its roll', () => {
  const { s, id } = bakeryFarm(10);
  s.farm.mastery.bread = recipeOf('bread').mastery[1];
  give(s, 'flour', 1);
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 });
  const q = s.farm.objects[id].queue[0];
  assert.equal(q.e - q.s, cutMs(recipeOf('bread').ms, 1000));
});

test('duet + cancel mints nothing: no Hearts, no duets stat, no Duet ribbon (RC-02)', () => {
  const { s, id } = bakeryFarm(10);
  const cake = recipeOf('sweetheart_cake');
  for (const [item, n] of Object.entries(cake.inputs)) give(s, item, n);
  give(s, 'flour', 3);
  must(s, 'craft', { id, recipe: 'bread' }, { now: T0 });
  const hearts = [s.players.p1.hearts, s.players.p2.hearts];
  let t = T0 + 1000;
  for (let round = 0; round < 3; round++) {
    must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p1', now: t });
    must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p2', now: t + 1000 });
    const k = s.farm.objects[id].queue[1].k;
    must(s, 'cancel', { id, k }, { pid: 'p1', now: t + 2000 });
    t += 5000;
  }
  assert.deepEqual([s.players.p1.hearts, s.players.p2.hearts], hearts);
  assert.equal(s.farm.stats.duets ?? 0, 0);
  assert.equal(s.farm.ribbons.duet, undefined);
  // a cooked duet still pays +1 Heart each, once
  must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p1', now: t });
  must(s, 'duet', { id, recipe: 'sweetheart_cake' }, { pid: 'p2', now: t + 1000 });
  const end = s.farm.objects[id].queue.at(-1).e;
  must(s, 'collectTray', { id }, { now: end });
  assert.deepEqual([s.players.p1.hearts - hearts[0], s.players.p2.hearts - hearts[1]], [COOP.duet.hearts, COOP.duet.hearts]);
  assert.equal(s.farm.stats.duets, 1);
});

test('Feed Mill: a member worth more than 10 x the feed is never burned without a confirm (RC-17)', () => {
  const s = farmAt(11);
  allLand(s);
  const mill = placeDef(s, 'feed_mill');
  give(s, 'sunflower', 3);
  const f = feedOf('chicken_feed');
  assert.equal(inputsFor(s, f), null, 'Sunflowers (335) are not grain for 2-coin feed by default');
  assert.deepEqual(inputsFor(s, f, { valuable: true }), { sunflower: 3 });
  assert.equal(run(s, 'craft', { id: mill, recipe: 'chicken_feed' }).code, ERR.RESERVED, 'asks first');
  must(s, 'craft', { id: mill, recipe: 'chicken_feed', confirm: ['RESERVED'] });
  assert.equal(available(s, 'sunflower'), 0, 'confirmed: the batch runs');
  // cheap grain is used without asking, and before any valuable member
  give(s, 'wheat', 3);
  give(s, 'sunflower', 3);
  assert.deepEqual(inputsFor(s, f), { wheat: 3 });
  const empty = farmAt(11);
  allLand(empty);
  const m2 = placeDef(empty, 'feed_mill');
  assert.equal(run(empty, 'craft', { id: m2, recipe: 'chicken_feed' }).code, ERR.NO_ITEMS);
});
