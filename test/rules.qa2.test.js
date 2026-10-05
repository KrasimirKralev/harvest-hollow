// Wave-2 QA (docs/qa/qa2/TRIAGE.md, section rules-content): regression tests for the rules fixes. Each test names its
// RC-xx; the lane proofs that found them live in docs/qa/qa2/{mechanics,playtest,coop-weekly}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT, itemOf, treeOf, animalOf, recipeOf, TOWN_PROJECT_RULES } from '../shared/content/index.js';
import { systemLive } from '../shared/rules/coop.js';
import { dayIndex } from '../shared/rules/calendar.js';
import { farmAt, makeFarm, must, sys, put, give, T0, HOUR, MIN } from './helpers/rules-goals.js';

/** Units ONE producer (a tree, an animal, one building) makes per hour. */
function perProducerHour(item) {
  const it = itemOf(item);
  if (it.kind === 'fruit') { const t = treeOf(it.source); return t.yield / (t.cycleMs / HOUR); }
  if (it.kind === 'animal') { const a = animalOf(it.source); return a.out / (a.cycleMs / HOUR); }
  const r = recipeOf(it.source);
  return r.out / (r.ms / HOUR);
}

/** One producer of each good (inputs and feed in the Barn), and the good marked as made today. */
function makerFarm(level, seed, goods) {
  const s = farmAt(level, { seed });
  const day = dayIndex(T0, s.meta.tz);
  for (const id of goods) {
    const it = itemOf(id);
    s.farm.made[id] = day;
    if (it.kind === 'fruit') put(s, it.source);
    else if (it.kind === 'animal') {
      const a = animalOf(it.source);
      put(s, a.id, { home: put(s, a.homes[0]), adultAt: T0 - HOUR });
      if (a.feed) give(s, a.feed, 50);
    } else {
      const r = recipeOf(it.source);
      if (!Object.values(s.farm.objects).some((o) => o.def === r.building)) put(s, r.building);
      for (const i of Object.keys(r.inputs ?? {})) give(s, i, 50);
    }
  }
  return s;
}

test('RC-02: every posted Town Project good is 1 to 4 hours (or one cycle) of the one producer the farm owns', () => {
  const capH = TOWN_PROJECT_RULES.producerCapMs / HOUR;
  for (const level of [20, 25]) {
    for (let seed = 1; seed <= 6; seed++) {
      const s = makerFarm(level, seed, ['apple', 'cherry', 'egg', 'milk', 'honey', 'bread', 'butter', 'cheese',
        'apple_juice', 'cookies', 'strawberry_jam', 'cherry_jam', 'yarn']);
      const r = sys(s, '_townPost', {}, T0);
      assert.ok(r.ok, `L${level} seed ${seed}: _townPost ${r.code}`);
      for (const g of s.farm.town.cur.goods) {
        const hours = g.qty / perProducerHour(g.item);
        // a producer whose one cycle is longer than the cap (a 6-hour cherry tree) is asked for one cycle
        const it = itemOf(g.item);
        const cycleH = (it.kind === 'fruit' ? treeOf(it.source).cycleMs : it.kind === 'animal'
          ? animalOf(it.source).cycleMs : recipeOf(it.source).ms) / HOUR;
        assert.ok(g.qty >= 1 && hours <= Math.max(capH, cycleH) + 1e-9,
          `L${level} seed ${seed}: ${g.qty} ${g.item} = ${hours} h`);
      }
    }
  }
});

test('RC-02: a good the farm made but can no longer make (its producer sold) is never asked for', () => {
  const s = makerFarm(20, 1, ['bread', 'cheese', 'apple_juice']);
  s.farm.made.egg = dayIndex(T0, s.meta.tz);                     // Eggs made this week, but no hen on the farm
  sys(s, '_townPost', {}, T0);
  assert.deepEqual(s.farm.town.cur.goods.map((g) => g.item).sort(), ['apple_juice', 'bread', 'cheese']);
});

// ---- RC-04: ribbons on counters written outside progress.js ----------------------------------------------------

test('RC-04: High Roller is awarded by the sale that crosses 100,000 earned coins (same minute: no safety net)', () => {
  const s = makeFarm();
  const now = T0 + 5 * MIN;
  give(s, 'wood', 30);
  must(s, 'sell', { item: 'wood', qty: 30, confirm: ['RESERVED'] }, { now });   // the minute's first action
  s.farm.stats['coins.earned'] = 99_999;
  give(s, 'wood', 1);
  const r = must(s, 'sell', { item: 'wood', qty: 1, confirm: ['RESERVED'] }, { now });
  assert.equal(s.farm.ribbons.high_roller?.t, 1);
  assert.ok(r.tx.events.some((e) => e.e === 'achievement' && e.id === 'high_roller'));
});

test('RC-04: every live counter ribbon whose counter reached a tier is awarded on the next minute\'s action', () => {
  // the four settled-holdings stats read objects, not the counter (ribbons.js ribbonValue); they have their own test
  const special = new Set(['buildsAndSlots', 'placed.scarecrow', 'animalsNamed', 'named.chicken']);
  const ribbons = [...CONTENT.ribbons.values()]
    .filter((r) => r.mode === 'sum' && systemLive(r) && !special.has(r.stat));
  assert.ok(ribbons.length > 20);
  const s = makeFarm();
  for (const r of ribbons) {
    const stats = r.scope === 'P' ? s.players.p1.stats : s.farm.stats;
    stats[r.stat] = r.tiers[0] * (r.scale ?? 1);
  }
  give(s, 'wood', 1);
  must(s, 'sell', { item: 'wood', qty: 1, confirm: ['RESERVED'] }, { now: T0 + 7 * MIN });
  const missing = ribbons.filter((r) => !((r.scope === 'P' ? s.players.p1.ribbons : s.farm.ribbons)?.[r.id]?.t >= 1));
  assert.deepEqual(missing.map((r) => r.id), []);
});

// ---- RC-06: Giant fishing by rotating the anchor plot ----------------------------------------------------------

test('RC-06: after a failed Giant roll no re-arrangement of the same nine plots rolls in that cycle', async () => {
  const R = await import('./helpers/rules.js');
  const { canPlace } = await import('../shared/rules/grid.js');
  const plotAt = (s, x, z) => Object.keys(s.farm.objects)
    .find((k) => s.farm.objects[k].def === 'plot' && s.farm.objects[k].x === x && s.farm.objects[k].z === z);
  let failedFirst = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const s = R.farmAt(20, { seed });
    R.allLand(s);
    let x0 = -1; let z0 = -1;
    for (let z = 4; z < 60 && x0 < 0; z++) {
      for (let x = 4; x < 60 && x0 < 0; x++) {
        let ok = true;
        for (let dz = 0; dz < 3 && ok; dz++) {
          for (let dx = 0; dx < 4 && ok; dx++) ok = canPlace(s, 'plot', x + dx, z + dz, 0) === null;
        }
        if (ok) { x0 = x; z0 = z; }
      }
    }
    const ids = [];
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) ids.push(R.placeDef(s, 'plot', { at: [x0 + dx, z0 + dz] }));
    }
    R.give(s, 'compost', 9);
    let t = T0 + 11 * MIN;
    R.must(s, 'compost', { ids }, { now: t });
    const first = R.must(s, 'plant', { ids, crop: 'pumpkin' }, { now: (t += MIN) });
    assert.ok(ids.every((id) => s.farm.objects[id].giantTried === 0), 'the roll stamps all nine plots');
    if (first.tx.events.some((e) => e.e === 'giantFormed')) continue;
    failedFirst++;
    for (let i = 1; i < 9; i++) {
      t += 5_000;
      R.must(s, 'uproot', { ids }, { now: t });
      const corner = plotAt(s, x0, z0);
      const cand = ids[i];
      const [cx, cz] = [s.farm.objects[cand].x, s.farm.objects[cand].z];
      R.must(s, 'move', { id: corner, x: x0 + 3, z: z0, rot: 0 }, { now: t + 1 });
      R.must(s, 'move', { id: cand, x: x0, z: z0, rot: 0 }, { now: t + 2 });
      R.must(s, 'move', { id: corner, x: cx, z: cz, rot: 0 }, { now: t + 3 });
      const block = [];
      for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) block.push(plotAt(s, x0 + dx, z0 + dz));
      const r = R.must(s, 'plant', { ids: block, crop: 'pumpkin' }, { now: t + 4 });
      assert.ok(!r.tx.events.some((e) => e.e === 'giantFormed'), `seed ${seed}: anchor #${i} re-rolled a Giant`);
    }
  }
  assert.ok(failedFirst >= 5, `${failedFirst} first rolls failed`);
});

// ---- RC-08: effects of objects still inside their 100 % undo window ---------------------------------------------

/** A decor's spot with a free plot tile right below it (row-major), on an all-land farm. */
async function besidePlot(s, def) {
  const { canPlace } = await import('../shared/rules/grid.js');
  for (let z = 6; z < 50; z++) {
    for (let x = 6; x < 50; x++) {
      if (canPlace(s, def, x, z, 0) === null && canPlace(s, 'plot', x, z + 1, 0) === null) return [x, z];
    }
  }
  throw new Error(`no spot for ${def}`);
}

test('RC-08: a Cold Frame that puts a crop in season is used: no 100 % undo after the planting', async () => {
  const R = await import('./helpers/rules.js');
  const s = R.farmAt(24, { coins: 1_000_000 });
  R.allLand(s);
  const spot = await besidePlot(s, 'greenhouse_frame');
  const t = T0 + 11 * MIN;
  const plot = R.placeDef(s, 'plot', { at: [spot[0], spot[1] + 1], now: T0 });
  const frame = R.placeDef(s, 'greenhouse_frame', { at: spot, now: t });
  R.must(s, 'plant', { id: plot, crop: 'wheat' }, { now: t + 1000 });                 // off season in late September
  assert.equal(s.farm.objects[plot].crop.forced, true);
  assert.equal(s.farm.objects[frame].rcpt, undefined);
  assert.equal(R.run(s, 'refund', { id: frame }, { now: t + 2000 }).code, 'NOT_REFUNDABLE');
});

test('RC-08: a Cold Frame next to an in-season crop was not used and keeps its undo', async () => {
  const R = await import('./helpers/rules.js');
  const s = R.farmAt(24, { coins: 1_000_000 });
  R.allLand(s);
  const spot = await besidePlot(s, 'greenhouse_frame');
  const t = T0 + 11 * MIN;
  const plot = R.placeDef(s, 'plot', { at: [spot[0], spot[1] + 1], now: T0 });
  const frame = R.placeDef(s, 'greenhouse_frame', { at: spot, now: t });
  R.must(s, 'plant', { id: plot, crop: 'pumpkin' }, { now: t + 1000 });             // an autumn crop in September
  assert.equal(s.farm.objects[plot].crop.forced, undefined);
  assert.notEqual(s.farm.objects[frame].rcpt, undefined);
  R.must(s, 'refund', { id: frame }, { now: t + 2000 });
});

test('RC-08: a Scarecrow whose chance a harvest used, and a Sprinkler that watered a planting, are used', async () => {
  const R = await import('./helpers/rules.js');
  const { cropOf } = await import('../shared/content/index.js');
  for (const def of ['scarecrow', 'sprinkler']) {
    const s = R.farmAt(12, { coins: 1_000_000 });
    R.allLand(s);
    const spot = await besidePlot(s, def);
    const plot = R.placeDef(s, 'plot', { at: [spot[0], spot[1] + 1], now: T0 });
    const t = T0 + 11 * MIN;
    const d = R.placeDef(s, def, { at: spot, now: t });
    const crop = def === 'sprinkler' ? 'pumpkin' : 'wheat';
    R.must(s, 'plant', { id: plot, crop }, { now: t + 1000 });
    if (def === 'scarecrow') {
      assert.notEqual(s.farm.objects[d].rcpt, undefined, 'planting does not use a Scarecrow');
      R.must(s, 'harvest', { id: plot }, { now: t + 1000 + cropOf(crop).growMs });
    }
    assert.equal(s.farm.objects[d].rcpt, undefined, def);
  }
});

test('RC-08: horses that pulled a barge crate are used; the crate pays their bonus once, for good', async () => {
  const R = await import('./helpers/rules.js');
  const { runDue: due, MONDAY } = await import('./helpers/rules-goals.js');
  const s = R.farmAt(25, { coins: 2_000_000 });
  R.allLand(s);
  const day = dayIndex(MONDAY, s.meta.tz);
  for (const k of ['bread', 'cheese', 'apple_juice']) s.farm.made[k] = day;
  due(s, MONDAY);
  const mk = (item, qty) => ({ item, qty, by: null, at: 0, flag: null });
  s.farm.barge = { ...s.farm.barge, docked: true, rows: 1, paid: {},
    crates: { 0: mk('cheese', 6), 1: mk('apple_juice', 12), 2: mk('cookies', 8) } };
  const t = MONDAY + MIN;
  R.placeDef(s, 'stable', { now: t, confirm: ['BIG_SPEND'] });
  for (let i = 0; i < 2; i++) {
    R.must(s, 'buyAnimal', { def: 'horse', adult: true, confirm: ['BIG_SPEND'] }, { now: t + 1 + i });
  }
  give(s, 'cheese', 6);
  R.must(s, 'bargeLoad', { i: 0 }, { now: t + 5000 });
  for (const id of R.idsOf(s, 'horse')) {
    assert.equal(R.run(s, 'refund', { id }, { now: t + 6000 }).code, 'NOT_REFUNDABLE');
  }
});

test('RC-08: a hive in its undo window brings no species to Full Barnyard; its pollination uses it', async () => {
  const R = await import('./helpers/rules.js');
  const { ribbonValue } = await import('../shared/rules/actions/ribbons.js');
  const s = R.farmAt(19, { coins: 2_000_000 });
  R.allLand(s);
  const old = T0 - HOUR;
  for (const [home, sp] of [['coop', 'chicken'], ['cow_barn', 'cow']]) {
    if (!R.idsOf(s, home).length) R.placeDef(s, home, { now: old, confirm: ['BIG_SPEND'] });
    R.must(s, 'buyAnimal', { def: sp, adult: true, confirm: ['BIG_SPEND'] }, { now: old + 1 });
  }
  const r = CONTENT.ribbons.get('full_barnyard');
  const t = T0 + MIN;
  const v0 = ribbonValue(s, r, null, t);
  const spot = await besidePlot(s, 'beehive');
  const plot = R.placeDef(s, 'plot', { at: [spot[0], spot[1] + 2], now: old });
  const hive = R.placeDef(s, 'beehive', { at: spot, now: t });
  assert.equal(ribbonValue(s, r, null, t + 1), v0, 'the colony of an unsettled hive');
  assert.equal(ribbonValue(s, r, null, t + 11 * MIN), v0 + 1, 'and once the hive is settled');
  R.must(s, 'plant', { id: plot, crop: 'wheat' }, { now: t + 2 });
  const { cropOf } = await import('../shared/content/index.js');
  R.must(s, 'harvest', { id: plot }, { now: t + 2 + cropOf('wheat').growMs });
  assert.equal(s.farm.objects[hive].rcpt, undefined, 'the hive pollinated the harvest');
});

// ---- RC-10: Goal Tracker dead cards ------------------------------------------------------------------------------

/** Every plot growing for a day, so collect / plant cards do not hold NOW. */
function busyFields(s, now) {
  for (const o of Object.values(s.farm.objects)) {
    if (o.def !== 'plot') continue;
    o.crop = { def: 'cabbage', plantedAt: now - HOUR, readyAt: now + 20 * HOUR, by: 'p1', cycle: o.cycle, cut: 0 };
  }
}

/** The "Build the X" cards goals() shows either farmer over three spend rotations (12 minutes). */
async function buildCards(s, now) {
  const { goals, SPEND_ROTATE_MS } = await import('../shared/rules/goals.js');
  const out = new Set();
  for (let k = 0; k < 6; k++) {
    for (const pid of ['p1', 'p2']) {
      const g = goals(s, pid, now + k * SPEND_ROTATE_MS);
      for (const c of [g.now, g.soon, g.big]) if (c && c.kind === 'build' && /^Build the/.test(c.text)) out.add(c.id);
    }
  }
  return out;
}

test('RC-10a: no "Build the X" card for a second copy while the first has a free slot', async () => {
  const { liveAt } = await import('../shared/content/index.js');
  const { resetGrid } = await import('../shared/rules/grid-cache.js');
  const s = farmAt(18);
  s.farm.wallet.coins = 5_000_000;
  s.farm.expansions = [...CONTENT.expansions.values()].filter((e) => e.m !== 'M2' && e.m !== 'M3').map((e) => e.id);
  resetGrid(s);
  const now = T0 + HOUR;
  for (const b of liveAt('buildings', 18)) put(s, b.id, { slots: b.slots[1] });   // one of each, all slots, idle
  busyFields(s, now);
  assert.deepEqual([...await buildCards(s, now)], []);
});

test('RC-10a: no "Build the X" card when X fits nowhere on the land', async () => {
  const { canFit } = await import('../shared/rules/grid.js');
  const { FARM_MIN, FARM_MAX } = await import('../shared/content/config.js');
  const s = farmAt(12);
  s.farm.wallet.coins = 5_000_000;
  for (let z = FARM_MIN; z < FARM_MAX; z++) {
    for (let x = FARM_MIN; x < FARM_MAX; x++) if (canFit(s, 'plot', x, z, 0) === null) put(s, 'plot', { x, z });
  }
  const now = T0 + HOUR;
  busyFields(s, now);
  assert.deepEqual([...await buildCards(s, now)], []);
});

test('RC-10b: the Fair entry card is the cheapest good that reaches the next medal, and none past the top one',
  async () => {
    const { FAIR } = await import('../shared/content/index.js');
    const { medalNeed10, fairStanding, enterable } = await import('../shared/rules/actions/fair.js');
    const { goals } = await import('../shared/rules/goals.js');
    const { runDue, MONDAY, forceM1bGoals } = await import('./helpers/rules-goals.js');
    await forceM1bGoals();
    const s = farmAt(14);
    runDue(s, MONDAY);
    const now = MONDAY + 2 * HOUR;
    busyFields(s, now);
    give(s, 'apple_pie', 5);
    give(s, 'bread', 5);
    const cur = s.farm.fair.cur;
    const st = fairStanding(s, now);
    const list = enterable(s, now);
    const cheap = list.filter((e) => e.p10 >= st.next.need10)
      .sort((a, b) => itemOf(a.item).sell - itemOf(b.item).sell)[0];
    const g = goals(s, 'p1', now);
    const card = [g.now, g.soon, g.big].find((c) => c && c.kind === 'fair' && /^Enter/.test(c.text));
    if (card) assert.equal(card.ref, (cheap ?? list[0]).item);
    cur.p = medalNeed10(FAIR.medals.find((m) => m.id === 'gold3'), cur.W);
    const g2 = goals(s, 'p1', now);
    assert.ok(![g2.now, g2.soon, g2.big].some((c) => c && c.kind === 'fair' && /^Enter/.test(c.text)), g2.now.text);
  });

// ---- RC-17: the Compost Bin's passive tray is no recipe -----------------------------------------------------------

test('RC-17: emptying the Compost Bin tray rolls no Recipe Card and is no "make Compost" deed', async () => {
  const R = await import('./helpers/rules.js');
  const s = R.farmAt(25);
  R.allLand(s);
  const bin = R.idsOf(s, 'compost_bin')[0] ?? R.placeDef(s, 'compost_bin', { confirm: ['BIG_SPEND'] });
  s.farm.objects[bin].ready = 3;
  const r0 = s.farm.album?.sets?.recipe_cards?.r ?? 0;
  const r = R.must(s, 'collectTray', { id: bin }, { now: T0 + MIN });
  assert.ok(r.tx.events.some((e) => e.e === 'crafted' && e.maker === 'sys'));
  assert.equal((s.farm.album?.sets?.recipe_cards?.r ?? 0) - r0, 0);
  assert.ok(!r.tx.events.some((e) => e.e === 'albumFind' || e.e === 'found'));
});

// ---- RC-19: NOW card hysteresis ------------------------------------------------------------------------------------

test('RC-19: the NOW card shown stays unless another outranks it by more than KEEP_MARGIN', async () => {
  const { goals, KEEP_MARGIN } = await import('../shared/rules/goals.js');
  const branches = new Set();
  let checked = 0;
  for (const busy of [false, true]) for (let level = 3; level <= 14; level++) {
    const s = farmAt(level);
    const now = T0 + HOUR;
    if (busy) busyFields(s, now);
    const g = goals(s, 'p1', now, { ranked: true });
    if (g.ranked.length < 2) continue;
    const [top, second] = g.ranked;
    const keep = { kind: second.kind, id: second.id, ref: second.ref };
    const k = goals(s, 'p1', now, { keep });
    const close = top.score - second.score <= KEEP_MARGIN;
    branches.add(close);
    assert.equal(k.now.kind, close ? second.kind : top.kind, `L${level} busy ${busy}`);
    // a kept card that is gone (done) never sticks
    assert.equal(goals(s, 'p1', now, { keep: { kind: 'nothing' } }).now.kind, g.now.kind);
    checked++;
  }
  assert.deepEqual([...branches].sort(), [false, true], 'both a kept card and an outranked one were seen');
});
