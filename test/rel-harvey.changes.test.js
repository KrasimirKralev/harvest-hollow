// Release 1.0, H3 (harvey#3, #9; astra#5): the change list shows everything a change does, in the player's words. One
// snapshot per row kind, server side (shared/mod/diff.js changeRows over compiled overlays) and client side (the facts
// the pop-up words): a crop with its season and "From level 9 (your farm is 5)", a tree and an animal with what they
// give and its price, a recipe with its workshop and inputs, a decoration's cost (never "Sells for"), one row per speed
// knob ("All crops grow 20 % faster") folding the per-crop patches it causes, a crop tuned on its own ("1 h → 45 m"),
// the sky, the music, a letter by its title; base things carry the game's own icon.
// RED on fdafb9c: looks, letters and speed said "Nothing to show"; a 20 % speed-up was 25 "Changed · Crop" rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeRows as serverRows, sameEffect } from '../shared/mod/diff.js';
import { compileMod } from '../shared/mod/compile.js';
import { cloneTables, CONTENT_HASH } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { CHIPS, everything } from '../shared/mod/examples.js';
import { changeRows as clientRows } from '../public/js/ui/harness/model.js';

const base = { tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION };
const TITLES = { 'day-river': 'Down the River' };
const opts = {
  base: base.tables,
  iconOf: (id, mod) => (mod ? `/mods/hh/icons/128/${id}.png` : `/assets/icons/${id}.png`),
  bgName: () => null,
  musicTitle: (id) => TITLES[id] ?? null,
};
const compile = (files, prev = null, n = 1) => {
  const c = compileMod(base, files, { n, prevOverlay: prev, tracks: null });
  assert.equal(c.ok, true, JSON.stringify(c.problems));
  return c.overlay;
};

/** Every row kind in one change. */
function sink() {
  const ex = everything();
  return {
    ...CHIPS.find((c) => c.id === 'ex1').files(9),
    ...CHIPS.find((c) => c.id === 'ex2').files(21),
    ...CHIPS.find((c) => c.id === 'ex3').files(21),
    'mod.json': { format: 1, title: { en: 'Everything', bg: 'Всичко' } },
    'content/trees/x_star_plum_tree.json': ex['content/trees/x_star_plum_tree.json'],
    'content/animals/x_moon_hen.json': ex['content/animals/x_moon_hen.json'],
    'text/letters.json': ex['text/letters.json'],
    'look.json': { sky: 'golden', music: { prefer: ['day-river'] } },
    'tuning.json': { growTimeBp: 8000, crops: { strawberry: { growMin: 45 } } },
  };
}
const pick = (rows, kind) => rows.filter(kind);

test('H3 server rows: every kind once, the knob folds its patches, the facts each kind needs', () => {
  const next = compile(sink());
  const rows = serverRows(null, next, opts);
  const key = (r) => `${r.op}:${r.family}:${r.id}`;
  assert.deepEqual(rows.map(key).sort(), [
    'add:crops:x_blue_pumpkin', 'add:decor:x_pink_fence', 'add:recipes:x_banitsa', 'add:trees:x_star_plum_tree', 'add:animals:x_moon_hen',
    'change:tuning:growTimeBp', 'change:crops:strawberry', 'change:look:sky', 'change:look:music', 'add:text:x_letter_melons',
  ].sort(), 'no other rows');
  // the things first, then the knob, the tuned crop, the look and the letter
  assert.deepEqual(rows.slice(5).map(key), ['change:tuning:growTimeBp', 'change:crops:strawberry', 'change:look:sky', 'change:look:music', 'add:text:x_letter_melons']);
  assert.equal(rows.length, 10, 'one row per thing, knob, tuned crop, look and letter: the 25 per-crop rows are folded');
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  // a crop: its numbers (the time with the 20 % knob), its season, its own icon
  assert.deepEqual(Object.keys(by.x_blue_pumpkin.numbers).sort(), ['minutes', 'seed', 'sell', 'unlock', 'xp', 'yield']);
  assert.equal(by.x_blue_pumpkin.numbers.minutes, 576);
  assert.deepEqual(by.x_blue_pumpkin.info, { season: 'autumn' });
  assert.equal(by.x_blue_pumpkin.icon, '/mods/hh/icons/128/x_blue_pumpkin.png');
  // a decoration costs; it never "sells for"
  assert.deepEqual(by.x_pink_fence.numbers, { cost: 40, unlock: 1 });
  // a recipe: its workshop and inputs by name
  assert.deepEqual(by.x_banitsa.info.building, { id: 'bakery', name: { en: 'Bakery', bg: null } });
  assert.deepEqual(by.x_banitsa.info.inputs.map((x) => `${x.name.en} ×${x.n}`), ['Flour ×2', 'Egg ×2', 'Cheese ×1']);
  // an animal and a tree: what they give, how often, for how much
  assert.equal(by.x_moon_hen.info.product.id, 'x_moon_egg');
  assert.equal(by.x_moon_hen.numbers.minutes, 20);
  assert.ok(by.x_moon_hen.numbers.sell > 0);
  assert.equal(by.x_star_plum_tree.info.product.id, 'x_star_plum');
  // the knob: one row; the crop tuned on its own: from -> to, with the game's icon
  assert.deepEqual({ knob: by.growTimeBp.knob, bp: by.growTimeBp.bp, was: by.growTimeBp.was }, { knob: 'growTimeBp', bp: 8000, was: 10000 });
  assert.deepEqual({ tuned: by.strawberry.tuned, from: by.strawberry.numbers.from, to: by.strawberry.numbers.minutes, icon: by.strawberry.icon },
    { tuned: true, from: 60, to: 45, icon: '/assets/icons/strawberry.png' });
  assert.equal(by.sky.sky, 'golden');
  assert.deepEqual(by.music.tracks, [{ id: 'day-river', title: 'Down the River' }]);
  assert.deepEqual({ from: by.x_letter_melons.from, title: by.x_letter_melons.name.en }, { from: 'mabel', title: 'Melons by moonlight' });
});

test('H3 server rows: taking things back says so (retired, the knob back to normal, the music back to the game\'s)', () => {
  const v1 = compile(sink());
  const files = sink();
  delete files['content/decor/x_pink_fence.json'];
  files['tuning.json'] = { crops: { strawberry: { growMin: 45 } } };
  files['look.json'] = { sky: 'golden' };
  const v2 = compile(files, v1, 2);
  const rows = serverRows(v1, v2, opts);
  assert.deepEqual(rows.map((r) => `${r.op}:${r.id}`).sort(), ['change:growTimeBp', 'change:music', 'retire:x_pink_fence']);
  const knob = rows.find((r) => r.id === 'growTimeBp');
  assert.equal(knob.bp, 10000, 'back to the normal speed');
  assert.deepEqual(rows.find((r) => r.id === 'music').tracks, []);
  assert.ok(rows.some((r) => r.op === 'retire' && r.id === 'x_pink_fence'));
  assert.ok(!rows.some((r) => r.id === 'strawberry'), 'the crop tuned on its own did not change');
  // the mod things that only moved with the knob are folded too (their own row would say nothing new)
  assert.ok(!rows.some((r) => r.op === 'change' && /^x_/.test(r.id)), JSON.stringify(rows.map((r) => `${r.op}:${r.id}`)));
});

test('H1/H3: an overlay that changes nothing is the same effect (NO_CHANGE), a title alone included', () => {
  const v1 = compile(sink());
  const again = sink();
  again['mod.json'] = { format: 1, title: { en: 'Renamed', bg: 'Преименувано' } };
  assert.equal(sameEffect(v1, compile(again, v1, 2)), true);
  assert.equal(sameEffect(null, compile({ 'mod.json': { format: 1, title: { en: 'No Change', bg: 'Без промяна' } } })), true);
  assert.equal(sameEffect(null, v1), false);
});

test('H3 client facts: each row kind worded by its own facts; "From level 9 (your farm is 5)" warns', () => {
  const rows = clientRows(serverRows(null, compile(sink()), opts), 'en', { level: 5, season: 'summer' });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const keys = (id) => by[id].facts.map((f) => f.key);
  assert.deepEqual(keys('x_blue_pumpkin'), ['harness.fact.sell', 'harness.fact.seed', 'harness.fact.xp', 'harness.fact.grow', 'harness.fact.yield',
    'harness.fact.season', 'harness.fact.later']);
  assert.deepEqual(by.x_blue_pumpkin.facts.at(-1), { key: 'harness.fact.later', params: { n: 9, level: 5 }, warn: true });
  assert.equal(by.x_blue_pumpkin.warn, true);
  assert.deepEqual(by.x_blue_pumpkin.facts.find((f) => f.key === 'harness.fact.season'), { key: 'harness.fact.season', season: 'autumn', now: 'summer' });
  assert.deepEqual(keys('x_pink_fence'), ['harness.fact.cost']);
  assert.deepEqual(keys('x_banitsa'), ['harness.fact.workshop', 'harness.fact.inputs', 'harness.fact.sell', 'harness.fact.xp', 'harness.fact.make', 'harness.fact.later']);
  assert.deepEqual(keys('x_moon_hen').slice(0, 1), ['harness.fact.gives']);
  assert.equal(by.x_moon_hen.facts[0].product, 'Moon Egg');
  assert.deepEqual(keys('x_star_plum_tree').slice(0, 1), ['harness.fact.gives']);
  assert.deepEqual({ kind: by.growTimeBp.kind, title: by.growTimeBp.title }, { kind: 'tuning', title: { key: 'harness.tune.growTimeBp.faster', pct: 20 } });
  assert.deepEqual({ kind: by.strawberry.kind, fact: by.strawberry.facts[0] }, { kind: 'tuned', fact: { key: 'harness.fact.growFromTo', from: 3_600_000, to: 2_700_000 } });
  assert.deepEqual(by.sky.title, { key: 'harness.look.sky', sky: 'golden' });
  assert.deepEqual(by.music.title, { key: 'harness.look.music', tracks: ['Down the River'] });
  assert.deepEqual({ kind: by.x_letter_melons.kind, name: by.x_letter_melons.name, fact: by.x_letter_melons.facts[0] },
    { kind: 'letter', name: 'Melons by moonlight', fact: { key: 'harness.letter.row', from: 'mabel' } });
  // a base thing's icon is the game's own path (the view routes it through assetUrl)
  assert.equal(by.strawberry.icon, '/assets/icons/strawberry.png');
});
