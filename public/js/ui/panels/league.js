// The County League and Platinum (GDD §5.6, M2) and the ui-league lane's install (wave 3).
//
// Panels this lane registers (installLeague, bottom of this file):
//   'league'       the league table: the five NPC farms and the couple this week (the rules' live table: the NPCs'
//                  scores grow with the clock to their finals on Sunday), the promotion and drop places, what the couple
//                  needs by Sunday against the NPC finals, the five leagues (the top one needs the Town Fair Grounds),
//                  what the league pays, past weeks, and Platinum (1.40 × W with the Town Fair Grounds: 6 Acorns, the
//                  champion banner, a 24-hour Golden Hour from Monday)
//   'leagueResult' the Sunday card after the Fair ceremony: up, down or stayed, and the league's Acorns
//   'horseShow' (horseshow.js), 'seasonTrack' (season-track.js), 'perks' (perks.js), 'legacy' (legacy.js),
//   'duel' + 'duelResult' (duel.js)
// One mini dock button ("Progress") opens the lane's hub; every lane panel starts with the hub strip (league-kit.js).
// The duel's live score chip sits in the HUD (duel.js startDuel).
//
// The rules decide: every number comes from league-rules.js (the rules-goals helpers: league.js leagueTable,
// npcFinals, topTier; fair.js medals), so a preview never disagrees with Sunday's settlement.
import { h, icon, svgIcon, fmtDuration, createKit, fill, price } from './kit.js';
import { banner, speech, clockChip, lockedBody, medalArt, fmtPts, isObj, toTop, tParts } from './fair.js';
import { ensureStylesheet } from '../dom.js';
import * as FR from '../../../../shared/rules/actions/fair.js';
import {
  leagueOpen, leagueTable, leagueHistory, leagueName, leagueAcorns, platinumOf, trackOf, LEAGUE, npcFarm, levelOf,
} from './league-rules.js';
import { hubNav, hubBadge, hubView, hubSig, crest, farmBarn, rewardChips, rewardParts } from './league-kit.js';
import { t, ordinal as ord, list } from '../../i18n/index.js';

const CSS_HREF = '/css/panels-league.css';

// ---- the view (pure) --------------------------------------------------------------------------------------------

/**
 * Everything the league panel draws, DOM-free: { open, level, unlock, table, tier, top, name, acorns, history, best,
 * platinum, zone, topLocked, line }.
 */
export function leagueView(state, pid, now) {
  const open = leagueOpen(state);
  const level = levelOf(state);
  const table = open ? leagueTable(state, now) : null;
  if (!table) return { open: false, level, unlock: LEAGUE?.unlock ?? 27 };
  const history = leagueHistory(state);
  const zone = table.open ? table.us?.zone ?? null : null;
  return { open: true, level, unlock: LEAGUE.unlock, table, tier: table.tier, top: table.top, name: leagueName(table.tier),
    acorns: table.acorns, history, best: Math.max(table.best ?? 1, table.tier), platinum: platinumOf(state, now), zone,
    topLocked: table.top < LEAGUE.leagues, line: pembertonLine(table, zone) };
}

/** Judge Pemberton's line for the table as it stands (pure). */
export function pembertonLine(tb, zone) {
  if (!tb.open) return t('league.pem.closed');
  if (!tb.us || tb.us.p10 === 0) return t('league.pem.welcome', { league: leagueName(tb.tier) });
  if (tb.secured) return t('league.pem.secured');
  if (zone === 'up') return tb.us.rank === 1 ? t('league.pem.top') : t('league.pem.promo');
  if (zone === 'down' || tb.safe10 > 0) return t('league.pem.careful', { pts: fmtPts(tb.safe10), n: tb.safe10 / 10 });
  if (tb.tier >= tb.top) return tb.top < LEAGUE.leagues ? t('league.pem.grounds') : t('league.pem.finest');
  return tb.upTo10 > 0 ? t('league.pem.upTo', { pts: fmtPts(tb.upTo10), n: tb.upTo10 / 10 }) : t('league.pem.nice');
}

/** The words of a week's move. */
export const moveText = (m) => (m > 0 ? t('league.move.up') : m < 0 ? t('league.move.down') : t('league.move.stay'));

/** "1st" / "1-во" (място, a neuter noun). */
const ordinal = (n) => (Number.isSafeInteger(n) ? ord(n, 'n') : '');

// ---- the panel ---------------------------------------------------------------------------------------------------

export const leaguePanel = {
  get title() { return t('league.title'); },
  icon: 'purple_rosette',
  size: 'full',
  topics: ['fair', 'league', 'xp', 'players', 'meta', 'restore', 'coop', 'track', 'duel', 'inventory'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const sig = () => {
      const st = ctx.store.state;
      const v = leagueView(st, ctx.store.pid, ctx.now());
      return v.open ? [v.tier, v.top, v.table.w, v.table.open, v.table.rows.map((r) => [r.key, r.p10, r.zone]), v.history.length,
        v.platinum.open, v.platinum.p10, Boolean(v.platinum.buff), hubSig(st, ctx.store.pid, ctx.now())]
        : [v.level, hubSig(st, ctx.store.pid, ctx.now())];
    };
    const update = kit.memo(body, sig, render);
    // the NPCs' scores grow with the clock: look again every minute
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const v = leagueView(st, ctx.store.pid, ctx.now());
      if (!v.open) {
        fill(body, hubNav(ctx, 'league'), lockedBody('g', t('league.lockedTitle'), [
          t('league.locked.1'),
          t('league.locked.2'),
          t('league.locked.3'),
        ], v.unlock, v.level));
        return;
      }
      const tb = v.table;
      const chip = tb.open
        ? clockChip(kit, { label: t('league.clock.final'), at: tb.closesAt, doneText: t('weekly.fair.clock.judgingNow') })
        : clockChip(kit, { label: t('league.clock.newWeek'), at: FR.fairOpenAt(st, tb.w + 1), doneText: t('league.clock.anyMoment'), cls: 'closed' });
      const farms = LEAGUE.farms.map((n) => npcFarm(n).name);
      fill(body,
        hubNav(ctx, 'league'),
        banner('g', t('league.banner', { league: v.name }), t('league.bannerSub', { n: v.tier, of: LEAGUE.leagues, farms: farms.join(', '), list: list([...farms, t('league.andYours')]) }),
          { chip, focus: [0.8, 0.45], cls: 'lg-banner' }),
        h('div.lg-top', speech('pemberton', v.line), leagueCard(v)),
        h('div.lg-cols',
          h('section.lg-col', h('h3.pn-h', h('span', tb.open ? t('league.table.week') : t('league.table.final'))), tableCard(st, v)),
          h('aside.lg-col.lg-side', ladderCard(v), platinumCard(st, v), historyCard(v), rulesCard(v))));
      kit.refresh();
      kit.tick();
    }

    function leagueCard(v) {
      const tb = v.table;
      const zoneText = !tb.us ? t('league.zone.first') : !tb.open ? t('league.zone.judged')
        : tb.secured ? t('league.zone.secured')
          : v.zone === 'up' ? t('league.zone.up') : v.zone === 'down' ? t('league.zone.down') : t('league.zone.place', { n: tb.rank, of: tb.rows.length });
      return h(`section.lg-league-card${v.zone ? `.z-${v.zone}` : ''}`, { 'aria-label': t('league.cardLabel', { league: v.name, n: v.tier, of: LEAGUE.leagues }) },
        crest(v.tier, 76, { label: v.name }),
        h('div.lg-league-text',
          h('small', t('league.nOf', { n: v.tier, of: LEAGUE.leagues })),
          h('b', v.name),
          h('span.lg-zone', v.zone === 'up' || tb.secured ? '▲ ' : v.zone === 'down' ? '▼ ' : '', zoneText),
          h('span.lg-pays', t('league.paysWeekly'), price({ acorns: v.acorns }))));
    }

    function tableCard(st, v) {
      const tb = v.table;
      const max10 = Math.max(1, ...tb.rows.map((r) => r.p10));
      const colors = Object.keys(st.players ?? {}).sort().map((p) => st.players[p].color);
      const rows = tb.rows.map((r) => {
        // the zone is a shape and a word, never colour alone (GDD §7.5)
        const zone = r.zone === 'up' ? h('span.lg-mark.up', { title: t('league.mark.up') }, h('span', { 'aria-hidden': 'true' }, '▲'), h('span.sr-only', t('league.mark.upSr')))
          : r.zone === 'down' ? h('span.lg-mark.down', { title: t('league.mark.down') }, h('span', { 'aria-hidden': 'true' }, '▼'), h('span.sr-only', t('league.mark.downSr'))) : h('span.lg-mark');
        return h(`li.lg-row${r.us ? '.us' : ''}${r.zone ? `.z-${r.zone}` : ''}`, { dataset: { key: r.key, rank: String(r.rank), upLine: t('league.line.up'), downLine: t('league.line.down') } },
          h('span.lg-rank', String(r.rank)),
          zone,
          farmBarn(r.npc?.hue ?? Math.max(0, r.npc?.i ?? 0), 38, { colors: r.us ? colors : null }),
          h('span.lg-name', h('b', r.name),
            h('small', r.us ? t('league.together') : r.npc?.motto ? t('league.motto', { farmer: r.npc.farmer, motto: r.npc.motto }) : r.npc?.farmer ?? '')),
          h('span.lg-pts-bar', { 'aria-hidden': 'true' }, h('i', { style: { '--p': String(r.p10 / max10) } })),
          h('span.lg-pts', h('b', fmtPts(r.p10)), h('small', t('league.ptsShort'))));
      });
      let hint = null;
      if (tb.open && tb.us) {
        if (tb.us.p10 === 0) hint = h('p.lg-hint', svgIcon('ribbon', 20), h('span', t('league.hint.none')));
        else if (tb.secured) hint = h('p.lg-hint.up', svgIcon('check', 20), h('span', tParts('league.hint.secured', { b: h('b', t('league.hint.securedB')) })));
        else if (tb.upTo10 > 0 && tb.tier < tb.top) hint = h('p.lg-hint.up', svgIcon('star', 20), h('span', tParts('league.hint.up', { b: h('b', t('weekly.morePts', { pts: fmtPts(tb.upTo10), n: tb.upTo10 / 10 })) })));
        if (tb.safe10 > 0 && tb.us.p10 > 0) {
          hint = h('div.lg-hints', hint, h('p.lg-hint.down', svgIcon('ribbon', 20), h('span', tParts('league.hint.safe', { b: h('b', t('weekly.morePts', { pts: fmtPts(tb.safe10), n: tb.safe10 / 10 })) }))));
        }
      }
      if (!rows.length) {
        // a farm that reached the league after this week's Fair opened plays from next Monday
        return h('div.lg-table-card', h('div.wk-empty', crest(v.tier, 48), h('p', t('league.firstWeek')),
          h('small', t('league.firstWeekNote', { n: LEAGUE.promote }))));
      }
      return h('div.lg-table-card',
        h('ol.lg-table', { 'aria-label': t('league.tableLabel', { league: leagueName(v.tier) }) }, ...rows),
        hint,
        h('div.lg-table-foot',
          h('small', tb.open ? t('league.tableFootOpen') : t('league.tableFootFinal')),
          tb.open ? kit.button({ label: t('league.toFair'), cls: 'btn--small btn--sun', key: 'lg:fair',
            onClick: () => ctx.ui.panels.open('fair'), gate: () => null }) : null));
    }

    function ladderCard(v) {
      const steps = [];
      for (let k = LEAGUE.leagues; k >= 1; k--) {
        const locked = k > v.top;
        steps.push(h(`li.lg-step${k === v.tier ? '.on' : ''}${locked ? '.locked' : ''}`, { dataset: { tier: String(k) } },
          crest(k, 30, { dim: locked }),
          h('span', { dataset: { you: t('league.line.you') } }, leagueName(k)),
          locked ? h('small', svgIcon('lock', 16), t('league.grounds')) : h('small', t('league.acornsWeek', { n: leagueAcorns(k) }))));
      }
      return h('section.wk-card.lg-ladder', h('h3.pn-h', h('span', t('league.five'))), h('ol.lg-steps', ...steps),
        v.best > v.tier ? h('p.wk-muted', t('league.best', { league: leagueName(v.best) })) : null,
        v.topLocked ? h('p.wk-muted', t('league.topLocked', { league: leagueName(LEAGUE.leagues) })) : null);
    }

    function platinumCard(st, v) {
      const p = v.platinum;
      if (!p.live) return null;
      const hours = Math.round(p.goldenHourMs / 3_600_000);
      const reward = h('div.lg-plat-pay', price({ coins: p.coins, acorns: p.acorns }),
        h('span.wk-plus', icon('bunting', { size: 24 }), t('league.rw.banner')),
        h('span.wk-plus', svgIcon('sun', 20), t('league.plat.golden', { n: hours })));
      let lines;
      if (!p.open) {
        lines = [h('p.lg-plat-line', tParts('league.plat.waits', { b: h('b', t('league.plat.grounds')) })),
          kit.button({ label: t('league.plat.ledger'), cls: 'btn--small btn--paper', key: 'lg:ledger', gate: () => null,
            onClick: () => ctx.ui.panels.open('restoration', { id: p.project }) })];
      } else if (p.got) {
        lines = [h('p.lg-plat-line.got', svgIcon('check', 20), tParts('league.plat.got', { b: h('b', t('league.plat.gotB')), p: fmtPts(p.p10), w: fmtPts(p.need10) }))];
      } else if (p.isOpen) {
        lines = [h('p.lg-plat-line', tParts('league.plat.toGo', { b: h('b', t('weekly.morePts', { pts: fmtPts(p.toGo10), n: p.toGo10 / 10 })), need: fmtPts(p.need10) }))];
      } else lines = [h('p.lg-plat-line', t('league.plat.is', { pts: fmtPts(p.need10) }))];
      const buff = p.buff ? h('p.lg-plat-buff', svgIcon('sun', 20),
        p.buff.from > ctx.now() ? h('span', t('league.plat.buffSoon'))
          : h('span', tParts('league.plat.buff', { left: h('b', fmtDuration(p.buff.until - ctx.now())) }))) : null;
      return h(`section.wk-card.lg-plat${p.open ? '' : '.locked'}`,
        h('div.lg-plat-head', medalArt('platinum', '', 46, { dim: !p.open }),
          h('div', h('b', t('league.plat.name')), h('small', t('league.plat.target')))),
        ...lines, buff, reward);
    }

    function historyCard(v) {
      const rows = v.history.slice(0, 6).map((r) => h(`li.lg-hist-row.m${r.move > 0 ? 'up' : r.move < 0 ? 'down' : 'stay'}`,
        crest(Number(r.to ?? r.tier) || 1, 24),
        h('span', h('b', r.p > 0 ? moveText(r.move) : t('league.hist.empty')),
          h('small', r.p > 0 ? t('league.hist.rowPts', { rank: ordinal(r.rank), league: leagueName(Number(r.tier) || 1), pts: fmtPts(r.p) })
            : t('league.hist.row', { rank: ordinal(r.rank), league: leagueName(Number(r.tier) || 1) }))),
        r.acorns ? h('span.lg-hist-pay', `+${r.acorns}`, icon('acorns', { size: 20, alt: t('league.acornsAlt') })) : null));
      return h('section.wk-card.lg-hist', h('h3.pn-h', h('span', t('league.hist.head'))),
        rows.length ? h('ul.lg-hist-list', ...rows) : h('p.wk-muted', t('league.hist.none')));
    }

    function rulesCard(v) {
      return h('section.wk-card.wk-rules', h('h3.pn-h', h('span', t('league.rules.head'))),
        h('ul.wk-bullets',
          h('li', tParts('league.rules.1', { b: h('b', t('league.rules.1b')) })),
          h('li', t('league.rules.2', { n: LEAGUE.promote })),
          h('li', t('league.rules.3', { league: leagueName(v.tier), n: leagueAcorns(v.tier) })),
          h('li', t('league.rules.4')),
          v.table.W ? h('li', t('league.rules.5', { pts: fmtPts(v.table.W * 10) })) : null));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

// ---- the Sunday result card --------------------------------------------------------------------------------------

/**
 * A settled league week as the card draws it (null when none): { w, from (the league it was played in), to, move, rank,
 * acorns, p10, empty, fromName, toName }. With `w`: that week, else the newest.
 */
export function leagueResult(state, w = null) {
  const hist = leagueHistory(state);
  const r = w === null ? hist[0] : hist.find((x) => x.w === w);
  if (!isObj(r)) return null;
  const from = Number(r.tier) || 1;
  const to = Number(r.to ?? from) || from;
  return { w: r.w, from, to, move: r.move ?? to - from, rank: r.rank ?? null, acorns: r.acorns ?? 0, p10: r.p ?? 0,
    empty: !(r.p > 0), fromName: leagueName(from), toName: leagueName(to), rows: (r.npc?.length ?? 5) + 1 };
}

export const leagueResultPanel = {
  get title() { return t('league.res.title'); },
  icon: 'purple_rosette',
  size: 'card',
  mount(body, ctx) {
    const r = leagueResult(ctx.store.state, Number.isSafeInteger(ctx.args?.w) ? ctx.args.w : null);
    if (!r) { fill(body, h('p.wk-muted', t('league.res.none'))); return {}; }
    const head = r.empty ? t('league.res.quiet', { league: r.fromName }) : r.move > 0 ? t('league.res.up', { league: r.toName })
      : r.move < 0 ? t('league.res.down', { league: r.toName }) : t('league.res.stay', { league: r.toName });
    const lead = r.empty ? t('league.res.emptyLead')
      : r.move > 0 ? t('league.res.upLead', { rank: ordinal(r.rank), league: r.fromName })
        : r.move < 0 ? t('league.res.downLead', { rank: ordinal(r.rank), of: r.rows, league: r.toName })
          : r.to >= LEAGUE.leagues ? t('league.res.champions', { rank: ordinal(r.rank), of: r.rows }) : t('league.res.stayLead', { rank: ordinal(r.rank), of: r.rows });
    fill(body, h(`div.lg-res.m${r.move > 0 ? 'up' : r.move < 0 ? 'down' : 'stay'}`,
      h('div.lg-res-art', r.move !== 0 ? [crest(r.from, 64, { dim: true }), h('span.lg-res-arrow', { 'aria-hidden': 'true' }, '➜'), crest(r.to, 100, { label: r.toName })]
        : crest(r.to, 100, { label: r.toName })),
      ctx.args?.catchUp ? h('p.wk-cere-away', t('league.res.away')) : null,
      h('h2.lg-res-title', head),
      h('p.lg-res-lead', lead),
      r.acorns ? h('div.lg-res-pay', h('span', t('league.res.paid')), rewardChips({ acorns: r.acorns })) : null,
      h('div.wk-cere-acts',
        h('button.btn.btn--sun', { type: 'button', on: { click: () => ctx.close() } }, r.move > 0 ? t('league.res.wonderful') : r.move < 0 ? t('league.res.back') : t('league.res.onwards')),
        h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => { ctx.close(); ctx.ui.panels.open('league'); } } }, t('league.res.see')))));
    return {};
  },
};

// ---- install ------------------------------------------------------------------------------------------------------

/** The "Progress" dock button: one mini, on the hub's first open panel (the drip-feed: no button before anything opens). */
export const HUB_DOCK = Object.freeze({ get label() { return t('league.dock'); }, icon: 'rainbow_rosette', order: 5.5, mini: true,
  get hint() { return t('league.dockHint'); } });

/** The panel that carries the hub's dock button for this farmer now (the first open one), or null. Pure. */
export function hubOwner(state, pid, now) {
  if (!state || !pid) return null;
  return hubView(state, pid, now, { badges: false }).find((e) => e.open)?.name ?? null;
}

/**
 * Register the lane's panels, the "Progress" dock button, the hub badge, the league card after the Fair ceremony, the
 * duel's HUD chip and result card. Returns an uninstall function. deps = { store }.
 */
export function installLeague(ui, deps = {}) {
  ensureStylesheet(CSS_HREF);
  const off = [];
  let dead = false;
  const store = deps.store || ui.store || globalThis.__hh?.store || null;
  (async () => {
    const [{ horseShowPanel }, { seasonTrackPanel }, { perksPanel }, { legacyPanel }, D] = await Promise.all([
      import('./horseshow.js'), import('./season-track.js'), import('./perks.js'), import('./legacy.js'), import('./duel.js')]);
    if (dead) return;
    // copy descriptors, not values: a spec's title is a getter that follows the language
    const docked = (name, spec) => Object.defineProperty(Object.defineProperties({}, Object.getOwnPropertyDescriptors(spec)), 'dock', {
      enumerable: true,
      get: () => (store && hubOwner(store.state, store.pid, store.now()) === name ? HUB_DOCK : null),
    });
    const specs = { seasonTrack: seasonTrackPanel, league: leaguePanel, horseShow: horseShowPanel, perks: perksPanel,
      duel: D.duelPanel, legacy: legacyPanel };
    for (const [name, spec] of Object.entries(specs)) off.push(ui.panels.register(name, docked(name, spec)));
    off.push(ui.panels.register('leagueResult', leagueResultPanel));
    off.push(ui.panels.register('duelResult', D.duelResultPanel));
    if (store) {
      off.push(startHubBadge(ui, store));
      off.push(startLeagueCard(ui, store));
      off.push(D.startDuel(ui, store));
      off.push(startBanners(ui, store));
    }
  })().catch((err) => console.error('league panels failed to install', err));
  return () => { dead = true; for (const f of off.splice(0)) { try { f(); } catch { /* gone */ } } };
}

/**
 * A non-modal banner when a Ribbon Track tier is reached (confirmed `trackTier`; several in one stroke make one banner)
 * with "Claim" (the shell's levelup.js does not know the event; the client plays its sound). The duel's invitation and
 * result words are the client's (game/m2-moments.js notices and toasts); this lane adds the HUD chip and the card.
 */
function startBanners(ui, store) {
  let tiers = [];
  let tmr = 0;
  const flush = () => {
    tmr = 0;
    const st = store.state;
    if (!st || !tiers.length) return;
    const top = Math.max(...tiers);
    const n = tiers.length;
    tiers = [];
    const v = trackOf(st, store.now());
    const tier = v?.tiers?.find((x) => x.n === top);
    ui.banner?.({ id: 'lg-track', kind: 'quest', ribbon: t('league.hub.track'),
      message: n > 1 ? t('league.banner.tiers', { a: top - n + 1, b: top }) : t('league.banner.tier', { n: top }),
      things: tier ? rewardParts(tier.reward, { level: levelOf(st), season: v.season }).slice(0, 3).map((x) => ({ icon: x.icon, name: x.text })) : [],
      actions: ui.panels.has('seasonTrack') ? [{ label: t('league.track.claim'), kind: 'sun', fn: () => ui.panels.open('seasonTrack') }] : [], ttl: 9000 });
  };
  const offs = [
    store.on('celebrate', ({ ev } = {}) => {
      if (!ev || ev.e !== 'trackTier' || ev.catchUp) return;
      tiers.push(ev.tier);
      if (!tmr) tmr = setTimeout(flush, 350);
    }),
  ].filter((f) => typeof f === 'function');
  return () => { clearTimeout(tmr); for (const f of offs) f(); };
}

/** The hub's badge on its dock button (whichever panel carries it), at most every 400 ms. */
function startHubBadge(ui, store) {
  let tmr = 0;
  let lastOwner = null;
  const run = () => {
    tmr = 0;
    const st = store.state;
    if (!st || !store.pid) return;
    const now = store.now();
    const owner = hubOwner(st, store.pid, now);
    if (lastOwner && lastOwner !== owner) ui.panels.badge(lastOwner, null);
    lastOwner = owner;
    if (!owner) return;
    let b = null;
    try { b = hubBadge(st, store.pid, now); } catch (err) { console.error('hub badge failed', err); }
    // '!' (an invite, a show ribbon to enter) is "look now"; a count (prizes to claim, points to spend) is calm
    ui.panels.badge(owner, b, b === '!' ? null : 'calm');
  };
  const kick = () => { if (!tmr) tmr = setTimeout(run, 400); };
  const offs = [store.on('change', kick), store.on('welcome', kick)].filter((f) => typeof f === 'function');
  const iv = setInterval(kick, 60_000);
  kick();
  return () => { clearTimeout(tmr); clearInterval(iv); for (const f of offs) f(); };
}

/**
 * The league card follows the Fair ceremony (both are Sunday 20:00): when the ceremony card of a week closes and that
 * week was a league week (the ceremony record carries `lg`), the league card of that week opens, once per page.
 */
function startLeagueCard(ui, store) {
  const shown = new Set();
  let pending = null;
  let catchUp = false;
  const ceremonyOf = (w) => {
    const st = store.state;
    const q = typeof FR.ceremonyQueue === 'function' ? FR.ceremonyQueue(st, store.pid) : [];
    return q.find((c) => c.w === w) ?? (st.farm.fair?.last?.w === w ? st.farm.fair.last : null);
  };
  const offs = [
    ui.panels.on?.('open', (name, args) => {
      if (name !== 'fairCeremony') return;
      const w = Number.isSafeInteger(args?.w) ? args.w : store.state?.farm?.fair?.last?.w ?? null;
      pending = Number.isSafeInteger(w) && ceremonyOf(w)?.lg ? w : null;
      catchUp = Boolean(args?.catchUp);
    }),
    ui.panels.on?.('close', (name) => {
      if (name !== 'fairCeremony' || !Number.isSafeInteger(pending)) return;
      const w = pending;
      pending = null;
      if (shown.has(w)) return;
      shown.add(w);
      // after the ceremony's close animation, and before a second missed ceremony (the Fair opens it 400 ms later)
      setTimeout(() => {
        if (store.state && leagueOpen(store.state) && leagueResult(store.state, w)) ui.panels.open('leagueResult', { w, catchUp }, { stack: true });
      }, 200);
    }),
  ].filter((f) => typeof f === 'function');
  return () => { for (const f of offs) f(); };
}
