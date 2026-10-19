// QA r2 (life-feel): the feed, the surprise lines and the gift note.
// L2-06 (coop#4): one tap on the cow barn collected 6 Milk; each named cow added its own local "X gave 1 Milk" line on
//   both screens and the partner's own "collected 6 Milk" (with its ♥ Thanks) fell out of the 5-line feed. The named
//   lines of one collect fold into one ("Rada Petrova, Ruja and 4 more gave 6 Milk"), and local lines never take more
//   than two of the five places from the farm's own rows.
// L2-07 (coop#6): a surprise left while both are online: the recipient's only sign was "{partner} left a surprise for
//   you ♥ Thanks" (no way to the box, and a thanks for a gift still closed). The line says where ("by the porch") and
//   carries Show me (it pans to the box) until the box is opened; then the thanks; the recipient also gets a line with
//   Show me as it happens.
// L2-11 (fbp#10): a feed line's words sat 5 px above the farmer's mark: the mark is now a flex item of the row.
// F2-02 (coop#5, fe#2, ap#4; patch from features): a one-tap note travels as a token ("#thanks") and every place this
//   lane shows a note says it in the READER's language: the feed line, the reveal card (and its quote in the toast
//   layer), the welcome-back card.
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
const I = await import('../public/js/i18n/index.js');
const { h } = await import('../public/js/ui/dom.js');
const { feedText, createFeed } = await import('../public/js/ui/feed.js');
const { giftCard, createFeedback } = await import('../public/js/game/feedback.js');
const { createToasts } = await import('../public/js/ui/toasts.js');
const { createRecap } = await import('../public/js/ui/recap.js');

const say = (v) => (typeof v === 'function' ? v() : v ?? '');

/** A feed on `s` for `pid`: { list, emit(fx payload), render, focus[] }. */
function feedOn(s, pid, now = () => T0 + MIN) {
  document.body.replaceChildren(h('ol#feed'));
  const L = {};
  const focus = [];
  const S = {
    store: { state: s, pid, now, on: (e, fn) => { (L[e] ||= []).push(fn); return () => {}; }, subscribe: (t, fn) => { (L[`sub:${t}`] ||= []).push(fn); return () => {}; } },
    controller: { do() {} },
    view: { focus: (x, z) => focus.push([x, z]) },
  };
  const f = createFeed(S);
  return { list: document.getElementById('feed'), emit: (p) => { for (const fn of L.fx || []) fn(p); }, render: f.render, focus };
}
const lines = (list) => list.children.map((li) => textOf(li));

test('L2-06: a 6-cow collect folds its named lines into one and keeps the partner\'s own row in the feed', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const s = farmAt(21);
    const now = T0 + 5 * MIN;
    s.farm.feed = { n: 0, rows: {} };
    const add = (r) => { s.farm.feed.rows[String(s.farm.feed.n)] = r; s.farm.feed.n++; };
    for (let i = 0; i < 4; i++) add({ at: now - (10 - i) * 1000, by: 'p1', k: 'harvest', item: 'wheat', q: 3 + i });
    add({ at: now, by: 'p2', k: 'collect', item: 'milk', q: 6 });
    s.farm.names = {};
    const cows = ['Rada Petrova', 'Ruja', 'Milka', 'Sarah', 'Sisi', 'Doja-Cow'];
    cows.forEach((name, i) => {
      s.farm.objects[`cow${i}`] = { def: 'cow', x: 30 + i, z: 30, rot: 0, placedAt: T0, home: 'barn1' };
      s.farm.names[`cow${i}`] = { name, by: 'p1', at: T0 };
    });
    const f = feedOn(s, 'p1', () => now);
    f.render();
    for (let i = 0; i < cows.length; i++) f.emit({ ev: { e: 'collected', id: `cow${i}`, by: 'p2', item: 'milk', qty: 1 }, by: 'p2' });
    mock.timers.tick(200);
    const ls = lines(f.list);
    assert.ok(ls.some((x) => /collected 6 Milk/.test(x)), `the partner's row stays: ${JSON.stringify(ls)}`);
    const named = ls.filter((x) => /gave/.test(x));
    assert.equal(named.length, 1, `one line for the six cows: ${JSON.stringify(named)}`);
    assert.match(named[0], /Rada Petrova, Ruja and 4 more gave 6 Milk/);
  } finally { mock.timers.reset(); }
});

/** p2 wraps a Rose for p1 (on the porch); returns { s, id, ev }. */
function wrapped(note = undefined) {
  const s = farmAt(14);
  give(s, 'rose', 1);
  const r = actOk(s, 'keepsake', { item: 'rose', ...(note ? { note } : {}) }, { pid: 'p2', now: T0 });
  const ev = evs(r, 'keepsake')[0];
  return { s, id: ev.id, ev };
}

test('L2-07: the recipient\'s "left you a surprise" line says where and carries Show me (no thanks) until the box is opened', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { s, id } = wrapped();
    const f = feedOn(s, 'p1');
    f.render();
    const li = f.list.children.find((x) => /surprise/.test(textOf(x)));
    assert.ok(li, `the line: ${JSON.stringify(lines(f.list))}`);
    assert.match(textOf(li), /left a surprise for you by the porch/);
    const btns = li.querySelectorAll('button');
    assert.equal(btns.length, 1, 'one button');
    assert.match(textOf(btns[0]), /Show me/);
    btns[0].click();
    const box = s.farm.objects[id];
    assert.deepEqual(f.focus, [[box.x + 0.5, box.z + 0.5]], 'it pans to the box');
    // opened: the box is gone, the thanks comes back
    actOk(s, 'openGift', { id }, { pid: 'p1', now: T0 + MIN });
    f.render();
    const li2 = f.list.children.find((x) => /left a surprise/.test(textOf(x)));
    assert.ok(li2, 'still there');
    assert.match(textOf(li2.querySelector('button')), /Thanks/);
  } finally { mock.timers.reset(); }
});

test('L2-07: the recipient hears it at once: a line with Show me when the partner leaves a surprise on the porch', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { s, ev } = wrapped();
    const L = {};
    const store = { state: s, pid: 'p1', cid: 'c1', now: () => T0 + 1000, on: (e, fn) => { (L[e] ||= []).push(fn); return () => {}; } };
    const toasts = [];
    const ui = { toast: (text, o) => { toasts.push([say(text), o]); return null; }, banner() { return { el: null, close() {} }; }, panels: { on() {}, top: () => null } };
    const focus = [];
    const view = { toScreen: () => ({ x: 400, y: 300, visible: true }), fx: { play() {} }, stats: () => null, focus: (x, z) => focus.push([x, z]) };
    const audio = { play() { return true; }, ladder() {}, coins() {}, duck() {}, setScene() {} };
    const fb = createFeedback({ store, controller: { on() { return () => {}; }, do() {}, haptic() {} }, view, audio, ui });
    for (const fn of L.fx || []) fn({ ev, by: 'p2', local: false });
    mock.timers.tick(100);
    const t = toasts.find(([x]) => /surprise/.test(x));
    assert.ok(t, `a line: ${JSON.stringify(toasts.map(([x]) => x))}`);
    assert.match(t[0], /by the porch/);
    assert.ok(t[1]?.action, 'with Show me');
    t[1].action.fn();
    assert.equal(focus.length, 1, 'which pans to the box');
    // the giver hears nothing of the sort
    toasts.length = 0;
    store.pid = 'p2';
    for (const fn of L.fx || []) fn({ ev, by: 'p2', local: true });
    mock.timers.tick(100);
    assert.ok(!toasts.some(([x]) => /left you/.test(x)));
    fb.dispose?.();
  } finally { mock.timers.reset(); }
});

test('L2-11: the farmer\'s mark is a flex item of the row, beside the words (not inside their line box)', () => {
  const s = farmAt(14);
  s.farm.feed = { n: 1, rows: { 0: { at: T0, by: 'p1', k: 'tend', q: 1 } } };
  const f = feedOn(s, 'p1');
  f.render();
  const li = f.list.children[0];
  assert.ok(li.children.some((c) => c.classList.contains('pmark')), 'the mark is the row\'s own child');
  assert.ok(!li.querySelector('.txt .pmark'), 'not inside the words');
});

test('F2-02: a one-tap note ("#thanks") reads in the reader\'s language: feed line, reveal card, its card in the toast layer, recap', async () => {
  const { s, id } = wrapped('#thanks');
  const r = actOk(s, 'openGift', { id }, { pid: 'p1', now: T0 + MIN });
  const ev = evs(r, 'giftOpened')[0];
  const row = (what) => Object.values(s.farm.feed.rows).find((x) => x.k === 'surprise' && x.what === what);
  try {
    for (const [lang, words, q] of [['en', 'Thank you ♥', /“Thank you ♥”/], ['bg', 'Благодаря ти ♥', /„Благодаря ти ♥“/]]) {
      await I.setLang(lang);
      // 1. the feed line
      const ft = feedText(row('opened'), s, 'p1');
      assert.match(ft.text, q, `${lang} feed: ${ft.text}`);
      assert.doesNotMatch(ft.text, /#thanks/);
      // 2. the reveal card
      const card = giftCard(ev, s, 'p1');
      assert.match(say(card.quote), q, `${lang} card: ${say(card.quote)}`);
      // 3. the card drawn by the toast layer
      document.body.replaceChildren(h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')));
      const toasts = createToasts({ store: { state: s, pid: 'p1' }, ui: { panels: { top: () => null, on() { return () => {}; } } } }, (c) => c);
      const b = toasts.banner(card);
      assert.equal(textOf(b.el.querySelector('.card-quote')), lang === 'en' ? `“${words}”` : `„${words}“`);
      b.close();
    }
    // 4. the welcome-back card: a surprise the farm shelved while p1 was away, with a token note
    const w = wrapped('#thinking');
    w.s.players.p1.lastSeenAt = T0 - MIN;
    const { runDue, HOUR } = await import('./helpers/rules-goals.js');
    runDue(w.s, T0 + 49 * HOUR);
    for (const [lang, qre] of [['en', /“Thinking of you”/], ['bg', /„Мисля си за теб“/]]) {
      await I.setLang(lang);
      let spec = null;
      const S = { store: { state: w.s, pid: 'p1', now: () => T0 + 50 * HOUR, on() {}, subscribe() {} },
        ui: { panels: { register(n, sp) { spec = sp; }, top: () => null, has: () => false, open() {} } }, controller: { do() {} } };
      createRecap(S);
      const body = document.createElement('div');
      document.body.append(body);
      spec.mount(body, { close() {} });
      assert.match(textOf(body), qre, `${lang} recap: ${textOf(body).slice(0, 300)}`);
      assert.doesNotMatch(textOf(body), /#thinking/);
    }
  } finally { await I.setLang('en'); }
});

// L2-09 (fe#3): "Изненада от Константин-Борис!" (16 = NAME_MAX) wrapped the reveal card's ribbon to three lines in a
// 65 px box at 360 BG and the body covered the last one. The ribbon stays short; the message under it names the giver.
test('L2-09: the reveal card\'s ribbon is short (no giver\'s name); the message names the giver', async () => {
  const { s, id } = wrapped();
  s.players.p2.name = 'Константин-Борис';
  const r = actOk(s, 'openGift', { id }, { pid: 'p1', now: T0 + MIN });
  const ev = evs(r, 'giftOpened')[0];
  try {
    for (const [lang, rib] of [['en', 'A surprise!'], ['bg', 'Изненада!']]) {
      await I.setLang(lang);
      const card = giftCard(ev, s, 'p1');
      assert.equal(say(card.ribbon), rib);
      assert.match(say(card.message), /Константин-Борис/);
    }
  } finally { await I.setLang('en'); }
});
