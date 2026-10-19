// QA r3, ui-shell: the two farmers.
//   S3-10 (jde#2): a partner's first join was told to nobody: no feed line, no toast, no chime (S2-02 silenced every
//         first sight, and a brand-new partner is in no welcome).
//   S3-21 (coop#5): the duel's winner read about themselves in the third person ("Rowan wins the Order Rush!").
//   S3-22 (coop#6): "{partner} is waiting on the bench · Join" while Golden Hour already ran.
//   S3-C1 (ap#1, carried S2-14): closing the surprise sheet dropped the focus to <body> (no opener recorded).
//   S3-C2 (coop#2, carried L2-07): after 8 s nothing led to a surprise waiting for me.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFarm } from '../shared/rules/state.js';
import { COOP } from '../shared/content/index.js';
import { dayOf } from '../shared/rules/coop.js';
import { T0 } from './helpers.js';

const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const id = realTimeout(fn, ms, ...a); id?.unref?.(); return id; };

const UI = await import('../public/js/ui/index.js');
const src = (f) => fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');

function timers() {
  let t = 0;
  const q = [];
  return {
    setTimer: (fn, ms) => { const e = { at: t + ms, fn }; q.push(e); return e; },
    clearTimer: (e) => { const i = q.indexOf(e); if (i >= 0) q.splice(i, 1); },
    advance(ms) { t += ms; q.sort((a, b) => a.at - b.at); while (q.length && q[0].at <= t) q.shift().fn(); },
  };
}

test('S3-10: a brand-new partner\'s first MSG.PEER (online) is an arrival; the welcome\'s list stays silent', () => {
  const said = [];
  const c = timers();
  const news = UI.peerNews((pid, on) => said.push([pid, on]), c);
  // a welcome without the partner, then the partner claims the free slot and comes online
  news('p2', true, { live: true });
  assert.deepEqual(said, [['p2', true]], 'one arrival: the feed line and the toast (HEAD: nothing, the first sight was silent)');
  news('p2', true, { live: true });
  assert.equal(said.length, 1, 'once');
  // the welcome's own list: silent, online or not (S2-02 stays fixed)
  const said2 = [];
  const news2 = UI.peerNews((pid, on) => said2.push([pid, on]), timers());
  news2('p2', true, { live: false });
  news2('p3', false);
  assert.deepEqual(said2, []);
  // a first live sight of someone going away says nothing
  const said3 = [];
  const news3 = UI.peerNews((pid, on) => said3.push([pid, on]), timers());
  news3('p2', false, { live: true });
  assert.deepEqual(said3, []);
});

test('S3-10: ui.setPeer tells the welcome\'s list from a live message (the welcome marks its own task)', () => {
  const ix = src('ui/index.js');
  assert.match(ix, /setPeer\(pid, isOnline, \{ welcome = inWelcome \} = \{\}\)/);
  assert.match(ix, /peerNewsOf\(\)\(pid, isOnline, \{ live: !welcome \}\)/);
  assert.match(ix, /markWelcome\(\);\n\s+store\.on\('welcome', markWelcome\);/, 'the first welcome (init) and every later one');
});

test('S3-21: the winner reads the duel\'s close in the second person; the partner in the third', async () => {
  const M = await import('../public/js/game/m2-moments.js');
  assert.equal(typeof M.duelEndLine, 'function', 'game/m2-moments.js duelEndLine(state, ev, me)');
  const s = createFarm(7, T0);
  s.players.p1 = { ...s.players.p1, name: 'Ana' };
  s.players.p2 = { ...(s.players.p2 ?? s.players.p1), name: 'Bo' };
  const ev = { e: 'duelEnded', scored: true, win: 'p1', kind: 'orders' };
  const mine = M.duelEndLine(s, ev, 'p1');
  assert.match(mine, /^You win the /, `the winner (HEAD: "Ana wins the ...": ${mine})`);
  assert.doesNotMatch(mine, /Ana/);
  assert.match(M.duelEndLine(s, ev, 'p2'), /^Ana wins the /, 'the partner reads the name');
  assert.match(M.duelEndLine(s, { ...ev, tie: true }, 'p1'), /\S/);
});

test('S3-22: the bench chip only when sitting down is good for something', async () => {
  const SOC = await import('../public/js/ui/social.js');
  assert.equal(typeof SOC.benchUseful, 'function', 'ui/social.js benchUseful(state, pid, now)');
  const s = createFarm(7, T0);
  const now = T0 + 3_600_000;
  s.farm.coop = { ...(s.farm.coop ?? {}) };
  assert.equal(SOC.benchUseful(s, 'p1', now), true, 'no Golden Hour yet: the sit can start one');
  // Golden Hour running (the tester's frame: 29:24 left)
  s.farm.coop.golden = { from: now - 60_000, until: now + 29 * 60_000 };
  s.farm.coop.goldenAt = now - 60_000;
  assert.equal(SOC.benchUseful(s, 'p1', now), false, 'not while Golden Hour runs (HEAD: the chip came back)');
  // after it: the session gap not passed, today's bench already counted with my seat
  s.farm.coop.golden = { from: now - 40 * 60_000, until: now - 10 * 60_000 };
  s.farm.coop.goldenAt = now - 40 * 60_000;
  s.farm.coop.days = { d: dayOf(s, now), sat: { p1: 1, p2: 1 }, cast: {}, done: { bench: 1 } };
  assert.equal(SOC.benchUseful(s, 'p1', now), false, 'nothing left for the sit today');
  // the same, but today's bench not counted and my seat missing: the together quests can use it
  s.farm.coop.days = { d: dayOf(s, now), sat: { p2: 1 }, cast: {}, done: {} };
  assert.equal(SOC.benchUseful(s, 'p1', now), true);
  // the gap passed: a new Golden Hour may start
  assert.equal(SOC.benchUseful(s, 'p1', now + COOP.goldenHour.sessionGapMs), true);
});

test('S3-C1: the gift entry gives the Together button the focus before the sheet opens (its opener)', () => {
  const soc = src('ui/social.js');
  assert.match(soc, /function openGift\(\) \{[\s\S]*?closeTogether\(\{ focus: !inBook\(\) \}\);[\s\S]*?import\('\.\/panels\/gift\.js'\)/,
    'HEAD: closeTogether() hid the focused button first, the focus fell to <body> and the sheet had no opener');
  assert.match(UI.focusBackTo.toString(), /aria-controls/, 'the sheet\'s close then goes back to the opener or its door');
});

test('S3-C2: a surprise waiting for me: the Farm book button says so on a phone; Together and the gift door carry a dot', async () => {
  const L = await import('../public/js/ui/layout.js');
  assert.deepEqual(L.menuBadge([], { gift: true }), { text: '!', tone: 'red' }, 'the book\'s button (HEAD: no cue at all)');
  assert.equal(L.menuBadge([]), null);
  const soc = src('ui/social.js');
  assert.match(soc, /giftBtn\.classList\.toggle\('has-gift', waiting\)/);
  assert.match(soc, /togetherBtn\.classList\.toggle\('has-gift', waiting\)/);
  assert.match(soc, /t\('dock\.together\.giftOpen'\)/, '"Open your surprise" on its door');
  const en = (await import('../public/js/i18n/en/dock.js')).default;
  const bg = (await import('../public/js/i18n/bg/dock.js')).default;
  for (const k of ['dock.together.giftOpen', 'dock.together.giftOpenShort', 'dock.together.labelGift']) assert.ok(en[k] && bg[k], k);
  const css = fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.social-btn\.has-gift::before \{/);
  // the faded feed lines: once the corner is hovered it holds the hover across its 10 px gap up to "Show me"
  // (HEAD: the gap had no hit area, the lines faded again on the way up)
  // (QA r4 S4-13: the lines' column and a bridge over the gap hold it, never the whole corner box)
  assert.match(css, /#hud > \.hud-bl:hover \.feed \{ pointer-events: auto; \}/, 'the corner holds its hover');
  assert.match(css, /#hud > \.hud-bl:hover \.feed::after \{ content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 12px; \}/);
  // never on focus: a focused button inside the corner would make the whole corner swallow the next farm click
  assert.doesNotMatch(css, /\.hud-bl:focus-within \{ pointer-events/, 'no focus wall');
});
