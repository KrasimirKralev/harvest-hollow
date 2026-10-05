// Server configuration from the environment. Defaults are the production service values.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TZ } from '../shared/rules/state.js';
import { PLAYER_SLOTS } from '../shared/content/config.js';
import { isTimeZone } from '../shared/rules/calendar.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The machine's IANA zone (the farm's "midnight" by default), or DEFAULT_TZ when it cannot be read. */
export function machineTz() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(tz) ? tz : DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** A configuration problem: the process exits with EX_CONFIG (78), which the systemd unit does not restart. */
export class ConfigError extends Error {}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ port: number, host: string, dataDir: string, dev: boolean, tz: string, tzExplicit: boolean,
 *   replayAnyway: boolean, passphrase: string|null, slots: number, snapshotMs: number, quiet: boolean, logJson: boolean,
 *   root: string, version: string, heartbeatMs: number|undefined, anonIdleMs: number|undefined,
 *   awayGraceMs: number|undefined }}
 */
export function loadConfig(env = process.env) {
  const port = Number(env.PORT);
  const slots = Number(env.HH_SLOTS);
  const tz = env.HH_TZ || machineTz();
  if (!isTimeZone(tz)) throw new ConfigError(`HH_TZ=${tz} is not an IANA time zone (e.g. Europe/Sofia)`);
  const mode = env.HH_MODE || 'single';
  if (mode !== 'single' && mode !== 'multi') throw new ConfigError(`HH_MODE=${mode} must be single or multi`);
  // A public host must never carry the time-warp and drop routes: behind a reverse proxy on the same machine every
  // visitor would look like loopback to them.
  if (mode === 'multi' && env.HH_DEV === '1' && env.NODE_ENV === 'production') {
    throw new ConfigError('HH_DEV=1 is refused in multi-farm mode with NODE_ENV=production (dev routes on a public host)');
  }
  return {
    mode,                                 // 'single' (default: one farm, the LAN game) or 'multi' (hosted, server/multi.js)
    multi: mode === 'multi' ? multiConfig(env) : null,   // the hosting knobs (multiConfig), multi mode only
    port: env.PORT !== undefined && env.PORT !== '' && Number.isInteger(port) && port >= 0 && port < 65536 ? port : 3300,
    host: env.HH_HOST || '0.0.0.0',
    dataDir: path.resolve(env.HH_DATA_DIR || path.join(ROOT, 'data')),
    dev: env.HH_DEV === '1',              // dev routes (time warp, drop) on loopback only; never in the unit
    tz,                                   // the farm's calendar zone (state.meta.tz, review-m0 #3) for a NEW farm
    tzExplicit: Boolean(env.HH_TZ),       // HH_TZ set: an existing save moves to `tz` too (else it keeps its zone)
    replayAnyway: env.HH_REPLAY_ANYWAY === '1',   // boot even if the journal does not replay fully (H2)
    passphrase: env.HH_PASSPHRASE || null, // optional: required to claim or reclaim a slot
    // claimable player slots: the game is designed and tuned for two (GDD §6.6); up to PLAYER_SLOTS.length
    slots: Number.isInteger(slots) && slots >= 1 ? Math.min(slots, PLAYER_SLOTS.length) : Math.min(2, PLAYER_SLOTS.length),
    snapshotMs: Number(env.HH_SNAPSHOT_MS) || 30_000,
    quiet: env.HH_QUIET === '1',
    logJson: env.HH_LOG === 'json',       // one JSON object per log line
    heartbeatMs: Number(env.HH_HEARTBEAT_MS) || undefined,   // tests only (default LIMITS.HEARTBEAT_MS)
    anonIdleMs: Number(env.HH_ANON_IDLE_MS) || undefined,    // tests only (default sessions.ANON_IDLE_MS)
    // a player whose last socket closed stays online this long (sessions.AWAY_GRACE_MS); tests may set 0
    awayGraceMs: env.HH_AWAY_GRACE_MS !== undefined && env.HH_AWAY_GRACE_MS !== '' && Number.isSafeInteger(Number(env.HH_AWAY_GRACE_MS))
      && Number(env.HH_AWAY_GRACE_MS) >= 0 ? Number(env.HH_AWAY_GRACE_MS) : undefined,
    root: ROOT,
    version: packageVersion(),
  };
}

/** A positive integer from the environment, else `dflt` (a set but invalid value is a configuration error). */
function posInt(env, key, dflt, { min = 1 } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min) throw new ConfigError(`${key}=${raw} must be an integer >= ${min}`);
  return n;
}

/**
 * Multi-farm hosting knobs (HH_MODE=multi only; a set but invalid value refuses the boot).
 * Every duration is in milliseconds except HH_FARM_TTL_DAYS.
 */
export function multiConfig(env = process.env) {
  return {
    maxFarms: posInt(env, 'HH_MAX_FARMS', 500),              // stored farms; POST /api/farms answers 503 above it
    ttlDays: posInt(env, 'HH_FARM_TTL_DAYS', 7),             // a farm nobody connected to for this long is deleted
    sweepMs: posInt(env, 'HH_SWEEP_MS', 60 * 60_000),        // how often the retention sweep runs
    idleMs: posInt(env, 'HH_FARM_IDLE_MS', 10 * 60_000),     // a loaded farm with no socket this long is unloaded
    maxLoaded: posInt(env, 'HH_MAX_LOADED', 64),             // LRU cap on farms in memory (idle ones go first)
    createPerHour: posInt(env, 'HH_CREATE_PER_HOUR', 5),     // new farms per client address
    createPerDay: posInt(env, 'HH_CREATE_PER_DAY', 20),
    wsPerIp: posInt(env, 'HH_WS_PER_IP', 16),                // open sockets per client address, all farms together
    // reverse proxies in front of the server whose X-Forwarded-For entry is trusted (0 = use the socket address)
    trustProxy: posInt(env, 'HH_TRUST_PROXY', 1, { min: 0 }),
    backupHours: posInt(env, 'HH_BACKUP_HOURS', 3),          // per farm: newest backup of each of the last N hours
    backupDays: posInt(env, 'HH_BACKUP_DAYS', 3),            // ... and of each of the last N days
  };
}
