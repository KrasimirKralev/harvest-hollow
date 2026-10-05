// Confirmed-only celebrations (GDD §7.2, tech §0 #15): level-up (240 BPM: four confetti pulses 250 ms apart, light
// rays behind a big star, the banner drops with outBack, then a NON-modal unlock banner with "Show me"), personal
// titles, achievements (a rosette slides in from the right edge and swings), quest letters, duets and together
// moments, and the Level-up Bloom (owner rule 2026-10-04: a new level finishes everything growing): a sparkle wave over
// every crop, tree and animal that just finished and the "New level! Everything on the farm is ready" card, on both
// screens. Nothing here ever blocks input: the overlay has pointer-events: none. ui-shell lane.
//
//   celebrate(ev)            one confirmed event from store 'celebrate' (CELEBRATIONS) or a personal levelUp
//   unlocksFor(level)        the things and systems that arrive at `level` (pure; tests)
//   bloomCounts(state, ids)  what a Bloom finished, by kind: { crops, trees, animals } (pure; tests)
import { CONTENT, unlocksAt, isLive, levelFromXp, defOf } from '../../../shared/content/index.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { nextSystemCard } from '../../../shared/rules/actions/social.js';
import { legacyRewardAt } from '../../../shared/rules/actions/legacy.js';
import { BOOSTS } from '../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, fmtDuration, touchPlayer, touchText } from './dom.js';
import { unlockName, unlockIcon } from './hud.js';

const SHOWN_FAMILIES = ['crops', 'trees', 'animals', 'homes', 'buildings', 'recipes', 'feeds', 'tools', 'decor', 'expansions', 'barn'];

/** What a level brings: things (with icons) in display order, and the system names (features). Pure. */
export function unlocksFor(level) {
  const rows = unlocksAt(level);
  const things = [];
  for (const fam of SHOWN_FAMILIES) {
    for (const r of rows) if (r.family === fam) things.push({ ...r, name: unlockName(r), icon: unlockIcon(r) });
  }
  const systems = rows.filter((r) => r.family === 'features').map((r) => ({ ...r, name: unlockName(r), card: CONTENT.features.get(r.id)?.card ?? null }));
  return { things, systems };
}

/** What a Level-up Bloom finished (its `ids`), by kind, for the card: a Giant counts its nine plots. Pure. */
export function bloomCounts(state, ids, breed = false) {
  const out = { crops: 0, trees: 0, animals: breed ? 1 : 0 };      // the Breeding Barn's baby is ready too
  const objs = state && state.farm ? state.farm.objects : {};
  for (const id of Array.isArray(ids) ? ids : []) {
    const o = Object.hasOwn(objs, id) ? objs[id] : null;
    const d = o && defOf(o.def);
    if (!d) continue;
    if (d.kind === 'plot') out.crops++;
    else if (d.kind === 'tree') out.trees++;
    else if (d.layer === 'none') out.animals++;
  }
  return out;
}

/** The building that makes a recipe or feed (its def id), or null. */
function makerOf(id) {
  const r = CONTENT.recipes.get(id) || (CONTENT.feeds && CONTENT.feeds.get(id));
  return r ? r.building ?? null : null;
}

/**
 * Which panel + tab "Show me" opens for an unlock row (the first one that is registered wins). A recipe opens the
 * building that makes it, focused on that recipe (the Journal has no recipe tab: it used to land on Letters;
 * QA wave 1 UI-13); with no such building on the farm yet, the Market shows the building to buy. `state` is
 * optional (tests pass it; without it a recipe goes to the Market's buildings).
 */
export function showMeTarget(row, state = null) {
  switch (row.family) {
    case 'crops': return { panel: 'market', args: { tab: 'seeds', focus: row.id } };
    case 'trees': return { panel: 'market', args: { tab: 'trees', focus: row.id } };
    case 'animals': case 'homes': return { panel: 'market', args: { tab: 'animals', focus: row.id } };
    case 'buildings': return { panel: 'market', args: { tab: 'buildings', focus: row.id } };
    case 'decor': return { panel: 'market', args: { tab: 'decor', focus: row.id } };
    case 'tools': return { panel: 'market', args: { tab: 'tools', focus: row.id } };
    case 'expansions': return { panel: 'expansion', args: { id: row.id } };
    case 'barn': return { panel: 'barn', args: {} };
    case 'recipes': case 'feeds': {
      const b = makerOf(row.id);
      const objs = state ? state.farm.objects : null;
      const id = b && objs ? Object.keys(objs).sort().find((k) => objs[k].def === b) : null;
      if (id) return { panel: 'building', args: { id, focus: row.id } };
      return b && defOf(b) ? { panel: 'market', args: { tab: 'buildings', focus: b } } : null;
    }
    // a new SYSTEM: the panel that explains it, when that panel is registered (ui-collect, ui-weekly; wave 2)
    case 'features': return FEATURE_PANELS[row.id] ?? null;
    default: return null;
  }
}

/** The panel a system unlock opens ("Show me" on the level tour and on the drip-fed system card). */
export const FEATURE_PANELS = Object.freeze({
  collections: { panel: 'collections', args: {} }, restoration: { panel: 'restoration', args: {} },
  farm_beauty: { panel: 'beauty', args: {} }, decor_sets: { panel: 'decorsets', args: { tab: 'sets' } },
  masterwork: { panel: 'decorsets', args: { tab: 'masterwork' } }, county_fair: { panel: 'fair', args: {} },
  barge: { panel: 'barge', args: {} }, town_projects: { panel: 'town', args: {} }, townsfolk: { panel: 'townsfolk', args: {} },
  pets: { panel: 'pets', args: {} },
  // M2 (ui-home's panels)
  nursery: { panel: 'nursery', args: {} }, breeding: { panel: 'breeding', args: {} }, fishing: { panel: 'fishing', args: {} },
  grand_decor: { panel: 'grandDecor', args: {} }, restoration_4: { panel: 'farmhouse', args: { tab: 'restore' } },
  restoration_5: { panel: 'farmhouse', args: { tab: 'restore' } }, restoration_6: { panel: 'farmhouse', args: { tab: 'room' } },
  // M2 (ui-league's panels and the existing ones the M2 systems live in)
  perks: { panel: 'perks', args: {} }, rested_xp: { panel: 'perks', args: {} }, seasonal_track: { panel: 'seasonTrack', args: {} },
  horse_show: { panel: 'horseShow', args: {} }, fair_league: { panel: 'league', args: {} },
  friendly_duel: { panel: 'duel', args: {} }, legacy: { panel: 'legacy', args: {} }, showcase: { panel: 'beauty', args: {} },
  hamper_double: { panel: 'fair', args: {} }, carousel_set: { panel: 'decorsets', args: { tab: 'sets' } },
  gold_mastery: { panel: 'journal', args: { tab: 'mastery' } },
  second_feed_mill: { panel: 'market', args: { tab: 'buildings', focus: 'feed_mill' } },
  second_pie_oven: { panel: 'market', args: { tab: 'buildings', focus: 'pie_oven' } },
  bees: { panel: 'market', args: { tab: 'animals', focus: 'beehive' } }, truffles: { panel: 'market', args: { tab: 'animals', focus: 'pig_pen' } },
  // wave 4b (owner wishes 2026-10-05): the Acorn treasures, the homes that grow with their flock
  acorn_shop: { panel: 'market', args: { tab: 'acorn' } }, growing_homes: { panel: 'market', args: { tab: 'animals' } },
});

const CONFETTI = ['#FFC83D', '#E8554A', '#4AA8E8', '#5DBB3F', '#FF7A8A', '#FFFFFF', '#9B6BD6'];

export function createLevelup(S) {
  const { store, view, ui } = S;
  const layer = document.getElementById('celebrate');
  let showing = null;
  let queue = [];
  let toursAfter = [];        // lower levels of one level-up batch: toured on the same card as the top level

  const still = () => document.body.classList.contains('motion-reduced')
    || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function confettiPulse(delay) {
    if (still()) return;
    for (let i = 0; i < 18; i++) {
      const c = h('i.confetto', { style: { background: CONFETTI[i % CONFETTI.length], borderRadius: i % 3 === 0 ? '50%' : '3px' } });
      layer.append(c);
      const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.35;
      const r = 180 + Math.random() * 240;
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r * 0.7 - 80;
      const spin = (Math.random() - 0.5) * 900;
      const anim = c.animate([
        { transform: 'translate(-50%, -50%) scale(.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 260}px)) scale(.9) rotate(${spin}deg)`, opacity: 0 },
      ], { duration: 1500 + Math.random() * 500, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
      anim.onfinish = () => c.remove();
    }
  }

  function starSvg() {
    const svg = svgIcon('star', 190);
    svg.classList.add('big-star');
    svg.innerHTML = '<path d="M24 2.5l6.5 13.2 14.5 2.1-10.5 10.2 2.5 14.5L24 35.7l-13 6.8 2.5-14.5L3 17.8l14.5-2.1z" fill="#2B78B5" stroke="#1C5283" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="M24 7l5.3 10.7 11.8 1.7-8.5 8.3 2 11.7L24 33.9l-10.6 5.5 2-11.7-8.5-8.3 11.8-1.7z" fill="#4AA8E8"/>'
      + '<path d="M24 8.5l-4.2 8.6-8.8 1.4" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.2" stroke-linecap="round"/>';
    return svg;
  }

  function showLevelUp(ev) {
    const level = ev.level;
    const node = h('div.lvl', { role: 'status', 'aria-label': `Farm level ${level}!` },
      h('div.rays'), starSvg(), h('div.big-num.outlined', String(level)),
      h('div.word.wood.outlined', 'Level up!'),
      h('div.sub', [
        `Farm level ${level}`,
        ev.coins ? ` · +${fmt(ev.coins)} coins` : '',
        ev.acorns ? ` · +${fmt(ev.acorns)} acorns` : '',
        ev.goldenSeeds ? ` · +${fmt(ev.goldenSeeds)} Golden Seeds` : '',
      ].join('')));
    layer.append(node);
    for (let i = 0; i < 4; i++) confettiPulse(i * 250);
    setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 420); }, 2500);
    // the world part (Bloom ripple, sparkles) belongs to the view
    try { view.fx.play(ev); } catch { /* fx lane may not know this event yet */ }
    const extra = toursAfter;
    toursAfter = [];
    const gift = legacyThings(ev);
    // on a phone the tour card covers the middle of the screen: it waits for the star to leave instead of landing on it
    setTimeout(() => unlockTour([level, ...extra], gift), ui.layout?.is?.('phone') ? 2950 : 1300);
    return 3000;
  }

  /** The per-player unlock tour is "seen" once its banner was shown and closed (GDD §6.2 #17, per-player flags). */
  function markLevelSeen(level) {
    const st = store.state;
    const me = st && st.players[store.pid];
    if (!ACTIONS.markSeen || !me || !me.seen || level <= me.seen.lvl || level > levelFromXp(st.farm.xp)) return;
    S.controller.do('markSeen', { kind: 'level', level });
  }

  /** Several levels at once (a catch-up, a reconnect): ONE tour card for all of them, newest level first
   * (GDD §6.2 #17 "3 new things — Show me"), never a stack of cards over the field. */
  function unlockTour(levels, gift = []) {
    const ls = [...new Set(levels)].sort((a, b) => b - a);
    if (ls.length <= 1 && !gift.length) { if (ls.length) unlockBanner(ls[0]); return; }
    const all = ls.map((l) => unlocksFor(l));
    const things = [...all.flatMap((u) => u.things), ...gift];
    const systems = all.flatMap((u) => u.systems);
    // a level with no new thing (M1a from level 13) pays a Legacy gift instead (RC-14): the banner says so
    const title = ls.length > 1 ? `New since level ${ls.at(-1)}` : gift.length && things.length === gift.length
      ? `Level ${ls[0]} gift` : `New at level ${ls[0]}`;
    // M2 Legacy levels (L41+) pay from the GDD §4.6 pool; a level with no unlock before that is RC-14's Legacy gift
    const message = gift.length && things.length === gift.length
      ? (legacyRewardAt(ls[0]) ? `Legacy level ${ls[0] - 40}: every level from here pays a reward.`
        : 'Evening One is complete. More of the valley opens soon.') : '';
    unlockBanner(ls[0], { things, systems, title, message });
  }

  /** The Legacy gift of a level-up with no live unlock (`levelUp.legacy`, RC-14) as banner things. */
  function legacyThings(ev) {
    const out = [];
    if (ev.acornsGift) out.push({ icon: 'acorns', name: `${fmt(ev.acornsGift)} Acorns` });
    if (ev.goldenSeeds) out.push({ icon: 'golden_seeds', name: `A Golden Seed Packet (${fmt(ev.goldenSeeds)} seeds)` });
    if (ev.legacyHearts) out.push({ icon: 'hearts', name: `${fmt(ev.legacyHearts)} Hearts each` });
    for (const d of ev.legacyDecor ?? []) out.push({ icon: d, name: defOf(d)?.name ?? d });
    return out;
  }

  function unlockBanner(level, merged = null) {
    const { things, systems } = merged || unlocksFor(level);
    if (!things.length && !systems.length) { markLevelSeen(level); return; }
    const first = [...things, ...systems].map((t) => ({ t, target: showMeTarget(t, store.state) })).find((x) => x.target && ui.panels.has(x.target.panel));
    const actions = first ? [{ label: 'Show me', kind: 'sky', fn: () => ui.panels.open(first.target.panel, first.target.args) }] : [];
    const sysLine = systems.filter((s) => isLive(CONTENT.features.get(s.id))).map((s) => s.name);
    ui.banner({
      id: `level-${level}`,
      ribbon: merged ? merged.title : `New at level ${level}`,
      message: sysLine.length ? `Also new: ${sysLine.join(', ')}.` : merged?.message || '',
      things: things.slice(0, 8).map((t) => ({ icon: t.icon, name: t.name })),
      actions,
      ttl: 12000,
      onClose: () => markLevelSeen(level),
    });
  }

  // ---- drip-fed system cards (GDD §7.4 F3: at most one new SYSTEM card per ~20 min of play; rules decide which)
  let cardShown = null;
  let quietUntil = 0;
  // a phone has no Shift and no G key: the cards that name one read differently to a touch player (card.touchText in
  // shared/content/features.js when the content grows it; these stand in until then)
  const TOUCH_CARD_TEXT = {
    uproot: 'Long-press a growing crop and tap Pull it up. Inside 10 minutes the seed is refunded in full.',
    pings: 'Menu > Ping, then tap a spot to point it out to your partner; Emotes sit next to it. Notes pinned to a tile wait for them.',
  };
  const cardText = (id, card) => (touchPlayer(S.controller) ? card.touchText ?? TOUCH_CARD_TEXT[id] ?? touchText(card.text, true) : card.text);
  function maybeSystemCard() {
    const st = store.state;
    // the first evening has one teaching voice: Grandma's coach; system cards wait until it is done or hidden
    if (!st || cardShown || performance.now() < quietUntil || ui.panels.top() || S.tutorial?.active()) return;
    let id = null;
    try { id = nextSystemCard(st, store.pid); } catch { return; }
    const f = id && CONTENT.features.get(id);
    if (!f || !f.card) return;
    cardShown = id;
    ui.banner({
      id: `card-${id}`, kind: 'card', ribbon: f.card.title, message: cardText(id, f.card), ttl: 25000,
      things: [], actions: [{ label: 'Got it', kind: 'go', fn: () => {} },
        ...(FEATURE_PANELS[id] && ui.panels.has(FEATURE_PANELS[id].panel) ? [{ label: 'Show me', kind: 'sky', fn: () => ui.panels.open(FEATURE_PANELS[id].panel, FEATURE_PANELS[id].args) }] : [])],
      onClose: () => {
        cardShown = null;
        quietUntil = performance.now() + 60_000;
        if (ACTIONS.markSeen) S.controller.do('markSeen', { kind: 'card', id });
      },
    });
  }
  setInterval(maybeSystemCard, 15_000);
  store.on('welcome', () => {
    quietUntil = performance.now() + 8000;
    // levels reached while this player was away and not toured yet: one banner each (a long absence gets the recap)
    const st = store.state;
    const me = st && st.players[store.pid];
    if (!me || !me.seen) return;
    const away = store.now() - (me.lastSeenAt || store.now());
    const top = levelFromXp(st.farm.xp);
    const levels = [];
    for (let l = me.seen.lvl + 1; l <= top; l++) levels.push(l);
    if (away < 10 * 60_000 && levels.length) setTimeout(() => unlockTour(levels), 1500);
  });

  function medal(tier) {
    const t = Math.max(0, Math.min(2, (tier | 0) - 1));
    const colours = [['#D98E4A', '#A8622A'], ['#C9D3DD', '#8E9AA6'], ['#F5C542', '#D9931F']][t];
    const svg = svgIcon('ribbon', 64);
    svg.classList.add('medal');
    svg.setAttribute('viewBox', '0 0 48 56');
    svg.innerHTML = '<path d="M14 28l-6 24 8-5 5 8 6-22zM34 28l6 24-8-5-5 8-6-22z" fill="#4A7FE8" stroke="#3E2612" stroke-width="2" stroke-linejoin="round"/>'
      + `<circle cx="24" cy="20" r="16" fill="${colours[0]}" stroke="#3E2612" stroke-width="2.5"/>`
      + `<circle cx="24" cy="20" r="11" fill="none" stroke="${colours[1]}" stroke-width="2.5"/>`
      + '<path d="M24 12.5l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.8-3.7 5.3-.8z" fill="#fff" fill-opacity=".85"/>';
    return svg;
  }

  /**
   * A rosette card for a rank, a ribbon or a mastery star. Honours that arrive within 1.5 s of each other merge into
   * ONE card ("3 new ranks: Seed Sower, Weed Puller, Field Hand"): one harvest that crosses three personal levels
   * used to stack three cards down the right edge (QA wave 1 UI-29).
   */
  let last = null;            // { el, at, items: [{ kind, name, title, text, tier }], timer }
  function rosette(title, text, tier, ms = 5000, { kind = 'honour', name = title } = {}) {
    const host = document.getElementById('banners');
    const now = performance.now();
    if (last && last.el.isConnected && !last.leaving && now - last.at < 1500) {
      last.items.push({ kind, name, title, text, tier });
      last.at = now;
      paintRosette(last);
      clearTimeout(last.timer);
      last.timer = setTimeout(() => leave(last), ms);
      return;
    }
    const el = h('div.rosette', { role: 'status' });
    const cur = { el, at: now, items: [{ kind, name, title, text, tier }], timer: 0, leaving: false };
    paintRosette(cur);
    host.prepend(el);
    last = cur;
    cur.timer = setTimeout(() => leave(cur), ms);
  }
  function leave(r) {
    if (!r || r.leaving) return;
    r.leaving = true;
    r.el.style.transition = 'opacity 400ms, transform 400ms'; r.el.style.opacity = '0'; r.el.style.transform = 'translateX(40px)';
    setTimeout(() => { r.el.remove(); if (last === r) last = null; S.toasts?.flushBanners?.(); }, 420);
  }
  function paintRosette(r) {
    const its = r.items;
    const top = its.reduce((a, b) => (b.tier > a.tier ? b : a), its[0]);
    if (its.length === 1) {
      r.el.replaceChildren(medal(top.tier), h('div', h('b', top.title), h('span', top.text)));
      return;
    }
    const kinds = new Set(its.map((x) => x.kind));
    const what = kinds.size > 1 ? 'honours' : { rank: 'ranks', ribbon: 'ribbons', mastery: 'mastery stars' }[[...kinds][0]] ?? 'honours';
    r.el.replaceChildren(medal(top.tier), h('div', h('b', `${its.length} new ${what}!`), h('span', its.map((x) => x.name).join(', '))));
  }

  function play(ev) {
    const me = store.pid;
    const players = store.state ? store.state.players : {};
    const actor = ev.by && Object.hasOwn(players, ev.by) ? players[ev.by] : null;
    switch (ev.e) {
      case 'levelUp':
        if (ev.scope === 'player') {
          if (ev.pid === me && ev.title) rosette(`You are now a ${ev.title}!`, `Personal level ${ev.level}`, 2, 4500, { kind: 'rank', name: ev.title });
          return 0;
        }
        return showLevelUp(ev);
      case 'achievement': {
        const r = CONTENT.ribbons.get(ev.id);
        const mine = !ev.pids || ev.pids.includes(me) || ev.scope !== 'P';
        if (!mine) return 0;
        const together = ev.scope === 'T' || ev.scope === 'F';
        const metal = ['Bronze', 'Silver', 'Gold'][Math.max(0, Math.min(2, (ev.tier || 1) - 1))];
        rosette(r ? r.name : 'A new ribbon!', `${metal} ribbon · ${together ? 'unlocked together!' : 'all yours'}`, ev.tier || 1, 5000, { kind: 'ribbon', name: r ? r.name : 'a ribbon' });
        return 0;
      }
      case 'questDone': {
        const q = CONTENT.quests.get(ev.id);
        ui.banner({
          id: `quest-${ev.id}`, ribbon: 'Quest complete!', kind: 'quest',
          message: q ? `${q.title}${q.done ? `: ${q.done}` : ''}` : 'A letter from Grandma.',
          things: [ev.coins ? { icon: 'coins', name: `${fmt(ev.coins)} coins` } : null, ev.xp ? { icon: 'xp', name: `${fmt(ev.xp)} XP` } : null].filter(Boolean),
          actions: ui.panels.has('journal') ? [{ label: 'Read it', kind: 'sky', fn: () => ui.panels.open('journal', { tab: 'story', focus: ev.id }) }] : [],
          ttl: 8000,
        });
        return 0;
      }
      case 'duet':
        ui.banner({ id: `duet-${ev.recipe || ''}`, ribbon: 'Cooked together ♥', kind: 'duet',
          message: 'Both hands on the same recipe: it cooks at full speed with extra XP and a heart each.',
          things: ev.recipe ? [{ icon: ev.recipe, name: CONTENT.recipes.get(ev.recipe)?.name ?? ev.recipe }] : [], ttl: 7000 });
        return 0;
      case 'together': {
        if (ev.kind === 'goldenHour') {
          ui.banner({ id: 'golden', kind: 'golden', ribbon: 'Golden Hour ✨',
            message: `Everything you start in the next ${fmtDuration((ev.until ?? 0) - store.now()).replace(/ 0\d?s$/, '')} grows 10 % faster. A heart each, and a page for the Memory Book.`,
            things: [], ttl: 10000 });
          S.hud?.renderBuffs();
          return 0;
        }
        if (ev.kind === 'highFive') {
          ui.toast('High five! ✋ +10 % personal XP for 10 minutes', { kind: 'love', ms: 4000 });
          S.hud?.renderBuffs();
          return 0;
        }
        const text = ev.kind === 'combo' ? `Together combo ×${ev.at ?? ''}`.trim()
          : ev.kind === 'challenge' ? 'Couple Challenge complete!'
            : ev.kind === 'task' ? 'Together task done!' : 'Together!';
        ui.toast(`${text} ♥`, { kind: 'love', ms: 3200 });
        return 0;
      }
      case 'bloomed':
        // the Level-up Bloom: the card here, the sparkle wave over everything that finished belongs to the view
        S.toasts?.bloom?.(bloomCounts(store.state, ev.ids, ev.breed));
        try { view.fx.play(ev); } catch { /* fx lane may not know this event yet */ }
        return 0;
      case 'mastery': {
        const d = CONTENT.crops.get(ev.id) || CONTENT.recipes.get(ev.id) || CONTENT.animals.get(ev.id) || CONTENT.trees.get(ev.id);
        rosette(`${d ? d.name : ev.id} mastery ${'★'.repeat(Math.max(1, Math.min(3, ev.star | 0)))}`, 'The farm got better at it: bigger yields from now on', ev.star || 1, 5000, { kind: 'mastery', name: `${d ? d.name : ev.id} ★${Math.max(1, Math.min(3, ev.star | 0))}` });
        return 0;
      }
      default:
        if (actor) void actor;
        return 0;
    }
  }

  /** Level-ups queue (a catch-up after a reconnect may bring several): show the highest, list every unlock. */
  function celebrate(ev) {
    if (!ev || !ev.e) return;
    if (ev.e === 'levelUp' && ev.scope !== 'player') {
      queue.push(ev);
      if (showing) return;
      const run = () => {
        if (!queue.length) { showing = null; return; }
        const batch = queue;
        queue = [];
        const top = batch.reduce((a, b) => (b.level > a.level ? b : a));
        const rest = batch.filter((e) => e !== top).map((e) => e.level);
        if (rest.length) toursAfter = rest;
        const coins = batch.reduce((n, e) => n + (e.coins || 0), 0);
        // a Legacy gift (RC-14: `legacy` on a level with no live unlock) adds to the same banner
        const acornsGift = batch.reduce((n, e) => n + (e.legacy?.acorns || 0), 0);
        // RC-14 (M1) pays seeds (5 = one packet); the M2 Legacy pool pays packets (payPrize): count seeds either way
        const goldenSeeds = batch.reduce((n, e) => n + (e.legacy?.goldenSeeds || 0)
          * (legacyRewardAt(e.level) ? (BOOSTS.goldenSeeds?.seeds ?? 5) : 1), 0);
        const legacyHearts = batch.reduce((n, e) => n + (e.legacy?.hearts || 0), 0);
        const legacyDecor = batch.map((e) => e.legacy?.decor).filter(Boolean);
        const acorns = batch.reduce((n, e) => n + (e.acorns || 0), 0) + acornsGift;
        const ms = play({ ...top, coins, acorns, acornsGift, goldenSeeds, legacyHearts, legacyDecor });
        showing = setTimeout(run, ms);
      };
      run();
      return;
    }
    play(ev);
  }

  return { celebrate, unlockBanner };
}
