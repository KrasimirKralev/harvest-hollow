// QA r4 ui-shell fixes, Grandma's guide (docs/qa/release/qa-r4/fix-ui-shell.md):
//   S4-04 (fbp#2): the weed step's edge arrow rested on a boulder only the Axe clears, then pointed at bare lawn; a tap
//                  where it pointed did nothing.
//   S4-15 (jde#7): the Market's first-use selling tip stayed on every Market tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';

const src = (f) => fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
const document = installDom();
const TUT = await import('../public/js/ui/tutorial.js');

test('S4-04: the target off screen and the near pieces under the HUD: the edge arrow\'s tip picks no boulder', () => {
  assert.equal(typeof TUT.edgeClear, 'function', 'ui/tutorial.js edgeClear(way, box, pickAt, id) (HEAD: the tip stayed on the boulder)');
  // the tester's frame at 360 BG: a rock and a weed under the HUD, the step's weed off the right edge
  const state = { farm: { objects: {
    'a-weed': { def: 'weed', x: 28, z: 24 }, 'b-rock': { def: 'rock', x: 10, z: 30 }, 'c-weed': { def: 'weed', x: 12, z: 28 },
    'd-boulder': { def: 'boulder', x: 26, z: 26 },
  } } };
  const W = 360;
  const H = 640;
  const toScreen = (x, z) => ({ x: (x - 10) * 20 + 50, y: (z - 20) * 20 + 100, visible: true });
  const hud = [{ left: 0, top: 240, right: 140, bottom: 380 }];
  const id = TUT.debrisTarget(state, { toScreen, w: W, h: H, hud });
  assert.equal(id, 'a-weed', 'nothing the Hand clears is in view: the first weed, off screen');
  const s = toScreen(28.5, 24.5);
  assert.ok(s.x > W, 'off the right edge');
  const way = TUT.edgeTip(s, W, H, 70, null);
  // the boulder (2 x 2 tiles, Axe only) lies under the plain edge tip
  const boulderAt = (x, y) => Math.abs(x - way[0]) < 36 && Math.abs(y - way[1]) < 36;
  const pickAt = (x, y) => (boulderAt(x, y) ? { kind: 'object', id: 'd-boulder' } : { kind: 'tile', x: 0, z: 0 });
  const box = { cx: W / 2, cy: H / 2, b: { l: 35, t: 35, r: W - 35, b: H - 35 } };
  const clear = TUT.edgeClear(way, box, pickAt, id);
  assert.ok(clear, 'a clear spot exists');
  assert.notEqual(pickAt(clear[0], clear[1]).id, 'd-boulder', `the tip ${clear.map(Math.round)} is off the boulder (HEAD: ${way.map(Math.round)})`);
  assert.equal(clear[2], way[2], 'still turned toward the weed');
  assert.ok(clear[0] >= 35 && clear[0] <= W - 35 && clear[1] >= 35 && clear[1] <= H - 35, 'on screen');
  // a tip on the target itself, or on open ground, stays where edgeTip put it
  assert.deepEqual(TUT.edgeClear(way, box, () => ({ kind: 'object', id }), id), way);
  assert.deepEqual(TUT.edgeClear(way, box, () => null, id), way);
  // every spot on another object: no spot (the arrow fades rather than point at the wrong thing)
  assert.equal(TUT.edgeClear(way, box, () => ({ kind: 'object', id: 'd-boulder' }), id), null);
});

test('S4-04: a tap on the edge arrow (or just past its point) brings its target into view', () => {
  const tut = src('ui/tutorial.js');
  assert.match(tut, /el\.addEventListener\('click', \(\) => \{ const t = pointer\?\.target; if \(el\.classList\.contains\('edge'\) && t\?\.tile\) \{ const a = aimOf\(t\); view\.focus\(a\.x, a\.z\); \} \}\);/,
    'HEAD: the arrow took no taps; a tap where it pointed did nothing (033)');
  assert.match(tut, /el\.classList\.toggle\('under-card', !clear \|\|/, 'with no clear spot it fades');
  const shell = fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8');
  assert.match(shell, /\.pointer\.edge::after \{ content: ''; position: absolute; left: -28px; top: -80px; width: 56px; height: 96px; pointer-events: auto;/);
  // never over a HUD button: there the arrow takes no taps (Harvey's button sits by the right edge on a phone)
  assert.match(shell, /\.pointer\.edge\.under-card::after, \.pointer\.edge\.no-tap::after \{ pointer-events: none; \}/);
  assert.match(tut, /pointer\?\.el\.classList\.toggle\('no-tap', !edgeAt\.tap\);/);
});

/** A panel frame with a tab strip (`tabs` ids, `on` selected) and a scroll box, as ui/index.js builds it. */
function frameWith(tabs, on) {
  const frame = document.createElement('section');
  const strip = document.createElement('div');
  strip.className = 'hh-tabs';
  for (const id of tabs) {
    const b = document.createElement('button');
    b.className = 'hh-tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(id === on));
    b.dataset.tab = id;
    strip.append(b);
  }
  const scroll = document.createElement('div');
  scroll.className = 'hh-panel-scroll';
  frame.append(strip, scroll);
  document.body.append(frame);
  return frame;
}

test('S4-15: the Market\'s selling tip shows on Sell only, and counts as seen only while it is on screen', () => {
  const timers = [];
  let seen = 0;
  const frame = frameWith(['sell', 'seeds', 'decor'], 'sell');
  const el = TUT.mountPanelTip(frame, { label: 'Tip:', words: 'Pick a stack, slide the amount, sell.', closeLabel: 'Close', onSeen: () => { seen++; },
    setTimer: (fn) => timers.push(fn) });
  assert.equal(el.hidden, false, 'on Sell');
  assert.equal(typeof el.onTab, 'function', 'the strip follows the tab (HEAD: it stayed over Seeds, Decor and Buildings)');
  el.onTab('seeds');
  assert.equal(el.hidden, true, 'Seeds: the selling tip is not there');
  timers.shift()();
  assert.equal(seen, 0, 'hidden before its 2 s: not seen (S3-12\'s rule)');
  el.onTab('sell');
  assert.equal(el.hidden, false, 'back on Sell');
  assert.equal(timers.length, 1, 'its 2 s start again');
  timers.shift()();
  assert.equal(seen, 1);
  // the Market opened on another tab first: the tip waits for Sell
  const other = TUT.mountPanelTip(frameWith(['sell', 'seeds'], 'seeds'), { label: 'Tip:', words: 'x', closeLabel: 'Close', setTimer: () => {} });
  assert.equal(other.hidden, true);
  // a panel without tabs: always shown (S3-12)
  const plain = document.createElement('section');
  const sc = document.createElement('div');
  sc.className = 'hh-panel-scroll';
  plain.append(sc);
  assert.equal(TUT.mountPanelTip(plain, { label: 'Tip:', words: 'x', closeLabel: 'Close', setTimer: () => {} }).hidden, false);
  // the frame tells the shell its tab: the registry's 'tab' event, which the tutorial passes on
  assert.match(src('ui/index.js'), /emitPanel\('tab', e\.name, id\);/);
  assert.match(src('ui/tutorial.js'), /ui\.panels\.on\('tab', \(name, id\) => document\.getElementById\(`panel-\$\{name\}`\)\?\.querySelector\('\.panel-tip'\)\?\.onTab\?\.\(id\)\);/);
  assert.match(fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8'), /\.hh-panel \.panel-tip\[hidden\] \{ display: none; \}/);
});
