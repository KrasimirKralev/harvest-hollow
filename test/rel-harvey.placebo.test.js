// Release 1.0, H2 (harvey#2, critique#38; the owner's answer: remove honestly): the knobs that "applied" and changed
// nothing on screen are gone for NEW mods. look.palette and text/tips.json answer UNSUPPORTED with a hint (the agent then
// says "can't yet"); the agent's work folder is seeded without them; the panel no longer promises colours or tips; the
// music preference and the sky presets stay (the sky's pixel proof is G13's, tools/e2e-harness.mjs and look-perf).
// RED on fdafb9c: a palette or tips mod passed every check and toasted "Harvey changed the farm".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkFiles } from '../shared/mod/schema.js';
import { moonlight } from '../shared/mod/examples.js';
import { SKIES } from '../shared/mod/format.js';
import { SKY_PRESETS } from '../public/js/mod/look.js';
import { buildWorkspace } from '../server/agent/workspace.js';
import { tmpRoot } from './helpers/agent-harness.js';
import EN from '../public/js/i18n/en/harness.js';
import BG from '../public/js/i18n/bg/harness.js';

const codes = (files) => checkFiles(files).map((p) => `${p.code}@${p.file}:${p.path}`);

test('H2: a new mod with look.palette is refused UNSUPPORTED, with a hint the agent can act on', () => {
  const f = { ...moonlight(), 'look.json': { palette: { barn: '#3E6FB0' } } };
  const probs = checkFiles(f).filter((p) => p.file === 'look.json');
  assert.deepEqual(probs.map((p) => `${p.code}@${p.path}`), ['UNSUPPORTED@palette']);
  assert.match(probs[0].hint, /tell the player/);
});

test('H2: a new mod with text/tips.json is refused UNSUPPORTED (tips were never shown)', () => {
  const f = { ...moonlight(), 'text/tips.json': [{ id: 'x_tip_a', en: 'Water early.', bg: 'Поливай рано.' }] };
  assert.ok(codes(f).includes('UNSUPPORTED@text/tips.json:'), codes(f).join(' '));
});

test('H2: what still works stays: the sky presets and the music preference', () => {
  for (const sky of SKIES) assert.deepEqual(codes({ ...moonlight(), 'look.json': { sky } }), [], sky);
  assert.deepEqual(codes({ ...moonlight(), 'look.json': { music: { prefer: ['day-river'] } } }), []);
  // every preset but the default carries a horizon colour (the light on the farm leans toward it: G13)
  for (const sky of SKIES.filter((s) => s !== 'default')) assert.match(SKY_PRESETS[sky].horizon?.[0] ?? '', /^#[0-9A-F]{6}$/i, sky);
});

test('H2: the agent\'s work folder leaves a stored palette and tips out, and request.md says so', async () => {
  const work = path.join(tmpRoot('rh-h2'), 'work');
  await buildWorkspace({ workDir: work, prompts: [{ text: 'a pink fence' }], lang: 'en', catalog: {}, seed: true,
    modFiles: { 'mod.json': { format: 1, title: { en: 'Old', bg: 'Старо' } }, 'look.json': { palette: { grass: '#8FC85A' }, sky: 'golden' },
      'text/tips.json': [{ id: 'x_tip_a', en: 'A tip.', bg: 'Съвет.' }] } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, 'mod', 'look.json'), 'utf8')), { sky: 'golden' });
  assert.equal(fs.existsSync(path.join(work, 'mod', 'text', 'tips.json')), false);
  assert.match(fs.readFileSync(path.join(work, 'request.md'), 'utf8'), /no longer uses: left out of mod\//);
});

test('H2: the panel no longer promises colours or tips (EN and BG)', () => {
  for (const k of ['harness.can', 'harness.intro', 'harness.ask.canLine']) {
    assert.ok(EN[k], `EN ${k}`);
    assert.doesNotMatch(EN[k], /colou?rs?\b(?! of the farm)|\btips?\b/i, `EN ${k}: ${EN[k]}`);
    assert.doesNotMatch(BG[k], /цветове(?! на фермата)|съвети/i, `BG ${k}: ${BG[k]}`);
  }
  // what cannot be done says it plainly
  assert.match(EN['harness.cannot'], /colours of the farm/);
  assert.match(BG['harness.cannot'], /цветовете на фермата/);
});
