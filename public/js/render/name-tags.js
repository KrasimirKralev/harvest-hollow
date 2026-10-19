// Named animals on the farm (release 1.0 D4, features#F4). Owned by the life-feel lane. A small tag over every NAMED
// animal (farm.names: one farmer named 13 of them, and in the pen they were anonymous), in the namer's colour with a dark
// outline like the HUD words (readable on a sunny lawn: scope P9). When:
//   desktop (a fine pointer): while the camera is in the near band (< NAME_TAGS.near m), or on hover of the animal or
//     its home;
//   touch: while that home's card is open, or on a long press of the animal or its home (the world card's hover). On a
//     phone the card is a sheet over the whole farm, so a home's tags stay NAME_TAGS.lingerMs after its card closes:
//     the names show on the farm right after looking at the barn (on-screen check 2026-10-14, d4-tags-*-iphone-*.png).
// At most NAME_TAGS.max tags at once (the nearest to the middle of the screen). DOM only (no draw call): a fixed layer
// #name-tags (z 8, under the HUD; scope §7.1) made here, a pool of NAME_TAGS.max elements made once, and nothing at all
// while no tag can show (a desktop out of the near band with nothing hovered). Budget 0.5 ms main thread per frame with
// 24 tags at CPU x4 (iPhone 13), and most of that is the browser restyling what was written, so per frame: no
// allocation, a tag's transform written only when its whole-pixel place changed, and the look (font, outline) set once
// on the layer and inherited, so a moved tag restyles its few own declarations, not the nine-shadow outline. A tag is
// kept whole on the screen (an animal at the edge keeps its tag inside).
//
//   createNameTags({ toScreenM, parent?, desktop? }) -> tags          (render/animals-view.js creates and drives it)
//     tags.setNames(state)                      who is named, and the namer's colour (farm.names, players)
//     tags.idle(dist) -> true when no tag can show this frame (any shown ones are hidden): the caller gathers nothing
//     tags.frame(list [{ id, home, x, z, y }], { dist, n?, since? })   per frame: the named animals' heads (metres);
//       n: how many of `list` are live (a reused array), since: when the caller began gathering (counted in `ms`)
//     tags.hover(id | null) / tags.open(homeId | null)     what the pointer is on / the home card that is open
//     tags.stats() -> { named, shown, moved, ms }   the last frame: tags shown, transforms written, main-thread ms
//       (gathering + placing; the browser's restyle of the `moved` tags comes on top; budget 0.5 ms at CPU x4)
//   window events it listens to (game/feedback.js sends them): 'hh:world-hover' { id }, 'hh:home-card' { id }
//   Pure (tested): NAME_TAGS, tagWanted({ desktop, dist, hoverId, openHome, id, home }), pickTags(cands, max, cx, cy),
//     readableOnOutline(hex) (the namer's colour at 4.5:1 or more on the outline), contrastRatio(a, b),
//     declutter(recs, n) (QA r1 L-12: overlapping tags stack upward, a tag pushed more than NAME_TAGS.stack rows is left out)
import { SLOT_COLORS } from '../../../shared/content/config.js';

// h: a tag's height on screen in px (15 px bold at line-height 1.1, plus its outline); stack: how many rows a tag may
// climb to clear the ones below it (QA r1 L-12) before it is left out
export const NAME_TAGS = Object.freeze({ max: 24, near: 35, lingerMs: 6000, h: 18, stack: 3 });
/** ui/layout.js LAYOUT_Q.touch (every non-desktop layout), repeated here: render/ imports nothing from ui/. */
const TOUCH_LAYOUT = '(max-width: 1180px), (max-height: 500px)';

/** Does a named animal's tag show? Pure. */
export function tagWanted({ desktop = true, dist = 60, hoverId = null, openHome = null, id, home = null }) {
  return wanted(Boolean(desktop && dist < NAME_TAGS.near), hoverId, openHome, id, home);
}
/** tagWanted without the options object (frame() calls it for every named animal, every frame). */
function wanted(near, hoverId, openHome, id, home) {
  if (hoverId && (hoverId === id || (home && hoverId === home))) return true;
  if (openHome && home && openHome === home) return true;
  return near;
}

/** The `max` candidates ({ sx, sy }) nearest the screen point (cx, cy), kept in their given order. Pure. */
export function pickTags(cands, max, cx, cy) {
  const rec = cands.map((c, i) => ({ c, i, d: (c.sx - cx) ** 2 + (c.sy - cy) ** 2 }));
  return rec.slice(0, selectNearest(rec, rec.length, max)).map((r) => r.c);
}
const byCentre = (a, b) => a.d - b.d;
/**
 * In place on records { i (list order), d (squared distance to the centre) }: the first `max` of recs[0..n) become the
 * nearest, back in list order (so a tag element keeps its animal while the set holds: no text rewritten); returns how
 * many to show.
 */
function selectNearest(recs, n, max) {
  if (n <= max) return n;
  recs.length = n;
  recs.sort(byCentre);
  for (let a = 1; a < max; a++) {
    const c = recs[a];
    let b = a - 1;
    while (b >= 0 && recs[b].i > c.i) { recs[b + 1] = recs[b]; b--; }
    recs[b + 1] = c;
  }
  return max;
}

/**
 * QA r1 L-12 (coop#10): a screen-space pass over the tags about to show, in place on records { x, y, half } (a tag
 * stands centred on (x, y), `half` px each side, NAME_TAGS.h tall): from the lowest on screen up (usually the nearest
 * animal, which keeps its place), a tag that would overlap one already placed moves up just above it, again until it is
 * clear; one that had to climb more than `stack` rows gets `on = false` (left out: a pile of names reads as none).
 * Tags that touch nothing keep their places. No allocation (`order` is reused); n <= 24, so at most 24 x 24 checks.
 */
const order = [];
export function declutter(recs, n, h = NAME_TAGS.h, stack = NAME_TAGS.stack) {
  order.length = 0;
  for (let i = 0; i < n; i++) {
    let j = order.length;
    order.push(i);
    while (j > 0 && recs[order[j - 1]].y < recs[i].y) { order[j] = order[j - 1]; j--; }
    order[j] = i;
  }
  for (let a = 0; a < n; a++) {
    const r = recs[order[a]];
    const y0 = r.y;
    r.on = true;
    for (let pass = 0; pass <= stack; pass++) {
      let hit = false;
      for (let b = 0; b < a; b++) {
        const p = recs[order[b]];
        if (p.on && Math.abs(r.x - p.x) < r.half + p.half && r.y > p.y - h && r.y - h < p.y) { r.y = p.y - h; hit = true; }
      }
      if (!hit) break;
    }
    if (y0 - r.y > stack * h) r.on = false;
  }
  return recs;
}

/** Every tag set alive on the page (animals-view makes one): nameTagsStats() reads them (dev / measurement). */
const LIVE = new Set();
export function nameTagsStats() { return [...LIVE].map((t) => t.stats()); }

const OUTLINE = '#2A170A';

/** WCAG relative luminance of '#RRGGBB'. */
function luminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/** WCAG contrast ratio of two '#RRGGBB' colours. Pure. */
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/**
 * The namer's colour as a tag wears it: as it is when it reads at `min`:1 on the dark outline (P9: the glyphs sit on
 * the outline, the lawn only behind it), else mixed toward white just far enough (any '#RRGGBB' is a farmer's colour;
 * the picker's plum is 4.46:1). Pure.
 */
export function readableOnOutline(hex, min = 4.5) {
  if (!/^#[0-9a-f]{6}$/i.test(hex) || contrastRatio(hex, OUTLINE) >= min) return hex;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let k = 1; k <= 20; k++) {
    const out = `#${rgb.map((c) => Math.round(c + (255 - c) * (k / 20)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    if (contrastRatio(out, OUTLINE) >= min) return out;
  }
  return '#FFFFFF';
}
const SHADOW = `1.5px 0 0 ${OUTLINE},-1.5px 0 0 ${OUTLINE},0 1.5px 0 ${OUTLINE},0 -1.5px 0 ${OUTLINE},1px 1px 0 ${OUTLINE},`
  + `-1px 1px 0 ${OUTLINE},1px -1px 0 ${OUTLINE},-1px -1px 0 ${OUTLINE},0 2.5px 2px rgba(20,10,4,.55)`;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** The look every tag inherits from the layer (font, outline): set once, never restyled per frame. */
const LAYER_CSS = 'position:fixed;inset:0;z-index:8;pointer-events:none;overflow:hidden;white-space:nowrap;'
  + `font:800 0.9375rem/1.1 var(--font-ui, system-ui, sans-serif);letter-spacing:.01em;text-shadow:${SHADOW}`;

export function createNameTags({ toScreenM, parent = null, desktop = null } = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  // desktop: a fine pointer, or the game's desktop layout (not ui/layout.js LAYOUT_Q.touch: a headless or a remote
  // desktop browser may report no fine pointer at all)
  // The two MediaQueryLists are made once and read live each frame (`matches` follows a rotated tablet or a docked
  // laptop); a new list per frame was a style query of its own, twice a frame.
  let mqFine = null;
  let mqTouch = null;
  const isDesktop = () => {
    if (typeof desktop === 'function') return desktop();
    const mm = globalThis.matchMedia;
    if (typeof mm !== 'function') return true;
    mqFine ??= mm.call(globalThis, '(hover: hover) and (pointer: fine)');
    mqTouch ??= mm.call(globalThis, TOUCH_LAYOUT);
    return Boolean(mqFine?.matches) || !mqTouch?.matches;
  };
  const names = new Map();          // animal id -> { name, color }
  let layer = null;
  const pool = [];
  let hoverId = null;
  let openHome = null;
  let lingerHome = null;          // the home whose card just closed, and until when its tags stay
  let lingerUntil = 0;
  const closeHome = () => { if (openHome) { lingerHome = openHome; lingerUntil = now() + NAME_TAGS.lingerMs; } openHome = null; };
  const homeNow = () => openHome ?? (lingerHome && now() < lingerUntil ? lingerHome : null);
  let shown = 0;
  let lastMs = 0;
  let moved = 0;                    // transforms written in the last frame (the browser restyles each one)
  const cands = [];                 // reused { n, i, sx, sy, d } records: frame() allocates nothing
  // The screen's middle, kept from 'resize' (a rotation fires it too): innerWidth is a forced-layout read, so reading it
  // in frame() could make the browser restyle on the spot whatever this frame had written so far.
  let cx = 640;
  let cy = 360;
  const readViewport = () => {
    if (typeof innerWidth === 'number') cx = innerWidth / 2;
    if (typeof innerHeight === 'number') cy = innerHeight / 2;
  };
  readViewport();

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    if (!doc || !doc.body) return null;
    layer = doc.getElementById?.('name-tags') || null;
    if (!layer) {
      layer = doc.createElement('div');
      layer.id = 'name-tags';
      layer.setAttribute('aria-hidden', 'true');          // the animal's home card and its tooltip say the names
      (parent || doc.body).appendChild(layer);
    }
    if (!layer._tagLook) { layer.style.cssText = LAYER_CSS; layer._tagLook = true; }
    return layer;
  }
  function tag(i) {
    let el = pool[i];
    if (el) return el;
    const host = ensureLayer();
    if (!host) return null;
    el = doc.createElement('div');
    el.className = 'name-tag';
    el.style.cssText = 'position:absolute;left:0;top:0;will-change:transform;transform:translate3d(-999px,-999px,0);visibility:hidden';
    host.appendChild(el);
    pool[i] = el;
    el._text = '';
    el._color = '';
    el._on = false;
    el._x = -999;
    el._y = -999;
    return el;
  }
  function hideFrom(k) {
    for (let i = k; i < pool.length; i++) {
      const el = pool[i];
      if (el && el._on) { el._on = false; el.style.visibility = 'hidden'; }
    }
  }

  // the common case costs nothing: a desktop out of the near band with nothing hovered and no card open
  const active = (home, near) => Boolean(names.size && (hoverId || home || near));
  const hideAll = () => { if (shown) { hideFrom(0); shown = 0; } };

  globalThis.addEventListener?.('resize', readViewport);
  globalThis.addEventListener?.('hh:world-hover', (e) => { hoverId = e?.detail?.id ?? null; });
  globalThis.addEventListener?.('hh:home-card', (e) => { const id = e?.detail?.id ?? null; if (id) openHome = id; else closeHome(); });

  const api = {
    setNames(state) {
      names.clear();
      const f = state && state.farm;
      if (!f || !f.names) return;
      for (const id of Object.keys(f.names)) {
        const n = f.names[id];
        if (!n || typeof n.name !== 'string' || !n.name || !Object.hasOwn(f.objects ?? {}, id)) continue;
        const p = n.by && state.players && Object.hasOwn(state.players, n.by) ? state.players[n.by] : null;
        const color = /^#[0-9a-f]{6}$/i.test(p?.color || '') ? p.color : SLOT_COLORS[n.by] ?? '#FFF3C4';
        // half the tag's width, estimated (15 px bold: ~9.6 px a letter) instead of measured: a measure is a layout read
        names.set(id, { name: n.name, color: readableOnOutline(color), half: Math.ceil(n.name.length * 4.8) + 4 });
      }
    },
    /** Is `id` a named animal (the tags' own list)? */
    has(id) { return names.has(id); },
    idle(dist = 60) {
      if (active(homeNow(), dist < NAME_TAGS.near && isDesktop())) return false;
      hideAll();
      lastMs = 0;
      return true;
    },
    frame(list, { dist = 60, n: len = list.length, since = null } = {}) {
      const t0 = since ?? now();
      const home = homeNow();
      const near = dist < NAME_TAGS.near && isDesktop();
      if (!active(home, near)) { hideAll(); lastMs = now() - t0; return 0; }
      let nc = 0;
      for (let i = 0; i < len; i++) {
        const a = list[i];
        const n = names.get(a.id);
        if (!n || !wanted(near, hoverId, home, a.id, a.home)) continue;
        const s = toScreenM(a.x, a.z, a.y);
        if (!s.visible) continue;
        const c = cands[nc] ?? (cands[nc] = { n: null, i: 0, sx: 0, sy: 0, d: 0, x: 0, y: 0, half: 0, on: true });
        c.n = n;
        c.i = i;
        c.sx = s.x;
        c.sy = s.y;
        c.d = (s.x - cx) * (s.x - cx) + (s.y - cy) * (s.y - cy);
        nc++;
      }
      nc = selectNearest(cands, nc, NAME_TAGS.max);     // more than fit: the nearest to the middle of the screen
      // kept whole on the screen: an animal at the edge keeps its tag inside (the iPhone shot cut "Petrova" in half)
      for (let k = 0; k < nc; k++) {
        const c = cands[k];
        c.half = c.n.half;
        c.x = Math.round(Math.min(Math.max(c.sx, c.half), 2 * cx - c.half));
        c.y = Math.round(c.sy);
      }
      // L-12: names that would overlap (a herd round its barn on a phone) stack upward instead of piling up
      declutter(cands, nc);
      moved = 0;
      let k = 0;
      let on = 0;
      for (; k < nc; k++) {
        const c = cands[k];
        const el = tag(k);
        if (!el) break;
        if (!c.on) { if (el._on) { el._on = false; el.style.visibility = 'hidden'; } continue; }
        on++;
        if (el._text !== c.n.name) { el.textContent = c.n.name; el._text = c.n.name; }
        if (el._color !== c.n.color) { el.style.color = c.n.color; el._color = c.n.color; }
        const { x, y } = c;
        if (x !== el._x || y !== el._y) {
          el._x = x;
          el._y = y;
          el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`;
          moved++;
        }
        if (!el._on) { el._on = true; el.style.visibility = 'visible'; }
      }
      hideFrom(k);
      shown = on;
      lastMs = now() - t0;
      return on;
    },
    hover(id) { hoverId = id ?? null; },
    open(home) { if (home) openHome = home; else closeHome(); },
    stats() { return { named: names.size, shown, moved, ms: lastMs }; },
  };
  LIVE.add(api);
  return api;
}
