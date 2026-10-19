// Release 1.0 (life-feel): game/feedback.js, the sound and feel glue. F1 (feel#14): one sound per press (a control with
// its own sound plays only that; a panel opened by a generic click plays no second blip), no toast blip for a refusal,
// a lost race or a line that came with a bonk. M4 (feel#1): the quest jingle plays when its card is really on screen
// ('hh:card'), and fxMeta carries the button the reward came from ('hh:act-from'). F3 (feel#8): my carve plays three
// chisel taps 120 ms apart at rate 1.6, then the mastery chime. D4: fxMeta names a named animal's collect.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm, T0 } from './helpers.js';

const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
const docL = {};
globalThis.document = { addEventListener: (t, fn) => (docL[t] ||= []).push(fn), querySelector: () => null, getElementById: () => null };
const { createFeedback, SAME_PRESS_MS, CARVE_MS } = await import('../public/js/game/feedback.js');

/** A button whose closest() knows the selectors the feedback layer asks about (no DOM in node). */
const button = (attrs = {}) => ({
  disabled: false, attrs, isConnected: true,
  getAttribute: (k) => attrs[k] ?? null,
  closest(sel) {
    for (const part of sel.split(',').map((x) => x.trim())) {
      if (part === 'button' || part === 'button, [role="button"], [role="tab"], summary') return this;
      const m = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (m && (m[2] === undefined ? attrs[m[1]] !== undefined : attrs[m[1]] === m[2])) return this;
      if (part.startsWith('.') && (attrs.class || '').split(' ').includes(part.slice(1))) return this;
    }
    return null;
  },
});

function rig() {
  const L = {};
  const store = {
    state: makeFarm(), pid: 'p1', cid: 'c1', now: () => T0,
    on: (ev, fn) => { (L[ev] ||= []).push(fn); return () => {}; },
    emit: (ev, payload) => { for (const fn of L[ev] || []) fn(payload); },
  };
  const sounds = [];
  const audio = { play: (name, o = {}) => { sounds.push({ name, ...o }); return true; }, ladder() {}, coins() {}, duck: () => sounds.push({ name: 'duck' }), setScene() {} };
  const CL = {};
  const controller = { on: (ev, fn) => { (CL[ev] ||= []).push(fn); return () => {}; }, stroke: null, haptic() {} };
  const PL = {};
  const ui = { toast() {}, panels: { on: (ev, fn) => (PL[ev] ||= []).push(fn), top: () => null } };
  const view = { toScreen: () => ({ x: 400, y: 300, visible: true }), fx: { play() {} }, stats: () => null };
  const fb = createFeedback({ store, controller, view, audio, ui });
  return { store, sounds, fb, controller: CL, panels: PL, press: (b) => docL.pointerdown.at(-1)({ target: b }) };
}

test('F1: one sound per press: a dock button opening a panel plays only "open"; a generic click opening one, only "click"', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const r = rig();
    r.press(button({ 'data-dock': 'market' }));
    for (const fn of r.panels.open) fn('market', {});
    assert.deepEqual(r.sounds.map((s) => s.name), ['open'], 'the dock button\'s own sound');
    r.sounds.length = 0;
    r.press(button({}));
    for (const fn of r.panels.open) fn('journal', {});
    assert.deepEqual(r.sounds.map((s) => s.name), ['click'], `a generic press then the panel within ${SAME_PRESS_MS} ms`);
  } finally { mock.timers.reset(); }
});

test('F1: no toast blip for a refusal, a lost race, or a line that came with a bonk; a plain line blips', () => {
  const r = rig();
  globalThis.dispatchEvent(new CustomEvent('hh:toast', { detail: { kind: 'info', code: 'NOT_READY' } }));
  globalThis.dispatchEvent(new CustomEvent('hh:toast', { detail: { kind: 'love', race: true } }));
  assert.equal(r.sounds.filter((s) => s.name === 'toast').length, 0);
  globalThis.dispatchEvent(new CustomEvent('hh:toast', { detail: { kind: 'info' } }));
  assert.equal(r.sounds.filter((s) => s.name === 'toast').length, 1);
  for (const fn of r.controller.invalid) fn({});
  globalThis.dispatchEvent(new CustomEvent('hh:toast', { detail: { kind: 'info' } }));
  assert.deepEqual(r.sounds.map((s) => s.name), ['toast', 'bonk'], 'the bonk is the refusal\'s one sound');
});

test('M4: the quest jingle waits for its card ("hh:card"), not the celebration that may sit under a panel', () => {
  const r = rig();
  r.store.emit('celebrate', { ev: { e: 'questDone', id: 'q1' } });
  assert.ok(!r.sounds.some((s) => s.name === 'quest'), 'no jingle under a panel');
  globalThis.dispatchEvent(new CustomEvent('hh:card', { detail: { kind: 'quest', id: 'quest-q1' } }));
  assert.deepEqual(r.sounds.map((s) => s.name), ['duck', 'quest']);
});

test('M4: fxMeta carries the button the reward came from (hh:act-from), for my own events, for 1.5 s', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  try {
    const r = rig();
    const btn = { isConnected: true };
    globalThis.dispatchEvent(new CustomEvent('hh:act-from', { detail: { from: btn, type: 'sell' } }));
    assert.equal(r.fb.fxMeta('p1', true).from, btn);
    assert.equal(r.fb.fxMeta('p2', false).from, null, 'the partner\'s events never start at my button');
  } finally { mock.timers.reset(); }
});

test('D4: fxMeta names a named animal\'s collect (render/fx.js floats "Rada Petrova +2")', () => {
  const r = rig();
  r.store.state.farm.objects['cow.1'] = { def: 'cow', home: 'barn1' };
  r.store.state.farm.names = { 'cow.1': { name: 'Rada Petrova', by: 'p2', at: T0 } };
  const ev = { e: 'collected', id: 'cow.1', item: 'milk', qty: 2 };
  assert.equal(r.fb.fxMeta('p1', true, ev).name, 'Rada Petrova');
  assert.equal(r.fb.fxMeta('p1', true, { ...ev, id: 'cow.2' }).name, undefined);
});

test('F3: my carve: three chisel taps 120 ms apart at rate 1.6 as the chips fly, then the mastery chime', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const r = rig();
    r.store.emit('fx', { ev: { e: 'named', what: 'farm', text: 'Clover Fields', by: 'p1' }, by: 'p1', local: true });
    assert.equal(r.sounds.length, 0, 'the camera glides first');
    mock.timers.tick(CARVE_MS);
    const taps = r.sounds.filter((s) => s.name === 'chop1');
    assert.equal(taps.length, 3);
    assert.ok(taps.every((s) => s.rate === 1.6));
    assert.deepEqual(taps.map((s) => Math.round(s.at * 1000)), [1, 121, 241]);
    const chime = r.sounds.find((s) => s.name === 'mastery');
    assert.ok(chime && chime.at > 0.24, 'the chime after the taps');
    r.sounds.length = 0;
    r.store.emit('fx', { ev: { e: 'named', what: 'farm', text: 'X', by: 'p2' }, by: 'p2', local: false });
    mock.timers.tick(CARVE_MS);
    assert.equal(r.sounds.length, 0, 'the partner\'s carve: their card, no taps here');
  } finally { mock.timers.reset(); }
});

test('QA r1 L-11: the Farm book\'s dock button ticks on hover and opens with "open", like Build / Market / Barn / Orders', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const r = rig();
    const book = button({ 'data-farmbook': '', class: 'm-menu-btn', role: 'button' });
    docL.pointerover.at(-1)({ target: book });
    assert.deepEqual(r.sounds.map((s) => s.name), ['hover'], 'a hover tick');
    r.sounds.length = 0;
    r.press(book);
    for (const fn of r.panels.open) fn('menu', {});
    assert.deepEqual(r.sounds.map((s) => s.name), ['open'], 'its own "open", no generic click');
  } finally { mock.timers.reset(); }
});
