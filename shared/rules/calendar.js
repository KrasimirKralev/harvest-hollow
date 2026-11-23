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

// ---- the farm's clock (release 1.0, D3: seed rows and the Plant for later card say WHEN, not how long) ----------

const clockFmt = new Map();

/** Local hour and minute of `now` in `tz` (24 h; DST-safe: Intl answers for the instant). */
export function localTime(now, tz) {
  let f = clockFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    clockFmt.set(tz, f);
  }
  const out = { h: 0, m: 0 };
  for (const p of f.formatToParts(now)) {
    if (p.type === 'hour') out.h = Number(p.value) % 24;
    else if (p.type === 'minute') out.m = Number(p.value);
  }
  return out;
}

/** The local hour (0-23) of `now` in the farm's zone. */
export const localHour = (now, tz) => localTime(now, tz).h;

/** "08:40": a local clock reading, zero-padded, 24 hours (both languages write it the same way). */
export const clockText = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/**
 * When a crop planted at `now` that grows `growMs` is ready, on the farm's clock: { at, t: '21:40', days } where
 * `days` = farm days after today's (0 today, 1 tomorrow ...). DST-safe: the instant is converted, never the hours
 * added (25 Oct 2026, Europe/Sofia: 21:00 + 12 h = 08:00 the next morning, not 09:00).
 */
export function readyClock(now, growMs, tz) {
  const at = now + Math.max(0, growMs);
  const { h, m } = localTime(at, tz);
  return { at, t: clockText(h, m), days: dayIndex(at, tz) - dayIndex(now, tz) };
}
