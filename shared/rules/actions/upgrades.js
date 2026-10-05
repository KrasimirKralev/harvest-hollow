// Upgrades (wave 4, owner wish E 2026-10-04): the farmhouse, the Well, the Market Stand and the benches get a few tiers
// each, with a visible change (the renderer reads `obj.up`) and a small bonus (shared/rules/upgrades.js has the table
// and the bonus helpers). Either player buys the next tier; both see it at once.
//
//   upgradeObject {id}   the next tier of object `id`: coins (BIG_SPEND asks first) and materials from the shared Barn
//                        (below Keep N asks RESERVED). NOT_FOUND (no object), LOCKED (not upgradable, or the tier's
//                        farm level is not reached), ALREADY_DONE (top tier), NO_COINS, NO_ITEMS.
//
// State: `objects[id].up` = tiers bought (1..). It moves with the object (move only rewrites x/z/rot). An upgraded bench
// keeps what was paid in `paid` (its resale stays an honest share, no buy/sell loop), is no longer a 100 % undo (any
// use ends the receipt) and is never stored (the tray keeps counts, not tiers): it moves or sells.
import { defOf } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { objectOf } from '../grid.js';
import { sortedKeys } from '../order.js';
import { available, unkept, consume, useReceipts } from '../economy.js';
import { UPGRADES, upgradeTargetOf, tierOf, tierRow, tierOpen, bonusOf } from '../upgrades.js';
import { payCode, pay } from './decor.js';

export { UPGRADES, UPGRADE_TARGETS, upgradeTargetOf, upgradeBonus, benchGoldenMs, tierOf } from '../upgrades.js';

/**
 * What upgrading object `id` means now, for panels and the Goal Tracker. Pure.
 * @returns {null | { id, def, target, name, tier, max, bonus, next: null | { tier, name, unlock, coins, items, bonus,
 *   text }, code: null | string, missing: { item: n } }}  code: why the next tier cannot be bought right now (LOCKED
 *   for the level, NO_COINS, NO_ITEMS, ALREADY_DONE at the top), null when it can.
 */
export function upgradeView(state, id) {
  const o = objectOf(state, id);
  const target = o ? upgradeTargetOf(o.def) : null;
  if (!target) return null;
  const tiers = UPGRADES[target].tiers;
  const tier = tierOf(o);
  const row = tierRow(target, tier + 1);
  const next = row ? { tier: tier + 1, name: row.name, unlock: row.unlock ?? 1, coins: row.coins ?? 0,
    items: { ...(row.items ?? {}) }, bonus: { ...(row.bonus ?? {}) }, text: row.text ?? '' } : null;
  const missing = {};
  for (const item of sortedKeys(next?.items ?? {})) {
    const lack = next.items[item] - available(state, item);
    if (lack > 0) missing[item] = lack;
  }
  let code = null;
  if (!next) code = ERR.ALREADY_DONE;
  else if (!tierOpen(state, row)) code = ERR.LOCKED;
  else if (state.farm.wallet.coins < next.coins) code = ERR.NO_COINS;
  else if (Object.keys(missing).length) code = ERR.NO_ITEMS;
  return { id, def: o.def, target, name: UPGRADES[target].name ?? defOf(o.def)?.name ?? o.def, tier, max: tiers.length,
    bonus: { ...bonusOf(o) }, next, code, missing };
}

export const upgradeObject = {
  schema: { id: V.objId },
  check(state, a, ctx) {
    const v = upgradeView(state, a.id);
    if (!objectOf(state, a.id)) return ERR.NOT_FOUND;
    if (!v) return ERR.LOCKED;
    if (v.code === ERR.ALREADY_DONE || v.code === ERR.LOCKED) return v.code;
    if (v.code === ERR.NO_ITEMS) return ERR.NO_ITEMS;
    for (const item of sortedKeys(v.next.items)) {
      if (unkept(state, item) < v.next.items[item] && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
    }
    return payCode(state, a, ctx, { coins: v.next.coins, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const v = upgradeView(tx.state, a.id);
    const o = tx.get(['farm', 'objects', a.id]);
    for (const item of sortedKeys(v.next.items)) consume(tx, item, v.next.items[item]);
    if (v.next.coins > 0) pay(tx, ctx, { coins: v.next.coins, acorns: 0 }, `upgrade:${o.def}`, o.def);
    const kind = defOf(o.def)?.kind;
    if (kind === 'decor' && v.next.coins > 0) {
      // a bench sells for a share of everything paid into it (decor.js resaleOf): never more than was paid
      const paid = o.paid ?? { coins: 0, acorns: 0 };
      tx.set(['farm', 'objects', a.id, 'paid'], { coins: paid.coins + v.next.coins, acorns: paid.acorns });
    }
    useReceipts(tx, [a.id]);
    tx.set(['farm', 'objects', a.id, 'up'], v.next.tier);
    tx.inc(['farm', 'stats', 'upgrades'], 1);
    tx.emit({ e: 'upgraded', id: a.id, def: o.def, target: v.target, tier: v.next.tier, name: v.next.name,
      coins: v.next.coins, items: { ...v.next.items }, by: ctx.pid });
  },
};
