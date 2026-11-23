// MNKISWAN Tree Village on a static host (GitHub Pages): the farm server runs inside the page.
//
// tools/build-pages.mjs bundles this file (esbuild, IIFE) into the site as local-server.js and loads it with a classic
// <script> before the game's module entry. It opens the farm exactly as server/app.js openFarm() does (the same
// Engine, Sessions, Presence, Together and Scheduler, the same shared rules), with two swaps:
//   - persistence: the snapshot ({ state, server, version }) lives in this browser's IndexedDB (localStorage as the
//     fallback) instead of farm.json + journal. It is written a moment after every accepted action, on the
//     scheduler's autosave, and when the page is hidden or closed.
//   - the socket: globalThis.HH_LOCAL_WS is a WebSocket look-alike that hands frames straight to the server's router
//     (server/router.js handleMessage) and back. public/js/net/socket.js uses it when it is set.
// A small fetch() shim answers the page's /api/status; the other /api/ routes (Harvey, stars, ideas) answer 404, so
// those optional features stay hidden as on any farm without them.
// Only one tab may host the farm at a time (Web Locks): a second tab waits until the first one closes.
import { Engine } from '../server/engine.js';
import { Sessions } from '../server/sessions.js';
import { Presence } from '../server/presence.js';
import { Together } from '../server/together.js';
import { Scheduler } from '../server/scheduler.js';
import { ServerClock } from '../server/clock.js';
import { handleMessage } from '../server/router.js';
import { migrate, backfill, backfillStarter } from '../server/migrations.js';
import { createFarm, validateState, DEFAULT_TZ } from '../shared/rules/state.js';
import { spawnAt } from '../shared/rules/grid.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { parseClientMessage, PROTOCOL_VERSION } from '../shared/net/protocol.js';
import { RULES_VERSION } from '../shared/rules/version.js';

/* global __HH_BUILD__ */
const BUILD = typeof __HH_BUILD__ === 'string' ? __HH_BUILD__ : null;
const DB = 'mnkiswan-tree-village';
const STORE = 'farm';
const LS_KEY = 'mnkiswan.treeVillage.save';
const SAVE_DEBOUNCE_MS = 1500;

const log = {
  info: (...a) => console.info('[village]', ...a),
  warn: (...a) => console.warn('[village]', ...a),
  error: (...a) => console.error('[village]', ...a),
  debug: () => {},
};

// ---- storage: IndexedDB, localStorage fallback -------------------------------------------------------------------
function idb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let dbp = null;
const db = () => (dbp ??= idb());

/** The newest of the two copies (the page's last moments may reach localStorage but not IndexedDB). */
async function loadSave() {
  let fromDb = null;
  let fromLs = null;
  try {
    const d = await db();
    const v = await new Promise((resolve, reject) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get('save');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (typeof v === 'string') fromDb = JSON.parse(v);
  } catch (err) {
    log.warn('IndexedDB load failed; trying localStorage', err);
  }
  try {
    const s = localStorage.getItem(LS_KEY);
    fromLs = s ? JSON.parse(s) : null;
  } catch { /* blocked or broken */ }
  const at = (s) => (s && s.state && Number.isFinite(s.at) ? s.at : -1);
  return at(fromLs) > at(fromDb) ? fromLs : fromDb;
}

async function writeSave(text) {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(text, 'save');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return;
  } catch (err) {
    log.warn('IndexedDB save failed; using localStorage', err);
  }
  localStorage.setItem(LS_KEY, text);
}

/** The Persist interface the Engine (journal) and the Scheduler (snapshot, syncTick) use, browser-sized. */
class BrowserPersist {
  constructor() {
    this.stats = { lastSaveAt: null, lastSaveV: null, lastBackupAt: null, lastError: null, journaled: 0 };
    this.timer = null;
    this.getCut = null;
    this.chain = Promise.resolve();
  }
  /** Every accepted action: a snapshot follows shortly (the journal of the Node server, collapsed). */
  append() {
    this.stats.journaled++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }
  syncTick() {}
  incident(name, data) { log.warn(`incident ${name}`, data); }
  close() {}
  serialize(cut) {
    return JSON.stringify({ app: 'mnkiswan-tree-village', state: cut.state, server: cut.server, version: cut.version, at: Date.now() });
  }
  snapshot(getCut) {
    this.getCut = getCut;
    const text = this.serialize(getCut());
    this.chain = this.chain.then(() => writeSave(text)).then(() => {
      this.stats.lastSaveAt = Date.now();
      this.stats.journaled = 0;
      this.stats.lastError = null;
    }, (err) => { this.stats.lastError = String(err?.message || err); log.error('save failed', err); });
    return this.chain;
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.getCut) return this.snapshot(this.getCut);
    return this.chain;
  }
  /** The page is going away: a synchronous copy in localStorage too (IndexedDB may not finish in time). */
  flushSync() {
    if (!this.getCut) return;
    try { localStorage.setItem(LS_KEY, this.serialize(this.getCut())); } catch { /* full or blocked */ }
    this.flush();
  }
}

// ---- the farm ----------------------------------------------------------------------------------------------------
function machineTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

async function openFarm() {
  const cfg = { dev: false, tz: machineTz(), tzExplicit: false, passphrase: null, slots: 2, snapshotMs: 30_000,
    version: 'pages', root: '' };
  const persist = new BrowserPersist();
  const snap = await loadSave();
  let state;
  let server;
  if (snap && snap.state) {
    try {
      state = migrate(snap.state, { log });
      server = snap.server || {};
    } catch (err) {
      log.error('the saved village could not be loaded; starting a new one (the old save is kept as a backup)', err);
      try { localStorage.setItem(`${LS_KEY}.broken.${Date.now()}`, JSON.stringify(snap)); } catch { /* too big */ }
    }
  }
  if (!state) {
    state = createFarm(randomSeed(), Date.now(), cfg.tz);
    server = {};
    log.info('a new village was created');
  }
  server = { clock: { lastNow: 0, devOffset: 0 }, clients: {}, auth: {}, ...server };
  const clock = new ServerClock(server.clock, { dev: false, log });
  if (snap) {
    backfill(state, { now: clock.now(), tz: cfg.tz });
    backfillStarter(state, { now: clock.now() });
  }
  state.meta.contentHash = CONTENT_HASH;
  if (typeof state.meta.tz !== 'string') state.meta.tz = cfg.tz;
  const problems = validateState(state, { now: clock.now() });
  if (problems.length) log.warn(`loaded state has ${problems.length} problem(s)`, problems);

  const engine = new Engine({ state, server, clock, dev: false, log });
  engine.journal = persist;
  engine.incident = (name, data) => persist.incident(name, data);
  const hh = { cfg, log, persist, engine, clock, parse: parseClientMessage, startedAt: Date.now(), perf: null };
  hh.static = { build: BUILD };
  hh.presence = new Presence(clock, (msg) => hh.sessions.presenceOut(msg), { spawnOf: (pid) => spawnAt(engine.state, pid) });
  const saved = server.live && server.live.together;
  hh.together = new Together({ online: () => hh.sessions.onlinePids(), poses: () => hh.presence.p,
    acc: saved && Number.isSafeInteger(saved.acc) ? saved.acc : 0 });
  hh.sessions = new Sessions({ engine, clock, presence: hh.presence, together: hh.together, cfg, log,
    save: () => hh.scheduler.save(), build: BUILD, perf: null });
  hh.scheduler = new Scheduler({ engine, persist, clock, cfg, log, perf: null,
    live: () => ({ online: hh.sessions.onlinePids().sort(), together: hh.together.snapshot(clock.now()) }) });
  engine.facts = hh.together;
  engine.onDelta = (d) => hh.sessions.broadcast(d);
  engine.onCommit = () => hh.scheduler.requestArm();
  hh.sessions.awayAtBoot();
  hh.scheduler.start();
  await hh.scheduler.save();
  hh.presence.start();
  hh.sessions.startHeartbeat();
  const away = () => persist.flushSync();
  addEventListener('pagehide', away);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away(); });
  return hh;
}

// ---- one tab hosts the village -------------------------------------------------------------------------------------
function hostLock() {
  if (!navigator.locks?.request) return Promise.resolve();
  return new Promise((resolve) => {
    let waiting = null;
    navigator.locks.request('mnkiswan-tree-village-host', { ifAvailable: true }, (lock) => {
      if (lock) { resolve(); return new Promise(() => {}); }     // held for the life of this tab
      waiting = showBusy();
      return navigator.locks.request('mnkiswan-tree-village-host', () => {
        waiting?.remove();
        resolve();
        return new Promise(() => {});
      });
    });
  });
}

function showBusy() {
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;inset:auto 0 24px 0;margin:auto;width:min(92vw,460px);z-index:99999;padding:14px 18px;'
    + 'border-radius:14px;background:#fff6df;color:#315343;font:600 16px/1.35 system-ui,sans-serif;text-align:center;'
    + 'box-shadow:0 6px 24px rgba(0,0,0,.25)';
  el.textContent = 'MNKISWAN Tree Village is already open in another tab. Close that tab and the village opens here.';
  const add = () => document.body.appendChild(el);
  if (document.body) add(); else addEventListener('DOMContentLoaded', add, { once: true });
  return el;
}

let hhp = null;
const ready = () => (hhp ??= hostLock().then(openFarm).catch((err) => {
  log.error('the village could not start', err);
  throw err;
}));

// ---- the in-page socket --------------------------------------------------------------------------------------------
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/** The server's end of one LocalSocket: what Sessions and the Outbox call `ws`. */
class ServerEnd {
  constructor(client) {
    this.client = client;
    this.readyState = OPEN;
    this.bufferedAmount = 0;
    this.onPong = () => {};
  }
  send(s) {
    if (this.readyState !== OPEN) return;
    const data = String(s);
    queueMicrotask(() => this.client.deliver(data));
  }
  ping() { queueMicrotask(() => this.onPong()); }
  close(code = 1000, reason = '') {
    if (this.readyState >= CLOSING) return;
    this.readyState = CLOSED;
    this.client.serverClosed(code, reason);
  }
  terminate() { this.close(1006, ''); }
}

class LocalSocket {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = CLOSING;
  static CLOSED = CLOSED;

  constructor(url) {
    this.url = url;
    this.readyState = CONNECTING;
    this.bufferedAmount = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.server = null;
    this.conn = null;
    this.hh = null;
    ready().then((hh) => {
      if (this.readyState !== CONNECTING) return;
      this.hh = hh;
      this.server = new ServerEnd(this);
      this.conn = hh.sessions.open(this.server, 'local');
      if (!this.conn) return;
      this.server.onPong = () => { if (this.conn) this.conn.missed = 0; };
      this.readyState = OPEN;
      this.onopen?.({ type: 'open' });
    }, () => {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      this.onerror?.({ type: 'error' });
      this.onclose?.({ type: 'close', code: 1011, reason: 'the village could not start', wasClean: false });
    });
  }

  send(data) {
    if (this.readyState !== OPEN) return;
    const raw = String(data);
    queueMicrotask(() => { if (this.conn && !this.conn.closed) handleMessage(this.hh, this.conn, raw); });
  }

  deliver(data) {
    if (this.readyState !== OPEN) return;
    this.onmessage?.({ type: 'message', data });
  }

  /** The server closed its end. */
  serverClosed(code, reason) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    if (this.conn) this.hh.sessions.close(this.conn);
    queueMicrotask(() => this.onclose?.({ type: 'close', code, reason, wasClean: code === 1000 }));
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= CLOSING) return;
    const wasConnecting = this.readyState === CONNECTING;
    this.readyState = CLOSED;
    if (this.server) this.server.readyState = CLOSED;
    if (this.conn) this.hh.sessions.close(this.conn);
    if (!wasConnecting || this.onclose) queueMicrotask(() => this.onclose?.({ type: 'close', code, reason, wasClean: true }));
  }
}

// ---- /api/ on this page ------------------------------------------------------------------------------------------
function statusOf(hh) {
  const now = hh.clock.now();
  const ps = hh.persist.stats;
  return {
    ok: !hh.engine.degraded && !ps.lastError, degraded: hh.engine.degraded, version: hh.cfg.version, proto: PROTOCOL_VERSION,
    rules: RULES_VERSION, contentHash: CONTENT_HASH, buildHash: BUILD, assets: null, schema: hh.engine.state.schema,
    v: hh.engine.v, serverNow: now, startedAt: hh.startedAt, uptimeS: Math.floor((Date.now() - hh.startedAt) / 1000),
    tz: hh.engine.state.meta.tz, dev: false, slots: hh.sessions.slotList(), online: hh.sessions.onlinePids().sort(),
    connections: hh.sessions.conns.size,
    save: { lastAt: ps.lastSaveAt, lastV: ps.lastSaveV, lastBackupAt: null, lastError: ps.lastError, journaled: ps.journaled },
    nextSystemDueAt: hh.scheduler.dueAt, perf: null, host: 'browser',
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function villageFetch(input, init) {
  let url;
  try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href); } catch { url = null; }
  if (url && url.origin === location.origin && /^\/api\//.test(url.pathname)) {
    if (url.pathname === '/api/status') return json(statusOf(await ready()));
    return json({ error: 'not available in the browser version' }, 404);
  }
  return realFetch(input, init);
};

globalThis.HH_LOCAL_WS = LocalSocket;
globalThis.__village = {
  ready,
  /** Download this village's save as a JSON file (a backup). */
  async exportSave() {
    const hh = await ready();
    await hh.scheduler.save();
    return hh.persist.serialize(hh.scheduler.cut());
  },
  /** Replace this village with a save made by exportSave() (the page reloads). */
  async importSave(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.state) throw new Error('not a village save');
    const hh = await ready();
    hh.scheduler.stop();
    hh.persist.getCut = null;
    await writeSave(JSON.stringify(parsed));
    try { localStorage.setItem(LS_KEY, JSON.stringify(parsed)); } catch { /* IndexedDB has it */ }
    location.reload();
  },
  /** Start over with a brand-new village (the page reloads). */
  async reset() {
    const hh = await ready();
    hh.scheduler.stop();
    hh.persist.getCut = null;
    clearTimeout(hh.persist.timer);
    await writeSave('null');
    try { localStorage.removeItem(LS_KEY); } catch { /* blocked */ }
    for (const k of Object.keys(localStorage)) if (k.startsWith('hh.')) localStorage.removeItem(k);
    location.reload();
  },
};
// start opening the village now, in parallel with the game's own module graph
ready().catch(() => {});
