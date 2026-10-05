// Wave-3 integration seams (lead): cross-lane fixes found while wiring M2 together. Each test was RED before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmAt, credit, valid, T0 } from './helpers/rules-goals.js';   // first: loads the rules in order
import { CONTENT, MASTERY, isLive, xpForLevel } from '../shared/content/index.js';

test('Gold mastery: a track already past its Gold count is paid its fourth star on reaching L30', () => {
  if (!isLive({ m: MASTERY.goldM })) return;
  const s = farmAt(MASTERY.goldFrom - 1);
  const wheat = CONTENT.crops.get('wheat');
  s.farm.mastery.wheat = wheat.mastery[3] + 5;                     // past Gold long ago
  s.farm.stars = { ...(s.farm.stars ?? {}), wheat: 3 };             // ★3 paid; Gold did not exist below L30
  const r = credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: xpForLevel(MASTERY.goldFrom) - s.farm.xp, coins: 0 }],
    { now: T0 });
  assert.equal(s.farm.stars.wheat, 4, 'the Gold star is paid with the level-up, not at the next wheat harvest');
  assert.ok(r.events.some((e) => e.e === 'mastery' && e.id === 'wheat' && e.star === 4));
  valid(s);
});

// ---- UI seams -----------------------------------------------------------------------------------------------------

const { capOf, buildingView } = await import('../public/js/ui/panels/model.js');
const { ownCap } = await import('../shared/rules/actions/decor.js');
const { goals } = await import('../shared/rules/goals.js');
const { m1bFeedText } = await import('../public/js/ui/feed.js');
const { cardsFromGoals } = await import('../public/js/ui/tracker.js');
const { put } = await import('./helpers/rules-goals.js');
const { defOf, FAIR } = await import('../shared/content/index.js');

test('the Market\'s plot cap counts the Hollow Meadow plots the rules allow (Stone Bridge restored)', () => {
  const s = farmAt(25);
  s.farm.restore.stone_bridge = { s: {}, b: {}, done: T0 };
  assert.equal(capOf(s, 'plot'), ownCap(s, defOf('plot')), 'the Market and the rules agree');
});

test('a Kitchen with Grandma\'s reward slot: "Slot n of max" counts the reward slot, bought ones exclude it', () => {
  const s = farmAt(34);
  const k = put(s, 'kitchen');
  const def = defOf('kitchen');
  s.farm.objects[k].slots = def.slots[1] + 1;
  s.farm.objects[k].xs = 1;
  const v = buildingView(s, k, T0);
  assert.equal(v.max, def.slots[1] + 1);
  assert.equal(v.bought, def.slots[1] - def.slots[0]);
});

test('M2 feed rows have words: the track\'s close, the duel, Grandma, a league move on the Fair line', () => {
  assert.match(m1bFeedText({ k: 'track', s: '2026-autumn', t: 12, c: 3400 }).text, /autumn Ribbon Track closed at tier 12: \+3,400 coins/);
  assert.match(m1bFeedText({ k: 'duel', what: 'start', kind: 'pies' }).text, /accepted a Friendly Duel/);
  assert.match(m1bFeedText({ k: 'duel', what: 'end', tie: 1 }).text, /dead heat/);
  assert.match(m1bFeedText({ k: 'grandma', what: 'left' }).text, /Grandma Hazel went home/);
  const fair = m1bFeedText({ k: 'fair', medal: FAIR.medals[0].id, c: 100, lg: 2, mv: 1 }).text;
  assert.ok(fair.endsWith(` · up to the ${FAIR.league?.names?.[1] ?? 'League 2'}`), fair);
});

test('the tracker keeps the rules\' Legacy level text past L40 and gives the M2 cards icons', () => {
  const s = farmAt(41);
  const cards = cardsFromGoals({ big: { kind: 'level', text: 'Legacy level 2: 10 Acorns', have: 10, need: 100 },
    now: { kind: 'track', text: 'Season Track tier 3: claim 2 Hearts' } }, s, 'p1', T0);
  const lvl = cards.find((c) => c.kind === 'level');
  assert.match(lvl.title, /^Legacy level 2/);
  assert.equal(cards.find((c) => c.kind === 'track').icon, 'ticket_stub');
});

test('Goal Tracker: a bred baby waiting in the pen and my hourly cast are cards (ui-home\'s panels)', () => {
  const s = farmAt(30);
  const a = put(s, 'cow');
  s.farm.breed = { cur: { sp: 'cow', a, b: a, at: T0 - 10, readyAt: T0 - 1, by: 'p1', cost: { item: 'baby_bottle', qty: 2 } },
    n: {}, pity: {} };
  s.farm.expansions = [...s.farm.expansions, 'willow_pond'];
  const all = goals(s, 'p1', T0, { all: true }).all;
  const breed = all.find((c) => c.kind === 'breed');
  assert.ok(breed && breed.target.panel === 'breeding', JSON.stringify(all.map((c) => c.kind)));
  const fish = all.find((c) => c.kind === 'fish');
  assert.ok(fish && /Willow Pond/.test(fish.text), 'the cast card names the pond');
});

test('the village strip draws a window of six lots, never all 24 names at once', async () => {
  const { stripWindow } = await import('../public/js/ui/panels/town.js');
  const ps = Array.from({ length: 24 }, (_, i) => ({ id: `p${i + 1}`, n: i + 1, status: i < 9 ? 'built' : i === 9 ? 'current' : 'later' }));
  const w = stripWindow(ps);
  assert.equal(w.list.length, 6);
  assert.deepEqual(w.list.map((p) => p.n), [8, 9, 10, 11, 12, 13], 'two built, the current one, then the next');
  assert.equal(w.after, 11);
  assert.equal(stripWindow(ps.slice(0, 4)).list.length, 4);
});

test('the village panel knows the Festival Pavilion: tiers after the 24th are built and the next one is coming', async () => {
  const { townView } = await import('../public/js/ui/panels/town.js');
  const s = farmAt(38);
  if (!s.farm.town) return;
  s.farm.town.n = 26;
  s.farm.town.cur = null;
  const v = townView(s, 'p1', T0);
  if (!v.open) return;
  assert.notEqual(v.waiting, 'done', 'the pavilion keeps the village going after project 24');
  assert.equal(v.pavilionTiers, 2);
  assert.ok(v.built.some((b) => /Festival Pavilion/.test(b.name)));
});

test('Goal Tracker: breeding on a full farm points at the home upgrade that makes room (wave-3 playtest dead end)', () => {
  const s = farmAt(30);
  const home = put(s, 'cow_barn');
  const cap = defOf('cow_barn').capacity;
  for (let i = 0; i < cap; i++) put(s, 'cow', { home, adultAt: T0 - 1 });
  const card = goals(s, 'p1', T0, { all: true }).all.find((c) => c.kind === 'breed');
  assert.ok(card, 'a card says why no pair fits');
  assert.match(card.text, /Make room for a baby Cow: upgrade the Cow Barn/);
  assert.deepEqual(card.target, { panel: 'animals', args: { id: home } });
});
