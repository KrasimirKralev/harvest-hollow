// The mod economy (harness contract §1.5): the pinned tables equal the designer's model, and a mod's numbers follow
// the model's formulas (the contract's worked example, the base crops' own numbers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.js';
import { CROP_GROSS_X100, CRAFT_ADD_X100, cropNumbers, treeNumbers, recipeNumbers, productSell, lvlBp, bounds, cropPerMin } from '../shared/mod/econ.js';
import { LADDERS } from '../shared/mod/format.js';
import { CONTENT, live } from '../shared/content/index.js';

/** The model's own numbers per ladder step (the model prints its checks when imported: a child process keeps them out). */
function fromModel() {
  const src = `const m = await import('./tools/economy-model.mjs');
    const crop = ${JSON.stringify([...LADDERS.cropMin, 600])}; const craft = ${JSON.stringify(LADDERS.recipeMin)};
    process.stderr.write('@@' + JSON.stringify({ crop: Object.fromEntries(crop.map((x) => [x, Math.round(m.cropGross(x, 1) * 100)])),
      craft: Object.fromEntries(craft.map((x) => [x, Math.round(m.craftTime(x, 1) * 100)])) }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(r.stderr.slice(r.stderr.indexOf('@@') + 2));
}

test('the pinned tables equal tools/economy-model.mjs (cropGross, craftTime), every ladder step', () => {
  const m = fromModel();
  for (const x of [...LADDERS.cropMin, 600]) assert.equal(CROP_GROSS_X100[x], m.crop[x], `crop ${x}`);
  for (const x of LADDERS.recipeMin) assert.equal(CRAFT_ADD_X100[x], m.craft[x], `craft ${x}`);
  for (const h of LADDERS.treeHours) assert.ok(CROP_GROSS_X100[h * 60] > 0, `tree ${h} h has a gross`);
});

test('the contract\'s example: 90 min, L14, yield 3, normal -> sell 124, seed 149, xp 47', () => {
  assert.deepEqual(cropNumbers({ growMin: 90, yield: 3, unlock: 14, value: 'normal' }),
    { sell: 124, seed: 149, xp: 47, xp100: 4650, growMs: 90 * 60_000, gross: 372 });
  assert.equal(lvlBp(1), 10_000);
  assert.equal(lvlBp(14), 11_950);
  // humble / rich move the value by 10 %
  assert.equal(cropNumbers({ growMin: 90, yield: 3, unlock: 14, value: 'humble' }).sell, 112);
  assert.equal(cropNumbers({ growMin: 90, yield: 3, unlock: 14, value: 'rich' }).sell, 137);
});

test('a base crop priced like a mod crop gets the game\'s own numbers (the formulas are the model\'s)', () => {
  let same = 0;
  for (const c of live('crops')) {
    const growMin = c.growMs / 60_000;
    if (!Object.hasOwn(CROP_GROSS_X100, growMin)) continue;
    const n = cropNumbers({ growMin, yield: c.yield, unlock: c.unlock, value: 'normal' });
    assert.ok(Math.abs(n.sell - c.sell) <= 1, `${c.id}: ${n.sell} vs ${c.sell}`);
    if (n.sell === c.sell) same++;
  }
  assert.ok(same >= 10, `${same} crops match exactly`);
});

test('trees, recipes and animal products: derived, never chosen; a recipe that adds < 15 % is refused', () => {
  const plum = CONTENT.trees.get('plum_tree');
  const t = treeNumbers({ cycleHours: 6, unlock: 15, value: 'normal' }, plum);
  assert.equal(t.cycleMs, 6 * 3_600_000);
  assert.equal(t.sell, Math.round((58184 * 16 * 12_100 * 10_000) / (1e11 * plum.yield)));
  const items = (id) => CONTENT.items.get(id);
  const r = recipeNumbers({ minutes: 45, unlock: 15, value: 'normal', inputs: { flour: 1, pumpkin: 2 } }, items);
  assert.equal(r.ok, true);
  assert.ok(r.sell * 100 >= r.inValue * 115, 'R3');
  const big = recipeNumbers({ minutes: 5, unlock: 1, value: 'humble', inputs: { pumpkin: 10, cabbage: 10 } }, items);
  assert.equal(big.ok, false, 'a 5-minute recipe for huge inputs adds too little');
  assert.equal(productSell(82, 'rich'), 90);
});

test('bounds: a new crop may not pay much more per minute than the best base crop at its level', () => {
  const crops = live('crops');
  const quick = { ...cropNumbers({ growMin: 1, yield: 3, unlock: 40, value: 'rich' }), yield: 3, growMs: 60_000 };
  assert.equal(bounds('crops', 40, cropPerMin(quick), crops, cropPerMin).ok, false);
  const fair = { ...cropNumbers({ growMin: 90, yield: 3, unlock: 14, value: 'normal' }), yield: 3, growMs: 90 * 60_000 };
  assert.equal(bounds('crops', 14, cropPerMin(fair), crops, cropPerMin).ok, true);
});
