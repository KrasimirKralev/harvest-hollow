// The easy seeds (live requests 2026-10-04: "an easy mode for accessing the seed function"). ui-shell lane.
//
//   The seed picker: the Hand on an empty plot (controller 'command' { cmd: 'seedPicker', id, x, z }) opens a small
//   parchment card right above that plot with the seeds this level can plant (icon, price a plot, grow time; the next
//   locked ones greyed with their level). A pick plants that plot at once (controller.plantWith: the normal predicted
//   path) and leaves the Seed Bag in hand with that crop, so more clicks and drags plant more of it. Esc, a click
//   elsewhere or the plot leaving the screen closes it.
//   The quick-seed strip: while the Seed Bag is in hand (and its big tray is closed) a row of seed chips sits on the
//   toolbar: one click switches the crop.
//   The crop cursor: while the Seed Bag is in hand the pointer carries a small badge with the chosen crop's picture
//   (the brush on the ground wears the crop's colour: controller.refreshHighlight).
//
//   createSeeds(S) -> { open({ id, x, z }), close(), get isOpen, renderStrip() }
//   pickerRows(state, last?) -> rows   the picker's seeds: every open crop, then at most two locked (pure)
//   popPlacement(pt, size, view, { margin, gap }) -> { left, top, below }   where the card goes (pure)
import { h, icon, svgIcon, fmt, fmtDuration, touchPlayer } from './dom.js';
import { seedRows, shortTime, TOOL_CONTENT } from './toolbar.js';

const isSeedTool = (id) => TOOL_CONTENT[id] === 'seed_bag';

/** The picker's rows: every crop this level plants, then the next locked ones (seedRows keeps two). */
export function pickerRows(state) {
  const rows = seedRows(state);
  return [...rows.filter((r) => r.open), ...rows.filter((r) => !r.open)];
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

export function createSeeds(S) {
  const { store, controller, view, ui } = S;
  const canvas = document.getElementById('world');
  const scale = () => (S.settings?.scale?.() ?? 100) / 100;

  // ---- the picker -------------------------------------------------------------------------------------------------
  // its own layer (above the tutorial's pointer, which sits over the HUD), zoomed with the UI scale like the HUD
  const pop = h('div.seed-pop', { role: 'dialog', 'aria-label': 'Plant a seed here', hidden: true });
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
    if (!r.open) { ui.toast(`${r.name} unlocks at farm level ${r.unlock}.`, { kind: 'info', icon: r.id }); return; }
    const id = at.id;
    close();
    controller.plantWith(r.id, id);
    S.tutorial?.firstUse?.('seed_bag');
  }

  function render() {
    const st = store.state;
    const rows = pickerRows(st);
    const last = controller.tool.crop;
    const coins = st.farm.wallet.coins;
    const cards = rows.map((r) => h(`button.sp-seed${r.open ? '' : '.locked'}${r.open && r.id === last ? '.last' : ''}${r.open && coins < r.seed ? '.poor' : ''}`, {
      type: 'button', role: 'option', dataset: { crop: r.id },
      'aria-selected': String(r.open && r.id === last), 'aria-disabled': r.open ? null : 'true',
      'aria-label': r.open ? `${r.name}: ${fmt(r.seed)} coins a plot, ready in ${fmtDuration(r.growMs)}` : `${r.name}: unlocks at farm level ${r.unlock}`,
      on: { click: () => choose(r) },
    },
    h('span.sp-art', icon(r.id, { size: 38 }), r.open ? null : h('span.sp-lock', svgIcon('lock', 18))),
    h('span.sp-nm', r.name),
    r.open
      ? h('span.sp-meta', icon('coins', { size: 15 }), h('b', fmt(r.seed)), h('span.sp-dot', '·'), shortTime(r.growMs))
      : h('span.sp-meta.sp-lv', `Level ${r.unlock}`)));
    pop.replaceChildren(
      h('div.sp-head', h('b', 'Plant here'), h('span', `then ${touchPlayer(S.controller) ? 'tap' : 'click'} or drag over more plots`)),
      h('div.sp-grid', { role: 'listbox', 'aria-label': 'Seeds' }, cards),
      h('i.sp-tail', { 'aria-hidden': 'true' }));
    size = null;
  }

  /** Keep the card on its plot (the camera may move under it); off screen it closes. */
  function place() {
    if (!at) return;
    const p = view.toScreen(at.x + 0.5, at.z + 0.5, 0.3);
    const k = scale();
    if (!p || p.visible === false || p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight) { close(); return; }
    size ??= { w: pop.offsetWidth, h: pop.offsetHeight };
    const pos = popPlacement({ x: p.x / k, y: p.y / k }, size, { w: innerWidth / k, h: innerHeight / k });
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
  const strip = h('div.seed-strip', { role: 'toolbar', 'aria-label': 'Quick seeds', hidden: true });
  bar.before(strip);
  let stripKey = '';

  function renderStrip() {
    const st = store.state;
    const t = controller.tool;
    const show = Boolean(st) && isSeedTool(t.id) && tray.hidden;
    if (!show) { strip.hidden = true; stripKey = ''; return; }
    const rows = seedRows(st).filter((r) => r.open);
    const key = `${rows.map((r) => r.id).join(',')}|${t.crop}`;
    strip.hidden = false;
    if (key === stripKey) return;
    stripKey = key;
    strip.replaceChildren(
      h('span.ss-label', { 'aria-hidden': 'true' }, 'Seeds'),
      ...rows.map((r) => h('button.ss-seed', {
        type: 'button', dataset: { crop: r.id, tip: `${r.name}: ${fmt(r.seed)} coins a plot · ready in ${fmtDuration(r.growMs)}` },
        'aria-pressed': String(t.crop === r.id), 'aria-label': `${r.name}, ${fmt(r.seed)} coins a plot`,
        on: { click: () => controller.setTool(t.id, { crop: r.id }) },
      }, icon(r.id, { size: 34 }))),
      h('button.ss-more', { type: 'button', 'aria-label': 'All seeds', dataset: { tip: 'All seeds: prices, harvests and mastery' },
        on: { click: () => S.toolbar?.openSeeds(true) } }, h('span', { 'aria-hidden': 'true' }, '⋯')));
  }
  controller.on('tool', renderStrip);
  store.subscribe('xp', renderStrip);
  store.on('welcome', renderStrip);
  if (typeof MutationObserver === 'function') new MutationObserver(renderStrip).observe(tray, { attributes: true, attributeFilter: ['hidden'] });

  // ---- the crop cursor --------------------------------------------------------------------------------------------
  const badge = h('div.crop-cursor', { 'aria-hidden': 'true', hidden: true });
  document.body.append(badge);
  let badgeCrop = null;
  let over = false;
  const wantBadge = () => over && isSeedTool(controller.tool.id) && Boolean(controller.tool.crop);
  function syncBadge() {
    const crop = controller.tool.crop;
    if (crop !== badgeCrop) { badgeCrop = crop; badge.replaceChildren(crop ? icon(crop, { size: 30 }) : ''); }
    badge.hidden = !wantBadge();
  }
  canvas.addEventListener('pointermove', (e) => {
    over = e.pointerType !== 'touch';
    if (!isSeedTool(controller.tool.id)) { if (!badge.hidden) badge.hidden = true; return; }
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

