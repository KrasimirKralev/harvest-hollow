// Sell stored decor (owner wish A, 2026-10-04), ui lane: the decor waiting in the build tray with what one copy fetches
// (a share of its price: no buy-sell profit, Acorn decor back in Acorns), Sell behind an "are you sure?", and the
// decor sold in the last 10 minutes with Undo. Placed decor sells from the Hammer's hint (toolbar.js). Loaded on first
// open (panels/w4.js lazyPanel).
import { defOf } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, fill, price } from './kit.js';
import { actFor } from './w4-rules.js';
import { storedDecor, sellStoredQuote } from './w4-model.js';
import { sellStored, undoSale, simulatedGain } from './w4-flows.js';

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
        sold.length ? h('section.pn-section', h('h3.pn-h', h('span', 'Sold lately')), h('ul.ds-list.ds-sold', ...sold.map((s) => soldRow(st, s)))) : null,
        h('p.pn-intro', 'Decor in your tray can go back to the shop for a share of its price. Changed your mind? Undo works for 10 minutes.'),
        list.length ? h('ul.ds-list', ...list.map((d) => row(st, d))) : h('div.pn-empty', svgIcon('flower', 44), h('p', 'No decor waits in the tray. Put a piece away with the Hammer (Del) to sell it here, or sell a placed piece from the Hammer\'s hint.')));
      kit.refresh();
      kit.tick();
    }

    function row(st, d) {
      const type = actFor('sellStored');
      const q = sellStoredQuote(st, d.def) ?? simulatedGain(ctx.store, type, { def: d.def }) ?? { coins: 0, acorns: 0 };
      return h('li.ds-row', { dataset: { def: d.def } },
        icon(d.def, { size: 48, alt: '' }),
        h('div.ds-main', h('b', d.name), h('small', d.n > 1 ? `${fmt(d.n)} in the tray` : 'In the tray'),
          q.coins || q.acorns ? h('span.ds-each', 'Sells for ', price(q), d.n > 1 ? ' each' : '')
            : h('span.ds-each.gift', 'A gift: the shop pays nothing for it')),
        kit.button({ label: 'Sell…', cls: 'btn--paper pn-sm', key: `ds:${d.def}`, type, args: { def: d.def },
          onClick: () => { sellStored(S, d.def).then(() => update(true)); } }));
    }

    function soldRow(st, s) {
      const who = s.by === ctx.store.pid ? 'You' : st.players?.[s.by]?.name ?? 'Your partner';
      const left = h('small.ds-left');
      kit.timer(left, { end: s.until, prefix: 'Undo for ', doneText: 'Too late to undo' });
      return h('li.ds-row.sold', { dataset: { id: s.id } },
        icon(s.def, { size: 40, alt: '' }),
        h('div.ds-main', h('b', defOf(s.def)?.name ?? s.def), h('small', `${who} sold it${s.tray ? ' from the tray' : ''} for `, price(s)), left),
        kit.button({ label: 'Undo', cls: 'btn--sky pn-sm', key: `ds:undo:${s.id}`, type: actFor('restore'), args: { id: s.id },
          hint: { texts: { NO_COINS: 'The coins it fetched are spent', NOT_FOUND: 'Too late to undo' } },
          onClick: () => { undoSale(S, s.id); update(true); } }));
    }

    update(true);
    return { update: () => { if (!update()) kit.refresh(); } };
  },
};
