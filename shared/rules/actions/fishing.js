// The Fishing Dock (GDD §6.2 mechanic 21, v2 A4; M2). Owned by rules-economy.
//
// A calm 20-second timing cast at a fishing spot: Willow Pond's own dock (the expansion's `feature.fishingSpot`, from
// FISHING.unlock) or a placed Fishing Dock decor (from FISHING.spots.decorFrom). The bite comes somewhere in
// FISHING.biteMs after the cast; reeling within perfectMs of it is grade 2, within goodMs grade 1, otherwise grade 0
// ("the line came back anyway"): every reel lands a fish, never punishing. Once a fish is landed the farmer rests for
// FISHING.cooldownMs (once an hour each). Catches are NEVER an economy item (v2 A4): a species and a size for the
// dock's trophy board (the biggest of each species, the week's biggest fish for the Sunday photo), and one eligible
// `fish` roll of the collections album (Pond Treasures; rules-goals rolls it on `fishCaught`).
// Together: when the OTHER player cast at the same spot within FISHING.together.windowMs, both are fishing together:
// the `together:dock` deed (quest H6, rules-goals counts `fishTogether`) and, once a farm day each, a Heart.
//
//   cast {id? | pond?}   cast at a Fishing Dock decor (`id`, the avatar within sitRadius tiles as the server sees it)
//                        or at an owned expansion's pond (`pond`, e.g. 'willow_pond'); a running cast is replaced
//   reel {}              reel in: the fish (species and size rolled on farm.rolls.fish), the grade by the timing
//
// The bite time is rolled at the cast on farm.rolls.fishBite and the catch at the reel on farm.rolls.fish (replicated
// counters bumped in the same tx), so client prediction, server and replay agree and nothing re-rolls.
// State: `players[pid].fish = { cast: null | { spot, at, bite, done? }, at: last landing, day: farm day of the last
// together Heart }` (done: reeled in; the cast stays as the together window's record), `farm.fishing = { records:
// { fish: { cm, by, at } }, week: { n, best }, n }`.
import { FISHING, expansionOf, isLive, levelFromXp } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { objectOf } from '../grid.js';
import { dayIndex, weekIndex } from '../calendar.js';
import { addHearts } from '../coop.js';
import { useReceipts } from '../economy.js';

/** True when the Fishing Dock is part of this build and the farm reached its level. */
export const fishingLive = (state) => Boolean(FISHING) && isLive(FISHING)
  && levelFromXp(state.farm.xp) >= FISHING.unlock;

/** The spot an args object names ({ spot } = its id) or { code }. */
export function spotOf(state, a) {
  if ((a.id === undefined) === (a.pond === undefined)) return { code: ERR.BAD_ARGS };
  if (a.pond !== undefined) {
    const e = expansionOf(a.pond);
    if (!e || !e.feature?.fishingSpot || !state.farm.expansions.includes(a.pond)) return { code: ERR.NOT_FOUND };
    return { spot: a.pond };
  }
  const o = objectOf(state, a.id);
  if (!o || o.def !== FISHING.spots.decor) return { code: ERR.NOT_FOUND };
  if (levelFromXp(state.farm.xp) < FISHING.spots.decorFrom) return { code: ERR.LOCKED };
  return { spot: a.id };
}

/** Every fishing spot of the farm now (owned ponds first, then docks by id), for panels and the Goal Tracker. */
export function fishingSpots(state) {
  if (!fishingLive(state)) return [];
  const out = [];
  for (const e of state.farm.expansions) if (expansionOf(e)?.feature?.fishingSpot) out.push({ pond: e });
  if (levelFromXp(state.farm.xp) >= FISHING.spots.decorFrom) {
    for (const id of Object.keys(state.farm.objects).sort()) {
      if (state.farm.objects[id].def === FISHING.spots.decor) out.push({ id });
    }
  }
  return out;
}

const mine = (state, pid) => state.players[pid]?.fish ?? { cast: null, at: 0, day: 0 };

/** When `pid` may land the next fish (the hourly rest after a catch). */
export const nextCastAt = (state, pid) => {
  const f = mine(state, pid);
  return f.at > 0 ? f.at + FISHING.cooldownMs : 0;
};

/** Reel grade for a reel at `now` against a bite at `bite`: 2 perfect, 1 good, 0 the line came back anyway. */
export function gradeOf(bite, now, grace = 0) {
  const off = Math.abs(now - bite);
  if (off <= FISHING.perfectMs + grace) return 2;
  if (off <= FISHING.goodMs + grace) return 1;
  return 0;
}

/**
 * The fish a reel lands (pure; keyed on the farm's catch counter): { fish, cm }. Species by weight; the size inside
 * the species' range, the grade lifting its floor (FISHING.gradeFloorBp).
 */
export function catchOf(state, ctx, grade) {
  const n = state.farm.rolls.fish ?? 0;
  const list = FISHING.fish;
  const total = list.reduce((t, f) => t + f.weightBp, 0);
  let r = Math.floor(ctx.rng('fish', n) * total);
  let pick = list.at(-1);
  for (const f of list) {
    if (r < f.weightBp) { pick = f; break; }
    r -= f.weightBp;
  }
  const [lo, hi] = pick.cm;
  const floor = lo + Math.floor(((hi - lo) * (FISHING.gradeFloorBp[grade] ?? 0)) / 10_000);
  const cm = floor + Math.floor(ctx.rng('fishSize', n) * (hi - floor + 1));
  return { fish: pick.id, cm: Math.min(hi, cm) };
}

function castCode(state, a, ctx) {
  if (!fishingLive(state)) return ERR.LOCKED;
  const s = spotOf(state, a);
  if (s.code) return s.code;
  // a dock decor: the avatar must stand at it, as the server sees it (like a bench; a prediction has no ext.near)
  const near = ctx.ext && ctx.ext.near;
  if (a.id !== undefined && Number.isFinite(near) && near > FISHING.sitRadius * 10) return ERR.TOO_FAR;
  if (ctx.now < nextCastAt(state, ctx.pid)) return ERR.COOLDOWN;
  return null;
}

/** The other players who cast at `spot` within the together window before `now` (sorted pids). */
function partnersAt(state, pid, spot, now) {
  const out = [];
  for (const q of Object.keys(state.players).sort()) {
    const c = q === pid ? null : state.players[q].fish?.cast;
    // their last cast (in the water or already reeled in) went in at this spot within the window
    if (c && c.spot === spot && now - c.at <= FISHING.together.windowMs) out.push(q);
  }
  return out;
}

/** The line `pid` has in the water now (a cast not reeled in yet), or null. */
export const lineOf = (state, pid) => {
  const c = mine(state, pid).cast;
  return c && !c.done ? c : null;
};

export const cast = {
  schema: { id: V.opt(V.objId), pond: V.opt(V.content('expansions')) },
  check(state, a, ctx) { return castCode(state, a, ctx); },
  apply(tx, a, ctx) {
    const { spot } = spotOf(tx.state, a);
    const k = tx.state.farm.rolls.fishBite ?? 0;
    tx.inc(['farm', 'rolls', 'fishBite'], 1);                       // the roll key: a replicated counter
    if (a.id !== undefined) useReceipts(tx, [a.id]);                // a dock decor that was fished from is no 100 % undo
    const [b0, b1] = FISHING.biteMs;
    const bite = ctx.now + b0 + Math.floor(ctx.rng('fishBite', k) * (b1 - b0 + 1));
    const f = mine(tx.state, ctx.pid);
    tx.set(['players', ctx.pid, 'fish'], { cast: { spot, at: ctx.now, bite }, at: f.at, day: f.day });
    tx.emit({ e: 'fishCast', pid: ctx.pid, spot, bite, by: ctx.pid });
    // fishing together: the OTHER player's line went in at this spot within the window (R17: a bonus on top)
    const partners = partnersAt(tx.state, ctx.pid, spot, ctx.now);
    if (partners.length === 0) return;
    const day = dayIndex(ctx.now, tx.state.meta.tz);
    const pids = [ctx.pid, ...partners].sort();
    const hearts = [];
    for (const p of pids) {
      const rec = tx.state.players[p].fish;
      if (rec.day === day) continue;                                // one fishing-together Heart a day each
      tx.set(['players', p, 'fish', 'day'], day);
      addHearts(tx, p, FISHING.together.hearts);
      hearts.push(p);
    }
    tx.emit({ e: 'fishTogether', spot, pids, hearts, by: ctx.pid });
  },
};

export const reel = {
  schema: {},
  check(state, a, ctx) {
    if (!fishingLive(state)) return ERR.LOCKED;
    if (!lineOf(state, ctx.pid)) return ERR.NOT_FOUND;
    return ctx.now < nextCastAt(state, ctx.pid) ? ERR.COOLDOWN : null;
  },
  apply(tx, a, ctx) {
    const f = mine(tx.state, ctx.pid);
    const c = f.cast;
    const grade = gradeOf(c.bite, ctx.now, ctx.grace);
    const { fish, cm } = catchOf(tx.state, ctx, grade);
    tx.inc(['farm', 'rolls', 'fish'], 1);
    // the cast stays as the record of where and when this farmer fished (the together window), marked done
    tx.set(['players', ctx.pid, 'fish'], { cast: { ...c, done: true }, at: ctx.now, day: f.day });
    const F = tx.state.farm.fishing;
    tx.set(['farm', 'fishing', 'n'], F.n + 1);
    const rec = { cm, by: ctx.pid, at: ctx.now };
    const old = F.records[fish];
    const record = !old || cm > old.cm;
    if (record) tx.set(['farm', 'fishing', 'records', fish], rec);
    const week = weekIndex(dayIndex(ctx.now, tx.state.meta.tz));
    const best = F.week.n === week ? F.week.best : null;
    const weekBest = !best || cm > best.cm;
    if (weekBest || F.week.n !== week) {
      tx.set(['farm', 'fishing', 'week'], { n: week, best: weekBest ? { fish, ...rec } : best });
    }
    const ev = { e: 'fishCaught', pid: ctx.pid, spot: c.spot, fish, cm, grade, record, weekBest, by: ctx.pid };
    if (FISHING.fish.find((x) => x.id === fish)?.joke) ev.joke = true;
    tx.emit(ev);
  },
};

/** The dock's trophy board for a panel: every species with its record (or null), in content order. */
export function trophyBoard(state) {
  const r = state.farm.fishing?.records ?? {};
  return (FISHING?.fish ?? []).map((f) => ({ id: f.id, name: f.name, cm: f.cm, record: r[f.id] ?? null }));
}

