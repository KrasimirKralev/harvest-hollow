// Land: fewer, bigger expansions (wave 5, owner wish L2-4). Owned by rules.
//
// Content's model (docs/agent-notes/w5-content.md): `farm.expansions` keeps listing land PIECES (the 16 old parcels:
// ids, rects, debris, free objects and features unchanged), and a PARCEL (CONTENT.parcels, `pieces: [ids]`, k 0..7)
// is the purchase unit: buying it adds all of its pieces. A save from before owns pieces one by one, so it may hold
// a parcel only in part: the one-time `_land` system action (actions/land.js) gives it the rest of every parcel it
// has a piece of (the player's favour: land only grows, coins never move) and turns the old pieces' open land cards
// into their parcel's card.
//
//   landRow(id)            the purchase row: a parcel (or, in a build without parcels, the expansion row itself)
//   landTarget(id)         the parcel a piece belongs to (else id)
//   parcelPieces(id)       the pieces of parcel `id` ([id] without parcels)
//   liveParcels()          the parcels in k order (the expansion rows without parcels)
//   nextParcel(state)      the first parcel the farm does not own whole, or null
//   ownsParcel(state, id)  every piece of it is owned
//   landPlan(state)        what `_land` does to this farm (null = nothing)
//
// Pure: no clocks or randomness; the derived tables are built once (CONTENT is frozen; tests that swap a family call
// __resetLand()).
import * as C from '../content/index.js';
import { sortedKeys } from './order.js';

const { CONTENT, isLive } = C;

let tables = null;

/** Parcels in k order, the piece -> parcel map. Without CONTENT.parcels: one "parcel" per expansion row. */
function landTables() {
  if (tables) return tables;
  const fam = CONTENT.parcels instanceof Map ? CONTENT.parcels : null;
  const rows = fam ? [...fam.values()] : [...CONTENT.expansions.values()].map((e) => ({ ...e, pieces: [e.id] }));
  const parcels = rows.filter((p) => isLive(p) && p.retired !== true).sort((a, b) => a.k - b.k);
  const of = new Map();
  for (const p of rows) for (const piece of p.pieces ?? []) if (!of.has(piece)) of.set(piece, p.id);
  tables = { fam, parcels, of, byId: new Map(rows.map((p) => [p.id, p])) };
  return tables;
}

/** Tests that install a fixture land table drop the derived tables with this. */
export function __resetLand() { tables = null; }

/** True when this build buys land by parcel (content's CONTENT.parcels). */
export const hasParcels = () => landTables().fam !== null;

/** The purchase row of `id`: a parcel; without parcels the expansion row. undefined when unknown. */
export const landRow = (id) => (typeof id === 'string' ? landTables().byId.get(id) : undefined);

/** The parcel piece `id` belongs to, else `id` itself. */
export const landTarget = (id) => landTables().of.get(id) ?? id;

/** The pieces of parcel `id` (its own id when it is no parcel). */
export const parcelPieces = (id) => landRow(id)?.pieces ?? [id];

/** The parcels in k order (live, not retired). */
export const liveParcels = () => landTables().parcels;

/** True when every piece of parcel `id` is owned. */
export const ownsParcel = (state, id) => parcelPieces(id).every((x) => state.farm.expansions.includes(x));

/** The first parcel in k order the farm does not own whole, or null. */
export function nextParcel(state) {
  for (const p of liveParcels()) if (!ownsParcel(state, p.id)) return p;
  return null;
}

/** Parcels the farm owns in part (some pieces, not all), k order. */
function partial(state) {
  const owned = state.farm.expansions;
  return liveParcels().filter((p) => p.pieces.some((x) => owned.includes(x)) && !p.pieces.every((x) => owned.includes(x)));
}

/**
 * What the one-time land migration does to this farm (pure), or null (nothing to do, or a build without parcels):
 *   { from, to, added, drop: [old card ids], cards: { [parcelId]: { at, n } } }
 * to = owned pieces in their order, then the pieces given with them (parcel order); drop = open land cards keyed by
 * a piece (not a parcel); cards = the parcel cards they become (content's proofFrom maps a piece's task i onto the
 * parcel's task j; the earliest start wins, counts take the larger); a card of a parcel owned whole is dropped.
 */
export function landPlan(state) {
  const t = landTables();
  if (!t.fam) return null;
  const f = state.farm;
  const owned = f.expansions;
  const part = partial(state);
  const stale = sortedKeys(f.proofs ?? {}).filter((id) => !t.byId.has(id));
  if (!part.length && !stale.length) return null;
  const added = [];
  for (const p of part) for (const x of p.pieces) if (!owned.includes(x) && !added.includes(x)) added.push(x);
  const to = [...owned, ...added];
  const ownedAfter = (pid) => parcelPieces(pid).every((x) => to.includes(x));
  const cards = {};
  for (const piece of stale) {
    const pid = t.of.get(piece);
    const p = pid && t.byId.get(pid);
    const old = f.proofs[piece];
    if (!p || ownedAfter(pid) || Object.hasOwn(f.proofs, pid)) continue;
    const at = Number.isSafeInteger(old?.at) ? old.at : 0;
    const map = p.proofFrom?.[piece] ?? [];
    const card = cards[pid] ?? { at, n: {} };
    if (at < card.at) card.at = at;
    for (const [i, v] of Object.entries(old?.n ?? {})) {
      const j = map[Number(i)];
      if (!Number.isSafeInteger(j) || j < 0 || !Number.isSafeInteger(v) || v <= 0) continue;
      const cap = p.proof?.[j]?.qty ?? v;
      card.n[String(j)] = Math.min(cap, Math.max(card.n[String(j)] ?? 0, v));
    }
    cards[pid] = card;
  }
  return { from: owned.slice(), to, added, drop: stale, cards };
}

/** True when `_land` has work on this farm. */
export const landDue = (state) => landPlan(state) !== null;
