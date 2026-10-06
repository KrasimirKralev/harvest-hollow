// Perks and rested XP (GDD §4.7, M2 feature perks), ui-league lane (wave 3).
//
// Personal: 1 point per 2 personal levels (max 20); four trees of five perks costing 1, 1, 2, 2, 3 (9 a tree, so a
// farmer completes two); learned in order within a tree; a perk helps only its owner's own actions and never changes
// the partner's numbers; one free respec a week. Rested XP: while a farmer is away it banks 5 % of a personal level per
// 8 hours (at most 150 % of a level) and doubles their personal XP until used. Farm XP is unaffected.
import { titleFor, CONTENT } from '../../../../shared/content/index.js';
import { t, ctext } from '../../i18n/index.js';

/** A personal title in the language in effect (text-b `titles.<level>.title`). */
const titleWord = (en) => {
  const row = (CONTENT.titles || []).find((r) => r.title === en);
  return row ? ctext('titles', String(row.level), 'title', en) : en;
};
import { h, icon, svgIcon, fmt, createKit, fill, playerMark } from './kit.js';
import { banner, lockedBody, toTop, tParts } from './fair.js';
import { perksOf, perksOpen, restedOf, levelOf, actFor, ARGS, featureLevel, TREE_ORDER, TREE_NAMES } from './league-rules.js';
import { hubNav, hubSig, ring } from './league-kit.js';
import { probe } from './core.js';
import { actFor as w4Act, canAct as w4Can, perkPrices } from './w4-rules.js';

const PRICES = perkPrices();

/** Each tree's picture and colour (the panels' flat palette). */
export const TREE_LOOK = Object.freeze({
  grower: { icon: 'wheat', color: '#7CC243', ink: '#2A6A1C', get blurb() { return t('league.perks.blurb.grower'); } },
  rancher: { icon: 'cow', color: '#E8A04A', ink: '#8A560C', get blurb() { return t('league.perks.blurb.rancher'); } },
  orchardist: { icon: 'apple_tree', color: '#E8556E', ink: '#7E2620', get blurb() { return t('league.perks.blurb.orchardist'); } },
  artisan: { icon: 'bakery', color: '#4AA8E8', ink: '#1C5283', get blurb() { return t('league.perks.blurb.artisan'); } },
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
  return { ...v, open: perksOpen(state), unlock, farmLevel, title: titleWord(titleFor(v.level)), rested: restedOf(state, pid), partner };
}

export const perksPanel = {
  get title() { return t('league.perks.title'); },
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
        fill(body, hubNav(ctx, 'perks'), lockedBody('a', t('league.hub.perks'), [
          t('league.perks.locked.1'),
          t('league.perks.locked.2'),
          t('league.perks.locked.3'),
        ], v.unlock, v.farmLevel));
        return;
      }
      const me = st.players[ctx.store.pid];
      fill(body,
        hubNav(ctx, 'perks'),
        banner('a', me?.name ? t('league.perks.whose', { name: me.name }) : t('league.perks.title'), t('league.perks.bannerSub', { title: v.title, n: v.level }), { cls: 'lg-banner', focus: [0.35, 0.5] }),
        h('div.lg-perk-top', pointsCard(v), respecCard(v), v.rested.live ? restedCard(v) : null),
        h('div.lg-trees', ...v.trees.map((tr) => treeCard(v, tr))),
        v.partner ? partnerCard(st, v) : null);
      kit.refresh();
      kit.tick();
    }

    function pointsCard(v) {
      const p = v.max ? v.points / v.max : 0;
      return h('section.lg-points', { 'aria-label': t('league.perks.pointsLabel', { n: v.free, earned: v.points }) },
        ring(p, 84, String(v.free), { cls: 'lg-ring-points', color: v.free ? '#E39A1E' : '#B89A6A' }),
        h('div.lg-points-text',
          h('b', v.free ? t('league.perks.toSpend', { n: v.free }) : t('league.perks.allSpent')),
          h('small', t('league.perks.earned', { n: v.points, of: v.max, spent: v.spent })),
          h('small', v.nextPoint ? t('league.perks.nextAt', { n: v.nextPoint }) : t('league.perks.allEarned'))));
    }

    function respecCard(v) {
      const timer = v.respecFree ? null : kit.timer(h('b'), { end: v.respecAt, doneText: t('league.perks.now') });
      const st = ctx.store.state;
      const type = actFor('perkRespec');
      // past the free weekly reset, a reset costs Acorns (wave 4, wish G): the rules take `paid: true`
      const paidOk = !v.respecFree && probe(ctx.store, type, { paid: true }) !== 'BAD_ARGS';
      const acorns = PRICES.respecAcorns(st, ctx.store.pid);
      const args = v.respecFree ? ARGS.perkRespec() : { paid: true };
      const btn = !v.anyOwned ? h('small.wk-muted', t('league.perks.nothingReset'))
        : v.respecFree || paidOk ? kit.button({
          label: v.respecFree ? t('league.perks.reset') : t('league.perks.resetNow', { n: acorns }), glyph: v.respecFree ? null : 'acorn',
          cls: 'btn--small btn--paper', key: 'perk:respec', type, args,
          hint: { acorns: Math.max(0, acorns - st.farm.wallet.acorns), texts: { COOLDOWN: t('league.perks.cooldown'), ALREADY_DONE: t('league.perks.noneToReset') } },
          onClick: () => askRespec(v, args, acorns),
        })
          : kit.button({ label: t('league.perks.reset'), cls: 'btn--small btn--paper', key: 'perk:respec', type, args: ARGS.perkRespec(),
            hint: { texts: { COOLDOWN: t('league.perks.cooldown'), ALREADY_DONE: t('league.perks.noneToReset') } } });
      return h('section.lg-respec',
        h('div', h('b', t('league.perks.respec')), h('small', v.respecFree ? t('league.perks.freeReady') : null, timer ? h('span', ...tParts('league.perks.freeIn', { timer })) : null)),
        btn);
    }

    /** "Reset all your perks?" before every point comes back (free once a week, then for Acorns). */
    async function askRespec(v, args, acorns) {
      const ok = await ctx.ui.confirm({
        title: t('league.perks.ask.title'), icon: 'mastery_sign_gold',
        lead: t('league.perks.ask.lead', { n: v.spent }),
        cost: v.respecFree ? null : { acorns },
        body: v.respecFree ? t('league.perks.ask.free') : t('league.perks.ask.paid', { n: acorns }),
        fine: t('league.perks.ask.fine'),
        ok: v.respecFree ? t('league.perks.ask.ok') : t('league.perks.ask.okPaid', { n: acorns }), okKind: 'sun', cancel: t('league.perks.ask.cancel'),
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
    async function askLearn(v, tr, p) {
      const look = TREE_LOOK[tr.id];
      const refund = w4Can('perkRefund');
      const ok = await ctx.ui.confirm({
        title: fitTitle(t('league.perks.learn.title', { name: p.name }), t('league.perks.learn.short')), icon: look.icon, lead: `${p.name}: ${p.text}`,
        body: t('league.perks.learn.body', { cost: p.cost, n: v.free, tree: tr.name, i: p.i + 1 }),
        fine: refund ? t('league.perks.learn.fineRefund') : t('league.perks.learn.fine'),
        ok: t('league.perks.learn.ok'), okKind: 'go', cancel: t('league.perks.learn.cancel'),
      });
      if (ok) ctx.act(actFor('perkPick'), ARGS.perkPick(tr.id));
    }

    /** "Unlearn Green Thumb?": the newest perk of a tree comes back for Acorns (wave 4, wish G). */
    async function askRefund(tr, last, acorns) {
      const ok = await ctx.ui.confirm({
        title: fitTitle(t('league.perks.unlearn.title', { name: last.name }), t('league.perks.unlearn.short')), icon: TREE_LOOK[tr.id].icon,
        lead: t('league.perks.unlearn.lead', { name: last.name, n: last.cost }), cost: { acorns },
        body: t('league.perks.unlearn.body'),
        ok: t('league.perks.unlearn.ok', { n: acorns }), okKind: 'sun', cancel: t('league.perks.unlearn.cancel'),
      });
      if (ok) ctx.act(w4Act('perkRefund'), { tree: tr.id });
    }

    function restedCard(v) {
      const r = v.rested;
      const p = r.cap ? r.xp / r.cap : 0;
      return h('section.lg-rested', { 'aria-label': t('league.perks.rested.label') },
        h('span.lg-rested-ic', svgIcon('sun', 26)),
        h('div', h('b', r.xp ? t('league.perks.rested.xp', { n: r.xp }) : t('league.perks.rested.not')),
          h('small', r.xp ? t('league.perks.rested.double') : t('league.perks.rested.bank')),
          h('span.pn-bar.pn-thin.pn-sky', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(r.cap), 'aria-valuenow': String(r.xp),
            style: { '--p': String(p) } }, h('span.pn-bar-fill'))));
    }

    function treeCard(v, tr) {
      const look = TREE_LOOK[tr.id];
      const nodes = tr.perks.map((p, i) => {
        const state = p.owned ? 'owned' : p.next ? 'next' : 'later';
        const learn = p.next ? kit.button({ label: t('league.perks.learnBtn', { n: p.cost }), cls: `btn--small ${p.afford ? 'btn--sun' : 'btn--paper'}`,
          key: `perk:${tr.id}:${i}`, type: actFor('perkPick'), args: ARGS.perkPick(tr.id),
          hint: { texts: { CAP: needText(p.cost - v.free), ALREADY_DONE: t('league.perks.treeDone'), LOCKED: t('league.perks.notOpen') } },
          onClick: () => askLearn(v, tr, p) }) : null;
        return h(`li.lg-perk.${state}`, { dataset: { tree: tr.id, i: String(i) } },
          h('span.lg-perk-cost', { title: t('league.perks.pts', { n: p.cost }) }, p.owned ? svgIcon('check', 18) : String(p.cost)),
          h('div.lg-perk-text', h('b', p.name), h('span', p.text),
            state === 'later' ? h('small', t('league.perks.after', { name: tr.perks[i - 1].name })) : null),
          learn);
      });
      return h(`section.lg-tree.t-${tr.id}`, { style: { '--tree': look.color, '--tree-ink': look.ink }, 'aria-label': t('league.perks.treeLabel', { name: tr.name, n: tr.owned }) },
        h('header.lg-tree-head', h('span.lg-tree-ic', icon(look.icon, { size: 40, alt: '' })),
          h('div', h('b', tr.name), h('small', look.blurb)),
          h('span.lg-tree-n', `${tr.owned}/5`)),
        h('ol.lg-perks', ...nodes),
        refundRow(tr),
        h('small.lg-tree-foot', t('league.perks.treeCost', { n: tr.cost })));
    }

    /** The newest perk of a tree can be unlearned for Acorns (only when the build has the action). */
    function refundRow(tr) {
      if (!tr.owned || !w4Can('perkRefund')) return null;
      const last = tr.perks[tr.owned - 1];
      const st = ctx.store.state;
      const acorns = PRICES.refundAcorns(st, ctx.store.pid, tr.id);
      return h('div.lg-refund', kit.button({
        label: t('league.perks.unlearnBtn', { name: last.name, n: acorns }), glyph: 'acorn', cls: 'btn--small btn--paper w4-unlearn', key: `perk:refund:${tr.id}`,
        type: w4Act('perkRefund'), args: { tree: tr.id }, hint: { acorns: Math.max(0, acorns - st.farm.wallet.acorns) },
        onClick: () => askRefund(tr, last, acorns),
      }));
    }

    function partnerCard(st, v) {
      const p = v.partner;
      const learned = TREE_ORDER.filter((k) => p.owned[k] > 0).map((k) => `${TREE_NAMES[k]} ${p.owned[k]}`);
      return h('section.wk-card.lg-partner', playerMark(p.pid, st.players[p.pid]),
        h('p', h('b', t('league.perks.partner', { name: p.name })), learned.length ? learned.join(' · ') : t('league.perks.noneLearned'),
          h('small', t('league.perks.personal'))));
    }

    update(true);
    requestAnimationFrame(() => toTop(ctx));
    return { update: () => { if (!update()) kit.refresh(); } };
  },
};

const needText = (n) => (n > 0 ? t('league.perks.needMore', { n }) : t('league.perks.notEnough'));

