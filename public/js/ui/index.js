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
//   ui.harness                              (additive, Harness Hollow 2026-10-13) ui/harness/index.js: the in-game helper
//                                           ({ enabled(), connect(), refresh(), receive(msg), open(tab), openReady(), ... }), or null
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
//   ui.panels.on('register' | 'open' | 'close' | 'badge' | 'tab', fn) -> unsubscribe   ('tab': (name, tabId))
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
import { ERR, SOFT, cleanName } from '../../../shared/net/protocol.js';
import { h, icon, svgIcon, focusables, fmt as fmtNum, fmtDuration, playerVars, ensureStylesheet, touchText, touchPlayer, tabCue } from './dom.js';
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
import { createIdeasUi } from './ideas.js';
import { createStarNudge } from './star-nudge.js';
import { createTracker } from './tracker.js';
import { createSeeds } from './seeds.js';
import { createLayout, LAYOUT_Q } from './layout.js';
import { createItemHints } from './item-hint.js';
import { createInviteUi } from './invite.js';
import { farmManifestHref } from './farm-gate.js';
import { langToggle } from './lang-toggle.js';
import { createKeepUi } from './keep.js';
import { createPrivacyUi } from './privacy.js';
import { bootHarness } from './harness/boot.js';
import { farm } from '../net/farm.js';
import { lazyImport, importFailed } from '../net/lazy.js';
import { t, tn, live, onLang, lang, fmtDuration as fmtDur, name as nameOf, N } from '../i18n/index.js';

export { h, icon, svgIcon, focusables, fmt, fmtShort, fmtDuration, plural, kv, playerVars, playerMark } from './dom.js';
export { langToggle } from './lang-toggle.js';

const $ = (id) => document.getElementById(id);

/** Friendly text per error code (never a red flash: GDD §7.2 "Invalid action"); the catalog keys are 'err.<CODE>'
 *  (i18n/en/core.js), so ERR_TEXT[code] reads the language in effect. QA2 UI-10 / RC-18: NOT_NEEDED (watering a crop
 *  too quick to need it) is a literal key: the rules lane adds the code to ERR. */
export const ERR_TEXT = live(Object.fromEntries([...Object.keys(ERR), 'NOT_NEEDED'].map((c) => [c, `err.${c}`])));

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
  return Object.hasOwn(ERR, code) ? t('err.fallback') : String(code);
}

// ---- panel registry (ui-shell owns the frame; ui-panels registers the content) ------------------------------
const panelEntries = new Map();      // name -> entry
const openStack = [];                // open panel names, bottom .. top
const panelEvents = { register: new Set(), open: new Set(), close: new Set(), badge: new Set(), tab: new Set() };
let S = null;                        // { store, view, controller } after ui.init
/** The panel close button's hover title: its key for a mouse, the word alone for a finger. */
const closeTitle = () => touchText(t('common.closeEsc'), touchPlayer(S?.controller));
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
  scrimEl.addEventListener('click', (ev) => {
    const top = openStack.at(-1);
    const e = top ? panelEntries.get(top) : null;
    // the second click of a double click on a dock door lands here, on the scrim of the panel the first one opened:
    // it is not a "close" (QA r1 S-29: Market, Barn and the Farm book closed ~150 ms after opening)
    if (ev.detail >= 2 || (e && performance.now() - (e.openedAt ?? 0) < 400)) return;
    if (e?.modal) registry.close(top);
  });
  return layerEl;
}

const SIZES = new Set(['side', 'wide', 'full', 'card']);

// spec.title / spec.tabs: a value, a getter (read here, so it follows the language) or a function of (args, state)
function titleOf(e, args) {
  const ti = e.spec.title;
  return typeof ti === 'function' ? String(ti(args || {}, S && S.store.state) ?? e.name) : String(ti ?? e.name);
}
function tabsOf(e, args) {
  const tb = e.spec.tabs;
  return (typeof tb === 'function' ? tb(args || {}, S && S.store.state) : tb) || [];
}

function buildFrame(e) {
  const { name, spec } = e;
  const titleId = `panel-${name}-title`;
  // the panel's name is its heading (an h2: the dialog is labelled by it, and a screen reader's heading list finds it)
  e.titleText = h('h2.hh-panel-title-text', { id: titleId });
  e.titleIcon = spec.icon ? icon(spec.icon, { size: 40, cls: 'hh-panel-title-icon' }) : null;
  e.closeBtn = h('button.btn.btn--stop.btn--round.hh-panel-close', {
    type: 'button', 'aria-label': t('common.close'), title: closeTitle(), on: { click: () => registry.close(name) },
  }, svgIcon('close', 26));
  // a strip that runs off the sheet shows a "‹" / "›" cue on that side; a tap on the cue scrolls (QA r4 S4-07)
  e.tabsEl = h('div.hh-tabs', { role: 'tablist', hidden: true, on: { scroll: () => tabCue(e.tabsEl), click: (ev) => {
    const s = e.tabsEl;
    const r = s.getBoundingClientRect();
    const dir = ev.clientX > r.right - 34 && s.classList.contains('more-r') ? 1 : ev.clientX < r.left + 34 && s.classList.contains('more-l') ? -1 : 0;
    if (ev.target === s && dir) s.scrollBy({ left: dir * s.clientWidth * 0.7, behavior: 'smooth' });
  } } });
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
  // a div, not a <header>: every panel's header counted as a second banner landmark (release 1.0, perf-a11y#13); the
  // h2-style title keeps its id for aria-labelledby
  h('div.hh-panel-title.wood', e.titleIcon, e.titleText), e.closeBtn, e.tabsEl, e.scroll, e.fade);
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
  // a text field that takes the focus stays above a phone's keyboard, with the button after it (release 1.0 M13a,
  // ux-phone#6: Harvey's wish and Ask sat under the keyboard); the farmer picker did this alone before
  e.frame.addEventListener('focusin', (ev) => {
    if (!isField(ev.target)) return;
    // a touch layout never opens a keyboard by itself: a field focused by code (not by the player's own tap) lets go
    if (touchLayout() && performance.now() - e.openedAt < 700 && !recentlyTapped(ev.target)) {
      queueMicrotask(() => { if (document.activeElement === ev.target) { ev.target.blur(); e.frame.focus({ preventScroll: true }); } });
      return;
    }
    // the scroller gets room under its last button while a field has the focus, so the button can clear the bottom
    // fade (QA r1 S-13: Notes' "Pin it here" sat under it); the room goes with the focus
    e.frame.classList.add('field-on');
    setTimeout(() => { if (document.activeElement === ev.target) keepInView(ev.target, e.frame); }, 350);
  });
  // the room stays while the focus moves to a control of the same panel (its own button): dropping it on the press's
  // mousedown shrank the scroller under the pointer and the mouseup missed the button (harvey's QA r1 cross-lane note)
  e.frame.addEventListener('focusout', (ev) => {
    if (isField(ev.target) && !isField(ev.relatedTarget) && !(ev.relatedTarget && e.frame.contains(ev.relatedTarget))) e.frame.classList.remove('field-on');
  });
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

// ---- fields above the keyboard (release 1.0 M13a) -----------------------------------------------------------------
const isField = (el) => Boolean(el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test(el.type || ''))));
const touchLayout = () => mqMatch(LAYOUT_Q.touch) || mqMatch('(pointer: coarse)');
// at: when the page handled it; ts: when the finger went down (the event's own time: a busy page handles a tap late)
let lastTap = { el: null, at: -Infinity, ts: -Infinity, x: NaN, y: NaN };
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (ev) => {
    lastTap = { el: ev.target, at: performance.now(), ts: Number.isFinite(ev.timeStamp) ? ev.timeStamp : performance.now(), x: ev.clientX, y: ev.clientY };
  }, { capture: true, passive: true });
}

// ---- a double tap is one tap (QA r2 S-05, br#1) -----------------------------------------------------------------
// On a phone the second tap of a double tap on the bar's Market door landed on the sheet the first one had just opened:
// "Sell 39", a whole stack gone, and a sale has no undo. The second tap on a sheet button that closes the sheet (the
// gift's "Wrap it") landed on the bar under it and opened the Barn. A click inside a panel whose finger went down within
// TAP_GUARD.ms of the tap that opened it, or outside every panel within TAP_GUARD.ms of the tap that opened or closed one
// (the door that opened a sheet that does not cover it would close it again), is dropped when it is the second click of a
// double click or lands within TAP_GUARD.px of that tap. The times are the taps' own (event time): a busy phone handled
// the twin a second after the sheet opened though the finger came down 160 ms after the first. A press elsewhere, a
// keyboard press, or one after the sheet has settled goes through (the e2e tools' quick presses on other controls too).
export const TAP_GUARD = Object.freeze({ ms: 400, px: 48 });
/**
 * Is `click` ({ x, y, detail }) the second half of a double tap? `since`: ms from the tap that opened the panel under it
 * (a click inside it), or opened or closed a panel (a click outside), to this click's own tap, both in event time; below
 * 0 when this finger went down before the panel opened (it aimed at something else); `first`: where the tap that opened
 * or closed it went down ({ x, y } or null when code opened it). Pure.
 */
export function tapThrough(click, since, first) {
  if (!click || !(click.detail >= 1) || !(since < TAP_GUARD.ms)) return false;
  if (click.detail >= 2) return true;
  return Boolean(first && Number.isFinite(first.x) && Math.hypot(click.x - first.x, click.y - first.y) <= TAP_GUARD.px);
}
/** Where and when (event time) the pointer last went down, when that is the press being handled (null otherwise). */
const recentTap = () => (performance.now() - lastTap.at < 2000 && Number.isFinite(lastTap.x) ? { x: lastTap.x, y: lastTap.y, ts: lastTap.ts } : null);
let lastShift = { ts: -Infinity, tap: null };      // the last panel that opened or closed, and the tap that did it
if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    const e = [...openStack].reverse().map((n) => panelEntries.get(n)).find((x) => x?.frame?.contains?.(target));
    const click = { x: ev.clientX, y: ev.clientY, detail: ev.detail };
    // this click's own tap: its pointerdown (event time), else the click's own time
    const ts = recentTap()?.ts ?? ev.timeStamp;
    const drop = e ? tapThrough(click, ts - (e.openTs ?? -Infinity), e.openTap) : tapThrough(click, ts - lastShift.ts, lastShift.tap);
    if (!drop) return;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);
}
const recentlyTapped = (el) => performance.now() - lastTap.at < 1200 && Boolean(lastTap.el && (lastTap.el === el || el.contains?.(lastTap.el) || lastTap.el.contains?.(el)));
/**
 * The button the player presses once `field` is filled: the one the field names (`data-keep-in-view="<data-act>"`:
 * Harvey's box names `ask`), else the first button after it that has words. An icon-only button beside the field
 * (Harvey's 🎙, a ✕) is not it: QA r1 S-13 (hv#5) kept the mic in view and left "Ask Harvey" under the keyboard.
 */
export function buttonAfter(field, root) {
  const shown = (b) => b && !b.hidden && !b.closest('[hidden]');
  const act = field?.dataset?.keepInView;
  // a field that is its own deed (an animal's name, saved as typed): only the field is kept in view (QA r3 S3-16, oib#4:
  // keep-in-view kept the animal's "Collect" after the field in view and left the field half under the sheet's edge)
  if (act === 'none') return null;
  const named = act ? root.querySelector(`[data-act="${String(act).replace(/["\\]/g, '')}"]`) : null;
  if (shown(named)) return named;
  const all = [...root.querySelectorAll('input, textarea, select, button')];
  const i = all.indexOf(field);
  if (i < 0) return null;
  const words = (b) => /\p{L}/u.test(b.textContent || '');
  // a suggestion chip after the field is not its button (QA r2 S-04, oib#2: renaming the farm kept "Малка ливада" in
  // view and "Carve it!" under the keyboard); the first worded button that is no chip, else the first chip
  const worded = all.slice(i + 1).filter((b) => b.tagName === 'BUTTON' && shown(b) && words(b));
  return worded.find((b) => !b.classList?.contains('chip')) ?? worded[0] ?? null;
}
/** The nearest ancestor that scrolls (a sheet's body, or the whole sheet on a landscape phone), or null. */
function scrollerOf(el) {
  if (typeof getComputedStyle !== 'function') return null;
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}
/** The room at the bottom of a panel a button must clear: the denser half of the "more below" fade (34 px). */
const FADE_ROOM = 22;
/**
 * Scroll a focused field and its button into the part of its panel the keyboard leaves (the frame's scroller): the
 * button above the bottom fade and above the visual viewport's bottom (a keyboard over the page) first, then as much of
 * the field as still fits above it (QA r1 S-13: in an iPhone's landscape with the keyboard up there is room for the
 * button and part of the field, and scrolling the whole field back in pushed the button under the keyboard again).
 */
export function keepInView(field, root) {
  if (!field?.isConnected) return;
  const btn = root ? buttonAfter(field, root) : null;
  const target = btn ?? field;
  target.scrollIntoView?.({ block: 'end', inline: 'nearest' });
  const sc = scrollerOf(target) ?? target.closest?.('.hh-panel-scroll');
  if (!btn || !sc || typeof target.getBoundingClientRect !== 'function') {
    field.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const box = sc.getBoundingClientRect();
  const vv = globalThis.visualViewport;
  const fade = root?.querySelector?.('.scroll-fade');
  const fading = Boolean(fade && (typeof getComputedStyle !== 'function' || getComputedStyle(fade).display !== 'none'));
  // a sticky foot over the scroller's bottom (not the button's own) covers what scrolls under it: the floor is its top
  // (QA r2 F2-01, features' patch: any sheet with a sticky action bar has the gift sheet's old trap)
  const foot = typeof getComputedStyle === 'function'
    ? [...(sc.querySelectorAll?.('*') ?? [])].find((el) => !el.contains(btn) && getComputedStyle(el).position === 'sticky'
      && el.getBoundingClientRect().bottom >= box.bottom - 1)
    : null;
  const floor = Math.min(box.bottom - (fading ? FADE_ROOM : 0), vv ? vv.offsetTop + vv.height - 8 : Infinity,
    foot ? foot.getBoundingClientRect().top : Infinity);
  const under = btn.getBoundingClientRect().bottom - floor;
  if (under > 0) sc.scrollTop += Math.ceil(under);
  // the field's top back in view (under the sheet's title, which can sit over a scrolling sheet), as far as the button
  // allows
  const over = (el) => { const r = el?.getClientRects?.().length ? el.getBoundingClientRect() : null; return r && r.bottom > box.top && r.top < box.bottom ? r.bottom : -Infinity; };
  const roof = Math.max(box.top, over(root?.querySelector?.('.hh-panel-title')), over(root?.querySelector?.('.hh-tabs')));
  const hidden = roof - field.getBoundingClientRect().top;
  const slack = floor - btn.getBoundingClientRect().bottom;
  if (hidden > 0 && slack > 0) sc.scrollTop -= Math.floor(Math.min(hidden, slack));
}
// the keyboard coming up (Android resizes the visual viewport) or a rotation: the focused field of a panel goes back
// into view
if (typeof globalThis.visualViewport?.addEventListener === 'function') {
  globalThis.visualViewport.addEventListener('resize', () => {
    const a = document.activeElement;
    const frame = a?.closest?.('.hh-panel');
    if (isField(a) && frame) keepInView(a, frame);
  });
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
    // 34 px clear of the cue's edge
    if (b && b.offsetLeft + b.offsetWidth > s.scrollLeft + s.clientWidth - 34) s.scrollLeft = b.offsetLeft + b.offsetWidth - s.clientWidth + 34;
    else if (b && b.offsetLeft < s.scrollLeft + 34) s.scrollLeft = Math.max(0, b.offsetLeft - 34);
    tabCue(s);
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
  emitPanel('tab', e.name, id);
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
    e.body.replaceChildren(h('p.empty-note', t('shell.panel.broken')));
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

/**
 * Where the focus goes back when a panel closes (QA r2 S-14, ap#1): its opener, or when the opener sits in a container
 * that has closed since (the Together menu's "Leave a surprise", the phone's Farm book), the visible control that opens
 * that container (`[aria-controls="<its id>"]`: the Together button, the Farm book button). The focus fell to <body>.
 */
export function focusBackTo(opener, root = globalThis.document) {
  if (!opener || !opener.isConnected) return null;
  const shown = (el) => Boolean(el && !el.closest('[hidden]') && (typeof el.getClientRects !== 'function' || el.getClientRects().length));
  if (shown(opener)) return opener;
  for (let box = opener.closest('[hidden]') ?? opener.parentElement; box && box !== root?.body; box = box.parentElement?.closest?.('[hidden]') ?? box.parentElement) {
    if (!box.id) continue;
    const door = root?.querySelector?.(`[aria-controls="${box.id}"]`);
    if (shown(door)) return door;
  }
  const book = root?.getElementById?.('m-menu-btn');
  return shown(book) ? book : opener;
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
      // a door opens a panel on its first tab; only a deep link ({ tab }) picks another (QA r3 S3-15, oib#1: after one
      // visit to the Acorn shop every Market door opened there, with Sell scrolled off the phone's tab strip)
      e.tab = e.args.tab ?? null;
      renderTabs(e);
      mountPanel(e);
      e.frame.classList.remove('is-closing');
      e.frame.hidden = false;
      // a door opens a sheet at its top: the frame (one per panel name) kept the last visit's scroll, so the Bakery opened
      // scrolled by the Packing Table's offset (QA r4, ui-panels' note); set once shown (a hidden box has no scroll to
      // set); a focus or deep link scrolls after this (rAF)
      e.scroll.scrollTop = 0;
      e.frame.classList.remove('is-opening');
      void e.frame.offsetWidth;          // restart the open animation
      e.frame.classList.add('is-opening');
      // the entrance plays once: a rotation swaps the sheet's animation (up / from the side) and replayed it with the
      // class still on (QA r1 S-37); off when it ends, or after 600 ms (reduced motion has no animation to end)
      const gen = (e.openGen = (e.openGen ?? 0) + 1);
      const settle = (ev) => {
        if (ev && ev.target !== e.frame) return;
        e.frame.removeEventListener('animationend', settle);
        if (e.openGen === gen) e.frame.classList.remove('is-opening');
      };
      e.frame.addEventListener('animationend', settle);
      setTimeout(settle, 600);
    }
    openStack.push(name);
    syncStacking();
    e.openedAt = performance.now();
    e.openTap = recentTap();              // the tap that opened it: its twin a moment later is not a press (S-05)
    e.openTs = e.openTap?.ts ?? e.openedAt;
    lastShift = { ts: e.openTs, tap: e.openTap };
    e.frame.focus({ preventScroll: true });
    emitPanel('open', name, e.args);
    return true;
  },

  close(name, { instant = false, keepFocus = false } = {}) {
    const e = panelEntries.get(name);
    if (!e || !e.open) return false;
    e.open = false;
    const closer = recentTap();            // the bar under it does not take the twin of the tap that closed it (S-05)
    lastShift = { ts: closer?.ts ?? performance.now(), tap: closer };
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
      const target = below ? panelEntries.get(below).frame : focusBackTo(e.opener);
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
    if (hit) {
      const why = p.spec.locked && S && S.store.state ? p.spec.locked(S.store.state) : null;
      e.preventDefault();
      e.stopPropagation();
      // a locked panel's key says when it opens ("Mabel opens her board at level 2"), never nothing (QA r1 P-08)
      if (why) { ui.toast(why, { kind: 'info' }); return; }
      registry.toggle(p.name);
      return;
    }
  }
}

// ---- the partner came, the partner left (QA r2 S-02, jde#1, coop#8) --------------------------------------------------
// Every welcome said the partner "arrived on the farm 🌻" to the one who had just arrived (the welcome's first look at
// the presence counted as a change), and a server restart said "left for now" then "arrived" though nobody left. Now
// the first sight of a farmer is silent, "left" waits PEER_NEWS.leftMs offline (a reload, a restart, a phone waking
// up come back sooner and say nothing), and "arrived" follows only a "left" that was said or a farmer first seen away.
export const PEER_NEWS = Object.freeze({ leftMs: 10_000 });
/**
 * The presence news of one page: (pid, online, { live }) for every presence it learns (a welcome's list, or a MSG.PEER:
 * `live`); it calls say(pid, true | false) for an arrival or a departure worth telling. Timers are injectable (tests).
 * QA r3 S3-10 (jde#2): a brand-new partner is in no welcome, so their first MSG.PEER is the page's first sight of them;
 * S2-02 made every first sight silent, and the partner's first join was told to nobody. A first sight from a live
 * message, online, is an arrival; the welcome's list stays silent.
 */
export function peerNews(say, { leftMs = PEER_NEWS.leftMs, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const seen = new Map();          // pid -> { shown: the presence the player was told (or first saw), t: the "left" timer }
  return (pid, online, { live = false } = {}) => {
    const s = seen.get(pid);
    if (!s) {
      seen.set(pid, { shown: Boolean(online), t: 0 });
      if (online && live) say(pid, true);
      return;
    }
    if (online) {
      if (s.t) { clearTimer(s.t); s.t = 0; return; }       // back inside the grace: nothing happened
      if (!s.shown) { s.shown = true; say(pid, true); }
      return;
    }
    if (!s.shown || s.t) return;
    s.t = setTimer(() => { s.t = 0; s.shown = false; say(pid, false); }, leftMs);
  };
}
let peerUpdate = null;
// a welcome's presence list reaches ui.setPeer in the same task as the welcome (main.js: store.reset, then one setPeer
// per peer): those calls are the welcome's, everything later is a live MSG.PEER (S3-10). main.js can also say so
// itself (setPeer(pid, on, { welcome: true })).
let inWelcome = false;
function markWelcome() {
  inWelcome = true;
  queueMicrotask(() => { inWelcome = false; });
}
function peerNewsOf() {
  peerUpdate ??= peerNews((pid, on) => {
    const p = S?.store.state?.players?.[pid];
    if (!p || !mods) return;
    mods.feed.push({ by: pid, actor: p.name, text: on ? t('shell.peer.arrivedFeed') : t('shell.peer.leftFeed'), glyph: on ? 'heart' : null });
    if (on) mods.toasts.toast(t('shell.peer.arrived', { name: p.name }), { kind: 'love', ms: 3500 });
    // the news as an event (window 'hh:peer' { pid, online }): life-feel's arrival chime follows the same word
    try { globalThis.dispatchEvent?.(new CustomEvent('hh:peer', { detail: { pid, online: on } })); } catch { /* no window */ }
  });
  return peerUpdate;
}

// ---- the facade ------------------------------------------------------------------------------------------------
let mods = null;          // { hud, tips, toolbar, toasts, dialogs, levelup, settings, social, feed, recap, naming, tutorial, tracker }
const pendingPeers = new Map();
let pendingConn = null;

async function installPanels() {
  // ui-panels' module registers every content panel through ui.panels.register (see the header). Loaded
  // dynamically so the shell works before (and without) it; its stylesheet comes with it.
  try {
    const mod = await lazyImport('panels', () => import('./panels/index.js'));
    ensureStylesheet('/css/panels.css');
    const install = mod.default || mod.install;
    if (typeof install === 'function') await install(ui, { store: S && S.store });
  } catch (err) {
    // a failed fetch is reported by lazyImport (main.js reloads or offers Reload); anything else is a bug
    if (!importFailed(err)) console.error('ui panels failed to install', err);
  }
}

export const ui = {
  init(store, view, controller) {
    S = { store, view, controller, ui };
    // the first welcome's presence list follows in this same task (main.js: init, then setPeer per peer): silent (S3-10)
    markWelcome();
    store.on('welcome', markWelcome);
    $('hud').hidden = false;
    // the painted boot screen stays as a curtain over the HUD until the first view is drawn (release 1.0 S8)
    liftCurtain(view);
    const ctx = S;
    ctx.panelSpec = (name) => panelEntries.get(name)?.spec ?? null;
    ctx.settings = createSettings(ctx);
    ui.settings = ctx.settings;
    const toasts = createToasts(ctx, errText);
    ctx.toasts = toasts;
    const dialogs = createDialogs(ctx);
    // multi-farm mode only (null otherwise): the invite card, the personal link, the nudge (before the HUD: its menu
    // and Settings link to it)
    ctx.invite = createInviteUi(ctx);
    // multi-farm mode only (null otherwise): "Keep your farm safe", the Farmers' new keys (ui/keep.js)
    ctx.keep = createKeepUi(ctx);
    // "Suggest an idea" (every mode; a self-hosted farm's entry opens GitHub) and the GitHub star card (multi only)
    ctx.ideas = createIdeasUi(ctx);
    // Settings > Farm's Privacy section (every mode) and "Delete this farm now" (multi only): ui/privacy.js
    ctx.privacy = createPrivacyUi(ctx);
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
    // Harness Hollow: the in-game helper (ui/harness/index.js): loaded only when the farm's server offers it
    // (ui/harness/boot.js asks after the welcome), so the game without the helper carries none of its code. Its button
    // then tops the right edge column. A failure there never takes the game down with it
    ctx.harness = null;
    ui.harness = null;
    try { bootHarness(ctx, (helper) => { ctx.harness = helper; ui.harness = helper; }); } catch (err) { console.error('the helper did not start', err); }
    const levelup = createLevelup(ctx);
    const tracker = createTracker(ctx);
    const naming = createNaming(ctx);
    const recap = createRecap(ctx);
    ctx.starNudge = createStarNudge(ctx);
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
    // a language switch mid-game (Settings, i18n/core.js setLang): every open panel re-mounts in the new language and
    // the shell redraws what a welcome redraws; modules that built text once re-label themselves on onLang
    onLang(() => relocalize());
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
  hideSlots() {
    const sp = $('slot-picker');
    const wasShown = Boolean(sp && !sp.hidden);
    if (sp) sp.hidden = true;
    // a new farmer's Play (the join path): the painting comes back over the farm until its first view is drawn, and the
    // curtain lifts the way every boot's does (QA r3 S3-14, jde#8: 300 ms after Play the farmhouse, barn and market were
    // tan boxes, on a quiet machine too). Only before the shell is up: ui.init lifts the curtain on the first welcome
    if (wasShown && !mods) curtainForJoin();
  },
  slotError(code) {
    // on the slot picker a RATE refusal means the passphrase lockout (server: 5 wrong ones, one minute)
    $('slot-error').textContent = code === ERR.RATE ? t('shell.slot.lockout') : errText(code);
  },

  setPending(p) { if (mods) mods.hud.setPending(p); },
  setConnection(status) {
    if (mods) { mods.hud.setConnection(status); return; }
    pendingConn = status;
    bootLine(status);
  },
  setPeer(pid, isOnline, { welcome = inWelcome } = {}) {
    if (!mods) { pendingPeers.set(pid, isOnline); return; }
    mods.hud.setPeer(pid, isOnline);
    mods.social?.peer?.();
    if (S.store.state && pid !== S.store.pid) peerNewsOf()(pid, isOnline, { live: !welcome });
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
  /** (additive, release 1.0 S1) The Farm book: ui.farmBook.open(section?) ('week' | 'animals' | 'village' | 'you' |
   *  'together' | 'settings'), the drip's "Show me" ('farmbook'). */
  farmBook: {
    open(section) { return registry.open('menu', section ? { section } : {}); },
    close() { return registry.close('menu'); },
  },
  /** (additive, release 1.0 S2) B: the build tray, like the Build button (the Hammer in hand: back to the Hand). */
  openBuild() {
    if (!mods) return;
    if (ui.panels.has('build')) { ui.panels.toggle('build'); return; }
    if (S.controller.tool.id === 'hammer' && !mods.toolbar.buildOpen) { S.controller.setTool('hand'); return; }
    mods.toolbar.openBuild();
  },
  /**
   * (additive, QA r2 S2-01) The build tray open at a free piece's card: a level card's "Show me" for Grandma's Windmill
   * (it waits there as "Free · Place", the way the Coop does). False when the tray has no such card.
   */
  showInTray(def) {
    if (!mods) return false;
    mods.toolbar.openBuild(true);
    const card = document.querySelector(`#build-tray .build-card[data-def="${String(def).replace(/["\\]/g, '')}"]`);
    card?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    card?.focus?.({ preventScroll: true });
    return Boolean(card);
  },
  /** Photo mode (P): hide every HUD element; P or Esc brings it back. */
  photoMode(on) {
    ui.hideHud(on);
    if (on && mods) mods.toasts.toast(t('shell.photo.mode'), { kind: 'info', ms: 2000 });
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
    const el = h('div.photo-sheet#photo-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('shell.photo.label') },
      h('img.photo-sheet-img', { src: url, alt: t('shell.photo.alt') }),
      h('p.photo-sheet-msg', t('shell.photo.save')),
      h('button.btn.btn--sky.photo-sheet-done', { type: 'button', on: { click: close } }, t('common.done')));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.append(el);
    el.querySelector('button')?.focus({ preventScroll: true });
    return el;
  },
  /** The farm-naming card (Settings > Farm > Rename; the tutorial opens it by itself). */
  nameFarm() { if (mods) mods.naming.open(); },
  /** Forget this tab's farmer and show the slot picker again (two tabs can be both partners). */
  switchFarmer() {
    try { sessionStorage.removeItem(farm.key('hh.slot')); } catch { /* private mode */ }
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

/** Re-draw the shell and the open panels in the language just chosen (see ui.init). */
function relocalize() {
  if (!mods) return;
  for (const e of panelEntries.values()) {
    if (e.closeBtn) { e.closeBtn.setAttribute('aria-label', t('common.close')); e.closeBtn.title = closeTitle(); }
  }
  for (const name of [...openStack]) {
    const e = panelEntries.get(name);
    if (!e || e.legacy || !e.open) continue;
    try { renderTabs(e); mountPanel(e); } catch (err) { console.error(`panel '${name}' did not re-draw in the new language`, err); }
  }
  const st = S.store.state;
  if (!st) return;
  for (const [what, fn] of [['hud', () => mods.hud.refresh()], ['toolbar', () => mods.toolbar.render()], ['feed', () => mods.feed.render()],
    ['tracker', () => mods.tracker.render()], ['tutorial', () => mods.tutorial.render()]]) {
    try { fn(); } catch (err) { console.error(`${what} did not re-draw in the new language`, err); }
  }
  mods.tips.tooltip(null, { force: true });
}

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
      const coins = w ? w.coins : 0;
      mods.toasts.banner({
        id: `wish-ask-${ev.id}`, kind: 'wish', ribbon: t('shell.wish.ribbon'),
        // functions: a language switch while the card is up says it again (the time left as it is then)
        message: () => {
          const left = fmtDur(Math.max(0, (ev.until ?? 0) - S.store.now()), { cut: 'ms<10' });
          return w ? tn('shell.wish.ask', coins, { name: other.name, thing: N(w.def), left }) : tn('shell.wish.askAny', coins, { name: other.name, left });
        },
        things: w ? [{ icon: w.def, name: () => nameOf(w.def) }] : [],
        actions: [
          { label: t('shell.wish.yes'), kind: 'go', fn: () => S.controller.do('wishAnswer', { id: ev.id, ok: true }) },
          { label: t('shell.wish.keep'), kind: 'paper', fn: () => S.controller.do('wishAnswer', { id: ev.id, ok: false }) },
        ],
        ttl: 60_000,
      });
      return;
    }
    case 'wishWithdrawn': case 'wishDenied':
      mods.toasts.closeBanner(`wish-ask-${ev.id}`);
      return;
    case 'hearts': {
      const line = heartsLine(st, S.store.pid, ev);
      if (line) mods.toasts.toast(line, { kind: 'love', ms: 2200 });
      return;
    }
    case 'highFiveWait':
      // a phone has no T key: the hint in brackets goes for a finger (QA r1 S-16)
      if (other) mods.toasts.toast(touchText(t('shell.highFiveWait', { name: other.name }), touchPlayer(S.controller)), { kind: 'love', ms: 3000 });
      return;
    default:
  }
}

/**
 * The "+2 ♥" toast of my own hearts, or null. Hearts stay quiet for a farmer with nobody to share them (M30; QA r2
 * S-20, fbp#11: a solo farmer finished the daily together task alone and was told "+2 ♥"). With two of you, "someone"
 * is always the partner: say who (QA wave 1 CL-04). Pure.
 */
export function heartsLine(state, me, ev) {
  if (!ev || ev.pid !== me || !(ev.n > 0)) return null;
  const partner = Object.keys(state?.players ?? {}).find((p) => p !== me);
  if (!partner) return null;
  const them = state.players[partner]?.name ?? t('common.partner');
  const why = ['thanks', 'team', 'tend', 'highFive', 'keepsake'].includes(ev.why) ? t(`shell.hearts.${ev.why}`, { name: them }) : '';
  return `+${ev.n} ♥${why ? `  ${why}` : ''}`;
}

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
let bootStatus = 'connecting';
function hideBoot() { clearTimeout(bootTimer); const b = $('boot'); if (b) { b.hidden = true; b.classList.remove('lifting', 'no-fade'); } }
/** The painting back over the farm after the slot card's Play, saying the farm is opening (S3-14). */
function curtainForJoin() {
  const b = $('boot');
  if (!b || !b.hidden) return;
  b.classList.remove('lifting');
  delete b.dataset.lift;
  // at full opacity at once: the layer's fade-in from 0 showed a flat frame (QA r4 S4-01)
  b.classList.add('no-fade');
  b.hidden = false;
  const text = $('boot-text');
  if (text) text.textContent = t('shell.boot.open');
  $('boot-line')?.classList.remove('no-pct');
  lineAt(0.6);
}

// ---- the boot curtain (release 1.0 S8; feel#3, #4, astra#1, critique#6) --------------------------------------------
// The painting stays over the HUD (z 85) after the welcome until render-look's view.ready() (the first view's models
// loaded and drawn), capped at 6 s counted from the welcome, or at 25 s while the link brings less than 200 KB/s (the
// owners' Funnel: grey boxes for tens of seconds otherwise). Then a 500 ms cross-fade, and the HUD comes in once its
// icons and portraits are there. window.__hh.playableAt (performance.now()) marks the lift for infra's boot-perf.
export const CURTAIN = Object.freeze({ capMs: 6000, slowCapMs: 25_000, slowBps: 200_000, windowMs: 2000, fadeMs: 500 });
const bootBytes = [];                 // [responseEnd, bytes] of every resource the page loaded
if (typeof PerformanceObserver === 'function') {
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) bootBytes.push([e.responseEnd, e.transferSize || e.encodedBodySize || 0]); })
      .observe({ type: 'resource', buffered: true });
  } catch { /* an old browser: the cap is always the short one */ }
}
/**
 * Bytes a second the link brings now (entries: [responseEnd, bytes]): the better of the last `windowMs` and the whole
 * time since navigation. A resource counts only when it ends, so while big model packs stream (option 2's host path
 * at 550 KB/s, infra's e2e-assets run) no response ends inside 2 s and the window alone read a dead link: the 25 s cap
 * kept the curtain up to 19-21 s. The Funnel at 85 KB/s still reads slow both ways. Pure.
 */
export function throughput(entries, now, windowMs = CURTAIN.windowMs) {
  let recent = 0;
  let all = 0;
  for (const [t, b] of entries) {
    if (t > now) continue;
    all += b;
    if (t > now - windowMs) recent += b;
  }
  return Math.max(recent / (windowMs / 1000), now > 0 ? all / (now / 1000) : 0);
}
/** How long the curtain may wait (ms from the welcome) at this throughput. Pure. */
export const curtainCap = (bps) => (bps < CURTAIN.slowBps ? CURTAIN.slowCapMs : CURTAIN.capMs);

/**
 * Should the curtain lift now (QA r1 S-24, va#3)? `el` ms since the welcome, `bps` the link, `p` / `p0` the first
 * view's placeholders now and at the welcome (null: the view cannot tell), `dock` the HUD's doors are wired.
 * 'cap': past 25 s, whatever is on screen; on a quick link past 6 s only with no placeholder in view (the 6 s cap
 * used to lift onto 14-24 tan boxes at 700 KB/s). 'home': a slow link past 6 s once the doors answer and most of the
 * first view is drawn (the placeholder settle hides the rest; at 85 KB/s the 25 s cap kept a playable farm covered
 * for 9.5 s). null: wait. Pure.
 */
export function liftReason({ el, bps, p = null, p0 = null, dock = true, home = null }) {
  if (el >= CURTAIN.slowCapMs) return 'cap';
  if (el < CURTAIN.capMs) return null;
  if (bps >= CURTAIN.slowBps) return p === null || p === 0 ? 'cap' : null;
  if (!dock) return null;
  // QA r2 I2-C1: the farmhouse and the barn in view decide (`home`: how many of them are still tan; the owners' save
  // kept 24 of 82 boxes for 50 s, so the share below never fired and the 25 s cap lifted onto them); with neither in
  // view, most of the first view drawn
  if (home !== null) return home === 0 ? 'home' : null;
  return p !== null && p <= Math.max(2, Math.floor((p0 ?? 0) * 0.25)) ? 'home' : null;
}

/**
 * The boot line's share after the welcome (0.6..0.96): the files before it are the first 60 % (index.html), the first
 * view's models the rest, with a slow creep so the line never stands still for long (it parked at "99 %" for 11 s at
 * 700 KB/s). Pure.
 */
export function bootShare({ el, p = null, p0 = null }) {
  const models = p !== null && p0 ? Math.max(0, Math.min(1, 1 - p / p0)) : 0;
  const creep = Math.min(0.9, el / 30_000);
  return Math.min(0.96, 0.6 + 0.4 * Math.max(models, creep));
}
/** The boot line's percentage and bar at `share` (0..1). */
function lineAt(share) {
  const pct = $('boot-pct');
  const bar = $('boot-prog');
  if (pct) pct.textContent = ` ${Math.round(share * 100)}${lang() === 'bg' ? ' %' : '%'}`;
  if (bar) bar.style.width = `${(share * 100).toFixed(1)}%`;
}
/** The HUD's own pictures (icons, portraits) loaded, or 1.5 s gone: the HUD never comes in as empty circles. */
function hudPictures() {
  const imgs = [...document.querySelectorAll('#hud img')].filter((i) => !i.complete);
  if (!imgs.length) return Promise.resolve();
  const each = imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
  return Promise.race([Promise.all(each), new Promise((r) => setTimeout(r, 1500))]);
}
function liftCurtain(view) {
  const b = $('boot');
  const mark = (t) => { globalThis.__hh = globalThis.__hh || {}; globalThis.__hh.playableAt = t; };
  if (!b || b.hidden) { mark(performance.now()); return; }
  globalThis.__hhBootTaken = true;                 // the inline progress line stops; this says the farm is coming
  clearTimeout(bootTimer);
  bootStatus = 'open';
  const text = $('boot-text');
  if (text) text.textContent = t('shell.boot.open');
  $('boot-line')?.classList.remove('no-pct');
  document.body.classList.add('hud-wait');
  const t0 = performance.now();
  let done = false;
  const go = (reason) => {
    if (done) return;
    done = true;
    b.dataset.lift = reason;
    hudPictures().then(() => {
      // a frame drawn with the last models in before the fade (S4-01: tan boxes in the first frames after the lift)
      try { view?.invalidate?.(); } catch { /* no view */ }
      return new Promise((r) => { globalThis.requestAnimationFrame?.(() => requestAnimationFrame(r)); setTimeout(r, 150); });
    }).then(() => {
      document.body.classList.remove('hud-wait');
      document.body.classList.add('hud-in');
      // the line runs full while the painting fades (QA r2 S-22: the curtain lifted with "69 %" on it)
      lineAt(1);
      b.classList.add('lifting');
      mark(performance.now());
      setTimeout(() => { if (b.classList.contains('lifting')) hideBoot(); }, CURTAIN.fadeMs + 20);
      setTimeout(() => document.body.classList.remove('hud-in'), CURTAIN.fadeMs + 900);
    });
  };
  try {
    Promise.resolve(view?.ready?.({ timeoutMs: CURTAIN.slowCapMs })).then(() => go('ready'), () => go('ready'));
  } catch { go('ready'); }
  // the first view's placeholders (render-look's view.stats().placeholders) drive the last 40 % of the line and the lift;
  // `home`: the farmhouse and the barn in view still tan (null: neither in view; QA r2 I2-C1)
  const viewStat = (k) => { try { const n = view?.stats?.()[k]; return Number.isFinite(n) ? n : null; } catch { return null; } };
  const placeholders = () => viewStat('placeholders');
  const p0 = placeholders();
  // the line picks up where the inline one stopped (it creeps while the welcome is on its way), never a step back
  const pct = $('boot-pct');
  let shown = Math.max(0, Math.min(0.6, (parseFloat(pct?.textContent ?? '') || 0) / 100));
  const tick = () => {
    if (done) return;
    const el = performance.now() - t0;
    const p = placeholders();
    const share = Math.max(shown, bootShare({ el, p, p0 }));
    if (share > shown) { shown = share; lineAt(share); }
    const why = liftReason({ el, bps: throughput(bootBytes, performance.now()), p, p0, home: viewStat('home'),
      dock: registry.has('market') && Boolean($('dock')?.children.length) });
    if (why) { go(why); return; }
    setTimeout(tick, 250);
  };
  tick();
}
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
    bootStatus = 'mismatch';
    text.textContent = t('shell.boot.mismatch');
    line.append(h('button.btn.btn--sun.btn--small.reload', { type: 'button', on: { click: () => location.reload() } }, t('common.reload')));
    return;
  }
  if (b.hidden) return;
  bootStatus = status;
  if (status === 'open') { text.textContent = t('shell.boot.open'); line.classList.remove('no-pct'); return; }
  text.textContent = status === 'reconnecting' ? t('shell.boot.retry') : t('shell.boot.waking');
  armAsleep();
}
/**
 * 15 s without a welcome: the line says the farm is not answering, and the percentage goes (it read "99 %" beside
 * "the server seems to be asleep" for 45 s; QA r1 S-38). Armed when the page starts too: a socket whose upgrade hangs
 * reports no status at all.
 */
function armAsleep() {
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    const b = $('boot');
    if (!b || b.hidden || bootStatus === 'open' || bootStatus === 'mismatch') return;
    bootStatus = 'asleep';
    globalThis.__hhBootTaken = true;              // the inline progress line stops
    const text = $('boot-text');
    if (text) text.textContent = t('shell.boot.asleep');
    $('boot-line')?.classList.add('no-pct');
  }, 15_000);
}
if (typeof document !== 'undefined' && document.getElementById?.('boot') && !document.getElementById('boot').hidden) armAsleep();

// the loading screen's line follows a language switch made on the loading screen itself (index.html's toggle)
if (typeof document !== 'undefined') {
  onLang((l) => {
    // the home-screen app's description in the language. A farm's own manifest (multi mode, ui/farm-gate.js) keeps its
    // start: iOS's data: copy carries the farmer's key and stays as it is, Android's keyless /f/<id>/manifest.webmanifest
    // asks for the language
    const mf = document.querySelector?.('link[rel="manifest"]');
    const href = String(mf?.getAttribute('href') ?? '');
    if (!mf || href.startsWith('data:')) return;
    if (href.startsWith('/f/')) mf.setAttribute('href', farmManifestHref(href, l));
    else mf.setAttribute('href', l === 'bg' ? '/manifest.bg.webmanifest' : '/manifest.webmanifest');
  });
  onLang(() => {
    const b = $('boot');
    if (!b || b.hidden) return;
    const text = $('boot-text');
    b.querySelector('.reload')?.replaceChildren(t('common.reload'));
    if (text) text.textContent = t(bootStatus === 'mismatch' ? 'shell.boot.mismatch' : bootStatus === 'open' ? 'shell.boot.open' : bootStatus === 'reconnecting' ? 'shell.boot.retry'
      : bootStatus === 'asleep' ? 'shell.boot.asleep' : 'shell.boot.waking');
  });
}

// ---- slot picker (first screen: who is playing here; name + colour; passphrase; reclaim) -------------------
// the six colours with the names a person says (the picker used to read "Colour #2BB3A3"; QA wave 1 UI-31)
export const SWATCH_NAMES = live({ '#2BB3A3': 'shell.swatch.teal', '#FF7A6B': 'shell.swatch.coral', '#FFC83D': 'shell.swatch.sunflower',
  '#4AA8E8': 'shell.swatch.sky', '#9B6BD6': 'shell.swatch.plum', '#5DBB3F': 'shell.swatch.leaf' });
const SWATCHES = Object.keys(SWATCH_NAMES);
const swatchName = (c) => SWATCH_NAMES[String(c || '').toUpperCase()] ?? t('shell.swatch.this');

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

/** The picker's line in multi-farm mode: a new farm's creator, an invited friend, or a farmer coming back. Pure. */
export function multiSub(slots, { invited = false, creator = false, rejoin = false } = {}) {
  if (rejoin) return t('keep.rejoin.sub', { name: slots.find((s) => s.claimed)?.name ?? '' });
  const host = slots.find((s) => s.claimed && s.name)?.name;
  if (invited) return host ? t('shell.slot.invitedBy', { host }) : t('shell.slot.invited');
  if (creator && slots.every((s) => !s.claimed)) return t('shell.slot.newFarm');
  return t('shell.slot.who');
}

let lastSlots = null;
// a language switch while the picker is up (its own toggle, or the loading screen's a moment before) re-draws it
if (typeof document !== 'undefined') {
  onLang(() => { if (lastSlots && document.getElementById('slot-picker') && !$('slot-picker').hidden) showSlots(lastSlots.slots, lastSlots.onPick, lastSlots.opts); });
}
function showSlots(slots, onPick, opts = {}) {
  // the language toggle re-draws the card: what was typed stays
  const typed = new Map([...document.querySelectorAll('#slot-list .slot')].map((r) => [r.dataset.slot, r.querySelector('input:not(.pass)')?.value ?? '']));
  lastSlots = { slots, onPick, opts };
  const card = document.querySelector('#slot-picker .slot-paper');
  if (card && !card.querySelector('.lang-pick')) card.prepend(langToggle());
  const list = $('slot-list');
  list.replaceChildren();
  $('slot-error').textContent = '';
  // multi-farm mode (opts.multi): no passphrase and no "new computer" reclaim (the personal link replaces them)
  const needPass = !opts.multi && Boolean(opts.pass || slots.some((s) => s.pass));
  const anyFree = slots.some((s) => !s.claimed);
  // final release V-15: two identical rows read as "both names needed"; each farmer takes ONE row on their own screen
  const bothFree = slots.length > 1 && slots.every((s) => !s.claimed);
  $('slot-sub').textContent = opts.multi ? multiSub(slots, opts)
    : bothFree ? t('shell.slot.pickOne')
      : anyFree ? t('shell.slot.who') : t('shell.slot.welcomeBack');
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
    if (s.claimed && opts.multi && opts.rejoin) {
      // a new-key link: this device becomes that farmer; whoever opens it may give the farmer a new name (a language
      // switch re-draws the card: what was typed stays)
      const input = h('input.field', { type: 'text', maxlength: '16', value: typed.has(s.pid) ? typed.get(s.pid) : (s.name || ''),
        'aria-label': t('keep.rejoin.name'), autocomplete: 'nickname' });
      const go = () => {
        // the name as the server keeps it (QA r2 I2-02): zero-width spaces alone are no name
        const name = cleanName(input.value) || s.name;
        if (!name) { $('slot-error').textContent = t('shell.slot.needName'); input.focus(); return; }
        $('slot-error').textContent = '';
        onPick(s.pid, name, { color: s.color });
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      input.addEventListener('input', () => { face.querySelector('.ltr').textContent = initialOf(input.value); });
      row.append(input, h('button.btn', { type: 'button', dataset: { rejoin: s.pid }, on: { click: go } }, t('keep.rejoin.go')));
    } else if (s.claimed) {
      row.append(h('span.taken', s.name || s.pid, h('small', s.online ? t('shell.slot.playing') : t('shell.slot.away'))));
      if (s.mine) {
        row.append(h('button.btn.btn--small', { type: 'button', on: { click: () => onPick(s.pid, null) } }, t('shell.slot.continue')));
      } else if (opts.multi) {
        // a farmer of this farm on a new device opens their personal link (Settings > Farm on their old one)
        row.append(h('small.slot-hint', t('shell.slot.newDevice')));
      } else if (!s.online || needPass) {
        // a lost token: "this is me on a new device" (needs the passphrase when the server has one)
        const pass = needPass ? h('input.field.pass', { type: 'password', placeholder: t('shell.slot.pass'), 'aria-label': t('shell.slot.pass'), autocomplete: 'current-password' }) : null;
        const go = () => onPick(s.pid, s.name, { reclaim: true, pass: pass ? pass.value : undefined, color: s.color });
        row.append(h('button.reclaim', { type: 'button', on: { click: () => { if (pass && !pass.value) { pass.hidden = false; pass.focus(); return; } go(); } } }, t('shell.slot.reclaim')));
        if (pass) { pass.hidden = true; pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); row.append(pass); }
      }
    } else {
      const input = h('input.field', {
        type: 'text', maxlength: '16', placeholder: t('shell.slot.name'), 'aria-label': t('shell.slot.nameFor', { n: s.pid.slice(1) }), autocomplete: 'nickname',
      });
      if (typed.get(s.pid)) { input.value = typed.get(s.pid); face.querySelector('.ltr').textContent = initialOf(input.value); }
      input.addEventListener('input', () => { face.querySelector('.ltr').textContent = initialOf(input.value); });
      const pass = needPass ? h('input.field.pass', { type: 'password', placeholder: t('shell.slot.pass'), 'aria-label': t('shell.slot.pass'), autocomplete: 'current-password' }) : null;
      const play = h('button.btn', { type: 'button' }, t('shell.slot.play'));
      const go = () => {
        const name = cleanName(input.value);
        // say it: an Enter on an empty name used to do nothing at all (UI-34); one of zero-width spaces is empty too
        // (QA r2 I2-02: the server refuses it)
        if (!name) { $('slot-error').textContent = t('shell.slot.needName'); input.focus(); return; }
        if (pass && !pass.value) { $('slot-error').textContent = t('shell.slot.needPass'); pass.focus(); return; }
        const clash = swatches.find((w) => w.color === String(color).toUpperCase() && w.takenBy);
        if (clash) { $('slot-error').textContent = t('shell.slot.colourTaken', { name: clash.takenBy, colour: clash.name }); return; }
        $('slot-error').textContent = '';
        onPick(s.pid, name, { color, pass: pass ? pass.value : undefined });
      };
      play.addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      input.addEventListener('input', () => { if ($('slot-error').textContent === t('shell.slot.needName')) $('slot-error').textContent = ''; });
      const sw = h('div.swatches', { role: 'radiogroup', 'aria-label': t('shell.slot.colour') });
      const label = h('span.sw-name', swatchName(color));
      for (const w of swatches) {
        const c = w.color;
        // the partner's colour stays visible but taken: greyed, marked with their initial, and it says whose it is
        const b = h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(c === String(color).toUpperCase()),
          'aria-label': w.takenBy ? t('shell.slot.swatchTakenLabel', { colour: w.name, name: w.takenBy }) : w.name, 'aria-disabled': w.takenBy ? 'true' : null,
          title: w.takenBy ? t('shell.slot.swatchTaken', { colour: w.name, name: w.takenBy }) : w.name, style: { '--sw': c }, dataset: { colour: w.name },
          on: { click: () => {
            if (w.takenBy) { $('slot-error').textContent = t('shell.slot.colourTaken', { name: w.takenBy, colour: w.name }); return; }
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
      // the colours before Play (S9a, ux-phone#18: a stranger pressed Play before seeing them): name, colours, Play
      row.append(input, sw, play);
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
