// QA r3 (life-feel): the feed corner.
// S3-C2 (coop#2, carried r2 L2-07; the optional patch in ui/feed.js for ui-shell's item): the recipient's "left a
//   surprise for you by the porch · Show me" line faded after 8 s like every line (opacity 0, pointer-events none), and
//   then nothing on the farm led to the box. It stays while the box waits; once the box is opened it carries the thanks
//   and fades as usual. (ui-shell's dot on Together and the Farm book's door are the other lasting cues.)
// F3-05 (coop#3, features' patch for game/feedback.js): a farmer who did their half of a same-day Together task (sat
//   on a bench for h1/h7, cast a line for h6) heard nothing; now one line, once per task a farm day: "Your half is
//   done ✓ · {partner} sits on a bench today" (features' tracker cards say the rest).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

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

const { farmAt, give, actOk, evs, T0, MIN } = await import('./helpers/rules-goals.js');
const { h } = await import('../public/js/ui/dom.js');
const { createFeed } = await import('../public/js/ui/feed.js');
const { createFeedback } = await import('../public/js/game/feedback.js');
const { CONTENT, live } = await import('../shared/content/index.js');
const { resetGrid } = await import('../shared/rules/grid.js');
const { dayOf } = await import('../shared/rules/coop.js');

test('S3-C2: the "Show me" line to a waiting surprise stays unfaded while the box waits, then fades once it is opened', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const s = farmAt(14);
    give(s, 'rose', 1);
    give(s, 'wheat', 20);
    const id = evs(actOk(s, 'keepsake', { item: 'rose' }, { pid: 'p2', now: T0 }), 'keepsake')[0].id;
    actOk(s, 'sell', { item: 'wheat', qty: 5 }, { pid: 'p2', now: T0 + 1000 });     // a plain line beside it
    let now = T0 + 2000;
    document.body.replaceChildren(h('ol#feed'));
    const S = {
      store: { state: s, pid: 'p1', now: () => now, on: () => () => {}, subscribe: () => () => {} },
      controller: { do() {} },
      view: { focus() {} },
    };
    const f = createFeed(S);
    f.render();
    const list = document.getElementById('feed');
    const show = () => list.children.find((x) => x.querySelector('.feed-show'));
    const plain = () => list.children.find((x) => !x.querySelector('.feed-show') && /sold|Wheat/i.test(textOf(x)));
    assert.ok(show(), `the line with Show me: ${list.children.map((x) => textOf(x)).join(' | ')}`);
    now = T0 + 30_000;                                   // 30 s on: past the 8 s fade
    mock.timers.tick(1000);
    assert.equal(show().classList.contains('stale'), false, 'the way to the box has not faded');
    if (plain()) assert.equal(plain().classList.contains('stale'), true, 'a plain line has');
    actOk(s, 'openGift', { id }, { pid: 'p1', now: T0 + MIN });
    now = T0 + MIN + 30_000;
    f.render();
    assert.ok(!show(), 'opened: no Show me any more');
    assert.ok(list.children.every((x) => x.classList.contains('stale')), 'and the line fades like the others');
  } finally { mock.timers.reset(); }
});

/** A farm at Together quest `qid` (h1-h7 done up to it, `qid` the active one): features' rel-features.r3 atQuest. */
function atQuest(qid) {
  const H = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
  const q = CONTENT.quests.get(qid);
  const s = farmAt(Math.max(q.level, qid === 'h6' ? 30 : 1));
  s.farm.wallet.coins = 50_000_000;
  s.farm.expansions = live('expansions').map((e) => e.id);
  resetGrid(s);
  for (const id of H.slice(0, H.indexOf(qid))) s.farm.quests.done[id] = T0;
  for (const id of Object.keys(s.farm.quests.active)) delete s.farm.quests.active[id];
  s.farm.quests.active[qid] = { at: T0, n: {} };
  return s;
}

test('F3-05: the farmer who sat for "Golden Hour on the Hill" hears once that their half is done (not the partner\'s sits)', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const s = atQuest('h7');
    const now = T0 + 5 * MIN;
    s.farm.coop.days = { d: dayOf(s, now), sat: { p2: 1 }, cast: {}, done: {} };
    const L = {};
    const store = { state: s, pid: 'p2', cid: 'c2', now: () => now, on: (e, fn) => { (L[e] ||= []).push(fn); return () => {}; } };
    const toasts = [];
    const ui = { toast: (text, o) => { toasts.push([typeof text === 'function' ? text() : text, o]); return null; },
      banner() { return { el: null, close() {} }; }, panels: { on() {}, top: () => null } };
    const view = { toScreen: () => ({ x: 400, y: 300, visible: true }), fx: { play() {} }, stats: () => null, focus() {} };
    const audio = { play() { return true; }, ladder() {}, coins() {}, duck() {}, setScene() {} };
    createFeedback({ store, controller: { on() { return () => {}; }, do() {}, haptic() {} }, view, audio, ui });
    const delta = (cid) => { for (const fn of L.delta || []) fn({ cid, by: cid === 'c2' ? 'p2' : 'p1', ev: [{ e: 'seated', pid: 'p2' }] }); };
    delta('c1');                                          // the partner's own action: not mine to say
    assert.equal(toasts.length, 0, 'nothing for a delta from another page');
    delta('c2');
    const said = toasts.filter(([x]) => /half is done/i.test(x));
    assert.equal(said.length, 1, `one line: ${JSON.stringify(toasts.map(([x]) => x))}`);
    assert.match(said[0][0], new RegExp(s.players.p1.name), 'it names the partner who still has to sit');
    assert.equal(said[0][1].kind, 'love');
    delta('c2');
    assert.equal(toasts.filter(([x]) => /half is done/i.test(x)).length, 1, 'once a farm day');
  } finally { mock.timers.reset(); }
});
