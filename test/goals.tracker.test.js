// The Goal Tracker (GDD §5.1): three cards per player, NOW never empty; the fallback chain ends in a tip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, isLive, xpForLevel, cropOf, liveAt, recipesOf } from '../shared/content/index.js';
import { goals, SPEND_ROTATE_MS, mmss } from '../shared/rules/goals.js';
import { ACTIONS } from '../shared/rules/index.js';
import { farmAt, put, give, runDue, credit, actOk, mulberry32, T0, MIN, HOUR } from './helpers/rules-goals.js';

/** The number of the order in board slot `slot` (what the player saw; RC-07), or 0 for an empty slot. */
const nOf = (st, slot) => st.farm.orders?.slots?.[String(slot)]?.order?.n ?? 0;

test('a fresh farm: NOW says plant the empty plots; BIG is the next level', () => {
  const s = farmAt(1);
  const g = goals(s, 'p1', T0);
  assert.equal(g.now.kind, 'plant');
  assert.equal(g.big.kind, 'level');
  assert.ok(g.soon && g.soon.text);
});

test('everything growing and nothing to do: the NOW card names the next ripening, and no crop tip (RC-09)', () => {
  const s = farmAt(1);
  s.farm.wallet.coins = 0;
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 2 * MIN + 41_000, by: 'p1', cycle: 0 };
    if (CONTENT.debris.has(o.def)) delete s.farm.objects[id];
  }
  const g = goals(s, 'p1', T0);
  assert.equal(g.now.kind, 'tip');
  assert.match(g.now.text, /next ready in 2:41/);
  assert.doesNotMatch(g.now.text, /Tip:/, 'every plot is busy: no "plant X" tip');
});

test('NOW suggests spending: the cheapest building the farm can afford, a slot, a decoration (RC-09)', () => {
  const s = farmAt(8);
  s.farm.wallet.coins = 3292;
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 30 * MIN, by: 'p1', cycle: 0 };
    if (CONTENT.debris.has(o.def)) delete s.farm.objects[id];
  }
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.quests.active = {};
  // the spend cards take turns every SPEND_ROTATE_MS (integration-qa1 open item 5): the build card has its turn
  const turns = [0, 1, 2, 3].map((k) => goals(s, 'p1', T0 + k * SPEND_ROTATE_MS).now);
  const g = turns.find((c) => c.kind === 'build');
  assert.ok(g, turns.map((c) => c.text).join(' | '));
  assert.match(g.text, /^Build the .+ \([0-9,]+\)\. You have 3,292$/);
  assert.equal(g.target.panel, 'market');
  assert.ok(turns.some((c) => c.kind === 'decor'), 'a decoration gets its turn too');
  s.farm.wallet.coins = 100;
  const d = goals(s, 'p1', T0);
  assert.ok(['decor', 'tip'].includes(d.now.kind), d.now.text);
});

test('the slot card never names a building the rules refuse a slot for (the Compost Bin before its recipe, L25)', () => {
  // the level just below the bin's first recipe (Manure at L25; wave 4: Fertilizer at L10), never below the bin itself
  const L = Math.max(CONTENT.buildings.get('compost_bin').unlock,
    Math.min(...recipesOf('compost_bin').map((r) => r.unlock)) - 1);
  const s = farmAt(L);
  s.farm.wallet.coins = 500_000;
  const bin = put(s, 'compost_bin');
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 60 * MIN, by: 'p1', cycle: 0 };
    if (CONTENT.debris.has(o.def)) delete s.farm.objects[id];
  }
  // every building of the level owned and every other one at its last slot: the bin is the only slot left to offer
  for (const b of liveAt('buildings', L)) if (!Object.values(s.farm.objects).some((o) => o.def === b.id)) put(s, b.id);
  for (const [id, o] of Object.entries(s.farm.objects)) {
    if (CONTENT.buildings.has(o.def) && id !== bin && Array.isArray(o.queue)) o.slots = CONTENT.buildings.get(o.def).slots[1];
  }
  s.players.p1.pet = { kind: 'dog', name: 'Rex', at: T0, fed: null, pets: null, treasure: null };
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.quests.active = {};
  for (let t = 0; t < 30 * MIN; t += MIN) {
    const c = goals(s, 'p1', T0 + t).now;
    if (c.kind === 'build' && c.target?.panel === 'building') {
      assert.notEqual(c.target.args.id, bin, c.text);
      assert.equal(ACTIONS.upgradeSlot.check(s, { id: c.target.args.id }, { pid: 'p1', now: T0 + t }), null, c.text);
    }
  }
});

test('a spend card nobody acts on steps aside: the NOW card rotates within SPEND_ROTATE_MS x the cards', () => {
  const s = farmAt(8);
  s.farm.wallet.coins = 3292;
  for (const id of Object.keys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def === 'plot') o.crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 60 * MIN, by: 'p1', cycle: 0 };
    if (CONTENT.debris.has(o.def)) delete s.farm.objects[id];
  }
  for (const p of Object.values(s.players)) p.almanac.tasks = {};
  s.farm.quests.active = {};
  const seen = new Map();
  for (let t = 0; t < 30 * MIN; t += MIN) {
    const c = goals(s, 'p1', T0 + t).now;
    seen.set(c.text, (seen.get(c.text) ?? 0) + 1);
  }
  assert.ok(seen.size >= 2, [...seen.keys()].join(' | '));
  for (const [text, n] of seen) assert.ok(n <= 16, `"${text}" held the NOW card ${n} of 30 minutes`);
});

test('the plant card names the crop that fits the wait, not always the fastest (RC-09)', () => {
  const s = farmAt(8);
  const plots = Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot').sort();
  for (const id of plots.slice(1)) {
    s.farm.objects[id].crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 60 * MIN, by: 'p1', cycle: 0 };
  }
  const g = goals(s, 'p1', T0);
  assert.equal(g.now.kind, 'plant');
  const crop = cropOf(g.now.ref);
  assert.ok(crop.growMs <= 60 * MIN && crop.growMs > cropOf('wheat').growMs, g.now.ref);
});

test('waits read m:ss under an hour, h:mm under ten hours, then hours and minutes (RC-26)', () => {
  assert.equal(mmss(2 * MIN + 41_000), '2:41');
  assert.equal(mmss(135 * MIN), '2:15 h');
  assert.equal(mmss(1440 * MIN - 1000), '24 h 00 m');
  assert.equal(mmss(1439 * MIN), '23 h 59 m');
});

test('ready crops come first; a golden fillable order beats a plain one; the partner\'s pin is avoided', () => {
  const s = farmAt(4);
  runDue(s, T0);
  for (const slot of Object.values(s.farm.orders.slots)) for (const [i, q] of Object.entries(slot.order.items)) give(s, i, q);
  const o = s.farm.objects['home.0.0'];
  o.crop = { def: 'wheat', plantedAt: T0 - 2 * MIN, readyAt: T0 - MIN, by: 'p1', cycle: 0 };
  assert.equal(goals(s, 'p1', T0).now.kind, 'collect');
  o.crop = null;
  for (const id of Object.keys(s.farm.objects)) if (s.farm.objects[id].def === 'plot') s.farm.objects[id].crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + MIN, by: 'p1', cycle: 0 };
  const g = goals(s, 'p1', T0);
  assert.equal(g.now.kind, 'order');
  const golden = Object.keys(s.farm.orders.slots).find((k) => s.farm.orders.slots[k].order.golden);
  if (golden !== undefined) assert.equal(g.now.ref, golden);
  // the partner pins that order: I get pointed elsewhere
  actOk(s, 'orderPin', { slot: Number(g.now.ref), n: nOf(s, Number(g.now.ref)) }, { pid: 'p2' });
  assert.notEqual(goals(s, 'p1', T0).now.ref, g.now.ref);
});

test('fuzz: three cards for both players on random farms at random times, NOW never empty', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const rnd = mulberry32(seed);
    const s = farmAt(1 + Math.floor(rnd() * 12), { seed });
    let now = T0 + Math.floor(rnd() * 10 * HOUR);
    runDue(s, now);
    for (const b of CONTENT.buildings.values()) if (isLive(b) && rnd() < 0.3 && b.unlock <= 12) put(s, b.id);
    for (const it of CONTENT.items.values()) if (isLive(it) && rnd() < 0.1) give(s, it.id, 1 + Math.floor(rnd() * 9));
    for (const id of Object.keys(s.farm.objects)) {
      const o = s.farm.objects[id];
      if (o.def === 'plot' && rnd() < 0.7) o.crop = { def: 'wheat', plantedAt: now - MIN, readyAt: now + Math.floor((rnd() - 0.5) * HOUR), by: 'p1', cycle: 0 };
      if (CONTENT.debris.has(o.def) && rnd() < 0.5) delete s.farm.objects[id];
    }
    if (rnd() < 0.5) credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: Math.floor(rnd() * 3000), coins: 0 }], { now });
    for (const pid of ['p1', 'p2']) {
      const g = goals(s, pid, now);
      for (const slot of ['now', 'soon']) {
        assert.ok(g[slot] && typeof g[slot].text === 'string' && g[slot].text.length > 0, `seed ${seed} ${pid}: ${slot} empty`);
      }
      assert.ok(g.big === null || typeof g.big.text === 'string');
      assert.ok(!/undefined|NaN/.test(JSON.stringify(g)), `seed ${seed}: ${JSON.stringify(g)}`);
    }
    now += HOUR;
  }
  assert.ok(xpForLevel(2) > 0);
});

test('task texts: "Upgrade the Barn" (not "Upgrade Barn upgrade"); the welcome coach text (RC-26)', async () => {
  const { taskText, taskLabel } = await import('../shared/rules/goals.js');
  const { TUTORIAL } = await import('../shared/content/index.js');
  assert.equal(taskText({ verb: 'upgrade', ref: 'barn', qty: 1 }), 'Upgrade the Barn');
  assert.equal(taskLabel({ verb: 'upgrade', ref: 'barn', qty: 1 }), 'Upgrade the Barn');
  assert.equal(TUTORIAL.start[0].text, 'The farm is yours, both of you. First, let\'s give it a name.');
});

test('"Try a new recipe" never offers a feed (it would never retire) (RC-11)', () => {
  const s = farmAt(3);
  s.farm.quests.active = {};
  put(s, 'feed_mill');
  give(s, 'wheat', 30);
  const g = goals(s, 'p1', T0);
  assert.ok(!(g.soon && g.soon.kind === 'try' && g.soon.id === 'chicken_feed'), JSON.stringify(g.soon));
  for (const slot of ['now', 'soon', 'big']) assert.notEqual(g[slot]?.id, 'chicken_feed');
});

test('a broke farm with nothing growing is offered Grandma\'s seed basket on the NOW card (RC-21)', () => {
  const s = farmAt(2);
  s.farm.wallet.coins = 0;
  s.farm.inventory = {};
  const g = goals(s, 'p1', T0);
  assert.equal(g.now.kind, 'basket');
  assert.match(g.now.text, /seed basket: 12 free Wheat plantings/);
  assert.deepEqual(g.now.target, { act: 'seedBasket', args: {} });
  actOk(s, 'seedBasket', {}, { now: T0 });
  assert.notEqual(goals(s, 'p1', T0).now.kind, 'basket', 'once a day');
});
