// Final release pass (2026-10-04): client-side regressions from the visual audit (V-01, V-06) and the playtest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pondCast } from '../public/js/render/avatars-view.js';
import { dockSeats } from '../public/js/render/land-features.js';
import { heightAt, WATER_Y } from '../public/js/render/ground.js';
import { leftWords } from '../public/js/ui/panels/duel.js';
import { CONTENT } from '../shared/content/index.js';
import { TILE_M } from '../shared/content/config.js';

test('V-01: a cast at Willow Pond lands on the water in front of the dock seat, never on the land end', () => {
  const spot = CONTENT.expansions.get('willow_pond').feature.fishingSpot;
  const land = { x: (spot.x + 0.5) * TILE_M, z: (spot.z + 0.5) * TILE_M };
  for (const seat of dockSeats()) {
    const { face, target } = pondCast({ x: seat.x + 0.1, z: seat.z });
    assert.equal(face, seat.face);
    assert.ok(heightAt(target.x, target.z) < WATER_Y, `the float lands on water (${target.x.toFixed(2)}, ${target.z.toFixed(2)})`);
    assert.ok(Math.hypot(target.x - land.x, target.z - land.z) > Math.hypot(seat.x - land.x, seat.z - land.z),
      'farther from the land end than the seat: the farmer faces the pond, not the shore');
  }
});

test('V-06: the duel chip under an hour says how many minutes, never a bare "minutes"', () => {
  assert.equal(leftWords(42 * 60_000), '42 min left');
  assert.equal(leftWords(10_000), '1 min left');
  assert.equal(leftWords(59 * 60_000 + 1), '60 min left');
  assert.equal(leftWords(2 * 3_600_000), '2 hours left');
});
