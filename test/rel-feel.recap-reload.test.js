// QA r2 L2-01 (jde#2; reproduced at triage): "Welcome back! You were away for 11m" came on every reload, though the
// farmer never left. players[pid].lastSeenAt is stamped only when the last socket closes for good (a reload inside the
// 10 s grace never stamps it), and the card's "shown for this absence" memory was a module variable a reload resets.
// The card now remembers, per farmer and device, which absence it was shown for, and when this device last saw the
// farmer here: a reload after play (or after the card was closed) says nothing; a real absence still gets it once.
// The sibling call site, the unlock tour on a welcome (ui/levelup.js), reads the same absence.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

installDom();
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const store0 = new Map();
globalThis.localStorage = {
  getItem: (k) => (store0.has(k) ? store0.get(k) : null),
  setItem: (k, v) => { store0.set(k, String(v)); },
  removeItem: (k) => { store0.delete(k); },
};
const { makeFarm, T0 } = await import('./helpers.js');
const { createRecap } = await import('../public/js/ui/recap.js');

const MIN = 60_000;

/** One page load: a recap module on `s` at the clock `clock.now`; returns how many times it opened the card. */
function page(s, clock) {
  let opened = 0;
  const S = {
    store: { state: s, pid: 'p1', now: () => clock.now, on() {}, subscribe() {} },
    ui: { panels: { register() {}, top: () => null, has: () => false, open: (n) => { if (n === 'recap') opened++; } } },
    controller: { do() {} },
  };
  const r = createRecap(S);
  return { r, opened: () => opened };
}

/** A farm where p1 has something to see on the card (crops ripened while away). */
function farm({ lastSeenAt, joinedAt = T0 - 30 * 86_400_000 }) {
  const s = makeFarm();
  s.players.p1.joinedAt = joinedAt;
  s.players.p1.lastSeenAt = lastSeenAt;
  s.farm.objects.plotA = { def: 'plot', x: 20, z: 20, rot: 0, placedAt: joinedAt, crop: { id: 'wheat', plantedAt: lastSeenAt, readyAt: lastSeenAt + MIN } };
  return s;
}

test('L2-01: a reload after the card was shown (the same absence) shows no card', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  store0.clear();
  try {
    const away = T0;
    const s = farm({ lastSeenAt: away });
    const clock = { now: away + 2 * 86_400_000 };
    const p1 = page(s, clock);
    p1.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p1.opened(), 1, 'a real absence: the card once');
    // "Let's farm!", 20 s of play, then a reload: a new page, the server's lastSeenAt unchanged
    clock.now += 20_000;
    mock.timers.tick(20_000);
    const p2 = page(s, clock);
    p2.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p2.opened(), 0, 'reload 1: no card');
    clock.now += 40_000;
    const p3 = page(s, clock);
    p3.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p3.opened(), 0, 'reload 2: no card');
  } finally { mock.timers.reset(); }
});

test('L2-01: a fresh farm played 11 minutes and reloaded (lastSeenAt is still the join stamp) shows no card', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  store0.clear();
  try {
    const joined = T0;
    const s = farm({ lastSeenAt: joined, joinedAt: joined });
    const clock = { now: joined + 5_000 };
    const p1 = page(s, clock);
    p1.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p1.opened(), 0, 'the first visit: nothing to welcome back from');
    // 11 minutes of play on this page (its clock ticks), then a reload
    for (let i = 0; i < 22; i++) { clock.now += 30_000; mock.timers.tick(30_000); }
    const p2 = page(s, clock);
    p2.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p2.opened(), 0, 'played on this device until a moment ago: "away for 11m" is false');
  } finally { mock.timers.reset(); }
});

test('L2-01: the next real absence (a newer lastSeenAt, or this device away 10+ minutes) shows the card again, once', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  store0.clear();
  try {
    const s = farm({ lastSeenAt: T0 });
    const clock = { now: T0 + 3 * 3600_000 };
    const p1 = page(s, clock);
    p1.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p1.opened(), 1);
    clock.now += 30 * MIN;
    mock.timers.tick(30 * MIN);
    // the farmer left for real: the server stamped a new lastSeenAt; back 2 hours later
    s.players.p1.lastSeenAt = clock.now;
    clock.now += 2 * 3600_000;
    const p2 = page(s, clock);
    p2.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p2.opened(), 1, 'a new absence: the card');
    const p3 = page(s, clock);
    p3.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p3.opened(), 0, 'and not twice for it');
  } finally { mock.timers.reset(); }
});

test('L2-01: a page closed with the socket still open (a phone in the background) 30 minutes counts as away', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  store0.clear();
  try {
    const s = farm({ lastSeenAt: T0 });
    const clock = { now: T0 + 3 * 3600_000 };
    const p1 = page(s, clock);
    p1.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p1.opened(), 1);
    clock.now += 5 * MIN;
    mock.timers.tick(5 * MIN);
    // the page went to the background and its timers stopped (nothing ticks); 30 minutes later it reloads, and the
    // server never stamped a new lastSeenAt (its socket stayed open)
    clock.now += 30 * MIN;
    const p2 = page(s, clock);
    p2.r.onWelcome();
    mock.timers.tick(1000);
    assert.equal(p2.opened(), 1, 'away 30 minutes from this device: welcome back');
  } finally { mock.timers.reset(); }
});
