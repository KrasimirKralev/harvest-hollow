// Release 1.0, the one chip row (critique#37; harvey "features worth adding" 2; H5): at most three chips under Harvey's box,
// the examples usable at the farm's level, the level-aware suggestions and the answered reply's suggestions in one row.
// Every example chip's mod passes the FULL validator (schema, meaning, the play test on a copy, pictures) at levels 5
// and 21 whenever the row offers it there, so an example never leads to a failure or a "from level N" surprise.
// RED on fdafb9c: the examples were "A pale blue melon that glows at dusk" (no glow in format 1) and "A plum pie for
// the pie oven" (plums arrive at level 23), and no chip knew the farm's level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT } from './helpers.js';
import { CHIPS, chipsAt } from '../shared/mod/examples.js';
import { validateCandidate, bootPool } from '../server/mods/validate.js';
import { bgNamesTable, musicTracks } from '../server/mods/index.js';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel, levelFromXp } from '../shared/content/index.js';
import { chips as chipRow } from '../public/js/ui/harness/model.js';
import EN from '../public/js/i18n/en/harness.js';
import BG from '../public/js/i18n/bg/harness.js';

const NOW = Date.UTC(2026, 9, 14, 10, 0);
const farmAt = (level) => {
  const s = createFarm(7, NOW, 'Europe/Sofia');
  s.farm.xp = xpForLevel(level);
  s.farm.wallet.coins = 20_000;
  return s;
};

test('chips: at most three, the first usable at the farm\'s level; every one has EN and BG words', () => {
  assert.deepEqual(chipsAt(5), ['ex1', 'ex3', 'ex4']);
  assert.deepEqual(chipsAt(21), ['ex1', 'ex2', 'ex3']);
  for (const c of CHIPS) {
    assert.ok(EN[`harness.chip.${c.id}`] && BG[`harness.chip.${c.id}`], c.id);
    assert.doesNotMatch(EN[`harness.chip.${c.id}`], /glow|plum/i, 'no example the format cannot keep');
  }
});

test('chips: the row serves the examples, the level-aware suggestions and the answer\'s suggestions (one row, at most 3)', () => {
  // an empty box: the examples at this level
  assert.deepEqual(chipRow({ level: 5, lang: 'en' }).map((c) => c.key), ['harness.chip.ex1', 'harness.chip.ex3', 'harness.chip.ex4']);
  // Harvey's answer offers what to try instead: those come first, the row stays at three
  const answer = { try: [{ en: 'A Moon Lantern', bg: 'Лунен фенер' }, { en: 'Crops grow 20% faster', bg: 'Посевите да растат с 20 % по‑бързо' }] };
  const row = chipRow({ level: 21, lang: 'bg', answer });
  assert.equal(row.length, 3);
  assert.deepEqual(row.slice(0, 2).map((c) => c.text), ['Лунен фенер', 'Посевите да растат с 20 % по‑бързо']);
  assert.equal(row[2].key, 'harness.chip.ex1');
});

test('chips: every example the row offers passes the full validator at levels 5 and 21', { timeout: 180_000 }, async () => {
  const pool = bootPool({ size: 2, timeoutMs: 60_000 });
  const names = await bgNamesTable(ROOT);
  const bgNames = new Set(Object.values(names).map((e) => (e && typeof e.name === 'string' ? e.name.toLowerCase() : null)).filter(Boolean));
  const tracks = musicTracks(ROOT).map((t) => t.id);
  for (const level of [5, 21]) {
    const state = farmAt(level);
    assert.equal(levelFromXp(state.farm.xp), level);
    for (const id of chipsAt(level, CHIPS.length)) {
      const chip = CHIPS.find((c) => c.id === id);
      const { result } = await validateCandidate({ files: chip.files(level), state, now: NOW, full: true, n: 1, root: ROOT, tracks, bgNames, pool });
      assert.equal(result.ok, true, `L${level} ${id}: ${JSON.stringify(result.errors)}`);
      // nothing it adds arrives later than the farm is now
      const later = Object.values(chip.files(level)).filter((f) => f && Number.isInteger(f.unlock) && f.unlock > level);
      assert.deepEqual(later, [], `L${level} ${id} unlocks above the farm`);
    }
  }
});
