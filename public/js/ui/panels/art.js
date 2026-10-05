// Inline SVG art of the content panels (ui-panels lane, visual-ux-juice.md §5.4: flat fills, one highlight, one
// shade, 2.5 ink outlines, light from the upper left). No external images: NPC portraits, letter-card scenes,
// ribbon rosettes, chests, the land map. Everything is built with createElementNS from data (content), never
// from strings that came from players.
import { CONTENT, isLive } from '../../../../shared/content/index.js';

const NS = 'http://www.w3.org/2000/svg';
let clipSeq = 0;
const INK = '#3E2612';

/** s('rect', { x: 1 }, ...children) -> SVGElement */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

function root(viewBox, { w, h, label, cls } = {}) {
  return s('svg', { viewBox, width: w, height: h, class: cls, role: label ? 'img' : null, 'aria-label': label || null,
    'aria-hidden': label ? null : 'true', focusable: 'false' });
}

// ---- the land map (Market › Land, Expansion card) -------------------------------------------------------------

const MAP = { x0: 8, z0: 8, size: 48 };

/**
 * The farm's 6 x 6 parcels as a little painted map. `cards` are model.landCards(); `onPick(id)` makes for-sale
 * parcels clickable. Owned land is lush, the next parcel shows a "For sale" sign, later ones are wild meadow.
 */
export function landMap(state, cards, { selected = null, onPick = null } = {}) {
  const svg = root(`${MAP.x0 - 2} ${MAP.z0 - 3} ${MAP.size + 4} ${MAP.size + 8}`, { label: 'Map of the farm and the land for sale', cls: 'pn-map' });
  const defs = s('defs', {},
    s('pattern', { id: 'pn-mow', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' },
      s('rect', { width: 4, height: 4, fill: '#7CC243' }), s('rect', { width: 2, height: 4, fill: '#86CB4B' })),
    s('pattern', { id: 'pn-wild', width: 3, height: 3, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 3, height: 3, fill: '#5E9E3B' }), s('circle', { cx: 0.8, cy: 0.9, r: 0.35, fill: '#6FB045' }),
      s('circle', { cx: 2.2, cy: 2.1, r: 0.3, fill: '#4F8F32' })),
    s('pattern', { id: 'pn-sale', width: 3, height: 3, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 3, height: 3, fill: '#8CCB55' }), s('circle', { cx: 1.5, cy: 1.5, r: 0.45, fill: '#FFE58A', opacity: 0.7 })));
  svg.append(defs);
  // forest along the top, river along the bottom (GDD §2.2)
  const forest = s('g', { class: 'pn-map-forest' });
  for (let x = MAP.x0 - 1; x < MAP.x0 + MAP.size + 1; x += 2.6) {
    forest.append(s('circle', { cx: x, cy: MAP.z0 - 1.2 + ((x * 7) % 3) * 0.25, r: 1.6, fill: '#2F6E3A', stroke: INK, 'stroke-width': 0.25 }));
  }
  svg.append(forest);
  svg.append(s('path', { d: `M${MAP.x0 - 2} ${MAP.z0 + MAP.size + 2.2} q6 -1.4 12 0 t12 0 t12 0 t12 0 t12 0 v4 h-60 z`,
    fill: '#6FD3E6', stroke: '#2E8FC9', 'stroke-width': 0.35 }));
  svg.append(s('path', { d: `M${MAP.x0} ${MAP.z0 + MAP.size + 3.4} q3 -0.6 6 0 M${MAP.x0 + 20} ${MAP.z0 + MAP.size + 3.6} q3 -0.6 6 0 M${MAP.x0 + 38} ${MAP.z0 + MAP.size + 3.3} q3 -0.6 6 0`,
    fill: 'none', stroke: '#fff', 'stroke-opacity': 0.7, 'stroke-width': 0.35, 'stroke-linecap': 'round' }));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const owned = new Set(state.farm.expansions);
  const layer = s('g', {});
  const labels = s('g', {});
  for (const e of CONTENT.expansions.values()) {
    const card = byId.get(e.id);
    const mine = owned.has(e.id);
    const forSale = card && card.isNext && !mine;
    const liveOne = isLive(e);
    for (const [x, z, w, d] of e.rects) {
      const fill = mine ? 'url(#pn-mow)' : forSale ? 'url(#pn-sale)' : 'url(#pn-wild)';
      const r = s('rect', { x: x + 0.15, y: z + 0.15, width: w - 0.3, height: d - 0.3, rx: 1.1, fill,
        stroke: forSale ? '#E39A1E' : mine ? '#3F8F2A' : 'rgba(62,38,18,.35)', 'stroke-width': forSale ? 0.55 : 0.3,
        'stroke-dasharray': forSale ? '1.2 0.7' : null, class: `pn-parcel${mine ? ' mine' : ''}${forSale ? ' sale' : ''}${selected === e.id ? ' sel' : ''}${liveOne ? '' : ' later'}`,
        'data-exp': e.id });
      if (!mine && !liveOne) r.setAttribute('opacity', '0.75');
      if (onPick && card && liveOne) {
        r.setAttribute('tabindex', '0');
        r.setAttribute('role', 'button');
        r.setAttribute('aria-label', `${e.name}${mine ? ', ours' : forSale ? ', for sale' : `, level ${e.unlock}`}`);
        r.addEventListener('click', () => onPick(e.id));
        r.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(e.id); } });
      }
      layer.append(r);
    }
    const [x, z, w, d] = e.rects[0];
    const cx = x + w / 2;
    const cz = z + d / 2;
    if (e.k === 0) {
      labels.append(farmhouse(x + 3, z + 4));
      const plots = s('g', {});
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        plots.append(s('rect', { x: x + 11 + i * 1.3, y: z + 5 + j * 1.3, width: 1.05, height: 1.05, rx: 0.2, fill: '#7A4A2A' }));
      }
      labels.append(plots, s('text', { x: cx, y: z + d - 1.6, class: 'pn-map-label home' }, 'Homestead'));
    } else if (forSale) {
      labels.append(signpost(cx, cz - 0.4), s('text', { x: cx, y: cz + 3.4, class: 'pn-map-label sale' }, short(card.price.coins)));
    } else if (mine) {
      const words = e.name.split(' ');
      const lines = w < 12 && words.length > 1 ? words : [e.name];
      lines.forEach((ln, i) => labels.append(s('text', { x: cx, y: cz + 0.8 + (i - (lines.length - 1) / 2) * 2.2, class: 'pn-map-label mine' }, ln)));
    } else if (liveOne) {
      labels.append(s('text', { x: cx, y: cz + 0.9, class: 'pn-map-label lvl' }, `Lv ${e.unlock}`));
    }
  }
  svg.append(layer, labels);
  return svg;
}

const short = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US'));

function farmhouse(x, z) {
  return s('g', { transform: `translate(${x} ${z})` },
    s('path', { d: 'M0 2.4 L2.2 0.4 L4.4 2.4 V5 H0 Z', fill: '#FFF8EC', stroke: INK, 'stroke-width': 0.3, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M-0.4 2.6 L2.2 0.1 L4.8 2.6', fill: 'none', stroke: '#C8473A', 'stroke-width': 0.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    s('rect', { x: 1.7, y: 3.2, width: 1, height: 1.8, fill: '#7A4B3A' }));
}

function signpost(x, z) {
  return s('g', { transform: `translate(${x - 1.6} ${z - 3.4})`, class: 'pn-map-sign' },
    s('rect', { x: 1.4, y: 1.6, width: 0.4, height: 3.4, fill: '#8A5224', stroke: INK, 'stroke-width': 0.2 }),
    s('rect', { x: 0, y: 0, width: 3.2, height: 2.2, rx: 0.3, fill: '#F7D9A0', stroke: INK, 'stroke-width': 0.25 }),
    s('text', { x: 1.6, y: 1.65, class: 'pn-map-dollar' }, '$'));
}

// ---- NPC portraits (content npcs[].portrait; GDD §5.3) --------------------------------------------------------

const ART_NPCS = new Set(['hazel', 'journal', 'mabel', 'ollie', 'fern', 'juniper', 'reed', 'pemberton',
  'pip', 'rosie', 'tom', 'lucia']);

/** A round painted portrait (public/assets/art/npc); the inline SVG is the fallback for a new NPC or a failed load. */
export function portrait(npc, size = 72) {
  if (!npc || !ART_NPCS.has(npc.id) || typeof document === 'undefined') return svgPortrait(npc, size);
  // tiny avatars use the tight face crop (128 px = 2x at 64), mid sizes the 128, big ones the 512
  const file = size <= 64 ? `${npc.id}_face` : size <= 128 ? `${npc.id}_128` : npc.id;
  const img = document.createElement('img');
  img.className = 'pn-portrait pn-portrait-img';
  img.src = `/assets/art/npc/${file}.webp`;
  img.width = size;
  img.height = size;
  img.alt = npc.name;
  img.decoding = 'async';
  img.draggable = false;
  img.addEventListener('error', () => img.replaceWith(svgPortrait(npc, size)), { once: true });
  return img;
}

/** The drawn SVG portrait; styles come from content PORTRAIT_STYLES (closed sets). */
export function svgPortrait(npc, size = 72) {
  const p = npc?.portrait ?? { skin: '#F2D3B8', hair: '#8C6A3E', hairStyle: 'short', outfit: '#7E9C6B', accent: '#E9B44C' };
  const svg = root('0 0 64 64', { w: size, h: size, label: npc ? npc.name : 'A neighbour', cls: 'pn-portrait' });
  svg.append(
    s('circle', { cx: 32, cy: 32, r: 30, fill: '#CFE8FF' }),
    s('path', { d: 'M2 40 q15 -6 30 -2 t30 2 v24 h-60 z', fill: '#BFE09A' }),
  );
  const back = s('g', {});
  const front = s('g', {});
  switch (p.hairStyle) {
    case 'bun': back.append(s('circle', { cx: 32, cy: 12, r: 7, fill: p.hair, stroke: INK, 'stroke-width': 2 })); break;
    case 'braid': back.append(s('path', { d: 'M44 26 q6 10 2 22', fill: 'none', stroke: p.hair, 'stroke-width': 6, 'stroke-linecap': 'round' })); break;
    case 'ponytail': back.append(s('path', { d: 'M44 20 q10 6 6 20', fill: 'none', stroke: p.hair, 'stroke-width': 6, 'stroke-linecap': 'round' })); break;
    case 'curls': for (const [cx, cy] of [[20, 20], [26, 14], [34, 13], [42, 17], [46, 25], [18, 28]]) back.append(s('circle', { cx, cy, r: 6, fill: p.hair, stroke: INK, 'stroke-width': 1.6 })); break;
    default: break;
  }
  // shoulders + outfit
  const body = s('path', { d: 'M12 64 q2 -16 20 -17 q18 1 20 17 z', fill: p.outfit, stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
  const collar = s('path', { d: 'M24 48 l8 7 l8 -7', fill: 'none', stroke: p.accent, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  // head
  const neck = s('rect', { x: 28, y: 38, width: 8, height: 9, fill: p.skin, stroke: INK, 'stroke-width': 1.8 });
  const head = s('ellipse', { cx: 32, cy: 29, rx: 12, ry: 13, fill: p.skin, stroke: INK, 'stroke-width': 2.2 });
  const cheekL = s('circle', { cx: 24.5, cy: 33, r: 2.3, fill: '#F28B82', opacity: 0.45 });
  const cheekR = s('circle', { cx: 39.5, cy: 33, r: 2.3, fill: '#F28B82', opacity: 0.45 });
  const eyes = s('g', {}, s('circle', { cx: 27.5, cy: 29, r: 1.6, fill: INK }), s('circle', { cx: 36.5, cy: 29, r: 1.6, fill: INK }),
    s('circle', { cx: 28, cy: 28.4, r: 0.5, fill: '#fff' }), s('circle', { cx: 37, cy: 28.4, r: 0.5, fill: '#fff' }));
  const smile = s('path', { d: 'M28 35 q4 3.5 8 0', fill: 'none', stroke: INK, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
  const hl = s('path', { d: 'M23 22 q3 -5 8 -6', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.5, 'stroke-width': 2, 'stroke-linecap': 'round' });
  // hair on top
  switch (p.hairStyle) {
    case 'beard':
      front.append(s('path', { d: 'M20 30 q2 14 12 15 q10 -1 12 -15 q-3 5 -12 5 q-9 0 -12 -5 z', fill: p.hair, stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
        s('path', { d: 'M20 25 q1 -11 12 -11 q11 0 12 11 q-6 -5 -12 -5 q-6 0 -12 5 z', fill: p.hair, stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
      break;
    case 'cap':
      front.append(s('path', { d: 'M19 24 q1 -10 13 -10 q12 0 13 10 z', fill: p.outfit, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
        s('path', { d: 'M17 24 h30', stroke: INK, 'stroke-width': 3, 'stroke-linecap': 'round' }),
        s('path', { d: 'M21 27 q-1 4 0 7 M43 27 q1 4 0 7', stroke: p.hair, 'stroke-width': 3, 'stroke-linecap': 'round' }));
      break;
    case 'book':
      front.append(s('path', { d: 'M20 25 q1 -12 12 -12 q11 0 12 12 q-6 -4 -12 -4 q-6 0 -12 4 z', fill: p.hair, stroke: INK, 'stroke-width': 1.8 }));
      break;
    default: {
      const cap = { short: 'M20 26 q0 -13 12 -13 q12 0 12 13 q-4 -6 -12 -6 q-8 0 -12 6 z',
        side_part: 'M20 27 q-1 -14 13 -14 q11 1 11 13 q-8 -7 -15 -5 q-5 1 -9 6 z',
        messy: 'M19 27 l2 -9 l3 3 l3 -6 l3 4 l4 -5 l2 5 l4 -2 l1 7 l2 4 q-10 -6 -24 0 z',
        bob: 'M19 33 q-2 -20 13 -20 q15 0 13 20 q-2 -9 -4 -11 q-9 3 -18 0 q-2 3 -4 11 z',
        bun: 'M20 26 q0 -12 12 -12 q12 0 12 12 q-5 -6 -12 -6 q-7 0 -12 6 z',
        curls: 'M20 26 q0 -12 12 -12 q12 0 12 12 q-5 -5 -12 -5 q-7 0 -12 5 z',
        braid: 'M20 27 q0 -13 12 -13 q12 0 12 13 q-5 -6 -12 -6 q-7 0 -12 6 z',
        ponytail: 'M20 26 q0 -12 12 -12 q12 0 12 12 q-5 -6 -12 -6 q-7 0 -12 6 z' }[p.hairStyle] ?? 'M20 26 q0 -12 12 -12 q12 0 12 12 q-5 -6 -12 -6 q-7 0 -12 6 z';
      front.append(s('path', { d: cap, fill: p.hair, stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));
    }
  }
  const acc = s('g', {});
  switch (p.accessory) {
    case 'glasses': acc.append(s('circle', { cx: 27.5, cy: 29, r: 3.4, fill: 'none', stroke: INK, 'stroke-width': 1.5 }),
      s('circle', { cx: 36.5, cy: 29, r: 3.4, fill: 'none', stroke: INK, 'stroke-width': 1.5 }), s('path', { d: 'M30.9 29 h2.2', stroke: INK, 'stroke-width': 1.5 })); break;
    case 'apron': acc.append(s('path', { d: 'M24 64 v-12 q8 3 16 0 v12 z', fill: p.accent, stroke: INK, 'stroke-width': 1.8 })); break;
    case 'flower': acc.append(s('circle', { cx: 42, cy: 18, r: 3.2, fill: p.accent, stroke: INK, 'stroke-width': 1.2 }), s('circle', { cx: 42, cy: 18, r: 1.1, fill: '#E8554A' })); break;
    case 'stethoscope': acc.append(s('path', { d: 'M25 48 q-2 8 4 10 M39 48 q2 8 -4 10', fill: 'none', stroke: '#444', 'stroke-width': 1.8 }), s('circle', { cx: 32, cy: 58, r: 2.3, fill: '#bbb', stroke: INK, 'stroke-width': 1.2 })); break;
    case 'pencil': acc.append(s('path', { d: 'M43 22 l6 -8', stroke: '#F2C14E', 'stroke-width': 2.6, 'stroke-linecap': 'round' })); break;
    case 'pipe': acc.append(s('path', { d: 'M36 37 q6 2 8 -1 v-3', fill: 'none', stroke: '#5A3215', 'stroke-width': 2.2, 'stroke-linecap': 'round' })); break;
    case 'rosettes': for (const [cx, col] of [[24, '#E8556E'], [32, '#4A7FE8'], [40, '#F5C542']]) acc.append(s('circle', { cx, cy: 55, r: 3, fill: col, stroke: INK, 'stroke-width': 1.2 })); break;
    case 'ribbon': acc.append(s('path', { d: 'M40 15 l5 -3 v6 z M40 15 l-5 -3 v6 z', fill: p.accent, stroke: INK, 'stroke-width': 1 })); break;
    case 'satchel': acc.append(s('path', { d: 'M20 50 l22 12', stroke: '#8A5224', 'stroke-width': 3 })); break;
    case 'hat': acc.append(s('ellipse', { cx: 32, cy: 17, rx: 15, ry: 3.4, fill: p.accent, stroke: INK, 'stroke-width': 1.8 }), s('path', { d: 'M24 17 q1 -9 8 -9 q7 0 8 9 z', fill: p.accent, stroke: INK, 'stroke-width': 1.8 })); break;
    case 'book': acc.append(s('rect', { x: 36, y: 50, width: 10, height: 12, rx: 1, fill: p.accent, stroke: INK, 'stroke-width': 1.5, transform: 'rotate(-12 41 56)' })); break;
    default: break;
  }
  const clipId = `pn-pc-${++clipSeq}`;
  svg.append(s('defs', {}, s('clipPath', { id: clipId }, s('circle', { cx: 32, cy: 32, r: 30 }))));
  svg.append(s('g', { 'clip-path': `url(#${clipId})` }, back, body, collar, neck, head, cheekL, cheekR, eyes, smile, hl, front, acc));
  svg.append(s('circle', { cx: 32, cy: 32, r: 30, fill: 'none', stroke: '#8A5224', 'stroke-width': 3 }));
  return svg;
}

// ---- rosettes (ribbons) -----------------------------------------------------------------------------------------

const TIER_COLORS = [
  { face: '#E3D7BE', ring: '#CDBB97', tail: '#C9B48C', ink: '#8A6440' },     // none yet
  { face: '#D9925A', ring: '#B8692F', tail: '#A85A28', ink: '#5A3215' },     // bronze
  { face: '#DCE3EA', ring: '#9FB0C0', tail: '#7F93A6', ink: '#3E4C5A' },     // silver
  { face: '#FFD45C', ring: '#E3A21E', tail: '#C8841A', ink: '#7A4E08' },     // gold
];

/** A prize rosette for a ribbon tier (0 none, 1 bronze, 2 silver, 3 gold); `mark` is a 1-2 char label. */
export function rosette(tier, size = 64, mark = '') {
  const c = TIER_COLORS[Math.max(0, Math.min(3, tier))];
  const svg = root('0 0 64 72', { w: size, h: Math.round(size * 72 / 64), cls: `pn-rosette t${tier}` });
  const petals = s('g', {});
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    petals.append(s('circle', { cx: 32 + Math.cos(a) * 18, cy: 28 + Math.sin(a) * 18, r: 7.5, fill: c.ring, stroke: INK, 'stroke-width': 1.6 }));
  }
  svg.append(
    s('path', { d: 'M22 40 l-8 28 l9 -5 l5 7 l6 -26 z', fill: c.tail, stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M42 40 l8 28 l-9 -5 l-5 7 l-6 -26 z', fill: c.tail, stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
    petals,
    s('circle', { cx: 32, cy: 28, r: 17, fill: c.face, stroke: INK, 'stroke-width': 2.2 }),
    s('circle', { cx: 32, cy: 28, r: 12.5, fill: 'none', stroke: c.ring, 'stroke-width': 2, 'stroke-dasharray': '2 2.2' }),
    s('path', { d: 'M22 21 q4 -6 11 -6', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.6, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
  );
  if (mark) svg.append(s('text', { x: 32, y: 33.5, 'text-anchor': 'middle', class: 'pn-rosette-mark', fill: c.ink }, mark));
  return svg;
}

// ---- chests (Mabel's meter, Daily chest) ---------------------------------------------------------------------

export function chest(size = 48, { open = false, gold = false } = {}) {
  const wood = gold ? '#F5C542' : '#D99A4A';
  const band = gold ? '#C8841A' : '#8A5224';
  const svg = root('0 0 48 48', { w: size, h: size, cls: `pn-chest${open ? ' open' : ''}` });
  // a closed chest has no lid glow: drop the null (Element.append(null) wrote the text "null" into the SVG; QA2 UI-06)
  svg.append(...[
    s('rect', { x: 7, y: 22, width: 34, height: 20, rx: 3, fill: wood, stroke: INK, 'stroke-width': 2.4 }),
    open
      ? s('path', { d: 'M7 22 l4 -12 h26 l4 12 z', fill: '#5A3215', stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round' })
      : s('path', { d: 'M7 22 q0 -12 17 -12 q17 0 17 12 z', fill: wood, stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
    open ? s('circle', { cx: 24, cy: 18, r: 5, fill: '#FFE58A', opacity: 0.9 }) : null,
    s('path', { d: 'M7 26 h34', stroke: band, 'stroke-width': 3 }),
    s('rect', { x: 21, y: 22, width: 6, height: 8, rx: 1.5, fill: '#FFC83D', stroke: INK, 'stroke-width': 1.8 }),
    s('path', { d: 'M11 13 q5 -3 12 -3', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.45, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
  ].filter(Boolean));
  return svg;
}


// ---- letter-card scenes (content LETTER_ART; GDD §5.3 "illustrated letter cards") ---------------------------------

/**
 * The subject of each scene: rendered icons (render-life's 3D icons, same look as the world) placed on a painted
 * backdrop. [iconId, x, y, size] in a 320 x 150 scene; `sky` picks the backdrop mood.
 */
const SCENES = {
  farmhouse: { icons: [['farmhouse', 110, 18, 112], ['flower_bed', 222, 92, 44], ['plot', 40, 96, 46]] },
  wheat: { icons: [['wheat', 92, 40, 80], ['wheat', 150, 30, 90], ['wheat', 214, 44, 76]] },
  market: { icons: [['market_stand', 104, 22, 104], ['wheat', 214, 82, 52], ['coins', 52, 90, 46]] },
  hens: { icons: [['coop', 54, 30, 96], ['chicken', 170, 66, 64], ['chicken', 226, 78, 54], ['egg', 146, 108, 30]] },
  order: { icons: [['order_board', 100, 24, 100], ['wheat', 210, 70, 56], ['coins', 52, 92, 44]] },
  windmill: { icons: [['mill', 114, 8, 116], ['wheat', 48, 82, 54], ['flour', 218, 86, 50]] },
  apple_tree: { sky: 'dawn', icons: [['apple_tree', 112, 12, 112], ['apple', 228, 100, 36], ['strawberry', 48, 96, 42]] },
  bread: { icons: [['bakery', 40, 26, 100], ['bread', 160, 64, 66], ['corn_bread', 226, 80, 52]] },
  woodpile: { icons: [['log', 44, 78, 64], ['sawmill', 120, 18, 104], ['planks', 228, 86, 50]] },
  cow: { icons: [['cow_barn', 44, 26, 100], ['cow', 160, 52, 86], ['milk', 252, 94, 40]] },
  supper: { sky: 'dusk', icons: [['kitchen', 40, 20, 100], ['veggie_soup', 160, 70, 58], ['omelette', 226, 82, 50]] },
  cake: { sky: 'dusk', icons: [['sweetheart_cake', 112, 22, 104], ['hearts', 56, 70, 40], ['hearts', 226, 56, 34]] },
  stall: { icons: [['market_stand', 70, 20, 104], ['order_board', 180, 44, 80]] },
  juice: { icons: [['juice_press', 50, 30, 92], ['apple_juice', 160, 62, 64], ['apple', 230, 88, 44]] },
  jam: { icons: [['preserves', 44, 24, 100], ['strawberry_jam', 162, 62, 62], ['strawberry', 230, 90, 40]] },
  baby: { icons: [['cow', 70, 46, 86], ['baby_bottle', 172, 66, 56], ['hearts', 236, 48, 36]] },
  compost: { icons: [['compost_bin', 64, 30, 90], ['compost', 168, 70, 56], ['plot', 224, 92, 50]] },
  sheep: { icons: [['pasture', 40, 28, 100], ['sheep', 160, 56, 78], ['wool', 246, 94, 40]] },
  cherry: { sky: 'dawn', icons: [['cherry_tree', 104, 10, 116], ['cherry', 46, 98, 40], ['cherry_jam', 232, 92, 44]] },
  fence: { icons: [['picket_fence', 40, 84, 50], ['picket_fence', 86, 84, 50], ['pine', 150, 18, 96], ['plot', 240, 96, 44]] },
  barn: { icons: [['barn', 104, 14, 112], ['wooden_crate', 230, 92, 44], ['planks', 46, 96, 42]] },
  crate: { icons: [['sawmill', 44, 24, 96], ['wooden_crate', 160, 64, 60], ['bird_house', 232, 84, 48]] },
  bench: { sky: 'dusk', icons: [['sunset_bench', 112, 52, 96], ['hearts', 150, 18, 40]] },
  hearts: { sky: 'dusk', icons: [['hearts', 120, 30, 80], ['flower_bed', 52, 96, 44], ['flower_bed', 226, 96, 44]] },
};

const SKIES = {
  day: ['#8FD3FF', '#D6F1FF', '#FFF1D6'],
  dawn: ['#FFC9A8', '#FFE7CC', '#FFF6E0'],
  dusk: ['#F7A26B', '#FFC88A', '#FFE9C4'],
};

/** A painted vignette for a letter: sky, sun, two hills, a meadow, and the scene's icons standing on it. */
export function letterScene(artId, iconUrlOf, { w = 320, h = 150 } = {}) {
  const sc = SCENES[artId] ?? { icons: [['farmhouse', 110, 18, 112]] };
  const sky = SKIES[sc.sky ?? 'day'];
  const id = `pn-sky-${++clipSeq}`;
  const svg = root(`0 0 ${w} ${h}`, { cls: 'pn-scene' });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.append(
    s('defs', {}, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': sky[0] }), s('stop', { offset: '.6', 'stop-color': sky[1] }), s('stop', { offset: '1', 'stop-color': sky[2] }))),
    s('rect', { width: w, height: h, fill: `url(#${id})` }),
    s('circle', { cx: w * 0.84, cy: 28, r: 16, fill: '#FFE58A', opacity: 0.9 }),
    s('circle', { cx: w * 0.84, cy: 28, r: 24, fill: '#FFE58A', opacity: 0.25 }),
    s('path', { d: `M0 ${h * 0.62} Q ${w * 0.25} ${h * 0.4} ${w * 0.55} ${h * 0.6} T ${w} ${h * 0.55} V ${h} H 0 Z`, fill: '#9BD86A' }),
    s('path', { d: `M0 ${h * 0.74} Q ${w * 0.4} ${h * 0.58} ${w * 0.7} ${h * 0.72} T ${w} ${h * 0.7} V ${h} H 0 Z`, fill: '#7CC243' }),
    s('path', { d: `M0 ${h * 0.86} Q ${w * 0.5} ${h * 0.8} ${w} ${h * 0.88} V ${h} H 0 Z`, fill: '#66B23A' }),
  );
  // a few cloud puffs and meadow flowers
  for (const [cx, cy, r] of [[w * 0.18, 26, 10], [w * 0.24, 22, 13], [w * 0.31, 27, 9], [w * 0.58, 40, 7], [w * 0.63, 37, 9]]) {
    svg.append(s('circle', { cx, cy, r, fill: '#fff', opacity: 0.85 }));
  }
  for (let i = 0; i < 9; i++) {
    svg.append(s('circle', { cx: 14 + i * (w / 9) + ((i * 37) % 13), cy: h * 0.9 + ((i * 11) % 7), r: 2.2, fill: ['#FFE58A', '#FF9BB0', '#FFFFFF'][i % 3] }));
  }
  for (const [ic, x, y, size] of sc.icons) {
    svg.append(s('ellipse', { cx: x + size / 2, cy: y + size * 0.93, rx: size * 0.34, ry: size * 0.07, fill: 'rgba(42,106,28,.35)' }));
    const img = s('image', { x, y, width: size, height: size, preserveAspectRatio: 'xMidYMid meet' });
    img.setAttribute('href', iconUrlOf(ic, size > 64 ? 128 : 64));
    svg.append(img);
  }
  return svg;
}
