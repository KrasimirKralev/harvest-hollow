// The Market (GDD §7.3, §4.10): Mabel's stand to SELL, and the general store to BUY seeds, trees, animals,
// buildings, decor, land, tools and Acorn goods. Opened by the coins pill and M (args { tab }).
// Every price comes from content through model.js; every click goes through the rules (prediction).
import { itemOf, defOf, pluralOf, MARKET, SAFETY, ORDERS } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, price, stars, empty, ribbonTag, pill, chip, hintable, tParts, listRole, scrollBehavior } from './kit.js';
import {
  STORE_TABS, storeCards, sellList, demandOf, levelOf, keepOf, placedOf, capOf, priceOf, saleQuote,
} from './model.js';
import { I } from './intents.js';
import { probe, passes } from './core.js';
import { startPlacement } from './placement.js';
import { landMap } from './art.js';
import { shopTags, shopSetsLink } from './decor-sets.js';
import { touchPlayer, touchText } from '../dom.js';
import { LAYOUT_Q } from '../layout.js';
import { grandStrip } from './grand-decor.js';
import { relicSig } from './w4b.js';
import { t, N, Q, lang, list, qty as qtyOf, name as cname, fmtDec, fmtPct } from '../../i18n/index.js';
import { lazyImport, importFailed } from '../../net/lazy.js';

/** Farm Beauty per piece: whole numbers as they are, halves with one decimal (a Dirt Path is +0.5, not +0). */
const beautyText = (b) => (Number.isInteger(b) ? fmt(b) : fmtDec(b, 1));

const env = (ctx) => ({ now: ctx.now(), pid: ctx.store.pid });

/**
 * Store cards of a tab, computed once per update: the tab's change signature and every card's button gate read the
 * same list (a partner's drag stroke updates the panel every frame; ten gates must not recompute ten lists). The
 * Market's update() starts a new generation; a button click refreshes against the next update's fresh list.
 */
function cardsOf(ctx, tab) {
  const c = ctx.cards || (ctx.cards = { gen: 0, at: -1, map: new Map() });
  if (c.at !== c.gen) { c.map.clear(); c.at = c.gen; }
  if (!c.map.has(tab)) c.map.set(tab, storeCards(ctx.store.state, tab, env(ctx)));
  return c.map.get(tab);
}
const nextGen = (ctx) => { if (ctx.cards) ctx.cards.gen++; };

/** A card whose level is still ahead: it waits in the tab's "Next:" strip, not in the grid (ux-first#17). */
export const levelLocked = (c, level) => Number.isFinite(c.unlock) && c.unlock > level && (c.code === 'LOCKED' || c.code === null || c.code === undefined);

/**
 * A store tab shows once something in it is live at this level (ux-first#17: nine tabs at L1). Sell and Seeds always;
 * a tab the caller asked for by name (a "Show me", a goal card) shows too.
 */
export function tabLive(state, tab) {
  if (tab === 'sell' || tab === 'seeds') return true;
  try {
    const level = levelOf(state);
    return storeCards(state, tab, {}).some((c) => !levelLocked(c, level));
  } catch { return true; }
}

export const marketPanel = {
  get title() { return t('market.title'); },
  icon: 'market_stand',
  size: 'full',
  hotkey: 'm',
  dock: { get label() { return t('market.dock.label'); }, icon: 'market', order: 2, get hint() { return t('market.dock.hint'); } },
  tabs: (args, state) => [{ id: 'sell', label: t('market.tab.sell'), icon: 'coins' },
    ...STORE_TABS.filter((tb) => !state || tb.id === args?.tab || tabLive(state, tb.id))],
  topics: ['wallet', 'relics', 'inventory', 'objects', 'xp', 'expansions', 'keep', 'demand', 'tools', 'storage', 'golden',
    'proofs', 'barn', 'mastery', 'wishlist'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let tab = ctx.tab || 'sell';
    let view = null;
    const render = () => {
      body.replaceChildren();
      view = tab === 'sell' ? sellTab(body, ctx, kit) : tab === 'land' ? landTab(body, ctx, kit) : storeTab(body, ctx, kit, tab);
    };
    render();
    // a level-up while the Market is open can bring a tab to life: the strip follows
    const liveSig = () => STORE_TABS.map((tb) => (tabLive(ctx.store.state, tb.id) ? 1 : 0)).join('');
    let live = liveSig();
    return {
      tab(id) { tab = id; nextGen(ctx); render(); },
      update(ch) {
        nextGen(ctx);
        if (view && view.update) view.update(ch); else render();
        kit.refresh();
        const has = (k) => (typeof ch?.topics?.has === 'function' ? ch.topics.has(k) : Array.isArray(ch?.topics) && ch.topics.includes(k));
        if (!ch || !ch.topics || has('xp') || has('*')) {
          const now = liveSig();
          if (now !== live) { live = now; ctx.refreshTabs?.(); }
        }
      },
    };
  },
};

/** { type, args } that re-reads its intent on every probe (quantities change). */
const lazy = (f) => ({ type: () => f().type, args: () => f().args });

// ---- Sell ------------------------------------------------------------------------------------------------------

function sellTab(body, ctx, kit) {
  const store = ctx.store;
  let selected = ctx.args.item || null;
  let qty = 0;
  const board = h('div.pn-chalk-wrap');
  const grid = h('div.pn-stacks', { role: 'listbox', 'aria-label': t('market.sell.goods') });
  const tip = h('p.pn-tip');
  // a section, not an <aside>: the slip is the Market's own content, not a side note (perf-a11y#13)
  const slip = h('section.pn-slip', { 'aria-label': t('market.sell.slip') });
  body.append(h('div.pn-sell', h('div.pn-sell-main', board, grid, tip), slip));
  // QA r4 L4-01 (life-feel's patch): upright on a phone the slip is the sheet's sticky foot, so a line raised over the
  // open Market (an Undo) is lifted above it, never laid on "Продай 10" (ui/toasts.js liftSnacks). On its side or on a
  // desktop the slip is a tall column, not a floor: counting it would lift the line to the top. Follows a rotation
  const upright = globalThis.matchMedia?.(LAYOUT_Q.portrait);
  const foot = () => { if (upright?.matches) slip.dataset.stickyFoot = '1'; else delete slip.dataset.stickyFoot; };
  foot();
  if (upright?.addEventListener) ctx.on(upright, 'change', foot);

  const defaultQty = (s) => Math.max(1, s.free > 0 ? s.free : s.n);
  // a stack the Market picks by itself (none named, none tapped) offers at most 10: the sheet's first button is never a
  // big whole-stack sale (ui-shell QA r2 S2-05: a double tap on the phone bar's Market door sold 39 Cabbage, no undo).
  // 10, not 1: the coach's first sale is "Sell 10 Wheat", still two taps (door, Sell)
  const AUTO_MAX = 10;
  let auto = !selected;

  function renderBoard() {
    board.replaceChildren();
    if (levelOf(store.state) < MARKET.demand.unlock) return;
    const d = demandOf(store.state, ctx.now());
    // the Market Stand's upgrades (wave 4, wish E: more Demand, better prices) are one tap from here
    const stand = ctx.ui.panels.has?.('upgrades') ? Object.keys(store.state.farm.objects).sort().find((k) => store.state.farm.objects[k].def === 'market_stand') : null;
    const up = stand ? store.state.farm.objects[stand].up ?? 0 : 0;
    board.append(h('div.pn-chalk', { role: 'note' },
      h('div.pn-chalk-title', t('market.chalk.title'), stand ? h('button.pn-chalk-up', { type: 'button', 'data-sfx': 'own', dataset: { key: 'stand-up' },
        'aria-label': t('market.chalk.upAria', { n: up }), on: { click: () => ctx.open('upgrades', { id: stand }) } }, t('market.chalk.up', { n: up })) : null),
      d ? h('div.pn-chalk-body', h('span.pn-chalk-lead', t('market.chalk.lead')),
        ...d.items.map((x) => h(`span.pn-chalk-item${x.left ? '' : '.done'}`, icon(x.id, { size: 28 }), itemOf(x.id) ? cname(x.id) : x.id,
          h('small', x.left ? t('market.chalk.left', { n: x.left }) : t('market.chalk.soldOut')))))
        : h('div.pn-chalk-body', t('market.chalk.none'))));
  }

  function renderGrid() {
    const list = sellList(store.state, ctx.now());
    grid.replaceChildren();
    if (!list.length) {
      grid.append(empty(t('market.sell.empty'), 'market'));
      selected = null;
    } else {
      if (!selected || !list.some((s) => s.id === selected)) { selected = list[0].id; qty = 0; auto = true; }
      if (!qty) { const one = list.find((s) => s.id === selected); qty = auto ? Math.min(AUTO_MAX, defaultQty(one)) : defaultQty(one); }
      for (const s of list) {
        const on = s.id === selected;
        // "37 more each than the base price" lives in the tile's tooltip, not on the slip (astra#4)
        const tip = t('market.sell.stackTip', { item: s.name, n: s.n, unit: s.unit });
        grid.append(h(`button.pn-stack${on ? '.on' : ''}`, {
          type: 'button', role: 'option', 'aria-selected': String(on),
          title: s.unit > s.sell ? `${tip}. ${t('market.sell.moreEach', { n: s.unit - s.sell })}` : tip,
          dataset: { item: s.id, key: `stack-${s.id}` },
          // a tap on the stack the Market picked by itself offers all of it (the slip redraws: its stack did not change)
          on: { click: () => { selected = s.id; auto = false; qty = defaultQty(s); gridM(); slipM(true); } },
        }, icon(s.id, { size: 56, alt: '' }),
        h('span.pn-stack-n', `×${fmt(s.n)}`),
        // a long name takes its short form ("Смлян пипер"; the tooltip and the slip keep the whole one, QA r1 P-16)
        h('span.pn-stack-name', s.name.length > 14 ? cname(s.id, { form: 'short' }) : s.name),
        h('span.pn-stack-price', svgIcon('coin', 16), fmt(s.unit)),
        s.demand ? ribbonTag(`+${fmtPct(MARKET.demand.bonusBp / 100)}`, 'pn-demand') : null,
        s.keep > 0 ? h('span.pn-keep-tag', { title: t('market.sell.keeping', { n: s.keep }) }, svgIcon('lock', 14), fmt(s.keep)) : null));
      }
    }
    // the orders tip only once the board has orders (QA r1 P-08: at level 1 "Press O" did nothing and the touch line
    // named a Menu 1.0 does not have); before that, when they come
    const board = levelOf(store.state) >= ORDERS.unlock;
    tip.textContent = list.length > 6 ? '' : !board ? t('market.orders.noteLater', { n: ORDERS.unlock })
      : t(touchPlayer() ? 'market.sell.tipTouch' : 'market.sell.tipKeys');
    // a listbox needs its options: an empty pane is a plain note (QA r1 P-19, axe aria-required-children)
    listRole(grid, 'listbox');
  }

  function renderSlip() {
    slip.replaceChildren();
    const all = sellList(store.state, ctx.now());
    const s = all.find((x) => x.id === selected);
    if (!s) {
      // nothing on the left to pick: say where goods come from, never "pick something on the left" (feel#15)
      slip.append(h('div.pn-slip-empty', svgIcon('coin', 48), h('p', all.length ? t('market.sell.pick') : t('market.sell.emptySlip'))));
      return;
    }
    qty = Math.max(1, Math.min(qty, s.n));
    const it = itemOf(s.id);
    const keep = keepOf(store.state, s.id);
    const keeper = keep.by && store.state.players[keep.by] ? store.state.players[keep.by].name : null;
    const total = h('b.pn-slip-total');
    const each = h('span.pn-slip-each');
    const wanted = h('p.pn-slip-wanted');
    const note = h('p.pn-slip-note');
    const range = h('input.pn-range', { type: 'range', min: '1', max: String(s.n), value: String(qty),
      'aria-label': t('market.sell.howMany', { item: N(s.id) }), on: { input: (e) => { qty = Number(e.target.value); quote(); } } });
    // QA r3 S3-16 (ui-shell's patch): the field names its button, so keepInView keeps "Sell 10" above a phone's keyboard
    const num = h('input.pn-num', { type: 'number', min: '1', max: String(s.n), value: String(qty), inputmode: 'numeric', dataset: { keepInView: 'sell' },
      'aria-label': t('market.sell.qty'), on: { change: (e) => { qty = Math.max(1, Math.min(s.n, Math.trunc(Number(e.target.value)) || 1)); quote(); } } });
    const quick = h('div.pn-quick');
    const q = (label, n, cls = null) => h('button.pn-chipbtn', { type: 'button', class: cls, on: { click: () => { qty = n; quote(); } } }, label);
    quick.append(q('1', 1));
    if (s.n >= 20) quick.append(q('10', 10));
    if (s.n > 3) quick.append(q(t('market.sell.half'), Math.max(1, Math.floor(s.n / 2))));
    if (keep.n > 0 && s.free > 0 && s.free < s.n) quick.append(q(t('market.sell.allBut', { n: keep.n }), s.free, 'pn-q-allbut'));
    quick.append(q(t('market.sell.all', { n: s.n }), s.n, 'pn-q-all'));
    const sellBtn = kit.button({ label: t('market.sell.btn', { n: qty }), cls: 'pn-sell-btn', glyph: 'coin', from: true,
      ...lazy(() => I.sell(s.id, qty)), hint: () => ({ name: keeper }), data: { sell: s.id, act: 'sell' } });
    slip.append(
      h('div.pn-slip-head', icon(s.id, { size: 88 }), h('div',
        h('h3.pn-slip-title', cname(s.id)),
        h('div.pn-slip-have', t('market.sell.inBarn', { n: s.n }), s.over ? h('span.pn-over-tag', t('market.sell.over', { n: s.over })) : null),
        keep.n > 0 ? h('div.pn-slip-keep', svgIcon('lock', 16), keeper && keep.by !== 'sys' ? t('market.sell.keeps', { name: keeper, n: keep.n }) : t('market.sell.keeping', { n: keep.n })) : null)),
      h('div.pn-slip-qty', range, num), quick,
      h('div.pn-slip-sum', each, total), wanted, note, sellBtn);

    function quote() {
      range.value = String(qty);
      num.value = String(qty);
      sellBtn.button.querySelector('.pn-btn-label').textContent = t('market.sell.btn', { n: qty });
      const r = saleQuote(store.state, s.id, qty, ctx.now(), store.pid);
      total.replaceChildren(svgIcon('coin', 26), fmt(r.coins));
      each.textContent = receipt(qty, r);
      // one quiet line says where the Demand price comes from: "669 + 50% wanted today"
      wanted.textContent = r.demand ? t('market.sell.wanted', { unit: r.unit, pct: fmtPct(MARKET.demand.bonusBp / 100) }) : '';
      wanted.hidden = !r.demand;
      note.textContent = qty > s.free && keep.n > 0 ? t('market.sell.dips', { n: keep.n }) : '';
      note.hidden = !note.textContent;
      kit.refresh();
    }
    quote();
  }

  const st = () => ctx.store.state;
  const boardM = kit.memo(board, () => [levelOf(st()), demandOf(st(), ctx.now())], renderBoard);
  const gridM = kit.memo(grid, () => [selected, sellList(st(), ctx.now()).map((x) => [x.id, x.n, x.unit, x.demand, x.keep])], renderGrid);
  const slipM = kit.memo(slip, () => {
    const x = sellList(st(), ctx.now()).find((y) => y.id === selected);
    return x ? [x.id, x.n, x.over, x.keep, x.keepBy, x.unit, x.demandLeft] : null;
  }, renderSlip);
  boardM(); gridM(); slipM();
  return { update() { boardM(); gridM(); slipM(); } };
}

/**
 * The slip's sum as it adds up (astra#4, M18): "39 × 1,003 =" when every unit goes at the Demand price, "39 × 1,003 +
 * 11 × 669 =" when part of it does, "12 × 669 =" with no Demand. `r` is saleQuote's answer; the total follows it.
 */
export function receipt(qty, r) {
  if (!r.demand) return t('market.sell.each', { n: qty, unit: r.unit });
  if (r.demand >= qty) return t('market.sell.each', { n: qty, unit: r.bonusUnit });
  return t('market.sell.eachDemand', { d: r.demand, bonus: r.bonusUnit, n: qty - r.demand, unit: r.unit });
}

// ---- Store tabs -------------------------------------------------------------------------------------------------

/** Each store tab's one-line intro (read when the tab draws, so it follows the language). */
const TAB_INTRO = new Proxy({}, {
  get: (_, tab) => (typeof tab === 'string' && ['seeds', 'trees', 'animals', 'buildings', 'decor', 'land', 'tools', 'acorn'].includes(tab)
    ? t(`market.intro.${tab}`) : undefined),
});

function storeTab(body, ctx, kit, tab) {
  const head = h('div.pn-store-head');
  const grid = h(`div.pn-cards.pn-cards-${tab}`, { role: 'list' });
  body.append(head, grid);
  const sig = () => {
    const st = ctx.store.state;
    return [cardsOf(ctx, tab).map((c) => [c.id, c.adult, c.code, c.hint, c.owned, c.price, c.tray, c.big, c.room, c.inSeason, c.packets]),
      tab === 'seeds' ? [placedOf(st, 'plot').length, capOf(st, 'plot'), priceOf(st, 'plot')] : null,
      tab === 'acorn' ? relicSig(st, ctx.store.pid, ctx.now()) : null];
  };
  const update = kit.memo(body, sig, render);
  function render() {
    const st = ctx.store.state;
    const wishes = Object.keys(st.farm.wishlist ?? {}).length;
    head.replaceChildren(h('div.pn-store-intro', h('p.pn-intro', TAB_INTRO[tab] || ''),
      levelOf(st) >= SAFETY.wishlist.unlock ? h('button.pn-chipbtn.pn-wishlink', { type: 'button', 'data-sfx': 'own', on: { click: () => ctx.open('wishlist') } },
        t('market.wishlink'), wishes ? h('b', ` ${wishes}`) : null) : null));
    if (tab === 'seeds') head.append(plotStrip(ctx, kit));
    // decor sets and Masterwork (ui-collect): the set view from the decor tabs
    if (tab === 'decor' || tab === 'acorn') { const link = shopSetsLink(ctx, levelOf(st)); if (link) head.firstChild.append(link); }
    // the Grand decor showroom (ui-home, M2): the ten `tier: 'grand'` pieces are in no other Market tab
    if (tab === 'decor') { const g = grandStrip(ctx); if (g) head.append(g); }
    // the treasures (wave 4b, owner wish 2): unique, for good, worth weeks of Acorns
    if (tab === 'acorn') head.append(relicSlot(ctx, kit));
    grid.replaceChildren();
    const all = cardsOf(ctx, tab);
    const level = levelOf(st);
    // what the level still holds back folds into one "Next: L4 Sunset Bench · L5 Hay Bale…" strip (ux-first#17)
    const later = tab === 'animals' ? lockedAnimals(all, level) : all.filter((c) => levelLocked(c, level));
    const hide = new Set(later.map((c) => c.id));
    const cards = all.filter((c) => !hide.has(c.id));
    if (!cards.length) grid.append(empty(t('market.store.empty')));
    if (tab === 'animals') renderAnimals(grid, cards, ctx, kit);
    else for (const c of cards) grid.append(storeCard(c, ctx, kit, tab));
    if (later.length) grid.after(nextStrip(later));
    else nextStripOf(grid)?.remove();
    listRole(grid);
    kit.refresh();
  }
  update();
  focusCard(body, ctx);              // the whole tab: a treasure card (wave 4b) sits in the head
  return { update };
}

/** The cards of the Animals tab still ahead by level: a locked home with its animals, and an animal past its home. */
function lockedAnimals(cards, level) {
  const out = [];
  for (const c of cards) {
    if (c.kind === 'home' && levelLocked(c, level)) out.push(c);
    else if (c.kind === 'animal' && !c.adult && levelLocked(c, level) && !out.some((x) => x.id === c.id)) out.push(c);
  }
  return out;
}

const NEXT_SHOWN = 8;
const nextStripOf = (grid) => (grid.nextElementSibling?.classList?.contains('pn-next-strip') ? grid.nextElementSibling : null);
/** "Next: L4 Sunset Bench · L5 Hay Bale…": what the coming levels bring, one line, in level order. */
function nextStrip(later) {
  const sorted = [...later].sort((a, b) => (a.unlock ?? 0) - (b.unlock ?? 0));
  const items = sorted.slice(0, NEXT_SHOWN).map((c, i) => [i ? h('span.pn-dot-sep', { 'aria-hidden': 'true' }, ' · ') : ' ',
    h('span.pn-next-item', { dataset: { def: c.id } }, icon(c.icon ?? c.id, { size: 24, alt: '' }), t('market.store.nextItem', { n: c.unlock, name: c.name }))]);
  return h('div.pn-next-strip', { role: 'note' }, h('b', t('market.store.next')), ...items.flat(),
    sorted.length > NEXT_SHOWN ? [' ', h('span.pn-next-more', t('market.store.nextMore', { n: sorted.length - NEXT_SHOWN }))] : null);
}

/** The treasures' section, its module loaded with the Acorn tab's first look (the boot never carries it). */
let relicMod = null;
function relicSlot(ctx, kit) {
  const slot = h('div.pn-relics-slot');
  const fill = (m) => { slot.replaceChildren(m.relicSection(ctx, kit).el); kit.refresh(); };
  if (relicMod) fill(relicMod);
  else {
    lazyImport('relic-shop', () => import('./relic-shop.js')).then((m) => {
      relicMod = m;
      if (!slot.isConnected) return;
      fill(m);
      // a "Show me" on a treasure (the Goal Tracker) waited for its card
      const want = ctx.args && ctx.args.focus;
      const card = want ? slot.querySelector(`[data-def="${CSS.escape(String(want))}"]`) : null;
      if (card) { card.scrollIntoView({ block: 'center', behavior: scrollBehavior() }); card.classList.add('pn-focus-ring'); setTimeout(() => card.classList.remove('pn-focus-ring'), 2000); }
    }).catch((err) => { if (!importFailed(err)) console.error('the treasures did not load', err); });
  }
  return slot;
}

/**
 * args.focus ("Show me" on an unlock, a goal card): scroll that card into view, put the keyboard focus on it and
 * ring it for 2 s, once per opening (QA wave 1 UI-13).
 */
function focusCard(grid, ctx) {
  const want = ctx.args && ctx.args.focus;
  if (!want || ctx.focusDone === want) return;
  requestAnimationFrame(() => {
    const card = grid.querySelector(`[data-def="${CSS.escape(String(want))}"]`);
    if (!card) return;
    ctx.focusDone = want;
    card.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    card.classList.add('pn-focus-ring');
    setTimeout(() => card.classList.remove('pn-focus-ring'), 2000);
    const btn = card.querySelector('.pn-card-foot button:not([aria-disabled="true"]), .pn-relic-foot button:not([aria-disabled="true"])');
    if (btn) btn.focus({ preventScroll: true });
    else { card.setAttribute('tabindex', '-1'); card.focus({ preventScroll: true }); }
  });
}

/** Plots on top of the Seeds tab: cap, owned, the next plot's price, "Place a plot". */
function plotStrip(ctx, kit) {
  const st = ctx.store.state;
  const cap = capOf(st, 'plot');
  const owned = placedOf(st, 'plot').length;
  const full = owned >= cap;
  return h('div.pn-plotstrip', icon('plot', { size: 56 }),
    h('div.pn-plotstrip-text', h('b', t('market.plots.of', { n: owned, cap })),
      h('span', full ? t('market.plots.full') : t('market.plots.more', { n: cap - owned }))),
    price({ coins: priceOf(st, 'plot').coins }),
    kit.button({ label: t('market.plots.place'), glyph: 'hammer', cls: 'btn--sky', data: { place: 'plot' },
      gate: () => {
        const s = ctx.store.state;
        if (placedOf(s, 'plot').length >= capOf(s, 'plot')) return { code: 'CAP', hint: { cap: capOf(s, 'plot') } };
        const p = priceOf(s, 'plot').coins;
        return p > s.farm.wallet.coins ? { code: 'NO_COINS', hint: { coins: p - s.farm.wallet.coins } } : { code: null };
      },
      onClick: () => startPlacement(ctx, 'plot') }));
}

function facts(c, tab) {
  switch (tab) {
    // two labelled lines, so the seed price and the harvest value can never be mistaken for each other (UI-25)
    case 'seeds': return [
      h('span.pn-fact-line', { title: t('market.facts.plantTip') },
        h('b', t('market.facts.plant')), svgIcon('coin', 14), fmt(c.price.coins), h('span.pn-dot-sep', '·'), t('market.facts.grows', { d: c.grow })),
      h('span.pn-fact-line', { title: t('market.facts.harvestTip') },
        h('b', t('market.facts.harvest')), `${fmt(c.yield)} ×`, svgIcon('coin', 14), fmt(c.sell), h('span.pn-dot-sep', '·'), h('span.pn-xp', t('common.xp', { n: c.xp })))];
    case 'trees': return [h('span', t('market.facts.every', { d: c.cycle })), h('span', `${fmt(c.yield)} × `, icon(c.product, { size: 18 })),
      c.cap !== null ? h('span', { title: t('market.facts.ownedTip') }, t('market.facts.of', { n: c.owned, cap: c.cap })) : null];
    case 'buildings': {
      const b = defOf(c.id);
      return [h('span', t('market.facts.tiles', { w: c.size[0], h: c.size[1] })),
        b && b.collector ? h('span', t('market.facts.compost'))
          : [h('span', t('market.facts.slots', { n: c.slots[0] })), h('span', t('market.facts.recipes', { n: c.recipes }))]];
    }
    case 'animals': return c.kind === 'home'
      ? [h('span', c.capacityMax ? t('market.facts.holdsUpTo', { n: c.capacity ?? 0, max: c.capacityMax }) : t('market.facts.holds', { n: c.capacity ?? 0 })),
        c.species && c.species.length ? h('span', t('market.facts.for'), ...c.species.map((sp) => icon(sp, { size: 20, alt: defOf(sp) ? cname(sp) : sp }))) : null,
        c.size ? h('span', t('market.facts.tiles', { w: c.size[0], h: c.size[1] })) : null]
      : [];
    case 'decor': return [c.size ? h('span', `${c.size[0]}×${c.size[1]}`) : null,
      c.beauty ? h('span', t('market.facts.beauty', { b: beautyText(c.beauty) })) : null];
    case 'tools': return [c.brush ? h('span', t('market.facts.brush', { w: c.brush[0], h: c.brush[1] })) : null,
      c.kind === 'goods' ? h('span', t('market.sell.inBarn', { n: c.owned })) : null];
    case 'acorn': return c.kind === 'boost' ? [h('span', t('market.facts.golden', { n: c.owned }))]
      : [c.size ? h('span', `${c.size[0]}×${c.size[1]}`) : null, c.beauty ? h('span', t('market.facts.beauty', { b: beautyText(c.beauty) })) : null];
    default: return [];
  }
}

function cardArt(c, ctx, level, iconId = c.icon) {
  const locked = c.code === 'LOCKED' && c.hint && c.hint.unlock > level;
  const art = h('div.pn-card-art', icon(iconId, { size: 72, alt: '' }));
  if (locked) art.append(h('span.pn-lock', svgIcon('lock', 18), t('common.level', { n: c.unlock })));
  else if (c.isNew) art.append(ribbonTag(t('market.card.new'), 'pn-new'));
  if (!locked && c.tray > 0) art.append(ribbonTag(c.tray > 1 ? t('market.card.trayN', { n: c.tray }) : t('market.card.tray'), 'pn-free-tag'));
  else if (!locked && c.inSeason) art.append(ribbonTag(t('market.card.inSeason'), 'pn-season'));
  if (!locked && c.packets > 0) art.append(ribbonTag(t('market.card.packets', { n: c.packets }), 'pn-free-tag'));
  return { art, locked };
}

/** The panel that shows a placed object of a def (a building's queue, a home's animals, a tree), or null. */
function panelFor(st, defId) {
  const id = Object.keys(st.farm.objects).sort().find((k) => st.farm.objects[k].def === defId);
  if (!id) return null;
  const kind = defOf(defId)?.kind;
  if (kind === 'building') return { name: 'building', args: { id } };
  if (kind === 'home') return { name: 'animals', args: { id } };
  if (kind === 'tree') return { name: 'tree', args: { id } };
  return null;
}

/** "♡ Wish": put a shop object on the Wishlist (L9; the rules decide what may be wished). */
function wishButton(c, ctx) {
  const st = ctx.store.state;
  // the rules decide what may be wished (no trees, plots or Acorn decor; nothing locked): ask them
  if (levelOf(st) < SAFETY.wishlist.unlock || !['home', 'building', 'decor'].includes(c.kind) || c.code === 'CAP') return null;
  const it = I.wish(c.id);
  const wished = Object.values(st.farm.wishlist ?? {}).some((w) => w.def === c.id);
  if (!wished && !passes(probe(ctx.store, it.type, it.args))) return null;
  return h('button.pn-wishbtn', { type: 'button', 'aria-pressed': String(wished), title: wished ? t('market.wish.on') : t('market.wish.save'),
    'aria-label': t('market.wish.aria', { item: c.name }), dataset: { wish: c.id },
    on: { click: (e) => { e.stopPropagation(); if (wished) { ctx.open('wishlist'); return; } const r = ctx.act(it.type, it.args); if (r && r.ok) ctx.ui.toast(t('market.wish.added', { item: c.name })); } } },
  wished ? '♥' : '♡');
}

function storeCard(c, ctx, kit, tab) {
  const st = ctx.store.state;
  const level = levelOf(st);
  const { art, locked } = cardArt(c, ctx, level);
  const foot = h('div.pn-card-foot');
  const placedAll = c.code === 'CAP' && ['building', 'home'].includes(c.kind);
  // a placeable's button carries its price ("Buy & place · 160"), so the foot shows no second price (ux-first#13)
  const priced = ['tree', 'home', 'building', 'decor'].includes(c.kind);
  if (locked) foot.append(h('span.pn-later', t('market.why.unlockAt', { n: c.unlock })));
  else if (c.kind === 'tool' && c.owned) foot.append(pill(t('market.tool.owned'), 'pn-owned'));
  else if (placedAll) {
    const to = panelFor(st, c.id);
    foot.append(pill(t('market.card.onFarm'), 'pn-owned'), to ? h('button.pn-chipbtn', { type: 'button', 'data-sfx': 'own', on: { click: () => ctx.open(to.name, to.args) } }, t('market.card.open')) : '');   // '' not null: append prints a null
  } else if (c.code === 'CAP') foot.append(h('span.pn-later', c.cap ? t('market.card.capOf', { n: c.owned, cap: c.cap }) : t('market.card.cap')));
  else {
    // a seed card names its price in the "Plant" line already: the foot holds only the button
    if (c.kind !== 'seed' && !priced) foot.append(c.tray > 0 ? h('span.pn-cost.pn-free', t('market.kit.free')) : price(c.price, { big: c.big && c.code === null }));
    const a = actionFor(c, ctx, kit, tab);
    if (a) foot.append(a);
  }
  if (!locked) { const w = wishButton(c, ctx); if (w) art.append(w); }
  return h(`div.pn-card${locked ? '.locked' : ''}${placedAll ? '.owned' : ''}`, { role: 'listitem', dataset: { def: c.id, kind: c.kind } },
    art, h('h3.pn-card-name', c.name), c.stars ? stars(c.stars) : null,
    h('div.pn-card-facts', facts(c, tab)), (tab === 'decor' || tab === 'acorn') && !locked ? shopTags(c.id, level) : null,
    // "One click waters…" is "One tap waters…" for a finger (ux-phone#19, S9b)
    c.text && !locked ? h('p.pn-card-text', touchText(c.text, touchPlayer(ctx.controller))) : null, foot);
}

/** The card's button; its gate re-reads the model so it stays right while the panel is open. */
function actionFor(c, ctx, kit, tab) {
  const gate = () => {
    const fresh = cardsOf(ctx, tab).find((x) => x.id === c.id && x.adult === c.adult) || c;
    return { code: fresh.code, hint: fresh.hint };
  };
  switch (c.kind) {
    case 'seed':
      return kit.button({ label: t('market.facts.plant'), glyph: 'sprout', gate, data: { seed: c.id },
        onClick: () => { ctx.controller.setTool('seed', { crop: c.id }); ctx.close(); } });
    case 'tree': case 'home': case 'building': case 'decor': {
      // one verb per thing: "Place" for one waiting in the tray or a free one, "Buy & place · 160" for a priced one
      const free = c.tray > 0 || (!(c.price?.coins > 0) && !(c.price?.acorns > 0));
      const coins = c.price?.coins > 0;
      // the coin rides with its number ("● 160" never splits); the " · " before it is its own span, so a two-column
      // phone card (mobile-panels.css) drops it and puts the price on a line of its own under "Buy & place"
      const cost = free ? null : h('span.pn-cost', svgIcon(coins ? 'coin' : 'acorn', 18), fmt(coins ? c.price.coins : c.price.acorns));
      const label = free ? t('market.card.place') : tParts('market.card.buyPlace', { n: cost })
        .flatMap((x) => (typeof x === 'string' && / · $/.test(x) ? [x.slice(0, -3), h('span.pn-sep', ' · ')] : [x]));
      return kit.button({ label,
        glyph: free ? 'hammer' : null, cls: c.big && c.code === null && !free ? 'pn-big' : '', gate, data: { place: c.id }, from: !free,
        title: c.big && !free ? t('market.why.bigSpend') : null, onClick: () => startPlacement(ctx, c.id) });
    }
    case 'boost': return kit.button({ from: true, label: t('market.card.buy'), ...lazy(() => I.goldenSeeds()), data: { buy: c.id } });
    case 'tool': return kit.button({ from: true, label: t('market.card.buy'), ...lazy(() => I.buyTool(c.id)), data: { buy: c.id } });
    case 'goods': return kit.button({ from: true, label: t('market.card.buy'), ...lazy(() => I.storeBuy(c.id, c.qty)), data: { buy: c.id } });
    default: return null;
  }
}

function renderAnimals(grid, cards, ctx, kit) {
  const level = levelOf(ctx.store.state);
  for (const home of cards.filter((c) => c.kind === 'home')) {
    grid.append(storeCard(home, ctx, kit, 'animals'));
    for (const sp of home.species) {
      const baby = cards.find((c) => c.kind === 'animal' && c.id === sp && !c.adult);
      const adult = cards.find((c) => c.kind === 'animal' && c.id === sp && c.adult);
      if (!baby || !adult) continue;
      const { art, locked } = cardArt(baby, ctx, level, sp);
      // a full home that cannot grow: said once under both rows, with the way forward (its panel), not under each Buy
      const stuck = baby.blocked || adult.blocked || null;
      const row = (c, label, sub) => h('div.pn-buyrow',
        h('div.pn-buyrow-text', h('b', label), h('small', c.grow ? t('market.animal.includes', { sub, n: c.grow.step }) : sub)),
        price(c.price, { big: c.big && c.code === null }),
        kit.button({ from: true, label: t('market.card.buy'), cls: 'pn-sm', ...lazy(() => I.buyAnimal(sp, c.adult, c.grow?.home ?? c.homes[0])), data: { buy: sp, adult: String(c.adult) },
          quiet: stuck ? ['CAP'] : null,
          gate: () => {
            const f = cardsOf(ctx, 'animals').find((x) => x.id === sp && x.adult === c.adult && x.kind === 'animal');
            return f && f.code ? { code: f.code, hint: f.hint } : null;
          } }));
      const facts = h('div.pn-card-facts', h('span', t('market.facts.every', { d: baby.cycle })), h('span', t('market.facts.gives'), icon(baby.product, { size: 20 })),
        h('span', t('market.facts.eats'), icon(baby.feed, { size: 20 })),
        baby.homes.length ? h('span', t('market.facts.room', { n: baby.room })) : null);
      grid.append(h(`div.pn-card.pn-card-wide${locked ? '.locked' : ''}`, { role: 'listitem', dataset: { def: sp, kind: 'animal' } },
        art, h('h3.pn-card-name', baby.name), baby.stars ? stars(baby.stars) : null, facts,
        locked ? h('div.pn-card-foot', h('span.pn-later', t('market.why.unlockAt', { n: baby.unlock })))
          : [row(baby, t('market.animal.baby'), t('market.animal.growsUp', { d: baby.babyGrow })), row(adult, t('market.animal.adult'), t('market.animal.atOnce')), stuck ? roomNote(stuck, ctx) : null]));
    }
  }
}

/** A full home that cannot grow (wave 4b): what is in the way, and a button to that home's panel, which shows it on the
 *  farm (Show me) and moves the home (Move the …). */
/** The home of a blocked card as a name ref (its def), else the name the card carries. */
const homeRef = (ctx, b) => { const d = ctx.store.state.farm.objects[b.home]?.def; return d ? N(d) : b.name; };
function roomNote(b, ctx) {
  return h('div.pn-card-room', { role: 'note' },
    h('span.pn-card-room-why', t('market.animal.roomNote', { home: homeRef(ctx, b), why: b.why })),
    h('button.pn-chipbtn.pn-room-move', { type: 'button', 'data-sfx': 'own', dataset: { gohome: b.home }, title: t('market.animal.roomOpen', { home: homeRef(ctx, b) }),
      on: { click: () => ctx.open('animals', { id: b.home, focus: 'room' }) } }, t('market.animal.makeRoom')));
}

// ---- Land --------------------------------------------------------------------------------------------------------

function landTab(body, ctx, kit) {
  let selected = null;
  let oursOpen = false;                       // the parcels we own fold under "Ours (3)" (ux-first#17)
  const mapBox = h('div.pn-mapbox');
  const list = h('div.pn-landlist');
  body.append(h('div.pn-store-intro', h('p.pn-intro', TAB_INTRO.land),
    ctx.ui?.panels?.has('landmap') ? h('button.pn-chipbtn', { type: 'button', 'data-sfx': 'own', dataset: { open: 'landmap' },
      on: { click: () => ctx.open('landmap') } }, t('market.land.bigMap')) : null), h('div.pn-land', mapBox, list));
  const update = kit.memo(body, () => [selected, cardsOf(ctx, 'land'), ctx.store.state.farm.wallet.coins], render);
  function render() {
    const st = ctx.store.state;
    const cards = cardsOf(ctx, 'land');
    if (!selected) selected = (cards.find((c) => c.isNext && !c.owned) || cards[0])?.id ?? null;
    mapBox.replaceChildren(landMap(st, cards, { selected, onPick: (id) => { selected = id; update(); list.querySelector(`[data-exp="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }); } }),
      h('div.pn-maplegend', h('span.k.mine', t('market.land.legendOurs')), h('span.k.sale', t('market.land.forSale')), h('span.k.wild', t('market.land.wild'))));
    list.replaceChildren();
    // the parcel for sale first, then the ones still ahead, then ours folded away
    const forSale = cards.filter((c) => !c.owned).sort((a, b) => Number(Boolean(b.isNext)) - Number(Boolean(a.isNext)) || (a.k ?? 0) - (b.k ?? 0));
    const ours = cards.filter((c) => c.owned);
    if (selected && ours.some((c) => c.id === selected)) oursOpen = true;
    for (const c of forSale) list.append(landCard(c, ctx, kit, c.id === selected));
    if (ours.length) {
      const id = 'pn-land-ours';
      list.append(h('button.pn-chipbtn.pn-land-ours', { type: 'button', 'aria-expanded': String(oursOpen), 'aria-controls': id, dataset: { key: 'land-ours' },
        on: { click: () => { oursOpen = !oursOpen; update(true); } } }, t('market.land.oursFold', { n: ours.length }), h('span', { 'aria-hidden': 'true' }, oursOpen ? ' ▴' : ' ▾')));
      const box = h('div.pn-land-ours-list', { id, hidden: !oursOpen });
      if (oursOpen) for (const c of ours) box.append(landCard(c, ctx, kit, c.id === selected));
      list.append(box);
    }
    const next = cards.find((c) => c.isNext && !c.owned);
    if (next) openProof(ctx, next);
    kit.refresh();
  }
  update();
  return { update };
}

/**
 * The proof task of an expansion counts from the moment either player first opens its card (GDD §3.9): showing the
 * next expansion's card sends openExpansion once (silently: a race with the partner is harmless).
 */
const opening = new Set();
export function openProof(ctx, card) {
  if (card.opened || !card.proof.length || opening.has(card.id)) return;
  const it = I.openExpansion(card.id);
  opening.add(card.id);
  ctx.store.act(it.type, it.args);
  setTimeout(() => opening.delete(card.id), 5000);
}

/** One expansion: requirements checklist (level, coins, planks/crates, the proof task) and "Buy the land". */
export function landCard(c, ctx, kit, selected = false) {
  const st = ctx.store.state;
  const level = levelOf(st);
  const row = (ok, text, extra = null) => h(`li.pn-req${ok ? '.ok' : ''}`, h('span.pn-req-mark', { 'aria-hidden': 'true' }, ok ? '✓' : '·'), h('span', text), extra);
  // an owned parcel shows no checklist: its rows are never built (QA2 UI-01)
  const reqs = c.owned ? null : h('ul.pn-reqs',
    row(level >= c.unlock, t('market.land.farmLevel', { n: c.unlock })),
    row(st.farm.wallet.coins >= c.price.coins, t('market.land.coins', { n: c.price.coins })),
    ...c.needs.map((n) => row(n.have >= n.n, t('market.land.need', { q: Q(n.item, n.n) }), chip(n.item, { have: n.have, need: n.n, size: 24 }))),
    // a proof task that names one item ("Harvest 30 Wheat") says where that item comes from, like the chips above
    ...c.proof.map((p) => {
      const li = row(p.have >= p.qty, proofLine(p), h('span.pn-req-n', `${fmt(p.have)}/${fmt(p.qty)}`));
      return p.have < p.qty && typeof p.ref === 'string' ? hintable(li, p.ref) : li;
    }));
  const status = c.owned ? pill(t('market.land.legendOurs'), 'pn-owned') : c.isNext ? pill(t('market.land.forSale'), 'pn-warn') : pill(t('common.level', { n: c.unlock }));
  return h(`article.pn-landcard${selected ? '.sel' : ''}${c.owned ? '.owned' : ''}`, { dataset: { exp: c.id } },
    h('header', h('h3', `${c.k}. ${c.name}`), status),
    h('p.pn-land-reveals', c.reveals),
    landFacts(c),
    reqs,
    c.owned ? null : h('p.pn-land-note', c.proof.length ? (c.opened ? t('market.land.counting') : t('market.land.startsCounting')) : ''),
    c.owned ? null : h('div.pn-card-foot', price(c.price, { big: c.big && c.code === null }),
      kit.button({ label: t('market.land.buy'), glyph: 'hammer', ...lazy(() => I.expand(c.id)), data: { expand: c.id },
        gate: () => {
          const f = cardsOf(ctx, 'land').find((x) => x.id === c.id);
          return f && f.code ? { code: f.code, hint: f.hint } : null;
        } })));
}

/**
 * What a parcel brings (wave 5, fewer and bigger expansions): the plot cap it adds and, for a parcel made of the old
 * small pieces, their names ("Creekside Meadow and Cow Hill"), so the owners recognise their land on the new cards.
 */
export function landFacts(c) {
  const pieces = Array.isArray(c.pieces) && c.pieces.length > 1 && c.pieces[0] !== c.id
    ? list(c.pieces.map((id) => cname(id, { family: 'expansions' }))) : null;
  return h('p.pn-land-facts', icon('plot', { size: 20, alt: '' }),
    h('span', pieces ? t('market.land.factsPieces', { n: c.plots, list: pieces }) : t('market.land.facts', { n: c.plots })));
}

const VERB = { harvest: 'Harvest', collect: 'Collect', make: 'Make', own: 'Own', fill: 'Fill' };
const refName = (ref) => itemOf(ref)?.name ?? defOf(ref)?.name ?? String(ref).replace(/_/g, ' ');
/**
 * One proof task as a line: "Harvest 30 Wheat", "Fill 10 orders", "Make 3 Cotton Totes or Wool Pillows". A ref may be
 * a list of alternatives (Riverbank): every name is said, joined by "or" (QA2 UI-01: an array ref crashed the tab).
 */
export function proofLine(p) {
  const refs = Array.isArray(p.ref) ? p.ref : [p.ref];
  if (lang() !== 'en' && VERB[p.verb]) {
    // Bulgarian counts the first thing ("3 памучни торби") and names the alternatives after it ("или вълнени възглавници")
    const what = refs.map((r, i) => (r === 'order' ? t('market.proof.orders', { n: p.qty })
      : i === 0 ? qtyOf(r, p.qty) : cname(r, { form: p.qty === 1 ? 'lc' : 'pl' })));
    return t(`market.proof.${p.verb}`, { n: p.qty, what: list(what, 'or') });
  }
  const names = refs.map((r) => pluralOf(refName(r), p.qty));
  return `${VERB[p.verb] ?? p.verb} ${fmt(p.qty)} ${names.join(' or ')}`;
}
