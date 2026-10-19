// Release 1.0, harvey#12 (should): "what I asked for is what I see". The recolour moves lightness and saturation most of
// the way (65 %) to the colour asked for, not only the hue, and takes the icon's own main hue when the def's colour is
// far from it; so a pale blue melon is pale blue, a white pumpkin white, a black lantern black. The agent is warned
// (COLOUR_FAR) when an icon still comes out far from the colour it asked for.
// RED on fdafb9c: the pale blue Moon Melon came out teal (mean RGB distance 238 from #BFE3FF; harvey.md finding 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { recolorPng, decodePng, encodePng } from '../server/mods/png.js';
import { renderCheck, colourMissed } from '../server/mods/render.js';
import { tmpRoot } from './helpers/agent-harness.js';
import { hexRgb } from '../shared/mod/colour.js';

const icon = (id) => fs.readFileSync(path.join(ROOT, 'public', 'assets', 'icons', `${id}.png`));
/** The mean colour of an icon's visible pixels, and its distance from a hex colour. */
function meanOf(png) {
  const img = decodePng(png);
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i < img.data.length; i += 4) { if (img.data[i + 3] < 128) continue; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
  return [r / n, g / n, b / n];
}
const dist = (a, hex) => { const b = hexRgb(hex); return Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); };

test('harvey#12: pale, white, dark and vivid colours come out as asked (mean of the whole icon)', () => {
  const cases = [
    ['watermelon', '#3E8E3A', '#BFE3FF', 80],      // the audit's pale blue Moon Melon (HEAD: 238)
    ['pumpkin', '#F2852A', '#FFFFFF', 60],         // a white pumpkin (HEAD: 84)
    ['pumpkin', '#F2852A', '#5B8FD9', 45],         // the blue pumpkin chip (HEAD: 66)
    ['lantern', null, '#2A2A2A', 20],              // a black lantern
  ];
  for (const [like, from, to, max] of cases) {
    const d = dist(meanOf(recolorPng(icon(like), from, to).png), to);
    assert.ok(d <= max, `${like} -> ${to}: ${d} > ${max}`);
  }
});

test('harvey#12: the stem and the other accents keep their colour; greys stay', () => {
  const src = decodePng(icon('pumpkin'));
  const out = decodePng(recolorPng(icon('pumpkin'), '#F2852A', '#5B8FD9').png);
  // a green pixel of the stem is still green
  let kept = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    const [r, g, b] = [src.data[i], src.data[i + 1], src.data[i + 2]];
    if (src.data[i + 3] > 200 && g > r + 30 && g > b + 30) { kept++; assert.equal(out.data[i + 1], g); }
  }
  assert.ok(kept > 20, `${kept} stem pixels`);
});

test('harvey#12: an icon that still comes out far from the colour asked for is a warning for the agent', () => {
  // a stand-in anchor: a grey icon with a little red on it (a stone with a berry): most of it cannot take a colour
  const root = path.join(tmpRoot('rh-recolor'), 'tree');
  const img = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) };
  for (let i = 0; i < 64 * 64; i++) {
    const red = i % 64 < 3 && i < 64 * 3;
    img.data.set(red ? [210, 40, 40, 255] : [128, 128, 128, 255], i * 4);
  }
  for (const dir of ['', '64']) {
    fs.mkdirSync(path.join(root, 'public', 'assets', 'icons', dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'public', 'assets', 'icons', dir, 'pebble.png'), encodePng(img));
  }
  const overlay = (to) => ({ defs: { crops: [], trees: [], recipes: [{ id: 'x_blue_pebble', name: 'Blue Pebble' }], decor: [], animals: [] }, names: { bg: {} },
    look: { models: {}, icons: { x_blue_pebble: { like: 'pebble', from: null, to } } } });
  const r = renderCheck(overlay('#3A5EC8'), { root });
  const w = r.warnings.find((x) => x.code === 'COLOUR_FAR');
  assert.ok(w, JSON.stringify(r.warnings));
  assert.match(w.message, /x_blue_pebble barely takes #3A5EC8/);
  assert.match(w.hint, /pick one closer to it, or an anchor nearer that colour/);
  // the colours that read: a pale blue melon, a white cow, a pale lilac hen, the blue pumpkin of the chips
  assert.equal(colourMissed('#C0E4FE', '#BFE3FF'), false);
  assert.equal(colourMissed('#B0ABA6', '#FFFFFF'), false, 'a white cow keeps its shading');
  assert.equal(colourMissed('#A398AB', '#E9E4FF'), false);
  assert.equal(colourMissed('#5B8BD0', '#5B8FD9'), false);
  // HEAD's teal for "pale blue" would have been told
  assert.equal(colourMissed('#31795F', '#BFE3FF'), true);
});
