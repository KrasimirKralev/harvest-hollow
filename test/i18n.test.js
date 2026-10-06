// i18n (lane A): the catalogs agree (every English key has a Bulgarian one and the same {params}), the engine picks
// plural and gender forms, the formatters follow the language, the content names give Bulgarian grammar, and English
// stays exactly what it was. The English-literal scanner is test/i18n.scan.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';
import BG_NAMES from '../public/js/i18n/bg/names.js';
import BG_TEXT from '../public/js/i18n/bg/text.js';
import { CONTENT, PLACEABLES, RELICS } from '../shared/content/index.js';

const PARAM = /\{([A-Za-z_$][\w$]*)(?::[\w-]+)?\}/g;
/** Every {param} name in a catalog value (all plural / gender variants together). */
function paramsOf(v) {
  const out = new Set();
  const walk = (x) => {
    if (typeof x === 'string') for (const m of x.matchAll(PARAM)) out.add(m[1]);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(v);
  return out;
}
const CORE_PREFIXES = ['err.', 'lang.', 'common.'];
const VARIANT_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other', 'm', 'f', 'n', 'pl', 'touch']);

const bgAreas = await Promise.all(AREAS.map(async ([area, en, load]) => [area, en, (await load()).default]));

test('every English key has a Bulgarian one and the other way round, with the same {params}', () => {
  const problems = [];
  for (const [area, en, bg] of bgAreas) {
    for (const k of Object.keys(en)) {
      if (!Object.hasOwn(bg, k)) { problems.push(`${area}: '${k}' has no Bulgarian`); continue; }
      const a = [...paramsOf(en[k])].sort().join(',');
      const b = [...paramsOf(bg[k])].sort().join(',');
      // a Bulgarian line may say the number in words ({n} unused), and English-only grammar params start with '_'
      // ({_a}: "a" / "an", {_s}: a plural s): Bulgarian leaves those out; anything else must match
      const core = (v) => [...paramsOf(v)].filter((p) => p !== 'n' && !p.startsWith('_')).sort().join(',');
      if (a !== b && core(en[k]) !== core(bg[k])) problems.push(`${area}: '${k}' params differ: en {${a}} bg {${b}}`);
      const extra = [...paramsOf(bg[k])].filter((p) => !paramsOf(en[k]).has(p));
      if (extra.length) problems.push(`${area}: '${k}' Bulgarian uses params English never passes: ${extra.join(', ')}`);
    }
    for (const k of Object.keys(bg)) if (!Object.hasOwn(en, k)) problems.push(`${area}: '${k}' is only in Bulgarian (stale?)`);
  }
  assert.deepEqual(problems, []);
});

test('keys are named after their area, are unique across areas, and every value is usable text', () => {
  const seen = new Map();
  for (const [area, en, bg] of bgAreas) {
    for (const k of Object.keys(en)) {
      assert.ok(k.startsWith(`${area}.`) || (area === 'core' && CORE_PREFIXES.some((p) => k.startsWith(p))), `'${k}' belongs to area '${area}': name it '${area}.…'`);
      assert.ok(!seen.has(k), `'${k}' is in both '${seen.get(k)}' and '${area}'`);
      seen.set(k, area);
    }
    for (const [k, v] of [...Object.entries(en), ...Object.entries(bg)]) {
      const check = (x) => {
        if (typeof x === 'string') { assert.ok(x.length > 0 && !/undefined|\[object/.test(x), `${k}: ${x}`); return; }
        assert.ok(x && typeof x === 'object' && Object.keys(x).length && Object.keys(x).every((vk) => VARIANT_KEYS.has(vk)), `${k}: a value is a string or { one, other } / { m, f, n } variants`);
        Object.values(x).forEach(check);
      };
      check(v);
    }
  }
});

test('Bulgarian text follows the glossary: no "XP", no "Lv", no English quotes or em dashes', () => {
  for (const [area, , bg] of bgAreas) {
    for (const [k, v] of Object.entries(bg)) {
      const all = typeof v === 'string' ? [v] : Object.values(v).flatMap((x) => (typeof x === 'string' ? [x] : Object.values(x)));
      for (const s of all) {
        assert.ok(!/\bXP\b/.test(s), `${area} ${k}: "опит", never XP: ${s}`);
        assert.ok(!/\bLv\b/.test(s), `${area} ${k}: "ниво", never Lv: ${s}`);
        assert.ok(!/—/.test(s), `${area} ${k}: an en dash with spaces, not an em dash: ${s}`);
        assert.ok(!/"[^"]+"/.test(s), `${area} ${k}: Bulgarian quotes „…“: ${s}`);
        assert.ok(!/\((?:а|а)\)|\/ка\b/.test(s), `${area} ${k}: no gender hacks about a player (owner decision 1): ${s}`);
      }
    }
  }
});

test('t / tn / tNodes: named params, plural and gender variants, numbers by locale; English is the fallback', async () => {
  I.__setForTest('en');
  assert.equal(I.t('err.NO_ACORNS'), 'Not enough Acorns.');
  assert.equal(I.tn('common.coins', 1), '1 coin');
  assert.equal(I.tn('common.coins', 12340), '12,340 coins');
  assert.equal(I.t('shell.peer.arrived', { name: 'Деси' }), 'Деси arrived 🌻');
  assert.equal(I.t('no.such.key'), 'no.such.key', 'an unknown key shows itself');
  assert.equal(I.format('{a} and {b}', { a: 'x' }), 'x and {b}', 'a missing param stays visible');
  assert.equal(I.format('{x:cap}', { x: 'морков' }), 'Морков');
  await I.__loadForTest('bg');
  try {
    assert.equal(I.lang(), 'bg');
    assert.equal(I.t('err.NO_ACORNS'), 'Нямаш достатъчно жълъди.');
    assert.equal(I.tn('common.acorns', 1), '1 жълъд');
    assert.equal(I.tn('common.acorns', 5), '5 жълъда', 'masculine count form');
    assert.equal(I.tn('common.coins', 21), '21 монети');
    assert.equal(I.tn('common.coins', 47219), '47 219 монети', 'a no-break space groups from five digits');
    assert.equal(I.tn('common.coins', 1234), '1234 монети');
    // gender variants follow a content-name ref
    const cat = { 'x.new': { m: 'Нов {b}!', f: 'Нова {b}!', n: 'Ново {b}!' } };
    I.__setForTest('bg', { ...Object.fromEntries(bgAreas.flatMap(([, , bg]) => Object.entries(bg))), ...cat });
    assert.equal(I.t('x.new', { b: I.N('beehive') }), 'Нов Кошер!');
    assert.equal(I.t('x.new', { b: I.N('pig_pen') }), 'Нова Кочина!');
    assert.equal(I.t('x.new', { b: I.N('duck_pond') }), 'Ново Патешко езерце!');
    assert.equal(I.t('x.new', { b: 'нещо', $g: 'n' }), 'Ново нещо!');
  } finally {
    I.__setForTest('en');
  }
});

test('formatters: numbers, short numbers, durations, dates, lists, ordinals and percents by language', async () => {
  I.__setForTest('en');
  assert.equal(I.fmtNum(47219), '47,219');
  assert.equal(I.fmtShort(12345), '12.3k');
  assert.equal(I.fmtShort(735457), '735k');
  assert.equal(I.fmtShort(1_234_567), '1.2M');
  assert.equal(I.fmtDuration(45_000), '45s');
  assert.equal(I.fmtDuration(250_000), '4m 10s');
  assert.equal(I.fmtDuration(7_500_000), '2h 05m');
  assert.equal(I.fmtDuration(76 * 3600_000), '3d 4h');
  assert.equal(I.fmtDuration(7_500_000, { cut: 'ms<10' }), '2h', "the old .replace(/ 0\\d?[ms]$/, '')");
  assert.equal(I.fmtDuration(7_260_000, { cut: 'm=0' }), '2h 01m');
  assert.equal(I.fmtDuration(7_200_000, { trim: true }), '2h');
  assert.equal(I.list(['apples', 'pears', 'plums']), 'apples, pears, and plums');
  assert.equal(I.ordinal(1), '1st');
  assert.equal(I.ordinal(12), '12th');
  assert.equal(I.ordinal(23), '23rd');
  assert.equal(I.fmtPct(10), '10%');
  const sunday = Date.UTC(2026, 9, 11, 18, 0);
  assert.equal(I.fmtDate(sunday, 'long', 'UTC'), 'Sunday 11 October');
  await I.__loadForTest('bg');
  try {
    assert.equal(I.fmtNum(47219), '47 219');
    assert.equal(I.fmtNum(1234), '1234');
    assert.equal(I.fmtDec(1.5), '1,5');
    assert.equal(I.fmtShort(735457), '735 457', 'Bulgarian pills show the full number up to 999 999');
    assert.equal(I.fmtShort(1_234_567), '1,2 млн.');
    assert.equal(I.fmtDuration(45_000), '45 сек');
    assert.equal(I.fmtDuration(250_000), '4 мин 10 сек');
    assert.equal(I.fmtDuration(8_100_000), '2 ч 15 мин');
    assert.equal(I.fmtDuration(7_500_000), '2 ч 05 мин');
    assert.equal(I.fmtDuration(76 * 3600_000), '3 дни 4 ч');
    assert.equal(I.fmtDuration(28 * 3600_000 + 24 * 3600_000), '2 дни 4 ч');
    assert.equal(I.fmtDuration(7_500_000, { cut: 'ms<10' }), '2 ч');
    assert.equal(I.t('common.in', { d: I.fmtDuration(180_000, { trim: true }) }), 'след 3 мин');
    assert.equal(I.list(['ябълки', 'круши', 'сливи']), 'ябълки, круши и сливи', 'no comma before "и"');
    assert.equal(I.list(['a', 'b'], 'or'), 'a или b');
    assert.equal(I.ordinal(1, 'n'), '1-во');
    assert.equal(I.ordinal(3, 'f'), '3-та');
    assert.equal(I.ordinal(2, 'm'), '2-ри');
    assert.equal(I.ordinal(7, 'm'), '7-ми');
    assert.equal(I.ordinal(11, 'm'), '11-ти');
    assert.equal(I.ordinal(21, 'f'), '21-ва');
    assert.equal(I.fmtPct(10), '10 %');
    assert.equal(I.fmtSigned(-10), '−10');
    assert.equal(I.fmtDate(sunday, 'long', 'UTC'), 'неделя, 11 октомври');
    assert.equal(I.fmtDate(sunday, 'short', 'UTC'), 'нд, 11.10');
    assert.equal(I.fmtDate(sunday, 'time', 'UTC'), '18:00');
  } finally {
    I.__setForTest('en');
  }
});

test('content names: Bulgarian forms, the count form after a number, unit words for mass nouns, English fallback', async () => {
  I.__setForTest('en');
  assert.equal(I.name('carrot'), 'Carrot');
  assert.equal(I.qty('carrot', 12), '12 Carrots');
  assert.equal(I.qty('wheat', 32), '32 Wheat');
  assert.equal(I.qty('egg', 1), '1 Egg');
  assert.equal(I.qty('wheat', 5, { form: 'chip' }), 'Wheat ×5');
  assert.equal(I.t('shell.wish.ask', { name: 'Mia', n: 40, thing: I.N('pumpkin'), left: '2h' }),
    'Mia would like to use the 40 coins you saved for the Pumpkin. With no answer it is released in 2h.');
  await I.__loadForTest('bg');
  try {
    assert.equal(I.name('carrot'), 'Морков');
    assert.equal(I.name('carrot', { form: 'lc' }), 'морков');
    assert.equal(I.name('coop', { form: 'def' }), 'кокошарникът');
    assert.equal(I.name('coop', { form: 'defObj' }), 'кокошарника');
    assert.equal(I.name('sugarcane', { form: 'short' }), 'Тръстика');
    assert.equal(I.name('hazel', { form: 'lc' }), 'баба Хейзъл', 'a person keeps the capital of the name');
    assert.equal(I.qty('carrot', 1), '1 морков');
    assert.equal(I.qty('carrot', 12), '12 моркова', 'masculine count form');
    assert.equal(I.qty('stump', 3), '3 пъна');
    assert.equal(I.qty('egg', 3), '3 яйца');
    assert.equal(I.qty('pumpkin', 5), '5 тикви');
    assert.equal(I.qty('wheat', 1), '1 сноп пшеница');
    assert.equal(I.qty('wheat', 32), '32 снопа пшеница', 'a mass noun takes its unit word');
    assert.equal(I.qty('honey', 2), '2 буркана мед');
    assert.equal(I.qty('milk', 3), '3 кани мляко');
    assert.equal(I.qty('weed', 1), '1 бурен');
    assert.equal(I.qty('weed', 3), '3 бурена');
    assert.equal(I.qty('wheat', 5, { form: 'chip' }), 'пшеница ×5');
    assert.equal(I.qty('no_such_thing', 2), 'no such thing ×2', 'no entry: never English grammar inside Bulgarian');
    assert.equal(I.gender('beehive'), 'm');
    assert.equal(I.ctext('quests', 'nope', 'title', 'English title'), 'English title');
  } finally {
    I.__setForTest('en');
  }
});

test('the Bulgarian names table: real content ids, a gender, the forms a sentence needs, units as [one, other]', () => {
  const table = BG_NAMES.names;
  const ids = new Set();
  for (const m of Object.values(CONTENT)) if (m instanceof Map) for (const id of m.keys()) ids.add(id);
  for (const id of PLACEABLES.keys()) ids.add(id);
  for (const r of RELICS) ids.add(r.id);                 // the Acorn treasures (a list, not a Map): names with forms
  for (const [key, e] of Object.entries(table)) {
    const [fam, id] = key.includes(':') ? key.split(':') : [null, key];
    assert.ok(fam ? CONTENT[fam]?.has?.(id) : ids.has(id), `names: '${key}' is not a content id`);
    assert.ok(typeof e.name === 'string' && e.name, `${key}: name`);
    assert.ok(['m', 'f', 'n', 'pl'].includes(e.g), `${key}: gender`);
    if (e.unit) assert.ok(Array.isArray(e.unit) && e.unit.length === 2 && e.unit.every((u) => typeof u === 'string' && u), `${key}: unit [one, other]`);
    else if (!e.proper) assert.ok(e.pl, `${key}: a countable needs its plural`);
    if (e.g === 'm' && !e.unit && !e.proper) assert.ok(e.count, `${key}: a masculine countable needs its count form`);
    if (e.short) assert.ok(e.short.length <= 14, `${key}: short form '${e.short}' is too long`);
  }
  for (const [fam, rows] of Object.entries(BG_TEXT)) {
    for (const id of Object.keys(rows)) assert.ok(CONTENT[fam]?.has?.(id) ?? true, `text: ${fam}.${id} is not a content id`);
  }
});

test('the first language: a remembered choice, else the browser language (bg*), else English', () => {
  assert.equal(I.detectLang('bg', ['en-US']), 'bg');
  assert.equal(I.detectLang('en', ['bg-BG']), 'en');
  assert.equal(I.detectLang(null, ['bg-BG', 'en']), 'bg');
  assert.equal(I.detectLang(null, ['bg']), 'bg');
  assert.equal(I.detectLang(null, ['en-GB', 'bg']), 'en');
  assert.equal(I.detectLang('fr', []), 'en');
  assert.equal(I.detectLang(undefined, 'bg-BG'), 'bg');
});

test('live constants follow the language: ERR_TEXT and SWATCH_NAMES read the catalog when used', async () => {
  const { ERR_TEXT, SWATCH_NAMES, errText } = await import('../public/js/ui/index.js');
  I.__setForTest('en');
  assert.equal(ERR_TEXT.NO_COINS, 'Not enough coins.');
  assert.equal(SWATCH_NAMES['#2BB3A3'], 'Teal');
  await I.__loadForTest('bg');
  try {
    assert.equal(ERR_TEXT.NO_COINS, 'Нямаш достатъчно монети.');
    assert.equal(errText('NO_ACORNS'), 'Нямаш достатъчно жълъди.');
    assert.equal(errText('Plain words'), 'Plain words');
    assert.equal(SWATCH_NAMES['#2BB3A3'], 'Тюркоаз');
  } finally {
    I.__setForTest('en');
  }
});
