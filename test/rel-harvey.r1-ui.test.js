// QA r1 (docs/qa/release/qa-r1/fix-harvey.md), the helper's screens against a stand-in shell and a scripted server:
//   H-04 "Bring back {title}" is its own confirm, toast (both farmers) and badge, never an undo
//   H-12 the Bulgarian undo toast for one thing: the definite form and a singular verb
// RED on 7f67efe: the bring-back confirm was "Undo this change?", the toasts "You undid one of Harvey's changes." /
// "<name> undid a helper change.", the badge "Undo"; one llama read "Лама вече не се продават".
// QA r2 H2-05: the EN title is quoted, as the BG one always was (“Llamas” is back: …).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { memStorage, textOf, tick, click, page as pageOf, fakeApi } from './helpers/harvey.js';

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
/** The toast text a push makes, as the helper renders it. */
const line = (msg, me, lang) => {
  const l = M.undoneLine(msg, me, players, lang);
  return I.t(l.key, { ...l.params, things: I.list(l.params.things ?? []) });
};
const MOON = { id: 'x_moon_melon', en: 'Moon Melon', bg: 'Лунен пъпеш', bgDef: 'лунният пъпеш' };
const PIE = { id: 'x_melon_pie', en: 'Melon Pie', bg: 'Пай с пъпеш', bgDef: 'паят с пъпеш' };
const LLAMA = { id: 'x_llama', en: 'Llama', bg: 'Лама', bgDef: 'ламата' };
const BACK = { e: 'undone', n: 6, to: 3, revive: true, title: { en: 'Moonlight Harvest', bg: 'Лунна реколта' }, names: [], back: [MOON, PIE] };

test('H-04: the bring-back toast says what came back, for the one who did it and for the partner, EN and BG', async () => {
  await I.setLang('en');
  assert.equal(line({ ...BACK, by: 'p1' }, 'p1', 'en'), '“Moonlight Harvest” is back: Moon Melon and Melon Pie can be bought again.');
  assert.equal(line({ ...BACK, by: 'p1' }, 'p2', 'en'), 'Rowan brought back “Moonlight Harvest”: Moon Melon and Melon Pie can be bought again.');
  assert.equal(line({ ...BACK, by: 'p1', back: [MOON] }, 'p2', 'en'), 'Rowan brought back “Moonlight Harvest”: Moon Melon can be bought again.');
  assert.equal(line({ ...BACK, by: 'p1', back: [] }, 'p2', 'en'), 'Rowan brought back “Moonlight Harvest”.');
  await I.setLang('bg');
  assert.equal(line({ ...BACK, by: 'p1' }, 'p1', 'bg'), '„Лунна реколта“ се върна: лунен пъпеш и пай с пъпеш отново се продават.');
  assert.equal(line({ ...BACK, by: 'p1' }, 'p2', 'bg'), 'Rowan върна „Лунна реколта“: лунен пъпеш и пай с пъпеш отново се продават.');
  assert.equal(line({ ...BACK, by: 'p1', back: [MOON] }, 'p1', 'bg'), '„Лунна реколта“ се върна: лунният пъпеш отново се продава.');
  await I.setLang('en');
});

test('H-04: the partner\'s phone hears the bring-back as one, never "undid"', async () => {
  await I.setLang('en');
  const p = await page({ pid: 'p2' });
  p.helper.receive({ t: 'hx', ...BACK, by: 'p1' });
  assert.equal(p.shell.toasts.at(-1), 'Rowan brought back “Moonlight Harvest”: Moon Melon and Melon Pie can be bought again.');
  assert.doesNotMatch(p.shell.toasts.join(' | '), /undid|undone/i);
  p.helper.destroy();
});

test('H-04: History\'s "Bring back" asks in its own words; the version is badged "Brought back"; the fallback toast too', async () => {
  await I.setLang('en');
  let undone = false;
  const api = fakeApi({
    history: () => ({ ok: true, status: 200, data: undone
      ? { active: 5, versions: [
        { n: 5, at: 7, by: 'p1', kind: 'revive', title: { en: 'Moonlight Harvest' }, parent: 4, undoTo: 3, changes: [], state: 'active' },
        { n: 4, at: 6, by: 'p1', kind: 'undo', title: { en: 'The Farm As It Was' }, parent: 3, undoTo: 0, changes: [], state: 'past' },
        { n: 3, at: 5, by: 'p1', kind: 'apply', title: { en: 'Moonlight Harvest' }, parent: 0, prompt: 'Moon melons', changes: [], state: 'past' }] }
      : { active: 4, versions: [
        { n: 4, at: 6, by: 'p1', kind: 'undo', title: { en: 'The Farm As It Was' }, parent: 3, undoTo: 0, changes: [], state: 'active' },
        { n: 3, at: 5, by: 'p1', kind: 'apply', title: { en: 'Moonlight Harvest' }, parent: 0, prompt: 'Moon melons', changes: [], state: 'past' }] } }),
    undo: () => { undone = true; return { ok: true, status: 200, data: { active: { n: 5, hash: 'h5', appliedAt: 7, by: 'p1' } } }; },
  });
  const p = await page({ api });
  p.helper.open('history');
  await tick();
  click(p.shell.body('helper').querySelector('[data-act="bringBack"]'));
  await tick();
  const c = p.shell.confirms.at(-1);
  assert.equal(c.title, 'Bring it back?');
  assert.match(c.lead, /with “Moonlight Harvest” in it again/, 'the change is named in the lead (QA r2: a long title was cut in the ribbon)');
  assert.equal(c.ok, 'Bring back');
  assert.doesNotMatch(`${c.title} ${c.lead} ${c.ok}`, /Undo|leave can no longer be bought/);
  await tick(6);
  await new Promise((r) => setTimeout(r, 20));
  // no push came (the scripted server sends none): the device's own fallback toast still says it came back
  assert.equal(p.shell.toasts.at(-1), '“Moonlight Harvest” is back on the farm.');
  const badges = [...p.shell.body('helper').querySelectorAll('.hx-kind')].map((b) => textOf(b));
  assert.deepEqual(badges, ['Brought back', 'Undo', 'Applied']);
  p.helper.destroy();
});

test('H-12: the Bulgarian undo toast for one thing takes the definite form and a singular verb; two stay plural', async () => {
  await I.setLang('bg');
  assert.equal(line({ e: 'undone', by: 'p1', n: 7, names: [LLAMA] }, 'p1', 'bg'), 'Ламата вече не се продава; каквото имаш, си остава.');
  assert.equal(line({ e: 'undone', by: 'p1', n: 7, names: [LLAMA] }, 'p2', 'bg'), 'Rowan върна назад промяна: ламата вече не се продава; каквото имаш, си остава.');
  assert.equal(line({ e: 'undone', by: 'p1', n: 7, names: [MOON, PIE] }, 'p2', 'bg'), 'Rowan върна назад промяна: лунен пъпеш и пай с пъпеш вече не се продават; каквото имаш, си остава.');
  // a push without the definite form (an older server) still reads in the singular
  assert.equal(line({ e: 'undone', by: 'p1', n: 7, names: [{ en: 'Llama', bg: 'Лама' }] }, 'p1', 'bg'), 'Лама вече не се продава; каквото имаш, си остава.');
  await I.setLang('en');
  assert.equal(line({ e: 'undone', by: 'p1', n: 7, names: [LLAMA] }, 'p2', 'en'), 'Rowan undid a change: Llama left the shop; what you have keeps working.');
});

// ---- H-05 · H-06 · H-10 · H-13 · H-14 · H-15 · H-16 · H-18 ------------------------------------------------------------
const READY = (o = {}) => ({ id: 'j1', by: 'p1', provider: 'mock', model: null, state: 'ready', step: 'ready', round: 1, startedAt: Date.now() - 60_000,
  updatedAt: 9, lang: 'en', prompts: [{ at: 1, text: 'Moon melons, please' }], progress: [], error: null,
  result: { candidate: 3, parent: 2, changes: [], validation: null, summary: { en: 'Moon Melons are in the shop.', bg: 'Лунни пъпеши.' } }, ...o });
const typeAsk = (p, text) => {
  p.$('#hx-prompt').value = text;
  click(p.$('[data-act="ask"]'));
};

test('H-05: while "Ask for changes" or the stale notice is open the sticky bar steps aside; each has its own way out', async () => {
  await I.setLang('en');
  const api = fakeApi({ apply: () => ({ ok: false, status: 409, code: 'STALE', data: { error: 'STALE' } }) });
  const p = await page({ api });
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  const body = p.shell.body('helper-ready');
  const bar = body.querySelector('.hx-sticky-acts');
  assert.equal(bar.hidden, false);
  click(body.querySelector('[data-act="revise"]'));
  assert.equal(bar.hidden, true, 'the bar would lie over "Send" at 360 x 640');
  assert.equal(body.querySelector('.hx-revise').hidden, false);
  assert.equal(body.querySelector('#hx-revise').dataset.keepInView, 'reviseSend', 'the field names its button for the keyboard');
  click(body.querySelector('[data-act="reviseCancel"]'));
  assert.equal(bar.hidden, false);
  assert.equal(body.querySelector('.hx-revise').hidden, true);
  click(body.querySelector('[data-act="apply"]'));
  await tick();
  assert.equal(body.querySelector('.hx-stale').hidden, false);
  assert.equal(bar.hidden, true, 'the greyed Apply would lie over "Rebuild on top"');
  assert.ok(body.querySelector('.hx-stale [data-act="rebuild"]') && body.querySelector('.hx-stale [data-act="staleDiscard"]'));
  assert.match(textOf(body.querySelector('.hx-stale')), /Your farm changed while Harvey worked\. Rebuild these changes on top of the farm as it is now\?/);
  assert.doesNotMatch(textOf(body.querySelector('.hx-stale')), /newer change was applied/);
  p.helper.destroy();
});

test('H-06: a sent wish leaves the box; "Harvey is on it" goes once the job fails, is answered or is ready', async () => {
  await I.setLang('en');
  for (const end of [{ state: 'failed', error: { code: 'INVALID', detail: null }, result: null },
    { state: 'answered', result: { candidate: null, parent: 2, changes: [], validation: null, summary: null } },
    { state: 'ready', result: READY().result }]) {
    const p = await page();
    p.helper.open();
    await tick();
    typeAsk(p, 'A golden barn');
    await tick();
    assert.equal(p.$('#hx-prompt')?.value ?? '', '', 'the sent wish is no longer in the box');
    assert.match(textOf(p.$('.hx-flash.tone-ok')), /Harvey is on it/);
    p.helper.receive({ t: 'hx', e: 'job', job: { ...READY(), prompts: [{ at: 1, text: 'A golden barn' }], updatedAt: 50, ...end } });
    await tick();
    assert.equal(p.$('.hx-flash.tone-ok'), null, `"Harvey is on it" stays under a ${end.state} job`);
    if (end.state === 'failed') {
      // "Change my wish" puts the words back
      p.shell.panels.closeAll?.();
      p.helper.open();
      await tick();
      click(p.$('.hx-job [data-act="change"]'));
      await tick();
      assert.equal(p.$('#hx-prompt').value, 'A golden barn');
    }
    p.helper.destroy();
  }
});

test('H-10: a provider\'s sign-in that cannot be reached says so by name; an Ask after the sign-in ran out says that', async () => {
  await I.setLang('en');
  const providers = [{ id: 'mock', available: true, signedIn: false }, { id: 'chatgpt', available: true, signedIn: false }];
  const state = () => ({ ok: true, status: 200, data: { enabled: true, providers, job: null, active: null, consent: { telemetry: true, sending: false }, limits: {} } });
  const api = fakeApi({ state, signIn: (pv) => ({ ok: true, status: 200, data: { signin: { provider: pv, state: 'error', error: { code: 'UNAVAILABLE' } } } }) });
  const p = await page({ api });
  p.helper.open('accounts');
  await tick();
  click(p.$('[data-provider="chatgpt"] [data-act="signin"]'));
  await tick();
  const err = textOf(p.$('[data-signin="chatgpt"] .hx-error'));
  assert.equal(err, 'ChatGPT\'s sign-in cannot be reached right now. Try again in a little while, or choose another plan.');
  p.helper.destroy();
  // signed in a moment ago, the server answers 428: the sign-in ran out
  const api2 = fakeApi({ start: () => ({ ok: false, status: 428, code: 'SIGN_IN', data: { error: 'SIGN_IN' } }),
    signIn: (pv) => ({ ok: true, status: 200, data: { signin: { provider: pv, state: 'pending' } } }) });
  const q = await page({ api: api2 });
  q.shell.reopenInPlace = true;
  q.helper.open();
  await tick();
  typeAsk(q, 'A golden barn');
  await tick();
  assert.match(textOf(q.shell.body('helper')), /Your sign-in ran out\. Sign in again and Harvey goes on\./);
  assert.doesNotMatch(textOf(q.shell.body('helper')), /Sign in to .* to go on/);
  q.helper.destroy();
});

test('H-13: the consent line sends the farmer to the tab that exists: Settings › Harvey (EN) / Настройки › Харви (BG)', async () => {
  const en = (await import('../public/js/i18n/en/harness.js')).default;
  const bg = (await import('../public/js/i18n/bg/harness.js')).default;
  assert.match(en['harness.consent.later'], new RegExp(`Settings › ${en['harness.set.tab']}\\.`));
  assert.match(bg['harness.consent.later'], new RegExp(`Настройки › ${bg['harness.set.tab']}\\.`));
  for (const [k, v] of [...Object.entries(en), ...Object.entries(bg)]) {
    assert.doesNotMatch(String(typeof v === 'string' ? v : JSON.stringify(v)), /Settings › Helper|Настройки › Помощник/, k);
  }
});

test('H-14: a version the game rebuilt for 1.0 is badged "Updated for the new game" and says what it left out, not the old wish', async () => {
  await I.setLang('en');
  const api = fakeApi({ history: () => ({ ok: true, status: 200, data: { active: 3, versions: [
    { n: 3, at: 7, by: null, kind: 'rebuild', title: { en: 'Sweet Autumn' }, parent: 2, prompt: 'and a caramel lantern', prompts: ['Caramel apples', 'and a caramel lantern'],
      leftOut: ['palette', 'tips'], changes: [], state: 'active' },
    { n: 2, at: 5, by: 'p1', kind: 'apply', title: { en: 'Sweet Autumn' }, parent: 1, prompt: 'and a caramel lantern', prompts: ['Caramel apples', 'and a caramel lantern'], changes: [], state: 'past' }] } }) });
  const p = await page({ api });
  p.helper.open('history');
  await tick();
  const v3 = p.shell.body('helper').querySelector('.hx-version[data-n="3"]');
  assert.equal(textOf(v3.querySelector('.hx-kind')), 'Updated for the new game');
  assert.match(textOf(v3), /Left out: the farm's colours and the tips \(they never showed in the game\)\./);
  assert.doesNotMatch(textOf(v3), /Asked:/);
  assert.match(textOf(p.shell.body('helper').querySelector('.hx-version[data-n="2"]')), /Asked: “Caramel apples”/);
  p.helper.destroy();
});

test('H-15: the plain "found nothing" reply is said once, and the chips never offer the wish just asked', async () => {
  await I.setLang('en');
  const p = await page({ level: 21 });
  p.helper.receive({ t: 'hx', e: 'job', job: { ...READY(), state: 'answered', prompts: [{ at: 1, text: 'A pink fence' }],
    result: { candidate: null, parent: 2, changes: [], validation: null, summary: null } } });
  const text = textOf(p.shell.body('helper-ready'));
  assert.equal(text.split('Nothing on your farm changed.').length - 1, 1, text);
  const chips = [...p.shell.body('helper-ready').querySelectorAll('.hx-chip')].map((c) => textOf(c));
  assert.ok(chips.length >= 1 && !chips.includes('A pink fence'), JSON.stringify(chips));
  // a reply in his own words keeps the line under it
  const q = await page({ level: 21 });
  q.helper.receive({ t: 'hx', e: 'job', job: { ...READY(), state: 'answered', prompts: [{ at: 1, text: 'Coins' }],
    result: { candidate: null, parent: 2, changes: [], validation: null, summary: { en: 'Prices are the game\'s own.', bg: 'Цените са на играта.', possible: false } } } });
  assert.match(textOf(q.shell.body('helper-ready')), /Prices are the game's own\. .*Nothing on your farm changed\./);
  p.helper.destroy();
  q.helper.destroy();
  const M2 = await import('../public/js/ui/harness/model.js');
  const ids = M2.chips({ level: 21, asked: 'Розова ограда, моля', textOf: (k) => ({ 'harness.chip.ex3': 'Розова ограда' })[k] ?? k }).map((c) => c.id ?? c.text);
  assert.ok(!ids.includes('ex3'), JSON.stringify(ids));
});

test('H-16: the partner\'s Harvey button says the change is ready, not "working"', async () => {
  await I.setLang('en');
  const p = await page({ pid: 'p2' });
  p.helper.receive({ t: 'hx', e: 'job', job: READY() });
  assert.equal(p.$('#hx-btn').getAttribute('aria-label'), 'Harvey: Rowan\'s changes are ready');
  p.helper.receive({ t: 'hx', e: 'job', job: { ...READY(), state: 'working', step: 'building', result: null, updatedAt: 99, round: 2 } });
  assert.equal(p.$('#hx-btn').getAttribute('aria-label'), 'Harvey is working for Rowan');
  p.helper.destroy();
});

test('H-18: a long wish shows three lines and "Show all"; a short one is shown whole', async () => {
  await I.setLang('en');
  const V = await import('../public/js/ui/harness/views.js');
  const long = V.quoteEl('a '.repeat(500));
  const q = long.querySelector('.hx-quote');
  const more = long.querySelector('[data-act="quoteMore"]');
  assert.ok(q.classList.contains('is-clamped'));
  assert.equal(textOf(more), 'Show all');
  assert.ok(more.classList.contains('btn'), 'a button of the component list');
  click(more);
  assert.ok(!q.classList.contains('is-clamped'));
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.equal(textOf(more), 'Show less');
  const short = V.quoteEl('A pink fence');
  assert.equal(short.tagName, 'BLOCKQUOTE');
  // the job card uses it
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: { ...READY(), state: 'working', step: 'building', result: null, prompts: [{ at: 1, text: 'x'.repeat(1000) }] } });
  p.helper.open();
  await tick();
  assert.ok(p.$('.hx-job .hx-quote.is-clamped') && p.$('.hx-job [data-act="quoteMore"]'));
  p.helper.destroy();
});
