// Perks (GDD §4.7, M2; content: shared/content/personal.js PERKS). Owned by rules-goals.
//
// 1 perk point per 2 personal levels (at most 20). Four trees (Grower, Rancher, Orchardist, Artisan) of five perks
// costing 1, 1, 2, 2, 3 points (9 a tree, so a player can complete two trees). A tree's perks are taken in order.
// Perks apply ONLY to the owner's own actions and never change the partner's numbers. A free respec once a week
// (PERKS.respecMs since the last one; the first is free at any time): every point comes back.
//
// players[pid].perks = { t: { [tree]: n perks owned, 0..5 }, r: ms of the last respec | null }
//
//   perkPick { tree }   take the next perk of `tree`: LOCKED (perks not live / below the feature's level), CAP (not
//                       enough free points), ALREADY_DONE (the tree is complete)
//   perkRespec {paid?}  every point back: ALREADY_DONE (nothing to reset), COOLDOWN (the free respec of this week is
//                       used; wave 4: resend with `paid: true` to respec for RESPEC_ACORNS Acorns)
//   perkRefund {tree}   wave 4: the last perk of `tree` back for Acorns (REFUND_ACORNS_PER_POINT a point)
//
// Effects: the four +5 % XP perks (Grower crop XP, Rancher animal XP, Orchardist tree XP, Artisan craft XP) are
// applied by progress.js when the owner's own deed credits XP (perkXpBp). Every other perk is the economy's, read
// with perkValue(state, pid, tree, key) (rules-economy: seeds, bonus units, watering, ribbons, babies, doubles,
// feed, prized animals, fruit, tree prices, Heirloom, queue time, craft sell price, duet outputs).
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { spendAcorns, isBigSpend } from '../economy.js';
import { PERKS, featureOf, personalLevelFromXp, levelFromXp } from '../../content/index.js';
import { systemLive, hasPlayer } from '../coop.js';

/** The tree ids in content order. */
export const PERK_TREES = Object.freeze(Object.keys(PERKS.trees));

/** Fresh perks block of a player (createPlayer and the backfill of older saves). */
export const initialPerks = () => ({ t: {}, r: null });

/** The farm level from which perks play (feature `perks`; 1 when content has no feature row). */
const perksFrom = () => featureOf('perks')?.unlock ?? 1;

/** True when perks play in this build (PERKS.m) and the farm has the feature's level. */
export const perksLive = (state) => systemLive(PERKS) && levelFromXp(state.farm.xp) >= perksFrom();

/** Perks a player owns in a tree (0..5). */
export const perksIn = (state, pid, tree) => {
  const n = state.players[pid]?.perks?.t?.[tree];
  return Number.isSafeInteger(n) ? n : 0;
};

/** Points a player has earned: 1 per PERKS.pointsEvery personal levels, at most PERKS.maxPoints. */
export function perkPoints(state, pid) {
  const p = state.players[pid];
  if (!p) return 0;
  return Math.min(PERKS.maxPoints, Math.floor(personalLevelFromXp(p.xp ?? 0) / PERKS.pointsEvery));
}

/** Points spent on the first `n` perks of a tree. */
const costOf = (n) => PERKS.costs.slice(0, n).reduce((a, b) => a + b, 0);

/** Points a player has spent. */
export function perkSpent(state, pid) {
  let n = 0;
  for (const tree of PERK_TREES) n += costOf(perksIn(state, pid, tree));
  return n;
}

/**
 * The value of one perk effect for a player's own action: `key` of the perks owned in `tree` (content
 * PERKS.trees[tree][i][key]), 0 when not owned, not live, or not a player. A sum when several owned perks of the
 * tree carry the key (none does today).
 */
export function perkValue(state, pid, tree, key) {
  if (!hasPlayer(state, pid) || !systemLive(PERKS) || !Object.hasOwn(PERKS.trees, tree)) return 0;
  const n = perksIn(state, pid, tree);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const x = PERKS.trees[tree][i]?.[key];
    if (Number.isSafeInteger(x)) v += x;
  }
  return v;
}

/** The +5 % XP perk of a deed's family ('crop' | 'animal' | 'tree' | 'craft') for the actor, in basis points. */
const XP_PERK = { crop: ['grower', 'cropXpBp'], animal: ['rancher', 'animalXpBp'], tree: ['orchardist', 'treeXpBp'],
  craft: ['artisan', 'craftXpBp'] };
export function perkXpBp(state, pid, family) {
  const k = XP_PERK[family];
  return k ? perkValue(state, pid, k[0], k[1]) : 0;
}

/** When this player's next free respec is allowed (ms); 0 when it is allowed now or was never used. */
export const respecAt = (state, pid) => {
  const r = state.players[pid]?.perks?.r;
  return Number.isSafeInteger(r) ? r + PERKS.respecMs : 0;
};

/**
 * The perk trees for the UI: points, and each tree's perks with their state.
 * @returns {{ live, points, spent, free, respecAt, respecCost, trees: [{ id, n, refund, perks: [{ i, cost, effect,
 *   owned, next, affordable }] }] }}
 */
export function perksView(state, pid, now) {
  const points = perkPoints(state, pid);
  const spent = perkSpent(state, pid);
  const free = Math.max(0, points - spent);
  const trees = PERK_TREES.map((id) => {
    const n = perksIn(state, pid, id);
    return { id, n, perks: PERKS.trees[id].map((effect, i) => ({ i, cost: PERKS.costs[i], effect: { ...effect },
      owned: i < n, next: i === n, affordable: i === n && PERKS.costs[i] <= free })), refund: refundOf(state, pid, id) };
  });
  const ra = respecAt(state, pid);
  // wave 4: respecCost = Acorns the next respec costs (0 = the weekly free one); each tree's `refund` = { i, points,
  // acorns } to give back its last perk, or null
  return { live: perksLive(state), points, spent, free, respecAt: ra > now ? ra : 0, respecCost: respecCost(state, pid, now),
    trees };
}

export const perkPick = {
  schema: { tree: V.oneOf(...PERK_TREES) },
  check(state, a, ctx) {
    if (!perksLive(state)) return ERR.LOCKED;
    const n = perksIn(state, ctx.pid, a.tree);
    if (n >= PERKS.trees[a.tree].length) return ERR.ALREADY_DONE;
    return perkPoints(state, ctx.pid) - perkSpent(state, ctx.pid) >= PERKS.costs[n] ? null : ERR.CAP;
  },
  apply(tx, a, ctx) {
    const n = perksIn(tx.state, ctx.pid, a.tree);
    const cur = tx.get(['players', ctx.pid, 'perks']);
    if (!cur || typeof cur !== 'object') tx.set(['players', ctx.pid, 'perks'], { t: { [a.tree]: n + 1 }, r: null });
    else tx.set(['players', ctx.pid, 'perks', 't', a.tree], n + 1);
    tx.emit({ e: 'perkPicked', pid: ctx.pid, tree: a.tree, i: n, by: ctx.pid });
  },
};

/** Acorns a respec costs once this week's free one is used (wave 4, owner wish G; content's PERKS.respecAcorns). */
export const RESPEC_ACORNS = PERKS.respecAcorns ?? 8;
/** Acorns per perk point to take back the last perk of a tree (content's PERKS.refundAcornsPerPoint). */
export const REFUND_ACORNS_PER_POINT = PERKS.refundAcornsPerPoint ?? 2;

/** What a respec costs `pid` now: 0 while the weekly free one is available, else RESPEC_ACORNS. */
export const respecCost = (state, pid, now) => (respecAt(state, pid) > now ? RESPEC_ACORNS : 0);

/** The last perk of `tree` that `pid` could give back: { i, points, acorns } or null when the tree is empty. */
export function refundOf(state, pid, tree) {
  const n = perksIn(state, pid, tree);
  if (n <= 0) return null;
  const points = PERKS.costs[n - 1];
  return { i: n - 1, points, acorns: points * REFUND_ACORNS_PER_POINT };
}

/** Can `pid` pay `acorns` for a perk change now: null, NO_ACORNS or an unconfirmed BIG_SPEND. */
function acornCode(state, a, ctx, acorns) {
  if (acorns <= 0) return null;
  if (state.farm.wallet.acorns < acorns) return ERR.NO_ACORNS;
  return isBigSpend(state, ctx.pid, ctx.now, 0, acorns) && !confirmed(a, ERR.BIG_SPEND) ? ERR.BIG_SPEND : null;
}

/**
 * `perkRespec {paid?}`: every point back. Free once a week; after that, with `paid: true`, for RESPEC_ACORNS (the
 * free respec's weekly clock is not moved by a paid one). COOLDOWN = the free one is used and `paid` was not sent.
 */
export const perkRespec = {
  schema: { paid: V.opt(V.bool) },
  check(state, a, ctx) {
    if (!perksLive(state)) return ERR.LOCKED;
    if (perkSpent(state, ctx.pid) === 0) return ERR.ALREADY_DONE;
    const cost = respecCost(state, ctx.pid, ctx.now);
    if (cost > 0 && a.paid !== true) return ERR.COOLDOWN;
    return acornCode(state, a, ctx, cost);
  },
  apply(tx, a, ctx) {
    const back = perkSpent(tx.state, ctx.pid);
    const cost = respecCost(tx.state, ctx.pid, ctx.now);
    if (cost > 0) {
      spendAcorns(tx, ctx, cost, 'respec');
      tx.set(['players', ctx.pid, 'perks', 't'], {});
    } else tx.set(['players', ctx.pid, 'perks'], { t: {}, r: ctx.now });
    tx.emit({ e: 'perksReset', pid: ctx.pid, points: back, acorns: cost, by: ctx.pid });
  },
};

/**
 * `perkRefund {tree}` (wave 4, owner wish G): give back the LAST perk taken in `tree` (perks are taken in order) for
 * REFUND_ACORNS_PER_POINT Acorns per point it cost; its points are free to spend again. ALREADY_DONE: the tree is empty.
 */
export const perkRefund = {
  schema: { tree: V.oneOf(...PERK_TREES) },
  check(state, a, ctx) {
    if (!perksLive(state)) return ERR.LOCKED;
    const r = refundOf(state, ctx.pid, a.tree);
    if (!r) return ERR.ALREADY_DONE;
    return acornCode(state, a, ctx, r.acorns);
  },
  apply(tx, a, ctx) {
    const r = refundOf(tx.state, ctx.pid, a.tree);
    if (r.acorns > 0) spendAcorns(tx, ctx, r.acorns, 'perkRefund');
    if (r.i === 0) tx.del(['players', ctx.pid, 'perks', 't', a.tree]);
    else tx.set(['players', ctx.pid, 'perks', 't', a.tree], r.i);
    tx.emit({ e: 'perkRefunded', pid: ctx.pid, tree: a.tree, i: r.i, points: r.points, acorns: r.acorns, by: ctx.pid });
  },
};
