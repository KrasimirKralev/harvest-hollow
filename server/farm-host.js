// FarmHost (docs/agent-notes/harness-contract.md §2.4): how the multi-farm registry, its routes and the harness talk to
// a loaded farm, wherever it runs. LocalFarm wraps an in-process farm context `hh` (single mode, and multi-mode farms
// without a mod: exactly today's wiring); WorkerFarm proxies a modded multi-mode farm that runs its whole openFarm()
// stack inside a worker_threads Worker (server/farm-worker.js), because content is a module singleton and two farms
// with different mods cannot share a module graph.
//
//   host.kind                    'local' | 'worker'
//   host.hh                      the farm context (local only; null for a worker)
//   host.status()                { conns, online: [pid], degraded, saveError, lastSeenAt }   (sync)
//   host.attach(ws, ip)          a new socket for this farm (the main thread keeps the real ws)
//   host.call(method, ...args)   -> Promise: grantOf(key) whoIs(token) full() inviteState(token) retireInvite() setMeta(patch)
//                                rekey(by, slot, rejoin) waiting() players() denyAll(code) snapshot() applyOverlay(ov, o)
//                                push(msg, { pid? }) devWarp(ms) devDrop(pid) devSave() modInfo()
//   host.stop({ code? }) / host.finish()   stopFarm / finishFarm semantics
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMessage } from './router.js';
import { stopFarm, finishFarm } from './app.js';
import { MSG } from '../shared/net/protocol.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The methods every host answers, on a farm context `hh` (the worker runs the same ones on its own `hh`). */
export function farmMethods(hh) {
  const s = () => hh.sessions;
  return {
    grantOf: (key) => (typeof s().grantOf === 'function' ? s().grantOf(key) : null),
    /** single mode: the slot a token belongs to; multi: a seated member's key. -> { pid } | null */
    whoIs(token) {
      if (typeof token !== 'string' || !token) return null;
      if (typeof s().grantOf === 'function') {
        const g = s().grantOf(token);
        return g && g.kind === 'member' ? { pid: g.pid } : null;
      }
      const pid = s().slotOfToken(token);
      return pid && Object.hasOwn(hh.engine.state.players, pid) ? { pid } : null;
    },
    full: () => s().full(),
    inviteState: (key) => s().inviteState(key),
    retireInvite: () => s().retireInvite(),
    setMeta(patch) { if (s().farm && s().farm.meta !== patch) Object.assign(s().farm.meta, patch); return true; },
    rekey: (by, slot, rejoin) => s().rekey(by, slot, rejoin),
    waiting: () => s().waiting(),
    players: () => Object.keys(hh.engine.state.players),
    denyAll(code) { for (const c of [...s().conns]) s().denyPrivate(c, code); return true; },
    snapshot: () => structuredClone(hh.engine.state),
    async applyOverlay(overlay, o) {
      const { applyToFarm } = await import('./mods/hot.js');
      const { ModStore } = await import('./mods/store.js');
      return applyToFarm(hh, overlay, { ...o, store: new ModStore(hh.harnessDir) });
    },
    /** A harness push to every joined connection, or only `pid`'s. */
    push(msg, { pid = null } = {}) {
      const frame = msg.t ? msg : { t: MSG.HX, ...msg };
      if (!pid) { s().broadcast(frame); return true; }
      for (const c of s().conns) if (c.pid === pid) s().send(c, frame);
      return true;
    },
    devWarp(ms) {
      const now = hh.clock.warp(ms);
      hh.engine.runDue();
      hh.scheduler.arm();
      return now;
    },
    devDrop: (pid) => s().drop(pid),
    async devSave() { await hh.scheduler.save(); return hh.engine.v; },
    modInfo: () => hh.mod ?? null,
  };
}

/** The status a host reports (sync). */
export function farmStatus(hh) {
  return { conns: hh.sessions.conns.size, online: hh.sessions.onlinePids(), degraded: Boolean(hh.engine.degraded),
    saveError: Boolean(hh.persist.stats.lastError), v: hh.engine.v };
}

export class LocalFarm {
  constructor(hh) {
    this.kind = 'local';
    this.hh = hh;
    this.methods = farmMethods(hh);
  }

  status() { return farmStatus(this.hh); }

  attach(ws, ip) {
    const fh = this.hh;
    const conn = fh.sessions.open(ws, ip);
    if (!conn) return null;
    ws.on('pong', () => { conn.missed = 0; });
    ws.on('message', (raw) => handleMessage(fh, conn, raw));
    ws.on('close', () => fh.sessions.close(conn));
    ws.on('error', () => {});
    return conn;
  }

  async call(method, ...args) {
    const fn = this.methods[method];
    if (typeof fn !== 'function') throw new Error(`unknown farm method ${method}`);
    return fn(...args);
  }

  async stop(o) { stopFarm(this.hh, o); }
  async finish() { await finishFarm(this.hh); }
}

/** Only plain data crosses into a worker: the config without functions (log, wall, stand-in fetchers). */
export function plainCfg(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'function' || k === 'log' || k === 'stars') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = plainCfg(v);
    else out[k] = v;
  }
  return out;
}

/**
 * A modded multi-mode farm in its own worker thread. The main thread keeps the real sockets; the worker's Sessions get
 * a WsProxy per connection id (server/farm-worker.js), so sessions.js, outbox.js and router.js run unchanged.
 */
export class WorkerFarm {
  /**
   * @param {{ cfg: object, dir: string, harnessDir: string, meta: object, log: object, persistOpts?: object,
   *   onMeta?: (meta) => void, onEvent?: (ev) => void, onExit?: (code) => void, pendingHx?: object[] }} o
   */
  constructor(o) {
    this.kind = 'worker';
    this.hh = null;
    this.o = o;
    this.conns = new Map();            // connection id -> { ws, buffered }
    this.nextConn = 1;
    this.rpcs = new Map();
    this.nextRpc = 1;
    this.st = { conns: 0, online: [], degraded: false, saveError: false, v: 0 };
    this.stopped = null;
    this.exited = false;
    this.bufTimer = null;
  }

  /** Start the worker; resolves when the farm is open (or rejects: the farm failed to load). */
  start() {
    const { cfg, dir, harnessDir, meta, persistOpts, pendingHx } = this.o;
    this.w = new Worker(path.join(HERE, 'farm-worker.js'), { workerData: { cfg: plainCfg(cfg), dir, harnessDir, meta,
      persistOpts: persistOpts ?? {}, pendingHx: pendingHx ?? [] } });
    this.w.unref?.();
    return new Promise((resolve, reject) => {
      let ready = false;
      this.w.on('message', (m) => {
        if (m.k === 'ready') { ready = true; this.st = m.status; resolve(this); return; }
        if (m.k === 'failed') { reject(new Error(m.error)); return; }
        this.onMessage(m);
      });
      this.w.on('error', (err) => {
        this.o.log.error('a farm worker failed', err);
        if (!ready) reject(err);
      });
      this.w.on('exit', (code) => {
        this.exited = true;
        clearInterval(this.bufTimer);
        for (const [, c] of this.conns) { try { c.ws.terminate(); } catch { /* gone */ } }
        this.conns.clear();
        for (const [, r] of this.rpcs) r.reject(new Error('farm worker stopped'));
        this.rpcs.clear();
        if (this.stoppedResolve) this.stoppedResolve();
        if (!ready) reject(new Error(`farm worker exited (${code})`));
        else if (!this.stopping) this.o.onExit?.(code);
      });
      this.bufTimer = setInterval(() => this.reportBuffers(), 250);
      this.bufTimer.unref?.();
    });
  }

  post(m) { if (!this.exited) this.w.postMessage(m); }

  onMessage(m) {
    switch (m.k) {
      case 'send': {
        const c = this.conns.get(m.c);
        if (!c) return;
        try { c.ws.send(m.data); } catch { /* closing */ }
        this.reportBuffer(m.c, c);
        return;
      }
      case 'wsclose': {
        const c = this.conns.get(m.c);
        if (c) { try { c.ws.close(m.code, m.reason); } catch { c.ws.terminate(); } }
        return;
      }
      case 'terminate': { const c = this.conns.get(m.c); if (c) c.ws.terminate(); return; }
      case 'ping': { const c = this.conns.get(m.c); if (c) { try { c.ws.ping(); } catch { /* gone */ } } return; }
      case 'status': this.st = m.s; if (m.ev) this.o.onEvent?.(m.ev); return;
      case 'meta': this.o.onMeta?.(m.meta); return;
      case 'rpcr': {
        const r = this.rpcs.get(m.id);
        if (!r) return;
        this.rpcs.delete(m.id);
        if (m.meta) this.o.onMeta?.(m.meta);
        if (m.ok) r.resolve(m.v); else r.reject(Object.assign(new Error(m.err), { code: m.code }));
        return;
      }
      case 'log': {
        const fn = this.o.log[m.level] || this.o.log.info;
        fn(...(Array.isArray(m.args) ? m.args : [m.line]));
        return;
      }
      case 'stopped': if (this.stoppedResolve) this.stoppedResolve(); return;
      default:
    }
  }

  reportBuffer(id, c) {
    const n = c.ws.bufferedAmount || 0;
    if (n !== c.buffered && (n >= 16_384 || c.buffered >= 16_384 || n === 0)) {
      c.buffered = n;
      this.post({ k: 'buf', c: id, n });
    }
  }

  reportBuffers() { for (const [id, c] of this.conns) if (c.buffered) this.reportBuffer(id, c); }

  status() { return this.st; }

  attach(ws, ip) {
    if (this.exited) { try { ws.close(1013, 'farm unavailable'); } catch { /* gone */ } return null; }
    const id = this.nextConn++;
    const c = { ws, buffered: 0 };
    this.conns.set(id, c);
    this.st = { ...this.st, conns: this.st.conns + 1 };     // until the worker's own status arrives
    ws.on('pong', () => this.post({ k: 'pong', c: id }));
    ws.on('message', (raw) => this.post({ k: 'msg', c: id, raw: typeof raw === 'string' ? raw : raw.toString('utf8') }));
    ws.on('close', () => { this.conns.delete(id); this.post({ k: 'close', c: id }); });
    ws.on('error', () => {});
    this.post({ k: 'conn', c: id, ip });
    return { id };
  }

  call(method, ...args) {
    if (this.exited) return Promise.reject(new Error('farm worker stopped'));
    const id = this.nextRpc++;
    return new Promise((resolve, reject) => {
      this.rpcs.set(id, { resolve, reject });
      this.post({ k: 'rpc', id, m: method, a: args });
    });
  }

  /** Stop the farm inside the worker (sockets closed with `code`), final snapshot, journal closed; then the thread ends. */
  async stop({ code, reason } = {}) {
    if (this.exited) return;
    this.stopping = true;
    this.stopped ??= new Promise((r) => { this.stoppedResolve = r; });
    this.post({ k: 'stop', code, reason });
  }

  async finish() {
    if (!this.stopped) await this.stop();
    if (!this.exited) {
      const t = setTimeout(() => this.w.terminate(), 30_000);
      await this.stopped;
      clearTimeout(t);
    }
    clearInterval(this.bufTimer);
    if (!this.exited) await this.w.terminate().catch(() => {});
  }
}
