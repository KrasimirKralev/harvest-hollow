// Server hardening after the M0 review (docs/design/review-m0-sync-latency-server.md and
// review-m0-determinism-economy.md): exactly-once records (#4, M1), resync never dropped (H3), rate pressure
// is not abuse (M2), latest-wins relays (M5), lost rejections (L2), atomic journal appends (M6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, wsClient, join, coopHarness } from './helpers.js';
import { MSG, ERR, PROTOCOL_VERSION, LIMITS } from '../shared/net/protocol.js';
import { CID_TTL_MS } from '../server/engine.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a cid bound to one player is never re-bound to another (review-m0 #4)', async () => {
  const h = coopHarness();
  const p1 = { pid: 'p1', cid: 'aaaaaa' };
  assert.equal(h.engine.act(p1, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } }), null);
  assert.equal(h.engine.client('aaaaaa', 'p2', h.clock.now()), null, 'refused, not reset');
  assert.equal(h.engine.client('aaaaaa', 'p1', h.clock.now()).lastSeq, 1);
  assert.equal(h.engine.act(p1, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } }).t, MSG.ACK, 'never applied twice');
  const s = await testServer();
  try {
    const a = await join(s.port, 'p1', 'Rowan', 'samecd');
    const b = await join(s.port, 'p2', 'Mia', 'samecd');
    assert.deepEqual(b.w, { t: MSG.DENY, code: ERR.BAD_HELLO });
    assert.equal(Object.hasOwn(s.hh.engine.state.players, 'p2'), false, 'the refused claim did not take the slot');
    a.c.close(); b.c.close();
  } finally {
    await s.close();
  }
});

test('the dedupe record outlives a day and is never pruned while its tab is connected (review-m0 #4, M1)', async () => {
  const h = coopHarness();
  h.engine.act({ pid: 'p1', cid: 'aaaaaa' }, { seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
  h.clock.advance(25 * 3600_000);
  h.engine.pruneClients(h.clock.now());
  assert.equal(h.engine.client('aaaaaa', 'p1', h.clock.now()).lastSeq, 1, 'kept for CID_TTL_MS (7 days)');
  h.clock.advance(CID_TTL_MS + 1);
  h.engine.pruneClients(h.clock.now(), new Set(['aaaaaa']));
  assert.ok(h.engine.knows('aaaaaa'), 'a live cid is never pruned');
  h.engine.pruneClients(h.clock.now());
  assert.ok(!h.engine.knows('aaaaaa'), 'an idle, disconnected cid is pruned after the TTL');
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1');
    s.hh.clock.warp(CID_TTL_MS + 3600_000);
    s.hh.engine.pruneClients(s.hh.clock.now(), new Set([...s.hh.sessions.conns].map((x) => x.cid)));
    c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    assert.equal((await c.next((m) => m.t === MSG.DELTA || m.t === MSG.REJ)).t, MSG.DELTA);
    c.send({ t: 'resync' });
    assert.equal((await c.next((m) => m.t === MSG.WELCOME, 1000)).lastSeq, 1);
    c.close();
  } finally {
    await s.close();
  }
});

test('welcome.known is false only for a cid the server has no record of', async () => {
  const s = await testServer();
  try {
    const { c, w } = await join(s.port, 'p1', 'Rowan', 'knowna');
    assert.equal(w.known, false, 'a brand-new cid');
    c.send({ t: 'resync' });
    assert.equal((await c.next((m) => m.t === MSG.WELCOME)).known, true);
    c.close();
    const r = await wsClient(s.port);
    r.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'knowna', token: w.token });
    assert.equal((await r.next((m) => m.t === MSG.WELCOME)).known, true, 'a reconnect of the same tab');
    r.close();
  } finally {
    await s.close();
  }
});

test('every resync request is answered, over budget a little later (review-m0 H3)', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1');
    for (let i = 0; i < 3; i++) c.send({ t: 'resync' });
    const welcomes = () => c.msgs.filter((m) => m.t === MSG.WELCOME).length;
    await sleep(300);
    assert.equal(welcomes(), 2, 'the burst answers at once');
    const until = Date.now() + 1000 / LIMITS.BUCKETS.resync[0] + 1500;
    while (welcomes() < 3 && Date.now() < until) await sleep(50);
    assert.equal(welcomes(), 3, 'the third is deferred, not dropped');
    assert.equal(c.ws.readyState, 1, 'and nobody was disconnected');
    c.close();
  } finally {
    await s.close();
  }
});

test('a drag-paint stroke (90 acts/s) is neither rate-rejected nor disconnected (review-m0 M2)', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1');
    let seq = 0;
    for (let tick = 0; tick < 30; tick++) {           // 3 s, 9 cells every 100 ms
      const list = [];
      for (let k = 0; k < 9; k++) list.push({ seq: ++seq, type: 'sell', args: { item: 'wheat', qty: 1 } });
      c.send({ t: 'acts', list });
      await sleep(100);
    }
    await sleep(200);
    assert.equal(c.msgs.filter((m) => m.t === MSG.REJ && m.code === ERR.RATE).length, 0);
    assert.equal(c.ws.readyState, 1);
    // a flood beyond any brush is answered RATE, but well-formed acts are pressure, not abuse
    const list = [];
    for (let i = 0; i < 1500; i++) list.push({ seq: ++seq, type: 'sell', args: { item: 'wheat', qty: 1 } });
    for (let i = 0; i < list.length; i += LIMITS.MAX_ACTS_PER_FRAME) c.send({ t: 'acts', list: list.slice(i, i + LIMITS.MAX_ACTS_PER_FRAME) });
    await c.next((m) => m.t === MSG.REJ && m.code === ERR.RATE);
    await sleep(200);
    assert.equal(c.ws.readyState, 1, 'not closed as abusive');
    c.close();
  } finally {
    await s.close();
  }
});

test("after a fast sweep the partner sees the builder's final ghost (review-m0 M5)", async () => {
  const s = await testServer();
  try {
    const a = await join(s.port, 'p1');
    const b = await join(s.port, 'p2');
    for (let x = 10; x < 40; x++) {
      a.c.send({ t: 'ghost', g: { def: 'plot', x, z: 30, rot: 0 } });
      await sleep(16);
    }
    await sleep(400);
    const seen = b.c.msgs.filter((m) => m.t === MSG.GHOST && m.pid === 'p1');
    assert.equal(seen.at(-1).g.x, 39);
    assert.ok(seen.length <= 30);
    a.c.close(); b.c.close();
  } finally {
    await s.close();
  }
});

test('a rejection is remembered for the welcome (review-m0 L2)', async () => {
  const s = await testServer();
  try {
    const { c, w } = await join(s.port, 'p1', 'Rowan', 'rejcid');
    c.send({ t: 'act', seq: 1, type: 'harvest', args: { id: 'home.0.0' } });
    assert.equal((await c.next((m) => m.t === MSG.REJ)).code, ERR.EMPTY);
    c.close();
    const r = await wsClient(s.port);
    r.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'rejcid', token: w.token });
    const w2 = await r.next((m) => m.t === MSG.WELCOME);
    assert.deepEqual(w2.rejected, [{ seq: 1, code: ERR.EMPTY }]);
    r.close();
  } finally {
    await s.close();
  }
});

test('a failed journal append rejects the action atomically (review-m0 M6)', async () => {
  const s = await testServer();
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
    const answer = await a.c.next((m) => (m.t === MSG.DELTA || m.t === MSG.REJ) && m.seq === 1);
    assert.deepEqual(answer, { t: MSG.REJ, seq: 1, code: ERR.INTERNAL });
    assert.equal(s.hh.engine.state.farm.objects['home.0.0'].crop, null, 'nothing half-committed');
    assert.equal(s.hh.engine.v, vBefore);
    const st = await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json();
    assert.equal(st.degraded, true);
    b.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
    const dB = await b.c.next((m) => m.t === MSG.DELTA && m.by === 'p2');
    assert.equal(dB.v, vBefore + 1, 'no gap for the partner');
    a.c.close(); b.c.close();
  } finally {
    await s.close();
  }
});

