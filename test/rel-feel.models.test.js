// Release 1.0 (life-feel): the new and changed models in the committed manifest. M9 (ux-first#9): the first Barnyard
// weed reads as a weed (a tuft with yellow flowers, about twice HEAD's size); D1 (features#F1): the surprise gift box
// with its lid and the two ribbon parts the giver's colour tints in the dynamic batch (no draw call of its own).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'models', 'manifest.json'), 'utf8'));
const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'icons', 'manifest.json'), 'utf8'));

// HEAD fdafb9c's `debris:weed` (manifest.keys['debris:weed'].size): 0.65 x 0.26 x 0.641 m, 124 triangles
const HEAD_WEED = [0.65, 0.26, 0.641];

test('M9: the weed is a tuft at least 1.8x HEAD\'s size on every axis, still a cheap model', () => {
  const w = manifest.keys['debris:weed'];
  assert.ok(w, 'debris:weed');
  for (let i = 0; i < 3; i++) {
    assert.ok(w.size[i] >= HEAD_WEED[i] * 1.8, `axis ${'xyz'[i]}: ${w.size[i]} m vs ${(HEAD_WEED[i] * 1.8).toFixed(3)} (1.8x HEAD)`);
  }
  // it still fits its 1 x 1 tile (2 m) and sits on the ground
  assert.ok(w.size[0] <= 2 && w.size[2] <= 2, `fits its tile (${w.size})`);
  assert.ok(w.min[1] > -0.05, `rests on the ground (min y ${w.min[1]})`);
  assert.ok(w.tris <= 150, `${w.tris} triangles (performance-03 budget 150)`);
});

test('D1: the gift box has a body, a hinged lid and two tintable ribbon parts, in a file of its own', () => {
  const keys = ['prop:gift_box', 'prop:gift_box:lid', 'prop:gift_box:band', 'prop:gift_box:bow'];
  for (const k of keys) assert.ok(manifest.keys[k], k);
  const body = manifest.keys['prop:gift_box'];
  assert.deepEqual(body.footprint, [1, 1]);
  assert.equal(body.def, 'gift_box');
  assert.ok(!body.part, 'the body is the def\'s model');
  for (const k of keys.slice(1)) assert.equal(manifest.keys[k].part, true, `${k} is a part`);
  // one small file of its own, loaded only when a farm shows a box (a '-' keeps it out of the boot pack)
  const files = new Set(keys.map((k) => manifest.keys[k].file));
  assert.deepEqual([...files], ['props/gift-box.glb']);
  assert.ok(manifest.files['props/gift-box.glb'].bytes <= 40 * 1024, `${manifest.files['props/gift-box.glb'].bytes} bytes (scope §8: weed + box <= +40 KB)`);
  // a box smaller than the loot crate, on the ground
  assert.ok(body.size[0] <= 1.2 && body.size[1] <= 1.0, `size ${body.size}`);
  assert.ok(body.min[1] > -0.05 && body.min[1] < 0.05, `rests on the ground (min y ${body.min[1]})`);
  const tris = keys.reduce((n, k) => n + manifest.keys[k].tris, 0);
  assert.ok(tris <= 900, `${tris} triangles for the whole box`);
  assert.ok(icons.ids.gift_box, 'the gift box has an icon');
});
