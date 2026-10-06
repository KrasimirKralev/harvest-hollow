// The Restoration Ledger (GDD §5.9, ui-collect lane): six projects in order (1-3 live in M1b), each four bundles of
// "any N of M" slots, donated piece by piece by either partner (donors shown on each slot); the farm keeps the
// permanent reward. Every project has a painted scene that heals bundle by bundle (each bundle repairs its own
// part of the picture), with a Now / After comparison slider so the couple sees what they are working toward.
//
//   ledgerView(state, pid) -> plain data (tested in node)     restorationPanel: the 'restoration' panel (full)
//   restoreScene(projectId, doneBundles: Set, { label }) -> SVG
//   restorationBanners(ui, store) -> stop                     bundle / project done banners
//
// Rules (rules-economy, shared/rules/actions/restoration.js): farm.restore[projectId] = { s: { bundleId: { slot: { n,
// by } } }, b: { bundleId: at }, done? }; openProject / slotNeed / slotHave / bundleDone; action donate { project,
// bundle, slot, qty } (gives min(qty, left, held)); events donated, bundleDone { project, bundle, by, back },
// projectDone { project, by, reward }. A completed bundle gives its partly filled slots back.
import { CONTENT, live, itemOf } from '../../../../shared/content/index.js';
import * as restoreA from '../../../../shared/rules/actions/restoration.js';
import { projectDone } from '../../../../shared/rules/economy.js';
import { levelOf } from './model.js';
import { startPlacement } from './placement.js';
import { h, fmt, createKit, bar, pill, icon, svgIcon, playerMark, hintable, phoneTitle } from './kit.js';
import { s } from './art.js';
import { homeScene } from './home-art.js';
import { flagButton } from './fair.js';
import { t, N, Q, list, lang, ctext, name as cname } from '../../i18n/index.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
/** A "special" slot (blue-ribbon goods): [name, icon, how it counts], the words read in the language in effect. */
const SPECIAL_ICON = Object.freeze({ prized_crop: 'show_ribbon', prized_animal_good: 'golden_egg', prized_fruit: 'apple' });
const special = (id) => (SPECIAL_ICON[id] ? [t(`collect.rest.special.${id}`), SPECIAL_ICON[id], t(`collect.rest.specialHow.${id}`)] : null);
/** A project's and a bundle's name in the language in effect (lane B: restoration.<id>.bundles.<bundle>). */
const projName = (p) => cname(p.id, { family: 'restoration' });
const bundleName = (p, b) => ctext('restoration', p.id, `bundles.${b.id}`, b.name);

const have = (state, item) => (own(state.farm.inventory, item) ?? 0) + (own(state.farm.overflow, item) ?? 0);

/**
 * Every project (default: the live ones, in order) with its bundles, slots (the rules' slotNeed / slotHave / donors),
 * stage, status and what the Barn holds for each slot. Pure. `projects` lets a test pass M1b defs before the flip.
 */
export function ledgerView(state, pid, { projects = [...live('restoration')].sort((a, b) => a.n - b.n) } = {}) {
  const level = levelOf(state);
  const open = restoreA.openProject(state);
  const book = state.farm.restore ?? {};
  const rows = projects.map((p, k) => {
    const done = projectDone(state, p.id);
    const bundles = p.bundles.map((b) => {
      const isDone = restoreA.bundleDone(state, p.id, b.id);
      const slots = b.slots.map((sl, i) => {
        const need = restoreA.slotNeed(p, sl);
        const n = restoreA.slotHave(state, p.id, b.id, i);
        const by = { ...(own(own(own(book, p.id)?.s, b.id), String(i))?.by ?? {}) };
        const flag = restoreA.flagOf ? restoreA.flagOf(state, { project: p.id, bundle: b.id, slot: i }) : null;
        const base = { i, kind: need.kind, qty: need.need, n, by, done: n >= need.need, flag };
        if (need.kind === 'coins') return { ...base, name: t('market.land.coins', { n: need.need }), iconId: 'coins',
          have: state.farm.wallet.coins };
        if (need.kind === 'special') {
          const [name, ic, how] = special(need.special) ?? [need.special, 'show_ribbon', ''];
          return { ...base, special: need.special, name, iconId: ic, how, have: null };
        }
        return { ...base, item: need.item, name: itemOf(need.item) ? cname(need.item) : need.item, iconId: need.item,
          have: have(state, need.item) };
      });
      const doneSlots = slots.filter((x) => x.done).length;
      // what to work on: the open slots the Barn (treasury) can finish right now first, then the ones closest to full,
      // as many as the bundle still needs
      const ready = (x) => (x.have ?? 0) >= x.qty - x.n;
      const left = slots.filter((x) => !x.done && x.kind !== 'special')
        .sort((a, c) => Number(ready(c)) - Number(ready(a)) || (c.n / c.qty) - (a.n / a.qty) || a.i - c.i);
      return { id: b.id, name: bundleName(p, b), need: b.need, of: slots.length, slots, doneSlots, done: isDone,
        toGo: isDone ? 0 : Math.max(0, b.need - doneSlots),
        nextSlots: isDone ? [] : left.slice(0, Math.max(0, b.need - doneSlots)).map((x) => x.i) };
    });
    const stage = bundles.filter((b) => b.done).length;
    const isOpen = Boolean(open && open.id === p.id);
    const prev = k > 0 ? projects[k - 1] : null;
    const lockReason = done || isOpen ? null : level < p.unlock ? t('collect.rest.opensAt', { n: p.unlock })
      : prev && !projectDone(state, prev.id) ? t('collect.rest.opensAfter', { name: prev.name, prev: N(prev.id, 'restoration') }) : t('collect.rest.notOpen');
    const donors = {};
    for (const b of bundles) {
      for (const sl of b.slots) {
        if (sl.kind !== 'item') continue;                 // goods given, in pieces (coins are not pieces)
        for (const [who, n] of Object.entries(sl.by)) donors[who] = (donors[who] ?? 0) + n;
      }
    }
    return { id: p.id, name: projName(p), n: p.n, unlock: p.unlock, text: ctext('restoration', p.id, 'desc', p.text), reward: p.reward, bundles, stage, done,
      open: isOpen, status: done ? 'done' : isOpen ? 'open' : 'locked', lockReason,
      pct: stage / Math.max(1, bundles.length), donors, doneAt: own(own(book, p.id), 'done') ?? null };
  });
  const later = [...CONTENT.restoration.values()].filter((p) => !projects.includes(p))
    .sort((a, b) => a.n - b.n)[0] ?? null;
  return { projects: rows, active: rows.find((p) => p.open) ?? null, me: pid,
    teaser: later ? { id: later.id, name: projName(later), unlock: later.unlock } : null };
}

// ---- the painted scenes ---------------------------------------------------------------------------------------------

const INK = '#3E2612';
const P = (d, fill, extra = {}) => s('path',
  { d, fill, stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra });
const R = (x, y, w, hh, fill, extra = {}) => s('rect',
  { x, y, width: w, height: hh, fill, stroke: INK, 'stroke-width': 2.2, ...extra });
const C = (cx, cy, r, fill, extra = {}) => s('circle', { cx, cy, r, fill, stroke: INK, 'stroke-width': 2, ...extra });
const line = (d, stroke, w = 2) => s('path',
  { d, fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });

let gradSeq = 0;
/** Sky, sun, two hills and the meadow; grey and washed out until the project is restored. */
function backdrop(svg, healed) {
  const id = `pc-sky-${++gradSeq}`;
  svg.append(
    s('defs', {}, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': healed ? '#7CC8F5' : '#AEBCC4' }),
      s('stop', { offset: '.75', 'stop-color': healed ? '#D6F1FF' : '#DAD8CF' }),
      s('stop', { offset: '1', 'stop-color': healed ? '#FFF1D6' : '#E6E1D3' }))),
    s('rect', { x: 0, y: 0, width: 320, height: 180, fill: `url(#${id})` }),
    s('circle', { cx: 270, cy: 34, r: 15, fill: healed ? '#FFE58A' : '#EFEAD8', opacity: healed ? 1 : 0.8 }),
    healed ? s('circle', { cx: 270, cy: 34, r: 22, fill: '#FFE58A', opacity: 0.35 }) : '',
    cloud(56, 30, healed), cloud(196, 22, healed, 0.8),
    s('path', { d: 'M0 108 Q60 80 140 98 T320 90 V180 H0 Z', fill: healed ? '#A6D873' : '#AFB38C' }),
    s('path', { d: 'M0 124 Q100 104 200 120 T320 116 V180 H0 Z', fill: healed ? '#7CC243' : '#979C74' }));
}

function cloud(x, y, healed, k = 1) {
  const fill = healed ? '#FFFFFF' : '#C9CDCB';
  return s('g', { opacity: healed ? 0.95 : 0.8, transform: `translate(${x} ${y}) scale(${k})` },
    s('ellipse', { cx: 0, cy: 6, rx: 22, ry: 8, fill }), s('circle', { cx: -8, cy: 2, r: 8, fill }),
      s('circle', { cx: 6, cy: -1, r: 10, fill }));
}

function sparkles(svg, pts) {
  for (const [x, y, r] of pts) {
    svg.append(s('path',
      { d: `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`,
      fill: '#FFF8C8', stroke: '#E3A21E', 'stroke-width': 1, class: 'pc-twinkle' }));
  }
}

function weeds(svg, pts, colour = '#6E7D45') {
  for (const [x, y] of pts) {
    svg.append(P(`M${x} ${y} q-6 -16 -2 -24 q2 12 4 14 q2 -14 8 -18 q-2 12 -2 18 q6 -8 10 -8 q-6 8 -8 18 z`, colour,
      { 'stroke-width': 1.6 }));
  }
}

function flowers(svg, pts) {
  const c = ['#FF7A8A', '#FFC83D', '#9B6BD6', '#FFFFFF', '#FF9F43'];
  pts.forEach(([x, y], i) => svg.append(line(`M${x} ${y} v6`, '#3F8F2A', 1.6),
    C(x, y, 3, c[i % c.length], { 'stroke-width': 1.2 })));
}

/** Old Greenhouse: Seedlings (plants inside), Glass & Frames (panes and white frame), Orchard Gift (potted citrus),
 * Kitchen Garden (raised beds in front). */
function greenhouse(svg, d) {
  const all = d.size >= 4;
  const glass = d.has('glass');
  backdrop(svg, all);
  const frame = glass ? '#FFFDF5' : '#6E5E4C';
  const pane = glass ? 'rgba(205,240,255,.85)' : 'rgba(150,160,150,.45)';
  // brick plinth
  svg.append(R(74, 128, 172, 22, glass ? '#C8643A' : '#9C6B52', { rx: 2 }));
  for (let x = 82; x < 244; x += 16) svg.append(line(`M${x} 128 v22`, 'rgba(62,38,18,.3)', 1));
  svg.append(line('M74 139 H246', 'rgba(62,38,18,.3)', 1));
  // glass walls (panes, some broken while the glass is not done)
  for (let i = 0; i < 8; i++) {
    const x = 78 + i * 20.5;
    const broken = !glass && [1, 2, 4, 6, 7].includes(i);
    svg.append(s('rect',
      { x: x.toFixed(1), y: 92, width: 20.5, height: 36, fill: broken ? 'rgba(62,38,18,.28)' : pane }));
    if (broken) svg.append(line(`M${(x + 4).toFixed(1)} 96 l6 10 l-3 8 M${(x + 15).toFixed(1)} 94 l-4 9`, '#4E4236',
      1.3));
    else if (glass) svg.append(line(`M${(x + 5).toFixed(1)} 122 l9 -24`, 'rgba(255,255,255,.85)', 2));
  }
  // the roof: a long glass ridge seen from the side
  svg.append(P('M78 92 L102 56 L218 56 L242 92 Z', glass ? 'rgba(205,240,255,.9)' : 'rgba(140,150,140,.5)',
    { stroke: 'none' }));
  for (let i = 0; i <= 6; i++) {
    const xt = 102 + i * (116 / 6);
    const xb = 78 + i * (164 / 6);
    const gap = !glass && (i === 2 || i === 5);
    if (!gap) svg.append(line(`M${xt.toFixed(1)} 56 L${xb.toFixed(1)} 92`, frame, 3));
  }
  if (!glass) svg.append(P('M140 56 L150 70 L136 78 Z', 'rgba(62,38,18,.3)', { 'stroke-width': 1.2 }));
  else svg.append(line('M112 84 l14 -22 M182 84 l14 -22', 'rgba(255,255,255,.9)', 2.2));
  svg.append(P('M78 92 L102 56 L218 56 L242 92 Z', 'none', { 'stroke-width': 2.4 }),
    line('M102 56 H218', frame, 4), line('M78 92 H242', frame, 4), line('M78 92 V128 M242 92 V128', frame, 4));
  for (let i = 1; i < 8; i++) svg.append(line(`M${(78 + i * 20.5).toFixed(1)} 92 V128`, frame, 2.4));
  svg.append(P('M78 92 V128 H242 V92', 'none', { 'stroke-width': 2.2 }),
    C(160, 52, 4, glass ? '#F5C542' : '#7A6A58', { 'stroke-width': 1.6 }));
  // the door
  svg.append(R(150, 104, 20, 46, glass ? '#8FCFC5' : '#6B5A46', { transform: glass ? null : 'rotate(-6 150 150)' }),
    C(166, 128, 1.6, '#F5C542', { 'stroke-width': 0.8 }));
  // seedlings inside the glass
  if (d.has('seedlings')) {
    for (let i = 0; i < 12; i++) {
      const x = 84 + i * 13.5;
      if (x > 144 && x < 174) continue;
      svg.append(P(`M${x.toFixed(1)} 127 q-5 -9 0 -15 q5 6 0 15 z`, '#5DBB3F', { 'stroke-width': 1.2 }),
        C(x + 3, 116, 2.4, ['#E8394A', '#FFC83D', '#F28A1E'][i % 3], { 'stroke-width': 1 }));
    }
  } else {
    svg.append(s('path',
      { d: 'M80 128 q20 -30 10 -50 M232 128 q-14 -26 -6 -46 M196 92 q10 -10 22 -4', fill: 'none', stroke: '#5E6B3A',
        'stroke-width': 3, 'stroke-linecap': 'round' }));
    weeds(svg, [[96, 150], [122, 152], [204, 150], [228, 152]]);
  }
  // potted citrus at both ends
  if (d.has('orchard_gift')) {
    for (const x of [50, 270]) {
      svg.append(P(`M${x - 11} 150 h22 l-3 16 h-16 z`, '#C8643A'),
        line(`M${x - 11} 154 h22`, 'rgba(62,38,18,.35)', 1.4), line(`M${x} 150 v-14`, '#8A5224', 3.2),
        C(x, 126, 15, '#4C9A3E'), C(x - 5, 120, 5, '#5DBB3F', { 'stroke-width': 0 }),
        C(x - 6, 124, 2.8, '#FFC83D', { 'stroke-width': 1.1 }), C(x + 6, 130, 2.8, '#F28A1E', { 'stroke-width': 1.1 }),
          C(x + 3, 118, 2.8, '#FFC83D', { 'stroke-width': 1.1 }));
    }
  } else svg.append(P('M40 162 l14 -6 l9 8 l-12 7 z', '#9AA0A0'), P('M262 160 l16 -4 l4 11 l-15 4 z', '#9AA0A0'));
  // raised kitchen beds in front
  if (d.has('kitchen_garden')) {
    for (const x of [92, 182]) {
      svg.append(R(x, 160, 46, 12, '#B87533', { rx: 2 }), line(`M${x} 166 h46`, 'rgba(62,38,18,.3)', 1));
      for (let i = 0; i < 4; i++) svg.append(C(x + 8 + i * 10, 157, 5.5, i % 2 ? '#9BE06A' : '#5DBB3F',
        { 'stroke-width': 1.3 }));
    }
  } else weeds(svg, [[110, 172], [202, 174], [70, 176]]);
  if (all) sparkles(svg, [[122, 64, 6], [204, 74, 5], [160, 38, 7], [60, 100, 4]]);
}

/** Mill Wheel: Millwright (the wheel turns, water flows), Grain (sacks), Bakehouse (smoke, loaves), Dairy (churns). */
function millWheel(svg, d) {
  const all = d.size >= 4;
  const wheelOk = d.has('millwright');
  backdrop(svg, all);
  // the stream
  svg.append(s('path',
    { d: 'M0 146 Q90 136 170 148 T320 142 V180 H0 Z', fill: wheelOk ? '#6EC3F0' : '#9AA7A0', stroke: INK,
      'stroke-width': 2 }));
  if (wheelOk) svg.append(s('path',
    { d: 'M20 160 q12 -5 24 0 t24 0 M150 166 q12 -5 24 0 t24 0 M240 158 q12 -5 24 0', fill: 'none', stroke: '#fff',
      'stroke-width': 2, 'stroke-linecap': 'round', class: 'pc-ripple' }));
  else svg.append(C(60, 156, 5, '#8C8476'), C(214, 160, 6, '#8C8476'), C(232, 156, 4, '#8C8476'));
  // the mill house: stone base, timber upper floor, roof
  const fixed = d.size >= 2;
  svg.append(R(150, 98, 104, 52, fixed ? '#D9D2C2' : '#B5AD9C'));
  for (const [x, y] of [[160, 108], [184, 118], [214, 106], [236, 126], [168, 132], [204, 138]]) svg.append(s('rect',
    { x, y, width: 14, height: 7, rx: 2, fill: 'rgba(62,38,18,.12)' }));
  svg.append(R(156, 70, 92, 28, fixed ? '#F2E3C4' : '#C9BFA8'),
    line('M172 70 v28 M202 70 v28 M232 70 v28', '#8A5224', 2.4),
    P('M144 74 L202 36 L260 74 Z', fixed ? '#C8473A' : '#7E6F60'),
      line('M152 70 L202 40', fixed ? '#E8554A' : '#8E8070', 3));
  if (!fixed) svg.append(P('M214 52 l12 8 l-10 4 z', '#5A4A3A', { 'stroke-width': 1.4 }),
    P('M178 58 l8 -4 l2 8 z', '#5A4A3A', { 'stroke-width': 1.4 }));
  svg.append(R(198, 116, 22, 34, '#8A5224', { rx: 2 }), R(176, 78, 16, 14, d.has('bakehouse') ? '#FFE58A' : '#4E4236'),
    R(214, 78, 16, 14, d.has('bakehouse') ? '#FFE58A' : '#4E4236'));
  // chimney and smoke, loaves on the sill
  svg.append(R(232, 38, 12, 22, '#9A8C7A'));
  if (d.has('bakehouse')) {
    svg.append(s('circle', { cx: 240, cy: 28, r: 6, fill: '#F6F3EC', opacity: 0.9 }),
      s('circle', { cx: 248, cy: 18, r: 8, fill: '#F6F3EC', opacity: 0.7 }),
      s('circle', { cx: 258, cy: 8, r: 9, fill: '#F6F3EC', opacity: 0.5 }),
        P('M174 94 q5 -6 10 0 z', '#E3A35C', { 'stroke-width': 1.2 }),
          P('M186 94 q5 -6 10 0 z', '#D08A40', { 'stroke-width': 1.2 }));
  }
  // the wheel
  const g = s('g', { class: wheelOk ? 'pc-wheel turning' : 'pc-wheel' });
  const cx = 112;
  const cy = 120;
  g.append(C(cx, cy, 40, 'none', { 'stroke-width': 8, stroke: INK }),
    C(cx, cy, 40, 'none', { 'stroke-width': 5, stroke: wheelOk ? '#B87533' : '#6B5A46' }),
    C(cx, cy, 26, 'none', { 'stroke-width': 3, stroke: wheelOk ? '#8A5224' : '#5A4A3A' }));
  for (let i = 0; i < 12; i++) {
    if (!wheelOk && [2, 3, 7, 10].includes(i)) continue;
    const a = (i * 30 * Math.PI) / 180;
    const p1 = [cx + Math.cos(a) * 9, cy + Math.sin(a) * 9];
    const p2 = [cx + Math.cos(a) * 44, cy + Math.sin(a) * 44];
    const pd = `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    g.append(line(pd, INK, 5.5), line(pd, wheelOk ? '#D99A4A' : '#7B6A55', 3));
    const q = [cx + Math.cos(a) * 44, cy + Math.sin(a) * 44];
    g.append(s('rect',
      { x: (q[0] - 5).toFixed(1), y: (q[1] - 3).toFixed(1), width: 10, height: 6,
        fill: wheelOk ? '#C98A4B' : '#6B5A46', stroke: INK, 'stroke-width': 1.4,
      transform: `rotate(${i * 30 + 90} ${q[0].toFixed(1)} ${q[1].toFixed(1)})` }));
  }
  g.append(C(cx, cy, 9, '#5A3215'));
  svg.append(g, line('M112 120 H150', '#5A3215', 5));
  // grain sacks
  if (d.has('grain')) for (const [x, y] of [[268, 140], [284, 146],
    [274, 126]]) svg.append(P(`M${x - 9} ${y + 10} q-2 -14 4 -18 l2 -4 h6 l2 4 q6 4 4 18 z`, '#EAD6A6',
      { 'stroke-width': 1.8 }), line(`M${x - 3} ${y - 4} h6`, '#B87533', 2));
  else weeds(svg, [[268, 150], [290, 152]]);
  // milk churns
  if (d.has('dairy')) for (const x of [52, 68]) svg.append(R(x - 7, 128, 14, 22, '#DCE3EA', { rx: 3 }),
    R(x - 5, 121, 10, 7, '#9FB0C0', { rx: 2 }), line(`M${x - 7} 136 h14`, '#9FB0C0', 1.6));
  else svg.append(P('M40 150 l14 -4 l6 8 l-14 4 z', '#9AA0A0'));
  if (all) sparkles(svg, [[204, 26, 6], [70, 72, 5], [288, 100, 5]]);
}

/** Stone Bridge: Timber (the arch rebuilt with a railing), Woolly (bunting), Sweet (a picnic on the far bank),
 * Fair Prizes (rosettes on the abutments); restored, the Hollow Meadow blooms beyond the river. */
function stoneBridge(svg, d) {
  const all = d.size >= 4;
  const built = d.has('timber');
  backdrop(svg, all);
  // the meadow on the far bank (wildflowers once the bridge reaches it)
  if (all) {
    flowers(svg, [[270, 98], [284, 92], [298, 100], [312, 94], [276, 86], [304, 86], [12, 104], [26, 98], [40, 106],
      [52, 100], [20, 92]]);
  }
  // the river
  svg.append(s('path',
    { d: 'M0 122 Q80 114 160 124 T320 120 V162 Q240 170 160 160 T0 166 Z', fill: all ? '#6EC3F0' : '#8FA6A8',
      stroke: INK, 'stroke-width': 2 }));
  if (all) svg.append(s('path',
    { d: 'M18 146 q12 -4 24 0 M268 150 q12 -4 24 0 M140 154 q10 -3 20 0', fill: 'none', stroke: '#fff',
      'stroke-width': 2, 'stroke-linecap': 'round' }));
  const stone = built ? '#D8D1C2' : '#A79F8F';
  // the deck curve: (66,122) -> ctrl (160,76) -> (254,122)
  const at = (t, lift = 0) => [(1 - t) ** 2 * 66 + 2 * (1 - t) * t * 160 + t * t * 254,
    (1 - t) ** 2 * 122 + 2 * (1 - t) * t * 76 + t * t * 122 - lift];
  if (built) {
    svg.append(P('M66 154 L66 122 Q160 76 254 122 L254 154 L224 154 Q224 114 160 114 Q96 114 96 154 Z', stone));
    // voussoirs around the arch and a few stones in the walls
    for (let i = 1; i < 9; i++) {
      const a = Math.PI * (i / 9);
      const x1 = 160 - Math.cos(a) * 64;
      const y1 = 154 - Math.sin(a) * 40;
      const x2 = 160 - Math.cos(a) * 76;
      const y2 = 154 - Math.sin(a) * 50;
      svg.append(line(`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`, 'rgba(62,38,18,.32)',
        1.4));
    }
    for (const [x, y] of [[72, 132], [72, 144], [236, 132], [236, 144], [118, 104], [190, 104]]) svg.append(s('rect',
      { x, y, width: 12, height: 6, rx: 2, fill: 'rgba(62,38,18,.12)' }));
    // the timber railing along the deck
    svg.append(line('M66 110 Q160 64 254 110', '#8A5224', 3.5));
    for (let i = 0; i <= 10; i++) {
      const [x, y] = at(i / 10, 12);
      svg.append(line(`M${x.toFixed(1)} ${y.toFixed(1)} v11`, '#8A5224', 2.6));
    }
    if (d.has('woolly')) {
      svg.append(line('M66 102 Q160 54 254 102', INK, 1.2));
      for (let i = 0; i < 10; i++) {
        const [x, y] = at((i + 0.5) / 10, 20);
        svg.append(P(`M${(x - 5.5).toFixed(1)} ${y.toFixed(1)} h11 l-5.5 9 z`,
          ['#F7C6D0', '#FFF4D6', '#C9A8E8', '#9ED8FF'][i % 4], { 'stroke-width': 1.2 }));
      }
    }
    if (d.has('fair_prizes')) for (const x of [80, 240]) svg.append(C(x, 136, 6.5, '#4AA8E8', { 'stroke-width': 1.6 }),
      C(x, 136, 2.8, '#FFE58A', { 'stroke-width': 1 }),
        P(`M${x - 4} 141 l-3 9 l4 -2 l2 3 l1 -9`, '#2B78B5', { 'stroke-width': 1.2 }));
  } else {
    svg.append(P('M66 154 L66 122 Q96 104 126 98 L130 110 Q104 114 96 154 Z', stone),
      P('M254 154 L254 122 Q224 104 194 98 L190 110 Q216 114 224 154 Z', stone),
      C(150, 152, 7, stone), C(170, 156, 5, stone), C(136, 160, 4.5, stone),
        line('M126 98 l-5 7 M194 98 l5 7', INK, 1.6));
  }
  // a picnic on the far bank
  if (d.has('sweet')) svg.append(P('M262 104 h42 l-6 9 h-42 z', '#E8556E', { 'stroke-width': 1.8 }),
    line('M266 108 h32', '#fff', 2), R(274, 92, 14, 10, '#C98A4B', { rx: 2 }),
      P('M274 92 q7 -8 14 0', 'none', { 'stroke-width': 1.6 }));
  else weeds(svg, [[276, 112], [298, 110]]);
  if (all) sparkles(svg, [[160, 56, 7], [100, 74, 5], [222, 70, 5]]);
}

/** Later projects (M2): a simple painted cottage, never a blank card. */
function sketch(svg, d) {
  backdrop(svg, d.size >= 4);
  svg.append(R(120, 90, 80, 56, '#F2E3C4'), P('M110 94 L160 58 L210 94 Z', '#C8473A'), R(152, 116, 16, 30, '#8A5224'));
}

const SCENES = { greenhouse, mill_wheel: millWheel, stone_bridge: stoneBridge };

/** The project's painted scene with the given bundles done (all four = the restored picture). */
export function restoreScene(projectId, doneBundles, { label = '' } = {}) {
  const svg = s('svg',
    { viewBox: '0 0 320 180', class: 'pc-scene', role: label ? 'img' : null, 'aria-label': label || null,
    'aria-hidden': label ? null : 'true', preserveAspectRatio: 'xMidYMid slice', focusable: 'false' }); // i18n-ok: an SVG attribute value
  // Restoration 4-6 (M2): ui-home paints them (each bundle heals its own part)
  if (!SCENES[projectId]) { const hs = homeScene(projectId, doneBundles, { label }); if (hs) return hs; }
  (SCENES[projectId] ?? sketch)(svg, doneBundles);
  return svg;
}

// ---- the panel ------------------------------------------------------------------------------------------------------

/** A farmer's name; a slot that left the farm reads as "A farmer" (never a raw slot id). */
const nameOf = (st, pid) => st.players[pid]?.name ?? t('collect.rest.aFarmer');

function donors(st, by, me) {
  const list = Object.entries(by || {}).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
  if (!list.length) return null;
  return h('span.pc-donors',
    ...list.map(([pid, n]) => h('span.pc-donor',
      { title: t(pid === me ? 'collect.rest.gaveYou' : 'collect.rest.gave', { name: nameOf(st, pid), n }) },
    playerMark(pid, st.players[pid], { size: 16 }), h('small', fmt(n)))));
}

function slotCard(ctx, kit, p, b, sl) {
  const st = ctx.store.state;
  const left = Math.max(0, sl.qty - sl.n);
  const giveNow = () => {
    const s2 = ctx.store.state;
    const held = sl.kind === 'coins' ? s2.farm.wallet.coins : have(s2, sl.item);
    return Math.min(left, held);
  };
  const ring = bar(Math.min(1, sl.n / Math.max(1, sl.qty)), null, `pn-thin${sl.done ? ' pn-go' : ''}`);
  let act = null;
  if (!sl.done && !b.done && p.open && sl.kind !== 'special') {
    const g = giveNow();
    act = kit.button({
      label: sl.kind === 'coins' ? t('collect.rest.fund', { n: g > 0 ? g : left }) : t('collect.rest.give', { n: g > 0 ? g : left }),
      glyph: sl.kind === 'coins' ? 'coin' : 'heart', cls: `pn-xs${sl.kind === 'coins' ? ' btn--sun' : ''}`,
        type: 'donate',
      args: () => ({ project: p.id, bundle: b.id, slot: sl.i, qty: Math.max(1, giveNow()) }),
      data: { donate: `${p.id}:${b.id}:${sl.i}` }, quiet: ['NO_ITEMS', 'NO_COINS'],
      title: sl.kind === 'coins' ? t('collect.rest.fundTip') : t('collect.rest.giveTip', { item: sl.name }),
      hint: () => (sl.kind === 'coins' ? { coins: Math.max(0, left - ctx.store.state.farm.wallet.coins) }
        : { missing: [{ item: sl.item, n: left }] }),
    });
  }
  const spare = b.done && !sl.done;
  const line = spare ? t('collect.rest.spare')
    : sl.kind === 'coins' ? t('collect.rest.coinsOf', { n: sl.n, q: sl.qty })
      : sl.kind === 'special' ? `${fmt(sl.n)} / ${fmt(sl.qty)} · ${sl.how}`
        : sl.done ? `${fmt(sl.n)} / ${fmt(sl.qty)}` : t('collect.rest.inBarn', { n: sl.n, q: sl.qty, have: sl.have });
  const next = p.open && b.nextSlots.includes(sl.i);
  return h(`li.pc-slot${sl.done ? '.done' : ''}${next ? '.next' : ''}${spare ? '.spare' : ''}${sl.kind === 'special' ? '.special' : ''}`, { dataset: { slot: String(sl.i) } },
    hintable(h('span.pc-slot-art', icon(sl.iconId, { size: 40, alt: '' }),
      sl.done ? h('span.pc-slot-tick', { 'aria-label': t('collect.rest.full') }, '✓') : null), sl.kind === 'coins' || sl.kind === 'special' ? null : sl.item,
    { need: sl.done || spare ? undefined : left }),
    h('span.pc-slot-main', h('b', sl.kind === 'coins' ? t('collect.rest.coins') : sl.name), h('small', line),
      sl.done || spare ? null : ring, donors(st, sl.by, ctx.store.pid)),
    // the give button, and under it "Need help" (GDD §6.2 #3, L23: the partner filling a flagged slot is a Heart each)
    act ? h('span.pc-slot-acts', act, restoreA.bundleFlagsOpen?.(st)
      ? flagButton(ctx, st, sl.flag, { type: 'restoreFlag', args: { project: p.id, bundle: b.id, slot: sl.i },
        title: t('collect.rest.flagTip') }) : null) : null);
}

function bundleCard(ctx, kit, p, b) {
  const partial = !b.done && b.slots.some((x) => !x.done && x.n > 0);
  return h(`section.pc-bundle${b.done ? '.done' : ''}`, { dataset: { bundle: b.id } },
    h('header', h('h4', b.name), h('span.pc-need', b.done ? t('collect.rest.doneTick') : t('collect.rest.anyOf', { need: b.need, of: b.of })),
      b.done ? null : h('small', b.toGo === 1 ? t('collect.rest.oneMore') : t('collect.rest.nMore', { n: b.toGo }))),
    h('ul.pc-slots', ...b.slots.map((sl) => slotCard(ctx, kit, p, b, sl))),
    partial && b.toGo <= 1 ? h('p.pc-bundle-note', t('collect.rest.backNote')) : null);
}

/** The cut follows the range's thumb centre exactly (a 44 px thumb travels 22 px .. width - 22 px; QA2 UI-12). */
export const cutAt = (v) => `calc(22px + (100% - 44px) * ${Math.max(0, Math.min(100, Number(v) || 0)) / 100})`;

function compare(p) {
  const now = new Set(p.bundles.filter((b) => b.done).map((b) => b.id));
  const after = new Set(p.bundles.map((b) => b.id));
  const before = restoreScene(p.id, now, { label: t('collect.rest.sceneNow', { name: p.name, stage: p.stage, n: p.bundles.length }) });
  const done = restoreScene(p.id, after, { label: t('collect.rest.sceneAfter', { name: p.name }) });
  const top = h('div.pc-compare-after', done);
  const wrap = h('div.pc-compare', { style: { '--cut': p.done ? '0%' : cutAt(55) } }, h('div.pc-compare-now', before), top,
    h('span.pc-compare-tag.l', p.done ? t('collect.rest.restored') : p.stage ? t('collect.rest.now') : t('collect.rest.before')),
      p.done ? null : h('span.pc-compare-tag.r', t('collect.rest.after')),
    p.done ? null : h('span.pc-compare-handle', { 'aria-hidden': 'true' }));
  const range = p.done ? null : h('input.pc-compare-range', { type: 'range', min: '0', max: '100', value: '55',
    'aria-label': t('collect.rest.compare', { name: p.name }),
      on: { input: (e) => wrap.style.setProperty('--cut', cutAt(e.target.value)) } });
  if (range) wrap.append(range);
  return wrap;
}

export const restorationPanel = {
  get title() { return phoneTitle('collect.rest.title', 'collect.rest.titleShort'); },
  icon: 'planks',
  size: 'full',
  topics: ['restore', 'restoration', 'inventory', 'wallet', 'xp', 'stats', 'players'],
  mount(body, ctx) {
    // a panel opens at its top (the shell keeps the scroll box between openings; the frame is still hidden while it
    // mounts, so the reset waits a frame); a focus scrolls on its own
    const box = body.closest('.hh-panel-scroll');
    if (box) requestAnimationFrame(() => { box.scrollTop = 0; });
    const kit = createKit(ctx);
    const v0 = ledgerView(ctx.store.state, ctx.store.pid);
    let sel = ctx.args?.id ?? v0.active?.id ?? v0.projects.find((p) => !p.done)?.id ?? v0.projects[0]?.id ?? null;
    const sig = () => {
      const v = ledgerView(ctx.store.state, ctx.store.pid);
      return [sel, v.projects.map((p) => [p.id, p.open, p.stage,
        p.bundles.map((b) => b.slots.map((x) => [x.n, x.have, Object.values(x.by), x.flag]))])];
    };
    const update = kit.memo(body, sig, render);
    function render() {
      const st = ctx.store.state;
      const v = ledgerView(st, ctx.store.pid);
      const p = v.projects.find((x) => x.id === sel) ?? v.projects[0];
      if (!p) { body.replaceChildren(h('p.pn-intro', t('collect.rest.nothing'))); return; }
      const tabs = h('nav.pc-projects', { 'aria-label': t('collect.rest.projects') },
        ...v.projects.map((x) => h(`button.pc-project${x.id === p.id ? '.sel' : ''}${x.done ? '.done' : ''}${x.open ? '' : '.locked'}`, {
          type: 'button', 'aria-pressed': String(x.id === p.id), dataset: { key: `proj-${x.id}`, project: x.id },
          on: { click: () => { sel = x.id; update(true); const sc = body.closest('.hh-panel-scroll'); if (sc) sc.scrollTop = 0; } } },
        h('span.pc-project-n', String(x.n)), h('span.pc-project-text', h('b', x.name),
          h('small', x.done ? t('collect.rest.restoredTick') : x.open ? t('collect.rest.stageOf', { stage: x.stage, n: x.bundles.length }) : x.lockReason)),
        x.open && !x.done ? bar(x.pct, null, 'pn-thin pn-go') : null)),
        v.teaser ? h('div.pc-project.teaser', h('span.pc-project-n', '…'),
          h('span.pc-project-text', h('b', v.teaser.name), h('small', t('collect.rest.laterChapter')))) : null);
      const intro = h('div.pc-ledger-intro',
        h('p.pn-intro',
          p.done ? t('collect.rest.isRestored', { name: p.name, text: p.text })
            : t('collect.rest.how', { n: p.bundles.length, name: p.name, proj: N(p.id, 'restoration') })),
        h('div.pc-reward-box', svgIcon('star', 26),
          h('div', h('b', p.done ? t('collect.rest.yoursForGood') : t('collect.rest.whenDone')), h('span', p.text))));
      // the restored Old Greenhouse waits in the build tray as a frame (rules: restoration.js greenhouseDef)
      const gh = p.done && p.reward?.greenhouse ? restoreA.greenhouseDef() : null;
      const ghTray = gh ? (st.farm.storage?.[gh.id] ?? 0) : 0;
      const placeGh = ghTray > 0 ? h('div.pc-place-gh',
        h('button.btn.btn--sun.pn-sm',
          { type: 'button', dataset: { place: gh.id }, on: { click: () => startPlacement(ctx, gh.id) } },
        svgIcon('hammer', 22), t('collect.rest.placeGh', { name: gh.name, gh: N(gh.id) })),
          h('small', t('collect.rest.ghNote'))) : null;
      const left = h('div.pc-ledger-left', compare(p), placeGh, intro,
        p.open || p.done ? null : h('p.pc-lock', svgIcon('lock', 20), t('collect.rest.lockNote', { why: p.lockReason })),
        Object.keys(p.donors).length ? h('p.pn-hint.pc-donor-sum', t('collect.rest.given'),
          ...Object.entries(p.donors).sort(([a], [b]) => a.localeCompare(b))
          .map(([pid, n]) => h('span.pc-donor', playerMark(pid, st.players[pid], { size: 16 }),
            ` ${nameOf(st, pid)} ${fmt(n)} `))) : null);
      const right = h('div.pc-bundles', ...p.bundles.map((b) => bundleCard(ctx, kit, p, b)));
      body.replaceChildren(tabs, h('div.pc-ledger', left, right));
      kit.refresh();
    }
    update(true);
    return { update: () => update() };
  },
};

// ---- banners --------------------------------------------------------------------------------------------------------

/** The banner of a `bundleDone` / `projectDone` event (both are economy fx events, seen on both screens). Pure. */
export function restoreText(state, ev, me) {
  const p = CONTENT.restoration.get(ev.project);
  if (!p) return null;
  const who = ev.by === me ? t('common.you') : state.players[ev.by]?.name ?? t('common.partner');
  const pr = { name: projName(p), proj: N(p.id, 'restoration'), text: ctext('restoration', p.id, 'desc', p.text) };
  if (ev.e === 'projectDone') {
    const next = restoreA.openProject(state);
    return { ribbon: t('collect.rest.restoredBang'), kind: 'golden',
      message: next && next.id !== p.id ? t('collect.rest.standsNext', { ...pr, next: projName(next) }) : t('collect.rest.stands', pr) };
  }
  const b = p.bundles.find((x) => x.id === ev.bundle);
  if (!b) return null;
  const done = p.bundles.filter((x) => restoreA.bundleDone(state, p.id, x.id)).length;
  if (done >= p.bundles.length) return null;                          // the project's own banner follows
  const english = (x) => (x.coins ? `${fmt(x.coins)} coins` : `${fmt(x.qty)} ${itemOf(x.item)?.name ?? x.item}`); // i18n-ok: the English list
  const back = (ev.back ?? []).map((x) => (t('collect.rest.backItem', { en: english(x), q: x.coins ? t('market.land.coins', { n: x.coins }) : itemOf(x.item) ? Q(x.item, x.qty) : `${x.item} ×${fmt(x.qty)}` })));
  const msg = { who, bundle: bundleName(p, b), ...pr, done, n: p.bundles.length };
  return { ribbon: t('collect.rest.bundleBang'), kind: 'quest',
    message: back.length ? t('collect.rest.bundleDoneBack', { ...msg, back: lang() === 'en' ? back.join(' and ') : list(back) }) : t('collect.rest.bundleDone', msg) };
}

export function restorationBanners(ui, store) {
  const off = store.on('fx', ({ ev }) => {
    if (!ev || (ev.e !== 'bundleDone' && ev.e !== 'projectDone')) return;
    const st = store.state;
    const rt = st ? restoreText(st, ev, store.pid) : null;
    if (!rt) return;
    // functions: a language switch while the card is up says it again (from the same event and farm)
    const again = () => restoreText(st, ev, store.pid) ?? rt;
    ui.banner({ id: `restore-${ev.project}-${ev.e === 'projectDone' ? 'done' : ev.bundle}`, kind: rt.kind,
      ribbon: () => again().ribbon, message: () => again().message,
      things: [], ttl: ev.e === 'projectDone' ? 12000 : 7000,
      actions: [{ label: ev.e === 'projectDone' ? t('collect.rest.look') : t('collect.rest.seeIt'), kind: 'sky',
        fn: () => ui.panels.open('restoration', { id: ev.project }) }] });
  });
  return () => off?.();
}
