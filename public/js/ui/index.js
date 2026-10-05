// UI facade (FROZEN CONTRACT for the ui lanes; ui-shell owns this file): DOM HUD, toolbar, panel registry, toasts,
// dialogs, celebrations, tutorial, slot picker. Reads the store through topic subscriptions only and acts only
// through the controller (prediction). Everything below the M0 block is ADDITIVE.
//
// ---- M0 entry points (kept) ----------------------------------------------------------------------------------
//   ui.init(store, view, controller)        wire HUD + toolbar + panels (call once, after view.init)
//   ui.toast(codeOrText, { by?, type?, args? })  short message; ERR codes become friendly text; a SOFT code
//                                           (RESERVED, PINNED, BIG_SPEND) with { type, args } opens the "are you
//                                           sure?" dialog and re-sends with args.confirm on yes
//   ui.celebrate(ev)                        confirmed-only celebration (levelUp, achievement, questDone, duet, together)
//   ui.showSlots(slots, onPick(slot, name)) / ui.hideSlots() / ui.slotError(code)
//   ui.setConnection(status)                'open' | 'connecting' | 'reconnecting' | 'mismatch' (the server runs
//                                           other content: restart it, then reload; review-m0 H4) | 'degraded'
//   ui.setPeer(pid, online)
//   ui.tooltip(pick | null)                 hover tooltip after 250 ms (name, stage, time left, planter)
//   ui.firstUse(id)                         (additive, wave 3) a TUTORIAL.firstUse tip once per player (fishing, room)
//   ui.hideHud(hidden: boolean)             photo mode (P)
//   ui.notice(text)                         a longer, dismissable notice ("some recent actions were not saved")
//   ui.layout                               (additive, mobile wave) ui/layout.js: { mode: 'desktop' | 'tablet' | 'phone' |
//                                           'phone-land', is(name), insets() -> { top, right, bottom, left }, on(fn) }
//   ui.hints                                (additive, live requests 2026-10-04) ui/item-hint.js: the "where to get it"
//                                           bubble on every needed item ({ show(el), hide(), refresh(), el, current })
//
// ---- Panel registry: ui.panels (ui-panels registers its panels here) -----------------------------------------
// The shell draws the frame (wood frame, overhanging banner title + close button, optional tab strip, parchment
// body, scrim for modal sizes), stacks panels, closes the top one on Esc, traps Tab inside the top panel, returns
// focus to the opener, re-renders on store topics once per animation frame, and links HUD pills / dock buttons /
// hotkeys to panels by NAME. ui-panels exports `default function install(ui)` from `ui/panels/index.js`; ui.init
// imports it (dynamically, so a missing file never breaks the page) and calls it once.
//
//   ui.panels.register(name, spec) -> unregister()
//     spec.title      string | (args, state) => string        banner title (re-read on every open)
//     spec.icon?      content/icon id shown in the banner (render/icons.js iconUrl)
//     spec.size?      'side' (default; 400 px column at the right, the farm stays playable) | 'wide' (centred
//                     760 px) | 'full' (centred, up to 1120 x 86vh) | 'card' (centred 480 px: letters, confirms)
//     spec.modal?     default: false for 'side', true otherwise. Modal = scrim behind it; a scrim click closes it
//     spec.tabs?      [{ id, label, icon?, badge?, disabled?, hint? }] | (args, state) => tabs
//                     a tab strip under the title; ctx.tab is the selected id; args.tab picks one on open
//     spec.topics?    store topics ('wallet', 'inventory', 'objects', 'xp', 'players', ...) that call
//                     inst.update(change) while open, coalesced to one call per animation frame
//                     (change = { ids: Set, topics: Set, source, pending }); a welcome ('*') always matches
//     spec.hotkey?    one key ('m', 'i', 'o', 'j') that toggles the panel (ignored while typing or with modifiers)
//     spec.dock?      { label, icon (svg glyph name or content icon id), order, hint? }: a big round button in the
//                     bottom-right dock (GDD §7.3: Build | Market | Barn | Orders | Journal). Built-in names
//                     with a glyph: 'market' 'barn' 'orders' 'journal' 'book' 'note' 'star' 'heart' 'coin' 'acorn'
//     spec.locked?    (state) => null | 'Unlocks at level 2': the dock button and hotkey stay disabled with
//                     the reason as a tooltip (drip-feed, GDD §7.4)
//     spec.mount(body, ctx) -> inst?          build the body (a parchment <div>, emptied before each mount)
//        inst.update?(change)                 a subscribed topic changed (update text nodes, do not rebuild)
//        inst.tab?(id)                        the tab changed (without it, the body is re-mounted)
//        inst.destroy?()                      the panel closes or re-mounts (ctx.every/on/subscribe clean up alone)
//     spec.onClose?()                         after the panel closed
//     Legacy M0 form: { el, onOpen?, onClose? } shows/hides a pre-built element as-is.
//   ctx = { name, args, tab, store, view, controller, ui, el (frame), body,
//           now()                     estimated server time (for timers)
//           close()                   close this panel
//           open(name, args?)         open another panel ON TOP (a recipe picker over the building panel)
//           setTitle(text) / setTab(id) / refreshTabs()
//           every(ms, fn) -> stop     interval cleared on close (timers: update text nodes only)
//           on(target, event, fn)     store / controller / ui.panels / any EventTarget; unsubscribed on close
//           subscribe(topic, fn)      a raw store topic subscription, unsubscribed on close
//           act(type, args, at?)      controller.do: predicted action + toast/shake on a local refusal }
//   ui.panels.open(name, args?, { stack? }) -> boolean
//        replaces every open panel unless stack: true; re-opening an open panel with other args re-mounts it
//   ui.panels.close(name) / toggle(name, args?) / closeTop() / closeAll()
//   ui.panels.isOpen(name) / top() -> name | null / has(name) / list() -> [{ name, size, open, dock, hotkey, badge }]
//   ui.panels.badge(name, value | null, tone?)  a count / '!' / 'New' badge on the panel's dock button and HUD pill;
//                                           tone 'calm' = something to do there, nothing urgent (cream, not red: QA2 UI-03)
//   ui.panels.retitle(name)                 re-run spec.title for an open panel
//   ui.panels.on('register' | 'open' | 'close' | 'badge', fn) -> unsubscribe
// Names the shell links when they are registered (ui-panels picks the rest): 'market' (coins pill, M key; args
// { tab: 'sell' | 'seeds' | ... | 'acorn' }), 'barn' (barn pill, I key), 'orders' (O), 'journal' (J; args { tab }),
// 'notes' (the notes button), 'wardrobe' (hearts pill), 'building' { id }, 'animals' { id }, 'tree' { id },
// 'expansion' { id }. Until a name is registered its pill/button stays visible but inert (no dead panel).
//
// ---- Helpers for panels (re-exported from ui/dom.js; stable) -------------------------------------------------
//   h(tag, props?, ...children)  icon(id, { size, alt, cls })  svgIcon(name, size)  fmt(n)  fmtShort(n)
//   fmtDuration(ms)  plural(n, one, many?)  focusables(root)  kv (safe localStorage JSON)  playerVars(color)
//   errText(code) -> friendly sentence
//
// Store topics used: wallet, xp, inventory, players, objects, '*'.
import { defOf } from '../../../shared/content/index.js';
import { SLOT_COLORS } from '../../../shared/content/config.js';
import { ERR, SOFT } from '../../../shared/net/protocol.js';
import { h, icon, svgIcon, focusables, fmt as fmtNum, fmtDuration, playerVars, ensureStylesheet } from './dom.js';
import { createHud, createTips, portraitFace, showPortrait, initialOf } from './hud.js';
import { portraitSpec, lastPortrait } from '../render/portrait.js';
import { createToolbar } from './toolbar.js';
import { createToasts } from './toasts.js';
import { createDialogs } from './dialogs.js';
import { createLevelup } from './levelup.js';
import { createSettings } from './settings.js';
import { createSocial } from './social.js';
import { createFeed } from './feed.js';
import { createRecap } from './recap.js';
import { createNaming } from './naming.js';
import { createTutorial } from './tutorial.js';
import { createTracker } from './tracker.js';
import { createSeeds } from './seeds.js';
import { createLayout, LAYOUT_Q } from './layout.js';
import { createItemHints } from './item-hint.js';

export { h, icon, svgIcon, focusables, fmt, fmtShort, fmtDuration, plural, kv, playerVars, playerMark } from './dom.js';

const $ = (id) => document.getElementById(id);

/** Friendly text per error code (never a red flash: GDD §7.2 "Invalid action"). */
export const ERR_TEXT = Object.freeze({
  [ERR.BAD_ARGS]: "That didn't work. Try again?",
  [ERR.UNKNOWN_ACTION]: "That doesn't work here yet.",
  [ERR.RATE]: 'Easy there, farmer. One moment…',
  [ERR.NOT_FOUND]: "That's gone.",
  [ERR.EMPTY]: 'Nothing to harvest there.',
  [ERR.OCCUPIED]: 'Something is already growing there.',
  [ERR.NOT_READY]: 'Not ready yet.',
  [ERR.NOT_HUNGRY]: "They're not hungry yet.",
  [ERR.NO_COINS]: 'Not enough coins.',
  [ERR.NO_ACORNS]: 'Not enough Acorns.',
  [ERR.NO_ITEMS]: 'Not enough in the barn.',
  [ERR.STORAGE_FULL]: 'The barn is full. Sell or use something first.',
  [ERR.LOCKED]: 'Unlocks at a higher farm level.',
  [ERR.BLOCKED]: "That spot isn't free.",
  [ERR.OUT_OF_BOUNDS]: "That land isn't ours yet.",
  [ERR.QUEUE_FULL]: 'Every slot is busy. Add a slot or wait a moment.',
  [ERR.ALREADY_DONE]: 'Already done.',
  [ERR.NOT_REFUNDABLE]: "That can't be undone any more.",
  [ERR.COOLDOWN]: 'Not just yet. Try again in a little while.',
  [ERR.SELF_ONLY]: 'That one is for your partner to do.',
  [ERR.ID_TAKEN]: 'Hold on, catching up with the farm…',
  [ERR.CAP]: 'Plot limit reached for this level.',
  [ERR.NOT_JOINED]: 'Connecting to the farm…',
  [ERR.INTERNAL]: 'Something went wrong. It was not applied.',
  [ERR.OFFLINE]: 'Reconnecting to the farm… (input paused)',
  [ERR.RESERVED]: 'Some of these are kept for later.',
  [ERR.PINNED]: 'Your partner pinned this.',
  [ERR.BIG_SPEND]: 'That is a big purchase.',
  [ERR.PRICE]: 'The price just changed. Have another look.',
  [ERR.TOO_FAR]: 'Walk over to the bench first.',
  [ERR.PROTO]: 'The game was updated. Reloading…',
  [ERR.BAD_TOKEN]: 'Please pick your farmer again.',
  [ERR.SLOT_TAKEN]: 'That farmer is playing right now. Reclaim works while they are offline, or with the farm passphrase.',
  [ERR.FULL]: 'The farm is full.',
  [ERR.PASSPHRASE]: 'That passphrase is not right.',
  [ERR.BAD_HELLO]: 'This page could not join the farm. Reload to try again.',
  // QA2 UI-10 / RC-18: watering a crop too quick to need it (a literal key: the rules lane adds the code to ERR)
  NOT_NEEDED: 'Quick crops don\'t need water.',
});

/**
 * Bookkeeping actions the ui sends on its own (a ceremony or tip marked seen, a guide step ticked): a refusal only means
 * another tab or the partner got there first, so it is never worth a toast ("Already done." over a ceremony the player
 * just watched; QA2 UI-11, and the guide half of CL-04). Pure.
 */
const QUIET_TYPES = new Set(['markSeen', 'tutDone']);
export function quietRefusal(codeOrText, opts = {}) {
  return Boolean(opts && QUIET_TYPES.has(opts.type) && typeof codeOrText === 'string' && Object.hasOwn(ERR, codeOrText) && !SOFT.has(codeOrText));
}

/** Friendly sentence for an ERR code (or the text itself when it is not a code). */
export function errText(code) {
  if (Object.hasOwn(ERR_TEXT, code)) return ERR_TEXT[code];
  return Object.hasOwn(ERR, code) ? "That didn't work this time." : String(code);
}

// ---- panel registry (ui-shell owns the frame; ui-panels registers the content) ------------------------------
const panelEntries = new Map();      // name -> entry
const openStack = [];                // open panel names, bottom .. top
const panelEvents = { register: new Set(), open: new Set(), close: new Set(), badge: new Set() };
let S = null;                        // { store, view, controller } after ui.init
let scrimEl = null;
let layerEl = null;

function emitPanel(ev, ...a) {
  for (const fn of [...panelEvents[ev]]) {
    try { fn(...a); } catch (err) { console.error(`ui.panels '${ev}' listener failed`, err); }
  }
}

function panelLayer() {
  if (layerEl) return layerEl;
  layerEl = $('panels') || document.body.appendChild(h('div#panels'));
  scrimEl = $('scrim') || layerEl.appendChild(h('div#scrim.scrim', { hidden: true, 'aria-hidden': 'true' }));
  scrimEl.addEventListener('click', () => {
    const top = openStack.at(-1);
    if (top && panelEntries.get(top)?.modal) registry.close(top);
  });
  return layerEl;
}

const SIZES = new Set(['side', 'wide', 'full', 'card']);

function titleOf(e, args) {
  const t = e.spec.title;
  return typeof t === 'function' ? String(t(args || {}, S && S.store.state) ?? e.name) : String(t ?? e.name);
}
function tabsOf(e, args) {
  const t = e.spec.tabs;
  return (typeof t === 'function' ? t(args || {}, S && S.store.state) : t) || [];
}

function buildFrame(e) {
  const { name, spec } = e;
  const titleId = `panel-${name}-title`;
  e.titleText = h('span.hh-panel-title-text', { id: titleId });
  e.titleIcon = spec.icon ? icon(spec.icon, { size: 40, cls: 'hh-panel-title-icon' }) : null;
  e.closeBtn = h('button.btn.btn--stop.btn--round.hh-panel-close', {
    type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', on: { click: () => registry.close(name) },
  }, svgIcon('close', 26));
  e.tabsEl = h('div.hh-tabs', { role: 'tablist', hidden: true });
  e.body = h('div.hh-panel-body.paper');
  // the scroll box is a tab stop of its own (Chrome makes a scroll container focusable anyway): it is named, part of
  // the focus trap, and keyboard users can scroll a panel that has no button in its body (QA wave 1 UI-19)
  e.scroll = h('div.hh-panel-scroll', { tabindex: '0', role: 'region', 'aria-labelledby': titleId }, e.body);
  e.fade = h('div.scroll-fade', { 'aria-hidden': 'true' });
  e.frame = h(`section.hh-panel.wood.size-${e.size}`, {
    id: `panel-${name}`, role: 'dialog', 'aria-modal': String(e.modal), 'aria-labelledby': titleId,
    tabindex: '-1', hidden: true, dataset: { panel: name },
  },
  // the grip of a bottom sheet (phones, css/mobile.css); hidden on desktop. Swiping it (or the title) down closes
  h('div.hh-sheet-grip', { 'aria-hidden': 'true' }),
  h('header.hh-panel-title.wood', e.titleIcon, e.titleText), e.closeBtn, e.tabsEl, e.scroll, e.fade);
  sheetSwipe(e);
  // "more below": a soft fade at the bottom edge while the body scrolls on (UI-17)
  const fade = () => {
    const sc = e.scroll;
    e.frame.classList.toggle('more-below', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 8);
  };
  e.scroll.addEventListener('scroll', fade, { passive: true });
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(fade);
    ro.observe(e.scroll);
    ro.observe(e.body);
  }
  e.syncFade = fade;
  // a focus that leaves a modal panel (a click on nothing, a programmatic blur) comes back to its first control
  e.frame.addEventListener('focusout', (ev) => {
    if (!e.open || !e.modal || openStack.at(-1) !== e.name) return;
    const to = ev.relatedTarget;
    if (!to || (!e.frame.contains(to) && !to.closest?.('.hh-panel, .tip, .ih, #celebrate, .emote-wheel, .chat-box'))) {
      queueMicrotask(() => { if (e.open && !e.frame.contains(document.activeElement)) (focusables(e.frame)[0] || e.frame).focus({ preventScroll: true }); });
    }
  });
  panelLayer().append(e.frame);
}

// ---- bottom sheets on phones: swipe the grip or the title down (sideways to the right in landscape) to close ----
/**
 * Does a sheet drag of `d` px over `ms` close a sheet `size` px tall (wide in landscape)? A third of the way, or a
 * quick flick; a small wobble never closes it. Pure.
 */
export function sheetDismiss(d, ms, size) {
  if (!(d > 24)) return false;
  return d > Math.min(160, size * 0.3) || d / Math.max(1, ms) > 0.6;
}
const mqMatch = (q) => Boolean(globalThis.matchMedia?.(q).matches);
/** Is this panel a sheet right now: every panel on a portrait phone, all but the small cards on a landscape one. */
const isSheet = (e) => mqMatch(LAYOUT_Q.portrait) || (mqMatch(LAYOUT_Q.land) && e.size !== 'card');

function sheetSwipe(e) {
  const f = e.frame;
  let drag = null;
  f.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' || !e.open || !isSheet(e)) return;
    if (ev.target !== f && !ev.target.closest?.('.hh-sheet-grip, .hh-panel-title')) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), d: 0, land: mqMatch(LAYOUT_Q.land) };
    try { f.setPointerCapture(ev.pointerId); } catch { /* the pointer is already gone */ }
  });
  f.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    drag.d = Math.max(0, drag.land ? ev.clientX - drag.x : ev.clientY - drag.y);
    f.style.transition = 'none';
    f.style.transform = drag.land ? `translateX(${drag.d}px)` : `translateY(${drag.d}px)`;
  });
  const end = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const { d, t, land } = drag;
    drag = null;
    const size = land ? f.offsetWidth : f.offsetHeight;
    const reset = () => { f.style.transition = ''; f.style.transform = ''; };
    if (d === 0) { reset(); return; }
    f.style.transition = 'transform 180ms var(--ease-out)';
    if (sheetDismiss(d, performance.now() - t, size) && ev.type === 'pointerup') {
      f.style.transform = land ? 'translateX(105%)' : 'translateY(105%)';
      setTimeout(() => { registry.close(e.name, { instant: true }); reset(); }, 170);
    } else {
      f.style.transform = '';
      setTimeout(reset, 200);
    }
  };
  f.addEventListener('pointerup', end);
  f.addEventListener('pointercancel', end);
}

function renderTabs(e) {
  const tabs = tabsOf(e, e.args);
  e.tabsEl.replaceChildren();
  e.tabsEl.hidden = tabs.length === 0;
  e.body.setAttribute('role', tabs.length ? 'tabpanel' : 'region');
  if (!tabs.length) { e.tab = null; return; }
  if (!tabs.some((t) => t.id === e.tab)) e.tab = tabs.find((t) => !t.disabled)?.id ?? tabs[0].id;
  for (const t of tabs) {
    const sel = t.id === e.tab;
    const b = h('button.hh-tab', {
      type: 'button', role: 'tab', id: `panel-${e.name}-tab-${t.id}`, 'aria-selected': String(sel),
      tabindex: sel ? '0' : '-1', disabled: Boolean(t.disabled), title: t.hint || null, dataset: { tab: t.id },
      on: { click: () => setPanelTab(e, t.id) },
    }, t.icon ? icon(t.icon, { size: 24 }) : null, h('span', t.label ?? t.id),
    t.badge ? h('span.badge', String(t.badge)) : null);
    e.tabsEl.append(b);
  }
  e.body.setAttribute('aria-labelledby', `panel-${e.name}-tab-${e.tab}`);
  // a strip wider than a phone scrolls sideways: the chosen tab (Settings > Credits opened from a link, the fifth
  // tab) must not sit half off the edge
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
    const s = e.tabsEl;
    const b = s.querySelector('[aria-selected="true"]');
    if (!b || s.scrollWidth <= s.clientWidth) return;
    if (b.offsetLeft + b.offsetWidth > s.scrollLeft + s.clientWidth) s.scrollLeft = b.offsetLeft + b.offsetWidth - s.clientWidth + 12;
    else if (b.offsetLeft < s.scrollLeft) s.scrollLeft = Math.max(0, b.offsetLeft - 12);
  });
}

function setPanelTab(e, id) {
  if (!e.open || e.tab === id) return;
  e.tab = id;
  renderTabs(e);
  if (e.inst && typeof e.inst.tab === 'function') {
    try { e.inst.tab(id); } catch (err) { console.error(`panel '${e.name}' tab() failed`, err); }
  } else {
    mountPanel(e);
  }
  e.tabsEl.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}

function unmountPanel(e) {
  for (const off of e.cleanups.splice(0)) { try { off(); } catch { /* already gone */ } }
  if (e.raf) { cancelAnimationFrame(e.raf); e.raf = 0; e.pendingChange = null; }
  if (e.inst && typeof e.inst.destroy === 'function') {
    try { e.inst.destroy(); } catch (err) { console.error(`panel '${e.name}' destroy() failed`, err); }
  }
  e.inst = null;
  e.body.replaceChildren();
}

function panelCtx(e) {
  const own = (off) => { e.cleanups.push(off); return off; };
  return {
    name: e.name,
    get args() { return e.args; },
    get tab() { return e.tab; },
    store: S.store, view: S.view, controller: S.controller, ui,
    el: e.frame, body: e.body,
    now: () => S.store.now(),
    close: () => registry.close(e.name),
    open: (name, args) => registry.open(name, args, { stack: true }),
    setTitle: (text) => { e.titleText.textContent = String(text); },
    setTab: (id) => setPanelTab(e, id),
    refreshTabs: () => renderTabs(e),
    every(ms, fn) { const t = setInterval(fn, Math.max(100, ms)); return own(() => clearInterval(t)); },
    on(target, ev, fn) {
      if (target && typeof target.on === 'function') return own(target.on(ev, fn) || (() => {}));
      target.addEventListener(ev, fn);
      return own(() => target.removeEventListener(ev, fn));
    },
    subscribe: (topic, fn) => own(S.store.subscribe(topic, fn)),
    act: (type, args, at) => (S.controller.do ? S.controller.do(type, args, at) : S.store.act(type, args)),
  };
}

function mountPanel(e) {
  unmountPanel(e);
  e.titleText.textContent = titleOf(e, e.args);
  const ctx = panelCtx(e);
  try {
    e.inst = e.spec.mount(e.body, ctx) || {};
  } catch (err) {
    console.error(`panel '${e.name}' mount() failed`, err);
    e.body.replaceChildren(h('p.empty-note', 'This page could not be drawn. The farm is fine; try again in a moment.'));
    e.inst = {};
  }
  const topics = e.spec.topics || [];
  if (topics.length && typeof e.inst.update === 'function') {
    // One update per animation frame with the union of the changes: a drag-paint stroke fires dozens of
    // store changes per frame and a panel must not rebuild for each.
    e.cleanups.push(S.store.on('change', (ch) => {
      if (!ch.topics.has('*') && !topics.some((t) => ch.topics.has(t))) return;
      const p = e.pendingChange || (e.pendingChange = { ids: new Set(), topics: new Set(), source: ch.source, pending: 0 });
      for (const id of ch.ids) p.ids.add(id);
      for (const t of ch.topics) p.topics.add(t);
      p.source = ch.source;
      p.pending = ch.pending;
      if (!e.raf) {
        e.raf = requestAnimationFrame(() => {
          e.raf = 0;
          const c = e.pendingChange;
          e.pendingChange = null;
          if (!e.open || !c) return;
          try { e.inst.update(c); } catch (err) { console.error(`panel '${e.name}' update() failed`, err); }
        });
      }
    }));
  }
}

function syncStacking() {
  let topModal = -1;
  openStack.forEach((n, i) => {
    const e = panelEntries.get(n);
    e.frame.style.zIndex = String(50 + i * 2);
    e.frame.classList.toggle('is-top', i === openStack.length - 1);
    if (e.modal) topModal = i;
  });
  if (!scrimEl) return;
  scrimEl.hidden = topModal < 0;
  if (topModal >= 0) scrimEl.style.zIndex = String(49 + topModal * 2);
  document.body.classList.toggle('panel-open', openStack.length > 0);
}

function sameArgs(a, b) {
  try { return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {}); } catch { return false; }
}

/** The panel registry (ui.panels). The API is documented in the header of this file. */
const registry = {
  register(name, spec) {
    if (typeof name !== 'string' || !name || !spec) throw new Error('ui.panels.register(name, spec)');
    if (panelEntries.has(name)) registry.unregister(name);
    const legacy = Boolean(spec.el) && typeof spec.mount !== 'function';
    const size = SIZES.has(spec.size) ? spec.size : 'side';
    const e = {
      name, spec, legacy, size, modal: spec.modal ?? (size !== 'side'), open: false, args: {}, tab: null,
      inst: null, cleanups: [], opener: null, hideT: 0, badge: null, raf: 0, pendingChange: null,
    };
    if (legacy) {
      e.frame = spec.el;
      for (const b of spec.el.querySelectorAll('[data-close]')) b.addEventListener('click', () => registry.close(name));
    } else {
      if (typeof spec.mount !== 'function') throw new Error(`ui.panels.register('${name}'): spec.mount(body, ctx) is required`);
      // the frame is built the first time the panel opens (wave 4): ~45 panels used to carry ~15 hidden nodes and two
      // ResizeObservers each from the boot on, most of them never opened in an evening
      e.frame = null;
    }
    panelEntries.set(name, e);
    emitPanel('register', name, spec);
    return () => registry.unregister(name);
  },

  unregister(name) {
    const e = panelEntries.get(name);
    if (!e) return;
    registry.close(name, { instant: true });
    if (!e.legacy) e.frame?.remove();
    panelEntries.delete(name);
    emitPanel('register', name, null);
  },

  open(name, args = {}, { stack = false } = {}) {
    const e = panelEntries.get(name);
    if (!e || !S) return false;
    if (e.open) {
      if (!e.legacy && !sameArgs(args, e.args)) {
        e.args = args || {};
        if (args && args.tab) e.tab = args.tab;
        renderTabs(e);
        mountPanel(e);
      }
      if (openStack.at(-1) !== name) { openStack.splice(openStack.indexOf(name), 1); openStack.push(name); syncStacking(); }
      e.frame.focus({ preventScroll: true });
      return true;
    }
    const active = document.activeElement;             // before other panels close (their buttons lose focus)
    if (!stack) for (const n of [...openStack]) registry.close(n, { instant: true, keepFocus: true });
    if (!e.frame) buildFrame(e);
    e.opener = active && active !== document.body && !e.frame.contains(active) ? active : (e.opener && e.opener.isConnected ? e.opener : null);
    e.args = args || {};
    e.open = true;
    clearTimeout(e.hideT);
    if (e.legacy) {
      e.frame.hidden = false;
      try { e.spec.onOpen?.(e.args); } catch (err) { console.error(`panel '${name}' onOpen failed`, err); }
    } else {
      if (e.args.tab) e.tab = e.args.tab;
      renderTabs(e);
      mountPanel(e);
      e.frame.classList.remove('is-closing');
      e.frame.hidden = false;
      e.frame.classList.remove('is-opening');
      void e.frame.offsetWidth;          // restart the open animation
      e.frame.classList.add('is-opening');
    }
    openStack.push(name);
    syncStacking();
    e.frame.focus({ preventScroll: true });
    emitPanel('open', name, e.args);
    return true;
  },

  close(name, { instant = false, keepFocus = false } = {}) {
    const e = panelEntries.get(name);
    if (!e || !e.open) return false;
    e.open = false;
    const i = openStack.indexOf(name);
    if (i >= 0) openStack.splice(i, 1);
    const hadFocus = e.frame.contains(document.activeElement);
    if (e.legacy) {
      e.frame.hidden = true;
      try { e.spec.onClose?.(); } catch (err) { console.error(`panel '${name}' onClose failed`, err); }
    } else {
      unmountPanel(e);
      e.frame.classList.remove('is-opening');
      if (instant) e.frame.hidden = true;
      else {
        e.frame.classList.add('is-closing');
        e.hideT = setTimeout(() => { if (!e.open) { e.frame.hidden = true; e.frame.classList.remove('is-closing'); } }, 160);
      }
      try { e.spec.onClose?.(); } catch (err) { console.error(`panel '${name}' onClose failed`, err); }
    }
    syncStacking();
    if (!keepFocus && hadFocus) {
      const below = openStack.at(-1);
      const target = below ? panelEntries.get(below).frame : e.opener;
      if (target && target.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true });
      else document.activeElement?.blur?.();
    }
    emitPanel('close', name);
    return true;
  },

  toggle(name, args) {
    const e = panelEntries.get(name);
    if (!e) return false;
    return e.open ? registry.close(name) : registry.open(name, args);
  },
  closeTop() { const n = openStack.at(-1); return n ? registry.close(n) : false; },
  closeAll() { for (const n of [...openStack].reverse()) registry.close(n, { instant: true }); },
  isOpen(name) { return Boolean(panelEntries.get(name)?.open); },
  top() { return openStack.at(-1) ?? null; },
  has(name) { return panelEntries.has(name); },
  list() {
    return [...panelEntries.values()].map((e) => ({ name: e.name, size: e.size, open: e.open, dock: e.spec.dock || null, hotkey: e.spec.hotkey || null,
      badge: e.badge, badgeTone: e.badgeTone ?? null }));
  },
  badge(name, value, tone = null) {
    const e = panelEntries.get(name);
    if (!e) return;
    const v = value === undefined || value === null || value === 0 || value === false ? null : value;
    const t = v === null ? null : tone === 'calm' ? 'calm' : null;
    if (e.badge === v && (e.badgeTone ?? null) === t) return;
    e.badge = v;
    e.badgeTone = t;
    emitPanel('badge', name, v);
  },
  on(ev, fn) {
    const set = panelEvents[ev];
    if (!set) return () => {};
    set.add(fn);
    return () => set.delete(fn);
  },
  /** Re-run the title function of an open panel (e.g. after its object was renamed). */
  retitle(name) {
    const e = panelEntries.get(name);
    if (e && e.open && !e.legacy) e.titleText.textContent = titleOf(e, e.args);
  },
};

/** The physical key (KeyboardEvent.code) of a panel hotkey: 'm' -> 'KeyM', ',' -> 'Comma' (any keyboard layout). */
const PUNCT_CODES = { ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote' };
export function hotkeyCode(hk) {
  if (/^[a-z]$/.test(hk)) return `Key${hk.toUpperCase()}`;
  if (/^[0-9]$/.test(hk)) return `Digit${hk}`;
  return PUNCT_CODES[hk] ?? hk;
}

function isTyping(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Esc, focus trap and panel hotkeys. Capture phase: a panel that eats Esc must not also reset the tool. */
function onPanelKeys(e) {
  const top = openStack.at(-1);
  const te = top ? panelEntries.get(top) : null;
  if (e.key === 'Escape' && te && !(e.target && e.target.closest && e.target.closest('.chat-box, .emote-wheel'))) {
    e.preventDefault();
    e.stopPropagation();
    registry.close(top);
    return;
  }
  if (e.key === 'Tab' && te && (te.modal || te.frame.contains(document.activeElement))) {
    const f = focusables(te.frame);
    if (!f.length) { e.preventDefault(); te.frame.focus(); return; }
    const first = f[0];
    const last = f.at(-1);
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === te.frame || !te.frame.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !te.frame.contains(a))) { e.preventDefault(); first.focus(); }
    return;
  }
  if (te && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.getAttribute?.('role') === 'tab' && te.tabsEl && te.tabsEl.contains(e.target)) {
    const tabs = [...te.tabsEl.querySelectorAll('[role="tab"]:not([disabled])')];
    const i = tabs.indexOf(e.target);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (next) { e.preventDefault(); setPanelTab(te, next.dataset.tab); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || e.repeat) return;
  // physical keys (a Bulgarian or German layout must not move M / I / O / J), rebindable through the controller's
  // keymap when it has one ('ui' actions named after the panels)
  const keymap = S && S.controller && S.controller.keys;
  const action = keymap && typeof keymap.actionOf === 'function' ? keymap.actionOf(e) : null;
  for (const p of panelEntries.values()) {
    const hk = p.spec.hotkey ? p.spec.hotkey.toLowerCase() : null;
    const hit = action ? action === p.name : hk && (e.code === hotkeyCode(hk) || (!e.code && e.key.toLowerCase() === hk));
    if (hit && !(p.spec.locked && S && S.store.state && p.spec.locked(S.store.state))) {
      e.preventDefault();
      e.stopPropagation();
      registry.toggle(p.name);
      return;
    }
  }
}

// ---- the facade ------------------------------------------------------------------------------------------------
let mods = null;          // { hud, tips, toolbar, toasts, dialogs, levelup, settings, social, feed, recap, naming, tutorial, tracker }
const pendingPeers = new Map();
let pendingConn = null;

async function installPanels() {
  // ui-panels' module registers every content panel through ui.panels.register (see the header). Loaded
  // dynamically so the shell works before (and without) it; its stylesheet comes with it.
  try {
    const mod = await import('./panels/index.js');
    ensureStylesheet('/css/panels.css');
    const install = mod.default || mod.install;
    if (typeof install === 'function') await install(ui, { store: S && S.store });
  } catch (err) {
    if (!/Failed to fetch|Importing a module script failed|error loading dynamically imported module|404/i.test(String(err && err.message))) {
      console.error('ui panels failed to install', err);
    }
  }
}

export const ui = {
  init(store, view, controller) {
    S = { store, view, controller, ui };
    $('hud').hidden = false;
    hideBoot();
    const ctx = S;
    ctx.panelSpec = (name) => panelEntries.get(name)?.spec ?? null;
    ctx.settings = createSettings(ctx);
    ui.settings = ctx.settings;
    const toasts = createToasts(ctx, errText);
    ctx.toasts = toasts;
    const dialogs = createDialogs(ctx);
    const hud = createHud(ctx);
    ctx.hud = hud;
    const tips = createTips(ctx);
    ctx.feed = createFeed(ctx);
    ctx.tutorial = createTutorial(ctx);
    const toolbar = createToolbar(ctx);
    ctx.toolbar = toolbar;
    // the seed picker at an empty plot, the quick-seed strip and the crop cursor (live requests 2026-10-04)
    ctx.seeds = createSeeds(ctx);
    ctx.social = createSocial(ctx);
    // phones and tablets: html[data-layout], the farm menu button and its panel (css/mobile.css lays them out)
    ctx.layout = createLayout(ctx);
    ui.layout = ctx.layout;
    const levelup = createLevelup(ctx);
    const tracker = createTracker(ctx);
    const naming = createNaming(ctx);
    const recap = createRecap(ctx);
    // "where to get it" bubbles on every needed item of every panel (live requests 2026-10-04); before the panels' keys:
    // the first Esc closes the bubble, not the panel under it
    const hints = createItemHints(ctx);
    ui.hints = hints;
    mods = { hud, tips, toolbar, toasts, dialogs, levelup, settings: ctx.settings, social: ctx.social, feed: ctx.feed, recap, naming, tutorial: ctx.tutorial, tracker, hints };
    ctx.comboActive = () => {
      const c = store.state && store.state.farm.coop && store.state.farm.coop.combo;
      return Boolean(c && c.until && c.until > store.now());
    };

    window.addEventListener('keydown', onPanelKeys, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('hud-hidden')) ui.photoMode(false);
    });

    // server rejections are toasted by the feedback layer (game/feedback.js): it coalesces lost races and stays
    // quiet during a Together Combo
    store.on('celebrate', ({ ev }) => ui.celebrate(ev));
    store.on('fx', ({ ev, by }) => onFx(ev, by));
    store.on('welcome', () => { hud.refresh(); toolbar.render(); ctx.feed.render(); tracker.render(); ctx.tutorial.render(); recap.onWelcome(); naming.maybeOpen(); });
    controller.on('hover', (p) => tips.tooltip(p));
    // a touch player's world card outlives the finger: a panel coming up puts it away
    ui.panels.on('open', () => tips.tooltip(null, { force: true }));

    ctx.settings.apply();
    if (store.state) { hud.refresh(); toolbar.render(); ctx.feed.render(); tracker.render(); ctx.tutorial.render(); recap.onWelcome(); naming.maybeOpen(); }
    for (const [pid, on] of pendingPeers) hud.setPeer(pid, on);
    if (pendingConn) hud.setConnection(pendingConn);
    installPanels();
  },

  /** Short line at the top. A SOFT code with { type, args } from a local refusal asks "are you sure?" instead. */
  toast(codeOrText, opts = {}) {
    if (!mods) { console.info('ui.toast before init:', codeOrText); return null; }
    if (quietRefusal(codeOrText, opts)) return null;
    if (SOFT.has(codeOrText) && opts && opts.type && !opts.by) {
      mods.dialogs.softConfirm(codeOrText, { type: opts.type, args: opts.args || {} });
      return null;
    }
    return mods.toasts.toast(codeOrText, opts);
  },

  celebrate(ev) { if (mods) mods.levelup.celebrate(ev); },

  panels: registry,

  showSlots(slots, onPick, opts = {}) { hideBoot(); showSlots(slots, onPick, opts); },
  hideSlots() { $('slot-picker').hidden = true; },
  slotError(code) {
    // on the slot picker a RATE refusal means the passphrase lockout (server: 5 wrong ones, one minute)
    $('slot-error').textContent = code === ERR.RATE ? 'Too many wrong passphrases. Wait a minute.' : errText(code);
  },

  setPending(p) { if (mods) mods.hud.setPending(p); },
  setConnection(status) {
    if (mods) { mods.hud.setConnection(status); return; }
    pendingConn = status;
    bootLine(status);
  },
  setPeer(pid, isOnline) {
    const was = mods ? mods.hud.isOnline(pid) : pendingPeers.get(pid);
    if (!mods) { pendingPeers.set(pid, isOnline); return; }
    mods.hud.setPeer(pid, isOnline);
    if (S.store.state && pid !== S.store.pid && was !== isOnline && was !== undefined) {
      const p = S.store.state.players[pid];
      if (p) {
        mods.feed.push({ by: pid, actor: p.name, text: isOnline ? 'arrived on the farm 🌻' : 'left for now', glyph: isOnline ? 'heart' : null });
        if (isOnline) mods.toasts.toast(`${p.name} arrived 🌻`, { kind: 'love', ms: 3500 });
      }
    }
  },
  tooltip(pick) { if (mods) mods.tips.tooltip(pick); },
  /** A first-use tip by its content id (TUTORIAL.firstUse), once per player (additive, wave 3: world moments). */
  firstUse(id) { if (mods && mods.tutorial) mods.tutorial.firstUse(id); },
  hideHud(hidden) { document.body.classList.toggle('hud-hidden', Boolean(hidden)); },
  notice(text, opts) { return mods ? mods.toasts.notice(text, opts) : null; },

  // ---- additive (wave 1, ui-shell) ------------------------------------------------------------------------
  /** A non-modal card in the right column: { ribbon, things: [{icon, name}], message, actions: [{label, fn, kind}], ttl, id }. */
  banner(o) { return mods ? mods.toasts.banner(o) : null; },
  /** "Are you sure?" card -> Promise<boolean> ({ title, lead, body, icon, cost: {coins, acorns}, ok, cancel, okKind, fine }). */
  confirm(o) { return mods ? mods.dialogs.confirm(o) : Promise.resolve(false); },
  /** Relayed social messages (main.js: MSG.EMOTE { pid, id } -> ui.emote; MSG.MARK { pid, x, z, kind } -> ui.mark). */
  emote(pid, id) { if (mods) mods.social.emote(pid, id); },
  mark(pid, m) { if (mods) mods.social.mark(pid, m); },
  /** A relayed chat line (MSG.CHAT { pid, ts, text }) and welcome.chat (late joiners). */
  chat(m) { if (mods) mods.social.chat(m); },
  chatHistory(list) { if (mods) mods.social.chatHistory(list); },
  /** Open the seed tray (the Smart Hand on an empty plot without a chosen seed, GDD §7.1). */
  openSeeds(open = true) { if (mods) mods.toolbar.openSeeds(open); },
  /** Photo mode (P): hide every HUD element; P or Esc brings it back. */
  photoMode(on) {
    ui.hideHud(on);
    if (on && mods) mods.toasts.toast('Photo mode: press P or Esc to come back', { kind: 'info', ms: 2000 });
  },
  /**
   * A photo on a phone (mobile QA M-08): the picture itself, to press and hold and save (an http page's download is
   * blocked or asked about on a phone, so "saved to your downloads" was a guess). Returns the overlay element.
   */
  photoPreview(blob) {
    if (!blob || typeof URL?.createObjectURL !== 'function') return null;
    document.getElementById('photo-sheet')?.remove();
    const url = URL.createObjectURL(blob);
    const close = () => { el.remove(); URL.revokeObjectURL(url); };
    const el = h('div.photo-sheet#photo-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your photo' },
      h('img.photo-sheet-img', { src: url, alt: 'A photo of the farm' }),
      h('p.photo-sheet-msg', 'Press and hold the picture to save or share it.'),
      h('button.btn.btn--sky.photo-sheet-done', { type: 'button', on: { click: close } }, 'Done'));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.append(el);
    el.querySelector('button')?.focus({ preventScroll: true });
    return el;
  },
  /** The farm-naming card (Settings > Farm > Rename; the tutorial opens it by itself). */
  nameFarm() { if (mods) mods.naming.open(); },
  /** Forget this tab's farmer and show the slot picker again (two tabs can be both partners). */
  switchFarmer() {
    try { sessionStorage.removeItem('hh.slot'); } catch { /* private mode */ }
    const u = new URL(location.href);
    u.searchParams.delete('slot');
    u.searchParams.delete('name');
    location.href = u.toString();
  },
  /** The activity feed's local captions ({ text, by?, icon? }); the ring lines come from the state. */
  caption(line) { if (mods && mods.settings.get().captions) mods.feed.push(line); },
  /** Per-browser settings: get() / set(patch) / on(fn) (filled by init). */
  settings: null,
};

/** World feedback the shell reacts to (partner heads-ups, hearts). The Level-up Bloom is a celebration (levelup.js). */
function onFx(ev, by) {
  if (!ev || !mods) return;
  const st = S.store.state;
  const other = by && st && by !== S.store.pid && Object.hasOwn(st.players, by) ? st.players[by] : null;
  switch (ev.e) {
    // The BIG_SPEND heads-up on the partner's screen has ONE source: the feedback layer (game/feedback.js), driven by
    // the rules' verdict. This path used to add a second, differently worded toast (QA wave 1 CL-02 / ui-ux-19).
    case 'duetPressed': {
      // the partner pressed "Cook together": invite me wherever I am (not only when the same panel is open; UI-08)
      if (!other) return;
      mods.toasts.duetAsk(ev, other, { join: () => joinDuet(ev) });
      return;
    }
    case 'duet': case 'queued':
      if (ev.e === 'duet' || ev.duet) mods.toasts.closeBanner(`duet-ask-${ev.id}`);
      return;
    case 'wishAsked': {
      // the wish's owner hears about a release request at once, with the answer at hand (UI-10)
      if (ev.owner !== S.store.pid || !other) return;
      const w = st.farm.wishlist && st.farm.wishlist[ev.id];
      const name = w ? `the ${defOf(w.def)?.name ?? CONTENT_NAME(w.def)}` : 'a wish';
      mods.toasts.banner({
        id: `wish-ask-${ev.id}`, kind: 'wish', ribbon: 'A wish question',
        message: `${other.name} would like to use the ${fmtNum(w ? w.coins : 0)} coins you saved for ${name}. With no answer it is released in ${fmtDuration(Math.max(0, (ev.until ?? 0) - S.store.now())).replace(/ 0\d?[ms]$/, '')}.`,
        things: w ? [{ icon: w.def, name }] : [],
        actions: [
          { label: 'Yes, go ahead', kind: 'go', fn: () => S.controller.do('wishAnswer', { id: ev.id, ok: true }) },
          { label: 'Keep saving', kind: 'paper', fn: () => S.controller.do('wishAnswer', { id: ev.id, ok: false }) },
        ],
        ttl: 60_000,
      });
      return;
    }
    case 'wishWithdrawn': case 'wishDenied':
      mods.toasts.closeBanner(`wish-ask-${ev.id}`);
      return;
    case 'hearts':
      if (ev.pid === S.store.pid && ev.n > 0) {
        // with two of you, "someone" is always the partner: say who (QA wave 1 CL-04)
        const them = other ? other.name : partnerName();
        const why = { thanks: `${them} said thanks`, team: 'Teamwork', tend: `${them} tended your crops`, highFive: 'High five!', keepsake: `A keepsake from ${them}` }[ev.why];
        mods.toasts.toast(`+${ev.n} ♥${why ? `  ${why}` : ''}`, { kind: 'love', ms: 2200 });
      }
      return;
    case 'highFiveWait':
      if (other) mods.toasts.toast(`${other.name} holds up a hand for a high five ✋ (T)`, { kind: 'love', ms: 3000 });
      return;
    default:
  }
}

/** The other farmer's name (two players), or "Your partner". */
function partnerName() {
  const st = S && S.store.state;
  const pid = st ? Object.keys(st.players).find((p) => p !== S.store.pid) : null;
  return pid ? st.players[pid].name : 'Your partner';
}
const CONTENT_NAME = (id) => String(id || '').replace(/_/g, ' ');

/** "Join" on the partner's Duet invitation: press "Cook together" now and show the recipe in its building. */
function joinDuet(ev) {
  const r = S.controller.do('duet', { id: ev.id, recipe: ev.recipe });
  if (registry.has('building')) registry.open('building', { id: ev.id, focus: ev.recipe });
  return r;
}

// ---- boot card (before the first welcome) ---------------------------------------------------------------------
// a player who chose Reduce motion / Still in Settings gets it on the title screens too (the welcome smoke rests);
// settings.apply() takes over at ui.init
try {
  const motion = globalThis.localStorage ? JSON.parse(localStorage.getItem('hh.settings') || 'null')?.motion : null;
  if (motion === 'reduced' || motion === 'still') document.body.classList.add('motion-reduced');
} catch { /* storage blocked or a broken value: the media query still applies */ }
// the chimney smoke rises over the painting only once the painting is there (the slot picker's loads when it is first
// shown: a plume over the bare backdrop for a moment read as a glitch)
function paintWhenLoaded(layer) {
  if (!layer || layer.dataset.painting) return;
  layer.dataset.painting = '1';
  const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(layer).backgroundImage || '');
  if (!m || typeof Image !== 'function') { layer.classList.add('painted'); return; }
  const img = new Image();
  img.onload = img.onerror = () => layer.classList.add('painted');
  img.src = m[1];
}
if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') paintWhenLoaded(document.getElementById('boot'));
let bootTimer = 0;
function hideBoot() { clearTimeout(bootTimer); const b = $('boot'); if (b) b.hidden = true; }
// main.js reports a failed boot (no WebGL2) by appending a <p> to <body>: the title card steps aside for it
if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
  const mo = new MutationObserver((list) => {
    if (list.some((m) => [...m.addedNodes].some((n) => n.tagName === 'P'))) { hideBoot(); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true });
}
function bootLine(status) {
  const b = $('boot');
  if (!b) return;
  const line = $('boot-line');
  const text = $('boot-text');
  line.classList.toggle('bad', status === 'mismatch');
  line.querySelector('.reload')?.remove();
  if (status === 'mismatch') {
    b.hidden = false;
    $('slot-picker').hidden = true;
    text.textContent = 'The farm server runs other game files. Restart it, then reload.';
    line.append(h('button.btn.btn--sun.btn--small.reload', { type: 'button', on: { click: () => location.reload() } }, 'Reload'));
    return;
  }
  if (b.hidden) return;
  if (status === 'open') { text.textContent = 'Opening the gate…'; return; }
  text.textContent = status === 'reconnecting' ? 'The farm is not answering yet. Trying again…' : 'Waking up the farm…';
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => { if (!b.hidden) text.textContent = 'The farm server seems to be asleep. Is it running? Still trying…'; }, 15_000);
}

// ---- slot picker (first screen: who is playing here; name + colour; passphrase; reclaim) -------------------
// the six colours with the names a person says (the picker used to read "Colour #2BB3A3"; QA wave 1 UI-31)
export const SWATCH_NAMES = Object.freeze({ '#2BB3A3': 'Teal', '#FF7A6B': 'Coral', '#FFC83D': 'Sunflower', '#4AA8E8': 'Sky',
  '#9B6BD6': 'Plum', '#5DBB3F': 'Leaf' });
const SWATCHES = Object.keys(SWATCH_NAMES);
const swatchName = (c) => SWATCH_NAMES[String(c || '').toUpperCase()] ?? 'this colour';

/**
 * Colours a free slot may take: every swatch except those a claimed farmer already wears (QA wave 1 UI-05: both
 * farmers could pick the same colour, and "who did what" became unreadable). Pure.
 */
export function freeSwatches(slots, pid) {
  const taken = new Map();
  for (const s of slots) if (s.claimed && s.pid !== pid && s.color) taken.set(String(s.color).toUpperCase(), s.name || s.pid);
  return SWATCHES.map((c) => ({ color: c, name: SWATCH_NAMES[c], takenBy: taken.get(c) ?? null }));
}

/**
 * A slot's farmer portrait (wave 4b, hud lane): their look when the slot list carries it (`avatar`), else for a claimed
 * farmer the newest picture this browser drew of them in that colour, else the slot's own farmer in the chosen colour.
 * Drawn by the view (render/index.js view.portrait), which is up before the slot picker shows.
 */
function slotPortrait(face, s, color) {
  const spec = portraitSpec(s.pid, { color, avatar: s.avatar ?? null });
  const last = s.claimed && s.avatar === undefined ? lastPortrait(s.pid, spec.color) : null;
  if (last) {
    const img = face.querySelector('img.pf');
    face.dataset.pk = `last:${spec.color}`;
    img.src = last;
    face.classList.add('has-portrait');
    return;
  }
  import('../render/index.js').then(({ view }) => showPortrait(face, spec, view), () => {});
}

function showSlots(slots, onPick, opts = {}) {
  const list = $('slot-list');
  list.replaceChildren();
  $('slot-error').textContent = '';
  const needPass = Boolean(opts.pass || slots.some((s) => s.pass));
  const anyFree = slots.some((s) => !s.claimed);
  // final release V-15: two identical rows read as "both names needed"; each farmer takes ONE row on their own screen
  const bothFree = slots.length > 1 && slots.every((s) => !s.claimed);
  $('slot-sub').textContent = bothFree ? 'Pick one farmer for this screen. Your partner takes the other one on their own screen.'
    : anyFree ? 'Who is playing on this screen?' : 'Welcome back! Who is playing on this screen?';
  for (const s of slots) {
    const swatches = freeSwatches(slots, s.pid);
    let base = s.color || SLOT_COLORS[s.pid] || SWATCHES[0];
    // a free slot never starts on a colour the other farmer already wears
    if (!s.claimed && swatches.some((w) => w.color === String(base).toUpperCase() && w.takenBy)) base = swatches.find((w) => !w.takenBy)?.color ?? base;
    let color = base;
    // the farmer's portrait (wave 4b, hud lane), the initial until it is drawn
    const face = portraitFace(initialOf(s.name));
    for (const [k, v] of Object.entries(playerVars(base))) face.style.setProperty(k, v);
    slotPortrait(face, s, base);
    const row = h('div.slot', { dataset: { slot: s.pid } }, face);
    if (s.claimed) {
      row.append(h('span.taken', s.name || s.pid, h('small', s.online ? 'Playing right now' : 'Away')));
      if (s.mine) {
        row.append(h('button.btn.btn--small', { type: 'button', on: { click: () => onPick(s.pid, null) } }, 'Continue'));
      } else if (!s.online || needPass) {
        // a lost token: "this is me on a new device" (needs the passphrase when the server has one)
        const pass = needPass ? h('input.field.pass', { type: 'password', placeholder: 'Farm passphrase', 'aria-label': 'Farm passphrase', autocomplete: 'current-password' }) : null;
        const go = () => onPick(s.pid, s.name, { reclaim: true, pass: pass ? pass.value : undefined, color: s.color });
        row.append(h('button.reclaim', { type: 'button', on: { click: () => { if (pass && !pass.value) { pass.hidden = false; pass.focus(); return; } go(); } } }, 'This is me on a new computer'));
        if (pass) { pass.hidden = true; pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); row.append(pass); }
      }
    } else {
      const input = h('input.field', {
        type: 'text', maxlength: '16', placeholder: 'Your name', 'aria-label': `Name for farmer ${s.pid.slice(1)}`, autocomplete: 'nickname',
      });
      input.addEventListener('input', () => { face.querySelector('.ltr').textContent = initialOf(input.value); });
      const pass = needPass ? h('input.field.pass', { type: 'password', placeholder: 'Farm passphrase', 'aria-label': 'Farm passphrase', autocomplete: 'current-password' }) : null;
      const play = h('button.btn', { type: 'button' }, 'Play');
      const go = () => {
        const name = input.value.trim();
        // say it: an Enter on an empty name used to do nothing at all (UI-34)
        if (!name) { $('slot-error').textContent = 'Type a name first.'; input.focus(); return; }
        if (pass && !pass.value) { $('slot-error').textContent = 'Type the farm passphrase too.'; pass.focus(); return; }
        const clash = swatches.find((w) => w.color === String(color).toUpperCase() && w.takenBy);
        if (clash) { $('slot-error').textContent = `${clash.takenBy} has ${clash.name}. Pick another colour.`; return; }
        $('slot-error').textContent = '';
        onPick(s.pid, name, { color, pass: pass ? pass.value : undefined });
      };
      play.addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      input.addEventListener('input', () => { if ($('slot-error').textContent === 'Type a name first.') $('slot-error').textContent = ''; });
      const sw = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Colour' });
      const label = h('span.sw-name', swatchName(color));
      for (const w of swatches) {
        const c = w.color;
        // the partner's colour stays visible but taken: greyed, marked with their initial, and it says whose it is
        const b = h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(c === String(color).toUpperCase()),
          'aria-label': w.takenBy ? `${w.name}: ${w.takenBy} has it` : w.name, 'aria-disabled': w.takenBy ? 'true' : null,
          title: w.takenBy ? `${w.takenBy} has ${w.name}` : w.name, style: { '--sw': c }, dataset: { colour: w.name },
          on: { click: () => {
            if (w.takenBy) { $('slot-error').textContent = `${w.takenBy} has ${w.name}. Pick another colour.`; return; }
            $('slot-error').textContent = '';
            color = c;
            label.textContent = w.name;
            Object.entries(playerVars(c)).forEach(([k, v]) => face.style.setProperty(k, v));
            slotPortrait(face, s, c);
            for (const x of sw.querySelectorAll('.swatch')) x.setAttribute('aria-checked', String(x === b));
          } } }, w.takenBy ? h('span.taken-by', { 'aria-hidden': 'true' }, w.takenBy.slice(0, 1).toUpperCase()) : null);
        sw.append(b);
      }
      sw.append(label);
      row.append(input, play, sw);
      if (pass) row.append(pass);
    }
    list.append(row);
  }
  $('slot-picker').hidden = false;
  paintWhenLoaded($('slot-picker'));
  // a phone on its side with the keyboard up has ~200 px: the name field (not the logo) is what must show (mobile QA)
  const picker = $('slot-picker');
  if (!picker.dataset.keepField) {
    picker.dataset.keepField = '1';
    const keep = () => {
      const a = document.activeElement;
      if (a && a.matches?.('input') && picker.contains(a)) a.scrollIntoView({ block: 'center', inline: 'nearest' });
    };
    picker.addEventListener('focusin', () => setTimeout(keep, 350));
    globalThis.visualViewport?.addEventListener('resize', () => { if (!picker.hidden) keep(); });
  }
  setTimeout(() => list.querySelector('input:not([hidden]), button')?.focus({ preventScroll: true }), 50);
}
