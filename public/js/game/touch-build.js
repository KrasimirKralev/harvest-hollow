// The build bar for touch (mobile wave 2026-10-03): three round buttons, ⟳ turn · ✕ cancel · ✓ put it here, riding
// under the ghost while a touch player places or moves something. A mouse player never sees it (R, a click and Esc
// do the same). Owned by the mobile input lane; main.js creates it after the controller.
//
//   createTouchBuild({ controller, view, ui?, doc? }) -> { el, visible, refresh() }   ui.layout.insets() (layout lane) says
//                                    how much of the bottom edge the HUD covers (the bar, Grandma's card): the bar
//                                    keeps above it
//   barSpot(rect, bar, viewport, avoid?) -> { x, y, above }   where the bar goes for a ghost's screen rect (pure,
//                                    tested): centred under the footprint, above it when there is no room below, inside
//                                    the viewport's safe margins, and beside (never over) the HUD's button column
//
// The buttons reuse the shell's `.btn` look (style.css); the few rules below only place the bar. The layout lane may
// move them into public/css (docs/agent-notes/mobile-input.md).
import { svgIcon } from '../ui/dom.js';
import { footprint } from '../../../shared/rules/grid.js';
import { defOf } from '../../../shared/content/index.js';
import { t, onLang, fmtNum } from '../i18n/index.js';
import { placeWhy } from '../ui/toolbar.js';

const CSS = `
.touch-build { position: fixed; left: 0; top: 0; z-index: 20; display: flex; gap: 14px; align-items: center;
  padding: 7px 10px; border-radius: 999px; background: rgba(62, 38, 18, .38); backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px); pointer-events: none; touch-action: manipulation; will-change: transform;
  animation: touch-build-in 180ms cubic-bezier(.34, 1.56, .64, 1) both; }
/* release 1.0: only the buttons take a finger; the tinted band between and under them lets it through to the farm (on
   a 360 x 640 phone the band lay over the piece just picked up, and a finger that meant to carry it scrolled the band:
   pointercancel, the e2e-mobile 'Small 360' step 9) */
.touch-build .btn { pointer-events: auto; }
.touch-build[hidden], .touch-build .btn[hidden] { display: none; }
.touch-build .btn--round { width: 52px; height: 52px; }
.touch-build .tb-place { width: 60px; height: 60px; }
.touch-build .glyph { pointer-events: none; }
/* wave 4 (owner wish C, "rotate discoverably"): each round button says what it does under it */
.touch-build { padding-bottom: 21px; }
.touch-build .btn--round { position: relative; overflow: visible; }
.touch-build .tb-cap { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); margin-top: 2px;
  font-size: 11px; font-weight: 700; line-height: 1.2; white-space: nowrap; color: #fff8e6; text-shadow: 0 1px 2px rgba(40, 22, 8, .9);
  pointer-events: none; letter-spacing: .01em; }
.touch-build .tb-place .tb-cap { margin-top: -2px; }   /* the bigger ✓ hangs 4 px lower: one line for the three words */
/* a red ghost says why under the bar, as a mouse player's hint does (QA r4 S4-06, S4-12) */
.touch-build .tb-why { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); width: max-content; max-width: min(300px, 92vw);
  padding: 3px 10px; border-radius: 999px; font: 700 13px/1.25 var(--font-ui); text-align: center; color: #fff; background: rgba(150, 30, 20, .9); }
@keyframes touch-build-in { from { opacity: 0; scale: .7; } to { opacity: 1; scale: 1; } }
@media (prefers-reduced-motion: reduce) { body:not(.motion-set) .touch-build { animation: none; } }
body.motion-reduced .touch-build { animation: none; }
`;

/**
 * Where the bar sits for a ghost whose footprint covers screen rect `rect` ({ left, top, right, bottom }, CSS px):
 * under it, or above it when the bottom of the screen (the tool tray) has no room; always inside the viewport's
 * margins. `bar` is the bar's { width, height }; `viewport` { width, height, bottomReserve? }.
 */
export function barSpot(rect, bar, viewport, avoid = []) {
  const gap = 14;
  const margin = 10;
  const reserve = viewport.bottomReserve ?? 96;               // the tool tray / dock along the bottom
  const cx = (rect.left + rect.right) / 2;
  let x = Math.min(viewport.width - margin - bar.width / 2, Math.max(margin + bar.width / 2, cx));
  let y = rect.bottom + gap;
  let above = false;
  if (y + bar.height > viewport.height - reserve) {
    above = true;
    y = rect.top - gap - bar.height;
  }
  y = Math.min(viewport.height - margin - bar.height, Math.max(margin, y));
  // a HUD column the bar would cover (the zoom / turn buttons): slide sideways out of it, to the side with room
  for (const a of avoid) {
    if (!a || !(a.right > a.left)) continue;
    const l = x - bar.width / 2;
    const r = x + bar.width / 2;
    if (r <= a.left - 6 || l >= a.right + 6 || y + bar.height <= a.top || y >= a.bottom) continue;
    const left = a.left - 8 - bar.width / 2;
    const right = a.right + 8 + bar.width / 2;
    x = left >= margin + bar.width / 2 ? left : right <= viewport.width - margin - bar.width / 2 ? right : x;
  }
  return { x: Math.round(x), y: Math.round(y), above };
}

export function createTouchBuild({ controller, view, ui = null, doc = document }) {
  if (!doc.getElementById('touch-build-css')) {
    const st = doc.createElement('style');
    st.id = 'touch-build-css';
    st.textContent = CSS;
    doc.head.append(st);
  }
  // label / caption are catalog keys: a language switch re-labels the bar (relabel below)
  const mk = (cls, label, glyph, fn, caption = label) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `btn btn--round ${cls}`;
    b.dataset.label = label;
    b.dataset.caption = caption;
    b.append(svgIcon(glyph, cls.includes('tb-place') ? 34 : 28));
    const cap = doc.createElement('span');
    cap.className = 'tb-cap';
    cap.setAttribute('aria-hidden', 'true');
    b.append(cap);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const turn = mk('btn--wood tb-turn', 'game.build.rotateIt', 'rotr', () => controller.rotate(), 'game.build.rotate');
  const cancel = mk('btn--stop tb-cancel', 'common.cancel', 'close', () => controller.cancel(), 'common.cancel');
  const place = mk('tb-place', 'game.build.putHere', 'check', () => controller.confirm(), 'game.build.place');
  // Del on a keyboard: a piece being moved goes into storage (mobile QA M-06: a phone had no way to put one away)
  const away = mk('btn--wood tb-away', 'game.build.putAway', 'crate', () => controller.storeHeld?.(), 'game.build.away');
  const el = doc.createElement('div');
  el.className = 'touch-build';
  el.id = 'touch-build';
  el.setAttribute('role', 'toolbar');
  const relabel = () => {
    for (const b of [turn, cancel, place, away]) {
      b.setAttribute('aria-label', t(b.dataset.label));
      b.title = t(b.dataset.label);
      b.querySelector('.tb-cap').textContent = t(b.dataset.caption);
    }
    el.setAttribute('aria-label', t('game.build.placing'));
  };
  relabel();
  onLang(relabel);
  el.hidden = true;
  away.hidden = true;
  const why = doc.createElement('span');
  why.className = 'tb-why';
  why.setAttribute('role', 'status');
  why.hidden = true;
  el.append(away, turn, cancel, place, why);
  doc.body.append(el);

  let last = null;                // the controller's latest 'build' event
  // the HUD's button column on the right edge (zoom, turn): measured at most twice a second, not per frame
  let avoid = [];
  let bottom = null;              // CSS px of the bottom edge the HUD covers (ui.layout.insets), when the ui knows
  let avoidAt = -Infinity;
  const avoidRects = () => {
    const t = performance.now();
    if (t - avoidAt > 500) {
      avoidAt = t;
      const col = doc.getElementById('hud-right');
      const r = col && !col.closest('[hidden]') ? col.getBoundingClientRect() : null;
      avoid = r && r.width ? [{ left: r.left, right: r.right, top: r.top, bottom: r.bottom }] : [];
      try { const b = ui?.layout?.insets?.().bottom; bottom = Number.isFinite(b) ? b : null; } catch { bottom = null; }
    }
    return avoid;
  };
  let visible = false;
  let lastT = '';

  function refresh() {
    const b = last;
    const show = controller.input === 'touch' && Boolean(b) && !b.pickUp && Number.isFinite(b.x) && Number.isFinite(b.z);
    if (show !== visible) {
      visible = show;
      el.hidden = !show;
      lastT = '';
      avoidAt = -Infinity;                                       // measure the HUD again when the bar comes up
    }
    if (!show) return;
    // a red ghost cannot go down: the ✓ says so, and the line under the bar says why
    place.setAttribute('aria-disabled', String(!b.valid));
    const w = placeWhy(b);
    if (why.textContent !== w) { why.textContent = w; why.hidden = !w; lastT = ''; }
    // a bought piece says its price on the ✓ ("Place · 270", QA r1 S-06): ✓ again must never spend in silence
    const priced = !b.moveId && Number.isFinite(b.cost) && b.cost > 0;
    const cap = priced ? t('dock.build.placeCost', { coins: fmtNum(b.cost) }) : t(place.dataset.caption);
    if (place.querySelector('.tb-cap').textContent !== cap) place.querySelector('.tb-cap').textContent = cap;
    place.setAttribute('aria-label', priced ? t('dock.build.placeCostLabel', { coins: fmtNum(b.cost) })
      : t(b.moveId ? 'game.build.putHere' : 'game.build.placeHere'));
    cancel.setAttribute('aria-label', t(b.moveId ? 'game.build.leave' : 'common.cancel'));
    // only decor goes back into the tray (a Masterwork piece neither): a building or a landmark has no "Put it away"
    const canAway = Boolean(b.moveId) && typeof controller.storeHeld === 'function' && b.storable === true;
    if (away.hidden === canAway) { away.hidden = !canAway; lastT = ''; }
    position();
  }

  function position() {
    const b = last;
    if (!visible || !b || typeof view.toScreen !== 'function') return;
    const def = defOf(b.def);
    const [w, d] = def ? footprint(def, b.rot ?? 0) : [1, 1];
    const pts = [[b.x, b.z], [b.x + w, b.z], [b.x, b.z + d], [b.x + w, b.z + d]].map(([x, z]) => view.toScreen(x, z, 0));
    if (pts.some((p) => !p || !Number.isFinite(p.x))) return;
    const rect = { left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)),
      top: Math.min(...pts.map((p) => p.y)) - 24, bottom: Math.max(...pts.map((p) => p.y)) };
    const vw = doc.documentElement.clientWidth || globalThis.innerWidth;
    const vh = globalThis.visualViewport ? globalThis.visualViewport.height : globalThis.innerHeight;
    const shun = avoidRects();
    const reserve = bottom !== null ? bottom + 8 : vh < 500 ? 70 : 110;
    const h = (el.offsetHeight || 66) + (why.hidden ? 0 : why.offsetHeight);
    const spot = barSpot(rect, { width: el.offsetWidth || 200, height: h }, { width: vw, height: vh, bottomReserve: reserve }, shun);
    const t = `translate3d(${Math.round(spot.x - (el.offsetWidth || 200) / 2)}px, ${spot.y}px, 0)`;
    if (t !== lastT) { el.style.transform = t; lastT = t; }
  }

  controller.on('build', (e) => { last = e; refresh(); });
  controller.on('input', refresh);
  controller.on('tool', () => { if (!controller.tool.build) last = null; refresh(); });
  view.onFrame(position);
  return { el, get visible() { return visible; }, refresh };
}
