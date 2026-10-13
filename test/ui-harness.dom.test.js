// The helper's screens end to end against a stand-in shell and a scripted server (public/js/ui/harness/index.js; the
// shapes are the contract's, docs/agent-notes/harness-contract.md §4, §5). Single mode: this file runs as a page at '/'.
// The player asks (consent once, sign-in when needed), keeps playing while the pill shows each step, sees the
// changes-ready pop-up by itself, applies, asks for changes, discards; the partner sees a passive pill and the toast;
// history and undo; a failed job told honestly; Settings › Helper; letters; and a build without the harness calls nothing.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

/** Every text node under `el`, joined with spaces (the stand-in DOM has no layout to put them apart). */
function textOf(el) {
  const out = [];
  const walk = (n) => { if (!n) return; if (!n.childNodes || (n.data !== undefined && !n.tagName)) { if (n.data) out.push(n.data); return; } n.childNodes.forEach(walk); };
  walk(el);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
}
globalThis.location = { pathname: '/', origin: 'http://localhost:4330', protocol: 'http:', host: 'localhost:4330', search: '', hash: '', reload() {}, assign() {} };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();

let H;
before(async () => { H = await import('../public/js/ui/harness/index.js'); });

const tick = (n = 3) => new Promise((r) => { let i = 0; const go = () => (++i >= n ? r() : setTimeout(go, 0)); setTimeout(go, 0); });

/** The ui shell's panel registry as far as the helper uses it, mounting panels into the fake DOM. */
function fakeShell() {
  const specs = new Map();
  const stack = [];
  const entries = new Map();
  const handlers = { open: new Set(), close: new Set() };
  const toasts = [];
  const notices = [];
  const confirms = [];
  const shell = { confirmAnswer: true };
  const panels = {
    register(name, spec) { specs.set(name, spec); return () => specs.delete(name); },
    has: (n) => specs.has(n),
    isOpen: (n) => stack.includes(n),
    top: () => stack.at(-1) ?? null,
    open(name, args = {}, { stack: onTop = false } = {}) {
      const spec = specs.get(name);
      if (!spec) return false;
      if (stack.includes(name)) panels.close(name);
      if (!onTop) for (const n of [...stack]) panels.close(n);
      const tabs = typeof spec.tabs === 'function' ? spec.tabs(args) : spec.tabs;
      const body = document.createElement('div');
      const e = { name, body, cleanups: [], args, title: '' };
      const ctx = {
        name, args, tab: args.tab ?? tabs?.[0]?.id ?? null, ui: { panels }, body,
        close: () => panels.close(name), setTitle: (x) => { e.title = String(x); },
        on(target, ev, fn) { const off = target.on(ev, fn); e.cleanups.push(off); return off; },
      };
      e.title = typeof spec.title === 'function' ? spec.title(args) : spec.title;
      e.inst = spec.mount(body, ctx) || {};
      document.body.append(body);
      stack.push(name);
      entries.set(name, e);
      for (const fn of [...handlers.open]) fn(name, args);
      return true;
    },
    close(name) {
      const i = stack.indexOf(name);
      if (i < 0) return false;
      stack.splice(i, 1);
      const e = entries.get(name);
      for (const off of e.cleanups) off();
      e.inst.destroy?.();
      e.body.remove();
      specs.get(name).onClose?.();
      for (const fn of [...handlers.close]) fn(name);
      return true;
    },
    on(ev, fn) { handlers[ev]?.add(fn); return () => handlers[ev]?.delete(fn); },
  };
  const ui = {
    panels,
    toast: (x) => { toasts.push(String(x)); },
    notice: (x) => { notices.push(String(x)); },
    confirm: async (o) => { confirms.push(o); return shell.confirmAnswer; },
  };
  return Object.assign(shell, { ui, panels, toasts, notices, confirms, body: (n) => entries.get(n)?.body, entry: (n) => entries.get(n) });
}

function fakeStore(pid = 'p1') {
  const subs = new Map();
  return {
    pid,
    state: { players: { p1: { name: 'Rowan' }, p2: { name: 'Mia' } } },
    on(ev, fn) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev).delete(fn); },
    emit(ev, x) { for (const fn of subs.get(ev) ?? []) fn(x); },
  };
}

const VALID = { ok: true, stage: 'done', full: true, checks: { schema: { ok: true, files: 5 }, semantic: { ok: true },
  boot: { ok: true, simHours: 48, actions: 212, econ: { coinsBp: 10350, xpBp: 10120 }, retire: true }, render: { ok: true, models: 2, icons: 4 } } };
const CHANGES = [
  { op: 'add', family: 'crops', id: 'x_moon_melon', name: { en: 'Moon Melon', bg: 'Лунен пъпеш' }, icon: null, numbers: { sell: 124, seed: 149, xp: 47, minutes: 90, unlock: 14 } },
  { op: 'add', family: 'recipes', id: 'x_melon_pie', name: { en: 'Melon Pie', bg: 'Пъпешов пай' }, icon: null, numbers: { sell: 410, xp: 20, minutes: 45, unlock: 15 } },
];
const jobOf = (o = {}) => ({ id: 'j1', by: 'p1', provider: 'mock', model: null, state: 'working', step: 'building', round: 1, startedAt: 1, updatedAt: 2, lang: 'en',
  prompts: [{ at: 1, text: 'A pale blue melon and a pie' }], progress: [{ at: 2, step: 'building', note: 'Writing the melon' }], result: null, error: null, ...o });
const readyJob = (o = {}) => jobOf({ state: 'ready', step: 'ready', updatedAt: 9, result: { candidate: 3, parent: 2, summary: { en: 'I added a glowing melon and a pie.', bg: 'Добавих светещ пъпеш и пай.' }, changes: CHANGES, validation: VALID }, ...o });

/** A scripted server: answers per method (a value or a function of the call's arguments), records every call. */
function fakeApi(over = {}) {
  const calls = [];
  const ok = (data, status = 200) => ({ ok: true, status, data });
  const answers = {
    state: () => ok({ enabled: true, providers: [{ id: 'mock', available: true, signedIn: true, account: { label: 'test' } }, { id: 'claude', available: false, reason: 'HOST_NOT_ALLOWED', signedIn: false }],
      job: null, active: { n: 2, hash: 'h2', appliedAt: 1, by: 'p1', title: { en: 'Moonlight' } }, consent: { telemetry: true, sending: false }, limits: {} }),
    start: (b) => ok({ job: jobOf({ state: 'starting', step: 'reading', prompts: [{ at: 1, text: b.prompt }] }) }, 202),
    current: () => ok({ job: null }),
    revise: (id, prompt) => ok({ job: jobOf({ id, state: 'revising', step: 'reading', round: 2, updatedAt: 20, prompts: [{ at: 1, text: 'x' }, { at: 2, text: prompt }] }) }, 202),
    apply: () => ok({ active: { n: 3, hash: 'h3', appliedAt: 5, by: 'p1', title: { en: 'Moonlight' } } }),
    discard: (id) => ok({ job: jobOf({ id, state: 'discarded' }) }),
    cancel: (id) => ok({ job: jobOf({ id, state: 'cancelled', updatedAt: 99 }) }),
    history: () => ok({ active: 3, versions: [
      { n: 3, at: 5, by: 'p1', kind: 'apply', title: { en: 'Moonlight' }, prompt: 'A pale blue melon', summary: {}, changes: CHANGES, state: 'active' },
      { n: 2, at: 4, by: 'p2', kind: 'apply', title: { en: 'Lilac lantern' }, prompt: 'A lilac lantern', summary: {}, changes: [], state: 'past' },
      { n: 1, at: 3, by: 'p1', kind: 'apply', title: { en: 'Faster wheat' }, prompt: 'Wheat faster', summary: {}, changes: [], state: 'past' }] }),
    undo: () => ok({ active: { n: 2, hash: 'h2', appliedAt: 6, by: 'p1' } }),
    consent: () => ok({ telemetry: false, at: 1, install: 'feedc0de'.repeat(4) }),
    setConsent: (v) => ok({ telemetry: v, at: 2, install: 'feedc0de'.repeat(4) }),
    providers: () => ok({ providers: [] }),
    models: () => ok({ models: [{ id: 'm1', label: 'Model one' }, { id: 'm2', label: 'Model two' }] }),
    signIn: (p) => ok({ signin: { provider: p, state: 'pending', step: { kind: 'open_url', url: 'https://claude.example/oauth?x=1', expiresAt: 9e12 } } }),
    signInContinue: (p) => ok({ signin: { provider: p, state: 'signed_in', account: { label: 'Claude plan' } } }),
    signInStatus: (p) => ok({ signin: { provider: p, state: 'pending' } }),
    signOut: (p) => ok({ signin: { provider: p, state: 'signed_out' } }),
    ...over,
  };
  const api = {};
  for (const m of Object.keys(answers)) {
    api[m] = async (...a) => { calls.push([m, ...a]); const x = answers[m]; return typeof x === 'function' ? x(...a) : x; };
  }
  api.calls = calls;
  api.answers = answers;
  api.called = (m) => calls.filter((c) => c[0] === m);
  return api;
}

/** One page: a fresh body with the HUD's right edge column, the shell, the store and the helper. */
async function page({ pid = 'p1', api = fakeApi(), overlayApi = null, win = {}, connect = true } = {}) {
  document.body.replaceChildren();
  const edge = document.createElement('nav');
  edge.id = 'hud-right';
  const zoom = document.createElement('button');
  zoom.className = 'edge-btn';
  edge.append(zoom);
  document.body.append(edge);
  globalThis.localStorage.clear();
  const shell = fakeShell();
  const store = fakeStore(pid);
  const helper = H.createHarnessUi({ ui: shell.ui, store }, { api, bus: null, overlayApi, win, pollMs: 0, signInPollMs: 0, fallbackMs: 5, autoStart: false });
  if (connect) await helper.connect({ force: true });
  await tick();
  return { shell, store, helper, api, edge, $: (sel) => document.body.querySelector(sel), $$: (sel) => document.body.querySelectorAll(sel) };
}

const click = (el) => { assert.ok(el, 'the button is there'); el.click(); };

test('a build without the harness: no bus, no force: nothing is requested and no button shows', async () => {
  const api = fakeApi();
  document.body.replaceChildren();
  const shell = fakeShell();
  const helper = H.createHarnessUi({ ui: shell.ui, store: fakeStore() }, { api, win: {}, pollMs: 0, autoStart: false, doc: { querySelector: () => null, getElementById: () => null } });
  await helper.connect();
  assert.equal(api.calls.length, 0);
  assert.equal(helper.enabled(), false);
  helper.destroy();
});

test('the server says the helper is off: no button; on: the button tops the right edge column', async () => {
  const off = await page({ api: fakeApi({ state: { ok: true, status: 200, data: { enabled: false } } }) });
  assert.equal(off.helper.enabled(), false);
  assert.equal(off.$('#hx-btn')?.closest('#hx-dock')?.hidden ?? true, true);
  off.helper.destroy();
  const on = await page();
  assert.equal(on.helper.enabled(), true);
  assert.equal(on.edge.firstChild.id, 'hx-dock', 'first in the column, above zoom');
  assert.equal(on.$('#hx-dock').hidden, false);
  assert.equal(on.$('#hx-btn').getAttribute('aria-label'), 'Harvey, your helper: ask for a change to your farm');
  assert.equal(on.$('.hx-pill').hidden, true, 'no job, no pill');
  on.helper.destroy();
});

test('asking: the request goes out with the provider and language, the pill shows each step, and the game goes on', async () => {
  const p = await page();
  click(p.$('#hx-btn'));
  assert.equal(p.shell.panels.top(), 'helper');
  const area = p.$('#hx-prompt');
  area.value = 'A pale blue melon that glows, and a pie';
  area.dispatch('input');
  click(p.$('[data-act="ask"]'));
  await tick();
  assert.deepEqual(p.api.called('start')[0][1], { prompt: 'A pale blue melon that glows, and a pie', provider: 'mock', model: null, lang: 'en' });
  assert.match(textOf(p.shell.body('helper')), /The helper is on it/);
  assert.match(textOf(p.shell.body('helper')), /Your helper is working on/);
  // the player closes the panel ("Keep playing") and plays; the pill tells the steps
  click(p.shell.body('helper').querySelector('[data-act="play"]'));
  assert.equal(p.shell.panels.top(), null);
  const pill = p.$('.hx-pill');
  assert.equal(pill.hidden, false);
  assert.equal(textOf(p.$('.hx-pill-line')), 'Reading your farm…');
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'working', step: 'building', updatedAt: 3 }) });
  assert.equal(textOf(p.$('.hx-pill-line')), 'Building your change…');
  assert.deepEqual([...p.$('.hx-pill-dots').children].map((d) => d.className), ['done', 'now', '', '']);
  assert.equal(p.$('#hx-btn').dataset.state, 'work');
  assert.match(textOf(p.$('.hx-live')), /Building your change/);
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'fixing', step: 'fixing', updatedAt: 4 }) });
  assert.equal(textOf(p.$('.hx-pill-line')), 'Fixing what the test found…');
  // an older push arriving late changes nothing
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'working', step: 'reading', updatedAt: 3 }) });
  assert.equal(textOf(p.$('.hx-pill-line')), 'Fixing what the test found…');
  // hidden by the player while it works ...
  click(p.$('.hx-pill-x'));
  assert.equal(pill.hidden, true);
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'validating', step: 'testing', updatedAt: 5 }) });
  assert.equal(pill.hidden, true, 'stays hidden for the rest of the work');
  // ... and back, with the pop-up, when it is ready
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  assert.equal(p.shell.panels.top(), 'helper-ready', 'the changes-ready pop-up opens by itself');
  p.shell.panels.close('helper-ready');
  assert.equal(pill.hidden, false);
  assert.equal(pill.dataset.tone, 'ready');
  assert.match(textOf(pill), /Your changes are ready!.*See them/);
  assert.equal(p.$('#hx-btn').dataset.state, 'ready');
  // the pop-up opens once per ready round, not on every push
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob({ updatedAt: 10 }) });
  assert.equal(p.shell.panels.top(), null);
  click(p.$('.hx-pill-main'));
  assert.equal(p.shell.panels.top(), 'helper-ready');
  p.helper.destroy();
});

test('the ready pop-up waits while another panel is open, then comes', async () => {
  const p = await page();
  p.shell.panels.register('market', { title: 'Market', mount() {} });
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf() });
  p.shell.panels.open('market');
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  assert.equal(p.shell.panels.top(), 'market', 'never over the player\'s panel');
  p.shell.panels.close('market');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(p.shell.panels.top(), 'helper-ready');
  p.helper.destroy();
});

test('the ready pop-up: summary, every change with its numbers, the tests; Apply puts it on the farm and both farmers hear it', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  const body = p.shell.body('helper-ready');
  const text = textOf(body);
  assert.match(text, /I added a glowing melon and a pie\./);
  assert.match(text, /Moon Melon New Crop Sells for 124 coins Seed 149 coins \+47 XP Grows in 1h 30m From level 14/);
  assert.match(text, /Melon Pie New Recipe Sells for 410 coins \+20 XP Made in 45m From level 15/);
  assert.match(text, /Files read cleanly \(5 files\)/);
  assert.match(text, /Played 48 hours on a copy of your farm: 212 actions, all fine/);
  assert.match(text, /Coins per hour \+3\.5%, XP per hour \+1\.2%: inside the safe limit/);
  assert.match(text, /Can be undone safely/);
  assert.equal(body.querySelectorAll('.hx-test.is-ok').length, 6);
  assert.equal(p.shell.entry('helper-ready').title, 'Changes ready');
  click(body.querySelector('[data-act="apply"]'));
  await tick();
  assert.deepEqual(p.api.called('apply')[0], ['apply', 'j1']);
  assert.equal(p.shell.panels.isOpen('helper-ready'), false);
  assert.equal(p.$('.hx-pill').hidden, true);
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, title: { en: 'Moonlight' }, names: [{ id: 'x_moon_melon', en: 'Moon Melon', bg: 'Лунен пъпеш' }, { id: 'x_melon_pie', en: 'Melon Pie', bg: 'Пъпешов пай' }], summary: {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(p.shell.toasts, ['Harvey added Moon Melon and Melon Pie'], 'said once, not again by the fallback');
  p.helper.destroy();
});

test('apply without a push still tells the farmer (a lost hx), once', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  click(p.shell.body('helper-ready').querySelector('[data-act="apply"]'));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(p.shell.toasts, ['Harvey added Moon Melon and Melon Pie']);
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, names: [{ en: 'Moon Melon' }] });
  assert.equal(p.shell.toasts.length, 1);
  p.helper.destroy();
});

test('ask for changes, rebuild on a stale farm, discard with a confirm', async () => {
  const p = await page({ api: fakeApi({ apply: { ok: false, status: 409, code: 'STALE', data: { error: 'STALE' } } }) });
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  let body = p.shell.body('helper-ready');
  click(body.querySelector('[data-act="apply"]'));
  await tick();
  assert.match(textOf(body), /Your farm changed while the helper worked/);
  click(body.querySelector('[data-act="rebuild"]'));
  await tick();
  assert.deepEqual(p.api.called('revise')[0], ['revise', 'j1', 'Please build the same changes again on top of the farm\'s newest version.']);
  assert.equal(p.shell.panels.isOpen('helper-ready'), false, 'back to playing while it rebuilds');
  assert.equal(textOf(p.$('.hx-pill-line')), 'Reading your farm…');
  // round 2 ready: the pop-up comes again; Ask for changes opens the box, Send revises
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob({ round: 2, updatedAt: 30 }) });
  body = p.shell.body('helper-ready');
  click(body.querySelector('[data-act="revise"]'));
  const box = body.querySelector('#hx-revise');
  assert.ok(box, 'the "what should be different" box opens');
  box.value = 'Make the melon pinker';
  click(body.querySelector('[data-act="reviseSend"]'));
  await tick();
  assert.equal(p.api.called('revise')[1][2], 'Make the melon pinker');
  // discard: "Keep them" keeps them; "Discard" throws them away
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob({ round: 3, updatedAt: 40 }) });
  p.shell.confirmAnswer = false;
  click(p.shell.body('helper-ready').querySelector('[data-act="discard"]'));
  await tick();
  assert.equal(p.api.called('discard').length, 0);
  p.shell.confirmAnswer = true;
  click(p.shell.body('helper-ready').querySelector('[data-act="discard"]'));
  await tick();
  assert.equal(p.api.called('discard').length, 1);
  assert.equal(p.shell.confirms.at(-1).title, 'Discard them?');
  assert.ok(p.shell.toasts.includes('Changes discarded. Your farm stays as it was.'));
  assert.equal(p.$('.hx-pill').hidden, true);
  p.helper.destroy();
});

test('a push that overtakes the revise answer keeps the next ready pop-up open (the answer is older news)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const api = fakeApi({ revise: async (id, prompt) => { await gate; return { ok: true, status: 202, data: { job: jobOf({ id, state: 'revising', step: 'reading', round: 2, updatedAt: 20, prompts: [{ at: 1, text: prompt }] }) } }; } });
  const p = await page({ api });
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  click(p.shell.body('helper-ready').querySelector('[data-act="revise"]'));
  p.shell.body('helper-ready').querySelector('#hx-revise').value = 'Pinker';
  click(p.shell.body('helper-ready').querySelector('[data-act="reviseSend"]'));
  // the server's pushes arrive first: revising, then round 2 ready
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'revising', step: 'reading', round: 2, updatedAt: 20 }) });
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob({ round: 2, updatedAt: 40 }) });
  assert.equal(p.shell.panels.top(), 'helper-ready');
  release();
  await tick();
  assert.equal(p.shell.panels.top(), 'helper-ready', 'the late answer must not close the round 2 pop-up');
  assert.equal(p.helper.snapshot().job.round, 2);
  assert.equal(p.shell.body('helper-ready').querySelector('[data-act="apply"]').disabled, false, 'and its Apply is pressable once the answer is in');
  p.helper.destroy();
});

test('consent is asked once, before the first change; the request then goes out by itself', async () => {
  const api = fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, providers: [{ id: 'mock', available: true, signedIn: true }], job: null, active: null, consent: { telemetry: null } } }) });
  const p = await page({ api });
  p.helper.open();
  const area = p.$('#hx-prompt');
  area.value = 'A lilac lantern';
  click(p.$('[data-act="ask"]'));
  await tick();
  assert.equal(api.called('start').length, 0, 'nothing goes before the answer');
  const card = p.$('.hx-consent');
  assert.match(textOf(card), /Share my requests and mods with the Harness Hollow team to improve the game for everyone\./);
  assert.equal(p.$('.hx-form').hidden, true);
  click(card.querySelector('[data-consent="no"]'));
  await tick();
  assert.deepEqual(api.called('setConsent')[0], ['setConsent', false]);
  assert.equal(api.called('start').length, 1);
  assert.equal(api.called('start')[0][1].prompt, 'A lilac lantern');
  assert.equal(p.$('.hx-consent'), null, 'asked once');
  p.helper.destroy();
});

test('not signed in: the request waits for Claude Code\'s own sign-in (open the page, paste the code), then goes', async () => {
  const api = fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: true },
    providers: [{ id: 'claude', available: true, signedIn: false }, { id: 'chatgpt', available: true, signedIn: false }] } }) });
  const p = await page({ api });
  p.helper.open();
  p.$('#hx-prompt').value = 'Crops grow a little faster';
  click(p.$('[data-act="ask"]'));
  await tick();
  assert.equal(p.shell.entry('helper').inst !== undefined && p.shell.panels.top(), 'helper');
  assert.deepEqual(api.called('signIn')[0], ['signIn', 'claude', {}]);
  const flow = p.$('[data-signin="claude"]');
  assert.ok(flow, 'the sign-in steps show');
  const link = flow.querySelector('[data-signin-open="claude"]');
  assert.equal(link.getAttribute('href'), 'https://claude.example/oauth?x=1');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.match(textOf(flow), /Copy the code the page shows you and paste it here/);
  assert.match(textOf(flow), /Your sign-in stays with Claude Code on the farm's server/);
  const input = flow.querySelector('input');
  input.value = 'ABCD-1234';
  click(flow.querySelector('[data-act="continue"]'));
  await tick(6);
  assert.deepEqual(api.called('signInContinue')[0], ['signInContinue', 'claude', { code: 'ABCD-1234' }]);
  assert.match(textOf(p.shell.body('helper')), /Signed in to Claude/);
  assert.equal(api.called('start').length, 1, 'the waiting request went out');
  assert.equal(api.called('start')[0][1].provider, 'claude');
  p.helper.destroy();
});

test('ChatGPT: the final address is pasted back; a refused sign-in says why; a page URL that is not https is never a link', async () => {
  const api = fakeApi({
    state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: false }, providers: [{ id: 'chatgpt', available: true, signedIn: false }] } }),
    signIn: (pv) => ({ ok: true, status: 200, data: { signin: { provider: pv, state: 'pending', step: { kind: 'open_url', url: 'https://auth.openai.com/api/accounts/authorize?client_id=x' } } } }),
    signInContinue: (pv) => ({ ok: true, status: 200, data: { signin: { provider: pv, state: 'error', error: { code: 'DENIED' } } } }),
  });
  const p = await page({ api });
  p.helper.open('accounts');
  click(p.$('[data-provider="chatgpt"] [data-act="signin"]'));
  await tick();
  const flow = p.$('[data-signin="chatgpt"]');
  assert.match(textOf(flow), /starts with http:\/\/127\.0\.0\.1/);
  assert.match(textOf(flow), /If this device runs the farm's server, the sign-in finishes by itself/);
  const input = flow.querySelector('input');
  assert.equal(input.dataset.field, 'redirect_url');
  input.value = 'http://127.0.0.1:4330/auth/callback?code=abc&state=xyz';
  click(flow.querySelector('[data-act="continue"]'));
  await tick();
  assert.deepEqual(api.called('signInContinue')[0][2], { redirectUrl: 'http://127.0.0.1:4330/auth/callback?code=abc&state=xyz' });
  assert.match(textOf(p.$('[data-signin="chatgpt"]')), /The sign-in was not allowed/);
  assert.ok(p.$('[data-signin="chatgpt"] [data-act="restart"]'));
  // a push from the server's own callback finishes it
  p.helper.receive({ t: 'hx', e: 'signin', provider: 'chatgpt', state: { state: 'signed_in', account: { label: 'f***@example.com' } } });
  await tick();
  assert.match(textOf(p.shell.body('helper')), /Signed in to ChatGPT/);
  const { safeUrl } = await import('../public/js/ui/harness/views.js');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('http://evil.example/x'), null);
  assert.equal(safeUrl('//evil.example/x'), null);
  assert.equal(safeUrl('/api/harness/mock/signin?state=s'), '/api/harness/mock/signin?state=s');
  p.helper.destroy();
});

test('providers: an unavailable one says why; use, model and sign out', async () => {
  const api = fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: true },
    providers: [{ id: 'claude', available: false, reason: 'HOST_NOT_ALLOWED', signedIn: false }, { id: 'chatgpt', available: true, signedIn: true, account: { label: 'f***@example.com' } },
      { id: 'mock', available: true, signedIn: true }] } }) });
  const p = await page({ api });
  p.helper.open('accounts');
  await tick();
  assert.match(textOf(p.$('[data-provider="claude"]')), /Not available here: This hosted server does not offer it yet\./);
  assert.equal(p.$('[data-provider="claude"] [data-act="signin"]'), null, 'never offered when it cannot be used');
  assert.match(textOf(p.$('[data-provider="chatgpt"]')), /Signed in: f\*\*\*@example\.com/);
  click(p.$('[data-provider="mock"] [data-act="use"]'));
  await tick();
  assert.equal(p.helper.snapshot().prefs.provider, 'mock');
  click(p.$('[data-provider="chatgpt"] [data-act="use"]'));
  await tick();
  const sel = p.$('[data-provider="chatgpt"] select');
  assert.ok(sel, 'two models: a choice');
  sel.value = 'm2';
  sel.dispatch('change', { target: sel });
  assert.equal(p.helper.snapshot().prefs.model, 'm2');
  click(p.$('[data-provider="chatgpt"] [data-act="signout"]'));
  await tick();
  assert.deepEqual(api.called('signOut')[0], ['signOut', 'chatgpt']);
  assert.ok(p.shell.toasts.includes('Signed out of ChatGPT.'));
  p.helper.destroy();
});

test('the partner: a passive pill, no pop-up, the request box waits its turn, and the toast names who', async () => {
  const p = await page({ pid: 'p2' });
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf() });
  assert.equal(textOf(p.$('.hx-pill-line')), 'Rowan\'s helper is working…');
  assert.equal(p.$('.hx-pill').dataset.tone, 'partner');
  p.helper.open();
  assert.match(textOf(p.shell.body('helper')), /One change at a time: Rowan's helper is working/);
  assert.equal(p.$('.hx-form').hidden, true);
  // any farmer may stop it (the server allows it, so a job never holds the farm), after a confirm that says whose it is
  p.shell.confirmAnswer = false;
  click(p.shell.body('helper').querySelector('[data-act="cancel"]'));
  await tick();
  assert.equal(p.shell.confirms[0].lead, 'Rowan asked for this. Nothing on the farm changes.');
  assert.equal(p.api.called('cancel').length, 0, '"Let it work" stops nothing');
  p.shell.panels.close('helper');
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  assert.equal(p.shell.panels.top(), null, 'no pop-up for the partner');
  assert.equal(textOf(p.$('.hx-pill-line')), 'Rowan\'s helper has changes ready');
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, names: [{ id: 'x_moon_melon', en: 'Moon Melon' }] });
  p.helper.receive({ t: 'hx', e: 'applied', by: 'p1', n: 3, names: [{ id: 'x_moon_melon', en: 'Moon Melon' }] });
  assert.deepEqual(p.shell.toasts, ['Rowan\'s helper added Moon Melon']);
  assert.equal(p.$('.hx-pill').hidden, true);
  p.helper.receive({ t: 'hx', e: 'undone', by: 'p1', n: 2, to: 2 });
  assert.equal(p.shell.toasts.at(-1), 'Rowan undid a helper change.');
  p.helper.receive({ t: 'hx', e: 'suspended', n: 4 });
  assert.match(p.shell.notices.at(-1), /paused after a game update/);
  p.helper.destroy();
});

test('a failed job is told honestly: what went wrong in plain words, nothing changed, try again', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'failed', updatedAt: 9, error: { code: 'INVALID' },
    result: { changes: CHANGES, validation: { ok: false, stage: 'semantic', checks: { schema: { ok: true, files: 2 } },
      errors: [{ stage: 'semantic', code: 'ECON_BOUND', file: 'content/recipes/x_melon_pie.json', path: 'minutes', message: 'add < 15 %' }] } } }) });
  assert.equal(p.$('.hx-pill').dataset.tone, 'fail');
  assert.equal(p.$('#hx-btn').dataset.state, 'fail');
  click(p.$('.hx-pill-main'));
  const text = textOf(p.shell.body('helper'));
  assert.match(text, /The helper could not finish this one\./);
  assert.match(text, /The change did not pass the tests, even after fixing\./);
  assert.match(text, /Melon Pie: It would have earned more than the game allows\./);
  assert.match(text, /Nothing on your farm changed\./);
  click(p.shell.body('helper').querySelector('[data-act="retry"]'));
  await tick();
  assert.equal(p.api.called('start')[0][1].prompt, 'A pale blue melon and a pie');
  p.helper.destroy();
});

// developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery (verifier defect 4): the usage limit links to
// ChatGPT settings › Usage (no reset time guessed), plan use not allowed for the account is explained, and an account
// ChatGPT could not confirm keeps the sign-in
test('ChatGPT errors as OpenAI\'s errors page asks: the usage link, "not eligible", "not confirmed"', async () => {
  const failedWith = async (provider, code) => {
    const p = await page();
    p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ provider, state: 'failed', updatedAt: 9, error: { code } }) });
    click(p.$('.hx-pill-main'));
    const body = p.shell.body('helper');
    const links = [...body.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: textOf(a) }));
    const out = { text: textOf(body), links };
    p.helper.destroy();
    return out;
  };
  const gpt = await failedWith('chatgpt', 'USAGE_LIMIT');
  assert.match(gpt.text, /ChatGPT plan/);
  assert.doesNotMatch(gpt.text, /used up|try again later/i, 'no guess that the whole plan is empty or when it resets');
  assert.deepEqual(gpt.links, [{ href: 'https://chatgpt.com/settings/usage', target: '_blank', rel: 'noopener noreferrer', text: 'ChatGPT settings › Usage' }]);
  const claude = await failedWith('claude', 'USAGE_LIMIT');
  assert.match(claude.text, /Your plan's limit is used up for now/);
  assert.deepEqual(claude.links, [], 'the ChatGPT link is for ChatGPT only');
  const ne = await failedWith('chatgpt', 'NOT_ELIGIBLE');
  assert.match(ne.text, /ChatGPT does not allow your plan to be used here/);
  const ac = await failedWith('chatgpt', 'ACCOUNT_CHECK');
  assert.match(ac.text, /ChatGPT could not confirm your account just now\. You are still signed in/);
});

test('stop the helper: one press, it says so, the pill goes', async () => {
  const p = await page();
  p.helper.receive({ t: 'hx', e: 'job', job: jobOf() });
  p.helper.open();
  click(p.shell.body('helper').querySelector('[data-act="cancel"]'));
  await tick();
  assert.deepEqual(p.api.called('cancel')[0], ['cancel', 'j1']);
  assert.deepEqual(p.shell.toasts, ['The helper stopped. Nothing on your farm changed.']);
  assert.equal(p.$('.hx-pill').hidden, true);
  p.helper.destroy();
});

test('history and undo: the versions, the last change undone or an older version brought back, each after a confirm', async () => {
  const p = await page();
  p.helper.open('history');
  await tick();
  const body = p.shell.body('helper');
  const text = textOf(body);
  assert.match(text, /Version 3 Applied On the farm now Moonlight Rowan/);
  assert.match(text, /Asked: “A pale blue melon”/);
  assert.match(text, /Version 2 Applied Lilac lantern Mia/);
  click(body.querySelector('[data-act="undoLast"]'));
  await tick();
  assert.match(p.shell.confirms[0].lead, /The farm goes back to version 2\./);
  assert.deepEqual(p.api.called('undo')[0], ['undo', undefined]);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(p.shell.toasts.includes('You undid a helper change.'), 'said even if the push is lost');
  click(p.shell.body('helper').querySelector('[data-n="1"] [data-act="goBack"]'));
  await tick();
  assert.deepEqual(p.api.called('undo')[1], ['undo', 1]);
  p.shell.confirmAnswer = false;
  click(p.shell.body('helper').querySelector('[data-act="undoLast"]'));
  await tick();
  assert.equal(p.api.called('undo').length, 2, '"Keep it" undoes nothing');
  p.helper.destroy();
});

test('Settings › Helper: the sharing switch (off by default), the install id, sign-outs', async () => {
  const p = await page({ api: fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: null },
    providers: [{ id: 'chatgpt', available: true, signedIn: true, account: { label: 'f***@example.com' } }] } }) }) });
  const rows = p.helper.settingsRows({ close() {} });
  const wrap = document.createElement('div');
  wrap.append(...rows);
  document.body.append(wrap);
  await tick();
  const sw = wrap.querySelector('[data-harness="share"]');
  assert.equal(sw.getAttribute('role'), 'switch');
  assert.equal(sw.getAttribute('aria-checked'), 'false', 'never asked = off');
  assert.match(textOf(wrap), /Install id \(quote it to ask us to delete what was shared\): feedc0de/);
  click(sw);
  await tick();
  assert.deepEqual(p.api.called('setConsent')[0], ['setConsent', true]);
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.match(textOf(wrap), /ChatGPT Signed in: f\*\*\*@example\.com Sign out/);
  p.helper.destroy();
});

test('a letter a change brings shows once per farmer', async () => {
  const overlay = { text: { letters: [{ id: 'x_letter_melons', from: 'mabel', art: 'melon', en: { title: 'Melons by moonlight', body: 'My dears,\n\nThe melons glow.' }, bg: { title: 'Пъпеши', body: 'Мили мои' } }] } };
  const p = await page({ overlayApi: { installedOverlay: () => overlay } });
  assert.equal(p.shell.panels.top(), 'helper-letter');
  assert.equal(p.shell.entry('helper-letter').title, 'Melons by moonlight');
  assert.match(textOf(p.shell.body('helper-letter')), /My dears, The melons glow\./);
  p.shell.panels.close('helper-letter');
  p.helper.receive({ e: 'content', n: 3, changed: true });
  assert.equal(p.shell.panels.top(), null, 'once');
  p.helper.destroy();
});

test('speak: the 🎙 shows only where speech-to-text works, and its words land in the request box', async () => {
  const plain = await page();
  plain.helper.open();
  assert.equal(plain.$('.hx-mic'), null, 'hidden without the API (or on an http LAN page)');
  plain.helper.destroy();
  let rec = null;
  class Rec { constructor() { rec = this; } start() {} stop() { this.onend?.(); } }
  const p = await page({ win: { SpeechRecognition: Rec, isSecureContext: true } });
  p.helper.open();
  const mic = p.$('.hx-mic');
  assert.ok(mic);
  assert.equal(mic.getAttribute('aria-label'), 'Speak your idea');
  click(mic);
  assert.equal(mic.getAttribute('aria-pressed'), 'true');
  assert.equal(rec.lang, 'en-US');
  rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'a glowing melon' }], { isFinal: true })] });
  assert.equal(p.$('#hx-prompt').value, 'a glowing melon');
  click(mic);
  assert.equal(mic.getAttribute('aria-pressed'), 'false');
  assert.match(textOf(p.shell.body('helper')), /may use its maker's online service/);
  p.helper.destroy();
});

test('a server that sends nothing asks no consent question; Claude Code\'s other sign-in methods are offered too', async () => {
  const api = fakeApi({ state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: null, sending: false },
    providers: [{ id: 'claude', available: true, signedIn: false }, { id: 'mock', available: true, signedIn: true }] } }) });
  const p = await page({ api });
  p.helper.open('accounts');
  await tick();
  assert.ok(p.$('[data-provider="claude"] .hx-methods'), 'the other ways in are there, never hidden');
  click(p.$('[data-provider="claude"] [data-method="console"]'));
  await tick();
  assert.deepEqual(api.called('signIn')[0], ['signIn', 'claude', { method: 'console' }]);
  p.helper.open('ask');
  p.$('#hx-prompt').value = 'A plum pie';
  click(p.$('[data-act="ask"]'));
  await tick();
  assert.equal(p.$('.hx-consent'), null);
  assert.equal(api.called('start').length, 1);
  p.helper.destroy();
});

test('the agent lane\'s shapes: the paste box named in step.paste, the hx signin frame\'s signIn, letters from the bus', async () => {
  const api = fakeApi({
    state: () => ({ ok: true, status: 200, data: { enabled: true, job: null, consent: { telemetry: true }, providers: [{ id: 'mock', available: true, signedIn: false }] } }),
    signIn: (pv) => ({ ok: true, status: 200, data: { provider: pv, state: 'pending', step: { kind: 'open_url', url: '/api/harness/mock/signin?state=s1', expiresAt: 9e12, paste: { field: 'code' } } } }),
  });
  const letter = { id: 'x_letter_a', from: 'hazel', art: 'melon', en: { title: 'A note', body: 'Hello both.' }, bg: { title: 'Бележка', body: 'Здравейте.' } };
  const subs = new Set();
  const bus = { onHarness: (fn) => { subs.add(fn); return () => subs.delete(fn); }, harnessAuth: () => ({ pid: 'p1', token: 't'.repeat(64) }),
    lastHarness: (e) => (e === 'content' ? { e: 'content', n: 4, text: { letters: [letter], tips: [] } } : null) };
  document.body.replaceChildren();
  const edge = document.createElement('nav');
  edge.id = 'hud-right';
  document.body.append(edge);
  globalThis.localStorage.clear();
  const shell = fakeShell();
  const helper = H.createHarnessUi({ ui: shell.ui, store: fakeStore('p1') }, { api, bus, overlayApi: null, win: {}, pollMs: 0, signInPollMs: 0, fallbackMs: 5, autoStart: false });
  await helper.connect();
  await tick();
  assert.equal(shell.panels.top(), 'helper-letter', 'the letter the welcome brought, from the bus\'s last content event');
  shell.panels.close('helper-letter');
  helper.open('accounts');
  click(document.body.querySelector('[data-provider="mock"] [data-act="signin"]'));
  await tick();
  const flow = document.body.querySelector('[data-signin="mock"]');
  assert.equal(flow.querySelector('input').dataset.field, 'code', 'the server said which box');
  assert.equal(flow.querySelector('[data-signin-open="mock"]').getAttribute('href'), '/api/harness/mock/signin?state=s1');
  for (const fn of subs) fn({ t: 'hx', e: 'signin', provider: 'mock', state: 'signed_in', signIn: { provider: 'mock', state: 'signed_in', account: { label: 'test' } } });
  await tick();
  assert.match(textOf(document.body.querySelector('[data-signin="mock"]')), /Signed in to Test helper/);
  for (const fn of subs) fn({ e: 'content', n: 5, text: { letters: [letter, { ...letter, id: 'x_letter_b', en: { title: 'Two', body: 'More.' } }] } });
  assert.equal(shell.panels.top(), 'helper', 'a letter waits while a panel is open');
  shell.panels.close('helper');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(shell.panels.top(), 'helper-letter');
  assert.equal(shell.entry('helper-letter').title, 'Two', 'only the one not seen yet');
  helper.destroy();
});

test('the phone farm menu: a Helper tile while the server offers the helper; it closes the menu and opens the helper', async () => {
  const off = await page({ api: fakeApi({ state: { ok: true, status: 200, data: { enabled: false } } }) });
  assert.equal(off.helper.tile(() => {}), null, 'no tile while the helper is off');
  off.helper.destroy();
  const p = await page();
  let closed = 0;
  const tile = p.helper.tile(() => { closed += 1; });
  assert.ok(tile && tile.classList.contains('m-tile'), 'the farm menu\'s own tile class');
  assert.equal(tile.getAttribute('type'), 'button');
  assert.equal(textOf(tile), 'Harvey');
  assert.equal(tile.getAttribute('aria-label'), 'Harvey, your helper: ask for a change to your farm', 'the whole words for a screen reader');
  click(tile);
  assert.equal(closed, 1, 'the menu sheet closes first');
  assert.equal(p.shell.panels.top(), 'helper');
  p.shell.panels.closeAll?.();
  p.shell.panels.close('helper');
  // a change waiting for me: the tile says so and opens the pop-up
  p.helper.receive({ t: 'hx', e: 'job', job: readyJob() });
  await tick();
  p.shell.panels.close('helper-ready');
  const ready = p.helper.tile(() => {});
  assert.equal(ready.getAttribute('aria-label'), 'Harvey: your changes are ready');
  assert.ok(ready.querySelector('.hx-tile-dot'), 'a dot on the tile, like the button\'s');
  click(ready);
  assert.equal(p.shell.panels.top(), 'helper-ready');
  p.helper.destroy();
});

test('the focus follows the request box\'s place to the job card when it dropped, and never leaves the chat box', async () => {
  const proto = Object.getPrototypeOf(document.createElement('div'));
  const realFocus = proto.focus;
  proto.focus = function focus() { document.activeElement = this; };
  try {
    const p = await page();
    click(p.$('#hx-btn'));
    p.$('#hx-prompt').value = 'A pale blue melon';
    document.activeElement = document.body;            // the pressed button's form hid: the browser drops the focus
    click(p.$('[data-act="ask"]'));
    await tick(6);
    assert.ok(document.activeElement?.classList?.contains('hx-job'), 'the job card has the focus');
    // a keyboard player in the job card keeps the same button through a step that rebuilds the card
    p.$('.hx-job [data-act="play"]').focus();
    p.helper.receive({ t: 'hx', e: 'job', job: jobOf({ state: 'validating', step: 'testing', updatedAt: 50 }) });
    await tick();
    assert.equal(document.activeElement?.dataset?.act, 'play', 'still on Keep playing after the rebuild');
    assert.ok(document.activeElement.isConnected !== false && p.$('.hx-job').contains(document.activeElement));
    p.helper.destroy();

    // the partner's job arrives while this farmer types in the chat box: the focus stays there
    const q = await page();
    click(q.$('#hx-btn'));
    await tick();                                       // the panel puts the focus in its request box first
    const chat = document.createElement('input');
    chat.id = 'chat-input';
    document.body.append(chat);
    chat.focus();
    q.helper.receive({ t: 'hx', e: 'job', job: jobOf({ by: 'p2', updatedAt: 60 }) });
    await tick();
    assert.equal(document.activeElement, chat, 'never stolen from outside the helper');
    q.helper.destroy();
  } finally {
    proto.focus = realFocus;
    document.activeElement = null;
  }
});
