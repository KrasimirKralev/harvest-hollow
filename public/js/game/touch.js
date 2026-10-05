// Touch gestures, the pure part (mobile wave 2026-10-03). Owned by the mobile input lane; the controller
// (game/controller.js) runs the gesture state machine with these helpers, and test/mobile-input.test.js tests them.
//
// The touch model (docs/agent-briefs/mobile-input.md):
//   - a tap does what a click does with the tool in hand; a tap on open ground walks the farmer there
//   - one finger dragged: from an actionable target it paints (the mouse's drag-paint), from anywhere else it pans
//     (grab the ground: the point under the finger stays under it), with inertia when it lets go
//   - two fingers: pan with their midpoint, pinch to zoom about it, a twist turns the view in 90° snaps
//   - a long press (450 ms) shows the tooltip instead of acting; a double tap focuses the camera
//   - build mode: a tap moves the ghost, a drag on the ghost carries it (drawn above the finger), a tap on the ghost
//     (or the ✓ of game/touch-build.js) places it
//
//   TOUCH                                          the gesture constants
//   tapSlop(dpr) -> CSS px                         how far a finger may wander before a press stops being a tap
//   pair(a, b) -> { x, y, dist, ang }              midpoint, spread and angle of two touch points (CSS px)
//   angleDelta(from, to) -> radians in (-π, π]     the shortest turn between two angles
//   twist(acc, d, spread) -> { acc, turn }         accumulate a two-finger twist; turn = ±1 when it crossed a snap
//   isDoubleTap(prev, tap) -> bool                 two taps close in time and place
//   groundAt(cam, ndc, aspect, fovDeg) -> { x, z } | null   where a screen point meets the ground (metres)
//   flingStep(v, dt, rate) -> v'                   pan inertia: exponential decay of a velocity

export const TOUCH = Object.freeze({
  longMs: 450,          // a press held this long without moving shows the tooltip and does not act
  tipLeadMs: 250,       // the ui's world tooltip waits 250 ms after a hover: the hover goes out this much earlier
  doubleMs: 320,        // two taps within this ...
  doublePx: 32,         // ... and this many CSS px focus the camera
  snapRad: (38 * Math.PI) / 180,   // a two-finger twist this large turns the view a quarter
  minSpreadPx: 48,      // two fingers closer than this: their angle is noise, no twist
  ghostLiftPx: 56,      // the build ghost rides this far above a dragging finger, so the finger never hides it
  flingMin: 0.6,        // tiles/s: a slower release just stops
  flingRate: 4.2,       // 1/s: how fast the glide after a pan dies out (~0.5 s to a near stop)
  flingMax: 60,         // tiles/s: a wild flick is capped
});

/**
 * How far (CSS px) a finger may move before a press is a drag. Event coordinates are CSS px, so the base is a
 * physical size (~1.5 mm at a phone's ~160 CSS px per inch); dense 3x screens are the big phones held in one hand,
 * whose thumb rolls further as it lifts, so the slop grows a little with the device pixel ratio.
 */
export function tapSlop(dpr = 1) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(16, Math.max(9, 6 + 2.5 * d));
}

/** Midpoint, spread and angle (radians, screen y down) of two touch points. */
export function pair(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(dx, dy), ang: Math.atan2(dy, dx) };
}

/** The shortest signed turn from angle `from` to angle `to` (radians), in (-π, π]. */
export function angleDelta(from, to) {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Accumulate a two-finger twist of `d` radians. Past TOUCH.snapRad it turns the view one quarter (turn ±1, +1 for a
 * clockwise twist on screen) and starts counting again. Fingers too close together (`spread` < minSpreadPx) add
 * nothing: their angle jumps around with every pixel.
 */
export function twist(acc, d, spread = Infinity) {
  if (!(spread >= TOUCH.minSpreadPx) || !Number.isFinite(d)) return { acc, turn: 0 };
  const a = acc + d;
  if (a >= TOUCH.snapRad) return { acc: 0, turn: 1 };
  if (a <= -TOUCH.snapRad) return { acc: 0, turn: -1 };
  return { acc: a, turn: 0 };
}

/** Is `tap` the second tap of a double tap after `prev`? (both { t ms, x, y }) */
export function isDoubleTap(prev, tap) {
  if (!prev || !tap) return false;
  const dt = tap.t - prev.t;
  return dt >= 0 && dt <= TOUCH.doubleMs && Math.hypot(tap.x - prev.x, tap.y - prev.y) <= TOUCH.doublePx;
}

/**
 * Where the screen point `ndc` meets the ground plane y = 0, in metres, for the orbit camera of render/camera.js
 * (target (tx, 0, tz), `dist` metres away at `yaw` round it and `pitch` above it, looking at the target, vertical
 * field of view `fovDeg`). No raycast, no side effects (view.pick also moves the hover lift and the crops' wind),
 * so two-finger gestures can call it on every move. Null when the ray does not come down to the ground.
 * @param {{ tx: number, tz: number, dist: number, yaw: number, pitch: number }} cam
 * @param {{ x: number, y: number }} ndc   [-1, 1], y up
 */
export function groundAt(cam, ndc, aspect, fovDeg = 30) {
  if (!cam || !ndc || !(aspect > 0)) return null;
  const { tx, tz, dist, yaw, pitch } = cam;
  if (![tx, tz, dist, yaw, pitch, ndc.x, ndc.y].every(Number.isFinite)) return null;
  const sy = Math.sin(yaw); const cy = Math.cos(yaw);
  const sp = Math.sin(pitch); const cp = Math.cos(pitch);
  const P = [tx + sy * cp * dist, sp * dist, tz + cy * cp * dist];
  const f = [-sy * cp, -sp, -cy * cp];          // forward (unit: |P - target| = dist)
  const r = [cy, 0, -sy];                        // right = forward x up
  const u = [-sy * sp, cp, -cy * sp];            // up = right x forward
  const k = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const d = [0, 1, 2].map((i) => f[i] + ndc.x * k * aspect * r[i] + ndc.y * k * u[i]);
  if (d[1] >= -1e-6) return null;                // at or above the horizon
  const t = -P[1] / d[1];
  return { x: P[0] + t * d[0], z: P[2] + t * d[2] };
}

/** One frame of pan inertia: the velocity after `dt` seconds of exponential decay at `rate` per second. */
export function flingStep(v, dt, rate = TOUCH.flingRate) {
  const k = Math.exp(-rate * Math.max(0, dt));
  return { x: v.x * k, z: v.z * k };
}
