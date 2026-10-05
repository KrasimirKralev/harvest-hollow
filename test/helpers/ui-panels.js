// ui-panels test helpers: a believable mid-game farm built through the REAL rules (place, buyAnimal, craft, tend,
// plant, system actions), so the panels' view models are tested on the shapes the rules actually write, and the
// same farm can be saved as a server snapshot for screenshots (tools: node test/helpers/ui-panels.js <dataDir>).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAction, makeCtx, SERVER_GRACE_MS } from '../../shared/rules/index.js';
import { xpForLevel, defOf, levelRow, eHours } from '../../shared/content/index.js';
import { weekOf } from '../../shared/rules/coop.js';
import { canPlace } from '../../shared/rules/grid.js';
import { resetGrid } from '../../shared/rules/grid-cache.js';
import { FARM_MIN, FARM_MAX } from '../../shared/content/config.js';
import { dueSystemActions } from '../../shared/rules/system.js';
import { validateState } from '../../shared/rules/state.js';
import { makeFarm } from '../helpers.js';

export const MIN = 60_000;
export const HOUR = 60 * MIN;

let seq = 0;
/** Run a player action; returns the result (never throws). */
export function act(s, type, args, { pid = 'p1', now }) {
  return runAction(s, { type, args }, makeCtx(s, { now, pid, cid: 'uitest', seq: ++seq, grace: SERVER_GRACE_MS }));
}

/** Run every due system action like the server's scheduler. */
export function due(s, now) {
  for (let pass = 0; pass < 8; pass++) {
    const list = dueSystemActions(s, now);
    if (!list.length) return;
    for (const a of list) {
      const v = s.meta.version + 1;
      const r = runAction(s, a, makeCtx(s, { now, pid: 'sys', cid: 'sys', seq: v, grace: SERVER_GRACE_MS }));
      if (r.ok) s.meta.version = v;
    }
  }
}

function spot(s, def, near) {
  const [x0, z0] = near ?? [FARM_MIN, FARM_MIN];
  for (let r = 0; r < 40; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < FARM_MIN || z < FARM_MIN || x >= FARM_MAX || z >= FARM_MAX) continue;
      if (canPlace(s, def, x, z, 0) === null) return [x, z];
    }
  }
  return null;
}

/** Place a def through the real `place` action (bought, or from the tray); returns the object id or null. */
export function place(s, def, now, { pid = 'p1', near } = {}) {
  const at = spot(s, def, near);
  if (!at) return null;
  let r = act(s, 'place', { def, x: at[0], z: at[1], rot: 0 }, { pid, now });
  if (!r.ok && r.code === 'BIG_SPEND') r = act(s, 'place', { def, x: at[0], z: at[1], rot: 0, confirm: ['BIG_SPEND'] }, { pid, now });
  if (!r.ok) return null;
  return r.tx.events.find((e) => e.e === 'placed')?.id ?? null;
}

const give = (s, item, n) => { s.farm.inventory[item] = (s.farm.inventory[item] ?? 0) + n; };

/**
 * A farm at level `level` on the second evening: buildings with queues (one finished, one running, one waiting),
 * hens and cows in every state, trees, crops in every stage, orders on Mabel's board, letters with progress, a
 * keep, a wish and a ledger. `now` is the wall clock the farm should look right at.
 */
export function storyFarm({ now = Date.now(), level = 9, players = ['p1', 'p2'] } = {}) {
  const t0 = now - 3 * HOUR;
  const s = makeFarm({ now: t0, players });
  s.farm.xp = xpForLevel(level) + Math.floor((xpForLevel(level + 1) - xpForLevel(level)) * 0.62);
  s.farm.wallet.coins = 150_000;
  s.farm.wallet.acorns = 14;
  due(s, t0);
  // goods (direct: the harvests of yesterday evening)
  for (const [item, n] of Object.entries({ wheat: 46, corn: 21, carrot: 14, egg: 11, milk: 5, flour: 4, wood: 24, planks: 5,
    strawberry: 7, apple: 9, chicken_feed: 9, livestock_feed: 4, cornmeal: 2, potato: 3, tomato: 6, sugarcane: 2, butter: 1,
    cream: 1, bread: 3, wooden_crate: 1 })) give(s, item, n);
  // buildings (the free Coop and Feed Mill come from the tray), homes, trees, decor
  const T = t0 + 5 * MIN;
  const ids = {};
  ids.coop = place(s, 'coop', T, { near: [34, 36] });
  ids.feedMill = place(s, 'feed_mill', T, { near: [38, 36] });
  ids.mill = place(s, 'mill', T, { near: [12, 26] });
  ids.bakery = place(s, 'bakery', T, { near: [12, 30], pid: 'p2' });
  ids.dairy = place(s, 'dairy', T, { near: [12, 34] });
  ids.sawmill = place(s, 'sawmill', T, { near: [16, 36] });
  ids.press = place(s, 'juice_press', T, { near: [20, 36], pid: 'p2' });
  ids.kitchen = place(s, 'kitchen', T, { near: [24, 36] });
  ids.cowBarn = place(s, 'cow_barn', T, { near: [36, 26] });
  ids.apple1 = place(s, 'apple_tree', T, { near: [30, 20] });
  ids.apple2 = place(s, 'apple_tree', T, { near: [33, 20], pid: 'p2' });
  ids.pine = place(s, 'pine', T, { near: [26, 20] });
  for (const d of ['flower_bed', 'flower_bed', 'scarecrow', 'sunset_bench']) place(s, d, T, { near: [30, 30] });
  // animals: hens (one a baby), cows
  for (let i = 1; i < 4; i++) act(s, 'buyAnimal', { def: 'chicken', adult: true, confirm: ['BIG_SPEND'] }, { now: T + MIN, pid: i % 2 ? 'p2' : 'p1' });
  act(s, 'buyAnimal', { def: 'chicken', adult: false, confirm: ['BIG_SPEND'] }, { now: now - 12 * MIN, pid: 'p2' });
  for (let i = 0; i < 2; i++) act(s, 'buyAnimal', { def: 'cow', adult: true, confirm: ['BIG_SPEND'] }, { now: T + MIN });
  // feed some animals at different times (one hen stays hungry)
  const hens = Object.keys(s.farm.objects).sort().filter((id) => s.farm.objects[id].def === 'chicken');
  const cows = Object.keys(s.farm.objects).sort().filter((id) => s.farm.objects[id].def === 'cow');
  if (hens[1]) act(s, 'feed', { id: hens[1] }, { now: now - 25 * MIN });
  if (hens[2]) act(s, 'feed', { id: hens[2] }, { now: now - 8 * MIN, pid: 'p2' });
  if (cows[0]) act(s, 'feed', { id: cows[0] }, { now: now - 20 * MIN });
  // queues: bakery has a finished bread, a running corn bread and a waiting muffin; others work too
  if (ids.bakery) {
    act(s, 'craft', { id: ids.bakery, recipe: 'bread' }, { now: now - 9 * MIN, pid: 'p2' });
    act(s, 'craft', { id: ids.bakery, recipe: 'corn_bread' }, { now: now - 4 * MIN });
  }
  if (ids.mill) act(s, 'craft', { id: ids.mill, recipe: 'flour' }, { now: now - 2 * MIN });
  if (ids.feedMill) {
    act(s, 'craft', { id: ids.feedMill, recipe: 'chicken_feed' }, { now: now - 3 * MIN });
    act(s, 'craft', { id: ids.feedMill, recipe: 'livestock_feed' }, { now: now - MIN, pid: 'p2' });
  }
  if (ids.dairy) act(s, 'craft', { id: ids.dairy, recipe: 'cream' }, { now: now - 6 * MIN });
  // crops in every stage on the starter plots
  const plots = Object.keys(s.farm.objects).sort().filter((id) => s.farm.objects[id].def === 'plot');
  plots.forEach((id, i) => {
    const crop = ['wheat', 'corn', 'strawberry', 'carrot'][i % 4];
    act(s, 'plant', { id, crop }, { now: now - (i % 5) * 7 * MIN, pid: i % 2 ? 'p2' : 'p1' });
  });
  // the board, the day, letters: the evenings so far answered chapter A to A9 and a few others
  due(s, now - MIN);
  const done = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'b1', 'b2', 'c1', 'e1', 'e2', ...(level >= 11 ? ['a10', 'a11'] : [])];
  s.farm.quests = { active: {}, done: Object.fromEntries(done.map((q, i) => [q, t0 - (done.length - i) * 20 * MIN])), owed: {} };
  if (level < 11) s.farm.quests.active.a10 = { at: now - 50 * MIN, n: { 1: 1 } };
  s.farm.quests.active.c2 = { at: now - 40 * MIN, n: { 0: 1, 1: 3 } };
  s.farm.quests.active.e3 = { at: now - 30 * MIN, n: { 1: 1 } };
  // a keep, a wish (L9) and a note
  act(s, 'keep', { item: 'egg', n: 4 }, { now: now - 30 * MIN, pid: 'p2' });
  act(s, 'wish', { def: 'compost_bin' }, { now: now - 20 * MIN });
  const w = Object.keys(s.farm.wishlist)[0];
  if (w) act(s, 'wishDeposit', { id: w, coins: 3000 }, { now: now - 19 * MIN });
  act(s, 'noteAdd', { x: 24, z: 30, text: 'Corn is for the cornbread! Saving the eggs for muffins ♥' }, { now: now - 40 * MIN, pid: 'p2' });
  act(s, 'sell', { item: 'wheat', qty: 10 }, { now: now - 15 * MIN });
  // the week so far: Mabel's meter with one chest open, the Couple Challenge half done by both of you
  const E = levelRow(level).E;
  s.farm.orders.meter = { w: weekOf(s, now), e: E, v: Math.floor(E * 1.05), c: 1 };
  const target = eHours(level, 8000);
  s.farm.challenge = { n: 1, done: 0, cur: { w: weekOf(s, now), tpl: 'harvest_value', target, n: Math.floor(target * 0.55),
    by: { p1: Math.floor(target * 0.3), p2: Math.floor(target * 0.25) }, rec: {}, done: false } };
  // spend down to an evening's treasury (the ledger keeps the purchases)
  s.farm.wallet.coins = Math.min(s.farm.wallet.coins, 9_400);
  resetGrid(s);
  return { state: s, ids };
}

/** Save a farm as a server snapshot ({ schema, savedAt, version, state, server }) without players: the browsers claim. */
export function writeSnapshot(dir, state) {
  const st = structuredClone(state);
  st.players = {};
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify({ schema: st.schema, savedAt: Date.now(), version: st.meta.version, state: st, server: {} }));
}

// CLI: node test/helpers/ui-panels.js <dataDir> [level]   (a snapshot for tools/shot.mjs --data <dataDir>)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node test/helpers/ui-panels.js <dataDir> [level]'); process.exit(2); }
  const { state, ids } = storyFarm({ level: Number(process.argv[3] || 9) });
  const problems = validateState(state);
  writeSnapshot(dir, state);
  console.log(JSON.stringify({ ok: problems.length === 0, problems, ids, objects: Object.keys(state.farm.objects).length, def: Boolean(defOf('plot')) }));
}
