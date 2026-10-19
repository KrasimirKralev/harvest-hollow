// Stage 2 (harness contract §1.4-1.8, §2.2, §2.3): the compiler, its semantic problems, retire / revive, the game's own
// content check on the applied tables, applyMod / removeMod / suspended, diffOverlays and the hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneTables, CONTENT_HASH, validateContent, CONTENT, ID_RE } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { compileMod, overlayDefs } from '../shared/mod/compile.js';
import { applyMod, removeMod, suspended } from '../shared/mod/apply.js';
import { diffOverlays } from '../shared/mod/diff.js';
import { modHash, overlayHash, canonical } from '../shared/mod/hash.js';
import { ID_PREFIX, LIMITS } from '../shared/mod/format.js';
import { moonlight, everything } from '../shared/mod/examples.js';

const base = { tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION };
const compile = (files, o = {}) => compileMod(base, files, { n: 1, ...o });
const codes = (r) => r.problems.map((p) => `${p.code}@${p.file}:${p.path}`);

test('the base game never uses the x_ prefix: a game update can never collide with a farm\'s mod', () => {
  for (const [fam, m] of Object.entries(CONTENT)) {
    if (!(m instanceof Map)) continue;
    for (const id of m.keys()) assert.ok(!String(id).startsWith(ID_PREFIX), `${fam}.${id}`);
  }
  assert.ok(ID_RE.test('x_moon_melon'), 'a mod id is a content id too');
});

test('the moonlight mod compiles to an overlay the game\'s own content check accepts', () => {
  const r = compile(moonlight());
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const o = r.overlay;
  assert.equal(o.base, CONTENT_HASH);
  assert.equal(o.rules, RULES_VERSION);
  assert.equal(o.hash, overlayHash(o));
  assert.equal(o.modHash, modHash(moonlight()));
  const melon = o.defs.crops[0];
  assert.deepEqual([melon.id, melon.sell, melon.seed, melon.xp, melon.growMs, melon.m], ['x_moon_melon', 124, 149, 47, 90 * 60_000, 'M1b']);
  assert.equal(melon.model, CONTENT.crops.get('watermelon').model, 'the anchor\'s model');
  assert.deepEqual(o.look.models.x_moon_melon, { key: 'crop:watermelon', from: '#3E8E3A', to: '#BFE3FF', kind: 'recolor' });
  assert.equal(o.names.bg.x_moon_melon.defObj, 'лунния пъпеш');
  const pie = o.defs.recipes[0];
  assert.equal(pie.building, 'pie_oven');
  assert.ok(pie.sell * 100 >= (124 * 2 + CONTENT.items.get('flour').sell) * 115);
  assert.deepEqual(validateContent(applyMod(base.tables, o)), []);
  assert.ok(JSON.stringify(o).length < LIMITS.overlayBytes);
  assert.ok(Object.isFrozen(o.defs.crops[0]), 'the overlay is frozen');
});

test('every family, tuning and look: all compile, the content check stays empty, the new breed joins its home', () => {
  const r = compile(everything());
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const o = r.overlay;
  assert.deepEqual(Object.fromEntries(Object.entries(o.defs).map(([k, v]) => [k, v.map((d) => d.id)])), {
    crops: ['x_moon_melon'], trees: ['x_star_plum_tree'], recipes: ['x_melon_pie'], animals: ['x_moon_hen'], decor: ['x_moon_lantern'],
    items: ['x_melon_pie', 'x_moon_egg', 'x_moon_melon', 'x_star_plum'] });
  assert.ok(o.patch.homes.find((h) => h.id === 'coop').species.includes('x_moon_hen'));
  assert.ok(o.patch.crops.length > 10, 'growTimeBp 9000 tunes every live crop');
  const wheat = o.patch.crops.find((c) => c.id === 'wheat');
  assert.equal(wheat.growMs, 54_000);
  assert.equal(wheat.sell, CONTENT.crops.get('wheat').sell, 'tuning never re-prices');
  assert.equal(o.look.sky, 'golden');
  assert.equal(o.defs.decor[0].effect.cosmetic, 'glow');
  assert.deepEqual(validateContent(applyMod(base.tables, o)), []);
});

test('the same files compile to the same overlay whatever order they were written in', () => {
  const a = compile(everything()).overlay;
  const files = everything();
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  assert.equal(compile(reversed).overlay.hash, a.hash);
  assert.equal(canonical(compile(reversed).overlay), canonical(a));
});

test('semantic problems: anchors, references, unlocks, economy, cycles, names, contrast', () => {
  const bad = (edit) => { const f = everything(); edit(f); return codes(compile(f)); };
  assert.ok(bad((f) => { f['content/crops/x_moon_melon.json'].like = 'golden_egg'; }).includes('BAD_ANCHOR@content/crops/x_moon_melon.json:like'));
  assert.ok(bad((f) => { f['content/trees/x_star_plum_tree.json'].like = 'pine'; }).includes('BAD_ANCHOR@content/trees/x_star_plum_tree.json:like'));
  assert.ok(bad((f) => { f['content/animals/x_moon_hen.json'].like = 'bee'; }).includes('BAD_ANCHOR@content/animals/x_moon_hen.json:like'));
  assert.ok(bad((f) => { f['content/recipes/x_melon_pie.json'].like = 'bread'; }).includes('BAD_ANCHOR@content/recipes/x_melon_pie.json:like'));
  assert.ok(bad((f) => { f['content/recipes/x_melon_pie.json'].inputs.unobtainium = 1; }).includes('UNKNOWN_REF@content/recipes/x_melon_pie.json:inputs.unobtainium'));
  assert.ok(bad((f) => { f['content/recipes/x_melon_pie.json'].inputs = { golden_egg: 1 }; }).includes('UNKNOWN_REF@content/recipes/x_melon_pie.json:inputs.golden_egg'), 'no premium items');
  assert.ok(bad((f) => { f['content/recipes/x_melon_pie.json'].unlock = 14; }).includes('BAD_UNLOCK@content/recipes/x_melon_pie.json:unlock'));
  assert.ok(bad((f) => { Object.assign(f['content/recipes/x_melon_pie.json'], { minutes: 5, inputs: { x_moon_melon: 10, pumpkin: 10 }, value: 'humble' }); })
    .includes('ECON_BOUND@content/recipes/x_melon_pie.json:minutes'));
  assert.ok(bad((f) => { Object.assign(f['content/crops/x_moon_melon.json'], { growMin: 1, unlock: 40, value: 'rich' }); })
    .includes('OUT_OF_RANGE@content/crops/x_moon_melon.json:growMin'));
  assert.ok(bad((f) => { f['content/decor/x_moon_lantern.json'].cost = 5000; }).includes('OUT_OF_RANGE@content/decor/x_moon_lantern.json:cost'));
  assert.ok(bad((f) => { f['content/crops/x_moon_melon.json'].text.en.name = 'Wheat'; }).includes('NAME_TAKEN@content/crops/x_moon_melon.json:text.en.name'));
  assert.ok(bad((f) => { f['content/crops/x_moon_melon.json'].hue = '#7CC243'; }).includes('LOW_CONTRAST@content/crops/x_moon_melon.json:hue'));
  // release 1.0 (H2/M24): a palette reaches the compiler only from a version stored before 1.0: ignored, with a warning
  const old = compile({ ...everything(), 'look.json': { palette: { skyTop: '#3A2010' }, sky: 'golden' } });
  assert.equal(old.ok, true, JSON.stringify(old.problems));
  assert.deepEqual(old.warnings.map((w) => `${w.code}@${w.file}:${w.path}`), ['IGNORED@look.json:palette']);
  assert.deepEqual(old.overlay.look.palette, undefined);
  assert.equal(old.overlay.look.sky, 'golden');
  assert.ok(bad((f) => { f['text/letters.json'][0].art = 'spaceship'; }).includes('UNKNOWN_REF@text/letters.json:0.art'));
  assert.ok(bad((f) => { f['tuning.json'] = { crops: { wheat: { growMin: 5 } } }; }).includes('OUT_OF_RANGE@tuning.json:crops.wheat.growMin'));
  assert.ok(compile(everything(), { tracks: ['day1'] }).problems.length === 0, 'no music preference, nothing to check');
  const looked = everything();
  looked['look.json'] = { music: { prefer: ['not_a_track'] } };
  assert.ok(codes(compile(looked, { tracks: ['a', 'b'] })).includes('UNKNOWN_REF@look.json:music.prefer'));
  // two mod recipes that need each other
  const cyc = moonlight();
  cyc['content/recipes/x_melon_jam.json'] = { ...structuredClone(cyc['content/recipes/x_melon_pie.json']), id: 'x_melon_jam',
    inputs: { x_melon_pie: 1 }, text: { en: { name: 'Melon Jam' }, bg: { name: 'Конфитюр от пъпеш', g: 'm', pl: 'конфитюри', count: 'конфитюра',
      def: 'конфитюрът', defObj: 'конфитюра', plDef: 'конфитюрите' } } };
  cyc['content/recipes/x_melon_pie.json'].inputs = { x_melon_jam: 1, flour: 1 };
  assert.ok(codes(compile(cyc)).includes('CYCLE@content/recipes/x_melon_jam.json:inputs'));
  // a Bulgarian definite form that does not look right is a warning, never an error
  const w = moonlight();
  w['content/crops/x_moon_melon.json'].text.bg.def = 'лунен пъпеш';
  const rw = compile(w);
  assert.equal(rw.ok, true);
  assert.deepEqual(rw.warnings.map((x) => x.code), ['BG_FORMS']);
});

test('limits: at most 12 new things per job', () => {
  const f = moonlight();
  const src = f['content/crops/x_moon_melon.json'];
  const names = ['Ash', 'Birch', 'Cedar', 'Daisy', 'Elm', 'Fern', 'Gale', 'Hazel', 'Iris', 'Juniper', 'Kale', 'Lilac'];
  names.forEach((nm, i) => {
    f[`content/crops/x_c${i}.json`] = { ...structuredClone(src), id: `x_c${i}`, text: { en: { name: `${nm} Melon` },
      bg: { ...structuredClone(src.text.bg), name: `Пъпеш номер ${i + 2}` } } };
  });
  assert.ok(codes(compile(f)).includes('TOO_MANY@:'));
});

test('retire and revive: an applied id that leaves the files stays in the graveyard; it can come back', () => {
  const v1 = compile(moonlight()).overlay;
  const files = moonlight();
  delete files['content/recipes/x_melon_pie.json'];
  const v2 = compileMod(base, files, { n: 2, prevOverlay: v1 }).overlay;
  assert.deepEqual(v2.defs.recipes, []);
  const pie = v2.graveyard.recipes[0];
  assert.deepEqual([pie.id, pie.retired], ['x_melon_pie', true]);
  assert.equal(v2.graveyard.items.find((i) => i.id === 'x_melon_pie').retired, true, 'its item too (still sells)');
  assert.equal(v2.names.bg.x_melon_pie.name, 'Пай с пъпеш', 'a retired thing keeps its names');
  assert.deepEqual(validateContent(applyMod(base.tables, v2)), []);
  assert.deepEqual(diffOverlays(v1, v2), { added: [], changed: [], retired: [{ family: 'recipes', id: 'x_melon_pie' }], revived: [] });
  const v3 = compileMod(base, moonlight(), { n: 3, prevOverlay: v2 }).overlay;
  assert.equal(v3.defs.recipes[0].id, 'x_melon_pie');
  assert.equal(v3.defs.recipes[0].mod.n, 1, 'still the version that first added it');
  assert.deepEqual(v3.graveyard.recipes, []);
  assert.deepEqual(diffOverlays(v2, v3).revived, [{ family: 'recipes', id: 'x_melon_pie' }]);
  // to nothing at all (an undo before the first version): everything retired, nothing deleted
  const v4 = compileMod(base, { 'mod.json': moonlight()['mod.json'] }, { n: 4, prevOverlay: v3 }).overlay;
  assert.deepEqual(Object.values(v4.defs).flat(), []);
  assert.deepEqual(overlayDefs(v4).crops.get('x_moon_melon').retired, true);
});

test('applyMod / removeMod / suspended', () => {
  const o = compile(everything()).overlay;
  const t = applyMod(base.tables, o);
  assert.equal(t.crops.length, base.tables.crops.length + 1);
  assert.equal(t.crops.find((c) => c.id === 'wheat').growMs, 54_000, 'patched in place');
  assert.equal(t.crops.findIndex((c) => c.id === 'wheat'), base.tables.crops.findIndex((c) => c.id === 'wheat'));
  assert.equal(t.rules, base.tables.rules);
  assert.equal(base.tables.crops.find((c) => c.id === 'wheat').growMs, 60_000, 'the input is not changed');
  assert.deepEqual(canonical(removeMod(t, o, base.tables)), canonical(base.tables));
  assert.throws(() => applyMod(base.tables, { ...o, defs: { ...o.defs, crops: [{ ...o.defs.crops[0], id: 'wheat' }] } }), /collides/);
  const s = suspended(o);
  assert.deepEqual(Object.values(s.defs).flat(), []);
  assert.ok(Object.values(s.graveyard).flat().every((d) => d.retired === true));
  assert.deepEqual(s.patch.crops, [], 'tuning dropped');
  assert.ok(s.patch.homes.length, 'a retired breed keeps its home');
  assert.equal(s.look.sky, undefined);
  assert.deepEqual(s.text, { letters: [], tips: [] });
  assert.equal(s.hash, overlayHash(s));
  assert.deepEqual(validateContent(applyMod(base.tables, s)), []);
});
