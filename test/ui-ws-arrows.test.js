// Owner request 2026-10-19 (Rowan): "on the buildings give me an easier way to rotate between them with arrows on top".
// The workshop panel's title plank carries ‹ › that turn the open panel to the previous / next workshop on the farm
// (panels/building.js workshopRing / workshopStep): unlock level, then def id, then object id; round and round. The
// phone layout and the real taps are proven by tools/e2e-coop.mjs step 9b and the screenshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { storyFarm } from './helpers/ui-panels.js';
import { T0 } from './helpers.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const { buildingPanel, workshopRing, workshopStep } = await import('../public/js/ui/panels/building.js');

/** The shell's frame as far as the panel sees it: the title plank (with its h2) and the body. */
function frameOf(state, { now = T0, args = {} } = {}) {
  const frame = document.createElement('section');
  const plank = document.createElement('div');
  plank.className = 'hh-panel-title wood';
  const h2 = document.createElement('h2');
  h2.className = 'hh-panel-title-text';
  plank.append(h2);
  const body = document.createElement('div');
  frame.append(plank, body);
  document.body.append(frame);
  const opened = [];
  const store = { state, pid: 'p1', now: () => now, on: () => () => {}, act: () => ({ ok: true }) };
  const ctx = {
    name: 'building', args, store, body, el: frame, now: () => now, tab: null,
    ui: { panels: { open: (n, a) => { opened.push([n, a]); return true; }, has: () => true, retitle() {}, badge() {} }, toast() {} },
    every: () => () => {}, subscribe: () => () => {},
    on(target, ev, fn) { target.addEventListener(ev, fn); return () => target.removeEventListener(ev, fn); },
    act: () => ({ ok: true }), open() {}, close() {}, setTitle() {}, refreshTabs() {},
    controller: { input: 'mouse', setTool() {}, do: () => ({ ok: true }) },
  };
  return { ctx, frame, plank, body, opened };
}

const arrows = (plank) => plank.querySelectorAll('.pn-wsnav');

test('the ring: every workshop on the farm by unlock level, then def id (the Juice Press before the Sawmill at 6)', () => {
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const want = [ids.feedMill, ids.mill, ids.bakery, ids.press, ids.sawmill, ids.dairy, ids.kitchen];
  assert.ok(want.every(Boolean), 'the story farm has its seven workshops');
  assert.deepEqual(workshopRing(state), want);
  // no animal home, tree, decor or plot is a workshop
  assert.ok(!workshopRing(state).includes(ids.coop) && !workshopRing(state).includes(ids.cowBarn));
  // the order never follows the objects' key order (a save read back in another order walks the same ring)
  const twin = { ...state, farm: { ...state.farm, objects: Object.fromEntries(Object.entries(state.farm.objects).reverse()) } };
  assert.deepEqual(workshopRing(twin), want);
});

test('the ring: a second copy of a workshop comes right after the first, by object id', () => {
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const objects = { ...state.farm.objects, 'zz.copy.0': { ...state.farm.objects[ids.feedMill], x: 2, z: 2 }, '00.copy.0': { ...state.farm.objects[ids.mill], x: 6, z: 2 } };
  const ring = workshopRing({ ...state, farm: { ...state.farm, objects } });
  // the Feed Mills (level 1) by id, then the Windmills (level 3) by id: '00.copy.0' leads its pair, 'zz.copy.0' trails
  assert.deepEqual(ring.slice(0, 4), [...[ids.feedMill, 'zz.copy.0'].sort(), ...['00.copy.0', ids.mill].sort()]);
  assert.equal(ring[1], 'zz.copy.0');
  assert.equal(ring[2], '00.copy.0');
});

test('the step wraps round both ends; one workshop (or an id that is none) has no neighbour', () => {
  const ring = ['a', 'b', 'c'];
  assert.equal(workshopStep(ring, 'a', 1), 'b');
  assert.equal(workshopStep(ring, 'c', 1), 'a');
  assert.equal(workshopStep(ring, 'a', -1), 'c');
  assert.equal(workshopStep(ring, 'b', -1), 'a');
  assert.equal(workshopStep(['a', 'b'], 'a', 1), 'b');
  assert.equal(workshopStep(['a', 'b'], 'a', -1), 'b');
  assert.equal(workshopStep(['a'], 'a', 1), null);
  assert.equal(workshopStep(ring, 'x', 1), null);
  assert.equal(workshopStep([], 'a', -1), null);
});

test('the plank gets ‹ › named after the neighbours; › opens the next workshop in the same panel; destroy takes them off', () => {
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const { ctx, plank, body, opened } = frameOf(state, { args: { id: ids.kitchen } });
  const inst = buildingPanel.mount(body, ctx);
  const [prev, next] = arrows(plank);
  assert.ok(prev && next, 'two arrows on the plank');
  assert.equal(plank.children[0], prev, '‹ before the name');
  assert.equal(plank.children.at(-1), next, '› after the name');
  assert.ok(plank.classList.contains('pn-wsnav-on'));
  assert.equal(prev.textContent, '‹');
  assert.equal(next.textContent, '›');
  // the Kitchen is the last of the ring: › wraps round to the Feed Mill
  assert.equal(prev.getAttribute('aria-label'), 'Previous workshop: Dairy');
  assert.equal(next.getAttribute('aria-label'), 'Next workshop: Feed Mill');
  assert.equal(next.getAttribute('title'), 'Next workshop: Feed Mill');
  assert.equal(next.getAttribute('type'), 'button');
  assert.ok(next.classList.contains('btn'), 'a documented button class (a11y audit: btn)');
  next.click();
  assert.deepEqual(opened.at(-1), ['building', { id: ids.feedMill }]);
  prev.click();
  assert.deepEqual(opened.at(-1), ['building', { id: ids.dairy }]);
  inst.destroy();
  assert.equal(arrows(plank).length, 0);
  assert.ok(!plank.classList.contains('pn-wsnav-on'));
});

test('one workshop on the farm: no arrows; a second one placed while the panel is open brings them', () => {
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const keep = new Set(workshopRing(state).filter((x) => x !== ids.bakery));
  const objects = Object.fromEntries(Object.entries(state.farm.objects).filter(([id]) => !keep.has(id)));
  const lone = { ...state, farm: { ...state.farm, objects } };
  const { ctx, plank, body } = frameOf(lone, { args: { id: ids.bakery } });
  const inst = buildingPanel.mount(body, ctx);
  assert.equal(arrows(plank).length, 0);
  assert.ok(!plank.classList.contains('pn-wsnav-on'));
  // a crop changing does not bring anything
  inst.update({ topics: new Set(['objects']), ids: new Set([Object.keys(objects).find((k) => objects[k].def === 'plot') ?? 'none']) });
  assert.equal(arrows(plank).length, 0);
  // the partner places the Kitchen
  ctx.store.state = { ...lone, farm: { ...lone.farm, objects: { ...objects, [ids.kitchen]: state.farm.objects[ids.kitchen] } } };
  inst.update({ topics: new Set(['objects']), ids: new Set([ids.kitchen]) });
  const [prev, next] = arrows(plank);
  assert.ok(prev && next);
  assert.equal(next.getAttribute('aria-label'), 'Next workshop: Farm Kitchen');
  assert.equal(prev.getAttribute('aria-label'), 'Previous workshop: Farm Kitchen');
  inst.destroy();
});

test('keys: ← → and [ ] turn the panel; a field, a modifier or a held key leaves them alone', () => {
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const { ctx, frame, body, opened } = frameOf(state, { args: { id: ids.bakery } });
  const inst = buildingPanel.mount(body, ctx);
  let prevented = 0;
  const key = (ev) => frame.dispatch('keydown', { target: frame, preventDefault() { prevented += 1; }, ...ev });
  key({ key: 'ArrowRight', code: 'ArrowRight' });
  assert.deepEqual(opened.at(-1), ['building', { id: ids.press }]);
  assert.equal(prevented, 1, 'the controller does not pan the farm too');
  key({ key: 'ArrowLeft', code: 'ArrowLeft' });
  assert.deepEqual(opened.at(-1), ['building', { id: ids.mill }]);
  // a Bulgarian layout types "ш" on the [ key: the physical key counts
  key({ key: 'ш', code: 'BracketLeft' });
  assert.deepEqual(opened.at(-1), ['building', { id: ids.mill }]);
  key({ key: 'щ', code: 'BracketRight' });
  assert.deepEqual(opened.at(-1), ['building', { id: ids.press }]);
  const n = opened.length;
  const input = document.createElement('input');
  body.append(input);
  key({ key: 'ArrowRight', code: 'ArrowRight', target: input });
  key({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true });
  key({ key: 'ArrowRight', code: 'ArrowRight', repeat: true });
  key({ key: 'ArrowRight', code: 'ArrowRight', defaultPrevented: true });
  key({ key: 'ArrowDown', code: 'ArrowDown' });
  const tab = document.createElement('button');
  tab.setAttribute('role', 'tab');
  body.append(tab);
  key({ key: 'ArrowLeft', code: 'ArrowLeft', target: tab });
  assert.equal(opened.length, n, 'none of those turned the panel');
  inst.destroy();
});

test('the labels are in both catalogs (EN and BG, the glossary\'s "работилница")', async () => {
  const en = (await import('../public/js/i18n/en/farm.js')).default;
  const bg = (await import('../public/js/i18n/bg/farm.js')).default;
  assert.equal(en['farm.bld.prev'], 'Previous workshop: {name}');
  assert.equal(en['farm.bld.next'], 'Next workshop: {name}');
  assert.equal(bg['farm.bld.prev'], 'Предишна работилница: {name}');
  assert.equal(bg['farm.bld.next'], 'Следваща работилница: {name}');
});
