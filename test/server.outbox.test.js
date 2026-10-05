// Output coalescing, ordering and back-pressure (lane brief item 1; server/outbox.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Outbox, SOFT_BYTES, HARD_BYTES } from '../server/outbox.js';
import { MSG, PROTOCOL_VERSION, CAPS } from '../shared/net/protocol.js';
import { fakeWs, sleep, testServer, wsClient, join } from './helpers/server.js';

const tick = () => new Promise((r) => setImmediate(r));
const s = (o) => JSON.stringify(o);

test('an idle connection is flushed in the same turn; one turn of messages is one `b` frame, in order', async () => {
  const ws = fakeWs();
  const out = new Outbox(ws, { batch: true });
  out.push(s({ t: 'd', v: 1 }));
  out.push(s({ t: 'rej', seq: 4 }));
  out.push(s({ t: 'd', v: 2 }));
  assert.equal(ws.sent.length, 0, 'nothing is written synchronously');
  await tick();
  assert.deepEqual(ws.frames(), [{ t: MSG.BATCH, list: [{ t: 'd', v: 1 }, { t: 'rej', seq: 4 }, { t: 'd', v: 2 }] }]);
  out.push(s({ t: 'd', v: 3 }));
  await sleep(25);
  assert.deepEqual(ws.frames().at(-1), { t: 'd', v: 3 }, 'a lone message is never wrapped');
});

test('without caps the same messages go out as separate frames, corked into one write', async () => {
  const ws = fakeWs();
  const out = new Outbox(ws);
  for (let v = 1; v <= 3; v++) out.push(s({ t: 'd', v }));
  await tick();
  assert.deepEqual(ws.frames().map((m) => m.v), [1, 2, 3]);
  assert.equal(ws.corks, 1);
});

test('a busy connection gets at most one frame per tick; urgent messages do not wait', async () => {
  let now = 0;
  const ws = fakeWs();
  const out = new Outbox(ws, { batch: true, tickMs: 40, now: () => now });
  out.push(s({ t: 'd', v: 1 }));
  await tick();
  assert.equal(ws.sent.length, 1);
  now = 5;
  out.push(s({ t: 'd', v: 2 }));
  out.push(s({ t: 'd', v: 3 }));
  await tick();
  await sleep(10);
  assert.equal(ws.sent.length, 1, 'held until the tick is over');
  now = 45;
  await sleep(45);
  assert.deepEqual(ws.frames().at(-1).list.map((m) => m.v), [2, 3]);
  now = 50;
  out.push(s({ t: 'd', v: 4 }));
  out.push(s({ t: MSG.PONG, c: 1, s: 2 }), true);
  await tick();
  assert.deepEqual(ws.frames().at(-1).list.map((m) => m.t), ['d', MSG.PONG], 'urgent flushes now, with what is queued before it');
});

test('under back-pressure presence and ghosts are held and merged; deltas still flow in order', async () => {
  const ws = fakeWs();
  const out = new Outbox(ws, { batch: true, tickMs: 0 });
  ws.bufferedAmount = SOFT_BYTES + 1;
  out.presence(100, [['p2', 1, 1, 0, 1, null, null, 100, null, 0]]);
  out.ghost('p2', s({ t: 'ghost', pid: 'p2', g: { def: 'plot', x: 1, z: 1, rot: 0 } }));
  out.push(s({ t: 'd', v: 7 }));
  out.presence(166, [['p2', 2, 1, 0, 1, null, null, 166, null, 0], ['p3', 5, 5, 0, 0, null, null, 160, null, 0]]);
  out.ghost('p2', s({ t: 'ghost', pid: 'p2', g: { def: 'plot', x: 9, z: 1, rot: 0 } }));
  out.push(s({ t: 'd', v: 8 }));
  await tick();
  await tick();
  assert.deepEqual(ws.frames().flatMap((f) => (f.t === MSG.BATCH ? f.list : [f])).map((m) => m.t + (m.v ?? '')), ['d7', 'd8'],
    'only the deltas went out');
  out.forget('p3');
  ws.bufferedAmount = 0;
  await sleep(70);
  const rest = ws.frames().slice(-1)[0];
  const list = rest.t === MSG.BATCH ? rest.list : [rest];
  const pr = list.find((m) => m.t === MSG.PRESENCE);
  assert.deepEqual(pr.list, [['p2', 2, 1, 0, 1, null, null, 166, null, 0]], 'one merged row per player, the newest; p3 forgotten');
  assert.deepEqual(list.filter((m) => m.t === 'ghost').map((m) => m.g.x), [9], 'latest ghost only');
});

test('a connection that stops reading past HARD bytes is closed, not buffered forever', async () => {
  const ws = fakeWs();
  let overflow = 0;
  const out = new Outbox(ws, { onOverflow: () => overflow++ });
  ws.bufferedAmount = HARD_BYTES + 1;
  out.push(s({ t: 'd', v: 1 }));
  await tick();
  assert.equal(overflow, 1);
  assert.equal(ws.sent.length, 0);
  out.push(s({ t: 'd', v: 2 }));
  await tick();
  assert.equal(ws.sent.length, 0, 'closed outbox drops everything');
});

test('server: a batch-capable client gets a drag stroke as one frame; a plain client as ordered frames', async () => {
  const srv = await testServer();
  try {
    const a = await wsClient(srv.port);
    a.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'batch1', claim: { slot: 'p1', name: 'Rowan' }, caps: [CAPS.BATCH] });
    await a.next((m) => m.t === MSG.WELCOME);
    const b = await join(srv.port, 'p2', 'Mia');
    await sleep(50);
    a.msgs.length = 0;
    b.c.msgs.length = 0;
    const list = [];
    for (let i = 0; i < 6; i++) list.push({ seq: i + 1, type: 'plant', args: { id: `home.0.${i}`, crop: 'wheat' } });
    a.send({ t: 'acts', list });
    const batch = await a.next((m) => m.t === MSG.BATCH);
    const deltas = batch.list.filter((m) => m.t === MSG.DELTA);
    assert.deepEqual(deltas.map((d) => d.seq), [1, 2, 3, 4, 5, 6], 'all six in one frame, in order');
    assert.ok(deltas.every((d, i) => i === 0 || d.v === deltas[i - 1].v + 1));
    await sleep(60);
    const plainDeltas = b.c.msgs.filter((m) => m.t === MSG.DELTA);
    assert.deepEqual(plainDeltas.map((d) => d.seq), [1, 2, 3, 4, 5, 6], 'the partner gets the same, as frames');
    a.close();
    b.c.close();
  } finally {
    await srv.close();
  }
});

test('a socket that throws on send is closed quietly instead of crashing the server from a timer', async () => {
  const ws = fakeWs();
  ws.send = () => { throw new Error('EPIPE'); };
  const out = new Outbox(ws);
  out.push(s({ t: 'd', v: 1 }));
  await tick();
  assert.equal(ws.terminated, true);
  out.push(s({ t: 'd', v: 2 }));
  await tick();
});
