// Owner requests 2026-10-19 (Rowan): "on Phone move the icons better, nothing at the center of the screen. And for the
// people that don't want harvey so they can hide the icon in the settings."
//   1. On a phone the right column (Harvey, the turn button) stands at the top of the edge lane under the coins, never at
//      46 % of the screen; Harvey's progress pill is a small chip in that lane under the column, not a line across the farm.
//   2. Settings › Harvey "Show Harvey" (on by default, per device in hh.settings): off hides his button and pill at once;
//      the tab (and the switch) exists only while the farm's server offers Harvey.
// Proof on screen: .scratch/phone-edge/ (before/, after*/ shots and their probe JSON).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const MOBILE = strip(read('public/css/mobile.css'));
const HARNESS = strip(read('public/css/harness.css'));

/** The body of the first `@media <query> {` block of `css` (balanced braces). */
function block(css, query) {
  const at = css.indexOf(`@media ${query} {`);
  assert.ok(at >= 0, `@media ${query}`);
  let i = css.indexOf('{', at) + 1;
  let depth = 1;
  const from = i;
  for (; i < css.length && depth; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; }
  return css.slice(from, i - 1);
}

test('phone-edge: the upright phone column stands at the top of the edge lane, never in the middle', () => {
  const portrait = block(MOBILE, '(max-width: 600px)');
  assert.match(portrait, /\.hud-right \{ top: calc\(54px \+ var\(--sat\)\); \}/, 'under the coins');
  assert.doesNotMatch(MOBILE, /\.hud-right \{ top: 46%; \}/, 'HEAD: the column at 46 % of the screen, the pill across the farm');
  // it no longer follows Grandma's card up and down (her card, the trays and the bar are all below it)
  assert.doesNotMatch(MOBILE, /body\.coach-on[^{]*\.hud-right/, 'no rule moves the column with her card');
  assert.doesNotMatch(MOBILE, /body\.tray-open[^{]*\.hud-right/, 'no rule moves the column with a tray');
  assert.doesNotMatch(MOBILE, /body\.tray-open #hud-turn \{ display: none; \}/, 'the turn button stays while a tray is open');
  // the quest chip and a centred duel chip keep out of the lane
  assert.match(portrait, /\.tracker-chip-wrap \{ right: calc\(var\(--edge-lane\) \+ 8px\); \}/);
  assert.match(portrait, /#hud > \.lg-duel-chip \{ max-width: calc\(100vw - 2 \* var\(--edge-lane\)\); \}/);
  // the timers row (Golden Hour, the balloon crates' power-ups) is the slot on the left under the quest chip
  assert.match(portrait, /\.buffs \{ max-width: calc\(100vw - 12px - var\(--sal\) - var\(--edge-lane\)\); flex-wrap: wrap; \}/);
  // the lane itself (toasts, banners, notices and now the connection line stop short of it) is the phone block's,
  // upright and on its side: the column stands at the connection line's height
  const phone = block(MOBILE, '(max-width: 600px), (max-height: 500px)');
  assert.match(phone, /\.conn \{ left: calc\(8px \+ var\(--sal\)\); right: var\(--edge-lane\); width: fit-content; margin-inline: auto; transform: none;/);
  assert.match(phone, /#hud \{ --edge-lane: calc\(var\(--safe\) \+ 56px \+ var\(--sar\)\); \}/);
});

test('phone-edge: on a phone Harvey\'s pill is a chip in the lane under the column (the time so far, or the word to tap)', () => {
  const phone = block(HARNESS, '(max-width: 600px), (max-height: 500px)');
  assert.match(phone, /#hud-right > \.hx-dock \{ position: static; \}/, 'the chip hangs from the column, under the turn button');
  assert.match(phone, /\.hx-pill \{ top: calc\(100% \+ 8px\); right: 0; width: max-content; min-width: 52px; max-width: 56px;/,
    'no wider than the lane (16 px edge + 56 px)');
  assert.match(phone, /\.hx-pill-text, \.hx-pill-dots, \.hx-pill-x \{ display: none; \}/, 'the sentence is one tap away');
  assert.match(phone, /min-height: 48px/, 'a thumb target');
  assert.match(phone, /\.hx-pill-short:not\(\[hidden\]\) \{ display: block; font: 800 \.8125rem/, '13 px');
  assert.match(HARNESS, /^\.hx-pill-short \{ display: none; \}$/m, 'the desktop pill keeps its sentence only');
  // the desktop pill is untouched: to the left of the button
  assert.match(HARNESS, /^\.hx-pill \{ position: absolute; right: calc\(100% \+ 10px\); top: 0;/m);
});

test('phone-edge: "Show Harvey" is a per-device setting, on by default, stored with the others', async () => {
  const S = await import('../public/js/ui/settings.js');
  assert.equal(S.DEFAULTS.showHarvey, true);
  assert.equal(S.sanitize(null).showHarvey, true);
  assert.equal(S.sanitize({}).showHarvey, true, 'a HEAD save has no field: Harvey shows');
  assert.equal(S.sanitize({ showHarvey: false }).showHarvey, false);
  assert.equal(S.sanitize({ showHarvey: true }).showHarvey, true);
  for (const junk of ['no', 0, null, 'false']) assert.equal(S.sanitize({ showHarvey: junk }).showHarvey, true, `junk ${JSON.stringify(junk)}`);
  // the words, in both languages
  const en = (await import('../public/js/i18n/en/harness.js')).default;
  const bg = (await import('../public/js/i18n/bg/harness.js')).default;
  for (const k of ['harness.set.show', 'harness.set.showHelp']) {
    assert.ok(en[k] && bg[k], k);
    assert.notEqual(en[k], bg[k], `${k} is translated`);
  }
});

// ---- the helper's screens against a stand-in shell (the shapes of test/ui-harness.dom.test.js) ---------------------
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
}
globalThis.location = { pathname: '/', origin: 'http://localhost:4627', protocol: 'http:', host: 'localhost:4627', search: '', hash: '', reload() {}, assign() {} };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();

let H;
before(async () => { H = await import('../public/js/ui/harness/index.js'); });
const tick = (n = 3) => new Promise((r) => { let i = 0; const go = () => (++i >= n ? r() : setTimeout(go, 0)); setTimeout(go, 0); });

function fakePanels() {
  const specs = new Map();
  const handlers = { open: new Set(), close: new Set() };
  return {
    register(name, spec) { specs.set(name, spec); return () => specs.delete(name); },
    has: (n) => specs.has(n), isOpen: () => false, top: () => null, open: () => false, close: () => false,
    on(ev, fn) { handlers[ev]?.add(fn); return () => handlers[ev]?.delete(fn); },
  };
}
/** The game's settings as far as the helper uses them: get / set / on, like ui/settings.js. */
function fakeSettings(init = {}) {
  let cur = { showHarvey: true, ...init };
  const subs = new Set();
  return {
    get: () => ({ ...cur }),
    set(patch) { cur = { ...cur, ...patch }; for (const fn of [...subs]) fn({ ...cur }, patch); },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    subs,
  };
}
const ok = (data) => ({ ok: true, status: 200, data });
function fakeApi(job = null) {
  const api = {};
  const answers = {
    state: () => ok({ enabled: true, providers: [{ id: 'mock', available: true, signedIn: true }], job, active: null, consent: { telemetry: false, sending: false }, limits: {} }),
    current: () => ok({ job }), consent: () => ok({ telemetry: false, install: 'feedc0de' }), history: () => ok({ active: null, versions: [] }),
    providers: () => ok({ providers: [] }),
  };
  for (const [m, fn] of Object.entries(answers)) api[m] = async () => fn();
  return new Proxy(api, { get: (o, k) => o[k] ?? (async () => ok({})) });
}
async function page({ settings = fakeSettings(), job = null } = {}) {
  document.body.replaceChildren();
  const edge = document.createElement('nav');
  edge.id = 'hud-right';
  document.body.append(edge);
  globalThis.localStorage.clear();
  const store = { pid: 'p1', state: { players: { p1: { name: 'Rowan' }, p2: { name: 'Mia' } } }, on: () => () => {} };
  const ui = { panels: fakePanels(), toast() {}, notice() {}, confirm: async () => true };
  const helper = H.createHarnessUi({ ui, store, settings }, { api: fakeApi(job), bus: null, win: {}, pollMs: 0, signInPollMs: 0, fallbackMs: 5, autoStart: false });
  await helper.connect({ force: true });
  await tick();
  return { helper, settings, $: (s) => document.body.querySelector(s) };
}
const working = { id: 'j1', by: 'p1', provider: 'mock', model: null, state: 'working', step: 'building', round: 1, startedAt: Date.now() - 95_000,
  updatedAt: Date.now(), lang: 'en', prompts: [{ at: 1, text: 'x' }], progress: [], result: null, error: null };

test('phone-edge: Show Harvey off hides the button and the pill at once; on brings them back, no reload', async () => {
  const p = await page({ job: working });
  assert.equal(p.$('#hx-dock').hidden, false, 'on by default');
  assert.equal(p.$('.hx-pill').hidden, false, 'the job shows');
  assert.match(p.$('.hx-pill-short').textContent, /^1m$/, 'the chip\'s short time (95 s: "1m", the seconds cut)');
  assert.match(p.$('.hx-pill-time').textContent, /^1m 3\ds so far/, 'the desktop sentence keeps the seconds');
  p.settings.set({ showHarvey: false });
  assert.equal(p.$('#hx-dock').hidden, true, 'hidden at once');
  assert.equal(p.$('.hx-gap').hidden, true);
  assert.equal(p.helper.tile(() => {}), null, 'no Farm book tile either');
  // his own work goes on: the job is still known, a push still lands, nothing shows
  p.helper.receive({ t: 'hx', e: 'job', job: { ...working, step: 'testing', updatedAt: Date.now() + 5 } });
  assert.equal(p.helper.snapshot().job.step, 'testing');
  assert.equal(p.$('#hx-dock').hidden, true);
  p.settings.set({ showHarvey: true });
  assert.equal(p.$('#hx-dock').hidden, false, 'back at once');
  p.helper.destroy();
  assert.equal(p.settings.subs.size, 0, 'destroy lets go of the settings');
});

test('phone-edge: a device that hid Harvey before this visit never shows him; a page without settings shows him', async () => {
  const hid = await page({ settings: fakeSettings({ showHarvey: false }) });
  assert.equal(hid.helper.enabled(), true, 'the server still offers him (the Settings tab stays)');
  assert.equal(hid.$('#hx-dock')?.hidden ?? true, true);
  hid.helper.destroy();
  const none = await page({ settings: undefined });
  assert.equal(none.$('#hx-dock').hidden, false, 'no settings object (a tool, a test): Harvey shows');
  none.helper.destroy();
});

test('phone-edge: Settings › Harvey leads with the "Show Harvey" switch and it writes the setting', async () => {
  const p = await page();
  const wrap = document.createElement('div');
  wrap.append(...p.helper.settingsRows({ close() {} }));
  document.body.append(wrap);
  const sw = wrap.querySelector('[data-harness="show"]');
  assert.ok(sw, 'the switch');
  assert.equal(sw.getAttribute('role'), 'switch');
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.equal(wrap.querySelector('.set-row').querySelector('[data-harness="show"]'), sw, 'the first row of the tab');
  assert.match(sw.textContent, /Show Harvey/);
  sw.click();
  assert.equal(p.settings.get().showHarvey, false);
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  assert.equal(p.$('#hx-dock').hidden, true);
  sw.click();
  assert.equal(p.settings.get().showHarvey, true);
  assert.equal(p.$('#hx-dock').hidden, false);
  p.helper.destroy();
});
