// The balloon crates' rare power-ups on screen (release 1.0, owner request 2026-10-19; rules shared/rules/powerups.js).
// Lazy: panels/w4b.js imports it the first time the farm has a power-up (or a crate holds one), so a farm that never
// finds one never loads it. Both farmers see every chip: the power-ups are the farm's.
//
//   PU_GLYPHS                         each power-up's own picture (svgIcon('pu-rainbow') once installed)
//   puWhat(id, { n?, until? }, now) / puLine(ev, now) / puThing(ev)   what one does; the loot card's message and its
//                                     picture among the loot (pure; tests)
//   chipItems(state, pid, now) -> [{ cls, glyph, name, text, tip }]   the HUD chips (pure; tests)
//   installPowerups(ui, { store, nameOf }) -> { crate(ev, by, local), off() }   pictures, chips, their sheet; the
//                                     crate's card for its finder and the partner's line; the Golden Ticket's word
import { addGlyphs, ensureStylesheet } from './dom.js';
import { addBuffSource } from './hud.js';
import { lootThings, LOOT_CARD_DELAY_MS } from './panels/w4b.js';
import { assetUrl } from '../net/asset-base.js';
import { t, tn } from '../i18n/index.js';
import { livePowerups } from '../../../shared/rules/powerups.js';
import { passOf, dropMomentOf } from '../../../shared/rules/actions/crates.js';

const INK = '#3E2612';
const HOUR = 3_600_000;

// 48 viewBox, ink outline, flat fill + one highlight (the visual-ux-juice glyph style of ui/dom.js)
export const PU_GLYPHS = Object.freeze({
  'pu-rainbow': `<path d="M9 21a13 13 0 0 1 26 0" fill="none" stroke="#E8554A" stroke-width="3.2"/>
    <path d="M12.5 21a9.5 9.5 0 0 1 19 0" fill="none" stroke="#FFC83D" stroke-width="3.2"/>
    <path d="M16 21a6 6 0 0 1 12 0" fill="none" stroke="#4AA8E8" stroke-width="3.2"/>
    <path d="M14 30c-6 0-7 8 0 9" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M31 30l9-8 3 3-10 10" fill="#9ED8FF" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M13 25h20l-2 15a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z" fill="#9ED8FF" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M18 29v9" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round"/>`,
  'pu-ladybugs': `<path d="M20 9l-3-5M28 9l3-5" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="24" cy="14" r="7" fill="${INK}"/>
    <ellipse cx="24" cy="28" rx="15" ry="14" fill="#E8463A" stroke="${INK}" stroke-width="2.5"/>
    <path d="M24 15v27" stroke="${INK}" stroke-width="2.5"/>
    <g fill="${INK}"><circle cx="17" cy="24" r="3"/><circle cx="31" cy="24" r="3"/><circle cx="16" cy="33" r="2.6"/><circle cx="32" cy="33" r="2.6"/></g>
    <path d="M13 23c1-4 4-7 8-8" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`,
  'pu-swarm': `<ellipse cx="18" cy="15" rx="6.5" ry="9" fill="#EAF6FF" stroke="${INK}" stroke-width="2.2" transform="rotate(-20 18 15)"/>
    <ellipse cx="29" cy="15" rx="6.5" ry="9" fill="#EAF6FF" stroke="${INK}" stroke-width="2.2" transform="rotate(20 29 15)"/>
    <path d="M10 30l-6 1.5 6 2" fill="${INK}"/>
    <ellipse cx="24" cy="30" rx="14" ry="11" fill="#FFC83D" stroke="${INK}" stroke-width="2.5"/>
    <path d="M19 20v20M27 19.5v21" stroke="${INK}" stroke-width="3.5"/>
    <circle cx="33" cy="28" r="2" fill="${INK}"/>
    <circle cx="41" cy="11" r="3" fill="#FFC83D" stroke="${INK}" stroke-width="1.6"/>
    <circle cx="7" cy="13" r="2.4" fill="#FFC83D" stroke="${INK}" stroke-width="1.6"/>`,
  'pu-ticket': `<path d="M5 14h38v7a3 3 0 0 0 0 6v7H5v-7a3 3 0 0 0 0-6z" fill="#FFC83D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M14 16v16" stroke="#B07A12" stroke-width="2" stroke-dasharray="2 3"/>
    <path d="M29 16.5l2.3 4.6 5.1.8-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.8z" fill="#FFF4D6" stroke="#B07A12" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M8 18h3" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round"/>`,
  'pu-star': `<path d="M5 41l15-11M7 31l11-5M15 45l9-11" stroke="#9FD8E8" stroke-width="3" stroke-linecap="round"/>
    <path d="M31 5l4.2 8.6 9.3 1.4-6.8 6.6 1.6 9.3-8.3-4.4-8.3 4.4 1.6-9.3-6.8-6.6 9.3-1.4z" fill="#FFE27A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M27 15l3-1" stroke="#fff" stroke-opacity=".75" stroke-width="2.5" stroke-linecap="round"/>`,
});

/** What power-up `id` does, said for its uses `n` or the minutes until `until`. Pure. */
export const puWhat = (id, { n, until }, now) => (n !== undefined ? tn(`feat.pu.do.${id}`, n)
  : t(`feat.pu.do.${id}`, { min: Math.max(1, Math.round((until - now) / 60_000)) }));

/** The loot card's message for the power-up a crateOpened event names: "Name: what it does". Pure. */
export const puLine = (ev, now) => t('feat.pu.card', { name: t(`feat.pu.${ev.pu}`), what: puWhat(ev.pu, { n: ev.puN, until: ev.puUntil }, now) });

/** The power-up among the card's loot: its own picture and its name. Pure. */
export const puThing = (ev) => ({ glyph: `pu-${ev.pu}`, name: t(`feat.pu.${ev.pu}`) });

const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The power-ups at work as HUD chips: a short name and its time left (an hour or more in hours; the Shooting Star
 * counts down to the next balloon), a counted one with its uses; the tip says what it does (like Golden Hour's). Pure.
 */
export function chipItems(state, pid, now) {
  return livePowerups(state, now).map((p) => {
    const left = p.until - now;
    const when = p.id === 'star' ? clock(dropMomentOf(passOf(now) + 1) - now)
      : left >= HOUR ? t('feat.pu.hours', { n: Math.floor(left / HOUR) }) : clock(left);
    const name = t(`feat.pu.${p.id}`);
    const short = t(`feat.pu.short.${p.id}`);
    return {
      cls: `pu-${p.id}`, glyph: `pu-${p.id}`, name,
      text: p.n === undefined ? t('feat.pu.chip', { name: short, clock: when }) : t('feat.pu.chipN', { name: short, n: p.n, clock: when }),
      tip: puWhat(p.id, p, now),
    };
  });
}

/** Wire the power-ups' screen part (once per page). */
export function installPowerups(ui, { store, nameOf }) {
  addGlyphs(PU_GLYPHS);
  ensureStylesheet(assetUrl('/css/panels-rel.css'));
  addBuffSource(chipItems);
  // the Golden Ticket paid on my own order: a word on it (the partner reads the feed line)
  const off = store.on('fx', ({ ev, local }) => {
    if (ev?.e === 'orderFilled' && ev.ticket > 0 && local) ui.toast(() => tn('feat.pu.ticketPaid', ev.ticket), { kind: 'info', icon: 'coins', ms: 5000 });
  });
  const timers = new Set();
  /** A crate with a power-up was opened: its finder's loot card (after the lid), the partner's line. */
  function crate(ev, by, local) {
    const now = store.now();
    if (by !== store.pid) {
      ui.toast(() => t('feat.pu.found', { name: nameOf(by), pu: t(`feat.pu.a.${ev.pu}`), what: puWhat(ev.pu, { n: ev.puN, until: ev.puUntil }, now) }),
        { kind: 'info', icon: 'loot_crate', ms: 9000 });
      return;
    }
    if (!local) return;                  // own actions arrive predicted once; a confirmed echo never repeats it
    const things = () => [...lootThings(ev), puThing(ev)];
    const tm = setTimeout(() => {
      timers.delete(tm);
      ui.banner?.({ id: `loot-${ev.id}`, kind: 'loot', ribbon: t('feat.pu.ribbon'), message: () => puLine(ev, now),
        things: things().map((x, i) => ({ ...x, name: () => things()[i]?.name ?? x.name })), ttl: 11_000,
        actions: [{ label: t('farm.loot.lovely'), kind: 'go', fn: () => {} }] });
    }, LOOT_CARD_DELAY_MS);
    timers.add(tm);
  }
  return {
    crate,
    off() {
      for (const tm of timers) clearTimeout(tm);
      try { off?.(); } catch { /* gone */ }
    },
  };
}
