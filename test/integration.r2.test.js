// QA r2 integration: the cross-lane patches the integrator applied for the lanes (docs/qa/release/qa-r2/fix-*.md
// "Cross-lane"), each pinned where it is pure enough to test without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coopHarness } from './helpers/client.js';
import { farmAt, placeDef } from './helpers/rules.js';
import { createFeedback, bigSpendLine } from '../public/js/game/feedback.js';
import { showMeTarget } from '../public/js/ui/levelup.js';
import { freeToPlace } from '../public/js/ui/toolbar.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('F2-03 (features\' patch to life-feel): a big planting stroke tells the partner it is a planting, not a purchase', () => {
  const h = coopHarness();
  const text = bigSpendLine([{ e: 'planted', id: 'x', crop: 'pumpkin', by: 'p1' },
    { e: 'bigSpend', by: 'p1', coins: 25_420, acorns: 0, what: 'pumpkin', n: 82 }], h.state, 'p1', 0)?.text;
  assert.match(text, /^Rowan is planting 82 plots with \S+ — 25,420 coins$/);
  // a purchase of a thing keeps its own line
  const buy = bigSpendLine([{ e: 'placed' }, { e: 'bigSpend', by: 'p1', coins: 2600, acorns: 0, what: 'bakery' }], h.state, 'p1', 0)?.text;
  assert.equal(buy, 'Rowan is buying a Bakery — 2,600 coins');
});

test('S2-01 (ui-shell\'s X-4 to life-feel): "Show me" on a level\'s free building opens the build tray, not the Market', () => {
  const s = farmAt(3);
  const free = freeToPlace(s);
  assert.ok(free.length > 0, 'level 3 has a free building to place');
  assert.deepEqual(showMeTarget({ family: 'buildings', id: free[0] }, s), { tray: free[0] });
  placeDef(s, free[0]);
  assert.deepEqual(showMeTarget({ family: 'buildings', id: free[0] }, s),
    { panel: 'market', args: { tab: 'buildings', focus: free[0] } }, 'once placed, the Market shows it');
});

test('S2-02 (ui-shell\'s X-5 to life-feel): the arrival chime waits for the shell\'s "hh:peer", never MSG.PEER alone', () => {
  const h = coopHarness();
  const sounds = [];
  const audio = { play: (name) => { sounds.push(name); return true; }, ladder() {}, coins() {}, duck() {}, setScene() {} };
  const et = new EventTarget();
  const had = Object.hasOwn(globalThis, 'addEventListener');
  const keep = globalThis.addEventListener;
  globalThis.addEventListener = et.addEventListener.bind(et);
  try {
    const fb = createFeedback({ store: h.b.store, controller: { on() { return () => {}; }, stroke: null },
      view: { toScreen: () => ({ x: 0, y: 0, visible: true }), fx: { play() {} }, stats: () => ({}) },
      audio, ui: { toast() {} } });
    fb.peer('p1', true);                                    // a reconnect's MSG.PEER: no chime of its own
    assert.deepEqual(sounds.filter((n) => n === 'arrive'), []);
    et.dispatchEvent(new CustomEvent('hh:peer', { detail: { pid: 'p1', online: true } }));
    assert.deepEqual(sounds.filter((n) => n === 'arrive'), ['arrive'], 'the shell said the partner arrived');
    et.dispatchEvent(new CustomEvent('hh:peer', { detail: { pid: 'p1', online: false } }));
    assert.equal(sounds.filter((n) => n === 'arrive').length, 1, 'a leave plays no arrival');
    fb.dispose?.();
  } finally {
    if (had) globalThis.addEventListener = keep; else delete globalThis.addEventListener;
  }
});

test('L2-04 (life-feel\'s note to ui-shell): on a phone the bench chip goes under the Golden Hour pill', () => {
  assert.match(read('public/css/mobile.css'), /#hud:has\(\.buffs > \*\) \.bench-chip \{ top: calc\(150px \+ var\(--sat\)\); \}/);
});

test('OBS-1 (infra\'s note to ui-shell): a hosted farm\'s page preloads the picker painting only where its gate paints it', () => {
  const html = read('public/index.html');
  assert.match(html, /l\.media = m \? '\(min-width: 961px\)' : '\(min-width: 960px\), \(min-resolution: 1\.5dppx\)';/);
  assert.match(read('public/css/farm.css'), /@media \(min-width: 961px\) \{ #farm-gate\.modal-layer \{ background-image: url\('\.\.\/assets\/art\/welcome\.webp'\); \} \}/,
    'the gate\'s wide-screen painting the preload follows');
});
