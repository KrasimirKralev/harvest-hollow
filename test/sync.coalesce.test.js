// Per-animation-frame delta coalescing (GDD §8.6, App. F): store.onServerBatch must give exactly the outcome of
// onServer() per message, with one rewind and one replay per frame. Plus the 'pending' event and health().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf } from '../shared/content/index.js';
import { MSG } from '../shared/net/protocol.js';
import { coopHarness, mulberry32, plain, deliverBatch, flushBatched, recordEvents } from './helpers/client.js';

const WHEAT = cropOf('wheat');

/** One random step of a two-client session; `deliver(c, n)` is the only thing that differs between twins. */
function step(h, rng, deliver) {
  const c = rng() < 0.5 ? h.a : h.b;
  const roll = rng();
  const plots = Object.keys(h.state.farm.objects).filter((id) => id.startsWith('home.0.')).sort();
  const plot = plots[Math.floor(rng() * plots.length)];
  if (roll < 0.3) c.store.act('plant', { id: plot, crop: 'wheat' });
  else if (roll < 0.5) c.store.act('harvest', { id: plot });
  else if (roll < 0.56) c.store.act('sell', { item: 'wheat', qty: 1 + Math.floor(rng() * 2) });
  else if (roll < 0.7) h.deliverToServer(c, 1 + Math.floor(rng() * 3));
  else if (roll < 0.92) deliver(c, 1 + Math.floor(rng() * 6));
  else h.clock.advance(Math.floor(rng() * WHEAT.growMs * 0.8));
}

test('a batch gives exactly the per-message outcome: state, pending and events (60 random twin runs)', () => {
  for (let run = 0; run < 60; run++) {
    const one = coopHarness({ seed: run });
    const many = coopHarness({ seed: run });
    const logs = { one: [recordEvents(one.a.store, ['fx', 'celebrate', 'reject', 'lost']), recordEvents(one.b.store, ['fx', 'celebrate', 'reject', 'lost'])],
      many: [recordEvents(many.a.store, ['fx', 'celebrate', 'reject', 'lost']), recordEvents(many.b.store, ['fx', 'celebrate', 'reject', 'lost'])] };
    const r1 = mulberry32(5000 + run);
    const r2 = mulberry32(5000 + run);
    for (let i = 0; i < 50; i++) {
      step(one, r1, (c, n) => one.deliverToClient(c, n));
      step(many, r2, (c, n) => deliverBatch(c, n));
      for (const k of ['a', 'b']) {
        assert.deepEqual(plain(many[k].store.state), plain(one[k].store.state), `run ${run} step ${i}: client ${k} state`);
        assert.deepEqual(many[k].store.pending.map((p) => p.seq), one[k].store.pending.map((p) => p.seq), `run ${run} step ${i}: pending`);
        assert.equal(many[k].store.v, one[k].store.v);
      }
    }
    one.flush();
    flushBatched(many);
    assert.deepEqual(plain(many.state), plain(one.state), `run ${run}: server`);
    for (const k of ['a', 'b']) assert.deepEqual(plain(many[k].store.state), plain(many.state), `run ${run}: ${k} converged`);
    assert.deepEqual(logs.many.map((l) => l.log), logs.one.map((l) => l.log), `run ${run}: identical event sequences`);
  }
});

test("a 16-plot partner stroke costs one rewind and one replay, one 'change'", () => {
  const h = coopHarness();
  const plots = Object.keys(h.state.farm.objects).filter((id) => id.startsWith('home.0.')).sort();
  assert.ok(plots.length >= 8);
  h.b.store.act('plant', { id: plots[0], crop: 'wheat' });           // B has one prediction in flight
  for (const id of plots.slice(1)) h.a.store.act('plant', { id, crop: 'wheat' });
  h.deliverToServer(h.a);                                             // A's stroke reaches the server first
  let replays = 0;
  const orig = h.b.store.replayPending.bind(h.b.store);
  h.b.store.replayPending = () => { replays++; return orig(); };
  let changes = 0;
  h.b.store.on('change', () => changes++);
  const fx = recordEvents(h.b.store, ['fx']);
  assert.equal(h.b.toClient.length, plots.length - 1);
  deliverBatch(h.b);
  assert.equal(replays, 1, 'one replay for the whole stroke');
  assert.equal(changes, 1, "one 'change' for the whole stroke");
  assert.equal(fx.log.filter(([, f]) => f.e === 'planted').length, plots.length - 1, 'every partner plant still plays its feedback');
  assert.equal(h.b.store.pending.length, 1, "B's own prediction survives the rebase");
  assert.equal(h.b.store.state.farm.objects[plots[0]].crop.by, 'p2');
  flushBatched(h);
  assert.deepEqual(plain(h.b.store.state), plain(h.state));
});

test('a gap in the middle of a batch keeps what came before, then resyncs', () => {
  const h = coopHarness();
  const plots = Object.keys(h.state.farm.objects).filter((id) => id.startsWith('home.0.')).sort();
  for (const id of plots.slice(0, 4)) h.a.store.act('plant', { id, crop: 'wheat' });
  h.deliverToServer(h.a);
  h.b.toClient.splice(2, 1);                                          // v+3 lost (a bug: TCP keeps order)
  deliverBatch(h.b);
  assert.equal(h.b.store.v, h.engine.v - 2, 'the two deltas before the gap were applied');
  assert.equal(h.b.store.resyncing, true);
  assert.equal(h.b.toServer.at(-1).t, MSG.RESYNC);
  flushBatched(h);
  assert.deepEqual(plain(h.b.store.state), plain(h.state));
  assert.equal(h.b.store.ready, true);
});

test("'pending' reports the count of unconfirmed predictions; health() snapshots it", () => {
  const h = coopHarness();
  const seen = [];
  h.a.store.on('pending', (p) => seen.push(p.n));
  const plots = Object.keys(h.state.farm.objects).filter((id) => id.startsWith('home.0.')).sort();
  h.a.store.act('plant', { id: plots[0], crop: 'wheat' });
  h.a.store.act('plant', { id: plots[1], crop: 'wheat' });
  assert.equal(h.a.store.health().pending, 2);
  h.clock.advance(40);
  assert.equal(h.a.store.health().oldestMs, 40);
  h.deliverToServer(h.a);
  deliverBatch(h.a);
  assert.deepEqual(seen, [1, 2, 0], 'one event per change of the count, batched confirmations jump to 0');
  const hh = h.a.store.health();
  assert.equal(hh.pending, 0);
  assert.equal(hh.oldestMs, 0);
  assert.equal(hh.ready, true);
  assert.equal(hh.stale, false);
  assert.equal(hh.v, h.engine.v);
  h.a.store.setOnline(false);
  h.clock.advance(1234);
  assert.equal(h.a.store.health().offlineMs, 1234);
});

test('a rejected prediction inside a batch is reported after the state is final', () => {
  const h = coopHarness();
  const plots = Object.keys(h.state.farm.objects).filter((id) => id.startsWith('home.0.')).sort();
  h.a.store.act('plant', { id: plots[0], crop: 'wheat' });
  h.b.store.act('plant', { id: plots[0], crop: 'wheat' });             // the same plot: B loses the race
  h.b.store.act('plant', { id: plots[1], crop: 'wheat' });
  h.deliverToServer(h.a);
  h.deliverToServer(h.b);
  const states = [];
  h.b.store.on('reject', () => states.push(plain(h.b.store.state.farm.objects[plots[0]].crop)));
  deliverBatch(h.b);
  assert.equal(states.length, 1);
  assert.equal(states[0].by, 'p1', "when the toast fires, the plot already shows the partner's crop");
  assert.deepEqual(plain(h.b.store.state), plain(h.state));
});
