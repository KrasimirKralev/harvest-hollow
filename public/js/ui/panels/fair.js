// The County Fair tent (GDD §5.6, M1b) and the weekly lane's shared pieces (ui-weekly lane, wave 2).
//
// Panels (registered by `installWeekly`, see the bottom of this file):
//   'fair'          the tent: the week's target W, points (one decimal), the medal ladder with what each medal pays,
//                   who earned what, entries with point previews, the 10-per-item cap and the duet ×2 badge
//   'fairCeremony'  the Sunday-20:00 results card, on both screens: opened when the CONFIRMED ceremony record
//                   (`farm.fair.last`, written only by the server's `_fair`) is one this player has not seen; the
//                   absent partner gets it on the next welcome. Showing it sends `markSeen { kind: 'fair' }`.
// The barge, the townsfolk board and the Town Projects live in barge.js, townsfolk.js and town.js; they import the
// shared helpers below (the calendar windows, the painted banner, the NPC speech, the player split, flags). This
// module loads them dynamically in `installWeekly`, so the lane has no import cycle.
//
// The rules decide (GDD §7.2): every button asks the shared rules (`probe`) before the click, and the numbers come
// from the goals lane's own helpers (shared/rules/actions/fair.js: entry points, medal thresholds and pay, the
// week's open and close times), so a preview can never disagree with what a click does.
import { CONTENT, FAIR, itemOf, npcOf, pluralOf } from '../../../../shared/content/index.js';
import * as FR from '../../../../shared/rules/actions/fair.js';
import { systemLive, weekOf } from '../../../../shared/rules/coop.js';
import { h, icon, svgIcon, fmt, fmtDuration, playerMark, createKit, fill, price, hintable } from './kit.js';
import { pick, probe, passes, levelOf, available } from './core.js';
import { portrait, s as sv } from './art.js';
import { ensureStylesheet } from '../dom.js';
import { leagueOpen, horseShowOpen } from './league-rules.js';

export const BP = 10_000;
const DAY = 86_400_000;
const CSS_HREF = '/css/panels-weekly.css';

// ---- small shared readers (pure) --------------------------------------------------------------------------------

export const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** A weekly system (content rule object with a milestone) plays in this build and the farm has its level. */
export function systemOpen(sys, state) {
  return Boolean(sys) && systemLive(sys) && levelOf(state) >= (sys.unlock ?? 1);
}

/** The registered action type (the goals lanes' names), else the canonical name (its probe says "Not open yet"). */
export const actionOf = (...names) => pick(...names) ?? names[0];

/** Points are stored ×10 (one decimal, GDD §5.6 v2): 1712 -> "171.2", 1710 -> "171". */
export function fmtPts(p10) {
  const v = Math.max(0, Math.round(num(p10)));
  const whole = Math.floor(v / 10);
  const tenth = v % 10;
  return tenth ? `${fmt(whole)}.${tenth}` : fmt(whole);
}

/** A NO_ITEMS hint with the English plural ("Need 3 more Wooden Crates"). */
export function need(item, n) {
  const k = Math.max(1, n);
  return { missing: [{ item, n: k, label: pluralOf(itemOf(item)?.name ?? item, k) }] };
}

/** Scroll a re-opened panel back to its top (the shell keeps the scroll box between openings). */
export function toTop(ctx) {
  const sc = ctx.el?.querySelector?.('.hh-panel-scroll');
  if (sc) sc.scrollTop = 0;
}

/** Bring the card a tracker card or a world click named into view and ring it once. */
export function focusOn(el) {
  if (!el) return;
  // the shell mounts a panel before it shows the frame: scroll once it is laid out
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!el.isConnected) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('wk-focus');
    setTimeout(() => el.classList.remove('wk-focus'), 2600);
  }));
}

/** "2d 4h" / "3h 05m" until `at` (never negative). */
export function leftText(at, now) {
  return fmtDuration(Math.max(0, at - now)).replace(/ 0\d?[ms]$/, '');
}

// ---- shared DOM pieces (the lane's look: painted banner, NPC speech, flags, player split) -----------------------

/** Where each painting's subject sits (x, y as 0..1) for the wide, shallow banner crop: the barge, the Fair's prize
 * table, the village street's market stall, the far village across the river. */
export const BANNER_FOCUS = Object.freeze({ f: [0.5, 0.52], g: [0.3, 0.7], b: [0.5, 0.42], e: [0.2, 0.22] });

/** The painted banner strip at the top of a weekly panel: art, a title on an ink gradient, an optional chip. */
export function banner(art, title, sub, { chip = null, cls = '', focus = null } = {}) {
  const [fx, fy] = focus ?? BANNER_FOCUS[art] ?? [0.5, 0.5];
  return h(`header.wk-banner${cls ? `.${cls}` : ''}`,
    h('img.wk-banner-art', { src: `/assets/art/quests/${art}.webp`, alt: '', decoding: 'async', draggable: 'false',
      style: { objectPosition: `${fx * 100}% ${fy * 100}%` } }),
    h('div.wk-banner-ink', { 'aria-hidden': 'true' }),
    h('div.wk-banner-text', h('h2.wk-banner-title', title), sub ? h('p.wk-banner-sub', sub) : null),
    chip);
}

/** A countdown chip ("Judging Sunday 20:00 · 2d 4h") that ticks with the panel's kit. */
export function clockChip(kit, { label, at, doneText = 'any moment now', glyph = 'sun', cls = '' }) {
  const t = h('b.wk-clock-t');
  kit.timer(t, { end: at, doneText });
  return h(`div.wk-clock${cls ? `.${cls}` : ''}`, svgIcon(glyph, 20), h('span', label), t);
}

/** An NPC portrait with a speech bubble (the tent / jetty / board host). */
export function speech(npcId, line, small = null, size = 64) {
  const npc = npcOf(npcId);
  return h('div.wk-host', npc ? portrait(npc, size) : null,
    h('div.wk-speech', h('b', npc ? npc.name : ''), h('p', `“${line}”`), small ? h('small', small) : null));
}

/** A two-colour split bar of what each farmer brought, with marks and names (identity is never colour alone). */
export function splitBar(state, parts, { format = fmt, label = 'Who brought it' } = {}) {
  const rows = Object.entries(parts || {}).filter(([, v]) => num(v) > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sum = rows.reduce((n, [, v]) => n + num(v), 0);
  if (!rows.length || sum <= 0) return null;
  const segs = rows.map(([pid, v]) => {
    const p = state.players?.[pid];
    return h('span.wk-split-seg', { style: { '--who': p ? p.color : '#C9A36A', '--w': String(num(v) / sum) },
      title: `${p ? p.name : 'A farmer'}: ${format(v)}` });
  });
  const legend = rows.map(([pid, v]) => {
    const p = state.players?.[pid];
    return h('span.wk-split-who', p ? playerMark(pid, p) : h('span.wk-split-dot'), h('span', p ? p.name : 'A farmer'), h('b', format(v)));
  });
  return h('div.wk-split', { role: 'group', 'aria-label': label }, h('div.wk-split-bar', segs), h('div.wk-split-legend', legend));
}

/** "Need help" flag (GDD §6.2 mechanic 3): the flag owner's colour and name; the rules decide who may toggle it. */
const FLAG_TITLE = 'Ask your partner for help: when the other farmer does it you both get a Heart';
export function flagButton(ctx, state, flagBy, { type, args, title = FLAG_TITLE }) {
  const me = ctx.store.pid;
  const owner = flagBy && state.players?.[flagBy] ? flagBy : null;
  const code = probe(ctx.store, type, args);
  const off = !passes(code);
  const text = owner ? (owner === me ? 'Help asked' : `${state.players[owner].name} needs help`) : 'Need help';
  const tip = owner && owner !== me ? `${state.players[owner].name} asked for help: fill it for a Heart each`
    : off && code === 'CAP' ? 'Three help flags are already up' : title;
  return h('button.pn-tag-btn.pn-flag.wk-flag', {
    type: 'button', 'aria-pressed': String(Boolean(owner)), 'aria-disabled': off ? 'true' : null,
    style: owner ? { '--who': state.players[owner].color } : null,
    title: tip,
    dataset: { flag: JSON.stringify(args) },
    on: { click: (e) => { e.stopPropagation(); if (!off) ctx.act(type, args); } } },
  owner ? playerMark(owner, state.players[owner]) : '⚑', text);
}

/** The body of a system that is not open on this farm yet (locked by level, or not in this build). */
export function lockedBody(art, title, lines, unlock, level, live = true) {
  return h('div.wk-locked', banner(art, title, live && unlock > level ? `Opens at farm level ${unlock}` : 'Coming soon to the valley'),
    h('div.wk-locked-card', svgIcon('lock', 36), h('ul', ...lines.map((l) => h('li', l)))));
}

// ---- the Fair: reading the state (the goals lane's farm.fair = { cur, last }) -----------------------------------

const PREMIUMS = () => new Set([...CONTENT.animals.values()].map((a) => a.premium).filter(Boolean));
const metalOf = (id) => (id === 'platinum' ? 'platinum' : String(id || '').replace(/\d$/, '') || 'none');
const rankOf = (id) => (/\d$/.test(String(id || '')) ? ['', 'I', 'II', 'III'][Number(String(id).slice(-1))] ?? '' : '');

/** The medal ladder for a target W (points): [{ id, name, metal, rank, at10, coins, acorns, trophy }]. */
export function medalLadder(W, state = null) {
  // M2: the rules list Platinum only for a farm whose Town Fair Grounds is restored, so pass the farm
  return FR.liveMedals(state).map((m) => ({ id: m.id, name: m.name, metal: metalOf(m.id), rank: rankOf(m.id), at10: FR.medalNeed10(m, W),
    coins: FR.medalCoins(m, W), acorns: m.acorns ?? 0, trophy: Boolean(m.trophy) }));
}

/** The best rung a score reaches, or null. */
export const medalAt = (ladder, p10) => ladder.reduce((got, m) => (p10 >= m.at10 ? m : got), null);

/**
 * Everything the tent draws, DOM-free (node tests drive it with a plain state).
 * @returns {{ live, open, unlock, level, has, isOpen, closesAt, opensAt, W, W10, p10, ladder, medal, next, toNext10,
 *   by, entries, entered, last, cap }}
 */
export function fairView(state, pid, now) {
  const level = levelOf(state);
  const live = systemLive(FAIR);
  const open = live && level >= FAIR.unlock;
  const w = weekOf(state, now);
  const cur = state.farm.fair?.cur ?? null;
  const thisWeek = Boolean(cur && cur.w === w);
  const isOpen = Boolean(FR.openFair(state, now));
  const closesAt = FR.fairCloseAt(state, w);
  const opensAt = now >= closesAt ? FR.fairOpenAt(state, w + 1) : FR.fairOpenAt(state, w);
  const W = thisWeek ? cur.W : FR.fairTarget(Math.max(FAIR.unlock, level));
  const p10 = thisWeek ? cur.p : 0;
  const ladder = medalLadder(W, state);
  const medal = medalAt(ladder, p10);
  const next = ladder.find((m) => m.at10 > p10) ?? null;
  const cap = FR.entryLimit(state);
  const ent = thisWeek ? cur.ent : {};
  const premium = PREMIUMS();
  const entries = [];
  for (const it of CONTENT.items.values()) {
    const pts10 = FR.entryPoints10(state, it.id, level);
    if (pts10 <= 0) continue;
    const have = available(state, it.id);
    const entered = ent[it.id] ?? 0;
    if (have <= 0 && entered <= 0) continue;
    entries.push({ item: it.id, name: it.name, tier: it.tier, duet: it.tier === 'duet', prized: premium.has(it.id), have, entered,
      left: Math.max(0, cap - entered), pts10 });
  }
  const canEnter = (e) => Number(e.left > 0 && e.have > 0);
  entries.sort((a, b) => canEnter(b) - canEnter(a) || b.pts10 - a.pts10 || (a.item < b.item ? -1 : 1));
  return {
    live, open, unlock: FAIR.unlock, level, has: thisWeek, isOpen, closesAt, opensAt, W, W10: W * 10, p10, ladder, medal, next,
    toNext10: next ? next.at10 - p10 : 0, by: thisWeek ? { ...cur.by } : {}, entries, cap,
    entered: Object.keys(ent).sort().map((item) => ({ item, n: ent[item], pts10: FR.entryPoints10(state, item, level) * ent[item] })),
    last: lastResult(state), maxAt10: ladder.length ? ladder.at(-1).at10 : W * 10,
  };
}

/** This farmer's ceremonies not seen yet, oldest first (the rules' queue, QA2 RC-14; [] on an older rules build). */
const unseenOf = (state, pid) => (pid && typeof FR.ceremonyQueue === 'function' ? FR.ceremonyQueue(state, pid) : []);

/**
 * A ceremony as the card draws it: { w, W10, p10, medal, name, metal, rank, coins, acorns, trophy, by, next, at,
 * seen } (by = each player's points, from the week's record while it is still the current one). With `pid`: the
 * oldest one that farmer has not seen (a partner away for two Sundays sees both, one by one; QA2 RC-14), or week `w`
 * when asked; else the newest.
 */
export function lastResult(state, pid = null, w = null) {
  const q = unseenOf(state, pid);
  const last = state.farm.fair?.last;
  const l = w !== null && w !== undefined ? q.find((c) => c.w === w) ?? (isObj(last) && last.w === w ? last : null) : q[0] ?? last;
  if (!isObj(l)) return null;
  const cur = state.farm.fair.cur;
  const ladder = medalLadder(l.W, state);
  const m = ladder.find((x) => x.id === l.medal) ?? null;
  // who brought what: the record's own split once the rules keep it, else the week's record while it is still there
  const by = isObj(l.by) ? { ...l.by } : cur && cur.w === l.w ? { ...cur.by } : {};
  return { w: l.w, W10: l.W * 10, p10: l.p, medal: l.medal, name: m ? m.name : null, metal: m ? m.metal : 'none', rank: m ? m.rank : '',
    coins: l.coins, acorns: l.acorns, trophy: l.trophy, by, at: l.at, seen: { ...(l.seen ?? {}) },
    next: m ? ladder[ladder.indexOf(m) + 1] ?? null : ladder[0] ?? null };
}

/** True when this player has a ceremony to see (recent: within 8 days of it), the catch-up for an absent partner. */
export function ceremonyDue(state, pid, now) {
  if (typeof FR.ceremonyQueue === 'function') {
    const c = unseenOf(state, pid)[0];
    return Boolean(isObj(c) && state.players?.[pid] && now - c.at < 8 * DAY);
  }
  const l = state.farm.fair?.last;
  if (!isObj(l) || !state.players?.[pid] || l.seen?.[pid]) return false;
  return now - l.at < 8 * DAY;
}

// ---- medal art (inline SVG in the panels' flat-fill + ink-outline style) ----------------------------------------

const METALS = {
  bronze: { face: '#D99155', rim: '#9A5A2A', shine: '#F3C08E', ribbon: ['#C8473A', '#E8556E'] },
  silver: { face: '#D6DEE6', rim: '#8C9AA8', shine: '#FFFFFF', ribbon: ['#2B78B5', '#4AA8E8'] },
  gold: { face: '#F5C542', rim: '#B8860B', shine: '#FFF2B8', ribbon: ['#C8473A', '#F5C542'] },
  platinum: { face: '#E6EEF5', rim: '#7E8FA6', shine: '#FFFFFF', ribbon: ['#6A4FB0', '#9B6BD6'] },
  none: { face: '#E9DCC0', rim: '#B89A6A', shine: '#FFF7E6', ribbon: ['#B89A6A', '#D9C49A'] },
};

/** A Fair medal: a round medal on a two-tail ribbon with its rank numeral (I / II / III). */
export function medalArt(metal, rank = '', size = 56, { dim = false } = {}) {
  const c = METALS[metal] ?? METALS.none;
  const ink = '#3E2612';
  const svg = sv('svg', { viewBox: '0 0 56 64', width: size, height: Math.round((size * 64) / 56),
    class: `wk-medal m-${metal}${dim ? ' dim' : ''}`,
    'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    sv('path', { d: 'M18 2 h8 l6 22 h-8 z', fill: c.ribbon[0], stroke: ink, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
    sv('path', { d: 'M38 2 h-8 l-6 22 h8 z', fill: c.ribbon[1], stroke: ink, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
    sv('circle', { cx: 28, cy: 40, r: 19, fill: c.rim, stroke: ink, 'stroke-width': 2.2 }),
    sv('circle', { cx: 28, cy: 40, r: 14.5, fill: c.face, stroke: c.rim, 'stroke-width': 1.5 }),
    sv('path', { d: 'M18 34 q4 -7 12 -7', fill: 'none', stroke: c.shine, 'stroke-opacity': 0.85, 'stroke-width': 2.6,
      'stroke-linecap': 'round' }),
    metal === 'platinum'
      ? sv('path', { d: 'M28 30 l2.9 6 6.6 .9 -4.8 4.6 1.2 6.5 -5.9 -3.1 -5.9 3.1 1.2 -6.5 -4.8 -4.6 6.6 -.9 z',
        fill: '#9B6BD6', stroke: ink, 'stroke-width': 1.3, 'stroke-linejoin': 'round' })
      : (rank ? sv('text', { x: 28, y: 45.5, 'text-anchor': 'middle', class: 'wk-medal-rank', fill: ink }, rank) : null),
  );
  return svg;
}

// ---- the Fair tent ----------------------------------------------------------------------------------------------

const PEMBERTON = {
  start: 'The tent is open! Bring me your finest bakes and preserves. Variety, mind you: ten of a kind at most.',
  close: 'One more push and that medal is yours. The bell rings at eight on Sunday!',
  gold: 'Gold-standard work, the both of you. I am quite beside myself.',
  closed: 'The judging is done! Fresh tables go up on Monday morning.',
  setup: 'The tables are going up as we speak. The tent opens in a moment.',
};

export const fairPanel = {
  title: 'The County Fair',
  icon: 'fair_rosettes_display',
  size: 'full',
  topics: ['fair', 'inventory', 'overflow', 'xp', 'players', 'meta', 'album'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const type = () => actionOf('fairEnter');
    const sig = () => {
      const v = fairView(ctx.store.state, ctx.store.pid, ctx.now());
      return [v.open, v.has, v.isOpen, v.W, v.p10, v.by, v.entries.map((e) => [e.item, e.have, e.entered, e.pts10]),
        v.last && [v.last.w, v.last.medal]];
    };
    const update = kit.memo(body, sig, render);
    // the window flips (Sunday 20:00, Monday 00:00) without a store change: look again once a minute
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = fairView(st, ctx.store.pid, now);
      if (!v.open) {
        fill(body, lockedBody('g', 'The County Fair', [
          'Every week the County Fair sets a target for your farm.',
          'Enter your best bakes, preserves and duet goods: each scores points, and duet goods count double.',
          'Blue-ribbon harvests score on their own. Medals pay coins and Acorns on Sunday at 20:00.',
        ], v.unlock, v.level, v.live));
        return;
      }
      const chip = v.isOpen
        ? clockChip(kit, { label: 'Judging Sunday 20:00 ·', at: v.closesAt, doneText: 'judging now' })
        : clockChip(kit, { label: 'Next Fair opens Monday ·', at: v.opensAt, doneText: 'opening now', cls: 'closed' });
      const line = !v.has ? PEMBERTON.setup : !v.isOpen ? PEMBERTON.closed : v.medal && v.medal.metal === 'gold' ? PEMBERTON.gold
        : v.next && v.p10 > 0 && v.toNext10 * 100 <= v.W10 * 15 ? PEMBERTON.close : PEMBERTON.start;
      fill(body,
        v.isOpen
          ? banner('g', 'This week\'s Fair', `${weekLabel(v.closesAt, st)} · ten of a kind · duet goods count double`, { chip })
          : banner('g', 'The judging is done', 'Medals were paid on Sunday at 20:00', { chip }),
        h('div.wk-fair-top', speech('pemberton', line), ladderCard(st, v)),
        h('div.wk-fair-cols',
          h('section.wk-col.wk-entries-col', h('h3.pn-h', h('span', 'Enter your goods')), entriesGrid(st, v)),
          h('aside.wk-col.wk-side', tablesCard(st, v), rulesCard(v))));
      kit.refresh();
      kit.tick();
      if (ctx.args.item && !ctx.wkRang) focusOn(ctx.wkRang = body.querySelector(`[data-item="${CSS.escape(ctx.args.item)}"]`));
    }

    function ladderCard(st, v) {
      const max = Math.max(v.maxAt10, v.p10, 1);
      const marks = v.ladder.map((m) => {
        const got = v.p10 >= m.at10;
        const tip = `${m.name}: ${fmtPts(m.at10)} points · ${fmt(m.coins)} coins`
          + `${m.acorns ? ` + ${m.acorns} Acorns` : ''}${m.trophy ? ' + a trophy' : ''}`;
        return h(`span.wk-rung${got ? '.got' : ''}${v.next === m ? '.next' : ''}`, {
          style: { left: `${(m.at10 / max) * 100}%` }, title: tip, role: 'img', 'aria-label': tip, dataset: { medal: m.id },
        }, medalArt(m.metal, m.rank, 34, { dim: !got && v.next !== m }));
      });
      const nextLine = v.next
        ? h('p.wk-next', h('b', `${fmtPts(v.toNext10)} more points`), ` to ${v.next.name}:`,
          price({ coins: v.next.coins, acorns: v.next.acorns }),
          v.next.trophy ? h('span.wk-plus', '+ a trophy') : null)
        : h('p.wk-next', h('b', 'Top of the ladder!'), ' Every medal of the week is yours.');
      const nowLine = v.medal
        ? h('span.wk-now-medal', medalArt(v.medal.metal, v.medal.rank, 30), h('b', v.medal.name),
          h('small', `${v.isOpen ? 'pays' : 'paid'} ${fmt(v.medal.coins)} coins${v.medal.acorns ? ` + ${v.medal.acorns} Acorns` : ''}`
            + `${v.isOpen ? ' on Sunday' : ''}`))
        : h('span.wk-now-medal.none', h('small', `Bronze I at ${fmtPts(v.ladder[0]?.at10 ?? 0)} points`));
      return h('section.wk-ladder', { 'aria-label': 'Medal ladder' },
        h('div.wk-ladder-head',
          h('div.wk-score', h('b.wk-score-n', fmtPts(v.p10)), h('span', `of ${fmtPts(v.W10)} points`),
            h('small', 'the week\'s target: one evening of your best goods')),
          nowLine),
        h('div.wk-track', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(max / 10)),
          'aria-valuenow': String(Math.round(v.p10 / 10)),
          'aria-label': `${fmtPts(v.p10)} of ${fmtPts(v.W10)} points` },
        h('span.wk-track-fill', { style: { '--p': String(Math.min(1, v.p10 / max)) } }),
        ...marks),
        v.isOpen ? nextLine : null,
        splitBar(st, v.by, { format: (p) => `${fmtPts(p)} pts`, label: 'Points by farmer' }));
    }

    function entriesGrid(st, v) {
      if (!v.isOpen) {
        return h('div.wk-empty', svgIcon('ribbon', 44),
          h('p', v.has || v.last ? 'The tables are cleared for the judging.' : 'The tent opens any moment now.'),
          h('small', 'Bring your goods when the next Fair opens on Monday.'));
      }
      const t = type();
      const ready = v.entries.filter((e) => e.have > 0 && e.left > 0);
      if (!v.entries.length) {
        return h('div.wk-empty', svgIcon('ribbon', 44), h('p', 'Nothing to enter yet.'),
          h('small', 'Workshop goods (Bread, Cheese, Cookies…), duet goods (they count double) and blue-ribbon animal '
            + `goods can be entered, ${v.cap} of each a week.`));
      }
      return h('div.wk-entries', { role: 'list', 'aria-label': `${ready.length} goods you can enter` },
        ...v.entries.map((e) => entryCard(v, e, t)));
    }

    function entryCard(v, e, t) {
      const most = Math.max(1, Math.min(e.left, e.have));
      const n5 = Math.min(5, most);
      const count = `${e.entered} of ${v.cap} entered this week`;
      const pips = h('span.wk-pips', { title: count, 'aria-label': count, role: 'img' },
        ...Array.from({ length: v.cap }, (_, i) => h(`i${i < e.entered ? '.on' : ''}`)));
      const hint = (n) => () => (e.left <= 0 ? { texts: { CAP: `All ${v.cap} entered this week` } } : need(e.item, n - e.have));
      return h(`article.wk-entry${e.left <= 0 ? '.full' : ''}`, { role: 'listitem', dataset: { item: e.item } },
        hintable(h('div.wk-entry-art', icon(e.item, { size: 56, alt: '' }),
          e.duet ? h('span.wk-x2', { title: 'A duet good: counts double at the Fair' }, '♥ ×2')
            : e.prized ? h('span.wk-x2.prized', { title: 'A blue-ribbon good: counts double' }, '×2') : null), e.item),
        h('div.wk-entry-text', h('b', e.name), h('span.wk-each', `${fmtPts(e.pts10)} points each`),
          h('small', `${fmt(e.have)} in the barn`)),
        // short words beside the ten pips: "10 left" fits the narrowest card at 1366 px (QA2 UI-08: it spilled 3-8 px)
        h('div.wk-entry-cap', pips, h('small', e.left > 0 ? `${e.left} left` : `All ${v.cap} in`)),
        h('div.wk-entry-acts',
          kit.button({ label: 'Enter 1', cls: 'btn--small btn--paper', key: `fair:${e.item}:1`, type: t,
            args: { item: e.item, qty: 1 }, hint: hint(1), data: { enter: e.item } }),
          n5 > 1 ? kit.button({ label: `Enter ${n5}`, cls: 'btn--small btn--sun', key: `fair:${e.item}:n`, type: t,
            args: { item: e.item, qty: n5 }, hint: hint(n5) }) : null),
        e.left > 0 && e.have > 0 ? h('span.wk-entry-gain', `${most} more would add ${fmtPts(e.pts10 * most)} points`) : null);
    }

    function tablesCard(st, v) {
      const list = v.entered.map((r) => h('li.wk-log-row', icon(r.item, { size: 28 }),
        h('span', `${fmt(r.n)} × ${itemOf(r.item)?.name ?? r.item}`),
        h('b', `+${fmtPts(r.pts10)}`)));
      const fromEntries = v.entered.reduce((n, r) => n + r.pts10, 0);
      const ribbons = Math.max(0, v.p10 - fromEntries);
      if (ribbons > 0) {
        list.push(h('li.wk-log-row', svgIcon('ribbon', 26), h('span', 'Blue-ribbon harvests'), h('b', `+${fmtPts(ribbons)}`)));
      }
      return h('section.wk-card', h('h3.pn-h', h('span', 'On the tables')),
        list.length ? h('ul.wk-log', ...list) : h('p.wk-muted', 'Nothing entered yet this week. Blue-ribbon harvests score by themselves.'),
        v.last ? lastLine(v.last) : null);
    }

    function lastLine(l) {
      return h('div.wk-last', medalArt(l.metal, l.rank, 30, { dim: !l.medal }),
        h('div', h('b', l.name ? `Last Fair: ${l.name}` : 'Last Fair: no medal'),
          h('small', `${fmtPts(l.p10)} of ${fmtPts(l.W10)} points${l.coins ? ` · ${fmt(l.coins)} coins` : ''}`)));
    }

    function rulesCard(v) {
      return h('section.wk-card.wk-rules', h('h3.pn-h', h('span', 'How the judging works')),
        h('ul.wk-bullets',
          h('li', 'Workshop goods score their value ÷ 100. ', h('b', 'Duet goods count double.')),
          h('li', `At most ${v.cap} of one good a week: variety wins.`),
          h('li', 'Blue-ribbon crops, fruit and animal goods score as you harvest them.'),
          h('li', 'Entered goods stay at the Fair. Medals pay on Sunday at 20:00.')),
        // M2: the league IS the Fair's points; the horse show doubles the Show Ribbon (ui-league's panels)
        h('div.wk-links',
          leagueOpen(ctx.store.state) && ctx.ui.panels.has('league') ? h('button.btn.btn--paper.btn--small', { type: 'button',
            on: { click: () => ctx.ui.panels.open('league') } }, 'The County League') : null,
          horseShowOpen(ctx.store.state) && ctx.ui.panels.has('horseShow') ? h('button.btn.btn--paper.btn--small',
            { type: 'button', on: { click: () => ctx.ui.panels.open('horseShow') } }, 'The horse show') : null));
    }

    update(true);
    if (!ctx.args.item && !Number.isInteger(ctx.args.i)) requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

/** "5–11 Oct" for the Fair week that closes at `closesAt` (the farm's zone). */
export function weekLabel(closesAt, state) {
  const tz = state?.meta?.tz || 'UTC';
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' });
    const a = f.formatToParts(closesAt - 6 * DAY + 4 * 3_600_000);
    const b = f.formatToParts(closesAt);
    const d = (p) => p.find((x) => x.type === 'day')?.value;
    const m = (p) => p.find((x) => x.type === 'month')?.value;
    return m(a) === m(b) ? `${d(a)}–${d(b)} ${m(b)}` : `${d(a)} ${m(a)} – ${d(b)} ${m(b)}`;
  } catch {
    return '';
  }
}

// ---- the ceremony card ------------------------------------------------------------------------------------------

export const ceremonyPanel = {
  title: 'The Fair results',
  icon: 'ribbon_trophy',
  size: 'card',
  mount(body, ctx) {
    const st = ctx.store.state;
    const c = lastResult(st, ctx.store.pid, Number.isSafeInteger(ctx.args?.w) ? ctx.args.w : null);
    if (!c) { fill(body, h('p.wk-muted', 'No results yet.')); return {}; }
    const me = ctx.store.pid;
    const won = Boolean(c.medal);
    const mine = c.by[me] ?? 0;
    const theirs = Object.entries(c.by).filter(([k, p]) => k !== me && p > 0);
    const lead = won
      ? `${fmtPts(c.p10)} of ${fmtPts(c.W10)} points. Judge Pemberton pins the ${c.metal} medal on your stall.`
      : `${fmtPts(c.p10)} points this week. Bronze starts at ${fmtPts(c.next ? c.next.at10 : 0)}: a few bakes next week will do it.`;
    const thanks = theirs.length && mine > 0
      ? `You brought ${fmtPts(mine)} points, ${theirs.map(([pid, p]) => `${st.players?.[pid]?.name ?? 'your partner'} ${fmtPts(p)}`)
        .join(', ')}. Well judged, the two of you.`
      : null;
    fill(body,
      h('div.wk-cere', { dataset: { metal: c.metal } },
        h('div.wk-cere-art', h('img', { src: '/assets/art/quests/g_600.webp', alt: '', decoding: 'async' }),
          h('div.wk-cere-medal', medalArt(c.metal, c.rank, 112, { dim: !won }))),
        ctx.args.catchUp ? h('p.wk-cere-away', 'While you were away, the Fair was judged') : null,
        h('h2.wk-cere-title', won ? `${c.name}!` : 'A good try!'),
        h('p.wk-cere-lead', lead),
        won ? h('div.wk-cere-pay', price({ coins: c.coins, acorns: c.acorns }),
          c.trophy ? h('span.wk-plus', icon(c.trophy, { size: 30 }), 'a trophy in the build tray') : null) : null,
        splitBar(st, c.by, { format: (p) => `${fmtPts(p)} pts`, label: 'Points by farmer' }),
        thanks ? h('p.wk-cere-thanks', thanks) : null,
        h('div.wk-cere-acts',
          h('button.btn.btn--sun', { type: 'button', on: { click: () => ctx.close() } }, won ? 'Hooray!' : 'Next week, then!'),
          h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => { ctx.close(); ctx.ui.panels.open('fair'); } } },
            'See the Fair'))));
    return {};
  },
};

// ---- install: register the weekly panels, their dock buttons, badges and the ceremony hook ----------------------

function ensureCss() {
  ensureStylesheet(CSS_HREF);
}

/** A spec whose dock button appears only once its system is open on this farm (the drip-feed: no dead buttons). */
export function withDock(spec, sys, dock, store) {
  return Object.defineProperty({ ...spec }, 'dock', {
    enumerable: true,
    get: () => (store && store.state && systemOpen(sys, store.state) ? dock : null),
  });
}

/** The Fair badge's tone: red only on the last day before judging, calm the rest of the week (QA2 UI-03). Pure. */
export function fairTone(state, pid, now) {
  const v = fairView(state, pid, now);
  return v.isOpen && v.closesAt - now <= DAY ? null : 'calm';
}

/** The Fair's dock badge: '!' while a ceremony waits, or when the goods in the barn reach the next medal now. Pure. */
export function fairBadge(state, pid, now) {
  if (!systemOpen(FAIR, state)) return null;
  const v = fairView(state, pid, now);
  if (!v.isOpen || !v.next) return null;
  const reach = v.entries.reduce((n, e) => n + e.pts10 * Math.min(e.left, e.have), 0);
  return reach >= v.toNext10 ? '!' : null;
}

/**
 * Register the weekly panels (fair, fairCeremony, barge, townsfolk, town) into the shell's registry, add their mini
 * dock buttons once each system is open, keep their dock badges, and open the ceremony card for a confirmed Fair
 * result this player has not seen. Returns an uninstall function.
 */
export function installWeekly(ui, deps = {}) {
  ensureCss();
  const off = [];
  let dead = false;
  const store = deps.store || ui.store || globalThis.__hh?.store || null;
  (async () => {
    const [{ bargePanel, bargeBadge, bargeTone }, { townsfolkPanel, townsfolkBadge, townsfolkTone }, { townPanel, townBadge }, C] = await Promise.all([
      import('./barge.js'), import('./townsfolk.js'), import('./town.js'), import('../../../../shared/content/index.js')]);
    if (dead) return;
    const docks = {
      fair: { label: 'Fair', icon: 'ribbon_rosette', order: 6, mini: true, hint: 'The County Fair: enter goods, win medals' },
      barge: { label: 'Barge', icon: 'wooden_crate', order: 7, mini: true, hint: 'Captain Reed\'s River Barge' },
      town: { label: 'Village', icon: 'ferry_landing_souvenir', order: 8, mini: true,
        hint: 'The Hollow Village: Town Projects and the townsfolk board' },
    };
    off.push(ui.panels.register('fair', withDock(fairPanel, FAIR, docks.fair, store)));
    off.push(ui.panels.register('fairCeremony', ceremonyPanel));
    off.push(ui.panels.register('barge', withDock(bargePanel, C.BARGE, docks.barge, store)));
    off.push(ui.panels.register('town', withDock(townPanel, C.TOWN_PROJECT_RULES, docks.town, store)));
    off.push(ui.panels.register('townsfolk', townsfolkPanel));
    if (store) {
      // [badge, tone]: a tone function answers 'calm' (something to do) or null (red: the week closes within a day)
      off.push(startWeeklyBadges(ui, store, { fair: [fairBadge, fairTone], barge: [bargeBadge, bargeTone],
        townsfolk: [townsfolkBadge, townsfolkTone], town: [townBadge, () => 'calm'] }));
      off.push(startCeremony(ui, store));
    }
  })().catch((err) => console.error('weekly panels failed to install', err));
  return () => { dead = true; for (const f of off.splice(0)) { try { f(); } catch { /* gone */ } } };
}

/** Show the ceremony card once per player and week: on the live result (both screens) and on the catch-up. */
function startCeremony(ui, store) {
  let live = false;
  const shownW = new Set();
  const check = () => {
    const st = store.state;
    if (!st || !ui.panels.has('fairCeremony')) return;
    const now = store.now();
    if (!ceremonyDue(st, store.pid, now) || ui.panels.isOpen('fairCeremony')) return;
    // the oldest unseen one first; its markSeen moves the queue on and the next change opens the next (QA2 RC-14)
    const w = unseenOf(st, store.pid)[0]?.w ?? st.farm.fair.last.w;
    if (shownW.has(w)) return;                       // once per week and page, even if its markSeen did not land
    shownW.add(w);
    ui.panels.open('fairCeremony', { w, catchUp: !live }, { stack: true });
    live = false;
    if (has('markSeen')) store.act('markSeen', { kind: 'fair', id: String(w) });
  };
  const offs = [
    store.on('celebrate', ({ ev } = {}) => { if (ev && ev.e === 'fairCeremony') { live = !ev.catchUp; queueMicrotask(check); } }),
    store.on('change', (ch) => { if (ch.source !== 'local' && (ch.topics.has('fair') || ch.topics.has('*'))) setTimeout(check, 0); }),
    // a second missed Sunday waits behind the first card: closing it shows the next (QA2 RC-14)
    ui.panels.on?.('close', (name) => { if (name === 'fairCeremony') setTimeout(check, 400); }),
  ].filter((f) => typeof f === 'function');
  setTimeout(check, 0);
  return () => { for (const f of offs) f(); };
}

const has = (type) => pick(type) === type;

/** Recompute the weekly badges on farm changes, at most every 400 ms (a drag-paint stroke fires dozens). */
function startWeeklyBadges(ui, store, fns) {
  let t = 0;
  const run = () => {
    t = 0;
    const st = store.state;
    if (!st) return;
    const now = store.now();
    for (const [name, [fn, toneFn]] of Object.entries(fns)) {
      let b = null;
      let tone = null;
      try {
        b = fn(st, store.pid, now);
        tone = b ? toneFn(st, store.pid, now) : null;
      } catch (err) { console.error(`weekly badge ${name} failed`, err); }
      ui.panels.badge(name, b, tone);
    }
  };
  const kick = () => { if (!t) t = setTimeout(run, 400); };
  const offs = [store.on('change', kick), store.on('welcome', kick)].filter((f) => typeof f === 'function');
  const iv = setInterval(kick, 60_000);
  kick();
  return () => { clearTimeout(t); clearInterval(iv); for (const f of offs) f(); };
}

