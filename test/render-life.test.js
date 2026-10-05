// render-life: pure logic of tweens, fx, avatars and animals (deterministic, no DOM, no sleeps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EASE, createTweener, squashPop, dropBounce, shake } from '../public/js/render/tweens.js';
import { createRing, targetFor, itemName, ATLAS } from '../public/js/render/fx.js';
import { gaitFor, angleDelta, EMOTES, tileCentreOf } from '../public/js/render/avatars-view.js';
import {
  hash32, animalStatus, rotateRect, yardSpots, wanderPoint, wanderPose, WANDER_MS, SKINNED_MAX, variantKey, SPECIES_SCALE, bubbleSize, BUBBLE_PX,
} from '../public/js/render/animals-view.js';
import { animalTint } from '../public/js/ui/panels/animals.js';
import { seatOf, CHIBI } from '../public/js/render/avatars-view.js';
import { balloonAt, perches } from '../public/js/render/ambient-life.js';

test('easing curves start at 0 and end at 1', () => {
  for (const [name, f] of Object.entries(EASE)) {
    assert.ok(Math.abs(f(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(f(1) - 1) < 1e-9, `${name}(1)`);
  }
  assert.ok(EASE.outBack(0.6) > 1, 'outBack overshoots');
});

test('a tween runs from its delay to its end, ends exactly once at k = 1, and can be cancelled', () => {
  const tw = createTweener();
  const seen = [];
  let done = 0;
  tw.update(10);
  tw.tween({ duration: 0.5, delay: 0.1, ease: EASE.linear, onUpdate: (e, k) => seen.push([e, k]), onDone: () => { done++; } });
  tw.update(10.05);
  assert.equal(seen.length, 0, 'not before the delay');
  tw.update(10.35);
  assert.ok(Math.abs(seen.at(-1)[1] - 0.5) < 1e-9);
  tw.update(11);
  tw.update(12);
  assert.deepEqual(seen.at(-1), [1, 1]);
  assert.equal(done, 1);
  assert.equal(tw.isAnimating(), false);
  const cancel = tw.tween({ duration: 1, onUpdate: () => assert.fail('cancelled tween ran') });
  cancel();
  tw.update(13);
});

test('a throwing callback does not stop other tweens', () => {
  const tw = createTweener();
  const orig = console.error;
  console.error = () => {};
  try {
    let ran = false;
    tw.update(0);
    tw.tween({ duration: 0.1, onUpdate: () => { throw new Error('boom'); } });
    tw.tween({ duration: 0.1, onUpdate: () => { ran = true; } });
    tw.update(0.2);
    assert.ok(ran);
  } finally { console.error = orig; }
});

test('a spring settles to rest and reports 0 at the end', () => {
  const tw = createTweener();
  const xs = [];
  let done = false;
  tw.update(0);
  tw.spring({ x: 1, onUpdate: (x) => xs.push(x), onDone: () => { done = true; } });
  for (let t = 1 / 60; t < 4; t += 1 / 60) tw.update(t);
  assert.ok(done);
  assert.equal(xs.at(-1), 0);
  assert.ok(xs.some((x) => x < 0), 'it overshoots (a shake, not a fade)');
});

test('squash-pop, drop-bounce and shake are bounded and rest at identity', () => {
  for (let t = 0; t <= 1; t += 0.01) {
    const { sx, sy } = squashPop(t);
    assert.ok(sy > 0.9 && sy < 1.05 && Math.abs(sx * sx * sy - 1) < 1e-9, `volume at ${t}`);
    const d = dropBounce(t, 0.6);
    assert.ok(d.y >= 0 && d.y <= 0.6 && d.sy > 0.75 && d.sy < 1.1);
    assert.ok(Math.abs(shake(t, 4)) <= 4);
  }
  assert.deepEqual(squashPop(1), { sx: 1, sy: 1 });
  assert.deepEqual(dropBounce(1), { y: 0, sy: 1 });
  assert.equal(shake(1), 0);
});

test('fx: the particle ring buffer wraps, HUD targets and names resolve', () => {
  const r = createRing(4);
  assert.deepEqual(r.take(3), [0, 1, 2]);
  assert.deepEqual(r.take(3), [3, 0, 1]);
  assert.deepEqual(r.take(9), [2, 3, 0, 1], 'never more than the capacity at once');
  assert.equal(targetFor('coins'), 'coins');
  assert.equal(targetFor('xp'), 'xp');
  assert.equal(targetFor('acorns'), 'acorns');
  assert.equal(targetFor('wheat'), 'barn');
  assert.equal(itemName('wheat'), 'Wheat');
  assert.equal(itemName('golden_thing'), 'Golden thing');
  assert.equal(Object.keys(ATLAS).length, 16, 'a 4 x 4 atlas');
});

test('avatars: gait by speed, shortest turns, emote set', () => {
  assert.equal(gaitFor(0).clip, 'Idle');
  assert.equal(gaitFor(1.4).clip, 'Walk');
  assert.equal(gaitFor(6).clip, 'Run');
  assert.ok(gaitFor(6).scale <= 1.7 && gaitFor(0.2).scale >= 0.6);
  assert.ok(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9, 'across the seam');
  assert.ok(Math.abs(angleDelta(0, -0.5) + 0.5) < 1e-9);
  assert.equal(EMOTES.length, 8, 'GDD §8.5: emote pops (8)');
  const state = { farm: { objects: { b: { def: 'bakery', x: 10, z: 20, rot: 1 }, p: { def: 'plot', x: 3, z: 4, rot: 0 },
    coop: { def: 'coop', x: 30, z: 30, rot: 0 }, hen: { def: 'chicken', home: 'coop' } } } };
  assert.deepEqual(tileCentreOf(state, 'p'), { x: 3, z: 4 }, 'a plot is its own tile');
  assert.deepEqual(tileCentreOf(state, 'b'), { x: 11, z: 21 }, 'a 3x3 building: its middle tile');
  assert.deepEqual(tileCentreOf(state, 'hen'), { x: 31, z: 31 }, 'an animal: its home');
  assert.equal(tileCentreOf(state, 'nope'), null);
});

test('animals: status from the object and the server time', () => {
  const now = 1_000_000;
  const def = { babyMs: 30 * 60_000 };
  assert.deepEqual(
    Object.fromEntries(Object.entries(animalStatus({ adultAt: now - 1, readyAt: null }, now, def)).filter(([, v]) => v)),
    { hungry: true },
  );
  const ready = animalStatus({ adultAt: now - 1, readyAt: now - 5 }, now, def);
  assert.ok(ready.ready && !ready.hungry && !ready.producing);
  const growing = animalStatus({ adultAt: now - 1, readyAt: now + 5, fedAt: now - 100 }, now, def);
  assert.ok(growing.producing && growing.eating && !growing.ready);
  const baby = animalStatus({ bornAt: now - 1000, readyAt: null }, now, def);
  assert.ok(baby.baby && !baby.hungry, 'babies grow by themselves: never "hungry"');
  assert.ok(!animalStatus({ bornAt: now - def.babyMs - 1 }, now, def).baby);
  assert.ok(animalStatus({ adultAt: now - 1, prized: true }, now, def).ribbon);
});

test('animals: yard rects rotate, spots fill the yard, wander stays inside it', () => {
  assert.deepEqual(rotateRect([-2, 0.5, 2, 2.5], 0), [-2, 0.5, 2, 2.5]);
  assert.deepEqual(rotateRect([-2, 0.5, 2, 2.5], 2), [-2, -2.5, 2, -0.5]);
  const r1 = rotateRect([-2, 0.5, 2, 2.5], 1);
  assert.equal(r1[2] - r1[0], 2, 'odd turns swap width and depth');
  const rect = [10, 20, 18, 24];
  for (const n of [1, 4, 7, 12]) {
    const spots = yardSpots(rect, n);
    assert.equal(spots.length, n);
    for (const s of spots) assert.ok(s.x > 10 && s.x < 18 && s.z > 20 && s.z < 24);
    assert.equal(new Set(spots.map((s) => `${s.x},${s.z}`)).size, n, 'distinct spots');
  }
  for (let k = 0; k < 200; k++) {
    const p = wanderPoint('cow1', k, { x: 11, z: 21 }, rect, 3);
    assert.ok(p.x >= 10 && p.x <= 18 && p.z >= 20 && p.z <= 24, `segment ${k}`);
  }
});

test('animals: wandering is deterministic and continuous (same cow, same spot on both screens)', () => {
  const rect = [0, 0, 8, 6];
  const spot = { x: 4, z: 3 };
  const a = wanderPose('k3x9a.4.0', 1_790_000_123_456, spot, rect);
  const b = wanderPose('k3x9a.4.0', 1_790_000_123_456, spot, rect);
  assert.deepEqual(a, b);
  assert.notDeepEqual(wanderPose('other', 1_790_000_123_456, spot, rect), a, 'animals differ');
  let prev = wanderPose('k3x9a.4.0', 0, spot, rect, { speed: 0.6 });
  for (let t = 16; t < WANDER_MS * 20; t += 16) {
    const p = wanderPose('k3x9a.4.0', t, spot, rect, { speed: 0.6 });
    assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) < 0.08, `no jump at ${t} ms`);
    prev = p;
  }
  assert.equal(hash32('a', 1), hash32('a', 1));
  assert.notEqual(hash32('a', 1), hash32('a', 2));
  assert.equal(SKINNED_MAX, 8, 'GDD §8.6: at most 8 skinned animals');
});

test('hens: three plumages picked like the coop panel picks its portrait tint (RD-22, UI-37)', () => {
  const colour = { 'animal:chicken:v0': '#9A5B34', 'animal:chicken:v1': '#D2A86A', 'animal:chicken:v2': '#EBDDBB' };
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const id = `k${i * 7919}.${i}`;
    const k = variantKey('chicken', id);
    assert.equal(colour[k], animalTint(id, 'chicken'), `hen ${id}: the 3D hen and her portrait agree`);
    seen.add(k);
  }
  assert.equal(seen.size, 3, 'all three plumages occur');
  assert.equal(variantKey('cow', 'x'), null, 'other species: one look');
  assert.equal(variantKey('chicken', 'x', () => false), null, 'no variant model yet: the base hen');
  // chunkier animals (visual-09); hens a little smaller again so a full coop does not crowd its ramp (VISUAL-AFTER C2)
  assert.ok(SPECIES_SCALE.chicken === 1.24 && SPECIES_SCALE.sheep === 1.15 && SPECIES_SCALE.cow === 1.1, 'chunkier animals (visual-09)');
});

test('need bubbles keep their size on screen at every zoom (RD-11; QA wave 2 RD-09: 35-40 % less area)', () => {
  const px = (kind, dist) => (bubbleSize(BUBBLE_PX[kind], dist) * 900) / (2 * dist * Math.tan((15 * Math.PI) / 180));
  for (const d of [20, 35, 55, 70]) {
    assert.ok(Math.abs(px('ready', d) - 32) < 4, `ready ${px('ready', d).toFixed(1)} px at ${d} m`);
    assert.ok(Math.abs(px('hungry', d) - 26) < 4, `hungry ${px('hungry', d).toFixed(1)} px at ${d} m`);
    assert.ok(Math.abs(px('working', d) - 17) < 3, `working ${px('working', d).toFixed(1)} px at ${d} m`);
  }
  // area: (32 / 40)^2 = 0.64 of the old ready bubble
  assert.ok((BUBBLE_PX.ready / 40) ** 2 <= 0.65 && (BUBBLE_PX.hungry / 32) ** 2 <= 0.67);
});

test('bench seats: two farmers side by side facing out; nobody seated, no seat (RD-17)', () => {
  const state = { farm: { objects: { bench: { def: 'sunset_bench', x: 20, z: 30, rot: 0 } } } };
  const bench = { p1: { id: 'bench', at: 1 }, p2: { id: 'bench', at: 2 } };
  const a = seatOf(bench, 'p1', state);
  const b = seatOf(bench, 'p2', state);
  assert.ok(a && b);
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 1.2) < 1e-6, 'two seats 1.2 m apart');
  assert.equal(a.face, 0, 'rot 0 faces +Z, like the bench');
  assert.ok(a.x > 40 && a.x < 44 && a.z > 60 && a.z < 62, 'on the bench footprint');
  assert.equal(seatOf({}, 'p1', state), null);
  assert.equal(seatOf({ p1: { id: 'gone', at: 1 } }, 'p1', state), null, 'a bench that was moved away');
  const turned = seatOf({ p1: { id: 'bench', at: 1 } }, 'p1', { farm: { objects: { bench: { def: 'sunset_bench', x: 20, z: 30, rot: 1 } } } });
  assert.ok(Math.abs(turned.face - Math.PI / 2) < 1e-9);
  assert.ok(CHIBI.Head === 1.98 && CHIBI.WristR === 1.35 && CHIBI.FootL === 1.35, 'the chibi cut (visual-09, VISUAL-AFTER C5; QA wave 2 RD-14: heads x1.1)');
  assert.ok(a.y > 0.6 && a.y < 1.0, 'the hips rest on the seat');
});

test('ambient life: the balloon crosses on a shared 10-minute schedule; birds perch on fence posts (RD-39)', () => {
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % 600_000);
  const on = balloonAt(t0 + 30_000);
  assert.ok(on && on.y >= 30 && on.y <= 36, 'flying high over the farm');
  assert.deepEqual(balloonAt(t0 + 30_000), on, 'both screens see the same balloon');
  assert.equal(balloonAt(t0 + 200_000), null, 'between flights the sky is clear');
  let gaps = 0;
  for (let t = t0; t < t0 + 3_600_000; t += 10_000) if (!balloonAt(t)) gaps++;
  assert.ok(gaps > 250, 'about 110 s of every 10 minutes');
  const state = { farm: { expansions: ['home'], objects: { f: { def: 'picket_fence', x: 20, z: 30, rot: 0 } } } };
  const p = perches(state, 6);
  assert.equal(p.length, 6);
  assert.ok(p.every((x) => Number.isFinite(x.x) && x.y > 0.9), 'on top of a post');
  assert.deepEqual(perches(state, 6), p, 'deterministic');
});
