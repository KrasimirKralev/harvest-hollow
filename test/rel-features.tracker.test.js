// Release 1.0, the Goal Tracker's musts (features lane): M7 (SOON never repeats BIG), M6 (the collect card names its
// biggest group with its verb and the Hand, and says where), M29 (one NOW priority: coach > Golden Hour > collect >
// Plant for later > All done for now), M17a (the Almanac's English counts its nouns), M28 (the workshop tip says
// something the panel does not), the calm card, and the coach mirror (M1b, pure half; the DOM check rides on
// ui-shell's scripted first five minutes in tools/e2e-rel-features.mjs).
// RED on fdafb9c: SOON fell back to BIG's level card; "Collect 96 ready things" had no target; there was no golden,
// later or calm card; "Harvest 20 Carrot", "Fill 3 order"; the tip repeated "Ingredients are used when…".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, TUTORIAL, xpForLevel, cropOf } from '../shared/content/index.js';
import { goals, NOW_SCORE } from '../shared/rules/goals.js';
import { enText, GOALS_RULES_EN, almanacMsg } from '../shared/rules/goal-text.js';
import { farmAt, put, give, mulberry32, T0, MIN, HOUR } from './helpers/rules-goals.js';
import { coachCard, withNowPriority } from '../public/js/ui/tracker.js';
import { coachStep } from '../public/js/ui/tutorial.js';

/** A farm-local instant in Europe/Sofia (the test farms' zone): a date and an hour in October 2026 (UTC+3 until 25 Oct). */
const sofia = (day, h, m = 0) => Date.UTC(2026, 9, day, h - (day >= 25 && !(day === 25 && h < 4) ? 2 : 3), m);

/** Every plot growing until `until` (nothing ripe, nothing idle), no debris, no Almanac, no quests: a quiet farm. */
function quiet(s, until) {
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = { def: 'wheat', plantedAt: T0, readyAt: until, by: 'p1', cycle: 0 };
    if (CONTENT.debris.has(o.def)) delete s.farm.objects[id];
  }
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.quests.active = {};
  return s;
}

test('M7: over 200 generated states SOON and BIG never show the same card (the level card is never both)', () => {
  const rnd = mulberry32(7);
  let levelBig = 0;
  for (let i = 0; i < 200; i++) {
    const L = 1 + Math.floor(rnd() * 30);
    const s = farmAt(L, { seed: i + 1 });
    s.farm.wallet.coins = Math.floor(rnd() * 200_000);
    if (rnd() < 0.5) s.farm.quests.active = {};
    if (rnd() < 0.5) for (const p of Object.values(s.players)) p.almanac.tasks = {};
    s.farm.xp = xpForLevel(L) + Math.floor(rnd() * (xpForLevel(L + 1) - xpForLevel(L)));
    const g = goals(s, 'p1', T0 + Math.floor(rnd() * 10 * HOUR));
    if (g.big && g.big.kind === 'level') levelBig++;
    if (!g.soon || !g.big) continue;
    assert.ok(!(g.soon.kind === g.big.kind && g.soon.text === g.big.text), `#${i} L${L}: SOON = BIG "${g.big.text}"`);
    assert.ok(!(g.soon.kind === 'level' && g.big.kind === 'level'), `#${i} L${L}: two level cards`);
  }
  assert.ok(levelBig > 20, `the level card was BIG in ${levelBig} states (the case M7 is about)`);
});

test('M7: a fresh farm with nothing for SOON leaves SOON empty instead of copying the level card', () => {
  const s = quiet(farmAt(1), T0 + 30 * MIN);
  const g = goals(s, 'p1', T0);
  assert.equal(g.big.kind, 'level');
  assert.ok(g.soon === null || g.soon.kind !== 'level', JSON.stringify(g.soon));
});

test('M6: the collect card names the biggest group with its verb and the Hand, and targets one of its tiles', () => {
  const s = farmAt(21);
  const ripe = [];
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') { o.crop = { def: 'carrot', plantedAt: T0 - HOUR, readyAt: T0 - MIN, by: 'p1', cycle: 0 }; ripe.push(id); }
  }
  // a coop full of hens with eggs: the barnyard is the bigger group
  const home = put(s, 'coop');
  const hens = [];
  for (let i = 0; i < ripe.length + 4; i++) {
    hens.push(put(s, 'chicken', { home, adultAt: T0 - HOUR, fedAt: T0 - HOUR, readyAt: T0 - MIN, cycle: 1, cut: 0 }));
  }
  s.farm.objects[home].up = undefined;
  const g = goals(s, 'p1', T0).now;
  assert.equal(g.kind, 'collect');
  assert.equal(g.ref, 'barnyard');
  assert.equal(g.text, `Tend ${hens.length} animals`);
  assert.equal(g.total, hens.length + ripe.length);
  assert.deepEqual(g.target.tile, { x: s.farm.objects[home].x, z: s.farm.objects[home].z });
  assert.equal(g.target.tool, 'hand');
  assert.doesNotMatch(g.text, /things|Sickle/);
  // the hens tended: the fields are the next group, "Harvest N crops" on a ripe plot's tile
  for (const id of hens) s.farm.objects[id].readyAt = T0 + HOUR;
  const f = goals(s, 'p1', T0).now;
  assert.equal(f.text, `Harvest ${ripe.length} crops`);
  assert.ok(ripe.some((id) => s.farm.objects[id].x === f.target.tile.x && s.farm.objects[id].z === f.target.tile.z));
});

test('M29: one NOW priority: Golden Hour (both online) > collect > Plant for later > All done for now', () => {
  const s = farmAt(21);
  s.farm.wallet.coins = 500_000;
  const bench = put(s, 'sunset_bench');
  const at = sofia(14, 19, 30);
  // ripe crops at 19:30: the collect card wins over Plant for later (critique#32's example)
  let n = 0;
  for (const id of Object.keys(s.farm.objects).sort()) {
    const o = s.farm.objects[id];
    if (o.def !== 'plot') continue;
    o.crop = n++ % 2 ? { def: 'carrot', plantedAt: at - HOUR, readyAt: at - MIN, by: 'p1', cycle: 0 } : null;
  }
  const g1 = goals(s, 'p1', at);
  assert.equal(g1.now.kind, 'collect', g1.now.text);
  const all = goals(s, 'p1', at, { all: true }).all;
  assert.ok(all.some((c) => c.kind === 'later'), 'Plant for later is a candidate, ranked below collect');
  // both online and Golden Hour allowed: its card wins
  const g2 = goals(s, 'p1', at, { online: ['p1', 'p2'] });
  assert.equal(g2.now.kind, 'golden');
  assert.equal(g2.now.text, 'Golden Hour is ready: sit on the bench together');
  assert.equal(g2.now.target.sit, bench);
  // the partner away: no Golden Hour card at all (no FOMO), and not within the session gap either
  assert.notEqual(goals(s, 'p1', at, { online: ['p1'] }).now.kind, 'golden');
  s.farm.coop.goldenAt = at - HOUR;
  assert.notEqual(goals(s, 'p1', at, { online: ['p1', 'p2'] }).now.kind, 'golden');
  assert.ok(NOW_SCORE.golden > 10 && 10 > NOW_SCORE.later && NOW_SCORE.later > NOW_SCORE.calm);
});

test('M29 (client half): with the coach speaking nothing else claims NOW; the mirror carries the coach\'s message and counts', () => {
  const s = farmAt(1);
  const step = coachStep(s, 'p1');
  const coach = coachCard(s, 'p1', T0);
  assert.ok(step && coach);
  assert.equal(coach.msg, `TUTORIAL:step.${step.step.id}`);
  assert.deepEqual(coach.params, { have: step.have, need: step.need });
  const cards = [{ slot: 'now', kind: 'plant', title: 'Plant 8 plots' }, { slot: 'soon', kind: 'x' }, { slot: 'big', kind: 'level' }];
  const out = withNowPriority(cards, coach);
  assert.equal(out[0], coach);
  assert.deepEqual(out.filter((c) => c.slot === 'now'), [coach], 'one NOW card: the coach');
  assert.deepEqual(withNowPriority(cards, null), cards, 'without the coach the rules\' order stands');
});

test('All done for now: only long timers left, a calm card instead of an invented chore', () => {
  const s = quiet(farmAt(8), T0 + 3 * HOUR);
  s.farm.wallet.coins = 200;
  const g = goals(s, 'p1', T0).now;
  assert.equal(g.kind, 'calm');
  assert.equal(g.text, 'All done for now');
  assert.equal(enText(g.sub), 'Next ready in 3:00 h');
  // something ripe within CALM_MIN_MS: the old "next ready" tip, not the calm card
  const t = quiet(farmAt(8), T0 + 5 * MIN);
  t.farm.wallet.coins = 200;
  assert.notEqual(goals(t, 'p1', T0).now.kind, 'calm');
});

test('M17a: every Almanac template counts its noun in English (n = 1 and n = 5)', () => {
  const checks = {
    harvest: [{ verb: 'harvest', ref: 'carrot' }, 'Harvest 1 Carrot', 'Harvest 5 Carrots'],
    plant: [{ verb: 'plant', ref: 'carrot' }, 'Plant 1 Carrot plot', 'Plant 5 Carrot plots'],
    water: [{ verb: 'water', ref: '*' }, 'Water 1 crop', 'Water 5 crops'],
    collect: [{ verb: 'collect', ref: 'egg' }, 'Collect 1 Egg', 'Collect 5 Eggs'],
    pet: [{ verb: 'pet', ref: 'animal' }, 'Pet 1 animal', 'Pet 5 animals'],
    make: [{ verb: 'make', ref: 'bread' }, 'Make 1 Bread', 'Make 5 Bread'],
    fill: [{ verb: 'fill', ref: 'order' }, 'Fill 1 order', 'Fill 5 orders'],
    clear: [{ verb: 'clear', ref: 'debris' }, 'Clear a weed, rock or stump', 'Clear 5 weeds, rocks or stumps'],
    enter: [{ verb: 'enter', ref: 'fair' }, 'Enter 1 good at the Fair', 'Enter 5 goods at the Fair'],
  };
  for (const [what, [t, one, five]] of Object.entries(checks)) {
    assert.equal(enText(almanacMsg({ ...t, qty: 1 })), one, what);
    assert.equal(enText(almanacMsg({ ...t, qty: 5 })), five, what);
  }
  // every Almanac template is covered, and none says "1 crops" / "3 order" / "fair"
  const verbs = new Set(Object.values(checks).map(([t]) => t.verb));
  for (const k of Object.keys(GOALS_RULES_EN).filter((x) => x.startsWith('goals.r.alm.') && x !== 'goals.r.alm.any')) {
    assert.ok(verbs.has(k.split('.')[3]), `${k} has an n = 1 / n = 5 check`);
  }
  assert.equal(enText(almanacMsg({ verb: 'shake', ref: '*', qty: 1 })), 'Shake 1 crop');
  assert.equal(enText(almanacMsg({ verb: 'shake', ref: 'order', qty: 3 })), 'Shake 3 orders');
});

test('M28: the workshop tip no longer repeats the panel\'s "Inputs are used when…" line; the plot price comes from content', () => {
  const tip = TUTORIAL.firstUse.find((x) => x.id === 'building_panel').text;
  assert.doesNotMatch(tip, /used when|enters? the queue|ingredient|inputs/i, tip);
  const seed = TUTORIAL.firstUse.find((x) => x.id === 'seed_bag').text;
  assert.match(seed, new RegExp(`costs ${cropOf('wheat').seed} coins`));
  assert.doesNotMatch(seed, /one seed/);
});
