// render-look (release 1.0): the night glow (G8), contact darkening (G9), the ripen pop (G11a) and the placeholder settle
// (G12). Pure logic on synthetic geometry and the shader sources; no WebGL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT } from './helpers.js';
import * as MODELS from '../public/js/render/models.js';
import * as OV from '../public/js/render/objects-view.js';

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/** A wall with two glass panes (GLASS_LIN vertex colour) and a wooden door, facing +z. */
function wallWithPanes() {
  const pos = []; const col = [];
  const quad = (x0, y0, x1, y1, z, c) => {
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
    for (let i = 0; i < 6; i++) col.push(...c);
  };
  const glass = MODELS.GLASS_LIN;
  quad(-1.5, 1.2, -0.9, 1.8, 1.0, glass);
  quad(0.9, 1.2, 1.5, 1.8, 1.0, glass);
  quad(-0.4, 0, 0.4, 1.9, 1.0, [0.3, 0.15, 0.05]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

test('G8: every lit pane of a model becomes one halo anchor (centre, outward normal, size); wood is not glass', async () => {
  assert.ok(exists('public/js/render/night-glow.js'), 'render/night-glow.js exists');
  const NG = await import('../public/js/render/night-glow.js');
  const a = NG.glassAnchors(wallWithPanes());
  assert.equal(a.length, 2, 'two panes, two halos');
  for (const [x, y, z, nx, nz, s] of a) {
    assert.ok(Math.abs(Math.abs(x) - 1.2) < 0.01 && Math.abs(y - 1.5) < 0.01, `pane centre ${x}, ${y}`);
    assert.ok(z > 1.0 && z < 1.1, 'pushed just out of the wall');
    assert.ok(Math.abs(nz - 1) < 1e-6 && Math.abs(nx) < 1e-6, 'facing +z');
    assert.ok(s >= 0.6 && s <= 1.4);
  }
});

test('G8: the halos draw nothing by day (0 draw calls) and show at night', async () => {
  const NG = await import('../public/js/render/night-glow.js');
  const layer = new THREE.Group();
  const glow = { value: 0 };
  const h = NG.createNightGlow(layer, { glow });
  h.set('house', [{ x: 1, y: 2, z: 3, nx: 0, nz: 1, s: 1 }]);
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 1, 500);
  h.update(cam, 768);
  assert.equal(h.mesh.visible, false, 'by day: not drawn');
  glow.value = 1;
  h.update(cam, 768);
  assert.equal(h.mesh.visible, true, 'at night: one draw');
  assert.equal(h.count, 1);
});

test('G9: the shared look darkens the lowest 0.3 m of every model (up to 22 %), in the shader', () => {
  assert.ok(MODELS.CONTACT && MODELS.CONTACT.h === 0.3 && MODELS.CONTACT.k === 0.22, 'CONTACT = { h: 0.3, k: 0.22 }');
  const m = MODELS.models.createMaterial();
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  m.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /hhContactY = transformed\.y;/);
  assert.match(shader.fragmentShader, /outgoingLight \*= clamp\( 0\.780 \+ hhContactY \* 0\.7333, 0\.780, 1\.0 \);/);
});

test('G11a: the ripen pop is 600 ms, +8 % with an outBack overshoot, and settles back to 1', () => {
  assert.equal(typeof OV.ripenScale, 'function', 'objects-view exports ripenScale');
  assert.equal(OV.RIPEN.dur, 0.6);
  let peak = 0;
  for (let k = 0; k <= 1; k += 0.01) peak = Math.max(peak, OV.ripenScale(k));
  assert.ok(peak > 1.08 && peak < 1.11, `peak ${peak.toFixed(3)}: +8 % with a little overshoot`);
  assert.equal(OV.ripenScale(0), 1);
  assert.equal(OV.ripenScale(1), 1);
});

test('G12: a placeholder that becomes its model settles in: 0.92 -> 1.03 -> 1 in 250 ms', () => {
  assert.equal(typeof OV.settleScale, 'function', 'objects-view exports settleScale');
  assert.equal(OV.SETTLE.dur, 0.25);
  assert.equal(OV.settleScale(0), 0.92);
  assert.ok(Math.abs(OV.settleScale(0.6) - 1.03) < 1e-9);
  assert.equal(OV.settleScale(1), 1);
});
