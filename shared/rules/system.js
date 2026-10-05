// System actions: server-initiated changes that go through the same runAction / journal / broadcast pipeline as
// player actions (tech-architecture §15.1). Their type starts with '_' and runAction refuses them unless
// ctx.pid === 'sys'. Clients never predict them; the rebase absorbs them. Owned by rules-goals.
//
// Connection-driven: `_join` (a slot was claimed), `_seen` (a player's last socket closed: stamps lastSeenAt and
// stands their avatar up from a Golden Hour bench).
// Time-driven (dueSystemActions, fixed order): `_rollover` (a new farm day: Almanac, Together task; a new week:
// Farm Weeks, Mabel's meter, Couple Challenge, the townsfolk board), `_orders` (board slots to add, refill or
// replace), `_golden` (two players seated on one bench for COOP.goldenHour.seatMs: Golden Hour), `_fair` (the County
// Fair's ceremony and week, with the NPC league), `_barge` (the River Barge's cast-off and docking), the M2 goals' own
// (`_track` the Seasonal Ribbon Track's season, `_duel` a Friendly Duel's end, `_grandma` Grandma's leaving; their
// actions live in actions/track.js, duel.js, grandma.js), `_crate` (wave 4b: the balloon's loot crates, crates.js),
// then the economy's (econDue: `_regrow`
// debris, `_wishRelease`; rules-economy registers those actions through its own families). Each clears its own
// condition when it
// commits, and nextSystemDueAt() names the moment the list next grows (the server arms one timer for it; scheduler
// contract in docs/agent-notes/server.md).
import { ERR, cleanName } from '../net/protocol.js';
import { SLOT_COLORS } from '../content/config.js';
import { COOP, ORDERS, ALMANAC, decorOf, levelFromXp } from '../content/index.js';
import { V } from './schema.js';
import { createPlayer } from './state.js';
import { sortedKeys } from './order.js';
import { dayIndex } from './calendar.js';
import { dayOf, blockOf, goldenHourAllowed, hasPlayer } from './coop.js';
import { rollover, newAlmanacDay } from './daily.js';
import { generateOrder, slotsWanted, staleOrder, refillMsOf } from './orders-board.js';
import { feedAdd } from './feed.js';
import { econDue, econNextDueAt } from './actions/expansions.js';
import { useReceipts } from './economy.js';
import { benchGoldenMs } from './upgrades.js';
import { fairDue, fairNextAt, fairRoll } from './actions/fair.js';
import { bargeDue, bargeNextAt, bargeRoll } from './actions/barge.js';
import { folkDue } from './actions/folk.js';
import { trackDue, trackNextAt } from './actions/track.js';
import { duelDue, duelNextAt } from './actions/duel.js';
import { grandmaDue, grandmaNextAt } from './actions/grandma.js';
import { crateDue, crateNextAt } from './actions/crates.js';

/** True when a joined player already wears this colour (case-insensitive). */
const colourTaken = (state, color) => Object.values(state.players)
  .some((p) => String(p.color).toUpperCase() === String(color).toUpperCase());

/** `_join {pid, name, color?}`: a slot was claimed (sessions.js). Creates the player record. */
export const _join = {
  schema: { pid: V.pid, name: V.text(16), color: V.opt(V.text(7)) },
  check(state, a) {
    if (Object.hasOwn(state.players, a.pid)) return ERR.SLOT_TAKEN;
    if (a.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(a.color)) return ERR.BAD_ARGS;
    if (!cleanName(a.name)) return ERR.BAD_ARGS;
    return null;
  },
  apply(tx, a, ctx) {
    // Two farmers never share a colour: "who did what" is drawn in it everywhere (wave-1 QA UI-05). The picker greys
    // out the partner's colour; when two devices pick the same one at the same moment, the later claim gets the
    // first slot colour nobody wears instead of a refusal.
    const wanted = a.color ?? SLOT_COLORS[a.pid];
    const color = [wanted, SLOT_COLORS[a.pid], ...Object.values(SLOT_COLORS)].find((c) => !colourTaken(tx.state, c)) ?? wanted;
    tx.set(['players', a.pid], createPlayer(cleanName(a.name), color, ctx.now));
    tx.emit({ e: 'joined', pid: a.pid });
    // a partner who joins after the Almanac unlocked gets their day's tasks at once
    if (levelFromXp(tx.state.farm.xp) >= ALMANAC.unlock) newAlmanacDay(tx, ctx, a.pid, dayOf(tx.state, ctx.now));
  },
};

/**
 * `_seen {pid, at?}`: the player left (tech §6.4): lastSeenAt, and they stand up from a bench. `at` (server-only, SV-01)
 * is when they were last seen when that was before now: the moment the socket closed (the server waits a reconnect
 * grace before `_seen`), or their newest activity before a crash (the boot runs `_seen` for them). Never in the
 * future, and lastSeenAt never moves backwards.
 */
export const _seen = {
  schema: { pid: V.pid, at: V.opt(V.int(0, Number.MAX_SAFE_INTEGER)) },
  check(state, a, ctx) {
    if (!Object.hasOwn(state.players, a.pid)) return ERR.NOT_FOUND;
    return a.at !== undefined && a.at > ctx.now ? ERR.BAD_ARGS : null;
  },
  apply(tx, a, ctx) {
    const prev = tx.get(['players', a.pid, 'lastSeenAt']);
    const at = a.at ?? ctx.now;
    tx.set(['players', a.pid, 'lastSeenAt'], Number.isSafeInteger(prev) && prev > at ? prev : at);
    const seat = tx.get(['farm', 'coop', 'bench', a.pid]);
    if (seat) {
      tx.del(['farm', 'coop', 'bench', a.pid]);
      tx.emit({ e: 'stood', pid: a.pid, id: seat.id });
    }
  },
};

/**
 * True when `_rollover` has work: a new farm day, or (from the Almanac's level) a player or the Together task still
 * on an older day (a farm that reached the level without a level-up event, a save from an older build).
 */
function rolloverDue(state, now) {
  const d = state.farm.daily;
  if (!d) return false;
  const day = dayOf(state, now);
  // The farm day never moves backwards (SV-04: HH_TZ moved west): the farm waits until the new zone catches up.
  if (day < d.day) return false;
  if (d.day !== day) return true;
  if (folkDue(state, now)) return true;         // the townsfolk board has no requests for this week yet
  if (levelFromXp(state.farm.xp) < ALMANAC.unlock) return false;
  if (!d.together || !(d.together.d >= day)) return true;
  for (const pid of Object.keys(state.players)) if (!(state.players[pid].almanac?.d >= day)) return true;
  return false;
}

/** `_rollover {}`: a new farm day (and maybe week) began; one action catches up any number of missed days. */
export const _rollover = {
  schema: {},
  check(state, a, ctx) {
    return rolloverDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    rollover(tx, ctx);
  },
};

/** Slot keys that need an order now: missing slots, empty slots whose refill time came, stale orders. */
function ordersDue(state, now) {
  const ob = state.farm.orders;
  if (!ob) return false;
  const want = slotsWanted(state);
  if (Object.keys(ob.slots).length < want) return true;
  for (const k of Object.keys(ob.slots)) {
    const s = ob.slots[k];
    if ((s.order === null && s.availableAt <= now) || staleOrder(s.order)) return true;
  }
  return false;
}

/** `_orders {}`: add the slots the level allows, fill every slot whose refill time came, replace stale orders. */
export const _orders = {
  schema: {},
  check(state, a, ctx) {
    return ordersDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    const want = slotsWanted(tx.state);
    for (let i = Object.keys(tx.state.farm.orders.slots).length; i < want; i++) {
      tx.set(['farm', 'orders', 'slots', String(i)], { availableAt: ctx.now, order: null, pin: null, flag: null });
    }
    const keys = Object.keys(tx.state.farm.orders.slots).map(Number).sort((x, y) => x - y);
    for (const i of keys) {
      const k = String(i);
      const s = tx.state.farm.orders.slots[k];
      if (!((s.order === null && s.availableAt <= ctx.now) || staleOrder(s.order))) continue;
      const order = generateOrder(tx.state, ctx.now, ctx.rng, { slot: i });
      const ob = tx.state.farm.orders;
      if (!order) {
        // nothing valid to ask for (G-VALID, at most two open orders per item): try again after a refill period
        tx.set(['farm', 'orders', 'slots', k], { ...s, availableAt: ctx.now + refillMsOf(i), order: null });
        continue;
      }
      tx.set(['farm', 'orders', 'n'], ob.n + 1);
      tx.set(['farm', 'orders', 'slots', k], { availableAt: s.availableAt, order, pin: null, flag: null });
      tx.set(['farm', 'orders', 'recent'], [...ob.recent, sortedKeys(order.items)].slice(-ORDERS.weights.recentWindow));
      if (order.golden) {
        tx.set(['farm', 'orders', 'golden'], blockOf(tx.state, ctx.now));
        tx.set(['farm', 'orders', 'goldenN'], ob.goldenN + 1);
      }
      tx.emit({ e: 'orderNew', slot: i, golden: Boolean(order.golden) });
    }
  },
};

/** The two players seated on one two-seat bench, or null. */
export function benchPair(state) {
  const bench = state.farm.coop?.bench ?? {};
  const pids = sortedKeys(bench).filter((p) => hasPlayer(state, p));
  for (let i = 0; i < pids.length; i++) {
    for (let j = i + 1; j < pids.length; j++) {
      const a = bench[pids[i]];
      const b = bench[pids[j]];
      if (a.id === b.id && Object.hasOwn(state.farm.objects, a.id)) {
        return { a: pids[i], b: pids[j], id: a.id, since: Math.max(a.at, b.at) };
      }
    }
  }
  return null;
}

function goldenDueAt(state) {
  const pair = benchPair(state);
  if (!pair) return Infinity;
  const at = pair.since + COOP.goldenHour.seatMs;
  const last = state.farm.coop?.goldenAt;
  const gap = Number.isSafeInteger(last) ? last + COOP.goldenHour.sessionGapMs : 0;
  return Math.max(at, gap);
}

/** `_golden {}`: both players sat on one bench for seatMs: Golden Hour for 30 min (GDD §6.2 #9). */
export const _golden = {
  schema: {},
  check(state, a, ctx) {
    const pair = benchPair(state);
    if (!pair || goldenDueAt(state) > ctx.now || !goldenHourAllowed(state, ctx.now)) return ERR.ALREADY_DONE;
    return null;
  },
  apply(tx, a, ctx) {
    const pair = benchPair(tx.state);
    const g = COOP.goldenHour;
    // an upgraded bench (wave 4, owner wish E) makes its Golden Hour last longer
    const until = ctx.now + g.durationMs + benchGoldenMs(tx.state, pair.id);
    tx.set(['farm', 'coop', 'golden'], { from: ctx.now, until });
    tx.set(['farm', 'coop', 'goldenAt'], ctx.now);
    const def = decorOf(tx.state.farm.objects[pair.id].def);
    const extra = def?.effect?.heartsPerGoldenHour ?? 0;
    useReceipts(tx, [pair.id]);                       // a bench that gave a Golden Hour is no 100 % undo (RC-08)
    tx.emit({ e: 'together', kind: 'goldenHour', a: pair.a, b: pair.b, bench: pair.id, until,
      hearts: g.hearts + extra });
    feedAdd(tx, ctx, { k: 'golden', a: pair.a, b: pair.b });
  },
};

/**
 * `_fair {}`: the County Fair's week (GDD §5.6): close a finished week with its Sunday 20:00 ceremony (exactly once,
 * whatever the downtime), then open this week's Fair while it is still open. Catch-up safe: one action.
 */
export const _fair = {
  schema: {},
  check(state, a, ctx) {
    return fairDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    fairRoll(tx, ctx);
  },
};

/**
 * `_barge {}`: the River Barge's week (GDD §5.7): cast off at Sunday 20:00 (the ladder moves, next week's goods are
 * frozen for the jetty preview), dock at Monday 06:00 with this week's rows. Catch-up safe: one action.
 */
export const _barge = {
  schema: {},
  check(state, a, ctx) {
    return bargeDue(state, ctx.now) ? null : ERR.ALREADY_DONE;
  },
  apply(tx, a, ctx) {
    bargeRoll(tx, ctx);
  },
};

export const SYSTEM_ACTIONS = { _join, _seen, _rollover, _orders, _golden, _fair, _barge };

/**
 * Time-driven system actions that are due at `now`, in a fixed order (deterministic). Each one's check() passes
 * exactly when it is listed here, and its apply clears the condition (test/system.goals.test.js fuzzes both).
 * @returns {Array<{type: string, args: object}>}
 */
export function dueSystemActions(state, now) {
  const due = [];
  if (rolloverDue(state, now)) due.push({ type: '_rollover', args: {} });
  if (ordersDue(state, now)) due.push({ type: '_orders', args: {} });
  if (benchPair(state) && goldenDueAt(state) <= now && goldenHourAllowed(state, now)) {
    due.push({ type: '_golden', args: {} });
  }
  if (fairDue(state, now)) due.push({ type: '_fair', args: {} });
  if (bargeDue(state, now)) due.push({ type: '_barge', args: {} });
  if (trackDue(state, now)) due.push({ type: '_track', args: {} });
  if (duelDue(state, now)) due.push({ type: '_duel', args: {} });
  if (grandmaDue(state, now)) due.push({ type: '_grandma', args: {} });
  // wave 4b: the balloon's loot crates (actions/crates.js `_crate`): a new pass, or a crate going to the Barn
  if (crateDue(state, now)) due.push({ type: '_crate', args: {} });
  // the economy's own (debris regrowth, Wishlist auto-release): shared/rules/actions/expansions.js
  for (const d of econDue(state, now)) due.push(d);
  return due;
}

const midnights = new Map();

/** The first epoch ms of the farm day after `now` (DST-safe: a binary search on the farm calendar). */
export function nextDayStart(now, tz) {
  const day = dayIndex(now, tz);
  const key = `${tz}|${day}`;
  const hit = midnights.get(key);
  if (hit !== undefined && hit > now) return hit;
  let lo = now;
  let hi = now + 27 * 3_600_000;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (dayIndex(mid, tz) === day) lo = mid; else hi = mid;
  }
  if (midnights.size > 64) midnights.clear();
  midnights.set(key, hi);
  return hi;
}

/** `now` when dueSystemActions() has work, else the earliest future moment it grows, or Infinity. The server caps
 * its timer delay. */
export function nextSystemDueAt(state, now) {
  // Something already due (an instant order refill, debris regrowth after downtime): say so, so the server's
  // scheduler runs it at once instead of waiting for the next future due time or the next player action.
  if (dueSystemActions(state, now).length) return now;
  let t = state.farm.daily ? nextDayStart(now, state.meta.tz) : Infinity;
  const ob = state.farm.orders;
  if (ob) {
    for (const k of Object.keys(ob.slots)) {
      const s = ob.slots[k];
      if (s.order === null && s.availableAt > now && s.availableAt < t) t = s.availableAt;
    }
  }
  const g = goldenDueAt(state);
  if (g > now && g < t) t = g;
  for (const w of [fairNextAt(state, now), bargeNextAt(state, now), trackNextAt(state, now), duelNextAt(state),
    grandmaNextAt(state), crateNextAt(state, now)]) if (w > now && w < t) t = w;
  const e = econNextDueAt(state, now);
  if (e > now && e < t) t = e;
  return t;
}

