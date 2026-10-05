// The Acorn shop's unique items (wave 4b, owner wish 2; content RELICS in shared/content/wishes4b.js). Pure helpers:
// economy.js reads the Golden Barn through this module, so it must not import any action family.
//
// farm.relics = { [relicId]: { at, by, d? } }   bought at `at` by `by`; `d` = the farm day the once-a-day helper (the
//                                                Farmhand, the Time Turner) was last used. A relic is never sold.
// Placed relics (the Golden Sprinkler, the Growth Totem, the Rainbow Tree) work through their defs where they stand;
// the charms (the Golden Watering Can, the Farmhand, the Lucky Clover, the Time Turner, the Golden Barn) farm-wide.
import { RELICS, relicOf, isLive, levelFromXp, barnCapacity } from '../content/index.js';
import { dayIndex } from './calendar.js';

const mulBp = (n, bp) => Math.floor((n * bp) / 10_000);

/** True when the farm owns relic `id` (own key; a save from before wave 4b has no `relics`). */
export function hasRelic(state, id) {
  const r = state.farm.relics;
  return Boolean(r) && typeof r === 'object' && Object.hasOwn(r, id) && isLive(relicOf(id));
}

/** The Lucky Clover's extra blue-ribbon chance (basis points), 0 without it. */
export const relicLuckBp = (state) => (hasRelic(state, 'lucky_clover') ? relicOf('lucky_clover').fx.luckBp ?? 0 : 0);

/** The Golden Barn's extra Barn capacity: barnBp of the Barn's own capacity, at least barnMin; 0 without it. */
export function relicBarnCap(state) {
  if (!hasRelic(state, 'golden_barn')) return 0;
  const fx = relicOf('golden_barn').fx;
  return Math.max(fx.barnMin ?? 0, mulBp(barnCapacity(state.farm.barn ?? 0), fx.barnBp ?? 0));
}

/** True when a once-a-day relic (`farmhand`, `time_turner`) was already used on the farm day of `now`. */
export function relicUsedToday(state, id, now) {
  const r = hasRelic(state, id) ? state.farm.relics[id] : null;
  return Boolean(r) && r.d === dayIndex(now, state.meta.tz);
}

/**
 * The Acorn shop for panels and the Goal Tracker, in content order: [{ id, name, kind, def?, acorns, unlock, text,
 * owned, by?, at?, daily?, used?, code }]. code: null (buy now), LOCKED (below its level), ALREADY_DONE (owned),
 * NO_ACORNS (saving up: `have` of `acorns`). Pure.
 */
export function relicView(state, now = 0) {
  const L = levelFromXp(state.farm.xp);
  const have = state.farm.wallet.acorns;
  return RELICS.filter(isLive).map((r) => {
    const own = hasRelic(state, r.id) ? state.farm.relics[r.id] : null;
    const code = own ? 'ALREADY_DONE' : L < r.unlock ? 'LOCKED' : have < r.acorns ? 'NO_ACORNS' : null;
    const row = { id: r.id, name: r.name, kind: r.kind, acorns: r.acorns, unlock: r.unlock, text: r.text,
      owned: Boolean(own), have: Math.min(have, r.acorns), code };
    if (r.def) row.def = r.def;
    if (own) Object.assign(row, { by: own.by, at: own.at });
    if (r.fx?.daily) {
      row.daily = r.fx.daily;
      row.used = Boolean(own) && relicUsedToday(state, r.id, now);
    }
    return row;
  });
}
