// QA r1 (life-feel), D1 Surprise gifts on the recipient's side.
// L-01 (jde#1, coop#1, fe#3): the giver's note reached no screen; opened through the gift sheet's "Open it" nothing
//   showed at all. Now: opening a box (either door) raises one card above any open panel ("A surprise from {giver}!",
//   "{giver} wrapped {item} for you", the note in quotes, "♥ Thanks"); the recipient's feed line quotes the note; the
//   welcome-back card quotes the note of a surprise the farm shelved while they were away.
// L-05 (jde#8): the opening has a sound of its own.
// L-07 (coop#5): the giver's own shelved surprise read "You's surprise went to Mia's shelf" / "Изненадата от Ти …".
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

const document = installDom();
document.querySelector = (s) => document.body.querySelector(s);
document.querySelectorAll = (s) => document.body.querySelectorAll(s);
document.documentElement = { lang: 'en' };          // i18n's language switch stamps <html lang>
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.window ??= globalThis;
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { farmAt, give, actOk, evs, runDue, T0, HOUR, MIN } = await import('./helpers/rules-goals.js');
const { feedRows } = await import('../shared/rules/feed.js');
const I = await import('../public/js/i18n/index.js');
const { feedText } = await import('../public/js/ui/feed.js');
const { soundsOf, createFeedback, giftCard } = await import('../public/js/game/feedback.js');
const { createToasts } = await import('../public/js/ui/toasts.js');
const { createRecap } = await import('../public/js/ui/recap.js');
const { h } = await import('../public/js/ui/dom.js');

const NOTE = 'For the morning coffee';

/** p1 wraps a Rose (with the note) for p2; returns { s, id, opened? }. */
function wrapped(note = NOTE) {
  const s = farmAt(14);
  give(s, 'rose', 1);
  const r = actOk(s, 'keepsake', { item: 'rose', ...(note ? { note } : {}) }, { pid: 'p1', now: T0 });
  return { s, id: evs(r, 'keepsake')[0].id };
}
function opened(note = NOTE) {
  const { s, id } = wrapped(note);
  const r = actOk(s, 'openGift', { id }, { pid: 'p2', now: T0 + MIN });
  return { s, id, ev: evs(r, 'giftOpened')[0] };
}
const rowOf = (s, what) => feedRows(s).map(([i, r]) => ({ i, ...r })).find((r) => r.k === 'surprise' && r.what === what);
/** A text, or the function that says it, as it reads now. */
const say = (v) => (typeof v === 'function' ? v() : v ?? '');
const words = (spec) => [spec.ribbon, spec.message, spec.quote, ...(spec.things ?? []).map((x) => x.name)].map(say).join(' | ');

test('L-01: the recipient\'s feed line for an opened surprise quotes the note (EN “…”, BG „…“); the giver\'s does not repeat it', async () => {
  const { s } = opened();
  const row = rowOf(s, 'opened');
  try {
    const mine = feedText(row, s, 'p2');
    assert.match(mine.text, /“For the morning coffee”/, `EN: ${mine.text}`);
    assert.doesNotMatch(feedText(row, s, 'p1').text, /morning coffee/, 'the giver wrote it: no echo in their own feed');
    await I.setLang('bg');
    const bg = feedText(row, s, 'p2').text;
    assert.match(bg, /„For the morning coffee“/, `BG: ${bg}`);
  } finally { await I.setLang('en'); }
});

test('L-07: the giver\'s own surprise shelved after 48 h says "Your surprise went to {partner}\'s shelf" (EN and BG)', async () => {
  const { s } = wrapped();
  runDue(s, T0 + 49 * HOUR);
  const row = rowOf(s, 'shelved');
  assert.ok(row, 'the farm shelved it');
  const partner = s.players.p2.name;
  try {
    const en = feedText(row, s, 'p1');
    assert.equal(en.text.trim(), `Your surprise went to ${partner}'s shelf`);
    assert.doesNotMatch(`${en.actor ?? ''} ${en.text}`, /You's/);
    await I.setLang('bg');
    const bg = feedText(row, s, 'p1');
    assert.equal(bg.text.trim(), `Твоята изненада отиде на рафта на ${partner}`);
    assert.doesNotMatch(bg.text, /от Ти/);
  } finally { await I.setLang('en'); }
  // the recipient never opened it: the note reaches them in their line instead
  assert.match(feedText(row, s, 'p2').text, /“For the morning coffee”/);
});

test('L-05: opening a surprise has a sound (a soft reveal); a box the farm shelved by itself stays quiet', () => {
  const { ev } = opened();
  const snd = soundsOf(ev, farmAt(1));
  assert.ok(snd.length > 0, 'the opening is not silent');
  assert.ok(snd.some(([n]) => n === 'find'), `a reveal chime: ${JSON.stringify(snd)}`);
  assert.deepEqual(soundsOf({ ...ev, auto: true }, farmAt(1)), []);
});

test('L-01: the reveal card: who, what, the note, and ♥ Thanks thanks the giver\'s "left a surprise" line (the rules\' thank)', () => {
  const { s, ev } = opened();
  const left = rowOf(s, 'left');
  const calls = [];
  const spec = giftCard(ev, s, 'p2', { thank: (i) => calls.push(i) });
  assert.ok(spec, 'a card for the recipient');
  assert.equal(spec.over, true, 'shown at once, above any open panel');
  const w = words(spec);
  assert.match(w, new RegExp(s.players.p1.name), w);
  assert.match(w, /Rose/, w);
  assert.match(w, /“For the morning coffee”/, w);
  assert.equal(spec.actions.length, 1);
  assert.match(say(spec.actions[0].label), /Thanks/);
  spec.actions[0].fn();
  assert.deepEqual(calls, [left.i]);
  // the giver opens nothing; a box the farm shelved is no reveal; a line thanked already offers no second thanks
  assert.equal(giftCard(ev, s, 'p1'), null);
  assert.equal(giftCard({ ...ev, auto: true }, s, 'p2'), null);
  const thankedState = structuredClone(s);
  feedRows(thankedState).find(([i]) => i === left.i)[1].ty = 'p2';
  assert.equal(giftCard(ev, thankedState, 'p2').actions.length, 0);
  // no note: no quote, still the card
  const plain = opened(null);
  assert.equal(say(giftCard(plain.ev, plain.s, 'p2').quote), '');
});

test('L-01: the feedback layer raises the card for the opener a moment after the box opens (both doors), never for the giver', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { s, ev } = opened();
    const L = {};
    const store = { state: s, pid: 'p2', cid: 'c2', now: () => T0 + MIN, on: (e, fn) => { (L[e] ||= []).push(fn); return () => {}; } };
    const emit = (e, p) => { for (const fn of L[e] || []) fn(p); };
    const cards = [];
    const did = [];
    const ui = { toast() {}, banner: (o) => { cards.push(o); return { el: null, close() {} }; }, panels: { on() {}, top: () => 'gift' } };
    const controller = { on() { return () => {}; }, do: (t, a) => did.push([t, a]), haptic() {} };
    const view = { toScreen: () => ({ x: 400, y: 300, visible: true }), fx: { play() {} }, stats: () => null };
    const audio = { play() { return true; }, ladder() {}, coins() {}, duck() {}, setScene() {} };
    const fb = createFeedback({ store, controller, view, audio, ui });
    emit('fx', { ev, by: 'p2', local: true });              // the sheet's "Open it": the gift panel is still open
    mock.timers.tick(1500);
    assert.equal(cards.length, 1, 'one card');
    assert.match(words(cards[0]), /morning coffee/);
    cards[0].actions[0].fn();
    assert.deepEqual(did.map(([t]) => t), ['thank']);
    // the giver's screen: no card
    store.pid = 'p1';
    emit('fx', { ev, by: 'p2', local: false });
    mock.timers.tick(1500);
    assert.equal(cards.length, 1);
    fb.dispose();
  } finally { mock.timers.reset(); }
});

test('L-01: an `over` card shows at once above an open modal panel (#over-panels), with the note as its quote', () => {
  document.body.replaceChildren(h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')));
  const panels = { name: 'gift', top() { return this.name; }, on() { return () => {}; } };
  document.body.append(h('section#panel-gift', { 'aria-modal': 'true' }, h('header.hh-panel-title')));
  const toasts = createToasts({ store: { state: null, pid: 'p2' }, ui: { panels } }, (c) => c);
  const { s, ev } = opened();
  const r = toasts.banner(giftCard(ev, s, 'p2'));
  assert.ok(r.el, 'shown, not held for the panel to close');
  assert.ok(r.el.closest('#over-panels'), 'above the panels');
  const q = r.el.querySelector('.card-quote');
  assert.ok(q, 'the quote');
  assert.equal(textOf(q), '“For the morning coffee”');
  r.close();
});

test('L-01: an `over` card under a side sheet (the gift sheet on a desktop is not modal) goes above the panels too', () => {
  document.body.replaceChildren(h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')));
  const panels = { name: 'gift', top() { return this.name; }, on() { return () => {}; } };
  const sheet = h('section#panel-gift', { 'aria-modal': 'false' }, h('header.hh-panel-title'));
  // the sheet lies over the right column, where the card is drawn (the empty column itself has no size)
  sheet.getBoundingClientRect = () => ({ left: 790, right: 1180, top: 60, bottom: 700, width: 390, height: 640 });
  document.body.append(sheet);
  const toasts = createToasts({ store: { state: null, pid: 'p2' }, ui: { panels } }, (c) => c);
  const real = columnRects();
  const { s, ev } = opened();
  const r = toasts.banner(giftCard(ev, s, 'p2'));
  real.restore();
  assert.ok(r.el.closest('#over-panels'), 'above the side sheet');
  r.close();
});

/** Every element prepended into #banners gets the right column's rectangle (1366 x 768: x 930-1270 from y 76). */
function columnRects() {
  const banners = document.getElementById('banners');
  const prepend = banners.prepend.bind(banners);
  banners.prepend = (el) => {
    el.getBoundingClientRect = () => ({ left: 930, right: 1270, top: 76, bottom: 320, width: 340, height: 244 });
    return prepend(el);
  };
  return { restore() { banners.prepend = prepend; } };
}

test('L-01: the welcome-back card quotes the note of a surprise the farm shelved while its recipient was away', () => {
  const { s } = wrapped();
  s.players.p2.lastSeenAt = T0 - HOUR;
  runDue(s, T0 + 49 * HOUR);
  let spec = null;
  createRecap({
    store: { state: s, pid: 'p2', now: () => T0 + 50 * HOUR },
    ui: { panels: { register(n, sp) { if (n === 'recap') spec = sp; }, top: () => null, has: () => false, open() {} } },
    controller: { do() {} }, view: { focus() {} },
  });
  const body = document.createElement('div');
  document.body.append(body);
  spec.mount(body, { close() {} });
  const text = textOf(body);
  assert.match(text, /“For the morning coffee”/, text.slice(0, 400));
});
