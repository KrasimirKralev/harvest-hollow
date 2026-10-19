// The economy guard's arithmetic (release 1.0, harvey#6), pure over crop defs: the boot test's greedy 24-hour crop day
// (boot.js cropDay), the fastest growMin a crop may be tuned to on a farm of a given level (the catalog's
// `fastestGrowMin`, so the agent never has to guess), and the ECON_GUARD hint that names the crop and the step.
//
//   ECON_LIMIT_BP                                 coins and XP per hour of the mod's best crop day vs the base's, at most
//   cropRate(crop) -> { coins, xp }               one crop's 24-hour greedy rate (per hour, x1000)
//   cropDayOf(crops, level) -> { coins, xp }      the best rate among the live crops unlocked at `level`
//   fastestGrowMin(crop, baseDay, level, ladder) -> minutes   the shortest ladder step a per-crop tuning may pick
//   guardHint(crops, baseDay, level, ladder) -> string        what to change, by name ("strawberry: 45 or longer")

/** Coins and XP per hour of the overlay's best crop day vs the base's, at most (tuning's 8000 bp floor gives 12500). */
export const ECON_LIMIT_BP = 13_000;
const HOUR = 3_600_000;
const MIN = 60_000;

export function cropRate(c) {
  const cycles = Math.max(1, Math.floor((24 * HOUR) / c.growMs));
  return { coins: Math.round(((c.sell * c.yield - c.seed) * cycles * 1000) / 24), xp: Math.round((c.xp * cycles * 1000) / 24) };
}

export function cropDayOf(crops, level) {
  let coins = 0;
  let xp = 0;
  for (const c of crops) {
    if (!c || c.retired || (c.unlock ?? 1) > level) continue;
    const r = cropRate(c);
    coins = Math.max(coins, r.coins);
    xp = Math.max(xp, r.xp);
  }
  return { coins, xp };
}

const within = (r, day) => r.coins * 10_000 <= day.coins * ECON_LIMIT_BP && r.xp * 10_000 <= day.xp * ECON_LIMIT_BP;

/**
 * The shortest crop ladder step `crops.<id>.growMin` may take on a farm at `level`: at least half the crop's own time
 * (the compiler's rule), and, for a crop the farm has unlocked, a day of it within the guard's limit of the base day.
 */
export function fastestGrowMin(crop, baseDay, level, ladder) {
  const cur = crop.growMs / MIN;
  const steps = ladder.filter((g) => g * 2 >= cur && g <= cur * 2);
  for (const g of steps) {
    if ((crop.unlock ?? 1) > level || within(cropRate({ ...crop, growMs: g * MIN }), baseDay)) return g;
  }
  return Math.round(cur);
}

/**
 * The guard's hint: the crops whose time pays over the limit, each with the shortest step this farm allows (three
 * named, then how many more); the mod's own growTimeBp named first when it sets a speed-up.
 */
export function guardHint(crops, baseDay, level, ladder, baseCrops = new Map(), { growTimeBp = null } = {}) {
  const over = crops.filter((c) => !c.retired && (c.unlock ?? 1) <= level && !within(cropRate(c), baseDay));
  const named = over.map((c) => {
    const base = baseCrops.get(c.id) ?? c;
    return `${c.id}: ${fastestGrowMin(base, baseDay, level, ladder)} or longer on this farm`;
  });
  if (!named.length) return 'make the times less short';
  const list = named.length > 3 ? `${named.slice(0, 3).join('; ')} (and ${named.length - 3} more)` : named.join('; ');
  // a global speed-up is the cause only when the mod sets one
  if (Number.isInteger(growTimeBp) && growTimeBp < 10_000) return `growTimeBp ${growTimeBp} is too fast for this farm: choose a bigger number, or tune crops one by one (${list})`;
  return list;
}
