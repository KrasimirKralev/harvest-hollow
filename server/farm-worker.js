// A modded multi-mode farm's worker thread (docs/agent-notes/harness-contract.md §2.4): its own module graph, so its
// own content singleton with that farm's mod overlay installed. Runs the farm's whole openFarm() stack (engine,
// sessions, presence, scheduler, persist); the main thread (server/farm-host.js WorkerFarm) keeps the real sockets and
// relays frames. Messages (structured clone):
//   main -> worker  { k:'conn', c, ip } { k:'msg', c, raw } { k:'close', c } { k:'pong', c } { k:'buf', c, n }
//                   { k:'rpc', id, m, a } { k:'stop', code?, reason? }
//   worker -> main  { k:'ready', status } { k:'failed', error } { k:'send', c, data } { k:'wsclose', c, code, reason }
//                   { k:'terminate', c } { k:'ping', c } { k:'status', s, ev? } { k:'rpcr', id, ok, v | err, meta }
//                   { k:'log', level, args } { k:'meta', meta } { k:'stopped' }
// `pendingHx` (workerData): harness pushes for the farm's farmers that happened while the farm moved into this worker
// (its first mod): each joined farmer gets them once, after their first welcome here (60 s at most).
import { parentPort, workerData } from 'node:worker_threads';
import { openFarm, stopFarm, finishFarm } from './app.js';
import { FarmSessions, parseHello } from './farm-sessions.js';
import { parseClientMessage, MSG } from '../shared/net/protocol.js';
import { handleMessage } from './router.js';
import { farmMethods, farmStatus } from './farm-host.js';

const post = (m) => parentPort.postMessage(m);
const plainArg = (a) => {
  if (a instanceof Error) return { error: a.message, code: a.code };
  if (a === null || typeof a !== 'object') return a;
  try { return JSON.parse(JSON.stringify(a)); } catch { return String(a); }
};
const log = Object.fromEntries(['info', 'warn', 'error', 'log'].map((level) => [level, (...args) => post({ k: 'log', level, args: args.map(plainArg) })]));

/** A socket as Sessions / Outbox / the router see it; the real one lives on the main thread. */
class WsProxy {
  constructor(id) {
    this.id = id;
    this.readyState = 1;
    this.bufferedAmount = 0;
  }

  send(data) { if (this.readyState === 1) post({ k: 'send', c: this.id, data }); }
  close(code, reason) {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    post({ k: 'wsclose', c: this.id, code, reason });
  }

  terminate() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    post({ k: 'terminate', c: this.id });
  }

  ping() { if (this.readyState === 1) post({ k: 'ping', c: this.id }); }
}

const { cfg, dir, harnessDir, meta, persistOpts, pendingHx, build } = workerData;
let hh = null;
const conns = new Map();               // id -> { ws, conn }
let lastStatus = '';
let pending = (pendingHx ?? []).map((msg) => ({ msg, to: new Set(), until: Date.now() + 60_000 }));

const pushStatus = (ev = null) => {
  if (!hh) return;
  const s = farmStatus(hh);
  const key = JSON.stringify(s);
  if (!ev && key === lastStatus) return;
  lastStatus = key;
  post({ k: 'status', s, ...(ev ? { ev } : {}) });
};

async function open() {
  const hooks = {
    meta,
    wall: Date.now,
    saveMeta: () => post({ k: 'meta', meta }),
    onConns: (n) => pushStatus({ e: 'conns', n }),
    onJoin: (pid) => {
      pushStatus({ e: 'join', pid });
      deliverPending();
    },
    onLeave: () => pushStatus({ e: 'leave' }),
  };
  // the main thread serves the files: its build hash goes into the welcome (the worker only reads `.build`)
  hh = await openFarm(cfg, { log, dir, persistOpts, harnessDir, makeSessions: (o) => new FarmSessions(o, hooks),
    staticFiles: build ? { build } : null });
  hh.parse = parseHello(parseClientMessage);
  hh.presence.start();
  hh.sessions.startHeartbeat();
  const methods = farmMethods(hh);
  setInterval(() => pushStatus(), 2000).unref?.();
  return methods;
}

function deliverPending() {
  const now = Date.now();
  pending = pending.filter((p) => p.until > now);
  for (const p of pending) {
    for (const c of hh.sessions.conns) {
      if (!c.pid || p.to.has(c.pid)) continue;
      p.to.add(c.pid);
      // after the welcome this join just sent (the outbox keeps the order)
      hh.sessions.send(c, p.msg.t ? p.msg : { t: MSG.HX, ...p.msg });
    }
  }
}

open().then((methods) => {
  parentPort.on('message', async (m) => {
    switch (m.k) {
      case 'conn': {
        const ws = new WsProxy(m.c);
        const conn = hh.sessions.open(ws, m.ip);
        if (conn) conns.set(m.c, { ws, conn });
        pushStatus();
        return;
      }
      case 'msg': { const x = conns.get(m.c); if (x) handleMessage(hh, x.conn, m.raw); return; }
      case 'close': {
        const x = conns.get(m.c);
        if (!x) return;
        conns.delete(m.c);
        x.ws.readyState = 3;
        hh.sessions.close(x.conn);
        pushStatus();
        return;
      }
      case 'pong': { const x = conns.get(m.c); if (x) x.conn.missed = 0; return; }
      case 'buf': { const x = conns.get(m.c); if (x) x.ws.bufferedAmount = m.n; return; }
      case 'rpc': {
        try {
          const fn = methods[m.m];
          if (typeof fn !== 'function') throw new Error(`unknown farm method ${m.m}`);
          const v = await fn(...(m.a ?? []));
          post({ k: 'rpcr', id: m.id, ok: true, v: v === undefined ? null : v, meta });
        } catch (err) {
          post({ k: 'rpcr', id: m.id, ok: false, err: String(err && err.message), code: err && err.code, meta });
        }
        pushStatus();
        return;
      }
      case 'stop': {
        try {
          stopFarm(hh, m.code ? { code: m.code, reason: m.reason || 'server stopping' } : undefined);
          await finishFarm(hh);
        } catch (err) {
          log.error('stopping a farm worker failed', err);
        }
        post({ k: 'stopped' });
        return;
      }
      default:
    }
  });
  post({ k: 'ready', status: farmStatus(hh) });
}, (err) => {
  log.error('a modded farm could not be loaded; its files are kept as they are', err);
  post({ k: 'failed', error: String(err && err.message) });
});
