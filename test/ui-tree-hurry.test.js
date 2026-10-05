// "Finish now" on a growing fruit tree (owner 2026-10-05): the HUD card offers the rules' own hurry for trees too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel } from '../shared/content/index.js';
import { hurryCost } from '../shared/rules/actions/boosts.js';
import { treeHurry, plotHurry } from '../public/js/ui/crop-hurry.js';
import { worldTip } from '../public/js/ui/hud.js';
import { farmAt, must, placeDef, idsOf, T0, MIN } from './helpers/rules.js';

const orchard = () => {
  const s = farmAt(12);
  const id = placeDef(s, 'apple_tree', { confirm: ['BIG_SPEND'], now: T0 });
  return { s, id };
};

test('treeHurry: the rules\' own price and verdict for a growing tree; nothing once it is ready', () => {
  const { s, id } = orchard();
  const now = T0 + MIN;
  const m = treeHurry(s, id, now, 'p1');
  assert.ok(m, 'a growing tree can be finished');
  assert.equal(m.acorns, hurryCost(s.farm.objects[id].readyAt - now));
  assert.equal(m.code, null);
  assert.equal(worldTip(s, { kind: 'object', id }, now, 'p1').kind, 'tree', 'the card knows it is a tree');
  const r = must(s, 'hurry', { id }, { now });
  assert.equal(r.tx.events.find((e) => e.e === 'hurried').acorns, m.acorns);
  assert.equal(treeHurry(s, id, now, 'p1'), null, 'finished: ready now');
  assert.equal(worldTip(s, { kind: 'object', id }, now, 'p1').ready, true);
});

test('treeHurry: only trees, and locked below the Hurry level', () => {
  const { s, id } = orchard();
  s.farm.xp = xpForLevel(3);                        // below the Hurry level (setup writes the state directly)
  assert.equal(treeHurry(s, id, T0 + MIN, 'p1').code, 'LOCKED');
  const plot = idsOf(s, 'plot')[0];
  if (plot) assert.equal(treeHurry(s, plot, T0, 'p1'), null, 'a plot is plotHurry\'s');
  assert.equal(plotHurry(s, id, T0 + MIN, 'p1'), null, 'a tree is not a plot');
  assert.equal(treeHurry(s, 'no.such.tree', T0, 'p1'), null);
});
