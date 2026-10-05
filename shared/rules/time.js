// Timer helpers (tech-architecture §2.4). Everything takes `now` (server epoch ms) as a parameter; nothing
// ticks and nothing reads a clock. Owned by the Rules lane; extend freely.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0..1 progress of a one-shot process { startedAt|plantedAt, readyAt }. */
export function progress(o, now) {
  const start = o.startedAt ?? o.plantedAt;
  if (o.readyAt <= start) return 1;
  return clamp01((now - start) / (o.readyAt - start));
}

/** Ready when now + grace >= readyAt. The server passes READY_GRACE_MS, the client 0 (tech §4.3). */
export const isReady = (o, now, grace = 0) => now + grace >= o.readyAt;

/** Visual stage index into def.stages by progress (visual only, derived, never stored). */
export function stage(def, o, now) {
  const p = progress(o, now);
  if (p >= 1) return def.stages.length - 1;
  let s = 0;
  for (let i = 0; i < def.stages.length - 1; i++) if (p >= def.stages[i]) s = i;
  return s;
}

/** The next moment the object's look changes (next stage boundary or readyAt), or null if none. */
export function nextVisualChangeAt(def, o, now) {
  const start = o.startedAt ?? o.plantedAt;
  const span = o.readyAt - start;
  for (const s of def.stages) {
    const at = start + Math.ceil(s * span);
    if (at > now) return at;
  }
  return null;
}

/**
 * Regenerating resource { amount, at }: +1 every `period` ms up to `cap` (over-cap gifts allowed).
 * `now` before `at` (a client clock estimate a few ms behind the server that wrote `at`) counts as no time
 * elapsed, never as negative time (review-m0 #12).
 */
export function regenValue(r, cap, period, now) {
  if (r.amount >= cap) return r.amount;
  return Math.min(cap, r.amount + Math.floor(Math.max(0, now - r.at) / period));
}

/** Spend n units (caller checked regenValue >= n); keeps partial progress unless it was full. */
export function regenSpend(r, cap, period, now, n) {
  const v = regenValue(r, cap, period, now);
  const at = v >= cap ? now : r.at + Math.floor(Math.max(0, now - r.at) / period) * period;
  return { amount: v - n, at };
}

// ---- weather (GDD §5.10) ------------------------------------------------------------------------------------------

/** One weather hour. Rules and the renderer both index real hours from the epoch (whole-hour zones agree). */
export const HOUR_MS = 3_600_000;

/** The weather hour of an instant. */
export const hourIndex = (now) => Math.floor(now / HOUR_MS);

/** FNV-1a 32 over two integers (integer ops only: the same on every engine). */
function mix32(a, b) {
  let h = 2166136261;
  const s = `${a >>> 0}|${b}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return h >>> 0;
}

/** A new farm's first hours are always sunny: the couple's first look at the valley is not in the rain. */
export const FRESH_SUNNY_HOURS = 2;

/**
 * The weather of one real hour, shared by both players: a pure function of the farm seed and the hour (GDD §5.10:
 * sunny 70 %, cloudy 15 %, light rain 12 %, windy 3 %). Byte-for-byte the function public/js/render/weather.js
 * draws, so it never rains on screen while the crops stay dry. In winter the rain falls as snow (cosmetic: it
 * still waters). With the farm's `createdAt`, the hour it was created and the next one are sunny (wave-1 QA
 * integration "the first arrival can be in rain"); the renderer passes the same `createdAt`.
 * @param {number} farmSeed @param {number} hour  hourIndex(t) @param {number} [createdAt]  state.meta.createdAt
 * @returns {'sunny' | 'cloudy' | 'rain' | 'windy'}
 */
export function weatherAt(farmSeed, hour, createdAt) {
  if (Number.isSafeInteger(createdAt) && hour < hourIndex(createdAt) + FRESH_SUNNY_HOURS) return 'sunny';
  const r = mix32(farmSeed | 0, hour | 0) % 10000;
  if (r < 7000) return 'sunny';
  if (r < 8500) return 'cloudy';
  if (r < 9700) return 'rain';
  return 'windy';
}

/** True when it rains in the hour of `now` (pass the farm's createdAt: its first hours are sunny). */
export const rainingAt = (farmSeed, now, createdAt) => weatherAt(farmSeed, hourIndex(now), createdAt) === 'rain';

/**
 * Settled: past its 10-minute undo receipt (or never refundable). Everything that reads HOLDINGS (ribbons, story
 * state tasks, land proofs) counts settled objects only, so a buy-and-undo loop earns nothing (GDD §9 #9, R12;
 * wave-1 QA RC-05).
 */
export const settled = (o, now) => !o.rcpt || !Number.isSafeInteger(o.rcpt.until) || o.rcpt.until <= now;
