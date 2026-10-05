// Daily actions (GDD §5.8). Owned by rules-goals; the systems live in shared/rules/daily.js.
//
//   claimGift     {}          the Daily Gift: either partner, once per farm day, from L3; a missed day only pauses
//                             the 28-day calendar
//   almanacReroll { slot }    swap one of my Almanac tasks for another (one free reroll per player per day)
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';
import { ALMANAC, DAILY_GIFT, levelFromXp } from '../../content/index.js';
import { dayOf } from '../coop.js';
import { claimGift as claim, rerollTask } from '../daily.js';

export const claimGift = {
  schema: {},
  check(state, a, ctx) {
    if (levelFromXp(state.farm.xp) < DAILY_GIFT.unlock) return ERR.LOCKED;
    // `>=`: a farm zone moved west must not make yesterday's gift claimable again (SV-04)
    return state.farm.daily.gift.last >= dayOf(state, ctx.now) ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    claim(tx, ctx, null);
  },
};

export const almanacReroll = {
  schema: { slot: V.int(0, ALMANAC.tasksPerPlayer - 1) },
  check(state, a, ctx) {
    const al = state.players[ctx.pid].almanac;
    if (levelFromXp(state.farm.xp) < ALMANAC.unlock || !al || al.d !== dayOf(state, ctx.now)) return ERR.LOCKED;
    if (!Object.hasOwn(al.tasks, String(a.slot))) return ERR.NOT_FOUND;
    return al.rerolls >= ALMANAC.freeRerollsPerDay ? ERR.COOLDOWN : null;
  },
  apply(tx, a, ctx) {
    rerollTask(tx, ctx, ctx.pid, String(a.slot));
    tx.emit({ e: 'almanacRerolled', pid: ctx.pid, slot: String(a.slot) });
  },
};
