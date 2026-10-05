// PROOF (review-m0 M6): a journal append that throws (ENOSPC, EIO) after runAction has already mutated
// the state leaves a half-committed action: engine.commit() bumped `v` and applied the Tx, the append
// threw, so there is no broadcast, no rej, and no journal line. The sender's prediction stays pending,
// the partner sees a `v` gap (forced resync), and the journal now has a hole that stops any later
// crash-replay at that point (and H2 then deletes everything after it).
// Run: node --test docs/design/review-m0-sync-proofs/append-failure.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testServer, join, tmpDataDir } from '../../../test/helpers.js';
import { Persist } from '../../../server/persist.js';
import { loadFarm } from '../../../server/index.js';
import { MSG } from '../../../shared/net/protocol.js';

const quiet = { log() {}, info() {}, warn() {}, error() {} };

test('a failed journal append rejects the action atomically (no state change, a rej to the sender)', async () => {
  const s = await testServer();
  const copy = tmpDataDir('proof-append-copy');
  try {
    const a = await join(s.port, 'p1');
    const b = await join(s.port, 'p2');
    const vBefore = s.hh.engine.v;
    const real = s.hh.persist.append.bind(s.hh.persist);
    let fail = true;
    s.hh.persist.append = (line) => {
      if (fail) { fail = false; throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); }
      return real(line);
    };
    a.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    const answer = await a.c.next((m) => (m.t === MSG.DELTA || m.t === MSG.REJ) && m.seq === 1, 400).catch(() => null);
    const applied = Boolean(s.hh.engine.state.farm.objects['home.0.0'].crop);
    b.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
    const dB = await b.c.next((m) => m.t === MSG.DELTA && m.seq === 1 && m.by === 'p2');
    // what a crash right now would replay from:
    for (const f of fs.readdirSync(s.dataDir)) if (f.startsWith('farm.')) fs.copyFileSync(path.join(s.dataDir, f), path.join(copy, f));
    const re = loadFarm(new Persist(copy, { log: quiet }), { log: quiet });
    console.log(`OBSERVED sender got ${answer ? answer.t : 'NO answer'}; server applied it=${applied}; v ${vBefore} -> ${s.hh.engine.v};`
      + ` partner's next delta v=${dB.v} (gap from v${vBefore}); crash-replay now stops at v${re.engine.v} of ${s.hh.engine.v}`);
    a.c.close(); b.c.close();
    assert.ok(answer && answer.t === MSG.REJ, 'the sender is told');
    assert.equal(applied, false, 'nothing half-committed');
  } finally {
    await s.close();
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
