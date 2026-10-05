// Drag to reorder a workshop queue (owner wish 5, wave 4b): the waiting items (from the 2nd onwards; the running one
// stays first) are dragged to a new place. A mouse drags at once (after 6 px); a finger holds still for 380 ms first
// (the sheet keeps scrolling under a quick swipe), then drags. A drop mark shows where the item will go; Esc or a
// cancelled touch puts it back. The ◀ ▶ buttons on each card do the same one step at a time (keyboard and touch).
//
//   insertionIndex(rects, x, y) -> n     where a card dropped at (x, y) lands among the other waiting cards (pure; tests)
//   attachQueueDrag(container, { selector, keyOf(el), onDrop(key, index), onState?(dragging) }) -> detach()
const HOLD_MS = 380;
const MOUSE_SLOP = 6;
const TOUCH_SLOP = 9;

/**
 * Where a card dropped at screen point (x, y) lands among the other waiting cards (`rects` in queue order, wrapping rows
 * left to right): the number of cards that come before the point in reading order. Pure.
 * @param {{ left: number, top: number, width: number, height: number }[]} rects
 */
export function insertionIndex(rects, x, y) {
  let n = 0;
  for (const r of rects) {
    if (y < r.top) break;                               // the point is on an earlier row than this card
    if (y > r.top + r.height || x > r.left + r.width / 2) n++;
    else break;
  }
  return n;
}

export function attachQueueDrag(container, { selector, keyOf, onDrop, onState = () => {} }) {
  let pend = null;            // { id, card, x, y, touch, timer, pan?, ly }
  let drag = null;            // { id, card, key, x0, y0, others, rects, index, mark }
  let swallowClick = false;

  const rectsOf = (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });

  function begin(e) {
    const card = pend.card;
    const cards = [...container.querySelectorAll(selector)];
    const others = cards.filter((c) => c !== card);
    if (!others.length || !card.isConnected) { pend = null; return; }
    clearTimeout(pend.timer);
    drag = { id: pend.id, card, key: keyOf(card), x0: pend.x, y0: pend.y, others, rects: rectsOf(others), index: cards.indexOf(card),
      mark: document.createElement('span'), touch: pend.touch, t0: pend.t0, far: 0 };
    pend = null;
    drag.mark.className = 'pn-drop-mark';
    drag.mark.setAttribute('aria-hidden', 'true');
    container.append(drag.mark);
    card.classList.add('dragging');
    container.classList.add('pn-dragging');
    try { container.setPointerCapture(drag.id); } catch { /* the pointer is gone */ }
    try { globalThis.navigator?.vibrate?.(12); } catch { /* no haptics */ }
    onState(true);
    move(e);
  }

  function move(e) {
    if (!drag) return;
    drag.far = Math.max(drag.far, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
    drag.card.style.translate = `${Math.round(e.clientX - drag.x0)}px ${Math.round(e.clientY - drag.y0)}px`;
    const i = insertionIndex(drag.rects, e.clientX, e.clientY);
    drag.index = i;
    // the mark stands in the gap before card i (or after the last one)
    const box = container.getBoundingClientRect();
    const r = drag.rects[Math.min(i, drag.rects.length - 1)];
    const left = i < drag.rects.length ? r.left - 6 : r.left + r.width + 4;
    drag.mark.style.transform = `translate(${Math.round(left - box.left + container.scrollLeft)}px, ${Math.round(r.top - box.top + container.scrollTop)}px)`;
    drag.mark.style.height = `${Math.round(r.height)}px`;
  }

  function end(drop, tap = false) {
    if (pend) { clearTimeout(pend.timer); pend = null; }
    if (!drag) return;
    const d = drag;
    if (tap) drop = false;
    drag = null;
    d.card.classList.remove('dragging');
    d.card.style.translate = '';
    d.mark.remove();
    container.classList.remove('pn-dragging');
    try { container.releasePointerCapture(d.id); } catch { /* released */ }
    if (!tap) {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
    }
    onState(false);
    if (drop && d.card.isConnected) onDrop(d.key, d.index);
  }

  const onDown = (e) => {
    if (drag || pend || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const card = e.target.closest?.(selector);
    if (!card || !container.contains(card) || e.target.closest('button, a, input')) return;
    const touch = e.pointerType !== 'mouse';
    pend = { id: e.pointerId, card, x: e.clientX, y: e.clientY, touch, timer: 0, t0: e.timeStamp };
    if (touch) {
      card.classList.add('pn-holding');
      pend.timer = setTimeout(() => { card.classList.remove('pn-holding'); if (pend && pend.card === card) begin({ clientX: pend.x, clientY: pend.y }); }, HOLD_MS);
    }
  };
  const onMove = (e) => {
    if (drag) { if (e.pointerId === drag.id) move(e); return; }
    if (!pend || e.pointerId !== pend.id) return;
    const far = Math.hypot(e.clientX - pend.x, e.clientY - pend.y);
    if (pend.touch) {
      // a finger that moves before the hold is a scroll. The cards take no browser panning (touch-action: none, or a
      // held finger could never drag on Chrome / Safari), so the sheet is scrolled here, by the finger's own travel
      if (!pend.pan && far > TOUCH_SLOP) { pend.card.classList.remove('pn-holding'); clearTimeout(pend.timer); pend.pan = true; pend.ly = pend.y; }
      if (pend.pan) {
        const sc = container.closest?.('.hh-panel-scroll');
        if (sc) sc.scrollTop += pend.ly - e.clientY;
        pend.ly = e.clientY;
      }
      return;
    }
    if (far > MOUSE_SLOP) begin(e);
  };
  const onUp = (e) => {
    if (pend && e.pointerId === pend.id) {
      pend.card.classList.remove('pn-holding');
      if (pend.pan) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 0); }
    }
    // a busy phone can run the hold timer before it delivers a quick tap's lift: a lift sooner than the hold, that never
    // moved, was a tap after all (no drop; its click picks the card)
    const tap = Boolean(drag && drag.touch && e.timeStamp - drag.t0 < HOLD_MS && drag.far < TOUCH_SLOP);
    if ((drag && e.pointerId === drag.id) || (pend && e.pointerId === pend.id)) end(e.type === 'pointerup', tap);
  };
  // while a finger drags, the sheet must not scroll under it (a non-passive listener; it does nothing otherwise)
  const onTouchMove = (e) => { if (drag && e.cancelable) e.preventDefault(); };
  const onClick = (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } };
  const onKey = (e) => { if (drag && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); } };
  const onMenu = (e) => { if (pend?.touch || drag) e.preventDefault(); };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('click', onClick, true);
  container.addEventListener('contextmenu', onMenu);
  globalThis.addEventListener?.('keydown', onKey, true);
  return {
    active: () => Boolean(drag),
    detach() {
      end(false);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('click', onClick, true);
      container.removeEventListener('contextmenu', onMenu);
      globalThis.removeEventListener?.('keydown', onKey, true);
    },
  };
}
