// Shared test helpers: fake clock, farms with joined players, a one-call action runner, and an in-process
// two-client harness (one Engine + two SyncStores over a controllable fake network).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFarm } from '../shared/rules/state.js';
import { runAction, makeCtx, SERVER_GRACE_MS } from '../shared/rules/index.js';
import { applyOps } from '../shared/rules/tx.js';
import assert from 'node:assert/strict';
import { Engine } from '../server/engine.js';
import { SyncStore } from '../public/js/net/sync.js';
import { MSG, PROTOCOL_VERSION } from '../shared/net/protocol.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const T0 = 1_790_000_000_000;   // a fixed epoch for deterministic tests

/** Deterministic PRNG for fuzz tests (tests may use randomness; shared/ may not). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A manual clock: { now(), advance(ms), set(t), observe(t) }. Works as the server clock too. */
export function fakeClock(t = T0) {
  return {
    t,
    now() { return this.t; },
    advance(ms) { this.t += ms; return this.t; },
    set(v) { this.t = v; },
    observe(v) { if (v > this.t) this.t = v; },
  };
}

/** Run a system action directly on a state (bumps meta.version like the engine). */
export function sys(state, type, args, now = T0) {
  const seq = state.meta.version + 1;
  const before = plain(state);
  const r = runAction(state, { type, args }, makeCtx(state, { now, pid: 'sys', cid: 'sys', seq, grace: SERVER_GRACE_MS }));
  assertRecorded(type, before, state, r);
  if (r.ok) state.meta.version = seq;
  return r;
}

/** A fresh farm with p1 (and optionally p2) joined. */
export function makeFarm({ seed = 42, now = T0, players = ['p1', 'p2'] } = {}) {
  const s = createFarm(seed, now);
  const names = { p1: 'Rowan', p2: 'Mia' };
  for (const pid of players) {
    const r = sys(s, '_join', { pid, name: names[pid] || pid }, now);
    if (!r.ok) throw new Error(`join ${pid}: ${r.code}`);
  }
  return s;
}

/** JSON round trip: drops Symbol-keyed caches, so deep-equal compares only replicated data. */
export const plain = (o) => JSON.parse(JSON.stringify(o));

/**
 * The recorder check every action gets for free (review-m0 #6): an accepted action's ops, sent through the
 * wire format and replayed on the prior state, must give exactly the new state (no write bypassed the Tx),
 * and its undo must give exactly the prior state; a rejected action must not have changed anything.
 * Throws an AssertionError naming the action otherwise.
 */
export function assertRecorded(type, before, state, r) {
  if (r.ok) {
    const fwd = structuredClone(before);
    applyOps(fwd, JSON.parse(JSON.stringify(r.tx.ops)));
    assert.deepEqual(plain(fwd), plain(state), `${type}: state changed outside tx.ops (a write through a live reference?)`);
    const back = plain(state);
    applyOps(back, r.tx.inverse());
    assert.deepEqual(plain(back), before, `${type}: undo does not restore the prior state`);
    assert.deepEqual(JSON.parse(JSON.stringify(r.tx.events)), r.tx.events, `${type}: events are not plain JSON`);
  } else {
    assert.deepEqual(plain(state), before, `${type}: a rejected action changed state (${r.code})`);
  }
}

let autoSeq = 0;
/**
 * Run one player action with server semantics (grace on). Returns the runAction result. Every call also
 * verifies that the action was fully recorded (assertRecorded), so every lane's tests catch unrecorded writes.
 * @param {object} state @param {string} type @param {object} args
 * @param {{ pid?: string, cid?: string, seq?: number, now?: number, grace?: number }} [o]
 */
export function run(state, type, args, { pid = 'p1', cid = 'tstcid', seq = ++autoSeq, now = T0, grace = SERVER_GRACE_MS } = {}) {
  const before = plain(state);
  const r = runAction(state, { type, args }, makeCtx(state, { now, pid, cid, seq, grace }));
  assertRecorded(type, before, state, r);
  return r;
}

/** Like run() but throws unless ok. */
export function must(state, type, args, o) {
  const r = run(state, type, args, o);
  if (!r.ok) throw new Error(`${type} ${JSON.stringify(args)} -> ${r.code}${r.err ? `: ${r.err.stack}` : ''}`);
  return r;
}

/** A temp dir on the REAL disk (fsync is a no-op on tmpfs, tech §5.1). */
export function tmpDataDir(name = 'data') {
  const dir = path.join(ROOT, 'test', '.tmp-data', `${name}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * In-process co-op harness: one Engine, two SyncStores (p1 'aaaaaa', p2 'bbbbbb'), and a fake network
 * whose queues you deliver by hand (or randomly) to test every interleaving.
 *   h.a / h.b                 { store, toServer: [], toClient: [] }
 *   h.deliverToServer(c, n?)  process up to n queued frames from client c
 *   h.deliverToClient(c, n?)  deliver up to n queued server frames to client c
 *   h.flush()                 deliver everything until all queues are empty
 */
export function coopHarness({ seed = 7, clock = fakeClock() } = {}) {
  const state = createFarm(seed, clock.now());
  const server = { clock: { lastNow: 0 }, clients: {}, auth: {} };
  const engine = new Engine({ state, server, clock, log: { error() {}, warn() {}, info() {}, log() {} } });
  const clients = {};
  engine.onDelta = (d) => { for (const c of Object.values(clients)) c.toClient.push(structuredClone(d)); };
  for (const [pid, name] of [['p1', 'Rowan'], ['p2', 'Mia']]) engine.system('_join', { pid, name });
  for (const [key, pid, cid] of [['a', 'p1', 'aaaaaa'], ['b', 'p2', 'bbbbbb']]) {
    const c = { key, pid, cid, toServer: [], toClient: [], skew: 0 };
    c.store = new SyncStore({ cid, now: () => clock.now() + c.skew, send: (m) => c.toServer.push(structuredClone(m)), onInternal: (e) => { throw e; } });
    engine.client(cid, pid, clock.now());
    clients[key] = c;
  }
  const welcome = (c) => ({ t: MSG.WELCOME, pid: c.pid, state: structuredClone(state), v: engine.v, serverNow: clock.now(),
    lastSeq: server.clients[c.cid].lastSeq, known: true, rejected: engine.rejectedOf(c.cid), peers: [] });
  for (const c of Object.values(clients)) { c.store.reset(welcome(c)); c.toClient.length = 0; }
  const h = {
    clock, state, server, engine, a: clients.a, b: clients.b,
    welcome,
    deliverToServer(c, n = Infinity) {
      while (n-- > 0 && c.toServer.length) {
        const m = c.toServer.shift();
        if (m.t === MSG.ACT) {
          const reply = engine.act({ pid: c.pid, cid: c.cid }, m);
          if (reply) c.toClient.push(reply);
        } else if (m.t === MSG.RESYNC) {
          c.toClient.push(welcome(c));
        }
      }
    },
    deliverToClient(c, n = Infinity) {
      while (n-- > 0 && c.toClient.length) {
        const m = c.toClient.shift();
        if (m.t === MSG.WELCOME) c.store.reset(m); else c.store.onServer(m);
      }
    },
    flush() {
      for (let guard = 0; guard < 10_000; guard++) {
        const busy = [h.a, h.b].some((c) => c.toServer.length || c.toClient.length);
        if (!busy) return;
        for (const c of [h.a, h.b]) { h.deliverToServer(c); }
        for (const c of [h.a, h.b]) { h.deliverToClient(c); }
      }
      throw new Error('harness did not settle');
    },
  };
  return h;
}

/**
 * A raw WebSocket test client. `next(pred, ms)` resolves with the first message (already received or
 * future) matching pred; `msgs` holds everything received.
 */
export async function wsClient(port, { origin } = {}) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { headers: { origin } } : {});
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    msgs.push(m);
    for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('unexpected-response', () => reject(new Error('rejected'))); });
  return {
    ws, msgs, closed,
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    next(pred, ms = 2000) {
      const seen = msgs.find(pred);
      if (seen) { msgs.splice(msgs.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting for message')); }, ms);
        waiters.push(w);
      });
    },
    close: () => ws.close(),
  };
}

/** Start an in-process server on a free port with a temp data dir on the real disk. */
export async function testServer(extra = {}) {
  const { startServer } = await import('../server/index.js');
  const { loadConfig } = await import('../server/config.js');
  const dataDir = extra.dataDir || tmpDataDir('srv');
  const cfg = { ...loadConfig({}), port: 0, host: '127.0.0.1', dataDir, quiet: true, dev: true, ...extra };
  const s = await startServer(cfg);
  const close = async () => {
    await s.close();
    if (!extra.keep) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { ...s, close, dataDir };
}

/** hello + claim helper: resolves with the welcome. */
export async function join(port, slot, name = slot, cid = `${slot}cid1`.padEnd(6, '0').slice(0, 6)) {
  const c = await wsClient(port);
  c.send({ t: 'hello', proto: PROTOCOL_VERSION, cid, claim: { slot, name } });
  const w = await c.next((m) => m.t === 'welcome' || m.t === 'deny');
  return { c, w, cid };
}
