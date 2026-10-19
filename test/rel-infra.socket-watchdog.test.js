// M14 (release 1.0, perf-a11y#1): a connection that dies silently (no FIN, no RST: a phone moving from Wi-Fi to
// mobile data) is noticed: the socket says 'reconnecting' within 25 s, a new socket replaces it, and the action made
// meanwhile reaches the server after the welcome. Also: a ping on `online` and on becoming visible with a 5 s
// deadline, and a connect that never opens is abandoned; before the welcome nothing is judged by silence (the server
// says nothing but its answer to the hello, and a farmer may sit on the slot picker). A fake WebSocket in front of the
// real Engine (coopHarness).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../shared/net/protocol.js';
import { coopHarness } from './helpers.js';
import { SyncStore } from '../public/js/net/sync.js';

const listeners = { doc: new Map(), win: new Map() };
const on = (map) => (type, fn) => map.set(type, [...(map.get(type) || []), fn]);
globalThis.document ??= { visibilityState: 'visible', addEventListener: on(listeners.doc) };
globalThis.addEventListener ??= on(listeners.win);
const fire = (map, type) => { for (const fn of map.get(type) || []) fn(); };

/** A WebSocket stand-in wired to the harness's Engine: it answers hello, acts and pings until `silent`. */
function fakeSocketClass(h, c, sockets) {
  return class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.silent = false;
      this.sent = [];
      this.closedByClient = false;
      sockets.push(this);
    }
    open() { this.readyState = 1; this.onopen?.(); }
    deliver(m) { if (!this.silent && this.readyState === 1) this.onmessage?.({ data: JSON.stringify(m) }); }
    send(raw) {
      const m = JSON.parse(raw);
      this.sent.push(m);
      if (this.silent) return;                       // the link is dead: the frame goes nowhere
      if (m.t === MSG.HELLO) { if (!this.holdHello) this.deliver(h.welcome(c)); }   // holdHello: a late welcome
      else if (m.t === MSG.PING) this.deliver({ t: MSG.PONG, c: m.c, s: h.clock.now() });
      else if (m.t === MSG.ACT || m.t === MSG.ACTS) {
        for (const a of m.t === MSG.ACTS ? m.list : [m]) {
          const reply = h.engine.act({ pid: c.pid, cid: c.cid }, { t: MSG.ACT, ...a });
          if (reply) this.deliver(reply);
          // the engine broadcasts its deltas (coopHarness collects them per client)
          for (const d of c.toClient.splice(0)) this.deliver(d);
          h.b.toClient.length = 0;
        }
      }
    }
    close() { this.closedByClient = true; this.readyState = 3; }
  };
}

async function setup() {
  const { Socket } = await import('../public/js/net/socket.js');
  const h = coopHarness();
  const c = h.a;
  const sockets = [];
  globalThis.WebSocket = fakeSocketClass(h, c, sockets);
  let now = 0;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const statuses = [];
  const store = new SyncStore({ cid: c.cid, now: () => h.clock.now(), send: (m) => socket.send(m) });
  const clock = { reset() {}, add() {} };
  const socket = new Socket({ url: 'ws://farm/ws', clock, now: () => now, onStatus: (s) => statuses.push([s, now]),
    onOpen: () => socket.raw({ t: MSG.HELLO, cid: c.cid }),
    onMessage: (m) => { if (m.t === MSG.WELCOME) store.reset(m); else if ([MSG.DELTA, MSG.REJ, MSG.ACK].includes(m.t)) store.onServer(m); } });
  const advance = async (ms) => {
    for (let t = 0; t < ms; t += 100) { now += 100; mock.timers.tick(100); await Promise.resolve(); }
  };
  return { h, c, sockets, socket, store, statuses, advance, now: () => now };
}

test('M14: a socket that goes silent is replaced within 25 s and the action made meanwhile lands', async (t) => {
  const s = await setup();
  t.after(() => mock.timers.reset());
  s.socket.connect();
  s.sockets[0].open();
  await s.advance(500);
  assert.equal(s.socket.status, 'open');
  assert.ok(s.store.state, 'welcomed');
  await s.advance(12_000);                                    // a ping answered: the link was alive
  const silentAt = s.now();
  s.sockets[0].silent = true;
  const r = s.store.act('plant', { id: 'home.0.0', crop: 'wheat' });
  assert.ok(r.ok);
  await s.advance(100);
  assert.equal(s.store.pending.length, 1, 'sent into the dead link, still pending');
  assert.equal(s.h.state.farm.objects['home.0.0'].crop, null, 'the server never got it');
  await s.advance(25_000);
  const rec = s.statuses.find(([st, at]) => st === 'reconnecting' && at > silentAt);
  assert.ok(rec, `reconnecting after a silent drop (statuses ${JSON.stringify(s.statuses)})`);
  assert.ok(rec[1] - silentAt <= 25_000, `within 25 s of the drop: ${rec[1] - silentAt} ms`);
  assert.equal(s.sockets[0].closedByClient, true, 'the dead socket was closed');
  assert.ok(s.sockets.length >= 2, 'a new socket');
  s.sockets.at(-1).open();
  await s.advance(500);
  assert.equal(s.socket.status, 'open');
  assert.equal(s.store.pending.length, 0, 'the pending action was re-sent after the welcome and confirmed');
  assert.equal(s.h.state.farm.objects['home.0.0'].crop?.def, 'wheat', 'the move reached the server');
  s.socket.stop();
});

test('M14: an answered link is never dropped (pongs keep it alive for minutes)', async (t) => {
  const s = await setup();
  t.after(() => mock.timers.reset());
  s.socket.connect();
  s.sockets[0].open();
  await s.advance(180_000);
  assert.equal(s.sockets.length, 1, 'still the first socket');
  assert.deepEqual(s.statuses.map(([st]) => st), ['open']);
  s.socket.stop();
});

test('M14: `online` and becoming visible ping at once and give the link 5 s', async (t) => {
  const s = await setup();
  t.after(() => mock.timers.reset());
  s.socket.connect();
  s.sockets[0].open();
  await s.advance(3000);
  s.sockets[0].silent = true;
  const pingsBefore = s.sockets[0].sent.filter((m) => m.t === MSG.PING).length;
  fire(listeners.win, 'online');
  assert.equal(s.sockets[0].sent.filter((m) => m.t === MSG.PING).length, pingsBefore + 1, 'a ping at once');
  await s.advance(5200);
  assert.ok(s.statuses.some(([st]) => st === 'reconnecting'), `dead 5 s after the unanswered ping ${JSON.stringify(s.statuses)}`);
  await s.advance(400);
  assert.equal(s.sockets.length, 2, 'a new socket after the first backoff step');
  s.sockets.at(-1).open();
  await s.advance(300);
  s.sockets.at(-1).silent = true;
  const n = s.sockets.length;
  globalThis.document.visibilityState = 'visible';
  fire(listeners.doc, 'visibilitychange');
  await s.advance(5200);
  assert.equal(s.statuses.at(-1)[0], 'reconnecting', 'visible again with a dead link: dead within 5 s');
  await s.advance(400);
  assert.ok(s.sockets.length > n, 'and replaced after the first backoff step');
  s.socket.stop();
});

test('M14: a connect that never opens is abandoned and tried again (a slow but legitimate handshake is not)', async (t) => {
  const { CONNECT_TIMEOUT_MS } = await import('../public/js/net/socket.js');
  assert.ok(CONNECT_TIMEOUT_MS > 20_000, 'longer than the server\'s mod boot test (a farm moving into its worker)');
  const s = await setup();
  t.after(() => mock.timers.reset());
  s.socket.connect();
  await s.advance(25_000);
  assert.equal(s.sockets.length, 1, 'still waiting for a slow handshake');
  await s.advance(CONNECT_TIMEOUT_MS - 25_000 + 1000);
  assert.ok(s.sockets.length >= 2, 'a second attempt after the connect timeout');
  assert.equal(s.sockets[0].closedByClient, true);
  s.sockets.at(-1).open();
  await s.advance(300);
  assert.equal(s.socket.status, 'open');
  s.socket.stop();
});

test('M14: a hidden page is never judged by silence (its timers are throttled); visible again, a live link stays', async (t) => {
  const s = await setup();
  t.after(() => { mock.timers.reset(); globalThis.document.visibilityState = 'visible'; });
  s.socket.connect();
  s.sockets[0].open();
  await s.advance(2000);
  globalThis.document.visibilityState = 'hidden';
  s.sockets[0].silent = true;                         // a throttled hidden tab: no pong for a long while
  await s.advance(90_000);
  assert.equal(s.sockets.length, 1, 'not dropped while hidden');
  s.sockets[0].silent = false;                        // the link was fine all along
  globalThis.document.visibilityState = 'visible';
  fire(listeners.doc, 'visibilitychange');
  await s.advance(8000);
  assert.equal(s.sockets.length, 1, 'visible again: the ping is answered, the socket stays');
  assert.deepEqual(s.statuses.map(([st]) => st), ['open']);
  s.socket.stop();
});

test('M14: before the welcome the socket is not judged by silence (a late welcome, a farmer on the slot picker)', async (t) => {
  const s = await setup();
  t.after(() => mock.timers.reset());
  s.socket.connect();
  const ws = s.sockets[0];
  ws.holdHello = true;          // the hello is answered late: a modded farm's worker on a loaded host, or the slot list
  ws.open();                    // and then a person typing a name (the server sends nothing until the next hello)
  await s.advance(40_000);
  assert.equal(s.sockets.length, 1, `the hello's answer is awaited (statuses ${JSON.stringify(s.statuses)})`);
  // the page becomes visible and the network changes meanwhile: no ping before the welcome (the server ignores
  // everything but a hello until then, so an unanswered ping would prove nothing)
  fire(listeners.doc, 'visibilitychange');
  fire(listeners.win, 'online');
  await s.advance(8000);
  assert.equal(s.sockets.length, 1, 'still the first socket');
  assert.ok(!ws.sent.some((m) => m.t === MSG.PING), 'no ping before the welcome');
  ws.deliver(s.h.welcome(s.c));
  await s.advance(500);
  assert.ok(s.store.state, 'welcomed');
  assert.deepEqual(s.statuses.map(([st]) => st), ['open']);
  ws.silent = true;             // from the welcome on, the silence rule holds
  await s.advance(25_000);
  assert.ok(s.statuses.some(([st]) => st === 'reconnecting'), 'a silent link after the welcome is still noticed');
  s.socket.stop();
});
