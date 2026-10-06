// Phone and tablet layouts (mobile wave, layout lane). The look lives in css/mobile.css, keyed on the same media
// queries as LAYOUT_Q below (test/mobile-ui.test.js keeps the two in step); desktop windows (wider than 1180 px and
// taller than 500 px) match none of them and keep the desktop HUD untouched.
//
//   tablet       601-1180 px wide: the tools and the dock in one bottom bar, the small dock buttons and the
//                together buttons in the farm menu
//   phone        up to 600 px wide (portrait): a compact top row, the Goal Tracker as one chip, the tools in a
//                bottom bar that scrolls sideways, everything else in the farm menu; panels are bottom sheets
//   phone-land   up to 500 px tall (landscape phones): the same, laid out at the sides so the farm stays large;
//                panels slide in from the right
//
//   layoutOf(w, h) -> 'desktop' | 'tablet' | 'phone' | 'phone-land'            (pure)
//   menuBadge(list, dockless) -> { text, tone } | null                          (pure: the menu button's badge)
//   createLayout(S) -> { mode, is(name), menuButton, insets(), on(fn) }   html[data-layout], the farm menu button +
//                panel; also on the ui facade as ui.layout (additive)
import { h, svgIcon, fmt, fmtShort } from './dom.js';
import { barnStatus } from './hud.js';
import { t, tn, onLang } from '../i18n/index.js';

/** The media queries of css/mobile.css (the same strings, so both always agree). */
export const LAYOUT_Q = Object.freeze({
  touch: '(max-width: 1180px), (max-height: 500px)',          // every non-desktop layout
  dockless: '(max-width: 959px), (max-height: 500px)',        // Build / Market / Barn move into the farm menu
  phone: '(max-width: 600px), (max-height: 500px)',           // bottom sheets, the tracker chip, the compact top row
  portrait: '(max-width: 600px)',
  land: '(max-height: 500px) and (min-width: 601px)',
  tablet: '(min-width: 601px) and (max-width: 1180px) and (min-height: 501px)',
  tabletWide: '(min-width: 960px) and (max-width: 1180px) and (min-height: 501px)',   // the dock fits in the bar
  shortPortrait: '(max-width: 600px) and (max-height: 760px)',   // small phones upright (SE, Galaxy S8, 360 x 640)
});

/** The layout a w x h window gets (mirrors LAYOUT_Q). Pure. */
export function layoutOf(w, h) {
  if (h <= 500 && w > 600) return 'phone-land';
  if (w <= 600) return 'phone';
  if (w <= 1180) return 'tablet';
  return 'desktop';
}

const MINI_NAMES = new Set(['orders', 'journal']);     // hud.js MINI_BUILTIN: small dock buttons without `mini`

/** The dock entries the farm menu holds: the small ones always, the big ones too when the bar has no room. Pure. */
export function menuNames(list, dockless) {
  return list.filter((p) => p.dock && (dockless || p.dock.mini || MINI_NAMES.has(p.name)));
}

/**
 * The menu button's badge: red '!' when anything inside asks to be looked at now, else a calm count of the places
 * with something to do (QA2 UI-03 tones). Pure.
 */
export function menuBadge(list, dockless) {
  const inside = menuNames(list, dockless).filter((p) => p.badge !== null && p.badge !== undefined && p.badge !== false);
  if (!inside.length) return null;
  // 'New' is the panels' badge sentinel, not shown text (renderBadge shows the language's word)
  if (inside.some((p) => p.badgeTone !== 'calm' && p.badge !== 'New')) return { text: '!', tone: 'red' }; // i18n-ok
  if (inside.every((p) => p.badge === 'New')) return { text: 'New', tone: 'new' }; // i18n-ok
  return { text: String(inside.length), tone: 'calm' };
}

const mq = (q) => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(q) : null);
const matches = (q) => Boolean(mq(q)?.matches);

export function createLayout(S) {
  const { store, ui, controller } = S;
  const subs = new Set();
  let mode = layoutOf(innerWidth, innerHeight);

  // ---- the farm menu button: the bottom bar's right end (phone, tablet), the bottom-right corner (landscape) ----
  const badge = h('span.badge', { hidden: true, 'aria-hidden': 'true' });
  const menuBtn = h('button.m-menu-btn#m-menu-btn', {
    type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'panel-menu',
    'aria-label': t('social.menu.label'), 'data-tip': t('social.menu.title'),
    on: { click: () => ui.panels.toggle('menu') },
  }, h('span.m-menu-ico', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span.lbl', t('social.menu.btn')), badge);
  document.getElementById('tray-wrap')?.append(menuBtn);

  function renderBadge() {
    const b = menuBadge(ui.panels.list(), matches(LAYOUT_Q.dockless));
    badge.hidden = !b;
    if (!b) { menuBtn.setAttribute('aria-label', t('social.menu.label')); return; }
    // 'New' is the badge's sentinel value (panels set it); the word shown is the language's
    badge.textContent = b.text === 'New' ? t('toolbar.new') : b.text; // i18n-ok: the sentinel
    badge.className = `badge${b.tone === 'calm' ? ' badge--calm' : b.tone === 'new' ? ' badge--new' : ''}`;
    menuBtn.setAttribute('aria-label', t(b.tone === 'red' ? 'social.menu.labelNeeds' : 'social.menu.labelTodo'));
  }
  onLang(() => {
    menuBtn.dataset.tip = t('social.menu.title');
    menuBtn.querySelector('.lbl').textContent = t('social.menu.btn');
    renderBadge();
  });
  ui.panels.on('badge', renderBadge);
  ui.panels.on('register', renderBadge);
  ui.panels.on('open', (n) => { if (n === 'menu') menuBtn.setAttribute('aria-expanded', 'true'); });
  ui.panels.on('close', (n) => { if (n === 'menu') menuBtn.setAttribute('aria-expanded', 'false'); });

  // ---- the farm menu: the HUD's own buttons move in while it is open (badges, locks and handlers stay theirs) ----
  // where each moved node lives on the HUD, to put it back exactly there
  const homes = () => [
    ['dock', document.getElementById('dock')],
    ['minis', document.querySelector('.dock-minis')],
    ['social', document.getElementById('social')],
  ].filter(([, el]) => el).map(([k, el]) => ({ k, el, parent: el.parentNode, next: el.nextSibling }));

  // the input lane's device (game/device.js, controller.device) when it is there: it knows iPhone Safari has none
  const fsDevice = () => controller.device?.fullscreen ?? null;
  const fullscreenOk = () => (fsDevice() ? Boolean(fsDevice().available)
    : Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
  const fullscreenOn = () => (fsDevice() ? Boolean(fsDevice().active) : Boolean(document.fullscreenElement));
  function settingsRow(ctx) {
    const muted = () => Boolean(S.settings?.get().muted);
    const soundLbl = h('span.lbl');
    const soundIco = h('span.m-ico');
    const sound = h('button.m-tile', { type: 'button', role: 'switch', on: { click: () => { S.settings?.set({ muted: !muted() }); paintSound(); } } },
      soundIco, soundLbl);
    function paintSound() {
      soundIco.replaceChildren(svgIcon(muted() ? 'mute' : 'sound', 30));
      soundLbl.textContent = muted() ? t('social.menu.soundOff') : t('social.menu.soundOn');
      sound.setAttribute('aria-checked', String(!muted()));
    }
    paintSound();
    const tiles = [
      h('button.m-tile', { type: 'button', dataset: { tile: 'settings' }, on: { click: () => ui.panels.open('settings') } }, h('span.m-ico', svgIcon('gear', 30)), h('span.lbl', t('game.key.settings'))),
      // wave 4 (wish 9): the farmer's look
      ui.panels.has('avatar') ? h('button.m-tile', { type: 'button', on: { click: () => ui.panels.open('avatar') } }, h('span.m-ico', svgIcon('smile', 30)), h('span.lbl', t('hud.edge.look'))) : null,
      // multi-farm mode only (ui/invite.js)
      // "Invite" on the tile (the label pill is as wide as its neighbours'), the full words for a screen reader
      S.invite ? h('button.m-tile', { type: 'button', 'aria-label': t('multi.invite.title'), dataset: { invite: 'open' }, on: { click: () => S.invite.open() } }, h('span.m-ico', svgIcon('letter', 30)), h('span.lbl', t('social.menu.invite'))) : null,
      sound,
      h('button.m-tile', { type: 'button', on: { click: () => { ctx.close(); typeof controller.photo === 'function' ? controller.photo() : ui.photoMode(true); } } },
        h('span.m-ico', svgIcon('photo', 30)), h('span.lbl', t('social.menu.photo'))),
    ];
    // Ctrl+Z on a keyboard: my newest purchase or move inside its 10 minutes (mobile QA M-06: no touch route before)
    if (typeof controller.undo === 'function') {
      tiles.push(h('button.m-tile', { type: 'button', 'aria-label': t('social.menu.undoLabel'), on: { click: () => { ctx.close(); controller.undo(); } } },
        h('span.m-ico', svgIcon('rotl', 30)), h('span.lbl', t('social.menu.undo'))));
    }
    if (fullscreenOk()) {
      const fsLbl = h('span.lbl', fullscreenOn() ? t('social.menu.fsExit') : t('settings.fullscreen'));
      tiles.push(h('button.m-tile', { type: 'button', on: { click: () => {
        ctx.close();
        // a user gesture is required (this tap); refusals (a policy, an iframe) leave the page as it was
        const fail = () => ui.toast(t('social.menu.fsNo'), { kind: 'info' });
        if (fsDevice()) { fsDevice().toggle()?.catch?.(fail); return; }
        const p = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        p?.catch?.(fail);
      } } }, h('span.m-ico', svgIcon('fullscreen', 30)), fsLbl));
    }
    if (S.ideas) tiles.push(S.ideas.tile(() => ctx.close()));
    return h('div.m-tiles', ...tiles.filter(Boolean));
  }

  function statsRow() {
    const st = store.state;
    if (!st) return null;
    const me = st.players[store.pid];
    const b = barnStatus(st);
    return h('div.m-stats',
      h('button.m-stat', { type: 'button', 'aria-label': t('social.menu.heartsLabel', { n: me?.hearts || 0 }),
        on: { click: () => (ui.panels.has('wardrobe') ? ui.panels.open('wardrobe') : ui.panels.open('journal', { tab: 'stats' })) } },
      h('img.ic', { src: '/assets/icons/hearts.png', alt: '', width: 28, height: 28, draggable: 'false' }), h('b', fmt(me?.hearts || 0)), h('span', tn('social.menu.hearts', me?.hearts || 0))),
      h('button.m-stat', { type: 'button', 'aria-label': t('social.menu.barnLabel', { total: b.total, cap: b.cap }), dataset: { mode: b.mode },
        on: { click: () => ui.panels.open('barn') } },
      h('img.ic', { src: '/assets/icons/barn.png', alt: '', width: 28, height: 28, draggable: 'false' }), h('b', fmtShort(b.total)), h('span', t('social.menu.barn', { cap: fmtShort(b.cap) }))));
  }

  ui.panels.register('menu', {
    get title() { return t('social.menu.title'); },
    size: 'card',
    topics: ['players', 'inventory', 'barn'],
    mount(body, ctx) {
      const moved = homes();
      const dockless = matches(LAYOUT_Q.dockless);
      const sec = (title, ...kids) => h('section.m-sec', h('h3', title), ...kids);
      const nodes = Object.fromEntries(moved.map((m) => [m.k, m.el]));
      const stats = h('div.m-stats-slot', statsRow());
      body.classList.add('m-menu');
      // append() turns a null into the text "null" (a landscape tablet keeps its dock in the bar): drop the gaps
      body.append(...[
        stats,
        dockless && nodes.dock ? sec(t('social.menu.farm'), nodes.dock) : null,
        nodes.minis && nodes.minis.children.length ? sec(t('social.menu.places'), nodes.minis) : null,
        nodes.social ? sec(t('social.menu.together'), nodes.social) : null,
        sec(t('social.menu.game'), settingsRow(ctx)),
      ].filter(Boolean));
      // a tap on a tile closes the menu FIRST (capture phase), then the tile's own handler runs with its button back
      // home on the HUD: the chat line, the emote wheel, the build tray and a panel all open over the farm, and the
      // focus the menu hands back never lands after them
      const onClick = (e) => {
        const b = e.target.closest?.('button');
        if (!b || b.closest('.m-stats') || b.getAttribute('role') === 'switch' || b.getAttribute('aria-disabled') === 'true') return;
        if (b.closest('#dock, .dock-minis, #social')) ctx.close();
      };
      body.addEventListener('click', onClick, true);
      return {
        update() { stats.replaceChildren(statsRow() || ''); },
        destroy() {
          body.removeEventListener('click', onClick, true);
          body.classList.remove('m-menu');
          // a chat line opened from the menu goes home with the buttons (social.js puts it before #social)
          const chat = body.querySelector('.chat-box');
          // last moved first: the dock's old neighbour is the small dock, which has to be home before the dock is
          for (const m of [...moved].reverse()) {
            if (m.parent && m.el.parentNode !== m.parent) m.parent.insertBefore(m.el, m.next && m.next.parentNode === m.parent ? m.next : null);
          }
          if (chat && nodes.social) nodes.social.before(chat);
        },
      };
    },
  });

  // ---- the layout itself: html[data-layout] for tools and tests, the menu closes when it is not needed --------
  function apply() {
    const next = layoutOf(innerWidth, innerHeight);
    document.documentElement.dataset.layout = next;
    if (next === mode) return;
    const was = mode;
    mode = next;
    if (next === 'desktop' && ui.panels.isOpen('menu')) ui.panels.close('menu');
    renderBadge();
    for (const fn of [...subs]) { try { fn(next, was); } catch (err) { console.error('layout listener failed', err); } }
  }
  document.documentElement.dataset.layout = mode;
  for (const q of Object.values(LAYOUT_Q)) mq(q)?.addEventListener?.('change', apply);
  window.addEventListener('resize', apply);
  renderBadge();

  const rectOf = (sel) => {
    const el = document.querySelector(sel);
    return el && el.getClientRects().length ? el.getBoundingClientRect() : null;
  };
  const api = {
    get mode() { return mode; },
    is: (name) => matches(LAYOUT_Q[name]),
    menuButton: menuBtn,
    /**
     * How much of the screen the HUD covers at each edge on a phone or tablet ({ top, right, bottom, left } in CSS px,
     * measured now; all 0 on a desktop): the render and input lanes keep the farm's centre and the build bar in the
     * part that shows. Measures layout: call it on resize or when a view starts, never per frame.
     */
    insets() {
      if (mode === 'desktop') return { top: 0, right: 0, bottom: 0, left: 0 };
      const W = innerWidth;
      const H = innerHeight;
      const top = Math.max(0, ...['.hud-tl', '.hud-tr', '.tracker-chip-wrap'].map(rectOf).filter(Boolean).map((b) => b.bottom));
      const bar = rectOf('#toolbar');
      const edge = rectOf('.hud-right');
      const right = edge ? W - edge.left : 0;
      if (mode === 'phone-land') return { top: Math.round(top), right: Math.round(right), bottom: 0, left: Math.round(bar ? bar.right : 0) };
      const coach = rectOf('#coach-slot .coach');
      const bottom = H - Math.min(bar ? bar.top : H, coach ? coach.top : H);
      return { top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom), left: 0 };
    },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  };

  // the render lane's view.focus (Space, F, "Show me") centres in the part of the screen the HUD leaves free: hand it
  // the insets whenever the bars change size (a rotation, Grandma's guide card coming and going, the tracker chip)
  let insetsKey = '';
  let insetsRaf = 0;
  const observed = new Set();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => queueInsets()) : null;
  function syncInsets() {
    if (ro) {
      for (const sel of ['#toolbar', '#coach-slot', '.hud-right', '.hud-tl', '.hud-tr', '.tracker-chip-wrap']) {
        const el = document.querySelector(sel);
        if (el && !observed.has(el)) { observed.add(el); ro.observe(el); }
      }
    }
    const ins = mode === 'desktop' ? null : api.insets();
    const key = JSON.stringify(ins);
    if (key === insetsKey) return;
    insetsKey = key;
    S.view?.setInsets?.(ins);
  }
  function queueInsets() {
    if (insetsRaf || typeof requestAnimationFrame !== 'function') return;      // no frames (a test): nothing to centre
    insetsRaf = requestAnimationFrame(() => { insetsRaf = 0; try { syncInsets(); } catch (err) { console.error('layout insets failed', err); } });
  }
  window.addEventListener('resize', queueInsets);
  subs.add(queueInsets);
  queueInsets();
  return api;
}
