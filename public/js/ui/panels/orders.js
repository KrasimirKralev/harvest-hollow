// Mabel's Order Board (GDD §5.2, §6.2 #3, §6.3): order cards pinned to the board with what each needs (have /
// need), what it pays (coins, XP, Acorns for a golden order from a named townsperson), "I'm on it" pins and "Need
// help" flags in the players' colours, deliver and skip; empty slots count down to their refill with an instant
// refill (free once a day); Mabel's weekly meter with its three chests. Orders never expire.
import { npcOf, ORDERS, COOP, orderSlotsAt } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, chip, empty, price, fill, playerMark, phoneTitle } from './kit.js';
import { levelOf } from './model.js';
import { portrait, chest } from './art.js';
import { I } from './intents.js';
import { boardSlots, shortfall, rushPrice, have } from './goals-model.js';
import { t, lang, ctext, ordinal as ordinalOf, name as cname } from '../../i18n/index.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });
const BP = 10_000;

export const ordersPanel = {
  get title() { return phoneTitle('market.orders.title', 'market.orders.titleShort'); },
  icon: 'order_board',
  size: 'full',
  hotkey: 'o',
  dock: { get label() { return t('market.orders.dock'); }, icon: 'orders', order: 4, get hint() { return t('market.orders.dockHint'); } },
  locked: (state) => (levelOf(state) < ORDERS.unlock ? t('market.orders.locked', { n: ORDERS.unlock }) : null),
  topics: ['orders', 'inventory', 'wallet', 'xp', 'players'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const head = h('div.pn-ordhead');
    const grid = h('div.pn-board', { role: 'list', 'aria-label': t('market.orders.dock') });
    body.append(head, grid);
    const sig = () => {
      const st = ctx.store.state;
      return [levelOf(st), st.farm.orders, boardSlots(st).map((s) => s.order && Object.keys(s.order.items).map((i) => have(st, i))),
        st.farm.wallet.acorns > 0];
    };
    const update = kit.memo(body, sig, render);

    function render() {
      const st = ctx.store.state;
      renderHead(st);
      grid.replaceChildren();
      const level = levelOf(st);
      if (level < ORDERS.unlock) {
        grid.append(h('div.pn-order.pn-order-later.pn-board-closed', svgIcon('lock', 36),
          h('p', t('market.orders.closed', { n: ORDERS.unlock, k: orderSlotsAt(ORDERS.unlock) })),
          h('small', t('market.orders.untilThen'))));
        kit.refresh();
        return;
      }
      const slots = boardSlots(st);
      if (!slots.length) grid.append(empty(t('market.orders.writing'), 'orders'));
      slots.forEach((s, n) => grid.append(s.order ? orderCard(st, s, n) : waitingCard(st, s, n)));
      const next = ORDERS.slots.find(([L]) => L > level);
      if (next && next[1] > orderSlotsAt(level)) {
        grid.append(h('div.pn-order.pn-order-later', { role: 'listitem' }, svgIcon('lock', 32),
          h('p', t('market.orders.nextSlot', { ord: lang() === 'en' ? ordinal(next[1]) : ordinalOf(next[1], 'f').replace('-', '\u2011'), n: next[0] }))));
      }
      kit.refresh();
      kit.tick();
    }

    function renderHead(st) {
      const mabel = npcOf('mabel');
      const slots = boardSlots(st);
      const golden = slots.some((x) => x.order && x.order.golden);
      const ready = slots.some((x) => x.order && shortfall(st, x.order).length === 0);
      // Mabel's line follows the board: a golden order, something ready to hand in, or her everyday chatter
      const lines = ctext('npcs', 'mabel', 'lines', mabel.lines);
      const line = golden ? lines[2] : ready ? lines[0] : lines[(st.farm.orders?.n ?? 0) % 2 === 0 ? 1 : 0];
      const rush = rushPrice(st, ctx.now());
      fill(head,
        h('div.pn-mabel', portrait(mabel, 72),
          h('div.pn-speech', h('b', cname('mabel')), h('p', t('market.orders.quote', { line })),
            h('small', levelOf(st) < ORDERS.unlock ? t('market.orders.noteLater')
              : rush === 0 ? t('market.orders.noteFree') : t('market.orders.noteCost', { n: ORDERS.refillAcorns })))),
        meter(st));
    }

    function meter(st) {
      const m = st.farm.orders?.meter;
      if (!m || levelOf(st) < ORDERS.meter.unlock) return null;
      const chests = ORDERS.meter.chests;
      const top = chests.at(-1).atBp;
      const pct = Math.min(1, (m.v * BP) / Math.max(1, m.e * top));
      const marks = chests.map((c, i) => {
        const at = (m.e * c.atBp) / BP;
        const open = m.c > i;
        return h(`span.pn-meter-chest${open ? '.open' : ''}`, { style: { left: `${(c.atBp / top) * 100}%` },
          title: t('market.orders.chest', { at: Math.ceil(at), coins: Math.floor((m.e * c.coinsBp) / BP), n: c.acorns }) },
        chest(40, { open, gold: i === chests.length - 1 }));
      });
      return h('div.pn-meter', h('div.pn-meter-title', h('b', t('market.orders.week')), h('span', t('market.orders.weekOf', { v: m.v, top: Math.ceil((m.e * top) / BP) }))),
        h('div.pn-meter-track', h('span.pn-meter-fill', { style: { '--p': String(pct) } }), ...marks));
    }

    function orderCard(st, s, n) {
      const o = s.order;
      const giver = o.golden ? npcOf(o.golden.giver) : null;
      const short = shortfall(st, o);
      const ready = short.length === 0;
      const items = h('div.pn-order-items', ...Object.entries(o.items).map(([item, q]) => chip(item, { have: have(st, item), need: q, size: 44 })));
      const pinBy = s.pin && st.players[s.pin] ? s.pin : null;
      const flagBy = s.flag && st.players[s.flag] ? s.flag : null;
      const me = ctx.store.pid;
      const helped = flagBy && flagBy !== me;
      const xp = helped ? o.xp + Math.floor((o.xp * COOP.helpFlags.xpBonusBp) / BP) : o.xp;
      return h(`article.pn-order${o.golden ? '.golden' : ''}${ready ? '.ready' : ''}`, { role: 'listitem', dataset: { slot: String(s.i), readyLabel: t('market.orders.readyTag') },
        style: { '--tilt': `${[-1.2, 0.8, -0.4, 1.1, -0.9, 0.5, -0.6, 1, -1][n % 9]}deg` } },
      h('span.pn-pin', { 'aria-hidden': 'true' }),
      h('header.pn-order-head',
        giver ? h('div.pn-giver', portrait(giver, 40), h('div', h('b', cname(o.golden.giver)), h('small', o.golden.duet ? t('market.orders.goldenDuet') : t('market.orders.golden'))))
          : h('div.pn-giver', h('div', h('b', o.simple ? t('market.orders.quick') : t('market.orders.mabels')), h('small', o.simple ? t('market.orders.quickSub') : t('market.orders.allAtOnce')))),
        kit.confirmButton({ label: '×', cls: 'pn-xs pn-ghost pn-skip', confirm: t('market.orders.skip'), ...lazy(() => I.discardOrder(s.i, o.n)), title: t('market.orders.skipTip'), data: { discard: String(s.i) } })),
      items,
      h('div.pn-order-pay', price({ coins: o.coins, acorns: o.golden ? o.golden.acorns : 0 }), h('span.pn-xp', t('market.orders.xp', { n: xp })),
        helped ? h('span.pn-help-bonus', t('market.orders.helpBonus')) : null),
      h('div.pn-order-coop',
        h('button.pn-tag-btn', { type: 'button', 'aria-pressed': String(Boolean(pinBy)), disabled: Boolean(pinBy && pinBy !== me),
          style: pinBy ? { '--who': st.players[pinBy].color } : null, title: pinBy && pinBy !== me ? t('market.orders.onIt', { name: st.players[pinBy].name }) : t('market.orders.pinTip'),
          on: { click: () => { const it = I.pinOrder(s.i, o.n); ctx.act(it.type, it.args); } } },
        pinBy ? playerMark(pinBy, st.players[pinBy]) : svgIcon('ping', 18), pinBy ? (pinBy === me ? t('market.orders.imOnIt') : t('market.orders.onIt', { name: st.players[pinBy].name })) : t('market.orders.imOnIt')),
        h('button.pn-tag-btn.pn-flag', { type: 'button', 'aria-pressed': String(Boolean(flagBy)), disabled: Boolean(flagBy && flagBy !== me),
          style: flagBy ? { '--who': st.players[flagBy].color } : null, title: t('market.orders.flagTip'),
          on: { click: () => { const it = I.flagOrder(s.i, o.n); ctx.act(it.type, it.args); } } },
        flagBy ? playerMark(flagBy, st.players[flagBy]) : '⚑', flagBy ? (flagBy === me ? t('market.orders.helpAsked') : t('market.orders.needsHelp', { name: st.players[flagBy].name })) : t('market.orders.needHelp'))),
      kit.button({ label: t('market.orders.deliver'), glyph: 'check', cls: `${ready ? 'btn--sun ' : ''}pn-deliver`, ...lazy(() => I.fillOrder(s.i, o.n)), data: { fill: String(s.i) },
        hint: () => ({ missing: shortfall(ctx.store.state, o) }) }));
    }

    function waitingCard(st, s, n) {
      const tm = h('b.pn-timer');
      kit.timer(tm, { end: s.availableAt, doneText: t('market.orders.anySecond'), done: () => setTimeout(() => update(true), 600) });
      const cost = rushPrice(st, ctx.now());
      return h('article.pn-order.pn-order-wait', { role: 'listitem', dataset: { slot: String(s.i) }, style: { '--tilt': `${[0.6, -0.8, 1][n % 3]}deg` } },
        h('span.pn-pin', { 'aria-hidden': 'true' }),
        icon('order_board', { size: 64 }),
        h('p', t('market.orders.onTheWay')), tm,
        kit.button({ label: cost ? t('market.orders.now', { n: cost }) : t('market.orders.nowFree'), cls: 'pn-xs btn--sky', ...lazy(() => I.rushOrder(s.i)), data: { rush: String(s.i) },
          gate: () => (cost > ctx.store.state.farm.wallet.acorns ? { code: 'NO_ITEMS', hint: { acorns: cost - ctx.store.state.farm.wallet.acorns } } : null) }));
    }

    update(true);
    return { update: () => update() };
  },
};

/** English only ("a fifth order"); Bulgarian takes i18n's ordinal ("5-та поръчка"). */
function ordinal(n) {
  return ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][n] ?? `${n}th`;
}

