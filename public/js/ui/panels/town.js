// Town Projects, the Hollow Village (GDD §5.9 v2 H4 + A5; L20, M1b; ui-weekly lane, wave 2): one project at a
// time. Ollie posts it once the farm has made three kinds of goods lately; the couple gives a goods bundle (three
// goods, piece by piece) and funds E(L) × (10 + 0.5 (n − 1)) hours of coins; once everything is in, the village
// builds it the next day, which pays 5 Acorns, a souvenir decor and a Memory Book page, and its landmark joins the
// village across the river (lit at night). The panel shows the stages (posted -> goods and coins -> building ->
// built), who gave what, and what it unlocks; the painted village strip shows every landmark so far.
// State and actions are the economy lane's (shared/rules/actions/town.js: `farm.town = { n, cur }`, townGive
// { item, qty }, townFund { coins }). Pure readers (`townView`, `townBadge`, `weeklyLines`) for node tests.
import { CONTENT, TOWN_PROJECT_RULES, itemOf, defOf } from '../../../../shared/content/index.js';
import * as TW from '../../../../shared/rules/actions/town.js';
import { systemLive } from '../../../../shared/rules/coop.js';
import { h, icon, svgIcon, fmt, fmtShort, playerMark, createKit, fill, hintable } from './kit.js';
import { levelOf, available } from './core.js';
import { s as sv } from './art.js';
import { actionOf, banner, speech, lockedBody, leftText, need, toTop, fairView, fmtPts } from './fair.js';
import { bargeView } from './barge.js';
import { townsfolkView } from './townsfolk.js';

const R = TOWN_PROJECT_RULES;
const byPid = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/** The live projects in order (four in M1b). */
export const liveProjects = () => [...CONTENT.townProjects.values()].filter((p) => systemLive(p)).sort((a, b) => a.n - b.n);

/** The open project as the panel draws it: goods with who gave what, the coins, the stage. */
function currentOf(state, c, now) {
  // Town Projects 25+ are the Festival Pavilion's tiers (M2; rules town.pavilionTier), not authored projects
  const def = CONTENT.townProjects.get(c.id) ?? (typeof TW.pavilionTier === 'function' ? TW.pavilionTier(c.n) : null);
  const goods = c.goods.map((g) => ({ item: g.item, name: itemOf(g.item)?.name ?? g.item, qty: g.qty, given: Math.min(g.qty, g.got),
    left: Math.max(0, g.qty - g.got), by: { ...g.by }, have: available(state, g.item) }));
  const stage = c.buildAt !== undefined ? (now >= c.buildAt ? 'built' : 'building') : 'gathering';
  return {
    id: c.id, def, name: def ? def.name : 'A new project', text: def ? def.text : '', n: c.n, souvenir: def ? def.souvenir : null,
    goods, need: c.coins, funded: Math.min(c.coins, c.paid), fundedBy: { ...c.by }, coinsLeft: Math.max(0, c.coins - c.paid),
    readyAt: c.buildAt ?? 0, goodsDone: goods.every((g) => g.left <= 0), coinsDone: c.paid >= c.coins, stage, acorns: R.acorns, at: c.at,
  };
}

/**
 * Everything the village panel draws, DOM-free.
 * @returns {{ live, open, unlock, level, has, projects, cur, built, donors, more, waiting, made, need }}
 */
export function townView(state, pid, now) {
  const level = levelOf(state);
  const live = systemLive(R);
  const open = live && level >= R.unlock;
  const t = state.farm.town ?? null;
  const builtN = t ? t.n : 0;
  const cur = t?.cur ? currentOf(state, t.cur, now) : null;
  const statusOf = (p) => {
    if (p.n <= builtN) return 'built';
    if (cur && cur.id === p.id) return cur.stage === 'gathering' ? 'current' : 'building';
    return 'later';
  };
  const projects = liveProjects().map((p) => ({ id: p.id, name: p.name, n: p.n, souvenir: p.souvenir, text: p.text, status: statusOf(p) }));
  const donors = {};
  const add = (p, k, n) => {
    if (!(n > 0)) return;
    const d = donors[p] ?? (donors[p] = { coins: 0, goods: 0 });
    d[k] += n;
  };
  if (cur) {
    for (const [p, n] of Object.entries(cur.fundedBy)) add(p, 'coins', n);
    for (const g of cur.goods) for (const [p, n] of Object.entries(g.by)) add(p, 'goods', n);
  }
  // why Ollie has nothing pinned up: the next project waits for three kinds of goods made lately, or there is none
  let waiting = null;
  const made = t && !cur ? TW.townCandidates(state, now).length : 0;
  if (open && !cur) {
    const next = liveProjects().find((p) => p.n === builtN + 1)
      ?? (typeof TW.pavilionTier === 'function' ? TW.pavilionTier(builtN + 1) : null);
    waiting = !next ? 'done' : made < R.goods ? 'goods' : 'soon';
  }
  const more = [...CONTENT.townProjects.values()].filter((p) => !systemLive(p)).length;
  // the Festival Pavilion's tiers built after the last authored project (M2), one line in "Built together"
  const tiers = typeof TW.pavilionTier === 'function' && TW.pavilionTier(projects.length + 1) ? Math.max(0, builtN - projects.length) : 0;
  const pavilion = tiers ? { id: R.repeatable, name: `Festival Pavilion · ${tiers} ${tiers === 1 ? 'tier' : 'tiers'}`,
    text: TW.pavilionTier(projects.length + tiers).text, souvenir: TW.pavilionTier(projects.length + 1).souvenir } : null;
  const built = projects.filter((p) => p.status === 'built');
  return { live, open, unlock: R.unlock, level, has: Boolean(t), projects, cur, built: pavilion ? [...built, pavilion] : built,
    donors, more, waiting, made, need: R.goods, pavilionTiers: tiers };
}

/** The village's badge: '!' when the barn can give something the open project still needs. Pure. */
export function townBadge(state, pid, now) {
  const v = townView(state, pid, now);
  if (!v.open || !v.cur || v.cur.stage !== 'gathering') return null;
  return v.cur.goods.some((g) => g.left > 0 && g.have > 0) ? '!' : null;
}

/** The funding bar's segments: each farmer's coins in their colour, anything paid without a known donor in gold. */
export function fundSegments(state, c) {
  const out = [];
  let known = 0;
  for (const [p, n] of Object.entries(c.fundedBy).sort(byPid)) {
    if (!(n > 0)) continue;
    known += n;
    const pl = state.players?.[p];
    out.push({ pid: p, color: pl?.color ?? '#C9A36A', w: c.need ? n / c.need : 0, title: `${pl?.name ?? 'A farmer'}: ${fmt(n)} coins` });
  }
  const rest = c.funded - known;
  if (rest > 0) out.push({ pid: null, color: '#F5C542', w: c.need ? rest / c.need : 0, title: `${fmt(rest)} coins` });
  return out;
}

/**
 * One short line per weekly system that is open on this farm, for the morning recap, the Journal's "This week" and
 * tooltips: [{ panel, icon, text }]. Pure (GDD §5.8: the recap names "the Fair and barge status").
 */
export function weeklyLines(state, pid, now) {
  const out = [];
  const f = fairView(state, pid, now);
  if (f.open && f.has && f.isOpen) {
    const so = f.medal ? `, ${f.medal.name} so far` : '';
    out.push({ panel: 'fair', icon: 'ribbon_rosette',
      text: `County Fair: ${fmtPts(f.p10)} of ${fmtPts(f.W10)} points${so}. Judging in ${leftText(f.closesAt, now)}` });
  } else if (f.open && f.last && now - f.last.at < 2 * 86_400_000) {
    out.push({ panel: 'fair', icon: 'ribbon_rosette', text: f.last.name ? `County Fair: ${f.last.name}! ${fmtPts(f.last.p10)} points`
      : `County Fair: ${fmtPts(f.last.p10)} points, no medal this time` });
  }
  const b = bargeView(state, pid, now);
  if (b.open && b.docked && b.total) {
    const ready = b.ready ? `, ${b.ready} ready to load` : '';
    out.push({ panel: 'barge', icon: 'wooden_crate',
      text: `River Barge: ${b.loaded} of ${b.total} crates loaded${ready}. Casts off in ${leftText(b.leavesAt, now)}` });
  } else if (b.open && !b.docked) {
    out.push({ panel: 'barge', icon: 'wooden_crate', text: `River Barge: downriver, docks in ${leftText(b.arrivesAt, now)}` });
  }
  const t = townsfolkView(state, pid, now);
  if (t.open && t.posts.length) {
    const ready = t.ready ? `, ${t.ready} ready to hand in` : '';
    out.push({ panel: 'townsfolk', icon: 'order_board', text: `Townsfolk board: ${t.done} of ${t.posts.length} requests filled${ready}` });
  }
  const v = townView(state, pid, now);
  if (v.open && v.cur) {
    const c = v.cur;
    const goods = c.goods.reduce((n, g) => n + g.given, 0);
    const all = c.goods.reduce((n, g) => n + g.qty, 0);
    const text = c.stage === 'gathering'
      ? `${c.name}: ${goods} of ${all} goods, ${Math.floor((100 * c.funded) / Math.max(1, c.need))} % funded`
      : c.stage === 'building' ? `${c.name}: Ollie is building it, ready in ${leftText(c.readyAt, now)}` : `${c.name} is finished!`;
    out.push({ panel: 'town', icon: c.souvenir ?? 'ferry_landing_souvenir', text });
  }
  return out;
}

// ---- the painted village strip (inline SVG: flat fills, ink outlines, light from the upper left) ----------------

const INK = '#3E2612';
const L = (o) => ({ stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round', ...o });
const round = { 'stroke-linecap': 'round' };

/** One landmark silhouette (base line at y = 78, centred on 0). Built: full colour, warm windows; later: a sketch. */
function landmarkArt(id, status) {
  const g = sv('g', { class: `wk-lm s-${status}` });
  const lit = status === 'built';
  const win = lit ? '#FFD76A' : '#9FB7C9';
  const sketch = status === 'later';
  const paint = (c) => (sketch ? 'none' : c);
  const wall = paint('#F4E3C1');
  const add = (...els) => g.append(...els.filter(Boolean));
  switch (id) {
    case 'ferry_landing':
      add(sv('path', L({ d: 'M-34 78 h52 v6 h-52 z', fill: paint('#B07A43') })),
        sv('path', L({ d: 'M-30 84 v8 M-12 84 v8 M6 84 v8', fill: 'none' })),
        sv('path', L({ d: 'M8 86 q14 10 34 0 l-4 -8 h-26 z', fill: paint('#4A7FE8') })),
        sv('path', L({ d: 'M16 78 v-12 h14 v12', fill: wall })),
        sv('rect', { x: 20, y: 69, width: 6, height: 5, fill: win, stroke: INK, 'stroke-width': 1.4 }),
        sv('path', L({ d: 'M-26 78 v-26 M-26 52 h8', fill: 'none' })),
        sv('circle', { cx: -18, cy: 55, r: 3.2, fill: lit ? '#FFD76A' : '#E9E2D0', stroke: INK, 'stroke-width': 1.4 }));
      break;
    case 'chapel':
      add(sv('path', L({ d: 'M-22 78 v-30 l22 -16 l22 16 v30 z', fill: wall })),
        sv('path', L({ d: 'M-26 50 l26 -20 l26 20', fill: 'none', stroke: sketch ? INK : '#8A5224', 'stroke-width': 4 })),
        sv('path', L({ d: 'M-6 34 v-22 h12 v22', fill: wall })),
        sv('path', L({ d: 'M-9 13 l9 -14 l9 14 z', fill: paint('#6B3E75') })),
        sv('circle', { cx: 0, cy: 47, r: 6, fill: win, stroke: INK, 'stroke-width': 1.6 }),
        sv('path', L({ d: 'M-6 78 v-12 q6 -7 12 0 v12', fill: paint('#8A5224') })));
      break;
    case 'bandstand':
      add(sv('path', L({ d: 'M-30 78 h60 v-6 h-60 z', fill: paint('#D9C49A') })),
        sv('path', L({ d: 'M-24 72 v-26 M-8 72 v-26 M8 72 v-26 M24 72 v-26', fill: 'none' })),
        sv('path', L({ d: 'M-32 47 q32 -34 64 0 z', fill: paint('#2BB3A3') })),
        sv('path', L({ d: 'M0 22 v-12 l10 4 l-10 4', fill: paint('#F5C542') })),
        lit ? sv('path', { d: 'M-26 60 q26 8 52 0', fill: 'none', stroke: '#FFD76A', 'stroke-width': 2, 'stroke-dasharray': '1 4', ...round }) : null);
      break;
    case 'schoolhouse':
      add(sv('path', L({ d: 'M-34 78 v-28 h68 v28 z', fill: wall })),
        sv('path', L({ d: 'M-38 51 l38 -22 l38 22 z', fill: paint('#C8473A') })),
        sv('path', L({ d: 'M-6 32 v-12 h12 v12', fill: wall })),
        sv('path', L({ d: 'M-9 21 l9 -9 l9 9 z', fill: paint('#C8473A') })),
        sv('rect', { x: -26, y: 56, width: 10, height: 9, fill: win, stroke: INK, 'stroke-width': 1.5 }),
        sv('rect', { x: 16, y: 56, width: 10, height: 9, fill: win, stroke: INK, 'stroke-width': 1.5 }),
        sv('path', L({ d: 'M-5 78 v-13 h10 v13', fill: paint('#8A5224') })));
      break;
    default:
      add(sv('path', L({ d: 'M-24 78 v-26 h48 v26 z', fill: wall })),
        sv('path', L({ d: 'M-28 53 l28 -20 l28 20 z', fill: paint('#C8473A') })),
        sv('rect', { x: -6, y: 60, width: 12, height: 10, fill: win, stroke: INK, 'stroke-width': 1.5 }));
  }
  if (status === 'building' || status === 'current') {
    g.append(sv('path', { d: 'M-30 78 v-44 M30 78 v-44 M-30 40 h60 M-30 58 h60 M-30 40 l60 18', fill: 'none', stroke: '#8A5224',
      'stroke-width': 2.4, class: 'wk-scaffold', ...round }));
  }
  if (sketch) g.append(sv('text', { x: 0, y: 62, 'text-anchor': 'middle', class: 'wk-lm-q' }, '?'));
  return g;
}

/** A round tree of the village (two greens, a trunk). */
function tree(x, y, r) {
  return sv('g', { class: 'wk-tree' },
    sv('rect', { x: x - 1.6, y: y - 2, width: 3.2, height: 9, fill: '#7A4E2A' }),
    sv('circle', { cx: x, cy: y - r * 0.6, r, fill: '#5E9E3B', stroke: '#3F7A2A', 'stroke-width': 1.4 }),
    sv('circle', { cx: x - r * 0.3, cy: y - r * 0.95, r: r * 0.45, fill: '#7CC243' }));
}

/** A small cloud of two ellipses. */
function cloud(x, y, k) {
  return sv('g', { class: 'wk-cloud', opacity: 0.9 },
    sv('ellipse', { cx: x, cy: y, rx: 22 * k, ry: 7 * k, fill: '#FFFFFF' }),
    sv('ellipse', { cx: x + 10 * k, cy: y - 5 * k, rx: 12 * k, ry: 7 * k, fill: '#FFFFFF' }));
}

/**
 * The lots the strip draws (M2 has 24 projects: drawn all at once their names collide): the newest built ones, the
 * current one and the next few, at most `max`; `after` = the later ones left out (drawn as "+N more"). Pure.
 */
export function stripWindow(projects, max = 6) {
  if (projects.length <= max) return { list: projects, after: 0 };
  const cur = projects.findIndex((p) => p.status !== 'built');
  const at = cur < 0 ? projects.length : cur;
  const start = Math.max(0, Math.min(at - 2, projects.length - max));
  return { list: projects.slice(start, start + max), after: Math.max(0, projects.length - start - max) };
}

/** The village across the river: the live landmarks along the lane, built ones lit, the current one in scaffolding. */
export function villageStrip(projects, { more = 0 } = {}) {
  const n = Math.max(projects.length, 1);
  const w = 1000;
  const tail = more ? 110 : 0;
  const step = (w - 60 - tail) / n;
  const built = projects.filter((p) => p.status === 'built').length;
  const svg = sv('svg', { viewBox: `0 0 ${w} 132`, class: 'wk-village', role: 'img', preserveAspectRatio: 'xMidYMid meet',
    'aria-label': `The Hollow Village: ${built} of ${projects.length} projects built` });
  svg.append(
    sv('defs', {}, sv('linearGradient', { id: 'wk-river', x1: 0, y1: 0, x2: 0, y2: 1 },
      sv('stop', { offset: '0', 'stop-color': '#8FD3FF' }), sv('stop', { offset: '1', 'stop-color': '#4AA8E8' }))),
    cloud(w * 0.12, 18, 1), cloud(w * 0.55, 12, 0.8), cloud(w * 0.86, 22, 1.1),
    sv('path', { d: `M0 64 q${w * 0.15} -26 ${w * 0.3} -12 t${w * 0.35} -6 t${w * 0.35} 4 V96 H0 z`, fill: '#BFD9A0' }),
    sv('path', { d: `M0 72 q${w / 4} -12 ${w / 2} -4 t${w / 2} 2 V120 H0 z`, fill: '#9BD46A' }),
    sv('path', { d: `M0 88 q${w / 3} -6 ${w / 2} 0 t${w / 2} -2 V120 H0 z`, fill: '#7CC243' }),
    sv('path', { d: `M30 91 C ${w * 0.3} 85, ${w * 0.6} 95, ${w - 30} 89`, fill: 'none', stroke: '#E9D3A0', 'stroke-width': 7, ...round }),
    sv('path', { d: `M0 104 q${w / 4} -6 ${w / 2} 0 t${w / 2} 0 V132 H0 z`, fill: 'url(#wk-river)' }),
    sv('path', { d: `M10 112 h40 M${w * 0.3} 117 h50 M${w * 0.62} 110 h36 M${w - 70} 118 h44`, stroke: '#FFFFFF',
      'stroke-opacity': 0.55, 'stroke-width': 2, ...round }),
  );
  // trees between the lots, and at both ends
  for (let i = 0; i <= n; i++) {
    const x = 30 + i * step;
    svg.append(tree(x - 9, 86, 9), tree(x + 8, 89, 6.5));
  }
  projects.forEach((p, i) => {
    const x = 30 + step * (i + 0.5);
    const g = landmarkArt(p.id, p.status);
    g.setAttribute('transform', `translate(${x} 7)`);
    svg.append(g, sv('text', { x, y: 126, 'text-anchor': 'middle', class: `wk-lm-name s-${p.status}` },
      p.status === 'later' ? `Project ${p.n}` : p.name));
  });
  if (more) {
    const x = w - tail / 2 - 10;
    svg.append(sv('g', { class: 'wk-lm s-later' }, sv('path', L({ d: `M${x - 18} 85 v-22 h36 v22`, fill: 'none', 'stroke-dasharray': '4 4' })),
      sv('text', { x, y: 126, 'text-anchor': 'middle', class: 'wk-lm-name s-later' }, `+${more} more`)));
  }
  return svg;
}

// ---- the panel --------------------------------------------------------------------------------------------------

const OLLIE = {
  start: 'The village wants a hand, and I want an excuse to use my good saw. Bring what you can, a bit at a time.',
  coins: 'The goods are in. Now the timber merchant wants paying, then I can start on it.',
  building: 'Scaffolding\'s up. Give me a day and she\'ll be standing proud.',
  built: 'Done and dusted. Look at that across the river: you two did that.',
  waiting: 'Nothing on the drawing board just yet. I\'ll pin up the next one soon.',
  goods: 'I\'ve a plan for the next one, but I build with what you make. Show me a few kinds of goods first.',
  done: 'That\'s every project the village has asked for, for now. Fine work, the two of you.',
};

const STAGES = [['posted', 'Posted'], ['gather', 'Goods and coins'], ['building', 'Building'], ['built', 'Built']];

function ollieLine(v) {
  const c = v.cur;
  if (!c) return OLLIE[v.waiting] ?? OLLIE.waiting;
  if (c.stage === 'built') return OLLIE.built;
  if (c.stage === 'building') return OLLIE.building;
  return c.goodsDone ? OLLIE.coins : OLLIE.start;
}

export const townPanel = {
  title: 'The Hollow Village',
  icon: 'ferry_landing_souvenir',
  size: 'full',
  topics: ['town', 'inventory', 'overflow', 'wallet', 'xp', 'players', 'made'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const giveType = () => actionOf('townGive');
    const fundType = () => actionOf('townFund');
    const sig = () => {
      const st = ctx.store.state;
      const v = townView(st, ctx.store.pid, ctx.now());
      const c = v.cur;
      return [v.open, v.has, c && [c.id, c.stage, c.goods.map((g) => [g.given, g.have, g.by]), c.funded, c.fundedBy], v.built.length,
        v.waiting, Math.floor(st.farm.wallet.coins / 1000)];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = townView(st, ctx.store.pid, now);
      if (!v.open) {
        fill(body, lockedBody('e', 'The Hollow Village', [
          'Across the river lies a sleepy village. Ollie posts one project at a time.',
          'Donate goods the farm made and fund the work in coins; it is built the next day.',
          'Each project adds a landmark, 5 Acorns, a souvenir decor and a page in the Memory Book.',
        ], v.unlock, v.level, v.live));
        return;
      }
      const c = v.cur;
      const board = ctx.ui.panels.has('townsfolk')
        ? h('button.btn.btn--paper.btn--small.wk-board-link', { type: 'button', on: { click: () => ctx.ui.panels.open('townsfolk') } },
          svgIcon('letter', 20), 'The townsfolk board')
        : null;
      fill(body,
        banner('e', 'Across the river', v.pavilionTiers ? `Every Town Project built · the Festival Pavilion: ${v.pavilionTiers} `
          + `${v.pavilionTiers === 1 ? 'tier' : 'tiers'}` : `${v.built.length} of ${v.projects.length} Town Projects built · one at a time, built the day after`,
          { chip: board }),
        (() => { const sw = stripWindow(v.projects); return h('div.wk-village-wrap', villageStrip(sw.list, { more: sw.after + v.more })); })(),
        h('div.wk-town-cols',
          h('section.wk-col', speech('ollie', ollieLine(v), null, 64), c ? projectCard(st, v, c, now) : waitingCard(v)),
          h('aside.wk-col.wk-side', c ? rewardCard(c) : null, builtCard(v))));
      kit.refresh();
      kit.tick();
    }

    function stagesEl(c) {
      const at = c.stage === 'built' ? 3 : c.stage === 'building' ? 2 : 1;
      return h('ol.wk-stages', { 'aria-label': `Stage: ${STAGES[at][1]}` }, ...STAGES.map(([id, label], i) =>
        h(`li${i < at ? '.done' : i === at ? '.now' : ''}`, { dataset: { stage: id } },
          h('span.wk-stage-dot', i < at ? svgIcon('check', 14) : String(i + 1)), h('span', label))));
    }

    function goodRow(st, g) {
      const gT = giveType();
      const can = Math.min(g.left, g.have);
      const donors = Object.entries(g.by).sort(byPid)
        .map(([p, n]) => (st.players?.[p] ? h('span.wk-donor', playerMark(p, st.players[p]), fmt(n)) : null));
      return h(`div.wk-good${g.left <= 0 ? '.done' : ''}`, { dataset: { item: g.item } },
        hintable(icon(g.item, { size: 48 }), g.item, { need: g.left }),
        h('div.wk-good-text', h('b', g.name), h('span.wk-good-n', `${fmt(g.given)} / ${fmt(g.qty)}`),
          h('span.wk-good-bar', { style: { '--p': String(g.qty ? g.given / g.qty : 0) } }),
          h('span.wk-donors', ...donors, g.left > 0 ? h('small.wk-good-have', `${fmt(g.have)} in the barn`) : null)),
        g.left <= 0 ? h('span.wk-good-ok', svgIcon('check', 22))
          : h('div.wk-good-acts',
            kit.button({ label: 'Give 1', cls: 'btn--small btn--paper', key: `tg:${g.item}:1`, type: gT, args: { item: g.item, qty: 1 },
              hint: need(g.item, 1), data: { give: g.item } }),
            can > 1 ? kit.button({ label: `Give ${fmt(can)}`, cls: 'btn--small btn--sun', key: `tg:${g.item}:n`, type: gT,
              args: { item: g.item, qty: can } }) : null));
    }

    function fundEl(st, c) {
      const fT = fundType();
      const coins = st.farm.wallet.coins;
      const tenth = Math.max(1, Math.ceil(c.need / 10));
      const steps = [...new Set([Math.min(tenth, c.coinsLeft), Math.min(c.coinsLeft, coins)].filter((n) => n > 0))].sort((a, b) => a - b);
      const label = (n) => (n >= c.coinsLeft ? `Fund the rest (${fmtShort(n)})` : `Give ${fmtShort(n)}`);
      return h('div.wk-fund',
        h('div.wk-fund-head', svgIcon('coin', 26), h('b', 'Funding'), h('span', `${fmt(c.funded)} of ${fmt(c.need)} coins`)),
        h('span.wk-fund-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(c.need), 'aria-valuenow': String(c.funded),
          'aria-label': `${fmt(c.funded)} of ${fmt(c.need)} coins` },
        ...fundSegments(st, c).map((sg) => h('i', { style: { '--who': sg.color, '--w': String(sg.w) }, title: sg.title }))),
        c.coinsLeft > 0
          ? h('div.wk-fund-acts', ...steps.map((n, i) => kit.button({ label: label(n), cls: `btn--small ${i === steps.length - 1 ? 'btn--sun' : 'btn--paper'}`,
            key: `tf:${i}`, type: fT, args: { coins: n }, data: { fund: String(n) }, hint: { coins: Math.max(0, n - coins) } })),
          coins <= 0 ? h('small', 'The treasury is empty right now.') : null)
          : h('p.wk-fund-ok', svgIcon('check', 18), 'Fully funded'));
    }

    function projectCard(st, v, c, now) {
      const gathering = c.stage === 'gathering';
      const when = c.readyAt > now ? `Ready in ${leftText(c.readyAt, now)}`
        : c.stage === 'built' ? 'Look across the river tonight: it lights up.' : 'Starting first thing tomorrow.';
      return h('section.wk-project', { dataset: { project: c.id ?? '' } },
        h('header.wk-project-head', c.souvenir ? icon(c.souvenir, { size: 56 }) : null,
          h('div', h('small', `Town Project ${c.n} of ${v.projects.length + v.more}`), h('h3', c.name), c.text ? h('p', c.text) : null)),
        stagesEl(c),
        gathering ? null : h('div.wk-building', svgIcon('hammer', 30),
          h('div', h('b', c.stage === 'built' ? `${c.name} is finished!` : `Ollie is building the ${c.name}`), h('span', when))),
        gathering ? h('h4.wk-sub', 'Goods for the work', h('small', 'piece by piece, from either of you')) : null,
        gathering ? h('div.wk-goods', ...(c.goods.length ? c.goods.map((g) => goodRow(st, g)) : [h('p.wk-muted', 'Ollie is still writing the list.')]))
          : null,
        gathering ? fundEl(st, c) : null,
        Object.keys(v.donors).length ? donorsEl(st, v) : null);
    }

    function donorsEl(st, v) {
      return h('div.wk-donor-list', h('b', 'Given so far'), ...Object.entries(v.donors).sort(byPid).map(([p, d]) => {
        const pl = st.players?.[p];
        const what = [d.goods ? `${fmt(d.goods)} goods` : null, d.coins ? `${fmt(d.coins)} coins` : null].filter(Boolean).join(' · ');
        return h('span.wk-donor-row', pl ? playerMark(p, pl) : null, h('span', pl ? pl.name : 'A farmer'), h('small', what));
      }));
    }

    function rewardCard(c) {
      return h('section.wk-card.wk-reward', h('h3.pn-h', h('span', 'When it is built')),
        h('ul.wk-reward-list',
          h('li', svgIcon('acorn', 26), h('span', h('b', `${c.acorns} Acorns`), ' for the farm')),
          c.souvenir ? h('li', icon(c.souvenir, { size: 32 }), h('span', h('b', defOf(c.souvenir)?.name ?? 'A souvenir'), ' to place on the farm')) : null,
          h('li', svgIcon('book', 26), h('span', h('b', 'A Memory Book page'), ' of the two of you')),
          h('li', svgIcon('sun', 26), h('span', h('b', `The ${c.name}`), ' joins the village and lights up at night'))));
    }

    function waitingCard(v) {
      if (v.waiting === 'done') {
        return h('div.wk-empty', svgIcon('star', 44), h('p', 'Every project of this season is built.'),
          h('small', 'More of the village wakes up in a later update.'));
      }
      if (v.waiting === 'goods') {
        return h('div.wk-empty', svgIcon('hammer', 44), h('p', 'Ollie is waiting for the farm\'s goods.'),
          h('small', `He posts the next project once the farm has made ${v.need} kinds of crafted goods, animal goods or fruit `
            + `in the last 14 days (${v.made} so far).`));
      }
      return h('div.wk-empty', svgIcon('hammer', 44), h('p', 'Ollie will pin up the next project in a moment.'));
    }

    function builtCard(v) {
      return h('section.wk-card', h('h3.pn-h', h('span', 'Built together')),
        v.built.length ? h('ul.wk-built', ...v.built.map((b) => h('li', icon(b.souvenir, { size: 32 }), h('span', h('b', b.name), h('small', b.text)))))
          : h('p.wk-muted', `Nothing yet: the first landmark is the ${v.projects[0]?.name ?? 'Ferry Landing'}.`));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};
