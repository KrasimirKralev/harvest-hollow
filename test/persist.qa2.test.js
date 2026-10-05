// QA wave 2, SV-04: the journal replay proof covers `_beauty` (Farm Beauty stars after placed decor settles), the one
// M1b system action the qa2 replay session (docs/qa/qa2/coop-weekly/s06-replay-all.mjs) never journaled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Persist } from '../server/persist.js';
import { loadFarm } from '../server/index.js';
import { validateState } from '../shared/rules/state.js';
import { canPlace } from '../shared/rules/grid.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { beautyOf } from '../shared/rules/actions/beauty.js';
import { levelRow, PLACEABLES } from '../shared/content/index.js';
import { tmpDataDir, plain, quiet, readJournal } from './helpers/server.js';

function boot(dir) {
  const persist = new Persist(dir, { log: quiet });
  const r = loadFarm(persist, { dev: true, log: quiet, tz: 'Europe/Sofia' });
  r.engine.journal = persist;
  persist.openJournal();
  return { persist, ...r, save: () => persist.snapshot(() => ({ state: r.engine.state, server: r.engine.server, version: r.engine.v })) };
}

/** A free spot for `def` (scan from the farm's corner), or null. */
function spotFor(state, def) {
  resetGrid(state);
  for (let z = 2; z < 70; z++) for (let x = 2; x < 70; x++) if (canPlace(state, def, x, z, 0) === null) return [x, z];
  return null;
}

test('SV-04: decor placed, settled and paid by `_beauty` replays from the journal to the same farm', async () => {
  const dir = tmpDataDir('qa2-beauty');
  try {
    const f = boot(dir);
    const st = f.engine.state;
    st.farm.xp = levelRow(20).xp;                         // Farm Beauty is live from L18
    st.farm.wallet.coins = 1_000_000;
    await f.save();                                       // the snapshot the replay starts from
    assert.equal(f.engine.system('_join', { pid: 'p1', name: 'Rowan' }).ok, true);
    f.engine.client('cidbty', 'p1', f.clock.now());
    const who = { pid: 'p1', cid: 'cidbty' };
    const before = st.farm.beauty.stars;
    // one of each cheap shop decor until the settled beauty would gain a star
    const decor = [...PLACEABLES.values()].filter((d) => d.kind === 'decor' && d.tier === 'coin' && d.shop && d.unlock <= 20 && d.beauty10 > 0)
      .sort((a, b) => b.beauty10 - a.beauty10 || (a.id < b.id ? -1 : 1));
    let seq = 0;
    for (const d of decor) {
      if (beautyOf(st, f.clock.now(), { settledOnly: false }).stars > before) break;
      const at = spotFor(st, d.id);
      if (!at) continue;
      const r = f.engine.act(who, { seq: ++seq, type: 'place', args: { def: d.id, x: at[0], z: at[1], rot: 0, confirm: ['BIG_SPEND'] } });
      assert.equal(r, null, `place ${d.id}: ${r && r.code}`);
    }
    assert.ok(beautyOf(st, f.clock.now(), { settledOnly: false }).stars > before, 'the decor is worth a new star once settled');
    f.clock.warp(11 * 60_000);                            // past the 10-minute undo window: the decor settles
    f.engine.runDue();
    const types = readJournal(dir).map((l) => l.type);
    assert.ok(types.includes('_beauty'), `_beauty was journaled (${[...new Set(types)].join(', ')})`);
    assert.ok(st.farm.beauty.stars > before, 'the star was paid');
    const ref = { v: f.engine.v, state: plain(st) };
    fs.closeSync(f.persist.fd);                           // kill -9: no final snapshot, the journal holds it all
    f.persist.fd = null;
    const g = boot(dir);
    assert.ok(g.replayed >= seq + 2, `replayed ${g.replayed} line(s)`);
    assert.equal(g.engine.v, ref.v);
    assert.deepEqual(plain(g.engine.state), ref.state, 'the replayed farm equals the farm before the kill');
    assert.deepEqual(validateState(g.engine.state, { now: g.clock.now() }), []);
    g.persist.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
