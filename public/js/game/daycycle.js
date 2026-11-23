// The shared, cosmetic day/night clock for SOUND (GDD §8.4): music variant and ambience layers follow exactly the
// sky render-world draws, because the phase comes from the same pure functions (render/daynight.js phaseAt /
// phaseAtHour: dawn 4, day 26, dusk 4, night 6 minutes from server epoch 0; 'real' = the local clock). Personal
// setting: 'cycle' (default, the shared sky) | 'day' (always day) | 'real'. Owned by the client-core lane.
//
//   dayPhase(serverNow, mode = 'cycle', localDate?, createdAt?) -> { phase, t, light }
//     createdAt  the farm's birth (state.meta.createdAt): the sky runs from it (render/daynight.js skyClock, RD-04),
//                so a new farm opens in morning light and the music agrees with the sky
//     phase  'dawn' | 'day' | 'dusk' | 'night'
//     t      0..1 progress inside the phase
//     light  1 = full day .. 0 = night; the same curve as the sky's `night` factor (light = 1 - night)
import { phaseAt, phaseAtHour, CYCLE, skyClock } from '../render/daynight.js';

export const CYCLE_MS = CYCLE.total;
const smooth = (x) => x * x * (3 - 2 * x);

/** The sky's night factor for a phase (render/daynight.js skyAt), as daylight. */
function lightOf(phase, k) {
  if (phase === 'day') return 1;
  if (phase === 'night') return 0;
  if (phase === 'dusk') return k < 0.6 ? 1 : 1 - smooth((k - 0.6) / 0.4);
  return k < 0.45 ? smooth(k / 0.45) : 1;                 // dawn
}

/**
 * @param {number} serverNow  estimated server epoch ms
 * @param {'cycle'|'day'|'real'} [mode]
 * @param {Date} [localDate]  'real' mode only (tests inject it)
 * @param {number} [createdAt]  the farm's birth; without it the clock runs from the epoch
 */
export function dayPhase(serverNow, mode = 'cycle', localDate, createdAt) {
  let ph;
  if (mode === 'day') ph = { phase: 'day', k: 0.3 };
  else if (mode === 'real') {
    const d = localDate || new Date();
    ph = phaseAtHour(d.getHours() + d.getMinutes() / 60);
  } else ph = phaseAt(skyClock(serverNow, createdAt));
  return { phase: ph.phase, t: ph.k, light: lightOf(ph.phase, ph.k) };
}
