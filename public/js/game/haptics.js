// Haptics (mobile wave 2026-10-03): short vibration pulses where the browser has them (Chrome and Firefox on
// Android; iOS Safari has no navigator.vibrate, so nothing happens there). Owned by the mobile input lane.
//
//   createHaptics({ nav?, enabled?, now?, minGapMs? }) -> { available, pulse(kind) -> bool }
//   PULSES                          the patterns (ms): tick (a long press, a view snap, the ghost moved), harvest,
//                                   place, levelUp; release 1.0 F5 (feel#11, life-feel): plant (every 3rd plot of a
//                                   stroke, game/feedback.js), bonk (a refusal), coins (a sale), reward (a quest card,
//                                   an order filled)
// Rules: nothing when the player turned haptics off (controller option `haptics`), at most one pulse per minGapMs
// (a 30-plot sickle stroke is a soft purr, not a motor stuck on), a level-up and a reward always get their pattern.
// iOS Safari has no navigator.vibrate: every call is a no-op there (available false), never an error.

export const PULSES = Object.freeze({
  tick: 8,
  harvest: 12,
  place: 20,
  levelUp: Object.freeze([28, 60, 28, 60, 90]),
  plant: 8,
  bonk: Object.freeze([10, 30, 10]),
  coins: Object.freeze([6, 40, 6]),
  reward: Object.freeze([15, 50, 25]),
});
/** Patterns that are never swallowed by the gap rule (a moment, not a stroke). */
const ALWAYS = new Set(['levelUp', 'reward']);

export function createHaptics({ nav = globalThis.navigator, enabled = () => true, now = () => performance.now(), minGapMs = 90 } = {}) {
  const can = Boolean(nav && typeof nav.vibrate === 'function');
  let last = -Infinity;
  return {
    get available() { return can; },
    pulse(kind) {
      if (!can || !enabled() || !Object.hasOwn(PULSES, kind)) return false;
      const t = now();
      if (!ALWAYS.has(kind) && t - last < minGapMs) return false;
      last = t;
      const p = PULSES[kind];
      try { return nav.vibrate(Array.isArray(p) ? [...p] : p) !== false; } catch { return false; }
    },
  };
}
