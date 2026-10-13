// Stage 3 of the mod validation (contract §3): the boot test. Runs INSIDE a worker thread (server/mods/boot-worker.js)
// because it installs the candidate overlay into the content singleton: the farm's own process never sees it. On a COPY
// of the farm (structuredClone of the engine's state), through the real rules (runAction / makeCtx) and a simulated
// clock, every new thing is played once: crops planted, grown, harvested and sold; recipes crafted and collected; trees
// planted and picked; animals bought, fed and collected; decorations bought, moved and sold back; one tuned base def
// played; then (full) 48 simulated hours of due system actions, the economy guard (a greedy 24-hour crop day on the
// base vs the overlay at the farm's level: coins and XP per hour <= 13000 bp) and the retire check (the suspended
// overlay installed: validateState stays empty, buying / planting / crafting a retired id answers LOCKED, harvesting,
// collecting and selling what the farm has still work). validateState must stay empty after every step.
//
//   bootTest({ overlay, state, now, full }) -> { ok, errors: Problem[], checks: { ok, simHours, actions, perDef, econ,
//                                                retire } }
import { runAction, makeCtx, SERVER_GRACE_MS } from '../../shared/rules/index.js';
import { createFarm, validateState } from '../../shared/rules/state.js';
import { dueSystemActions } from '../../shared/rules/system.js';
import { canPlace, objectOf } from '../../shared/rules/grid.js';
import { resetGrid } from '../../shared/rules/grid-cache.js';
import { CONTENT, xpForLevel, levelFromXp, live, isLive, defOf, cropOf } from '../../shared/content/index.js';
import { FARM_MIN, FARM_MAX } from '../../shared/content/config.js';
import { installOverlay } from '../../shared/mod/install.js';
import { suspended } from '../../shared/mod/apply.js';
import { contentPath } from '../../shared/mod/format.js';
import { ERR } from '../../shared/net/protocol.js';

const MIN = 60_000;
const HOUR = 3_600_000;
const CONFIRM = ['BIG_SPEND', 'RESERVED', 'PINNED'];
/** Coins and XP per hour of the overlay's best crop day vs the base's, at most (tuning's 8000 bp floor gives 12500). */
export const ECON_LIMIT_BP = 13_000;

class BootFail extends Error {
  constructor(code, file, path, message, hint) {
    super(message);
    Object.assign(this, { code, file, path, hint });
  }
}

/** A simulated farm: the copy, a clock, a player and the actions run on it. */
function sim(state, now) {
  const s = { state, now, seq: 0, actions: 0 };
  const pids = Object.keys(state.players).sort();
  s.pid = pids[0];
  s.sys = (type, args) => {
    const ctx = makeCtx(s.state, { now: s.now, pid: 'sys', cid: 'sys', seq: s.state.meta.version + 1, ext: {}, grace: SERVER_GRACE_MS });
    const r = runAction(s.state, { type, args }, ctx);
    if (r.ok) { s.state.meta.version++; s.actions++; }
    return r;
  };
  if (!s.pid) {
    const r = s.sys('_join', { pid: 'p1', name: 'Tester' });
    if (!r.ok) throw new BootFail('ACTION_REJECTED', '', '', `the test farmer could not join (${r.code})`);
    s.pid = 'p1';
  }
  s.try = (type, args) => {
    const ctx = makeCtx(s.state, { now: s.now, pid: s.pid, cid: 'boottest', seq: ++s.seq, ext: {}, grace: SERVER_GRACE_MS });
    const r = runAction(s.state, { type, args: { ...args, confirm: CONFIRM } }, ctx);
    if (r.ok) { s.state.meta.version++; s.actions++; }
    if (r.err) throw new BootFail('BOOT_THROW', '', '', `${type} threw: ${String(r.err.message || r.err).slice(0, 200)}`);
    return r;
  };
  s.events = (r, e) => (r.tx ? r.tx.events.filter((x) => x.e === e) : []);
  return s;
}

/** Every step must leave a valid farm. */
function checkState(s, file, step) {
  const problems = validateState(s.state, { now: s.now });
  if (problems.length) {
    throw new BootFail('STATE_INVALID', file, '', `after ${step}: ${problems.slice(0, 3).join('; ')}`, 'the play test found the farm broken: tell the player what you tried');
  }
}

function must(s, file, type, args, label = type) {
  const r = s.try(type, args);
  if (!r.ok) throw new BootFail('ACTION_REJECTED', file, '', `${label} was refused (${r.code})`, hintFor(r.code));
  checkState(s, file, label);
  return r;
}

function hintFor(code) {
  if (code === ERR.LOCKED) return 'check unlock levels';
  if (code === ERR.NO_ITEMS) return 'check the inputs';
  return 'the game refused this step; try a different anchor or numbers';
}

function freeSpot(state, def) {
  for (let z = FARM_MIN; z < FARM_MAX; z++) {
    for (let x = FARM_MIN; x < FARM_MAX; x++) if (canPlace(state, def, x, z, 0) === null) return [x, z];
  }
  return null;
}

/** Every expansion piece owned (copy only), so a big footprint always finds a spot. */
function allLand(state) {
  state.farm.expansions = [...CONTENT.expansions.values()].filter((e) => isLive(e)).sort((a, b) => a.k - b.k).map((e) => e.id);
  resetGrid(state);
}

function place(s, file, def) {
  let spot = freeSpot(s.state, def);
  if (!spot) { allLand(s.state); spot = freeSpot(s.state, def); }
  if (!spot) throw new BootFail('ACTION_REJECTED', file, '', `no room on the farm to place ${def}`);
  const r = must(s, file, 'place', { def, x: spot[0], z: spot[1], rot: 0 }, `placing ${def}`);
  return s.events(r, 'placed')[0]?.id ?? Object.keys(s.state.farm.objects).find((id) => s.state.farm.objects[id].def === def);
}

/** A fresh, rich farm at `level` (when the farm's copy has no room for a step). */
export function freshFarm(level, now) {
  const st = createFarm(42, now);
  const s = sim(st, now);
  st.farm.xp = xpForLevel(level);
  st.farm.wallet.coins = 50_000_000;
  allLand(st);
  return s;
}

const give = (s, item, n) => { s.state.farm.inventory[item] = (s.state.farm.inventory[item] ?? 0) + n; };

function playCrop(s, file, id) {
  const plots = Object.keys(s.state.farm.objects).filter((k) => defOf(s.state.farm.objects[k].def)?.kind === 'plot').sort();
  let plot = plots.find((k) => !s.state.farm.objects[k].crop && !s.state.farm.objects[k].gh);
  if (!plot) plot = place(s, file, 'plot');
  must(s, file, 'plant', { id: plot, crop: id }, `planting ${id}`);
  s.now = s.state.farm.objects[plot].crop.readyAt + 1000;
  must(s, file, 'harvest', { id: plot }, `harvesting ${id}`);
  must(s, file, 'sell', { item: id, qty: 1 }, `selling ${id}`);
  return ['plant', 'harvest', 'sell'];
}

function playRecipe(s, file, r) {
  let b = Object.keys(s.state.farm.objects).sort().find((k) => s.state.farm.objects[k].def === r.building);
  if (b) s.state.farm.objects[b].queue = [];             // copy only: a free slot for the test
  else b = place(s, file, r.building);
  for (const [item, q] of Object.entries(r.inputs)) give(s, item, q);
  must(s, file, 'craft', { id: b, recipe: r.id }, `crafting ${r.id}`);
  const q = s.state.farm.objects[b].queue.at(-1);
  s.now = Math.max(s.now, q.e) + 1000;
  must(s, file, 'collectTray', { id: b }, `collecting ${r.id}`);
  must(s, file, 'sell', { item: r.id, qty: 1 }, `selling ${r.id}`);
  return ['craft', 'collect', 'sell'];
}

function playTree(s, file, t) {
  const id = place(s, file, t.id);
  for (let i = 0; i < 12; i++) {
    const o = s.state.farm.objects[id];
    s.now = Math.max(s.now, o.readyAt ?? s.now) + 1000;
    const r = s.try('harvestTree', { id });
    if (r.ok) {
      checkState(s, file, `picking ${t.id}`);
      must(s, file, 'sell', { item: t.product, qty: 1 }, `selling ${t.product}`);
      return ['place', 'harvest', 'sell'];
    }
    if (r.code !== ERR.NOT_READY) throw new BootFail('ACTION_REJECTED', file, '', `picking ${t.id} was refused (${r.code})`);
  }
  throw new BootFail('ACTION_REJECTED', file, '', `${t.id} never bore fruit`);
}

function playAnimal(s, file, a) {
  let r = s.try('buyAnimal', { def: a.id, adult: true });
  if (!r.ok && (r.code === ERR.NOT_FOUND || r.code === ERR.CAP)) {
    place(s, file, a.homes[0]);
    r = s.try('buyAnimal', { def: a.id, adult: true });
  }
  if (!r.ok) throw new BootFail('ACTION_REJECTED', file, '', `buying ${a.id} was refused (${r.code})`, hintFor(r.code));
  checkState(s, file, `buying ${a.id}`);
  const id = s.events(r, 'bought')[0].id;
  const adultAt = s.state.farm.objects[id].adultAt;
  if (adultAt) s.now = Math.max(s.now, adultAt) + 1000;
  if (a.feed) give(s, a.feed, (a.feedQty ?? 1) * 2);
  must(s, file, 'feed', { id }, `feeding ${a.id}`);
  s.now = Math.max(s.now, s.state.farm.objects[id].readyAt ?? s.now) + 1000;
  const c = must(s, file, 'collect', { id }, `collecting from ${a.id}`);
  const got = s.events(c, 'collected')[0];
  if (!got || got.item !== a.product) throw new BootFail('ACTION_REJECTED', file, '', `${a.id} gave ${got ? got.item : 'nothing'}, not ${a.product}`);
  must(s, file, 'sell', { item: a.product, qty: 1 }, `selling ${a.product}`);
  return ['buy', 'feed', 'collect', 'sell'];
}

function playDecor(s, file, d) {
  const id = place(s, file, d.id);
  const o = s.state.farm.objects[id];
  let moved = false;
  for (let z = FARM_MIN; z < FARM_MAX && !moved; z++) {
    for (let x = FARM_MIN; x < FARM_MAX && !moved; x++) {
      if ((x !== o.x || z !== o.z) && canPlace(s.state, d.id, x, z, 0) === null) {
        must(s, file, 'move', { id, x, z, rot: 0 }, `moving ${d.id}`);
        moved = true;
      }
    }
  }
  s.now += HOUR;                                         // past the undo window: a resale, not a refund
  must(s, file, 'sellObject', { id }, `selling ${d.id} back`);
  return ['place', 'move', 'sell'];
}

/** The best greedy crop day at `level` with the content installed now: coins and XP per hour (x1000). */
export function cropDay(level) {
  let coins = 0;
  let xp = 0;
  for (const c of live('crops')) {
    if (c.retired || (c.unlock ?? 1) > level) continue;
    const cycles = Math.max(1, Math.floor((24 * HOUR) / c.growMs));
    coins = Math.max(coins, Math.round(((c.sell * c.yield - c.seed) * cycles * 1000) / 24));
    xp = Math.max(xp, Math.round((c.xp * cycles * 1000) / 24));
  }
  return { coins, xp };
}

const fileOf = (family, id) => contentPath(family, id);

export function bootTest({ overlay, state, now, full = true }) {
  const errors = [];
  const checks = { ok: false, simHours: 0, actions: 0, perDef: {}, econ: null, retire: false };
  let s = null;
  try {
    installOverlay(null);
    const level0 = levelFromXp(state.farm.xp);
    const baseDay = cropDay(Math.max(1, level0));
    installOverlay(overlay);
    const copy = structuredClone(state);
    s = sim(copy, now);
    const defs = overlay.defs;
    const maxUnlock = Math.max(level0, ...['crops', 'trees', 'recipes', 'animals', 'decor'].flatMap((f) => (defs[f] ?? []).map((d) => d.unlock ?? 1)));
    if (levelFromXp(copy.farm.xp) < maxUnlock) copy.farm.xp = xpForLevel(maxUnlock);   // copy only
    copy.farm.wallet.coins = Math.max(copy.farm.wallet.coins, 50_000_000);
    copy.farm.inventory = {};
    copy.farm.overflow = {};
    checkState(s, '', 'preparing the copy');
    const step = (family, d, fn) => {
      checks.perDef[d.id] = fn(s, fileOf(family, d.id), d);
    };
    for (const c of defs.crops ?? []) step('crops', c, (ss, f) => playCrop(ss, f, c.id));
    for (const r of defs.recipes ?? []) step('recipes', r, (ss, f) => playRecipe(ss, f, r));
    for (const t of defs.trees ?? []) step('trees', t, (ss, f) => playTree(ss, f, t));
    for (const a of defs.animals ?? []) {
      try {
        step('animals', a, (ss, f) => playAnimal(ss, f, a));
      } catch (err) {
        // the farm's homes may be full: a fresh farm proves the breed itself
        if (!(err instanceof BootFail) || err.code !== 'ACTION_REJECTED') throw err;
        const f = freshFarm(Math.max(maxUnlock, 1), s.now);
        checks.perDef[a.id] = playAnimal(f, fileOf('animals', a.id), a);
        s.actions += f.actions;
      }
    }
    for (const d of defs.decor ?? []) step('decor', d, (ss, f) => playDecor(ss, f, d));
    // tuning: one tuned base crop / recipe played
    const tc = (overlay.patch?.crops ?? []).find((c) => c.unlock <= levelFromXp(copy.farm.xp));
    if (tc) checks.perDef[tc.id] = playCrop(s, 'tuning.json', tc.id);
    const tr = (overlay.patch?.recipes ?? []).find((r) => r.unlock <= levelFromXp(copy.farm.xp) && !r.duet);
    if (tr) checks.perDef[tr.id] = playRecipe(s, 'tuning.json', tr);

    if (full) {
      // 48 simulated hours of what the rules schedule by time
      for (let h = 0; h < 48; h++) {
        s.now += HOUR;
        for (let pass = 0; pass < 8; pass++) {
          const due = dueSystemActions(s.state, s.now, {});
          if (!due.length) break;
          for (const a of due) {
            const r = s.sys(a.type, a.args || {});
            if (r.err) throw new BootFail('BOOT_THROW', '', '', `${a.type} threw: ${String(r.err.message || r.err).slice(0, 200)}`);
          }
        }
        checkState(s, '', `hour ${h + 1}`);
        checks.simHours = h + 1;
      }
      // the economy guard, at the farm's own level
      const modDay = cropDay(Math.max(1, level0));
      const coinsBp = baseDay.coins ? Math.round((modDay.coins * 10_000) / baseDay.coins) : 10_000;
      const xpBp = baseDay.xp ? Math.round((modDay.xp * 10_000) / baseDay.xp) : 10_000;
      checks.econ = { coinsBp, xpBp };
      if (coinsBp > ECON_LIMIT_BP || xpBp > ECON_LIMIT_BP) {
        throw new BootFail('ECON_GUARD', 'tuning.json', '', `a crop day would pay ${coinsBp / 100} % coins and ${xpBp / 100} % experience of the game's`,
          'make the times less short');
      }
      // the retire check: what the farm has keeps working, nothing new can be bought
      const keep = {};
      for (const c of defs.crops ?? []) {
        const plot = Object.keys(s.state.farm.objects).sort().find((k) => defOf(s.state.farm.objects[k].def)?.kind === 'plot' && !s.state.farm.objects[k].crop && !s.state.farm.objects[k].gh)
          ?? place(s, fileOf('crops', c.id), 'plot');
        must(s, fileOf('crops', c.id), 'plant', { id: plot, crop: c.id }, `planting ${c.id}`);
        keep[c.id] = plot;
      }
      installOverlay(suspended(overlay));
      checkState(s, '', 'retiring the mod');
      const locked = (file, type, args) => {
        const r = s.try(type, args);
        if (r.ok || r.code !== ERR.LOCKED) {
          throw new BootFail('RETIRE_FAILED', file, '', `${type} of a retired thing answered ${r.ok ? 'ok' : r.code}, not LOCKED`);
        }
      };
      for (const c of defs.crops ?? []) {
        const free = Object.keys(s.state.farm.objects).sort().find((k) => defOf(s.state.farm.objects[k].def)?.kind === 'plot' && !s.state.farm.objects[k].crop && !s.state.farm.objects[k].gh);
        if (free) locked(fileOf('crops', c.id), 'plant', { id: free, crop: c.id });
        s.now = Math.max(s.now, s.state.farm.objects[keep[c.id]].crop.readyAt) + 1000;
        const r = s.try('harvest', { id: keep[c.id] });
        if (!r.ok) throw new BootFail('RETIRE_FAILED', fileOf('crops', c.id), '', `a retired ${c.id} in the ground could not be harvested (${r.code})`);
        const sold = s.try('sell', { item: c.id, qty: 1 });
        if (!sold.ok) throw new BootFail('RETIRE_FAILED', fileOf('crops', c.id), '', `a retired ${c.id} could not be sold (${sold.code})`);
        checkState(s, fileOf('crops', c.id), `harvesting a retired ${c.id}`);
      }
      for (const r of defs.recipes ?? []) {
        const b = Object.keys(s.state.farm.objects).sort().find((k) => s.state.farm.objects[k].def === r.building);
        if (b) {
          s.state.farm.objects[b].queue = [];
          for (const [item, q] of Object.entries(r.inputs)) give(s, item, q);
          locked(fileOf('recipes', r.id), 'craft', { id: b, recipe: r.id });
        }
      }
      for (const d of [...(defs.decor ?? []), ...(defs.trees ?? [])]) {
        const spot = freeSpot(s.state, d.id);
        if (spot) locked(fileOf(defs.decor?.includes(d) ? 'decor' : 'trees', d.id), 'place', { def: d.id, x: spot[0], z: spot[1], rot: 0 });
      }
      for (const a of defs.animals ?? []) locked(fileOf('animals', a.id), 'buyAnimal', { def: a.id, adult: true });
      checkState(s, '', 'the retire check');
      checks.retire = true;
    }
    checks.actions = s.actions;
    checks.ok = true;
  } catch (err) {
    if (s) checks.actions = s.actions;
    if (err instanceof BootFail) {
      errors.push({ stage: 'boot', code: err.code, file: err.file, path: err.path, message: err.message, ...(err.hint ? { hint: err.hint } : {}) });
    } else {
      errors.push({ stage: 'boot', code: 'BOOT_THROW', file: '', path: '', message: String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : err).slice(0, 300) });
    }
  } finally {
    installOverlay(null);
  }
  return { ok: errors.length === 0, errors, checks };
}

export { cropOf };
