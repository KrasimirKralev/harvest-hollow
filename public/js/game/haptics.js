// Haptics (mobile wave 2026-10-03): short vibration pulses where the browser has them (Chrome and Firefox on
// Android; iOS Safari has no navigator.vibrate, so nothing happens there). Owned by the mobile input lane.
//
//   createHaptics({ nav?, enabled?, now?, minGapMs? }) -> { available, pulse(kind) -> bool }
//   PULSES                          the patterns (ms): tick (a long press, a view snap, the ghost moved), harvest,
//                                   place, levelUp
// Rules: nothing when the player turned haptics off (controller option `haptics`), at most one pulse per minGapMs
// (a 30-plot sickle stroke is a soft purr, not a motor stuck on), a level-up always gets its pattern.

export const PULSES = Object.freeze({
  tick: 8,
  harvest: 12,
  place: 20,
  levelUp: Object.freeze([28, 60, 28, 60, 90]),
});

export function createHaptics({ nav = globalThis.navigator, enabled = () => true, now = () => performance.now(), minGapMs = 90 } = {}) {
  const can = Boolean(nav && typeof nav.vibrate === 'function');
  let last = -Infinity;
  return {
    get available() { return can; },
    pulse(kind) {
      if (!can || !enabled() || !Object.hasOwn(PULSES, kind)) return false;
      const t = now();
      if (kind !== 'levelUp' && t - last < minGapMs) return false;
      last = t;
      const p = PULSES[kind];
      try { return nav.vibrate(Array.isArray(p) ? [...p] : p) !== false; } catch { return false; }
    },
  };
}
