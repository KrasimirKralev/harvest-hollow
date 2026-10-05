// Server-observed presence facts for the rules (tech §15.5, GDD Appendix F, lane brief item 5).
//
// Rules are pure, so anything they need about WHO is around and WHAT the partner just did comes in `ctx.ext`,
// computed here from the server's own view at the moment it processes the action, and journaled with the line
// (replay reuses the journaled ext; nothing here is ever recomputed on replay).
//
// ctx.ext of a PLAYER action (every field may be missing: client predictions and pre-M1a journal lines carry
// `{}`, so a rule treats a missing field as empty / 0):
//   online      ['p1', 'p2']        every pid with an open socket, sorted (the actor included)
//   avatar      { p2: 14 }          other online players' avatar distance from the actor's avatar, in TENTHS of a
//                                   tile (integer; relayed, speed-clamped positions). High-five "within 2 tiles"
//                                   is `avatar[p] <= 20`.
//   near        12                  the actor's avatar distance to the footprint of `args.id` (a placed object), in
//                                   TENTHS of a tile (0 = standing on it). `sit` needs it <= 30 (RC-31): Golden Hour
//                                   seats are not client-trusted. Present only when both the pose and the object
//                                   are known.
//   recent      { p2: { harvest: 9, collect: 40 } }
//                                   other players' ACCEPTED actions of the last WINDOW_MS (3 s) that had a map
//                                   position, by action type: the smallest SQUARED tile distance between one of
//                                   this action's targets and one of theirs. Together Combo ("both act within
//                                   3 s on objects within 8 tiles", GDD §6.2 #6) is: some productive type t with
//                                   recent[p][t] <= 64. Present only when this action has a position.
//   togetherMin 3                   whole minutes during which >= 2 players were online that no earlier
//                                   accepted action has carried yet ("Side by Side", ribbon #59). Each minute is
//                                   handed out exactly once: the rules add it to a counter on every action
//                                   that carries it. Present only when >= 1.
// A position is the target object's (x, z) tile (its min corner; an animal uses its home's), from args.id,
// args.ids[], args.x + args.z, or args.tiles[[x, z], ...], read BEFORE the action applies.
//
// ctx.ext of a time-driven SYSTEM action: { online }. The `_seen` of a player who left (or of everyone at a boot
// after a crash) also carries `togetherMin`, so minutes spent together are paid when a partner leaves instead of
// waiting for the next player action, and none is lost to a restart (SV-07).
//
// Persistence (SV-07): pendingMs() is written into the snapshot's private sidecar (`server.live.together`) at
// every snapshot; a boot restores it, minus the minutes the replayed journal lines already paid.
import { COOP, defOf } from '../shared/content/index.js';

/** "Within 3 s" of GDD §6.2 #6: the content's Together Combo window, which the rules read too. */
export const WINDOW_MS = COOP.combo.windowMs;
const MAX_POINTS = 64;       // targets kept per action (a drag-paint batch)
const MAX_ENTRIES = 600;     // per player within the window (a 3 s, 120 acts/s stroke is 360)
const MINUTE = 60_000;

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

function minD2(a, b) {
  let best = Infinity;
  for (const [ax, az] of a) {
    for (const [bx, bz] of b) {
      const dx = ax - bx;
      const dz = az - bz;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
  }
  return best;
}

/** Target tiles of an action, read from the state before it applies. Never throws. */
export function positionsOf(state, args) {
  const pts = [];
  if (!args || typeof args !== 'object') return pts;
  const objects = state && state.farm && state.farm.objects;
  const add = (x, z) => {
    if (Number.isSafeInteger(x) && Number.isSafeInteger(z) && pts.length < MAX_POINTS) pts.push([x, z]);
  };
  const addObj = (id) => {
    if (typeof id !== 'string' || !objects || !Object.hasOwn(objects, id)) return;
    let o = objects[id];
    if (o && o.x === undefined && typeof o.home === 'string' && Object.hasOwn(objects, o.home)) o = objects[o.home];
    if (o) add(o.x, o.z);
  };
  addObj(args.id);
  if (Array.isArray(args.ids)) for (const id of args.ids.slice(0, MAX_POINTS)) addObj(id);
  add(args.x, args.z);
  if (Array.isArray(args.tiles)) for (const t of args.tiles.slice(0, MAX_POINTS)) if (Array.isArray(t)) add(t[0], t[1]);
  return pts;
}

/** Tenths of a tile from the point `me` ({x, z} tiles) to the footprint of `args.id`, or null when unknown. */
export function nearTo(state, args, me) {
  if (!me || !args || typeof args.id !== 'string') return null;
  const objects = state && state.farm && state.farm.objects;
  if (!objects || !Object.hasOwn(objects, args.id)) return null;
  const o = objects[args.id];
  if (!o || !Number.isSafeInteger(o.x) || !Number.isSafeInteger(o.z)) return null;   // animals live in homes
  const d = defOf(o.def);
  const size = d && Array.isArray(d.size) ? d.size : [1, 1];
  const [w, h] = (o.rot ?? 0) % 2 ? [size[1] ?? 1, size[0] ?? 1] : [size[0] ?? 1, size[1] ?? 1];
  const dx = Math.max(o.x - me.x, 0, me.x - (o.x + w));
  const dz = Math.max(o.z - me.z, 0, me.z - (o.z + h));
  return Math.round(Math.hypot(dx, dz) * 10);
}

export class Together {
  /**
   * @param {{ online?: () => string[], poses?: () => Map<string, { x: number, z: number }> }} [o]
   *   online: pids with an open socket; poses: the presence relay's current (clamped) avatar positions
   */
  constructor({ online = () => [], poses = () => new Map(), acc = 0 } = {}) {
    this.online = online;
    this.poses = poses;
    /** pid -> [{ at, type, pts }] accepted positioned actions, oldest first */
    this.recent = new Map();
    this.acc = Number.isSafeInteger(acc) && acc > 0 ? acc : 0;   // together ms not yet handed out
    this.since = null;            // when >= 2 players came online (null: fewer)
  }

  /** Sessions call this whenever the set of online pids changes. */
  setOnline(pids, now) {
    const together = new Set(pids).size >= 2;
    if (together && this.since === null) this.since = now;
    else if (!together && this.since !== null) {
      this.acc += Math.max(0, now - this.since);
      this.since = null;
    }
  }

  pendingMs(now) { return this.acc + (this.since === null ? 0 : Math.max(0, now - this.since)); }

  /**
   * The facts for one player action. Returns { ext, pts } (pts: its target tiles, for committed()).
   * @param {string} pid @param {{ type: string, args: object }} act @param {object} state @param {number} now
   */
  player(pid, act, state, now) {
    const ext = { online: [...new Set(this.online())].sort() };
    const poses = this.poses();
    const me = poses.get(pid);
    if (me) {
      const avatar = {};
      for (const [other, p] of poses) {
        if (other !== pid) avatar[other] = Math.round(Math.hypot(p.x - me.x, p.z - me.z) * 10);
      }
      if (Object.keys(avatar).length) ext.avatar = avatar;
      const near = nearTo(state, act.args, me);
      if (near !== null) ext.near = near;
    }
    const pts = positionsOf(state, act.args);
    if (pts.length) {
      const recent = {};
      for (const [other, list] of this.recent) {
        if (other === pid) continue;
        let per = null;
        for (const e of list) {
          if (now - e.at > WINDOW_MS) continue;
          const d2 = minD2(pts, e.pts);
          per ??= {};
          if (!Object.hasOwn(per, e.type) || d2 < per[e.type]) per[e.type] = d2;
        }
        if (per) recent[other] = per;
      }
      if (Object.keys(recent).length) ext.recent = recent;
    }
    const min = Math.floor(this.pendingMs(now) / MINUTE);
    if (min >= 1) ext.togetherMin = min;
    return { ext: deepFreeze(ext), pts };
  }

  /** The action was accepted (and journaled): remember where it happened, and hand out its together minutes. */
  committed(pid, act, facts, now) {
    if (facts.pts && facts.pts.length) {
      let list = this.recent.get(pid);
      if (!list) this.recent.set(pid, (list = []));
      list.push({ at: now, type: act.type, pts: facts.pts });
      this.prune(list, now);
    }
    this.paid(facts.ext && facts.ext.togetherMin, now);
  }

  /** `min` whole minutes were handed out by an accepted action (player or system) at `now`. */
  paid(min, now) {
    if (!(Number.isSafeInteger(min) && min > 0)) return;
    if (this.since !== null) { this.acc += Math.max(0, now - this.since); this.since = now; }
    this.acc = Math.max(0, this.acc - min * MINUTE);
  }

  /** The sidecar record written with every snapshot (restored by `new Together({ acc })` at boot). */
  snapshot(now) { return { acc: this.pendingMs(now) }; }

  prune(list, now) {
    let drop = 0;
    while (drop < list.length && (now - list[drop].at > WINDOW_MS || list.length - drop > MAX_ENTRIES)) drop++;
    if (drop) list.splice(0, drop);
  }

  /**
   * Facts for a system action. `pay`: also hand out the whole together minutes not yet paid (the `_seen` of a
   * player who left); the caller reports an accepted action with paid(ext.togetherMin, now).
   */
  system(now = 0, { pay = false } = {}) {
    const ext = { online: [...new Set(this.online())].sort() };
    if (pay) {
      const min = Math.floor(this.pendingMs(now) / MINUTE);
      if (min >= 1) ext.togetherMin = min;
    }
    return deepFreeze(ext);
  }
}
