// Wave-4b hub (owner wishes 2026-10-05), ui lane: the balloon crates' moments on screen (wish 1) and the "saving for"
// choice of the Acorn treasures (wish 2). Small, loaded at boot; the treasures' cards live in the Market's Acorn tab.
//
//   lootThings(loot) -> [{ icon, name, glyph? }]      the loot card's list (pure; tests)
//   lootText(loot) -> "1,240 coins, 85 XP and 2 Acorns"   one line for a toast or the feed (pure; tests)
//   savingKey(pid) / localSaving(pid) / setLocalSaving(pid, id)   this browser's "saving for" choice per farmer
//   relicRows(state, pid, now, local?) / relicSig(state, pid, now)   the Acorn tab's treasure rows (pure; the cards
//                                                    themselves load with the tab: relic-shop.js)
//   installW4b(ui, { store }) -> uninstall
import { fmt, kv } from '../dom.js';
import { itemOf, defOf } from '../../../../shared/content/index.js';
import * as C from '../../../../shared/content/index.js';
import { lootOf, treasures, savingOf, usedToday, USE_OF } from './w4b-rules.js';
import { levelOf } from './model.js';
import { t, tn, lang, list, qty, ctext, nameEntry, N, name as cname } from '../../i18n/index.js';

/** How long after the lid pops the loot card comes (the loot first flies to the HUD: render's open animation). */
export const LOOT_CARD_DELAY_MS = 900;

const relicName = (id) => ctext(null, id, 'name', (typeof C.relicOf === 'function' ? C.relicOf(id)?.name : null) ?? String(id ?? 'treasure').replace(/_/g, ' '));
// Bulgarian: a thing's name from the names table (an album find from the finds texts), else the English one
const bgName = (id) => (id === 'golden_seeds' ? t('farm.loot.goldenSeed')
  : nameEntry(id) ? cname(id) : ctext('finds', id, 'name', itemName(id, 1)));
const bgCount = (id, n) => (id === 'golden_seeds' ? tn('farm.loot.goldenSeeds', n)
  : nameEntry(id) && itemOf(id) ? qty(id, n) : `${bgName(id)} ×${fmt(n)}`);
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const itemName = (id, n) => {
  if (id === 'golden_seeds') return n === 1 ? 'Golden Seed' : 'Golden Seeds'; // i18n-ok: English path (Bulgarian: bgName)
  const it = itemOf(id);
  const name = it?.name ?? defOf(id)?.name ?? String(id).replace(/_/g, ' ');
  return n === 1 ? name : (/s$/.test(name) ? name : `${name}s`);
};

/** The loot card's list: coins, XP, then Acorns, items, finds and decor, each with its icon. Pure. */
export function lootThings(ev) {
  const l = lootOf(ev);
  const out = [];
  if (lang() !== 'en') {
    if (l.coins) out.push({ icon: 'coins', name: t('farm.loot.coins', { n: l.coins }) });
    if (l.xp) out.push({ icon: 'xp', name: t('farm.loot.xp', { n: l.xp }) });
    if (l.acorns) out.push({ icon: 'acorns', name: t('farm.loot.acorns', { n: l.acorns }) });
    for (const x of l.items) {
      const what = x.n > 1 ? bgCount(x.id, x.n) : bgName(x.id);
      out.push({ icon: x.id, name: ev?.set ? t('farm.loot.forAlbum', { what }) : what });
    }
    for (const d of l.decor) out.push({ icon: d, name: t('farm.loot.inTray', { what: bgName(d) }) });
    return out;
  }
  if (l.coins) out.push({ icon: 'coins', name: `+${fmt(l.coins)} coins` });
  if (l.xp) out.push({ icon: 'xp', name: `+${fmt(l.xp)} XP` });
  if (l.acorns) out.push({ icon: 'acorns', name: `+${plural(l.acorns, 'Acorn')}` });
  for (const x of l.items) out.push({ icon: x.id, name: `${x.n > 1 ? `${fmt(x.n)} ` : ''}${itemName(x.id, x.n)}${ev?.set ? ' for the album' : ''}` });
  for (const d of l.decor) out.push({ icon: d, name: `${defOf(d)?.name ?? itemName(d, 1)} (in your build tray)` }); // i18n-ok: English path
  return out;
}

/** "1,240 coins, 85 XP and 2 Acorns". Pure. */
export function lootText(ev) {
  const l = lootOf(ev);
  const parts = [];
  if (lang() !== 'en') {
    if (l.coins) parts.push(tn('common.coins', l.coins));
    if (l.xp) parts.push(t('common.xp', { n: l.xp }));
    if (l.acorns) parts.push(tn('common.acorns', l.acorns));
    for (const x of l.items) parts.push(x.n > 1 ? bgCount(x.id, x.n) : bgName(x.id).toLocaleLowerCase('bg'));
    for (const d of l.decor) parts.push(bgName(d).toLocaleLowerCase('bg'));
    return list(parts);
  }
  if (l.coins) parts.push(`${fmt(l.coins)} coins`);
  if (l.xp) parts.push(`${fmt(l.xp)} XP`);
  if (l.acorns) parts.push(plural(l.acorns, 'Acorn'));
  for (const x of l.items) parts.push(`${x.n > 1 ? `${fmt(x.n)} ` : 'a '}${itemName(x.id, x.n)}`);
  for (const d of l.decor) parts.push(`a ${defOf(d)?.name ?? itemName(d, 1)}`);
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

// ---- "saving for" (wish 2): this browser's choice per farmer, when the rules keep none ---------------------------
export const savingKey = (pid) => `hh.saving.${pid}`;
export const localSaving = (pid) => { const v = kv.get(savingKey(pid), null); return typeof v === 'string' ? v : null; };
export function setLocalSaving(pid, id) {
  if (id) kv.set(savingKey(pid), id); else kv.set(savingKey(pid), null);
  try { globalThis.dispatchEvent?.(new CustomEvent('hh-saving', { detail: { pid, id } })); } catch { /* no window */ }
}

/** Every treasure with what the card shows for player `pid` now. Pure. */
export function relicRows(state, pid, now, local = null) {
  const level = levelOf(state);
  const have = state.farm.wallet.acorns;
  const saving = savingOf(state, pid, local);
  return treasures(state).map((t) => {
    const stored = t.def ? (state.farm.storage?.[t.def.id] ?? 0) > 0 : false;
    const code = t.owned ? 'OWNED' : level < t.unlock ? 'LOCKED' : have < t.acorns ? 'SAVING' : null;
    const own = state.farm.relics?.[t.id] ?? null;
    return { ...t, have: Math.min(have, t.acorns), saving: saving === t.id, stored, by: own?.by ?? null, at: own?.at ?? null,
      used: USE_OF[t.id] && t.owned ? usedToday(state, t.id, now) : false, code };
  });
}

export function relicSig(state, pid, now) {
  return relicRows(state, pid, now, localSaving(pid)).map((r) => [r.id, r.code, r.have, r.saving, r.stored, r.used, r.owned]);
}

export default function installW4b(ui, deps = {}) {
  const off = [];
  const store = deps.store || ui.store || globalThis.__hh?.store || null;
  if (!store || typeof store.on !== 'function') return () => {};
  const view = () => globalThis.__hh?.view ?? null;
  const nameOf = (pid) => store.state?.players?.[pid]?.name ?? t('common.partner');
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  off.push(store.on('fx', ({ ev, by, local }) => {
    if (!ev || !store.state) return;
    if (ev.e === 'crateOpened') {
      const mine = by === store.pid && !ev.auto;
      if (mine) {
        // my crate: the lid pops, the loot flies to the HUD, then the card lists it (a fanfare: game/feedback.js)
        if (!local) return;                  // own actions arrive predicted once; a confirmed echo never repeats it
        later(LOOT_CARD_DELAY_MS, () => ui.banner?.({
          id: `loot-${ev.id}`, kind: 'loot', ribbon: t('farm.loot.ribbon'), message: t('farm.loot.inside'),
          things: lootThings(ev).map((x, i) => ({ ...x, name: () => lootThings(ev)[i]?.name ?? x.name })), ttl: 7000, actions: [{ label: t('farm.loot.lovely'), kind: 'go', fn: () => {} }],
        }));
        return;
      }
      if (ev.auto || by === 'sys') {
        ui.toast(() => t('farm.loot.auto', { loot: lootText(ev) }), { kind: 'info', icon: 'coins', ms: 5000 });
        return;
      }
      ui.toast(() => t('farm.loot.opened', { name: nameOf(by), loot: lootText(ev) }), { kind: 'info', icon: 'coins', ms: 5000 });
      return;
    }
    if (ev.e === 'relicBought') {
      const r = relicName(ev.relic);
      if (by === store.pid && local) {
        const def = ev.def ?? null;
        const place = def && typeof globalThis.__hh?.controller?.place === 'function'
          ? { label: t('market.relic.place'), kind: 'sky', fn: () => globalThis.__hh.controller.place(def) } : null;
        later(250, () => ui.banner?.({ id: `relic-${ev.relic}`, kind: 'loot', ribbon: t('farm.relic.ribbon'),
          message: () => (def ? t('farm.relic.inTray', { relic: relicName(ev.relic) }) : t('farm.relic.works', { relic: relicName(ev.relic) })),
          things: [{ icon: def ?? 'acorns', name: () => relicName(ev.relic) }], ttl: 9000,
          actions: [...(place ? [place] : []), { label: t('farm.loot.lovely'), kind: 'go', fn: () => {} }] }));
      } else if (!local && by !== store.pid) {
        ui.toast(() => t('farm.relic.boughtBy', { name: nameOf(by), relic: relicName(ev.relic) }), { kind: 'info', icon: 'acorns', ms: 5000,
          action: ui.panels?.has?.('market') ? { label: t('farm.relic.look'), fn: () => ui.panels.open('market', { tab: 'acorn', focus: ev.relic }) } : undefined });
      }
      return;
    }
    if (ev.e === 'homeGrew' && !local && by !== store.pid && ev.grows) {
      const home = defOf(ev.def) ? N(ev.def) : t('farm.home.generic');
      ui.toast(Array.isArray(ev.size) ? t('farm.home.grewTo', { name: nameOf(by), home, w: ev.size[0], h: ev.size[1] })
        : t('farm.home.grew', { name: nameOf(by), home }), { kind: 'info', icon: ev.def, ms: 4500 });
      return;
    }
    if (ev.e === 'crateDropped' && !local) {
      // the balloon dropped one (both screens): a word and a way to look, never a sound storm (feedback.js plays one)
      const x = ev.x;
      const z = ev.z;
      const look = Number.isFinite(x) && typeof view()?.focus === 'function'
        ? { label: t('farm.crate.show'), fn: () => view().focus(x, z) } : undefined;
      ui.toast(t('farm.crate.dropped'), { kind: 'info', icon: 'coins', ms: 6000, action: look });
    }
  }));
  return () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const f of off.splice(0)) { try { f(); } catch { /* gone */ } }
  };
}
