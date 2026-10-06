// i18n engine (lane A, docs/agent-notes/i18n-core.md): the active language, the catalogs, t()/tn()/tNodes() and the
// locale formatters. No dependency, no DOM at import (node tests import it), no catalogs of its own: the game's entry
// (i18n/index.js) registers every area, the landing page registers only its own (i18n/multi.js, i18n/front.js; the way
// back's i18n/keep.js on demand), so the front door never downloads the game's text.
//
//   lang() -> 'en' | 'bg'                     the language in effect (English until a catalog has loaded)
//   setLang(l) -> Promise                     load l's catalogs (lazy: Bulgarian is fetched only when chosen), switch,
//                                             remember it on this device, set <html lang>, re-label [data-i18n] nodes and
//                                             tell every onLang listener (they re-render)
//   onLang(fn(lang)) -> off                   a language switch happened (after the new catalog is in)
//   ready() -> Promise                        the first language's catalogs are in (main.js awaits it before the UI)
//   loaded() -> Promise                       the same for every area registered since (a lazily imported module's)
//   register(area, en, bgLoader)              an area's English catalog and the loader of its Bulgarian one
//   registerData(name, bgLoader) / data(name) lazy non-catalog data per language (the content names table)
//
//   t(key, params?) -> string                 a whole sentence with named params: 'Sold {n} for {coins} coins'
//   tn(key, n, params?) -> string             the same with a count: the catalog value { one, other } is picked by
//                                             Intl.PluralRules(lang) and {n} is the formatted count
//   tNodes(key, params?) -> DocumentFragment  the same sentence with DOM nodes for Node-valued params (a player's name in
//                                             its own <span class="actor">), text for the rest
//   has(key) -> boolean
//   live(map) / liveRows(rows)                objects / [k, label] rows whose labels are catalog keys read at access time
//                                             (exported constants that must follow the language)
//
// Placeholders: {name} or {name:form}; {name:omit} renders nothing (a translation that drops a param on purpose: the
// parity test then knows it was not forgotten). A number param is formatted for the locale (47 219, 1,5); a content-name ref
// (i18n/names.js N(id) / Q(id, n)) renders in the asked form ({crop:def}, {crop:count}); a string takes :cap / :lc.
// A catalog value may be an object: { one, other } (plural, by params.n) or { m, f, n, pl, other } (gender, by
// params.$g, else by the gender of the first content-name ref in params), or { touch, other } (a line that names a key:
// its words for a finger, by params.$touch; see touchOf). The forms nest: { touch: { one, other }, other: { … } }.
//
// Formatters: fmtNum(n) (integers, like ui/dom.js fmt), fmtDec(n, digits), fmtShort(n), fmtDuration(ms, opts),
// fmtDate(ts, style | Intl options, tz?), fmtPct(n), list(items, 'and' | 'or'), ordinal(n, g).

export const LANGS = Object.freeze(['en', 'bg']);
/** Each language in its own words: the picker's labels, never translated. */
export const LANG_NAMES = Object.freeze({ en: 'English', bg: 'Български' });
/** Number and date locales per language (English keeps exactly the formats the game always had). */
const NUM_LOCALE = { en: 'en-US', bg: 'bg-BG' };
const DATE_LOCALE = { en: 'en-GB', bg: 'bg-BG' };
export const STORAGE_KEY = 'hh.lang';

const isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';

/**
 * The language a device starts in: the one it chose before, else the browser's own (`bg*` -> Bulgarian), else English.
 * Pure (tests): `stored` is the remembered value, `navLangs` navigator.languages.
 */
export function detectLang(stored, navLangs = []) {
  if (LANGS.includes(stored)) return stored;
  const first = (Array.isArray(navLangs) ? navLangs : [navLangs]).find((l) => typeof l === 'string' && l);
  return first && /^bg\b/i.test(first) ? 'bg' : 'en';
}

function readStored() {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null; } catch { return null; }
}
function writeStored(l) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, l); } catch { /* private window: this page only */ }
}
function navLangs() {
  const n = globalThis.navigator;
  if (!n) return [];
  return Array.isArray(n.languages) && n.languages.length ? n.languages : [n.language];
}

// node tests always run in English (Node has a navigator, and a developer's machine may say bg_BG)
let want = isBrowser ? detectLang(readStored(), navLangs()) : 'en';
let cur = 'en';

/** area -> { en, bg: null | object, load: () => Promise<module>, loading: Promise | null } */
const areas = new Map();
/** name -> { load, value: { [lang]: any }, loading } */
const datas = new Map();
const EN = Object.create(null);
let BG = Object.create(null);
const listeners = new Set();
const missing = new Set();

/** The language in effect. */
export const lang = () => cur;
/** The language a switch is on its way to (equals lang() once its catalogs are in). */
export const wantedLang = () => want;

function loadArea(a) {
  if (a.bg || !a.load) return Promise.resolve();
  if (!a.loading) {
    a.loading = Promise.resolve().then(a.load).then((m) => {
      a.bg = (m && (m.default ?? m.catalog)) || {};
      Object.assign(BG, a.bg);
    }).catch((err) => {
      a.loading = null;
      console.warn(`i18n: the Bulgarian catalog '${a.name}' did not load`, err);
    });
  }
  return a.loading;
}
function loadData(d) {
  if (d.value.bg !== undefined || !d.load) return Promise.resolve();
  if (!d.loading) {
    d.loading = Promise.resolve().then(d.load).then((m) => { d.value.bg = (m && (m.default ?? m)) || null; })
      .catch((err) => { d.loading = null; console.warn(`i18n: '${d.name}' did not load`, err); });
  }
  return d.loading;
}
function loadAll(l) {
  if (l === 'en') return Promise.resolve();
  return Promise.all([...[...areas.values()].map(loadArea), ...[...datas.values()].map(loadData)]);
}

let firstLoad = null;
/** The first language's catalogs are in (always resolves; a failed Bulgarian load falls back to English). */
export function ready() {
  if (!firstLoad) firstLoad = loadAll(want).then(() => { if (want === 'bg') switchTo('bg', { quiet: true }); });
  return firstLoad;
}

/**
 * Every area registered so far has its catalog in for the language in effect: a module imported on demand registers
 * its area late (the landing page's way back) and awaits this before its first words. Always resolves.
 */
export function loaded() {
  return ready().then(() => loadAll(want));
}

/** Register an area: its English catalog (the source) and the loader of its Bulgarian one. Idempotent per area. */
export function register(name, en, bgLoader) {
  if (areas.has(name)) return;
  for (const k of Object.keys(en || {})) {
    if (Object.hasOwn(EN, k)) console.warn(`i18n: key '${k}' is defined twice (area '${name}')`);
    EN[k] = en[k];
  }
  const a = { name, en, bg: null, load: bgLoader || null, loading: null };
  areas.set(name, a);
  // an area registered after the first load (a lazily imported panel) loads at once and re-renders when it lands
  if (want === 'bg' && firstLoad) loadArea(a).then(() => { if (cur === 'bg') emit(); });
}

/** Lazy per-language data that is not a catalog (the content names table): data(name) is null until loaded. */
export function registerData(name, bgLoader) {
  if (datas.has(name)) return;
  const d = { name, load: bgLoader, value: {}, loading: null };
  datas.set(name, d);
  if (want === 'bg' && firstLoad) loadData(d).then(() => { if (cur === 'bg') emit(); });
}
export function data(name) {
  const d = datas.get(name);
  return d ? d.value[cur] ?? null : null;
}

function emit() {
  for (const fn of [...listeners]) {
    try { fn(cur); } catch (err) { console.error('i18n: a language listener failed', err); }
  }
  if (isBrowser) {
    try { window.dispatchEvent(new CustomEvent('hh:lang', { detail: { lang: cur } })); } catch { /* old browser */ }
  }
}

function switchTo(l, { quiet = false } = {}) {
  cur = l;
  if (isBrowser) {
    document.documentElement.lang = l;
    applyStatic(document);
  }
  if (!quiet) emit();
}

/**
 * Switch the language: load its catalogs, remember it on this device and re-render. Resolves when the switch is done
 * (the same language again resolves at once).
 */
export async function setLang(l, { persist = true } = {}) {
  if (!LANGS.includes(l)) return cur;
  const from = cur;
  want = l;
  if (persist) writeStored(l);
  await (firstLoad || ready());
  await loadAll(l);
  if (want !== l) return cur;                      // a newer choice won meanwhile
  if (l === 'bg' && ![...areas.values()].some((a) => a.bg)) { want = cur; return cur; }   // offline: stay as we are
  if (cur !== l) switchTo(l);
  else if (from !== l) emit();                     // the first load switched quietly on its way: say so now
  return cur;
}

/** Call fn(lang) after every language switch. Returns the unsubscribe function. */
export function onLang(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// the loading screen's picker (index.html, an inline script) works before this module loads: it stores the choice and
// says so with an event, which this module turns into a real switch once it is here
if (isBrowser) {
  window.__hhLangLive = true;
  window.addEventListener('hh:pick-lang', (e) => { const l = e?.detail?.lang; if (LANGS.includes(l)) setLang(l); });
}

// ---- lookup and formatting ----------------------------------------------------------------------------------------
const PLURAL_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const GENDER_KEYS = ['m', 'f', 'n', 'pl'];
const pluralRules = new Map();
function pluralOfN(n) {
  let pr = pluralRules.get(cur);
  if (!pr) { pr = new Intl.PluralRules(cur); pluralRules.set(cur, pr); }
  return pr.select(Number(n) || 0);
}

/** The raw catalog value of a key in the language in effect (English when Bulgarian has none). */
export function raw(key) {
  if (cur !== 'en' && BG[key] !== undefined) return BG[key];
  if (EN[key] !== undefined) {
    if (cur !== 'en' && !missing.has(key)) missing.add(key);
    return EN[key];
  }
  return undefined;
}
export const has = (key) => raw(key) !== undefined;
/** Keys the Bulgarian catalog lacked this session (English was shown): the dev console's checklist. */
export const missingKeys = () => [...missing];

let refRender = null;
let refGender = null;
/** names.js plugs in how content-name refs render ({crop:def}) and which gender they carry. */
export function setRefRenderer(render, gender) { refRender = render; refGender = gender; }
const isRef = (v) => v && typeof v === 'object' && (Object.hasOwn(v, '$name') || Object.hasOwn(v, '$qty'));

function pick(v, params) {
  for (let i = 0; i < 4 && v && typeof v === 'object' && !Array.isArray(v); i++) {
    const keys = Object.keys(v);
    if (Object.hasOwn(v, 'touch')) {
      v = params && params.$touch ? v.touch : v.other;
    } else if (keys.some((k) => k === 'one' || k === 'few' || k === 'many')) {
      const n = params && (params.n ?? params.count);
      v = v[pluralOfN(n)] ?? v.other;
    } else if (keys.some((k) => GENDER_KEYS.includes(k))) {
      let g = params && params.$g;
      if (!g && params && refGender) {
        for (const p of Object.values(params)) if (isRef(p)) { g = refGender(p); break; }
      }
      v = v[g] ?? v.other ?? v.m ?? v[keys[0]];
    } else {
      v = v.other ?? v[keys[0]];
    }
  }
  return v;
}

function cap(s) { return s ? s[0].toLocaleUpperCase(cur) + s.slice(1) : s; }
function lc(s) { return s ? s[0].toLocaleLowerCase(cur) + s.slice(1) : s; }

/** One param as text, in the asked form ('omit': a translation that deliberately leaves a param out says so). */
function paramText(v, form) {
  if (v === null || v === undefined || form === 'omit') return '';
  if (isRef(v)) return refRender ? refRender(v, form) : String(v.$name ?? v.$qty);
  if (typeof v === 'number') return Number.isInteger(v) ? fmtNum(v) : fmtDec(v, 2);
  if (typeof v === 'object' && typeof v.textContent === 'string') return form === 'cap' ? cap(v.textContent) : v.textContent;
  const s = String(v);
  return form === 'cap' ? cap(s) : form === 'lc' ? lc(s) : s;
}

const PH = /\{([A-Za-z_$][\w$]*)(?::([\w-]+))?\}/g;

/** Fill the placeholders of a catalog string (unknown ones stay visible: a missing param must show, not vanish). */
export function format(str, params) {
  if (typeof str !== 'string' || !params) return typeof str === 'string' ? str : String(str ?? '');
  return str.replace(PH, (m, k, form) => (Object.hasOwn(params, k) ? paramText(params[k], form) : m));
}

/** A whole sentence by key, with named params. An unknown key shows itself (and English is the fallback per key). */
export function t(key, params) {
  const r = raw(key);
  const v = pick(r, params);
  if (v === undefined) return key;
  const out = format(v, params);
  remember(out, key, params);
  if (r && typeof r === 'object' && Object.hasOwn(r, 'touch') && !(params && params.$touch)) {
    touchTwin(out, format(pick(r, { ...params, $touch: true }), params));
  }
  return out;
}

// ---- touch variants -----------------------------------------------------------------------------------------------
// A line that names a key ("Затвори (Esc)") carries its words for a finger: { touch: 'Затвори', other: 'Затвори (Esc)' }.
// t() says `other` unless params.$touch, and remembers the pair, so ui/dom.js touchText(text, true) can swap a hint that
// was built earlier (a data-tip) for its touch words at the moment it shows, never by rewriting translated text. Content
// texts register theirs the same way (names.js ctext: a `touchText` next to a `text`, a `descTouch` next to a `desc`).
const TWINS_MAX = 400;
const twins = new Map();
/** Remember that `text` reads `touchText` to a touch player. */
export function touchTwin(text, touchText) {
  if (typeof text !== 'string' || typeof touchText !== 'string' || text === touchText) return;
  if (twins.has(text)) twins.delete(text);
  twins.set(text, touchText);
  if (twins.size > TWINS_MAX) twins.delete(twins.keys().next().value);
}
/** The touch words of a line a catalog (or a content text) gave touch words to, else undefined. */
export const touchOf = (text) => (typeof text === 'string' ? twins.get(text) : undefined);

// ---- saying a line again after a switch ---------------------------------------------------------------------------
// A toast, a notice or a banner already on screen outlives a language switch. t() and list() remember how they made
// their latest lines (a bounded map, newest last), so the shell can say such a line again in the new language without
// every caller handing it a function: retell(text) -> () => string, or null for a text they did not make (a chat line,
// a sentence glued together in code: those callers pass a function themselves).
const TOLD_MAX = 600;
const LIST = Symbol('list');
const told = new Map();
function remember(text, key, params) {
  if (told.has(text)) told.delete(text);
  told.set(text, [key, params]);
  if (told.size > TOLD_MAX) told.delete(told.keys().next().value);
}

/** A function that says `text` again in the language in effect, or null when t() / list() did not make it. Call it at
 * once (the memory is short); the function it returns keeps what it needs. */
export function retell(text, depth = 0) {
  if (typeof text !== 'string' || depth > 3) return null;
  const hit = told.get(text);
  if (!hit) return null;
  const [key, params] = hit;
  // a part that is itself a line ("{text}" in "{name} was here: {text}", "12 coins" in a list) is said again with it;
  // anything else (a farmer's name, a number already written out) stays as given
  const again = (v) => (typeof v === 'string' && v !== text ? retell(v, depth + 1) : null);
  if (key === LIST) {
    const [items, type] = params;
    const parts = items.map((v) => [v, again(v)]);
    return () => list(parts.map(([v, fn]) => (fn ? fn() : v)), type);
  }
  if (!params) return () => t(key);
  const ps = Object.entries(params).map(([k, v]) => [k, v, again(v)]);
  return () => t(key, Object.fromEntries(ps.map(([k, v, fn]) => [k, fn ? fn() : v])));
}

/** t() with a count: { one, other } picked by the language's plural rules; {n} is the formatted count. */
export function tn(key, n, params) {
  return t(key, { ...params, n });
}

/**
 * The same sentence as DOM: Node-valued params are inserted as they are (a farmer's name in its own span), the rest
 * as text. Needs a document.
 */
export function tNodes(key, params = {}) {
  const v = pick(raw(key), params);
  const str = v === undefined ? key : String(v);
  const frag = document.createDocumentFragment();
  let at = 0;
  PH.lastIndex = 0;
  for (let m = PH.exec(str); m; m = PH.exec(str)) {
    const [whole, k, form] = m;
    if (!Object.hasOwn(params, k)) continue;
    if (m.index > at) frag.append(str.slice(at, m.index));
    const p = params[k];
    frag.append(p && typeof p === 'object' && typeof p.nodeType === 'number' ? p : paramText(p, form));
    at = m.index + whole.length;
  }
  if (at < str.length) frag.append(str.slice(at));
  return frag;
}

/**
 * An object whose values are catalog keys, read at access time: `live({ title: 'settings.mood.title' })` reads
 * 'Title screen' in English and the Bulgarian line after a switch. For exported constants that tests and callers index.
 */
export function live(keys) {
  const o = {};
  for (const [k, key] of Object.entries(keys)) Object.defineProperty(o, k, { get: () => t(key), enumerable: true });
  return Object.freeze(o);
}
/**
 * An object of getters from an object of functions (nested plain objects too): exported text tables such as
 * GATE_TEXT = getters({ private: { title: () => t('multi.gate.private.title') } }) read the language at access time.
 */
export function getters(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'function') Object.defineProperty(out, k, { get: v, enumerable: true });
    else out[k] = v && typeof v === 'object' ? getters(v) : v;
  }
  return Object.freeze(out);
}
/** [[left, labelKey], ...] rows whose second column is read through t() at access time (the key lists). */
export function liveRows(rows) {
  return Object.freeze(rows.map(([left, key]) => {
    const row = [left, undefined];
    Object.defineProperty(row, 1, { get: () => t(key), enumerable: true });
    return Object.freeze(row);
  }));
}

/**
 * Re-label static markup: [data-i18n="key"] sets the text, [data-i18n-attr="aria-label:key; title:key"] attributes.
 * index.html's skeleton uses it; anything built in JS calls t() itself.
 */
export function applyStatic(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const k = el.getAttribute('data-i18n');
    if (has(k)) el.textContent = t(k);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
      const [attr, k] = pair.split(':').map((s) => s.trim());
      if (attr && k && has(k)) el.setAttribute(attr, t(k));
    }
  }
}

// ---- numbers ------------------------------------------------------------------------------------------------------
const nf = new Map();
function numFormat(digits) {
  const k = `${cur}:${digits}`;
  let f = nf.get(k);
  if (!f) { f = new Intl.NumberFormat(NUM_LOCALE[cur] ?? cur, { maximumFractionDigits: digits }); nf.set(k, f); }
  return f;
}
/** A whole number for the locale: 12,340 (English) / 12 340 (Bulgarian, a no-break space from five digits on). */
export const fmtNum = (n) => numFormat(0).format(Math.trunc(Number(n) || 0));
/** A number with up to `digits` decimals: 1.5 / 1,5. */
export const fmtDec = (n, digits = 1) => numFormat(digits).format(Number(n) || 0);
/** A percent: 10% / 10 % (a no-break space in Bulgarian). */
export const fmtPct = (n, digits = 0) => (cur === 'bg' ? `${fmtDec(n, digits)} %` : `${fmtDec(n, digits)}%`);

/**
 * A number short enough for a pill: English 12.3k / 1.2M (as always); Bulgarian shows the full grouped number up to
 * 999 999 ("12,3 хил." is wider than "12 345") and "1,2 млн." above.
 */
export function fmtShort(n) {
  const v = Math.trunc(Number(n) || 0);
  const a = Math.abs(v);
  if (cur === 'bg') {
    if (a < 1_000_000) return fmtNum(v);
    return `${fmtDec(v / 1_000_000, 1)} млн.`;
  }
  if (a < 10_000) return fmtNum(v);
  if (a < 1_000_000) return `${(v / 1000).toFixed(a < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

// ---- durations ----------------------------------------------------------------------------------------------------
// English is the game's own compact form; Bulgarian follows the glossary ("45 сек", "4 мин 10 сек", "2 ч 05 мин",
// "3 дни 4 ч"), a no-break space between a number and its unit so a line never ends on a bare number
const NB = ' ';
const UNITS = {
  en: { s: (n) => `${n}s`, m: (n) => `${n}m`, h: (n) => `${n}h`, d: (n) => `${n}d` },
  bg: { s: (n) => `${n}${NB}сек`, m: (n) => `${n}${NB}мин`, h: (n) => `${n}${NB}ч`, d: (n) => `${n}${NB}${n === 1 ? 'ден' : 'дни'}` },
};
/**
 * A duration: '2h 05m' | '4m 10s' | '12s' | '3d 4h' (English, as always) / '2 ч 05 мин' | '4 мин 10 сек' (Bulgarian).
 * Never negative. Options replace the English regexes callers used to run on the text (they cannot work on Bulgarian):
 *   trim: true          drop a zero second part ('2h', '4m', '3d')
 *   cut: '<units><op>'   drop the second part when its unit is one of <units> (h, m, s) and op holds: '<10' (a value
 *                        under ten), '=0' (zero) or nothing (always). 'ms<10' == the old .replace(/ 0\d?[ms]$/, ''),
 *                        's<10' == / 0\d?s$/, 's' == / \d+s$/, 'm=0' == / 00m$/
 */
export function fmtDuration(ms, { trim = false, cut = null } = {}) {
  const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const u = UNITS[cur] ?? UNITS.en;
  const pad = (n) => String(n).padStart(2, '0');
  const rule = typeof cut === 'string' ? /^([hms]+)(<10|=0)?$/.exec(cut) : null;
  const drops = (unit, v) => (trim && v === 0) || Boolean(rule && rule[1].includes(unit)
    && (rule[2] === '<10' ? v < 10 : rule[2] === '=0' ? v === 0 : true));
  const two = (a, unit, v, fmt2) => (drops(unit, v) ? a : `${a} ${fmt2}`);
  if (s < 60) return u.s(s);
  const m = Math.floor(s / 60);
  if (m < 60) return two(u.m(m), 's', s % 60, u.s(pad(s % 60)));
  const hrs = Math.floor(m / 60);
  if (hrs < 48) return two(u.h(hrs), 'm', m % 60, u.m(pad(m % 60)));
  return two(u.d(Math.floor(hrs / 24)), 'h', hrs % 24, u.h(hrs % 24));
}

// ---- dates --------------------------------------------------------------------------------------------------------
const DATE_STYLES = {
  long: { weekday: 'long', day: 'numeric', month: 'long' },
  short: { weekday: 'short', day: '2-digit', month: '2-digit' },
  day: { day: 'numeric', month: 'long' },
  weekday: { weekday: 'long' },
  weekdayShort: { weekday: 'short' },
  time: { hour: '2-digit', minute: '2-digit', hour12: false },
  dayTime: { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false },
};
const df = new Map();
/**
 * A date or time for people to read, in the language's locale (English keeps en-GB, the game's format so far):
 * style 'long' (неделя, 12 октомври), 'short' (нд, 12.10), 'day', 'weekday', 'weekdayShort', 'time' (20:00),
 * 'dayTime', or Intl options. `tz` is an IANA zone (the farm's), else the device's. Never for logic (calendar.js).
 */
export function fmtDate(ts, style = 'long', tz = undefined) {
  const opts = typeof style === 'string' ? DATE_STYLES[style] ?? DATE_STYLES.long : style;
  const k = `${cur}:${JSON.stringify(opts)}:${tz ?? ''}`;
  let f = df.get(k);
  if (!f) {
    try { f = new Intl.DateTimeFormat(DATE_LOCALE[cur] ?? cur, tz ? { ...opts, timeZone: tz } : opts); } catch { f = new Intl.DateTimeFormat(DATE_LOCALE[cur] ?? cur, opts); }
    df.set(k, f);
  }
  return f.format(new Date(Number(ts) || 0));
}

// ---- lists and ordinals -------------------------------------------------------------------------------------------
const lf = new Map();
/** "apples, pears and plums" / "ябълки, круши и сливи" ('or': "a, b or c" / "a, b или c"). */
export function list(items, type = 'and') {
  const arr = (items || []).filter((x) => x !== null && x !== undefined && x !== '').map(String);
  const k = `${cur}:${type}`;
  let f = lf.get(k);
  if (!f) { f = new Intl.ListFormat(cur === 'en' ? 'en' : cur, { type: type === 'or' ? 'disjunction' : 'conjunction', style: 'long' }); lf.set(k, f); }
  const out = f.format(arr);
  if (arr.length > 1) remember(out, LIST, [arr, type]);
  return out;
}

/**
 * An ordinal: English 1st / 2nd / 3rd / 11th / 21st; Bulgarian by the noun's gender g ('m' 1-ви 2-ри 7-ми 3-ти, 'f' 1-ва,
 * 'n' 1-во): "1-во място", "3-та поръчка", "2-ри ред". Pure for the language in effect.
 */
export function ordinal(n, g = 'm') {
  const v = Math.trunc(Number(n) || 0);
  const tens = Math.abs(v) % 100;
  const last = Math.abs(v) % 10;
  if (cur === 'bg') {
    const stem = tens >= 11 && tens <= 19 ? 'т' : last === 1 ? 'в' : last === 2 ? 'р' : last === 7 || last === 8 ? 'м' : 'т';
    const end = g === 'f' ? 'а' : g === 'n' ? 'о' : 'и';
    return `${v}-${stem}${end}`;
  }
  const suf = tens >= 11 && tens <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
  return `${v}${suf}`;
}

/** "+25" / "−10" (a real minus sign in Bulgarian). */
export function fmtSigned(n) {
  const v = Math.trunc(Number(n) || 0);
  if (v > 0) return `+${fmtNum(v)}`;
  if (v < 0) return `${cur === 'bg' ? '−' : '-'}${fmtNum(-v)}`;
  return fmtNum(0);
}

/** Test hook: switch synchronously with an already-loaded Bulgarian catalog object (node tests; never the game). */
export function __setForTest(l, bgCatalog = null) {
  if (bgCatalog) { BG = Object.assign(Object.create(null), bgCatalog); }
  want = l;
  cur = l;
  pluralRules.clear();
}
/** Test hook: load every registered Bulgarian area now (node tests import the files directly). */
export async function __loadForTest(l) {
  await loadAll(l);
  want = l;
  cur = l;
}
