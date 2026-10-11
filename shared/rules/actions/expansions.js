// Land and debris regrowth (GDD §2.2, §2.3 debris regrowth, §3.9 expansions, §9 #30, #35), plus the economy's
// time-driven system actions for rules-goals' scheduler. Owned by rules-economy.
//
//   openExpansion {expansion}   the card is opened for the first time: its proof tasks start counting (§3.9)
//   expand {expansion}          buy the NEXT parcel in order (wave 5: a parcel = several pieces of land): level,
//                               coins, Planks, Crates and the proof tasks; each piece arrives with its free objects
//                               and debris
//   _regrow {}                  system: one weed or rock per real hour on a free unlocked tile, at most
//                               DEBRIS_RULES.regrowMax waiting; catches up after downtime in ONE action
//   _wishRelease {}             system (actions/storage.js)
//   _rain {}                    system (actions/farming.js): rain waters what grows at a rain hour's start
//   _beauty {}                  system (actions/beauty.js): Farm Beauty stars and first decor-set completions
//   _townPost {}, _townBuild {}  system (actions/town.js): Ollie posts the next Town Project; the village builds it
//   _petFind {}                 system (actions/pets.js): a pet fed yesterday brings its find in the morning
//
// econDue(state, now) / econNextDueAt(state, now): rules-goals' dueSystemActions / nextSystemDueAt include them.
// Every due action clears its own condition when it commits (server/scheduler.js contract).
import { expansionObjects, defOf, isLive, levelFromXp, DEBRIS_RULES } from '../../content/index.js';
import { FARM_MIN, FARM_MAX, WORLD_TILES } from '../../content/config.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { canFit, countDef, objectOf, getGrid, inLand, isGreenhouse } from '../grid.js';
import { available, consume } from '../economy.js';
import { settled } from '../time.js';
import { landRow, landTarget, parcelPieces, nextParcel } from '../land.js';
import { payCode, pay, newObject, arrivals } from './decor.js';
import { _wishRelease, nextWishReleaseAt } from './storage.js';
import { _rain, rainHoursDue, nextRainAt } from './farming.js';
import { _beauty, beautyDue, beautyNextAt } from './beauty.js';
import { _townPost, _townBuild, townPostCode, townBuildAt } from './town.js';
import { _petFind, petFindsDue, nextPetFindAt } from './pets.js';

const PLANKS = 'planks';
const CRATES = 'wooden_crate';

// Wave 5 (owner wish L2-4, fewer bigger expansions): land is bought by PARCEL (content's CONTENT.parcels, k order;
// shared/rules/land.js), each adding its PIECES (the old expansion rows, still what farm.expansions lists). The
// `expansion` argument names the parcel (a piece's id is taken as its parcel's); land cards (`farm.proofs`) are keyed
// by parcel. A build without parcels treats every expansion row as its own parcel (the old behaviour).

/** The parcel row an `expansion` argument names (a piece counts as its parcel), or undefined. */
const rowOfArg = (id) => {
  const r = landRow(landTarget(id));
  return r && isLive(r) && r.retired !== true ? r : undefined;
};

/**
 * Progress of one proof task: { have, need, done }. State verbs (own) read the farm's SETTLED objects (past their
 * undo receipt at `now`, RC-05); deeds count since opening. Without `now` every object counts as settled (display
 * only, like ribbons.js ribbonValue): rules always pass ctx.now. `expansionId` = the parcel (its card).
 */
export function proofProgress(state, expansionId, i, now = Infinity) {
  const t = landRow(expansionId).proof[i];
  const have = t.verb === 'own' ? countDef(state, t.ref, (o) => settled(o, now))
    : state.farm.proofs[expansionId]?.n[String(i)] ?? 0;
  return { have: Math.min(have, t.qty), need: t.qty, done: have >= t.qty };
}

/** The next land to buy: the first parcel in k order the farm does not own whole, or null. */
export const nextExpansion = (state) => nextParcel(state);

export const openExpansion = {
  schema: { expansion: V.text(32) },
  check(state, a) {
    const e = rowOfArg(a.expansion);
    if (!e) return ERR.BAD_ARGS;
    if (e.k === 0 || parcelPieces(e.id).every((x) => state.farm.expansions.includes(x))) return ERR.ALREADY_DONE;
    return Object.hasOwn(state.farm.proofs, e.id) ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    const e = rowOfArg(a.expansion);
    tx.set(['farm', 'proofs', e.id], { at: ctx.now, n: {} });
    tx.emit({ e: 'expansionOpened', expansion: e.id, by: ctx.pid });
  },
};

/** Why `id` (a parcel; a piece counts as its parcel) cannot be bought now (null = it can, coins and BIG_SPEND aside). */
export function expandCode(state, id, now = Infinity) {
  const e = rowOfArg(id);
  if (!e) return ERR.BAD_ARGS;
  const next = nextExpansion(state);
  if (!next || next.id !== e.id) {
    return parcelPieces(e.id).every((x) => state.farm.expansions.includes(x)) ? ERR.ALREADY_DONE : ERR.LOCKED;
  }
  if (levelFromXp(state.farm.xp) < e.unlock) return ERR.LOCKED;
  const proof = e.proof ?? [];
  if (proof.length && !Object.hasOwn(state.farm.proofs, e.id)) return ERR.NOT_READY;
  for (let i = 0; i < proof.length; i++) if (!proofProgress(state, e.id, i, now).done) return ERR.NOT_READY;
  if (available(state, PLANKS) < (e.planks ?? 0) || available(state, CRATES) < (e.crates ?? 0)) return ERR.NO_ITEMS;
  return null;
}

/**
 * Put the objects that arrive with land `pieces` (content expansionObjects: free trees / decor / the wild hive, and
 * with `debris` the piece's debris) where they still fit; returns the ids placed. Shared by `expand` and `_land`.
 */
export function landArrivals(tx, ctx, pieces, { debris = true } = {}) {
  const ids = [];
  for (const piece of pieces) {
    for (const x of expansionObjects(piece)) {
      const def = defOf(x.def);
      if (!def || !isLive(def) || (!debris && def.kind === 'debris')) continue;
      if (objectOf(tx.state, x.id) || canFit(tx.state, x.def, x.x, x.z, x.rot)) continue;
      const o = newObject(tx.state, def, x.x, x.z, x.rot, ctx.now, 'sys');
      if (def.kind === 'debris') o.origin = 'expansion';
      else o.free = true;
      if (def.kind === 'tree' && x.mature) {
        Object.assign(o, { matureAt: ctx.now, startedAt: ctx.now, readyAt: ctx.now });   // wild and ripe at once
      }
      tx.set(['farm', 'objects', x.id], o);
      arrivals(tx, ctx, x.id, (i) => `${x.id}.${i}`);                 // the Bee Glade's wild hive brings its colony
      ids.push(x.id);
    }
  }
  return ids;
}

export const expand = {
  schema: { expansion: V.text(32) },
  check(state, a, ctx) {
    return expandCode(state, a.expansion, ctx.now)
      ?? payCode(state, a, ctx, { coins: rowOfArg(a.expansion).cost, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const e = rowOfArg(a.expansion);
    const planks = e.planks ?? 0;
    const crates = e.crates ?? 0;
    pay(tx, ctx, { coins: e.cost, acorns: 0 }, `land:${e.id}`, e.id);
    if (planks > 0) consume(tx, PLANKS, planks);
    if (crates > 0) consume(tx, CRATES, crates);
    const owned = tx.state.farm.expansions;
    const pieces = parcelPieces(e.id).filter((x) => !owned.includes(x));
    tx.set(['farm', 'expansions'], [...owned, ...pieces]);
    if (Object.hasOwn(tx.state.farm.proofs, e.id)) tx.del(['farm', 'proofs', e.id]);
    landArrivals(tx, ctx, pieces);
    tx.emit({ e: 'expanded', expansion: e.id, pieces, by: ctx.pid, coins: e.cost, planks, crates });
  },
};

// ---- debris regrowth (system) ---------------------------------------------------------------------------------

const REGROW_MS = DEBRIS_RULES.regrowEveryMs;

/** Debris pieces waiting that regrew (origin 'regrow'). */
const regrownCount = (state) => Object.values(state.farm.objects).filter((o) => o.origin === 'regrow').length;

/** Free 1x1 object-layer tiles inside the unlocked land, row-major (canonical order). */
export function freeTiles(state) {
  const g = getGrid(state);
  const out = [];
  for (let z = FARM_MIN; z < FARM_MAX; z++) {
    for (let x = FARM_MIN; x < FARM_MAX; x++) {
      const i = z * WORLD_TILES + x;
      // never inside a Greenhouse: its aisle is glass and gravel, not a place for weeds
      if (g.object[i] === null && inLand(state, x, z) && !(g.ground[i] !== null && isGreenhouse(state, g.ground[i]))) {
        out.push([x, z]);
      }
    }
  }
  return out;
}

export const _regrow = {
  schema: {},
  check(state, a, ctx) {
    return ctx.now >= state.farm.regrow.at + REGROW_MS ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    const ticks = Math.floor((ctx.now - tx.state.farm.regrow.at) / REGROW_MS);
    tx.set(['farm', 'regrow'], { at: tx.state.farm.regrow.at + ticks * REGROW_MS });
    const add = Math.min(ticks, Math.max(0, DEBRIS_RULES.regrowMax - regrownCount(tx.state)));
    const ids = [];
    for (let i = 0; i < add; i++) {
      const tiles = freeTiles(tx.state);
      if (tiles.length === 0) break;
      const n = tx.state.farm.rolls.regrow ?? 0;
      tx.inc(['farm', 'rolls', 'regrow'], 1);
      const [x, z] = tiles[Math.floor(ctx.rng('regrowTile', n) * tiles.length)];
      const kinds = DEBRIS_RULES.regrowKinds;
      const def = kinds[Math.floor(ctx.rng('regrowKind', n) * kinds.length)];
      const id = ctx.newId(i);
      tx.set(['farm', 'objects', id], { def, x, z, rot: 0, placedAt: ctx.now, by: 'sys', origin: 'regrow' });
      ids.push(id);
    }
    if (ids.length) tx.emit({ e: 'regrown', ids });
  },
};

/** The economy's due system actions at `now`, in a fixed order. */
export function econDue(state, now) {
  const due = [];
  if (now >= state.farm.regrow.at + REGROW_MS) due.push({ type: '_regrow', args: {} });
  if (nextWishReleaseAt(state) <= now) due.push({ type: '_wishRelease', args: {} });
  if (rainHoursDue(state, now).length) due.push({ type: '_rain', args: {} });
  const b = beautyDue(state, now);
  if (b.stars > 0 || b.sets.length > 0) due.push({ type: '_beauty', args: {} });
  if (townBuildAt(state) <= now) due.push({ type: '_townBuild', args: {} });
  else if (townPostCode(state, now) === null) due.push({ type: '_townPost', args: {} });
  if (petFindsDue(state, now).length) due.push({ type: '_petFind', args: {} });
  return due;
}

/**
 * The earliest future moment econDue() grows (Infinity when nothing waits). A Town Project waiting for its third
 * eligible good, or Farm Beauty reached by a placement, become due through the action that changed the farm (the
 * server re-reads the due list after every action), so only the clocks are listed here.
 */
export function econNextDueAt(state, now) {
  return Math.min(state.farm.regrow.at + REGROW_MS, nextWishReleaseAt(state), nextRainAt(state, now),
    beautyNextAt(state, now), townBuildAt(state), nextPetFindAt(state, now));
}

/** The economy's system actions (also registered through this family and storage.js). */
export const ECON_SYSTEM_ACTIONS = Object.freeze({ _regrow, _wishRelease, _rain, _beauty, _townPost, _townBuild,
  _petFind });
