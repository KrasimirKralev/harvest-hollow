// Release 1.0 harvey lane, the helper's screens (public/js/ui/harness/**) against a stand-in shell and a scripted server:
//   H1  Harvey's answer opens by itself as his reply (his words, Read it aloud, the chip row, OK); the pill says "Harvey
//       answered"; a failure leads with his words and "Change my wish", the codes behind "What went wrong"
//   H3  the change list in words: speed, the tuned crop, cost, season, workshop and inputs, "From level 9 (your farm is
//       5)", the sky, the music, a letter; "Tested" folded to one line (open when a test failed)
//   H4  Ask unsigned with two plans starts no sign-in ("Choose who runs Harvey"); with one it does; signing in clears
//       the flash, ends the other plan's sign-in here and on the server, goes back to Ask; "Harvey" is on the button
//   one chip row (at most 3, level-aware, Harvey's suggestions first); M17c the consent line; equal consent buttons
//   "Show me" on the applied toast and the letter; a one-tap Undo on the partner's toast (H6 should)
//   H6  partner wording, the discard confirm names whose work, the undo toast names what left, "Bring back {title}",
//       History shows the first wish and "+1 change"
// RED on fdafb9c: no `answered` (the reply was "The change did not pass the tests"), a sign-in started by itself with
// two plans, "Share my requests and mods", no chips but four fixed examples, no Show me, no Undo on the partner's toast.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { memStorage, textOf, tick, click, page as pageOf, fakeApi, jobOf, VALID } from './helpers/harvey.js';

globalThis.location = { pathname: '/', origin: 'http://localhost:4500', protocol: 'http:', host: 'localhost:4500', search: '', hash: '', reload() {}, assign() {} };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();

let H;
before(async () => { H = await import('../public/js/ui/harness/index.js'); });
const page = (o) => pageOf(H, o);

const answered = (o = {}) => jobOf({ state: 'answered', step: 'ready', updatedAt: 9, result: { candidate: null, parent: 2, changes: [], validation: null,
  summary: { en: 'I cannot give you coins: prices and rewards are the game\'s own.', bg: 'Не мога да ти дам монети.', possible: false,
    try: [{ en: 'A Moon Lantern', bg: 'Лунен фенер' }] } }, ...o });

test('H1: Harvey\'s answer opens by itself as his reply: his words, the chip row, OK; the pill says so', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: answered() });
  assert.equal(p.shell.panels.top(), 'helper-ready', 'the reply opens by itself');
  assert.equal(p.shell.entry('helper-ready').title, 'Harvey answered');
  const body = p.shell.body('helper-ready');
  const text = textOf(body);
  assert.match(text, /You asked for Give me 10000 coins Harvey says I cannot give you coins/);
  assert.match(text, /Nothing on your farm changed\./);
  assert.doesNotMatch(text, /did not pass the tests|Apply/);
  const chips = [...body.querySelectorAll('.hx-chip')].map((c) => textOf(c));
  assert.deepEqual(chips, ['A Moon Lantern', 'A blue pumpkin for autumn', 'Banitsa in the bakery'], 'his suggestion first, the row stays at 3');
  // the pill and the button while the reply waits
  p.shell.panels.close('helper-ready');
  assert.equal(p.$('.hx-pill').dataset.tone, 'answered');
  assert.equal(textOf(p.$('.hx-pill-line')), 'Harvey answered');
  assert.equal(textOf(p.$('.hx-pill-go')), 'Read it');
  assert.equal(p.$('#hx-btn').dataset.state, 'answered');
  // a chip takes the player back to Ask with it in the box (nothing is sent)
  click(p.$('.hx-pill-main'));
  click(p.shell.body('helper-ready').querySelector('[data-chip="try"]'));
  assert.equal(p.shell.panels.top(), 'helper');
  assert.equal(p.$('#hx-prompt').value, 'A Moon Lantern');
  assert.equal(p.api.called('start').length, 0);
  assert.equal(p.$('.hx-pill').hidden, true, 'the answer is read: the pill goes');
  p.helper.destroy();
});

test('H1: OK puts the answer away; the slot is free and the box is back', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: answered() });
  click(p.shell.body('helper-ready').querySelector('[data-act="ok"]'));
  assert.equal(p.shell.panels.top(), null);
  assert.equal(p.$('.hx-pill').hidden, true);
  p.helper.open();
  assert.equal(p.$('.hx-form').hidden, false);
  p.helper.destroy();
});

test('H1: a failure leads with Harvey\'s words; "Change my wish" first, "Try again" second, the codes folded', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'failed', updatedAt: 9, error: { code: 'INVALID' }, prompts: [{ at: 1, text: 'A fast llama' }],
    result: { candidate: null, changes: [], summary: { en: 'Llamas arrive at level 33; I tried a faster one and the game said no.', bg: 'Ламите идват на ниво 33.' },
      validation: { ok: false, stage: 'boot', checks: { schema: { ok: true, files: 2 } }, errors: [{ stage: 'boot', code: 'ECON_GUARD', file: 'tuning.json', path: '', message: 'x' }] } } }) });
  p.helper.openReady();
  const body = p.shell.body('helper-ready');
  const text = textOf(body);
  assert.ok(text.indexOf('Llamas arrive at level 33') < text.indexOf('What went wrong'), 'his words come first');
  const what = body.querySelector('details.hx-what');
  assert.ok(what && !what.hasAttribute('open'), 'the codes wait behind "What went wrong"');
  assert.match(textOf(what), /It made coins or XP too fast in the play test/);
  const acts = [...body.querySelectorAll('.hx-ready-acts .btn')].map((b) => [b.dataset.act, b.className.includes('btn--paper') ? 'secondary' : 'primary']);
  assert.deepEqual(acts, [['change', 'primary'], ['retry', 'secondary']]);
  click(body.querySelector('[data-act="change"]'));
  assert.equal(p.shell.panels.top(), 'helper');
  assert.equal(p.$('#hx-prompt').value, 'A fast llama', 'the old words are back in the box');
  assert.equal(p.api.called('start').length, 0, 'nothing is sent: the same wish would fail the same way');
  p.helper.destroy();
});

test('H1: a failure\'s summary that tells a change is what he was making, never what the farm has', async () => {
  // the agent wrote its usual summary, then the checks failed (mock "broken"): the farm has none of it
  const failed = (summary, id = 'j-f1') => jobOf({ id, state: 'failed', updatedAt: 9, error: { code: 'INVALID' }, prompts: [{ at: 1, text: 'Moon melons' }],
    result: { candidate: null, changes: [], summary, validation: { ok: false, stage: 'boot', checks: {}, errors: [] } } });
  const heads = (root) => [...root.querySelectorAll('.hx-h')].map((x) => textOf(x));
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: failed({ en: 'Moon Melons grow from level 14, and Mabel wrote you a letter.', bg: 'Лунни пъпеши.', possible: true }) });
  p.helper.openReady();
  const body = p.shell.body('helper-ready');
  assert.ok(heads(body).includes('What Harvey was making'), heads(body).join(' | '));
  assert.ok(!heads(body).includes('Harvey says'));
  assert.ok(textOf(body).indexOf('What Harvey was making') < textOf(body).indexOf('Moon Melons grow'));
  p.shell.panels.close('helper-ready');
  p.helper.open();
  assert.match(textOf(p.$('.hx-job.state-failed')), /Harvey could not finish this one\. What Harvey was making Moon Melons grow/);
  // his answer ("possible": false) stays his words
  p.helper.receive({ t: 'hx', e: 'job', job: failed({ en: 'I could not make the melon pass the checks.', bg: 'Не успях.', possible: false }, 'j-f2') });
  assert.match(textOf(p.$('.hx-job.state-failed')), /Harvey says I could not make the melon pass the checks/);
  p.helper.destroy();
});

test('H1: a ready pop-up another sheet pushed away comes back once that sheet closes; one the player closed stays shut', async () => {
  // e2e-harness multi-b4: the pop-up opened by itself, a level-up sheet took the screen, and nothing brought it back
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const p = await page();
  p.shell.panels.register('levelup', { title: 'Level up!', mount: () => ({}) });
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'ready', step: 'ready', updatedAt: 9, result: { candidate: 3, parent: 2, changes: [], validation: VALID } }) });
  assert.equal(p.shell.panels.top(), 'helper-ready', 'it opens by itself');
  p.shell.panels.open('levelup');
  await tick();
  p.shell.panels.close('levelup');
  await wait(450);
  assert.equal(p.shell.panels.top(), 'helper-ready', 'back once the screen is clear');
  p.shell.panels.close('helper-ready');
  await wait(450);
  assert.equal(p.shell.panels.top(), null, 'the player closed it: the pill keeps it');
  p.helper.destroy();
});

test('H3: the change list in words, with the farm\'s level and season; "Tested" folded to one line', async () => {
  const p = await page({ level: 5 });
  const changes = [
    { op: 'add', family: 'crops', id: 'x_blue_pumpkin', name: { en: 'Blue Pumpkin', bg: 'Синя тиква' }, icon: null,
      numbers: { sell: 445, seed: 356, xp: 111, minutes: 576, unlock: 9, yield: 2 }, info: { season: 'autumn' } },
    { op: 'add', family: 'decor', id: 'x_pink_fence', name: { en: 'Pink Fence' }, icon: null, numbers: { cost: 40, unlock: 1 } },
    { op: 'add', family: 'recipes', id: 'x_banitsa', name: { en: 'Banitsa' }, icon: null, numbers: { sell: 300, xp: 20, minutes: 60, unlock: 10 },
      info: { building: { id: 'bakery', name: { en: 'Bakery' } }, inputs: [{ id: 'flour', n: 2, name: { en: 'Flour' } }, { id: 'egg', n: 2, name: { en: 'Egg' } }] } },
    { op: 'add', family: 'animals', id: 'x_moon_hen', name: { en: 'Moon Hen' }, icon: null, numbers: { sell: 82, xp: 6, minutes: 20, unlock: 1 },
      info: { product: { id: 'x_moon_egg', name: { en: 'Moon Egg' } } } },
    { op: 'change', family: 'tuning', id: 'growTimeBp', knob: 'growTimeBp', bp: 8000, was: 10000, name: { en: 'growTimeBp' }, icon: null },
    { op: 'change', family: 'crops', id: 'strawberry', tuned: true, name: { en: 'Strawberry' }, icon: '/assets/icons/strawberry.png', numbers: { from: 60, minutes: 45, unlock: 4 } },
    { op: 'change', family: 'look', id: 'sky', sky: 'golden', name: { en: 'sky' }, icon: null },
    { op: 'change', family: 'look', id: 'music', tracks: [{ id: 'day-river', title: 'Down the River' }], name: { en: 'music' }, icon: null },
    { op: 'add', family: 'text', id: 'x_letter_melons', from: 'mabel', name: { en: 'Melons by moonlight' }, icon: null },
  ];
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'ready', step: 'ready', updatedAt: 9, result: { candidate: 3, parent: 2, changes, validation: VALID,
    summary: { en: 'Done.', bg: 'Готово.' } } }) });
  const body = p.shell.body('helper-ready');
  const rows = [...body.querySelectorAll('.hx-change')].map((li) => textOf(li));
  assert.match(rows[0], /Blue Pumpkin New Crop Sells for 445 coins Seed 356 coins \+111 XP Grows in 9h 36m 2 per harvest Season: autumn, now From level 9 \(your farm is 5\)/);
  assert.equal(rows[1], 'Pink Fence New Decoration Costs 40 coins');
  assert.match(rows[2], /Banitsa New Recipe In the Bakery From Flour ×2 and Egg ×2 Sells for 300 coins \+20 XP Made in 1h From level 10 \(your farm is 5\)/);
  assert.match(rows[3], /Moon Hen New Animal Gives Moon Egg every 20m, 82 coins each \+6 XP/);
  assert.equal(rows[4], 'All crops grow 20% faster Changed');
  assert.equal(rows[5], 'Strawberry Changed Grows in 1h → 45m From level 4');
  assert.equal(rows[6], 'Sky: golden Changed');
  assert.equal(rows[7], 'Music: Down the River Changed');
  assert.equal(rows[8], 'Melons by moonlight New A letter from Mabel');
  assert.ok(body.querySelector('.hx-change.is-later .hx-fact.is-warn'), 'a thing above the farm\'s level warns');
  const tested = body.querySelector('details.hx-tested');
  assert.ok(tested && !tested.hasAttribute('open'));
  assert.match(textOf(tested.querySelector('summary')), /^Tested on a copy of your farm$/);
  // a base thing's own picture
  assert.equal(body.querySelector('[data-id="strawberry"] img').getAttribute('src'), '/assets/icons/strawberry.png');
  p.helper.destroy();
});

test('H3: a failed test keeps the tested list open', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'failed', updatedAt: 9, error: { code: 'INVALID' },
    result: { changes: [], validation: { ok: false, stage: 'render', checks: { schema: { ok: true, files: 2 }, semantic: { ok: true }, boot: { ok: true } }, errors: [] } } }) });
  p.helper.openReady();
  assert.equal(p.shell.body('helper-ready').querySelector('details.hx-tested').hasAttribute('open'), true);
  p.helper.destroy();
});

test('H4: Ask unsigned with two plans starts nothing: "Choose who runs Harvey", the plans with their names', async () => {
  const api = fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: true },
    providers: [{ id: 'claude', available: true, signedIn: false }, { id: 'chatgpt', available: true, signedIn: false }] } }) });
  const p = await page({ api });
  p.helper.open();
  p.$('#hx-prompt').value = 'A pink fence';
  click(p.$('[data-act="ask"]'));
  await tick();
  assert.equal(api.called('signIn').length, 0, 'no Claude Code login is spawned for a choice nobody made');
  assert.equal(p.shell.entry('helper').args.tab, 'accounts');
  const body = p.shell.body('helper');
  assert.match(textOf(body), /Choose who runs Harvey/);
  assert.match(textOf(body), /Claude Your Claude plan[\s\S]*ChatGPT Your ChatGPT plan/);
  // the player picks ChatGPT, then changes their mind and picks Claude: the ChatGPT sign-in ends here and on the server
  click(p.$('[data-provider="chatgpt"] [data-act="signin"]'));
  await tick();
  click(p.$('[data-signin="chatgpt"] [data-act="cancelSignin"]'));
  await tick();
  assert.deepEqual(api.called('signInCancel').map((c) => c[1]), ['chatgpt']);
  p.helper.destroy();
});

test('H4: one plan: its sign-in starts by itself; signed in, the other plan\'s waiting sign-in ends, back to Ask, the wish goes', async () => {
  const one = fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: true },
    providers: [{ id: 'claude', available: true, signedIn: false }, { id: 'chatgpt', available: false, reason: 'OFF', signedIn: false }] } }) });
  const p = await page({ api: one });
  p.helper.open();
  p.$('#hx-prompt').value = 'A pink fence';
  click(p.$('[data-act="ask"]'));
  await tick();
  assert.deepEqual(one.called('signIn').map((c) => c[1]), ['claude'], 'the only plan: nothing to choose');
  assert.match(textOf(p.shell.body('helper')), /Sign in first, so Harvey can use your own plan/);
  p.helper.destroy();

  const two = fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: true },
    providers: [{ id: 'claude', available: true, signedIn: false }, { id: 'chatgpt', available: true, signedIn: false }] } }) });
  const q = await page({ api: two });
  q.helper.open();
  q.$('#hx-prompt').value = 'A pink fence';
  click(q.$('[data-act="ask"]'));
  await tick();
  click(q.$('[data-provider="claude"] [data-act="signin"]'));
  await tick();
  click(q.$('[data-provider="chatgpt"] [data-act="signin"]'));
  await tick();
  // ChatGPT finishes in the browser (its push), while the Claude login still waits for a code
  q.helper.receive({ t: 'hx', e: 'signin', provider: 'chatgpt', state: 'signed_in', signIn: { provider: 'chatgpt', state: 'signed_in', account: { label: 'chatgpt plan' } } });
  await tick(6);
  assert.deepEqual(two.called('signInCancel').map((c) => c[1]), ['claude'], 'the Claude Code login is ended on the server');
  assert.equal(q.shell.entry('helper').args.tab, 'ask', 'back on Ask');
  assert.doesNotMatch(textOf(q.shell.body('helper')), /Sign in first|Choose who runs Harvey/, 'no stale line');
  assert.equal(two.called('start').length, 1, 'the waiting wish went');
  assert.equal(two.called('start')[0][1].provider, 'chatgpt');
  q.helper.destroy();
});

test('H4: the button carries a visible "Harvey"; M17c: the consent line says "Harvey\'s changes"; both answers weigh the same', async () => {
  const p = await page({ api: fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: null },
    providers: [{ id: 'mock', available: true, signedIn: true }] } }) }) });
  assert.equal(textOf(p.$('#hx-btn .hx-btn-cap')), 'Harvey');
  p.helper.open();
  p.$('#hx-prompt').value = 'A pink fence';
  click(p.$('[data-act="ask"]'));
  await tick();
  const card = p.$('.hx-consent');
  assert.match(textOf(card), /Share my requests and Harvey's changes with the Harness Hollow team, to make the game better for everyone\./);
  const btns = [...card.querySelectorAll('.hx-consent-acts .btn')];
  assert.deepEqual(btns.map((b) => b.dataset.consent), ['no', 'yes']);
  assert.equal(btns[0].className, btns[1].className, 'one style and size for both answers');
  p.helper.destroy();
});

test('chips: one row of at most 3 under the box, the examples usable at the farm\'s level; a chip fills the box', async () => {
  const young = await page({ level: 5 });
  young.helper.open();
  const chips = [...young.$$('.hx-chip-row .hx-chip')].map((c) => textOf(c));
  assert.deepEqual(chips, ['A blue pumpkin for autumn', 'A pink fence', 'Crops grow 20% faster']);
  assert.equal(young.$$('.hx-chip-row').length, 1, 'one row');
  assert.match(textOf(young.$('.hx-can-line')), /Not prices, coins or quests/);
  click(young.$('.hx-chip-row [data-chip="ex3"]'));
  assert.equal(young.$('#hx-prompt').value, 'A pink fence');
  assert.equal(young.api.called('start').length, 0, 'a chip only fills the box');
  young.helper.destroy();
  const owners = await page({ level: 21 });
  owners.helper.open();
  assert.deepEqual([...owners.$$('.hx-chip-row .hx-chip')].map((c) => c.dataset.chip), ['ex1', 'ex2', 'ex3']);
  owners.helper.destroy();
});

test('Show me on my applied toast and on the letter; the partner\'s toast has a one-tap Undo', async () => {
  const objects = { b1: { def: 'bakery', x: 1, z: 1 } };
  const p = await page({ objects });
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, names: [{ id: 'x_banitsa', en: 'Banitsa', family: 'recipes', building: 'bakery' }] });
  assert.equal(p.shell.toasts.at(-1), 'Harvey added Banitsa');
  const act = p.shell.toastOpts.at(-1).action;
  assert.equal(act.label(), 'Show me');
  p.shell.panels.register('building', { title: 'B', mount() {} });
  act.fn();
  assert.deepEqual(p.shell.opened.at(-1), ['building', { id: 'b1', focus: 'x_banitsa' }], 'the workshop that makes it');
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 4, names: [{ id: 'x_blue_pumpkin', en: 'Blue Pumpkin', family: 'crops' }] });
  p.shell.toastOpts.at(-1).action.fn();
  assert.deepEqual(p.shell.opened.at(-1), ['market', { tab: 'seeds', focus: 'x_blue_pumpkin' }]);
  p.helper.destroy();
  // the partner hears it with an Undo in one tap
  const q = await page({ pid: 'p2' });
  q.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, names: [{ id: 'x_moon_melon', en: 'Moon Melon', family: 'crops' }] });
  assert.equal(q.shell.toasts.at(-1), 'Rowan\'s helper added Moon Melon');
  const undo = q.shell.toastOpts.at(-1).action;
  assert.equal(undo.label(), 'Undo');
  await undo.fn();
  assert.deepEqual(q.api.called('undo')[0], ['undo'], 'back to the version before it');
  q.helper.destroy();
});

test('the letter\'s Show me is its own change\'s thing, also when the letter comes before the applied push', async () => {
  // walk on the owners' copy (360 x 640, 05:52): the content push came first and the letter had no Show me
  const p = await page({ pid: 'p2' });
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 2, names: [{ id: 'x_blue_pumpkin', en: 'Blue Pumpkin', family: 'crops' }] });
  const letters = [{ id: 'x_letter_melons', from: 'mabel', en: { title: 'Melons by moonlight', body: 'Dear both' }, bg: { title: 'Пъпеши', body: 'Мили' } }];
  p.helper.receive({ t: 'hx', e: 'content', n: 3, text: { letters } });
  assert.equal(p.shell.panels.top(), 'helper-letter');
  const body = p.shell.body('helper-letter');
  assert.equal(body.querySelector('[data-act="show"]'), null, 'never the last change\'s pumpkin');
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, names: [{ id: 'x_moon_melon', en: 'Moon Melon', family: 'crops' }] });
  click(body.querySelector('[data-act="show"]'));
  assert.deepEqual(p.shell.opened.at(-1), ['market', { tab: 'seeds', focus: 'x_moon_melon' }]);
  p.helper.destroy();
});

test('H6: in Bulgarian the undo toast writes the names inside the sentence in lower case, like the applied toast', async () => {
  // walk on the owners' copy (iPhone 13): "Rowan върна назад промяна: Лунен пъпеш и Пай с пъпеш вече не се продават"
  const M = await import('../public/js/ui/harness/model.js');
  const players = { p1: { name: 'Rowan' }, p2: { name: 'Mia' } };
  const names = [{ en: 'Moon Melon', bg: 'Лунен пъпеш' }, { en: 'Melon Pie', bg: 'Пай с пъпеш' }];
  assert.deepEqual(M.undoneLine({ by: 'p1', n: 3, names }, 'p2', players, 'bg').params.things, ['лунен пъпеш', 'пай с пъпеш'], 'after "промяна:"');
  assert.deepEqual(M.undoneLine({ by: 'p1', n: 3, names }, 'p1', players, 'bg').params.things, ['Лунен пъпеш', 'пай с пъпеш'], 'the sentence starts with the first');
  assert.deepEqual(M.undoneLine({ by: 'p1', n: 3, names }, 'p2', players, 'en').params.things, ['Moon Melon', 'Melon Pie']);
});

test('H6: the partner\'s ready changes wait for them by name; discarding names whose work; the undo toast names what left', async () => {
  const p = await page({ pid: 'p2' });
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'ready', step: 'ready', updatedAt: 9, result: { candidate: 3, changes: [], validation: VALID } }) });
  assert.equal(textOf(p.$('.hx-pill-line')), 'Rowan\'s changes are ready, waiting for Rowan');
  p.helper.open();
  // the panel says it waits, never that the helper is still "working on" it (harvey#11)
  const panel = textOf(p.shell.body('helper'));
  assert.match(panel, /Rowan's changes are ready, waiting for Rowan/);
  assert.match(panel, /One change at a time: Rowan's changes are waiting for Rowan/);
  assert.doesNotMatch(panel, /is working/);
  p.shell.confirmAnswer = false;
  click(p.shell.body('helper').querySelector('[data-act="cancel"]'));
  await tick();
  assert.equal(p.shell.confirms[0].title, 'Discard Rowan\'s changes?');
  assert.equal(p.shell.confirms[0].lead, 'Rowan will not be able to apply them. Nothing on the farm changes.');
  p.helper.receive({ t: 'hx', e: 'undone', by: 'p1', n: 5, to: 2, names: [{ id: 'x_moon_melon', en: 'Moon Melon' }, { id: 'x_melon_pie', en: 'Melon Pie' }] });
  assert.equal(p.shell.toasts.at(-1), 'Rowan undid a change: Moon Melon and Melon Pie left the shop; what you have keeps working.');
  p.helper.destroy();
});

test('H6: History shows the first wish and "+1 change"; on an undo version the button brings the change back by name', async () => {
  const api = fakeApi({ history: () => ({ ok: true, status: 200, data: { active: 4, versions: [
    { n: 4, at: 6, by: 'p1', kind: 'undo', title: { en: 'The Farm As It Was' }, parent: 3, undoTo: 0, changes: [], state: 'active' },
    { n: 3, at: 5, by: 'p1', kind: 'apply', title: { en: 'Moonlight Harvest' }, parent: 0, prompt: 'And a lantern', prompts: ['Moon melons, please', 'And a lantern'], changes: [], state: 'past' },
  ] } }) });
  const p = await page({ api });
  p.helper.open('history');
  await tick();
  const body = p.shell.body('helper');
  assert.match(textOf(body), /Asked: “Moon melons, please” \+1 change/);
  const back = body.querySelector('[data-act="bringBack"]');
  assert.equal(textOf(back), 'Bring back Moonlight Harvest');
  click(back);
  await tick();
  assert.deepEqual(api.called('undo')[0], ['undo', undefined], 'the server\'s own "undo the last" re-applies its parent');
  p.helper.destroy();
});
