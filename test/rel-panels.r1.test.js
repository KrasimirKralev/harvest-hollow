// Release 1.0, ui-panels lane, QA round 1 (docs/qa/release/qa-r1/fix-ui-panels.md): the DOM and copy half of each
// item. Each test names its item; the layout half (CSS) is proven by the screenshots in
// docs/qa/release/build/ui-panels/r1/ and by tools/i18n-shots.mjs / tools/a11y-audit.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { storyFarm } from './helpers/ui-panels.js';
import { farmAt, give, actOk, evs, T0, MIN, HOUR } from './helpers/rules-goals.js';
import { allLand } from './helpers/rules.js';
import { allAreas } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const AREAS = await allAreas();
const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
const EN = Object.fromEntries(AREAS.flatMap(([, en]) => Object.entries(en)));
await I.__loadForTest('bg');
I.__setForTest('en');
/** Run `fn` in Bulgarian (the full catalogs and the names table), then back to English. */
const inBg = (fn) => { I.__setForTest('bg', BG); try { return fn(); } finally { I.__setForTest('en'); } };
const inLangs = (fn) => [['en', fn()], ['bg', inBg(fn)]];

/** A small event emitter store (the panels listen to 'fx'); acts and toasts are recorded. */
function ctxOf(state, { pid = 'p1', now = T0, args = {}, tab = null, has = () => true } = {}) {
  const acts = [];
  const toasts = [];
  const listeners = new Map();
  const body = document.createElement('div');
  document.body.append(body);
  const store = {
    state, pid, now: () => now,
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); },
    emit(ev, p) { for (const fn of listeners.get(ev) ?? []) fn(p); },
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
  };
  const ctx = {
    name: 'x', args, store, body, el: body, now: () => now, tab,
    ui: { panels: { open: () => true, has, retitle() {}, badge() {} }, toast: (t, o) => toasts.push([t, o]) },
    every: () => () => {}, subscribe: () => () => {},
    on(target, ev, fn) { if (target && typeof target.on === 'function') return target.on(ev, fn); target.addEventListener(ev, fn); return () => {}; },
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    open() {}, close() {}, setTitle(t) { ctx.title = t; }, refreshTabs() {},
    controller: { input: 'mouse', setTool() {}, do: (t, a) => { acts.push([t, a]); return { ok: true }; } },
  };
  return { ctx, body, acts, toasts, store };
}

/** Text nodes that print a JS value instead of words ("null", "undefined", "NaN"). */
function strayValues(el) {
  const out = [];
  const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && /^\s*(null|undefined|NaN)\s*$/.test(c.textContent)) out.push(c.textContent.trim()); else walk(c); } };
  walk(el);
  return out;
}

const named = (s) => { s.players.p1.name = 'Bo'; s.players.p2.name = 'Ana'; return s; };

// ---- P-01: Journal › Activity names the farmers on a surprise line -------------------------------------------

test('P-01: Journal › Activity says who left and who opened a surprise (never "The farm"), EN and BG, both screens', async () => {
  const { feedView, feedText } = await import('../public/js/ui/panels/goals-model.js');
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  const s = named(farmAt(14));
  give(s, 'rose', 1);
  const r = actOk(s, 'keepsake', { item: 'rose', note: 'for you' }, { pid: 'p2', now: T0 });
  actOk(s, 'openGift', { id: evs(r, 'keepsake')[0].id }, { pid: 'p1', now: T0 + MIN });
  const rows = feedView(s).map((x) => x.row).filter((x) => x.k === 'surprise');
  assert.deepEqual(rows.map((x) => x.what).sort(), ['left', 'opened']);
  for (const me of ['p1', 'p2']) {
    for (const [l, lines] of inLangs(() => rows.map((row) => feedText(row, s, me)))) {
      for (const line of lines) assert.doesNotMatch(line, /The farm|Фермата|фермата/, `${l} ${me}: ${line}`);
    }
  }
  // the giver reads "opened your surprise", the opener reads Ana's name
  const opened = rows.find((x) => x.what === 'opened');
  assert.match(feedText(opened, s, 'p1'), /Ana/);
  assert.match(feedText(opened, s, 'p2'), /your surprise/);
  assert.match(inBg(() => feedText(opened, s, 'p1')), /Ana/);
  // the whole Activity tab, as each farmer sees it
  for (const pid of ['p1', 'p2']) {
    const { ctx, body } = ctxOf(s, { pid, tab: 'activity', now: T0 + 2 * MIN });
    journalPanel.mount(body, ctx);
    const text = textOf(body);
    assert.doesNotMatch(text, /The farm('s)? /, `${pid}: ${text.slice(0, 300)}`);
    assert.match(text, pid === 'p1' ? /Ana left a surprise for you/ : /Bo \(you\) left|Ana \(you\) left a surprise for Bo/);
    body.remove();
  }
});

test('P-01: a surprise the farm shelved by itself is its own sentence (no "The farm" before it) and names both farmers', async () => {
  const { feedText } = await import('../public/js/ui/panels/goals-model.js');
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  const s = named(farmAt(14));
  const row = { k: 'surprise', what: 'shelved', item: 'rose', from: 'p2', to: 'p1', by: 'sys', at: T0 };
  assert.equal(feedText(row, s, 'p2'), "Your surprise went to Bo's shelf");
  assert.equal(feedText(row, s, 'p1'), "Ana's surprise went to your shelf");
  assert.doesNotMatch(inBg(() => feedText(row, s, 'p1')), /Фермата/);
  // through the rules: the box nobody opened goes to the shelf by itself after two days, and the Journal prints no
  // actor ("The farm") before the line, which names both farmers itself
  const { COOP } = await import('../shared/content/index.js');
  const { runDue } = await import('./helpers/rules-goals.js');
  give(s, 'rose', 1);
  actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p2', now: T0 });
  runDue(s, T0 + COOP.keepsake.shelfMs + MIN);
  const { ctx, body } = ctxOf(s, { pid: 'p1', tab: 'activity', now: T0 + COOP.keepsake.shelfMs + 2 * MIN });
  journalPanel.mount(body, ctx);
  const text = textOf(body);
  assert.match(text, /Ana's surprise went to your shelf/, text.slice(0, 300));
  assert.doesNotMatch(text, /The farm Ana's/);
  body.remove();
});

// ---- P-02 / P-21: the Beehive -------------------------------------------------------------------------------

test('P-02: no home panel prints "null" (a colony has no pair card), on every home type', async () => {
  const { animalsPanel } = await import('../public/js/ui/panels/animals.js');
  const { CONTENT } = await import('../shared/content/index.js');
  const { put } = await import('./helpers/rules-goals.js');
  const homes = [...CONTENT.homes.keys()];
  assert.ok(homes.includes('beehive'));
  for (const def of homes) {
    const s = farmAt(40);
    allLand(s);
    const id = put(s, def);
    if (!id) continue;
    const { ctx, body } = ctxOf(s, { args: { id } });
    animalsPanel.mount(body, ctx);
    assert.deepEqual(strayValues(body), [], `${def}: ${textOf(body).slice(0, 160)}`);
    body.remove();
  }
});

test('P-21: the Beehive\'s main button collects ("Collect all" / "Събери всичко"), never "Feed all" beside "Bees need no feed"', async () => {
  const { animalsPanel } = await import('../public/js/ui/panels/animals.js');
  const { put } = await import('./helpers/rules-goals.js');
  const s = farmAt(40);
  const hive = put(s, 'beehive');
  const coop = put(s, 'coop');
  const label = (id) => {
    const { ctx, body } = ctxOf(s, { args: { id } });
    animalsPanel.mount(body, ctx);
    const t = body.querySelector('[data-tend]')?.textContent.trim();
    body.remove();
    return t;
  };
  assert.equal(label(hive), 'Collect all');
  assert.equal(inBg(() => label(hive)), 'Събери всичко');
  assert.equal(label(coop), 'Tend all', 'a home whose animals eat keeps its word');
});

// ---- P-03: a long building name on a phone title --------------------------------------------------------------

test('P-03: a phone title takes the short name of a long place name (Spice Mill in Bulgarian), every building and home <= 17 letters', async () => {
  const { buildingPanel } = await import('../public/js/ui/panels/building.js');
  const { placeTitle } = await import('../public/js/ui/panels/kit.js');
  const { CONTENT } = await import('../shared/content/index.js');
  const { put } = await import('./helpers/rules-goals.js');
  const mm = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const s = farmAt(40);
    const id = put(s, 'spice_mill');
    assert.equal(inBg(() => buildingPanel.title({ id }, s)), 'Подправки');
    const { ctx, body } = ctxOf(s, { args: { id } });
    inBg(() => buildingPanel.mount(body, ctx));
    assert.equal(ctx.title, 'Подправки', 'the title the panel sets once it renders');
    body.remove();
    for (const fam of ['buildings', 'homes', 'trees']) {
      for (const def of CONTENT[fam].keys()) {
        const t = inBg(() => placeTitle(def, I.name(def)));
        assert.ok(t.length <= 17, `${fam} ${def}: "${t}" (${t.length})`);
        assert.ok(placeTitle(def, I.name(def)).length <= 20, `${def} in English`);
      }
    }
  } finally { globalThis.matchMedia = mm; }
  // a desktop keeps the whole name
  const s = farmAt(40);
  const id = put(s, 'spice_mill');
  assert.equal(inBg(() => buildingPanel.title({ id }, s)), 'Мелница за подправки');
});

// ---- P-05: progress bars carry a name -------------------------------------------------------------------------

test('P-05 / M16: every progress bar of Journal › This week has a name, the Together bar too while nobody added a thing', async () => {
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  const { state } = storyFarm({ now: T0, level: 9 });
  const pid = 'p1';
  const { ctx, body } = ctxOf(state, { pid, tab: 'week' });
  journalPanel.mount(body, ctx);
  const bars = body.querySelectorAll('[role="progressbar"]');
  assert.ok(bars.length > 0);
  assert.ok(body.querySelectorAll('.pn-split').length > 0, 'the Together bar is there');
  for (const b of bars) assert.ok((b.getAttribute('aria-label') ?? '').trim().length > 3, `${b.className}: ${b.getAttribute('aria-label')}`);
  const split = body.querySelector('.pn-split');
  assert.match(split.getAttribute('aria-label'), /\d+\s*\/\s*\d+/, 'it says what is measured: have / need');
});

// ---- P-06: the Memory Book has a screen ------------------------------------------------------------------------

test('P-06: Journal › Memory lists the Memory Book pages newest first, a gift with its giver and its note in quotes', async () => {
  const { journalPanel, journalTabLive } = await import('../public/js/ui/panels/journal.js');
  const { PIECE_PANELS } = await import('../public/js/game/interior.js');
  const s = named(farmAt(40));
  assert.equal(journalTabLive(s, 'memory'), false, 'no page yet: no tab (P5)');
  give(s, 'rose', 1);
  const r = actOk(s, 'keepsake', { item: 'rose', note: 'for you' }, { pid: 'p2', now: T0 });
  actOk(s, 'openGift', { id: evs(r, 'keepsake')[0].id }, { pid: 'p1', now: T0 + MIN });
  assert.ok(Object.values(s.farm.memory.rows).some((x) => x.k === 'gift'), 'the rules wrote a page');
  assert.equal(journalTabLive(s, 'memory'), true);
  assert.ok(journalPanel.tabs({}, s).some((x) => x.id === 'memory'));
  // the farmhouse's memory wall asks for { tab: 'memory' } (game/interior.js): it lands on the tab
  assert.ok(PIECE_PANELS.memory_wall.includes('journal'));
  for (const [l, text] of inLangs(() => {
    const { ctx, body } = ctxOf(s, { tab: 'memory', now: T0 + 2 * MIN });
    journalPanel.mount(body, ctx);
    const t = textOf(body);
    body.remove();
    return t;
  })) {
    assert.match(text, /Ana/, `${l}: ${text.slice(0, 200)}`);
    assert.match(text, /[“„"]for you[”“"]/, `${l}: the note in quotes: ${text.slice(0, 200)}`);
    assert.match(text, l === 'en' ? /Rose/ : /Роза|роза/, `${l}: what was inside`);
  }
});

test('P-06: every Memory Book page kind the rules write has words in Journal › Memory (no raw kind, EN and BG)', async () => {
  const { memoryLine } = await import('../public/js/ui/panels/goals-model.js');
  const { MEMORY_AUTO, MEMORY_OFFERED } = await import('../shared/rules/actions/memory.js');
  const s = named(farmAt(40));
  const sample = { farm: { text: 'Honey Acres' }, animal: { ref: 'x', text: 'Rada' }, level: { ref: '20' }, prized: { ref: 'x' }, together: { ref: 'p2' },
    project: { ref: 'windmill' }, town: { ref: 'x' }, season: { ref: 'autumn' }, platinum: { ref: '3' }, grandma: { ref: 'arrived' }, duel: { ref: 'harvest' },
    photo: {}, golden: {}, duet: {}, quest: { ref: 'f1' }, gift: { ref: 'rose', text: 'hi' } };
  for (const k of [...MEMORY_AUTO, ...MEMORY_OFFERED, 'gift']) {
    for (const [l, line] of inLangs(() => memoryLine({ n: 1, k, at: T0, by: 'p1', ...sample[k] }, s, 'p2'))) {
      assert.ok(line && !/\bundefined\b|\bnull\b|goals\.j\./.test(line), `${l} ${k}: ${line}`);
    }
  }
});

// ---- P-07 / P-08: the orders promise and the level-1 tip -------------------------------------------------------

test('P-07: the copy never promises orders pay 50 % more in coins (they pay more in coins AND XP), EN and BG', () => {
  const keys = ['market.sell.tipKeys', 'market.sell.tipTouch', 'market.orders.noteLater', 'market.orders.noteFree', 'market.orders.noteCost',
    'market.orders.untilThen'];
  const flat = (v) => (typeof v === 'string' ? [v] : Object.values(v));
  for (const k of keys) {
    for (const [l, cat] of [['en', EN], ['bg', BG]]) {
      for (const v of flat(cat[k])) {
        assert.doesNotMatch(v, /50\s?%|половина/, `${l} ${k}: ${v}`);
        assert.match(v, l === 'en' ? /XP/ : /опит/, `${l} ${k} names the XP: ${v}`);
      }
    }
  }
  assert.doesNotMatch(BG['story.letters'] ?? '', /половина повече/);
});

test('P-08: the Market\'s orders tip at level 1 says when orders come (no "Press O", no "menu"); from level 2 it names the bar', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { ORDERS } = await import('../shared/content/index.js');
  const tipAt = (level, touch) => {
    const s = farmAt(level);
    give(s, 'wheat', 4);
    const mm = globalThis.matchMedia;
    globalThis.matchMedia = (q) => ({ matches: touch && /coarse/.test(q) });
    try {
      const { ctx, body } = ctxOf(s, { tab: 'sell' });
      marketPanel.mount(body, ctx);
      const t = body.querySelector('.pn-tip')?.textContent ?? '';
      body.remove();
      return t;
    } finally { globalThis.matchMedia = mm; }
  };
  for (const touch of [false, true]) {
    const l1 = tipAt(ORDERS.unlock - 1, touch);
    assert.doesNotMatch(l1, /Press O|Menu/i, `L1 ${touch ? 'touch' : 'keys'}: ${l1}`);
    assert.match(l1, /level 2|will/i, `L1 says when: ${l1}`);
    const bg1 = inBg(() => tipAt(ORDERS.unlock - 1, touch));
    assert.doesNotMatch(bg1, /Натисни O|менюто/, `BG L1: ${bg1}`);
  }
  const l2 = tipAt(ORDERS.unlock, true);
  assert.doesNotMatch(l2, /Menu/i, l2);
  assert.match(l2, /bottom bar/i, l2);
  assert.doesNotMatch(inBg(() => tipAt(ORDERS.unlock, true)), /менюто/);
});

// ---- P-09: the Journal at level 2 -----------------------------------------------------------------------------

test('P-09: at level 2 the Journal hides "This week" and Mastery, and its letters say when they come ("Next:" strip)', async () => {
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  const s = farmAt(2);
  s.farm.mastery = { crops: { wheat: 6 } };          // a count before the mastery level (the tester's L2 farm had one)
  const ids = journalPanel.tabs({}, s).map((x) => x.id);
  assert.ok(!ids.includes('week'), `no This week at L2: ${ids.join(' ')}`);
  assert.ok(!ids.includes('mastery'), `no Mastery at L2: ${ids.join(' ')}`);
  assert.ok(journalPanel.tabs({}, farmAt(3)).some((x) => x.id === 'week'), 'This week from level 3');
  const { ctx, body } = ctxOf(s, { tab: 'story' });
  journalPanel.mount(body, ctx);
  const strip = body.querySelector('.pn-next-strip');
  assert.ok(strip, 'a Next: strip');
  assert.match(textOf(strip), /L3 This week/);
  assert.match(textOf(strip), /L7 Mastery/);
  body.remove();
});

// ---- P-17: the partner fills an order while I aim at it --------------------------------------------------------

test('P-17: an order the partner filled stays as a same-height "✓ … delivered" row for a moment, and a Deliver tap on a row that just moved is ignored', async () => {
  const { ordersPanel } = await import('../public/js/ui/panels/orders.js');
  const { state } = storyFarm({ now: T0, level: 9 });
  named(state);
  const slots = state.farm.orders.slots;
  const open = Object.keys(slots).map(Number).sort((a, b) => a - b).filter((i) => slots[i].order);
  assert.ok(open.length >= 3);
  // every order deliverable
  for (const i of open) for (const [item, q] of Object.entries(slots[i].order.items)) state.farm.inventory[item] = (state.farm.inventory[item] ?? 0) + q;
  const { ctx, body, acts, store } = ctxOf(state, { pid: 'p1', now: T0 });
  const inst = ordersPanel.mount(body, ctx);
  const first = body.querySelector('.pn-board .pn-order[data-slot]');
  const slot = Number(first.dataset.slot);
  const n = slots[slot].order.n;
  const below = [...body.querySelectorAll('.pn-board .pn-order[data-slot]')][1].dataset.slot;
  // the partner fills it on the server: the state changes, then the confirmed event arrives
  actOk(state, 'orderFill', { slot, n }, { pid: 'p2', now: T0 + 1000 });
  store.emit('fx', { ev: { e: 'orderFilled', slot, n, by: 'p2' }, by: 'p2', local: false });
  inst.update();
  const ghost = body.querySelector(`.pn-board .pn-order-ghost[data-slot="${slot}"]`);
  assert.ok(ghost, 'a ghost row where the order was');
  assert.match(textOf(ghost), /Ana/);
  const rows = [...body.querySelectorAll('.pn-board .pn-order[data-slot]')];
  assert.equal(rows[0], ghost, 'it keeps its place: nothing below it moved');
  assert.equal(rows[1].dataset.slot, below);
  // the ghost goes after its moment: the rows below move up, and a tap that was aimed before the move is ignored
  await new Promise((r) => setTimeout(r, 1700));
  inst.update();
  assert.equal(body.querySelector('.pn-order-ghost'), null, 'the ghost is gone');
  const moved = body.querySelector(`.pn-board .pn-order[data-slot="${below}"] [data-fill]`);
  const before = acts.length;
  moved.click();
  assert.equal(acts.length, before, 'a tap within 400 ms of the move fills nothing');
  await new Promise((r) => setTimeout(r, 450));
  body.querySelector(`.pn-board .pn-order[data-slot="${below}"] [data-fill]`).click();
  assert.equal(acts.length, before + 1, 'after the moment the same tap delivers');
  body.remove();
});

// ---- P-18 / P-19: roles that fit what is inside ----------------------------------------------------------------

test('P-18: the Land map with clickable parcels is a group (a button never sits inside an image)', async () => {
  const { landMap } = await import('../public/js/ui/panels/art.js');
  const { landCards } = await import('../public/js/ui/panels/model.js');
  const s = farmAt(12);
  const cards = landCards(s);
  const live = landMap(s, cards, { onPick: () => {} });
  assert.ok(live.querySelector('[role="button"]'), 'a parcel to pick');
  assert.equal(live.getAttribute('role'), 'group');
  assert.ok(live.getAttribute('aria-label'));
  assert.equal(landMap(s, cards, {}).getAttribute('role'), 'img', 'a picture-only map stays an image');
});

test('P-19: an empty list is not a list: Market › Sell, the Barn and the closed Order Board on a fresh farm', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { barnPanel } = await import('../public/js/ui/panels/barn.js');
  const { ordersPanel } = await import('../public/js/ui/panels/orders.js');
  const s = farmAt(1);
  for (const k of Object.keys(s.farm.inventory)) s.farm.inventory[k] = 0;
  const roleOk = (el, role, child) => {
    const r = el.getAttribute('role');
    if (r !== role) return true;
    return el.querySelectorAll(`[role="${child}"]`).length > 0;
  };
  let m = ctxOf(s, { tab: 'sell' });
  marketPanel.mount(m.body, m.ctx);
  assert.ok(roleOk(m.body.querySelector('.pn-stacks'), 'listbox', 'option'), 'Market › Sell: a listbox with no option');
  m.body.remove();
  m = ctxOf(s, {});
  barnPanel.mount(m.body, m.ctx);
  assert.ok(roleOk(m.body.querySelector('.pn-barnlist'), 'list', 'listitem'), 'the Barn: a list with no item');
  m.body.remove();
  m = ctxOf(s, {});
  ordersPanel.mount(m.body, m.ctx);
  assert.ok(roleOk(m.body.querySelector('.pn-board'), 'list', 'listitem'), 'Orders below level 2: a list with no item');
  m.body.remove();
  // with goods the roles come back
  give(s, 'wheat', 3);
  m = ctxOf(s, { tab: 'sell' });
  marketPanel.mount(m.body, m.ctx);
  assert.equal(m.body.querySelector('.pn-stacks').getAttribute('role'), 'listbox');
  m.body.remove();
});

// ---- P-22 / P-23: feed words ----------------------------------------------------------------------------------

test('P-22: the English Golden Hour feed line starts with a capital', () => {
  assert.match(EN['feed.golden'], /^\{actor\} [A-Z]/);
});

test('P-23: an unopened crate that went to the Barn is said once in one wording: the toast and the feed line match', async () => {
  const { default: installW4b } = await import('../public/js/ui/panels/w4b.js');
  const { feedText } = await import('../public/js/ui/feed.js');
  const s = named(farmAt(20));
  const ev = { e: 'crateOpened', id: 'c1', auto: true, coins: 3640, xp: 469, acorns: 2 };
  const row = { k: 'crate', c: 3640, auto: 1, a: 2, by: 'sys' };
  for (const l of ['en', 'bg']) {
    const run = () => {
      const listeners = new Set();
      const toasts = [];
      const store = { state: s, pid: 'p1', on: (e, fn) => { if (e === 'fx') listeners.add(fn); return () => listeners.delete(fn); } };
      const off = installW4b({ toast: (t) => toasts.push(typeof t === 'function' ? t() : t) }, { store });
      for (const fn of listeners) fn({ ev, by: 'sys', local: false });
      off();
      return [toasts[0], feedText(row, s, 'p1').text];
    };
    const [toast, feed] = l === 'en' ? run() : inBg(run);
    assert.equal(toast, feed, `${l}: toast "${toast}" vs feed "${feed}"`);
  }
});

// ---- string patches other lanes asked for (QA r1) -------------------------------------------------------------

test('F-09 / F-06 (features\' BG patches): Helping Hands\' done line has no title and no "in a row"; the apple-tree step says what to do', () => {
  const done = inBg(() => I.ctext('quests', 'h3', 'done', 'x'));
  assert.equal(done, 'Три пъти си помогнахте. Хубав навик.');
  assert.doesNotMatch(done, /Ръце на помощ|подред/);
  const step = inBg(() => I.ctext('TUTORIAL', 'step.apple_tree', 'text', 'x'));
  assert.match(step, /^Засади ябълковото дърво на баба/);
});

test('P-04: the free new-order button says one short thing (the "once a day" rule is a line under it)', () => {
  for (const [l, cat] of [['en', EN], ['bg', BG]]) {
    assert.ok(cat['market.orders.nowFree'].length <= 24, `${l}: "${cat['market.orders.nowFree']}"`);
    assert.ok(cat['market.orders.nowFreeNote'], `${l}: the rule lives in a small line under the button`);
  }
});

test('P-06 / D1: interior.js memory wall opens the Journal on the memory tab, which the Journal knows', async () => {
  const { JOURNAL_TABS } = await import('../public/js/ui/panels/journal.js');
  assert.ok(JOURNAL_TABS.some((x) => x.id === 'memory'));
  assert.ok(EN['goals.j.tab.memory'] && BG['goals.j.tab.memory']);
});

void HOUR;
