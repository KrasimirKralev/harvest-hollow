// Release 1.0 integration: why `npm run test:e2e` step "M2: the duel runs on both screens" flaked (once before the
// wave). The step waited until both pages showed `duel.cur.ok`, then compared the two pages' `farm.duel` once. The
// accepting page shows `ok` at once from its own prediction (SyncStore.act), with `start` = its clock estimate; the
// server's delta carries the server's `start`. A snapshot taken before the accept's ack is that prediction, so the
// comparison failed whenever the ack was slower than the poll (a loaded machine). tools/e2e-coop.mjs now waits for
// both pages to have nothing pending, then compares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coopHarness } from './helpers.js';
import { xpForLevel, DUEL } from '../shared/content/index.js';

test('a predicted duel accept differs from the confirmed one until its ack; nothing pending = the same on both', () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) s.farm.xp = xpForLevel(DUEL.unlock + 1);
  const kind = DUEL.kinds.find((k) => (k.unlock ?? 1) <= DUEL.unlock + 1).id;
  assert.equal(h.a.store.act('duelInvite', { kind }).ok, true);
  h.flush();
  assert.equal(h.b.store.state.farm.duel.cur?.ok, false, 'B sees the invitation');

  assert.equal(h.b.store.act('duelAccept', {}).ok, true);
  h.clock.advance(40);                      // the accept reaches the server 40 ms after B predicted it
  h.deliverToServer(h.b);
  h.deliverToClient(h.a);                   // A has the server's delta; B's ack is still on its way
  const [a, b] = [h.a.store.state.farm.duel, h.b.store.state.farm.duel];
  assert.ok(a.cur.ok && b.cur.ok, 'both pages already show the duel running (the old wait condition)');
  assert.equal(h.b.store.pending.length, 1, 'B still has its accept pending');
  assert.notEqual(JSON.stringify(a), JSON.stringify(b), 'the old one-shot comparison fails here: B shows its prediction');
  assert.equal(b.cur.start + 40, a.cur.start, 'the difference is the predicted start');

  h.flush();
  assert.equal(h.b.store.pending.length, 0);
  assert.equal(JSON.stringify(h.a.store.state.farm.duel), JSON.stringify(h.b.store.state.farm.duel),
    'once nothing is pending the two screens agree');
});
