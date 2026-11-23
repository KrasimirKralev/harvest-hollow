// Tweens, easing and springs for world feedback (visual-ux-juice §4.11), on the FV2 tempo grid (60 BPM idle,
// 120 BPM attention, 240 BPM celebration; GDD §8.4). No dependency, no allocation per frame for a running
// tween. Owned by the render-life lane; render-world uses it for squash-pops, drops and shakes.
//
// API (stable):
//   EASE.{linear, outCubic, inCubic, inOutCubic, inOutSine, outBack, outElastic, outQuad, inQuad}(t) -> number
//   BEAT = { idle: 1.0, attention: 0.5, celebrate: 0.25 }        seconds per beat (60 / 120 / 240 BPM)
//   DUR  = { micro: 0.12, beat: 0.25, move: 0.5, ambient: 1.0 }  standard durations (seconds)
//   createTweener() -> { tween, spring, update(seconds), isAnimating(), count(), clear() }   independent clocks
//     tween({ duration, ease = EASE.outCubic, delay = 0, onUpdate(e, k), onDone? }) -> cancel()
//        onUpdate gets the eased value e and the raw progress k (0..1); it runs once with k = 1 at the end
//     spring({ k = 120, c = 9, x = 1, v = 0, eps = 0.002, onUpdate(x), onDone? }) -> cancel()
//        damped spring x'' = -k x - c x' toward 0, integrated in fixed 1/120 s steps (tree shake, ribbon swing)
//   tweens                          the shared default tweener (fx, avatars and animals use it)
//   tween(opts) / spring(opts) / updateTweens(seconds) / isAnimating()   shortcuts on `tweens`
//   squashPop(t) -> { sx, sy }      volume-preserving squash-and-stretch for a 0..1 pop (plant, place, stage-up)
//   dropBounce(t, h = 0.6) -> { y, sy }   "drop from 0.6 m, squash on landing" (GDD §7.2 buy/place)
//   shake(t, amp = 1, n = 2) -> number    invalid-action shake (±amp, n wiggles, decaying) for 0..1
// `update(seconds)` takes an absolute clock (the render loop's time in seconds); call it once per frame.

export const EASE = Object.freeze({
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inCubic: (t) => t ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
});

export const BEAT = Object.freeze({ idle: 1.0, attention: 0.5, celebrate: 0.25 });
export const DUR = Object.freeze({ micro: 0.12, beat: 0.25, move: 0.5, ambient: 1.0 });

const STEP = 1 / 120;

export function createTweener() {
  const active = new Set();
  const springs = new Set();
  let clock = 0;
  let started = false;

  function tween({ duration, ease = EASE.outCubic, delay = 0, onUpdate, onDone }) {
    const tw = { start: clock + delay, duration: Math.max(1e-4, duration), ease, onUpdate, onDone };
    active.add(tw);
    return () => active.delete(tw);
  }

  function spring({ k = 120, c = 9, x = 1, v = 0, eps = 0.002, onUpdate, onDone }) {
    const sp = { k, c, x, v, eps, onUpdate, onDone, acc: 0, last: clock };
    springs.add(sp);
    return () => springs.delete(sp);
  }

  function run(fn, ...args) {
    try { fn(...args); } catch (err) { console.error('tween callback failed', err); }
  }

  function update(seconds) {
    const dt = started ? Math.min(0.25, Math.max(0, seconds - clock)) : 0;
    started = true;
    clock = seconds;
    for (const tw of active) {
      const k = (clock - tw.start) / tw.duration;
      if (k < 0) continue;
      const kk = Math.min(k, 1);
      if (tw.onUpdate) run(tw.onUpdate, tw.ease(kk), kk);
      if (k >= 1) { active.delete(tw); if (tw.onDone) run(tw.onDone); }
    }
    for (const sp of springs) {
      sp.acc += dt;
      while (sp.acc >= STEP) {
        const a = -sp.k * sp.x - sp.c * sp.v;
        sp.v += a * STEP;
        sp.x += sp.v * STEP;
        sp.acc -= STEP;
      }
      if (sp.onUpdate) run(sp.onUpdate, sp.x);
      if (Math.abs(sp.x) < sp.eps && Math.abs(sp.v) < sp.eps * 10) {
        springs.delete(sp);
        if (sp.onUpdate) run(sp.onUpdate, 0);
        if (sp.onDone) run(sp.onDone);
      }
    }
  }

  return {
    tween,
    spring,
    update,
    isAnimating: () => active.size > 0 || springs.size > 0,
    count: () => active.size + springs.size,
    clear() { active.clear(); springs.clear(); },
    now: () => clock,
  };
}

export const tweens = createTweener();
export const tween = (o) => tweens.tween(o);
export const spring = (o) => tweens.spring(o);
export const updateTweens = (s) => tweens.update(s);
export const isAnimating = () => tweens.isAnimating();

/** Squash-and-stretch pop: 0 -> squash 0.92 -> overshoot 1.04 -> 1 (GDD §7.2 plant), volume preserving. */
export function squashPop(t) {
  if (t <= 0 || t >= 1) return { sx: 1, sy: 1 };
  let sy;
  if (t < 0.3) sy = 1 - 0.08 * EASE.outQuad(t / 0.3);
  else if (t < 0.7) sy = 0.92 + 0.12 * EASE.inOutSine((t - 0.3) / 0.4);
  else sy = 1.04 - 0.04 * EASE.outQuad((t - 0.7) / 0.3);
  return { sx: 1 / Math.sqrt(sy), sy };
}

/** Drop from `h` metres with a squash on landing: y (metres above rest) and vertical scale for 0..1. */
export function dropBounce(t, h = 0.6) {
  if (t >= 1) return { y: 0, sy: 1 };
  const fall = 0.55;
  if (t < fall) { const k = t / fall; return { y: h * (1 - k * k), sy: 1 + 0.06 * k }; }
  const k = (t - fall) / (1 - fall);
  const sy = 1 - 0.18 * Math.sin(k * Math.PI) * (1 - k) + 0.05 * Math.sin(k * Math.PI * 2) * (1 - k);
  return { y: 0, sy };
}

/** Invalid-action shake: ±amp with n wiggles, decaying to 0 (GDD §7.2: ±4 px twice in 200 ms). */
export function shake(t, amp = 1, n = 2) {
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(t * Math.PI * 2 * n) * amp * (1 - t);
}
