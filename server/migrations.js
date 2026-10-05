// Persistence schema migrations (tech-architecture §5.5). migrations[n] turns a schema-n save into
// schema n+1. Each one needs a fixture test (test/fixtures/save-v<n>.json, test/persist.migrations.test.js).
// Content edits never need a migration unless they remove or rename ids, which is forbidden (use `retired`).
//
// Two layers, in this order, at every boot (server/index.js loadFarm, before the journal replays):
//   1. migrate(): the explicit, ordered steps for changes to EXISTING fields (renames, reshapes). The loader
//      first keeps the save as loaded in backups/farm.pre-migrate-v<N>.json.
//   2. backfill(): ADDITIVE fields. A lane that adds a field to createFarm() or createPlayer() (and to the key
//      sets and validateState, as common.md requires) gets it on existing saves with the value a fresh farm would
//      get at boot time, without writing a migration: every missing top-level, `meta.*`, `farm.*` and
//      `players[pid].*` key is copied from a fresh farm/player. It never overwrites a field and never looks
//      deeper than those levels (a fresh farm's starter plots must not reappear in `farm.objects`); a default
//      that must depend on the old save (e.g. "tutorial already done at level 10") needs an explicit step in 1.
import { SCHEMA, DEFAULT_TZ, createFarm, createPlayer } from '../shared/rules/state.js';
import { START } from '../shared/content/config.js';
import { defOf, levelFromXp, plotCapOf } from '../shared/content/index.js';
import { canFit } from '../shared/rules/grid.js';
import { resetGrid } from '../shared/rules/grid-cache.js';

export const CURRENT = SCHEMA;

/** @type {Array<(s: object) => object>} index = from-schema */
export const migrations = [
  (s) => s,          // 0 -> 1: nothing (schema 1 is the first)
  (s) => {           // 1 -> 2 (review-m0 #2, #3): the farm's time zone and the roll counters
    if (typeof s.meta.tz !== 'string') s.meta.tz = DEFAULT_TZ;    // loadFarm then applies HH_TZ
    if (!s.farm.rolls || typeof s.farm.rolls !== 'object') s.farm.rolls = {};
    return s;
  },
];

/**
 * Migrate a loaded state to CURRENT; returns the migrated state. Throws on a save from a newer server or with
 * no readable schema. A missing step (a lane bumped SCHEMA for additive fields only) is logged and left to
 * backfill().
 * @param {object} state @param {{ log?: { warn: Function } }} [o]
 */
export function migrate(state, { log = null } = {}) {
  let s = state;
  if (!Number.isSafeInteger(s.schema) || s.schema < 0) throw new Error(`the save has no valid schema number (${s.schema})`);
  if (s.schema > CURRENT) throw new Error(`save schema ${s.schema} is newer than this server (${CURRENT}); run the newer build`);
  while (s.schema < CURRENT) {
    const from = s.schema;
    const step = migrations[from];
    if (typeof step === 'function') s = step(s) ?? s;
    else if (log) log.warn(`no explicit migration from schema ${from}; additive fields are backfilled`);
    s.schema = from + 1;
  }
  return s;
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Copy fields a fresh farm has and this save lacks (see the header). Mutates `state`; returns the filled
 * paths ('farm.orders', 'players.p1.hearts', ...).
 * @param {object} state @param {{ now: number, tz?: string }} o
 */
export function backfill(state, { now, tz }) {
  const filled = [];
  const fresh = createFarm(state.meta && Number.isSafeInteger(state.meta.farmSeed) ? state.meta.farmSeed : 0, now,
    tz || (state.meta && state.meta.tz) || DEFAULT_TZ);
  const fill = (target, source, prefix) => {
    for (const [k, v] of Object.entries(source)) {
      if (!Object.hasOwn(target, k)) {
        target[k] = structuredClone(v);
        filled.push(`${prefix}${k}`);
      }
    }
  };
  fill(state, fresh, '');
  for (const sec of ['meta', 'farm']) if (isRecord(state[sec]) && isRecord(fresh[sec])) fill(state[sec], fresh[sec], `${sec}.`);
  if (isRecord(state.players)) {
    for (const [pid, p] of Object.entries(state.players)) {
      if (!isRecord(p)) continue;
      let fp;
      try {
        fp = createPlayer(p.name, p.color, now);
      } catch {
        continue;                       // a changed createPlayer signature: validateState reports what is missing
      }
      if (isRecord(fp)) fill(p, fp, `players.${pid}.`);
    }
  }
  return filled;
}

/**
 * Give an M0 save the starter farm of the wave-1 content (farmhouse, barn, market stand, order board, fence, paths,
 * starter debris, and the starter plots up to the plot cap) where their footprint is still free. Runs ONCE: a save
 * that already has any content starter object is left alone, so cleared debris never grows back at a boot. Called
 * by loadFarm AFTER the journal replays (the journal was accepted on the old layout). Returns the added ids.
 */
export function backfillStarter(state, { now }) {
  const objs = state.farm && state.farm.objects;
  if (!isRecord(objs) || START.objects.some((o) => Object.hasOwn(objs, o.id))) return [];
  const added = [];
  const level = levelFromXp(state.farm.xp ?? 0);
  const cap = plotCapOf(level, Math.max(0, (state.farm.expansions?.length ?? 1) - 1));
  let plots = Object.values(objs).filter((o) => o && o.def === 'plot').length;
  const put = (id, obj) => {
    resetGrid(state);
    if (canFit(state, obj.def, obj.x, obj.z, obj.rot) !== null) return;   // the couple built there
    objs[id] = obj;
    added.push(id);
  };
  for (const o of START.objects) {
    const def = defOf(o.def);
    if (!def || Object.hasOwn(objs, o.id)) continue;
    const obj = { def: o.def, x: o.x, z: o.z, rot: o.rot ?? 0, placedAt: now, by: 'sys' };
    if (def.kind === 'debris') obj.origin = 'home';
    put(o.id, obj);
  }
  START.plots.forEach(([x, z], i) => {
    const id = `home.0.${i}`;
    if (plots >= cap || Object.hasOwn(objs, id)) return;
    const n = added.length;
    put(id, { def: 'plot', x, z, rot: 0, placedAt: now, by: 'sys', cycle: 0, crop: null });
    if (added.length > n) plots++;
  });
  resetGrid(state);
  return added;
}
