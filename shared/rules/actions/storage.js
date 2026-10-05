// The Barn and the farm's shared-money safety nets (GDD §3.6 Barn upgrades, §3.3 "not for feed", §6.3 Keep N and
// the Wishlist, §9 #15, #17). Owned by rules-economy.
//
//   upgradeBarn {}               the next Barn upgrade: level, coins, Planks and Wooden Crates; overflow refills
//   keep {item, n}               the farm-wide "keep at least n" (n 0 clears it; Wood's default keep is 20)
//   noFeed {item, on}            keep an ingredient out of the Feed Mill's class picks
//   wish {def}                   add a shop object (decor, building, home; not trees or plots, whose n-th-copy prices
//                                depend on what is placed) to the Wishlist (L9, at most SAFETY.wishlist.maxWishes)
//   wishDeposit {id, coins}      move coins from the treasury onto a wish: they are no longer spendable; when the
//                                wish holds its price it buys itself into the build tray (both screens celebrate)
//   wishWithdraw {id, coins?}    your own wish: coins back at once; the partner's wish: asks them (release request)
//   wishAnswer {id, ok}          the wish's owner answers a release request
//   unwish {id}                  remove your own wish (its coins return)
//   _wishRelease {}              system: a release request unanswered for SAFETY.wishlist.autoReleaseMs is granted
//
// Wishlist state: farm.wishlist[id] = { def, coins, by, at, release?: { by, at } }. Ledger invariant (economy.js):
// wallet.coins + Σ wish.coins == START.coins + earned + granted + refunded - spent.
import { CONTENT, defOf, itemOf, isLive, levelFromXp, SAFETY } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { sortedKeys } from '../order.js';
import { available, consume, normalize, keptOf, wishMove, stash, isBigSpend } from '../economy.js';
import { buyPrice, payCode, pay } from './decor.js';

const PLANKS = 'planks';
const CRATES = 'wooden_crate';

/** The next Barn upgrade row, or null when none is live. */
export function nextBarnUpgrade(state) {
  const row = CONTENT.barn[state.farm.barn];
  return row && isLive(row) ? row : null;
}

export const upgradeBarn = {
  schema: {},
  check(state, a, ctx) {
    const row = nextBarnUpgrade(state);
    if (!row) return ERR.CAP;
    if (levelFromXp(state.farm.xp) < row.unlock) return ERR.LOCKED;
    if (available(state, PLANKS) < row.planks || available(state, CRATES) < row.crates) return ERR.NO_ITEMS;
    return payCode(state, a, ctx, { coins: row.cost, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const row = nextBarnUpgrade(tx.state);
    pay(tx, ctx, { coins: row.cost, acorns: 0 }, 'barn', 'barn');
    if (row.planks > 0) consume(tx, PLANKS, row.planks);
    if (row.crates > 0) consume(tx, CRATES, row.crates);
    tx.set(['farm', 'barn'], row.n);
    normalize(tx);                                     // the overflow pile moves in
    tx.emit({ e: 'barnUpgraded', n: row.n, capacity: row.capacity, by: ctx.pid, coins: row.cost });
  },
};

export const keep = {
  schema: { item: V.content('items'), n: V.int(0, SAFETY.keep.max) },
  check(state, a) {
    return keptOf(state, a.item).n === a.n ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    // an explicit entry is kept whenever it differs from the content default (so 0 can un-keep Wood)
    if (a.n === 0 && !(itemOf(a.item).keepDefault > 0)) tx.del(['farm', 'keep', a.item]);
    else tx.set(['farm', 'keep', a.item], { n: a.n, by: ctx.pid });
    tx.emit({ e: 'keepSet', item: a.item, n: a.n, by: ctx.pid });
  },
};

const FEED_CLASSES = new Set(['grain', 'root', 'produce']);

export const noFeed = {
  schema: { item: V.content('items'), on: V.bool },
  check(state, a) {
    if (!itemOf(a.item).classes.some((c) => FEED_CLASSES.has(c))) return ERR.BAD_ARGS;
    return Boolean(state.farm.noFeed[a.item]) === a.on ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    if (a.on) tx.set(['farm', 'noFeed', a.item], true);
    else tx.del(['farm', 'noFeed', a.item]);
    tx.emit({ e: 'noFeedSet', item: a.item, on: a.on, by: ctx.pid });
  },
};

// ---- Wishlist --------------------------------------------------------------------------------------------------

const wishOf = (state, id) => (typeof id === 'string' && Object.hasOwn(state.farm.wishlist, id)
  ? state.farm.wishlist[id] : null);

/** Can `def` go on the Wishlist: a live coin-priced shop object (animals need a home: bought in the shop). */
function wishable(def) {
  // trees and plots have n-th-copy prices that depend on what is placed: a tray copy would skew them
  return def && def.shop === true && !def.retired && def.layer !== 'none' && !(def.acorns > 0)
    && def.kind !== 'tree' && def.kind !== 'plot';
}

/** When a wish holds its price (and the object is buyable now), buy it into the build tray. */
function tryBuy(tx, ctx, id) {
  const { def, coins, by } = tx.get(['farm', 'wishlist', id]);
  const price = buyPrice(tx.state, def);
  if (price.code || coins < price.coins) return;
  const left = coins - price.coins;
  if (left > 0) wishMove(tx, ctx, id, -left);
  if (price.coins > 0) tx.inc(['farm', 'stats', 'coins.spent'], price.coins, { dropZero: true });
  tx.del(['farm', 'wishlist', id]);
  stash(tx, def, 1);
  if (price.coins > 0) tx.inc(['farm', 'storagePaid', def], 1, { dropZero: true });
  tx.emit({ e: 'wishBought', id, def, coins: price.coins, by });
}

export const wish = {
  schema: { def: V.content('placeables') },
  check(state, a, ctx) {
    if (levelFromXp(state.farm.xp) < SAFETY.wishlist.unlock) return ERR.LOCKED;
    if (!wishable(defOf(a.def))) return ERR.BAD_ARGS;
    // only what the shop sells right now (unlocked, under its cap): a funded wish then always buys itself
    const price = buyPrice(state, a.def);
    if (price.code) return price.code;
    if (Object.keys(state.farm.wishlist).length >= SAFETY.wishlist.maxWishes) return ERR.CAP;
    if (wishOf(state, ctx.newId(0))) return ERR.ID_TAKEN;
    return null;
  },
  apply(tx, a, ctx) {
    const id = ctx.newId(0);
    tx.set(['farm', 'wishlist', id], { def: a.def, coins: 0, by: ctx.pid, at: ctx.now });
    tx.emit({ e: 'wishAdded', id, def: a.def, by: ctx.pid });
  },
};

export const wishDeposit = {
  schema: { id: V.objId, coins: V.int(1, 100_000_000) },
  check(state, a, ctx) {
    if (!wishOf(state, a.id)) return ERR.NOT_FOUND;
    if (state.farm.wallet.coins < a.coins) return ERR.NO_COINS;
    // locking a big share of the treasury in a wish is a big spend for the partner too (RC-24, GDD §6.3)
    return isBigSpend(state, ctx.pid, ctx.now, a.coins, 0) && !confirmed(a, ERR.BIG_SPEND) ? ERR.BIG_SPEND : null;
  },
  apply(tx, a, ctx) {
    const def = tx.get(['farm', 'wishlist', a.id, 'def']);   // read before tryBuy may delete the wish
    const big = isBigSpend(tx.state, ctx.pid, ctx.now, a.coins, 0);
    wishMove(tx, ctx, a.id, a.coins);
    tx.emit({ e: 'wishDeposit', id: a.id, def, coins: a.coins, by: ctx.pid });
    if (big) tx.emit({ e: 'bigSpend', by: ctx.pid, coins: a.coins, acorns: 0, what: def });
    tryBuy(tx, ctx, a.id);
  },
};

function release(tx, ctx, id, by) {
  const coins = tx.get(['farm', 'wishlist', id, 'coins']);     // read before the move (tx.get is live)
  const def = tx.get(['farm', 'wishlist', id, 'def']);
  if (coins > 0) wishMove(tx, ctx, id, -coins);
  tx.del(['farm', 'wishlist', id, 'release']);
  tx.emit({ e: 'wishWithdrawn', id, def, coins, by });
}

export const wishWithdraw = {
  schema: { id: V.objId, coins: V.opt(V.int(1, 100_000_000)) },
  check(state, a, ctx) {
    const w = wishOf(state, a.id);
    if (!w) return ERR.NOT_FOUND;
    if (w.coins === 0) return ERR.EMPTY;
    if (w.by === ctx.pid) return a.coins !== undefined && a.coins > w.coins ? ERR.NO_COINS : null;
    return w.release ? ERR.ALREADY_DONE : null;           // the partner's wish: one open request at a time
  },
  apply(tx, a, ctx) {
    const w = tx.get(['farm', 'wishlist', a.id]);
    if (w.by !== ctx.pid) {
      // the partner's coins: ask them; auto-released after SAFETY.wishlist.autoReleaseMs (_wishRelease)
      tx.set(['farm', 'wishlist', a.id, 'release'], { by: ctx.pid, at: ctx.now });
      tx.emit({ e: 'wishAsked', id: a.id, def: w.def, coins: w.coins, by: ctx.pid, owner: w.by,
        until: ctx.now + SAFETY.wishlist.autoReleaseMs });
      return;
    }
    const n = a.coins ?? w.coins;
    const def = w.def;                                    // read before the move (tx.get is live)
    wishMove(tx, ctx, a.id, -n);
    tx.emit({ e: 'wishWithdrawn', id: a.id, def, coins: n, by: ctx.pid });
  },
};

export const wishAnswer = {
  schema: { id: V.objId, ok: V.bool },
  check(state, a, ctx) {
    const w = wishOf(state, a.id);
    if (!w || !w.release) return ERR.NOT_FOUND;
    return w.by === ctx.pid ? null : ERR.SELF_ONLY;
  },
  apply(tx, a, ctx) {
    const asker = tx.get(['farm', 'wishlist', a.id, 'release', 'by']);   // read before the delete
    if (a.ok) { release(tx, ctx, a.id, asker); return; }
    const { def, coins } = tx.get(['farm', 'wishlist', a.id]);
    tx.del(['farm', 'wishlist', a.id, 'release']);
    tx.emit({ e: 'wishDenied', id: a.id, def, coins, by: ctx.pid, asker });
  },
};

export const unwish = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const w = wishOf(state, a.id);
    if (!w) return ERR.NOT_FOUND;
    return w.by === ctx.pid ? null : ERR.SELF_ONLY;       // the partner withdraws through a request instead
  },
  apply(tx, a, ctx) {
    const coins = tx.get(['farm', 'wishlist', a.id, 'coins']);
    if (coins > 0) wishMove(tx, ctx, a.id, -coins);
    tx.del(['farm', 'wishlist', a.id]);
    tx.emit({ e: 'wishRemoved', id: a.id, by: ctx.pid, coins });
  },
};

/** The earliest moment a pending release request auto-releases, or Infinity. */
export function nextWishReleaseAt(state) {
  let t = Infinity;
  for (const w of Object.values(state.farm.wishlist)) {
    if (w.release) t = Math.min(t, w.release.at + SAFETY.wishlist.autoReleaseMs);
  }
  return t;
}

export const _wishRelease = {
  schema: {},
  check(state, a, ctx) {
    return nextWishReleaseAt(state) <= ctx.now ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    for (const id of sortedKeys(tx.state.farm.wishlist)) {
      const w = tx.state.farm.wishlist[id];
      if (w.release && w.release.at + SAFETY.wishlist.autoReleaseMs <= ctx.now) release(tx, ctx, id, w.release.by);
    }
  },
};
