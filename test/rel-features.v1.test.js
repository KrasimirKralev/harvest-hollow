// Release 1.0, verify-1 fixes (features lane; docs/qa/release/verify-1/fix-features.md): V1-F1 the Golden Hour NOW
// card shows the bench before the farmer walks there and sits (M6 "tapping it pans there"); V1-F2 Grandma's Feed step
// names no partner on a farm of one (the F3-10 pattern of the flour step).
// RED on f1c7289 (the tested head): the RED lines are in docs/qa/release/verify-1/fix-features.md, item by item.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';
import { CONTENT, TUTORIAL, live } from '../shared/content/index.js';
import { goals } from '../shared/rules/goals.js';
import { enText } from '../shared/rules/goal-text.js';
import { stepWords } from '../shared/rules/actions/tutorial.js';
import { localHour } from '../shared/rules/calendar.js';
import { resetGrid } from '../shared/rules/grid.js';
import { allAreas } from '../public/js/i18n/catalogs.js';
import { farmAt, put, actOk, T0 } from './helpers/rules-goals.js';

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
let stepText = null;   // public/js/ui/tutorial.js: Grandma's own card
before(async () => {
  T = await import('../public/js/ui/tracker.js');
  I18N = await import('../public/js/i18n/index.js');
  ({ stepText } = await import('../public/js/ui/tutorial.js'));
});

const TZ = 'Europe/Sofia';
/** A Sofia wall-clock time in October 2026 (EEST, UTC+3, until 04:00 on 25 Oct). */
const at = (day, h, m = 0) => {
  const guess = Date.UTC(2026, 9, day, h - 3, m);
  return localHour(guess, TZ) === h ? guess : Date.UTC(2026, 9, day, h - 2, m);
};

/** A plain localStorage for the page (the tracker's kv). */
function storage() {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k), clear: () => m.clear() };
  return m;
}

/**
 * A tracker over a fake DOM (rel-features.r4's tracker()), with the camera and the controller writing into ONE list,
 * so the test reads what happened first: the camera moving to the bench, or the farmer walking off to it.
 */
function tracker(state, { pid = 'p1', now = at(14, 15), online = [] } = {}) {
  document.body.replaceChildren();
  const box = document.createElement('div');
  box.id = 'tracker';
  document.body.append(box);
  const order = [];
  const S = {
    store: { state, pid, now: () => now, subscribe() {} },
    view: { focus: (x, z) => { order.push(['focus', x, z]); } },
    hud: { isOnline: (p) => online.includes(p) },
    ui: { panels: { has: () => true, top: () => null, open: () => true }, toast() {}, confirm: () => Promise.resolve(true) },
    controller: { do: () => ({ ok: true }), tool: { id: 'hand' }, TOOLS: [{ id: 'hand' }], setTool() {},
      sitOn: (id) => { order.push(['sit', id]); return true; }, ping: (x, z) => { order.push(['ping', x, z]); return true; } },
    tutorial: { flash() {} },
  };
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window ??= globalThis;
  globalThis.window.addEventListener ??= () => {};
  globalThis.dispatchEvent = () => true;
  let tr;
  try { tr = T.createTracker(S); } finally { globalThis.setInterval = realInterval; }
  tr.render();
  return { tr, box, order };
}

const H = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
/** A farm at quest `qid` with the chain done up to it and `qid` the active card (rel-features.r4's atQuest). */
function atQuest(qid) {
  const q = CONTENT.quests.get(qid);
  const s = farmAt(Math.max(q.level, 1));
  s.farm.wallet.coins = 50_000_000;
  s.farm.expansions = live('expansions').map((e) => e.id);
  resetGrid(s);
  for (const id of H.slice(0, H.indexOf(qid))) s.farm.quests.done[id] = T0;
  for (const id of Object.keys(s.farm.quests.active)) delete s.farm.quests.active[id];
  s.farm.quests.active[qid] = { at: T0, n: {} };
  return s;
}

/** Click the NOW card; the camera must reach the bench's tile before the walk to it starts, once each. */
function clickShowsBenchFirst(t, state, bench, label) {
  const card = t.box.querySelector('.goal[data-slot="now"]');
  assert.ok(card, `${label}: a NOW card`);
  card.click();
  const o = state.farm.objects[bench];
  assert.deepEqual(t.order, [['focus', o.x, o.z], ['sit', bench]], `${label}: the camera shows the bench, then the farmer walks and sits`);
}

// ---- V1-F1 ----------------------------------------------------------------------------------------------------------

test('V1-F1: "Golden Hour is ready · sit on the bench together": a tap shows the bench, then walks there and sits', () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 500_000;
  const bench = put(s, 'sunset_bench');
  const now = at(14, 19, 30);
  const g = goals(s, 'p1', now, { online: ['p1', 'p2'] }).now;
  assert.equal(g.kind, 'golden', 'the fixture: Golden Hour is ready');
  assert.equal(g.msg.key, 'feat.r.golden');
  storage();
  const t = tracker(s, { now, online: ['p2'] });
  clickShowsBenchFirst(t, s, bench, 'feat.r.golden');
});

test('V1-F1: "<partner> is on the bench · sit with them": a tap shows that bench, then walks there and sits', () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 500_000;
  put(s, 'sunset_bench');
  const second = put(s, 'sunset_bench');
  const now = at(14, 19, 30);
  actOk(s, 'sit', { id: second }, { pid: 'p1', now, ext: { near: 5 } });
  const g = goals(s, 'p2', now + 5000, { online: ['p1', 'p2'] }).now;
  assert.equal(g.msg.key, 'feat.r.golden.join', 'the fixture: the partner waits on the second bench');
  storage();
  const t = tracker(s, { pid: 'p2', now: now + 5000, online: ['p1'] });
  clickShowsBenchFirst(t, s, second, 'feat.r.golden.join');
});

test('V1-F1: the D2 half card ("Sit on any bench before midnight"): a tap shows the bench, then walks there and sits', () => {
  const s = atQuest('h7');
  const bench = put(s, 'sunset_bench');
  actOk(s, 'sit', { id: bench }, { pid: 'p2', now: at(14, 10), ext: { near: 5 } });
  actOk(s, 'stand', {}, { pid: 'p2', now: at(14, 10, 2) });
  const g = goals(s, 'p1', at(14, 15)).now;
  assert.equal(g.kind, 'half', 'the fixture: p1 still has to sit today');
  assert.equal(g.target.sit, bench);
  storage();
  const t = tracker(s, { now: at(14, 15) });
  clickShowsBenchFirst(t, s, bench, 'half');
});

test('V1-F1: the seated card still pings and focuses once (F4-02 unchanged)', () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 500_000;
  const bench = put(s, 'sunset_bench');
  const now = at(14, 19, 30);
  actOk(s, 'sit', { id: bench }, { pid: 'p1', now, ext: { near: 5 } });
  storage();
  const t = tracker(s, { now: now + 5000, online: ['p2'] });
  t.box.querySelector('.goal[data-slot="now"]').click();
  const o = s.farm.objects[bench];
  assert.deepEqual(t.order, [['focus', o.x, o.z], ['ping', o.x + 0.5, o.z + 0.5]]);
});

// ---- V1-F2 ----------------------------------------------------------------------------------------------------------

const feedStep = TUTORIAL.barnyard.find((x) => x.id === 'make_feed');

test('V1-F2: on a farm of one Grandma\'s Feed step names no partner (rules, EN)', () => {
  assert.ok(feedStep, 'the content: barnyard step make_feed');
  const solo = farmAt(2, { players: ['p1'] });
  const w = stepWords(solo, feedStep);
  assert.ok(w, 'stepWords(solo, make_feed) gives the farm-of-one words');
  assert.equal(w.key, 'feat.r.coach.feedSolo');
  const en = enText(w);
  assert.doesNotMatch(en, /partner/i, en);
  assert.match(en, /Chicken Feed/);
  assert.match(en, /3 Wheat/);
  // two farmers: the step keeps its own content line ("your partner's Wheat works too" is true there)
  assert.equal(stepWords(farmAt(2), feedStep), null);
});

test('V1-F2: Grandma\'s card and the tracker\'s mirror say it in EN and BG, the two-farmer line unchanged', async () => {
  const solo = farmAt(2, { players: ['p1'] });
  const two = farmAt(2);
  const bg = (await import('../public/js/i18n/bg/feat.js')).default;
  assert.ok(bg['feat.r.coach.feedSolo'], 'bg/feat.js has feat.r.coach.feedSolo');
  assert.doesNotMatch(bg['feat.r.coach.feedSolo'], /другия фермер|партньор/);
  assert.match(bg['feat.r.coach.feedSolo'], /фураж за кокошки/i);
  assert.match(bg['feat.r.coach.feedSolo'], /3 снопа пшеница/);
  // EN: the tracker's NOW mirror and Grandma's own card
  assert.doesNotMatch(T.coachText(feedStep, solo), /partner/i);
  assert.doesNotMatch(stepText(feedStep, solo), /partner/i);
  assert.match(T.coachText(feedStep, two), /partner/i, 'two farmers: the content line');
  // BG: the same two places
  const AREAS = await allAreas();
  const BG = Object.fromEntries((await Promise.all(AREAS.map(async ([, , load]) => Object.entries((await load()).default)))).flat());
  await I18N.__loadForTest('bg');
  I18N.__setForTest('bg', BG);
  try {
    assert.doesNotMatch(T.coachText(feedStep, solo), /другия фермер/);
    assert.doesNotMatch(stepText(feedStep, solo), /другия фермер/);
    assert.match(T.coachText(feedStep, solo), /фураж за кокошки/i);
    assert.match(T.coachText(feedStep, two), /другия фермер/, 'two farmers: the content line');
  } finally { I18N.__setForTest('en'); }
});
