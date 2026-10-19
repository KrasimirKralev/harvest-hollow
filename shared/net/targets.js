// Race targets (GDD §6.3 "Mia got there first ♥"; QA r1 I-01). The server's engine remembers who acted on each
// target of an accepted action (server/engine.js touch / lastToucher, `rej.by`), and the client's controller does the
// same from the partner's confirmed events (CL-04: on a LAN the partner's delta lands first, so the refusal is local).
// Both name the targets here, so a lost race on an order reads the same as one on a plot. Pure, no dependency.
//
// A target is an object id (`args.id`, `args.ids[]`, and a few actions' other object-id arguments) or a shared board
// row addressed by a number: `order:<slot>`, `folk:<i>`, `barge:<i>`, `restore:<project>:<bundle>:<slot>`. A row key
// holds a ':', which an object id (/^[a-z0-9.]+$/) never does, so the two can never collide.

/** Targets read from one action at most (a drag stroke's `ids` is schema-capped far below this). */
export const TARGETS_MAX = 256;

/** Board rows by action type: [board, the argument that names the row]. */
const ROW_OF_TYPE = Object.freeze({
  orderFill: ['order', 'slot'], orderDiscard: ['order', 'slot'], orderPin: ['order', 'slot'],
  orderFlag: ['order', 'slot'], orderRush: ['order', 'slot'],
  folkFill: ['folk', 'i'], folkFlag: ['folk', 'i'],
  bargeLoad: ['barge', 'i'], bargeFlag: ['barge', 'i'],
});
/** The same rows by the event the accepted action emits (what a partner's screen sees). */
const ROW_OF_EVENT = Object.freeze({
  orderFilled: ['order', 'slot'], orderGone: ['order', 'slot'], orderPinned: ['order', 'slot'],
  orderFlagged: ['order', 'slot'], orderRushed: ['order', 'slot'],
  folkFilled: ['folk', 'i'], folkFlagged: ['folk', 'i'],
  bargeLoaded: ['barge', 'i'], bargeFlagged: ['barge', 'i'],
});
/** Restoration bundle slots ({ project, bundle, slot }), by action and by event. */
const BUNDLE_TYPES = new Set(['donate', 'restoreFlag']);
const BUNDLE_EVENTS = new Set(['donated', 'restoreFlagged']);
/** Object ids under other argument names: a home (pen) and the two animals of a pairing or a breeding. */
const OBJ_ARGS = Object.freeze({ pair: ['home', 'a', 'b'], pairCancel: ['home'], breed: ['a', 'b'] });

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const shortStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const rowNum = (v) => Number.isSafeInteger(v) && v >= 0;

/** The row key of a board-addressed record (`args` or an event), or null. */
function rowKey(map, name, rec) {
  if (own(map, name)) {
    const [board, key] = map[name];
    return rowNum(rec[key]) ? `${board}:${rec[key]}` : null;
  }
  return null;
}
function bundleKey(rec) {
  return shortStr(rec.project) && shortStr(rec.bundle) && rowNum(rec.slot)
    ? `restore:${rec.project}:${rec.bundle}:${rec.slot}` : null;
}

/**
 * The targets an action names: `args.id`, `args.ids[]` (first TARGETS_MAX), the type's other object-id arguments and
 * the board row it addresses. Raw, unparsed args: strings and safe integers only; never throws on garbage. Without a
 * type only `id` / `ids` count (the callers before QA r1).
 * @param {string | undefined} type @param {unknown} args @returns {string[]}
 */
export function actionTargets(type, args) {
  const out = [];
  if (!args || typeof args !== 'object') return out;
  if (typeof args.id === 'string') out.push(args.id);
  if (Array.isArray(args.ids)) {
    for (const id of args.ids.slice(0, TARGETS_MAX)) if (typeof id === 'string') out.push(id);
  }
  if (typeof type !== 'string') return out;
  if (own(OBJ_ARGS, type)) for (const k of OBJ_ARGS[type]) if (shortStr(args[k])) out.push(args[k]);
  const row = rowKey(ROW_OF_TYPE, type, args) ?? (BUNDLE_TYPES.has(type) ? bundleKey(args) : null);
  if (row) out.push(row);
  return out;
}

/**
 * The board row a confirmed event names (`orderFilled` -> `order:<slot>` ...), or null. Object ids in events are the
 * reader's own business (`ev.id`, `ev.ids`, an animal's home). Never throws on garbage.
 * @param {unknown} ev @returns {string | null}
 */
export function eventRow(ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.e !== 'string') return null;
  return rowKey(ROW_OF_EVENT, ev.e, ev) ?? (BUNDLE_EVENTS.has(ev.e) ? bundleKey(ev) : null);
}
