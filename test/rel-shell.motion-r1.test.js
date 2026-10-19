// QA r1 S-08 (jde#3, ap#6): Settings › Comfort › Motion: "Full" could not be picked. The segment called
// api.set({ motion: 'full' }) and sanitize reads a pick only from the versioned field, so it fell back to "Like this
// device"; under the OS's reduced motion the body kept motion-reduced, also after a reload. The UI path, end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

function rig({ reduce = true } = {}) {
  const document = installDom();
  const vars = {};
  document.documentElement = { style: { setProperty: (k, v) => { vars[k] = v; }, getPropertyValue: (k) => vars[k] ?? '' } };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.matchMedia = (q) => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} });
  const reg = {};
  const S = { ui: { panels: { register: (n, def) => { reg[n] = def; }, has: () => false } }, controller: null, view: null, store: { state: null } };
  return { document, store, reg, S };
}

async function motionButtons(reg) {
  const body = document.createElement('div');
  reg.settings.mount(body, { tab: 'access' });
  const group = body.querySelectorAll('.seg').find((g) => g.children.some((b) => b.dataset.v === 'still'));
  assert.ok(group, 'the Motion segment');
  return (v) => group.children.find((b) => b.dataset.v === v);
}

test('S-08: under the OS\'s reduced motion, Settings › Motion › "Full" is taken, applied and kept after a reload', async () => {
  const { createSettings, motionOf } = await import('../public/js/ui/settings.js');
  const r = rig({ reduce: true });
  const api = createSettings(r.S);
  api.apply();                                                // the ui applies the settings once the shell is up
  assert.equal(motionOf(api.get()), 'reduced', 'the device reduces motion: "Like this device" reads reduced');
  assert.equal(r.document.body.classList.contains('motion-reduced'), true);
  const btn = await motionButtons(r.reg);
  btn('reduced').click();
  assert.equal(api.get().motion, 'reduced');
  btn('full').click();
  assert.equal(api.get().motion, 'full', 'the pick is "full" (HEAD: "system")');
  assert.equal(motionOf(api.get()), 'full');
  assert.equal(r.document.body.classList.contains('motion-reduced'), false, 'full motion on the body');
  assert.equal(btn('full').getAttribute('aria-pressed'), 'true', '"Full" is the lit segment');
  // a later, unrelated change keeps the pick
  api.set({ cbSafe: true });
  assert.equal(api.get().motion, 'full', 'another setting does not undo the pick');
  // a reload reads it back from storage
  const raw = JSON.parse([...r.store.values()].find((v) => v.includes('motion')));
  assert.equal(raw.motion2, 'full', `stored as a pick: ${JSON.stringify(raw)}`);
  const again = createSettings({ ...r.S, ui: { panels: { register() {}, has: () => false } } });
  again.apply();
  assert.equal(again.get().motion, 'full', 'after a reload');
  assert.equal(r.document.body.classList.contains('motion-reduced'), false);
});

// QA r1 S-35 (oib#13): Settings › Controls on an iPhone listed the keyboard keys and a Vibration switch iPhones ignore
// ("Android; iPhones have none"). On a phone without a keyboard the keys fold behind their heading; Vibration shows
// only where navigator.vibrate exists.
test('S-35: on a phone the keys fold behind their heading and Vibration needs navigator.vibrate', async () => {
  const { createSettings } = await import('../public/js/ui/settings.js');
  const { textOf } = await import('./ui-qa2-dom.js');
  const r = rig({ reduce: false });
  globalThis.matchMedia = (q) => ({ matches: /coarse/.test(q) && !/fine/.test(q), addEventListener() {}, removeEventListener() {} });
  r.S.controller = { device: { touchFirst: true }, options: { haptics: true, edgeScroll: false }, setOption() {} };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const keysTab = () => { const body = document.createElement('div'); r.reg.settings.mount(body, { tab: 'keys' }); return body; };
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'iPhone' }, configurable: true });
    createSettings(r.S);
    let body = keysTab();
    const fold = body.querySelector('details');
    assert.ok(fold, 'the key list is folded (HEAD: listed on a phone without a keyboard)');
    assert.ok(fold.querySelector('ul.keys'), 'the keys are inside the fold');
    assert.doesNotMatch(textOf(body), /Vibration/, 'no Vibration switch on an iPhone (no navigator.vibrate)');
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Android', vibrate() { return true; } }, configurable: true });
    body = keysTab();
    assert.match(textOf(body), /Vibration/, 'an Android phone keeps it');
    // a phone with a keyboard and a mouse plugged in: the keys show as before
    globalThis.matchMedia = (q) => ({ matches: /coarse|fine/.test(q), addEventListener() {}, removeEventListener() {} });
    body = keysTab();
    assert.equal(body.querySelector('details'), null, 'a fine pointer: the list is open');
  } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav);
  }
});
