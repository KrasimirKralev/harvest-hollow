// Tiny DOM helpers shared by the ui shell and the panels (ui-shell lane). No framework: the UI is a few hundred
// elements that change on store topics, so hand-built nodes + text-node updates are the cheapest thing that works.
// Panels import these through `ui/index.js` (re-exported there, part of the ui contract).
//
//   h(tag, props?, ...children) -> Element   tag 'div.a.b#id'; props: class, style (object|string), dataset,
//                                             on { event: fn }, text, attrs (any other key: aria-*, role, data-*,
//                                             id, type, title, hidden, disabled, tabindex, ... set as attributes;
//                                             booleans true = present, false/null/undefined = absent)
//   icon(id, { size, alt, cls }) -> <img>    a render-life icon by content id (iconUrl), lazy and undraggable
//   fmt(n) / fmtShort(n)                     12,340 / 12.3k (by language: i18n/core.js fmtNum / fmtShort)
//   fmtDuration(ms, opts?)                   '2h 05m' | '4m 10s' | '12s' (never negative; i18n/core.js, by language)
//   plural(n, one, many?)                    '1 plot' / '3 plots' (English words only: new code uses tn())
//   focusables(root) -> Element[]            tabbable descendants in DOM order
//   svgIcon(name, size?) -> SVGElement       the shell's inline SVG glyphs (GDD §7.3 dock + right edge)
//   touchPlayer(controller?) -> bool         the player is on a phone or tablet (a touch last, or a coarse pointer)
//   touchText(text, touch) -> string         "click" reads "tap" and "(G)" key hints drop out for a touch player
import { iconUrl } from '../render/icons.js';
import { portraitSpec, peekPortrait } from '../render/portrait.js';
import { farm } from '../net/farm.js';
import { fmtNum, fmtShort as i18nShort, fmtDuration as i18nDuration, lang, touchOf } from '../i18n/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = Boolean(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(id, { size = 32, alt = '', cls = '' } = {}) {
  const img = document.createElement('img');
  img.className = `ic${cls ? ` ${cls}` : ''}`;
  img.src = iconUrl(id, size * (globalThis.devicePixelRatio || 1) > 64 ? 128 : 64);
  img.width = size;
  img.height = size;
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  return img;
}

// one formatter per language for the whole UI (i18n/core.js caches them): toLocaleString builds a new one per call, and
// the coin pill formats every frame of a roll (QA wave 1 UI-30)
export const fmt = (n) => fmtNum(n);

export const fmtShort = (n) => i18nShort(n);

export const fmtDuration = (ms, opts) => i18nDuration(ms, opts);

export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root) {
  return [...root.querySelectorAll(TABBABLE)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
}

// ---- inline SVG glyphs (visual-ux-juice §5.4: 48 viewBox, 2.5 ink outline, flat fill + one highlight + one shade) -
const INK = '#3E2612';
const GLYPHS = {
  coin: `<ellipse cx="24" cy="27" rx="18" ry="16" fill="#D9931F" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="24" cy="23" rx="18" ry="16" fill="#FFC83D" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="24" cy="23" rx="11" ry="9.5" fill="none" stroke="#D9931F" stroke-width="2.5"/>
    <path d="M13 17c3-5 9-7 14-6" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>`,
  acorn: `<path d="M14 22c0 12 4 20 10 22 6-2 10-10 10-22z" fill="#C98A4A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M27 24c0 9-2 15-5 18" fill="none" stroke="#000" stroke-opacity=".15" stroke-width="4" stroke-linecap="round"/>
    <path d="M9 21c0-7 7-11 15-11s15 4 15 11z" fill="#8A5224" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 10V5" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M14 16c3-3 7-4 11-4" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="2.5" stroke-linecap="round"/>`,
  heart: `<path d="M24 41S7 30 7 18c0-6 4-10 9-10 4 0 7 2 8 6 1-4 4-6 8-6 5 0 9 4 9 10 0 12-17 23-17 23z" fill="#FF7A8A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M30 37c5-5 9-11 9-17" fill="none" stroke="#000" stroke-opacity=".15" stroke-width="4" stroke-linecap="round"/>
    <path d="M12 17c0-3 2-5 5-5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>`,
  star: `<path d="M24 4l6 13 14 2-10 10 3 14-13-7-13 7 3-14L4 19l14-2z" fill="#FFC83D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 10l-4 9-8 1" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`,
  crate: `<rect x="7" y="11" width="34" height="30" rx="4" fill="#D99A4A" stroke="${INK}" stroke-width="2.5"/>
    <path d="M7 21h34M7 31h34" stroke="${INK}" stroke-width="2.5"/>
    <path d="M11 15l26 22M37 15L11 37" stroke="#8A5224" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M10 14h12" stroke="#fff" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round"/>`,
  barn: `<path d="M6 22L24 8l18 14v20H6z" fill="#C8473A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M4 23L24 7l20 16" fill="none" stroke="#FFF8EC" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="16" y="26" width="16" height="16" fill="#7A4B3A" stroke="${INK}" stroke-width="2.5"/>
    <path d="M16 26l16 16M32 26L16 42" stroke="#FFF8EC" stroke-width="2.2"/>
    <path d="M38 24v18" stroke="#000" stroke-opacity=".15" stroke-width="5"/>`,
  market: `<path d="M8 20h32v22H8z" fill="#F7D9A0" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M5 20l4-11h30l4 11z" fill="#E8554A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M15 9l-2 11M24 9v11M33 9l2 11" stroke="#FFF8EC" stroke-width="3"/>
    <path d="M5 20c3 4 7 4 9.5 0 2.5 4 7 4 9.5 0 2.5 4 7 4 9.5 0 2.5 4 6.5 4 9.5 0" fill="#E8554A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="17" cy="34" r="4" fill="#E8554A" stroke="${INK}" stroke-width="2"/><circle cx="26" cy="35" r="4" fill="#FFC83D" stroke="${INK}" stroke-width="2"/>
    <circle cx="33" cy="33" r="3.5" fill="#5DBB3F" stroke="${INK}" stroke-width="2"/>`,
  hammer: `<path d="M25 21l-14 18a3.5 3.5 0 0 0 5 5l18-14z" fill="#D99A4A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M19 13l9-8 15 15-8 9-6-6-4 3-5-5 3-4z" fill="#9AA7B4" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M29 9l11 11" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`,
  orders: `<rect x="7" y="8" width="34" height="32" rx="3" fill="#8A5224" stroke="${INK}" stroke-width="2.5"/>
    <rect x="11" y="12" width="26" height="24" rx="2" fill="#FFF4D6" stroke="${INK}" stroke-width="2"/>
    <path d="M15 19h18M15 25h18M15 31h11" stroke="#8A6440" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="24" cy="10" r="3" fill="#E8554A" stroke="${INK}" stroke-width="2"/>
    <path d="M12 40l-2 5M36 40l2 5" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
  journal: `<path d="M9 8h26a4 4 0 0 1 4 4v28a2 2 0 0 1-2 2H11a4 4 0 0 1-4-4V10a2 2 0 0 1 2-2z" fill="#4A7FE8" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M7 37a4 4 0 0 1 4-4h28" fill="none" stroke="${INK}" stroke-width="2.5"/>
    <path d="M11 33h28v5H11z" fill="#FFF4D6"/>
    <path d="M17 14h14M17 20h10" stroke="#fff" stroke-opacity=".8" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M30 26l3 2 3-2v-12h-6z" fill="#F5C542" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
  gear: `<path d="M24 6l4 1 1 5 4 2 4-3 4 4-3 4 2 4 5 1v6l-5 1-2 4 3 4-4 4-4-3-4 2-1 5h-6l-1-5-4-2-4 3-4-4 3-4-2-4-5-1v-6l5-1 2-4-3-4 4-4 4 3 4-2 1-5z" fill="#9AA7B4" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="24" cy="24" r="6.5" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5"/>`,
  sound: `<path d="M8 19h7l10-9v28l-10-9H8z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M31 18c3 3 3 9 0 12M35 13c6 6 6 16 0 22" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
  mute: `<path d="M8 19h7l10-9v28l-10-9H8z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M31 19l10 10M41 19L31 29" stroke="#B83A30" stroke-width="3" stroke-linecap="round"/>`,
  photo: `<rect x="5" y="14" width="38" height="26" rx="5" fill="#5C3B1E" stroke="${INK}" stroke-width="2.5"/>
    <path d="M16 14l3-5h10l3 5" fill="#8A6440" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="24" cy="27" r="8" fill="#9ED8FF" stroke="#FFF4D6" stroke-width="3"/>
    <circle cx="21" cy="24" r="2" fill="#fff"/>`,
  plus: `<path d="M24 10v28M10 24h28" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M24 10v28M10 24h28" stroke="#FFF4D6" stroke-width="3" stroke-linecap="round"/>`,
  minus: `<path d="M10 24h28" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M10 24h28" stroke="#FFF4D6" stroke-width="3" stroke-linecap="round"/>`,
  // the four corners of a screen (the phone menu's Full screen)
  fullscreen: `<path d="M8 18V8h10M30 8h10v10M40 30v10H30M18 40H8V30" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 18V8h10M30 8h10v10M40 30v10H30M18 40H8V30" fill="none" stroke="#FFF4D6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  rotl: `<path d="M14 18a13 13 0 1 1-2 13" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M14 18a13 13 0 1 1-2 13" fill="none" stroke="#FFF4D6" stroke-width="3" stroke-linecap="round"/>
    <path d="M6 10l9 9-11 3z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
  rotr: `<path d="M34 18a13 13 0 1 0 2 13" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M34 18a13 13 0 1 0 2 13" fill="none" stroke="#FFF4D6" stroke-width="3" stroke-linecap="round"/>
    <path d="M42 10l-9 9 11 3z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
  close: `<path d="M14 14l20 20M34 14L14 34" stroke="#7E2620" stroke-width="9" stroke-linecap="round"/>
    <path d="M14 14l20 20M34 14L14 34" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>`,
  ping: `<path d="M24 44s-13-13-13-23a13 13 0 0 1 26 0c0 10-13 23-13 23z" fill="#E8554A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="24" cy="20" r="5" fill="#FFF4D6" stroke="${INK}" stroke-width="2.2"/>
    <path d="M16 13c2-3 5-4 8-4" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`,
  smile: `<circle cx="24" cy="24" r="17" fill="#FFC83D" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="18" cy="21" r="2.4" fill="${INK}"/><circle cx="30" cy="21" r="2.4" fill="${INK}"/>
    <path d="M16 28c4 6 12 6 16 0" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M13 17c2-4 6-6 10-6" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`,
  note: `<path d="M9 7h22l8 8v26H9z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M31 7v8h8" fill="#EFD49A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M15 22h17M15 28h17M15 34h10" stroke="#8A6440" stroke-width="2.5" stroke-linecap="round"/>`,
  book: `<path d="M24 12c-5-4-12-4-17-2v28c5-2 12-2 17 2 5-4 12-4 17-2V10c-5-2-12-2-17 2z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 12v28" stroke="${INK}" stroke-width="2.5"/>`,
  check: `<path d="M10 25l9 9 19-20" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 25l9 9 19-20" fill="none" stroke="#9BE06A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  lock: `<rect x="10" y="21" width="28" height="21" rx="4" fill="#FFC83D" stroke="${INK}" stroke-width="2.5"/>
    <path d="M16 21v-6a8 8 0 0 1 16 0v6" fill="none" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="24" cy="30" r="3" fill="${INK}"/><path d="M24 31v5" stroke="${INK}" stroke-width="2.5"/>`,
  sprout: `<path d="M24 42V24" stroke="#3F8F2A" stroke-width="4" stroke-linecap="round"/>
    <path d="M24 26c0-9-6-14-15-14 0 9 6 14 15 14z" fill="#5DBB3F" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 22c0-8 5-13 14-13 0 8-5 13-14 13z" fill="#9BE06A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M12 42h24" stroke="#8A5224" stroke-width="4" stroke-linecap="round"/>`,
  flower: `<g fill="#FF9BB0" stroke="${INK}" stroke-width="2.2"><ellipse cx="24" cy="11" rx="7" ry="10"/><ellipse cx="24" cy="37" rx="7" ry="10"/><ellipse cx="11" cy="24" rx="10" ry="7"/><ellipse cx="37" cy="24" rx="10" ry="7"/></g>
    <circle cx="24" cy="24" r="6.5" fill="#FFC83D" stroke="${INK}" stroke-width="2.2"/>`,
  ribbon: `<path d="M16 26l-6 18 7-4 4 7 5-17zM32 26l6 18-7-4-4 7-5-17z" fill="#4A7FE8" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="24" cy="19" r="14" fill="#F5C542" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="24" cy="19" r="9" fill="#FFE58A" stroke="#D9931F" stroke-width="2"/>
    <path d="M24 13l2 4 4.5.6-3.3 3.1.8 4.4-4-2.1-4 2.1.8-4.4-3.3-3.1 4.5-.6z" fill="#E39A1E"/>`,
  letter: `<rect x="6" y="12" width="36" height="26" rx="3" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5"/>
    <path d="M6 14l18 13 18-13" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="24" cy="27" r="5" fill="#E8556E" stroke="${INK}" stroke-width="2"/>`,
  chat: `<path d="M8 10h32a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H22l-9 8v-8H8a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="16" cy="22" r="2.6" fill="#8A6440"/><circle cx="24" cy="22" r="2.6" fill="#8A6440"/><circle cx="32" cy="22" r="2.6" fill="#8A6440"/>`,
  sun: `<g stroke="${INK}" stroke-width="2.5" stroke-linecap="round"><path d="M24 3v6M24 39v6M3 24h6M39 24h6M9 9l4.5 4.5M34.5 34.5L39 39M9 39l4.5-4.5M34.5 13.5L39 9"/></g>
    <circle cx="24" cy="24" r="11" fill="#FFC83D" stroke="${INK}" stroke-width="2.5"/>
    <path d="M18 20c1.5-3 4-4.5 7-4.5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.5" stroke-linecap="round"/>`,
  hand: `<path d="M17 25V12a3 3 0 0 1 6 0v10-13a3 3 0 0 1 6 0v13-10a3 3 0 0 1 6 0v12-6a3 3 0 0 1 6 0v12c0 10-6 16-14 16-6 0-9-3-13-8l-6-8a3 3 0 0 1 5-4z" fill="#FFD9B8" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
};

export function svgIcon(name, size = 28) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('glyph');
  svg.innerHTML = GLYPHS[name] || GLYPHS.star;     // static, trusted markup from this file only
  return svg;
}

export const GLYPH_NAMES = Object.freeze(Object.keys(GLYPHS));

/**
 * Link a stylesheet once. index.html links the panel sheets with a version (`/css/panels.css?v=<hash>`, rendered by
 * server/static.js): an `href$=` test missed those and appended a second, unversioned copy after every other sheet,
 * which also outranked css/mobile.css (mobile wave). Never throws (tests run without a document).
 */
export function ensureStylesheet(href) {
  try {
    const doc = globalThis.document;
    if (!doc || !doc.head || typeof doc.querySelectorAll !== 'function') return;
    const has = [...doc.querySelectorAll('link')].some((l) => String(l.getAttribute('href') || '').split('?')[0] === href);
    if (!has) doc.head.append(Object.assign(doc.createElement('link'), { rel: 'stylesheet', href }));
  } catch { /* no DOM: nothing to link */ }
}

/**
 * localStorage JSON with try/catch (private windows, blocked storage): UI conveniences only, never game state. A farm's
 * own keys (tips seen, drafts) are namespaced per farm in multi mode (net/farm.js `farm.key`); unchanged otherwise.
 */
export const kv = {
  get(key, fallback = null) {
    try {
      const raw = globalThis.localStorage?.getItem(farm.key(key));
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { globalThis.localStorage?.setItem(farm.key(key), JSON.stringify(value)); } catch { /* storage unavailable: keep it for this page */ }
  },
};

/**
 * CSS custom properties for a player's colour: --pc (the colour), --pcd (its ring / outline shade) and --pct (a text
 * shade, >= 4.5:1 on paper for every swatch, QA wave 1 UI-21), from the state's colour.
 */
export function playerVars(color) {
  const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#8A6440';
  const n = parseInt(c.slice(1), 16);
  const shade = (k) => `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`;
  return { '--pc': c, '--pcd': shade(0.68), '--pct': shade(0.5) };
}

/**
 * A farmer's mark: their initial in a badge ringed with their colour. Farmer 1's badge is a circle, farmer 2's a
 * rounded square, so "who did what" never rests on colour alone (GDD §7.5; QA wave 1 UI-05). `player` is the
 * state's player record (name, color); `pid` picks the shape.
 */
export function playerMark(pid, player, { size = 18, title = null } = {}) {
  const el = document.createElement('span');
  el.className = 'pmark';
  el.dataset.slot = /^p[0-9]+$/.test(String(pid)) ? String(pid) : 'p1';
  el.setAttribute('aria-hidden', 'true');
  const v = playerVars(player && player.color);
  el.style.setProperty('--pc', v['--pc']);
  el.style.setProperty('--pcd', v['--pcd']);
  if (size !== 18) { el.style.width = `${size}px`; el.style.height = `${size}px`; }
  if (title) el.title = title;
  el.textContent = ((player && player.name) || '?').slice(0, 1).toUpperCase();
  // a big mark (30 px and up: the duel's farmers) wears the farmer's portrait once this browser has drawn it
  // (peekPortrait reads the cache, it never draws); small marks (feed, orders, nursery) keep the initial
  const url = size >= 30 && player ? peekPortrait(portraitSpec(pid, player)) : null;
  if (url) { el.classList.add('has-portrait'); el.style.backgroundImage = `url("${url}")`; }
  return el;
}

/**
 * Count up/down a number in a text node over `ms` (outCubic); instant under reduced motion. A new value while a roll
 * runs re-targets it from the number on screen (one rAF loop per element, never a restart from the old target).
 */
export function rollNumber(el, to, { ms = 400, format = fmt } = {}) {
  const shown = Number.isFinite(el._rollAt) ? el._rollAt : Number(el.dataset.v ?? to);
  el.dataset.v = String(to);
  const still = document.body.classList.contains('motion-reduced')
    || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (shown === to || still) {
    if (el._rollRaf) { cancelAnimationFrame(el._rollRaf); el._rollRaf = 0; }
    el._rollAt = to;
    el.textContent = format(to);
    return;
  }
  el._rollSpec = { from: shown, to, t0: performance.now(), ms, format };
  if (el._rollRaf) return;
  const step = (t) => {
    const r = el._rollSpec;
    const k = Math.min(1, Math.max(0, (t - r.t0) / r.ms));
    const e = 1 - (1 - k) ** 3;
    const v = Math.round(r.from + (r.to - r.from) * e);
    el._rollAt = v;
    el.textContent = r.format(v);
    el._rollRaf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  el._rollRaf = requestAnimationFrame(step);
}

/** The player plays with a finger: the last pointer was a touch, or the device's main pointer is coarse. */
export function touchPlayer(controller) {
  if (controller?.input === 'touch') return true;
  // the controller says 'mouse' until the first touch: the device's main pointer decides until then
  return Boolean(typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(pointer: coarse)').matches);
}

/**
 * Hint text for a touch player: a line the catalogs gave touch words to says those (i18n touch variants, any language:
 * "Затвори (Esc)" -> "Затвори"); English source text otherwise reads "tap" for "click" and drops a key hint in brackets
 * ("(G)", "(2)"): a phone has no keyboard. Every text for a mouse player is returned as it is. Pure.
 */
export function touchText(text, touch) {
  if (!touch || typeof text !== 'string') return text;
  const twin = touchOf(text);
  if (twin !== undefined) return twin;
  // Bulgarian is written for both at once ("натисни" is a click and a tap; i18n glossary rule 9), and a line of it that
  // names a key has touch words in its catalog: nothing to rewrite
  if (lang() !== 'en') return text;
  return text
    // the Hammer's first tip (shared/content/tutorial.js): the touch build bar's buttons do it on a phone
    .replace(/\bR rotates, Esc cancels\./g, '⟳ turns it, ✕ cancels.') // i18n-ok: English only (Bulgarian has touch words)
    // the Hand's tip (shared/content/tools.js): a finger uproots with a long press on the crop
    .replace(/ Shift uproots\.$/, '') // i18n-ok: English only (Bulgarian has touch words)
    .replace(/\b([Cc])lick(s|ed|ing)?\b/g, (_, c, suf = '') => `${c === 'C' ? 'T' : 't'}ap${suf === 'ed' ? 'ped' : suf === 'ing' ? 'ping' : suf}`)
    .replace(/ \((?:[A-Z0-9]|(?:Ctrl|Shift|Alt)\+\w+|wheel|Space|Esc|Del)\)(?=[\s.,:;!?)]|$)/g, '');
}
