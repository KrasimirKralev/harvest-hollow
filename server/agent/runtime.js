// The agent job runtime (harness contract §4.2-§4.5, §5.1): one job per farm, the rounds (agent run -> full
// validation -> up to 2 automatic fix rounds), the job folder, progress events (throttled `hx` pushes), apply /
// discard / revise / cancel, restart recovery, retention, rate limits and the telemetry hook.
//
// Job states: starting -> working -> validating -> ready -> applying -> applied; validating -> fixing -> working;
// ready -> revising -> working; ready -> discarded | expired (24 h); any active -> cancelled; any -> failed.
// A restart turns every active job into `failed RESTARTED`; a `ready` job survives (its candidate is on disk).
// Who may act: apply and "ask for changes" only the farmer who asked; discard and cancel any seated farmer of the farm
// (a job must never lock a farm because its owner went away).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, readJson, writeJson, randomHex, sameSecret } from './fsutil.js';
import { buildWorkspace, readSummary } from './workspace.js';
import { createTools, readModFiles, precheckResult } from './tools.js';
import { treeHashes, changedOutside } from './sandbox.js';
import { ACTIVE, OPEN, READY_TTL_MS, JOB_FILES_KEEP_MS, JOB_RECORD_KEEP_MS, publicJob } from './jobs.js';
import { levelFromXp } from '../../shared/content/index.js';

export { ACTIVE, OPEN, READY_TTL_MS, publicJob };
export const FIX_ROUNDS = 2;
const PROMPT_MAX = 1000;
const MAX_ROUNDS = 6;               // the first request + 5 "ask for changes"
const PROGRESS_MAX = 20;
const JOB_ID = /^[0-9a-f]{16}$/;

/** Short plain-text notes of the progress list (`code` is the stable key the UI translates: harness.note.<code>). */
export const NOTES = Object.freeze({
  wait: 'waiting for a free helper', request: 'reading the request', guide: 'reading the guide', catalog: 'looking things up',
  read: 'reading a file', write: 'writing the mod', summary: 'writing the summary', validate: 'running the checks',
  preview: 'checking the preview', full: 'testing on a copy of the farm', fix: 'fixing what the checks found',
  stage: 'getting the changes ready', ready: 'ready to look at', applying: 'applying the changes', applied: 'applied',
});

export class HttpError extends Error {
  constructor(status, error, extra = {}) { super(error); this.status = status; this.body = { error, ...extra }; }
}

const chars = (s) => [...String(s)].length;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').trim();

/**
 * @param {{ ctx: object, cfg: object, providers: Record<string, object>, log: object, now?: () => number,
 *   pushMs?: number, port?: () => number }} o
 */
export class Runtime {
  constructor({ ctx, cfg, providers, log, now = Date.now, pushMs = 250, port = () => 0 }) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.providers = providers;
    this.log = log;
    this.now = now;
    this.pushMs = pushMs;
    this.port = port;
    this.farms = new Map();          // farmKey -> { ready: Promise, current, starts: [{ at, by }] }
    this.live = new Map();           // jobId -> live run
    this.saving = new Map();         // jobId -> Promise (job.json writes in order)
    this.pushes = new Map();         // farmKey -> { timer, job }
    this.running = 0;
    this.waiters = [];
    this.stopped = false;
    this.sweeper = setInterval(() => this.sweep().catch(() => {}), 10 * 60_000);
    this.sweeper.unref();
  }

  jobsDir(fk) { return path.join(this.ctx.dirOf(fk), 'jobs'); }
  jobDir(fk, id) { return path.join(this.jobsDir(fk), id); }
  userOf(fk, pid) { return { farmKey: fk, pid, dir: path.join(this.ctx.dirOf(fk), 'users', pid) }; }

  // ---------------------------------------------------------------- loading, persistence, pushes

  farm(fk) {
    let f = this.farms.get(fk);
    if (!f) {
      f = { current: null, claim: null, starts: [], ready: null };   // claim: a start between its checks and its job
      f.ready = this.load(fk, f);
      this.farms.set(fk, f);
    }
    return f.ready.then(() => f);
  }

  async load(fk, f) {
    let ids = [];
    try { ids = (await fsp.readdir(this.jobsDir(fk))).filter((n) => JOB_ID.test(n)); } catch { ids = []; }
    const jobs = [];
    for (const id of ids) {
      const dir = this.jobDir(fk, id);
      const job = await readJson(path.join(dir, 'job.json'));
      if (!job || job.id !== id) continue;
      const age = this.now() - (job.updatedAt || 0);
      if (age > JOB_RECORD_KEEP_MS) { await fsp.rm(dir, { recursive: true, force: true }); continue; }
      if (ACTIVE.includes(job.state)) {
        // the process that ran it is gone: say so honestly (a ready job keeps its candidate)
        Object.assign(job, { state: 'failed', error: { code: 'RESTARTED', detail: null }, updatedAt: this.now() });
        await this.save(fk, job);
      }
      if (age > JOB_FILES_KEEP_MS && !OPEN.includes(job.state)) {
        await fsp.rm(path.join(dir, 'work'), { recursive: true, force: true });
        await fsp.rm(path.join(dir, 'private'), { recursive: true, force: true });
      }
      jobs.push(job);
      f.starts.push({ at: job.startedAt, by: job.by });
    }
    jobs.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    f.current = jobs.length ? jobs[jobs.length - 1] : null;
    if (f.current) this.expireIfOld(fk, f.current);
  }

  save(fk, job) {
    const file = path.join(this.jobDir(fk, job.id), 'job.json');
    const prev = this.saving.get(job.id) || Promise.resolve();
    const next = prev.then(() => writeJson(file, job)).catch((err) => this.log.error('agent: job.json not saved', { job: job.id }, err));
    this.saving.set(job.id, next);
    next.then(() => { if (this.saving.get(job.id) === next) this.saving.delete(job.id); });
    return next;
  }

  /** `hx job` to the whole farm, at most every pushMs (the last state wins). */
  pushJob(fk, job) {
    const p = this.pushes.get(fk);
    if (p) { p.job = job; return; }
    const send = () => {
      const cur = this.pushes.get(fk);
      this.pushes.delete(fk);
      try { this.ctx.push(fk, { t: 'hx', e: 'job', job: publicJob(cur ? cur.job : job) }); } catch (err) {
        this.log.warn('agent: push failed', { err: err && err.message });
      }
    };
    const entry = { job, timer: null };
    this.pushes.set(fk, entry);
    entry.timer = setTimeout(send, this.pushMs);
    entry.timer.unref?.();
  }

  async touch(fk, job, patch = {}) {
    Object.assign(job, patch, { updatedAt: this.now() });
    await this.save(fk, job);
    this.pushJob(fk, job);
  }

  note(fk, job, step, code) {
    const last = job.progress[job.progress.length - 1];
    job.step = step;
    if (!last || last.step !== step || last.code !== code) {
      job.progress = [...job.progress, { at: this.now(), step, note: NOTES[code] || code, code }].slice(-PROGRESS_MAX);
    }
    job.updatedAt = this.now();
    this.pushJob(fk, job);
  }

  expireIfOld(fk, job) {
    if (job && job.state === 'ready' && this.now() - job.updatedAt > READY_TTL_MS) {
      Object.assign(job, { state: 'expired', updatedAt: this.now() });
      this.save(fk, job);
      this.record(fk, job, 'job.discarded');
      return true;
    }
    return false;
  }

  async sweep() {
    for (const [fk, f] of this.farms) {
      await f.ready;
      if (this.expireIfOld(fk, f.current)) this.pushJob(fk, f.current);
    }
  }

  // ---------------------------------------------------------------- reading

  async current(fk) {
    const f = await this.farm(fk);
    this.expireIfOld(fk, f.current);
    return f.current;
  }

  async limits(fk, pid) {
    return this.limitsOf(await this.farm(fk), pid);
  }

  /** The limits of a loaded farm, synchronously (start() checks and claims in one step with it). */
  limitsOf(f, pid) {
    const t = this.now();
    return { prompt: PROMPT_MAX, jobsPerHour: this.cfg.jobsPerHour, jobsPerDay: this.cfg.jobsPerDay,
      usedHour: f.starts.filter((s) => s.by === pid && t - s.at < 3_600_000).length,
      usedDay: f.starts.filter((s) => t - s.at < 86_400_000).length, fixRounds: FIX_ROUNDS, rounds: MAX_ROUNDS };
  }

  async providerList(fk, pid) {
    const user = this.userOf(fk, pid);
    const out = [];
    for (const p of Object.values(this.providers)) {
      let av;
      try { av = await p.available(); } catch { av = { ok: false, reason: 'OFF' }; }
      const row = { id: p.id, available: av.ok, ...(av.ok ? {} : { reason: av.reason }), signedIn: false };
      if (av.ok) {
        try {
          const st = await p.signIn.status(user);
          row.signedIn = st.state === 'signed_in';
          row.signIn = st;
          if (st.account) row.account = st.account;
        } catch { row.signIn = { provider: p.id, state: 'error', error: { code: 'INTERNAL' } }; }
      }
      out.push(row);
    }
    return out;
  }

  /** What GET .../state needs from this lane. */
  async state(fk, pid) {
    if (!this.cfg.enabled) return { enabled: false };
    return { enabled: true, providers: await this.providerList(fk, pid), job: publicJob(await this.current(fk)),
      limits: await this.limits(fk, pid) };
  }

  // ---------------------------------------------------------------- starting a job

  async start(fk, pid, body = {}) {
    if (!this.cfg.enabled || this.stopped) throw new HttpError(503, 'UNAVAILABLE');
    const prompt = typeof body.prompt === 'string' ? clean(body.prompt) : '';
    if (!prompt || chars(prompt) > PROMPT_MAX) throw new HttpError(400, 'BAD_ARGS', { field: 'prompt' });
    const provider = Object.prototype.hasOwnProperty.call(this.providers, body.provider) ? this.providers[body.provider] : null;
    if (!provider) throw new HttpError(400, 'BAD_ARGS', { field: 'provider' });
    if (body.model !== undefined && body.model !== null && (typeof body.model !== 'string' || !/^[\w.:/-]{1,64}$/.test(body.model))) {
      throw new HttpError(400, 'BAD_ARGS', { field: 'model' });
    }
    const lang = body.lang === undefined ? 'en' : body.lang;
    if (lang !== 'en' && lang !== 'bg') throw new HttpError(400, 'BAD_ARGS', { field: 'lang' });
    const f = await this.farm(fk);
    // From here to the claim nothing waits: the BUSY check, the rate count and taking the farm's one slot are a single
    // synchronous step, so two farmers (or two tabs) pressing Ask together can never both pass (verifier, defect 1).
    this.expireIfOld(fk, f.current);
    if (f.claim) throw new HttpError(409, 'BUSY', { job: publicJob(f.claim) });
    if (f.current && OPEN.includes(f.current.state)) throw new HttpError(409, 'BUSY', { job: publicJob(f.current) });
    const lim = this.limitsOf(f, pid);
    if (lim.usedHour >= this.cfg.jobsPerHour || lim.usedDay >= this.cfg.jobsPerDay) {
      const t = this.now();
      const mine = f.starts.filter((s) => (lim.usedDay >= this.cfg.jobsPerDay ? t - s.at < 86_400_000 : s.by === pid && t - s.at < 3_600_000));
      const oldest = Math.min(...mine.map((s) => s.at));
      const windowMs = lim.usedDay >= this.cfg.jobsPerDay ? 86_400_000 : 3_600_000;
      throw new HttpError(429, 'RATE', { retryAfter: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)) });
    }
    const t = this.now();
    const id = randomHex(8);
    const job = { id, by: pid, provider: provider.id, model: body.model || null, state: 'starting', step: 'reading', round: 1,
      startedAt: t, updatedAt: t, lang, prompts: [{ at: t, text: prompt }], progress: [], result: null, error: null,
      priv: { farmKey: fk, parent: 0, fixes: 0, seeded: false, rounds: [] } };
    const slot = { at: t, by: pid };
    f.claim = job;
    f.starts.push(slot);
    try {
      const av = await provider.available();
      if (!av.ok) throw new HttpError(503, 'UNAVAILABLE', { reason: av.reason });
      const st = await provider.signIn.status(this.userOf(fk, pid));
      if (st.state !== 'signed_in') throw new HttpError(428, 'SIGN_IN', { provider: provider.id });
      try { const a = await this.ctx.mods.active(fk); job.priv.parent = a && Number.isInteger(a.n) ? a.n : 0; } catch { job.priv.parent = 0; }
      // the server stopped or the farm was deleted while we waited: nothing may start on it now
      if (this.stopped || this.farms.get(fk) !== f) throw new HttpError(503, 'UNAVAILABLE');
      await ensureDir(path.join(this.jobDir(fk, id), 'work'));
      await ensureDir(path.join(this.jobDir(fk, id), 'private'));
      if (this.stopped || this.farms.get(fk) !== f) {
        await fsp.rm(this.jobDir(fk, id), { recursive: true, force: true });
        throw new HttpError(503, 'UNAVAILABLE');
      }
    } catch (err) {
      // a refused start holds nothing: the slot and the rate count are free again
      const i = f.starts.indexOf(slot);
      if (i >= 0) f.starts.splice(i, 1);
      throw err;
    } finally {
      if (f.claim === job) f.claim = null;
    }
    f.current = job;
    await this.save(fk, job);
    this.pushJob(fk, job);
    this.drive(fk, job);
    return publicJob(job);
  }

  // ---------------------------------------------------------------- the rounds

  async acquire(fk, job, live) {
    if (this.running < this.cfg.maxRuns) { this.running++; return true; }
    this.note(fk, job, job.step, 'wait');
    return new Promise((resolve) => {
      const w = { live, go: () => { this.running++; resolve(true); }, drop: () => resolve(false) };
      live.dropWait = () => { this.waiters = this.waiters.filter((x) => x !== w); w.drop(); };
      this.waiters.push(w);
    });
  }

  release() {
    this.running--;
    const w = this.waiters.shift();
    if (w) w.go();
  }

  drive(fk, job) {
    const live = { fk, job, abort: new AbortController(), token: randomHex(32), tools: null, cancelled: false, round: null };
    this.live.set(job.id, live);
    const done = this.rounds(fk, job, live).catch(async (err) => {
      this.log.error('agent: job failed unexpectedly', { job: job.id }, err);
      if (!live.cancelled) await this.fail(fk, job, 'INTERNAL');
    }).finally(() => {
      if (this.live.get(job.id) === live) this.live.delete(job.id);
    });
    live.done = done;
    return done;
  }

  async rounds(fk, job, live) {
    const got = await this.acquire(fk, job, live);
    if (!got || live.cancelled) return;
    try {
      const provider = this.providers[job.provider];
      const user = this.userOf(fk, job.by);
      const dir = this.jobDir(fk, job.id);
      const work = path.join(dir, 'work');
      const priv = path.join(dir, 'private');
      for (;;) {
        if (live.cancelled || this.stopped) return;
        const fixing = job.priv.fixes > 0;
        await this.touch(fk, job, { state: 'working', step: fixing ? 'fixing' : 'reading' });
        this.note(fk, job, fixing ? 'fixing' : 'reading', fixing ? 'fix' : 'request');
        let catalog = null;
        try { catalog = await this.ctx.mods.catalog(fk); } catch (err) { this.log.warn('agent: no catalog', { err: err && err.message }); }
        let modFiles = null;
        if (!job.priv.seeded) {
          try { modFiles = await this.ctx.mods.files(fk); } catch { modFiles = null; }
        }
        await buildWorkspace({ workDir: work, prompts: job.prompts, lang: job.lang, errors: fixing ? job.priv.lastErrors || [] : [],
          catalog, modFiles, seed: !job.priv.seeded, level: await this.levelOf(fk) });
        job.priv.seeded = true;
        const before = await treeHashes(work);
        const tools = createTools({ workDir: work,
          validate: (files) => this.ctx.mods.validate(fk, files, { full: false, parent: job.priv.parent }),
          preview: (files) => this.ctx.mods.preview(fk, files),
          onEvent: (ev) => this.onAgentEvent(fk, job, live, ev) });
        live.tools = tools;
        const t0 = this.now();
        const end = await this.runRound(provider, job, live, { user, cwd: work, privateDir: priv, tools });
        live.tools = null;
        job.priv.rounds = [...job.priv.rounds, { at: t0, ms: this.now() - t0, code: end.code || 'OK', turns: end.turns || 0 }].slice(-20);
        if (live.cancelled) return;
        const outside = changedOutside(before, await treeHashes(work));
        if (outside.length) {
          this.log.warn('agent: the round changed files outside mod/', { job: job.id, n: outside.length });
          return this.fail(fk, job, 'SANDBOX');
        }
        if (!end.ok) {
          if (end.code === 'SIGN_IN') this.pushSignIn(fk, job.by, job.provider, { provider: job.provider, state: 'signed_out' });
          return this.fail(fk, job, end.code || 'PROVIDER', end.detail);
        }
        await this.touch(fk, job, { state: 'validating', step: 'testing' });
        this.note(fk, job, 'testing', 'full');
        const { files, problems } = await readModFiles(work);
        const v0 = this.now();
        const v = problems.length ? precheckResult(problems, { full: true })
          : await this.ctx.mods.validate(fk, files, { full: true, parent: job.priv.parent });
        job.priv.validationMs = this.now() - v0;
        if (live.cancelled) return;
        let verdict = v;
        if (v && v.ok === true && v.full === true) {
          this.note(fk, job, 'testing', 'stage');
          const summary = await readSummary(work) || titleSummary(files);
          let staged = null;
          try {
            staged = await this.ctx.mods.stage(fk, files, { parent: job.priv.parent, jobId: job.id, by: job.by,
              prompt: job.prompts[job.prompts.length - 1].text, prompts: job.prompts.map((p) => p.text), summary,
              title: files['mod.json'] && files['mod.json'].title, report: v });
          } catch (err) {
            // the farm moved between the check and the staging (a partner's undo): the re-check's errors go to a fix round
            if (!err || err.code !== 'INVALID') throw err;
            verdict = err.validation || { ok: false, stage: 'semantic', full: true, errors: [] };
          }
          if (staged) {
            let changes = Array.isArray(staged.changes) ? staged.changes : null;
            if (!changes) {
              try { const pv = await this.ctx.mods.preview(fk, files); changes = Array.isArray(pv && pv.changes) ? pv.changes : []; } catch { changes = []; }
            }
            if (live.cancelled) return;
            job.result = { candidate: staged.candidate, parent: job.priv.parent, summary, changes, validation: staged.validation || v };
            job.error = null;
            this.note(fk, job, 'ready', 'ready');
            await this.touch(fk, job, { state: 'ready', step: 'ready' });
            this.record(fk, job, 'job.ready', files);
            return;
          }
        }
        if (job.priv.fixes < FIX_ROUNDS) {
          job.priv.fixes++;
          job.priv.lastErrors = Array.isArray(verdict && verdict.errors) ? verdict.errors.slice(0, 40) : [];
          await this.touch(fk, job, { state: 'fixing', step: 'fixing' });
          this.note(fk, job, 'fixing', 'fix');
          continue;
        }
        job.result = { candidate: null, parent: job.priv.parent, summary: null, changes: [], validation: verdict };
        await this.fail(fk, job, 'INVALID', null, files);
        return;
      }
    } finally {
      this.release();
    }
  }

  /** One agent run with the wall and idle timeouts; resolves with the provider's RunEnd (or TIMEOUT). */
  async runRound(provider, job, live, { user, cwd, privateDir, tools }) {
    const round = new AbortController();
    live.round = round;
    let timedOut = false;
    let lastEvent = Date.now();
    live.bump = () => { lastEvent = Date.now(); };
    const stopFor = () => {
      timedOut = true;
      round.abort();
      try { provider.cancel(job.id); } catch { /* gone */ }
    };
    const wall = setTimeout(stopFor, this.cfg.timeoutMs);
    const idle = setInterval(() => { if (Date.now() - lastEvent > this.cfg.idleMs) stopFor(); }, Math.max(50, Math.min(5000, this.cfg.idleMs / 4)));
    const onCancel = () => round.abort();
    live.abort.signal.addEventListener('abort', onCancel, { once: true });
    const io = { user, cwd, privateDir, tools, signal: round.signal, limits: { turns: 40 },
      bridge: { url: `http://127.0.0.1:${this.port()}/internal/agent/${job.id}`, token: live.token },
      emit: (ev) => this.onAgentEvent(this.fkOf(job), job, live, ev) };
    try {
      const run = Promise.resolve().then(() => provider.run(job, io)).catch((err) => {
        this.log.error('agent: provider run threw', { job: job.id, provider: provider.id }, err);
        return { ok: false, code: 'PROVIDER', turns: 0 };
      });
      // once aborted, a provider gets 10 s to wind down before the round is ended without it
      const late = new Promise((resolve) => round.signal.addEventListener('abort',
        () => setTimeout(() => resolve({ ok: false, code: 'TIMEOUT', turns: 0 }), 10_000).unref(), { once: true }));
      const end = await Promise.race([run, late]);
      if (timedOut) return { ok: false, code: 'TIMEOUT', turns: end.turns || 0 };
      return end || { ok: false, code: 'PROVIDER', turns: 0 };
    } finally {
      clearTimeout(wall);
      clearInterval(idle);
      live.abort.signal.removeEventListener('abort', onCancel);
      live.bump = null;
    }
  }

  fkOf(job) { return job.priv.farmKey; }

  /** The farm's level for request.md ("above the farm level means coming later"); null when the farm cannot say. */
  async levelOf(fk) {
    try {
      if (typeof this.ctx.host !== 'function') return null;
      const host = await this.ctx.host(fk);
      const snap = host ? await host.call('snapshot') : null;
      const xp = snap && snap.farm && snap.farm.xp;
      return Number.isFinite(xp) ? levelFromXp(xp) : null;
    } catch {
      return null;
    }
  }

  onAgentEvent(fk, job, live, ev) {
    if (!ev || live.cancelled) return;
    if (live.bump) live.bump();
    const fixing = job.priv.fixes > 0;
    const as = (step) => (fixing && (step === 'reading' || step === 'building') ? 'fixing' : step);
    if (ev.type === 'step' && ['reading', 'building', 'testing'].includes(ev.step)) return this.note(fk, job, as(ev.step), ev.step === 'reading' ? 'read' : ev.step === 'building' ? 'write' : 'validate');
    if (ev.type !== 'tool') return undefined;
    const p = typeof ev.path === 'string' ? ev.path : '';
    switch (ev.name) {
      case 'read_file':
        return this.note(fk, job, as('reading'), p === 'request.md' ? 'request' : p === 'docs/mod-guide.md' ? 'guide' : p.startsWith('docs/catalog') ? 'catalog' : 'read');
      case 'list_files': return this.note(fk, job, as('reading'), 'catalog');
      case 'write_file':
      case 'edit_file': return this.note(fk, job, as('building'), p === 'summary.json' ? 'summary' : 'write');
      case 'validate': return this.note(fk, job, 'testing', 'validate');
      case 'preview': return this.note(fk, job, 'testing', 'preview');
      default: return undefined;
    }
  }

  async fail(fk, job, code, detail = null, files = null) {
    if (!OPEN.includes(job.state) && job.state !== 'starting') return;
    await this.touch(fk, job, { state: 'failed', error: { code, detail: detail ? String(detail).slice(0, 80) : null } });
    this.record(fk, job, 'job.failed', files);
  }

  pushSignIn(fk, pid, provider, state) {
    try { this.ctx.push(fk, { t: 'hx', e: 'signin', provider, state: state.state, signIn: state }, { pid }); } catch { /* best effort */ }
  }

  /**
   * Telemetry (contract §6; server/telemetry/payload.js buildPayload reads this input): the public job, the mod files
   * and the outcome. The telemetry lane decides whether anything leaves (the farmer's consent) and what exactly.
   * Fire and forget: a job never waits for it, and a failure there never changes the job.
   */
  record(fk, job, event, files = null) {
    const tel = this.ctx.telemetry;
    if (!tel || typeof tel.record !== 'function') return undefined;
    const snapshot = publicJob(JSON.parse(JSON.stringify(job)));
    const rounds = job.round + (job.priv ? job.priv.fixes : 0);
    return (async () => {
      let mod = files;
      if (!mod) mod = (await readModFiles(path.join(this.jobDir(fk, job.id), 'work'))).files;
      await tel.record(fk, job.by, { event, job: snapshot, files: mod || {}, rounds,
        outcome: { state: job.state, afterMs: Math.max(0, this.now() - job.startedAt) } });
    })().catch((err) => this.log.warn('agent: telemetry record failed', { event, err: err && err.message }));
  }

  // ---------------------------------------------------------------- player actions on a job

  async jobFor(fk, jobId) {
    const job = await this.current(fk);
    if (!job || job.id !== jobId) throw new HttpError(404, 'NOT_FOUND');
    return job;
  }

  async revise(fk, pid, jobId, body = {}) {
    const job = await this.jobFor(fk, jobId);
    if (job.by !== pid) throw new HttpError(403, 'NOT_YOURS');
    if (job.state !== 'ready') throw new HttpError(409, 'NOT_READY', { job: publicJob(job) });
    const prompt = typeof body.prompt === 'string' ? clean(body.prompt) : '';
    if (!prompt || chars(prompt) > PROMPT_MAX) throw new HttpError(400, 'BAD_ARGS', { field: 'prompt' });
    if (job.round >= MAX_ROUNDS) throw new HttpError(409, 'LIMIT', { job: publicJob(job) });
    const provider = this.providers[job.provider];
    // claim the job for this round before any wait (as start() claims the farm): a second "ask for changes", an apply
    // or a discard arriving meanwhile see it no longer ready and are refused instead of running alongside
    job.state = 'revising';
    let parent = job.priv.parent;
    try {
      const st = provider ? await provider.signIn.status(this.userOf(fk, pid)) : null;
      if (!st || st.state !== 'signed_in') throw new HttpError(428, 'SIGN_IN', { provider: job.provider });
      // "rebuild on top" after a 409 STALE: the next candidate is checked against the farm's version as it is now
      try { const a = await this.ctx.mods.active(fk); parent = a && Number.isInteger(a.n) ? a.n : 0; } catch { /* keep */ }
    } catch (err) {
      if (job.state === 'revising') job.state = 'ready';   // refused: the job is as it was (still ready to apply)
      throw err;
    }
    // the server stopped while we waited: the job stays as it was; cancelled meanwhile: that answer stands
    if (this.stopped && job.state === 'revising') job.state = 'ready';
    if (job.state !== 'revising') throw new HttpError(409, 'NOT_READY', { job: publicJob(job) });
    job.priv.parent = parent;
    job.prompts = [...job.prompts, { at: this.now(), text: prompt }];
    job.round += 1;
    job.priv.fixes = 0;
    job.priv.lastErrors = [];
    job.result = null;
    job.error = null;
    await this.touch(fk, job, { state: 'revising', step: 'reading' });
    this.drive(fk, job);
    return publicJob(job);
  }

  async apply(fk, pid, jobId) {
    const job = await this.jobFor(fk, jobId);
    if (job.by !== pid) throw new HttpError(403, 'NOT_YOURS');
    if (job.state !== 'ready' || !job.result || !job.result.candidate) throw new HttpError(409, 'NOT_READY', { job: publicJob(job) });
    await this.touch(fk, job, { state: 'applying', step: 'ready' });
    this.note(fk, job, 'ready', 'applying');
    let out;
    try {
      out = await this.ctx.mods.apply(fk, job.result.candidate, { by: pid, jobId: job.id, summary: job.result.summary });
    } catch (err) {
      await this.touch(fk, job, { state: 'ready' });
      const code = err && (err.error || err.code || (err.body && err.body.error));
      if (code === 'STALE') throw new HttpError(409, 'STALE', { job: publicJob(job) });
      if (err && err.status && err.status < 500 && typeof code === 'string') throw new HttpError(err.status, code, { job: publicJob(job) });
      this.log.error('agent: apply failed', { job: job.id }, err instanceof Error ? err : undefined);
      throw new HttpError(500, 'INTERNAL');
    }
    if (out && (out.error === 'STALE')) {
      await this.touch(fk, job, { state: 'ready' });
      throw new HttpError(409, 'STALE', { job: publicJob(job) });
    }
    const active = out && out.active ? out.active : out;
    this.note(fk, job, 'ready', 'applied');
    await this.touch(fk, job, { state: 'applied' });
    this.record(fk, job, 'job.applied');
    return { active };
  }

  async discard(fk, pid, jobId) {
    const job = await this.jobFor(fk, jobId);
    if (job.state !== 'ready') throw new HttpError(409, 'NOT_READY', { job: publicJob(job) });
    await this.touch(fk, job, { state: 'discarded' });
    this.record(fk, job, 'job.discarded');
    return publicJob(job);
  }

  async cancel(fk, pid, jobId) {
    const job = await this.jobFor(fk, jobId);
    if (job.state === 'applying') throw new HttpError(409, 'BUSY', { job: publicJob(job) });
    if (!OPEN.includes(job.state)) return publicJob(job);
    const live = this.live.get(job.id);
    if (live) {
      live.cancelled = true;
      live.abort.abort();
      if (live.dropWait) live.dropWait();
      try { this.providers[job.provider].cancel(job.id); } catch { /* gone */ }
    }
    await this.touch(fk, job, { state: 'cancelled' });
    this.record(fk, job, 'job.discarded');
    return publicJob(job);
  }

  // ---------------------------------------------------------------- the MCP bridge's loopback calls

  /** POST /internal/agent/:jobId/(validate|preview): only the live run's own token, only while it runs. */
  async bridge(jobId, token, op) {
    const live = this.live.get(String(jobId));
    if (!live || !live.tools || !sameSecret(token, live.token)) throw new HttpError(404, 'NOT_FOUND');
    if (op !== 'validate' && op !== 'preview') throw new HttpError(404, 'NOT_FOUND');
    return live.tools[op]({});
  }

  // ---------------------------------------------------------------- lifecycle

  async onFarmDeleted(fk) {
    for (const live of [...this.live.values()]) {
      if (live.fk !== fk) continue;
      live.cancelled = true;
      live.abort.abort();
      if (live.dropWait) live.dropWait();
      try { this.providers[live.job.provider].cancel(live.job.id); } catch { /* gone */ }
    }
    for (const p of Object.values(this.providers)) { try { p.forget?.(fk); } catch { /* best effort */ } }
    const push = this.pushes.get(fk);
    if (push) { clearTimeout(push.timer); this.pushes.delete(fk); }
    this.farms.delete(fk);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.sweeper);
    for (const w of this.waiters.splice(0)) w.drop();
    const lives = [...this.live.values()];
    for (const live of lives) {
      live.cancelled = true;
      live.abort.abort();
      try { this.providers[live.job.provider].cancel(live.job.id); } catch { /* gone */ }
      if (ACTIVE.includes(live.job.state)) {
        Object.assign(live.job, { state: 'failed', error: { code: 'RESTARTED', detail: null }, updatedAt: this.now() });
        await this.save(live.fk, live.job);
      }
    }
    for (const p of Object.values(this.providers)) { try { p.stop?.(); } catch { /* best effort */ } }
    for (const { timer } of this.pushes.values()) clearTimeout(timer);
    this.pushes.clear();
    await Promise.all([...this.saving.values()]);
  }
}

function titleSummary(files) {
  const t = files && files['mod.json'] && files['mod.json'].title;
  return t && (t.en || t.bg) ? { en: String(t.en || t.bg), bg: String(t.bg || t.en) } : null;
}
