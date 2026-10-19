// QA r2 L2-08 (va#3, Astra FIX-FIRST): at near zoom on the owners' save the name tags "Pondio", "Kiki", "Riki" sat on
// their ducks' egg bubbles (and "Doja-Sheep" on a wool bubble): the tag stood at head + 0.3 m and the bubble at nearly
// the same height, and the DOM tag paints over the canvas. Browser on the tested head: 3 tag-bubble overlaps at the pond,
// 6 at the pasture (.scratch/r2-life-feel/probe-head.jsonl). Now a tag stands above its own animal's bubble on screen.
// Rect test with a real three.js camera: the bubble drawn as a sprite (camera-facing, grows up from its anchor), the tag
// 18 px tall with its foot at the anchor animals-view gives it; over camera pitches, distances and screen positions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tagFoot, bubbleSize, BUBBLE_PX, BUBBLE_BOB } from '../public/js/render/animals-view.js';
import { NAME_TAGS } from '../public/js/render/name-tags.js';

const W = 1366;
const H = 768;

/** A camera at `dist` from (tx, 0, tz), `pitch` degrees above the ground, `yaw` degrees round it (30° FOV). */
function cameraAt(dist, pitch, yaw, tx = 40, tz = 40) {
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 1000);
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  cam.position.set(tx + Math.sin(y) * Math.cos(p) * dist, Math.sin(p) * dist, tz + Math.cos(y) * Math.cos(p) * dist);
  cam.lookAt(tx, 0, tz);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}
const toScreen = (cam) => (x, z, y) => {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, visible: v.z < 1 };
};
/** The sprite's screen rect, as three draws it: centre (0.5, 0) at its anchor, `sz` wide and tall in view space. */
function spriteRect(cam, x, y, z, sz) {
  const view = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
  const pt = (dx, dy) => { const v = view.clone().add(new THREE.Vector3(dx, dy, 0)).applyMatrix4(cam.projectionMatrix); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
  const [l, b] = pt(-sz / 2, 0);
  const [r, t] = pt(sz / 2, sz);
  return [l, t, r, b];
}
const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

test('L2-08: a named animal\'s tag never covers its own need bubble (pitches 32-70°, near-band distances, across the screen)', () => {
  let cases = 0;
  for (const pitch of [32, 44, 55, 70]) for (const dist of [8, 14, 22, 34]) for (const yaw of [0, 37, 140]) {
    const cam = cameraAt(dist, pitch, yaw);
    const proj = toScreen(cam);
    for (const [dx, dz] of [[0, 0], [-6, 3], [5, -4], [3, 6]]) {
      const x = 40 + dx * dist / 30;
      const z = 40 + dz * dist / 30;
      const head = 0.55;                                    // a duck: its model's top x its scale
      const h = Math.max(0.6, head) + 0.12;                 // the bubble's anchor (drawNeeds)
      const sz = bubbleSize(BUBBLE_PX.ready, dist);
      const s0 = proj(x, z, h);
      if (!s0.visible || s0.x < 0 || s0.x > W || s0.y < 0 || s0.y > H) continue;
      const up = s0.y - proj(x, z, h + 1).y;
      const k = Math.hypot(proj(x + 1, z, h).x - s0.x, proj(x, z + 1, h).x - s0.x);
      const y = tagFoot(head + 0.3, h, sz, up, k);
      const foot = proj(x, z, y);
      const tag = [foot.x - 30, foot.y - NAME_TAGS.h, foot.x + 30, foot.y];
      for (const bob of [0, BUBBLE_BOB]) {
        const bubble = spriteRect(cam, x, h + bob, z, sz);
        assert.ok(!hits(tag, bubble), `pitch ${pitch} dist ${dist} yaw ${yaw} at ${dx},${dz} bob ${bob}: tag ${tag.map(Math.round)} on bubble ${bubble.map(Math.round)}`);
      }
      // and it does not float far off: at most a bubble and a half above the bubble's top
      const top = spriteRect(cam, x, h + BUBBLE_BOB, z, sz)[1];
      assert.ok(top - foot.y <= 1.5 * (spriteRect(cam, x, h, z, sz)[3] - spriteRect(cam, x, h, z, sz)[1]) + 6, `pitch ${pitch} dist ${dist}: not floating (${Math.round(top - foot.y)} px)`);
      cases++;
    }
  }
  assert.ok(cases > 100, `${cases} cases`);
});

test('L2-08: with no bubble the tag keeps its own height', () => {
  assert.equal(tagFoot(0.85, 0.72, 0.3, 0, 0) > 0.85, true, 'no measure: a safe lift');
  assert.equal(tagFoot(5, 0.72, 0.3, 40, 60), 5, 'already above: unchanged');
});
