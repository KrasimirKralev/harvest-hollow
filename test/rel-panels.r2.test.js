// Release 1.0, ui-panels lane, QA round 2 (docs/qa/release/qa-r2/fix-ui-panels.md): the DOM, copy and stylesheet half of
// each item, plus the patches other lanes sent this lane (F2-02 Memory Book, S2-01 windmill step, S2-15 reduced motion,
// S2-05 the Market's own pick). The layout half is proven by the screenshots in docs/qa/release/build/ui-panels/r2/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom, textOf } from './ui-qa2-dom.js';
import { storyFarm } from './helpers/ui-panels.js';
import { farmAt, give, actOk, evs, T0, MIN } from './helpers/rules-goals.js';
import { allAreas } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AREAS = await allAreas();
const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
const EN = Object.fromEntries(AREAS.flatMap(([, en]) => Object.entries(en)));
await I.__loadForTest('bg');
I.__setForTest('en');
const inBg = (fn) => { I.__setForTest('bg', BG); try { return fn(); } finally { I.__setForTest('en'); } };
const inLangs = (fn) => [['en', fn()], ['bg', inBg(fn)]];
/** The Bulgarian content texts (letters, tutorial steps, feature cards): bg/text.js merges text-b and text-c. */
const TEXT = (await import('../public/js/i18n/bg/text.js')).default;

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

const named = (s) => { s.players.p1.name = 'Bo'; s.players.p2.name = 'Ana'; return s; };

// ---- stylesheets: every rule of the linked sheets as { file, media, sel, body }, in cascade order ----------------
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const sheets = [...index.matchAll(/<link rel="stylesheet" href="\/css\/([\w-]+\.css)">/g)].map((m) => m[1]);
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const cssOf = (f) => strip(fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8'));
function rules(list) {
  const out = [];
  for (const [file, text] of list) {
    const walk = (src, media) => {
      let depth = 0; let start = 0; let sel = '';
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '{') { if (depth === 0) { sel = src.slice(start, i).trim(); start = i + 1; } depth++; }
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            const body = src.slice(start, i);
            if (sel.startsWith('@media')) walk(body, sel);
            else out.push({ file, media, sel, body });
            start = i + 1;
          }
        }
      }
    };
    walk(text, '');
  }
  return out;
}
const ALL = rules(sheets.map((f) => [f, cssOf(f)]));
const decl = (body, prop) => body.match(new RegExp(`(?:^|;|\\s|\\{)${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;
/** The winning value of `prop` for a selector exactly in a rule's list, among rules whose media passes `mediaOk`. */
function winner(sel, prop, mediaOk = (m) => m === '') {
  let win = null;
  for (const r of ALL) {
    if (!mediaOk(r.media) || !r.sel.split(',').map((s) => s.trim()).includes(sel)) continue;
    const v = decl(r.body, prop);
    if (v !== null) win = { file: r.file, value: v, media: r.media };
  }
  return win;
}
const LAND = '@media (max-height: 500px) and (min-width: 601px)';
const PHONE = '@media (max-width: 600px), (max-height: 500px)';
/** A phone on its side gets the base rules, the "every phone" block and the landscape block. */
const sideways = (m) => m === '' || m === PHONE || m === LAND;
const phone = (m) => m === '' || m === PHONE;

// ---- P2-01: a workshop's "ready" header wraps whole items on a phone on its side ---------------------------------

test('P2-01: on a phone on its side the ready header wraps item by item (it ran 18-81 px past the sheet)', () => {
  assert.equal(winner('.pn-bhead-status', 'display', sideways)?.value, 'flex');
  assert.equal(winner('.pn-bhead-status', 'flex-wrap', sideways)?.value, 'wrap', 'the ready items take a line each when they must');
  // an item never shrinks to its longest word ("Pump… / Pie / ready:"): it keeps its words on one line inside the sheet
  assert.equal(winner('.pn-bhead-status .pn-ready', 'white-space', sideways)?.value, 'nowrap');
  assert.equal(winner('.pn-bhead-status .pn-ready', 'max-width', sideways)?.value, '100%');
});

test('P2-01: a phone on its side lists two or more ready kinds as one line of icons and counts, each named', async () => {
  const { buildingPanel } = await import('../public/js/ui/panels/building.js');
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const later = T0 + 6 * 3_600_000;
  const saved = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(max-height: 500px) and (min-width: 601px)', addEventListener() {}, removeEventListener() {} });
  try {
    for (const [l, got] of inLangs(() => {
      const { ctx, body } = ctxOf(state, { args: { id: ids.feedMill }, now: later });
      buildingPanel.mount(body, ctx);
      const minis = [...body.querySelectorAll('.pn-bhead-status .pn-ready-mini')];
      const r = { n: minis.length, labels: minis.map((m) => m.getAttribute('aria-label')), text: textOf(body.querySelector('.pn-bhead-status')) };
      body.remove();
      return r;
    })) {
      assert.equal(got.n, 2, `${l}: two kinds, two icons`);
      if (l === 'en') assert.deepEqual(got.labels, ['Chicken Feed ready:\u00a06', 'Livestock Feed ready:\u00a06']); // QA r3 P3-04: a no-break space before the count
      else for (const x of got.labels) assert.match(x, /\u00a0· готови:\u00a06$/); // QA r4 P4-02: the no-break space before the dot
      assert.match(got.text, l === 'en' ? /^Ready:×6×6/ : /^Готово:×6×6/, got.text);
    }
  } finally { globalThis.matchMedia = saved; }
  // upright (no landscape match): the words stay
  const { ctx, body } = ctxOf(state, { args: { id: ids.feedMill }, now: later });
  buildingPanel.mount(body, ctx);
  assert.equal(body.querySelectorAll('.pn-ready-mini').length, 0);
  assert.match(textOf(body.querySelector('.pn-bhead-status')), /Chicken Feed ready:\s6/);
  body.remove();
});

// ---- P2-02: a tree's buttons are never under the "more below" fade ------------------------------------------------

test('P2-02: on a phone on its side the tree\'s action row sticks to the sheet\'s foot, on paper, above the fade', () => {
  assert.equal(winner('.pn-tree-acts', 'position', sideways)?.value, 'sticky');
  assert.equal(winner('.pn-tree-acts', 'bottom', sideways)?.value, '0');
  // the fade (shell.css .scroll-fade) is z-index 2: the row draws over it, on its own paper
  const fade = Number(winner('.hh-panel .scroll-fade', 'z-index')?.value);
  assert.ok(Number(winner('.pn-tree-acts', 'z-index', sideways)?.value) > fade, 'above the fade');
  assert.match(String(winner('.pn-tree-acts', 'background', sideways)?.value), /paper|#/, 'its own paper, not see-through');
  assert.equal(winner('.pn-tree-acts', 'position')?.value ?? 'static', 'static', 'a desktop card keeps its row in place');
});

// ---- P2-03: Bulgarian counts that agree ------------------------------------------------------------------------

/** Plural adjectives and participles that must never follow a bare count in a plain string ("1 готови"). */
const PLURAL_ADJ = ['готови', 'гладни', 'зрели', 'празни', 'пълни', 'свободни', 'възрастни', 'изработени', 'намерени', 'направени',
  'родени', 'спестени', 'събрани', 'търсени', 'засадени', 'прибрани', 'продадени', 'доставени', 'нахранени', 'останали', 'чакащи',
  'липсващи', 'заети', 'отключени', 'нови', 'пораснали', 'изпълнени', 'завършени', 'сготвени', 'изпечени'];
/** Lines whose count is never 1 by the rule that shows them (a pair needs two grown animals: breeding.js canPair). */
const ALWAYS_MANY = new Set(['home.breed.grown']);

test('P2-03: no Bulgarian line puts a plural adjective right after a bare count (lint), and the three seen lines agree', () => {
  const re = new RegExp(`(?<!от )\\{[a-zA-Z]+\\}\\s+(${PLURAL_ADJ.join('|')})(?![а-я])`);
  const bad = Object.entries(BG).filter(([k, v]) => typeof v === 'string' && re.test(v) && !ALWAYS_MANY.has(k)).map(([k, v]) => `${k}: ${v}`);
  assert.deepEqual(bad, [], `a count before a plural adjective must be a { one, other } entry or a label ("готови: {n}"):\n${bad.join('\n')}`);
  const say = (key, params) => inBg(() => I.t(key, params));
  for (const n of [1, 2, 5]) {
    for (const line of [say('farm.bld.ready', { name: 'Сирене', n }), say('farm.ani.nReady', { n }), say('farm.ani.nHungry', { n })]) {
      assert.doesNotMatch(line, /\b1 (готови|гладни)\b/, line);
    }
  }
  assert.equal(say('farm.bld.ready', { name: 'Сирене', n: 1 }), 'Сирене\u00a0· готови:\u00a01'); // QA r3 P3-04: the count never stands alone on a line; QA r4 P4-02: nor the dot at a line's start
  assert.equal(say('farm.ani.nReady', { n: 1 }), 'готови:\u00a01');
  assert.equal(say('farm.ani.nHungry', { n: 1 }), 'гладни:\u00a01');
  // the siblings the lint found, at 1
  assert.doesNotMatch(say('farm.bld.madeTop', { n: 1 }), /1 направени/);
  assert.doesNotMatch(say('farm.ani.collected', { n: 1 }), /1 събрани/);
  assert.doesNotMatch(say('goals.j.mastery.crafts.all', { n: 1 }), /1 изработени/);
  assert.doesNotMatch(say('home.breed.bred', { n: 1 }), /1 родени/);
  assert.doesNotMatch(say('farm.up.demand', { n: 1 }), /1 търсени/);
  assert.doesNotMatch(say('market.chalk.upAria', { n: 1 }), /1 готови/);
  assert.doesNotMatch(say('feed.j.wish.bought.any.c', { actor: 'Ана', n: 1 }), /1 спестени/);
});

// ---- P2-04: a partner's sale never re-sorts the Orders under my cursor ------------------------------------------

test('P2-04: a partner\'s sale that changes what is deliverable moves no row while Orders is open; my own act re-sorts', async () => {
  const { ordersPanel } = await import('../public/js/ui/panels/orders.js');
  const { state } = storyFarm({ now: T0, level: 9 });
  named(state);
  const slots = state.farm.orders.slots;
  const open = Object.keys(slots).map(Number).sort((a, b) => a - b).filter((i) => slots[i].order);
  assert.ok(open.length >= 3, 'three orders on the board');
  // the first two orders deliverable, the rest not: each deliverable order's goods are its own (no shared item)
  for (const k of Object.keys(state.farm.inventory)) state.farm.inventory[k] = 0;
  const firstTwo = open.slice(0, 2);
  const itemsOf = (i) => Object.entries(slots[i].order.items);
  for (const i of firstTwo) for (const [item, q] of itemsOf(i)) state.farm.inventory[item] = (state.farm.inventory[item] ?? 0) + q;
  const { ctx, body, acts, store } = ctxOf(state, { pid: 'p1', now: T0 });
  const inst = ordersPanel.mount(body, ctx);
  const order = () => [...body.querySelectorAll('.pn-board .pn-order[data-slot]')].map((r) => r.dataset.slot);
  const before = order();
  const aimed = before[0];
  assert.ok(body.querySelector(`.pn-order[data-slot="${aimed}"]`).classList.contains('ready'), 'the top row is deliverable');
  // the partner sells the goods of the order I am aiming at (the server's state, then its event)
  for (const [item] of itemsOf(Number(aimed))) state.farm.inventory[item] = 0;
  store.emit('fx', { ev: { e: 'sold', item: itemsOf(Number(aimed))[0][0], qty: 1, by: 'p2' }, by: 'p2', local: false });
  inst.update();
  assert.deepEqual(order(), before, 'no row moved: the order I aimed at is still under the cursor');
  assert.ok(!body.querySelector(`.pn-order[data-slot="${aimed}"]`).classList.contains('ready'), 'it now says what it needs');
  // the reverse: the partner brings goods for a row below, which turns deliverable without jumping to the top
  const low = Number(before.at(-1));
  if (slots[low]?.order) {
    for (const [item, q] of itemsOf(low)) state.farm.inventory[item] = (state.farm.inventory[item] ?? 0) + q;
    store.emit('fx', { ev: { e: 'harvested', by: 'p2' }, by: 'p2', local: false });
    inst.update();
    assert.deepEqual(order(), before, 'an order that became deliverable stays where it was');
  }
  // a click on the second row still fills the order it shows (not one that slid under the cursor)
  const second = body.querySelector(`.pn-order[data-slot="${before[1]}"] [data-fill]`);
  const n0 = acts.length;
  await new Promise((r) => setTimeout(r, 450));
  second.click();
  assert.equal(acts.length, n0 + 1);
  assert.equal(acts.at(-1)[1].slot, Number(before[1]), 'the press filled the order it was aimed at');
  // my own act re-sorts (deliverable first again)
  store.emit('fx', { ev: { e: 'orderFilled', slot: Number(before[1]), n: slots[before[1]].order.n, by: 'p1' }, by: 'p1', local: true });
  inst.update();
  const after = order();
  const rank = (slot) => (body.querySelector(`.pn-order[data-slot="${slot}"]`).classList.contains('ready') ? 0 : 1);
  const ranks = after.filter((x) => body.querySelector(`.pn-order[data-slot="${x}"]:not(.pn-order-wait)`)).map(rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `my own act: deliverable rows first again (${after})`);
  // a re-open sorts afresh too
  const b2 = ctxOf(state, { pid: 'p1', now: T0 });
  ordersPanel.mount(b2.body, b2.ctx);
  const fresh = [...b2.body.querySelectorAll('.pn-board .pn-order[data-slot]')].filter((r) => !r.classList.contains('pn-order-wait'))
    .map((r) => (r.classList.contains('ready') ? 0 : 1));
  assert.deepEqual(fresh, [...fresh].sort((a, b) => a - b));
  body.remove(); b2.body.remove();
});

// ---- P2-05: Market › Land names the parcel to buy first --------------------------------------------------------

test('P2-05: a locked parcel says "Buy Creek Hill first" (never "Buy the land before it first"), EN and BG', async () => {
  const { landCards } = await import('../public/js/ui/panels/model.js');
  const s = farmAt(14);
  const cards = landCards(s);
  const next = cards.find((c) => c.isNext);
  const second = cards.find((c) => c.k === next.k + 1);
  assert.ok(next && second, 'two parcels for sale');
  assert.equal(second.code, 'LOCKED');
  assert.equal(second.hint.text, `Buy ${next.name} first`);
  const bg = inBg(() => landCards(s).find((c) => c.k === second.k).hint.text);
  const obj = inBg(() => I.name(next.id, { form: 'defObj', family: 'parcels' }));
  assert.equal(bg, `Първо купи ${obj}`);
  for (const [l, text] of inLangs(() => landCards(s).filter((c) => c.code === 'LOCKED' && !c.owned && c.k > next.k).map((c) => c.hint.text))) {
    for (const x of text) assert.doesNotMatch(x, /before it first|преди нея/, `${l}: ${x}`);
  }
  assert.doesNotMatch(EN['market.land.before'], /before it first/);
});

// ---- P2-06: a "later" perk keeps its words at full contrast ------------------------------------------------------

test('P2-06: a "later" perk dims only its cost circle; its words keep ink (the whole row at .66 was 3.84:1)', () => {
  const row = winner('.lg-perk.later', 'opacity');
  assert.ok(!row || Number(row.value) === 1, `the row is not see-through: ${JSON.stringify(row)}`);
  // the cost circle says "not yet" by its look, and keeps its number readable (no opacity on it either)
  assert.equal(winner('.lg-perk.later .lg-perk-cost', 'opacity'), null);
  assert.ok(winner('.lg-perk.later .lg-perk-cost', 'background') && winner('.lg-perk.later .lg-perk-cost', 'background').value !== '#FFFBEE',
    'a muted circle for a later perk');
  assert.equal(winner('.lg-perk-text span', 'color')?.value, 'var(--ink-700)');
  assert.equal(winner('.lg-perk-text small', 'color')?.value, 'var(--ink-500)');
  // the gate: an axe "incomplete" on text colour is measured on pixels (the gate missed every later row)
  const tool = fs.readFileSync(path.join(ROOT, 'tools', 'a11y-audit.mjs'), 'utf8');
  assert.match(tool, /resultTypes: \['violations', 'incomplete'\]/);
  assert.match(tool, /color-contrast-incomplete/);
});

// ---- P2-07: the Cow Barn's Sell says why ------------------------------------------------------------------------

test('P2-07: a ready animal\'s Sell says "Collect its Milk first", not "Already busy", EN and BG', async () => {
  const { animalsPanel } = await import('../public/js/ui/panels/animals.js');
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const cows = Object.keys(state.farm.objects).filter((k) => state.farm.objects[k].def === 'cow' && state.farm.objects[k].home === ids.cowBarn);
  assert.ok(cows.length, 'a cow in the barn');
  for (const c of cows) state.farm.objects[c].readyAt = T0 - MIN;
  for (const [l, text] of inLangs(() => {
    const { ctx, body } = ctxOf(state, { args: { id: ids.cowBarn }, now: T0 });
    animalsPanel.mount(body, ctx);
    const row = body.querySelector(`.pn-ani[data-animal="${cows[0]}"]`);
    const sell = [...row.querySelectorAll('.pn-act')].find((a) => /Sell|Продай/.test(textOf(a.button)));
    const why = textOf(sell.querySelector('.pn-why'));
    body.remove();
    return why;
  })) {
    assert.equal(text, l === 'en' ? 'Collect its Milk first' : 'Първо събери млякото', `${l}: ${text}`);
  }
});

// ---- P2-08: the week meter on a phone: the track on its own line when the row is short ---------------------------

test('P2-08: on a phone the week meter wraps and its track keeps room for three chests (22 px chests piled up)', async () => {
  assert.equal(winner('.pn-meter', 'flex-wrap', phone)?.value, 'wrap');
  const flex = winner('.pn-meter-track', 'flex', phone)?.value ?? '';
  const basis = Number(/(\d+)px/.exec(flex)?.[1]);
  // chests at 30, 60 and 100 % of the track, 22 px wide: 0.3 x basis >= 22 + a hair
  const { ORDERS } = await import('../shared/content/index.js');
  const at = ORDERS.meter.chests.map((c) => c.atBp / ORDERS.meter.chests.at(-1).atBp);
  const gap = Math.min(...at.slice(1).map((x, i) => x - at[i]));
  assert.ok(gap * basis >= 22 + 1, `the track wraps below ${basis} px: its chests ${Math.round(gap * basis)} px apart (22 px wide): ${flex}`);
  assert.match(flex, /^1 1 /, 'and grows to the row');
});

// ---- P2-C1 (carried P-10): the first Make never jumps when the first batch starts ------------------------------

test('P2-C1: an empty queue\'s strip is as wide as its slots, so the buy card wraps (or not) exactly like the busy row', async () => {
  const { buildingPanel } = await import('../public/js/ui/panels/building.js');
  const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
  const { ctx, body } = ctxOf(state, { args: { id: ids.kitchen } });
  buildingPanel.mount(body, ctx);
  const strip = body.querySelector('.pn-slot-strip');
  assert.ok(strip, 'the idle Kitchen shows the strip');
  const slots = state.farm.objects[ids.kitchen].slots ?? null;
  assert.ok(Number(strip.style.getPropertyValue?.('--n') ?? strip.style['--n']) >= 1, 'the strip knows how many slots it stands for');
  if (slots) assert.equal(Number(strip.style.getPropertyValue?.('--n') ?? strip.style['--n']), slots);
  const basis = winner('.pn-slot.pn-slot-strip', 'flex')?.value ?? '';
  assert.doesNotMatch(basis, /100%/, `the strip no longer takes a whole row of its own: ${basis}`);
  assert.match(basis, /var\(--n/, 'its width follows the slot count');
  body.remove();
});

// ---- P2-C2 (carried P-07): "pay more than the market" always says in what ---------------------------------------

test('P2-C2: no line says orders pay more than the market without "coins and XP" (EN sources and every catalog)', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'public/js/i18n/en')).map((f) => `public/js/i18n/en/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'public/js/i18n/bg')).map((f) => `public/js/i18n/bg/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'shared/content')).filter((f) => f.endsWith('.js')).map((f) => `shared/content/${f}`),
  ];
  const bad = [];
  for (const f of files) {
    for (const [i, line] of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').entries()) {
      if (/^\s*\/\//.test(line)) continue;
      for (const m of line.matchAll(/(pays? more than the (market|stand)|плащат повече от (пазара|сергията))[^.!?'"`]*/gi)) {
        if (!/XP|опит/.test(m[0])) bad.push(`${f}:${i + 1}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.match(TEXT.TUTORIAL['step.first_order'].text, /в монети и опит/);
  assert.match(TEXT.features.orders.card.text, /в монети и опит/);
});

// ---- F2-02 (features' patch): the Memory Book says a one-tap note in the reader's language -----------------------

test('F2-02: a Memory Book page with the one-tap note "#thanks" reads "Thank you ♥" / „Благодаря ти ♥“; a typed note as typed', async () => {
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  for (const [note, want] of [['#thanks', { en: '“Thank you ♥”', bg: '„Благодаря ти ♥“' }], ['for you', { en: '“for you”', bg: '„for you“' }]]) {
    const s = named(farmAt(40));
    give(s, 'rose', 1);
    const r = actOk(s, 'keepsake', { item: 'rose', note }, { pid: 'p2', now: T0 });
    actOk(s, 'openGift', { id: evs(r, 'keepsake')[0].id }, { pid: 'p1', now: T0 + MIN });
    for (const [l, text] of inLangs(() => {
      const { ctx, body } = ctxOf(s, { tab: 'memory', now: T0 + 2 * MIN });
      journalPanel.mount(body, ctx);
      const x = textOf(body.querySelector('.pn-mem-note'));
      body.remove();
      return x;
    })) {
      assert.equal(text, want[l], `${l} ${note}`);
    }
  }
});

// ---- S2-01 (ui-shell's patch): the windmill step says where the Windmill is, in Bulgarian too --------------------

test('S2-01: the Bulgarian flour step says to place the Windmill from Build (free), like the English source', () => {
  const text = TEXT.TUTORIAL['step.flour_together'].text;
  assert.match(text, /Строй/);
  assert.match(text, /безплатно/);
  assert.doesNotMatch(text, /пак работи/, 'not "it works again" (it was not on the farm)');
});

// ---- S2-15 (ui-shell's patch): reduced motion follows the player's pick in every panel sheet ---------------------

test('S2-15: each panel sheet\'s reduced-motion rule holds only until the player picks, and has its motion-reduced twin', () => {
  const mine = ['panels.css', 'panels-weekly.css', 'panels-collect.css', 'panels-league.css', 'panels-home.css', 'panels-w4.css', 'mobile-panels.css'];
  const own = rules(mine.map((f) => [f, cssOf(f)]));
  const reduce = own.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media));
  assert.ok(reduce.length >= 8, 'the sheets have reduced-motion rules');
  const twins = own.filter((r) => r.media === '').flatMap((r) => r.sel.split(',').map((s) => s.trim()))
    .filter((s) => s.startsWith('body.motion-reduced ')).map((s) => s.slice('body.motion-reduced '.length));
  for (const r of reduce) {
    for (const sel of r.sel.split(',').map((s) => s.trim())) {
      assert.ok(sel.startsWith('body:not(.motion-set) '), `${r.file}: "${sel}" must wait for the player's pick`);
      const bare = sel.slice('body:not(.motion-set) '.length);
      assert.ok(twins.includes(bare), `${r.file}: "${bare}" needs its body.motion-reduced twin`);
    }
  }
});

// ---- S2-05 (ui-shell's patch, defence in depth): the Market's own pick is never a whole big stack ----------------

test('S2-05: the stack the Market picks by itself offers at most 10; a stack the player taps or names offers all of it', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { state } = storyFarm({ now: T0, level: 12, players: ['p1', 'p2'] });
  for (const k of Object.keys(state.farm.inventory)) state.farm.inventory[k] = 0;
  state.farm.keep = {};
  state.farm.inventory.cabbage = 39;
  state.farm.inventory.wheat = 6;
  const label = (body) => textOf(body.querySelector('.pn-sell-btn .pn-btn-label'));
  const a = ctxOf(state);
  a.ctx.tab = 'sell';
  marketPanel.mount(a.body, a.ctx);
  const first = a.body.querySelector('.pn-stack.on').dataset.item;
  const big = first === 'cabbage';
  assert.match(label(a.body), big ? /^Sell 10$/ : /^Sell 6$/, `opened by itself: ${label(a.body)}`);
  // the player's own tap on the big stack: all of it
  a.body.querySelector('.pn-stack[data-item="cabbage"]').click();
  assert.match(label(a.body), /^Sell 39$/);
  a.body.remove();
  // named by the Barn's "Sell" (args.item): all of it
  const b = ctxOf(state, { args: { item: 'cabbage' } });
  b.ctx.tab = 'sell';
  marketPanel.mount(b.body, b.ctx);
  assert.match(label(b.body), /^Sell 39$/);
  b.body.remove();
});

test('S2-15 sibling: a panel\'s scroll to a card is instant when the player reduced motion, smooth otherwise', async () => {
  const { scrollBehavior } = await import('../public/js/ui/panels/kit.js');
  document.body.classList.remove('motion-reduced');
  assert.equal(scrollBehavior(), 'smooth');
  document.body.classList.add('motion-reduced');
  assert.equal(scrollBehavior(), 'auto');
  document.body.classList.remove('motion-reduced');
  const dir = path.join(ROOT, 'public/js/ui/panels');
  const left = fs.readdirSync(dir).filter((f) => /behavior: 'smooth'/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(left, [], 'every panel scroll asks scrollBehavior()');
});

test('P2-04 sibling: the Fair\'s entries keep their order while the sheet is open (a partner\'s sale moved "Enter" rows)', async () => {
  const { forceLiveForTests } = await import('../shared/rules/coop.js');
  const { FAIR } = await import('../shared/content/index.js');
  const { farmAt: farmAtR } = await import('./helpers/rules.js');
  const { must, sys, T0: T } = await import('./helpers.js');
  const { fairPanel } = await import('../public/js/ui/panels/fair.js');
  forceLiveForTests([FAIR]);
  const s = farmAtR(22);
  must(s, 'claimGift', {}, { pid: 'p1' });
  sys(s, '_fair', {});
  for (const [k, n] of [['cheese', 3], ['bread', 4]]) s.farm.inventory[k] = n;
  must(s, 'fairEnter', { item: 'cheese', qty: 1 }, { pid: 'p1', now: T });
  const { ctx, body } = ctxOf(s, { now: T });
  const inst = fairPanel.mount(body, ctx);
  const order = () => [...body.querySelectorAll('.wk-entry[data-item]')].map((e) => e.dataset.item);
  const before = order();
  assert.deepEqual(before, ['cheese', 'bread'], 'opened: what can be entered, the most points first');
  // the partner sells the rest of the cheese: it can no longer be entered (it sorted below the bread)
  s.farm.inventory.cheese = 0;
  inst.update();
  assert.deepEqual(order(), before, 'no row moved under the cursor');
  // a fresh open sorts again
  const b2 = ctxOf(s, { now: T });
  fairPanel.mount(b2.body, b2.ctx);
  assert.deepEqual([...b2.body.querySelectorAll('.wk-entry[data-item]')].map((e) => e.dataset.item), ['bread', 'cheese']);
  body.remove(); b2.body.remove();
});

test('P2-06 siblings (the gate\'s first pixel run): no see-through words on later, claimed or spare rows; darker number tabs', async () => {
  // a row or tab with words is never dimmed whole: its picture dims, its words keep their ink
  for (const sel of ['.lg-perk.later', '.pn-cal-day.done', '.pc-slot.spare', '.lg-hub-tab.locked']) {
    const o = winner(sel, 'opacity');
    assert.ok(!o || Number(o.value) === 1, `${sel} is see-through: ${JSON.stringify(o)}`);
  }
  assert.equal(winner('.pn-cal-day.done > :not(small)', 'opacity')?.value, '.55', 'a claimed day\'s picture still dims');
  assert.equal(winner('.pc-slot.spare .pc-slot-art', 'opacity')?.value, '.5');
  assert.equal(winner('.pn-tree-give small', 'color')?.value, 'var(--go-900)', 'go-700 on paper was 3.7:1');
  assert.match(winner('.lg-tier-n', 'background')?.value ?? '', /wood-700/, 'cream on wood-500 was 3.5:1');
  assert.match(String(winner('.fi-board > small', 'background')?.value), /rgba\(62, 38, 18/, 'a dark band under the planks\' line');
  assert.equal(winner('.pc-stamp', 'opacity'), null, 'the album stamp at full ink');
  // the town strip's "+18 more" stands outside the faded lot (inside its .5 group it was 2.5:1)
  const { villageStrip } = await import('../public/js/ui/panels/town.js');
  const svg = villageStrip([{ id: 'p1', name: 'A', status: 'built', n: 1 }], { more: 18 });
  const more = [...svg.querySelectorAll('text')].find((x) => /18/.test(textOf(x)));
  assert.ok(more, 'the "+18 more" label');
  assert.equal(more.parentNode.getAttribute?.('class') ?? null, 'wk-village', 'a child of the strip, not of the faded lot');
});

test('a11y gate (pixel pass): a rosette\'s letter is 4.5:1 or more on its own face, every tier', async () => {
  const { rosette } = await import('../public/js/ui/panels/art.js');
  const lum = (hex) => {
    const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const tier of [0, 1, 2, 3]) {
    const svg = rosette(tier, 64, 'B');
    const ink = svg.querySelector('text').getAttribute('fill');
    const face = [...svg.querySelectorAll('circle')].find((c) => c.getAttribute('r') === '17').getAttribute('fill');
    assert.ok(ratio(ink, face) >= 4.5, `tier ${tier}: ${ink} on ${face} is ${ratio(ink, face).toFixed(2)}:1`);
  }
});
