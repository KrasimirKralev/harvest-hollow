// First-time play-test FT-3 (verify-1 B3, 2026-10-19): ripe Wheat must read as ripe at a phone's default zoom. A phone
// opens in the far LOD band, where every plot draws its `crop:<id>:<stage>:far` twin. The ripe Wheat twin had ONE thin
// stalk a planting spot (12 stalks; 0.12 of the near model's surface) against 8 a spot up close, so a ripe field showed
// faint gold lines on bare soil, fainter than the green sprouts before it (hardware-GPU shots in
// docs/qa/release/build/lead/first-time/findings.md "Fixes"). The twin keeps its 12 stalks and 60 triangles (nothing
// heavier) with a thicker straw and a fuller, longer ear: build-assets' `fatFar` on Wheat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFetcher, setManifest, resetAssetCache } from '../public/js/render/assets.js';
import { models } from '../public/js/render/models.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8'));
const diskFetch = async (url) => {
  const file = path.join(ROOT, 'public', 'assets', decodeURIComponent(url.split('?')[0]).replace(/^\/assets\//, ''));
  if (!fs.existsSync(file)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
/** A geometry's surface area (m²): what its triangles can cover on screen. */
function area(g) {
  const p = g.getAttribute('position');
  const ix = g.index.array;
  let a = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const [A, B, C] = [ix[i], ix[i + 1], ix[i + 2]].map((k) => [p.getX(k), p.getY(k), p.getZ(k)]);
    const u = B.map((v, j) => v - A[j]);
    const w = C.map((v, j) => v - A[j]);
    a += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }
  return a;
}

test('FT-3: the ripe Wheat far twin covers a third of the near model\'s surface at the same 60 triangles', async () => {
  assert.equal(manifest.keys['crop:wheat:3:far'].tris, 60, 'nothing heavier: the far twin keeps its 60 triangles');
  assert.equal(manifest.keys['crop:wheat:2:far'].tris, 60, 'the growing far twin is untouched');
  assert.equal(manifest.keys['crop:wheat:3'].tris, 480, 'the near ripe model is untouched');
  resetAssetCache();
  setFetcher(diskFetch);
  setManifest(manifest);
  await models.ready(['crop:wheat:3', 'crop:wheat:3:far']);
  const ratio = area(models.geometryFor('crop:wheat:3:far')) / area(models.geometryFor('crop:wheat:3'));
  assert.ok(ratio >= 0.25, `far / near surface ${ratio.toFixed(3)} (HEAD 0.120: thin stalks that read as bare soil)`);
});
