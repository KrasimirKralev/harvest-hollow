// First-time play-test fixes (verify-1 B3, 2026-10-19; docs/qa/release/build/lead/first-time/findings.md):
//   FT-1  the seed card's "до 13:17" read as a clock time with no label; a crop that ripens within the hour says how long
//         it takes ("след 1 мин"), the coach's own words ("узрява след 0:31"); an hour and more keeps the clock (D3)
//   FT-2  the picker sat on Grandma's card at 360 x 640 and cut her line to "...а и избери": her card is the picker's
//         floor like the bar under it
//   FT-4  with Wheat still in the Hand a first-timer could not tell whether a drag over ripe Wheat harvests or plants
//         (it harvests): the harvest step says so while the Hand holds a seed
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setLang } from '../public/js/i18n/index.js';
import { cropOf } from '../shared/content/index.js';

const SEEDS = await import('../public/js/ui/seeds.js');
const TUT = await import('../public/js/ui/tutorial.js');
const EN = (await import('../public/js/i18n/en/dock.js')).default;
const BG = (await import('../public/js/i18n/bg/dock.js')).default;
const tz = 'Europe/Sofia';
const at = Date.UTC(2026, 9, 19, 10, 16);                       // 13:16 in Sofia

test('FT-1: a crop that ripens within the hour shows how long it grows on its card, in both languages', async () => {
  await setLang('en');
  assert.equal(SEEDS.readyText(at, cropOf('wheat').growMs, tz, { short: true }), 'in 1m', 'HEAD: "by 13:17"');
  assert.equal(SEEDS.readyText(at, 30_000, tz, { short: true }), 'in 30s');
  assert.equal(SEEDS.readyText(at, 10 * 60_000, tz, { short: true }), 'in 10m');
  // a card is narrow: whole minutes from one minute up (a boosted 1 m 48 s reads "in 2m")
  assert.equal(SEEDS.readyText(at, 108_000, tz, { short: true }), 'in 2m');
  await setLang('bg');
  assert.equal(SEEDS.readyText(at, cropOf('wheat').growMs, tz, { short: true }), 'след 1 мин', 'HEAD: "до 13:17"');
  assert.equal(SEEDS.readyText(at, 30_000, tz, { short: true }), 'след 30 сек');
  // an hour and more keeps the clock (D3 / QA r3 S3-08: the Strawberry is ready "до 14:16")
  assert.equal(SEEDS.readyText(at, 60 * 60_000, tz, { short: true }), 'до 14:16');
  await setLang('en');
  assert.equal(SEEDS.readyText(at, 60 * 60_000, tz, { short: true }), 'by 14:16');
  // the long form (the card's spoken label) keeps the clock beside the duration it already says
  assert.equal(SEEDS.readyText(at, cropOf('wheat').growMs, tz), 'ready 13:17');
  assert.equal(EN['dock.seed.in'], 'in {d}');
  assert.equal(BG['dock.seed.in'], 'след {d}');
});

test('FT-2: the picker keeps above Grandma\'s card like the bar (the ft1 360 x 640 numbers)', () => {
  assert.ok(Array.isArray(SEEDS.FLOOR_SELECTORS), 'seeds.js exports FLOOR_SELECTORS');
  assert.ok(SEEDS.FLOOR_SELECTORS.includes('#coach-slot .coach'), 'her card is a floor (HEAD: the toolbar and the dock only)');
  assert.ok(SEEDS.FLOOR_SELECTORS.includes('#toolbar') && SEEDS.FLOOR_SELECTORS.includes('#dock'));
  // the plot under the arrow at (127, 218); the two-row card 183 x 255; her card's top at 445, the bar's at 560
  const pt = { x: 127, y: 218 };
  const size = { w: 183, h: 255 };
  const head = SEEDS.popPlacement(pt, size, { w: 360, h: 560 }, { margin: 12 });
  assert.ok(head.top + size.h > 445, 'HEAD: below the plot, over her line');
  const now = SEEDS.popPlacement(pt, size, { w: 360, h: 445 }, { margin: 12 });
  assert.ok(now.top + size.h <= 445 - 12, `clear of her card (bottom ${now.top + size.h})`);
  // on a small phone the level-1 picker (Wheat and two locked seeds) is one row, short enough to sit under its plot
  const css = fs.readFileSync(new URL('../public/css/mobile.css', import.meta.url), 'utf8');
  const small = css.slice(css.indexOf('@media (max-width: 600px) and (max-height: 760px)'));
  assert.match(small.slice(0, small.indexOf('\n}')), /\.sp-grid:not\(:has\(> :nth-child\(4\)\)\) \{ grid-template-rows: auto; \}/);
  const row = SEEDS.popPlacement(pt, { w: 268, h: 132 }, { w: 360, h: 445 }, { margin: 12 });
  assert.equal(row.below, true, 'one row fits under the plot');
  assert.equal(row.side, null);
});

test('FT-4: while the Hand holds a seed the harvest step says a drag over ripe Wheat harvests it', () => {
  const c = { step: { id: 'harvest_wheat' }, have: 0, need: 6, waiting: false };
  assert.equal(TUT.lineKeyOf(c, { id: 'hand', seeding: true, crop: 'wheat' }), 'dock.coach.harvestSeeding');
  assert.equal(TUT.lineKeyOf(c, { id: 'hand', seeding: false, crop: 'wheat' }), null, 'the bare Hand keeps the step\'s words');
  assert.equal(TUT.lineKeyOf(c), null);
  assert.equal(TUT.lineKeyOf({ ...c, waiting: true }, { id: 'hand', seeding: true }), null);
  // the first-seed line is unchanged
  assert.equal(TUT.lineKeyOf({ step: { id: 'plant_wheat' }, have: 0, waiting: false }), 'dock.coach.firstSeed');
  assert.match(EN['dock.coach.harvestSeeding'], /ripe Wheat.*harvest.*seed/i);
  assert.match(BG['dock.coach.harvestSeeding'], /узрялата пшеница.*прибира.*сем/);
});
