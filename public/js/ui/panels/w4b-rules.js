// The ui lane's ONE door to the wave-4b rules (owner wishes 2026-10-05): balloon loot crates (1), the Acorn treasures
// (2), animal homes that grow (3), fruit-tree age (4) and the workshop queue's reorder + per-item finish (5). DOM-free
// and pure, so node tests drive it with a plain state; the boot loads it (the building panel, the tracker and the world
// tooltip read it), so it stays small.
//
// The rules+content lane built these at the same time as the ui (docs/agent-notes/w4b-ui-client.md): every action is
// sent under the first name of a candidate list the build registers (core.pick), every rules helper and content table
// is read through a namespace import (missing = a default or "not in this build", never a broken page), and every
// button asks the action's own `check` first.
//
//   ACT / actFor(key) / canAct(key)                 action names
//   queue (5):  waitingOf(o, now), moveKey(keys, k, to), reorderIntent(store, id, keys), finishIntent(store, id, q),
//               finishQuote(store, id, q, now) -> { acorns, exact }, FINISH_RULE (the price rule in words)
//   trees (4):  treeAgeOf(o), ageStages(), treeStageOf(years), ageLine(def, years) -> "Apple Tree · 7 years"
//   crates (1): isCrateDef(def), cratesOf(state) -> [{ id, x, z, at, until }], crateOf(state, id), lootOf(ev) ->
//               { coins, xp, acorns, items: [{ id, n }], decor: [id] }
//   treasures (2): treasures(state) -> [{ id, name, acorns, text, owned, placeable, unlock, def }], savingOf(state,
//               pid, kvGet?) -> id | null, saveForIntent(id)
//   homes (3):  homeGrowth(state, homeId) -> { cap, max, nextCap, size, nextSize, blockers: [id], tiles } | null
import { ACTIONS } from '../../../../shared/rules/index.js';
import { pick, probe, simulate, passes } from './core.js';
import * as C from '../../../../shared/content/index.js';
import * as BO from '../../../../shared/rules/actions/boosts.js';
import * as CR from '../../../../shared/rules/actions/crafting.js';
import * as TR from '../../../../shared/rules/actions/trees.js';
import * as AN from '../../../../shared/rules/actions/animals.js';
import * as GR from '../../../../shared/rules/grid.js';
import { dayIndex } from '../../../../shared/rules/calendar.js';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isSafeInteger(v) ? v : d);
const fn = (mod, ...names) => {
  for (const n of names) if (typeof mod?.[n] === 'function') return mod[n];
  return null;
};
const table = (...names) => {
  for (const n of names) if (C[n] !== undefined && C[n] !== null) return C[n];
  return null;
};
const listOf = (t) => (t instanceof Map ? [...t.values()] : Array.isArray(t) ? t : isObj(t) ? Object.entries(t).map(([id, v]) => ({ id, ...v })) : []);

// ---- actions --------------------------------------------------------------------------------------------------------

export const ACT = Object.freeze({
  openCrate: ['openCrate', 'crateOpen', 'openLoot', 'lootCrate', 'collectCrate'],
  reorder: ['reorder', 'reorderQueue', 'queueReorder'],
  finishItem: ['hurryItem', 'finishItem', 'hurryQueued', 'rushItem'],
  buyTreasure: ['buyRelic', 'buyTreasure', 'buyAcornItem', 'acornBuy', 'buyWonder'],
  useTreasure: ['useRelic', 'useTreasure', 'treasureUse'],
  goldenWater: ['waterAll', 'goldenWater', 'useGoldenCan'],
  timeTurner: ['turnTime', 'timeTurner', 'useTimeTurner'],
  farmhand: ['farmhand', 'farmhandRound', 'useFarmhand'],
  saveFor: ['saveFor', 'savingFor', 'setSaving', 'acornGoal'],
});

export const actFor = (key) => pick(...ACT[key]) ?? ACT[key][0];
export const canAct = (key) => pick(...ACT[key]) !== null;
const takes = (type, arg) => Boolean(type && ACTIONS[type]?.schema && Object.hasOwn(ACTIONS[type].schema, arg));

// ---- 5: the workshop queue ------------------------------------------------------------------------------------------

/**
 * The fairest per-item price (owner wish 5), in the words the panel shows: a waiting item costs what Hurry would cost
 * the moment it starts (its own whole time: 1 Acorn per started hour, at most 8); it is made at once and every later item
 * moves up by its time. The running item keeps its usual Hurry price (the time it has left).
 */
export const FINISH_RULE = 'Finish one now: what Hurry costs when it starts (1 Acorn per started hour of its own time, at most 8). Later items move up.';

const HOUR = 3_600_000;
const hurryCost = (rest) => (typeof BO.hurryCost === 'function' ? BO.hurryCost(rest)
  : Math.min(C.BOOSTS?.hurry?.maxAcorns ?? 8, Math.max(1, Math.ceil(rest / HOUR)) * (C.BOOSTS?.hurry?.acornsPerHour ?? 1)));

/** The waiting (not started) items of a building's queue at `now`, in order, with their index. Pure. */
export function waitingOf(o, now) {
  const q = Array.isArray(o?.queue) ? o.queue : [];
  const out = [];
  q.forEach((x, i) => { if (x && x.s > now) out.push({ ...x, i }); });
  return out;
}

/** `keys` with key `k` moved to position `to` (clamped). Pure. */
export function moveKey(keys, k, to) {
  const from = keys.indexOf(k);
  if (from < 0) return keys.slice();
  const out = keys.slice();
  out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, k);
  return out;
}

/** True when every waiting item has a key (an item queued before keys existed cannot be named, so no reorder). */
export const keyed = (items) => items.every((x) => Number.isSafeInteger(x.k));

/**
 * The (type, args) the build's reorder takes to put the waiting items of building `id` in the order `keys`: the rules'
 * `reorder {id, keys}` with the waiting keys, else with the whole queue's keys (the started ones first, unchanged).
 * The first shape the action's check accepts wins; null when the build has no reorder.
 */
export function reorderIntent(store, id, keys) {
  const type = pick(...ACT.reorder);
  if (!type) return null;
  const o = store?.state?.farm?.objects?.[id];
  const now = typeof store?.now === 'function' ? store.now() : 0;
  const started = Array.isArray(o?.queue) ? o.queue.filter((x) => !(x.s > now)).map((x) => x.k) : [];
  const shapes = [{ id, keys }, { id, keys: [...started, ...keys] }];
  let first = null;
  for (const args of shapes) {
    const code = probe(store, type, args);
    if (passes(code)) return { type, args };
    if (code !== 'BAD_ARGS' && !first) first = { type, args, code };
  }
  return first ?? { type, args: shapes[0], code: 'BAD_ARGS' };
}

/**
 * The (type, args) that finishes ONE queue item `q` (by its key) of building `id` now, or null when this build has no
 * per-item finish. The running item uses the plain Hurry (as today).
 */
export function finishIntent(store, id, q) {
  if (!q) return null;
  const now = typeof store?.now === 'function' ? store.now() : 0;
  if (q.s <= now) return { type: pick('hurry') ?? 'hurry', args: { id } };
  if (!Number.isSafeInteger(q.k)) return null;
  const t = pick(...ACT.finishItem);
  if (t) return { type: t, args: { id, k: q.k } };
  if (takes('hurry', 'k')) return { type: 'hurry', args: { id, k: q.k } };
  return null;
}

/**
 * Acorns finishing queue item `q` of building `id` costs now: the rules' own quote when they export one, else the exact
 * figure of a dry run (core.simulate) when it would go through, else FINISH_RULE's formula. { acorns, exact }.
 */
export function finishQuote(store, id, q, now) {
  const o = store?.state?.farm?.objects?.[id];
  if (!o || !q) return null;
  if (q.s <= now) return { acorns: hurryCost(Math.max(1, q.e - now)), exact: true };
  // the rules' own panel view of the queue (boosts.queueView: the price of every item)
  const qv = fn(BO, 'queueView');
  if (qv && Number.isSafeInteger(q.k)) {
    try {
      const row = qv(o, now).find((x) => x.k === q.k);
      if (row && Number.isSafeInteger(row.acorns)) return { acorns: row.acorns, exact: true };
    } catch { /* another shape: fall through */ }
  }
  const f = fn(BO, 'hurryItemCost', 'itemHurryCost', 'finishItemCost', 'queueHurryCost') ?? fn(CR, 'finishItemCost', 'hurryItemCost', 'itemFinishCost');
  if (f) {
    try {
      const v = f(o, q.k, now);
      const n = Number.isSafeInteger(v) ? v : Number.isSafeInteger(v?.acorns) ? v.acorns : null;
      if (n !== null) return { acorns: n, exact: true };
    } catch { /* another signature: fall through */ }
  }
  const it = finishIntent(store, id, q);
  if (it) {
    const r = simulate(store, it.type, it.args);
    const ev = r.ok ? r.events.find((e) => Number.isSafeInteger(e.acorns)) : null;
    if (ev) return { acorns: ev.acorns, exact: true };
  }
  return { acorns: hurryCost(Math.max(1, q.e - q.s)), exact: false };
}

// ---- 4: fruit trees age -----------------------------------------------------------------------------------------------

/** The default age stages (render's too: young < 5, mature < 12, grand) when content publishes none. */
export const DEFAULT_STAGES = Object.freeze([
  Object.freeze({ id: 'young', name: 'Young', from: 0, bonus: 0 }),
  Object.freeze({ id: 'mature', name: 'Mature', from: 5, bonus: 0 }),
  Object.freeze({ id: 'grand', name: 'Grand', from: 12, bonus: 0 }),
]);

/** A tree's age in years (one harvest = one year): the rules' helper, else `age`, else its harvest counter. */
export function treeAgeOf(o) {
  const f = fn(TR, 'treeAgeOf', 'treeAge', 'ageOf');
  if (f) {
    try {
      const v = f(o);
      if (Number.isSafeInteger(v)) return v;
      if (Number.isSafeInteger(v?.years)) return v.years;       // rules: { years, stage, name, bonusUnits, ... }
    } catch { /* fall through */ }
  }
  if (Number.isSafeInteger(o?.age)) return o.age;
  return int(o?.cycle);
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The age stages, youngest first: [{ id, name, from, bonus }] (content's TREE_AGE, else the defaults). */
export function ageStages() {
  const t = table('TREE_AGE', 'TREE_AGES', 'TREES_AGE');
  const raw = Array.isArray(t) ? t : Array.isArray(t?.stages) ? t.stages : null;
  if (!raw || !raw.length) return DEFAULT_STAGES;
  return raw.map((s, i) => ({ id: s.id ?? `stage${i}`, name: s.name ?? cap(String(s.id ?? `Stage ${i + 1}`)),
    from: int(s.from ?? s.at ?? s.years ?? s.min, 0), bonus: int(s.bonusUnits ?? s.bonus ?? s.fruit ?? s.extra ?? s.units, 0) }))
    .sort((a, b) => a.from - b.from);
}

/** The stage of a tree `years` old, with the next one: { stage, next, index } (rules' treeStage when exported). */
export function treeStageOf(years) {
  const stages = ageStages();
  let i = 0;
  for (let k = 0; k < stages.length; k++) if (years >= stages[k].from) i = k;
  return { stage: stages[i], next: stages[i + 1] ?? null, index: i, of: stages.length };
}

/** "Apple Tree · 7 years" (a sapling: "· sapling"). Pure. */
export function ageLine(name, years, sapling = false) {
  if (sapling) return `${name} · sapling`;
  return `${name} · ${years} year${years === 1 ? '' : 's'}`;
}

/** Extra fruit a harvest gives for the tree's age (rules' helper, else its stage's bonus). */
export function ageBonusOf(o) {
  const f = fn(TR, 'treeAgeOf');
  if (f) { try { const v = f(o); if (Number.isSafeInteger(v?.bonusUnits)) return v.bonusUnits; } catch { /* fall through */ } }
  return treeStageOf(treeAgeOf(o)).stage.bonus;
}

// ---- 1: balloon loot crates -------------------------------------------------------------------------------------------

export const isCrateDef = (def) => Boolean(def && (def.kind === 'crate' || def.crate === true || def.kind === 'loot'
  || (typeof def.id === 'string' && /(^|_)crate$/.test(def.id) && def.layer !== 'none' && def.kind !== 'decor' && def.kind !== 'item')));

/** Every unopened crate on the farm: [{ id, x, z, at, until, obj }], sorted by id. Pure. */
export function cratesOf(state) {
  const out = [];
  const objs = state?.farm?.objects ?? {};
  for (const id of Object.keys(objs).sort()) {
    const o = objs[id];
    if (isCrateDef(C.defOf(o.def)) || o.crate === true) out.push(crateRow(id, o));
  }
  const rows = state?.farm?.crates;
  if (isObj(rows)) for (const id of Object.keys(rows).sort()) if (isObj(rows[id])) out.push(crateRow(id, rows[id]));
  return out;
}
function crateRow(id, o) {
  const at = int(o.at ?? o.droppedAt ?? o.placedAt, 0);
  const until = Number.isSafeInteger(o.until) ? o.until : Number.isSafeInteger(o.expiresAt) ? o.expiresAt
    : Number.isSafeInteger(o.storeAt) ? o.storeAt : null;
  return { id, x: o.x, z: o.z, at, until, obj: o };
}
export const crateOf = (state, id) => cratesOf(state).find((c) => c.id === id) ?? null;

/** A crate's loot as one shape, from a `crateOpened` event or a loot object. Pure. */
export function lootOf(ev) {
  const l = isObj(ev?.loot) ? ev.loot : Array.isArray(ev?.loot) ? { list: ev.loot } : ev ?? {};
  const items = [];
  const add = (id, n) => {
    if (typeof id !== 'string' || !(n > 0)) return;
    const have = items.find((x) => x.id === id);
    if (have) have.n += n; else items.push({ id, n });
  };
  if (isObj(l.items)) for (const id of Object.keys(l.items).sort()) add(id, int(l.items[id]));
  for (const r of [...(Array.isArray(l.items) ? l.items : []), ...(Array.isArray(l.list) ? l.list : [])]) {
    if (isObj(r)) add(r.item ?? r.id, int(r.n ?? r.qty ?? r.q, 1));
  }
  if (typeof l.item === 'string') add(l.item, int(l.qty ?? l.n, 1));
  const golden = int(l.goldenSeeds ?? l.golden, 0);
  if (golden) add('golden_seeds', golden);
  const decor = [];
  for (const d of [l.decor, ...(Array.isArray(l.decors) ? l.decors : [])].flat()) {
    const id = typeof d === 'string' ? d : isObj(d) ? d.def ?? d.id : null;
    if (id && !decor.includes(id)) decor.push(id);
  }
  return { coins: int(l.coins, 0), xp: int(l.xp, 0), acorns: int(l.acorns, 0), items, decor };
}

// ---- 2: the Acorn treasures -----------------------------------------------------------------------------------------

/** Treasures the shop sells, cheapest first: [{ id, name, acorns, text, owned, placeable, unlock, def }]. Pure. */
export function treasures(state) {
  const t = table('TREASURES', 'ACORN_SHOP', 'ACORN_ITEMS', 'WONDERS', 'RELICS');
  let list = listOf(isObj(t) && Array.isArray(t.items) ? t.items : t);
  if (!list.length) {
    // content may mark placeable defs instead of a table: `treasure: true` / `tier: 'treasure'`
    list = [...(C.PLACEABLES?.values?.() ?? [])].filter((d) => d.treasure === true || d.tier === 'treasure' || d.unique === 'farm');
  }
  const owns = fn(AN, 'ownsTreasure') ?? fn(BO, 'ownsTreasure', 'hasTreasure');
  return list.filter((x) => x && typeof x.id === 'string').map((x) => {
    const def = C.defOf(x.def ?? x.id) ?? null;
    const id = x.id;
    const placed = Object.values(state?.farm?.objects ?? {}).some((o) => o.def === (x.def ?? id));
    const stored = int(state?.farm?.storage?.[x.def ?? id]) > 0;
    let owned = placed || stored || Boolean(state?.farm?.relics?.[id] ?? state?.farm?.treasures?.[id]);
    if (owns) { try { owned = Boolean(owns(state, id)); } catch { /* keep */ } }
    return {
      id, def, name: x.name ?? def?.name ?? id.replace(/_/g, ' '), acorns: int(x.acorns ?? x.price ?? def?.acorns, 0),
      text: x.text ?? x.blurb ?? def?.text ?? '', unlock: int(x.unlock ?? def?.unlock, 1), owned,
      placeable: x.kind === 'placed' || Boolean(x.def && def && def.layer !== 'none' && def.kind !== 'item'), kind: x.kind ?? null,
      fx: isObj(x.fx) ? x.fx : {}, use: x.use ?? x.fx?.daily ?? null,
    };
  }).sort((a, b) => a.acorns - b.acorns || (a.id < b.id ? -1 : 1));
}

/** Stand-in pictures until a treasure has an icon of its own: [icon id, gilded?] (an existing icon). */
export const RELIC_ART = Object.freeze({
  lucky_clover: ['clover_jar', false], golden_sprinkler: ['sprinkler', true], golden_can: ['big_watering_can', true],
  rainbow_tree: ['rainbow_rosette', false], growth_totem: ['sprout', false], farmhand: ['feed_scoop', false],
  time_turner: ['cuckoo_clock', false], golden_barn: ['barn', true],
});
/** The icon id that pictures treasure `id` ({ id, gilded }): its own (a def or relic icon) when `known(id)`, else RELIC_ART. */
export function relicIcon(id, known = () => false) {
  const r = typeof C.relicOf === 'function' ? C.relicOf(id) : null;
  const own = [r?.def, id].find((x) => x && known(x));
  if (own) return { id: own, gilded: false };
  const [alt, gilded] = RELIC_ART[id] ?? ['acorns', false];
  return { id: alt, gilded };
}

/** The treasure a player is saving for: the rules' (players[pid].saving / saveFor) else this browser's choice. */
export function savingOf(state, pid, local = null) {
  const p = state?.players?.[pid];
  const r = p && (p.save ?? p.saving ?? p.saveFor ?? p.acornGoal);
  const id = typeof r === 'string' ? r : isObj(r) ? r.id ?? r.def : null;
  const list = treasures(state);
  const ok = (x) => x && list.some((t) => t.id === x && !t.owned);
  if (ok(id)) return id;
  if (canAct('saveFor')) return null;
  return ok(local) ? local : null;
}

/** The (type, args) that buys treasure `id` (rules: buyRelic {relic}). */
export function buyIntent(id) {
  const type = actFor('buyTreasure');
  const arg = ['relic', 'id', 'def', 'treasure'].find((a) => takes(type, a)) ?? 'relic';
  return { type, args: { [arg]: id } };
}

/** The action a treasure is used with by hand (the Golden Can, the Farmhand, the Time Turner), or null (passive). */
export const USE_OF = Object.freeze({ golden_can: 'goldenWater', farmhand: 'farmhand', time_turner: 'timeTurner' });
export function useIntent(id) {
  const key = USE_OF[id];
  if (!key) return null;
  const t = pick(...ACT[key]) ?? (canAct('useTreasure') ? actFor('useTreasure') : null);
  if (!t) return null;
  return { type: t, args: ACT[key].includes(t) ? {} : { id } };
}

/** True when a once-a-day treasure was used on the farm day of `now` (farm.relics[id].d). */
export function usedToday(state, id, now) {
  const r = state?.farm?.relics?.[id];
  if (!isObj(r) || !Number.isSafeInteger(r.d)) return false;
  return r.d === dayIndex(now, state.meta?.tz);
}

/** The (type, args) that sets (or with null clears) the treasure this player saves for. */
export const saveForIntent = (id) => {
  const type = actFor('saveFor');
  const arg = ['relic', 'def', 'id'].find((a) => takes(type, a)) ?? 'relic';
  return { type, args: id === null ? {} : { [arg]: id } };
};

// ---- 3: animal homes grow -------------------------------------------------------------------------------------------

/**
 * How home `homeId` grows with its next room step: { cap, max, next, coins, size, nextSize, grows, x, z, rot, code,
 * blockers } (the rules' homeGrowth: code null = the step can be bought, CAP = full grown, BLOCKED / OUT_OF_BOUNDS =
 * the bigger footprint does not fit and `blockers` stand in the way). Without the rules' helper: capacityOf and the def.
 */
export function homeGrowth(state, homeId) {
  const o = state?.farm?.objects?.[homeId];
  const def = o && C.defOf(o.def);
  if (!def || def.kind !== 'home') return null;
  const f = fn(AN, 'homeGrowth');
  if (f) {
    try {
      const g = f(state, homeId);
      if (isObj(g)) {
        return { cap: int(g.cap, GR.capacityOf(state, homeId)), max: int(g.max, def.capacityMax ?? 0), next: int(g.next ?? g.nextCap, 0),
          coins: int(g.coins, 0), size: g.size ?? def.size, nextSize: g.nextSize ?? def.size, grows: Boolean(g.grows),
          x: int(g.x, o.x), z: int(g.z, o.z), rot: int(g.rot ?? o.rot, 0), code: g.code ?? null,
          blockers: Array.isArray(g.blockers) ? g.blockers.slice() : [] };
      }
    } catch { /* fall back */ }
  }
  const cap = GR.capacityOf(state, homeId);
  const max = int(def.capacityMax, cap);
  const step = int(def.upgradeStep, 0);
  return { cap, max, next: Math.min(max, cap + step), coins: int(def.upgradeCost, 0), size: def.size, nextSize: def.size,
    grows: false, x: o.x, z: o.z, rot: int(o.rot, 0), code: step > 0 && cap < max ? null : 'CAP', blockers: [] };
}

const rectTiles = ([w0, d0], x, z, rot) => {
  const [w, d] = rot % 2 ? [d0, w0] : [w0, d0];
  const out = [];
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) out.push([x + dx, z + dz]);
  return out;
};

/**
 * The tiles a growth step adds (`add`, around today's footprint) and the ones in the way (`blocked`: owned by
 * something else, or outside the farm's land) for the world preview. Pure.
 */
export function growthTiles(state, homeId, g = homeGrowth(state, homeId)) {
  const o = state?.farm?.objects?.[homeId];
  if (!o || !g || !g.grows) return { add: [], blocked: [] };
  const now = new Set(rectTiles(g.size, o.x, o.z, g.rot).map(([x, z]) => `${x},${z}`));
  const at = g.code ? [o.x, o.z] : [g.x, g.z];
  const add = [];
  const blocked = [];
  for (const [x, z] of rectTiles(g.nextSize, at[0], at[1], g.rot)) {
    if (now.has(`${x},${z}`)) continue;
    let owner = null;
    try { owner = GR.tileOwner(state, x, z); } catch { owner = null; }
    const inside = typeof GR.inLand === 'function' ? GR.inLand(state, x, z) : true;
    if (!inside || (owner !== null && owner !== homeId)) blocked.push([x, z]); else add.push([x, z]);
  }
  return { add, blocked };
}

/**
 * What buying one `species` costs now, with the room step folded in when its home has to grow (rules'
 * animalBuyPlan): { coins, animal, step, grows, code }; null without the rules' helper (the shop's own price stands).
 */
export function buyQuote(state, species, adult, home) {
  const f = fn(AN, 'animalBuyPlan');
  if (!f) return null;
  try {
    const p = f(state, species, adult === true, home);
    if (!isObj(p)) return null;
    return { coins: int(p.coins, 0), animal: int(p.animal, 0), step: int(p.step, 0), grows: Boolean(p.grow?.grows),
      home: p.home ?? null, code: p.code ?? null };
  } catch { return null; }
}
