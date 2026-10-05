// The Seasonal Ribbon Track (GDD §5.9, M2, L24), ui-league lane (wave 3).
//
// One free 30-tier track per real season. Every farm XP point either farmer earns counts; a tier needs about one hour
// of play at the level the season's track opened with. A reached tier is claimed by either farmer for the farm; tiers
// 10, 20 and 30 pay Acorns, tier 25 the season's animal coat (the couple puts it on one animal). At the season's end
// every reached tier still unclaimed is paid anyway and the points left turn into coins. The panel: the season and its
// end, the current tier as a ring, the next prizes, the whole track as a ribbon of 30 tickets (it scrolls sideways; a
// phone swipes it), claims, the season coats to put on, and the rules. Numbers: the rules' trackView (track.js).
import { SEASONAL_TRACK, animalOf } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, fmtShort, createKit, fill } from './kit.js';
import { banner, lockedBody, toTop } from './fair.js';
import { trackOf, levelOf, actFor, canAct, ARGS, SEASONAL_TRACK_UNLOCK } from './league-rules.js';
import { hubNav, hubSig, ring, rewardChips, rewardText } from './league-kit.js';

const DAY = 86_400_000;
/** The painting per season: spring blossom orchard, summer animals, autumn sunset with a pumpkin, winter porch. */
const ART = { spring: ['d', [0.45, 0.4]], summer: ['c', [0.4, 0.5]], autumn: ['h', [0.45, 0.55]], winter: ['a', [0.3, 0.5]] };

/** Everything the track draws (pure): the rules' track + { level, unlock, daysLeft, milestone per tier, animals }. */
export function seasonTrackView(state, pid, now) {
  const t = trackOf(state, now);
  const level = levelOf(state);
  if (!t) return { open: false, level, unlock: SEASONAL_TRACK_UNLOCK };
  const ms = new Set([...(SEASONAL_TRACK.acornTiers ?? []), SEASONAL_TRACK.tiers]);
  const tiers = t.tiers.map((x) => ({ ...x, milestone: ms.has(x.n) || Boolean(x.reward?.coat) }));
  return { ...t, tiers, level, unlock: SEASONAL_TRACK_UNLOCK, daysLeft: Math.max(0, Math.ceil((t.end - now) / DAY)),
    animals: t.coats?.length ? animalsOf(state) : [] };
}

/** The farm's animals for the coat picker, by species: [{ id, label, coat, own }]. */
export function animalsOf(state) {
  const n = {};
  const out = [];
  for (const id of Object.keys(state.farm.objects).sort()) {
    const o = state.farm.objects[id];
    const a = animalOf(o.def);
    if (!a || typeof o.home !== 'string' || a.feed === null) continue;
    n[o.def] = (n[o.def] ?? 0) + 1;
    const name = state.farm.names?.[id]?.name;
    // own: the bred coat kept under a season coat (the rules never overwrite it)
    out.push({ id, def: o.def, label: name ? `${name} (${a.name})` : `${a.name} ${n[o.def]}`, coat: o.coat ?? null,
      own: o.bcoat ?? null });
  }
  return out.sort((a, b) => (a.def < b.def ? -1 : a.def > b.def ? 1 : a.label < b.label ? -1 : 1));
}

export const seasonTrackPanel = {
  title: 'Ribbon Track',
  icon: 'ticket_stub',
  size: 'full',
  topics: ['track', 'xp', 'players', 'meta', 'wallet', 'objects', 'names', 'fair', 'duel'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let scrolled = false;
    let coatFor = null;
    const sig = () => {
      const v = seasonTrackView(ctx.store.state, ctx.store.pid, ctx.now());
      return [v.open, v.s, v.xp, v.need, v.level, (v.tiers ?? []).map((x) => [x.got ? 1 : 0, x.claimable ? 1 : 0]), v.coats, coatFor,
        hubSig(ctx.store.state, ctx.store.pid, ctx.now())];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = seasonTrackView(st, ctx.store.pid, now);
      if (!v.open) {
        fill(body, hubNav(ctx, 'seasonTrack'), lockedBody('d', 'The Seasonal Ribbon Track', [
          'Every real season brings a free track of 30 tiers.',
          'Every bit of farm XP the two of you earn moves you along it.',
          'Hearts, Compost, seed packets, Golden Seeds, coins, decor, Acorns, and a coat for one of your animals that only that season has.',
        ], v.unlock, v.level));
        return;
      }
      const [art, focus] = ART[v.season] ?? ART.autumn;
      const chip = h('div.wk-clock', svgIcon('sun', 20), h('span', 'Season ends'),
        h('b.wk-clock-t', v.daysLeft > 1 ? `in ${v.daysLeft} days` : v.daysLeft === 1 ? 'tomorrow' : 'today'));
      fill(body,
        hubNav(ctx, 'seasonTrack'),
        banner(art, `The ${v.name} Ribbon Track`, `${dateText(v.start, st)} – ${dateText(v.end - DAY, st)} · ${SEASONAL_TRACK.tiers} tiers · every XP you earn counts`,
          { chip, focus, cls: 'lg-banner' }),
        h('div.lg-track-top', statusCard(v), nextCard(v)),
        trackStrip(st, v),
        v.coats?.length ? coatsCard(st, v) : null,
        h('div.lg-track-foot', rulesCard(v)));
      kit.refresh();
      if (!scrolled) {
        scrolled = true;
        // bring the first prize to claim (else the tier being filled) into view; a phone swipes the rest
        // a tracker card names a tier (args.tier): that one, ringed once
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const strip = body.querySelector('.lg-track');
          const asked = Number.isSafeInteger(ctx.args?.tier) ? body.querySelector(`.lg-tier[data-tier="${ctx.args.tier}"]`) : null;
          const cur = asked ?? body.querySelector('.lg-tier.claim') ?? body.querySelector('.lg-tier.now');
          if (strip && cur) strip.scrollLeft = Math.max(0, cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2);
          if (asked) { asked.classList.add('wk-focus'); setTimeout(() => asked.classList.remove('wk-focus'), 2600); }
        }));
      }
    }

    const opts = (v) => ({ level: v.level, season: v.season });

    function statusCard(v) {
      const p = v.done ? 1 : v.inTier / Math.max(1, v.need);
      const claimable = v.tiers.filter((x) => x.claimable);
      const all = claimable.length > 1 && canAct('trackClaim') ? kit.button({ label: `Claim all ${claimable.length}`, cls: 'btn--small btn--sun', key: 'track:all',
        type: actFor('trackClaim'), args: ARGS.trackClaim(claimable[0].n),
        onClick: () => { for (const x of claimable) ctx.act(actFor('trackClaim'), ARGS.trackClaim(x.n)); } }) : null;
      return h('section.lg-track-status',
        ring(p, 78, String(v.tier), { cls: 'lg-ring-tier' }),
        h('div.lg-track-text',
          h('small', v.done ? 'Track complete!' : `Tier ${v.tier} of ${SEASONAL_TRACK.tiers}`),
          h('b', v.done ? 'Every prize of the season is yours' : `${fmt(v.toNext)} XP to tier ${v.tier + 1}`),
          h('span.lg-track-sub', `${fmt(v.need)} XP a tier · about an hour of farming at level ${v.L}`),
          h('span.pn-bar.pn-thin.lg-track-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(v.need),
            'aria-valuenow': String(v.done ? v.need : v.inTier), 'aria-label': `${fmt(v.inTier)} of ${fmt(v.need)} XP in this tier`,
            style: { '--p': String(p) } }, h('span.pn-bar-fill'))),
        all);
    }

    function nextCard(v) {
      const nx = v.tiers.find((x) => !x.reached) ?? null;
      const ms = v.tiers.find((x) => x.milestone && !x.reached && x !== nx) ?? null;
      return h('section.lg-track-next',
        v.claimable ? h('p.lg-claim-note', svgIcon('star', 18), `${v.claimable} prize${v.claimable === 1 ? '' : 's'} to claim for the farm`) : null,
        nx ? h('div.lg-next-row', h('small', `Tier ${nx.n} brings`), rewardChips(nx.reward, { size: 30, ...opts(v) })) : h('p.wk-muted', 'Every tier of this season is reached.'),
        ms ? h('div.lg-next-row.ms', h('small', `Tier ${ms.n}`), rewardChips(ms.reward, { size: 26, ...opts(v) })) : null);
    }

    function coatsCard(st, v) {
      const coat = v.coats[0];
      const def = v.coatDef && v.coatDef.id === coat ? v.coatDef : { id: coat, hue: null };
      const list = v.animals;
      const sel = coatFor && list.some((a) => a.id === coatFor) ? coatFor : null;
      const select = h('select.lg-coat-pick', { 'aria-label': 'Which animal wears it', on: { change: (e) => { coatFor = e.target.value || null; update(true); } } },
        h('option', { value: '' }, list.length ? 'Choose an animal…' : 'No animals yet'),
        ...list.map((a) => h('option', { value: a.id, selected: a.id === sel ? true : null },
          `${a.label}${a.coat ? ` · ${a.coat}` : ''}${a.own ? ` (its ${a.own} coat kept)` : ''}`)));
      const wear = kit.button({ label: 'Put it on', cls: 'btn--small btn--sun', key: 'coat:wear', type: 'coatWear',
        args: () => ({ id: sel ?? '', coat }), gate: () => (sel ? null : { code: 'BAD_ARGS', hint: { text: 'Choose an animal first' } }) });
      const own = sel ? list.find((a) => a.id === sel)?.own : null;
      const back = own ? kit.button({ label: `Back to ${own}`, cls: 'btn--small btn--sky', key: 'coat:own', type: 'coatWear',
        args: () => ({ id: sel ?? '', coat: own }), title: `Put its own ${own} coat back on (the season coat returns to the chest)` }) : null;
      return h('section.wk-card.lg-coats',
        h('span.lg-coat-swatch.big', { style: { '--coat': def.hue ?? '#C9A36A' } }, icon('saddle_rack', { size: 40, alt: '' })),
        h('div.lg-coat-text', h('b', `The ${cap(coat)} coat${v.coats.length > 1 ? ` (+${v.coats.length - 1} more)` : ''}`),
          h('small', 'A season coat from the track: put it on one of your animals. Only looks, and only this season had it.')),
        h('div.lg-coat-acts', select, wear, back));
    }

    function trackStrip(st, v) {
      const claimType = actFor('trackClaim');
      const cards = v.tiers.map((x) => {
        const cls = x.got ? '.got' : x.claimable ? '.claim' : x.n === v.tier + 1 ? '.now' : '.ahead';
        const claim = x.claimable ? kit.button({ label: 'Claim', cls: 'btn--small btn--sun', key: `track:${x.n}`,
          type: claimType, args: ARGS.trackClaim(x.n) }) : null;
        const who = x.got && x.got.by && st.players?.[x.got.by] ? st.players[x.got.by].name : x.got ? 'Auto' : null;
        const words = rewardText(x.reward, opts(v));
        return h(`li.lg-tier${cls}${x.milestone ? '.ms' : ''}`, { dataset: { tier: String(x.n) },
          'aria-label': `Tier ${x.n}: ${words}${x.got ? ', claimed' : x.claimable ? ', ready to claim' : ''}` },
        h('span.lg-tier-n', String(x.n)),
        h('span.lg-tier-prize', rewardChips(x.reward, { size: x.milestone ? 50 : 44, words: false, ...opts(v) })),
        h('span.lg-tier-what', words),
        x.got ? h('span.lg-tier-stamp', svgIcon('check', 16), who) : claim ?? h('span.lg-tier-at', `${fmtShort(x.at)} XP`),
        x.n === v.tier + 1 ? h('span.lg-tier-fill', { style: { '--p': String(v.inTier / Math.max(1, v.need)) }, 'aria-hidden': 'true' }) : null);
      });
      return h('section.lg-track-wrap', { 'aria-label': 'The track' },
        h('ol.lg-track', { tabindex: '0', 'aria-label': `${SEASONAL_TRACK.tiers} tiers; scroll sideways` }, ...cards));
    }

    function rulesCard(v) {
      return h('section.wk-card.wk-rules', h('h3.pn-h', h('span', 'How the track works')),
        h('ul.wk-bullets',
          h('li', 'Every farm XP point either of you earns moves the track: it is the farm\'s, shared. Either of you can claim a prize.'),
          h('li', `A tier needs ${fmt(v.need)} XP: about an hour of play at level ${v.L}, the level the season began with.`),
          h('li', `Tiers ${SEASONAL_TRACK.acornTiers.join(', ')} pay ${SEASONAL_TRACK.acorns} Acorns. Hearts go to each of you.`),
          h('li', v.done ? 'The track is done for the season. A new one starts with the next season.'
            : `At the season's end every reached tier is paid even if nobody claimed it, and the XP past your last tier turns into coins (${fmtShort(v.leftoverCoins)} now).`)));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase());

/** "1 Sept" in the farm's zone. */
function dateText(ms, state) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: state?.meta?.tz || 'UTC', day: 'numeric', month: 'short' }).format(ms);
  } catch { return ''; }
}

