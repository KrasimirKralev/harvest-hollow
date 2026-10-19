// QA r3 (docs/qa/release/qa-r3/fix-harvey.md), the helper's screens against a stand-in shell and a scripted server:
//   H3-01 a status answer that comes back after a wrong sign-in code (or a `signed_out` push) never wipes the error line
//   H3-02 a letter waits while the coach speaks, and a farmer who joined after the change finds it on Ask, not as a sheet
//   H3-03 the changes-ready pop-up never opens by itself under a held pointer, a stroke or an open menu
//   H3-04 History's chips word the sky, the music and the speed knobs as the ready sheet does (never "sky", "growTimeBp")
//   H3-05 History offers no "Bring back" for a change that cannot come back; an undo says what came back into the shop
//   H3-06 the pill's "1–3 min" never breaks across two lines
//   H3-07 the change list's sell price is the farm's own (the upgraded Market Stand's 1 % included)
//   H3-08 after signing in from Ask's "Sign in first" with no wish typed, the tab is Ask again
// RED on a328923: each item's first failing line is in the fix list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './ui-qa2-dom.js';
import { memStorage, textOf, tick, click, sleep, fakeWin, jobOf, VALID, page as pageOf, fakeApi } from './helpers/harvey.js';

globalThis.location = { pathname: '/', origin: 'http://localhost:4500', protocol: 'http:', host: 'localhost:4500', search: '', hash: '', reload() {}, assign() {} };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();

let H;
let M;
let I;
before(async () => {
  H = await import('../public/js/ui/harness/index.js');
  M = await import('../public/js/ui/harness/model.js');
  I = await import('../public/js/i18n/index.js');
  await import('../public/js/i18n/harness.js');
});
after(async () => { await I.setLang('en'); });
const page = (o) => pageOf(H, o);
const ok = (data) => ({ ok: true, status: 200, data });
const stateWith = (o = {}) => () => ok({ enabled: true, providers: [{ id: 'mock', available: true, signedIn: true, account: { label: 'test' } }],
  job: null, active: { n: 2, hash: 'h2', appliedAt: 1_000, by: 'p1', title: { en: 'Moonlight' } }, consent: { telemetry: true, sending: false }, limits: {}, ...o });
const READY = (o = {}) => jobOf({ state: 'ready', step: 'ready', updatedAt: 10, result: { candidate: 3, summary: { en: 'A moon melon.' }, changes: [], validation: VALID }, ...o });
const isOpen = (p, n) => p.shell.panels.isOpen(n);

// ---- H3-01 -----------------------------------------------------------------------------------------------------------
for (const prov of ['claude', 'chatgpt']) {
  test(`H3-01 (${prov}): a status answer that left before a wrong code never wipes the error line; nor does a signed_out push`, async () => {
    await I.setLang('en');
    let release = null;
    const held = new Promise((r) => { release = r; });
    let polls = 0;
    const api = fakeApi({
      state: stateWith({ providers: [{ id: prov, available: true, signedIn: false }], active: null }),
      signIn: (p) => ok({ signin: { provider: p, state: 'pending', step: { kind: 'open_url', url: `https://${p}.example/oauth?x=1`, expiresAt: 9e12 } } }),
      // the poll that is in flight when the wrong code goes out: the server's slow `auth status` answers after it
      signInStatus: async (p) => { polls += 1; await held; return ok({ signin: { provider: p, state: 'signed_out' } }); },
      signInContinue: (p) => ok({ signin: { provider: p, state: 'error', error: { code: 'BAD_CODE' } } }),
    });
    const p = await page({ api, opts: { signInPollMs: 5 } });
    p.helper.open('accounts');
    await tick();
    const body = () => p.shell.body('helper');
    click(body().querySelector(`[data-provider="${prov}"] [data-act="signin"]`));
    await tick();
    for (let i = 0; i < 50 && !polls; i++) await sleep(5);
    assert.ok(polls >= 1, 'a status poll is in flight');
    const input = body().querySelector(`#hx-paste-${prov}`);
    assert.ok(input, 'the paste field is there');
    input.value = prov === 'chatgpt' ? 'http://localhost:1455/auth/callback?code=bad' : 'bad-code';
    click(body().querySelector(`[data-signin="${prov}"] [data-act="continue"]`));
    await tick();
    const wrong = I.t('harness.err.BAD_CODE');
    assert.match(textOf(body()), new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the wrong code is said');
    // the older poll answers now: the error and "Start again" stay (the card did reset to "Sign in")
    release();
    await sleep(40);
    assert.ok(body().querySelector(`[data-signin="${prov}"] [data-act="restart"]`), 'the card still offers "Start again"');
    assert.match(textOf(body()), new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the error line is still there');
    // the server's own `signed_out` push after the login ended keeps the error too
    p.helper.receive({ t: 'hx', e: 'signin', provider: prov, state: 'signed_out' });
    await tick();
    assert.ok(body().querySelector(`[data-signin="${prov}"] [data-act="restart"]`), 'a signed_out push keeps the error card');
    p.helper.destroy();
  });
}

// ---- H3-02 -----------------------------------------------------------------------------------------------------------
const LETTER = { id: 'l_moon', from: 'mabel', art: 'farmhouse', en: { title: 'Melons by moonlight', body: 'Dear farmers.' },
  bg: { title: 'Пъпеши под луната', body: 'Мили фермери.' } };
const lettered = () => ({ installedOverlay: () => ({ n: 2, text: { letters: [LETTER] } }) });

test('H3-02: a farmer who joined after the change was applied gets no letter sheet; the letter waits, quiet, on Ask', async () => {
  await I.setLang('en');
  const win = fakeWin();
  // the change was applied at 1,000; this farmer joined at the farm's now (a brand-new partner on the invite path)
  const p = await page({ pid: 'p2', win, overlayApi: lettered(), api: fakeApi({ state: stateWith() }), opts: { settleMs: 20, idlePollMs: 5 },
    before: ({ store }) => { store.state.players.p2.joinedAt = store.now(); } });
  await sleep(40);
  assert.equal(isOpen(p, 'helper-letter'), false, 'no letter over the new farmer\'s first screen');
  p.helper.receive({ t: 'hx', e: 'content', n: 2, changed: true, text: { letters: [LETTER] } });
  await sleep(40);
  assert.equal(isOpen(p, 'helper-letter'), false, 'a content push does not open it either');
  assert.equal(p.shell.opened.filter(([n]) => n === 'helper-letter').length, 0);
  // Harvey's Ask tab says there is a letter, and opens it on a press
  p.helper.open('ask');
  await tick();
  const row = p.shell.body('helper').querySelector('.hx-letters');
  assert.ok(row, 'the Ask tab lists the waiting letter');
  assert.match(textOf(row), /Melons by moonlight/);
  click(row.querySelector('[data-act="readLetter"]'));
  await tick();
  assert.ok(isOpen(p, 'helper-letter'), 'a press opens it');
  click(p.shell.body('helper-letter').querySelector('[data-act="ok"]'));
  await tick();
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('hh.harness.letters')).p2, ['l_moon'], 'read once its OK is pressed');
  p.helper.destroy();
});

test('H3-02: a letter waits while the coach speaks, and comes once the coach is done', async () => {
  await I.setLang('en');
  const win = fakeWin();
  let coach = true;
  const p = await page({ win, overlayApi: lettered(), api: fakeApi({ state: stateWith() }), S: { tutorial: { active: () => coach } },
    opts: { settleMs: 20, idlePollMs: 5 }, before: ({ store }) => { store.state.players.p1.joinedAt = 0; } });
  await sleep(40);
  assert.equal(isOpen(p, 'helper-letter'), false, 'the coach card comes first: no letter while the coach speaks');
  p.helper.receive({ t: 'hx', e: 'content', n: 2, changed: true, text: { letters: [LETTER] } });
  await sleep(40);
  assert.equal(isOpen(p, 'helper-letter'), false, 'nor at the next content push');
  coach = false;
  win.fire('hh:coach', { detail: { visible: false, step: null } });
  await sleep(60);
  assert.ok(isOpen(p, 'helper-letter'), 'the letter comes once the coach is done');
  p.helper.destroy();
});

// ---- H3-03 -----------------------------------------------------------------------------------------------------------
test('H3-03: a ready round during a held stroke opens nothing until the pointer lifts and the settle time passes', async () => {
  await I.setLang('en');
  const win = fakeWin();
  const p = await page({ win, opts: { settleMs: 60, idlePollMs: 5 } });
  const world = document.createElement('canvas');
  world.id = 'world';
  document.body.append(world);
  win.fire('pointerdown', { target: world, pointerId: 1, button: 0 });
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  await sleep(30);
  assert.equal(isOpen(p, 'helper-ready'), false, 'nothing opens under a held pointer');
  assert.equal(p.$('.hx-pill').hidden, false, 'the pill says the changes are ready');
  win.fire('pointerup', { target: world, pointerId: 1, button: 0 });
  await sleep(15);
  assert.equal(isOpen(p, 'helper-ready'), false, 'not at once after the pointer lifts');
  await sleep(120);
  assert.ok(isOpen(p, 'helper-ready'), 'it opens once the hand rested');
  p.helper.destroy();
});

test('H3-03: a stroke in progress (controller.stroke) holds the pop-up too', async () => {
  await I.setLang('en');
  const controller = { stroke: { verb: 'plant', count: 11, item: 'wheat' } };
  const p = await page({ win: fakeWin(), S: { controller }, opts: { settleMs: 20, idlePollMs: 5 } });
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  await sleep(30);
  assert.equal(isOpen(p, 'helper-ready'), false);
  controller.stroke = null;
  await sleep(60);
  assert.ok(isOpen(p, 'helper-ready'));
  p.helper.destroy();
});

for (const [sel, make] of [
  ['.edge-menu', () => { const m = document.createElement('div'); m.classList.add('edge-menu'); return m; }],
  ['#tools-flyout', () => { const m = document.createElement('div'); m.id = 'tools-flyout'; return m; }],
  ['#seed-tray', () => { const m = document.createElement('div'); m.id = 'seed-tray'; return m; }],
  ['#together-menu', () => { const m = document.createElement('div'); m.id = 'together-menu'; return m; }],
]) {
  test(`H3-03: with ${sel} open the pop-up waits until it closes`, async () => {
    await I.setLang('en');
    const p = await page({ win: fakeWin(), opts: { settleMs: 20, idlePollMs: 5 } });
    const menu = make();
    document.body.append(menu);
    menu.hidden = false;
    p.helper.receive({ t: 'hx', e: 'job', job: READY() });
    await sleep(40);
    assert.equal(isOpen(p, 'helper-ready'), false, `nothing over ${sel}`);
    menu.hidden = true;
    await sleep(60);
    assert.ok(isOpen(p, 'helper-ready'), `it opens once ${sel} closed`);
    p.helper.destroy();
  });
}

test('H3-03: an idle player still gets the pop-up at once; a press on the pill always opens it', async () => {
  await I.setLang('en');
  const p = await page({ win: fakeWin(), opts: { settleMs: 20, idlePollMs: 5 } });
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  assert.ok(isOpen(p, 'helper-ready'), 'nothing held: it opens as before');
  p.helper.destroy();
  const menu = document.createElement('div');
  menu.classList.add('edge-menu');
  const q = await page({ win: fakeWin(), opts: { settleMs: 20, idlePollMs: 5 } });
  document.body.append(menu);
  q.helper.receive({ t: 'hx', e: 'job', job: READY() });
  await tick();
  assert.equal(isOpen(q, 'helper-ready'), false);
  click(q.$('.hx-pill-main'));
  await tick();
  assert.ok(isOpen(q, 'helper-ready'), 'the player asked: it opens');
  q.helper.destroy();
});

test('H3-03: the coach never holds the answer to the farmer\'s own wish, nor their own change\'s letter', async () => {
  await I.setLang('en');
  const p = await page({ win: fakeWin(), S: { tutorial: { active: () => true } }, opts: { settleMs: 20, idlePollMs: 5 },
    before: ({ store }) => { store.state.players.p1.joinedAt = 0; } });
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  assert.ok(isOpen(p, 'helper-ready'), 'a new farmer\'s ready changes open while the coach speaks');
  // they apply: the letter their change brought follows, the coach notwithstanding
  click(p.shell.body('helper-ready').querySelector('[data-act="apply"]'));
  await tick();
  p.helper.receive({ t: 'hx', e: 'content', n: 3, changed: true, text: { letters: [LETTER] } });
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, title: { en: 'Moonlight' }, names: [] });
  await sleep(40);
  assert.ok(isOpen(p, 'helper-letter'), 'their own change\'s letter');
  p.helper.destroy();
});

// ---- H3-04 -----------------------------------------------------------------------------------------------------------
const RAW = /^[a-zA-Z]+Bp$|^(sky|music)$/;
const KNOB = { op: 'change', family: 'tuning', id: 'growTimeBp', knob: 'growTimeBp', bp: 8000, was: 10000, name: { en: 'growTimeBp', bg: null }, icon: null };
const SKY = { op: 'change', family: 'look', id: 'sky', sky: 'golden', name: { en: 'sky', bg: null }, icon: null };
const MUSIC = { op: 'change', family: 'look', id: 'music', tracks: [{ id: 'day-river', title: 'Down the River' }], name: { en: 'music', bg: null }, icon: null };
const NOTE = { op: 'add', family: 'text', id: 'l_moon', from: 'mabel', name: { en: 'Melons by moonlight', bg: 'Пъпеши под луната' }, icon: null };

test('H3-04: History\'s chips word the speed knob, the sky, the music and a letter, in English and Bulgarian', async () => {
  const expect = {
    en: [/^All crops grow 20\s?% faster$/, /^Sky: golden$/, /^Music: Down the River$/, /^Melons by moonlight$/],
    bg: [/^Всички посеви растат с 20\s?% по.бързо$/, /^Небе: златно$/, /^Музика: Down the River$/, /^Пъпеши под луната$/],
  };
  for (const lang of ['en', 'bg']) {
    await I.setLang(lang);
    const v = { n: 2, no: 2, at: 5, by: 'p1', kind: 'apply', title: { en: 'Golden', bg: 'Златно' }, parent: 1, prompt: 'x', changes: [KNOB, SKY, MUSIC, NOTE], state: 'active' };
    const p = await page({ api: fakeApi({ history: () => ok({ active: 2, versions: [v] }) }) });
    p.helper.open('history');
    await tick();
    const chips = [...p.shell.body('helper').querySelectorAll('.hx-version .hx-chip')].map((c) => textOf(c).replace(/ /g, ' '));
    assert.equal(chips.length, 4, `${lang}: ${chips.join(' | ')}`);
    for (const c of chips) assert.doesNotMatch(c, RAW, `${lang}: a chip shows a raw id: ${c}`);
    chips.forEach((c, i) => assert.match(c, expect[lang][i], `${lang} chip ${i}: ${c}`));
    p.helper.destroy();
  }
  await I.setLang('en');
});

// ---- H3-05 -----------------------------------------------------------------------------------------------------------
const U4 = { n: 4, no: 4, at: 9, by: 'p1', kind: 'undo', title: { en: 'Sweet Autumn' }, parent: 3, undoTo: 1, changes: [], state: 'active' };
const P3 = { n: 3, no: 3, at: 8, by: null, kind: 'suspend', title: { en: 'Sweet Autumn Fair' }, parent: 2, reason: 'BAD_JSON', changes: [], state: 'past' };
const A2 = { n: 2, no: 2, at: 6, by: 'p1', kind: 'apply', title: { en: 'Sweet Autumn Fair' }, parent: 1, prompt: 'a lantern', changes: [], state: 'past' };
const A1 = { n: 1, no: 1, at: 5, by: 'p1', kind: 'apply', title: { en: 'Sweet Autumn' }, parent: 0, prompt: 'caramel apples', changes: [], state: 'past' };

test('H3-05: History offers no "Bring back" when the server says the change cannot come back', async () => {
  await I.setLang('en');
  // the server's word: nothing to bring back and nothing to undo (to: null)
  let p = await page({ api: fakeApi({ history: () => ok({ active: 4, versions: [U4, P3, A2, A1], undo: { to: null, last: 4, revive: false, toNo: null, lastNo: 4 } }) }) });
  p.helper.open('history');
  await tick();
  assert.equal(p.shell.body('helper').querySelector('[data-act="bringBack"]'), null, 'no "Bring back Sweet Autumn Fair"');
  assert.equal(p.shell.body('helper').querySelector('[data-act="undoLast"]'), null, 'and no undo that would fail');
  p.helper.destroy();
  // the undo replaced a pause: undoing it goes back to the game's own content, as the pause had it
  p = await page({ api: fakeApi({ history: () => ok({ active: 4, versions: [U4, P3, A2, A1], undo: { to: 0, last: 4, revive: false, toNo: 0, lastNo: 4 } }) }) });
  p.helper.open('history');
  await tick();
  assert.equal(p.shell.body('helper').querySelector('[data-act="bringBack"]'), null);
  click(p.shell.body('helper').querySelector('[data-act="undoLast"]'));
  await tick();
  assert.match(p.shell.confirms.at(-1).lead, /^The farm goes back to the game's own content\./);
  p.helper.destroy();
});

test('H3-05: a list without the server\'s word is read the same way: a pause below an undo is looked through', async () => {
  const views = await import('../public/js/ui/harness/views.js');
  assert.deepEqual(views.undoPlan({ active: 4, versions: [U4, P3, A2, A1] }), { to: 2, last: 4, revive: true });
});

test('H3-05: an undo that brings things back into the shop says so (never only "You undid one of Harvey\'s changes")', async () => {
  const CA = { id: 'x_caramel_apples', en: 'Caramel Apples', bg: 'Карамелени ябълки', bgDef: 'карамелените ябълки', g: 'pl' };
  for (const [lang, mine, by, mixed] of [
    ['en', 'Caramel Apples can be bought again.', 'Mia undid a change: Caramel Apples can be bought again.',
      'Caramel Lantern left the shop; what you have keeps working. Caramel Apples can be bought again.'],
    ['bg', 'Карамелените ябълки отново се продават.', 'Mia върна назад промяна: карамелените ябълки отново се продават.',
      'Карамеленият фенер вече не се продава; каквото имаш, си остава. Карамелените ябълки отново се продават.'],
  ]) {
    await I.setLang(lang);
    const p = await page({});
    p.helper.receive({ t: 'hx', e: 'undone', by: 'p1', n: 4, to: 1, names: [], back: [CA] });
    p.helper.receive({ t: 'hx', e: 'undone', by: 'p2', n: 5, to: 1, names: [], back: [CA] });
    p.helper.receive({ t: 'hx', e: 'undone', by: 'p1', n: 6, to: 1, names: [{ id: 'x_caramel_lantern', en: 'Caramel Lantern', bg: 'Карамелен фенер', bgDef: 'карамеленият фенер' }], back: [CA] });
    const said = p.shell.toasts.map((x) => x.replace(/ /g, ' '));
    assert.deepEqual(said, [mine, by, mixed], lang);
    p.helper.destroy();
  }
  await I.setLang('en');
});

// ---- H3-06 -----------------------------------------------------------------------------------------------------------
test('H3-06: the pill keeps "1–3 min" on one line (word joiners round the dash, a no-break space before the unit)', async () => {
  for (const [lang, unit] of [['en', 'min'], ['bg', 'мин']]) {
    await I.setLang(lang);
    const s = I.t('harness.pill.elapsed', { time: '2 s' });
    assert.ok(s.includes(`1⁠–⁠3 ${unit}`), `${lang}: ${JSON.stringify(s)}`);
    const p = await page({ api: fakeApi({ state: stateWith({ job: jobOf({ state: 'working', step: 'building', startedAt: Date.now() - 2000 }) }) }) });
    assert.ok(p.$('.hx-pill-time').textContent.includes(`1⁠–⁠3 ${unit}`), `${lang}: the pill's own line`);
    p.helper.destroy();
  }
  await I.setLang('en');
});

// ---- H3-07 -----------------------------------------------------------------------------------------------------------
const MELON = { op: 'add', family: 'crops', id: 'x_moon_melon', name: { en: 'Moon Melon', bg: 'Лунен пъпеш' }, icon: null,
  numbers: { sell: 124, seed: 40, xp: 9, minutes: 90, unlock: 14, yield: 3 }, info: { season: 'summer' } };

test('H3-07: the sell fact carries the farm\'s Market Stand bonus (124 at base, 125 with the Chalkboard & Scales stand)', async () => {
  const sellOf = (rows) => rows[0].facts.find((f) => f.key === 'harness.fact.sell')?.n;
  assert.equal(sellOf(M.changeRows([MELON], 'en', { level: 21 })), 124, 'no stand bonus: the base price');
  assert.equal(sellOf(M.changeRows([MELON], 'en', { level: 21, sellBp: 100 })), 125, 'the 1 % stand: 124 → 125');
  assert.equal(sellOf(M.changeRows([MELON], 'en', { level: 21, sellBp: 200 })), 126);
  // the ready sheet on a farm whose Market Stand is at the second tier
  await I.setLang('en');
  const objects = { 'home.1.4': { def: 'market_stand', x: 36, z: 30, rot: 0, placedAt: 1, by: 'sys', up: 2 } };
  const p = await page({ objects });
  p.helper.receive({ t: 'hx', e: 'job', job: READY({ result: { candidate: 3, summary: { en: 'A moon melon.' }, changes: [MELON], validation: VALID } }) });
  await tick();
  assert.match(textOf(p.shell.body('helper-ready')), /Sells for 125 coins/, 'the ready sheet says the Market\'s own price');
  p.helper.destroy();
});

// ---- H3-08 -----------------------------------------------------------------------------------------------------------
test('H3-08: Ask › Sign in first › signed in with no wish typed: the tab is Ask again, the box ready', async () => {
  await I.setLang('en');
  const api = fakeApi({
    state: stateWith({ providers: [{ id: 'mock', available: true, signedIn: false }] }),
    signIn: (p) => ok({ signin: { provider: p, state: 'pending', step: { kind: 'open_url', url: '/harness/mock-signin?x=1', expiresAt: 9e12 } } }),
  });
  const p = await page({ api, opts: { signedInMs: 20 } });
  p.helper.open('ask');
  await tick();
  // the Ask tab's line: "Sign in first, so Harvey can use your own plan · Sign in"
  click(p.shell.body('helper').querySelector('.hx-using.is-off [data-act="accounts"]'));
  await tick();
  assert.equal(p.shell.entry('helper').args.tab, 'accounts');
  click(p.shell.body('helper').querySelector('[data-provider="mock"] [data-act="signin"]'));
  await tick();
  // the mock's sign-in page finishes: the server's push
  p.helper.receive({ t: 'hx', e: 'signin', provider: 'mock', state: 'signed_in', signIn: { state: 'signed_in', account: { label: 'Mock farmer' } } });
  await tick();
  assert.match(textOf(p.shell.body('helper')), /Signed in/, '"Signed in to …" has its moment first');
  await sleep(60);
  assert.equal(p.shell.entry('helper')?.args.tab, 'ask', 'back on Ask');
  assert.ok(p.shell.body('helper').querySelector('#hx-prompt'), 'the idea box is there');
  p.helper.destroy();
});

test('H3-08: a farmer who opened Sign-in to manage their plans stays there (their plan card, Sign out, Use this one)', async () => {
  await I.setLang('en');
  const api = fakeApi({
    state: stateWith({ providers: [{ id: 'mock', available: true, signedIn: false }] }),
    signIn: (p) => ok({ signin: { provider: p, state: 'pending', step: { kind: 'open_url', url: '/harness/mock-signin?x=1', expiresAt: 9e12 } } }),
  });
  const p = await page({ api, opts: { signedInMs: 20 } });
  p.helper.open('accounts');
  await tick();
  click(p.shell.body('helper').querySelector('[data-provider="mock"] [data-act="signin"]'));
  await tick();
  p.helper.receive({ t: 'hx', e: 'signin', provider: 'mock', state: 'signed_in', signIn: { state: 'signed_in', account: { label: 'Mock farmer' } } });
  await sleep(60);
  assert.equal(p.shell.entry('helper')?.args.tab, 'accounts');
  p.helper.destroy();
});

test('H3-08: a farmer who left the Sign-in tab meanwhile is not moved', async () => {
  await I.setLang('en');
  const api = fakeApi({
    state: stateWith({ providers: [{ id: 'mock', available: true, signedIn: false }] }),
    signIn: (p) => ok({ signin: { provider: p, state: 'pending', step: { kind: 'open_url', url: '/harness/mock-signin?x=1', expiresAt: 9e12 } } }),
  });
  const p = await page({ api, opts: { signedInMs: 30 } });
  p.helper.open('ask');
  await tick();
  click(p.shell.body('helper').querySelector('.hx-using.is-off [data-act="accounts"]'));
  await tick();
  click(p.shell.body('helper').querySelector('[data-provider="mock"] [data-act="signin"]'));
  await tick();
  p.helper.receive({ t: 'hx', e: 'signin', provider: 'mock', state: 'signed_in', signIn: { state: 'signed_in', account: { label: 'Mock farmer' } } });
  p.helper.open('history');
  await sleep(70);
  assert.equal(p.shell.entry('helper')?.args.tab, 'history');
  p.helper.destroy();
});

// the owners' save, when this machine has a copy (read only): the Market Stand there is at the second tier
const SAVE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.scratch', 'box-save-1013', 'farm.json');
test('H3-07: on the owners\' save the sheet\'s price is the stand\'s (when the copy is on this machine)', { skip: !fs.existsSync(SAVE) }, async () => {
  await I.setLang('en');
  const save = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
  const p = await page({ before: ({ store }) => { store.state = save.state; } });
  p.helper.receive({ t: 'hx', e: 'job', job: READY({ result: { candidate: 3, summary: { en: 'x' }, changes: [MELON], validation: VALID } }) });
  await tick();
  const body = p.shell.body('helper-ready');
  assert.ok(body, 'the sheet is open');
  assert.match(textOf(body), /Sells for 125 coins/);
  p.helper.destroy();
});
