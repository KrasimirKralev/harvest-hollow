// The farmhouse (GDD §5.9 Restoration 4-6 and "Grandma's Farmhouse", §5.3 quest E10; M2; w3 ui-home lane). Three tabs:
//   Home       the farmhouse room: a plan of the parlour from above, the furniture catalog (seating, tables, comfort,
//              the kitchen corner, music, lights, plants, rugs, the walls), the room's tray, and placing, moving,
//              turning and storing pieces by click or tap (keyboard: arrows move the piece, Enter puts it down). The
//              room opens when Grandma's Farmhouse (Restoration 6) is restored; before that the plan is a preview.
//   Restoration  Restoration 4-6 (Orchard Pond, Town Fair Grounds, Grandma's Farmhouse) as painted scenes that heal
//              bundle by bundle, with what each gives for good; giving happens in the Restoration Ledger.
//   Grandma    Grandma Hazel's visit: before (what brings her), while she is here (where she strolls now, what she
//              says, how long she stays, who has met her), after (her letter, her gift for the parlour wall).
//
//   farmhouseView(state, pid, now) -> plain data (tested in node)   farmhousePanel: 'farmhouse' (args { tab? })
//   roomView(state, pid, now) / restoreView(state, pid) / visitView(state, pid, now)   the three tabs' data
//
// Rules: rules-economy shared/rules/actions/interior.js (furnish {def, x?, z?, rot?, wall?, at?}, furnishMove {id, ..},
// furnishStore {id}, furnishRefund {id}; interiorOpen, furnishCode, furnishPrice, furnitureCatalog, fixedRow; state
// farm.interior { items, tray }), restoration.js (the Ledger), rules-goals shared/rules/actions/grandma.js (grandmaView;
// farm.grandma { at, until, met, left, gift }).
import { CONTENT, INTERIOR, GRANDMA_VISIT, furnitureOf, isLive } from '../../../../shared/content/index.js';
import * as interiorA from '../../../../shared/rules/actions/interior.js';
import * as grandmaA from '../../../../shared/rules/actions/grandma.js';
import { projectDone } from '../../../../shared/rules/economy.js';
import { levelOf } from './core.js';
import { ledgerView } from './restoration.js';
import { h, fmt, createKit, svgIcon, playerMark, fill, bar, pill, price } from './kit.js';
import { homeScene, furnitureArt, roomPlan } from './home-art.js';
import { t, lang, liveRows, ctext, name as cname } from '../../i18n/index.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** [category, its name] (the name read in the language in effect). */
export const CATS = liveRows(['seating', 'tables', 'comfort', 'kitchen', 'music', 'lights', 'plants', 'rugs', 'walls']
  .map((id) => [id, `home.fh.cat.${id}`]));
/** A piece of furniture's name and words in the language in effect. */
const furnName = (def) => cname(def.id, { family: 'furniture' });
const furnText = (def) => ctext('furniture', def.id, 'desc', def.text ?? '');
/** Grandma's visit texts (lane C: GRANDMA_VISIT.lines.<stop>, .letter.<part>, .card.missed). */
const gv = (id, field, english) => ctext('GRANDMA_VISIT', id, field, english);

const interiorOpen = (state) => (typeof interiorA.interiorOpen === 'function' ? interiorA.interiorOpen(state)
  : Boolean(INTERIOR) && isLive(INTERIOR) && projectDone(state, INTERIOR.needsProject));

/** The spot fields of a placed item ({ x, z, rot } or { wall, at }). */
const spotOfItem = (def, it) => (def.layer === 'wall' ? { wall: it.wall, at: it.at } : { x: it.x, z: it.z, rot: it.rot ?? 0 });

/** Why `def` cannot stand at `spot` now (null = it can), from the rules' own test (`ignore` = the item being moved). */
export function spotCode(state, def, spot, ignore = null) {
  if (!spot) return 'BAD_ARGS';
  if (typeof interiorA.furnishCode === 'function') return interiorA.furnishCode(state, def, spot, ignore);
  return null;
}

/** The room: placed items with their defs, the tray, the catalog by category, and whether it is open. Pure. */
export function roomView(state, pid, now) {
  const open = interiorOpen(state);
  const room = state.farm.interior ?? { items: {}, tray: {} };
  const items = Object.keys(room.items ?? {}).sort().map((id) => {
    const it = room.items[id];
    const def = furnitureOf(it.def);
    if (!def) return null;
    const fx = typeof interiorA.fixedRow === 'function' ? interiorA.fixedRow(id) : null;
    return { id, def, ...spotOfItem(def, it), by: it.by, fixed: Boolean(def.fixed), movable: Boolean(fx?.movable) || !def.fixed,
      refundUntil: it.rcpt && now < it.rcpt.until ? it.rcpt.until : null, paid: it.paid ?? 0 };
  }).filter(Boolean);
  // before the room opens: its own pieces where they will stand (a preview of what the restoration brings)
  const preview = open || !INTERIOR ? [] : INTERIOR.fixed.map((f, i) => {
    const def = furnitureOf(f.def);
    return def ? { id: `fx.${i}`, def, ...(f.wall !== undefined ? { wall: f.wall, at: f.at } : { x: f.x, z: f.z, rot: f.rot ?? 0 }), fixed: true, movable: false } : null;
  }).filter(Boolean);
  const coins = state.farm.wallet.coins;
  const catalog = (typeof interiorA.furnitureCatalog === 'function' ? interiorA.furnitureCatalog(state)
    : [...(CONTENT.furniture?.values() ?? [])].filter((d) => isLive(d) && !d.fixed).map((d) => ({ id: d.id, name: furnName(d), cat: d.cat,
      layer: d.layer, size: d.size, cost: d.cost, shop: d.shop === true, max: d.max ?? null, owned: 0, tray: room.tray?.[d.id] ?? 0 })))
    .map((c) => {
      const def = furnitureOf(c.id);
      const p = typeof interiorA.furnishPrice === 'function' ? interiorA.furnishPrice(state, def) : { coins: c.cost, fromTray: c.tray > 0 };
      const code = !open ? 'LOCKED' : p.code ?? (p.coins > coins ? 'NO_COINS' : null);
      return { ...c, name: def ? furnName(def) : c.name, def, price: p.fromTray ? 0 : c.cost, fromTray: Boolean(p.fromTray), code,
        hint: code === 'NO_COINS' ? { coins: p.coins - coins } : code === 'CAP' ? { cap: c.max } : code === 'LOCKED' && !open ? { text: t('home.fh.opensWith') } : {} };
    });
  const tray = catalog.filter((c) => c.tray > 0);
  const byCat = CATS.map(([id, name]) => ({ id, name, pieces: catalog.filter((c) => c.cat === id && (c.shop || c.tray > 0 || c.owned > 0)) }))
    .filter((c) => c.pieces.length);
  const placedValue = items.reduce((t, it) => t + (it.paid ?? 0), 0);
  return { open, live: Boolean(INTERIOR) && isLive(INTERIOR), items: open ? items : preview, tray, byCat, catalog,
    grid: INTERIOR?.grid ?? [12, 8], walls: INTERIOR?.walls ?? { back: 12, left: 8 }, blocked: INTERIOR?.wallBlocked ?? {},
    clear: INTERIOR?.keepClear ?? [], door: INTERIOR?.door ?? null, pieces: items.filter((i) => !i.fixed).length, placedValue,
    needs: INTERIOR?.needsProject ?? 'farmhouse' };
}

/** Restoration 4-6 for the farmhouse tab: the Ledger's own rows of those projects. Pure. */
export function restoreView(state, pid) {
  const projects = [...CONTENT.restoration.values()].filter((p) => p.n >= 4).sort((a, b) => a.n - b.n);
  const v = ledgerView(state, pid, { projects });
  return v.projects.map((p) => ({ ...p, live: isLive(CONTENT.restoration.get(p.id)), done: Boolean(p.done),
    doneIds: p.bundles.filter((b) => b.done).map((b) => b.id) }));
}

const STOPS = ['porch', 'field', 'orchard', 'barnyard', 'bench', 'parlour'];
/** Where Grandma is, in words: "on the porch" / "на верандата". */
export const stopWords = (stop) => t(`home.fh.stop.${STOPS.includes(stop) ? stop : 'other'}`);

/** Grandma's visit for the card. Pure. phase: 'coming' | 'here' | 'gone'. */
export function visitView(state, pid, now) {
  const G = GRANDMA_VISIT;
  const v = typeof grandmaA.grandmaView === 'function' ? grandmaA.grandmaView(state, now, pid) : null;
  const q = G ? G.quest : null;
  const quest = q ? { id: q, done: Boolean(own(state.farm.quests?.done, q)), active: Boolean(own(state.farm.quests?.active, q)),
    level: CONTENT.quests?.get?.(q)?.level ?? 38, title: ctext('quests', q, 'title', CONTENT.quests?.get?.(q)?.title ?? t('home.fh.questTitle')) } : null;
  const live = Boolean(G) && isLive(G);
  if (!v) {
    return { phase: 'coming', live, quest, farmhouseDone: projectDone(state, INTERIOR?.needsProject ?? 'farmhouse') };
  }
  const lines = gv('lines', v.stop, G.lines?.[v.stop] ?? []);
  const met = Object.keys(state.farm.grandma?.met ?? {}).sort();
  if (v.here) {
    return { phase: 'here', live, quest, stop: v.stop, where: stopWords(v.stop), line: lines[v.line] ?? lines[0] ?? '',
      arrive: gv('lines', 'arrive', G.lines?.arrive ?? [])[0] ?? '', until: v.until, nextAt: v.nextAt, met, metMe: v.met, at: v.at };
  }
  const gift = G.gift?.furniture ?? null;
  const giftDef = gift ? furnitureOf(gift) : null;
  const inTray = gift ? (state.farm.interior?.tray?.[gift] ?? 0) > 0 : false;
  const hung = gift ? Object.values(state.farm.interior?.items ?? {}).some((it) => it.def === gift) : false;
  const L = G.letter ?? {};
  const letter = G.letter ? { ...L, greeting: gv('letter', 'greeting', L.greeting), body: gv('letter', 'body', L.body), signoff: gv('letter', 'signoff', L.signoff) } : G.letter;
  return { phase: 'gone', live, quest, letter, missed: Boolean(v.missed), missedCard: gv('card', 'missed', G.missedCard), leave: gv('lines', 'leave', G.lines?.leave ?? []),
    gift: giftDef ? { id: gift, name: furnName(giftDef), text: furnText(giftDef), inTray, hung, waiting: Boolean(v.gift) } : null, met };
}

/** Everything the farmhouse panel draws (the three tabs). Pure. */
export function farmhouseView(state, pid, now) {
  return { level: levelOf(state), room: roomView(state, pid, now), restore: restoreView(state, pid), visit: visitView(state, pid, now) };
}

/** The tab to open on: Grandma while she is here, the room once it is open, else the restorations. */
export function defaultTab(v) {
  if (v.visit.phase === 'here') return 'grandma';
  return v.room.open ? 'room' : 'restore';
}

/** The farmhouse's dock badge: '!' while Grandma is here and I have not met her yet, or her gift waits in the tray. */
export function farmhouseBadge(state, pid, now) {
  const v = visitView(state, pid, now);
  if (v.phase === 'here' && !v.metMe) return '!';
  if (v.phase === 'gone' && v.gift && v.gift.inTray && !v.gift.hung) return '!';
  return null;
}

// ---- the Home tab: the room plan and the catalog ---------------------------------------------------------------------

function sizeWords(c) {
  return c.layer === 'wall' ? t('home.fh.onWall', { w: c.size[0] }) : c.layer === 'floor' ? t('home.fh.rug', { w: c.size[0], h: c.size[1] }) : `${c.size[0]}×${c.size[1]}`;
}

function homeTab(body, ctx, kit) {
  let cat = 'seating';
  let mode = null;              // { kind: 'place' | 'move', def, id?, rot }
  let ghost = null;             // { spot, ok, code }
  let sel = null;               // a placed item id
  let touch = false;
  const planBox = h('div.fh-planbox');
  const bar0 = h('div.fh-modebar', { role: 'status', 'aria-live': 'polite' });
  const side = h('div.fh-side');
  const lock = h('div.fh-lockbox');
  body.append(h('div.fh-home', h('div.fh-left', lock, bar0, planBox), side));
  planBox.addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch' || e.pointerType === 'pen'; }, true);

  const st = () => ctx.store.state;
  const rv = () => roomView(st(), ctx.store.pid, ctx.now());
  const spotFor = (def, cell) => (def.layer === 'wall' ? (cell.wall ? { wall: cell.wall, at: cell.at } : null)
    : (cell.wall ? null : { x: cell.x, z: cell.z, rot: mode?.rot ?? 0 }));

  let planSvg = null;
  const sameSpot = (a, b) => Boolean(a && b) && a.x === b.x && a.z === b.z && (a.rot ?? 0) === (b.rot ?? 0) && a.wall === b.wall && a.at === b.at;

  /** Move the ghost to a cell (only the ghost layer redraws, never the plan under the pointer). */
  function setGhost(cell, { force = false } = {}) {
    if (!mode) return;
    const spot = spotFor(mode.def, cell);
    if (!spot) { if (ghost) { ghost = null; planSvg?.setGhost?.(null); drawBar(); } return; }
    if (!force && ghost && sameSpot(ghost.spot, spot)) return;
    const code = spotCode(st(), mode.def, spot, mode.kind === 'move' ? mode.id : null);
    ghost = { spot, ok: code === null, code };
    planSvg?.setGhost?.({ def: mode.def, spot, ok: ghost.ok });
    drawBar();
  }

  function commit() {
    if (!mode || !ghost || !ghost.ok) return;
    const args = mode.kind === 'place' ? { def: mode.def.id, ...ghost.spot } : { id: mode.id, ...ghost.spot };
    const type = mode.kind === 'place' ? 'furnish' : 'furnishMove';
    const r = ctx.act(type, args);
    if (r && r.ok === false) return;
    const placedDef = mode.def;
    mode = null;
    ghost = null;
    if (placedDef) ctx.ui.toast?.(t('home.fh.placed', { name: furnName(placedDef) }));
    renderAll();
  }

  function onCell(x, z) {
    if (!mode) { sel = null; renderAll(); return; }
    const same = ghost && ghost.spot && ghost.spot.x === x && ghost.spot.z === z;
    if (touch && !same) { setGhost({ x, z }); return; }       // a tap shows where it goes; a second tap puts it there
    setGhost({ x, z });
    commit();
  }
  function onWall(wall, at) {
    if (!mode) return;
    const same = ghost && ghost.spot && ghost.spot.wall === wall && ghost.spot.at === at;
    if (touch && !same) { setGhost({ wall, at }); return; }
    setGhost({ wall, at });
    commit();
  }

  function drawPlan() {
    const v = rv();
    const items = v.items.map((it) => ({ ...it, sel: it.id === sel || (mode?.kind === 'move' && mode.id === it.id) }))
      .filter((it) => !(mode?.kind === 'move' && mode.id === it.id));
    const svg = roomPlan({ items, ghost: mode && ghost ? { def: mode.def, spot: ghost.spot, ok: ghost.ok } : null,
      grid: v.grid, walls: v.walls, blocked: v.blocked, clear: v.clear, door: v.door,
      onCell: v.open && mode && mode.def.layer !== 'wall' ? onCell : (v.open && !mode ? onCell : null),
      onWall: v.open && mode && mode.def.layer === 'wall' ? onWall : null,
      onItem: v.open && !mode ? (id) => { sel = sel === id ? null : id; renderAll(); } : null,
      onHover: v.open && mode && !touch ? setGhost : null,
      label: v.open ? t('home.fh.planLabel') : t('home.fh.planPreview') });
    planSvg = svg;
    svg.classList.toggle('placing', Boolean(mode));
    svg.classList.toggle('preview', !v.open);
    const wrap = h('div.fh-plan', { tabindex: v.open ? '0' : null, 'aria-label': mode ? t('home.fh.placingAria', { name: furnName(mode.def) }) : null,
      on: { keydown: onKey } }, svg);
    planBox.replaceChildren(wrap);
  }

  function onKey(e) {
    if (!mode) return;
    const v = rv();
    const cur = ghost?.spot ?? (mode.def.layer === 'wall' ? { wall: 'back', at: 0 } : { x: Math.floor(v.grid[0] / 2), z: Math.floor(v.grid[1] / 2), rot: mode.rot });
    const k = e.key;
    let next = null;
    if (mode.def.layer === 'wall') {
      if (k === 'ArrowLeft' || k === 'ArrowUp') next = { wall: cur.wall, at: Math.max(0, cur.at - 1) };
      if (k === 'ArrowRight' || k === 'ArrowDown') next = { wall: cur.wall, at: cur.at + 1 };
    } else {
      if (k === 'ArrowLeft') next = { x: Math.max(0, cur.x - 1), z: cur.z };
      if (k === 'ArrowRight') next = { x: Math.min(v.grid[0] - 1, cur.x + 1), z: cur.z };
      if (k === 'ArrowUp') next = { x: cur.x, z: Math.max(0, cur.z - 1) };
      if (k === 'ArrowDown') next = { x: cur.x, z: Math.min(v.grid[1] - 1, cur.z + 1) };
    }
    if (next) { e.preventDefault(); e.stopPropagation(); setGhost(next); return; }
    if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!ghost) setGhost(cur); commit(); return; }
    if (k === 'r' || k === 'R') { e.preventDefault(); e.stopPropagation(); turn(); return; }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  }

  function turn() {
    if (!mode || mode.def.layer === 'wall') return;
    mode.rot = ((mode.rot ?? 0) + 1) % 4;
    if (ghost && ghost.spot) setGhost({ x: ghost.spot.x, z: ghost.spot.z }, { force: true });
    else drawBar();
  }
  function cancel() { mode = null; ghost = null; renderAll(); }

  /** The client's room input (game/interior.js) when this build has it: controller.interior. */
  const room3d = () => (ctx.controller && ctx.controller.interior && typeof ctx.controller.interior.place === 'function' ? ctx.controller.interior : null);

  function startPlace(c) {
    // inside the room the piece goes into the farmer's hands there (the 3D ghost); outside, onto this plan
    const r3 = room3d();
    if (r3 && r3.inside) {
      let ok = false;
      try { ok = r3.place(c.id) !== false; } catch (err) { console.error('interior place failed', err); }
      if (ok) { ctx.close(); return; }
    }
    sel = null;
    mode = { kind: 'place', def: c.def, rot: 0 };
    ghost = null;
    renderAll();
    planBox.querySelector('.fh-plan')?.focus({ preventScroll: true });
  }
  function startMove(it) {
    mode = { kind: 'move', id: it.id, def: it.def, rot: it.rot ?? 0 };
    ghost = { spot: spotOfItem(it.def, it), ok: false, code: 'ALREADY_DONE' };
    sel = null;
    renderAll();
    planBox.querySelector('.fh-plan')?.focus({ preventScroll: true });
  }

  function drawBar() {
    const v = rv();
    if (!v.open) { bar0.replaceChildren(); return; }
    if (!mode) {
      const r3 = room3d();
      fill(bar0, h('span.fh-mode-text', svgIcon('hammer', 20), v.pieces ? t('home.fh.pieces', { n: v.pieces }) : t('home.fh.pickPiece')),
      r3 && typeof r3.enter === 'function' && !r3.inside ? h('button.btn.btn--sky.pn-sm', { type: 'button', dataset: { key: 'fh-enter' },
        on: { click: () => { try { r3.enter(); } catch (err) { console.error('interior enter failed', err); } ctx.close(); } } }, t('home.banner.goInside')) : null);
      return;
    }
    const why = ghost && !ghost.ok && ghost.code && ghost.code !== 'ALREADY_DONE'
      ? t(['OCCUPIED', 'BLOCKED', 'OUT_OF_BOUNDS'].includes(ghost.code) ? `home.fh.why.${ghost.code}` : 'home.fh.why.other') : null;
    fill(bar0, h('span.fh-mode-text', furnitureArt(mode.def, { px: 32 }),
      h('span', h('b', t(mode.kind === 'move' ? 'home.fh.moving' : 'home.fh.placing', { name: furnName(mode.def) })),
        why ? h('span.fh-why', why) : touch ? (ghost ? t('home.fh.tapAgain') : t('home.fh.tapSpot')) : t('home.fh.clickSpot'))),
      touch && ghost && ghost.ok ? h('button.btn.btn--go.pn-sm', { type: 'button', dataset: { key: 'fh-put' }, on: { click: commit } }, t('home.fh.putHere')) : null,
      mode.def.layer === 'wall' ? null : h('button.pn-chipbtn', { type: 'button', dataset: { key: 'fh-turn' }, on: { click: turn } }, t('home.fh.turnBtn')),
      h('button.pn-chipbtn', { type: 'button', dataset: { key: 'fh-cancel' }, on: { click: cancel } }, t('common.cancel')));
  }

  function selectedCard(v) {
    const it = v.items.find((x) => x.id === sel);
    if (!it) return null;
    const s0 = st();
    const by = it.by && it.by !== 'sys' ? s0.players[it.by] : null;
    return h('section.fh-selected', { dataset: { item: it.id } },
      h('div.fh-sel-head', furnitureArt(it.def, { px: 56 }), h('div', h('b', furnName(it.def)),
        h('small', it.fixed ? t('home.fh.ownPiece') : by ? t('home.fh.placedBy', { who: it.by === ctx.store.pid ? t('home.fish.you') : by.name }) : t('home.fh.inRoom')))),
      it.def.text ? h('p.fh-sel-text', furnText(it.def)) : null,
      h('div.fh-sel-acts',
        it.movable ? h('button.btn.btn--sky.pn-sm', { type: 'button', dataset: { key: `mv-${it.id}` }, on: { click: () => startMove(it) } }, t('home.fh.move')) : null,
        it.movable && it.def.layer !== 'wall' ? kit.button({ label: t('home.fh.turn'), cls: 'pn-sm btn--paper', type: 'furnishMove',
          args: () => ({ id: it.id, x: it.x, z: it.z, rot: ((it.rot ?? 0) + 1) % 4 }), data: { turn: it.id },
          hint: { texts: { OCCUPIED: t('home.fh.noTurn'), OUT_OF_BOUNDS: t('home.fh.noTurn'), BLOCKED: t('home.fh.blockDoor') } } }) : null,
        !it.fixed ? kit.button({ label: t('home.fh.store'), cls: 'pn-sm btn--paper', type: 'furnishStore', args: { id: it.id }, data: { store: it.id },
          after: (r) => { if (r && r.ok) { sel = null; renderAll(); } } }) : null,
        it.refundUntil ? h('span.fh-undo', kit.button({ label: t('farm.tree.undoBuy'), cls: 'pn-xs pn-ghost', type: 'furnishRefund', args: { id: it.id },
          data: { refund: it.id }, after: (r) => { if (r && r.ok) { sel = null; renderAll(); } } }),
        kit.timer(h('small'), { end: it.refundUntil, prefix: t('home.fh.backFor', { n: it.paid }), doneText: '' })) : null));
  }

  function pieceCard(c) {
    return h(`article.fh-piece${c.code === 'CAP' ? '.owned' : ''}`, { dataset: { furn: c.id } },
      h('div.fh-piece-art', furnitureArt(c.def, { px: 72 })),
      h('b', c.name), h('small', sizeWords(c)),
      h('div.fh-piece-foot',
        c.fromTray ? h('span.pn-cost.pn-free', c.tray > 1 ? t('home.fh.waitingN', { n: c.tray }) : t('home.fh.waiting'))
          : c.code === 'CAP' ? pill(c.max > 1 ? t('market.facts.of', { n: c.owned, cap: c.max }) : t('home.fh.inRoom'), 'pn-owned') : price({ coins: c.price }),
        c.code === 'CAP' ? null : kit.button({ label: t('market.card.place'), glyph: 'hammer', cls: 'pn-sm', data: { place: c.id }, quiet: ['LOCKED'],
          gate: () => {
            const f = rv().catalog.find((x) => x.id === c.id);
            return f && f.code ? { code: f.code, hint: f.hint } : null;
          },
          onClick: () => startPlace(c) })));
  }

  function drawSide() {
    const v = rv();
    const cats = v.byCat;
    if (!cats.some((x) => x.id === cat) && cats.length) cat = cats[0].id;
    const cur = cats.find((x) => x.id === cat);
    fill(side,
      selectedCard(v),
      v.tray.length ? h('section.fh-tray', h('h3', t('home.fh.tray')), h('div.fh-pieces', ...v.tray.map(pieceCard))) : null,
      h('section.fh-catalog',
        h('h3', t('home.fh.catalog')),
        h('div.fh-cats', { role: 'tablist', 'aria-label': t('home.fh.furniture') }, ...cats.map((x) => h(`button.pn-chipbtn${x.id === cat ? '.on' : ''}`, {
          type: 'button', role: 'tab', 'aria-selected': String(x.id === cat), dataset: { key: `cat-${x.id}`, cat: x.id },
          on: { click: () => { cat = x.id; drawSide(); kit.refresh(); } } }, x.name))),
        cur ? h('div.fh-pieces', ...cur.pieces.filter((c) => !c.fromTray).map(pieceCard)) : null,
        h('p.fh-note', t('home.fh.note'))));
  }

  function drawLock() {
    const v = rv();
    if (v.open) { lock.replaceChildren(); return; }
    const p = restoreView(st(), ctx.store.pid).find((x) => x.id === v.needs);
    lock.replaceChildren(h('div.fh-lock', svgIcon('lock', 26),
      h('div', h('b', v.live ? t('home.fh.lock') : t('home.fh.lockLater')),
        h('small', p ? (p.open ? t('home.fh.lockStage', { stage: p.stage, n: p.bundles.length }) : t('home.fh.lockFrom', { n: p.unlock })) : ''),
        p ? bar(p.pct, null, 'pn-thin pn-go') : null),
      p && v.live ? h('button.btn.btn--sky.pn-sm', { type: 'button', on: { click: () => ctx.open('restoration', { id: p.id }) } }, t('home.fh.ledger')) : null));
  }

  function renderAll() { drawLock(); drawBar(); drawPlan(); drawSide(); kit.refresh(); }
  renderAll();
  const sig = () => {
    const v = rv();
    return [v.open, v.items.map((i) => [i.id, i.x, i.z, i.rot, i.wall, i.at, Boolean(i.refundUntil)]), v.catalog.map((c) => [c.id, c.code, c.tray, c.owned]),
      st().farm.wallet.coins];
  };
  let last = JSON.stringify(sig());
  return {
    update() {
      const k = JSON.stringify(sig());
      if (k === last) { kit.refresh(); return; }
      last = k;
      if (sel && !rv().items.some((i) => i.id === sel)) sel = null;
      if (mode?.kind === 'move' && !rv().items.some((i) => i.id === mode.id)) { mode = null; ghost = null; }
      drawLock(); drawPlan();
      if (mode && ghost && ghost.spot) setGhost(ghost.spot.wall ? { wall: ghost.spot.wall, at: ghost.spot.at } : { x: ghost.spot.x, z: ghost.spot.z }, { force: true });
      drawBar(); drawSide(); kit.refresh();
    },
    stopPlacing: cancel,
  };
}

// ---- the Restoration tab ---------------------------------------------------------------------------------------------

function restoreTab(body, ctx, kit) {
  const render = () => {
    const rows = restoreView(ctx.store.state, ctx.store.pid);
    fill(body, h('p.pn-intro', t('home.fh.restoreIntro')),
      h('div.fh-projects', ...rows.map((p) => h(`article.fh-proj.st-${p.status}`, { dataset: { project: p.id } },
        h('div.fh-proj-art', homeScene(p.id, new Set(p.doneIds), { label: t('home.fh.sceneLabel', { name: p.name, stage: p.stage, n: p.bundles.length }) }) ?? h('div'),
          p.done ? h('span.fh-proj-tag', t('collect.rest.restored')) : null),
        h('div.fh-proj-main',
          h('header', h('span.fh-proj-n', String(p.n)), h('h3', p.name),
            pill(p.done ? t('collect.rest.restored') : p.open ? t('market.facts.of', { n: p.stage, cap: p.bundles.length }) : p.live ? t('common.level', { n: p.unlock }) : t('home.grand.soon'), p.done ? 'pn-owned' : p.open ? 'pn-warn' : '')),
          h('p.fh-proj-reward', svgIcon('star', 18), h('span', p.text)),
          h('ul.fh-bundles', ...p.bundles.map((b) => h(`li${b.done ? '.done' : ''}`, h('b', b.name),
            h('small', b.done ? t('home.fh.given') : t('collect.rest.anyOf', { need: b.need, of: b.of })), bar(b.done ? 1 : b.doneSlots / Math.max(1, b.need), null, `pn-thin${b.done ? ' pn-go' : ''}`)))),
          p.done ? null : h('div.fh-proj-foot',
            h('small', p.open ? t('home.fh.openNow') : p.lockReason ?? ''),
            p.live ? h('button.btn.btn--sky.pn-sm', { type: 'button', dataset: { open: p.id }, on: { click: () => ctx.open('restoration', { id: p.id }) } },
              p.open ? t('home.fh.give') : t('home.fh.look')) : null))))));
    kit.refresh();
  };
  const update = kit.memo(body, () => restoreView(ctx.store.state, ctx.store.pid).map((p) => [p.id, p.status, p.stage, p.bundles.map((b) => b.doneSlots)]), render);
  update(true);
  return { update: () => update() };
}

// ---- the Grandma tab ---------------------------------------------------------------------------------------------------

function grandmaTab(body, ctx, kit) {
  const portrait = (cls = '') => h(`img.fh-gran${cls}`, { src: '/assets/art/npc/hazel.webp', alt: cname('hazel'), width: 160, height: 160, decoding: 'async' });
  const render = () => {
    const st = ctx.store.state;
    const v = visitView(st, ctx.store.pid, ctx.now());
    if (v.phase === 'coming') {
      fill(body, h('article.fh-visit.coming', portrait(),
        h('div.fh-visit-main',
          h('h3', t('home.fh.coming')),
          h('p', t(v.farmhouseDone ? 'home.fh.comingReady' : 'home.fh.comingWhen', { title: v.quest?.title ?? t('home.fh.questTitle'), n: v.quest?.level ?? 38 })),
          h('ul.fh-visit-list',
            h('li', svgIcon('heart', 20), t('home.fh.strolls')),
            h('li', svgIcon('chat', 20), t('home.fh.listen')),
            h('li', svgIcon('star', 20), t('home.fh.leaves'))),
          v.quest && v.quest.active ? pill(t('home.fh.letterOpen'), 'pn-warn') : null,
          v.live ? null : h('p.hm-note.hm-note-later', svgIcon('lock', 18), t('home.fh.visitLater')))));
      return;
    }
    if (v.phase === 'here') {
      const metWho = v.met.map((p) => h('span.fh-met', playerMark(p, st.players[p], { size: 20 }), st.players[p]?.name ?? ''));
      fill(body, h('article.fh-visit.here', portrait('.here'),
        h('div.fh-visit-main',
          h('h3', t('home.fh.here', { where: v.where })),
          h('blockquote.fh-quote', t('market.orders.quote', { line: v.line })),
          h('p.fh-visit-times',
            h('span', svgIcon('sun', 18), kit.timer(h('span'), { end: v.nextAt, prefix: t('home.fh.movesIn'), doneText: t('home.fh.movingOn'), done: () => ctx.refreshVisit?.() })),
            h('span', svgIcon('heart', 18), kit.timer(h('span'), { end: v.until, prefix: t('home.fh.staysFor'), doneText: t('home.fh.packing') }))),
          metWho.length ? h('p.fh-visit-met', t('home.fh.seenHer'), ...metWho) : null,
          h('p.fh-hint', t('home.fh.walkUp')))));
      return;
    }
    const L = v.letter ?? {};
    fill(body, h('article.fh-visit.gone',
      h('div.fh-letter', h('p.fh-letter-hi', L.greeting ?? t('home.fh.myDears')), ...(L.body ?? []).map((x) => h('p', x)), h('p.fh-letter-sign', L.signoff ?? t('home.fh.grandma'))),
      h('div.fh-visit-side', portrait('.small'),
        v.missed ? h('p.fh-missed', v.missedCard) : null,
        v.gift ? h('div.fh-gift', h('b', v.gift.name), h('small', v.gift.text),
          v.gift.hung ? pill(t('collect.wall.onWall'), 'pn-owned') : v.gift.inTray ? h('button.btn.btn--sun.pn-sm', { type: 'button', on: { click: () => ctx.setTab('room') } }, t('home.fh.hang'))
            : v.gift.waiting ? h('small', t('home.fh.arrives')) : null) : null)));
  };
  const update = kit.memo(body, () => {
    const v = visitView(ctx.store.state, ctx.store.pid, ctx.now());
    return [v.phase, v.stop, v.line, v.met, v.gift && [v.gift.inTray, v.gift.hung], v.quest && v.quest.active];
  }, () => { render(); kit.refresh(); });
  ctx.refreshVisit = () => update(true);
  ctx.every(15_000, () => update());
  update(true);
  return { update: () => update() };
}

// ---- the panel -----------------------------------------------------------------------------------------------------------

export const farmhousePanel = {
  title: () => t('home.fh.title'),
  icon: 'farmhouse',
  size: 'full',
  tabs: () => [{ id: 'room', label: t('home.fh.tab.room') }, { id: 'restore', label: t('home.fh.tab.restore') }, { id: 'grandma', label: t('home.fh.tab.grandma') }],
  topics: ['interior', 'restore', 'restoration', 'wallet', 'grandma', 'quests', 'players', 'xp', 'inventory'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    // a tab asked for (args.tab, or the Goal Tracker's { grandma: true }); else Grandma while she is here and the
    // restorations until the room opens. The shell's own tab strip follows once the panel is up.
    const asked = ['room', 'restore', 'grandma'].includes(ctx.args?.tab) ? ctx.args.tab : ctx.args?.grandma ? 'grandma' : null;
    let tab = asked || ctx.tab || 'room';
    const want = asked ? null : defaultTab(farmhouseView(ctx.store.state, ctx.store.pid, ctx.now()));
    const sync = asked && asked !== ctx.tab ? asked : want && want !== tab && (want === 'grandma' || tab === 'room') ? want : null;
    if (sync) {
      if (!asked) tab = sync;
      queueMicrotask(() => { if (typeof ctx.setTab === 'function') ctx.setTab(sync); });
    }
    let inst = null;
    const mountTab = () => {
      body.replaceChildren();
      body.dataset.tab = tab;
      inst = tab === 'room' ? homeTab(body, ctx, kit) : tab === 'grandma' ? grandmaTab(body, ctx, kit) : restoreTab(body, ctx, kit);
    };
    mountTab();
    return {
      tab(id) { if (id === tab) return; tab = id; mountTab(); },
      update() { inst?.update?.(); kit.refresh(); },
    };
  },
};

