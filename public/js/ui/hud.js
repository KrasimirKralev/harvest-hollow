// HUD (GDD §7.3, visual-ux-juice §5.5): level star + XP bar, farm name, both farmers' portraits with online dot,
// colour ring and title, the currency pills (coins, acorns, hearts, barn N / cap), the right-edge view buttons, the
// bottom-right dock (Build | Market | Barn + Orders / Journal) and the connection chip. ui-shell lane.
//
// Reads the store by topic only: wallet, xp, inventory (+overflow), players, name, barn, '*'. Panel links go through
// the registry by name, so a panel that ui-panels has not registered yet leaves its button inert, never broken.
import {
  CONTENT, levelFromXp, xpForLevel, unlocksAt, personalLevelFromXp, titleFor, GROWTH, COOP, pluralOf,
} from '../../../shared/content/index.js';
import { seatText, giantText, rideText, dockText } from '../game/targets.js';
import { barnCap, stockOf, overflowOf } from '../../../shared/rules/economy.js';
import { h, icon, svgIcon, fmt, fmtShort, rollNumber, playerVars, playerMark, GLYPH_NAMES, touchText, touchPlayer, kv } from './dom.js';
import { hasIcon } from '../render/icons.js';
import { portraitSpec, portraitKey, peekPortrait } from '../render/portrait.js';
import { plotHurry, treeHurry, fieldHurry, hurryReason, finishField, fieldLabel } from './crop-hurry.js';
import { probe } from './panels/core.js';
import { SOFT } from '../../../shared/net/protocol.js';
import * as FARMING from '../../../shared/rules/actions/farming.js';
import * as UPG from '../../../shared/rules/upgrades.js';
import * as WEEDS from '../../../shared/rules/actions/weeds.js';
import { isCrateDef, crateOf, treeAgeOf, treeStageOf, ageLine } from './panels/w4b-rules.js';
import { t, t as tt, tn, onLang, name as cname, N, Q, ctext, fmtDuration } from '../i18n/index.js';

const $ = (id) => document.getElementById(id);

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
const DOCK_BUILTIN = [
  dockItem({ name: 'build', icon: 'hammer', order: 10, hotkey: 'B' }, 'hud.dock.build'),
  dockItem({ name: 'market', icon: 'market_stand', order: 20, hotkey: 'M' }, 'hud.dock.market'),
  dockItem({ name: 'barn', icon: 'barn', order: 30, hotkey: 'I' }, 'hud.dock.barn'),
];
const MINI_BUILTIN = [
  dockItem({ name: 'orders', icon: 'order_board', glyph: 'orders', order: 40, hotkey: 'O' }, 'hud.dock.orders'),
  dockItem({ name: 'journal', glyph: 'journal', order: 50, hotkey: 'J' }, 'hud.dock.journal'),
];

function pictogram(iconId, glyph, size) {
  if (iconId && hasIcon(iconId)) return icon(iconId, { size });
  if (iconId && GLYPH_NAMES.includes(iconId)) return svgIcon(iconId, size);
  if (glyph) return svgIcon(glyph, size);
  return iconId ? icon(iconId, { size }) : svgIcon('star', size);
}

export function createHud(S) {
  const { store, view, controller, ui } = S;
  const online = new Map();
  let lastLevel = null;
  let lastXp = null;

  // ---- level star + XP -------------------------------------------------------------------------------------
  const star = $('hud-level-star');
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
    // label is a grid, and a bare text node beside the unit would become a second grid row
    $('hud-xp-text').replaceChildren(h('span', `${fmtShort(xp - from)} / ${fmtShort(span)}`, h('span.xp-unit', t('hud.xp.unit'))));
    const next = nextUnlocks(level);
    star.dataset.tip = next.length
      ? t('hud.level.tipNext', { level, next: next.map((u) => t('hud.level.unlockAt', { name: u.name, level: u.level })).join(', ') })
      : t('hud.level.tip', { level });
    star.setAttribute('aria-label', t('hud.level.label', { level, a: xp - from, b: span }));
  }

  function renderFarmName() {
    const name = store.state.farm.name || 'Harvest Hollow'; // i18n-ok: the brand
    $('hud-farm-name').textContent = name;
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
  function setNum(el, pill, v, animate, format = fmt) {
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
  function renderWallet(animate) {
    const w = store.state.farm.wallet;
    setNum($('hud-coins'), pills.coins, w.coins, animate, coinFmt);
    setNum($('hud-acorns'), pills.acorns, w.acorns, animate, coinFmt);
    if (phoneMq?.matches) pills.coins.setAttribute('aria-label', tn('hud.coins.label', w.coins));
    else pills.coins.removeAttribute('aria-label');
  }
  phoneMq?.addEventListener?.('change', () => { if (store.state) renderWallet(false); });
  function renderHearts(animate) {
    const me = store.state.players[store.pid];
    setNum($('hud-hearts'), pills.hearts, me ? me.hearts || 0 : 0, animate);
  }
  function renderBarn(animate) {
    const b = barnStatus(store.state);
    setNum($('hud-barn'), pills.barn, b.total, animate);
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
          // my own chip carries a little ✎: "Your look" (wave 4, wish 9); a phone has it in the Menu and Settings
          if (pid === store.pid) {
            li.append(h('button.look-btn', { type: 'button', 'aria-label': t('settings.farm.look'), 'data-tip': t('hud.lookTip'),
              on: { click: (e) => { e.stopPropagation(); if (ui.panels.has('avatar')) ui.panels.open('avatar'); } } }, svgIcon('smile', 18)));
          }
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
  const menuBtn = (glyph, lk, key, fn, extra = {}) => h('button.edge-item', {
    type: 'button', role: 'menuitem', dataset: { mk: lk }, on: { click: (e) => { fn(e); if (!extra.keepOpen) closeMenu(); } }, ...(extra.id ? { id: extra.id } : {}),
  }, svgIcon(glyph, 26), h('span.lbl', t(lk)), key ? h('kbd', key) : null);
  const soundBtn = menuBtn('sound', 'hud.edge.soundOn', null, () => { S.settings.set({ muted: !S.settings.get().muted }); }, { id: 'hud-sound', keepOpen: true });
  const menu = h('div.edge-menu.paper', { role: 'menu', 'aria-label': t('hud.edge.menu'), hidden: true },
    menuBtn('photo', 'game.key.photo', 'P', () => (typeof controller.photo === 'function' ? controller.photo() : ui.photoMode(true))),
    menuBtn('gear', 'game.key.settings', ',', () => ui.panels.toggle('settings'), { id: 'hud-settings' }),
    menuBtn('smile', 'hud.edge.look', null, () => { if (ui.panels.has('avatar')) ui.panels.open('avatar'); }, { id: 'hud-look' }),
    // multi-farm mode only (ui/invite.js): a one-time link for the second farmer
    S.invite ? menuBtn('letter', 'multi.invite.title', null, () => S.invite.open(), { id: 'hud-invite' }) : null,
    soundBtn);
  const moreBtn = edgeBtn('gear', 'hud.edge.more', null, () => (menu.hidden ? openMenu() : closeMenu()),
    { id: 'hud-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  function relabelEdge() {
    for (const b of edge.querySelectorAll('.edge-btn')) labelEdge(b);
    for (const b of menu.querySelectorAll('[data-mk]')) b.querySelector('.lbl').textContent = t(b.dataset.mk);
    menu.setAttribute('aria-label', t('hud.edge.menu'));
    renderSound();
  }
  const moreWrap = h('div.edge-more', moreBtn, menu);
  if (S.ideas) menu.insertBefore(S.ideas.menuItem(closeMenu), soundBtn);
  function openMenu() {
    menu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (menu.hidden) return;
    const had = menu.contains(document.activeElement);
    menu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    if (had) moreBtn.focus({ preventScroll: true });
  }
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!moreWrap.contains(e.target)) closeMenu(); }, true);
  edge.append(
    edgeBtn('plus', 'game.key.zoomIn', 'wheel', () => view.camera.zoom(1 / 1.25)),
    edgeBtn('minus', 'game.key.zoomOut', 'wheel', () => view.camera.zoom(1.25)),
    h('div.edge-gap'),
    edgeBtn('rotl', 'hud.edge.turnLeft', 'Q', () => view.camera.rotate(-1)),
    edgeBtn('rotr', 'hud.edge.turnRight', 'E', () => view.camera.rotate(1)),
    h('div.edge-gap'),
    moreWrap,
  );
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
    const label = `${d.label}${d.hotkey ? ` (${d.hotkey})` : ''}`;
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
    const shownBig = big.filter((d) => d.name === 'build' || d.panel);
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
      dock.replaceChildren(...shownBig.map((d) => make(d, false)));
      minis.replaceChildren(...shownSmall.map((d) => make(d, true)));
      // the coach card keeps clear of the minis' row (QA2 UI-02, shell.css .coach)
      $('hud').style.setProperty('--minis-n', String(Math.min(5, shownSmall.length)));   // five a row (shell.css)
    }
    for (const d of shownBig) {
      const locked = d.name === 'build' ? null : lockReason(d.name);
      const pressed = d.name === 'build' ? (controller.tool.id === 'hammer' || ui.panels.isOpen('build') || Boolean(S.toolbar?.buildOpen)) : ui.panels.isOpen(d.name);
      patchDock(make(d, false), d, locked, pressed, false);
    }
    for (const d of shownSmall) patchDock(make(d, true), d, lockReason(d.name), ui.panels.isOpen(d.name), true);
    dock.hidden = dock.children.length === 0;
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
  store.on('welcome', renderDock);
  ui.panels.on('badge', renderDock);
  ui.panels.on('open', renderDock);
  ui.panels.on('close', renderDock);
  controller.on('tool', renderDock);

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
      // GDD §6.3: after 30 s offline the client stops predicting; say plainly that the server is away
      sleepTimer = setTimeout(() => {
        if (connState !== 'reconnecting') return;
        connState = 'asleep';
        conn.replaceChildren(h('span.spin', { 'aria-hidden': 'true' }), t('hud.conn.asleep'));
      }, 30_000);
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
  function renderBuffs() {
    const st = store.state;
    if (!st) return;
    const now = store.now();
    const items = buffItems(st, store.pid, now);
    const key = items.map((i) => i.cls).join(',');
    const said = buffAnnouncements(buffKeys, items);
    buffKeys = items.map((i) => i.cls);
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

  // ---- wiring ------------------------------------------------------------------------------------------------
  store.subscribe('wallet', (ch) => renderWallet(ch.source !== 'welcome'));
  store.subscribe('xp', () => renderLevel());
  store.subscribe('inventory', (ch) => renderBarn(ch.source !== 'welcome'));
  store.subscribe('barn', () => renderBarn(false));
  store.subscribe('name', renderFarmName);
  store.subscribe('players', (ch) => { renderPlayers(); renderHearts(ch.source !== 'welcome'); });
  store.subscribe('xp', () => renderDock());
  store.subscribe('coop', renderBuffs);
  store.subscribe('players', renderBuffs);

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
  return items;
}

/** What the screen reader hears when the buffs change: one line per buff that starts or ends, never the ticks. Pure. */
export function buffAnnouncements(prevKeys, items) {
  if (prevKeys === null) return [];                      // the first render after a load is not news
  const now = new Set(items.map((i) => i.cls));
  const out = [];
  for (const i of items) if (!prevKeys.includes(i.cls)) out.push(t('hud.buff.started', { name: i.name, tip: i.tip }));
  for (const k of prevKeys) if (!now.has(k)) out.push(t('hud.buff.over', { name: k === 'golden' ? t('hud.buff.golden') : t('hud.buff.spark') }));
  return out;
}

/** Player slot -> the shape of their mark: farmer 1 a circle, farmer 2 a rounded square (never colour alone). */
export const slotOf = (pid) => (/^p[0-9]+$/.test(String(pid)) ? String(pid) : 'p1');

// ---- tooltips: [data-tip] on HUD controls (hover 400 ms / keyboard focus) and the world hover (250 ms) -----------
/** The world tooltip's lines for a pick (pure; tests): { title, icon, lines: [text], bar?: 0..1, by?: pid, ready? } */
export function worldTip(state, pick, now, me = null, { riding = null } = {}) {
  if (pick && pick.kind === 'tile' && pick.weed) return weedTip(state, now);
  if (!pick || pick.kind !== 'object' || !pick.id || !Object.hasOwn(state.farm.objects, pick.id)) return null;
  const o = state.farm.objects[pick.id];
  const def = defOfSafe(o.def);
  if (!def) return null;
  const tip = { title: o.name ? t('hud.tip.named', { name: o.name, def: N(o.def) }) : cname(o.def), icon: o.def, lines: [] };
  // a balloon crate (wave 4b, wish 1): open it; nobody's: it goes to the Barn on its own after a while
  if (isCrateDef(def)) return crateTip(state, pick.id, now);
  if (def.kind === 'plot') {
    if (!o.crop) {
      tip.title = t('hud.tip.emptyPlot'); tip.icon = 'plot'; tip.lines.push(t('hud.tip.plantHere'));
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
  if (o.by && o.by !== 'sys') tip.by = o.by;
  return tip;
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

  /** A phone has no Shift: a growing crop's long-press card offers to pull it up (the same node on every refresh). */
  function pullButton(pick) {
    if (S.controller?.input !== 'touch' || !S.controller?.canUproot?.(pick.id)) return null;
    if (pull && pull.id === pick.id) return pull.el;
    const id = pick.id;
    const el = h('button.btn.btn--small.btn--stop.tip-act', { type: 'button', on: { click: (e) => {
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
    const f = { id, one, all, oneWhy, allWhy, oneLabel, allLabel, allSub, crop: null, el: h('div.tip-finish', one, oneWhy, all, allWhy) };
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
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el === hudEl || performance.now() < quietUntil) return;
    clearTimeout(hudT);
    if (hudEl) { hudEl = null; hide(); }
    if (el) hudT = setTimeout(() => show(el), 400);
  });
  // a click is an answer: no tooltip pops up over what was just pressed (the toolbar re-renders under the cursor)
  document.addEventListener('pointerdown', () => { clearTimeout(hudT); quietUntil = performance.now() + 1200; if (hudEl) { hudEl = null; hide(); } }, true);
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
    const t = worldTip(S.store.state, worldPick, S.store.now(), S.store.pid, { riding: S.controller?.riding ?? null });
    if (!t) { hide(); return; }
    const p = t.by && S.store.state.players[t.by];
    const act = pullButton(worldPick);
    if (!act) pull = null;
    const touch = S.controller?.input === 'touch';
    const finish = finishRow(worldPick, t, touch || Boolean(pin && pin.id === worldPick.id));
    if (!finish || finish.classList.contains('tip-finish-hint')) fin = null;
    const fertEl = fertRow(worldPick, t, touch || Boolean(pin && pin.id === worldPick.id));
    if (!fertEl) fert = null;
    const acts = Boolean(act) || Boolean(fertEl) || Boolean(finish && finish.classList.contains('tip-finish'));
    tip.className = 'tip wtip';
    tip.replaceChildren(...[
      h('div.t', t.icon ? icon(t.icon, { size: 32 }) : null, t.title),
      ...t.lines.map((l) => h(`div.s${t.ready ? '.ready' : ''}`, l)),
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
  const pickKey = (p) => (p.kind === 'object' ? p.id : `t${p.x},${p.z}`);

  function tooltip(pick, { force = false } = {}) {
    if (pin && !force) return;
    clearTimeout(worldT);
    clearInterval(worldTimer);
    if (force && pin) { pin = null; worldPick = null; hide(); }
    const same = pick && worldPick && pickKey(pick) === pickKey(worldPick);
    worldPick = pick && (pick.kind === 'object' || weedHint(pick)) ? pick : null;
    if (!worldPick) { if (!hudEl) hide(); return; }
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
