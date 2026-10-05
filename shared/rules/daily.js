// Daily and weekly systems (GDD §5.8, §5.2 meter, §6.2 #15): play tracking, Daily Gift, Farm Weeks, the Daily
// Almanac with its Together task, the Couple Challenge, Mabel's weekly meter and the day/week rollover. Owned by
// rules-goals. Every period is the farm's local calendar (state.meta.tz): days via calendar.dayIndex, Monday weeks.
//
// farm.daily = {
//   day, week            the last day / week `_rollover` ran for (catch-up: one action, never one per missed day)
//   gift:  { n, last }   Daily Gift days claimed (the 28-day calendar cycles) and the day of the last claim
//   play:  { d, first, ok }   the farm's play today: first action time; ok once it spans FARM_WEEKS.minMinutes
//   weeks: { w, days, streak, best, skips }   Farm Weeks: play days this week, the streak, best ever, skip weeks held
//   together: null | { d, tpl, qty, n, by: { pid: n }, done }   the shared Together task of day d
//   season?: { k, n }    in-season harvests of the current season (In Season ribbon; progress.js)
// }
// farm.challenge = { n (challenges started), done (completed), cur: null | { w, tpl, target, n, by: { pid: n },
//   rec: { recipe: 1 }, done } }
// players[pid].play    = { m (minute index), n (active minutes), d (last day played), card (n at the last card) }
// players[pid].almanac = { d, k (roll counter), paid, done, rerolls, chest, tasks: { [slot]: Task } }
//   Task = { tpl, verb, ref, qty, n }    the counted deed vocabulary of progress.js
import {
  CONTENT, ALMANAC, DAILY_GIFT, FARM_WEEKS, COUPLE_CHALLENGE, ORDERS, BOOSTS, BARGE, isLive, levelFromXp, levelRow,
  eHours,
} from '../content/index.js';
import { seasonOf } from './calendar.js';
import { sortedKeys } from './order.js';
import { dayOf, weekOf, hasPlayer, playerIds, onlineOf, systemLive } from './coop.js';
import { payReward, giveHearts, bumpStat, giveObject, creditXp, touch } from './progress.js';
import { SETTLED_STATS, SETTLED_PLAYER_STATS, touchCounterRibbons } from './actions/ribbons.js';
import { feedAdd } from './feed.js';
import { producers, canMake } from './orders-board.js';
import { bargePlay, bargeUnlocked } from './actions/barge.js';
import { openFair, entryPoints10 } from './actions/fair.js';
import { available } from './economy.js';
import { folkDue, postWeek } from './actions/folk.js';
import { albumAnyRoll } from './actions/album.js';
import { seasonPostcard } from './actions/memory.js';

const MIN = 60_000;
const BP = 10_000;

// ---- fresh state --------------------------------------------------------------------------------------------

export function initialDaily(state0, now) {
  const day = dayOf(state0, now);
  const week = weekOf(state0, now);
  return {
    day, week,
    gift: { n: 0, last: -1 },
    play: { d: -1, first: 0, ok: false },
    weeks: { w: week, days: 0, streak: 0, best: 0, skips: 0 },
    together: null,
  };
}
export const initialChallenge = () => ({ n: 0, done: 0, cur: null });
export const initialPlayerPlay = () => ({ m: -1, n: 0, d: -1, card: 0 });
export const initialAlmanac = () => ({ d: -1, k: 0, paid: 0, done: 0, rerolls: 0, chest: false, tasks: {} });

// ---- play tracking (every player action) --------------------------------------------------------------------

/**
 * Once per player action: the player's active minutes (drip-feed pacing), their days played (Farmer's Calendar),
 * the farm's play today (Farm Weeks counts a day once the farm has been played for FARM_WEEKS.minMinutes), and a
 * lazy Almanac / Together-task refresh for a day `_rollover` has not reached on this copy yet.
 */
export function playTick(tx, ctx, run) {
  const pid = ctx.pid;
  const state = tx.state;
  const day = dayOf(state, ctx.now);
  const minute = Math.floor(ctx.now / MIN);
  const p = state.players[pid];
  const play = p.play;
  if (play && (play.m !== minute || play.d !== day)) {
    if (play.d !== day) bumpStat(tx, run, pid, 'daysPlayed');
    // once a minute of play: holdings bought in the last 10 minutes may have settled (their undo receipt expired)
    for (const k of SETTLED_STATS) touch(run, k);
    for (const k of SETTLED_PLAYER_STATS) touch(run, k, pid);
    // and every counter ribbon once a minute, so a tier a counter already reached is never left unawarded (a save
    // from a build that wrote the counter without a touch: wave-2 QA RC-04, High Roller on the live farm)
    touchCounterRibbons(run, pid);
    run.questDirty = true;                    // story state tasks count settled holdings too (RC-05)
    run.questAccept = true;                   // a side-chain card (F/G/H) may have opened (the M1b flip, a new week)
    const n = play.m !== minute ? play.n + 1 : play.n;
    tx.set(['players', pid, 'play'], { m: minute, n, d: day, card: play.card });
  }
  const d = state.farm.daily;
  if (d) {
    if (d.play.d !== day) tx.set(['farm', 'daily', 'play'], { d: day, first: ctx.now, ok: false });
    else if (!d.play.ok && ctx.now - d.play.first >= FARM_WEEKS.minMinutes * MIN) {
      tx.set(['farm', 'daily', 'play', 'ok'], true);
      if (d.weeks.w === weekOf(state, ctx.now)) tx.inc(['farm', 'daily', 'weeks', 'days'], 1);
    }
  }
  bargePlay(tx, ctx);
  seasonPostcard(tx, ctx);
  const L = levelFromXp(state.farm.xp);
  // only a NEWER day refreshes (SV-04: after the farm's zone moved west, the old day's tasks stay until it catches up)
  if (L >= ALMANAC.unlock && p.almanac && !(p.almanac.d >= day)) newAlmanacDay(tx, ctx, pid, day);
  if (L >= ALMANAC.unlock && d && (!d.together || !(d.together.d >= day))) newTogether(tx, ctx, day);
}

/** A farm level-up: the Almanac starts at its unlock level, the meter at its own (GDD §5.8, §5.2). */
export function dailyOnLevel(tx, ctx, L) {
  const state = tx.state;
  if (L === ALMANAC.unlock) {
    const day = dayOf(state, ctx.now);
    for (const pid of playerIds(state)) if (!(state.players[pid].almanac?.d >= day)) newAlmanacDay(tx, ctx, pid, day);
    const tg = state.farm.daily?.together;
    if (state.farm.daily && (!tg || !(tg.d >= day))) newTogether(tx, ctx, day);
  }
  if (L === ORDERS.meter.unlock && state.farm.orders && !state.farm.orders.meter) {
    tx.set(['farm', 'orders', 'meter'], { w: weekOf(state, ctx.now), e: levelRow(L).E, v: 0, c: 0 });
  }
}

// ---- deeds: Almanac, Together task, Couple Challenge ------------------------------------------------------------

/**
 * The one Almanac task live for a player now (wave-2 QA RC-12, D4): the four tasks of a day are done one after the
 * other (slot `done % tasksPerPlayer`), so the login sweep finishes at most one and the paid four spread across the
 * evening as its spine (measured: first-evening both-idle 23.3 -> 12.3 min, dead minutes 10.8 -> 3.5).
 */
export const almanacLiveSlot = (a) => String(a.done % ALMANAC.tasksPerPlayer);

/** Every deed (progress.js) advances Almanac tasks, the Together task and the Couple Challenge. */
export function dailyDeed(tx, ctx, run, d) {
  const state = tx.state;
  const day = dayOf(state, ctx.now);
  // Almanac: the actor's own tasks; while both are online an action by either counts for both (GDD §5.8 C3)
  const online = onlineOf(ctx);
  for (const pid of playerIds(state)) {
    if (pid !== d.by && !(online.includes(pid) && online.includes(d.by))) continue;
    const a = state.players[pid].almanac;
    if (!a || a.d !== day) continue;
    for (const slot of sortedKeys(a.tasks)) {
      const t = a.tasks[slot];
      if (slot !== almanacLiveSlot(a) || !taskMatches(t, d)) continue;
      const need = taskNeed(t);
      const n = Math.min(need, t.n + d.n);
      if (n === t.n) continue;
      if (n >= need) almanacDone(tx, ctx, run, pid, slot);
      else tx.set(['players', pid, 'almanac', 'tasks', slot, 'n'], n);
    }
  }
  const tg = state.farm.daily?.together;
  if (tg && tg.d === day && !tg.done && hasPlayer(state, d.by)) {
    const tpl = ALMANAC.together.templates.find((x) => x.id === tg.tpl);
    if (tpl && tpl.verb === d.verb && togetherRef(d)) {
      const n = Math.min(tg.qty, tg.n + d.n);
      const by = { ...tg.by, [d.by]: (tg.by[d.by] ?? 0) + (n - tg.n) };
      tx.set(['farm', 'daily', 'together'], { ...tg, n, by, done: n >= tg.qty });
      if (n >= tg.qty) {
        // the Compost only once Compost is a thing on the farm (ALMANAC.unlocks.compost; the Almanac opens at L3)
        const L = levelFromXp(state.farm.xp);
        const items = L >= (ALMANAC.unlocks?.compost ?? 0) ? ALMANAC.together.items : {};
        payReward(tx, ctx, run, { hearts: ALMANAC.together.hearts, items }, 'together');
        tx.emit({ e: 'together', kind: 'task', tpl: tg.tpl, by: d.by });
        feedAdd(tx, ctx, { k: 'chest', what: 'together', i: 0 });
      }
    }
  }
  challengeDeed(tx, ctx, run, d);
}

/**
 * The Together task counts produce: harvest units, animal goods, crafted GOODS (feed is upkeep: six bags a batch
 * would make "craft 8 goods" a two-click task), waterings, quarter orders.
 */
const togetherRef = (d) => d.ref !== 'prized' && d.ref !== 'demand' && !(d.verb === 'collect' && d.fruit)
  && !(d.verb === 'make' && d.feed);

function taskMatches(t, d) {
  if (t.verb !== d.verb) return false;
  if (t.ref === '*') return d.ref !== 'prized' && d.ref !== 'demand';
  return t.ref === d.ref;
}

const taskNeed = (t) => (t.verb === 'fill' ? t.qty * 4 : t.qty);

function almanacDone(tx, ctx, run, pid, slot) {
  const state = tx.state;
  const a = state.players[pid].almanac;
  const L = levelFromXp(state.farm.xp);
  const paid = a.paid < ALMANAC.paidPerDay;
  let coins = 0;
  let xp = 0;
  if (paid) {
    coins = eHours(L, ALMANAC.coinsBp);
    xp = Math.max(1, Math.floor(eHours(L, ALMANAC.xpBp) / 8));
  }
  bumpStat(tx, run, pid, 'almanacDone');
  const next = { ...a, done: a.done + 1, paid: paid ? a.paid + 1 : a.paid };
  const tasks = { ...a.tasks };
  delete tasks[slot];
  const fresh = makeTask(state, pid, next.k, tasks, ctx);
  next.k += 1;
  tasks[slot] = fresh;
  next.tasks = tasks;
  const chest = paid && next.paid === ALMANAC.paidPerDay && !a.chest;
  if (chest) next.chest = true;
  tx.set(['players', pid, 'almanac'], next);
  tx.emit({ e: 'almanacDone', pid, slot, paid, coins, xp });
  if (paid) {
    payReward(tx, ctx, run, { coinsGranted: coins }, 'almanac');
    creditXp(tx, { ...ctx, pid }, run, xp, { by: pid });
  }
  if (chest) {
    // a part whose system is not unlocked yet is left out (Compost, collections); an empty chest pays coins instead
    const C = ALMANAC.chest;
    const U = ALMANAC.unlocks ?? {};
    const items = {};
    for (const item of sortedKeys(C.items ?? {})) if (L >= (U[item] ?? 0)) items[item] = C.items[item];
    const rolled = Boolean(C.collectionRoll) && L >= (U.collectionRoll ?? 0) && albumAnyRoll(tx, ctx, run, pid);
    const coinsC = Object.keys(items).length === 0 && !rolled && C.coinsBp ? eHours(L, C.coinsBp) : 0;
    payReward(tx, ctx, run, { items, coinsGranted: coinsC }, 'almanac');
    tx.emit({ e: 'almanacChest', pid, items, coins: coinsC, roll: rolled });
  }
}

// ---- Almanac task generation (G-VALID, complementary) -----------------------------------------------------

const SESSION = () => ALMANAC.sessionCropMinutes * MIN;

/** The candidate (template, ref) pairs the farm can do right now. */
function almanacCandidates(state, now) {
  const P = producers(state, now);
  const L = P.level;
  const memo = new Map();
  const out = [];
  for (const tpl of ALMANAC.templates) {
    if (!systemLive(tpl) || tpl.unlock > L) continue;
    const [kind, sub] = tpl.target.split(':');
    const refs = [];
    if (kind === 'crop') {
      for (const c of CONTENT.crops.values()) {
        if (!isLive(c) || c.unlock > L) continue;
        if (sub === 'session' && c.growMs <= SESSION()) refs.push(c.id);
        if (sub === 'waterable' && c.waterable) { refs.push('*'); break; }
      }
    } else if (kind === 'animal') {
      for (const a of CONTENT.animals.values()) {
        if (!isLive(a) || !(P.animals.get(a.id) > 0)) continue;
        if (tpl.verb === 'pet') { refs.push('animal'); break; }
        if (canMake(state, P, a.product, memo)) refs.push(a.product);
      }
    } else if (kind === 'recipe') {
      for (const r of CONTENT.recipes.values()) {
        if (!isLive(r) || r.unlock > L || r.duet || r.ms > ALMANAC.shortRecipeMinutes * MIN) continue;
        if (canMake(state, P, r.id, memo)) refs.push(r.id);
      }
    } else if (kind === 'feed') {
      for (const f of CONTENT.feeds.values()) {
        if (isLive(f) && f.unlock <= L && canMake(state, P, f.id, memo)) refs.push(f.id);
      }
    } else if (kind === 'tree') {
      for (const t of CONTENT.trees.values()) {
        // the Rainbow Tree (a wave-4b relic) gives a different fruit each time: no "pick N of its product" task
        if (isLive(t) && !t.relic && t.tool === 'basket' && (P.mature.get(t.id) ?? 0) > 0) refs.push(t.product);
      }
    } else if (kind === 'order') {
      if (L >= ORDERS.unlock) refs.push('order');
    } else if (kind === 'debris') {
      if (hasDebris(state)) refs.push('debris');
    } else if (kind === 'fair') {
      // "enter 1 Fair good": only while the Fair is open and the farm can make something it takes
      if (openFair(state, now) && canEnterSomething(state, P, memo)) refs.push('fair');
    }
    for (const ref of refs) out.push({ tpl, ref });
  }
  return out;
}

/** True when the farm can make (or holds) any good the Fair tent takes (T3 / T4 / duet crafts, prized goods). */
function canEnterSomething(state, P, memo) {
  for (const it of CONTENT.items.values()) {
    if (entryPoints10(state, it.id) > 0 && (it.unlock ?? 1) <= P.level
      && (available(state, it.id) > 0 || canMake(state, P, it.id, memo))) return true;
  }
  return false;
}

function hasDebris(state) {
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) if (CONTENT.debris.has(objs[id].def)) return true;
  return false;
}

/**
 * One new Almanac task for `pid`, keyed by the player's own roll counter `k` (server-ordered state). It avoids
 * targets the player already has (`own`) and every target the partner has (complementary, GDD §5.8 C3); when the
 * farm has nothing else, it falls back to the always-possible Wheat harvest.
 */
function makeTask(state, pid, k, own, ctx) {
  const taken = new Set();
  for (const t of Object.values(own)) taken.add(`${t.verb}:${t.ref}`);
  const partnerDomains = new Set();
  for (const other of playerIds(state)) {
    if (other === pid) continue;
    const a = state.players[other].almanac;
    if (!a || !a.tasks) continue;
    for (const t of Object.values(a.tasks)) {
      taken.add(`${t.verb}:${t.ref}`);
      const tpl = ALMANAC.templates.find((x) => x.id === t.tpl);
      if (tpl) partnerDomains.add(tpl.domain);
    }
  }
  const ownTpl = new Set(Object.values(own).map((t) => t.tpl));
  const all = almanacCandidates(state, ctx.now).filter((c) => !taken.has(`${c.tpl.verb}:${c.ref}`));
  // prefer: a template this player does not have yet, in a domain the partner is not working in
  const tiers = [
    all.filter((c) => !ownTpl.has(c.tpl.id) && !partnerDomains.has(c.tpl.domain)),
    all.filter((c) => !ownTpl.has(c.tpl.id)),
    all,
  ];
  const pool = tiers.find((t) => t.length > 0) ?? [];
  if (pool.length === 0) return { tpl: 'harvest', verb: 'harvest', ref: 'wheat', qty: 10, n: 0 };
  const c = pool[Math.floor(ctx.rng('almanac', pid, k) * pool.length)];
  const [lo, hi] = c.tpl.qty;
  const qty = lo + Math.floor(ctx.rng('almanac', pid, k, 'qty') * (hi - lo + 1));
  return { tpl: c.tpl.id, verb: c.tpl.verb, ref: c.ref, qty, n: 0 };
}

/** A new Almanac day for one player: 4 fresh tasks, the paid counter, the reroll and the chest reset. */
export function newAlmanacDay(tx, ctx, pid, day) {
  const a = tx.state.players[pid].almanac ?? initialAlmanac();
  let k = a.k;
  const tasks = {};
  // write the empty day first so the complementary rule sees this player's new tasks as they are made
  tx.set(['players', pid, 'almanac'], { d: day, k, paid: 0, done: a.done, rerolls: 0, chest: false, tasks: {} });
  for (let i = 0; i < ALMANAC.tasksPerPlayer; i++) {
    tasks[String(i)] = makeTask(tx.state, pid, k, tasks, ctx);
    k++;
  }
  tx.set(['players', pid, 'almanac'], { d: day, k, paid: 0, done: a.done, rerolls: 0, chest: false, tasks });
}

/** Reroll one task (one free per player per day, GDD §5.8). */
export function rerollTask(tx, ctx, pid, slot) {
  const a = tx.state.players[pid].almanac;
  const tasks = { ...a.tasks };
  delete tasks[slot];
  tasks[slot] = makeTask(tx.state, pid, a.k, tasks, ctx);
  tx.set(['players', pid, 'almanac'], { ...a, k: a.k + 1, rerolls: a.rerolls + 1, tasks });
}

function newTogether(tx, ctx, day) {
  const tpls = ALMANAC.together.templates.filter((t) => isLive(t) && t.unlock <= levelFromXp(tx.state.farm.xp));
  if (tpls.length === 0 || !tx.state.farm.daily) return;
  const k = tx.state.farm.rolls.together ?? 0;
  tx.set(['farm', 'rolls', 'together'], k + 1);
  const tpl = tpls[Math.floor(ctx.rng('together', k) * tpls.length)];
  const qty = tpl.verb === 'fill' ? tpl.qty * 4 : tpl.qty;
  tx.set(['farm', 'daily', 'together'], { d: day, tpl: tpl.id, qty, n: 0, by: {}, done: false });
}

// ---- Daily Gift (GDD §5.8) -------------------------------------------------------------------------------------

/** The reward of the next gift day (1-28) at level L, with locked rewards swapped for the day's coins. */
export function giftReward(state, now) {
  const g = state.farm.daily.gift;
  const day = (g.n % DAILY_GIFT.days.length) + 1;
  const row = DAILY_GIFT.days[day - 1];
  const L = levelFromXp(state.farm.xp);
  const coins = eHours(L, row.coinsBp ?? DAILY_GIFT.fallbackCoinsBp);
  const r = { day, coins: 0, acorns: row.acorns ?? 0, items: null, decor: null, seedPacket: 0 };
  if (row.coinsBp) r.coins = coins;
  if (row.items) {
    if (L >= DAILY_GIFT.unlocks.compost) r.items = { ...row.items };
    else r.coins = coins;
  }
  if (row.seedPacket) {
    // a seed packet (BOOSTS.seedPacket: free plantings of one crop) from its unlock level, the day's coins before
    if (L >= DAILY_GIFT.unlocks.seedPacket) r.seedPacket = BOOSTS.seedPacket.plantings;
    else r.coins = coins;
  }
  if (row.decor) r.decor = row.decor === 'season' ? DAILY_GIFT.seasonDecor[seasonOf(now, state.meta.tz)] : row.decor;
  return r;
}

export function claimGift(tx, ctx, run) {
  const r = giftReward(tx.state, ctx.now);
  payReward(tx, ctx, run, { coinsGranted: r.coins, acorns: r.acorns, items: r.items }, 'gift');
  if (r.decor) giveObject(tx, ctx, r.decor, 1);
  if (r.seedPacket > 0 && tx.state.farm.seeds) {
    // one unlocked crop, rolled on the gift counter (replicated, server-ordered); the economy's `farm.seeds` holds
    // free plantings per crop (shared/rules/actions/farming.js uses them before charging seed coins)
    const L = levelFromXp(tx.state.farm.xp);
    const crops = [...CONTENT.crops.values()].filter((c) => isLive(c) && c.unlock <= L);
    const k = tx.state.farm.daily.gift.n;
    const crop = crops[Math.floor(ctx.rng('giftSeeds', k) * crops.length)];
    tx.inc(['farm', 'seeds', crop.id], r.seedPacket);
    r.seedCrop = crop.id;
  }
  const g = tx.state.farm.daily.gift;
  tx.set(['farm', 'daily', 'gift'], { n: g.n + 1, last: dayOf(tx.state, ctx.now) });
  tx.emit({ e: 'gift', day: r.day, coins: r.coins, acorns: r.acorns, items: r.items, decor: r.decor,
    seeds: r.seedCrop ? { [r.seedCrop]: r.seedPacket } : null, by: ctx.pid });
  feedAdd(tx, ctx, { k: 'gift', day: r.day });
}

// ---- Couple Challenge (GDD §5.8, §6.2 #15) ----------------------------------------------------------------------

function challengeDeed(tx, ctx, run, d) {
  const ch = tx.state.farm.challenge;
  const cur = ch?.cur;
  if (!cur || cur.done || cur.w !== weekOf(tx.state, ctx.now) || !hasPlayer(tx.state, d.by)) return;
  const tpl = COUPLE_CHALLENGE.templates.find((t) => t.id === cur.tpl);
  if (!tpl) return;
  let add = 0;
  let rec = cur.rec;
  switch (tpl.measure) {
    case 'harvestValue': if (d.verb === 'harvest' && !d.fruit && d.ref !== 'prized') add = d.v ?? 0; break;
    case 'collectValue': if (d.verb === 'collect' && d.animal) add = d.v ?? 0; break;
    case 'craftAdded': if (d.verb === 'make' && !d.feed) add = d.add ?? 0; break;
    case 'orderValue': if (d.verb === 'fill') add = d.v ?? 0; break;
    case 'bargeCrates': if (d.verb === 'load' && d.ref === 'crate') add = d.n; break;
    case 'distinctRecipes':
      if (d.verb === 'make' && d.recipe && !Object.hasOwn(cur.rec, d.recipe)) {
        add = 1;
        rec = { ...cur.rec, [d.recipe]: 1 };
      }
      break;
    default: break;
  }
  if (!(add > 0)) return;
  const n = Math.min(cur.target, cur.n + add);
  const by = { ...cur.by, [d.by]: (cur.by[d.by] ?? 0) + add };
  const done = n >= cur.target;
  tx.set(['farm', 'challenge', 'cur'], { ...cur, n, by, rec, done });
  if (done) challengeDone(tx, ctx, run, { ...cur, by });
}

function challengeDone(tx, ctx, run, cur) {
  const ch = tx.state.farm.challenge;
  const rw = COUPLE_CHALLENGE.reward;
  const prizes = [...CONTENT.decor.values()].filter((dd) => dd.source === rw.decorFrom && isLive(dd));
  const prize = prizes.length ? prizes[ch.done % prizes.length].id : null;
  tx.set(['farm', 'challenge', 'done'], ch.done + 1);
  payReward(tx, ctx, run, { acorns: rw.acorns, decor: prize ? [prize] : undefined }, 'challenge');
  const total = Object.values(cur.by).reduce((s, v) => s + v, 0);
  const contributors = sortedKeys(cur.by).filter((p) => cur.by[p] > 0 && hasPlayer(tx.state, p));
  for (const pid of contributors) giveHearts(tx, ctx, pid, rw.hearts, 'challenge');
  const equal = contributors.length >= 2
    && contributors.every((p) => cur.by[p] * BP >= total * COUPLE_CHALLENGE.equalShareBp);
  if (equal) bumpStat(tx, run, null, 'equalChallenges');
  bumpStat(tx, run, null, 'challengesDone');
  tx.emit({ e: 'together', kind: 'challenge', tpl: cur.tpl, prize, equal, by: ctx.pid });
  feedAdd(tx, ctx, { k: 'chest', what: 'challenge', i: ch.done });
}

/**
 * What the farm can do now for the challenge templates (G-VALID, GDD §5.1; wave-1 QA RC-16): how many different
 * recipes it can make with whole chains, and how many adult animals it has.
 */
function challengeReach(state, now, L) {
  const P = producers(state, now);
  const memo = new Map();
  let recipes = 0;
  for (const r of CONTENT.recipes.values()) {
    if (isLive(r) && (r.unlock ?? 1) <= L && !r.duet && canMake(state, P, r.id, memo)) recipes++;
  }
  let adults = 0;
  for (const n of P.adults.values()) adults += n;
  return { recipes, adults };
}

function newChallenge(tx, ctx, week) {
  const ch = tx.state.farm.challenge;
  const L = levelFromXp(tx.state.farm.xp);
  const reach = challengeReach(tx.state, ctx.now, L);
  // only templates the farm can finish with what it owns now (never "craft 8 recipes" on a 5-recipe farm)
  // the barge's crates only when next week's manifest is known (set at Sunday's cast-off) and holds crates
  const b = tx.state.farm.barge;
  const crates = bargeUnlocked(tx.state) && b?.next && b.next.w === week ? b.next.crates.length : 0;
  const tpls = COUPLE_CHALLENGE.templates.filter((t) => systemLive(t)
    && !(t.minCount && reach.recipes < t.minCount && t.measure === 'distinctRecipes')
    && !(t.minAdults && reach.adults < t.minAdults)
    && !(t.measure === 'bargeCrates' && crates < BARGE.cratesPerRow));
  if (!ch || tpls.length === 0) return;
  // no two weeks in a row with the same template
  const prev = ch.cur ? ch.cur.tpl : null;
  const pool = tpls.length > 1 ? tpls.filter((t) => t.id !== prev) : tpls;
  const tpl = pool[Math.floor(ctx.rng('challenge', ch.n) * pool.length)];
  const count = tpl.measure === 'distinctRecipes' ? Math.min(tpl.count, reach.recipes)
    : tpl.measure === 'bargeCrates' ? Math.min(tpl.count, crates) : tpl.count;
  const target = count ?? Math.max(1, eHours(L, tpl.hoursBp));
  tx.set(['farm', 'challenge'], { n: ch.n + 1, done: ch.done,
    cur: { w: week, tpl: tpl.id, target, n: 0, by: {}, rec: {}, done: false } });
  tx.emit({ e: 'challengeStarted', week, tpl: tpl.id, target });
}

// ---- Mabel's weekly meter (GDD §5.2) ----------------------------------------------------------------------------

/** Add a filled order's value to the meter (simple orders count 1/4) and pay every chest it crosses. */
export function meterAdd(tx, ctx, run, value) {
  const m = tx.state.farm.orders?.meter;
  if (!m || m.w !== weekOf(tx.state, ctx.now) || !(value > 0)) return;
  const v = m.v + value;
  let c = m.c;
  const L = levelFromXp(tx.state.farm.xp);
  for (let i = c; i < ORDERS.meter.chests.length; i++) {
    const chest = ORDERS.meter.chests[i];
    if (v * BP < m.e * chest.atBp) break;
    const coins = Math.floor((m.e * chest.coinsBp) / BP);
    const items = L >= DAILY_GIFT.unlocks.compost ? chest.items : {};
    payReward(tx, ctx, run, { coinsGranted: coins, acorns: chest.acorns, items }, 'meter');
    tx.emit({ e: 'meterChest', i, coins, acorns: chest.acorns, items });
    feedAdd(tx, ctx, { k: 'chest', what: 'meter', i });
    c = i + 1;
  }
  tx.set(['farm', 'orders', 'meter'], { ...m, v, c });
}

// ---- rollover (system action `_rollover`) ----------------------------------------------------------------------

/**
 * The day (and maybe week) changed: one action catches up any number of missed days (GDD §9 #30): Farm Weeks
 * counts the finished week and uses skip weeks for missed ones, the meter and the Couple Challenge start a new
 * week, every player's Almanac and the Together task start the new day.
 */
export function rollover(tx, ctx) {
  const state = tx.state;
  const d = state.farm.daily;
  const day = dayOf(state, ctx.now);
  if (day < d.day) return;                      // never backwards (SV-04: the farm's zone moved west)
  const week = weekOf(state, ctx.now);
  const L = levelFromXp(state.farm.xp);
  if (week > d.week) weekly(tx, ctx, d, week, L);
  if (d.day !== day) tx.set(['farm', 'daily', 'day'], day);
  if (L >= ALMANAC.unlock) {
    for (const pid of playerIds(state)) if (!(state.players[pid].almanac?.d >= day)) newAlmanacDay(tx, ctx, pid, day);
    if (!state.farm.daily.together || !(state.farm.daily.together.d >= day)) newTogether(tx, ctx, day);
  } else if (d.together) tx.set(['farm', 'daily', 'together'], null);
  // the townsfolk board of this week (a new week, the M1b flip, a farm that reached L21 without a level-up event)
  if (folkDue(tx.state, ctx.now)) postWeek(tx, ctx);
}

function weekly(tx, ctx, d, week, L) {
  let { w, days, streak, best, skips } = d.weeks;
  if (L >= FARM_WEEKS.unlock && week > w) {
    if (days >= FARM_WEEKS.minDays) {
      streak += 1;
      if (streak % FARM_WEEKS.skipEvery === 0 && skips < FARM_WEEKS.skipMax) skips += 1;
    } else if (skips > 0) skips -= 1;
    else streak = 0;
    // whole weeks with no play at all (the server or both players away): each uses a skip week, then it breaks
    for (let missed = week - w - 1; missed > 0 && streak > 0; missed--) {
      if (skips > 0) skips -= 1;
      else streak = 0;
    }
  }
  best = Math.max(best, streak);
  tx.set(['farm', 'daily', 'weeks'], { w: week, days: 0, streak, best, skips });
  tx.set(['farm', 'daily', 'week'], week);
  tx.emit({ e: 'weekRolled', week, streak, best, skips });
  const ob = tx.state.farm.orders;
  if (ob && L >= ORDERS.meter.unlock) tx.set(['farm', 'orders', 'meter'], { w: week, e: levelRow(L).E, v: 0, c: 0 });
  if (L >= COUPLE_CHALLENGE.unlock) newChallenge(tx, ctx, week);
  else if (tx.state.farm.challenge?.cur) tx.set(['farm', 'challenge', 'cur'], null);
  // the townsfolk board: last week's requests leave, three new ones go up (GDD §5.3)
  if (folkDue(tx.state, ctx.now)) postWeek(tx, ctx);
}

