// QA r2 S2-13 (hv#7): in multi mode "Keep your farm safe" came up while Harvey's side panel was open and the farmer
// typed a wish: the card's open closed the side panel (a non-stacked open closes all) and took the screen
// (e2e-harness --multi red in 1 of 2 runs). The card's "busy" check counted only panels that are not side panels.
// Now any open panel holds it back; it comes once the screen is empty. Runs as a page at /f/<id> (multi mode).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const ID = 'abcdefghij23';
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
}
globalThis.location = { pathname: `/f/${ID}`, origin: 'https://hh.test', protocol: 'https:', host: 'hh.test', search: '', hash: '', reload() {}, assign() {} };
globalThis.localStorage = memStorage();
globalThis.sessionStorage = memStorage();
installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

let F;
let K;
before(async () => {
  F = await import('../public/js/net/farm.js');
  K = await import('../public/js/ui/keep.js');
});

function clock(start = Date.UTC(2026, 9, 5, 9)) {
  let t = start;
  const q = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const e = { at: t + ms, fn }; q.push(e); return e; },
    clearTimer: (e) => { const i = q.indexOf(e); if (i >= 0) q.splice(i, 1); },
    advance(ms) { t += ms; for (;;) { q.sort((a, b) => a.at - b.at); if (!q.length || q[0].at > t) break; q.shift().fn(); } },
  };
}

test('S2-13: the keep card waits while a side panel is open (Harvey with a wish being typed); it comes once it closes', () => {
  localStorage.clear();
  F.session.secret = 'a'.repeat(64);
  const c = clock();
  const panels = new Map([['harvey', { size: 'side' }]]);
  const open = new Set();
  const opened = [];
  const listeners = { fx: [], welcome: [] };
  const store = { state: { players: { p1: { name: 'Ana', xp: 0, lastSeenAt: 1 } }, farm: { coop: {} }, meta: {} }, pid: 'p1', now: () => c.now(),
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => {}; } };
  const ui = {
    panels: {
      register: (n, spec) => { panels.set(n, spec); return () => {}; },
      open: (n) => { opened.push(n); open.add(n); return true; },
      close: (n) => { open.delete(n); },
      isOpen: (n) => open.has(n),
      list: () => [...panels.keys()].map((name) => ({ name, size: panels.get(name).size ?? 'side', open: open.has(name) })),
      on: () => () => {},
    },
    confirm: async () => true, toast() {}, banner: () => null,
  };
  K.createKeepUi({ store, ui }, { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  open.add('harvey');                                        // the farmer is typing a wish
  for (const fn of listeners.fx) fn({ ev: { e: 'tutorialStep', done: true, pid: 'p1', step: 'plant_wheat' } });
  c.advance(20_000);
  assert.deepEqual(opened, [], 'not over Harvey\'s side panel (HEAD: the card replaced it)');
  open.delete('harvey');
  c.advance(10_000);
  assert.deepEqual(opened, ['keep'], 'once the screen is empty');
});
