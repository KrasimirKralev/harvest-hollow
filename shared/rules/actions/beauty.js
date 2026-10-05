// Farm Beauty, decor sets and Masterwork (GDD §3.8, §5.9; L18). Owned by rules-economy.
//
// Farm Beauty is a pure function of the placed objects (beautyOf): the sum of decor beauty, where the 2nd copy of a
// decor counts 50 % and later copies 25 % (the most beautiful copies count first), a piece touching a path tile gets
// +10 %, a piece of a completed decor set +25 %, a Masterwork piece x1.5 / x2; plus 3 per building (homes and the
// Greenhouse included), 2 per tree, and the collection perks' beauty. Stars at 50 / 150 / 400 / 900 / 1,800.
// Its effects: each NEW star pays 3 Acorns once (farm.beauty.stars is the high-water mark) and every current star
// adds +1 % to order coins, at most +5 % (beautyOrderBp, for rules-goals' orders). Stars, sets and the order bonus
// count SETTLED objects only (past their 10-minute undo receipt), so a buy-and-undo loop earns nothing (§9 #9).
//
// A decor set (L18) is complete when one copy of each of its pieces stands within `radius` tiles of every other
// (pairwise, Chebyshev between footprints); one farm may hold several complete groups of a set, each gets the bonus.
//
//   masterwork {id, max?}   upgrade a coin decor: level 1 for 4 x its price (beauty x1.5), level 2 for 16 x (x2).
//                           The coins join the piece's `paid` (its resale stays 50 % of everything paid); like a slot
//                           or capacity upgrade it has no undo. A Masterwork piece is moved, never stored.
//   _beauty {}              system: pays the stars and records first set completions (econDue says when)
import { CONTENT, FARM_BEAUTY, MASTERWORK, defOf, isLive, levelFromXp } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { getGrid, objFootprint, inWorld } from '../grid.js';
import { WORLD_TILES } from '../../content/config.js';
import { sortedKeys } from '../order.js';
import { settled } from '../time.js';
import { GRID_VERSION, OBJ_VERSION, hide } from '../grid-cache.js';
import { mulBp, collectionPerk, PRICE_SEEN, ERR_PRICE } from '../economy.js';
import { payCode, pay } from './decor.js';

const B = FARM_BEAUTY;
/** Beauty is computed in 1/10000 of a point (content beauty10 = tenths of a point). */
const UNIT = 10_000;

const rectOf = (o) => {
  const [w, d] = objFootprint(o);
  return { x: o.x, z: o.z, w, d };
};
const gap = (a, b) => Math.max(0, a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1), a.z - (b.z + b.d - 1),
  b.z - (a.z + a.d - 1));

/** True when Farm Beauty is part of this build and the farm has reached its level. */
export const beautyLive = (state) => isLive(B) && levelFromXp(state.farm.xp) >= B.unlock;

/** Stars for a score (0-5). */
export const starsFor = (score) => B.stars.filter((t) => score >= t).length;

/** The best path bonus (bp) on a tile edge-adjacent to the rect (paths themselves never receive it). */
function pathBp(state, g, r) {
  let best = 0;
  const look = (x, z) => {
    if (!inWorld(x, z)) return;
    const id = g.ground[z * WORLD_TILES + x];
    const bp = id ? defOf(state.farm.objects[id].def)?.effect?.pathBonusBp ?? 0 : 0;
    if (bp > best) best = bp;
  };
  for (let x = r.x; x < r.x + r.w; x++) { look(x, r.z - 1); look(x, r.z + r.d); }
  for (let z = r.z; z < r.z + r.d; z++) { look(r.x - 1, z); look(r.x + r.w, z); }
  return best;
}

/**
 * Complete decor-set groups among `decorIds` (sorted ids of placed decor): [{ set, ids }]. Deterministic: pieces are
 * tried rarest first, copies in id order; each copy serves at most one group of a set.
 */
export function decorGroups(state, decorIds) {
  const level = levelFromXp(state.farm.xp);
  const byDef = new Map();
  for (const id of decorIds) {
    const def = state.farm.objects[id].def;
    if (!byDef.has(def)) byDef.set(def, []);
    byDef.get(def).push(id);
  }
  const out = [];
  for (const set of CONTENT.decorSets.values()) {
    if (!isLive(set) || level < set.unlock) continue;
    const used = new Set();
    const pieces = set.pieces.map((p) => byDef.get(p) ?? []).sort((a, b) => a.length - b.length);
    if (pieces.some((c) => c.length === 0)) continue;
    let budget = 20_000;                                 // a hard bound; fences can be hundreds of copies
    const pick = (k, chosen) => {
      if (k === pieces.length) return chosen;
      for (const id of pieces[k]) {
        if (--budget < 0) return null;
        if (used.has(id)) continue;
        const r = rectOf(state.farm.objects[id]);
        if (!chosen.every((c) => gap(r, rectOf(state.farm.objects[c])) <= set.radius)) continue;
        const done = pick(k + 1, [...chosen, id]);
        if (done) return done;
      }
      return null;
    };
    for (;;) {
      const g = pick(0, []);
      if (!g) break;
      for (const id of g) used.add(id);
      out.push({ set: set.id, ids: g.sort() });
    }
  }
  return out;
}

/**
 * Farm Beauty now (pure; the UI shows it live, the rules pay on the settled version).
 * @param {object} state @param {number} [now] @param {{ settledOnly?: boolean }} [o] count only objects past their
 *   undo receipt at `now`
 * @returns {{ score, stars, next, showcase, parts: { decor, buildings, trees, perks }, groups: [{set, ids}],
 *   byId: { [id]: tenths } }}  next = the score of the next star (null at 5)
 */
export function beautyOf(state, now = Infinity, { settledOnly = false } = {}) {
  // memoised per object/grid version, level and perk, and (settled) per span of time in which no receipt settles:
  // `_beauty`'s due check runs before every act and after every commit, ~8 ms a call on an L24 farm (QA2 SV-02)
  const key = `${state[OBJ_VERSION] ?? 0}|${state[GRID_VERSION] ?? 0}|${state.farm.xp}|${collectionPerk(state, 'beauty10')}`;
  const memo = state[BEAUTY_MEMO];
  const c = memo && memo[settledOnly ? 1 : 0];
  if (c && c.objs === state.farm.objects && c.key === key && (!settledOnly || (c.lo <= now && now < c.hi))) return c.out;
  const out = beautyNow(state, now, settledOnly);
  let lo = -Infinity;
  let hi = Infinity;
  if (settledOnly) {
    for (const o of Object.values(state.farm.objects)) {
      const u = o.rcpt?.until;
      if (!Number.isSafeInteger(u)) continue;
      if (u <= now) lo = Math.max(lo, u);
      else hi = Math.min(hi, u);
    }
  }
  const next = memo ? [...memo] : [null, null];
  next[settledOnly ? 1 : 0] = { objs: state.farm.objects, key, lo, hi, out };
  hide(state, BEAUTY_MEMO, next);
  return out;
}

const BEAUTY_MEMO = Symbol('hh.beautyMemo');

function beautyNow(state, now, settledOnly) {
  const g = getGrid(state);
  const decor = [];
  let buildings = 0;
  let trees = 0;
  for (const id of sortedKeys(state.farm.objects)) {
    const o = state.farm.objects[id];
    const def = defOf(o.def);
    if (!def || def.layer === 'none' || (settledOnly && !settled(o, now))) continue;
    if (def.kind === 'decor') decor.push(id);
    else if (def.kind === 'building' || def.kind === 'home' || def.greenhouse) buildings += B.building;
    else if (def.kind === 'tree') trees += B.tree;
  }
  const groups = decorGroups(state, decor);
  const inSet = new Set(groups.flatMap((x) => x.ids));
  // copy order per def: the most beautiful copy counts 100 %, the next 50 %, the rest 25 %
  const base = new Map();
  for (const id of decor) {
    const o = state.farm.objects[id];
    const def = defOf(o.def);
    const mw = o.mw ? MASTERWORK.beautyBp[o.mw - 1] : UNIT;
    base.set(id, mulBp((def.beauty10 ?? 0) * 1000, mw));
  }
  const ranked = [...decor].sort((a, b) => {
    const da = state.farm.objects[a].def;
    const db = state.farm.objects[b].def;
    if (da !== db) return da < db ? -1 : 1;
    return base.get(b) - base.get(a) || (a < b ? -1 : 1);
  });
  const byId = {};
  let sum = 0;
  let rank = 0;
  ranked.forEach((id, i) => {
    rank = i > 0 && state.farm.objects[ranked[i - 1]].def === state.farm.objects[id].def ? rank + 1 : 0;
    const o = state.farm.objects[id];
    const def = defOf(o.def);
    let v = mulBp(base.get(id), B.copyBp[Math.min(rank, B.copyBp.length - 1)]);
    const path = def.effect?.pathBonusBp ? 0 : pathBp(state, g, rectOf(o));
    const set = inSet.has(id) ? B.setBp : 0;
    v = mulBp(v, UNIT + path + set);
    byId[id] = Math.floor(v / 1000);
    sum += v;
  });
  const perks = collectionPerk(state, 'beauty10') * 1000;
  const total = sum + (buildings + trees) * UNIT + perks;
  const score = Math.floor(total / UNIT);
  const stars = starsFor(score);
  // Showcase points (GDD §5.9, M2): the score past the last star, for rules-goals' Showcase ribbons (L38)
  const showcase = Math.max(0, score - B.stars[B.stars.length - 1]);
  return { score, stars, next: stars < B.stars.length ? B.stars[stars] : null, showcase,
    parts: { decor: Math.floor(sum / UNIT), buildings, trees, perks: Math.floor(perks / UNIT) }, groups, byId };
}

/** Stars the farm holds now for its effects (settled objects; 0 before L18). */
export function beautyStars(state, now) {
  return beautyLive(state) ? beautyOf(state, now, { settledOnly: true }).stars : 0;
}

/** Order coins bonus of Farm Beauty (bp): +1 % per current star, at most +5 % (rules-goals' orderFill applies it). */
export function beautyOrderBp(state, now) {
  return Math.min(5, beautyStars(state, now)) * B.orderCoinsBpPerStar;
}

/** What `_beauty` would pay now: { stars, sets: [{set, ids}] } (empty when nothing). */
export function beautyDue(state, now) {
  if (!beautyLive(state)) return { stars: 0, sets: [] };
  const b = beautyOf(state, now, { settledOnly: true });
  const sets = [];
  for (const g of b.groups) {
    // the first group of a set the farm never completed before (groups come in set order, one set at a time)
    if (!Object.hasOwn(state.farm.beauty.sets, g.set) && !sets.some((x) => x.set === g.set)) sets.push(g);
  }
  return { stars: Math.max(0, b.stars - state.farm.beauty.stars), score: b.score, total: b.stars, sets };
}

/** The next moment a settling receipt could change the settled beauty (Infinity when none). */
export function beautyNextAt(state, now) {
  if (!beautyLive(state)) return Infinity;
  let at = Infinity;
  for (const o of Object.values(state.farm.objects)) {
    if (o.rcpt && Number.isSafeInteger(o.rcpt.until) && o.rcpt.until > now && o.rcpt.until < at) {
      const def = defOf(o.def);
      if (def && (def.kind === 'decor' || def.kind === 'building' || def.kind === 'home' || def.kind === 'tree')) {
        at = o.rcpt.until;
      }
    }
  }
  return at;
}

export const _beauty = {
  schema: {},
  check(state, a, ctx) {
    const d = beautyDue(state, ctx.now);
    return d.stars > 0 || d.sets.length > 0 ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    const d = beautyDue(tx.state, ctx.now);
    if (d.stars > 0) {
      const from = tx.state.farm.beauty.stars;
      const acorns = d.stars * B.starAcorns;
      tx.set(['farm', 'beauty', 'stars'], d.total);
      tx.inc(['farm', 'wallet', 'acorns'], acorns);
      tx.emit({ e: 'beautyStar', stars: d.total, from, score: d.score, acorns, by: ctx.pid });
    }
    for (const x of d.sets) {
      tx.set(['farm', 'beauty', 'sets', x.set], ctx.now);
      tx.emit({ e: 'decorSet', set: x.set, ids: x.ids });
    }
  },
};

// ---- Masterwork ----------------------------------------------------------------------------------------------

/** The price of object `o`'s next Masterwork level, or { code } (pure: the decor card previews with it). */
export function masterworkPrice(state, o) {
  const def = o && defOf(o.def);
  if (!def || def.kind !== 'decor') return { code: ERR.NOT_FOUND };
  if (!isLive(MASTERWORK) || levelFromXp(state.farm.xp) < MASTERWORK.unlock) return { code: ERR.LOCKED };
  if (def.tier !== 'coin' || !(def.cost > 0) || def.retired) return { code: ERR.LOCKED };   // coin decor only
  const level = o.mw ?? 0;
  if (level >= MASTERWORK.priceMul.length) return { code: ERR.CAP };
  return { coins: def.cost * MASTERWORK.priceMul[level], level: level + 1 };
}

export const masterwork = {
  schema: { id: V.objId, max: V.opt(PRICE_SEEN) },
  check(state, a, ctx) {
    const o = Object.hasOwn(state.farm.objects, a.id) ? state.farm.objects[a.id] : null;
    const p = masterworkPrice(state, o);
    if (p.code) return p.code;
    if (a.max !== undefined && p.coins > a.max && !confirmed(a, ERR_PRICE)) return ERR_PRICE;
    return payCode(state, a, ctx, { coins: p.coins, acorns: 0 });
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const p = masterworkPrice(tx.state, o);
    const paid = o.paid ?? { coins: 0, acorns: 0 };                    // read before the writes (o is live)
    pay(tx, ctx, { coins: p.coins, acorns: 0 }, `masterwork:${o.def}`, o.def);
    tx.set(['farm', 'objects', a.id, 'mw'], p.level);
    tx.set(['farm', 'objects', a.id, 'paid'], { coins: paid.coins + p.coins, acorns: paid.acorns });
    tx.del(['farm', 'objects', a.id, 'rcpt']);
    tx.emit({ e: 'masterworked', id: a.id, def: o.def, level: p.level, by: ctx.pid, coins: p.coins });
  },
};
