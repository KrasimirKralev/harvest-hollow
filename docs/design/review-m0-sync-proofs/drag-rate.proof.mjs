// PROOF (review-m0 M2): a GDD §7.1 drag-paint stroke with the 3x3 brush is rate-limited by the server
// and, if long enough, disconnects the player. Nothing on the client paces acts to the server bucket
// (act 40/s burst 120): socket.js sends whatever the store produces. Every RATE rejection rolls back an
// already-shown prediction (plant/harvest pops back) AND counts as abuse; 300 in 10 s close the socket
// (router.js:303). Model: 3x3 brush over a field at 10 tiles/s = 90 acts/s for 10 s (a 30x30 field).
// Run: node --test docs/design/review-m0-sync-proofs/drag-rate.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, join } from '../../../test/helpers.js';
import { MSG, ERR } from '../../../shared/net/protocol.js';

test('a 10 s drag-paint stroke at 90 acts/s is neither rolled back nor disconnected', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1');
    let seq = 0;
    for (let tick = 0; tick < 100; tick++) {             // one frame every 100 ms, 9 cells each
      const list = [];
      for (let k = 0; k < 9; k++) list.push({ seq: ++seq, type: 'sell', args: { item: 'wheat', qty: 1 } });
      c.send({ t: 'acts', list });
      await new Promise((r) => setTimeout(r, 100));
      if (c.ws.readyState !== 1) break;
    }
    await new Promise((r) => setTimeout(r, 200));
    const rate = c.msgs.filter((m) => m.t === MSG.REJ && m.code === ERR.RATE).length;
    const closed = c.ws.readyState !== 1;
    const code = closed ? await c.closed : null;
    console.log(`OBSERVED sent ${seq} acts: ${rate} RATE rejections (= rolled-back predictions); socket closed=${closed} code=${code}`);
    if (!closed) c.close();
    assert.equal(rate, 0, 'no prediction rolled back by the rate limiter');
    assert.equal(closed, false, 'the painter is not disconnected');
  } finally {
    await s.close();
  }
});
