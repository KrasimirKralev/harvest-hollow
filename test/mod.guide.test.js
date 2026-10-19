// The agent's guide (docs/mod-guide.md, harness contract §8.2) stays in step with shared/mod/format.js: every ladder,
// enum, limit, file kind and error code the format has is in the guide, and the guide's example files are the ones
// that validate (shared/mod/examples.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { LADDERS, VALUE_BP, SEASONS, CROP_CLASSES, SKIES, LETTER_FROM, TUNING_BP, TUNING_KEYS, LIMITS, FILE_KINDS,
  SINGLE_FILES, CODES, YIELDS, REMOVED } from '../shared/mod/format.js';
import { checkFiles } from '../shared/mod/schema.js';
import { compileMod } from '../shared/mod/compile.js';
import { cloneTables, CONTENT_HASH } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { everything } from '../shared/mod/examples.js';

const guide = fs.readFileSync(path.join(ROOT, 'docs', 'mod-guide.md'), 'utf8');
const flat = guide.replace(/\s+/g, ' ');

test('every ladder is in the guide, in order', () => {
  for (const [k, list] of Object.entries(LADDERS)) assert.ok(flat.includes(list.join(' ')), `${k}: ${list.join(' ')}`);
});

test('every enum and file kind is in the guide', () => {
  const words = [...Object.keys(VALUE_BP), ...SEASONS, ...CROP_CLASSES, ...SKIES, ...LETTER_FROM, ...TUNING_KEYS,
    ...SINGLE_FILES, ...Object.values(FILE_KINDS), ...Object.values(CODES).flat()];
  for (const w of words) assert.ok(guide.includes(w), `"${w}" is not in docs/mod-guide.md`);
  assert.ok(flat.includes(`${YIELDS[0]} or ${YIELDS[1]}`));
  assert.ok(flat.includes(`${TUNING_BP[0]}-${TUNING_BP[1]}`));
});

test('every limit the agent can hit is in the guide', () => {
  const said = [
    `${LIMITS.newPerJob} new things`, `${LIMITS.liveDefs} on a farm`, `${LIMITS.contentFiles} content files`,
    `${LIMITS.fileBytes / 1024} KB a file`, `${LIMITS.modBytes / 1024} KB`, `${LIMITS.nameMin}-${LIMITS.nameMax} characters`,
    `<= ${LIMITS.descMax}`, `letters (<= ${LIMITS.letters})`, `title <= ${LIMITS.letterTitleMax}`,
    `body <= ${LIMITS.letterBodyMax}`, `${LIMITS.inputsMin}-${LIMITS.inputsMax} items`,
    `${LIMITS.inputsMin}-${LIMITS.inputQtyMax} each`, `${LIMITS.classesMin}-${LIMITS.classesMax} of`,
    `${LIMITS.musicMin}-${LIMITS.musicMax} track ids`, `at most ${LIMITS.titleMax} characters`,
  ];
  for (const s of said) assert.ok(flat.includes(s), `"${s}" is not in docs/mod-guide.md`);
});

test('release 1.0 (H2): the guide says the palette and tips are gone, the honest answer, the fastest growMin', () => {
  // the knobs that changed nothing on screen are named as no longer possible, never offered
  assert.ok(flat.includes('`"palette"` is no longer part of the format (UNSUPPORTED)'));
  assert.ok(flat.includes(`\`${REMOVED.tips.file}\` is no longer part of the format (UNSUPPORTED)`));
  assert.ok(!/"palette": \{/.test(guide), 'no palette example');
  assert.ok(!/"x_tip_/.test(guide), 'no tip example');
  // the answer when nothing can be built, the features map and the per-crop speed limit
  assert.ok(flat.includes('"possible": false'));
  assert.ok(flat.includes('docs/game-features.md'));
  assert.ok(flat.includes('fastestGrowMin'));
});

test('the guide\'s complete example files are the validated examples (numbers, anchors, ids)', () => {
  const ex = everything();
  const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  let compared = 0;
  for (const b of blocks) {
    let obj;
    try { obj = JSON.parse(b.replace(/"text": \{ \.\.\. \}/g, '"text": null')); } catch { continue; }
    if (!obj || typeof obj !== 'object' || !obj.id || !obj.like) continue;
    const file = Object.keys(ex).find((p) => p.endsWith(`/${obj.id}.json`));
    assert.ok(file, `the guide's ${obj.id} has an example`);
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'text' && v === null) continue;
      if (k === 'fruit' || k === 'product') { assert.equal(ex[file][k].id, v.id); continue; }
      assert.deepEqual(ex[file][k], v, `${obj.id}.${k}`);
    }
    compared++;
  }
  assert.ok(compared >= 4, `${compared} examples compared`);
  assert.deepEqual(checkFiles(ex), []);
  const r = compileMod({ tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION }, ex, { n: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});
