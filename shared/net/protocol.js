// Wire protocol (FROZEN CONTRACT, tech-architecture §3.8). JSON text frames over one same-origin WebSocket
// at `/ws`. Every frame is an object with a string `t`. Clients send only intents; the server computes every
// price, quantity and time.
//
// Client -> server
//   hello  { proto, cid, token?, claim?: { slot, name, color?, pass?, reclaim? }, caps? }
//                                                                   first frame; without a valid token or
//                                                                   claim the server answers `slots`.
//                                                                   claim.reclaim: true = "this taken slot is me
//                                                                   on a new device" (lost token): needs the
//                                                                   passphrase when the server has one, else
//                                                                   the slot must be offline. A new token is
//                                                                   issued; the slot's other devices keep theirs.
//                                                                   caps: optional client capabilities, e.g.
//                                                                   ['b'] = "I unpack `b` batch frames" (CAPS)
//   act    { seq, type, args }                                      one game intent (seq: per-cid, 1, 2, 3...)
//   acts   { list: [{ seq, type, args }, ...] }                     intents batched within one frame
//   ping   { c }                                                    c = client performance.now()
//   mv     { x, z, f, a, cx?, cz?, hop?, tool? }                    presence (tiles, floats; f radians; a anim id);
//                                                                   hop: true = a teleport ("poof", tech §6.5),
//                                                                   relayed at once instead of speed-clamped;
//                                                                   tool: the current tool id (partner ring)
//   ghost  { g: { def, x, z, rot } | null }                         build-mode ghost shared with the partner
//   emote  { id } / mark { x, z, kind } / chat { text }             social, rate-limited
//   resync {}                                                       ask for a fresh `welcome`
//
// Server -> client
//   slots   { slots: [{ pid, claimed, name, color, online, avatar }], pass } answer to a hello that has no valid identity;
//                                                                   pass: true when claims/reclaims need the
//                                                                   passphrase (HH_PASSPHRASE)
//   deny    { code }                                                hello refused (PROTO, SLOT_TAKEN, FULL, ...;
//                                                                   BAD_TOKEN also for a malformed token)
//   welcome { pid, token?, state, v, serverNow, lastSeq, known, rejected, contentHash, rulesVersion, buildHash?,
//             peers, proto, chat }
//                                                                   full replicated state; token only on a claim;
//                                                                   contentHash: content + config + RULES_VERSION
//                                                                   (differs = the rules or numbers changed);
//                                                                   rulesVersion: the server's RULES_VERSION
//                                                                   (additive, qa2 SV-01): with the same rules a
//                                                                   stale tab re-sends its pending actions before
//                                                                   it reloads for a new buildHash;
//                                                                   buildHash: the server's BUILD_HASH (bytes of
//                                                                   public/ + shared/ at boot; the page carries the
//                                                                   one it was served with in
//                                                                   <meta name="hh-build">): differs = this tab
//                                                                   runs other game files, reload once;
//                                                                   known: false when this cid had no dedupe
//                                                                   record (drop unacknowledged actions, never
//                                                                   re-send them); rejected: [{seq, code, by?}]
//                                                                   the cid's newest rejections (a lost `rej`);
//                                                                   chat: the newest relayed chat lines (late
//                                                                   joiners), oldest first
//   d       { v, by, cid, seq, now, ops, ev }                       accepted action, to ALL clients (doubles as ack)
//   rej     { seq, code, by? }                                      rejected action, to the sender only; by: the
//                                                                   other player who acted on one of its targets
//                                                                   (args.id or args.ids) within 10 s
//   ack     { seq, v }                                              duplicate seq (already applied) after reconnect
//   pong    { c, s }                                                s = server epoch ms at receipt
//   pr      { ts, list: [[pid, x, z, f, a, cx, cz, rts, tool, hop], ...] }
//                                                                   presence batch at PRESENCE_HZ (other players'
//                                                                   rows only, never the receiver's own; changed only;
//                                                                   cx/cz null when the cursor is off-canvas;
//                                                                   rts = server time at which THIS row's pose
//                                                                   became true, interpolate on it; tool: id or
//                                                                   null; hop: 1 = teleported, snap + poof FX)
//   peer    { pid, online, name, color }                            join / leave (a leave only after the
//                                                                   reconnect grace, 10 s: a blip sends nothing)
//   ghost / emote / mark / chat                                     relayed with { pid, ts }
//   b       { list: [msg, ...] }                                    BATCH: only to a client whose hello had
//                                                                   caps ['b']. Every server message of one
//                                                                   server tick (<= TICK_MS) in send order;
//                                                                   handle the list exactly as if the frames had
//                                                                   arrived one by one (deltas can be applied
//                                                                   with one rewind + one replay)
//
// Close codes the server uses (CLOSE): REPLACED (a newer socket of the same cid took over), EVICTED (the server
// was full and this socket had not joined), IDLE (no hello for anonIdleMs), OVERFLOW (the client stopped reading;
// it reconnects and gets a welcome), ABUSE (malformed flood), FULL, SHUTDOWN.
//
// System actions (type starting with '_') are server-only: they arrive as ordinary `d` deltas with
// by = 'sys', cid = 'sys'.

/** Bump on any incompatible change to this file's message shapes. */
export const PROTOCOL_VERSION = 2;      // 2: per-row presence time, mv hop/tool, welcome known/rejected

/** Message type tags. */
export const MSG = Object.freeze({
  // client -> server
  HELLO: 'hello', ACT: 'act', ACTS: 'acts', PING: 'ping', MV: 'mv', GHOST: 'ghost',
  EMOTE: 'emote', MARK: 'mark', CHAT: 'chat', RESYNC: 'resync',
  // server -> client
  SLOTS: 'slots', DENY: 'deny', WELCOME: 'welcome', DELTA: 'd', REJ: 'rej', ACK: 'ack', PONG: 'pong',
  PRESENCE: 'pr', PEER: 'peer', BATCH: 'b',
});

/** Client capabilities announced in `hello.caps` (additive; unknown ones are ignored). */
export const CAPS = Object.freeze({ BATCH: 'b' });

/** WebSocket close codes the server sends (4000-4999 are application codes). */
export const CLOSE = Object.freeze({
  SHUTDOWN: 1001, ABUSE: 1008, FULL: 1013, REPLACED: 4000, EVICTED: 4001, IDLE: 4002, OVERFLOW: 4003,
});

/** The free emotes every player has (GDD §6.2 #2). Relayed only if listed here. */
export const EMOTES = Object.freeze(['wave', 'heart', 'laugh', 'thumbs_up', 'come_here', 'cheer', 'high_five', 'dance']);

/** Map ping kinds (`mark`). */
export const MARKS = Object.freeze(['look', 'help', 'heart']);

const codes = [
  // action rejections (tech §3.8)
  'BAD_ARGS', 'UNKNOWN_ACTION', 'RATE', 'NOT_FOUND', 'EMPTY', 'OCCUPIED', 'NOT_READY', 'NOT_HUNGRY',
  'NO_COINS', 'NO_ACORNS', 'NO_ITEMS', 'STORAGE_FULL', 'LOCKED', 'BLOCKED', 'OUT_OF_BOUNDS', 'QUEUE_FULL', 'ALREADY_DONE',
  'NOT_REFUNDABLE', 'COOLDOWN', 'SELF_ONLY', 'ID_TAKEN', 'CAP', 'NOT_JOINED', 'INTERNAL',
  // `sit` needs the avatar within 3 tiles of the bench (server-observed ext.near, wave-1 QA RC-31)
  'TOO_FAR',
  // nothing to do here, by design: watering a quick crop (wave-2 QA RC-18; it used to say LOCKED, "a higher level")
  'NOT_NEEDED',
  // client-only: disconnected (or unanswered) for more than MAX_OFFLINE_MS, input blocks (tech §3.7)
  'OFFLINE',
  // soft codes: the client asks the player and resends with args.confirm = [code] (tech §15.2)
  // PRICE: the price moved above the `max` the buyer saw (wave-1 QA RC-18): resend with the new max or confirm
  'RESERVED', 'PINNED', 'BIG_SPEND', 'PRICE',
  // session (hello) refusals, sent in `deny`
  'PROTO', 'BAD_TOKEN', 'SLOT_TAKEN', 'FULL', 'PASSPHRASE', 'BAD_HELLO',
];
/** Single error enum; the value equals the name. Friendly text lives in the UI. */
export const ERR = Object.freeze(Object.fromEntries(codes.map((c) => [c, c])));
/** Soft codes: never a hard "no", only "are you sure?". */
export const SOFT = Object.freeze(new Set([ERR.RESERVED, ERR.PINNED, ERR.BIG_SPEND, ERR.PRICE]));

/** Limits shared by server enforcement and client behaviour (tech §7.6, §3.7, §6). */
export const LIMITS = Object.freeze({
  MAX_PAYLOAD: 64 * 1024,          // ws maxPayload, bytes
  MAX_CONNECTIONS: 8,
  MAX_ACTS_PER_FRAME: 64,          // `acts.list` length
  MAX_PENDING: 300,                // client: unconfirmed predictions before input blocks
  MAX_OFFLINE_MS: 30_000,          // client: predicting while disconnected, then input blocks
  PRESENCE_HZ: 15,
  GHOST_HZ: 10,
  INTERP_DELAY_MS: 120,            // remote avatars render this far in the past (tech §6.2)
  EXTRAPOLATE_MS: 150,
  CHAT_MAX: 200,
  NAME_MAX: 16,
  ARGS_MAX_KEYS: 16,
  PING_EVERY_MS: 10_000,
  HEARTBEAT_MS: 15_000,            // server ws ping; terminate after 2 missed
  CHAT_KEPT: 50,                   // chat lines the server keeps in memory for late joiners (welcome.chat)
  TICK_MS: 16,                     // server output coalescing: at most one frame per connection per tick
  RECONNECT_MS: Object.freeze([250, 500, 1000, 2000]),  // then every 2 s
  // token buckets per connection: [refill per second, burst]. act fits a 3x3 drag-paint brush (about 90
  // acts/s, GDD §7.1); the client paces its sends to 90 % of it (socket.js), so a correct client never sees RATE.
  BUCKETS: Object.freeze({
    act: Object.freeze([120, 360]), mv: Object.freeze([20, 20]), ghost: Object.freeze([12, 12]), hop: Object.freeze([1, 2]),
    chat: Object.freeze([2, 5]), mark: Object.freeze([1, 1]), emote: Object.freeze([1, 1]),
    ping: Object.freeze([5, 10]), hello: Object.freeze([1, 5]), resync: Object.freeze([0.2, 2]),
    // every frame of any kind: far above a correct client (one acts frame per animation frame + 15 mv + 10 ghost
    // + pings), so only a flood hits it; frames over it count as abuse
    frame: Object.freeze([300, 600]),
  }),
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const CID_RE = /^[a-z0-9]{5,8}$/;
const TYPE_RE = /^_?[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const SLOT_RE = /^p[1-9]$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TOOL_RE = /^[a-z_]{1,16}$/;
const CAP_RE = /^[a-z]{1,8}$/;
const MAX_COORD = 1e4;
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);   // presence floats far outside the world are garbage, not "clamp me"

/** Name sanitizer shared by the claim form and the server: trims, strips control chars, caps length. */
export function cleanName(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, LIMITS.NAME_MAX);
}

function parseAct(a) {
  if (!isPlainObject(a)) return null;
  const { seq, type, args } = a;
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  if (typeof type !== 'string' || !TYPE_RE.test(type)) return null;
  const argv = args === undefined ? {} : args;
  if (!isPlainObject(argv) || Object.keys(argv).length > LIMITS.ARGS_MAX_KEYS) return null;
  if (Object.keys(argv).some((k) => PROTO_KEYS.has(k))) return null;
  return { seq, type, args: argv };
}

/**
 * Validate the SHAPE of a client frame (not its game meaning). Pure; never throws.
 * Returns a normalized copy with only the known fields, or null for anything malformed.
 * @param {unknown} msg  the JSON.parse result of one frame
 * @returns {object|null}
 */
export function parseClientMessage(msg) {
  try {
    if (!isPlainObject(msg) || typeof msg.t !== 'string') return null;
    switch (msg.t) {
      case MSG.HELLO: {
        if (!Number.isSafeInteger(msg.proto) || typeof msg.cid !== 'string' || !CID_RE.test(msg.cid)) return null;
        const out = { t: MSG.HELLO, proto: msg.proto, cid: msg.cid };
        if (msg.token !== undefined) {
          if (typeof msg.token !== 'string' || !/^[a-f0-9]{32,64}$/.test(msg.token)) return null;
          out.token = msg.token;
        }
        if (msg.claim !== undefined) {
          const c = msg.claim;
          if (!isPlainObject(c) || typeof c.slot !== 'string' || !SLOT_RE.test(c.slot)) return null;
          const name = cleanName(c.name);
          if (!name) return null;
          if (c.color !== undefined && (typeof c.color !== 'string' || !COLOR_RE.test(c.color))) return null;
          out.claim = { slot: c.slot, name, color: c.color };
          if (c.pass !== undefined) {
            if (typeof c.pass !== 'string' || c.pass.length > 128) return null;
            out.claim.pass = c.pass;
          }
          if (c.reclaim !== undefined) {
            if (c.reclaim !== true) return null;
            out.claim.reclaim = true;
          }
        }
        if (msg.caps !== undefined) {
          if (!Array.isArray(msg.caps) || msg.caps.length > 8 || !msg.caps.every((x) => typeof x === 'string' && CAP_RE.test(x))) return null;
          out.caps = [...new Set(msg.caps)];
        }
        return out;
      }
      case MSG.ACT: {
        const a = parseAct(msg);
        return a ? { t: MSG.ACT, ...a } : null;
      }
      case MSG.ACTS: {
        if (!Array.isArray(msg.list) || msg.list.length === 0 || msg.list.length > LIMITS.MAX_ACTS_PER_FRAME) return null;
        const list = [];
        for (const a of msg.list) {
          const p = parseAct(a);
          if (!p) return null;
          list.push(p);
        }
        return { t: MSG.ACTS, list };
      }
      case MSG.PING:
        return finite(msg.c) ? { t: MSG.PING, c: msg.c } : null;
      case MSG.MV: {
        const { x, z, f, a, cx, cz, hop, tool } = msg;
        if (![x, z, f].every((n) => finite(n) && Math.abs(n) < MAX_COORD)) return null;
        if (!Number.isSafeInteger(a) || a < 0 || a > 255) return null;
        const out = { t: MSG.MV, x, z, f, a };
        if (cx !== undefined || cz !== undefined) {
          if (!finite(cx) || !finite(cz) || Math.abs(cx) >= MAX_COORD || Math.abs(cz) >= MAX_COORD) return null;
          out.cx = cx; out.cz = cz;
        }
        if (hop !== undefined) {
          if (hop !== true) return null;
          out.hop = true;
        }
        if (tool !== undefined) {
          if (typeof tool !== 'string' || !TOOL_RE.test(tool)) return null;
          out.tool = tool;
        }
        return out;
      }
      case MSG.GHOST: {
        if (msg.g === null) return { t: MSG.GHOST, g: null };
        const g = msg.g;
        if (!isPlainObject(g) || typeof g.def !== 'string' || g.def.length > 32) return null;
        if (![g.x, g.z].every((n) => Number.isSafeInteger(n) && Math.abs(n) < MAX_COORD)) return null;
        if (!Number.isSafeInteger(g.rot) || g.rot < 0 || g.rot > 3) return null;
        return { t: MSG.GHOST, g: { def: g.def, x: g.x, z: g.z, rot: g.rot } };
      }
      case MSG.EMOTE:
        return typeof msg.id === 'string' && EMOTES.includes(msg.id) ? { t: MSG.EMOTE, id: msg.id } : null;
      case MSG.MARK:
        if (![msg.x, msg.z].every((n) => finite(n) && Math.abs(n) < MAX_COORD)) return null;
        if (!MARKS.includes(msg.kind)) return null;
        return { t: MSG.MARK, x: msg.x, z: msg.z, kind: msg.kind };
      case MSG.CHAT: {
        if (typeof msg.text !== 'string') return null;
        // eslint-disable-next-line no-control-regex
        const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.CHAT_MAX);
        return text ? { t: MSG.CHAT, text } : null;
      }
      case MSG.RESYNC:
        return { t: MSG.RESYNC };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
