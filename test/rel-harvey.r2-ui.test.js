// QA r2 (docs/qa/release/qa-r2/fix-harvey.md), the helper's screens against a stand-in shell and a scripted server:
//   H2-01 History's "Undo the last change" after a rebuild names the version it really goes back to; a rebuilt undo offers
//         "Bring back"
//   H2-02 a paused mod is said once per farmer and version; its History row names nobody and no wish, and says why; an
//         undo to a damaged version says so
//   H2-03 "Show me" only for a thing the farm can use now; otherwise the toast says from which level
//   H2-04 a letter another panel pushed away is still unread (it comes back); its own OK reads it
//   H2-05 the EN bring-back toast quotes the title; H2-06 the BG yield fact; H2-07 History's numbers in order;
//   H2-09 a long wish in History ends with "…" and never splits a character; H2-C1 the expired sign-in line is in the
//         card the tab scrolls to, and the tab does not ask to choose a plan
// RED on 5bbfbca: each item's first failing line is in the fix list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { memStorage, textOf, tick, click, page as pageOf, fakeApi, fakeShell, fakeStore } from './helpers/harvey.js';

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
});
after(async () => { await I.setLang('en'); });
const page = (o) => pageOf(H, o);
const players = { p1: { name: 'Rowan' }, p2: { name: 'Mia' } };
const ok = (data) => ({ ok: true, status: 200, data });
const hist = (data) => fakeApi({ history: () => ok(data) });
const V3 = { n: 3, no: 3, at: 7, by: null, kind: 'rebuild', title: { en: 'Sweet Autumn Fair' }, parent: 2, prompt: 'and a caramel lantern', leftOut: ['palette'], changes: [], state: 'active' };
const V2 = { n: 2, no: 2, at: 5, by: 'p1', kind: 'apply', title: { en: 'Sweet Autumn Fair' }, parent: 1, prompt: 'and a caramel lantern', changes: [], state: 'past' };
const V1 = { n: 1, no: 1, at: 4, by: 'p1', kind: 'apply', title: { en: 'Sweet Autumn' }, parent: 0, prompt: 'caramel apples', changes: [], state: 'past' };
const historyBody = (p) => p.shell.body('helper');

// ---- H2-01 -----------------------------------------------------------------------------------------------------------
test('H2-01: after a rebuild, "Undo the last change" asks to go back to the version before the farmer\'s last change', async () => {
  await I.setLang('en');
  for (const withUndo of [true, false]) {
    // the server says where it goes (`undo`); an older server's list is walked the same way
    const p = await page({ api: hist({ active: 3, versions: [V3, V2, V1], ...(withUndo ? { undo: { to: 1, last: 2, revive: false, toNo: 1, lastNo: 2 } } : {}) }) });
    p.helper.open('history');
    await tick();
    const b = historyBody(p).querySelector('[data-act="undoLast"]');
    assert.ok(b, `the top button is the undo (withUndo ${withUndo})`);
    // version 2 is what version 3 rebuilt: going back to it changes nothing, so it offers no "Go back to this"
    assert.equal(historyBody(p).querySelector('.hx-version[data-n="2"] [data-act="goBack"]'), null);
    assert.ok(historyBody(p).querySelector('.hx-version[data-n="1"] [data-act="goBack"]'));
    click(b);
    await tick();
    const c = p.shell.confirms.at(-1);
    assert.match(c.lead, /^The farm goes back to version 1\./, `withUndo ${withUndo}: ${c.lead}`);
    p.helper.destroy();
  }
});

test('H2-01: a rebuilt undo offers "Bring back" the change it undid, back to the version before the undo', async () => {
  await I.setLang('en');
  const V4 = { ...V3, n: 4, no: 4, parent: 3, title: { en: 'The Farm As It Was' } };
  const U3 = { n: 3, no: 3, at: 6, by: 'p1', kind: 'undo', title: { en: 'Sweet Autumn' }, parent: 2, undoTo: 1, changes: [], state: 'past' };
  for (const withUndo of [true, false]) {
    const p = await page({ api: hist({ active: 4, versions: [V4, U3, V2, V1], ...(withUndo ? { undo: { to: 2, last: 3, revive: true, toNo: 2, lastNo: 3 } } : {}) }) });
    p.helper.open('history');
    await tick();
    const b = historyBody(p).querySelector('[data-act="bringBack"]');
    assert.ok(b, `withUndo ${withUndo}: the top button brings the undone change back`);
    assert.equal(textOf(b), 'Bring back Sweet Autumn Fair');
    click(b);
    await tick();
    assert.match(p.shell.confirms.at(-1).lead, /^The farm goes back to version 2, with “Sweet Autumn Fair” in it again\./);
    p.helper.destroy();
  }
});

test('H2-01: an undo the server refuses because nothing would change says so in History, with no toast of an undo', async () => {
  await I.setLang('en');
  const api = fakeApi({ history: () => ok({ active: 3, versions: [{ ...V3, kind: 'apply', by: 'p1' }, V2, V1] }), undo: () => ({ ok: false, status: 409, code: 'NO_CHANGE', data: { error: 'NO_CHANGE' } }) });
  const p = await page({ api });
  p.helper.open('history');
  await tick();
  click(historyBody(p).querySelector('.hx-version[data-n="2"] [data-act="goBack"]'));
  await tick(6);
  assert.match(textOf(historyBody(p)), /Nothing on the farm would change\./);
  assert.equal(p.shell.toasts.length, 0, 'no "You undid" toast');
  p.helper.destroy();
});

// ---- H2-02 -----------------------------------------------------------------------------------------------------------
const PAUSED_STATE = (n) => () => ok({ enabled: true, providers: [{ id: 'mock', available: true, signedIn: true, account: { label: 'test' } }],
  job: null, active: { n, hash: 'h', appliedAt: 1, by: null, title: { en: 'Sweet Autumn Fair' }, kind: 'suspend', suspended: true },
  consent: { telemetry: true, sending: false }, limits: {} });
const PAUSED = 'Harvey\'s changes are paused after a game update. Ask Harvey again, or undo them in his History.';

test('H2-02: a paused mod is said once per farmer and version: at the first state, not again for the same version', async () => {
  await I.setLang('en');
  const p = await page({ api: fakeApi({ state: PAUSED_STATE(3) }) });
  assert.deepEqual(p.shell.notices, [PAUSED], 'the first state of a paused mod tells the farmer');
  p.helper.receive({ t: 'hx', e: 'content', n: 3, changed: true, suspended: true });
  assert.equal(p.shell.notices.length, 1, 'the same version again: no second notice');
  p.helper.destroy();
  // the same device, a reload: still once
  const shell = fakeShell();
  const h2 = H.createHarnessUi({ ui: shell.ui, store: fakeStore('p1') }, { api: fakeApi({ state: PAUSED_STATE(3) }), bus: null, pollMs: 0, signInPollMs: 0, fallbackMs: 5, autoStart: false });
  await h2.connect({ force: true });
  await tick();
  assert.equal(shell.notices.length, 0, 'read once on this device');
  // a later pause (another game update) is news again
  h2.receive({ t: 'hx', e: 'content', n: 5, changed: true, suspended: true });
  assert.deepEqual(shell.notices, [PAUSED]);
  h2.destroy();
  // the other farmer on the same device hears it too
  const shell3 = fakeShell();
  const h3 = H.createHarnessUi({ ui: shell3.ui, store: fakeStore('p2') }, { api: fakeApi({ state: PAUSED_STATE(3) }), bus: null, pollMs: 0, signInPollMs: 0, fallbackMs: 5, autoStart: false });
  await h3.connect({ force: true });
  await tick();
  assert.deepEqual(shell3.notices, [PAUSED]);
  h3.destroy();
});

test('H2-02: History\'s paused row names no farmer and no wish, and says why', async () => {
  await I.setLang('en');
  // a pause stored before this fix still carries the old farmer and wish: never shown
  const P3 = { n: 3, no: 3, at: 7, by: 'p1', kind: 'suspend', title: { en: 'Sweet Autumn Fair' }, parent: 2, prompt: 'and a caramel lantern, a blue barn and a letter',
    reason: 'BAD_JSON', changes: [], state: 'active' };
  const p = await page({ api: hist({ active: 3, versions: [P3, V2, V1] }) });
  p.helper.open('history');
  await tick();
  const row = historyBody(p).querySelector('.hx-version[data-n="3"]');
  assert.doesNotMatch(textOf(row), /Rowan|Asked:/);
  assert.match(textOf(row), /Paused: a file of this change could not be read\./);
  p.helper.destroy();
  const q = await page({ api: hist({ active: 3, versions: [{ ...P3, by: null, prompt: null, reason: 'CONTENT_CHECK' }, V2, V1] }) });
  q.helper.open('history');
  await tick();
  assert.match(textOf(historyBody(q).querySelector('.hx-version[data-n="3"]')), /Paused: this change no longer works with the updated game\./);
  q.helper.destroy();
  await I.setLang('bg');
  const r = await page({ api: hist({ active: 3, versions: [P3, V2, V1] }) });
  r.helper.open('history');
  await tick();
  assert.match(textOf(historyBody(r).querySelector('.hx-version[data-n="3"]')), /На пауза: файл от тази промяна не може да се прочете\./);
  r.helper.destroy();
  await I.setLang('en');
});

test('H2-02: going back to a version with a damaged file says so, never "did not pass the tests"', async () => {
  await I.setLang('en');
  const api = fakeApi({ history: () => ok({ active: 3, versions: [{ ...V3, kind: 'suspend', reason: 'BAD_JSON' }, V2, V1] }),
    undo: () => ({ ok: false, status: 409, code: 'DAMAGED', data: { error: 'DAMAGED' } }) });
  const p = await page({ api });
  p.helper.open('history');
  await tick();
  click(historyBody(p).querySelector('.hx-version[data-n="2"] [data-act="goBack"]'));
  await tick(6);
  const text = textOf(historyBody(p));
  assert.match(text, /Version 2 has a damaged file\. Go back to another version, or ask Harvey again\./);
  assert.doesNotMatch(text, /did not pass the tests/);
  p.helper.destroy();
});

// ---- H2-03 -----------------------------------------------------------------------------------------------------------
const MOON = { id: 'x_moon_melon', en: 'Moon Melon', bg: 'Лунен пъпеш', family: 'crops', unlock: 14 };
const EARLY = { id: 'x_early_melon', en: 'Early Melon', bg: 'Ранен пъпеш', family: 'crops', unlock: 3 };

test('H2-03: "Show me" only for a thing the farm can use now; a later one says from which level', async () => {
  await I.setLang('en');
  const p = await page({ level: 1 });
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, title: { en: 'Moonlight' }, names: [MOON] });
  // the level stays on one line with its thing ("(from level 14)" is joined by no-break spaces: Astra's critique)
  assert.equal(p.shell.toasts.at(-1), 'Harvey added Moon Melon (from\u00A0level\u00A014)');
  assert.equal(p.shell.toastOpts.at(-1).action, undefined, 'no Show me for a thing the Market keeps in "Next:"');
  p.helper.destroy();
  // two things: the one the farm can use is the one shown
  const q = await page({ level: 5 });
  q.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, title: { en: 'Melons' }, names: [MOON, EARLY] });
  assert.equal(q.shell.toasts.at(-1).replace(/\u00A0/g, ' '), 'Harvey added Moon Melon (from level 14) and Early Melon');
  const a = q.shell.toastOpts.at(-1).action;
  assert.ok(a, 'Show me for the Early Melon');
  q.shell.panels.register('market', { mount() {} });
  a.fn();
  assert.deepEqual(q.shell.opened.at(-1), ['market', { tab: 'seeds', focus: 'x_early_melon' }]);
  q.helper.destroy();
  // at level 21 the Moon Melon is shown as before
  const r = await page({ level: 21 });
  r.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, title: { en: 'Moonlight' }, names: [MOON] });
  assert.equal(r.shell.toasts.at(-1), 'Harvey added Moon Melon');
  assert.ok(r.shell.toastOpts.at(-1).action);
  r.helper.destroy();
  await I.setLang('bg');
  const s = await page({ level: 1 });
  s.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, title: { bg: 'Лунна' }, names: [MOON] });
  assert.equal(s.shell.toasts.at(-1).replace(/\u00A0/g, ' '), 'Харви добави лунен пъпеш (от ниво 14)');
  s.helper.destroy();
  await I.setLang('en');
});

// ---- H2-04 -----------------------------------------------------------------------------------------------------------
const LETTER = { id: 'l_mabel', from: 'mabel', art: 'farmhouse', en: { title: 'A note', body: 'Hello.' }, bg: { title: 'Бележка', body: 'Здравей.' } };
const readLetters = () => JSON.parse(globalThis.localStorage.getItem('hh.harness.letters') ?? '{}');

test('H2-04: a letter another panel pushes away stays unread and comes back; its own OK reads it', async () => {
  await I.setLang('en');
  const p = await page({ level: 21 });
  p.shell.panels.register('market', { mount() {} });
  p.helper.receive({ t: 'hx', e: 'content', n: 3, changed: true, text: { letters: [LETTER] } });
  assert.ok(p.shell.panels.isOpen('helper-letter'), 'the letter shows');
  // the toast's "Show me" opens the Market over it
  p.shell.panels.open('market', { tab: 'seeds' });
  await tick();
  assert.ok(!p.shell.panels.isOpen('helper-letter'));
  assert.deepEqual(readLetters().p1 ?? [], [], 'pushed away, not read');
  // the Market closes: the letter comes back
  p.shell.panels.close('market');
  await new Promise((r) => setTimeout(r, 450));
  assert.ok(p.shell.panels.isOpen('helper-letter'), 'the letter is back');
  click(p.shell.body('helper-letter').querySelector('[data-act="ok"]'));
  await tick();
  assert.deepEqual(readLetters().p1, ['l_mabel'], 'its own OK reads it');
  p.helper.destroy();
});

test('H2-04: the letter\'s ✕ (the shell\'s close with nothing opening after it) reads it', async () => {
  await I.setLang('en');
  const p = await page({ level: 21 });
  p.helper.receive({ t: 'hx', e: 'content', n: 3, changed: true, text: { letters: [LETTER] } });
  assert.ok(p.shell.panels.isOpen('helper-letter'));
  p.shell.panels.close('helper-letter');
  await tick();
  assert.deepEqual(readLetters().p1, ['l_mabel']);
  p.helper.destroy();
});

// ---- H2-05 · H2-06 -----------------------------------------------------------------------------------------------------
test('H2-05: the EN bring-back toast quotes the title, so a plural title reads right', async () => {
  await I.setLang('en');
  const LLAMA = { id: 'x_llama', en: 'Llama', bg: 'Лама', bgDef: 'ламата' };
  const line = (msg, me) => { const l = M.undoneLine(msg, me, players, 'en'); return I.t(l.key, { ...l.params, things: I.list(l.params.things ?? []) }); };
  const msg = { e: 'undone', n: 6, to: 3, revive: true, title: { en: 'Llamas', bg: 'Лами' }, names: [], back: [LLAMA], by: 'p1' };
  assert.equal(line(msg, 'p1'), '“Llamas” is back: Llama can be bought again.');
  assert.equal(line(msg, 'p2'), 'Rowan brought back “Llamas”: Llama can be bought again.');
  assert.equal(line({ ...msg, back: [] }, 'p1'), '“Llamas” is back on the farm.');
  assert.equal(line({ ...msg, back: [] }, 'p2'), 'Rowan brought back “Llamas”.');
});

test('H2-06: the BG yield fact reads "По 2 при прибиране"', async () => {
  const bg = (await import('../public/js/i18n/bg/harness.js')).default;
  assert.equal(bg['harness.fact.yield'], 'По {n} при прибиране');
});

// ---- H2-07 · H2-09 -----------------------------------------------------------------------------------------------------
test('H2-07: History shows its own numbers in order, and the confirm uses them', async () => {
  await I.setLang('en');
  const p = await page({ api: hist({ active: 9, versions: [
    { n: 9, no: 2, at: 7, by: 'p1', kind: 'undo', title: { en: 'The Farm As It Was' }, parent: 8, undoTo: 0, changes: [], state: 'active' },
    { n: 8, no: 1, at: 5, by: 'p1', kind: 'apply', title: { en: 'Moonlight' }, parent: 0, prompt: 'Moon melons', changes: [], state: 'past' }] }) });
  p.helper.open('history');
  await tick();
  const heads = [...historyBody(p).querySelectorAll('.hx-version-head b')].map((b) => textOf(b));
  assert.deepEqual(heads, ['Version 2', 'Version 1']);
  click(historyBody(p).querySelector('[data-act="bringBack"]'));
  await tick();
  assert.match(p.shell.confirms.at(-1).lead, /^The farm goes back to version 1,/);
  p.helper.destroy();
});

test('H2-09: a long wish in History ends with "…" and never splits a character in two', async () => {
  await I.setLang('bg');
  const wish = `${'Искам синя тиква '.repeat(9)}🎃${'и дава много монети '.repeat(40)}`;
  const p = await page({ api: hist({ active: 1, versions: [{ ...V1, prompt: wish }] }) });
  p.helper.open('history');
  await tick();
  const asked = textOf(historyBody(p).querySelector('.hx-asked'));
  assert.match(asked, /^Молба: „Искам синя тиква/);
  assert.match(asked, /…“$/, asked);
  const inner = asked.slice('Молба: „'.length, -1);
  assert.ok(Array.from(inner).length <= 161, `${Array.from(inner).length} characters`);
  assert.doesNotMatch(inner, /\s…$/, 'trimmed before the ellipsis');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(inner), 'no lone surrogate');
  p.helper.destroy();
  // the cut lands inside the pumpkin: the pumpkin stays whole or leaves whole
  const q = await page({ api: hist({ active: 1, versions: [{ ...V1, prompt: `${'а'.repeat(159)}🎃${'б'.repeat(50)}` }] }) });
  q.helper.open('history');
  await tick();
  const inner2 = textOf(historyBody(q).querySelector('.hx-asked')).slice('Молба: „'.length, -1);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(inner2), 'no lone surrogate');
  q.helper.destroy();
  // a short wish is shown whole, with no ellipsis
  const r = await page({ api: hist({ active: 1, versions: [{ ...V1, prompt: 'Синя тиква' }] }) });
  r.helper.open('history');
  await tick();
  assert.equal(textOf(historyBody(r).querySelector('.hx-asked')), 'Молба: „Синя тиква“');
  r.helper.destroy();
  await I.setLang('en');
});

// ---- H2-C1 -------------------------------------------------------------------------------------------------------------
test('H2-C1: after the sign-in ran out, the line is inside the card the tab scrolls to, and the tab does not ask to choose', async () => {
  const proto = Object.getPrototypeOf(document.createElement('div'));
  const scrolled = [];
  const was = proto.scrollIntoView;
  // what the tab scrolled into view, as it was then (the card is drawn again when the sign-in's first step arrives)
  proto.scrollIntoView = function rec() { scrolled.push({ signin: this.dataset?.signin ?? null, text: textOf(this) }); };
  try {
    for (const lang of ['en', 'bg']) {
      await I.setLang(lang);
      const providers = [{ id: 'mock', available: true, signedIn: true, account: { label: 'test' } }, { id: 'chatgpt', available: true, signedIn: false }];
      const api = fakeApi({
        state: () => ok({ enabled: true, providers, job: null, active: null, consent: { telemetry: true, sending: false }, limits: {} }),
        start: () => ({ ok: false, status: 428, code: 'SIGN_IN', data: { error: 'SIGN_IN' } }),
      });
      const p = await page({ api });
      p.shell.reopenInPlace = true;
      p.helper.open();
      await tick();
      p.$('#hx-prompt').value = 'A golden barn';
      click(p.$('[data-act="ask"]'));
      await tick(8);
      await new Promise((r) => setTimeout(r, 80));
      const body = p.shell.body('helper');
      const expired = I.t('harness.signin.expired');
      const card = body.querySelector('[data-signin="mock"]');
      assert.ok(card, 'the restarted sign-in');
      assert.ok(textOf(card).includes(expired), `${lang}: the line is in the card (${textOf(card)})`);
      assert.equal(textOf(body).split(expired).length - 1, 1, 'said once');
      assert.ok(!textOf(body).includes(I.t('harness.prov.choose')), `${lang}: no "choose who runs Harvey" for a farmer who had chosen`);
      assert.ok(scrolled.some((x) => x.signin === 'mock' && x.text.includes(expired)), `the tab scrolls to that card, the line in it: ${JSON.stringify(scrolled)}`);
      p.helper.destroy();
      scrolled.length = 0;
    }
  } finally {
    proto.scrollIntoView = was;
    await I.setLang('en');
  }
});
