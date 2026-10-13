// The mod icons (harness contract §1.4): the anchor's PNG decoded, recoloured, encoded again with node:zlib.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { decodePng, encodePng, recolorPng } from '../server/mods/png.js';
import { makeShifter, hueOf, contrast, luminance } from '../shared/mod/colour.js';

const icon = (id, dir = '') => fs.readFileSync(path.join(ROOT, 'public', 'assets', 'icons', dir, `${id}.png`));

test('decode -> encode round trip is lossless', () => {
  const img = decodePng(icon('watermelon'));
  assert.equal(img.width, 128);
  const back = decodePng(encodePng(img));
  assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data));
  assert.equal(decodePng(icon('egg', '64')).width, 64);
});

test('recolour: the anchor\'s colour moves to the mod\'s, the alpha stays', () => {
  const src = decodePng(icon('watermelon'));
  const { png, alpha, changed } = recolorPng(icon('watermelon'), '#3E8E3A', '#BFE3FF');
  const out = decodePng(png);
  assert.ok(alpha > 1000 && changed > 500);
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], src.data[i]);
  const tint = recolorPng(icon('chicken'), null, '#B79CFF', 'tint');
  assert.ok(tint.changed > 1000, 'the coat takes the colour');
  assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/);
});

test('colour helpers', () => {
  const shift = makeShifter('#3E8E3A', '#3A3E8E');
  const [r, g, b] = shift(0x3e / 255, 0x8e / 255, 0x3a / 255);
  assert.ok(Math.abs(hueOf(`#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`).h - hueOf('#3A3E8E').h) < 2);
  assert.deepEqual(shift(0.5, 0.5, 0.5), [0.5, 0.5, 0.5], 'greys stay');
  assert.ok(contrast('#000000', '#FFFFFF') > 20);
  assert.ok(luminance('#FFFFFF') > 0.99);
});
