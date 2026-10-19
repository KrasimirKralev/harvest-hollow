// QA r4 (life-feel) L4-07 (fe#2): when both farmers sit and the Golden Hour starts, it was said three times in the same
// second: the banner (ui/levelup.js, with the duration and the reward), a toast "Golden Hour! Everything you start now
// grows 10% faster." (game/feedback.js) and a fresh feed line (ui/feed.js). The banner stays; the toast is said only to
// a screen that got no banner (a reload during the hour); the feed line is history at once (shown on hover, as a faded
// line is), not a fresh line.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.documentElement = { lang: 'en' };
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.window ??= globalThis;
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { makeFarm, T0 } = await import('./helpers.js');
const { h } = await import('../public/js/ui/dom.js');
const { t } = await import('../public/js/i18n/index.js');
const { createFeedback } = await import('../public/js/game/feedback.js');
const { createFeed } = await import('../public/js/ui/feed.js');
const { goldenHourBp } = await import('../shared/rules/coop.js');

/** A farm in its Golden Hour, and the harness feedback.js needs; `celebrate` fires the store's confirmed event. */
function golden() {
  const s = makeFarm();
  s.players.p1.name = 'Ана';
  s.players.p2.name = 'Бо';
  const now = T0 + 60_000;
  s.farm.coop = { ...(s.farm.coop ?? {}), golden: { from: now - 1000, until: now + 30 * 60_000 } };
  const handlers = {};
  const toasts = [];
  const store = { state: s, pid: 'p1', now: () => now, on: (ev, fn) => { (handlers[ev] ||= []).push(fn); return () => {}; }, subscribe: () => () => {} };
  const audio = { play() {}, duck() {}, setScene() {}, ladder() {}, coins() {} };
  const fb = createFeedback({ store, controller: { on() {}, haptic() {}, input: 'mouse' }, view: { fx: { play() {} }, avatars: {}, toScreen: () => ({ visible: false }) },
    audio, ui: { toast: (x, o) => toasts.push(typeof x === 'function' ? x() : x), notice() {}, panels: { top: () => null, has: () => false } } });
  void fb;
  const emit = (ev, payload) => { for (const fn of handlers[ev] ?? []) fn(payload); };
  return { s, now, toasts, emit };
}

test('L4-07: the Golden Hour starting in front of both farmers raises the banner only, not the toast too', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const g = golden();
    assert.ok(goldenHourBp(g.s, g.now) > 0, 'the fixture is in its Golden Hour');
    g.emit('celebrate', { ev: { e: 'together', kind: 'goldenHour', until: g.now + 30 * 60_000 }, by: null });
    mock.timers.tick(6000);
    const said = g.toasts.filter((x) => x === t('game.golden.start'));
    assert.equal(said.length, 0, `the banner says it; toasts: ${g.toasts.join(' | ')}`);
  } finally { mock.timers.reset(); }
});

test('L4-07: a screen that got no banner (a reload during the hour) still hears that it runs, once', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const g = golden();
    g.emit('welcome', {});
    mock.timers.tick(6000);
    assert.equal(g.toasts.filter((x) => x === t('game.golden.start')).length, 1, `toasts: ${g.toasts.join(' | ')}`);
  } finally { mock.timers.reset(); }
});

test('L4-07: the feed\'s Golden Hour line is history at once (not a fresh line); a harvest line beside it is fresh', () => {
  const s = makeFarm();
  s.players.p1.name = 'Ана';
  s.players.p2.name = 'Бо';
  const now = T0 + 60_000;
  s.farm.feed = { n: 2, rows: { 0: { at: now - 500, by: 'sys', k: 'golden', a: 'p1', b: 'p2' }, 1: { at: now - 400, by: 'p2', k: 'harvest', item: 'wheat', q: 3 } } };
  document.body.replaceChildren(h('ol#feed'));
  const f = createFeed({ store: { state: s, pid: 'p1', now: () => now, on: () => () => {}, subscribe: () => () => {} }, controller: { do() {} }, view: { focus() {} } });
  f.render();
  const lis = document.getElementById('feed').children;
  assert.equal(lis.length, 2);
  const [goldenLi, harvestLi] = lis;
  assert.equal(goldenLi.classList.contains('stale'), true, 'the Golden Hour line is history');
  assert.equal(harvestLi.classList.contains('stale'), false, 'the harvest line is fresh');
});
