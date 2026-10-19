// Release 1.0, ui-shell: the Together button (S4, ux-first#5) and the bench chip (D2, features#F2).
// Together: ping, emote, say, notes and "Leave a surprise" (M21) behind one button, shown only with a partner claimed.
// D2: while the partner sits on a two-seat bench and I am here, a chip in #hud for 2 minutes, "{name} is waiting on
// the bench · Join"; Join goes through the controller's Hand-on-bench path (controller.sitOn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel } from '../shared/content/index.js';
import { T0 } from './helpers.js';

// the chip re-checks itself when its 2 minutes end: those timers must not keep this test file running
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const id = realTimeout(fn, ms, ...a); id?.unref?.(); return id; };

function rig({ partner = true, seats = {}, now = T0, input = 'mouse' } = {}) {
  const document = installDom();
  document.querySelector = (sel) => document.body.querySelector(sel);
  // the real DOM reflects the hidden attribute on the property (h() sets it as an attribute)
  const proto = Object.getPrototypeOf(document.createElement('i'));
  if (!proto.hiddenReflects) {
    const set = proto.setAttribute;
    proto.setAttribute = function setAttribute(k, v) { if (k === 'hidden') this.hidden = true; return set.call(this, k, v); };
    proto.hiddenReflects = true;
  }
  for (const [tag, id] of [['div', 'hud'], ['div', 'social'], ['canvas', 'world']]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.append(el);
  }
  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  globalThis.innerWidth = 1366;
  globalThis.innerHeight = 768;
  const state = createFarm(7, T0);
  state.farm.xp = xpForLevel(6);
  state.players.p1 = { ...state.players.p1, name: 'Ana' };
  if (partner) state.players.p2 = { ...(state.players.p2 ?? state.players.p1), name: 'Bo' };
  else delete state.players.p2;
  state.farm.objects.bench9 = { def: 'bench', x: 20, z: 20, rot: 0, placedAt: T0, by: 'p1' };
  state.farm.coop = { ...state.farm.coop, bench: seats };
  const subs = [];
  const store = { state, pid: 'p1', now: () => now, subscribe: (topic, fn) => { subs.push([topic, fn]); return () => {}; }, on() { return () => {}; } };
  const sat = [];
  const controller = { input, tool: { id: 'hand' }, on() { return () => {}; }, setTool() {}, sitOn: (id) => { sat.push(id); return true; } };
  const ui = { toast() {}, panels: { has: () => false, open() {}, toggle() {}, top: () => null, on() { return () => {}; } } };
  return { document, store, subs, sat, S: { store, controller, ui, view: { avatars: null, onFrame() {} } } };
}

test('S4: one Together button, shown only with a partner, opens ping, emote, say, notes and Leave a surprise', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const solo = rig({ partner: false });
  createSocial(solo.S);
  assert.equal(solo.document.getElementById('social').hidden, true, 'no partner: no Together');
  const r = rig();
  createSocial(r.S);
  const box = r.document.getElementById('social');
  assert.equal(box.hidden, false, 'a partner: Together shows');
  const btn = box.querySelector('#together-btn');
  assert.ok(btn, 'the Together button');
  const menu = box.querySelector('#together-menu');
  assert.ok(menu && menu.hidden, 'its menu waits closed');
  assert.equal(menu.getAttribute('role'), 'group', 'P9 (axe aria-required-children): a group of buttons, not a menu');
  assert.equal(box.children.filter((c) => c.tagName === 'BUTTON').length, 1, 'one button on the HUD, not five');
  btn.click();
  assert.equal(menu.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.querySelectorAll('button').length, 5, 'ping, emote, say, notes, surprise');
  assert.ok(menu.querySelector('[data-gift="open"]'), 'Leave a surprise (M21)');
  menu.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true, 'Escape closes it');
});

test('D2: the partner on a bench: a chip in #hud for 2 minutes; Join sits me down through the controller', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const r = rig({ seats: { p2: { id: 'bench9', at: T0 - 10_000 } } });
  createSocial(r.S);
  const chip = r.document.getElementById('hud').querySelector('.bench-chip');
  assert.ok(chip, 'the bench chip lives in #hud');
  assert.equal(chip.hidden, false);
  assert.match(textOf(chip), /Bo/);
  chip.querySelector('.bc-join').click();
  assert.deepEqual(r.sat, ['bench9'], 'Join -> controller.sitOn(bench)');
  assert.equal(chip.hidden, true, 'the chip goes once I join');

  const late = rig({ seats: { p2: { id: 'bench9', at: T0 - 121_000 } } });
  createSocial(late.S);
  assert.equal(late.document.getElementById('hud').querySelector('.bench-chip').hidden, true, 'after 2 minutes: gone');
  const both = rig({ seats: { p2: { id: 'bench9', at: T0 - 1000 }, p1: { id: 'bench9', at: T0 - 500 } } });
  createSocial(both.S);
  assert.equal(both.document.getElementById('hud').querySelector('.bench-chip').hidden, true, 'already sitting: no chip');
});

test('S9a: no "(G)" / "(T)" key hints in what a screen reader says to a finger; a mouse keeps them', async () => {
  const { createSocial } = await import('../public/js/ui/social.js');
  const labels = (r) => r.document.getElementById('social').querySelectorAll('button').map((b) => b.getAttribute('aria-label') ?? '');
  const finger = rig({ input: 'touch' });
  createSocial(finger.S);
  for (const l of labels(finger)) assert.doesNotMatch(l, /\([A-Z]\)/, l);
  const mouse = rig({ input: 'mouse' });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  createSocial(mouse.S);
  assert.ok(labels(mouse).some((l) => /\(G\)/.test(l)), 'the mouse still learns G');
});
