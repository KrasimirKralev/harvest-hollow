// The River Barge (GDD §5.7; content: shared/content/weekly.js BARGE). Owned by rules-goals.
//
// Captain Reed docks Monday 06:00 and casts off Sunday 20:00 (farm zone). One row of 3 crates per 2 hours the farm
// was played last week (1-3 rows). A crate is one item x quantity worth E x 0.3 h, capped by 6 hours of one producer,
// from goods the farm made in the last 14 days (T2-T4 crafts, crops of 4 h or more, fruit, animal goods of 3 h or
// more cycles), never two crates whose items share a direct input, and only what the farm can make now (G-VALID).
// Loading a crate pays 1.6 x V x qty (+5 % per adult horse, at most +20 %) and XP = 0.2 x coins / 8. A completed row
// pays E x 0.25 h (+25 % with the Riverbank land) + 1 Acorn + a third of the Captain's chest of the ladder tier t
// (1-5): (1 + t) Acorns and 3t Compost per chest, and from tier 3 a third of a decor roll. A week with every offered
// row loaded raises t by 1, a week without lowers it by 1 (never below 1). Unloaded crates simply leave.
//
// farm.barge = {
//   t, streak          the ladder tier (1-5) and the weeks in a row with at least one completed row (Full Steam)
//   w, docked          the week of the current (or last) manifest; docked between Monday 06:00 and the cast-off
//   rows               rows offered this week (0 when nothing the farm made fits a crate: the barge sails light)
//   crates: { [i]: { item, qty, by: null | pid, at, flag: null | pid } }   row = floor(i / 3)
//   paid:   { [row]: at }                                                 completed rows
//   next:   null | { w, rows, crates: [{ item, qty }] }   next week's goods, set at the cast-off (the jetty preview)
//   play:   { w, m, n, prev }   minutes the farm was played (either partner, a minute counts once) in week w, and
//                               in the week before (prev; -1 unknown)
//   log:    null | { w, rows, done, t }   the last cast-off (recap and the jetty)
//   eq?:    the last week whose completed row both farmers loaded (Equal Partners, M2; absent before)
// }
// Equal Partners (GDD §6.2 #16, M2): a completed row with crates loaded by two distinct farmers adds one decor from the
// Captain's chest pool to that row's share (1 Acorn while content has no chest decor); the week counts once for the
// Equal Partners ribbon (bargeRow `equal`, `eqDecor`, `eqWeek`).
//   bargeLoad { i, w?, item? }   load crate i from the Barn (the whole quantity; Keep N needs no confirm, as orders)
//   bargeFlag { i, w?, item? }   toggle "Need help" on a crate (at most BARGE.helpFlags flagged; filling the OTHER
//                                player's flag: +10 % XP and +1 Heart each, GDD §6.2 #3)
//   `w` (the manifest's week, farm.barge.w) and `item` (the crate's item) are what the player SAW: a stale intent from
//   last week's manifest (re-sent after a reconnect) answers NOT_FOUND instead of loading or flagging this week's crate
//   with the same index (wave-2 QA RC-07). Optional for older clients; the client always sends both.
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import {
  BARGE, COOP, CONTENT, itemOf, cropOf, treeOf, animalOf, recipeOf, levelFromXp, eHours, isLive,
} from '../../content/index.js';
import { available, consume, earn, useReceipts } from '../economy.js';
import { sortedKeys } from '../order.js';
import { systemLive, weekOf, dayOf, localAt, weekStartDay, hasPlayer } from '../coop.js';
import { producers, canMake } from '../orders-board.js';
import { payReward } from '../progress.js';
import { horseBargeBp } from './animals.js';

const BP = 10_000;
const MIN = 60_000;
const DAY = 86_400_000;

/** True when the barge plays in this build and the farm has its level. */
export const bargeUnlocked = (state) => systemLive(BARGE) && levelFromXp(state.farm.xp) >= BARGE.unlock;

/** Monday 06:00 of week `w`. */
export const dockAt = (state, w) => localAt(state.meta.tz, weekStartDay(w) + BARGE.dockDay, BARGE.dockHour);

/** Sunday 20:00 of week `w`. */
export const castOffAt = (state, w) => localAt(state.meta.tz, weekStartDay(w) + BARGE.castOffDay, BARGE.castOffHour);

/** Rows the play of a week earns: one per 2 hours (1-3); unknown play counts as the reference couple's 3 hours. */
export function rowsFor(minutes) {
  const m = minutes >= 0 ? minutes : 180;
  const rows = Math.ceil((m * MIN) / BARGE.playMsPerRow);
  return Math.max(BARGE.rowsMin, Math.min(BARGE.rowsMax, rows));
}

/** The docked barge at `now`, or null (cast off, not docked yet, or not unlocked). */
export function dockedBarge(state, now) {
  const b = state.farm.barge;
  if (!b || !b.docked || !bargeUnlocked(state)) return null;
  return now < castOffAt(state, b.w) ? b : null;
}

// ---- play minutes (Full Steam sizing) ---------------------------------------------------------------------------

/** Once per player action (daily.playTick): the farm's played minutes this week; a minute counts once for both. */
export function bargePlay(tx, ctx) {
  const b = tx.state.farm.barge;
  if (!b || !systemLive(BARGE)) return;
  const w = weekOf(tx.state, ctx.now);
  const m = Math.floor(ctx.now / MIN);
  const p = b.play;
  if (p.w !== w) {
    const prev = p.w === w - 1 ? p.n : p.w >= 0 ? 0 : -1;
    tx.set(['farm', 'barge', 'play'], { w, m, n: 1, prev });
  } else if (p.m !== m) {
    tx.set(['farm', 'barge', 'play'], { w, m, n: p.n + 1, prev: p.prev });
  }
}

/** Rows the barge offers in week `w` (from the play of week w - 1); fewer when the farm made too few goods. */
export const rowsWanted = (state, w) => rowsFor(playedIn(state.farm.barge, w - 1));

/** Minutes the farm played in week `w` as the state knows them (-1 unknown). */
function playedIn(b, w) {
  if (b.play.w < 0) return -1;
  if (b.play.w === w) return b.play.n;
  if (b.play.w === w + 1) return b.play.prev;
  return b.play.w > w ? -1 : 0;
}

// ---- the manifest (G-VALID) --------------------------------------------------------------------------------------

/** True when the farm made `item` within BARGE.madeWithinMs (the `made` log: item -> last local day made). */
export function madeRecently(state, item, now, withinMs = BARGE.madeWithinMs) {
  const d = state.farm.made?.[item];
  return Number.isSafeInteger(d) && dayOf(state, now) - d <= Math.floor(withinMs / DAY);
}

/** Items a crate may ask for (kind rules of §5.7; the 14-day and G-VALID tests are separate). */
function crateKind(it) {
  if (!it || !isLive(it) || !it.orderable) return false;
  if (it.kind === 'craft') return it.tier === 'T2' || it.tier === 'T3' || it.tier === 'T4';
  if (it.kind === 'crop') return (cropOf(it.source)?.growMs ?? 0) >= 4 * 60 * MIN;
  if (it.kind === 'fruit') return true;
  if (it.kind === 'animal') return (animalOf(it.source)?.cycleMs ?? 0) >= 3 * 60 * MIN;
  return false;
}

/** What one producer makes in 6 hours (a building one item at a time, the animals or trees owned, a third of the
 * plots): the crate's quantity cap. */
function capOf(P, item) {
  const it = itemOf(item);
  const H = Math.floor(BARGE.producerCapMs / MIN);
  if (it.kind === 'crop') return Math.max(1, Math.floor(P.plotCap / 3) * cropOf(it.source).yield);
  if (it.kind === 'fruit') {
    const t = treeOf(it.source);
    return Math.max(1, (P.mature.get(t.id) ?? 0) * t.yield * Math.max(1, Math.floor(H / Math.round(t.cycleMs / MIN))));
  }
  if (it.kind === 'animal') {
    const a = animalOf(it.source);
    return Math.max(1, (P.adults.get(a.id) ?? 0) * a.out * Math.max(1, Math.floor(H / Math.round(a.cycleMs / MIN))));
  }
  const r = recipeOf(it.source);
  return Math.max(1, (r?.out ?? 1) * Math.max(1, Math.floor(H / Math.max(1, Math.round((r?.ms ?? MIN) / MIN)))));
}

const inputsOf = (item) => {
  const r = recipeOf(itemOf(item)?.source);
  return r && r.inputs ? Object.keys(r.inputs) : [];
};
const clash = (a, b) => {
  const ia = inputsOf(a);
  const ib = inputsOf(b);
  return ia.includes(b) || ib.includes(a) || ia.some((x) => ib.includes(x));
};

/** True when the farm has ever produced `item` (its lifetime counters: harvests, crafts, collections, picks). */
export function producedEver(state, item) {
  const st = state.farm.stats;
  return [`harvest.${item}`, `craft.${item}`, `collect.${item}`, `pick.${item}`].some((k) => st[k] > 0);
}

/**
 * Items the barge could ask for now. Its very first manifest (the barge never docked: a farm reaching L15, or a save
 * from before the barge existed, whose 14-day log is still empty) takes what the farm has ever made instead, so the
 * first barge is never empty for a farm that has been producing for months.
 */
export function bargePool(state, now) {
  const P = producers(state, now);
  const memo = new Map();
  const first = (state.farm.barge?.w ?? -1) < 0;
  const out = [];
  for (const it of CONTENT.items.values()) {
    if (!crateKind(it) || (it.unlock ?? 1) > P.level) continue;
    const made = madeRecently(state, it.id, now) || (first && producedEver(state, it.id));
    if (!made || !canMake(state, P, it.id, memo)) continue;
    out.push(it.id);
  }
  return out.sort();
}

/**
 * Goods the farm can make now but has never made (a recipe nobody asked for yet: wave-2 QA RC-15). The barge may
 * carry one of them a week, weighted x BARGE.neverMadeMul, so every unlocked recipe gets asked for.
 */
export function neverMadePool(state, now) {
  const P = producers(state, now);
  const memo = new Map();
  const out = [];
  for (const it of CONTENT.items.values()) {
    if (!crateKind(it) || it.kind !== 'craft' || (it.unlock ?? 1) > P.level || producedEver(state, it.id)) continue;
    if (canMake(state, P, it.id, memo)) out.push(it.id);
  }
  return out.sort();
}

/**
 * A manifest of `rows` rows for week `w`: crates picked by rng('barge', farm.rolls.barge, k) (the caller bumps the
 * counter in the same tx), never two sharing a direct input; only whole rows of 3 are offered. At most one crate a
 * week asks for a good the farm has never made (weight BARGE.neverMadeMul, RC-15).
 */
export function makeManifest(state, now, w, rows, rng) {
  const P = producers(state, now);
  const worth = eHours(P.level, BARGE.crateHoursBp);
  const roll = state.farm.rolls.barge ?? 0;
  let pool = bargePool(state, now);
  let fresh = neverMadePool(state, now).filter((x) => !pool.includes(x));
  const crates = [];
  for (let k = 0; crates.length < rows * BARGE.cratesPerRow && pool.length + fresh.length > 0; k++) {
    const mul = BARGE.neverMadeMul ?? 0;
    const total = pool.length + fresh.length * mul;
    const x = Math.floor(rng('barge', roll, k) * total);
    const item = x < pool.length ? pool[x] : fresh[Math.floor((x - pool.length) / mul)];
    if (fresh.includes(item)) fresh = [];                            // one never-made good a week
    pool = pool.filter((y) => y !== item && !clash(y, item));
    fresh = fresh.filter((y) => !clash(y, item));
    const v = itemOf(item).sell;
    const qty = Math.max(1, Math.min(capOf(P, item), Math.floor((worth + Math.floor(v / 2)) / v)));
    crates.push({ item, qty });
  }
  const whole = crates.length - (crates.length % BARGE.cratesPerRow);
  return { w, rows: whole / BARGE.cratesPerRow, crates: crates.slice(0, whole) };
}

/** A preview whose every item the farm can still make (else the dock rolls a fresh manifest). */
function stillValid(state, now, m) {
  const P = producers(state, now);
  const memo = new Map();
  return m.crates.every((c) => canMake(state, P, c.item, memo) && isLive(itemOf(c.item)));
}

// ---- the week (system action `_barge`) ---------------------------------------------------------------------------

/** True when `_barge` has work: a cast-off that is due, or this week's docking. */
export function bargeDue(state, now) {
  const b = state.farm.barge;
  if (!b) return false;
  if (b.docked && now >= castOffAt(state, b.w)) return true;
  if (!bargeUnlocked(state)) return false;
  const w = weekOf(state, now);
  return !b.docked && b.w < w && now >= dockAt(state, w) && now < castOffAt(state, w);
}

/** The next moment `_barge` gets work after `now`. */
export function bargeNextAt(state, now) {
  const b = state.farm.barge;
  if (!b) return Infinity;
  if (b.docked) return castOffAt(state, b.w);
  if (!bargeUnlocked(state)) return Infinity;
  const w = weekOf(state, now);
  return b.w < w && now < dockAt(state, w) ? dockAt(state, w) : dockAt(state, w + 1);
}

function castOff(tx, ctx) {
  const b = tx.state.farm.barge;
  const done = Object.keys(b.paid).length;
  let t = b.t;
  if (b.rows > 0) t = done >= b.rows ? Math.min(BARGE.chest.tiers, t + 1) : Math.max(1, t - 1);
  const streak = done > 0 ? b.streak + 1 : 0;
  // next week's goods, frozen now so the jetty can preview them (rows from this week's play)
  const next = makeManifest(tx.state, ctx.now, b.w + 1, rowsFor(playedIn(b, b.w)), ctx.rng);
  tx.set(['farm', 'rolls', 'barge'], (tx.state.farm.rolls.barge ?? 0) + 1);
  tx.set(['farm', 'barge'], { ...b, t, streak, docked: false, next, log: { w: b.w, rows: b.rows, done, t } });
  tx.emit({ e: 'bargeCastOff', w: b.w, rows: b.rows, done, t, streak, by: ctx.pid });
}

function dock(tx, ctx) {
  const b = tx.state.farm.barge;
  const w = weekOf(tx.state, ctx.now);
  // whole weeks the barge never docked (the server or both players away) count as weeks without a full barge
  const missed = b.w >= 0 ? Math.max(0, w - b.w - 1) : 0;
  const t = Math.max(1, b.t - missed);
  const streak = missed > 0 ? 0 : b.streak;
  let m = b.next && b.next.w === w && stillValid(tx.state, ctx.now, b.next) ? b.next : null;
  if (!m) {
    m = makeManifest(tx.state, ctx.now, w, rowsFor(playedIn(b, w - 1)), ctx.rng);
    tx.set(['farm', 'rolls', 'barge'], (tx.state.farm.rolls.barge ?? 0) + 1);
  }
  const crates = {};
  m.crates.forEach((c, i) => { crates[String(i)] = { item: c.item, qty: c.qty, by: null, at: 0, flag: null }; });
  tx.set(['farm', 'barge'], { ...b, t, streak, w, docked: true, rows: m.rows, crates, paid: {}, next: null });
  tx.emit({ e: 'bargeDocked', w, rows: m.rows, t, by: ctx.pid });
}

/** `_barge` apply: cast off a finished week (once), then dock this week's barge if its window is open. */
export function bargeRoll(tx, ctx) {
  const b = tx.state.farm.barge;
  if (b.docked && ctx.now >= castOffAt(tx.state, b.w)) castOff(tx, ctx);
  if (!bargeUnlocked(tx.state)) return;
  const w = weekOf(tx.state, ctx.now);
  const nb = tx.state.farm.barge;
  if (!nb.docked && nb.w < w && ctx.now >= dockAt(tx.state, w) && ctx.now < castOffAt(tx.state, w)) dock(tx, ctx);
}

/** A level-up into the barge docks it at once when this week's window is open. */
export function bargeOnLevel(tx, ctx, L) {
  if (L !== BARGE.unlock || !tx.state.farm.barge || !bargeUnlocked(tx.state)) return;
  const w = weekOf(tx.state, ctx.now);
  const b = tx.state.farm.barge;
  if (!b.docked && b.w < w && ctx.now >= dockAt(tx.state, w) && ctx.now < castOffAt(tx.state, w)) dock(tx, ctx);
}

// ---- actions -----------------------------------------------------------------------------------------------------

const CRATE = V.int(0, 8);
const CRATE_ARGS = { i: CRATE, w: V.opt(V.int(-1, 1_000_000)), item: V.opt(V.content('items')) };

function crateCode(state, a, now) {
  if (!bargeUnlocked(state)) return ERR.LOCKED;
  const b = dockedBarge(state, now);
  if (!b) return ERR.NOT_READY;
  const c = b.crates[String(a.i)];
  if (!c) return ERR.NOT_FOUND;
  if ((a.w !== undefined && a.w !== b.w) || (a.item !== undefined && a.item !== c.item)) return ERR.NOT_FOUND;
  return c.by !== null ? ERR.ALREADY_DONE : null;
}

/** Coins a crate pays when loaded now (horses add 5 % each, at most 20 %). */
export function cratePay(state, crate, now, used = null) {
  const horseBp = horseBargeBp(state, now, used);     // rules-economy's (actions/animals.js): adult horses
  const base = Math.floor((itemOf(crate.item).sell * crate.qty * BARGE.payBp) / BP);
  const coins = base + Math.floor((base * horseBp) / BP);
  return { coins, xp: Math.max(1, Math.floor((coins * BARGE.xpShareBp) / BP / 8)) };
}

/** What a completed row pays now (the k-th completed row of the week, k from 0). */
export function rowPay(state, k) {
  const b = state.farm.barge;
  const L = levelFromXp(state.farm.xp);
  let coins = eHours(L, BARGE.row.coinsHoursBp);
  if (state.farm.expansions.includes('riverbank')) coins += Math.floor((coins * BARGE.row.riverbankBp) / BP);
  const chest = BARGE.chest.acornsBase + b.t;
  const div = BARGE.row.chestShareDiv;
  const share = Math.floor(((k + 1) * chest) / div) - Math.floor((k * chest) / div);
  const compost = Math.floor((BARGE.chest.compostPerTier * b.t) / div);
  return { coins, acorns: BARGE.row.acorns + share, compost, decorRoll: b.t >= BARGE.chest.decorFrom };
}

/**
 * A decor from the Captain's chest pool (content: reward decor with source 'barge'), or null: a third of the chest's
 * one decor roll per completed row, keyed on the farm counter `rolls.bargeChest` (bumped by the caller).
 */
function chestDecor(state, rng) {
  const pool = [...CONTENT.decor.values()].filter((d) => d.source === 'barge' && systemLive(d)).map((d) => d.id).sort();
  if (pool.length === 0) return null;
  const k = state.farm.rolls.bargeChest ?? 0;
  if (rng('bargeChest', k) * BARGE.row.chestShareDiv >= 1) return null;
  return pool[Math.floor(rng('bargeChest', k, 'pick') * pool.length)];
}

/** Equal Partners (GDD §6.2 #16): content COOP.equalPartners when it exists, else these numbers (M2). */
const EQUAL = COOP.equalPartners ?? Object.freeze({ decorRolls: 1, m: 'M2' });

/**
 * The Equal Partners extra of a completed row loaded by two distinct farmers, or null: the extra decor (a guaranteed
 * pick from the chest pool keyed on the farm counter `rolls.bargeEqual`; null when the pool is empty) and whether it
 * is the week's first such row (barge.eq = the week it last counted).
 */
function equalPartners(tx, ctx, loaders) {
  if (!systemLive(EQUAL) || loaders.length < 2 || !loaders.every((p) => hasPlayer(tx.state, p))) return null;
  const pool = [...CONTENT.decor.values()].filter((d) => d.source === 'barge' && systemLive(d)).map((d) => d.id).sort();
  let decor = null;
  if (pool.length) {
    const k = tx.state.farm.rolls.bargeEqual ?? 0;
    tx.set(['farm', 'rolls', 'bargeEqual'], k + 1);
    decor = pool[Math.floor(ctx.rng('bargeEqual', k) * pool.length)];
  }
  const b = tx.state.farm.barge;
  const week = b.eq !== b.w;
  if (week) tx.set(['farm', 'barge', 'eq'], b.w);
  return { decor, week };
}

export const bargeLoad = {
  schema: CRATE_ARGS,
  check(state, a, ctx) {
    const code = crateCode(state, a, ctx.now);
    if (code) return code;
    const c = state.farm.barge.crates[String(a.i)];
    return available(state, c.item) >= c.qty ? null : ERR.NO_ITEMS;
  },
  apply(tx, a, ctx) {
    const key = String(a.i);
    const c = tx.get(['farm', 'barge', 'crates', key]);
    consume(tx, c.item, c.qty);
    const horses = new Set();
    const pay = cratePay(tx.state, c, ctx.now, horses);
    useReceipts(tx, horses);                          // a horse that pulled a crate is no longer a 100 % undo (RC-08)
    const helped = typeof c.flag === 'string' && c.flag !== ctx.pid ? c.flag : null;
    const xp = helped ? pay.xp + Math.floor((pay.xp * COOP.helpFlags.xpBonusBp) / BP) : pay.xp;
    earn(tx, ctx, pay.coins, 'barge');
    tx.set(['farm', 'barge', 'crates', key], { ...c, by: ctx.pid, at: ctx.now, flag: null });
    tx.emit({ e: 'bargeLoaded', i: a.i, item: c.item, qty: c.qty, coins: pay.coins, xp, helped, by: ctx.pid });
    const row = Math.floor(a.i / BARGE.cratesPerRow);
    const b = tx.state.farm.barge;
    const mates = [0, 1, 2].map((j) => b.crates[String(row * BARGE.cratesPerRow + j)]);
    if (mates.every((m) => m && m.by !== null) && !Object.hasOwn(b.paid, String(row))) {
      const k = Object.keys(b.paid).length;
      const r = rowPay(tx.state, k);
      earn(tx, ctx, r.coins, 'barge');
      const decor = r.decorRoll ? chestDecor(tx.state, ctx.rng) : null;
      if (r.decorRoll) tx.set(['farm', 'rolls', 'bargeChest'], (tx.state.farm.rolls.bargeChest ?? 0) + 1);
      tx.set(['farm', 'barge', 'paid', String(row)], ctx.now);
      const loaders = [...new Set(mates.map((m) => m.by))].sort();
      // Barge "Equal Partners" (GDD §6.2 #16, M2): both farmers loaded a crate of this row: +1 decor roll in the
      // row's chest share (a piece of the Captain's chest pool; 1 Acorn while content has no chest decor), and the
      // Equal Partners ribbon counts the week once
      const eq = equalPartners(tx, ctx, loaders);
      payReward(tx, ctx, null, { acorns: r.acorns + (eq && !eq.decor ? 1 : 0),
        items: r.compost > 0 ? { compost: r.compost } : undefined,
        decor: [decor, eq?.decor].filter(Boolean) }, 'barge');
      const ev = { e: 'bargeRow', row, w: b.w, coins: r.coins, acorns: r.acorns + (eq && !eq.decor ? 1 : 0),
        compost: r.compost, decor, loaders, by: ctx.pid };
      if (eq) Object.assign(ev, { equal: true, eqDecor: eq.decor, eqWeek: eq.week });
      tx.emit(ev);
    }
  },
};

export const bargeFlag = {
  schema: CRATE_ARGS,
  check(state, a, ctx) {
    const code = crateCode(state, a, ctx.now);
    if (code) return code;
    const b = state.farm.barge;
    const c = b.crates[String(a.i)];
    if (typeof c.flag === 'string' && c.flag !== ctx.pid) return ERR.OCCUPIED;
    const flagged = Object.keys(b.crates).filter((k) => b.crates[k].flag !== null).length;
    return c.flag === null && flagged >= BARGE.helpFlags ? ERR.CAP : null;
  },
  apply(tx, a, ctx) {
    const key = String(a.i);
    const flag = tx.get(['farm', 'barge', 'crates', key, 'flag']) === ctx.pid ? null : ctx.pid;
    tx.set(['farm', 'barge', 'crates', key, 'flag'], flag);
    tx.emit({ e: 'bargeFlagged', i: a.i, flag, by: ctx.pid });
  },
};

/** The barge for the UI: { docked, w, t, rows, crates: [{ i, row, item, qty, by, flag, coins, xp, ready }], paid,
 * castOffAt, dockAt, next } (ready = the Barn holds the quantity now). */
export function bargeView(state, now) {
  const b = state.farm.barge;
  if (!b) return null;
  const crates = sortedKeys(b.crates).map((k) => Number(k)).sort((x, y) => x - y).map((i) => {
    const c = b.crates[String(i)];
    return { i, row: Math.floor(i / BARGE.cratesPerRow), ...c, ...cratePay(state, c, now),
      ready: c.by === null && available(state, c.item) >= c.qty };
  });
  const w = weekOf(state, now);
  return { docked: Boolean(dockedBarge(state, now)), w: b.w, t: b.t, streak: b.streak, rows: b.rows, crates,
    paid: { ...b.paid }, castOffAt: b.docked ? castOffAt(state, b.w) : null,
    dockAt: b.docked ? null : dockAt(state, b.w < w && now < dockAt(state, w) ? w : w + 1),
    next: b.next, log: b.log };
}
