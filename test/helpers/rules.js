// rules-economy test helpers: farms at a level with money, goods in the Barn, objects placed through the real
// `place` action on a free spot, and small lookups. Built on test/helpers.js (run/must check every action's ops
// and undo round trip).
import { xpForLevel, defOf, CONTENT } from '../../shared/content/index.js';
import { canPlace, objectOf } from '../../shared/rules/grid.js';
import { resetGrid } from '../../shared/rules/grid-cache.js';
import { FARM_MIN, FARM_MAX } from '../../shared/content/config.js';
import { makeFarm, run, must, T0 } from '../helpers.js';

export { makeFarm, run, must, T0 };

export const MIN = 60_000;
export const HOUR = 3_600_000;

/** A joined farm at `level` with `coins` and `acorns` (test setup writes the state directly). */
export function farmAt(level, { coins = 1_000_000, acorns = 100, seed = 42, players = ['p1', 'p2'] } = {}) {
  const s = makeFarm({ seed, players });
  s.farm.xp = xpForLevel(level);
  s.farm.wallet.coins = coins;
  s.farm.wallet.acorns = acorns;
  return s;
}

/** Put `n` of `item` straight into the Barn inventory (setup only; bypasses capacity on purpose when asked). */
export function give(s, item, n) {
  s.farm.inventory[item] = (s.farm.inventory[item] ?? 0) + n;
}

/** Every unlocked expansion's land, so big footprints always find a spot (setup only). */
export function allLand(s) {
  s.farm.expansions = [...CONTENT.expansions.values()].filter((e) => e.m === 'M1a').map((e) => e.id);
  resetGrid(s);
}

/** The first spot (row-major) where `def` fits at `rot`, or null. */
export function freeSpot(s, def, rot = 0) {
  for (let z = FARM_MIN; z < FARM_MAX; z++) {
    for (let x = FARM_MIN; x < FARM_MAX; x++) if (canPlace(s, def, x, z, rot) === null) return [x, z];
  }
  return null;
}

/** Place (buy or take from the tray) `def` on the first free spot; returns the new object's id. */
export function placeDef(s, def, o = {}) {
  const spot = o.at ?? freeSpot(s, def, o.rot ?? 0);
  if (!spot) throw new Error(`no spot for ${def}`);
  const r = must(s, 'place', { def, x: spot[0], z: spot[1], rot: o.rot ?? 0, ...(o.confirm ? { confirm: o.confirm } : {}) }, o);
  return r.tx.events.find((e) => e.e === 'placed').id;
}

/** Ids of the objects whose def is `def`, sorted. */
export const idsOf = (s, def) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === def).sort();

/** The object, or throws. */
export function obj(s, id) {
  const o = objectOf(s, id);
  if (!o) throw new Error(`no object ${id}`);
  return o;
}

/** Events of a result, by name. */
export const evs = (r, e) => r.tx.events.filter((x) => x.e === e);

/** The ledger invariant (economy.js header): coins + wishlist == start + earned + granted + refunded - spent. */
export function ledgerBalanced(s, start) {
  const st = s.farm.stats;
  const wish = Object.values(s.farm.wishlist).reduce((n, w) => n + w.coins, 0);
  return s.farm.wallet.coins + wish === start + (st['coins.earned'] ?? 0) + (st['coins.granted'] ?? 0)
    + (st['coins.refunded'] ?? 0) - (st['coins.spent'] ?? 0);
}

export { defOf };
