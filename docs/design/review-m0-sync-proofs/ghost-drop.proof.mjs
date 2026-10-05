// PROOF (review-m0 M5): the partner's build ghost freezes on a stale tile. controller.js sends a `ghost`
// frame on EVERY hovered-tile change (no GHOST_HZ throttle; LIMITS.GHOST_HZ is unused), the server drops
// frames over its bucket (ghost 12/s burst 12) silently, and the client never re-sends the latest state
// (it dedupes on the last SENT value). A quick sweep across the field leaves the partner's ghost where the
// bucket ran dry, not under the builder's cursor.
// Run: node --test docs/design/review-m0-sync-proofs/ghost-drop.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, join } from '../../../test/helpers.js';
import { MSG } from '../../../shared/net/protocol.js';

test("after a fast sweep the partner sees the builder's final ghost position", async () => {
  const s = await testServer();
  try {
    const a = await join(s.port, 'p1');
    const b = await join(s.port, 'p2');
    for (let x = 10; x < 40; x++) {                      // 30 tiles crossed in 0.5 s (one per 60 Hz frame)
      a.c.send({ t: 'ghost', g: { def: 'plot', x, z: 30, rot: 0 } });
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 300));
    const seen = b.c.msgs.filter((m) => m.t === MSG.GHOST && m.pid === 'p1');
    const last = seen.at(-1)?.g?.x;
    console.log(`OBSERVED builder stopped at x=39; partner received ${seen.length}/30 ghost frames, last x=${last}`);
    a.c.close(); b.c.close();
    assert.equal(last, 39);
  } finally {
    await s.close();
  }
});
