// Mabel's Order Board (GDD §5.2, §6.2 #3, §6.3): order cards pinned to the board with what each needs (have /
// need), what it pays (coins, XP, Acorns for a golden order from a named townsperson), "I'm on it" pins and "Need
// help" flags in the players' colours, deliver and skip; empty slots count down to their refill with an instant
// refill (free once a day); Mabel's weekly meter with its three chests. Orders never expire.
import { npcOf, ORDERS, COOP, orderSlotsAt } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, chip, empty, price, fill, playerMark } from './kit.js';
import { levelOf } from './model.js';
import { portrait, chest } from './art.js';
import { I } from './intents.js';
import { boardSlots, shortfall, rushPrice, have } from './goals-model.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });
const BP = 10_000;

export const ordersPanel = {
  title: 'Mabel\'s Orders',
  icon: 'order_board',
  size: 'full',
  hotkey: 'o',
  dock: { label: 'Orders', icon: 'orders', order: 4, hint: 'Mabel\'s order board (O)' },
  locked: (state) => (levelOf(state) < ORDERS.unlock ? `Mabel opens her board at level ${ORDERS.unlock}` : null),
  topics: ['orders', 'inventory', 'wallet', 'xp', 'players'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const head = h('div.pn-ordhead');
    const grid = h('div.pn-board', { role: 'list', 'aria-label': 'Orders' });
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
          h('p', `Mabel opens her board at level ${ORDERS.unlock} with ${orderSlotsAt(ORDERS.unlock)} orders.`),
          h('small', 'Until then the stand buys everything you grow. Orders pay half again as much.')));
        kit.refresh();
        return;
      }
      const slots = boardSlots(st);
      if (!slots.length) grid.append(empty('Mabel is writing the first orders. Back in a moment!', 'orders'));
      slots.forEach((s, n) => grid.append(s.order ? orderCard(st, s, n) : waitingCard(st, s, n)));
      const next = ORDERS.slots.find(([L]) => L > level);
      if (next && next[1] > orderSlotsAt(level)) {
        grid.append(h('div.pn-order.pn-order-later', { role: 'listitem' }, svgIcon('lock', 32),
          h('p', `Mabel pins a ${ordinal(next[1])} order at level ${next[0]}.`)));
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
      const line = golden ? mabel.lines[2] : ready ? mabel.lines[0] : mabel.lines[(st.farm.orders?.n ?? 0) % 2 === 0 ? 1 : 0];
      const rush = rushPrice(st, ctx.now());
      fill(head,
        h('div.pn-mabel', portrait(mabel, 72),
          h('div.pn-speech', h('b', 'Mabel'), h('p', `“${line}”`),
            h('small', levelOf(st) < ORDERS.unlock ? 'Orders will pay half again what the stand does, and they never expire.'
              : `Orders pay half again what the stand does and never expire. ${rush === 0 ? 'One instant refill is free today.' : `Instant refills cost ${ORDERS.refillAcorns} Acorn now.`}`))),
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
          title: `${fmt(Math.ceil(at))} worth of orders: ${fmt(Math.floor((m.e * c.coinsBp) / BP))} coins + ${c.acorns} Acorn${c.acorns > 1 ? 's' : ''}` },
        chest(40, { open, gold: i === chests.length - 1 }));
      });
      return h('div.pn-meter', h('div.pn-meter-title', h('b', 'Mabel\'s week'), h('span', `${fmt(m.v)} of ${fmt(Math.ceil((m.e * top) / BP))} coins in orders`)),
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
      return h(`article.pn-order${o.golden ? '.golden' : ''}${ready ? '.ready' : ''}`, { role: 'listitem', dataset: { slot: String(s.i) },
        style: { '--tilt': `${[-1.2, 0.8, -0.4, 1.1, -0.9, 0.5, -0.6, 1, -1][n % 9]}deg` } },
      h('span.pn-pin', { 'aria-hidden': 'true' }),
      h('header.pn-order-head',
        giver ? h('div.pn-giver', portrait(giver, 40), h('div', h('b', giver.name), h('small', o.golden.duet ? 'Golden order · a duet good' : 'Golden order')))
          : h('div.pn-giver', h('div', h('b', o.simple ? 'Quick order' : 'Mabel\'s order'), h('small', o.simple ? 'A small order: a quarter of the usual credit for goals' : 'deliver it all at once'))),
        kit.confirmButton({ label: '×', cls: 'pn-xs pn-ghost pn-skip', confirm: 'Skip?', ...lazy(() => I.discardOrder(s.i, o.n)), title: 'Skip this order: a new one comes in 15 minutes', data: { discard: String(s.i) } })),
      items,
      h('div.pn-order-pay', price({ coins: o.coins, acorns: o.golden ? o.golden.acorns : 0 }), h('span.pn-xp', `+${fmt(xp)} XP`),
        helped ? h('span.pn-help-bonus', `+10 % XP and a Heart each for helping`) : null),
      h('div.pn-order-coop',
        h('button.pn-tag-btn', { type: 'button', 'aria-pressed': String(Boolean(pinBy)), disabled: Boolean(pinBy && pinBy !== me),
          style: pinBy ? { '--who': st.players[pinBy].color } : null, title: pinBy && pinBy !== me ? `${st.players[pinBy].name} is on it` : 'Tell your partner you are doing this one',
          on: { click: () => { const it = I.pinOrder(s.i, o.n); ctx.act(it.type, it.args); } } },
        pinBy ? playerMark(pinBy, st.players[pinBy]) : svgIcon('ping', 18), pinBy ? (pinBy === me ? 'I\'m on it' : `${st.players[pinBy].name} is on it`) : 'I\'m on it'),
        h('button.pn-tag-btn.pn-flag', { type: 'button', 'aria-pressed': String(Boolean(flagBy)), disabled: Boolean(flagBy && flagBy !== me),
          style: flagBy ? { '--who': st.players[flagBy].color } : null, title: 'Ask for help: when the other farmer fills it you both get a Heart',
          on: { click: () => { const it = I.flagOrder(s.i, o.n); ctx.act(it.type, it.args); } } },
        flagBy ? playerMark(flagBy, st.players[flagBy]) : '⚑', flagBy ? (flagBy === me ? 'Help asked' : `${st.players[flagBy].name} needs help`) : 'Need help')),
      kit.button({ label: 'Deliver', glyph: 'check', cls: `${ready ? 'btn--sun ' : ''}pn-deliver`, ...lazy(() => I.fillOrder(s.i, o.n)), data: { fill: String(s.i) },
        hint: () => ({ missing: shortfall(ctx.store.state, o) }) }));
    }

    function waitingCard(st, s, n) {
      const t = h('b.pn-timer');
      kit.timer(t, { end: s.availableAt, doneText: 'any second now', done: () => setTimeout(() => update(true), 600) });
      const cost = rushPrice(st, ctx.now());
      return h('article.pn-order.pn-order-wait', { role: 'listitem', dataset: { slot: String(s.i) }, style: { '--tilt': `${[0.6, -0.8, 1][n % 3]}deg` } },
        h('span.pn-pin', { 'aria-hidden': 'true' }),
        icon('order_board', { size: 64 }),
        h('p', 'A new order is on its way'), t,
        kit.button({ label: cost ? `Now (${cost} Acorn)` : 'Now (free today)', cls: 'pn-xs btn--sky', ...lazy(() => I.rushOrder(s.i)), data: { rush: String(s.i) },
          gate: () => (cost > ctx.store.state.farm.wallet.acorns ? { code: 'NO_ITEMS', hint: { acorns: cost - ctx.store.state.farm.wallet.acorns } } : null) }));
    }

    update(true);
    return { update: () => update() };
  },
};

function ordinal(n) {
  return ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][n] ?? `${n}th`;
}

