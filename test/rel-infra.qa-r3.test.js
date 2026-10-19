// QA round 3 (release 1.0), infra's items: docs/qa/release/qa-r3/fix-infra.md. Each test failed on the tree QA
// tested (a328923) before its fix; the RED lines are in that file.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, ERR, LIMITS, PROTOCOL_VERSION, cleanName, cleanText, parseClientMessage } from '../shared/net/protocol.js';
import { check } from '../shared/rules/schema.js';
import * as Engine from '../server/engine.js';
import { coopHarness, recordEvents, eventTarget } from './helpers/client.js';
import { testServer, join } from './helpers.js';

beforeEach(() => { globalThis.window ??= eventTarget(); });

// ---- I3-01: a move lost in an offline catch-up names the partner ("Mia got there first ♥") --------------------------
// The phone lost the network and planted plots the desktop planted a moment later; the phone came back 12 s on and was
// told only "Something is already growing here": its act reached the server more than TOUCH_MS after the partner's
// plant, so the `rej` carried no `by`. It gets there late two ways: its frame held by the dead link and delivered when
// the link is back (TCP retransmit; Chrome's offline emulation does the same), or re-sent after a welcome. Each act now
// carries `at`, its predicted server time; the server looks back TOUCH_MS + how late it is, up to MAX_OFFLINE_MS.

const A = { pid: 'p1', cid: 'aaaaaa' };
const B = { pid: 'p2', cid: 'bbbbbb' };
const plant = (id, crop = 'wheat') => ({ type: 'plant', args: { id, crop } });

test('I3-01: an act 25 s late, 24 s after the partner\'s plant on its plot, is refused with `by`; a live one keeps 10 s', () => {
  const h = coopHarness();
  const seq = { [A.cid]: 0, [B.cid]: 0 };
  const act = (who, a, extra = {}) => h.engine.act(who, { seq: ++seq[who.cid], ...a, ...extra });
  const predicted = h.clock.now() - 1000;             // the phone planted offline, a second before the desktop
  for (const id of ['home.0.0', 'home.0.1', 'home.0.2', 'home.0.3', 'home.0.4']) assert.equal(act(B, plant(id)), null);
  h.clock.advance(24_000);
  const late = act(A, plant('home.0.0'), { at: predicted });
  assert.equal(late.t, MSG.REJ);
  assert.equal(late.code, ERR.OCCUPIED);
  assert.equal(late.by, 'p2', 'the phone hears "<partner> got there first ♥", not "Something is already growing here"');
  assert.equal(h.engine.rejectedOf(A.cid).at(-1).by, 'p2', 'remembered with `by` (a second disconnect re-says it)');
  assert.equal(act(A, plant('home.0.1'), { at: h.clock.now() }).by, undefined, 'a live act 24 s later is no race (10 s)');
  assert.equal(act(A, plant('home.0.2')).by, undefined, 'an act without `at` (an older client) keeps 10 s');
  assert.equal(act(A, plant('home.0.3'), { at: h.clock.now() - 15_000 }).by, 'p2', '15 s late: 25 s back');
  h.clock.advance(LIMITS.MAX_OFFLINE_MS - 24_000 + 1);
  assert.equal(act(A, plant('home.0.4'), { at: predicted }).by, undefined, 'never further back than MAX_OFFLINE_MS');
  assert.equal(act(A, plant('home.0.0'), { at: h.clock.now() + 60_000 }).by, undefined, 'an `at` ahead is not late');
});

/** The phone (a) predicts 3 plots offline; the desktop (b) plants them and the phone misses the delta; 25 s pass. */
function offlineRace() {
  const h = coopHarness();
  const ids = ['home.0.0', 'home.0.1', 'home.0.2'];
  const rec = recordEvents(h.a.store, ['reject']);
  assert.ok(h.a.store.act('plant', { ids, crop: 'wheat' }).ok, 'predicted on the phone');
  const held = h.a.toServer.splice(0);
  assert.ok(h.b.store.act('plant', { ids, crop: 'wheat' }).ok);
  h.deliverToServer(h.b);
  h.deliverToClient(h.b);
  const heldDown = h.a.toClient.splice(0);            // the desktop's delta, on its way to the phone
  h.clock.advance(25_000);
  const rejects = () => rec.log.filter(([n]) => n === 'reject').map(([, r]) => r);
  const converged = () => {
    assert.equal(JSON.stringify(h.a.store.state.farm.objects), JSON.stringify(h.b.store.state.farm.objects), 'both converge');
    assert.equal(h.a.store.state.farm.wallet.coins, h.b.store.state.farm.wallet.coins, 'the coins too');
  };
  return { h, held, heldDown, rejects, converged };
}

test('I3-01: the phone\'s frame held by the dead link reaches the server 25 s late: a lost race, named', () => {
  const { h, held, heldDown, rejects, converged } = offlineRace();
  assert.equal(held.length, 1);
  h.a.toClient.push(...heldDown);                     // the link is back: what the server sent meanwhile arrives
  const frame = parseClientMessage(held[0]);
  assert.ok(Number.isFinite(frame.at), 'the frame carries its predicted time, and the parser keeps it');
  h.a.toServer.push(frame);                           // the link is back: the same socket delivers it now
  h.flush();
  const [rej] = rejects();
  assert.equal(rej?.code, ERR.OCCUPIED);
  assert.equal(rej.by, 'p2', 'game/feedback.js words a `rej` with `by` as "Rowan те изпревари ♥"');
  assert.equal(rej.local, false);
  converged();
});

test('I3-01: the phone reconnects 25 s later and re-sends its pending act: a lost race, named', () => {
  const { h, rejects, converged } = offlineRace();
  h.a.store.reset(h.welcome(h.a));                    // the welcome; the store re-sends what is still pending
  const frames = h.a.toServer.splice(0).map((m) => parseClientMessage(m));
  assert.equal(frames.length, 1);
  assert.ok(h.clock.now() - frames[0].at >= 25_000, 'the re-sent frame keeps the time it was predicted at');
  h.a.toServer.push(...frames);
  h.flush();
  const [rej] = rejects();
  assert.equal(rej?.code, ERR.OCCUPIED);
  assert.equal(rej.by, 'p2');
  converged();
});

test('I3-01: the parser keeps a finite `at` on an act and on each act of a batch; a bad one is dropped, not the act', () => {
  const T = 1_792_000_000_000;
  assert.deepEqual(parseClientMessage({ t: MSG.ACT, seq: 4, ...plant('home.0.0'), at: T }), { t: MSG.ACT, seq: 4, ...plant('home.0.0'), at: T });
  assert.deepEqual(parseClientMessage({ t: MSG.ACT, seq: 4, ...plant('home.0.0') }), { t: MSG.ACT, seq: 4, ...plant('home.0.0') },
    'no `at`, no key (an older client)');
  const list = parseClientMessage({ t: MSG.ACTS, list: [{ seq: 1, ...plant('home.0.0'), at: T }, { seq: 2, ...plant('home.0.1') }] }).list;
  assert.equal(list[0].at, T);
  assert.equal(Object.hasOwn(list[1], 'at'), false);
  for (const bad of ['1', null, -5, 0, {}, true]) {
    const m = parseClientMessage({ t: MSG.ACT, seq: 4, ...plant('home.0.0'), at: bad });
    assert.deepEqual(m, { t: MSG.ACT, seq: 4, ...plant('home.0.0') }, `at: ${JSON.stringify(bad)}: the act stays, the stamp goes`);
  }
});

test('I3-01: the socket\'s act batch keeps `at` on the wire (one act and an `acts` frame), rounded; NaN never goes out', async (t) => {
  globalThis.document ??= { visibilityState: 'visible', addEventListener() {} };
  globalThis.addEventListener ??= () => {};
  const { Socket } = await import('../public/js/net/socket.js');
  const wire = [];
  class FakeWS {
    static OPEN = 1;
    constructor() { this.readyState = 0; FakeWS.last = this; }
    send(raw) { wire.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
  }
  const prev = globalThis.WebSocket;
  globalThis.WebSocket = FakeWS;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const s = new Socket({ url: 'ws://x/ws', clock: { reset() {}, add() {} }, now: () => 0, onMessage() {} });
    s.connect();
    FakeWS.last.readyState = 1;
    FakeWS.last.onopen();
    s.send({ t: MSG.ACT, seq: 7, ...plant('home.0.0'), at: 1000.4 });
    await null;
    s.send({ t: MSG.ACT, seq: 8, ...plant('home.0.1'), at: 2000 });
    s.send({ t: MSG.ACT, seq: 9, ...plant('home.0.2'), at: NaN });
    await null;
    const acts = wire.filter((m) => m.t === MSG.ACT || m.t === MSG.ACTS).flatMap((m) => (m.t === MSG.ACTS ? m.list : [m]));
    assert.deepEqual(acts.map((a) => [a.seq, a.at ?? null]), [[7, 1000], [8, 2000], [9, null]]);
    assert.equal(wire.filter((m) => m.t === MSG.ACTS).length, 1, 'the second and third went out as one `acts` frame');
    s.stop();
  } finally {
    globalThis.WebSocket = prev;
  }
});

test('I3-01: the touched-target memory stays bounded (TOUCHED_MAX) and keeps the newest', () => {
  const h = coopHarness();
  const e = h.engine;
  const max = Engine.TOUCHED_MAX;
  assert.ok(Number.isSafeInteger(max) && max > 0, 'TOUCHED_MAX is exported');
  // more targets than the cap, all within the 30 s window
  for (let i = 0; i < max + 500; i++) e.touch({ id: `x${i}` }, 'p2', h.clock.now(), 'harvest');
  assert.ok(e.touched.size <= max, `bounded: ${e.touched.size}`);
  assert.equal(e.lastToucher({ id: `x${max + 499}` }, h.clock.now(), 'p1', 'harvest'), 'p2', 'the newest is kept');
  // an entry 25 s old still answers a late act; a later one refreshes its place (the map stays in time order)
  const f = coopHarness().engine;
  f.touch({ id: 'old' }, 'p2', 1000, 'harvest');
  f.touch({ id: 'old' }, 'p2', 2000, 'harvest');
  assert.equal(f.lastToucher({ id: 'old' }, 2000 + 25_000, 'p1', 'harvest', [], LIMITS.MAX_OFFLINE_MS), 'p2');
  assert.equal(f.lastToucher({ id: 'old' }, 2000 + 25_000, 'p1', 'harvest'), undefined, 'the default window stays TOUCH_MS');
});

// ---- I3-C1 (r2 I2-02 carried): the two-marks cap holds whatever stands between the marks ---------------------------
// The cap ran before the strips: an LRM, a lone surrogate or a joiner between the pairs split the run, then the strip
// joined it again, and 20-130 marks stacked on one letter of a chat line or a name on the partner's screen.

const M = '͓͆';                         // two combining marks
const SEPS = [['nothing', ''], ['LRM', '‎'], ['lone surrogate', '\ud800'], ['ZWJ', '‍'], ['ZWNJ', '‌'],
  ['CGJ', '͏'], ['ZWSP', '​'], ['word joiner', '⁠'], ['BOM', '﻿'], ['RLO', '‮'], ['DEL', '\u007f']];
/** Every combining mark in `s` (the input has one letter, so this is "marks on one letter"). */
const marks = (s) => (s.match(/\p{M}/gu) || []).length;
/** The most marks on any one grapheme (what the eye sees stacked; a joiner keeps marks in one cluster). */
const perGrapheme = (s) => Math.max(0, ...[...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)]
  .map((g) => marks(g.segment)));
const lone = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

test('I3-C1: a chat line keeps at most two marks per letter whatever stands between the pairs', () => {
  for (const [what, sep] of SEPS) {
    const out = cleanText(`H${(M + sep).repeat(60)}`, LIMITS.CHAT_MAX, ' ');
    assert.ok(out.startsWith('H'), what);
    assert.ok(perGrapheme(out) <= 2, `${what}: ${perGrapheme(out)} marks on one letter: ${JSON.stringify(out)}`);
    assert.ok(!lone(out), `${what}: no lone surrogate`);
  }
});

test('I3-C1: a name (claim, rename, pet) keeps at most two marks per letter whatever stands between the pairs', () => {
  for (const [what, sep] of SEPS) {
    const out = cleanName(`F${(M + sep).repeat(20)}`);
    assert.ok(out.startsWith('F'), what);
    assert.ok(marks(out) <= 2, `${what}: ${marks(out)} marks on one letter: ${JSON.stringify(out)}`);
    assert.ok(perGrapheme(out) <= 2, what);
  }
});

test('I3-C1: what stays: emoji joiners and variation selectors, Indic joiners, one or two marks, the r2 cap rules', () => {
  for (const s of ['hi ❤️‍🔥', '👩‍🌾 Ann', '1️⃣ 2️⃣', '🏳️‍🌈', 'क्‍ष', 'Ён', 'ệ', 'Éè', 'رضا', 'Деси ♥']) {
    assert.equal(cleanText(s, 200, ' '), s, JSON.stringify(s));
  }
  // the cut never leaves half a pair, and a lone surrogate never survives (r2)
  const cut = cleanName(`${'a'.repeat(15)}🌻`);
  assert.equal(cut, 'a'.repeat(15));
  assert.equal(cleanName('\ud800 lone'), 'lone');
  assert.equal(cleanName('​​'), '', 'nothing visible is no name');
});

test('I3-C1: the frames: a claim and a chat line through the parser; and features\' half (schema text) agrees', () => {
  const claim = (name) => parseClientMessage({ t: MSG.HELLO, proto: PROTOCOL_VERSION, cid: 'abcdef', claim: { slot: 'p1', name } });
  const chat = (text) => parseClientMessage({ t: MSG.CHAT, text });
  for (const [what, sep] of SEPS) {
    assert.ok(perGrapheme(claim(`F${(M + sep).repeat(5)}`).claim.name) <= 2, `claim, ${what}`);
    assert.ok(perGrapheme(chat(`H${(M + sep).repeat(60)}`).text) <= 2, `chat, ${what}`);
    const r = check(['text', 80], `a${(M + sep).repeat(20)}`);           // shared/rules/schema.js (features)
    assert.ok(r.ok && perGrapheme(r.v) <= 2, `game text, ${what}`);
  }
});

test('I3-C1: over a socket: the breaker\'s chat line reaches the partner with two marks per letter', async () => {
  const srv = await testServer();
  try {
    const a = await join(srv.port, 'p1', 'Ann');
    const b = await join(srv.port, 'p2', `B${(M + '\ud800').repeat(5)}`, 'bbbbbb');
    assert.equal(b.w.t, MSG.WELCOME);
    assert.ok(marks(srv.hh.engine.state.players.p2.name) <= 2, 'the stored name: two marks on its letter');
    a.c.send({ t: MSG.CHAT, text: `H${(M + '‍').repeat(60)}` });
    const line = await b.c.next((m) => m.t === MSG.CHAT);
    assert.ok(perGrapheme(line.text) <= 2, JSON.stringify(line.text));
    a.c.close();
    b.c.close();
  } finally {
    await srv.close();
  }
});
