// The goals systems over the real pipeline: one Engine (server) and two SyncStores (both screens) over a fake
// network. Predictions converge with the server after races; celebrations are confirmed-only and play once on each
// screen; system actions (orders, rollover) reach both screens through deltas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../shared/net/protocol.js';
import { cropOf, xpForLevel, ORDERS } from '../shared/content/index.js';
import { validateState } from '../shared/rules/state.js';
import { coopHarness, plain } from './helpers.js';

const WHEAT = cropOf('wheat');
const plots = (h) => Object.keys(h.state.farm.objects).filter((id) => h.state.farm.objects[id].def === 'plot').sort();

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
  store.on('celebrate', ({ ev }) => out.push(`${ev.e}:${ev.scope ?? ''}:${ev.level ?? ev.id ?? ev.kind ?? ''}`));
  return out;
}

/** Plant every plot from A, ripen, harvest every plot from B (B harvests A's plantings: the 40/60 split). */
function fieldRound(h) {
  for (const id of plots(h)) assert.ok(h.a.store.act('plant', { id, crop: 'wheat' }).ok);
  h.flush();
  h.clock.advance(WHEAT.growMs + 10);
  for (const id of plots(h)) assert.ok(h.b.store.act('harvest', { id }).ok);
  h.flush();
}

test('an evening start on two screens: quests, level-ups and the order board converge; celebrations once each', () => {
  const h = coopHarness();
  const celA = celebrations(h.a.store);
  const celB = celebrations(h.b.store);
  for (let r = 0; r < 3; r++) fieldRound(h);
  // a player action makes the server run what came due (the board opens at L2) before it applies
  h.a.store.act('markSeen', { kind: 'tip', id: 'sickle' });
  h.flush();
  converged(h);
  assert.ok(h.state.farm.quests.done.a1, 'A1 completed');
  assert.equal(Object.keys(h.state.farm.orders.slots).length, ORDERS.slots[0][1]);
  for (const cel of [celA, celB]) {
    assert.equal(cel.filter((c) => c === 'levelUp:farm:2').length, 1, `farm L2 once: ${cel}`);
    assert.equal(cel.filter((c) => c === 'questDone::a1').length, 1);
  }
  // personal XP: B harvested A's plantings (60 % of each harvest; Wheat's 1 XP leaves A's 40 % floored to 0) and
  // finished A1; the farm XP is the sum of both
  assert.ok(h.state.players.p2.xp > 0);
  assert.equal(h.state.farm.xp, h.state.players.p1.xp + h.state.players.p2.xp);
});

test('both fill / discard the same order in the same instant: first wins, both screens agree', () => {
  const h = coopHarness();
  for (let r = 0; r < 3; r++) fieldRound(h);
  h.a.store.act('markSeen', { kind: 'tip', id: 'sickle' });
  h.flush();
  const rejB = [];
  h.b.store.on('reject', (x) => rejB.push(x.code));
  const coins = h.state.farm.wallet.coins;
  const n = h.state.farm.orders.slots['0'].order.n;
  assert.ok(h.a.store.act('orderFill', { slot: 0, n }).ok);
  assert.ok(h.b.store.act('orderDiscard', { slot: 0, n }).ok, 'B predicts its discard');
  h.deliverToServer(h.a);
  h.deliverToServer(h.b);
  h.flush();
  converged(h);
  assert.deepEqual(rejB, [ERR.EMPTY], 'B lost the race gently');
  assert.ok(h.state.farm.wallet.coins > coins, 'the fill was paid once');
  assert.equal(h.state.farm.orders.slots['0'].order, null);
});

test('the Daily Gift claimed on both screens at once is paid once', () => {
  const h = coopHarness();
  h.state.farm.xp = xpForLevel(3);
  for (const c of [h.a, h.b]) { c.store.reset(h.welcome(c)); c.toClient.length = 0; }
  const coins = h.state.farm.wallet.coins;
  assert.ok(h.a.store.act('claimGift', {}).ok);
  assert.ok(h.b.store.act('claimGift', {}).ok);
  h.deliverToServer(h.a);
  h.deliverToServer(h.b);
  h.flush();
  converged(h);
  assert.equal(h.state.farm.daily.gift.n, 1);
  assert.ok(h.state.farm.wallet.coins > coins);
});

test('a new farm day reaches both screens as one rollover delta', () => {
  const h = coopHarness();
  h.state.farm.xp = xpForLevel(8);
  for (const c of [h.a, h.b]) { c.store.reset(h.welcome(c)); c.toClient.length = 0; }
  h.clock.advance(26 * 3_600_000);
  h.b.store.act('markSeen', { kind: 'tip', id: 'seed_bag' });
  h.flush();
  converged(h);
  for (const pid of ['p1', 'p2']) assert.equal(Object.keys(h.state.players[pid].almanac.tasks).length, 4);
  assert.ok(h.state.farm.daily.together);
});
