// Hats on the farmer looks (polish after the wave-4b QA, 2026-10-05): every hat sits ON the head over every hair style,
// on both rigs, and the portrait keeps a tall or wide hat whole. The rigs' real heads (avatar-looks headShape() after the
// chibi cut: test/fixtures/farmer-heads.json, dumped from the look-dev page; dump it again when a farmer model changes)
// and the real accessory geometry. A hat's triangles are told from the hair's by colour: the hair is a purple no hat
// uses. Rays are vertical: a point is under the hat when a ray straight up from it meets a hat triangle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { lookOf, accessoryGeometry, HAIR_STYLES, HATS } from '../public/js/render/avatar-looks.js';

const HEADS = JSON.parse(fs.readFileSync(new URL('./fixtures/farmer-heads.json', import.meta.url), 'utf8'));
const HAIR = '#6A3FA0';
const COVERING = ['straw_hat', 'cap', 'beanie', 'sun_bonnet', 'cowboy_hat'];
const BODIES = ['farmer_a', 'farmer_b'];

const rigOf = (body) => {
  const h = HEADS[body];
  return { hair: h.hair, hat: h.hat, shape: { keep: Float32Array.from(h.keep), hair: Float32Array.from(h.bakedHair), hat: Float32Array.from(h.bakedHat), chin: h.chin } };
};

/** The accessory's hair vertices and hat triangles (by colour: the hair's colour, its darker shade and the light's
 *  shading keep one hue; every other colour is the hat's). */
function split(g) {
  const want = new THREE.Color(HAIR);
  const n = (r, gg, b) => { const s = r + gg + b || 1; return [r / s, gg / s, b / s]; };
  const h = n(want.r, want.g, want.b);
  const P = g.getAttribute('position'); const C = g.getAttribute('color');
  const isHair = (i) => { const c = n(C.getX(i), C.getY(i), C.getZ(i)); return Math.hypot(c[0] - h[0], c[1] - h[1], c[2] - h[2]) < 0.02; };
  const hair = []; const tris = [];
  const idx = g.index ? g.index.array : null;
  const at = (k) => (idx ? idx[k] : k);
  const count = idx ? idx.length : P.count;
  for (let k = 0; k < count; k += 3) {
    const v = [at(k), at(k + 1), at(k + 2)];
    if (v.every(isHair)) continue;
    tris.push(v.map((i) => [P.getX(i), P.getY(i), P.getZ(i)]));
  }
  for (let i = 0; i < P.count; i++) if (isHair(i)) hair.push([P.getX(i), P.getY(i), P.getZ(i)]);
  return { hair, tris };
}

/** Heights where a vertical line through (x, z) meets the triangles, with each triangle's normal's y. */
function crossings(tris, x, z) {
  const out = [];
  for (const [a, b, c] of tris) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    out.push({ y: l1 * a[1] + l2 * b[1] + l3 * c[1], ny: ny / (Math.hypot(nx, ny, nz) || 1) });
  }
  return out;
}

const pts = (a) => { const o = []; for (let i = 0; i + 2 < a.length; i += 3) o.push([a[i], a[i + 1], a[i + 2]]); return o; };

test('hats: a hat that covers the head covers its crown and the hair on it, on both rigs, over every hair style', () => {
  const bad = [];
  for (const body of BODIES) {
    const rig = rigOf(body);
    for (const hair of HAIR_STYLES) {
      for (const hat of COVERING) {
        const look = lookOf({ avatar: { hair, hat, hairColor: HAIR } }, rig);
        if (look.hat === rig.hat) continue;                       // the rig's own hat is its model's, not ours
        const g = accessoryGeometry(look, rig);
        const { hair: hv, tris } = split(g);
        assert.ok(tris.length > 0, `${body} ${hair}/${hat}: the hat is drawn`);
        // the head and the hair at the top of the head: every point above 0.9 head radii is under the hat
        const top = [...pts(rig.shape.keep), ...(look.hair === rig.hair ? pts(rig.shape.hair) : []), ...hv].filter((p) => p[1] > 0.9);
        const out = top.filter((p) => !crossings(tris, p[0], p[2]).some((c) => c.y > p[1] + 1e-3));
        if (out.length) bad.push(`${body} ${hair}/${hat}: ${out.length} of ${top.length} crown points uncovered, e.g. ${out[0].map((v) => v.toFixed(2))}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('hats: no hair rests on a hat or pokes through its brim (the cowboy hat over curls)', () => {
  const bad = [];
  for (const body of BODIES) {
    const rig = rigOf(body);
    for (const hair of HAIR_STYLES) {
      for (const hat of COVERING) {
        const look = lookOf({ avatar: { hair, hat, hairColor: HAIR } }, rig);
        if (look.hat === rig.hat) continue;
        const { hair: hv, tris } = split(accessoryGeometry(look, rig));
        // a hair point with no hat above it and a hat face just below it lies on top of (or through) the hat
        const on = hv.filter((p) => {
          const cs = crossings(tris, p[0], p[2]);
          return !cs.some((c) => c.y > p[1] + 1e-3) && cs.some((c) => c.y < p[1] && p[1] - c.y < 0.6 && c.ny > 0.3);
        });
        if (on.length) bad.push(`${body} ${hair}/${hat}: ${on.length} hair points on the hat, e.g. ${on[0].map((v) => v.toFixed(2))}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('hats: one merged mesh per look, and a farmer in the rig own hair and hat draws nothing extra', () => {
  for (const body of BODIES) {
    const rig = rigOf(body);
    assert.equal(accessoryGeometry(lookOf({ avatar: { top: '#FF7A6B' } }, rig), rig), null, `${body}: own look, no extra mesh`);
    for (const hat of HATS) {
      const g = accessoryGeometry(lookOf({ avatar: { hair: 'curly', hat, hairColor: HAIR } }, rig), rig);
      assert.ok(g && g.getAttribute('color') && g.index, `${body} curly/${hat}: one indexed vertex-coloured geometry`);
      assert.ok(g.index.count / 3 < 3000, `${body} curly/${hat}: low-poly (${g.index.count / 3} triangles)`);
    }
  }
});

test('portrait: the frame grows to keep a tall hat whole and leaves a bare head as it was', async () => {
  const { portraitFrame, PORTRAIT } = await import('../public/js/render/portrait.js');
  assert.equal(typeof portraitFrame, 'function', 'portrait.js fits its frame to the head and the hat');
  const r = 0.23;
  const centre = new THREE.Vector3(0, 1.6, 0);
  const cam = new THREE.PerspectiveCamera(PORTRAIT.fov, 1, 0.01, 100);
  const ball = [];
  for (let el = -90; el <= 90; el += 30) for (let az = 0; az < 360; az += 45) {
    const e = (el * Math.PI) / 180; const a = (az * Math.PI) / 180;
    ball.push(new THREE.Vector3(Math.sin(a) * Math.cos(e) * r * 1.2, Math.sin(e) * r * 1.4 + r * 0.2, Math.cos(a) * Math.cos(e) * r * 1.2).add(centre));
  }
  const bare = portraitFrame(THREE, cam, centre, ball, r * PORTRAIT.frameK);
  assert.equal(bare.H, r * PORTRAIT.frameK, 'a bare head keeps the frame');
  assert.equal(bare.at, PORTRAIT.headAt);
  // a crown 2.3 head radii up and a brim 2.1 wide
  const hat = [...ball, centre.clone().add(new THREE.Vector3(0, 2.3 * r, 0)), centre.clone().add(new THREE.Vector3(-2.1 * r, 0.9 * r, 0.3 * r)),
    centre.clone().add(new THREE.Vector3(2.1 * r, 0.9 * r, -0.3 * r))];
  const fit = portraitFrame(THREE, cam, centre, hat, r * PORTRAIT.frameK);
  assert.ok(fit.H > bare.H || fit.at > bare.at, 'the frame changed for the hat');
  for (const p of hat) {
    const v = p.clone().project(cam);
    assert.ok(v.y <= PORTRAIT.fitTop + 1e-9 && Math.abs(v.x) <= PORTRAIT.fitSide + 1e-9, `inside the frame (${v.x.toFixed(2)}, ${v.y.toFixed(2)})`);
    if (v.y > 0) assert.ok(Math.hypot(v.x, v.y) <= PORTRAIT.fitRound + 1e-9, 'inside the round chip');
  }
});
