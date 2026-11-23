// The easy seeds (live requests 2026-10-04: "an easy mode for accessing the seed function"). ui-shell lane.
//
//   The seed picker: the Hand on an empty plot (controller 'command' { cmd: 'seedPicker', id, x, z }) opens a small
//   parchment card right above that plot with the seeds this level can plant (icon, price a plot, grow time; the next
//   locked ones greyed with their level). A pick plants that plot at once (controller.plantWith: the normal predicted
//   path) and keeps the Hand, armed with that crop (release 1.0 M2), so more clicks and drags plant more of it while
//   everything else the Hand does still works. Esc, a click elsewhere or the plot leaving the screen closes it.
//   The quick-seed strip: the Seeds slot's flyout (release 1.0 S2): a row of seed chips over the toolbar while the Seed
//   Bag is in hand and the slot is open; one click switches the crop and folds it.
//   The crop cursor: while the Seed Bag is in hand the pointer carries a small badge with the chosen crop's picture
//   (the brush on the ground wears the crop's colour: controller.refreshHighlight).
//
//   createSeeds(S) -> { open({ id, x, z }), close(), get isOpen, renderStrip() }
//   pickerRows(state, last?) -> rows   the picker's seeds: every open crop, then at most two locked (pure)
//   popPlacement(pt, size, view, { margin, gap }) -> { left, top, below }   where the card goes (pure)
import { h, icon, svgIcon, fmt, fmtShort, fmtDuration, touchPlayer } from './dom.js';
import { seedRows, shortTime, TOOL_CONTENT } from './toolbar.js';
import { readyClock } from '../../../shared/rules/calendar.js';
import { plantPreview } from '../../../shared/rules/actions/farming.js';
import { t as tr, onLang, N, name as cname, lang } from '../i18n/index.js';

const isSeedTool = (id) => TOOL_CONTENT[id] === 'seed_bag';

/** The crops an open order asks for (a picker row it would help). Pure. */
export function wantedCrops(state) {
  const out = new Set();
  for (const slot of Object.values(state?.farm?.orders?.slots ?? {})) {
    for (const item of Object.keys(slot?.order?.items ?? {})) out.add(item);
  }
  return out;
}

/**
 * The picker's rows (release 1.0 M12a, ux-phone#2): the crop planted last first, then the ones an open order asks for,
 * then the rest from the newest unlock down (at level 21 the 2-coin Wheat no longer leads); the next locked ones after.
 * Pure.
 */
export function pickerRows(state, last = null) {
  const rows = seedRows(state);
  const wanted = wantedCrops(state);
  const rank = (r) => (r.id === last ? 0 : wanted.has(r.id) ? 1 : 2);
  const open = rows.filter((r) => r.open).sort((a, b) => rank(a) - rank(b) || b.unlock - a.unlock || (a.id < b.id ? -1 : 1));
  return [...open, ...rows.filter((r) => !r.open)];
}

/**
 * "ready 21:40" / "ready tomorrow 08:40": when a crop planted now is ready, on the farm's clock (release 1.0 D3,
 * features#F3: the clock instead of the duration; features' readyClock is DST-safe). Pure.
 * Under an hour the short form is "in 1m" (first-time FT-1).
 */
export function readyText(now, growMs, tz, { short = false } = {}) {
  if (short && growMs < 3_600_000) {
    const ms = growMs < 60_000 ? growMs : Math.round(growMs / 60_000) * 60_000;
    return tr('dock.seed.in', { d: fmtDuration(ms, { trim: true }) });
  }
  const c = readyClock(now, growMs, tz || 'UTC');
  const k = short ? 'dock.seed.clock' : 'dock.seed.ready';
  if (c.days <= 0) return tr(k, { t: c.t });
  if (c.days === 1) return tr(`${k}Tomorrow`, { t: c.t });
  return tr(`${k}Days`, { n: c.days, t: c.t });
}

/**
 * Where the picker card goes for an anchor point `pt` (CSS px) and the card's `size` {w, h} in a view {w, h}: centred
 * above the point (its tail pointing down at the plot), below it when the top edge would be too close, always inside
 * the view by `margin`. When neither above nor below has room (a phone on its side: the card would sit on the very
 * plot it plants, astra P1-2) it stands beside the point instead (`side` 'right' | 'left', the tail then runs down the
 * card's edge: `tail` is a y offset). Pure.
 */
export function popPlacement(pt, size, view, { margin = 12, gap = 18, top: topGap = 72 } = {}) {
  let below = pt.y - gap - size.h < topGap;
  if (below && pt.y + gap + size.h > view.h - margin) below = false;     // no room either side: above wins
  const covers = below ? pt.y + gap + size.h > view.h - margin : pt.y - gap - size.h < margin;
  if (covers) {
    const side = pt.x + gap + size.w <= view.w - margin ? 'right' : pt.x - gap - size.w >= margin ? 'left' : null;
    if (side) {
      const left = Math.round(side === 'right' ? pt.x + gap : pt.x - gap - size.w);
      const top = Math.round(Math.max(margin, Math.min(view.h - margin - size.h, pt.y - size.h / 2)));
      const tail = Math.round(Math.max(18, Math.min(size.h - 18, pt.y - top)));
      return { left, top, below: false, side, tail };
    }
  }
  const left = Math.round(Math.max(margin, Math.min(view.w - margin - size.w, pt.x - size.w / 2)));
  const top = Math.round(below ? pt.y + gap : Math.max(margin, pt.y - gap - size.h));
  const tail = Math.round(Math.max(18, Math.min(size.w - 18, pt.x - left)));
  return { left, top, below, side: null, tail };
}

/** The picker's margin from the screen's edges and from the bar (CSS px). */
const SP_MARGIN = 12;
/** What the picker keeps above (first-time FT-2: Grandma's card too). */
export const FLOOR_SELECTORS = Object.freeze(['#toolbar', '#dock', '#coach-slot .coach']);

export function createSeeds(S) {
  const { store, controller, view, ui } = S;
  const canvas = document.getElementById('world');
  const scale = () => (S.settings?.scale?.() ?? 100) / 100;

  // ---- the picker -------------------------------------------------------------------------------------------------
  // its own layer (above the tutorial's pointer, which sits over the HUD), zoomed with the UI scale like the HUD
  const pop = h('div.seed-pop', { role: 'dialog', 'aria-label': tr('toolbar.pop.label'), hidden: true });
  document.body.append(pop);
  let at = null;            // { id, x, z } the plot the picker belongs to
  let lastPos = '';
  let size = null;          // the card's size, measured once per render (no layout read per frame)

  function close() {
    if (!at) return;
    at = null;
    pop.hidden = true;
    pop.replaceChildren();
    window.removeEventListener('keydown', onKey, true);
  }

  function choose(r) {
    if (!at) return;
    if (!r.open) { ui.toast(tr('toolbar.seed.lockedToast', { name: N(r.id, 'crops'), level: r.unlock }), { kind: 'info', icon: r.id }); return; }
    const id = at.id;
    close();
    controller.plantWith(r.id, id);
    S.tutorial?.firstUse?.('seed_bag');
  }

  function render() {
    const st = store.state;
    const last = controller.tool.crop;
    const now = store.now?.() ?? Date.now();
    // QA r1 F-02 (features' plantPreview): the price this farmer pays and the clock the crop keeps on THIS plot (season,
    // mastery, rain, a Sprinkler / Cold Frame / Growth Totem by it), the same numbers `plant` writes; never the base table's
    const rows = pickerRows(st, last).map((r) => {
      if (!r.open) return r;
      const p = plantPreview(st, r.id, at ? at.id : null, store.pid, now);
      return { ...r, seed: p.price, growMs: p.readyAt - now };
    });
    const tz = st.meta?.tz;
    const coins = st.farm.wallet.coins;
    const cards = rows.map((r) => h(`button.sp-seed${r.open ? '' : '.locked'}${r.open && r.id === last ? '.last' : ''}${r.open && coins < r.seed ? '.poor' : ''}`, {
      type: 'button', role: 'option', dataset: { crop: r.id },
      'aria-selected': String(r.open && r.id === last), 'aria-disabled': r.open ? null : 'true',
      'aria-label': r.open ? `${tr('toolbar.pop.seed', { name: N(r.id, 'crops'), seed: r.seed, d: fmtDuration(r.growMs, { trim: true }) })} · ${readyText(now, r.growMs, tz)}`
        : tr('toolbar.seed.lockedLabel', { name: N(r.id, 'crops'), level: r.unlock }),
      on: { click: () => choose(r) },
    },
    h('span.sp-art', icon(r.id, { size: 38 }), r.open ? null : h('span.sp-lock', svgIcon('lock', 18))),
    h('span.sp-nm', cname(r.id, { family: 'crops' })),
    r.open
      // the price, then the clock it would be ready at (the card is narrow: the short form, the sentence in the label)
      // (the clock glyph steps aside on a narrow phone: "утре 04:00" keeps one line, QA r2 S-23)
      ? h('span.sp-meta', h('span.sp-price', icon('coins', { size: 15 }), h('b', fmt(r.seed))), h('span.sp-ready', { 'aria-hidden': 'true' }, h('span.sp-clk', '🕑\u2009'), readyText(now, r.growMs, tz, { short: true })))
      : h('span.sp-meta.sp-lv', tr('common.level', { n: r.unlock }))));
    pop.setAttribute('aria-label', tr('toolbar.pop.label'));
    pop.replaceChildren(
      h('div.sp-head', h('b', tr('toolbar.pop.here')), h('span', touchPlayer(S.controller) ? tr('toolbar.pop.moreTouch') : tr('toolbar.pop.more'))),
      h('div.sp-grid', { role: 'listbox', 'aria-label': tr('shell.html.seeds') }, cards),
      h('i.sp-tail', { 'aria-hidden': 'true' }));
    size = null;
  }

  /**
   * The bottom the card keeps above (CSS px): the top of the bar under the farm (the toolbar, the dock), else the screen's.
   * At 21:00 on an iPhone seven two-line clocks grew the card over the phone bar's icons (QA r2 S-23, fe#10).
   */
  function floorY() {
    let y = innerHeight;
    for (const q of FLOOR_SELECTORS) {
      const el = document.querySelector(q);
      if (el?.getClientRects().length) y = Math.min(y, el.getBoundingClientRect().top);
    }
    return y;
  }
  /** Keep the card on its plot (the camera may move under it); off screen it closes. */
  function place() {
    if (!at) return;
    const p = view.toScreen(at.x + 0.5, at.z + 0.5, 0.3);
    const k = scale();
    if (!p || p.visible === false || p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight) { close(); return; }
    const floor = floorY() / k;
    if (!size) {
      // measured once per render; a card taller than the room over the bar scrolls its seeds (S-23)
      const grid = pop.querySelector('.sp-grid');
      if (grid) { grid.style.maxHeight = ''; grid.style.overflowY = ''; }
      size = { w: pop.offsetWidth, h: pop.offsetHeight };
      const room = Math.floor(floor - 2 * SP_MARGIN);
      if (grid && size.h > room) {
        grid.style.maxHeight = `${Math.max(80, grid.offsetHeight - (size.h - room))}px`;
        grid.style.overflowY = 'auto';
        size = { w: pop.offsetWidth, h: pop.offsetHeight };
      }
    }
    const pos = popPlacement({ x: p.x / k, y: p.y / k }, size, { w: innerWidth / k, h: floor }, { margin: SP_MARGIN });
    const key = `${pos.left},${pos.top},${pos.below},${pos.side},${pos.tail}`;
    if (key === lastPos) return;
    lastPos = key;
    // left/top, not a transform: the pop-in scales round the tail (transform-origin) where the card really is
    pop.style.left = `${pos.left}px`;
    pop.style.top = `${pos.top}px`;
    pop.style.setProperty('--tail', `${pos.tail}px`);
    pop.classList.toggle('below', pos.below);
    pop.classList.toggle('side-right', pos.side === 'right');
    pop.classList.toggle('side-left', pos.side === 'left');
  }
  view.onFrame(() => { if (at) place(); });

  function onKey(e) {
    if (!at) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); canvas.focus?.({ preventScroll: true }); return; }
    const keysMove = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
    if (keysMove[e.key] !== undefined) {
      const cards = [...pop.querySelectorAll('.sp-seed')];
      const i = pop.contains(document.activeElement) ? cards.indexOf(document.activeElement)
        : Math.max(0, cards.findIndex((c) => c.classList.contains('last'))) - keysMove[e.key];
      const j = Math.max(0, Math.min(cards.length - 1, i + keysMove[e.key]));
      e.preventDefault();
      e.stopPropagation();
      cards[j]?.focus();
    }
  }

  function open({ id, x, z }) {
    if (!store.state || !Number.isFinite(x) || !Number.isFinite(z)) return;
    close();
    at = { id, x, z };
    lastPos = '';
    render();
    pop.hidden = false;
    // restart the pop-in on every opening
    pop.classList.remove('in');
    void pop.offsetWidth;
    pop.classList.add('in');
    place();
    window.addEventListener('keydown', onKey, true);
    // opened with the mouse: no focus ring on a card; Tab (or an arrow) then walks the cards from the last seed
  }

  // a press anywhere else closes it (a press on another empty plot then opens it there on release)
  document.addEventListener('pointerdown', (e) => { if (at && !pop.contains(e.target)) close(); }, true);
  canvas.addEventListener('wheel', () => close(), { passive: true });
  controller.on('command', (c) => { if (c && c.cmd === 'seedPicker') open(c); });
  controller.on('tool', () => { if (at) close(); });
  store.on('change', (ch) => {
    if (!at) return;
    // the plot was planted meanwhile (the partner, a drag) or is gone: nothing to pick for
    const o = store.state && Object.hasOwn(store.state.farm.objects, at.id) ? store.state.farm.objects[at.id] : null;
    if (!o || o.crop) close();
    else if (ch.topics.has('wallet') || ch.topics.has('xp') || ch.topics.has('*')) { render(); lastPos = ''; }
  });

  // ---- the quick-seed strip ---------------------------------------------------------------------------------------
  const tray = document.getElementById('seed-tray');
  const bar = document.getElementById('toolbar');
  const strip = h('div.seed-strip', { role: 'toolbar', 'aria-label': tr('toolbar.strip.label'), hidden: true });
  bar.before(strip);
  let stripKey = '';

  function renderStrip() {
    const st = store.state;
    const t = controller.tool;
    // the crop strip is the Seeds slot's flyout (release 1.0 S2): it opens with the slot, a pick or a farm click closes it
    const show = Boolean(st) && isSeedTool(t.id) && tray.hidden && S.toolbar?.seedFly !== false;
    if (!show) { strip.hidden = true; stripKey = ''; return; }
    const rows = seedRows(st).filter((r) => r.open);
    const key = `${rows.map((r) => `${r.id}:${r.stock}`).join(',')}|${t.crop}|${lang()}`;
    strip.hidden = false;
    if (key === stripKey) return;
    stripKey = key;
    strip.setAttribute('aria-label', tr('toolbar.strip.label'));
    strip.replaceChildren(
      h('span.ss-label', { 'aria-hidden': 'true' }, tr('toolbar.short.seeds')),
      ...rows.map((r) => h('button.ss-seed', {
        type: 'button', dataset: { crop: r.id, tip: `${tr('toolbar.strip.tip', { name: N(r.id, 'crops'), seed: r.seed, d: fmtDuration(r.growMs, { trim: true }) })} · ${tr('toolbar.seed.inBarn', { n: r.stock })}` },
        'aria-pressed': String(t.crop === r.id), 'aria-label': tr('toolbar.strip.seed', { name: N(r.id, 'crops'), seed: r.seed }),
        // a pick folds the strip and the focus goes back to the Seeds slot (QA r2 S-14: it fell to <body>)
        on: { click: () => {
          controller.setTool(t.id, { crop: r.id });
          S.toolbar?.setSeedFly?.(false);
          bar.querySelector('[data-tool="seed_bag"], [data-slot="tool"]')?.focus({ preventScroll: true });
        } },
      }, icon(r.id, { size: 34 }),
      // the barn's stock of it (owner 2026-10-11), small on the icon's corner; none in the barn: no badge (a bare "0"
      // read as "0 seeds", release 1.0 M28)
      r.stock ? h('span.ss-n', { 'aria-hidden': 'true' }, fmtShort(r.stock)) : null)),
      h('button.ss-more', { type: 'button', 'aria-label': tr('toolbar.strip.all'), dataset: { tip: tr('toolbar.strip.allTip') },
        on: { click: () => S.toolbar?.openSeeds(true) } }, h('span', { 'aria-hidden': 'true' }, '⋯')));
    // one Tab stop, the seed in hand (else the first): the arrows walk the strip (QA r3 S3-23, ap#5)
    const btns = [...strip.querySelectorAll('button')];
    const on = btns.find((b) => b.getAttribute('aria-pressed') === 'true') ?? btns[0];
    for (const b of btns) b.setAttribute('tabindex', b === on ? '0' : '-1');
  }
  // a toolbar of buttons answers the arrows like the Tools ▸ group (toolbar.js) and the Together menu: Left / Right
  // (and Up / Down) move, Home / End jump, Tab leaves the strip in one press (QA r3 S3-23, ap#5: the arrows did nothing
  // and leaving a strip of 21 seeds took 21 Tabs)
  strip.addEventListener('keydown', (e) => {
    const items = [...strip.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % items.length
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + items.length) % items.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (to === null || !items.length) return;
    e.preventDefault();
    for (const b of items) b.setAttribute('tabindex', b === items[to] ? '0' : '-1');
    items[to].focus();
  });
  controller.on('tool', renderStrip);
  onLang(() => { renderStrip(); if (at) { render(); lastPos = ''; } });
  store.subscribe('xp', renderStrip);
  store.subscribe('inventory', renderStrip);
  store.on('welcome', renderStrip);
  if (typeof MutationObserver === 'function') new MutationObserver(renderStrip).observe(tray, { attributes: true, attributeFilter: ['hidden'] });

  // ---- the crop cursor --------------------------------------------------------------------------------------------
  const badge = h('div.crop-cursor', { 'aria-hidden': 'true', hidden: true });
  document.body.append(badge);
  let badgeCrop = null;
  let over = false;
  // the Seed Bag, or the Hand armed with a seed (release 1.0 M2): the pointer carries the crop
  const seeding = () => isSeedTool(controller.tool.id) || (controller.tool.id === 'hand' && Boolean(controller.tool.seeding));
  const wantBadge = () => over && seeding() && Boolean(controller.tool.crop);
  function syncBadge() {
    const crop = controller.tool.crop;
    if (crop !== badgeCrop) { badgeCrop = crop; badge.replaceChildren(crop ? icon(crop, { size: 30 }) : ''); }
    badge.hidden = !wantBadge();
  }
  canvas.addEventListener('pointermove', (e) => {
    over = e.pointerType !== 'touch';
    if (!seeding()) { if (!badge.hidden) badge.hidden = true; return; }
    badge.style.transform = `translate3d(${e.clientX + 12}px, ${e.clientY + 14}px, 0)`;
    // a pan (right / middle drag, or a drag that started on grass) hides it; a planting stroke keeps showing the crop
    const panning = e.buttons !== 0 && canvas.style.cursor === 'grabbing';
    if (panning) { badge.hidden = true; return; }
    syncBadge();
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => { over = false; badge.hidden = true; });
  controller.on('tool', syncBadge);

  renderStrip();
  return {
    open,
    close,
    get isOpen() { return Boolean(at); },
    renderStrip,
  };
}

