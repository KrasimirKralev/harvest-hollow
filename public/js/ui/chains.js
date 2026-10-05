// The story chains' paintings (art lane, public/assets/art/quests/<chain>.webp and <chain>_600.webp): the focus point
// of each 3:1 painting (manifest.json quests.<chain>.focus), so a crop to 4:1 or a round thumbnail keeps the
// subject in view. Shared by the Goal Tracker's story cards and the Journal's letter cards and strips.
export const CHAIN_FOCUS = Object.freeze({
  a: [0.40, 0.62], b: [0.50, 0.55], c: [0.38, 0.55], d: [0.55, 0.62], e: [0.48, 0.72],
  f: [0.55, 0.55], g: [0.25, 0.68], h: [0.70, 0.45],
});

/** The CSS custom properties of a chain painting (`--art`, `--fx`, `--fy`), or null for a chain without one. */
export function chainArt(chain, size = 600) {
  const c = String(chain || '').toLowerCase();
  const f = CHAIN_FOCUS[c];
  if (!f) return null;
  return `--art: url(/assets/art/quests/${c}${size === 600 ? '_600' : ''}.webp); --fx: ${f[0] * 100}%; --fy: ${f[1] * 100}%`;
}
