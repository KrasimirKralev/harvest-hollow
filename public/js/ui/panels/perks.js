// Perks and rested XP (GDD §4.7, M2 feature perks), ui-league lane (wave 3).
//
// Personal: 1 point per 2 personal levels (max 20); four trees of five perks costing 1, 1, 2, 2, 3 (9 a tree, so a
// farmer completes two); learned in order within a tree; a perk helps only its owner's own actions and never changes
// the partner's numbers; one free respec a week. Rested XP: while a farmer is away it banks 5 % of a personal level per
// 8 hours (at most 150 % of a level) and doubles their personal XP until used. Farm XP is unaffected.
import { titleFor } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, fill, playerMark } from './kit.js';
import { banner, lockedBody, toTop } from './fair.js';
import { perksOf, perksOpen, restedOf, levelOf, actFor, ARGS, featureLevel, TREE_ORDER, TREE_NAMES } from './league-rules.js';
import { hubNav, hubSig, ring } from './league-kit.js';
import { probe } from './core.js';
import { actFor as w4Act, canAct as w4Can, perkPrices } from './w4-rules.js';

const PRICES = perkPrices();

/** Each tree's picture and colour (the panels' flat palette). */
export const TREE_LOOK = Object.freeze({
  grower: { icon: 'wheat', color: '#7CC243', ink: '#2A6A1C', blurb: 'Fields: crops, seeds and blue-ribbon harvests' },
  rancher: { icon: 'cow', color: '#E8A04A', ink: '#8A560C', blurb: 'Animals: babies, products and feed' },
  orchardist: { icon: 'apple_tree', color: '#E8556E', ink: '#7E2620', blurb: 'Trees: fruit, watering and heirlooms' },
  artisan: { icon: 'bakery', color: '#4AA8E8', ink: '#1C5283', blurb: 'Workshops: crafting, selling and duets' },
});

/** Everything the panel draws (pure): perksOf + { unlock, level (farm), title, rested, partner }. */
export function perksView(state, pid, now) {
  const v = perksOf(state, pid, now);
  const unlock = featureLevel('perks', 12);
  const farmLevel = levelOf(state);
  if (!v) return { open: false, unlock, farmLevel };
  const others = Object.keys(state.players ?? {}).filter((p) => p !== pid).sort();
  const pv = others.length ? perksOf(state, others[0], now) : null;
  const partner = pv ? { pid: others[0], name: state.players[others[0]].name, ...pv } : null;
  return { ...v, open: perksOpen(state), unlock, farmLevel, title: titleFor(v.level), rested: restedOf(state, pid), partner };
}

export const perksPanel = {
  title: 'Your Perks',
  icon: 'mastery_sign_gold',
  size: 'full',
  topics: ['players', 'xp', 'meta', 'track', 'fair', 'duel', 'wallet'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const sig = () => {
      const v = perksView(ctx.store.state, ctx.store.pid, ctx.now());
      return v.open ? [v.level, v.points, v.free, TREE_ORDER.map((k) => v.owned[k]), v.respecFree, v.rested.xp,
        v.partner && TREE_ORDER.map((k) => v.partner.owned[k]), hubSig(ctx.store.state, ctx.store.pid, ctx.now())]
        : [v.farmLevel, hubSig(ctx.store.state, ctx.store.pid, ctx.now())];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = perksView(st, ctx.store.pid, now);
      if (!v.open) {
        fill(body, hubNav(ctx, 'perks'), lockedBody('a', 'Perks', [
          'Every two personal levels earn you a perk point.',
          'Spend them in four trees (Grower, Rancher, Orchardist, Artisan): each perk helps only what you do.',
          'One free respec a week, so you can always try another way.',
        ], v.unlock, v.farmLevel));
        return;
      }
      const me = st.players[ctx.store.pid];
      fill(body,
        hubNav(ctx, 'perks'),
        banner('a', `${me?.name ?? 'Your'}'s perks`, `${v.title} · personal level ${v.level} · perks help only what you do`, { cls: 'lg-banner', focus: [0.35, 0.5] }),
        h('div.lg-perk-top', pointsCard(v), respecCard(v), v.rested.live ? restedCard(v) : null),
        h('div.lg-trees', ...v.trees.map((t) => treeCard(v, t))),
        v.partner ? partnerCard(st, v) : null);
      kit.refresh();
      kit.tick();
    }

    function pointsCard(v) {
      const p = v.max ? v.points / v.max : 0;
      return h('section.lg-points', { 'aria-label': `${v.free} perk points to spend, ${v.points} earned` },
        ring(p, 84, String(v.free), { cls: 'lg-ring-points', color: v.free ? '#E39A1E' : '#B89A6A' }),
        h('div.lg-points-text',
          h('b', v.free ? `${v.free} point${v.free === 1 ? '' : 's'} to spend` : 'Every point is spent'),
          h('small', `${v.points} of ${v.max} earned · ${v.spent} in perks`),
          h('small', v.nextPoint ? `Next point at personal level ${v.nextPoint}` : 'All 20 points earned')));
    }

    function respecCard(v) {
      const timer = v.respecFree ? null : kit.timer(h('b'), { end: v.respecAt, doneText: 'now' });
      const st = ctx.store.state;
      const type = actFor('perkRespec');
      // past the free weekly reset, a reset costs Acorns (wave 4, wish G): the rules take `paid: true`
      const paidOk = !v.respecFree && probe(ctx.store, type, { paid: true }) !== 'BAD_ARGS';
      const acorns = PRICES.respecAcorns(st, ctx.store.pid);
      const args = v.respecFree ? ARGS.perkRespec() : { paid: true };
      const btn = !v.anyOwned ? h('small.wk-muted', 'Nothing to reset yet')
        : v.respecFree || paidOk ? kit.button({
          label: v.respecFree ? 'Reset my perks' : `Reset now · ${acorns}`, glyph: v.respecFree ? null : 'acorn',
          cls: 'btn--small btn--paper', key: 'perk:respec', type, args,
          hint: { acorns: Math.max(0, acorns - st.farm.wallet.acorns), texts: { COOLDOWN: 'Your free respec comes back once a week', ALREADY_DONE: 'No perks to reset' } },
          onClick: () => askRespec(v, args, acorns),
        })
          : kit.button({ label: 'Reset my perks', cls: 'btn--small btn--paper', key: 'perk:respec', type, args: ARGS.perkRespec(),
            hint: { texts: { COOLDOWN: 'Your free respec comes back once a week', ALREADY_DONE: 'No perks to reset' } } });
      return h('section.lg-respec',
        h('div', h('b', 'Respec'), h('small', v.respecFree ? 'Free once a week: ready now' : null, timer ? h('span', 'Free again in ', timer) : null)),
        btn);
    }

    /** "Reset all your perks?" before every point comes back (free once a week, then for Acorns). */
    async function askRespec(v, args, acorns) {
      const ok = await ctx.ui.confirm({
        title: 'Reset your perks?', icon: 'mastery_sign_gold',
        lead: v.spent === 1 ? 'Your 1 point comes back to spend again.' : `All ${v.spent} points come back to spend again.`,
        cost: v.respecFree ? null : { acorns },
        body: v.respecFree ? 'This is your free reset of the week.' : `Your free reset is used this week, so this one costs ${acorns} Acorn${acorns === 1 ? '' : 's'}.`,
        fine: 'Only your own perks change. Your partner\'s stay as they are.',
        ok: v.respecFree ? 'Reset them' : `Reset for ${acorns} Acorns`, okKind: 'sun', cancel: 'Keep them',
      });
      if (ok) ctx.act(actFor('perkRespec'), args);
    }

    /** A confirm title that fits a phone's title ribbon (about 16 letters; "Unlearn Steady Han…" was cut): the lead names
     *  the perk there. */
    function fitTitle(long, short) {
      const narrow = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-width: 520px)').matches;
      return narrow && long.length > 16 ? short : long;
    }

    /** "Learn Green Thumb?" before a point is spent (wave 4, wish G: a misclick guard). */
    async function askLearn(v, t, p) {
      const look = TREE_LOOK[t.id];
      const refund = w4Can('perkRefund');
      const ok = await ctx.ui.confirm({
        title: fitTitle(`Learn ${p.name}?`, 'Learn this perk?'), icon: look.icon, lead: `${p.name}: ${p.text}`,
        body: `It takes ${p.cost} of your ${v.free} perk point${v.free === 1 ? '' : 's'} (${t.name} tree, perk ${p.i + 1} of 5).`,
        fine: refund ? 'Changed your mind later? Unlearn the newest perk of a tree for a few Acorns, or reset them all for free once a week.'
          : 'Changed your mind later? Reset them all for free once a week.',
        ok: 'Learn it', okKind: 'go', cancel: 'Not now',
      });
      if (ok) ctx.act(actFor('perkPick'), ARGS.perkPick(t.id));
    }

    /** "Unlearn Green Thumb?": the newest perk of a tree comes back for Acorns (wave 4, wish G). */
    async function askRefund(t, last, acorns) {
      const ok = await ctx.ui.confirm({
        title: fitTitle(`Unlearn ${last.name}?`, 'Unlearn a perk?'), icon: TREE_LOOK[t.id].icon,
        lead: `${last.name}: ${last.cost === 1 ? 'its perk point comes' : `its ${last.cost} perk points come`} back to spend again.`, cost: { acorns },
        body: 'Only the newest perk of a tree can be unlearned; the ones before it stay.',
        ok: `Unlearn for ${acorns} Acorns`, okKind: 'sun', cancel: 'Keep it',
      });
      if (ok) ctx.act(w4Act('perkRefund'), { tree: t.id });
    }

    function restedCard(v) {
      const r = v.rested;
      const p = r.cap ? r.xp / r.cap : 0;
      return h('section.lg-rested', { 'aria-label': 'Rested XP' },
        h('span.lg-rested-ic', svgIcon('sun', 26)),
        h('div', h('b', r.xp ? `${fmt(r.xp)} rested XP` : 'Not rested'),
          h('small', r.xp ? 'Your personal XP counts double until it is used' : 'Away time banks rested XP for your return'),
          h('span.pn-bar.pn-thin.pn-sky', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(r.cap), 'aria-valuenow': String(r.xp),
            style: { '--p': String(p) } }, h('span.pn-bar-fill'))));
    }

    function treeCard(v, t) {
      const look = TREE_LOOK[t.id];
      const nodes = t.perks.map((p, i) => {
        const state = p.owned ? 'owned' : p.next ? 'next' : 'later';
        const learn = p.next ? kit.button({ label: `Learn · ${p.cost} pt${p.cost === 1 ? '' : 's'}`, cls: `btn--small ${p.afford ? 'btn--sun' : 'btn--paper'}`,
          key: `perk:${t.id}:${i}`, type: actFor('perkPick'), args: ARGS.perkPick(t.id),
          hint: { texts: { CAP: needText(p.cost - v.free), ALREADY_DONE: 'The whole tree is learned', LOCKED: 'Perks are not open yet' } },
          onClick: () => askLearn(v, t, p) }) : null;
        return h(`li.lg-perk.${state}`, { dataset: { tree: t.id, i: String(i) } },
          h('span.lg-perk-cost', { title: `${p.cost} point${p.cost === 1 ? '' : 's'}` }, p.owned ? svgIcon('check', 18) : String(p.cost)),
          h('div.lg-perk-text', h('b', p.name), h('span', p.text),
            state === 'later' ? h('small', `After ${t.perks[i - 1].name}`) : null),
          learn);
      });
      return h(`section.lg-tree.t-${t.id}`, { style: { '--tree': look.color, '--tree-ink': look.ink }, 'aria-label': `${t.name} tree, ${t.owned} of 5 learned` },
        h('header.lg-tree-head', h('span.lg-tree-ic', icon(look.icon, { size: 40, alt: '' })),
          h('div', h('b', t.name), h('small', look.blurb)),
          h('span.lg-tree-n', `${t.owned}/5`)),
        h('ol.lg-perks', ...nodes),
        refundRow(t),
        h('small.lg-tree-foot', `The whole tree: ${t.cost} points`));
    }

    /** The newest perk of a tree can be unlearned for Acorns (only when the build has the action). */
    function refundRow(t) {
      if (!t.owned || !w4Can('perkRefund')) return null;
      const last = t.perks[t.owned - 1];
      const st = ctx.store.state;
      const acorns = PRICES.refundAcorns(st, ctx.store.pid, t.id);
      return h('div.lg-refund', kit.button({
        label: `Unlearn ${last.name} · ${acorns}`, glyph: 'acorn', cls: 'btn--small btn--paper w4-unlearn', key: `perk:refund:${t.id}`,
        type: w4Act('perkRefund'), args: { tree: t.id }, hint: { acorns: Math.max(0, acorns - st.farm.wallet.acorns) },
        onClick: () => askRefund(t, last, acorns),
      }));
    }

    function partnerCard(st, v) {
      const p = v.partner;
      const learned = TREE_ORDER.filter((k) => p.owned[k] > 0).map((k) => `${TREE_NAMES[k]} ${p.owned[k]}`);
      return h('section.wk-card.lg-partner', playerMark(p.pid, st.players[p.pid]),
        h('p', h('b', `${p.name}'s perks: `), learned.length ? learned.join(' · ') : 'none learned yet',
          h('small', ' Perks are personal: each of you helps only your own actions. Two different trees cover more of the farm.')));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => { if (!update()) kit.refresh(); } };
  },
};

const needText = (n) => (n > 0 ? `Need ${n} more perk point${n === 1 ? '' : 's'}` : 'Not enough perk points');

