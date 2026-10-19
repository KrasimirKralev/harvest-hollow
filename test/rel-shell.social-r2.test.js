// QA r2, ui-shell: the partner's comings and goings, the chat line and the hearts.
//   S2-02 (jde#1, coop#8): every welcome told the one who arrived that the PARTNER "arrived on the farm 🌻"; a farmer who
//         reopened while the partner had just left heard "arrived" then "left for now"; a server restart said "left"
//         then "arrived" with the toast and its sound, though nobody left.
//   S2-12 (coop#3): a reconnect's welcome history repeated the newest chat lines in the feed ("Ти каза" three times).
//   S2-18 (oib#8): the chat line stayed open over the farm until something was sent.
//   S2-20 (fbp#11): a solo farmer was told "+2 ♥" for the daily together task done alone (M30: Hearts stay quiet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel } from '../shared/content/index.js';
import { T0 } from './helpers.js';

const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const id = realTimeout(fn, ms, ...a); id?.unref?.(); return id; };

const UI = await import('../public/js/ui/index.js');

/** A manual clock for the "left" grace. */
function timers() {
  let t = 0;
  const q = [];
  return {
    setTimer: (fn, ms) => { const e = { at: t + ms, fn }; q.push(e); return e; },
    clearTimer: (e) => { const i = q.indexOf(e); if (i >= 0) q.splice(i, 1); },
    advance(ms) { t += ms; q.sort((a, b) => a.at - b.at); while (q.length && q[0].at <= t) q.shift().fn(); },
  };
}

test('S2-02: the welcome\'s first look at the partner is silent, online or not', () => {
  assert.equal(typeof UI.peerNews, 'function', 'ui/index.js peerNews(say, timers)');
  const said = [];
  const c = timers();
  const news = UI.peerNews((pid, on) => said.push([pid, on]), c);
  news('p2', true);                    // I arrive; my partner has played for an hour
  c.advance(60_000);
  assert.deepEqual(said, [], 'no "Cleo arrived on the farm" for the one who arrived (HEAD: arrived)');
});

test('S2-02: a reload or a server restart inside the grace says nothing; a real leave says "left" once; a return then says "arrived"', () => {
  const said = [];
  const c = timers();
  const news = UI.peerNews((pid, on) => said.push([pid, on]), c);
  news('p2', true);
  news('p2', false);                   // a server restart: the reconnect's welcome sees them away for a moment
  c.advance(4_000);
  news('p2', true);
  c.advance(30_000);
  assert.deepEqual(said, [], 'a restart: nothing (HEAD: "left for now", then "arrived" with the toast)');
  news('p2', false);                   // they really leave
  c.advance(UI.PEER_NEWS.leftMs - 1);
  assert.deepEqual(said, [], 'not before the grace');
  c.advance(1);
  assert.deepEqual(said, [['p2', false]], 'left for now, once');
  news('p2', false);
  c.advance(60_000);
  assert.equal(said.length, 1);
  news('p2', true);
  assert.deepEqual(said, [['p2', false], ['p2', true]], 'back after a told leave: arrived');
});

test('S2-02: a partner first seen away who comes later is an arrival', () => {
  const said = [];
  const news = UI.peerNews((pid, on) => said.push([pid, on]), timers());
  news('p2', false);
  assert.deepEqual(said, []);
  news('p2', true);
  assert.deepEqual(said, [['p2', true]]);
});

test('S2-02: ui.setPeer goes through the news (no "was !== undefined" guard on a boolean)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /was !== isOnline && was !== undefined/, 'HEAD: hud.isOnline is always a boolean, so the guard never held');
  // QA r3 S3-10: the welcome's list or a live MSG.PEER (rel-shell.social-r3)
  assert.match(src, /if \(S\.store\.state && pid !== S\.store\.pid\) peerNewsOf\(\)\(pid, isOnline, \{ live: !welcome \}\);/);
});

test('S2-20: Hearts stay quiet for a farmer alone; with a partner the toast names them', () => {
  assert.equal(typeof UI.heartsLine, 'function', 'ui/index.js heartsLine(state, me, ev)');
  const solo = createFarm(7, T0);
  for (const p of Object.keys(solo.players)) if (p !== 'p1') delete solo.players[p];
  assert.equal(UI.heartsLine(solo, 'p1', { e: 'hearts', pid: 'p1', n: 2, why: 'team' }), null, 'solo: no "+2 ♥" (HEAD: the toast)');
  const two = createFarm(7, T0);
  two.players.p1 = { ...two.players.p1, name: 'Ana' };
  two.players.p2 = { ...(two.players.p2 ?? two.players.p1), name: 'Bo' };
  const line = UI.heartsLine(two, 'p1', { e: 'hearts', pid: 'p1', n: 2, why: 'team' });
  assert.match(line, /^\+2 ♥/);
  assert.equal(UI.heartsLine(two, 'p1', { e: 'hearts', pid: 'p2', n: 2 }), null, 'the partner\'s hearts are theirs');
});

/** The social corner over a tiny DOM (the same rig as rel-shell.together-r1). */
function listeners(obj) {
  const fns = [];
  obj.addEventListener = (type, fn, opt) => fns.push({ type, fn, capture: opt === true || Boolean(opt?.capture) });
  obj.removeEventListener = () => {};
  obj.fire = (type, ev) => {
    const e = { type, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...ev };
    for (const l of [...fns.filter((x) => x.capture), ...fns.filter((x) => !x.capture)]) if (l.type === type) l.fn(e);
    return e;
  };
}
async function socialRig() {
  const document = installDom();
  document.querySelector = (sel) => document.body.querySelector(sel);
  const proto = Object.getPrototypeOf(document.createElement('i'));
  if (!proto.hiddenReflects) {
    const set = proto.setAttribute;
    proto.setAttribute = function setAttribute(k, v) { if (k === 'hidden') this.hidden = true; return set.call(this, k, v); };
    proto.hiddenReflects = true;
  }
  listeners(document);
  globalThis.window = {};
  listeners(globalThis.window);
  for (const [tag, id] of [['div', 'hud'], ['div', 'social'], ['canvas', 'world']]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.append(el);
  }
  listeners(document.getElementById('world'));
  globalThis.innerWidth = 1366;
  globalThis.innerHeight = 768;
  const state = createFarm(7, T0);
  state.farm.xp = xpForLevel(6);
  state.players.p1 = { ...state.players.p1, name: 'Ana' };
  state.players.p2 = { ...(state.players.p2 ?? state.players.p1), name: 'Bo' };
  const store = { state, pid: 'p1', now: () => T0, subscribe() { return () => {}; }, on() { return () => {}; } };
  const panelFns = [];
  const ui = { toast() {}, panels: { has: (n) => n === 'notes', open() {}, toggle() {}, top: () => null, on: (n, fn) => { panelFns.push([n, fn]); return () => {}; } } };
  const controller = { input: 'mouse', tool: { id: 'hand' }, on() { return () => {}; }, setTool() {} };
  const feed = [];
  const S = { store, controller, ui, view: { avatars: null, onFrame() {} }, feed: { push: (l) => feed.push(l) } };
  const { createSocial } = await import('../public/js/ui/social.js');
  const social = createSocial(S);
  const openPanel = (name) => { for (const [n, fn] of panelFns) if (n === 'open') fn(name); };
  return { document, social, feed, openPanel };
}

test('S2-12: a welcome\'s chat history after a reconnect never repeats a line the feed has shown', async () => {
  const { social, feed } = await socialRig();
  const line = { pid: 'p2', ts: T0 + 5, text: 'See you at the bench at 9?' };
  social.chat(line);                                     // the live line
  social.chatHistory([line]);                            // the reconnect's welcome
  social.chatHistory([line]);                            // a second drop
  assert.equal(feed.length, 1, `one line (HEAD: ${feed.length})`);
  const mine = { pid: 'p1', ts: T0 + 9, text: 'Да, ще дойда 🙂' };
  social.chatHistory([line, mine]);
  social.chatHistory([line, mine]);
  assert.equal(feed.length, 2, 'my own line once too');
});

test('S2-18: an empty chat line goes when the farm is touched or a panel opens; one with words stays', async () => {
  const { document, openPanel } = await socialRig();
  const chatBtn = document.body.querySelectorAll('button').find((b) => b.getAttribute('aria-expanded') !== null && !b.classList.contains('together-btn') && !b.getAttribute('aria-haspopup'));
  assert.ok(chatBtn, 'the chat button');
  chatBtn.click();
  assert.ok(document.body.querySelector('.chat-box'), 'the line is open');
  document.getElementById('world').fire('pointerdown', { button: 0 });
  assert.equal(document.body.querySelector('.chat-box'), null, 'a tap on the farm put the empty line away (HEAD: it stayed)');
  chatBtn.click();
  openPanel('market');
  assert.equal(document.body.querySelector('.chat-box'), null, 'a panel put it away');
  chatBtn.click();
  document.body.querySelector('.chat-box input').value = 'Hi';
  document.getElementById('world').fire('pointerdown', { button: 0 });
  openPanel('market');
  assert.ok(document.body.querySelector('.chat-box'), 'a line with words waits for Send');
});
