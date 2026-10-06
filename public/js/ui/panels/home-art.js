// Inline SVG art of the ui-home panels (w3 ui-home lane): the painted farm atlas (every parcel with its own terrain),
// the growing Barn of the upgrade ladder, the Grand decor plinths, the farmhouse room and the coat swatches. Same
// language as panels/art.js (visual-ux-juice.md §5.4): flat fills, one highlight, one shade, ink outlines, light from
// the upper left. Built with createElementNS from content data only, never from player strings (names are set as
// text nodes by the panels, outside the SVG).
import { s } from './art.js';
import { t, fmtNum, name as cname } from '../../i18n/index.js';

const INK = '#3E2612';
const LEAF = '#4C9A3E';
const LEAF_LIT = '#7CC243';
const TRUNK = '#7A4A2A';
const WATER = '#7DB9B5';
const WATER_DEEP = '#3A88A2';

/** A stable pseudo-random in [0, 1) from a string and a number: the same farm draws the same picture every time. */
export function hash01(key, i = 0) {
  let x = 2166136261 ^ i;
  for (let k = 0; k < key.length; k++) x = Math.imul(x ^ key.charCodeAt(k), 16777619);
  x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/** el.append without the null / false children (a null child would print as the text "null"). */
const put = (el, ...kids) => { for (const k of kids.flat()) if (k) el.append(k); };

const sw = (w) => ({ stroke: INK, 'stroke-width': w, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });

// ---- small painted things (tile units) ------------------------------------------------------------------------------

function tree(cx, cz, r, crown = LEAF, lit = LEAF_LIT) {
  return s('g', { class: 'ha-tree' },
    s('ellipse', { cx: cx + r * 0.25, cy: cz + r * 0.95, rx: r * 0.9, ry: r * 0.3, fill: 'rgba(30,50,20,.28)' }),
    s('rect', { x: cx - r * 0.16, y: cz, width: r * 0.32, height: r * 0.85, fill: TRUNK, ...sw(0.14) }),
    s('circle', { cx, cy: cz - r * 0.15, r, fill: crown, ...sw(0.16) }),
    s('circle', { cx: cx - r * 0.32, cy: cz - r * 0.45, r: r * 0.42, fill: lit, opacity: 0.85 }));
}

function fruitTree(cx, cz, r, fruit) {
  const g = tree(cx, cz, r);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    g.append(s('circle', { cx: cx + Math.cos(a) * r * 0.55, cy: cz - r * 0.15 + Math.sin(a) * r * 0.5, r: r * 0.16, fill: fruit, ...sw(0.08) }));
  }
  return g;
}

function pine(cx, cz, hh) {
  return s('g', {},
    s('ellipse', { cx: cx + hh * 0.15, cy: cz + hh * 0.08, rx: hh * 0.35, ry: hh * 0.1, fill: 'rgba(30,50,20,.28)' }),
    s('path', { d: `M${cx} ${cz - hh} L${cx + hh * 0.32} ${cz - hh * 0.35} L${cx + hh * 0.18} ${cz - hh * 0.35} L${cx + hh * 0.4} ${cz} L${cx - hh * 0.4} ${cz} L${cx - hh * 0.18} ${cz - hh * 0.35} L${cx - hh * 0.32} ${cz - hh * 0.35} Z`,
      fill: '#2F6E3A', ...sw(0.14) }));
}

function flowers(x, z, w, d, key, n, colours) {
  const g = s('g', {});
  for (let i = 0; i < n; i++) {
    const fx = x + 0.5 + hash01(key, i) * (w - 1);
    const fz = z + 0.5 + hash01(key, i + 99) * (d - 1);
    g.append(s('circle', { cx: fx, cy: fz, r: 0.28, fill: colours[i % colours.length], stroke: 'rgba(62,38,18,.55)', 'stroke-width': 0.06 }));
  }
  return g;
}

function tufts(x, z, w, d, key, n, colour = '#4F8F32') {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const fx = x + 0.6 + hash01(key, i + 7) * (w - 1.2);
    const fz = z + 0.6 + hash01(key, i + 51) * (d - 1.2);
    parts.push(`M${fx - 0.35} ${fz} q0.15 -0.6 0.35 0 q0.2 -0.7 0.35 0`);
  }
  return s('path', { d: parts.join(' '), fill: 'none', stroke: colour, 'stroke-width': 0.14, 'stroke-linecap': 'round' });
}

function rock(cx, cz, r, fill = '#A9A397') {
  return s('g', {},
    s('path', { d: `M${cx - r} ${cz + r * 0.4} Q${cx - r * 0.9} ${cz - r * 0.6} ${cx - r * 0.1} ${cz - r * 0.75} Q${cx + r * 0.8} ${cz - r * 0.8} ${cx + r} ${cz + r * 0.4} Z`,
      fill, ...sw(0.14) }),
    s('path', { d: `M${cx - r * 0.5} ${cz - r * 0.3} Q${cx - r * 0.1} ${cz - r * 0.6} ${cx + r * 0.3} ${cz - r * 0.5}`, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.55, 'stroke-width': 0.12 }));
}

function fenceLine(x1, z1, x2, z2, colour = '#F3E3C0') {
  const n = Math.max(2, Math.round(Math.hypot(x2 - x1, z2 - z1) / 1.2));
  const g = s('g', {}, s('path', { d: `M${x1} ${z1 - 0.25} L${x2} ${z2 - 0.25}`, stroke: INK, 'stroke-width': 0.32, 'stroke-linecap': 'round' }),
    s('path', { d: `M${x1} ${z1 - 0.25} L${x2} ${z2 - 0.25}`, stroke: colour, 'stroke-width': 0.16, 'stroke-linecap': 'round' }));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x1 + (x2 - x1) * t;
    const pz = z1 + (z2 - z1) * t;
    g.append(s('rect', { x: px - 0.12, y: pz - 0.6, width: 0.24, height: 0.7, fill: colour, ...sw(0.07) }));
  }
  return g;
}

function cottage(x, z, w, roof = '#C8473A', wall = '#FFF8EC') {
  const hh = w * 0.7;
  return s('g', {},
    s('rect', { x, y: z - hh * 0.55, width: w, height: hh * 0.55, fill: wall, ...sw(0.14) }),
    s('path', { d: `M${x - w * 0.12} ${z - hh * 0.5} L${x + w / 2} ${z - hh * 1.05} L${x + w * 1.12} ${z - hh * 0.5} Z`, fill: roof, ...sw(0.14) }),
    s('rect', { x: x + w * 0.4, y: z - hh * 0.32, width: w * 0.2, height: hh * 0.32, fill: '#8A5224', ...sw(0.08) }));
}

// ---- the parcels' own terrain (GDD §2.2 / §3.9 "Reveals") -----------------------------------------------------------

/** Vignettes per expansion id: (x, z, w, d) in tiles -> SVG children. Unknown ids get meadow tufts. */
const TERRAIN = {
  home(x, z, w, d) {
    const plots = s('g', {});
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      plots.append(s('rect', { x: x + 8.6 + i * 1.6, y: z + 5.4 + j * 1.6, width: 1.3, height: 1.3, rx: 0.2, fill: '#8A5A33', stroke: '#5A3215', 'stroke-width': 0.08 }));
      if ((i + j) % 3 !== 1) plots.append(s('path', { d: `M${x + 9.25 + i * 1.6} ${z + 6.5 + j * 1.6} v-0.7 m-0.35 0.25 l0.35 -0.3 l0.35 0.3`, stroke: '#9BE06A', 'stroke-width': 0.12, fill: 'none' }));
    }
    return [
      s('path', { d: `M${x + 3} ${z + d} Q${x + 6} ${z + 10} ${x + 7.5} ${z + 7.5} T${x + 15} ${z + 4}`, fill: 'none', stroke: '#E2C48C', 'stroke-width': 1.1, 'stroke-linecap': 'round', opacity: 0.8 }),
      plots,
      cottage(x + 1.8, z + 6.2, 4.4, '#C8473A'),
      s('path', { d: `M${x + 5.5} ${z + 1.6} q0.3 -0.8 0 -1.4 q-0.3 -0.7 0.2 -1.3`, stroke: '#fff', 'stroke-width': 0.35, fill: 'none', opacity: 0.6, 'stroke-linecap': 'round' }),
      s('g', {},
        s('rect', { x: x + 17.6, y: z + 2.4, width: 4.6, height: 3.6, fill: '#C8473A', ...sw(0.14) }),
        s('path', { d: `M${x + 17.2} ${z + 2.6} L${x + 19.9} ${z + 0.6} L${x + 22.6} ${z + 2.6} Z`, fill: '#8F2F27', ...sw(0.14) }),
        s('path', { d: `M${x + 19.1} ${z + 6} v-2.2 h1.6 v2.2 M${x + 19.1} ${z + 3.8} l1.6 2.2 M${x + 20.7} ${z + 3.8} l-1.6 2.2`, fill: '#F3E3C0', stroke: '#F3E3C0', 'stroke-width': 0.18 })),
      s('circle', { cx: x + 14.6, cy: z + 3, r: 0.85, fill: '#9AA7B4', ...sw(0.12) }),
      s('circle', { cx: x + 14.6, cy: z + 3, r: 0.45, fill: WATER_DEEP }),
      tree(x + 22.4, z + 12.6, 1.2), tree(x + 1.6, z + 13.4, 1.1),
    ];
  },
  creekside(x, z, w, d) {
    return [
      s('path', { d: `M${x + 5.5} ${z - 0.2} C${x + 2} ${z + 4} ${x + 7} ${z + 8} ${x + 3.4} ${z + d + 0.2}`, fill: 'none', stroke: WATER_DEEP, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
      s('path', { d: `M${x + 5.5} ${z - 0.2} C${x + 2} ${z + 4} ${x + 7} ${z + 8} ${x + 3.4} ${z + d + 0.2}`, fill: 'none', stroke: WATER, 'stroke-width': 0.9, 'stroke-linecap': 'round' }),
      tufts(x + 1, z + 3, 3, 10, 'creek-reeds', 9, '#2A6A1C'),
      pine(x + 6.4, z + 13.2, 3.2),
      s('rect', { x: x + 1, y: z + 1.6, width: 2.2, height: 0.7, rx: 0.3, fill: '#9C6B3E', ...sw(0.1), transform: `rotate(-18 ${x + 2} ${z + 2})` }),
      flowers(x, z + 7, w, 5, 'creek-fl', 6, ['#FFF', '#FFE58A']),
    ];
  },
  old_orchard(x, z, w, d) {
    return [
      fruitTree(x + 3, z + 4.3, 1.7, '#E8554A'), fruitTree(x + 7.4, z + 3.6, 1.7, '#E8554A'),
      fruitTree(x + 11.6, z + 4.6, 1.5, '#E8554A'),
      s('ellipse', { cx: x + 14.4, cy: z + 6.4, rx: 0.7, ry: 0.42, fill: '#C49A6C', ...sw(0.1) }),
      s('ellipse', { cx: x + 14.4, cy: z + 6.3, rx: 0.45, ry: 0.22, fill: '#E2C48C' }),
      tufts(x, z, w, d, 'orchard', 7),
    ];
  },
  cow_hill(x, z, w, d) {
    return [
      s('path', { d: `M${x} ${z + d - 0.4} Q${x + 6} ${z + 0.6} ${x + 12} ${z + 4} T${x + w} ${z + 5}`, fill: '#8FCB5A', stroke: '#3F8F2A', 'stroke-width': 0.14 }),
      s('path', { d: `M${x + 1} ${z + 6.6} L${x + 14.5} ${z + 5.2}`, stroke: '#8D8679', 'stroke-width': 0.75, 'stroke-linecap': 'round', 'stroke-dasharray': '0.6 0.25' }),
      flowers(x + 8, z + 0.5, 7, 4, 'cowhill', 9, ['#FF9BB0', '#FFF', '#FFE58A', '#B28DE0']),
      s('g', {},
        s('ellipse', { cx: x + 5, cy: z + 4.2, rx: 1.3, ry: 0.75, fill: '#FFF8EC', ...sw(0.12) }),
        s('circle', { cx: x + 4.7, cy: z + 4, r: 0.32, fill: INK }),
        s('ellipse', { cx: x + 6.15, cy: z + 3.9, rx: 0.48, ry: 0.4, fill: '#FFF8EC', ...sw(0.1) })),
    ];
  },
  sunflower_rise(x, z, w, d) {
    const g = s('g', {});
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 2; j++) {
        const fx = x + 1.4 + i * 1.6 + j * 0.8;
        const fz = z + 2.8 + j * 2.4;
        g.append(s('path', { d: `M${fx} ${fz + 1.2} v-1.2`, stroke: '#3F8F2A', 'stroke-width': 0.18 }),
          s('circle', { cx: fx, cy: fz - 0.1, r: 0.55, fill: '#FFC83D', ...sw(0.08) }),
          s('circle', { cx: fx, cy: fz - 0.1, r: 0.22, fill: '#7A4A2A' }));
      }
    }
    return [g, fenceLine(x + 0.6, z + d - 0.8, x + 9, z + d - 1.2),
      s('g', {}, s('path', { d: `M${x + 13.4} ${z + 6.6} v-3 M${x + 12.3} ${z + 4.6} h2.2`, stroke: '#8A5224', 'stroke-width': 0.3 }),
        s('circle', { cx: x + 13.4, cy: z + 3.2, r: 0.6, fill: '#F7D9A0', ...sw(0.1) }),
        s('path', { d: `M${x + 12.6} ${z + 2.9} l0.8 -0.9 l0.8 0.9 z`, fill: '#C8473A', ...sw(0.08) }))];
  },
  bee_glade(x, z, w, d) {
    const clover = s('g', {});
    for (let i = 0; i < 12; i++) {
      const cx = x + 0.8 + hash01('clover', i) * (w - 1.6);
      const cz = z + 0.8 + hash01('clover', i + 40) * (d - 1.6);
      clover.append(s('circle', { cx, cy: cz, r: 0.42, fill: '#E9A2C8', stroke: 'rgba(62,38,18,.45)', 'stroke-width': 0.06 }));
    }
    return [
      s('ellipse', { cx: x + 8, cy: z + 4, rx: 7, ry: 3.2, fill: '#9AD46A', opacity: 0.7 }),
      clover,
      s('g', {},
        s('rect', { x: x + 9.6, y: z + 3, width: 1.8, height: 1.6, fill: '#F7D9A0', ...sw(0.12) }),
        s('rect', { x: x + 9.4, y: z + 2.5, width: 2.2, height: 0.6, fill: '#D99A4A', ...sw(0.1) }),
        s('path', { d: `M${x + 12.2} ${z + 2.3} q0.4 -0.6 0.8 0 M${x + 12.9} ${z + 1.6} q0.4 -0.6 0.8 0`, stroke: INK, 'stroke-width': 0.12, fill: 'none' }),
        s('circle', { cx: x + 12.6, cy: z + 2.3, r: 0.2, fill: '#FFC83D' }), s('circle', { cx: x + 13.3, cy: z + 1.6, r: 0.2, fill: '#FFC83D' })),
      tree(x + 3, z + 4.4, 1.5),
    ];
  },
  fair_lane(x, z, w, d) {
    const flags = s('g', {});
    for (let i = 0; i < 6; i++) flags.append(s('path', { d: `M${x + 9.2 + i} ${z + 1.4 + (i % 2) * 0.15} l0.45 0.9 l0.45 -0.9 z`, fill: ['#E8554A', '#FFC83D', '#4AA8E8'][i % 3], ...sw(0.05) }));
    return [
      s('path', { d: `M${x} ${z + 5.2} L${x + w} ${z + 5.2}`, stroke: '#E2C48C', 'stroke-width': 1.8 }),
      s('path', { d: `M${x} ${z + 5.2} L${x + w} ${z + 5.2}`, stroke: '#CDAE77', 'stroke-width': 0.12, 'stroke-dasharray': '0.8 0.8' }),
      s('g', {},
        s('path', { d: `M${x + 3} ${z + 3.6} L${x + 4.8} ${z + 0.6} L${x + 6.6} ${z + 3.6} Z`, fill: '#FFF8EC', ...sw(0.12) }),
        s('path', { d: `M${x + 3.6} ${z + 3.6} L${x + 4.8} ${z + 0.6} L${x + 4.2} ${z + 3.6} Z M${x + 4.8} ${z + 0.6} L${x + 5.4} ${z + 3.6} L${x + 6} ${z + 3.6} Z`, fill: '#E8554A' }),
        s('path', { d: `M${x + 4.8} ${z + 0.6} v-0.8`, stroke: INK, 'stroke-width': 0.12 }),
        s('path', { d: `M${x + 4.8} ${z - 0.2} l0.7 0.25 l-0.7 0.25 z`, fill: '#FFC83D' })),
      s('path', { d: `M${x + 9} ${z + 1.3} Q${x + 12} ${z + 2.2} ${x + 15.2} ${z + 1.3}`, fill: 'none', stroke: INK, 'stroke-width': 0.08 }),
      flags, tree(x + 13, z + 7.2, 1),
    ];
  },
  riverbank(x, z, w, d) {
    return [
      s('rect', { x, y: z + d - 2.2, width: w, height: 2.2, fill: '#E9D49A' }),
      s('rect', { x: x + 6.6, y: z + 3.2, width: 2.2, height: 6.2, fill: '#B98552', ...sw(0.12) }),
      s('path', { d: `M${x + 6.6} ${z + 4.4} h2.2 M${x + 6.6} ${z + 5.6} h2.2 M${x + 6.6} ${z + 6.8} h2.2 M${x + 6.6} ${z + 8} h2.2`, stroke: '#7A4A2A', 'stroke-width': 0.08 }),
      willow(x + 2.8, z + 4.2, 1.9), willow(x + 12.6, z + 3.6, 1.9),
    ];
  },
  pig_woods(x, z, w, d) {
    return [
      tree(x + 2.4, z + 3.6, 1.8, '#5F8A2E', '#86B04A'), tree(x + 6.2, z + 2.8, 1.6, '#5F8A2E', '#86B04A'),
      tree(x + 13.6, z + 3.4, 1.8, '#5F8A2E', '#86B04A'),
      s('ellipse', { cx: x + 9.8, cy: z + 5.4, rx: 1.5, ry: 0.9, fill: '#8E6B45', opacity: 0.85 }),
      s('circle', { cx: x + 9.4, cy: z + 5.2, r: 0.35, fill: '#3B2A1A' }), s('circle', { cx: x + 10.3, cy: z + 5.6, r: 0.28, fill: '#3B2A1A' }),
      tufts(x, z + 4, w, 4, 'pigwoods', 6),
    ];
  },
  willow_pond(x, z, w, d) {
    const pads = s('g', {});
    for (let i = 0; i < 5; i++) {
      const px = x + 2.2 + hash01('pads', i) * 3.6;
      const pz = z + 6.6 + hash01('pads', i + 9) * 3.6;
      pads.append(s('path', { d: `M${px} ${pz} m0.45 0 a0.45 0.33 0 1 1 -0.1 -0.2 l-0.35 0.2 z`, fill: '#6FB045', ...sw(0.05) }));
    }
    return [
      s('ellipse', { cx: x + 4.1, cy: z + 8.6, rx: 3.4, ry: 4.6, fill: WATER, stroke: WATER_DEEP, 'stroke-width': 0.22 }),
      s('ellipse', { cx: x + 3.4, cy: z + 7.4, rx: 1.4, ry: 2, fill: '#A8D8D2', opacity: 0.6 }),
      pads,
      s('rect', { x: x + 5.4, y: z + 5.6, width: 2.2, height: 1.4, fill: '#B98552', ...sw(0.1) }),
      willow(x + 2.4, z + 2.8, 1.8), tree(x + 6, z + 14.2, 1.1),
    ];
  },
  goat_rocks(x, z, w, d) {
    return [
      rock(x + 4, z + 4.6, 2.6, '#B8B1A3'), rock(x + 2.6, z + 8.6, 1.8), rock(x + 5.6, z + 10.2, 1.4, '#C4BDAF'),
      s('g', {}, s('ellipse', { cx: x + 4.1, cy: z + 2.4, rx: 0.8, ry: 0.5, fill: '#FFF8EC', ...sw(0.1) }),
        s('path', { d: `M${x + 4.7} ${z + 2} l0.3 -0.6 M${x + 4.9} ${z + 2.1} l0.45 -0.45`, stroke: INK, 'stroke-width': 0.1 })),
      s('rect', { x: x + 2.4, y: z + 13, width: 3, height: 0.6, rx: 0.2, fill: '#A9A397', ...sw(0.1) }),
      tufts(x, z + 10, w, 5, 'goats', 4),
    ];
  },
  stable_paddock(x, z, w, d) {
    return [
      s('ellipse', { cx: x + 4, cy: z + 8, rx: 3, ry: 5.6, fill: '#E2C48C', stroke: '#F3E3C0', 'stroke-width': 0.35 }),
      s('ellipse', { cx: x + 4, cy: z + 8, rx: 1.7, ry: 4.2, fill: '#8FCB5A', stroke: '#F3E3C0', 'stroke-width': 0.3 }),
      s('g', {}, s('ellipse', { cx: x + 4.2, cy: z + 2.9, rx: 0.95, ry: 0.5, fill: '#8A5224', ...sw(0.1) }),
        s('path', { d: `M${x + 5} ${z + 2.7} l0.5 -0.5`, stroke: '#5A3215', 'stroke-width': 0.3, 'stroke-linecap': 'round' })),
      s('path', { d: `M${x + 3.5} ${z + 13.4} l0.5 -0.9 l0.5 0.9`, fill: 'none', stroke: '#4A7FE8', 'stroke-width': 0.18 }),
    ];
  },
  walnut_grove(x, z, w, d) {
    return [
      tree(x + 2.6, z + 4.4, 2, '#3F7A34', '#6EA24A'), tree(x + 5.6, z + 9.2, 2, '#3F7A34', '#6EA24A'),
      s('rect', { x: x + 1.4, y: z + 12.2, width: 3.2, height: 2.2, fill: '#E8554A', ...sw(0.1), transform: `rotate(-8 ${x + 3} ${z + 13.3})` }),
      s('path', { d: `M${x + 1.6} ${z + 12.9} h3 M${x + 1.6} ${z + 13.7} h3 M${x + 2.4} ${z + 12.2} v2.2 M${x + 3.4} ${z + 12.2} v2.2`, stroke: '#FFF', 'stroke-width': 0.14, transform: `rotate(-8 ${x + 3} ${z + 13.3})` }),
    ];
  },
  olive_terrace(x, z, w, d) {
    const steps = [];
    for (let i = 0; i < 3; i++) steps.push(s('path', { d: `M${x + 0.3} ${z + 2.4 + i * 2.2} Q${x + w / 2} ${z + 1.6 + i * 2.2} ${x + w - 0.3} ${z + 2.4 + i * 2.2}`, fill: 'none', stroke: '#C9B48A', 'stroke-width': 0.4 }));
    return [s('rect', { x, y: z, width: w, height: d, fill: '#B5C77A', opacity: 0.45 }), ...steps,
      tree(x + 3, z + 2.2, 1.05, '#8FA06A', '#B9C892'), tree(x + 7, z + 4.2, 1.05, '#8FA06A', '#B9C892'),
      tree(x + 11.2, z + 2.4, 1.05, '#8FA06A', '#B9C892'), tree(x + 13.6, z + 6.2, 1.05, '#8FA06A', '#B9C892')];
  },
  maple_ridge(x, z, w, d) {
    return [
      s('path', { d: `M${x} ${z + d} Q${x + 8} ${z + 0.5} ${x + w} ${z + d}`, fill: '#9ACB62', opacity: 0.7 }),
      tree(x + 3, z + 4.4, 1.5, '#D9542E', '#F08A4B'), tree(x + 7.8, z + 3, 1.6, '#C8473A', '#E8744B'),
      tree(x + 12.6, z + 4.8, 1.5, '#E07B24', '#FFB04A'),
      s('g', {}, s('rect', { x: x + 9.6, y: z + 5.4, width: 2.4, height: 0.5, fill: '#B98552', ...sw(0.1) }),
        s('path', { d: `M${x + 9.8} ${z + 5.9} v1.2 M${x + 11.8} ${z + 5.9} v1.2`, stroke: '#7A4A2A', 'stroke-width': 0.22 })),
    ];
  },
  sunset_hill(x, z, w, d) {
    return [
      s('path', { d: `M${x} ${z + d} Q${x + 7} ${z - 0.4} ${x + w} ${z + d - 1}`, fill: '#A6D873', stroke: '#3F8F2A', 'stroke-width': 0.14 }),
      s('circle', { cx: x + 12.6, cy: z + 2.2, r: 1.3, fill: '#FFC07A', opacity: 0.85 }),
      s('g', {},
        s('rect', { x: x + 6, y: z + 3.6, width: 3, height: 1.8, fill: '#FFF8EC', ...sw(0.12) }),
        s('path', { d: `M${x + 5.5} ${z + 3.8} L${x + 7.5} ${z + 2} L${x + 9.5} ${z + 3.8} Z`, fill: '#4AA8E8', ...sw(0.12) }),
        s('path', { d: `M${x + 6.6} ${z + 5.4} v-1.4 M${x + 8.4} ${z + 5.4} v-1.4`, stroke: '#8A5224', 'stroke-width': 0.15 })),
      flowers(x + 1, z + 4, 4, 3, 'sunset', 5, ['#FFE58A', '#FF9BB0']),
    ];
  },
  hollow_meadow(x, z, w, d) {
    return [flowers(x, z, w, d, 'meadow', 26, ['#FF9BB0', '#FFF', '#FFE58A', '#B28DE0', '#9ED8FF']),
      tufts(x, z, w, d, 'meadow-t', 6)];
  },
};

function willow(cx, cz, r) {
  const g = s('g', {},
    s('ellipse', { cx: cx + r * 0.3, cy: cz + r, rx: r, ry: r * 0.3, fill: 'rgba(30,50,20,.28)' }),
    s('rect', { x: cx - r * 0.13, y: cz, width: r * 0.26, height: r * 0.9, fill: TRUNK, ...sw(0.12) }),
    s('path', { d: `M${cx - r} ${cz + r * 0.5} Q${cx - r} ${cz - r * 1.2} ${cx} ${cz - r * 1.1} Q${cx + r} ${cz - r * 1.2} ${cx + r} ${cz + r * 0.5} Z`, fill: '#86B04A', ...sw(0.14) }));
  for (let i = -2; i <= 2; i++) g.append(s('path', { d: `M${cx + i * r * 0.38} ${cz - r * 0.6} q${0.1} ${r * 0.6} 0 ${r * 1.05}`, stroke: '#5F8A2E', 'stroke-width': 0.14, fill: 'none' }));
  return g;
}

/** The terrain vignette of a parcel (children for an SVG group); meadow tufts for anything unknown. */
export function terrainOf(id, rect) {
  const [x, z, w, d] = rect;
  const f = TERRAIN[id];
  return f ? f(x, z, w, d) : [tufts(x, z, w, d, id, 6)];
}

// ---- the atlas ---------------------------------------------------------------------------------------------------

/** The atlas frame in tiles: the meadow beyond the north-west edge (x 0) to the far edge, the forest to the village. */
export const ATLAS = Object.freeze({ x0: -2, z0: 2, x1: 58, z1: 68 });

let atlasSeq = 0;

/**
 * The painted farm atlas. `parcels` from expansions-map.js atlasView(): [{ id, name, k, rects, status, label }] where
 * status is 'home' | 'ours' | 'sale' | 'soon' | 'later' | 'meadow-ours' | 'meadow-later'. `onPick(id)` makes every
 * parcel a button; `selected` rings one.
 */
export function atlasSvg(parcels, { selected = null, onPick = null, label = t('home.art.map') } = {}) {
  const id = ++atlasSeq;
  const { x0, z0, x1, z1 } = ATLAS;
  const svg = s('svg', { viewBox: `${x0} ${z0} ${x1 - x0} ${z1 - z0}`, class: 'ha-atlas', role: 'group', 'aria-label': label,
    focusable: 'false', preserveAspectRatio: 'xMidYMid meet' }); // i18n-ok: an SVG attribute value
  put(svg, s('defs', {},
    s('pattern', { id: `ha-mow-${id}`, width: 3, height: 3, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' },
      s('rect', { width: 3, height: 3, fill: '#7CC243' }), s('rect', { width: 1.5, height: 3, fill: '#86CB4B' })),
    s('pattern', { id: `ha-wild-${id}`, width: 2.6, height: 2.6, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 2.6, height: 2.6, fill: '#79A85A' }), s('circle', { cx: 0.7, cy: 0.8, r: 0.32, fill: '#8BB86A' }),
      s('circle', { cx: 1.9, cy: 1.9, r: 0.26, fill: '#6A9A4C' })),
    s('linearGradient', { id: `ha-sky-${id}`, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': '#4E8A47' }), s('stop', { offset: '1', 'stop-color': '#5E9E3B' })),
    s('linearGradient', { id: `ha-river-${id}`, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': '#9AD3CC' }), s('stop', { offset: '1', 'stop-color': WATER_DEEP }))));
  // the wild ring: meadow, the forest wall along the north, hills at the sides
  put(svg, s('rect', { x: x0, y: z0, width: x1 - x0, height: z1 - z0, fill: `url(#ha-sky-${id})` }));
  const forest = s('g', { class: 'ha-forest' });
  for (let i = 0, x = x0 + 0.5; x < x1; x += 2.2, i++) forest.append(pine(x + hash01('forest', i) * 0.8, z0 + 4.4 + hash01('forest', i + 50) * 1.4, 3.4 + hash01('forest', i + 9) * 1.2));
  put(svg, forest);
  // the river, the far bank and the village (GDD §2.2)
  put(svg, s('path', { d: `M${x0} 57.6 Q10 56.6 20 57.8 T40 57.6 T${x1} 57.4 V62.4 Q48 63.2 38 62.2 T18 62.6 T${x0} 62.2 Z`, fill: `url(#ha-river-${id})`, stroke: '#2E8FC9', 'stroke-width': 0.2 }));
  put(svg, s('path', { d: `M4 59.4 q2 -0.5 4 0 M22 60.2 q2 -0.5 4 0 M40 59.6 q2 -0.5 4 0`, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.75, 'stroke-width': 0.22, 'stroke-linecap': 'round' }));
  put(svg, s('rect', { x: x0, y: 62.4, width: x1 - x0, height: z1 - 62.4, fill: '#8FBF5E' }));
  const village = s('g', { class: 'ha-village' });
  [[12, 66.6, '#C8473A'], [16.4, 66.2, '#4AA8E8'], [21, 66.8, '#E39A1E'], [27.6, 66.4, '#C8473A'], [33, 66.9, '#4A7FE8']]
    .forEach(([vx, vz, roof]) => village.append(cottage(vx, vz, 2.6, roof)));
  village.append(s('path', { d: 'M38 67 v-3.4 l0.9 -1.4 l0.9 1.4 v3.4 z', fill: '#FFF8EC', ...sw(0.12) }));
  village.append(s('text', { x: 24, y: 64.2, class: 'ha-label ha-label-far', 'text-anchor': 'middle' }, t('home.art.village')));
  put(svg, village);
  put(svg, s('ellipse', { cx: 54.5, cy: 66.4, rx: 4.6, ry: 1.9, fill: WATER, stroke: WATER_DEEP, 'stroke-width': 0.16 }));

  const land = s('g', { class: 'ha-land' });
  const top = s('g', { class: 'ha-top' });
  for (const p of parcels) {
    const g = s('g', { class: `ha-parcel ha-${p.status}${selected === p.id ? ' sel' : ''}`, 'data-exp': p.id });
    const ours = p.status === 'home' || p.status === 'ours' || p.status === 'meadow-ours';
    for (const r of p.rects) {
      const [x, z, w, d] = r;
      g.append(s('rect', { x: x + 0.12, y: z + 0.12, width: w - 0.24, height: d - 0.24, rx: 0.9, class: 'ha-ground',
        fill: ours ? `url(#ha-mow-${id})` : `url(#ha-wild-${id})` }));
      const art = s('g', { class: 'ha-art' }, ...terrainOf(p.id, r));
      if (!ours) art.setAttribute('opacity', p.status === 'sale' ? '0.92' : '0.6');
      g.append(art);
      if (!ours && p.status !== 'sale') g.append(s('rect', { x: x + 0.12, y: z + 0.12, width: w - 0.24, height: d - 0.24, rx: 0.9, class: 'ha-veil' }));
      g.append(s('rect', { x: x + 0.12, y: z + 0.12, width: w - 0.24, height: d - 0.24, rx: 0.9, class: 'ha-edge' }));
    }
    const [x, z, w, d] = p.rects[0];
    const cx = x + w / 2;
    const cz = z + d / 2;
    if (p.status === 'sale') {
      top.append(signpost(cx, cz - 0.6));
      if (p.label) top.append(tag(cx, cz + 2.4, p.label, 'ha-tag-sale'));
    } else if (p.label) {
      // our own parcels carry their name along the bottom edge, so the painted land stays visible above it
      const low = p.status === 'home' || p.status === 'ours' || p.status === 'meadow-ours' || p.status === 'meadow-later';
      top.append(tag(cx, cz, p.label, `ha-tag-${p.status}`, w - 0.8, { bottom: low ? z + d - 0.5 : null }));
    }
    if (onPick) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', p.aria || p.name);
      g.setAttribute('aria-pressed', String(selected === p.id));
      g.addEventListener('click', () => onPick(p.id));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(p.id); } });
    }
    land.append(g);
  }
  put(svg, land, top);
  return svg;
}

const CHAR = 0.8;        // about 0.8 tiles per letter at the tag's 1.45-tile type (no layout pass)

/** A little paper label; a name too wide for its parcel goes on two lines (Creekside / Meadow). */
function tag(cx, cz, text, cls, room = Infinity, { bottom = null } = {}) {
  const words = text.split(' ');
  const lines = text.length * CHAR + 1.8 > room && words.length > 1
    ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text];
  const w = Math.max(3.6, Math.max(...lines.map((l) => l.length)) * CHAR + 1.8);
  const hh = 1 + lines.length * 1.6;
  if (bottom !== null) cz = bottom - hh / 2;
  return s('g', { class: `ha-tag ${cls}`, 'aria-hidden': 'true' },
    s('rect', { x: cx - w / 2, y: cz - hh / 2, width: w, height: hh, rx: 1.3 }),
    ...lines.map((l, i) => s('text', { x: cx, y: cz - hh / 2 + 1.75 + i * 1.6, 'text-anchor': 'middle' }, l)));
}

function signpost(x, z) {
  return s('g', { class: 'ha-sign', 'aria-hidden': 'true', transform: `translate(${x} ${z})` },
    s('path', { d: 'M0 2.2 V-1.2', stroke: INK, 'stroke-width': 0.55, 'stroke-linecap': 'round' }),
    s('path', { d: 'M0 2.2 V-1.2', stroke: '#B87533', 'stroke-width': 0.3, 'stroke-linecap': 'round' }),
    s('rect', { x: -3.3, y: -3.2, width: 6.6, height: 2.5, rx: 0.4, fill: '#F7D9A0', ...sw(0.16) }),
    s('text', { x: 0, y: -1.45, 'text-anchor': 'middle', class: 'ha-sign-text' }, t('farm.map.pill.sale')));
}

// ---- the growing Barn (barn upgrades 0-10, GDD §3.6) ------------------------------------------------------------------

/**
 * The Barn with `n` upgrades: each upgrade adds a part (loft door, weathervane, lean-to, silo, lanterns, a taller loft,
 * a second silo, a cupola, a stone footing and a hay wagon, gilded trim), so the ladder reads as one barn growing.
 * `fresh` marks the part of upgrade `fresh` (it pops in). viewBox 0 0 320 210.
 */
export function barnArt(n, { capacity = null, fresh = 0, label = '' } = {}) {
  const svg = s('svg', { viewBox: '0 0 320 210', class: 'ha-barn', role: label ? 'img' : null, 'aria-label': label || null,
    'aria-hidden': label ? null : 'true', focusable: 'false' });
  const part = (k, ...kids) => (n >= k ? s('g', { class: `ha-part${fresh === k ? ' ha-fresh' : ''}`, 'data-part': String(k) }, ...kids) : null);
  const add = (el) => { if (el) put(svg, el); };
  const P = (d, fill, extra = {}) => s('path', { d, fill, ...sw(2.4), ...extra });
  const R = (x, y, w, hh, fill, extra = {}) => s('rect', { x, y, width: w, height: hh, fill, ...sw(2.4), ...extra });
  const tall = n >= 6;
  const roofY = tall ? 30 : 46;
  put(svg, 
    s('defs', {}, s('linearGradient', { id: 'ha-barn-sky', x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': '#BFE6FF' }), s('stop', { offset: '1', 'stop-color': '#FFF4D6' }))),
    s('rect', { x: 0, y: 0, width: 320, height: 210, rx: 14, fill: 'url(#ha-barn-sky)' }),
    s('circle', { cx: 270, cy: 36, r: 16, fill: '#FFE58A', opacity: 0.9 }),
    s('path', { d: 'M0 170 Q80 150 160 162 T320 156 V210 H0 Z', fill: '#A6D873' }),
    s('path', { d: 'M0 184 Q120 170 220 182 T320 178 V210 H0 Z', fill: '#7CC243' }));
  // upgrade 3: a lean-to on the left
  add(part(3, R(44, 120, 50, 54, '#B23E33'), P('M38 124 L94 104 L94 120 L44 128 Z', '#7E2620'),
    s('path', { d: 'M56 174 v-30 h26 v30', fill: '#F3E3C0', ...sw(2) })));
  // upgrade 4 and 7: silos on the right
  const silo = (x, top) => [R(x, top, 40, 174 - top, '#C9C2B5'),
    P(`M${x - 3} ${top + 2} Q${x + 20} ${top - 26} ${x + 43} ${top + 2} Z`, '#8F98A3'),
    s('path', { d: `M${x} ${top + 30} h40 M${x} ${top + 60} h40 M${x} ${top + 90} h40`, stroke: '#8D8679', 'stroke-width': 2 })];
  add(part(7, ...silo(268, 66)));
  add(part(4, ...silo(226, 82)));
  // the barn itself (taller from upgrade 6)
  const body = s('g', { class: 'ha-barn-body' },
    R(96, roofY + 40, 128, 174 - roofY - 40, '#C8473A'),
    P(`M86 ${roofY + 46} L160 ${roofY} L234 ${roofY + 46} Z`, '#8F2F27'),
    s('path', { d: `M92 ${roofY + 44} L160 ${roofY + 4} L228 ${roofY + 44}`, fill: 'none', stroke: '#F3E3C0', 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
    R(132, 122, 56, 52, '#F3E3C0'),
    s('path', { d: 'M132 122 L188 174 M188 122 L132 174 M160 122 V174', stroke: '#C8473A', 'stroke-width': 4 }),
    s('rect', { x: 132, y: 122, width: 56, height: 52, fill: 'none', ...sw(2.4) }));
  put(svg, body);
  // upgrade 1: the hay loft door with a bale peeking out
  add(part(1, R(148, roofY + 18, 24, 24, '#F3E3C0'), R(151, roofY + 29, 18, 13, '#F2C95C'),
    s('path', { d: `M152 ${roofY + 33} h16 M152 ${roofY + 38} h16`, stroke: '#C99A2E', 'stroke-width': 1.5 })));
  // upgrade 2: a weathervane rooster
  const vane = n >= 8 ? roofY - 16 : roofY;
  add(part(2, s('path', { d: `M160 ${vane} v-22`, stroke: INK, 'stroke-width': 2.5 }),
    P(`M152 ${vane - 24} q8 -10 16 0 l-4 4 h-8 z`, '#FFC83D', { 'stroke-width': 1.8 }),
    s('path', { d: `M150 ${vane - 14} h20`, stroke: INK, 'stroke-width': 2 })));
  // upgrade 5: lanterns and a flower box
  add(part(5, s('circle', { cx: 118, cy: 132, r: 6, fill: '#FFE58A', ...sw(2) }), s('circle', { cx: 202, cy: 132, r: 6, fill: '#FFE58A', ...sw(2) }),
    R(108, 158, 20, 8, '#8A5224', { 'stroke-width': 1.8 }), s('circle', { cx: 112, cy: 155, r: 3, fill: '#FF9BB0' }),
    s('circle', { cx: 118, cy: 154, r: 3, fill: '#FFF' }), s('circle', { cx: 124, cy: 155, r: 3, fill: '#FF9BB0' })));
  // upgrade 6: the taller loft and its hay hoist (a beam out of the gable with a rope and a hook)
  add(part(6, s('path', { d: `M160 ${roofY + 14} h-40`, stroke: '#5A3215', 'stroke-width': 5, 'stroke-linecap': 'round' }),
    s('path', { d: `M124 ${roofY + 14} v22`, stroke: INK, 'stroke-width': 1.6 }),
    s('path', { d: `M124 ${roofY + 36} q-4 2 -2 6 q3 3 5 -1`, fill: 'none', stroke: INK, 'stroke-width': 1.8 })));
  // upgrade 8: a cupola
  add(part(8, R(150, roofY - 8, 20, 12, '#F3E3C0', { 'stroke-width': 2 }),
    s('rect', { x: 155, y: roofY - 6, width: 10, height: 7, fill: '#5A3215' }),
    P(`M146 ${roofY - 6} L160 ${roofY - 17} L174 ${roofY - 6} Z`, '#8F2F27', { 'stroke-width': 2 })));
  // upgrade 9: a stone footing and the hay wagon
  add(part(9, s('path', { d: 'M94 174 h132', stroke: '#9AA0A6', 'stroke-width': 7, 'stroke-dasharray': '10 3' }),
    R(14, 150, 40, 18, '#B87533', { 'stroke-width': 2 }), s('path', { d: 'M18 150 q18 -16 34 0', fill: '#F2C95C', ...sw(2) }),
    s('circle', { cx: 22, cy: 172, r: 7, fill: '#8A5224', ...sw(2) }), s('circle', { cx: 46, cy: 172, r: 7, fill: '#8A5224', ...sw(2) })));
  // upgrade 10: gilded trim, a pennant and sparkles
  add(part(10, s('path', { d: `M92 ${roofY + 44} L160 ${roofY + 4} L228 ${roofY + 44}`, fill: 'none', stroke: '#F5C542', 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
    s('path', { d: `M${n >= 8 ? 172 : 160} ${vane - 26} v-14 l16 5 l-16 5`, fill: '#E8554A', ...sw(1.8) }),
    ...[[70, 70], [250, 50], [118, 40], [204, 96]].map(([x, y]) => s('path', { d: `M${x} ${y - 7} l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z`, fill: '#FFE58A', ...sw(1.2) }))));
  if (capacity !== null) {
    const y = roofY + 49;
    put(svg, s('g', { class: 'ha-barn-sign' }, R(122, y, 76, 24, '#FFF4D6', { rx: 5, 'stroke-width': 2 }),
      s('text', { x: 160, y: y + 18, 'text-anchor': 'middle', class: 'ha-barn-cap' }, fmtNum(capacity))));
  }
  return svg;
}

// ---- care glyphs and coat swatches (the Nursery and the Breeding Barn) ----------------------------------------------

/** Little drawn glyphs of animal care: 'bottle' | 'feed' (the bottle) | 'play' (a ball) | 'groom' (a brush) | 'heart'. */
export function careGlyph(name, size = 28) {
  const svg = s('svg', { viewBox: '0 0 48 48', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: 'ha-glyph' });
  const P = (d, fill, w = 2.5) => s('path', { d, fill, ...sw(w) });
  switch (name) {
    case 'bottle': case 'feed':
      put(svg, P('M18 16h12v6l3 4v14a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4V26l3-4z', '#FFFBEE'),
        P('M15 30h18v10a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4z', '#FFE58A'),
        P('M19 10h10v6H19z', '#9ED8FF'), P('M21 4h6l1 6h-8z', '#FF9BB0'));
      break;
    case 'play':
      put(svg, s('circle', { cx: 24, cy: 26, r: 15, fill: '#E8554A', ...sw(2.5) }),
        P('M11 22c8 3 18 3 26 0', 'none'), P('M14 34c6-2 14-2 20 0', 'none'),
        s('path', { d: 'M18 16a8 8 0 0 1 6-3', fill: 'none', stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.8 }));
      break;
    case 'groom':
      put(svg, P('M8 30l20-20 8 8-20 20z', '#D99A4A'), P('M14 36l-4 6-6-6 6-4z', '#8A5224'),
        ...[0, 1, 2, 3].map((i) => s('path', { d: `M${20 + i * 4} ${18 + i * 4 - 8} l6 -6`, stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round' })));
      break;
    case 'heart':
      put(svg, P('M24 41S7 30 7 18c0-6 4-10 9-10 4 0 7 2 8 6 1-4 4-6 8-6 5 0 9 4 9 10 0 12-17 23-17 23z', '#FF7A8A'));
      break;
    case 'fish':
      put(svg, P('M6 24c6-9 18-12 28-4l8-6v20l-8-6c-10 8-22 5-28-4z', '#7DB9B5'), s('circle', { cx: 14, cy: 22, r: 2, fill: INK }));
      break;
    default:
      put(svg, s('circle', { cx: 24, cy: 24, r: 14, fill: '#FFE58A', ...sw(2.5) }));
  }
  return svg;
}

/** Coat colours of the breeding coats (BREEDING.coats ids) and fur shades per species family. */
export const COAT_FILL = Object.freeze({ white: '#F6F1E7', brown: '#9A6236', spotted: '#F6F1E7', golden: '#E8B53A' });

let coatSeq = 0;
/** A round coat swatch: white, brown, spotted (white with brown patches), golden (with a sparkle), or a hue. */
export function coatSwatch(coat, { size = 34, hue = null, found = true, label = '' } = {}) {
  const id = ++coatSeq;
  const svg = s('svg', { viewBox: '0 0 40 40', width: size, height: size, class: `ha-coat${found ? '' : ' ha-coat-missing'}`,
    role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true', focusable: 'false' });
  const fill = !found ? '#EFE7D6' : hue ?? COAT_FILL[coat] ?? '#DDD';
  put(svg, s('defs', {}, s('clipPath', { id: `ha-cc-${id}` }, s('circle', { cx: 20, cy: 20, r: 16 }))));
  put(svg, s('circle', { cx: 20, cy: 20, r: 16, fill }));
  const g = s('g', { 'clip-path': `url(#ha-cc-${id})` });
  if (!found) { /* a coat still to find: a plain disc with a question mark */ } else if (coat === 'spotted') g.append(s('circle', { cx: 13, cy: 14, r: 6, fill: '#8A5224' }), s('circle', { cx: 27, cy: 26, r: 7, fill: '#8A5224' }), s('circle', { cx: 25, cy: 9, r: 3, fill: '#8A5224' }));
  else if (coat === 'brown') g.append(s('circle', { cx: 14, cy: 13, r: 9, fill: '#B47B48', opacity: 0.7 }));
  else if (coat === 'white') g.append(s('circle', { cx: 14, cy: 13, r: 8, fill: '#FFFFFF', opacity: 0.9 }));
  else if (coat === 'golden') g.append(s('circle', { cx: 14, cy: 13, r: 8, fill: '#FFE58A', opacity: 0.9 }));
  put(svg, g, s('circle', { cx: 20, cy: 20, r: 16, fill: 'none', stroke: INK, 'stroke-width': 2.4 }));
  if (coat === 'golden' && found) put(svg, s('path', { d: 'M31 3 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z', fill: '#FFF8C4', stroke: INK, 'stroke-width': 1 }));
  if (!found) put(svg, s('text', { x: 20, y: 26, 'text-anchor': 'middle', class: 'ha-coat-q' }, '?'));
  return svg;
}

// ---- the Fishing Dock -----------------------------------------------------------------------------------------------

/** A fish in profile in its own colour (a pike is long, a koi has patches, the old boot is a boot). viewBox 0 0 64 32. */
export function fishArt(id, hue = '#9DA9B0', { size = 64, caught = true, label = '' } = {}) {
  const svg = s('svg', { viewBox: '0 0 64 32', width: size, height: size / 2, class: `ha-fish${caught ? '' : ' ha-fish-none'}`,
    role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true', focusable: 'false' });
  const fill = caught ? hue : '#C9BFA8';
  if (id === 'old_boot') {
    put(svg, s('path', { d: 'M18 4h14v16l14 2c4 1 6 4 6 7v1H16z', fill: caught ? '#6E4B2B' : fill, ...sw(2) }),
      s('path', { d: 'M18 10h14', stroke: '#C9A57A', 'stroke-width': 1.5 }));
    return svg;
  }
  const long = id === 'pike';
  const body = long ? 'M4 16c8-7 24-8 40-5l8-6v22l-8-6c-16 3-32 2-40-5z' : 'M6 16c6-10 22-12 36-6l12-8v28l-12-8c-14 6-30 4-36-6z';
  put(svg, s('path', { d: body, fill, ...sw(2) }));
  if (caught) {
    put(svg, s('path', { d: long ? 'M10 15c10-3 22-3 32-1' : 'M12 13c8-4 18-4 26-1', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.55, 'stroke-width': 2, 'stroke-linecap': 'round' }));
    if (id === 'koi') put(svg, s('circle', { cx: 24, cy: 13, r: 4, fill: '#fff', opacity: 0.9 }), s('circle', { cx: 34, cy: 19, r: 3, fill: '#fff', opacity: 0.9 }));
    if (id === 'perch') for (let i = 0; i < 4; i++) put(svg, s('path', { d: `M${18 + i * 6} 9 v14`, stroke: '#3F5A2A', 'stroke-width': 1.6, opacity: 0.6 }));
    if (id === 'golden_carp') put(svg, s('path', { d: 'M50 2 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z', fill: '#FFF8C4', stroke: INK, 'stroke-width': 0.8 }));
  }
  put(svg, s('circle', { cx: long ? 10 : 13, cy: 14, r: 2, fill: caught ? INK : '#9A8F78' }));
  if (!caught) put(svg, s('text', { x: 30, y: 21, 'text-anchor': 'middle', class: 'ha-fish-q' }, '?'));
  return svg;
}

/**
 * The dock at dusk: water, lily pads, reeds, the planks and two seats. `seats` = [{ color, mark, line }] for the
 * farmers fishing now (a line in the water draws a float). viewBox 0 0 320 150.
 */
export function pondScene({ seats = [], label = '' } = {}) {
  const svg = s('svg', { viewBox: '0 0 320 150', class: 'ha-pond', role: label ? 'img' : null, 'aria-label': label || null,
    'aria-hidden': label ? null : 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid slice' }); // i18n-ok: an SVG attribute value
  put(svg, 
    s('defs', {}, s('linearGradient', { id: 'ha-pond-sky', x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': '#9ED8FF' }), s('stop', { offset: '1', 'stop-color': '#FFE8C4' })),
    s('linearGradient', { id: 'ha-pond-water', x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': '#9AD3CC' }), s('stop', { offset: '1', 'stop-color': '#3A88A2' }))),
    s('rect', { width: 320, height: 150, fill: 'url(#ha-pond-sky)' }),
    s('circle', { cx: 262, cy: 34, r: 15, fill: '#FFE58A', opacity: 0.95 }),
    s('path', { d: 'M0 64 Q60 44 120 58 T240 52 T320 56 V80 H0 Z', fill: '#86B04A' }),
    willow(40, 50, 22), willow(286, 52, 18),
    s('path', { d: 'M0 76 Q160 66 320 76 V150 H0 Z', fill: 'url(#ha-pond-water)' }),
    s('path', { d: 'M20 96 q12 -4 24 0 M140 118 q14 -4 28 0 M230 100 q12 -4 24 0', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.6, 'stroke-width': 2, 'stroke-linecap': 'round' }),
    ...[[58, 112], [92, 128], [250, 124], [276, 108]].map(([x, y]) => s('path', { d: `M${x} ${y} m9 0 a9 5 0 1 1 -2 -3.5 l-7 3.5 z`, fill: '#6FB045', ...sw(1.4) })),
    s('circle', { cx: 96, cy: 126, r: 2.6, fill: '#FF9BB0' }),
    tufts(4, 70, 34, 16, 'pond-reeds', 7, '#3F7A34'), tufts(284, 72, 32, 14, 'pond-reeds2', 6, '#3F7A34'));
  // the dock: planks from the bank out over the water, two posts and a seat at its end
  put(svg, s('path', { d: 'M150 70 L176 70 L200 132 L136 132 Z', fill: '#B98552', ...sw(2.2) }),
    s('path', { d: 'M147 84 h33 M144 96 h40 M141 108 h47 M138 120 h55', stroke: '#7A4A2A', 'stroke-width': 1.6 }),
    s('rect', { x: 132, y: 128, width: 8, height: 20, fill: '#7A4A2A', ...sw(1.6) }), s('rect', { x: 196, y: 128, width: 8, height: 20, fill: '#7A4A2A', ...sw(1.6) }));
  const at = [[150, 118], [186, 118]];
  seats.slice(0, 2).forEach((p, i) => {
    const [x, y] = at[i];
    const g = s('g', { class: 'ha-pond-seat' },
      s('circle', { cx: x, cy: y - 16, r: 11, fill: p.color || '#2BB3A3', ...sw(2) }),
      s('text', { x, y: y - 11.5, 'text-anchor': 'middle', class: 'ha-pond-mark' }, p.mark || ''),
      s('path', { d: `M${x} ${y - 27} L${x + (i ? 40 : -40)} ${y - 62}`, stroke: '#5A3215', 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
    if (p.line) {
      const fx = x + (i ? 70 : -70);
      g.append(s('path', { d: `M${x + (i ? 40 : -40)} ${y - 62} Q${fx} ${y - 40} ${fx} ${y - 6}`, fill: 'none', stroke: '#fff', 'stroke-width': 1, opacity: 0.9 }),
        s('g', { class: 'ha-float' }, s('circle', { cx: fx, cy: y - 6, r: 4, fill: '#E8554A', ...sw(1.4) }),
          s('path', { d: `M${fx - 4} ${y - 6} h8`, stroke: '#fff', 'stroke-width': 1.6 })));
    }
    put(svg, g);
  });
  return svg;
}

// ---- Restoration 4-6 scenes (Orchard Pond, Town Fair Grounds, Grandma's Farmhouse) ----------------------------------
// Each project heals bundle by bundle: every bundle repairs its own part of the picture (as restoration.js does for
// projects 1-3). viewBox 0 0 320 180; `done` = a Set of the bundle ids given.

const SP = (d, fill, extra = {}) => s('path', { d, fill, stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra });
const SR = (x, y, w, hh, fill, extra = {}) => s('rect', { x, y, width: w, height: hh, fill, stroke: INK, 'stroke-width': 2.2, ...extra });
const SC = (cx, cy, r, fill, extra = {}) => s('circle', { cx, cy, r, fill, stroke: INK, 'stroke-width': 2, ...extra });
const SL = (d, stroke, w = 2) => s('path', { d, fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
let sceneSeq = 0;

function sceneBack(svg, healed) {
  const id = `ha-sky-${++sceneSeq}`;
  put(svg, 
    s('defs', {}, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': healed ? '#7CC8F5' : '#AEBCC4' }),
      s('stop', { offset: '.75', 'stop-color': healed ? '#D6F1FF' : '#DAD8CF' }),
      s('stop', { offset: '1', 'stop-color': healed ? '#FFF1D6' : '#E6E1D3' }))),
    s('rect', { x: 0, y: 0, width: 320, height: 180, fill: `url(#${id})` }),
    s('circle', { cx: 272, cy: 32, r: 14, fill: healed ? '#FFE58A' : '#EFEAD8' }),
    healed ? s('circle', { cx: 272, cy: 32, r: 21, fill: '#FFE58A', opacity: 0.35 }) : null,
    s('path', { d: 'M0 104 Q70 82 150 96 T320 88 V180 H0 Z', fill: healed ? '#A6D873' : '#AFB38C' }),
    s('path', { d: 'M0 122 Q110 104 210 118 T320 114 V180 H0 Z', fill: healed ? '#7CC243' : '#979C74' }));
}

function sparkle(svg, pts) {
  for (const [x, y, r] of pts) put(svg, s('path', { d: `M${x} ${y - r} l${r * 0.3} ${r * 0.7} l${r * 0.7} ${r * 0.3} l-${r * 0.7} ${r * 0.3} l-${r * 0.3} ${r * 0.7} l-${r * 0.3} -${r * 0.7} l-${r * 0.7} -${r * 0.3} l${r * 0.7} -${r * 0.3} z`, fill: '#FFF8C4', stroke: INK, 'stroke-width': 1.2 }));
}

function orchardPond(svg, d) {
  const all = d.size >= 4;
  sceneBack(svg, all);
  // the pond
  if (d.has('pond')) {
    put(svg, s('ellipse', { cx: 132, cy: 142, rx: 74, ry: 22, fill: '#7DB9B5', stroke: '#2E8FC9', 'stroke-width': 2.2 }),
      s('ellipse', { cx: 112, cy: 136, rx: 30, ry: 6, fill: '#A8D8D2', opacity: 0.7 }),
      SP('M168 146 m10 0 a10 5 0 1 1 -2 -4 l-8 4 z', '#6FB045', { 'stroke-width': 1.4 }),
      SP('M92 150 m9 0 a9 4 0 1 1 -2 -3 l-7 3 z', '#6FB045', { 'stroke-width': 1.4 }),
      SP('M146 134 q6 -8 14 -2 l6 -2 -4 5 q-4 6 -12 4 z', '#FFF8EC', { 'stroke-width': 1.6 }), s('circle', { cx: 160, cy: 131, r: 1.4, fill: INK }));
  } else {
    put(svg, s('ellipse', { cx: 132, cy: 142, rx: 74, ry: 22, fill: '#B49A72', stroke: INK, 'stroke-width': 2 }),
      SL('M90 140 l12 4 l8 -6 M140 150 l10 -4 l12 4 M160 136 l8 6', '#7A6248', 1.6));
  }
  // the fruit trees
  const crowns = [[42, 92, '#E8554A'], [236, 84, '#FFC83D'], [284, 100, '#F08A4B']];
  for (const [x, y, fruit] of crowns) {
    put(svg, SR(x - 4, y + 4, 8, 34, '#8A5224'));
    if (d.has('fruit')) {
      put(svg, SC(x, y - 6, 24, '#5DBB3F'), s('circle', { cx: x - 8, cy: y - 14, r: 9, fill: '#9BE06A', opacity: 0.8 }));
      for (let i = 0; i < 5; i++) put(svg, SC(x - 14 + i * 7, y - 6 + ((i * 7) % 11) - 4, 3.6, fruit, { 'stroke-width': 1.2 }));
    } else {
      put(svg, SL(`M${x} ${y + 4} l-14 -18 M${x} ${y} l16 -20 M${x} ${y - 6} l-2 -22`, '#7A4A2A', 3));
    }
  }
  // the press: a pump and the channels to the trees
  if (d.has('press')) {
    put(svg, SR(196, 116, 22, 22, '#B87533'), SP('M192 118 L207 104 L222 118 Z', '#C8473A'),
      SL('M218 132 Q236 128 236 124', '#4AA8E8', 4), SL('M196 134 Q120 112 52 128', '#4AA8E8', 3), SL('M218 134 Q260 136 284 134', '#4AA8E8', 3));
  } else {
    put(svg, SR(198, 132, 20, 6, '#9C7A55', { transform: 'rotate(-12 208 135)' }), SR(204, 124, 4, 16, '#9C7A55', { transform: 'rotate(28 206 132)' }));
  }
  // the candles: lanterns round the pond
  for (const [x, y] of [[66, 124], [118, 116], [196, 150]]) {
    put(svg, SL(`M${x} ${y} v-22`, '#5A3215', 3));
    if (d.has('candles')) put(svg, s('circle', { cx: x, cy: y - 26, r: 9, fill: '#FFE58A', opacity: 0.45 }), SR(x - 5, y - 32, 10, 11, '#FFD18A', { 'stroke-width': 1.6 }));
    else put(svg, SR(x - 5, y - 32, 10, 11, '#C9C2B5', { 'stroke-width': 1.6 }));
  }
  if (all) sparkle(svg, [[132, 66, 7], [88, 80, 5], [250, 60, 5]]);
}

function fairGrounds(svg, d) {
  const all = d.size >= 4;
  sceneBack(svg, all);
  // the tent (textiles)
  if (d.has('textiles')) {
    put(svg, SP('M110 118 L160 52 L210 118 Z', '#FFF8EC'), SP('M122 118 L160 52 L140 118 Z M160 52 L180 118 L198 118 Z', '#E8554A', { 'stroke-width': 0 }),
      SP('M110 118 L160 52 L210 118 Z', 'none'), SR(150, 96, 20, 22, '#5A3215'), SL('M160 52 v-14', INK, 2.2), SP('M160 38 l14 5 l-14 5 z', '#FFC83D', { 'stroke-width': 1.6 }));
    const flags = ['#E8554A', '#FFC83D', '#4AA8E8', '#5DBB3F'];
    put(svg, SL('M20 60 Q90 78 160 52 Q230 78 300 58', INK, 1.4));
    for (let i = 0; i < 12; i++) {
      const x = 28 + i * 24;
      const y = i < 6 ? 62 + Math.sin(i / 1.8) * 6 : 62 + Math.sin((11 - i) / 1.8) * 6;
      put(svg, SP(`M${x} ${y} l6 12 l6 -12 z`, flags[i % 4], { 'stroke-width': 1.2 }));
    }
  } else {
    put(svg, SL('M120 118 L160 60 L200 118 M160 60 v58', '#8A5224', 4));
  }
  // the show ring (livestock)
  if (d.has('livestock')) {
    put(svg, s('ellipse', { cx: 254, cy: 150, rx: 52, ry: 18, fill: '#E2C48C', stroke: '#F3E3C0', 'stroke-width': 5 }),
      s('ellipse', { cx: 254, cy: 150, rx: 52, ry: 18, fill: 'none', stroke: INK, 'stroke-width': 1.6 }),
      SP('M240 146 q2 -14 22 -14 q12 0 14 10 l6 2 -4 4 h-36 z', '#FFF8EC'), SC(268, 136, 2.5, INK, { 'stroke-width': 0 }),
      SC(250, 136, 6, '#4A7FE8', { 'stroke-width': 1.4 }), SC(250, 136, 2.6, '#FFC83D', { 'stroke-width': 1 }));
  } else {
    put(svg, SL('M214 156 l18 -10 M248 162 l24 -6 M282 152 l14 6', '#9C7A55', 4));
  }
  // the pie stall (pies)
  if (d.has('pies')) {
    put(svg, SR(24, 112, 64, 34, '#F3E1B3'), SP('M18 112 L32 94 L80 94 L94 112 Z', '#E8554A'),
      SL('M30 112 L38 94 M50 112 L52 94 M70 112 L66 94 M86 112 L80 94', '#FFF8EC', 4));
    for (let i = 0; i < 3; i++) put(svg, s('ellipse', { cx: 38 + i * 18, cy: 110, rx: 8, ry: 4, fill: '#D99A4A', stroke: INK, 'stroke-width': 1.6 }));
  } else {
    put(svg, SR(30, 130, 22, 16, '#C9A77A'), SR(56, 136, 18, 12, '#C9A77A'));
  }
  // the hampers: a picnic blanket and baskets
  if (d.has('hampers')) {
    put(svg, SP('M98 150 L158 140 L178 166 L112 176 Z', '#E8554A'),
      SL('M108 162 L168 152 M104 156 L164 146', '#FFF8EC', 2), SR(124, 146, 18, 12, '#D99A4A', { 'stroke-width': 1.6 }),
      SL('M126 146 q7 -10 14 0', INK, 1.6));
  } else {
    put(svg, SL('M110 160 q10 -6 20 0 M140 166 q10 -6 20 0', '#7A7C55', 2));
  }
  if (all) sparkle(svg, [[160, 30, 7], [60, 76, 5], [254, 108, 5]]);
}

function farmhouseScene(svg, d) {
  const all = d.size >= 4;
  sceneBack(svg, all);
  const wood = d.has('woodwork');
  const wall = wood ? '#FFF8EC' : '#D9D2C2';
  // the house
  put(svg, SR(92, 70, 136, 76, wall), SP('M80 74 L160 26 L240 74 Z', wood ? '#C8473A' : '#9C6A5A'),
    SR(186, 24, 16, 30, '#B8B1A3'));
  // the chimney smoke (sweets: something is baking)
  if (d.has('sweets')) {
    put(svg, SL('M194 18 q-8 -8 0 -14 q8 -6 2 -14', '#FFFFFF', 4), s('ellipse', { cx: 120, cy: 100, rx: 10, ry: 4, fill: '#D99A4A', stroke: INK, 'stroke-width': 1.4 }));
  }
  // windows: lit and curtained with comfort, dark without
  for (const x of [104, 196]) {
    const lit = d.has('comfort');
    put(svg, SR(x, 84, 22, 20, lit ? '#FFD18A' : '#5C6670'));
    if (lit) put(svg, SP(`M${x} 84 h7 q-3 10 0 20 h-7 z M${x + 22} 84 h-7 q3 10 0 20 h7 z`, '#E8556E', { 'stroke-width': 1.4 }));
    put(svg, SL(`M${x + 11} 84 v20 M${x} 94 h22`, INK, 1.6));
    // shutters: straight with woodwork, hanging crooked without
    if (wood) put(svg, SR(x - 8, 84, 7, 20, '#4A7FE8', { 'stroke-width': 1.6 }), SR(x + 23, 84, 7, 20, '#4A7FE8', { 'stroke-width': 1.6 }));
    else put(svg, SR(x - 9, 88, 7, 20, '#7D8C9C', { 'stroke-width': 1.6, transform: `rotate(-14 ${x - 5} 98)` }));
  }
  // the door and the porch
  put(svg, SR(150, 108, 22, 38, '#8A5224'));
  if (wood) {
    put(svg, SR(134, 142, 54, 8, '#B87533'), SL('M138 142 v-34 M184 142 v-34', '#B87533', 4), SP('M130 110 L160 96 L192 110 Z', '#8F2F27'));
  } else {
    put(svg, SR(136, 144, 22, 6, '#9C7A55', { transform: 'rotate(8 146 147)' }), SR(166, 146, 18, 5, '#9C7A55', { transform: 'rotate(-10 175 148)' }));
  }
  // the larder: garden boxes and a bench of jars
  if (d.has('larder')) {
    put(svg, SR(30, 140, 46, 14, '#8A5A33'), ...[0, 1, 2, 3].map((i) => SC(38 + i * 10, 136, 5, i % 2 ? '#E8554A' : '#5DBB3F', { 'stroke-width': 1.4 })),
      SR(244, 132, 52, 6, '#B87533'), ...[0, 1, 2].map((i) => SR(250 + i * 15, 118, 10, 14, ['#FFC83D', '#E8556E', '#9B6BD6'][i], { 'stroke-width': 1.4 })));
  } else {
    put(svg, SL('M34 150 q4 -12 8 0 M48 152 q4 -10 8 0 M256 146 q4 -12 8 0', '#6E7D45', 2.4));
  }
  // the quilt on the line (comfort)
  if (d.has('comfort')) {
    put(svg, SL('M248 96 L304 92', INK, 1.4), SR(258, 96, 30, 22, '#FFC83D', { 'stroke-width': 1.6 }),
      SL('M258 107 h30 M273 96 v22', '#E8556E', 2));
  }
  if (all) sparkle(svg, [[160, 14, 7], [60, 70, 5], [268, 64, 5]]);
}

const HOME_SCENES = { orchard_pond: orchardPond, fair_grounds: fairGrounds, farmhouse: farmhouseScene };

/** The painted scene of Restoration project 4-6 with `done` bundles given (null for another project). */
export function homeScene(projectId, done, { label = '' } = {}) {
  const f = HOME_SCENES[projectId];
  if (!f) return null;
  const svg = s('svg', { viewBox: '0 0 320 180', class: 'pc-scene ha-scene', role: label ? 'img' : null, 'aria-label': label || null,
    'aria-hidden': label ? null : 'true', preserveAspectRatio: 'xMidYMid slice', focusable: 'false' }); // i18n-ok: an SVG attribute value
  f(svg, done instanceof Set ? done : new Set(done || []));
  return svg;
}

// ---- the farmhouse room: furniture drawn from above, and the room plan ----------------------------------------------
// The interior is a floor grid (INTERIOR.grid) with a back wall (top) and a left wall; wall pieces hang on wall slots.
// 1 tile = 10 units. Each piece is drawn in its own box from above (wall pieces face the viewer on their wall strip).

const U = 10;
const FURN_FILL = { seating: '#E8756A', tables: '#B87533', comfort: '#8A6BB0', kitchen: '#5E6770', music: '#5A3215',
  lights: '#FFC83D', plants: '#4C9A3E', rugs: '#E8B04B', walls: '#D9A441', fixed: '#B87533' };
const thin = (w = 1) => ({ stroke: INK, 'stroke-width': w, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
const R2 = (x, y, w, hh, fill, extra = {}) => s('rect', { x, y, width: w, height: hh, fill, rx: 1.4, ...thin(1.1), ...extra });
const C2 = (cx, cy, r, fill, extra = {}) => s('circle', { cx, cy, r, fill, ...thin(1), ...extra });
const L2 = (d, stroke, w = 1) => s('path', { d, fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });

/** A furniture piece drawn from above in the box (0, 0, w, h) (units). Returns SVG children. */
function pieceTop(def, w, h) {
  const id = def.id;
  const fill = FURN_FILL[def.cat] ?? '#B87533';
  const pad = 1.2;
  const x = pad;
  const y = pad;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  switch (id) {
    case 'sofa': case 'window_seat':
    {
      const n = Math.max(2, Math.round(iw / 10));
      return [R2(x, y, iw, ih, '#C8473A', { rx: 2.4 }), R2(x + 1, y + 0.8, iw - 2, ih * 0.3, '#D9594C', { rx: 1.6, 'stroke-width': 0.8 }),
        ...Array.from({ length: n }, (_, i) => R2(x + 1.6 + ((iw - 3.2) * i) / n, y + ih * 0.4, (iw - 3.2) / n - 0.8, ih * 0.5, '#F29484',
          { 'stroke-width': 0.7, rx: 1.4 })),
        ...Array.from({ length: n }, (_, i) => L2(`M${x + 2.6 + ((iw - 3.2) * i) / n} ${y + ih * 0.47} h${(iw - 3.2) / n - 2.8}`, '#FBC3B7', 0.8))];
    }
    case 'armchair':
      return [R2(x, y, iw, ih, '#4A7F6E', { rx: 2.4 }), R2(x + 0.6, y + 0.6, iw - 1.2, ih * 0.32, '#5E9A86', { rx: 1.6, 'stroke-width': 0.7 }),
        R2(x, y + ih * 0.2, iw * 0.22, ih * 0.8, '#5E9A86', { rx: 1.4, 'stroke-width': 0.7 }), R2(x + iw * 0.78, y + ih * 0.2, iw * 0.22, ih * 0.8, '#5E9A86', { rx: 1.4, 'stroke-width': 0.7 }),
        R2(x + iw * 0.25, y + ih * 0.38, iw * 0.5, ih * 0.54, '#8CC7B2', { 'stroke-width': 0.7, rx: 1.4 }),
        L2(`M${x + iw * 0.32} ${y + ih * 0.46} h${iw * 0.3}`, '#C8E8DC', 0.8)];
    case 'footstool': return [C2(w / 2, h / 2, Math.min(iw, ih) / 2.3, '#4A7F6E'), C2(w / 2, h / 2, Math.min(iw, ih) / 3.2, '#8CC7B2', { 'stroke-width': 0.6 }),
      C2(w / 2, h / 2, 0.7, '#4A7F6E', { 'stroke-width': 0 })];
    case 'rocking_horse':
      return [L2(`M${x + 1} ${h - 2} q${iw / 2} 4 ${iw - 2} 0`, '#8A5224', 1.6), R2(x + iw * 0.2, y + ih * 0.3, iw * 0.6, ih * 0.35, '#F3E3C0'),
        C2(x + iw * 0.8, y + ih * 0.25, 2.2, '#F3E3C0'), L2(`M${x + iw * 0.2} ${y + ih * 0.35} l-2 -3`, '#8A5224', 1.2)];
    case 'daybed':
      return [R2(x, y, iw, ih, '#F3E3C0'), ...[0, 1, 2, 3, 4, 5].map((i) => R2(x + 1 + (i % 3) * (iw - 2) / 3, y + ih * 0.3 + Math.floor(i / 3) * ih * 0.32,
        (iw - 2) / 3, ih * 0.32, ['#8A6BB0', '#FFC83D', '#E8556E'][(i + Math.floor(i / 3)) % 3], { 'stroke-width': 0.6, rx: 0.4 })), R2(x + 2, y + 1.5, iw * 0.3, ih * 0.22, '#FFF8EC')];
    case 'keepsake_shelf':
      return [R2(x, y, iw, ih, '#8A5224'), L2(`M${x + 1} ${y + ih / 2} h${iw - 2}`, '#5A3215', 0.6),
        C2(x + iw * 0.25, y + ih * 0.5, Math.min(2.2, ih / 3), '#FF7A8A', { 'stroke-width': 0.5 }),
        R2(x + iw * 0.55, y + ih * 0.22, iw * 0.18, ih * 0.56, '#FFC83D', { 'stroke-width': 0.5, rx: 0.4 }),
        C2(x + iw * 0.85, y + ih * 0.5, Math.min(1.6, ih / 4), '#9ED8FF', { 'stroke-width': 0.5 })];
    case 'hope_chest': return [R2(x, y, iw, ih, '#8A5224'), L2(`M${x} ${h / 2} h${iw}`, '#D9A441', 1.6), C2(w / 2, h / 2, 1.2, '#D9A441')];
    case 'bookcase':
      return [R2(x, y, iw, ih, '#7A4A2A'), ...Array.from({ length: Math.round(iw / 2.4) }, (_, i) => s('rect', { x: x + 1 + i * 2.4, y: y + 1, width: 1.8,
        height: ih - 2, fill: ['#C8473A', '#4A7FE8', '#5DBB3F', '#FFC83D', '#8A6BB0'][i % 5], rx: 0.3 }))];
    case 'dresser': return [R2(x, y, iw, ih, '#4AA8E8'), L2(`M${x + iw / 2} ${y} v${ih}`, INK, 0.8), C2(x + iw * 0.25, h / 2, 0.9, '#FFF8EC'), C2(x + iw * 0.75, h / 2, 0.9, '#FFF8EC')];
    case 'range_stove': return [R2(x, y, iw, ih, '#3E4248'), ...[0.25, 0.75].map((f) => C2(x + iw * f, h / 2, Math.min(iw / 5, ih / 2.6), '#2A2D31', { stroke: '#9AA0A6' }))];
    case 'kitchen_hutch': return [R2(x, y, iw, ih, '#5E8A7A'), ...[0.2, 0.4, 0.6, 0.8].map((f) => C2(x + iw * f, h / 2, 1.6, '#FFF8EC', { 'stroke-width': 0.6 }))];
    case 'butter_churn': return [C2(w / 2, h / 2, Math.min(iw, ih) / 2.3, '#B98552'), C2(w / 2, h / 2, 1, '#7A4A2A')];
    case 'piano': return [R2(x, y, iw, ih, '#2E2016'), R2(x + 1, y + ih * 0.62, iw - 2, ih * 0.3, '#FFFBEE', { 'stroke-width': 0.6 }),
      ...Array.from({ length: Math.round(iw / 1.6) }, (_, i) => s('rect', { x: x + 1.6 + i * 1.6, y: y + ih * 0.62, width: 0.7, height: ih * 0.18, fill: '#2E2016' }))];
    case 'gramophone': return [R2(x + 1, y + ih * 0.45, iw - 2, ih * 0.5, '#7A4A2A'), s('path', { d: `M${w / 2} ${y + ih * 0.5} L${x} ${y} Q${w / 2} ${y - 1} ${x + iw} ${y} Z`, fill: '#D9A441', ...thin(0.9) })];
    case 'dining_table': case 'side_table': case 'writing_desk': case 'tea_trolley': case 'duet_table': {
      const out = [R2(x, y, iw, ih, '#C98A4B'), ...Array.from({ length: Math.max(1, Math.round(ih / 3.4)) }, (_, i) => L2(`M${x + 0.6} ${y + (i + 1) * ih / (Math.round(ih / 3.4) + 1)} h${iw - 1.2}`, '#A9672C', 0.5))];
      if (id === 'writing_desk') out.push(R2(x + iw * 0.15, y + ih * 0.2, iw * 0.3, ih * 0.55, '#FFFBEE', { 'stroke-width': 0.5 }));
      if (id === 'tea_trolley') out.push(C2(w / 2 - 1.6, h / 2, 1.1, '#FFFBEE'), C2(w / 2 + 1.6, h / 2, 1.1, '#FFFBEE'));
      if (id === 'duet_table') out.push(C2(x + iw * 0.3, y + ih * 0.35, 2, '#FFE58A'), C2(x + iw * 0.7, y + ih * 0.65, 2, '#E8556E'), L2(`M${x + iw * 0.3 - 1} ${y + ih * 0.35} h2 M${x + iw * 0.7 - 1} ${y + ih * 0.65} h2`, INK, 0.5));
      if (id === 'dining_table') out.push(...[0.25, 0.5, 0.75].map((f) => C2(x + iw * f, h / 2, 1.3, '#FFFBEE', { 'stroke-width': 0.6 })));
      return out;
    }
    case 'floor_lamp': return [C2(w / 2, h / 2, Math.min(iw, ih) / 1.6, '#FFE58A', { stroke: 'none', opacity: 0.45 }), C2(w / 2, h / 2, Math.min(iw, ih) / 3, '#FFF1B8')];
    case 'candle_stand': return [C2(w / 2, h / 2, Math.min(iw, ih) / 1.7, '#FFE58A', { stroke: 'none', opacity: 0.4 }), C2(w / 2, h / 2, 1.6, '#FFF8EC'), C2(w / 2, h / 2, 0.7, '#E39A1E', { 'stroke-width': 0 })];
    case 'fern_pot': return [C2(w / 2, h / 2, Math.min(iw, ih) / 2.2, '#5DBB3F'), ...[0, 1, 2, 3, 4].map((i) => L2(`M${w / 2} ${h / 2} l${Math.cos(i * 1.26) * 3.4} ${Math.sin(i * 1.26) * 3.4}`, '#2A6A1C', 0.7))];
    case 'lemon_pot': return [C2(w / 2, h / 2, Math.min(iw, ih) / 2.2, '#4C9A3E'), C2(w / 2 - 1.4, h / 2 - 1, 0.9, '#FFE04A', { 'stroke-width': 0.5 }), C2(w / 2 + 1.5, h / 2 + 0.8, 0.9, '#FFE04A', { 'stroke-width': 0.5 })];
    case 'pet_bed': return [s('ellipse', { cx: w / 2, cy: h / 2, rx: iw / 2.2, ry: ih / 2.8, fill: '#E8756A', ...thin(1) }), s('ellipse', { cx: w / 2, cy: h / 2, rx: iw / 3.4, ry: ih / 4.6, fill: '#F7C8B8' })];
    case 'rag_rug':
      return [R2(x, y, iw, ih, '#E8B04B', { rx: 2 }), ...[0, 1, 2, 3].map((i) => L2(`M${x + 1} ${y + 2 + i * (ih - 4) / 3} h${iw - 2}`, ['#E8556E', '#4AA8E8', '#5DBB3F', '#8A6BB0'][i], 1.2))];
    case 'braided_rug':
      return [C2(w / 2, h / 2, Math.min(iw, ih) / 2, '#C98A4B'), C2(w / 2, h / 2, Math.min(iw, ih) / 2.6, '#E8B04B', { 'stroke-width': 0.6 }),
        C2(w / 2, h / 2, Math.min(iw, ih) / 3.8, '#E8556E', { 'stroke-width': 0.6 }), C2(w / 2, h / 2, Math.min(iw, ih) / 7, '#FFF8EC', { 'stroke-width': 0.6 })];
    case 'hall_runner':
      return [R2(x, y, iw, ih, '#8A3A4A', { rx: 1 }), R2(x + 1.2, y + 1.2, iw - 2.4, ih - 2.4, 'none', { stroke: '#E8B04B', 'stroke-width': 0.8 })];
    case 'fireplace':
      return [R2(x, y, iw, ih, '#A9A397'), R2(x + iw * 0.25, y + ih * 0.3, iw * 0.5, ih * 0.6, '#3E2612'),
        s('path', { d: `M${w / 2 - 2} ${y + ih * 0.85} q2 -4 0 -6 q3 2 2 6 z`, fill: '#FFB04A' })];
    default:
      return [R2(x, y, iw, ih, fill)];
  }
}

/** A wall piece facing the viewer in the box (0, 0, w, h). */
function pieceWall(def, w, h) {
  const id = def.id;
  const frame = (inner) => [R2(0.8, 0.8, w - 1.6, h - 1.6, '#D9A441'), R2(2, 2, w - 4, h - 4, '#FFFBEE', { 'stroke-width': 0.6 }), ...inner];
  switch (id) {
    case 'valley_painting': case 'memory_frame':
      return frame([s('path', { d: `M2.2 ${h * 0.62} Q${w / 2} ${h * 0.35} ${w - 2.2} ${h * 0.6} V${h - 2.2} H2.2 Z`, fill: '#7CC243' }), C2(w * 0.72, h * 0.35, 1.2, '#FFC83D', { 'stroke-width': 0.4 })]);
    case 'couple_photo': return frame([C2(w * 0.38, h / 2, 1.6, '#2BB3A3', { 'stroke-width': 0.5 }), C2(w * 0.62, h / 2, 1.6, '#FF7A6B', { 'stroke-width': 0.5 })]);
    case 'hazel_portrait': return frame([C2(w / 2, h * 0.44, 2, '#F7C8A8', { 'stroke-width': 0.5 }), s('path', { d: `M${w / 2 - 2.4} ${h * 0.34} q2.4 -2.4 4.8 0`, fill: '#E6E6E6', ...thin(0.4) })]);
    case 'cuckoo_clock': return [s('path', { d: `M1.5 ${h * 0.45} L${w / 2} 1 L${w - 1.5} ${h * 0.45} V${h - 1} H1.5 Z`, fill: '#8A5224', ...thin(1) }), C2(w / 2, h * 0.62, 2.2, '#FFFBEE', { 'stroke-width': 0.6 })];
    case 'quilt_hanging': return [R2(1, 1, w - 2, h - 2, '#FFF8EC'), ...[0, 1, 2, 3, 4, 5].map((i) => s('rect', { x: 1.5 + (i % 3) * (w - 3) / 3, y: 1.5 + Math.floor(i / 3) * (h - 3) / 2, width: (w - 3) / 3, height: (h - 3) / 2, fill: ['#E8556E', '#FFC83D', '#4AA8E8'][(i + Math.floor(i / 3)) % 3], opacity: 0.85 }))];
    case 'oval_mirror': return [s('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2 - 1.2, ry: h / 2 - 0.8, fill: '#D9A441', ...thin(1) }), s('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2 - 2.6, ry: h / 2 - 2.2, fill: '#CFE7F3' })];
    case 'plate_rack': return [R2(0.8, h * 0.2, w - 1.6, h * 0.65, '#B87533'), ...Array.from({ length: Math.round(w / 4) }, (_, i) => C2(3 + i * 4, h * 0.48, 1.6, ['#FFFBEE', '#9ED8FF'][i % 2], { 'stroke-width': 0.5 }))];
    case 'memory_wall': return [R2(0.6, 0.6, w - 1.2, h - 1.2, '#F3E3C0', { 'stroke-width': 0.6 }), ...Array.from({ length: Math.round(w / 3.6) }, (_, i) => R2(1.6 + i * 3.6, 2 + (i % 2) * 1.6, 2.8, 3.6, ['#FFC83D', '#E8556E', '#4AA8E8', '#5DBB3F'][i % 4], { 'stroke-width': 0.5, rx: 0.3 }))];
    case 'ribbon_wall': return [R2(0.6, 0.6, w - 1.2, h - 1.2, '#B87533', { 'stroke-width': 0.6 }), ...Array.from({ length: Math.round(w / 4.2) }, (_, i) => C2(3 + i * 4.2, h / 2, 1.6, ['#4A7FE8', '#E8556E', '#FFC83D'][i % 3], { 'stroke-width': 0.5 }))];
    case 'keepsake_shelf': return [R2(0.6, h * 0.55, w - 1.2, 1.8, '#8A5224'), C2(4, h * 0.42, 1.5, '#FF7A8A', { 'stroke-width': 0.5 }), R2(w - 7, h * 0.22, 3, 3.8, '#FFC83D', { 'stroke-width': 0.5 })];
    case 'farmhouse_window': return [R2(1, 1, w - 2, h - 2, '#9ED8FF'), L2(`M${w / 2} 1 V${h - 1} M1 ${h / 2} H${w - 1}`, '#FFFBEE', 1), s('path', { d: `M1 1 h4 q-1.6 ${h / 2} 0 ${h - 2} h-4 z M${w - 1} 1 h-4 q1.6 ${h / 2} 0 ${h - 2} h4 z`, fill: '#E8556E', ...thin(0.5) })];
    default: return frame([]);
  }
}

/** A catalog card picture of a furniture piece (an SVG of `px` pixels: the piece from above, or on its wall). */
export function furnitureArt(def, { px = 64, label = '' } = {}) {
  const [sw0, sd0] = def.size ?? [1, 1];
  const isWall = def.layer === 'wall';
  const w = sw0 * U;
  const hh = isWall ? U : sd0 * U;
  const side = Math.max(w, hh) + 4;
  const svg = s('svg', { viewBox: `${(w - side) / 2} ${(hh - side) / 2} ${side} ${side}`, width: px, height: px, class: `ha-furn ha-furn-${def.layer}`,
    role: label ? 'img' : null, 'aria-label': label || null, 'aria-hidden': label ? null : 'true', focusable: 'false' });
  if (isWall) put(svg, s('rect', { x: -2, y: -2, width: w + 4, height: hh + 4, rx: 2, fill: '#F2E1C4' }));
  put(svg, ...(isWall ? pieceWall(def, w, hh) : pieceTop(def, w, hh)));
  return svg;
}

/**
 * The room from above. `items` = [{ id, def (furniture def), x, z, rot, wall, at, fixed, sel }], `ghost` = { def, spot,
 * ok } | null, `grid` [w, d], `walls` { back, left }, `blocked` { back: [..] }, `clear` [[x, z, w, d]], `door` { x, w }.
 * `onCell(x, z)` / `onWall(wall, at)` / `onItem(id)` make it interactive (pointer and keyboard on the items).
 */
export function roomPlan({ items, ghost = null, grid, walls, blocked = {}, clear = [], door = null, onCell = null, onWall = null,
  onItem = null, onHover = null, label = t('home.art.room') }) {
  const [gw, gd] = grid;
  const T = 16;
  const vbw = gw * U + T + 4;
  const vbh = gd * U + T + 10;
  const svg = s('svg', { viewBox: `${-T - 2} ${-T - 2} ${vbw} ${vbh}`, class: 'ha-room', role: 'group', 'aria-label': label, focusable: 'false' });
  svg.style.setProperty('--ar', String(vbw / vbh));
  put(svg, s('defs', {},
    s('pattern', { id: 'ha-boards', width: 30, height: 5, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 30, height: 5, fill: '#D9A86C' }), s('path', { d: 'M0 5 h30 M18 0 v5', stroke: '#B98552', 'stroke-width': 0.5 })),
    s('pattern', { id: 'ha-paper', width: 8, height: 8, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 8, height: 8, fill: '#F2E1C4' }), s('path', { d: 'M4 1 l1 2 -1 2 -1 -2z', fill: '#E3C9A0' }))));
  // walls (paper) and the floor (boards)
  put(svg, s('rect', { x: -T, y: -T, width: gw * U + T, height: T, fill: 'url(#ha-paper)' }),
    s('rect', { x: -T, y: 0, width: T, height: gd * U, fill: 'url(#ha-paper)' }),
    s('rect', { x: -T, y: -T, width: T, height: T, fill: '#E3C9A0' }),
    s('rect', { x: 0, y: 0, width: gw * U, height: gd * U, fill: 'url(#ha-boards)' }),
    s('path', { d: `M0 0 H${gw * U} M0 0 V${gd * U}`, stroke: '#8A5224', 'stroke-width': 1.6 }),
    s('rect', { x: -T, y: -T, width: gw * U + T, height: gd * U + T, fill: 'none', stroke: INK, 'stroke-width': 1.6 }));
  // blocked wall slots (the chimney breast) and keep-clear floor
  for (const [side, list] of Object.entries(blocked)) {
    for (const i of list) put(svg, side === 'back' ? s('rect', { x: i * U, y: -T, width: U, height: T, fill: '#B8B1A3', stroke: INK, 'stroke-width': 0.6 })
      : s('rect', { x: -T, y: i * U, width: T, height: U, fill: '#B8B1A3', stroke: INK, 'stroke-width': 0.6 }));
  }
  for (const [x, z, w, d] of clear) put(svg, s('rect', { x: x * U + 1, y: z * U + 1, width: w * U - 2, height: d * U - 2, rx: 2, fill: 'none', stroke: 'rgba(62,38,18,.35)', 'stroke-width': 0.6, 'stroke-dasharray': '2 1.5' }));
  // the door: in the front wall ({ x, w }: a gap and its swing) or in a wall ({ wall, at, w }: a door on the wall strip
  // with its mat on the floor); the open sides of the room are drawn as a low skirting
  const dw = door ? (door.w ?? 1) * U : 0;
  if (door && door.wall) {
    const at = (door.at ?? 0) * U;
    if (door.wall === 'left') {
      put(svg, s('rect', { x: -T + 1, y: at + 1, width: T - 2, height: dw - 2, rx: 1, fill: '#8A5224', stroke: INK, 'stroke-width': 0.8 }),
        s('rect', { x: 1, y: at + 2, width: 6, height: dw - 4, rx: 1.5, fill: '#B5562E', opacity: 0.85 }));
    } else {
      put(svg, s('rect', { x: at + 1, y: -T + 1, width: dw - 2, height: T - 1, rx: 1, fill: '#8A5224', stroke: INK, 'stroke-width': 0.8 }),
        s('path', { d: `M${at + dw / 2} ${-T + 1.5} V-1`, stroke: '#5A3215', 'stroke-width': 0.6 }),
        s('circle', { cx: at + dw / 2 - 2.2, cy: -T / 2, r: 0.8, fill: '#F5C542' }), s('circle', { cx: at + dw / 2 + 2.2, cy: -T / 2, r: 0.8, fill: '#F5C542' }),
        s('rect', { x: at + 2, y: 1, width: dw - 4, height: 6, rx: 1.5, fill: '#B5562E', opacity: 0.85 }));
    }
    put(svg, s('path', { d: `M${-T} ${gd * U} H${gw * U} V0`, fill: 'none', stroke: '#8A5224', 'stroke-width': 2.4 }));
  } else if (door) {
    const dx = (door.x ?? 0) * U;
    put(svg, s('path', { d: `M${-T} ${gd * U} H${dx} M${dx + dw} ${gd * U} H${gw * U}`, stroke: '#8A5224', 'stroke-width': 4 }),
      s('path', { d: `M${dx} ${gd * U} a${dw} ${dw} 0 0 1 ${dw} -${dw}`, fill: 'none', stroke: '#8A5224', 'stroke-width': 0.6, 'stroke-dasharray': '1.5 1.5' }));
  } else {
    put(svg, s('path', { d: `M${-T} ${gd * U} H${gw * U}`, stroke: '#8A5224', 'stroke-width': 4 }));
  }
  // interactive cells (placing): every floor tile and every wall slot
  if (onCell) {
    const cells = s('g', { class: 'ha-cells' });
    for (let z = 0; z < gd; z++) for (let x = 0; x < gw; x++) {
      const r = s('rect', { x: x * U, y: z * U, width: U, height: U, class: 'ha-cell', 'data-x': String(x), 'data-z': String(z) });
      r.addEventListener('click', () => onCell(x, z));
      if (onHover) r.addEventListener('pointerenter', () => onHover({ x, z }));
      cells.append(r);
    }
    put(svg, cells);
  }
  if (onWall) {
    const ws = s('g', { class: 'ha-cells' });
    for (let i = 0; i < (walls.back ?? 0); i++) {
      const r = s('rect', { x: i * U, y: -T, width: U, height: T, class: 'ha-cell', 'data-wall': 'back', 'data-at': String(i) });
      r.addEventListener('click', () => onWall('back', i));
      if (onHover) r.addEventListener('pointerenter', () => onHover({ wall: 'back', at: i }));
      ws.append(r);
    }
    for (let i = 0; i < (walls.left ?? 0); i++) {
      const r = s('rect', { x: -T, y: i * U, width: T, height: U, class: 'ha-cell', 'data-wall': 'left', 'data-at': String(i) });
      r.addEventListener('click', () => onWall('left', i));
      if (onHover) r.addEventListener('pointerenter', () => onHover({ wall: 'left', at: i }));
      ws.append(r);
    }
    put(svg, ws);
  }
  // the pieces: rugs first, then objects, then the wall pieces
  const order = { floor: 0, object: 1, wall: 2 };
  const fits = (it) => (it.def.layer === 'wall' ? (it.wall === 'back' || it.wall === 'left') && Number.isFinite(it.at)
    : Number.isFinite(it.x) && Number.isFinite(it.z));
  const draw = (it, cls) => {
    const def = it.def;
    let g;
    if (def.layer === 'wall') {
      const n = def.size[0];
      if (it.wall === 'left') {
        g = s('g', { transform: `translate(${-T + 2} ${it.at * U + n * U}) rotate(-90)` }, ...pieceWall(def, n * U, T - 4));
      } else {
        g = s('g', { transform: `translate(${it.at * U} ${-T + 2})` }, ...pieceWall(def, n * U, T - 4));
      }
    } else {
      const rot = (it.rot ?? 0) % 4;
      const [w, d] = rot % 2 ? [def.size[1], def.size[0]] : def.size;
      const W = def.size[0] * U;
      const D = def.size[1] * U;
      const cx = it.x * U + (w * U) / 2;
      const cz = it.z * U + (d * U) / 2;
      g = s('g', { transform: `translate(${cx} ${cz}) rotate(${rot * 90}) translate(${-W / 2} ${-D / 2})` }, ...pieceTop(def, W, D));
    }
    const wrap = s('g', { class: `ha-piece ${cls}${it.sel ? ' sel' : ''}${it.fixed ? ' fixed' : ''}`, 'data-item': it.id ?? '' }, g);
    if (onItem && it.id && cls === '') {
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('aria-label', t(it.fixed ? 'home.art.roomOwn' : 'home.art.piece', { name: cname(def.id, { family: 'furniture' }) }));
      wrap.addEventListener('click', (e) => { e.stopPropagation(); onItem(it.id); });
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onItem(it.id); } });
    }
    return wrap;
  };
  for (const it of [...items].filter(fits).sort((a, b) => order[a.def.layer] - order[b.def.layer])) put(svg, draw(it, ''));
  // the ghost lives in its own layer: hovering redraws only it (a whole new plan under the pointer would eat the click)
  const ghostLayer = s('g', { class: 'ha-ghost-layer' });
  put(svg, ghostLayer);
  svg.setGhost = (gh) => {
    ghostLayer.replaceChildren();
    if (!gh || !gh.spot || !fits({ def: gh.def, ...gh.spot })) return;
    const gEl = draw({ def: gh.def, ...gh.spot }, `ghost ${gh.ok ? 'ok' : 'bad'}`);
    // the footprint, outlined green (it fits) or red (it does not), so the answer never rests on colour alone: a
    // dashed red outline with a cross for "not here"
    const def = gh.def;
    const sp = gh.spot;
    let fx; let fz; let fw; let fd;
    if (def.layer === 'wall') {
      const n = def.size[0] * U;
      if (sp.wall === 'left') { fx = -T; fz = sp.at * U; fw = T; fd = n; } else { fx = sp.at * U; fz = -T; fw = n; fd = T; }
    } else {
      const [w, d] = (sp.rot ?? 0) % 2 ? [def.size[1], def.size[0]] : def.size;
      fx = sp.x * U; fz = sp.z * U; fw = w * U; fd = d * U;
    }
    put(gEl, s('rect', { x: fx + 0.6, y: fz + 0.6, width: fw - 1.2, height: fd - 1.2, rx: 1.5, class: 'ha-foot',
      fill: gh.ok ? 'rgba(93,187,63,.18)' : 'rgba(232,85,74,.2)', stroke: gh.ok ? '#2A6A1C' : '#B83A30',
      'stroke-width': 1.2, 'stroke-dasharray': gh.ok ? null : '2.4 1.6' }),
    gh.ok ? null : s('path', { d: `M${fx + fw / 2 - 2.4} ${fz + fd / 2 - 2.4} l4.8 4.8 m0 -4.8 l-4.8 4.8`, stroke: '#B83A30', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
    put(ghostLayer, gEl);
  };
  svg.setGhost(ghost);
  return svg;
}
