// Presence relay (tech-architecture §6): avatar position, facing, anim, cursor and tool are client-owned and
// cosmetic. The server only sanity-checks (finite, in bounds, speed-clamped), stamps its own time and
// relays changed entries at PRESENCE_HZ. Never persisted, journaled or predicted.
//
// Row: [pid, x, z, f, a, cx, cz, rts, tool, hop] (protocol.js `pr`). `rts` is the server time at which the
// row's pose became true (the `mv` receipt, or the catch-up step), NOT the flush time: stamping rows with the
// flush time made a partner walking at a constant speed stall and lurch on screen (review-m0 M3).
import { LIMITS, MSG } from '../shared/net/protocol.js';
import { AVATAR_SPEED, WORLD_TILES, START, RIDE_SPEED_K, RIDE_TOOL } from '../shared/content/config.js';

const round05 = (n) => Math.round(n * 20) / 20;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const LO = -1;
const HI = WORLD_TILES + 1;
const SLACK_TILES = 0.1;   // jitter allowance per accepted mv
/** A pose unchanged this long is repeated once, so receivers stop extrapolating (> 2 send intervals). */
export const REST_MS = 150;
/** A player who comes back within this long reappears where they left, not at the porch (coop-robust-06). */
export const KEEP_POSE_MS = 60_000;

export class Presence {
  /**
   * @param {{ now(): number }} clock  @param {(msg: object, exceptPid?: string) => void} broadcast
   * @param {{ spawnOf?: (pid: string) => ({ x: number, z: number } | null) }} [opts]  where a player appears: the
   *   farmhouse porch wherever the farmhouse stands (shared/rules/grid.js spawnAt); START.spawn without it
   */
  constructor(clock, broadcast, { spawnOf = null } = {}) {
    this.clock = clock;
    this.spawnOf = spawnOf;
    this.broadcast = broadcast;
    /** pid -> { x, z, f, a, cx, cz, tool, ts, at, claim, changed, hop, rest } */
    this.p = new Map();
    /** pid -> { x, z, f, tool, at }: the last pose of a player who left, reused by join() for KEEP_POSE_MS */
    this.left = new Map();
    this.timer = null;
  }

  /**
   * Initial pose when a player comes online: where they left within KEEP_POSE_MS (a Wi-Fi drop, a reload), so the
   * partner (and the server's `near` facts) see them where they stand until their client sends a pose; else their
   * slot's spawn.
   */
  join(pid) {
    if (this.p.has(pid)) return;
    const now = this.clock.now();
    const kept = this.left.get(pid);
    this.left.delete(pid);
    const back = kept && now - kept.at <= KEEP_POSE_MS ? kept : null;
    let porch = null;
    if (!back && this.spawnOf) {
      try { porch = this.spawnOf(pid); } catch { porch = null; }    // cosmetic: never let a spawn fault stop a join
    }
    const sp = back || (porch && Number.isFinite(porch.x) && Number.isFinite(porch.z) ? porch : null)
      || START.spawn[pid] || START.spawn.p1;
    this.p.set(pid, { x: sp.x, z: sp.z, f: back ? back.f : 0, a: 0, cx: null, cz: null, tool: back ? back.tool : null,
      ts: now, at: now, claim: null, changed: true, hop: false, rest: false });
  }

  leave(pid) {
    const e = this.p.get(pid);
    if (!e) return;
    // The relayed (speed-clamped) position, never an unreached claim: the reconnect must not become a free teleport.
    this.left.set(pid, { x: e.x, z: e.z, f: e.f, tool: e.tool, at: this.clock.now() });
    this.p.delete(pid);
  }

  /**
   * Apply a parsed `mv` frame from `pid`. A jump beyond the speed limit is clamped, and the relayed position
   * then catches up with the claimed point at 1.5x avatar speed (see advance()). A hop (`m.hop`, already
   * rate-limited by the router) lands at once and is flagged so the receiver snaps and plays the poof.
   */
  move(pid, m) {
    const now = this.clock.now();
    const prev = this.p.get(pid);
    const claim = { x: clamp(m.x, LO, HI), z: clamp(m.z, LO, HI) };
    const e = {
      x: prev ? prev.x : claim.x, z: prev ? prev.z : claim.z, f: Math.round(m.f * 100) / 100, a: m.a,
      cx: m.cx === undefined ? null : round05(clamp(m.cx, LO, HI)),
      cz: m.cz === undefined ? null : round05(clamp(m.cz, LO, HI)),
      tool: m.tool ?? (prev ? prev.tool : null),
      ts: now, at: prev ? prev.at : now, claim, changed: true, hop: Boolean(prev && prev.changed && prev.hop), rest: false,
    };
    this.p.set(pid, e);
    if (m.hop) {
      e.x = round05(claim.x);
      e.z = round05(claim.z);
      e.claim = null;
      e.at = now;
      e.hop = true;
      return;
    }
    this.advance(e, now);
  }

  /** Move the relayed position toward the claimed one, at most 1.5x AVATAR_SPEED (x RIDE_SPEED_K for a rider). */
  advance(e, now) {
    if (!e.claim) return;
    const dt = Math.max(now - e.at, 0);
    const k = e.tool === RIDE_TOOL ? RIDE_SPEED_K : 1;      // a rider trots 1.8x walking speed (GDD §3.4, cosmetic)
    const max = (AVATAR_SPEED * 1.5 * k * dt) / 1000 + SLACK_TILES;
    const dx = e.claim.x - e.x;
    const dz = e.claim.z - e.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= max) { e.x = round05(e.claim.x); e.z = round05(e.claim.z); e.claim = null; } else {
      e.x = round05(e.x + (dx / dist) * max);
      e.z = round05(e.z + (dz / dist) * max);
    }
    e.at = now;
    e.ts = now;
    e.changed = true;
  }

  /** [pid, x, z, f, a, cx, cz, rts, tool, hop] rows, as in `pr`. */
  rows(onlyChanged) {
    const out = [];
    for (const [pid, e] of this.p) {
      if (onlyChanged && !e.changed) continue;
      out.push([pid, e.x, e.z, e.f, e.a, e.cx, e.cz, e.ts, e.tool, e.hop ? 1 : 0]);
    }
    return out;
  }

  flush() {
    const now = this.clock.now();
    for (const e of this.p.values()) {
      if (e.claim) this.advance(e, now);
      // One repeat of a pose that stopped changing, stamped now: the receiver's last two samples are then
      // equal, so its extrapolation sees zero velocity. Only after REST_MS without an mv: a flush window that
      // merely missed one mid-walk must not render a stop (review-m0 M3).
      if (!e.changed && !e.rest && now - e.ts > REST_MS) { e.rest = true; e.changed = true; e.ts = now; }
    }
    const list = this.rows(true);
    if (!list.length) return;
    for (const e of this.p.values()) { e.changed = false; e.hop = false; }
    this.broadcast({ t: MSG.PRESENCE, ts: now, list });
  }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.flush(), 1000 / LIMITS.PRESENCE_HZ);
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}
