#!/usr/bin/env node
// Harvest Hollow — economy & progression simulator (design tool, plain Node, no dependencies).
//
// It re-derives every price from the formulas of GDD v2 §4.3 and proves the result equals
// `tools/economy-model.mjs --json` (rule R1; expansions, barn upgrades, quests and Grand decor also come from the model),
// then plays the farm minute by minute with greedy-but-sensible policies: plant the best crop for the time until
// someone can harvest it, keep every building queue full (orders, quests, construction and untried recipes first),
// tend every animal, fill orders, townsfolk requests and barge crates, enter the Fair, buy what pays back, then fund
// Town Projects and Grand decor. `--checks` runs the GDD §4.9 acceptance checks (Appendix E of the GDD).
//
//   node tools/econ-sim.mjs                     static analysis + all policies, text report
//   node tools/econ-sim.mjs --md                markdown report
//   node tools/econ-sim.mjs --checks --md       acceptance checks (5 seeds x 4 policies), exit 1 on any FAIL
//   node tools/econ-sim.mjs --autocal           calibrate K/X anchors against the reference couple (casual policy)
//   node tools/econ-sim.mjs --calib             measured production / E and XP / (E/8) per level band
//   node tools/econ-sim.mjs --variant=noSinks --policy=casual --seed=3 --days=200
//
// Assumptions that the GDD leaves open are named ASSUMPTION in the code and listed in the report.
//
// Scope (wave-2 QA D1 / RC-03): this simulator plays its OWN simplified model of the M1b systems (Fair, barge,
// townsfolk, Town Projects) and passed 23/23 while the real rules missed L22-L25, the Fair, the barge and the village.
// The pacing gate for L1-25 is `node tools/real-sim.mjs --checks` (the real rules); econ-sim remains the model for
// L26-40 and the price contract (R1-R18). GDD Appendix E says the same.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARGV = process.argv.slice(2);
const arg = (name, def) => {
  const a = ARGV.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const flag = (name) => ARGV.includes(`--${name}`);

const DAY = 1440;
const WEEK = 7 * DAY;
const round = Math.round;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const nice = (n) => {
  if (n < 20) return Math.max(1, round(n));
  if (n < 100) return round(n / 5) * 5;
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return round(n / p) * p;
};
const fmt = (n) => (typeof n === 'number' ? round(n).toLocaleString('en-US') : String(n));
const hhmm = (min) => (min < 60 ? `${round(min)} min` : `${(min / 60).toFixed(1)} h`);
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------------------------------------------
// 1. Content: load the model's JSON, re-derive it from the formulas (so variants can change a formula)
// ---------------------------------------------------------------------------------------------------------------
const MODEL = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'economy-model.mjs'), '--json'],
  { encoding: 'utf8', maxBuffer: 1 << 26 }));

// GDD tables the simulator needs beyond the model's prices. Expansions (§3.9), barn upgrades (§3.6), quests (§5.3)
// and Grand decor come from `economy-model.mjs --json` (so they always match the GDD); only the free things an
// expansion reveals and the brush tools (§3.7) are listed here.
const EXP_FREE = { creekside: { tree: ['pine', 1] }, old_orchard: { tree: ['apple_tree', 2] }, bee_glade: { bee: 1 },
  riverbank: { rowBonus: 0.25 }, walnut_grove: { tree: ['walnut_tree', 2] } };
// §3.7 brush tools (they only change how much attention a stroke costs)
const TOOLS = [['big_can', 10, 4000], ['wide_sickle', 12, 6000], ['spreader', 14, 9000], ['grand_sickle', 26, 20000]];
// Quest extras the simulator models (gifts, Acorns, Compost). Quest tasks themselves come from the model.
const QUEST_EXTRA = { a3: { gift: { chicken: 2 } }, a6: { giftAtStart: { apple_tree: 1 } }, a8: { gift: { pine: 1 } },
  a11: { acorns: 5 }, b4: { acorns: 3 }, b9: { acorns: 3 }, c2: { compost: 6 }, e8: { acorns: 3 }, e10: { acorns: 5 }, f3: { acorns: 3 } };
const ORDER_SLOTS = [[35, 9], [28, 8], [20, 7], [14, 6], [9, 5], [5, 4], [2, 3]];

// Re-derivation of GDD §4.3 / §4.4 / §4.6 (a faithful port of economy-model.mjs §1–§6 so a variant can change it).
function derive(model, V = {}) {
  const C = { ...model.C, ...(V.C ?? {}) };
  const cropGross = (min, lvl) => (min <= 60 ? C.CROP_R * min ** C.SHORT_EXP
    : C.CROP_R * 60 ** C.SHORT_EXP * (min / 60) ** C.LONG_EXP) * (1 + C.CROP_LVL * (lvl - 1));
  const craftTime = (min, lvl) => C.CRAFT_K * min ** C.CRAFT_EXP * (1 + C.CRAFT_LVL * (lvl - 1));
  const val = new Map();
  const crops = model.crops.map((c) => {
    const gross = cropGross(c.min, c.unlock);
    const v = Math.max(1, round(gross / c.yield));
    const g = v * c.yield;
    val.set(c.id, v);
    return { ...c, v, gross: g, seed: Math.max(2, round(g * C.SEED_SHARE)), xp: Math.max(1, round(g / C.XP_DIV)),
      xpExact: (v * c.yield) / C.XP_DIV };
  });
  const trees = model.trees.map((t) => {
    const v = round((cropGross(t.cycle, t.unlock) * C.TREE_MULT) / t.yield);
    val.set(t.product, v);
    return { ...t, v, harvest: v * t.yield, xp: Math.max(1, round((v * t.yield) / C.XP_DIV)), price: nice(v * t.yield * 6) };
  });
  const members = (cls) => (cls === 'produce'
    ? [...crops.map((c) => c.id), ...trees.filter((t) => t.product !== 'wood').map((t) => t.product)]
    : crops.filter((c) => c.classes.includes(cls)).map((c) => c.id));
  const feeds = model.feeds.map((f) => {
    const inVal = f.inputs.reduce((s, [cls, q]) => s + Math.min(...members(cls).map((i) => val.get(i))) * q, 0);
    const v = round((inVal + C.FEED_K * Math.sqrt(f.min)) / f.out);
    val.set(f.id, v);
    return { ...f, v, inVal };
  });
  const animals = model.animals.map((a) => {
    const feedVal = a.feed ? val.get(a.feed) * a.feedQty : 0;
    const v = round((feedVal + C.ANIMAL_K * Math.sqrt(a.cycle)) / a.out);
    val.set(a.product, v);
    val.set(a.premium, v * 4);
    const net = v * a.out - feedVal;
    const baby = nice(net * 10);
    // the first bought copy repays in a.first.n collections (the model's FIRST_COPY, RC-28)
    const first = a.first ? { n: a.first.n, baby: nice(net * a.first.n), adult: nice(nice(net * a.first.n) * 1.6) } : null;
    return { ...a, v, net, feedVal, xp: Math.max(1, round((v * a.out) / C.XP_DIV)), baby, adult: nice(baby * 1.6), first };
  });
  const recipes = [];
  const pending = model.recipes.map((r) => ({ ...r, inputs: { ...r.inputs } }));
  let guard = 0;
  while (pending.length && guard++ < 5000) {
    const r = pending.shift();
    if (!Object.keys(r.inputs).every((i) => val.has(i))) { pending.push(r); continue; }
    const inVal = Object.entries(r.inputs).reduce((s, [i, q]) => s + val.get(i) * q, 0);
    const v = round((inVal + craftTime(r.min, r.unlock)) / r.out);
    val.set(r.id, v);
    const added = v * r.out - inVal;
    recipes.push({ ...r, inVal, v, added, xp: Math.max(1, round((added / C.XP_DIV) * (r.duet ? 1.25 : 1))) });
  }
  if (pending.length) throw new Error(`unresolved recipes ${pending.map((r) => r.id)}`);
  const bldRows = model.buildings;
  // E(L) — GDD §4.4, same as the model; the plot cap counts the expansions unlocked by L
  const expOwnedAt = (L) => model.expLevels.filter((x) => x <= L).length;
  const plotsCap = (L) => plotCapOf(L, expOwnedAt(L));
  // the owners' wave-4 additions (model.owner4) stay out of E(L), as in the model: the live level table never moves
  const inE = (x) => !(model.owner4 ?? []).includes(x.id);
  const E = (L) => {
    const sess = crops.filter((c) => inE(c) && c.unlock <= L && c.min <= 60);
    const perPlotHour = sess.reduce((s, c) => s + ((c.gross - c.seed) * 60) / c.min, 0) / sess.length;
    const away = crops.filter((c) => inE(c) && c.unlock <= L && c.min >= 240).map((c) => c.gross - c.seed);
    const awayPart = away.length ? (plotsCap(L) * Math.max(...away) * 0.6) / 2 : 0;
    const cropPart = plotsCap(L) * perPlotHour * 0.45 + awayPart;
    let animalPart = 0;
    for (const a of animals) {
      if (a.unlock > L || !inE(a)) continue;
      const n = a.id === 'bee' ? Math.min(8, 2 + Math.floor((L - a.unlock) / 3))
        : Math.min(a.capMax, a.capStart + Math.floor((L - a.unlock) / 2));
      animalPart += ((n * (a.net * 60)) / a.cycle) * 0.7;
    }
    let treePart = 0;
    for (const t of trees) if (t.unlock <= L && inE(t)) treePart += ((2 * t.harvest * Math.min(3, 1440 / t.cycle)) / 2) * 0.5;
    let craftPart = 0;
    for (const b of bldRows) {
      if (b.unlock > L) continue;
      const rs = recipes.filter((r) => inE(r) && r.building === b.id && r.unlock <= L).map((r) => (r.added * 60) / r.min).sort((x, y) => x - y);
      if (rs.length) craftPart += rs[Math.floor(rs.length / 2)] * 0.6;
    }
    return round((cropPart + animalPart + treePart + craftPart) * 1.2);
  };
  const lerp = (anchors, L) => {
    for (let i = 1; i < anchors.length; i++) {
      const [l0, k0] = anchors[i - 1], [l1, k1] = anchors[i];
      if (L <= l1) return k0 + ((k1 - k0) * (L - l0)) / (l1 - l0);
    }
    return anchors[anchors.length - 1][1];
  };
  const KA = V.K ?? model.kAnchors, XA = V.X ?? model.xAnchors;
  const tMin = V.targetMin ?? model.targetMin;
  const levels = [];
  for (let L = 1, cum = 0; L <= 40; L++) {
    const prev = levels[L - 2];
    const e = Math.max(nice(E(L) * lerp(KA, L)), prev?.E ?? 0);
    let toNext = L < 40 ? nice(((e / C.XP_DIV) * lerp(XA, L) * tMin[L - 1]) / 60) : null;
    if (toNext && prev && toNext <= prev.toNext) toNext = nice(prev.toNext * 1.04);
    levels.push({ L, E: e, toNext, cumAt: cum, plots: plotsCap(L), coins: nice(e * 0.15), acorns: L % 5 === 0 ? 5 : 2, target: tMin[L - 1] });
    if (toNext) cum += toNext;
  }
  const EL = (L) => levels[clamp(L, 1, 40) - 1].E;
  const FREE = new Set(['feed_mill', 'mill']);
  const buildings = bldRows.map((b) => ({ ...b, cost: FREE.has(b.id) ? 0 : nice(EL(b.unlock) * b.hrs),
    slotCost: (k) => nice(EL(b.unlock) * 0.25 * 1.6 ** (k - 1)) }));
  const homes = model.homes.map((h) => ({ ...h, cost: h.unlock <= 1 ? 0 : h.id === 'beehive'
    ? animals.find((a) => a.id === 'bee').baby : nice(EL(h.unlock) * 0.35), upgrade: nice(EL(h.unlock) * 0.2) }));
  return { C, crops, trees, feeds, animals, recipes, buildings, homes, levels, val, members };
}
function plotCapOf(L, expansions) { return 16 + Math.floor(1.5 * (L - 1)) + 6 * expansions; }

// Variants: `base` is the GDD as written (v2). Others are experiments used while tuning; they override formula
// constants (C), the calibration anchors (K, X) or rules.
const RULES = {
  secondCopies: MODEL.secondCopies,                                      // §3.5 rule 7 (M1)
  almanac: { paid: 4, hours: 0.02, from: 3 },                            // §5.8 (C1c); from L3 since wave-2 RC-01
  quickRefillMin: 5,                                                     // §5.2: the quick slot refills in 5 min (RC-01)
  masteryCap: [0, 0.1, 0.2, 0.2],                                        // §4.8 (C1d)
  townProjects: { from: 20, hours: 10, goodsHours: 2, buildDays: 1, acorns: 5 }, // §5.9 (H4)
  grandDecorAt: 8,                                                       // ASSUMPTION: Grand decor is bought above 8 E-hours of treasury
};
const VARIANTS = {
  base: { label: 'GDD v2 as written', d: {}, rules: RULES },
  noSinks: { label: 'GDD v2 without Town Projects and Grand decor', d: {}, rules: { ...RULES, townProjects: null, grandDecorAt: null } },
};

function index(d) {
  const X = { ...d };
  const EL = (L) => d.levels[clamp(L, 1, 40) - 1].E;
  // §3.9: expansion k costs E(level) x (0.6 + 0.2k) hours; §4.3: barn upgrade n = 0.3 h x 1.15^(n-1) at its gate;
  // §5.3: quest coins = E(L) x minutes / 60 x 0.5, XP = coins / 8 — so all three follow the derived E
  X.expansions = MODEL.expansions.map((e) => ({ ...e, coins: nice(EL(e.level) * (0.6 + 0.2 * e.k)), free: EXP_FREE[e.id] ?? {} }));
  X.barn = MODEL.barnUpgrades.map((b) => ({ ...b, level: b.gate, coins: nice(EL(b.gate) * 0.3 * 1.15 ** (b.n - 1)) }));
  X.quests = MODEL.quests.map((q) => { const coins = nice((EL(q.level) * q.minutes) / 60 * 0.5);
    return { ...q, coins, xp: nice(coins / d.C.XP_DIV), extra: QUEST_EXTRA[q.id] ?? {} }; });
  X.grandDecor = MODEL.grandDecor.map((g) => ({ ...g, coins: nice(EL(g.unlock) * g.hours) }));
  X.crop = new Map(d.crops.map((c) => [c.id, c]));
  X.tree = new Map(d.trees.map((t) => [t.id, t]));
  X.treeByProduct = new Map(d.trees.map((t) => [t.product, t]));
  X.animal = new Map(d.animals.map((a) => [a.id, a]));
  X.animalByProduct = new Map(d.animals.map((a) => [a.product, a]));
  X.animalByPremium = new Map(d.animals.map((a) => [a.premium, a]));
  X.feed = new Map(d.feeds.map((f) => [f.id, f]));
  X.recipe = new Map(d.recipes.map((r) => [r.id, r]));
  X.building = new Map(d.buildings.map((b) => [b.id, b]));
  X.home = new Map(d.homes.map((h) => [h.id, h]));
  X.recipesOf = new Map(d.buildings.map((b) => [b.id, d.recipes.filter((r) => r.building === b.id)]));
  // items
  X.item = new Map();
  for (const c of d.crops) X.item.set(c.id, { id: c.id, v: c.v, kind: 'crop', unlock: c.unlock });
  for (const t of d.trees) X.item.set(t.product, { id: t.product, v: t.v, kind: 'fruit', unlock: t.unlock });
  for (const f of d.feeds) X.item.set(f.id, { id: f.id, v: f.v, kind: 'feed', unlock: f.unlock });
  for (const a of d.animals) {
    X.item.set(a.product, { id: a.product, v: a.v, kind: 'animal', unlock: a.unlock });
    X.item.set(a.premium, { id: a.premium, v: a.v * 4, kind: 'premium', unlock: a.unlock });
  }
  for (const r of d.recipes) X.item.set(r.id, { id: r.id, v: r.v, kind: 'craft', tier: r.tier, unlock: r.unlock, duet: r.duet });
  // §3.3 / §4.3 / L2: feed, Compost and Baby Bottles are consumables — never sold, never ordered
  const CONSUMABLE = new Set(['compost', 'baby_bottle', 'fertilizer']);
  const MATERIALS = new Set(['wood']);   // Wood is a building material: never ordered (it is sold only as surplus)
  for (const it of X.item.values()) {
    it.sellable = it.kind !== 'feed' && !CONSUMABLE.has(it.id);
    // §3.9 (v2): Wood is a building material; orders, the barge and projects never ask for it
    it.orderable = !['feed', 'premium'].includes(it.kind) && !CONSUMABLE.has(it.id) && !it.duet && !MATERIALS.has(it.id);
  }
  // depth for demand propagation
  X.depth = new Map();
  const depth = (id) => {
    if (X.depth.has(id)) return X.depth.get(id);
    const r = X.recipe.get(id);
    const dd = r ? 1 + Math.max(...Object.keys(r.inputs).map(depth)) : X.feed.has(id) ? 1 : 0;
    X.depth.set(id, dd);
    return dd;
  };
  for (const id of X.item.keys()) depth(id);
  X.craftedByDepth = [...X.item.keys()].filter((i) => X.depth.get(i) > 0).sort((a, b) => X.depth.get(b) - X.depth.get(a));
  // mastery thresholds (§4.8)
  X.mThresh = (min) => [20, 100, 300, 1000].map((b) => nice(b * clamp((60 / min) ** 0.35, 0.5, 2.5)));
  return X;
}

// R1: the port reproduces the model exactly
function checkPort(X) {
  const bad = [];
  const cmp = (a, b, what) => { if (a !== b) bad.push(`${what}: model ${b} vs sim ${a}`); };
  for (const c of MODEL.crops) { const s = X.crop.get(c.id); cmp(s.v, c.v, `${c.id}.v`); cmp(s.seed, c.seed, `${c.id}.seed`); }
  for (const t of MODEL.trees) { const s = X.tree.get(t.id); cmp(s.v, t.v, `${t.id}.v`); cmp(s.price, t.price, `${t.id}.price`); }
  for (const a of MODEL.animals) {
    const s = X.animal.get(a.id); cmp(s.v, a.v, `${a.id}.v`); cmp(s.baby, a.baby, `${a.id}.baby`);
    if (a.first) cmp(s.first?.baby, a.first.baby, `${a.id}.first.baby`);
  }
  for (const r of MODEL.recipes) { const s = X.recipe.get(r.id); cmp(s.v, r.v, `${r.id}.v`); cmp(s.xp, r.xp, `${r.id}.xp`); }
  for (const l of MODEL.levels) { const s = X.levels[l.L - 1]; cmp(s.E, l.E, `E(${l.L})`); cmp(s.toNext, l.toNext, `xp(${l.L})`); cmp(s.plots, l.plots, `plots(${l.L})`); }
  for (const b of MODEL.buildings) cmp(X.building.get(b.id).cost, b.cost, `${b.id}.cost`);
  MODEL.expansions.forEach((e, i) => cmp(X.expansions[i].coins, e.coins, `${e.id}.coins`));
  MODEL.barnUpgrades.forEach((b, i) => cmp(X.barn[i].coins, b.coins, `barn${b.n}.coins`));
  MODEL.quests.forEach((q, i) => cmp(X.quests[i].coins, q.coins, `${q.id}.coins`));
  return bad;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Policies (play schedules). Sessions are wall-clock; `players` = how many are at the keyboard.
// ---------------------------------------------------------------------------------------------------------------
const POLICIES = {
  casual: { label: 'Couple, 3 evenings a week × 60 min (Mon, Wed, Sat)', days: [0, 2, 5],
    sessions: [{ at: 20 * 60, len: 60, players: 2 }] },
  target: { label: 'Couple, GDD pacing target: 90 min together every evening + a 10-min morning check-in',
    sessions: [{ at: 8 * 60, len: 10, players: 1 }, { at: 20 * 60, len: 90, players: 2 }] },
  heavy: { label: 'Heavy couple: morning 20 + lunch 15 + evening 150 + bedtime 15 min, daily (3.3 h)',
    sessions: [{ at: 7 * 60 + 30, len: 20, players: 1 }, { at: 12 * 60 + 30, len: 15, players: 1 },
      { at: 19 * 60, len: 150, players: 2 }, { at: 22 * 60 + 45, len: 15, players: 2 }] },
  solo: { label: 'Solo player, 60 min every evening (partner absent)', sessions: [{ at: 20 * 60, len: 60, players: 1 }] },
};

// Attention model: seconds of productive input per player per minute, and the cost of each action.
const ATTN = 30;
// A sensible couple sweeps the board every SWEEP minutes (harvest, tend, collect, re-queue, fill), not every minute.
// --sweep=1 is the "grinder" who replants 1-minute Wheat every minute.
const SWEEP = Number(arg('sweep', 3));
const COST = { harvest: [0.5, 0.25, 0.12], plant: [0.5, 0.25], water: 0.4, compost: 0.5, tend: 0.4, pet: 0.6,
  tree: 1.0, collect: 1.5, queue: 2.0, order: 4.0, sell: 3.0, buy: 8.0 };
const PAYBACK_DAYS = 21;       // a sensible player buys extra capacity only if it repays within three weeks
const ALMANAC_PER_H = 6;       // ASSUMPTION: micro-tasks completed per player per active hour (they overlap normal play)
const BUFFER_UNITS = 3;        // units of each crafted/animal/fruit good kept on hand for orders
const PATH_OVERHEAD = 1.15;
const POST_L40 = 12;            // sessions simulated after reaching L40 (Legacy) so late quests can complete
const TREE_GROWTH = MODEL.C.TREE_GROWTH;                       // n-th tree of a species x 1.45^(n-1)
const treeCap = (L) => Math.min(8, 4 + Math.floor(L / 10));   // §3.2 (v2, M8)
const FAIR_W_HOURS = 0.3;       // §5.6: weekly Fair target W = E x 0.3 / 100 points (one evening's crafted goods reaches Gold)
const FAIR_PAY = 1.5;           // §5.6: a medal pays 1.5 x the value of its point threshold
const MARKET_WEEK = [[0.75, 0.25, 1], [1.5, 0.4, 2], [2.5, 0.6, 3]]; // [order value in E-hours, coins in E-hours, Acorns]    // ASSUMPTION: 15 % of placed footprint goes to paths and access
const FIXED_TILES = 42;        // farmhouse 16, barn 16, market stand 4, order board 2, well 4 (§2.3)

// ---------------------------------------------------------------------------------------------------------------
// 3. The farm
// ---------------------------------------------------------------------------------------------------------------
class Farm {
  constructor(X, policyName, seed, days, rules) {
    this.X = X;
    this.P = POLICIES[policyName];
    this.policyName = policyName;
    this.rules = rules;
    this.rand = mulberry32(seed);
    this.sessions = [];
    for (let d = 0; d < days; d++) {
      if (this.P.days && !this.P.days.includes(d % 7)) continue;
      for (const s of this.P.sessions) this.sessions.push({ start: d * DAY + s.at, len: s.len, players: s.players, day: d });
    }
    const perWeek = this.sessions.filter((s) => s.start < WEEK);
    this.sessPerDay = perWeek.length / 7;
    this.meanLen = perWeek.reduce((s, x) => s + x.len, 0) / perWeek.length;
    this.coins = 300; this.acorns = 5; this.xp = 0; this.level = 1;
    this.inv = new Map(); this.cap = 200; this.barnN = 0;
    this.plots = Array.from({ length: 16 }, () => ({ crop: null, readyAt: 0, compost: false }));
    this.trees = []; this.animals = new Map(); this.homes = new Map(); this.bld = new Map();
    this.tools = new Set(); this.expansions = 0;
    this.orders = []; this.recentOrderItems = []; this.questsDone = new Set(); this.questActive = new Map();
    this.mastery = new Map(); this.compostPoints = 0;
    this.day = -1; this.week = -1; this.fair = null; this.barge = null;
    this.goldenUntil = -1; this.goldenDay = -1; this.comboToday = 0; this.almanacToday = 0;
    this.demand = { day: -1, raw: null, craft: null, sold: new Map() };
    this.playMin = 0;
    this.S = {
      coinsBy: new Map(), xpBy: new Map(), spentBy: new Map(), sold: new Map(), made: new Map(),
      levelAt: [{ L: 1, t: 0, play: 0 }], snaps: [], buys: [], waits: [],
      orders: { gen: 0, filled: 0, discarded: 0, invalid: 0, fillTimes: [], fillableAtGen: 0, simple: 0, unfilledAge: [], golden: 0, duet: 0 },
      townsfolk: { offered: 0, filled: 0 }, projects: [], grand: 0, debrisRegrown: 0, lateMin: 0, richMin: 0, matBlockedMin: 0,
      barge: { weeks: 0, crates: 0, loaded: 0, full: 0, rows: 0 },
      fair: { weeks: 0, medals: {}, entries: 0, entryCost: 0, reward: 0, pointsPrized: 0 },
      idlePlotMin: 0, plotMin: 0, bldIdleMin: 0, bldMin: 0, hungryMin: 0, animalMin: 0, feedBought: 0,
      feedMillBusy: 0, feedMillMin: 0, overflowMin: 0, blocked: 0, maxFill: 0, attnShort: 0, activeMin: 0,
      questBlockedMin: 0, emergencyFeedCoins: 0, decorSpend: 0, perLevel: {}, planted: new Map(), overflowInv: new Map(),
    };
    this.lastMade = new Map(); this.weekPlay = 0;
    this.soldUnits = new Map(); this.composted = 0; this.slotsBought = 0; this.delivered = new Map(); this.everOrdered = new Set();
    this.project = null; this.projectsDone = 0; this.grandN = 0; this.townsfolk = []; this.lastGoldenSlot = -1;
    this.lastGoldenSession = -Infinity; this.lastSessEnd = 0; this.weekOrderValue = 0; this.fairSilverPlus = 0; this.hamperEntries = 0;
    this.now = 0; this.sessStart = 0; this.reserve = 0; this.binTray = 0; this.debrisDone = false; this.lastDebris = 0; this.decorSpent = 0;
  }

  // ---- small helpers
  E() { return this.X.levels[this.level - 1].E; }
  plotCap() { return plotCapOf(this.level, this.expansions); }
  stock(id) { return this.inv.get(id) ?? 0; }
  total() { let n = 0; for (const q of this.inv.values()) n += q; return n; }
  bump(map, k, q) { map.set(k, (map.get(k) ?? 0) + q); if (map === this.S.made) this.lastMade.set(k, this.now); }
  addInv(id, q) {
    const room = Math.max(0, 2 * this.cap - this.total());
    const got = Math.min(q, room);
    if (got < q) this.S.blocked += q - got;
    if (got > 0) this.inv.set(id, this.stock(id) + got);
    return got;
  }
  take(id, q) { const s = this.stock(id); if (s < q) return false; if (s === q) this.inv.delete(id); else this.inv.set(id, s - q); return true; }
  acc() { const a = this.S.perLevel[this.level] ??= { coins: 0, prod: 0, xp: 0, min: 0 }; return a; }
  gainCoins(c, src) {
    this.coins += c; this.bump(this.S.coinsBy, src, c);
    const a = this.acc(); a.coins += c; if (['market', 'orders', 'barge', 'townsfolk'].includes(src)) a.prod += c;
  }
  spend(c, what) { this.coins -= c; this.bump(this.S.spentBy, what, c); }
  gainXp(x, src) {
    this.xp += x; this.bump(this.S.xpBy, src, x); this.acc().xp += x;
    const L = this.X.levels;
    while (this.level < 40 && this.xp >= L[this.level].cumAt) this.levelUp();
  }
  levelUp() {
    this.level++;
    const row = this.X.levels[this.level - 1];
    this.gainCoins(row.coins, 'level-up');
    this.acorns += row.acorns;
    this.S.levelAt.push({ L: this.level, t: this.now, play: this.playMin + (this.now - this.sessStart) });
    // Level-up Bloom (§3.1 rule 10; changed by the owner 2026-10-04: a level-up finishes everything growing): every
    // planted crop is ripe, every tree's fruit is ripe (a sapling becomes a mature tree with its first fruit), every
    // baby animal is grown and every animal product on its way waits to be collected. Production-building queues are
    // not touched (shared/rules/actions/boosts.js bloom). In a multi-level jump the first level finishes everything.
    const now = this.now;
    const finish = (at) => (at != null && at > now ? now : at);
    for (const p of this.plots) if (p.crop) p.readyAt = finish(p.readyAt);
    for (const t of this.trees) { t.matureAt = finish(t.matureAt); t.readyAt = finish(t.readyAt); }
    for (const list of this.animals.values()) for (const a of list) {
      a.adultAt = finish(a.adultAt);
      if (a.readyAt != null) a.readyAt = finish(a.readyAt);
    }
  }
  mStars(key) { return this.mastery.get(key)?.stars ?? 0; }
  masteryTick(key, min, xpEach, vEach) {
    const m = this.mastery.get(key) ?? { n: 0, stars: 0 };
    m.n++;
    const th = this.X.mThresh(min);
    while (m.stars < 3 && m.n >= th[m.stars]) {
      m.stars++;
      const mult = m.stars === 1 ? 10 : m.stars === 2 ? 20 : 0;
      let coins = mult * vEach;
      let xp = m.stars === 3 ? 40 * xpEach : mult * xpEach;
      if (this.rules.masteryCap) {
        // fix: a star is worth at most k hours of E in coins and XP
        const h = this.rules.masteryCap[m.stars];
        coins = Math.min(coins, this.E() * h);
        xp = Math.min(xp, (this.E() * h) / 8);
      }
      if (coins) this.gainCoins(coins, 'mastery');
      this.gainXp(xp, 'mastery');
      if (m.stars === 3) this.acorns += 1;
    }
    this.mastery.set(key, m);
  }
  spendAttn(sec) { if (this.attn < sec) { this.attnHit = true; return false; } this.attn -= sec; return true; }
  // earliest minute >= T at which somebody is on the farm
  nextPresence(T) {
    let lo = this.si, hi = this.sessions.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; const s = this.sessions[mid]; if (s.start + s.len >= T) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
    if (ans < 0) return Infinity;
    const s = this.sessions[ans];
    if (s.start > T) return s.start;
    return Math.min(s.start + s.len, s.start + Math.ceil((T - s.start) / SWEEP - 1e-9) * SWEEP);
  }
  nextSessionStart() { const s = this.sessions[this.si + 1]; return s ? s.start : Infinity; }
  couple() { return this.players >= 2; }
  timeMult(baseMin, kind) {
    // reductions add, floor 50 % (§4.8)
    let red = 0;
    // v2 (C2): anyone waters at the full base effect; a partner's extra tend adds 5 points (no reason to wait)
    if (kind === 'crop' && baseMin >= 30) red += 0.15 + (this.couple() ? 0.05 : 0);
    if (kind === 'tree') red += 0.2 + (this.couple() ? 0.05 : 0);
    if (this.now < this.goldenUntil) red += 0.1;
    return Math.max(0.5, 1 - red);
  }

  // ---- unlock / ownership queries
  unlocked(lvl) { return lvl <= this.level; }
  adults(species) { return (this.animals.get(species) ?? []).filter((a) => a.adultAt <= this.now); }
  matureTrees(species) { return this.trees.filter((t) => t.species === species && t.matureAt <= this.now); }
  producible(id, memo = new Map()) {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, false);
    const X = this.X;
    let ok = false;
    if (X.crop.has(id)) ok = this.unlocked(X.crop.get(id).unlock);
    else if (X.treeByProduct.has(id)) ok = this.matureTrees(X.treeByProduct.get(id).id).length > 0;
    else if (X.animalByProduct.has(id)) ok = this.adults(X.animalByProduct.get(id).id).length > 0;
    else if (X.feed.has(id)) ok = this.bld.has('feed_mill') && this.unlocked(X.feed.get(id).unlock);
    else if (X.recipe.has(id)) {
      const r = X.recipe.get(id);
      ok = this.bld.has(r.building) && this.unlocked(r.unlock) && Object.keys(r.inputs).every((i) => this.producible(i, memo));
    }
    memo.set(id, ok);
    return ok;
  }
  // GDD §5.2 literal pool rule: "producer exists" (crafted: building built) — weaker than G-VALID
  producerExists(id) {
    const X = this.X;
    if (X.crop.has(id)) return true;
    if (X.treeByProduct.has(id)) return this.matureTrees(X.treeByProduct.get(id).id).length > 0;
    if (X.animalByProduct.has(id)) return this.adults(X.animalByProduct.get(id).id).length > 0;
    if (X.recipe.has(id)) return this.bld.has(X.recipe.get(id).building);
    return false;
  }

  // ---- prices
  mKey(id) {
    const X = this.X;
    if (X.treeByProduct.has(id)) return X.treeByProduct.get(id).id;
    if (X.animalByProduct.has(id)) return X.animalByProduct.get(id).id;
    return id;
  }
  price(id) {
    const it = this.X.item.get(id);
    let p = it.v;
    if (it.kind !== 'premium' && this.mStars(this.mKey(id)) >= 1) p *= 1.05;
    return p;
  }
  sell(id, q, src = 'market') {
    if (q <= 0 || !this.take(id, q)) return 0;
    let coins = this.price(id) * q;
    if (this.level >= 11 && (id === this.demand.raw || id === this.demand.craft)) {
      const used = this.demand.sold.get(id) ?? 0;
      const bonusUnits = Math.min(q, Math.max(0, 50 - used));
      this.demand.sold.set(id, used + bonusUnits);
      coins += this.price(id) * 0.5 * bonusUnits;
    }
    this.gainCoins(coins, src);
    this.bump(this.S.sold, id, coins);
    this.bump(this.soldUnits, id, q);
    return coins;
  }

  // ---- calendar events
  calendar(now) {
    const d = Math.floor(now / DAY);
    if (d !== this.day) {
      this.day = d; this.comboToday = 0; this.almanacToday = 0; this.freeRefill = true; this.giftDone = false;
      this.dailyGiftDone = false;
      const pool = [...this.X.item.values()].filter((i) => i.sellable && i.unlock <= this.level - 1 && i.kind !== 'premium');
      const raws = pool.filter((i) => ['crop', 'fruit', 'animal'].includes(i.kind));
      const crafts = pool.filter((i) => i.kind === 'craft');
      this.demand = { day: d, raw: raws.length ? raws[Math.floor(this.rand() * raws.length)].id : null,
        craft: crafts.length ? crafts[Math.floor(this.rand() * crafts.length)].id : null, sold: new Map() };
    }
    const w = Math.floor(now / WEEK);
    if (w !== this.week) {
      if (this.fair) this.finishFair();
      if (this.barge) this.finishBarge();
      if (this.week >= 0 && this.weekE != null) this.marketWeek();
      this.lastWeekPlay = this.weekPlay; this.weekPlay = 0;
      this.week = w; this.weekOrderValue = 0; this.weekE = this.E();
      // §5.6 (v2): the weekly target is sized for the reference week (3 evenings): W = E x 0.75 / 100 points
      this.fair = this.level >= 14 ? { W: nice((this.E() * FAIR_W_HOURS) / 100), points: 0, entered: new Map(), E: this.E() } : null;
      this.barge = null; this.bargeDue = this.level >= 15 ? w * WEEK + 360 : Infinity;
      if (this.level >= 21) this.makeTownsfolk();
    }
    if (!this.barge && now >= this.bargeDue && now < w * WEEK + 6 * DAY + 1200) this.makeBarge();
    if (this.fair && now >= w * WEEK + 6 * DAY + 1200) this.finishFair();
    if (this.barge && now >= w * WEEK + 6 * DAY + 1200) this.finishBarge();
  }
  // §5.2 (v2, X2): Mabel's weekly meter counts the VALUE of filled orders (simple orders count 25 %), in hours of
  // Monday's E; three chests
  marketWeek() {
    const h = this.weekOrderValue / this.weekE;
    for (const [need, pay, acorns] of MARKET_WEEK) if (h >= need) { this.gainCoins(this.weekE * pay, 'weekly meter'); this.acorns += acorns; }
  }

  // ---- crops
  cropRate(c, now, boosted) {
    const g = c.min * this.timeMult(c.min, 'crop') * (this.mStars(c.id) >= 2 ? 0.9 : 1);
    const at = this.nextPresence(now + g);
    const units = c.yield + 0.05 + (this.mStars(c.id) >= 3 ? 0.15 : 0);
    const val = c.v * (boosted ? 1.5 : 1) * (this.mStars(c.id) >= 1 ? 1.05 : 1);
    return { rate: (units * val - c.seed) / Math.max(1, at - now), g };
  }
  plantAll(now, need) {
    const empty = this.plots.filter((p) => !p.crop);
    if (!empty.length) return;
    const crops = this.X.crops.filter((c) => c.unlock <= this.level);
    const deficit = new Map();
    for (const c of crops) {
      let growing = 0;
      for (const p of this.plots) if (p.crop === c.id) growing += c.yield;
      const d = (need.get(c.id) ?? 0) - this.stock(c.id) - growing;
      if (d > 0) deficit.set(c.id, d);
    }
    const plain = crops.map((c) => ({ c, ...this.cropRate(c, now, false) }));
    const boost = new Map(crops.filter((c) => deficit.has(c.id)).map((c) => [c.id, this.cropRate(c, now, true)]));
    const bestPlain = plain.reduce((a, b) => (b.rate > a.rate ? b : a));
    const maxV = Math.max(...crops.map((c) => c.v * c.yield));
    const costP = COST.plant[this.tools.has('spreader') ? 1 : 0];
    for (const p of empty) {
      let pick = bestPlain;
      // a crop that an order, a crate or a running recipe chain is waiting for is planted first (best of those)
      let needed = null;
      for (const [id, br] of boost) {
        if ((deficit.get(id) ?? 0) > 0 && br.rate > 0 && (!needed || br.rate > needed.rate)) needed = { c: this.X.crop.get(id), ...br };
      }
      if (needed) pick = needed;
      const c = pick.c;
      if (this.coins < c.seed) { this.sellSurplus(need, true); if (this.coins < c.seed) break; }
      if (!this.spendAttn(costP)) break;
      this.spend(c.seed, 'seeds');
      p.crop = c.id; p.readyAt = now + pick.g; p.planted = now;
      this.bump(this.S.planted, c.id, 1);
      if (c.min >= 30 && this.level < 10) this.spendAttn(COST.water);
      // compost on the most valuable plantings (>= half the best plot value)
      p.compost = false;
      // Fertilizer (owner wish #2, content GROWTH.fertilizer): +2 units and -25 % of the grow time; worth it on the
      // long "away" crops, so the couple spends it there
      if (this.level >= 10 && this.stock('fertilizer') > 0 && c.min >= 240) {
        this.take('fertilizer', 1); p.compost = 'fert'; p.readyAt = now + pick.g * 0.75; this.composted++; this.spendAttn(COST.compost);
      } else if (this.level >= 8 && this.stock('compost') > 0 && c.v * c.yield >= 0.5 * maxV) { this.take('compost', 1); p.compost = true; this.composted++; this.spendAttn(COST.compost); }
      if (deficit.has(c.id)) deficit.set(c.id, deficit.get(c.id) - c.yield);
    }
  }
  harvestAll(now) {
    const cost = COST.harvest[this.tools.has('grand_sickle') ? 2 : this.tools.has('wide_sickle') ? 1 : 0];
    for (const p of this.plots) {
      if (!p.crop || p.readyAt > now) continue;
      const c = this.X.crop.get(p.crop);
      let units = c.yield;
      const r = this.rand();
      if (r < 0.05 + (this.level >= 13 && this.hasBees() ? 0.05 : 0)) units++;
      if (this.mStars(c.id) >= 3 && this.rand() < 0.15) units++;
      let prized = false;
      if (p.compost === 'fert') units++;
      if (p.compost) { units++; if (this.rand() < 0.1 + 0.02 * this.mStars(c.id)) { units++; prized = true; } }
      if (2 * this.cap - this.total() < units) { this.S.blocked++; continue; }
      if (!this.spendAttn(cost)) break;
      this.addInv(c.id, units);
      this.bump(this.S.made, c.id, units);
      const fresh = now - p.readyAt <= clamp(c.min * 0.25, 5, 120);
      // the game pays crop XP in hundredths (wave-1 QA RC-13): V x yield / XP_DIV per plot, no floor of 1
      this.gainXp(c.xpExact * (fresh ? 1.1 : 1) * this.comboMult(), 'harvest');
      this.masteryTick(c.id, c.min, c.xp, c.v);
      if (prized) { this.S.fair.pointsPrized++; this.prizedCount = (this.prizedCount ?? 0) + 1; if (this.fair) this.fair.points += round(c.gross / 10) / 10; }
      p.crop = null; p.compost = false;
    }
  }
  hasBees() { return (this.animals.get('bee') ?? []).length > 0; }
  comboMult() {
    if (!this.couple() || this.comboToday >= 300) return 1;
    this.comboToday++;
    return 1.1;
  }

  // ---- trees
  treesTick(now) {
    for (const t of this.trees) {
      if (t.matureAt > now || t.readyAt > now) continue;
      if (!this.spendAttn(COST.tree)) return;
      const def = this.X.tree.get(t.species);
      let units = def.yield + (t.harvests >= 60 ? 1 : 0);
      if (this.level >= 8 && this.rand() < 0.05) units++;
      if (this.mStars(def.id) >= 3 && this.rand() < 0.15) units++;
      if (2 * this.cap - this.total() < units) { this.S.blocked++; continue; }
      this.addInv(def.product, units);
      this.bump(this.S.made, def.product, units);
      this.gainXp(def.xp * this.comboMult(), 'trees');
      this.masteryTick(def.id, def.cycle, def.xp, def.v);
      t.harvests++; t.cycleStart = now;
      t.readyAt = now + def.cycle * this.timeMult(def.cycle, 'tree') * (this.mStars(def.id) >= 2 ? 0.9 : 1);
    }
  }

  // ---- animals
  animalsTick(now) {
    for (const [sp, list] of this.animals) {
      const def = this.X.animal.get(sp);
      for (const a of list) {
        if (a.adultAt > now) continue;
        if (a.readyAt != null && a.readyAt <= now) {
          let units = def.out;
          const petBonus = this.couple() ? 0.2 : 0.1;
          if (this.rand() < petBonus) units += def.out;
          if (this.mStars(sp) >= 3 && this.rand() < 0.15) units += def.out;
          const premium = a.n >= def.prizedAt && this.rand() < 0.1;
          if (2 * this.cap - this.total() < units + 1) { this.S.blocked++; continue; }
          if (!this.spendAttn(COST.tend + COST.pet * this.players)) return;
          this.addInv(def.product, units);
          this.bump(this.S.made, def.product, units);
          if (premium) { this.addInv(def.premium, 1); this.bump(this.S.made, def.premium, 1); }
          this.gainXp(def.xp * this.comboMult(), 'animals');
          this.masteryTick(sp, def.cycle, def.xp, def.v);
          a.n++; a.readyAt = null;
          if (this.level >= 8 && this.bld.has('compost_bin')) {
            if (this.binTray < 9) { this.compostPoints++; if (this.compostPoints >= 20) { this.compostPoints = 0; this.binTray += 3; } }
          }
        }
        if (a.readyAt == null) {
          if (def.feed && !this.take(def.feed, def.feedQty)) {
            // emergency feed from the General Store at 2.5 x V when the mill cannot keep up (not while in overflow)
            const cost = this.X.item.get(def.feed).v * 2.5 * def.feedQty;
            if (this.total() <= this.cap && this.coins > cost + this.reserve && def.v * def.out > cost * 1.2) {
              this.spend(cost, 'emergency feed'); this.S.emergencyFeedCoins += cost; this.S.feedBought += def.feedQty;
            } else continue;
          }
          a.fedAt = now;
          a.readyAt = now + def.cycle * this.timeMult(def.cycle, 'animal') * (this.mStars(sp) >= 2 ? 0.9 : 1);
        }
      }
    }
    // empty the compost bin
    if (this.binTray) { const got = this.addInv('compost', this.binTray); this.bump(this.S.made, 'compost', got); this.binTray -= got; }
  }

  // ---- buildings
  collectBuildings(now) {
    for (const b of this.bld.values()) {
      let any = false;
      b.queue.sort((x, y) => x.end - y.end);
      while (b.queue.length && b.queue[0].end <= now) {
        const q = b.queue[0];
        const r = this.X.recipe.get(q.rid) ?? this.X.feed.get(q.rid);
        let out = r.out;
        if (this.X.recipe.has(q.rid) && this.mStars(q.rid) >= 3 && this.rand() < 0.1) out *= 2;
        if (2 * this.cap - this.total() < out) { this.S.blocked++; break; }
        b.queue.shift();
        any = true;
        this.addInv(q.rid, out);
        this.bump(this.S.made, q.rid, out);
        if (this.X.recipe.has(q.rid)) {
          const xp = r.duet && !q.duet ? r.xp / 1.25 : r.xp;
          this.gainXp(xp * this.comboMult(), 'crafting');
          this.masteryTick(q.rid, r.min, r.xp, r.v);
        }
      }
      if (any) this.spendAttn(COST.collect);
    }
  }
  bldTime(r, b) {
    let m = r.min;
    if (r.duet && !this.couple()) m *= 2;
    return m * this.timeMult(m, 'craft') * (this.mStars(r.id) >= 2 ? 0.9 : 1);
  }
  resolveFeedInputs(f) {
    // cheapest available member of each class first (§3.3), skipping reserved goods and — like a couple using the
    // Barn's "not for feed" toggle — goods that other recipes are waiting for, unless nothing else is left
    const take = [];
    const used = new Map();
    for (const [cls, q] of f.inputs) {
      let left = q;
      const mem = this.X.members(cls).sort((a, b) => this.X.item.get(a).v - this.X.item.get(b).v);
      for (const pass of [0, 1]) {
        for (const i of mem) {
          const spare = this.avail(i) - (used.get(i) ?? 0) - (pass === 0 ? (this.otherNeed.get(i) ?? 0) : 0);
          const n = Math.min(left, spare);
          if (n > 0) { take.push([i, n]); used.set(i, (used.get(i) ?? 0) + n); left -= n; }
          if (!left) break;
        }
        if (!left) break;
      }
      if (left) return null;
    }
    return take;
  }
  avail(id) { return this.stock(id) - (this.reserved.get(id) ?? 0); }
  queueBuildings(now, need, remaining) {
    const gap = this.nextSessionStart() - now;
    this.crateFirst(now);
    for (const b of this.bld.values()) {
      const def = this.X.building.get(b.id);
      let guard = 0;
      while (b.queue.length < b.slots * (b.lanes ?? 1) && guard++ < 12) {
        const horizon = remaining > 30 ? 1 : ((remaining + gap) * (b.lanes ?? 1)) / b.slots;
        let best = null;
        if (b.id === 'feed_mill') {
          for (const f of this.X.feeds) {
            if (!this.unlocked(f.unlock)) continue;
            const deficit = (need.get(f.id) ?? 0) - this.stock(f.id) - this.inQueue(f.id) * f.out;
            if (deficit <= 0) continue;
            const ins = this.resolveFeedInputs(f);
            if (!ins) continue;
            const score = deficit;
            if (!best || score > best.score) best = { r: f, ins, score };
          }
        } else {
          for (const r of this.X.recipesOf.get(b.id)) {
            if (!this.unlocked(r.unlock)) continue;
            if (!Object.entries(r.inputs).every(([i, q]) => (this.curious?.has(r.id) ? this.stock(i) : this.avail(i)) >= q)) continue;
            const t = this.bldTime(r, def);
            const deficit = (need.get(r.id) ?? 0) - this.stock(r.id) - this.inQueue(r.id) * r.out;
            const it = this.X.item.get(r.id);
            if (!it.sellable && deficit <= 0 && !(r.id === 'compost' && this.stock('compost') < this.plots.length / 2)
              && !(r.id === 'fertilizer' && this.stock('fertilizer') < 2)) continue;
            let score = (r.added * (r.duet && !this.couple() ? 0.8 : 1)) / Math.max(t, horizon);
            if (deficit > 0) score += 1e6 * (this.orderNeed.get(r.id) ? 2 : 1);

            // curiosity: the unlock card's "Show me" and the Recipe Box ribbon — a couple tries every new recipe once
            else if (!this.S.made.has(r.id) && !this.inQueue(r.id)) score += 5e5;
            if (!best || score > best.score) best = { r, ins: Object.entries(r.inputs), score };
          }
        }
        if (!best) break;
        if (!this.spendAttn(COST.queue)) return;
        for (const [i, q] of best.ins) this.take(i, q);
        const t = this.bldTime(best.r, def);
        const lanes = b.lanes ?? 1;
        const start = Math.max(now, b.queue.length >= lanes ? b.queue[b.queue.length - lanes].end : now);
        b.queue.push({ rid: best.r.id, start, end: start + t, duet: this.couple() && !!best.r.duet });
      }
    }
  }
  // construction (R14): when a Crate is all that stands between the couple and a purchase they can pay, they cancel
  // the last Planks that have not started (its Wood comes back, §3.5 rule 3) and queue the Crate at the front of the
  // waiting items, so it is not stuck behind an hour of Planks
  crateFirst(now) {
    const b = this.bld.get('sawmill');
    const r = this.X.recipe.get('wooden_crate');
    if (!this.crateUrgent || !b || !r || this.inQueue('wooden_crate') || this.stock('planks') < r.inputs.planks) return;
    const def = this.X.building.get('sawmill');
    const waiting = b.queue.filter((q) => q.start > now);
    if (b.queue.length >= b.slots * (b.lanes ?? 1)) {
      const drop = waiting.findLast((q) => q.rid === 'planks');
      if (!drop) return;
      b.queue.splice(b.queue.indexOf(drop), 1);
      for (const [i, q] of Object.entries(this.X.recipe.get('planks').inputs)) this.addInv(i, q);
    }
    if (!this.spendAttn(COST.queue)) return;
    this.take('planks', r.inputs.planks);
    const lanes = b.lanes ?? 1;
    const started = b.queue.filter((q) => q.start <= now);
    const rest = b.queue.filter((q) => q.start > now);
    const out = [...started];
    for (const q of [{ rid: r.id, duet: false, t: this.bldTime(r, def) }, ...rest.map((x) => ({ ...x, t: x.end - x.start }))]) {
      const start = Math.max(now, out.length >= lanes ? out[out.length - lanes].end : now);
      out.push({ rid: q.rid, start, end: start + q.t, duet: q.duet });
    }
    b.queue = out;
  }
  inQueue(id) { let n = 0; for (const b of this.bld.values()) for (const q of b.queue) if (q.rid === id) n++; return n; }

  // ---- demand: what the farm wants on hand (orders, barge, feed, building plans, construction)
  computeNeeds(now, remaining) {
    const need = new Map();
    const add = (id, q) => { if (q > 0) need.set(id, (need.get(id) ?? 0) + q); };
    this.reserved = new Map();
    this.orderNeed = new Map();
    for (const o of this.orders) if (o.open) for (const [i, q] of o.items) { add(i, q); this.orderNeed.set(i, (this.orderNeed.get(i) ?? 0) + q); }
    if (this.barge) for (const c of this.barge.crates) if (!c.loaded) { add(c.item, c.qty); this.orderNeed.set(c.item, (this.orderNeed.get(c.item) ?? 0) + c.qty); }
    for (const t of this.townsfolk) if (t.open) for (const [i, q] of t.items) { add(i, q); this.orderNeed.set(i, (this.orderNeed.get(i) ?? 0) + q); }
    if (this.project && !this.project.goodsIn) for (const [i, q] of this.project.items) add(i, q);  // produced, not reserved
    // recipes a quest asks for, and curiosity (below), get their inputs kept aside ("Keep N", §6.3)
    this.curious = new Set();
    const keepInputs = (rid) => {
      const r = this.X.recipe.get(rid);
      if (!r || this.curious.has(rid)) return;
      this.curious.add(rid);
      for (const [i, q] of Object.entries(r.inputs)) { add(i, q); this.reserved.set(i, Math.min(this.stock(i), (this.reserved.get(i) ?? 0) + q)); }
    };
    this.questNeeds((i, q) => { add(i, q); this.orderNeed.set(i, (this.orderNeed.get(i) ?? 0) + q); keepInputs(i); });
    // curiosity: inputs for one never-made recipe per building (so every good gets made at least once), kept aside
    const memoC = new Map();
    for (const b of this.bld.values()) {
      if (b.id === 'feed_mill') continue;
      const r = this.X.recipesOf.get(b.id).find((x) => this.unlocked(x.unlock) && !this.S.made.has(x.id) && this.producible(x.id, memoC));
      if (r) keepInputs(r.id);
    }
    for (const [i, q] of this.orderNeed) this.reserved.set(i, Math.min(q + (this.reserved.get(i) ?? 0), this.stock(i)));
    // construction: planks and crates for the next expansion and the next barn upgrade
    const exp = this.X.expansions[this.expansions];
    const barn = this.X.barn[this.barnN];
    let planks = 0, crates = 0;
    if (exp && exp.level <= this.level + 2) { planks += exp.planks; crates += exp.crates; }
    if (barn && barn.level <= this.level + 2) { planks += barn.planks; crates += barn.crates; }
    // the couple queues Planks and Crates for the next expansion / barn upgrade before anything else at the Sawmill
    if (this.level >= 6) {
      add('planks', planks); add('wooden_crate', crates);
      this.reserved.set('planks', Math.min(planks + (this.orderNeed.get('planks') ?? 0), this.stock('planks')));
      this.reserved.set('wooden_crate', Math.min(crates + (this.orderNeed.get('wooden_crate') ?? 0), this.stock('wooden_crate')));
      if (crates > this.stock('wooden_crate')) this.orderNeed.set('wooden_crate', (this.orderNeed.get('wooden_crate') ?? 0) + crates);
      if (planks + 2 * crates > this.stock('planks')) this.orderNeed.set('planks', (this.orderNeed.get('planks') ?? 0) + planks);
      if (crates > this.stock('wooden_crate')) this.curious.add('wooden_crate');
    }
    // feed: one cycle now, the cycles that fit in the rest of the session, and one for the night
    for (const [sp, list] of this.animals) {
      const def = this.X.animal.get(sp);
      if (!def.feed) continue;
      add(def.feed, list.length * def.feedQty * (2 + Math.floor(Math.max(0, remaining) / def.cycle)));
    }
    // building plans: each building's best value-added-per-minute recipe whose chain is producible
    const memo = new Map();
    for (const b of this.bld.values()) {
      if (b.id === 'feed_mill') continue;
      let best = null;
      for (const r of this.X.recipesOf.get(b.id)) {
        if (!this.unlocked(r.unlock) || !this.producible(r.id, memo) || !this.X.item.get(r.id).sellable) continue;
        const s = r.added / this.bldTime(r);
        if (!best || s > best.s) best = { r, s };
      }
      if (!best) continue;
      b.plan = best.r.id;
      const crafts = Math.min(b.slots, Math.max(1, Math.ceil(Math.min(60, Math.max(remaining, 0) + 1) / best.r.min)) + 1);
      for (const [i, q] of Object.entries(best.r.inputs)) add(i, q * crafts);
    }
    // propagate intermediate deficits down the chain (highest tier first)
    this.otherNeed = new Map();
    for (const id of this.X.craftedByDepth) {
      const n = need.get(id) ?? 0;
      if (!n) continue;
      const r = this.X.recipe.get(id) ?? this.X.feed.get(id);
      const deficit = n - this.stock(id) - this.inQueue(id) * r.out;
      if (deficit <= 0) continue;
      const crafts = Math.ceil(deficit / r.out);
      if (this.X.feed.has(id)) {
        for (const [cls, q] of r.inputs) {
          const cheapest = this.X.members(cls).filter((i) => this.X.crop.has(i) && this.unlocked(this.X.crop.get(i).unlock))
            .sort((a, b) => this.X.item.get(a).v - this.X.item.get(b).v)[0];
          if (cheapest) add(cheapest, q * crafts);
        }
      } else for (const [i, q] of Object.entries(r.inputs)) { add(i, q * crafts); this.otherNeed.set(i, (this.otherNeed.get(i) ?? 0) + q * crafts); }
    }
    for (const [i, q] of need) if (this.X.crop.has(i) && !this.otherNeed.has(i)) this.otherNeed.set(i, 0);
    // direct plan inputs also count as "not for feed"
    for (const b of this.bld.values()) {
      const r = this.X.recipe.get(b.plan ?? '');
      if (r) for (const [i, q] of Object.entries(r.inputs)) this.otherNeed.set(i, Math.max(this.otherNeed.get(i) ?? 0, q * 2));
    }
    return need;
  }

  // ---- selling
  keepFor(id, need) {
    const it = this.X.item.get(id);
    let keep = need.get(id) ?? 0;
    if (['craft', 'animal', 'fruit'].includes(it.kind) && it.orderable && this.total() < 0.6 * this.cap) keep += BUFFER_UNITS;
    if (id === 'wood' || id === 'planks' || id === 'wooden_crate') keep = Math.max(keep, need.get(id) ?? 0);
    if (id === 'wood') keep += this.bld.has('sawmill') ? 40 : 20; // §6.3: Wood has a default "Keep 20" (Ollie's advice)
    // Fair prep: in the last session before the Fair closes, crafted T3/T4/duet goods are kept for entries
    if (this.fair && it.kind === 'craft' && ['T3', 'T4', 'DUET'].includes(it.tier) && this.nextSessionStart() >= this.week * WEEK + 6 * DAY + 1200)
      keep = Math.max(keep, 10 - (this.fair.entered.get(id) ?? 0));
    return keep;
  }
  sellSurplus(need, all = false) {
    for (const [id, q] of [...this.inv]) {
      const it = this.X.item.get(id);
      if (!it || !it.sellable || id === 'compost') continue;
      const surplus = q - this.keepFor(id, need);
      if (surplus > 0 && (all || true)) { if (this.spendAttn(COST.sell) || all) this.sell(id, surplus); }
    }
  }

  // ---- orders (§5.2, v2)
  orderSlots() { for (const [L, n] of ORDER_SLOTS) if (this.level >= L) return n; return 0; }
  ordersTick(now) {
    const n = this.orderSlots();
    while (this.orders.length < n) this.orders.push({ open: false, availableAt: now });
    for (const o of this.orders) if (!o.open && o.availableAt <= now) this.genOrder(o, now);
    for (const o of [...this.orders, ...this.townsfolk]) {
      if (!o.open) continue;
      if ([...o.items].every(([i, q]) => this.stock(i) >= q)) {
        if (!this.spendAttn(COST.order)) return;
        let sumV = 0;
        for (const [i, q] of o.items) { this.take(i, q); sumV += this.X.item.get(i).v * q; this.bump(this.delivered, i, q); }
        const mult = o.duetGold ? 2.0 : 1.5;
        this.gainCoins(mult * sumV * o.r, o.townsfolk ? 'townsfolk' : 'orders');
        this.gainXp((mult * sumV * (1 - o.r)) / 8, o.townsfolk ? 'townsfolk' : 'orders');
        if (o.golden) { this.acorns++; this.S.orders.golden++; }
        o.open = false;
        if (o.townsfolk) { this.S.townsfolk.filled++; continue; }
        this.S.orders.filled++; this.S.orders.fillTimes.push(now - o.at);
        if (o.duetGold) this.S.orders.duet++;
        this.weekOrderValue += mult * sumV * (o.simple ? 0.25 : 1);
        this.ordersFilled = (this.ordersFilled ?? 0) + 1;
        // the quick slot (board slot 0) refills on its own shorter timer (§5.2, wave-2 RC-01)
        o.availableAt = now + (this.orders.indexOf(o) === 0 ? this.rules.quickRefillMin : 15);
      } else if (!o.townsfolk && ((this.si - o.si >= 3 && now - o.at > DAY) || o.invalid)) {
        // a sensible couple discards an order it cannot make (missing producer) or that survived 3 sessions and a day
        this.S.orders.discarded++; this.S.orders.unfilledAge.push(now - o.at);
        o.open = false;
        o.availableAt = this.freeRefill ? now : now + 15; this.freeRefill = false;
      }
    }
  }
  // what one building (one item at a time) or the farm's producers can make for an order (v2, H2)
  orderCap(id) {
    const X = this.X;
    const plotCap = this.plotCap();
    if (X.crop.has(id)) return Math.max(1, Math.floor((plotCap / 3) * X.crop.get(id).yield));
    if (X.treeByProduct.has(id)) { const t = X.treeByProduct.get(id); return this.matureTrees(t.id).length * t.yield; }
    if (X.animalByProduct.has(id)) { const a = X.animalByProduct.get(id); return this.adults(a.id).length * a.out * Math.max(1, Math.floor(90 / a.cycle)); }
    const rec = X.recipe.get(id);
    return rec.out * Math.max(1, Math.floor(45 / rec.min));
  }
  pickItems(pool, k, budget, maxMachineMin = 90) {
    const X = this.X, r = this.rand;
    const recent = this.recentOrderItems.slice(-5);
    // weights: recently asked x 1/(1+n), in stock x 3, crafted x 1.3 from L8, never delivered yet x 4 ("Mabel likes to
    // try new things": every good the farm can make gets asked for)
    const weight = (it) => (1 / (1 + recent.filter((x) => x.includes(it.id)).length)) * (this.stock(it.id) >= 1 ? 3 : 1)
      * (it.kind === 'craft' && this.level >= 8 ? 1.3 : 1) * (this.delivered.has(it.id) ? 1 : 4);
    const items = new Map();
    const inputsOf = (id) => new Set(Object.keys(X.recipe.get(id)?.inputs ?? {}));
    const clash = (a, b) => { const A = inputsOf(a), B = inputsOf(b); if (A.has(b) || B.has(a)) return true; for (const x of A) if (B.has(x)) return true; return false; };
    let cand = pool.slice();
    while (items.size < k && cand.length) {
      const tot = cand.reduce((s, it) => s + weight(it), 0);
      let x = r() * tot, pick = cand[0];
      for (const it of cand) { x -= weight(it); if (x <= 0) { pick = it; break; } }
      cand = cand.filter((it) => it !== pick && ![...items.keys(), pick.id].some((j) => clash(j, it.id)));
      items.set(pick.id, clamp(round(budget / k / pick.v), 1, Math.max(1, this.orderCap(pick.id))));
      const mm = [...items].reduce((t, [i, q]) => t + (X.recipe.has(i) ? (q / X.recipe.get(i).out) * X.recipe.get(i).min : 0), 0);
      if (mm > maxMachineMin && items.size > 1) { items.delete(pick.id); break; }
    }
    return items;
  }
  orderPool(budget, k0, extra = () => true) {
    const X = this.X, L = this.level;
    const inOpen = new Map();
    for (const x of [...this.orders, ...this.townsfolk]) if (x.open) for (const [i] of x.items) inOpen.set(i, (inOpen.get(i) ?? 0) + 1);
    return [...X.item.values()].filter((it) => it.orderable && it.unlock <= L - 1 && (inOpen.get(it.id) ?? 0) < 2
      && this.producible(it.id) && !(it.tier === 'T4' && L < 22)
      && !(it.v * this.orderCap(it.id) < (0.25 * budget) / k0) && extra(it));
  }
  genOrder(o, now) {
    const X = this.X, L = this.level, E = this.E(), r = this.rand;
    if (L < 2) return;
    // board slot 0 is the quick slot at every level (wave-1 QA RC-19, §5.2): the first band's budget
    const quick = this.orders.indexOf(o) === 0;
    const f = quick || L <= 5 ? 0.06 + 0.09 * r() : L <= 14 ? 0.1 + 0.15 * r() : 0.15 + 0.2 * r();
    const budget = E * f;
    // golden orders (v2, X2): the first order generated after each 6-hour boundary, whatever the discards
    const slot6 = Math.floor(now / 360);
    const golden = slot6 > this.lastGoldenSlot;
    if (golden) this.lastGoldenSlot = slot6;
    let items = null, simple = false, duetGold = false;
    // a golden order may ask for one duet good (from L10, 1 in 3), paying 2.0 x V (v2, M6)
    if (golden && L >= 10 && r() < 1 / 3) {
      const duets = X.recipes.filter((d) => d.duet && d.unlock <= L - 1 && this.producible(d.id));
      if (duets.length) { items = new Map([[duets[Math.floor(r() * duets.length)].id, 1]]); duetGold = true; }
    }
    // safety net (v2, H2): if no open order can be filled from stock or from crops <= 30 min, this one is simple
    const oneRun = (i, q) => { const rec = X.recipe.get(i); return rec && this.bld.has(rec.building) && rec.min * Math.ceil(q / rec.out) <= 60
      && Object.entries(rec.inputs).every(([j, n]) => this.stock(j) >= n * Math.ceil(q / rec.out)); };
    const growing = (i) => this.plots.reduce((n, p) => n + (p.crop === i ? X.crop.get(i).yield : 0), 0);
    const easy = (ord) => [...ord.items].every(([i, q]) => this.stock(i) >= q || (X.crop.has(i) && (X.crop.get(i).min <= 60 || this.stock(i) + growing(i) >= q)) || oneRun(i, q));
    const easyOpen = this.orders.filter((x) => x.open && easy(x)).length;
    if (!items && easyOpen < 1) {
      // simple order: a good in stock (preferred) or a crop of <= 30 min, one type
      const inStock = [...X.item.values()].filter((it) => it.orderable && it.unlock <= L && this.stock(it.id) >= 2);
      const fast = X.crops.filter((c) => c.unlock <= Math.max(1, L - 1) && c.min <= 30).map((c) => X.item.get(c.id));
      const pool = inStock.length ? inStock : fast;
      const it = pool[Math.floor(r() * pool.length)];
      const cap = X.crop.has(it.id) ? Math.floor(this.plotCap() / 2) : this.stock(it.id);
      items = new Map([[it.id, clamp(round(budget / it.v), 1, Math.max(1, cap))]]);
      simple = true; this.S.orders.simple++;
    }
    if (!items) {
      const k0 = 1 + Math.floor(Math.min(4, 1 + Math.floor(L / 7)) / 2);
      const k = 1 + Math.floor(r() * Math.min(4, 1 + Math.floor(L / 7)));
      items = this.pickItems(this.orderPool(budget, k0), k, budget);
      if (!items.size) { const c = X.crops[0]; items = new Map([[c.id, clamp(round(budget / c.v), 1, this.plotCap())]]); simple = true; this.S.orders.simple++; }
    }
    Object.assign(o, { items, open: true, at: now, si: this.si, r: [0.5, 0.65, 0.8, 0.95][Math.floor(r() * 4)], golden, simple, duetGold });
    o.invalid = ![...items].every(([i, q]) => this.producible(i) || this.stock(i) >= q);
    this.S.orders.gen++;
    if (o.invalid) this.S.orders.invalid++;
    if ([...items].every(([i, q]) => this.stock(i) >= q)) this.S.orders.fillableAtGen++;
    this.recentOrderItems.push([...items.keys()]);
  }
  // weekly townsfolk board (v2, G1): 3 requests a week from L21, each 2-3 goods worth about E x 0.5 h, paid like an
  // order (1.5 x V) plus 1 Friendship; unfinished requests simply leave on Sunday night
  makeTownsfolk() {
    const E = this.E();
    this.townsfolk = [];
    for (let n = 0; n < 3; n++) {
      const budget = E * 0.5;
      const items = this.pickItems(this.orderPool(budget, 2), 2 + Math.floor(this.rand() * 2), budget, 240);
      if (!items.size) continue;
      this.townsfolk.push({ townsfolk: true, items, open: true, at: this.now, r: 0.8 });
      this.S.townsfolk.offered++;
    }
  }

  // ---- River Barge (§5.7, v2 H3)
  makeBarge() {
    const X = this.X, E = this.E(), L = this.level;
    const pool = [...X.item.values()].filter((it) => {
      if (!((this.lastMade.get(it.id) ?? -Infinity) > this.now - 14 * DAY)) return false;   // made in the last 14 days
      if (!this.producible(it.id) || it.unlock > L || !it.orderable) return false;
      if (it.kind === 'craft') return ['T2', 'T3', 'T4'].includes(it.tier);
      if (it.kind === 'crop') return X.crop.get(it.id).min >= 240;
      return it.kind === 'fruit' || (it.kind === 'animal' && X.animalByProduct.get(it.id).cycle >= 180);
    });
    const plotCap = this.plotCap();
    const capFix = (id) => {
      // what ONE producer makes in 6 hours (a building one at a time, the animals/trees owned, a third of the plots)
      const h = 360;
      if (X.crop.has(id)) { const c = X.crop.get(id); return Math.max(1, Math.floor((plotCap / 3) * c.yield)); }
      if (X.treeByProduct.has(id)) { const t = X.treeByProduct.get(id); return this.matureTrees(t.id).length * t.yield * Math.max(1, Math.floor(h / t.cycle)); }
      if (X.animalByProduct.has(id)) { const a = X.animalByProduct.get(id); return this.adults(a.id).length * a.out * Math.max(1, Math.floor(h / a.cycle)); }
      const rec = X.recipe.get(id); return rec.out * Math.max(1, Math.floor(h / rec.min));
    };
    const crates = [];
    const inputsOf = (id) => new Set(Object.keys(X.recipe.get(id)?.inputs ?? {}));
    let cand = pool.slice();
    // rows offered = 1 per 2 hours played last week (1..3)
    const nCrates = 3 * clamp(Math.ceil((this.lastWeekPlay ?? 180) / 120), 1, 3);
    while (crates.length < nCrates && cand.length) {
      const pick = cand[Math.floor(this.rand() * cand.length)];
      cand = cand.filter((it) => { if (it === pick) return false; const A = inputsOf(it.id), B = inputsOf(pick.id); for (const x of A) if (B.has(x)) return false; return true; });
      crates.push({ item: pick.id, qty: clamp(round((E * 0.3) / pick.v), 1, capFix(pick.id)), loaded: false });
    }
    this.barge = { crates, rowsPaid: [false, false, false], tier: this.bargeTier ?? 1 };
    this.S.barge.weeks++; this.S.barge.crates += crates.length;
  }
  bargeTick() {
    if (!this.barge) return;
    const horses = Math.min(4, this.adults('horse').length);
    for (const c of this.barge.crates) {
      if (c.loaded || this.stock(c.item) < c.qty) continue;
      if (!this.spendAttn(COST.order)) return;
      this.take(c.item, c.qty);
      const coins = 1.6 * this.X.item.get(c.item).v * c.qty * (1 + 0.05 * horses);
      this.gainCoins(coins, 'barge'); this.gainXp((0.2 * coins) / 8, 'barge');
      c.loaded = true; this.S.barge.loaded++; this.cratesLoaded = (this.cratesLoaded ?? 0) + 1;
    }
    for (let row = 0; row < 3; row++) {
      const rowC = this.barge.crates.slice(row * 3, row * 3 + 3);
      if (this.barge.rowsPaid[row] || rowC.length < 3 || !rowC.every((c) => c.loaded)) continue;
      this.barge.rowsPaid[row] = true; this.S.barge.rows++; this.rowsDone = (this.rowsDone ?? 0) + 1;
      this.gainCoins(this.E() * 0.25 * (this.expansions >= 7 ? 1.25 : 1), 'barge'); this.acorns++;
      // the Captain's chest pays per completed row: a third of (1 + t) Acorns
      this.acornFrac = (this.acornFrac ?? 0) + (1 + this.barge.tier) / 3;
      while (this.acornFrac >= 1) { this.acornFrac--; this.acorns++; }
    }
  }
  finishBarge() {
    const b = this.barge;
    if (b && b.crates.length && b.crates.every((c) => c.loaded)) { this.S.barge.full++; this.fullBarges = (this.fullBarges ?? 0) + 1; this.bargeTier = Math.min(5, (this.bargeTier ?? 1) + 1); }
    else if (b) this.bargeTier = Math.max(1, (this.bargeTier ?? 1) - 1);
    this.barge = null; this.bargeDue = Infinity;
  }

  // ---- County Fair (§5.6, v2): a medal pays FAIR_PAY x the value of its threshold (points x 100 coins)
  fairReward(points, W) {
    const tiers = [[1.15, 'Gold III'], [1.0, 'Gold II'], [0.9, 'Gold I'], [0.8, 'Silver III'], [0.7, 'Silver II'], [0.6, 'Silver I'],
      [0.5, 'Bronze III'], [0.35, 'Bronze II'], [0.2, 'Bronze I']];
    for (const [f, name] of tiers) if (points >= f * W) return { coins: f * W * 100 * FAIR_PAY, name, silver: f >= 0.6, acorns: f >= 0.9 ? 4 : f >= 0.6 ? 2 : 0 };
    return { coins: 0, name: null, silver: false, acorns: 0 };
  }
  fairPoints(it) { return round(it.v / 10) / 10 * (it.duet ? 2 : 1) * (it.tier === 'T4' && this.level >= 32 ? 2 : 1); }
  fairDecide() {
    // rational entry: enter T3/T4/duet goods only while the extra medal coins (plus a pending quest) beat their sale value
    const f = this.fair;
    const goods = [];
    for (const [id, q] of this.inv) {
      const it = this.X.item.get(id);
      if (!it || it.kind !== 'craft' || !['T3', 'T4', 'DUET'].includes(it.tier)) continue;
      const free = Math.min(q - (this.reserved?.get(id) ?? 0), 10 - (f.entered.get(id) ?? 0));
      const pts = this.fairPoints(it);
      for (let k = 0; k < free; k++) goods.push({ id, pts, cost: it.v, t4: it.tier === 'T4' });
    }
    goods.sort((a, b) => a.cost / a.pts - b.cost / b.pts);
    const questBonus = (pts, n) => {
      let b = 0;
      for (const [id] of this.questActive) {
        const q = this.X.quests.find((x) => x.id === id);
        for (const [verb, ref] of q.tasks) {
          if (verb === 'reach' && (ref === 'fair_silver' || ref === 'league') && this.fairReward(pts, f.W).silver) b += q.coins + q.xp * 8;
          if (verb === 'enter' && ref === 'fair' && n > 0) b += q.coins / 3;
        }
      }
      return b;
    };
    let best = { n: 0, net: this.fairReward(f.points, f.W).coins + questBonus(f.points, 0) };
    let pts = f.points, cost = 0;
    for (let n = 1; n <= goods.length; n++) {
      pts += goods[n - 1].pts; cost += goods[n - 1].cost;
      const net = this.fairReward(pts, f.W).coins + questBonus(pts, n) - cost;
      if (net > best.net) best = { n, net };
    }
    for (let n = 0; n < best.n; n++) {
      const g = goods[n];
      this.take(g.id, 1); f.points += g.pts; f.entered.set(g.id, (f.entered.get(g.id) ?? 0) + 1);
      this.S.fair.entries++; this.S.fair.entryCost += g.cost; this.fairEntries = (this.fairEntries ?? 0) + 1;
      if (g.t4) this.hamperEntries++;
    }
  }
  finishFair() {
    const f = this.fair;
    if (!f) return;
    const r = this.fairReward(f.points, f.W);
    this.S.fair.weeks++;
    if (r.name) { this.gainCoins(r.coins, 'fair'); this.acorns += r.acorns; this.S.fair.reward += r.coins; this.S.fair.medals[r.name] = (this.S.fair.medals[r.name] ?? 0) + 1; }
    if (r.silver) this.fairSilver = (this.fairSilver ?? 0) + 1;
    this.fair = null;
  }

  // ---- quests (§5.3): up to 3 active cards from the story chains, doable ones first (v2 G4); weekly chains F and G in
  // a "This week" tab, the together chain H in its own tab. Tasks come from the model and count from acceptance.
  counters() {
    return { orders: this.ordersFilled ?? 0, crates: this.cratesLoaded ?? 0, rows: this.rowsDone ?? 0, barges: this.fullBarges ?? 0,
      entries: this.fairEntries ?? 0, prized: this.prizedCount ?? 0, silver: this.fairSilver ?? 0, sessions: this.si,
      composted: this.composted, hampers: this.hamperEntries, made: new Map(this.S.made), planted: new Map(this.S.planted),
      sold: new Map(this.soldUnits), play: this.playMin + (this.now - this.sessStart) };
  }
  taskState(task, st) {
    const [verb, ref, n] = task;
    const X = this.X;
    const d = (map, id) => (map.get(id) ?? 0) - ((st[map === this.S.made ? 'made' : map === this.S.planted ? 'planted' : 'sold']).get(id) ?? 0);
    switch (verb) {
      case 'plant': return X.crop.has(ref) ? d(this.S.planted, ref) >= n : this.trees.filter((t) => t.species === ref).length >= n;
      case 'harvest': return ref === 'prized' ? (this.prizedCount ?? 0) - st.prized >= n : d(this.S.made, ref) >= n;
      case 'sell': return ref === 'demand' ? this.level >= 11 : d(this.soldUnits, ref) >= n;
      case 'place': case 'build':
        if (X.building.has(ref)) return this.bld.has(ref);
        if (ref === 'beehive') return (this.animals.get('bee') ?? []).length >= n;
        if (ref === 'forage') return true;
        return this.homes.has(ref);
      case 'make': case 'collect': return d(this.S.made, ref) >= n;
      case 'deliver': return this.stock(ref) >= n;
      case 'buy': return (this.animals.get(ref) ?? []).length >= n;
      case 'raise': return this.adults(ref).length >= n;
      case 'tend': return this.adults(ref).length >= 1;   // fed on the next tend once the species is owned (A3)
      case 'fill': return (this.ordersFilled ?? 0) - st.orders >= n;
      case 'clear': return true;
      case 'expand': return this.expansions >= 1;
      case 'upgrade': return ref === 'barn' ? this.barnN >= n : this.slotsBought >= n;
      case 'empty': return d(this.S.made, 'compost') >= n;
      case 'fertilize': return this.composted - st.composted >= n;
      case 'complete':
        if (ref === 'town_project') return this.projectsDone >= n;
        return this.si - st.sessions >= 4;                 // ASSUMPTION: Restoration bundles are not simulated
      case 'reach':
        if (ref === 'beauty_star') return this.decorSpent >= this.decorFor(150);
        return (this.fairSilver ?? 0) - st.silver >= 1;     // fair_silver, and league (proxy: a Silver week)
      case 'load': return ref === 'crate' ? (this.cratesLoaded ?? 0) - st.crates >= n : ref === 'row' ? (this.rowsDone ?? 0) - st.rows >= n
        : (this.fullBarges ?? 0) - st.barges >= n;
      case 'enter': return ref === 'hamper' ? this.hamperEntries - st.hampers >= n : (this.fairEntries ?? 0) - st.entries >= n;
      case 'together': return this.couple();
      case 'breed': return this.adults(ref).length >= 2 && this.stock('baby_bottle') >= 2;
      default: throw new Error(`unknown quest verb ${verb}`);
    }
  }
  // decor coins needed to reach a beauty score (buildings 3 each, trees 2 each; decor at ~40 coins per beauty x level)
  decorFor(beauty) { return Math.max(0, beauty - 3 * this.bld.size - 2 * this.trees.length) * 40 * (1 + 0.04 * (this.level - 1)); }
  questNeeds(add) {
    for (const [id, st] of this.questActive) {
      const q = this.X.quests.find((x) => x.id === id);
      for (const t of q.tasks) {
        const [verb, ref, n] = t;
        if (this.taskState(t, st)) continue;
        if (['make', 'collect', 'harvest'].includes(verb) && this.X.item.has(ref)) add(ref, n);
        else if (verb === 'deliver') add(ref, n);
        else if (verb === 'plant' && this.X.crop.has(ref)) add(ref, n * this.X.crop.get(ref).yield);
        else if (verb === 'breed') add('baby_bottle', 2);
      }
    }
  }
  questsTick(now) {
    const QS = this.X.quests;
    const tab = (q) => (q.chain === 'H' ? 'H' : /^[FG]$/.test(q.chain) ? 'W' : 'M');
    const cand = [];
    for (const q of QS) {
      if (this.questsDone.has(q.id) || this.questActive.has(q.id) || q.level > this.level) continue;
      const prev = QS.filter((x) => x.chain === q.chain && QS.indexOf(x) < QS.indexOf(q));
      if (!prev.every((x) => this.questsDone.has(x.id))) continue;
      if (q.chain === 'H' && !this.couple()) continue;
      cand.push(q);
    }
    // v2 G4: fill the 3 story slots with the quests whose tasks can progress now (oldest first among those)
    const doable = (q) => q.tasks.every(([verb, ref]) => !this.X.item.has(ref) || this.producible(ref) || this.X.crop.has(ref));
    cand.sort((a, b) => (doable(b) - doable(a)) || a.level - b.level);
    for (const q of cand) {
      const activeMain = [...this.questActive.keys()].filter((id) => tab(QS.find((x) => x.id === id)) === 'M').length;
      if (tab(q) === 'M' && activeMain >= 3) continue;
      this.questActive.set(q.id, this.counters());
      for (const [what, k] of Object.entries(q.extra.giftAtStart ?? {})) for (let i = 0; i < k; i++) this.addTree(what, false);
    }
    let blocked = 0;
    for (const [id, st] of [...this.questActive]) {
      const q = QS.find((x) => x.id === id);
      const worked = this.playMin + (now - this.sessStart) - st.play >= 15;
      const ok = worked && q.tasks.every((t) => this.taskState(t, st));
      if (!ok) { if (tab(q) === 'M' && !doable(q)) blocked++; continue; }
      for (const [verb, ref, n] of q.tasks) {
        if (verb === 'deliver') this.take(ref, n);
        if (verb === 'breed') this.take('baby_bottle', 2);
      }
      this.questActive.delete(id); this.questsDone.add(id);
      this.gainCoins(q.coins, 'quests'); this.gainXp(q.xp, 'quests');
      const ex = q.extra;
      if (ex.acorns) this.acorns += ex.acorns;
      if (ex.compost) this.addInv('compost', ex.compost);
      for (const [what, k] of Object.entries(ex.gift ?? {})) {
        for (let i = 0; i < k; i++) { if (this.X.animal.has(what)) this.addAnimal(what, true, true); else this.addTree(what, false); }
      }
    }
    if (blocked >= 1) this.S.questBlockedMin += this.dt;
  }

  // ---- daily systems
  dailyTick(now) {
    if (!this.dailyGiftDone && this.level >= 3) {
      this.dailyGiftDone = true;
      const cd = (this.calDay = (this.calDay ?? 0) + 1);
      if (cd % 7 === 0) this.acorns += cd % 28 === 0 ? 5 : 2;
      else if (cd % 3 === 0) this.addInv('compost', 3);
      else if (cd % 5 !== 0) this.gainCoins(this.E() * 0.1, 'daily gift');
    }
    if (this.level >= this.rules.almanac.from) {
      // Almanac (v2, C1c): ALMANAC_PER_H tasks per player-hour; only the first 4 per player per day pay E x 0.02 h
      const p = (ALMANAC_PER_H / 60) * this.players * this.dt;
      this.almanacAcc = (this.almanacAcc ?? 0) + p;
      while (this.almanacAcc >= 1) {
        this.almanacAcc--;
        this.almanacToday++;
        const A = this.rules.almanac;
        if (this.almanacToday > A.paid * this.players) continue;
        this.gainCoins(this.E() * A.hours, 'almanac');
        this.gainXp((this.E() * A.hours) / 8, 'almanac');
      }
    }
    // Golden Hour (v2, G3): once per together session, at least 8 h after the last one; the last 30 min of a
    // together session of >= 60 min
    if (this.couple() && this.level >= 4 && now - this.lastGoldenSession >= 480 && this.sessRemaining <= 30 && this.sessLen >= 60) {
      this.lastGoldenSession = now; this.goldenUntil = now + 30;
    }
  }

  // ---- buying
  addAnimal(sp, adult, free = false) {
    const def = this.X.animal.get(sp);
    if (!this.animals.has(sp)) this.animals.set(sp, []);
    this.animals.get(sp).push({ adultAt: adult ? this.now : this.now + (def.babyMin || 0), readyAt: null, n: 0, bought: this.now, free });
  }
  // the game's n-th copy price (§3.4 rule 2): gifts are not counted; the first bought copy may have its own price
  animalCost(a) {
    const n = (this.animals.get(a.id) ?? []).filter((x) => !x.free).length;
    if (a.id === 'bee') return nice(2300 * 1.1 ** n);
    return n === 0 && a.first ? a.first.baby : nice(a.baby * 1.1 ** n);
  }
  addTree(species, mature) {
    const def = this.X.tree.get(species);
    const grow = 2 * def.cycle * (1 - (this.couple() ? 0.25 : 0.2) / 2);
    this.trees.push({ species, matureAt: mature ? this.now : this.now + grow, readyAt: mature ? this.now : this.now + grow, harvests: 0, planted: this.now });
  }
  homeCap(sp) {
    const def = this.X.animal.get(sp);
    if (sp === 'bee') return Math.min(8, 2 + Math.floor((this.level - 13) / 3));
    return this.homes.get(def.home) ?? 0;
  }
  landFree() {
    const X = this.X;
    let used = this.plots.length + 4 * this.trees.length;
    for (const b of this.bld.keys()) { const sz = X.building.get(b).size; used += sz[0] * sz[1]; }
    for (const h of this.homes.keys()) { const sz = X.home.get(h).size; used += sz[0] * sz[1]; }
    used += (this.animals.get('bee') ?? []).length;
    return 384 + 128 * this.expansions - FIXED_TILES - used * PATH_OVERHEAD;
  }
  fits(tiles) { return this.landFree() >= tiles * PATH_OVERHEAD; }
  perDay(cycle) { return Math.min(1440 / cycle, this.sessPerDay * (1 + this.meanLen / cycle)); }
  buy(what, cost, apply, log = true) {
    if (this.coins - cost < 0) return false;
    if (!this.spendAttn(COST.buy)) return false;
    this.spend(cost, what.split(':')[0]);
    apply();
    if (log) this.S.buys.push({ what, t: this.now, L: this.level, cost });
    return true;
  }
  shop(now, need) {
    const X = this.X;
    const L = this.level;
    const nightCrop = X.crops.filter((c) => c.unlock <= L).reduce((a, c) => (c.seed > a.seed && c.min >= 240 ? c : a), X.crops[0]);
    this.reserve = Math.min(this.coins, this.plotCap() * nightCrop.seed * 0.6);
    let limit = Infinity; // while saving for a building, only small purchases go ahead
    const can = (cost) => this.coins - cost >= this.reserve && cost <= limit;
    const plotCap = this.plotCap();
    for (let guard = 0; guard < 40; guard++) {
      let bought = false;
      // 1. plots
      if (this.plots.length < plotCap) {
        const n = this.plots.length + 1;
        const cost = nice(25 * 1.04 ** (n - 16));
        if (!this.fits(1)) this.landShort = (this.landShort ?? 0) + 1;
        else if (can(cost) && this.buy('plot', cost, () => this.plots.push({ crop: null, readyAt: 0, compost: false }), false)) { bought = true; continue; }
      }
      // 2. buildings and animal homes, in unlock order (they unlock recipes, animals and orders)
      const nextB = X.buildings.filter((b) => b.unlock <= L && !this.bld.has(b.id)).map((b) => ({ kind: 'building', id: b.id, unlock: b.unlock, cost: b.cost, size: b.size }));
      const nextH = X.animals.filter((a) => a.unlock <= L && a.id !== 'bee' && !this.homes.has(a.home))
        .map((a) => { const h = X.home.get(a.home); return { kind: 'home', id: a.home, unlock: a.unlock, cost: h.cost, size: h.size, cap: a.capStart }; });
      const nb = [...nextB, ...nextH].sort((a, b) => a.unlock - b.unlock || a.cost - b.cost)[0];
      if (nb) {
        this.markWait(`${nb.kind}:${nb.id}`, nb.unlock);
        if (can(nb.cost) && this.fits(nb.size[0] * nb.size[1])) {
          this.buy(`${nb.kind}:${nb.id}`, nb.cost, () => (nb.kind === 'building' ? this.bld.set(nb.id, { id: nb.id, slots: X.building.get(nb.id).slotsStart, queue: [], lanes: 1 }) : this.homes.set(nb.id, nb.cap)));
          this.clearWait(`${nb.kind}:${nb.id}`); bought = true; continue;
        }
        limit = nb.cost * 0.15; // saving for it
      }
      // 3. first home + first animals of every unlocked species
      for (const a of X.animals) {
        if (a.unlock > L) continue;
        const home = X.home.get(a.home);
        if (a.id !== 'bee' && !this.homes.has(a.home)) {
          if (can(home.cost) && this.fits(home.size[0] * home.size[1]) && this.buy(`home:${a.home}`, home.cost, () => this.homes.set(a.home, a.capStart))) { bought = true; break; }
          continue;
        }
        const owned = (this.animals.get(a.id) ?? []).length;
        const min = a.id === 'bee' ? 2 : 2;
        if (owned < Math.min(min, this.homeCap(a.id))) {
          const cost = this.animalCost(a);
          if (can(cost) && this.buy(`animal:${a.id}`, cost, () => this.addAnimal(a.id, a.id === 'bee'))) { bought = true; break; }
        }
      }
      if (bought) continue;
      // 4. first tree of every species (quests ask for second copies of cherry/peach/plum)
      for (const t of X.trees) {
        if (t.unlock > L) continue;
        const owned = this.trees.filter((x) => x.species === t.id).length;
        // quests that ask for more than one tree of a species (d1, d4, d5) are honoured
        const want = Math.max(1, ...[...this.questActive.keys()].flatMap((id) => this.X.quests.find((q) => q.id === id).tasks
          .filter(([v, r]) => v === 'plant' && r === t.id).map(([, , n]) => n)));
        if (owned < want) {
          const cost = nice(t.price * TREE_GROWTH ** owned);
          if (can(cost) && this.fits(4) && this.buy(`tree:${t.id}`, cost, () => this.addTree(t.id, false))) { bought = true; break; }
        }
      }
      if (bought) continue;
      // 5. the next expansion (the couple's saving goal) once planks/crates are ready
      const exp = X.expansions[this.expansions];
      if (exp && exp.level <= L) {
        this.markWait(`expansion:${exp.k}`, exp.level);
        if (can(exp.coins) && (this.stock('planks') < exp.planks || this.stock('wooden_crate') < exp.crates)) this.matBlocked = true;
        if (can(exp.coins) && this.stock('wooden_crate') < exp.crates) this.crateNext = true;
        if (this.stock('planks') >= exp.planks && this.stock('wooden_crate') >= exp.crates && can(exp.coins)) {
          this.buy(`expansion:${exp.k}`, exp.coins, () => {
            this.take('planks', exp.planks); this.take('wooden_crate', exp.crates); this.expansions++;
            // §3.9: 15 debris pieces (6 weeds, 4 rocks, 3 stumps, 2 logs) at the §4.5 values: 68 XP, 340 coins, 12 Wood
            this.gainXp(68, 'debris'); this.gainCoins(340, 'debris'); this.addInv('wood', 12);
            if (exp.free.tree) for (let i = 0; i < exp.free.tree[1]; i++) this.addTree(exp.free.tree[0], true);
            if (exp.free.bee) this.addAnimal('bee', true);
          });
          this.clearWait(`expansion:${exp.k}`);
          continue;
        }
      }
      // 6. barn upgrade when the barn is getting full
      const bn = X.barn[this.barnN];
      if (bn && bn.level <= L && this.total() > 0.5 * this.cap) {
        this.markWait(`barn:${bn.n}`, bn.level);
        if (can(bn.coins) && (this.stock('planks') < bn.planks || this.stock('wooden_crate') < bn.crates)) this.matBlocked = true;
        if (can(bn.coins) && this.stock('wooden_crate') < bn.crates) this.crateNext = true;
        if (this.stock('planks') >= bn.planks && this.stock('wooden_crate') >= bn.crates && can(bn.coins)) {
          this.buy(`barn:${bn.n}`, bn.coins, () => { this.take('planks', bn.planks); this.take('wooden_crate', bn.crates); this.cap = bn.cap; this.barnN++; });
          this.clearWait(`barn:${bn.n}`);
          continue;
        }
      }
      // 7. capacity that repays within PAYBACK_DAYS: animals, home upgrades, extra trees, building slots, tools
      const opts = [];
      for (const a of X.animals) {
        if (a.unlock > L || (a.id !== 'bee' && !this.homes.has(a.home))) continue;
        const owned = (this.animals.get(a.id) ?? []).length;
        const perDay = this.perDay(a.cycle) * a.net * (1 + (this.couple() ? 0.2 : 0.1));
        if (owned < this.homeCap(a.id)) {
          const cost = this.animalCost(a);
          opts.push({ what: `animal:${a.id}`, cost, days: cost / perDay, apply: () => this.addAnimal(a.id, a.id === 'bee') });
        } else if (a.id !== 'bee' && this.homes.get(a.home) < a.capMax) {
          const cost = X.home.get(a.home).upgrade + 2 * nice(a.baby * 1.1 ** owned);
          opts.push({ what: `homeupg:${a.home}`, cost: X.home.get(a.home).upgrade, days: cost / (2 * perDay), apply: () => this.homes.set(a.home, this.homes.get(a.home) + 2) });
        }
      }
      for (const t of X.trees) {
        if (t.unlock > L) continue;
        const owned = this.trees.filter((x) => x.species === t.id).length;
        if (owned >= treeCap(L)) continue;                     // v2 (M8): one Grove + 1 per 10 farm levels
        const cost = nice(t.price * TREE_GROWTH ** owned);
        const perDay = this.perDay(t.cycle * 0.8) * t.harvest;
        if (this.fits(4 + 2)) opts.push({ what: `tree:${t.id}`, cost, days: cost / perDay + 2 * t.cycle / 1440, apply: () => this.addTree(t.id, false) });
      }
      for (const b of this.bld.values()) {
        const def = X.building.get(b.id);
        if (b.slots >= def.slotsMax) continue;
        const k = b.slots - def.slotsStart + 1;
        const cost = def.slotCost(k);
        // one more slot = one more craft per absence (the queue runs while nobody is there)
        const plan = X.recipe.get(b.plan ?? '') ?? null;
        const per = b.id === 'feed_mill' ? 30 : plan ? plan.added : 0;
        const questWants = [...this.questActive.keys()].some((id) => this.X.quests.find((q) => q.id === id).tasks.some(([v, r]) => v === 'upgrade' && r === 'slot'))
          // a building with a backlog of needed crafts larger than its queue is a bottleneck: a slot pays at once
          || X.recipesOf.get(b.id).reduce((n, r) => n + Math.max(0, Math.ceil(((need.get(r.id) ?? 0) - this.stock(r.id)) / r.out) - this.inQueue(r.id)), 0) > b.slots;
        if (per > 0 || questWants) opts.push({ what: `slot:${b.id}`, cost, days: questWants ? 0 : cost / (per * this.sessPerDay), apply: () => { b.slots++; this.slotsBought++; } });
      }
      for (const [id, lvl] of Object.entries(this.rules.secondCopies ?? {})) {
        const b = this.bld.get(id);
        if (!b || lvl > L || (b.lanes ?? 1) > 1) continue;
        const def = X.building.get(id);
        const cost = def.cost * 2 || nice(this.E() * 0.5);
        if (this.fits(def.size[0] * def.size[1])) opts.push({ what: `second:${id}`, cost, days: 3, apply: () => { b.lanes = 2; } });
      }
      for (const [id, lvl, cost] of TOOLS) if (lvl <= L && !this.tools.has(id) && this.coins > 3 * cost) opts.push({ what: `tool:${id}`, cost, days: 0, apply: () => this.tools.add(id) });
      opts.sort((a, b) => a.days - b.days);
      for (const o of opts) {
        if (o.days > PAYBACK_DAYS) break;
        if (can(o.cost) && this.buy(o.what, o.cost, o.apply)) { bought = true; break; }
      }
      if (bought) continue;
      // 8. quest E5: decorate up to 2 beauty stars
      const wantsDecor = [...this.questActive.keys()].some((id) => this.X.quests.find((q) => q.id === id).tasks.some(([v, r]) => r === 'beauty_star'));
      if (wantsDecor && this.decorSpent < this.decorFor(150)) {
        const c = this.decorFor(150) - this.decorSpent;
        if (can(c)) { this.spend(c, 'decor'); this.decorSpent += c; continue; }
      }
      // 9. luxury sinks (v2, H4): fund the next Town Project, then Grand decor above GRAND_AT hours of treasury
      const TP = this.rules.townProjects;
      if (TP && L >= TP.from && !this.project) this.startProject();
      if (this.project && this.project.goodsIn && !this.project.funded && can(this.project.coins)) {
        this.spend(this.project.coins, 'town project'); this.project.funded = true; this.project.doneAt = now + TP.buildDays * DAY; continue;
      }
      const G = this.rules.grandDecorAt;
      const g = X.grandDecor[this.grandN];
      if (G && g && g.unlock <= L && this.coins - g.coins >= this.reserve + G * this.E()) {
        this.spend(g.coins, 'grand decor'); this.grandN++; this.S.grand++; continue;
      }
      break;
    }
  }
  // Town Projects (§5.9, v2 H4): one at a time; coins E x 10 h at the start level plus a goods bundle of about
  // E x 2 h in 3 goods the farm made recently; built 3 days after funding; 5 Acorns and a landmark
  startProject() {
    const TP = this.rules.townProjects, E = this.E();
    const budget = E * TP.goodsHours;
    // goods: crafted goods, animal goods and fruit the farm made in the last 14 days (never raw crops)
    const pool = this.orderPool(budget, 3, (it) => it.kind !== 'crop' && (this.lastMade.get(it.id) ?? -Infinity) > this.now - 14 * DAY);
    const items = this.pickItems(pool, 3, budget, 600);
    this.project = { n: this.projectsDone + 1, items, coins: nice(E * (TP.hours + 0.5 * this.projectsDone)), goodsIn: false, funded: false, startedAt: this.now, L: this.level };
  }
  projectTick(now) {
    const P = this.project;
    if (!P) return;
    // goods are donated piece by piece (like Restoration bundle slots), from stock nobody has kept aside
    if (!P.goodsIn) {
      for (const [i, q] of P.items) { const n = Math.min(q, Math.max(0, this.avail(i))); if (n > 0) { this.take(i, n); if (q - n) P.items.set(i, q - n); else P.items.delete(i); } }
      if (!P.items.size) P.goodsIn = true;
    }
    if (P.funded && now >= P.doneAt) {
      this.projectsDone++; this.acorns += this.rules.townProjects.acorns;
      this.S.projects.push({ n: P.n, L: P.L, startDay: P.startedAt / DAY, doneDay: now / DAY, coins: P.coins });
      this.project = null;
    }
  }
  markWait(key, lvl) { if (!this.waits) this.waits = new Map(); if (!this.waits.has(key)) this.waits.set(key, { from: this.levelTime(lvl), play: this.playAt(lvl) }); }
  clearWait(key) {
    const w = this.waits?.get(key);
    if (!w || w.done) return;
    w.done = true;
    this.S.waits.push({ key, cal: this.now - w.from, play: this.playMin + (this.now - this.sessStart) - w.play, L: this.level });
  }
  levelTime(L) { return this.S.levelAt.find((x) => x.L === L)?.t ?? this.now; }
  playAt(L) { return this.S.levelAt.find((x) => x.L === L)?.play ?? this.playMin; }

  // ---- the minute
  tick(now, remaining, s, dt) {
    this.dt = dt;
    this.now = now; this.players = s.players; this.sessRemaining = remaining; this.sessLen = s.len;
    this.attn = ATTN * s.players * dt;
    this.calendar(now);
    this.S.activeMin += dt;
    this.acc().min += dt;
    this.weekPlay += dt;
    this.attnHit = false;
    if (!this.debrisDone) {
      this.debrisDone = true;
      // §2.3 (v2, M7 + X6): 8 weeds, 6 rocks, 4 stumps, 4 logs, 2 boulders = 40 XP, 200 coins, 20 Wood
      this.addInv('wood', 20);
      this.gainXp(40, 'debris'); this.gainCoins(200, 'debris');
    }
    // §2.3 (v2, X4): one weed or rock regrows per real hour on free land, at most 12 waiting; 1 XP + 5 coins each
    if (now - this.lastDebris >= 60) {
      const n = Math.min(12, Math.floor((now - this.lastDebris) / 60));
      this.lastDebris = now; this.S.debrisRegrown += n;
      this.gainXp(n, 'debris'); this.gainCoins(5 * n, 'debris');
    }
    this.dailyTick(now);
    this.harvestAll(now);
    this.animalsTick(now);
    this.treesTick(now);
    this.collectBuildings(now);
    let need = this.computeNeeds(now, remaining);
    this.bargeTick();
    this.ordersTick(now);
    need = this.computeNeeds(now, remaining);
    this.crateUrgent = this.crateNext ?? false;          // the last shopping pass found a Crate missing
    this.queueBuildings(now, need, remaining);
    this.matBlocked = false;
    this.crateNext = false;
    this.shop(now, need);
    if (this.matBlocked) this.S.matBlockedMin += dt;
    this.plantAll(now, need);
    this.sellSurplus(need, remaining === 0);
    this.questsTick(now);
    this.projectTick(now);
    if (remaining === 0 && this.fair && this.nextSessionStart() >= this.week * WEEK + 6 * DAY + 1200) this.fairDecide();
    // stats
    for (const p of this.plots) { this.S.plotMin += dt; if (!p.crop) this.S.idlePlotMin += dt; }
    for (const b of this.bld.values()) { this.S.bldMin += dt; if (!b.queue.some((q) => q.end > now)) this.S.bldIdleMin += dt; }
    const fm = this.bld.get('feed_mill');
    if (fm) { this.S.feedMillMin += dt; if (fm.queue.some((q) => q.end > now)) this.S.feedMillBusy += dt; }
    for (const list of this.animals.values()) for (const a of list) if (a.adultAt <= now) { this.S.animalMin += dt; if (a.readyAt == null) this.S.hungryMin += dt; }
    const fill = this.total() / this.cap;
    this.S.maxFill = Math.max(this.S.maxFill, fill);
    if (fill > 1) { this.S.overflowMin += dt; for (const [i, q] of this.inv) this.bump(this.S.overflowInv, i, q * dt); }
    if (this.attnHit) this.S.attnShort += dt;
    if (this.level >= 20) { this.S.lateMin += dt; if (this.coins > 15 * this.E()) this.S.richMin += dt; }
  }
  run() {
    // after L40 the farm plays POST_L40 more sessions (Legacy levels) so quests accepted late can finish
    let post = 0;
    for (let i = 0; i < this.sessions.length && (this.level < 40 || post++ < POST_L40); i++) {
      if (this.level >= 40 && this.atL40 == null) this.atL40 = { coins: this.coins, E: this.E() };
      const s = this.sessions[i];
      this.si = i; this.sessStart = s.start;
      let last = -1;
      for (let m = 0; m <= s.len; m++) {
        if (m % SWEEP !== 0 && m !== s.len) continue;
        this.tick(s.start + m, s.len - m, s, last < 0 ? SWEEP : m - last);
        last = m;
      }
      this.playMin += s.len;
      const d = s.day;
      if (!this.S.snaps.length || this.S.snaps[this.S.snaps.length - 1].day !== d) this.S.snaps.push({ day: d, coins: this.coins, L: this.level, xp: this.xp, play: this.playMin });
      else Object.assign(this.S.snaps[this.S.snaps.length - 1], { coins: this.coins, L: this.level, xp: this.xp, play: this.playMin });
    }
    return this;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Static analysis (no simulation): dominance, dead items, exploits
// ---------------------------------------------------------------------------------------------------------------
function staticAnalysis(X, rules = {}) {
  const out = {};
  // crops: net per plot-hour and per planting; which crop is best per hour at each level
  out.crops = X.crops.map((c) => ({ id: c.id, L: c.unlock, min: c.min, netH: ((c.gross - c.seed) * 60) / c.min, net: c.gross - c.seed,
    compostGain: c.v / (c.gross - c.seed) }));
  // a crop is dominated if another crop unlocked no later beats it per plot-hour AND per planting
  for (const c of out.crops) c.dominatedBy = out.crops.filter((o) => o.id !== c.id && o.L <= c.L && o.netH > c.netH && o.net > c.net).map((o) => o.id);
  out.bestCropPerHour = [];
  for (let L = 1; L <= 40; L++) {
    const un = out.crops.filter((c) => c.L <= L && c.min <= 60);
    const best = un.reduce((a, b) => (b.netH > a.netH ? b : a));
    out.bestCropPerHour.push({ L, id: best.id, netH: best.netH });
  }
  // recipes: value added per building-hour; dominated = another recipe in the same building, unlocked no later,
  // beats it both per hour (active) and per craft (overnight)
  out.recipes = X.recipes.map((r) => ({ id: r.id, b: r.building, L: r.unlock, min: r.min, perH: (r.added * 60) / r.min, per: r.added,
    xpH: (r.xp * 60) / r.min, ratio: (r.v * r.out) / r.inVal }));
  for (const r of out.recipes) {
    r.dominatedBy = out.recipes.filter((o) => o.b === r.b && o.id !== r.id && o.L <= r.L && o.perH > r.perH && o.per > r.per).map((o) => o.id);
  }
  // best recipe per building at L40 per hour
  out.bestPerBuilding = X.buildings.map((b) => {
    const rs = out.recipes.filter((r) => r.b === b.id).sort((a, c) => c.perH - a.perH);
    return { b: b.id, best: rs[0]?.id, bestH: rs[0]?.perH, worst: rs[rs.length - 1]?.id, worstH: rs[rs.length - 1]?.perH, n: rs.length };
  });
  // raw-to-final value multiplier of the wheat -> flour -> bread chain
  const bread = X.recipe.get('bread'), flour = X.recipe.get('flour'), wheat = X.crop.get('wheat');
  out.breadChain = { wheatValue: 3 * wheat.v, seedCost: 1.5 * wheat.seed, breadV: bread.v, multiple: bread.v / (3 * wheat.v) };
  // animals: payback days for each schedule-independent cycle
  out.animals = X.animals.map((a) => ({ id: a.id, L: a.unlock, cycle: a.cycle, netH: (a.net * 60) / a.cycle, baby: a.baby,
    homeCost: X.home.get(a.home).cost }));
  // compost value: +1 unit on each crop vs compost's own V
  const compostV = X.item.get('compost').v;
  out.compost = { v: compostV, best: X.crops.slice().sort((a, b) => b.v - a.v).slice(0, 4).map((c) => ({ id: c.id, gain: c.v, ratio: c.v / compostV })),
    horsePerCycle: 2 * 3 * Math.max(...X.crops.map((c) => c.v)), horseListed: X.animal.get('horse').net };
  // mastery reward pool
  let mCoins = 0, mXp = 0;
  const pool = [];
  const mc = rules.masteryCap;
  const reward = (id, min, v, xp, L) => {
    const E = X.levels[clamp(L, 1, 40) - 1].E, th = X.mThresh(min);
    const cap = (amt, s) => (mc ? Math.min(amt, E * mc[s]) : amt);
    return { id, n1: th[0], n2: th[1], coins: cap(10 * v, 1) + cap(20 * v, 2),
      xp: (mc ? Math.min(10 * xp, (E * mc[1]) / 8) + Math.min(20 * xp, (E * mc[2]) / 8) + Math.min(40 * xp, (E * mc[3]) / 8) : 70 * xp) };
  };
  for (const c of X.crops) pool.push(reward(c.id, c.min, c.v, c.xp, c.unlock));
  for (const r of X.recipes) pool.push(reward(r.id, r.min, r.v, r.xp, r.unlock));
  for (const t of X.trees) pool.push(reward(t.id, t.cycle, t.v, t.xp, t.unlock));
  for (const a of X.animals) pool.push(reward(a.id, a.cycle, a.v, a.xp, a.unlock));
  for (const p of pool) { mCoins += p.coins; mXp += p.xp; }
  out.mastery = { coins: mCoins, xp: mXp, top: pool.sort((a, b) => b.coins - a.coins).slice(0, 6) };
  // Fair (§5.6 v2): a point costs V/100 x 100 = 100 coins of goods; a medal pays FAIR_PAY x its threshold's value
  out.fair = { pay: FAIR_PAY, wHours: FAIR_W_HOURS };
  // trees and animals: payback of the first purchase in harvests / collections
  out.trees = X.trees.map((t) => ({ id: t.id, L: t.unlock, price: t.price, harvest: t.harvest, payback: t.price / t.harvest }));
  // feed mill load at full housing (active play)
  let cf = 0, lf = 0, ps = 0;
  for (const a of X.animals) {
    if (!a.feed) continue;
    const perH = (a.capMax * a.feedQty * 60) / a.cycle;
    if (a.feed === 'chicken_feed') cf += perH; else if (a.feed === 'livestock_feed') lf += perH; else ps += perH;
  }
  const f = (id) => X.feed.get(id);
  out.feedMill = { chickenFeedH: cf, livestockFeedH: lf, slopH: ps,
    millMinPerH: (cf / f('chicken_feed').out) * f('chicken_feed').min + (lf / f('livestock_feed').out) * f('livestock_feed').min + (ps / f('pig_slop').out) * f('pig_slop').min };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------------------------------------------
function summarize(f) {
  const S = f.S;
  const lv = (L) => S.levelAt.find((x) => x.L === L);
  const levels = [];
  for (let L = 2; L <= 40; L++) { const x = lv(L); levels.push(x ? { L, day: x.t / DAY, play: x.play / 60 } : { L, day: null, play: null }); }
  const top = (map, n = 12) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
  const ord = S.orders;
  const ft = ord.fillTimes.slice().sort((a, b) => a - b);
  const q = (p) => (ft.length ? ft[Math.floor(p * (ft.length - 1))] : null);
  const madeIds = new Set(S.made.keys());
  const unlockedItems = [...f.X.item.values()].filter((i) => i.unlock <= f.level && i.kind !== 'premium');
  const never = unlockedItems.filter((i) => !madeIds.has(i.id)).map((i) => i.id);
  const waits = S.waits.slice().sort((a, b) => b.cal - a.cal);
  // coin saturation: first day the treasury holds more than 10 hours of E(L) and the E-hours held at the end
  const sat = S.snaps.find((x) => x.coins > 10 * f.X.levels[x.L - 1].E);
  const tEH = f.atL40 ? f.atL40.coins / f.atL40.E : f.coins / f.X.levels[f.level - 1].E;
  return { policy: f.policyName, label: f.P.label, sat: sat ? { day: sat.day, L: sat.L, play: sat.play / 60 } : null, tEH, finalL: f.level, days: f.now / DAY, play: f.playMin / 60, coins: f.coins,
    levels, coinsBy: top(S.coinsBy, 20), xpBy: top(S.xpBy, 12), soldTop: top(S.sold, 15), spentBy: top(S.spentBy, 20),
    never, snaps: S.snaps, waits, buys: S.buys,
    orders: { gen: ord.gen, filled: ord.filled, discarded: ord.discarded, invalid: ord.invalid, simple: ord.simple,
      atGen: ord.fillableAtGen / Math.max(1, ord.gen), p50: q(0.5), p90: q(0.9) },
    barge: S.barge, fair: S.fair,
    idlePlots: S.idlePlotMin / Math.max(1, S.plotMin), idleBld: S.bldIdleMin / Math.max(1, S.bldMin),
    hungry: S.hungryMin / Math.max(1, S.animalMin), feedMill: S.feedMillBusy / Math.max(1, S.feedMillMin), emergencyFeed: S.emergencyFeedCoins,
    overflow: S.overflowMin / Math.max(1, S.activeMin), blocked: S.blocked, maxFill: S.maxFill, attnShort: S.attnShort / Math.max(1, S.activeMin),
    questBlocked: S.questBlockedMin, questsDone: f.questsDone.size, questsStuck: [...f.questActive.keys()], expansions: f.expansions, barn: f.barnN,
    acorns: f.acorns, mastery: [...f.mastery].filter(([, m]) => m.stars >= 1).length,
    perLevel: Object.entries(S.perLevel).map(([L, a]) => ({ L: +L, ...a, E: f.X.levels[L - 1].E })),
    townsfolk: S.townsfolk, projects: S.projects, grand: S.grand, golden: ord.golden, duetOrders: ord.duet,
    rich: S.richMin / Math.max(1, S.lateMin), matBlocked: S.matBlockedMin / Math.max(1, S.activeMin), producedUnits: [...S.made.values()].reduce((a, b) => a + b, 0), overflowTop: top(S.overflowInv, 5).map(([i, q]) => [i, q / Math.max(1, S.overflowMin)]) };
}

function runAll(variantName, policies, seed, days) {
  const V = VARIANTS[variantName];
  const X = index(derive(MODEL, V.d));
  const res = {};
  for (const p of policies) res[p] = summarize(new Farm(X, p, seed, days, V.rules).run());
  return { X, res, V };
}

// Calibration (§4.4): measured production income and XP per play-hour by level band, against E(L) and E(L)/8.
// "prod" = market + orders + barge + townsfolk coins; XP counts every source.
function calibration(res, bands = [[1, 4], [5, 9], [10, 14], [15, 19], [20, 24], [25, 29], [30, 34], [35, 39]]) {
  return bands.map(([a, b]) => {
    const rows = res.perLevel.filter((x) => x.L >= a && x.L <= b && x.min > 0);
    const h = rows.reduce((s, x) => s + x.min, 0) / 60;
    const eh = rows.reduce((s, x) => s + (x.E * x.min) / 60, 0);
    const prod = rows.reduce((s, x) => s + x.prod, 0), xp = rows.reduce((s, x) => s + x.xp, 0);
    return { band: `L${a}–${b}`, h, prodPerE: eh ? prod / eh : null, xpPerE8: eh ? xp / (eh / 8) : null };
  });
}

function mdTable(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function report(variantName, policies, seed, days, md) {
  const { X, res, V } = runAll(variantName, policies, seed, days);
  const L = [];
  const p = (s = '') => L.push(s);
  const H = (n, s) => p(md ? `${'#'.repeat(n)} ${s}` : `\n== ${s} ==`);
  const port = checkPort(index(derive(MODEL, {})));
  H(3, `Simulation — variant "${variantName}" (${V.label}), seed ${seed}, horizon ${days} days`);
  p(`Port check (R1): ${port.length ? `${port.length} mismatches: ${port.slice(0, 5).join('; ')}` : 'the simulator\'s re-derivation equals economy-model.mjs --json for every crop, tree, animal, recipe, level and building'}.`);
  p('');
  for (const k of policies) p(`- **${k}** — ${res[k].label}`);
  p('');
  H(4, 'Time to reach each level (calendar days / hours of play)');
  const marks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 26, 28, 30, 32, 34, 35, 36, 38, 40];
  p(mdTable(['Lvl', ...policies.map((k) => `${k}: day / play h`)], marks.map((Lv) => [Lv, ...policies.map((k) => {
    const x = res[k].levels.find((y) => y.L === Lv);
    return x?.day != null ? `${x.day.toFixed(1)} / ${x.play.toFixed(1)}` : '—';
  })])));
  p('');
  p(`GDD v2 pacing targets for the reference couple (casual: 3 evenings × 60 min a week): L5 in the first evening (~45 min), L10 at the end of week 1 (~3 h), L20 in about a month (~13 h), L30 after 4–5 months (~56 h), L40 after about a year (~140 h).`);
  p('');
  H(4, 'Coins over time (treasury at the end of the day / level)');
  const days2 = [1, 2, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 240, 300, 365];
  p(mdTable(['Day', ...policies], days2.map((d) => [d, ...policies.map((k) => {
    const s = res[k].snaps.filter((x) => x.day < d).pop();
    return s ? `${fmt(s.coins)} (L${s.L})` : '—';
  })])));
  p('');
  H(4, 'Where the coins came from (whole run)');
  for (const k of policies) {
    const r = res[k];
    const tot = r.coinsBy.reduce((s, [, v]) => s + v, 0);
    p(`- **${k}** (end L${r.finalL}, day ${r.days.toFixed(0)}, ${r.play.toFixed(0)} h played): ` + r.coinsBy.slice(0, 10).map(([s, v]) => `${s} ${(100 * v / tot).toFixed(0)} %`).join(', '));
    const xt = r.xpBy.reduce((s, [, v]) => s + v, 0);
    p(`  - XP from: ` + r.xpBy.slice(0, 8).map(([s, v]) => `${s} ${(100 * v / xt).toFixed(0)} %`).join(', '));
    p(`  - spent on: ` + r.spentBy.slice(0, 10).map(([s, v]) => `${s} ${fmt(v)}`).join(', '));
    p(`  - top market sales: ` + r.soldTop.slice(0, 8).map(([s, v]) => `${s} ${fmt(v)}`).join(', '));
  }
  p('');
  H(4, 'Bottlenecks, storage, orders, barge, fair');
  p(mdTable(['Metric', ...policies], [
    ['Idle plot share (active minutes)', ...policies.map((k) => `${(100 * res[k].idlePlots).toFixed(0)} %`)],
    ['Idle building share (active minutes)', ...policies.map((k) => `${(100 * res[k].idleBld).toFixed(0)} %`)],
    ['Feed Mill busy (active minutes)', ...policies.map((k) => `${(100 * res[k].feedMill).toFixed(0)} %`)],
    ['Adult animal-minutes standing hungry (active play)', ...policies.map((k) => `${(100 * res[k].hungry).toFixed(1)} %`)],
    ['Emergency feed bought (coins)', ...policies.map((k) => fmt(res[k].emergencyFeed))],
    ['Attention-limited minutes', ...policies.map((k) => `${(100 * res[k].attnShort).toFixed(0)} %`)],
    ['Max barn fill (stock / capacity)', ...policies.map((k) => `${(100 * res[k].maxFill).toFixed(0)} %`)],
    ['Minutes in overflow', ...policies.map((k) => `${(100 * res[k].overflow).toFixed(1)} %`)],
    ['Units refused at 2× capacity', ...policies.map((k) => fmt(res[k].blocked))],
    ['Orders generated / filled / discarded', ...policies.map((k) => `${res[k].orders.gen} / ${res[k].orders.filled} / ${res[k].orders.discarded}`)],
    ['Orders not producible at generation (G-VALID breach)', ...policies.map((k) => `${res[k].orders.invalid} (${(100 * res[k].orders.invalid / Math.max(1, res[k].orders.gen)).toFixed(0)} %)`)],
    ['Orders fillable from stock at generation', ...policies.map((k) => `${(100 * res[k].orders.atGen).toFixed(0)} %`)],
    ['"Simple" fallback orders', ...policies.map((k) => `${(100 * res[k].orders.simple / Math.max(1, res[k].orders.gen)).toFixed(0)} %`)],
    ['Order time-to-fill p50 / p90 (calendar)', ...policies.map((k) => `${hhmm(res[k].orders.p50 ?? 0)} / ${hhmm(res[k].orders.p90 ?? 0)}`)],
    ['Barge crates loaded / offered, full barges', ...policies.map((k) => `${res[k].barge.loaded} / ${res[k].barge.crates}, ${res[k].barge.full} of ${res[k].barge.weeks}`)],
    ['Fair weeks, medals', ...policies.map((k) => `${res[k].fair.weeks}: ${Object.entries(res[k].fair.medals).map(([m, n]) => `${m} ×${n}`).join(', ') || 'none'}`)],
    ['Fair entries (goods value) / medal coins', ...policies.map((k) => `${res[k].fair.entries} (${fmt(res[k].fair.entryCost)}) / ${fmt(res[k].fair.reward)}`)],
    ['Quest cards stuck at the end', ...policies.map((k) => res[k].questsStuck.join(', ') || 'none')],
    ['Minutes with a story card waiting on content not yet producible', ...policies.map((k) => fmt(res[k].questBlocked))],
    ['Expansions / barn upgrades bought', ...policies.map((k) => `${res[k].expansions} / ${res[k].barn}`)],
    ['Acorns at the end', ...policies.map((k) => fmt(res[k].acorns))],
    ['Treasury first above 10 E-hours (usually saving for a Town Project)', ...policies.map((k) => (res[k].sat ? `day ${res[k].sat.day}, L${res[k].sat.L}, ${res[k].sat.play.toFixed(0)} h` : 'never'))],
    ['Unspent treasury when L40 is reached, in hours of E(L)', ...policies.map((k) => res[k].tEH.toFixed(0))],
    ['Play time from L20 with more than 15 E-hours in the treasury', ...policies.map((k) => `${(100 * res[k].rich).toFixed(0)} %`)],
    ['Town Projects completed / Grand decor bought', ...policies.map((k) => `${res[k].projects.length} / ${res[k].grand}`)],
    ['Townsfolk requests filled / offered', ...policies.map((k) => `${res[k].townsfolk.filled} / ${res[k].townsfolk.offered}`)],
    ['Golden orders filled (of which duet goods)', ...policies.map((k) => `${res[k].golden} (${res[k].duetOrders})`)],
    ['Largest overflow stacks (mean units while in overflow)', ...policies.map((k) => res[k].overflowTop.slice(0, 3).map(([i, q]) => `${i} ${q.toFixed(0)}`).join(', ') || '—')],
  ]));
  p('');
  H(4, 'Longest waits between an unlock and being able to buy it (calendar / play)');
  for (const k of policies) {
    p(`- **${k}**: ` + res[k].waits.slice(0, 6).map((w) => `${w.key} ${hhmm(w.cal)} cal / ${hhmm(w.play)} play`).join('; '));
  }
  p('');
  H(4, 'Unlocked items never produced');
  for (const k of policies) p(`- **${k}** (${res[k].never.length}): ${res[k].never.join(', ') || 'none'}`);
  return { text: L.join('\n'), res, X };
}

function numbersReport(X, md) {
  const B = index(derive(MODEL, {}));
  const L = [];
  const p = (s = '') => L.push(s);
  p(md ? '### New numbers produced by the fixed variant' : '== New numbers (fixed variant) ==');
  p('');
  p(mdTable(['Lvl', 'E(L) old → new', 'XP to next old → new', 'Cumulative XP new', 'Level-up coins new'],
    X.levels.map((l, i) => [l.L, `${fmt(B.levels[i].E)} → ${fmt(l.E)}`, `${fmt(B.levels[i].toNext ?? 0)} → ${fmt(l.toNext ?? 0)}`, fmt(l.cumAt), fmt(l.coins)])));
  p('');
  const chg = (a, b) => (a === b ? fmt(a) : `${fmt(a)} → ${fmt(b)}`);
  p(mdTable(['Crop', 'Yield', 'V', 'Seed', 'Net/plot-h'], X.crops.map((c) => { const o = B.crop.get(c.id);
    return [c.id, chg(o.yield, c.yield), chg(o.v, c.v), chg(o.seed, c.seed), `${fmt(((o.gross - o.seed) * 60) / o.min)} → ${fmt(((c.gross - c.seed) * 60) / c.min)}`]; })));
  p('');
  p(mdTable(['Feed / animal good', 'V old → new'], [...X.feeds.map((f) => [f.id, chg(B.feed.get(f.id).v, f.v)]), ...X.animals.map((a) => [a.product, chg(B.animal.get(a.id).v, a.v)])]));
  p('');
  p(mdTable(['Recipe', 'Building', 'Time', 'V old → new', 'Added/h old → new'], X.recipes.map((r) => { const o = B.recipe.get(r.id);
    return [r.id, r.building, hhmm(r.min), chg(o.v, r.v), `${fmt((o.added * 60) / o.min)} → ${fmt((r.added * 60) / r.min)}`]; })));
  p('');
  p(mdTable(['Building', 'Cost old → new', 'Slot 1 old → new'], X.buildings.map((b) => { const o = B.building.get(b.id); return [b.id, chg(o.cost, b.cost), chg(o.slotCost(1), b.slotCost(1))]; })));
  p('');
  p(mdTable(['Expansion', 'Lvl', 'Coins old → new'], X.expansions.map((e, i) => [e.id, e.level, chg(B.expansions[i].coins, e.coins)])));
  p('');
  p(mdTable(['Barn upgrade', 'Lvl', 'Coins old → new'], X.barn.map((b, i) => [b.n, b.level, chg(B.barn[i].coins, b.coins)])));
  return L.join('\n');
}

function staticReport(X, md, rules) {
  const A = staticAnalysis(X, rules);
  const L = [];
  const p = (s = '') => L.push(s);
  p(md ? '### Static analysis (formula-level, no play)' : '== Static analysis ==');
  p('');
  p('**Crops — net coins per plot-hour if replanted the moment they ripen, and the value of one Compost (+1 unit)**');
  p('');
  p(mdTable(['Crop', 'Lvl', 'Grow', 'Net/plot-h', 'Net/planting', '+1 unit (Compost) as % of net'],
    A.crops.map((c) => [c.id, c.L, hhmm(c.min), fmt(c.netH), fmt(c.net), `${(100 * c.compostGain).toFixed(0)} %`])));
  p('');
  const sess = A.crops.filter((c) => c.min <= 60).sort((a, b) => b.netH - a.netH);
  p(`Best session crop (≤ 60 min) per plot-hour at every level: ${[...new Set(A.bestCropPerHour.map((x) => x.id))].join(', ')}; ` +
    `best/worst session crop per plot-hour = ${(sess[0].netH / sess[sess.length - 1].netH).toFixed(2)}× (${sess[0].id} vs ${sess[sess.length - 1].id}).`);
  p('');
  p('**Recipes — value added per building-hour (a building crafts one item at a time)**');
  p('');
  p(mdTable(['Building', 'Best per hour', 'coins/h', 'Worst per hour', 'coins/h', 'Recipes'],
    A.bestPerBuilding.filter((b) => b.n).map((b) => [b.b, b.best, fmt(b.bestH), b.worst, fmt(b.worstH), b.n])));
  p('');
  const dom = A.recipes.filter((r) => r.dominatedBy.length);
  const domC = A.crops.filter((c) => c.dominatedBy.length);
  p(`Dominated recipes (another recipe of the same building, unlocked no later, beats them per hour AND per craft): ${dom.length} of ${A.recipes.length}` +
    (dom.length ? `: ${dom.map((r) => `${r.id} (by ${r.dominatedBy.slice(0, 2).join('/')})`).join(', ')}` : ''));
  p('');
  p(`Dominated crops (another crop unlocked no later beats them per plot-hour AND per planting): ${domC.length} of ${A.crops.length}` +
    (domC.length ? `: ${domC.map((c) => `${c.id} (by ${c.dominatedBy.slice(0, 2).join('/')})`).join(', ')}` : ''));
  p('');
  p(`Wheat → Flour → Bread: 3 Wheat worth ${A.breadChain.wheatValue} coins (seed ${A.breadChain.seedCost}) become one Bread worth ${A.breadChain.breadV} (${A.breadChain.multiple.toFixed(1)}×), in 10 machine-minutes.`);
  p('');
  p(`Compost V = ${A.compost.v}; one Compost on ${A.compost.best.map((b) => `${b.id} adds ${fmt(b.gain)} (${b.ratio.toFixed(1)}×)`).join(', ')}. ` +
    `A horse cycle (2 Manure → 6 Compost) is worth up to ${fmt(A.compost.horsePerCycle)} coins of extra crop, vs. its listed net ${A.compost.horseListed}.`);
  p('');
  p(`Mastery reward pool (★1 + ★2 coins, ★1–★3 XP, all items): ${fmt(A.mastery.coins)} coins and ${fmt(A.mastery.xp)} XP. Largest: ` +
    A.mastery.top.map((m) => `${m.id} ${fmt(m.coins)} coins (★1 at ${m.n1}, ★2 at ${m.n2})`).join('; '));
  p('');
  p(`Feed Mill at full housing during active play: ${A.feedMill.chickenFeedH.toFixed(0)} Chicken Feed, ${A.feedMill.livestockFeedH.toFixed(0)} Livestock Feed, ` +
    `${A.feedMill.slopH.toFixed(0)} Pig Slop per hour = **${A.feedMill.millMinPerH.toFixed(0)} mill-minutes per hour** (one mill = 60).`);
  p('');
  p(`County Fair: a point is 100 coins of entered goods (V / 100, one decimal); the weekly target W = E × ${A.fair.wHours} / 100 points; ` +
    `a medal pays ${A.fair.pay} × the value of its threshold, so blue-ribbon crops (free points) and entries both pay like an order.`);
  return { text: L.join('\n'), A };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Acceptance checks (GDD §4.9 "perfect logic" contract, simulation part, and the §4.6 pacing targets)
// ---------------------------------------------------------------------------------------------------------------
const PACING = { // reference couple (casual policy), 5-seed means: [level, play hours min, max, calendar day min, max]
  L5: [5, 0.4, 1.0, 0, 1], L10: [10, 2.4, 3.6, 4, 9], L20: [20, 10.5, 16, 24, 38], L30: [30, 45, 70, 100, 170], L40: [40, 110, 180, 240, 420] };
function acceptance(variantName, days, md) {
  const V = VARIANTS[variantName];
  const X = index(derive(MODEL, V.d));
  const A = staticAnalysis(X, V.rules);
  const pols = Object.keys(POLICIES);
  const seeds = [1, 2, 3, 4, 5];
  const runs = {};
  for (const k of pols) runs[k] = seeds.map((sd) => summarize(new Farm(X, k, sd, days, V.rules).run()));
  const mean = (arr) => arr.reduce((a2, b2) => a2 + b2, 0) / arr.length;
  const lv = (r, L) => r.levels.find((y) => y.L === L);
  const rows = [];
  const chk = (name, ok, detail) => rows.push([name, ok ? 'PASS' : 'FAIL', detail]);
  let modelOk = true;
  try { execFileSync(process.execPath, [path.join(HERE, 'economy-model.mjs')], { encoding: 'utf8' }); } catch { modelOk = false; }
  chk('Model contract R1–R18 (economy-model.mjs)', modelOk, modelOk ? 'all checks passed' : 'economy-model.mjs reports failures');
  const port = checkPort(index(derive(MODEL, {})));
  chk('R1 port: simulator = model', !port.length, port.length ? port.slice(0, 3).join('; ') : 'every price, level, expansion, barn and quest matches');
  const dr = A.recipes.filter((r) => r.dominatedBy.length), dc = A.crops.filter((c) => c.dominatedBy.length);
  chk('No dominated recipe (per building)', !dr.length, `${dr.length} of ${A.recipes.length}`);
  chk('No dominated crop', !dc.length, `${dc.length} of ${A.crops.length}`);
  const sessBest = [...new Set(A.bestCropPerHour.map((x) => x.id))];
  chk('No single best session crop', sessBest.length >= 4, `best per plot-hour changes ${sessBest.length - 1} times: ${sessBest.join(' → ')}`);
  for (const [key, [L, h0, h1, d0, d1]] of Object.entries(PACING)) {
    const hs = runs.casual.map((r) => lv(r, L)?.play), ds = runs.casual.map((r) => lv(r, L)?.day);
    const okAll = hs.every((x) => x != null);
    const h = okAll ? mean(hs) : NaN, d = okAll ? mean(ds) : NaN;
    chk(`Pacing ${key} (reference couple)`, okAll && h >= h0 && h <= h1 && d >= d0 && d <= d1,
      `${h.toFixed(1)} h of play (target ${h0}–${h1}), day ${d.toFixed(1)} (target ${d0}–${d1})`);
  }
  for (const k of pols) {
    const never = [...new Set(runs[k].flatMap((r) => r.never))];
    chk(`No dead item (${k}, 5 seeds)`, !never.length, never.length ? never.join(', ') : 'every unlocked item was produced');
  }
  const qLeft = [...new Set(pols.flatMap((k) => runs[k].flatMap((r) => r.questsStuck.filter((id) => !/^[fgh]/.test(id)))))];
  chk('Story quests all completable', !qLeft.length, qLeft.length ? `still open at L40: ${qLeft.join(', ')}` : 'every story quest completed by L40 in every run');
  const wLeft = [...new Set(pols.flatMap((k) => runs[k].flatMap((r) => r.questsStuck.filter((id) => /^[fg]/.test(id)))))];
  chk('Weekly quests (This week tab) completable', wLeft.length <= 2, wLeft.length ? `open at L40 in some run: ${wLeft.join(', ')}` : 'all completed');
  const worst = (f2) => Math.max(...pols.flatMap((k) => runs[k].map(f2)));
  chk('Storage: overflow < 10 % of play; intake paused at 2× capacity < 0.1 % of units', worst((r) => r.overflow) < 0.1 && worst((r) => r.blocked / r.producedUnits) < 0.001,
    `worst ${(100 * worst((r) => r.overflow)).toFixed(1)} % of play in overflow; worst ${worst((r) => r.blocked)} units waited in place (${(100 * worst((r) => r.blocked / r.producedUnits)).toFixed(3)} %)`);
  chk('R14 materials never wall: coins ready but Planks/Crates missing < 2 % of play', worst((r) => r.matBlocked) < 0.02,
    `worst ${(100 * worst((r) => r.matBlocked)).toFixed(1)} % of play`);
  chk('Animals fed: < 2 % hungry adult-minutes', worst((r) => r.hungry) < 0.02, `worst ${(100 * worst((r) => r.hungry)).toFixed(1)} %`);
  chk('Orders valid (G-VALID) and mostly varied', worst((r) => r.orders.invalid) === 0 && worst((r) => r.orders.simple / r.orders.gen) < 0.35,
    `${worst((r) => r.orders.invalid)} invalid; simple fallback orders at most ${(100 * worst((r) => r.orders.simple / r.orders.gen)).toFixed(0)} %`);
  chk('Coins keep mattering: treasury > 15 E-hours < 10 % of play from L20', worst((r) => r.rich) < 0.1, `worst ${(100 * worst((r) => r.rich)).toFixed(0)} %`);
  chk('River Barge fillable: >= 50 % of crates loaded', Math.min(...pols.flatMap((k) => runs[k].map((r) => r.barge.loaded / Math.max(1, r.barge.crates)))) >= 0.5,
    `lowest ${(100 * Math.min(...pols.flatMap((k) => runs[k].map((r) => r.barge.loaded / Math.max(1, r.barge.crates))))).toFixed(0)} % of offered crates loaded`);
  const silver = (r) => Object.entries(r.fair.medals).filter(([m]) => /Silver|Gold/.test(m)).reduce((a2, [, n]) => a2 + n, 0) / Math.max(1, r.fair.weeks);
  chk('County Fair reachable: reference couple Silver+ in >= 30 % of weeks', mean(runs.casual.map(silver)) >= 0.3, `${(100 * mean(runs.casual.map(silver))).toFixed(0)} % of weeks`);
  const out = [];
  out.push(md ? '### Acceptance checks (5 seeds × 4 policies)' : '== Acceptance checks ==');
  out.push('');
  out.push(mdTable(['Check', 'Result', 'Detail'], rows));
  out.push('');
  out.push(md ? '#### Pacing robustness (5 seeds; play hours mean (min–max), mean calendar day)' : '-- pacing robustness --');
  out.push('');
  out.push(mdTable(['Policy', 'L5', 'L10', 'L20', 'L30', 'L40'], pols.map((k) => [k, ...[5, 10, 20, 30, 40].map((L) => {
    const xs = runs[k].map((r) => lv(r, L)).filter((x) => x?.play != null);
    if (xs.length < seeds.length) return '—';
    const ps = xs.map((x) => x.play);
    return `${mean(ps).toFixed(1)} h (${Math.min(...ps).toFixed(1)}–${Math.max(...ps).toFixed(1)}), day ${mean(xs.map((x) => x.day)).toFixed(0)}`;
  })])));
  return { text: out.join('\n'), rows, fails: rows.filter((r) => r[1] === 'FAIL').length };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. CLI
// ---------------------------------------------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const md = flag('md');
  const seed = Number(arg('seed', 1));
  const days = Number(arg('days', 365));
  const policies = arg('policy', 'casual,target,heavy,solo').split(',');
  const variant = arg('variant', 'base');
  const t0 = Date.now();
  if (!flag('no-static')) console.log(staticReport(index(derive(MODEL, VARIANTS[variant].d)), md, VARIANTS[variant].rules).text, '\n');
  if (flag('numbers')) console.log(numbersReport(index(derive(MODEL, VARIANTS[variant].d)), md), '\n');
  if (flag('autocal')) {
    // Fixed-point calibration of the K (income) and X (XP) anchors against the reference couple (casual policy):
    // K x= measured production / E; X x= (actual play time per band) / (target play time per band). Prints anchors to
    // paste into economy-model.mjs (K_ANCHORS, X_ANCHORS).
    const pts = [[1, 1, 4], [4, 1, 4], [7, 5, 9], [12, 10, 14], [17, 15, 19], [22, 20, 24], [27, 25, 29], [32, 30, 34], [37, 35, 39], [40, 37, 39]];
    let K = MODEL.kAnchors.map((x) => x.slice()), Xa = MODEL.xAnchors.map((x) => x.slice());
    const lerpA = (A, L) => { for (let i = 1; i < A.length; i++) { const [l0, k0] = A[i - 1], [l1, k1] = A[i]; if (L <= l1) return k0 + ((k1 - k0) * (L - l0)) / (l1 - l0); } return A[A.length - 1][1]; };
    K = pts.map(([L]) => [L, lerpA(K, L)]); Xa = pts.map(([L]) => [L, lerpA(Xa, L)]);
    const iters = Number(arg('iters', 6)), seeds = [1, 2, 3];
    for (let it = 0; it < iters; it++) {
      const X0 = index(derive(MODEL, { K, X: Xa }));
      const runs = seeds.map((sd) => summarize(new Farm(X0, 'casual', sd, days, RULES).run()));
      const tgt = X0.levels.map((l) => l.target);
      const nk = [], nx = [];
      for (const [L, a, b] of pts) {
        let prod = 0, eh = 0, play = 0;
        for (const r of runs) for (const x of r.perLevel) if (x.L >= a && x.L <= b) { prod += x.prod; eh += (x.E * x.min) / 60; play += x.min; }
        const want = seeds.length * tgt.slice(a - 1, b).reduce((s2, v) => s2 + v, 0);
        const kr = eh ? prod / eh : 1, xr = play ? want / play : 1;
        // the first four levels (45 minutes) sell almost nothing, so K is held there (pinned at 1.0) and only X is fitted
        nk.push([L, L <= 4 ? 1 : lerpA(K, L) * kr ** 0.7]); nx.push([L, lerpA(Xa, L) * xr ** 0.7]);
      }
      K = nk.map(([L, k]) => [L, +k.toFixed(2)]); Xa = nx.map(([L, x]) => [L, +x.toFixed(2)]);
      const lv = (r, L) => r.levels.find((y) => y.L === L)?.play;
      console.log(`iter ${it}: L5 ${(runs.reduce((s2, r) => s2 + lv(r, 5), 0) / 3).toFixed(2)} h, L10 ${(runs.reduce((s2, r) => s2 + lv(r, 10), 0) / 3).toFixed(1)} h, `
        + `L20 ${(runs.reduce((s2, r) => s2 + (lv(r, 20) ?? NaN), 0) / 3).toFixed(1)} h, L30 ${(runs.reduce((s2, r) => s2 + (lv(r, 30) ?? NaN), 0) / 3).toFixed(1)} h`);
      console.log(`  K ${JSON.stringify(K)}\n  X ${JSON.stringify(Xa)}`);
    }
    process.exit(0);
  }
  if (flag('checks')) {
    const r = acceptance(variant, days, md);
    console.log(r.text);
    console.error(`(acceptance in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    process.exit(r.fails ? 1 : 0);
  }
  if (flag('calib')) {
    const { res } = runAll(variant, policies, seed, days);
    for (const k of policies) {
      console.log(`calibration ${k}:`);
      for (const c of calibration(res[k])) console.log(`  ${c.band}: ${c.h.toFixed(1)} h  prod/E ${c.prodPerE?.toFixed(2)}  xp/(E/8) ${c.xpPerE8?.toFixed(2)}`);
    }
    process.exit(0);
  }
  console.log(report(variant, policies, seed, days, md).text);
  console.error(`(simulated in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

export { derive, index, Farm, VARIANTS, POLICIES, MODEL, staticAnalysis, runAll };
