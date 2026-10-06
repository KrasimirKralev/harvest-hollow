// Every action the content panels send, in ONE place (ui-panels lane): a panel asks for an intent, this file
// names the rules' action type and builds its args (shared/rules/actions/*.js own the names and schemas). DOM-free.
//
// Each intent: (...params) -> { type, args }. `type` is the registered name (core.pick) or the canonical name when
// this build lacks it: the probe then answers UNKNOWN_ACTION and the button says "Not open yet" instead of failing.
import { ACTIONS } from '../../../../shared/rules/index.js';
import { pick } from './core.js';
import { t } from '../../i18n/index.js';

const first = (...names) => pick(...names) ?? names[0];
/** True when this build's `type` takes the argument `arg` (a rule lane may add an identity argument later). */
const takes = (type, arg) => Boolean(ACTIONS[type] && ACTIONS[type].schema && Object.hasOwn(ACTIONS[type].schema, arg));
/**
 * An order intent names the slot AND the order the player saw (order.n, wave-1 QA RC-07): a stale click whose
 * order was filled or skipped meanwhile answers NOT_FOUND instead of acting on the new order in that slot.
 */
const orderArgs = (type, slot, n) => (takes(type, 'n') && Number.isSafeInteger(n) ? { slot, n } : { slot });

export const I = {
  // market and storage (rules-economy: actions/market.js, storage.js)
  sell: (item, qty) => ({ type: first('sell'), args: { item, qty } }),
  sellSurplus: () => ({ type: first('sellSurplus'), args: {} }),
  storeBuy: (item, qty) => ({ type: first('storeBuy'), args: { item, qty } }),
  keep: (item, n) => ({ type: first('keep'), args: { item, n } }),
  noFeed: (item, on) => ({ type: first('noFeed'), args: { item, on } }),
  barnUpgrade: () => ({ type: first('upgradeBarn'), args: {} }),
  wish: (def) => ({ type: first('wish'), args: { def } }),
  wishDeposit: (id, coins) => ({ type: first('wishDeposit'), args: { id, coins } }),
  wishWithdraw: (id, coins) => ({ type: first('wishWithdraw'), args: coins === undefined ? { id } : { id, coins } }),
  wishAnswer: (id, ok) => ({ type: first('wishAnswer'), args: { id, ok } }),
  unwish: (id) => ({ type: first('unwish'), args: { id } }),
  // boosts, tools, land (boosts.js, expansions.js)
  goldenSeeds: () => ({ type: first('buyGoldenSeeds'), args: {} }),
  buyTool: (tool) => ({ type: first('buyTool'), args: { tool } }),
  hurry: (id) => ({ type: first('hurry'), args: { id } }),
  openExpansion: (expansion) => ({ type: first('openExpansion'), args: { expansion } }),
  expand: (expansion) => ({ type: first('expand'), args: { expansion } }),
  // objects (decor.js)
  sellObject: (id) => ({ type: first('sellObject'), args: { id } }),
  refund: (id) => ({ type: first('refund'), args: { id } }),
  restore: (id) => ({ type: first('restore'), args: { id } }),
  store: (id) => ({ type: first('store'), args: { id } }),
  moveBack: (id) => ({ type: first('moveBack'), args: { id } }),
  pinObject: (id, on) => ({ type: first('pinObject'), args: { id, on } }),
  // buildings and crafting (crafting.js)
  craft: (id, recipe) => ({ type: first('craft'), args: { id, recipe } }),
  duet: (id, recipe) => ({ type: first('duet'), args: { id, recipe } }),
  // a queue item is named by its stable key k (wave-1 QA RC-06); the index only in a build without keys
  cancel: (id, index, k) => {
    const type = first('cancel');
    return { type, args: takes(type, 'k') ? { id, k: Number.isSafeInteger(k) ? k : -1 } : { id, index } };
  },
  collectTray: (id) => ({ type: first('collectTray'), args: { id } }),
  addSlot: (id) => ({ type: first('upgradeSlot'), args: { id } }),
  // animals (animals.js): tend = collect + re-feed; feed / collect are the split versions
  buyAnimal: (def, adult, home) => ({ type: first('buyAnimal'), args: home ? { def, adult, home } : { def, adult } }),
  tend: (ids) => ({ type: first('tend'), args: Array.isArray(ids) ? { ids } : { id: ids } }),
  feed: (ids) => ({ type: first('feed'), args: Array.isArray(ids) ? { ids } : { id: ids } }),
  collect: (ids) => ({ type: first('collect'), args: Array.isArray(ids) ? { ids } : { id: ids } }),
  pet: (ids) => ({ type: first('pet'), args: Array.isArray(ids) ? { ids } : { id: ids } }),
  bottle: (id) => ({ type: first('bottle'), args: { id } }),
  upgradeHome: (id) => ({ type: first('upgradeHome'), args: { id } }),
  // trees and crops (trees.js, farming.js)
  harvestTree: (id) => ({ type: first('harvestTree'), args: { id } }),
  chop: (id) => ({ type: first('chop'), args: { id } }),
  water: (id) => ({ type: first('water'), args: { id } }),
  compost: (id) => ({ type: first('compost'), args: { id } }),
  // goals (rules-goals: orders.js, daily.js, quests.js, social.js, coop.js, ribbons.js)
  fillOrder: (slot, n) => { const type = first('orderFill'); return { type, args: orderArgs(type, slot, n) }; },
  discardOrder: (slot, n) => { const type = first('orderDiscard'); return { type, args: orderArgs(type, slot, n) }; },
  pinOrder: (slot, n) => { const type = first('orderPin'); return { type, args: orderArgs(type, slot, n) }; },
  flagOrder: (slot, n) => { const type = first('orderFlag'); return { type, args: orderArgs(type, slot, n) }; },
  rushOrder: (slot) => ({ type: first('orderRush'), args: { slot } }),
  claimGift: () => ({ type: first('claimGift'), args: {} }),
  rerollTask: (slot) => ({ type: first('almanacReroll'), args: { slot } }),
  deliverQuest: (id) => ({ type: first('questDeliver'), args: { id } }),
  postNote: (text, x, z) => ({ type: first('noteAdd'), args: { x, z, text } }),
  removeNote: (id) => ({ type: first('noteDel'), args: { id } }),
  thank: (i) => ({ type: first('thank'), args: { i } }),
  keepsake: (item, to) => ({ type: first('keepsake'), args: to ? { item, to } : { item } }),
  markSeen: (kind, id, level) => ({ type: first('markSeen'), args: { kind, ...(id !== undefined ? { id } : {}), ...(level !== undefined ? { level } : {}) } }),
  titlePick: (ribbon) => ({ type: first('titlePick'), args: ribbon ? { ribbon } : {} }),
  nameAnimal: (id, name) => ({ type: first('nameAnimal'), args: { id, name } }),
};

/** How long an Undo toast stays (ms): long enough to read the line and reach the button with a thumb. */
export const UNDO_MS = 7000;

/**
 * Send intent `it` through `act` (a panel's ctx.act or controller.do: the predicted action path) and, once the rules
 * took it, offer `undo` (another intent, through the same `act`) on a toast "<text> · Undo". A settings switch that
 * takes no confirm needs a way back a misclick cannot miss (owner report 2026-10-04: Wheat marked "not for feed" by
 * accident). DOM-free: `toast` is the caller's ui.toast. Returns act's result.
 */
export function actUndoable(act, toast, it, undo, text) {
  const r = act(it.type, it.args);
  if (r && r.ok && typeof toast === 'function') {
    toast(text, { kind: 'ok', ms: UNDO_MS, action: { label: t('market.barn.undo'), fn: () => act(undo.type, undo.args) } });
  }
  return r;
}
