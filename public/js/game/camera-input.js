// Camera turn and tilt from the pointer (wave 4, owner wish H: "Right-drag: Pan / Rotate camera"; a phone tilts with a
// two-finger vertical drag). The pure part: the controller (game/controller.js) runs the gestures with these helpers,
// render-world's camera (view.camera.orbit / resetOrbit) does the turning, and test/mobile-input.camera.test.js tests them.
// Owned by the client lane.
//
//   ORBIT                                     how far a drag turns and tilts (radians per canvas height)
//   orbitStep(dx, dy, h, out?) -> { yaw, pitch }   radians for a pointer move of (dx, dy) CSS px on a canvas h px tall:
//                                             "grab the farm": a drag to the right turns the near ground to the right,
//                                             a drag down tilts toward top-down (as a map's two-finger tilt does)
//   TILT_GESTURE / tiltIntent(start, now) -> 'tilt' | 'free' | null   two fingers side by side moving up or down together
//                                             tilt; any other two-finger move (pan, pinch, twist) is 'free'; null: not
//                                             yet decided (the fingers have barely moved)
//   canOrbit(view) -> bool                    the camera turns freely (render-world's orbit is there); without it the
//                                             right-drag rotate mode turns in quarter steps and a phone never tilts
//   quarterSteps(acc, w) -> { acc, turn }     the quarter-step fallback: a horizontal drag of QUARTER_PX turns one quarter

/** Radians per canvas height of drag: a full-height drag turns 216 deg, or tilts 135 deg (the 55 deg range in 40 %). */
export const ORBIT = Object.freeze({ yaw: 1.2 * Math.PI, pitch: 0.75 * Math.PI, keyPitch: (6 * Math.PI) / 180 });

/**
 * The turn and tilt for a pointer move. Writes into `out` when given (no garbage per pointer move).
 * @param {number} dx CSS px (right +) @param {number} dy CSS px (down +) @param {number} h the canvas height (CSS px)
 * @returns {{ yaw: number, pitch: number }}
 */
export function orbitStep(dx, dy, h, out = { yaw: 0, pitch: 0 }) {
  const k = 1 / (Number.isFinite(h) && h > 50 ? h : 768);
  out.yaw = Number.isFinite(dx) ? -dx * ORBIT.yaw * k : 0;
  out.pitch = Number.isFinite(dy) ? dy * ORBIT.pitch * k : 0;
  return out;
}

export const TILT_GESTURE = Object.freeze({
  decidePx: 10,           // each finger must travel this far up or down before a tilt is called
  freePx: 18,             // a finger past this that is no tilt: the usual pan / pinch / twist
  sideRatio: 0.6,         // a finger's sideways travel may be at most this share of its vertical travel
  spreadRatio: 0.4,       // the fingers' spread may change at most this share of the vertical travel (+ 4 px)
  maxSlantDeg: 40,        // the line between the fingers within this of horizontal (side by side, not one above the other)
});

const SLANT = Math.sin((TILT_GESTURE.maxSlantDeg * Math.PI) / 180);

/**
 * Is this two-finger gesture a tilt? `start` and `now`: { a: {x, y}, b: {x, y} } CSS px of the two fingers when they went
 * down and now. Pure.
 * @returns {'tilt' | 'free' | null}
 */
export function tiltIntent(start, now) {
  if (!start || !now || !start.a || !start.b || !now.a || !now.b) return 'free';
  const G = TILT_GESTURE;
  const dax = now.a.x - start.a.x; const day = now.a.y - start.a.y;
  const dbx = now.b.x - start.b.x; const dby = now.b.y - start.b.y;
  const spread0 = Math.hypot(start.b.x - start.a.x, start.b.y - start.a.y);
  const spread = Math.hypot(now.b.x - now.a.x, now.b.y - now.a.y);
  const dSpread = Math.abs(spread - spread0);
  const ma = Math.hypot(dax, day);
  const mb = Math.hypot(dbx, dby);
  const move = Math.max(ma, mb);
  const level = spread0 > 0 && Math.abs(start.b.y - start.a.y) / spread0 <= SLANT;
  const ya = Math.abs(day); const yb = Math.abs(dby);
  const together = Math.sign(day) === Math.sign(dby) && ya >= G.decidePx && yb >= G.decidePx;
  const upright = Math.abs(dax) <= ya * G.sideRatio && Math.abs(dbx) <= yb * G.sideRatio;
  const steady = dSpread <= G.spreadRatio * Math.min(ya, yb) + 4;
  if (level && together && upright && steady) return 'tilt';
  if (dSpread >= G.decidePx) return 'free';                         // a pinch
  if (!level && move >= G.decidePx) return 'free';                  // one finger above the other: never a tilt
  if (Math.min(ma, mb) < 3) {
    // one finger reported so far (the browser sends the two fingers' moves one after the other) or held still: wait for
    // the other, unless the moving one goes sideways (a pan, a twist) or travels far alone
    const [dx, dy, m] = ma >= mb ? [dax, day, ma] : [dbx, dby, mb];
    if (m >= G.decidePx && Math.abs(dx) > Math.abs(dy) * G.sideRatio) return 'free';
    return m >= 3 * G.freePx ? 'free' : null;
  }
  if (move >= G.freePx) return 'free';
  // a finger going sideways, or the two going opposite ways (a twist): never a tilt, no need to wait
  const opposite = Math.sign(day) !== Math.sign(dby);
  if (move >= G.decidePx && (opposite || !upright)) return 'free';
  return null;
}

/** Does this view's camera turn freely (render-world's wave-4 orbit)? */
export function canOrbit(view) {
  return Boolean(view && view.camera && typeof view.camera.orbit === 'function');
}

/** Without the free turn: a horizontal drag of this share of the canvas width turns one quarter. */
export const QUARTER_SHARE = 0.16;

/**
 * The quarter-step fallback: accumulate a horizontal drag; past QUARTER_SHARE of the width it turns one quarter (turn ±1:
 * camera.rotate's direction, a drag to the right turns the near ground right, which is camera.rotate(-1)). Pure.
 */
export function quarterSteps(acc, dx, w) {
  const a = acc + (Number.isFinite(dx) ? dx : 0);
  const lim = QUARTER_SHARE * (Number.isFinite(w) && w > 100 ? w : 1366);
  if (a >= lim) return { acc: a - lim, turn: -1 };
  if (a <= -lim) return { acc: a + lim, turn: 1 };
  return { acc: a, turn: 0 };
}
