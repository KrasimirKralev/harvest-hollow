// Content-lane test helpers: the GDD §4.3 formulas re-derived (R1), tables cloned for mutation tests, and helpers
// other lanes' tests can use instead of hard-coding content numbers (free tiles, a level with plot room).
import {
  CONTENT, PLACEABLES, MODEL, CONFIG, MILESTONE, MILESTONES, cloneTables, defOf, levelFromXp, plotCapOf, xpForLevel,
} from '../../shared/content/index.js';
export { ROOT, T0, makeFarm } from '../helpers.js';

/** The last farm level each milestone plays (GDD §10: M1a L1-12, M1b L13-25, M2 L26-40). */
export const LAST_LEVEL = Object.freeze({ M1a: 12, M1b: 25, M2: 40, M3: 40 });
/** True when milestone tag `m` is at or before milestone `upto` (a def of `m` is in a build of `upto`). */
export const upTo = (m, upto) => MILESTONES.indexOf(m) <= MILESTONES.indexOf(upto);

/**
 * A def of `family` that this build does NOT play (the first one of a later milestone), for "not live" probes that
 * must keep working when MILESTONE moves on (M1a: an M1b def; M1b: an M2 def; M2: an M3 fixture, see below). `pred` narrows the choice.
 * @param {string} family  a CONTENT Map family ('crops', 'items', 'recipes', 'decor', 'quests', 'ribbons', ...)
 */
export function notLiveDef(family, pred = () => true) {
  const d = [...CONTENT[family].values()].find((x) => !upTo(x.m, MILESTONE) && pred(x));
  return d ?? laterFixture(family, pred);
}

// The M2 build plays every family but the festivals: a "later" def is then a test fixture of milestone M3, a copy of
// the family's last matching def under a new id, registered once per process in its family (and in the twin family
// and PLACEABLES where the original is, so cropOf / itemOf / defOf resolve it like a shipped def). Its `m` keeps it out
// of live(), lookup() and every shop, so it probes "not live" exactly as a real M3 def would.
const FIXTURES = new Map();
function laterFixture(family, pred) {
  const base = [...CONTENT[family].values()].filter((x) => x.m !== 'M3' && pred(x)).at(-1);
  if (!base) throw new Error(`no ${family} def to copy for a later-milestone fixture`);
  const id = `${base.id.slice(0, 28)}_m3`;
  if (FIXTURES.has(`${family}:${id}`)) return FIXTURES.get(`${family}:${id}`);
  const put = (map, src) => { if (src && !map.has(id)) Map.prototype.set.call(map, id, Object.freeze({ ...src, id, m: 'M3' })); };
  put(CONTENT[family], base);
  for (const twin of ['crops', 'items']) if (twin !== family) put(CONTENT[twin], CONTENT[twin].get(base.id));
  put(PLACEABLES, PLACEABLES.get(base.id));
  const def = CONTENT[family].get(id);
  FIXTURES.set(`${family}:${id}`, def);
  return def;
}

/** A deep, mutable copy of every table validateContent() reads (for "the validator catches X" tests). */
export const tablesClone = () => cloneTables();

// ---- GDD §4.3 formulas (floating point is fine in tests) --------------------------------------------------------
const C = MODEL.C;
const round = Math.round;
export const nice = (n) => {
  if (n < 20) return Math.max(1, round(n));
  if (n < 100) return round(n / 5) * 5;
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return round(n / p) * p;
};
export const cropGross = (min, lvl) => (min <= 60 ? C.CROP_R * min ** C.SHORT_EXP
  : C.CROP_R * 60 ** C.SHORT_EXP * (min / 60) ** C.LONG_EXP) * (1 + C.CROP_LVL * (lvl - 1));
export const craftTime = (min, lvl) => C.CRAFT_K * min ** C.CRAFT_EXP * (1 + C.CRAFT_LVL * (lvl - 1));
export const E = (L) => CONTENT.levels[Math.min(Math.max(L, 1), CONTENT.levels.length) - 1].E;
export const minutes = (ms) => ms / 60_000;

/** Units of value V of every item, recomputed from the formulas in dependency order (R1). */
export function rederiveValues() {
  const V = new Map();
  for (const c of CONTENT.crops.values()) V.set(c.id, Math.max(1, round(cropGross(minutes(c.growMs),
    c.unlock) / c.yield)));
  for (const t of CONTENT.trees.values()) {
    if (t.relic) continue;                       // the Rainbow Tree (wave 4b relic) borrows the other trees' fruit
    V.set(t.product, round((cropGross(minutes(t.cycleMs), t.unlock) * C.TREE_MULT) / t.yield));
  }
  const members = (cls) => [...CONTENT.items.values()].filter((it) => it.classes.includes(cls));
  const cheapest = (cls) => Math.min(...members(cls).map((it) => V.get(it.id)));
  for (const f of CONTENT.feeds.values()) {
    const inVal = f.classes.reduce((s, { cls, qty }) => s + cheapest(cls) * qty, 0);
    V.set(f.id, round((inVal + C.FEED_K * Math.sqrt(minutes(f.ms))) / f.out));
  }
  for (const a of CONTENT.animals.values()) {
    const feedVal = a.feed ? V.get(a.feed) * a.feedQty : 0;
    const v = round((feedVal + C.ANIMAL_K * Math.sqrt(minutes(a.cycleMs))) / a.out);
    V.set(a.product, v);
    V.set(a.premium, v * 4);
  }
  const pending = [...CONTENT.recipes.values()];
  for (let guard = 0; pending.length && guard < 10_000; guard++) {
    const r = pending.shift();
    if (!Object.keys(r.inputs).every((i) => V.has(i))) { pending.push(r); continue; }
    const inVal = Object.entries(r.inputs).reduce((s, [i, q]) => s + V.get(i) * q, 0);
    V.set(r.id, round((inVal + craftTime(minutes(r.ms), r.unlock)) / r.out));
  }
  return V;
}

/** Value of a recipe's inputs at market value. */
export const inputValue = (r) => Object.entries(r.inputs).reduce((s, [i, q]) => s + CONTENT.items.get(i).sell * q, 0);

/** Farm XP at which a fresh farm can place one more plot than the starter plots (the first level with room). */
export function xpWithPlotRoom() {
  const starters = CONFIG.START.plots.length;
  for (let L = 1; L <= CONTENT.levels.length; L++) if (plotCapOf(L, 0) > starters) return xpForLevel(L);
  throw new Error('no level has room for a plot');
}

/**
 * Free 1x1 object-layer tiles on the Homestead of a CONTENT start layout (every START object placed, plots
 * included), in row order. Use it in tests that place something on a fresh farm.
 */
export function freeHomeTiles() {
  const taken = new Set();
  const stamp = (def, x, z) => {
    if (def.layer !== 'object') return;
    for (let dz = 0; dz < def.size[1]; dz++) for (let dx = 0; dx < def.size[0]; dx++) taken.add(`${x + dx},${z + dz}`);
  };
  for (const [x, z] of CONFIG.START.plots) stamp(PLACEABLES.get('plot'), x, z);
  for (const o of CONFIG.START.objects) stamp(defOf(o.def), o.x, o.z);
  const [[hx, hz, hw, hd]] = CONTENT.expansions.get('home').rects;
  const out = [];
  for (let z = hz; z < hz + hd; z++) for (let x = hx; x < hx + hw; x++) if (!taken.has(`${x},${z}`)) out.push([x, z]);
  return out;
}

export const levelOf = (xp) => levelFromXp(xp);
