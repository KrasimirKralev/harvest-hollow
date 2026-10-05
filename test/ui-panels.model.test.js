// ui-panels: the panels' view models (public/js/ui/panels/model.js, goals-model.js) on a farm built through the real
// rules (test/helpers/ui-panels.js), the action probe/simulate core, and the intent table's contract with the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyFarm, act, MIN, HOUR } from './helpers/ui-panels.js';
import { makeFarm } from './helpers.js';
import {
  CONTENT, live, itemOf, levelFromXp, barnCapacity, recipesOf, plotCapOf, MARKET, BOOSTS,
} from '../shared/content/index.js';
import { ACTIONS } from '../shared/rules/index.js';
import { parseArgs } from '../shared/rules/schema.js';
import { ERR, SOFT } from '../shared/net/protocol.js';
import * as economy from '../shared/rules/economy.js';
import * as decorA from '../shared/rules/actions/decor.js';
import * as craftingA from '../shared/rules/actions/crafting.js';
import * as M from '../public/js/ui/panels/model.js';
import { probe, passes, simulate, reason, has, pick } from '../public/js/ui/panels/core.js';
import { I } from '../public/js/ui/panels/intents.js';

const NOW = 1_800_000_000_000;
const store = (state, pid = 'p1', now = NOW) => ({ state, pid, now: () => now });
const farm = () => storyFarm({ now: NOW });
const ofDef = (s, def) => Object.keys(s.farm.objects).sort().filter((id) => s.farm.objects[id].def === def);

test('intents: every intent names a registered action and builds schema-valid args', () => {
  const sample = {
    sell: ['wheat', 1], storeBuy: ['chicken_feed', 6], keep: ['egg', 3], noFeed: ['wheat', true], barnUpgrade: [],
    wish: ['bakery'], wishDeposit: ['a.1.0', 100], wishWithdraw: ['a.1.0'], wishAnswer: ['a.1.0', true], unwish: ['a.1.0'],
    goldenSeeds: [], buyTool: ['big_watering_can'], hurry: ['a.1.0'], openExpansion: ['creekside'], expand: ['creekside'],
    sellObject: ['a.1.0'], refund: ['a.1.0'], restore: ['a.1.0'], store: ['a.1.0'], moveBack: ['a.1.0'], pinObject: ['a.1.0', true],
    craft: ['a.1.0', 'bread'], duet: ['a.1.0', 'sweetheart_cake'], cancel: ['a.1.0', 1, 3], collectTray: ['a.1.0'], addSlot: ['a.1.0'],
    buyAnimal: ['chicken', false, 'a.1.0'], tend: ['a.1.0'], feed: ['a.1.0'], collect: ['a.1.0'], pet: ['a.1.0'], bottle: ['a.1.0'],
    upgradeHome: ['a.1.0'], harvestTree: ['a.1.0'], chop: ['a.1.0'], water: ['a.1.0'], compost: ['a.1.0'],
    fillOrder: [0, 5], discardOrder: [0, 5], pinOrder: [0, 5], flagOrder: [0, 5], rushOrder: [0], claimGift: [], rerollTask: [0],
    deliverQuest: ['a1'], postNote: ['hi', 20, 30], removeNote: ['a.1.0'], thank: [3], keepsake: ['wheat'],
    markSeen: ['level', undefined, 3], titlePick: [], nameAnimal: ['a.1.0', 'Clover'], sellSurplus: [],
  };
  const missing = [];
  for (const [name, fn] of Object.entries(I)) {
    assert.ok(Object.hasOwn(sample, name), `intent ${name} has a sample in this test`);
    const it = fn(...sample[name]);
    if (!Object.hasOwn(ACTIONS, it.type)) { missing.push(`${name} -> ${it.type}`); continue; }
    assert.ok(parseArgs(ACTIONS[it.type].schema, it.args), `${name}: args ${JSON.stringify(it.args)} fail the ${it.type} schema`);
  }
  assert.deepEqual(missing, [], 'every panel intent must exist in shared/rules');
});

test('probe = the action\'s own check; passes() lets soft codes through; simulate() leaves the state as it was', () => {
  const { state: s } = farm();
  const st = store(s);
  assert.equal(probe(st, 'sell', { item: 'wheat', qty: 1 }), null);
  assert.equal(probe(st, 'sell', { item: 'wheat', qty: economy.available(s, 'wheat') + 1 }), ERR.NO_ITEMS);
  assert.equal(probe(st, 'noSuchAction', {}), ERR.UNKNOWN_ACTION);
  assert.equal(probe(st, 'sell', { item: 'wheat', qty: -1 }), ERR.BAD_ARGS);
  for (const c of SOFT) assert.equal(passes(c), true);
  assert.equal(passes(null), true);
  assert.equal(passes(ERR.NO_COINS), false);
  const before = JSON.stringify(s);
  const r = simulate(st, 'sell', { item: 'wheat', qty: 5 });
  assert.equal(r.ok, true);
  const sold = r.events.find((e) => e.e === 'sold');
  assert.ok(sold && sold.qty === 5 && sold.coins > 0);
  assert.equal(JSON.stringify(s), before, 'simulate rolls everything back');
  assert.equal(pick('nope', 'sell'), 'sell');
  assert.equal(has('sell'), true);
});

test('reason(): a specific sentence for every code a button can show', () => {
  for (const code of Object.values(ERR)) assert.ok(reason(code).length > 0, code);
  assert.equal(reason(ERR.NO_COINS, { coins: 1200 }), 'Need 1,200 more coins');
  assert.equal(reason(ERR.NO_ITEMS, { missing: [{ item: 'flour', n: 2 }] }), 'Need 2 more Flour');
  assert.equal(reason(ERR.LOCKED, { unlock: 9 }), 'Unlocks at level 9');
  assert.equal(reason(ERR.CAP, { text: 'The Chicken Coop is full' }), 'The Chicken Coop is full');
  assert.equal(reason(null), '');
});

test('barn: capacity from the upgrades, overflow status, the next upgrade row, surplus keeps Keep N', () => {
  const { state: s } = farm();
  const v = M.barnView(s);
  assert.equal(v.cap, barnCapacity(s.farm.barn));
  assert.equal(v.used, M.stored(s));
  assert.equal(v.hardCap, Math.floor((v.cap * MARKET.barn.overflowMulBp) / 10_000));
  assert.ok(['ok', 'near', 'overflow', 'full'].includes(v.status));
  assert.equal(v.next.n, s.farm.barn + 1);
  assert.equal(v.next.coins, CONTENT.barn[s.farm.barn].cost);
  const egg = v.stacks.find((x) => x.id === 'egg');
  assert.equal(egg.keep, 4);
  assert.equal(egg.keepBy, 'p2');
  assert.equal(egg.free, egg.n - 4);
  const wood = v.stacks.find((x) => x.id === 'wood');
  assert.equal(wood.keep, itemOf('wood').keepDefault, 'Wood keeps its content default');
  // overflow: push the barn over its capacity
  s.farm.overflow.wheat = 300;
  const o = M.barnView(s);
  assert.equal(o.status, o.used >= o.hardCap ? 'full' : 'overflow');
  const sp = M.surplusPreview(s);
  for (const r of sp.rows) {
    const st = o.stacks.find((x) => x.id === r.id);
    assert.ok(st.n - r.qty >= Math.max(MARKET.barn.surplusKeep, st.keep), `${r.id} keeps at least max(10, Keep N)`);
  }
});

test('sell: the quote is exactly what the sell action pays (mastery, season, Demand)', () => {
  const { state: s } = farm();
  for (const x of M.sellList(s, NOW).slice(0, 8)) {
    const qty = Math.min(x.n, 7);
    const q = M.saleQuote(s, x.id, qty, NOW);
    const r = simulate(store(s), 'sell', { item: x.id, qty, confirm: ['RESERVED'] });
    assert.equal(r.ok, true, x.id);
    assert.equal(r.events.find((e) => e.e === 'sold').coins, q.coins, `${x.id}: quote ${q.coins}`);
  }
  // items with something free to sell come first
  const list = M.sellList(s, NOW);
  const firstKeptOnly = list.findIndex((x) => x.free === 0);
  if (firstKeptOnly >= 0) assert.ok(list.slice(firstKeptOnly).every((x) => x.free === 0 || x.demand));
});

test('store: every live def is listed; locks, caps, the build tray and prices agree with the rules', () => {
  const { state: s } = farm();
  const level = levelFromXp(s.farm.xp);
  const seeds = M.storeCards(s, 'seeds', { now: NOW, pid: 'p1' });
  assert.deepEqual(seeds.map((c) => c.id), live('crops').map((c) => c.id));
  for (const c of seeds) assert.equal(c.code === 'LOCKED', c.unlock > level, c.id);
  for (const tab of ['trees', 'buildings', 'decor', 'acorn']) {
    for (const c of M.storeCards(s, tab, { now: NOW, pid: 'p1' })) {
      if (c.kind === 'boost') continue;
      const p = decorA.buyPrice(s, c.id);
      if (p.code === null) {
        assert.equal(c.price.coins, p.coins, `${c.id} coins`);
        assert.equal(c.price.acorns, p.acorns, `${c.id} acorns`);
      } else if (p.code === ERR.CAP) assert.equal(c.code, 'CAP', `${c.id}: the rules say CAP`);
      else if (p.code === ERR.LOCKED && (CONTENT[`${tab === 'acorn' ? 'decor' : tab}`]?.get(c.id)?.unlock ?? 1) > level) assert.equal(c.code, 'LOCKED', c.id);
    }
  }
  // a fresh farm: the free Coop and Feed Mill wait in the tray and are placed for free
  const f = makeFarm({ now: NOW });
  const b = M.storeCards(f, 'buildings', { now: NOW, pid: 'p1' }).find((c) => c.id === 'feed_mill');
  assert.equal(b.tray, 1);
  assert.equal(b.code, null);
  const coop = M.storeCards(f, 'animals', { now: NOW, pid: 'p1' }).find((c) => c.id === 'coop');
  assert.equal(coop.tray, 1);
  // a hen with no coop explains itself before the price
  const hen = M.storeCards(f, 'animals', { now: NOW, pid: 'p1' }).find((c) => c.id === 'chicken' && !c.adult);
  assert.equal(hen.code, 'LOCKED');
  assert.match(hen.hint.text, /Coop first/);
  // plots: the cap is the content's
  assert.equal(M.capOf(s, 'plot'), plotCapOf(level, M.expansionsOwned(s)));
});

test('store: tools and boosts follow their content numbers', () => {
  const { state: s } = farm();
  const tools = M.storeCards(s, 'tools', { now: NOW, pid: 'p1' });
  for (const t of tools.filter((x) => x.kind === 'tool')) assert.equal(t.price.coins, CONTENT.tools.get(t.id).cost);
  const feed = tools.find((x) => x.id === 'chicken_feed');
  assert.equal(feed.price.coins, CONTENT.feeds.get('chicken_feed').storePrice * CONTENT.feeds.get('chicken_feed').out);
  const gs = M.storeCards(s, 'acorn', { now: NOW, pid: 'p1' }).find((x) => x.id === 'golden_seeds');
  assert.equal(gs.price.acorns, BOOSTS.goldenSeeds.acorns);
  assert.equal(gs.big, true, '12 Acorns in one purchase is always BIG_SPEND');
});

test('building: queue states, tray, slots and recipe inputs as the rules see them', () => {
  const { state: s, ids } = farm();
  const v = M.buildingView(s, ids.bakery, NOW);
  assert.equal(v.slots, s.farm.objects[ids.bakery].slots);
  assert.equal(v.nextCost, craftingA.slotPrice(s.farm.objects[ids.bakery]));
  assert.deepEqual(v.queue.map((q) => q.status), ['done', 'running']);
  assert.equal(v.tray, 1);
  assert.equal(v.free, v.slots - v.queue.length);
  assert.deepEqual(v.recipes.map((r) => r.id), recipesOf('bakery').map((r) => r.id));
  for (const r of v.recipes) {
    for (const x of r.inputs) assert.equal(x.have, economy.available(s, x.item), `${r.id} ${x.item}`);
    assert.equal(r.locked, r.unlock > levelFromXp(s.farm.xp));
  }
  // the probe agrees: a full queue answers QUEUE_FULL, inputs short answer NO_ITEMS
  const code = probe(store(s, 'p1', NOW), 'craft', { id: ids.bakery, recipe: 'bread' });
  assert.equal(code, v.free > 0 ? null : ERR.QUEUE_FULL);
  // feed mill classes: members in stock, kept units skipped
  const fm = M.buildingView(s, ids.feedMill, NOW);
  const feed = fm.recipes.find((r) => r.id === 'chicken_feed');
  assert.equal(feed.isFeed, true);
  assert.equal(feed.inputs[0].cls, 'grain');
  assert.equal(feed.inputs[0].have, feed.inputs[0].members.reduce((a, m) => a + m.n, 0));
  assert.equal(M.hurryAcorns(30 * MIN), 1);
  assert.equal(M.hurryAcorns(61 * MIN), 2);
  assert.equal(M.hurryAcorns(48 * HOUR), BOOSTS.hurry.maxAcorns);
});

test('animals: every hen is in one honest state; capacity counts the upgrades', () => {
  const { state: s, ids } = farm();
  const v = M.homeView(s, ids.coop, NOW);
  assert.equal(v.cap, 6);
  assert.equal(v.animals.length, 4);
  for (const a of v.animals) {
    const o = s.farm.objects[a.id];
    const want = NOW < o.adultAt ? 'baby' : o.readyAt === null ? 'hungry' : o.readyAt <= NOW ? 'ready' : 'producing';
    assert.equal(a.status, want, a.id);
  }
  assert.ok(v.animals.some((a) => a.status === 'baby'));
  assert.equal(v.upgrade.coins, CONTENT.homes.get('coop').upgradeCost);
  // opened on an animal it shows the animal's home
  assert.equal(M.homeView(s, v.animals[0].id, NOW).id, ids.coop);
  // after a real upgrade the capacity grows by the content step
  const r = act(s, 'upgradeHome', { id: ids.coop }, { now: NOW });
  assert.ok(r.ok, r.code);
  assert.equal(M.homeView(s, ids.coop, NOW).cap, 6 + CONTENT.homes.get('coop').upgradeStep);
});

test('trees and land: sapling timers; only the next expansion can be bought; proofs count after opening', () => {
  const { state: s, ids } = farm();
  const t = M.treeView(s, ids.apple1, NOW);
  assert.equal(t.status, NOW < s.farm.objects[ids.apple1].matureAt ? 'sapling' : t.ripe ? 'ripe' : 'growing');
  assert.equal(t.yield, CONTENT.trees.get('apple_tree').yield);
  const land = M.landCards(s, { now: NOW, pid: 'p1' });
  assert.equal(land.filter((c) => c.isNext && !c.owned).length, 1);
  for (const c of land.filter((x) => !x.isNext && !x.owned)) assert.equal(c.code, 'LOCKED', c.id);
  const next = land.find((c) => c.isNext && !c.owned);
  assert.equal(next.opened, false);
  assert.ok(act(s, 'openExpansion', { expansion: next.id }, { now: NOW }).ok);
  assert.equal(M.landCards(s, { now: NOW, pid: 'p1' }).find((c) => c.id === next.id).opened, true);
});

test('every icon a panel names exists in the icon manifest (no fallback crates in the UI)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(import.meta.dirname, '../public/js/ui/panels');
  const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../public/assets/icons/manifest.json'), 'utf8')).ids;
  const GLYPHS = new Set(['market', 'barn', 'orders', 'journal', 'book', 'note', 'star', 'heart', 'coin', 'acorn']);   // shell dock glyphs
  const missing = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/icon\(\s*'([a-z_]+)'|icon: '([a-z_]+)'|\['([a-z_]+)', \d+, \d+, \d+\]/g)) {
      const id = m[1] ?? m[2] ?? m[3];
      if (!Object.hasOwn(manifest, id) && !GLYPHS.has(id)) missing.push(`${f}: ${id}`);
    }
  }
  assert.deepEqual(missing, []);
});
