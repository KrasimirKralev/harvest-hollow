// Pet portraits (owner wish 6, 2026-10-04), ui lane: a small SVG face per breed (husky, German shepherd, Shiba Inu;
// orange, black and white cats) for the Pets page and the breed picker. Cosmetic only; colours in w4-rules BREED_LOOK.
//
//   petFace(kind, breed, { size?, label? }) -> <svg>
import { BREED_LOOK, breedOf, breedsOf } from './w4-rules.js';

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  for (const k of kids) if (k) e.append(k);
  return e;
}

function dog(L, breed) {
  const g = el('g');
  const inner = breed === 'shepherd' ? '#3A2E27' : L.light;
  // ears: upright triangles (a shepherd's are tall, a shiba's small and round-tipped)
  const tall = breed === 'shepherd' ? 4 : breed === 'shiba' ? 12 : 8;
  g.append(
    el('path', { d: `M18 46 Q20 ${tall + 6} 30 ${tall} Q40 18 46 32 Z`, fill: L.ear }),
    el('path', { d: `M82 46 Q80 ${tall + 6} 70 ${tall} Q60 18 54 32 Z`, fill: L.ear }),
    el('path', { d: `M25 40 Q27 ${tall + 14} 31 ${tall + 9} Q37 24 40 33 Z`, fill: inner, opacity: 0.85 }),
    el('path', { d: `M75 40 Q73 ${tall + 14} 69 ${tall + 9} Q63 24 60 33 Z`, fill: inner, opacity: 0.85 }),
    el('ellipse', { cx: 50, cy: 56, rx: 34, ry: 31, fill: L.fur }));
  if (L.saddle) g.append(el('path', { d: 'M22 48 Q26 26 50 25 Q74 26 78 48 Q64 38 50 46 Q36 38 22 48 Z', fill: L.saddle }));
  if (L.mask) {
    g.append(el('path', { d: 'M24 62 Q30 84 50 88 Q70 84 76 62 Q66 70 58 60 L50 42 L42 60 Q34 70 24 62 Z', fill: L.light }));
    if (breed === 'husky') g.append(el('ellipse', { cx: 37, cy: 50, rx: 7, ry: 4, fill: L.light }), el('ellipse', { cx: 63, cy: 50, rx: 7, ry: 4, fill: L.light }));
  } else {
    g.append(el('ellipse', { cx: 50, cy: 72, rx: 18, ry: 13, fill: L.saddle ? '#2B211C' : L.light }));
  }
  g.append(
    el('circle', { cx: 37, cy: 56, r: 5, fill: L.eye }), el('circle', { cx: 63, cy: 56, r: 5, fill: L.eye }),
    el('circle', { cx: 37, cy: 56, r: 2.4, fill: '#1A1412' }), el('circle', { cx: 63, cy: 56, r: 2.4, fill: '#1A1412' }),
    el('circle', { cx: 38.5, cy: 54.5, r: 1.2, fill: '#FFF' }), el('circle', { cx: 64.5, cy: 54.5, r: 1.2, fill: '#FFF' }),
    el('ellipse', { cx: 50, cy: 67, rx: 6.5, ry: 4.6, fill: L.nose }),
    el('path', { d: 'M50 71 L50 76 M43 77 Q50 82 57 77', stroke: '#2A1D16', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }));
  if (breed === 'shiba') g.append(el('path', { d: 'M47 79 Q50 86 53 79 Z', fill: '#F07C8C' }));
  return g;
}

function cat(L, breed) {
  const g = el('g');
  g.append(
    el('path', { d: 'M18 48 L22 12 L44 30 Z', fill: L.ear }), el('path', { d: 'M82 48 L78 12 L56 30 Z', fill: L.ear }),
    el('path', { d: 'M24 40 L26 20 L38 31 Z', fill: breed === 'black' ? '#5A4448' : '#F7B9C1' }),
    el('path', { d: 'M76 40 L74 20 L62 31 Z', fill: breed === 'black' ? '#5A4448' : '#F7B9C1' }),
    el('ellipse', { cx: 50, cy: 58, rx: 35, ry: 30, fill: L.fur }));
  if (L.stripes) {
    g.append(el('path', { d: 'M44 31 L46 41 M50 29 L50 40 M56 31 L54 41 M17 56 L27 57 M83 56 L73 57', stroke: L.stripes, 'stroke-width': 3.2, 'stroke-linecap': 'round' }));
  }
  g.append(
    el('ellipse', { cx: 44, cy: 70, rx: 8, ry: 6.5, fill: L.light }), el('ellipse', { cx: 56, cy: 70, rx: 8, ry: 6.5, fill: L.light }),
    el('ellipse', { cx: 37, cy: 55, rx: 5.5, ry: 6.5, fill: L.eye }), el('ellipse', { cx: 63, cy: 55, rx: 5.5, ry: 6.5, fill: L.eye }),
    el('ellipse', { cx: 37, cy: 55, rx: 1.8, ry: 5, fill: '#1A1412' }), el('ellipse', { cx: 63, cy: 55, rx: 1.8, ry: 5, fill: '#1A1412' }),
    el('circle', { cx: 38.5, cy: 52.5, r: 1.3, fill: '#FFF' }), el('circle', { cx: 64.5, cy: 52.5, r: 1.3, fill: '#FFF' }),
    el('path', { d: 'M46 64 L54 64 L50 68.5 Z', fill: L.nose }),
    el('path', { d: 'M50 68.5 Q47 74 43 72 M50 68.5 Q53 74 57 72', stroke: breed === 'black' ? '#8A7A7A' : '#5A3A2A', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }),
    el('path', { d: 'M30 68 L14 65 M30 72 L15 74 M70 68 L86 65 M70 72 L85 74', stroke: breed === 'black' ? '#C9C1BA' : '#8A7262', 'stroke-width': 1.3, 'stroke-linecap': 'round' }));
  return g;
}

/** A small portrait of a pet's breed (kind 'dog' | 'cat'; breed absent = the kind's first breed). */
export function petFace(kind, breed, { size = 56, label = null } = {}) {
  const b = breed ?? breedOf({ kind });
  // content's coat and eye colours (the renderer paints the same) over the portrait's own palette
  const row = breedsOf(kind).find((x) => x.id === b);
  const L = { ...(BREED_LOOK[b] ?? (kind === 'cat' ? BREED_LOOK.orange : BREED_LOOK.shiba)),
    ...(/^#[0-9a-f]{6}$/i.test(row?.coat ?? '') ? { fur: row.coat } : {}), ...(/^#[0-9a-f]{6}$/i.test(row?.eyes ?? '') ? { eye: row.eyes } : {}) };
  const svg = el('svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'pet-face', role: label ? 'img' : null,
    'aria-label': label, 'aria-hidden': label ? null : 'true' });
  svg.append(el('ellipse', { cx: 50, cy: 92, rx: 30, ry: 5, fill: 'rgba(62,38,18,.15)' }), kind === 'cat' ? cat(L, b) : dog(L, b));
  return svg;
}
