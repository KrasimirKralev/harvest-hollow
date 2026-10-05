// Coins, goods, storage and the shared price/time modifiers (tech-architecture §2.5, GDD §3.6, §4.3, §4.8, §6.3).
// Every coin movement goes through earn/grant/spend/refund so the ledger and the stats counters can never disagree
// with the wallet; every goods movement goes through intake/consume so the Barn's capacity and overflow rules hold
// everywhere. Owned by rules-economy. Pure helpers (no tx) are safe for the UI to call for previews.
//
// Ledger invariant: coins + (coins the Wishlist holds outside the wallet) ==
//   START.coins + coins.earned + coins.granted + coins.refunded - coins.spent
//   earned   sales, orders, barge, Fair, quests (GDD §5.4: what "coins earned" goals count)
//   granted  rewards: level-ups, achievements, chests, debris (review-m0 #19)
//
// Barn (GDD §3.6): inventory holds at most barnCap(state) units in all; anything above sits in `overflow`.
// Intake always lands (inventory first, then overflow); actions that TAKE goods in optionally (harvest, collect,
// tray collect) first check canIntake(): at 2 x capacity the goods wait where they are. Consumption drains
// overflow first, and normalize() then refills the inventory from overflow, so the overflow pile only ever holds
// what is truly above capacity.
//
// Percentages are basis points; every result is an integer (index.js rule 4).
import { LEDGER_MAX, PLAYER_SLOTS } from '../content/config.js';
import {
  itemOf, cropOf, treeOf, animalOf, recipeOf, feedOf, levelFromXp, barnCapacity, masteryStars, MASTERY, GROWTH, SAFETY,
  MARKET, live, expansionOf, isLive, PERKS,
} from '../content/index.js';
import { dayIndex, seasonOf } from './calendar.js';
import { sortedKeys } from './order.js';
import { hash32 } from './rng.js';
import { goldenHourBp } from './coop.js';
import { upgradeBonus } from './upgrades.js';
import { relicBarnCap } from './relics.js';
import { V } from './schema.js';
import { ERR } from '../net/protocol.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : 0);

/** floor(n * bp / 10000): a basis-point share of an integer. */
export const mulBp = (n, bp) => Math.floor((n * bp) / 10_000);

/** The farm level (derived, never stored). */
export const levelOf = (state) => levelFromXp(state.farm.xp);

// ---- coins ------------------------------------------------------------------------------------------------

/** One ledger row (every coin movement: who, how much, why). earn/grant/spend/refund call it; Wishlist moves too. */
export function ledger(tx, ctx, n, reason) {
  const L = tx.get(['farm', 'ledger']);
  // A ring keyed by slot index: one small `set` per movement instead of re-sending a 500-row array.
  tx.set(['farm', 'ledger', 'rows', String(L.n % LEDGER_MAX)], { at: ctx.now, by: ctx.pid, n, reason });
  tx.inc(['farm', 'ledger', 'n'], 1);
}

/** Add coins to the treasury (n > 0). */
export function earn(tx, ctx, n, reason) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`earn: bad amount ${n}`);
  tx.inc(['farm', 'wallet', 'coins'], n);
  tx.inc(['farm', 'stats', 'coins.earned'], n, { dropZero: true });
  ledger(tx, ctx, n, reason);
}

/** Add reward coins (level-ups, achievements, chests): counted as granted, never as earned (n > 0). */
export function grant(tx, ctx, n, reason) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`grant: bad amount ${n}`);
  tx.inc(['farm', 'wallet', 'coins'], n);
  tx.inc(['farm', 'stats', 'coins.granted'], n, { dropZero: true });
  ledger(tx, ctx, n, reason);
}

/**
 * base x (1 + bp/10000)^(n-1), floored after every step: the n-th copy price of trees, animals, hives
 * (GDD §3.2, §3.4) in integers only, so every browser computes the same price (review-m0 #8).
 * @param {number} base  price of the first copy  @param {number} bp  growth per copy in basis points
 * @param {number} n     1-based copy number
 */
export function grow(base, bp, n) {
  let p = base;
  for (let k = 1; k < n; k++) p = Math.floor((p * (10_000 + bp)) / 10_000);
  return p;
}

/** Take coins from the treasury (n > 0). Throws on overdraft, so the action rejects atomically. */
export function spend(tx, ctx, n, reason) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`spend: bad amount ${n}`);
  tx.inc(['farm', 'wallet', 'coins'], -n);
  tx.inc(['farm', 'stats', 'coins.spent'], n, { dropZero: true });
  ledger(tx, ctx, -n, reason);
}

/** Give coins back (receipts, cancels, object sales). Counts as refunded, never as earned (tech §2.5). */
export function refund(tx, ctx, n, reason) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`refund: bad amount ${n}`);
  tx.inc(['farm', 'wallet', 'coins'], n);
  tx.inc(['farm', 'stats', 'coins.refunded'], n, { dropZero: true });
  ledger(tx, ctx, n, reason);
}

/**
 * Move coins between the treasury and a Wishlist entry (n > 0 deposits, n < 0 withdraws). Neither earning nor
 * spending: the ledger invariant counts Wishlist coins next to the wallet (header).
 */
export function wishMove(tx, ctx, wishId, n) {
  if (!Number.isSafeInteger(n) || n === 0) throw new Error(`wishMove: bad amount ${n}`);
  tx.inc(['farm', 'wallet', 'coins'], -n);
  tx.inc(['farm', 'wishlist', wishId, 'coins'], n);
  ledger(tx, ctx, -n, n > 0 ? 'wish:in' : 'wish:out');
}

/** Coins the Wishlist holds outside the wallet. */
export function wishCoins(state) {
  let n = 0;
  for (const w of Object.values(state.farm.wishlist ?? {})) n += w.coins;
  return n;
}

// ---- Acorns -----------------------------------------------------------------------------------------------

/** Acorns `pid` spent today (the farm's calendar day), for the per-player-day BIG_SPEND rule. */
export function acornsToday(state, pid, now) {
  const p = Object.hasOwn(state.players, pid) ? state.players[pid] : null;
  if (!p || !p.acornDay || p.acornDay.day !== dayIndex(now, state.meta.tz)) return 0;
  return p.acornDay.n;
}

/** Spend Acorns (n > 0; caller checked the balance). Tracks the actor's daily total and 'acorns.spent'. */
export function spendAcorns(tx, ctx, n, reason) {      // eslint-disable-line no-unused-vars
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`spendAcorns: bad amount ${n}`);
  tx.inc(['farm', 'wallet', 'acorns'], -n);
  tx.inc(['farm', 'stats', 'acorns.spent'], n, { dropZero: true });
  if (Object.hasOwn(tx.state.players, ctx.pid)) {
    const day = dayIndex(ctx.now, tx.state.meta.tz);
    tx.set(['players', ctx.pid, 'acornDay'], { day, n: acornsToday(tx.state, ctx.pid, ctx.now) + n });
  }
}

/** Give Acorns back (receipt refunds; n > 0). Never reduces the day's BIG_SPEND count (it is a heads-up). */
export function refundAcorns(tx, n) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`refundAcorns: bad amount ${n}`);
  tx.inc(['farm', 'wallet', 'acorns'], n);
  tx.inc(['farm', 'stats', 'acorns.refunded'], n, { dropZero: true });
}

/**
 * GDD §6.3 BIG_SPEND: a purchase above 25 % of the spendable treasury AND above 1,000 coins, or >= 10 Acorns in
 * one purchase, or that brings the actor's Acorns spent today to >= 10 (Hurry counts, ruling X7a). Coins the
 * Wishlist holds are outside the wallet, so `wallet.coins` IS the spendable treasury.
 * @returns {boolean} true when the action needs args.confirm = ['BIG_SPEND']
 */
export function isBigSpend(state, pid, now, coins, acorns = 0) {
  const B = SAFETY.bigSpend;
  if (coins > 0 && coins > B.minCoins && coins > mulBp(state.farm.wallet.coins, B.shareBp)) return true;
  if (acorns > 0 && (acorns >= B.acorns || acornsToday(state, pid, now) + acorns >= B.acornsPerPlayerDay)) return true;
  return false;
}

// ---- goods ------------------------------------------------------------------------------------------------

const sumOf = (o) => {
  let n = 0;
  for (const k in o) if (Object.hasOwn(o, k)) n += o[k];
  return n;
};

/** Barn capacity after the farm's Barn upgrades (+ the upgraded farmhouse's storage, wave 4). */
// + the farmhouse upgrades (wave 4) and the Golden Barn (wave 4b, an Acorn shop relic)
export const barnCap = (state) => barnCapacity(state.farm.barn ?? 0) + upgradeBonus(state, 'barnCap')
  + relicBarnCap(state);
/** Units in the Barn proper (overflow excluded). */
export const stockOf = (state) => sumOf(state.farm.inventory);
/** Units in the overflow pile. */
export const overflowOf = (state) => sumOf(state.farm.overflow);
/** True while optional intake (harvest, collect, tray) may still land: below 2 x capacity (GDD §3.6). */
export const canIntake = (state) => stockOf(state) + overflowOf(state)
  < mulBp(barnCap(state), MARKET.barn.overflowMulBp);

/** Units of an item available to use or sell (barn + overflow). */
export function available(state, item) {
  return own(state.farm.inventory, item) + own(state.farm.overflow, item);
}

/**
 * Keep N (GDD §6.3): the farm-wide "keep at least N" of an item and who set it. An explicit entry wins over the
 * item's content default (Wood keeps 20), so { n: 0 } un-keeps it.
 * @returns {{ n: number, by: string | null }}
 */
export function keptOf(state, item) {
  const k = state.farm.keep;
  if (k && Object.hasOwn(k, item)) return k[item];
  const d = itemOf(item)?.keepDefault ?? 0;
  return d > 0 ? { n: d, by: 'sys' } : { n: 0, by: null };
}

/** Units of `item` usable without dipping below its Keep N. */
export const unkept = (state, item) => Math.max(0, available(state, item) - keptOf(state, item).n);

/**
 * Move units between inventory and overflow so the inventory holds min(capacity, everything) and the overflow
 * the rest. Canonical item order (sortedKeys), so live, replayed and predicted states agree (index.js rule 3).
 */
export function normalize(tx) {
  const cap = barnCap(tx.state);
  let inv = stockOf(tx.state);
  if (inv < cap) {
    for (const item of sortedKeys(tx.state.farm.overflow)) {
      if (inv >= cap) break;
      const k = Math.min(cap - inv, tx.state.farm.overflow[item]);
      tx.inc(['farm', 'overflow', item], -k, { dropZero: true });
      tx.inc(['farm', 'inventory', item], k, { dropZero: true });
      inv += k;
    }
  } else if (inv > cap) {
    // only an old save (M0 had no capacity) or a future capacity change can get here
    for (const item of sortedKeys(tx.state.farm.inventory).reverse()) {
      if (inv <= cap) break;
      const k = Math.min(inv - cap, tx.state.farm.inventory[item]);
      tx.inc(['farm', 'inventory', item], -k, { dropZero: true });
      tx.inc(['farm', 'overflow', item], k, { dropZero: true });
      inv -= k;
    }
  }
}

/**
 * Take goods in (harvest, collect, trays, gifts, rewards, refunds). Always lands: the inventory up to capacity,
 * the rest in overflow (emits `overflowed`). Optional intake checks canIntake() BEFORE calling this.
 */
export function intake(tx, item, qty) {
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error(`intake: bad qty ${qty}`);
  if (!itemOf(item)) throw new Error(`intake: unknown item ${item}`);
  const room = Math.max(0, barnCap(tx.state) - stockOf(tx.state));
  const inside = Math.min(room, qty);
  if (inside > 0) tx.inc(['farm', 'inventory', item], inside, { dropZero: true });
  if (qty > inside) {
    tx.inc(['farm', 'overflow', item], qty - inside, { dropZero: true });
    tx.emit({ e: 'overflowed', item, qty: qty - inside });
  }
}

/** Consume goods (caller checked available >= qty). Overflow drains first, then the barn refills from it. */
export function consume(tx, item, qty) {
  let left = qty;
  const over = own(tx.state.farm.overflow, item);
  if (over > 0) {
    const k = Math.min(over, left);
    tx.inc(['farm', 'overflow', item], -k, { dropZero: true });
    left -= k;
  }
  if (left > 0) tx.inc(['farm', 'inventory', item], -left, { dropZero: true });
  normalize(tx);
}

/** Put objects into the farm's build tray `farm.storage` (rewards, stored decor). Placed later for free. */
export function stash(tx, defId, n = 1) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`stash: bad count ${n}`);
  tx.inc(['farm', 'storage', defId], n, { dropZero: true });
}

// ---- mastery, seasons, demand, time --------------------------------------------------------------------------

/** The content def and mastery family of a crop / tree / animal / recipe id, or null. */
export function masteryDefOf(id) {
  for (const [family, get] of [['crops', cropOf], ['trees', treeOf], ['animals', animalOf], ['recipes', recipeOf]]) {
    const d = get(id);
    if (d) return { family, def: d };
  }
  return null;
}

/**
 * Mastery stars the farm holds for a crop / tree / animal / recipe (GDD §4.8): 0 before MASTERY.unlock (L7);
 * counts are farm.mastery[id] (harvests, collections, crafts; rules-goals keeps them).
 */
export function starsOf(state, id) {
  const level = levelOf(state);
  if (level < MASTERY.unlock) return 0;
  const m = masteryDefOf(id);
  if (!m) return 0;
  return masteryStars(m.def, own(state.farm.mastery, id), level);
}

/** Summed mastery effects for `stars` (1..4) of a family: { sellBp, timeBp, bonusUnitBp, doubleBp, ribbonBp, ... }. */
export function masteryEffects(family, stars) {
  const out = { sellBp: 0, timeBp: 0, bonusUnitBp: 0, doubleBp: 0, ribbonBp: 0, premiumBp: 0, xpBp: 0 };
  const list = MASTERY.effects[family] ?? [];
  for (let s = 0; s < stars && s < list.length; s++) {
    for (const [k, v] of Object.entries(list[s])) if (typeof v === 'number' && k in out) out[k] += v;
  }
  return out;
}

/** True when crop `cropId` is in season at `now` (farm calendar). */
export const inSeason = (state, cropId, now) => cropOf(cropId)?.season === seasonOf(now, state.meta.tz);

/**
 * Basis points of time a process loses when it STARTS now (mastery ★2, in season, Golden Hour, the Mill Wheel and
 * collection perks for recipes, Pig Woods for truffle pigs, the Orchard Pond's irrigation for trees); not capped
 * (cutMs applies the 50 % floor).
 */
export function startCutBp(state, id, now, { season = false } = {}) {
  const m = masteryDefOf(id);
  let bp = m ? masteryEffects(m.family, starsOf(state, id)).timeBp : 0;
  if (season && inSeason(state, id, now)) bp += GROWTH.season.timeBp;
  bp += goldenHourBp(state, now);                     // rules-goals' window; fixed at start (GDD §6.2 #9)
  bp += recipeCutBp(state, id) + animalCutBp(state, id) + treeCutBp(state, id);
  return bp;
}

// ---- M1b: restoration rewards, collection perks, land features (GDD §5.5, §5.9, §3.9) ---------------------------

/** True when Restoration project `id` is complete (its permanent reward applies). */
export const projectDone = (state, id) => {
  const r = state.farm.restore;
  return Boolean(r && Object.hasOwn(r, id) && r[id] && Number.isSafeInteger(r[id].done));
};

/** The reward objects of every completed, live Restoration project, in project order. */
export function projectRewards(state) {
  const out = [];
  for (const p of live('restoration')) if (projectDone(state, p.id)) out.push(p.reward ?? {});
  return out;
}

// rules-goals owns the collections album and its `perkOf(state, key)` (actions/album.js). economy.js is a leaf of the
// import graph (it imports no action module), so actions/animals.js hands perkOf in through this hook at load time:
// every module that imports economy.js finds it evaluated, so the call never meets a TDZ.
let perkSource = () => 0;
/** Register the collection-perk reader: `(state, key) => sum of that perk over the completed, live sets`. */
export function setPerkSource(fn) {
  perkSource = typeof fn === 'function' ? fn : () => 0;
}

/**
 * Sum of a numeric collection perk over the farm's completed, live sets (GDD §5.5: truffleBp, forageRadius,
 * bonusEggBp, chopsLess, seedBp, sewingTimeBp, beauty10 ...). 0 when no set grants it.
 */
export function collectionPerk(state, key) {
  const v = perkSource(state, key);
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

// ---- M2: specialisation perks (GDD §4.7; the economy side of them) -----------------------------------------------
//
// rules-goals owns the perk picks, points and respec (actions/perks.js, `perkValue(state, pid, tree, key)`) and the
// four XP perks (progress.js). The economy effects (seeds, bonus units, watering, ribbons, babies, doubles, free feed,
// prized sooner, tree prices, Heirloom at 45, queue time, crafted-good prices, duet seconds) read the value through
// this hook, registered by actions/animals.js at load (the same leaf-of-the-graph reason as setPerkSource). Perks apply
// only to the OWNER's own actions (§4.7): every caller passes the acting pid (ctx.pid), never the partner's.
let playerPerkSource = null;
/** Register rules-goals' perk reader `(state, pid, tree, key) => number` (0 when not owned or not live). */
export function setPlayerPerkSource(fn) {
  playerPerkSource = typeof fn === 'function' ? fn : null;
}

/**
 * The value of perk effect `key` of `tree` (grower, rancher, orchardist, artisan) that player `pid` owns, else 0.
 * A non-player actor ('sys') owns no perks.
 */
export function playerPerk(state, pid, tree, key) {
  if (!playerPerkSource || !isLive(PERKS) || !Object.hasOwn(state.players, pid)) return 0;
  const v = playerPerkSource(state, pid, tree, key);
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

/** The building of a recipe or feed id, or null. */
const buildingOfRecipe = (id) => (recipeOf(id) ?? feedOf(id))?.building ?? null;

/** Time cut of a recipe / feed from the Mill Wheel (Feed Mill and Windmill -20 %) and the Buttons set (sewing). */
export function recipeCutBp(state, id) {
  const b = buildingOfRecipe(id);
  if (!b) return 0;
  let bp = 0;
  for (const r of projectRewards(state)) bp += r.buildingTimeBp?.[b] ?? 0;
  if (b === 'sewing') bp += collectionPerk(state, 'sewingTimeBp');
  return bp;
}

/** Time cut of an animal's cycle from an owned expansion's feature (Pig Woods: truffle pigs dig 10 % faster). */
export function animalCutBp(state, id) {
  const a = animalOf(id);
  if (!a || a.product !== 'truffle') return 0;
  let bp = 0;
  for (const e of state.farm.expansions) bp += expansionOf(e)?.feature?.truffleSpeedBp ?? 0;
  return bp;
}

/**
 * Queue slots a completed Restoration project adds to every building of `buildingId` (Grandma's Farmhouse: her duet
 * table, +1 Farm Kitchen slot, reward `kitchenSlots`). Materialised on the building as `xs` (crafting.js), so the
 * panels and the renderer keep reading `o.slots`.
 */
export function rewardSlots(state, buildingId) {
  let n = 0;
  if (buildingId === 'kitchen') for (const r of projectRewards(state)) n += r.kitchenSlots ?? 0;
  return n;
}

/** Time cut of a tree's cycle from completed Restoration projects (the Orchard Pond's irrigation, -10 %). */
export function treeCutBp(state, id) {
  if (!treeOf(id)) return 0;
  let bp = 0;
  for (const r of projectRewards(state)) bp += r.treeCycleBp ?? 0;
  return bp;
}

/** Extra plot cap from completed Restoration land (the Stone Bridge's Hollow Meadow, +6). */
export function projectPlotCap(state) {
  let n = 0;
  for (const r of projectRewards(state)) n += r.land?.plotCap ?? 0;
  return n;
}

/**
 * Items the farm made on farm day `day` or later (sorted ids), from rules-goals' `farm.made` log (item -> the farm day
 * it was last made; progress.js keeps it while the Barge or the Town Projects are live).
 */
export function madeSinceDay(state, day) {
  const made = state.farm.made ?? {};
  return Object.keys(made).filter((k) => Number.isSafeInteger(made[k]) && made[k] >= day).sort();
}

/** A process duration after time cuts: cuts add and never take it below GROWTH.timeFloorBp of `base` (§4.8). */
export function cutMs(base, bp) {
  return base - mulBp(base, Math.min(bp, 10_000 - GROWTH.timeFloorBp));
}

/**
 * How much earlier a running process gets when another cut of `addBp` joins the `haveBp` it already has (both
 * on `base`), honouring the 50 % floor.
 */
export function extraCutMs(base, haveBp, addBp) {
  const cap = 10_000 - GROWTH.timeFloorBp;
  return mulBp(base, Math.min(haveBp + addBp, cap)) - mulBp(base, Math.min(haveBp, cap));
}

/** Market Stand price of ONE unit before the Demand bonus: V x (1 + 5 % per sell star) x (1.10 in season), then the
 * upgraded Market Stand's sellBp (wave 4). */
export function unitPrice(state, item, now) {
  const it = itemOf(item);
  if (!it) return 0;
  const src = it.source;
  const m = src ? masteryDefOf(src) : null;
  const sellBp = m ? masteryEffects(m.family, starsOf(state, src)).sellBp : 0;
  const seasonBp = it.kind === 'crop' && inSeason(state, item, now) ? GROWTH.season.sellBp : 0;
  const p = Math.floor((it.sell * (10_000 + sellBp) * (10_000 + seasonBp)) / 100_000_000);
  const standBp = upgradeBonus(state, 'sellBp');                 // the upgraded Market Stand (wave 4, owner wish E)
  return standBp > 0 ? mulBp(p, 10_000 + standBp) : p;
}

/** Back-compat (M0): the plain content value of one unit. */
export function sellValue(item) {
  return itemOf(item)?.sell ?? 0;
}

const RAW_KINDS = new Set(['crop', 'fruit', 'animal']);

function demandPick(state, list, day, kind) {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  // idx(d) = base + d * step (mod n) with step in [1, n-1]: two consecutive days never pick the same item while
  // the list is unchanged, without looking at yesterday's (possibly different) list.
  const n = list.length;
  const base = hash32(state.meta.farmSeed, 'demand', kind) % n;
  const step = 1 + (hash32(state.meta.farmSeed, 'demandStep', kind) % (n - 1));
  return list[(base + (day % n) * step) % n];
}

/**
 * Market Demand of the day (GDD §4.10, L11): one raw and one crafted item, both unlocked for at least one level,
 * that sell for +50 % for the first MARKET.demand.unitsPerDay units of the day (farm-wide). null before L11.
 * @returns {{ day: number, raw: string|null, crafted: string|null } | null}
 */
export function demandOf(state, now) {
  const D = MARKET.demand;
  const level = levelOf(state);
  if (level < D.unlock) return null;
  const day = dayIndex(now, state.meta.tz);
  const ok = (it) => it.sellable && (it.unlock ?? 1) <= level - D.minAgeLevels;
  const items = live('items').filter(ok).map((it) => it).sort((a, b) => (a.id < b.id ? -1 : 1));
  const raw = items.filter((it) => RAW_KINDS.has(it.kind)).map((it) => it.id);
  const crafted = items.filter((it) => it.kind === 'craft' && it.tier !== 'duet').map((it) => it.id);
  return { day, raw: demandPick(state, raw, day, 'raw'), crafted: demandPick(state, crafted, day, 'crafted') };
}

/** Demand-bonus units of `item` still available today (0 when it is not a Demand item). */
export function demandLeft(state, item, now) {
  const d = demandOf(state, now);
  if (!d || (d.raw !== item && d.crafted !== item)) return 0;
  const rec = state.farm.demand;
  const used = rec && rec.day === d.day ? own(rec.n, item) : 0;
  return Math.max(0, MARKET.demand.unitsPerDay + upgradeBonus(state, 'demandUnits') - used);   // + the Market Stand's
}

/**
 * What selling `qty` of `item` pays right now: { coins, demand } (demand = units at the +50 % bonus). Pure: the
 * sell panel previews with it. `pid` (the seller, M2): the Artisan perk adds 5 % on crafted goods they sell.
 */
export function saleOf(state, item, qty, now, pid = null) {
  let p = unitPrice(state, item, now);
  const craftBp = pid && itemOf(item)?.kind === 'craft' ? playerPerk(state, pid, 'artisan', 'craftSellBp') : 0;
  if (craftBp > 0) p = mulBp(p, 10_000 + craftBp);
  const demand = Math.min(qty, demandLeft(state, item, now));
  const bonusP = mulBp(p, 10_000 + MARKET.demand.bonusBp);
  return { coins: p * (qty - demand) + bonusP * demand, demand };
}

/** The two player slots, for the "other player" checks (§6.2: compares player ids, never connections). */
export const isPlayer = (pid) => PLAYER_SLOTS.includes(pid);

// ---- action plumbing: drag strokes ------------------------------------------------------------------------------

/** Most targets one stroke action may carry (a 3x3 brush dragged across a field is split by the client). */
export const MAX_BATCH = 100;

/** The targets of a stroke action: `ids` (a drag, in stroke order) or the single `id`. */
export const targetsOf = (a) => (Array.isArray(a.ids) ? a.ids : typeof a.id === 'string' ? [a.id] : []);

/** BAD_ARGS unless exactly one of `id` / `ids` was sent. */
export const oneTarget = (a) => (a.id === undefined) !== (a.ids === undefined);

/**
 * Plan a stroke: `step(id)` checks one target against the plan so far (it may record what it reserves in its own
 * closure) and returns null (OK) or an ERR code. Partial success: the stroke applies to every target that passes,
 * in stroke order; with none, the action rejects with the first target's code. A SOFT code (RESERVED, PINNED,
 * BIG_SPEND) on any target rejects the whole stroke, so the player is asked once and the resend covers all.
 * @param {string[]} ids @param {(id: string) => string | null} step
 * @param {Set<string>} soft the soft codes (protocol SOFT)
 * @returns {{ ok: string[], code: string | null }}
 */
export function planBatch(ids, step, soft) {
  const ok = [];
  let first = null;
  for (const id of ids) {
    const c = step(id);
    if (c && soft.has(c)) return { ok: [], code: c };
    if (c) first ??= c;
    else ok.push(id);
  }
  return { ok, code: ok.length ? null : first };
}

// ---- the undo receipt and effects -------------------------------------------------------------------------------

/**
 * Delete the undo receipt (`rcpt`) of every object in `ids` whose EFFECT was just used (a Scarecrow's or Bird Bath's
 * bonus chance, a Sprinkler, a Cold Frame, a hive's pollination or its colony's forage, a horse on a barge crate, a
 * bench's Golden Hour, a grove's fourth tree): any use ends the 100 % undo, so nothing is borrowed and then refunded
 * (wave-2 QA RC-08; decor.js "deleted by ANY use"). Sorted, so both copies write the same ops.
 */
export function useReceipts(tx, ids) {
  for (const id of [...ids].sort()) {
    if (Object.hasOwn(tx.state.farm.objects, id) && tx.state.farm.objects[id].rcpt !== undefined) {
      tx.del(['farm', 'objects', id, 'rcpt']);
    }
  }
}

// ---- expansion proof tasks -------------------------------------------------------------------------------------

/**
 * Count a deed toward every opened expansion card's proof tasks (GDD §3.9: progress counts from when the card is
 * first opened). Verbs as QUEST_VERBS: harvest (crop and fruit units), collect (animal products and fruit), make
 * (crafted units). State verbs (own) are read from the farm instead. Capped at the task's quantity.
 */
export function proofDeed(tx, verb, ref, n) {
  const proofs = tx.state.farm.proofs;
  if (!(n > 0) || !proofs) return;
  for (const exp of sortedKeys(proofs)) {
    const tasks = expansionOf(exp)?.proof ?? [];
    tasks.forEach((t, i) => {
      // a task's ref may be a list of alternatives ("Make 3 Cotton Tote or Wool Pillow", wave-2 QA RC-01)
      if (t.verb !== verb || !(Array.isArray(t.ref) ? t.ref.includes(ref) : t.ref === ref)) return;
      const have = proofs[exp].n[String(i)] ?? 0;
      if (have < t.qty) tx.set(['farm', 'proofs', exp, 'n', String(i)], Math.min(t.qty, have + n));
    });
  }
}

/**
 * Purchases carry `max`, the coin price the buyer saw (wave-1 QA RC-18; schema spec): above it the purchase answers
 * PRICE (soft) instead of charging more. Here (a leaf of the rules' import graph) so actions/decor.js and
 * actions/animals.js, which import each other, can both use it at module load.
 */
export const PRICE_SEEN = V.int(0, 1_000_000_000_000);
export const ERR_PRICE = ERR.PRICE;
