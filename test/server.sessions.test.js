// Sessions (lane brief item 4): passphrase-gated reclaim of a lost token, multi-device tokens, same-tab
// replacement, eviction when full, idle cleanup, slot count; social relays (item 5): emote whitelist, ping
// clamping, chat history, over-budget drops that are not abuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MSG, ERR, LIMITS, CLOSE, PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { WORLD_TILES } from '../shared/content/config.js';
import { PASS_FAILS } from '../server/sessions.js';
import { testServer, wsClient, join, hello, resume, sleep, quiet } from './helpers/server.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const closeAll = (...cs) => cs.forEach((c) => c && c.close());

test('reclaim without a passphrase: only an offline slot; a new token for this device, the old one keeps working', async () => {
  const s = await testServer({ awayGraceMs: 300 });
  try {
    const a = await join(s.port, 'p1', 'Rowan', 'dev001');
    const busy = await hello(s.port, { cid: 'dev002', claim: { slot: 'p1', name: 'Rowan', reclaim: true } });
    assert.deepEqual(busy.w, { t: MSG.DENY, code: ERR.SLOT_TAKEN }, 'never while the farmer is playing');
    const plainClaim = await hello(s.port, { cid: 'dev003', claim: { slot: 'p1', name: 'Rowan' } });
    assert.equal(plainClaim.w.code, ERR.SLOT_TAKEN, 'a claim without reclaim is still refused');
    a.c.close();
    await sleep(40);
    const blip = await hello(s.port, { cid: 'dev008', claim: { slot: 'p1', name: 'Rowan', reclaim: true } });
    assert.deepEqual(blip.w, { t: MSG.DENY, code: ERR.SLOT_TAKEN }, 'nor within the reconnect grace (SV-06): a Wi-Fi blip is still playing');
    blip.c.close();
    await sleep(400);
    const r = await hello(s.port, { cid: 'dev004', claim: { slot: 'p1', name: 'Whatever', reclaim: true } });
    assert.equal(r.w.t, MSG.WELCOME);
    assert.equal(r.w.pid, 'p1');
    assert.match(r.w.token, /^[0-9a-f]{64}$/);
    assert.notEqual(r.w.token, a.w.token);
    assert.equal(r.w.state.players.p1.name, 'Rowan', 'the farmer keeps their name');
    const disk = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'farm.json'), 'utf8'));
    assert.ok(disk.server.auth.p1.extra.includes(sha(r.w.token)), 'the new token was durable BEFORE the welcome');
    const old = await resume(s.port, a.w.token, 'dev005');
    assert.equal(old.w.pid, 'p1', 'the first device still resumes');
    const fresh = await resume(s.port, r.w.token, 'dev006');
    assert.equal(fresh.w.pid, 'p1');
    const free = await hello(s.port, { cid: 'dev007', claim: { slot: 'p2', name: 'Mia', reclaim: true } });
    assert.equal(free.w.t, MSG.WELCOME, 'reclaim on a free slot is an ordinary claim');
    closeAll(busy.c, plainClaim.c, r.c, old.c, fresh.c, free.c);
  } finally {
    await s.close();
  }
});

test('with HH_PASSPHRASE: claims and reclaims need it (also online), wrong guesses lock the address out', async () => {
  const s = await testServer({ passphrase: 'barn owl', log: quiet });
  try {
    const slots = await hello(s.port, { cid: 'pass01' });
    assert.equal(slots.w.t, MSG.SLOTS);
    assert.equal(slots.w.pass, true, 'the picker knows to ask');
    const noPass = await hello(s.port, { cid: 'pass02', claim: { slot: 'p1', name: 'Rowan' } });
    assert.equal(noPass.w.code, ERR.PASSPHRASE);
    const ok = await hello(s.port, { cid: 'pass03', claim: { slot: 'p1', name: 'Rowan', pass: 'barn owl' } });
    assert.equal(ok.w.t, MSG.WELCOME);
    const second = await hello(s.port, { cid: 'pass04', claim: { slot: 'p1', name: 'K', pass: 'barn owl', reclaim: true } });
    assert.equal(second.w.t, MSG.WELCOME, 'a second device while the first is online');
    const wrong = [];
    for (let i = 0; i < PASS_FAILS; i++) {
      wrong.push(await hello(s.port, { cid: `wrong${i}`, claim: { slot: 'p1', name: 'K', pass: `guess${i}`, reclaim: true } }));
    }
    assert.ok(wrong.every((x) => x.w.code === ERR.PASSPHRASE));
    const locked = await hello(s.port, { cid: 'lock01', claim: { slot: 'p1', name: 'K', pass: 'barn owl', reclaim: true } });
    assert.equal(locked.w.code, ERR.RATE, 'even the right passphrase waits out the lockout');
    closeAll(slots.c, noPass.c, ok.c, second.c, locked.c, ...wrong.map((x) => x.c));
  } finally {
    await s.close();
  }
});

test('a reconnect of the same tab replaces its stale socket without an offline flicker', async () => {
  const s = await testServer();
  try {
    const a = await join(s.port, 'p1', 'Rowan', 'tabaaa');
    const b = await join(s.port, 'p2', 'Mia', 'tabbbb');
    await sleep(30);
    b.c.msgs.length = 0;
    const again = await resume(s.port, a.w.token, 'tabaaa');
    assert.equal(again.w.t, MSG.WELCOME);
    assert.equal(await a.c.closed, CLOSE.REPLACED);
    await sleep(40);
    assert.deepEqual(b.c.msgs.filter((m) => m.t === MSG.PEER), [], 'the partner saw no leave/join');
    assert.equal([...s.hh.sessions.conns].filter((c) => c.cid === 'tabaaa').length, 1);
    again.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    assert.equal((await again.c.next((m) => m.t === MSG.DELTA)).seq, 1);
    closeAll(again.c, b.c);
  } finally {
    await s.close();
  }
});

test('a full server evicts the oldest connection that never joined; joined players are never evicted', async () => {
  const s = await testServer();
  try {
    const p = await join(s.port, 'p1', 'Rowan');
    const anon = [];
    for (let i = 0; i < LIMITS.MAX_CONNECTIONS - 1; i++) anon.push(await wsClient(s.port));
    await sleep(20);
    const extra = await wsClient(s.port);
    assert.equal(await anon[0].closed, CLOSE.EVICTED);
    extra.send({ t: 'hello', proto: PROTOCOL_VERSION, cid: 'extra1' });
    assert.equal((await extra.next((m) => m.t === MSG.SLOTS)).t, MSG.SLOTS);
    assert.equal(p.c.ws.readyState, 1, 'the player stays');
    closeAll(p.c, extra, ...anon);
  } finally {
    await s.close();
  }
});

test('a connection that never says hello is closed after anonIdleMs; a page on the slot picker is not', async () => {
  const s = await testServer({ heartbeatMs: 40, anonIdleMs: 60 });
  try {
    const x = await wsClient(s.port);
    const picker = await hello(s.port, { cid: 'pick01' });
    assert.equal(picker.w.t, MSG.SLOTS);
    const p = await join(s.port, 'p1', 'Rowan');
    assert.equal(await x.closed, CLOSE.IDLE);
    await sleep(100);
    assert.equal(p.c.ws.readyState, 1, 'a joined player is not idle-closed (it answers pings)');
    assert.equal(picker.c.ws.readyState, 1, 'someone typing their name keeps the picker');
    closeAll(p.c, picker.c);
  } finally {
    await s.close();
  }
});

test('HH_SLOTS limits what can be claimed; the picker lists only open or claimed slots', async () => {
  const s = await testServer({ slots: 1 });
  try {
    const pick = await hello(s.port, { cid: 'slot01' });
    assert.deepEqual(pick.w.slots.map((x) => x.pid), ['p1']);
    const p2 = await hello(s.port, { cid: 'slot02', claim: { slot: 'p2', name: 'Mia' } });
    assert.equal(p2.w.code, ERR.BAD_HELLO);
    closeAll(pick.c, p2.c);
  } finally {
    await s.close();
  }
});

test('social relays: emote whitelist, pings clamped to the world, chat kept for late joiners, floods dropped not punished', async () => {
  const s = await testServer();
  try {
    const a = await join(s.port, 'p1', 'Rowan');
    const b = await join(s.port, 'p2', 'Mia');
    for (let i = 0; i < 30; i++) a.c.send({ t: 'emote', id: 'high_five' });   // far over the 1/s budget
    const e = await b.c.next((m) => m.t === MSG.EMOTE);
    assert.equal(e.id, 'high_five');
    assert.equal(e.pid, 'p1');
    a.c.send({ t: 'mark', x: WORLD_TILES + 9.987, z: -3, kind: 'help' });
    const mk = await b.c.next((m) => m.t === MSG.MARK);
    assert.deepEqual([mk.x, mk.z, mk.kind], [WORLD_TILES + 1, -1, 'help']);
    for (let i = 0; i < 10; i++) a.c.send({ t: 'chat', text: `line ${i}` });
    await sleep(100);
    assert.equal(b.c.msgs.filter((m) => m.t === MSG.EMOTE).length, 0, 'one emote per second: the other 29 dropped');
    assert.equal(a.c.ws.readyState, 1, 'a player mashing keys is not an abuser');
    const conn = [...s.hh.sessions.conns].find((c) => c.pid === 'p1');
    assert.equal(conn.abuse, 0);
    a.c.send({ t: 'emote', id: 'nuke' });                                   // not an emote: garbage
    await sleep(20);
    assert.equal(conn.abuse, 1);
    const late = await join(s.port, 'p1', 'Rowan', 'late01').catch(() => null);
    assert.equal(late.w.code, ERR.SLOT_TAKEN);
    const r = await resume(s.port, a.w.token, 'late02');
    assert.deepEqual(r.w.chat.map((m) => m.text), ['line 0', 'line 1', 'line 2', 'line 3', 'line 4'],
      'the burst of 5 was relayed and kept; the rest dropped');
    closeAll(a.c, b.c, late.c, r.c);
  } finally {
    await s.close();
  }
});
