// The helper's view model (Harness Hollow, ui lane): pure functions from the contract's shapes (Job, Change,
// ValidationResult, hx messages; docs/agent-notes/harness-contract.md §3, §4) to what the screens show. No DOM, no
// catalog reads (the views turn the { key, params } answers into words), so node tests run it as it is.
//
//   STEPS, ACTIVE, OPEN, ENDED            job states and the pill's four steps
//   stepOf(job) / stepIndex(step)         what the helper is doing now, and where that sits on the four dots
//   pillOf(job, me)                       the floating pill: null | { mine, tone, step, key }
//   changeRows(changes, lang)             the pop-up's change list: [{ op, family, id, name, icon, facts }]
//   testRows(validation)                  the pop-up's test results: [{ id, ok, key, params }]
//   errorRows(validation, changes, lang)  what failed, in the player's words: [{ code, key, what, whatKey? }]
//   errKey(code)                          'harness.err.<CODE>' for every code of the contract, else the generic line
//   jobErrLine(job)                       a failed job's own line: { key, link } (a provider's wording and page where
//                                         its docs ask for one: ChatGPT's usage limit -> ChatGPT settings › Usage)
//   appliedLine(msg, me, names, lang) / undoneLine(msg, me, names)   the toasts every farmer of the farm sees
//   prefsKey(scope) / lettersKey(scope)   this device's helper storage, per farm in multi mode
//   pickText({ en, bg }, lang)            a two-language text in the language, else English

export const STEPS = Object.freeze(['reading', 'building', 'testing', 'ready']);
/** A job the helper is busy with (the pill shows a step). */
export const ACTIVE = new Set(['starting', 'working', 'validating', 'fixing', 'revising', 'applying']);
/** A job that is the farm's current one (the contract: one per farm until it ends). */
export const OPEN = new Set([...ACTIVE, 'ready']);
export const ENDED = new Set(['applied', 'discarded', 'expired', 'failed', 'cancelled']);

const STATE_STEP = { starting: 'reading', working: 'building', validating: 'testing', fixing: 'fixing', revising: 'reading', applying: 'applying', ready: 'ready' };
const KNOWN_STEPS = new Set([...STEPS, 'fixing', 'signin', 'applying']);

/** What the helper is doing now: the job's own step when it names one, else the step its state implies. Pure. */
export function stepOf(job) {
  if (!job) return null;
  if (job.state === 'ready' || job.state === 'applying') return STATE_STEP[job.state];
  if (KNOWN_STEPS.has(job.step)) return job.step;
  return STATE_STEP[job.state] ?? 'reading';
}

/** The dot the step lights on reading · building · testing · ready (fixing is part of testing). Pure. */
export function stepIndex(step) {
  if (step === 'fixing') return 2;
  if (step === 'applying') return 3;
  if (step === 'signin') return 0;
  const i = STEPS.indexOf(step);
  return i < 0 ? 0 : i;
}

/**
 * The floating pill for a job (null: no pill). `mine`: this farmer asked for it (the partner's pill is passive).
 * tone: 'work' | 'signin' | 'ready' | 'fail' (mine) or 'partner' | 'partnerReady'. Pure.
 */
export function pillOf(job, me) {
  if (!job || !job.state) return null;
  const mine = Boolean(me) && job.by === me;
  const step = stepOf(job);
  if (!mine) {
    if (ACTIVE.has(job.state)) return { mine, tone: 'partner', step, key: 'harness.pill.partner' };
    if (job.state === 'ready') return { mine, tone: 'partnerReady', step, key: 'harness.pill.partnerReady' };
    return null;
  }
  if (job.state === 'ready') return { mine, tone: 'ready', step, key: 'harness.pill.ready' };
  if (job.state === 'failed') return { mine, tone: 'fail', step, key: 'harness.pill.failed' };
  if (!ACTIVE.has(job.state)) return null;
  if (step === 'signin') return { mine, tone: 'signin', step, key: 'harness.pill.signin' };
  return { mine, tone: 'work', step, key: `harness.pill.step.${step}` };
}

/** A two-language text ({ en, bg }) in the language, else English, else ''. Pure. */
export function pickText(v, lang) {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  return String(v[lang] || v.en || v.bg || '');
}

export const OPS = Object.freeze(['add', 'change', 'retire', 'revive']);
export const FAMILIES = Object.freeze(['crops', 'trees', 'recipes', 'animals', 'decor', 'items', 'tuning', 'look', 'text']);
const TIMED = { crops: 'grow', trees: 'grow', recipes: 'make', animals: 'time', decor: 'time' };

/**
 * The change list (Change[] of a job's result, or of a history version): one row per thing, the numbers as facts the
 * view words ({ key, n?, params }). Unknown ops/families still get a row (the server may know more than this client).
 */
export function changeRows(changes, lang = 'en') {
  if (!Array.isArray(changes)) return [];
  return changes.filter((c) => c && typeof c === 'object').map((c) => {
    const n = c.numbers && typeof c.numbers === 'object' ? c.numbers : {};
    const facts = [];
    const num = (v) => Number.isFinite(v) && v >= 0;
    if (c.op !== 'retire') {
      if (num(n.sell)) facts.push({ key: 'harness.fact.sell', n: n.sell });
      if (num(n.seed)) facts.push({ key: 'harness.fact.seed', n: n.seed });
      if (num(n.xp) && n.xp > 0) facts.push({ key: 'harness.fact.xp', n: n.xp });
      if (num(n.minutes) && n.minutes > 0) facts.push({ key: `harness.fact.${TIMED[c.family] ?? 'time'}`, ms: n.minutes * 60_000 });
      if (num(n.unlock) && n.unlock > 1) facts.push({ key: 'harness.fact.unlock', n: n.unlock });
    }
    return {
      op: OPS.includes(c.op) ? c.op : 'change',
      family: FAMILIES.includes(c.family) ? c.family : null,
      id: String(c.id ?? ''),
      name: pickText(c.name, lang) || String(c.id ?? ''),
      icon: typeof c.icon === 'string' && /^\/[\w./?=&%-]+$/.test(c.icon) ? c.icon : null,
      facts,
    };
  });
}

const STAGES = ['schema', 'semantic', 'boot', 'render'];
/** Basis points over 10000 -> the change in percent (10350 -> 3.5). Pure. */
export const bpDelta = (bp) => (Number.isFinite(bp) ? Math.round((bp - 10000) / 10) / 10 : null);

/**
 * The test results of a ValidationResult, in the order they ran: each stage that ran (ok or not), the economy guard
 * and the retire check of the boot stage, and the stages after a failure as not run (ok: null). Pure.
 */
export function testRows(v) {
  if (!v || typeof v !== 'object') return [];
  const checks = v.checks && typeof v.checks === 'object' ? v.checks : {};
  const failedAt = v.ok === false ? STAGES.indexOf(v.stage) : -1;
  const rows = [];
  STAGES.forEach((id, i) => {
    if (failedAt >= 0 && i > failedAt) { rows.push({ id, ok: null, key: `harness.test.${id}.skipped`, params: {} }); return; }
    const c = checks[id] && typeof checks[id] === 'object' ? checks[id] : null;
    if (!c && i !== failedAt) return;                    // a stage that reported nothing is not claimed either way
    if (i === failedAt || c.ok === false) { rows.push({ id, ok: false, key: `harness.test.${id}.failed`, params: {} }); return; }
    if (id === 'schema') {
      rows.push(Number.isFinite(c.files) ? { id, ok: true, key: 'harness.test.schema', params: { n: c.files } } : { id, ok: true, key: 'harness.test.schema.plain', params: {} });
    } else if (id === 'boot') {
      rows.push(Number.isFinite(c.simHours) && Number.isFinite(c.actions)
        ? { id, ok: true, key: 'harness.test.boot', params: { hours: c.simHours, n: c.actions } }
        : { id, ok: true, key: 'harness.test.boot.plain', params: {} });
      const econ = c.econ && typeof c.econ === 'object' ? c.econ : null;
      if (econ && Number.isFinite(econ.coinsBp) && Number.isFinite(econ.xpBp)) {
        rows.push({ id: 'econ', ok: true, key: 'harness.test.econ', params: { coins: bpDelta(econ.coinsBp), xp: bpDelta(econ.xpBp) } });
      }
      if (c.retire === true) rows.push({ id: 'retire', ok: true, key: 'harness.test.retire', params: {} });
    } else {
      rows.push({ id, ok: true, key: `harness.test.${id}`, params: {} });
    }
  });
  return rows;
}

/** Every code the contract names (validation §3, REST §4.3, providers §5, the client's own NET/AUTH). */
export const CODES = Object.freeze([
  // validation, schema
  'BAD_JSON', 'UNKNOWN_FILE', 'UNKNOWN_FIELD', 'MISSING_FIELD', 'BAD_TYPE', 'BAD_ID', 'ID_TAKEN', 'TOO_BIG', 'TOO_MANY',
  'BAD_ENUM', 'NOT_LADDER', 'BAD_HEX', 'BAD_TEXT', 'UNSUPPORTED',
  // validation, semantic
  'BAD_ANCHOR', 'UNKNOWN_REF', 'BAD_UNLOCK', 'OUT_OF_RANGE', 'ECON_BOUND', 'CYCLE', 'NAME_TAKEN', 'LOW_CONTRAST', 'BG_FORMS',
  'CONTENT_CHECK',
  // validation, boot and render
  'BOOT_THROW', 'ACTION_REJECTED', 'STATE_INVALID', 'ECON_GUARD', 'RETIRE_FAILED', 'TIMEOUT', 'OOM', 'NO_MODEL', 'ICON_FAILED',
  'NAME_TOO_LONG',
  // REST answers
  'AUTH', 'BUSY', 'SIGN_IN', 'RATE', 'BAD_ARGS', 'UNAVAILABLE', 'NOT_READY', 'STALE', 'NOT_YOURS', 'NOT_FOUND', 'LIMIT', 'ORIGIN',
  // a run's end, a restart, the agent's tools (NOT_ELIGIBLE, ACCOUNT_CHECK: ChatGPT's errors page)
  'USAGE_LIMIT', 'MAX_TURNS', 'SANDBOX', 'PROVIDER', 'RESTARTED', 'BAD_PATH', 'INVALID', 'NOT_ELIGIBLE', 'ACCOUNT_CHECK',
  // sign-in
  'DENIED', 'EXPIRED', 'BAD_CODE', 'STATE', 'INTERNAL',
  // a provider that cannot be offered
  'NO_BINARY', 'HOST_NOT_ALLOWED', 'UNSAFE_VERSION', 'OFF',
  // this client
  'NET',
]);
const CODE_SET = new Set(CODES);

/** The catalog key of a code's friendly line. Pure. */
export const errKey = (code) => (CODE_SET.has(code) ? `harness.err.${code}` : 'harness.err.other');

/**
 * Where a provider's own documentation sends the player for an error: OpenAI's errors page asks that the usage limit
 * link to ChatGPT settings › Usage (developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
 */
export const ERR_PAGES = Object.freeze({ chatgpt: Object.freeze({ USAGE_LIMIT: 'https://chatgpt.com/settings/usage' }) });

/** A failed job's own line: { key, link: { href, key } | null }, in the provider's wording where it has one. Pure. */
export function jobErrLine(job) {
  const code = job?.error?.code;
  if (!code) return null;
  const href = Object.hasOwn(ERR_PAGES, job.provider) ? ERR_PAGES[job.provider][code] ?? null : null;
  if (!href) return { key: errKey(code), link: null };
  return { key: `harness.err.${code}.${job.provider}`, link: { href, key: `harness.err.${code}.${job.provider}.link` } };
}

/** 'content/crops/x_moon_melon.json' -> 'x_moon_melon'. Pure. */
const idOfFile = (file) => (/([a-z0-9_]+)\.json$/i.exec(String(file ?? ''))?.[1] ?? '');
/** A thing's id as words when the change list does not name it: 'x_gold_pie' -> 'Gold pie'. Pure. */
export function prettyId(id) {
  const w = String(id ?? '').replace(/^x_/, '').replace(/_+/g, ' ').trim();
  return w ? w[0].toUpperCase() + w.slice(1) : '';
}

/** 'content/crops/x_moon_melon.json' -> 'crops' (the content families of the mod format), else ''. Pure. */
const familyOfFile = (file) => /^content\/(crops|trees|recipes|animals|decor)\//.exec(String(file ?? ''))?.[1] ?? '';

/**
 * What a failed validation found, in the player's words: one row per distinct (code, thing), at most `max`. `what` is
 * the thing's name from the change list when the file is one of its things, else the name the game knows it by, else
 * (English) the words of its id; in Bulgarian an id is English, so the row says what kind of new thing it is instead
 * (`whatKey`: 'harness.newThing.<family>', the view says it). '' for the files that are not a thing. Pure.
 */
export function errorRows(v, changes = [], lang = 'en', max = 5, known = () => null) {
  const errs = Array.isArray(v?.errors) ? v.errors : [];
  const names = new Map(changeRows(changes, lang).map((r) => [r.id, r.name]));
  const seen = new Set();
  const out = [];
  for (const e of errs) {
    if (!e || typeof e !== 'object') continue;
    const id = idOfFile(e.file);
    // a thing the game already knows (an earlier change, even a retired one) by its name in the language; else the id
    let what = names.get(id) ?? (id && !['mod', 'tuning', 'look', 'letters', 'tips', 'summary'].includes(id) ? known(id) ?? null : '');
    let whatKey = null;
    if (what === null) {
      if (lang === 'en') what = prettyId(id);
      else { what = ''; whatKey = `harness.newThing.${familyOfFile(e.file) || 'other'}`; }
    }
    const k = `${e.code}|${what}|${whatKey}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ code: String(e.code ?? ''), key: errKey(e.code), what, ...(whatKey ? { whatKey } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

/** A farmer's name from the state's players ({ pid: { name } }), else null. Pure. */
const nameOf = (players, pid) => (players && pid && players[pid] && typeof players[pid].name === 'string' ? players[pid].name : null);

const APPLIED_KEYS = { mine: 'harness.applied.mine', by: 'harness.applied.by', someone: 'harness.applied.someone' };
const APPLIED_TITLE_KEYS = { mine: 'harness.applied.mineTitle', by: 'harness.applied.byTitle', someone: 'harness.applied.someoneTitle' };

/**
 * The "helper added" toast of `hx applied` ({ by, n, title, names: [{ id, en, bg }] }): { key, params } with `things`
 * as an array of names (the view joins them with the language's list()). Pure.
 */
export function appliedLine(msg, me, players, lang = 'en') {
  // inside a Bulgarian sentence a name is lower case ("добави лунен пъпеш"); English keeps its Title Case
  const inSentence = (s) => (lang === 'bg' && s ? s[0].toLocaleLowerCase('bg') + s.slice(1) : s);
  const things = (Array.isArray(msg?.names) ? msg.names : []).map((x) => inSentence(pickText(x, lang))).filter(Boolean);
  const mine = Boolean(me) && msg?.by === me;
  const name = mine ? null : nameOf(players, msg?.by);
  const title = pickText(msg?.title, lang);
  const who = mine ? 'mine' : name ? 'by' : 'someone';
  if (things.length) return { key: APPLIED_KEYS[who], params: { things, name } };
  return { key: APPLIED_TITLE_KEYS[who], params: { title: title || '', name } };
}

/** The undo toast of `hx undone` ({ by, n, to }). Pure. */
export function undoneLine(msg, me, players) {
  const mine = Boolean(me) && msg?.by === me;
  const name = mine ? null : nameOf(players, msg?.by);
  return { key: mine ? 'harness.undone.mine' : name ? 'harness.undone.by' : 'harness.undone.someone', params: { name } };
}

/** This device's helper settings (provider, model), per farm in multi mode (net/farm.js scope). Pure. */
export const prefsKey = (scope) => (scope && scope.multi && scope.id ? `hh.f.${scope.id}.harness` : 'hh.harness');
/** The letters each farmer has seen on this device (contract §1.8). Pure. */
export const lettersKey = (scope) => (scope && scope.multi && scope.id ? `hh.f.${scope.id}.harness.letters` : 'hh.harness.letters');

/** The request box's limit (contract §4.3: 1..1000). */
export const PROMPT_MAX = 1000;
/** A request the server would take: trimmed, 1..1000 characters, no control characters but line breaks. Pure. */
export function cleanPrompt(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
  return s.length >= 1 && s.length <= PROMPT_MAX ? s : null;
}

/**
 * Which provider to use: the remembered one when it is offered and available, else the first signed-in available one,
 * else the first available one, else null. Pure.
 */
export function chooseProvider(providers, remembered) {
  const list = Array.isArray(providers) ? providers.filter((p) => p && p.id) : [];
  const avail = list.filter((p) => p.available !== false);
  return avail.find((p) => p.id === remembered)?.id ?? avail.find((p) => p.signedIn)?.id ?? avail[0]?.id ?? null;
}

/** The paste field a provider's sign-in asks for after its page (contract §5.2, §5.3; the mock asks for none). Pure. */
export function pasteFieldOf(provider, signin) {
  const said = signin?.step?.paste?.field ?? (signin?.step?.kind === 'paste' ? signin.step.field : null);
  if (said) return said === 'redirect_url' ? 'redirect_url' : 'code';
  if (provider === 'claude') return 'code';
  if (provider === 'chatgpt') return 'redirect_url';
  return null;
}

/** A SignInState from an `hx signin` push ({ provider, state, signIn? }: the agent lane sends the state word and the
 *  whole SignInState as `signIn`; `state` may also be the object itself). Pure. */
export function signInFromPush(msg) {
  if (!msg || typeof msg.provider !== 'string') return null;
  if (msg.signIn && typeof msg.signIn === 'object' && typeof msg.signIn.state === 'string') return { ...msg.signIn, provider: msg.provider };
  const s = msg.state;
  if (s && typeof s === 'object' && typeof s.state === 'string') return { provider: msg.provider, ...s };
  if (typeof s === 'string') return { provider: msg.provider, state: s };
  return null;
}

/** The progress notes' codes the agent lane sends (`progress[i].code`; `note` itself stays English). */
export const NOTE_CODES = Object.freeze(['wait', 'request', 'guide', 'catalog', 'read', 'write', 'summary', 'validate', 'preview', 'full', 'fix',
  'stage', 'ready', 'applying', 'applied']);

/**
 * The last few progress notes as { key } (a known code: the catalog's words) or { text } (English, shown only to an
 * English page), the same line never twice in a row. Pure.
 */
export function noteRows(job, lang = 'en', max = 3) {
  const out = [];
  for (const p of Array.isArray(job?.progress) ? job.progress : []) {
    if (!p || typeof p !== 'object') continue;
    const row = NOTE_CODES.includes(p.code) ? { key: `harness.note.${p.code}` } : lang === 'en' && p.note ? { text: String(p.note) } : null;
    if (!row) continue;
    const prev = out.at(-1);
    if (prev && prev.key === row.key && prev.text === row.text) continue;
    out.push(row);
  }
  return out.slice(-max);
}
