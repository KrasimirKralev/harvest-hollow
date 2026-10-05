// Wave 4 (owner wish E, 2026-10-04): upgrades for the farmhouse, the Well, the Market Stand and the benches. Pure; no
// action imports (economy.js reads the bonuses, so this module must not import the action families).
//
// Each target has a few tiers; an object's `up` counts the tiers bought (absent = 0). A tier's `bonus` is the WHOLE
// bonus at that tier (not added to the tiers below), so a panel shows "now / next" without summing:
//   well          waterBp      basis points added to every manual watering (crops and trees; the 50 % floor holds)
//   market_stand  demandUnits  more Market Demand units a day at +50 %;  sellBp  added to every Market Stand sale
//   farmhouse     barnCap      more Barn capacity;  restedBp  faster rested XP while away (comfort)
//   bench         goldenMs     a Golden Hour started on THIS bench lasts longer
// Content may publish `UPGRADES` (same shape) to own the numbers; these defaults keep the feature playable without it.
import * as C from '../content/index.js';
import { levelFromXp } from '../content/index.js';
import { objectsByDef } from './grid.js';
import { GRID_VERSION, hide } from './grid-cache.js';

const MIN = 60_000;

/** The default upgrade table (content's `UPGRADES` replaces it target by target when present). */
export const UPGRADES_DEFAULT = Object.freeze({
  farmhouse: {
    name: 'Farmhouse', defs: ['farmhouse'],
    tiers: [
      { name: 'Fresh Paint & Porch', unlock: 10, coins: 6000, items: { planks: 3 }, bonus: { barnCap: 40, restedBp: 1000 },
        text: 'Red boards, white trim and a porch bench: +40 Barn space, rested XP builds 10 % faster' },
      { name: 'Side Wing', unlock: 20, coins: 40_000, items: { planks: 6, wooden_crate: 1 },
        bonus: { barnCap: 80, restedBp: 2000 }, text: 'A cosy side wing: +80 Barn space, rested XP 20 % faster' },
      { name: 'Sunroom & Chimney', unlock: 30, coins: 150_000, items: { planks: 10, wooden_crate: 2 },
        bonus: { barnCap: 120, restedBp: 3000 }, text: 'A bright sunroom: +120 Barn space, rested XP 30 % faster' },
    ],
  },
  well: {
    name: 'Well', defs: ['well'],
    tiers: [
      { name: 'Stone Rim', unlock: 6, coins: 1500, items: { planks: 2 }, bonus: { waterBp: 250 },
        text: 'Watering saves 2.5 % more time' },
      { name: 'Little Roof', unlock: 14, coins: 12_000, items: { planks: 4 }, bonus: { waterBp: 500 },
        text: 'Watering saves 5 % more time' },
      { name: 'Hand Pump', unlock: 24, coins: 60_000, items: { planks: 6, wooden_crate: 1 }, bonus: { waterBp: 800 },
        text: 'Watering saves 8 % more time' },
    ],
  },
  market_stand: {
    name: 'Market Stand', defs: ['market_stand'],
    tiers: [
      { name: 'Striped Awning', unlock: 11, coins: 4000, items: { planks: 3 }, bonus: { demandUnits: 10 },
        text: '+10 Market Demand units a day' },
      { name: 'Chalkboard & Crates', unlock: 19, coins: 30_000, items: { planks: 5, wooden_crate: 1 },
        bonus: { demandUnits: 20, sellBp: 100 }, text: '+20 Demand units a day, everything sells for 1 % more' },
      { name: 'Flower Boxes & Scale', unlock: 28, coins: 120_000, items: { planks: 8, wooden_crate: 2 },
        bonus: { demandUnits: 30, sellBp: 200 }, text: '+30 Demand units a day, everything sells for 2 % more' },
    ],
  },
  bench: {
    name: 'Bench', defs: ['sunset_bench', 'bench_swing'],
    tiers: [
      { name: 'Cushions', unlock: 6, coins: 500, items: { wood: 2 }, bonus: { goldenMs: 5 * MIN },
        text: 'A Golden Hour on this bench lasts 5 minutes longer' },
      { name: 'Lantern', unlock: 12, coins: 4000, items: { planks: 2 }, bonus: { goldenMs: 10 * MIN },
        text: 'A Golden Hour on this bench lasts 10 minutes longer' },
      { name: 'Rose Canopy', unlock: 22, coins: 20_000, items: { planks: 4 }, bonus: { goldenMs: 15 * MIN },
        text: 'A Golden Hour on this bench lasts 15 minutes longer' },
    ],
  },
});

/** The upgrade table in play: content's targets when it publishes `UPGRADES`, the defaults for the rest. */
export const UPGRADES = Object.freeze({ ...UPGRADES_DEFAULT, ...(C.UPGRADES ?? {}) });

/** Targets in a fixed order (never the table's key order). */
export const UPGRADE_TARGETS = Object.freeze(Object.keys(UPGRADES).sort());

/** Farm-wide targets: their bonus counts once, from the best copy on the farm. Benches are per object. */
const PER_OBJECT = new Set(['bench']);

const TARGET_OF = new Map();
for (const t of UPGRADE_TARGETS) for (const d of UPGRADES[t].defs ?? [t]) if (!TARGET_OF.has(d)) TARGET_OF.set(d, t);

/** The upgrade target of a def id ('farmhouse' | 'well' | 'market_stand' | 'bench' | ...), or null. */
export const upgradeTargetOf = (defId) => TARGET_OF.get(defId) ?? null;

/** Tiers bought for object `o` (0 when none or not upgradable). */
export const tierOf = (o) => (o && Number.isSafeInteger(o.up) && o.up > 0 ? o.up : 0);

/** The tier row `n` (1-based) of a target, or null. */
export const tierRow = (target, n) => (n >= 1 ? UPGRADES[target]?.tiers?.[n - 1] ?? null : null);

/** The bonus of an object at its tier ({} when none). */
export const bonusOf = (o) => {
  const t = upgradeTargetOf(o?.def);
  return (t && tierRow(t, tierOf(o))?.bonus) || {};
};

/** The best tier among the farm's copies of a farm-wide target. */
export function farmTier(state, target) {
  let best = 0;
  const byDef = objectsByDef(state);
  for (const d of UPGRADES[target]?.defs ?? [target]) {
    for (const o of byDef.get(d) ?? []) if (tierOf(o) > best) best = tierOf(o);
  }
  return best;
}

const BONUS = Symbol('hh.upgradeBonus');

/**
 * The farm-wide bonuses, summed per key, cached on the grid version (grid-cache.js bumps it on any `def` / `up` write
 * and on objects added or removed): a 100-plot watering stroke reads them once, not once per plot.
 */
function farmBonuses(state) {
  const v = state[GRID_VERSION] ?? 0;
  const objs = state.farm.objects;
  const c = state[BONUS];
  if (c && c.v === v && c.objs === objs) return c.sum;
  const sum = {};
  for (const t of UPGRADE_TARGETS) {
    if (PER_OBJECT.has(t)) continue;
    const b = tierRow(t, farmTier(state, t))?.bonus ?? {};
    for (const k of Object.keys(b)) if (Number.isSafeInteger(b[k]) && b[k] > 0) sum[k] = (sum[k] ?? 0) + b[k];
  }
  hide(state, BONUS, { v, objs, sum });
  return sum;
}

/**
 * A farm-wide upgrade bonus (`waterBp`, `demandUnits`, `sellBp`, `barnCap`, `restedBp`): the sum over the farm-wide
 * targets of their best copy's tier value (0 when none). Pure and cheap (cached per grid version).
 */
export function upgradeBonus(state, key) {
  if (!state?.farm?.objects) return 0;
  return farmBonuses(state)[key] ?? 0;
}

/** Extra Golden Hour time (ms) for a Golden Hour started on bench `benchId`. */
export function benchGoldenMs(state, benchId) {
  const o = Object.hasOwn(state.farm.objects, benchId) ? state.farm.objects[benchId] : null;
  const x = bonusOf(o).goldenMs;
  return Number.isSafeInteger(x) && x > 0 ? x : 0;
}

/** True when the farm's level reaches a tier. */
export const tierOpen = (state, row) => levelFromXp(state.farm.xp) >= (row.unlock ?? 1);
