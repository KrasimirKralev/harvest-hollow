// Harvest Hollow server: boot = config -> persist.load -> migrate/backfill -> replay -> catch-up of due system
// actions -> snapshot -> http + ws -> timers -> signals.
// `node server/index.js` runs it; tests import startServer() to run one in-process on a temp data dir.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig, ConfigError } from './config.js';
import { ServerClock } from './clock.js';
import { Persist } from './persist.js';
import { Engine } from './engine.js';
import { Sessions } from './sessions.js';
import { Presence } from './presence.js';
import { Together } from './together.js';
import { Scheduler } from './scheduler.js';
import { handleMessage } from './router.js';
import { createApp } from './http.js';
import { StaticFiles } from './static.js';
import { createLogger } from './log.js';
import { Perf } from './perf.js';
import { banner, lanAddresses } from './banner.js';
import { migrate, backfill, backfillStarter, CURRENT } from './migrations.js';
import { createFarm, validateState, DEFAULT_TZ } from '../shared/rules/state.js';
import { spawnAt } from '../shared/rules/grid.js';
import { CONTENT_HASH } from '../shared/content/index.js';
import { LIMITS, CLOSE, parseClientMessage } from '../shared/net/protocol.js';

/** Exit status for "the data needs a human" (sysexits EX_CONFIG): the systemd unit does not restart on it. */
export const EXIT_REFUSED = 78;

/** The boot was refused on purpose (data a human must look at); the message says what to do. */
export class BootRefused extends Error {}

/**
 * Load (or create) the farm and replay the journal. Exported for the persistence tests.
 *
 * - A missing farm.json with backups present recovers from the newest backup plus the journal archive (exact).
 * - Journal lines without any snapshot or backup to replay them on cannot be trusted onto a fresh farm (its seed
 *   and start differ), so the boot is refused.
 * - A journal line that does not replay (a content or rules change between a crash and the restart, a gap from an
 *   older backup, a migration bug) never silently drops the acknowledged lines after it (review-m0 H2, #10): the
 *   snapshot and every journal file are copied to incidents/<ts>-replay/ first, and the boot is REFUSED unless
 *   `replayAnyway` (HH_REPLAY_ANYWAY=1), which keeps the state at the last good line and discards the journals
 *   (their copy stays in incidents/) so the dropped lines can never replay on top of newer actions later.
 * - Saves from an older schema are copied to backups/farm.pre-migrate-v<N>.json, migrated, then backfilled with
 *   fields newer rules added (server/migrations.js).
 * - The farm's calendar zone: a new farm takes `tz`. An existing save keeps its own `meta.tz` unless `tzExplicit`
 *   (HH_TZ is set): moving the zone can move the farm day, so a machine-zone change (a laptop moved, a container
 *   with UTC) must never do it silently (SV-04).
 * - `togetherPaidMin`: the together minutes the replayed lines handed out (Together restores the rest, SV-07).
 */
export function loadFarm(persist, { dev = false, log = console, tz = DEFAULT_TZ, tzExplicit = true, replayAnyway = false } = {}) {
  const { snapshot, lines, warnings, source } = persist.load();
  for (const w of warnings) log.warn(`persist: ${w}`);
  if (!snapshot && lines.length) {
    const dest = persist.quarantine('no-snapshot', { error: 'journal lines without a snapshot or backup', lines: lines.length,
      firstV: lines[0].v, lastV: lines.at(-1).v });
    if (!replayAnyway) {
      throw new BootRefused(`the data dir has ${lines.length} journal line(s) (v${lines[0].v}..v${lines.at(-1).v}) but no farm.json `
        + `and no backup to replay them on; copied to ${dest}. Restore farm.json (or a backups/ file), or set HH_REPLAY_ANYWAY=1 to `
        + 'start a NEW farm.');
    }
    log.error(`persist: starting a new farm; the ${lines.length} orphan journal line(s) are kept in ${dest}`);
    persist.discardJournals();
    lines.length = 0;
  }
  let state;
  let server;
  const wallNow = Date.now();
  // A save from before the farm had a zone (schema 1) takes this machine's (or HH_TZ's) zone once, below.
  const savedTz = snapshot && snapshot.state && snapshot.state.meta && typeof snapshot.state.meta.tz === 'string' ? snapshot.state.meta.tz : null;
  if (snapshot) {
    if (Number.isSafeInteger(snapshot.state.schema) && snapshot.state.schema < CURRENT) {
      const f = persist.preMigrate(snapshot);
      log.warn(`migrating the save from schema ${snapshot.state.schema} to ${CURRENT} (copy kept in ${f})`);
    }
    try {
      state = migrate(snapshot.state, { log });
    } catch (err) {
      throw new BootRefused(`cannot load the save: ${err.message}`);
    }
    server = snapshot.server || {};
  } else {
    state = createFarm(crypto.randomInt(0, 2 ** 32), wallNow, tz);
    log.info('a new farm was created');
  }
  server = { clock: { lastNow: 0, devOffset: 0 }, clients: {}, auth: {}, ...server };
  const clock = new ServerClock(server.clock, { dev, log });
  if (snapshot) {
    const filled = backfill(state, { now: clock.now(), tz });
    if (filled.length) log.warn(`backfilled ${filled.length} field(s) a newer build added: ${filled.join(', ')}`);
  }
  const engine = new Engine({ state, server, clock, dev, log });
  const foreign = lines.filter((l) => l.h !== undefined && l.h !== CONTENT_HASH).length;
  if (foreign) log.warn(`persist: ${foreign} journal line(s) were accepted under other content/rules (hash != ${CONTENT_HASH}); replaying them with the current code`);
  let replayed = 0;
  let togetherPaidMin = 0;
  for (const line of lines) {
    try {
      engine.replay(line);
      replayed++;
      const min = line.ext && line.ext.togetherMin;
      if (Number.isSafeInteger(min) && min > 0) togetherPaidMin += min;
    } catch (err) {
      const remaining = lines.length - replayed;
      const dest = persist.quarantine('replay', { error: err.message, line, at: engine.v, replayed, remaining,
        contentHash: CONTENT_HASH, lineHash: line.h ?? null, source });
      log.error(`persist: replay stopped at v${engine.v}: ${err.message}; ${remaining} line(s) not applied; journals copied to ${dest}`);
      if (!replayAnyway) {
        throw new BootRefused(`journal replay stopped at v${engine.v} with ${remaining} acknowledged action(s) left; `
          + `the save and journals are copied to ${dest}. Start the previous build once (it replays and saves), `
          + 'or set HH_REPLAY_ANYWAY=1 to continue without the remaining lines.');
      }
      persist.discardJournals();
      break;
    }
  }
  if (replayed === lines.length) persist.adoptInherited();
  if (snapshot) {
    // an M0 save gets the wave-1 starter farm once (after the replay: the journal was accepted on the old layout)
    const added = backfillStarter(state, { now: clock.now() });
    if (added.length) log.warn(`added ${added.length} starter object(s) an older save lacked`);
  }
  // Boot-time only, before any client sees the state: the content hash follows this build; the zone follows HH_TZ
  // only when it is set (a save without a valid zone takes `tz`).
  state.meta.contentHash = CONTENT_HASH;
  if (state.meta.tz !== tz) {
    if (!snapshot || !savedTz) {
      state.meta.tz = tz;
    } else if (tzExplicit) {
      log.warn(`FARM TIME ZONE CHANGED: ${state.meta.tz} -> ${tz} (HH_TZ). The farm day follows the new zone from now `
        + 'on; a day that would move backwards waits until the new zone catches up.');
      state.meta.tz = tz;
    } else {
      log.info(`farm time zone ${state.meta.tz} (kept from the save; this machine is ${tz}; set HH_TZ to change it)`);
    }
  }
  const problems = validateState(state, { now: clock.now() });
  if (problems.length) {
    log.error(`loaded state has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    persist.incident('invalid-state.json', { problems });
  }
  return { state, server, clock, engine, replayed, source, togetherPaidMin };
}

/**
 * Start a full server. Resolves once listening.
 * @param {ReturnType<typeof loadConfig>} [cfg]
 * @returns {Promise<{ port: number, hh: object, close: () => Promise<void>, banner: string }>}
 */
export async function startServer(cfg = loadConfig()) {
  const log = cfg.log || createLogger({ quiet: cfg.quiet, json: cfg.logJson });
  const persist = new Persist(cfg.dataDir, { log });
  const { engine, clock, replayed, server: sidecar, togetherPaidMin } = loadFarm(persist, { dev: cfg.dev, log, tz: cfg.tz,
    tzExplicit: cfg.tzExplicit !== false, replayAnyway: cfg.replayAnyway });
  engine.journal = persist;
  engine.incident = (name, data) => persist.incident(name, data);
  persist.openJournal();
  const hh = { cfg, log, persist, engine, clock, parse: parseClientMessage, startedAt: Date.now(), perf: new Perf() };
  hh.static = new StaticFiles({ root: cfg.root, log });          // BUILD_HASH: the game files this server serves
  // a farmer appears on the farmhouse porch wherever the couple moved the farmhouse (owner rule 2026-10-04)
  hh.presence = new Presence(clock, (msg) => hh.sessions.presenceOut(msg), { spawnOf: (pid) => spawnAt(engine.state, pid) });
  // Together time not paid before the last snapshot, minus what the replayed lines paid since (SV-07).
  const saved = sidecar.live && sidecar.live.together;
  const savedAcc = saved && Number.isSafeInteger(saved.acc) ? saved.acc : 0;
  hh.together = new Together({ online: () => hh.sessions.onlinePids(), poses: () => hh.presence.p,
    acc: Math.max(0, savedAcc - togetherPaidMin * 60_000) });
  hh.sessions = new Sessions({ engine, clock, presence: hh.presence, together: hh.together, cfg, log, save: () => hh.scheduler.save(),
    build: hh.static.build, perf: hh.perf });
  hh.scheduler = new Scheduler({ engine, persist, clock, cfg, log, perf: hh.perf,
    live: () => ({ online: hh.sessions.onlinePids().sort(), together: hh.together.snapshot(clock.now()) }) });
  engine.facts = hh.together;
  engine.onDelta = (d) => hh.sessions.broadcast(d);
  engine.onCommit = () => hh.scheduler.requestArm();
  if (replayed) log.info(`replayed ${replayed} journal line(s); farm at v${engine.v}`);
  // Nobody is connected yet: whoever the save still has seated or "here" (a crash) leaves first (SV-01).
  const away = hh.sessions.awayAtBoot();
  if (away) log.info(`${away} player(s) marked as away after the restart`);
  hh.scheduler.start();                          // catch-up: everything that came due while the server was off
  await hh.scheduler.save();                     // the journal starts empty after a replay

  const app = createApp(hh);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.MAX_PAYLOAD, perMessageDeflate: false,
    // Same-origin only: a page from another origin must not drive the farm (tech §7 rule 8).
    verifyClient: ({ req }) => {
      const origin = req.headers.origin;
      if (!origin) return true;                  // non-browser clients (tests, tools)
      try { return new URL(origin).host === req.headers.host; } catch { return false; }
    } });
  // The ws server re-emits the http server's errors; a listen error (EADDRINUSE) is handled below, and must not
  // become an unhandled 'error' event that kills the process before the clean "failed to start" message.
  wss.on('error', () => {});
  wss.on('connection', (ws, req) => {
    const conn = hh.sessions.open(ws, req.socket.remoteAddress);
    if (!conn) return;
    ws.on('pong', () => { conn.missed = 0; });
    ws.on('message', (raw) => handleMessage(hh, conn, raw));
    ws.on('close', () => hh.sessions.close(conn));
    ws.on('error', () => {});
  });
  hh.presence.start();
  hh.sessions.startHeartbeat();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(cfg.port, cfg.host, resolve);
    });
  } catch (err) {
    hh.scheduler.stop();
    hh.presence.stop();
    hh.sessions.stop();
    hh.perf.stop();
    persist.close();
    throw err;
  }
  const port = server.address().port;

  let closing = null;
  const close = () => {
    closing ??= (async () => {
      hh.scheduler.stop();
      hh.presence.stop();
      hh.sessions.stop();
      // Close sessions synchronously so their `_seen` lines land before the final snapshot.
      for (const c of [...hh.sessions.conns]) {
        hh.sessions.close(c);
        try { c.ws.close(CLOSE.SHUTDOWN, 'server stopping'); } catch { /* gone */ }
        c.ws.terminate();
      }
      wss.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
      await hh.scheduler.save();
      persist.close();
      hh.perf.stop();
    })();
    return closing;
  };
  const text = banner({ port, dev: cfg.dev, color: Boolean(process.stdout.isTTY), addresses: lanAddresses(),
    dataDir: cfg.dataDir, tz: cfg.tz, version: cfg.version });
  return { port, hh, close, banner: text };
}

async function main() {
  let cfg;
  let s;
  try {
    cfg = loadConfig();
    s = await startServer(cfg);
  } catch (err) {
    console.error(`\x1b[31mHarvest Hollow failed to start: ${err.message}\x1b[0m`);
    process.exit(err instanceof BootRefused || err instanceof ConfigError ? EXIT_REFUSED : 1);
  }
  // A bug that escapes every handler: log it structured and exit non-zero, so systemd restarts a clean process
  // (the journal makes the restart lossless) instead of running on in an unknown state.
  process.on('uncaughtException', (err) => { s.hh.log.error('uncaught exception; exiting for a clean restart', err); process.exit(1); });
  process.on('unhandledRejection', (err) => { s.hh.log.error('unhandled rejection; exiting for a clean restart', err); process.exit(1); });
  let stopping = false;
  const stop = async (sig) => {
    if (stopping) { console.error('forced exit'); process.exit(1); }
    stopping = true;
    s.hh.log.info(`${sig}: saving and shutting down`);
    try { await s.close(); } catch (err) { s.hh.log.error('shutdown save failed', err); process.exit(1); }
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  // the banner last: a stop right after it (a test waits for it) always finds the shutdown save installed (PT-06)
  console.log(`\n${s.banner}\n`);
}

/**
 * True when this file is the process's entry script. Compared by real path: the live service runs it through the
 * ~/harvest-hollow-live symlink (tools/deploy-live.sh), and a plain string compare made `node <symlink>/server/index.js`
 * without --preserve-symlinks-main exit 0 without starting (a false success systemd does not restart).
 */
export function isEntry(argv1 = process.argv[1], self = fileURLToPath(import.meta.url)) {
  if (!argv1) return false;
  if (argv1 === self) return true;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(self);
  } catch {
    return false;
  }
}

if (isEntry()) main();
