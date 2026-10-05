// A drag stroke's frames are predicted at once but sent merged (TRIAGE CL-07, performance-16): store.act(..., { hold })
// keeps the action in an outbox, store.release() merges a stroke's consecutive actions into one `ids` action. The
// merged action must have exactly the effect of the separate ones, the server must see the player's order, and a
// welcome must neither lose nor double the held actions.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf, xpForLevel } from '../shared/content/index.js';
import { MSG } from '../shared/net/protocol.js';
import { mergeArgs } from '../public/js/net/sync.js';
import { coopHarness, plain, mulberry32, eventTarget, fakeController } from './helpers/client.js';

const WHEAT = cropOf('wheat');
const plotsOf = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot')
  .sort((a, b) => s.farm.objects[a].z - s.farm.objects[b].z || s.farm.objects[a].x - s.farm.objects[b].x);
const acts = (c) => c.toServer.filter((m) => m.t === MSG.ACT);
beforeEach(() => { globalThis.window = eventTarget(); });

test('held actions are predicted at once, sent as ONE merged action on release, and converge', () => {
  const h = coopHarness();
  const st = h.a.store;
  const plots = plotsOf(st.state);
  for (const id of plots) assert.equal(st.act('plant', { id, crop: 'wheat' }, { hold: true }).ok, true);
  assert.ok(plots.every((id) => st.state.farm.objects[id].crop?.def === 'wheat'), 'every plot predicted at once');
  assert.equal(acts(h.a).length, 0, 'nothing sent yet');
  assert.equal(st.release(), 1);
  assert.deepEqual(acts(h.a).map((m) => [m.type, m.args.ids?.length, m.args.crop]), [['plant', plots.length, 'wheat']]);
  assert.equal(st.pending.length, 1);
  h.flush();
  assert.deepEqual(plain(st.state), plain(h.state));
  assert.equal(st.pending.length, 0);
});

test('an act without hold releases the outbox first: the server sees the player\'s order', () => {
  const h = coopHarness();
  const st = h.a.store;
  const plots = plotsOf(st.state);
  st.act('plant', { id: plots[0], crop: 'wheat' }, { hold: true });
  st.act('plant', { id: plots[1], crop: 'wheat' }, { hold: true });
  st.act('plant', { id: plots[2], crop: 'wheat' });      // not held: the stroke goes out before it
  assert.deepEqual(acts(h.a).map((m) => [m.seq, m.args.ids ?? m.args.id, m.args.crop]),
    [[1, [plots[0], plots[1]], 'wheat'], [2, plots[2], 'wheat']], 'the stroke first, seqs consecutive after the merge');
  h.flush();
  assert.deepEqual(plain(st.state), plain(h.state));
});

test('different crops, a confirm, a repeated target or a non-stroke action are never merged', () => {
  assert.deepEqual(mergeArgs('plant', { id: 'a', crop: 'wheat' }, { ids: ['b', 'c'], crop: 'wheat' }), { crop: 'wheat', ids: ['a', 'b', 'c'] });
  assert.equal(mergeArgs('plant', { id: 'a', crop: 'wheat' }, { id: 'b', crop: 'corn' }), null);
  assert.equal(mergeArgs('plant', { id: 'a', crop: 'wheat' }, { id: 'a', crop: 'wheat' }), null);
  assert.equal(mergeArgs('harvest', { id: 'a', confirm: ['RESERVED'] }, { id: 'b' }), null);
  assert.equal(mergeArgs('sell', { item: 'wheat', qty: 1 }, { item: 'wheat', qty: 1 }), null);
  assert.equal(mergeArgs('plant', { ids: Array.from({ length: 60 }, (_, i) => `a${i}`), crop: 'wheat' },
    { ids: Array.from({ length: 60 }, (_, i) => `b${i}`), crop: 'wheat' }), null, 'over MAX_BATCH');
});

test('a welcome while actions are held sends them (merged), and they land once', () => {
  const h = coopHarness();
  const st = h.a.store;
  const plots = plotsOf(st.state);
  st.act('plant', { id: plots[0], crop: 'wheat' }, { hold: true });
  st.act('plant', { id: plots[1], crop: 'wheat' }, { hold: true });
  st.reset(h.welcome(h.a));                               // a reconnect in the middle of a stroke
  assert.deepEqual(acts(h.a).map((m) => m.args.ids), [[plots[0], plots[1]]]);
  assert.equal(st.release(), 0, 'nothing left to release');
  h.flush();
  assert.ok([plots[0], plots[1]].every((id) => h.state.farm.objects[id].crop?.def === 'wheat'));
  assert.deepEqual(plain(st.state), plain(h.state));
  // the server forgot this cid (known: false): held actions were never sent, so they are not lost
  st.act('plant', { id: plots[2], crop: 'wheat' }, { hold: true });
  const lost = [];
  st.on('lost', (e) => lost.push(e));
  st.reset({ ...h.welcome(h.a), known: false });
  assert.equal(lost.length, 0);
  h.flush();
  assert.equal(h.state.farm.objects[plots[2]].crop?.def, 'wheat');
});

test('held strokes from both partners in random interleavings converge (100 runs)', () => {
  for (let run = 0; run < 100; run++) {
    const h = coopHarness({ seed: run });
    const rng = mulberry32(900 + run);
    const plots = plotsOf(h.state);
    for (let i = 0; i < 40; i++) {
      const c = rng() < 0.5 ? h.a : h.b;
      const r = rng();
      const id = plots[Math.floor(rng() * plots.length)];
      if (r < 0.35) c.store.act('plant', { id, crop: 'wheat' }, { hold: true });
      else if (r < 0.55) c.store.act('harvest', { id }, { hold: true });
      else if (r < 0.65) c.store.release();
      else if (r < 0.72) c.store.act('sell', { item: 'wheat', qty: 1 });
      else if (r < 0.86) h.deliverToServer(c, 1 + Math.floor(rng() * 3));
      else if (r < 0.95) h.deliverToClient(c, 1 + Math.floor(rng() * 4));
      else h.clock.advance(Math.floor(rng() * WHEAT.growMs));
    }
    h.a.store.release();
    h.b.store.release();
    h.flush();
    for (const c of [h.a, h.b]) {
      assert.deepEqual(plain(c.store.state), plain(h.state), `run ${run}: ${c.key} converged`);
      assert.equal(c.store.pending.length, 0);
    }
  }
});

test('a 15-plot drag stroke through the controller: every plot predicted at once, at most 6 acts', async () => {
  const h = coopHarness();
  for (const s of [h.state, h.a.store.state, h.b.store.state]) { s.farm.xp = xpForLevel(12); s.farm.wallet.coins = 9000; }
  // a 4 x 4 block of plots for the stroke
  const a = await fakeController(h.a);
  let block = null;
  const { canPlace } = await import('../shared/rules/grid.js');
  for (let z = 30; z < 50 && !block; z++) {
    for (let x = 30; x < 50 && !block; x++) {
      let ok = true;
      for (let dz = 0; dz < 4 && ok; dz++) for (let dx = 0; dx < 4 && ok; dx++) ok = canPlace(h.state, 'plot', x + dx, z + dz, 0) === null;
      if (ok) block = { x, z };
    }
  }
  for (let dz = 0; dz < 4; dz++) {
    for (let dx = 0; dx < 4; dx++) {
      const r = h.a.store.act('place', { def: 'plot', x: block.x + dx, z: block.z + dz, rot: 0 });
      assert.equal(r.ok, true, `plot ${dx},${dz}: ${r.code}`);
    }
  }
  h.flush();
  h.a.toServer.length = 0;
  a.ctl.setTool('seed_bag', { crop: 'wheat' });
  const tiles = [];
  for (let dz = 0; dz < 4; dz++) {
    const row = [0, 1, 2, 3].map((dx) => [block.x + dx, block.z + dz]);
    tiles.push(...(dz % 2 ? row.reverse() : row));
  }
  tiles.shift();                                          // 15 plots
  a.down(...tiles[0]);
  for (const [x, z] of tiles.slice(1)) a.move(x, z);
  const predicted = tiles.filter(([x, z]) => Object.values(h.a.store.state.farm.objects).some((o) => o.def === 'plot' && o.x === x && o.z === z && o.crop?.def === 'wheat')).length;
  a.up(...tiles.at(-1));
  assert.equal(predicted, 15, 'every plot predicted while the stroke ran');
  const sent = acts(h.a).length;
  assert.ok(sent >= 1 && sent <= 6, `${sent} act(s) for a 15-plot stroke`);
  h.flush();
  assert.deepEqual(plain(h.a.store.state), plain(h.state));
});
