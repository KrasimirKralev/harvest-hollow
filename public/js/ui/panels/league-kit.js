// Shared pieces of the ui-league lane (wave 3): the "Progress" hub strip that links the lane's six panels, the lane's
// inline art (league crests, the NPC farms' barns, the duel crown, a progress ring) and reward chips. DOM-free helpers
// first, DOM after. Styles: public/css/panels-league.css (`lg-` prefix), in the panels' wood-and-parchment language.
import { h, icon, svgIcon, fmt, fmtShort } from './kit.js';
import { s as sv } from './art.js';
import { DAILY_GIFT, BOOSTS, eHours, itemOf, defOf } from '../../../../shared/content/index.js';
import { systemLive } from '../../../../shared/rules/coop.js';
import {
  trackOf, trackOpen, perksOf, perksOpen, perksLiveBuild, leagueOpen, horseShowOpen, showOf, duelOf, duelOpen, duelLiveBuild,
  legacyOpen, legacyLiveBuild, levelOf, featureLevel, featureLive, seasonCoatOf, LEAGUE, SEASONAL_TRACK_UNLOCK, MAX_LEVEL, DUEL,
} from './league-rules.js';
import { SEASONAL_TRACK } from '../../../../shared/content/index.js';
import { t, lang, list, Q, ctext, name as cname } from '../../i18n/index.js';

const trackLiveBuild = () => Boolean(SEASONAL_TRACK) && systemLive(SEASONAL_TRACK);
const leagueLiveBuild = () => Boolean(LEAGUE) && systemLive(LEAGUE);

const INK = '#3E2612';

// ---- the hub: one dock button, six panels -------------------------------------------------------------------------

/**
 * The lane's panels in hub order: name (the registry name), label, icon, open(state) (the system plays on this farm
 * now), build() (the system is in this build at all: a later milestone's panel is never even listed), at() (the level
 * it opens at) and badge(state, pid, now) -> number | '!' | null (what waits there for THIS farmer).
 */
export const HUB = Object.freeze([
  { name: 'seasonTrack', get label() { return t('league.hub.track'); }, icon: 'ticket_stub', at: () => SEASONAL_TRACK_UNLOCK,
    build: () => trackLiveBuild(), open: (st) => trackOpen(st),
    badge: (st, pid, now) => trackOf(st, now)?.claimable || null },
  { name: 'league', get label() { return t('league.hub.league'); }, icon: 'purple_rosette', at: () => LEAGUE?.unlock ?? 27,
    build: () => leagueLiveBuild(), open: (st) => leagueOpen(st), badge: () => null },
  { name: 'horseShow', get label() { return t('league.hub.show'); }, icon: 'show_ribbon', at: () => featureLevel('horse_show', 25),
    build: () => featureLive('horse_show'), open: (st) => horseShowOpen(st), badge: (st, pid, now) => {
      const v = showOf(st, now);
      return v.open && v.isOpen && v.have > 0 && v.left > 0 ? '!' : null;
    } },
  { name: 'perks', get label() { return t('league.hub.perks'); }, icon: 'mastery_sign_gold', at: () => featureLevel('perks', 12),
    build: () => perksLiveBuild(), open: (st) => perksOpen(st), badge: (st, pid, now) => perksOf(st, pid, now)?.free || null },
  { name: 'duel', get label() { return t('league.hub.duel'); }, icon: 'ribbon_trophy', at: () => DUEL?.unlock ?? featureLevel('friendly_duel', 29),
    build: () => duelLiveBuild(), open: (st) => duelOpen(st), badge: (st, pid, now) => {
      const d = duelOf(st, pid, now);
      return d.phase === 'invited' || (d.unseen && d.last?.scored) ? '!' : null;
    } },
  { name: 'legacy', get label() { return t('league.hub.legacy'); }, icon: 'golden_gate', at: () => MAX_LEVEL,
    build: () => legacyLiveBuild(), open: (st) => legacyOpen(st), badge: () => null },
]);

/**
 * The hub's view for one farmer: [{ name, label, icon, open, build, at, badge }] (pure). `badges: false` skips the
 * badges (the dock button's owner is asked on every dock render: cheap).
 */
export function hubView(state, pid, now, { badges = true } = {}) {
  return HUB.map((e) => {
    let open = false;
    let badge = null;
    let build = false;
    try {
      build = Boolean(e.build());
      open = build && Boolean(e.open(state));
      badge = open && badges ? e.badge(state, pid, now) : null;
    } catch (err) { console.error(`hub ${e.name} failed`, err); }
    return { name: e.name, label: e.label, icon: e.icon, open, build, at: e.at(), badge };
  });
}

/** A short signature of the hub strip (open systems and their badges) for a panel's memo. */
export const hubSig = (state, pid, now) => hubView(state, pid, now).map((e) => `${e.open ? 1 : 0}${e.badge ?? ''}`).join(',');

/** The hub's badge: '!' when something asks for a look now (an invitation, a Show Ribbon to enter), else the sum of the
 * counts (prizes to claim, perk points to spend), null when nothing waits. */
export function hubBadge(state, pid, now) {
  let n = 0;
  let bang = false;
  for (const e of hubView(state, pid, now)) {
    if (e.badge === '!') bang = true;
    else if (Number.isFinite(e.badge)) n += e.badge;
  }
  return bang ? '!' : n > 0 ? n : null;
}

/**
 * The strip of hub tabs at the top of every lane panel: open systems as buttons (with their badge), the next locked
 * one as a dimmed "L27" pill so there is always a next goal in sight. `active` = this panel's name.
 */
export function hubNav(ctx, active) {
  const st = ctx.store.state;
  const pid = ctx.store.pid;
  const v = hubView(st, pid, ctx.now());
  const shown = v.filter((e) => e.open || e.name === active);
  const lvl = levelOf(st);
  const nextLocked = v.filter((e) => e.build && !e.open && e.name !== active && e.at > lvl).sort((a, b) => a.at - b.at)[0];
  if (shown.length + (nextLocked ? 1 : 0) < 2) return null;
  const tabs = shown.map((e) => h(`button.lg-hub-tab${e.name === active ? '.on' : ''}`, {
    type: 'button', 'aria-current': e.name === active ? 'page' : null, dataset: { hub: e.name },
    on: { click: () => { if (e.name !== active) ctx.ui.panels.open(e.name); } },
  }, icon(e.icon, { size: 26, alt: '' }), h('span', e.label),
  e.badge && e.name !== active ? h(`span.lg-hub-badge${e.badge === '!' ? '' : '.calm'}`, { 'aria-label': e.badge === '!' ? t('league.hub.new') : t('league.hub.waiting', { n: e.badge }) }, String(e.badge)) : null));
  if (nextLocked) {
    tabs.push(h('span.lg-hub-tab.locked', { title: t('league.hub.opensAt', { name: nextLocked.label, n: nextLocked.at }), dataset: { hub: nextLocked.name } },
      svgIcon('lock', 18), h('span', nextLocked.label), h('small', t('league.hub.lvl', { n: nextLocked.at }))));
  }
  return h('nav.lg-hub', { 'aria-label': t('league.hub.label') }, ...tabs);
}

// ---- art ----------------------------------------------------------------------------------------------------------

/** League colours, lowest first: meadow green, teal, river blue, heather purple, champion gold. */
export const TIER_COLORS = Object.freeze([
  { face: '#7CC243', rim: '#3F8F2A', band: '#E9F7D6' },
  { face: '#2BB3A3', rim: '#1F7A70', band: '#D7F3EF' },
  { face: '#4AA8E8', rim: '#1C5283', band: '#DDF0FF' },
  { face: '#9B6BD6', rim: '#5B3A92', band: '#EFE4FB' },
  { face: '#F5C542', rim: '#A86A10', band: '#FFF4CC' },
]);

/** A league crest: a shield in the league's colour with its number of stars and a ribbon underneath. */
export function crest(tier, size = 64, { dim = false, label = null } = {}) {
  const c = TIER_COLORS[Math.min(Math.max(tier, 1), TIER_COLORS.length) - 1];
  const svg = sv('svg', { viewBox: '0 0 64 72', width: size, height: Math.round((size * 72) / 64), class: `lg-crest${dim ? ' dim' : ''}`,
    role: label ? 'img' : null, 'aria-label': label, 'aria-hidden': label ? null : 'true', focusable: 'false' });
  const stars = [];
  const n = Math.min(Math.max(tier, 1), 5);
  const xs = { 1: [32], 2: [25, 39], 3: [20, 32, 44], 4: [17, 27, 37, 47], 5: [14, 23, 32, 41, 50] }[n];
  for (const x of xs) {
    stars.push(sv('path', { d: starPath(x, 31, 5.4, 2.4), fill: '#FFF7D6', stroke: INK, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
  }
  svg.append(
    sv('path', { d: 'M8 54 h48 l-6 8 6 8 h-48 l6 -8 z', fill: '#C8473A', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    sv('path', { d: 'M32 3 L58 11 V33 C58 48 46 57 32 63 C18 57 6 48 6 33 V11 Z', fill: c.rim, stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
    sv('path', { d: 'M32 8 L53 14.5 V33 C53 45 43.5 52.5 32 57.5 C20.5 52.5 11 45 11 33 V14.5 Z', fill: c.face }),
    sv('path', { d: 'M14 18 L32 12.5 L50 18', fill: 'none', stroke: c.band, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.85 }),
    ...stars,
    sv('path', { d: 'M16 44 q16 9 32 0', fill: 'none', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
  );
  return svg;
}

function starPath(cx, cy, r, ri) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? ri : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** The five NPC farms' roof colours (Brambleton, Oakhurst, Mill Creek, Cobble Hill, Fennimore). */
const NPC_ROOFS = ['#B8304F', '#8A5224', '#2B78B5', '#6E7B8A', '#3F8F2A'];

/**
 * A little painted barn: an NPC farm's (its content hue on the roof, or a default by index), or the couple's farm with
 * both farmers' colours on the doors.
 */
export function farmBarn(hueOrIndex, size = 40, { colors = null } = {}) {
  const roof = colors ? '#C8473A' : typeof hueOrIndex === 'string' ? hueOrIndex : NPC_ROOFS[Math.abs(hueOrIndex | 0) % NPC_ROOFS.length];
  const svg = sv('svg', { viewBox: '0 0 48 44', width: size, height: Math.round((size * 44) / 48), class: 'lg-barn', 'aria-hidden': 'true', focusable: 'false' });
  const doorL = colors ? colors[0] : '#FFF4D6';
  const doorR = colors ? colors[1] ?? colors[0] : '#FFF4D6';
  svg.append(
    sv('ellipse', { cx: 24, cy: 41, rx: 21, ry: 3, fill: 'rgba(62,38,18,.18)' }),
    sv('path', { d: 'M6 20 L24 6 L42 20 V40 H6 Z', fill: '#F3E1B3', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    sv('path', { d: 'M2 22 L24 4 L46 22', fill: 'none', stroke: roof, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    sv('path', { d: 'M2 22 L24 4 L46 22', fill: 'none', stroke: INK, 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.6 }),
    sv('rect', { x: 15, y: 25, width: 9, height: 15, fill: doorL, stroke: INK, 'stroke-width': 1.6 }),
    sv('rect', { x: 24, y: 25, width: 9, height: 15, fill: doorR, stroke: INK, 'stroke-width': 1.6 }),
    sv('path', { d: 'M15 25 l9 15 M24 25 l-9 15 M24 25 l9 15 M33 25 l-9 15', stroke: INK, 'stroke-width': 1, opacity: 0.45 }),
    sv('circle', { cx: 24, cy: 16, r: 3.2, fill: '#FFF7D6', stroke: INK, 'stroke-width': 1.4 }),
  );
  return svg;
}

/** The Friendly Duel crown (gold, three points, a heart jewel). */
export function crownArt(size = 48, { dim = false } = {}) {
  const svg = sv('svg', { viewBox: '0 0 56 44', width: size, height: Math.round((size * 44) / 56), class: `lg-crown${dim ? ' dim' : ''}`,
    'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    sv('path', { d: 'M6 14 L16 26 L28 6 L40 26 L50 14 L46 38 H10 Z', fill: '#F5C542', stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
    sv('rect', { x: 9, y: 34, width: 38, height: 7, rx: 2, fill: '#E39A1E', stroke: INK, 'stroke-width': 2.2 }),
    sv('circle', { cx: 6, cy: 13, r: 3.5, fill: '#FFF2B8', stroke: INK, 'stroke-width': 1.8 }),
    sv('circle', { cx: 28, cy: 5, r: 3.5, fill: '#FFF2B8', stroke: INK, 'stroke-width': 1.8 }),
    sv('circle', { cx: 50, cy: 13, r: 3.5, fill: '#FFF2B8', stroke: INK, 'stroke-width': 1.8 }),
    sv('path', { d: 'M28 22 c-2.4 -3.4 -7.2 -1.2 -5.2 2.6 L28 30 l5.2 -5.4 c2 -3.8 -2.8 -6 -5.2 -2.6 z', fill: '#E8556E', stroke: INK, 'stroke-width': 1.4 }),
    sv('path', { d: 'M14 30 q14 -4 28 0', fill: 'none', stroke: '#FFF7D6', 'stroke-width': 1.8, opacity: 0.7, 'stroke-linecap': 'round' }),
  );
  return svg;
}

let ringSeq = 0;

/** A progress ring (0..1) with a centred label: tier progress, perk points. */
export function ring(p, size = 64, label = '', { cls = '', color = null } = {}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const gid = `lg-ring-g${++ringSeq}`;
  const v = Math.max(0, Math.min(1, Number(p) || 0));
  const svg = sv('svg', { viewBox: '0 0 64 64', width: size, height: size, class: `lg-ring${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    sv('circle', { cx: 32, cy: 32, r, fill: '#FFFBEE', stroke: 'rgba(90,50,21,.2)', 'stroke-width': 8 }),
    sv('circle', { cx: 32, cy: 32, r, fill: 'none', stroke: color ?? `url(#${gid})`, 'stroke-width': 8, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * v).toFixed(2)} ${c.toFixed(2)}`, transform: 'rotate(-90 32 32)', class: 'lg-ring-arc' }),
    sv('circle', { cx: 32, cy: 32, r: r + 4.5, fill: 'none', stroke: INK, 'stroke-width': 1.5, opacity: 0.35 }),
  );
  if (!color) {
    svg.prepend(sv('defs', {}, sv('linearGradient', { id: gid, x1: 0, y1: 0, x2: 1, y2: 1 },
      sv('stop', { offset: '0', 'stop-color': '#FFE58A' }), sv('stop', { offset: '1', 'stop-color': '#E39A1E' }))));
  }
  return h('span.lg-ring-wrap', { style: { width: `${size}px`, height: `${size}px` } }, svg, label !== '' ? h('b.lg-ring-label', label) : null);
}

// ---- rewards ------------------------------------------------------------------------------------------------------

const nameOf = (id) => (itemOf(id) || defOf(id) ? cname(id) : String(id).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const decorName = (id) => (id ? nameOf(id) : t('league.rw.decorPiece'));

/**
 * One reward (the content shape of SEASONAL_TRACK.rewards / LEGACY.pool / a rules payout) as [{ icon, text, kind }]:
 * Acorns, coins (`coins`, or `coinsHoursBp` priced at `level`), Golden Seed Packets, seed packets, goods (`items`),
 * Hearts (each farmer), a decor piece (`'season'` = the season's planter), the season's animal coat.
 * ctx = { level, season } decide the season's pieces and the coins.
 */
export function rewardParts(r = {}, { level = 1, season = 'autumn' } = {}) {
  const out = [];
  if (!r || typeof r !== 'object') return out;
  if (r.acorns) out.push({ icon: 'acorns', text: t('league.rw.acorns', { n: r.acorns }), kind: 'acorns' });
  if (r.coins) out.push({ icon: 'coins', text: t('league.rw.coins', { n: fmtShort(r.coins) }), kind: 'coins' });
  if (r.coinsHoursBp) out.push({ icon: 'coins', text: t('league.rw.coins', { n: fmtShort(eHours(level, r.coinsHoursBp)) }), kind: 'coins' });
  if (r.goldenSeeds) {
    const seeds = (BOOSTS.goldenSeeds?.seeds ?? 5) * r.goldenSeeds;
    out.push({ icon: 'golden_seeds', text: r.goldenSeeds === 1 ? t('league.rw.goldenOne', { n: seeds }) : t('league.rw.golden', { n: r.goldenSeeds }), kind: 'seeds' });
  }
  if (r.seedPacket) {
    out.push({ icon: 'seed_packet', text: r.seedPacket === 1 ? t('league.rw.packetOne', { n: BOOSTS.seedPacket?.plantings ?? 5 }) : t('league.rw.packets', { n: r.seedPacket }), kind: 'seeds' });
  }
  if (r.items && typeof r.items === 'object') {
    for (const [id, n] of Object.entries(r.items)) out.push({ icon: id, text: t('league.rw.item', { n, item: nameOf(id), q: Q(id, n) }), kind: 'item' });
  }
  if (r.compost) out.push({ icon: 'compost', text: t('league.rw.compost', { q: Q('compost', r.compost) }), kind: 'item' });
  if (r.hearts) out.push({ icon: 'hearts', text: t('league.rw.hearts', { n: r.hearts }), kind: 'hearts' });
  if (r.decor) {
    const id = r.decor === 'season' ? DAILY_GIFT.seasonDecor?.[season] : typeof r.decor === 'string' ? r.decor : null;
    out.push({ icon: id ?? 'bunting', text: decorName(id), kind: 'decor', id });
  }
  if (r.coat) {
    const c = typeof r.coat === 'string' && r.coat !== 'season' ? { id: r.coat } : seasonCoatOf(season);
    out.push({ icon: 'saddle_rack', text: c ? t('league.rw.coat', { coat: ctext('coats', c.id, 'name', nameOf(c.id)) }) : t('league.rw.seasonCoat'), kind: 'coat', hue: c?.hue ?? null });
  }
  if (r.banner) out.push({ icon: typeof r.banner === 'string' ? r.banner : 'bunting', text: typeof r.banner === 'string' ? nameOf(r.banner) : t('league.rw.banner'), kind: 'decor' });
  return out;
}

/** A reward as icon chips with words ("5 Acorns", "a Golden Seed Packet"). A coat shows its colour swatch. */
export function rewardChips(r, { size = 28, words = true, level = 1, season = 'autumn' } = {}) {
  const parts = rewardParts(r, { level, season });
  if (!parts.length) return null;
  return h('span.lg-reward', ...parts.map((p) => h(`span.lg-reward-part.k-${p.kind}`, { title: p.text },
    p.kind === 'coat' && p.hue ? h('span.lg-coat-swatch', { style: { '--coat': p.hue, width: `${size}px`, height: `${size}px` } }, icon('saddle_rack', { size: Math.round(size * 0.7), alt: '' }))
      : icon(p.icon, { size, alt: words ? '' : p.text }),
    words ? h('span', p.text) : null)));
}

/** "a decor piece and 5 Acorns" (for sentences and labels). */
export function rewardText(r, opts = {}) {
  const parts = rewardParts(r, opts).map((p) => p.text);
  if (parts.length <= 1) return parts[0] ?? '';
  if (lang() !== 'en') return list(parts);
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

