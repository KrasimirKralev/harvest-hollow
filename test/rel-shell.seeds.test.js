// Release 1.0, ui-shell: the seeds on the toolbar. M28 (critique#10, ux-first#14): the seed chips' Barn count never
// shows a bare "0" (it read as "0 seeds"); a crop the barn holds none of carries no badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel } from '../shared/content/index.js';
import { T0 } from './helpers.js';

function rig(inv) {
  const document = installDom();
  for (const [tag, id] of [['div', 'seed-tray'], ['nav', 'toolbar'], ['canvas', 'world']]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.append(el);
  }
  document.getElementById('seed-tray').hidden = true;
  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  globalThis.innerWidth = 1366;
  globalThis.innerHeight = 768;
  const state = createFarm(7, T0);
  state.farm.xp = xpForLevel(5);
  Object.assign(state.farm.inventory, inv);
  const fns = [];
  const store = { state, pid: 'p1', now: () => T0, subscribe() { return () => {}; }, on() { return () => {}; } };
  const controller = { tool: { id: 'seed_bag', crop: 'wheat' }, on: (n, fn) => { fns.push([n, fn]); return () => {}; }, setTool() {} };
  const view = { onFrame() {}, toScreen: () => ({ x: 0, y: 0, visible: true }) };
  return { document, S: { store, controller, view, ui: { toast() {} } } };
}

test('M28: the quick-seed strip shows the Barn count only when the barn holds some ("0" never shows)', async () => {
  const { document, S } = rig({ wheat: 0, corn: 7 });
  const { createSeeds } = await import('../public/js/ui/seeds.js');
  createSeeds(S).renderStrip();
  const chips = document.body.querySelectorAll('.ss-seed');
  assert.ok(chips.length >= 2, 'the strip shows the open crops');
  const badge = (crop) => chips.find((c) => c.dataset.crop === crop)?.querySelector('.ss-n') ?? null;
  assert.equal(badge('wheat'), null, 'no badge on a crop the barn holds none of');
  assert.equal(badge('corn')?.textContent, '7');
});
