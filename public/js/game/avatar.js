// My avatar: client-owned, cosmetic presence (tech §6.1, §6.5). Actions commit instantly; the avatar jogs
// toward the work area afterwards and hops if the target is far. Sends `mv` on a fixed PRESENCE_HZ
// accumulator (not "frames since the last send", which beat against the server's flush and made the partner
// stutter, review-m0 M3), only when something changed (position, facing, anim, cursor or tool). A teleport is
// sent with `hop: true`, so the partner sees a poof, not a 5 s sprint (M4). Owned by the client-core lane.
//
//   const avatar = createAvatar({ view, send, pid, clock?, route?, at? })   at: the spawn point (float tiles)
//   avatar.walkTo(tileX, tileZ, w?, d?, onArrive?)   next to that footprint; onArrive() runs once the pose has
//                    reached it AND gone out to the server (a bench sit is checked against the server's pose,
//                    RC-31). A newer walkTo / goTo cancels the older one's onArrive (the player changed their mind).
//                    With `route` (game/path.js: (from, to) -> { points, reached, length } | null) the farmer goes
//                    round buildings and fences; a stand point the router cannot reach is walked to in a line, as before
//   avatar.goTo(x, z, onArrive?) -> { x, z, reached } | null   click-to-walk: to that exact point (float tiles) round
//                    everything solid, however far (never a hop); an unreachable point walks as close as the farm
//                    allows (reached false); null when the farmer cannot move at all. avatar.destination: where to
//   avatar.place(x, z) / avatar.setCursor({x, z} | null) / avatar.setTool(id)
//   avatar.resync()  the server lost my pose (a reconnect or a restart puts me back at the porch): the current
//                    pose goes out on the next tick as a hop (coop-robust-06; main.js calls it on every welcome)
//   avatar.flush()   send the current pose now (before an action the server checks against it)
//   avatar.setRiding(on)   on a horse (GDD §3.4 Horse, cosmetic): walks at RIDE_SPEED_K x, the pose carries
//                    `ride: true` for my own view (render-life seats the farmer on a horse) and the presence frames
//                    carry tool 'horse' so the partner sees me riding; avatar.riding / avatar.moving read it back
//   avatar.stepTo(points, onArrive?)   (M2) a short walk straight through these points (float tiles), the router not
//                    asked: out along the Fishing Dock's pier, whose footprint the router counts as solid
//   avatar.setActivity(tool | null, act?)   (M2) something the farmer does in place, seen by both: the presence frames
//                    carry `tool` (the fishing rod: 'rod' while on the dock; 'indoors' while
//                    inside the farmhouse) instead of the tool in hand, and my own pose carries `act` (for the fishing
//                    rod { fish: phase, dock, face }: render-life seats me on the dock's end facing the water). Walking
//                    anywhere (walkTo / goTo / place) ends it. null clears it. Riding wins over an activity.
//
// Time: walking and the 15 Hz send accumulator run on their own clock (performance.now() deltas, capped at
// 0.5 s), never on the dt the render loop hands over: a capped loop on a 144 Hz monitor handed the per-rAF dt
// to frames that rendered only every few ticks, so the farmer walked at 36 % speed (RD-02 / performance-02).
import { AVATAR_SPEED, START, RIDE_SPEED_K, RIDE_TOOL } from '../../../shared/content/config.js';
import { LIMITS, MSG } from '../../../shared/net/protocol.js';

const HOP_TILES = 12;
// RIDE_SPEED_K: riding speed over walking speed (GDD §3.4 "walk speed x1.8"); RIDE_TOOL: the presence `tool` of a
// mounted farmer (the partner's view seats them on a horse). Both live in shared config: the server's clamp reads them.
export { RIDE_SPEED_K, RIDE_TOOL };
const SEND_S = 1 / LIMITS.PRESENCE_HZ;
const r05 = (n) => Math.round(n * 20) / 20;

export function createAvatar({ view, send, pid, clock = () => performance.now(), route = null, at = null }) {
  // `at`: where the farmer appears, the farmhouse porch wherever it stands now (shared/rules/grid.js spawnAt, the
  // server's presence starts there too)
  const sp = at && Number.isFinite(at.x) && Number.isFinite(at.z) ? at : START.spawn[pid] || START.spawn.p1;
  const pose = { x: sp.x, z: sp.z, f: 0, a: 0, ride: false, act: null };
  let activity = null;             // the presence tool of what I do in place (fishing, indoors), or null
  let target = null;               // the waypoint walked to now
  let legs = [];                   // the waypoints after it
  let destination = null;          // the walk's final point
  let arrive = null;               // the pending walkTo's onArrive
  let cursor = null;               // { x, z } float tiles, or null when off-canvas
  let tool = null;
  let hop = false;                 // the next mv carries hop: true
  let lastSent = '';
  let acc = SEND_S;                // send on the first frame
  let lastT = null;                // clock() of the previous step

  /** Walking ends what the farmer did in place (the rod goes away). */
  function clearActivity() {
    if (!activity && !pose.act) return;
    activity = null;
    pose.act = null;
    view.me.update(pose);
    acc = SEND_S;
  }

  function teleport(x, z) {
    pose.x = x; pose.z = z; pose.a = 0;
    target = null;
    legs = [];
    destination = null;
    hop = true;
    view.me.update(pose);
  }

  /** Send the pose now when it changed (or a hop is due); `force` re-sends an unchanged pose. */
  function sendPose(force = false) {
    const msg = { t: MSG.MV, x: r05(pose.x), z: r05(pose.z), f: Math.round(pose.f * 100) / 100, a: pose.a };
    if (cursor) { msg.cx = r05(cursor.x); msg.cz = r05(cursor.z); }
    if (pose.ride) msg.tool = RIDE_TOOL;
    else if (activity) msg.tool = activity;
    else if (tool) msg.tool = tool;
    const key = JSON.stringify(msg);
    if (key === lastSent && !hop && !force) return false;
    if (hop) { msg.hop = true; hop = false; }
    lastSent = key;
    send(msg);
    return true;
  }

  /** The walk is over (or there was none): the server gets the final pose first, then the caller acts. */
  function arrived() {
    const fn = arrive;
    arrive = null;
    if (!fn) return;
    sendPose();
    acc = 0;
    try { fn(); } catch (err) { console.error('avatar onArrive failed', err); }
  }

  /**
   * Walk next to the target footprint (x, z, w, d tiles): to the point of its edge nearest to me, half a tile out,
   * so the farmer stands beside a coop instead of inside it. A target far away is a hop (poof), never a long jog.
   */
  function walkTo(x, z, w = 1, d = 1, onArrive = null) {
    clearActivity();
    arrive = typeof onArrive === 'function' ? onArrive : null;
    const cx = Math.min(Math.max(pose.x, x), x + w);
    const cz = Math.min(Math.max(pose.z, z), z + d);
    let tx;
    let tz;
    if (cx > x && cx < x + w && cz > z && cz < z + d) { tx = x + w / 2; tz = z + d + 0.45; }   // inside: in front
    else {
      const dx = pose.x - cx;
      const dz = pose.z - cz;
      const len = Math.hypot(dx, dz) || 1;
      tx = cx + (dx / len) * 0.45;
      tz = cz + (dz / len) * 0.45;
    }
    const far = HOP_TILES * (pose.ride ? RIDE_SPEED_K : 1);
    if (Math.hypot(tx - pose.x, tz - pose.z) > far) { teleport(tx, tz); arrived(); return; }
    if (Math.hypot(tx - pose.x, tz - pose.z) < 0.15) { target = null; legs = []; destination = null; arrived(); return; }
    const r = routeTo(tx, tz);
    // round the barn is still a walk; a detour much longer than the hop distance is a hop, as a long straight one is
    if (r && r.reached && r.length > far * 1.6) { teleport(tx, tz); arrived(); return; }
    follow(r && r.reached ? r.points : [{ x: tx, z: tz }]);
  }

  /** The router's walk to (x, z), or null (no router, or it failed: the caller walks in a line). */
  function routeTo(x, z) {
    if (typeof route !== 'function') return null;
    try { return route({ x: pose.x, z: pose.z }, { x, z }); } catch (err) { console.warn('avatar route failed', err); return null; }
  }

  /** Walk these waypoints in order. */
  function follow(points) {
    if (!target) lastT = clock();                         // a walk starts now: no catch-up jump after an idle loop
    [target, ...legs] = points.map((p) => ({ x: p.x, z: p.z }));
    destination = points.length ? { ...points[points.length - 1] } : null;
    if (!target) arrived();
  }

  /** A short straight walk through `points` (no router), then onArrive. */
  function stepTo(points, onArrive = null) {
    const list = (Array.isArray(points) ? points : [points]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
    arrive = typeof onArrive === 'function' ? onArrive : null;
    if (!list.length) { arrived(); return; }
    follow(list);
  }

  function goTo(x, z, onArrive = null) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    clearActivity();
    const r = typeof route === 'function' ? routeTo(x, z) : { points: [{ x, z }], reached: true };
    if (!r || !r.points.length) return null;
    arrive = typeof onArrive === 'function' ? onArrive : null;
    const end = r.points[r.points.length - 1];
    if (Math.hypot(end.x - pose.x, end.z - pose.z) < 0.05) { target = null; legs = []; destination = null; arrived(); return { ...end, reached: r.reached }; }
    follow(r.points);
    return { x: end.x, z: end.z, reached: r.reached };
  }

  function step() {
    const t = clock();
    // capped at 0.5 s: a slow machine (or a capped loop) still walks at wall-clock speed, so a walk-then-act (the
    // bench) lands on time; only a long pause (a hidden tab) is cut short
    const dt = lastT === null ? 0 : Math.min(0.5, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    if (target) {
      let s = AVATAR_SPEED * (pose.ride ? RIDE_SPEED_K : 1) * dt;
      // the frame's step carries on round a corner (a fast frame never stops at a waypoint)
      while (target && s > 0) {
        const dx = target.x - pose.x;
        const dz = target.z - pose.z;
        const d = Math.hypot(dx, dz);
        if (d <= s) {
          pose.x = target.x; pose.z = target.z;
          s -= d;
          target = legs.shift() ?? null;
          if (d > 1e-6) pose.f = Math.atan2(dx, dz);
        } else {
          pose.x += (dx / d) * s; pose.z += (dz / d) * s; pose.f = Math.atan2(dx, dz);
          s = 0;
        }
      }
      pose.a = target ? 1 : 0;
      if (!target) destination = null;
      view.me.update(pose);
      if (!target && arrive) { arrived(); return; }
    }
    // the first frame always sends (acc starts full), later ones at PRESENCE_HZ
    acc = Math.min(acc + dt, SEND_S * 2);
    if (acc < SEND_S) return;
    acc -= SEND_S;
    sendPose();
  }

  view.onFrame(step);
  return {
    pose,
    walkTo,
    goTo,
    stepTo,
    /** The point the current walk ends at, or null when standing. */
    get destination() { return destination ? { ...destination } : null; },
    setCursor(c) { cursor = c; },
    setTool(id) { tool = typeof id === 'string' && /^[a-z_]{1,16}$/.test(id) ? id : null; },
    place(x, z) { teleport(x, z); },
    resync() { lastSent = ''; hop = true; acc = SEND_S; },
    setRiding(on) {
      const v = Boolean(on);
      if (v === pose.ride) return false;
      pose.ride = v;
      view.me.update(pose);
      acc = SEND_S;                                        // the partner sees the mount / dismount on the next frame
      return true;
    },
    get riding() { return pose.ride; },
    setActivity(t, act = null) {
      const next = typeof t === 'string' && /^[a-z_]{1,16}$/.test(t) ? t : null;
      const nextAct = next && act && typeof act === 'object' ? { ...act } : null;
      if (next === activity && JSON.stringify(nextAct) === JSON.stringify(pose.act)) return false;
      activity = next;
      pose.act = nextAct;
      if (nextAct && Number.isFinite(nextAct.face)) pose.f = nextAct.face;
      view.me.update(pose);
      acc = SEND_S;                                        // the partner sees the rod on the next frame
      return true;
    },
    get activity() { return activity; },
    get moving() { return Boolean(target); },
    flush() { sendPose(); acc = 0; },
    /** True while a walkTo's onArrive is waiting (tests, the controller). */
    get walking() { return Boolean(target); },
  };
}
