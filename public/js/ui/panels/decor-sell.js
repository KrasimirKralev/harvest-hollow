// Sell stored decor (owner wish A, 2026-10-04), ui lane: the decor waiting in the build tray with what one copy fetches
// (a share of its price: no buy-sell profit, Acorn decor back in Acorns), Sell behind an "are you sure?", and the
// decor sold in the last 10 minutes with Undo. Placed decor sells from the Hammer's hint (toolbar.js). Loaded on first
// open (panels/w4.js lazyPanel).
import { defOf } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, fill, price, tParts } from './kit.js';
import { actFor } from './w4-rules.js';
import { storedDecor, sellStoredQuote } from './w4-model.js';
import { sellStored, undoSale, simulatedGain } from './w4-flows.js';
import { t, name as cname } from '../../i18n/index.js';

/** Decor sold in the last 10 minutes (farm.trash): placed pieces (`obj`) and tray copies (`tray`), newest first. */
export function soldDecor(state, now) {
  const t = state?.farm?.trash ?? {};
  return Object.keys(t).map((id) => ({ id, r: t[id] }))
    .filter(({ r }) => r && r.until > now && defOf(r.obj?.def ?? r.tray)?.kind === 'decor')
    .map(({ id, r }) => ({ id, def: r.obj?.def ?? r.tray, coins: r.coins ?? 0, acorns: r.acorns ?? 0, until: r.until, by: r.by, tray: !r.obj }))
    .sort((a, b) => b.until - a.until || (a.id < b.id ? -1 : 1));
}

export const decorSellPanel = {
  mount(body, ctx) {
    const kit = createKit(ctx);
    const S = { store: ctx.store, controller: ctx.controller, ui: ctx.ui };
    const sig = () => {
      const st = ctx.store.state;
      return [storedDecor(st).map((d) => [d.def, d.n]), soldDecor(st, ctx.now()).map((s) => s.id)];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(1000, () => { if (!update()) kit.tick(); });

    function render() {
      const st = ctx.store.state;
      const list = storedDecor(st);
      const sold = soldDecor(st, ctx.now());
      // what was just sold comes first: its Undo runs out
      fill(body,
        sold.length ? h('section.pn-section', h('h3.pn-h', h('span', t('market.decorSell.lately'))), h('ul.ds-list.ds-sold', ...sold.map((s) => soldRow(st, s)))) : null,
        h('p.pn-intro', t('market.decorSell.intro')),
        list.length ? h('ul.ds-list', ...list.map((d) => row(st, d))) : h('div.pn-empty', svgIcon('flower', 44), h('p', t('market.decorSell.none'))));
      kit.refresh();
      kit.tick();
    }

    function row(st, d) {
      const type = actFor('sellStored');
      const q = sellStoredQuote(st, d.def) ?? simulatedGain(ctx.store, type, { def: d.def }) ?? { coins: 0, acorns: 0 };
      return h('li.ds-row', { dataset: { def: d.def } },
        icon(d.def, { size: 48, alt: '' }),
        h('div.ds-main', h('b', d.name), h('small', d.n > 1 ? t('market.decorSell.inTrayN', { n: d.n }) : t('market.decorSell.inTray')),
          q.coins || q.acorns ? h('span.ds-each', tParts(d.n > 1 ? 'market.decorSell.sellsForEach' : 'market.decorSell.sellsFor', { price: price(q) }))
            : h('span.ds-each.gift', t('market.decorSell.gift'))),
        kit.button({ label: t('market.decorSell.sell'), cls: 'btn--paper pn-sm', key: `ds:${d.def}`, type, args: { def: d.def },
          onClick: () => { sellStored(S, d.def).then(() => update(true)); } }));
    }

    function soldRow(st, s) {
      const mine = s.by === ctx.store.pid;
      const who = st.players?.[s.by]?.name ?? t('common.partner');
      const left = h('small.ds-left');
      kit.timer(left, { end: s.until, prefix: t('market.decorSell.undoFor'), doneText: t('market.decorSell.tooLate') });
      const key = `market.decorSell.sold${mine ? 'You' : 'By'}${s.tray ? 'Tray' : ''}`;
      return h('li.ds-row.sold', { dataset: { id: s.id } },
        icon(s.def, { size: 40, alt: '' }),
        h('div.ds-main', h('b', defOf(s.def) ? cname(s.def) : s.def), h('small', tParts(key, { who, price: price(s) })), left),
        kit.button({ label: t('market.barn.undo'), cls: 'btn--sky pn-sm', key: `ds:undo:${s.id}`, type: actFor('restore'), args: { id: s.id },
          hint: { texts: { NO_COINS: t('market.decorSell.spent'), NOT_FOUND: t('market.decorSell.tooLate') } },
          onClick: () => { undoSale(S, s.id); update(true); } }));
    }

    update(true);
    return { update: () => { if (!update()) kit.refresh(); } };
  },
};
