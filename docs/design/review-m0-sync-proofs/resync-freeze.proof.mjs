// PROOF (review-m0 H3): a resync request that the server's bucket drops (router.js:360, 0.2/s burst 2)
// is never answered, and SyncStore never asks again (sync.js:268 `if (this.resyncing) return`): the client
// ignores every delta and refuses every action ("Connecting to the farm...") until the page reloads or the
// socket happens to reconnect. The trigger is any repeating divergence (a rules bug that makes deltas fail
// to apply): resync -> welcome -> next delta throws -> resync -> ... the third within ~10 s is dropped.
// Run: node --test docs/design/review-m0-sync-proofs/resync-freeze.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, join, coopHarness } from '../../../test/helpers.js';
import { MSG, ERR } from '../../../shared/net/protocol.js';

test('server: every resync request is answered with a welcome', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1');
    for (let i = 0; i < 3; i++) c.send({ t: 'resync' });
    await new Promise((r) => setTimeout(r, 400));
    const welcomes = c.msgs.filter((m) => m.t === MSG.WELCOME).length;
    console.log(`OBSERVED 3 resync requests -> ${welcomes} welcome(s)`);
    c.close();
    assert.equal(welcomes, 3);
  } finally {
    await s.close();
  }
});

test('client: a lost resync answer does not freeze the store forever', () => {
  const h = coopHarness();
  h.a.store.requestResync();
  h.a.toServer.length = 0;                       // the server's bucket dropped it (silently)
  h.b.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();                                     // minutes of play by the partner
  h.b.store.act('plant', { id: 'home.0.1', crop: 'wheat' });
  h.flush();
  h.a.store.requestResync();                     // any later trigger is swallowed too
  const r = h.a.store.act('plant', { id: 'home.0.2', crop: 'wheat' });
  console.log(`OBSERVED ready=${h.a.store.ready} v=${h.a.store.v} serverV=${h.engine.v} act=${r.code} framesSent=${h.a.toServer.length}`);
  assert.notEqual(r.code, ERR.NOT_JOINED, 'input works again');
  assert.equal(h.a.store.v, h.engine.v, 'A caught up');
});
