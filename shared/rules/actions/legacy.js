// Legacy levels (GDD §4.6, §5.9: after L40, M2; content: shared/content/projects.js LEGACY). Owned by rules-goals.
//
// Past the level table every level costs the L39 -> 40 step (content levelFromXp) and pays the last row's level-up
// coins and Acorns plus one reward from a rotating pool: Legacy level L (L >= LEGACY.from, 41) pays
// LEGACY.pool[(L - LEGACY.from) % pool.length] (Acorns, a Golden Seed Packet, Hearts for the wardrobe, the Legacy
// Statue ...). No empty levels, ever. Before the feature plays (an M1b build) the RC-14 rule still pays odd levels 10
// Acorns and even ones a Golden Seed Packet (progress.js).
//
// farm.legacy = { rows: [{ n, L, at, by, reward }] }   the newest LEGACY_ROWS Legacy rewards paid (n = L - 40)
import { LEGACY, featureOf, isLive, levelFromXp } from '../../content/index.js';
import { MAX_LEVEL } from '../../content/config.js';
import { systemLive } from '../coop.js';

/** How many paid Legacy rewards the farm keeps for the panel. */
export const LEGACY_ROWS = 12;

/** Fresh legacy state. */
export const initialLegacy = () => ({ rows: [] });

/** The first Legacy level (41). */
export const legacyFrom = () => LEGACY.from ?? MAX_LEVEL + 1;

/** True when Legacy levels play in this build (LEGACY.m and the feature row `legacy`). */
export function legacyLive() {
  const f = featureOf('legacy');
  return systemLive(LEGACY) && (!f || isLive(f) || systemLive(f));
}

/** Legacy levels the farm has reached (0 before L41); takes a state or a farm level. */
export const legacyLevel = (stateOrL) => {
  const L = typeof stateOrL === 'number' ? stateOrL : levelFromXp(stateOrL?.farm?.xp ?? 0);
  return Math.max(0, L - legacyFrom() + 1);
};

/** The reward of the n-th Legacy level (n = 1 for L41), a copy of the pool entry. */
export function legacyReward(n) {
  const pool = LEGACY.pool ?? [];
  return pool.length ? { ...pool[(Math.max(1, n) - 1) % pool.length] } : {};
}

/** The reward of farm level L when it is a Legacy level and Legacy plays, else null. */
export const legacyRewardAt = (L) => (legacyLive() && L >= legacyFrom() ? legacyReward(L - legacyFrom() + 1) : null);

/** Paid Legacy rewards, newest last. */
export const legacyRows = (state) => [...(state.farm.legacy?.rows ?? [])];

/** Record a paid Legacy reward (progress.addFarmXp). */
export function legacyRecord(tx, ctx, L, reward) {
  const lg = tx.state.farm.legacy;
  if (!lg) return;
  const row = { n: L - legacyFrom() + 1, L, at: ctx.now, by: ctx.pid, reward };
  tx.set(['farm', 'legacy', 'rows'], [...lg.rows, row].slice(-LEGACY_ROWS));
}
