// PROOF (review-m0 L2): a prediction the server REJECTED, whose `rej` was lost in a disconnect, vanishes
// on reconnect without a 'reject' event. The server advances lastSeq on rejections too (engine.js:226),
// welcome carries that lastSeq, and reset() drops every pending seq <= lastSeq as "already applied"
// (sync.js:260). The player saw "+2 wheat" fly to the barn and it silently is not there: no toast,
// no "Mia got there first".
// Run: node --test docs/design/review-m0-sync-proofs/silent-reject.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coopHarness } from '../../../test/helpers.js';
import { cropOf } from '../../../shared/content/index.js';

test('a lost rej still surfaces as a reject event after the reconnect', () => {
  const h = coopHarness();
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();
  h.clock.advance(cropOf('wheat').growMs);
  const rejects = [];
  h.b.store.on('reject', (r) => rejects.push(r));
  h.a.store.act('harvest', { id: 'home.0.0' });
  h.b.store.act('harvest', { id: 'home.0.0' });
  h.deliverToServer(h.a);
  h.deliverToServer(h.b);                          // B's harvest -> rej EMPTY
  h.b.toClient.length = 0;                         // B's Wi-Fi drops: the rej and A's delta are lost
  h.b.store.reset(h.welcome(h.b));                 // reconnect
  h.flush();
  console.log(`OBSERVED B pending=${h.b.store.pending.length}, reject events=${rejects.length}`);
  assert.equal(rejects.length, 1, 'B is told its harvest did not happen');
});
