// Release 1.0, D3 "Plant for later + bigger brushes" (features#F3; critique#35; plan-astra 2): the farm's clock
// (`readyClock`, `localHour`: pure, DST-safe), a "Plant for later" NOW card whenever plots are empty or ripe and a crop
// of 6 h or more is unlocked (L9 and up), worded "Before bed" from 19:00 farm time, naming crop, plots, ready time and
// cost, whose target plants (or first harvests) in one stroke; a SOON card for a brush that costs at most 5 % of the
// coins. RED on fdafb9c: no clock functions, no later card, no brush card ("Plant 51 empty plots" with Wheat at 21:00).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropOf, xpForLevel, CONTENT } from '../shared/content/index.js';
import { readyClock, localHour } from '../shared/rules/calendar.js';
import { goals, laterCrop } from '../shared/rules/goals.js';
import { enText } from '../shared/rules/goal-text.js';
import { MAX_BATCH } from '../shared/rules/economy.js';
import { farmAt, actOk, T0, MIN, HOUR } from './helpers/rules-goals.js';

const TZ = 'Europe/Sofia';
/** A Sofia wall-clock time in October 2026 (EEST, UTC+3, until 04:00 on 25 Oct; EET, UTC+2, after). */
const at = (day, h, m = 0) => {
  const guess = Date.UTC(2026, 9, day, h - 3, m);
  return localHour(guess, TZ) === h ? guess : Date.UTC(2026, 9, day, h - 2, m);
};

/** A farm at `level` whose plots are all empty (nothing ripe, nothing growing), no debris, no other chores. */
function emptyField(level, coins = 1_000_000) {
  const s = farmAt(level);
  s.farm.wallet.coins = coins;
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = null;
    if (CONTENT.debris.has(o.def)) delete s.farm.objects[id];
  }
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.quests.active = {};
  return s;
}
const plots = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot');
const later = (s, now) => goals(s, 'p1', now, { all: true }).all.find((c) => c.kind === 'later') ?? null;

test('readyClock / localHour: the farm\'s clock, across the 25 Oct 2026 DST change', () => {
  assert.equal(localHour(at(24, 21), TZ), 21);
  assert.deepEqual(readyClock(at(24, 21), 12 * HOUR, TZ), { at: at(24, 21) + 12 * HOUR, t: '08:00', days: 1 },
    '21:00 + 12 h over the night the clocks go back is 08:00, not 09:00');
  assert.deepEqual(readyClock(at(14, 21, 10), 30 * MIN, TZ).t, '21:40');
  assert.equal(readyClock(at(14, 14), 6 * HOUR, TZ).days, 0);
  assert.equal(readyClock(at(14, 21), 12 * HOUR, TZ).days, 1);
  assert.equal(readyClock(at(14, 21), 48 * HOUR, TZ).days, 2);
});

test('Plant for later: nothing below the first 6-hour crop (L9); at L9 the card replaces "Plant N plots"', () => {
  assert.equal(later(emptyField(8), at(14, 21)), null);
  assert.equal(goals(emptyField(8), 'p1', at(14, 21)).now.kind, 'plant');
  const g = goals(emptyField(9), 'p1', at(14, 14)).now;
  assert.equal(g.kind, 'later');
});

test('Before bed after 19:00 Europe/Sofia and not before, the night of the DST change too; pumpkin at 21:00', () => {
  for (const day of [14, 24, 25]) {
    const s = emptyField(21);
    const n = plots(s).length;
    const evening = later(s, at(day, 21));
    assert.equal(evening.ref, 'pumpkin', `${day} Oct 21:00: pumpkin (12 h, 10.8 h in its season) lands closest to 08:00`);
    assert.match(evening.text, new RegExp(`^Before bed: plant ${n} plots with Pumpkins$`));
    // QA r1 F-02: the clock of the crop as it will be planted (in season: -10 %), never the base 12 h
    assert.ok(evening.readyAt < at(day, 21) + 12 * HOUR, `${day} Oct: the season's cut is in the clock`);
    assert.equal(enText(evening.sub), `Ready tomorrow at ${readyClock(at(day, 21), evening.readyAt - at(day, 21), TZ).t} · ${(n * cropOf('pumpkin').seed).toLocaleString('en-US')} coins`);
    assert.doesNotMatch(later(s, at(day, 18, 59)).text, /Before bed/, `${day} Oct 18:59`);
    assert.match(later(s, at(day, 19)).text, /^Before bed/, `${day} Oct 19:00`);
  }
});

test('by day the card plants the longest crop of at most 12 h (the next session), saying the clock and the cost', () => {
  const s = emptyField(21);
  const c14 = later(s, at(14, 14));
  assert.equal(c14.ref, 'pumpkin');
  assert.match(c14.text, /^Plant \d+ plots with Pumpkins$/);
  // QA r1 F-02: 14:00 + 12 h in season (-10 %) is 00:48, not the base 02:00
  assert.match(enText(c14.sub), /^Ready tomorrow at 00:48 · [\d,]+ coins$/);
  // at 07:00 the longest crop under 12 h, never the 24-hour cabbage that skips the evening session
  assert.equal(laterCrop(s, 'p1', at(15, 7)).id, 'pumpkin');
  assert.notEqual(laterCrop(s, 'p1', at(15, 7)).id, 'cabbage');
  // a poor farm (QA r1 F-01): no long crop fills the field within half the coins, so no later card at all (never "plant
  // 1 plot with Potatoes"): the plain "Plant N plots" card
  s.farm.wallet.coins = 400;
  assert.equal(laterCrop(s, 'p1', at(14, 21)), null);
  assert.equal(goals(s, 'p1', at(14, 21)).now.kind, 'plant');
});

test('its action plants every empty plot in ONE stroke (up to MAX_BATCH), predicted like a drag', () => {
  const s = emptyField(21);
  const c = later(s, at(14, 21));
  assert.equal(c.target.act, 'plant');
  assert.equal(c.target.args.crop, 'pumpkin');
  assert.equal(c.target.args.ids.length, Math.min(plots(s).length, MAX_BATCH));
  const coins = s.farm.wallet.coins;
  actOk(s, 'plant', c.target.args, { pid: 'p1', now: at(14, 21) });
  assert.equal(plots(s).filter((id) => s.farm.objects[id].crop?.def === 'pumpkin').length, c.target.args.ids.length);
  assert.equal(coins - s.farm.wallet.coins, c.cost, 'the card said what it would cost');
});

test('with ripe plots waiting the collect card is NOW; Plant for later plants only the empty plots (no "Harvest N first")', () => {
  // QA r1 F-03: the old "Harvest N first" variant (score 8) never reached NOW under collect (10); dropped
  const s = emptyField(21);
  const ids = plots(s);
  for (const id of ids.slice(0, 5)) s.farm.objects[id].crop = { def: 'carrot', plantedAt: T0, readyAt: T0 + MIN, by: 'p1', cycle: 0 };
  const now = Math.max(T0 + HOUR, at(14, 21));
  assert.equal(goals(s, 'p1', now).now.kind, 'collect');
  const c = later(s, now);
  assert.equal(c.target.act, 'plant');
  assert.deepEqual(c.target.args.ids, ids.slice(5).sort());
  assert.doesNotMatch(c.text, /first/i);
});

test('the brush card: a sickle that costs at most 5 % of the coins, unbought, unlocked; Show me opens Market › Tools on it', () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 6000 * 20;                         // exactly 5 %
  const b = goals(s, 'p1', T0, { all: true }).all.find((c) => c.kind === 'brush');
  assert.ok(b, 'a brush card');
  assert.equal(b.slot, 'soon');
  assert.match(b.text, /: \d+ plots a touch, [\d,]+$/);
  assert.deepEqual(b.target, { panel: 'market', args: { tab: 'tools', focus: b.id } });
  s.farm.wallet.coins = 1000;
  assert.ok(!goals(s, 'p1', T0, { all: true }).all.some((c) => c.kind === 'brush'), 'too dear for this purse');
  s.farm.wallet.coins = 10_000_000;
  s.farm.tools = Object.fromEntries([...CONTENT.tools.values()].filter((t) => t.upgrades).map((t) => [t.id, { at: T0, by: 'p1' }]));
  assert.ok(!goals(s, 'p1', T0, { all: true }).all.some((c) => c.kind === 'brush'), 'all bought');
  void xpForLevel;
});
