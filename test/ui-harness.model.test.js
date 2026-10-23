// The helper's view model (public/js/ui/harness/model.js) and its words: the pill for every job state (mine and the
// partner's), the four steps, the change list's numbers, the test results of a ValidationResult (passed, failed, not
// run), the player-facing error rows, the toasts every farmer hears, and a catalog line in English AND Bulgarian for
// every code the contract names and every key the helper's code asks for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../public/js/ui/harness/model.js';
import EN from '../public/js/i18n/en/harness.js';
import BG from '../public/js/i18n/bg/harness.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const job = (o) => ({ id: 'j1', by: 'p1', provider: 'mock', state: 'working', step: 'building', round: 1, prompts: [{ at: 1, text: 'A melon' }], ...o });

test('the pill: one per job state, mine with steps, the partner\'s passive, nothing for an ended job', () => {
  assert.equal(M.pillOf(null, 'p1'), null);
  assert.deepEqual(M.pillOf(job({ state: 'starting', step: undefined }), 'p1'), { mine: true, tone: 'work', step: 'reading', key: 'harness.pill.step.reading' });
  assert.equal(M.pillOf(job({ state: 'working', step: 'reading' }), 'p1').key, 'harness.pill.step.reading');
  assert.equal(M.pillOf(job({ state: 'working', step: 'building' }), 'p1').key, 'harness.pill.step.building');
  assert.equal(M.pillOf(job({ state: 'validating', step: 'testing' }), 'p1').key, 'harness.pill.step.testing');
  assert.equal(M.pillOf(job({ state: 'fixing', step: 'fixing' }), 'p1').key, 'harness.pill.step.fixing');
  assert.equal(M.pillOf(job({ state: 'revising', step: 'reading' }), 'p1').tone, 'work');
  assert.equal(M.pillOf(job({ state: 'applying' }), 'p1').key, 'harness.pill.step.applying');
  assert.deepEqual(M.pillOf(job({ state: 'working', step: 'signin' }), 'p1'), { mine: true, tone: 'signin', step: 'signin', key: 'harness.pill.signin' });
  assert.equal(M.pillOf(job({ state: 'ready', step: 'ready' }), 'p1').tone, 'ready');
  assert.equal(M.pillOf(job({ state: 'failed' }), 'p1').tone, 'fail');
  for (const s of ['applied', 'discarded', 'expired', 'cancelled']) assert.equal(M.pillOf(job({ state: s }), 'p1'), null, s);
  // the partner sees that it works and that it is ready, never its failure
  assert.equal(M.pillOf(job({ state: 'working' }), 'p2').tone, 'partner');
  assert.equal(M.pillOf(job({ state: 'ready' }), 'p2').tone, 'partnerReady');
  assert.equal(M.pillOf(job({ state: 'failed' }), 'p2'), null);
  // the dots: reading 0, building 1, testing and fixing 2, applying 3
  assert.deepEqual(['reading', 'building', 'testing', 'fixing', 'applying', 'ready', 'signin', 'odd'].map(M.stepIndex), [0, 1, 2, 2, 3, 3, 0, 0]);
});

test('the change list: names in the language, the op and family, numbers as facts, a retired thing without prices', () => {
  const rows = M.changeRows([
    { op: 'add', family: 'crops', id: 'x_moon_melon', name: { en: 'Moon Melon', bg: 'Лунен пъпеш' }, icon: '/mods/a1b2/icons/128/x_moon_melon.png',
      numbers: { sell: 124, seed: 149, xp: 47, minutes: 90, unlock: 14 } },
    { op: 'retire', family: 'decor', id: 'x_old_lamp', name: { en: 'Old Lamp' }, icon: 'javascript:alert(1)', numbers: { sell: 30 } },
    { op: 'weird', family: 'spaceships', id: 'x_q', name: null },
  ], 'bg');
  assert.equal(rows[0].name, 'Лунен пъпеш');
  assert.equal(rows[0].icon, '/mods/a1b2/icons/128/x_moon_melon.png');
  assert.deepEqual(rows[0].facts, [{ key: 'harness.fact.sell', n: 124 }, { key: 'harness.fact.seed', n: 149 }, { key: 'harness.fact.xp', n: 47 },
    { key: 'harness.fact.grow', ms: 5_400_000 }, { key: 'harness.fact.unlock', n: 14 }]);
  assert.equal(rows[1].name, 'Old Lamp', 'English when there is no Bulgarian');
  assert.equal(rows[1].icon, null, 'only a path of this site is shown as a picture');
  assert.deepEqual(rows[1].facts, []);
  assert.deepEqual([rows[2].op, rows[2].family, rows[2].name], ['change', null, 'x_q']);
});

test('test results: each stage that ran, the economy and undo checks, the stages after a failure as not run', () => {
  const ok = { ok: true, stage: 'done', full: true, checks: {
    schema: { ok: true, files: 9 }, semantic: { ok: true, defs: { added: 4 } },
    boot: { ok: true, simHours: 48, actions: 212, econ: { coinsBp: 10350, xpBp: 10120 }, retire: true }, render: { ok: true, models: 4, icons: 6 } } };
  assert.deepEqual(M.testRows(ok).map((r) => [r.id, r.ok, r.key]), [
    ['schema', true, 'harness.test.schema'], ['semantic', true, 'harness.test.semantic'], ['boot', true, 'harness.test.boot'],
    ['econ', true, 'harness.test.econ'], ['retire', true, 'harness.test.retire'], ['render', true, 'harness.test.render']]);
  assert.deepEqual(M.testRows(ok).find((r) => r.id === 'econ').params, { coins: 3.5, xp: 1.2 });
  const bad = { ok: false, stage: 'semantic', checks: { schema: { ok: true, files: 3 } }, errors: [{ stage: 'semantic', code: 'ECON_BOUND', file: 'content/recipes/x_pie.json' }] };
  assert.deepEqual(M.testRows(bad).map((r) => [r.id, r.ok]), [['schema', true], ['semantic', false], ['boot', null], ['render', null]]);
  assert.deepEqual(M.testRows(null), []);
});

test('error rows name the thing from the change list, once per code and thing, at most five', () => {
  const v = { ok: false, errors: [
    { code: 'NOT_LADDER', file: 'content/crops/x_moon_melon.json', path: 'growMin' },
    { code: 'NOT_LADDER', file: 'content/crops/x_moon_melon.json', path: 'yield' },
    { code: 'ECON_BOUND', file: 'content/recipes/x_pie.json' },
    { code: 'SOMETHING_NEW', file: 'tuning.json' },
  ] };
  const rows = M.errorRows(v, [{ op: 'add', family: 'crops', id: 'x_moon_melon', name: { en: 'Moon Melon' } }], 'en');
  assert.deepEqual(rows, [
    { code: 'NOT_LADDER', key: 'harness.err.NOT_LADDER', what: 'Moon Melon' },
    { code: 'ECON_BOUND', key: 'harness.err.ECON_BOUND', what: 'Pie' },
    { code: 'SOMETHING_NEW', key: 'harness.err.other', what: '' },
  ]);
});

test('a request that failed before the mod compiled: Bulgarian rows name the kind of thing, never its English file id', () => {
  const v = { ok: false, errors: [
    { code: 'NOT_LADDER', file: 'content/crops/x_gold_melon.json', path: 'growMin' },
    { code: 'ECON_BOUND', file: 'content/recipes/x_gold_pie.json' },
    { code: 'BAD_HEX', file: 'content/decor/x_gold_lamp.json' },
    { code: 'BAD_TEXT', file: 'content/trees/x_gold_plum.json' },
    { code: 'MISSING_FIELD', file: 'content/animals/x_gold_hen.json' },
  ] };
  const bg = M.errorRows(v, [], 'bg');
  assert.deepEqual(bg.map((r) => [r.what, r.whatKey]), [['', 'harness.newThing.crops'], ['', 'harness.newThing.recipes'],
    ['', 'harness.newThing.decor'], ['', 'harness.newThing.trees'], ['', 'harness.newThing.animals']]);
  // a thing the game already knows keeps its name; English keeps the words of the id
  assert.equal(M.errorRows(v, [], 'bg', 5, (id) => (id === 'x_gold_melon' ? 'златен пъпеш' : null))[0].what, 'златен пъпеш');
  assert.equal(M.errorRows(v, [], 'en')[0].what, 'Gold melon');
});

test('the toasts every farmer hears after an apply or an undo', () => {
  const players = { p1: { name: 'Rowan' }, p2: { name: 'Mia' } };
  const msg = { by: 'p1', n: 7, title: { en: 'Moonlight', bg: 'Лунна жътва' }, names: [{ id: 'x_moon_melon', en: 'Moon Melon', bg: 'Лунен пъпеш' }, { id: 'x_pie', en: 'Melon Pie', bg: 'Пъпешов пай' }] };
  assert.deepEqual(M.appliedLine(msg, 'p1', players, 'en'), { key: 'harness.applied.mine', params: { things: ['Moon Melon', 'Melon Pie'], name: null } });
  assert.deepEqual(M.appliedLine(msg, 'p2', players, 'bg'), { key: 'harness.applied.by', params: { things: ['лунен пъпеш', 'пъпешов пай'], name: 'Rowan' } });
  assert.deepEqual(M.appliedLine({ ...msg, names: [] }, 'p2', players, 'bg'), { key: 'harness.applied.byTitle', params: { title: 'Лунна жътва', name: 'Rowan' } });
  assert.equal(M.appliedLine({ ...msg, by: 'p9' }, 'p2', players, 'en').key, 'harness.applied.someone');
  assert.equal(M.undoneLine({ by: 'p2', n: 8 }, 'p1', players).key, 'harness.undone.by');
  assert.equal(M.undoneLine({ by: 'p1', n: 8 }, 'p1', players).key, 'harness.undone.mine');
});

test('requests, providers and sign-in helpers', () => {
  assert.equal(M.cleanPrompt('  a blue melon\r\n please \u0007 '), 'a blue melon\n please');
  assert.equal(M.cleanPrompt('   '), null);
  assert.equal(M.cleanPrompt('x'.repeat(1001)), null);
  assert.equal(M.cleanPrompt('x'.repeat(1000)).length, 1000);
  const provs = [{ id: 'claude', available: false, reason: 'NO_BINARY' }, { id: 'chatgpt', available: true, signedIn: false }, { id: 'mock', available: true, signedIn: true }];
  assert.equal(M.chooseProvider(provs, 'chatgpt'), 'chatgpt');
  assert.equal(M.chooseProvider(provs, 'claude'), 'mock', 'an unavailable remembered one gives way to a signed-in one');
  assert.equal(M.chooseProvider(provs, null), 'mock');
  assert.equal(M.chooseProvider([], 'x'), null);
  assert.equal(M.pasteFieldOf('claude', { state: 'pending', step: { kind: 'open_url', url: 'https://x' } }), 'code');
  assert.equal(M.pasteFieldOf('chatgpt', null), 'redirect_url');
  assert.equal(M.pasteFieldOf('mock', null), null);
  assert.equal(M.pasteFieldOf('mock', { step: { kind: 'paste', field: 'redirect_url' } }), 'redirect_url');
  assert.deepEqual(M.signInFromPush({ provider: 'claude', state: 'signed_in' }), { provider: 'claude', state: 'signed_in' });
  assert.deepEqual(M.signInFromPush({ provider: 'chatgpt', state: { state: 'error', error: { code: 'DENIED' } } }), { provider: 'chatgpt', state: 'error', error: { code: 'DENIED' } });
  assert.equal(M.signInFromPush({ state: 'x' }), null);
  assert.equal(M.prefsKey({ multi: true, id: 'abcdefghij23' }), 'hh.f.abcdefghij23.harness');
  assert.equal(M.lettersKey({ multi: false }), 'hh.harness.letters');
});

test('every code of the contract has a line in English and Bulgarian (harness.err.<CODE>)', () => {
  for (const c of M.CODES) {
    assert.equal(M.errKey(c), `harness.err.${c}`);
    assert.ok(EN[`harness.err.${c}`], `English line for ${c}`);
    assert.ok(BG[`harness.err.${c}`], `Bulgarian line for ${c}`);
  }
  assert.equal(M.errKey('WHATEVER'), 'harness.err.other');
});

// The contract is an internal note and the public export leaves docs/agent-notes out, so this half skips there. The
// skip is keyed on the folder, not the file: here a moved or renamed contract still fails instead of skipping.
test('the contract\'s own code list, read from the contract itself, is all in the model\'s codes',
  { skip: !fs.existsSync(path.join(ROOT, 'docs/agent-notes')) && 'docs/agent-notes is not in the public export' }, () => {
  const contract = fs.readFileSync(path.join(ROOT, 'docs/agent-notes/harness-contract.md'), 'utf8');
  const codesLine = /\*\*Codes\*\*[\s\S]*?A mod is \*\*offered/.exec(contract)?.[0] ?? '';
  assert.match(codesLine, /BAD_JSON[\s\S]*NAME_TOO_LONG/, 'the contract\'s code list was found');
  for (const c of (codesLine.match(/\b[A-Z][A-Z_]{2,}\b/g) ?? []).filter((w) => w !== 'CODE' && w !== 'UI')) assert.ok(M.CODES.includes(c), `${c} from the contract's code list`);
});

test('every catalog key the helper\'s code asks for exists, in both languages', () => {
  const dir = path.join(ROOT, 'public/js/ui/harness');
  const src = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const literal = new Set([...src.matchAll(/'(harness\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.')));
  const built = [
    ...['reading', 'building', 'testing', 'fixing', 'applying', 'ready'].map((s) => `harness.pill.step.${s}`),
    ...M.STEPS.map((s) => `harness.step.${s}`),
    ...M.OPS.map((o) => `harness.op.${o}`),
    ...M.FAMILIES.map((f) => `harness.family.${f}`),
    ...['claude', 'chatgpt', 'mock'].flatMap((p) => [`harness.prov.${p}.name`, `harness.prov.${p}.desc`, `harness.signin.${p}.private`]),
    ...['blocked', 'silence', 'network', 'other'].map((c) => `harness.mic.${c}`),
    ...['ex1', 'ex2', 'ex3', 'ex4'].map((k) => `harness.ask.${k}`),
    ...['schema', 'semantic', 'boot', 'render'].flatMap((s) => [`harness.test.${s}.failed`, `harness.test.${s}.skipped`]),
    'harness.test.render', 'harness.test.semantic', 'harness.test.schema.plain', 'harness.test.boot.plain',
  ];
  const missing = [...literal, ...built].filter((k) => !Object.hasOwn(EN, k) || !Object.hasOwn(BG, k));
  assert.deepEqual(missing, []);
  // a key the model hands out
  const rows = M.testRows({ ok: true, checks: { schema: { ok: true }, boot: { ok: true } } });
  for (const r of rows) assert.ok(EN[r.key] && BG[r.key], r.key);
});

test('Bulgarian follows the glossary: опит not XP, the brand in Latin letters, no gendered words about the player', () => {
  for (const [k, v] of Object.entries(BG)) {
    const all = typeof v === 'string' ? [v] : Object.values(v);
    for (const s of all) {
      assert.ok(!/\bXP\b/.test(s), k);
      assert.ok(!/Харвест|Хълоу|Харнес/.test(s), `${k}: Harness Hollow stays in Latin letters`);
      // past participles and adjectives about the player change with gender (owner decision 1)
      assert.ok(!/\b(влязъл|влязла|написал|написала|готов|готова|сигурен|сигурна)\b/i.test(s), `${k}: ${s}`);
    }
  }
  assert.equal(BG['harness.fact.xp'], '+{n} опит');
});

test('progress notes: a known code in the language, English notes only on an English page, no line twice in a row', () => {
  const job = { state: 'working', progress: [{ code: 'read', note: 'Reading mod/' }, { code: 'write', note: 'Writing x' }, { code: 'write', note: 'Writing y' },
    { note: 'Something new' }, { code: 'validate', note: 'Checking' }] };
  assert.deepEqual(M.noteRows(job, 'en'), [{ key: 'harness.note.write' }, { text: 'Something new' }, { key: 'harness.note.validate' }]);
  assert.deepEqual(M.noteRows(job, 'bg'), [{ key: 'harness.note.read' }, { key: 'harness.note.write' }, { key: 'harness.note.validate' }]);
  for (const c of M.NOTE_CODES) assert.ok(EN[`harness.note.${c}`] && BG[`harness.note.${c}`], c);
});
