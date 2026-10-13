// The telemetry lane's API (docs/agent-notes/harness-contract.md §6, §7): each farmer's sharing choice, the sender and
// the receiver. server/harness/index.js (mods lane) builds HarnessCtx and calls createTelemetry(ctx):
//
//   consent(fk, pid)            -> { telemetry: true | false | null, at, sending, install }   sending: the server shares at all
//   setConsent(fk, pid, bool)   -> the same, after storing it; OFF also deletes that farmer's waiting events
//   record(fk, pid, input)      -> Promise<{ queued: boolean, reason?, id? }>  never throws; a no-op unless that farmer
//                                  said yes, HH_TELEMETRY is not 'off' and there is somewhere to send to
//   routes(router)              GET/POST /consent on the harness REST base (auth from HarnessCtx)
//   receiverRoutes(app, { reg?, limiters? })   POST /api/telemetry + its admin routes (multi mode or
//                                  HH_TELEMETRY_RECEIVE=1; a no-op otherwise)
//   sweep(now), stop(), onFarmDeleted(fk), flush() (tests)
//
// `record` input (agent runtime; anything else is ignored, see payload.js buildPayload):
//   { event: 'job.ready' | 'job.applied' | 'job.discarded' | 'job.failed' | 'mod.undone', job?, files?, diff?,
//     validation?, rounds?, lang?, provider?, model?, prompts?, outcome?: { state, afterMs } }
//
// `install`: a random 128-bit id, the only thing an event says about where it came from. Single mode: one per server
// (HD/install.json). Multi mode: one per farm (H(fk)/telemetry-install.json), so a farmer's deletion request on the
// hosted site names only their own farm's events and the id goes when the farm goes. It is made on the first "yes".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { CONTENT_HASH } from '../../shared/content/index.js';
import { RULES_VERSION } from '../../shared/rules/version.js';
import { ideasConfig } from '../ideas.js';
import { telemetryConfig } from './config.js';
import { readConsent, writeConsent } from './consent.js';
import { buildPayload } from './payload.js';
import { TelemetrySender } from './sender.js';
import { mountTelemetryReceiver } from './receiver.js';

const HEX128 = /^[0-9a-f]{32}$/;
const PID = /^p[1-9]$/;
const FARM_KEY = /^(?:local|[a-z2-7]{12})$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The install id in `file`, made (0600, its folder 0700) when `create` and there is none. */
function installIn(file, create, now) {
  const o = readJson(file);
  if (o && typeof o.id === 'string' && HEX128.test(o.id)) return o.id;
  if (!create) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const id = crypto.randomBytes(16).toString('hex');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ id, at: now })}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return id;
}

/** A thrown { status, error } from HarnessCtx.auth, as an HTTP answer. */
function authFailed(res, err) {
  const status = err && Number.isInteger(err.status) ? err.status : 401;
  return res.status(status).json({ error: err && typeof err.error === 'string' ? err.error : 'AUTH' });
}

export function createTelemetry(ctx) {
  const { cfg = {}, log, mode = 'single' } = ctx;
  const wall = typeof ctx.wall === 'function' ? ctx.wall : Date.now;
  let tc;
  try { tc = cfg.telemetry ?? telemetryConfig(process.env); } catch (err) {
    // a bad knob must not take the farm down: sharing stays off and the operator sees why
    log.error(`telemetry is off: ${err.message}`);
    tc = { enabled: false, url: null, urlExplicit: false, receive: false, perDay: 1 };
  }
  const hostDir = ctx.hostDir;
  let receiver = null;
  const sender = new TelemetrySender({
    hostDir, url: tc.url, log, wall, fetcher: ctx.fetcher ?? globalThis.fetch,
    // the official multi host stores its own farms' events directly, unless the operator named another address
    local: () => (receiver && !tc.urlExplicit ? receiver.ingest : null),
  }).load();
  sender.start();
  const game = { version: cfg.version || '0.0.0', contentHash: CONTENT_HASH, rules: RULES_VERSION, mode };

  const installFile = (fk) => (mode === 'multi' && fk !== 'local' ? path.join(ctx.dirOf(fk), 'telemetry-install.json')
    : path.join(hostDir, 'install.json'));
  const installOf = (fk, create = false) => installIn(installFile(fk), create, wall());
  const sending = () => tc.enabled && sender.canSend();

  function consent(fk, pid) {
    const c = FARM_KEY.test(String(fk)) ? readConsent(ctx.dirOf(fk), pid) : { telemetry: null, at: null };
    // `sending` = can this server share at all (the operator's switch and somewhere to send to); the farmer's own answer
    // is `telemetry`. The ui asks before the first request only while sending is true (lead, 2026-10-13: it was ANDed
    // with the answer, so a never-asked farmer read "nothing is sent" and the question never showed)
    return { telemetry: c.telemetry, at: c.at, sending: sending(), install: FARM_KEY.test(String(fk)) ? installOf(fk) : null };
  }

  async function setConsent(fk, pid, on) {
    if (!FARM_KEY.test(String(fk)) || !PID.test(String(pid))) throw new Error('telemetry: no such farmer');
    writeConsent(ctx.dirOf(fk), pid, on === true, wall());
    if (on === true) installOf(fk, true);
    else {
      const k = `${fk}:${pid}`;
      const n = await sender.forget((x) => x === k);
      if (n) log.info('a farmer turned sharing off: their waiting events were deleted', { dropped: n });
    }
    return consent(fk, pid);
  }

  async function record(fk, pid, input) {
    try {
      if (!tc.enabled) return { queued: false, reason: 'OFF' };
      if (!FARM_KEY.test(String(fk)) || !PID.test(String(pid))) return { queued: false, reason: 'BAD_ARGS' };
      if (readConsent(ctx.dirOf(fk), pid).telemetry !== true) return { queued: false, reason: 'NO_CONSENT' };
      if (!sender.canSend()) return { queued: false, reason: 'NOWHERE' };
      const install = installOf(fk, true);
      const p = buildPayload(input, { install, game, now: wall() });
      await sender.enqueue(`${fk}:${pid}`, p);
      sender.kick();
      return { queued: true, id: p.id };
    } catch (err) {
      // telemetry never breaks a job: the event is simply not shared
      log.warn('a shared helper event could not be queued', { err: String(err && err.message).slice(0, 120) });
      return { queued: false, reason: 'INTERNAL' };
    }
  }

  const who = async (req) => req.harness ?? await ctx.auth(req);

  function routes(router) {
    router.get('/consent', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      let id;
      try { id = await who(req); } catch (err) { return authFailed(res, err); }
      return res.json(consent(id.farmKey, id.pid));
    });
    router.post('/consent', express.json({ limit: '1kb' }), async (req, res) => {
      res.set('Cache-Control', 'no-store');
      let id;
      try { id = await who(req); } catch (err) { return authFailed(res, err); }
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'BAD_ARGS', field: 'body' });
      const extra = Object.keys(b).find((k) => k !== 'telemetry');
      if (extra) return res.status(400).json({ error: 'BAD_ARGS', field: extra });
      if (typeof b.telemetry !== 'boolean') return res.status(400).json({ error: 'BAD_ARGS', field: 'telemetry' });
      try {
        return res.json(await setConsent(id.farmKey, id.pid, b.telemetry));
      } catch (err) {
        log.error('saving a sharing choice failed', { err: String(err && err.code || err && err.message) });
        return res.status(500).json({ error: 'INTERNAL' });
      }
    });
    return router;
  }

  function receiverRoutes(app, { reg = ctx.reg ?? null, limiters = ctx.limiters ?? null } = {}) {
    if (receiver || !(mode === 'multi' || tc.receive)) return receiver;
    const ic = { ...ideasConfig(process.env), ...(cfg.ideas || {}) };
    receiver = mountTelemetryReceiver(app, {
      dataDir: cfg.dataDir, log, wall, perDay: tc.perDay, adminToken: ic.adminToken,
      trustProxy: cfg.multi?.trustProxy ?? 0, limiters, sweepers: reg?.sweepers ?? null,
    });
    log.info('telemetry: the receiver is on (POST /api/telemetry)');
    return receiver;
  }

  return {
    config: tc,
    consent,
    setConsent,
    record,
    routes,
    receiverRoutes,
    installOf: (fk) => installOf(fk),
    /** The retention: the receiver's 365 days (when mounted here) and the outbox's 7. */
    async sweep(now = wall()) {
      const dropped = await sender.prune(now);
      const r = receiver ? await receiver.sweep(now) : { telemetry: 0 };
      return { ...r, outbox: dropped };
    },
    flush: () => sender.flush(),
    async stop() {
      await sender.stop();
      if (receiver) await receiver.stop();
    },
    /** A deleted farm's waiting events go too (its consent and install files went with its folder). */
    onFarmDeleted: (fk) => sender.forget((k) => k.startsWith(`${fk}:`)),
    get receiver() { return receiver; },
    get sender() { return sender; },
  };
}
