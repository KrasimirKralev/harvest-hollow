// Agent lane test helpers: a HarnessCtx stand-in (auth, dirs, pushes, telemetry) with a small fake of the mods lane's
// API (validate / preview / stage / apply / files / catalog), so the agent lane is tested alone (harness contract §7:
// "until a lane's factory exists ... every lane can test alone").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentConfig } from '../../server/agent/config.js';

export const CROP_LADDER = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 960, 1440];

/** A scratch dir under TMPDIR (the lane runs with TMPDIR in .scratch/hh-agent/tmp). */
export function tmpRoot(name = 'agent') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hh-${name}-`));
}

/** A logger that keeps every line (tests assert that no secret ever reaches a log). */
export function captureLog() {
  const lines = [];
  const w = (level) => (...a) => lines.push(`${level} ${a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`);
  return { lines, info: w('INFO'), log: w('INFO'), warn: w('WARN'), error: w('ERROR') };
}

export function fakeMods() {
  const farms = new Map();
  const f = (fk) => {
    if (!farms.has(fk)) farms.set(fk, { active: null, versions: new Map(), next: 1, stale: false, validations: [] });
    return farms.get(fk);
  };
  const problemsOf = (files) => {
    const errors = [];
    if (!files['mod.json']) errors.push({ stage: 'schema', code: 'MISSING_FIELD', file: 'mod.json', path: '', message: 'mod.json is missing' });
    for (const [rel, v] of Object.entries(files)) {
      if (rel.startsWith('content/crops/') && !CROP_LADDER.includes(v.growMin)) {
        errors.push({ stage: 'schema', code: 'NOT_LADDER', file: rel, path: 'growMin', message: 'growMin is not a ladder step', hint: 'use 90' });
      }
    }
    return errors;
  };
  const changesOf = (files) => Object.entries(files).filter(([rel]) => rel.startsWith('content/')).map(([rel, v]) => ({
    op: 'add', family: rel.split('/')[1], id: v.id, name: { en: v.text?.en?.name, bg: v.text?.bg?.name }, icon: null }));
  return {
    farms,
    f,
    async active(fk) { return f(fk).active; },
    async files(fk, n) {
      const s = f(fk);
      const k = n ?? (s.active && s.active.n);
      return k ? s.versions.get(k).files : null;
    },
    async catalog() { return { crops: [{ id: 'watermelon', name: { en: 'Watermelon', bg: 'Диня' } }], farm: { level: 12 } }; },
    async validate(fk, files, { full = false } = {}) {
      f(fk).validations.push({ full, files: Object.keys(files) });
      const errors = problemsOf(files);
      return { ok: errors.length === 0, stage: errors.length ? 'schema' : 'done', full, ms: 3, modHash: 'm', overlayHash: errors.length ? null : 'o',
        errors, warnings: [], checks: { semantic: { ok: !errors.length, numbers: { x_moon_melon: { sell: 124, seed: 149, xp: 47, growMin: 90 } } } } };
    },
    async preview(fk, files) { return { changes: changesOf(files), numbers: {} }; },
    async stage(fk, files, meta) {
      const s = f(fk);
      const n = s.next++;
      s.versions.set(n, { files, meta });
      return { candidate: n, hash: `h${n}` };
    },
    async apply(fk, candidate, { by }) {
      const s = f(fk);
      if (s.stale) { const e = new Error('stale'); e.status = 409; e.error = 'STALE'; throw e; }
      s.active = { n: candidate, hash: `h${candidate}`, appliedAt: Date.now(), by, title: 'Moonlight Harvest' };
      return { active: s.active };
    },
  };
}

/**
 * @param {{ root: string, mode?: 'single'|'multi', env?: object, telemetry?: boolean }} o
 */
export function stubCtx({ root, mode = 'single', env = {}, telemetry = true, log = captureLog() }) {
  const pushes = [];
  const records = [];
  const tokens = { 'tok-p1': 'p1', 'tok-p2': 'p2' };
  // never the machine's real binary: tests that need one point HH_CLAUDE_BIN at test/fixtures/fake-claude.mjs
  const cfg = agentConfig({ HH_HARNESS_MOCK: '1', HH_MOCK_STEP_MS: '1', HH_CLAUDE_BIN: path.join(root, 'no-claude'), ...env });
  const ctx = {
    cfg: { port: 0, harness: { agent: cfg } },
    log,
    mode,
    hostDir: path.join(root, 'harness-host'),
    dirOf: (fk) => (fk === 'local' ? path.join(root, 'harness') : path.join(root, 'farms', fk, 'harness')),
    push: (fk, msg, opt = {}) => pushes.push({ fk, msg, pid: opt.pid || null }),
    async auth(req) {
      const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!m) throw Object.assign(new Error('auth'), { status: 401, error: 'AUTH' });
      const pid = tokens[m[1]];
      if (!pid) throw Object.assign(new Error('auth'), { status: 403, error: 'AUTH' });
      return { farmKey: 'local', pid };
    },
    mods: fakeMods(),
    telemetry: telemetry ? { record: async (fk, pid, ev) => { records.push({ fk, pid, ev }); } } : null,
  };
  return { ctx, pushes, records, log };
}

/** Poll until fn() is truthy (or throw after ms). */
export async function waitFor(fn, ms = 5000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
