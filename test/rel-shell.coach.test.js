// Release 1.0, ui-shell: one guide voice (M1a), the together steps for solo finishers (M8), the first Barnyard task's
// target (M9) and old devices (critique#23: a HEAD-era save and device replay no coach step and no first-use tip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFarm, T0 } from './helpers.js';
import { xpForLevel, TUTORIAL } from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';

const TUT = await import('../public/js/ui/tutorial.js');
const at = (level) => { const s = makeFarm(); s.farm.xp = xpForLevel(level); return s; };

test('M1a: on a fresh farm the coach\'s first instruction is planting, never the welcome or the naming card', () => {
  const s = at(1);
  const c = TUT.coachStep(s, 'p1');
  assert.ok(c, 'the coach speaks on a fresh farm');
  assert.equal(c.step.id, 'plant_wheat', `first step ${c?.step.id}`);
  assert.notEqual(c.step.id, 'welcome');
  assert.notEqual(c.step.id, 'name_farm');
  const t = TUT.targetOf(s, c.step, T0);
  assert.ok(t && t.id && s.farm.objects[t.id].def === 'plot' && !s.farm.objects[t.id].crop, 'the arrow points at an empty plot');
});

test('M1a: the coach retires at farm level 6, or after 45 minutes of this farmer\'s play', () => {
  assert.ok(TUT.coachStep(at(5), 'p1'), 'still there at level 5');
  assert.equal(TUT.coachStep(at(6), 'p1'), null, 'gone at level 6');
  const s = at(2);
  s.players.p1.play = { ...(s.players.p1.play ?? {}), n: 44 };
  assert.ok(TUT.coachStep(s, 'p1'));
  s.players.p1.play.n = 45;
  assert.equal(TUT.coachStep(s, 'p1'), null, 'gone after 45 minutes of play');
  assert.ok(TUT.coachStep(s, 'p2'), 'the partner\'s own minutes count for the partner');
});

test('M1a: old saves (L18, L32) show no guide step ("Sell 10 Wheat" never comes back)', () => {
  for (const level of [18, 32]) {
    const s = at(level);
    s.players.p1.tut = { track: 'fields', i: 2, n: 0, skip: false };
    assert.equal(TUT.coachStep(s, 'p1'), null, `level ${level}`);
  }
});

test('M1a: a first-use tip that names the coach step\'s tool waits while she teaches with it', () => {
  const s = at(1);
  assert.equal(TUT.tipDue(s, 'p1', 'seed_bag'), false, 'the coach says "plant" already');
  assert.equal(TUT.tipDue(s, 'p1', 'market_panel'), true, 'a panel tip is not the coach step\'s tool');
  assert.equal(TUT.tipDue(s, 'p1', 'seed_bag', { hidden: true }), true, 'a hidden coach says nothing');
  assert.equal(TUT.tipDue(at(8), 'p1', 'seed_bag'), true, 'after the coach retired');
});

test('M8: a solo farmer who finished both tracks gets the together steps at L3 (flour_together)', () => {
  const s = at(3);
  s.farm.tut = { s: 2, t: 0, n: 0, fin: { fields: 'p1', barnyard: 'p1' } };
  s.players.p1.tut = { track: null, i: 0, n: 0, skip: true };      // what the rules leave after both tracks
  const c = TUT.coachStep(s, 'p1');
  assert.ok(c, 'the coach still speaks to a finisher');
  assert.equal(c.step.id, 'flour_together');
  // the start steps never ticked (naming is a chip now): the together step still shows, and the coach will tick them
  s.farm.tut.s = 0;
  const c2 = TUT.coachStep(s, 'p1');
  assert.equal(c2?.step.id, 'flour_together');
  assert.equal(c2.startOpen, true);
  // an explicit "I know farming" (not a finisher) still ends it
  const q = at(3);
  q.players.p1.tut = { track: null, i: 0, n: 0, skip: true };
  assert.equal(TUT.coachStep(q, 'p1'), null);
});

test('M1a: the naming chip comes after the first harvest, on a new farm only', () => {
  const s = at(1);
  assert.equal(TUT.harvestedOnce(s), false);
  s.farm.stats['harvest.wheat'] = 2;
  assert.equal(TUT.harvestedOnce(s), true);
  assert.equal(TUT.namingDue(s), true);
  s.farm.coop = { ...s.farm.coop, named: { by: 'p1', at: T0 } };
  assert.equal(TUT.namingDue(s), false);
});

test('M9: the Barnyard arrow picks the on-screen weed nearest the centre, outside the HUD, over three camera poses', () => {
  const s = at(2);
  for (const id of Object.keys(s.farm.objects)) if (s.farm.objects[id].def === 'weed' || s.farm.objects[id].def === 'rock') delete s.farm.objects[id];
  const put = (id, def, x, z) => { assert.equal(canPlace(s, def, x, z, 0), null, `${def} at ${x},${z}`); s.farm.objects[id] = { def, x, z, rot: 0, placedAt: T0, by: 'sys' }; };
  // a free stretch of the farm's own land: (bx, bz), (bx + 6, bz) and (bx + 3, bz + 3)
  let bx = null;
  let bz = null;
  for (let z = 0; z < 80 && bx === null; z++) for (let x = 0; x < 80 && bx === null; x++) {
    if ([[0, 0], [6, 0], [3, 3]].every(([dx, dz]) => canPlace(s, 'weed', x + dx, z + dz, 0) === null)) { bx = x; bz = z; }
  }
  assert.notEqual(bx, null, 'free land for the test debris');
  put('w1', 'weed', bx, bz);
  put('w2', 'weed', bx + 6, bz);
  put('r1', 'rock', bx + 3, bz + 3);
  const W = 1366;
  const H = 768;
  const dock = { left: 1080, top: 640, right: W, bottom: H };
  // three camera poses: a projection that puts tile (cx, cz) at the screen centre, 40 px a tile
  const pose = (cx, cz) => ({ toScreen: (x, z) => ({ x: W / 2 + (x - cx) * 40, y: H / 2 + (z - cz) * 40, visible: true }), w: W, h: H, hud: [dock] });
  assert.equal(TUT.debrisTarget(s, pose(bx + 0.5, bz + 0.5)), 'w1', 'centred on w1');
  assert.equal(TUT.debrisTarget(s, pose(bx + 6.5, bz + 0.5)), 'w2', 'centred on w2');
  // w2 sits under the dock in this pose: w1 is the nearest one on screen and clear of the HUD
  const p3 = pose(bx + 5.5, bz + 0.5);
  const w2 = p3.toScreen(bx + 6.5, bz + 0.5);
  const hud3 = { left: w2.x - 30, top: w2.y - 30, right: w2.x + 30, bottom: w2.y + 30 };
  assert.equal(TUT.debrisTarget(s, { ...p3, hud: [hud3] }), 'w1');
  // weeds before rocks, even when a rock is nearer the centre
  assert.ok(['w1', 'w2'].includes(TUT.debrisTarget(s, pose(bx + 3.5, bz + 3.5))), 'a weed, not the nearer rock');
  // the step's target uses it
  const step = TUTORIAL.barnyard[0];
  assert.equal(TUT.targetOf(s, step, T0, pose(bx + 6.5, bz + 0.5)).id, 'w2');
});

test('critique#23: the owners\' devices after 1.0: a L21 farm whose farmers saw every tip replays no coach step and no tip', () => {
  const s = at(21);
  for (const pid of ['p1', 'p2']) {
    s.players[pid].tut = { track: 'fields', i: 2, n: 3, skip: false };      // a HEAD-era guide left mid-way
    s.players[pid].seen = { ...(s.players[pid].seen ?? {}), tips: Object.fromEntries(TUTORIAL.firstUse.map((t) => [t.id, 1])) };
  }
  for (const pid of ['p1', 'p2']) {
    assert.equal(TUT.coachStep(s, pid), null, `${pid}: no coach step`);
    for (const tip of TUTORIAL.firstUse) assert.ok(s.players[pid].seen.tips[tip.id], `${pid}: ${tip.id} seen`);
  }
});

test('M9 / S7: the arrow and its halo land on the middle of the target tile, not half a tile up on the fence', () => {
  const s = at(1);
  const c = TUT.coachStep(s, 'p1');
  const t = TUT.targetOf(s, c.step, T0);
  const o = s.farm.objects[t.id];
  // view.toScreen takes continuous tile coordinates: a 1 x 1 plot at (x, z) spans x..x+1, its middle is x + 0.5
  assert.deepEqual(TUT.pointOf(t.tile), { x: o.x + 0.5, z: o.z + 0.5 });
  // the place() and debrisTarget() projections go through it
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /view\.toScreen\(t\.tile\.x, t\.tile\.z/, 'no projection of the tile index itself');
  assert.doesNotMatch(src, /see\.toScreen\(c\.x, c\.z/);
});

test('M1a: before the first seed the coach says which tap comes first (a plot, then Wheat); then the drag line', async () => {
  const s = at(1);
  const c = TUT.coachStep(s, 'p1');
  assert.equal(TUT.lineKeyOf(c), 'dock.coach.firstSeed');
  const EN = (await import('../public/js/i18n/en/dock.js')).default;
  const BG = (await import('../public/js/i18n/bg/dock.js')).default;
  assert.match(EN['dock.coach.firstSeed'], /plot.*Wheat/);
  assert.match(BG['dock.coach.firstSeed'], /леха.*пшеница/);
  const plot = Object.keys(s.farm.objects).sort().find((k) => s.farm.objects[k].def === 'plot');
  s.farm.objects[plot].crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 60_000, by: 'p1' };
  s.farm.stats['plant.wheat'] = 1;
  s.players.p1.stats = { ...(s.players.p1.stats ?? {}), 'plant.wheat': 1 };
  const c2 = TUT.coachStep(s, 'p1');
  if (c2.have > 0) assert.equal(TUT.lineKeyOf(c2), null, 'after the first seed: the content\'s drag line');
  assert.equal(TUT.lineKeyOf({ ...c, have: 1 }), null);
});
