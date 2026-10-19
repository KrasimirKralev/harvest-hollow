// QA r4 ui-shell fixes, farm taps and placement (docs/qa/release/qa-r4/fix-ui-shell.md):
//   S4-05 (fbp#3): with the Axe in hand a tap on a building refused ("Axe: nothing to do here") instead of opening it.
//   S4-06 (fbp#5): on touch a blocked placement ghost named nothing until the grey ✓ was pressed.
//   S4-11 (jde#4): "Blocked by the Mabel's Order Board".
//   S4-12 (jde#5): over land the farm does not own, the red ghost gave no reason until a click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { controllerRig } from './helpers/ui-shell.js';
import { ERR } from '../shared/net/protocol.js';

const document = installDom();
document.head = document.createElement('head');
document.documentElement = { clientWidth: 390 };
const TB = await import('../public/js/ui/toolbar.js');
const { name: N } = await import('../public/js/i18n/index.js');   // the shown name of a def (a string)

test('S4-05: a tool with no deed on a building opens it (the Axe, the Sickle, the Watering Can); a tool that acts still acts', async () => {
  const { store, c, ptr, commands, toasts } = await controllerRig();
  const o = (def) => Object.values(store.state.farm.objects).find((x) => x.def === def);
  const barn = o('barn');
  const market = o('market_stand');
  for (const [tool, at, panel] of [['axe', barn, 'barn'], ['sickle', market, 'market'], ['watering_can', barn, 'barn']]) {
    commands.length = 0;
    toasts.length = 0;
    c.setTool(tool);
    ptr.click(at.x + 1, at.z + 1);
    await new Promise((r) => setTimeout(r, 420));          // past the double-click window
    assert.ok(commands.some((x) => x.cmd === 'panel' && x.name === panel),
      `${tool} on the ${at.def}: its panel opens (HEAD: "${tool}: nothing to do here"; ${JSON.stringify(commands)})`);
  }
  // the Axe still clears what it clears: a boulder is chopped, no panel
  const boulder = Object.entries(store.state.farm.objects).find(([, x]) => x.def === 'boulder' || x.def === 'stump' || x.def === 'log');
  if (boulder) {
    commands.length = 0;
    c.setTool('axe');
    const [, b] = boulder;
    ptr.click(b.x, b.z);
    assert.ok(!commands.some((x) => x.cmd === 'panel'), 'debris is chopped, never a panel');
  }
});

test('S4-06: on touch a red ghost says what is in the way under the ⟳ ✕ ✓ bar', async () => {
  const { createTouchBuild } = await import('../public/js/game/touch-build.js');
  const on = {};
  const controller = { input: 'touch', tool: { build: { def: 'feed_mill' } }, on: (ev, fn) => { on[ev] = fn; }, rotate() {}, cancel() {}, confirm() {} };
  const view = { onFrame() {}, toScreen: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) };
  const bar = createTouchBuild({ controller, view, doc: document });
  const why = bar.el.querySelector('.tb-why');
  assert.ok(why, 'a reason line in the touch bar (HEAD: none; only a press on the grey ✓ floated "Пречи кокошарникът")');
  on.build({ def: 'feed_mill', x: 20, z: 20, rot: 0, valid: false, code: ERR.BLOCKED, blocker: 'o7', blockerDef: 'coop' });
  assert.equal(why.hidden, false);
  assert.ok(why.textContent.includes(N('coop')), `it names the Coop: "${why.textContent}"`);
  on.build({ def: 'feed_mill', x: 22, z: 20, rot: 0, valid: true, code: null, blocker: null });
  assert.equal(why.hidden, true, 'a green ghost says nothing');
  // the controller's own event carries the blocker's kind (the bar has no store)
  const { store, c, ptr } = await controllerRig();
  const events = [];
  c.on('build', (e) => events.push(e));
  c.place('feed_mill');
  const barn = Object.values(store.state.farm.objects).find((x) => x.def === 'barn');
  ptr.move(barn.x + 1, barn.z + 1);
  const last = events.filter(Boolean).at(-1);
  assert.equal(last?.valid, false, 'the mill over the Barn is red');
  assert.equal(last.blockerDef, 'barn');
  assert.ok(TB.placeWhy(last).includes(N('barn')), TB.placeWhy(last));
});

test('S4-11: "In the way: Mabel\'s Order Board", never "the Mabel\'s"', async () => {
  const { t, N: thing } = await import('../public/js/i18n/index.js');
  for (const def of ['order_board', 'grandma_rocker']) {
    assert.doesNotMatch(t('dock.why.blocked', { thing: thing(def) }), /\bthe \S+'s\b/i, 'the catalog line (HEAD: "Blocked by the {thing}")');
  }
  for (const def of ['order_board', 'grandma_rocker', 'well']) {
    const s = TB.placeWhy({ valid: false, code: ERR.BLOCKED, blocker: 'x', blockerDef: def });
    assert.ok(s.includes(N(def)), s);
    assert.doesNotMatch(s, /\bthe \S+'s\b/i, `HEAD: "Blocked by the ${N(def)}"`);
  }
});

test('S4-12: over land the farm does not own the red ghost says so before any click', async () => {
  assert.equal(TB.placeWhy({ valid: false, code: ERR.OUT_OF_BOUNDS, blocker: null }), "That land isn't ours yet", 'HEAD: "" (only the click toasted it)');
  assert.equal(TB.placeWhy({ valid: true, code: null }), '');
  assert.equal(TB.placeWhy({ valid: false, code: ERR.BLOCKED, pickUp: 'o1' }), '', 'the Hammer over something it can lift says nothing');
  // the controller sends that code for a ghost off the owned land
  const { c, ptr } = await controllerRig();
  const events = [];
  c.on('build', (e) => events.push(e));
  assert.ok(c.place('feed_mill'));
  ptr.move(1, 1);
  const last = events.filter(Boolean).at(-1);
  assert.equal(last?.code, ERR.OUT_OF_BOUNDS, JSON.stringify(last));
  assert.notEqual(TB.placeWhy(last), '');
});
