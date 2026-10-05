// Production buildings (GDD §3.3 Feed Mill, §3.5 rules 1-10, §6.2 #7 duets, §9 #5, #16, #36-#39): queue a
// recipe (inputs consumed at once), duet presses, cancel, collect finished goods from the trays (and the Compost
// Bin's Compost), slot upgrades. Owned by rules-economy.
//
// Building record: { def, x, z, rot, placedAt, by, slots, queue, made, qn?, joint?, pts?, ready?, paid?, rcpt? }
//   queue  [{ r, s, e, by, in, k?, slow?, duet?, pair? }] in order: s = max(now, previous e) at queueing,
//          e = s + time; an item with e <= now waits in the tray; `slots` caps queued + finished-uncollected items
//          (rule 1, tech §2.4). k = the item's stable key (from the building's counter `qn`, wave-1 QA RC-06): a
//          cancel names the item by k, never by its index, so a stale or simultaneous cancel cannot hit another
//          item. pair = [a, b] the two cooks of a duet item: the duet credit (Hearts, `duets`, the together deed)
//          is paid when the item is COLLECTED, once (RC-02), so a duet + cancel loop mints nothing.
//   in     the exact goods consumed (Feed Mill classes pick members), refunded in full by a cancel
//   made   goods collected so far: the rng key of the ★3 double-output roll
//   joint  { by, at, r } a pending duet press (tech §15.4); the partner's press within COOP.duet.windowMs completes
//
//   craft {id, recipe}            queue a recipe or feed (a duet recipe alone slow-cooks in 2 x time, normal XP)
//   duet {id, recipe}             "Cook together": first press waits, the OTHER player's press within 3 s starts it
//                                 at normal time and +25 % XP (both players, server time; never fails alone)
//   cancel {id, k}                a queued item (by its key k) that has not started: inputs back, later items
//                                 re-timed; NOT_FOUND when no item has that key (already cancelled or collected)
//   reorder {id, keys}            wave 4b (owner wish 5): the WAITING items (not started) in a new order, by key; the
//                                 running item stays first, every item keeps its own time and inputs, the chain is
//                                 re-timed from the running item's end (the total time never changes)
//   collectTray {id | ids}        finished goods into the Barn (paused at 2 x capacity: they wait in the tray)
//   upgradeSlot {id}              one more slot (coins only, applies at once)
import {
  defOf, lookup, recipeOf, feedOf, classMembers, recipesOf, itemOf, COOP, MARKET,
} from '../../content/index.js';
import { ERR, SOFT } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { objectOf } from '../grid.js';
import { sortedKeys } from '../order.js';
import {
  intake, consume, available, unkept, keptOf, stockOf, overflowOf, barnCap, mulBp, levelOf, starsOf, masteryEffects,
  startCutBp, cutMs, planBatch, targetsOf, oneTarget, MAX_BATCH, proofDeed, rewardSlots, playerPerk,
} from '../economy.js';
import { payCode, pay } from './decor.js';

const STROKE = { id: V.opt(V.objId), ids: V.opt(V.list(V.objId, MAX_BATCH)) };
const isBuilding = (o) => Boolean(o) && defOf(o.def)?.kind === 'building';
const rolled = (ctx, bp, ...keys) => bp > 0 && Math.floor(ctx.rng(...keys) * 10_000) < bp;

/** A LIVE recipe or feed by id (the schema takes any short text; this is the content check). */
export const recipeDef = (id) => lookup('recipes', id) ?? lookup('feeds', id);

/**
 * A feed never silently eats a class member worth more than this many times the feed's own V (wave-1 QA RC-17):
 * with no grain but Sunflowers in the Barn, Chicken Feed asks first (RESERVED, "Use 3 Sunflowers for feed?").
 */
export const FEED_VALUABLE_MUL = 10;

/**
 * The goods queueing `r` consumes now, or null when the Barn lacks them. Recipes take their fixed inputs (Keep N
 * needs no confirm for recipes, GDD §6.3). Feeds take ingredient CLASSES: the cheapest live member first, skipping
 * kept units, items marked "not for feed" (§3.3) and, unless `valuable`, members worth more than FEED_VALUABLE_MUL x
 * the feed's V, so a missing crop never blocks feeding and a valuable one is never burned without a confirm.
 */
export function inputsFor(state, r, { valuable = false } = {}) {
  if (r.inputs) {
    for (const [item, n] of Object.entries(r.inputs)) if (available(state, item) < n) return null;
    return { ...r.inputs };
  }
  return feedWalk(state, r, { valuable }).take;
}

/**
 * The class walk of a feed `r`, member by member: inputsFor's class branch IS this walk's `take`, so the Feed Mill panel
 * can say why "0/3 any grain" without a second copy of the rule (owner report 2026-10-04: 76 Wheat in the Barn, all
 * marked "not for feed"). Pure; it decides nothing on its own.
 * -> { take: { item: n } | null, classes: [{ cls, qty, short, members: [{ item, have, keep, free, take, why }] }] }
 *   have  units in the Barn + overflow; keep: its Keep N; free: units above Keep N not taken by an earlier class
 *   take  units this walk uses; short: units of the class still missing (0 = the class is covered)
 *   why   null (usable) | 'noFeed' (marked "not for feed") | 'valuable' (worth more than FEED_VALUABLE_MUL x the feed's
 *         value: only with a RESERVED confirm) | 'kept' (every unit is under Keep N) | 'none' (nothing left to take)
 */
export function feedWalk(state, r, { valuable = false } = {}) {
  const take = {};
  let short = false;
  const classes = r.classes.map(({ cls, qty }) => {
    let need = qty;
    const members = classMembers(cls).map((item) => {
      const free = Math.max(0, unkept(state, item) - (take[item] ?? 0));
      const row = { item, have: available(state, item), keep: keptOf(state, item).n, free, take: 0, why: null };
      if (state.farm.noFeed[item]) row.why = 'noFeed';
      else if (!valuable && (itemOf(item)?.sell ?? 0) > FEED_VALUABLE_MUL * (r.sell ?? 0)) row.why = 'valuable';
      else if (free <= 0) row.why = row.have > 0 && unkept(state, item) === 0 ? 'kept' : 'none';
      else if (need > 0) {
        row.take = Math.min(need, free);
        take[item] = (take[item] ?? 0) + row.take;
        need -= row.take;
      }
      return row;
    });
    if (need > 0) short = true;
    return { cls, qty, short: need, members };
  });
  return { take: short ? null : take, classes };
}

function queueCode(state, a) {
  const o = objectOf(state, a.id);
  if (!isBuilding(o)) return ERR.NOT_FOUND;
  const r = recipeDef(a.recipe);
  if (!r || r.building !== o.def) return ERR.BAD_ARGS;
  if (r.retired || levelOf(state) < r.unlock) return ERR.LOCKED;
  if (o.queue.length >= o.slots) return ERR.QUEUE_FULL;
  if (!inputsFor(state, r)) {
    // only valuable class members left: a soft "are you sure?" (the panel names them and their value)
    if (!r.inputs && inputsFor(state, r, { valuable: true })) return confirmed(a, ERR.RESERVED) ? null : ERR.RESERVED;
    return ERR.NO_ITEMS;
  }
  return null;
}

/** Append a queue item for `r` (inputs consumed now; time fixed now: mastery ★2, Golden Hour). */
function enqueue(tx, ctx, id, r, { slow = false, pair = null, valuable = false } = {}) {
  const o = tx.get(['farm', 'objects', id]);
  const take = inputsFor(tx.state, r) ?? (valuable ? inputsFor(tx.state, r, { valuable }) : null);
  for (const item of sortedKeys(take)) consume(tx, item, take[item]);
  const last = o.queue.at(-1);
  const s = Math.max(ctx.now, last ? last.e : ctx.now);
  // the queuer's Artisan perk: own queued items 5 % quicker (M2), a time cut like the others (50 % floor)
  const cut = startCutBp(tx.state, r.id, ctx.now) + playerPerk(tx.state, ctx.pid, 'artisan', 'queueTimeBp');
  const e = s + cutMs(r.ms * (slow ? 2 : 1), cut);
  const k = o.qn ?? 0;
  const q = { r: r.id, s, e, by: ctx.pid, in: take, k };
  if (slow) q.slow = true;
  if (pair) { q.duet = true; q.pair = pair; }
  const queue = [...o.queue, q];
  tx.set(['farm', 'objects', id, 'qn'], k + 1);
  tx.set(['farm', 'objects', id, 'queue'], queue);
  tx.del(['farm', 'objects', id, 'rcpt']);
  const ev = { e: 'queued', id, building: o.def, recipe: r.id, by: ctx.pid, endsAt: e, k };
  if (slow) ev.slow = true;
  if (pair) ev.duet = true;
  tx.emit(ev);
}

export const craft = {
  schema: { id: V.objId, recipe: V.text(32) },
  check(state, a) {
    return queueCode(state, a);
  },
  apply(tx, a, ctx) {
    const r = recipeDef(a.recipe);
    // alone, a duet recipe slow-cooks (2 x time); a confirmed RESERVED lets a feed use valuable members (RC-17)
    enqueue(tx, ctx, a.id, r, { slow: r.duet === true, valuable: confirmed(a, ERR.RESERVED) });
  },
};

/** True when `ctx.pid`'s press completes the partner's pending duet press for the same recipe. */
function completes(o, a, ctx) {
  const j = o.joint;
  return Boolean(j) && j.by !== ctx.pid && j.r === a.recipe && ctx.now - j.at <= COOP.duet.windowMs;
}

export const duet = {
  schema: { id: V.objId, recipe: V.text(32) },
  check(state, a) {
    const r = recipeDef(a.recipe);
    if (r && !r.duet) return ERR.BAD_ARGS;              // a normal recipe is queued with `craft`
    return queueCode(state, a);
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    if (completes(o, a, ctx)) {
      const partner = o.joint.by;
      tx.del(['farm', 'objects', a.id, 'joint']);
      // the `duet` celebration (Hearts, the Duet ribbon) waits for the collect: a cancel must not keep it (RC-02)
      enqueue(tx, ctx, a.id, recipeDef(a.recipe), { pair: [partner, ctx.pid] });
      return;
    }
    // first press, a press of the same player again, or the old press lapsed: (re)open the joint slot (§9 #36)
    tx.set(['farm', 'objects', a.id, 'joint'], { by: ctx.pid, at: ctx.now, r: a.recipe });
    tx.emit({ e: 'duetPressed', id: a.id, building: o.def, recipe: a.recipe, by: ctx.pid,
      until: ctx.now + COOP.duet.windowMs });
  },
};

/** Index of the queue item with key `k`, or -1 (items queued before keys existed have none: they just finish). */
export const queueIndexOf = (o, k) => o.queue.findIndex((q) => q.k === k);

export const cancel = {
  schema: { id: V.objId, k: V.int(0, 1_000_000_000) },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    if (!isBuilding(o)) return ERR.NOT_FOUND;
    const q = o.queue[queueIndexOf(o, a.k)];
    if (!q) return ERR.NOT_FOUND;                                      // already cancelled or collected
    if (q.s <= ctx.now) return ERR.ALREADY_DONE;                      // started: its inputs are in the pot (rule 3)
    return null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const index = queueIndexOf(o, a.k);
    const gone = o.queue[index];
    for (const item of sortedKeys(gone.in)) intake(tx, item, gone.in[item]);
    const queue = [];
    for (let i = 0; i < o.queue.length; i++) {
      if (i === index) continue;
      const q = o.queue[i];
      if (i < index) { queue.push(q); continue; }
      const prevE = queue.length ? queue.at(-1).e : ctx.now;
      const s = Math.max(ctx.now, prevE);
      queue.push({ ...q, s, e: s + (q.e - q.s) });
    }
    tx.set(['farm', 'objects', a.id, 'queue'], queue);
    tx.emit({ e: 'cancelled', id: a.id, building: o.def, recipe: gone.r, by: ctx.pid, k: a.k });
  },
};

/** Keys of building `o`'s waiting items (not started at `now`), in queue order (legacy items without a key: none). */
export const waitingKeys = (o, now) => o.queue.filter((q) => q.s > now && q.k !== undefined).map((q) => q.k);

/**
 * The waiting items' new order from `keys` (wave 4b): keys of items that started meanwhile (the partner's screen was a
 * moment behind) are dropped; any other unknown key, a waiting item left out, or no change refuses.
 * -> { order } | { code }
 */
function reorderPlan(o, keys, now) {
  const wait = waitingKeys(o, now);
  const inQueue = new Set(o.queue.map((q) => q.k));
  if (keys.some((k) => !inQueue.has(k))) return { code: ERR.NOT_FOUND };
  const order = keys.filter((k) => wait.includes(k));
  if (order.length !== wait.length) return { code: ERR.BAD_ARGS };
  if (order.every((k, i) => k === wait[i])) return { code: ERR.ALREADY_DONE };
  return { order };
}

export const reorder = {
  schema: { id: V.objId, keys: V.list(V.int(0, 1_000_000_000), 32) },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    if (!isBuilding(o)) return ERR.NOT_FOUND;
    return reorderPlan(o, a.keys, ctx.now).code ?? null;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const { order } = reorderPlan(o, a.keys, ctx.now);
    const byKey = new Map(o.queue.map((q) => [q.k, q]));
    const head = o.queue.filter((q) => !(q.s > ctx.now && q.k !== undefined));
    const queue = [...head];
    for (const k of order) {
      const q = byKey.get(k);
      const prevE = queue.length ? queue.at(-1).e : ctx.now;
      const s = Math.max(ctx.now, prevE);
      queue.push({ ...q, s, e: s + (q.e - q.s) });
    }
    tx.set(['farm', 'objects', a.id, 'queue'], queue);
    tx.emit({ e: 'reordered', id: a.id, building: o.def, keys: order, by: ctx.pid });
  },
};

// ---- collect from trays ------------------------------------------------------------------------------------------

/**
 * One finished queue item's output: out (x2 on the recipe ★3 chance, keyed by the building's `made`) and XP. M2 perks
 * of the item's MAKER (the player who queued it: their own production, GDD §4.7): Artisan 5 % double output; a duet
 * item rolls the better Artisan "second output" (10 %) of its two cooks.
 */
export function trayItemOf(state, o, q, made, ctx, id) {
  const r = recipeDef(q.r) ?? recipeOf(q.r) ?? feedOf(q.r);
  const fx = masteryEffects('recipes', starsOf(state, q.r));
  const double = rolled(ctx, fx.doubleBp, 'double', id, made)
    || (q.by !== 'sys' && rolled(ctx, playerPerk(state, q.by, 'artisan', 'doubleBp'), 'pdouble', id, made));
  const duetBp = Array.isArray(q.pair) ? Math.max(0, ...q.pair.map((p) => playerPerk(state, p, 'artisan',
    'duetSecondBp'))) : 0;
  const second = duetBp > 0 && rolled(ctx, duetBp, 'duet2', id, made);
  let xp = r.xp;
  if (q.duet) xp += mulBp(xp, COOP.duet.xpBonusBp);
  if (fx.xpBp) xp += mulBp(xp, fx.xpBp);

  return { item: r.id, qty: r.out * (double ? 2 : 1) + (second ? r.out : 0), double, xp };
}

function planCollect(state, a, ctx) {
  const room = mulBp(barnCap(state), MARKET.barn.overflowMulBp);
  let held = stockOf(state) + overflowOf(state);
  const how = {};
  const r = planBatch(targetsOf(a), (id) => {
    const o = objectOf(state, id);
    if (!isBuilding(o)) return ERR.NOT_FOUND;
    let n = 0;
    let full = false;
    for (const q of o.queue) {
      if (q.e > ctx.now + ctx.grace) break;
      if (held >= room) { full = true; break; }
      held += trayItemOf(state, o, q, o.made + n, ctx, id).qty;
      n++;
    }
    let compost = 0;
    if ((o.ready ?? 0) > 0) {
      if (held >= room) full = true;
      else { compost = o.ready; held += compost; }
    }
    if (n === 0 && compost === 0) return full ? ERR.STORAGE_FULL : ERR.NOT_READY;
    how[id] = { n, compost };
    return null;
  }, SOFT);
  return { ...r, how };
}

export const collectTray = {
  schema: STROKE,
  check(state, a, ctx) {
    if (!oneTarget(a)) return ERR.BAD_ARGS;
    return planCollect(state, a, ctx).code;
  },
  apply(tx, a, ctx) {
    const { ok, how } = planCollect(tx.state, a, ctx);
    for (const id of ok) {
      const o = tx.get(['farm', 'objects', id]);
      const { n, compost } = how[id];
      const firsts = new Set();
      for (let i = 0; i < n; i++) {
        const q = o.queue[i];
        const t = trayItemOf(tx.state, o, q, o.made + i, ctx, id);
        intake(tx, t.item, t.qty);
        proofDeed(tx, 'make', t.item, t.qty);
        const first = !firsts.has(q.r) && (tx.state.farm.mastery[q.r] ?? 0) === 0
          && !tx.state.farm.stats[`craft.${q.r}`];
        firsts.add(q.r);
        const ev = { e: 'crafted', id, building: o.def, recipe: q.r, item: t.item, qty: t.qty, by: ctx.pid, xp: t.xp,
          double: t.double, first, maker: q.by };
        if (q.duet) ev.duet = true;
        tx.emit(ev);
        // the duet credit is paid here, once per cooked item (RC-02); progress.js handles the celebration
        if (Array.isArray(q.pair)) {
          tx.emit({ e: 'duet', id, building: o.def, recipe: q.r, a: q.pair[0], b: q.pair[1], by: ctx.pid });
        }
      }
      if (n > 0) {
        tx.set(['farm', 'objects', id, 'queue'], o.queue.slice(n));
        tx.set(['farm', 'objects', id, 'made'], o.made + n);
      }
      if (compost > 0) {
        intake(tx, 'compost', compost);
        tx.set(['farm', 'objects', id, 'ready'], 0);
        tx.emit({ e: 'crafted', id, building: o.def, recipe: 'compost', item: 'compost', qty: compost, by: ctx.pid,
          xp: 0, double: false, first: false, maker: 'sys' });
      }
    }
  },
};

// ---- slots ----------------------------------------------------------------------------------------------------------

/**
 * Price of the next slot of building `o`, or null at the maximum (GDD §3.5 "Slot upgrade cost"). Reward slots (`xs`,
 * Grandma's duet table) are on top of the bought ones: they neither cost nor count toward the maximum.
 */
export function slotPrice(o) {
  const def = defOf(o.def);
  const xs = o.xs ?? 0;
  const k = o.slots - xs - def.slots[0];
  return o.slots - xs >= def.slots[1] || k >= def.slotCosts.length ? null : def.slotCosts[k];
}

/** The most slots building `o` can have (bought maximum + reward slots), for panels. */
export const slotMax = (o) => defOf(o.def).slots[1] + (o.xs ?? 0);

/**
 * Give every building of `buildingId` the reward slots it is owed now (economy.rewardSlots): +1 slot and `xs` each.
 * Called when a Restoration project completes; a building placed later gets them in decor.newObject.
 */
export function grantRewardSlots(tx, buildingId) {
  const want = rewardSlots(tx.state, buildingId);
  for (const id of sortedKeys(tx.state.farm.objects)) {
    const o = tx.state.farm.objects[id];
    if (o.def !== buildingId || (o.xs ?? 0) >= want) continue;
    const add = want - (o.xs ?? 0);
    tx.set(['farm', 'objects', id, 'slots'], o.slots + add);
    tx.set(['farm', 'objects', id, 'xs'], want);
    tx.emit({ e: 'slotGranted', id, def: o.def, slots: o.slots + add });
  }
}

export const upgradeSlot = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const o = objectOf(state, a.id);
    if (!isBuilding(o)) return ERR.NOT_FOUND;
    const p = slotPrice(o);
    if (p === null) return ERR.CAP;
    // a slot for nothing is a trap: the Compost Bin's queue opens with its first recipe (wave 4: Fertilizer, L10)
    if (!recipesOf(o.def).some((r) => r.unlock <= levelOf(state))) return ERR.LOCKED;
    return payCode(state, a, ctx, { coins: p, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const p = slotPrice(o);
    const slots = o.slots + 1;                            // read before the write (tx.get is live)
    pay(tx, ctx, { coins: p, acorns: 0 }, `slot:${o.def}`, o.def);
    tx.set(['farm', 'objects', a.id, 'slots'], slots);
    tx.del(['farm', 'objects', a.id, 'rcpt']);
    tx.emit({ e: 'slotUpgraded', id: a.id, def: o.def, slots, by: ctx.pid, coins: p });
  },
};
