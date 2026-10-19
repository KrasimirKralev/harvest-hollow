// Colour helpers of the mod format: hex <-> rgb <-> hsl, WCAG luminance and contrast, and the hue shift that recolours
// an anchor's model (public/js/mod/recolor.js) and icon (server/mods/png.js) from its colour to the mod's. Pure.

/** '#RRGGBB' -> [r, g, b] in 0..255, or null. */
export function hexRgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** [r, g, b] 0..1 -> [h 0..360, s 0..1, l 0..1]. */
export function rgbHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** [h 0..360, s, l] -> [r, g, b] 0..1. */
export function hslRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const hh = (((h % 360) + 360) % 360) / 360;
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}

const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** WCAG relative luminance of a hex colour (0..1). */
export function luminance(hex) {
  const rgb = hexRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of two hex colours (1..21). */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The hue of a hex colour (0..360) and its saturation. */
export function hueOf(hex) {
  const rgb = hexRgb(hex);
  if (!rgb) return null;
  const [h, s, l] = rgbHsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  return { h, s, l };
}

const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * A shifter for colours near `from`'s hue toward `to` (both hex; `from` null = the dominant hue the caller found).
 * Returns fn(r, g, b in 0..1) -> [r, g, b]: saturated colours within `width` degrees of `from` are rotated to `to`'s hue,
 * and their saturation and lightness move `toward` (release 1.0, harvey#12: 65 %) of the way to `to`'s, so a pale, a
 * dark or a white thing comes out pale, dark or white while keeping some of its shading; greys and other hues stay.
 */
export function makeShifter(from, to, { width = 40, minSat = 0.18, toward = 0.65 } = {}) {
  const f = hueOf(from);
  const t = hueOf(to);
  if (!f || !t) return (r, g, b) => [r, g, b];
  const sK = f.s > 0.05 ? t.s / f.s : 1;
  const lD = t.l - f.l;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return (r, g, b) => {
    const [h, s, l] = rgbHsl(r, g, b);
    if (s < minSat || hueDist(h, f.h) > width) return [r, g, b];
    // soft edge: full shift near the centre, fading out to the band's edge
    const w = Math.min(1, Math.max(0, (width - hueDist(h, f.h)) / (width * 0.35)));
    const nh = t.h + (h - f.h);
    // the anchor's colour moved onto the target's (the shading kept), then `toward` of the rest of the way to it
    const s1 = clamp(s * sK, 0, 1);
    const l1 = clamp(l + lD, 0.04, 0.97);
    const ns = clamp(s1 + (t.s - s1) * toward, 0, 1);
    const nl = clamp(l1 + (t.l - l1) * toward, 0.04, 0.97);
    const [nr, ng, nb] = hslRgb(nh, ns, nl);
    return [r + (nr - r) * w, g + (ng - g) * w, b + (nb - b) * w];
  };
}

/** Degrees between the hues of two hex colours (180 when either has no hue). */
export function hueGap(a, b) {
  const x = hueOf(a);
  const y = hueOf(b);
  return x && y ? hueDist(x.h, y.h) : 180;
}

/** The most common saturated hue among rgb triples (0..1) as a hex colour, or null. */
export function dominantHue(triples, minSat = 0.25) {
  const bins = new Array(36).fill(0);
  const acc = Array.from({ length: 36 }, () => [0, 0, 0]);
  for (const [r, g, b] of triples) {
    const [h, s] = rgbHsl(r, g, b);
    if (s < minSat) continue;
    const i = Math.floor(h / 10) % 36;
    bins[i]++;
    acc[i][0] += r; acc[i][1] += g; acc[i][2] += b;
  }
  let best = -1;
  for (let i = 0; i < 36; i++) if (bins[i] > 0 && (best < 0 || bins[i] > bins[best])) best = i;
  if (best < 0) return null;
  const n = bins[best];
  return rgbHex(acc[best].map((v) => (v / n) * 255));
}

/**
 * A tinter toward `to` (hex) for a coat (an animal breed): the body colour (the hue of `body`, the model's or icon's
 * dominant colour, within 30 degrees) and pale greys take `to`'s hue and saturation, keeping their own light and shade;
 * very dark details and other accents (a red comb, a beak) stay. fn(r, g, b in 0..1) -> [r, g, b].
 */
export function makeTinter(to, body = null, { width = 30, amount = 0.85, toward = 0.65 } = {}) {
  const t = hueOf(to);
  const b0 = body ? hueOf(body) : null;
  if (!t) return (r, g, b) => [r, g, b];
  // release 1.0 (harvey#12): the light moves `toward` of the way to the coat asked for (a white cow is white, a black
  // sheep black), and the coat keeps the colour's own chroma at every shade (a pale lilac stays pale; a grey stays grey)
  const chroma = t.s * (1 - Math.abs(2 * t.l - 1));
  return (r, g, b) => {
    const [h, s, l] = rgbHsl(r, g, b);
    if (l < 0.1) return [r, g, b];
    const near = b0 && b0.s > 0.08 && hueDist(h, b0.h) <= width;
    if (!near && s > 0.18) return [r, g, b];
    const nl = Math.min(0.97, Math.max(0.06, l + (t.l - l) * toward));
    const room = 1 - Math.abs(2 * nl - 1);
    const ns = room > 0.01 ? Math.min(1, chroma / room) : 0;
    const [nr, ng, nb] = hslRgb(t.h, ns, nl);
    return [r + (nr - r) * amount, g + (ng - g) * amount, b + (nb - b) * amount];
  };
}
