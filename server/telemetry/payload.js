// The one shape a shared helper event may have (docs/agent-notes/harness-contract.md §6), built by the sender and
// checked again, field by field, by the receiver. Both sides run the same whitelist and the same scrub, so nothing can
// ride along: no credential, account label, farm id, pid, player or farm name (unless typed into the prompt), IP
// address or file path. A field that is not in the list below is never copied; a string anywhere in the event goes
// through scrub(), which replaces anything that looks like a key, token, e-mail, address or path.
//
//   { v: 1, id, install, event, at, game: { version, contentHash, rules, mode }, lang, provider, model,
//     prompts: [text], mod: { format: 1, files: { <path>: json }, trimmed? }, diff: { added, changed, retired, revived },
//     validation: { ok, stage, codes, rounds, ms }, outcome: { state, afterMs } }
import crypto from 'node:crypto';
import { MAX_PAYLOAD_BYTES } from './config.js';

export const PAYLOAD_VERSION = 1;
export const EVENTS = Object.freeze(['job.ready', 'job.applied', 'job.discarded', 'job.failed', 'job.answered', 'mod.undone']);
export const OUTCOMES = Object.freeze(['ready', 'applied', 'discarded', 'expired', 'cancelled', 'failed', 'answered', 'undone']);
export const PROVIDERS = Object.freeze(['claude', 'chatgpt', 'mock']);
export const LANGS = Object.freeze(['en', 'bg']);
export const STAGES = Object.freeze(['schema', 'semantic', 'boot', 'render', 'done']);
export const MODES = Object.freeze(['single', 'multi']);
export const PAYLOAD_LIMITS = Object.freeze({ prompts: 20, promptChars: 1000, codes: 40, ids: 60, files: 60, depth: 8, array: 100,
  stringChars: 2000 });
/** The event's top-level keys, in order (the receiver refuses any other). */
export const PAYLOAD_KEYS = Object.freeze(['v', 'id', 'install', 'event', 'at', 'game', 'lang', 'provider', 'model', 'prompts', 'mod',
  'diff', 'validation', 'outcome']);
const EVENT_OUTCOME = { 'job.ready': 'ready', 'job.applied': 'applied', 'job.discarded': 'discarded', 'job.failed': 'failed',
  'job.answered': 'answered', 'mod.undone': 'undone' };

const HEX128 = /^[0-9a-f]{32}$/;
const DEF_ID = /^[a-z][a-z0-9_]{0,39}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** The files a mod may hold (contract §1.1), relative to mod/. */
export const MOD_PATH = /^(?:mod\.json|tuning\.json|look\.json|text\/(?:letters|tips)\.json|content\/(?:crops|trees|recipes|animals|decor)\/x_[a-z0-9_]{1,30}\.json)$/;
/** A key inside a mod file: the format's own field names and ids. */
const FILE_KEY = /^[A-Za-z0-9_]{1,40}$/;
/** Keys that name a credential: never copied, whatever file they sit in. */
const SECRET_KEY = /token|secret|passw|authori[sz]|cookie|credential|api_?key|bearer|session|^access$|^refresh$|^sub$|^account$|^email$/i;

// C0/C1 controls but \n and \t, DEL, the bidi embeddings / overrides / isolates and marks, zero-width space and BOM
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** What a string must never carry, each replaced by a neutral marker. Order matters: the specific before the general. */
const SCRUB = [
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.?[A-Za-z0-9_-]*/g, '[redacted]'],                        // JWT / ID tokens
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [redacted]'],
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, '[redacted]'],                                                   // sk-…, sk-ant-…, sk-proj-…
  [/\boaiapp_[A-Za-z0-9_-]+/g, '[redacted]'],                                                             // an issued ChatGPT client id
  [/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g, '[redacted]'],
  [/#k=[^\s&#"'<>]*/g, '#k=[redacted]'],                                                                  // a personal farm link's key
  [/([?&](?:join|rejoin|k|key|token|secret|code|state|nonce|access_token|refresh_token|id_token)=)[^\s&#"'<>]*/gi, '$1[redacted]'],
  [/\/f\/[a-z2-7]{12}(?![a-z2-7])/g, '/f/[farm]'],                                                        // a farm's address
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]'],
  [/(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/gi, '[redacted]'],                                             // farm keys, invites, hashes
  [/(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, '[redacted]'], // random tokens (a mod id is <= 32)
  [/(?:^|(?<=[\s"'(=:,]))(?:~\/|\/(?:home|root|Users|tmp|var|etc|srv|opt|mnt|data|app|run|proc)\/)[^\s"'()<>,]*/g, '[path]'],
  [/\b[A-Za-z]:\\[^\s"'<>]*/g, '[path]'],
  [/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, '[ip]'],
  [/(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){3,7}(?::|[0-9a-f]{1,4})(?![0-9a-f:])/gi, '[ip]'],
];

/** A string with every credential-, address- and path-looking part replaced, control characters dropped. Pure. */
export function scrub(s) {
  let t = String(s).normalize('NFC').replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(CONTROL, '');
  for (const [re, to] of SCRUB) t = t.replace(re, to);
  return t;
}

const cut = (s, n) => ([...s].length > n ? [...s].slice(0, n).join('') : s);

/**
 * A mod file's JSON made safe: plain data only, every string scrubbed and cut, every key a format key (a key that names
 * a credential is dropped), bounded depth and array length. Pure.
 */
export function cleanJson(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return cut(scrub(v), PAYLOAD_LIMITS.stringChars);
  if (depth >= PAYLOAD_LIMITS.depth) return null;
  if (Array.isArray(v)) return v.slice(0, PAYLOAD_LIMITS.array).map((x) => cleanJson(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (!FILE_KEY.test(k) || SECRET_KEY.test(k)) continue;
      const c = cleanJson(v[k], depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return null;
}

/** The mod's files, only paths a mod may hold, each cleaned. */
function cleanFiles(files) {
  const out = {};
  if (!files || typeof files !== 'object' || Array.isArray(files)) return out;
  let n = 0;
  for (const p of Object.keys(files).sort()) {
    const rel = p.startsWith('mod/') ? p.slice(4) : p;
    if (!MOD_PATH.test(rel) || n >= PAYLOAD_LIMITS.files) continue;
    out[rel] = cleanJson(files[p], 1);
    n++;
  }
  return out;
}

const idsOf = (list) => {
  if (!Array.isArray(list)) return [];
  const ids = list.map((x) => (typeof x === 'string' ? x : x && typeof x.id === 'string' ? x.id : null)).filter((x) => x && DEF_ID.test(x));
  return [...new Set(ids)].slice(0, PAYLOAD_LIMITS.ids);
};

/** { added, changed, retired, revived } from a diffOverlays() result or a job's Change list. */
function diffOf(diff, changes) {
  if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
    return { added: idsOf(diff.added), changed: idsOf(diff.changed), retired: idsOf(diff.retired), revived: idsOf(diff.revived) };
  }
  const by = { add: [], change: [], retire: [], revive: [] };
  for (const c of Array.isArray(changes) ? changes : []) if (c && by[c.op]) by[c.op].push(c.id);
  return { added: idsOf(by.add), changed: idsOf(by.change), retired: idsOf(by.retire), revived: idsOf(by.revive) };
}

const int = (n, lo, hi) => (Number.isSafeInteger(n) && n >= lo && n <= hi ? n : null);

/** { ok, stage, codes, rounds, ms } from a ValidationResult (error codes only: messages and hints may hold paths). */
function validationOf(v, rounds) {
  if (!v || typeof v !== 'object') return { ok: false, stage: null, codes: [], rounds: int(rounds, 0, 99) ?? 0, ms: null };
  const codes = [...new Set((Array.isArray(v.errors) ? v.errors : []).map((e) => e && e.code).filter((c) => typeof c === 'string' && CODE.test(c)))];
  if (Array.isArray(v.codes)) for (const c of v.codes) if (typeof c === 'string' && CODE.test(c) && !codes.includes(c)) codes.push(c);
  return { ok: v.ok === true, stage: STAGES.includes(v.stage) ? v.stage : null, codes: codes.slice(0, PAYLOAD_LIMITS.codes),
    rounds: int(rounds ?? v.rounds, 0, 99) ?? 0, ms: int(Math.round(Number(v.ms)), 0, 86_400_000) };
}

const textOf = (p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : null);

/** Prompts in order, each scrubbed and at most 1000 characters; the newest PAYLOAD_LIMITS.prompts. */
function promptsOf(list) {
  const out = (Array.isArray(list) ? list : []).map(textOf).filter((t) => t !== null)
    .map((t) => cut(scrub(t).trim(), PAYLOAD_LIMITS.promptChars)).filter(Boolean);
  return out.slice(-PAYLOAD_LIMITS.prompts);
}

export const newEventId = () => crypto.randomBytes(16).toString('hex');

/**
 * The event as it leaves this server. `input` (what the agent runtime knows; any other field is ignored):
 *   { event, job?, lang?, provider?, model?, prompts?, files?, diff?, validation?, rounds?, outcome?: { state, afterMs } }
 * `job` is the public Job shape (§4.2): its prompts, lang, provider, model, round, result.validation, result.changes
 * and timing fill whatever the explicit fields leave out. Only the fields of the contract's payload are read from it.
 * `meta`: { install, game: { version, contentHash, rules, mode }, now, id? }. Throws on an unknown event.
 */
export function buildPayload(input, meta) {
  const ev = input && input.event;
  if (!EVENTS.includes(ev)) throw new Error(`telemetry: unknown event ${String(ev).slice(0, 40)}`);
  const job = input.job && typeof input.job === 'object' ? input.job : {};
  const res = job.result && typeof job.result === 'object' ? job.result : {};
  const lang = [input.lang, job.lang].find((l) => LANGS.includes(l)) ?? null;
  const provider = [input.provider, job.provider].find((p) => PROVIDERS.includes(p)) ?? null;
  const model = [input.model, job.model].find((m) => typeof m === 'string' && MODEL.test(m)) ?? null;
  const prompts = promptsOf(input.prompts ?? job.prompts);
  const files = cleanFiles(input.files);
  const state = OUTCOMES.includes(input.outcome?.state) ? input.outcome.state
    : OUTCOMES.includes(job.state) && ev !== 'mod.undone' ? job.state : EVENT_OUTCOME[ev];
  const after = input.outcome?.afterMs ?? (Number.isFinite(job.startedAt) && Number.isFinite(job.updatedAt) ? job.updatedAt - job.startedAt : null);
  const g = meta.game || {};
  const p = {
    v: PAYLOAD_VERSION,
    id: meta.id ?? newEventId(),
    install: meta.install,
    event: ev,
    at: meta.now,
    game: { version: typeof g.version === 'string' ? cut(g.version, 32) : '0.0.0', contentHash: typeof g.contentHash === 'string' ? cut(g.contentHash, 64) : null,
      rules: int(g.rules, 0, 1e6), mode: MODES.includes(g.mode) ? g.mode : 'single' },
    lang,
    provider,
    model,
    prompts,
    mod: { format: 1, files },
    diff: diffOf(input.diff, input.changes ?? res.changes),
    validation: validationOf(input.validation ?? res.validation, input.rounds ?? job.round),
    outcome: { state, afterMs: int(Math.round(Number(after)), 0, 30 * 86_400_000) },
  };
  return fit(p);
}

const bytes = (o) => Buffer.byteLength(JSON.stringify(o));

/** Under MAX_PAYLOAD_BYTES: the mod's files go first (marked `trimmed`), then the oldest prompts. */
export function fit(p) {
  if (bytes(p) <= MAX_PAYLOAD_BYTES) return p;
  let q = { ...p, mod: { format: 1, files: {}, trimmed: true } };
  while (bytes(q) > MAX_PAYLOAD_BYTES && q.prompts.length > 1) q = { ...q, prompts: q.prompts.slice(1) };
  return q;
}

const bad = (field) => ({ ok: false, field });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (o, keys) => Object.keys(o).find((k) => !keys.includes(k));

/**
 * The receiver's check: { ok: true, payload } (the event as it will be stored: every string scrubbed again) or
 * { ok: false, field } naming the first thing that is wrong. Strict: an unknown key anywhere in the frame is refused.
 */
export function checkPayload(b) {
  if (!isObj(b)) return bad('body');
  const extra = only(b, PAYLOAD_KEYS);
  if (extra) return bad(extra);
  if (b.v !== PAYLOAD_VERSION) return bad('v');
  if (typeof b.id !== 'string' || !HEX128.test(b.id)) return bad('id');
  if (typeof b.install !== 'string' || !HEX128.test(b.install)) return bad('install');
  if (!EVENTS.includes(b.event)) return bad('event');
  if (!Number.isSafeInteger(b.at) || b.at < 0) return bad('at');
  const g = b.game;
  if (!isObj(g) || only(g, ['version', 'contentHash', 'rules', 'mode'])) return bad('game');
  if (typeof g.version !== 'string' || g.version.length > 32 || !/^[0-9A-Za-z.+-]{1,32}$/.test(g.version)) return bad('game');
  if (g.contentHash !== null && (typeof g.contentHash !== 'string' || !/^[0-9A-Za-z]{1,64}$/.test(g.contentHash))) return bad('game');
  if (g.rules !== null && int(g.rules, 0, 1e6) === null) return bad('game');
  if (!MODES.includes(g.mode)) return bad('game');
  if (b.lang !== null && !LANGS.includes(b.lang)) return bad('lang');
  if (b.provider !== null && !PROVIDERS.includes(b.provider)) return bad('provider');
  if (b.model !== null && (typeof b.model !== 'string' || !MODEL.test(b.model))) return bad('model');
  if (!Array.isArray(b.prompts) || b.prompts.length > PAYLOAD_LIMITS.prompts) return bad('prompts');
  for (const t of b.prompts) if (typeof t !== 'string' || [...t].length > PAYLOAD_LIMITS.promptChars) return bad('prompts');
  const m = b.mod;
  if (!isObj(m) || only(m, ['format', 'files', 'trimmed']) || m.format !== 1 || !isObj(m.files)) return bad('mod');
  if (m.trimmed !== undefined && m.trimmed !== true) return bad('mod');
  const paths = Object.keys(m.files);
  if (paths.length > PAYLOAD_LIMITS.files || paths.some((p) => !MOD_PATH.test(p))) return bad('mod');
  const d = b.diff;
  if (!isObj(d) || only(d, ['added', 'changed', 'retired', 'revived'])) return bad('diff');
  for (const k of ['added', 'changed', 'retired', 'revived']) {
    const list = d[k] ?? [];
    if (!Array.isArray(list) || list.length > PAYLOAD_LIMITS.ids || list.some((x) => typeof x !== 'string' || !DEF_ID.test(x))) return bad('diff');
  }
  const v = b.validation;
  if (!isObj(v) || only(v, ['ok', 'stage', 'codes', 'rounds', 'ms']) || typeof v.ok !== 'boolean') return bad('validation');
  if (v.stage !== null && !STAGES.includes(v.stage)) return bad('validation');
  if (!Array.isArray(v.codes) || v.codes.length > PAYLOAD_LIMITS.codes || v.codes.some((c) => typeof c !== 'string' || !CODE.test(c))) return bad('validation');
  if (int(v.rounds, 0, 99) === null || (v.ms !== null && int(v.ms, 0, 86_400_000) === null)) return bad('validation');
  const o = b.outcome;
  if (!isObj(o) || only(o, ['state', 'afterMs']) || !OUTCOMES.includes(o.state)) return bad('outcome');
  if (o.afterMs !== null && int(o.afterMs, 0, 30 * 86_400_000) === null) return bad('outcome');
  return {
    ok: true,
    payload: {
      v: b.v, id: b.id, install: b.install, event: b.event, at: b.at,
      game: { version: g.version, contentHash: g.contentHash, rules: g.rules, mode: g.mode },
      lang: b.lang, provider: b.provider, model: b.model,
      prompts: b.prompts.map((t) => scrub(t)),
      mod: { format: 1, files: cleanFiles(m.files), ...(m.trimmed ? { trimmed: true } : {}) },
      diff: { added: [...(d.added ?? [])], changed: [...(d.changed ?? [])], retired: [...(d.retired ?? [])], revived: [...(d.revived ?? [])] },
      validation: { ok: v.ok, stage: v.stage, codes: [...v.codes], rounds: v.rounds, ms: v.ms },
      outcome: { state: o.state, afterMs: o.afterMs },
    },
  };
}
