// Balloon loot crates (wave 4b, owner wish 1; content CRATES in shared/content/wishes4b.js).
//
// The ambient hot-air balloon crosses the farm once every CRATES.everyMs of SERVER time (pass k flies from k x everyMs;
// public/js/render/ambient-life.js balloonAt draws it from the same numbers). At CRATES.dropAtMs into a pass it may
// drop one crate on a parachute onto a free tile of the farm's land. A crate is an object of the landmark-family def
// CRATES.def (kind 'crate', 1 x 1, never moved, stored or sold): { def, x, z, rot: 0, placedAt, by: 'sys', k, until }
//   k      the pass that dropped it: every roll of the crate is keyed on it (server-ordered, replicated)
//   until  when nobody opened it: the crate's loot goes to the Barn by itself (so it never blocks a build spot long)
// farm.crates = { k, n }: the last pass handled (catch-up after downtime handles only the latest) and crates so far.
//
//   _crate {}      (system, time-driven: dueSystemActions) collect expired crates into the Barn, then handle the
//                  newest pass: with chance CRATES.dropBp, while fewer than CRATES.maxOpen crates wait, drop one
//   openCrate {id} either player (predicted): the lid pops, the loot is paid (crateLoot), the crate is gone
//
// Loot (crateLoot, pure): coins (E-hours of the farm's level, rolled in CRATES.coinsBp), XP (a share of the level's
// XP to the next level, rolled in CRATES.xpBp) and at most one extra by weight (Acorns, Golden Seeds, Fertilizer, a
// missing collection item, a reward decor piece). Extras the farm cannot use yet (Fertilizer before its level, a
// finished album) drop out of the draw. Events: crateDropped (render: the parachute), crateOpened (the loot card, the
// fly-to-HUD, the feed line; `auto` when the crate went to the Barn by itself).
import { CRATES, BOOSTS, levelFromXp, levelRow, eHours, itemOf, defOf, isLive, decorOf } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { objectOf, landRects, inLand, getGrid, inWorld, objectsByDef } from '../grid.js';
import { WORLD_TILES } from '../../content/config.js';
import { grant, intake } from '../economy.js';
import { giveObject } from '../progress.js';
import { albumUnlocked, liveSets, missingOf, albumGive } from './album.js';

const BP = 10_000;

/** True while balloon crates play: the content is live (the farm's level is checked by the callers). */
const cratesLive = () => isLive(CRATES);

/** The newest balloon pass whose drop moment is at or before `now` (server time). */
export const passOf = (now) => Math.floor((now - CRATES.dropAtMs) / CRATES.everyMs);

/** When pass `k` drops its crate (server epoch ms). */
export const dropMomentOf = (k) => k * CRATES.everyMs + CRATES.dropAtMs;

/** True for a crate object. */
export const isCrate = (o) => Boolean(o) && o.def === CRATES.def;

/** Ids of the crates waiting on the farm, sorted. No scan at all while there is none (the cached by-def index). */
export function cratesOn(state) {
  if (!(objectsByDef(state).get(CRATES.def)?.length)) return [];
  const objs = state.farm.objects;
  const out = [];
  for (const id of Object.keys(objs)) if (objs[id].def === CRATES.def) out.push(id);
  return out.sort();
}

const unlocked = (state) => cratesLive() && levelFromXp(state.farm.xp) >= CRATES.unlock;
const lastPass = (state) => (Number.isSafeInteger(state.farm.crates?.k) ? state.farm.crates.k : null);

/** True when `_crate` has work: an expired crate, or a new balloon pass since the last one handled. */
export function crateDue(state, now) {
  if (!state.farm.crates) return false;
  for (const id of cratesOn(state)) if (state.farm.objects[id].until <= now) return true;
  if (!unlocked(state)) return false;
  return passOf(now) > lastPass(state);
}

/** The next moment `_crate` will have work (the next pass's drop, a crate's expiry), Infinity when none. */
export function crateNextAt(state, now) {
  if (!state.farm.crates) return Infinity;
  let t = unlocked(state) ? dropMomentOf(Math.max(passOf(now), lastPass(state)) + 1) : Infinity;
  for (const id of cratesOn(state)) t = Math.min(t, state.farm.objects[id].until);
  return t;
}

/**
 * The free tile pass `k` drops its crate on, or null: every tile of the unlocked land with nothing on either layer,
 * in land-rect order (row-major), one picked on the pass's roll. Pure.
 */
export function crateSpot(state, k, rng) {
  const g = getGrid(state);
  const seen = new Set();
  const free = [];
  for (const [x0, z0, w, d] of landRects(state)) {
    for (let z = z0; z < z0 + d; z++) {
      for (let x = x0; x < x0 + w; x++) {
        if (!inWorld(x, z) || !inLand(state, x, z)) continue;
        const i = z * WORLD_TILES + x;
        if (seen.has(i)) continue;
        seen.add(i);
        if (g.object[i] === null && g.ground[i] === null) free.push([x, z]);
      }
    }
  }
  if (!free.length) return null;
  return free[Math.floor(rng('crateTile', k) * free.length)];
}

const pickIn = (rng, [lo, hi], ...keys) => lo + Math.floor(rng(...keys) * (hi - lo + 1));

/**
 * The extras a crate opened by `pid` could hold on this farm now (weights of extras the farm cannot use drop out; a
 * crate that goes to the Barn by itself ('sys') holds no collection find: a find is always somebody's).
 */
function extrasFor(state, pid) {
  const L = levelFromXp(state.farm.xp);
  return CRATES.extras.filter((x) => {
    switch (x.k) {
      case 'fertilizer': return L >= (x.unlock ?? 1) && isLive(itemOf(x.item));
      case 'goldenSeeds': return L >= (BOOSTS.goldenSeeds?.unlock ?? 1);
      case 'collection': return pid !== 'sys' && albumUnlocked(state)
        && liveSets().some((s) => missingOf(state, s).length > 0);
      case 'decor': return x.pool.some((id) => isLive(decorOf(id)));
      default: return true;
    }
  });
}

/**
 * What opening crate `id` pays now (pure; check, apply and the loot card agree). Rolled on (crate, k).
 * @returns {{ coins, xp, extra: null | { k, n?, item?, set?, decor? } }}
 */
export function crateLoot(state, id, ctx) {
  const o = objectOf(state, id);
  const L = levelFromXp(state.farm.xp);
  const rng = ctx.rng;
  const coins = Math.max(1, eHours(L, pickIn(rng, CRATES.coinsBp, 'crate', o.k, 'coins')));
  const toNext = levelRow(L).xpToNext ?? 0;
  const xp = Math.max(1, Math.floor((toNext * pickIn(rng, CRATES.xpBp, 'crate', o.k, 'xp')) / BP));
  const pool = extrasFor(state, ctx.pid);
  const total = pool.reduce((s, x) => s + x.w, 0);
  let roll = Math.floor(rng('crate', o.k, 'extra') * total);
  let x = pool[0];
  for (const e of pool) {
    if (roll < e.w) { x = e; break; }
    roll -= e.w;
  }
  let extra = null;
  if (x && x.k !== 'none') {
    extra = { k: x.k };
    if (x.n) extra.n = pickIn(rng, x.n, 'crate', o.k, 'n');
    if (x.k === 'fertilizer') extra.item = x.item;
    if (x.k === 'collection') {
      const open = liveSets().filter((s) => missingOf(state, s).length > 0);
      const set = open[Math.floor(rng('crate', o.k, 'set') * open.length)];
      const miss = missingOf(state, set);
      Object.assign(extra, { set: set.id, item: miss[Math.floor(rng('crate', o.k, 'item') * miss.length)] });
    }
    if (x.k === 'decor') {
      const ids = x.pool.filter((d) => isLive(decorOf(d)));
      extra.decor = ids[Math.floor(rng('crate', o.k, 'decor') * ids.length)];
    }
  }
  return { coins, xp, extra };
}

/** Pay crate `id`'s loot and remove it (inside an action: openCrate by a player, `_crate` by 'sys'). */
function payCrate(tx, ctx, id, auto) {
  const o = tx.get(['farm', 'objects', id]);
  const { x, z, k } = o;                                    // read before the delete (o is live)
  const loot = crateLoot(tx.state, id, ctx);
  tx.del(['farm', 'objects', id]);
  grant(tx, ctx, loot.coins, 'crate');
  const ev = { e: 'crateOpened', id, def: CRATES.def, x, z, k, by: ctx.pid, coins: loot.coins, xp: loot.xp };
  if (auto) ev.auto = true;
  const e = loot.extra;
  if (e) {
    ev.extra = e.k;
    if (e.k === 'acorns') { tx.inc(['farm', 'wallet', 'acorns'], e.n); ev.acorns = e.n; }
    if (e.k === 'goldenSeeds') { tx.inc(['farm', 'golden'], e.n); ev.goldenSeeds = e.n; }
    if (e.k === 'fertilizer') { intake(tx, e.item, e.n); Object.assign(ev, { item: e.item, qty: e.n }); }
    if (e.k === 'collection') {
      albumGive(tx, ctx, null, e.item, ctx.pid);
      Object.assign(ev, { set: e.set, item: e.item });
    }
    if (e.k === 'decor') { giveObject(tx, ctx, e.decor, 1); ev.decor = e.decor; }
  }
  // progress.js credits the XP (farm XP; the opener's personal share) and writes the feed line from this event
  tx.emit(ev);
}

/** `_crate {}` (system): expired crates to the Barn, then the newest balloon pass may drop one. Catch-up safe. */
export const _crate = {
  schema: {},
  check(state, a, ctx) {
    return crateDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    for (const id of cratesOn(tx.state)) if (tx.state.farm.objects[id].until <= ctx.now) payCrate(tx, ctx, id, true);
    const k = passOf(ctx.now);
    const c = tx.state.farm.crates;
    if (!unlocked(tx.state) || !(k > c.k)) return;
    // only the newest pass (a boot after hours of downtime drops at most one crate, never one per missed pass); its
    // roll and tile are keyed on the pass index, which this write makes replicated state
    tx.set(['farm', 'crates', 'k'], k);
    if (cratesOn(tx.state).length >= CRATES.maxOpen) return;
    if (Math.floor(ctx.rng('crate', k) * BP) >= CRATES.dropBp) return;
    const spot = crateSpot(tx.state, k, ctx.rng);
    const id = `crate.${k.toString(36)}`;
    if (!spot || objectOf(tx.state, id)) return;
    tx.set(['farm', 'objects', id], { def: CRATES.def, x: spot[0], z: spot[1], rot: 0, placedAt: ctx.now, by: 'sys', k,
      until: ctx.now + CRATES.keepMs });
    tx.set(['farm', 'crates', 'n'], c.n + 1);
    tx.emit({ e: 'crateDropped', id, def: CRATES.def, x: spot[0], z: spot[1], k, until: ctx.now + CRATES.keepMs });
  },
};

/** `openCrate {id}`: either player opens a crate on the farm (predicted; the loot is the same on every screen). */
export const openCrate = {
  schema: { id: V.objId },
  check(state, a) {
    const o = objectOf(state, a.id);
    if (!isCrate(o) || !defOf(o.def)) return ERR.NOT_FOUND;
    return null;
  },
  apply(tx, a, ctx) {
    payCrate(tx, ctx, a.id, false);
  },
};
