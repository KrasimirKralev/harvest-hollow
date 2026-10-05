// CHECK: client rebase cost per confirmed delta vs pending count. Run: node docs/design/review-m0-sync-proofs/rebase-cost.check.mjs
import { coopHarness } from '../../../test/helpers.js';
import { performance } from 'node:perf_hooks';
const h = coopHarness();
// give A lots of coins and plots: place 0 needed; use sell? use plant on 8 plots + harvest... use 'place' (cap 12). Use sells of 1 wheat after a big inventory.
h.state.farm.inventory.wheat = 5000; h.state.farm.wallet.coins = 1e6;
for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
for (const n of [10, 50, 100]) {
  for (let i = 0; i < n; i++) h.a.store.act('sell', { item: 'wheat', qty: 1 });
  // server processes all; deliver deltas one by one to A, timing each onServer
  h.deliverToServer(h.a);
  const t0 = performance.now(); let k = 0;
  while (h.a.toClient.length) { h.deliverToClient(h.a, 1); k++; }
  const dt = performance.now() - t0;
  h.flush();
  console.log(`pending ${n}: ${k} deltas confirmed in ${dt.toFixed(1)} ms total (${(dt / k).toFixed(3)} ms each)`);
}
