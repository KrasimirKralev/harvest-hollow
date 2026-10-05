// The controller end to end in node: fake canvas + fake view (picks are tiles), the REAL SyncStore, rules and Engine
// (coopHarness). Proves the input model of GDD §7.1: drag-paint acts on every same-kind target under the stroke
// exactly once, as one action per frame; brushes; Smart Hand; build mode with the dry-run ghost; move; undo.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf, xpForLevel } from '../shared/content/index.js';
import { tileOwner, canPlace } from '../shared/rules/grid.js';
import { coopHarness, plain } from './helpers/client.js';

const WHEAT = cropOf('wheat');
const PX = 10;                               // one tile = 10 css px on the fake canvas

/** A tiny event target: addEventListener + dispatch(type, props) with a plain event object. */
function target() {
  const fns = new Map();
  return {
    style: {},
    addEventListener(t, fn) { if (!fns.has(t)) fns.set(t, []); fns.get(t).push(fn); },
    removeEventListener(t, fn) { fns.set(t, (fns.get(t) || []).filter((f) => f !== fn)); },
    dispatch(t, props = {}) {
      const ev = { type: t, timeStamp: performance.now(), preventDefault() {}, stopPropagation() {}, ...props };
      for (const fn of fns.get(t) || []) fn(ev);
      return ev;
    },
  };
}

function fakeWorld(store) {
  const canvas = Object.assign(target(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64 * PX, height: 64 * PX }),
    setPointerCapture() {},
  });
  const calls = { ghost: [], highlight: [], fx: [], hidden: [], grid: [] };
  const frames = new Set();
  const view = {
    pick(ndc) {
      const cx = ((ndc.x + 1) / 2) * 64 * PX;
      const cy = ((1 - ndc.y) / 2) * 64 * PX;
      const px = cx / PX;
      const pz = cy / PX;
      const x = Math.floor(px);
      const z = Math.floor(pz);
      const id = tileOwner(store.state, x, z);
      return id ? { kind: 'object', id, x, z, px, pz } : { kind: 'tile', x, z, px, pz };
    },
    ghost: { show: (d, r) => calls.ghost.push(['show', d, r]), hide: () => calls.ghost.push(['hide']), update: (t, v, c, b) => calls.ghost.push(['update', t, v, c, b]) },
    grid: (v) => calls.grid.push(v),
    objects: { hidden: (id, h) => calls.hidden.push([id, h]) },
    highlight: (tiles, style) => calls.highlight.push([tiles, style]),
    fx: { play: (ev) => calls.fx.push(ev) },
    camera: { get: () => ({ tx: 0, tz: 0, dist: 55, yaw: Math.PI / 4 }), pan() {}, zoom() {}, rotate() {} },
    focus() {}, invalidate() {}, interact() {},
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    partner: { pose: () => null },
    toScreen: () => ({ x: 0, y: 0, visible: true }),
  };
  return { canvas, view, calls, frame: (dt = 0.016) => { for (const fn of frames) fn(dt, 0); } };
}

let globals = null;
beforeEach(() => {
  globals ??= { window: globalThis.window };
  globalThis.window = target();
});

async function setup() {
  const h = coopHarness();
  const store = h.a.store;
  const w = fakeWorld(store);
  const toasts = [];
  const sent = [];
  const avatar = { pose: { x: 0, z: 0 }, goes: [], walkTo() {}, goTo(x, z) { this.goes.push([x, z]); return { x, z, reached: true }; }, setCursor() {}, setTool() {} };
  const { createController } = await import('../public/js/game/controller.js');
  const c = createController({ store, view: w.view, avatar, canvas: w.canvas, send: (m) => sent.push(m), toast: (code, o) => toasts.push([code, o]) });
  const at = (x, z) => ({ clientX: (x + 0.5) * PX, clientY: (z + 0.5) * PX, pointerId: 1 });
  const ptr = {
    down: (x, z, o = {}) => w.canvas.dispatch('pointerdown', { button: 0, ...at(x, z), ...o }),
    move: (x, z, o = {}) => w.canvas.dispatch('pointermove', { ...at(x, z), ...o }),
    up: (x, z, o = {}) => w.canvas.dispatch('pointerup', { button: 0, ...at(x, z), ...o }),
    click(x, z, o) { this.down(x, z, o); this.up(x, z, o); },
  };
  return { h, store, w, c, ptr, toasts, sent, avatar };
}

const plotsSorted = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot')
  .sort((a, b) => s.farm.objects[a].z - s.farm.objects[b].z || s.farm.objects[a].x - s.farm.objects[b].x);

test('drag-paint: one press + a fast swipe plants every plot of the row once, one action per frame', async () => {
  const { h, store, c, ptr } = await setup();
  const plots = plotsSorted(store.state);
  const row = plots.filter((id) => store.state.farm.objects[id].z === store.state.farm.objects[plots[0]].z);
  const o = (id) => store.state.farm.objects[id];
  c.setTool('seed_bag', { crop: 'wheat' });
  const seq0 = store.seq;
  const strokes = [];
  c.on('stroke', (s) => strokes.push(s));
  ptr.down(o(row[0]).x, o(row[0]).z);
  ptr.move(o(row.at(-1)).x, o(row.at(-1)).z);         // one frame jumps across the whole row
  ptr.move(o(row[1]).x, o(row[1]).z);                 // back over planted plots: nothing twice
  ptr.up(o(row[1]).x, o(row[1]).z);
  for (const id of row) assert.equal(o(id).crop?.def, 'wheat', `${id} planted`);
  assert.equal(store.seq - seq0, 2, 'the press + one batched action for the swipe');
  assert.deepEqual(strokes.at(-1), { verb: 'plant', count: row.length, item: 'wheat', active: false });
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state), 'the server agrees');
});

test('a stroke only continues on targets of its own kind (harvest skips growing plots silently)', async () => {
  const { h, store, c, ptr, toasts } = await setup();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  const row = plots.filter((id) => o(id).z === o(plots[0]).z);
  for (const id of row.slice(0, 2)) store.act('plant', { id, crop: 'wheat' });
  h.flush();
  h.clock.advance(WHEAT.growMs);
  store.act('plant', { id: row[2], crop: 'wheat' });  // still growing when the sickle passes
  c.setTool('sickle');
  ptr.down(o(row[0]).x, o(row[0]).z);
  for (const id of row.slice(1)) ptr.move(o(id).x, o(id).z);
  ptr.up(o(row.at(-1)).x, o(row.at(-1)).z);
  assert.equal(o(row[0]).crop, null);
  assert.equal(o(row[1]).crop, null);
  assert.equal(o(row[2]).crop?.def, 'wheat', 'the growing plot was not touched');
  assert.equal(toasts.length, 0, 'no toast for the skipped plot');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('Smart Hand: an empty plot opens the seed picker there (it never plants by itself); harvest on ripe; Shift uproots', async () => {
  const { h, store, c, ptr } = await setup();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  const cmds = [];
  c.on('command', (x) => cmds.push(x));
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.equal(o(plots[0]).crop, null, 'the hand never plants a seed nobody chose (GDD §9 #49)');
  assert.deepEqual(cmds.map((x) => [x.cmd, x.id, x.x, x.z]), [['seedPicker', plots[0], o(plots[0]).x, o(plots[0]).z]]);
  c.setTool('seed_bag', { crop: 'wheat' });
  c.setTool('hand');
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.equal(o(plots[0]).crop, null, 'with a seed chosen earlier the Hand still asks (live requests 2026-10-04)');
  assert.equal(cmds.at(-1).cmd, 'seedPicker');
  assert.equal(cmds.at(-1).crop, 'wheat', 'the picker knows the last seed');
  // a press on an empty plot that drags pans: no picker, nothing planted
  ptr.down(o(plots[1]).x, o(plots[1]).z);
  ptr.move(o(plots[1]).x + 3, o(plots[1]).z + 3);
  ptr.up(o(plots[1]).x + 3, o(plots[1]).z + 3);
  assert.equal(cmds.length, 2, 'a drag from an empty plot is a pan');
  // the seeds that the Seed Bag plants do as before
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  ptr.click(o(plots[1]).x, o(plots[1]).z);
  assert.equal(o(plots[0]).crop?.def, 'wheat');
  c.setTool('hand');
  h.flush();
  h.clock.advance(WHEAT.growMs);
  const wheat0 = store.state.farm.inventory.wheat ?? 0;
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.equal(store.state.farm.inventory.wheat, wheat0 + WHEAT.yield, 'ripe -> harvest');
  store.act('plant', { id: plots[0], crop: 'wheat' });
  ptr.click(o(plots[0]).x, o(plots[0]).z, { shiftKey: true });
  assert.equal(o(plots[0]).crop, null, 'Shift + Hand uproots');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('the seed picker\'s pick plants that plot at once and leaves the Seed Bag in hand with that crop', async () => {
  const { h, store, c, ptr, toasts } = await setup();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  const tools = [];
  c.on('tool', (t) => tools.push(t.id));
  const seq0 = store.seq;
  const r = c.plantWith('wheat', plots[2]);
  assert.equal(r.ok, true);
  assert.equal(o(plots[2]).crop?.def, 'wheat', 'planted through the predicted path');
  assert.equal(store.seq - seq0, 1, 'one action');
  assert.deepEqual([c.tool.id, c.tool.crop], ['seed_bag', 'wheat'], 'seed mode with that crop');
  assert.ok(tools.includes('seed_bag'));
  // then a drag over the next plots plants more of it
  const row = plots.filter((id) => o(id).z === o(plots[0]).z && !o(id).crop);
  ptr.down(o(row[0]).x, o(row[0]).z);
  ptr.move(o(row.at(-1)).x, o(row.at(-1)).z);
  ptr.up(o(row.at(-1)).x, o(row.at(-1)).z);
  for (const id of row) assert.equal(o(id).crop?.def, 'wheat');
  // a plot that is no longer empty (the partner was quicker): the reason, nothing planted twice
  assert.equal(c.plantWith('wheat', plots[2]), null);
  assert.ok(toasts.length >= 1);
  assert.equal(c.plantWith('not_a_crop', plots[3]), null, 'an unknown crop does nothing');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state), 'the server agrees');
});

test('the Seed Bag\'s brush wears the chosen crop\'s colour', async () => {
  const { w, c, ptr } = await setup();
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.move(40, 40);
  assert.equal(w.calls.highlight.at(-1)[1], cropOf('wheat').hue);
  c.setTool('sickle');
  ptr.move(41, 40);
  assert.equal(w.calls.highlight.at(-1)[1], 'harvest', 'other tools keep their style');
});

test('click-to-walk: the Hand on open ground walks my farmer to that exact point; other tools and a drag do not', async () => {
  const { c, ptr, w, avatar } = await setup();
  const walks = [];
  c.on('walk', (x) => walks.push(x));
  ptr.click(12, 50);                                   // grass, no object
  assert.deepEqual(avatar.goes.at(-1), [12.5, 50.5], 'the click point, not the tile corner');
  assert.equal(walks.length, 1);
  ptr.click(13, 50);
  assert.equal(avatar.goes.length, 2, 'a second click re-targets');
  ptr.down(14, 50); ptr.move(20, 54); ptr.up(20, 54);
  assert.equal(avatar.goes.length, 2, 'a drag on grass pans');
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.click(12, 50);
  assert.equal(avatar.goes.length, 2, 'only the Hand walks');
  void w;
});

test('right-click is unchanged: a right press and release keeps the tool, a right drag pans', async () => {
  const { c, w, ptr } = await setup();
  c.setTool('seed_bag', { crop: 'wheat' });
  let pans = 0;
  w.view.camera.pan = () => { pans++; };
  ptr.down(30, 50, { button: 2 });
  ptr.up(30, 50, { button: 2 });
  assert.deepEqual([c.tool.id, c.tool.crop], ['seed_bag', 'wheat']);
  ptr.down(30, 50, { button: 2 });
  ptr.move(36, 54);
  w.frame();
  ptr.up(36, 54, { button: 2 });
  assert.ok(pans > 0, 'panned');
  assert.equal(c.tool.id, 'seed_bag');
});

test('the 3x3 Big Watering Can paints a 3x3 patch per step', async () => {
  const { store, c } = await setup();
  store.state.farm.xp = xpForLevel(10);
  store.state.farm.tools = { big_watering_can: 1 };
  c.setTool('watering_can');
  assert.deepEqual(c.tool.brush, [3, 3]);
});

test('build mode: the ghost shows the dry run and the reason; a click places; buildings return to the Hand', async () => {
  const { h, store, w, c, ptr } = await setup();
  store.state.farm.xp = xpForLevel(5);
  store.state.farm.wallet.coins = 50_000;
  h.state.farm.xp = xpForLevel(5);
  h.state.farm.wallet.coins = 50_000;
  assert.equal(c.place('coop'), true);
  // a blocked tile first: the ghost goes invalid with BLOCKED and the blocker's id
  const plot = plotsSorted(store.state)[0];
  const po = store.state.farm.objects[plot];
  ptr.move(po.x + 1, po.z + 1);
  const bad = w.calls.ghost.filter((g) => g[0] === 'update').at(-1);
  assert.equal(bad[2], false);
  assert.equal(bad[3], 'BLOCKED');
  assert.ok(bad[4], 'the blocker id is passed ("Blocked by Mia\'s Coop")');
  // a free spot: valid, and a click places it from the build tray
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'coop', x - 1, z - 1, 0) === null) spot = { x, z };
  ptr.move(spot.x, spot.z);
  const good = w.calls.ghost.filter((g) => g[0] === 'update').at(-1);
  assert.equal(good[2], true, `valid at ${JSON.stringify(spot)}`);
  ptr.click(spot.x, spot.z);
  const coop = Object.keys(store.state.farm.objects).find((id) => store.state.farm.objects[id].def === 'coop');
  assert.ok(coop, 'placed');
  assert.equal(store.state.farm.objects[coop].x, spot.x - 1, 'the footprint is centred on the cursor tile');
  assert.equal(c.tool.id, 'hand', 'a building returns to the Hand');
  assert.equal(c.tool.build, null);
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('hammer: click picks an object up, a click puts it down elsewhere (move), Ctrl+Z moves it back', async () => {
  const { h, store, w, c, ptr } = await setup();
  const plot = plotsSorted(store.state)[0];
  const po0 = { ...store.state.farm.objects[plot] };
  c.setTool('hammer');
  ptr.click(po0.x, po0.z);                            // pick up
  assert.equal(c.tool.build.moveId, plot);
  assert.deepEqual(w.calls.hidden.at(-1), [plot, true]);
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'plot', x, z, 0, plot) === null && Math.abs(x - po0.x) > 3) spot = { x, z };
  ptr.move(spot.x, spot.z);
  ptr.click(spot.x, spot.z);
  assert.equal(store.state.farm.objects[plot].x, spot.x, 'moved');
  assert.equal(c.tool.build.moveId, null, 'the hammer is free again');
  h.flush();
  window.dispatch('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, target: {} });
  assert.equal(store.state.farm.objects[plot].x, po0.x, 'Ctrl+Z moved it back (10-minute window)');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('keys: physical codes switch tools (any layout); a locked tool refuses with a reason', async () => {
  const { store, c, toasts } = await setup();
  window.dispatch('keydown', { code: 'Digit3', key: '3', target: {} });
  assert.equal(c.tool.id, 'sickle');
  window.dispatch('keydown', { code: 'KeyH', key: 'х', target: {} });       // Bulgarian layout: e.key is Cyrillic
  assert.equal(c.tool.id, 'hand');
  store.state.farm.xp = 0;
  window.dispatch('keydown', { code: 'Digit7', key: '7', target: {} });     // the Compost Scoop is L8
  assert.equal(c.tool.id, 'hand');
  assert.equal(toasts.at(-1)[0], 'LOCKED');
  window.dispatch('keydown', { code: 'Digit2', key: '2', target: { tagName: 'INPUT' } });
  assert.equal(c.tool.id, 'hand', 'typing in a text field never switches tools');
});

test('latency samples close on the next rendered frame', async () => {
  const { store, w, c, ptr } = await setup();
  const plots = plotsSorted(store.state);
  const o = (id) => store.state.farm.objects[id];
  c.setTool('seed_bag', { crop: 'wheat' });
  ptr.click(o(plots[0]).x, o(plots[0]).z);
  assert.equal(c.latency().n, 0);
  w.frame();
  const l = c.latency();
  assert.equal(l.n, 1);
  assert.ok(l.last >= 0 && l.last < 1000);
});

test('BIG_SPEND: the click asks the ui (soft code with type + args); the confirmed resend places and leaves build mode', async () => {
  const { h, store, c, ptr, toasts } = await setup();
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(5); s.farm.wallet.coins = 6000; }
  assert.equal(c.place('bakery'), true);
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'bakery', x - 1, z - 1, 0) === null) spot = { x, z };
  ptr.move(spot.x, spot.z);
  ptr.click(spot.x, spot.z);
  const [code, o] = toasts.at(-1);
  assert.equal(code, 'BIG_SPEND');
  assert.equal(o.type, 'place');
  assert.deepEqual(o.args, { def: 'bakery', x: spot.x - 1, z: spot.z - 1, rot: 0 });
  assert.ok(!Object.values(store.state.farm.objects).some((x) => x.def === 'bakery'), 'nothing spent before the yes');
  const r = c.do(o.type, { ...o.args, confirm: ['BIG_SPEND'] });         // what ui/dialogs.js softConfirm does
  assert.equal(r.ok, true);
  assert.equal(c.tool.build, null, 'the confirmed purchase leaves build mode');
  assert.equal(c.tool.id, 'hand');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('Ctrl+Z refunds my newest purchase while it is pristine', async () => {
  const { h, store, c, ptr } = await setup();
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(3); s.farm.wallet.coins = 5000; }
  assert.equal(c.place('plot'), true);
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'plot', x, z, 0) === null) spot = { x, z };
  const coins0 = store.state.farm.wallet.coins;
  ptr.move(spot.x, spot.z);
  ptr.click(spot.x, spot.z);
  const id = tileOwner(store.state, spot.x, spot.z);
  assert.ok(id && store.state.farm.wallet.coins < coins0, 'a priced plot was bought');
  assert.equal(c.tool.id, 'hammer', 'plots stay in build mode');
  h.flush();
  window.dispatch('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true, target: {} });
  assert.equal(tileOwner(store.state, spot.x, spot.z), null, 'refunded and removed');
  assert.equal(store.state.farm.wallet.coins, coins0, '100 % back inside the window');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('animals: the Feed Scoop on a home tends its hens; with nothing due the Hand pets them', async () => {
  const { h, store, c, ptr } = await setup();
  for (const s of [store.state, h.state]) { s.farm.xp = xpForLevel(3); s.farm.wallet.coins = 20_000; s.farm.inventory.chicken_feed = 10; }
  let spot = null;
  for (let z = 14; z < 50 && !spot; z++) for (let x = 14; x < 50 && !spot; x++) if (canPlace(store.state, 'coop', x, z, 0) === null) spot = { x, z };
  assert.ok(c.do('place', { def: 'coop', x: spot.x, z: spot.z, rot: 0 }).ok);
  const coop = tileOwner(store.state, spot.x, spot.z);
  for (let i = 0; i < 2; i++) assert.ok(c.do('buyAnimal', { def: 'chicken', adult: true, home: coop }).ok);
  h.flush();
  const hens = () => Object.values(store.state.farm.objects).filter((o) => o.home === coop);
  assert.equal(hens().length, 2);
  c.setTool('feed_scoop');
  ptr.click(spot.x + 1, spot.z + 1);
  assert.ok(hens().every((o) => Number.isFinite(o.readyAt)), 'both hens fed by one click on the coop');
  h.flush();
  c.setTool('hand');
  const cmds = [];
  c.on('command', (x) => cmds.push(x));
  ptr.click(spot.x + 1, spot.z + 1);                // the coop itself, nothing due: its panel
  assert.deepEqual(cmds.at(-1), { cmd: 'panel', name: 'animals', args: { id: coop } });
  // the render pick returns the animal itself (animals-view pickables): a click on a fed hen pets her
  const [henA, henB] = Object.keys(store.state.farm.objects).filter((id) => store.state.farm.objects[id].home === coop).sort();
  c.actOn({ kind: 'object', id: henA, x: spot.x + 1, z: spot.z + 1, px: spot.x + 1.5, pz: spot.z + 1.5 });
  const petted = (id) => { const p = store.state.farm.objects[id].pet; return Boolean(p && p.by && p.by.includes('p1')); };
  assert.ok(petted(henA), 'petted');
  assert.ok(!petted(henB), 'only the hen under the hand');
  h.flush();
  assert.deepEqual(plain(store.state), plain(h.state));
});

test('hammer: putting a picked-up object back on its own spot just cancels the move', async () => {
  const { store, w, c, ptr, toasts } = await setup();
  const plot = plotsSorted(store.state)[0];
  const o = { ...store.state.farm.objects[plot] };
  c.setTool('hammer');
  ptr.click(o.x, o.z);
  assert.equal(c.tool.build.moveId, plot);
  const seq = store.seq;
  ptr.move(o.x, o.z);
  const g = w.calls.ghost.filter((x) => x[0] === 'update').at(-1);
  assert.equal(g[2], true, 'the ghost is green on its own spot');
  ptr.click(o.x, o.z);
  assert.equal(c.tool.build.moveId, null, 'move cancelled');
  assert.equal(store.seq, seq, 'nothing sent');
  assert.equal(toasts.length, 0);
  assert.deepEqual(w.calls.hidden.at(-1), [plot, false], 'the original is visible again');
});
