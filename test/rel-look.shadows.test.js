// render-look (release 1.0): phone shadows (G4, graphics#3) and grounding without a shadow map (G1, graphics#2).
// Pure logic: the profiles, the receivers' materials and the blob-shadow switch; no WebGL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT } from './helpers.js';
import { setManifest } from '../public/js/render/assets.js';
import { PROFILES, qualityOf } from '../public/js/render/renderer.js';
import { createObjectsView } from '../public/js/render/objects-view.js';
import * as IDX from '../public/js/render/index.js';

setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8')));

test('G4: phone High draws a 1024 shadow map with a 2-tap radius; tablet Medium too; lower tiers keep blob shadows', () => {
  assert.equal(PROFILES.phone.high.shadowMap, 1024);
  assert.equal(PROFILES.phone.high.shadowRadius, 2);
  assert.equal(PROFILES.tablet.medium.shadowMap, 1024);
  assert.equal(PROFILES.phone.medium.shadowMap, 0);
  assert.equal(PROFILES.phone.low.shadowMap, 0);
  assert.equal(qualityOf('high', 'phone').panShadows, false, 'never refreshed mid-pan: only at rest');
});

test('G4: every shadow receiver of the farm samples the cheap 2-tap lookup (no 5-tap Vogel PCF left)', () => {
  const layers = {};
  for (const n of ['ground', 'crops', 'objects', 'badges', 'fx', 'ui3d', 'gridFx']) layers[n] = new THREE.Group();
  const ov = createObjectsView(layers, { now: () => 0 });
  const missing = [];
  for (const [name, b] of Object.entries(ov.batches)) {
    if (!b.mesh.receiveShadow) continue;
    const key = typeof b.mesh.material.customProgramCacheKey === 'function' ? b.mesh.material.customProgramCacheKey() : '';
    if (!/hh-shadow2/.test(key)) missing.push(name);
  }
  assert.deepEqual(missing, [], `receivers without the 2-tap patch: ${missing.join(', ')}`);
});

test('G1: without a shadow map every profile paints blob shadows, the desktop Low tier included', () => {
  assert.equal(typeof IDX.blobShadowDir, 'function', 'index.js exports blobShadowDir(castShadow, sunDir)');
  const sun = [-0.5, 0.8, 0.2];
  assert.deepEqual(IDX.blobShadowDir(false, sun), sun, 'no shadow map: blobs (desktop Low, phone Medium)');
  assert.equal(IDX.blobShadowDir(true, sun), null, 'a shadow map: no blobs');
});

test('G4: the phone\'s shadow box follows its own view (tighter than the desktop formula at the same distance)', () => {
  assert.equal(typeof IDX.shadowHalfFor, 'function', 'index.js exports shadowHalfFor(dist, { kind, reach })');
  const desk = IDX.shadowHalf(40);
  const phone = IDX.shadowHalfFor(40, { kind: 'phone', reach: 22 });
  assert.ok(phone < desk, `phone ${phone} < desktop ${desk}`);
  assert.ok(phone >= 22, 'it still covers what the phone sees');
  assert.equal(IDX.shadowHalfFor(40, { kind: 'desktop', reach: 22 }), desk, 'a desktop keeps RD-13');
});
