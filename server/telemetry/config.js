// Telemetry knobs (docs/agent-notes/harness-contract.md §6). The mods lane's server/config.js block may call
// telemetryConfig(env) and hand the result in as cfg.telemetry; until it does, createTelemetry() reads the environment.
//
//   HH_TELEMETRY=off            nothing is ever queued or sent, whatever a farmer chose (the operator's kill switch)
//   HH_TELEMETRY_URL=<url>      where shared events go (default the public host's /api/telemetry); 'off' = never send
//   HH_TELEMETRY_RECEIVE=1      mount the receiver in single mode too (multi mode always mounts it)
//   HH_TELEMETRY_PER_DAY=<n>    the receiver's global daily cap (default 5000)
import { ConfigError } from '../config.js';

export const DEFAULT_TELEMETRY_URL = 'https://harvest-hollow.up.railway.app/api/telemetry';
/** The sender: at most this many events an hour leave one server. */
export const SEND_PER_HOUR = 20;
/** The sender: an event that could not be delivered for this long is dropped. */
export const OUTBOX_MAX_AGE_MS = 7 * 86_400_000;
/** The sender: the most events waiting on disk (the oldest go first above it). */
export const OUTBOX_MAX = 500;
/** The receiver keeps an event this long, then the hourly sweep deletes it (the privacy page says 12 months). */
export const TELEMETRY_KEEP_MS = 365 * 86_400_000;
/** The receiver's limits: per client address an hour, per install a day, all together a day (HH_TELEMETRY_PER_DAY). */
export const RECEIVE_LIMITS = Object.freeze({ perAddressHour: 60, perInstallDay: 200, perDay: 5000 });
/** One event's JSON at most (the receiver answers 413 above it; the sender trims the mod files to fit). */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** The validated telemetry configuration; a set but invalid value is a configuration error (the boot stops). */
export function telemetryConfig(env = process.env) {
  const off = env.HH_TELEMETRY === 'off';
  let url = DEFAULT_TELEMETRY_URL;
  const raw = env.HH_TELEMETRY_URL;
  if (raw === 'off') url = null;
  else if (raw !== undefined && raw !== '') {
    let u = null;
    try { u = new URL(raw); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol) || u.username || u.password) {
      throw new ConfigError(`HH_TELEMETRY_URL must be an http(s) URL without a user name or password, or off`);
    }
    url = u.href;
  }
  let perDay = RECEIVE_LIMITS.perDay;
  if (env.HH_TELEMETRY_PER_DAY !== undefined && env.HH_TELEMETRY_PER_DAY !== '') {
    const n = Number(env.HH_TELEMETRY_PER_DAY);
    if (!Number.isSafeInteger(n) || n < 1) throw new ConfigError(`HH_TELEMETRY_PER_DAY=${env.HH_TELEMETRY_PER_DAY} must be an integer >= 1`);
    perDay = n;
  }
  return {
    enabled: !off,                                   // false: record() is a no-op for everyone
    url,                                             // null: nothing is sent over HTTP (a local receiver still stores)
    urlExplicit: raw !== undefined && raw !== '',    // an operator-chosen address always gets the HTTP delivery
    receive: env.HH_TELEMETRY_RECEIVE === '1',
    perDay,
  };
}
