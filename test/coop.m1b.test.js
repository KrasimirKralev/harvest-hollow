// The M1b weekly systems over the real pipeline (one Engine, two SyncStores, a fake network): both screens race for
// the same barge crate and the last crate of a row (the row pays once), enter the Fair at the same moment, and both
// see the Sunday ceremony once; predictions converge with the server.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { dayOf } from '../shared/rules/coop.js';
import { fairCloseAt } from '../shared/rules/actions/fair.js';
import { coopHarness, plain } from './helpers.js';
import { put, forceM1bGoals, MONDAY, HOUR } from './helpers/rules-goals.js';

before(forceM1bGoals);

function converged(h) {
  const server = plain(h.state);
  assert.deepEqual(plain(h.a.store.state), server, 'A equals the server');
  assert.deepEqual(plain(h.b.store.state), server, 'B equals the server');
  assert.equal(h.a.store.pending.length, 0);
  assert.equal(h.b.store.pending.length, 0);
  assert.deepEqual(validateState(h.state), []);
}

function celebrations(store) {
  const out = [];
  store.on('celebrate', ({ ev }) => out.push(ev.e));
  return out;
}

/** A harness on Monday with an L16 farm, producers, a `made` log and goods: the Fair open, the barge docked. */
function weeklyHarness() {
  const h = coopHarness();
  h.clock.set(MONDAY + HOUR);
  const s = h.state;
  s.farm.xp = xpForLevel(16);
  for (let i = 0; i < 4; i++) put(s, 'apple_tree');
  for (const b of ['juice_press', 'dairy', 'bakery', 'feed_mill']) put(s, b);
  const pasture = put(s, 'pasture');
  for (let i = 0; i < 3; i++) put(s, 'sheep', { home: pasture });
  for (const it of ['apple', 'apple_juice', 'pumpkin', 'cheese', 'wool', 'potato']) s.farm.made[it] = dayOf(s, MONDAY);
  Object.assign(s.farm.inventory, { sweetheart_cake: 6, bread: 20 });
  h.engine.runDue();
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  assert.ok(s.farm.fair.cur?.open && s.farm.barge.docked && s.farm.barge.rows >= 1);
  return h;
}

test('two screens load the same crate and the last crate of a row at once: one wins, the row pays once', () => {
  const h = weeklyHarness();
  const celA = celebrations(h.a.store);
  const celB = celebrations(h.b.store);
  const b = h.state.farm.barge;
  for (const c of Object.values(b.crates)) h.state.farm.inventory[c.item] = (h.state.farm.inventory[c.item] ?? 0) + 2 * c.qty;
  for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
  // the same crate from both screens in the same instant
  assert.ok(h.a.store.act('bargeLoad', { i: 0 }).ok);
  assert.ok(h.b.store.act('bargeLoad', { i: 0 }).ok, 'B predicts it too');
  h.flush();
  assert.equal(h.state.farm.barge.crates['0'].by, 'p1');
  // the row's last two crates, one each, then both press the third: the row completes once
  assert.ok(h.b.store.act('bargeLoad', { i: 1 }).ok);
  h.flush();
  assert.ok(h.a.store.act('bargeLoad', { i: 2 }).ok);
  assert.ok(h.b.store.act('bargeLoad', { i: 2 }).ok);
  h.flush();
  converged(h);
  assert.deepEqual(Object.keys(h.state.farm.barge.paid), ['0']);
  assert.equal(h.state.farm.stats.bargeRows, 1);
  for (const cel of [celA, celB]) assert.equal(cel.filter((e) => e === 'bargeRow').length, 1, `row once: ${cel}`);
});

test('both enter at the Fair at once, the cap holds across screens, and both see the ceremony once', () => {
  const h = weeklyHarness();
  const celA = celebrations(h.a.store);
  const celB = celebrations(h.b.store);
  assert.ok(h.a.store.act('fairEnter', { item: 'sweetheart_cake', qty: 4 }).ok);
  assert.ok(h.b.store.act('fairEnter', { item: 'sweetheart_cake', qty: 2 }).ok);
  assert.ok(h.b.store.act('fairEnter', { item: 'bread', qty: 7 }).ok);
  assert.ok(h.a.store.act('fairEnter', { item: 'bread', qty: 7 }).ok, 'A predicts 7 more: the server refuses (CAP)');
  h.flush();
  converged(h);
  assert.equal(h.state.farm.fair.cur.ent.sweetheart_cake, 6);
  assert.equal(h.state.farm.fair.cur.ent.bread, 7);
  h.clock.set(fairCloseAt(h.state, h.state.farm.fair.cur.w));
  h.engine.runDue();
  h.flush();
  converged(h);
  assert.ok(h.state.farm.fair.last && h.state.farm.fair.last.medal);
  for (const cel of [celA, celB]) assert.equal(cel.filter((e) => e === 'fairCeremony').length, 1, `${cel}`);
});
