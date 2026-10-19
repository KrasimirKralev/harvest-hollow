// Release 1.0, QA round 4 (features lane; docs/qa/release/qa-r4/fix-features.md): F4-C1 the farmer who still has to
// sit (or cast) today gets the half as NOW, and one line on arrival; F4-02 a seated farmer is not told to sit; F4-03 a
// rename names the old name and is no thanks for the old namer; F4-04 the phone chip's count says "N more"; F4-05 a
// farm of one is not offered the two-farmer tasks; F4-06 the Ribbon Track's drip card names the feature.
// RED on 289b672 (the tested head): the RED lines are in docs/qa/release/qa-r4/fix-features.md, item by item.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { CONTENT } from '../shared/content/index.js';
import * as GOALS from '../shared/rules/goals.js';
import { goals } from '../shared/rules/goals.js';
import { enText } from '../shared/rules/goal-text.js';
import * as FEED from '../shared/rules/feed.js';
import { feedRows } from '../shared/rules/feed.js';
import { dayOf } from '../shared/rules/coop.js';
import { localHour } from '../shared/rules/calendar.js';
import { resetGrid } from '../shared/rules/grid.js';
import { live } from '../shared/content/index.js';
import { farmAt, put, act, actOk, valid, T0, MIN, HOUR } from './helpers/rules-goals.js';
import EN_LEAGUE from '../public/js/i18n/en/league.js';

installDom();
globalThis.requestAnimationFrame ??= () => 0;
globalThis.innerHeight ??= 768;
globalThis.innerWidth ??= 1366;
{
  // the fake DOM reads "a > b" as "a b" (the tracker's '.mini > i')
  const proto = Object.getPrototypeOf(document.createElement('div'));
  const qsa = proto.querySelectorAll;
  proto.querySelectorAll = function querySelectorAll(sel) { return qsa.call(this, String(sel).replace(/\s*>\s*/g, ' ')); };
}

let T = null;          // public/js/ui/tracker.js (after the fake DOM)
let I18N = null;       // public/js/i18n/index.js
before(async () => {
  T = await import('../public/js/ui/tracker.js');
  I18N = await import('../public/js/i18n/index.js');
});

const TZ = 'Europe/Sofia';
/** A Sofia wall-clock time in October 2026 (EEST, UTC+3, until 04:00 on 25 Oct). */
const at = (day, h, m = 0) => {
  const guess = Date.UTC(2026, 9, day, h - 3, m);
  return localHour(guess, TZ) === h ? guess : Date.UTC(2026, 9, day, h - 2, m);
};

/** A plain localStorage for the page (the tracker's kv), so a "reload" can be told from a re-render. */
function storage() {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k), clear: () => m.clear() };
  return m;
}

/**
 * A tracker over a fake DOM with a clock the test moves (rel-features.r3's tracker()): the rules' real goals() unless
 * `res` is given; the shell's calls recorded (panels opened, toasts with their action, controller calls).
 */
function tracker(state, { pid = 'p1', now = at(14, 15), res = null, online = [], panel = null } = {}) {
  document.body.replaceChildren();
  const box = document.createElement('div');
  box.id = 'tracker';
  document.body.append(box);
  const clock = { now };
  const calls = { open: [], toasts: [], did: [], sat: [], pinged: [] };
  const S = {
    store: { state, pid, now: () => clock.now, subscribe() {} },
    view: { focus() {} },
    hud: { isOnline: (p) => online.includes(p) },
    ui: { panels: { has: () => true, top: () => panel, open(n, a) { calls.open.push([n, a]); return true; } },
      toast(text, opts) { calls.toasts.push({ text: typeof text === 'function' ? text() : text, opts }); }, confirm: () => Promise.resolve(true) },
    controller: { do: (ty, a) => { calls.did.push([ty, a]); return { ok: true }; }, tool: { id: 'hand' }, TOOLS: [{ id: 'hand' }], setTool() {},
      sitOn: (id) => { calls.sat.push(id); return true; }, ping: (x, z) => { calls.pinged.push([x, z]); return true; } },
    tutorial: { flash() {} },
  };
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window ??= globalThis;
  globalThis.window.addEventListener ??= () => {};
  globalThis.dispatchEvent = () => true;
  let tr;
  try { tr = T.createTracker(S); } finally { globalThis.setInterval = realInterval; }
  if (res) tr.useRulesGoals(() => res);
  tr.render();
  return { tr, S, calls, box, clock, set(p) { S.ui.panels.top = () => p; } };
}

const H = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
/** A farm at quest `qid` with the chain done up to it and `qid` the active card (rel-features.r3's atQuest). */
function atQuest(qid, o = {}) {
  const q = CONTENT.quests.get(qid);
  const s = farmAt(Math.max(q.level, qid === 'h6' ? 30 : 1), o);
  s.farm.wallet.coins = 50_000_000;
  s.farm.expansions = live('expansions').map((e) => e.id);
  resetGrid(s);
  for (const id of H.slice(0, H.indexOf(qid))) s.farm.quests.done[id] = T0;
  for (const id of Object.keys(s.farm.quests.active)) delete s.farm.quests.active[id];
  s.farm.quests.active[qid] = { at: T0, n: {} };
  return s;
}
/** Every plot ripe (the collect card's case, NOW 10). */
function ripen(s, now) {
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = { def: 'carrot', plantedAt: now - HOUR, readyAt: now - MIN, by: 'p1', cycle: 0 };
  }
}
/** p2 sat on `bench` this morning and stood up (h1 / h7's half). */
function p2Sat(s, bench, day = 14) {
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: at(day, 10), ext: { near: 5 } });
  actOk(s, 'stand', {}, { pid: 'p2', now: at(day, 10, 2) });
}

// ---- F4-C1 ----------------------------------------------------------------------------------------------------------

test('F4-C1: the farmer still to sit today gets the half as NOW, over ripe crops; the sitter keeps it in SOON', () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  p2Sat(s, bench);
  const later = at(14, 15);
  ripen(s, later);
  const g = goals(s, 'p1', later);
  assert.equal(g.now.kind, 'half', `NOW is ${g.now.kind} "${g.now.text}"`);
  assert.equal(g.now.id, 'h7');
  // its words lead with the verb (the phone chip shows only the title), then who did their half and which letter
  const text = enText(g.now.msg);
  assert.match(text, /^Sit on any bench before midnight/);
  assert.match(text, new RegExp(s.players.p2.name));
  assert.match(text, /Golden Hour on the Hill/);
  assert.equal(g.now.target.sit, bench, 'a tap walks there and sits');
  // the collect card the player was looking at does not keep NOW (hysteresis), novelty either way
  for (const recent of [[], ['half'], ['half', 'collect']]) {
    const k = goals(s, 'p1', later, { keep: { kind: 'collect', id: null, ref: 'fields' }, recent });
    assert.equal(k.now.kind, 'half', `kept collect, recent ${recent.join('+') || '-'}: ${k.now.kind}`);
  }
  // the sitter: its own half is not NOW (the ripe crops are), and still told in SOON
  const mine = goals(s, 'p2', later);
  assert.notEqual(mine.now.kind, 'half');
  assert.equal(mine.soon.kind, 'half');
  // Golden Hour with both here comes first (M29: coach > Golden Hour > today's half > collect)
  s.farm.coop.goldenAt = null;
  assert.equal(goals(s, 'p1', at(14, 19, 30), { online: ['p1', 'p2'] }).now.kind, 'golden');
  assert.ok(GOALS.NOW_SCORE.golden > GOALS.NOW_SCORE.half && GOALS.NOW_SCORE.half > 12, 'above a full Barn (12) and collect (10)');
  // the next farm day the half is gone
  assert.notEqual(goals(s, 'p1', at(15, 10)).now.kind, 'half');
});

test('F4-C1: the same for "Gone Fishing": cast a line before midnight', () => {
  const s = atQuest('h6');
  s.farm.coop.days = { d: dayOf(s, at(14, 10)), sat: {}, cast: { p1: 1 }, done: {} };
  const g = goals(s, 'p2', at(14, 15)).now;
  assert.equal(g.kind, 'half');
  assert.match(enText(g.msg), /^Cast a line before midnight/);
  assert.match(enText(g.msg), /Gone Fishing/);
});

test('F4-C1: the tracker shows the half as its NOW card, the verb in the title (desktop card and phone chip)', () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  p2Sat(s, bench);
  storage();
  const t = tracker(s, { now: at(14, 15) });
  const now = t.box.querySelector('.goal[data-slot="now"]');
  assert.ok(now, 'a NOW card');
  assert.equal(now.dataset.goal, 'h7');
  assert.equal(now.querySelector('.gt').textContent, 'Sit on any bench before midnight');
  assert.match(now.querySelector('.gs').textContent, new RegExp(`${s.players.p2.name} ✓ · Golden Hour on the Hill`));
  assert.equal(t.box.parentNode.querySelector('.tracker-chip .tc-t').textContent, 'Sit on any bench before midnight');
  // one card for the quest (no letter under STORY), and a click walks to the bench and sits
  assert.deepEqual([...t.box.querySelectorAll('.goal')].filter((el) => el.dataset.goal === 'h7').map((el) => el.dataset.slot), ['now']);
  now.click();
  assert.deepEqual(t.calls.sat, [bench]);
});

test('F4-C1: one line on arrival when the partner did their half while I was away, once a farm day', () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  p2Sat(s, bench);
  storage();
  const start = at(14, 15);
  const t = tracker(s, { now: start });
  // not in the first moments (the curtain, the welcome back card), nor over an open panel
  assert.deepEqual(t.calls.toasts, [], 'not at the first render');
  t.set('recap');
  t.clock.now = start + 5000;
  t.tr.render();
  assert.deepEqual(t.calls.toasts, [], 'not over the welcome back card');
  t.set(null);
  t.tr.render();
  assert.equal(t.calls.toasts.length, 1, 'one line once the farm is in view');
  const [line] = t.calls.toasts;
  assert.match(line.text, new RegExp(`^${s.players.p2.name} sat on a bench today`));
  assert.match(line.text, /before midnight/);
  assert.match(line.text, /Golden Hour on the Hill/);
  assert.equal(typeof line.opts.action?.fn, 'function', 'with Show me');
  line.opts.action.fn();
  assert.deepEqual(t.calls.sat, [bench], 'Show me walks there and sits');
  // the next renders, and a reload the same farm day: no second line
  t.clock.now += 60_000;
  t.tr.render();
  const again = tracker(s, { now: start + 2 * HOUR });
  again.clock.now += 5000;
  again.tr.render();
  assert.equal(t.calls.toasts.length + again.calls.toasts.length, 1, 'once a farm day');
  // the next farm day, a new half: the line again
  s.farm.coop.days = { d: dayOf(s, at(15, 10)), sat: { p2: 1 }, cast: {}, done: {} };
  const next = tracker(s, { now: at(15, 15) });
  next.clock.now += 5000;
  next.tr.render();
  assert.equal(next.calls.toasts.length, 1, 'the next farm day');
});

test('F4-C1: no arrival line while the partner is here (the bench chip says it), nor for my own half', () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  p2Sat(s, bench);
  storage();
  const here = tracker(s, { now: at(14, 15), online: ['p2'] });
  here.clock.now += 5000;
  here.tr.render();
  assert.deepEqual(here.calls.toasts.map((x) => x.text), []);
  storage();
  const sitter = tracker(s, { pid: 'p2', now: at(14, 15) });
  sitter.clock.now += 5000;
  sitter.tr.render();
  assert.deepEqual(sitter.calls.toasts.map((x) => x.text), [], 'the sitter has its own toast (feedback.js)');
});

test('F4-C1: the arrival line and the NOW card in Bulgarian', async () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  p2Sat(s, bench);
  storage();
  try {
    await I18N.setLang('bg');
    const t = tracker(s, { now: at(14, 15) });
    assert.equal(t.box.querySelector('.goal[data-slot="now"] .gt').textContent, 'Седни на някоя пейка до полунощ');
    t.clock.now += 5000;
    t.tr.render();
    assert.match(t.calls.toasts[0]?.text ?? '', new RegExp(`^${s.players.p2.name} седна на пейка днес`));
    assert.match(t.calls.toasts[0].text, /до полунощ/);
  } finally { await I18N.setLang('en'); }
});

// ---- F4-02 ----------------------------------------------------------------------------------------------------------

test('F4-02: a farmer already on the bench is not told to sit; the other is told who waits and on which bench', () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 500_000;
  const first = put(s, 'sunset_bench');
  const second = put(s, 'sunset_bench');
  const now = at(14, 19, 30);
  const both = { online: ['p1', 'p2'] };
  assert.equal(goals(s, 'p1', now, both).now.kind, 'golden', 'the fixture: Golden Hour is ready');
  // p1 sits on the second bench
  actOk(s, 'sit', { id: second }, { pid: 'p1', now, ext: { near: 5 } });
  const sitting = GOALS.goals(s, 'p1', now + 5000, { ...both, all: true }).all;
  assert.deepEqual(sitting.filter((c) => c.kind === 'golden' && /sit on the bench together/.test(enText(c.msg))).map((c) => enText(c.msg)), []);
  const wait = goals(s, 'p1', now + 5000, both).now;
  assert.equal(wait.kind, 'golden');
  assert.match(enText(wait.msg), /^On the bench/);
  assert.match(enText(wait.msg), new RegExp(s.players.p2.name));
  assert.equal(wait.target.sit, undefined, 'no walk: already there');
  assert.ok(wait.target.ping, 'its action pings the partner');
  assert.deepEqual(wait.target.tile, { x: s.farm.objects[second].x, z: s.farm.objects[second].z });
  // the partner: "<name> is on the bench · sit with them", to the bench p1 is on (not the farm's first bench)
  const join = goals(s, 'p2', now + 5000, both).now;
  assert.equal(join.kind, 'golden');
  assert.match(enText(join.msg), new RegExp(`^${s.players.p1.name} is on the bench`));
  assert.equal(join.target.sit, second);
  // both on that bench: nothing more to say (Golden Hour starts in a moment)
  actOk(s, 'sit', { id: second }, { pid: 'p2', now: now + 6000, ext: { near: 5 } });
  for (const pid of ['p1', 'p2']) assert.notEqual(goals(s, pid, now + 7000, both).now.kind, 'golden', pid);
  valid(s);
});

test('F4-02: the seated card in the tracker pings the partner at the bench; the words in Bulgarian', async () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 500_000;
  const bench = put(s, 'sunset_bench');
  const now = at(14, 19, 30);
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now, ext: { near: 5 } });
  storage();
  const t = tracker(s, { now: now + 5000, online: ['p2'] });
  const card = t.box.querySelector('.goal[data-slot="now"]');
  assert.match(card.querySelector('.gt').textContent, /On the bench/);
  card.click();
  assert.equal(t.calls.pinged.length, 1, 'one ping');
  assert.deepEqual(t.calls.sat, [], 'no walk');
  try {
    await I18N.setLang('bg');
    const b = tracker(s, { now: now + 5000, online: ['p2'] });
    assert.equal(b.box.querySelector('.goal[data-slot="now"] .gt').textContent, 'Седиш на пейката');
    const j = tracker(s, { pid: 'p2', now: now + 5000, online: ['p1'] });
    assert.equal(j.box.querySelector('.goal[data-slot="now"] .gt').textContent, `${s.players.p1.name} е на пейката`);
  } finally { await I18N.setLang('en'); }
});

// ---- F4-03 ----------------------------------------------------------------------------------------------------------

test('F4-03: a rename writes the old name and its namer on the feed row; it is no thanks for the old namer', () => {
  const s = farmAt(7);
  const coop = put(s, 'coop');
  const hen = put(s, 'chicken', { home: coop });
  actOk(s, 'nameAnimal', { id: hen, name: 'Tajna' }, { pid: 'p2' });
  const [, firstRow] = feedRows(s, 1)[0];
  assert.equal(firstRow.k, 'name');
  assert.equal(firstRow.was, undefined, 'a first naming has no old name');
  actOk(s, 'nameAnimal', { id: hen, name: 'Buttercup' }, { pid: 'p1', now: T0 + MIN });
  const [i, row] = feedRows(s, 1)[0];
  assert.deepEqual({ k: row.k, what: row.what, text: row.text, was: row.was, wasBy: row.wasBy, by: row.by },
    { k: 'name', what: 'animal', text: 'Buttercup', was: 'Tajna', wasBy: 'p2', by: 'p1' });
  // the one whose animal was renamed is not asked to thank for it (the rules refuse it too)
  assert.notEqual(act(s, 'thank', { i }, { pid: 'p2', now: T0 + 2 * MIN }).ok, true, 'no thanks for a rename of my animal');
  // a farmer renaming an animal they named themselves: the partner may thank as for any line
  actOk(s, 'nameAnimal', { id: hen, name: 'Daisy' }, { pid: 'p1', now: T0 + 3 * MIN });
  const [j, own] = feedRows(s, 1)[0];
  assert.deepEqual([own.was, own.wasBy], ['Buttercup', 'p1']);
  actOk(s, 'thank', { i: j }, { pid: 'p2', now: T0 + 4 * MIN });
  // one pure predicate for the rules and the feed's ♥ Thanks button (life-feel's thankable)
  assert.equal(typeof FEED.renamedMine, 'function', 'shared/rules/feed.js renamedMine(row, pid)');
  assert.deepEqual([FEED.renamedMine(row, 'p2'), FEED.renamedMine(row, 'p1'), FEED.renamedMine(own, 'p2'), FEED.renamedMine(firstRow, 'p1')],
    [true, false, false, false]);
  valid(s);
});

// ---- F4-04 ----------------------------------------------------------------------------------------------------------

test('F4-04: the phone chip says how many more goals in words, never a bare "+N" that reads like a reward', async () => {
  const s = farmAt(14);
  storage();
  const res = { now: { slot: 'now', kind: 'calm', text: 'All done for now' },
    soon: { slot: 'soon', kind: 'level', text: 'Reach level 15', have: 1, need: 10 },
    big: { slot: 'big', kind: 'ribbon', id: 'builder', text: 'Builder' } };
  const n = () => document.querySelector('.tracker-chip .tc-n');
  const t = tracker(s, { res });
  void t;
  const count = n().textContent;
  assert.doesNotMatch(count, /^\+\d+$/, `the chip's count reads "${count}"`);
  assert.match(count, /^\d+ more$/);
  try {
    await I18N.setLang('bg');
    tracker(s, { res });
    assert.match(n().textContent, /^още \d+$/);
  } finally { await I18N.setLang('en'); }
});

// ---- F4-05 ----------------------------------------------------------------------------------------------------------

test('F4-05: a farm of one is not offered "sit on a bench, each of you" (no SOON card, no letter, no "!")', () => {
  const solo = atQuest('h1', { players: ['p2'] });
  put(solo, 'sunset_bench');
  const now = at(14, 15);
  const cards = goals(solo, 'p2', now, { all: true }).all.filter((c) => c.id === 'h1');
  assert.deepEqual(cards.map((c) => `${c.slot}:${c.kind}`), [], 'no h1 card on a farm of one');
  assert.deepEqual(T.storyCards(solo, now, 'p2').filter((c) => c.id === 'h1').map((c) => c.sub), [], 'no h1 letter');
  storage();
  globalThis.localStorage.setItem('hh.story.p2', '{}');
  const t = tracker(solo, { pid: 'p2', now });
  assert.equal(t.box.querySelectorAll('.goal[data-goal="h1"]').length, 0, 'nothing on the tracker');
  // a second farmer joins: the letter is back
  const two = atQuest('h1');
  put(two, 'sunset_bench');
  assert.ok(goals(two, 'p2', now, { all: true }).all.some((c) => c.id === 'h1'));
  assert.ok(T.storyCards(two, now, 'p2').some((c) => c.id === 'h1'));
  // the duet (h2: "together or slow-cooked alone") is a farm of one's to do
  assert.equal(GOALS.needsPartner({ verb: 'together', ref: 'duet' }), false);
  for (const ref of ['bench', 'dock', 'giant', 'help_flag']) assert.equal(GOALS.needsPartner({ verb: 'together', ref }), true, ref);
});

// ---- F4-06 ----------------------------------------------------------------------------------------------------------

test('F4-06: the drip card that introduces the Ribbon Track names it as every other English screen does', () => {
  const card = CONTENT.features.get('seasonal_track').card;
  assert.equal(card.title, `The ${EN_LEAGUE['league.track.panelTitle']}`);
  assert.match(card.text, /Ribbon Track/);
  assert.match(card.text, /Farm book/, 'and where it lives');
  assert.doesNotMatch(`${card.title} ${card.text}`, /season's track/i);
});
