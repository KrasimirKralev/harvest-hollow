// Click-to-walk (live requests 2026-10-04): public/js/game/path.js routes my farmer round everything solid on the
// farm's own land, and the avatar walks the route at walking speed, sending presence the server relays without a jump.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, walkGrid, route, clear, COST } from '../public/js/game/path.js';
import { createAvatar } from '../public/js/game/avatar.js';
import { AVATAR_SPEED, WORLD_TILES, START } from '../shared/content/config.js';
import { inLand } from '../shared/rules/grid.js';
import { makeFarm } from './helpers.js';

/** A synthetic n x n grid: '#' solid, 'p' plot, '=' path, '.' grass (rows are z, columns x). */
function gridOf(rows) {
  const n = rows.length;
  const cost = new Float32Array(n * n);
  const plot = new Uint8Array(n * n);
  rows.forEach((row, z) => [...row].forEach((ch, x) => {
    const i = z * n + x;
    cost[i] = ch === '#' ? 0 : ch === 'p' ? COST.plot : ch === '=' ? COST.path : COST.grass;
    plot[i] = ch === 'p' ? 1 : 0;
  }));
  return { n, cost, plot };
}

/** Every point along the route, sampled finely, stands on a walkable tile (the start and end tiles excepted). */
function assertWalkable(grid, from, points, { plots = true } = {}) {
  let a = from;
  const startT = `${Math.floor(from.x)},${Math.floor(from.z)}`;
  const end = points.at(-1);
  const endT = `${Math.floor(end.x)},${Math.floor(end.z)}`;
  for (const b of points) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s <= Math.ceil(len / 0.05); s++) {
      const t = len ? s / Math.ceil(len / 0.05) : 0;
      const x = Math.floor(a.x + (b.x - a.x) * t);
      const z = Math.floor(a.z + (b.z - a.z) * t);
      const k = `${x},${z}`;
      if (k === startT || k === endT) continue;
      const i = z * grid.n + x;
      assert.ok(grid.cost[i] > 0, `the route crosses solid tile ${k}`);
      if (!plots) assert.equal(grid.plot[i], 0, `the route crosses plot ${k}`);
    }
    a = b;
  }
}

test('A*: round a wall through its gap, then string-pulled into a few straight legs', () => {
  const g = gridOf([
    '..........',
    '..........',
    '..........',
    '#######.##',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
  ]);
  const from = { x: 1.5, z: 1.5 };
  const to = { x: 1.5, z: 8.5 };
  const r = findPath(g, from, to);
  assert.equal(r.reached, true);
  assert.deepEqual(r.points.at(-1), to, 'ends at the exact click point');
  assertWalkable(g, from, r.points);
  assert.ok(r.points.length <= 3, `${r.points.length} legs, not a staircase`);
  assert.ok(r.length > Math.hypot(0, 7) + 4, 'the detour through the gap');
});

test('A*: no corner cutting between two solid tiles; legs keep the farmer\'s clearance', () => {
  const g = gridOf([
    '.....',
    '.#...',
    '..#..',
    '.....',
    '.....',
  ]);
  const r = findPath(g, { x: 1.5, z: 2.5 }, { x: 2.5, z: 1.5 });
  assert.equal(r.reached, true);
  assertWalkable(g, { x: 1.5, z: 2.5 }, r.points);
  assert.ok(r.length > Math.SQRT2 + 0.5, 'went round, not diagonally between the two blocks');
  assert.equal(clear(g, { x: 0.5, z: 0.5 }, { x: 4.5, z: 0.5 }), true);
  assert.equal(clear(g, { x: 0.5, z: 1.5 }, { x: 4.5, z: 1.5 }), false, 'a line through a solid tile is not clear');
});

test('A*: a field is walked round when going round is cheap, crossed when it is the only way', () => {
  const field = gridOf([
    '.........',
    '.........',
    '..ppppp..',
    '..ppppp..',
    '..ppppp..',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const r = findPath(field, { x: 4.5, z: 0.5 }, { x: 4.5, z: 6.5 });
  assertWalkable(field, { x: 4.5, z: 0.5 }, r.points, { plots: false });
  const walled = gridOf([
    '#########',
    '#.......#',
    '#ppppppp#',
    '#.......#',
    '#########',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const w = findPath(walled, { x: 4.5, z: 1.5 }, { x: 4.5, z: 3.5 });
  assert.equal(w.reached, true, 'across the plots when nothing else gets there');
});

test('A*: an unreachable point walks as close as the land allows; a farmer boxed in cannot move', () => {
  const g = gridOf([
    '......',
    '......',
    '......',
    '######',
    '......',
    '......',
  ]);
  const r = findPath(g, { x: 2.5, z: 0.5 }, { x: 2.5, z: 5.5 });
  assert.equal(r.reached, false);
  assert.equal(Math.floor(r.points.at(-1).z), 2, 'stops at the wall, on the near side');
  const boxed = gridOf(['###', '#.#', '###']);
  assert.equal(findPath(boxed, { x: 1.5, z: 1.5 }, { x: 0.5, z: 0.5 }), null);
});

test('the farm: only the farm\'s land is walkable; buildings, fences and debris are solid; paths are preferred', () => {
  const s = makeFarm();
  const g = walkGrid(s);
  const at = (x, z) => g.cost[z * g.n + x];
  assert.equal(at(18, 26), 0, 'the farmhouse');
  assert.equal(at(24, 29), 0, 'the picket fence');
  assert.ok(at(23, 31) > 0, 'the fence gate');
  assert.equal(at(25, 31), Math.fround(COST.plot), 'a tilled plot');
  assert.equal(at(22, 31), Math.fround(COST.path), 'the dirt path');
  assert.equal(at(2, 2), 0, 'wild land off the farm');
  for (let z = 0; z < WORLD_TILES; z++) for (let x = 0; x < WORLD_TILES; x++) if (g.cost[z * g.n + x] > 0) assert.ok(inLand(s, x, z));
  assert.equal(walkGrid(s), g, 'cached while the farm layout is the same');
});

test('the farm: from the porch into the fenced field through its gate, and round the barn', () => {
  const s = makeFarm();
  const g = walkGrid(s);
  const from = { ...START.spawn.p1 };
  const r = route(s, from, { x: 25.5, z: 31.5 });
  assert.equal(r.reached, true);
  assertWalkable(g, from, r.points);
  const pts = [from, ...r.points];
  const crossing = pts.findIndex((p, i) => i > 0 && pts[i - 1].x < 23.5 && p.x >= 23.5);
  assert.ok(crossing > 0, 'it enters the field');
  const a = pts[crossing - 1];
  const b = pts[crossing];
  const zAt = a.z + ((23.5 - a.x) / (b.x - a.x)) * (b.z - a.z);
  assert.ok(zAt >= 31 && zAt < 33, `through the gate (z ${zAt.toFixed(2)})`);
  const behind = route(s, from, { x: 35.5, z: 24.5 });
  assert.equal(behind.reached, true);
  assertWalkable(g, from, behind.points);
});

function rig(state) {
  let t = 1000;
  const frames = [];
  const sent = [];
  const view = { me: { update() {} }, onFrame(fn) { frames.push(fn); } };
  const avatar = createAvatar({ view, send: (m) => sent.push(m), pid: 'p1', clock: () => t, route: (a, b) => route(state, a, b) });
  const run = (ms, frameMs = 1000 / 60) => { for (let k = 0; k < ms / frameMs; k++) { t += frameMs; for (const f of frames) f(1 / 60, t); } };
  run(20);
  return { avatar, sent, run };
}

test('the avatar walks the route at walking speed, never hops, and every presence frame is a step the server relays', () => {
  const s = makeFarm();
  const { avatar, sent, run } = rig(s);
  const n0 = sent.length;
  const dest = avatar.goTo(35.5, 37.5);                 // across the farm, round the fenced field
  assert.ok(dest && dest.reached);
  assert.deepEqual(avatar.destination, { x: 35.5, z: 37.5 });
  const r = route(s, { ...START.spawn.p1 }, { x: 35.5, z: 37.5 });
  run(1000);
  assert.ok(avatar.walking, 'still on the way after 1 s');
  run(Math.ceil((r.length / AVATAR_SPEED) * 1000) + 500);
  assert.equal(avatar.walking, false);
  assert.equal(avatar.destination, null);
  assert.deepEqual([avatar.pose.x, avatar.pose.z], [35.5, 37.5]);
  const frames = sent.slice(n0);
  assert.ok(frames.every((m) => !m.hop), 'a long walk is a walk, never a poof');
  let prev = { x: START.spawn.p1.x, z: START.spawn.p1.z };
  for (const m of frames) {
    assert.ok(m.x >= 16 && m.x <= 40 && m.z >= 24 && m.z <= 40, `on the farm (${m.x}, ${m.z})`);
    // the server relays up to 1.5 x AVATAR_SPEED: 15 Hz frames move at most ~0.2 tiles + rounding
    assert.ok(Math.hypot(m.x - prev.x, m.z - prev.z) <= (AVATAR_SPEED * 1.5) / 15 + 0.1, 'no jump between frames');
    prev = m;
  }
  assert.ok(frames.some((m) => m.a === 1) && frames.at(-1).a === 0, 'walks, then stands');
});

test('a new click re-targets the walk; walkTo to a stand point goes round the farmhouse instead of through it', () => {
  const s = makeFarm();
  const { avatar, run } = rig(s);
  avatar.goTo(38.5, 38.5);
  run(500);
  avatar.goTo(16.5, 38.5);
  assert.deepEqual(avatar.destination, { x: 16.5, z: 38.5 });
  run(15_000);
  assert.deepEqual([avatar.pose.x, avatar.pose.z], [16.5, 38.5]);
  avatar.place(16.5, 29.5);                              // west of the porch path, below the farmhouse
  let arrived = 0;
  avatar.walkTo(19, 24, 1, 1, () => { arrived++; });    // a stand point north of the farmhouse (17..21, 25..29)
  const d = avatar.destination;
  assert.ok(d, 'walking');
  run(10_000);
  assert.equal(arrived, 1);
});

test('a farmer inside a footprint (a building moved onto them) steps straight out to the nearest open tile', () => {
  const g = gridOf([
    '........',
    '.####...',
    '.####...',
    '.####...',
    '.####...',
    '........',
    '........',
    '........',
  ]);
  // in the middle of the 4 x 4 block, nearer its left edge: out to the left, then on to the goal
  const r = findPath(g, { x: 2.2, z: 2.5 }, { x: 6.5, z: 7.5 });
  assert.ok(r && r.reached, 'the farmer is not stuck inside');
  assert.deepEqual(r.points[0], { x: 0.5, z: 2.5 }, 'the first leg goes straight out to the nearest open tile');
  assertWalkable(g, r.points[0], r.points.slice(1));
  // boxed in for good (nothing open within reach) stays null; an open start never takes the escape
  assert.equal(findPath(gridOf(['###', '#.#', '###']), { x: 1.5, z: 1.5 }, { x: 0.5, z: 0.5 }), null);
  const open = findPath(g, { x: 6.5, z: 0.5 }, { x: 6.5, z: 7.5 });
  assert.deepEqual(open.points, [{ x: 6.5, z: 7.5 }]);
});

test('the farm: the Barn moved over the porch spawn: the farmer walks out of it to the market road', () => {
  const s = makeFarm();
  const barn = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'barn');
  const sp = START.spawn.p1;
  // put the Barn's footprint over the porch spot (setup writes the state; the rules test covers the move itself)
  Object.assign(s.farm.objects[barn], { x: Math.floor(sp.x) - 1, z: Math.floor(sp.z) - 1 });
  for (const k of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[k];
    if (k !== barn && o.def !== 'farmhouse' && Number.isFinite(o.x) && Math.abs(o.x - sp.x) < 4 && Math.abs(o.z - sp.z) < 4) delete s.farm.objects[k];
  }
  delete s[Object.getOwnPropertySymbols(s).find((y) => String(y).includes('grid')) ?? Symbol('none')];
  const g = walkGrid(s);
  assert.equal(g.cost[Math.floor(sp.z) * WORLD_TILES + Math.floor(sp.x)], 0, 'the porch spot is inside the Barn now');
  const r = route(s, sp, { x: 26.5, z: 35.5 });
  assert.ok(r && r.reached, 'the farmer gets out and reaches the road');
});
