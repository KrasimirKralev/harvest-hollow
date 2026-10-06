// The Ribbon Wall in the farmhouse (GDD §5.4, ui-collect lane): every ribbon the farm and the two of you earned,
// framed on a planked wall, and the four wall tiers that lifetime Ribbon Points open (10 frames, 25 the farm-gate
// arch, 60 the golden scarecrow, 120 the ribbon-bunting fence). The wall dresses itself as tiers open: rosettes
// are pinned with tacks until the frames arrive, then the arch, the scarecrow and the bunting join it.
//
//   wallView(state, pid) -> plain data (tested in node)        ribbonWallPanel: the panel spec ('ribbonwall', full)
//   wallArt(unlock, size)  the small SVG of a tier (frames | gate_arch | golden_scarecrow_wall | bunting_fence)
import { RIBBON_WALL, RIBBON_REWARDS } from '../../../../shared/content/index.js';
import { ribbonPoints } from '../../../../shared/rules/actions/ribbons.js';
import { ribbonsView } from './goals-model.js';
import { h, fmt, createKit, bar, pill, playerMark, phoneTitle } from './kit.js';
import { rosette, s } from './art.js';
import { t, has, ctext } from '../../i18n/index.js';

const INK = '#3E2612';
/** Bronze / Silver / Gold by tier (1..3), in the language in effect. */
const TIER_WORD = new Proxy([], { get: (a, k) => (['1', '2', '3'].includes(k) ? t(`collect.wall.tier.${k}`) : k === '0' ? '' : a[k]) });
/** The letter on a rosette: B / S / G (Бронз, Сребро, Злато: Б / С / З). */
const tierLetter = (n) => (n >= 1 && n <= 3 ? t(`collect.wall.letter.${n}`) : '');
/** A wall tier's name: the content's, through lane B's texts or this lane's catalog. */
const tierName = (x) => ctext('RIBBON_WALL', x.unlock, 'name', has(`collect.wall.name.${x.unlock}`) ? t(`collect.wall.name.${x.unlock}`) : x.name);

/** Where each earned ribbon hangs: the shared rows (farm + together), then each farmer's own. Pure. */
export function wallView(state, pid) {
  const points = ribbonPoints(state);
  const tiers = RIBBON_WALL.map((x, i) => ({ ...x, name: tierName(x), i, open: points >= x.points }));
  const next = tiers.find((t) => !t.open) ?? null;
  // the trail fills segment by segment (10, 25, 60, 120 sit at equal spacing): a point always moves the marker
  let track = 1;
  if (next) {
    const prev = next.i > 0 ? tiers[next.i - 1].points : 0;
    track = (next.i + Math.max(0, points - prev) / Math.max(1, next.points - prev)) / tiers.length;
  }
  const pids = Object.keys(state.players ?? {}).sort();
  const me = pids.includes(pid) ? pid : pids[0] ?? null;
  const mine = me ? ribbonsView(state, me) : [];
  const frame = (r, owner = null) => ({ id: r.id, name: ctext('ribbons', r.id, 'name', r.name), text: ctext('ribbons', r.id, 'text', r.text), tier: r.tier, max: r.tiers.length,
    scope: r.scope, secret: r.secret, owner, gold: r.tier >= r.tiers.length });
  const shared = mine.filter((r) => !r.hidden && r.tier > 0 && r.scope !== 'P').map((r) => frame(r))
    .sort((a, b) => b.tier - a.tier || (a.scope === b.scope ? 0 : a.scope === 'T' ? -1 : 1) || a.name.localeCompare(b.name));
  const personal = pids.map((p) => ({
    pid: p, name: state.players[p].name, color: state.players[p].color, me: p === me,
    frames: (p === me ? mine : ribbonsView(state, p)).filter((r) => !r.hidden && r.tier > 0 && r.scope === 'P')
      .map((r) => frame(r, p)).sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name)),
  }));
  // the closest tiers still to earn (shared ones and mine): what to aim for next
  const closest = mine.filter((r) => !r.hidden && r.next !== null && r.pct > 0 && r.value < r.next)
    .sort((a, b) => b.pct - a.pct || a.n - b.n).slice(0, 3)
    .map((r) => ({ id: r.id, name: ctext('ribbons', r.id, 'name', r.name), text: ctext('ribbons', r.id, 'text', r.text), tier: r.tier + 1, value: r.value, need: r.next, pct: r.pct,
      scope: r.scope, points: r.scope === 'P' ? 0 : RIBBON_REWARDS.F[r.tier]?.points ?? 0 }));
  const earnedTiers = mine.filter((r) => !r.hidden && r.scope !== 'P').reduce((n, r) => n + r.tier, 0);
  const possible = mine.filter((r) => !r.hidden && r.scope !== 'P').reduce((n, r) => n + r.tiers.length, 0);
  return { points, tiers, next, toNext: next ? next.points - points : 0, track, shared, personal, closest,
    earnedTiers, possible, framed: tiers[0]?.open ?? false,
    open: Object.fromEntries(tiers.map((t) => [t.unlock, t.open])),
    pointsPerTier: RIBBON_REWARDS.F.map((x) => x.points) };
}

// ---- art ---------------------------------------------------------------------------------------------------------

const svgRoot = (viewBox, w, hgt, cls) => s('svg', { viewBox, width: w, height: hgt, class: cls, 'aria-hidden': 'true',
  focusable: 'false' });

/** The little picture of a wall tier (milestone medallions). */
export function wallArt(unlock, size = 48) {
  const svg = svgRoot('0 0 48 48', size, size, `pc-wallart pc-wallart-${unlock}`);
  switch (unlock) {
    case 'frames':
      svg.append(
        s('rect', { x: 8, y: 6, width: 32, height: 36, rx: 3, fill: '#E3A21E', stroke: INK, 'stroke-width': 2.5 }),
        s('rect', { x: 13, y: 11, width: 22, height: 26, rx: 1.5, fill: '#FFF4D6', stroke: '#A86A10',
          'stroke-width': 2 }),
        s('circle', { cx: 24, cy: 21, r: 6, fill: '#4AA8E8', stroke: INK, 'stroke-width': 1.8 }),
        s('path', { d: 'M20 26 l-3 8 l4 -2 l2 3 l2 -8 M28 26 l3 8 l-4 -2 l-2 3 l-2 -8', fill: '#2B78B5', stroke: INK,
          'stroke-width': 1.4, 'stroke-linejoin': 'round' }),
        s('path', { d: 'M11 9 h14', stroke: '#fff', 'stroke-opacity': 0.6, 'stroke-width': 2,
          'stroke-linecap': 'round' }));
      break;
    case 'gate_arch':
      svg.append(
        s('path', { d: 'M8 44 V20 q16 -18 32 0 V44', fill: 'none', stroke: INK, 'stroke-width': 7,
          'stroke-linecap': 'round' }),
        s('path', { d: 'M8 44 V20 q16 -18 32 0 V44', fill: 'none', stroke: '#B87533', 'stroke-width': 4,
          'stroke-linecap': 'round' }),
        ...[[12, 15, '#E8554A'], [18, 10.5, '#FFC83D'], [24, 9, '#4AA8E8'], [30, 10.5, '#5DBB3F'], [36, 15, '#9B6BD6']]
          .map(([x, y, c]) => s('path', { d: `M${x - 3} ${y} h6 l-3 6 z`, fill: c, stroke: INK, 'stroke-width': 1.3,
            'stroke-linejoin': 'round' })),
        s('rect', { x: 15, y: 24, width: 18, height: 7, rx: 2, fill: '#FFF4D6', stroke: INK, 'stroke-width': 1.8 }));
      break;
    case 'golden_scarecrow_wall':
      svg.append(
        s('path', { d: 'M24 18 V45', stroke: INK, 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
        s('path', { d: 'M24 18 V45', stroke: '#C8841A', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
        s('path', { d: 'M8 25 H40', stroke: INK, 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
        s('path', { d: 'M8 25 H40', stroke: '#C8841A', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
        s('path', { d: 'M14 23 h20 l-3 14 h-14 z', fill: '#FFD45C', stroke: INK, 'stroke-width': 2,
          'stroke-linejoin': 'round' }),
        s('circle', { cx: 24, cy: 15, r: 6.5, fill: '#FFE58A', stroke: INK, 'stroke-width': 2 }),
        s('path', { d: 'M14 10 h20 l-4 -6 h-12 z', fill: '#E3A21E', stroke: INK, 'stroke-width': 2,
          'stroke-linejoin': 'round' }),
        s('path', { d: 'M17 28 l3 3 M27 28 l3 3', stroke: '#A86A10', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        s('circle', { cx: 37, cy: 8, r: 2, fill: '#fff' }), s('circle', { cx: 9, cy: 36, r: 1.6, fill: '#fff' }));
      break;
    default:
      svg.append(
        s('path', { d: 'M3 12 q21 14 42 0', fill: 'none', stroke: INK, 'stroke-width': 2 }),
        ...[[8, '#E8554A'], [16, '#FFC83D'], [24, '#4AA8E8'], [32, '#5DBB3F'], [40, '#FF7A8A']].map(([x, c], i) => {
          const y = 12 + Math.round(Math.sin((i + 0.5) / 5 * Math.PI) * 7);
          return s('path',
            { d: `M${x - 4} ${y - 1} h8 l-4 10 z`, fill: c, stroke: INK, 'stroke-width': 1.5,
              'stroke-linejoin': 'round' });
        }),
        s('path', { d: 'M4 40 h40 M8 33 v12 M20 33 v12 M32 33 v12 M44 33 v12', stroke: '#8A5224', 'stroke-width': 3,
          'stroke-linecap': 'round' }));
  }
  return svg;
}

/** The ribbon arch over the shared rows (tier 2): a wooden arch with pennants and the farm's name. */
function archArt(farmName) {
  const svg = svgRoot('0 0 640 92', '100%', 92, 'pc-arch');
  const flags = [];
  const colours = ['#E8554A', '#FFC83D', '#4AA8E8', '#5DBB3F', '#9B6BD6', '#FF7A8A'];
  for (let i = 0; i < 17; i++) {
    const t = (i + 0.5) / 17;
    const x = 40 + t * 560;
    const y = 74 - Math.sin(t * Math.PI) * 58;
    flags.push(s('path',
      { d: `M${x - 9} ${y} h18 l-9 15 z`, fill: colours[i % colours.length], stroke: INK, 'stroke-width': 1.8,
      'stroke-linejoin': 'round' }));
  }
  const text = s('text', { x: 320, y: 58, 'text-anchor': 'middle', class: 'pc-arch-name' });
  text.textContent = farmName;
  svg.append(
    s('path', { d: 'M28 92 V70 Q320 -34 612 70 V92', fill: 'none', stroke: INK, 'stroke-width': 13,
      'stroke-linecap': 'round' }),
    s('path', { d: 'M28 92 V70 Q320 -34 612 70 V92', fill: 'none', stroke: '#B87533', 'stroke-width': 8,
      'stroke-linecap': 'round' }),
    s('path', { d: 'M60 58 Q320 -26 580 58', fill: 'none', stroke: '#EDBE72', 'stroke-width': 2,
      'stroke-opacity': 0.8 }),
    ...flags,
    s('rect', { x: 196, y: 34, width: 248, height: 34, rx: 8, fill: '#FFF4D6', stroke: INK, 'stroke-width': 2.5 }),
    text);
  return svg;
}

/** The golden scarecrow standing guard at the corner of the wall (tier 3). */
function scarecrowArt() {
  const svg = svgRoot('0 0 90 150', 90, 150, 'pc-scarecrow');
  svg.append(
    s('ellipse', { cx: 45, cy: 144, rx: 30, ry: 5, fill: 'rgba(62,38,18,.25)' }),
    s('path', { d: 'M45 40 V144', stroke: INK, 'stroke-width': 8, 'stroke-linecap': 'round' }),
    s('path', { d: 'M45 40 V144', stroke: '#B87533', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
    s('path', { d: 'M6 62 H84', stroke: INK, 'stroke-width': 8, 'stroke-linecap': 'round' }),
    s('path', { d: 'M6 62 H84', stroke: '#B87533', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
    s('path', { d: 'M22 58 h46 l-7 46 h-32 z', fill: '#FFD45C', stroke: INK, 'stroke-width': 3,
      'stroke-linejoin': 'round' }),
    s('path', { d: 'M30 66 l6 6 M54 66 l6 6 M36 86 h18', stroke: '#C8841A', 'stroke-width': 2.4,
      'stroke-linecap': 'round' }),
    s('path', { d: 'M8 60 l-4 10 l7 -3 M82 60 l4 10 l-7 -3', fill: '#FFE58A', stroke: INK, 'stroke-width': 2,
      'stroke-linejoin': 'round' }),
    s('circle', { cx: 45, cy: 38, r: 15, fill: '#FFE58A', stroke: INK, 'stroke-width': 3 }),
    s('path', { d: 'M38 36 h3 M49 36 h3 M39 44 q6 5 12 0', stroke: INK, 'stroke-width': 2.4, 'stroke-linecap': 'round',
      fill: 'none' }),
    s('path', { d: 'M22 26 h46 l-9 -17 h-28 z', fill: '#E3A21E', stroke: INK, 'stroke-width': 3,
      'stroke-linejoin': 'round' }),
    s('path', { d: 'M30 22 h30', stroke: '#E8554A', 'stroke-width': 4 }),
    s('path', { d: 'M28 13 q8 -4 16 -4', stroke: '#fff', 'stroke-opacity': 0.6, 'stroke-width': 2.5,
      'stroke-linecap': 'round', fill: 'none' }),
    s('circle', { cx: 74, cy: 22, r: 2.5, fill: '#fff' }), s('circle', { cx: 14, cy: 96, r: 2, fill: '#fff' }));
  return svg;
}

// ---- the panel -----------------------------------------------------------------------------------------------------

function frameEl(f, framed) {
  const label = t(f.gold ? 'collect.wall.frameGold' : 'collect.wall.frame', { name: f.name, tier: TIER_WORD[f.tier], text: f.text });
  return h(`figure.pc-frame.t${f.tier}.s${f.scope}${framed ? '.framed' : '.pinned'}${f.secret ? '.secret' : ''}`, {
    role: 'img', 'aria-label': label, title: label, dataset: { ribbon: f.id },
  }, h('span.pc-frame-face', rosette(f.tier, 52, tierLetter(f.tier))),
  h('figcaption', h('b', f.name), h('small', f.secret ? t('collect.wall.secret') : TIER_WORD[f.tier])));
}

function tierCard(x, v) {
  const left = Math.max(0, x.points - v.points);
  return h(`li.pc-tier${x.open ? '.open' : ''}${v.next === x ? '.next' : ''}`, { dataset: { tier: x.unlock } },
    h('span.pc-tier-art', wallArt(x.unlock, 44)),
    h('span.pc-tier-text', h('b', x.name),
      h('small', x.open ? t('collect.wall.onWall') : t('collect.wall.pointsLeft', { p: x.points, left }))),
    x.open ? h('span.pc-tier-check', { 'aria-label': t('collect.wall.unlocked') }, '✓') : null);
}

export const ribbonWallPanel = {
  get title() { return phoneTitle('collect.wall.title', 'collect.wall.titleShort'); },
  icon: 'ribbon_trophy',
  size: 'full',
  topics: ['ribbons', 'stats', 'players'],
  mount(body, ctx) {
    // a panel opens at its top (the shell keeps the scroll box between openings; the frame is still hidden while it
    // mounts, so the reset waits a frame); a focus scrolls on its own
    const box = body.closest('.hh-panel-scroll');
    if (box && !ctx.args?.set && !ctx.args?.id) requestAnimationFrame(() => { box.scrollTop = 0; });
    const kit = createKit(ctx);
    const view = () => wallView(ctx.store.state, ctx.store.pid);
    const sig = () => { const v = view(); return [v.points, v.shared.map((f) => [f.id, f.tier]),
      v.personal.map((p) => [p.pid, p.name, p.frames.map((f) => [f.id, f.tier])]),
        v.closest.map((c) => [c.id, c.value])]; };
    const update = kit.memo(body, sig, render);
    function render() {
      const st = ctx.store.state;
      const v = view();
      const trail = h('div.pc-trail', { role: 'progressbar', 'aria-label': t('collect.wall.trail'),
        'aria-valuemin': '0', 'aria-valuemax': String(v.tiers.at(-1)?.points ?? 0), 'aria-valuenow': String(v.points) },
      h('span.pc-trail-fill', { style: { '--p': String(v.track) } }),
      ...v.tiers.map((x) => h(`span.pc-trail-stop${x.open ? '.open' : ''}`,
        { style: { '--at': String((x.i + 1) / v.tiers.length) } },
        h('b', fmt(x.points)))));
      const head = h('header.pc-wall-head',
        h('div.pc-plaque', h('span', t('collect.wall.points')), h('b', fmt(v.points)),
          h('small', v.next ? t('collect.wall.moreFor', { n: v.toNext, name: v.next.name.toLowerCase() }) : t('collect.wall.allUp'))),
        h('div.pc-wall-ladder', trail, h('ol.pc-tiers', ...v.tiers.map((x) => tierCard(x, v)))));
      const wall = h(`div.pc-wall${v.framed ? '.framed' : ''}${v.open.bunting_fence ? '.bunting' : ''}`);
      if (v.open.gate_arch) wall.append(archArt(st.farm.name || t('collect.wall.ourFarm')));
      wall.append(h('h3.pc-wall-row-title', t('collect.wall.shared')),
        v.shared.length ? h('div.pc-frames', ...v.shared.map((f) => frameEl(f, v.framed)))
          : h('p.pc-wall-empty', t('collect.wall.sharedEmpty')));
      for (const p of v.personal) {
        wall.append(h('h3.pc-wall-row-title.pc-who-row', { style: { '--who': p.color } },
          playerMark(p.pid, st.players[p.pid], { size: 20 }),
          h('span', p.me ? t('collect.wall.mine', { name: p.name }) : t('collect.wall.theirs', { name: p.name }))),
        p.frames.length ? h('div.pc-frames', ...p.frames.map((f) => frameEl(f, v.framed)))
          : h('p.pc-wall-empty', p.me ? t('collect.wall.mineEmpty') : t('collect.wall.theirsEmpty', { name: p.name })));
      }
      if (v.open.golden_scarecrow_wall) wall.append(scarecrowArt());
      const next = v.closest.length ? h('section.pc-wall-next', h('h3.pn-h', h('span', t('collect.wall.closest'))),
        h('div.pc-next-list',
          ...v.closest.map((c) => h('div.pc-next', { dataset: { ribbon: c.id } },
            rosette(c.tier, 40, tierLetter(c.tier)),
          h('div.pc-next-main', h('b', `${c.name} · ${TIER_WORD[c.tier]}`), h('small', c.text),
            bar(c.pct, `${fmt(c.value)} / ${fmt(c.need)}`, 'pn-go')),
          c.points ? pill(t('collect.wall.pts', { n: c.points }), 'pn-warn') : pill(t('collect.wall.yours'),
            'pn-owned'))))) : null;
      body.replaceChildren(head, wall, next,
        h('p.pn-hint.pc-wall-foot',
          t('collect.wall.foot1', { a: v.pointsPerTier[0], b: v.pointsPerTier[1], c: v.pointsPerTier[2] }),
          t('collect.wall.foot2', { n: v.earnedTiers, total: v.possible }),
          ctx.ui.panels.has('journal') ? h('button.pn-chipbtn',
            { type: 'button', on: { click: () => ctx.open('journal', { tab: 'ribbons' }) } },
              t('collect.wall.journal')) : null));
      kit.refresh();
    }
    update(true);
    return { update: () => update() };
  },
};
