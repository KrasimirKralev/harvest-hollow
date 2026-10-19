// QA r4 ui-shell fixes, the HUD and its CSS (docs/qa/release/qa-r4/fix-ui-shell.md):
//   S4-01 (jde#1, va#1): Play re-showed the painting with the layer's 300 ms fade-in from 0 (a flat mauve frame).
//   S4-02 (jde#2): a quick pass over a HUD button left its tooltip stuck and blocked every hover card.
//   S4-03 (fbp#1): the stroke chip lifted Grandma's card over the turn button; her top measured mid stagger-in
//     (iPhone 13 BG, second fixer session) left the button's lower 19 px under her card.
//   S4-07 (fbp#6): tab strips ran off a 360 screen with no cue.
//   S4-08 (oib#2): the landscape side sheet's grip took taps 50 px into the Farm book.
//   S4-09 (br#2): an icon that failed once stayed a broken-image glyph for the session.
//   S4-10 (fbp#7): the coach's progress bar shrank to 7 px beside a count-down.
//   S4-13 (coop#2): after a hover on Together the whole bottom-left corner took the farm's clicks and wheel.
//   S4-14 (va#3): Settings segmented controls wrapped with one choice alone on a phone.
// The browser numbers are in the fix list (the probe's runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';

const css = (f) => fs.readFileSync(new URL(`../public/css/${f}`, import.meta.url), 'utf8');
const src = (f) => fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// one fake DOM for the file: document and window listeners are recorded so the modules' own handlers can be driven
const document = installDom();
document.head = document.createElement('head');
const DOC = {};
const WIN = {};
document.addEventListener = (t, fn) => { (DOC[t] ||= []).push(fn); };
globalThis.window = globalThis;
globalThis.addEventListener = (t, fn) => { (WIN[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { WIN[t] = (WIN[t] || []).filter((f) => f !== fn); };
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;
const fire = (list, ev) => { for (const fn of [...(list || [])]) fn(ev); };

test('S4-02: a 100 ms pass over a HUD button leaves no tooltip, and the field\'s hover card still comes', async () => {
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.hidden = true;
  const world = document.createElement('canvas');
  world.id = 'world';
  const btn = document.createElement('button');
  btn.dataset.tip = 'Sell and buy (M)';
  document.body.append(tip, world, btn);
  let hovered = null;
  const matches = btn.matches.bind(btn);
  btn.matches = (sel) => (sel === ':hover' ? hovered === btn : matches(sel));
  const { coopHarness } = await import('./helpers/client.js');
  const h = coopHarness();
  const HUD = await import('../public/js/ui/hud.js');
  const S = { store: h.a.store, controller: { input: 'mouse', tool: { id: 'hand' } }, view: {} };
  const tips = HUD.createTips(S);
  const over = (target) => { hovered = target; fire(DOC.pointerover, { target }); };
  over(btn);
  await sleep(100);
  over(world);
  await sleep(500);
  assert.equal(tip.hidden, true, `no tip for a button the pointer left (HEAD: "${tip.textContent}" shown over the field)`);
  // a world pick renders its card (HEAD: hudEl stayed set and renderWorld drew nothing)
  const plot = Object.keys(h.a.store.state.farm.objects).find((k) => h.a.store.state.farm.objects[k].def === 'plot');
  const o = h.a.store.state.farm.objects[plot];
  tips.tooltip({ kind: 'object', id: plot, x: o.x, z: o.z });
  await sleep(350);
  assert.equal(tip.hidden, false, 'the plot\'s card shows');
  assert.ok(tip.classList.contains('wtip'), 'a world card');
  tips.tooltip(null, { force: true });
  // a real dwell still shows the button's tip
  over(btn);
  await sleep(450);
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Sell and buy/);
  over(world);
  assert.equal(tip.hidden, true, 'and it goes when the pointer leaves');
});

test('S4-09: a failed icon hides its broken glyph and is asked for again, at once when the link is back', async () => {
  await import('../public/js/ui/dom.js');
  const sets = [];
  let cur = '/assets/icons/coins_64.png';
  const img = { tagName: 'IMG', dataset: {}, style: {}, getAttribute: (k) => (k === 'src' ? cur : null) };
  Object.defineProperty(img, 'src', { get: () => cur, set: (v) => { sets.push(v); cur = v; } });
  assert.ok((WIN.error || []).length, 'ui/dom.js listens for failed pictures (HEAD: no error path, the glyph stayed)');
  fire(WIN.error, { target: img });
  assert.equal(img.style.visibility, 'hidden', 'no broken-image glyph while it waits');
  assert.equal(img.dataset.retry, '1');
  fire(WIN.online, {});
  assert.deepEqual(sets, ['/assets/icons/coins_64.png'], 'the link is back: the same URL again at once');
  fire(WIN.error, { target: img });
  await sleep(2100);
  assert.equal(sets.length, 2, 'the second try after 2 s');
  fire(WIN.load, { target: img });
  assert.equal(img.style.visibility, '', 'shown again once it loads');
  assert.equal(img.dataset.retry, undefined);
  // not a game file, or one that failed eight times: left alone
  const other = { tagName: 'IMG', dataset: {}, style: {}, getAttribute: () => 'https://example.org/x.png' };
  fire(WIN.error, { target: other });
  assert.equal(other.style.visibility, undefined);
  const worn = { tagName: 'IMG', dataset: { retry: '8' }, style: {}, getAttribute: () => '/assets/icons/x.png' };
  fire(WIN.error, { target: worn });
  assert.equal(worn.style.visibility, undefined);
  // the page's own pictures (the coin and barn pills) fail before the module runs: swept at start
  assert.match(src('ui/dom.js'), /for \(const img of document\.images \?\? \[\]\) if \(img\.complete && !img\.naturalWidth\) imgRetry\(img\);/);
});

test('S4-01: the painting comes back whole after Play (no fade-in from 0), and a frame is drawn before the lift', async () => {
  const UI = await import('../public/js/ui/index.js');
  const picker = document.createElement('section');
  picker.id = 'slot-picker';
  const boot = document.createElement('section');
  boot.id = 'boot';
  boot.className = 'modal-layer boot';
  boot.hidden = true;
  document.body.append(picker, boot);
  UI.ui.hideSlots();
  assert.equal(boot.hidden, false, 'the curtain is back (S3-14)');
  assert.ok(boot.classList.contains('no-fade'), 'at full opacity at once (HEAD: the layer\'s fade-in ran from 0: a flat mauve frame)');
  assert.match(css('shell.css'), /#boot\.no-fade \{ animation: none; \}/);
  assert.match(src('ui/index.js'), /b\.classList\.remove\('lifting', 'no-fade'\)/, 'cleared when the curtain goes');
  assert.match(src('ui/index.js'), /view\?\.invalidate\?\.\(\);[\s\S]{0,200}requestAnimationFrame\(r\)/, 'a drawn frame before the fade');
});

test('S4-03: the right column follows her card\'s top, which the stroke chip lifts', () => {
  const tut = src('ui/tutorial.js');
  assert.match(tut, /setProperty\('--coach-up', `\$\{coachUpAt\(innerHeight, r\.top, /, 'HEAD: only her height (--coach-h) was known');
  assert.match(tut, /coachRo\.observe\(wrap, \{ box: 'border-box' \}\)/, 'the bottom stack\'s size (the chip in it) re-measures');
  const m = css('mobile.css');
  // owner 2026-10-19 (test/rel-shell.phone-edge.test.js): the column stands at the top of the edge lane under the coins
  // and no longer follows her card; her card's top (--coach-up) is still measured for the stack's other users
  assert.match(m, /\.hud-right \{ top: calc\(54px \+ var\(--sat\)\); \}/);
  assert.doesNotMatch(m, /body\.coach-on[^{]*\.hud-right/);
  // the pop-up open on a three-line step: her naming chip waits (a row less) and the column stands in front of her edge
  assert.match(m, /body\.tray-open \.coach--line \.coach-name \{ display: none; \}/, 'HEAD: her card at 150 px, "Харви" at 146-159 under it');
  assert.match(m, /body\.tray-open \.coach--line \.coach-paper:has\(\.coach-name\) \.acts \{ grid-column: 3; grid-row: 2; \}/);
  assert.match(fs.readFileSync(new URL('../tools/hud-audit.mjs', import.meta.url), 'utf8'), /row\.rightPop = \(await page\.evaluate\(measureHud\)\)\.rightHits;/,
    'hud-audit checks the column with an action line up and with the pop-up open');
});

// second fixer session: on iPhone 13 BG her card grew (99 -> 108 px) during the HUD's stagger-in, which still had the
// stack 32 px low; --coach-up was taken there (198 px) and kept, since the 1.4 s timer that drops `hud-in` cancels a
// late animation (no animationend). At rest her top was 615 px, so the turn button (590-634) had 19 px under her card
test('S4-03: her card\'s top is taken at rest, the stagger-in\'s translate taken out', async () => {
  const TUT = await import('../public/js/ui/tutorial.js');
  assert.equal(typeof TUT.coachUpAt, 'function', 'ui/tutorial.js coachUpAt(vh, top, translate) (before: innerHeight - rect.top, mid-animation)');
  assert.equal(TUT.coachUpAt(844, 647, '0px 32px'), 229, 'iPhone 13 BG: measured 32 px low, the resting top 615');
  assert.equal(TUT.coachUpAt(844, 631, '0px 16.5px'), 230);
  assert.equal(TUT.coachUpAt(844, 615, 'none'), 229, 'at rest');
  assert.equal(TUT.coachUpAt(640, 445, ''), 195);
  assert.equal(TUT.coachUpAt(640, 445, '12px'), 195, 'a sideways-only translate moves no top');
  assert.match(src('ui/tutorial.js'), /coachUpAt\(innerHeight, r\.top, wrap \? getComputedStyle\(wrap\)\.translate : ''\)/, 'coachUp reads the stack\'s live translate');
});

test('S4-07: a tab strip that runs off the sheet shows a cue on that side, and the chosen tab stays clear of it', async () => {
  const UI = await import('../public/js/ui/dom.js');
  assert.equal(typeof UI.tabCue, 'function', 'ui/dom.js tabCue(strip) (HEAD: overflow-x with no cue)');
  const s = document.createElement('div');
  Object.assign(s, { scrollLeft: 0, clientWidth: 344, scrollWidth: 686 });
  UI.tabCue(s);
  assert.deepEqual([s.classList.contains('more-l'), s.classList.contains('more-r')], [false, true], 'the Market at 360 BG: more on the right');
  s.scrollLeft = 200;
  UI.tabCue(s);
  assert.deepEqual([s.classList.contains('more-l'), s.classList.contains('more-r')], [true, true]);
  s.scrollLeft = 342;
  UI.tabCue(s);
  assert.deepEqual([s.classList.contains('more-l'), s.classList.contains('more-r')], [true, false]);
  Object.assign(s, { scrollLeft: 0, scrollWidth: 344 });
  UI.tabCue(s);
  assert.deepEqual([s.classList.contains('more-l'), s.classList.contains('more-r')], [false, false], 'a strip that fits: no cue');
  const shell = css('shell.css');
  assert.match(shell, /\.hh-tabs::after \{ content: '›' \/ ''; right: calc\(-1 \* var\(--tab-pad, 10px\)\);/);
  assert.match(shell, /\.hh-tabs\.more-l::before, \.hh-tabs\.more-r::after \{ visibility: visible; \}/);
  assert.match(src('ui/index.js'), /on: \{ scroll: \(\) => tabCue\(e\.tabsEl\)/, 'kept up as the strip scrolls');
});

test('S4-08: on a landscape phone the side sheet\'s grip takes taps only in its 12 px gutter', () => {
  const m = css('mobile.css');
  assert.match(m, /\.hh-panel\.size-side \.hh-sheet-grip::before, \.hh-panel\.size-wide \.hh-sheet-grip::before, \.hh-panel\.size-full \.hh-sheet-grip::before,\s*#panel-menu \.hh-sheet-grip::before \{ inset: -8px -2px -8px -5px; \}/,
    'HEAD: the upright grip\'s inset -6px -50px -10px, 105 x 60 px over the first column');
});

test('S4-10: the coach\'s bar keeps 56 px beside a count-down', () => {
  assert.match(css('mobile.css'), /\.coach--line \.prog \.bar \{ min-width: 56px; \}/, 'HEAD: flex 1 1 0%, 7.4 px at 360 BG');
});

test('S4-13: after a hover on Together only the lines\' column and its bridge hold the hover, not the corner', () => {
  const shell = css('shell.css');
  assert.doesNotMatch(shell, /#hud > \.hud-bl:hover \{ pointer-events: auto; \}/, 'HEAD: the whole 340 x 270 box took the clicks');
  assert.match(shell, /#hud > \.hud-bl:hover \.feed \{ pointer-events: auto; \}/);
  assert.match(shell, /\.feed \{ position: relative;/);
});

test('S4-14: Settings choices keep one row on a phone: "Auto" for the device\'s motion, tighter five-choice rows', async () => {
  const en = (await import('../public/js/i18n/en/dock.js')).default;
  const bg = (await import('../public/js/i18n/bg/dock.js')).default;
  assert.equal(en['dock.motion.system'], 'Auto', 'HEAD: "Like this device" put "Still" on a row of its own');
  assert.equal(bg['dock.motion.system'], 'Авто', 'HEAD: „Като устройството“');
  assert.ok(en['dock.motion.systemHelp'] && bg['dock.motion.systemHelp'], 'the help line says what Auto does');
  assert.match(src('ui/settings.js'), /`\$\{t\('dock\.motion\.systemHelp'\)\} \$\{t\('settings\.motionHelp'\)\}`/);
  assert.match(css('mobile.css'), /@media \(max-width: 600px\) \{\s*\.seg:has\(> button:nth-child\(4\)\) > button \{ padding-inline: 7px; font-size: \.8125rem; \}/,
    'HEAD: "Еко" alone on a second row at 360 BG');
});
