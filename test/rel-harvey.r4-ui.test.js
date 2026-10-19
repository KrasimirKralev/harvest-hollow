// QA r4 (docs/qa/release/qa-r4/fix-harvey.md), the helper's screens against a stand-in shell and a scripted server:
//   H4-01 "Changes ready" never opens by itself over a half-typed chat line (or any field outside Harvey's sheets), and a
//         sheet that opened by itself never has the focus on Apply: a Space or an Enter applies nothing unseen
//   H4-02 the other farmer's finished wish never leads this farmer's Ask: one line under the form, with an OK
//   H4-03 a refused Ask says why right under Ask (never below the chips and the can line), and the request limit says
//         which cap and the time it ends ("You can ask again at 13:30")
//   H4-04 "Bring back" and "Go back to this" say what leaves the shop and what comes back (confirm and toast); a go-back
//         that only adds is not badged "Undo"
//   H4-05 the answered sheet labels the wish "You asked for"; "Harvey says" sits over Harvey's words only
//   H4-06 English never says "Caramel Apples is in the shop again"
//   H4-07 History offers "Go back to this" only where the server says it can work
//   H4-08 the farmer's own helper is Harvey / Харви in every line of the harness catalogs
// RED on 289b672: each item's first failing line is in the fix list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { memStorage, textOf, tick, click, sleep, fakeWin, jobOf, VALID, page as pageOf, fakeApi } from './helpers/harvey.js';

globalThis.location = { pathname: '/', origin: 'http://localhost:4500', protocol: 'http:', host: 'localhost:4500', search: '', hash: '', reload() {}, assign() {} };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();
// the stand-in DOM keeps no focus: here focus() and blur() move document.activeElement as a browser would (this file only)
{
  const proto = Object.getPrototypeOf(document.createElement('div'));
  proto.focus = function focus() { document.activeElement = this; };
  proto.blur = function blur() { if (document.activeElement === this) document.activeElement = null; };
}

let H;
let M;
let I;
let V;
before(async () => {
  H = await import('../public/js/ui/harness/index.js');
  M = await import('../public/js/ui/harness/model.js');
  V = await import('../public/js/ui/harness/views.js');
  I = await import('../public/js/i18n/index.js');
  await import('../public/js/i18n/harness.js');
});
after(async () => { await I.setLang('en'); });
const page = (o) => pageOf(H, o);
const ok = (data) => ({ ok: true, status: 200, data });
const READY = (o = {}) => jobOf({ state: 'ready', step: 'ready', updatedAt: 10, result: { candidate: 3, summary: { en: 'A moon melon.' }, changes: [], validation: VALID }, ...o });
const isOpen = (p, n) => p.shell.panels.isOpen(n);
/** A key press as a browser does it on the focused control: Space or Enter on a button presses it. */
const pressKey = () => { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && !a.disabled) a.click(); };
/** The chat line of ui/social.js (a .chat-box with its one-line field), focused, holding words. */
function chatLine(words) {
  const input = document.createElement('input');
  input.setAttribute('type', 'text');
  input.type = 'text';
  input.value = words;
  const box = document.createElement('div');
  box.classList.add('chat-box');
  box.append(input);
  document.body.append(box);
  input.focus();
  return { box, input };
}
const order = (root, a, b) => {
  const all = [];
  const walk = (n) => { for (const c of n.children ?? []) { all.push(c); walk(c); } };
  walk(root);
  return all.indexOf(a) < all.indexOf(b);
};

// ---- H4-01 -----------------------------------------------------------------------------------------------------------
test('H4-01: with the chat line focused and holding words, a job turning ready opens nothing; after Send it opens, the focus never on Apply', async () => {
  await I.setLang('en');
  document.activeElement = null;
  const win = fakeWin();
  const p = await page({ win, opts: { settleMs: 40, idlePollMs: 5 } });
  const chat = chatLine('see you on the bench at seven, br');
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  await sleep(60);
  assert.equal(isOpen(p, 'helper-ready'), false, 'nothing opens over the half-typed chat line');
  assert.equal(p.$('.hx-pill').hidden, false, 'the pill says the changes are ready');
  // the farmer keeps typing ("i", "m", "o" were hotkeys under the sheet): still nothing
  win.fire('keydown', { target: chat.input, key: 'i' });
  await sleep(30);
  assert.equal(isOpen(p, 'helper-ready'), false);
  // Enter sends the line (ui/social.js removes the box; the focus falls to the page)
  win.fire('keydown', { target: chat.input, key: 'Enter' });
  chat.box.remove();
  chat.input.blur();
  await sleep(10);
  assert.equal(isOpen(p, 'helper-ready'), false, 'not under the key that sent the line');
  await sleep(120);
  assert.ok(isOpen(p, 'helper-ready'), 'it opens once the farmer stopped typing');
  await tick();
  assert.notEqual(document.activeElement?.dataset?.act, 'apply', 'a sheet that opened by itself has no focus on Apply');
  pressKey();
  pressKey();
  await tick();
  assert.equal(p.api.called('apply').length, 0, 'a Space or an Enter right after the open applies nothing');
  assert.equal(p.helper.snapshot().job.state, 'ready');
  p.helper.destroy();
});

test('H4-01: a chat line with words waits for its Send even unfocused; any text field outside Harvey holds the pop-up too', async () => {
  await I.setLang('en');
  document.activeElement = null;
  let p = await page({ win: fakeWin(), opts: { settleMs: 20, idlePollMs: 5 } });
  const chat = chatLine('half a sentence');
  chat.input.blur();
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  await sleep(50);
  assert.equal(isOpen(p, 'helper-ready'), false, 'the line still holds words');
  chat.input.value = '';
  await sleep(50);
  assert.ok(isOpen(p, 'helper-ready'), 'an empty line holds nothing');
  p.helper.destroy();
  chat.box.remove();
  // a name field of the HUD (any editable field outside Harvey's own sheets)
  p = await page({ win: fakeWin(), opts: { settleMs: 20, idlePollMs: 5 } });
  const field = document.createElement('textarea');
  document.body.append(field);
  field.focus();
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  await sleep(50);
  assert.equal(isOpen(p, 'helper-ready'), false);
  field.blur();
  await sleep(60);
  assert.ok(isOpen(p, 'helper-ready'));
  p.helper.destroy();
  field.remove();
});

test('H4-01: a farmer who opens the sheet (the pill, "See them", the button) gets the focus on Apply, as before', async () => {
  await I.setLang('en');
  document.activeElement = null;
  const p = await page({ win: fakeWin(), opts: { settleMs: 20, idlePollMs: 5 } });
  const chat = chatLine('typing');
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  await tick();
  assert.equal(isOpen(p, 'helper-ready'), false);
  click(p.$('.hx-pill-main'));
  await tick();
  assert.ok(isOpen(p, 'helper-ready'), 'the player asked: it opens');
  assert.equal(document.activeElement?.dataset?.act, 'apply');
  p.helper.destroy();
  chat.box.remove();
});

// ---- H4-02 -----------------------------------------------------------------------------------------------------------
test('H4-02: the other farmer\'s answered wish is one line under the form, after Ask, with an OK that puts it away', async () => {
  for (const lang of ['en', 'bg']) {
    await I.setLang(lang);
    const answered = jobOf({ id: 'jA', by: 'p2', state: 'answered', step: 'ready', updatedAt: 30, prompts: [{ at: 1, text: 'Snow in winter fixture:hs-04-snow' }],
      result: { candidate: null, summary: { en: 'Snow is not something I can add.', bg: 'Не мога да добавя сняг.' } } });
    const api = fakeApi({ state: () => ok({ enabled: true, providers: [{ id: 'mock', available: true, signedIn: true }], job: answered, active: null,
      consent: { telemetry: true, sending: false }, limits: {} }) });
    const p = await page({ api });
    p.helper.open('ask');
    await tick();
    const body = p.shell.body('helper');
    assert.equal(body.querySelector('.hx-job'), null, `${lang}: no card of the partner's wish leads Ask`);
    const line = body.querySelector('.hx-partner-done');
    assert.ok(line, `${lang}: the partner's wish is one line`);
    assert.ok(order(body, body.querySelector('[data-act="ask"]'), line), `${lang}: the line comes after Ask (the box and Ask stay on a phone's first screen)`);
    assert.match(textOf(line), lang === 'en' ? /^Mia asked for “Snow in winter fixture:hs-04-snow” · Harvey answered OK$/ : /^Mia поиска „Snow in winter fixture:hs-04-snow“ · Харви отговори Добре$/);
    assert.equal(body.querySelector('.hx-form').hidden, false, 'the box is there to ask');
    click(line.querySelector('[data-act="dismissPartner"]'));
    await tick();
    assert.equal(p.shell.body('helper').querySelector('.hx-partner-done'), null, 'OK puts it away');
    assert.ok(p.helper.snapshot().prefs.seen.includes('jA'), 'this device remembers it (a reload does not bring it back)');
    p.helper.destroy();
  }
  await I.setLang('en');
});

// ---- H4-03 -----------------------------------------------------------------------------------------------------------
test('H4-03: an empty Ask says why right under Ask (before the chips and the can line); the box keeps the focus', async () => {
  await I.setLang('en');
  document.activeElement = null;
  const p = await page({});
  p.helper.open('ask');
  await tick();
  const body = p.shell.body('helper');
  click(body.querySelector('[data-act="ask"]'));
  await tick();
  const f = body.querySelector('.hx-flash');
  assert.match(textOf(f), /Write what you would like first/);
  assert.ok(order(body, body.querySelector('[data-act="ask"]'), f) && order(body, f, body.querySelector('.hx-chip-row')), 'Ask, the reason, then the chips');
  assert.ok(order(body, f, body.querySelector('.hx-can-line')));
  assert.equal(document.activeElement?.id, 'hx-prompt', 'the box keeps the focus');
  p.helper.destroy();
});

test('H4-03: a refused Ask over the limit says which cap and the time it ends (the farm\'s clock), EN and BG', async () => {
  // the stand-in farm's clock: 14 Oct 2026 10:00 UTC = 13:00 in Sofia
  const cases = [
    [{ retryAfter: 1800, limit: 'day', max: 30 }, 'Your farm asked Harvey 30 times today, as many as he takes in a day. You can ask again at 13:30.',
      'Днес фермата ти помоли Харви 30 пъти, колкото той приема за един ден. Можеш да питаш пак в 13:30.'],
    [{ retryAfter: 600, limit: 'hour', max: 10 }, 'That is a lot of wishes in one hour. You can ask again at 13:10.', 'Това са много молби за един час. Можеш да питаш пак в 13:10.'],
    [{ retryAfter: 1800, limit: 'day', max: 1 }, 'Your farm asked Harvey once today, as many times as he takes in a day. You can ask again at 13:30.',
      'Днес фермата ти помоли Харви веднъж, колкото той приема за един ден. Можеш да питаш пак в 13:30.'],
    [{ retryAfter: 12 * 3600, limit: 'day', max: 30 }, 'Your farm asked Harvey 30 times today, as many as he takes in a day. You can ask again tomorrow at 01:00.',
      'Днес фермата ти помоли Харви 30 пъти, колкото той приема за един ден. Можеш да питаш пак утре в 01:00.'],
  ];
  for (const [body0, en, bg] of cases) {
    for (const [lang, want] of [['en', en], ['bg', bg]]) {
      await I.setLang(lang);
      const api = fakeApi({ start: () => ({ ok: false, status: 429, code: 'RATE', data: { error: 'RATE', ...body0 } }) });
      const p = await page({ api });
      p.helper.open('ask');
      await tick();
      p.$('#hx-prompt').value = 'A blue pumpkin';
      click(p.$('[data-act="ask"]'));
      await tick();
      assert.equal(textOf(p.$('.hx-flash')).replace(/ /g, ' '), want, `${lang} ${JSON.stringify(body0)}`);
      p.helper.destroy();
    }
  }
  // an older server's answer without the wait keeps the plain line
  await I.setLang('en');
  const p = await page({ api: fakeApi({ start: () => ({ ok: false, status: 429, code: 'RATE', data: { error: 'RATE' } }) }) });
  p.helper.open('ask');
  await tick();
  p.$('#hx-prompt').value = 'A blue pumpkin';
  click(p.$('[data-act="ask"]'));
  await tick();
  assert.match(textOf(p.$('.hx-flash')), /try again a little later/);
  p.helper.destroy();
});

// ---- H4-04 -----------------------------------------------------------------------------------------------------------
const LANTERN = { id: 'x_caramel_lantern', en: 'Caramel Lantern', bg: 'Карамелен фенер', bgDef: 'карамеленият фенер', g: 'm' };
const undoneText = (msg, me, lang) => { const l = M.undoneLine(msg, me, { p1: { name: 'Rowan' }, p2: { name: 'Mia' } }, lang); const say = (x) => I.t(x.key, { ...x.params, things: I.list(x.params.things ?? []) }); return l.also ? `${say(l)} ${say(l.also)}` : say(l); };

test('H4-04: a bring-back that took a thing out of the shop says so, for the one who did it and for the partner, EN and BG', async () => {
  const msg = { e: 'undone', by: 'p1', n: 8, to: 6, revive: true, title: { en: 'Sweet Autumn', bg: 'Сладка есен' }, names: [LANTERN], back: [] };
  await I.setLang('en');
  assert.equal(undoneText(msg, 'p1', 'en'), '“Sweet Autumn” is back on the farm. Caramel Lantern left the shop; what you have keeps working.');
  assert.equal(undoneText(msg, 'p2', 'en'), 'Rowan brought back “Sweet Autumn”. Caramel Lantern left the shop; what you have keeps working.');
  await I.setLang('bg');
  assert.equal(undoneText(msg, 'p1', 'bg'), '„Сладка есен“ отново е във фермата. Карамеленият фенер вече не се продава; каквото имаш, си остава.');
  assert.equal(undoneText(msg, 'p2', 'bg'), 'Rowan върна „Сладка есен“ във фермата. Карамеленият фенер вече не се продава; каквото имаш, си остава.');
  // the toast itself (the push's own words on the partner's screen)
  await I.setLang('en');
  const p = await page({ pid: 'p2' });
  p.helper.receive({ t: 'hx', ...msg });
  assert.match(p.shell.toasts.at(-1), /Caramel Lantern left the shop/);
  p.helper.destroy();
});

const V7 = { n: 7, no: 7, at: 12, by: 'p1', kind: 'undo', title: { en: 'Sweet Autumn Fair' }, parent: 6, undoTo: 2, state: 'active',
  changes: [{ op: 'revive', family: 'decor', id: 'x_caramel_lantern', name: { en: 'Caramel Lantern', bg: 'Карамелен фенер' } }] };
const V6 = { n: 6, no: 6, at: 11, by: 'p1', kind: 'undo', title: { en: 'Sweet Autumn' }, parent: 3, undoTo: 1, state: 'past',
  changes: [{ op: 'retire', family: 'decor', id: 'x_caramel_lantern', name: { en: 'Caramel Lantern', bg: 'Карамелен фенер' } }], go: { ok: true, left: [LANTERN], back: [] } };
const V3 = { n: 3, no: 3, at: 8, by: null, kind: 'rebuild', title: { en: 'Sweet Autumn Fair' }, parent: 2, changes: [], state: 'past', go: { ok: false, code: 'NO_CHANGE' } };
const V2 = { n: 2, no: 2, at: 6, by: 'p1', kind: 'apply', title: { en: 'Sweet Autumn Fair' }, parent: 1, prompt: 'a lantern', changes: [], state: 'past', go: { ok: false, code: 'DAMAGED' } };
const V1 = { n: 1, no: 1, at: 5, by: 'p1', kind: 'apply', title: { en: 'Sweet Autumn' }, parent: 0, prompt: 'caramel apples', changes: [], state: 'past', go: { ok: true, left: [LANTERN], back: [] } };
const HIST = { active: 7, versions: [V7, V6, V3, V2, V1], undo: { to: 6, last: 7, revive: true, toNo: 6, lastNo: 7, left: [LANTERN], back: [] } };

test('H4-04: the bring-back confirm names what leaves; "Go back to this" asks in its own words; an undo that only adds is not "Undo"', async () => {
  for (const lang of ['en', 'bg']) {
    await I.setLang(lang);
    const p = await page({ api: fakeApi({ history: () => ok(HIST) }) });
    p.helper.open('history');
    await tick();
    const body = p.shell.body('helper');
    click(body.querySelector('[data-act="bringBack"]'));
    await tick();
    const c = p.shell.confirms.at(-1);
    assert.match(c.lead, lang === 'en' ? /Caramel Lantern can no longer be bought\./ : /Карамеленият фенер вече няма да се продава\./, `${lang}: ${c.lead}`);
    assert.equal(c.okKind, 'stop', 'a press that takes a thing away looks like one');
    // "Go back to this" on version 1: its own title, and what it does
    p.shell.confirmAnswer = false;
    click(body.querySelector('[data-n="1"] [data-act="goBack"]'));
    await tick();
    const g = p.shell.confirms.at(-1);
    assert.equal(g.title, lang === 'en' ? 'Go back to it?' : 'Връщаш ли я?');
    assert.doesNotMatch(g.title, /Undo|Връщаш ли промяната/);
    assert.match(g.lead, lang === 'en' ? /^The farm goes back to version 1\. What you already have keeps working\. Caramel Lantern can no longer be bought\.$/ : /Карамеленият фенер вече няма да се продава\./);
    // version 7 only brought the lantern back: "Went back to version 2", never "Undo"
    const kind = textOf(body.querySelector('[data-n="7"] .hx-kind'));
    assert.equal(kind, lang === 'en' ? 'Went back to version 2' : 'Върната към версия 2');
    assert.equal(textOf(body.querySelector('[data-n="6"] .hx-kind')), lang === 'en' ? 'Undo' : 'Връщане назад', 'an undo that took a thing away stays "Undo"');
    p.helper.destroy();
  }
  await I.setLang('en');
});

test('H4-04: a go-back that only brings things back says so in its confirm (and is no "stop" press)', async () => {
  await I.setLang('en');
  const hist = { ...HIST, active: 6, versions: [{ ...V6, state: 'active', go: undefined }, { ...V3, go: { ok: true, left: [], back: [LANTERN] } }, V2, { ...V1, go: { ok: false, code: 'NO_CHANGE' } }],
    undo: { to: 3, last: 6, revive: true, toNo: 3, lastNo: 6, left: [], back: [LANTERN] } };
  const p = await page({ api: fakeApi({ history: () => ok(hist) }) });
  p.helper.open('history');
  await tick();
  p.shell.confirmAnswer = false;
  click(p.shell.body('helper').querySelector('[data-n="3"] [data-act="goBack"]'));
  await tick();
  const g = p.shell.confirms.at(-1);
  assert.equal(g.lead, 'The farm goes back to version 3. What you already have keeps working. Caramel Lantern can be bought again.');
  assert.equal(g.okKind, 'go');
  p.helper.destroy();
});

// ---- H4-05 -----------------------------------------------------------------------------------------------------------
test('H4-05: the answered sheet labels the wish "You asked for", then "Harvey says" over his words only', async () => {
  for (const [lang, asked, says] of [['en', 'You asked for', 'Harvey says'], ['bg', 'Твоята молба', 'Харви казва']]) {
    await I.setLang(lang);
    const p = await page({ win: fakeWin(), opts: { settleMs: 20, idlePollMs: 5 } });
    p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'answered', step: 'ready', updatedAt: 9, prompts: [{ at: 1, text: 'slow a lantern by the pond' }],
      result: { candidate: null, summary: null } }) });
    await tick();
    assert.ok(isOpen(p, 'helper-ready'));
    const sec = p.shell.body('helper-ready').querySelector('.hx-answer');
    const kids = sec.children;
    const quoteAt = kids.findIndex((k) => k.classList.contains('hx-quote') || k.classList.contains('hx-quote-wrap'));
    assert.ok(quoteAt > 0, 'the wish is quoted');
    assert.equal(textOf(kids[quoteAt - 1]), asked, `${lang}: the quote is labelled as the farmer's own words`);
    const head = sec.querySelector('h3');
    assert.equal(textOf(head), says);
    assert.ok(kids.indexOf(head) > quoteAt, `${lang}: "Harvey says" comes after the farmer's words, over his`);
    p.helper.destroy();
  }
  await I.setLang('en');
});

// ---- H4-06 -----------------------------------------------------------------------------------------------------------
test('H4-06: English never puts a singular verb after a plural name ("Caramel Apples is in the shop again")', async () => {
  await I.setLang('en');
  const CA = { id: 'x_caramel_apples', en: 'Caramel Apples', bg: 'Карамелени ябълки', bgDef: 'карамелените ябълки', g: 'pl' };
  const lines = [
    undoneText({ e: 'undone', by: 'p1', n: 4, to: 1, names: [], back: [CA] }, 'p1', 'en'),
    undoneText({ e: 'undone', by: 'p2', n: 4, to: 1, names: [], back: [CA] }, 'p1', 'en'),
    undoneText({ e: 'undone', by: 'p1', n: 4, to: 1, revive: true, title: { en: 'Sweet Autumn' }, names: [], back: [CA] }, 'p1', 'en'),
    undoneText({ e: 'undone', by: 'p1', n: 4, to: 1, revive: true, title: { en: 'Sweet Autumn' }, names: [], back: [CA] }, 'p2', 'en'),
  ];
  for (const l of lines) assert.doesNotMatch(l, /Caramel Apples (is|are)\b/, l);
  assert.equal(lines[0], 'Caramel Apples can be bought again.');
  assert.equal(lines[2], '“Sweet Autumn” is back: Caramel Apples can be bought again.');
});

// ---- H4-07 -----------------------------------------------------------------------------------------------------------
test('H4-07: a version with the farm\'s own effect, or a damaged one, offers no "Go back to this"; it says why', async () => {
  for (const lang of ['en', 'bg']) {
    await I.setLang(lang);
    const p = await page({ api: fakeApi({ history: () => ok(HIST) }) });
    p.helper.open('history');
    await tick();
    const body = p.shell.body('helper');
    assert.equal(body.querySelector('[data-n="3"] [data-act="goBack"]'), null, `${lang}: version 3 has the farm's own effect`);
    assert.match(textOf(body.querySelector('[data-n="3"] .hx-cannot-go')), lang === 'en' ? /^The same as the farm now\.$/ : /^Същото е като във фермата сега\.$/);
    assert.equal(body.querySelector('[data-n="2"] [data-act="goBack"]'), null, `${lang}: version 2 has a damaged file`);
    assert.match(textOf(body.querySelector('[data-n="2"] .hx-cannot-go')), lang === 'en' ? /damaged/ : /повреден/);
    assert.ok(body.querySelector('[data-n="1"] [data-act="goBack"]'), 'a version that can come back keeps its button');
    p.helper.destroy();
  }
  // a list without the server's word (an older server) keeps the rebuild walk
  await I.setLang('en');
  const strip = (v) => { const { go, ...rest } = v; return rest; };
  const old = V.historyList({ active: 3, versions: [{ ...strip(V3), state: 'active' }, strip(V2), strip(V1)] }, { lang: 'en', nameOf: () => null, onUndo() {} });
  assert.equal(old.querySelector('[data-n="2"] [data-act="goBack"]'), null, 'version 2 is what version 3 rebuilt');
  assert.ok(old.querySelector('[data-n="1"] [data-act="goBack"]'));
  await I.setLang('en');
});

// ---- H4-08 -----------------------------------------------------------------------------------------------------------
test('H4-08: the farmer\'s own helper is Harvey / Харви in the harness catalogs; "the helper" stays only for a partner, a stand-in or a plan', async () => {
  const en = (await import('../public/js/i18n/en/harness.js')).default;
  const bg = (await import('../public/js/i18n/bg/harness.js')).default;
  // a partner's or someone's helper ("{name}'s helper is working"), the pretend provider, the plan the farmer chose, and
  // the lines that name Harvey and say what he is
  const KEEP = new Set(['harness.pill.partner', 'harness.pill.someone', 'harness.ask.busyPartner', 'harness.job.partner', 'harness.job.someone',
    'harness.applied.by', 'harness.applied.someone', 'harness.applied.byTitle', 'harness.applied.someoneTitle', 'harness.job.stopTitle',
    'harness.prov.mock.name', 'harness.prov.mock.desc', 'harness.signin.mock.private', 'harness.set.shareHelp', 'harness.err.NOT_ELIGIBLE',
    'harness.panel.title', 'harness.btn.tip', 'harness.intro']);
  const flat = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v).join(' ') : '');
  const bad = [];
  for (const [k, v] of Object.entries(en)) if (!KEEP.has(k) && /\b(the|a|your) helper\b|helper's|helper change/i.test(flat(v))) bad.push(`en ${k}: ${flat(v)}`);
  for (const [k, v] of Object.entries(bg)) if (!KEEP.has(k) && /помощник/i.test(flat(v))) bad.push(`bg ${k}: ${flat(v)}`);
  assert.deepEqual(bad, []);
  // the four lines of the finding, word for word
  assert.equal(en['harness.pill.hide'], 'Hide Harvey\'s progress (he keeps working)');
  assert.equal(en['harness.err.STALE'], 'Your farm changed while Harvey worked.');
  assert.equal(en['harness.err.BAD_JSON'], 'A file Harvey wrote could not be read.');
  assert.equal(en['harness.err.PROVIDER'], 'Harvey\'s service did not answer properly.');
  for (const k of ['harness.pill.hide', 'harness.err.STALE', 'harness.err.BAD_JSON', 'harness.err.PROVIDER']) assert.match(bg[k], /Харви/, k);
});
