// Mabel's Order Board: what the farm can make, and the order generator (GDD §5.1 G-VALID, §5.2, §9 #11-14).
// Owned by rules-goals. Pure functions of (state, now, rng): the system action `_orders` materialises the result
// into the state once (tech §4.5), so both clients and journal replay see the same order.
//
// farm.orders = {
//   n:        orders generated so far (the roll key: hash(farmSeed, 'order', n, ...), never cid/seq/now)
//   slots:    { [i]: { availableAt, order: null | Order, pin: null | pid, flag: null | pid } }
//   recent:   [[item, ...], ...]      the items of the last ORDERS.weights.recentWindow orders (newest last)
//   golden:   the last 6-hour block (blockOf) that produced a golden order; -1 = none yet
//   goldenN:  golden orders so far (every ORDERS.golden.duetEvery-th from L10 asks for a duet good)
//   rush:     { d, n }                instant refills used today (the first of a day is free)
//   meter:    null | { w, e, v, c }   Mabel's weekly meter: week, Monday's E, value filled, chests paid
// }
// Order = { n, items: { [item]: qty }, coins, xp, value, simple, golden: null | { giver, acorns, duet }, at }
//   value = the order's worth in "1.5 x V" coins (what Mabel's meter and the Couple Challenge count)
import {
  CONTENT, ORDERS, isLive, itemOf, cropOf, treeOf, animalOf, recipeOf, feedOf, levelFromXp, levelRow,
  plotCapOf, orderSlotsAt, classMembers,
} from '../content/index.js';
import { available } from './economy.js';
import { OBJ_VERSION, hide } from './grid-cache.js';
import { sortedKeys } from './order.js';
import { isAdult } from './actions/quests.js';
import { blockOf } from './coop.js';

const BP = 10_000;
const MIN = 60_000;

// ---- what the farm owns and can make (G-VALID) --------------------------------------------------------------

/** True when a tree object bears fruit at `now` (economy shape: a sapling has now < matureAt). */
export function treeMature(o, now) {
  return !Number.isSafeInteger(o.matureAt) || o.matureAt <= now;
}

const PRODUCERS = Symbol('hh.producers');

/**
 * A summary of the farm's producers: owned counts by def, adult animals by species, mature trees by species,
 * plots, the level and the plot cap. Cached on the state object per version of its objects (a Symbol, never
 * replicated), because the generator and the Goal Tracker ask many questions about one state. Read only.
 */
export function producers(state, now) {
  // cached per OBJ_VERSION, level and land, for the stretch of time in which no animal grows up and no tree starts
  // bearing (wave-2 QA RC-20: 79 ms of a stroke profile on a big farm)
  const v = state[OBJ_VERSION] ?? 0;
  const lvl = state.farm.xp;
  const land = state.farm.expansions.length;
  const c = state[PRODUCERS];
  if (c && c.v === v && c.objs === state.farm.objects && c.xp === lvl && c.land === land && now >= c.from
    && now < c.until) return c.val;
  const val = producersNow(state, now);
  let from = -Infinity;
  let until = Infinity;
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    for (const t of [o.adultAt, o.matureAt]) {
      if (!Number.isSafeInteger(t)) continue;
      if (t <= now) { if (t > from) from = t; } else if (t < until) until = t;
    }
  }
  hide(state, PRODUCERS, { v, objs, xp: lvl, land, from, until, val });
  return val;
}

function producersNow(state, now) {
  const objs = state.farm.objects;
  const owned = new Map();
  const adults = new Map();
  const animals = new Map();
  const mature = new Map();
  let plots = 0;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    owned.set(o.def, (owned.get(o.def) ?? 0) + 1);
    if (o.def === 'plot') plots++;
    else if (typeof o.home === 'string' && animalOf(o.def)) {
      animals.set(o.def, (animals.get(o.def) ?? 0) + 1);
      if (isAdult(o, now)) adults.set(o.def, (adults.get(o.def) ?? 0) + 1);
    } else {
      const t = treeOf(o.def);
      if (t && treeMature(o, now)) mature.set(o.def, (mature.get(o.def) ?? 0) + 1);
    }
  }
  const level = levelFromXp(state.farm.xp);
  const expansions = Math.max(0, state.farm.expansions.length - 1);
  return { owned, adults, animals, mature, plots, level, plotCap: plotCapOf(level, expansions) };
}

const unlocked = (def, level) => Boolean(def) && isLive(def) && (def.unlock ?? 1) <= level;

/**
 * Can the farm make `item` now, with the whole chain (GDD §5.1 G-VALID: Pancakes need cows, not just a Bakery)?
 * Goods in stock count as makeable inputs. `memo` is a Map shared across one generation.
 */
export function canMake(state, P, item, memo = new Map(), depth = 0) {
  if (memo.has(item)) return memo.get(item);
  memo.set(item, false);                                     // cycles (none in content) answer "no"
  const it = itemOf(item);
  let ok = false;
  if (it && isLive(it) && depth < 8) {
    switch (it.kind) {
      case 'crop': ok = P.plots > 0 && unlocked(cropOf(it.source), P.level); break;
      // a sapling is no producer: fruit needs a tree that bears now (G-VALID, wave-1 QA RC-12)
      case 'fruit': case 'wood': ok = (P.mature.get(it.source) ?? 0) > 0; break;
      case 'animal': {
        const a = animalOf(it.source);
        ok = Boolean(a) && (P.animals.get(a.id) ?? 0) > 0
          && (a.feed === null || hasOrCan(state, P, a.feed, memo, depth));
        break;
      }
      case 'craft': case 'consumable': {
        const r = recipeOf(it.source);
        if (r && unlocked(r, P.level) && (P.owned.get(r.building) ?? 0) > 0) {
          ok = Object.keys(r.inputs ?? {}).every((i) => hasOrCan(state, P, i, memo, depth));
        } else if (it.source === 'compost_bin') {
          ok = (P.owned.get('compost_bin') ?? 0) > 0 && P.animals.size > 0;
        }
        break;
      }
      case 'feed': {
        const f = feedOf(it.source);
        ok = Boolean(f) && unlocked(f, P.level) && (P.owned.get(f.building) ?? 0) > 0
          && f.classes.every(({ cls }) => classMembers(cls).some((m) => hasOrCan(state, P, m, memo, depth)));
        break;
      }
      default:
        ok = (P.owned.get(it.source) ?? 0) > 0;
    }
  }
  memo.set(item, ok);
  return ok;
}

function hasOrCan(state, P, item, memo, depth) {
  return available(state, item) > 0 || canMake(state, P, item, memo, depth + 1);
}

/** Minutes one unit of a crafted item occupies its building (one item at a time, v2 H2). */
const craftMinutes = (r) => Math.max(1, Math.round(r.ms / MIN));

/** The quantity cap of an item for one order (GDD §5.2 cap_i). */
export function capOf(P, item) {
  const it = itemOf(item);
  if (!it) return 0;
  const c = ORDERS.caps;
  switch (it.kind) {
    case 'crop': return Math.max(1, Math.floor(P.plotCap / c.plotShareDiv) * cropOf(it.source).yield);
    case 'fruit': return (P.mature.get(it.source) ?? 0) * treeOf(it.source).yield;
    case 'animal': {
      const a = animalOf(it.source);
      // the first evenings ask for one cycle of the adults the farm has (RC-08), later 90 minutes of them
      const perCycle = P.level <= ORDERS.early.level ? 1
        : Math.max(1, Math.floor(c.animalMinutes / Math.max(1, Math.round(a.cycleMs / MIN))));
      return Math.max(1, (P.adults.get(a.id) ?? 0) * perCycle * a.out);
    }
    case 'craft': {
      const r = recipeOf(it.source);
      return r ? r.out * Math.max(1, Math.floor(c.craftMinutes / craftMinutes(r))) : 1;
    }
    default: return 1;
  }
}

/**
 * What the producers the farm owns make of `item` in `capMs` (fruit: the mature trees, animal goods: the adults,
 * crafted goods: every building of the recipe's kind, one item at a time), at least 1. The Town Project's quantity
 * cap (wave-2 QA RC-02, like the barge's crates): an ask is never more than a few hours of what the farm owns.
 */
export function producerUnits(P, item, capMs) {
  const it = itemOf(item);
  const H = Math.floor(capMs / MIN);
  const cycles = (ms) => Math.max(1, Math.floor(H / Math.max(1, Math.round(ms / MIN))));
  if (!it) return 1;
  if (it.kind === 'fruit') {
    const t = treeOf(it.source);
    return Math.max(1, (P.mature.get(t.id) ?? 0) * t.yield * cycles(t.cycleMs));
  }
  if (it.kind === 'animal') {
    const a = animalOf(it.source);
    return Math.max(1, (P.adults.get(a.id) ?? 0) * a.out * cycles(a.cycleMs));
  }
  const r = recipeOf(it.source);
  if (!r) return 1;
  return Math.max(1, Math.max(1, P.owned.get(r.building) ?? 0) * (r.out ?? 1) * cycles(r.ms));
}

/** Direct inputs of an item (crafted goods only). */
const inputsOf = (item) => {
  const r = recipeOf(itemOf(item)?.source);
  return r && r.inputs ? Object.keys(r.inputs) : [];
};

/** Two items clash when they share a direct input or one is an input of the other (the Hay Day boat rule). */
function clash(a, b) {
  const ia = inputsOf(a);
  const ib = inputsOf(b);
  return ia.includes(b) || ib.includes(a) || ia.some((x) => ib.includes(x));
}

// ---- the board -------------------------------------------------------------------------------------------------

/** Items in open orders (Mabel's board and the townsfolk board, GDD §9 #14), with how many open orders hold each. */
export function openItems(state) {
  const out = new Map();
  const slots = state.farm.orders?.slots ?? {};
  for (const k of sortedKeys(slots)) {
    const o = slots[k].order;
    if (o) for (const item of sortedKeys(o.items)) out.set(item, (out.get(item) ?? 0) + 1);
  }
  const posts = state.farm.folk?.posts ?? {};
  for (const k of sortedKeys(posts)) {
    const p = posts[k];
    if (p && p.done === null) for (const item of sortedKeys(p.items)) out.set(item, (out.get(item) ?? 0) + 1);
  }
  return out;
}

/** True when every item of an order is in the Barn now. */
export function fillable(state, order) {
  return sortedKeys(order.items).every((i) => available(state, i) >= order.items[i]);
}

/**
 * The safety net test (GDD §5.2): can some open order be done soon: from stock, from crops <= 60 min (or crops
 * already growing in enough plots), from one <= 60-min building run with inputs in stock, or (animal goods) from
 * one <= 60-min cycle of the adults the farm has?
 */
export function someOrderEasy(state, P) {
  const slots = state.farm.orders?.slots ?? {};
  let open = 0;
  for (const k of sortedKeys(slots)) {
    const o = slots[k].order;
    if (!o) continue;
    open++;
    if (sortedKeys(o.items).every((i) => easyItem(state, P, i, o.items[i]))) return true;
  }
  // an empty board has nothing out of reach: the safety net is for a board FULL of hard orders
  return open === 0;
}

function easyItem(state, P, item, qty) {
  const have = available(state, item);
  if (have >= qty) return true;
  const it = itemOf(item);
  if (!it) return false;
  if (it.kind === 'crop') {
    const c = cropOf(it.source);
    if (c.growMs <= ORDERS.safety.sessionCropMin * MIN) return true;
    return growing(state, c.id) * c.yield + have >= qty;
  }
  if (it.kind === 'animal') {
    // hens lay every 20 minutes: animal goods of a <= 60-min cycle that the adults make in one cycle are "soon"
    const a = animalOf(it.source);
    return a.cycleMs <= ORDERS.safety.sessionCropMin * MIN && (P.adults.get(a.id) ?? 0) * a.out + have >= qty;
  }
  if (it.kind === 'craft') {
    const r = recipeOf(it.source);
    if (!r || (P.owned.get(r.building) ?? 0) === 0) return false;
    const runs = Math.ceil((qty - have) / r.out);
    if (runs * r.ms > ORDERS.safety.buildingRunMin * MIN) return false;
    return Object.keys(r.inputs ?? {}).every((i) => available(state, i) >= r.inputs[i] * runs);
  }
  return false;
}

function growing(state, crop) {
  let n = 0;
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) if (objs[id].crop && objs[id].crop.def === crop) n++;
  return n;
}

/** Orderable now at level L: live, unlock <= L - poolLag, never feed/consumables, T4 from t4From, duet never. */
function orderableNow(it, L) {
  if (!it || !isLive(it) || !it.orderable) return false;
  if ((it.unlock ?? 1) > L - ORDERS.poolLag) return false;
  if (it.kind === 'feed' || it.kind === 'consumable') return false;
  if (it.tier === 'duet') return false;
  if (it.tier === 'T4' && L < ORDERS.t4From) return false;
  return true;
}

/** A session crop of the first evenings (RC-08): short enough to plant and harvest inside the evening. */
const earlyCrop = (it, L) => L <= ORDERS.early.level && it.kind === 'crop'
  && cropOf(it.source).growMs <= ORDERS.early.cropMin * MIN;

/**
 * Generate the next order. `rng(...keys)` is ctx.rng; every key starts with the order number `n`, a farm counter
 * the server orders (review-m0 #2). Pure in (state, now, n). `slot` = the board slot it is for: the quick slot
 * (ORDERS.quick, RC-19) is sized from the first budget band and a short machine time at every level.
 * @returns {object | null} Order, or null when nothing valid can be asked for now (the slot retries later)
 */
export function generateOrder(state, now, rng, { slot = null } = {}) {
  const ob = state.farm.orders;
  const n = ob.n;
  const P = producers(state, now);
  const L = P.level;
  // the scripted first order of the tutorial (GDD §7.4: "Mabel's first order, scripted: 8 Wheat"); never golden,
  // so the 6-hour block's golden order is the next one
  if (n === 0 && ORDERS.first) {
    return finish({ n, items: { ...ORDERS.first.items }, r: ORDERS.first.coinShareBp, simple: false, golden: null,
      now, payBp: ORDERS.payBp });
  }
  const golden = blockOf(state, now) > ob.golden ? goldenOf(state, P, rng, n) : null;
  const r = ORDERS.coinShareBp[Math.floor(rng('order', n, 'r') * ORDERS.coinShareBp.length)];
  const memo = new Map();
  const open = openItems(state);

  // golden duet order (v2, M6): one golden order in three from L10 asks for one duet good at 2.0 x V
  if (golden && golden.duet) {
    const duet = CONTENT.items.get(golden.duet);
    return finish({ n, items: { [duet.id]: 1 }, r, simple: false, golden, now, payBp: ORDERS.golden.duetPayBp });
  }

  if (!someOrderEasy(state, P)) {
    const simple = simpleOrder(state, P, rng, n, open);
    if (simple) return finish({ n, items: simple, r, simple: true, golden, now, payBp: ORDERS.payBp });
  }

  const quick = slot === ORDERS.quick.slot;
  const quickReady = quick && Number.isSafeInteger(ORDERS.quick.readyMinutes);
  const band = quick ? ORDERS.budget[0] : [...ORDERS.budget].reverse().find(([from]) => L >= from) ?? ORDERS.budget[0];
  const f = band[1] + Math.floor(rng('order', n, 'f') * (band[2] - band[1] + 1));
  const budget = Math.max(1, Math.floor((levelRow(L).E * f) / BP));
  const kMax = Math.min(ORDERS.maxTypes, 1 + Math.floor(L / ORDERS.typesEvery));
  const k = 1 + Math.floor(rng('order', n, 'k') * kMax);

  const recent = new Map();
  for (const items of ob.recent) for (const i of items) recent.set(i, (recent.get(i) ?? 0) + 1);
  const delivered = state.farm.stats;
  const share = Math.max(1, Math.floor(budget / k));
  // the first evenings: while no open order asks for a crop, this one does (RC-08)
  const cropDue = L <= ORDERS.early.level && ![...open.keys()].some((i) => itemOf(i)?.kind === 'crop');
  let pool = [];
  for (const it of CONTENT.items.values()) {
    if (!orderableNow(it, L)) continue;
    if ((open.get(it.id) ?? 0) >= ORDERS.maxOpenPerItem) continue;
    if (!(available(state, it.id) > 0 || canMake(state, P, it.id, memo))) continue;
    const cap = capOf(P, it.id);
    // worth < 25 % of its budget share: left out, except a session crop of the first evenings (RC-08) and, in the
    // quick slot, anything ready within its wait (a small order is the point of that slot, RC-01)
    const quickFast = quickReady && readyWithin(state, it.id, ORDERS.quick.readyMinutes);
    if (!earlyCrop(it, L) && !quickFast && cap * it.sell * BP < share * ORDERS.minCapShareBp) continue;
    const W = ORDERS.weights;
    // weight in basis points: 1 / (1 + recent) x inStock x crafted x neverDelivered
    let w = Math.floor(BP / (1 + (recent.get(it.id) ?? 0)));
    if (available(state, it.id) >= 1) w = Math.floor((w * W.inStockBp) / BP);
    if (it.kind === 'craft' && L >= W.craftedFrom) w = Math.floor((w * W.craftedBp) / BP);
    if (!(delivered[`delivered.${it.id}`] > 0)) w = Math.floor((w * W.neverDeliveredBp) / BP);
    pool.push({ id: it.id, w: Math.max(1, w), cap, v: it.sell, kind: it.kind, early: earlyCrop(it, L) });
  }
  // the quick slot asks only for goods the farm can have ready within the wait (wave-2 RC-01, content opt-in:
  // ORDERS.quick.readyMinutes): in the Barn, a crop that grows that fast, an animal good of a cycle that short, or a
  // craft whose run fits it (its inputs in the Barn)
  if (quickReady) {
    const fast = pool.filter((p) => readyWithin(state, p.id, ORDERS.quick.readyMinutes));
    if (fast.length > 0) pool = fast;
  }
  if (cropDue && pool.some((p) => p.early)) pool = pool.filter((p) => p.early);
  const picked = [];
  for (let j = 0; j < k && pool.length > 0; j++) {
    const ok = pool.filter((p) => !picked.some((q) => q.id === p.id || (ORDERS.noSharedInputs && clash(p.id, q.id))));
    if (ok.length === 0) break;
    const total = ok.reduce((s, p) => s + p.w, 0);
    let x = Math.floor(rng('order', n, 'pick', j) * total);
    let chosen = ok[ok.length - 1];
    for (const p of ok) { if (x < p.w) { chosen = p; break; } x -= p.w; }
    picked.push(chosen);
  }
  if (picked.length === 0) {
    // nothing the farm can make fits an order right now (e.g. L2: only Wheat, already in two orders): the safety
    // net's simple order, or no order at all: the slot waits another refill period ("a new order is on its way")
    const simple = simpleOrder(state, P, rng, n, open);
    return simple ? finish({ n, items: simple, r, simple: true, golden, now, payBp: ORDERS.payBp }) : null;
  }
  const items = {};
  for (const p of picked) items[p.id] = Math.min(p.cap, Math.max(1, Math.floor((share + Math.floor(p.v / 2)) / p.v)));
  limitMachineMinutes(items, quick ? ORDERS.quick.machineMinutes : ORDERS.caps.orderMachineMinutes);
  return finish({ n, items, r, simple: false, golden, now, payBp: ORDERS.payBp });
}

/**
 * Goods for a request built by the order rules (GDD §5.3 townsfolk board: G-VALID, the novelty weight, never two
 * goods sharing a direct input, at most `machineMinutes` of crafting, items already in two open orders left out):
 * `k` types worth about `budget` coins of V in total. `rng(...)` keys start with `key` (a replicated counter).
 * @returns {{ [item]: number } | null}
 */
export function chooseGoods(state, now, rng, key, { budget, k, machineMinutes }) {
  const P = producers(state, now);
  const L = P.level;
  const memo = new Map();
  const open = openItems(state);
  const recent = new Map();
  for (const items of state.farm.orders?.recent ?? []) for (const i of items) recent.set(i, (recent.get(i) ?? 0) + 1);
  const share = Math.max(1, Math.floor(budget / k));
  const W = ORDERS.weights;
  const pool = [];
  for (const it of CONTENT.items.values()) {
    if (!orderableNow(it, L) || (open.get(it.id) ?? 0) >= ORDERS.maxOpenPerItem) continue;
    if (!(available(state, it.id) > 0 || canMake(state, P, it.id, memo))) continue;
    // a crafted good may fill the request's whole machine time (the board's cap is one building's 45 minutes)
    const r = it.kind === 'craft' ? recipeOf(it.source) : null;
    const cap = r ? r.out * Math.max(1, Math.floor(machineMinutes / craftMinutes(r))) : capOf(P, it.id);
    if (cap * it.sell * BP < share * ORDERS.minCapShareBp) continue;
    let w = Math.floor(BP / (1 + (recent.get(it.id) ?? 0)));
    if (it.kind === 'craft' && L >= W.craftedFrom) w = Math.floor((w * W.craftedBp) / BP);
    if (!(state.farm.stats[`delivered.${it.id}`] > 0)) w = Math.floor((w * W.neverDeliveredBp) / BP);
    pool.push({ id: it.id, w: Math.max(1, w), cap, v: it.sell });
  }
  const picked = [];
  for (let j = 0; j < k && pool.length > 0; j++) {
    const ok = pool.filter((p) => !picked.some((q) => q.id === p.id || clash(p.id, q.id)));
    if (ok.length === 0) break;
    const total = ok.reduce((s, p) => s + p.w, 0);
    let x = Math.floor(rng(...key, 'pick', j) * total);
    let chosen = ok[ok.length - 1];
    for (const p of ok) { if (x < p.w) { chosen = p; break; } x -= p.w; }
    picked.push(chosen);
  }
  if (picked.length === 0) return null;
  const items = {};
  for (const p of picked) items[p.id] = Math.min(p.cap, Math.max(1, Math.floor((share + Math.floor(p.v / 2)) / p.v)));
  limitMachineMinutes(items, machineMinutes);
  return items;
}

/** True when a unit of `item` can be in the Barn within `minutes` (the quick slot, RC-01). */
export function readyWithin(state, item, minutes) {
  if (available(state, item) > 0) return true;
  const it = itemOf(item);
  if (!it) return false;
  const ms = minutes * MIN;
  if (it.kind === 'crop') return cropOf(it.source).growMs <= ms;
  if (it.kind === 'animal') return animalOf(it.source).cycleMs <= ms;
  if (it.kind === 'craft') {
    const r = recipeOf(it.source);
    return Boolean(r) && r.ms <= ms && Object.keys(r.inputs ?? {}).every((i) => available(state, i) >= r.inputs[i]);
  }
  return false;
}

/** The refill delay of a board slot: the quick slot may refill sooner (ORDERS.quick.refillMs, RC-01). */
export const refillMsOf = (slot) => (slot === ORDERS.quick.slot && Number.isSafeInteger(ORDERS.quick.refillMs)
  ? ORDERS.quick.refillMs : ORDERS.refillMs);

/** One order holds at most `max` machine-minutes of crafting: trim the biggest crafted line first. */
function limitMachineMinutes(items, max) {
  const minutes = () => sortedKeys(items).reduce((s, i) => {
    const r = recipeOf(itemOf(i).source);
    return r && itemOf(i).kind === 'craft' ? s + Math.ceil(items[i] / r.out) * craftMinutes(r) : s;
  }, 0);
  for (let guard = 0; guard < 400 && minutes() > max; guard++) {
    let worst = null;
    for (const i of sortedKeys(items)) {
      const r = recipeOf(itemOf(i).source);
      if (!r || itemOf(i).kind !== 'craft' || items[i] <= 1) continue;
      const m = Math.ceil(items[i] / r.out) * craftMinutes(r);
      if (!worst || m > worst.m) worst = { i, m };
    }
    if (!worst) break;
    items[worst.i] -= 1;
  }
}

/** The simple order of the safety net: one good in stock (preferred) or one crop of at most simpleCropMin. */
function simpleOrder(state, P, rng, n, open) {
  const L = P.level;
  const stock = [];
  for (const id of sortedKeys(state.farm.inventory)) {
    const it = itemOf(id);
    if (orderableNow(it, L) && (open.get(id) ?? 0) < ORDERS.maxOpenPerItem && available(state, id) > 0) stock.push(id);
  }
  if (stock.length > 0) {
    const id = stock[Math.floor(rng('order', n, 'simple') * stock.length)];
    return { [id]: Math.max(1, Math.min(available(state, id), capOf(P, id))) };
  }
  const crops = [];
  for (const c of CONTENT.crops.values()) {
    // the safety net may ask for a crop unlocked this very level (no pool lag): it is always plantable now
    if (unlocked(c, L) && c.growMs <= ORDERS.safety.simpleCropMin * MIN
      && orderableNow(itemOf(c.id), L + ORDERS.poolLag)
      && (open.get(c.id) ?? 0) < ORDERS.maxOpenPerItem) crops.push(c);
  }
  if (crops.length === 0) return null;
  const c = crops[Math.floor(rng('order', n, 'simple') * crops.length)];
  return { [c.id]: Math.max(1, Math.min(Math.floor(P.plotCap / 2), capOf(P, c.id))) };
}

/** Golden order details (GDD §5.2): a named townsperson; from L10 every 3rd golden one asks for a duet good. */
function goldenOf(state, P, rng, n) {
  const L = P.level;
  const givers = [...CONTENT.npcs.values()].filter((x) => isLive(x) && x.townsfolk && (x.from ?? 1) <= L);
  const giver = givers.length ? givers[Math.floor(rng('order', n, 'giver') * givers.length)].id : 'mabel';
  let duet = null;
  const g = ORDERS.golden;
  if (L >= g.duetFrom && (state.farm.orders.goldenN + 1) % g.duetEvery === 0) {
    const memo = new Map();
    // at most one duet order open at a time, and a duet good respects maxOpenPerItem like any item (wave-2 QA
    // RC-05: two "Sweetheart Cake" orders and a third request for it sat on the board at once)
    const open = openItems(state);
    const duetOpen = [...open.keys()].some((i) => itemOf(i)?.tier === 'duet');
    const duets = duetOpen ? [] : [...CONTENT.items.values()].filter((it) => it.tier === 'duet' && isLive(it)
      && (it.unlock ?? 1) <= L && (open.get(it.id) ?? 0) < ORDERS.maxOpenPerItem && canMake(state, P, it.id, memo));
    if (duets.length) duet = duets[Math.floor(rng('order', n, 'duet') * duets.length)].id;
  }
  return { giver, acorns: g.acorns, duet };
}

function finish({ n, items, r, simple, golden, now, payBp }) {
  let v = 0;
  for (const i of sortedKeys(items)) v += itemOf(i).sell * items[i];
  const worth = Math.floor((v * payBp) / BP);                       // 1.5 x V (2.0 x V for a duet golden)
  const coins = Math.max(1, Math.floor((worth * r) / BP));
  const xp = Math.max(1, Math.floor((worth * (BP - r)) / BP / ORDERS.xpDiv));
  return { n, items, coins, xp, value: worth, simple, golden: golden ? { giver: golden.giver, acorns: golden.acorns,
    duet: Boolean(golden.duet) } : null, at: now };
}

/** Slots the board should have now (0 before L2). */
export const slotsWanted = (state) => orderSlotsAt(levelFromXp(state.farm.xp));

/** An open order that holds an item no longer live (a content change) is replaced (G-VALID on boot). */
export const staleOrder = (o) => Boolean(o) && sortedKeys(o.items).some((i) => !itemOf(i) || !isLive(itemOf(i)));

