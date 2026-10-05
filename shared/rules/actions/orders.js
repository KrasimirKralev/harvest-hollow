// Mabel's Order Board actions (GDD §5.2, §6.2 #3, §6.3, §9 #11-14, #19). Owned by rules-goals. The generator is
// shared/rules/orders-board.js; `_orders` (system.js) materialises orders into the slots.
//
//   orderFill    { slot, n }  hand in every item at once (no partial delivery); pays 1.5 x V as coins + XP (+1 % coins
//                              per Farm Beauty star, max +5 %), a golden order +1 Acorn; filling the OTHER player's
//                              help flag: +10 % XP and +1 Heart each
//   orderDiscard { slot, n }  the slot refills in ORDERS.refillMs (the quick slot: ORDERS.quick.refillMs when set); a
//                             partner's "I'm on it" pin asks a soft confirm
//   orderPin     { slot, n }  toggle "I'm on it" (display only, never blocks the partner)
//   orderFlag    { slot, n }  toggle "Need help"
//   `n` is the order's own number (order.n, the order the player SAW): a stale or simultaneous intent whose order
//   was filled or discarded meanwhile answers NOT_FOUND ("Mia got there first") instead of filling, discarding or
//   pinning the NEW order in that slot (wave-1 QA RC-07). An empty slot answers EMPTY.
//   orderRush    { slot }   refill a waiting slot now: the first of a farm day is free, later ones cost 1 Acorn
// Kept goods (Keep N) need no confirm when used for an order (GDD §6.3).
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { ORDERS, COOP, itemOf } from '../../content/index.js';
import { available, consume, earn, proofDeed } from '../economy.js';
import { sortedKeys } from '../order.js';
import { dayOf } from '../coop.js';
import { fillable, refillMsOf } from '../orders-board.js';
import { beautyOrderBp } from './beauty.js';


const SLOT = V.int(0, 15);
const N = V.int(0, 1_000_000_000);

function slotOf(state, slot) {
  const s = state.farm.orders?.slots?.[String(slot)];
  return s ?? null;
}

/** null when slot `a.slot` holds the order `a.n` the player acted on; EMPTY / NOT_FOUND otherwise. */
function orderCode(state, a) {
  const s = slotOf(state, a.slot);
  if (!s) return ERR.NOT_FOUND;
  if (!s.order) return ERR.EMPTY;
  return s.order.n === a.n ? null : ERR.NOT_FOUND;
}

export const orderFill = {
  schema: { slot: SLOT, n: N },
  check(state, a) {
    const code = orderCode(state, a);
    if (code) return code;
    return fillable(state, slotOf(state, a.slot).order) ? null : ERR.NO_ITEMS;
  },
  apply(tx, a, ctx) {
    const key = String(a.slot);
    const s = tx.get(['farm', 'orders', 'slots', key]);
    const o = s.order;
    for (const item of sortedKeys(o.items)) consume(tx, item, o.items[item]);
    const helped = typeof s.flag === 'string' && s.flag !== ctx.pid;
    const xp = helped ? o.xp + Math.floor((o.xp * COOP.helpFlags.xpBonusBp) / 10_000) : o.xp;
    // Farm Beauty: +1 % order coins per star the farm holds now, at most +5 % (GDD §5.9; rules-economy's beauty.js)
    const coins = o.coins + Math.floor((o.coins * beautyOrderBp(tx.state, ctx.now)) / 10_000);
    earn(tx, ctx, coins, 'order');
    const acorns = o.golden ? o.golden.acorns : 0;
    if (acorns > 0) tx.inc(['farm', 'wallet', 'acorns'], acorns);
    tx.set(['farm', 'orders', 'slots', key], { availableAt: ctx.now + refillMsOf(a.slot), order: null, pin: null,
      flag: null });
    const value = o.simple ? Math.floor(o.value / 4) : o.value;       // simple orders count 1/4 (R15)
    // every filled order counts toward a land card's "fill N orders" proof, simple ones too (wave-2 QA RC-01, D2)
    proofDeed(tx, 'fill', 'order', 1);
    // XP, Hearts, stats, Mabel's meter, the feed and every goal are credited from this event (progress.js)
    tx.emit({ e: 'orderFilled', slot: a.slot, n: o.n, coins, xp, acorns, golden: Boolean(o.golden),
      giver: o.golden ? o.golden.giver : null, simple: o.simple, helped: helped ? s.flag : null, value,
      items: { ...o.items }, by: ctx.pid });
  },
};

export const orderDiscard = {
  schema: { slot: SLOT, n: N },
  check(state, a, ctx) {
    const code = orderCode(state, a);
    if (code) return code;
    const s = slotOf(state, a.slot);
    if (typeof s.pin === 'string' && s.pin !== ctx.pid && !confirmed(a, ERR.PINNED)) return ERR.PINNED;
    return null;
  },
  apply(tx, a, ctx) {
    const key = String(a.slot);
    const n = tx.get(['farm', 'orders', 'slots', key]).order.n;
    tx.set(['farm', 'orders', 'slots', key], { availableAt: ctx.now + refillMsOf(a.slot), order: null, pin: null,
      flag: null });
    tx.emit({ e: 'orderGone', slot: a.slot, n, by: ctx.pid });
  },
};

export const orderPin = {
  schema: { slot: SLOT, n: N },
  check(state, a, ctx) {
    const code = orderCode(state, a);
    if (code) return code;
    const s = slotOf(state, a.slot);
    return typeof s.pin === 'string' && s.pin !== ctx.pid ? ERR.OCCUPIED : null;
  },
  apply(tx, a, ctx) {
    const key = String(a.slot);
    const pin = tx.get(['farm', 'orders', 'slots', key, 'pin']) === ctx.pid ? null : ctx.pid;
    tx.set(['farm', 'orders', 'slots', key, 'pin'], pin);
    tx.emit({ e: 'orderPinned', slot: a.slot, pin, by: ctx.pid });
  },
};

export const orderFlag = {
  schema: { slot: SLOT, n: N },
  check(state, a, ctx) {
    const code = orderCode(state, a);
    if (code) return code;
    const s = slotOf(state, a.slot);
    return typeof s.flag === 'string' && s.flag !== ctx.pid ? ERR.OCCUPIED : null;
  },
  apply(tx, a, ctx) {
    const key = String(a.slot);
    const flag = tx.get(['farm', 'orders', 'slots', key, 'flag']) === ctx.pid ? null : ctx.pid;
    tx.set(['farm', 'orders', 'slots', key, 'flag'], flag);
    tx.emit({ e: 'orderFlagged', slot: a.slot, flag, by: ctx.pid });
  },
};

/** Acorns an instant refill costs now (0 for the farm's first of the day). */
export function rushPrice(state, now) {
  const r = state.farm.orders?.rush;
  const used = r && r.d === dayOf(state, now) ? r.n : 0;
  return used < ORDERS.freeRefillsPerDay ? 0 : ORDERS.refillAcorns;
}

export const orderRush = {
  schema: { slot: SLOT },
  check(state, a, ctx) {
    const s = slotOf(state, a.slot);
    if (!s) return ERR.NOT_FOUND;
    if (s.order || s.availableAt <= ctx.now) return ERR.ALREADY_DONE;
    return state.farm.wallet.acorns < rushPrice(state, ctx.now) ? ERR.NO_ACORNS : null;
  },
  apply(tx, a, ctx) {
    const acorns = rushPrice(tx.state, ctx.now);
    const day = dayOf(tx.state, ctx.now);
    const r = tx.get(['farm', 'orders', 'rush']);
    tx.set(['farm', 'orders', 'rush'], { d: day, n: r && r.d === day ? r.n + 1 : 1 });
    if (acorns > 0) tx.inc(['farm', 'wallet', 'acorns'], -acorns);
    tx.set(['farm', 'orders', 'slots', String(a.slot), 'availableAt'], ctx.now);
    tx.emit({ e: 'orderRushed', slot: a.slot, acorns, by: ctx.pid });
  },
};

/** Units of each item an order still needs beyond the Barn (the UI's "need 3 more Bread"). */
export function orderShortfall(state, order) {
  const out = {};
  for (const item of sortedKeys(order.items)) {
    const short = order.items[item] - available(state, item);
    if (short > 0 && itemOf(item)) out[item] = short;
  }
  return out;
}
