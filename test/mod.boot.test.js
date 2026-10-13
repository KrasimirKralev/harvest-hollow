// Stage 3 (harness contract §3): the boot test on a copy of a farm, in a worker thread, through the real rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneTables, CONTENT_HASH, cropOf, xpForLevel } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { compileMod } from '../shared/mod/compile.js';
import { installedOverlay } from '../shared/mod/install.js';
import { bootTest, cropDay } from '../server/mods/boot.js';
import { bootPool } from '../server/mods/validate.js';
import { makeFarm, T0 } from './helpers.js';
import { moonlight, everything } from '../shared/mod/examples.js';

const base = { tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION };
const overlayOf = (files) => compileMod(base, files, { n: 1 }).overlay;
const farm = (level = 5) => { const s = makeFarm(); s.farm.xp = xpForLevel(level); return s; };

test('every family is played once on a copy; 48 hours, the economy guard and the retire check pass', () => {
  const state = farm();
  const before = JSON.stringify(state);
  const r = bootTest({ overlay: overlayOf(everything()), state, now: T0, full: true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.checks.perDef.x_moon_melon, ['plant', 'harvest', 'sell']);
  assert.deepEqual(r.checks.perDef.x_melon_pie, ['craft', 'collect', 'sell']);
  assert.deepEqual(r.checks.perDef.x_star_plum_tree, ['place', 'harvest', 'sell']);
  assert.deepEqual(r.checks.perDef.x_moon_hen, ['buy', 'feed', 'collect', 'sell']);
  assert.deepEqual(r.checks.perDef.x_moon_lantern, ['place', 'move', 'sell']);
  assert.equal(r.checks.simHours, 48);
  assert.equal(r.checks.retire, true);
  assert.deepEqual(r.checks.econ, { coinsBp: 11_111, xpBp: 11_111 }, 'growTimeBp 9000 = 1/0.9 per hour');
  assert.equal(JSON.stringify(state), before, 'the farm itself is never touched');
  assert.equal(installedOverlay(), null, 'the overlay is removed again');
});

test('quick mode (the agent\'s validate tool): the per-def steps only', () => {
  const r = bootTest({ overlay: overlayOf(moonlight()), state: farm(), now: T0, full: false });
  assert.equal(r.ok, true);
  assert.equal(r.checks.simHours, 0);
  assert.equal(r.checks.econ, null);
});

test('the economy guard refuses a crop day worth more than 130 % of the game\'s', () => {
  const o = structuredClone(overlayOf(moonlight()));
  o.patch.crops = [{ ...structuredClone(cropOf('wheat')), growMs: 20_000 }];   // a third of the time: never compiled, caught here
  const r = bootTest({ overlay: o, state: farm(1), now: T0, full: true });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'ECON_GUARD');
});

test('a broken overlay (a crop without its item) fails the boot with the file it names', () => {
  const o = structuredClone(overlayOf(moonlight()));
  o.defs.items = o.defs.items.filter((i) => i.id !== 'x_moon_melon');
  o.defs.recipes = [];
  const r = bootTest({ overlay: o, state: farm(), now: T0, full: false });
  assert.equal(r.ok, false);
  assert.ok(['BOOT_THROW', 'ACTION_REJECTED', 'STATE_INVALID'].includes(r.errors[0].code), JSON.stringify(r.errors));
  assert.equal(installedOverlay(), null);
});

test('cropDay: the best greedy crop day at a level', () => {
  const d1 = cropDay(1);
  const d10 = cropDay(10);
  assert.ok(d1.coins > 0 && d10.coins >= d1.coins);
});

test('the pool runs the test in a worker thread; a stuck one is a TIMEOUT', async () => {
  const pool = bootPool({ size: 1 });
  const ok = await pool.run({ overlay: overlayOf(moonlight()), state: farm(), now: T0, full: false });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const slow = await pool.run({ overlay: overlayOf(everything()), state: farm(), now: T0, full: true }, { timeoutMs: 1 });
  assert.equal(slow.ok, false);
  assert.equal(slow.errors[0].code, 'TIMEOUT');
});
