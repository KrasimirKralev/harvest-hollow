// Sessions of ONE farm on the multi-farm host (HH_MODE=multi, server/multi.js). Everything a single-farm server does
// (server/sessions.js) stays; only who may sit down changes, because the farm is on the public internet:
//
//   - the creator's secret (POST /api/farms -> { id, secret }) claims the reserved first slot (p1) once; it then IS
//     that farmer's token, so the same secret keeps working as their personal link (/f/<id>#k=<secret>)
//   - a valid invite token (POST /api/f/:id/invite -> { token }) claims a free slot once; the welcome hands out a
//     fresh member secret (welcome.token) the way a single-farm claim does
//   - a member's secret (welcome.token, any device) resumes that farmer, exactly like a single-farm token
//   - a rejoin token (POST /api/f/:id/rekey -> { token }: another farmer made a NEW KEY for this farmer) seats its
//     holder once as that very farmer (name, look, progress kept; the claim may carry a new name); the welcome hands
//     out a fresh member secret. Making it turned every older key of that farmer off (`_key` journals the empty
//     key record) and signed their devices out (deny REKEYED, then close)
//
// Where a key rides: `hello.token` (the client sends every key there), `hello.join` (an invite; read by
// parseHello below, the shared parser drops unknown fields) or `hello.claim.pass`. A key presented on a connection
// is remembered for it, so the usual flow works unchanged: hello { token: key } -> `slots` (only the slot this key
// may take) -> hello { claim: { slot, name, color? }, token: key } -> `welcome` (+ `token` on a claim).
//
// Refusals (`deny { code }`; nothing of the farm is sent, and the socket then closes with PRIVATE_CLOSE):
//   PRIVATE  no valid key at all (also a hello with no key)
//   INVITE   an invite this farm issued that is expired, used or replaced (and the farm still has room)
//   FULL     an invite (current or used) for a farm whose slots are all taken
//   BAD_TOKEN (socket stays open) a hello.token that is no key of this farm: the client forgets it and says hello
//            again with its next way in, exactly as in single mode
//   REKEYED  (socket stays open) a farmer's key turned off by a new key: nothing of the farm, and the device may try
//            the next key it holds (a home-screen app's start URL keeps an old key forever)
//   REJOIN   (socket stays open) a rejoin token that was used, expired, or replaced by a newer one
//   DELETED  one of the farmers deleted the farm (POST /api/f/:id/delete): every open screen hears it, then the close
// `claim.reclaim` is refused (SLOT_TAKEN): the personal link replaces the passphrase.
//
// Keys are compared as SHA-256 hashes with crypto.timingSafeEqual over every stored hash (no early exit), and no
// key, hash, farm id or client address is ever logged (a connection's `ip` here is only its network: server/multi.js).
import crypto from 'node:crypto';
import { Sessions } from './sessions.js';
import { MSG, ERR, PROTOCOL_VERSION, CAPS } from '../shared/net/protocol.js';
import { PLAYER_SLOTS } from '../shared/content/config.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Constant-time equality of two hex digests (false for anything malformed). */
export function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** WebSocket close code after a refused hello: the client shows its farm gate and stops reconnecting. */
export const PRIVATE_CLOSE = 4403;
/** Multi-mode deny codes (strings on the wire; shared/net/protocol.js ERR is unchanged). */
export const MF_ERR = Object.freeze({ PRIVATE: 'PRIVATE', INVITE: 'INVITE', FULL: 'FULL', REKEYED: 'REKEYED', REJOIN: 'REJOIN',
  DELETED: 'DELETED' });
/** Used or replaced invites remembered per farm (hashes), so their holder hears INVITE / FULL instead of PRIVATE. */
export const PAST_INVITES = 8;
/** Used or replaced rejoin tokens remembered per farm (hashes): their holder hears REJOIN. */
export const PAST_REJOINS = 8;
/** Turned-off member keys remembered per farm (hashes): their old devices hear REKEYED instead of BAD_TOKEN. */
export const REVOKED_KEPT = 32;
/** A rejoin token works this long (or until it is used, or a newer one replaces it). */
export const REJOIN_TTL_MS = 7 * 86_400_000;
const KEY_RE = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * The shared hello parser plus `join` (an invite token) for multi mode; every other frame is parsed unchanged.
 * @param {(m: unknown) => object|null} parse  shared/net/protocol.js parseClientMessage
 */
export function parseHello(parse) {
  return (msg) => {
    const out = parse(msg);
    if (out && out.t === MSG.HELLO && msg.join !== undefined) {
      if (typeof msg.join !== 'string' || !KEY_RE.test(msg.join)) return null;
      out.join = msg.join;
    }
    return out;
  };
}

/** A member secret: 256 bits, hex (fits hello.token). */
export const newSecret = () => crypto.randomBytes(32).toString('hex');
/** An invite token: 128 bits, hex (fits hello.token and claim.pass). */
export const newInviteToken = () => crypto.randomBytes(16).toString('hex');

export class FarmSessions extends Sessions {
  /**
   * @param {object} o  the Sessions options
   * @param {{ meta: object, saveMeta: () => void, wall?: () => number, onConns?: (n: number) => void,
   *   onJoin?: (pid: string) => void, onLeave?: () => void }} farm  the registry record's hooks (server/farms.js)
   */
  constructor(o, farm) {
    super(o);
    this.farm = farm;
    this.farmWall = farm.wall || Date.now;
  }

  get meta() { return this.farm.meta; }

  /** The slot a member secret belongs to, or null. Every stored hash is compared (constant time per farm). */
  slotOfToken(token) {
    const h = sha256(token);
    let found = null;
    for (const s of PLAYER_SLOTS) {
      if (!Object.hasOwn(this.server.auth, s)) continue;
      const a = this.server.auth[s];
      for (const x of [a.tokenHash, ...(Array.isArray(a.extra) ? a.extra : [])]) {
        if (sameHash(x, h) && !found) found = s;
      }
    }
    return found;
  }

  /** The creator's reservation while it is unused: { slot, hash } or null. */
  reservation() {
    const r = this.meta.reserve;
    return r && typeof r.hash === 'string' && !this.claimed(r.slot) ? r : null;
  }

  /** Slots an invited friend may take (open, unclaimed, not reserved for the creator). */
  freeSlots() {
    const r = this.reservation();
    return this.openSlots().filter((s) => !this.claimed(s) && !(r && r.slot === s));
  }

  /** True when every open slot is taken or reserved. */
  full() { return this.freeSlots().length === 0; }

  /** 'ok' | 'expired' | 'used' | 'full' | null (no invite of this farm) for an invite token. */
  inviteState(key) {
    if (typeof key !== 'string' || !key) return null;
    const h = sha256(key);
    const inv = this.meta.invite;
    let st = null;
    if (inv && sameHash(inv.hash, h)) st = this.farmWall() >= inv.exp ? 'expired' : 'ok';
    let past = false;
    for (const x of Array.isArray(this.meta.pastInvites) ? this.meta.pastInvites : []) if (sameHash(x, h)) past = true;
    if (!st && past) st = 'used';
    if (st && this.full()) return 'full';
    return st;
  }

  /** Retire the current invite (used, replaced or the farm is full): its holder hears INVITE / FULL, not PRIVATE. */
  retireInvite() {
    const inv = this.meta.invite;
    if (!inv) return;
    this.meta.pastInvites = [...(Array.isArray(this.meta.pastInvites) ? this.meta.pastInvites : []), inv.hash].slice(-PAST_INVITES);
    this.meta.invite = null;
  }

  /** { st: 'ok' | 'expired' | 'used', slot } for a rejoin token of this farm, else null. Constant time per hash. */
  rejoinState(key) {
    if (typeof key !== 'string' || !key) return null;
    const h = sha256(key);
    const open = this.meta.rejoin && typeof this.meta.rejoin === 'object' ? this.meta.rejoin : {};
    let hit = null;
    for (const slot of PLAYER_SLOTS) {
      const e = Object.hasOwn(open, slot) ? open[slot] : null;
      if (e && sameHash(e.hash, h) && !hit) hit = { slot, e };
    }
    let past = false;
    for (const x of Array.isArray(this.meta.pastRejoins) ? this.meta.pastRejoins : []) if (sameHash(x, h)) past = true;
    if (hit) {
      const live = this.farmWall() < hit.e.exp && Object.hasOwn(this.state.players, hit.slot);
      return { st: live ? 'ok' : 'expired', slot: hit.slot };
    }
    return past ? { st: 'used', slot: null } : null;
  }

  /** True when `key` is a member key this farm turned off (a new key was made for its farmer). */
  revoked(key) {
    const h = sha256(key);
    let hit = false;
    for (const r of Array.isArray(this.meta.revoked) ? this.meta.revoked : []) if (r && sameHash(r.hash, h)) hit = true;
    return hit;
  }

  /** Retire a farmer's open rejoin token (used, or replaced by a newer one): its holder hears REJOIN. */
  retireRejoin(slot) {
    const open = this.meta.rejoin && typeof this.meta.rejoin === 'object' ? this.meta.rejoin : null;
    if (!open || !Object.hasOwn(open, slot)) return;
    this.meta.pastRejoins = [...(Array.isArray(this.meta.pastRejoins) ? this.meta.pastRejoins : []), open[slot].hash].slice(-PAST_REJOINS);
    const { [slot]: _gone, ...rest } = open;
    this.meta.rejoin = rest;
  }

  /** The seats waiting for their new key (members see this in the farm status): { [pid]: { at, exp, by } }. */
  waiting() {
    const open = this.meta.rejoin && typeof this.meta.rejoin === 'object' ? this.meta.rejoin : {};
    const now = this.farmWall();
    const out = {};
    for (const slot of PLAYER_SLOTS) {
      const e = Object.hasOwn(open, slot) ? open[slot] : null;
      if (e && now < e.exp && Object.hasOwn(this.state.players, slot)) out[slot] = { at: e.at, exp: e.exp, by: e.by };
    }
    return out;
  }

  /**
   * A new key for farmer `slot`, made by farmer `by` (server/farms.js rekey holds the token itself): every device of
   * that farmer is signed out (deny REKEYED, close), every key they had stops working (journaled with `_key`, so a
   * crash keeps the change), and `rejoin` ({ hash, at, exp }) becomes their one way back. Returns null, or a refusal
   * code ('BAD': not another farmer of this farm; an engine code when the journal refused).
   */
  rekey(by, slot, rejoin) {
    const players = this.state.players;
    if (!PLAYER_SLOTS.includes(slot) || slot === by || !Object.hasOwn(players, slot) || !Object.hasOwn(players, by)) return 'BAD';
    const a = Object.hasOwn(this.server.auth, slot) ? this.server.auth[slot] : null;
    const old = a ? [a.tokenHash, ...(Array.isArray(a.extra) ? a.extra : [])].filter((x) => typeof x === 'string' && x) : [];
    // signed out first: the old devices get nothing of the farm after this moment, not even this change's feed line
    for (const c of [...this.conns]) if (c.pid === slot) this.denyPrivate(c, MF_ERR.REKEYED);
    const r = this.engine.system('_key', { pid: slot, what: 'new', by }, {}, { auth: { [slot]: { tokenHash: '', extra: [] } } });
    if (!r.ok) return r.code || ERR.INTERNAL;
    this.meta.revoked = [...(Array.isArray(this.meta.revoked) ? this.meta.revoked : []),
      ...old.map((hash) => ({ hash, pid: slot, at: rejoin.at }))].slice(-REVOKED_KEPT);
    this.retireRejoin(slot);
    this.meta.rejoin = { ...(this.meta.rejoin && typeof this.meta.rejoin === 'object' ? this.meta.rejoin : {}),
      [slot]: { hash: rejoin.hash, at: rejoin.at, exp: rejoin.exp, by } };
    this.log.info('a farmer was given a new key', { pid: slot, by });
    return null;
  }

  /**
   * What a presented key grants on this farm: { kind: 'member', pid } | { kind: 'creator', slot, key } |
   * { kind: 'invite', key } | { kind: 'rejoin', slot, key } | { kind: 'refused', code } (an invite or rejoin token
   * that no longer works, a member key turned off by a new key) | null (no key of this farm).
   */
  grantOf(key) {
    if (typeof key !== 'string' || !key) return null;
    const pid = this.slotOfToken(key);
    if (pid && Object.hasOwn(this.state.players, pid)) return { kind: 'member', pid };
    const r = this.reservation();
    if (r && sameHash(r.hash, sha256(key))) return { kind: 'creator', slot: r.slot, key };
    const rj = this.rejoinState(key);
    if (rj) return rj.st === 'ok' ? { kind: 'rejoin', slot: rj.slot, key } : { kind: 'refused', code: MF_ERR.REJOIN };
    const inv = this.inviteState(key);
    if (inv === 'ok') return { kind: 'invite', key };
    if (inv) return { kind: 'refused', code: inv === 'full' ? MF_ERR.FULL : MF_ERR.INVITE };
    if (this.revoked(key)) return { kind: 'refused', code: MF_ERR.REKEYED };
    return null;
  }

  /** A refused hello: nothing of the farm is sent; the socket closes so a stale page cannot loop on hellos. */
  denyPrivate(conn, code = MF_ERR.PRIVATE) {
    this.send(conn, { t: MSG.DENY, code }, true);
    conn.out.flush();                              // written now: the close below discards anything still queued
    this.kick(conn, PRIVATE_CLOSE, 'private');
  }

  /** The slot picker for a key holder: only the slot(s) this key may take (the creator's or the rejoin's own farmer,
   *  or the free ones). */
  slotsFor(grant) {
    const may = grant.kind === 'creator' || grant.kind === 'rejoin' ? [grant.slot] : this.freeSlots();
    return this.slotList().filter((s) => may.includes(s.pid));
  }

  hello(conn, m) {
    if (conn.pid || conn.joining) return undefined;
    conn.helloAt ??= this.wall();
    if (m.proto !== PROTOCOL_VERSION) return this.deny(conn, ERR.PROTO);
    if (Array.isArray(m.caps) && m.caps.includes(CAPS.BATCH)) conn.out.batch = true;
    const cidOwner = this.engine.knows(m.cid) ? this.server.clients[m.cid].pid : null;
    const fromToken = m.token ? this.grantOf(m.token) : null;
    const others = [m.join, m.claim && m.claim.pass].filter((k) => typeof k === 'string' && k).map((k) => this.grantOf(k));
    const grants = [fromToken, ...others].filter(Boolean);
    const member = grants.find((g) => g.kind === 'member');
    if (member) {
      if (cidOwner && cidOwner !== member.pid) return this.deny(conn, ERR.BAD_HELLO);
      return this.join(conn, member.pid, m.cid);
    }
    const usable = grants.find((g) => g.kind === 'creator' || g.kind === 'invite' || g.kind === 'rejoin');
    if (usable) conn.grant = usable;
    const grant = conn.grant;
    if (!grant) {
      const refused = grants.find((g) => g.kind === 'refused');
      // a key this farm turned off (a farmer given a new key, a spent rejoin link): said politely, nothing of the farm,
      // and the socket stays open: the device may hold another key (a home-screen app's start URL keeps an old one)
      if (refused && (refused.code === MF_ERR.REKEYED || refused.code === MF_ERR.REJOIN)) return this.deny(conn, refused.code);
      if (refused) return this.denyPrivate(conn, refused.code);
      // a token that is no key of this farm (a forgotten farm, a stale link): the client drops it and tries its
      // next way in; with nothing left to try, the farm is private
      if (m.token && !fromToken) return this.deny(conn, ERR.BAD_TOKEN);
      return this.denyPrivate(conn);
    }
    if (!m.claim) return this.send(conn, { t: MSG.SLOTS, slots: this.slotsFor(grant), pass: false });
    const { slot, name, color, reclaim } = m.claim;
    if (reclaim) return this.deny(conn, ERR.SLOT_TAKEN);
    if (!PLAYER_SLOTS.includes(slot) || !this.openSlots().includes(slot)) return this.deny(conn, ERR.BAD_HELLO);
    if (cidOwner && cidOwner !== slot) return this.deny(conn, ERR.BAD_HELLO);
    if (grant.kind === 'rejoin') return this.rejoin(conn, m, grant);
    let token;
    if (grant.kind === 'creator') {
      if (!this.reservation()) { conn.grant = null; return this.denyPrivate(conn); }   // used meanwhile (another tab)
      if (slot !== grant.slot) return this.deny(conn, ERR.BAD_HELLO);
      token = grant.key;                       // the creator's secret becomes their member secret (personal link)
    } else {
      const st = this.inviteState(grant.key);       // used by someone else, or expired, since this socket showed it
      if (st !== 'ok') { conn.grant = null; return this.denyPrivate(conn, st === 'full' ? MF_ERR.FULL : MF_ERR.INVITE); }
      if (this.claimed(slot)) return this.deny(conn, ERR.SLOT_TAKEN);
      if (!this.freeSlots().includes(slot)) return this.deny(conn, ERR.BAD_HELLO);
      token = newSecret();
    }
    const args = { pid: slot, name };
    if (color) args.color = color;
    // As in single mode, the token hash rides on the `_join` line, so a crash cannot lose the way back in.
    const r = this.engine.system('_join', args, {}, { auth: { [slot]: { tokenHash: sha256(token) } } });
    if (!r.ok) return this.deny(conn, r.code);
    if (grant.kind === 'creator') this.meta.reserve = null;
    // single use; and an invite also ends when the farm is full
    if (grant.kind === 'invite' || (this.meta.invite && this.full())) this.retireInvite();
    this.meta.members = Object.keys(this.state.players).length;
    conn.grant = null;
    this.farm.saveMeta();
    this.log.info(grant.kind === 'creator' ? 'the farm\'s creator sat down' : 'an invited farmer joined', { pid: slot });
    return this.join(conn, slot, m.cid, token);
  }

  /**
   * A rejoin token's claim: its holder becomes that farmer (a new name if the claim carries one) with a fresh member
   * secret, journaled with `_key` before the welcome (a crash keeps it); the token is spent.
   */
  rejoin(conn, m, grant) {
    const st = this.rejoinState(grant.key);
    if (!st || st.st !== 'ok') { conn.grant = null; return this.deny(conn, MF_ERR.REJOIN); }   // spent meanwhile
    const { slot, name } = m.claim;
    if (slot !== st.slot) return this.deny(conn, ERR.BAD_HELLO);
    const secret = newSecret();
    const args = { pid: slot, what: 'back' };
    if (name && name !== this.state.players[slot].name) args.name = name;
    const r = this.engine.system('_key', args, {}, { auth: { [slot]: { tokenHash: sha256(secret) } } });
    if (!r.ok) return this.deny(conn, r.code);
    this.retireRejoin(slot);
    conn.grant = null;
    this.farm.saveMeta();
    this.log.info('a farmer came back with a new key', { pid: slot });
    return this.join(conn, slot, m.cid, secret);
  }

  join(conn, pid, cid, token) {
    const r = super.join(conn, pid, cid, token);
    if (conn.pid) this.farm.onJoin?.(pid);
    return r;
  }

  open(ws, ip) {
    const conn = super.open(ws, ip);
    this.farm.onConns?.(this.conns.size);
    return conn;
  }

  close(conn) {
    const had = this.conns.has(conn);
    super.close(conn);
    if (!had) return;
    if (conn.pid) this.farm.onLeave?.();
    this.farm.onConns?.(this.conns.size);
  }
}
