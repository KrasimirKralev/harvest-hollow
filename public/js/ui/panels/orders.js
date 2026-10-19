// Mabel's Order Board (GDD §5.2, §6.2 #3, §6.3): order cards pinned to the board with what each needs (have /
// need), what it pays (coins, XP, Acorns for a golden order from a named townsperson), "I'm on it" pins and "Need
// help" flags in the players' colours, deliver and skip; empty slots count down to their refill with an instant
// refill (free once a day); Mabel's weekly meter with its three chests. Orders never expire.
//
// Release 1.0 (ux-phone#8, astra#7, ux-first#21): one DOM for every screen, cards on a desktop board and rows on a
// phone (css/mobile-panels.css). Deliverable orders come first; Mabel says her rule only on the first visit; the co-op
// flags hide behind "⋯" and only once a second farmer is claimed; skipping is a "↻ Skip" chip whose order leaves the
// board at once and is really discarded 10 s later, unless the toast's Undo brought it back (no rule to undo a
// discard exists, so nothing is sent until the Undo window has passed).
import { npcOf, ORDERS, COOP, orderSlotsAt } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, fmtDuration, createKit, chip, empty, price, fill, playerMark, phoneTitle, phoneSheet, listRole } from './kit.js';
import { levelOf } from './model.js';
import { portrait, chest } from './art.js';
import { I } from './intents.js';
import { probe } from './core.js';
import { boardSlots, shortfall, rushPrice, have } from './goals-model.js';
import { t, lang, ctext, ordinal as ordinalOf, name as cname } from '../../i18n/index.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });
const BP = 10_000;
/** How long a skipped order can still be brought back (ms) before the discard is sent. */
export const SKIP_UNDO_MS = 10_000;
/** How long an order the partner filled (or skipped) keeps its row as a "✓ Ana delivered this" strip (QA r1 P-17). */
export const GHOST_MS = 1500;
/** A Deliver whose row moved within this long was aimed at another order: the press is ignored (QA r1 P-17). */
export const MOVED_MS = 400;
const clock = () => (globalThis.performance?.now?.() ?? Date.now());
const RULE_SEEN = 'hh.orders.ruleSeen';

/** Skips waiting for their Undo window: `${slot}:${n}` -> { send, timer } (module level: a re-render keeps them). */
const skipping = new Map();
const skipKey = (slot, n) => `${slot}:${n}`;
/** Send every waiting skip now (the page is going away: the farmer meant it). */
export function flushSkips() {
  for (const [k, s] of [...skipping]) { clearTimeout(s.timer); skipping.delete(k); s.send(); }
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', flushSkips);

/** The board's slots in the order a farmer wants them: deliverable orders, then the others, then the waiting slots. */
export function boardOrder(state) {
  const rank = (s) => (!s.order ? 2 : shortfall(state, s.order).length === 0 ? 0 : 1);
  return boardSlots(state).filter((s) => !(s.order && skipping.has(skipKey(s.i, s.order.n))))
    .map((s, at) => ({ s, at, r: rank(s) })).sort((a, b) => a.r - b.r || a.at - b.at).map((x) => x.s);
}

/** Two farmers share this farm (the partner surfaces show only then). */
const twoFarmers = (st) => Object.keys(st.players ?? {}).length >= 2;

function ruleSeen() { try { return globalThis.localStorage?.getItem(RULE_SEEN) === '1'; } catch { return true; } }
function markRuleSeen() { try { globalThis.localStorage?.setItem(RULE_SEEN, '1'); } catch { /* private window */ } }

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
    const grid = h('div.pn-board', { 'aria-label': t('market.orders.dock') });
    body.append(head, grid);
    // the rule ("orders pay 50% more…") is read once on this device, then lives in Mabel's tooltip
    const firstVisit = !ruleSeen();
    if (firstVisit) markRuleSeen();
    const open = new Set();                     // slots whose "⋯" tray is open
    let epoch = 0;                              // bumps on a skip / undo: the memo re-renders
    // QA r1 P-17: both farmers have Orders open and the partner fills the order I am aiming at. Its row stays a
    // moment as a same-height "✓ Ana delivered this ♥" strip (nothing below it moves), then goes; a Deliver whose row
    // has just moved (that collapse, or a re-sort) ignores the press, so my tap never fills an order I did not choose
    const ghosts = new Map();                   // slot -> { n, by, kind: 'filled' | 'gone', h }
    let prevKeys = [];                          // the rows' keys at the last render, top to bottom
    const movedAt = new Map();                  // slot -> when its row last moved (clock())
    const movedRecently = (slot) => clock() - (movedAt.get(slot) ?? -Infinity) < MOVED_MS;
    // QA r2 P2-04: the partner's sale made the order under my cursor undeliverable, it dropped below the ready ones and
    // my click filled the order that slid up into its place. While the sheet is open the rows keep their places; they
    // sort afresh (deliverable first) when it opens and after my own act, never on a partner's change
    let resort = true;
    const timers = new Set();
    ctx.on(ctx.store, 'fx', ({ ev, local } = {}) => {
      if (ev && local) { resort = true; update(true); return; }
      if (!ev || local || (ev.e !== 'orderFilled' && ev.e !== 'orderGone')) return;
      if (!ev.by || ev.by === ctx.store.pid || !Number.isInteger(ev.slot)) return;
      // the row as it stands now (the state already changed; the panel redraws on the next frame)
      const row = grid.querySelector(`[data-slot="${ev.slot}"]`);
      ghosts.set(ev.slot, { n: ev.n, by: ev.by, kind: ev.e === 'orderFilled' ? 'filled' : 'gone', h: row?.offsetHeight || null });
      epoch++;
      const tm = setTimeout(() => { timers.delete(tm); ghosts.delete(ev.slot); epoch++; update(); }, GHOST_MS);
      timers.add(tm);
      update();
    });
    const sig = () => {
      const st = ctx.store.state;
      return [epoch, levelOf(st), st.farm.orders, boardSlots(st).map((s) => s.order && Object.keys(s.order.items).map((i) => have(st, i))),
        st.farm.wallet.acorns > 0, Object.keys(st.players ?? {}).length, [...open]];
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
        listRole(grid);
        kit.refresh();
        return;
      }
      // a ghost keeps the place its order had at the last render; the slot's new state shows once it has gone
      const live = stable(boardOrder(st).filter((s) => !ghosts.has(s.i)));
      const rows = live.map((s) => ({ s }));
      for (const [slot, g] of [...ghosts].sort(([a], [b]) => prevIndex(a) - prevIndex(b))) {
        rows.splice(Math.max(0, Math.min(rows.length, prevIndex(slot))), 0, { ghost: g, slot });
      }
      if (!rows.length) grid.append(empty(t('market.orders.writing'), 'orders'));
      const free = freeSlot(st, live);
      rows.forEach((r, n) => grid.append(r.ghost ? ghostCard(st, r.slot, r.ghost) : r.s.order ? orderCard(st, r.s, n) : waitingCard(st, r.s, n, free)));
      // a row moved when anything above it changed (a ghost counts as the order it stands for: same place, same height)
      const keys = rows.map((r) => (r.ghost ? `o:${r.slot}:${r.ghost.n}` : r.s.order ? `o:${r.s.i}:${r.s.order.n}` : `w:${r.s.i}`));
      const now = clock();
      keys.forEach((k, i) => {
        const was = prevKeys.indexOf(k);
        if (was >= 0 && keys.slice(0, i).join('|') !== prevKeys.slice(0, was).join('|')) movedAt.set(Number(k.split(':')[1]), now);
      });
      prevKeys = keys;
      const next = ORDERS.slots.find(([L]) => L > level);
      if (next && next[1] > orderSlotsAt(level)) {
        grid.append(h('div.pn-order.pn-order-later', { role: 'listitem' }, svgIcon('lock', 32),
          h('p', t('market.orders.nextSlot', { ord: lang() === 'en' ? ordinal(next[1]) : ordinalOf(next[1], 'f').replace('-', '‑'), n: next[0] }))));
      }
      listRole(grid);
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
      const rule = levelOf(st) < ORDERS.unlock ? t('market.orders.noteLater', { n: ORDERS.unlock })
        : rush === 0 ? t('market.orders.noteFree') : t('market.orders.noteCost', { n: ORDERS.refillAcorns });
      // the first visit she says her rule instead of the day's chatter: one paragraph, not two
      fill(head,
        h('div.pn-mabel', { title: rule }, portrait(mabel, 72),
          h('div.pn-speech', h('b', cname('mabel')), firstVisit ? h('p.pn-rule', rule) : h('p', t('market.orders.quote', { line })))),
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
      const of = t('market.orders.weekOf', { v: m.v, top: Math.ceil((m.e * top) / BP) });
      // a phone shows the short "47 081 / 300 000" (no tooltip on a finger: astra critique of the rows)
      return h('div.pn-meter', { title: of },
        h('div.pn-meter-title', h('b', t('market.orders.week')), h('span.pn-meter-of', of),
          h('span.pn-meter-n', t('market.orders.weekShort', { v: m.v, top: Math.ceil((m.e * top) / BP) }))),
        h('div.pn-meter-track', { role: 'progressbar', 'aria-label': `${t('market.orders.week')}: ${of}`, 'aria-valuemin': '0', 'aria-valuemax': '100',
          'aria-valuenow': String(Math.round(pct * 100)) }, h('span.pn-meter-fill', { style: { '--p': String(pct) } }), ...marks));
    }

    /** "↻ Skip": the order leaves the board now; the discard is sent after the Undo window (or at once when the
     *  rules want a confirm first: a partner's pinned order asks before anything moves). */
    function skip(s, o) {
      const it = I.discardOrder(s.i, o.n);
      const code = probe(ctx.store, it.type, it.args);
      if (code !== null) { ctx.act(it.type, it.args); return; }
      const key = skipKey(s.i, o.n);
      const send = () => ctx.act(it.type, it.args);
      const timer = setTimeout(() => { if (skipping.delete(key)) send(); }, SKIP_UNDO_MS);
      skipping.set(key, { send, timer });
      open.delete(s.i);
      epoch++;
      resort = true;                            // my own act: the board sorts afresh
      update();
      ctx.ui?.toast?.(t('market.orders.skipped', { d: fmtDuration(ORDERS.refillMs, { trim: true }) }), {
        kind: 'info', ms: SKIP_UNDO_MS,
        action: { label: t('market.barn.undo'), fn: () => {
          const w = skipping.get(key);
          if (!w) return;
          clearTimeout(w.timer);
          skipping.delete(key);
          epoch++;
          resort = true;
          update();
        } },
      });
    }

    function orderCard(st, s, n) {
      const o = s.order;
      const giver = o.golden ? npcOf(o.golden.giver) : null;
      const short = shortfall(st, o);
      const ready = short.length === 0;
      const items = h('div.pn-order-items', ...Object.entries(o.items).map(([item, q]) => chip(item, { have: have(st, item), need: q, size: 40 })));
      const pinBy = s.pin && st.players[s.pin] ? s.pin : null;
      const flagBy = s.flag && st.players[s.flag] ? s.flag : null;
      const me = ctx.store.pid;
      const helped = flagBy && flagBy !== me;
      const xp = helped ? o.xp + Math.floor((o.xp * COOP.helpFlags.xpBonusBp) / BP) : o.xp;
      const pair = twoFarmers(st);
      const trayOpen = open.has(s.i);
      const trayId = `pn-order-more-${s.i}`;
      // what the partner did with this order stays in sight with the tray shut ("Rosa is on it")
      const status = pinBy && pinBy !== me ? h('span.pn-order-status', { style: { '--who': st.players[pinBy].color } }, playerMark(pinBy, st.players[pinBy]), t('market.orders.onIt', { name: st.players[pinBy].name }))
        : flagBy && flagBy !== me ? h('span.pn-order-status', { style: { '--who': st.players[flagBy].color } }, playerMark(flagBy, st.players[flagBy]), t('market.orders.needsHelp', { name: st.players[flagBy].name }))
          : null;
      const face = giver ? portrait(giver, 40) : icon(o.simple ? 'orders' : 'order_board', { size: 40, alt: '' });
      const giverEl = h('div.pn-giver', face,
        // a quick order: "Quick order" over "small, counts a little toward goals" (M28; the whole line in the tooltip)
        o.simple && !giver ? h('div', { title: t('market.orders.quickSub') }, h('b', t('market.orders.quick')), h('small', t('market.orders.quickNote')))
          : h('div', h('b', giver ? cname(o.golden.giver) : t('market.orders.mabels')),
            h('small', giver ? (o.golden.duet ? t('market.orders.goldenDuet') : t('market.orders.golden')) : t('market.orders.allAtOnce'))));
      // skip and the co-op flags live behind one "⋯" (ux-first#21): the row keeps its width for the order itself
      const tools = h('div.pn-order-tools',
        h('button.pn-chipbtn.pn-order-moreBtn', { type: 'button', 'aria-expanded': String(trayOpen), 'aria-controls': trayId,
          'aria-label': pair ? t('market.orders.more') : t('market.orders.moreSolo'), title: pair ? t('market.orders.more') : t('market.orders.moreSolo'),
          dataset: { key: `more-${s.i}` },
          on: { click: (e) => { e.stopPropagation(); if (open.has(s.i)) open.delete(s.i); else open.add(s.i); update(); } } }, '⋯'));
      const pay = h('div.pn-order-pay', price({ coins: o.coins, acorns: o.golden ? o.golden.acorns : 0 }), h('span.pn-xp', t('market.orders.xp', { n: xp })),
        helped ? h('span.pn-help-bonus', t('market.orders.helpBonus')) : null, status);
      const tray = h('div.pn-order-coop', { id: trayId, hidden: !trayOpen },
        h('button.pn-chipbtn.pn-order-skip', { type: 'button', title: t('market.orders.skipTip'), dataset: { discard: String(s.i), key: `skip-${s.i}-${o.n}` },
          on: { click: (e) => { e.stopPropagation(); skip(s, o); } } }, t('market.orders.skipChip')),
        ...(pair ? [h('button.pn-chipbtn.pn-tag-btn', { type: 'button', 'aria-pressed': String(Boolean(pinBy)), disabled: Boolean(pinBy && pinBy !== me),
          style: pinBy ? { '--who': st.players[pinBy].color } : null, title: pinBy && pinBy !== me ? t('market.orders.onIt', { name: st.players[pinBy].name }) : t('market.orders.pinTip'),
          on: { click: () => { const it = I.pinOrder(s.i, o.n); ctx.act(it.type, it.args); } } },
        pinBy ? playerMark(pinBy, st.players[pinBy]) : svgIcon('ping', 18), pinBy ? (pinBy === me ? t('market.orders.imOnIt') : t('market.orders.onIt', { name: st.players[pinBy].name })) : t('market.orders.imOnIt')),
        h('button.pn-chipbtn.pn-tag-btn.pn-flag', { type: 'button', 'aria-pressed': String(Boolean(flagBy)), disabled: Boolean(flagBy && flagBy !== me),
          style: flagBy ? { '--who': st.players[flagBy].color } : null, title: t('market.orders.flagTip'),
          on: { click: () => { const it = I.flagOrder(s.i, o.n); ctx.act(it.type, it.args); } } },
        flagBy ? playerMark(flagBy, st.players[flagBy]) : '⚑', flagBy ? (flagBy === me ? t('market.orders.helpAsked') : t('market.orders.needsHelp', { name: st.players[flagBy].name })) : t('market.orders.needHelp'))] : []));
      const deliver = kit.button({ label: t('market.orders.deliver'), glyph: 'check', cls: `${ready ? 'btn--sun ' : ''}pn-deliver`, from: true, ...lazy(() => I.fillOrder(s.i, o.n)), data: { fill: String(s.i) },
        guard: () => movedRecently(s.i),
        hint: () => ({ missing: shortfall(ctx.store.state, o) }) });
      const attrs = { role: 'listitem', dataset: { slot: String(s.i), readyLabel: t('market.orders.readyTag') },
        style: { '--tilt': `${[-1.2, 0.8, -0.4, 1.1, -0.9, 0.5, -0.6, 1, -1][n % 9]}deg` } };
      const cls = `div.pn-order${o.golden ? '.golden' : ''}${ready ? '.ready' : ''}`;
      // a phone row (ux-phone#8): who and what it pays on one line, the goods and Deliver on the next; a desktop card
      if (phoneSheet()) return h(`${cls}.pn-order-row`, attrs, h('div.pn-order-head', giverEl, pay, tools), h('div.pn-order-main', items, deliver), tray);
      return h(cls, attrs, h('span.pn-pin', { 'aria-hidden': 'true' }), h('div.pn-order-head', giverEl, tools), items, pay, tray, deliver);
    }

    /**
     * The rows in the places they had at the last render (QA r2 P2-04), unless a re-sort is due (the sheet just opened, or
     * my own act): a row that is new since then (a refilled slot, an order the partner rushed) goes after the orders
     * already shown, a new waiting slot at the end, so nothing above the cursor moves.
     */
    function stable(sorted) {
      if (resort || !prevKeys.length) { resort = false; return sorted; }
      const pos = new Map(prevKeys.map((k, i) => [k, i]));
      const keyOf = (x) => (x.order ? `o:${x.i}:${x.order.n}` : `w:${x.i}`);
      const kept = sorted.filter((x) => pos.has(keyOf(x))).sort((a, b) => pos.get(keyOf(a)) - pos.get(keyOf(b)));
      const lastOrder = kept.findLastIndex((x) => x.order) + 1;
      const fresh = sorted.filter((x) => !pos.has(keyOf(x)));
      return [...kept.slice(0, lastOrder), ...fresh.filter((x) => x.order), ...kept.slice(lastOrder), ...fresh.filter((x) => !x.order)];
    }

    function prevIndex(slot) {
      const i = prevKeys.findIndex((k) => Number(k.split(':')[1]) === slot);
      return i < 0 ? Infinity : i;
    }

    /** The partner's filled (or skipped) order, a moment longer in its place: same height, no buttons. */
    function ghostCard(st, slot, g) {
      const p = st.players?.[g.by];
      const name = p ? p.name : t('common.partner');
      return h('div.pn-order.pn-order-ghost', { role: 'listitem', dataset: { slot: String(slot) }, 'aria-live': 'polite',
        style: { ...(g.h ? { minHeight: `${g.h}px` } : {}), ...(p ? { '--who': p.color } : {}) } },
      p ? playerMark(g.by, p) : null,
      h('p', g.kind === 'filled' ? t('market.orders.ghostFilled', { name }) : t('market.orders.ghostGone', { name })));
    }

    /**
     * QA r3 P3-03: the day's free new order is offered on ONE waiting slot, the one that would wait longest (the most
     * time saved), never on every slot (three "free once a day" rows read as three free orders). The rules grant the
     * first rush of the day free whichever slot it is, so while it is unused the other slots offer no button at all: a
     * price there would be false. Null when the free one is used (every slot then offers its acorn price).
     */
    function freeSlot(st, live) {
      if (rushPrice(st, ctx.now()) !== 0) return null;
      const waiting = live.filter((s) => !s.order);
      if (!waiting.length) return null;
      return waiting.reduce((a, b) => (b.availableAt > a.availableAt ? b : a)).i;
    }

    function waitingCard(st, s, n, free) {
      const tm = h('b.pn-timer');
      kit.timer(tm, { end: s.availableAt, doneText: t('market.orders.anySecond'), done: () => setTimeout(() => update(true), 600) });
      const cost = rushPrice(st, ctx.now());
      const offer = cost > 0 || free === s.i;
      return h('div.pn-order.pn-order-wait', { role: 'listitem', dataset: { slot: String(s.i) }, style: { '--tilt': `${[0.6, -0.8, 1][n % 3]}deg` } },
        h('span.pn-pin', { 'aria-hidden': 'true' }),
        icon('order_board', { size: 64, alt: '' }),
        h('p', t('market.orders.onTheWay')), tm,
        offer ? kit.button({ label: cost ? t('market.orders.now', { n: cost }) : t('market.orders.nowFree'), cls: 'pn-xs btn--sky', ...lazy(() => I.rushOrder(s.i)), data: { rush: String(s.i) },
          gate: () => (cost > ctx.store.state.farm.wallet.acorns ? { code: 'NO_ITEMS', hint: { acorns: cost - ctx.store.state.farm.wallet.acorns } } : null) }) : null,
        // the day's free one says its rule under the button, never inside it (QA r1 P-04: it spilled out at 360 BG)
        offer && !cost ? h('small.pn-rush-note', t('market.orders.nowFreeNote')) : null);
    }

    update(true);
    return { update: () => update(), destroy() { for (const tm of timers) clearTimeout(tm); timers.clear(); } };
  },
};

/** English only ("an eighth order"); Bulgarian takes i18n's ordinal ("5-та поръчка"). */
function ordinal(n) {
  return ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][n] ?? `${n}th`;
}
