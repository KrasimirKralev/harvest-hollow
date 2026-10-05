// PROOF (review-m0 M1): the 24 h cid prune (engine.js:206, run by the heartbeat every 15 s) only looks at
// `seenAt`, which only an accepted/rejected ACT refreshes. (a) A tab that stays connected but idle for a
// day (the partner played, I only watched; a weekend with the laptop awake) loses its dedupe record while
// connected: every action is then rejected NOT_JOINED and `resync` throws a TypeError inside the router
// (welcome reads server.clients[cid].lastSeq), so the client cannot recover without a reload.
// (b) A client offline for > 24 h whose last actions were applied but never acknowledged gets
// welcome.lastSeq = 0 and re-sends them: they are applied a SECOND time (exactly-once broken).
// Run: node --test docs/design/review-m0-sync-proofs/prune-live-cid.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, join, coopHarness } from '../../../test/helpers.js';
import { MSG, ERR } from '../../../shared/net/protocol.js';
import { cropOf } from '../../../shared/content/index.js';

test('(a) a connected client keeps working after 25 h without acting', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1');
    s.hh.clock.warp(25 * 3600 * 1000);                     // a day passes (dev warp = the server's clock)
    s.hh.engine.pruneClients(s.hh.clock.now());            // what the 15 s heartbeat does
    c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    const reply = await c.next((m) => m.t === MSG.DELTA || m.t === MSG.REJ);
    c.send({ t: 'resync' });
    const w = await c.next((m) => m.t === MSG.WELCOME, 500).catch(() => null);
    console.log(`OBSERVED act -> ${reply.t}/${reply.code ?? ''}; resync -> ${w ? 'welcome' : 'nothing (router logged a TypeError)'}`);
    c.close();
    assert.equal(reply.t, MSG.DELTA);
    assert.ok(w, 'resync answered');
  } finally {
    await s.close();
  }
});

test('(b) an action applied before a > 24 h disconnect is not applied twice on reconnect', () => {
  const h = coopHarness();
  const WHEAT = cropOf('wheat');
  h.a.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  h.a.store.act('harvest', { id: 'home.0.0' });
  h.flush();
  const before = h.state.farm.inventory.wheat;
  h.a.store.act('sell', { item: 'wheat', qty: 1 });
  h.deliverToServer(h.a);                                  // the server sold it ...
  h.a.toClient.length = 0;                                 // ... the lid closed before the delta arrived
  h.clock.advance(25 * 3600 * 1000);
  h.engine.pruneClients(h.clock.now());
  h.engine.client(h.a.cid, h.a.pid, h.clock.now());        // hello on wake-up (sessions.js:105)
  h.a.store.reset(h.welcome(h.a));
  h.flush();
  const sold = before - (h.state.farm.inventory.wheat ?? 0);
  console.log(`OBSERVED one click on "Sell 1" sold ${sold} wheat`);
  assert.equal(sold, 1);
});
