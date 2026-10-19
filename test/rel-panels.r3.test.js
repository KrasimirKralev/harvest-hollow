// Release 1.0, ui-panels lane, QA round 3 (docs/qa/release/qa-r3/fix-ui-panels.md): the DOM, copy and stylesheet half of
// each item and of its siblings. The layout half (focus ring pixels, rects, elementFromPoint) is proven by the browser
// runs in docs/qa/release/build/ui-panels/r3/ and by the two gates (a11y-audit's focus pass, i18n-shots' lone number).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom, textOf } from './ui-qa2-dom.js';
import { storyFarm } from './helpers/ui-panels.js';
import { T0 } from './helpers/rules-goals.js';
import { allAreas } from '../public/js/i18n/catalogs.js';
import * as I from '../public/js/i18n/index.js';
import { dayOf } from '../shared/rules/coop.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AREAS = await allAreas();
const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
await I.__loadForTest('bg');
I.__setForTest('en');
const inBg = (fn) => { I.__setForTest('bg', BG); try { return fn(); } finally { I.__setForTest('en'); } };
const inLangs = (fn) => [['en', fn()], ['bg', inBg(fn)]];
const NBSP = ' ';

/** A small event emitter store (the panels listen to 'fx'); acts and toasts are recorded. */
function ctxOf(state, { pid = 'p1', now = T0, args = {} } = {}) {
  const acts = [];
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
    name: 'x', args, store, body, el: body, now: () => now, tab: null,
    ui: { panels: { open: () => true, has: () => true, retitle() {}, badge() {} }, toast() {} },
    every: () => () => {}, subscribe: () => () => {},
    on(target, ev, fn) { if (target && typeof target.on === 'function') return target.on(ev, fn); target.addEventListener(ev, fn); return () => {}; },
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    open() {}, close() {}, setTitle(t) { ctx.title = t; }, refreshTabs() {},
    controller: { input: 'mouse', setTool() {}, do: (t, a) => { acts.push([t, a]); return { ok: true }; } },
  };
  return { ctx, body, acts };
}

// ---- stylesheets: every rule of the linked sheets as { file, media, sel, body, at }, in cascade order --------------
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const sheets = [...index.matchAll(/<link rel="stylesheet" href="\/css\/([\w-]+\.css)">/g)].map((m) => m[1]);
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const cssOf = (f) => strip(fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8'));
const ALL = [];
for (const file of sheets) {
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
          else ALL.push({ file, media, sel, body, at: ALL.length });
          start = i + 1;
        }
      }
    }
  };
  walk(cssOf(file), '');
}
const decl = (body, prop) => body.match(new RegExp(`(?:^|;|\\s|\\{)${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;
const PHONE = '@media (max-width: 600px), (max-height: 500px)';
const phone = (m) => m === '' || m === PHONE;
/** The last rule (cascade order) that lists `sel` exactly and sets `prop`: { value, at } or null. */
function winner(sel, prop, mediaOk = (m) => m === '') {
  let win = null;
  for (const r of ALL) {
    if (!mediaOk(r.media) || !r.sel.split(',').map((s) => s.trim()).includes(sel)) continue;
    const v = decl(r.body, prop);
    if (v !== null) win = { file: r.file, value: v, at: r.at };
  }
  return win;
}
const rulesWith = (sel) => ALL.filter((r) => r.media === '' && r.sel.split(',').map((s) => s.trim()).includes(sel));

// ---- P3-01: a keyboard focus on a land parcel that can be seen, and that is not the selection ---------------------

test('P3-01: Market › Land: a focused parcel draws an ink ring wider than the sky-blue selection; hover keeps the brightening', () => {
  const sel = winner('.pn-parcel.sel', 'stroke');
  const focus = winner('.pn-parcel[role="button"]:focus-visible', 'stroke');
  assert.ok(focus, 'a :focus-visible rule that draws a stroke on the parcel');
  assert.equal(focus.value, 'var(--ink-900)');
  assert.notEqual(focus.value, sel.value, 'the focus ring is not the selection\'s colour');
  assert.ok(parseFloat(winner('.pn-parcel[role="button"]:focus-visible', 'stroke-width').value) > parseFloat(winner('.pn-parcel.sel', 'stroke-width').value),
    'wider than the selection');
  assert.equal(winner('.pn-parcel[role="button"]:focus-visible', 'stroke-dasharray')?.value, 'none', 'never dashed like the for-sale edge');
  // a parcel of several pieces rings its outline path
  assert.equal(winner('g.pn-parcel[role="button"]:focus-visible .pn-parcel-edge', 'stroke')?.value, 'var(--ink-900)');
  // the hover brightening is the hover's alone (it was the focus style too: 1.19:1 on pixels)
  for (const r of rulesWith('.pn-parcel[role="button"]:focus-visible')) assert.equal(decl(r.body, 'filter'), null, `the focus is not a filter: ${r.sel}`);
  assert.match(String(winner('.pn-parcel[role="button"]:hover', 'filter')?.value), /brightness/);
});

test('P3-01 siblings: the Farm book\'s land map and the farmhouse plan show the focus on a SELECTED shape too', () => {
  // land map: the focus rule used to come before `.sel` with the same specificity, so a focused selected parcel showed
  // the selection alone
  const sel = winner('.ha-parcel.sel .ha-edge', 'stroke');
  const focus = winner('.ha-parcel:focus-visible .ha-edge', 'stroke');
  assert.ok(focus.at > sel.at, 'the focus rule comes after the selection rule');
  assert.equal(focus.value, 'var(--ink-900)', 'one focus ring with Market › Land');
  assert.notEqual(focus.value, sel.value);
  assert.ok(parseFloat(winner('.ha-parcel:focus-visible .ha-edge', 'stroke-width').value) > parseFloat(winner('.ha-parcel.sel .ha-edge', 'stroke-width').value));
  // farmhouse: focus and selection drew the very same glow
  const pSel = winner('.ha-piece.sel > g', 'filter');
  const pFocus = winner('.ha-piece:focus-visible > g', 'filter');
  assert.ok(pFocus.at > pSel.at, 'the piece\'s focus rule wins over its selection');
  assert.notEqual(pFocus.value, pSel.value, 'a focused selected piece looks different from a selected one');
  assert.match(pFocus.value, /ink-900/);
});

// ---- P3-02: "New recipe" never covers the recipe's icon -----------------------------------------------------------

test('P3-02: "New recipe" is a tag in the recipe\'s top row (in place of its empty stars), not a ribbon on its icon', async () => {
  const { buildingPanel } = await import('../public/js/ui/panels/building.js');
  for (const [l, got] of inLangs(() => {
    const { state, ids } = storyFarm({ now: T0, level: 9, players: ['p1', 'p2'] });
    const { ctx, body } = ctxOf(state, { args: { id: ids.bakery } });
    buildingPanel.mount(body, ctx);
    const cards = [...body.querySelectorAll('.pn-recipe')];
    const tried = cards.filter((c) => c.querySelector('.pn-try'));
    const r = {
      n: tried.length,
      onArt: body.querySelectorAll('.pn-recipe-art .pn-ribbon').length,
      inTop: tried.filter((c) => c.querySelector('.pn-ribbon.pn-try').parentNode.classList.contains('pn-recipe-top')).length,
      starsToo: tried.filter((c) => c.querySelector('.pn-recipe-stars')).length,
      text: tried.map((c) => textOf(c.querySelector('.pn-try'))),
      starsElsewhere: cards.filter((c) => !c.querySelector('.pn-try')).every((c) => c.querySelector('.pn-recipe-top .pn-recipe-stars')),
    };
    body.remove();
    return r;
  })) {
    assert.ok(got.n >= 1, `${l}: the story farm's bakery has a never-made recipe`);
    assert.equal(got.onArt, 0, `${l}: no ribbon over the recipe's art`);
    assert.equal(got.inTop, got.n, `${l}: every "New recipe" sits in the top row`);
    assert.equal(got.starsToo, 0, `${l}: a never-made recipe shows the tag, not three empty stars`);
    assert.ok(got.starsElsewhere, `${l}: a recipe made before keeps its stars`);
    for (const x of got.text) assert.equal(x, l === 'en' ? 'New recipe' : 'Нова рецепта');
  }
  // in flow and on one line; the fold triangle of an edge ribbon is not drawn in a row
  assert.equal(winner('.pn-recipe-top .pn-ribbon', 'position')?.value, 'static');
  assert.equal(winner('.pn-recipe-top .pn-ribbon', 'white-space')?.value, 'nowrap');
  assert.equal(winner('.pn-recipe-top .pn-ribbon::before', 'display')?.value, 'none');
});

// ---- P3-03: one free new order on the board, one row layout ------------------------------------------------------

/** The story farm with slots 0-2 waiting (5, 15 and 10 minutes left) and the day's free new order in `rush`. */
function waitingBoard(rush) {
  const { state } = storyFarm({ now: T0, level: 9 });
  const slots = state.farm.orders.slots;
  const keys = Object.keys(slots).map(Number).sort((a, b) => a - b);
  assert.ok(keys.length >= 3, 'three order slots at level 9');
  const left = [5, 15, 10];
  keys.slice(0, 3).forEach((k, i) => { slots[k] = { ...slots[k], order: null, availableAt: T0 + left[i] * 60_000 }; });
  if (rush === 'unused') delete state.farm.orders.rush;
  else state.farm.orders.rush = { d: dayOf(state, T0), n: 1 };
  return { state, longest: keys[1] };
}

test('P3-03: with three empty slots and the free order unused, exactly one row offers it: the slot that waits longest', async () => {
  const { ordersPanel } = await import('../public/js/ui/panels/orders.js');
  for (const [l, got] of inLangs(() => {
    const { state, longest } = waitingBoard('unused');
    const { ctx, body } = ctxOf(state);
    ordersPanel.mount(body, ctx);
    const rows = [...body.querySelectorAll('.pn-order-wait')];
    const r = { rows: rows.length, free: rows.filter((x) => /free|безплатно/.test(textOf(x))).map((x) => Number(x.dataset.slot)),
      buttons: rows.filter((x) => x.querySelector('[data-rush]')).map((x) => Number(x.dataset.slot)), longest,
      priced: rows.filter((x) => /Acorn|жълъд/.test(textOf(x))).length };
    body.remove();
    return r;
  })) {
    assert.equal(got.rows, 3, `${l}: three waiting rows`);
    assert.deepEqual(got.free, [got.longest], `${l}: one free offer, on the slot with the longest wait`);
    // the rules grant the first rush of the day free whichever slot it is: a price on another row would be false
    assert.deepEqual(got.buttons, [got.longest], `${l}: the other rows offer no button while the free one is unused`);
    assert.equal(got.priced, 0, `${l}: no acorn price while the day's free one is unused`);
  }
});

test('P3-03: once the day\'s free order is used, every waiting row offers its acorn price and none says free', async () => {
  const { ordersPanel } = await import('../public/js/ui/panels/orders.js');
  const { state } = waitingBoard('used');
  const { ctx, body, acts } = ctxOf(state);
  ordersPanel.mount(body, ctx);
  const rows = [...body.querySelectorAll('.pn-order-wait')];
  assert.equal(rows.length, 3);
  for (const x of rows) {
    assert.match(textOf(x.querySelector('[data-rush]')), /^Now \(1 Acorn\)$/);
    assert.doesNotMatch(textOf(x), /free/);
  }
  rows[2].querySelector('[data-rush]').click();
  assert.deepEqual(acts.at(-1), ['orderRush', { slot: Number(rows[2].dataset.slot) }], 'the button rushes its own slot');
  body.remove();
});

test('P3-03: on a phone every waiting row has one layout: words on line 1, the timer and the button on line 2', () => {
  assert.equal(winner('.pn-order-wait', 'display', phone)?.value, 'grid');
  assert.equal(winner('.pn-order-wait > p', 'grid-row', phone)?.value, '1');
  assert.equal(winner('.pn-order-wait > .pn-timer', 'grid-row', phone)?.value, '2');
  assert.equal(winner('.pn-order-wait > .pn-act', 'grid-row', phone)?.value, '2');
  assert.equal(winner('.pn-order-wait > .pn-timer', 'white-space', phone)?.value, 'nowrap', 'a timer never breaks inside');
  // the flex-wrap that let a wide timer move the button is gone from the waiting row
  for (const r of ALL.filter((x) => phone(x.media) && x.sel.split(',').map((s) => s.trim()).some((s) => /^\.pn-order-wait p$/.test(s)))) {
    assert.equal(decl(r.body, 'flex'), null, `no flex basis on the row's words: ${r.sel}`);
  }
});

// ---- P3-04 / P3-05: a count never stands alone on its own line --------------------------------------------------

const OTHERS = new Set(['harness', 'front', 'dock', 'cheer', 'feat', 'boot']);
/** Every string of the catalogs ui-panels owns, EN and BG, as [area, key, text] (plural forms flattened). */
async function ownStrings() {
  const out = [];
  for (const [area, en, load] of AREAS) {
    if (OTHERS.has(area)) continue;
    const bg = (await load()).default;
    for (const [lang, cat] of [['en', en], ['bg', bg]]) {
      for (const [k, v] of Object.entries(cat)) {
        for (const s of typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).filter((x) => typeof x === 'string') : []) out.push([`${lang}/${area}`, k, s]);
      }
    }
  }
  return out;
}

test('P3-04: a workshop\'s ready line keeps its count with its words ("готови: 12" never splits), EN and BG', () => {
  const en = I.t('farm.bld.ready', { name: 'Livestock Feed', n: 12 });
  const bg = inBg(() => I.t('farm.bld.ready', { name: 'Фураж за добитък', n: 12 }));
  assert.equal(en, `Livestock Feed ready:${NBSP}12`);
  // QA r4 P4-02 reverses r3's break: the line breaks after "Фураж за добитък ·" (a second line that started with the dot,
  // "· готови: 12", read worse than a dot at a line's end); the count still never leaves its word
  assert.equal(bg, `Фураж за добитък${NBSP}· готови:${NBSP}12`);
});

test('P3-04 lint: no label count ends "…: {n}" with a breaking space (it left "12" alone on a line)', async () => {
  const bad = (await ownStrings()).filter(([, , s]) => /: \{n\}$/.test(s)).map(([a, k, s]) => `${a} ${k}: ${s}`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('P3-05: the Ribbon Track\'s "15 034 XP to tier 1" keeps the tier number with its word, EN and BG', () => {
  assert.equal(I.t('league.track.toNext', { xp: 15034, n: 1 }).endsWith(`tier${NBSP}1`), true);
  assert.equal(inBg(() => I.t('league.track.toNext', { xp: 15034, n: 1 })).endsWith(`стъпка${NBSP}1`), true);
});

test('P3-05 sibling lint: a multiplier is glued to its noun ("златни семена ×5", "всякакво зърно ×3" left "×5" alone)', async () => {
  const bad = (await ownStrings()).filter(([, , s]) => / ×\{/.test(s)).map(([a, k, s]) => `${a} ${k}: ${s}`);
  assert.deepEqual(bad, [], bad.join('\n'));
  assert.equal(inBg(() => I.t('league.rw.goldenOne', { n: 5 })), `златни семена${NBSP}×5`);
});

// ---- P3-06: the Wish button is never under the tray ribbon -----------------------------------------------------

test('P3-06: the Wish button draws above any ribbon, and a card with one puts its "in your tray" ribbon at the art\'s foot', () => {
  const ribbonZ = Number(winner('.pn-ribbon', 'z-index')?.value);
  assert.ok(Number(winner('.pn-wishbtn', 'z-index')?.value) > ribbonZ, 'above the ribbon (it had no z-index: the ribbon took the clicks)');
  const tray = '.pn-card-art:has(> .pn-wishbtn) > .pn-ribbon.pn-free-tag';
  assert.equal(winner(tray, 'top')?.value, 'auto');
  assert.ok(winner(tray, 'bottom'), 'moved to the foot of the art');
});

test('P3-06: in Market › Decor the tray ribbon and the Wish button are siblings in the card\'s art (the rule above matches)', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { state } = storyFarm({ now: T0, level: 12, players: ['p1', 'p2'] });
  // a Dirt Path waiting in the build tray, as on the owners' farm ("2 in your tray")
  state.farm.storage = { ...(state.farm.storage ?? {}), dirt_path: 2 };
  const { ctx, body } = ctxOf(state, { args: { tab: 'decor' } });
  ctx.tab = 'decor';
  marketPanel.mount(body, ctx);
  const card = [...body.querySelectorAll('.pn-card')].find((c) => c.querySelector('.pn-free-tag'));
  assert.ok(card, 'a decor card with a tray ribbon');
  const art = card.querySelector('.pn-card-art');
  assert.equal(art.querySelector('.pn-wishbtn')?.parentNode, art, 'the Wish button is a child of the art');
  assert.equal(art.querySelector('.pn-ribbon.pn-free-tag')?.parentNode, art, 'and so is the tray ribbon');
  body.remove();
});

// ---- patches other lanes' QA r3 items send ui-panels -------------------------------------------------------------

const tick = () => new Promise((r) => setTimeout(r, 5));

test('F3-06 (features): the Journal rings the letter named by args.focus, on Letters and on Together (h1)', async () => {
  const { journalPanel } = await import('../public/js/ui/panels/journal.js');
  for (const [tab, quest] of [['story', 'c2'], ['stats', 'h1']]) {
    const { state } = storyFarm({ now: T0, level: 9 });
    const { ctx, body } = ctxOf(state, { args: { tab, focus: quest } });
    ctx.tab = tab;
    journalPanel.mount(body, ctx);
    await tick();
    const card = body.querySelector(`[data-quest="${quest}"]`);
    assert.ok(card, `${tab}: the letter of ${quest} is on this tab`);
    assert.ok(card.classList.contains('pn-focus-ring'), `${tab}: ${quest} is ringed`);
    body.remove();
  }
});

test('S3-16 (ui-shell): the Market quantity field names its Sell button; the animal name field names none', async () => {
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const { animalsPanel } = await import('../public/js/ui/panels/animals.js');
  const { state, ids } = storyFarm({ now: T0, level: 12, players: ['p1', 'p2'] });
  const a = ctxOf(state, { args: { item: 'wheat' } });
  a.ctx.tab = 'sell';
  marketPanel.mount(a.body, a.ctx);
  const num = a.body.querySelector('.pn-slip .pn-num');
  assert.equal(num?.dataset.keepInView, 'sell');
  const sell = a.body.querySelector('.pn-sell-btn');
  assert.equal(sell?.dataset.act, 'sell', 'data-act="sell" on the Sell button');
  a.body.remove();
  const b = ctxOf(state, { args: { id: ids.cowBarn } });
  animalsPanel.mount(b.body, b.ctx);
  const pencil = b.body.querySelector('.pn-name');
  assert.ok(pencil, 'an animal to name');
  pencil.click();
  assert.equal(b.body.querySelector('.pn-name-input')?.dataset.keepInView, 'none');
  b.body.remove();
});

test('L3-02 (life-feel): the recap\'s workshop line has an English singular; EN and BG say the same thing', () => {
  assert.equal(I.t('moments.recap.trays', { n: 1 }), '1 workshop with goods ready');
  assert.equal(I.t('moments.recap.trays', { n: 3 }), '3 workshops with goods ready');
  assert.equal(inBg(() => I.t('moments.recap.trays', { n: 1 })), '1 работилница с готова стока');
  // the sibling life-feel filed (Cross-lane 1): "1 trees full of fruit"
  assert.equal(I.t('moments.recap.trees', { n: 1 }), '1 tree full of fruit');
  assert.equal(I.t('moments.recap.trees', { n: 4 }), '4 trees full of fruit');
});

test('F3-08 (features): the touch pings tip names the Farm book\'s Together page, not a "Menu" 1.0 does not have', () => {
  const en = I.t('moments.touch.pings');
  const bg = inBg(() => I.t('moments.touch.pings'));
  assert.match(en, /^Farm book › Together › Ping, /);
  assert.match(bg, /^Книжка › Заедно › Посочи, /);
  assert.doesNotMatch(`${en} ${bg}`, /Menu|Меню/);
});

test('F3-09 (features): the Bulgarian first workshop tip says the queue rule, like the English source', async () => {
  const TEXT = (await import('../public/js/i18n/bg/text.js')).default;
  const tip = TEXT.TUTORIAL['firstUse.building_panel'].text;
  assert.equal(tip, 'Прави по едно нещо, поред. Повече места – по‑дълга опашка.');
  assert.doesNotMatch(tip, /наведнъж/, 'never "more at once"');
  assert.ok(!inBg(() => I.t('farm.bld.idleSub')).includes(tip), 'M28: not a repeat of the panel line');
});

test('S3-21 (ui-shell, features): the Bulgarian duel winner reads the crown in the second person, the partner in the third', async () => {
  const { duelEndLine } = await import('../public/js/game/m2-moments.js');
  const { createFarm } = await import('../shared/rules/state.js');
  const s = createFarm(7, T0);
  s.players.p1 = { ...s.players.p1, name: 'Ана' };
  s.players.p2 = { ...(s.players.p2 ?? s.players.p1), name: 'Бо' };
  const ev = { e: 'duelEnded', scored: true, win: 'p1', kind: 'orders' };
  const mine = inBg(() => duelEndLine(s, ev, 'p1'));
  // HEAD and before this line: "Ана спечели: Надбягване с поръчки! Короната е за Ана цяла седмица." on her own screen
  assert.equal(mine, 'Ти спечели: Надбягване с поръчки! Короната е твоя цяла седмица.');
  assert.doesNotMatch(mine, /Ана|You win/);
  assert.equal(inBg(() => duelEndLine(s, ev, 'p2')), 'Ана спечели: Надбягване с поръчки! Короната е за Ана цяла седмица.');
});

test('P3-04/P3-05 siblings the P7 gate found at 360 BG: "място за 920", "трябват още 2", "20 × Ябълка" keep the number with its words', async () => {
  // i18n-shots on the owners' late save, 360 BG: "Подобрение 6: място за" / "920" (Barn upgrades), "трябват още" / "2"
  // (a workshop's missing input), "20 ×" / "Ябълка" (the Barge's loaded crate)
  assert.equal(inBg(() => I.t('market.ladder.next', { n: 6, cap: 920 })), `Подобрение 6: място за${NBSP}920`);
  assert.equal(I.t('market.ladder.next', { n: 6, cap: 920 }), `Upgrade 6: room for${NBSP}920`);
  assert.equal(inBg(() => I.t('farm.bld.needMore', { n: 2 })), `трябват още${NBSP}2`);
  assert.equal(inBg(() => I.t('farm.bld.needMore', { n: 1 })), `трябва още${NBSP}1`);
  // the code that writes "N × name" or "name ×N" itself (a fallback with no catalog entry, a crate, a Fair entry)
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'public/js/ui/panels')).filter((x) => x.endsWith('.js'))) {
    fs.readFileSync(path.join(ROOT, 'public/js/ui/panels', f), 'utf8').split('\n').forEach((line, i) => {
      if (/\} × \$\{|[\w}'`] ×\$\{|` ×\$\{/.test(line) && !/^\s*\/\//.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('P3-04 sibling the P7 gate found (fresh farm, 360 BG): the Nursery / Breeding switch keeps "Ниво 28" on one line', () => {
  // the lock note under a switch button read "Ниво" / "28" in a button too narrow for both; it now keeps its words
  // together and moves under the label when the button cannot hold both on one row
  assert.equal(winner('.br-switch-btn small', 'white-space')?.value, 'nowrap');
  assert.equal(winner('.br-switch-btn', 'flex-wrap')?.value, 'wrap');
});

test('P3-04/P3-05 siblings the P7 gate found in EN at 360 and BG on iPhone 13: a trailing number keeps its word; panels wrap "pretty"', () => {
  // "Expansion 4 of 7 · from level" / "17" (land map), "Restoration 6, from level" / "34." (farmhouse), "… Masterwork" /
  // "×1.5 / ×2" (beauty), "… хамбар побира" / "1400" (Barn upgrades)
  const end = (s, tail) => assert.ok(s.endsWith(tail), `${JSON.stringify(s)} ends ${JSON.stringify(tail)}`);
  end(I.t('farm.map.expansionOf', { k: 4, total: 7, n: 17 }), `level${NBSP}17`);
  end(inBg(() => I.t('farm.map.expansionOf', { k: 4, total: 7, n: 17 })), `ниво${NBSP}17`);
  end(I.t('home.fh.lockFrom', { n: 34 }), `level${NBSP}34.`);
  end(inBg(() => I.t('home.fh.lockFrom', { n: 34 })), `ниво${NBSP}34.`);
  end(I.t('collect.beauty.partTip.decor', { n: 1 }), `Masterwork${NBSP}×1.5${NBSP}/${NBSP}×2`);
  end(inBg(() => I.t('collect.beauty.partTip.decor', { n: 1 })), `шедьовър${NBSP}×1,5${NBSP}/${NBSP}×2`);
  end(I.t('market.ladder.of', { n: 5, max: 10, top: 1400 }), `holds${NBSP}1,400`);
  end(inBg(() => I.t('market.ladder.of', { n: 5, max: 10, top: 1400 })), `побира${NBSP}1400`);
  // and for the strings nobody has seen yet: a short last word moves down with the one before it (Chrome 117+, Safari 26+);
  // the no-break spaces above stay for older browsers
  assert.equal(winner('.hh-panel-body', 'text-wrap')?.value, 'pretty');
});

test('P3-05 sibling the P7 gate found on desktop BG: Masterwork\'s "красота 27" keeps its number', () => {
  // Decor sets › Masterwork: "Шедьовър: красота" / "27" in the next-level column of every row
  assert.equal(inBg(() => I.t('collect.sets.beauty', { b: 27 })), `красота${NBSP}27`);
  assert.equal(I.t('collect.sets.beauty', { b: 27 }), `beauty${NBSP}27`);
});
