// The farm calendar (review-m0 #3). Day, week and season are LOCAL to the farm's IANA time zone
// (state.meta.tz, set from HH_TZ when the farm is created), so the client's prediction, the server and journal
// replay all compute the same "day" whatever zone the browser runs in. Pure: `now` is a parameter; Intl is a
// pure function of (instant, zone). Never use the browser's zone or Date#getDay/getMonth in rules.
//
// Rules call dayIndex(ctx.now, state.meta.tz). dueSystemActions(state, now) reads state.meta.tz the same way.

const DAY_MS = 86_400_000;
const fmt = new Map();

function parts(now, tz) {
  let f = fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' });
    fmt.set(tz, f);
  }
  const out = { year: 0, month: 0, day: 0 };
  for (const p of f.formatToParts(now)) if (p.type in out) out[p.type] = Number(p.value);
  return out;
}

/** True when `tz` is an IANA zone this runtime knows. */
export function isTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    parts(0, tz);
    return true;
  } catch {
    return false;
  }
}

/** Local calendar day of `now` in `tz`, as days since 1970-01-01 (that local date read as UTC). */
export function dayIndex(now, tz) {
  const p = parts(now, tz);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

/** Week index of a dayIndex; weeks start on Monday (tech §4.5). 1970-01-01 was a Thursday. */
export const weekIndex = (day) => Math.floor((day + 3) / 7);

/** Meteorological season of the local date: Dec-Feb winter, Mar-May spring, Jun-Aug summer, Sep-Nov autumn. */
export function seasonOf(now, tz) {
  return ['winter', 'spring', 'summer', 'autumn'][Math.floor((parts(now, tz).month % 12) / 3)];
}
