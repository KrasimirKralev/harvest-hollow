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
import { banner, speech, clockChip, lockedBody, medalArt, fmtPts, isObj, toTop } from './fair.js';
import { ensureStylesheet } from '../dom.js';
import * as FR from '../../../../shared/rules/actions/fair.js';
import {
  leagueOpen, leagueTable, leagueHistory, leagueName, leagueAcorns, platinumOf, trackOf, LEAGUE, LEAGUE_NAMES, levelOf,
} from './league-rules.js';
import { hubNav, hubBadge, hubView, hubSig, crest, farmBarn, rewardChips, rewardParts } from './league-kit.js';

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
export function pembertonLine(t, zone) {
  if (!t.open) return 'The judging is done. New tables go up on Monday, and the other farms are already baking.';
  if (!t.us || t.us.p10 === 0) return `Welcome to the ${leagueName(t.tier)}! Every Fair point you score counts here: the two of you are one farm.`;
  if (t.secured) return 'Splendid! Whatever the others bake, you finish in a promotion place this week.';
  if (zone === 'up') return t.us.rank === 1 ? 'Top of the table! The others will catch up by Sunday: keep the goods coming.' : 'A promotion place! Hold it until the bell on Sunday.';
  if (zone === 'down' || t.safe10 > 0) return `Careful now: ${fmtPts(t.safe10)} more points by Sunday lift you off the bottom.`;
  if (t.tier >= t.top) return t.top < LEAGUE.leagues ? 'Only the Town Fair Grounds open the league above this one.' : 'The finest farms in the county. Stay sharp!';
  return t.upTo10 > 0 ? `${fmtPts(t.upTo10)} more points by Sunday put you in the promotion places.` : 'Nicely placed. Keep the goods coming!';
}

/** The words of a week's move. */
export const moveText = (m) => (m > 0 ? 'Promoted' : m < 0 ? 'Moved down' : 'Stayed');

const ordinal = (n) => {
  if (!Number.isSafeInteger(n)) return '';
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
};

// ---- the panel ---------------------------------------------------------------------------------------------------

export const leaguePanel = {
  title: 'County League',
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
        fill(body, hubNav(ctx, 'league'), lockedBody('g', 'The County League', [
          'Five neighbouring farms enter the County Fair every week, and so does yours: the two of you as one farm.',
          'After Sunday\'s judging the top two farms of a league move up and the last one moves down.',
          'Each week the league pays its number in Acorns. The top league opens with the Town Fair Grounds.',
        ], v.unlock, v.level));
        return;
      }
      const t = v.table;
      const chip = t.open
        ? clockChip(kit, { label: 'Final table Sunday 20:00 ·', at: t.closesAt, doneText: 'judging now' })
        : clockChip(kit, { label: 'New week Monday ·', at: FR.fairOpenAt(st, t.w + 1), doneText: 'any moment', cls: 'closed' });
      fill(body,
        hubNav(ctx, 'league'),
        banner('g', `The ${v.name}`, `League ${v.tier} of ${LEAGUE.leagues} · ${LEAGUE.farms.join(', ')} and your farm`,
          { chip, focus: [0.8, 0.45], cls: 'lg-banner' }),
        h('div.lg-top', speech('pemberton', v.line), leagueCard(v)),
        h('div.lg-cols',
          h('section.lg-col', h('h3.pn-h', h('span', t.open ? 'This week\'s table' : 'The final table')), tableCard(st, v)),
          h('aside.lg-col.lg-side', ladderCard(v), platinumCard(st, v), historyCard(v), rulesCard(v))));
      kit.refresh();
      kit.tick();
    }

    function leagueCard(v) {
      const t = v.table;
      const zoneText = !t.us ? 'Your first league week starts Monday' : !t.open ? 'Judged: see the result below'
        : t.secured ? 'Promotion secured'
          : v.zone === 'up' ? 'In a promotion place' : v.zone === 'down' ? 'In the drop place' : `Place ${t.rank} of ${t.rows.length}`;
      return h(`section.lg-league-card${v.zone ? `.z-${v.zone}` : ''}`, { 'aria-label': `${v.name}, league ${v.tier} of ${LEAGUE.leagues}` },
        crest(v.tier, 76, { label: v.name }),
        h('div.lg-league-text',
          h('small', `League ${v.tier} of ${LEAGUE.leagues}`),
          h('b', v.name),
          h('span.lg-zone', v.zone === 'up' || t.secured ? '▲ ' : v.zone === 'down' ? '▼ ' : '', zoneText),
          h('span.lg-pays', 'Every week it pays', price({ acorns: v.acorns }))));
    }

    function tableCard(st, v) {
      const t = v.table;
      const max10 = Math.max(1, ...t.rows.map((r) => r.p10));
      const colors = Object.keys(st.players ?? {}).sort().map((p) => st.players[p].color);
      const rows = t.rows.map((r) => {
        // the zone is a shape and a word, never colour alone (GDD §7.5)
        const zone = r.zone === 'up' ? h('span.lg-mark.up', { title: 'Promotion place' }, h('span', { 'aria-hidden': 'true' }, '▲'), h('span.sr-only', 'promotion place'))
          : r.zone === 'down' ? h('span.lg-mark.down', { title: 'Drop place' }, h('span', { 'aria-hidden': 'true' }, '▼'), h('span.sr-only', 'drop place')) : h('span.lg-mark');
        return h(`li.lg-row${r.us ? '.us' : ''}${r.zone ? `.z-${r.zone}` : ''}`, { dataset: { key: r.key, rank: String(r.rank) } },
          h('span.lg-rank', String(r.rank)),
          zone,
          farmBarn(r.npc?.hue ?? Math.max(0, r.npc?.i ?? 0), 38, { colors: r.us ? colors : null }),
          h('span.lg-name', h('b', r.name),
            h('small', r.us ? 'the two of you, together' : r.npc?.motto ? `${r.npc.farmer}: “${r.npc.motto}”` : r.npc?.farmer ?? '')),
          h('span.lg-pts-bar', { 'aria-hidden': 'true' }, h('i', { style: { '--p': String(r.p10 / max10) } })),
          h('span.lg-pts', h('b', fmtPts(r.p10)), h('small', 'pts')));
      });
      let hint = null;
      if (t.open && t.us) {
        if (t.us.p10 === 0) hint = h('p.lg-hint', svgIcon('ribbon', 20), h('span', 'No points yet this week. Score at the Fair to play: a week without a single point holds your league and pays nothing.'));
        else if (t.secured) hint = h('p.lg-hint.up', svgIcon('check', 20), h('span', h('b', 'Promotion secured: '), 'your points already beat the third farm\'s final score.'));
        else if (t.upTo10 > 0 && t.tier < t.top) hint = h('p.lg-hint.up', svgIcon('star', 20), h('span', h('b', `${fmtPts(t.upTo10)} more points`), ' by Sunday 20:00 secure a promotion place.'));
        if (t.safe10 > 0 && t.us.p10 > 0) {
          hint = h('div.lg-hints', hint, h('p.lg-hint.down', svgIcon('ribbon', 20), h('span', h('b', `${fmtPts(t.safe10)} more points`), ' by Sunday keep you off the bottom.')));
        }
      }
      if (!rows.length) {
        // a farm that reached the league after this week's Fair opened plays from next Monday
        return h('div.lg-table-card', h('div.wk-empty', crest(v.tier, 48), h('p', 'Your first league week starts on Monday.'),
          h('small', `Five farms and yours, one table: the Fair points you score from Monday count here. The top ${LEAGUE.promote} move up.`)));
      }
      return h('div.lg-table-card',
        h('ol.lg-table', { 'aria-label': `${leagueName(v.tier)} table` }, ...rows),
        hint,
        h('div.lg-table-foot',
          h('small', t.open ? 'The other farms\' scores grow through the week to their finals on Sunday. Yours are the Fair\'s points, scored together.'
            : 'The table is final. A new week opens on Monday morning.'),
          t.open ? kit.button({ label: 'Enter goods at the Fair', cls: 'btn--small btn--sun', key: 'lg:fair',
            onClick: () => ctx.ui.panels.open('fair'), gate: () => null }) : null));
    }

    function ladderCard(v) {
      const steps = [];
      for (let k = LEAGUE.leagues; k >= 1; k--) {
        const locked = k > v.top;
        steps.push(h(`li.lg-step${k === v.tier ? '.on' : ''}${locked ? '.locked' : ''}`, { dataset: { tier: String(k) } },
          crest(k, 30, { dim: locked }),
          h('span', LEAGUE_NAMES[k - 1]),
          locked ? h('small', svgIcon('lock', 16), 'Fair Grounds') : h('small', `${leagueAcorns(k)} Acorn${leagueAcorns(k) === 1 ? '' : 's'} a week`)));
      }
      return h('section.wk-card.lg-ladder', h('h3.pn-h', h('span', 'Five leagues')), h('ol.lg-steps', ...steps),
        v.best > v.tier ? h('p.wk-muted', `Your best so far: the ${leagueName(v.best)}.`) : null,
        v.topLocked ? h('p.wk-muted', `The ${LEAGUE_NAMES[LEAGUE.leagues - 1]} opens with the Town Fair Grounds (Restoration project 5).`) : null);
    }

    function platinumCard(st, v) {
      const p = v.platinum;
      if (!p.live) return null;
      const hours = Math.round(p.goldenHourMs / 3_600_000);
      const reward = h('div.lg-plat-pay', price({ coins: p.coins, acorns: p.acorns }),
        h('span.wk-plus', icon('bunting', { size: 24 }), 'the champion banner'),
        h('span.wk-plus', svgIcon('sun', 20), `a ${hours}-hour Golden Hour from Monday`));
      let lines;
      if (!p.open) {
        lines = [h('p.lg-plat-line', 'Platinum waits for the ', h('b', 'Town Fair Grounds'), ' (Restoration project 5).'),
          kit.button({ label: 'See the Ledger', cls: 'btn--small btn--paper', key: 'lg:ledger', gate: () => null,
            onClick: () => ctx.ui.panels.open('restoration', { id: p.project }) })];
      } else if (p.got) {
        lines = [h('p.lg-plat-line.got', svgIcon('check', 20), h('b', 'Platinum this week!'), ` ${fmtPts(p.p10)} of ${fmtPts(p.need10)} points.`)];
      } else if (p.isOpen) {
        lines = [h('p.lg-plat-line', h('b', `${fmtPts(p.toGo10)} more points`), ` reach Platinum (${fmtPts(p.need10)}).`)];
      } else lines = [h('p.lg-plat-line', `Platinum is ${fmtPts(p.need10)} points: 1.4 times the week's target.`)];
      const buff = p.buff ? h('p.lg-plat-buff', svgIcon('sun', 20),
        p.buff.from > ctx.now() ? h('span', 'Your Platinum Golden Hour starts Monday at midnight')
          : h('span', 'Platinum Golden Hour: everything started takes 10 % less time for ', h('b', fmtDuration(p.buff.until - ctx.now())))) : null;
      return h(`section.wk-card.lg-plat${p.open ? '' : '.locked'}`,
        h('div.lg-plat-head', medalArt('platinum', '', 46, { dim: !p.open }),
          h('div', h('b', 'Platinum'), h('small', '1.4 × the week\'s target'))),
        ...lines, buff, reward);
    }

    function historyCard(v) {
      const rows = v.history.slice(0, 6).map((r) => h(`li.lg-hist-row.m${r.move > 0 ? 'up' : r.move < 0 ? 'down' : 'stay'}`,
        crest(Number(r.to ?? r.tier) || 1, 24),
        h('span', h('b', r.p > 0 ? moveText(r.move) : 'An empty week'),
          h('small', `${ordinal(r.rank)} in the ${leagueName(Number(r.tier) || 1)}${r.p > 0 ? ` · ${fmtPts(r.p)} pts` : ''}`)),
        r.acorns ? h('span.lg-hist-pay', `+${r.acorns}`, icon('acorns', { size: 20, alt: 'Acorns' })) : null));
      return h('section.wk-card.lg-hist', h('h3.pn-h', h('span', 'Past weeks')),
        rows.length ? h('ul.lg-hist-list', ...rows) : h('p.wk-muted', 'Your first league week ends on Sunday at 20:00.'));
    }

    function rulesCard(v) {
      return h('section.wk-card.wk-rules', h('h3.pn-h', h('span', 'How the league works')),
        h('ul.wk-bullets',
          h('li', 'Your Fair points are your league score: the two of you compete ', h('b', 'together'), ', never against each other.'),
          h('li', `After Sunday's judging the top ${LEAGUE.promote} farms move up a league and the last one moves down.`),
          h('li', `Every week the league pays its number in Acorns: the ${leagueName(v.tier)} pays ${leagueAcorns(v.tier)}.`),
          h('li', 'A week without a single Fair point holds your league and pays nothing.'),
          v.table.W ? h('li', `This week's target is ${fmtPts(v.table.W * 10)} points: the other farms finish between 60 % and 130 % of it.`) : null));
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
  title: 'League table',
  icon: 'purple_rosette',
  size: 'card',
  mount(body, ctx) {
    const r = leagueResult(ctx.store.state, Number.isSafeInteger(ctx.args?.w) ? ctx.args.w : null);
    if (!r) { fill(body, h('p.wk-muted', 'No league week has finished yet.')); return {}; }
    const head = r.empty ? `A quiet week in the ${r.fromName}` : r.move > 0 ? `Up to the ${r.toName}!` : r.move < 0 ? `Down to the ${r.toName}` : `Another week in the ${r.toName}`;
    const lead = r.empty ? 'No Fair points this week, so the league held your place. It is waiting for you.'
      : r.move > 0 ? `You finished ${ordinal(r.rank)} in the ${r.fromName}. Judge Pemberton moves your stall up a league!`
        : r.move < 0 ? `You finished ${ordinal(r.rank)} of ${r.rows}. Next week the ${r.toName}: a fine place to bake your way back.`
          : `You finished ${ordinal(r.rank)} of ${r.rows}.${r.to >= LEAGUE.leagues ? ' Champions of the county!' : ''}`;
    fill(body, h(`div.lg-res.m${r.move > 0 ? 'up' : r.move < 0 ? 'down' : 'stay'}`,
      h('div.lg-res-art', r.move !== 0 ? [crest(r.from, 64, { dim: true }), h('span.lg-res-arrow', { 'aria-hidden': 'true' }, '➜'), crest(r.to, 100, { label: r.toName })]
        : crest(r.to, 100, { label: r.toName })),
      ctx.args?.catchUp ? h('p.wk-cere-away', 'While you were away, the league was judged') : null,
      h('h2.lg-res-title', head),
      h('p.lg-res-lead', lead),
      r.acorns ? h('div.lg-res-pay', h('span', 'The league paid'), rewardChips({ acorns: r.acorns })) : null,
      h('div.wk-cere-acts',
        h('button.btn.btn--sun', { type: 'button', on: { click: () => ctx.close() } }, r.move > 0 ? 'Wonderful!' : r.move < 0 ? 'We\'ll be back' : 'Onwards'),
        h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => { ctx.close(); ctx.ui.panels.open('league'); } } }, 'See the table'))));
    return {};
  },
};

// ---- install ------------------------------------------------------------------------------------------------------

/** The "Progress" dock button: one mini, on the hub's first open panel (the drip-feed: no button before anything opens). */
export const HUB_DOCK = Object.freeze({ label: 'Progress', icon: 'rainbow_rosette', order: 5.5, mini: true,
  hint: 'Ribbon Track, league, horse show, perks, duel and Legacy' });

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
    const docked = (name, spec) => Object.defineProperty({ ...spec }, 'dock', {
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
  let t = 0;
  const flush = () => {
    t = 0;
    const st = store.state;
    if (!st || !tiers.length) return;
    const top = Math.max(...tiers);
    const n = tiers.length;
    tiers = [];
    const v = trackOf(st, store.now());
    const tier = v?.tiers?.find((x) => x.n === top);
    ui.banner?.({ id: 'lg-track', kind: 'quest', ribbon: 'Ribbon Track',
      message: n > 1 ? `Tiers ${top - n + 1} to ${top} reached! Their prizes wait for you.` : `Tier ${top} reached! Its prize waits for you.`,
      things: tier ? rewardParts(tier.reward, { level: levelOf(st), season: v.season }).slice(0, 3).map((x) => ({ icon: x.icon, name: x.text })) : [],
      actions: ui.panels.has('seasonTrack') ? [{ label: 'Claim', kind: 'sun', fn: () => ui.panels.open('seasonTrack') }] : [], ttl: 9000 });
  };
  const offs = [
    store.on('celebrate', ({ ev } = {}) => {
      if (!ev || ev.e !== 'trackTier' || ev.catchUp) return;
      tiers.push(ev.tier);
      if (!t) t = setTimeout(flush, 350);
    }),
  ].filter((f) => typeof f === 'function');
  return () => { clearTimeout(t); for (const f of offs) f(); };
}

/** The hub's badge on its dock button (whichever panel carries it), at most every 400 ms. */
function startHubBadge(ui, store) {
  let t = 0;
  let lastOwner = null;
  const run = () => {
    t = 0;
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
  const kick = () => { if (!t) t = setTimeout(run, 400); };
  const offs = [store.on('change', kick), store.on('welcome', kick)].filter((f) => typeof f === 'function');
  const iv = setInterval(kick, 60_000);
  kick();
  return () => { clearTimeout(t); clearInterval(iv); for (const f of offs) f(); };
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
