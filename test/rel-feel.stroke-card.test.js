// QA r1 L-02 (fbp#1): a card that pops over the field ate the next harvest stroke: the row-2 stroke started on the quest
// card that row 1 had just raised, toasts.js swipeAway() took the finger, the card flew away unseen and four ripe plots
// stayed. Now (ui/toasts.js): a card raised while a farm stroke is under way, or less than a second after one ended,
// waits until the finger has been up a second; a card that just came in lets touches through to the farm for 600 ms,
// and any card does while a stroke runs and for a second after it (CSS pointer-events, `.fresh` / `body.farm-stroke`);
// a swipe that starts then is not a swipe. Fake DOM: the classes, the timing and the swipe; the stroke that harvests the
// row under the card is the browser check in docs/agent-notes/rel-life-feel.md (QA r1).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.querySelector = (s) => document.body.querySelector(s);
document.querySelectorAll = (s) => document.body.querySelectorAll(s);
// the document-level pointer listeners toasts.js installs (capture): kept so the test can play a finger
const docL = {};
document.addEventListener = (t, fn) => { (docL[t] ||= []).push(fn); };
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.innerWidth = 390;
globalThis.innerHeight = 844;
globalThis.matchMedia = (q) => ({ matches: /max-width: 600px|pointer: coarse/.test(q), addEventListener() {}, removeEventListener() {} });

const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

function setup() {
  document.body.replaceChildren(h('canvas#world'), h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')));
  for (const k of Object.keys(docL)) delete docL[k];
  const panels = { top: () => null, on() { return () => {}; } };
  const toasts = createToasts({ store: { state: null, pid: 'p1' }, ui: { panels } }, (c) => c);
  const world = document.getElementById('world');
  const fire = (type, target, x, y, id = 1) => {
    const ev = { type, target, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, stopPropagation() {}, preventDefault() {} };
    for (const fn of docL[type] || []) fn(ev);
    target.dispatch?.(type, ev);
  };
  /** One finger stroke on the farm, from (x, y) 120 px to the right in steps. */
  const stroke = (y = 400) => { fire('pointerdown', world, 40, y); for (let x = 60; x <= 160; x += 20) fire('pointermove', world, x, y); fire('pointerup', world, 160, y); };
  return { toasts, world, fire, stroke };
}
const card = () => ({ kind: 'quest', id: 'quest-q1', ribbon: 'Quest complete!', message: 'Welcome Home', ttl: 9000 });
const cardsShown = () => document.getElementById('banners').querySelectorAll('.unlock-banner');

test('L-02: a card raised a moment after a farm stroke waits until the finger has been up a second', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const realNow = performance.now;
  performance.now = () => Date.now();
  try {
    const { toasts, stroke } = setup();
    stroke();
    mock.timers.tick(200);
    const r = toasts.banner(card());
    assert.equal(r.el, null, 'held while the row strokes go on');
    assert.equal(cardsShown().length, 0);
    mock.timers.tick(900);
    assert.equal(cardsShown().length, 1, 'shown once the finger has been up a second');
  } finally { performance.now = realNow; mock.timers.reset(); }
});

test('L-02: a stroke that starts on a card shown 300 ms earlier is the farm\'s: the card lets it through and stays', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const realNow = performance.now;
  performance.now = () => Date.now();
  try {
    const { toasts, fire } = setup();
    mock.timers.tick(5000);
    const { el } = toasts.banner(card());
    assert.ok(el, 'no stroke under way: shown at once');
    mock.timers.tick(300);
    assert.ok(el.classList.contains('fresh'), 'a card that just came in lets touches through to the farm (CSS pointer-events)');
    // the finger lands on the card anyway (a browser that delivered it): no swipe, the card stays
    fire('pointerdown', el, 200, 300);
    for (let x = 220; x <= 400; x += 30) fire('pointermove', el, x, 300);
    fire('pointerup', el, 400, 300);
    mock.timers.tick(400);
    assert.ok(el.isConnected && !el.classList.contains('leaving'), 'the card is still there');
    assert.ok(!el.classList.contains('fresh'), 'and takes touches again after 600 ms');
  } finally { performance.now = realNow; mock.timers.reset(); }
});

test('L-02: while a farm stroke runs, and for a second after it, every card lets the finger through; a tap is not a stroke', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const realNow = performance.now;
  performance.now = () => Date.now();
  try {
    const { toasts, world, fire, stroke } = setup();
    mock.timers.tick(5000);
    const { el } = toasts.banner(card());
    mock.timers.tick(700);
    fire('pointerdown', world, 40, 500);
    fire('pointermove', world, 90, 500);
    assert.ok(document.body.classList.contains('farm-stroke'), 'a stroke under way');
    fire('pointerup', world, 90, 500);
    mock.timers.tick(500);
    assert.ok(document.body.classList.contains('farm-stroke'), 'half a second after it');
    // a swipe that starts now is the next row's stroke, not a swipe
    fire('pointerdown', el, 200, 300);
    fire('pointermove', el, 400, 300);
    fire('pointerup', el, 400, 300);
    assert.ok(el.isConnected && !el.classList.contains('leaving'));
    mock.timers.tick(600);
    assert.ok(!document.body.classList.contains('farm-stroke'), 'the cards take touches again');
    // a tap on the farm (no movement) leaves the cards pressable at once
    fire('pointerdown', world, 40, 500);
    fire('pointerup', world, 41, 500);
    assert.ok(!document.body.classList.contains('farm-stroke'));
    void stroke;
  } finally { performance.now = realNow; mock.timers.reset(); }
});

test('L-02: a long run of strokes holds a card at most 5 s; then it shows (and still lets the strokes through)', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const realNow = performance.now;
  performance.now = () => Date.now();
  try {
    const { toasts, stroke } = setup();
    stroke();
    toasts.banner(card());
    for (let i = 0; i < 7; i++) { mock.timers.tick(800); stroke(); }
    assert.equal(cardsShown().length, 1, 'shown within 5 s of strokes');
    assert.ok(document.body.classList.contains('farm-stroke'));
  } finally { performance.now = realNow; mock.timers.reset(); }
});
