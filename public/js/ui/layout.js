// Phone and tablet layouts (mobile wave, layout lane) and the Farm book (release 1.0, ui-shell). The look lives in
// css/mobile.css, keyed on the same media queries as LAYOUT_Q below (test/mobile-ui.test.js keeps the two in step);
// desktop windows (wider than 1180 px and taller than 500 px) match none of them and keep the desktop HUD untouched.
//
//   tablet       601-1180 px wide: the desktop arrangement (toolbar of 3, the dock of 4 + the Farm book) with insets
//   phone        up to 600 px wide (portrait): a compact top row, the Goal Tracker as one chip, the phone bar
//                [current tool] [Market] [Orders] [Barn] [Farm book]; panels are bottom sheets
//   phone-land   up to 500 px tall (landscape phones): the same items at the sides so the farm stays large; panels slide
//                in from the right
//
// The Farm book (release 1.0 S1, S3; ux-first#5, ux-phone#3; critique#33): ONE sheet with ONE name on every device,
// the panel 'menu' opened by the button #m-menu-btn (the dock's fifth button on a desktop, the phone bar's fifth slot).
// It groups the places that are not one of the four common verbs: This week / Animals / Village / You (the farm's
// Acorns, Hearts and Beauty are the You page's stats, M30), plus on phones Together (only with a partner; the invite
// while there is none on a multi-farm host) and Settings (one tile: Sound, Full screen, Your look and Suggest an idea
// live in the Settings panel). The HUD's own small dock buttons (hud.js, `.dock-minis`) move into their groups while it
// is open (their badges, locks and handlers stay theirs) and go home when it closes.
//
//   layoutOf(w, h) -> 'desktop' | 'tablet' | 'phone' | 'phone-land'            (pure)
//   bookGroupOf(name) -> 'week' | 'animals' | 'village' | 'you'                 (pure: a place's group)
//   menuNames(list) -> the dock entries the Farm book holds                     (pure)
//   menuBadge(list) -> { text, tone } | null                                    (pure: the Farm book button's badge)
//   createLayout(S) -> { mode, is(name), menuButton, insets(), on(fn), bookChanged() }   html[data-layout], the Farm
//                book button + panel; also on the ui facade as ui.layout (additive)
import { assetUrl } from '../net/asset-base.js';
import { h, svgIcon, fmt, fmtShort } from './dom.js';
import { barnStatus, statsLine } from './hud.js';
import * as BEAUTY from '../../../shared/rules/actions/beauty.js';
import { giftsFor } from '../../../shared/rules/actions/coop.js';
import { t, tn, onLang } from '../i18n/index.js';

/** The media queries of css/mobile.css (the same strings, so both always agree). */
export const LAYOUT_Q = Object.freeze({
  touch: '(max-width: 1180px), (max-height: 500px)',          // every non-desktop layout
  dockless: '(max-width: 959px), (max-height: 500px)',        // (HEAD: Build / Market / Barn in the farm menu; unused in 1.0)
  phone: '(max-width: 600px), (max-height: 500px)',           // bottom sheets, the tracker chip, the phone bar
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

/** The four common verbs of the dock (hud.js DOCK_BUILTIN): never in the Farm book. */
const BIG = new Set(['build', 'market', 'barn', 'orders']);
/** Where each place goes in the Farm book. The league's one "Progress" button rides on any of its panels' names. */
const GROUPS = Object.freeze({
  journal: 'week', fair: 'week', barge: 'week',
  pets: 'animals', nursery: 'animals', breeding: 'animals', fishing: 'animals', animals: 'animals',
  town: 'village', townsfolk: 'village', restoration: 'village', collections: 'village',
  farmhouse: 'you', perks: 'you', league: 'you', seasonTrack: 'you', horseshow: 'you', duel: 'you', legacy: 'you',
});
export const BOOK_GROUPS = Object.freeze(['week', 'animals', 'village', 'you']);
/** The Farm book group of a place (its panel name); a place nobody listed goes to This week. Pure. */
export const bookGroupOf = (name) => GROUPS[name] ?? 'week';

/** The dock entries the Farm book holds: every one with a dock button that is not one of the four verbs. Pure. */
export function menuNames(list) {
  return list.filter((p) => p.dock && !BIG.has(p.name));
}

/**
 * The Farm book button's badge: red '!' when anything inside asks to be looked at now, else a calm count of the places
 * with something to do (QA2 UI-03 tones; release 1.0 S1: "its badge sums the folded places"). Pure.
 */
export function menuBadge(list, { gift = false } = {}) {
  const inside = menuNames(list).filter((p) => p.badge !== null && p.badge !== undefined && p.badge !== false);
  // a surprise waiting for me while Together lives inside the book (a phone): look now (QA r3 S3-C2, coop#2)
  if (gift) return { text: '!', tone: 'red' }; // i18n-ok
  if (!inside.length) return null;
  // 'New' is the panels' badge sentinel, not shown text (renderBadge shows the language's word)
  if (inside.some((p) => p.badgeTone !== 'calm' && p.badge !== 'New')) return { text: '!', tone: 'red' }; // i18n-ok
  if (inside.every((p) => p.badge === 'New')) return { text: 'New', tone: 'new' }; // i18n-ok
  return { text: String(inside.length), tone: 'calm' };
}

const mq = (q) => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(q) : null);
const matches = (q) => Boolean(mq(q)?.matches);

/**
 * The Farm book's captions never overlap and stay inside the book (QA r1 S-33: "Бележки" and "Изненада" overlapped on an
 * iPhone in Bulgarian, "Ribbon Track" and "Your look" on a desktop), at ONE size (QA r2 S-21: the S-33 fit set "Ribbon
 * Track" at 10.4 px beside 13 px): a caption that meets a neighbour takes two centred lines when it has two words, and
 * only a single word too wide for its column and its neighbours' room is set smaller. Measured after layout.
 */
export function fitCaptions(root) {
  const run = () => {
    const ls = [...root.querySelectorAll('.lbl')].filter((el) => el.parentElement?.parentElement && el.getClientRects().length);
    for (const el of ls) { el.style.fontSize = ''; el.style.letterSpacing = ''; el.style.maxWidth = ''; el.classList.remove('two'); }
    // the book's paper (its scroller), not its grid: a caption at a row's end may reach into the paper's margin
    const edge = (root.closest?.('.hh-panel-scroll') ?? root).getBoundingClientRect();
    // a caption keeps the book's one size while it meets no neighbour of its row and stays inside the book: a long one
    // reaches into the room a short neighbour leaves (QA r2 S-21: "Ribbon Track" was set at 10.4 px beside 13 px)
    const rowTop = (el) => el.parentElement.getBoundingClientRect().top;
    const clash = (el) => {
      const r = el.getBoundingClientRect();
      if (r.left < edge.left + 2 || r.right > edge.right - 2) return true;
      const top = rowTop(el);
      return ls.some((o) => o !== el && o.parentElement.parentElement === el.parentElement.parentElement && Math.abs(rowTop(o) - top) < 6
        && (() => { const q = o.getBoundingClientRect(); return q.left < r.right + 2 && q.right > r.left - 2; })());
    };
    // the widest first: one that wraps (or, a single long word, shrinks) gives its neighbours their room back
    for (const el of [...ls].sort((a, b) => b.offsetWidth - a.offsetWidth)) {
      if (!clash(el)) continue;
      const cs = getComputedStyle(el.parentElement.parentElement);
      const col = parseFloat(String(cs.gridTemplateColumns).split(' ')[0]);
      const gap = parseFloat(cs.columnGap) || 0;
      if (!(col > 0)) continue;
      const room = col + gap - 2;
      // two words: two centred lines at the same size (css .lbl.two)
      if (/\S\s+\S/.test(el.textContent.trim())) {
        el.classList.add('two');
        el.style.maxWidth = `${Math.floor(room)}px`;
        if (!clash(el)) continue;
      }
      // a single word that still meets a neighbour: the last resort, only as much smaller as it takes (never below the
      // size that fits its own column)
      const fs = parseFloat(getComputedStyle(el).fontSize) || 13;
      const floor = Math.max(9.5, Math.floor(((fs * room) / Math.max(1, el.offsetWidth)) * 10) / 10);
      for (let size = fs - 0.2; size >= floor && clash(el); size -= 0.2) el.style.fontSize = `${size.toFixed(1)}px`;
      if (clash(el)) { el.style.fontSize = `${floor}px`; if (el.offsetWidth > room) el.style.letterSpacing = '-0.03em'; }
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
}

export function createLayout(S) {
  const { store, ui, controller } = S;
  const subs = new Set();
  let mode = layoutOf(innerWidth, innerHeight);

  // ---- the Farm book button: the dock's fifth button (desktop, tablet) and the phone bar's fifth slot (phones) ------
  const badge = h('span.badge', { hidden: true, 'aria-hidden': 'true' });
  const menuBtn = h('button.m-menu-btn#m-menu-btn', {
    type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'panel-menu',
    'aria-label': t('dock.book.label'), 'data-tip': t('dock.book.tip'), dataset: { farmbook: '' },
    on: { click: () => ui.panels.toggle('menu') },
  }, h('span.m-menu-ico', { 'aria-hidden': 'true' }, svgIcon('book', 44)), h('span.lbl', t('dock.book.btn')), badge);
  // its home is the dock (hud.js keeps it last there); before the HUD's dock exists (a test rig), the bottom bar
  (document.getElementById('dock') || document.getElementById('tray-wrap'))?.append(menuBtn);

  // a surprise waiting for me while the Together button is not on the HUD (the phone keeps it in the book): the book's
  // button says so (QA r3 S3-C2, coop#2: 130 s after the box was left nothing on the phone led to it)
  const giftInBook = () => {
    const st = store?.state;
    if (!st || typeof giftsFor !== 'function') return false;
    let waiting = false;
    try { waiting = giftsFor(st, store.pid).some(([id]) => Object.hasOwn(st.farm.objects, id)); } catch { waiting = false; }
    return waiting && !document.getElementById('together-btn')?.getClientRects?.().length;
  };
  function renderBadge() {
    const b = menuBadge(ui.panels.list(), { gift: giftInBook() });
    badge.hidden = !b;
    if (!b) { menuBtn.setAttribute('aria-label', t('dock.book.label')); return; }
    // 'New' is the badge's sentinel value (panels set it); the word shown is the language's
    badge.textContent = b.text === 'New' ? t('toolbar.new') : b.text; // i18n-ok: the sentinel
    badge.className = `badge${b.tone === 'calm' ? ' badge--calm' : b.tone === 'new' ? ' badge--new' : ''}`;
    menuBtn.setAttribute('aria-label', t(b.tone === 'red' ? 'dock.book.labelNeeds' : 'dock.book.labelTodo'));
  }
  onLang(() => {
    menuBtn.dataset.tip = t('dock.book.tip');
    menuBtn.querySelector('.lbl').textContent = t('dock.book.btn');
    renderBadge();
  });
  ui.panels.on('badge', renderBadge);
  ui.panels.on('register', renderBadge);
  store?.subscribe?.('gifts', renderBadge);
  store?.subscribe?.('objects', renderBadge);
  store?.on?.('welcome', renderBadge);
  subs.add(() => renderBadge());                          // a turn to a phone layout moves Together into the book
  ui.panels.on('open', (n) => { if (n === 'menu') menuBtn.setAttribute('aria-expanded', 'true'); });
  ui.panels.on('close', (n) => { if (n === 'menu') menuBtn.setAttribute('aria-expanded', 'false'); });

  // the input lane's device (game/device.js, controller.device) when it is there: it knows iPhone Safari has none
  const fsDevice = () => controller.device?.fullscreen ?? null;
  const fullscreenOk = () => (fsDevice() ? Boolean(fsDevice().available)
    : Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));

  /** The You page's numbers (M30: Hearts live here, not in the top bar): Hearts, Acorns, Beauty; each opens its page. */
  function statsRow() {
    const st = store.state;
    if (!st) return null;
    const me = st.players[store.pid];
    const now = typeof store.now === 'function' ? store.now() : Date.now();
    const stat = (cls, icon, value, words, label, open) => h(`button.m-stat.${cls}`, { type: 'button', 'aria-label': label, on: { click: open } },
      icon, h('b', value), h('span', words));
    const img = (src) => h('img.ic', { src, alt: '', width: 28, height: 28, draggable: 'false' });
    const rows = [
      stat('m-hearts', img(assetUrl('/assets/icons/hearts.png')), fmt(me?.hearts || 0), tn('social.menu.hearts', me?.hearts || 0),
        t('dock.book.heartsLabel', { n: me?.hearts || 0 }), () => (ui.panels.has('wardrobe') ? ui.panels.open('wardrobe') : ui.panels.open('journal', { tab: 'stats' }))),
      stat('m-acorns', img(assetUrl('/assets/icons/acorns.png')), fmt(st.farm.wallet.acorns ?? 0), t('dock.book.acorns'),
        t('dock.book.acornsLabel', { n: st.farm.wallet.acorns ?? 0 }), () => ui.panels.open('market', { tab: 'acorn' })),
    ];
    try {
      if (BEAUTY.beautyLive(st)) {
        const b = BEAUTY.beautyOf(st, now);
        rows.push(stat('m-beauty', svgIcon('flower', 28), fmt(b.score), t('dock.book.beauty', { stars: b.stars, max: BEAUTY.starsFor(Infinity) }),
          t('dock.book.beautyLabel', { n: b.score, stars: b.stars }), () => ui.panels.open('beauty')));
      }
    } catch { /* no beauty rules in this build */ }
    return h('div.m-stats', { 'aria-label': statsLine(st, store.pid, now) }, ...rows);
  }

  const tile = (glyph, label, data, onClick, aria = null) => h('button.m-tile', { type: 'button', dataset: data, 'aria-label': aria,
    on: { click: onClick } }, h('span.m-ico', svgIcon(glyph, 30)), h('span.lbl', label));

  ui.panels.register('menu', {
    // a phone's title ribbon holds about 17 letters ("Книжката на ферма…" on an iPhone 13, ui-panels' P7 run): the
    // dock's own word there ("Книжка" / "Farm book"); the query is the panels' phone-title one (kit.phoneTitle)
    get title() { return globalThis.matchMedia?.('(max-width: 520px), (max-height: 500px)').matches ? t('dock.book.btn') : t('dock.book.title'); },
    size: 'card',
    topics: ['players', 'inventory', 'barn', 'wallet', 'objects'],
    mount(body, ctx) {
      const phone = matches(LAYOUT_Q.phone);
      const placed = [];                  // [{ el, parent, next }] the HUD nodes this sheet borrowed
      const take = (el, into) => { placed.push({ el, parent: el.parentNode, next: el.nextSibling }); into.append(el); };
      const sec = (key, title, ...kids) => h(`section.m-sec.m-sec--${key}`, { dataset: { book: key } }, h('h3', title), ...kids);
      const grids = Object.fromEntries(BOOK_GROUPS.map((g) => [g, h('div.m-places', { role: 'group' })]));
      body.classList.add('m-menu', 'farm-book');
      const minis = document.querySelector('.dock-minis');
      const stats = h('div.m-stats-slot', statsRow());
      const st = store.state;
      const partner = st ? Object.keys(st.players).some((p) => p !== store.pid) : false;
      function distribute() {
        for (const g of Object.values(grids)) g.replaceChildren();
        for (const b of [...(minis?.children ?? [])]) take(b, grids[bookGroupOf(b.dataset?.dock)]);
        // Your look sits in the same row as the places that are yours (a grid of its own stacked them one per row)
        if (!phone && look) grids.you.append(look);
        for (const [key, g] of Object.entries(grids)) {
          const sec0 = g.closest?.('section');
          sec0?.toggleAttribute?.('hidden', key !== 'you' && !g.children.length);
          // a group of one or two places shares its row with its neighbour (one screen on an iPhone 13: S3)
          if (sec0?.dataset) sec0.dataset.n = String(g.children.length);
        }
      }
      // You: the numbers, then the places that are yours, then Your look (desktop: Settings has it too)
      const look = ui.panels.has('avatar') ? tile('smile', t('hud.edge.look'), { tile: 'look' }, () => { ctx.close(); ui.panels.open('avatar'); }) : null;
      const sections = [
        sec('week', t('dock.book.week'), grids.week),
        sec('animals', t('dock.book.animals'), grids.animals),
        sec('village', t('dock.book.village'), grids.village),
        sec('you', t('dock.book.you'), stats, grids.you),
      ];
      // phones: Together (with a partner: the together buttons; before one on a multi-farm host: the invite) and Settings
      const social = document.getElementById('social');
      if (phone) {
        if (partner && social) {
          placed.push({ el: social, parent: social.parentNode, next: social.nextSibling, social: true });
          // the together buttons show as tiles here (the HUD's Together button and its pop-up are not needed)
          const menu = social.querySelector('.together-menu');
          if (menu) { menu.hidden = false; placed.push({ el: menu, parent: menu.parentNode, next: menu.nextSibling, rehide: true }); }
          sections.push(sec('together', t('dock.book.together'), social));
        } else if (!partner && S.invite) {
          sections.push(sec('together', t('dock.book.together'), h('div.m-tiles',
            tile('letter', t('social.menu.invite'), { invite: 'open' }, () => { ctx.close(); S.invite.open(); }, t('multi.invite.title')))));
        }
        sections.push(sec('settings', t('game.key.settings'), h('div.m-tiles',
          tile('gear', t('game.key.settings'), { tile: 'settings' }, () => { ctx.close(); ui.panels.open('settings'); }))));
      }
      body.append(...sections.filter(Boolean));
      distribute();
      fitCaptions(body);
      // ui.farmBook.open(section): that group comes into view (the drip's "Show me", the gift intro)
      const want = ctx.args?.section ? body.querySelector(`[data-book="${ctx.args.section}"]`) : null;
      if (want) setTimeout(() => want.scrollIntoView?.({ block: 'start' }), 60);
      // a tap on a place or a together button closes the sheet FIRST (capture phase), then the button's own handler runs
      // with it back home on the HUD: the chat line, the emote wheel and a panel all open over the farm
      const onClick = (e) => {
        const b = e.target.closest?.('button');
        if (!b || b.closest('.m-stats') || b.getAttribute('role') === 'switch' || b.getAttribute('aria-disabled') === 'true') return;
        if (b.closest('.m-places, #social')) ctx.close();
      };
      body.addEventListener('click', onClick, true);
      const api = {
        update() { stats.replaceChildren(statsRow() || ''); },
        /** hud.js re-drew the small dock (a place opened or closed) while the sheet is open: lay it out again. */
        rebuild() { distribute(); fitCaptions(body); },
        destroy() {
          body.removeEventListener('click', onClick, true);
          body.classList.remove('m-menu', 'farm-book');
          book = null;
          const chat = body.querySelector('.chat-box');
          // last borrowed first: each node goes back before the neighbour it had (or last, when that one moved too)
          for (const m of [...placed].reverse()) {
            if (m.rehide) { m.el.hidden = true; continue; }
            if (!m.parent || m.el.parentNode === m.parent) continue;
            m.parent.insertBefore(m.el, m.next && m.next.parentNode === m.parent ? m.next : null);
            // a chat line opened from the sheet goes home with the together buttons (social.js puts it before them)
            if (m.social && chat) m.el.before(chat);
          }
        },
      };
      book = api;
      return api;
    },
  });
  let book = null;

  // ---- the layout itself: html[data-layout] for tools and tests --------------------------------------------------
  function apply() {
    const next = layoutOf(innerWidth, innerHeight);
    document.documentElement.dataset.layout = next;
    if (next === mode) return;
    const was = mode;
    mode = next;
    // the Farm book's groups differ by layout (Together and Settings on phones): it lays itself out again
    if (ui.panels.isOpen('menu')) ui.panels.close('menu');
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
    bookChanged() { book?.rebuild(); },
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
