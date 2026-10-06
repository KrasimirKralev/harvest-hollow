// Toasts, notices and non-modal banners (GDD §7.2 "never a red flash", §6.3 "got there first", §7.4 unlock cards).
// ui-shell lane.
//
//   toast(codeOrText, { by?, kind?, icon?, ms?, action? })  short line at the top centre, 3 s, at most 3 at once; an
//                                ERR code becomes friendly text; a lost race against the partner ('EMPTY', 'OCCUPIED',
//                                'NOT_FOUND' with `by` = them) becomes "Mia got there first ♥", coalesced per
//                                SAFETY.lostRaceToastMs into one line with a count. `action: { label, fn }` (additive,
//                                2026-10-04: the Barn's "Undo") adds a button that runs fn and closes the line; such a
//                                toast sits at the bottom centre ABOVE open panels (#snacks), where it stays pressable
//   notice(text, { action? })    a longer, dismissable line (stays until OK or 15 s)
//   banner({ ribbon, things, message, actions, ttl, kind, id?, urgent?, ring? })  a non-modal card in the right column
//                                (unlocks, system cards, Bloom); never takes focus, never blocks the farm; hover or
//                                keyboard focus pauses its timer. The column never runs into the dock: a card that
//                                does not fit waits its turn ("+N more"); `urgent` cards (a 3 s Duet invite) skip
//                                the queue; `ring: ms` draws a countdown ring
//   duetAsk(ev, partner, { join })   the partner pressed "Cook together": "Rowan is baking a Sweetheart Cake"
//   bloom({ crops, trees, animals })  the Level-up Bloom card (owner rule 2026-10-04): "New level! Everything on the
//                                farm is ready" and what finished growing
//   closeBanner(id)              take a card (or a waiting one) away
import { SAFETY, CONTENT } from '../../../shared/content/index.js';
import { ERR } from '../../../shared/net/protocol.js';
import { h, icon, svgIcon } from './dom.js';
import { LAYOUT_Q } from './layout.js';
import { t, tn, list, N, name as cname, onLang, retell } from '../i18n/index.js';

/** A text as it reads now: a string, or a function that says it (a language switch asks it again). */
const say = (v) => (typeof v === 'function' ? v() : v);
/** How to say a text again after a language switch: the function given, else the catalog line i18n made it from. */
const sayer = (v) => (typeof v === 'function' ? v : retell(v));

const RACE_CODES = new Set([ERR.EMPTY, ERR.OCCUPIED, ERR.NOT_FOUND, ERR.NOT_READY, ERR.ALREADY_DONE]);
const KIND_GLYPH = { info: 'i', warn: '!', love: '♥', ok: '✓' };

/** A card's longest stay on a phone (ms): it covers a third of the farm there. */
const PHONE_CARD_MS = 10_000;

/**
 * Card kinds that fold into a slim chip on a phone (wave 4b: "Changed your mind?" and the other drip-fed system cards
 * covered a quarter to a third of a phone screen at the start of a session). The chip names the card; a tap opens the
 * full card, which then stays until it is put away. Unlock tours, the Duet invite and quest cards keep their full card.
 */
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

export function createToasts(S, errText) {
  const box = document.getElementById('toasts');
  const banners = document.getElementById('banners');
  let race = null;                     // { el, by, n, t }

  function remove(el) {
    if (!el.isConnected || el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }

  // A toast with a button (Undo) is often raised from inside a panel, and #hud (the toasts' home) sits under #panels:
  // those lines get their own layer above the panels, at the bottom centre where a thumb reaches them.
  let snacks = null;
  function snackLayer() {
    if (!snacks || !snacks.isConnected) {
      snacks = h('div.snacks#snacks', { role: 'status', 'aria-live': 'polite' });
      document.body.append(snacks);
    }
    return snacks;
  }
  // The spot just pressed: an Undo line must not hide the switch that was just flipped (the last Barn row on a phone
  // sits right where the line goes), so it moves to the top when it would cover that spot or the focused control.
  let press = null;
  document.addEventListener?.('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY, t: performance.now() }; },
    { capture: true, passive: true });
  function placeSnacks(layer) {
    if (typeof layer.getBoundingClientRect !== 'function') return;
    layer.classList.remove('top');
    const r = layer.getBoundingClientRect();
    const hit = (x, y) => x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
    const a = document.activeElement;
    const f = a && a !== document.body && typeof a.getBoundingClientRect === 'function' ? a.getBoundingClientRect() : null;
    const pressed = press && performance.now() - press.t < 2000 && hit(press.x, press.y);
    const focused = f && f.width > 0 && f.bottom > r.top - 8 && f.top < r.bottom + 8 && f.right > r.left && f.left < r.right;
    if (pressed || focused) layer.classList.add('top');
  }

  function show(source, { kind = 'info', iconId = null, ms = 3000, count = 0, action = null } = {}) {
    const host = action ? snackLayer() : box;
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
    const tx = h('span.tx', text);
    const el = h(`div.toast${action ? '.has-act' : ''}`, { dataset: { text, kind } }, badge, tx, count > 1 ? h('span.count', `×${count}`) : null);
    let actBtn = null;
    if (action) {
      el._act = action;
      // it sits over the sheet's content on a phone: a tap on the line itself (not its button) sends it away at once
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
      if (again) { el.dataset.text = again(); tx.textContent = el.dataset.text; }
      if (actBtn && actAgain) actBtn.textContent = actAgain();
    };
    host.append(el);
    while (host.children.length > 3) host.firstElementChild.remove();
    if (action) placeSnacks(host);
    el._t = setTimeout(() => remove(el), ms);
    // hover or keyboard focus holds a toast; it leaves a moment after (WCAG 2.2.1; QA wave 1 UI-35)
    const hold = () => clearTimeout(el._t);
    const go = () => { el._t = setTimeout(() => remove(el), 1200); };
    el.addEventListener('pointerenter', hold);
    el.addEventListener('pointerleave', go);
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', go);
    return el;
  }

  function toast(codeOrText, opts = {}) {
    const { by, kind, icon: iconId, ms, action } = opts;
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
      const el = show(() => t('toasts.race', { name: other.name }), { kind: 'love', ms: 2600 });
      race = { el, by, n: 1, t: now };
      return el;
    }
    // a code is said from the code, so a language switch re-says it too
    const line = !isCode ? codeOrText : other ? () => t('toasts.wasHere', { text: errText(codeOrText), name: other.name })
      : () => errText(codeOrText);
    return show(typeof line === 'function' ? line : String(line), { kind: kind || (isCode ? kindOf(codeOrText) : 'info'), iconId, ms: ms ?? 3000, action: act });
  }

  let noticeEl = null;
  /** A longer line with OK (and an action): `text` and `action.label` may be functions that say them (a switch re-asks). */
  function notice(text, { action = null, ms = 15000 } = {}) {
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
    document.getElementById('hud').append(el);
    noticeEl = el;
    setTimeout(close, ms);
    return el;
  }

  // At most two cards stand on the right edge (a third ran off a 768 px screen), and the column stops above the
  // Orders / Journal buttons (a second card used to cover the Orders mini; QA wave 1 UI-09). Later cards wait their
  // turn instead of being dropped, so every unlock tour and quest card is still seen (and its onClose still runs).
  const MAX_BANNERS = 2;
  const waiting = [];
  const closers = new Map();          // id -> close() of a shown card
  // a card's words as functions, worked out when it is first asked for (a plain string is said again through i18n while
  // its catalog line is fresh): a card that waits its turn and shows after a language switch speaks the new language
  const toldSpecs = new WeakMap();
  function told(spec) {
    let w = toldSpecs.get(spec);
    if (!w) {
      const words = (v) => sayer(v) ?? v;
      w = { ribbon: spec.ribbon === undefined ? () => t('toasts.new') : words(spec.ribbon), message: words(spec.message ?? ''),
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
  /** Where the banner column must stop: the small dock buttons (desktop), else the tool bar and Grandma's card above
   * it (phones and tablets keep the dock in the farm menu; a landscape phone's tool column leaves room for one card). */
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
    closers.get(id)?.();
  }
  /**
   * A card in the right column. `ribbon`, `message`, `things[].name` and `actions[].label` may be functions that say them
   * (a language switch re-asks them; a plain string a catalog line made is said again by i18n `retell`).
   */
  function banner(spec = {}) {
    const { ttl = 9000, kind = 'unlock', id = null, onClose = null, urgent = false, ring = 0 } = spec;
    const { ribbon: ribbonSrc, message: messageSrc, things, actions } = told(spec);
    const ribbon = say(ribbonSrc);
    const message = say(messageSrc);
    if (id) {
      banners.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
      closers.delete(id);
      const w = waiting.findIndex((x) => x.id === id);
      if (w >= 0) waiting.splice(w, 1);
    }
    if (shown() >= MAX_BANNERS && !urgent) {
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
    const msgEl = message ? h('p.msg', message) : null;
    const thingEls = things.slice(0, 8).map((x) => [x, h('span', say(x.name))]);
    const actEls = actions.map((a) => [a, h(`button.btn.btn--small${a.kind && a.kind !== 'go' ? `.btn--${a.kind}` : ''}`, {
      type: 'button', on: { click: () => { close(); a.fn(); } },
    }, say(a.label))]);
    const xBtn = h('button.btn.btn--stop.btn--round.btn--small.x', { type: 'button', 'aria-label': t('toasts.dismiss'), on: { click: close } }, svgIcon('close', 18));
    const el = h(`section.unlock-banner.wood.nails${compact ? '.compact' : ''}`, { dataset: { kind, id: id || '' }, role: 'status', 'aria-label': `${ribbon}. ${message}` },
      chip,
      h('div.ribbon', ring > 0 ? h('span.ring-timer', { 'aria-hidden': 'true', style: { '--d': `${ring}ms` } }) : null, ribbonText),
      xBtn,
      h('div.sheet.paper',
        msgEl,
        thingEls.length ? h('ul.things', thingEls.map(([x, nameEl]) => h('li.thing', x.icon ? icon(x.icon, { size: 46, alt: '' }) : svgIcon(x.glyph || 'star', 46), nameEl))) : null,
        actEls.length ? h('div.acts', actEls.map(([, b]) => b)) : null));
    // a language switch while the card is up: every word of it in the new language
    el._relabel = () => {
      const r = say(ribbonSrc);
      const m = say(messageSrc);
      ribbonText.textContent = r;
      if (msgEl) msgEl.textContent = m;
      for (const [x, nameEl] of thingEls) nameEl.textContent = say(x.name);
      for (const [a, b] of actEls) b.textContent = say(a.label);
      xBtn.setAttribute('aria-label', t('toasts.dismiss'));
      el.setAttribute('aria-label', `${r}. ${m}`);
      if (chip) {
        chip.setAttribute('aria-label', t('toasts.chipLabel', { ribbon: r }));
        chipTitle.textContent = r;
        chipMore.textContent = t('toasts.tellMe');
      }
    };
    banners.prepend(el);
    // no room above the dock: the card waits (unless it is the only one, or urgent)
    if (!urgent && shown() > 1 && !fits()) {
      el.remove();
      waiting.unshift(spec);
      paintMore();
      return { el: null, close: () => { const i = waiting.indexOf(spec); if (i >= 0) waiting.splice(i, 1); paintMore(); } };
    }
    if (id) closers.set(id, close);
    // on a phone a card covers a third of the farm (and eats a pinch that lands on it): it leaves after 10 s at most,
    // and a swipe sends it away at once (mobile QA M-10). A compact chip opened by a tap stays until it is put away.
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
    return { el, close };
  }

  /** One finger flicks card `el` sideways or up and away (`close`); a short drag springs back. */
  function swipeAway(el, close) {
    let g = null;
    el.addEventListener('pointerdown', (e) => {
      g = null;
      if (e.pointerType !== 'touch' || e.target.closest?.('button:not(.card-chip)')) return;
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
    for (const host of [box, snacks, banners]) {
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
