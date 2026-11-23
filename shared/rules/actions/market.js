// The Market Stand and the General Store (GDD §3.6 "Sell surplus", §4.3 "Selling and buying", §4.10, §6.3 Keep N,
// §9 #6-#8, #15, #25). Prices are computed here from content and state; the client sends only item + quantity.
// Owned by rules-economy.
//
//   sell {item, qty}        V x mastery ★1 x season x Demand (+50 % on the day's two Demand items, first 50 units a
//                           day, farm-wide); selling below the item's Keep N asks RESERVED (who set it: keptOf)
//   sellSurplus {}          the 20 lowest-value sellable stacks above max(10, Keep N) are sold down to it, at the
//                           plain price (never the Demand bonus, which stays for a deliberate sale); the sale is
//                           remembered for 10 minutes in `farm.surplus` (GDD §3.6 preview and undo, RC-25)
//   undoSurplus {}          inside those 10 minutes, either player buys the whole sale back at the same prices: the
//                           goods return, the coins leave, and the coins stop counting as earned
//   storeBuy {item, qty}    emergency feed at its store price (2.5 x V); refused while anything is in overflow and
//                           when it would not fit the Barn (STORAGE_FULL: optional intake, tech §2.5)
import { itemOf, MARKET, SAFETY } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { dayIndex } from '../calendar.js';
import {
  available, consume, earn, intake, keptOf, saleOf, unitPrice, levelOf, stockOf, overflowOf, barnCap, ledger,
} from '../economy.js';
import { payCode, pay } from './decor.js';

/** RESERVED unless the sale leaves at least the Keep N (or the player confirmed). */
const keepCode = (state, a, item, qty) => (available(state, item) - qty < keptOf(state, item).n
  && !confirmed(a, ERR.RESERVED) ? ERR.RESERVED : null);

export const sell = {
  schema: { item: V.content('items'), qty: V.qty },
  check(state, a) {
    if (!itemOf(a.item).sellable) return ERR.LOCKED;
    if (available(state, a.item) < a.qty) return ERR.NO_ITEMS;
    return keepCode(state, a, a.item, a.qty);
  },
  apply(tx, a, ctx) {
    const sale = saleOf(tx.state, a.item, a.qty, ctx.now, ctx.pid);
    consume(tx, a.item, a.qty);
    if (sale.coins > 0) earn(tx, ctx, sale.coins, 'sell');
    if (sale.demand > 0) {
      const day = dayIndex(ctx.now, tx.state.meta.tz);
      const d = tx.state.farm.demand;
      const n = d.day === day ? { ...d.n } : {};
      n[a.item] = (n[a.item] ?? 0) + sale.demand;
      tx.set(['farm', 'demand'], { day, n });
    }
    tx.emit({ e: 'sold', item: a.item, qty: a.qty, coins: sale.coins, by: ctx.pid, demand: sale.demand });
  },
};

/**
 * What "Sell surplus" would sell now: [{ item, qty, coins }] for the MARKET.barn.surplusStacks lowest-value stacks
 * (unit price, then id) holding more than max(surplusKeep, Keep N). Pure: the banner previews with it.
 */
export function surplusOf(state, now) {
  const B = MARKET.barn;
  const items = new Set([...Object.keys(state.farm.inventory), ...Object.keys(state.farm.overflow)]);
  const rows = [];
  for (const item of [...items].sort()) {
    if (!itemOf(item)?.sellable) continue;
    const keep = Math.max(B.surplusKeep, keptOf(state, item).n);
    const qty = available(state, item) - keep;
    if (qty > 0) rows.push({ item, qty, unit: unitPrice(state, item, now) });
  }
  rows.sort((x, y) => x.unit - y.unit || (x.item < y.item ? -1 : 1));
  return rows.slice(0, B.surplusStacks).map((r) => ({ item: r.item, qty: r.qty, coins: r.unit * r.qty }));
}

export const sellSurplus = {
  schema: {},
  check(state, a, ctx) {
    return surplusOf(state, ctx.now).length ? null : ERR.NO_ITEMS;
  },
  apply(tx, a, ctx) {
    let coins = 0;
    const rows = surplusOf(tx.state, ctx.now);
    for (const row of rows) {
      consume(tx, row.item, row.qty);
      coins += row.coins;
      tx.emit({ e: 'sold', item: row.item, qty: row.qty, coins: row.coins, by: ctx.pid, demand: 0, surplus: true });
    }
    if (coins > 0) earn(tx, ctx, coins, 'sell:surplus');
    tx.set(['farm', 'surplus'], { at: ctx.now, until: ctx.now + SAFETY.undoMs, by: ctx.pid, coins, rows });
  },
};

/** Why the last "Sell surplus" cannot be undone now (null = it can). */
export function undoSurplusCode(state, now) {
  const u = state.farm.surplus;
  if (!u) return ERR.NOT_FOUND;
  if (now >= u.until) return ERR.NOT_REFUNDABLE;
  return state.farm.wallet.coins < u.coins ? ERR.NO_COINS : null;
}

export const undoSurplus = {
  schema: {},
  check(state, a, ctx) {
    return undoSurplusCode(state, ctx.now);
  },
  apply(tx, a, ctx) {
    const u = tx.get(['farm', 'surplus']);
    const { coins, rows } = u;                         // read before the delete
    if (coins > 0) {
      // the exact reverse of earn(): the sale never happened, so it is not "coins earned" (High Roller, §5.4)
      tx.inc(['farm', 'wallet', 'coins'], -coins);
      tx.inc(['farm', 'stats', 'coins.earned'], -coins, { dropZero: true });
      ledger(tx, ctx, -coins, 'undo:surplus');
    }
    for (const r of rows) {
      intake(tx, r.item, r.qty);
      tx.inc(['farm', 'stats', `sold.${r.item}`], -Math.min(r.qty, tx.state.farm.stats[`sold.${r.item}`] ?? 0),
        { dropZero: true });
    }
    tx.del(['farm', 'surplus']);
    tx.emit({ e: 'surplusUndone', coins, rows: rows.map((r) => ({ item: r.item, qty: r.qty })), by: ctx.pid });
  },
};

export const storeBuy = {
  schema: { item: V.content('items'), qty: V.qty },
  check(state, a, ctx) {
    const it = itemOf(a.item);
    if (!(it.storePrice > 0) || levelOf(state) < (it.unlock ?? 1)) return ERR.LOCKED;
    if (overflowOf(state) > 0 || stockOf(state) + a.qty > barnCap(state)) return ERR.STORAGE_FULL;
    return payCode(state, a, ctx, { coins: it.storePrice * a.qty, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const coins = itemOf(a.item).storePrice * a.qty;
    pay(tx, ctx, { coins, acorns: 0 }, `store:${a.item}`, a.item);
    intake(tx, a.item, a.qty);
    tx.emit({ e: 'purchased', item: a.item, qty: a.qty, coins, acorns: 0, by: ctx.pid });
  },
};
