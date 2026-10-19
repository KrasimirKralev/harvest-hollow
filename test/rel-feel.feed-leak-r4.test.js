// QA r4 (life-feel) L4-08 (ap#3): feed lines the HUD removed were never freed. render() built `keep` (a Map of every
// line shown) and, in the same scope, each line's Show me / ♥ Thanks callback; those became the buttons' click handlers,
// so a line held that render's `keep`, which held the lines of the render before, and so on (the phone's detached
// `<li>` count grew 5 -> 86 in 6 minutes of a partner's "♥ Thanks" lines). The callbacks now come from a factory
// outside render(): after 200 renders, at most MAX + 2 lines are alive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { installDom } from './ui-qa2-dom.js';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');
const document = installDom();
document.documentElement = { lang: 'en' };
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.innerWidth = 390;
globalThis.innerHeight = 844;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { makeFarm, T0 } = await import('./helpers.js');
const { h } = await import('../public/js/ui/dom.js');
const { createFeed } = await import('../public/js/ui/feed.js');
const { FEED } = await import('../shared/content/index.js');

test('L4-08: after 200 renders that add "♥ Thanks" lines, at most MAX + 2 feed lines are alive', async () => {
  const s = makeFarm();
  s.players.p1.name = 'Ана';
  s.players.p2.name = 'Бо';
  s.farm.feed = { n: 0, rows: {} };
  let now = T0;
  document.body.replaceChildren(h('ol#feed'));
  const f = createFeed({ store: { state: s, pid: 'p1', now: () => now, on: () => () => {}, subscribe: () => () => {} },
    controller: { do() {} }, view: { focus() {} } });
  const list = document.getElementById('feed');
  const MAX = FEED.visibleLines || 5;
  const RING = FEED.historyMax;
  const refs = [];
  const seen = new WeakSet();
  let thanks = 0;
  for (let k = 0; k < 200; k++) {
    now = T0 + k * 2000;
    s.farm.feed.rows[String(k % RING)] = { at: now, by: 'p2', k: 'harvest', item: 'wheat', q: 3 };
    s.farm.feed.n = k + 1;
    f.render();
    for (const li of list.children) {
      if (seen.has(li)) continue;
      seen.add(li);
      refs.push(new WeakRef(li));
      if (li.querySelector('.thanks')) thanks++;
    }
  }
  assert.ok(thanks > 150, `the partner's lines carry "♥ Thanks" (${thanks})`);
  for (let i = 0; i < 4; i++) { gc(); await new Promise((r) => setImmediate(r)); }
  const alive = refs.filter((r) => r.deref()).length;
  assert.ok(alive <= MAX + 2, `${alive} of ${refs.length} feed lines still alive after the HUD let them go (at most ${MAX + 2})`);
});
