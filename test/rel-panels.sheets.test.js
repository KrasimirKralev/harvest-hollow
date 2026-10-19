// Release 1.0, ui-panels lane: every sheet opens on the thing to press (release-scope P1-P5, M16, M18, P8, S9b;
// docs/qa/release/ux-phone.md #7-#9, #15, #16, #19; ux-first.md #13, #17, #21; astra.md #4, #6, #7, #10;
// perf-a11y.md #8, #9, #13; feel.md #1, #15). The DOM half of each finding; the phone layout (CSS) is proven by the
// screenshots and tools/i18n-shots.mjs. Each test names its finding.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { storyFarm, act as ruleAct, HOUR } from './helpers/ui-panels.js';
import { T0 } from './helpers.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const { ordersPanel, boardOrder, SKIP_UNDO_MS } = await import('../public/js/ui/panels/orders.js');

/** A panel ctx on a real state: acts and toasts are recorded, nothing is sent anywhere. */
function ctxOf(state, { pid = 'p1', now = T0, args = {}, has = () => true } = {}) {
  const acts = [];
  const toasts = [];
  const opened = [];
  const body = document.createElement('div');
  document.body.append(body);
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name: 'x', args, store, body, el: body, now: () => now, tab: null,
    ui: { panels: { open: () => true, has, retitle() {}, badge() {} }, toast: (t, o) => toasts.push([t, o]) },
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    open(n, a) { opened.push([n, a]); }, close() {}, setTitle() {}, refreshTabs() {},
    controller: { input: 'mouse', setTool() {}, do: (t, a) => { acts.push([t, a]); return { ok: true }; } },
  };
  return { ctx, body, acts, toasts, opened, store };
}

/** A level-9 evening farm with Mabel's board full; `players` decides whether the partner surfaces show. */
function boardFarm(players = ['p1', 'p2']) {
  const { state } = storyFarm({ now: T0, level: 9, players });
  const slots = state.farm.orders.slots;
  // make exactly the LAST open order deliverable, so "deliverable first" has to move it
  const open = Object.keys(slots).map(Number).sort((a, b) => a - b).filter((i) => slots[i].order);
  assert.ok(open.length >= 3, 'the story farm has orders on the board');
  for (const i of open) for (const item of Object.keys(slots[i].order.items)) state.farm.inventory[item] = 0;
  const last = open.at(-1);
  for (const [item, q] of Object.entries(slots[last].order.items)) state.farm.inventory[item] = q + 1;
  return { state, last, open };
}

// ---- P1: Orders as rows -----------------------------------------------------------------------------------------

test('P1: deliverable orders come first, then the others, then the slots waiting for a new order', () => {
  const { state, last } = boardFarm();
  const order = boardOrder(state);
  const ready = (s) => s.order && Object.entries(s.order.items).every(([item, q]) => (state.farm.inventory[item] ?? 0) >= q);
  assert.ok(ready(order[0]), 'a deliverable order leads');
  assert.ok(order.findIndex((s) => s.i === last) < order.findIndex((s) => s.order && !ready(s)), 'the last slot jumped the queue');
  const kinds = order.map((s) => (!s.order ? 2 : ready(s) ? 0 : 1));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));
  const { ctx, body } = ctxOf(state);
  ordersPanel.mount(body, ctx);
  const rows = body.querySelectorAll('.pn-board .pn-order[data-slot]');
  assert.equal(rows[0].dataset.slot, String(order[0].i));
  assert.ok(rows[0].classList.contains('ready'));
});

test('P1 / perf-a11y#13: rows are list items, never <article role=listitem>; the board is the list', () => {
  const { state } = boardFarm();
  const { ctx, body } = ctxOf(state);
  ordersPanel.mount(body, ctx);
  assert.equal(body.querySelectorAll('article').length, 0);
  assert.equal(body.querySelector('.pn-board').getAttribute('role'), 'list');
  const rows = body.querySelectorAll('.pn-board .pn-order');
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.equal(r.getAttribute('role'), 'listitem');
});

test('P1 / ux-first#21: skip and the co-op flags hide behind one "⋯"; the flags only once a second farmer is claimed', () => {
  const solo = boardFarm(['p1']);
  const a = ctxOf(solo.state);
  ordersPanel.mount(a.body, a.ctx);
  assert.equal(a.body.querySelectorAll('.pn-tag-btn').length, 0, 'a solo farm shows no "I\'m on it" / "Need help"');
  const soloRow = a.body.querySelector('.pn-order[data-slot]');
  assert.equal(soloRow.querySelector('.pn-order-moreBtn').getAttribute('aria-label'), 'Skip this order');
  assert.ok(soloRow.querySelector('.pn-order-coop').hasAttribute('hidden'));
  assert.equal(soloRow.querySelectorAll('.pn-order-coop .pn-order-skip').length, 1, 'the solo tray holds Skip');
  const pair = boardFarm(['p1', 'p2']);
  const b = ctxOf(pair.state);
  ordersPanel.mount(b.body, b.ctx);
  const row = b.body.querySelector('.pn-order[data-slot]');
  const more = row.querySelector('.pn-order-moreBtn');
  assert.ok(more, 'a "⋯" on every order with a partner');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.ok(row.querySelector('.pn-order-coop').hasAttribute('hidden'), 'the flags start folded away');
  more.click();
  const again = b.body.querySelector(`.pn-order[data-slot="${row.dataset.slot}"]`);
  assert.equal(again.querySelector('.pn-order-moreBtn').getAttribute('aria-expanded'), 'true');
  assert.ok(!again.querySelector('.pn-order-coop').hasAttribute('hidden'));
  assert.equal(again.querySelectorAll('.pn-order-coop .pn-tag-btn').length, 2);
});

test('P1 / astra#7: "↻ Skip" is a chip (not a ×), the order leaves at once, and Undo within 10 s sends nothing', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { state, open } = boardFarm();
    const { ctx, body, acts, toasts } = ctxOf(state);
    ordersPanel.mount(body, ctx);
    const slot = String(open[0]);
    body.querySelector(`.pn-order[data-slot="${slot}"] .pn-order-moreBtn`).click();
    const chipEl = body.querySelector(`.pn-order[data-slot="${slot}"] .pn-order-skip`);
    assert.ok(!chipEl.parentNode.hasAttribute('hidden'), '"⋯" opened the tray');
    assert.ok(chipEl && chipEl.classList.contains('pn-chipbtn'));
    assert.equal(textOf(chipEl), '↻ Skip');
    assert.equal(body.querySelectorAll('.pn-order .pn-skip').length, 0, 'the old × is gone');
    chipEl.click();
    assert.equal(body.querySelector(`.pn-order[data-slot="${slot}"]`), null, 'the row leaves the board at once');
    assert.equal(acts.length, 0, 'nothing is sent while the Undo stands');
    const [text, opts] = toasts.at(-1);
    assert.match(text, /^Order skipped: a new one comes in 15m$/);
    assert.equal(opts.ms, SKIP_UNDO_MS);
    assert.equal(SKIP_UNDO_MS, 10_000);
    opts.action.fn();                                   // Undo
    assert.ok(body.querySelector(`.pn-order[data-slot="${slot}"]`), 'Undo brings the row back');
    mock.timers.tick(SKIP_UNDO_MS + 10);
    assert.equal(acts.length, 0, 'an undone skip is never sent');
    // skip again and let the window pass: the discard goes out once, with the order's number
    body.querySelector(`.pn-order[data-slot="${slot}"] .pn-order-skip`).click();
    mock.timers.tick(SKIP_UNDO_MS - 1);
    assert.equal(acts.length, 0);
    mock.timers.tick(2);
    assert.equal(acts.length, 1);
    assert.equal(acts[0][0], 'orderDiscard');
    assert.equal(acts[0][1].slot, Number(slot));
  } finally {
    mock.timers.reset();
  }
});

test('P1 / feel#1: Deliver says where the reward starts (hh:act-from with the button, before the act)', () => {
  const { state, last } = boardFarm();
  const events = [];
  const saved = { window: globalThis.window, CustomEvent: globalThis.CustomEvent };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; }, addEventListener() {} };
  try {
    const { ctx, body, acts } = ctxOf(state);
    ordersPanel.mount(body, ctx);
    const btn = body.querySelector(`[data-fill="${last}"]`);
    btn.click();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'hh:act-from');
    assert.equal(events[0].detail.from, btn);
    assert.equal(events[0].detail.type, 'orderFill');
    assert.equal(acts.at(-1)[0], 'orderFill');
  } finally {
    globalThis.window = saved.window;
    globalThis.CustomEvent = saved.CustomEvent;
  }
});

test('P1: Mabel\'s rule is said on the first visit only, then lives in her tooltip', () => {
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    const { state } = boardFarm();
    const a = ctxOf(state);
    ordersPanel.mount(a.body, a.ctx);
    assert.match(textOf(a.body.querySelector('.pn-speech')), /Orders pay more than the stand, in coins and XP/);
    const b = ctxOf(state);
    ordersPanel.mount(b.body, b.ctx);
    assert.doesNotMatch(textOf(b.body.querySelector('.pn-speech')), /Orders pay/, 'the second visit: one line');
    assert.match(b.body.querySelector('.pn-mabel').getAttribute('title'), /Orders pay more than the stand, in coins and XP/);
  } finally {
    globalThis.localStorage = saved;
  }
});

// ---- M18 / P2: the Market slip adds up; the Fair past its target ---------------------------------------------

test('M18 / astra#4: the slip shows "39 × 1,003 =" and the total that follows, "669 + 50% wanted today" under it', async () => {
  const { marketPanel, receipt } = await import('../public/js/ui/panels/market.js');
  const { demandOf } = await import('../public/js/ui/panels/model.js');
  const { state } = storyFarm({ now: T0, level: 12, players: ['p1', 'p2'] });
  const d = demandOf(state, T0);
  assert.ok(d && d.items.length, 'a level-12 farm has a Demand board');
  const want = d.items.find((x) => x.left >= 5);
  assert.ok(want, 'something is still wanted today');
  const qty = Math.min(want.left, 39);
  for (const k of Object.keys(state.farm.inventory)) if (k !== want.id) state.farm.inventory[k] = 0;
  state.farm.inventory[want.id] = qty;
  state.farm.keep = {};
  const { ctx, body } = ctxOf(state, { args: { item: want.id } });
  ctx.tab = 'sell';
  marketPanel.mount(body, ctx);
  const each = textOf(body.querySelector('.pn-slip-each'));
  const total = textOf(body.querySelector('.pn-slip-total'));
  const m = /^([\d,]+) × ([\d,]+) =$/.exec(each);
  assert.ok(m, `one product, then "=": ${each}`);
  const n = (x) => Number(x.replace(/,/g, ''));
  assert.equal(n(m[1]), qty);
  assert.equal(n(m[1]) * n(m[2]), n(total), `${each} ${total} adds up`);
  const wanted = textOf(body.querySelector('.pn-slip-wanted'));
  const w = /^([\d,]+) \+ 50% wanted today$/.exec(wanted);
  assert.ok(w, wanted);
  assert.equal(n(m[2]), Math.floor((n(w[1]) * 15_000) / 10_000), 'the Demand price is the stand price + 50%, floored');
  assert.equal(body.querySelector('aside'), null, 'perf-a11y#13: the slip is a section, not a complementary landmark');
  assert.ok(body.querySelector('section.pn-slip'));
  assert.doesNotMatch(textOf(body.querySelector('.pn-slip')), /more each than the base price/, 'that line moved to the tile tooltip');
  // the mixed case and no Demand, as words
  assert.equal(receipt(50, { demand: 39, unit: 669, bonusUnit: 1003 }), '39 × 1,003 + 11 × 669 =');
  assert.equal(receipt(12, { demand: 0, unit: 669, bonusUnit: 1003 }), '12 × 669 =');
  // ux-phone#7 landscape: the "All" chip is named, so a phone on its side keeps it and drops 1 / 10 / Half
  const chips = [...body.querySelectorAll('.pn-slip .pn-quick .pn-chipbtn')];
  assert.ok(chips.at(-1).classList.contains('pn-q-all'), 'the last quick chip is "All"');
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../public/css/mobile-panels.css', import.meta.url), 'utf8');
  const land = css.slice(css.indexOf('@media (max-height: 500px) and (min-width: 601px)'));
  assert.match(land, /\.pn-quick \.pn-chipbtn:not\(\.pn-q-all, \.pn-q-allbut\) \{ display: none; \}/);
  assert.match(land, /\.pn-sell-main > \.pn-chalk-wrap \{ order: 2;/, 'the goods come first on a phone on its side');
});

test('P8 / feel#15: with nothing to sell the slip says where goods come from, not "pick something on the left"', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { state } = storyFarm({ now: T0, level: 12, players: ['p1'] });
  for (const k of Object.keys(state.farm.inventory)) state.farm.inventory[k] = 0;
  const { ctx, body } = ctxOf(state);
  ctx.tab = 'sell';
  marketPanel.mount(body, ctx);
  assert.equal(textOf(body.querySelector('.pn-slip')), 'Harvested goods show up here.');
});

test('M18 / astra#10: past the week\'s target the Fair line drops "of W", and scores of 100+ are whole', async () => {
  const { forceLiveForTests } = await import('../shared/rules/coop.js');
  const { FAIR } = await import('../shared/content/index.js');
  const { farmAt } = await import('./helpers/rules.js');
  const { must, sys } = await import('./helpers.js');
  const { weeklyLines } = await import('../public/js/ui/panels/town.js');
  const { fmtPts, ptsOfText } = await import('../public/js/ui/panels/fair.js');
  forceLiveForTests([FAIR]);
  const s = farmAt(22);
  must(s, 'claimGift', {}, { pid: 'p1' });
  sys(s, '_fair', {});
  const W = s.farm.fair.cur.W;
  s.farm.fair.cur.p = W * 10 * 2 + 6;                 // 2W + 0.6: past the target, with a tenth
  const line = weeklyLines(s, 'p1', T0).find((l) => l.panel === 'fair').text;
  assert.doesNotMatch(line, / of [\d,]+ points/, line);
  assert.match(line, new RegExp(`^County Fair: ${(2 * W + 1).toLocaleString('en-US')} points[,.]`), line);
  assert.equal(fmtPts(5486), '549');
  assert.equal(fmtPts(992), '99.2');
  assert.equal(ptsOfText(1500, 1900), '150 of 190 points');
  assert.equal(ptsOfText(5486, 1900), '549 points');
});

// ---- P3: workshop sheets open on Make -----------------------------------------------------------------------------

test('P3 / ux-phone#9: an empty queue is one "Queue 0/N" strip, not N boxes that say "empty"', async () => {
  const { buildingPanel } = await import('../public/js/ui/panels/building.js');
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  assert.ok(ids.kitchen, 'the story farm has an idle Kitchen');
  assert.equal((state.farm.objects[ids.kitchen].queue ?? []).length, 0);
  const { ctx, body } = ctxOf(state, { args: { id: ids.kitchen } });
  buildingPanel.mount(body, ctx);
  assert.equal(body.querySelectorAll('.pn-slot.empty').length, 0);
  const strip = body.querySelector('.pn-slot-strip');
  assert.ok(strip);
  assert.match(textOf(strip), /^\+ ?Queue 0\/\d+$/);
  // a busy workshop still shows its queue
  const b = ctxOf(state, { args: { id: ids.bakery } });
  buildingPanel.mount(b.body, b.ctx);
  assert.equal(b.body.querySelector('.pn-slot-strip'), null);
  assert.ok(b.body.querySelectorAll('.pn-slot.done, .pn-slot.running').length >= 1);
});

test('P3 / astra#6: the workshop rule is said on the first visit, then waits behind an ⓘ', async () => {
  const { buildingPanel } = await import('../public/js/ui/panels/building.js');
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
    const a = ctxOf(state, { args: { id: ids.kitchen } });
    buildingPanel.mount(a.body, a.ctx);
    assert.match(textOf(a.body.querySelector('.pn-bhead-sub')), /^Ingredients leave the Barn when you start/);
    const b = ctxOf(state, { args: { id: ids.kitchen } });
    buildingPanel.mount(b.body, b.ctx);
    assert.equal(b.body.querySelector('.pn-bhead-sub'), null, 'the second visit: no paragraph');
    const info = b.body.querySelector('.pn-info');
    assert.ok(info && info.classList.contains('pn-chipbtn'));
    assert.equal(info.getAttribute('aria-expanded'), 'false');
    assert.match(info.getAttribute('title'), /^Ingredients leave the Barn/);
    info.click();
    assert.ok(b.body.querySelector('.pn-bhead-sub'), 'the ⓘ brings it back');
  } finally {
    globalThis.localStorage = saved;
  }
});

test('P3 / astra#6: inputs read "1 Flour · 2 Eggs", a red "need 1 more" only when short; "New recipe" ribbon', async () => {
  const { buildingPanel, inputChip } = await import('../public/js/ui/panels/building.js');
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const { ctx, body } = ctxOf(state, { args: { id: ids.bakery } });
  buildingPanel.mount(body, ctx);
  const ins = body.querySelectorAll('.pn-recipe .pn-ins');
  assert.ok(ins.length >= 2);
  for (const el of ins) assert.doesNotMatch(textOf(el), /\d+\/\d+/, `no have/need fraction: ${textOf(el)}`);
  assert.equal(textOf(inputChip('flour', 1, 4)), '1 Flour');
  assert.equal(textOf(inputChip('egg', 2, 1)), '2 Eggs need 1 more');
  assert.ok(inputChip('egg', 2, 1).classList.contains('short'));
  assert.equal(inputChip('egg', 2, 1).getAttribute('title'), 'Egg: 1 in the barn, 2 needed');
  assert.equal(body.querySelectorAll('article').length, 0, 'recipes are list items, not <article role=listitem>');
  const tries = body.querySelectorAll('.pn-recipe .pn-ribbon.pn-try');
  for (const r of tries) assert.equal(textOf(r), 'New recipe');
});

// ---- P5: choices that make sense ----------------------------------------------------------------------------------

test('P5 / ux-first#17: a Market tab shows once something in it is live; a tab asked for by name shows anyway', async () => {
  const { marketPanel, tabLive } = await import('../public/js/ui/panels/market.js');
  const { farmAt } = await import('./helpers/rules.js');
  const fresh = farmAt(1);
  const ids = marketPanel.tabs({}, fresh).map((x) => x.id);
  assert.ok(ids.includes('sell') && ids.includes('seeds'));
  assert.ok(ids.length < 9, `fewer than nine tabs at level 1: ${ids.join(' ')}`);
  for (const id of ids) assert.ok(tabLive(fresh, id), id);
  assert.ok(marketPanel.tabs({ tab: 'acorn' }, fresh).some((x) => x.id === 'acorn'), 'asked for by name: it shows');
  const late = farmAt(30);
  assert.equal(marketPanel.tabs({}, late).length, 9, 'a late farm has every tab');
});

test('P5 / ux-first#17: the Journal shows a tab once something in it is live (no Mastery before its level)', async () => {
  const { journalPanel, journalTabLive } = await import('../public/js/ui/panels/journal.js');
  const { farmAt } = await import('./helpers/rules.js');
  const { MASTERY } = await import('../shared/content/index.js');
  const young = farmAt(3);
  const ids = journalPanel.tabs({}, young).map((x) => x.id);
  assert.ok(ids.includes('story') && ids.includes('week'));
  assert.ok(!ids.includes('mastery'), `no mastery tab at L3: ${ids.join(' ')}`);
  assert.equal(journalTabLive(farmAt(MASTERY.unlock), 'mastery'), true);
  assert.ok(journalPanel.tabs({ tab: 'mastery' }, young).some((x) => x.id === 'mastery'), 'asked for by name: it shows');
});

test('P5: a level-up while the Market is open brings its new tabs (update gets the registry\'s Set of topics)', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { farmAt } = await import('./helpers/rules.js');
  const { xpForLevel } = await import('../shared/content/index.js');
  const s = farmAt(1);
  const { ctx, body } = ctxOf(s);
  let refreshed = 0;
  ctx.refreshTabs = () => { refreshed++; };
  ctx.tab = 'sell';
  const inst = marketPanel.mount(body, ctx);
  s.farm.xp = xpForLevel(30);
  assert.doesNotThrow(() => inst.update({ ids: new Set(), topics: new Set(['xp']) }));
  assert.equal(refreshed, 1, 'the tab strip is asked to redraw once');
  inst.update({ ids: new Set(), topics: new Set(['inventory']) });
  assert.equal(refreshed, 1, 'nothing new: no redraw');
});

test('P5 / ux-first#17: locked cards fold into one "Next: L4 Sunset Bench · …" strip, in level order', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { state } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const { ctx, body } = ctxOf(state, { args: { tab: 'decor' } });
  ctx.tab = 'decor';
  marketPanel.mount(body, ctx);
  assert.equal(body.querySelectorAll('.pn-card.locked').length, 0, 'no greyed "Unlocks at level N" cards in the grid');
  const strip = body.querySelector('.pn-next-strip');
  assert.ok(strip, 'one strip');
  assert.match(textOf(strip), /^Next: L\d+ /);
  const levels = [...strip.querySelectorAll('.pn-next-item')].map((x) => Number(/^L(\d+)/.exec(textOf(x))[1]));
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  assert.ok(levels.every((n) => n > 9));
});

test('P5 / ux-first#13: "Buy & place · 160" for a priced thing, "Place" for one in the tray or a free one', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { state } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  state.farm.wallet.coins = 2_000_000;
  const { ctx, body } = ctxOf(state);
  ctx.tab = 'decor';
  marketPanel.mount(body, ctx);
  const labels = [...body.querySelectorAll('.pn-card [data-place]')].map((b) => textOf(b));
  assert.ok(labels.length > 2);
  for (const l of labels) assert.match(l, /^(Place|Buy & place · [\d,]+)$/, l);
  assert.ok(labels.some((l) => l.startsWith('Buy & place')), 'priced decor says what it costs');
  // the coin rides with its number, and the " · " is apart so a phone card can drop it and wrap the price under the verb
  for (const b of body.querySelectorAll('.pn-card [data-place]')) {
    if (!textOf(b).startsWith('Buy & place')) continue;
    const cost = b.querySelector('.pn-cost');
    assert.ok(cost && cost.querySelector('svg'), 'the coin is inside the price group');
    assert.match(textOf(cost), /^[\d,]+$/);
    assert.equal(textOf(b.querySelector('.pn-sep')), '·');
  }
  assert.equal(body.querySelectorAll('.pn-card .pn-card-foot .pn-price').length, 0, 'no second price beside the button');
});

test('P5 / ux-first#17: Land lists the parcel for sale first and folds ours under "Ours (n)"', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { landUnits } = await import('../public/js/ui/panels/w5-rules.js');
  const { isLive } = await import('../shared/content/index.js');
  const { resetGrid } = await import('../shared/rules/grid-cache.js');
  const { farmAt } = await import('./helpers/rules.js');
  const units = landUnits().filter((u) => u.k > 0 && isLive(u)).sort((a, b) => a.k - b.k);
  const s = farmAt(25);
  s.farm.expansions = ['home', ...units.slice(0, 3).flatMap((u) => u.pieces)];
  resetGrid(s);
  const { ctx, body } = ctxOf(s);
  ctx.tab = 'land';
  marketPanel.mount(body, ctx);
  const first = body.querySelector('.pn-landlist .pn-landcard');
  assert.ok(first && !first.classList.contains('owned'), 'a card for sale leads');
  const fold = body.querySelector('.pn-land-ours');
  assert.ok(fold && fold.classList.contains('pn-chipbtn'));
  assert.match(textOf(fold), /^Ours \(3\)/);
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.equal(body.querySelectorAll('.pn-landcard.owned').length, 0, 'ours start folded');
  fold.click();
  assert.equal(body.querySelectorAll('.pn-landcard.owned').length, 3);
});

test('P5 / D3: Market › Tools opens on a tool by id ({ tab: "tools", focus: "wide_sickle" }) and rings its card', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { state } = storyFarm({ now: T0, level: 12, players: ['p1', 'p2'] });
  const { ctx, body } = ctxOf(state, { args: { tab: 'tools', focus: 'wide_sickle' } });
  ctx.tab = 'tools';
  marketPanel.mount(body, ctx);
  await new Promise((r) => setTimeout(r, 10));
  const card = body.querySelector('[data-def="wide_sickle"]');
  assert.ok(card, 'the Wide Sickle card is in the Tools tab');
  assert.ok(card.classList.contains('pn-focus-ring'), 'rung');
  assert.ok(marketPanel.tabs({ tab: 'tools' }, state).some((x) => x.id === 'tools'));
});

test('P5 / ux-first#13: the hub\'s dock button says what it opens ("Perks", not "Progress" over a Perks sheet)', async () => {
  const { hubDock } = await import('../public/js/ui/panels/league.js');
  assert.equal(hubDock('perks').label, 'Perks');
  assert.equal(hubDock('seasonTrack').label, 'Ribbon Track');
  assert.equal(hubDock('perks').mini, true);
});

test('P4 / astra cut list: the hub shows no "Legacy · L40" pill below level 38', async () => {
  const { hubNav, LEGACY_SHOWS_AT } = await import('../public/js/ui/panels/league-kit.js');
  const { farmAt } = await import('./helpers/rules.js');
  assert.equal(LEGACY_SHOWS_AT, 38);
  for (const [lvl, shown] of [[21, false], [36, false], [38, true]]) {
    const s = farmAt(lvl);
    const { ctx } = ctxOf(s);
    const nav = hubNav(ctx, 'perks');
    const pill = nav?.querySelector('[data-hub="legacy"]') ?? null;
    if (!shown) assert.equal(pill, null, `L${lvl}: no Legacy pill`);
  }
});

// ---- M16 / P8: names, contrast and empty states --------------------------------------------------------------------

test('M16 / perf-a11y#8: every progress bar has a name; the Barn says "Barn space 943 / 800"', async () => {
  const { bar } = await import('../public/js/ui/panels/kit.js');
  assert.equal(bar(0.5, null, '', 'Barn space 943 / 800').getAttribute('aria-label'), 'Barn space 943 / 800');
  assert.equal(bar(0.5, '4/10').getAttribute('aria-label'), '4/10', 'a labelled bar is named by its label');
  const mute = bar(0.5);
  assert.equal(mute.getAttribute('role'), null, 'a bar with nothing to say is no progress bar to a screen reader');
  assert.equal(mute.getAttribute('aria-hidden'), 'true');
  const { barnPanel } = await import('../public/js/ui/panels/barn.js');
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  const { state } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  for (const [panel, args] of [[barnPanel, {}], [journalPanel, {}]]) {
    const { ctx, body } = ctxOf(state, { args });
    panel.mount(body, ctx);
    const bars = body.querySelectorAll('[role="progressbar"]');
    assert.ok(bars.length >= 1);
    for (const b of bars) {
      const name = b.getAttribute('aria-label');
      assert.ok(name && !/\[object|undefined|null/.test(name), `${b.className}: a name in words (${name})`);
    }
  }
  const { ctx, body } = ctxOf(state);
  barnPanel.mount(body, ctx);
  assert.match(body.querySelector('[role="progressbar"]').getAttribute('aria-label'), /^Barn space [\d,]+ \/ [\d,]+$/);
  const j = ctxOf(state);
  journalPanel.mount(j.body, j.ctx);
  const task = j.body.querySelector('.pn-task [role="progressbar"]');
  assert.ok(task, 'a letter task with a bar');
  assert.match(task.getAttribute('aria-label'), /^[A-Z][^[]+: [\d,]+\/[\d,]+$/, 'the task line and its numbers');
});

test('M16 / perf-a11y#9: "70 left" on the chalkboard is #E4F3DA (4.8:1), never the old #CFE8C0', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../public/css/panels.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#CFE8C0/i);
  assert.match(css, /\.pn-chalk-item small \{[^}]*color: #E4F3DA/);
  assert.match(css, /\.pn-chalk-left \{[^}]*color: #E4F3DA/);
});

test('P8 / feel#15: the empty Barn shows a crate, not the barn with a red ✕', async () => {
  const { barnPanel } = await import('../public/js/ui/panels/barn.js');
  const { farmAt } = await import('./helpers/rules.js');
  const s = farmAt(3);
  s.farm.inventory = {};
  const { ctx, body } = ctxOf(s);
  barnPanel.mount(body, ctx);
  const e = body.querySelector('.pn-empty');
  assert.ok(e);
  const { svgIcon } = await import('../public/js/ui/dom.js');
  assert.equal(e.querySelector('svg').innerHTML, svgIcon('crate').innerHTML, 'the crate glyph');
  assert.notEqual(e.querySelector('svg').innerHTML, svgIcon('barn').innerHTML);
});

// ---- S9b: words for a finger ---------------------------------------------------------------------------------------

test('S9b / ux-phone#19: the Acorn shop says "One tap waters…" to a touch player, "One click…" to a mouse', async () => {
  const { relicSection } = await import('../public/js/ui/panels/relic-shop.js');
  const { createKit } = await import('../public/js/ui/panels/kit.js');
  const { state } = storyFarm({ now: T0, level: 12, players: ['p1', 'p2'] });
  const textOfCan = (input) => {
    const { ctx } = ctxOf(state);
    ctx.controller.input = input;
    const el = relicSection(ctx, createKit(ctx)).el ?? relicSection(ctx, createKit(ctx));
    const p = [...el.querySelectorAll('.pn-card-text')].map((x) => textOf(x)).find((x) => /waters every growing crop/.test(x));
    assert.ok(p, 'the Golden Watering Can is in the treasures');
    return p;
  };
  assert.match(textOfCan('touch'), /^One tap waters every growing crop/);
  assert.match(textOfCan('mouse'), /^One click waters every growing crop/);
});

test('F1 (life-feel\'s sound rule): a button that opens a panel is marked data-sfx="own" (one sound per press)', async () => {
  const fs = await import('node:fs');
  const dir = new URL('../public/js/ui/panels/', import.meta.url);
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'gift.js')) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/h\((['`])button[^'`]*\1,\s*\{([^]{0,500}?)\}\s*\}?,?/g)) {
      const head = m[2];
      const click = /on: \{ click: \(\w*\) => \{?\s*(?:ctx\.close\(\);\s*)?(?:ctx\.open|ctx\.ui\.panels\.open|ctx\.ui\?\.panels\?\.open)\(/.test(head);
      if (click && !/'data-sfx': 'own'/.test(head)) bad.push(`${f}: ${m[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('perf-a11y#13 (every panel): no <article> is re-roled as a listitem (axe aria-allowed-role on Animals, Market, Fair …)', async () => {
  const fs = await import('node:fs');
  const dir = new URL('../public/js/ui/panels/', import.meta.url);
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'gift.js')) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/h\((['`])article[^'`]*\1,\s*\{\s*role: 'listitem'/g)) bad.push(`${f}: ${m[0].slice(0, 70)}`);
  }
  assert.deepEqual(bad, []);
});

test('P7 / M12b: a phone on its side reads the short panel title too (640x360: the title ribbon is 216 px)', async () => {
  const { phoneTitle } = await import('../public/js/ui/panels/kit.js');
  const saved = globalThis.matchMedia;
  // a media query evaluated for a 640x360 screen: only the height clause of a list can match
  const screen = (w, hgt) => (q) => ({ matches: q.split(',').some((part) => {
    const mw = /max-width:\s*(\d+)px/.exec(part); const mh = /max-height:\s*(\d+)px/.exec(part);
    return (!mw || w <= Number(mw[1])) && (!mh || hgt <= Number(mh[1])) && Boolean(mw || mh);
  }) });
  try {
    globalThis.matchMedia = screen(640, 360);
    assert.equal(phoneTitle('market.orders.title', 'market.orders.titleShort'), 'Orders');
    globalThis.matchMedia = screen(844, 390);
    assert.equal(phoneTitle('market.orders.title', 'market.orders.titleShort'), 'Orders');
    globalThis.matchMedia = screen(1366, 768);
    assert.equal(phoneTitle('market.orders.title', 'market.orders.titleShort'), "Mabel's Orders");
  } finally { globalThis.matchMedia = saved; }
});

test('P9 / M16: a Ribbon Track milestone number is dark ink on its amber tab (cream on sun-700 is 2.2:1)', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../public/css/panels-league.css', import.meta.url), 'utf8');
  const rule = /\.lg-tier\.ms \.lg-tier-n \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the milestone tab rule');
  assert.match(rule[1], /background: var\(--sun-700\)/);
  assert.match(rule[1], /color: var\(--ink-900\)/);
});

void HOUR; void ruleAct;
