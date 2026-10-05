// The townsfolk board and Friendship (GDD §5.3, from L21; content: weekly.js TOWNSFOLK, npcs.js). Owned by
// rules-goals.
//
// Every Monday (the `_rollover` of a new week, or at once when the board unlocks mid-week) three townsfolk post a
// request on the board by the Market: 2-3 goods worth about E x 0.5 h, chosen by the order rules (G-VALID, the
// novelty weight, no shared inputs, at most 4 machine-hours; an item is in at most two open orders, the board's
// included). Each pays like an order (1.5 x V, 80 % coins / 20 % XP) plus 1 Friendship with that townsperson.
// Unfinished requests simply leave with the week: the next Monday replaces them. Once a week, the couple that hands
// in all three gets a fresh board at once (`r` = the week of that refresh: wave-2 QA RC-11, the L20-25 evenings had
// nothing left to do for the village).
// Friendship (0-10 per townsperson): golden orders +1 (their giver), requests +1, chain quests +2 (the card's giver),
// one liked-item gift a day +1. Every TOWNSFOLK.friendship.rewardEvery points pay the townsperson's next gift
// (TOWNSFOLK.friendship.rewards[npc]: a decor into the build tray, or a recipe-card variant kept in `cards`).
//
// farm.folk = {
//   w      the week the posts belong to (-1 none yet)          n    requests posted so far (the rng key)
//   r?     the week the board was refreshed after all three were handed in (once a week)
//   posts: { [i]: { npc, n, items: { [item]: qty }, coins, xp, value, done: null | { by, at }, flag?: pid | null } }
//   f:     { [npc]: { v, d } }      Friendship v (0-10) and the farm day of the last liked-item gift
//   cards: { [npc]: [item] }        recipe-card variants earned
// }
//   folkFill { i, n }        hand in a request (all goods at once); n = the request's own number (stale: NOT_FOUND)
//   folkFlag { i, n }        toggle "Need help" on a request (GDD §6.2 #3): the OTHER player filling it adds 10 % XP
//                            and a Heart each
//   folkGift { npc, item }   give a townsperson one of the goods they like (once a day each; RESERVED below Keep N)
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { TOWNSFOLK, COOP, CONTENT, npcOf, itemOf, levelFromXp, eHours } from '../../content/index.js';
import { available, consume, unkept, earn } from '../economy.js';
import { sortedKeys } from '../order.js';
import { systemLive, weekOf, dayOf } from '../coop.js';
import { chooseGoods, fillable } from '../orders-board.js';
import { giveObject } from '../progress.js';

const BP = 10_000;
const MIN = 60_000;

/** True when the board plays in this build and the farm has its level. */
export const folkUnlocked = (state) => systemLive(TOWNSFOLK) && levelFromXp(state.farm.xp) >= TOWNSFOLK.unlock;

/** Townsfolk who may post at level L (live, speaking by then), canonical order. */
export function townsfolk(L) {
  return [...CONTENT.npcs.values()].filter((n) => n.townsfolk && systemLive(n) && (n.from ?? 1) <= L)
    .map((n) => n.id).sort();
}

/** Post this week's requests (replacing last week's). */
export function postWeek(tx, ctx) {
  const state = tx.state;
  const L = levelFromXp(state.farm.xp);
  const w = weekOf(state, ctx.now);
  const f = state.farm.folk;
  tx.set(['farm', 'folk', 'posts'], {});
  tx.set(['farm', 'folk', 'w'], w);
  let n = f.n;
  const people = townsfolk(L);
  const chosen = [];
  for (let j = 0; j < TOWNSFOLK.postsPerWeek && people.length > chosen.length; j++) {
    const left = people.filter((p) => !chosen.includes(p));
    const npc = left[Math.floor(ctx.rng('folk', n, 'npc') * left.length)];
    const [lo, hi] = TOWNSFOLK.goods;
    const k = lo + Math.floor(ctx.rng('folk', n, 'k') * (hi - lo + 1));
    const items = chooseGoods(tx.state, ctx.now, ctx.rng, ['folk', n],
      { budget: eHours(L, TOWNSFOLK.valueHoursBp), k, machineMinutes: Math.floor(TOWNSFOLK.maxMachineMs / MIN) });
    n++;
    if (!items) continue;
    chosen.push(npc);
    let v = 0;
    for (const i of sortedKeys(items)) v += itemOf(i).sell * items[i];
    const value = Math.floor((v * TOWNSFOLK.payBp) / BP);
    const coins = Math.max(1, Math.floor((value * TOWNSFOLK.coinShareBp) / BP));
    const xp = Math.max(1, Math.floor((value - coins) / 8));
    const post = { npc, n: n - 1, items, coins, xp, value, done: null, flag: null };
    tx.set(['farm', 'folk', 'posts', String(chosen.length - 1)], post);
  }
  tx.set(['farm', 'folk', 'n'], n);
  tx.emit({ e: 'folkPosted', w, n: chosen.length, by: ctx.pid });
}

/** True when the board needs this week's requests (a new week, or the board just unlocked). */
export const folkDue = (state, now) => folkUnlocked(state) && Boolean(state.farm.folk)
  && state.farm.folk.w < weekOf(state, now);

/** A level-up into the board posts this week's requests at once. */
export function folkOnLevel(tx, ctx, L) {
  if (L === TOWNSFOLK.unlock && folkDue(tx.state, ctx.now)) postWeek(tx, ctx);
}

/** Friendship of a townsperson (0-10). */
export const friendshipOf = (state, npc) => state.farm.folk?.f?.[npc]?.v ?? 0;

/**
 * Add Friendship with a townsperson (from L21); every `rewardEvery` points crossed pays that step's gift.
 * @returns {number} points added
 */
export function befriend(tx, ctx, npc, n, why) {
  const fr = TOWNSFOLK.friendship;
  const d = npcOf(npc);
  if (!folkUnlocked(tx.state) || !tx.state.farm.folk || !d || !d.townsfolk || !systemLive(d) || !(n > 0)) return 0;
  const cur = tx.state.farm.folk.f[npc] ?? { v: 0, d: -1 };
  const v = Math.min(fr.max, cur.v + n);
  if (v === cur.v) return 0;
  tx.set(['farm', 'folk', 'f', npc], { ...cur, v });
  for (let step = Math.floor(cur.v / fr.rewardEvery) + 1; step <= Math.floor(v / fr.rewardEvery); step++) {
    const g = fr.rewards?.[npc]?.[step - 1];
    if (g && g.decor) giveObject(tx, ctx, g.decor, 1);
    if (g && g.card) tx.set(['farm', 'folk', 'cards', npc], [...(tx.state.farm.folk.cards?.[npc] ?? []), g.card]);
    tx.emit({ e: 'friendship', npc, v: step * fr.rewardEvery, step, gift: g ?? null, by: ctx.pid });
  }
  tx.emit({ e: 'befriended', npc, v, n: v - cur.v, why, by: ctx.pid });
  return v - cur.v;
}

function postCode(state, a) {
  if (!folkUnlocked(state)) return ERR.LOCKED;
  const p = state.farm.folk?.posts?.[String(a.i)];
  if (!p || p.n !== a.n) return ERR.NOT_FOUND;
  return p.done !== null ? ERR.ALREADY_DONE : null;
}

export const folkFill = {
  schema: { i: V.int(0, 9), n: V.int(0, 1_000_000_000) },
  check(state, a, ctx) {
    const code = postCode(state, a);
    if (code) return code;
    if (state.farm.folk.w !== weekOf(state, ctx.now)) return ERR.NOT_FOUND;   // last week's: it has left
    return fillable(state, state.farm.folk.posts[String(a.i)]) ? null : ERR.NO_ITEMS;
  },
  apply(tx, a, ctx) {
    const key = String(a.i);
    const p = tx.get(['farm', 'folk', 'posts', key]);
    for (const item of sortedKeys(p.items)) consume(tx, item, p.items[item]);
    earn(tx, ctx, p.coins, 'townsfolk');
    const helped = typeof p.flag === 'string' && p.flag !== ctx.pid ? p.flag : null;
    const xp = helped ? p.xp + Math.floor((p.xp * COOP.helpFlags.xpBonusBp) / BP) : p.xp;
    tx.set(['farm', 'folk', 'posts', key], { ...p, done: { by: ctx.pid, at: ctx.now }, flag: null });
    // XP, the feed, the help flag's Hearts and Friendship are credited from this event (progress.js)
    tx.emit({ e: 'folkFilled', i: a.i, npc: p.npc, coins: p.coins, xp, value: p.value, items: { ...p.items }, helped,
      by: ctx.pid });
    // all of this week's requests handed in: the townsfolk post a fresh board, once a week (RC-11)
    const f = tx.state.farm.folk;
    const all = sortedKeys(f.posts).every((k) => f.posts[k].done !== null);
    if (all && f.r !== f.w) {
      tx.set(['farm', 'folk', 'r'], f.w);
      postWeek(tx, ctx);
    }
  },
};

export const folkFlag = {
  schema: { i: V.int(0, 9), n: V.int(0, 1_000_000_000) },
  check(state, a, ctx) {
    const code = postCode(state, a);
    if (code) return code;
    if (state.farm.folk.w !== weekOf(state, ctx.now)) return ERR.NOT_FOUND;
    const flag = state.farm.folk.posts[String(a.i)].flag ?? null;
    return typeof flag === 'string' && flag !== ctx.pid ? ERR.OCCUPIED : null;
  },
  apply(tx, a, ctx) {
    const key = String(a.i);
    const flag = (tx.get(['farm', 'folk', 'posts', key, 'flag']) ?? null) === ctx.pid ? null : ctx.pid;
    tx.set(['farm', 'folk', 'posts', key, 'flag'], flag);
    tx.emit({ e: 'folkFlagged', i: a.i, flag, by: ctx.pid });
  },
};

export const folkGift = {
  schema: { npc: V.text(32), item: V.content('items') },
  check(state, a, ctx) {
    if (!folkUnlocked(state)) return ERR.LOCKED;
    const d = npcOf(a.npc);
    if (!d || !d.townsfolk || !systemLive(d) || (d.from ?? 1) > levelFromXp(state.farm.xp)) return ERR.BAD_ARGS;
    if (!(d.likes ?? []).includes(a.item)) return ERR.BAD_ARGS;
    if ((state.farm.folk.f[a.npc]?.d ?? -1) >= dayOf(state, ctx.now)) return ERR.ALREADY_DONE;
    // best friends already: a gift would only cost the good (the UI says so instead of offering it)
    if (friendshipOf(state, a.npc) >= TOWNSFOLK.friendship.max) return ERR.ALREADY_DONE;
    if (available(state, a.item) < 1) return ERR.NO_ITEMS;
    if (unkept(state, a.item) < 1 && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
    return null;
  },
  apply(tx, a, ctx) {
    consume(tx, a.item, 1);
    const cur = tx.state.farm.folk.f[a.npc] ?? { v: 0, d: -1 };
    tx.set(['farm', 'folk', 'f', a.npc], { ...cur, d: dayOf(tx.state, ctx.now) });
    tx.emit({ e: 'folkGifted', npc: a.npc, item: a.item, by: ctx.pid });
    befriend(tx, ctx, a.npc, TOWNSFOLK.friendship.giftPerDay, 'gift');
  },
};

/** The board for the UI: [{ i, npc, n, items, coins, xp, done, fillable }] and Friendship per townsperson. */
export function folkView(state, now) {
  const f = state.farm.folk;
  if (!f) return null;
  const live = f.w === weekOf(state, now);
  const posts = live ? sortedKeys(f.posts).map((k) => ({ i: Number(k), ...f.posts[k],
    fillable: f.posts[k].done === null && fillable(state, f.posts[k]) })) : [];
  const L = levelFromXp(state.farm.xp);
  const people = townsfolk(L).map((npc) => ({ npc, v: friendshipOf(state, npc),
    giftedToday: (f.f[npc]?.d ?? -1) >= dayOf(state, now), likes: npcOf(npc).likes ?? [],
    cards: f.cards?.[npc] ?? [] }));
  return { w: f.w, posts, people, unlocked: folkUnlocked(state) };
}
