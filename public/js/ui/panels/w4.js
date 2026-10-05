// Wave-4 hub (the owners' wish list, 2026-10-04), ui lane: registers the new panels and the partner's heads-ups.
// Each panel's code and its stylesheet (css/panels-w4.css) load the first time it opens, so the boot carries only
// this small file: the game is not heavier for a player who never opens them.
//
//   upgrades   { id? | target? }   the farmhouse, Market Stand, Well and benches: tiers, bonus now / next, Upgrade (wish E)
//   decorSell  {}                  the decor waiting in the build tray: what each fetches, Sell, Undo (wish A)
//   avatar     {}                  "Your look": figure, hair and colour, skin tone, top and trousers, hat (wish 9)
//
//   installW4(ui, { store }) -> uninstall
//   lazyPanel(spec, load) -> spec  a registry spec whose mount() loads `load()` -> { mount } first (exported for tests)
import { h, fmt } from '../dom.js';
import { defOf } from '../../../../shared/content/index.js';
import { upgradeTargetOf } from './w4-rules.js';

const CSS_HREF = '/css/panels-w4.css';
let cssReady = null;

/** Link the lane's stylesheet once and wait for it (a panel never paints unstyled; a failed load still goes on). */
export function loadCss(href = CSS_HREF) {
  const doc = globalThis.document;
  // no real document (node tests): nothing to link
  if (!doc || !doc.head || typeof globalThis.HTMLLinkElement !== 'function') return Promise.resolve();
  if (cssReady) return cssReady;
  const v = doc.querySelector?.('meta[name="hh-build"]')?.content;
  const old = [...doc.querySelectorAll('link')].find((l) => String(l.getAttribute('href') || '').split('?')[0] === href);
  if (old) { cssReady = Promise.resolve(); return cssReady; }
  cssReady = new Promise((resolve) => {
    const link = Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: v ? `${href}?v=${encodeURIComponent(v)}` : href });
    link.onload = link.onerror = () => resolve();
    doc.head.append(link);
    setTimeout(resolve, 2500);
  });
  return cssReady;
}

/** A panel spec whose module (and stylesheet) load when it first mounts; until then a quiet "One moment…". */
export function lazyPanel(spec, load) {
  return {
    ...spec,
    mount(body, ctx) {
      let inst = null;
      let dead = false;
      body.append(h('p.w4-wait', { role: 'status' }, 'One moment…'));
      Promise.all([load(), loadCss()]).then(([mod]) => {
        if (dead) return;
        body.replaceChildren();
        inst = mod.mount(body, ctx) || {};
      }).catch((err) => {
        console.error(`panel '${ctx.name}' did not load`, err);
        if (!dead) body.replaceChildren(h('p.empty-note', 'This page could not be loaded. The farm is fine; try again in a moment.'));
      });
      return {
        update: (c) => inst?.update?.(c),
        destroy: () => { dead = true; inst?.destroy?.(); },
      };
    },
  };
}

const UPGRADES = lazyPanel({
  title: (a, st) => {
    const o = a?.id && st?.farm?.objects?.[a.id];
    if (!(o && upgradeTargetOf(o.def))) return 'Farm upgrades';
    const name = defOf(o.def)?.name ?? 'Farm';
    // a phone's title ribbon holds about 14 letters: "Market Stand: up…" was cut, the object's card names it anyway
    const narrow = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-width: 520px)').matches;
    return narrow && name.length > 6 ? 'Upgrades' : `${name}: upgrades`;
  },
  icon: 'hammer',
  size: 'wide',
  topics: ['objects', 'wallet', 'inventory', 'overflow', 'xp'],
}, () => import('./upgrades.js').then((m) => m.upgradesPanel));

const DECOR_SELL = lazyPanel({
  title: 'Sell stored decor',
  icon: 'coins',
  size: 'side',
  topics: ['storage', 'trash', 'wallet', 'objects'],
}, () => import('./decor-sell.js').then((m) => m.decorSellPanel));

const AVATAR = lazyPanel({
  title: 'Your look',
  icon: 'hand',
  size: 'wide',
  topics: ['players'],
}, () => import('./avatar.js').then((m) => m.avatarPanel));

/** The partner's wave-4 deeds as a short line on my screen (the feed has the record; this is the moment). */
export function partnerLine(ev, state, by) {
  const who = state?.players?.[by]?.name ?? 'Your partner';
  const name = (d) => defOf(d)?.name ?? String(d ?? '').replace(/_/g, ' ');
  switch (ev?.e) {
    case 'upgraded': return { text: `${who} upgraded the ${name(ev.def)}${ev.name ? `: ${ev.name}` : ''} ★${ev.tier ?? ''}`.trim(), icon: ev.def };
    case 'soldStored': return { text: `${who} sold a ${name(ev.def)} from the tray (${fmt(ev.coins ?? 0)} coins)`, icon: ev.def };
    case 'removed': return ev.reason === 'sell' && defOf(ev.def)?.kind === 'decor'
      ? { text: `${who} sold the ${name(ev.def)} (${fmt(ev.coins ?? 0)} coins)`, icon: ev.def } : null;
    case 'avatarChanged': return { text: `${who} has a new look ✨`, icon: null };
    default: return null;
  }
}

export default function installW4(ui, deps = {}) {
  const off = [];
  const reg = (name, spec) => { if (!ui.panels.has(name)) off.push(ui.panels.register(name, spec)); };
  reg('upgrades', UPGRADES);
  reg('decorSell', DECOR_SELL);
  reg('avatar', AVATAR);
  const store = deps.store || ui.store || globalThis.__hh?.store || null;
  if (store && typeof store.on === 'function') {
    // the partner sold or upgraded something: a line on my screen with a way to look (Undo for a sale is in the toast
    // of the one who sold, and in the Barn's "Sold in the last 10 minutes" for both)
    off.push(store.on('fx', ({ ev, by, local }) => {
      if (local || !by || by === store.pid || !store.state) return;
      const line = partnerLine(ev, store.state, by);
      if (!line) return;
      const act = ev.e === 'upgraded' && ev.id && ui.panels.has('upgrades')
        ? { label: 'Have a look', fn: () => ui.panels.open('upgrades', { id: ev.id }) }
        : null;
      ui.toast(line.text, { kind: 'info', icon: line.icon || undefined, ms: 4500, action: act || undefined });
    }));
  }
  return () => { for (const f of off.splice(0)) { try { f(); } catch { /* gone */ } } };
}
