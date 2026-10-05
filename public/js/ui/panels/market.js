// The Market (GDD §7.3, §4.10): Mabel's stand to SELL, and the general store to BUY seeds, trees, animals,
// buildings, decor, land, tools and Acorn goods. Opened by the coins pill and M (args { tab }).
// Every price comes from content through model.js; every click goes through the rules (prediction).
import { itemOf, defOf, pluralOf, MARKET, SAFETY } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, price, stars, empty, ribbonTag, pill, chip, hintable } from './kit.js';
import {
  STORE_TABS, storeCards, sellList, demandOf, levelOf, keepOf, placedOf, capOf, priceOf, saleQuote,
} from './model.js';
import { I } from './intents.js';
import { probe, passes } from './core.js';
import { startPlacement } from './placement.js';
import { landMap } from './art.js';
import { shopTags, shopSetsLink } from './decor-sets.js';
import { touchPlayer } from '../dom.js';
import { grandStrip } from './grand-decor.js';
import { relicSig } from './w4b.js';

/** Farm Beauty per piece: whole numbers as they are, halves with one decimal (a Dirt Path is +0.5, not +0). */
const beautyText = (b) => (Number.isInteger(b) ? fmt(b) : b.toFixed(1));

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

export const marketPanel = {
  title: 'Market',
  icon: 'market_stand',
  size: 'full',
  hotkey: 'm',
  dock: { label: 'Market', icon: 'market', order: 2, hint: 'Sell and buy (M)' },
  tabs: () => [{ id: 'sell', label: 'Sell', icon: 'coins' }, ...STORE_TABS],
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
    return {
      tab(id) { tab = id; nextGen(ctx); render(); },
      update(ch) {
        nextGen(ctx);
        if (view && view.update) view.update(ch); else render();
        kit.refresh();
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
  const grid = h('div.pn-stacks', { role: 'listbox', 'aria-label': 'Goods in the barn' });
  const tip = h('p.pn-tip');
  const slip = h('aside.pn-slip', { 'aria-label': 'Sell slip' });
  body.append(h('div.pn-sell', h('div.pn-sell-main', board, grid, tip), slip));

  const defaultQty = (s) => Math.max(1, s.free > 0 ? s.free : s.n);

  function renderBoard() {
    board.replaceChildren();
    if (levelOf(store.state) < MARKET.demand.unlock) return;
    const d = demandOf(store.state, ctx.now());
    // the Market Stand's upgrades (wave 4, wish E: more Demand, better prices) are one tap from here
    const stand = ctx.ui.panels.has?.('upgrades') ? Object.keys(store.state.farm.objects).sort().find((k) => store.state.farm.objects[k].def === 'market_stand') : null;
    const up = stand ? store.state.farm.objects[stand].up ?? 0 : 0;
    board.append(h('div.pn-chalk', { role: 'note' },
      h('div.pn-chalk-title', "Mabel's chalkboard", stand ? h('button.pn-chalk-up', { type: 'button', dataset: { key: 'stand-up' },
        'aria-label': `Market Stand upgrades, ${up} done`, on: { click: () => ctx.open('upgrades', { id: stand }) } }, `Stand upgrades ★${up}`) : null),
      d ? h('div.pn-chalk-body', h('span.pn-chalk-lead', 'Wanted today, +50 %:'),
        ...d.items.map((x) => h(`span.pn-chalk-item${x.left ? '' : '.done'}`, icon(x.id, { size: 28 }), itemOf(x.id)?.name ?? x.id,
          h('small', x.left ? `${fmt(x.left)} left` : 'sold out'))))
        : h('div.pn-chalk-body', 'No Demand posted yet today.')));
  }

  function renderGrid() {
    const list = sellList(store.state, ctx.now());
    grid.replaceChildren();
    if (!list.length) {
      grid.append(empty('Nothing to sell yet. Harvest something and come back!', 'market'));
      selected = null;
    } else {
      if (!selected || !list.some((s) => s.id === selected)) { selected = list[0].id; qty = 0; }
      if (!qty) qty = defaultQty(list.find((s) => s.id === selected));
      for (const s of list) {
        const on = s.id === selected;
        grid.append(h(`button.pn-stack${on ? '.on' : ''}`, {
          type: 'button', role: 'option', 'aria-selected': String(on),
          title: `${s.name}: ${fmt(s.n)} in the barn, ${fmt(s.unit)} coins each`,
          dataset: { item: s.id, key: `stack-${s.id}` },
          on: { click: () => { selected = s.id; qty = defaultQty(s); gridM(); slipM(); } },
        }, icon(s.id, { size: 56, alt: '' }),
        h('span.pn-stack-n', `×${fmt(s.n)}`),
        h('span.pn-stack-name', s.name),
        h('span.pn-stack-price', svgIcon('coin', 16), fmt(s.unit)),
        s.demand ? ribbonTag('+50 %', 'pn-demand') : null,
        s.keep > 0 ? h('span.pn-keep-tag', { title: `Keeping ${s.keep}` }, svgIcon('lock', 14), fmt(s.keep)) : null));
      }
    }
    tip.textContent = list.length <= 6
      ? `Tip: Mabel's orders pay half again what the stand does, and they never expire. ${touchPlayer() ? 'Orders is in the Menu.' : 'Press O to see them.'}`
      : '';
  }

  function renderSlip() {
    slip.replaceChildren();
    const s = sellList(store.state, ctx.now()).find((x) => x.id === selected);
    if (!s) {
      slip.append(h('div.pn-slip-empty', svgIcon('coin', 48), h('p', 'Pick something on the left to sell it.')));
      return;
    }
    qty = Math.max(1, Math.min(qty, s.n));
    const it = itemOf(s.id);
    const keep = keepOf(store.state, s.id);
    const keeper = keep.by && store.state.players[keep.by] ? store.state.players[keep.by].name : null;
    const total = h('b.pn-slip-total');
    const each = h('span.pn-slip-each');
    const note = h('p.pn-slip-note');
    const range = h('input.pn-range', { type: 'range', min: '1', max: String(s.n), value: String(qty),
      'aria-label': `How many ${it.name} to sell`, on: { input: (e) => { qty = Number(e.target.value); quote(); } } });
    const num = h('input.pn-num', { type: 'number', min: '1', max: String(s.n), value: String(qty), inputmode: 'numeric',
      'aria-label': 'Quantity', on: { change: (e) => { qty = Math.max(1, Math.min(s.n, Math.trunc(Number(e.target.value)) || 1)); quote(); } } });
    const quick = h('div.pn-quick');
    const q = (label, n) => h('button.pn-chipbtn', { type: 'button', on: { click: () => { qty = n; quote(); } } }, label);
    quick.append(q('1', 1));
    if (s.n >= 20) quick.append(q('10', 10));
    if (s.n > 3) quick.append(q('Half', Math.max(1, Math.floor(s.n / 2))));
    if (keep.n > 0 && s.free > 0 && s.free < s.n) quick.append(q(`All but ${fmt(keep.n)}`, s.free));
    quick.append(q(`All ${fmt(s.n)}`, s.n));
    const sellBtn = kit.button({ label: `Sell ${fmt(qty)}`, cls: 'pn-sell-btn', glyph: 'coin',
      ...lazy(() => I.sell(s.id, qty)), hint: () => ({ name: keeper }), data: { sell: s.id } });
    slip.append(
      h('div.pn-slip-head', icon(s.id, { size: 88 }), h('div',
        h('h3.pn-slip-title', it.name),
        h('div.pn-slip-have', `${fmt(s.n)} in the barn`, s.over ? h('span.pn-over-tag', ` · ${fmt(s.over)} in overflow`) : null),
        keep.n > 0 ? h('div.pn-slip-keep', svgIcon('lock', 16), keeper && keep.by !== 'sys' ? `${keeper} keeps ${fmt(keep.n)}` : `Keeping ${fmt(keep.n)}`) : null)),
      h('div.pn-slip-qty', range, num), quick,
      h('div.pn-slip-sum', each, total), note, sellBtn);

    function quote() {
      range.value = String(qty);
      num.value = String(qty);
      sellBtn.button.querySelector('.pn-btn-label').textContent = `Sell ${fmt(qty)}`;
      const r = saleQuote(store.state, s.id, qty, ctx.now());
      total.replaceChildren(svgIcon('coin', 26), fmt(r.coins));
      each.textContent = `${fmt(qty)} × ${fmt(s.unit)}${r.demand ? ` (+50 % on ${fmt(r.demand)})` : ''}`;
      const notes = [];
      if (s.unit > s.sell) notes.push(`${fmt(s.unit - s.sell)} more each than the base price (mastery and season).`);
      if (qty > s.free && keep.n > 0) notes.push(`Dips into the ${fmt(keep.n)} kept: you'll be asked first.`);
      note.textContent = notes.join(' ');
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

// ---- Store tabs -------------------------------------------------------------------------------------------------

const TAB_INTRO = {
  seeds: 'Seeds are paid per plot as you plant. Pick a crop here, then drag across the empty plots.',
  trees: 'Trees grow from a sapling for two cycles, then give fruit forever. Four of one kind in a square make a Grove (+1 fruit each).',
  animals: 'Each species lives in its own home. Babies grow up on their own; adults produce at once.',
  buildings: 'Workshops turn crops into goods worth more. Each one is placed anywhere on your land.',
  decor: 'Decor makes the farm yours. Some pieces help too: scarecrows, bird baths and the Sunset Bench.',
  land: 'Each expansion adds six plots to the cap and a new corner to explore.',
  tools: 'Bigger brushes do more per stroke. Feed from the store costs far more than the Feed Mill makes it for.',
  acorn: 'Acorns are rare: earned from levels, ribbons and golden orders. Spend them on something special.',
};

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
      levelOf(st) >= SAFETY.wishlist.unlock ? h('button.pn-chipbtn.pn-wishlink', { type: 'button', on: { click: () => ctx.open('wishlist') } },
        '♥ Wishlist', wishes ? h('b', ` ${wishes}`) : null) : null));
    if (tab === 'seeds') head.append(plotStrip(ctx, kit));
    // decor sets and Masterwork (ui-collect): the set view from the decor tabs
    if (tab === 'decor' || tab === 'acorn') { const link = shopSetsLink(ctx, levelOf(st)); if (link) head.firstChild.append(link); }
    // the Grand decor showroom (ui-home, M2): the ten `tier: 'grand'` pieces are in no other Market tab
    if (tab === 'decor') { const g = grandStrip(ctx); if (g) head.append(g); }
    // the treasures (wave 4b, owner wish 2): unique, for good, worth weeks of Acorns
    if (tab === 'acorn') head.append(relicSlot(ctx, kit));
    grid.replaceChildren();
    const cards = cardsOf(ctx, tab);
    if (!cards.length) grid.append(empty('Nothing here yet.'));
    if (tab === 'animals') renderAnimals(grid, cards, ctx, kit);
    else for (const c of cards) grid.append(storeCard(c, ctx, kit, tab));
    kit.refresh();
  }
  update();
  focusCard(body, ctx);              // the whole tab: a treasure card (wave 4b) sits in the head
  return { update };
}

/** The treasures' section, its module loaded with the Acorn tab's first look (the boot never carries it). */
let relicMod = null;
function relicSlot(ctx, kit) {
  const slot = h('div.pn-relics-slot');
  const fill = (m) => { slot.replaceChildren(m.relicSection(ctx, kit).el); kit.refresh(); };
  if (relicMod) fill(relicMod);
  else {
    import('./relic-shop.js').then((m) => {
      relicMod = m;
      if (!slot.isConnected) return;
      fill(m);
      // a "Show me" on a treasure (the Goal Tracker) waited for its card
      const want = ctx.args && ctx.args.focus;
      const card = want ? slot.querySelector(`[data-def="${CSS.escape(String(want))}"]`) : null;
      if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('pn-focus-ring'); setTimeout(() => card.classList.remove('pn-focus-ring'), 2000); }
    }).catch((err) => console.error('the treasures did not load', err));
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
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    h('div.pn-plotstrip-text', h('b', `${fmt(owned)} of ${fmt(cap)} plots`),
      h('span', full ? 'The cap grows with every level and every piece of land.' : `${fmt(cap - owned)} more can be placed.`)),
    price({ coins: priceOf(st, 'plot').coins }),
    kit.button({ label: 'Place a plot', glyph: 'hammer', cls: 'btn--sky', data: { place: 'plot' },
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
      h('span.pn-fact-line', { title: 'What one plot costs to plant, and how long it grows' },
        h('b', 'Plant'), svgIcon('coin', 14), fmt(c.price.coins), h('span.pn-dot-sep', '·'), `grows ${c.grow}`),
      h('span.pn-fact-line', { title: 'What one plot gives: units × the price each sells for, and the XP' },
        h('b', 'Harvest'), `${fmt(c.yield)} ×`, svgIcon('coin', 14), fmt(c.sell), h('span.pn-dot-sep', '·'), h('span.pn-xp', `${fmt(c.xp)} XP`))];
    case 'trees': return [h('span', `Every ${c.cycle}`), h('span', `${fmt(c.yield)} × `, icon(c.product, { size: 18 })),
      c.cap !== null ? h('span', { title: 'Owned / allowed now' }, `${fmt(c.owned)} of ${fmt(c.cap)}`) : null];
    case 'buildings': {
      const b = defOf(c.id);
      return [h('span', `${c.size[0]}×${c.size[1]} tiles`),
        b && b.collector ? h('span', `fills with Compost as you tend animals`)
          : [h('span', `${fmt(c.slots[0])} slot${c.slots[0] === 1 ? '' : 's'}`), h('span', `${fmt(c.recipes)} recipe${c.recipes === 1 ? '' : 's'}`)]];
    }
    case 'animals': return c.kind === 'home'
      ? [h('span', `Holds ${fmt(c.capacity ?? 0)}${c.capacityMax ? `, up to ${fmt(c.capacityMax)}` : ''}`),
        c.species && c.species.length ? h('span', 'for ', ...c.species.map((sp) => icon(sp, { size: 20, alt: defOf(sp)?.name ?? sp }))) : null,
        c.size ? h('span', `${c.size[0]}×${c.size[1]} tiles`) : null]
      : [];
    case 'decor': return [c.size ? h('span', `${c.size[0]}×${c.size[1]}`) : null,
      c.beauty ? h('span', `+${beautyText(c.beauty)} beauty`) : null];
    case 'tools': return [c.brush ? h('span', `${c.brush[0]}×${c.brush[1]} brush`) : null,
      c.kind === 'goods' ? h('span', `${fmt(c.owned)} in the barn`) : null];
    case 'acorn': return c.kind === 'boost' ? [h('span', `${fmt(c.owned)} golden seed${c.owned === 1 ? '' : 's'} waiting`)]
      : [c.size ? h('span', `${c.size[0]}×${c.size[1]}`) : null, c.beauty ? h('span', `+${beautyText(c.beauty)} beauty`) : null];
    default: return [];
  }
}

function cardArt(c, ctx, level, iconId = c.icon) {
  const locked = c.code === 'LOCKED' && c.hint && c.hint.unlock > level;
  const art = h('div.pn-card-art', icon(iconId, { size: 72, alt: '' }));
  if (locked) art.append(h('span.pn-lock', svgIcon('lock', 18), `Level ${c.unlock}`));
  else if (c.isNew) art.append(ribbonTag('New!', 'pn-new'));
  if (!locked && c.tray > 0) art.append(ribbonTag(c.tray > 1 ? `${c.tray} in your tray` : 'In your tray', 'pn-free-tag'));
  else if (!locked && c.inSeason) art.append(ribbonTag('In season', 'pn-season'));
  if (!locked && c.packets > 0) art.append(ribbonTag(`${c.packets} free`, 'pn-free-tag'));
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
  return h('button.pn-wishbtn', { type: 'button', 'aria-pressed': String(wished), title: wished ? 'On the Wishlist' : 'Save up for it on the Wishlist',
    'aria-label': `Wish for ${c.name}`, dataset: { wish: c.id },
    on: { click: (e) => { e.stopPropagation(); if (wished) { ctx.open('wishlist'); return; } const r = ctx.act(it.type, it.args); if (r && r.ok) ctx.ui.toast(`${c.name} is on the Wishlist ♡`); } } },
  wished ? '♥' : '♡');
}

function storeCard(c, ctx, kit, tab) {
  const st = ctx.store.state;
  const level = levelOf(st);
  const { art, locked } = cardArt(c, ctx, level);
  const foot = h('div.pn-card-foot');
  const placedAll = c.code === 'CAP' && ['building', 'home'].includes(c.kind);
  if (locked) foot.append(h('span.pn-later', `Unlocks at level ${c.unlock}`));
  else if (c.kind === 'tool' && c.owned) foot.append(pill('Owned', 'pn-owned'));
  else if (placedAll) {
    const to = panelFor(st, c.id);
    foot.append(pill('On the farm', 'pn-owned'), to ? h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open(to.name, to.args) } }, 'Open') : null);
  } else if (c.code === 'CAP') foot.append(h('span.pn-later', c.cap ? `${fmt(c.owned)} of ${fmt(c.cap)}: the most for now` : 'The most for now'));
  else {
    // a seed card names its price in the "Plant" line already: the foot holds only the button
    if (c.kind !== 'seed') foot.append(c.tray > 0 ? h('span.pn-cost.pn-free', 'Free') : price(c.price, { big: c.big && c.code === null }));
    const a = actionFor(c, ctx, kit, tab);
    if (a) foot.append(a);
  }
  if (!locked) { const w = wishButton(c, ctx); if (w) art.append(w); }
  return h(`article.pn-card${locked ? '.locked' : ''}${placedAll ? '.owned' : ''}`, { role: 'listitem', dataset: { def: c.id, kind: c.kind } },
    art, h('h4.pn-card-name', c.name), c.stars ? stars(c.stars) : null,
    h('div.pn-card-facts', facts(c, tab)), (tab === 'decor' || tab === 'acorn') && !locked ? shopTags(c.id, level) : null,
    c.text && !locked ? h('p.pn-card-text', c.text) : null, foot);
}

/** The card's button; its gate re-reads the model so it stays right while the panel is open. */
function actionFor(c, ctx, kit, tab) {
  const gate = () => {
    const fresh = cardsOf(ctx, tab).find((x) => x.id === c.id && x.adult === c.adult) || c;
    return { code: fresh.code, hint: fresh.hint };
  };
  switch (c.kind) {
    case 'seed':
      return kit.button({ label: 'Plant', glyph: 'sprout', gate, data: { seed: c.id },
        onClick: () => { ctx.controller.setTool('seed', { crop: c.id }); ctx.close(); } });
    case 'tree': case 'home': case 'building': case 'decor':
      return kit.button({ label: c.tray > 0 ? 'Place' : c.kind === 'decor' ? 'Place' : 'Buy', glyph: 'hammer', gate,
        data: { place: c.id }, onClick: () => startPlacement(ctx, c.id) });
    case 'boost': return kit.button({ label: 'Buy', ...lazy(() => I.goldenSeeds()), data: { buy: c.id } });
    case 'tool': return kit.button({ label: 'Buy', ...lazy(() => I.buyTool(c.id)), data: { buy: c.id } });
    case 'goods': return kit.button({ label: 'Buy', ...lazy(() => I.storeBuy(c.id, c.qty)), data: { buy: c.id } });
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
        h('div.pn-buyrow-text', h('b', label), h('small', c.grow ? `${sub} · includes ${fmt(c.grow.step)} to make room` : sub)),
        price(c.price, { big: c.big && c.code === null }),
        kit.button({ label: 'Buy', cls: 'pn-sm', ...lazy(() => I.buyAnimal(sp, c.adult, c.grow?.home ?? c.homes[0])), data: { buy: sp, adult: String(c.adult) },
          quiet: stuck ? ['CAP'] : null,
          gate: () => {
            const f = cardsOf(ctx, 'animals').find((x) => x.id === sp && x.adult === c.adult && x.kind === 'animal');
            return f && f.code ? { code: f.code, hint: f.hint } : null;
          } }));
      const facts = h('div.pn-card-facts', h('span', `Every ${baby.cycle}`), h('span', 'gives ', icon(baby.product, { size: 20 })),
        h('span', 'eats ', icon(baby.feed, { size: 20 })),
        baby.homes.length ? h('span', `${fmt(baby.room)} room left`) : null);
      grid.append(h(`article.pn-card.pn-card-wide${locked ? '.locked' : ''}`, { role: 'listitem', dataset: { def: sp, kind: 'animal' } },
        art, h('h4.pn-card-name', baby.name), baby.stars ? stars(baby.stars) : null, facts,
        locked ? h('div.pn-card-foot', h('span.pn-later', `Unlocks at level ${baby.unlock}`))
          : [row(baby, 'Baby', `grows up in ${baby.babyGrow}`), row(adult, 'Adult', 'produces at once'), stuck ? roomNote(stuck, ctx) : null]));
    }
  }
}

/** A full home that cannot grow (wave 4b): what is in the way, and a button to that home's panel, which shows it on the
 *  farm (Show me) and moves the home (Move the …). */
function roomNote(b, ctx) {
  return h('div.pn-card-room', { role: 'note' },
    h('span.pn-card-room-why', `The ${b.name} is full and has no room to grow: ${b.why}.`),
    h('button.pn-chipbtn.pn-room-move', { type: 'button', dataset: { gohome: b.home }, title: `Open the ${b.name}: see what is in the way, or move it`,
      on: { click: () => ctx.open('animals', { id: b.home, focus: 'room' }) } }, 'Make room'));
}

// ---- Land --------------------------------------------------------------------------------------------------------

function landTab(body, ctx, kit) {
  let selected = null;
  const mapBox = h('div.pn-mapbox');
  const list = h('div.pn-landlist');
  body.append(h('div.pn-store-intro', h('p.pn-intro', TAB_INTRO.land),
    ctx.ui?.panels?.has('landmap') ? h('button.pn-chipbtn', { type: 'button', dataset: { open: 'landmap' },
      on: { click: () => ctx.open('landmap') } }, 'The big farm map') : null), h('div.pn-land', mapBox, list));
  const update = kit.memo(body, () => [selected, cardsOf(ctx, 'land'), ctx.store.state.farm.wallet.coins], render);
  function render() {
    const st = ctx.store.state;
    const cards = cardsOf(ctx, 'land');
    if (!selected) selected = (cards.find((c) => c.isNext && !c.owned) || cards[0])?.id ?? null;
    mapBox.replaceChildren(landMap(st, cards, { selected, onPick: (id) => { selected = id; update(); list.querySelector(`[data-exp="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }),
      h('div.pn-maplegend', h('span.k.mine', 'Ours'), h('span.k.sale', 'For sale'), h('span.k.wild', 'Wild land')));
    list.replaceChildren();
    for (const c of cards) list.append(landCard(c, ctx, kit, c.id === selected));
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
    row(level >= c.unlock, `Farm level ${c.unlock}`),
    row(st.farm.wallet.coins >= c.price.coins, `${fmt(c.price.coins)} coins`),
    ...c.needs.map((n) => row(n.have >= n.n, `${fmt(n.n)} ${itemOf(n.item)?.name ?? n.item}`, chip(n.item, { have: n.have, need: n.n, size: 24 }))),
    // a proof task that names one item ("Harvest 30 Wheat") says where that item comes from, like the chips above
    ...c.proof.map((p) => {
      const li = row(p.have >= p.qty, proofLine(p), h('span.pn-req-n', `${fmt(p.have)}/${fmt(p.qty)}`));
      return p.have < p.qty && typeof p.ref === 'string' ? hintable(li, p.ref) : li;
    }));
  const status = c.owned ? pill('Ours', 'pn-owned') : c.isNext ? pill('For sale', 'pn-warn') : pill(`Level ${c.unlock}`);
  return h(`article.pn-landcard${selected ? '.sel' : ''}${c.owned ? '.owned' : ''}`, { dataset: { exp: c.id } },
    h('header', h('h4', `${c.k}. ${c.name}`), status),
    h('p.pn-land-reveals', c.reveals),
    reqs,
    c.owned ? null : h('p.pn-land-note', c.proof.length ? (c.opened ? 'The task counts everything you did since this card was first opened.' : 'The task starts counting the moment one of you opens this card.') : ''),
    c.owned ? null : h('div.pn-card-foot', price(c.price, { big: c.big && c.code === null }),
      kit.button({ label: 'Buy the land', glyph: 'hammer', ...lazy(() => I.expand(c.id)), data: { expand: c.id },
        gate: () => {
          const f = cardsOf(ctx, 'land').find((x) => x.id === c.id);
          return f && f.code ? { code: f.code, hint: f.hint } : null;
        } })));
}

const VERB = { harvest: 'Harvest', collect: 'Collect', make: 'Make', own: 'Own', fill: 'Fill' };
const refName = (ref) => itemOf(ref)?.name ?? defOf(ref)?.name ?? String(ref).replace(/_/g, ' ');
/**
 * One proof task as a line: "Harvest 30 Wheat", "Fill 10 orders", "Make 3 Cotton Totes or Wool Pillows". A ref may be
 * a list of alternatives (Riverbank): every name is said, joined by "or" (QA2 UI-01: an array ref crashed the tab).
 */
export function proofLine(p) {
  const refs = Array.isArray(p.ref) ? p.ref : [p.ref];
  const names = refs.map((r) => pluralOf(refName(r), p.qty));
  return `${VERB[p.verb] ?? p.verb} ${fmt(p.qty)} ${names.join(' or ')}`;
}
