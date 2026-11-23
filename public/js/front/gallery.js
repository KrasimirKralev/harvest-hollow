// The landing page's screenshots (the "Screenshots" link): a picture viewer. A native <dialog> (focus kept inside, Esc
// closes, focus back on whatever opened it), each picture loaded only when shown (960 px on a phone, 1600 px on a
// large screen, by srcset), Previous / Next by button, arrow key or a swipe.
//
//   createGallery(shots, doc?) -> { open(i, opener), close() } | null
//        shots: [{ full, mid, caption, w, h }]   null when there are none or the browser has no <dialog>; `caption` may
//                                               be a getter: a language switch re-says the labels and the caption
import { t, onLang } from '../i18n/front.js';

export function createGallery(shots, doc = globalThis.document) {
  if (!shots?.length || typeof doc.createElement('dialog').showModal !== 'function') return null;
  const mk = (tag, cls, attrs = {}) => Object.assign(doc.createElement(tag), { className: cls }, attrs);
  const box = mk('dialog', 'ld-box');
  const img = mk('img', 'ld-box-img', { alt: '', decoding: 'async' });
  const cap = mk('p', 'ld-box-cap');
  const count = mk('p', 'ld-box-n');
  count.setAttribute('aria-live', 'polite');
  const btn = (cls, key, glyph) => {
    const b = mk('button', `ld-box-btn ${cls}`, { type: 'button', textContent: glyph });
    b.dataset.lk = key;
    return b;
  };
  const close = btn('ld-box-x', 'front.box.close', '✕');
  const prev = btn('ld-box-prev', 'front.box.prev', '‹');
  const next = btn('ld-box-next', 'front.box.next', '›');
  const frame = mk('figure', 'ld-box-fig');
  frame.append(img, mk('figcaption', 'ld-box-meta'));
  frame.lastChild.append(cap, count);
  box.append(frame, prev, next, close);
  doc.body.append(box);
  const label = () => {
    box.setAttribute('aria-label', t('front.box.label'));
    for (const b of [close, prev, next]) b.setAttribute('aria-label', t(b.dataset.lk));
  };
  label();

  let at = 0;
  let opener = null;
  function show(i) {
    at = (i + shots.length) % shots.length;
    const s = shots[at];
    img.removeAttribute('src');
    img.width = s.w;
    img.height = s.h;
    img.srcset = `${s.mid} 960w, ${s.full} 1600w`;
    img.sizes = 'min(94vw, 1400px)';
    img.src = s.mid;
    words();
  }
  /** The picture's words: its caption (also its alt text) and "Picture 2 of 5". */
  function words() {
    img.alt = shots[at].caption;
    cap.textContent = shots[at].caption;
    count.textContent = t('front.box.count', { n: at + 1, total: shots.length });
  }
  function open(i = 0, from = null) {
    opener = from;
    show(i);
    if (!box.open) box.showModal();
    close.focus({ preventScroll: true });
  }
  function shut() { if (box.open) box.close(); }
  box.addEventListener('close', () => { opener?.focus?.({ preventScroll: true }); });
  // a click on the dim backdrop (the dialog itself, outside the figure and the buttons) closes it
  box.addEventListener('click', (e) => { if (e.target === box) shut(); });
  close.addEventListener('click', shut);
  prev.addEventListener('click', () => show(at - 1));
  next.addEventListener('click', () => show(at + 1));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
  });
  let x0 = null;
  frame.addEventListener('pointerdown', (e) => { x0 = e.pointerType === 'mouse' ? null : e.clientX; });
  frame.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1));
  });
  onLang(() => { label(); if (box.open) words(); });
  return { open, close: shut };
}
