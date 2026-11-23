// The ui lane's ONE door to the wave-5 rules (the owners' wish list of 2026-10-05): babies in the pen (list 1, wish 1),
// the dog's "Stay home" / "Come with me" (list 2, wish 3) and the fewer, bigger land parcels (list 2, wish 4). DOM-free
// and pure, so node tests drive it with a plain state. Rules: actions/pen.js (pair, pairCancel, _pen, penView),
// actions/pets.js (petStay, petHomeId), land.js + content's CONTENT.parcels (docs/agent-notes/w5-rules.md, w5-content.md).
// An action this build lacks answers UNKNOWN_ACTION to its button's probe ("Not open yet"), never a broken page.
import { pick } from './core.js';
import { ACTIONS } from '../../../../shared/rules/index.js';
import * as C from '../../../../shared/content/index.js';
import * as AN from '../../../../shared/rules/actions/animals.js';
import * as PE from '../../../../shared/rules/actions/pets.js';
import * as PN from '../../../../shared/rules/actions/pen.js';
import { homeGrowth } from './w4b-rules.js';
import { t, N } from '../../i18n/index.js';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isSafeInteger(v) ? v : d);
const schemaOf = (type) => (type && ACTIONS[type] && isObj(ACTIONS[type].schema) ? ACTIONS[type].schema : null);
const has = (type, k) => Boolean(schemaOf(type)?.[k]);

/** True when the build registers `type`. */
export const can5 = (type) => pick(type) !== null;

// ---- L1.1 babies in the pen -----------------------------------------------------------------------------------------

/** The events of a pairing and of a birth (rules/events.js). */
export const PAIR_EVENTS = Object.freeze(new Set(['paired']));
export const BORN_EVENTS = Object.freeze(new Set(['penBorn']));

/** The tuning: the rules' PEN (content's PEN_BABIES over the defaults: level 8, one bottle item, the baby time). */
export function pairTable() {
  const tb = [PN.PEN, C.PEN_BABIES].find(isObj) ?? {};
  return { unlock: int(tb.unlock, 8), qty: int(tb.qty, 1), timeBp: int(tb.timeBp, 10_000), live: can5('pair') };
}

/** The running pairing of a home: { a, b, sp, at, readyAt, by } (the home's `pair`), or null. */
export function pairOf(state, homeId) {
  const p = state?.farm?.objects?.[homeId]?.pair;
  return isObj(p) ? { a: p.a ?? null, b: p.b ?? null, sp: p.sp ?? null, at: int(p.at, NaN), readyAt: int(p.readyAt, NaN), by: p.by ?? null } : null;
}

const animalDef = (o) => (o ? C.animalOf(o.def) : null);
/** A species that pairs: one that eats and has a bottle item (a bee colony never does). */
const pairable = (def) => Boolean(def) && def.feed !== null && Boolean(def.bottle);

/** The two adults the ❤ proposes: the farmer's pick of one species, else the lowest ids of the first species with two. */
function proposal(adults, sel) {
  const a = Array.isArray(sel) ? adults.find((x) => x.id === sel[0]) : null;
  const b = Array.isArray(sel) ? adults.find((x) => x.id === sel[1]) : null;
  if (a && b && a.id !== b.id && a.def === b.def) return [a.id, b.id];
  if (a) {
    const mate = adults.find((x) => x.def === a.def && x.id !== a.id);
    if (mate) return [a.id, mate.id];
  }
  const by = new Map();
  for (const x of adults) by.set(x.def, [...(by.get(x.def) ?? []), x.id]);
  for (const ids of by.values()) if (ids.length >= 2) return [ids[0], ids[1]];
  return [];
}

/**
 * Everything a home's ❤ card draws (pure; tests). `sel` = the farmer's own pick (ids).
 *   { live, unlock, level, open, why: null | 'live' | 'colony' | 'level' | 'running' | 'adults', running, adults: [{ id, def,
 *     name }], pick: [a, b], sp, cost: { item, qty }, ms, code (what `pair` answers now), full, waiting, room }
 * room: a full home's room step that comes with the pairing ({ coins, grows, code, blockers }: wave 4b's growth, its
 * price folded in like buying one more animal; code BLOCKED / OUT_OF_BOUNDS / CAP when it cannot grow), else null.
 */
export function pairView(state, homeId, now, sel = null) {
  const o = state?.farm?.objects?.[homeId] ?? null;
  const level = C.levelFromXp(state?.farm?.xp ?? 0);
  const tb = pairTable();
  const out = { live: tb.live, unlock: tb.unlock, level, open: tb.live && level >= tb.unlock, why: null, running: null, adults: [], pick: [],
    sp: null, cost: null, ms: 0, code: undefined, full: false, waiting: false, room: null };
  const species = (C.defOf(o?.def)?.species ?? []).map((s) => C.animalOf(s)).filter(Boolean);
  if (!o || !species.some(pairable)) return { ...out, why: species.length ? 'colony' : 'adults' };
  const ids = Object.keys(state.farm.objects).sort().filter((k) => state.farm.objects[k].home === homeId);
  const r = pairOf(state, homeId);
  if (r) out.running = { a: r.a, b: r.b, sp: r.sp, start: r.at, end: r.readyAt, by: r.by };
  out.adults = ids.filter((id) => id !== r?.a && id !== r?.b).map((id) => [id, state.farm.objects[id]])
    .filter(([, a]) => !(a.baby && int(a.adultAt, 0) > now) && pairable(animalDef(a)))
    .map(([id, a]) => ({ id, def: a.def, name: typeof a.name === 'string' ? a.name : null }));
  out.pick = proposal(out.adults, sel);
  out.sp = r?.sp ?? (out.pick.length ? state.farm.objects[out.pick[0]].def : species.find(pairable).id);
  const def = C.animalOf(out.sp);
  // the rules' own view (code, cost, time, the room step), else the table: one of the species' bottle item
  let p = null;
  if (typeof PN.penView === 'function') { try { p = PN.penView(state, homeId, now); } catch { p = null; } }
  out.code = p ? p.code : undefined;
  out.waiting = Boolean(p?.waiting);
  out.cost = isObj(p?.cost) ? p.cost : def?.bottle ? { item: def.bottle, qty: tb.qty } : null;
  out.ms = int(p?.ms, def ? Math.floor((int(def.babyMs) * tb.timeBp) / 10_000) : 0);
  const cap = typeof AN.homeGrowth === 'function' ? homeGrowth(state, homeId) : null;
  out.full = cap ? ids.length >= int(cap.cap, Infinity) : false;
  const grow = isObj(p?.grow) ? p.grow : out.full && cap && !r ? cap : null;
  if (grow) {
    out.room = { coins: int(p?.coins ?? grow.coins), grows: Boolean(grow.grows), code: grow.code ?? null,
      blockers: Array.isArray(grow.blockers) ? grow.blockers : cap?.blockers ?? [] };
  }
  if (!out.live) out.why = 'live';
  else if (level < out.unlock) out.why = 'level';
  else if (r) out.why = 'running';
  else if (out.pick.length < 2) out.why = 'adults';
  return out;
}

/** The ❤: `pair {home, a, b}`, with `max` = the room step's price this farmer saw (the partner grew it first: RC-18). */
export function pairIntent(homeId, v) {
  const args = { home: homeId };
  if (v.pick.length === 2 && has('pair', 'a')) Object.assign(args, { a: v.pick[0], b: v.pick[1] });
  if (has('pair', 'max') && v.room && v.room.code === null && v.room.coins > 0) args.max = v.room.coins;
  return { type: 'pair', args };
}
export const pairCancelIntent = (homeId) => ({ type: 'pairCancel', args: { home: homeId } });

// ---- L2.3 the dog stays home ----------------------------------------------------------------------------------------

export const STAY_EVENTS = Object.freeze(new Set(['petStay']));

/** The pet of `pid` (or null). */
export const petOf = (state, pid) => state?.players?.[pid]?.pet ?? null;
/** True while the pet stays home (rules: `pet.stay`; absent = it follows its farmer). */
export const stayOf = (pet) => Boolean(pet) && pet.stay === true;
/** `petStay {stay, owner?}`: the rules let either farmer tell either pet (owner = whose, default the sender's own). */
export const stayIntent = (stay, owner = null, me = null) => ({ type: 'petStay',
  args: owner && owner !== me && has('petStay', 'owner') ? { stay: stay === true, owner } : { stay: stay === true } });
/** True when this build lets a farmer command the other farmer's pet too. */
export const stayForOthers = () => has('petStay', 'owner');

/** "Stays home by its Dog House 🏠" (its bed: the rules' petHomeId), else by the farmhouse porch. */
export function stayLine(state, owner) {
  let bed = null;
  if (typeof PE.petHomeId === 'function') { try { bed = PE.petHomeId(state, owner); } catch { bed = null; } }
  const def = bed ? state.farm.objects[bed]?.def : null;
  return def && C.defOf(def) ? t('hud.pet.stays', { home: N(def) }) : t('hud.pet.staysPorch');
}

// ---- L2.4 fewer, bigger land parcels --------------------------------------------------------------------------------
// `farm.expansions` keeps listing the land PIECES (the 16 old small parcels, ids and rects unchanged); a PARCEL
// (CONTENT.parcels: k, unlock, cost, planks, crates, pieces, rects, proof, proofText, reveals) is what the farm buys,
// and owning a parcel = owning all of its pieces. A build without parcels buys the expansion rows themselves.

const parcelsFam = () => (C.CONTENT?.parcels instanceof Map ? C.CONTENT.parcels : null);
/** The content family that names a purchase unit ('parcels' | 'expansions'). */
export const landFamily = () => (parcelsFam() ? 'parcels' : 'expansions');
const asUnit = (e) => (e ? { ...e, pieces: Array.isArray(e.pieces) && e.pieces.length ? e.pieces : [e.id] } : null);

/** Every purchase unit in buying order (k 0 = the Homestead). Retired rows never. */
export function landUnits() {
  const rows = [...(parcelsFam() ?? C.CONTENT.expansions).values()];
  return rows.filter((p) => p.retired !== true).map(asUnit).sort((a, b) => a.k - b.k);
}
/** A purchase unit by id, or null. */
export const landUnit = (id) => asUnit((parcelsFam() ?? C.CONTENT.expansions).get(id) ?? null);
/** The unit a land piece is sold in (a for-sale sign on an old piece opens its parcel), else the id itself. */
export const unitOfPiece = (id) => (parcelsFam() ? C.CONTENT.expansions.get(id)?.parcel ?? id : id);
/** True when the farm owns every piece of unit `u` (the Homestead always). */
export const unitOwned = (state, u) => Boolean(u) && (u.k === 0 || u.pieces.every((x) => state.farm.expansions.includes(x)));
/** A land id's name source: a parcel or an old piece / expansion row ({ family, en }), or null. */
export function landRef(id) {
  const p = parcelsFam()?.get(id);
  if (p) return { family: 'parcels', en: p.name };
  const e = C.CONTENT.expansions.get(id);
  return e ? { family: 'expansions', en: e.name } : null;
}
/** The pieces' features of a unit merged ({ bargeRowBonusBp, truffleSpeedBp, fishingSpot, goldenHourBonusMs }), or null. */
export function unitFeature(u) {
  const out = {};
  for (const id of u?.pieces ?? []) if (isObj(C.CONTENT.expansions.get(id)?.feature)) Object.assign(out, C.CONTENT.expansions.get(id).feature);
  if (isObj(u?.feature)) Object.assign(out, u.feature);
  return Object.keys(out).length ? out : null;
}
/** The plot cap a unit adds: content's `plots`, else PLOT_CAP_PER_EXPANSION for each of its pieces. */
export const parcelPlots = (e) => int(e?.plots, int(C.PLOT_CAP_PER_EXPANSION, 6) * Math.max(1, e?.pieces?.length ?? 1));
/** Tiles in a unit (its rects). */
export const parcelArea = (e) => (Array.isArray(e?.rects) ? e.rects.reduce((n, r) => n + int(r[2]) * int(r[3]), 0) : 0);

/** `expand` / `openExpansion` take the unit's id under `expansion` (a parcel id where the build sells parcels). */
export const expandIntent = (id) => ({ type: pick('expand') ?? 'expand', args: { expansion: id } });
export const openLandIntent = (id) => ({ type: pick('openExpansion') ?? 'openExpansion', args: { expansion: id } });

/**
 * The atlas paintings of a unit: [{ id, rect }]: each old piece of a parcel keeps its own painting where it always was;
 * a unit that is its own piece paints its id. Pure.
 */
export function vignettesOf(e, known = () => false) {
  const pieces = Array.isArray(e?.pieces) ? e.pieces : null;
  if (pieces && !(pieces.length === 1 && pieces[0] === e.id)) {
    const out = pieces.flatMap((id) => (C.CONTENT.expansions.get(id)?.rects ?? []).map((rect) => ({ id: known(id) ? id : 'land', rect })));
    if (out.length) return out;
  }
  return (e?.rects ?? []).map((rect) => ({ id: known(e.id) ? e.id : String(e?.id ?? 'land'), rect }));
}

/** The outline of a unit made of several rects as one SVG path in tiles (no edge where its own rects meet). Pure. */
export function outlinePath(rects) {
  const cells = new Set();
  for (const [x, z, w, d] of rects) for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) cells.add(`${x + i},${z + j}`);
  const on = (x, z) => cells.has(`${x},${z}`);
  const hz = new Map();          // horizontal edges by z: x list
  const vt = new Map();          // vertical edges by x: z list
  const add = (m, k, at) => m.set(k, [...(m.get(k) ?? []), at]);
  for (const key of cells) {
    const [x, z] = key.split(',').map(Number);
    if (!on(x, z - 1)) add(hz, z, x);
    if (!on(x, z + 1)) add(hz, z + 1, x);
    if (!on(x - 1, z)) add(vt, x, z);
    if (!on(x + 1, z)) add(vt, x + 1, z);
  }
  const runs = (list) => {
    const out = [];
    for (const a of [...list].sort((p, q) => p - q)) { const last = out.at(-1); if (last && last[1] === a) last[1] = a + 1; else out.push([a, a + 1]); }
    return out;
  };
  let d = '';
  for (const [z, xs] of [...hz].sort((p, q) => p[0] - q[0])) for (const [a, b] of runs(xs)) d += `M${a} ${z}H${b}`;
  for (const [x, zs] of [...vt].sort((p, q) => p[0] - q[0])) for (const [a, b] of runs(zs)) d += `M${x} ${a}V${b}`;
  return d;
}

/** One SVG path of a unit's rects (one shape: no hairline seam where two of its rects meet, as two <rect>s show). */
export const rectsPath = (rects) => rects.map(([x, z, w, d]) => `M${x} ${z}h${w}v${d}h${-w}Z`).join('');

/** The biggest rect of a unit (where its label sits). */
export const mainRect = (e) => (Array.isArray(e?.rects) && e.rects.length
  ? e.rects.reduce((m, r) => (r[2] * r[3] > m[2] * m[3] ? r : m), e.rects[0]) : [0, 0, 0, 0]);
