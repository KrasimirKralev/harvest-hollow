// Message router (tech-architecture §7 rule 5): one entry point per frame, never throws. Shape checks are
// shared (parseClientMessage); game meaning is checked by the rules; rates by per-connection buckets.
//
// Over-budget handling (review-m0 H3, M2, M5; lane brief items 5 and 6):
//   - malformed or unparseable frames, and frames beyond the global `frame` budget, count as abuse; ABUSE_MAX in
//     a window closes the socket ONCE
//   - a well-formed act over budget is pressure, not abuse: it is answered `rej RATE` (the client paces acts
//     to the same bucket, so a correct client never sees it)
//   - a well-formed emote / mark / chat over its budget is dropped silently (a player mashing G is not an
//     attacker)
//   - `resync` is never dropped: over budget it is deferred and answered when the bucket allows
//   - latest-wins relays (`ghost`, `mv`) never drop the NEWEST frame: over budget the latest one is kept and
//     relayed when the bucket refills
import { MSG, ERR, LIMITS, CLOSE } from '../shared/net/protocol.js';
import { defOf } from '../shared/content/index.js';
import { WORLD_TILES } from '../shared/content/config.js';

const ABUSE_WINDOW_MS = 10_000;
const ABUSE_MAX = 300;          // abusive frames per window before the socket is closed
/** Pings and ghosts outside this margin around the world are garbage, not "clamp me". */
const MARGIN = 16;

const round05 = (n) => Math.round(n * 20) / 20;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const inWorld = (n) => n >= -MARGIN && n <= WORLD_TILES + MARGIN;

function abuse(hh, conn) {
  if (conn.closing) return;
  const now = Date.now();
  if (now - conn.abuseAt > ABUSE_WINDOW_MS) { conn.abuse = 0; conn.abuseAt = now; }
  if (++conn.abuse > ABUSE_MAX) {
    conn.closing = true;
    hh.log.warn('closing abusive connection', { conn: conn.id, pid: conn.pid || 'anonymous', ip: conn.ip });
    conn.ws.close(CLOSE.ABUSE, 'abuse');
  }
}

/** Run fn now if the bucket allows, else keep only the newest fn and run it as soon as a token is back. */
function latestWins(conn, kind, fn) {
  conn.deferred ??= {};
  const d = conn.deferred[kind];
  if (conn.buckets[kind].take()) {
    if (d) { clearTimeout(d.timer); delete conn.deferred[kind]; }
    fn();
    return;
  }
  if (d) { d.fn = fn; return; }
  const [rate] = LIMITS.BUCKETS[kind];
  const entry = { fn };
  const retry = () => {
    if (conn.closed) return;
    if (!conn.buckets[kind].take()) { entry.timer = setTimeout(retry, 1000 / rate); return; }
    delete conn.deferred[kind];
    entry.fn();
  };
  entry.timer = setTimeout(retry, 1000 / rate);
  conn.deferred[kind] = entry;
}

/**
 * A hello that is well-formed except for its token (a corrupted or hand-edited localStorage) is answered
 * `deny BAD_TOKEN`: the client drops the token and says hello again, instead of waiting on a blank boot screen
 * (SV-09). Returns true when it answered (hello-bucket permitting).
 */
function badToken(hh, conn, data) {
  if (!data || typeof data !== 'object' || data.t !== MSG.HELLO || data.token === undefined || conn.pid || conn.joining) return false;
  if (!hh.parse({ ...data, token: undefined })) return false;          // something else is wrong too: garbage
  if (!conn.buckets.hello.take()) return false;
  hh.sessions.deny(conn, ERR.BAD_TOKEN);
  return true;
}

/**
 * @param {{ engine, sessions, presence, clock, log: Console, parse: Function }} hh
 * @param {object} conn
 * @param {Buffer|string} raw
 */
export function handleMessage(hh, conn, raw) {
  try {
    if (conn.closing || conn.closed) return undefined;
    if (!conn.buckets.frame.take()) return abuse(hh, conn);
    if (raw.length > LIMITS.MAX_PAYLOAD) return abuse(hh, conn);
    let data;
    try { data = JSON.parse(String(raw)); } catch { return abuse(hh, conn); }
    const m = hh.parse(data);
    if (!m) return badToken(hh, conn, data) ? undefined : abuse(hh, conn);
    const take = (k) => conn.buckets[k].take();
    if (m.t === MSG.HELLO) {
      if (!take('hello')) return abuse(hh, conn);
      return hh.sessions.hello(conn, m);
    }
    if (!conn.pid) return conn.joining ? undefined : abuse(hh, conn);   // nothing but hello before joining
    const who = { pid: conn.pid, cid: conn.cid };
    switch (m.t) {
      case MSG.ACT:
      case MSG.ACTS: {
        for (const a of m.t === MSG.ACT ? [m] : m.list) {
          if (!take('act')) { hh.sessions.send(conn, { t: MSG.REJ, seq: a.seq, code: ERR.RATE }); continue; }
          const reply = hh.perf ? hh.perf.timeAct(a.type, () => hh.engine.act(who, a)) : hh.engine.act(who, a);
          if (reply) hh.sessions.send(conn, reply);
        }
        return undefined;
      }
      case MSG.PING:
        if (!take('ping')) return abuse(hh, conn);
        return hh.sessions.send(conn, { t: MSG.PONG, c: m.c, s: hh.clock.now() }, true);
      case MSG.MV:
        // A hop (a poof, tech §6.5) has its own small bucket; over it, the hop is relayed as a clamped walk.
        if (m.hop && !take('hop')) delete m.hop;
        return latestWins(conn, 'mv', () => hh.presence.move(conn.pid, m));
      case MSG.GHOST: {
        const g = m.g;
        if (g && (!defOf(g.def) || !inWorld(g.x) || !inWorld(g.z))) return abuse(hh, conn);
        return latestWins(conn, 'ghost', () => hh.sessions.ghostOut(conn.pid, { t: MSG.GHOST, pid: conn.pid, ts: hh.clock.now(), g }));
      }
      case MSG.EMOTE:
        if (!take('emote')) return undefined;
        return hh.sessions.broadcast({ t: MSG.EMOTE, id: m.id, pid: conn.pid, ts: hh.clock.now() }, conn.pid);
      case MSG.MARK:
        if (!inWorld(m.x) || !inWorld(m.z)) return abuse(hh, conn);
        if (!take('mark')) return undefined;
        // The sender shows its own ping at once; the partner gets it clamped to the world edge.
        return hh.sessions.broadcast({ t: MSG.MARK, x: round05(clamp(m.x, -1, WORLD_TILES + 1)),
          z: round05(clamp(m.z, -1, WORLD_TILES + 1)), kind: m.kind, pid: conn.pid, ts: hh.clock.now() }, conn.pid);
      case MSG.CHAT:
        if (!take('chat')) return undefined;
        return hh.sessions.chat({ t: MSG.CHAT, text: m.text, pid: conn.pid, ts: hh.clock.now() });
      case MSG.RESYNC:
        if (take('resync')) return hh.sessions.welcome(conn);
        // Never dropped: a client waiting for this welcome ignores every delta until it arrives.
        conn.resyncTimer ??= setTimeout(() => {
          conn.resyncTimer = null;
          if (!conn.closed && conn.pid) hh.sessions.welcome(conn);
        }, 1000 / LIMITS.BUCKETS.resync[0]);
        return undefined;
      default:
        return abuse(hh, conn);
    }
  } catch (err) {
    hh.log.error('router error (frame dropped)', { conn: conn && conn.id }, err);
    return undefined;
  }
}
