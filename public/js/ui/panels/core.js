// Panel core (ui-panels lane): ask the SHARED RULES what an action would do, before the click, without
// duplicating a single rule in the UI. DOM-free, so node tests drive it with a plain state.
//
//   probe(store, type, args) -> null | ERR code
//        runs the action's own `check` against the predicted state (the same function the server runs), so a
//        button's disabled state and its reason can never disagree with what would happen on click. Soft codes
//        (RESERVED, PINNED, BIG_SPEND) come back as codes too: the button stays enabled and the shell's confirm
//        dialog asks on click (ui.toast(code, { type, args })).
//   simulate(store, type, args) -> { ok, code?, events, ops }
//        runs the whole action (check + apply + progress) on the live state and rolls it back in the same task:
//        an exact quote ("sell 12 for 1,140 coins", "this order pays 3 Acorns") straight from the rules. Use it
//        for previews only, never per frame.
//   has(type)                    the action exists in this build (ACTIONS), so its button may be shown
//   pick(...types)               the first registered action type of a list (names the rule lanes settle on)
//   reason(code, hint) -> text   a friendly, specific reason ("Need 2 more Flour", "Unlocks at level 9")
//   levelOf(state), available(state, item), owned(state, defId), countOwned(...)  small shared readers
import { ACTIONS, runAction, makeCtx } from '../../../../shared/rules/index.js';
import { parseArgs } from '../../../../shared/rules/schema.js';
import { ERR, SOFT } from '../../../../shared/net/protocol.js';
import { itemOf, levelFromXp } from '../../../../shared/content/index.js';

/** A cid that can never be a real client's (real cids are base-36 [a-z0-9]): previews never collide. */
const PROBE_CID = 'zzprobe';

export const has = (type) => typeof type === 'string' && Object.hasOwn(ACTIONS, type);

/** The first action type of the list this build registers (null when none): rule lanes may name things later. */
export function pick(...types) {
  for (const t of types.flat()) if (has(t)) return t;
  return null;
}

function ctxFor(store, seq = 1) {
  const state = store.state;
  return makeCtx(state, { now: store.now(), pid: store.pid, cid: PROBE_CID, seq, grace: 0 });
}

/**
 * The code the action's own check returns for these args right now (null = it would apply).
 * @param {{ state: object, pid: string, now(): number }} store
 * @param {string|null} type
 * @param {object} args
 */
export function probe(store, type, args = {}) {
  if (!store || !store.state) return ERR.NOT_JOINED;
  if (!has(type)) return ERR.UNKNOWN_ACTION;
  if (store.pid && !Object.hasOwn(store.state.players, store.pid)) return ERR.NOT_JOINED;
  const def = ACTIONS[type];
  const parsed = parseArgs(def.schema, args);
  if (!parsed) return ERR.BAD_ARGS;
  try {
    return def.check(store.state, parsed, ctxFor(store)) || null;
  } catch (err) {
    console.error(`probe ${type} threw`, err);
    return ERR.INTERNAL;
  }
}

/** True when a probe result means "the click would go through" (possibly after an "are you sure?"). */
export const passes = (code) => code === null || SOFT.has(code);

/**
 * Run the action for real on the live state and roll it back at once: the exact events (coins, XP, items) the
 * rules would produce. Synchronous, so nothing ever observes the intermediate state.
 * @returns {{ ok: boolean, code?: string, events: object[], ops: object[] }}
 */
export function simulate(store, type, args = {}) {
  if (!store || !store.state || !has(type)) return { ok: false, code: ERR.UNKNOWN_ACTION, events: [], ops: [] };
  let r;
  try {
    r = runAction(store.state, { type, args }, ctxFor(store, 0x7fffffff));
  } catch (err) {
    console.error(`simulate ${type} threw`, err);
    return { ok: false, code: ERR.INTERNAL, events: [], ops: [] };
  }
  if (!r.ok) return { ok: false, code: r.code, events: [], ops: [] };
  const out = { ok: true, events: r.tx.events.map((e) => ({ ...e })), ops: r.tx.ops.slice() };
  r.tx.rollback();
  return out;
}

// ---- small readers (pure) -------------------------------------------------------------------------------------

export const levelOf = (state) => levelFromXp(state?.farm?.xp ?? 0);

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : 0);

/** Units of an item in the Barn plus its overflow pile. */
export const available = (state, item) => own(state.farm.inventory, item) + own(state.farm.overflow, item);

/** Placed objects whose def is `defId` (sorted ids, so lists never depend on key order). */
export function objectsOf(state, defId) {
  const out = [];
  for (const id of Object.keys(state.farm.objects).sort()) if (state.farm.objects[id].def === defId) out.push(id);
  return out;
}

export const countOwned = (state, defId) => objectsOf(state, defId).length;

// ---- reasons ----------------------------------------------------------------------------------------------------

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt = (n) => NUM.format(Math.trunc(Number(n) || 0));

/**
 * One friendly sentence for why a button is off (GDD §7.2: the reason is shown BEFORE the click). `hint` makes
 * it specific: { coins, acorns, missing: [{ item, n }], unlock, cap, name, what, at }.
 */
export function reason(code, hint = {}) {
  if (code && hint && hint.texts && typeof hint.texts[code] === 'string') return hint.texts[code];
  if (code && hint && typeof hint.text === 'string' && hint.text) return hint.text;
  switch (code) {
    case null: case undefined: return '';
    case ERR.NO_COINS:
      if (hint.coins > 0) return `Need ${fmt(hint.coins)} more coins`;
      if (hint.acorns > 0) return `Need ${fmt(hint.acorns)} more Acorn${hint.acorns === 1 ? '' : 's'}`;
      return 'Not enough coins';
    case ERR.NO_ACORNS:
      return hint.acorns > 0 ? `Need ${fmt(hint.acorns)} more Acorn${hint.acorns === 1 ? '' : 's'}` : 'Not enough Acorns';
    case ERR.NO_ITEMS: {
      const m = hint.missing && hint.missing[0];
      if (m) {
        const it = itemOf(m.item);
        const more = hint.missing.length > 1 ? ` (+${hint.missing.length - 1} more)` : '';
        return `Need ${fmt(m.n)} more ${m.label ?? (it ? it.name : m.item)}${more}`;
      }
      if (hint.acorns > 0) return `Need ${fmt(hint.acorns)} more Acorn${hint.acorns === 1 ? '' : 's'}`;
      return 'Not enough in the barn';
    }
    case ERR.LOCKED: return hint.unlock ? `Unlocks at level ${hint.unlock}` : 'Not unlocked yet';
    case ERR.CAP: return hint.cap ? `Limit reached (${hint.cap})` : 'Limit reached for this level';
    case ERR.QUEUE_FULL: return 'Every slot is busy';
    case ERR.STORAGE_FULL: return 'The Barn is overflowing: sell some first';
    case ERR.NOT_READY: return hint.what ? `${hint.what} is not ready yet` : 'Not ready yet';
    case ERR.NOT_HUNGRY: return 'Not hungry right now';
    case ERR.EMPTY: return 'Nothing waiting here';
    case ERR.OCCUPIED: return 'Already busy';
    case ERR.ALREADY_DONE: return hint.done || 'Already done';
    case ERR.COOLDOWN: return hint.at ? `Again ${hint.at}` : 'Not again just yet';
    case ERR.NOT_REFUNDABLE: return 'No longer refundable';
    case ERR.SELF_ONLY: return 'Only the other farmer can do this';
    case ERR.NOT_FOUND: return "That's gone";
    case ERR.BLOCKED: return "That spot isn't free";
    case ERR.OUT_OF_BOUNDS: return "That land isn't ours yet";
    case ERR.OFFLINE: return 'Reconnecting to the farm...';
    case ERR.NOT_JOINED: return 'Connecting to the farm...';
    case ERR.RATE: return 'Easy there, farmer';
    case ERR.UNKNOWN_ACTION: return 'Not open yet';
    case ERR.RESERVED: return hint.name ? `${hint.name} is keeping some` : 'Some of these are kept';
    case ERR.PINNED: return hint.name ? `${hint.name} pinned this` : 'Pinned by your partner';
    case ERR.BIG_SPEND: return 'A big purchase: your partner gets a heads-up';
    default: return "Can't right now";
  }
}
