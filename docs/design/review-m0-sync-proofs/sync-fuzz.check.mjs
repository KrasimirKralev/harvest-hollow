// CHECK (green today): 2000 random two-client runs with partial delivery, socket drops (a random prefix of
// the in-flight frames survives), reconnect welcomes, resyncs, clock jumps and +-400 ms client clock skew.
// Asserts convergence, drained pending and exactly-once per (cid, seq). Run: node docs/design/review-m0-sync-proofs/sync-fuzz.check.mjs
import { coopHarness, mulberry32, plain } from '../../../test/helpers.js';
import { cropOf } from '../../../shared/content/index.js';
import assert from 'node:assert/strict';
const W = cropOf('wheat');
let fails = 0;
for (let run = 0; run < 2000; run++) {
  const rnd = mulberry32(run + 1);
  const h = coopHarness({ seed: run });
  const applied = new Map();
  const realCommit = h.engine.commit.bind(h.engine);
  h.engine.commit = (tx, meta) => { if (meta.pid !== 'sys') { const k = `${meta.cid}.${meta.seq}`; applied.set(k, (applied.get(k) || 0) + 1); } return realCommit(tx, meta); };
  h.a.skew = Math.floor(rnd()*800)-400; h.b.skew = Math.floor(rnd()*800)-400;
  const ids = Object.keys(h.state.farm.objects).slice(0, 4);
  try {
    for (let step = 0; step < 120; step++) {
      const c = rnd() < 0.5 ? h.a : h.b;
      const r = rnd();
      if (r < 0.35) {
        const id = ids[Math.floor(rnd() * ids.length)];
        const t = rnd();
        if (t < 0.4) c.store.act('plant', { id, crop: 'wheat' });
        else if (t < 0.8) c.store.act('harvest', { id });
        else c.store.act('sell', { item: 'wheat', qty: 1 });
      } else if (r < 0.55) h.deliverToServer(c, 1 + Math.floor(rnd() * 3));
      else if (r < 0.75) h.deliverToClient(c, 1 + Math.floor(rnd() * 3));
      else if (r < 0.80) {                       // socket drop + reconnect
        const keep = Math.floor(rnd() * (c.toServer.length + 1));
        h.deliverToServer(c, keep);
        c.toServer.length = 0; c.toClient.length = 0;
        h.engine.client(c.cid, c.pid, h.clock.now());
        c.store.reset(h.welcome(c));
      } else if (r < 0.83) { if (!c.store.resyncing) c.store.requestResync(); }
      else h.clock.advance(Math.floor(rnd() * W.growMs / 2));
    }
    h.flush();
    const s = plain(h.state);
    assert.deepEqual(plain(h.a.store.state), s);
    assert.deepEqual(plain(h.b.store.state), s);
    assert.equal(h.a.store.pending.length + h.b.store.pending.length, 0);
    for (const [k, n] of applied) assert.equal(n, 1, `applied twice ${k}`);
  } catch (e) { fails++; if (fails < 4) console.log('run', run, e.message.split('\n')[0]); }
}
console.log('fuzz runs 2000, failures', fails);
