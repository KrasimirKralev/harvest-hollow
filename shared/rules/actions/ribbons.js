// Achievements, "Ribbons" (GDD §5.4; content: shared/content/ribbons.js). Owned by rules-goals.
//
// State: farm.ribbons = { [id]: { t, at } } for F (farm) and T (together) ribbons, players[pid].ribbons for P
// (personal). `t` is the highest tier earned (1 Bronze, 2 Silver, 3 Gold; hidden ribbons have one tier). A tier
// once earned stays (mode 'state' ribbons read a best-ever value). Evaluation runs at the end of every
// processEvents pass, only for ribbons whose counter (stats key, or derived 'state' value) was touched.
//
// Rewards (RIBBON_REWARDS): F Bronze 1 Acorn + 1 Ribbon Point, Silver 3 Acorns + rosette decor + 2 RP, Gold 8
// Acorns + trophy decor + 5 RP + the farm title. P Bronze 3 Hearts, Silver 8 Hearts (+ an outfit piece, M1b),
// Gold 20 Hearts + the personal title. T: every joined player gets the P reward and the farm the F reward once.
// Hidden: 3 Acorns. Counting rules (exploit-proof) live where the counters are bumped (progress.js).
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import {
  CONTENT, RIBBON_REWARDS, isLive, levelFromXp, personalLevelFromXp, treeOf, animalOf, ribbonOf, FARM_BEAUTY,
} from '../../content/index.js';
import { sortedKeys } from '../order.js';
import { playerIds, hasPlayer, systemLive, liveVersion } from '../coop.js';
import { payReward, giveHearts, giveObject } from '../progress.js';
import { masteryDef } from '../progress.js';
import { feedAdd } from '../feed.js';
import { beautyLive, beautyOf } from './beauty.js';

let BY_STAT = null;
let BY_STAT_V = -1;
/** Live ribbons indexed by the counter they read ('harvest.' / 'craft.' prefixes for distinct families). */
function index() {
  if (BY_STAT && BY_STAT_V === liveVersion()) return BY_STAT;
  BY_STAT = new Map();
  BY_STAT_V = liveVersion();
  for (const r of CONTENT.ribbons.values()) {
    if (!systemLive(r)) continue;
    const key = r.mode === 'distinct' ? r.stat.replace(/\*$/, '') : r.stat;
    if (!BY_STAT.has(key)) BY_STAT.set(key, []);
    BY_STAT.get(key).push(r);
  }
  return BY_STAT;
}

/**
 * Touch the counter of every live counter ribbon (modes sum and distinct) of the farm and of `pid`: the once-a-minute
 * safety net of playTick (daily.js), so a tier its counter already reached is awarded on the next action.
 */
export function touchCounterRibbons(run, pid) {
  if (!run) return;
  for (const [key, list] of index()) {
    for (const r of list) {
      if (r.mode === 'state') continue;
      run.touched.add(r.scope === 'P' ? `${pid}:${key}` : key);
    }
  }
}

// Settled (time.js): past its 10-minute undo receipt. Ribbons that read holdings count settled objects only, so a
// buy-and-undo loop can never earn a ribbon (GDD §9 #9: "achievements count settled spending only").
export { settled } from '../time.js';
import { settled } from '../time.js';

/** Count the farm's distinct live tree species / animal species (settled objects). */
function speciesCount(state, family, now) {
  const seen = new Set();
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    const def = family === 'trees' ? treeOf(o.def) : animalOf(o.def);
    if (!def || !isLive(def) || !settled(o, now)) continue;
    // an animal counts with a settled home only: a hive in its undo window brings its colony (wave-2 QA RC-08)
    if (family === 'trees') seen.add(def.id);
    else if (typeof o.home === 'string' && Object.hasOwn(objs, o.home) && settled(objs[o.home], now)) seen.add(def.id);
  }
  return seen.size;
}

/** Settled objects of a kind (Builder) or of one def (Scarecrow's Day Off). */
function settledCount(state, now, test) {
  let n = 0;
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) if (test(objs[id]) && settled(objs[id], now)) n++;
  return n;
}

/** Settled animals this player named (optionally of one species): Name Game, Chicken Whisperer. */
function namedCount(state, pid, now, species = null) {
  let n = 0;
  const names = state.farm.names ?? {};
  for (const id of Object.keys(names)) {
    const o = Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null;
    if (o && names[id].by === pid && (!species || o.def === species) && settled(o, now)) n++;
  }
  return n;
}

/** Stats whose ribbon value is derived from settled holdings (re-checked as receipts expire, progress.js). */
export const SETTLED_STATS = Object.freeze(['buildsAndSlots', 'treeSpecies', 'animalSpecies', 'placed.scarecrow',
  'showcasePoints']);
export const SETTLED_PLAYER_STATS = Object.freeze(['animalsNamed', 'named.chicken']);

/** Same-species groves (GDD §3.2): four trees of one species whose 2x2 footprints form an exact 4x4 block. */
export function groveCount(state) {
  const at = new Map();
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    if (treeOf(o.def) && Number.isSafeInteger(o.x)) at.set(`${o.x},${o.z}`, o.def);
  }
  let n = 0;
  for (const [k, def] of at) {
    const [x, z] = k.split(',').map(Number);
    if (at.get(`${x + 2},${z}`) === def && at.get(`${x},${z + 2}`) === def && at.get(`${x + 2},${z + 2}`) === def) n++;
  }
  return n;
}

/**
 * Heirloom trees (GDD §3.2 rule 8): settled trees with 60 harvests (the economy's `heirloom` flag, or its harvest
 * count `cycle` at the species' heirloomAt).
 */
function heirloomCount(state, now) {
  let n = 0;
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    const t = treeOf(o.def);
    if (t && (o.heirloom === true || (Number.isSafeInteger(o.cycle) && t.heirloomAt > 0 && o.cycle >= t.heirloomAt))
      && settled(o, now)) n++;
  }
  return n;
}

/** Mastery tracks the farm has been paid Gold ★ (4 stars) for: Golden Touch (M2). */
function goldCount(state) {
  let n = 0;
  const stars = state.farm.stars ?? {};
  for (const id of Object.keys(stars)) if (stars[id] >= 4) n++;
  return n;
}

/** Farm Beauty's Showcase points now (the score past the last star, GDD §5.9), 0 before Beauty plays. */
function showcaseOf(state, now) {
  if (!beautyLive(state)) return 0;
  const b = beautyOf(state, Number.isFinite(now) ? now : undefined);
  const top = FARM_BEAUTY.stars?.at(-1) ?? Infinity;
  return Math.max(0, b.score - top);
}

function starCount(state, family) {
  let n = 0;
  const stars = state.farm.stars ?? {};
  for (const id of Object.keys(stars)) if (stars[id] >= 3 && masteryDef(id)?.family === family) n++;
  return n;
}

/**
 * The value a ribbon reads at `now` (farm-level for F/T, the player's for P). Holdings count only settled objects;
 * without `now` every object counts as settled (display only).
 */
export function ribbonValue(state, r, pid = null, now = Infinity) {
  const stats = r.scope === 'P' ? state.players[pid]?.stats ?? {} : state.farm.stats;
  switch (r.stat) {
    case 'buildsAndSlots':
      return settledCount(state, now, (o) => CONTENT.buildings.has(o.def) || CONTENT.homes.has(o.def))
        + (stats.slotsBought ?? 0);
    case 'placed.scarecrow': return settledCount(state, now, (o) => o.def === 'scarecrow');
    case 'animalsNamed': return namedCount(state, pid, now);
    case 'named.chicken': return namedCount(state, pid, now, 'chicken');
    default: break;
  }
  if (r.mode === 'distinct') {
    const prefix = r.stat.replace(/\*$/, '');
    let n = 0;
    for (const k of Object.keys(stats)) if (k.startsWith(prefix) && stats[k] > 0) n++;
    return n;
  }
  if (r.mode === 'state') {
    switch (r.stat) {
      case 'treeSpecies': return speciesCount(state, 'trees', now);
      case 'animalSpecies': return speciesCount(state, 'animals', now);
      case 'grovesFormed': return Math.max(groveCount(state), state.farm.stats.grovesFormed ?? 0);
      case 'recipesStar3': return starCount(state, 'recipes');
      case 'cropsStar3': return starCount(state, 'crops');
      case 'farmWeeksBest': return state.farm.daily?.weeks?.best ?? 0;
      case 'heirloomTrees': return Math.max(heirloomCount(state, now), state.farm.stats.heirloomTrees ?? 0);
      case 'level': return levelFromXp(state.farm.xp);
      case 'personalLevel': return personalLevelFromXp(state.players[pid]?.xp ?? 0);
      // M2: items at Gold ★ (mastery stars paid at 4), the best NPC league, Farm Beauty's Showcase points (the score
      // past 5★; the best value ever counts)
      case 'goldStars': return goldCount(state);
      case 'bestLeague': return Math.max(stats.bestLeague ?? 0, state.farm.league && state.farm.league.w >= 0
        ? state.farm.league.best : 0);
      case 'showcasePoints': return Math.max(stats.showcasePoints ?? 0, showcaseOf(state, now));
      default: return stats[r.stat] ?? 0;
    }
  }
  const v = stats[r.stat] ?? 0;
  return r.scale ? Math.floor(v / r.scale) : v;
}

/** Tiers reached by a value. */
const tiersFor = (r, v) => r.tiers.filter((t) => v >= t).length;

function heldTier(state, r, pid) {
  const book = r.scope === 'P' ? state.players[pid]?.ribbons : state.farm.ribbons;
  return book && book[r.id] ? book[r.id].t : 0;
}

/** Evaluate the ribbons whose counters this pass touched (progress.js run.touched). */
export function ribbonsAfter(tx, ctx, run) {
  if (!run || run.touched.size === 0 || !tx.state.farm.ribbons) return;
  const touched = [...run.touched].sort();
  run.touched.clear();
  const idx = index();
  const todo = new Map();
  for (const key of touched) {
    const colon = key.indexOf(':');
    const pid = colon > 0 ? key.slice(0, colon) : null;
    const stat = colon > 0 ? key.slice(colon + 1) : key;
    const keys = [stat];
    const dot = stat.indexOf('.');
    if (dot > 0) keys.push(stat.slice(0, dot + 1));
    for (const k of keys) {
      for (const r of idx.get(k) ?? []) {
        if ((r.scope === 'P') !== (pid !== null)) continue;
        todo.set(`${r.id}|${pid ?? ''}`, { r, pid });
      }
    }
  }
  for (const k of [...todo.keys()].sort()) {
    const { r, pid } = todo.get(k);
    if (r.scope === 'P' && !hasPlayer(tx.state, pid)) continue;
    const reached = tiersFor(r, ribbonValue(tx.state, r, pid, ctx.now));
    const held = heldTier(tx.state, r, pid);
    if (reached <= held) continue;
    const path = r.scope === 'P' ? ['players', pid, 'ribbons', r.id] : ['farm', 'ribbons', r.id];
    tx.set(path, { t: reached, at: ctx.now });
    for (let t = held + 1; t <= reached; t++) reward(tx, ctx, run, r, t, pid);
  }
}

function reward(tx, ctx, run, r, t, pid) {
  const pids = r.scope === 'P' ? [pid] : r.scope === 'T' ? playerIds(tx.state) : [];
  if (r.hidden) {
    payReward(tx, ctx, run, { acorns: RIBBON_REWARDS.hidden.acorns }, 'ribbon');
  } else {
    if (r.scope !== 'P') {
      const f = RIBBON_REWARDS.F[t - 1];
      payReward(tx, ctx, run, { acorns: f.acorns }, 'ribbon');
      if (f.decor) giveObject(tx, ctx, f.decor, 1);
    }
    if (r.scope !== 'F') {
      const p = RIBBON_REWARDS.P[t - 1];
      for (const who of pids) giveHearts(tx, ctx, who, p.hearts, 'ribbon');
    }
  }
  tx.emit({ e: 'achievement', id: r.id, tier: t, scope: r.scope, pids, by: ctx.pid });
  feedAdd(tx, ctx, { k: 'ribbon', id: r.id, t, ...(r.scope === 'P' ? { to: pid } : {}) });
}

/** Lifetime Ribbon Points (the Ribbon Wall, GDD §5.4): F and T ribbons' tiers. */
export function ribbonPoints(state) {
  let n = 0;
  const book = state.farm.ribbons ?? {};
  for (const id of Object.keys(book)) {
    const r = ribbonOf(id);
    if (!r || r.hidden) continue;
    for (let t = 1; t <= book[id].t; t++) n += RIBBON_REWARDS.F[t - 1]?.points ?? 0;
  }
  return n;
}

/** Titles a player may wear: Gold-tier ribbon titles of the farm (F/T) and of their own (P). */
export function titlesOf(state, pid) {
  const out = [];
  for (const [book, scope] of [[state.farm.ribbons ?? {}, 'farm'], [state.players[pid]?.ribbons ?? {}, 'P']]) {
    for (const id of sortedKeys(book)) {
      const r = ribbonOf(id);
      const gold = r && r.title && !r.hidden && book[id].t >= r.tiers.length;
      if (gold && (scope === 'P') === (r.scope === 'P')) out.push(id);
    }
  }
  return out;
}

/** `titlePick { ribbon? }`: wear a Gold ribbon's title on the name card; omit it to wear the level title. */
export const titlePick = {
  schema: { ribbon: V.opt(V.content('ribbons')) },
  check(state, a, ctx) {
    if (a.ribbon === undefined) return state.players[ctx.pid].title === null ? ERR.ALREADY_DONE : null;
    if (!titlesOf(state, ctx.pid).includes(a.ribbon)) return ERR.LOCKED;
    return state.players[ctx.pid].title === a.ribbon ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    tx.set(['players', ctx.pid, 'title'], a.ribbon ?? null);
    tx.emit({ e: 'titled', pid: ctx.pid, title: a.ribbon ?? null });
  },
};
