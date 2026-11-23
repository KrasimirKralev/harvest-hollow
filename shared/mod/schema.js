// Stage 1 of the mod validation (contract §3): shape only, no game knowledge beyond format.js. File paths, JSON, sizes,
// counts, required / unknown fields, types, ids (prefix, uniqueness inside the mod and against the farm's graveyard),
// ladders, enums, hex colours, text characters and lengths. Fast (< 50 ms) and pure.
//
//   checkFiles(files, { graveyard? }) -> Problem[]      files = { 'mod.json': obj | jsonText, 'content/crops/x_a.json': ... }
//   parseFiles(files) -> { files: { path: parsed }, problems }   JSON text values parsed (BAD_JSON otherwise)
//   textProblems(lang, kind, s) -> string | null       why a text is refused (also used by the compiler)
//   utf8Len(s)
// Problem = { stage: 'schema', code, file, path, message, hint? }
import {
  FORMAT, ID_RE, ID_PREFIX, LIMITS, LADDERS, VALUE_BP, FILE_KINDS, SINGLE_FILES, SEASONS, CROP_CLASSES, YIELDS,
  UNLOCK_RANGE, SKIES, LETTER_FROM, TUNING_BP, TUNING_KEYS, REMOVED, parseContentPath,
} from './format.js';

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isSafeInteger(v);

/** UTF-8 byte length of a string (no TextEncoder: shared/ runs everywhere). */
export function utf8Len(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}

// Allowed characters (contract §1.3). Letters: Latin for English (accents allowed), Cyrillic for Bulgarian (Latin only
// inside a brand, so it is allowed but never alone); digits, space, - ' ’ , . ! ? : ; ( ) and the spaced en dash;
// Bulgarian quotes „…“ in Bulgarian, curly quotes “…” in English. Bodies may hold line breaks.
// release 1.0: U+2011 (the no-break hyphen Bulgarian writes in "по‑бързо", copy#18) is allowed too
const EN_CHARS = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 \-\u2011'’,.!?:;()–“”\n]*$/u;
const BG_CHARS = /^[Ѐ-ӿA-Za-z0-9 \-\u2011'’,.!?:;()–„“\n]*$/u;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * Why a text is refused, or null. kind: 'name' | 'title' | 'desc' | 'body' | 'tip' | 'form'.
 */
export function textProblems(lang, kind, s) {
  if (typeof s !== 'string') return 'must be text';
  const max = { name: LIMITS.nameMax, form: LIMITS.nameMax + 16, title: LIMITS.titleMax, desc: LIMITS.descMax,
    body: LIMITS.letterBodyMax, tip: LIMITS.tipMax }[kind] ?? LIMITS.descMax;
  const min = kind === 'name' ? LIMITS.nameMin : 1;
  if (s.length < min || s.length > max) return `must be ${min}-${max} characters`;
  if (s !== s.trim() || /  /.test(s)) return 'no leading, trailing or double spaces';
  if (kind !== 'body' && s.includes('\n')) return 'one line only';
  if (!(lang === 'bg' ? BG_CHARS : EN_CHARS).test(s)) {
    return lang === 'bg' ? 'only Bulgarian letters, digits, spaces and - \' , . ! ? : ; ( ) – „“'
      : 'only letters, digits, spaces and - \' , . ! ? : ; ( ) – “”';
  }
  if (/:\/\/|www\.|\.(com|org|net|bg|io)\b/i.test(s)) return 'no links';
  if (/\bXP\b|\bLv\b/.test(s)) return 'never "XP" or "Lv" (say experience / level)';
  if (/–/.test(s) && !/ – /.test(s)) return 'the dash is " – " with spaces';
  if (lang === 'bg' && !/[Ѐ-ӿ]/.test(s)) return 'Bulgarian text needs Bulgarian words';
  if (kind === 'name' && lang === 'en') {
    const words = s.split(' ');
    const bad = words.some((w, i) => /^[a-z]/.test(w) && (i === 0 || !SMALL_WORDS.has(w)));
    if (bad) return 'English names are in Title Case ("Moon Melon")';
  }
  if (kind === 'name' && lang === 'bg' && /^[а-яё]/u.test(s)) return 'Bulgarian names start with a capital letter';
  return null;
}

/** Parse JSON text values; { files: { path: value }, problems }. */
export function parseFiles(files) {
  const out = {};
  const problems = [];
  for (const [p, v] of Object.entries(files ?? {})) {
    if (typeof v === 'string') {
      try { out[p] = JSON.parse(v); } catch (err) {
        problems.push(P('BAD_JSON', p, '', `not valid JSON: ${String(err && err.message).slice(0, 120)}`,
          'write one JSON object (letters and tips: one array)'));
      }
    } else out[p] = v;
  }
  return { files: out, problems };
}

function P(code, file, path, message, hint) {
  const p = { stage: 'schema', code, file, path, message };
  if (hint) p.hint = hint;
  return p;
}

/** A tiny field checker bound to one file. */
function checker(file, problems) {
  const add = (code, path, message, hint) => problems.push(P(code, file, path, message, hint));
  const fields = (obj, path, required, optional = []) => {
    if (!isObj(obj)) { add('BAD_TYPE', path, 'must be an object'); return false; }
    for (const k of required) if (!Object.hasOwn(obj, k)) add('MISSING_FIELD', join(path, k), `"${k}" is required`);
    const known = new Set([...required, ...optional]);
    for (const k of Object.keys(obj)) {
      if (!known.has(k)) add('UNKNOWN_FIELD', join(path, k), `"${k}" is not a field here`, `allowed: ${[...known].join(', ')}`);
    }
    return true;
  };
  const enumOf = (v, path, list) => {
    if (v === undefined) return;
    if (!list.includes(v)) add('BAD_ENUM', path, `must be one of ${list.join(', ')}`);
  };
  const ladder = (v, path, list) => {
    if (v === undefined) return;
    if (!isInt(v)) add('BAD_TYPE', path, 'must be a whole number');
    else if (!list.includes(v)) add('NOT_LADDER', path, `${v} is not on the ladder`, `pick one of ${list.join(' ')}`);
  };
  const int = (v, path, lo, hi) => {
    if (v === undefined) return;
    if (!isInt(v)) add('BAD_TYPE', path, 'must be a whole number');
    else if (v < lo || v > hi) add('BAD_ENUM', path, `must be ${lo}-${hi}`);
  };
  const hex = (v, path) => {
    if (v === undefined) return;
    if (typeof v !== 'string' || !HEX_RE.test(v)) add('BAD_HEX', path, 'must be a colour #RRGGBB', 'like "#BFE3FF"');
  };
  const bool = (v, path) => { if (v !== undefined && typeof v !== 'boolean') add('BAD_TYPE', path, 'must be true or false'); };
  const str = (v, path) => {
    if (v === undefined) return false;
    if (typeof v !== 'string' || !v) { add('BAD_TYPE', path, 'must be text'); return false; }
    return true;
  };
  const text = (lang, kind, v, path) => {
    if (v === undefined) return;
    const why = textProblems(lang, kind, v);
    if (why) add(why === 'must be text' ? 'BAD_TYPE' : 'BAD_TEXT', path, why);
  };
  return { add, fields, enumOf, ladder, int, hex, bool, str, text };
}

const join = (a, b) => (a ? `${a}.${b}` : b);

const BG_REQUIRED = ['name', 'g', 'pl', 'def', 'plDef'];
const BG_OPTIONAL = ['count', 'defObj', 'short', 'lc', 'unit', 'desc'];

/** The `text` block of a content thing (contract §1.3). */
function checkText(c, t, path, { desc = true } = {}) {
  if (!c.fields(t, path, ['en', 'bg'])) return;
  if (c.fields(t.en, join(path, 'en'), ['name'], desc ? ['desc', 'pl'] : ['pl'])) {
    c.text('en', 'name', t.en.name, join(path, 'en.name'));
    if (desc) c.text('en', 'desc', t.en.desc, join(path, 'en.desc'));
    c.text('en', 'form', t.en.pl, join(path, 'en.pl'));
  }
  const bg = t.bg;
  if (c.fields(bg, join(path, 'bg'), BG_REQUIRED, desc ? BG_OPTIONAL : BG_OPTIONAL.filter((k) => k !== 'desc'))) {
    c.text('bg', 'name', bg.name, join(path, 'bg.name'));
    c.enumOf(bg.g, join(path, 'bg.g'), ['m', 'f', 'n', 'pl']);
    for (const k of ['pl', 'def', 'plDef', 'count', 'defObj', 'short', 'lc']) c.text('bg', 'form', bg[k], join(path, `bg.${k}`));
    if (bg.g === 'm') {
      for (const k of ['count', 'defObj']) {
        if (bg[k] === undefined) c.add('MISSING_FIELD', join(path, `bg.${k}`), `a masculine name needs "${k}"`,
          k === 'count' ? 'the form after a number: "3 лунни пъпеша"' : 'the object form: "лунния пъпеш"');
      }
    }
    if (bg.unit !== undefined) {
      if (!Array.isArray(bg.unit) || bg.unit.length !== 2) c.add('BAD_TYPE', join(path, 'bg.unit'), 'must be [one, other]');
      else bg.unit.forEach((u, i) => c.text('bg', 'form', u, join(path, `bg.unit.${i}`)));
    }
    if (desc) c.text('bg', 'desc', bg.desc, join(path, 'bg.desc'));
  }
}

const COMMON = ['id', 'like', 'text'];
const FAMILY_FIELDS = {
  crops: { required: [...COMMON, 'growMin', 'yield', 'unlock', 'season', 'classes', 'hue'], optional: ['value', 'waterable'] },
  trees: { required: [...COMMON, 'cycleHours', 'unlock', 'hue', 'fruit'], optional: ['value', 'leaf'] },
  recipes: { required: [...COMMON, 'building', 'minutes', 'unlock', 'inputs', 'hue'], optional: ['value'] },
  animals: { required: [...COMMON, 'coat', 'product'], optional: ['value'] },
  decor: { required: [...COMMON, 'cost', 'hue'], optional: [] },
};

/** The ids a content file brings (the thing, and its item where it has its own). */
export function idsOf(family, d) {
  if (!isObj(d)) return [];
  const own = typeof d.id === 'string' ? [d.id] : [];
  if (family === 'trees' && isObj(d.fruit) && typeof d.fruit.id === 'string') own.push(d.fruit.id);
  if (family === 'animals' && isObj(d.product) && typeof d.product.id === 'string') own.push(d.product.id);
  return own;
}

function checkContent(c, family, d) {
  const spec = FAMILY_FIELDS[family];
  if (!c.fields(d, '', spec.required, spec.optional)) return;
  if (c.str(d.like, 'like') && !/^[a-z][a-z0-9_]{0,31}$/.test(d.like)) c.add('BAD_ID', 'like', 'not a content id');
  c.enumOf(d.value, 'value', Object.keys(VALUE_BP));
  if (d.text !== undefined) checkText(c, d.text, 'text', { desc: true });
  if (family === 'crops') {
    c.ladder(d.growMin, 'growMin', LADDERS.cropMin);
    if (d.yield !== undefined && !YIELDS.includes(d.yield)) c.add('BAD_ENUM', 'yield', 'must be 2 or 3');
    c.int(d.unlock, 'unlock', ...UNLOCK_RANGE);
    c.enumOf(d.season, 'season', SEASONS);
    if (d.classes !== undefined) {
      if (!Array.isArray(d.classes) || d.classes.length < LIMITS.classesMin || d.classes.length > LIMITS.classesMax
        || new Set(d.classes).size !== d.classes.length) {
        c.add('BAD_TYPE', 'classes', `must be ${LIMITS.classesMin}-${LIMITS.classesMax} different classes`);
      } else d.classes.forEach((k, i) => c.enumOf(k, `classes.${i}`, CROP_CLASSES));
    }
    c.hex(d.hue, 'hue');
    c.bool(d.waterable, 'waterable');
  } else if (family === 'trees') {
    c.ladder(d.cycleHours, 'cycleHours', LADDERS.treeHours);
    c.int(d.unlock, 'unlock', ...UNLOCK_RANGE);
    c.hex(d.hue, 'hue');
    c.hex(d.leaf, 'leaf');
    if (c.fields(d.fruit, 'fruit', ['id', 'text'])) {
      c.str(d.fruit.id, 'fruit.id');
      checkText(c, d.fruit.text, 'fruit.text', { desc: true });
    }
  } else if (family === 'recipes') {
    c.str(d.building, 'building');
    c.ladder(d.minutes, 'minutes', LADDERS.recipeMin);
    c.int(d.unlock, 'unlock', ...UNLOCK_RANGE);
    c.hex(d.hue, 'hue');
    if (d.inputs !== undefined) {
      const ent = isObj(d.inputs) ? Object.entries(d.inputs) : null;
      if (!ent || ent.length < LIMITS.inputsMin || ent.length > LIMITS.inputsMax) {
        c.add('BAD_TYPE', 'inputs', `must name ${LIMITS.inputsMin}-${LIMITS.inputsMax} items`, '{ "flour": 1, "x_moon_melon": 2 }');
      } else {
        for (const [k, q] of ent) {
          if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) c.add('BAD_ID', `inputs.${k}`, 'not an item id');
          c.int(q, `inputs.${k}`, 1, LIMITS.inputQtyMax);
        }
      }
    }
  } else if (family === 'animals') {
    c.hex(d.coat, 'coat');
    if (c.fields(d.product, 'product', ['id', 'text'], ['hue'])) {
      c.str(d.product.id, 'product.id');
      c.hex(d.product.hue, 'product.hue');
      checkText(c, d.product.text, 'product.text', { desc: true });
    }
  } else if (family === 'decor') {
    if (d.cost !== undefined && (!isInt(d.cost) || d.cost <= 0 || d.cost % 10 !== 0)) {
      c.add('BAD_TYPE', 'cost', 'must be a positive multiple of 10');
    }
    c.hex(d.hue, 'hue');
  }
}

function checkModJson(c, d) {
  if (!c.fields(d, '', ['format', 'title'])) return;
  if (d.format !== FORMAT) c.add('BAD_ENUM', 'format', `must be ${FORMAT}`);
  if (c.fields(d.title, 'title', ['en', 'bg'])) {
    c.text('en', 'title', d.title.en, 'title.en');
    c.text('bg', 'title', d.title.bg, 'title.bg');
  }
}

function checkTuning(c, d) {
  if (!isObj(d)) { c.add('BAD_TYPE', '', 'must be an object'); return; }
  for (const k of Object.keys(d)) {
    if (TUNING_KEYS.includes(k)) {
      const v = d[k];
      if (!isInt(v)) c.add('BAD_TYPE', k, 'must be a whole number of basis points');
      else if (v < TUNING_BP[0] || v > TUNING_BP[1]) {
        c.add('BAD_ENUM', k, `must be ${TUNING_BP[0]}-${TUNING_BP[1]}`, '9000 = 10 % faster, 11000 = 10 % slower');
      }
    } else if (k === 'crops') {
      if (!isObj(d.crops)) { c.add('BAD_TYPE', 'crops', 'must be an object'); continue; }
      for (const [id, t] of Object.entries(d.crops)) {
        if (!/^[a-z][a-z0-9_]{0,31}$/.test(id)) c.add('BAD_ID', `crops.${id}`, 'not a crop id');
        if (c.fields(t, `crops.${id}`, ['growMin'])) c.ladder(t.growMin, `crops.${id}.growMin`, LADDERS.cropMin);
      }
    } else {
      c.add('UNSUPPORTED', k, `"${k}" cannot be tuned in this format`,
        `tunable: ${TUNING_KEYS.join(', ')}, crops.<id>.growMin; events, weather, prices and NPCs are not`);
    }
  }
}

function checkLook(c, d) {
  if (!c.fields(d, '', [], ['palette', 'sky', 'music'])) return;
  // release 1.0 (H2): the palette changed nothing on screen; a stored version keeps compiling without it (removed.js)
  if (d.palette !== undefined) c.add('UNSUPPORTED', 'palette', 'colours of the farm cannot be changed in this format', REMOVED.palette.hint);
  c.enumOf(d.sky, 'sky', SKIES);
  if (d.music !== undefined && c.fields(d.music, 'music', ['prefer'])) {
    const p = d.music.prefer;
    if (!Array.isArray(p) || p.length < LIMITS.musicMin || p.length > LIMITS.musicMax
      || p.some((x) => typeof x !== 'string' || !x)) c.add('BAD_TYPE', 'music.prefer', `must list ${LIMITS.musicMin}-${LIMITS.musicMax} track ids`);
  }
}

function checkLetters(c, d) {
  if (!Array.isArray(d)) { c.add('BAD_TYPE', '', 'must be an array of letters'); return; }
  if (d.length > LIMITS.letters) c.add('TOO_MANY', '', `at most ${LIMITS.letters} letters`);
  d.forEach((l, i) => {
    const p = String(i);
    if (!c.fields(l, p, ['id', 'from', 'art', 'en', 'bg'])) return;
    if (typeof l.id !== 'string' || !ID_RE.test(l.id)) c.add('BAD_ID', `${p}.id`, `ids start with ${ID_PREFIX}`);
    c.enumOf(l.from, `${p}.from`, LETTER_FROM);
    c.str(l.art, `${p}.art`);
    for (const lang of ['en', 'bg']) {
      if (!c.fields(l[lang], `${p}.${lang}`, ['title', 'body'])) continue;
      c.text(lang, 'title', l[lang].title, `${p}.${lang}.title`);
      c.text(lang, 'body', l[lang].body, `${p}.${lang}.body`);
    }
  });
}

/**
 * Stage 1. `graveyard`: { id: { family } } of the farm (a retired id may come back only in its own family).
 * @returns {object[]} problems (empty = the shape is right)
 */
export function checkFiles(files, { graveyard = {} } = {}) {
  const problems = [];
  if (!isObj(files)) return [P('BAD_TYPE', '', '', 'no files')];
  // sizes first (on the text the agent wrote)
  let total = 0;
  let contentFiles = 0;
  for (const [p, v] of Object.entries(files)) {
    const n = utf8Len(typeof v === 'string' ? v : JSON.stringify(v) ?? '');
    total += n;
    if (n > LIMITS.fileBytes) problems.push(P('TOO_BIG', p, '', `${n} bytes; a file may have ${LIMITS.fileBytes}`));
    if (parseContentPath(p)) contentFiles++;
  }
  if (total > LIMITS.modBytes) problems.push(P('TOO_BIG', '', '', `the mod has ${total} bytes; at most ${LIMITS.modBytes}`));
  if (contentFiles > LIMITS.contentFiles) problems.push(P('TOO_MANY', '', '', `${contentFiles} content files; at most ${LIMITS.contentFiles}`));
  const { files: parsed, problems: parseProblems } = parseFiles(files);
  problems.push(...parseProblems);
  if (!Object.hasOwn(files, 'mod.json')) problems.push(P('MISSING_FIELD', 'mod.json', '', 'mod.json is required', '{ "format": 1, "title": { "en": "...", "bg": "..." } }'));
  const seen = new Map();               // id -> file
  for (const [p, d] of Object.entries(parsed)) {
    const c = checker(p, problems);
    const cp = parseContentPath(p);
    if (cp) {
      if (!ID_RE.test(cp.id)) c.add('UNKNOWN_FILE', '', `the file name must be <id>.json with an id starting ${ID_PREFIX}`);
      if (isObj(d) && d.id !== undefined && d.id !== cp.id) c.add('BAD_ID', 'id', `the id must equal the file name (${cp.id})`);
      checkContent(c, cp.family, d);
      for (const id of idsOf(cp.family, d)) {
        const path = id === d.id ? 'id' : cp.family === 'trees' ? 'fruit.id' : 'product.id';
        if (typeof id !== 'string' || !ID_RE.test(id)) {
          c.add('BAD_ID', path, `"${id}" is not a new id`, `${ID_PREFIX} then lowercase letters, digits and _ (32 at most)`);
          continue;
        }
        if (seen.has(id)) c.add('ID_TAKEN', path, `"${id}" is used twice (also in ${seen.get(id)})`);
        seen.set(id, p);
        const g = graveyard[id];
        const fam = id === d.id ? cp.family : 'items';
        if (g && g.family !== fam) c.add('ID_TAKEN', path, `"${id}" was a retired ${g.family} on this farm`, 'pick a new id');
      }
      continue;
    }
    if (p === REMOVED.tips.file) {
      // release 1.0 (H2): tips were never shown; a stored version keeps compiling without them (removed.js)
      c.add('UNSUPPORTED', '', 'tips cannot be added in this format', REMOVED.tips.hint);
      continue;
    }
    if (!SINGLE_FILES.includes(p)) {
      c.add('UNKNOWN_FILE', '', `"${p}" is not a mod file`, `files: ${SINGLE_FILES.join(', ')}, ${Object.values(FILE_KINDS).map((k) => `${k}/<id>.json`).join(', ')}`);
      continue;
    }
    if (p === 'mod.json') checkModJson(c, d);
    else if (p === 'tuning.json') checkTuning(c, d);
    else if (p === 'look.json') checkLook(c, d);
    else if (p === 'text/letters.json') checkLetters(c, d);
  }
  const fresh = [...seen.keys()].filter((id) => !graveyard[id]).length;
  if (fresh > LIMITS.liveDefs) problems.push(P('TOO_MANY', '', '', `${fresh} things; a farm may have ${LIMITS.liveDefs}`));
  return problems;
}
