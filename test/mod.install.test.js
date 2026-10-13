// installOverlay (harness contract §2.3): a mod overlay written into the running process's content, seen by every
// lookup the rules, the views and the names read; installOverlay(null) puts the base back exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneTables, CONTENT_HASH, CONTENT, PLACEABLES, live, lookup, defOf, cropOf, itemOf, classMembers, usesOf,
  recipesOf, unlocksAt, liveAt } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { compileMod } from '../shared/mod/compile.js';
import { suspended } from '../shared/mod/apply.js';
import { installOverlay, installedOverlay, onOverlay } from '../shared/mod/install.js';
import { name, setNameOverlay } from '../public/js/i18n/names.js';
import { everything } from '../shared/mod/examples.js';

const base = { tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION };
const overlay = compileMod(base, everything(), { n: 1 }).overlay;
const order = (fam) => [...CONTENT[fam].keys()];

test('install: every lookup sees the mod; null restores the base, in the same order', (t) => {
  t.after(() => installOverlay(null));
  const before = { crops: order('crops'), items: order('items'), placeables: [...PLACEABLES.keys()], wheat: cropOf('wheat'),
    liveCrops: live('crops').length };
  const seen = [];
  const off = onOverlay((o) => seen.push(o ? o.n : null));
  assert.deepEqual(installOverlay(overlay), { hash: overlay.hash, changed: true });
  assert.deepEqual(installOverlay(overlay), { hash: overlay.hash, changed: false }, 'idempotent for the same hash');
  assert.equal(installedOverlay(), overlay);
  assert.equal(live('crops').length, before.liveCrops + 1, 'live() is recomputed (resetDerived)');
  assert.equal(lookup('crops', 'x_moon_melon').sell, 124);
  assert.equal(lookup('placeables', 'x_moon_lantern').cost, 600);
  assert.equal(defOf('x_star_plum_tree').product, 'x_star_plum');
  assert.equal(itemOf('x_moon_egg').source, 'x_moon_hen');
  assert.ok(classMembers('fruit').includes('x_moon_melon'));
  assert.ok(usesOf('x_moon_melon').includes('x_melon_pie'));
  assert.ok(recipesOf('pie_oven').some((r) => r.id === 'x_melon_pie'));
  assert.ok(unlocksAt(14).some((u) => u.id === 'x_moon_melon'));
  assert.ok(liveAt('crops', 14).some((c) => c.id === 'x_moon_melon'));
  assert.equal(cropOf('wheat').growMs, 54_000, 'a tuned base def is patched in place');
  assert.equal(order('crops').indexOf('wheat'), before.crops.indexOf('wheat'));
  assert.ok(defOf('coop').species.includes('x_moon_hen'));
  assert.throws(() => CONTENT.crops.set('x_hack', {}), /read-only/, 'the Maps stay read-only for everyone else');
  setNameOverlay(overlay.names);
  assert.equal(name('x_moon_melon'), 'Moon Melon', 'English names come from the installed defs');
  installOverlay(null);
  setNameOverlay({});
  off();
  assert.deepEqual(seen, [1, null]);
  assert.equal(installedOverlay(), null);
  assert.deepEqual(order('crops'), before.crops);
  assert.deepEqual(order('items'), before.items);
  assert.deepEqual([...PLACEABLES.keys()], before.placeables);
  assert.equal(cropOf('wheat'), before.wheat, 'the very same base def object');
  assert.equal(lookup('crops', 'x_moon_melon'), undefined);
  assert.equal(live('crops').length, before.liveCrops);
  assert.ok(!defOf('coop').species.includes('x_moon_hen'));
});

test('a suspended overlay: the things stay (retired), nothing of them is live for sale', (t) => {
  t.after(() => installOverlay(null));
  installOverlay(suspended(overlay));
  assert.equal(cropOf('x_moon_melon').retired, true);
  assert.equal(cropOf('wheat').growMs, 60_000, 'tuning is dropped');
  assert.ok(defOf('coop').species.includes('x_moon_hen'), 'a retired breed keeps its home');
});
