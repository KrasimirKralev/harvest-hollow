// DOM kit of the content panels (ui-panels lane): the few widgets every panel is built from. All styling is in
// public/css/panels.css under the `pn-` prefix; the frame (.hh-panel*) and the .btn family belong to the shell.
//
//   createKit(ctx) -> kit        one per mounted panel (ctx = the shell's panel ctx)
//     kit.button({ label, glyph?, icon?, cls?, type, args, gate?, hint?, after?, title? }) -> el
//          an action button that asks the rules BEFORE the click: probe(type, args) (or gate() first) decides
//          disabled + a visible reason under it ("Need 2 more Flour"); a soft code keeps it enabled (the shell
//          asks "are you sure?" on click). `args` and `hint` may be functions (re-read on every refresh).
//     kit.refresh()              re-probe every button (call from the panel's update())
//     kit.timer(el, { end, start?, bar?, done?, prefix? })   ticks `el`'s text (and a bar) from ctx.now()
//     kit.tick()                 run the timers now (after a re-render)
//   price({ coins, acorns }, { big? }) / stars(n) / chip(item, { have, need, n }) / bar(pct, label?, cls?)
//   section(title, ...children) / empty(text, glyph?) / pill(text, cls?) / ribbonTag(text, cls?)
import { h, icon, svgIcon, fmt, fmtShort, fmtDuration, playerMark } from '../index.js';
import { itemOf } from '../../../../shared/content/index.js';
import { probe, passes, reason } from './core.js';
import { t, t as tr, lang, qty, name as cname } from '../../i18n/index.js';

export { h, icon, svgIcon, fmt, fmtShort, fmtDuration, playerMark };

const val = (v) => (typeof v === 'function' ? v() : v);

/**
 * A panel title that fits a phone's title ribbon (about 14 letters): Bulgarian runs longer, so a narrow screen gets the
 * short key; English always reads the long one (unchanged).
 */
export function phoneTitle(longKey, shortKey, params) {
  const narrow = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-width: 520px)').matches;
  return narrow && lang() !== 'en' ? t(shortKey, params) : t(longKey, params);
}

/**
 * A whole catalog sentence as h() children: Node-valued params (a player's mark, a price chip) stay nodes, the rest is
 * text. Like i18n tNodes(), but an array (no DocumentFragment, so the node tests' small DOM builds it too).
 */
export function tParts(key, params = {}) {
  const marks = new Map();
  const p = {};
  for (const [k, v] of Object.entries(params)) {
    if (v && typeof v === 'object' && typeof v.nodeType === 'number') { const m = `\u0001${k}\u0001`; marks.set(m, v); p[k] = m; } else p[k] = v;
  }
  return t(key, p).split(/(\u0001[\w$]+\u0001)/).filter(Boolean).map((x) => marks.get(x) ?? x);
}

export function createKit(ctx) {
  const buttons = new Set();
  const timers = new Set();
  let ticking = false;

  function refreshButton(b) {
    if (!b.el.isConnected && b.mounted) { buttons.delete(b); return; }
    b.mounted = true;
    let code = null;
    let hint = {};
    const g = b.gate ? b.gate() : null;
    if (g && g.code) { code = g.code; hint = g.hint || {}; }
    else if (b.type) { code = probe(ctx.store, val(b.type), val(b.args) || {}); hint = val(b.hint) || {}; }
    const ok = passes(code);
    b.el.disabled = !ok;
    b.el.classList.toggle('pn-soft', ok && code !== null);
    const text = ok && code === null ? '' : reason(code, hint);
    b.why.textContent = text;
    // "Need 2 more Planks" names the item: the reason opens the where-to-get-it bubble too (ui/item-hint.js)
    const miss = code === 'NO_ITEMS' && hint && Array.isArray(hint.missing) ? hint.missing.find((m) => m && itemOf(m.item)) : null;
    if (miss) Object.assign(b.why.dataset, { hintItem: miss.item, hintMore: String(Math.max(0, miss.n | 0)) });
    else { delete b.why.dataset.hintItem; delete b.why.dataset.hintMore; }
    b.why.hidden = !text || (ok && !b.showSoft) || Boolean(b.quiet && b.quiet.includes(code));
    b.el.title = text || val(b.title) || '';
    b.el.setAttribute('aria-describedby', b.why.id);
    b.code = code;
  }

  let uid = 0;
  function button(spec) {
    const id = `pn-why-${ctx.name}-${++uid}`;
    const why = h('span.pn-why', { id, hidden: true });
    // a stable key per button: a re-render puts the keyboard focus back on "the same" button (kit.memo)
    let key = spec.key;
    if (!key) {
      try { key = `${val(spec.type) ?? 'btn'}:${JSON.stringify(val(spec.args) ?? spec.data ?? spec.label)}`; } catch { key = String(spec.label); }
    }
    const el = h(`button.btn${spec.cls ? `.${spec.cls.split(' ').join('.')}` : ''}`, {
      type: 'button', dataset: { ...(spec.data || {}), key },
      on: { click: (e) => {
        e.stopPropagation();
        if (el.disabled) return;
        if (spec.onClick) { spec.onClick(e); refreshAll(); return; }
        const r = ctx.act(val(spec.type), val(spec.args) || {});
        if (spec.after) spec.after(r);
        refreshAll();
      } },
    }, spec.glyph ? svgIcon(spec.glyph, 22) : null, spec.icon ? icon(spec.icon, { size: 24 }) : null,
    spec.label != null ? h('span.pn-btn-label', val(spec.label)) : null);
    // A button that cannot act stays focusable (QA wave 1 UI-32): aria-disabled instead of the disabled attribute,
    // so keyboard and screen-reader users reach it and hear its reason (aria-describedby). The `disabled` property
    // mirrors aria-disabled, so code and scripts that read button.disabled keep their meaning.
    let off = false;
    Object.defineProperty(el, 'disabled', {
      configurable: true,
      get: () => off,
      set: (v) => { off = Boolean(v); if (off) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled'); },
    });
    const b = { el, why, ...spec, mounted: false };
    buttons.add(b);
    refreshButton(b);
    const wrap = h('span.pn-act', el, why);
    wrap.button = el;
    return wrap;
  }

  function refreshAll() { for (const b of [...buttons]) refreshButton(b); }

  function tickOne(t, now) {
    if (!t.el.isConnected && t.mounted) { timers.delete(t); return; }
    t.mounted = true;
    const left = Math.max(0, t.end - now);
    t.el.textContent = left > 0 ? `${t.prefix || ''}${fmtDuration(left)}` : (t.doneText ?? tr('market.kit.ready'));
    if (t.bar && Number.isFinite(t.start) && t.end > t.start) {
      const p = Math.max(0, Math.min(1, (now - t.start) / (t.end - t.start)));
      t.bar.style.setProperty('--p', String(p));
    }
    if (left === 0 && !t.fired) {
      t.fired = true;
      if (t.done) queueMicrotask(t.done);
    }
  }

  function tick() {
    const now = ctx.now();
    for (const t of [...timers]) tickOne(t, now);
  }

  function timer(el, { end, start, bar, done, prefix, doneText }) {
    const t = { el, end, start, bar, done, prefix, doneText, fired: false, mounted: false };
    timers.add(t);
    if (!ticking) { ticking = true; ctx.every(250, tick); }
    tickOne(t, ctx.now());
    return el;
  }

  /**
   * Re-run `render` only when `sig()` (a JSON-able view of what it draws) changed since the last run: store
   * changes arrive for every partner harvest, and a rebuild under the cursor would drop a slider mid-drag or the
   * keyboard focus. Focus is restored onto the element with the same data-key when it was inside `root`.
   */
  function memo(root, sig, render) {
    let last = null;
    return (force = false) => {
      const key = JSON.stringify(sig());
      if (!force && key === last) return false;
      last = key;
      const a = document.activeElement;
      const focusKey = a && root.contains(a) ? a.dataset?.key : null;
      render();
      if (focusKey) root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
      return true;
    };
  }

  /**
   * A destructive action behind a double confirm (GDD §6.3 "selling an animal, demolishing: double confirm"): the
   * first click arms it ("Sure? Sell for 400"), a second click within 4 s does it.
   */
  function confirmButton(spec) {
    let armed = 0;
    const wrap = button({ ...spec, onClick: () => {
      const b = wrap.button;
      const label = b.querySelector('.pn-btn-label');
      if (!armed) {
        armed = setTimeout(() => { armed = 0; b.classList.remove('pn-armed'); if (label) label.textContent = val(spec.label); }, 4000);
        b.classList.add('pn-armed');
        if (label) label.textContent = val(spec.confirm) || t('market.kit.sure');
        return;
      }
      clearTimeout(armed);
      armed = 0;
      b.classList.remove('pn-armed');
      if (label) label.textContent = val(spec.label);
      const r = ctx.act(val(spec.type), val(spec.args) || {});
      if (spec.after) spec.after(r);
    } });
    return wrap;
  }

  return { button, confirmButton, refresh: refreshAll, timer, tick, memo, ctx };
}

// ---- stateless widgets ----------------------------------------------------------------------------------------

/** replaceChildren without the null / false / undefined children (they would print as text). */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

const UNCOUNTED = new Set(['wheat', 'corn', 'flour', 'wool', 'milk', 'butter', 'cream', 'sugar', 'cornmeal', 'cheese',
  'yogurt', 'popcorn', 'compost', 'wood', 'sugarcane', 'ketchup', 'coleslaw', 'sauerkraut', 'yarn', 'planks', 'oats',
  'chicken_feed', 'livestock_feed', 'pig_slop', 'apple_juice', 'carrot_juice', 'strawberry_jam', 'cherry_jam',
  'veggie_soup', 'pumpkin_soup', 'potato_gratin', 'bread', 'corn_bread', 'cookies', 'pancakes', 'roasted_seeds',
  'sweetheart_cake', 'cream_top_milk', 'silk_wool']);

/** "6 Wheat", "3 Eggs", "2 Wooden Crates", "1 Strawberry", "4 Strawberries" (English plurals for item names). */
export function counted(n, id, name) {
  // Bulgarian counts by the names table ("6 снопа пшеница", "3 яйца", "2 моркова")
  if (lang() !== 'en' && itemOf(id)) return qty(id, n);
  const nm = name ?? itemOf(id)?.name ?? String(id).replace(/_/g, ' ');
  if (n === 1 || UNCOUNTED.has(id) || /s$/i.test(nm)) return `${fmt(n)} ${nm}`;
  if (/[^aeiou]y$/i.test(nm)) return `${fmt(n)} ${nm.slice(0, -1)}ies`;
  if (/(ch|sh|x)$/i.test(nm)) return `${fmt(n)} ${nm}es`;
  if (/potato$|tomato$/i.test(nm)) return `${fmt(n)} ${nm}es`;
  return `${fmt(n)} ${nm}s`;
}

/** "1,200 coins" / "12 Acorns" chips with the shell's glyphs. */
export function price({ coins = 0, acorns = 0 } = {}, { big = false, free = t('market.kit.free'), short = false } = {}) {
  const parts = [];
  const f = short ? fmtShort : fmt;
  if (coins > 0) parts.push(h('span.pn-cost.pn-coins', svgIcon('coin', 20), h('b', f(coins))));
  if (acorns > 0) parts.push(h('span.pn-cost.pn-acorns', svgIcon('acorn', 20), h('b', f(acorns))));
  if (!parts.length) parts.push(h('span.pn-cost.pn-free', free));
  return h(`span.pn-price${big ? '.pn-big' : ''}`, { title: big ? t('market.why.bigSpend') : null },
    parts);
}

/** Mastery stars: filled up to n of max (4 = Gold shows a gold crown star). */
export function stars(n, max = 3, { label = true } = {}) {
  const gold = n >= 4;
  const el = h(`span.pn-stars${gold ? '.pn-gold' : ''}`, {
    role: 'img', 'aria-label': label ? (gold ? t('market.kit.goldMastery') : t('market.kit.starsOf', { n, max })) : null,
    title: label ? (gold ? t('market.kit.goldMastery') : t('market.kit.mastery', { stars: `${'★'.repeat(n)}${'☆'.repeat(Math.max(0, max - n))}` })) : null,
  });
  for (let i = 0; i < max; i++) el.append(h(`span.pn-star${i < n ? '.on' : ''}`, { 'aria-hidden': 'true' }, '★'));
  return el;
}

/**
 * An item chip: icon with a count. With `need`, shows have/need in green (enough) or coral (short), with a tick.
 * Every chip opens the where-to-get-it bubble (ui/item-hint.js, data-item / data-need); a chip of something needed
 * (`need`, or `tab: true` for feed and the like) is a tab stop, so the keyboard reaches its bubble too.
 */
export function chip(item, { have, need, n, size = 40, label = false, inline = false, tab = false } = {}) {
  const it = itemOf(item);
  const name = it ? cname(item) : item;
  let count = null;
  let state = '';
  if (need !== undefined) {
    const ok = (have ?? 0) >= need;
    state = ok ? '.ok' : '.short';
    count = h('span.pn-chip-n', `${fmt(Math.min(have ?? 0, 9999))}/${fmt(need)}`);
  } else if (n !== undefined) count = h('span.pn-chip-n', `×${fmt(n)}`);
  return h(`span.pn-chip${state}${inline ? '.inline' : ''}`, {
    title: need !== undefined ? t('market.kit.chipNeed', { item: name, have: have ?? 0, need }) : name,
    dataset: need !== undefined ? { item, need: String(need) } : { item },
    tabindex: need !== undefined || tab ? '0' : null,
  }, icon(item, { size, alt: name }), count, label ? h('span.pn-chip-name', name) : null,
  state === '.ok' ? h('span.pn-tick', { 'aria-hidden': 'true' }, svgIcon('check', 16)) : null);
}

/**
 * Make `el` (an item's picture or line) open the where-to-get-it bubble of `item` (ui/item-hint.js): `need` = how many
 * are needed in all, `more` = how many more (when only the shortfall is known), `cls` = an ingredient class. A tab
 * stop unless `tab: false`. Returns `el`; an unknown item leaves it untouched.
 */
export function hintable(el, item, { need, more, cls, tab = true } = {}) {
  if (!el || !itemOf(item)) return el;
  el.dataset.hintItem = item;
  if (Number.isFinite(need) && need > 0) el.dataset.hintNeed = String(Math.trunc(need));
  if (Number.isFinite(more) && more > 0) el.dataset.hintMore = String(Math.trunc(more));
  if (cls) el.dataset.hintCls = cls;
  if (tab && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  return el;
}

/** A progress bar: `pct` 0..1 drives a transform (cheap); optional centred label "4/10". */
export function bar(pct, label = null, cls = '') {
  const fill = h('span.pn-bar-fill');
  const el = h(`span.pn-bar${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''}`, { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
    'aria-valuenow': String(Math.round(Math.max(0, Math.min(1, pct)) * 100)), style: { '--p': String(Math.max(0, Math.min(1, pct))) } },
  fill, label !== null ? h('span.pn-bar-label', label) : null);
  el.fill = fill;
  return el;
}

export function section(title, ...children) {
  return h('section.pn-section', h('h3.pn-h', h('span', title)), ...children);
}

export function empty(text, glyph = 'sprout') {
  return h('div.pn-empty', svgIcon(glyph, 44), h('p', text));
}

const dots = (cls) => (cls ? `.${cls.trim().split(/\s+/).join('.')}` : '');
export const pill = (text, cls = '') => h(`span.pn-pill${dots(cls)}`, text);

/** A little ribbon tag on a card corner ("New!", "Try it", "Level 9"). */
export const ribbonTag = (text, cls = '') => h(`span.pn-ribbon${dots(cls)}`, text);

/** Player mark (initial in a ringed circle / rounded square) + name: identity is never colour alone (GDD §7.5). */
export function who(state, pid, { me } = {}) {
  const p = state?.players?.[pid];
  if (!p) return h('span.pn-who.pn-sys', pid === 'sys' ? t('market.kit.theFarm') : t('market.kit.someone'));
  return h('span.pn-who', { style: { '--who': p.color }, dataset: { slot: pid } }, playerMark(pid, p),
    pid === me ? t('market.kit.youName', { name: p.name }) : p.name);
}

/** "3m ago" style relative time from server-clock timestamps. */
export function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 45) return t('market.kit.justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('market.kit.agoM', { m });
  const hr = Math.round(m / 60);
  if (hr < 36) return t('market.kit.agoH', { h: hr });
  return t('market.kit.agoD', { n: Math.round(hr / 24) });
}
