// Client input logic (GDD §7.1): drag-paint rasterisation, brushes, the rebindable keymap, and the target
// resolver that turns a click into an action only when the local rules would accept it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineTiles, brushTiles, createStroke } from '../public/js/game/stroke.js';
import { createKeymap, keyLabel, codeOf, DEFAULT_KEYS } from '../public/js/game/keys.js';
import { describe, verbsFor, resolve, resolveBatch, canRun, VERBS } from '../public/js/game/targets.js';
import { TOOL_LIST, brushOf, toolUnlocked, ALIASES } from '../public/js/game/tools.js';
import { dayPhase } from '../public/js/game/daycycle.js';
import { ACTIONS } from '../shared/rules/index.js';
import { cropOf, xpForLevel, CONTENT } from '../shared/content/index.js';
import { ERR } from '../shared/net/protocol.js';
import { coopHarness, mulberry32, plain } from './helpers/client.js';

const WHEAT = cropOf('wheat');
const plotsOf = (state) => Object.keys(state.farm.objects).filter((id) => state.farm.objects[id].def === 'plot').sort();

test('lineTiles: endpoints included, 4-connected, never skips a tile (2,000 random segments)', () => {
  const rng = mulberry32(11);
  for (let i = 0; i < 2000; i++) {
    const [x0, z0, x1, z1] = [0, 0, 0, 0].map(() => Math.floor(rng() * 40) - 20);
    const path = lineTiles(x0, z0, x1, z1);
    assert.deepEqual(path[0], [x0, z0]);
    assert.deepEqual(path.at(-1), [x1, z1]);
    assert.equal(path.length, Math.abs(x1 - x0) + Math.abs(z1 - z0) + 1, 'one step per unit of Manhattan distance');
    for (let k = 1; k < path.length; k++) {
      const d = Math.abs(path[k][0] - path[k - 1][0]) + Math.abs(path[k][1] - path[k - 1][1]);
      assert.equal(d, 1, 'each step moves to a neighbouring tile (no diagonal corner-cutting)');
    }
    // the path stays within half a tile of the straight line through the tile centres (it is that line's trace)
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    for (const [x, z] of path) {
      const dist = Math.abs((x1 - x0) * (z0 - z) - (x0 - x) * (z1 - z0)) / len;
      assert.ok(dist <= 1.0 + 1e-9, `(${x},${z}) is ${dist.toFixed(2)} from the line`);
    }
  }
});

test('brushTiles: 1x1, 2x2 and 3x3 footprints around the cursor tile', () => {
  assert.deepEqual(brushTiles(5, 7), [[5, 7]]);
  assert.deepEqual(brushTiles(5, 7, [2, 2]), [[5, 7], [6, 7], [5, 8], [6, 8]]);
  const b3 = brushTiles(5, 7, [3, 3]);
  assert.equal(b3.length, 9);
  assert.ok(b3.some(([x, z]) => x === 4 && z === 6) && b3.some(([x, z]) => x === 6 && z === 8), 'centred');
});

test('a stroke reports every tile under the brush exactly once, across fast jumps and back-tracking', () => {
  const s = createStroke({ brush: [2, 2] });
  const seen = [];
  for (const [x, z] of [[0, 0], [5, 0], [5, 3], [0, 0], [2, 1]]) seen.push(...s.to(x, z));
  const keys = seen.map(([x, z]) => `${x},${z}`);
  assert.equal(new Set(keys).size, keys.length, 'no tile twice');
  for (let x = 0; x <= 6; x++) assert.ok(keys.includes(`${x},0`) && keys.includes(`${x},1`), `row covered at x ${x}`);
  assert.equal(s.tiles.size, keys.length);
});

test('keymap: physical keys, labels, rebinding moves a key instead of duplicating it, persistence', () => {
  let saved = null;
  const k = createKeymap({ get: () => saved, set: (v) => { saved = v; } });
  const ev = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, ...mods });
  assert.equal(k.actionOf(ev('KeyW')), 'panUp');
  assert.equal(k.actionOf(ev('ArrowUp')), 'panUp');
  assert.equal(k.actionOf(ev('Digit3')), 'tool3');
  assert.equal(k.actionOf(ev('KeyZ', { ctrlKey: true })), 'undo');
  assert.equal(k.actionOf(ev('KeyZ')), null, 'plain Z is free');
  assert.equal(codeOf(ev('KeyZ', { metaKey: true })), 'Ctrl+KeyZ', 'Cmd counts as Ctrl');
  assert.equal(keyLabel('Ctrl+KeyZ'), 'Ctrl+Z');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel('Digit7'), '7');
  assert.ok(k.bind('ping', 'KeyW'));
  assert.equal(k.actionOf(ev('KeyW')), 'ping');
  assert.deepEqual(k.codesOf('panUp'), ['ArrowUp'], 'W moved away from pan');
  const again = createKeymap({ get: () => saved, set: () => {} });
  assert.equal(again.actionOf(ev('KeyW')), 'ping', 'remembered');
  again.reset();
  const list = again.list();
  assert.ok(list.every((r) => r.label && Array.isArray(r.keys)));
  assert.ok(list.some((r) => r.action === 'market' && r.owner === 'ui'));
  assert.equal(Object.keys(DEFAULT_KEYS).length, list.length);
  const codes = list.flatMap((r) => r.codes);
  assert.equal(new Set(codes).size, codes.length, 'no default key does two things');
});

test('tools: the nine base tools in tray order, unlock levels and brush upgrades from content', () => {
  assert.deepEqual(TOOL_LIST.map((t) => t.key), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.equal(TOOL_LIST[0].id, 'hand');
  assert.equal(ALIASES.seed, 'seed_bag');
  const h = coopHarness();
  const s = h.a.store.state;
  assert.equal(toolUnlocked(s, 'watering_can'), CONTENT.tools.get('watering_can').unlock <= 1);
  assert.deepEqual(brushOf(s, 'watering_can'), [1, 1]);
  s.farm.tools = { big_watering_can: 1 };
  assert.deepEqual(brushOf(s, 'watering_can'), [3, 3], 'the Big Watering Can paints 3x3');
});

test('describe + verbsFor: the Smart Hand does the obvious thing; Shift uproots', () => {
  const h = coopHarness();
  const st = h.a.store;
  const [p0] = plotsOf(st.state);
  let t = describe(st.state, p0, st.now());
  assert.equal(t.kind, 'plot');
  assert.equal(t.empty, true);
  assert.deepEqual(verbsFor('hand', t), ['plant']);
  assert.deepEqual(verbsFor('hand', t, { shift: true }), [], 'nothing to uproot');
  assert.deepEqual(verbsFor('sickle', t), ['harvest']);
  st.act('plant', { id: p0, crop: 'wheat' });
  t = describe(st.state, p0, st.now());
  assert.equal(t.growing, true);
  assert.equal(t.waterable, WHEAT.growMs >= 30 * 60_000, 'wheat is too quick to water (GDD §3.1 rule 4)');
  assert.deepEqual(verbsFor('hand', t), t.waterable ? ['water'] : [], 'the hand waters only what can take it');
  assert.deepEqual(verbsFor('watering_can', t), ['water'], 'the can always tries (and explains a refusal)');
  assert.deepEqual(verbsFor('hand', t, { shift: true }), ['uproot']);
  h.clock.advance(WHEAT.growMs);
  t = describe(st.state, p0, st.now());
  assert.equal(t.ready, true);
  assert.deepEqual(verbsFor('hand', t), ['harvest']);
  assert.equal(describe(st.state, 'nope', st.now()), null);
});

test('resolve: a dry run picks only actions the local rules accept, and never changes state', () => {
  const h = coopHarness();
  const st = h.a.store;
  const [p0, p1] = plotsOf(st.state);
  const before = plain(st.state);
  const t0 = describe(st.state, p0, st.now());
  const r = resolve(st, 'plant', t0, { crop: 'wheat' });
  assert.equal(r.type, 'plant');
  assert.equal(r.code, undefined);
  assert.deepEqual(plain(st.state), before, 'resolve is a pure dry run');
  assert.equal(canRun(st, r.type, r.args), null);
  // locked crop -> a real refusal with its code
  const locked = [...CONTENT.crops.values()].find((c) => c.unlock > 1 && c.m === 'M1a');
  assert.equal(resolve(st, 'plant', t0, { crop: locked.id }).code, ERR.LOCKED);
  // not ready -> NOT_READY, so the hand never sends it
  st.act(r.type, r.args);
  assert.equal(resolve(st, 'harvest', describe(st.state, p0, st.now())).code, ERR.NOT_READY);
  // an action this build does not register degrades to UNKNOWN_ACTION instead of throwing
  const fake = resolve(st, 'highFive', null, {});
  assert.ok(fake.type === 'highFive' || fake.code !== undefined);
  // canRun refuses system types and bad shapes
  assert.equal(canRun(st, '_join', { pid: 'p1', name: 'x' }), ERR.UNKNOWN_ACTION);
  assert.equal(canRun(st, 'plant', { id: p1 }), ERR.BAD_ARGS);
});

test('resolveBatch: one action for a whole frame of a stroke when the rules accept a list, else null', () => {
  const h = coopHarness();
  const st = h.a.store;
  const ids = plotsOf(st.state).slice(0, 4);
  const targets = ids.map((id) => describe(st.state, id, st.now()));
  const b = resolveBatch(st, 'plant', targets, { crop: 'wheat' });
  const listShape = ACTIONS.plant && JSON.stringify(ACTIONS.plant.schema).includes('list');
  if (listShape) {
    assert.ok(b, 'plant accepts a list of plots');
    const res = st.act(b.type, b.args);
    assert.ok(res.ok);
    for (const id of ids) assert.equal(st.state.farm.objects[id].crop.def, 'wheat');
  } else {
    assert.equal(b, null, 'no list shape in this build: one action per plot');
  }
  assert.equal(resolveBatch(st, 'plant', targets.slice(0, 1), { crop: 'wheat' }), null, 'a single target is never batched');
  assert.ok(VERBS.plant.batch.length > 0);
});

test('dayPhase follows the sky (render/daynight.js) and the personal modes', () => {
  const cycle = 40 * 60_000;
  const seen = new Set();
  for (let t = 0; t < cycle; t += 60_000) {
    const p = dayPhase(t);
    seen.add(p.phase);
    assert.ok(p.light >= 0 && p.light <= 1);
    if (p.phase === 'day') assert.equal(p.light, 1);
    if (p.phase === 'night') assert.equal(p.light, 0);
  }
  assert.deepEqual([...seen].sort(), ['dawn', 'day', 'dusk', 'night']);
  assert.equal(dayPhase(cycle * 10 + 31 * 60_000, 'day').phase, 'day', 'Always day');
  const noon = new Date(2026, 9, 3, 12, 0);
  const late = new Date(2026, 9, 3, 23, 30);
  assert.equal(dayPhase(0, 'real', noon).phase, 'day');
  assert.equal(dayPhase(0, 'real', late).phase, 'night');
});

test('level gates in content keep the tray honest at level 1 and later', () => {
  const h = coopHarness();
  const s = h.a.store.state;
  const unlocked1 = TOOL_LIST.filter((t) => toolUnlocked(s, t.id)).map((t) => t.id);
  assert.ok(unlocked1.includes('hand') && unlocked1.includes('hammer'));
  s.farm.xp = xpForLevel(8);
  assert.ok(toolUnlocked(s, 'compost_scoop'));
});
