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
import { t, N, Q } from '../../i18n/index.js';

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
      if (hint.coins > 0) return t('market.why.moreCoins', { n: hint.coins });
      if (hint.acorns > 0) return t('market.why.moreAcorns', { n: hint.acorns });
      return t('market.why.noCoins');
    case ERR.NO_ACORNS:
      return hint.acorns > 0 ? t('market.why.moreAcorns', { n: hint.acorns }) : t('market.why.noAcorns');
    case ERR.NO_ITEMS: {
      const m = hint.missing && hint.missing[0];
      if (m) {
        const it = itemOf(m.item);
        const more = hint.missing.length - 1;
        // a class row ("grain (any)") or an unknown id has no name in the table: its label goes in as it is
        const line = m.label != null || !it
          ? t('market.why.moreLabel', { n: m.n, label: m.label ?? m.item })
          : t('market.why.moreItem', { n: m.n, item: N(m.item), q: Q(m.item, m.n) });
        return more > 0 ? t('market.why.andMore', { line, more }) : line;
      }
      if (hint.acorns > 0) return t('market.why.moreAcorns', { n: hint.acorns });
      return t('market.why.noItems');
    }
    case ERR.LOCKED: return hint.unlock ? t('market.why.unlockAt', { n: hint.unlock }) : t('market.why.locked');
    case ERR.CAP: return hint.cap ? t('market.why.capN', { cap: hint.cap }) : t('market.why.cap');
    case ERR.QUEUE_FULL: return t('market.why.queueFull');
    case ERR.STORAGE_FULL: return t('market.why.storageFull');
    case ERR.NOT_READY: return hint.what ? t('market.why.notReadyWhat', { what: hint.what }) : t('market.why.notReady');
    case ERR.NOT_HUNGRY: return t('market.why.notHungry');
    case ERR.EMPTY: return t('market.why.empty');
    case ERR.OCCUPIED: return t('market.why.occupied');
    case ERR.ALREADY_DONE: return hint.done || t('market.why.done');
    case ERR.COOLDOWN: return hint.at ? t('market.why.again', { at: hint.at }) : t('market.why.cooldown');
    case ERR.NOT_REFUNDABLE: return t('market.why.notRefundable');
    case ERR.SELF_ONLY: return t('market.why.selfOnly');
    case ERR.NOT_FOUND: return t('market.why.notFound');
    case ERR.BLOCKED: return t('market.why.blocked');
    case ERR.OUT_OF_BOUNDS: return t('market.why.outOfBounds');
    case ERR.OFFLINE: return t('market.why.offline');
    case ERR.NOT_JOINED: return t('market.why.notJoined');
    case ERR.RATE: return t('market.why.rate');
    case ERR.UNKNOWN_ACTION: return t('market.why.unknown');
    case ERR.RESERVED: return hint.name ? t('market.why.reservedBy', { name: hint.name }) : t('market.why.reserved');
    case ERR.PINNED: return hint.name ? t('market.why.pinnedBy', { name: hint.name }) : t('market.why.pinned');
    case ERR.BIG_SPEND: return t('market.why.bigSpend');
    default: return t('market.why.default');
  }
}
