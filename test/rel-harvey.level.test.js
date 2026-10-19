// Release 1.0, H5 (harvey#5, #6, #18): Harvey knows the farm's level and how fast a crop may grow. The catalog marks
// every anchor `usable` at this farm's level and gives each crop its `fastestGrowMin` (the boot test's economy guard,
// computed the same way); a speed-up that goes too far fails ECON_GUARD with a hint that names the crop and the step;
// request.md says the level and lists the anchors usable at it.
// RED on fdafb9c: no `usable`, no `fastestGrowMin`; the hint was "make the times less short" (the agent had to guess).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { buildCatalog } from '../server/mods/catalog.js';
import { validateCandidate, bootPool } from '../server/mods/validate.js';
import { buildWorkspace } from '../server/agent/workspace.js';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel } from '../shared/content/index.js';
import { tmpRoot } from './helpers/agent-harness.js';

const NOW = Date.UTC(2026, 9, 14, 10, 0);
const farmAt = (level) => { const s = createFarm(11, NOW, 'Europe/Sofia'); s.farm.xp = xpForLevel(level); s.farm.wallet.coins = 20_000; return s; };
const tuned = (id, growMin) => ({ 'mod.json': { format: 1, title: { en: 'Faster', bg: 'Бързи ягоди' } }, 'tuning.json': { crops: { [id]: { growMin } } } });

test('H5: the catalog marks what this farm can use and how fast each crop may grow here', () => {
  const at = (level) => Object.fromEntries(buildCatalog({ level }).crops.map((c) => [c.id, c]));
  const c21 = at(21);
  const c5 = at(5);
  assert.deepEqual(buildCatalog({ level: 21 }).farm, { level: 21 });
  assert.equal(c21.strawberry.usable, true);
  assert.equal(c21.watermelon.usable, false, 'watermelons arrive at 27');
  // the audit's measured table (harvey.md finding 6)
  assert.equal(c5.strawberry.fastestGrowMin, 60, 'level 5: strawberry 45 fails (133 %)');
  assert.equal(c21.strawberry.fastestGrowMin, 45);
  assert.equal(c21.tomato.fastestGrowMin, 30, 'level 21: tomato 20 fails (130 %)');
  assert.equal(c21.carrot.fastestGrowMin, 2);
  assert.equal(c21.potato.fastestGrowMin, 120, 'half: the compiler\'s own floor');
  const cat = buildCatalog({ level: 21 });
  assert.equal(cat.animals.find((a) => a.id === 'alpaca').usable, false, 'alpacas (the llama look) from 33');
  assert.equal(cat.decor.find((d) => d.id === 'picket_fence').usable, true);
  assert.equal(buildCatalog({}).crops[0].usable, undefined, 'no level, no claim either way');
});

test('H5: the guard\'s hint names the crop and the step; the fastest step passes, one faster fails', { timeout: 120_000 }, async () => {
  const pool = bootPool({ size: 2, timeoutMs: 60_000 });
  const state = farmAt(21);
  const run = async (files) => (await validateCandidate({ files, state, now: NOW, full: true, n: 1, root: ROOT, pool })).result;
  const fast = await run(tuned('strawberry', 30));
  assert.equal(fast.ok, false);
  const guard = fast.errors.find((e) => e.code === 'ECON_GUARD');
  assert.ok(guard, JSON.stringify(fast.errors));
  assert.equal(guard.hint, 'strawberry: 45 or longer on this farm');
  const ok = await run(tuned('strawberry', 45));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const young = await validateCandidate({ files: tuned('strawberry', 45), state: farmAt(5), now: NOW, full: true, n: 1, root: ROOT, pool });
  assert.equal(young.result.errors.find((e) => e.code === 'ECON_GUARD')?.hint, 'strawberry: 60 or longer on this farm');
});

test('H5: request.md carries the farm\'s level and the anchors usable at it (catalog compact, one entry a line)', async () => {
  const work = path.join(tmpRoot('rh-h5'), 'work');
  await buildWorkspace({ workDir: work, prompts: [{ text: 'A llama' }], lang: 'en', catalog: buildCatalog({ level: 21 }), modFiles: null, seed: true, level: 21 });
  const req = fs.readFileSync(path.join(work, 'request.md'), 'utf8');
  assert.match(req, /The farm is at level 21\./);
  assert.match(req, /## Anchors you can use at level 21/);
  assert.match(req, /^- animals: .*\bchicken\b/m);
  assert.doesNotMatch(req.split('## Anchors')[1].split('\n').find((l) => l.startsWith('- animals')), /\balpaca\b/, 'not yet usable');
  const crops = fs.readFileSync(path.join(work, 'docs', 'catalog', 'crops.json'), 'utf8');
  assert.equal(crops.split('\n')[0], '[');
  assert.match(crops.split('\n')[1], /^\{"id":"wheat",.*"fastestGrowMin":\d+/);
});
