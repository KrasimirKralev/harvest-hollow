// HUD (GDD §7.3, visual-ux-juice §5.5): level star + XP bar, farm name, both farmers' portraits with online dot,
// colour ring and title, the currency pills (coins, acorns, hearts, barn N / cap), the right-edge view buttons, the
// bottom-right dock (Build | Market | Barn + Orders / Journal) and the connection chip. ui-shell lane.
//
// Reads the store by topic only: wallet, xp, inventory (+overflow), players, name, barn, '*'. Panel links go through
// the registry by name, so a panel that ui-panels has not registered yet leaves its button inert, never broken.
import {
  CONTENT, levelFromXp, xpForLevel, unlocksAt, personalLevelFromXp, titleFor, GROWTH, COOP, pluralOf, defOf,
} from '../../../shared/content/index.js';
import { seatText, giantText, rideText, dockText, describe, verbsFor, OPENS } from '../game/targets.js';
import { barnCap, stockOf, overflowOf } from '../../../shared/rules/economy.js';
import { h, icon, svgIcon, fmt, fmtShort, rollNumber, playerVars, playerMark, GLYPH_NAMES, touchText, touchPlayer, kv, menuCloseHooks } from './dom.js';
import { hasIcon } from '../render/icons.js';
import { portraitSpec, portraitKey, peekPortrait } from '../render/portrait.js';
import { plotHurry, treeHurry, fieldHurry, hurryReason, finishField, fieldLabel } from './crop-hurry.js';
import { probe } from './panels/core.js';
import { SOFT } from '../../../shared/net/protocol.js';
import { farmName } from '../../../shared/brand.js';
import * as FARMING from '../../../shared/rules/actions/farming.js';
import * as UPG from '../../../shared/rules/upgrades.js';
import * as WEEDS from '../../../shared/rules/actions/weeds.js';
import * as BEAUTY from '../../../shared/rules/actions/beauty.js';
import { isCrateDef, crateOf, treeAgeOf, treeStageOf, ageLine } from './panels/w4b-rules.js';
import { stayOf, stayIntent, can5, petOf, stayLine, stayForOthers } from './panels/w5-rules.js';
import { pairTipLine } from './panels/pen-pair.js';
import { breedOf, breedName } from './panels/w4-rules.js';
import { petFace } from './panels/pet-art.js';
import { t, t as tt, tn, onLang, name as cname, N, Q, ctext, fmtDuration, fmtPct } from '../i18n/index.js';
import { lazyImport, importFailed } from '../net/lazy.js';

const $ = (id) => document.getElementById(id);

/** A second press of the Undo chip inside this many ms is the same press (QA r3 S3-17: a double tap 160 ms apart). */
export const UNDO_GAP_MS = 600;

/** Display name of an unlock row from content.unlocksAt(). */
export function unlockName({ family, id }) {
  if (family === 'barn') return t('hud.unlock.barn', { id });
  const fam = CONTENT[family];
  const def = fam && typeof fam.get === 'function' ? fam.get(id) : null;
  return def && def.name ? cname(id, { family }) : id;
}

/** The icon id for an unlock row (features and barn rows have none of their own). */
export function unlockIcon({ family, id }) {
  if (family === 'barn') return 'barn';
  if (family === 'parcels') return 'plot';                 // wave 5: a land parcel has no icon of its own
  if (family === 'features') return null;
  return id;
}

/** The next `n` levels' unlocks for the level-star hover (GDD §7.3 "hover: next 3 unlocks"). */
export function nextUnlocks(level, n = 3) {
  const out = [];
  for (let l = level + 1; out.length < n && l <= level + 12; l++) {
    for (const u of unlocksAt(l)) {
      if (u.family === 'features' || u.family === 'decor') continue;     // things, not systems, are what you can see
      out.push({ level: l, ...u, name: unlockName(u) });
      if (out.length >= n) break;
    }
  }
  return out;
}

/** Barn pill numbers: stock (inventory + overflow), capacity, and the state of the soft cap (GDD §3.6). */
export function barnStatus(state) {
  const cap = barnCap(state);
  const stock = stockOf(state);
  const over = overflowOf(state);
  const total = stock + over;
  return { total, cap, over, mode: total >= cap * 2 ? 'full' : over > 0 || total > cap ? 'overflow' : total >= cap * 0.9 ? 'near' : 'ok' };
}

/** The phone layout's media query (ui/layout.js LAYOUT_Q.phone; kept literal: layout.js imports this module). */
export const PHONE_Q = '(max-width: 600px), (max-height: 500px)';

/** A treasury number as the phone's top row shows it: exact below 100,000, then "735k" / "1.2M". Pure. */
export const phoneCoins = (v) => (Math.abs(v) >= 100_000 ? fmtShort(v) : fmt(v));

/** A player's shown title: a chosen one (rules-goals may store it), else the personal-level title. In the language in
 *  effect: content CONTENT.titles rows by level (lane B translates them, i18n/bg/text-b.js `titles`). */
export function titleOf(p) {
  return titleWord(p && typeof p.title === 'string' && p.title ? p.title : titleFor(personalLevelFromXp((p && p.xp) || 0)));
}
/** A personal title (the English one the rules use) in the language in effect. */
export function titleWord(en) {
  const row = (CONTENT.titles || []).find((r) => r.title === en);
  return row ? ctext('titles', String(row.level), 'title', en) : en;
}

/** A farmer's initial: the first character of the name (a whole code point: an emoji or an accented capital stays
 *  intact), upper case; '?' for no name. Pure. */
export function initialOf(name) {
  const first = [...String(name ?? '').trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** The face of a farmer (HUD chip, slot picker): the initial, and the portrait's frame over it (empty until drawn). */
export function portraitFace(letter = '') {
  return h('span.face', { 'aria-hidden': 'true' }, h('span.ltr', letter),
    h('span.pfw', h('img.pf', { alt: '', draggable: 'false', decoding: 'async' })));
}

/**
 * Put a farmer's portrait into a face from portraitFace(): at once when this browser has it, else drawn by the view
 * (`view.portrait`, render/portrait.js) and shown when it is ready. Until then, and for good without WebGL, the initial
 * shows; a new look keeps the old picture until the new one is decoded (never an empty circle). Cheap to call on every
 * players change: the same look returns at once.
 */
export function showPortrait(face, spec, view) {
  const key = portraitKey(spec);
  if (face.dataset.pk === key) return;
  face.dataset.pk = key;
  const put = (url) => {
    if (face.dataset.pk !== key) return;                         // a newer look asked meanwhile
    if (!url) { delete face.dataset.pk; return; }                // not drawn (no WebGL yet): a later change asks again
    const img = face.querySelector('img.pf');
    if (!img) return;
    if (img.getAttribute('src') === url) { face.classList.add('has-portrait'); return; }
    const pre = new Image();
    pre.src = url;
    const show = () => { if (face.dataset.pk === key) { img.src = url; face.classList.add('has-portrait'); } };
    (typeof pre.decode === 'function' ? pre.decode() : Promise.resolve()).then(show, () => { delete face.dataset.pk; });
  };
  const hit = peekPortrait(spec);
  if (hit) put(hit);
  else if (view && typeof view.portrait === 'function') view.portrait(spec).then(put, () => put(null));
  else delete face.dataset.pk;
}

// labels are read at render time (getters): a language switch re-draws the dock (renderDock after a reset, below)
const dockItem = (o, key) => Object.defineProperty(o, 'label', { get: () => t(key), enumerable: true });
// release 1.0 (S1, ux-first#5): four big buttons for the common verbs (Orders hidden until it opens at L2) and ONE Farm
// book button (ui/layout.js) whose sheet holds every other place; the small buttons ("minis") live in the Farm book
const DOCK_BUILTIN = [
  dockItem({ name: 'build', icon: 'hammer', order: 10, hotkey: 'B' }, 'hud.dock.build'),
  dockItem({ name: 'market', icon: 'market_stand', order: 20, hotkey: 'M' }, 'hud.dock.market'),
  dockItem({ name: 'barn', icon: 'barn', order: 30, hotkey: 'I' }, 'hud.dock.barn'),
  dockItem({ name: 'orders', icon: 'order_board', glyph: 'orders', order: 40, hotkey: 'O' }, 'hud.dock.orders'),
];
const MINI_BUILTIN = [
  dockItem({ name: 'journal', glyph: 'journal', order: 50, hotkey: 'J' }, 'hud.dock.journal'),
];

function pictogram(iconId, glyph, size) {
  if (iconId && hasIcon(iconId)) return icon(iconId, { size });
  if (iconId && GLYPH_NAMES.includes(iconId)) return svgIcon(iconId, size);
  if (glyph) return svgIcon(glyph, size);
  return iconId ? icon(iconId, { size }) : svgIcon('star', size);
}

/**
 * F2 (feel#6): my own gain shows when its flight lands, not when the prediction changes the state. offer() holds a
 * pill's old number for a gain of `kind` until land(kind) (the first window 'hh:fly-arrive' of that kind, from
 * life-feel's fx) or `delay` ms, then roll(el, to, format) once and bump(pill, up) once; a change meanwhile (the
 * server's confirmation, another gain) only moves the number it will roll to. offer() -> true when it took the value.
 * DOM-free apart from `el.dataset.v` (the number on show), so a test hands in its own roll, bump and timers.
 */
export function arrivalGate({ roll, bump, delay = 1200, timers = globalThis }) {
  const pending = new Map();          // kind -> { el, pill, to, format, timer }
  function land(kind) {
    const p = pending.get(kind);
    if (!p) return false;
    pending.delete(kind);
    timers.clearTimeout(p.timer);
    const prev = Number(p.el.dataset.v ?? p.to);
    if (prev !== p.to) { roll(p.el, p.to, p.format); bump(p.pill, p.to > prev); }
    return true;
  }
  function offer(kind, el, pill, v, format, { gain = false, animate = false } = {}) {
    const wait = kind ? pending.get(kind) : null;
    if (wait) { wait.to = v; wait.format = format; return true; }
    if (!kind || !gain || !animate || !(v > Number(el.dataset.v ?? v))) return false;
    pending.set(kind, { el, pill, to: v, format, timer: timers.setTimeout(() => land(kind), delay) });
    return true;
  }
  return { offer, land, waiting: (kind) => pending.has(kind) };
}

export function createHud(S) {
  const { store, view, controller, ui } = S;
  const online = new Map();
  let lastLevel = null;
  let lastXp = null;

  // ---- level star + XP -------------------------------------------------------------------------------------
  const star = $('hud-level-star');
  // every phone layout (portrait and on its side: the bar is 88-130 px there) shows the percentage
  const xpMq = globalThis.matchMedia?.(PHONE_Q) ?? null;
  let xpNow = null;
  xpMq?.addEventListener?.('change', () => { if (store.state) renderLevel(); });
  const levelCard = $('hud-level-card');
  function renderLevel() {
    const xp = store.state.farm.xp;
    const level = levelFromXp(xp);
    const from = xpForLevel(level);
    const to = xpForLevel(level + 1);
    $('hud-level').textContent = String(level);
    $('hud-level-text').textContent = String(level);
    const span = Math.max(1, to - from);
    const k = Math.max(0, Math.min(1, (xp - from) / span));
    const fill = $('hud-xp-fill');
    if (lastLevel !== null && level > lastLevel) {
      // fill to the end, then restart from zero: the bar never runs backwards on a level-up
      fill.style.setProperty('--p', '1');
      setTimeout(() => {
        fill.style.transition = 'none';
        fill.style.setProperty('--p', '0');
        void fill.offsetWidth;
        fill.style.transition = '';
        fill.style.setProperty('--p', String(k));
      }, 650);
      levelCard.classList.remove('levelled');
      void levelCard.offsetWidth;
      levelCard.classList.add('levelled');
    } else {
      fill.style.setProperty('--p', String(k));
    }
    if (lastXp !== null && xp > lastXp) {
      const bar = $('hud-xp-bar');
      bar.classList.add('gain');
      clearTimeout(bar._t);
      bar._t = setTimeout(() => bar.classList.remove('gain'), 300);
    }
    lastLevel = level;
    lastXp = xp;
    const bar = $('hud-xp-bar');
    bar.setAttribute('aria-valuenow', String(xp - from));
    bar.setAttribute('aria-valuemax', String(span));
    bar.setAttribute('aria-valuetext', t('hud.xp.valuetext', { a: xp - from, b: span, level: level + 1 }));
    // " XP" is its own span: a phone's narrow bar drops it (css/mobile.css), the numbers stay. ONE child span: the
    // label is a grid, and a bare text node beside the unit would become a second grid row. A phone (<= 420 px) shows the
    // percentage (release 1.0 M12a, copy#3: "20 381 / 70 000" wrapped and was cut in Bulgarian); the full numbers are in
    // aria-valuetext and in the star's card (a long press)
    xpNow = { a: xp - from, b: span, level };
    $('hud-xp-text').replaceChildren(xpMq?.matches
      ? h('span', t('dock.xp.pct', { pct: fmtPct(Math.floor(k * 100)) }))
      : h('span', `${fmtShort(xp - from)} / ${fmtShort(span)}`, h('span.xp-unit', t('hud.xp.unit'))));
    const next = nextUnlocks(level);
    const tipLevel = next.length
      ? t('hud.level.tipNext', { level, next: next.map((u) => t('hud.level.unlockAt', { name: u.name, level: u.level })).join(', ') })
      : t('hud.level.tip', { level });
    star.dataset.tipBase = tipLevel;
    star.dataset.tip = tipLevel;
    star.setAttribute('aria-label', t('hud.level.label', { level, a: xp - from, b: span }));
  }

  // Acorns, Hearts and Beauty left the top bar (S1, M30): the level card's hover says them (read when the tip is about
  // to show: Beauty walks the decor, never on every XP change)
  const statsTip = () => {
    if (!store.state) return;
    const stats = statsLine(store.state, store.pid, store.now());
    const nums = xpNow ? `${fmt(xpNow.a)} / ${fmt(xpNow.b)}${t('hud.xp.unit')}` : '';
    star.dataset.tip = [star.dataset.tipBase || '', nums, stats].filter(Boolean).join('\n');
  };
  // a finger's long press on the star shows the same card (hud tips: pointerdown starts the press)
  star.addEventListener('pointerdown', statsTip);
  star.addEventListener('pointerenter', statsTip);
  star.addEventListener('focus', statsTip);

  function renderFarmName() {
    $('hud-farm-name').textContent = farmName(store.state);
  }

  // ---- currencies ------------------------------------------------------------------------------------------
  const pills = { coins: $('hud-coins-pill'), acorns: $('hud-acorns-pill'), hearts: $('hud-hearts-pill'), barn: $('hud-barn-pill') };
  // Web Animations instead of "remove class, read offsetWidth, add class": a coin change during a drag stroke must
  // not force a synchronous layout per plot (QA wave 1 UI-30); a running bump is simply replaced
  const BUMP_UP = [{ transform: 'scale(1)' }, { transform: 'scale(1.15)', offset: 0.4 }, { transform: 'scale(1)' }];
  const BUMP_DOWN = [{ transform: 'scale(1)' }, { transform: 'scale(.93)', offset: 0.4 }, { transform: 'scale(1)' }];
  function bump(el, up = true) {
    if (typeof el.animate !== 'function' || document.body.classList.contains('motion-reduced')) return;
    el._bump?.cancel();
    el._bump = el.animate(up ? BUMP_UP : BUMP_DOWN, { duration: 250, easing: up ? 'cubic-bezier(.34, 1.56, .64, 1)' : 'cubic-bezier(.22, 1, .36, 1)' });
  }
  // F2 (feel#6): my own gain shows when its flight lands (arrivalGate below)
  const gate = arrivalGate({ roll: (el, to, format) => rollNumber(el, to, { format, ms: 400 }), bump });
  window.addEventListener('hh:fly-arrive', (e) => { const k = e.detail?.kind; if (k) gate.land(k); });
  function setNum(el, pill, v, animate, format = fmt, kind = null, gain = false) {
    if (gate.offer(kind, el, pill, v, format, { gain, animate })) return;
    const prev = Number(el.dataset.v ?? v);
    if (animate && prev !== v) { rollNumber(el, v, { format }); bump(pill, v > prev); }
    else {
      if (el._rollRaf) { cancelAnimationFrame(el._rollRaf); el._rollRaf = 0; }
      el._rollAt = v;
      el.dataset.v = String(v);
      el.textContent = format(v);
    }
  }
  // a phone's top row has room for "735k", not "735,457" (the exact sum stays in the pill's name)
  const phoneMq = globalThis.matchMedia?.(PHONE_Q) ?? null;
  const coinFmt = (v) => (phoneMq?.matches ? phoneCoins(v) : fmt(v));
  function renderWallet(animate, gain = false) {
    const w = store.state.farm.wallet;
    setNum($('hud-coins'), pills.coins, w.coins, animate, coinFmt, 'coins', gain);
    setNum($('hud-acorns'), pills.acorns, w.acorns, animate, coinFmt, 'acorns', gain);
    if (phoneMq?.matches) pills.coins.setAttribute('aria-label', tn('hud.coins.label', w.coins));
    else pills.coins.removeAttribute('aria-label');
  }
  phoneMq?.addEventListener?.('change', () => { if (store.state) renderWallet(false); });
  function renderHearts(animate) {
    const me = store.state.players[store.pid];
    setNum($('hud-hearts'), pills.hearts, me ? me.hearts || 0 : 0, animate);
  }
  function renderBarn(animate, gain = false) {
    const b = barnStatus(store.state);
    setNum($('hud-barn'), pills.barn, b.total, animate, fmt, 'barn', gain);
    $('hud-barn-cap').textContent = ` / ${fmtShort(b.cap)}`;
    pills.barn.classList.toggle('overflow', b.mode === 'overflow' || b.mode === 'full');
    pills.barn.classList.toggle('near', b.mode === 'near');
    pills.barn.dataset.tip = b.mode === 'full'
      ? t('hud.barn.full', { total: b.total, max: b.cap * 2 })
      : b.mode === 'overflow'
        ? t('hud.barn.overflow', { total: b.total, cap: b.cap })
        : t('hud.barn.tip', { total: b.total, cap: b.cap });
    pills.barn.setAttribute('aria-label', b.over ? t('hud.barn.labelOver', { total: b.total, cap: b.cap, over: b.over })
      : t('hud.barn.label', { total: b.total, cap: b.cap }));
    return b;
  }
  pills.coins.addEventListener('click', () => openOr('market', { tab: 'sell' }, 'barn'));
  pills.acorns.addEventListener('click', () => openOr('market', { tab: 'acorn' }));
  // until the wardrobe exists the hearts pill opens Journal > Together (Hearts per farmer), never a dead click
  pills.hearts.addEventListener('click', () => (ui.panels.has('wardrobe') ? openOr('wardrobe', {}) : openOr('journal', { tab: 'stats' })));
  pills.hearts.dataset.tip = t('hud.hearts.tip');
  pills.barn.addEventListener('click', () => ui.panels.toggle('barn'));

  /** Open `name` (toggle when already open), else the fallback panel, else say what it is. */
  function openOr(name, args, fallback) {
    if (ui.panels.has(name)) return ui.panels.isOpen(name) && sameTab(name, args) ? ui.panels.close(name) : ui.panels.open(name, args);
    if (fallback && ui.panels.has(fallback)) return ui.panels.toggle(fallback);
    return false;
  }
  const sameTab = (name, args) => !args || !args.tab || document.querySelector(`#panel-${name} [role="tab"][aria-selected="true"]`)?.dataset.tab === args.tab;
  /** A pill whose panel is not registered (yet) looks flat: no hover lift for something that does nothing. */
  function markInert() {
    const live = { coins: ui.panels.has('market') || ui.panels.has('barn'), acorns: ui.panels.has('market'),
      hearts: ui.panels.has('wardrobe') || ui.panels.has('journal'), barn: ui.panels.has('barn') };
    for (const [k, el] of Object.entries(pills)) el.classList.toggle('inert', !live[k]);
  }
  ui.panels.on('register', markInert);
  markInert();

  // ---- farmers ---------------------------------------------------------------------------------------------
  // pid -> li (patched in place: focus survives the frequent 'players' changes). The list item holds a real button
  // (list semantics stay intact); data-slot gives each farmer a shape as well as a colour: farmer 1 a circle,
  // farmer 2 a rounded square, everywhere (GDD §7.5: identity is never colour alone)
  const chips = new Map();
  function renderPlayers() {
    const list = $('hud-players');
    const players = store.state.players;
    const pids = Object.keys(players).sort();
    if (pids.join(',') !== [...list.children].map((li) => li.dataset.pid).join(',')) {
      list.replaceChildren(...pids.map((pid) => {
        if (!chips.has(pid)) {
          const go = () => { if (pid !== store.pid) goTo(pid); else if (typeof controller.focusMe === 'function') controller.focusMe(); };
          // the face: the farmer's portrait (render/portrait.js) over their initial, which shows until the picture is
          // there (or for good without WebGL); the name plate: the name (ellipsized), "(you)" beside it, the title below
          const btn = h('button.farmer', { type: 'button', on: { click: go } },
            portraitFace(), h('span.tag', { 'aria-hidden': 'true' },
              h('span.who', h('span.nm'), pid === store.pid ? h('span.you', t('hud.you')) : null), h('span.title')));
          const li = h('li', { dataset: { pid, slot: slotOf(pid) } }, btn);
          // "Your look" lives in the gear's menu and the Farm book's You page (release 1.0 S1: the ✎ on the chip went)
          chips.set(pid, li);
        }
        return chips.get(pid);
      }));
    }
    for (const pid of pids) {
      const p = players[pid];
      const li = chips.get(pid);
      const btn = li.firstElementChild;
      const me = pid === store.pid;
      const on = me || online.get(pid) === true;
      const title = titleOf(p);
      li.className = `${on ? 'online' : 'offline'}${me ? ' me' : ' partner'}`;
      for (const [k, v] of Object.entries(playerVars(p.color))) li.style.setProperty(k, v);
      btn.setAttribute('aria-label', t(me ? 'hud.farmer.labelMe' : on ? 'hud.farmer.labelOn' : 'hud.farmer.labelAway', { name: p.name, title }));
      btn.dataset.tip = t(me ? 'hud.farmer.tipMe' : on ? 'hud.farmer.tipOn' : 'hud.farmer.tipAway', { name: p.name, title });
      const face = li.querySelector('.face');
      face.querySelector('.ltr').textContent = initialOf(p.name);
      showPortrait(face, portraitSpec(pid, p), view);
      const nm = li.querySelector('.nm');
      if (nm.textContent !== (p.name || '')) nm.textContent = p.name || '';
      li.querySelector('.title').textContent = on || me ? title : t('shell.slot.away');
    }
    if (typeof ResizeObserver !== 'function') fitSoon();         // else the observer below sees the chips change size
  }
  // The chips never run under the treasury pills (a long name on a window under the 1366 px design floor, or a big coin
  // count): when they would, the partner shows as a face only and my name is cut shorter ('snug'). Measured at most once
  // per animation frame, and only when something moved (below), never per frame. The full width is measured with the
  // class off every time (both changes land before the frame paints), so the choice never depends on itself: no flicker.
  let fitQ = 0;
  function fitSoon() { if (!fitQ) fitQ = requestAnimationFrame(fit); }
  function fit() {
    fitQ = 0;
    const list = $('hud-players');
    const tr = document.querySelector('.hud-tr');
    if (!list || !tr || !list.offsetParent) return;
    list.classList.remove('snug');
    const a = list.getBoundingClientRect();
    if (a.right > tr.getBoundingClientRect().left - 16) list.classList.add('snug');
  }
  // what moves either side: the window (a media query), the Interface size (applied 120 ms after a resize, or chosen in
  // Settings), the pills' own width (a longer coin count) and the chips' (a rename, the partner's title)
  window.addEventListener('resize', fitSoon, { passive: true });
  S.settings.on(fitSoon);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(fitSoon);
    ro.observe($('hud-players'));
    const tr = document.querySelector('.hud-tr');
    if (tr) ro.observe(tr);
  } else store.subscribe('wallet', fitSoon);
  function goTo(pid) {
    if (typeof controller.focusPartner === 'function' && Object.keys(store.state.players).length === 2) { controller.focusPartner(); return; }
    const pose = view.partner && view.partner.pose ? view.partner.pose(pid) : null;
    if (pose) view.focus(pose.x, pose.z);
    else ui.toast(t('hud.farmer.awayNow', { name: store.state.players[pid]?.name ?? t('common.partner') }), { kind: 'info' });
  }

  // ---- right edge ------------------------------------------------------------------------------------------
  // Five buttons on the right edge (QA wave 1 UI-40): zoom and turn, plus one utility button whose little menu holds
  // the photo, Settings (also the , key) and the sound switch.
  const edge = $('hud-right');
  // labels are catalog keys kept on the buttons (data-lk): relabelEdge() re-reads them after a language switch
  const keyCap = (key) => (key === 'wheel' ? t('hud.key.wheel') : key);
  const labelEdge = (b) => {
    const label = t(b.dataset.lk);
    b.setAttribute('aria-label', label);
    b.dataset.tip = b.dataset.kk ? `${label} (${keyCap(b.dataset.kk)})` : label;
    b.dataset.tipTouch = label;                                  // a finger has no keys and no wheel
  };
  const edgeBtn = (glyph, lk, key, fn, extra = {}) => {
    const b = h('button.edge-btn', { type: 'button', dataset: { lk, kk: key || '' }, on: { click: fn }, ...extra }, svgIcon(glyph, 30));
    labelEdge(b);
    return b;
  };
  // the items are no Tab stops (QA r3 S3-11, ap#4: five Tabs walked the open menu and the sixth left it open): the arrows,
  // Home and End move between them, a Tab leaves the menu and closes it
  const menuBtn = (glyph, lk, key, fn, extra = {}) => h('button.edge-item', {
    type: 'button', role: 'menuitem', tabindex: '-1', dataset: { mk: lk }, on: { click: (e) => { fn(e); if (!extra.keepOpen) closeMenu(); } }, ...(extra.id ? { id: extra.id } : {}),
  }, svgIcon(glyph, 26), h('span.lbl', t(lk)), key ? h('kbd', key) : null);
  const soundBtn = menuBtn('sound', 'hud.edge.soundOn', null, () => { S.settings.set({ muted: !S.settings.get().muted }); }, { id: 'hud-sound', keepOpen: true });
  const menu = h('div.edge-menu.paper#hud-gear-menu', { role: 'menu', 'aria-label': t('hud.edge.menu'), hidden: true },
    menuBtn('photo', 'game.key.photo', 'P', () => (typeof controller.photo === 'function' ? controller.photo() : ui.photoMode(true))),
    menuBtn('gear', 'game.key.settings', ',', () => ui.panels.toggle('settings'), { id: 'hud-settings' }),
    menuBtn('smile', 'hud.edge.look', null, () => { if (ui.panels.has('avatar')) ui.panels.open('avatar'); }, { id: 'hud-look' }),
    // multi-farm mode only (ui/invite.js): a one-time link for the second farmer
    S.invite ? menuBtn('letter', 'multi.invite.title', null, () => S.invite.open(), { id: 'hud-invite' }) : null,
    soundBtn);
  const moreBtn = edgeBtn('gear', 'hud.edge.more', null, () => (menu.hidden ? openMenu() : closeMenu()),
    { id: 'hud-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'hud-gear-menu' });
  function relabelEdge() {
    for (const b of edge.querySelectorAll('.edge-btn')) labelEdge(b);
    for (const b of menu.querySelectorAll('[data-mk]')) b.querySelector('.lbl').textContent = t(b.dataset.mk);
    menu.setAttribute('aria-label', t('hud.edge.menu'));
    renderSound();
  }
  const moreWrap = h('div.edge-more', moreBtn, menu);
  // Settings (the gear and its menu) is the top of the right edge, in a slot of its own above the column (release 1.0
  // M3, ux-first#3): nothing can cover it, and the column's first child stays the helper's button (ui/harness)
  const gear = h('div.hud-gear#hud-gear', moreWrap);
  edge.before(gear);
  if (S.ideas) menu.insertBefore(S.ideas.menuItem(closeMenu), soundBtn);
  function openMenu() {
    menu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus({ preventScroll: true });
  }
  function closeMenu({ focus = null } = {}) {
    if (menu.hidden) return;
    const had = menu.contains(document.activeElement);
    menu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    if (focus ?? had) moreBtn.focus({ preventScroll: true });
  }
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')].filter((b) => !b.hidden);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items.at(-1)?.focus(); }
  });
  // the same close hooks as the Together menu and the toolbar's flyouts (QA r3 S3-11, jde#4, ap#4): a press outside, a
  // panel that opens by itself (Harvey's ready sheet: the menu stayed drawn over the scrim, and its "Settings" closed the
  // sheet and opened nothing), the focus leaving it, Escape wherever the focus is
  menuCloseHooks({ wrap: moreWrap, isOpen: () => !menu.hidden, close: closeMenu, panels: ui.panels });
  // one quarter-turn button (S3, ux-phone#13): the wheel, a pinch, + / - zoom; Q turns back (release 1.0 S1: zoom +/- and
  // the second turn button went, every way to do it stays)
  edge.append(edgeBtn('rotr', 'dock.edge.turn', 'E', () => view.camera.rotate(1), { id: 'hud-turn' }));
  function renderSound() {
    const muted = S.settings.get().muted;
    soundBtn.firstChild.replaceWith(svgIcon(muted ? 'mute' : 'sound', 26));
    soundBtn.querySelector('.lbl').textContent = muted ? t('hud.edge.soundIsOff') : t('hud.edge.soundIsOn');
    soundBtn.setAttribute('aria-label', muted ? t('hud.edge.soundOffLabel') : t('hud.edge.soundOnLabel'));
    soundBtn.setAttribute('role', 'menuitemcheckbox');
    soundBtn.setAttribute('aria-checked', String(!muted));
  }
  S.settings.on(renderSound);
  renderSound();

  // ---- a double click is one press (QA r1 S-29, br#1): many casual players double-click everything, and the second
  // click of a dock door, the Farm book, Harvey or a tool slot closed what the first had opened ~150 ms before. The
  // second click of a double click (detail 2+) never reaches those toggles; a keyboard press (detail 0) and every
  // single click or tap still do.
  const TOGGLE_DOORS = '.dock-btn, .m-menu-btn, .dock-mini, #hx-dock button, .tool-slot, .tool[data-tool="seed_bag"], #together-btn, #hud-more';
  $('hud')?.addEventListener('click', (e) => {
    if (!(e.detail >= 2) || !e.target?.closest?.(TOGGLE_DOORS)) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // ---- dock --------------------------------------------------------------------------------------------------
  const dock = $('dock');
  const minis = h('div.dock-minis', { role: 'group', 'aria-label': t('hud.dock.minis') });
  dock.after(minis);
  function dockEntries() {
    const reg = new Map(ui.panels.list().map((p) => [p.name, p]));
    // the canonical buttons keep the shell's order, label and icon (GDD §7.3: Build | Market | Barn); a panel's
    // dock spec may only add its hint
    const canon = (b) => ({ ...b, hint: reg.get(b.name)?.dock?.hint ?? null, name: b.name, panel: reg.get(b.name) });
    const big = DOCK_BUILTIN.map(canon);
    const small = MINI_BUILTIN.map(canon);
    for (const p of reg.values()) {
      if (!p.dock || DOCK_BUILTIN.some((b) => b.name === p.name) || MINI_BUILTIN.some((b) => b.name === p.name)) continue;
      (p.dock.mini ? small : big).push({ ...p.dock, name: p.name, panel: p });
    }
    return { big: big.sort((a, b) => a.order - b.order), small: small.sort((a, b) => a.order - b.order) };
  }
  function lockReason(name) {
    const spec = S.panelSpec(name);
    return spec && spec.locked && store.state ? spec.locked(store.state) : null;
  }
  const dockBtns = new Map();     // name -> button (kept across renders: focus and the opener survive)
  let dockIds = '';
  function patchDock(btn, d, locked, pressed, mini) {
    // a finger has no keys: no "(M)" in what a screen reader says on a phone (S9a, ux-phone#19)
    const label = `${d.label}${d.hotkey && !touchPlayer(controller) ? ` (${d.hotkey})` : ''}`;
    btn.setAttribute('aria-pressed', String(pressed));
    if (locked) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    btn.setAttribute('aria-label', `${label}${locked ? `. ${locked}` : ''}`);
    btn.dataset.tip = locked || (mini ? label : d.hint || label);
    btn._locked = locked;
    const badgeVal = d.panel && d.panel.badge ? String(d.panel.badge) : null;
    // red is for "look now"; a panel that only has something to do shows a calm badge (QA2 UI-03)
    const calm = Boolean(badgeVal) && badgeVal !== 'New' && d.panel?.badgeTone === 'calm';
    let badge = btn.querySelector('.badge');
    if (badgeVal) {
      if (!badge) { badge = h('span.badge'); btn.append(badge); }
      badge.textContent = badgeVal === 'New' ? t('toolbar.new') : badgeVal; // i18n-ok: 'New' is the panels' sentinel value
      badge.classList.toggle('badge--new', badgeVal === 'New');
      badge.classList.toggle('badge--calm', calm);
    } else if (badge) badge.remove();
    btn.classList.toggle('has-new', Boolean(badgeVal) && !calm);
    let lock = btn.querySelector('.lock');
    if (locked && !lock && !mini) btn.append(h('span.lock', svgIcon('lock', 20)));
    else if (!locked && lock) lock.remove();
  }
  function renderDock() {
    const { big, small } = dockEntries();
    // Orders shows from the level it opens (release 1.0 S1, ux-first#17): a greyed button at L1 was a question, not a door
    const shownBig = big.filter((d) => d.name === 'build' || (d.panel && !(d.name === 'orders' && lockReason('orders'))));
    const shownSmall = small.filter((d) => d.panel);
    const ids = `${shownBig.map((d) => d.name).join(',')}|${shownSmall.map((d) => d.name).join(',')}`;
    const make = (d, mini) => {
      const key = `${mini ? 'm' : 'b'}:${d.name}`;
      if (!dockBtns.has(key)) {
        const btn = mini
          ? h('button.dock-mini', { type: 'button', dataset: { dock: d.name } }, pictogram(d.icon, d.glyph, 42), h('span.lbl', d.label))
          : h('button.dock-btn', { type: 'button', dataset: { dock: d.name } }, pictogram(d.icon, d.glyph, 56), h('span.lbl.outlined', d.label));
        // the lock is read at click time: a dock drawn before the first welcome (or before a level-up) never goes stale
        btn.addEventListener('click', () => onDock(d.name, d.name === 'build' ? null : lockReason(d.name)));
        dockBtns.set(key, btn);
      }
      return dockBtns.get(key);
    };
    if (ids !== dockIds) {
      dockIds = ids;
      // the Farm book's button (ui/layout.js) stays the dock's last button
      const book = document.getElementById('m-menu-btn');
      dock.replaceChildren(...shownBig.map((d) => make(d, false)), ...(book ? [book] : []));
      minis.replaceChildren(...shownSmall.map((d) => make(d, true)));
      S.layout?.bookChanged?.();
    }
    for (const d of shownBig) {
      const locked = d.name === 'build' ? null : lockReason(d.name);
      const pressed = d.name === 'build' ? (controller.tool.id === 'hammer' || ui.panels.isOpen('build') || Boolean(S.toolbar?.buildOpen)) : ui.panels.isOpen(d.name);
      patchDock(make(d, false), d, locked, pressed, false);
    }
    for (const d of shownSmall) patchDock(make(d, true), d, lockReason(d.name), ui.panels.isOpen(d.name), true);
    dock.hidden = dock.children.length === 0;
    // the phone bar's slots: the tool in hand, the doors shown (Build lives in the tool slot's pop-up), the Farm book.
    // Before Orders opens (L2) four slots share the bar: no hole where Orders will come (QA r1 S-25, mobile.css)
    document.body.dataset.bar = String(2 + shownBig.filter((d) => d.name !== 'build').length);
  }
  function onDock(name, locked) {
    if (locked) { ui.toast(locked, { kind: 'info' }); return; }
    if (name === 'build') {
      if (ui.panels.has('build')) { ui.panels.toggle('build'); return; }
      if (controller.tool.id === 'hammer' && !S.toolbar?.buildOpen) { controller.setTool('hand'); return; }
      if (S.toolbar) S.toolbar.openBuild(); else controller.setTool('hammer');
      return;
    }
    ui.panels.toggle(name);
  }
  ui.panels.on('register', renderDock);
  store.subscribe('xp', renderDock);                     // a level-up opens Orders / Journal: the lock goes

  // ---- Acorns appear when a price needs them (S1): while the Market (its Acorn shop) or a crop's Finish card shows --
  const acornPrice = () => document.body.classList.toggle('acorn-price', ui.panels.isOpen('market') || ui.panels.isOpen('relicShop')
    || Boolean(document.querySelector('#tip:not([hidden]) .tip-finish-one')));
  ui.panels.on('open', acornPrice);
  ui.panels.on('close', acornPrice);
  if (typeof MutationObserver === 'function') new MutationObserver(acornPrice).observe(document.getElementById('tip') ?? document.body, { childList: true, attributes: true, attributeFilter: ['hidden'] });

  // ---- Undo as a chip during its ten minutes (S3; ux-phone#3: it was the farm menu's last, half-cut row) ---------------
  // the chip undoes exactly what it names (QA r3 S3-17, br#2: a double click refunded the named Picket Fence and then the
  // Scarecrow nobody named); the second click of a double click, and a press within UNDO_GAP_MS of the last, are dropped
  let undoNamed = null;
  let undoPressAt = -Infinity;
  const undoBtn = h('button.chip.undo-btn', { type: 'button', on: { click: (e) => {
    const t0 = performance.now();
    if (e.detail >= 2 || t0 - undoPressAt < UNDO_GAP_MS) return;
    undoPressAt = t0;
    if (undoNamed) controller.undo?.({ id: undoNamed.id, verb: undoNamed.verb });
    renderUndo();
  } } }, svgIcon('undo', 20), h('span.lbl'));
  const undoChip = h('div.undo-chip', { hidden: true }, undoBtn);
  const chipRow = h('div.hud-chips', undoChip);
  document.querySelector('.hud-bl')?.prepend(chipRow);
  let undoTimer = 0;
  function renderUndo() {
    clearTimeout(undoTimer);
    const u = typeof controller.canUndo === 'function' ? controller.canUndo() : null;
    undoNamed = u;
    undoChip.hidden = !u;
    if (!u) return;
    const what = u.def ? N(u.def) : '';
    undoBtn.querySelector('.lbl').textContent = what ? t('dock.undo.thing', { thing: what }) : t('social.menu.undo');
    undoBtn.setAttribute('aria-label', what ? t('dock.undo.label', { thing: what }) : t('social.menu.undoLabel'));
    undoTimer = setTimeout(renderUndo, Math.max(1000, Math.min(30_000, u.until - store.now() + 50)));
  }
  store.subscribe('objects', () => { clearTimeout(undoTimer); undoTimer = setTimeout(renderUndo, 120); });
  store.on('welcome', () => renderUndo());
  onLang(() => renderUndo());
  if (store.state) setTimeout(renderUndo, 0);
  store.on('welcome', renderDock);
  ui.panels.on('badge', renderDock);
  ui.panels.on('open', renderDock);
  ui.panels.on('close', renderDock);
  controller.on('tool', renderDock);
  controller.on('input', renderDock);

  // ---- connection chip -------------------------------------------------------------------------------------
  const conn = $('conn');
  let connState = 'connecting';
  let okTimer = 0;
  let sleepTimer = 0;
  function setConnection(status) {
    const was = connState;
    connState = status;
    clearTimeout(okTimer);
    clearTimeout(sleepTimer);
    conn.className = 'conn';
    conn.replaceChildren();
    if (status === 'open') {
      if (was === 'reconnecting' || was === 'asleep') {
        conn.classList.add('ok');
        conn.append(svgIcon('check', 20), t('hud.conn.back'));
        okTimer = setTimeout(() => { conn.replaceChildren(); conn.className = 'conn'; }, 1800);
      }
      return;
    }
    if (status === 'mismatch') {
      conn.classList.add('bad');
      conn.append(h('span.cg', { 'aria-hidden': 'true' }, '!'), t('shell.boot.mismatch'),
        h('button.btn.btn--sun.btn--small', { type: 'button', on: { click: () => location.reload() } }, t('common.reload')));
      return;
    }
    if (status === 'degraded') {
      conn.classList.add('bad');
      conn.append(h('span.cg', { 'aria-hidden': 'true' }, '!'), t('hud.conn.degraded'));
      return;
    }
    conn.append(h('span.spin', { 'aria-hidden': 'true' }), status === 'reconnecting' ? t('hud.conn.reconnecting') : t('err.NOT_JOINED'));
    if (status === 'reconnecting') {
      // GDD §6.3: the client stops taking moves once the oldest unanswered one is 30 s old (store.health().stale);
      // from that moment the chip says so, never "your moves are kept" over a refused move (QA r1 S-30). At the
      // latest 30 s after the drop it says it anyway
      const t0 = Date.now();
      const check = () => {
        if (connState !== 'reconnecting') return;
        let stale = false;
        try { stale = Boolean(store.health?.().stale); } catch { stale = false; }
        if (connKey({ stale, ms: Date.now() - t0 }) === 'hud.conn.asleep') {
          connState = 'asleep';
          conn.replaceChildren(h('span.spin', { 'aria-hidden': 'true' }), t('hud.conn.asleep'));
          return;
        }
        sleepTimer = setTimeout(check, 1000);
      };
      sleepTimer = setTimeout(check, 1000);
    }
  }

  // ---- buffs: Golden Hour and the high-five Spark, with a live countdown (GDD §6.2 #9, #10) -------------------
  // the countdown itself is aria-live="off" (a region rewritten every second would talk all the time); start and
  // end go once to a hidden status node (QA wave 1 UI-26)
  const buffs = h('div.buffs', { id: 'hud-buffs', 'aria-live': 'off' });
  const buffSay = h('div.sr-only', { id: 'hud-buffs-say', role: 'status', 'aria-live': 'polite' });
  document.querySelector('.hud-tl').append(buffs, buffSay);
  let buffTimer = 0;
  let buffKeys = null;
  let buffNames = new Map();
  function renderBuffs() {
    const st = store.state;
    if (!st) return;
    const now = store.now();
    const items = buffItems(st, store.pid, now);
    const key = items.map((i) => i.cls).join(',');
    const said = buffAnnouncements(buffKeys, items, buffNames);
    buffKeys = items.map((i) => i.cls);
    buffNames = new Map(items.map((i) => [i.cls, i.name]));
    if (said.length) buffSay.textContent = said.join(' ');
    if (buffs.dataset.key !== key) {
      buffs.dataset.key = key;
      buffs.replaceChildren(...items.map((i) => h(`span.buff.${i.cls}`, { 'data-tip': i.tip }, svgIcon(i.glyph, 22), h('span.t', i.text))));
    } else {
      items.forEach((i, k) => { buffs.children[k].querySelector('.t').textContent = i.text; });
    }
    clearTimeout(buffTimer);
    if (items.length) buffTimer = setTimeout(renderBuffs, 1000);
  }
  // a later source's running chips are not news
  BUFF_DRAW.add(() => { buffKeys = null; renderBuffs(); });

  // ---- wiring ------------------------------------------------------------------------------------------------
  // a change I made myself (predicted: 'local') is a gain whose flight is coming
  store.subscribe('wallet', (ch) => renderWallet(ch.source !== 'welcome', ch.source === 'local'));
  store.subscribe('xp', () => renderLevel());
  store.subscribe('inventory', (ch) => renderBarn(ch.source !== 'welcome', ch.source === 'local'));
  store.subscribe('barn', () => renderBarn(false));
  store.subscribe('name', renderFarmName);
  store.subscribe('players', (ch) => { renderPlayers(); renderHearts(ch.source !== 'welcome'); });
  store.subscribe('xp', () => renderDock());
  store.subscribe('coop', renderBuffs);
  store.subscribe('players', renderBuffs);
  store.subscribe('powerups', renderBuffs);

  // a language switch: the edge buttons and the dock re-label (the shell then calls refresh(), ui/index.js relocalize)
  onLang(() => {
    relabelEdge();
    minis.setAttribute('aria-label', t('hud.dock.minis'));
    pills.hearts.dataset.tip = t('hud.hearts.tip');
    for (const [key, btn] of dockBtns) {
      const name = key.slice(2);
      const d = [...DOCK_BUILTIN, ...MINI_BUILTIN].find((x) => x.name === name) ?? ui.panels.list().find((p) => p.name === name)?.dock;
      const lbl = btn.querySelector('.lbl');
      if (d && lbl) lbl.textContent = d.label;
    }
    for (const li of chips.values()) {
      const you = li.querySelector('.you');
      if (you) you.textContent = t('hud.you');
      const look = li.querySelector('.look-btn');
      if (look) { look.setAttribute('aria-label', t('settings.farm.look')); look.dataset.tip = t('hud.lookTip'); }
    }
    if (connState === 'asleep') conn.replaceChildren(h('span.spin', { 'aria-hidden': 'true' }), t('hud.conn.asleep'));
    else if (connState !== 'open') setConnection(connState);
  });

  // the sideways rows' wheel, drag and ‹ › (owner 2026-10-19), off the boot
  setTimeout(() => lazyImport('hscroll', () => import('./hscroll.js')).then((m) => m.default(), (err) => {
    if (!importFailed(err)) console.error('the sideways rows did not start', err);
  }), 1500);

  function refresh() {
    if (!store.state) return;
    renderLevel();
    renderFarmName();
    renderWallet(false);
    renderHearts(false);
    renderBarn(false);
    renderPlayers();
    renderDock();
    renderBuffs();
  }

  return {
    refresh,
    renderBuffs,
    setPeer(pid, isOnline) {
      online.set(pid, isOnline);
      if (store.state) renderPlayers();
    },
    isOnline: (pid) => pid === store.pid || online.get(pid) === true,
    setConnection,
    /** A quiet "Saving…" chip while predictions wait > 1.2 s for the server (main.js polls); null hides it. */
    setPending(p) {
      if (connState !== 'open' || okTimer && conn.classList.contains('ok')) return;
      if (!p) {
        if (conn.dataset.pending) { delete conn.dataset.pending; conn.className = 'conn'; conn.replaceChildren(); }
        return;
      }
      conn.dataset.pending = '1';
      conn.className = 'conn pending';
      conn.replaceChildren(h('span.spin', { 'aria-hidden': 'true' }), p.n > 1 ? tn('hud.conn.savingN', p.n) : t('hud.conn.saving'));
    },
    renderDock,
    get connection() { return connState; },
  };
}

const fmtClock = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// more buffs: fn(st, pid, now) -> items (1.0: ui/powerups.js adds the crates' power-ups when it loads)
const BUFF_SOURCES = new Set();
const BUFF_DRAW = new Set();
export function addBuffSource(fn) {
  BUFF_SOURCES.add(fn);
  for (const draw of BUFF_DRAW) draw();
}

/** The running buffs for a player: [{ cls, glyph, text, tip, name }] (Golden Hour, the high-five Spark). Pure. */
export function buffItems(st, pid, now) {
  const items = [];
  const g = st.farm.coop && st.farm.coop.golden;
  if (g && g.until > now) {
    items.push({ cls: 'golden', glyph: 'sun', name: t('hud.buff.golden'), text: t('hud.buff.goldenClock', { clock: fmtClock(g.until - now) }), tip: t('hud.buff.goldenTip') });
  }
  const me = st.players[pid];
  if (me && Number.isSafeInteger(me.spark) && me.spark > now) {
    items.push({ cls: 'spark', glyph: 'star', name: t('hud.buff.spark'), text: t('hud.buff.sparkClock', { clock: fmtClock(me.spark - now) }), tip: t('hud.buff.sparkTip') });
  }
  for (const f of BUFF_SOURCES) items.push(...f(st, pid, now));
  return items;
}

/** What the screen reader hears when the buffs change: one line per buff that starts or ends, never the ticks. Pure. */
export function buffAnnouncements(prevKeys, items, names = null) {
  if (prevKeys === null) return [];                      // the first render after a load is not news
  const now = new Set(items.map((i) => i.cls));
  const out = [];
  for (const i of items) if (!prevKeys.includes(i.cls)) out.push(t('hud.buff.started', { name: i.name, tip: i.tip }));
  for (const k of prevKeys) if (!now.has(k)) out.push(t('hud.buff.over', { name: names?.get(k) ?? (k === 'golden' ? t('hud.buff.golden') : t('hud.buff.spark')) }));
  return out;
}

/**
 * The farm's folded numbers (release 1.0 S1, M30): "Acorns 222 · Hearts 155 · Beauty 432 ★ 3/5" for the level card's
 * hover and the Farm book's You page (Hearts are this farmer's own; Beauty once the farm has it). Pure.
 */
export function statsLine(state, pid, now) {
  const me = state.players?.[pid];
  const parts = [t('dock.stat.acorns', { n: fmt(state.farm.wallet.acorns ?? 0) }), t('dock.stat.hearts', { n: fmt(me?.hearts ?? 0) })];
  try {
    if (BEAUTY.beautyLive(state)) {
      const b = BEAUTY.beautyOf(state, now);
      parts.push(t('dock.stat.beauty', { n: fmt(b.score), stars: b.stars, max: BEAUTY.starsFor(Infinity) }));
    }
  } catch { /* the beauty rules are not there in this build */ }
  return parts.join(' · ');
}

// verb -> catalog key ('dock.verb.*') of the hover card's "what a click does" line (release 1.0 S7, ux-first#16)
const VERB_LINE = Object.freeze({ harvest: 'harvest', water: 'water', tend: 'tend', feed: 'tend', collect: 'collect', collectTray: 'collect',
  pet: 'pet', pick: 'pick', chop: 'chop', fell: 'chop', sit: 'sit', stand: 'stand', fish: 'fish', ride: 'ride', openCrate: 'open',
  uproot: 'uproot', fertilize: 'spread', compost: 'spread', bottle: 'bottle', nurse: 'nurse', nursePick: 'nurse', openGift: 'open' });

// verb -> the target's state that makes it happen now (a tool's verb that does not check it itself)
const NEEDS_STATE = Object.freeze({
  harvest: (tg) => Boolean(tg.ready),
  pick: (tg) => Boolean(tg.ready),
  fell: (tg) => Boolean(tg.ready),
  collectTray: (tg) => Boolean(tg.trayReady),
  collect: (tg) => Boolean(tg.ready || tg.anyReady),
  tend: (tg) => Boolean(tg.ready || tg.hungry || tg.anyReady || tg.anyHungry),
  water: (tg) => tg.kind !== 'plot' || Boolean(tg.waterable),
});

/**
 * One state-and-verb line for a hover card (S7, ux-first#16): what a click with the tool in hand does there ("Click to
 * harvest", "Click to pull it up"), or that the Hand does it, or what opens. `seeding`: the Hand holds a seed (M2).
 * Pure.
 */
export function verbLine(state, pick, toolId, pid, now, { seeding = false, crop = null } = {}) {
  if (!pick) return null;
  if (pick.kind === 'tile' && pick.weed) return toolId === 'hand' ? t('dock.verb.weed') : t('dock.verb.useHand');
  if (pick.kind !== 'object' || !Object.hasOwn(state.farm.objects, pick.id)) return null;
  const tg = describe(state, pick.id, now, pid);
  if (!tg) return null;
  const v = verbsFor(toolId, tg)[0];
  // a surprise's card says its own call to action ("For you! Click to open it"): one "open" line, not two (QA r1 S-26)
  if (v === 'openGift') return null;
  // the Sickle, the Basket, the Can and the Scoop answer every plot / tree / pen with their verb: the line promises
  // the deed only when it happens now (QA r1 S-20: "Click to harvest" on an empty or a growing plot); the card's own
  // state line ("Ready in 42s", "Empty plot") already says the rest
  if (v && NEEDS_STATE[v] && !NEEDS_STATE[v](tg)) return null;
  if (v === 'plant') {
    if (toolId === 'hand' && !seeding) return t('dock.verb.pickSeed');
    return crop ? t('dock.verb.plant', { crop: N(crop) }) : t('dock.verb.pickSeed');
  }
  if (v === 'clear') return t(tg.def?.id === 'weed' ? 'dock.verb.weed' : 'dock.verb.clear');
  if (v && VERB_LINE[v]) return t(`dock.verb.${VERB_LINE[v]}`);
  // nothing for this tool: a panel the Hand opens, or the Hand's own deed
  const panel = OPENS[tg.def?.id] ?? OPENS[tg.kind];
  if (['hand', 'basket', 'feed_scoop', 'seed_bag'].includes(toolId) && panel && tg.kind !== 'plot') return t('dock.verb.open');
  const hv = toolId !== 'hand' ? verbsFor('hand', tg)[0] : null;
  return hv && hv !== 'plant' ? t('dock.verb.useHand') : null;
}

/**
 * The reconnecting chip's words (QA r1 S-30): "Reconnecting… your moves are kept" only while moves are still taken;
 * once the store stops taking them (`stale`: the oldest unanswered move is 30 s old) or 30 s after the drop, "Can't
 * reach the farm…". Pure.
 */
export const connKey = ({ stale = false, ms = 0 } = {}) => (stale || ms >= 30_000 ? 'hud.conn.asleep' : 'hud.conn.reconnecting');

/** Player slot -> the shape of their mark: farmer 1 a circle, farmer 2 a rounded square (never colour alone). */
export const slotOf = (pid) => (/^p[0-9]+$/.test(String(pid)) ? String(pid) : 'p1');

// ---- tooltips: [data-tip] on HUD controls (hover 400 ms / keyboard focus) and the world hover (250 ms) -----------
/** The world tooltip's lines for a pick (pure; tests): { title, icon, lines: [text], bar?: 0..1, by?: pid, ready? } */
export function worldTip(state, pick, now, me = null, { riding = null, seeding = null } = {}) {
  if (pick && pick.kind === 'tile' && pick.weed) return weedTip(state, now);
  if (pick && (pick.kind === 'pet' || typeof pick.pet === 'string')) return petTip(state, pick, now, me);
  if (!pick || pick.kind !== 'object' || !pick.id || !Object.hasOwn(state.farm.objects, pick.id)) return null;
  const o = state.farm.objects[pick.id];
  // a wrapped surprise on the porch (release 1.0 D1): for me, open it; for the partner, it waits for them
  const gdef = defOf(o.def);
  if (gdef && gdef.kind === 'gift') {
    const g = state.farm.gifts?.[pick.id] ?? null;
    const to = g ? state.players[g.to]?.name ?? t('common.partner') : t('common.partner');
    return { title: cname(o.def), icon: o.def, kind: 'gift', ready: Boolean(g && g.to === me),
      lines: [g && g.to === me ? t('dock.gift.forYou') : t('dock.gift.waiting', { name: to })] };
  }
  const def = defOfSafe(o.def);
  if (!def) return null;
  // a named animal (features#F4, release 1.0 M20): names live in farm.names (the name tag records who named it)
  const nm = state.farm.names?.[pick.id]?.name ?? o.name;
  const tip = { title: nm ? t('hud.tip.named', { name: nm, def: N(o.def) }) : cname(o.def), icon: o.def, lines: [] };
  // a balloon crate (wave 4b, wish 1): open it; nobody's: it goes to the Barn on its own after a while
  if (isCrateDef(def)) return crateTip(state, pick.id, now);
  if (def.kind === 'plot') {
    if (!o.crop) {
      // "(drag to plant a row)" only for a hand that holds a seed: the bare Hand's drag asks which seed first (QA r2 S-07)
      tip.title = t('hud.tip.emptyPlot'); tip.icon = 'plot'; tip.lines.push(seeding === false ? t('dock.tip.plantHere') : t('hud.tip.plantHere'));
      const sp = spreadLine(state, o, me, false, true);
      if (sp) tip.lines.push(sp);
      return tip;
    }
    const c = CONTENT.crops.get(o.crop.def);
    tip.title = c ? cname(o.crop.def) : o.crop.def;
    tip.icon = o.crop.def;
    const span = Math.max(1, o.crop.readyAt - o.crop.plantedAt);
    const left = o.crop.readyAt - now;
    tip.ready = left <= 0;
    tip.kind = 'plot';
    tip.lines.push(left <= 0 ? t('hud.tip.readyHarvest') : t('hud.tip.readyIn', { d: fmtDuration(left) }));
    // the blue pin over a crop means "needs water" (RD-15): the tooltip says who watered and what it saved
    const growMs = c ? c.growMs : 0;
    if (left > 0 && growMs >= GROWTH.water.minCropMs) tip.lines.push(waterLine(state, o.crop, me, GROWTH.water.cropBp));
    // a Giant (GDD §6.2 #8): its chops left and "quicker together"
    const giant = o.crop.giant !== undefined ? giantText(state, pick.id, now) : null;
    if (giant) tip.lines.push(giant);
    const sp = spreadLine(state, o, me, false, false);
    if (sp) tip.lines.push(sp);
    tip.bar = Math.max(0, Math.min(1, 1 - left / span));
    tip.by = o.crop.by;
    return tip;
  }
  if (Number.isSafeInteger(o.readyAt)) {
    const left = o.readyAt - now;
    tip.ready = left <= 0;
    if (def.kind === 'tree') {
      tip.kind = 'tree';
      // trees age a "year" a harvest (wave 4b, wish 4): "Apple Tree · 7 years"
      const sapling = Number.isSafeInteger(o.matureAt) && o.matureAt > now;
      tip.title = ageLine(tip.title, treeAgeOf(o), sapling);
    }
    tip.lines.push(left <= 0 ? t('hud.tip.ready') : t('hud.tip.readyIn', { d: fmtDuration(left) }));
    if (def.kind === 'tree' && !(Number.isSafeInteger(o.matureAt) && o.matureAt > now)) {
      const a = treeStageOf(treeAgeOf(o));
      // the stage's own name ("Old", "Ancient") is lane D's (panels/w4b-rules.js); the sentence around it is here
      if (a.stage.bonus > 0 || a.index > 0) {
        tip.lines.push(a.stage.bonus > 0 ? tn('hud.tip.treeStageBonus', a.stage.bonus, { stage: a.stage.name }) : t('hud.tip.treeStage', { stage: a.stage.name }));
      }
    }
    if (def.kind === 'tree' && left > 0) tip.lines.push(waterLine(state, o, me, GROWTH.water.treeBp));
    if (def.kind === 'tree') { const sp = spreadLine(state, o, me, true, false); if (sp) tip.lines.push(sp); }
  }
  // a hungry animal says so, and whether its feed is in the Barn (QA r3 S3-13, jde#7: a hungry cow read only "Cow · Click
  // to feed and collect" while the farm had no Livestock Feed; S7: a state-and-verb line)
  if (def.kind === 'animal') {
    const tg = describe(state, pick.id, now, me);
    if (tg?.hungry) {
      const feed = def.feed;
      const have = !feed || (state.farm.inventory?.[feed] ?? 0) + (state.farm.overflow?.[feed] ?? 0) >= (def.feedQty ?? 1);
      tip.lines.push(have ? t('dock.tip.hungry') : t('dock.tip.hungryNoFeed', { feed: N(feed) }));
    }
  }
  // benches: who sits and what a click does, for THIS viewer (CL-01); it replaces the decor text
  const seat = me ? seatText(state, pick.id, me) : null;
  if (seat) tip.lines.push(seat);
  // a horse: how to ride it (the Hand or V), or why not now
  const ride = me ? rideText(state, pick.id, me, { now, riding: riding !== null && riding === pick.id }) : null;
  if (ride) tip.lines.push(ride);
  // a Fishing Dock: the Hand sits and casts, when the hour's rest ends, the partner fishing now (client's dockText)
  const dock = me && !ride ? dockText(state, pick.id, me, now) : null;
  if (dock) tip.lines.push(dock);
  else if (!ride && def.text && tip.lines.length === 0) {
    const text = String(ctext(null, o.def, 'desc', def.text));
    tip.lines.push(text.length > 90 ? `${text.slice(0, 88)}…` : text);
  }
  // the farmhouse, the Well, the Market Stand and the benches: their upgrade tier (wave 4, wish E)
  const up = upgradeLine(o);
  if (up) tip.lines.push(up);
  // a home with a pair expecting (wave 5, babies in the pen): both farmers see the baby coming
  if (def.kind === 'home') {
    const pair = pairTipLine(state, pick.id, now);
    if (pair) tip.lines.push(pair);
  }
  if (o.by && o.by !== 'sys') tip.by = o.by;
  return tip;
}

/**
 * A pet's world card (wave 5, the dog's "Stay home"): its name, whose it is, and where it is: following its farmer,
 * staying at its doghouse, asleep. Pure. { title, face: { kind, breed }, lines, kind: 'pet', owner, mine, stay }
 */
export function petTip(state, pick, now, me = null) {
  const owner = pick.owner ?? pick.pet;
  const p = typeof owner === 'string' && Object.hasOwn(state.players ?? {}, owner) ? state.players[owner] : null;
  const pet = p ? petOf(state, owner) : null;
  if (!pet) return null;
  const mine = owner === me;
  const breed = breedOf(pet);
  const stay = stayOf(pet);
  const what = breed ? breedName(pet.kind, breed) : t('home.pets.petWord');
  const lines = [t(mine ? 'home.pets.yours' : 'home.pets.theirs', { owner: p.name, what })];
  if (pick.asleep) lines.push(t('hud.pet.asleep'));
  else if (stay) lines.push(stayLine(state, owner));
  else lines.push(mine ? t('hud.pet.followsYou') : t('hud.pet.follows', { name: p.name }));
  return { title: pet.name, icon: null, face: { kind: pet.kind, breed }, lines, kind: 'pet', owner, mine, stay };
}

/**
 * "Fertilizer by Mia · 25 % sooner · +2 at harvest" or "Compost · +1 at harvest" on a plot or a tree (wave 4, wish 2: the
 * game says "Fertilizer" everywhere). `empty`: a plot waiting for its planting. Pure.
 */
export function spreadLine(state, o, me, tree, empty) {
  const F = FARMING.FERTILIZER;
  // the rules keep it on the crop (`crop.fert`, who spread it) or on the plot / tree itself
  const fert = o.crop?.fert ?? o.fert;
  if (fert !== undefined && fert !== false && F) {
    const who = typeof fert === 'string' && Object.hasOwn(state.players, fert) ? (fert === me ? t('hud.tip.byYou') : state.players[fert].name) : null;
    const pct = Math.round((tree ? F.treeTimeBp ?? F.timeBp : F.timeBp) / 100);
    const units = tree ? F.treeBonusUnits ?? F.bonusUnits : F.bonusUnits;
    const k = empty ? 'hud.tip.fertNext' : 'hud.tip.fert';
    return who ? t(`${k}By`, { who, pct, units }) : t(k, { pct, units });
  }
  if (o.compost) return t('hud.tip.compost', { units: tree ? GROWTH.compost.treeBonusUnits : GROWTH.compost.bonusUnits });
  return null;
}

/** Wild weeds on our own land (wave 4, wish F): the Hand pulls them for good, a few coins for the first ones a day. */
/** A balloon crate's tooltip (wave 4b, wish 1). Pure. */
export function crateTip(state, id, now) {
  const c = crateOf(state, id);
  const left = c && Number.isSafeInteger(c.until) ? c.until - now : null;
  return { title: t('hud.crate.title'), icon: 'loot_crate', kind: 'crate', ready: true,
    lines: [touchPlayer() ? t('hud.crate.tap') : t('hud.crate.click'),
      left !== null && left > 0 ? t('hud.crate.left', { d: fmtDuration(left) }) : t('hud.crate.either')] };
}

export function weedTip(state, now) {
  const W = WEEDS.WEEDS ?? { coins: 0 };
  const left = typeof WEEDS.weedPayLeft === 'function' ? WEEDS.weedPayLeft(state, now) : 0;
  return { title: t('hud.weeds.title'), icon: 'weed', kind: 'weed', lines: [t('hud.weeds.hand'),
    W.coins > 0 && left > 0 ? t('hud.weeds.pay', { coins: W.coins, left }) : t('hud.weeds.none')] };
}

/** "Upgrades ★1 of 3: Stone Rim" for an upgradable object (rules' upgrade table), else null. Pure. */
export function upgradeLine(o) {
  const target = typeof UPG.upgradeTargetOf === 'function' ? UPG.upgradeTargetOf(o.def) : null;
  const tiers = target ? UPG.UPGRADES?.[target]?.tiers : null;
  if (!Array.isArray(tiers) || !tiers.length) return null;
  const n = typeof UPG.tierOf === 'function' ? UPG.tierOf(o) : 0;
  // the tier's own name is the rules' content (lane B: shared/rules/upgrades.js through ctext('upgrades', ...))
  const tier = n ? ctext('upgrades', `${target}.${n}`, 'name', tiers[n - 1]?.name ?? '') : '';
  return n ? t('hud.tip.upgrades', { n, of: tiers.length, tier }).trim() : t('hud.tip.upgradesNone', { of: tiers.length });
}

/** "Watered by Mia · -15 % · tended by you · -5 %", or "Needs water (-15 %)". `rec` is a crop or tree record;
 * 'sys' is the rain or a Sprinkler at planting. */
function waterLine(state, rec, me, bp) {
  const who = (pid) => (pid === me ? t('hud.tip.byYou') : state.players[pid]?.name || t('hud.tip.yourPartner'));
  const pct = (b) => Math.round(b / 100);
  if (rec.water === undefined) return t('hud.tip.needsWater', { pct: pct(bp) });
  const tend = rec.tend !== undefined ? t('hud.tip.tended', { who: who(rec.tend), pct: pct(COOP.partnerTend.bp) }) : '';
  return rec.water === 'sys' ? t('hud.tip.watered', { pct: pct(bp), tend }) : t('hud.tip.wateredBy', { who: who(rec.water), pct: pct(bp), tend });
}

function defOfSafe(id) {
  for (const fam of ['plots', 'trees', 'animals', 'homes', 'buildings', 'decor', 'landmarks', 'debris']) {
    const d = CONTENT[fam] && CONTENT[fam].get(id);
    if (d) return d;
  }
  return null;
}


export function createTips(S) {
  const tip = document.getElementById('tip');
  let hudT = 0;
  let hudEl = null;
  let worldT = 0;
  let worldPick = null;
  let worldTimer = 0;
  let mouse = { x: 0, y: 0 };
  let pull = null;          // { id, el }: the long-press card's "Pull it up" button on a touch layout (mobile wave)
  let fin = null;           // { id, el, ... }: a growing crop's "Finish now" buttons (the same nodes on every refresh)
  let fert = null;          // { id, el, btn, why, label, sub }: its "Spread Fertilizer" button (wave 4, wish 2)
  // a mouse click with the Hand on a growing crop pins its card where it was clicked (live requests 2026-10-04): the
  // pointer can travel to the card's buttons; another click, Esc, a panel or a pointer gone far puts it away
  let pin = null;           // { id, x, y }
  // a card holding a button stays where the long press left it: the finger that comes to tap it must not drag it away
  const pinned = (e) => !tip.hidden && tip.contains(e.target);
  window.addEventListener('pointermove', (e) => {
    if (pinned(e)) return;
    mouse = { x: e.clientX, y: e.clientY };
    if (pin) {
      const r = tip.getBoundingClientRect();
      const far = Math.max(r.left - mouse.x, mouse.x - r.right, r.top - mouse.y, mouse.y - r.bottom);
      if (tip.hidden || far > 170) tooltip(null, { force: true });
      return;
    }
    if (worldPick && !tip.hidden && !hudEl) placeAt(mouse.x, mouse.y - 16);
  }, { passive: true });
  // a finger's first pointermove comes after its pointerdown (a held finger may send none): the long-press card shows
  // where the finger is. A touch card outlives the finger (pointerleave below): the next touch off it puts it away
  window.addEventListener('pointerdown', (e) => {
    if (pinned(e)) return;
    mouse = { x: e.clientX, y: e.clientY };
    if (pin) tooltip(null, { force: true });
    else if (e.pointerType === 'touch' && worldPick) tooltip(null);
  }, { capture: true, passive: true });
  // registered before the panels' keys (ui.init): Esc puts a pinned card away first
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pin) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    tooltip(null, { force: true });
  }, true);

  function placeAt(x, y, below = false) {
    const r = tip.getBoundingClientRect();
    let left = Math.round(x - r.width / 2);
    left = Math.max(8, Math.min(innerWidth - r.width - 8, left));
    let top = below ? y + 12 : y - r.height - 12;
    let flip = below;
    if (top < 8) { top = y + 26; flip = true; }
    if (top + r.height > innerHeight - 8) { top = y - r.height - 12; flip = false; }
    tip.classList.toggle('below', flip);
    tip.style.setProperty('--tail-x', `${Math.max(14, Math.min(r.width - 14, x - left))}px`);
    tip.style.transform = `translate3d(${left}px, ${Math.round(top)}px, 0)`;
  }
  function hide() { tip.hidden = true; tip.replaceChildren(); tip.className = 'tip'; pull = null; fin = null; fert = null; pin = null; }
  // the level-up celebration (life-feel's body.celebrating) puts the world card away: it covered the star's number and
  // "Level up!" for the whole celebration when a stroke ended on the field (QA r1 S-22); the next hover brings it back
  let partyPick = null;      // the card the celebration put away: it comes back on the next pointer move after it
  if (typeof MutationObserver === 'function' && document.body) {
    let was = false;
    new MutationObserver(() => {
      const now = document.body.classList.contains('celebrating');
      if (now && !was && worldPick && !hudEl && !pin) { partyPick = worldPick; worldPick = null; clearTimeout(worldT); clearInterval(worldTimer); hide(); }
      was = now;
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('pointermove', () => {
    if (!partyPick || document.body.classList.contains('celebrating')) return;
    const p = partyPick;
    partyPick = null;
    if (!worldPick) tooltip(p);
  }, { passive: true });

  /** A phone has no Shift: a growing crop's long-press card offers to pull it up (the same node on every refresh). */
  function pullButton(pick) {
    if (S.controller?.input !== 'touch' || !S.controller?.canUproot?.(pick.id)) return null;
    if (pull && pull.id === pick.id) return pull.el;
    const id = pick.id;
    // a text button at the bottom: it is the card's rare choice, never the big red thing under the thumb (S9a)
    const el = h('button.tip-act.tip-pull', { type: 'button', on: { click: (e) => {
      e.stopPropagation();
      S.controller.uproot(id);
      worldPick = null;
      clearInterval(worldTimer);
      hide();
    } } }, t('hud.tip.pull'));
    pull = { id, el };
    return el;
  }

  /**
   * "Finish now · 3" and "Finish all growing Strawberries · 6 plots · 6" on a growing crop's card (the rules' hurry,
   * live requests 2026-10-04). Where the card can be acted on (a touch card, a clicked card) they are buttons, built
   * once per plot and refreshed in place; a mouse that only hovers is told a click offers them.
   */
  function finishRow(pick, wt, actionable) {
    if (wt.ready) return null;
    const st = S.store.state;
    const now = S.store.now();
    const m = hurryOf(st, pick.id, wt, now);
    if (!m) return null;
    if (!actionable) {
      if (m.code === 'LOCKED' || S.controller?.tool?.id !== 'hand') return null;
      // the Smart Hand waters a thirsty crop first (free, and it grows faster): then the next click offers Finish now
      const thirsty = probe({ state: st, pid: S.store.pid, now: () => now }, 'water', { id: pick.id }) === null;
      return h('div.s.tip-finish-hint', svgIcon('acorn', 16),
        thirsty ? t('hud.finish.waterHint', { n: m.acorns }) : t('hud.finish.hint', { n: m.acorns }));
    }
    if (!fin || fin.id !== pick.id) fin = buildFinish(pick.id);
    const wallet = st.farm.wallet.acorns;
    const off = (code) => !(code === null || SOFT.has(code));
    const one = off(m.code) ? hurryReason(m.code, { acorns: m.acorns, wallet }) : '';
    fin.oneLabel.textContent = t('hud.finish.now', { n: m.acorns });
    setOff(fin.one, one, fin.oneWhy);
    fin.one.setAttribute('aria-label', tn('hud.finish.nowLabel', m.acorns));
    // a fruit tree finishes on its own: no "Finish all" row
    if (wt.kind === 'tree') { fin.all.hidden = true; fin.allWhy.hidden = true; fin.crop = null; return fin.el; }
    const f = fieldHurry(st, m.crop, now, S.store.pid);
    fin.crop = m.crop;
    const many = f.plots > 1;
    fin.all.hidden = !many;
    fin.allWhy.hidden = true;
    if (many) {
      fin.allLabel.textContent = t('hud.finish.all', { crop: N(m.crop) });
      fin.allSub.textContent = tn('hud.finish.allSub', f.plots, { acorns: f.acorns });
      fin.all.setAttribute('aria-label', fieldLabel(f));
      setOff(fin.all, off(f.code) ? hurryReason(f.code, f) : '', fin.allWhy);
    }
    return fin.el;
  }
  /**
   * "Spread Fertilizer · 25 % sooner, +2" on a growing crop's card (wave 4, wish 2: the Compost Bin's Fertilizer, named
   * so everywhere). Only where the card can be acted on, only while the rules would take it (one Compost or Fertilizer a
   * cycle); without Fertilizer in the barn it says where it comes from.
   */
  function fertRow(pick, wt, actionable) {
    if (!actionable || wt.kind !== 'plot' || wt.ready) return null;
    const st = S.store.state;
    const F = FARMING.FERTILIZER;
    if (!F || typeof FARMING.fertilizerLive !== 'function' || !FARMING.fertilizerLive(st)) return null;
    const o = st.farm.objects[pick.id];
    if (!o || o.fert !== undefined || o.crop?.fert !== undefined || o.compost) return null;
    const code = probe({ state: st, pid: S.store.pid, now: () => S.store.now() }, 'fertilize', { id: pick.id });
    if (code !== null && code !== 'NO_ITEMS' && !SOFT.has(code)) return null;
    if (!fert || fert.id !== pick.id) fert = buildFert(pick.id);
    const have = (st.farm.inventory[F.item] ?? 0) + (st.farm.overflow[F.item] ?? 0);
    fert.label.textContent = t('hud.fert.spread');
    fert.sub.textContent = have ? t('hud.fert.subHave', { pct: Math.round(F.timeBp / 100), units: F.bonusUnits, have })
      : t('hud.fert.sub', { pct: Math.round(F.timeBp / 100), units: F.bonusUnits });
    const r = CONTENT.recipes?.get?.(F.item);
    // "2 Compost + 1 Manure": each input as a sentence says it ("2 кофи компост")
    const how = r && r.inputs ? Object.entries(r.inputs).map(([k, n]) => (CONTENT.items.get(k) ? t('hud.fert.input', { q: Q(k, n) }) : `${n} ${k}`)).join(' + ') : null;
    setOff(fert.btn, code === 'NO_ITEMS' ? (how ? t('hud.fert.makeHow', { how }) : t('hud.fert.make')) : '', fert.why);
    return fert.el;
  }
  function buildFert(id) {
    const label = h('span');
    const sub = h('small.tip-finish-sub');
    const btn = h('button.btn.btn--paper.btn--small.tip-fert-btn', { type: 'button' }, icon('fertilizer', { size: 22 }), h('span.tip-fert-text', label, sub));
    const why = h('div.tip-why', { hidden: true });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.getAttribute('aria-disabled') === 'true') return;
      tooltip(null, { force: true });
      S.controller.do('fertilize', { id });
    });
    return { id, btn, why, label, sub, el: h('div.tip-finish.tip-fert', btn, why) };
  }

  /** What "Finish now" would do on a growing plot or fruit tree (owner 2026-10-05: trees too), or null. */
  function hurryOf(st, id, t, now) {
    if (t.kind === 'plot') return plotHurry(st, id, now, S.store.pid);
    if (t.kind === 'tree') return treeHurry(st, id, now, S.store.pid);
    return null;
  }

  function setOff(btn, why, whyEl) {
    if (why) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    whyEl.textContent = why;
    whyEl.hidden = !why;
  }
  function buildFinish(id) {
    const press = (btn, fn) => (e) => {
      e.stopPropagation();
      if (btn.getAttribute('aria-disabled') === 'true') return;
      fn();
    };
    const oneLabel = h('span');
    const allLabel = h('span.tip-finish-main');
    const allSub = h('span');
    const one = h('button.btn.btn--sun.btn--small.tip-finish-one', { type: 'button' }, oneLabel, svgIcon('acorn', 20));
    // two lines: what it does, then how many plots and Acorns (one line wrapped "10 / plots · 10")
    const all = h('button.btn.btn--paper.btn--small.tip-finish-all', { type: 'button' }, allLabel,
      h('small.tip-finish-sub', allSub, svgIcon('acorn', 16)));
    const oneWhy = h('div.tip-why', { hidden: true });
    const allWhy = h('div.tip-why', { hidden: true });
    // a phone asks first (S9a, ux-phone#14): one "Finish ▸" that unfolds the two Acorn buttons on a tap
    const fold = h('button.btn.btn--paper.btn--small.tip-finish-fold', { type: 'button', on: { click: (e) => {
      e.stopPropagation();
      f.el.classList.add('open');
      one.focus?.({ preventScroll: true });
    } } }, h('span', t('dock.finish.fold')), svgIcon('acorn', 18), h('span', { 'aria-hidden': 'true' }, ' ▸'));
    const f = { id, one, all, oneWhy, allWhy, oneLabel, allLabel, allSub, crop: null,
      el: h(`div.tip-finish${S.controller?.input === 'touch' ? '.folds' : ''}`, fold, one, oneWhy, all, allWhy) };
    // the rules decide: a BIG_SPEND opens the "are you sure?" card (it re-sends on yes), a refusal shakes the plot
    one.addEventListener('click', press(one, () => { tooltip(null, { force: true }); S.controller.do('hurry', { id }); }));
    all.addEventListener('click', press(all, () => {
      const crop = f.crop;
      tooltip(null, { force: true });
      if (crop) finishField(S, crop);
    }));
    return f;
  }

  // HUD [data-tip]
  const show = (el) => {
    pin = null;
    const text = el.dataset.tip;
    if (!text || el.closest('[hidden]')) return;
    hudEl = el;
    tip.className = 'tip';
    // a tip put together in code says its touch words itself (data-tip-touch); a catalog line has them in its catalog
    const touch = touchPlayer(S.controller);
    tip.replaceChildren(touch && el.dataset.tipTouch ? el.dataset.tipTouch : touchText(text, touch));
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const below = r.top < 90;
    placeAt(r.left + r.width / 2, below ? r.bottom : r.top, below);
  };
  let quietUntil = 0;
  let armed = null;              // the button whose 400 ms timer runs: leaving it cancels the tip (QA r4 S4-02)
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el === armed) return;
    clearTimeout(hudT);
    armed = null;
    if (el === hudEl || performance.now() < quietUntil) return;
    if (hudEl) { hudEl = null; hide(); }
    if (el) { armed = el; hudT = setTimeout(() => { armed = null; if (el.matches(':hover')) show(el); }, 400); }
  });
  // a click is an answer: no tooltip pops up over what was just pressed (the toolbar re-renders under the cursor)
  document.addEventListener('pointerdown', () => { clearTimeout(hudT); armed = null; quietUntil = performance.now() + 1200; if (hudEl) { hudEl = null; hide(); } }, true);
  // a finger has no hover: a press held on a pill, the level star or a farmer shows its tip (mobile QA P3)
  let press = null;
  let downAt = -Infinity;           // the finger's own time of the last touch press (event timeStamp)
  const PRESS_MS = 480;
  const unpress = () => { if (press) { clearTimeout(press.t); press = null; } };
  document.addEventListener('pointerdown', (e) => {
    unpress();
    downAt = e.timeStamp;
    const el = e.pointerType === 'touch' && e.target.closest ? e.target.closest('#hud [data-tip]') : null;
    if (el) press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { press = null; quietUntil = 0; show(el); held = { el, until: performance.now() + 2500 }; }, PRESS_MS) };
  }, { capture: true, passive: true });
  // the press was for reading: the click a browser may still send on lifting it does not open the pill's panel
  let held = null;
  document.addEventListener('click', (e) => {
    const hd = held;
    held = null;
    if (hd && performance.now() < hd.until && hd.el.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // the timer runs on the page's clock: a busy phone (a long frame) can fire it before it handles a quick tap's lift.
  // The finger's own times decide: a lift sooner than PRESS_MS after the press was a tap, so its click opens the menu
  // (or the pill's panel) and the tip that popped up early goes away
  document.addEventListener('pointerup', (e) => {
    if (!held || e.pointerType !== 'touch' || e.timeStamp - downAt >= PRESS_MS) return;
    if (hudEl === held.el) { hudEl = null; hide(); }
    held = null;
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) unpress(); }, { passive: true });
  document.addEventListener('pointerup', unpress, { passive: true });
  document.addEventListener('pointercancel', unpress, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', () => { if (hudEl) { hudEl = null; hide(); } });

  // world hover (ui.tooltip): 250 ms after the pick settles, refreshed every second while shown
  function renderWorld() {
    if (!worldPick || hudEl || !S.store.state) return;
    const ct0 = S.controller?.tool ?? {};
    const t = worldTip(S.store.state, worldPick, S.store.now(), S.store.pid, { riding: S.controller?.riding ?? null,
      seeding: Boolean(ct0.seeding) || ct0.id === 'seed_bag' });
    if (!t) { hide(); return; }
    if (t.kind === 'pet') { renderPet(t); return; }
    const p = t.by && S.store.state.players[t.by];
    const act = infoOnly ? null : pullButton(worldPick);
    if (!act) pull = null;
    const touch = S.controller?.input === 'touch';
    const finish = infoOnly ? null : finishRow(worldPick, t, touch || Boolean(pin && pin.id === worldPick.id));
    if (!finish || finish.classList.contains('tip-finish-hint')) fin = null;
    const fertEl = infoOnly ? null : fertRow(worldPick, t, touch || Boolean(pin && pin.id === worldPick.id));
    if (!fertEl) fert = null;
    const acts = Boolean(act) || Boolean(fertEl) || Boolean(finish && finish.classList.contains('tip-finish'));
    const ct = S.controller?.tool ?? {};
    const verb = verbLine(S.store.state, worldPick, ct.id ?? 'hand', S.store.pid, S.store.now(), { seeding: Boolean(ct.seeding) || ct.id === 'seed_bag', crop: ct.crop });
    tip.className = 'tip wtip';
    tip.replaceChildren(...[
      h('div.t', t.icon ? icon(t.icon, { size: 32 }) : null, t.title),
      ...t.lines.map((l) => h(`div.s${t.ready ? '.ready' : ''}`, l)),
      verb ? h('div.s.verb', touchText(verb, touch)) : null,
      Number.isFinite(t.bar) && !t.ready ? h('div.mini', h('i', { style: { width: `${Math.round(t.bar * 100)}%` } })) : null,
      p ? h('div.by', playerMark(t.by, p), tt(t.kind === 'plot' ? 'hud.tip.plantedBy' : 'hud.tip.placedBy', { who: t.by === S.store.pid ? tt('hud.tip.byYou') : p.name })) : null,
      finish,
      fertEl,
      act,
    ].filter(Boolean));
    tip.classList.toggle('has-act', acts);
    tip.classList.toggle('pinned', Boolean(pin));
    tip.hidden = false;
    if (pin) placeAt(pin.x, pin.y - 16);
    else placeAt(mouse.x, mouse.y - 16);
  }
  /**
   * A pet's card (wave 5): its face, whose it is, where it is; on my own pet, where the card can be acted on (a touch
   * card, a clicked card), "Stay home" / "Come with me" (the rules' petStay; built once per pet, refreshed in place).
   */
  let stayBtn = null;       // { owner, el, label }
  function renderPet(pt) {
    const actionable = S.controller?.input === 'touch' || Boolean(pin && pin.id === pickKey(worldPick));
    const btn = (pt.mine || stayForOthers()) && actionable && can5('petStay') ? stayButton(pt) : null;
    if (!btn) stayBtn = null;
    tip.className = 'tip wtip wtip-pet';
    tip.replaceChildren(...[
      h('div.t', h('span.tip-pet-face', petFace(pt.face.kind, pt.face.breed, { size: 34 })), pt.title),
      ...pt.lines.map((l) => h('div.s', l)),
      btn,
    ].filter(Boolean));
    tip.classList.toggle('has-act', Boolean(btn));
    tip.classList.toggle('pinned', Boolean(pin));
    tip.hidden = false;
    if (pin) placeAt(pin.x, pin.y - 16);
    else placeAt(mouse.x, mouse.y - 16);
  }
  function stayButton(pt) {
    if (!stayBtn || stayBtn.owner !== pt.owner) {
      const label = h('span');
      const el = h('button.btn.btn--paper.btn--small.tip-act.tip-stay', { type: 'button' }, label);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const st = S.store.state;
        const owner = stayBtn?.owner ?? S.store.pid;
        const it = stayIntent(!stayOf(petOf(st, owner)), owner, S.store.pid);
        tooltip(null, { force: true });
        S.controller?.do?.(it.type, it.args);
      });
      stayBtn = { owner: pt.owner, el, label };
    }
    stayBtn.label.textContent = pt.stay ? tt('home.pets.come') : tt('home.pets.stay');
    stayBtn.el.dataset.stay = pt.stay ? 'come' : 'stay';
    return stayBtn.el;
  }

  /**
   * The world card for a pick (null hides it). A pick with `card: true` (the Hand clicked a growing crop) pins a mouse
   * player's card with its buttons; while pinned, hovers elsewhere leave it alone until `force` (a click elsewhere,
   * Esc, a panel opening, the pointer gone far).
   */
  /**
   * A wild tuft says what the Hand does with it (wave 4, wish F) while the Hand is in hand, until this farmer has pulled
   * some: weeds cover the fields, so it never becomes a tooltip that follows the mouse all evening.
   */
  const weedsKey = () => `hh.weeds.${S.store.pid}`;
  let weedsKnown = null;
  const weedHint = (p) => {
    if (!p || p.kind !== 'tile' || !p.weed || S.controller?.tool?.id !== 'hand') return false;
    if (weedsKnown === null) weedsKnown = Boolean(kv.get(weedsKey(), false));
    return !weedsKnown;
  };
  S.store.on?.('fx', ({ ev, by }) => {
    if (ev?.e === 'weedsCleared' && by === S.store.pid && !weedsKnown) { weedsKnown = true; kv.set(weedsKey(), true); }
  });
  const isPet = (p) => Boolean(p) && (p.kind === 'pet' || typeof p.pet === 'string');
  const pickKey = (p) => (p.kind === 'object' ? p.id : isPet(p) ? `pet:${p.owner ?? p.pet}` : `t${p.x},${p.z}`);

  // a tap on a growing crop on a phone shows the information half of its card for 2 s (S9a, ux-phone#14); the long
  // press shows the whole card with its buttons
  let infoOnly = false;
  let infoT = 0;
  function tooltip(pick, { force = false } = {}) {
    if (pin && !force) return;
    clearTimeout(worldT);
    clearInterval(worldTimer);
    clearTimeout(infoT);
    infoOnly = Boolean(pick && pick.card && S.controller?.input === 'touch' && pick.kind === 'object');
    if (infoOnly) infoT = setTimeout(() => { if (infoOnly) tooltip(null, { force: true }); }, 2000);
    if (force && pin) { pin = null; worldPick = null; hide(); }
    const same = pick && worldPick && pickKey(pick) === pickKey(worldPick);
    worldPick = pick && (pick.kind === 'object' || isPet(pick) || weedHint(pick)) ? pick : null;
    if (!worldPick) { if (!hudEl) hide(); return; }
    // the Hand clicked my own pet (wave 5): its card stays where it was clicked, with "Stay home" / "Come with me"
    if (pick.card && isPet(pick) && S.controller?.input !== 'touch' && !hudEl) {
      pin = { id: pickKey(pick), x: mouse.x, y: mouse.y };
      renderWorld();
      worldTimer = setInterval(renderWorld, 1000);
      return;
    }
    if (pick.card && S.controller?.input !== 'touch' && !hudEl) {
      // a card that offers nothing to press is not pinned: it is the plain tooltip
      const t = S.store.state ? worldTip(S.store.state, worldPick, S.store.now(), S.store.pid) : null;
      if (t && !t.ready && hurryOf(S.store.state, worldPick.id, t, S.store.now())) {
        pin = { id: worldPick.id, x: mouse.x, y: mouse.y };
        renderWorld();
        worldTimer = setInterval(renderWorld, 1000);
        return;
      }
    }
    if (same && !tip.hidden) { renderWorld(); worldTimer = setInterval(renderWorld, 1000); return; }
    if (!hudEl) hide();
    worldT = setTimeout(() => { renderWorld(); worldTimer = setInterval(renderWorld, 1000); }, 250);
  }
  // a lifted finger "leaves" the canvas too: the card of a tap or a long press (the finger stayed put) stays up until
  // the next touch; after a stroke or a pan it goes with the finger
  const fingers = new Map();      // pointerId -> { x, y, far }
  const world = document.getElementById('world');
  world.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, far: false }); });
  world.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId);
    if (f && !f.far && Math.hypot(e.clientX - f.x, e.clientY - f.y) > 24) f.far = true;
  }, { passive: true });
  world.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch') { tooltip(null); return; }
    const f = fingers.get(e.pointerId);
    fingers.delete(e.pointerId);
    if (!f || f.far || fingers.size) tooltip(null);
  });
  world.addEventListener('pointercancel', (e) => { fingers.delete(e.pointerId); });
  world.addEventListener('pointerdown', () => { clearTimeout(worldT); clearInterval(worldTimer); if (!hudEl) hide(); });
  return { tooltip, hide };
}
