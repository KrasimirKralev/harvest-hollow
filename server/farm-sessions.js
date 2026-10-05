// Sessions of ONE farm on the multi-farm host (HH_MODE=multi, server/multi.js). Everything a single-farm server does
// (server/sessions.js) stays; only who may sit down changes, because the farm is on the public internet:
//
//   - the creator's secret (POST /api/farms -> { id, secret }) claims the reserved first slot (p1) once; it then IS
//     that farmer's token, so the same secret keeps working as their personal link (/f/<id>#k=<secret>)
//   - a valid invite token (POST /api/f/:id/invite -> { token }) claims a free slot once; the welcome hands out a
//     fresh member secret (welcome.token) the way a single-farm claim does
//   - a member's secret (welcome.token, any device) resumes that farmer, exactly like a single-farm token
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
// `claim.reclaim` is refused (SLOT_TAKEN): the personal link replaces the passphrase.
//
// Keys are compared as SHA-256 hashes with crypto.timingSafeEqual over every stored hash (no early exit), and no
// key, hash or farm id is ever logged.
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
export const MF_ERR = Object.freeze({ PRIVATE: 'PRIVATE', INVITE: 'INVITE', FULL: 'FULL' });
/** Used or replaced invites remembered per farm (hashes), so their holder hears INVITE / FULL instead of PRIVATE. */
export const PAST_INVITES = 8;
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

  /**
   * What a presented key grants on this farm: { kind: 'member', pid } | { kind: 'creator', slot, key } |
   * { kind: 'invite', key } | { kind: 'refused', code } (an invite that no longer works) | null (no key of this farm).
   */
  grantOf(key) {
    if (typeof key !== 'string' || !key) return null;
    const pid = this.slotOfToken(key);
    if (pid && Object.hasOwn(this.state.players, pid)) return { kind: 'member', pid };
    const r = this.reservation();
    if (r && sameHash(r.hash, sha256(key))) return { kind: 'creator', slot: r.slot, key };
    const inv = this.inviteState(key);
    if (inv === 'ok') return { kind: 'invite', key };
    if (inv) return { kind: 'refused', code: inv === 'full' ? MF_ERR.FULL : MF_ERR.INVITE };
    return null;
  }

  /** A refused hello: nothing of the farm is sent; the socket closes so a stale page cannot loop on hellos. */
  denyPrivate(conn, code = MF_ERR.PRIVATE) {
    this.send(conn, { t: MSG.DENY, code }, true);
    conn.out.flush();                              // written now: the close below discards anything still queued
    this.kick(conn, PRIVATE_CLOSE, 'private');
  }

  /** The slot picker for a key holder: only the slot(s) this key may take (the creator's, or the free ones). */
  slotsFor(grant) {
    const may = grant.kind === 'creator' ? [grant.slot] : this.freeSlots();
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
    const usable = grants.find((g) => g.kind === 'creator' || g.kind === 'invite');
    if (usable) conn.grant = usable;
    const grant = conn.grant;
    if (!grant) {
      const refused = grants.find((g) => g.kind === 'refused');
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
    this.log.info(grant.kind === 'creator' ? 'the farm\'s creator sat down' : 'an invited farmer joined', { pid: slot, ip: conn.ip });
    return this.join(conn, slot, m.cid, token);
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
