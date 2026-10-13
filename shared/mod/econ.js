// The economy of a mod (contract §1.5): the agent picks WHAT and HOW LONG, never HOW MUCH. Every price, seed cost and
// XP is computed here from the designer's economy model (tools/economy-model.mjs: cropGross, craftTime and the C
// constants CROP_LVL 0.015, SEED_SHARE 0.4, TREE_MULT 1.6, CRAFT_LVL 0.015, MIN_ADD 0.15, XP_DIV 8), with the model's
// values per ladder step pinned as integer tables (x100). test/mod.econ.test.js recomputes them from the model and fails
// if they drift. Integer products stay far below 2^53.
import { VALUE_BP } from './format.js';

/** cropGross(minutes, 1) x 100, per crop-ladder step (600 is the 10-hour tree cycle). */
export const CROP_GROSS_X100 = Object.freeze({
  1: 433, 2: 866, 5: 2165, 10: 4330, 15: 6495, 20: 8660, 30: 12990, 45: 19485, 60: 25980, 90: 31180, 120: 35490,
  180: 42594, 240: 48480, 360: 58184, 480: 66226, 600: 73222, 720: 79482, 960: 90468, 1440: 108576,
});
/** craftTime(minutes, 1) x 100, per recipe-ladder step. */
export const CRAFT_ADD_X100 = Object.freeze({
  5: 4349, 10: 7571, 15: 10473, 20: 13183, 30: 18234, 45: 25220, 60: 31747, 90: 43911, 120: 55275, 180: 76454,
  240: 96239,
});

/** The model's per-level bonus (+1.5 % per unlock level) in basis points. */
export const lvlBp = (unlock) => 10_000 + 150 * (unlock - 1);
const valueBp = (v) => VALUE_BP[v] ?? VALUE_BP.normal;
const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * A crop's numbers: { sell, seed, xp, xp100, growMs, gross }. gross = the plot's harvest worth (sell x yield), as the
 * model rounds it (sell first, then the plot).
 */
export function cropNumbers({ growMin, yield: yld, unlock, value }) {
  const x = CROP_GROSS_X100[growMin];
  const sell = Math.max(1, Math.round((x * lvlBp(unlock) * valueBp(value)) / (1e10 * yld)));
  const gross = sell * yld;
  return { sell, seed: Math.max(2, Math.round((gross * 4) / 10)), xp: Math.max(1, Math.round(gross / 8)),
    xp100: Math.round((gross * 100) / 8), growMs: growMin * MIN, gross };
}

/** A fruit tree's numbers (the anchor gives the yield): { sell (the fruit), xp (per harvest), cycleMs, harvest }. */
export function treeNumbers({ cycleHours, unlock, value }, anchor) {
  const x = CROP_GROSS_X100[cycleHours * 60];
  const yld = anchor.yield;
  // TREE_MULT 1.6 = 16 / 10
  const sell = Math.max(1, Math.round((x * 16 * lvlBp(unlock) * valueBp(value)) / (1e11 * yld)));
  return { sell, xp: Math.max(1, Math.round((sell * yld) / 8)), cycleMs: cycleHours * HOUR, harvest: sell * yld };
}

/**
 * A recipe's numbers. `items` resolves an input id to its item ({ sell }). Returns { ok, sell, xp, ms, inValue, add }
 * or { ok: false, inValue, add, need } when the machine would add less than 15 % to its inputs (ECON_BOUND).
 */
export function recipeNumbers({ minutes, unlock, value, inputs }, items) {
  let inValue = 0;
  for (const [id, q] of Object.entries(inputs)) inValue += items(id).sell * q;
  const x = CRAFT_ADD_X100[minutes];
  const sell = Math.round((inValue * 1e10 + x * lvlBp(unlock) * valueBp(value)) / 1e10);
  const add = sell - inValue;
  // R3 (GDD §4.9): the output is worth at least 1.15 x its inputs (integer form)
  if (add * 100 < inValue * 15 || sell * 100 < inValue * 115) return { ok: false, inValue, add, need: Math.ceil((inValue * 15) / 100) };
  return { ok: true, sell, xp: Math.max(1, Math.round(add / 8)), ms: minutes * MIN, inValue, add };
}

/** An animal product's sell price: the anchor product's, scaled by the value. */
export const productSell = (anchorSell, value) => Math.max(1, Math.round((anchorSell * valueBp(value)) / 10_000));

/**
 * Defense in depth (§3 stage 2): the value a new def creates per minute must stay within `limitBp` (1.12 x) of the best
 * live base def of its family at or below its unlock. `per(def)` gives value per minute x 1000 for a def.
 * Returns { ok, ratioBp, best } (ok when there is nothing to compare with).
 */
export function bounds(family, level, candidatePerMin, baseDefs, per, limitBp = 11_200) {
  let best = 0;
  for (const d of baseDefs) if ((d.unlock ?? 1) <= level) best = Math.max(best, per(d));
  if (!(best > 0)) return { ok: true, ratioBp: 0, best: 0, family };
  const ratioBp = Math.round((candidatePerMin * 10_000) / best);
  return { ok: ratioBp <= limitBp, ratioBp, best, family };
}

/** Value per minute x 1000 of a crop def (plot gross / grow minutes). */
export const cropPerMin = (c) => Math.round((c.sell * c.yield * 1000 * MIN) / c.growMs);
/** ... of a tree (harvest / cycle minutes; the fruit's sell comes from `items`). */
export const treePerMin = (t, items) => Math.round(((items(t.product)?.sell ?? 0) * t.yield * 1000 * MIN) / t.cycleMs);
/** ... of a recipe (value added / craft minutes; inputs from `items`). */
export function recipePerMin(r, items) {
  let inValue = 0;
  for (const [id, q] of Object.entries(r.inputs ?? {})) inValue += (items(id)?.sell ?? 0) * q;
  return Math.round(((r.sell * (r.out ?? 1) - inValue) * 1000 * MIN) / r.ms);
}
