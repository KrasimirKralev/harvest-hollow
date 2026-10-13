// The validation pipeline (contract §3): schema -> semantic (compile + the game's own validateContent) -> boot (a worker
// on a copy of the farm) -> render (models, icons, names). Stops at the first stage with errors.
//
//   validateCandidate({ files, prevOverlay, graveyard, state, now, full, n, root, tracks, bgNames, pool })
//     -> Promise<{ result: ValidationResult, overlay: object | null, icons: { '<size>/<id>.png': Buffer } }>
//   bootPool({ size, timeoutMs }) -> { run(task, { timeoutMs }) -> Promise<bootTest result>, size }
// A mod is offered only when result.ok with full: true.
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cloneTables, CONTENT_HASH, validateContent } from '../../shared/content/index.js';
import { RULES_VERSION } from '../../shared/rules/version.js';
import { checkFiles, parseFiles } from '../../shared/mod/schema.js';
import { compileMod } from '../../shared/mod/compile.js';
import { applyMod } from '../../shared/mod/apply.js';
import { modHash } from '../../shared/mod/hash.js';
import { renderCheck } from './render.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'boot-worker.js');
let baseTables = null;
/** The base game's tables (copied once per process: compile and the content check only read them). */
export const base = () => ({ tables: (baseTables ??= cloneTables()), hash: CONTENT_HASH, rules: RULES_VERSION });

/** A small pool: at most `size` boot tests at once (each in a fresh worker thread, freed when it ends). */
export function bootPool({ size = 2, timeoutMs = 20_000, maxOldMb = 256 } = {}) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= size || !waiting.length) return;
    running++;
    const { task, resolve, limit } = waiting.shift();
    const w = new Worker(WORKER, { workerData: { task }, resourceLimits: { maxOldGenerationSizeMb: maxOldMb } });
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      running--;
      w.terminate().catch(() => {});
      resolve(r);
      next();
    };
    const fail = (code, message) => finish({ ok: false, errors: [{ stage: 'boot', code, file: '', path: '', message }], checks: { ok: false } });
    const timer = setTimeout(() => fail('TIMEOUT', `the play test took longer than ${Math.round(limit / 1000)} s`), limit);
    w.once('message', finish);
    w.once('error', (err) => fail(err && err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'OOM' : 'BOOT_THROW', String(err && err.message).slice(0, 300)));
    w.once('exit', (code) => fail('BOOT_THROW', `the play test stopped (exit ${code})`));
  };
  return {
    size,
    run(task, { timeoutMs: t = timeoutMs } = {}) {
      return new Promise((resolve) => { waiting.push({ task, resolve, limit: t }); next(); });
    },
  };
}

/** The result shape (contract §3). */
function result({ ok, stage, full, t0, files, overlay, errors, warnings, checks }) {
  return { ok, stage, full, ms: Date.now() - t0, modHash: modHash(files), overlayHash: overlay ? overlay.hash : null,
    errors, warnings, checks };
}

export async function validateCandidate({ files: raw, prevOverlay = null, graveyard = {}, state, now = Date.now(), full = true,
  n = 1, root, tracks = null, bgNames = null, pool, quickMs = 5000 }) {
  const t0 = Date.now();
  const checks = { schema: { ok: false, files: Object.keys(raw ?? {}).length } };
  const warnings = [];
  // 1. schema
  const sp = checkFiles(raw, { graveyard });
  const { files } = parseFiles(raw);
  if (sp.length) {
    return { result: result({ ok: false, stage: 'schema', full, t0, files, overlay: null, errors: sp.slice(0, 60), warnings, checks }), overlay: null, icons: {} };
  }
  checks.schema.ok = true;
  // 2. semantic
  const c = compileMod(base(), files, { n, prevOverlay, tracks, bgNames });
  warnings.push(...c.warnings);
  checks.semantic = { ok: false, defs: { added: 0, patched: 0, retired: 0 }, numbers: c.numbers };
  if (!c.ok) {
    return { result: result({ ok: false, stage: 'semantic', full, t0, files, overlay: null, errors: c.problems.slice(0, 60), warnings, checks }), overlay: null, icons: {} };
  }
  const ov = c.overlay;
  let content = [];
  try {
    content = validateContent(applyMod(base().tables, ov));
  } catch (err) {
    content = [`the overlay does not apply: ${err.message}`];
  }
  const fams = ['crops', 'trees', 'recipes', 'animals', 'decor'];
  checks.semantic.defs = {
    added: fams.reduce((s, f) => s + (ov.defs[f]?.length ?? 0), 0),
    patched: Object.values(ov.patch).reduce((s, l) => s + l.length, 0),
    retired: fams.reduce((s, f) => s + (ov.graveyard[f]?.length ?? 0), 0),
  };
  if (content.length) {
    const errors = content.slice(0, 30).map((m) => ({ stage: 'semantic', code: 'CONTENT_CHECK', file: '', path: '', message: m,
      hint: 'the game\'s own content check refused this; change the numbers or anchors it names' }));
    return { result: result({ ok: false, stage: 'semantic', full, t0, files, overlay: null, errors, warnings, checks }), overlay: null, icons: {} };
  }
  checks.semantic.ok = true;
  // 3. boot (a worker; quick: the per-def steps only)
  const boot = await pool.run({ overlay: ov, state, now, full }, full ? {} : { timeoutMs: quickMs });
  checks.boot = { ...(boot.checks ?? {}), ok: boot.ok };
  if (!boot.ok) {
    return { result: result({ ok: false, stage: 'boot', full, t0, files, overlay: ov, errors: boot.errors, warnings, checks }), overlay: null, icons: {} };
  }
  // 4. render
  const r = renderCheck(ov, { root });
  checks.render = r.checks;
  if (!r.ok) {
    return { result: result({ ok: false, stage: 'render', full, t0, files, overlay: ov, errors: r.errors, warnings, checks }), overlay: null, icons: {} };
  }
  return { result: result({ ok: true, stage: 'done', full, t0, files, overlay: ov, errors: [], warnings, checks }), overlay: ov, icons: r.icons };
}
