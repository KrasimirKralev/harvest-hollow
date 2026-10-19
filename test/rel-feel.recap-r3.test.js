// QA r3 (life-feel) L3-02 (jde#6): "Welcome back" never mentioned finished workshop goods. After 9 h away a fresh farm's
// card said "Ready for you: 16 plots of crops, 2 animals with goods." while the Feed Mill and the Windmill each held a
// finished tray; on the owners' late save 10 workshops held goods and the card listed crops, animals and trees only.
// Cause: ui/recap.js `ripenedNow` counted `trays` only for objects with `readyAt`; workshop goods are `queue` items
// with `e <= now` (and the Compost Bin's `ready`). A workshop with goods counts once, however many are waiting.
// (The EN line's singular, "1 finished trays", is ui-panels' catalog: applied there, see fix-ui-panels.md.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

const document = installDom();
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { makeFarm, T0 } = await import('./helpers.js');
const { createRecap, ripenedNow, buildRecap } = await import('../public/js/ui/recap.js');

const AWAY = T0 + 60_000;
const NOW = AWAY + 9 * 3600_000;
/** A building with a tray: `queue` items as [start, end] offsets from AWAY (ms), optional compost waiting. */
function workshop(def, x, items, extra = {}) {
  return { def, x, z: 40, rot: 0, placedAt: AWAY - 3600_000, by: 'p1', slots: 4, made: 0,
    queue: items.map(([s, e], i) => ({ r: 'x', s: AWAY + s, e: AWAY + e, by: 'p1', in: {}, k: i + 1 })), ...extra };
}
function awayFarm(objects) {
  const s = makeFarm();
  s.players.p1.lastSeenAt = AWAY;
  s.farm.feed = { n: 0, rows: {} };
  Object.assign(s.farm.objects, objects);
  return s;
}
function mount(s, now) {
  let spec = null;
  const S = {
    store: { state: s, pid: 'p1', now: () => now },
    ui: { panels: { register(name, sp) { spec = sp; }, top: () => null, has: () => false, open() {} } },
    controller: { do() {} },
    view: { focus() {} },
  };
  createRecap(S);
  const body = document.createElement('div');
  document.body.append(body);
  spec.mount(body, { close() {} });
  return body;
}

test('L3-02: a workshop with a finished queue item is one tray, and the card says so', () => {
  const s = awayFarm({ 'w.mill': workshop('feed_mill', 10, [[0, 60_000]]) });
  assert.equal(ripenedNow(s, NOW).trays, 1, 'the Feed Mill\'s finished Chicken Feed');
  const rec = buildRecap(s, 'p1', NOW);
  const sec = rec.sections.find((x) => x.name === 'ripened');
  assert.ok(sec, `a "Ready for you" section (sections: ${rec.sections.map((x) => x.name).join(', ')})`);
  assert.equal(sec.items.trays, 1);
  const text = textOf(mount(s, NOW));
  assert.match(text, /1 workshop with goods ready/, `the line on the card: ${text.slice(0, 200)}`);
});

test('L3-02: each workshop counts once; running and waiting items and empty trays do not count; compost does', () => {
  const s = awayFarm({
    'w.mill': workshop('feed_mill', 10, [[0, 60_000], [60_000, 120_000]]),         // two finished: one workshop
    'w.wind': workshop('windmill', 20, [[0, 60_000], [60_000, 20 * 3600_000]]),     // one finished, one still running
    'w.bake': workshop('bakery', 30, [[NOW - AWAY - 60_000, NOW - AWAY + 3600_000]]), // running only
    'w.dairy': workshop('dairy', 40, []),                                            // empty
    'w.comp': workshop('compost_bin', 50, [], { ready: 2 }),                          // compost waiting
  });
  const r = ripenedNow(s, NOW);
  assert.equal(r.trays, 3, 'the Feed Mill, the Windmill and the Compost Bin');
  assert.equal(r.total, r.crops + r.animals + r.trees + r.trays);
  assert.match(textOf(mount(s, NOW)), /3 workshops with goods ready/);
});

test('L3-02: an animal and a tree are still counted by their readyAt, never as trays', () => {
  const s = awayFarm({
    'w.mill': workshop('feed_mill', 10, [[0, 60_000]]),
    't.apple': { def: 'apple_tree', x: 60, z: 40, rot: 0, placedAt: AWAY - 3600_000, by: 'p1', cycle: 1, readyAt: AWAY + 60_000 },
    'a.hen': { def: 'chicken', home: 'w.coop', x: 70, z: 40, readyAt: AWAY + 60_000 },
  });
  const r = ripenedNow(s, NOW);
  assert.deepEqual([r.trays, r.trees, r.animals], [1, 1, 1]);
});
