// Toasts, notices and non-modal banners (GDD §7.2 "never a red flash", §6.3 "got there first", §7.4 unlock cards).
// life-feel lane.
//   toast(codeOrText, { by?, kind?, icon?, ms?, action? })  a short line (3 s, at most 3); an ERR code says friendly
//     words; a lost race against the partner says "Mia got there first ♥" (coalesced). `action: { label, fn }` adds a
//     button; such a line lives in #snacks, above open panels, where it stays pressable
//   notice(text, { action? })   a longer line with OK (15 s)
//   banner({ ribbon, things, message, quote?, actions, ttl, kind, id?, urgent?, over?, ring? })  a card in the right
//     column; never takes focus; hover or focus pauses it; one that does not fit waits its turn ("+N more")
//   duetAsk(ev, partner, { join }), bloom({ crops, trees, animals }), closeBanner(id)
// M4: a line the open panel would hide goes to #over-panels (z 50); a card raised under a panel waits for it to close
// (a reward pip shows on the panel's title meanwhile); 'hh:toast', 'hh:card', 'hh:pip' tell the sound layer.
// QA r2 (L2-02 .. L2-05): every line keeps clear of the HUD it would cover, from one floor list (the bottom HUD) and
// one ceiling list (the top HUD), re-checked while it is up; never on an open panel's body; never cut by a side panel.
import { SAFETY, CONTENT } from '../../../shared/content/index.js';
import { ERR } from '../../../shared/net/protocol.js';
import { h, icon, svgIcon } from './dom.js';
import { LAYOUT_Q } from './layout.js';
import { t, tn, list, N, name as cname, onLang, retell } from '../i18n/index.js';

/** A text as it reads now: a string, or a function that says it (a language switch asks it again). */
const say = (v) => (typeof v === 'function' ? v() : v);
/** How to say a text again after a language switch: the function given, else the catalog line i18n made it from. */
const sayer = (v) => (typeof v === 'function' ? v : retell(v));

// (QA r2 I2-01: BLOCKED with `by` is a tile the partner built on first)
const RACE_CODES = new Set([ERR.EMPTY, ERR.OCCUPIED, ERR.NOT_FOUND, ERR.NOT_READY, ERR.ALREADY_DONE, ERR.BLOCKED]);
/** QA r1 I-01: a board row that is gone, with nobody to name, says what happened, not the harvest error: action ->
 *  [the codes that mean "someone already did it", the line]. */
const GONE_LINE = {
  orderFill: [new Set([ERR.EMPTY, ERR.NOT_FOUND]), 'cheer.gone.delivered'],
  folkFill: [new Set([ERR.ALREADY_DONE]), 'cheer.gone.delivered'],
  bargeLoad: [new Set([ERR.ALREADY_DONE]), 'cheer.gone.loaded'],
};
const KIND_GLYPH = { info: 'i', warn: '!', love: '♥', ok: '✓' };

/** A card's longest stay on a phone (ms): it covers a third of the farm there. */
const PHONE_CARD_MS = 10_000;

/** QA r1 L-02: how long a card that just came in lets touches through to the farm (ms). */
export const ENTRY_GRACE_MS = 600;
/** L-02: after a farm stroke ends, how long cards still let touches through, and a new card waits (ms). */
export const STROKE_GAP_MS = 1000;
/** L-02: the longest a card waits for a run of strokes to pause (ms). */
export const STROKE_WAIT_MS = 5000;

/** Card kinds that fold into a slim chip on a phone (wave 4b: system cards covered a third of the screen); a tap opens it. */
export const COMPACT_KINDS = Object.freeze(new Set(['card']));
/** Does a card of `kind` fold into a chip here (phone: the phone layout query matches)? Pure. */
export const compactCard = (kind, { phone = false, urgent = false } = {}) => Boolean(phone && !urgent && COMPACT_KINDS.has(kind));

/** The Level-up Bloom card's headline (owner rule 2026-10-04: a new farm level finishes everything growing). */
// the English source (tests); the card shows t('toasts.bloom.title') in the language in effect
export const BLOOM_TITLE = 'New level! Everything on the farm is ready 🌾'; // i18n-ok: = en/toasts.js 'toasts.bloom.title'

/** The Bloom card's second line: "12 crops, 2 trees and 3 animals finished growing." (pure) */
export function bloomLine({ crops = 0, trees = 0, animals = 0 } = {}) {
  const parts = [[crops, 'crop'], [trees, 'tree'], [animals, 'animal']].filter(([n]) => n > 0)
    .map(([n, w]) => tn(`toasts.bloom.${w}`, n));
  if (!parts.length) return t('toasts.bloom.none');
  // "a, b and c" (English without the serial comma, as always; Bulgarian "a, b и c")
  const joined = parts.length === 1 ? parts[0] : t('toasts.bloom.and', { list: parts.slice(0, -1).join(', '), last: parts.at(-1) });
  return tn('toasts.bloom.line', crops + trees + animals, { list: joined });
}

/** Which kind (colour + glyph) a code's toast uses. Refusals are information, never alarms. */
export function kindOf(code) {
  if (code === ERR.OFFLINE || code === ERR.INTERNAL || code === ERR.RATE) return 'warn';
  return 'info';
}

/** Does the rectangle `r` contain the point (x, y)? Pure. */
const inRect = (r, x, y) => Boolean(r) && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
/** Do two rectangles overlap? Pure. */
const overlaps = (a, b) => Boolean(a && b) && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** QA r2: is `el` on screen (laid out, not hidden)? */
const shows = (el) => Boolean(el) && !el.hidden && typeof el.getClientRects === 'function' && el.getClientRects().length > 0
  && globalThis.getComputedStyle?.(el)?.visibility !== 'hidden';
/** QA r2: the bottom HUD a line stays above (the coach card, the tray row: trays, placement bar, planting chip, tool
 *  flyout, seed strips, toolbar / phone bar; the dock, the seed picker, the Undo chip), as rectangles of what shows. */
function floorBoxes() {
  const out = [];
  const add = (el) => { if (shows(el)) out.push(el.getBoundingClientRect()); };
  add(document.querySelector('#coach-slot .coach'));
  for (const el of document.getElementById('tray-wrap')?.children ?? []) if (el.id !== 'coach-slot') add(el);
  add(document.getElementById('toolbar'));
  add(document.getElementById('dock'));
  for (const el of document.querySelectorAll('.seed-pop, .undo-chip')) add(el);
  return out;
}
/** The top HUD a line must stay below: the buffs (Golden Hour), the bench chip, the duel chip. */
function ceilingBoxes() {
  const out = [];
  for (const el of document.getElementById('hud-buffs')?.children ?? []) if (shows(el)) out.push(el.getBoundingClientRect());
  for (const el of document.querySelectorAll('.bench-chip, .lg-duel-chip')) if (shows(el)) out.push(el.getBoundingClientRect());
  return out;
}
/** The foot a line `hgt` tall, spanning [left, right], needs to sit above every box it would lie on (from `foot` up). */
export function footAbove(foot, hgt, left, right, boxes, gap = 10) {
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const b of boxes) {
      if (b.right <= left || b.left >= right || !(foot - hgt < b.bottom && foot > b.top - gap)) continue;
      foot = b.top - gap;
      moved = true;
    }
    if (!moved) break;
  }
  return foot;
}
/** The top a line needs to sit below every box it would lie on (from `top` down). */
export function topBelow(top, hgt, left, right, boxes, gap = 8) {
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const b of boxes) {
      if (b.right <= left || b.left >= right || !(top < b.bottom + gap && top + hgt > b.top)) continue;
      top = b.bottom + gap;
      moved = true;
    }
    if (!moved) break;
  }
  return top;
}

/** QA r3 L3-01: reset, measure and write a layer's place with its transitions off (reduced motion's 1 ms transition
 *  made the read see the old rect: lines flipped onto the toolbar); the write is committed before they come back. */
export function still(el, fn) {
  const was = el?.style?.transition ?? '';
  if (el?.style) el.style.transition = 'none';
  try { return fn(); } finally {
    el?.getBoundingClientRect?.();
    if (el?.style) el.style.transition = was;
  }
}

/** Tell the sound layer (feedback.js) without a coupling: a window CustomEvent. */
function signal(name, detail) {
  try { globalThis.dispatchEvent?.(new CustomEvent(name, { detail })); } catch { /* no window (tests) */ }
}

export function createToasts(S, errText) {
  const box = document.getElementById('toasts');
  const banners = document.getElementById('banners');
  let race = null;                     // { el, by, n, t }

  // ---- M4: the layer above the panels, and what an open panel covers ------------------------------------------------
  const panels = () => S.ui?.panels ?? null;
  const topPanel = () => panels()?.top?.() ?? null;
  const isPhone = () => Boolean(globalThis.matchMedia?.(LAYOUT_Q.phone)?.matches);
  let over = null;
  function overLayer() {
    if (over && over.root.isConnected) return over;
    const root = h('div#over-panels');
    const toastsEl = h('div.toasts.over-toasts', { role: 'status', 'aria-live': 'polite' });
    const bannersEl = h('div.banners.over-banners');
    root.append(toastsEl, bannersEl);
    document.body.append(root);
    over = { root, toasts: toastsEl, banners: bannersEl };
    return over;
  }
  /** The open panel's frame (the shell builds `#panel-<name>`), or null. */
  const frameOf = (name) => (name ? document.getElementById(`panel-${name}`) : null);
  /** Does the top panel cover the spot `el` (or the top centre) shows at? A modal panel always does (its scrim). */
  function covers(el = box) {
    const name = topPanel();
    if (!name) return false;
    const frame = frameOf(name);
    if (!frame) return false;
    if (frame.getAttribute('aria-modal') === 'true') return true;
    const r = frame.getBoundingClientRect?.();
    const at = el?.getBoundingClientRect?.();
    const x = at && at.width ? at.left + at.width / 2 : (globalThis.innerWidth || 0) / 2;
    const y = at && at.height ? at.top + Math.min(at.height, 40) / 2 : 120;
    return inRect(r, x, y);
  }

  function remove(el) {
    if (!el.isConnected || el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }

  // a line with a button (Undo) gets a layer above the panels (#hud sits under them), where a thumb reaches it
  let snacks = null;
  function snackLayer() {
    if (!snacks || !snacks.isConnected) {
      snacks = h('div.snacks#snacks', { role: 'status', 'aria-live': 'polite' });
      document.body.append(snacks);
    }
    return snacks;
  }
  // the spot just pressed: an Undo line must not hide the switch just flipped
  let press = null;
  document.addEventListener?.('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY, t: performance.now() }; },
    { capture: true, passive: true });
  // ---- QA r1 L-02 (fbp#1): a card never eats the next farm stroke: while a finger strokes the farm and STROKE_GAP_MS
  // after, cards let touches through (body.farm-stroke), as does a card ENTRY_GRACE_MS after it came in (.fresh); a card
  // raised meanwhile waits for the pause (STROKE_WAIT_MS at most). A tap is no stroke: cards stay pressable.
  const farmFingers = new Map();                  // pointerId -> { x, y, moved }
  let strokeEnd = -Infinity;
  let lastType = null;
  let strokeTimer = 0;
  const STROKE_MOVE_PX = 10;
  const stroking = () => [...farmFingers.values()].some((f) => f.moved);
  const strokeBusy = () => stroking() || performance.now() - strokeEnd < STROKE_GAP_MS;
  const touchy = () => (lastType ? lastType === 'touch' : Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches));
  const isFarm = (t) => Boolean(t && t.id === 'world');
  function strokeClass() {
    const on = strokeBusy();
    document.body?.classList?.toggle('farm-stroke', on);
    if (on) return;
    clearTimeout(strokeTimer);
    strokeTimer = 0;
    afterStroke();
  }
  document.addEventListener?.('pointerdown', (e) => {
    lastType = e.pointerType || lastType;
    if (e.pointerType === 'touch' && isFarm(e.target)) farmFingers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
  }, { capture: true, passive: true });
  document.addEventListener?.('pointermove', (e) => {
    const f = farmFingers.get(e.pointerId);
    if (!f || f.moved || Math.hypot(e.clientX - f.x, e.clientY - f.y) < STROKE_MOVE_PX) return;
    f.moved = true;
    strokeClass();
  }, { capture: true, passive: true });
  const farmUp = (e) => {
    const f = farmFingers.get(e.pointerId);
    if (!f) return;
    farmFingers.delete(e.pointerId);
    if (!f.moved) return;
    strokeEnd = performance.now();
    clearTimeout(strokeTimer);
    strokeTimer = setTimeout(strokeClass, STROKE_GAP_MS + 10);
  };
  document.addEventListener?.('pointerup', farmUp, { capture: true, passive: true });
  document.addEventListener?.('pointercancel', farmUp, { capture: true, passive: true });
  // cards that waited for the finger: in the order they were raised (a panel opened meanwhile holds them as before)
  const strokeWait = [];
  const waitSince = new WeakMap();
  let waitTimer = 0;
  function afterStroke() {
    clearTimeout(waitTimer);
    waitTimer = 0;
    for (const spec of strokeWait.splice(0)) banner(spec);
  }
  function waitForStroke(spec) {
    if (!waitSince.has(spec)) waitSince.set(spec, performance.now());
    if (!strokeWait.includes(spec)) strokeWait.push(spec);
    // the longest wait: after it the card shows anyway (and still lets the strokes through while they go on)
    if (!waitTimer) {
      waitTimer = setTimeout(() => { waitTimer = 0; for (const sp of strokeWait.splice(0)) { waitSince.set(sp, -Infinity); banner(sp); } },
        Math.max(0, STROKE_WAIT_MS - (performance.now() - waitSince.get(strokeWait[0]))));
    }
    return { el: null, close: () => { const i = strokeWait.indexOf(spec); if (i >= 0) strokeWait.splice(i, 1); } };
  }
  /** Must this card wait for the farm stroke to end? (touch only; never an urgent or `over` card; not past the max). */
  const mustWait = (spec) => touchy() && strokeBusy() && performance.now() - (waitSince.get(spec) ?? performance.now()) < STROKE_WAIT_MS;

  /** A layer's own zoom (#over-panels and #snacks are zoomed like the HUD: --ui-scale): px written into it divide by it. */
  const zoomOf = (el) => Number.parseFloat(globalThis.getComputedStyle?.(el)?.zoom) || 1;
  /** The HUD's zoom (#hud: --ui-scale on the root). */
  const hudZoom = () => Number.parseFloat(globalThis.getComputedStyle?.(document.documentElement ?? {})?.getPropertyValue?.('--ui-scale')) || 1;
  /** The open panel's body (its rows), else its frame. */
  const bodyOf = (frame) => {
    const b = frame.querySelector?.('.hh-panel-scroll, .hh-panel-body')?.getBoundingClientRect?.();
    return b && b.height > 0 ? b : frame.getBoundingClientRect();
  };
  /** QA r3 L3-03: a phone on its side, a sheet docked right: the free farm left of it, past the tools and below the
   *  top HUD ({ left, right, top } px), or null (under 160 px). Lines ran under the sheet or on its title. */
  function landRoom(frame) {
    if (!frame || !globalThis.matchMedia?.(LAYOUT_Q.land)?.matches) return null;
    const f = frame.getBoundingClientRect?.();
    if (!f || !(f.width > 0) || f.right < innerWidth - 4 || f.left < innerWidth / 4) return null;
    let ins = null;
    try { ins = S.ui?.layout?.insets?.() ?? null; } catch { ins = null; }
    const bar = document.getElementById('toolbar');
    const left = Math.max(ins?.left ?? 0, shows(bar) ? bar.getBoundingClientRect().right : 0) + 12;
    const right = f.left - 12;
    if (right - left < 160) return null;
    return { left, right, top: (ins ? ins.top : 56) + 8 };
  }
  /** A line layer into `room`, its width capped there (the words wrap). */
  function intoRoom(layer, room, z) {
    layer.classList.add('beside-sheet');
    layer.style.left = `${Math.round(room.left / z)}px`;
    layer.style.right = `${Math.round((innerWidth - room.right) / z)}px`;
    layer.style.maxWidth = `${Math.floor((room.right - room.left) / z)}px`;
    const r = layer.getBoundingClientRect();
    const top = topBelow(room.top, r.height > 0 ? r.height : 48, room.left, room.right, ceilingBoxes());
    layer.style.top = `${Math.round(top / z)}px`;
    layer.style.bottom = 'auto';
  }
  /** Undo intoRoom (the CSS place again). */
  function outOfRoom(layer) {
    layer.classList.remove('beside-sheet');
    for (const k of ['left', 'right', 'maxWidth', 'top', 'bottom']) layer.style[k] = '';
  }
  /**
   * Where a line `hgt` tall goes beside the open panel (a top y): below it, else above it (its title included), else on
   * its title band, never on its body (QA r1 L-06; r2 L2-05). `band`: only the title band was left.
   */
  function besidePanel(frame, hgt, gap = 12) {
    const f = frame.getBoundingClientRect();
    const t = frame.querySelector?.('.hh-panel-title')?.getBoundingClientRect?.();
    const topEdge = t && t.height > 0 ? Math.min(f.top, t.top) : f.top;
    if (innerHeight - f.bottom >= hgt + 2 * gap) return { y: f.bottom + gap, band: false };
    if (topEdge - hgt - gap >= 8) return { y: topEdge - hgt - gap, band: false };
    return { y: Math.max(4, bodyOf(frame).top - 4 - hgt), band: true };
  }
  /**
   * An action line (#snacks) sits above every bottom HUD it would lie on, stacked (the toolbar, then the coach card or
   * the placement bar above it: QA r1 L-04, r2 L2-02 / L2-03), and beside an open panel that leaves room, never on its
   * body (L2-05: the partner's letter); the HUD under an open sheet does not count. A sheet as tall as the screen leaves
   * only its title band, where the line would cover the close button: there the line keeps the bottom (the rows scroll,
   * a tap sends it away). Returns true when it went beside the panel.
   */
  function liftSnacks(layer) { return still(layer, () => liftSnacksNow(layer)); }
  function liftSnacksNow(layer) {
    if (layer.classList.contains('beside-sheet')) outOfRoom(layer);
    layer.style.bottom = '';
    layer.style.top = '';
    const r = layer.getBoundingClientRect();
    if (!r || !(r.width > 0)) return false;
    const frame = frameOf(topPanel());
    const fr = frame?.getBoundingClientRect?.() ?? null;
    // QA r4 L4-01: on its side, the free farm left of a sheet (as #toasts, L3-03)
    const room = landRoom(frame);
    if (room && overlaps(r, fr)) { intoRoom(layer, room, zoomOf(layer)); return true; }
    const boxes = floorBoxes().filter((b) => !(fr && inRect(fr, (b.left + b.right) / 2, (b.top + b.bottom) / 2)));
    // a sheet's own sticky footer (its main button: "Let's farm!", "Wrap it", Harvey's Apply) counts too
    for (const el of frame?.querySelectorAll?.('.recap-foot, .rel-gift-foot, .hx-sticky-acts, [data-sticky-foot]') ?? []) if (shows(el)) boxes.push(el.getBoundingClientRect());
    let foot = footAbove(r.bottom, r.height, r.left, r.right, boxes);
    let beside = false;
    if (fr && overlaps({ left: r.left, right: r.right, top: foot - r.height, bottom: foot }, bodyOf(frame))) {
      const p = besidePanel(frame, r.height);
      if (!p.band) { foot = p.y + r.height; beside = true; }
    }
    if (foot !== r.bottom) layer.style.bottom = `${Math.round((innerHeight - foot) / zoomOf(layer))}px`;
    return beside;
  }
  /** The top slot (.snacks.top) starts below the top HUD it would lie on (L2-04). */
  function dropSnacks(layer) {
    still(layer, () => {
      layer.style.top = '';
      const r = layer.getBoundingClientRect();
      if (!r || !(r.width > 0)) return;
      const top = topBelow(r.top, r.height, r.left, r.right, ceilingBoxes());
      if (top !== r.top) layer.style.top = `${Math.round(top / zoomOf(layer))}px`;
    });
  }
  function placeSnacks(layer, fresh = false) {
    if (typeof layer.getBoundingClientRect !== 'function') return;
    if (fresh) layer.classList.remove('top');
    if (!layer.classList.contains('top')) {
      const beside = liftSnacks(layer);
      // a new line must not hide the switch just flipped or the focused control: then it takes the top slot
      if (fresh && !beside) {
        const r = layer.getBoundingClientRect();
        const hit = (x, y) => x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
        const a = document.activeElement;
        const f = a && a !== document.body && typeof a.getBoundingClientRect === 'function' ? a.getBoundingClientRect() : null;
        const pressed = press && performance.now() - press.t < 2000 && hit(press.x, press.y);
        // (a control, not a focused sheet or list: one as tall as the screen sent every line up over the rows, QA r2)
        const focused = f && f.width > 0 && f.height < 160 && f.bottom > r.top - 8 && f.top < r.bottom + 8 && f.right > r.left && f.left < r.right;
        if (pressed || focused) { layer.classList.add('top'); layer.style.bottom = ''; }
      }
    }
    if (layer.classList.contains('top')) dropSnacks(layer);
  }
  /**
   * The top column (#toasts): beside an open side panel it centres in the free width left of it (L2-05: Harvey's panel
   * cut the line's end); it starts below the top HUD it would lie on (L2-04), or, anchored at the bottom by the phone CSS
   * while a card is up, above the bottom HUD.
   */
  function placeColumn() {
    if (!box || typeof box.getBoundingClientRect !== 'function') return;
    still(box, placeColumnNow);
  }
  function placeColumnNow() {
    for (const k of ['marginTop', 'marginBottom', 'left', 'maxWidth']) box.style[k] = '';
    if (box.classList.contains('beside-sheet')) outOfRoom(box);
    let r = box.getBoundingClientRect();
    if (!box.children.length || !r || !(r.width > 0)) return;
    const z = hudZoom();
    const frame = frameOf(topPanel());
    // L3-03: a non-modal sheet docked right on a phone on its side
    const room = landRoom(frame);
    if (room && overlaps(r, frame.getBoundingClientRect())) { intoRoom(box, room, z); return; }
    const f = frame && frame.getAttribute?.('aria-modal') !== 'true' ? frame.getBoundingClientRect?.() : null;
    if (f && f.width > 0 && overlaps(r, f) && f.left > (r.left + r.right) / 2 && globalThis.getComputedStyle?.(box)?.transform !== 'none') {
      const tr = document.getElementById('tracker');
      const tb = shows(tr) ? tr.getBoundingClientRect() : null;
      const left = (tb && tb.right < f.left && tb.top < r.bottom && tb.bottom > r.top ? tb.right : 0) + 12;
      const right = f.left - 12;
      if (right - left >= 160) {
        box.style.left = `${Math.round((left + right) / 2 / z)}px`;
        box.style.maxWidth = `${Math.floor((right - left) / z)}px`;
        r = box.getBoundingClientRect();
      }
    }
    if (r.top > innerHeight / 2) {
      const foot = footAbove(r.bottom, r.height, r.left, r.right, floorBoxes());
      if (foot !== r.bottom) box.style.marginBottom = `${Math.round((r.bottom - foot) / z)}px`;
    } else {
      const top = topBelow(r.top, r.height, r.left, r.right, ceilingBoxes());
      if (top !== r.top) box.style.marginTop = `${Math.round((top - r.top) / z)}px`;
    }
  }
  /** A line over a modal panel (#over-panels) goes beside the panel, never on its body (QA r1 L-06). */
  function placeOver() {
    const layer = over?.toasts;
    if (!layer || typeof layer.getBoundingClientRect !== 'function') return;
    still(layer, () => {
      outOfRoom(layer);
      const frame = frameOf(topPanel());
      if (!frame || !layer.children.length || typeof frame.getBoundingClientRect !== 'function') return;
      // L3-03
      const room = landRoom(frame);
      if (room) { intoRoom(layer, room, zoomOf(over.root)); return; }
      const r = layer.getBoundingClientRect();
      const { y, band } = besidePanel(frame, r.height > 0 ? r.height : 48);
      if (band && r.bottom <= bodyOf(frame).top - 4) return;
      layer.style.top = `${Math.round(y / zoomOf(over.root))}px`;
    });
  }
  /** Every line placed again (a panel opened or closed, a chip came up, the coach card changed step). */
  function relayout() {
    placeColumn();
    if (snacks?.children.length) placeSnacks(snacks);
    if (over?.toasts?.children.length) placeOver();
  }
  // while a line is up its place is checked a few times a second: the HUD under it changes on its own
  let watchT = 0;
  function watch() {
    if (watchT) return;
    watchT = setInterval(() => {
      if (!(box?.children.length || snacks?.children.length || over?.toasts?.children.length)) { clearInterval(watchT); watchT = 0; return; }
      // never moved from under a pointer or the keyboard that is on it
      if (document.querySelector?.('.toast:hover, .toast:focus-within')) return;
      relayout();
    }, 400);
    watchT.unref?.();
  }
  globalThis.addEventListener?.('resize', () => relayout());
  // where the pointer last moved: a line born under a resting cursor is not "hovered" (L2-04)
  let ptr = null;
  document.addEventListener?.('pointermove', (e) => { ptr = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });

  // QA r4 L4-09: a farmer's name in a span that can end in an ellipsis (16 wide glyphs made a 328 px toast)
  function named(text) {
    const ns = Object.values(S.store?.state?.players ?? {}).map((p) => p?.name).filter((n) => typeof n === 'string' && n.length > 1);
    if (!ns.length) return [text];
    const alt = ns.sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return String(text).split(new RegExp(`(?<![\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, 'u'))
      .map((x, i) => (i % 2 ? h('span.tx-name', x) : x)).filter((x) => x !== '');
  }
  // QA r4 L4-01: a line with a button no press of mine raised (the crate, the partner's news) waits while a sheet
  // leaves it no place off its body (it lay on Sell), and shows as the sheet closes (60 s at most)
  const heldLines = [];
  let heldT = 0;
  const pressed = () => /^(click|pointer|key|touch|mouse|submit|change|input)/.test(globalThis.event?.type ?? '')
    || Boolean(press && performance.now() - press.t < 1500);
  function onSheet(el) {
    const frame = frameOf(topPanel());
    const f = frame?.getBoundingClientRect?.();
    if (!f || !(f.width > 0)) return false;
    const tb = frame.querySelector?.('.hh-panel-title')?.getBoundingClientRect?.();
    return overlaps(el.getBoundingClientRect(), { left: f.left, right: f.right, top: tb && tb.height > 0 ? tb.bottom : f.top, bottom: f.bottom });
  }
  function holdLine(args) {
    heldLines.push({ args, at: performance.now() });
    if (heldT) return;
    heldT = setInterval(() => {
      while (heldLines.length && performance.now() - heldLines[0].at > 60_000) heldLines.shift();
      if (!heldLines.length || !topPanel()) releaseLines();
    }, 400);
    heldT.unref?.();
  }
  function releaseLines() {
    if (heldLines.length && topPanel()) return;
    clearInterval(heldT);
    heldT = 0;
    for (const x of heldLines.splice(0)) show(...x.args);
  }

  function show(source, { kind = 'info', iconId = null, ms = 3000, count = 0, action = null, code = null, raceLine = false } = {}) {
    // M4: a line the open panel would hide goes above the panels (an Undo line has its own layer there already)
    const above = !action && covers();
    const host = action ? snackLayer() : above ? overLayer().toasts : box;
    const again = sayer(source);
    const text = say(source);
    // coalesce an identical visible line: bump its count instead of stacking copies
    for (const el of host.children) {
      if (el.dataset.text === text && !el.classList.contains('leaving')) {
        if (action) el._act = action;          // the newest Undo is the one that means something now
        const n = Number(el.dataset.n || 1) + 1;
        el.dataset.n = String(n);
        let c = el.querySelector('.count');
        if (!c) { c = h('span.count'); el.append(c); }
        c.textContent = `×${n}`;
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        clearTimeout(el._t);
        el._t = setTimeout(() => remove(el), ms);
        return el;
      }
    }
    const badge = iconId ? h('span.ti', icon(iconId, { size: 30 })) : h(`span.ti.${kind}`, { 'aria-hidden': 'true' }, KIND_GLYPH[kind] || 'i');
    const tx = h('span.tx', ...named(text));
    const el = h(`div.toast${action ? '.has-act' : ''}`, { dataset: { text, kind } }, badge, tx, count > 1 ? h('span.count', `×${count}`) : null);
    let actBtn = null;
    if (action) {
      el._act = action;
      // a tap on the line itself (not its button) sends it away at once
      el.addEventListener('click', () => { clearTimeout(el._t); remove(el); });
      actBtn = h('button.btn.btn--sky.btn--small.toast-act', { type: 'button', on: { click: (e) => {
        e.stopPropagation();
        clearTimeout(el._t);
        remove(el);
        try { el._act.fn(); } catch (err) { console.error('toast action failed', err); }
      } } }, say(action.label));
      el.append(actBtn);
    }
    const actAgain = action ? sayer(action.label) : null;
    // a language switch while it is up: the line and its button in the new words (the coalescing key follows)
    el._relabel = () => {
      if (again) { el.dataset.text = again(); tx.replaceChildren(...named(el.dataset.text)); }
      if (actBtn && actAgain) actBtn.textContent = actAgain();
    };
    // over a panel a line sits on the panel's content: a tap on it sends it away at once (like an Undo line)
    if (above) el.addEventListener('click', () => { clearTimeout(el._t); remove(el); });
    host.append(el);
    while (host.children.length > 3) host.firstElementChild.remove();
    if (action) placeSnacks(host, true);
    else if (above) placeOver();
    else placeColumn();
    if (action && kind !== 'ok' && !pressed() && onSheet(host)) {
      el.remove();
      if (host.children.length) placeSnacks(host);
      holdLine([source, { kind, iconId, ms, count, action, code, raceLine }]);
      return null;
    }
    watch();
    signal('hh:toast', { kind, code, race: raceLine });
    el._t = setTimeout(() => remove(el), ms);
    // hover or keyboard focus holds a toast; it leaves a moment after (WCAG 2.2.1; QA wave 1 UI-35). A line born under
    // a resting cursor is not hovered until the pointer moves (L2-04: one stayed 78 s under the hand that pressed Join).
    const born = ptr;
    const hold = (e) => {
      if (born && e && e.type !== 'focusin' && Math.abs((e.clientX ?? born.x) - born.x) <= 2 && Math.abs((e.clientY ?? born.y) - born.y) <= 2) return;
      clearTimeout(el._t);
    };
    const go = () => { clearTimeout(el._t); el._t = setTimeout(() => remove(el), 1200); };
    el.addEventListener('pointerenter', hold);
    el.addEventListener('pointermove', hold);
    el.addEventListener('pointerleave', go);
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', go);
    return el;
  }

  function toast(codeOrText, opts = {}) {
    const { by, kind, icon: iconId, ms, action, type } = opts;
    const act = action && typeof action.fn === 'function' && action.label ? action : null;
    const state = S.store && S.store.state;
    const isCode = typeof codeOrText === 'string' && Object.hasOwn(ERR, codeOrText);
    const other = by && state && by !== S.store.pid && Object.hasOwn(state.players, by) ? state.players[by] : null;
    if (isCode && other && RACE_CODES.has(codeOrText)) {
      // a lost race: soft, warm, coalesced, and silent while a Together Combo runs (GDD §6.2 #6, §6.3)
      if (S.comboActive && S.comboActive()) return null;
      const now = performance.now();
      if (race && race.by === by && now - race.t < Math.max(SAFETY.lostRaceToastMs, 500) && race.el.isConnected) {
        race.n += 1;
        race.t = now;
        let c = race.el.querySelector('.count');
        if (!c) { c = h('span.count'); race.el.append(c); }
        c.textContent = `×${race.n}`;
        clearTimeout(race.el._t);
        race.el._t = setTimeout(() => remove(race.el), 2600);
        return race.el;
      }
      const el = show(() => t('toasts.race', { name: other.name }), { kind: 'love', ms: 2600, code: codeOrText, raceLine: true });
      race = { el, by, n: 1, t: now };
      return el;
    }
    // a code is said from the code, so a language switch re-says it too
    const gone = isCode && Object.hasOwn(GONE_LINE, type) && GONE_LINE[type][0].has(codeOrText) ? GONE_LINE[type][1] : null;
    const said = gone ? () => t(gone) : () => errText(codeOrText);
    const line = !isCode ? codeOrText : other ? () => t('toasts.wasHere', { text: said(), name: other.name }) : said;
    return show(typeof line === 'function' ? line : String(line), { kind: kind || (isCode ? kindOf(codeOrText) : 'info'), iconId, ms: ms ?? 3000, action: act,
      code: isCode ? codeOrText : null, raceLine: Boolean(isCode && other) });
  }

  let noticeEl = null;
  let heldNotice = null;               // a phone's non-urgent notice waiting for the open sheet to close (ux-phone#12)
  /** A longer line with OK (and an action): `text` and `action.label` may be functions that say them (a switch re-asks). */
  function notice(text, { action = null, ms = 15000, urgent = false } = {}) {
    // ux-phone#12: on a phone a notice over an open sheet covered its content (and Harvey's button): it waits
    if (!urgent && isPhone() && topPanel()) { heldNotice = [text, { action, ms, urgent }]; return null; }
    if (noticeEl) noticeEl.remove();
    const close = () => { if (noticeEl === el) noticeEl = null; el.remove(); };
    const again = sayer(text);
    const actAgain = action ? sayer(action.label) : null;
    const msg = h('span', say(text));
    const act = action ? h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: () => { close(); action.fn(); } } }, say(action.label)) : null;
    const ok = h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: close } }, t('common.ok'));
    const el = h('div.notice', { role: 'alert' }, msg, act, ok);
    el._relabel = () => {
      if (again) msg.textContent = again();
      if (act && actAgain) act.textContent = actAgain();
      ok.textContent = t('common.ok');
    };
    // M4: over a panel that covers its spot, the notice goes above the panels
    (covers() ? overLayer().root : document.getElementById('hud')).append(el);
    noticeEl = el;
    setTimeout(close, ms);
    return el;
  }

  // At most two cards on the right edge, the column stopping above the dock's small buttons (QA wave 1 UI-09); later
  // cards wait their turn, never dropped (every tour and quest card is seen, its onClose runs).
  const MAX_BANNERS = 2;
  const waiting = [];
  const closers = new Map();          // id -> close() of a shown card
  // a card's words as functions (a card that waits its turn and shows after a language switch speaks the new language)
  const toldSpecs = new WeakMap();
  function told(spec) {
    let w = toldSpecs.get(spec);
    if (!w) {
      const words = (v) => sayer(v) ?? v;
      w = { ribbon: spec.ribbon === undefined ? () => t('toasts.new') : words(spec.ribbon), message: words(spec.message ?? ''),
        quote: words(spec.quote ?? ''),
        things: (spec.things ?? []).map((x) => ({ ...x, name: words(x.name) })),
        actions: (spec.actions ?? []).map((a) => ({ ...a, label: words(a.label) })) };
      toldSpecs.set(spec, w);
    }
    return w;
  }
  const more = h('div.banner-more', { hidden: true, 'aria-hidden': 'true' });
  banners.append(more);              // the column's last item: under the cards, wherever they end
  // rosettes (ribbons, personal titles) share the column and leave on their own after a few seconds
  const shown = () => banners.querySelectorAll('.unlock-banner:not(.leaving), .rosette').length;
  /** Screen px from the column's top to just above the dock's round buttons (or the dock). */
  function room() {
    const top = banners.getBoundingClientRect().top;
    return floor() - 12 - top;
  }
  /** Where the banner column stops: the dock's small buttons (desktop), else the tool bar and the coach card. */
  function floor() {
    const minis = document.querySelector('.dock-minis');
    if (minis && minis.getClientRects().length) return minis.getBoundingClientRect().top;
    const tops = [document.getElementById('toolbar'), document.querySelector('#coach-slot .coach')]
      .filter((el) => el && el.getClientRects().length).map((el) => el.getBoundingClientRect().top);
    return tops.length ? Math.min(...tops) : innerHeight - 188;
  }
  const fits = () => banners.getBoundingClientRect().height <= room();
  function paintMore() {
    more.hidden = waiting.length === 0;
    more.textContent = waiting.length ? t('toasts.more', { n: waiting.length }) : '';
    if (banners.lastElementChild !== more) banners.append(more);
  }
  function next() {
    while (waiting.length && shown() < MAX_BANNERS) {
      const before = waiting.length;
      banner(waiting.shift());
      if (waiting.length >= before) break;             // it went back to the queue: no room yet
    }
    paintMore();
  }
  function closeBanner(id) {
    const w = waiting.findIndex((x) => x.id === id);
    if (w >= 0) { waiting.splice(w, 1); paintMore(); }
    const k = held.findIndex((x) => x.id === id);
    if (k >= 0) held.splice(k, 1);
    closers.get(id)?.();
  }

  // ---- M4: cards held while a panel is open, released as it closes ----------------------------------------------------
  const held = [];
  const PIP_KINDS = new Set(['quest', 'unlock', 'loot', 'golden', 'duet']);
  function hold(spec) {
    if (spec.id) { const i = held.findIndex((x) => x.id === spec.id); if (i >= 0) held.splice(i, 1); }
    held.push(spec);
    if (PIP_KINDS.has(spec.kind ?? 'unlock')) pip(spec);
    return { el: null, close: () => { const i = held.indexOf(spec); if (i >= 0) held.splice(i, 1); } };
  }
  function release() {
    if (topPanel() || !held.length) return;
    // in the order they were earned: the first slides in first (the column queues the rest as before)
    for (const spec of held.splice(0)) banner(spec);
  }
  /** The reward pip on the open panel's title banner: "✓ Quest done · +55 coins" (2.6 s; above the panels). */
  let pipEl = null;
  function pip(spec) {
    const frame = frameOf(topPanel());
    const title = frame?.querySelector?.('.hh-panel-title') ?? frame;
    const r = title?.getBoundingClientRect?.();
    if (!r || !(r.width > 0)) return;
    const { ribbon, things } = told(spec);
    const reward = things.find((x) => x.icon === 'coins' || x.icon === 'xp' || x.icon === 'acorns');
    const text = [`✓ ${say(ribbon)}`, reward ? say(reward.name) : null].filter(Boolean).join(' · ');
    pipEl?.remove();
    const el = h('div.reward-pip', { role: 'status' }, text);
    // the layer is zoomed like the HUD (--ui-scale): place it in the layer's own px
    const z = Number.parseFloat(globalThis.getComputedStyle?.(overLayer().root)?.zoom) || 1;
    el.style.left = `${(r.left + r.width / 2) / z}px`;
    el.style.top = `${(r.bottom - 4) / z}px`;
    overLayer().root.append(el);
    pipEl = el;
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, 2600);
    signal('hh:pip', { kind: spec.kind ?? 'unlock' });
  }
  // A line already showing when a panel opens over its spot would sit under the scrim for the rest of its time (the
  // naming sheet over a refusal, integration's component shots): it moves above the panels.
  panels()?.on?.('open', () => {
    if (box && box.children.length && covers()) {
      const layer = overLayer().toasts;
      for (const el of [...box.children]) if (!el.classList.contains('leaving')) layer.append(el);
    }
    relayout();
  });
  panels()?.on?.('close', () => {
    release();
    releaseLines();
    // the last panel closed: a line it held above itself goes back to the HUD (left there, it lay on the phone bar)
    if (!topPanel() && box && over?.toasts?.children.length) {
      for (const el of [...over.toasts.children]) if (!el.classList.contains('leaving')) box.append(el);
      outOfRoom(over.toasts);
    }
    // L2-02: an Undo line raised inside the panel had the panel's HUD hidden under it; now the coach card shows again
    relayout();
    if (heldNotice && !topPanel()) { const [text, o] = heldNotice; heldNotice = null; notice(text, o); }
  });
  /**
   * A card in the right column. `ribbon`, `message`, `things[].name` and `actions[].label` may be functions that say them
   * (a language switch re-asks them; a plain string a catalog line made is said again by i18n `retell`).
   */
  function banner(spec = {}) {
    const { ttl = 9000, kind = 'unlock', id = null, onClose = null, urgent = false, ring = 0, over: atOnce = false } = spec;
    // M4: under an open panel a card waits for it to close; an urgent or `over` card (QA r1 L-01: a surprise just
    // opened) shows at once above it
    const immediate = urgent || atOnce;
    if (!immediate && topPanel()) return hold(spec);
    if (!immediate && mustWait(spec)) return waitForStroke(spec);
    let host = immediate && covers(banners) ? overLayer().banners : banners;
    const { ribbon: ribbonSrc, message: messageSrc, quote: quoteSrc, things, actions } = told(spec);
    const ribbon = say(ribbonSrc);
    const message = say(messageSrc);
    const quote = say(quoteSrc);
    if (id) {
      host.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
      closers.delete(id);
      const w = waiting.findIndex((x) => x.id === id);
      if (w >= 0) waiting.splice(w, 1);
    }
    if (shown() >= MAX_BANNERS && !immediate) {
      waiting.push(spec);
      paintMore();
      return { el: null, close: () => { const i = waiting.indexOf(spec); if (i >= 0) waiting.splice(i, 1); paintMore(); } };
    }
    let timer = 0;
    let closed = false;
    const close = () => {
      clearTimeout(timer);
      if (id && closers.get(id) === close) closers.delete(id);
      if (!closed) { closed = true; try { onClose?.(); } catch (err) { console.error('banner onClose failed', err); } }
      if (!el.isConnected) return;
      el.classList.add('leaving');
      if (el.classList.contains('over-coach')) { el.classList.remove('over-coach'); syncCoach(); }
      setTimeout(() => { el.remove(); next(); }, 280);
    };
    const phone = !urgent && Boolean(globalThis.matchMedia?.(LAYOUT_Q.phone)?.matches);
    const compact = compactCard(kind, { phone, urgent });
    let opened = false;
    // the chip of a compact card: its title and "Tell me"; a tap opens the whole card in place
    const chipTitle = h('span.card-chip-title', ribbon);
    const chipMore = h('span.card-chip-more', t('toasts.tellMe'));
    const chip = compact ? h('button.card-chip', { type: 'button', 'aria-expanded': 'false', 'aria-label': t('toasts.chipLabel', { ribbon }),
      on: { click: (e) => { e.stopPropagation(); setOpen(true); } } },
    h('span.card-chip-bulb', { 'aria-hidden': 'true' }, '💡'), chipTitle, chipMore) : null;
    const ribbonText = h('span.ribbon-t', ribbon);
    const ribbonEl = h('div.ribbon', ring > 0 ? h('span.ring-timer', { 'aria-hidden': 'true', style: { '--d': `${ring}ms` } }) : null, ribbonText);
    const msgEl = message ? h('p.msg', message) : null;
    // L-01: words someone wrote for this farmer (a surprise's note), set apart under the message
    const quoteEl = quote ? h('blockquote.card-quote', quote) : null;
    const thingEls = things.slice(0, 8).map((x) => [x, h('span', say(x.name))]);
    const actEls = actions.map((a) => [a, h(`button.btn.btn--small${a.kind && a.kind !== 'go' ? `.btn--${a.kind}` : ''}`, {
      type: 'button', on: { click: () => { close(); a.fn(); } },
    }, say(a.label))]);
    const xBtn = h('button.btn.btn--stop.btn--round.btn--small.x', { type: 'button', 'aria-label': t('toasts.dismiss'), on: { click: close } }, svgIcon('close', 18));
    const label = (r, m, q) => [`${r}.`, m, q].filter(Boolean).join(' ');
    const el = h(`section.unlock-banner.wood.nails${compact ? '.compact' : ''}`, { dataset: { kind, id: id || '' }, role: 'status', 'aria-label': label(ribbon, message, quote) },
      chip,
      ribbonEl,
      xBtn,
      h('div.sheet.paper',
        msgEl,
        quoteEl,
        thingEls.length ? h('ul.things', thingEls.map(([x, nameEl]) => h('li.thing', x.icon ? icon(x.icon, { size: 46, alt: '' }) : svgIcon(x.glyph || 'star', 46), nameEl))) : null,
        actEls.length ? h('div.acts', actEls.map(([, b]) => b)) : null));
    // a language switch while the card is up: every word of it in the new language
    el._relabel = () => {
      const r = say(ribbonSrc);
      const m = say(messageSrc);
      const q = say(quoteSrc);
      ribbonText.textContent = r;
      fitRibbon(el, ribbonEl);
      if (msgEl) msgEl.textContent = m;
      if (quoteEl) quoteEl.textContent = q;
      for (const [x, nameEl] of thingEls) nameEl.textContent = say(x.name);
      for (const [a, b] of actEls) b.textContent = say(a.label);
      xBtn.setAttribute('aria-label', t('toasts.dismiss'));
      el.setAttribute('aria-label', label(r, m, q));
      if (chip) {
        chip.setAttribute('aria-label', t('toasts.chipLabel', { ribbon: r }));
        chipTitle.textContent = r;
        chipMore.textContent = t('toasts.tellMe');
      }
    };
    host.prepend(el);
    fitRibbon(el, ribbonEl);
    // an urgent or `over` card a side sheet lies on goes above the panels
    if (immediate && host === banners && topPanel() && covers(el)) { host = overLayer().banners; host.prepend(el); }
    // no room above the dock: the card waits (unless it is the only one, or urgent / `over`)
    if (!immediate && shown() > 1 && !fits()) {
      el.remove();
      waiting.unshift(spec);
      paintMore();
      return { el: null, close: () => { const i = waiting.indexOf(spec); if (i >= 0) waiting.splice(i, 1); paintMore(); } };
    }
    if (id) closers.set(id, close);
    // L-10: clear of the coach card (now, and once more after the coach's next step has drawn)
    if (host === banners) {
      fitAboveCoach(el);
      for (const ms of [400, 1200]) setTimeout(() => { if (el.isConnected && !closed) fitAboveCoach(el); }, ms);
    }
    // L-02: a card that just came in over the field lets a touch through for ENTRY_GRACE_MS (not over a panel)
    if (host === banners && touchy()) {
      el.classList.add('fresh');
      setTimeout(() => el.classList.remove('fresh'), ENTRY_GRACE_MS);
    }
    // on a phone a card covers a third of the farm: 10 s at most, a swipe sends it away (mobile QA M-10); an opened
    // compact chip stays until it is put away
    const life = phone && ttl > PHONE_CARD_MS ? PHONE_CARD_MS : ttl;
    if (phone) swipeAway(el, close);
    // an urgent card has a fixed window (the Duet's 3 s): hover must not stretch it past its meaning
    const arm = () => { clearTimeout(timer); if (life > 0 && !opened) timer = setTimeout(close, life); };
    function setOpen(v) {
      opened = Boolean(v);
      el.classList.toggle('open', opened);
      chip?.setAttribute('aria-expanded', String(opened));
      arm();
    }
    if (!urgent) {
      el.addEventListener('pointerenter', () => clearTimeout(timer));
      el.addEventListener('pointerleave', arm);
      el.addEventListener('focusin', () => clearTimeout(timer));
      el.addEventListener('focusout', arm);
    }
    arm();
    paintMore();
    signal('hh:card', { kind, id });
    return { el, close };
  }

  /**
   * QA r2 L2-09 (fe#3): a ribbon that wraps to a third line on a narrow screen ran under the card's words (its last line
   * hidden): the card makes room below it. (The ribbon sits 14 px above the card; the words start at its top padding.)
   */
  function fitRibbon(el, rib) {
    still(el, () => {
      el.style.paddingTop = '';
      const rh = rib?.getBoundingClientRect?.()?.height ?? 0;
      const pad = Number.parseFloat(globalThis.getComputedStyle?.(el)?.paddingTop) || 34;
      const z = hudZoom();
      if (rh > 0 && rh / z - 14 + 4 > pad) el.style.paddingTop = `${Math.ceil(rh / z - 14 + 4)}px`;
    });
  }

  /**
   * QA r1 L-10 (fbp#20): a card stays clear of the coach card (a quest card on a phone covered the first line of the
   * coach's next instruction for 8 s). One that would reach it folds its rewards into one row (.tight); if it still
   * would, the coach card steps aside while the card is up (body.card-over-coach, as for the level-up show, S6).
   * Measured with the entrance's scale (0.96 about the top edge) taken out.
   */
  function fitAboveCoach(el) {
    const coach = document.querySelector('#coach-slot .coach');
    // (a coach card that stepped aside keeps its box: visibility only)
    const c = coach && typeof coach.getClientRects === 'function' && coach.getClientRects().length ? coach.getBoundingClientRect() : null;
    const reaches = () => {
      if (!c) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.right > c.left && b.left < c.right && b.top + b.height / 0.96 > c.top - 8;
    };
    const over = still(el, () => {
      let o = reaches();
      if (o) { el.classList.add('tight'); o = reaches(); }
      return o;
    });
    // re-checked after the coach's next step drew: a coach card that moved off the card comes back at once
    if (over !== el.classList.contains('over-coach')) { el.classList.toggle('over-coach', over); syncCoach(); }
  }
  function syncCoach() {
    const any = [...banners.querySelectorAll('.unlock-banner.over-coach')].some((x) => !x.classList.contains('leaving'));
    document.body?.classList?.toggle('card-over-coach', any);
  }

  /** One finger flicks card `el` sideways or up and away (`close`); a short drag springs back. */
  function swipeAway(el, close) {
    let g = null;
    el.addEventListener('pointerdown', (e) => {
      g = null;
      if (e.pointerType !== 'touch' || e.target.closest?.('button:not(.card-chip)')) return;
      // L-02: a finger that lands on a card that just came in, or during / right after a farm stroke, is the farm's
      if (el.classList.contains('fresh') || strokeBusy()) return;
      // a finger the farm took over for a pinch (controller: a HUD finger joins the farm's two-finger gesture)
      if (document.getElementById('world')?.hasPointerCapture?.(e.pointerId)) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    });
    el.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      g.dx = e.clientX - g.x;
      g.dy = Math.min(0, e.clientY - g.y);
      el.style.translate = `${Math.round(g.dx)}px ${Math.round(g.dy)}px`;
      el.style.opacity = String(Math.max(0.3, 1 - Math.hypot(g.dx, g.dy) / 260));
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const far = Math.abs(g.dx) > 70 || g.dy < -50;
      g = null;
      if (far) { close(); return; }
      el.style.translate = '';
      el.style.opacity = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** The partner's "Cook together" press, on my screen wherever I am (QA wave 1 UI-08). */
  function duetAsk(ev, partner, { join }) {
    const r = CONTENT.recipes.get(ev.recipe);
    const how = { bakery: 'bake', kitchen: 'cook' }[ev.building] ?? 'make';
    // a press whose window already closed (a slow delta) is no invitation any more
    const left = Number.isFinite(ev.until) && S.store ? ev.until - S.store.now() : 3000;
    if (left < 300) return null;
    return banner({
      id: `duet-ask-${ev.id}`, kind: 'duet', urgent: true, ring: left, ttl: left + 300,
      ribbon: () => t(`toasts.duet.${how}.ask`),
      message: () => (r ? t(`toasts.duet.${how}.what`, { name: partner.name, thing: N(r.id, 'recipes') }) : t(`toasts.duet.${how}.something`, { name: partner.name })),
      things: r ? [{ icon: r.id, name: () => cname(r.id, { family: 'recipes' }) }] : [],
      actions: [{ label: () => t(`toasts.duet.${how}.go`), kind: 'stop', fn: join }],
    });
  }

  /** A slim green card for the Level-up Bloom: every level-up that finished something growing (counts by kind). */
  function bloom(counts = {}) {
    const petal = svgIcon('flower', 46);
    petal.classList.add('petal');
    const title = h('b', t('toasts.bloom.title'));
    const line = h('span', bloomLine(counts));
    const el = h('div.bloom-banner', { role: 'status' }, petal, h('div', title, line));
    el._relabel = () => { title.textContent = t('toasts.bloom.title'); line.textContent = bloomLine(counts); };
    banners.prepend(el);
    setTimeout(() => { el.style.transition = 'opacity 400ms'; el.style.opacity = '0'; setTimeout(() => el.remove(), 420); }, 7000);
    return el;
  }

  // A language switch mid-game: the lines, notices and cards already up say themselves again in the new language, like
  // the panels do (a float over the farm finishes in the old one: it is gone in 2-3 s)
  onLang(() => {
    for (const host of [box, snacks, banners, over?.toasts, over?.banners]) {
      if (!host) continue;
      for (const el of host.children) {
        try { el._relabel?.(); } catch (err) { console.error('toasts: relabel failed', err); }
      }
    }
    try { noticeEl?._relabel?.(); } catch (err) { console.error('toasts: relabel failed', err); }
    paintMore();
  });

  return { toast, notice, banner, bloom, show, flushBanners: next, duetAsk, closeBanner };
}
