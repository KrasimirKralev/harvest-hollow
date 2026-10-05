// Protocol: frame validation, hostile frames, hello/claim/tokens, rate limits (tech §7, §9 protocol.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage, ERR, MSG, LIMITS, PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { makeCid } from '../shared/net/ids.js';
import { testServer, wsClient, join } from './helpers.js';

test('parseClientMessage accepts well-formed frames and keeps only known fields', () => {
  assert.deepEqual(parseClientMessage({ t: 'act', seq: 3, type: 'plant', args: { id: 'a.1.0', crop: 'wheat' }, extra: 1 }),
    { t: 'act', seq: 3, type: 'plant', args: { id: 'a.1.0', crop: 'wheat' } });
  assert.deepEqual(parseClientMessage({ t: 'mv', x: 1.5, z: 2, f: 0.3, a: 0 }), { t: 'mv', x: 1.5, z: 2, f: 0.3, a: 0 });
  assert.deepEqual(parseClientMessage({ t: 'hello', proto: 1, cid: 'abc123', claim: { slot: 'p1', name: ' <b>Rowan</b> ' } }),
    { t: 'hello', proto: 1, cid: 'abc123', claim: { slot: 'p1', name: 'bRowan/b', color: undefined } });
  assert.deepEqual(parseClientMessage({ t: 'ghost', g: null }), { t: 'ghost', g: null });
  assert.equal(parseClientMessage({ t: 'chat', text: 'x'.repeat(500) }).text.length, LIMITS.CHAT_MAX);
});

test('parseClientMessage rejects hostile and malformed frames without throwing', () => {
  const bad = [
    null, 42, 'act', [], { t: 1 }, { t: 'nope' }, { t: 'act', seq: 0, type: 'plant' }, { t: 'act', seq: 1.5, type: 'plant' },
    { t: 'act', seq: 1, type: 'pla nt' }, { t: 'act', seq: 1, type: 'plant', args: [] }, { t: 'act', seq: 1, type: 'plant', args: 'x' },
    { t: 'act', seq: 2 ** 60, type: 'plant' }, { t: 'acts', list: [] }, { t: 'acts', list: new Array(LIMITS.MAX_ACTS_PER_FRAME + 1).fill({ seq: 1, type: 'a' }) },
    { t: 'mv', x: 1e308 * 10, z: 0, f: 0, a: 0 }, { t: 'mv', x: NaN, z: 0, f: 0, a: 0 }, { t: 'mv', x: 1, z: 1, f: 0, a: -1 },
    { t: 'mv', x: 1, z: 1, f: 0, a: 0, cx: 1 }, { t: 'hello', proto: 1, cid: 'sys' }, { t: 'hello', proto: 1, cid: 'ABCDEF' },
    { t: 'hello', proto: 1, cid: 'abcdef', token: 'zz' }, { t: 'hello', proto: 1, cid: 'abcdef', claim: { slot: 'p1', name: '   ' } },
    { t: 'hello', proto: 1, cid: 'abcdef', claim: { slot: '__proto__', name: 'x' } }, { t: 'ping', c: 'x' }, { t: 'chat', text: '\u0000\u0001' },
    { t: 'mark', x: 1, z: 1, kind: 'boom' }, { t: 'ghost', g: { def: 'plot', x: 1, z: 1, rot: 9 } },
    Object.assign(Object.create({ t: 'act' }), { seq: 1, type: 'plant' }),
    JSON.parse('{"t":"act","seq":1,"type":"plant","args":{"__proto__":{"x":1}}}'),
  ];
  for (const m of bad) assert.equal(parseClientMessage(m), null, JSON.stringify(m));
});

test('server: slots, claim, token resume, taken slot, bad token, protocol mismatch', async () => {
  const s = await testServer();
  try {
    const anon = await wsClient(s.port);
    anon.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'anon01' });
    const slots = await anon.next((m) => m.t === MSG.SLOTS);
    assert.deepEqual(slots.slots.map((x) => [x.pid, x.claimed]), [['p1', false], ['p2', false]]);
    const { c: a, w } = await join(s.port, 'p1', 'Rowan');
    assert.equal(w.t, MSG.WELCOME);
    assert.equal(w.pid, 'p1');
    assert.match(w.token, /^[0-9a-f]{64}$/);
    assert.equal(w.state.players.p1.name, 'Rowan');
    assert.equal(JSON.stringify(w.state).includes(w.token), false);
    assert.equal(Object.hasOwn(w.state, 'server'), false, 'the private sidecar is never sent');
    const again = await join(s.port, 'p1', 'Thief', 'thief1');
    assert.deepEqual(again.w, { t: MSG.DENY, code: ERR.SLOT_TAKEN });
    const resume = await wsClient(s.port);
    resume.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'tab002', token: w.token });
    const w2 = await resume.next((m) => m.t === MSG.WELCOME);
    assert.equal(w2.pid, 'p1');
    assert.equal(w2.token, undefined);
    const forged = await wsClient(s.port);
    forged.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'forge1', token: 'a'.repeat(64) });
    assert.deepEqual(await forged.next((m) => m.t === MSG.DENY), { t: MSG.DENY, code: ERR.BAD_TOKEN });
    const old = await wsClient(s.port);
    old.send({ t: 'hello', proto: 999, cid: 'old001' });
    assert.deepEqual(await old.next((m) => m.t === MSG.DENY), { t: MSG.DENY, code: ERR.PROTO });
    const b = await join(s.port, 'p2', 'Mia');
    const peer = await a.next((m) => m.t === MSG.PEER && m.pid === 'p2');
    assert.equal(peer.online, true);
    for (const x of [anon, a, resume, forged, old, b.c]) x.close();
  } finally {
    await s.close();
  }
});

test('server: hostile frames never crash it; actions before hello are ignored', async () => {
  const s = await testServer();
  try {
    const x = await wsClient(s.port);
    x.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    for (const raw of ['', 'not json', '[]', 'null', '{"t":"act"}', '{"__proto__":{"t":"hello"}}', '{"t":"hello","proto":1,"cid":"constructor"}',
      JSON.stringify({ t: 'act', seq: 1, type: 'constructor', args: {} })]) x.send(raw);
    const { c, w } = await join(s.port, 'p1');
    assert.equal(w.state.farm.objects['home.0.0'].crop, null, 'nothing ran before hello');
    c.send({ t: 'act', seq: 1, type: '_join', args: { pid: 'p2', name: 'x' } });
    assert.equal((await c.next((m) => m.t === MSG.REJ)).code, ERR.UNKNOWN_ACTION);
    c.send({ t: 'act', seq: 2, type: 'plant', args: { id: 'home.0.0', crop: 'wheat', coins: -1 } });
    assert.equal((await c.next((m) => m.t === MSG.REJ)).code, ERR.BAD_ARGS);
    c.send({ t: 'act', seq: 3, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    const d = await c.next((m) => m.t === MSG.DELTA);
    assert.equal(d.seq, 3);
    c.send({ t: 'act', seq: 3, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
    assert.deepEqual(await c.next((m) => m.t === MSG.ACK), { t: MSG.ACK, seq: 3, v: d.v }, 'duplicate seq is acked, not re-run');
    c.send({ t: 'mv', x: 1e300, z: -1e300, f: 0, a: 0 });
    c.send({ t: 'ping', c: 5 });
    const pong = await c.next((m) => m.t === MSG.PONG);
    assert.equal(pong.c, 5);
    assert.ok(Number.isSafeInteger(pong.s));
    x.close(); c.close();
  } finally {
    await s.close();
  }
});

test('server: the act bucket answers RATE when flooded', async () => {
  const s = await testServer();
  try {
    const { c } = await join(s.port, 'p1');
    const [, burst] = LIMITS.BUCKETS.act;
    const list = [];
    for (let i = 1; i <= burst + 10; i++) list.push({ seq: i, type: 'sell', args: { item: 'wheat', qty: 1 } });
    for (let i = 0; i < list.length; i += LIMITS.MAX_ACTS_PER_FRAME) c.send({ t: 'acts', list: list.slice(i, i + LIMITS.MAX_ACTS_PER_FRAME) });
    const rate = await c.next((m) => m.t === MSG.REJ && m.code === ERR.RATE);
    assert.ok(rate.seq > burst - 5);
    c.close();
  } finally {
    await s.close();
  }
});

test('server: a foreign Origin is refused', async () => {
  const s = await testServer();
  try {
    await assert.rejects(wsClient(s.port, { origin: 'http://evil.example' }));
    const ok = await wsClient(s.port, { origin: `http://127.0.0.1:${s.port}` });
    ok.close();
  } finally {
    await s.close();
  }
});

test('makeCid draws every base-36 character equally often (review-m0 #18)', () => {
  // Over every value of the first byte, each character comes out exactly 7 times; 252..255 are skipped
  // (with `byte % 36` alone, 0-3 came out 8 times).
  const counts = new Map();
  for (let v = 0; v < 256; v++) {
    const cid = makeCid((n) => { const b = new Uint8Array(n).fill(100); b[0] = v; return b; });
    assert.match(cid, /^[a-z0-9]{6}$/);
    if (v < 252) counts.set(cid[0], (counts.get(cid[0]) || 0) + 1);
    else assert.equal(cid, 'ssssss', `byte ${v} is skipped (100 % 36 = 's')`);
  }
  assert.equal(counts.size, 36);
  assert.deepEqual(new Set(counts.values()), new Set([7]));
  let calls = 0;
  const cid = makeCid((n) => { calls++; return new Uint8Array(n).fill(calls === 1 ? 255 : 1); });
  assert.equal(cid, '111111', 'draws more bytes when a whole draw is rejected');
});

test('hello caps and claim.reclaim parse strictly; emotes and pings use the shared whitelists', async () => {
  const { EMOTES, MARKS, CAPS, CLOSE } = await import('../shared/net/protocol.js');
  assert.deepEqual(parseClientMessage({ t: 'hello', proto: 2, cid: 'abc123', caps: ['b', 'b', 'zz'] }),
    { t: 'hello', proto: 2, cid: 'abc123', caps: ['b', 'zz'] }, 'deduped; unknown caps are kept and ignored by the server');
  assert.deepEqual(parseClientMessage({ t: 'hello', proto: 2, cid: 'abc123', claim: { slot: 'p1', name: 'K', reclaim: true, pass: 'x' } }).claim,
    { slot: 'p1', name: 'K', color: undefined, pass: 'x', reclaim: true });
  for (const bad of [{ caps: 'b' }, { caps: [1] }, { caps: ['B'] }, { caps: new Array(9).fill('b') },
    { claim: { slot: 'p1', name: 'K', reclaim: 1 } }, { claim: { slot: 'p1', name: 'K', reclaim: false } }]) {
    assert.equal(parseClientMessage({ t: 'hello', proto: 2, cid: 'abc123', ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(EMOTES.length, 8, 'the 8 free emotes of GDD §6.2 #2');
  for (const id of EMOTES) assert.deepEqual(parseClientMessage({ t: 'emote', id }), { t: 'emote', id });
  assert.equal(parseClientMessage({ t: 'emote', id: 'nuke' }), null);
  for (const kind of MARKS) assert.equal(parseClientMessage({ t: 'mark', x: 1, z: 2, kind }).kind, kind);
  assert.equal(CAPS.BATCH, MSG.BATCH);
  assert.ok(Object.values(CLOSE).every((c) => Number.isInteger(c) && (c < 1016 || (c >= 4000 && c < 5000))));
});
