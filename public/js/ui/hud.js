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

const $ = (id) => document.getElementById(id);

/** Display name of an unlock row from content.unlocksAt(). */
export function unlockName({ family, id }) {
  if (family === 'barn') return `Barn upgrade ${id}`;
  const fam = CONTENT[family];
  const def = fam && typeof fam.get === 'function' ? fam.get(id) : null;
  return (def && def.name) || id;
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

/** A player's shown title: a chosen one (rules-goals may store it), else the personal-level title. */
export function titleOf(p) {
  if (p && typeof p.title === 'string' && p.title) return p.title;
  return titleFor(personalLevelFromXp((p && p.xp) || 0));
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

const DOCK_BUILTIN = [
  { name: 'build', label: 'Build', icon: 'hammer', order: 10, hotkey: 'B' },
  { name: 'market', label: 'Market', icon: 'market_stand', order: 20, hotkey: 'M' },
  { name: 'barn', label: 'Barn', icon: 'barn', order: 30, hotkey: 'I' },
];
const MINI_BUILTIN = [
  { name: 'orders', label: 'Orders', icon: 'order_board', glyph: 'orders', order: 40, hotkey: 'O' },
  { name: 'journal', label: 'Journal', glyph: 'journal', order: 50, hotkey: 'J' },
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
    bar.setAttribute('aria-valuetext', `${fmt(xp - from)} of ${fmt(span)} XP to level ${level + 1}`);
    // " XP" is its own span: a phone's narrow bar drops it (css/mobile.css), the numbers stay. ONE child span: the
    // label is a grid, and a bare text node beside the unit would become a second grid row
    $('hud-xp-text').replaceChildren(h('span', `${fmtShort(xp - from)} / ${fmtShort(span)}`, h('span.xp-unit', ' XP')));
    const next = nextUnlocks(level);
    star.dataset.tip = next.length
      ? `Farm level ${level}. Next: ${next.map((u) => `${u.name} (Lv ${u.level})`).join(', ')}`
      : `Farm level ${level}`;
    star.setAttribute('aria-label', `Farm level ${level}. ${fmt(xp - from)} of ${fmt(span)} XP to the next level`);
  }

  function renderFarmName() {
    const name = store.state.farm.name || 'Harvest Hollow';
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
    if (phoneMq?.matches) pills.coins.setAttribute('aria-label', `${fmt(w.coins)} coins. Open the Market`);
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
      ? `The Barn is full (${fmt(b.total)} of ${fmt(b.cap * 2)} with overflow). Sell surplus or upgrade the Barn. (I)`
      : b.mode === 'overflow'
        ? `Overflow: ${fmt(b.total)} in a Barn for ${fmt(b.cap)}. Nothing is lost; sell or use some soon. (I)`
        : `The Barn: ${fmt(b.total)} of ${fmt(b.cap)} (I)`;
    pills.barn.setAttribute('aria-label', `Barn, ${fmt(b.total)} of ${fmt(b.cap)} items${b.over ? `, ${fmt(b.over)} in overflow` : ''}`);
    return b;
  }
  pills.coins.addEventListener('click', () => openOr('market', { tab: 'sell' }, 'barn'));
  pills.acorns.addEventListener('click', () => openOr('market', { tab: 'acorn' }));
  // until the wardrobe exists the hearts pill opens Journal > Together (Hearts per farmer), never a dead click
  pills.hearts.addEventListener('click', () => (ui.panels.has('wardrobe') ? openOr('wardrobe', {}) : openOr('journal', { tab: 'stats' })));
  pills.hearts.dataset.tip = 'Your hearts (personal): earned by playing together. Open Together in the Journal';
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
              h('span.who', h('span.nm'), pid === store.pid ? h('span.you', '(you)') : null), h('span.title')));
          const li = h('li', { dataset: { pid, slot: slotOf(pid) } }, btn);
          // my own chip carries a little ✎: "Your look" (wave 4, wish 9); a phone has it in the Menu and Settings
          if (pid === store.pid) {
            li.append(h('button.look-btn', { type: 'button', 'aria-label': 'Change your look', 'data-tip': 'Your look: hair, clothes, hat',
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
      btn.setAttribute('aria-label', `${p.name}${me ? ' (you)' : ''}, ${title}, ${on ? 'online' : 'away'}${me ? '. Find yourself' : '. Go to them'}`);
      btn.dataset.tip = me ? `${p.name}: ${title}. Click to find yourself (Space)` : `${p.name}: ${title}. ${on ? 'Click to go to them (F)' : 'Away. The farm keeps growing.'}`;
      const face = li.querySelector('.face');
      face.querySelector('.ltr').textContent = initialOf(p.name);
      showPortrait(face, portraitSpec(pid, p), view);
      const nm = li.querySelector('.nm');
      if (nm.textContent !== (p.name || '')) nm.textContent = p.name || '';
      li.querySelector('.title').textContent = on || me ? title : 'Away';
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
    else ui.toast(`${store.state.players[pid]?.name ?? 'Your partner'} is away right now.`, { kind: 'info' });
  }

  // ---- right edge ------------------------------------------------------------------------------------------
  // Five buttons on the right edge (QA wave 1 UI-40): zoom and turn, plus one utility button whose little menu holds
  // the photo, Settings (also the , key) and the sound switch.
  const edge = $('hud-right');
  const edgeBtn = (glyph, label, key, fn, extra = {}) => h('button.edge-btn', {
    type: 'button', 'aria-label': label, 'data-tip': key ? `${label} (${key})` : label, on: { click: fn }, ...extra,
  }, svgIcon(glyph, 30));
  const menuBtn = (glyph, label, key, fn, extra = {}) => h('button.edge-item', {
    type: 'button', role: 'menuitem', on: { click: (e) => { fn(e); if (!extra.keepOpen) closeMenu(); } }, ...(extra.id ? { id: extra.id } : {}),
  }, svgIcon(glyph, 26), h('span.lbl', label), key ? h('kbd', key) : null);
  const soundBtn = menuBtn('sound', 'Sound on', null, () => { S.settings.set({ muted: !S.settings.get().muted }); }, { id: 'hud-sound', keepOpen: true });
  const menu = h('div.edge-menu.paper', { role: 'menu', 'aria-label': 'More', hidden: true },
    menuBtn('photo', 'Take a photo', 'P', () => (typeof controller.photo === 'function' ? controller.photo() : ui.photoMode(true))),
    menuBtn('gear', 'Settings', ',', () => ui.panels.toggle('settings'), { id: 'hud-settings' }),
    menuBtn('smile', 'Your look', null, () => { if (ui.panels.has('avatar')) ui.panels.open('avatar'); }, { id: 'hud-look' }),
    // multi-farm mode only (ui/invite.js): a one-time link for the second farmer
    S.invite ? menuBtn('letter', 'Invite a friend', null, () => S.invite.open(), { id: 'hud-invite' }) : null,
    soundBtn);
  const moreBtn = edgeBtn('gear', 'More: photo, settings, sound', null, () => (menu.hidden ? openMenu() : closeMenu()),
    { id: 'hud-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const moreWrap = h('div.edge-more', moreBtn, menu);
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
    edgeBtn('plus', 'Zoom in', 'wheel', () => view.camera.zoom(1 / 1.25)),
    edgeBtn('minus', 'Zoom out', 'wheel', () => view.camera.zoom(1.25)),
    h('div.edge-gap'),
    edgeBtn('rotl', 'Turn left', 'Q', () => view.camera.rotate(-1)),
    edgeBtn('rotr', 'Turn right', 'E', () => view.camera.rotate(1)),
    h('div.edge-gap'),
    moreWrap,
  );
  function renderSound() {
    const muted = S.settings.get().muted;
    soundBtn.firstChild.replaceWith(svgIcon(muted ? 'mute' : 'sound', 26));
    soundBtn.querySelector('.lbl').textContent = muted ? 'Sound is off' : 'Sound is on';
    soundBtn.setAttribute('aria-label', muted ? 'Sound off. Turn it on' : 'Sound on. Mute');
    soundBtn.setAttribute('role', 'menuitemcheckbox');
    soundBtn.setAttribute('aria-checked', String(!muted));
  }
  S.settings.on(renderSound);
  renderSound();

  // ---- dock --------------------------------------------------------------------------------------------------
  const dock = $('dock');
  const minis = h('div.dock-minis', { role: 'group', 'aria-label': 'Goals and journal' });
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
      badge.textContent = badgeVal;
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
        conn.append(svgIcon('check', 20), 'Back on the farm');
        okTimer = setTimeout(() => { conn.replaceChildren(); conn.className = 'conn'; }, 1800);
      }
      return;
    }
    if (status === 'mismatch') {
      conn.classList.add('bad');
      conn.append(h('span.cg', { 'aria-hidden': 'true' }, '!'), 'The farm server runs other game files. Restart it, then reload.',
        h('button.btn.btn--sun.btn--small', { type: 'button', on: { click: () => location.reload() } }, 'Reload'));
      return;
    }
    if (status === 'degraded') {
      conn.classList.add('bad');
      conn.append(h('span.cg', { 'aria-hidden': 'true' }, '!'), 'The farm server cannot save right now. Your last action was not applied.');
      return;
    }
    conn.append(h('span.spin', { 'aria-hidden': 'true' }), status === 'reconnecting' ? 'Reconnecting… your moves are kept' : 'Connecting to the farm…');
    if (status === 'reconnecting') {
      // GDD §6.3: after 30 s offline the client stops predicting; say plainly that the server is away
      sleepTimer = setTimeout(() => {
        if (connState !== 'reconnecting') return;
        connState = 'asleep';
        conn.replaceChildren(h('span.spin', { 'aria-hidden': 'true' }), 'The farm is asleep (the server is off). Nothing is lost; waiting for it…');
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
      conn.replaceChildren(h('span.spin', { 'aria-hidden': 'true' }), p.n > 1 ? `Saving ${fmt(p.n)} moves…` : 'Saving…');
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
  if (g && g.until > now) items.push({ cls: 'golden', glyph: 'sun', name: 'Golden Hour', text: `Golden Hour ${fmtClock(g.until - now)}`, tip: 'Everything you start now grows 10 % faster' });
  const me = st.players[pid];
  if (me && Number.isSafeInteger(me.spark) && me.spark > now) items.push({ cls: 'spark', glyph: 'star', name: 'Spark', text: `Spark ${fmtClock(me.spark - now)}`, tip: 'High-five Spark: +10 % personal XP' });
  return items;
}

/** What the screen reader hears when the buffs change: one line per buff that starts or ends, never the ticks. Pure. */
export function buffAnnouncements(prevKeys, items) {
  if (prevKeys === null) return [];                      // the first render after a load is not news
  const now = new Set(items.map((i) => i.cls));
  const out = [];
  for (const i of items) if (!prevKeys.includes(i.cls)) out.push(`${i.name} started: ${i.tip}.`);
  for (const k of prevKeys) if (!now.has(k)) out.push(`${k === 'golden' ? 'Golden Hour' : 'Spark'} is over.`);
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
  const tip = { title: o.name ? `${o.name} the ${def.name}` : def.name, icon: o.def, lines: [] };
  // a balloon crate (wave 4b, wish 1): open it; nobody's: it goes to the Barn on its own after a while
  if (isCrateDef(def)) return crateTip(state, pick.id, now);
  if (def.kind === 'plot') {
    if (!o.crop) {
      tip.title = 'Empty plot'; tip.icon = 'plot'; tip.lines.push('Plant a seed here (drag to plant a row)');
      const sp = spreadLine(state, o, me, false, true);
      if (sp) tip.lines.push(sp);
      return tip;
    }
    const c = CONTENT.crops.get(o.crop.def);
    tip.title = c ? c.name : o.crop.def;
    tip.icon = o.crop.def;
    const span = Math.max(1, o.crop.readyAt - o.crop.plantedAt);
    const left = o.crop.readyAt - now;
    tip.ready = left <= 0;
    tip.kind = 'plot';
    tip.lines.push(left <= 0 ? 'Ready to harvest!' : `Ready in ${fmtDurationShort(left)}`);
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
    tip.lines.push(left <= 0 ? 'Ready!' : `Ready in ${fmtDurationShort(left)}`);
    if (def.kind === 'tree' && !(Number.isSafeInteger(o.matureAt) && o.matureAt > now)) {
      const a = treeStageOf(treeAgeOf(o));
      if (a.stage.bonus > 0 || a.index > 0) tip.lines.push(`${a.stage.name} tree${a.stage.bonus > 0 ? ` · +${a.stage.bonus} fruit a harvest` : ''}`);
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
  else if (!ride && def.text && tip.lines.length === 0) tip.lines.push(def.text.length > 90 ? `${def.text.slice(0, 88)}…` : def.text);
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
    const by = typeof fert === 'string' && Object.hasOwn(state.players, fert) ? ` by ${fert === me ? 'you' : state.players[fert].name}` : '';
    const pct = Math.round((tree ? F.treeTimeBp ?? F.timeBp : F.timeBp) / 100);
    const units = tree ? F.treeBonusUnits ?? F.bonusUnits : F.bonusUnits;
    return empty ? `Fertilizer${by}: the next crop grows ${pct} % sooner, +${units} at harvest`
      : `Fertilizer${by} · ${pct} % sooner · +${units} at harvest`;
  }
  if (o.compost) return `Compost · +${tree ? GROWTH.compost.treeBonusUnits : GROWTH.compost.bonusUnits} at harvest, a blue-ribbon chance`;
  return null;
}

/** Wild weeds on our own land (wave 4, wish F): the Hand pulls them for good, a few coins for the first ones a day. */
/** A balloon crate's tooltip (wave 4b, wish 1). Pure. */
export function crateTip(state, id, now) {
  const c = crateOf(state, id);
  const left = c && Number.isSafeInteger(c.until) ? c.until - now : null;
  return { title: 'Balloon Crate', icon: 'loot_crate', kind: 'crate', ready: true,
    lines: [touchPlayer() ? 'Tap it to open it: coins, XP and a surprise!' : 'Click it to open it: coins, XP and a surprise!',
      left !== null && left > 0 ? `Left alone, it goes to the Barn in ${fmtDurationShort(left)}` : 'Either of you can open it'] };
}

export function weedTip(state, now) {
  const W = WEEDS.WEEDS ?? { coins: 0 };
  const left = typeof WEEDS.weedPayLeft === 'function' ? WEEDS.weedPayLeft(state, now) : 0;
  return { title: 'Wild weeds', icon: 'weed', kind: 'weed', lines: ['The Hand pulls them up for good (for both of you)',
    W.coins > 0 && left > 0 ? `+${W.coins} coins each, ${fmt(left)} more today` : 'Just tidier land now: no coins left today'] };
}

/** "Upgrades ★1 of 3: Stone Rim" for an upgradable object (rules' upgrade table), else null. Pure. */
export function upgradeLine(o) {
  const target = typeof UPG.upgradeTargetOf === 'function' ? UPG.upgradeTargetOf(o.def) : null;
  const tiers = target ? UPG.UPGRADES?.[target]?.tiers : null;
  if (!Array.isArray(tiers) || !tiers.length) return null;
  const n = typeof UPG.tierOf === 'function' ? UPG.tierOf(o) : 0;
  return n ? `Upgrades ★${n} of ${tiers.length}: ${tiers[n - 1]?.name ?? ''}`.trim() : `Upgrades: 0 of ${tiers.length} (the Hammer shows them)`;
}

/** "Watered by Mia · -15 % · tended by you · -5 %", or "Needs water (-15 %)". `rec` is a crop or tree record;
 * 'sys' is the rain or a Sprinkler at planting. */
function waterLine(state, rec, me, bp) {
  const who = (pid) => (pid === me ? 'you' : state.players[pid]?.name || 'your partner');
  const pct = (b) => `-${Math.round(b / 100)} %`;
  if (rec.water === undefined) return `Needs water (${pct(bp)})`;
  const by = rec.water === 'sys' ? '' : ` by ${who(rec.water)}`;
  const tend = rec.tend !== undefined ? ` · tended by ${who(rec.tend)} · ${pct(COOP.partnerTend.bp)}` : '';
  return `Watered${by} · ${pct(bp)}${tend}`;
}

function defOfSafe(id) {
  for (const fam of ['plots', 'trees', 'animals', 'homes', 'buildings', 'decor', 'landmarks', 'debris']) {
    const d = CONTENT[fam] && CONTENT[fam].get(id);
    if (d) return d;
  }
  return null;
}

function fmtDurationShort(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const hr = Math.floor(m / 60);
  return hr < 48 ? `${hr}h ${String(m % 60).padStart(2, '0')}m` : `${Math.floor(hr / 24)}d ${hr % 24}h`;
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
    } } }, 'Pull it up');
    pull = { id, el };
    return el;
  }

  /**
   * "Finish now · 3" and "Finish all growing Strawberries · 6 plots · 6" on a growing crop's card (the rules' hurry,
   * live requests 2026-10-04). Where the card can be acted on (a touch card, a clicked card) they are buttons, built
   * once per plot and refreshed in place; a mouse that only hovers is told a click offers them.
   */
  function finishRow(pick, t, actionable) {
    if (t.ready) return null;
    const st = S.store.state;
    const now = S.store.now();
    const m = hurryOf(st, pick.id, t, now);
    if (!m) return null;
    if (!actionable) {
      if (m.code === 'LOCKED' || S.controller?.tool?.id !== 'hand') return null;
      // the Smart Hand waters a thirsty crop first (free, and it grows faster): then the next click offers Finish now
      const thirsty = probe({ state: st, pid: S.store.pid, now: () => now }, 'water', { id: pick.id }) === null;
      return h('div.s.tip-finish-hint', svgIcon('acorn', 16),
        thirsty ? `Water it, then click: Finish now · ${fmt(m.acorns)}` : `Click: Finish now · ${fmt(m.acorns)}`);
    }
    if (!fin || fin.id !== pick.id) fin = buildFinish(pick.id);
    const wallet = st.farm.wallet.acorns;
    const off = (code) => !(code === null || SOFT.has(code));
    const one = off(m.code) ? hurryReason(m.code, { acorns: m.acorns, wallet }) : '';
    fin.oneLabel.textContent = `Finish now · ${fmt(m.acorns)}`;
    setOff(fin.one, one, fin.oneWhy);
    fin.one.setAttribute('aria-label', `Finish now for ${fmt(m.acorns)} Acorn${m.acorns === 1 ? '' : 's'}`);
    // a fruit tree finishes on its own: no "Finish all" row
    if (t.kind === 'tree') { fin.all.hidden = true; fin.allWhy.hidden = true; fin.crop = null; return fin.el; }
    const f = fieldHurry(st, m.crop, now, S.store.pid);
    fin.crop = m.crop;
    const many = f.plots > 1;
    fin.all.hidden = !many;
    fin.allWhy.hidden = true;
    if (many) {
      fin.allLabel.textContent = `Finish all growing ${pluralOf(f.name, 2)}`;
      fin.allSub.textContent = `${fmt(f.plots)} plots · ${fmt(f.acorns)}`;
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
  function fertRow(pick, t, actionable) {
    if (!actionable || t.kind !== 'plot' || t.ready) return null;
    const st = S.store.state;
    const F = FARMING.FERTILIZER;
    if (!F || typeof FARMING.fertilizerLive !== 'function' || !FARMING.fertilizerLive(st)) return null;
    const o = st.farm.objects[pick.id];
    if (!o || o.fert !== undefined || o.crop?.fert !== undefined || o.compost) return null;
    const code = probe({ state: st, pid: S.store.pid, now: () => S.store.now() }, 'fertilize', { id: pick.id });
    if (code !== null && code !== 'NO_ITEMS' && !SOFT.has(code)) return null;
    if (!fert || fert.id !== pick.id) fert = buildFert(pick.id);
    const have = (st.farm.inventory[F.item] ?? 0) + (st.farm.overflow[F.item] ?? 0);
    fert.label.textContent = 'Spread Fertilizer';
    fert.sub.textContent = `${Math.round(F.timeBp / 100)} % sooner · +${F.bonusUnits} at harvest${have ? ` · ${fmt(have)} in the barn` : ''}`;
    const r = CONTENT.recipes?.get?.(F.item);
    const how = r && r.inputs ? Object.entries(r.inputs).map(([k, n]) => `${n} ${CONTENT.items.get(k)?.name ?? k}`).join(' + ') : null;
    setOff(fert.btn, code === 'NO_ITEMS' ? `Make Fertilizer at the Compost Bin${how ? ` (${how})` : ''}` : '', fert.why);
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
    tip.replaceChildren(touchText(text, touchPlayer(S.controller)));
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
      p ? h('div.by', playerMark(t.by, p), `${t.kind === 'plot' ? 'Planted' : 'Placed'} by ${t.by === S.store.pid ? 'you' : p.name}`) : null,
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
