// Clearable wild weeds (wave 4, owner wish F 2026-10-04): the grass tufts with yellow flowers that grow wild on the
// farm's own land are pulled with the Hand, for good and for both players. The renderer scatters the tufts; the rules
// remember the TILES that were weeded (a tuft belongs to the tile under its root), and the ground hides the wild tufts
// of every weeded tile. Scenery outside the farm's land is never weeded (OUT_OF_BOUNDS).
//
//   clearWeed {x, z} | {cells: [z * WORLD_TILES + x, ...]}   one tile, or a drag of up to 100 tiles (stroke order).
//                        Tiles already weeded are skipped; ALREADY_DONE when none is new, OUT_OF_BOUNDS when none is the
//                        farm's land. A tiny reward: WEEDS.coins for each of the first WEEDS.dailyCap tiles of a farm
//                        day (granted: a reward, never "earned"), nothing after; no XP.
//
// State: `farm.weeds = { t: { 'x,z': 1 }, day, n }`: the weeded tiles, and the farm day + tiles paid that day.
import * as C from '../../content/index.js';
import { levelFromXp } from '../../content/index.js';
import { WORLD_TILES } from '../../content/config.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { inLand } from '../grid.js';
import { dayIndex } from '../calendar.js';
import { grant } from '../economy.js';

/** Content's WEEDS when it publishes them, else these. */
export const WEEDS = Object.freeze({ unlock: 1, coins: 2, dailyCap: 20, ...(C.WEEDS ?? {}) });

/** Fresh weeds block (createFarm and the backfill of older saves). */
export const initialWeeds = () => ({ t: {}, day: 0, n: 0 });

const key = (x, z) => `${x},${z}`;

/** True when tile (x, z) of the farm was weeded (the ground hides its wild tufts). Pure. */
export const weeded = (state, x, z) => Object.hasOwn(state.farm.weeds?.t ?? {}, key(x, z));

/** Paid tiles left today (the reward's daily cap). */
export function weedPayLeft(state, now) {
  const w = state.farm.weeds;
  const day = dayIndex(now, state.meta.tz);
  return Math.max(0, WEEDS.dailyCap - (w && w.day === day ? w.n : 0));
}

const tilesOfArgs = (a) => (Array.isArray(a.cells)
  ? a.cells.map((c) => [c % WORLD_TILES, Math.floor(c / WORLD_TILES)])
  : a.x !== undefined && a.z !== undefined ? [[a.x, a.z]] : []);

/** The new tiles of a stroke, in stroke order, and why none is (code). */
function plan(state, a) {
  const tiles = tilesOfArgs(a);
  const ok = [];
  let code = ERR.BAD_ARGS;
  for (const [x, z] of tiles) {
    if (!inLand(state, x, z)) { if (code === ERR.BAD_ARGS) code = ERR.OUT_OF_BOUNDS; continue; }
    if (weeded(state, x, z)) { code = ERR.ALREADY_DONE; continue; }
    ok.push([x, z]);
  }
  return { ok, code: ok.length ? null : code };
}

export const clearWeed = {
  schema: { x: V.opt(V.tile), z: V.opt(V.tile), cells: V.opt(V.list(V.int(0, WORLD_TILES * WORLD_TILES - 1), 100)) },
  check(state, a) {
    const one = a.x !== undefined && a.z !== undefined;
    if (one === (a.cells !== undefined) || (a.x === undefined) !== (a.z === undefined)) return ERR.BAD_ARGS;
    if (levelFromXp(state.farm.xp) < WEEDS.unlock) return ERR.LOCKED;
    return plan(state, a).code;
  },
  apply(tx, a, ctx) {
    const { ok } = plan(tx.state, a);
    const day = dayIndex(ctx.now, tx.state.meta.tz);
    const w = tx.get(['farm', 'weeds']);
    const paidToday = w.day === day ? w.n : 0;
    const paid = Math.min(ok.length, Math.max(0, WEEDS.dailyCap - paidToday));
    for (const [x, z] of ok) tx.set(['farm', 'weeds', 't', key(x, z)], 1);
    if (w.day !== day) tx.set(['farm', 'weeds', 'day'], day);
    if (paid > 0) tx.set(['farm', 'weeds', 'n'], paidToday + paid);
    else if (w.day !== day && w.n !== 0) tx.set(['farm', 'weeds', 'n'], 0);
    const coins = paid * WEEDS.coins;
    if (coins > 0) grant(tx, ctx, coins, 'weeds');
    tx.inc(['farm', 'stats', 'weeds'], ok.length);
    tx.emit({ e: 'weedsCleared', cells: ok.map(([x, z]) => z * WORLD_TILES + x), coins, by: ctx.pid });
  },
};
