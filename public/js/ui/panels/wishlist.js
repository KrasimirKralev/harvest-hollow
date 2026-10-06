// The Wishlist (GDD §6.3, L9): things you are saving up for. Coins put on a wish leave the spendable treasury, and
// the wish buys itself (into the build tray) the moment it is funded, on both screens. Your own coins come back at
// once; the partner's coins need their OK (or 12 hours without an answer). Add wishes from the Market (♡).
// Also: the expansion card (args { id }) opened from a "For sale" signpost.
import { defOf, expansionOf, SAFETY } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, fmtDuration, createKit, bar, empty, who } from './kit.js';
import { reason } from './core.js';
import { levelOf, storeCards, priceOf } from './model.js';
import { landCard, openProof } from './market.js';
import { landMap } from './art.js';
import { I } from './intents.js';
import * as decorA from '../../../../shared/rules/actions/decor.js';
import { t, name as cname } from '../../i18n/index.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

/** The price a wish is saving toward (null when it cannot be bought now: limit reached, locked). */
export function wishPrice(state, def) {
  // a wish may wait for its level or for room under a cap: the coins are saved toward the list price meanwhile
  const code = typeof decorA.buyPrice === 'function' ? decorA.buyPrice(state, def).code : null;
  return { coins: priceOf(state, def).coins || null, code };
}

export const wishlistPanel = {
  get title() { return t('market.wish.title'); },
  size: 'side',
  topics: ['wishlist', 'wallet', 'players', 'xp', 'objects'],
  locked: (state) => (levelOf(state) < SAFETY.wishlist.unlock ? t('market.wish.locked', { n: SAFETY.wishlist.unlock }) : null),
  mount(body, ctx) {
    const kit = createKit(ctx);
    const up = kit.memo(body, () => [ctx.store.state.farm.wishlist, levelOf(ctx.store.state)], render);
    function render() {
      const st = ctx.store.state;
      body.replaceChildren();
      if (levelOf(st) < SAFETY.wishlist.unlock) { body.append(empty(t('market.wish.lockedDot', { n: SAFETY.wishlist.unlock }), 'lock')); return; }
      const wishes = Object.entries(st.farm.wishlist ?? {}).sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1));
      body.append(h('p.pn-intro', t('market.wish.intro')));
      if (!wishes.length) body.append(empty(t('market.wish.none'), 'heart'));
      const me = ctx.store.pid;
      for (const [id, w] of wishes) {
        const def = defOf(w.def);
        const p = wishPrice(st, w.def);
        const pct = p.coins ? Math.min(1, w.coins / p.coins) : 0;
        const mine = w.by === me;
        const left = p.coins ? Math.max(0, p.coins - w.coins) : 0;
        const dep = (n) => kit.button({ label: `+${fmt(n)}`, cls: 'pn-xs btn--sky', ...lazy(() => I.wishDeposit(id, n)), data: { deposit: `${id}:${n}` },
          hint: () => ({ coins: Math.max(0, n - ctx.store.state.farm.wallet.coins) }) });
        const steps = [...new Set([100, 1000, left].filter((n) => n > 0 && n <= left))].slice(0, 3);
        const release = w.release;
        body.append(h('article.pn-wish', { dataset: { wish: id } },
          icon(w.def, { size: 56 }),
          h('div.pn-wish-main',
            h('div.pn-wish-top', h('b', def ? cname(w.def) : w.def), who(st, w.by, { me })),
            p.coins ? bar(pct, `${fmt(w.coins)} / ${fmt(p.coins)}`, 'pn-go') : null,
            p.code ? h('small.pn-wish-wait', t('market.wish.wait', { why: reason(p.code, { unlock: def?.unlock }) })) : null,
            h('div.pn-wish-acts', ...steps.map((n) => dep(n)),
              w.coins > 0 && mine ? kit.button({ label: t('market.wish.takeBack'), cls: 'pn-xs pn-ghost', ...lazy(() => I.wishWithdraw(id)) }) : null,
              w.coins > 0 && !mine && !release ? kit.button({ label: t('market.wish.ask'), cls: 'pn-xs pn-ghost', title: t('market.wish.askTip', { name: st.players[w.by]?.name ?? t('common.partner') }), ...lazy(() => I.wishWithdraw(id)) }) : null,
              mine ? kit.confirmButton({ label: t('market.wish.remove'), cls: 'pn-xs pn-ghost', confirm: w.coins ? t('market.wish.removeCoins', { n: w.coins }) : t('market.wish.removeQ'), ...lazy(() => I.unwish(id)) }) : null),
            release ? h('div.pn-wish-ask', svgIcon('note', 18),
              release.by === me ? t('market.wish.youAsked', { d: fmtDuration(release.at + SAFETY.wishlist.autoReleaseMs - ctx.now()) })
                : t('market.wish.wouldLike', { name: st.players[release.by]?.name ?? t('common.partner') }),
              mine ? [kit.button({ label: t('market.wish.yes'), cls: 'pn-xs', ...lazy(() => I.wishAnswer(id, true)) }), kit.button({ label: t('market.wish.keepSaving'), cls: 'pn-xs pn-ghost', ...lazy(() => I.wishAnswer(id, false)) })] : null) : null)));
      }
      body.append(h('p.pn-hint', t('market.wish.max', { n: SAFETY.wishlist.maxWishes })));
      kit.refresh();
    }
    up(true);
    return { update: () => up() };
  },
};

export const expansionPanel = {
  title: (args) => (expansionOf(args.id) ? cname(args.id, { family: 'expansions' }) : t('market.land.forSaleTitle')),
  size: 'wide',
  topics: ['expansions', 'proofs', 'wallet', 'inventory', 'xp', 'objects'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const up = kit.memo(body, () => [storeCards(ctx.store.state, 'land', { now: ctx.now(), pid: ctx.store.pid })], render);
    function render() {
      const st = ctx.store.state;
      const cards = storeCards(st, 'land', { now: ctx.now(), pid: ctx.store.pid });
      const c = cards.find((x) => x.id === ctx.args.id) ?? cards.find((x) => x.isNext && !x.owned) ?? cards[0];
      body.replaceChildren();
      if (!c) { body.append(empty(t('market.land.noneForSale'), 'hammer')); return; }
      ctx.setTitle(c.name);
      body.append(h('div.pn-land.pn-land-one', h('div.pn-mapbox', landMap(st, cards, { selected: c.id })), landCard(c, ctx, kit, true)));
      if (c.isNext && !c.owned) openProof(ctx, c);
      kit.refresh();
    }
    up(true);
    return { update: () => up() };
  },
};

