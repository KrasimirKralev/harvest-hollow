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
//   appliedLine(msg, me, names, lang, { level, later }) / undoneLine(msg, me, names)   the toasts every farmer sees
//   usableAt(thing, level)                the farm can use it now (its unlock at or below the level): "Show me"
//   prefsKey(scope) / lettersKey(scope) / pausedKey(scope)   this device's helper storage, per farm in multi mode
//   pickText({ en, bg }, lang)            a two-language text in the language, else English

import { chipsAt } from '../../../../shared/mod/examples.js';

export const STEPS = Object.freeze(['reading', 'building', 'testing', 'ready']);
/** A job the helper is busy with (the pill shows a step). */
export const ACTIVE = new Set(['starting', 'working', 'validating', 'fixing', 'revising', 'applying']);
/** A job that is the farm's current one (the contract: one per farm until it ends). */
export const OPEN = new Set([...ACTIVE, 'ready']);
export const ENDED = new Set(['applied', 'discarded', 'expired', 'failed', 'cancelled', 'answered']);
/** Ended jobs that stay shown until their farmer says OK (a failure, Harvey's answer: release 1.0 H1). */
export const KEPT = new Set(['failed', 'answered']);

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
 * tone: 'work' | 'signin' | 'ready' | 'fail' | 'answered' (mine) or 'partner' | 'partnerReady'. Pure.
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
  if (job.state === 'answered') return { mine, tone: 'answered', step: 'ready', key: 'harness.pill.answered' };
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
export const SEASON_IDS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
export const TUNING_KNOBS = Object.freeze(['growTimeBp', 'treeCycleBp', 'craftTimeBp', 'animalCycleBp']);
export const SKY_IDS = Object.freeze(['default', 'golden', 'pastel', 'cool', 'stormy']);
const TIMED = { crops: 'grow', trees: 'grow', recipes: 'make', animals: 'time', decor: 'time' };
const MIN = 60_000;
const isNum = (v) => Number.isFinite(v) && v >= 0;
/** An icon path we may show: a path of this site (the view routes /assets/ through assetUrl), never a full URL. */
const iconOf = (v) => (typeof v === 'string' && /^\/[\w./?=&%-]+$/.test(v) && !v.startsWith('//') ? v : null);
const textOf = (v, lang) => pickText(v, lang);

/**
 * The change list (Change[] of a job's result, or of a history version; server shared/mod/diff.js changeRows): one row
 * per thing, the numbers as facts the view words ({ key, n?, ms?, params?, warn? }). Release 1.0 (H3): every row kind
 * (content, a speed knob, a crop tuned on its own, the sky, the music, a letter), the cost of a decoration apart from
 * a price, what an animal or a tree gives, a recipe's workshop and inputs, a crop's season, and "From level 33 (your farm
 * is 21)" in a warning tone when a thing unlocks above the farm. `ctx`: { level, season, sellBp } of the farm (each may
 * be missing; sellBp: the upgraded Market Stand's bonus, so a price is the Market's own: QA r3 H3-07). Unknown
 * ops/families still get a row (the server may know more than this client). Pure.
 */
export function changeRows(changes, lang = 'en', ctx = {}) {
  if (!Array.isArray(changes)) return [];
  const level = Number.isInteger(ctx.level) ? ctx.level : null;
  // QA r3 H3-07: a price as the Market Stand pays it on this farm (the upgraded stand's sellBp, as shared/rules/economy.js
  // unitPrice: floor(n × (10000 + bp) / 10000)); a season or the day's Demand is never promised
  const standBp = Number.isSafeInteger(ctx.sellBp) && ctx.sellBp > 0 ? ctx.sellBp : 0;
  const price = (v) => (standBp ? Math.floor((v * (10_000 + standBp)) / 10_000) : v);
  return changes.filter((c) => c && typeof c === 'object').map((c) => {
    const n = c.numbers && typeof c.numbers === 'object' ? c.numbers : {};
    const info = c.info && typeof c.info === 'object' ? c.info : {};
    const facts = [];
    const family = FAMILIES.includes(c.family) ? c.family : null;
    let kind = 'thing';
    let title = null;
    const unlockFact = () => {
      if (!isNum(n.unlock) || n.unlock <= 1) return;
      if (level !== null && n.unlock > level) facts.push({ key: 'harness.fact.later', params: { n: n.unlock, level }, warn: true });
      else facts.push({ key: 'harness.fact.unlock', n: n.unlock });
    };
    if (family === 'tuning') {
      kind = 'tuning';
      const knob = TUNING_KNOBS.includes(c.knob ?? c.id) ? (c.knob ?? c.id) : null;
      const bp = Number.isFinite(c.bp) ? c.bp : 10_000;
      const pct = Math.round(Math.abs(10_000 - bp) / 100);
      title = knob ? { key: `harness.tune.${knob}.${bp < 10_000 ? 'faster' : bp > 10_000 ? 'slower' : 'normal'}`, pct } : null;
    } else if (family === 'look' && c.id === 'sky') {
      kind = 'sky';
      title = { key: 'harness.look.sky', sky: SKY_IDS.includes(c.sky) ? c.sky : 'default' };
    } else if (family === 'look' && c.id === 'music') {
      kind = 'music';
      const tracks = (Array.isArray(c.tracks) ? c.tracks : []).map((x) => String(x?.title ?? x?.id ?? '')).filter(Boolean);
      title = tracks.length ? { key: 'harness.look.music', tracks } : { key: 'harness.look.musicNormal' };
    } else if (family === 'text') {
      kind = 'letter';
      if (typeof c.from === 'string') facts.push({ key: 'harness.letter.row', from: c.from });
    } else if (c.tuned && family === 'crops') {
      kind = 'tuned';
      if (isNum(n.from) && isNum(n.minutes)) facts.push({ key: 'harness.fact.growFromTo', from: n.from * MIN, to: n.minutes * MIN });
      unlockFact();
    } else if (c.op !== 'retire') {
      if (family === 'recipes' && info.building && typeof info.building.id === 'string') {
        facts.push({ key: 'harness.fact.workshop', building: info.building.id, name: textOf(info.building.name, lang) });
      }
      if (family === 'recipes' && Array.isArray(info.inputs) && info.inputs.length) {
        facts.push({ key: 'harness.fact.inputs', inputs: info.inputs.filter((x) => x && typeof x.id === 'string')
          .map((x) => ({ id: x.id, n: Number(x.n) || 1, name: textOf(x.name, lang) || x.id })) });
      }
      if ((family === 'animals' || family === 'trees') && info.product && isNum(n.minutes) && n.minutes > 0) {
        facts.push({ key: 'harness.fact.gives', n: isNum(n.sell) ? price(n.sell) : 0, ms: n.minutes * MIN, product: textOf(info.product.name, lang) || info.product.id });
      } else if (family !== 'decor' && isNum(n.sell)) facts.push({ key: 'harness.fact.sell', n: price(n.sell) });
      if (isNum(n.cost)) facts.push({ key: 'harness.fact.cost', n: n.cost });
      if (isNum(n.seed)) facts.push({ key: 'harness.fact.seed', n: n.seed });
      if (isNum(n.xp) && n.xp > 0) facts.push({ key: 'harness.fact.xp', n: n.xp });
      if (family !== 'animals' && family !== 'trees' && isNum(n.minutes) && n.minutes > 0) facts.push({ key: `harness.fact.${TIMED[family] ?? 'time'}`, ms: n.minutes * MIN });
      if (family === 'crops' && isNum(n.yield) && n.yield > 0) facts.push({ key: 'harness.fact.yield', n: n.yield });
      if (family === 'crops' && SEASON_IDS.includes(info.season)) {
        const now = SEASON_IDS.includes(ctx.season) ? ctx.season : null;
        facts.push(now === info.season ? { key: 'harness.fact.seasonNow', season: info.season } : { key: 'harness.fact.season', season: info.season, now });
      }
      unlockFact();
    }
    return {
      op: OPS.includes(c.op) ? c.op : 'change',
      family,
      kind,
      id: String(c.id ?? ''),
      name: textOf(c.name, lang) || String(c.id ?? ''),
      title,
      icon: iconOf(c.icon),
      facts,
      warn: facts.some((f) => f.warn),
    };
  });
}

/**
 * The one chip row under the box (release 1.0, critique#37): at most `max` chips, Harvey's own suggestions from his last
 * answer first ({ text }), then the examples usable at the farm's level ({ id, key }: the view says t(key)). Pure.
 */
export function chips({ level = null, lang = 'en', answer = null, max = 3, asked = null, textOf = null } = {}) {
  const out = [];
  for (const x of Array.isArray(answer?.try) ? answer.try : []) {
    const text = pickText(x, lang).trim();
    if (text && !out.some((c) => c.text === text)) out.push({ text });
  }
  for (const id of chipsAt(level, max + 3)) out.push({ id, key: `harness.chip.${id}` });
  // QA r1 H-15: never suggest the wish just asked ("Розова ограда" right after "Розова ограда"): a chip equal to the
  // last wish, or inside it, is left out (`textOf(key)` gives an example chip's words)
  const a = normWish(asked);
  const fresh = (c) => {
    if (!a) return true;
    const x = normWish(c.text ?? (typeof textOf === 'function' ? textOf(c.key) : ''));
    return !x || !(a === x || a.includes(x));
  };
  return out.filter(fresh).slice(0, max);
}
/** A wish in a form two wishes compare in: lower case, letters and digits only. Pure. */
const normWish = (s) => String(s ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The provider to start a sign-in with, by itself: the only one this server offers, else null (H4: never a choice
 *  the player did not make). Pure. */
export function onlyProvider(providers) {
  const avail = (Array.isArray(providers) ? providers : []).filter((p) => p && p.id && p.available !== false);
  return avail.length === 1 ? avail[0].id : null;
}

/** The names of the things a change list adds or brings back (the applied toast; "Show me"). Pure. */
export function addedNames(changes, lang = 'en') {
  return changeRows(changes, lang).filter((r) => r.kind === 'thing' && (r.op === 'add' || r.op === 'revive')).map((r) => r.name);
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
  'NAME_TOO_LONG', 'COLOUR_FAR',
  // REST answers
  'AUTH', 'BUSY', 'SIGN_IN', 'RATE', 'BAD_ARGS', 'UNAVAILABLE', 'NOT_READY', 'STALE', 'NOT_YOURS', 'NOT_FOUND', 'LIMIT', 'ORIGIN',
  // release 1.0: a mod that changes nothing (H1), a stored version's removed knob (M24, a warning)
  'NO_CHANGE', 'IGNORED',
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
// inside a Bulgarian sentence a name is lower case ("добави лунен пъпеш"); English keeps its Title Case
const inSentence = (s, lang) => (lang === 'bg' && s ? s[0].toLocaleLowerCase('bg') + s.slice(1) : s);
const atStart = (s, lang) => (lang === 'bg' && s ? s[0].toLocaleUpperCase('bg') + s.slice(1) : s);

export function appliedLine(msg, me, players, lang = 'en', { level = null, later = null } = {}) {
  // a thing from a later level carries its level in the sentence (QA r2 H2-03: "Moon Melon (from level 14)"), where a
  // "Show me" would have shown an empty Market tab
  const things = (Array.isArray(msg?.names) ? msg.names : []).map((x) => {
    const name = inSentence(pickText(x, lang), lang);
    return name && later && !usableAt(x, level) ? later(name, x.unlock) : name;
  }).filter(Boolean);
  const mine = Boolean(me) && msg?.by === me;
  const name = mine ? null : nameOf(players, msg?.by);
  const title = pickText(msg?.title, lang);
  const who = mine ? 'mine' : name ? 'by' : 'someone';
  if (things.length) return { key: APPLIED_KEYS[who], params: { things, name } };
  return { key: APPLIED_TITLE_KEYS[who], params: { title: title || '', name } };
}

/** A thing the farm can use at `level` (no unlock, or one at or below it; an unknown level counts as usable). Pure. */
export const usableAt = (x, level) => !(Number.isInteger(x?.unlock) && Number.isInteger(level) && x.unlock > level);

/**
 * The undo toast of `hx undone` ({ by, n, to, names? }): what left the shop when the push names it (harvey#17: "Moon Melon
 * and Melon Pie left the shop; what you have keeps working"), else who undid a change. Pure.
 */
export function undoneLine(msg, me, players, lang = 'en') {
  const mine = Boolean(me) && msg?.by === me;
  const name = mine ? null : nameOf(players, msg?.by);
  const by = name ? 'By' : '';
  // "Bring back {title}" (QA r1 H-04): the undone change came back; never worded as another undo. What it took out of the
  // shop is said too (QA r4 H4-04: "“Sweet Autumn” is back on the farm." while the Caramel Lantern left)
  if (msg?.revive) {
    const title = pickText(msg.title, lang) || '';
    const back = thingNames(msg.back, lang);
    const gone = thingNames(msg.names, lang);
    const also = gone.length ? { key: `harness.undone.${number(msg.names, lang)}`, params: { things: [atStart(gone[0], lang), ...gone.slice(1)] } } : null;
    if (back.length) return { key: `harness.revived.${number(msg.back, lang)}${by}`, params: { name, title, things: back }, ...(also ? { also } : {}) };
    return { key: `harness.revived.title${by}`, params: { name, title }, ...(also ? { also } : {}) };
  }
  const things = thingNames(msg?.names, lang);
  // QA r3 H3-05: what came back into the shop is said too ("Caramel Apples is in the shop again"), never only "You undid
  // one of Harvey's changes" while the farmer watches a thing return
  const back = thingNames(msg?.back, lang);
  const backLine = back.length ? { key: `harness.undone.back.${number(msg.back, lang)}`, params: { things: [atStart(back[0], lang), ...back.slice(1)] } } : null;
  // "{things} вече не се продават" opens the sentence; "{name} върна назад промяна: {things} …" does not
  if (things.length && !name) things[0] = atStart(things[0], lang);
  // one thing has its own words (QA r1 H-12: "Ламата вече не се продава", never a plural verb on one llama)
  if (things.length) return { key: `harness.undone.${number(msg.names, lang)}${by}`, params: { name, things }, ...(backLine ? { also: backLine } : {}) };
  if (backLine) {
    if (by) return { key: `harness.undone.back.${number(msg.back, lang)}By`, params: { name, things: back } };
    return backLine;
  }
  return { key: mine ? 'harness.undone.mine' : name ? 'harness.undone.by' : 'harness.undone.someone', params: { name } };
}

/**
 * What an undo, a bring-back or a go-back would do in the shop, for its confirm (QA r4 H4-04: the bring-back confirm
 * never said that a thing would leave): `eff` = { left, back } of History (server/mods/index.js planOf), each a list of
 * names as the undo push carries them. [{ key, params: { things } }], what leaves first; [] when nothing in the shop
 * moves (a look, a speed) or the server did not say. Pure.
 */
export function effectLines(eff, lang = 'en') {
  const out = [];
  for (const [part, list0] of [['left', eff?.left], ['back', eff?.back]]) {
    const names = thingNames(list0, lang);
    if (names.length) out.push({ key: `harness.hist.effect.${part}.${number(list0, lang)}`, params: { things: [atStart(names[0], lang), ...names.slice(1)] } });
  }
  return out;
}

/**
 * 'thing' or 'things': the number of the verb for a list of names. One thing whose Bulgarian name is a plural noun
 * ("карамелени ябълки", g: 'pl') takes the plural verb in Bulgarian ("отново се продават"). Pure.
 */
function number(list, lang) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (arr.length !== 1) return 'things';
  return lang === 'bg' && arr[0]?.g === 'pl' ? 'things' : 'thing';
}

/**
 * The names of an undo or bring-back push, as they stand inside a sentence; in Bulgarian one thing takes its definite
 * form when the push carries it ("ламата", `bgDef`), several stay bare ("лунен пъпеш и пай с пъпеш"). Pure.
 */
function thingNames(list, lang) {
  const arr = Array.isArray(list) ? list : [];
  const one = arr.length === 1;
  return arr.map((x) => inSentence(lang === 'bg' && one && typeof x?.bgDef === 'string' && x.bgDef ? x.bgDef : pickText(x, lang), lang)).filter(Boolean);
}

/** This device's helper settings (provider, model), per farm in multi mode (net/farm.js scope). Pure. */
export const prefsKey = (scope) => (scope && scope.multi && scope.id ? `hh.f.${scope.id}.harness` : 'hh.harness');
/** The letters each farmer has seen on this device (contract §1.8). Pure. */
/** The paused versions each farmer on this device was told about (QA r2 H2-02), per farm in multi mode. */
export const pausedKey = (scope) => (scope && scope.multi && scope.id ? `hh.f.${scope.id}.harness.paused` : 'hh.harness.paused');
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
  'stage', 'ready', 'applying', 'applied', 'answered']);

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
