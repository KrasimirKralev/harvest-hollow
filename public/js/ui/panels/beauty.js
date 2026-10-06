// Farm Beauty (GDD §5.9, §3.8, ui-collect lane): the meter in the HUD, the panel (score, stars, what each star
// brings, what counts and how to raise it) and the new-star banner.
//
//   beautyView(state, now) -> plain data (tested in node)    beautyPanel: the 'beauty' panel spec (wide)
//   beautyFlower(stars, size) -> SVG                         the meter's five-petal flower
//   mountBeautyMeter(ui, store) -> stop                       the HUD meter (from the Farm Beauty unlock level)
//   beautyBanners(ui, store) -> stop                          "Farm Beauty ★★★": a new star was paid
//
// Every number comes from the rules (rules-economy, shared/rules/actions/beauty.js): beautyOf(state, now) is the live
// score the farm sees while placing; beautyOf(..., { settledOnly }) is the one stars and the order bonus pay on
// (objects past their 10-minute undo receipt); farm.beauty.stars are the stars already paid (3 Acorns each, once).
import { CONTENT, FARM_BEAUTY, MASTERWORK, defOf, live, isLive } from '../../../../shared/content/index.js';
import * as beautyA from '../../../../shared/rules/actions/beauty.js';
import { levelOf } from './model.js';
import { h, fmt, fmtDuration, createKit, icon, svgIcon, phoneTitle } from './kit.js';
import { s } from './art.js';
import { t, onLang, fmtDec, name as cname } from '../../i18n/index.js';
import { tParts } from './kit.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** Score, stars (live, settled, paid), the next threshold, the effects, the breakdown and ideas. Pure. */
export function beautyView(state, now = Infinity) {
  const F = FARM_BEAUTY;
  const level = levelOf(state);
  const b = beautyA.beautyOf(state, now);
  const settled = Number.isFinite(now) ? beautyA.beautyOf(state, now, { settledOnly: true }) : b;
  const paid = own(state.farm.beauty, 'stars') ?? 0;
  const prev = b.stars > 0 ? F.stars[b.stars - 1] : 0;
  // how far the score is between the last star and the next one (0..1; 1 at five stars)
  const within = b.next ? Math.max(0, Math.min(1, (b.score - prev) / Math.max(1, b.next - prev))) : 1;
  // when a fresh piece's undo receipt runs out, the settled score (stars, order bonus) catches up with the live one
  const settleAt = settled.stars < b.stars && Number.isFinite(now) ? beautyA.beautyNextAt(state, now) : Infinity;
  const inSet = new Map(b.groups.flatMap((g) => g.ids.map((id) => [id, g.set])));
  const top = Object.entries(b.byId).sort(([ia, a], [ib, c]) => c - a || (ia < ib ? -1 : 1))
    .slice(0, 6).map(([id, v]) => {
    const o = state.farm.objects[id];
    return { id, def: o.def, name: defOf(o.def) ? cname(o.def) : o.def, value: v / 10, mw: o.mw ?? 0,
      set: inSet.get(id) ?? null };
  });
  const open = beautyA.beautyLive(state);
  return {
    open, unlock: F.unlock, score: b.score, stars: b.stars, settledStars: settled.stars, paid, maxStars: F.stars.length,
    next: b.next, prev, toNext: b.next ? b.next - b.score : 0,
    pct: within, track: (b.stars + (b.next ? within : 0)) / F.stars.length,
    thresholds: F.stars, orderBonusPct: open && Number.isFinite(now) ? beautyA.beautyOrderBp(state, now) / 100 : 0,
    perStarPct: F.orderCoinsBpPerStar / 100, starAcorns: F.starAcorns,
    settleIn: Number.isFinite(settleAt) ? Math.max(0, settleAt - now) : null,
    parts: b.parts,
      groups: b.groups.map((g) => ({ set: g.set, name: CONTENT.decorSets.get(g.set) ? cname(g.set, { family: 'decorSets' }) : g.set, n: g.ids.length })),
    top, decorCount: Object.keys(b.byId).length,
    showcase: b.stars >= F.stars.length ? Math.max(0, b.score - F.stars.at(-1)) : 0,
    ideas: ideas(state, b, level),
  };
}

/** Up to three ways to raise the score, the most direct first. Pure. */
function ideas(state, b, level) {
  const out = [];
  const owned = new Set(Object.keys(b.byId).map((id) => state.farm.objects[id].def));
  const sets = [...CONTENT.decorSets.values()].filter((st) => isLive(st) && level >= st.unlock && !b.groups.some((g) => g.set === st.id));
  const close = sets.map((st) => ({ st, n: st.pieces.filter((d) => owned.has(d)).length })).filter((x) => x.n > 0)
    .sort((x, y) => y.n / y.st.pieces.length - x.n / x.st.pieces.length)[0];
  if (close) {
    const p = { set: cname(close.st.id, { family: 'decorSets' }), r: close.st.radius, pct: FARM_BEAUTY.setBp / 100, n: close.n, total: close.st.pieces.length };
    out.push({ kind: 'set', set: close.st.id, text: close.n === close.st.pieces.length ? t('collect.beauty.idea.setAll', p) : t('collect.beauty.idea.set', p) });
  }
  const fresh = live('decor').filter((d) => d.shop && d.tier === 'coin' && (d.unlock ?? 1) <= level && !owned.has(d.id) && d.beauty10 > 0 && d.cost > 0)
    .sort((x, y) => (y.beauty10 / y.cost) - (x.beauty10 / x.cost))[0];
  if (fresh) out.push({ kind: 'buy', def: fresh.id,
    text: t('collect.beauty.idea.buy', { name: cname(fresh.id), b: fmt(fresh.beauty10 / 10) }) });
  if (level >= MASTERWORK.unlock && isLive(MASTERWORK)) {
    const best = Object.keys(b.byId).map((id) => ({ id, o: state.farm.objects[id] }))
      .filter((x) => (x.o.mw ?? 0) < MASTERWORK.priceMul.length && defOf(x.o.def)?.tier === 'coin' && defOf(x.o.def)?.cost > 0)
      .sort((x, y) => b.byId[y.id] - b.byId[x.id] || (x.id < y.id ? -1 : 1))[0];
    if (best) out.push({ kind: 'masterwork', id: best.id,
      text: t('collect.beauty.idea.mw', { name: cname(best.o.def), x: best.o.mw ? '×2' : `×${fmtDec(1.5)}` }) });
  }
  out.push({ kind: 'path', text: t('collect.beauty.idea.path') });
  return out.slice(0, 3);
}

// ---- art ------------------------------------------------------------------------------------------------------------

const INK = '#3E2612';
/** The meter's flower: five petals that colour in with the stars earned. */
export function beautyFlower(stars, size = 40) {
  const svg = s('svg',
    { viewBox: '0 0 48 48', width: size, height: size, class: 'pc-flower', 'aria-hidden': 'true', focusable: 'false' });
  for (let i = 0; i < 5; i++) {
    const a = ((i * 72) - 90) * Math.PI / 180;
    const x = (24 + Math.cos(a) * 12).toFixed(1);
    const y = (24 + Math.sin(a) * 12).toFixed(1);
    svg.append(s('ellipse', { cx: x, cy: y, rx: 8.2, ry: 10.5, transform: `rotate(${i * 72} ${x} ${y})`,
      fill: i < stars ? '#FF8FB1' : '#F6EBDA', stroke: INK, 'stroke-width': 2 }));
    if (i < stars) svg.append(s('ellipse',
      { cx: x, cy: y, rx: 3, ry: 5, transform: `rotate(${i * 72} ${x} ${y})`, fill: '#FFC2D4' }));
  }
  svg.append(s('circle', { cx: 24, cy: 24, r: 7.5, fill: '#FFC83D', stroke: INK, 'stroke-width': 2 }),
    s('path', { d: 'M20 21 q2 -3 5 -3', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.7, 'stroke-width': 2,
      'stroke-linecap': 'round' }));
  return svg;
}

function starRow(n, max) {
  return h('span.pc-stars', { role: 'img', 'aria-label': t('collect.beauty.starsAria', { n, max }) },
    ...Array.from({ length: max }, (_, i) => h(`span.pc-star${i < n ? '.on' : ''}`, { 'aria-hidden': 'true' }, '★')));
}

// ---- the panel ------------------------------------------------------------------------------------------------------

/** The table's rows: [part, label, icon, tip], the words read in the language in effect. */
const PARTS_ICON = [['decor', 'flower_bed'], ['buildings', 'bakery'], ['trees', 'apple_tree'], ['perks', 'butterflies_display']];
const parts = () => PARTS_ICON.map(([k, ic]) => [k, t(`collect.beauty.part.${k}`), ic,
  t(`collect.beauty.partTip.${k}`, { n: k === 'buildings' ? FARM_BEAUTY.building : FARM_BEAUTY.tree })]);

export const beautyPanel = {
  get title() { return phoneTitle('collect.beauty.title', 'collect.beauty.titleShort'); },
  icon: 'flower_bed',
  size: 'wide',
  topics: ['objects', 'xp', 'beauty', 'album'],
  mount(body, ctx) {
    // a panel opens at its top (the shell keeps the scroll box between openings; the frame is still hidden while it
    // mounts, so the reset waits a frame); a focus scrolls on its own
    const box = body.closest('.hh-panel-scroll');
    if (box && !ctx.args?.set && !ctx.args?.id) requestAnimationFrame(() => { box.scrollTop = 0; });
    const kit = createKit(ctx);
    const view = () => beautyView(ctx.store.state, ctx.now());
    const sig = () => { const v = view(); return [v.open, v.score, v.stars, v.settledStars, v.paid, v.parts,
      v.top.map((p) => [p.id, p.value]), v.ideas.map((i) => i.text), Math.ceil((v.settleIn ?? 0) / 60_000)]; };
    const update = kit.memo(body, sig, render);
    ctx.every(15_000, () => update());
    function render() {
      const v = view();
      const track = h('div.pc-btrack', { role: 'progressbar', 'aria-label': t('collect.beauty.trackAria'), 'aria-valuemin': '0',
        'aria-valuemax': String(v.thresholds.at(-1)), 'aria-valuenow': String(v.score),
          'aria-valuetext': t('collect.beauty.valueText', { score: v.score, stars: v.stars }) },
      h('span.pc-btrack-fill', { style: { '--p': String(v.track) } }),
      ...v.thresholds.map((th, i) => h(`span.pc-btrack-star${v.score >= th ? '.on' : ''}`,
        { style: { '--at': String((i + 1) / v.maxStars) }, title: t('collect.beauty.starAt', { i: i + 1, at: th }) },
        h('b', { 'aria-hidden': 'true' }, '★'), h('small', fmt(th)))));
      const settleNote = v.settleIn !== null
        ? h('p.pc-bsettle', svgIcon('sun', 20),
          t('collect.beauty.settle', { n: v.settledStars + 1, d: fmtDuration(v.settleIn, { cut: 's' }) })) : null;
      const hero = h('header.pc-bhero',
        h('div.pc-bscore', beautyFlower(v.stars, 88),
          h('div.pc-bscore-text', h('b', fmt(v.score)), h('span', t('collect.beauty.label')), starRow(v.stars, v.maxStars))),
        h('div.pc-bhero-main', track,
          h('p.pc-bnext', !v.open
            ? [tParts('collect.beauty.lockedLine', { unlock: v.unlock, b: h('b', t('collect.album.acorns', { n: v.starAcorns })), pct: v.perStarPct }),
              v.stars ? t('collect.beauty.wouldHave', { n: v.stars }) : t('collect.beauty.beReady')]
            : v.next ? tParts('collect.beauty.next', { more: v.toNext, n: v.stars + 1, b: h('b', t('collect.beauty.plusAcorns', { n: v.starAcorns })), pct: v.perStarPct })
              : t('collect.beauty.allStars')), v.open ? settleNote : null));
      const effects = h('section.pc-beffects', h('h3.pn-h', h('span', t('collect.beauty.does'))),
        h('ul.pc-bfx',
          h(`li${v.orderBonusPct ? '.on' : ''}`, svgIcon('coin', 28),
            h('div', h('b', v.orderBonusPct ? t('collect.beauty.ordersPay', { pct: v.orderBonusPct }) : t('collect.beauty.ordersMore')),
            h('small', t('collect.beauty.perStar', { per: v.perStarPct, max: v.maxStars * v.perStarPct })))),
          h(`li${v.paid ? '.on' : ''}`, svgIcon('acorn', 28),
            h('div', h('b', t('collect.beauty.acornsEach', { n: v.starAcorns })),
            h('small', v.paid ? t('collect.beauty.paid', { n: v.paid }) : t('collect.beauty.paidOnce')))),
          h(`li${v.stars ? '.on' : ''}`, svgIcon('flower', 28),
            h('div', h('b', t('collect.beauty.livelier')),
              h('small', t('collect.beauty.livelierTip'))))),
        v.groups.length ? h('p.pc-bsets', svgIcon('star', 20),
          t('collect.beauty.sets', { list: v.groups.map((g) => g.name).join(', '), pct: FARM_BEAUTY.setBp / 100 })) : null);
      const partsEl = h('section.pc-bparts', h('h3.pn-h', h('span', t('collect.beauty.counts'))),
        h('table.pc-btable', h('tbody', ...parts().map(([k, label, ic, tip]) => h('tr', { dataset: { part: k } },
          h('td', icon(ic, { size: 30 })), h('td', h('b', label), h('small', tip)),
          h('td.num', (v.parts[k] ?? 0) > 0 ? `+${fmt(v.parts[k])}` : '0'))),
        h('tr.total', h('td'), h('td', h('b', t('collect.beauty.title'))), h('td.num', h('b', fmt(v.score)))))));
      const best = v.top.length ? h('section.pc-btop', h('h3.pn-h', h('span', t('collect.beauty.prettiest'))),
        h('div.pc-btop-list',
          ...v.top.map((p) => h('div.pc-btop-item', { dataset: { id: p.id } }, icon(p.def, { size: 46 }),
            h('b', p.name),
          h('small', `+${fmt(Math.round(p.value * 10) / 10)}${p.mw ? ` · ${'✦'.repeat(p.mw)}` : ''}${p.set ? t('collect.beauty.inSet') : ''}`))))) : null;
      const tips = v.ideas.length ? h('section.pc-bideas', h('h3.pn-h', h('span', t('collect.beauty.ideas'))),
        h('ul', ...v.ideas.map((i) => h('li',
          svgIcon({ buy: 'plus', path: 'sprout', set: 'star', masterwork: 'hammer' }[i.kind] ?? 'star', 22),
            h('span', i.text))))) : null;
      const foot = h('div.pc-bfoot',
        ctx.ui.panels.has('market') ? h('button.btn.btn--sun.pn-sm',
          { type: 'button', on: { click: () => ctx.ui.panels.open('market', { tab: 'decor' }) } },
            svgIcon('flower', 22), t('collect.beauty.buy')) : null,
        h('button.btn.btn--sky.pn-sm', { type: 'button', on: { click: () => ctx.open('decorsets') } },
          svgIcon('star', 22), t('collect.sets.title')));
      body.replaceChildren(...[
        v.open ? null : h('p.pn-intro.pc-locked', svgIcon('lock', 20), t('collect.beauty.countsFrom', { n: v.unlock })),
        hero, h('div.pc-bgrid', h('div', effects, partsEl), h('div', best, tips)), foot].filter(Boolean));
      kit.refresh();
    }
    update(true);
    return { update: () => update() };
  },
};

// ---- the HUD meter --------------------------------------------------------------------------------------------------

/**
 * The Farm Beauty meter: a flower badge at the top of the right-hand column (above zoom and rotate), the petals
 * coloured by the stars earned, the score under it and a bar to the next star; a click opens the panel. It sits in its
 * own slot so it never crowds the treasury pills or the portraits at 1280 px. Shown from the Farm Beauty level; it
 * blooms when a star is earned.
 */
export function mountBeautyMeter(ui, store) {
  if (typeof document === 'undefined') return () => {};
  const host = document.getElementById('hud');
  if (!host || document.getElementById('hud-beauty')) return () => {};
  const fill = h('span.pc-meter-fill');
  const num = h('b.pc-meter-num', '0');
  const flower = h('span.pc-meter-flower');
  const stars = h('span.pc-meter-stars');
  const btn = h('button.pc-meter#hud-beauty',
    { type: 'button', hidden: true, 'data-tip': t('collect.beauty.meterTip'),
    on: { click: () => ui.panels.toggle('beauty') } },
  flower, h('span.pc-meter-body', num, h('span.pc-meter-bar', fill)), stars);
  host.append(btn);
  let last = null;
  let timer = 0;
  const paint = () => {
    timer = 0;
    const st = store.state;
    if (!st) return;
    let v;
    try { v = beautyView(st, store.now()); } catch (err) { console.error('beauty meter', err); return; }
    btn.hidden = !v.open;
    if (!v.open) return;
    const key = `${v.score}|${v.stars}`;
    if (key === last) return;
    const grew = last !== null && Number(last.split('|')[1]) < v.stars;
    last = key;
    num.textContent = fmt(v.score);
    flower.replaceChildren(beautyFlower(v.stars, 44));
    stars.textContent = `★ ${v.stars}/${v.maxStars}`;
    fill.style.setProperty('--p', String(v.pct));
    btn.setAttribute('aria-label', v.next ? t('collect.beauty.meterAriaNext', { score: v.score, stars: v.stars, max: v.maxStars, left: v.toNext })
      : t('collect.beauty.meterAria', { score: v.score, stars: v.stars, max: v.maxStars }));
    if (grew) { btn.classList.remove('bloom'); void btn.offsetWidth; btn.classList.add('bloom'); }
  };
  const later = () => { if (!timer) timer = setTimeout(paint, 250); };
  const offs = [store.subscribe?.('objects', later), store.subscribe?.('xp', later),
    store.subscribe?.('beauty', later), store.on('welcome', later)];
  const tick = setInterval(later, 60_000);                   // receipts settle with time alone
  // a language switch: the tip and the spoken label in the new words
  const offLang = onLang(() => { btn.dataset.tip = t('collect.beauty.meterTip'); last = null; paint(); });
  paint();
  return () => { for (const f of offs) f?.(); offLang(); clearTimeout(timer); clearInterval(tick); btn.remove(); };
}

// ---- the new-star banner --------------------------------------------------------------------------------------------

/** `beautyStar` { stars, from, score, acorns } is a system event: both screens get it from the delta. */
export function beautyBanners(ui, store) {
  const off = store.on('fx', ({ ev }) => {
    if (!ev || ev.e !== 'beautyStar') return;
    const n = ev.stars ?? 0;
    const gained = Math.max(1, n - (ev.from ?? n - 1));
    ui.banner({ id: `beauty-${n}`, kind: 'golden', ribbon: t('collect.beauty.ribbon', { stars: '★'.repeat(Math.max(1, Math.min(5, n))) }),
      message: t('collect.beauty.newStar', { n: gained, a: ev.acorns ?? FARM_BEAUTY.starAcorns, pct: Math.min(5, n) * FARM_BEAUTY.orderCoinsBpPerStar / 100 }),
      things: [], ttl: 9000, actions: [{ label: t('collect.beauty.seeWhy'), kind: 'sky', fn: () => ui.panels.open('beauty') }] });
    const btn = typeof document !== 'undefined' ? document.getElementById('hud-beauty') : null;
    if (btn) { btn.classList.remove('bloom'); void btn.offsetWidth; btn.classList.add('bloom'); }
  });
  const off2 = store.on('fx', ({ ev }) => {
    if (!ev || ev.e !== 'decorSet') return;
    const set = CONTENT.decorSets.get(ev.set);
    if (!set) return;
    ui.banner({ id: `decorset-${ev.set}`, kind: 'quest', ribbon: () => t('collect.beauty.setDone', { set: cname(set.id, { family: 'decorSets' }) }),
      message: t('collect.beauty.setDoneText', { n: set.pieces.length, pct: FARM_BEAUTY.setBp / 100 }),
      things: set.pieces.slice(0, 5).map((d) => ({ icon: d, name: () => (defOf(d) ? cname(d) : d) })), ttl: 9000,
      actions: [{ label: t('collect.beauty.seeSet'), kind: 'sky', fn: () => ui.panels.open('decorsets', { set: ev.set }) }] });
  });
  return () => { off?.(); off2?.(); };
}
