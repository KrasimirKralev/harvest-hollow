#!/usr/bin/env node
// Writes the GENERATED content tables in shared/content/ from the designer's economy model, so the GDD, the
// simulator and the game can never disagree (GDD §4.3, §4.9 R1).
//
//   node tools/gen-content.mjs           write every generated table (idempotent: same input, same bytes)
//   node tools/gen-content.mjs --check   exit 1 and list the stale files instead of writing (used by tests)
//
// Sources, in order of authority:
//   1. `tools/economy-model.mjs --json`  every derived number (values, prices, XP, levels, quests ...)
//   2. `tools/economy-model.mjs --md`    the few model tables the JSON does not carry (decor, Acorn decor) and a
//                                        cross-check of every number this script re-derives (mastery thresholds,
//                                        slot costs, plot prices, item values): a mismatch aborts the run
//   3. `shared/content/authored.js`      hand-authored per-id data the model does not know (seasons, looks,
//                                        effects, land rectangles, proof tasks, the starter layout)
// Floating-point and `**` are fine here: this is a tool. The tables it writes hold integers (prices, ms, basis
// points) so the shared rules never do float math on them (review-m0 #8).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../shared/content/authored.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shared', 'content');
const CHECK = process.argv.includes('--check');

const model = (flag) => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'economy-model.mjs'), flag],
  { encoding: 'utf8', maxBuffer: 1 << 26 });
const M = JSON.parse(model('--json'));
const MD = model('--md');

const fail = (msg) => { console.error(`gen-content: ${msg}`); process.exit(1); };
const round = Math.round;
// The model's rounding (economy-model.mjs §1): 2 significant digits, multiples of 5 below 100.
const nice = (n) => {
  if (n < 20) return Math.max(1, round(n));
  if (n < 100) return round(n / 5) * 5;
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return round(n / p) * p;
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const MIN = 60_000;
const EL = (L) => M.levels[clamp(L, 1, 40) - 1].E;

// ---- milestones -------------------------------------------------------------------------------------------
// GDD §10: M1a = L1-12, M1b = L13-25, M2 = L26-40. Systems that the GDD schedules later override this per family
// (Grand decor is M2 whatever its level).
const RANK = { M1a: 0, M1b: 1, M2: 2, M3: 3 };
const msOfLevel = (L) => (L <= 12 ? 'M1a' : L <= 25 ? 'M1b' : 'M2');
const later = (...ms) => ms.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));

// ---- markdown tables of the model (for the JSON gaps and cross-checks) --------------------------------------
function mdTable(section) {
  const lines = MD.split('\n');
  const start = lines.findIndex((l) => l.trim() === `### ${section}`);
  if (start < 0) fail(`model --md has no section ${section}`);
  const rows = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('### '); i++) {
    const l = lines[i];
    if (!l.startsWith('|') || l.startsWith('|---')) continue;
    rows.push(l.slice(1, -1).split(' | ').map((c) => c.trim().replace(/^\|\s*/, '').replace(/\s*\|$/, '')));
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const num = (s) => Number(String(s).replace(/,/g, ''));
const unTick = (s) => s.replace(/`/g, '');

// R1 cross-check helper: every number this script derives must equal the model's printed table
const mismatches = [];
const same = (a, b, what) => { if (a !== b) mismatches.push(`${what}: derived ${a}, model ${b}`); };

// mastery thresholds (GDD §4.8): nice(base x clamp((60 / minutes)^0.35, 0.5, 2.5)), base 20/100/300/1000
const mastery = (minutes) => [20, 100, 300, 1000].map((b) => nice(b * clamp((60 / minutes) ** 0.35, 0.5, 2.5)));

// ---- crops -------------------------------------------------------------------------------------------------
const mdCrops = new Map(mdTable('crops').map((r) => [unTick(r.Id), r]));
const crops = M.crops.map((c) => {
  const th = mastery(c.min);
  same(th.join(' / '), mdCrops.get(c.id)['Mastery ★1/★2/★3/Gold'], `${c.id}.mastery`);
  if (!A.SEASONS[c.id]) fail(`no season for crop ${c.id}`);
  const growMs = c.min * MIN;
  return {
    id: c.id, name: c.name, m: msOfLevel(c.unlock), unlock: c.unlock, growMs, yield: c.yield, sell: c.v, seed: c.seed,
    xp: c.xp, classes: c.classes, season: A.SEASONS[c.id], hue: c.hue, archetype: c.arch, model: `crops/${c.id}`,
    // the harvest pays V x yield / XP_DIV in HUNDREDTHS of an XP, accrued per farm (wave-1 QA RC-13): Wheat's 0.5 XP
    // is no longer rounded up to 1, and Fresh (+10 %) pays on every crop; `xp` stays the model's display value
    xp100: round((100 * c.v * c.yield) / M.C.XP_DIV),
    stages: [0, 0.1, 0.4, 1], mastery: th,
    // GDD §3.1 rule 7: Fresh window = clamp(25 % of grow time, 5 min, 2 h) after ripening
    freshMs: clamp(round(growMs / 4), 5 * MIN, 120 * MIN),
    // GDD §3.1 rule 4: only crops of 30 min or more can be watered
    waterable: c.min >= 30,
  };
});

// ---- trees -------------------------------------------------------------------------------------------------
const trees = M.trees.map((t) => {
  const look = A.TREE_LOOKS[t.id] ?? fail(`no look for tree ${t.id}`);
  return {
    id: t.id, name: t.name, m: msOfLevel(t.unlock), kind: 'tree', layer: 'object', size: [2, 2], unlock: t.unlock,
    shop: true, cost: t.price, growthBp: round((M.C.TREE_GROWTH - 1) * 10_000), cap: { base: 4, per10Levels: 1,
      max: 8 },
    cycleMs: t.cycle * MIN, yield: t.yield, product: t.product, xp: t.xp, saplingCycles: 2, heirloomAt: 60,
    flowering: t.flowering, tool: look.tool, mastery: mastery(t.cycle), model: `trees/${t.id}`,
    shape: look.shape, hue: look.hue, leaf: look.leaf,
  };
});

// ---- feeds -------------------------------------------------------------------------------------------------
const feeds = M.feeds.map((f) => {
  const added = f.v * f.out - f.inVal;
  return {
    id: f.id, name: f.name, m: msOfLevel(f.unlock), building: 'feed_mill', unlock: f.unlock, ms: f.min * MIN,
    out: f.out, classes: f.inputs.map(([cls, qty]) => ({ cls, qty })), sell: f.v,
    // value added / 8, like every crafted good (GDD §4.5); feed adds little, so this is the 1-XP floor
    xp: Math.max(1, round(added / M.C.XP_DIV)),
    // GDD §3.3: the General Store sells emergency feed at 2.5 x V (never below what it is worth)
    storePrice: Math.ceil(f.v * M.C.STORE_MULT),
  };
});

// ---- animals and homes -------------------------------------------------------------------------------------
const animals = M.animals.map((a) => {
  const ex = A.ANIMAL_EXTRAS[a.id] ?? fail(`no extras for animal ${a.id}`);
  const colony = a.id === 'bee';
  return {
    id: a.id, name: a.name, m: msOfLevel(a.unlock), kind: 'animal', layer: 'none', homes: [a.home], unlock: a.unlock,
    shop: !colony,
    // bees come with their hive (one colony per Beehive): the hive is what is bought
    baby: colony ? null : a.baby, adult: colony ? null : a.adult, ...(a.first ? { first: { baby: a.first.baby, adult: a.first.adult } } : {}),
    growthBp: 1000, babyMs: a.babyMin * MIN,
    bottle: ex.bottle, feed: a.feed, feedQty: a.feedQty, cycleMs: a.cycle * MIN, product: a.product, out: a.out,
    xp: a.xp, prizedAt: a.prizedAt, premium: a.premium, premiumBp: 1000, mastery: mastery(a.cycle),
    sound: ex.sound, model: `animals/${a.id}`,
  };
});
const mdHomes = new Map(mdTable('homes').map((r) => [unTick(r.Id), r]));
const homes = M.homes.map((h) => {
  const species = M.animals.filter((a) => a.home === h.id);
  const a = species[0];
  same(h.cost, num(mdHomes.get(h.id).Cost), `${h.id}.cost`);
  const hive = h.id === 'beehive';
  return {
    id: h.id, name: h.name, m: msOfLevel(h.unlock), kind: 'home', layer: 'object', size: h.size, unlock: h.unlock,
    shop: true, cost: h.cost, species: species.map((s) => s.id),
    capacity: hive ? 1 : a.capStart, capacityMax: hive ? 1 : a.capMax,
    upgradeStep: hive ? 0 : 2, upgradeCost: hive ? null : h.upgrade,
    // GDD §3.4 rule 1: one home per species; Beehives are placed one by one: 2 at L13, +1 every 3 levels, max 8,
    // and the n-th costs x1.1^(n-1)
    count: hive ? { base: 2, from: 13, every: 3, max: 8 } : { base: 1, from: h.unlock, every: 0, max: 1 },
    growthBp: hive ? 1000 : 0, model: `homes/${h.id}`,
  };
});

// ---- buildings ---------------------------------------------------------------------------------------------
const mdBuildings = new Map(mdTable('buildings').map((r) => [unTick(r.Id), r]));
const buildings = M.buildings.map((b) => {
  const slotCosts = Array.from({ length: b.slotsMax - b.slotsStart }, (_, k) => nice(EL(b.unlock) * 0.25 * 1.6 ** k));
  same(slotCosts.join(' / '), mdBuildings.get(b.id)['Slot upgrade cost (k = 1, 2, 3 …)'], `${b.id}.slotCosts`);
  // §3.5 rule 7: the second copy costs 2 x the price; a building that was free costs half an hour of E at the
  // level the copy unlocks (the simulator's rule, tools/econ-sim.mjs)
  const secondCopy = b.second ? { at: b.second, cost: b.cost * 2 || nice(EL(b.second) * 0.5) } : null;
  const def = {
    id: b.id, name: b.name, m: msOfLevel(b.unlock), kind: 'building', layer: 'object', size: b.size, unlock: b.unlock,
    shop: true, cost: b.cost, slots: [b.slotsStart, b.slotsMax], slotCosts, secondCopy, model: `buildings/${b.id}`,
  };
  // §3.4 rule 8: the Compost Bin is also a collector: 1 point per animal collection, 3 Compost per 20 points,
  // at most 3 batches waiting (points stop while full)
  if (b.id === 'compost_bin') def.collector = { item: 'compost', every: 20, out: 3, maxBatches: 3 };
  return def;
});
const buildingOf = new Map(buildings.map((b) => [b.id, b]));

// ---- recipes -----------------------------------------------------------------------------------------------
const recipes = M.recipes.map((r) => {
  const solo = Math.max(1, round(r.added / M.C.XP_DIV));
  return {
    id: r.id, name: r.name, m: later(msOfLevel(r.unlock), buildingOf.get(r.building).m, A.MILESTONE_LATER[r.id] ?? 'M1a'),
    building: r.building,
    unlock: r.unlock, ms: r.min * MIN, out: r.out, inputs: r.inputs, tier: r.tier === 'DUET' ? 'duet' : r.tier,
    duet: r.duet, sell: r.v, xp: solo,
    // the model pays duets +25 % XP when cooked together (GDD §3.5 rule 6); solo slow-cook pays `xp`
    ...(r.duet ? { duetXp: r.xp } : {}),
    mastery: mastery(r.min),
  };
});

// ---- items (derived from every producing table) ------------------------------------------------------------
const CONSUMABLE = new Set(['compost', 'baby_bottle', 'fertilizer']);
const items = [];
const addItem = (it) => items.push(it);
for (const c of crops) {
  addItem({ id: c.id, name: c.name, m: c.m, kind: 'crop', unlock: c.unlock, source: c.id, sell: c.sell,
    classes: c.classes });
}
for (const t of trees) {
  const wood = t.product === 'wood';
  addItem({ id: t.product, name: M.trees.find((x) => x.id === t.id).productName, m: t.m,
    kind: wood ? 'material' : 'fruit', unlock: t.unlock, source: t.id, sell: M.trees.find((x) => x.id === t.id).v,
    classes: wood ? [] : ['produce'] });
}
for (const f of feeds) addItem({ id: f.id, name: f.name, m: f.m, kind: 'feed', unlock: f.unlock, source: f.id,
  sell: f.sell });
for (const a of M.animals) {
  addItem({ id: a.product, name: a.productName, m: msOfLevel(a.unlock), kind: 'animal', unlock: a.unlock, source: a.id,
    sell: a.v });
  addItem({ id: a.premium, name: a.premiumName, m: msOfLevel(a.unlock), kind: 'premium', unlock: a.unlock,
    source: a.id, sell: a.v * 4 });
}
for (const r of recipes) {
  // Compost also drops from the Compost Bin's collector from L8 (§3.4 rule 8), long before its Manure recipe (L25)
  const bin = r.id === 'compost' ? buildingOf.get('compost_bin') : null;
  addItem({ id: r.id, name: r.name, m: bin ? bin.m : r.m, kind: CONSUMABLE.has(r.id) ? 'consumable' : 'craft',
    tier: r.tier, unlock: bin ? bin.unlock : r.unlock, source: bin ? bin.id : r.id, sell: r.sell });
}
for (const it of items) {
  // Appendix A flags: feed and consumables are never sold or ordered; Wood, blue-ribbon (premium) goods and
  // duet goods never go into normal orders (barge/Fair and golden orders only); Wood keeps 20 by default
  const recipe = recipes.find((r) => r.id === it.id);
  it.sellable = it.kind !== 'feed' && it.kind !== 'consumable';
  it.orderable = it.sellable && it.kind !== 'premium' && it.kind !== 'material' && !recipe?.duet;
  it.giftable = it.sellable;
  it.keepDefault = it.id === 'wood' ? 20 : 0;
  if (it.kind === 'feed') it.storePrice = feeds.find((f) => f.id === it.id).storePrice;
  if (!it.classes) it.classes = [];
  if (it.kind === 'crop' || it.kind === 'fruit') if (!it.classes.includes('produce')) it.classes = [...it.classes,
    'produce'];
}
// R1: every value equals the model's value list
const mdValues = new Map(MD.split('### values')[1].trim().split(', ').map((kv) => { const [k,
  v] = kv.split('='); return [k, Number(v)]; }));
for (const it of items) same(it.sell, mdValues.get(it.id), `${it.id}.sell`);
same(items.length, mdValues.size, 'item count');

// ---- decor (coin, Acorn and Grand) -------------------------------------------------------------------------
const decor = [];
for (const r of mdTable('decor')) {
  const id = unTick(r.Id);
  const acorns = /Acorns$/.test(r.Cost) ? num(r.Cost.replace(' Acorns', '')) : 0;
  const unlock = num(r.Lvl);
  const beauty = Number(r.Beauty);
  const size = acorns ? A.ACORN_DECOR_SIZE[id] : r.Size.split('×').map(Number);
  if (!size) fail(`no size for decor ${id}`);
  if (!acorns) same(num(r.Cost), nice(Math.max(5, beauty * 40 * (1 + 0.04 * (unlock - 1)))), `${id}.cost`);
  const perTile = /\(per tile\)/.test(r.Decoration);
  decor.push({
    id, name: r.Decoration.replace(/\s*\(per tile\)/, ''), m: later(msOfLevel(unlock), A.MILESTONE_LATER[id] ?? 'M1a'),
    kind: 'decor',
    layer: A.GROUND_DECOR.includes(id) ? 'ground' : 'object', size, unlock, tier: acorns ? 'acorn' : 'coin', shop: true,
    cost: acorns ? 0 : num(r.Cost), acorns, beauty10: round(beauty * 10), perTile,
    effect: A.DECOR_EFFECTS[id] ?? fail(`no effect for decor ${id}`), text: r.Effect === '—' ? '' : r.Effect,
    model: `decor/${id}`,
  });
}
for (const g of M.grandDecor) {
  decor.push({
    id: g.id, name: g.name, m: 'M2', kind: 'decor', layer: 'object', size: g.size, unlock: g.unlock, tier: 'grand',
    shop: true, cost: g.coins, acorns: 0, beauty10: g.beauty * 10, perTile: false,
    effect: A.DECOR_EFFECTS[g.id] ?? fail(`no effect for decor ${g.id}`), text: g.bonus, model: `decor/${g.id}`,
  });
}

// ---- plots -------------------------------------------------------------------------------------------------
// GDD §3.10: the 16 starter plots are free; the n-th further plot costs nice(25 x 1.04^(n - 16)). One step per
// plot up to the largest plot cap there will ever be (164 at L40 with every expansion + 6 Hollow Meadow).
const PLOT_FREE = 16;
const PLOT_MAX = 170;
const plotPrice = (n) => nice(25 * 1.04 ** (n - PLOT_FREE));
const mdPlots = mdTable('plots')[0];
for (const [k, v] of Object.entries(mdPlots)) if (k !== 'Plot #') same(plotPrice(Number(k)), num(v), `plot ${k}`);
const prices = [];
for (let n = PLOT_FREE + 1; n <= PLOT_MAX; n++) {
  const p = plotPrice(n);
  if (!prices.length || prices.at(-1)[1] !== p) prices.push([n, p]);
}
const plots = [{ id: 'plot', name: 'Plot', m: 'M1a', kind: 'plot', layer: 'object', size: [1, 1], unlock: 1, shop: true,
  free: PLOT_FREE, maxCount: PLOT_MAX, prices, refundBp: 5000, model: 'plots/soil' }];

// ---- levels ------------------------------------------------------------------------------------------------
// GDD §3.10: plot cap = 16 + floor(1.5 (L - 1)) + 6 x expansions owned; the table carries the base, the model's
// `plots` column assumes every expansion bought on time (cross-checked here).
const plotCapBase = (L) => 16 + Math.floor(1.5 * (L - 1));
const levels = M.levels.map((l) => {
  same(plotCapBase(l.L) + 6 * M.expLevels.filter((x) => x <= l.L).length, l.plots, `plots(${l.L})`);
  return {
    level: l.L, xp: l.cumAt, xpToNext: l.toNext ?? (M.levels[38].toNext), E: l.E,
    // level-up rewards are paid on reaching a level (ruling L3): nobody reaches level 1
    coins: l.L === 1 ? 0 : l.coins, acorns: l.L === 1 ? 0 : l.acorns, plotCap: plotCapBase(l.L),
    // GDD §4.7: personal level thresholds = 0.6 x the farm table
    personalXp: round(l.cumAt * 0.6), minutes: l.minutes,
  };
});

// ---- expansions --------------------------------------------------------------------------------------------
const expansions = [{ id: 'home', name: 'Homestead', m: 'M1a', k: 0, unlock: 1, cost: 0, planks: 0, crates: 0,
  rects: [[16, 24, 24,
    16]], proof: [], reveals: 'The farmhouse, the barn and Grandma\'s old field', free: [], feature: null }];
for (const e of M.expansions) {
  const land = A.EXPANSION_LAND[e.id] ?? fail(`no land for expansion ${e.id}`);
  expansions.push({
    id: e.id, name: e.name, m: msOfLevel(e.level), k: e.k, unlock: e.level, cost: e.coins, planks: e.planks,
    crates: e.crates, rects: land.rects, proof: land.proof.map(([verb, ref, qty]) => ({ verb, ref, qty })),
    proofText: e.proof, reveals: e.reveals, free: land.free, feature: land.feature ?? null,
  });
}

// ---- barn --------------------------------------------------------------------------------------------------
const barn = M.barnUpgrades.map((b) => ({ n: b.n, m: msOfLevel(b.gate), unlock: b.gate, capacity: b.cap, cost: b.coins,
  planks: b.planks, crates: b.crates }));

// ---- quests ------------------------------------------------------------------------------------------------
const GIVER = { 'Grandma Hazel': 'hazel', "Grandma's Journal": 'journal', Mabel: 'mabel', Ollie: 'ollie',
  'Dr. Fern': 'fern', Juniper: 'juniper', 'Captain Reed': 'reed', 'Judge Pemberton': 'pemberton' };
const chainSort = (a, b) => a.chain.localeCompare(b.chain) || a.level - b.level
  || Number(a.id.slice(1)) - Number(b.id.slice(1));
const quests = M.quests.slice().sort(chainSort).map((q, i, all) => {
  const prev = all[i - 1];
  // GDD §10: M1a ships chains A-E up to L12; F (barge), G (Fair) and H (Together tab) follow with their systems
  const m = 'ABCDE'.includes(q.chain) ? msOfLevel(q.level) : later('M1b', msOfLevel(q.level));
  const flow = A.QUEST_FLOW[q.id] ?? {};      // authored graph edges and retro credit (first evening, GDD §7.4)
  return {
    id: q.id, chain: q.chain, giver: GIVER[q.giver] ?? fail(`unknown giver ${q.giver}`), m, level: q.level,
    after: flow.after ?? (prev && prev.chain === q.chain ? prev.id : null),
    ...(flow.alsoAfter ? { alsoAfter: [...flow.alsoAfter] } : {}), title: q.title,
    tasks: q.tasks.map(([verb, ref, qty], ti) => ({ verb, ref, qty,
      ...(flow.retro?.[ti] ? { retro: flow.retro[ti] } : {}) })),
    minutes: q.minutes, coins: q.coins, xp: q.xp, extraText: q.extra === '—' ? '' : q.extra,
  };
});

// ---- layout: starter and expansion debris ------------------------------------------------------------------
// Deterministic placement (fixed seed): debris never touches a structure, plot, fence, path, free object or a
// keep-clear strip (one tile of margin), and never sits on another piece.
const DEBRIS_SIZE = { weed: [1, 1], rock: [1, 1], stump: [1, 1], log: [2, 1], boulder: [2, 2], big_stump: [2, 2] };
const FOOT = { farmhouse: [4, 4], barn: [4, 4], well: [2, 2], mailbox: [1, 1], market_stand: [2, 2], order_board: [2,
  1] };
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sizeOfDef = (def) => FOOT[def] ?? trees.find((t) => t.id === def)?.size ?? decor.find((d) => d.id === def)?.size
  ?? homes.find((h) => h.id === def)?.size ?? fail(`unknown free object ${def}`);
function placeDebris(seed, rects, blocked, mix, { spread = true } = {}) {
  const rnd = rng32(seed);
  const taken = new Set();
  const key = (x, z) => `${x},${z}`;
  // one tile of margin to everything authored; between debris pieces only when `spread` (open land)
  let loose = false;
  const near = (x, z) => {
    if (taken.has(key(x, z))) return true;
    const apart = spread && !loose;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (blocked.has(key(x + dx, z + dz)) || (apart && taken.has(key(x + dx, z + dz)))) return true;
      }
    }
    return false;
  };
  const inRects = (x, z) => rects.some(([rx, rz, rw, rd]) => x >= rx && z >= rz && x < rx + rw && z < rz + rd);
  const out = [];
  // big pieces first so they find room; then the small ones
  for (const kind of ['big_stump', 'boulder', 'log', 'stump', 'rock', 'weed']) {
    for (let n = 0; n < (mix[kind] ?? 0); n++) {
      const [w, d] = DEBRIS_SIZE[kind];
      for (let tries = 0; ; tries++) {
        if (tries > 6000) fail(`no room for ${kind} in ${JSON.stringify(rects)}`);
        loose = !spread || tries > 3000;   // crowded land: let pieces touch rather than give up
        const [rx, rz, rw, rd] = rects[Math.floor(rnd() * rects.length)];
        const x = rx + Math.floor(rnd() * (rw - w + 1));
        const z = rz + Math.floor(rnd() * (rd - d + 1));
        const tiles = [];
        for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) tiles.push([x + dx, z + dz]);
        // stay one tile inside the land edge so pieces never hug the fence of the next parcel
        const inside = ([tx, tz]) => inRects(tx, tz) && (loose
          || (inRects(tx - 1, tz) && inRects(tx + 1, tz) && inRects(tx, tz - 1) && inRects(tx, tz + 1)));
        if (!tiles.every(inside)) continue;
        if (tiles.some(([tx, tz]) => near(tx, tz))) continue;
        for (const [tx, tz] of tiles) taken.add(key(tx, tz));
        out.push({ def: kind, x, z });
        break;
      }
    }
  }
  return out.sort((a, b) => a.z - b.z || a.x - b.x || a.def.localeCompare(b.def));
}
const blockRect = (set, x, z, w,
  d) => { for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) set.add(`${x + dx},${z + dz}`); };
const H = A.HOME_LAYOUT;
const homeBlocked = new Set();
for (const s of H.structures) blockRect(homeBlocked, s.x, s.z, ...FOOT[s.def]);
blockRect(homeBlocked, H.plots.x, H.plots.z, H.plots.w, H.plots.d);
blockRect(homeBlocked, H.fence.x, H.fence.z, H.fence.w, H.fence.d);
for (const r of [...H.paths, ...H.keepClear]) blockRect(homeBlocked, ...r);
for (const p of Object.values(A.SPAWN)) homeBlocked.add(`${Math.floor(p.x)},${Math.floor(p.z)}`);
// the Homestead is small and overgrown (GDD §2.3): pieces may touch each other and the land edge there
const homeDebris = placeDebris(20261002, expansions[0].rects, homeBlocked, A.HOME_DEBRIS_MIX, { spread: false });
const expansionDebris = {};
for (const e of expansions.slice(1)) {
  const blocked = new Set();
  for (const f of e.free) blockRect(blocked, f.x, f.z, ...sizeOfDef(f.def));
  // the M2 land is old woodland with one Big Stump (authored.js EXPANSION_DEBRIS_MIX_M2); earlier land is unchanged
  const mix = e.m === 'M2' ? A.EXPANSION_DEBRIS_MIX_M2 : A.EXPANSION_DEBRIS_MIX;
  expansionDebris[e.id] = placeDebris(20261002 + e.k, e.rects, blocked, mix);
}

if (mismatches.length) fail(`the model and its re-derivation disagree:\n  ${mismatches.join('\n  ')}`);

// ---- writing -----------------------------------------------------------------------------------------------
const msFmt = (v) => {
  if (v % 3_600_000 === 0 && v >= 3_600_000) return `h(${v / 3_600_000})`;
  if (v % 60_000 === 0) return `min(${v / 60_000})`;
  return String(v);
};
const keyFmt = (k) => (/^[a-zA-Z_$][\w$]*$/.test(k) ? k : `'${k}'`);
function lit(v, key = '') {
  if (v === null) return 'null';
  if (typeof v === 'number') {
    if (/Ms$/.test(key) || key === 'ms') return msFmt(v);
    return Number.isInteger(v) && Math.abs(v) >= 10_000 ? v.toLocaleString('en-US').replace(/,/g, '_') : String(v);
  }
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => lit(x)).join(', ')}]`;
  const parts = Object.entries(v).map(([k, x]) => `${keyFmt(k)}: ${lit(x, k)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}
// Greedy wrapping at WIDTH columns: one def per block, fields wrapped on boundaries; a field too long for a
// line (the plot price table, the model anchors) gets its elements wrapped on continuation lines.
const WIDTH = 118;
function wrapItems(items, indent) {
  const lines = [];
  let cur = indent;
  for (const [i, it] of items.entries()) {
    const piece = `${it}${i < items.length - 1 ? ',' : ''}`;
    if (cur.length + piece.length > WIDTH && cur.trim()) { lines.push(cur.trimEnd()); cur = indent; }
    cur += `${piece} `;
  }
  lines.push(cur.trimEnd());
  return lines;
}
function fieldLines(k, x, indent, last) {
  const tail = last ? '' : ',';
  const flat = `${indent}${keyFmt(k)}: ${lit(x, k)}${tail}`;
  if (flat.length <= WIDTH || (!Array.isArray(x) && (x === null || typeof x !== 'object'))) return [flat];
  const inner = Array.isArray(x) ? x.map((e) => lit(e)) : Object.entries(x).map(([kk,
    v]) => `${keyFmt(kk)}: ${lit(v, kk)}`);
  const [open, close] = Array.isArray(x) ? ['[', ']'] : ['{', '}'];
  return [`${indent}${keyFmt(k)}: ${open}`, ...wrapItems(inner, `${indent}  `), `${indent}${close}${tail}`];
}
function defLines(obj, indent = '  ') {
  const entries = Object.entries(obj);
  const lines = [];
  let cur = `${indent}{ `;
  for (const [i, [k, x]] of entries.entries()) {
    const last = i === entries.length - 1;
    const piece = `${keyFmt(k)}: ${lit(x, k)}${last ? ' },' : ','}`;
    if (`${indent}  ${piece}`.length > WIDTH) {
      // an over-long field gets its own lines
      if (cur.trim() !== '{') lines.push(cur.trimEnd());
      else lines.push(`${indent}{`);
      const fl = fieldLines(k, x, `${indent}  `, last);
      lines.push(...fl);
      if (last) lines.push(`${indent}},`);
      cur = `${indent}  `;
      continue;
    }
    if (cur.length + piece.length > WIDTH && cur.trim() !== '{') { lines.push(cur.trimEnd()); cur = `${indent}  `; }
    cur += `${piece} `;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.join('\n');
}
function wordWrap(text, prefix) {
  const lines = [];
  let cur = prefix;
  for (const w of text.split(' ')) {
    if (cur.length + w.length > WIDTH && cur.trim() !== prefix.trim()) { lines.push(cur.trimEnd()); cur = prefix; }
    cur += `${w} `;
  }
  lines.push(cur.trimEnd());
  return lines;
}
const HEADER = (what) => [
  '// GENERATED by tools/gen-content.mjs from tools/economy-model.mjs (+ shared/content/authored.js): do not edit.',
  ...wordWrap(what, '// '),
  '// Re-run `node tools/gen-content.mjs` after changing either; test/content.gen.test.js fails while stale.',
  '',
].join('\n');
const files = {};
const table = (file, what, name, rows, imports = '') => {
  const usesUnits = /\b(min|h)\(/.test(rows.map((r) => defLines(r)).join('\n'));
  const units = usesUnits ? "import { min, h } from './units.js';\n" : '';
  const body = rows.map((r) => defLines(r)).join('\n');
  files[file] = `${HEADER(what)}${units}${imports}\nexport const ${name} = [\n${body}\n];\n`;
};

table('crops.js',
  'Crops (GDD §3.1). sell = V per unit; seed = 40 % of the plot gross; xp per plot harvested; mastery = '
  + 'harvests for ★1/★2/★3/Gold; freshMs = Fresh window after ripening.', 'CROPS', crops);
table('trees.js', 'Trees (GDD §3.2). cost = first tree of the species; the n-th costs grow(cost, growthBp, n); cap per '
  + 'species = min(max, base + per10Levels x floor(L / 10)).', 'TREES', trees);
table('feeds.js', 'Feed (GDD §3.3). Inputs are ingredient CLASSES (cheapest live member first); feed is upkeep: never '
  + 'sold or ordered.', 'FEEDS', feeds);
table('animals.js', 'Animals (GDD §3.4): placeable defs with layer none that live in a home. baby/adult = price of the '
  + 'first; the n-th costs grow(price, growthBp, n).', 'ANIMALS', animals);
table('homes.js', 'Animal homes (GDD §3.4). capacity grows by upgradeStep per upgrade (upgradeCost each) up to '
  + 'capacityMax; count = how many of this home the farm may own at a level.', 'HOMES', homes);
table('buildings.js', 'Production buildings (GDD §3.5). slots = [start, max]; slotCosts[k-1] = price of the k-th extra '
  + 'slot; secondCopy = { at: level, cost } or null.', 'BUILDINGS', buildings);
table('recipes.js', 'Recipes (GDD §3.5). sell = V per unit of output; xp = per craft (solo); duetXp = cooked together; '
  + 'mastery = crafts for ★1/★2/★3/Gold.', 'RECIPES', recipes);
table('items.js', 'Items (GDD Appendix A, derived): every good a table produces. Item ids equal their producer id '
  + '(crop, recipe, feed) or product id (tree, animal).', 'ITEMS', items);
table('decor.js', 'Decorations (GDD §3.8): coin decor, Acorn decor (acorns > 0) and Grand decor (tier grand). '
  + 'beauty10 = beauty in tenths of a point; no decor grants XP.', 'DECOR', decor);
table('plots.js', 'Plots (GDD §3.10). The first `free` plots cost nothing; prices is a step table [[fromPlotNumber, '
  + 'coins], ...]; refundBp on removal.', 'PLOTS', plots);
table('levels.js', 'Farm levels (GDD §4.6). xp = cumulative XP at the level; plotCap = the base cap (add 6 per owned '
  + 'expansion: plotCapOf()); E = income target in coins per play-hour.', 'LEVELS', levels);
table('expansions.js', 'Land (GDD §2.2, §3.9). rects = [x, z, w, d] tiles; proof = tasks counted from the first '
  + 'opening of the card; free = objects that arrive with the land.', 'EXPANSIONS', expansions);
table('barn.js', 'Barn upgrades (GDD §3.6): capacity after the upgrade; cost in coins plus Planks and Wooden Crates.',
  'BARN_UPGRADES', barn);
table('quests.js',
  'Quests (GDD §5.3): rewards from E(level) x minutes / 60 x 0.5 coins and coins / 8 XP. Text lives in '
  + 'letters.js; structured extra rewards in quest-rewards.js.', 'QUESTS', quests);
files['layout.js'] = `${HEADER('Debris positions (GDD §2.3, §3.9), placed deterministically around the '
  + 'hand-authored layout.')}
/** Starter debris on the Homestead: { def, x, z } (min corner, rot 0). */
export const HOME_DEBRIS = [
${homeDebris.map((d) => `  ${lit(d)},`).join('\n')}
];

/** Debris that arrives with each expansion, by expansion id. */
export const EXPANSION_DEBRIS = {
${Object.entries(expansionDebris).map(([id,
  list]) => `  ${id}: [\n${list.map((d) => `    ${lit(d)},`).join('\n')}\n  ],`).join('\n')}
};
`;
files['model.js'] = `${HEADER('The model constants (GDD §4.3, §4.4, §4.6): what every price above was derived from. '
  + 'Read by tests (R1) and the report; the rules never use them.')}
export const MODEL = {
${Object.entries({ C: M.C, kAnchors: M.kAnchors, xAnchors: M.xAnchors, targetMin: M.targetMin, expLevels: M.expLevels,
    secondCopies: M.secondCopies }).flatMap(([k,
      v], i, all) => fieldLines(k, v, '  ', i === all.length - 1)).join('\n')}
};
`;

const stale = [];
for (const [name, src] of Object.entries(files)) {
  const file = path.join(OUT, name);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (old === src) continue;
  if (CHECK) stale.push(name);
  else fs.writeFileSync(file, src);
}
if (CHECK) {
  if (stale.length) { console.error(`gen-content: stale generated tables: ${stale.join(', ')}`); process.exit(1); }
  console.log(JSON.stringify({ ok: true, files: Object.keys(files).length }));
} else {
  console.log(JSON.stringify({ ok: true, written: Object.keys(files) }));
}
