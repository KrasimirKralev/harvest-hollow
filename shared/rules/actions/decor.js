// Placing, moving, storing and selling objects (GDD §2.5, §3.2 rules 1-2, §3.4 homes, §3.5 rule 7, §3.8, §3.10,
// §4.3 "Selling objects", §6.3 undo / trash / move back / pins / BIG_SPEND, §9 #7, #9, #38-#40, #51, #52;
// tech §15.3).
// Generic over every placeable def: plots, trees, homes, buildings, decor (landmarks and debris are never bought).
// Owned by rules-economy.
//
// Owner change 2026-10-04: the Homestead's landmarks (farmhouse, Barn, Well, Mailbox, Market Stand, Mabel's Order
// Board, the Old Greenhouse) move and turn like any building. A move only rewrites x/z/rot (+ `prev`), so a home keeps
// its animals (they point at its id), a building its queue and tray, the farmhouse its room, the Barn its goods; they
// are still never stored or sold (removableCode). Debris and animals never move; scenery outside the farm board (the
// river, the jetty, the land features, the village) is not an object at all.
//
//   place {def, x, z, rot}      from the build tray (`farm.storage`) for free when a copy waits there, else bought:
//                               shop defs only, unlocked, under the per-def caps, at the n-th-copy price
//   move {id, x, z, rot}        keeps the id and every timer; opens a 10-minute "move back" (`obj.prev`)
//   moveBack {id}               either player, inside the window, if the old spot is still free
//   store {id}                  decor back into the tray (keeps its value; never sold)
//   refund {id}                 the 10-minute undo: 100 % while the receipt is valid (the object never used)
//   sellObject {id}             decor 50 %, empty plots 50 %, animals 50 % of their own price (100 % prized) of what
//                               was PAID; with a valid receipt it is the undo (100 %). Goes to a 10-minute trash.
//   restore {id}                takes a sold object back out of the trash (pays the coins back)
//   pinObject {id, on}          pins decor: moving / storing / selling pinned decor asks the other player (PINNED)
//
// Wave 2 (M1b): a Beehive arrives with its colony and the Old Greenhouse with its 12 plots (`arrivals`); the frame
// carries its plots when it moves; Greenhouse plots never move, sell or count against the plot cap; a Giant's plots
// never move; a Masterwork piece is never stored; a hive with an untouched colony is refunded with it.
//
// Object money fields: `paid` {coins, acorns} what was paid (resale base, its own purchase index: §9 #52),
// `rcpt` {coins, acorns, until} the undo receipt, deleted by ANY use (planting, feeding, queueing, upgrades, a
// harvest), so a refund never has to claw back goods or XP (tech §15.3). `free: true` marks gifts (tray rewards,
// expansion trees, quest animals): they never count toward n-th-copy prices (§9 #51) and resell for nothing.
import {
  defOf, levelFromXp, plotCapOf, plotPrice, treeCapAt, homeCountAt, isLive, featureOf, CONTENT, SAFETY, MARKET,
  GROWTH,
} from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { rainingAt } from '../time.js';
import {
  canPlace, canFit, countDef, objectOf, capacityOf, occupantsOf, greenhousePlotTiles, sizeOf,
} from '../grid.js';
import { sortedKeys } from '../order.js';
import { coatLeaves, coatReturns } from './track.js';
import {
  grow, spend, refund as refundCoins, spendAcorns, refundAcorns, isBigSpend, mulBp, stash, startCutBp, cutMs,
  PRICE_SEEN, ERR_PRICE, projectPlotCap, rewardSlots, playerPerk,
} from '../economy.js';
import { settleOwed, colonyOf, addColony, isColony } from './animals.js';
import { tierOf } from '../upgrades.js';

// rules-goals' rewards (quest decor, saplings, mastery signs) land in `farm.storage` through progress.giveObject()'s
// own write (the same as economy.stash()). No hook is registered here: rules-goals' quests.js imports this module's
// family (settleOwed), so a top-level call into progress.js would run before progress.js is initialised.

const kindOf = (def) => (def.layer === 'none' ? 'animal' : def.kind);

/**
 * Copies of a def the farm owns: placed objects plus the copies waiting in the build tray. A Greenhouse's plots are
 * beyond the plot cap (GDD §5.9) and are not counted.
 */
export const ownedCount = (state, defId) => countDef(state, defId, (o) => o.gh === undefined)
  + (state.farm.storage[defId] ?? 0);

/** Placed objects of a def that were BOUGHT (gifts excluded): the n of the n-th-copy price. */
export const boughtCount = (state, defId) => countDef(state, defId, (o) => o.free !== true);

/**
 * What buying one more `defId` costs right now, or why it cannot be bought (prices and caps only; coins,
 * BIG_SPEND and the spot are checked by the action). Pure: the shop panel previews with it.
 * @returns {{ coins: number, acorns: number, code: string | null }}
 */
export function buyPrice(state, defId, pid = null) {
  const def = defOf(defId);
  const no = (code) => ({ coins: 0, acorns: 0, code });
  if (!def) return no(ERR.NOT_FOUND);
  if (def.layer === 'none') return no(ERR.BAD_ARGS);                 // animals: buyAnimal
  if (def.shop !== true || def.retired) return no(ERR.LOCKED);        // landmarks, debris, rewards; retired (rule 8)
  const level = levelFromXp(state.farm.xp);
  if (level < (def.unlock ?? 1)) return no(ERR.LOCKED);
  const owned = ownedCount(state, defId);
  if (owned >= ownCap(state, def)) return no(ERR.CAP);
  switch (def.kind) {
    case 'plot': return { coins: plotPrice(owned + 1), acorns: 0, code: null };
    case 'tree': {
      // the buyer's Orchardist perk: trees cost 10 % less (M2; `pid` = the buying player)
      const coins = grow(def.cost, def.growthBp, boughtCount(state, defId) + 1);
      const off = pid ? playerPerk(state, pid, 'orchardist', 'treeCostBp') : 0;
      return { coins: coins - mulBp(coins, off), acorns: 0, code: null };
    }
    case 'home':
      return { coins: grow(def.cost, def.growthBp ?? 0, boughtCount(state, defId) + 1), acorns: 0, code: null };
    case 'building': return { coins: owned === 0 ? def.cost : def.secondCopy.cost, acorns: 0, code: null };
    default:
      return { coins: def.cost ?? 0, acorns: def.acorns ?? 0, code: null };
  }
}

/**
 * How many copies of `def` the farm may own now (placed + in the build tray): the plot cap (§3.10), the tree and
 * home caps by level, one building (two when its `second_<id>` feature is live), a decor def's `maxCount`.
 * `buyPrice` and `restore` both apply it, so no path lifts a holding over its cap (wave-1 QA RC-04).
 */
export function ownCap(state, def) {
  const level = levelFromXp(state.farm.xp);
  switch (def.kind) {
    case 'plot': return Math.min(plotCapOf(level, state.farm.expansions.length - 1) + projectPlotCap(state),
      def.maxCount ?? Infinity);
    case 'tree': return treeCapAt(def, level);
    case 'home': return homeCountAt(def, level);
    case 'building': {
      // second copies are their own feature (`second_<id>`): only in the milestone that ships it
      return def.secondCopy && level >= def.secondCopy.at && secondCopyLive(def) ? 2 : 1;
    }
    default: return def.maxCount ?? Infinity;
  }
}

/**
 * True when a building's second copy is part of this build (GDD §3.5 rule 7): its feature is live. The feature is
 * `second_<id>` or, for a building whose feature is named after the player-facing name ('second_windmill' for the
 * `mill`), the feature called "Second <name>". The shop and the rules both ask this.
 */
export function secondCopyLive(def) {
  const f = featureOf(`second_${def.id}`)
    ?? [...CONTENT.features.values()].find((x) => x.id.startsWith('second_') && x.name === `Second ${def.name}`);
  return Boolean(f) && isLive(f);
}

/** Is a purchase of `price` allowed for `pid` now: null, NO_COINS or (unconfirmed) BIG_SPEND. */
export function payCode(state, a, ctx, price) {
  if (state.farm.wallet.coins < price.coins) return ERR.NO_COINS;
  if (state.farm.wallet.acorns < price.acorns) return ERR.NO_ACORNS;
  const big = isBigSpend(state, ctx.pid, ctx.now, price.coins, price.acorns);
  return big && !confirmed(a, ERR.BIG_SPEND) ? ERR.BIG_SPEND : null;
  return null;
}

/** Pay for a purchase (coins and/or Acorns) and announce a big one to the partner (GDD §6.3). */
export function pay(tx, ctx, price, reason, what) {
  const big = isBigSpend(tx.state, ctx.pid, ctx.now, price.coins, price.acorns);
  if (price.coins > 0) spend(tx, ctx, price.coins, reason);
  if (price.acorns > 0) spendAcorns(tx, ctx, price.acorns, reason);
  if (big) tx.emit({ e: 'bigSpend', by: ctx.pid, coins: price.coins, acorns: price.acorns, what });
}

/** A fresh object record of `def` at (x, z, rot), placed `now` by `by` (without money fields). */
export function newObject(state, def, x, z, rot, now, by) {
  const o = { def: def.id, x, z, rot, placedAt: now, by };
  switch (def.kind) {
    case 'plot':
      Object.assign(o, { cycle: 0, crop: null });
      break;
    case 'tree': {
      // a sapling grows `saplingCycles` cycles without fruit, then ripens every cycle (GDD §3.2 rule 3)
      // planted in the rain: watered
      const rain = rainingAt(state.meta.farmSeed, now, state.meta.createdAt) ? GROWTH.water.treeBp : 0;
      const cut = startCutBp(state, def.id, now) + rain;
      const matureAt = now + def.saplingCycles * def.cycleMs;
      Object.assign(o, { cycle: 0, matureAt, startedAt: now, readyAt: matureAt + cutMs(def.cycleMs, cut), cut });
      if (rain) o.water = 'sys';
      break;
    }
    case 'building': {
      // reward slots (Grandma's duet table: +1 Farm Kitchen slot) come with a building placed after the reward
      const xs = rewardSlots(state, def.id);
      Object.assign(o, { slots: def.slots[0] + xs, queue: [], made: 0 });
      if (xs > 0) o.xs = xs;
      if (def.collector) Object.assign(o, { pts: 0, ready: 0 });
      break;
    }
    default:
      break;
  }
  return o;
}

const fromTray = (state, defId) => (state.farm.storage[defId] ?? 0) > 0;

/**
 * Purchases carry `max`, the coin price the player saw (wave-1 QA RC-18): when the partner bought the n-th copy
 * first, the price went up and the purchase answers PRICE (a soft code) instead of charging more than the screen
 * said. The client asks "Mia just bought one. The next hen is 1,287. Buy it?" and resends with `confirm: ['PRICE']`
 * (or the new `max`).
 */
export { PRICE_SEEN, ERR_PRICE } from '../economy.js';

export const place = {
  schema: { def: V.content('placeables'), x: V.tile, z: V.tile, rot: V.rot, max: V.opt(PRICE_SEEN) },
  check(state, a, ctx) {
    const def = defOf(a.def);
    if (def.layer === 'none') return ERR.BAD_ARGS;
    const tray = fromTray(state, a.def);
    const price = tray ? null : buyPrice(state, a.def, ctx.pid);
    if (price && price.code) return price.code;            // not for sale / at its cap: say so before the spot
    if (price && a.max !== undefined && price.coins > a.max && !confirmed(a, ERR_PRICE)) return ERR_PRICE;
    const code = canPlace(state, a.def, a.x, a.z, a.rot);
    if (code) return code;
    for (let i = 0; i <= extraIds(def); i++) if (objectOf(state, ctx.newId(i))) return ERR.ID_TAKEN;
    return price ? payCode(state, a, ctx, price) : null;
  },
  apply(tx, a, ctx) {
    const def = defOf(a.def);
    const id = ctx.newId(0);
    const o = newObject(tx.state, def, a.x, a.z, a.rot, ctx.now, ctx.pid);
    let price = { coins: 0, acorns: 0 };
    const tray = fromTray(tx.state, a.def);
    if (tray) {
      // a PAID tray copy (stored decor, a Wishlist buy) keeps its shop price as `paid`; gifts carry none
      if ((tx.state.farm.storagePaid[a.def] ?? 0) > 0) {
        tx.inc(['farm', 'storagePaid', a.def], -1, { dropZero: true });
        o.paid = { coins: def.cost ?? 0, acorns: def.acorns ?? 0 };
      } else if (def.kind === 'tree') o.free = true;   // tray trees are gifts (quest saplings): not counted (§9 #51)
      tx.inc(['farm', 'storage', a.def], -1, { dropZero: true });
    } else {
      price = buyPrice(tx.state, a.def, ctx.pid);
      pay(tx, ctx, price, `buy:${a.def}`, a.def);
      o.paid = { coins: price.coins, acorns: price.acorns };
      o.rcpt = { coins: price.coins, acorns: price.acorns, until: ctx.now + SAFETY.undoMs };
    }
    tx.set(['farm', 'objects', id], o);
    const ev = { e: 'placed', id, def: a.def, kind: def.kind, x: a.x, z: a.z, rot: a.rot, by: ctx.pid,
      coins: price.coins, acorns: price.acorns };
    if (tray) ev.free = true;
    tx.emit(ev);
    arrivals(tx, ctx, id, (i) => ctx.newId(i));
    if (def.kind === 'home') settleOwed(tx, ctx);
  },
};

/** How many more objects placing `def` creates: a Beehive its colony, a Greenhouse its plots. */
const extraIds = (def) => (def.greenhouse ? def.greenhouse.plots : colonyOf(def) ? 1 : 0);

/**
 * What arrives with a freshly placed object `id` (inside the placing action): a Beehive's colony (GDD §3.4) or a
 * Greenhouse's plots (§5.9: beyond the plot cap, `gh` = the frame). `idAt(i)` names the i-th extra object (1-based).
 */
export function arrivals(tx, ctx, id, idAt) {
  const o = tx.get(['farm', 'objects', id]);
  const def = defOf(o.def);
  if (colonyOf(def)) addColony(tx, ctx, id, idAt(1));
  if (def.greenhouse) {
    greenhousePlotTiles(def, o.x, o.z, o.rot).forEach(([x, z], k) => {
      tx.set(['farm', 'objects', idAt(k + 1)], { def: 'plot', x, z, rot: 0, placedAt: ctx.now, by: ctx.pid, cycle: 0,
        crop: null, gh: id });
    });
  }
}

/** A Greenhouse's plots, sorted by their place in its layout (plot k sits on layout tile k). */
function greenhousePlots(state, id) {
  const g = state.farm.objects[id];
  const tiles = greenhousePlotTiles(defOf(g.def), g.x, g.z, g.rot).map(([x, z]) => `${x},${z}`);
  return sortedKeys(state.farm.objects).filter((pid) => state.farm.objects[pid].gh === id)
    .map((pid) => [tiles.indexOf(`${state.farm.objects[pid].x},${state.farm.objects[pid].z}`), pid])
    .sort((a, b) => a[0] - b[0]).map(([, pid]) => pid);
}

/** Move a Greenhouse's plots with it to the frame's new spot (plot k to the new layout's tile k). */
function carryPlots(tx, id, def, x, z, rot) {
  const plots = greenhousePlots(tx.state, id);
  const tiles = greenhousePlotTiles(def, x, z, rot);
  plots.forEach((pid, k) => {
    tx.set(['farm', 'objects', pid, 'x'], tiles[k][0]);
    tx.set(['farm', 'objects', pid, 'z'], tiles[k][1]);
  });
}

const pinned = (o, a, ctx) => o.pin !== undefined && o.pin !== ctx.pid && !confirmed(a, ERR.PINNED);

export const move = {
  schema: { id: V.objId, x: V.tile, z: V.tile, rot: V.rot },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    const def = o && defOf(o.def);
    if (!def || def.layer === 'none') return ERR.NOT_FOUND;
    // debris is cleared, not moved (content: `movable: false`); every structure moves, landmarks included
    if (def.movable === false || def.kind === 'debris') return ERR.LOCKED;
    // a Greenhouse plot moves with its frame; a Giant's plots stay together until it is felled
    if (o.gh !== undefined || (o.crop && o.crop.giant !== undefined)) return ERR.LOCKED;
    if (o.x === a.x && o.z === a.z && o.rot === a.rot) return ERR.ALREADY_DONE;
    const code = canPlaceIgnoringLevel(state, o.def, a.x, a.z, a.rot, a.id);
    if (code) return code;
    if (pinned(o, a, ctx)) return ERR.PINNED;
    return null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const from = [o.x, o.z, o.rot];
    tx.set(['farm', 'objects', a.id, 'prev'],
      { x: o.x, z: o.z, rot: o.rot, until: ctx.now + SAFETY.moveBackMs, by: ctx.pid });
    const def = defOf(o.def);
    if (def.greenhouse) carryPlots(tx, a.id, def, a.x, a.z, a.rot);      // read the old layout before the frame moves
    tx.set(['farm', 'objects', a.id, 'x'], a.x);
    tx.set(['farm', 'objects', a.id, 'z'], a.z);
    tx.set(['farm', 'objects', a.id, 'rot'], a.rot);
    tx.emit({ e: 'moved', id: a.id, def: o.def, x: a.x, z: a.z, rot: a.rot, from, by: ctx.pid });
  },
};

/** canPlace for an EXISTING object: its def's unlock level never blocks a move, move back or restore. */
const canPlaceIgnoringLevel = canFit;

/**
 * Where object `id` stands after a quarter turn (`dir` 1 = clockwise, -1 = back), for the Rotate button and the R key
 * (wave 4, owner wish C): the turn keeps the footprint's centre (a 2 x 1 bench turns in place, a 4 x 3 building shifts
 * by at most a tile), and when that spot is taken the nearest free spot within two tiles (ring by ring, rows then
 * columns: the same answer on every client). Pure; send the result as `move {id, x, z, rot}`.
 * @returns {{ x: number, z: number, rot: number, code: string | null }}  code: null, or why no turn fits (the turn
 *   in place's own code: BLOCKED / OUT_OF_BOUNDS; NOT_FOUND / LOCKED for an object that does not move)
 */
export function rotateSpot(state, id, dir = 1) {
  const o = objectOf(state, id);
  const def = o && defOf(o.def);
  if (!def || def.layer === 'none') return { x: 0, z: 0, rot: 0, code: ERR.NOT_FOUND };
  const rot = (((o.rot ?? 0) + (dir < 0 ? 3 : 1)) & 3);
  if (def.movable === false || def.kind === 'debris' || o.gh !== undefined || (o.crop && o.crop.giant !== undefined)) {
    return { x: o.x, z: o.z, rot, code: ERR.LOCKED };
  }
  const size = sizeOf(o, def);                             // a grown home turns with its paddock (wave 4b)
  const [w0, d0] = o.rot % 2 ? [size[1], size[0]] : size;
  const [w1, d1] = rot % 2 ? [size[1], size[0]] : size;
  const x0 = o.x + Math.floor((w0 - w1) / 2);
  const z0 = o.z + Math.floor((d0 - d1) / 2);
  const here = canPlaceIgnoringLevel(state, o.def, x0, z0, rot, id);
  if (here === null) return { x: x0, z: z0, rot, code: null };
  for (let r = 1; r <= 2; r++) {
    for (let z = z0 - r; z <= z0 + r; z++) {
      for (let x = x0 - r; x <= x0 + r; x++) {
        if (Math.max(Math.abs(x - x0), Math.abs(z - z0)) !== r || x < 0 || z < 0) continue;
        if (canPlaceIgnoringLevel(state, o.def, x, z, rot, id) === null) return { x, z, rot, code: null };
      }
    }
  }
  return { x: x0, z: z0, rot, code: here };
}

export const moveBack = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    if (!o || !o.prev) return ERR.NOT_FOUND;
    if (ctx.now >= o.prev.until) return ERR.NOT_REFUNDABLE;          // the 10-minute window has closed
    return canPlaceIgnoringLevel(state, o.def, o.prev.x, o.prev.z, o.prev.rot, a.id);
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const { x, z, rot } = o.prev;
    const def = defOf(o.def);
    if (def.greenhouse) carryPlots(tx, a.id, def, x, z, rot);
    tx.set(['farm', 'objects', a.id, 'x'], x);
    tx.set(['farm', 'objects', a.id, 'z'], z);
    tx.set(['farm', 'objects', a.id, 'rot'], rot);
    tx.del(['farm', 'objects', a.id, 'prev']);
    tx.emit({ e: 'movedBack', id: a.id, def: o.def, x, z, rot, by: ctx.pid });
  },
};

export const store = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    const def = o && defOf(o.def);
    if (!def) return ERR.NOT_FOUND;
    if (def.kind !== 'decor') return ERR.LOCKED;           // buildings, homes, trees, plots move; they are not stored
    if (o.mw !== undefined) return ERR.LOCKED;              // a Masterwork piece keeps its level on the farm (move it)
    if (tierOf(o) > 0) return ERR.LOCKED;                   // so does an upgraded bench (the tray keeps no tiers)
    if (pinned(o, a, ctx)) return ERR.PINNED;
    return null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    stash(tx, o.def, 1);
    // decor prices are fixed per def, so a paid copy is remembered as a count, not a value
    if (o.paid && (o.paid.coins > 0 || o.paid.acorns > 0)) {
      tx.inc(['farm', 'storagePaid', o.def], 1, { dropZero: true });
    }
    tx.del(['farm', 'objects', a.id]);
    tx.emit({ e: 'stored', id: a.id, def: o.def, by: ctx.pid });
  },
};

// ---- refunds, sales, trash -------------------------------------------------------------------------------------

const receiptValid = (o, now) => Boolean(o.rcpt) && now < o.rcpt.until;

/**
 * null when `o` (id) may be removed at all: empty plots, idle homes, an animal whose product was collected (it
 * would be destroyed with the animal: "Collect its Egg first", RC-22), never decor that is pinned (soft).
 */
function removableCode(state, id, o, now) {
  const def = defOf(o.def);
  const kind = kindOf(def);
  if (def.movable === false || kind === 'landmark' || kind === 'debris') return ERR.LOCKED;
  if (def.relic) return ERR.LOCKED;                                   // an Acorn shop relic is for good (wave 4b)
  if (kind === 'plot' && o.gh !== undefined) return ERR.LOCKED;      // a Greenhouse plot belongs to its frame
  if (kind === 'plot' && o.crop) return ERR.OCCUPIED;
  if (kind === 'animal' && isColony(o)) return ERR.LOCKED;           // the colony belongs to its hive
  if (kind === 'animal' && Number.isSafeInteger(o.readyAt) && o.readyAt <= now) return ERR.OCCUPIED;
  if (kind === 'home' && occupantsOf(state, id).some((k) => !pristineColony(state, k, now))) return ERR.OCCUPIED;
  if (kind === 'building' && (o.queue.length > 0 || (o.ready ?? 0) > 0)) return ERR.OCCUPIED;   // §9 #39
  return null;
}

/** A colony that never gave honey and has none waiting: it leaves with its hive on the hive's undo. */
function pristineColony(state, id, now) {
  const c = state.farm.objects[id];
  return isColony(c) && c.cycle === 0 && !(Number.isSafeInteger(c.readyAt) && c.readyAt <= now);
}

/**
 * The share of a decor piece's shop price a GIFT copy sells for (wave 4, owner wish A: a quest reward, the starter
 * fence or a tray gift is worth something, never more than a bought copy's share). Content's
 * MARKET.refunds.giftDecorBp when present.
 */
export const GIFT_DECOR_BP = MARKET.refunds.giftDecorBp ?? 2500;

/** What a gift (unpaid) copy of decor `def` sells for: GIFT_DECOR_BP of its shop price (coins and Acorns). */
const giftResale = (def) => ({ coins: mulBp(def.cost ?? 0, GIFT_DECOR_BP), acorns: mulBp(def.acorns ?? 0, GIFT_DECOR_BP) });

/** Coins / Acorns selling `o` returns now (GDD §4.3 table; 100 % with a valid receipt). */
export function resaleOf(o, now) {
  if (defOf(o.def)?.relic) return null;                  // an Acorn shop relic is never sold (wave 4b)
  const paid = o.paid ?? { coins: 0, acorns: 0 };
  if (receiptValid(o, now)) return { coins: o.rcpt.coins, acorns: o.rcpt.acorns, undo: true };
  const def = defOf(o.def);
  const R = MARKET.refunds;
  let bp;
  switch (kindOf(def)) {
    case 'animal': bp = o.cycle >= def.prizedAt ? R.prizedAnimalBp : R.animalBp; break;
    case 'plot': bp = R.plotBp; break;
    case 'decor':
      if (o.paid === undefined) return { ...giftResale(def), undo: false };
      bp = R.decorBp;
      break;
    default: return null;                                // trees, homes, buildings are not sold (they move)
  }
  return { coins: mulBp(paid.coins, bp), acorns: mulBp(paid.acorns, bp), undo: false };
}

/**
 * What selling ONE copy of decor `defId` from the build tray pays now (wave 4, owner wish A), or null when the tray
 * holds none or it is not decor: a paid copy (stored after placing, a Wishlist buy) the decor share of its shop price
 * (the price `place` would record as `paid`), a gift GIFT_DECOR_BP. Paid copies sell first. Pure: the tray previews it.
 * @returns {null | { coins, acorns, paid: boolean }}
 */
export function sellStoredValue(state, defId) {
  const def = defOf(defId);
  if (!def || def.kind !== 'decor' || def.relic || !((state.farm.storage[defId] ?? 0) > 0)) return null;
  if ((state.farm.storagePaid[defId] ?? 0) > 0) {
    const bp = MARKET.refunds.decorBp;
    return { coins: mulBp(def.cost ?? 0, bp), acorns: mulBp(def.acorns ?? 0, bp), paid: true };
  }
  return { ...giftResale(def), paid: false };
}

function pruneTrash(tx, now) {
  for (const id of sortedKeys(tx.state.farm.trash)) {
    if (tx.state.farm.trash[id].until <= now) tx.del(['farm', 'trash', id]);
  }
}

function payOut(tx, ctx, r, reason) {
  if (r.coins > 0) refundCoins(tx, ctx, r.coins, reason);
  if (r.acorns > 0) refundAcorns(tx, r.acorns);
}

export const refund = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    if (!o) return ERR.NOT_FOUND;
    if (!receiptValid(o, ctx.now)) return ERR.NOT_REFUNDABLE;
    const code = removableCode(state, a.id, o, ctx.now);
    if (code) return code === ERR.LOCKED ? ERR.NOT_REFUNDABLE : code;
    if (pinned(o, a, ctx)) return ERR.PINNED;
    return null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const r = { coins: o.rcpt.coins, acorns: o.rcpt.acorns };
    const def = defOf(o.def);
    payOut(tx, ctx, r, `undo:${o.def}`);
    coatLeaves(tx, o);                                       // a season coat stays on the farm
    for (const k of occupantsOf(tx.state, a.id)) tx.del(['farm', 'objects', k]);   // a hive's pristine colony
    tx.del(['farm', 'objects', a.id]);
    tx.emit({ e: 'removed', id: a.id, def: o.def, kind: kindOf(def), by: ctx.pid, coins: r.coins, acorns: r.acorns,
      reason: 'undo' });
    if (kindOf(def) === 'animal') settleOwed(tx, ctx);       // a place in the home opened up
  },
};

export const sellObject = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    if (!o) return ERR.NOT_FOUND;
    const code = removableCode(state, a.id, o, ctx.now);
    if (code) return code;
    if (resaleOf(o, ctx.now) === null) return ERR.LOCKED;
    if (pinned(o, a, ctx)) return ERR.PINNED;
    return null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const def = defOf(o.def);
    const r = resaleOf(o, ctx.now);
    pruneTrash(tx, ctx.now);
    if (!r.undo) {
      // destructive: restorable by either player for SAFETY.trashMs (GDD §6.3)
      const obj = structuredClone(o);
      delete obj.prev;
      tx.set(['farm', 'trash', a.id],
        { obj, until: ctx.now + SAFETY.trashMs, by: ctx.pid, coins: r.coins, acorns: r.acorns });
    }
    payOut(tx, ctx, r, r.undo ? `undo:${o.def}` : `sell:${o.def}`);
    coatLeaves(tx, o);                                       // a season coat stays on the farm (restore takes it again)
    tx.del(['farm', 'objects', a.id]);
    tx.emit({ e: 'removed', id: a.id, def: o.def, kind: kindOf(def), by: ctx.pid, coins: r.coins, acorns: r.acorns,
      reason: r.undo ? 'undo' : 'sell' });
    if (kindOf(def) === 'animal') settleOwed(tx, ctx);
  },
};

/**
 * `sellStored {def}` (wave 4, owner wish A): sell ONE copy of a decor piece waiting in the build tray. Paid copies
 * first (the decor share of the shop price), then gifts (GIFT_DECOR_BP). Like every destructive sale it goes to the
 * trash for SAFETY.trashMs: `restore {id}` (id = the event's `id`) puts the copy back in the tray and takes the coins
 * back. No buy/sell loop: a copy never sells for more than its share of what a new one costs.
 */
export const sellStored = {
  schema: { def: V.content('placeables') },
  check(state, a, ctx) {
    const def = defOf(a.def);
    if (def.kind !== 'decor' || def.relic) return ERR.LOCKED;            // a relic is never sold (wave 4b)
    if (!((state.farm.storage[a.def] ?? 0) > 0)) return ERR.NOT_FOUND;
    if (Object.hasOwn(state.farm.trash, ctx.newId(0))) return ERR.ID_TAKEN;
    return null;
  },
  apply(tx, a, ctx) {
    const r = sellStoredValue(tx.state, a.def);
    const id = ctx.newId(0);
    pruneTrash(tx, ctx.now);
    if (r.paid) tx.inc(['farm', 'storagePaid', a.def], -1, { dropZero: true });
    tx.inc(['farm', 'storage', a.def], -1, { dropZero: true });
    tx.set(['farm', 'trash', id], { tray: a.def, paid: r.paid, until: ctx.now + SAFETY.trashMs, by: ctx.pid,
      coins: r.coins, acorns: r.acorns });
    payOut(tx, ctx, r, `sell:${a.def}`);
    tx.emit({ e: 'soldStored', id, def: a.def, coins: r.coins, acorns: r.acorns, by: ctx.pid });
  },
};

export const restore = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const t = Object.hasOwn(state.farm.trash, a.id) ? state.farm.trash[a.id] : null;
    if (!t || ctx.now >= t.until) return ERR.NOT_FOUND;
    if (t.tray !== undefined) {
      // a tray copy sold with sellStored: back into the tray (under its cap again: RC-04)
      const def = defOf(t.tray);
      if (ownedCount(state, def.id) + 1 > ownCap(state, def)) return ERR.CAP;
      if (state.farm.wallet.coins < t.coins) return ERR.NO_COINS;
      if (state.farm.wallet.acorns < t.acorns) return ERR.NO_ACORNS;
      return null;
    }
    if (objectOf(state, a.id)) return ERR.ID_TAKEN;
    const def = defOf(t.obj.def);
    if (def.layer === 'none') {
      const home = objectOf(state, t.obj.home);
      if (!home) return ERR.NOT_FOUND;
      if (occupantsOf(state, t.obj.home).length >= capacityOf(state, t.obj.home)) return ERR.CAP;
    } else {
      // the caps again: a plot sold, a new one bought in its room, the old one restored = over the cap (RC-04)
      if (ownedCount(state, def.id) + 1 > ownCap(state, def)) return ERR.CAP;
      const code = canPlaceIgnoringLevel(state, t.obj.def, t.obj.x, t.obj.z, t.obj.rot, null);
      if (code) return code;
    }
    if (state.farm.wallet.coins < t.coins) return ERR.NO_COINS;
    if (state.farm.wallet.acorns < t.acorns) return ERR.NO_ACORNS;
    return null;
  },
  apply(tx, a, ctx) {
    const t = tx.get(['farm', 'trash', a.id]);
    if (t.tray !== undefined) {
      if (t.coins > 0) spend(tx, ctx, t.coins, `restore:${t.tray}`);
      if (t.acorns > 0) {
        tx.inc(['farm', 'wallet', 'acorns'], -t.acorns);
        tx.inc(['farm', 'stats', 'acorns.spent'], t.acorns, { dropZero: true });
      }
      const def = t.tray;
      const paid = t.paid === true;
      tx.del(['farm', 'trash', a.id]);
      stash(tx, def, 1);
      if (paid) tx.inc(['farm', 'storagePaid', def], 1, { dropZero: true });
      tx.emit({ e: 'restored', id: a.id, def, tray: true, by: ctx.pid });
      return;
    }
    const obj = coatReturns(tx, structuredClone(t.obj));
    if (t.coins > 0) spend(tx, ctx, t.coins, `restore:${obj.def}`);
    if (t.acorns > 0) {
      tx.inc(['farm', 'wallet', 'acorns'], -t.acorns);
      tx.inc(['farm', 'stats', 'acorns.spent'], t.acorns, { dropZero: true });
    }
    tx.del(['farm', 'trash', a.id]);
    tx.set(['farm', 'objects', a.id], obj);
    tx.emit({ e: 'restored', id: a.id, def: obj.def, by: ctx.pid });
  },
};

export const pinObject = {
  schema: { id: V.objId, on: V.bool },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    const def = o && defOf(o.def);
    if (!def) return ERR.NOT_FOUND;
    if (def.kind !== 'decor') return ERR.LOCKED;
    if (a.on && o.pin === ctx.pid) return ERR.ALREADY_DONE;
    if (!a.on && o.pin === undefined) return ERR.ALREADY_DONE;
    if (!a.on && o.pin !== ctx.pid) return ERR.SELF_ONLY;         // only the pinner unpins; moving still works (soft)
    return null;
  },
  apply(tx, a, ctx) {
    if (a.on) tx.set(['farm', 'objects', a.id, 'pin'], ctx.pid);
    else tx.del(['farm', 'objects', a.id, 'pin']);
    tx.emit({ e: 'pinned', id: a.id, pin: a.on ? ctx.pid : null, by: ctx.pid });
  },
};
