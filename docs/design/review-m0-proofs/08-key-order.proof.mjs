// PROOF (RED on M0): object key order is not part of the replicated state. A rolled-back action (INTERNAL) or a
// client rewind moves keys to the end, while journal replay (which never sees rejected actions) does not. Any rule
// that iterates Object.keys/entries order-dependently (feed mill "cheapest first" ties, "sell surplus: 20 lowest
// stacks", "first ready building") then decides differently live vs after a restart vs on the client.
// Run: node --test docs/design/review-m0-proofs/08-key-order.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../../server/engine.js';
import { createFarm } from '../../../shared/rules/state.js';
import { fakeClock, coopHarness } from '../../../test/helpers.js';

const quiet = { error() {}, warn() {}, info() {}, log() {} };

function boot(state, clock) {
  const journal = [];
  const engine = new Engine({ state, server: { clock: {}, clients: {}, auth: {} }, clock, log: quiet, journal: { append: (l) => journal.push(structuredClone(l)) } });
  return { engine, journal };
}

test('live state and journal replay agree on inventory key order after a rolled-back action', () => {
  const clock = fakeClock();
  const s0 = createFarm(7, clock.now());
  s0.farm.inventory = { wheat: 2, carrot: 3 };
  s0.farm.wallet.coins = Number.MAX_SAFE_INTEGER - 1;   // the next earn() throws -> INTERNAL -> rollback
  const snapshot = structuredClone(s0);
  const live = boot(s0, clock);
  live.engine.system('_join', { pid: 'p1', name: 'K' });
  live.engine.client('aaaaaa', 'p1', clock.now());
  const rej = live.engine.act({ pid: 'p1', cid: 'aaaaaa' }, { seq: 1, type: 'sell', args: { item: 'wheat', qty: 2 } });
  console.log('sell ->', rej.code, '| live inventory keys', Object.keys(s0.farm.inventory));
  const replayed = boot(structuredClone(snapshot), fakeClock());
  for (const line of live.journal) replayed.engine.replay(line);
  console.log('replayed inventory keys', Object.keys(replayed.engine.state.farm.inventory));
  const firstLive = Object.keys(s0.farm.inventory)[0];
  const firstReplay = Object.keys(replayed.engine.state.farm.inventory)[0];
  console.log(`an order-dependent rule ("first stack") picks ${firstLive} live and ${firstReplay} after restart`);
  assert.deepEqual(Object.keys(s0.farm.inventory), Object.keys(replayed.engine.state.farm.inventory));
});

test('a client whose predicted sell is rejected keeps the server key order', () => {
  const h = coopHarness();
  h.state.farm.inventory = { wheat: 2, carrot: 3 };
  for (const c of [h.a, h.b]) { c.store.reset(h.welcome(c)); c.toClient.length = 0; }
  h.a.store.act('sell', { item: 'wheat', qty: 2 });   // A predicts: the wheat key is deleted
  h.b.store.act('sell', { item: 'wheat', qty: 1 });   // B's sell reaches the server first
  h.deliverToServer(h.b); h.deliverToServer(h.a);     // A's is rejected NO_ITEMS (only 1 left)
  h.flush();
  const server = Object.keys(h.state.farm.inventory);
  const clientA = Object.keys(h.a.store.state.farm.inventory);
  console.log('server', server, h.state.farm.inventory, '| client A', clientA, h.a.store.state.farm.inventory);
  assert.deepEqual(clientA, server, 'same values, different key order on the client');
});
