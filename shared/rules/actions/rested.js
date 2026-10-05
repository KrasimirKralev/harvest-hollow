// Rested XP (GDD §4.7 "Welcome back", §6.2 #18; M2). Owned by rules-goals.
//
// While a player is offline, rested XP accrues at 5 % of their current personal level's requirement per 8 h, capped
// at 150 % of a level. It doubles their PERSONAL XP gains until used up; Farm XP is never touched (the partner's
// numbers and the shared level do not move).
//
// players[pid].rested = { xp, at }   xp = rested XP left (the bonus still to pay), at = when it was last accrued
//
// Accrual is lazy and deterministic: on the returning player's first action (processEvents), the time from their
// lastSeenAt (stamped by `_seen` when their last socket closed) to now accrues once, and `at` moves to now. While
// they stay online lastSeenAt stays older than `at`, so nothing accrues twice; a reconnect loop accrues only the
// seconds it was really away. Numbers: content RESTED when it exists, else RESTED_DEFAULT.
import * as C from '../../content/index.js';
import { personalLevelFromXp, levelFromXp } from '../../content/index.js';
import { systemLive, hasPlayer } from '../coop.js';
import { upgradeBonus } from '../upgrades.js';

/** GDD §4.7 numbers (content's RESTED, personal.js, when it exists; these otherwise). */
export const RESTED_DEFAULT = Object.freeze({ m: 'M2', unlock: 12, accrueBp: 500, perMs: 8 * 3_600_000, capBp: 15_000,
  bonusMul: 2 });
export const RESTED = C.RESTED ?? RESTED_DEFAULT;
/** Basis points of a level accrued per RESTED.perMs away (content names it `bp`; `accrueBp` is read too). */
const ACCRUE_BP = RESTED.bp ?? RESTED.accrueBp ?? RESTED_DEFAULT.accrueBp;

const BP = 10_000;

/** Fresh rested block of a player. */
export const initialRested = () => ({ xp: 0, at: 0 });

/** True when rested XP plays in this build (and, with a state, the farm has its level). */
export const restedLive = (state = null) => systemLive(RESTED)
  && (state === null || levelFromXp(state.farm.xp) >= (RESTED.unlock ?? 1));

/** The personal XP the player's current personal level needs to the next (the Legacy step past the table). */
export function personalStep(xp) {
  const L = personalLevelFromXp(xp);
  const rows = C.CONTENT.levels;
  const at = (lv) => {
    if (lv <= rows.length) return rows[lv - 1].personalXp;
    const top = rows.at(-1);
    return top.personalXp + (lv - rows.length) * (top.personalXp - rows.at(-2).personalXp);
  };
  return Math.max(1, at(L + 1) - at(L));
}

/** The cap of a pool for a player with personal XP `xp` (150 % of their level's requirement). */
export const restedCapOf = (xp) => Math.floor((personalStep(xp) * RESTED.capBp) / BP);

/** Ui names: the cap and the pool of player `pid`. */
export const restedCap = (state, pid) => restedCapOf(state.players[pid]?.xp ?? 0);
export const restedXp = (state, pid) => restedOf(state, pid);

/** Rested XP `ms` offline would add for a player with personal XP `xp` (before the cap). Integer math only. */
export function restedFor(xp, ms) {
  if (!(ms > 0)) return 0;
  // basis points of a level first (capped), then XP: the products stay far inside 2^53
  const bp = Math.min(RESTED.capBp, Math.floor((Math.min(ms, 400 * 86_400_000) * ACCRUE_BP) / RESTED.perMs));
  return Math.floor((personalStep(xp) * bp) / BP);
}

/** The player's rested XP left now (0 for an older save or before the feature plays). */
export const restedOf = (state, pid) => {
  const r = state.players[pid]?.rested;
  return r && Number.isSafeInteger(r.xp) ? r.xp : 0;
};

/**
 * Accrue a returning player's offline time (processEvents, once per action of a player). Writes only when the player
 * left after the last accrual. Emits the FX `rested { pid, xp, total }` when something accrued.
 */
export function restedAccrue(tx, ctx) {
  const pid = ctx.pid;
  if (!hasPlayer(tx.state, pid) || !restedLive(tx.state)) return;
  const p = tx.state.players[pid];
  const r = p.rested;
  const left = p.lastSeenAt;
  if (!Number.isSafeInteger(left)) return;
  const since = r && Number.isSafeInteger(r.at) ? r.at : 0;
  if (left <= since || left > ctx.now) return;
  // a brand-new player has never been away: their lastSeenAt is the join stamp, so start the clock here instead
  if (left === p.joinedAt) { tx.set(['players', pid, 'rested'], { xp: r && Number.isSafeInteger(r.xp) ? r.xp : 0, at: ctx.now }); return; }
  const cap = restedCapOf(p.xp ?? 0);
  const have = r && Number.isSafeInteger(r.xp) ? r.xp : 0;
  // the upgraded farmhouse's comfort (wave 4): rested XP builds restedBp faster (the cap holds)
  const base = restedFor(p.xp ?? 0, ctx.now - left);
  const add = Math.max(0, Math.min(cap - have, base + Math.floor((base * upgradeBonus(tx.state, 'restedBp')) / BP)));
  tx.set(['players', pid, 'rested'], { xp: have + add, at: ctx.now });
  if (add > 0) tx.emit({ e: 'rested', pid, xp: add, total: have + add, by: pid });
}

/**
 * The rested bonus on a personal XP gain of `n` (processEvents' addPersonalXp): the gain is multiplied by
 * RESTED.bonusMul (doubled) while the pool lasts. Spends the pool; returns the bonus.
 */
export function restedSpend(tx, pid, n) {
  if (!restedLive() || !(n > 0)) return 0;
  const r = tx.state.players[pid]?.rested;
  if (!r || !(r.xp > 0)) return 0;
  const bonus = Math.min(n * Math.max(0, (RESTED.bonusMul ?? 2) - 1), r.xp);
  tx.set(['players', pid, 'rested', 'xp'], r.xp - bonus);
  return bonus;
}
