// render-life, wave 2 (M1b): the pure parts of the new behaviours (ducks, goats, pens, bees, pets, Fair medals,
// album finds). Deterministic, no DOM, no sleeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pondPose, climbPose, perchY, separate, beePose, pathPose, WANDER_MS } from '../public/js/render/animals-view.js';
import { PET, petGoal, trailPoint, seatOf, SEAT_HIPS } from '../public/js/render/avatars-view.js';
import { medalFamily, MEDAL_COLORS, itemName } from '../public/js/render/fx.js';
import { CONTENT } from '../shared/content/index.js';

const T0 = 1_800_000_000_000;

test('ducks: most wander segments end in the pond, and the swim flag says where the duck is', () => {
  const water = { x: 10, z: 10, r: 2 };
  const rect = [6, 6, 16, 16];
  const spot = { x: 13, z: 13 };
  let inPond = 0; let n = 0;
  for (let k = 0; k < 200; k++) {
    const p = pondPose('duck-a', T0 + k * WANDER_MS + WANDER_MS - 1, spot, rect, water);     // the end of segment k
    n++;
    const d = Math.hypot(p.x - water.x, p.z - water.z);
    if (d < water.r) inPond++;
    assert.equal(p.swim, d < water.r * 0.95, `segment ${k}: swim matches the distance`);
  }
  assert.ok(inPond / n > 0.55 && inPond / n < 0.9, `about seven in ten in the pond (${inPond}/${n})`);
  assert.deepEqual(pondPose('duck-a', T0 + 12345, spot, rect, water), pondPose('duck-a', T0 + 12345, spot, rect, water), 'both screens agree');
});

test('goats: some segments end on a perch, and perchY lifts them onto it', () => {
  const perches = [{ x: 5, z: 5, r: 0.8, y: 0.9 }];
  assert.equal(perchY(5, 5, perches), 0.9, 'on top of the boulder');
  assert.equal(perchY(9, 9, perches), 0, 'on the grass');
  const rim = perchY(5 + 0.8, 5, perches);
  assert.ok(rim > 0 && rim < 0.9, 'climbing over the rim');
  let up = 0;
  for (let k = 0; k < 200; k++) {
    const p = climbPose('goat-1', T0 + k * WANDER_MS + WANDER_MS - 1, { x: 3, z: 3 }, [0, 0, 8, 8], perches);
    if (perchY(p.x, p.z, perches) > 0.85) up++;
  }
  assert.ok(up > 25 && up < 100, `about three segments in ten on the perch (${up}/200)`);
  for (let k = 0; k < 40; k++) {
    const p = climbPose('goat-1', T0 + k * WANDER_MS, { x: 3, z: 3 }, [0, 0, 8, 8], []);
    assert.ok(p.x >= 0 && p.x <= 8 && p.z >= 0 && p.z <= 8, 'no perch: a plain wander inside the yard');
  }
  const still = pathPose('x', T0, () => ({ x: 1, z: 2 }));
  assert.ok(!still.walking && still.x === 1 && still.z === 2, 'a path to where it stands: standing');
});

test('pens: animals are pushed apart, out of the obstacles, and kept inside the yard', () => {
  const list = [{ x: 2, z: 2, r: 0.5 }, { x: 2.1, z: 2, r: 0.5 }, { x: 2, z: 2.05, r: 0.4 }];
  separate(list, [{ x: 4, z: 4, r: 1 }], [0, 0, 6, 6], 8);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const d = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z);
    assert.ok(d > (list[i].r + list[j].r) * 0.9, `animals ${i} and ${j} apart (${d.toFixed(2)})`);
  }
  const shy = separate([{ x: 4.1, z: 4, r: 0.5 }], [{ x: 4, z: 4, r: 1 }]);
  assert.ok(Math.hypot(shy[0].x - 4, shy[0].z - 4) >= 1.3 - 1e-9, 'out of the trough / hive circle');
  const free = separate([{ x: 4.1, z: 4, r: 0.5, free: true }], [{ x: 4, z: 4, r: 1 }]);
  assert.ok(Math.abs(free[0].x - 4.1) < 1e-9, 'a climbing goat may stand on the obstacle');
  const kept = separate([{ x: -3, z: 9, r: 0.5 }], [], [0, 0, 6, 6]);
  assert.ok(kept[0].x >= 0.25 && kept[0].z <= 5.75, 'inside the yard');
});

test('bees: the swarm loops close round its hive, foragers shuttle to the flowers and back', () => {
  const hive = { x: 0, y: 0.6, z: 0 };
  for (let j = 0; j < 9; j++) for (let t = 0; t < 30; t += 0.7) {
    const b = beePose(hive, j, t, { seed: 3 });
    assert.ok(Math.hypot(b.x, b.z) < 1.2 && b.y > hive.y && b.y < hive.y + 1.0, `bee ${j} at ${t}s stays round the hive`);
  }
  const forage = { x: 6, z: 0 };
  let far = 0; let near = 0;
  for (let t = 0; t < 40; t += 0.25) {
    const b = beePose(hive, 1, t, { forage, forager: true, seed: 3 });
    const d = Math.hypot(b.x - forage.x, b.z - forage.z);
    if (d < 0.5) far++;
    if (Math.hypot(b.x, b.z) < 0.5) near++;
  }
  assert.ok(far > 0 && near > 0, 'reaches the flowers and comes home');
  assert.deepEqual(beePose(hive, 2, 12.5, { seed: 1 }), beePose(hive, 2, 12.5, { seed: 1 }), 'both screens agree');
});

test('pets: the trail point, heel, bench, home and away', () => {
  assert.equal(trailPoint([], 1), null);
  const trail = [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 4 }];
  assert.deepEqual(trailPoint(trail, 1), { x: 0, z: 3 }, 'one metre back along the path');
  assert.deepEqual(trailPoint(trail, 3), { x: 0, z: 1 }, 'round the corner of the path');
  assert.deepEqual(trailPoint(trail, 10), { x: 0, z: 0 }, 'a short trail: its oldest point');
  // heel: the farmer faces +z; the dog keeps behind and to the farmer's left (+x), the cat to the right
  const o = { x: 10, z: 10, facing: 0, moving: false, seat: null, away: false, home: null };
  const dog = petGoal('dog', o);
  const cat = petGoal('cat', o);
  assert.ok(dog.z < 10 && dog.x > 10.6 && cat.x < 9.4 && cat.z < 10, 'beside and a step back, the dog on the left, the cat on the right');
  assert.ok(Math.hypot(dog.x - 10, dog.z - 10) > 0.8 && Math.hypot(dog.x - 10, dog.z - 10) < 1.6, 'close by');
  // walking: the point on the trail behind the farmer
  const walk = petGoal('dog', { ...o, moving: true }, { trail: [{ x: 10, z: 6 }, { x: 10, z: 10 }] });
  assert.ok(Math.abs(walk.x - 10) < 1e-9 && Math.abs(walk.z - (10 - PET.dog.behind)) < 1e-9 && walk.face === null);
  // a roam offset while the farmer stands still
  assert.deepEqual(petGoal('cat', o, { roam: { x: 1, z: -1 } }), { x: 11, z: 9, face: null, rest: false });
  // seated: at the farmer's feet, in front of the bench, facing out with them
  const state = { farm: { objects: { b: { def: 'sunset_bench', x: 20, z: 30, rot: 0 } } } };
  const seat = seatOf({ p1: { id: 'b', at: 1 } }, 'p1', state);
  assert.equal(seat.y, SEAT_HIPS.sunset_bench);
  const sit = petGoal('dog', { ...o, seat });
  assert.ok(sit.rest && sit.face === 0 && sit.z > seat.z + 1 && Math.abs(sit.x - seat.x) < 1e-9, 'in front of the bench');
  // away: at its home if it has one, else where its farmer was last seen
  const home = { x: 50, z: 60, face: Math.PI };
  assert.deepEqual(petGoal('cat', { ...o, away: true, home }), { x: 50, z: 60, face: Math.PI, rest: true });
  assert.deepEqual(petGoal('cat', { ...o, away: true }), { x: 10, z: 10, face: 0, rest: true });
  assert.ok(PET.dog.key === 'animal:dog' && PET.cat.key === 'animal:cat');
});

test('fx: Fair medal families and album find names', () => {
  assert.equal(medalFamily('gold_2'), 'gold');
  assert.equal(medalFamily('Silver'), 'silver');
  assert.equal(medalFamily('bronze_3'), 'bronze');
  assert.equal(medalFamily('platinum'), 'platinum');
  assert.equal(medalFamily(null), null);
  for (const f of ['bronze', 'silver', 'gold', 'platinum']) assert.equal(MEDAL_COLORS[f].length, 3);
  for (const set of CONTENT.collections.values()) for (const it of set.items) assert.equal(itemName(it.id), it.name, `${it.id} reads as its album name`);
  assert.equal(itemName('wheat'), CONTENT.items.get('wheat').name);
});
