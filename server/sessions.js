// Sessions: connections, hello/claim/reclaim/tokens, welcome, peers, heartbeat, idle cleanup
// (tech-architecture §3.7, §7 rule 8; lane brief item 4).
//
// Identity: player slots (PLAYER_SLOTS). The first `hello` with a `claim` takes a free slot and receives a random
// token; the server keeps only its SHA-256 (server.auth, private sidecar). A later hello with the token resumes the
// slot. Two tabs of one player are two cids acting as one pid.
//
// Lost token (a new browser, cleared storage): `claim.reclaim: true` on a taken slot issues a NEW token for this
// device and keeps the slot's other devices working (auth[pid] = { tokenHash, extra: [hash, ...] }, newest
// TOKENS_KEPT). The gate:
//   - HH_PASSPHRASE set: the passphrase must match (also while the slot is online: a second device);
//     5 wrong passphrases from one address lock it out for a minute (deny RATE).
//   - no passphrase (the LAN is the trust boundary, as for claims): only a slot that is OFFLINE can be
//     reclaimed, so nobody takes over a farmer who is playing right now.
// The reclaimed token is made durable (a snapshot) BEFORE the welcome, so a crash cannot lose it.
//
// Connections: a newer socket of the same cid (a tab that reconnected before its old socket timed out) REPLACES
// the old one silently (no offline/online flicker); when all MAX_CONNECTIONS are used, the oldest connection that
// never joined is EVICTED to make room (one that never said hello first); a socket that sends no hello within
// anonIdleMs is closed (IDLE; a page on the slot picker has said hello and stays, so a half-typed name survives);
// ws protocol pings every heartbeatMs, two missed = dead.
//
// Leaving (SV-06): when a player's LAST socket closes they stay "online" for AWAY_GRACE_MS. A reconnect within it
// (a Wi-Fi blip, a reload, a laptop lid) is silent: no `peer` leave/arrive, no chime, no `_seen`, the avatar stays
// where it stood. Only when the grace runs out does the player leave: presence, together time, `_seen` (stamped
// with the moment the socket closed) and the `peer` offline message. A stopping server ends every grace at once,
// so the `_seen` lines land before the final snapshot.
//
// Boot (SV-01): no socket survives a restart. awayAtBoot() runs the `_seen` a graceful close would have run for
// every player the save still treats as present (a bench seat, activity newer than their lastSeenAt: a crash or a
// kill -9), stamped with their newest known activity, BEFORE the scheduler's catch-up (stale seats must never start
// Golden Hour with nobody online).
//
// Every message to a connection goes through its Outbox (server/outbox.js): ordered, tick-coalesced,
// back-pressure aware.
import crypto from 'node:crypto';
import { MSG, ERR, LIMITS, PROTOCOL_VERSION, CAPS, CLOSE } from '../shared/net/protocol.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { PLAYER_SLOTS, SLOT_COLORS } from '../shared/content/config.js';
import { SYSTEM_ACTIONS } from '../shared/rules/system.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { makeBuckets } from './ratelimit.js';
import { Outbox } from './outbox.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** Wrong passphrases per address before a lockout, and the lockout window. */
export const PASS_FAILS = 5;
export const PASS_WINDOW_MS = 60_000;
/** A connection that has not joined is closed after this long. */
export const ANON_IDLE_MS = 5 * 60_000;
/** Device tokens kept per slot besides the first one. */
export const TOKENS_KEPT = 8;
/** A player whose last socket closed counts as online this long; a reconnect within it is silent (SV-06). */
export const AWAY_GRACE_MS = 10_000;
/** `_seen` takes the moment the player was last seen (`at`) once the rules accept it (SV-01, optional arg). */
const SEEN_TAKES_AT = Boolean(SYSTEM_ACTIONS._seen && SYSTEM_ACTIONS._seen.schema
  && Object.hasOwn(SYSTEM_ACTIONS._seen.schema, 'at'));

export class Sessions {
  /**
   * @param {{ engine: import('./engine.js').Engine, clock: object, presence: import('./presence.js').Presence,
   *   together?: import('./together.js').Together, cfg: object, log?: Console, save?: () => Promise<void>,
   *   build?: string|null, perf?: import('./perf.js').Perf|null }} o
   */
  constructor({ engine, clock, presence, together = null, cfg, log = console, save = async () => {}, build = null, perf = null }) {
    this.engine = engine;
    this.clock = clock;
    this.presence = presence;
    this.together = together;
    this.cfg = cfg;
    this.log = log;
    this.save = save;
    /** output-wait timings (server/perf.js), or null */
    this.perf = perf;
    /** BUILD_HASH of the game files this server serves (welcome.buildHash, SV-03), or null */
    this.build = build;
    /** @type {Set<object>} */
    this.conns = new Set();
    this.nextId = 1;
    this.hb = null;
    /** relayed chat lines for late joiners (welcome.chat) */
    this.chatLog = [];
    /** ip -> { n, at } wrong passphrases */
    this.passFails = new Map();
    /** pid -> { at, timer }: players whose last socket closed at `at`, still online during the grace (SV-06) */
    this.away = new Map();
    this.graceMs = cfg.awayGraceMs ?? AWAY_GRACE_MS;
    this.stopping = false;
    this.wall = cfg.wall || Date.now;
  }

  get server() { return this.engine.server; }
  get state() { return this.engine.state; }

  /** Register a new socket; returns the conn record, or null when the server is full of joined players. */
  open(ws, ip = '') {
    if (this.conns.size >= LIMITS.MAX_CONNECTIONS) {
      // Evict a socket that never joined: one that never said hello first, then the oldest slot-picker page.
      let oldest = null;
      const rank = (c) => (c.helloAt ? 1 : 0);
      for (const c of this.conns) {
        if (c.pid || c.joining) continue;
        if (!oldest || rank(c) < rank(oldest) || (rank(c) === rank(oldest) && c.openedAt < oldest.openedAt)) oldest = c;
      }
      if (!oldest) {
        ws.close(CLOSE.FULL, 'full');
        return null;
      }
      this.kick(oldest, CLOSE.EVICTED, 'server full');
    }
    const conn = { id: this.nextId++, ws, ip, pid: null, cid: null, missed: 0, buckets: makeBuckets(LIMITS.BUCKETS),
      abuse: 0, abuseAt: 0, openedAt: this.wall(), joining: false };
    conn.out = new Outbox(ws, { onOverflow: (bytes) => {
      this.log.warn('connection fell too far behind; closed so it reconnects with a fresh welcome', { conn: conn.id, pid: conn.pid, bytes });
      this.close(conn);
      ws.terminate();
    }, onWait: this.perf ? (ms) => this.perf.outWait.add(ms) : null });
    this.conns.add(conn);
    return conn;
  }

  /** Queue one message to one connection (`urgent`: flush now, e.g. pong and welcome). */
  send(conn, msg, urgent = false) {
    if (!conn.closed) conn.out.push(JSON.stringify(msg), urgent);
  }

  /** Queue one message to every joined connection (optionally except one pid). Serialized once. */
  broadcast(msg, exceptPid = null) {
    const s = JSON.stringify(msg);
    for (const c of this.conns) if (c.pid && c.pid !== exceptPid) c.out.push(s);
  }

  /**
   * Presence batch (`pr`): merged per connection, held under back-pressure (never blocks a delta). A player's own
   * row is never echoed back to them (SV-08: their avatar is local; the echo doubled the presence downstream).
   */
  presenceOut(msg) {
    let others = null;
    for (const c of this.conns) {
      if (!c.pid) continue;
      others ??= new Map();
      let list = others.get(c.pid);
      if (!list) others.set(c.pid, (list = msg.list.filter((r) => r[0] !== c.pid)));
      if (list.length) c.out.presence(msg.ts, list);
    }
  }

  /** A build ghost: latest wins per sender, held under back-pressure. */
  ghostOut(pid, msg) {
    const s = JSON.stringify(msg);
    for (const c of this.conns) if (c.pid && c.pid !== pid) c.out.ghost(pid, s);
  }

  /** Relay a chat line to everyone (sender included: it is the echo) and keep it for late joiners. */
  chat(msg) {
    this.chatLog.push(msg);
    if (this.chatLog.length > LIMITS.CHAT_KEPT) this.chatLog.shift();
    this.broadcast(msg);
  }

  /** True when `pid` has a joined socket right now. */
  hasSocket(pid) {
    for (const c of this.conns) if (c.pid === pid) return true;
    return false;
  }

  /** Online = a joined socket, or the grace after the last one closed (SV-06). */
  online(pid) { return this.away.has(pid) || this.hasSocket(pid); }

  /** Pids that are online (a joined socket or within the grace). */
  onlinePids() {
    const s = new Set(this.away.keys());
    for (const c of this.conns) if (c.pid) s.add(c.pid);
    return [...s];
  }

  claimed(pid) { return Object.hasOwn(this.state.players, pid) || Object.hasOwn(this.server.auth, pid); }

  /** Slots a new player may claim: the first HH_SLOTS (default 2) of PLAYER_SLOTS. */
  openSlots() { return PLAYER_SLOTS.slice(0, this.cfg.slots ?? 2); }

  /** The slot picker: the open slots plus any slot that is already claimed. */
  slotList() {
    const open = this.openSlots();
    return PLAYER_SLOTS.filter((pid) => open.includes(pid) || this.claimed(pid)).map((pid) => {
      const p = Object.hasOwn(this.state.players, pid) ? this.state.players[pid] : null;
      // the look rides along so a new device's slot picker draws each farmer's portrait as they really look
      return { pid, claimed: this.claimed(pid), name: p ? p.name : null, color: p ? p.color : SLOT_COLORS[pid],
        online: this.online(pid), avatar: p ? p.avatar ?? null : null };
    });
  }

  peers(selfPid) {
    const rows = new Map(this.presence.rows(false).map((r) => [r[0], r]));
    return PLAYER_SLOTS.filter((pid) => pid !== selfPid && Object.hasOwn(this.state.players, pid)).map((pid) => {
      const p = this.state.players[pid];
      return { pid, name: p.name, color: p.color, online: this.online(pid), pose: rows.get(pid) || null };
    });
  }

  /** The slot a token belongs to, or null. */
  slotOfToken(token) {
    const h = sha256(token);
    return PLAYER_SLOTS.find((s) => {
      if (!Object.hasOwn(this.server.auth, s)) return false;
      const a = this.server.auth[s];
      return a.tokenHash === h || (Array.isArray(a.extra) && a.extra.includes(h));
    }) || null;
  }

  passOk(pass) {
    if (typeof pass !== 'string') return false;
    return crypto.timingSafeEqual(Buffer.from(sha256(pass), 'hex'), Buffer.from(sha256(this.cfg.passphrase), 'hex'));
  }

  passLocked(ip) {
    const f = this.passFails.get(ip);
    return Boolean(f && f.n >= PASS_FAILS && this.wall() - f.at < PASS_WINDOW_MS);
  }

  passFailed(ip) {
    const now = this.wall();
    const f = this.passFails.get(ip);
    if (!f || now - f.at >= PASS_WINDOW_MS) this.passFails.set(ip, { n: 1, at: now });
    else { f.n++; f.at = now; }
    this.log.warn('wrong passphrase', { ip, attempts: this.passFails.get(ip).n });
  }

  deny(conn, code) { this.send(conn, { t: MSG.DENY, code }); }

  /** Handle a parsed hello. */
  hello(conn, m) {
    if (conn.pid || conn.joining) return;                // already joined (or joining): ignore repeats
    conn.helloAt ??= this.wall();                        // a real client (maybe on the slot picker): never idle-closed
    if (m.proto !== PROTOCOL_VERSION) return this.deny(conn, ERR.PROTO);
    if (Array.isArray(m.caps) && m.caps.includes(CAPS.BATCH)) conn.out.batch = true;
    // A cid already bound to another player is refused, never re-bound: re-binding would reset its
    // exactly-once record to lastSeq 0 (review-m0 #4).
    const cidOwner = this.engine.knows(m.cid) ? this.server.clients[m.cid].pid : null;
    if (m.token) {
      const pid = this.slotOfToken(m.token);
      if (!pid) return this.deny(conn, ERR.BAD_TOKEN);
      if (cidOwner && cidOwner !== pid) return this.deny(conn, ERR.BAD_HELLO);
      return this.join(conn, pid, m.cid);
    }
    if (!m.claim) return this.send(conn, { t: MSG.SLOTS, slots: this.slotList(), pass: Boolean(this.cfg.passphrase) });
    const { slot, name, color, pass, reclaim } = m.claim;
    if (!PLAYER_SLOTS.includes(slot) || !(this.openSlots().includes(slot) || this.claimed(slot))) return this.deny(conn, ERR.BAD_HELLO);
    if (cidOwner && cidOwner !== slot) return this.deny(conn, ERR.BAD_HELLO);
    if (this.cfg.passphrase && this.passLocked(conn.ip)) return this.deny(conn, ERR.RATE);
    if (!this.claimed(slot)) {
      if (this.cfg.passphrase && !this.passOk(pass)) { this.passFailed(conn.ip); return this.deny(conn, ERR.PASSPHRASE); }
      const args = { pid: slot, name };
      if (color) args.color = color;
      // The token hash is journaled WITH the `_join` line (server-private `srv`), so a crash before the next
      // snapshot cannot recreate the player without a way to resume it (review-m0 H1).
      const token = crypto.randomBytes(32).toString('hex');
      const r = this.engine.system('_join', args, {}, { auth: { [slot]: { tokenHash: sha256(token) } } });
      if (!r.ok) return this.deny(conn, r.code);
      this.passFails.delete(conn.ip);
      this.log.info('slot claimed', { pid: slot, name, ip: conn.ip });
      return this.join(conn, slot, m.cid, token);
    }
    if (!reclaim) return this.deny(conn, ERR.SLOT_TAKEN);
    if (!Object.hasOwn(this.state.players, slot) || !Object.hasOwn(this.server.auth, slot)) return this.deny(conn, ERR.SLOT_TAKEN);
    if (this.cfg.passphrase) {
      if (!this.passOk(pass)) { this.passFailed(conn.ip); return this.deny(conn, ERR.PASSPHRASE); }
    } else if (this.online(slot)) {
      return this.deny(conn, ERR.SLOT_TAKEN);           // without a passphrase only an offline slot is reclaimable
    }
    this.passFails.delete(conn.ip);
    const token = crypto.randomBytes(32).toString('hex');
    const a = this.server.auth[slot];
    a.extra = [...(Array.isArray(a.extra) ? a.extra : []), sha256(token)].slice(-TOKENS_KEPT);
    this.log.info('slot reclaimed on a new device', { pid: slot, ip: conn.ip });
    conn.joining = true;
    // Durable before it is handed out: a token the server forgets after a crash would lock this device out.
    return this.save().catch((err) => this.log.error('snapshot after a reclaim failed', err)).finally(() => {
      conn.joining = false;
      if (!conn.closed) this.join(conn, slot, m.cid, token);
    });
  }

  /** Bind the connection to `pid` and welcome it. */
  join(conn, pid, cid, token) {
    const back = this.away.get(pid);             // reconnected within the grace: nobody hears about the blip
    const firstSocket = !back && !this.hasSocket(pid);
    const known = this.engine.knows(cid);
    if (!this.engine.client(cid, pid, this.clock.now())) return this.deny(conn, ERR.BAD_HELLO);
    conn.pid = pid;
    conn.cid = cid;
    // The same tab reconnected while its old socket still looked alive: the old one is dead weight.
    for (const old of [...this.conns]) {
      if (old !== conn && old.cid === cid && old.pid === pid) {
        this.conns.delete(old);
        old.closed = true;
        old.out.close();
        try { old.ws.close(CLOSE.REPLACED, 'replaced'); } catch { /* already gone */ }
      }
    }
    if (back) {
      clearTimeout(back.timer);
      this.away.delete(pid);
    }
    if (firstSocket) {
      this.presence.join(pid);
      this.together?.setOnline(this.onlinePids(), this.clock.now());
    }
    this.welcome(conn, token, known);
    if (firstSocket) {
      const p = this.state.players[pid];
      this.broadcast({ t: MSG.PEER, pid, online: true, name: p.name, color: p.color }, pid);
    }
  }

  /**
   * Full state to one connection (after hello, and on `resync`).
   * `known` is false only on a hello whose cid had no dedupe record: the client then cannot know whether its
   * unacknowledged actions were applied, and drops them instead of re-sending (review-m0 #4).
   * `rejected` lists the cid's newest rejections, so a `rej` lost in a disconnect still surfaces (L2).
   */
  welcome(conn, token, known = true) {
    clearTimeout(conn.resyncTimer);
    conn.resyncTimer = null;
    this.engine.runDue();
    const rec = this.engine.client(conn.cid, conn.pid, this.clock.now());
    const msg = {
      t: MSG.WELCOME, proto: PROTOCOL_VERSION, pid: conn.pid, state: this.state, v: this.engine.v,
      serverNow: this.clock.now(), lastSeq: rec ? rec.lastSeq : 0, known, rejected: this.engine.rejectedOf(conn.cid),
      // contentHash covers content + config + RULES_VERSION; rulesVersion alone lets a stale tab tell a client-only
      // deploy (same rules: re-send what it predicted during the restart, then reload) from a rules change
      // (remember it and say it was not saved): qa2 SV-01 / CL-02
      contentHash: CONTENT_HASH, rulesVersion: RULES_VERSION, peers: this.peers(conn.pid), chat: this.chatLog,
    };
    if (this.build) msg.buildHash = this.build;
    if (token) msg.token = token;
    this.send(conn, msg, true);
  }

  close(conn) {
    if (!this.conns.delete(conn)) return;
    conn.closed = true;
    conn.out.close();
    clearTimeout(conn.resyncTimer);
    for (const t of Object.values(conn.deferred || {})) clearTimeout(t.timer);
    const pid = conn.pid;
    if (!pid) return;
    const at = this.clock.now();
    this.engine.client(conn.cid, pid, at);       // refresh seenAt: the TTL (and a crash's lastSeenAt) counts from here
    if (this.hasSocket(pid) || this.away.has(pid)) return;
    if (this.stopping || !(this.graceMs > 0)) {
      this.leave(pid, at);
      return;
    }
    const timer = setTimeout(() => this.leave(pid, at), this.graceMs);
    timer.unref?.();
    this.away.set(pid, { at, timer });
  }

  /** The player left (their last socket closed at `at` and the grace is over): tell the farm and the partner. */
  leave(pid, at) {
    const away = this.away.get(pid);
    if (away) {
      clearTimeout(away.timer);
      this.away.delete(pid);
    }
    if (this.hasSocket(pid)) return;
    this.presence.leave(pid);
    this.together?.setOnline(this.onlinePids(), at);
    this.seen(pid, at);
    for (const c of this.conns) c.out.forget(pid);
    const p = this.state.players[pid];
    if (p) this.broadcast({ t: MSG.PEER, pid, online: false, name: p.name, color: p.color });
  }

  /**
   * Journal `_seen` for a player who is gone: lastSeenAt (= `at` once the rules take it), stand up from a bench,
   * and pay the together minutes not yet handed out (SV-07).
   */
  seen(pid, at) {
    const now = this.clock.now();
    const args = { pid };
    if (SEEN_TAKES_AT && Number.isSafeInteger(at)) args.at = Math.min(at, now);
    const ext = this.together ? this.together.system(now, { pay: true }) : {};
    const r = this.engine.system('_seen', args, ext);
    if (r.ok && this.together) this.together.paid(ext.togetherMin, now);
    return r;
  }

  /** The newest moment `pid` is known to have been here: its tabs' dedupe records and the last snapshot's online
   *  list (server.live, written at every snapshot while anyone is online). -Infinity when unknown. */
  lastActive(pid) {
    let at = -Infinity;
    for (const c of Object.values(this.server.clients)) {
      if (c && c.pid === pid && Number.isSafeInteger(c.seenAt) && c.seenAt > at) at = c.seenAt;
    }
    const live = this.server.live;
    if (live && Array.isArray(live.online) && live.online.includes(pid) && Number.isSafeInteger(live.at) && live.at > at) at = live.at;
    return at;
  }

  /** Boot (SV-01): `_seen` for every player the save still treats as present. Returns how many ran. */
  awayAtBoot() {
    let n = 0;
    const bench = this.state.farm.coop && this.state.farm.coop.bench;
    for (const pid of Object.keys(this.state.players).sort()) {
      const p = this.state.players[pid];
      const at = this.lastActive(pid);
      const seated = Boolean(bench && Object.hasOwn(bench, pid));
      if (!seated && !(at > (Number.isSafeInteger(p.lastSeenAt) ? p.lastSeenAt : -Infinity))) continue;
      if (this.seen(pid, at).ok) n++;
    }
    return n;
  }

  /** Close a connection from the server side with a reason code; its bookkeeping happens now. */
  kick(conn, code, reason) {
    this.close(conn);
    try { conn.ws.close(code, reason); } catch { conn.ws.terminate(); }
  }

  /** Dev: cut every socket of a player (simulates a laptop sleep / Wi-Fi drop). */
  drop(pid) {
    let n = 0;
    for (const c of this.conns) if (c.pid === pid) { c.ws.terminate(); n++; }
    return n;
  }

  /** One heartbeat: ws protocol pings (answered natively, unaffected by background-tab throttling, tech §4.6),
   *  dead and idle sockets, dedupe-record pruning. */
  beat() {
    const now = this.wall();
    const idle = this.cfg.anonIdleMs ?? ANON_IDLE_MS;
    for (const c of [...this.conns]) {
      if (!c.pid && !c.joining && !c.helloAt && now - c.openedAt > idle) { this.kick(c, CLOSE.IDLE, 'no hello'); continue; }
      if (++c.missed > 2) { this.close(c); c.ws.terminate(); continue; }   // two pings unanswered
      try { c.ws.ping(); } catch { /* socket already gone */ }
    }
    this.engine.pruneClients(this.clock.now(), new Set([...this.conns].map((c) => c.cid).filter(Boolean)));
    for (const [ip, f] of this.passFails) if (now - f.at >= PASS_WINDOW_MS) this.passFails.delete(ip);
  }

  startHeartbeat() {
    this.hb = setInterval(() => this.beat(), this.cfg.heartbeatMs || LIMITS.HEARTBEAT_MS);
  }

  /** Shutdown: no more heartbeats; every grace ends now, and later closes leave at once. */
  stop() {
    clearInterval(this.hb);
    this.stopping = true;
    for (const [pid, a] of [...this.away]) this.leave(pid, a.at);
  }
}
