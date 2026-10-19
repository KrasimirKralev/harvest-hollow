// Sideways rows for a mouse (owner 2026-10-19: "Give me a way so i can scroll the seeds and the menus sideways where it
// does apply"). A finger already swipes every row below and a keyboard walks their buttons (a focused item scrolls into
// view); a mouse had a hidden or a thin scrollbar only, so the quick-seed strip's last seeds could not be reached. For
// every row in ROWS that runs past its edge:
//   - the wheel scrolls it sideways until its end; a sideways wheel or trackpad swipe, Shift + wheel and Ctrl + wheel
//     stay the browser's, and a wheel gesture that began on the sheet keeps scrolling the sheet;
//   - a mouse drag scrolls it: past DRAG_SLOP px the press is a drag, and the click that ends it is swallowed, so a
//     drag over the seed strip never picks a seed (the workshop queue's own drag, fields and sliders keep theirs);
//   - an edge with more fades (css: .hs-l / .hs-r) and, while the mouse is over the row, a ‹ / › button there scrolls
//     about one page. The rows in OWN_CUE already draw their own arrows or ‹ › cue (toolbar.js, ui/index.js tabs,
//     league-kit.js hub): they get the wheel and the drag, and the hub's cue answers a click like the tabs' does.
// The buttons live in ONE overlay (.hs-pair) put beside the hovered row, in the same parent: inside the seed picker,
// the sheet or the bar, so their "a press elsewhere closes me" hooks see a press on an arrow as theirs, and no tablist
// or list gets a stranger for a child. Not a tab stop (a scrollbar is none either): the keyboard reaches every item.
// Loaded after the HUD is up (ui/hud.js, through net/lazy.js): nothing of it is in the boot's eager graph.
//
//   installHscroll() -> api        once per page (a second call returns the same api)
//   edgesOf(el) -> { l, r }        which edges have more (pure: reads scrollLeft / scrollWidth / clientWidth)
//   pagePx(width) -> px            one arrow press (pure)
//   wheelPx(e, page) -> px         the sideways distance of a wheel event, 0 when it is not this helper's (pure)
import { h } from './dom.js';
import { t } from '../i18n/index.js';

/** Every row of the game's UI that scrolls sideways (css overflow-x: auto; test/ui-hscroll.test.js keeps it whole). */
export const ROWS = ['.seed-strip', '.seed-tray', '.hh-tabs', '.up-strip', '.lg-hub', '.lg-track', '.pn-quick',
  '.pn-slots', '.sp-grid', '.wk-village-wrap'].join(', ');
/** Rows that draw their own arrows or cue: no overlay, no fade classes. */
export const OWN_CUE = '.seed-tray, .hh-tabs, .lg-hub';
/** The rows this helper draws arrows and fades for. */
export const ARROW_ROWS = '.seed-strip, .up-strip, .lg-track, .pn-quick, .pn-slots, .sp-grid, .wk-village-wrap';
/** Presses that are not a drag of the row: fields, sliders, the workshop queue's own drag (panels/queue-drag.js). */
const NOT_A_DRAG = ['input', 'textarea', 'select', '[contenteditable="true"]', '[draggable="true"]', '[role="slider"]',
  '.pn-slot.queued[data-k]'].join(', ');
export const DRAG_SLOP = 6;
const EDGE = 2;           // px of slack at either end (fractional widths)
const LINE_PX = 40;       // one wheel "line" (Firefox reports lines)
const LATCH_MS = 300;     // wheel events closer than this are one gesture
const CUE_PX = 34;        // the frame tabs' and the hub's ‹ › cue width (shell.css, panels-league.css)

/** Which edges of a sideways row have more past them. Pure. */
export function edgesOf({ scrollLeft = 0, scrollWidth = 0, clientWidth = 0 } = {}) {
  const max = scrollWidth - clientWidth;
  return { l: max > EDGE && scrollLeft > EDGE, r: max > EDGE && scrollLeft < max - EDGE };
}

/** One arrow press: about one page, the item cut at the edge stays in view. Pure. */
export const pagePx = (width) => Math.max(60, Math.round(width * 0.8));

/** The sideways px of a wheel event over a row (0: leave it to the browser). Pure. */
export function wheelPx(e, page) {
  // Ctrl / Meta + wheel zooms; Shift + wheel is the browser's own sideways wheel
  if (!e || e.ctrlKey || e.metaKey || e.shiftKey) return 0;
  const dx = Number(e.deltaX) || 0;
  const dy = Number(e.deltaY) || 0;
  if (Math.abs(dx) >= Math.abs(dy)) return 0;                         // a sideways wheel or swipe scrolls natively
  return dy * (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? page : 1);
}

let api = null;

export function installHscroll() {
  if (api || typeof document === 'undefined') return api;
  const doc = document;
  const rowOf = (el, sel = ROWS) => (el && typeof el.closest === 'function' ? el.closest(sel) : null);
  const shown = (el) => Boolean(el && el.isConnected && !el.closest('[hidden]') && el.getClientRects().length);
  const still = () => doc.body.classList.contains('motion-reduced');
  // a row scrolls only where css lets it (a phone's market slip wraps instead; the village strip clips on a desktop)
  const scrolls = (row) => /auto|scroll/.test(getComputedStyle(row).overflowX);
  const more = (row) => (scrolls(row) ? edgesOf(row) : { l: false, r: false });

  // ---- gliding: wheel notches and arrow presses add up while the last glide runs ----------------------------------
  const aim = new WeakMap();      // row -> { to, at }
  function glide(row, dx) {
    const now = performance.now();
    const max = Math.max(0, row.scrollWidth - row.clientWidth);
    const a = aim.get(row);
    const from = a && now - a.at < 250 ? a.to : row.scrollLeft;
    const to = Math.max(0, Math.min(max, from + dx));
    aim.set(row, { to, at: now });
    // a trackpad's many small steps go straight (they are smooth already); a notch or a page glides
    row.scrollTo({ left: to, behavior: still() || Math.abs(dx) < 30 ? 'auto' : 'smooth' });
  }

  // ---- the wheel --------------------------------------------------------------------------------------------------
  // Each row gets its own non-passive listener (attached when it is first seen, below): a blocking listener on the
  // document would make every sheet's wheel scroll wait for the main thread. The document only notes the time.
  let wheelAt = -Infinity;
  let wheelRow = null;            // the row the running gesture belongs to (null: the sheet, the farm)
  let wheelAte = false;           // this gesture moved its row
  doc.addEventListener('wheel', (e) => {
    // a gesture that began off every row (the sheet, the farm) stays there while it runs
    if (!rowOf(e.target)) { if (e.timeStamp - wheelAt >= LATCH_MS) wheelRow = null; wheelAt = e.timeStamp; }
  }, { passive: true, capture: true });
  function onWheel(e) {
    const row = e.currentTarget;
    const gap = e.timeStamp - wheelAt;
    wheelAt = e.timeStamp;
    if (gap < LATCH_MS && row !== wheelRow) return;
    if (gap >= LATCH_MS) { wheelRow = row; wheelAte = false; }
    const dx = wheelPx(e, pagePx(row.clientWidth));
    if (!dx) return;
    const { l, r } = more(row);
    if (dx > 0 ? !r : !l) {
      // its end: a fresh gesture scrolls the sheet under it; the one that brought it here does not spill over
      if (wheelAte) e.preventDefault();
      return;
    }
    e.preventDefault();
    wheelAte = true;
    glide(row, dx);
  }
  const seen = new WeakSet();
  function adopt(row) {
    if (seen.has(row)) return;
    seen.add(row);
    row.addEventListener('wheel', onWheel, { passive: false });
  }

  // ---- the drag ---------------------------------------------------------------------------------------------------
  let press = null;               // { row, id, x, left, moved }
  let swallow = false;
  doc.addEventListener('pointerdown', (e) => {
    press = null;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const row = rowOf(e.target);
    if (!row || e.target.closest(NOT_A_DRAG)) return;
    const { l, r } = more(row);
    if (!l && !r) return;
    press = { row, id: e.pointerId, x: e.clientX, left: row.scrollLeft, moved: false };
  }, { capture: true, passive: true });
  addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.moved && e.buttons !== 1) { press = null; return; }   // the button came up outside the window
    const dx = e.clientX - press.x;
    if (!press.moved) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      press.moved = true;
      press.row.classList.add('hs-drag');
      try { press.row.setPointerCapture(press.id); } catch { /* the pointer is gone */ }
      try { getSelection()?.removeAllRanges(); } catch { /* no selection API */ }
    }
    press.row.scrollLeft = press.left - dx;
  }, { passive: true });
  const end = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (!p.moved) return;
    p.row.classList.remove('hs-drag');
    try { p.row.releasePointerCapture(p.id); } catch { /* released */ }
    // the click this lift makes (on the seed under the hand, or on the row) is the drag's, not a pick (queue-drag.js
    // swallows its own the same way)
    swallow = true;
    setTimeout(() => { swallow = false; }, 0);
  };
  addEventListener('pointerup', end, true);
  addEventListener('pointercancel', end, true);
  addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // a press on a row that may become a drag selects no text and drags no picture
  doc.addEventListener('selectstart', (e) => { if (press) e.preventDefault(); }, true);
  doc.addEventListener('dragstart', (e) => { if (press) e.preventDefault(); }, true);

  // ---- the hub's ‹ › cue answers a click like the frame tabs' (ui/index.js) ----------------------------------------
  doc.addEventListener('click', (e) => {
    const s = e.target;
    if (!s || typeof s.matches !== 'function' || !s.matches('.lg-hub')) return;
    const b = s.getBoundingClientRect();
    const dir = e.clientX > b.right - CUE_PX && s.classList.contains('more-r') ? 1
      : e.clientX < b.left + CUE_PX && s.classList.contains('more-l') ? -1 : 0;
    if (dir) glide(s, dir * pagePx(s.clientWidth));
  });

  // ---- the arrows: one pair beside the hovered row ----------------------------------------------------------------
  let cur = null;
  const arrow = (dir) => h(`button.hs-arrow.${dir < 0 ? 'hs-left' : 'hs-right'}`, {
    type: 'button', tabindex: '-1',
    on: { click: () => { if (cur) glide(cur, dir * pagePx(cur.clientWidth)); } },
  }, h('span', { 'aria-hidden': 'true' }, dir < 0 ? '‹' : '›'));
  const left = arrow(-1);
  const right = arrow(1);
  const pair = h('div.hs-pair', left, right);
  /** Lays the pair on the hovered row (`box`: its box too; a scroll of the row only changes which arrows show). */
  function place(box = true) {
    if (!cur) return;
    if (!shown(cur)) { hide(); return; }
    const { l, r } = more(cur);
    if (!l && !r) { hide(); return; }
    if (cur.nextSibling !== pair) { cur.after(pair); box = true; }
    if (box) {
      // the row's own box in its parent's px (the pair shares its offset parent, its zoom and its scroll)
      pair.style.left = `${cur.offsetLeft}px`;
      pair.style.top = `${cur.offsetTop}px`;
      pair.style.width = `${cur.offsetWidth}px`;
      pair.style.height = `${cur.offsetHeight}px`;
      // a transformed box between the row and its offset parent (a tilted card) moves the pair's containing block:
      // one correction by the drawn boxes (not while the row itself animates in: its drawn box is not its place)
      if (!cur.getAnimations?.().some((a) => a.playState === 'running')) {
        const pr = pair.getBoundingClientRect();
        const rr = cur.getBoundingClientRect();
        const k = pr.width / (cur.offsetWidth || 1) || 1;
        const dx = (rr.left - pr.left) / k;
        const dy = (rr.top - pr.top) / k;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          pair.style.left = `${cur.offsetLeft + dx}px`;
          pair.style.top = `${cur.offsetTop + dy}px`;
        }
      }
    }
    if (left.hidden !== !l) left.hidden = !l;
    if (right.hidden !== !r) right.hidden = !r;
    left.setAttribute('aria-label', t('shell.scroll.left'));
    right.setAttribute('aria-label', t('shell.scroll.right'));
  }
  function hide() {
    cur = null;
    pair.remove();
  }
  doc.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || pair.contains(e.target)) return;
    const row = rowOf(e.target, ARROW_ROWS);
    if (row === cur) return;
    if (!row) { if (cur) hide(); return; }
    cur = row;
    mark(row);
    place();
  }, { passive: true });
  doc.addEventListener('pointerout', (e) => { if (!e.relatedTarget && cur) hide(); }, { passive: true });

  // ---- the fades: .hs-l / .hs-r on a row with more past that edge -------------------------------------------------
  function mark(row) {
    if (!row.matches(ARROW_ROWS)) return;
    const { l, r } = shown(row) ? more(row) : { l: false, r: false };
    row.classList.toggle('hs-l', l);
    row.classList.toggle('hs-r', r);
  }
  const dirty = new Set();
  let flushing = 0;
  function flush() {
    flushing = 0;
    for (const row of dirty) if (row.isConnected) mark(row);
    dirty.clear();
    if (cur) place();
  }
  function touch(row) {
    adopt(row);
    if (!row.matches(ARROW_ROWS)) return;
    dirty.add(row);
    if (!flushing) flushing = requestAnimationFrame(flush);
  }
  const touchAll = (root) => {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(ROWS)) touch(root);
    for (const row of root.querySelectorAll(ROWS)) touch(row);
  };
  doc.addEventListener('scroll', (e) => {
    const el = e.target;
    if (el?.nodeType !== 1 || !el.matches(ARROW_ROWS)) return;
    mark(el);
    if (el === cur) place(false);
  }, { capture: true, passive: true });
  // a row drawn, re-drawn (its items replaced), shown or hidden: it is adopted (the wheel) and its fades follow on the
  // next frame
  if (typeof MutationObserver === 'function') {
    new MutationObserver((records) => {
      for (const rec of records) {
        const el = rec.target;
        if (rec.type === 'attributes') {
          touchAll(el);
          if (cur && el.contains(cur)) touch(cur);
          continue;
        }
        const row = rowOf(el);
        if (row) touch(row);
        for (const n of rec.addedNodes) touchAll(n);
      }
    }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  addEventListener('resize', () => { touchAll(doc.body); }, { passive: true });
  touchAll(doc.body);

  api = { refresh: (row) => (row ? touch(row) : touchAll(doc.body)), get hovered() { return cur; } };
  return api;
}

export default installHscroll;
