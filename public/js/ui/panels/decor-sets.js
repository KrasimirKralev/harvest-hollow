// Decor sets and Masterwork (GDD §3.8, §5.9, ui-collect lane): the set view (each themed set, which pieces the farm
// has, where they stand and whether they are close enough for the +25 % set bonus and its cosmetic) and the
// Masterwork workshop (every coin decor upgrades twice, for 4 x and 16 x its price, to 1.5 x / 2 x beauty).
//
//   setsView(state) -> plain data          masterworkView(state) -> plain data   (both tested in node)
//   setOfDecor(defId) -> [set]             the live sets a decor belongs to (the shop's "part of a set" tag)
//   decorSetsPanel: the 'decorsets' panel spec (full; args { tab?, set?, id? }; id = a placed decor -> Masterwork)
//
// Rules (rules-economy, shared/rules/actions/beauty.js): beautyOf().groups (complete set groups: one copy of each piece
// within `radius` of every other), masterworkPrice(state, o), action masterwork { id, max } (max = the price shown),
// object field `mw` (0..2).
import { CONTENT, MASTERWORK, FARM_BEAUTY, defOf, isLive, decorOf } from '../../../../shared/content/index.js';
import * as beautyA from '../../../../shared/rules/actions/beauty.js';
import { levelOf } from './model.js';
import { startPlacement } from './placement.js';
import { h, fmt, createKit, pill, icon, svgIcon, price } from './kit.js';
import { s } from './art.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const COSMETIC = Object.freeze({ butterflies: 'Butterflies dance around it',
  bunting: 'Festive bunting strings itself up',
  lanterns: 'Lanterns glow at dusk', gulls: 'Gulls call over it', music: 'A music box tinkles' });

/** The live sets a decor def belongs to (shop tag, tooltips). */
export function setOfDecor(defId) {
  return [...CONTENT.decorSets.values()].filter((st) => isLive(st) && st.pieces.includes(defId));
}

/** How a piece the farm does not own can be had. */
function source(def, level) {
  if (!def) return { kind: 'none', text: 'Not in this chapter' };
  if (!isLive(def)) return { kind: 'later', text: 'Arrives in a later chapter' };
  if ((def.unlock ?? 1) > level) return { kind: 'locked', text: `Unlocks at level ${def.unlock}` };
  if (def.shop && def.acorns > 0) return { kind: 'acorns', text: `${def.acorns} Acorns`, acorns: def.acorns };
  if (def.shop) return { kind: 'coins', text: `${fmt(def.cost)} coins`, coins: def.cost };
  const src = String(def.source ?? '');
  if (src.startsWith('daily:28:')) return { kind: 'reward', text: `The Daily Gift's day 28 in ${src.split(':')[2]}` };
  if (src.startsWith('quest:')) return { kind: 'reward', text: 'A letter reward' };
  if (src === 'challenge') return { kind: 'reward', text: 'A Couple Challenge prize' };
  return { kind: 'reward', text: 'Earned in play' };
}

/** Every live set: pieces (placed / in the tray / to get), its complete group(s), the mini plan's points. Pure. */
export function setsView(state, now = Infinity, { sets = [...CONTENT.decorSets.values()].filter(isLive) } = {}) {
  const level = levelOf(state);
  const objs = state.farm.objects;
  const ids = Object.keys(objs).sort();
  const groups = beautyA.beautyOf(state, now).groups;
  const rows = sets.map((st) => {
    const mine = groups.filter((g) => g.set === st.id);
    const grouped = new Set(mine.flatMap((g) => g.ids));
    const pieces = st.pieces.map((d) => {
      const def = decorOf(d) ?? defOf(d);
      const placed = ids.filter((id) => objs[id].def === d && Number.isSafeInteger(objs[id].x));
      return { def: d, name: def?.name ?? d, placed: placed.length, tray: own(state.farm.storage, d) ?? 0,
        inGroup: placed.find((id) => grouped.has(id)) ?? null, source: source(def, level),
          beauty: (def?.beauty10 ?? 0) / 10,
        at: placed.map((id) => [objs[id].x, objs[id].z, grouped.has(id)]) };
    });
    const have = pieces.filter((p) => p.placed > 0).length;
    const complete = mine.length > 0;
    const open = level >= st.unlock && isLive(st);
    // "spread" only once sets count (before their level a close group is not complete either)
    const status = complete ? 'complete' : have === pieces.length && open ? 'spread'
      : pieces.some((p) => p.placed || p.tray) ? 'started' : 'new';
    // the plan's anchor: the complete group's first piece, else the rarest piece's first copy
    const rare = pieces.filter((p) => p.placed > 0).sort((a, b) => a.placed - b.placed)[0] ?? null;
    const first = mine[0]?.ids.map((id) => objs[id]).sort((a, b) => a.x - b.x || a.z - b.z)[0]
      ?? (rare ? { x: rare.at[0][0], z: rare.at[0][1] } : null);
    // one dot per piece on the plan: the copy in the group, else the copy nearest the anchor
    for (const p of pieces) {
      const near = first ? p.at.slice().sort((a, b) => Math.max(Math.abs(a[0] - first.x), Math.abs(a[1] - first.z))
        - Math.max(Math.abs(b[0] - first.x), Math.abs(b[1] - first.z)))[0] : p.at[0];
      p.dot = p.at.find((a) => a[2]) ?? near ?? null;
    }
    return { id: st.id, name: st.name, unlock: st.unlock, radius: st.radius, cosmetic: st.cosmetic,
      cosmeticText: COSMETIC[st.cosmetic] ?? 'A little extra magic',
      pieces, have, total: pieces.length, complete, groups: mine.length, status, open,
      bonusPct: FARM_BEAUTY.setBp / 100, firstAt: own(state.farm.beauty?.sets, st.id) ?? null,
      anchor: first ? [first.x, first.z] : null };
  });
  const later = [...CONTENT.decorSets.values()].filter((st) => !sets.includes(st)).map((st) => st.name);
  return { sets: rows, later, unlock: rows.length ? Math.min(...rows.map((x) => x.unlock)) : 18,
    open: rows.some((x) => x.open) };
}

/** Every placed coin decor with its Masterwork level, the next upgrade's price (the rules' masterworkPrice). Pure. */
export function masterworkView(state) {
  const level = levelOf(state);
  const objs = state.farm.objects;
  const rows = [];
  for (const id of Object.keys(objs).sort()) {
    const o = objs[id];
    const def = defOf(o.def);
    if (!def || def.kind !== 'decor' || def.tier !== 'coin' || !(def.cost > 0) || !Number.isSafeInteger(o.x)) continue;
    const mw = Math.max(0, Math.min(MASTERWORK.priceMul.length, o.mw ?? 0));
    const beauty = (def.beauty10 * (mw ? MASTERWORK.beautyBp[mw - 1] : 10_000)) / 100_000;
    const p = beautyA.masterworkPrice(state, o);
    const next = mw < MASTERWORK.priceMul.length
      ? { level: mw + 1, coins: p.code ? def.cost * MASTERWORK.priceMul[mw] : p.coins,
        beauty: (def.beauty10 * MASTERWORK.beautyBp[mw]) / 100_000, code: p.code ?? null }
      : null;
    rows.push({ id, def: def.id, name: def.name, mw, beauty, next, x: o.x, z: o.z,
      sets: setOfDecor(def.id).map((x) => x.name) });
  }
  rows.sort((a, b) => b.beauty - a.beauty || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { rows, open: level >= MASTERWORK.unlock && isLive(MASTERWORK), unlock: MASTERWORK.unlock,
    mul: MASTERWORK.priceMul,
    beautyMul: MASTERWORK.beautyBp.map((b) => b / 10_000) };
}

const MW_NAMES = ['Plain', 'Masterwork', 'Grand Masterwork'];

// ---- the mini plan of a set -----------------------------------------------------------------------------------------

/** A tiny map: each placed piece as a dot, the set's reach (radius tiles around the first piece) as a dashed square. */
function plan(set) {
  const pts = set.pieces.map((p, i) => (p.dot ? { x: p.dot[0], z: p.dot[1], i, inGroup: p.dot[2] } : null))
    .filter(Boolean);
  const svg = s('svg', { viewBox: '0 0 120 120', width: 120, height: 120, class: 'pc-plan', role: 'img',
    'aria-label': pts.length ? `Where the ${set.name} pieces stand` : `No ${set.name} pieces placed yet` });
  svg.append(s('rect',
    { x: 1, y: 1, width: 118, height: 118, rx: 10, fill: '#CFE8A8', stroke: '#8A5224', 'stroke-width': 2 }));
  for (let k = 1; k < 6; k++) svg.append(s('path',
    { d: `M${k * 20} 4 V116 M4 ${k * 20} H116`, stroke: 'rgba(90,140,50,.25)', 'stroke-width': 1 }));
  if (!pts.length) {
    const t = s('text', { x: 60, y: 64, 'text-anchor': 'middle', class: 'pc-plan-empty' });
    t.textContent = 'nothing placed';
    svg.append(t);
    return svg;
  }
  const cx = set.anchor ? set.anchor[0] : pts[0].x;
  const cz = set.anchor ? set.anchor[1] : pts[0].z;
  const span = Math.max(set.radius + 2, ...pts.map((p) => Math.max(Math.abs(p.x - cx), Math.abs(p.z - cz)) + 1));
  const k = 54 / span;
  const X = (x) => 60 + (x - cx) * k;
  const Z = (z) => 60 + (z - cz) * k;
  svg.append(s('rect',
    { x: X(cx - set.radius), y: Z(cz - set.radius), width: (set.radius * 2 + 1) * k, height: (set.radius * 2 + 1) * k,
    fill: set.complete ? 'rgba(255,216,74,.25)' : 'rgba(255,255,255,.35)',
      stroke: set.complete ? '#E3A21E' : '#5C3B1E', 'stroke-width': 1.6, 'stroke-dasharray': '4 3', rx: 4 }));
  const colours = ['#E8556E', '#4AA8E8', '#FFC83D', '#9B6BD6', '#5DBB3F', '#F28A1E'];
  for (const p of pts) svg.append(s('circle',
    { cx: X(p.x + 0.5).toFixed(1), cy: Z(p.z + 0.5).toFixed(1), r: 5, fill: colours[p.i % colours.length],
      stroke: '#3E2612', 'stroke-width': p.inGroup ? 2.4 : 1.4 }));
  return svg;
}

// ---- the panel ------------------------------------------------------------------------------------------------------

function pieceRow(ctx, kit, set, p, i) {
  const colours = ['#E8556E', '#4AA8E8', '#FFC83D', '#9B6BD6', '#5DBB3F', '#F28A1E'];
  let act = null;
  if (p.tray > 0) act = kit.button({ label: 'Place', glyph: 'hammer', cls: 'pn-xs btn--sky',
    onClick: () => startPlacement(ctx, p.def), data: { place: p.def } });
  else if (!p.placed && (p.source.kind === 'coins' || p.source.kind === 'acorns')) {
    act = kit.button({ label: 'Buy', glyph: 'hammer', cls: 'pn-xs', data: { place: p.def },
      gate: () => {
        const st = ctx.store.state;
        if (p.source.coins > st.farm.wallet.coins) return { code: 'NO_COINS',
          hint: { coins: p.source.coins - st.farm.wallet.coins } };
        if (p.source.acorns > st.farm.wallet.acorns) return { code: 'NO_ACORNS',
          hint: { acorns: p.source.acorns - st.farm.wallet.acorns } };
        return { code: null };
      },
      onClick: () => startPlacement(ctx, p.def) });
  }
  const state = p.placed ? (p.inGroup ? 'In the set' : `Placed${p.placed > 1 ? ` ×${p.placed}` : ''}`) : p.tray ? 'In your tray' : p.source.text;
  const buyable = !p.placed && !p.tray && (p.source.kind === 'coins' || p.source.kind === 'acorns');
  return h(`li.pc-piece${p.placed ? '.have' : ''}${p.inGroup ? '.grouped' : ''}`, { dataset: { def: p.def } },
    h('span.pc-piece-dot', { style: { '--c': colours[i % colours.length] }, 'aria-hidden': 'true' }),
    icon(p.def, { size: 44, alt: '' }),
    h('span.pc-piece-main', h('b', p.name), h('small', state)),
    h('span.pc-piece-act',
      p.placed ? h('span.pc-piece-tick', { 'aria-label': 'on the farm' }, '✓') : null,
      buyable ? price({ coins: p.source.coins ?? 0, acorns: p.source.acorns ?? 0 }) : null,
      p.placed ? null : act));
}

/**
 * "Place this set" (client lane: controller.placeSet(setId) opens build mode for the next missing piece and follows
 * with the next after each placement, the pieces already out glowing). Offered while a piece can still be bought or
 * placed from the tray.
 */
function placeSetButton(ctx, set) {
  const c = ctx.controller;
  if (!c || typeof c.placeSet !== 'function' || set.complete || !set.open) return null;
  const missing = set.pieces.filter((p) => !p.placed);
  const can = missing.some((p) => p.tray > 0 || p.source.kind === 'coins' || p.source.kind === 'acorns');
  if (!can) return null;
  return h('div.pc-set-acts', h('button.btn.btn--sky.pn-sm', { type: 'button', dataset: { placeset: set.id },
    on: { click: () => { ctx.close(); c.placeSet(set.id); } } }, svgIcon('hammer', 22),
      missing.length === set.pieces.length ? 'Place this set' : 'Place the rest'),
  h('small', `One piece after the other, each close to the ones already out.`));
}

function setCard(ctx, kit, set) {
  const status = {
    complete: [`Complete: +${set.bonusPct} % on its ${set.total} pieces`, 'pn-owned'],
    spread: [`All ${set.total} placed: move them within ${set.radius} tiles of each other`, 'pn-warn'],
    started: [`${set.have} of ${set.total} on the farm`, ''],
    new: ['Not started', ''],
  }[set.status];
  return h(`article.pc-set.${set.status}${set.open ? '' : '.locked'}`, { dataset: { set: set.id } },
    h('header.pc-set-head', h('div', h('h4', set.name), h('small', set.cosmeticText)), pill(status[0], status[1])),
    h('div.pc-set-body', h('figure.pc-plan-box', plan(set), h('figcaption', `dashed: ${set.radius}-tile reach`)),
      h('ul.pc-pieces', ...set.pieces.map((p, i) => pieceRow(ctx, kit, set, p, i)))),
    placeSetButton(ctx, set),
    h('p.pc-set-foot',
      set.complete ? `Its ${set.total} pieces count ${set.bonusPct} % more beauty, and ${set.cosmeticText.toLowerCase()}.`
      : `Place one of each within ${set.radius} tiles of the first piece: +${set.bonusPct} % beauty on all ${set.total}, and ${set.cosmeticText.toLowerCase()}.`));
}

/** Masterwork rows grouped by decor kind (most beautiful kind first; upgraded copies first inside a kind). Pure. */
export function mwGroups(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.def)) by.set(r.def, { def: r.def, name: r.name, sets: r.sets, copies: [] });
    by.get(r.def).copies.push(r);
  }
  const out = [...by.values()];
  for (const g of out) {
    g.copies.sort((a, b) => b.mw - a.mw || a.id.localeCompare(b.id));
    g.best = Math.max(...g.copies.map((c) => c.beauty));
  }
  return out.sort((a, b) => b.best - a.best || a.name.localeCompare(b.name));
}

const SHOWN = 3;

function mwCopy(ctx, kit, r, k, focus, single = false) {
  const stars = h('span.pc-mw-stars', { role: 'img', 'aria-label': MW_NAMES[r.mw], title: MW_NAMES[r.mw] },
    // earned ✦ in amber, not yet ✧ (hollow): told apart by shape, not by a faded colour (QA2 UI-06)
    ...[1, 2].map((n) => h(`span${r.mw >= n ? '.on' : ''}`, { 'aria-hidden': 'true' }, r.mw >= n ? '✦' : '✧')));
  const view = ctx.view;
  return h(`li.pc-mw-copy${r.mw ? `.mw${r.mw}` : ''}${focus ? '.pn-focus-ring' : ''}`, { dataset: { id: r.id } },
    h('span.pc-mw-k', single ? '' : `#${k + 1}`), stars,
    h('span.pc-mw-now', h('small', MW_NAMES[r.mw]), h('b', `beauty ${fmt(r.beauty * 10) / 10}`)),
    r.next ? h('span.pc-mw-next',
      h('small', `${MW_NAMES[r.next.level]}: `, h('b', `beauty ${fmt(r.next.beauty * 10) / 10}`)),
        price({ coins: r.next.coins }))
      : h('span.pc-mw-next', pill('Fully upgraded', 'pn-owned')),
    view && typeof view.focus === 'function'
      ? h('button.pn-chipbtn.pc-mw-where',
        { type: 'button', title: 'Show it on the farm',
          on: { click: () => { ctx.ui.panels.closeAll(); view.focus(r.x + 0.5, r.z + 0.5); } } }, 'Where?') : null,
    r.next ? kit.button({ label: 'Upgrade', glyph: 'hammer', cls: 'pn-xs btn--sun', type: 'masterwork',
      args: { id: r.id, max: r.next.coins }, data: { masterwork: r.id },
      hint: () => ({ coins: Math.max(0, r.next.coins - ctx.store.state.farm.wallet.coins),
        unlock: MASTERWORK.unlock }) }) : null);
}

function mwGroup(ctx, kit, g, ui) {
  const open = ui.open.has(g.def) || g.copies.findIndex((c) => c.id === ui.focus) >= SHOWN;
  const shown = open ? g.copies : g.copies.slice(0, SHOWN);
  return h(`article.pc-mwg${g.copies.some((c) => c.mw === 2) ? '.gold' : ''}`, { dataset: { def: g.def } },
    h('header.pc-mwg-head', h('span.pc-mw-art', icon(g.def, { size: 52, alt: '' })),
      h('div', h('h4', g.name),
        h('small', `${g.copies.length} on the farm${g.sets.length ? ` · ${g.sets.join(', ')} set` : ''}`))),
    h('ul.pc-mw-copies', ...shown.map((r, k) => mwCopy(ctx, kit, r, k, ui.focus === r.id, g.copies.length === 1))),
    g.copies.length > SHOWN ? h('button.pn-chipbtn.pc-mw-more',
      { type: 'button', 'aria-expanded': String(open), dataset: { key: `mwmore-${g.def}` },
      on: { click: () => { if (open) ui.open.delete(g.def); else ui.open.add(g.def); ui.redraw(); } } },
    open ? 'Show fewer' : `Show all ${g.copies.length}`) : null);
}

export const DECOR_TABS = Object.freeze([{ id: 'sets', label: 'Decor sets', icon: 'rose_arch' },
  { id: 'masterwork', label: 'Masterwork', icon: 'fountain' }]);

export const decorSetsPanel = {
  title: 'Decor sets & Masterwork',
  icon: 'rose_arch',
  size: 'full',
  tabs: () => DECOR_TABS,
  topics: ['objects', 'wallet', 'xp', 'storage'],
  mount(body, ctx) {
    // a panel opens at its top (the shell keeps the scroll box between openings; the frame is still hidden while it
    // mounts, so the reset waits a frame); a focus scrolls on its own
    const box = body.closest('.hh-panel-scroll');
    if (box && !ctx.args?.set && !ctx.args?.id) requestAnimationFrame(() => { box.scrollTop = 0; });
    const kit = createKit(ctx);
    let tab = ctx.tab || (ctx.args?.id ? 'masterwork' : 'sets');
    if (ctx.tab !== tab && ctx.setTab) ctx.setTab(tab);
    let focus = ctx.args?.id ?? ctx.args?.set ?? null;
    const ui = { open: new Set(), focus: ctx.args?.id ?? null, redraw: () => update(true) };
    const sig = () => (tab === 'sets' ? ['s',
      setsView(ctx.store.state,
        ctx.now()).sets.map((x) => [x.id, x.status, x.pieces.map((p) => [p.placed, p.tray, p.inGroup])]),
          ctx.store.state.farm.wallet]
      : ['m', masterworkView(ctx.store.state).rows.map((r) => [r.id, r.mw]), ctx.store.state.farm.wallet.coins,
        [...ui.open]]);
    const update = kit.memo(body, sig, render);
    function render() {
      const st = ctx.store.state;
      if (tab === 'sets') {
        const v = setsView(st, ctx.now());
        body.replaceChildren(
          h('p.pn-intro',
            v.open ? `Themed sets: put one of each piece within ${v.sets[0]?.radius ?? 6} tiles of each other and the whole set gets +${FARM_BEAUTY.setBp / 100} % beauty and a little magic of its own.`
            : `Decor sets open at level ${v.unlock}. The pieces you already have count the moment they do.`),
          h('div.pc-sets', ...v.sets.map((set) => setCard(ctx, kit, set))),
          v.later.length ? h('p.pn-hint', `Later chapters bring ${v.later.join(' and ')}.`) : null);
      } else {
        const v = masterworkView(st);
        body.replaceChildren(
          h('p.pn-intro',
            v.open ? `Every coin decor can be upgraded twice: Masterwork for ${v.mul[0]}× its price (×${v.beautyMul[0]} beauty), then Grand Masterwork for ${v.mul[1]}× (×${v.beautyMul[1]}). Stone instead of wood, gilded trim.`
            : `Masterwork opens at level ${v.unlock}.`),
          v.rows.length ? h('div.pc-mws', ...mwGroups(v.rows).map((g) => mwGroup(ctx, kit, g, ui)))
            : h('div.pn-empty', svgIcon('flower', 44),
              h('p', 'No coin decor on the farm yet. Place some from the Market, then come back to upgrade it.')));
      }
      kit.refresh();
      if (focus) {
        const el = body.querySelector(`[data-id="${CSS.escape(focus)}"], [data-set="${CSS.escape(focus)}"]`);
        focus = null;
        if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      }
    }
    update(true);
    return { tab(id) { tab = id; update(true); const sc = body.closest('.hh-panel-scroll'); if (sc) sc.scrollTop = 0; }, update: () => update() };
  },
};

// ---- the shop's hookups (market.js, integrator: see docs/agent-notes/w2-ui-collect.md) -----------------------------

/**
 * Tags for a decor card in the Market: one per decor set the piece belongs to (from the set's level). Null when it
 * belongs to none. (Masterwork is announced once, by the link above the cards, not on every coin decor.)
 */
export function shopTags(defId, level) {
  const tags = setOfDecor(defId).filter((st) => level >= st.unlock)
    .map((st) => h('span.pc-settag',
      { title: `Part of the ${st.name} set: one of each within ${st.radius} tiles = +${FARM_BEAUTY.setBp / 100} % beauty` }, `✿ ${st.name}`));
  return tags.length ? h('div.pc-shoptags', ...tags) : null;
}

/** The link above the Market's decor cards: the set view and the Masterwork workshop (from the decor-set level). */
export function shopSetsLink(ctx, level) {
  const sets = [...CONTENT.decorSets.values()].filter(isLive);
  if (!sets.length || level < Math.min(...sets.map((x) => x.unlock))) return null;
  return h('button.pn-chipbtn.pc-shoplink', { type: 'button', on: { click: () => ctx.open('decorsets') } },
    '✿ Decor sets & Masterwork');
}
