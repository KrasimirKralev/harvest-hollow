// Recolour of a mod thing's model (docs/agent-notes/harness-contract.md §1.4, §2.6): the anchor's prepared geometry with
// its baked vertex colours (LINEAR rgb) shifted from the anchor's colour to the mod's. Pure, no three.js: models.js
// hands in the color attribute's array and gets a new one.
//   recolorColors(linear: Float32Array, look: { from, to, kind, leaf? }) -> Float32Array
import { makeShifter, makeTinter, dominantHue } from '../../../shared/mod/colour.js';

const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function recolorColors(linear, look) {
  const n = Math.floor(linear.length / 3);
  const srgb = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) srgb[i] = toSrgb(Math.min(1, Math.max(0, linear[i])));
  const triples = () => {
    const out = [];
    for (let i = 0; i < n; i++) out.push([srgb[i * 3], srgb[i * 3 + 1], srgb[i * 3 + 2]]);
    return out;
  };
  let fns;
  if (look.kind === 'tint') fns = [makeTinter(look.to, dominantHue(triples(), 0.1))];
  else {
    const from = look.from ?? dominantHue(triples());
    fns = [from ? makeShifter(from, look.to) : null];
    if (look.leaf && look.leaf.from && look.leaf.to) fns.push(makeShifter(look.leaf.from, look.leaf.to, { width: 25 }));
  }
  const out = new Float32Array(linear.length);
  out.set(linear);
  for (let i = 0; i < n; i++) {
    let rgb = [srgb[i * 3], srgb[i * 3 + 1], srgb[i * 3 + 2]];
    for (const f of fns) if (f) rgb = f(rgb[0], rgb[1], rgb[2]);
    out[i * 3] = toLinear(rgb[0]);
    out[i * 3 + 1] = toLinear(rgb[1]);
    out[i * 3 + 2] = toLinear(rgb[2]);
  }
  return out;
}
