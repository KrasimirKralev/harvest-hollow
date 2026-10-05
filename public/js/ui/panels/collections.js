// The Collections album (GDD §5.5, ui-collect lane) and the lane's install hub.
//
// Album: 12 sets x 5 items (8 sets live in M1b). Every eligible action rolls for a missing item of its set; after
// COLLECTION_RULES.pity eligible actions without a new item the next one is certain (the "lucky find" bar);
// duplicates trade 3 -> 1 missing item of the same set; a completed set pays 5 Acorns, a display piece (decor) and a
// small permanent perk. The album records who found each item. Each item is a hand-drawn sticker (album art below),
// so the book reads as one illustrated keepsake.
//
//   albumView(state, pid) -> plain data (tested in node)     albumPanel: the 'collections' panel spec (full)
//   stickerArt(setId, itemId, size)                          the SVG sticker of one album item
//   default export install(ui, deps) -> uninstall            registers every ui-collect panel ('collections',
//        'restoration', 'beauty', 'decorsets', 'ribbonwall'), links panels-collect.css, mounts the Farm Beauty
//        meter, the M1b animal sections hook and the event banners (finds, giants, new systems). Idempotent.
//
// Rules (rules-goals, shared/rules/actions/album.js): farm.album.sets[setId] = { r, pity, items: { [itemId]: { by, at,
// n } }, done }; liveSets / missingOf / dupesOf / albumUnlocked; action albumTrade { set, want }; celebrations
// albumFind { set, item, dup, how, by } and albumSet { set, perk, by }.
import { COLLECTION_RULES, decorOf, collectionOf } from '../../../../shared/content/index.js';
import * as albumA from '../../../../shared/rules/actions/album.js';
import { startPlacement } from './placement.js';
import { h, fmt, createKit, bar, icon, svgIcon, playerMark } from './kit.js';
import { s } from './art.js';
import { ensureStylesheet } from '../dom.js';
import { ribbonWallPanel } from './ribbon-wall.js';
import { restorationPanel, restorationBanners } from './restoration.js';
import { beautyPanel, mountBeautyMeter, beautyBanners } from './beauty.js';
import { decorSetsPanel } from './decor-sets.js';
import { giantBanners, unlockBanners } from './animals-m1b.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** How each set's items turn up, in the album's words (GDD §5.5 "Found by"), and the noun its lucky bar counts. */
export const FOUND_BY = Object.freeze({
  recipe_cards: ['crafting any recipe', 'crafts'],
  butterflies: ['harvesting flowers and flowering trees', 'harvests'],
  lost_tools: ['clearing debris and chopping', 'clears'],
  feathers: ['collecting from chickens and ducks', 'collections'],
  heirloom_seeds: ['harvesting crops of 4 hours or more', 'harvests'],
  pond_treasures: ['duck pond collects and the Fishing Dock', 'tries'],
  fossils: ['rocks, boulders and truffle digs', 'digs'],
  honey_jars: ['collecting honey from your hives', 'honey collects'],
  buttons: ["crafts at the Weaver's Shed and the Sewing Table", 'crafts'],
  fair_rosettes: ['entries at the County Fair', 'entries'],
  old_coins: ['selling at the Market Stand (a roll per 100 coins)', 'rolls'],
  love_notes: ['things you do together', 'tries'],
});

/** The rules' record of a set (farm.album.sets[id] = { r, pity, items: { [itemId]: { by, at, n } }, done }), or empty. */
export function setState(state, setId) {
  const r = own(state?.farm?.album?.sets, setId) ?? {};
  return { items: r.items ?? {}, pity: r.pity ?? 0, done: r.done ?? null };
}

/**
 * Every set that plays in this build (the rules' liveSets(): content milestone, or a test's forceLiveForTests) with
 * its stickers, finders, spares, lucky-find bar and reward. Pure.
 */
export function albumView(state, pid) {
  const R = COLLECTION_RULES;
  const sets = albumA.liveSets().map((c) => {
    const st = setState(state, c.id);
    const items = c.items.map((it) => {
      const g = own(st.items, it.id);
      return { id: it.id, name: it.name, found: Boolean(g), by: g?.by ?? null, at: g?.at ?? null,
        dup: g ? Math.max(0, (g.n ?? 1) - 1) : 0 };
    });
    const missing = albumA.missingOf(state, c);
    const spares = albumA.dupesOf(state, c);
    const found = items.length - missing.length;
    const done = st.done !== null;
    const [how, noun] = FOUND_BY[c.id] ?? ['playing', 'tries'];
    return {
      id: c.id, name: c.name, how, noun, items, found, total: items.length, missing, spares,
      canTrade: spares >= R.tradeIn && missing.length > 0, pity: st.pity, pityMax: R.pity,
      // the rules: once `pity` rolls in a row found nothing new, the NEXT roll is certain (the 41st after a find)
      pityLeft: Math.max(1, R.pity - st.pity + 1), done, doneAt: st.done, perkText: c.perkText,
      display: c.display, displayName: decorOf(c.display)?.name ?? 'A display piece', acorns: R.acorns,
      mine: items.filter((i) => i.by === pid).length,
    };
  });
  return {
    open: albumA.albumUnlocked(state), unlock: R.unlock, sets, found: sets.reduce((n, x) => n + x.found, 0),
    total: sets.reduce((n, x) => n + x.total, 0), setsDone: sets.filter((x) => x.done).length, tradeIn: R.tradeIn,
    dropPct: R.dropBp / 100,
  };
}

// ---- sticker art ----------------------------------------------------------------------------------------------------

const INK = '#3E2612';
const svgRoot = (size, cls = '') => s('svg',
  { viewBox: '0 0 64 64', width: size, height: size, class: `pc-art ${cls}`.trim(),
  'aria-hidden': 'true', focusable: 'false' });
const P = (d, fill, extra = {}) => s('path',
  { d, fill, stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra });
const C = (cx, cy, r, fill, extra = {}) => s('circle', { cx, cy, r, fill, stroke: INK, 'stroke-width': 2, ...extra });
const shine = (d) => s('path',
  { d, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.65, 'stroke-width': 2.2, 'stroke-linecap': 'round' });

function butterfly(svg, wing, hind, mark) {
  svg.append(
    P('M31 30 C22 12 6 10 8 22 C9 30 18 33 30 33 Z', wing), P('M33 30 C42 12 58 10 56 22 C55 30 46 33 34 33 Z', wing),
    P('M30 34 C18 34 12 44 18 50 C24 54 29 44 31 36 Z', hind),
      P('M34 34 C46 34 52 44 46 50 C40 54 35 44 33 36 Z', hind),
    s('rect', { x: 30, y: 24, width: 4, height: 26, rx: 2, fill: '#3E2612' }),
    s('path', { d: 'M31 24 q-4 -9 -9 -11 M33 24 q4 -9 9 -11', fill: 'none', stroke: INK, 'stroke-width': 1.8,
      'stroke-linecap': 'round' }));
  if (mark) mark(svg);
}

function feather(svg, vane, rachis, mark) {
  svg.append(P('M32 6 C48 16 48 40 34 54 L30 54 C16 40 16 16 32 6 Z', vane),
    s('path', { d: 'M32 8 V60', stroke: rachis, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
    s('path', { d: 'M32 20 l-8 -4 M32 28 l-10 -4 M32 36 l-10 -4 M32 20 l8 -4 M32 28 l10 -4 M32 36 l10 -4',
      stroke: 'rgba(62,38,18,.35)', 'stroke-width': 1.4, 'stroke-linecap': 'round', fill: 'none' }));
  if (mark) mark(svg);
}

function jar(svg, honey, label, lid = '#B87533') {
  svg.append(P('M18 22 h28 v28 q0 8 -8 8 h-12 q-8 0 -8 -8 z', honey),
    P('M20 12 h24 v10 h-24 z', lid), s('path', { d: 'M20 16 h24', stroke: 'rgba(62,38,18,.35)', 'stroke-width': 1.6 }),
    P('M21 32 h22 v12 h-22 z', label),
      s('path', { d: 'M25 38 h14', stroke: INK, 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
    shine('M23 26 v4'));
}

function tin(svg, band, emblem) {
  svg.append(P('M16 16 h32 v36 q0 4 -4 4 h-24 q-4 0 -4 -4 z', '#C9D3DD'),
    s('ellipse', { cx: 32, cy: 16, rx: 16, ry: 4, fill: '#E6ECF1', stroke: INK, 'stroke-width': 2 }),
    P('M16 26 h32 v18 h-32 z', band), C(32, 35, 6.5, emblem, { 'stroke-width': 1.8 }), shine('M20 22 v24'));
}

function button(svg, face, rim, holes = 4) {
  svg.append(C(32, 32, 20, rim, { 'stroke-width': 2.4 }), C(32, 32, 14, face, { 'stroke-width': 1.6 }));
  const pts = holes === 4 ? [[28, 28], [36, 28], [28, 36], [36, 36]] : [[28, 32], [36, 32]];
  for (const [x, y] of pts) svg.append(s('circle', { cx: x, cy: y, r: 2.3, fill: INK }));
  svg.append(shine('M18 26 q4 -8 12 -10'));
}

/** Drawings by item id: [draw(svg)]; plain shapes, two or three colours, an ink outline and one highlight. */
const ART = {
  // Grandma's Recipe Cards: a lined card with a small dish drawn on it
  recipe_bread: (g) => card(g,
    (svg) => svg.append(P('M20 40 q0 -12 12 -12 q12 0 12 12 z', '#E3A35C'),
      s('path', { d: 'M26 34 l3 -3 M32 33 l3 -3 M38 34 l2 -2', stroke: INK, 'stroke-width': 1.4 }))),
  recipe_jam: (g) => card(g,
    (svg) => svg.append(P('M25 30 h14 v12 q0 3 -3 3 h-8 q-3 0 -3 -3 z', '#D93A4A'),
      P('M24 26 h16 v4 h-16 z', '#F2E3C4'))),
  recipe_pie: (g) => card(g,
    (svg) => svg.append(P('M18 38 q14 -14 28 0 z', '#E0A050'), P('M17 38 h30 l-3 5 h-24 z', '#C27A35'),
      s('path', { d: 'M24 34 l4 -2 M32 31 v2 M36 33 l4 2', stroke: INK, 'stroke-width': 1.3 }))),
  recipe_soup: (g) => card(g,
    (svg) => svg.append(P('M18 34 h28 q0 10 -14 10 q-14 0 -14 -10 z', '#F08A3C'),
      s('path', { d: 'M26 30 q2 -4 0 -6 M32 30 q2 -4 0 -6 M38 30 q2 -4 0 -6', fill: 'none', stroke: INK,
        'stroke-width': 1.3 }))),
  recipe_cake: (g) => card(g,
    (svg) => svg.append(P('M20 34 h24 v10 h-24 z', '#F7C6D0'), P('M22 28 h20 v6 h-20 z', '#FFF1F4'),
      C(32, 25, 2.6, '#E8394A', { 'stroke-width': 1.4 }))),
  // Garden Butterflies
  cabbage_white: (svg) => butterfly(svg, '#FBFAF4', '#F1EEDF',
    (g) => g.append(s('path',
      { d: 'M10 18 q3 -5 8 -5 M54 18 q-3 -5 -8 -5', stroke: INK, 'stroke-width': 3, 'stroke-linecap': 'round',
        fill: 'none' }), C(20, 24, 2, '#3E2612', { 'stroke-width': 0 }),
          C(44, 24, 2, '#3E2612', { 'stroke-width': 0 }))),
  peacock_butterfly: (svg) => butterfly(svg, '#B8402F', '#8E3226',
    (g) => g.append(C(15, 19, 4.5, '#3F7FD0', { 'stroke-width': 1.4 }),
      C(49, 19, 4.5, '#3F7FD0', { 'stroke-width': 1.4 }), C(15, 19, 1.8, '#FFD45C', { 'stroke-width': 0 }),
        C(49, 19, 1.8, '#FFD45C', { 'stroke-width': 0 }))),
  swallowtail: (svg) => butterfly(svg, '#FFE07A', '#FFE07A',
    (g) => g.append(s('path',
      { d: 'M14 15 l6 14 M22 13 l4 16 M50 15 l-6 14 M42 13 l-4 16', stroke: INK, 'stroke-width': 2.2 }),
        P('M20 50 l-3 9 l4 -3', '#3E2612'), P('M44 50 l3 9 l-4 -3', '#3E2612'))),
  blue_morpho: (svg) => butterfly(svg, '#2E8BE6', '#1F6FC2',
    (g) => g.append(s('path',
      { d: 'M10 20 q2 -8 10 -8 M54 20 q-2 -8 -10 -8', stroke: '#1B2A44', 'stroke-width': 3.2, fill: 'none',
        'stroke-linecap': 'round' }), shine('M16 20 q4 -4 10 -3'))),
  monarch: (svg) => butterfly(svg, '#F28A1E', '#E2741A',
    (g) => g.append(s('path',
      { d: 'M12 20 l8 8 M20 15 l6 12 M52 20 l-8 8 M44 15 l-6 12', stroke: INK, 'stroke-width': 1.8 }),
        ...[[10, 22], [13, 14], [54, 22], [51, 14]].map(([x, y]) => C(x, y, 1.6, '#fff', { 'stroke-width': 0.8 })))),
  // Lost Tools
  rusty_trowel: (svg) => svg.append(P('M30 30 l14 -18 q6 2 6 8 l-16 14 z', '#B86A3C'),
    P('M30 30 l-4 4 l-10 16 q-2 4 2 4 l4 -2 l12 -14 l0 -4 z', '#7A4A26'),
      C(44, 18, 1.6, '#8A5224', { 'stroke-width': 0 }), shine('M38 18 l6 -6')),
  old_pitchfork: (svg) => svg.append(P('M30 30 h4 v28 h-4 z', '#A86E3C'),
    P('M20 10 v14 q0 6 6 6 h12 q6 0 6 -6 v-14 l-3 0 v14 q0 3 -3 3 h-4 v-17 h-3 v17 h-4 q-3 0 -3 -3 v-14 z', '#8C979F')),
  brass_oil_can: (svg) => svg.append(P('M16 30 h22 v20 q0 4 -4 4 h-14 q-4 0 -4 -4 z', '#E0A92E'),
    P('M38 34 l16 -16 l3 3 l-15 17 z', '#C8841A'), P('M22 22 h10 l3 8 h-16 z', '#C8841A'), shine('M20 34 v12')),
  nail_tin: (svg) => { svg.append(P('M12 26 h40 v22 q0 4 -4 4 h-32 q-4 0 -4 -4 z', '#7D8F97'),
    P('M10 20 h44 v8 h-44 z', '#93A5AD'),
      P('M22 36 q10 -10 20 0 v4 q-10 -8 -20 0 z', '#E8E1D0', { 'stroke-width': 1.6 })); },
  pocket_knife: (svg) => svg.append(P('M10 38 q0 -6 6 -6 h28 q6 0 6 6 q0 6 -6 6 h-28 q-6 0 -6 -6 z', '#8A4B2A'),
    P('M44 33 l14 -10 l2 4 l-12 10 z', '#C9D3DD'), C(16, 38, 2, '#E3D7BE', { 'stroke-width': 1.2 }),
      C(40, 38, 2, '#E3D7BE', { 'stroke-width': 1.2 }), shine('M18 35 h18')),
  // Feathers
  speckled_feather: (svg) => feather(svg, '#B07A4A', '#5A3215',
    (g) => g.append(...[[26, 22], [38, 26], [27, 34], [37, 38],
      [31, 44]].map(([x, y]) => C(x, y, 1.8, '#FFF4D6', { 'stroke-width': 0 })))),
  barred_feather: (svg) => feather(svg, '#E8E4DA', '#5C5852',
    (g) => g.append(s('path',
      { d: 'M22 18 h20 M20 26 h24 M20 34 h24 M22 42 h20 M26 50 h12', stroke: '#4A4844', 'stroke-width': 2.4,
        'stroke-linecap': 'round' }))),
  copper_feather: (svg) => feather(svg, '#C8643A', '#6E2E14', (g) => g.append(shine('M26 18 q-4 10 -2 22'))),
  golden_feather_piece: (svg) => feather(svg, '#FFD45C', '#A86A10',
    (g) => g.append(shine('M26 16 q-4 10 -2 24'), C(46, 12, 1.8, '#fff', { 'stroke-width': 0 }),
      C(14, 30, 1.4, '#fff', { 'stroke-width': 0 }))),
  peacock_feather: (svg) => feather(svg, '#3FA36B', '#2A5A3A',
    (g) => g.append(s('ellipse', { cx: 32, cy: 22, rx: 8, ry: 9, fill: '#1F6FC2', stroke: INK, 'stroke-width': 1.6 }),
      s('ellipse', { cx: 32, cy: 22, rx: 4, ry: 5, fill: '#5A2E8A' }),
        C(32, 21, 1.6, '#FFD45C', { 'stroke-width': 0 }))),
  // Heirloom Seeds (seed tins)
  purple_carrot_tin: (svg) => tin(svg, '#8E4BB8', '#C57BE8'),
  moon_melon_tin: (svg) => tin(svg, '#2E6E4A', '#E8E07A'),
  blue_corn_tin: (svg) => tin(svg, '#2B5EA8', '#7FB0F0'),
  black_tomato_tin: (svg) => tin(svg, '#5A2A2A', '#2A1A1A'),
  striped_beet_tin: (svg) => { tin(svg, '#C2345A',
    '#F5D0DA'); svg.append(s('path', { d: 'M28 33 h8 M28 37 h8', stroke: '#C2345A', 'stroke-width': 1.6 })); },
  // Fossils & Arrowheads
  ammonite: (svg) => svg.append(C(32, 32, 20, '#C9B48C', { 'stroke-width': 2.4 }),
    s('path', { d: 'M32 32 m0 -3 a3 3 0 1 1 -3 3 a7 7 0 1 1 7 7 a11 11 0 1 1 -11 -11 a15 15 0 1 1 15 15', fill: 'none',
      stroke: INK, 'stroke-width': 2 }), shine('M18 22 q4 -6 10 -7')),
  trilobite: (svg) => { svg.append(P('M32 8 q16 4 16 22 q0 18 -16 26 q-16 -8 -16 -26 q0 -18 16 -22 z',
    '#A99B86')); for (let y = 24; y <= 48; y += 6) svg.append(s('path',
      { d: `M${20 + (y - 24) / 3} ${y} h${24 - (y - 24) / 1.5}`, stroke: INK,
        'stroke-width': 1.6 })); svg.append(s('path', { d: 'M32 14 v40', stroke: INK, 'stroke-width': 1.6 })); },
  arrowhead: (svg) => svg.append(P('M32 6 l14 34 l-8 -4 l-6 22 l-6 -22 l-8 4 z', '#6F7E86'),
    s('path', { d: 'M32 12 l-6 16 M32 12 l6 16 M28 32 l8 0', stroke: 'rgba(255,255,255,.5)', 'stroke-width': 1.6 })),
  shark_tooth: (svg) => svg.append(P('M14 50 q6 -26 18 -42 q12 16 18 42 q-18 -6 -36 0 z', '#F2EADB'),
    P('M14 50 q18 -6 36 0 q-2 8 -18 8 q-16 0 -18 -8 z', '#7A6A58'), shine('M26 22 q-4 10 -6 20')),
  fern_fossil: (svg) => { svg.append(P('M10 16 q22 -12 44 0 l2 34 q-24 12 -48 0 z', '#B5AA98')); svg.append(s('path',
    { d: 'M20 46 q12 -12 24 -28', fill: 'none', stroke: '#6E6252',
      'stroke-width': 2 })); for (let i = 0; i < 6; i++) { const x = 22 + i * 4; const y = 44 - i * 4.5; svg.append(s('path', { d: `M${x} ${y} l-5 -3 M${x} ${y} l3 5`, stroke: '#6E6252', 'stroke-width': 1.6, 'stroke-linecap': 'round' })); } },
  // Honey Jars
  clover_jar: (svg) => jar(svg, '#F6CF57', '#FFFFFF'),
  blossom_jar: (svg) => jar(svg, '#F2B84B', '#F7C6D0'),
  lavender_jar: (svg) => jar(svg, '#EDB94A', '#C9A8E8'),
  sunflower_jar: (svg) => jar(svg, '#F0A21E', '#FFE07A'),
  heather_jar: (svg) => jar(svg, '#C9741C', '#B88AD0', '#7A4A26'),
  // Buttons & Thimbles
  wooden_button: (svg) => button(svg, '#C98A4B', '#A86E3C'),
  brass_button: (svg) => button(svg, '#F5C542', '#C8841A', 2),
  thimble: (svg) => { svg.append(P('M18 52 v-24 q0 -16 14 -16 q14 0 14 16 v24 z', '#C9D3DD'),
    P('M15 50 h34 v6 h-34 z', '#9FB0C0')); for (const [x, y] of [[26, 24], [32, 22], [38, 24], [24, 32], [30, 31],
      [36, 31], [42, 33], [26, 40], [32, 39], [38, 40]]) svg.append(s('circle',
        { cx: x, cy: y, r: 1.3, fill: '#6E7F90' })); svg.append(shine('M22 28 q0 -8 6 -12')); },
  pincushion: (svg) => svg.append(P('M12 40 q0 -18 20 -18 q20 0 20 18 q0 10 -20 10 q-20 0 -20 -10 z', '#E8394A'),
    s('path', { d: 'M32 22 v28 M20 26 q4 12 4 22 M44 26 q-4 12 -4 22', fill: 'none', stroke: 'rgba(62,38,18,.4)',
      'stroke-width': 1.6 }), P('M28 22 q4 -8 8 0', '#5DBB3F'),
        s('path', { d: 'M22 30 l-6 -12 M40 30 l8 -12 M34 28 l2 -14', stroke: '#8C979F', 'stroke-width': 2 }),
          C(16, 17, 2.4, '#FFC83D', { 'stroke-width': 1.2 }), C(48, 17, 2.4, '#4AA8E8', { 'stroke-width': 1.2 }),
            C(36, 13, 2.4, '#5DBB3F', { 'stroke-width': 1.2 })),
  silver_needle: (svg) => svg.append(s('path',
    { d: 'M14 52 L48 12', stroke: INK, 'stroke-width': 5, 'stroke-linecap': 'round' }),
      s('path', { d: 'M14 52 L48 12', stroke: '#DCE3EA', 'stroke-width': 2.6, 'stroke-linecap': 'round' }),
        s('ellipse', { cx: 45, cy: 15.5, rx: 1.4, ry: 3, transform: 'rotate(40 45 15.5)', fill: INK }),
          s('path', { d: 'M45 16 q14 6 6 18 q-8 12 4 20', fill: 'none', stroke: '#E8394A', 'stroke-width': 2.4,
            'stroke-linecap': 'round' })),
};

/** A recipe card: cream paper with a red rule and a little drawing. */
function card(svg, draw) {
  svg.append(P('M10 12 h44 v42 h-44 z', '#FFF8E6'),
    s('path', { d: 'M10 20 h44', stroke: '#E8556E', 'stroke-width': 2 }),
    s('path', { d: 'M16 48 h32 M16 52 h22', stroke: 'rgba(62,38,18,.3)', 'stroke-width': 1.4 }));
  draw(svg);
}

/** One album item as a sticker (a generic keepsake medallion for an item without a drawing). */
export function stickerArt(setId, itemId, size = 64) {
  const svg = svgRoot(size, `pc-sticker-art pc-set-${setId}`);
  const draw = ART[itemId];
  if (draw) draw(svg);
  else svg.append(C(32, 32, 22, '#F5C542', { 'stroke-width': 2.4 }), C(32, 32, 15, '#FFE58A', { 'stroke-width': 1.6 }),
    shine('M18 24 q4 -8 12 -9'));
  return svg;
}

// ---- the panel ------------------------------------------------------------------------------------------------------

/** A four-leaf clover (the lucky-find bar). */
function clover(size = 18) {
  const svg = s('svg',
    { viewBox: '0 0 24 24', width: size, height: size, class: 'pc-clover', 'aria-hidden': 'true', focusable: 'false' });
  for (const [x, y] of [[12, 7], [17, 12], [12, 17], [7, 12]]) svg.append(s('circle',
    { cx: x, cy: y, r: 4.6, fill: '#5DBB3F', stroke: INK, 'stroke-width': 1.4 }));
  svg.append(s('path',
    { d: 'M12 12 q2 6 6 9', fill: 'none', stroke: INK, 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      s('circle', { cx: 12, cy: 12, r: 1.6, fill: '#9BE06A' }));
  return svg;
}

const FRESH_MS = 2 * 3_600_000;           // "New" on a sticker for two hours after its find

function sticker(ctx, set, it) {
  const st = ctx.store.state;
  const p = it.by ? st.players[it.by] : null;
  const label = it.found ? `${it.name}: found${p ? ` by ${p.name}` : ''}${it.dup ? `, ${it.dup} spare${it.dup === 1 ? '' : 's'}` : ''}` : `${it.name}: not found yet`;
  const fresh = it.found && it.at && ctx.now() - it.at < FRESH_MS;
  return h(`figure.pc-sticker${it.found ? '.found' : '.missing'}${fresh ? '.fresh' : ''}`,
    { role: 'img', 'aria-label': label, title: label, dataset: { item: it.id } },
    h('span.pc-sticker-face', stickerArt(set.id, it.id, 60),
      it.found ? null : h('span.pc-sticker-q', { 'aria-hidden': 'true' }, '?')),
    h('figcaption', h('b', it.name),
      it.found ? h('small.pc-finder', p ? [playerMark(it.by, p, { size: 16 }), ` ${p.name}`] : 'Found')
        : h('small', 'Not yet')),
    fresh ? h('span.pc-new', 'New') : null,
    it.dup ? h('span.pc-dup', { title: `${it.dup} spare${it.dup === 1 ? '' : 's'}` }, `+${it.dup}`) : null);
}

/** Spares and the 3 -> 1 trade: a chooser of the missing items, each gated by the rules' own check. */
function tradeRow(ctx, kit, set, open, toggle) {
  const R = COLLECTION_RULES;
  const choose = open && set.canTrade ? h('div.pc-trade-pick',
    h('span.pc-trade-q', `${R.tradeIn} spares for which one?`),
    ...set.missing.map((id) => {
      const it = set.items.find((x) => x.id === id);
      return h('span.pc-trade-opt', stickerArt(set.id, id, 34),
        kit.button({ label: it.name, cls: 'pn-xs btn--sky', type: 'albumTrade', args: { set: set.id, want: id },
          data: { trade: `${set.id}:${id}` },
          after: (r) => { if (r && r.ok !== false) toggle(false); } }));
    })) : null;
  return h('div.pc-trade',
    h('span.pc-spares',
      { title: `A spare is a second find of an item: ${R.tradeIn} spares trade for one you are missing` },
      h('b', fmt(set.spares)), set.spares === 1 ? ' spare' : ' spares'),
    set.canTrade
      ? h('button.pn-chipbtn.pc-trade-btn',
        { type: 'button', 'aria-expanded': String(open), dataset: { key: `trade-${set.id}` },
          on: { click: () => toggle(!open) } },
        open ? 'Not now' : `Trade ${R.tradeIn} spares`)
      : h('small.pc-trade-hint', `${R.tradeIn - Math.min(R.tradeIn - 1, set.spares)} more for a trade`),
    choose);
}

function page(ctx, kit, set, ui) {
  const st = ctx.store.state;
  const inTray = (own(st.farm.storage, set.display) ?? 0) > 0;
  const head = h('header.pc-page-head',
    h('div.pc-page-title', h('h4', set.name), h('small', `Found by ${set.how}`)),
    h(`span.pc-count${set.done ? '.done' : ''}`, { 'aria-label': `${set.found} of ${set.total} found` },
      `${set.found}/${set.total}`));
  const stickers = h('div.pc-stickers', ...set.items.map((it) => sticker(ctx, set, it)));
  const luck = set.done ? null : h('div.pc-luck',
    { title: `Every try has a ${COLLECTION_RULES.dropBp / 100} % chance; after ${set.pityMax} tries without a new item the next one is certain` },
    h('span.pc-luck-label', clover(18), 'Lucky find'), bar(set.pity / Math.max(1, set.pityMax), null, 'pn-thin pn-go'),
    h('small', set.pityLeft <= 1 ? 'the very next one is certain' : `certain within ${fmt(set.pityLeft)} ${set.noun}`));
  const reward = h(`div.pc-reward${set.done ? '.kept' : ''}`,
    h('span.pc-reward-label', set.done ? 'Yours:' : 'Complete it:'),
    set.done ? null : h('span.pc-reward-item', icon('acorns', { size: 20 }), `${set.acorns} Acorns`),
    h('span.pc-reward-item', icon(set.display, { size: 22 }), set.displayName),
    h(`span.pc-reward-item.pc-perk${set.done ? '.on' : ''}`, set.perkText),
    set.done && inTray ? h('button.pn-chipbtn.pc-place',
      { type: 'button', on: { click: () => startPlacement(ctx, set.display) } }, 'Place it') : null);
  const trade = set.spares > 0 && !set.done && ui.open ? tradeRow(ctx, kit, set, ui.trading === set.id,
    (on) => { ui.trading = on ? set.id : null; ui.redraw(); }) : null;
  return h(`article.pc-page${set.done ? '.done' : ''}`, { dataset: { set: set.id } },
    head, stickers, luck, trade, reward, set.done ? h('span.pc-stamp', { 'aria-hidden': 'true' }, 'Complete!') : null);
}

/** Mount the album into `body` (the 'collections' panel and the Journal's Album tab share it). */
function mountAlbum(body, ctx, kit) {
  const ui = { trading: null, focus: ctx.args?.set ?? null, redraw: () => update(true) };
  const sig = () => { const v = albumView(ctx.store.state, ctx.store.pid); return [v.open, ui.trading,
    v.sets.map((x) => [x.id, x.items.map((i) => [i.found, i.by, i.dup]), x.pity, x.done, x.spares])]; };
  const wrap = h('div.pc-album');
  body.append(wrap);
  const update = kit.memo(wrap, sig, render);
  function render() {
    const st = ctx.store.state;
    const v = albumView(st, ctx.store.pid);
    ui.open = v.open;
    const head = h('header.pc-album-head',
      h('div.pc-album-title', h('b', `${fmt(v.found)} of ${fmt(v.total)} found`),
        h('small', `${fmt(v.setsDone)} of ${fmt(v.sets.length)} sets complete · each set pays ${COLLECTION_RULES.acorns} Acorns, a display piece and a lasting perk`)),
      bar(v.found / Math.max(1, v.total), null, 'pn-go pc-album-bar'));
    const intro = v.open
      ? h('p.pn-intro',
        `Little treasures turn up while you farm: each try has a ${v.dropPct} % chance, and the lucky-find bar makes sure one comes. Whoever finds it, it goes in the album for both of you.`)
      : h('p.pn-intro.pc-locked', svgIcon('lock', 20),
        `The album opens at level ${v.unlock}. Here is what will be waiting to be found.`);
    wrap.replaceChildren(head, intro, v.sets.length ? h('div.pc-pages', ...v.sets.map((set) => page(ctx, kit, set, ui)))
      : h('div.pn-empty', svgIcon('book', 44), h('p', 'The album arrives in a later chapter.')));
    kit.refresh();
    if (ui.focus) {
      const el = wrap.querySelector(`[data-set="${CSS.escape(ui.focus)}"]`);
      ui.focus = null;
      if (el) {
        el.classList.add('pn-focus-ring');
        setTimeout(() => el.classList.remove('pn-focus-ring'), 2000);
        requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      }
    }
  }
  update(true);
  return { update: () => update() };
}

export const albumPanel = {
  title: 'Collections Album',
  icon: 'recipe_cards_display',
  size: 'full',
  topics: ['album', 'stats', 'players', 'objects', 'xp'],
  mount(body, ctx) {
    // a panel opens at its top (the shell keeps the scroll box between openings; the frame is still hidden while it
    // mounts, so the reset waits a frame); a focus scrolls on its own
    const box = body.closest('.hh-panel-scroll');
    if (box && !ctx.args?.set) requestAnimationFrame(() => { box.scrollTop = 0; });
    return mountAlbum(body, ctx, createKit(ctx));
  },
};

/** The Journal's Album tab (journal.js TABS signature: (body, ctx, kit) -> update). */
export function albumTab(body, ctx, kit) {
  const inst = mountAlbum(body, ctx, kit);
  return () => inst.update();
}

// ---- finds: banners on both screens (confirmed: albumFind and albumSet are celebrations) ---------------------------

/**
 * The banner of an `albumFind` { set, item, dup, how, by }, or null (a find that completes its set: the set's own
 * banner follows). Pure.
 */
export function findText(state, ev, me) {
  const set = collectionOf(ev.set);
  const item = set?.items.find((i) => i.id === ev.item);
  if (!set || !item) return null;
  if (!ev.dup && setState(state, ev.set).done !== null) return null;
  const name = ev.by === me ? 'You' : state.players[ev.by]?.name ?? 'Your partner';
  if (ev.dup) return { title: 'A spare!',
    text: `${name} found another ${item.name}. ${COLLECTION_RULES.tradeIn} spares of ${set.name} trade for one you are missing.` };
  const found = set.items.length - albumA.missingOf(state, set).length;
  const lead = ev.how === 'trade' ? `${name} traded ${COLLECTION_RULES.tradeIn} spares for the ${item.name}.`
    : ev.how === 'gift' ? `A gift for the album: the ${item.name}.` : `${name} found the ${item.name}.`;
  return { title: ev.how === 'trade' ? 'Traded!' : 'Album find!',
    text: `${lead} ${set.name}: ${found} of ${set.items.length}.` };
}

function findBanners(ui, store) {
  const off = store.on('celebrate', ({ ev }) => {
    if (!ev || !ev.set) return;
    const st = store.state;
    if (!st) return;
    if (ev.e === 'albumFind') {
      const t = findText(st, ev, store.pid);
      if (!t) return;
      const item = collectionOf(ev.set)?.items.find((i) => i.id === ev.item);
      const b = ui.banner({ id: `find-${ev.set}-${ev.item}`, kind: 'find', ribbon: t.title, message: t.text, ttl: 7000,
        things: [{ icon: collectionOf(ev.set)?.display ?? 'recipe_cards_display', name: item?.name ?? '' }],
        actions: [{ label: 'Open the album', kind: 'sky',
          fn: () => ui.panels.open('collections', { set: ev.set }) }] });
      // the album's own sticker instead of the display piece's icon (when the card is on screen now)
      const img = b?.el?.querySelector('.thing img, .thing svg');
      if (img) {
        const art = stickerArt(ev.set, ev.item, 50);
        art.classList.add('pc-banner-sticker');
        img.replaceWith(art);
      }
      return;
    }
    if (ev.e !== 'albumSet') return;
    const set = collectionOf(ev.set);
    if (!set) return;
    const display = decorOf(set.display)?.name ?? 'its display piece';
    ui.banner({ id: `set-${ev.set}`, kind: 'golden', ribbon: 'A set is complete!',
      message: `${set.name}: ${COLLECTION_RULES.acorns} Acorns, the ${display} in your build tray, and for good: ${set.perkText}.`,
      things: [{ icon: set.display, name: display }], ttl: 12000,
      actions: [{ label: 'See the page', kind: 'sky', fn: () => ui.panels.open('collections', { set: ev.set }) }] });
  });
  return () => off?.();
}

// ---- the hub --------------------------------------------------------------------------------------------------------

const CSS_HREF = '/css/panels-collect.css';
function ensureCss() {
  ensureStylesheet(CSS_HREF);
}

/** Each live panel of the lane by name (`ribbonwall` is M1a: ribbons exist from day one). */
export const COLLECT_PANELS = Object.freeze({
  collections: albumPanel,
  restoration: restorationPanel,
  beauty: beautyPanel,
  decorsets: decorSetsPanel,
  ribbonwall: ribbonWallPanel,
});

let installed = null;
export default function install(ui, deps = {}) {
  if (installed) return installed;
  ensureCss();
  const off = [];
  for (const [name, spec] of Object.entries(COLLECT_PANELS)) {
    if (!ui.panels.has(name)) off.push(ui.panels.register(name, spec));
  }
  const store = deps.store || ui.store || globalThis.__hh?.store || null;
  if (store) {
    off.push(mountBeautyMeter(ui, store));
    off.push(findBanners(ui, store));
    off.push(restorationBanners(ui, store));
    off.push(beautyBanners(ui, store));
    off.push(giantBanners(ui, store, deps.view || globalThis.__hh?.view || null));
    off.push(unlockBanners(ui, store));
  }
  installed = () => { for (const f of off) { try { f?.(); } catch { /* already gone */ } } installed = null; };
  return installed;
}

