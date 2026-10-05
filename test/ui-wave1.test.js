// QA wave 1 (docs/qa/wave1/TRIAGE.md, the "ui" tasks): the DOM-free decisions behind the fixes. Each test names its
// task id; the visible parts are checked with screenshots (docs/qa/wave1/status-ui.md lists them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm, must, T0 } from './helpers.js';
import { farmAt, placeDef, allLand } from './helpers/rules.js';
import { dayIndex } from '../shared/rules/calendar.js';
import { CONTENT, SAFETY } from '../shared/content/index.js';
import { goals } from '../shared/rules/goals.js';
import { uiScaleMax, uiScaleAuto, uiScaleOf, sanitize, DEFAULTS, KEYS } from '../public/js/ui/settings.js';
import { hotkeyCode, freeSwatches, SWATCH_NAMES } from '../public/js/ui/index.js';
import { shortLabel, shortTime, seedRows } from '../public/js/ui/toolbar.js';
import { cardsFromGoals, storyCards, numbersOf, wishAskCard } from '../public/js/ui/tracker.js';
import { feedText } from '../public/js/ui/feed.js';
import { buffItems, buffAnnouncements, slotOf } from '../public/js/ui/hud.js';
import { recapDue, RECAP_MIN_MS } from '../public/js/ui/recap.js';
import { showMeTarget } from '../public/js/ui/levelup.js';
import { softCopy } from '../public/js/ui/dialogs.js';
import { headLines } from '../public/js/ui/panels/building.js';
import { buildingView, queuedAnywhere } from '../public/js/ui/panels/model.js';
import { prizeLine, animalTint } from '../public/js/ui/panels/animals.js';
import { chainArt, CHAIN_FOCUS } from '../public/js/ui/chains.js';

const noJunk = (t) => assert.ok(typeof t === 'string' && t && !/undefined|null|NaN|\[object/.test(t), `bad text: ${t}`);

test('UI-01 / UI-17: the Interface size fits the window; automatic unless chosen', () => {
  assert.equal(uiScaleMax(1366, 768), 100, 'the design floor allows 100 % only');
  assert.equal(uiScaleMax(1280, 800), 100, 'never below 100 %: every layout is checked at 100 %');
  assert.equal(uiScaleMax(1920, 1080), 140);
  assert.equal(uiScaleMax(1600, 900), 115);
  assert.equal(uiScaleAuto(1920, 1080), 135, 'automatic tops out at 135 %');
  assert.equal(uiScaleAuto(1366, 768), 100);
  const chosen = sanitize({ uiScale: 130, uiScaleSet: true });
  assert.equal(uiScaleOf(chosen, 1366, 768), 100, 'a 130 % choice is capped to what fits at 1366 x 768');
  assert.equal(uiScaleOf(chosen, 1920, 1080), 130);
  assert.equal(uiScaleOf(sanitize({ uiScale: 80, uiScaleSet: true }), 1366, 768), 80, 'smaller always fits');
  assert.equal(uiScaleOf(sanitize(null), 1920, 1080), 135, 'no choice: the size follows the window');
  assert.equal(DEFAULTS.uiScaleSet, false);
  assert.equal(Object.hasOwn(DEFAULTS, 'autoFeed'), false, 'UI-15: the dead "Feed when tending" switch is gone');
});

test('UI-01: Settings has a key (,) and the key list says so; the photo key says what it does', () => {
  assert.equal(hotkeyCode(','), 'Comma');
  assert.equal(hotkeyCode('m'), 'KeyM');
  assert.equal(hotkeyCode('4'), 'Digit4');
  assert.ok(KEYS.some(([k, what]) => k === ',' && what === 'Settings'));
  assert.ok(KEYS.some(([k, what]) => k === 'P' && what === 'Take a photo'), 'CL-06: "Take a photo", not "Photo mode"');
});

test('UI-23: every tool has its own one-word label (no two "Scoop"s, Water not "Can")', () => {
  const labels = ['hand', 'seed_bag', 'sickle', 'watering_can', 'feed_scoop', 'basket', 'compost_scoop', 'axe', 'hammer']
    .map((id) => shortLabel(CONTENT.tools.get(id)));
  assert.deepEqual(labels, ['Hand', 'Seeds', 'Sickle', 'Water', 'Feed', 'Basket', 'Compost', 'Axe', 'Hammer']);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(shortLabel(CONTENT.tools.get('big_watering_can')), 'Water', 'an owned brush keeps its tool\'s word');
});

test('UI-25: seed rows carry what a plot costs and what it gives; short times', () => {
  const rows = seedRows(makeFarm());
  const wheat = rows.find((r) => r.id === 'wheat');
  assert.ok(wheat.open && Number.isInteger(wheat.yield) && wheat.yield > 0 && wheat.seed > 0 && wheat.sell > 0);
  assert.equal(shortTime(60_000), '1m');
  assert.equal(shortTime(45 * 60_000), '45m');
  assert.equal(shortTime(2 * 3_600_000), '2h');
  assert.equal(shortTime(90 * 60_000), '1h 30m');
});

test('UI-06: every goal card with have / need says its numbers; the BIG ribbon card names what it counts', () => {
  assert.equal(numbersOf({ kind: 'ribbon', have: 11, need: 13 }, 'Buildings built'), '11 / 13');
  assert.equal(numbersOf({ kind: 'level', have: 6000, need: 6900 }, ''), '6,000 / 6,900 XP');
  assert.equal(numbersOf({ kind: 'quest', have: 2, need: 6 }, 'Plant Wheat 2/6'), '', 'a line with its numbers is left alone');
  assert.equal(numbersOf({ kind: 'collect', need: 3 }, ''), '', 'no have: nothing to say');
  const s = farmAt(12);
  const res = { now: null, soon: null, big: { slot: 'big', kind: 'ribbon', id: 'builder', text: 'Builder: Buildings built or slots added', have: 11, need: 13 } };
  if (CONTENT.ribbons.has('builder')) {
    const [c] = cardsFromGoals(res, s, 'p1', T0);
    assert.equal(c.title, CONTENT.ribbons.get('builder').name);
    assert.match(c.sub, /11 \/ 13$/);
  }
  for (const c of cardsFromGoals(goals(s, 'p1', T0), s, 'p1', T0)) { noJunk(c.title); if (c.sub) noJunk(c.sub); }
});

test('UI-13: goal targets land on real tabs; "Show me" on a recipe opens the building that makes it', () => {
  const s = farmAt(12);
  const almanac = cardsFromGoals({ now: { slot: 'now', kind: 'almanac', text: 'Harvest 10 Wheat', have: 1, need: 10 } }, s, 'p1', T0)[0];
  assert.deepEqual(almanac.target, { panel: 'journal', args: { tab: 'week' } });
  const bakery = placeDef(s, 'bakery', { now: T0 });
  const recipe = [...CONTENT.recipes.values()].find((r) => r.building === 'bakery');
  assert.deepEqual(showMeTarget({ family: 'recipes', id: recipe.id }, s), { panel: 'building', args: { id: bakery, focus: recipe.id } });
  const fresh = makeFarm();
  const t = showMeTarget({ family: 'recipes', id: recipe.id }, fresh);
  assert.deepEqual(t, { panel: 'market', args: { tab: 'buildings', focus: 'bakery' } }, 'no Bakery yet: the Market shows it');
});

test('UI-18 / RC-10: a waiting story card says what it waits for, with the blocker\'s icon', () => {
  const s = farmAt(7);
  s.farm.quests.active = { ...s.farm.quests.active, c1: { at: T0, n: {} } };
  const c1 = storyCards(s, T0).find((c) => c.id === 'c1');
  assert.ok(c1, 'c1 is on the tracker');
  assert.equal(c1.sub, 'Build the Dairy first');
  assert.equal(c1.icon, 'dairy');
  assert.equal(c1.waiting, true);
  assert.equal(c1.chain, 'C', 'the card knows its chain painting (UI-41)');
});

test('UI-41: chain paintings keep their focus point', () => {
  for (const c of Object.keys(CHAIN_FOCUS)) assert.match(chainArt(c, 600), new RegExp(`quests/${c}_600\\.webp`));
  assert.equal(chainArt('z'), null);
});

test('UI-11: feed lines name wishes, slots and Hurry; "You keep", plurals', () => {
  const s = makeFarm();
  const me = 'p1';
  const t = (row) => { const x = feedText({ at: T0, by: 'p2', ...row }, s, me); noJunk(x.text); return x; };
  assert.match(t({ k: 'wish', what: 'deposit', def: 'bakery', c: 300 }).text, /^put 300 coins toward the Bakery$/);
  assert.match(t({ k: 'wish', what: 'bought', def: 'bakery' }).text, /The Bakery bought itself/);
  assert.equal(t({ k: 'wish', what: 'bought', def: 'bakery' }).actor, null);
  assert.match(t({ k: 'wish' }).text, /made a wish/, 'an old row without a def never says "undefined"');
  assert.match(t({ k: 'buy', what: 'slot', def: 'bakery', c: 1200 }).text, /^added a Bakery slot for 1,200 coins$/);
  assert.match(t({ k: 'buy', what: 'hurry', acorns: 2 }).text, /hurried a batch for 2 Acorns/);
  assert.match(t({ k: 'buy', def: 'apple_tree', c: 100 }).text, /^bought an Apple Tree/);
  const mine = feedText({ at: T0, by: me, k: 'keep', item: 'egg', q: 6 }, s, me);
  assert.equal(`${mine.actor} ${mine.text}`, 'You keep 6 Eggs for later');
  const theirs = feedText({ at: T0, by: 'p2', k: 'keep', item: 'egg', q: 6 }, s, me);
  assert.match(theirs.text, /^keeps 6 Eggs/);
});

test('UI-26: the buffs speak once when they start and once when they end, never per tick', () => {
  const s = makeFarm();
  s.farm.coop = { ...(s.farm.coop || {}), golden: { until: T0 + 600_000 } };
  const items = buffItems(s, 'p1', T0);
  assert.equal(items.length, 1);
  assert.deepEqual(buffAnnouncements(null, items), [], 'a page load is not news');
  assert.equal(buffAnnouncements([], items).length, 1, 'starting: one line');
  assert.deepEqual(buffAnnouncements(['golden'], buffItems(s, 'p1', T0 + 1000)), [], 'a tick: silence');
  assert.deepEqual(buffAnnouncements(['golden'], []), ['Golden Hour is over.']);
});

test('UI-12: the welcome-back card shows for every new absence, not once per page', () => {
  assert.equal(recapDue(T0, T0 + RECAP_MIN_MS, null), true);
  assert.equal(recapDue(T0, T0 + RECAP_MIN_MS, T0), false, 'the same absence is not told twice');
  assert.equal(recapDue(T0 + 1, T0 + 1 + RECAP_MIN_MS, T0), true, 'a laptop sleep later: a new absence');
  assert.equal(recapDue(T0, T0 + RECAP_MIN_MS - 1, null), false);
});

test('UI-05: a colour the partner wears is taken; shapes tell the two farmers apart', () => {
  const slots = [{ pid: 'p1', claimed: true, name: 'Rowan', color: '#2BB3A3' }, { pid: 'p2', claimed: false }];
  const free = freeSwatches(slots, 'p2');
  assert.equal(free.find((w) => w.color === '#2BB3A3').takenBy, 'Rowan');
  assert.equal(free.filter((w) => w.takenBy).length, 1);
  assert.equal(free.find((w) => w.color === '#FF7A6B').name, 'Coral');
  assert.ok(Object.values(SWATCH_NAMES).every((n) => /^[A-Z][a-z]+$/.test(n)), 'swatches have names, not hex codes');
  assert.equal(slotOf('p2'), 'p2');
  assert.equal(slotOf('sys'), 'p1');
});

test('UI-24: a building headline says what is ready; never "all done in 0s" next to a Ready! slot', () => {
  const s = farmAt(12, { coins: 10_000_000 });
  allLand(s);
  const id = placeDef(s, 'bakery', { now: T0 });
  for (const it of ['wheat', 'flour', 'egg', 'milk', 'sugar', 'butter']) s.farm.inventory[it] = 50;
  const recipe = [...CONTENT.recipes.values()].find((r) => r.building === 'bakery' && r.unlock <= 12 && !r.duet && r.inputs
    && Object.keys(r.inputs).every((i) => s.farm.inventory[i] >= r.inputs[i]));
  must(s, 'craft', { id, recipe: recipe.id }, { now: T0 });
  assert.equal(queuedAnywhere(s, recipe.id), true, 'UI-03: queued once, "Try it" is over');
  const v = buildingView(s, id, T0 + recipe.ms + 1000);
  assert.equal(v.recipes.find((r) => r.id === recipe.id).tryIt, false);
  const hl = headLines(v, T0 + recipe.ms + 1000);
  assert.equal(hl.ready.length, 1);
  assert.equal(hl.ready[0].name, recipe.name);
  assert.equal(hl.ready[0].n, v.queue[0].out);
  assert.ok(!/0s/.test(`${hl.status ?? ''} ${hl.sub ?? ''}`), JSON.stringify(hl));
  const idle = headLines(buildingView(s, placeDef(s, 'kitchen', { now: T0 }), T0), T0);
  assert.equal(idle.status, 'Idle: pick something to make.');
});

test('UI-37: one blue-ribbon line per home; each hen keeps its own tint', () => {
  const v = { species: [{ name: 'Chicken' }], animals: [
    { id: 'a.1', prizedAt: 60, prized: false, cycle: 12 }, { id: 'a.2', prizedAt: 60, prized: true, cycle: 61 }, { id: 'a.3', prizedAt: 60, prized: false, cycle: 30 }] };
  const p = prizeLine(v);
  assert.equal(p.won, 1);
  assert.equal(p.next.id, 'a.3', 'the closest hen leads the line');
  assert.match(p.text, /1 with a blue ribbon · next one at 30\/60 collections/);
  assert.equal(animalTint('a.7.3', 'chicken'), animalTint('a.7.3', 'chicken'), 'stable');
  assert.ok(['#9A5B34', '#D2A86A', '#EBDDBB'].includes(animalTint('a.7.3', 'chicken')));
  assert.equal(animalTint('a.7.3', 'cow'), null);
});

test('CL-02 copy: several small Acorn buys add up to a heads-up, and the card says so', () => {
  const s = makeFarm();
  const B = SAFETY.bigSpend;
  s.players.p1.acornDay = { day: dayIndex(T0, s.meta.tz), n: B.acornsPerPlayerDay - 3 };
  const c = softCopy('BIG_SPEND', { state: s, pid: 'p1', args: {}, cost: { coins: 0, acorns: 5 }, now: T0 });
  noJunk(c.body);
  assert.equal(c.body, `That makes ${B.acornsPerPlayerDay + 2} Acorns you spent today (${s.players.p2.name} gets a heads-up from ${B.acornsPerPlayerDay}).`);
});

test('UI-10: the partner\'s request for my wish coins becomes my NOW card, with the time left', () => {
  const s = makeFarm();
  s.farm.wishlist = { 'w.1': { def: 'bakery', coins: 300, by: 'p1', at: T0, release: { by: 'p2', at: T0 } } };
  const c = wishAskCard(s, 'p1', T0 + 60_000);
  assert.ok(c && c.slot === 'now' && c.target.panel === 'wishlist');
  noJunk(c.title);
  assert.match(c.sub, /left$/);
  assert.equal(wishAskCard(s, 'p2', T0), null, 'the one who asked waits; nothing to answer');
});
