// The page rests while nobody touches it (qa2 CL-03, the owners' laptops run hot). Owned by the client-core lane.
//
// An infinite CSS animation (the tutorial pointer's halo, a tool hint's glow, the dock's bobbing badges, the Golden
// Hour buff) keeps Chrome producing a main frame at 60 Hz with a full style pass, whatever the 3D loop does: on the
// heavy L25 farm at rest that was ~60 of ~100 main-thread ms per second (docs/qa/qa2/fix-client/perf). After
// REST.calmMs without a pointer, key, wheel or touch input the running infinite animations are paused where they
// are (they stay on screen, still); any input plays them on at once. Finite animations (a toast sliding in, a level
// card) always finish. While resting, an infinite animation that starts later (a new badge) is paused too.
//
//   createRest({ win, doc, calmMs?, recheckMs? }) -> { resting, wake(), stop() }

export const REST = Object.freeze({ calmMs: 10_000, recheckMs: 3000 });
const INPUTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];

/**
 * Running CSS animations that never end (iterations Infinity), except those inside `[data-rest="keep"]`: the welcome
 * painting's chimney smoke runs only on the boot and slot-picker screens (no 3D loop yet, compositor-only), and a
 * plume frozen in mid-air after 10 s on the picker reads as a broken page.
 */
export function endlessAnimations(doc) {
  if (!doc || typeof doc.getAnimations !== 'function') return [];
  return doc.getAnimations().filter((a) => a && a.playState === 'running' && a.effect
    && typeof a.effect.getTiming === 'function' && a.effect.getTiming().iterations === Infinity
    && !a.effect.target?.closest?.('[data-rest="keep"]'));
}

export function createRest({ win = globalThis.window, doc = globalThis.document, calmMs = REST.calmMs, recheckMs = REST.recheckMs,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
  let paused = [];
  let timer = null;
  let resting = false;
  const pauseAll = () => {
    for (const a of endlessAnimations(doc)) {
      try { a.pause(); paused.push(a); } catch { /* an animation that went away meanwhile */ }
    }
  };
  const rest = () => {
    resting = true;
    pauseAll();
    timer = setTimer(rest, recheckMs);                  // later ones (a badge that appeared) rest too
  };
  let wokeAt = -Infinity;
  const wake = () => {
    // pointermove fires at the display rate: re-arming the timer twice a second is plenty
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!resting && t - wokeAt < 500) return;
    wokeAt = t;
    clearTimer(timer);
    if (resting) {
      resting = false;
      for (const a of paused) { try { a.play(); } catch { /* removed meanwhile */ } }
      paused = [];
    }
    timer = setTimer(rest, calmMs);
  };
  for (const ev of INPUTS) win?.addEventListener?.(ev, wake, { capture: true, passive: true });
  wake();
  return {
    get resting() { return resting; },
    wake,
    stop() { clearTimer(timer); for (const ev of INPUTS) win?.removeEventListener?.(ev, wake, { capture: true }); },
  };
}
