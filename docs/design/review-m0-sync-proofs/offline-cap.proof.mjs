// PROOF (review-m0 L3): tech §3.7 "While disconnected the client keeps predicting, capped at 100 pending
// actions or 30 s. After that it blocks input with a banner." LIMITS.MAX_OFFLINE_MS exists but nothing
// reads it: SyncStore has no notion of the connection, so a disconnected farmer keeps planting and
// selling for minutes; every prediction is later re-sent with a stale `now` and re-decided by the server
// (crops shown ripe offline become unripe again; sells and plants can bounce in a burst of toasts).
// Run: node --test docs/design/review-m0-sync-proofs/offline-cap.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coopHarness } from '../../../test/helpers.js';
import { ERR } from '../../../shared/net/protocol.js';

test('input blocks after 30 s of predicting while disconnected', () => {
  const h = coopHarness();
  h.a.store.send = () => {};                     // socket.raw() drops frames while disconnected
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.clock.advance(5 * 60_000);                   // five minutes offline
  const r = h.a.store.act('plant', { id: 'home.0.1', crop: 'wheat' });
  console.log(`OBSERVED act after 5 min offline -> ok=${r.ok} code=${r.code ?? '-'}; pending=${h.a.store.pending.length}`);
  assert.equal(r.ok, false);
  assert.notEqual(r.code, undefined);
  assert.ok([ERR.NOT_JOINED, ERR.RATE].includes(r.code) || r.code === 'OFFLINE');
});
