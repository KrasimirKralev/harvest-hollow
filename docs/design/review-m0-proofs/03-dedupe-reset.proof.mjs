// PROOF (RED on M0): the exactly-once record (server.clients[cid]) is silently reset to lastSeq 0 when a hello
// arrives with the same cid for a different pid (cid is client-chosen), or after the 24 h prune. A re-sent
// action that was already applied then runs a second time.
// Run: node --test docs/design/review-m0-proofs/03-dedupe-reset.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coopHarness } from '../../../test/helpers.js';

test('an already-applied (cid, seq) is never applied twice', () => {
  const h = coopHarness();
  const t = h.clock.now();
  const p1 = { pid: 'p1', cid: 'aaaaaa' };
  // p1 harvests some wheat to have something to sell
  for (let i = 0; i < 4; i++) h.engine.act(p1, { seq: i + 1, type: 'plant', args: { id: `home.0.${i}`, crop: 'wheat' } });
  h.clock.advance(60_000);
  for (let i = 0; i < 4; i++) h.engine.act(p1, { seq: i + 5, type: 'harvest', args: { id: `home.0.${i}` } });
  const sell = { seq: 9, type: 'sell', args: { item: 'wheat', qty: 4 } };
  assert.equal(h.engine.act(p1, sell), null);                         // accepted once
  const coinsAfterOne = h.state.farm.wallet.coins;
  // Another socket says hello with p1's cid but as p2 (sessions.hello -> engine.client(cid, pid)) ...
  h.engine.client('aaaaaa', 'p2', t);
  // ... then p1 reconnects with its cid: the record is recreated with lastSeq 0, welcome.lastSeq = 0,
  // and SyncStore.reset() re-sends every pending action whose ack was lost.
  h.engine.client('aaaaaa', 'p1', t);
  const again = h.engine.act(p1, sell);
  console.log('re-sent seq 9 ->', again ?? 'ACCEPTED AGAIN', '| coins once', coinsAfterOne, '| now', h.state.farm.wallet.coins);
  assert.notEqual(again, null, 'seq 9 was executed a second time');
});

test('the 24 h prune forgets lastSeq of a cid whose tab is still open', () => {
  const h = coopHarness();
  const p1 = { pid: 'p1', cid: 'aaaaaa' };
  h.engine.act(p1, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
  h.clock.advance(25 * 3600_000);                    // laptop asleep for a day, tab still open
  h.engine.pruneClients(h.clock.now());
  const rec = h.engine.client('aaaaaa', 'p1', h.clock.now());
  console.log('lastSeq after prune + hello:', rec.lastSeq);
  assert.equal(rec.lastSeq, 1, 'the dedupe floor was lost; pending seq <= 1 would be re-run');
});
