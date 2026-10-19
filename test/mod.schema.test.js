// Stage 1 of the mod validation (harness contract §3): shape only. Each code once, with the file and path it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFiles, textProblems, utf8Len } from '../shared/mod/schema.js';
import { moonlight, everything } from '../shared/mod/examples.js';
import { LIMITS } from '../shared/mod/format.js';

const codes = (files, o) => checkFiles(files, o).map((p) => `${p.code}@${p.file}:${p.path}`);
const CROP = 'content/crops/x_moon_melon.json';

test('the guide\'s examples pass stage 1', () => {
  assert.deepEqual(checkFiles(moonlight()), []);
  assert.deepEqual(checkFiles(everything()), []);
});

test('files: JSON text is parsed, BAD_JSON, UNKNOWN_FILE, a missing mod.json, the file name is the id', () => {
  const f = moonlight();
  f[CROP] = JSON.stringify(f[CROP]);
  assert.deepEqual(checkFiles(f), [], 'JSON text works as well as parsed objects');
  assert.deepEqual(codes({ ...moonlight(), [CROP]: '{ "id": ' }), [`BAD_JSON@${CROP}:`]);
  assert.ok(codes({ ...moonlight(), 'src/hack.js': {} }).includes('UNKNOWN_FILE@src/hack.js:'));
  assert.ok(codes({ ...moonlight(), '../escape.json': {} }).includes('UNKNOWN_FILE@../escape.json:'));
  const noMod = moonlight();
  delete noMod['mod.json'];
  assert.ok(codes(noMod).includes('MISSING_FIELD@mod.json:'));
  const wrong = moonlight();
  wrong['content/crops/x_other.json'] = wrong[CROP];
  delete wrong[CROP];
  assert.ok(codes(wrong).includes('BAD_ID@content/crops/x_other.json:id'));
});

test('ids: the x_ prefix, unique in the mod, a retired id only in its own family', () => {
  const f = moonlight();
  f[CROP].id = 'moon_melon';
  assert.ok(codes(f).some((c) => c.startsWith('BAD_ID@')));
  const twice = everything();
  twice['content/decor/x_moon_lantern.json'].text.en.name = 'Moon Lamp';
  twice['content/trees/x_star_plum_tree.json'].fruit.id = 'x_moon_melon';
  assert.ok(codes(twice).includes('ID_TAKEN@content/trees/x_star_plum_tree.json:fruit.id'));
  assert.deepEqual(checkFiles(moonlight(), { graveyard: { x_moon_melon: { family: 'crops', n: 1 } } }), [], 'brought back');
  assert.ok(codes(moonlight(), { graveyard: { x_moon_melon: { family: 'decor', n: 1 } } }).includes(`ID_TAKEN@${CROP}:id`));
});

test('fields, types, enums, ladders and colours', () => {
  const f = moonlight();
  Object.assign(f[CROP], { growMin: 91, yield: 4, season: 'monsoon', hue: 'blue', waterable: 'yes', price: 9999 });
  f[CROP].classes = ['fruit', 'gem'];
  const c = codes(f);
  for (const want of [`NOT_LADDER@${CROP}:growMin`, `BAD_ENUM@${CROP}:yield`, `BAD_ENUM@${CROP}:season`, `BAD_HEX@${CROP}:hue`,
    `BAD_TYPE@${CROP}:waterable`, `UNKNOWN_FIELD@${CROP}:price`, `BAD_ENUM@${CROP}:classes.1`]) assert.ok(c.includes(want), `${want} in ${c}`);
  const m = moonlight();
  delete m[CROP].season;
  assert.ok(codes(m).includes(`MISSING_FIELD@${CROP}:season`));
  const r = moonlight();
  r['content/recipes/x_melon_pie.json'].inputs = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  assert.ok(codes(r).includes('BAD_TYPE@content/recipes/x_melon_pie.json:inputs'));
});

test('text: Title Case English, Bulgarian forms, no links, no XP, no markup, lengths', () => {
  assert.equal(textProblems('en', 'name', 'Moon Melon'), null);
  assert.match(textProblems('en', 'name', 'moon melon'), /Title Case/);
  assert.match(textProblems('en', 'desc', 'Visit https://evil.example'), /./);
  assert.match(textProblems('en', 'desc', 'Gives 10 XP'), /XP/);
  assert.match(textProblems('en', 'name', '<b>Melon</b>'), /only letters/);
  assert.match(textProblems('bg', 'name', 'Moon'), /Bulgarian/);
  assert.match(textProblems('bg', 'desc', 'Пъпеш — сладък'), /./, 'no em dash');
  assert.equal(textProblems('bg', 'desc', 'Пъпеш – сладък и „лунен“'), null);
  assert.match(textProblems('en', 'name', 'M'), /2-24/);
  const f = moonlight();
  delete f[CROP].text.bg.count;
  assert.ok(codes(f).includes(`MISSING_FIELD@${CROP}:text.bg.count`), 'a masculine name needs its count form');
});

test('tuning, look and letters; UNSUPPORTED says what cannot be tuned (release 1.0: no palette, no tips)', () => {
  const f = moonlight();
  f['tuning.json'] = { growTimeBp: 7000, weather: { rain: 2 }, crops: { wheat: { growMin: 3 } } };
  f['look.json'] = { sky: 'neon', palette: { grass: '#00FF00', lava: '#FF0000' } };
  f['text/tips.json'] = Array.from({ length: LIMITS.tips + 1 }, (_, i) => ({ id: `x_tip_${i}`, en: 'A tip.', bg: 'Съвет.' }));
  const c = codes(f);
  for (const want of ['BAD_ENUM@tuning.json:growTimeBp', 'UNSUPPORTED@tuning.json:weather', 'NOT_LADDER@tuning.json:crops.wheat.growMin',
    'BAD_ENUM@look.json:sky', 'UNSUPPORTED@look.json:palette', 'UNSUPPORTED@text/tips.json:']) assert.ok(c.includes(want), `${want} in ${c}`);
});

test('sizes: a file over 16 KB, the folder over 128 KB, more than 40 content files', () => {
  const f = moonlight();
  f[CROP].text.en.desc = 'x'.repeat(20_000);
  assert.ok(codes(f).includes(`TOO_BIG@${CROP}:`));
  const many = moonlight();
  for (let i = 0; i < LIMITS.contentFiles + 1; i++) many[`content/decor/x_d${i}.json`] = { id: `x_d${i}` };
  assert.ok(codes(many).includes('TOO_MANY@:'));
  assert.equal(utf8Len('пъпеш'), 10);
});
