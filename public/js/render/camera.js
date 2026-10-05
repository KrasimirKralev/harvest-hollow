// Iso-style camera (GDD §8.3, visual-ux-juice §3.4, tech §10.10): FOV 30, yaw 45 + k*90 (Q/E, 400 ms
// inOutCubic), pitch easing 36..54 deg with distance 18..90 m, wheel zoom x1.12 per notch toward the cursor
// with exponential damping (12/s), pan clamped to the owned land + 6 m, focus eases 500 ms (outCubic).
// Positions in metres. The target, distance and turn are remembered per browser. Owned by the render-world lane.
//
//   createCamera(target?, { touch?, kind? }) -> cam
//     cam.update(dt) -> 2 while moving, else 0     cam.resize(aspect, { w, h }?)  (CSS px of the canvas)
//     cam.rotate(dir) / cam.pan(right, forward) / cam.zoom(factor, anchor?: {x, z} metres) / cam.focus(x, z tiles)
//     cam.setBounds({ x0, z0, x1, z1 } tiles) / cam.get() -> { tx, tz, dist, yaw, pitch, k }
//   pitchFor(dist, add?) / clampTarget(t, bounds, inset?) / zoomToward(target, anchor, factor)   pure (tested)
//
// Mobile wave (render lane), touch devices only (a desktop keeps every number above):
//   framingFor({ w, h, touch, kind }) -> { defDist, minDist, maxDist, pitchAdd, touch }   pure (tested): the default
//        distance gives a finger-sized ground scale (TOUCH.scale CSS px per metre: a plot is a ~57 px diamond); a
//        portrait screen looks down up to 4 deg steeper (its tall view would otherwise run to the horizon) and may
//        zoom out to 110 m
//   cam.resize: turning the device keeps the ground scale (objects keep their size on screen); a resize that does
//        not flip the orientation (a toolbar, the keyboard) keeps the distance
//   pan bounds: the target stays far enough inside the land that the farm, not the forest, fills the view
//        (centredInset: 70 % of the visible half-width, less the margin)
//   cam.fling({ vx, vz } m/s) -> boolean   a touch pan just ended (the controller measures the target's release velocity):
//        glide on, easing out (TOUCH.friction per second), capped at TOUCH.maxSpeed, stopping at the land's edge; any pan,
//        zoom, focus, turn or cam.stop() (a finger touching down) ends the glide
// Wave 4 (owner wish H, "camera tilt"): a free orbit on top of the quarter turns
//   cam.orbit(dYaw, dPitch) radians: turn the view freely about its target and tilt it (TILT.min..TILT.max, 30-85 deg: near
//        top-down allowed); a tilted camera keeps its pitch while zooming. cam.resetOrbit(): ease back to the nearest quarter
//        turn and the distance's own pitch. Q / E (rotate) turn on from wherever the free yaw is. Yaw and tilt are remembered
//        per browser with the rest of the camera (hh.camera).
//   tiltClamp(p) pure (tested)
import * as THREE from 'three';
import { TILE_M, WORLD_TILES } from '../../../shared/content/config.js';
import { farm } from '../net/farm.js';

const DEG = Math.PI / 180;
export const CAM = Object.freeze({ fov: 30, minDist: 18, maxDist: 90, defDist: 55, rotateMs: 400, focusMs: 500, margin: 6, zoomRate: 12 });
export const TOUCH = Object.freeze({ scale: 20, tabletScale: 22, maxDist: 110, portraitPitch: 4, friction: 4.2, minSpeed: 1.2,
  maxSpeed: 60 });
/** The free tilt's range (radians): a little flatter than the zoomed-in default up to almost straight down. */
export const TILT = Object.freeze({ min: 30 * (Math.PI / 180), max: 85 * (Math.PI / 180), resetMs: 400 });
/** Clamp a tilt (radians) to TILT (pure). */
export function tiltClamp(p) { return Math.min(TILT.max, Math.max(TILT.min, p)); }
/** The lowest free tilt at a camera distance (pure; client lane's measurement, w4-client notes): TILT.min close up,
 *  rising to 44 deg at the farthest zoom. A far, low view runs toward the horizon and draws far more of the world (busy
 *  farm, desktop high, 90 m: 30 deg 218k triangles / 56 calls, 42 deg 193k / 53, the default 54 deg 180k / 51). */
export function tiltFloor(dist) {
  const k = Math.min(1, Math.max(0, (dist - CAM.minDist) / (CAM.maxDist - CAM.minDist)));
  return TILT.min + ((44 * Math.PI) / 180 - TILT.min) * k;
}
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Pitch (radians) for a camera distance: 36 deg close up, 54 deg far out (plus `add` degrees: portrait phones). */
export function pitchFor(dist, add = 0) {
  const k = Math.min(1, Math.max(0, (dist - CAM.minDist) / (CAM.maxDist - CAM.minDist)));
  return (36 + 18 * k + add) * DEG;
}

/** Clamp a target (metres) to bounds (tiles) + the margin, `inset` metres further in (never past the centre). */
export function clampTarget(t, b, inset = 0) {
  const axis = (v, a0, a1) => {
    let lo = a0 * TILE_M - CAM.margin;
    let hi = a1 * TILE_M + CAM.margin;
    if (inset > 0) {
      const mid = (lo + hi) / 2;
      lo = Math.min(mid, lo + inset);
      hi = Math.max(mid, hi - inset);
    }
    return Math.min(hi, Math.max(lo, v));
  };
  return { x: axis(t.x, b.x0, b.x1), z: axis(t.z, b.z0, b.z1) };
}

/** Zooming by `factor` about a ground anchor keeps the anchor under the cursor. */
export function zoomToward(target, anchor, factor) {
  return { x: anchor.x + (target.x - anchor.x) * factor, z: anchor.z + (target.z - anchor.z) * factor };
}

/** The camera framing for a canvas of w x h CSS px (see the header). Desktop: CAM unchanged. */
export function framingFor({ w = 1366, h = 768, touch = false, kind = 'phone' } = {}) {
  if (!touch || !(w > 0) || !(h > 0)) return { defDist: CAM.defDist, minDist: CAM.minDist, maxDist: CAM.maxDist, pitchAdd: 0, touch: false };
  const scale = kind === 'tablet' ? TOUCH.tabletScale : TOUCH.scale;
  const defDist = clamp((h / 2) / (scale * Math.tan((CAM.fov / 2) * DEG)), 26, 100);
  const portrait = clamp((1 - w / h) / 0.45, 0, 1);       // 0 square or wider, 1 at 0.55:1 and taller
  return { defDist, minDist: CAM.minDist, maxDist: clamp(defDist * 1.3, CAM.maxDist, TOUCH.maxDist), pitchAdd: TOUCH.portraitPitch * portrait, touch: true };
}

/** How far (metres) the target keeps inside the bounds so the farm fills a touch screen (see the header). */
export function centredInset(dist, aspect) {
  const half = dist * Math.tan((CAM.fov / 2) * DEG) * Math.max(0.2, aspect);
  return Math.max(0, half * 0.7 - CAM.margin);
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(farm.key('hh.camera')) || 'null'); } catch { return null; }
}

export function createCamera(target = { x: 28 * TILE_M, z: 32 * TILE_M }, { touch = false, kind = 'phone' } = {}) {
  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 1, 900);
  const saved = loadSaved();
  const ok = (v) => Number.isFinite(v);
  const k0 = ok(saved?.k) ? saved.k : 0;
  const s = {
    tx: ok(saved?.tx) ? saved.tx : target.x, tz: ok(saved?.tz) ? saved.tz : target.z,
    dist: ok(saved?.dist) ? saved.dist : CAM.defDist, k: k0,
    yaw: ok(saved?.yaw) ? saved.yaw : Math.PI / 4 + k0 * (Math.PI / 2),
    tilt: ok(saved?.tilt) ? tiltClamp(saved.tilt) : null,   // wave 4: a free tilt (radians) or null = the distance's pitch
    tiltTween: null,                       // resetOrbit: { from, t0 } back to the distance's pitch
    goalDist: null, goalT: null,           // wheel zoom (damped)
    tween: null,                           // rotation { from, to, t0 }
    focus: null,                           // { fx, fz, tx, tz, t0 }
    glide: null,                           // touch inertia { vx, vz } metres/s
  };
  s.goalDist = s.dist;
  let bounds = { x0: 0, z0: 0, x1: WORLD_TILES, z1: WORLD_TILES };
  let moved = true;
  let saveAt = 0;
  let frame = framingFor({ touch: false });
  let aspect = 1;
  // touch: the viewport the distance was chosen for (a saved camera remembers its own), and whether the distance
  // still has to come from the framing (a first visit on this device)
  let view = touch && ok(saved?.vh) && ok(saved?.vw) ? { w: saved.vw, h: saved.vh } : null;
  // (a camera saved before the mobile wave has no viewport: its distance was a desktop default, so re-frame it once)
  let fresh = touch && !(ok(saved?.dist) && ok(saved?.vh));

  const inset = () => (frame.touch ? centredInset(s.dist, aspect) : 0);
  /** The pitch in force: the free tilt when there is one (easing back to the distance's own after a reset). */
  function pitchNow() {
    const auto = pitchFor(s.dist, frame.pitchAdd);
    if (s.tiltTween) {
      const k = Math.min(1, (performance.now() - s.tiltTween.t0) / TILT.resetMs);
      return s.tiltTween.from + (auto - s.tiltTween.from) * easeInOutCubic(k);
    }
    // the chosen tilt, raised to the zoom's floor while zoomed out (zooming back in brings the chosen one back)
    return s.tilt !== null ? Math.max(s.tilt, tiltFloor(s.dist)) : auto;
  }
  function place() {
    const p = pitchNow();
    camera.position.set(s.tx + Math.sin(s.yaw) * Math.cos(p) * s.dist, Math.sin(p) * s.dist, s.tz + Math.cos(s.yaw) * Math.cos(p) * s.dist);
    camera.lookAt(s.tx, 0, s.tz);
    camera.updateMatrixWorld();
  }
  function clamp3() {
    const c = clampTarget({ x: s.tx, z: s.tz }, bounds, inset());
    s.tx = c.x; s.tz = c.z;
    s.dist = clamp(s.dist, frame.minDist, frame.maxDist);
    s.goalDist = clamp(s.goalDist, frame.minDist, frame.maxDist);
    if (s.goalT) { const g = clampTarget(s.goalT, bounds, inset()); s.goalT = g; }
  }
  function save() {
    saveAt = performance.now() + 400;
  }
  function flushSave() {
    const v = view ? { vw: view.w, vh: view.h } : {};
    const o = { ...(s.tilt !== null ? { tilt: s.tilt } : {}), ...(Math.abs(s.yaw - (Math.PI / 4 + s.k * (Math.PI / 2))) > 1e-4 ? { yaw: s.yaw } : {}) };
    try { localStorage.setItem(farm.key('hh.camera'), JSON.stringify({ tx: s.tx, tz: s.tz, dist: s.dist, k: s.k, ...v, ...o })); } catch { /* private mode */ }
  }
  place();

  return {
    camera,
    update(dt = 1 / 60) {
      let active = false;
      const t = performance.now();
      if (s.tween) {
        const k = Math.min(1, (t - s.tween.t0) / CAM.rotateMs);
        s.yaw = s.tween.from + (s.tween.to - s.tween.from) * easeInOutCubic(k);
        if (k >= 1) { s.tween = null; save(); }
        active = true;
      }
      if (s.tiltTween) {
        if (t - s.tiltTween.t0 >= TILT.resetMs) { s.tiltTween = null; save(); }
        active = true;
      }
      if (s.focus) {
        const k = Math.min(1, (t - s.focus.t0) / CAM.focusMs);
        const e = easeOutCubic(k);
        s.tx = s.focus.fx + (s.focus.tx - s.focus.fx) * e;
        s.tz = s.focus.fz + (s.focus.tz - s.focus.fz) * e;
        if (k >= 1) { s.focus = null; save(); }
        active = true;
      }
      if (s.glide) {
        const g = s.glide;
        const x0 = s.tx; const z0 = s.tz;
        s.tx += g.vx * dt;
        s.tz += g.vz * dt;
        const c = clampTarget({ x: s.tx, z: s.tz }, bounds, inset());
        // a glide that meets the edge of the land stops along that axis (no sliding against the wall)
        if (c.x !== s.tx) g.vx = 0;
        if (c.z !== s.tz) g.vz = 0;
        s.tx = c.x; s.tz = c.z;
        const f = Math.exp(-TOUCH.friction * dt);
        g.vx *= f; g.vz *= f;
        if (Math.hypot(g.vx, g.vz) < 0.25 || (s.tx === x0 && s.tz === z0)) { s.glide = null; save(); }
        active = true;
      }
      if (Math.abs(s.goalDist - s.dist) > 0.005 || s.goalT) {
        const a = 1 - Math.exp(-CAM.zoomRate * dt);
        s.dist += (s.goalDist - s.dist) * a;
        if (s.goalT) {
          s.tx += (s.goalT.x - s.tx) * a;
          s.tz += (s.goalT.z - s.tz) * a;
          if (Math.abs(s.goalT.x - s.tx) + Math.abs(s.goalT.z - s.tz) < 0.01) { s.tx = s.goalT.x; s.tz = s.goalT.z; s.goalT = null; }
        }
        if (Math.abs(s.goalDist - s.dist) <= 0.005) s.dist = s.goalDist;
        active = true;
      }
      if (saveAt && t >= saveAt) { saveAt = 0; flushSave(); }
      if (active || moved) { clamp3(); place(); moved = false; return 2; }
      return 0;
    },
    /** A new canvas size: aspect, and on touch devices the CSS size (framing, and the scale kept across a turn). */
    resize(a, size = null) {
      aspect = a;
      camera.aspect = a;
      camera.updateProjectionMatrix();
      if (touch && size && size.w > 0 && size.h > 0) {
        frame = framingFor({ w: size.w, h: size.h, touch, kind });
        if (fresh) {
          s.dist = s.goalDist = frame.defDist;
          fresh = false;
        } else if (view && (view.w > view.h) !== (size.w > size.h)) {
          // the device turned: the ground keeps its size on screen (px per metre ~ height / distance)
          const k = size.h / view.h;
          s.dist *= k;
          s.goalDist *= k;
        }
        view = { w: size.w, h: size.h };
        s.glide = null;
        save();
      }
      moved = true;
    },
    /** Quarter-turn the view (dir = +1 / -1); after a free orbit it turns on to the next quarter from where it is. */
    rotate(dir) {
      // from where the view is heading (a turn in progress counts as done: E E turns twice), or the free yaw
      const q = ((s.tween ? s.tween.to : s.yaw) - Math.PI / 4) / (Math.PI / 2);
      const off = Math.abs(q - Math.round(q)) > 0.02;
      s.k = off ? (dir > 0 ? Math.ceil(q) : Math.floor(q)) : Math.round(q) + (dir > 0 ? 1 : -1);
      s.glide = null;
      s.tween = { from: s.yaw, to: Math.PI / 4 + s.k * (Math.PI / 2), t0: performance.now() };
    },
    /** Wave 4 (wish H): turn freely by dYaw and tilt by dPitch (radians); the tilt stays within TILT. */
    orbit(dYaw = 0, dPitch = 0) {
      if (!Number.isFinite(dYaw) || !Number.isFinite(dPitch)) return;
      s.tween = null; s.glide = null; s.tiltTween = null;
      s.yaw += dYaw;
      s.k = Math.round((s.yaw - Math.PI / 4) / (Math.PI / 2));
      if (dPitch) s.tilt = Math.max(tiltFloor(s.dist), tiltClamp((s.tilt !== null ? Math.max(s.tilt, tiltFloor(s.dist)) : pitchFor(s.dist, frame.pitchAdd)) + dPitch));
      moved = true; save();
    },
    /** Back to the nearest quarter turn and the distance's own pitch (eased, 400 ms). */
    resetOrbit() {
      s.glide = null;
      s.k = Math.round((s.yaw - Math.PI / 4) / (Math.PI / 2));
      s.tween = { from: s.yaw, to: Math.PI / 4 + s.k * (Math.PI / 2), t0: performance.now() };
      if (s.tilt !== null) { s.tiltTween = { from: s.tilt, t0: performance.now() }; s.tilt = null; }
      moved = true; save();
    },
    /** Pan in camera-relative metres: right, forward. */
    pan(right, forward) {
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      const dx = fx * forward + -fz * right;
      const dz = fz * forward + fx * right;
      s.tx += dx;
      s.tz += dz;
      s.focus = null;
      s.glide = null;
      if (s.goalT) { s.goalT.x += dx; s.goalT.z += dz; }
      clamp3(); moved = true; save();
    },
    /** A touch pan ended: glide on at its release velocity (m/s; false when too slow to glide). */
    fling(vel) {
      if (!vel || !Number.isFinite(vel.vx) || !Number.isFinite(vel.vz)) return false;
      const sp = Math.hypot(vel.vx, vel.vz);
      if (sp < TOUCH.minSpeed) return false;
      const k = sp > TOUCH.maxSpeed ? TOUCH.maxSpeed / sp : 1;
      s.glide = { vx: vel.vx * k, vz: vel.vz * k };
      s.focus = null;
      moved = true;
      return true;
    },
    /** A finger came down: the glide stops where it is. */
    stop() { if (s.glide) { s.glide = null; save(); } },
    /** Zoom by a factor (wheel: 1.12 per notch); `anchor` (metres) stays under the cursor. */
    zoom(factor, anchor = null) {
      const before = s.goalDist;
      s.goalDist = clamp(s.goalDist * factor, frame.minDist, frame.maxDist);
      const real = s.goalDist / before;
      s.glide = null;
      if (anchor && Math.abs(real - 1) > 1e-4) {
        const from = s.goalT || { x: s.tx, z: s.tz };
        s.goalT = clampTarget(zoomToward(from, anchor, real), bounds, inset());
        s.focus = null;                      // a zoom toward the cursor takes over from a running focus
      }
      moved = true; save();
    },
    /** Ease to a point given in tiles. */
    focus(x, z) {
      s.goalT = null;
      s.glide = null;
      const c = clampTarget({ x: x * TILE_M, z: z * TILE_M }, bounds, inset());
      s.focus = { fx: s.tx, fz: s.tz, tx: c.x, tz: c.z, t0: performance.now() };
    },
    setBounds(b) { bounds = b; clamp3(); moved = true; },
    get: () => ({ tx: s.tx, tz: s.tz, dist: s.dist, yaw: s.yaw, pitch: pitchNow(), k: s.k, tilt: s.tilt, tilted: s.tilt !== null }),
    /** The framing in force (tests, dev tools). */
    get framing() { return { ...frame, gliding: Boolean(s.glide) }; },
  };
}
