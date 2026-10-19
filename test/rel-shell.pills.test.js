// Release 1.0, ui-shell: F2 (feel#6) the pills roll on arrival, and M30 (critique#5) Hearts stay quiet on the HUD.
// F2: my own gain keeps the old number until the first 'hh:fly-arrive' of that kind (1.2 s at most), then rolls 400 ms
// and bumps once; a change meanwhile only moves the number it will roll to. M30: the Hearts pill is not in the top-right
// row any more (Hearts live on the Farm book's You page), and the level card's tip carries Beauty and Hearts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { T0, makeFarm } from './helpers.js';
import { xpForLevel } from '../shared/content/index.js';

const HUD = await import('../public/js/ui/hud.js');

function fakeTimers() {
  const q = [];
  return {
    setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; q.push(t); return t; },
    clearTimeout: (t) => { if (t) t.live = false; },
    fire: () => { for (const t of q.splice(0)) if (t.live) t.fn(); },
    count: () => q.filter((t) => t.live).length,
  };
}

function rigGate() {
  const rolls = [];
  const bumps = [];
  const timers = fakeTimers();
  const gate = HUD.arrivalGate({ roll: (el, to) => { rolls.push(to); el.dataset.v = String(to); }, bump: (pill, up) => bumps.push(up), timers });
  const el = { dataset: { v: '100' } };
  return { gate, rolls, bumps, timers, el, pill: {} };
}

test('F2: my own gain waits for its flight: the old number until hh:fly-arrive, then one roll and one bump', () => {
  const { gate, rolls, bumps, el, pill } = rigGate();
  assert.equal(gate.offer('coins', el, pill, 130, String, { gain: true, animate: true }), true, 'held');
  assert.equal(el.dataset.v, '100', 'the pill still shows the old number');
  assert.deepEqual(rolls, []);
  // the server's confirmation meanwhile (not a gain) only moves the target
  assert.equal(gate.offer('coins', el, pill, 135, String, { gain: false, animate: true }), true);
  assert.deepEqual(rolls, []);
  assert.equal(gate.land('barn'), false, 'another kind lands: nothing for coins');
  assert.equal(gate.land('coins'), true);
  assert.deepEqual(rolls, [135], 'one roll, to the latest number');
  assert.deepEqual(bumps, [true], 'one bump, up');
  assert.equal(gate.land('coins'), false, 'a second arrival does nothing');
});

test('F2: no flight comes: the number rolls after 1.2 s at most', () => {
  const { gate, rolls, bumps, timers, el, pill } = rigGate();
  gate.offer('barn', el, pill, 104, String, { gain: true, animate: true });
  assert.equal(timers.count(), 1);
  timers.fire();
  assert.deepEqual(rolls, [104]);
  assert.deepEqual(bumps, [true]);
  assert.equal(gate.waiting('barn'), false);
});

test('F2: spending, the partner\'s gains and the welcome do not wait', () => {
  const { gate, el, pill } = rigGate();
  assert.equal(gate.offer('coins', el, pill, 90, String, { gain: true, animate: true }), false, 'a spend shows at once');
  assert.equal(gate.offer('coins', el, pill, 150, String, { gain: false, animate: true }), false, 'the partner\'s sale');
  assert.equal(gate.offer('coins', el, pill, 150, String, { gain: true, animate: false }), false, 'a welcome');
  assert.equal(gate.offer(null, el, pill, 150, String, { gain: true, animate: true }), false, 'a pill with no flight kind');
});

test('F2: the HUD wires the gate to life-feel\'s arrival event and to my own predicted changes', () => {
  const src = fs.readFileSync(new URL('../public/js/ui/hud.js', import.meta.url), 'utf8');
  assert.match(src, /addEventListener\('hh:fly-arrive', \(e\) => \{ const k = e\.detail\?\.kind; if \(k\) gate\.land\(k\); \}\)/);
  assert.match(src, /store\.subscribe\('wallet', \(ch\) => renderWallet\(ch\.source !== 'welcome', ch\.source === 'local'\)\)/);
  assert.match(src, /store\.subscribe\('inventory', \(ch\) => renderBarn\(ch\.source !== 'welcome', ch\.source === 'local'\)\)/);
});

test('M30: Hearts leave the top-right row; the level card\'s tip says Acorns, Hearts and Beauty', () => {
  const css = fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8');
  assert.match(css, /#hud-hearts-pill[^{]*\{[^}]*display:\s*none/, 'the Hearts pill is hidden on the HUD');
  const s = makeFarm();
  s.farm.xp = xpForLevel(18);                         // Farm Beauty opens at 18
  s.players.p1.hearts = 42;
  s.farm.wallet.acorns = 3;
  const line = HUD.statsLine(s, 'p1', T0);
  assert.equal(typeof line, 'string');
  assert.match(line, /42/, 'Hearts in the level card');
  assert.match(line, /Beauty|Красота/, 'Beauty labelled');
});
