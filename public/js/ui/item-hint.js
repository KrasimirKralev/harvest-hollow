// "Where to get it" bubbles (live requests 2026-10-04: "Where you need an item for a recipe or something, when you
// hold your cursor on top, show a bubble with a hint where to get it"). One wood-and-parchment bubble for the whole
// page, attached by event delegation to every needed-item anchor, so every panel has it at once:
//
//   .pn-chip[data-item]          the panels' item chips (kit.chip): recipe inputs, barn and land upgrades, orders,
//                                townsfolk requests, animal feed ...; data-need = how many are needed
//   [data-hint-item]             any other needed item (Fair entries, barge crates, Town Project goods, Restoration
//                                slots, letter tasks, a button's "Need 2 more Planks"): data-hint-need (the total),
//                                data-hint-more (how many more), data-hint-cls (an ingredient class: 'grain'),
//                                data-hint-recipe (the feed a class chip belongs to: the bubble then says which members
//                                the Feed Mill skips and why, with "Allow for feed" / "Stop keeping" buttons)
//
// Desktop: the bubble shows 250 ms after the pointer rests on an anchor and stays while the pointer travels into it
// (its "Show me" buttons are clickable); it goes when the pointer leaves both. Touch: a 450 ms press (TOUCH.longMs,
// the canvas' long press) or a tap on an anchor that is not itself a control; a tap outside closes it. Keyboard: an
// anchor that takes the focus shows it, Enter runs its first "Show me", Esc closes it. It never covers the buttons of
// the card it points into (above, else below, else the side with room), and it stays inside the viewport.
//
//   createItemHints(S) -> { show(el), hide(), refresh(), el }     S = the ui ctx { store, controller, ui }
//   placeHint(anchor, size, view, avoid) -> { left, top, below, tail }   the placement (pure: tests)
//   HINT_SEL                                                       the anchors' selector
import { itemOf } from '../../../shared/content/index.js';
import { h, icon, svgIcon, touchPlayer } from './dom.js';
import { itemHint, haveLine } from './item-sources.js';
import { TOUCH } from '../game/touch.js';
import { I, actUndoable } from './panels/intents.js';
import { noFeedText, unkeepText } from './panels/model.js';
import { t } from '../i18n/index.js';

export const HINT_SEL = '[data-hint-item], .pn-chip[data-item]';
/** The card an anchor sits in: its buttons are what the player is about to press (the bubble keeps clear of them). */
const CARD_SEL = '.pn-upgrade, .pn-recipe, .pn-order, .pn-landcard, .pc-slot, .wk-crate, .wk-entry, .wk-good, .pn-task, '
  + '.pn-letter-paper, article, li';
/** An anchor inside one of these does that control's job on a tap; a tap must not open the bubble over it. */
const CONTROL_SEL = 'button, a[href], label, input, select, textarea, [role="button"], [role="tab"]';
const SHOW_MS = 250;
const HIDE_MS = 220;
const GAP = 10;
const EDGE = 8;

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
};
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Where the bubble goes (pure). anchor: the anchor's rect; size { width, height }; view { width, height }; avoid: the
 * rects it must not cover (the buttons of the anchor's own card: what the player is about to press); soft: rects it
 * had better not cover (the other buttons in sight). Tried in order above, below, left, right of the anchor; the first
 * that fits the view and covers no button wins, else the one that covers the fewest (own buttons count ten). Always
 * clamped into the view. -> { left, top, side, below, tail } (tail: where the pointer sits along the facing edge).
 */
export function placeHint(anchor, size, view, avoid = [], soft = []) {
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  const clampX = (x) => Math.round(Math.max(EDGE, Math.min(view.width - size.width - EDGE, x)));
  const clampY = (y) => Math.round(Math.max(EDGE, Math.min(view.height - size.height - EDGE, y)));
  const cand = (side) => {
    let left;
    let top;
    if (side === 'above' || side === 'below') {
      left = clampX(cx - size.width / 2);
      top = side === 'below' ? anchor.bottom + GAP : anchor.top - GAP - size.height;
    } else {
      top = clampY(cy - size.height / 2);
      left = side === 'right' ? anchor.right + GAP : anchor.left - GAP - size.width;
    }
    const box = { left, top, right: left + size.width, bottom: top + size.height };
    const fits = box.left >= EDGE && box.top >= EDGE && box.right <= view.width - EDGE && box.bottom <= view.height - EDGE;
    const cost = avoid.filter((r) => overlaps(box, r)).length * 10 + soft.filter((r) => overlaps(box, r)).length;
    const along = side === 'above' || side === 'below' ? cx - left : cy - top;
    const span = side === 'above' || side === 'below' ? size.width : size.height;
    return { left: Math.round(left), top: Math.round(top), side, fits, cost, tail: Math.round(Math.max(16, Math.min(span - 16, along))) };
  };
  const all = ['above', 'below', 'left', 'right'].map(cand);
  const fit = all.filter((p) => p.fits);
  let pick = fit.find((p) => p.cost === 0)
    ?? (fit.length ? fit.reduce((a, b) => (b.cost < a.cost ? b : a)) : null);
  // nothing fits whole (a tall bubble on a short phone): the roomier of above / below, clamped; it scrolls inside
  if (!pick) pick = anchor.top > view.height - anchor.bottom ? all[0] : all[1];
  const top = clampY(pick.top);
  const left = clampX(pick.left);
  return { left, top, side: pick.side, below: pick.side === 'below', tail: pick.tail };
}

/** The item, need and class an anchor names (null when it names no known item). */
export function anchorItem(el) {
  if (!el || !el.dataset) return null;
  const id = el.dataset.hintItem || el.dataset.item;
  if (!id || !itemOf(id)) return null;
  const num = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
  const out = { id, need: num(el.dataset.hintNeed ?? el.dataset.need), more: num(el.dataset.hintMore), cls: el.dataset.hintCls || null };
  if (el.dataset.hintRecipe) out.recipe = el.dataset.hintRecipe;     // a Feed Mill class chip: its feed
  return out;
}

const STATE_GLYPH = { ready: 'check', build: 'hammer', locked: 'lock', info: 'star' };

export function createItemHints(S) {
  const box = h('div#item-hint.ih', { role: 'tooltip', hidden: true, 'aria-live': 'polite' });
  document.body.append(box);
  let cur = null;          // { el, item, pinned, via }
  let showT = 0;
  let hideT = 0;
  let press = null;        // a finger on an anchor: { el, x, y, t, long }
  let swallowUntil = 0;    // the click a long press leaves behind
  let raf = 0;
  let pointer = null;      // the mouse's last spot: a panel that re-renders under a resting pointer swaps the anchor

  /**
   * A panel re-renders on store changes (a partner's harvest): the anchor under the bubble may be a new node by now.
   * The one under the resting mouse, else the first one in sight naming the same item, takes over.
   */
  function reanchor(el, id, at) {
    if (el.isConnected) return el;
    const under = pointer ? anchorOf(document.elementFromPoint(pointer.x, pointer.y)) : null;
    if (under && anchorItem(under)?.id === id) return under;
    // the same item where the old one stood (a re-render keeps the layout): the nearest of them, a few px away at most
    if (!at) return null;
    const mid = (r) => [r.left + r.width / 2, r.top + r.height / 2];
    const [x0, y0] = mid(at);
    let best = null;
    let bestD = 24;
    for (const x of document.querySelectorAll(HINT_SEL)) {
      if (anchorItem(x)?.id !== id) continue;
      const [x1, y1] = mid(rectOf(x));
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d < bestD) { best = x; bestD = d; }
    }
    return best;
  }

  const now = () => (typeof S.store?.now === 'function' ? S.store.now() : Date.now());

  function model(a) {
    const m = itemHint(a.id, S.store?.state ?? null, { need: a.need ?? undefined, cls: a.cls, recipe: a.recipe, now: now() });
    if (m && a.need === null && a.more !== null && a.more > 0) {
      m.need = m.have + a.more;
      m.short = a.more;
    }
    return m;
  }

  function showMe(src) {
    if (!src.show || !S.ui?.panels) return;
    hide(true);
    S.ui.panels.open(src.show.panel, src.show.args);
  }

  /** A skipped Feed Mill member's way out, through the normal predicted action, with an Undo toast. */
  function fixSkip(x) {
    const act = (type, args) => (S.controller?.do ? S.controller.do(type, args) : S.store.act(type, args));
    const toast = S.ui?.toast ? (text, o) => S.ui.toast(text, o) : null;
    if (x.fix.kind === 'allow') actUndoable(act, toast, I.noFeed(x.id, false), I.noFeed(x.id, true), noFeedText(x.id, false));
    else if (x.fix.kind === 'unkeep') actUndoable(act, toast, I.keep(x.id, 0), I.keep(x.id, x.keep), unkeepText(x.id, x.keep));
  }

  /** The class part: every member in the Barn with why the Feed Mill skips it (data-hint-recipe), else just the names. */
  function clsPart(c) {
    if (!c) return null;
    // c.words ("any fruit") is the item-sources model's (lane C): this module only builds the sentence around it
    const words = `${c.words[0].toUpperCase()}${c.words.slice(1)}`;
    if (!c.rows) return h('p.ih-cls', t('toolbar.ih.works', { words }), ...c.members.map((x, i) => [i ? ', ' : '', h('b', x.name), ` ${x.have}`]));
    return h('div.ih-feed',
      h('p.ih-cls', t('toolbar.ih.cheapest', { words })),
      c.rows.length ? h('ul.ih-feed-list', ...c.rows.map((x) => h(`li.ih-feed-row.${x.why ? `skip.why-${x.why}` : 'use'}`,
        { dataset: { feedRow: x.id } },
        icon(x.id, { size: 26, alt: '' }),
        h('span.ih-feed-text', x.text),
        x.fix && x.fix.kind !== 'ask'
          ? h('button.btn.btn--sky.btn--small.ih-fix', { type: 'button', dataset: { fix: x.fix.kind, item: x.id },
            'aria-label': `${x.fix.label}: ${x.name}`, on: { click: (e) => { e.stopPropagation(); fixSkip(x); } } }, x.fix.label)
          : x.fix ? h('span.ih-feed-note', x.fix.label) : null))) : null,
      c.none.length ? h('p.ih-feed-none', t('toolbar.ih.none', { list: c.none.join(', ') })) : null);
  }

  let drawn = null;        // what the bubble shows now: a store change that alters nothing leaves its nodes alone
  function render(a) {
    const m = model(a);
    if (!m) return false;
    const touch = touchPlayer(S.controller);
    const sig = JSON.stringify([m, touch, cur?.via]);
    if (sig === drawn) return true;
    drawn = sig;
    const short = m.need !== null && m.short > 0;
    box.replaceChildren(h('div.ih-scroll',
      h('div.ih-head',
        h('span.ih-art', icon(m.id, { size: 44, alt: '' })),
        h('div.ih-titles', h('b.ih-name', m.name),
          h(`span.ih-have${short ? '.short' : m.need !== null ? '.ok' : ''}`, haveLine(m)))),
      clsPart(m.cls),
      h('div.ih-label', svgIcon('sprout', 14), t('toolbar.ih.where')),
      h('ol.ih-list', ...m.sources.map((s) => h(`li.ih-src.${s.state}`, { dataset: { src: s.key } },
        h('span.ih-src-art', icon(s.icon, { size: 34, alt: '' })),
        h('div.ih-src-main',
          h('b.ih-src-title', s.title),
          h('span.ih-src-text', s.text),
          s.note ? h('span.ih-src-note', svgIcon(STATE_GLYPH[s.state] ?? 'star', 14), s.note) : null),
        s.show ? h('button.btn.btn--sky.btn--small.ih-show', { type: 'button', 'aria-label': t('toolbar.ih.showLabel', { title: s.title }),
          on: { click: (e) => { e.stopPropagation(); showMe(s); } } }, t('moments.showMe')) : null))),
      touch ? null : h('p.ih-foot', cur?.via === 'focus' ? t('toolbar.ih.keys') : null)));
    box.classList.toggle('touch', touch);
    return true;
  }

  function position() {
    if (!cur || box.hidden) return;
    if (!cur.el.isConnected) {
      const next = reanchor(cur.el, cur.item.id, cur.at);
      if (!next) { if (!cur.pinned && !box.matches(':hover')) hide(); return; }
      next.setAttribute('aria-describedby', 'item-hint');
      cur.el = next;
    }
    const a = rectOf(cur.el);
    cur.at = a;
    // scrolled out of its panel (or out of the window): nothing left to point at
    const port = cur.el.closest('.hh-panel-scroll');
    const pr = port ? rectOf(port) : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    if ((a.width === 0 && a.height === 0) || a.bottom < pr.top || a.top > pr.bottom) { hide(true); return; }
    // what may be pressed next: the card's own buttons (never covered when there is a way), then every other one in sight
    // (the card's own button counts even while it waits for this very item: it is what the player came to press)
    const live = (b) => !b.closest('.ih') && b.getAttribute('aria-disabled') !== 'true' && !b.disabled;
    const card = cur.el.closest(CARD_SEL);
    const own = card ? [...card.querySelectorAll('button')].filter((b) => !b.closest('.ih')) : [];
    const scope = cur.el.closest('.hh-panel') ?? document.body;
    const others = [...scope.querySelectorAll('button')].filter((b) => live(b) && !own.includes(b));
    const rects = (list) => list.map(rectOf).filter((r) => r.width > 0 && r.bottom > pr.top && r.top < pr.bottom);
    const size = { width: box.offsetWidth, height: box.offsetHeight };
    const vv = globalThis.visualViewport;
    const view = { width: vv ? vv.width : innerWidth, height: vv ? vv.height : innerHeight };
    const p = placeHint(a, size, view, rects(own), rects(others));
    for (const side of ['above', 'below', 'left', 'right']) box.classList.toggle(side, p.side === side);
    box.style.setProperty('--tail', `${p.tail}px`);
    box.style.transform = `translate3d(${p.left}px, ${p.top}px, 0)`;
  }

  function show(el, { via = 'hover', pinned = false } = {}) {
    const a = anchorItem(el);
    if (!a) return false;
    clearTimeout(showT);
    clearTimeout(hideT);
    // the native title would pop up over the bubble: what it said stays for screen readers
    if (el.hasAttribute('title')) {
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.getAttribute('title'));
      el.removeAttribute('title');
    }
    if (cur && cur.el !== el) cur.el.removeAttribute?.('aria-describedby');
    cur = { el, item: a, pinned, via };
    drawn = null;
    if (!render(a)) { hide(true); return false; }
    box.hidden = false;
    box.classList.remove('in');
    void box.offsetWidth;          // restart the pop-in
    box.classList.add('in');
    el.setAttribute('aria-describedby', 'item-hint');
    position();
    return true;
  }

  function hide(instant = false) {
    clearTimeout(showT);
    clearTimeout(hideT);
    const go = () => {
      if (cur) cur.el.removeAttribute?.('aria-describedby');
      cur = null;
      drawn = null;
      box.hidden = true;
      box.replaceChildren();
    };
    if (instant) go(); else hideT = setTimeout(go, HIDE_MS);
  }

  const anchorOf = (t) => (t && t.closest ? t.closest(HINT_SEL) : null);
  const inBox = (t) => Boolean(t && box.contains(t));

  // ---- mouse: rest on an anchor, travel into the bubble ------------------------------------------------------------
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    if (inBox(e.target)) { clearTimeout(hideT); return; }
    const el = anchorOf(e.target);
    if (!el || !anchorItem(el)) return;
    if (cur && cur.el === el) { clearTimeout(hideT); return; }
    if (cur && cur.pinned) return;
    clearTimeout(showT);
    const was = rectOf(el);
    showT = setTimeout(() => { const at = reanchor(el, anchorItem(el)?.id, was); if (at) show(at, { via: 'hover' }); }, SHOW_MS);
  });
  document.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') pointer = { x: e.clientX, y: e.clientY }; },
    { passive: true });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const to = e.relatedTarget;
    const from = anchorOf(e.target);
    if (from && !(to && from.contains(to))) clearTimeout(showT);
    if (!cur || cur.pinned || cur.via === 'focus') return;
    const leaving = (from === cur.el || inBox(e.target)) && !(to && (cur.el.contains(to) || inBox(to)));
    if (leaving) hide();
  });

  // ---- touch: a long press (or a tap on an anchor that is no control), a tap outside closes --------------------------
  const cancelPress = () => { if (press) { clearTimeout(press.t); press = null; } };
  document.addEventListener('pointerdown', (e) => {
    cancelPress();
    if (!box.hidden && !inBox(e.target) && !(cur && cur.el.contains(e.target))) hide(true);
    if (e.pointerType !== 'touch' || inBox(e.target)) return;
    const el = anchorOf(e.target);
    if (!el || !anchorItem(el)) return;
    press = { el, x: e.clientX, y: e.clientY, long: false, t: setTimeout(() => {
      if (!press || press.el !== el) return;
      press.long = true;
      S.controller?.haptic?.('tick');
      show(el, { via: 'touch', pinned: true });
      swallowUntil = performance.now() + 900;
    }, TOUCH.longMs) };
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
  }, { passive: true });
  document.addEventListener('pointerup', (e) => {
    const p = press;
    cancelPress();
    if (!p || p.long || e.pointerType !== 'touch') return;
    // a quick tap: a chip that is only a picture opens its bubble; one inside a button does the button's job
    if (p.el.parentElement?.closest(CONTROL_SEL) || p.el.matches(CONTROL_SEL)) return;
    if (cur && cur.el === p.el) { hide(true); return; }
    show(p.el, { via: 'touch', pinned: true });
  }, { passive: true });
  document.addEventListener('pointercancel', cancelPress, { passive: true });
  document.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil && anchorOf(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
    swallowUntil = 0;
  }, true);
  // a held finger on a chip is not a request for the browser's own menu or text selection
  document.addEventListener('contextmenu', (e) => { if (anchorOf(e.target) && touchPlayer(S.controller)) e.preventDefault(); }, true);

  // ---- keyboard ----------------------------------------------------------------------------------------------------
  document.addEventListener('focusin', (e) => {
    const el = anchorOf(e.target);
    if (el && el === e.target && el.matches(':focus-visible')) show(el, { via: 'focus' });
    else if (cur && cur.via === 'focus' && !inBox(e.target)) hide(true);
  });
  document.addEventListener('focusout', (e) => {
    if (cur && cur.via === 'focus' && e.target === cur.el && !inBox(e.relatedTarget)) hide();
  });
  // capture on window, registered before the panels' Esc: the first Esc closes the bubble, not the panel under it
  window.addEventListener('keydown', (e) => {
    if (box.hidden || !cur) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); const el = cur.el; hide(true); if (el.isConnected && el.matches(':focus')) el.focus(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target === cur.el) {
      const first = box.querySelector('.ih-show');
      if (first) { e.preventDefault(); e.stopImmediatePropagation(); first.click(); }
    }
  }, true);

  // ---- keep it true: the barn changes under it, the panel scrolls, a panel opens or closes -------------------------
  const tick = () => {
    raf = 0;
    if (!cur || box.hidden) return;
    position();
    if (cur && !box.hidden && cur.el.isConnected) { render(cur.item); position(); }
  };
  const soon = () => { if (!raf && cur && !box.hidden) raf = requestAnimationFrame(tick); };
  // noFeed / keep: a class bubble's "not for feed" and "kept" lines (and their buttons) follow the Barn at once
  const TOPICS = ['inventory', 'objects', 'noFeed', 'keep', '*'];
  S.store?.on?.('change', (ch) => { if (TOPICS.some((t) => ch.topics.has(t))) soon(); });
  document.addEventListener('scroll', soon, { capture: true, passive: true });
  window.addEventListener('resize', soon, { passive: true });
  S.ui?.panels?.on?.('open', () => hide(true));
  S.ui?.panels?.on?.('close', () => { if (cur && !cur.el.isConnected) hide(true); });

  return { show: (el) => show(el, { via: 'focus', pinned: true }), hide: () => hide(true), refresh: soon, el: box,
    get current() { return cur ? { item: cur.item.id, pinned: cur.pinned, via: cur.via } : null; } };
}
