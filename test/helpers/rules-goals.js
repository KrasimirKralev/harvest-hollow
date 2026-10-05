// Test helpers for the rules-goals lane: farms at a level, objects placed straight into a state (so goals tests do
// not depend on the economy's placement rules), the scheduler run like the server, and a key-order twin runner.
import assert from 'node:assert/strict';
import { runAction, makeCtx } from '../../shared/rules/index.js';
import { Tx, applyOps } from '../../shared/rules/tx.js';
import { processEvents } from '../../shared/rules/progress.js';
import { dueSystemActions } from '../../shared/rules/system.js';
import { validateState } from '../../shared/rules/state.js';
import { xpForLevel, defOf } from '../../shared/content/index.js';
import { tilesOf, inLand, getGrid, resetGrid } from '../../shared/rules/grid.js';
import { WORLD_TILES } from '../../shared/content/config.js';
import { makeFarm, run, must, sys, plain, T0, assertRecorded, mulberry32 } from '../helpers.js';

export { makeFarm, run, must, sys, plain, T0, mulberry32 };

/** Every goals player action, for fuzzers (test/goals.fuzz.test.js; rules-economy's invariants test may import it). */
export const GOALS_PLAYER_ACTIONS = Object.freeze(['orderFill', 'orderDiscard', 'orderPin', 'orderFlag', 'orderRush',
  'questDeliver', 'titlePick', 'claimGift', 'almanacReroll', 'noteAdd', 'noteDel', 'nameFarm', 'nameAnimal', 'markSeen',
  'sit', 'stand', 'highFive', 'keepsake', 'thank', 'tutDone', 'tutSkip', 'tutSwap', 'tutRestart',
  // M1b (wave 2): the County Fair, the River Barge, the album, the townsfolk board
  'fairEnter', 'bargeLoad', 'bargeFlag', 'albumTrade', 'folkFill', 'folkFlag', 'folkGift', 'memoryPage',
  // M2 (wave 3): perks, the Seasonal Ribbon Track, season coats, the Friendly Duel
  'perkPick', 'perkRespec', 'trackClaim', 'coatWear', 'duelInvite', 'duelAccept', 'duelDecline', 'duelCancel',
  // wave 4: a perk given back for Acorns
  'perkRefund']);

/** A 2026-10-05 Monday 10:00 in Europe/Sofia (UTC+3): a clean week start for period tests. */
export const MONDAY = Date.UTC(2026, 9, 5, 7, 0, 0);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const MIN = 60_000;

/** A farm with both players joined at `level` (XP set directly: no level-up rewards are paid). */
export function farmAt(level = 1, o = {}) {
  const s = makeFarm(o);
  s.farm.xp = xpForLevel(level);
  return s;
}

let objSeq = 0;
/** The economy's record defaults per kind (shared/rules/state.js objectProblems), so fixtures stay valid. */
function defaults(d, now) {
  if (d.layer === 'none') return { adultAt: now, fedAt: null, readyAt: null, cycle: 0, cut: 0 };
  switch (d.kind) {
    case 'building': return { slots: d.slots[0], queue: [], made: 0 };
    case 'tree': return { cycle: 0, matureAt: now, startedAt: now, readyAt: now + d.cycleMs, cut: 0 };
    case 'debris': return { origin: 'home' };
    case 'plot': return { cycle: 0, crop: null };
    default: return {};
  }
}

/** A free spot of the unlocked land for a def (scan order: rows), or null. */
export function freeSpot(state, d) {
  const grid = getGrid(state);
  for (let z = 0; z < WORLD_TILES; z++) {
    for (let x = 0; x < WORLD_TILES; x++) {
      const tiles = tilesOf(d, x, z, 0);
      if (tiles.every(([tx, tz]) => inLand(state, tx, tz) && grid[d.layer][tz * WORLD_TILES + tx] === null)) return [x, z];
    }
  }
  return null;
}

/**
 * Put an object straight into the farm (tests only, no prices or caps): returns its id. Without x/z it takes the
 * first free spot of the unlocked land, so the state stays valid.
 */
export function put(state, def, fields = {}) {
  const d = defOf(def);
  assert.ok(d, `unknown def ${def}`);
  const id = fields.id ?? `t${(++objSeq).toString(36)}.0.0`;
  const o = { def, placedAt: T0, by: 'p1', ...defaults(d, T0), ...fields };
  delete o.id;
  if (d.layer !== 'none' && (o.x === undefined || o.z === undefined)) {
    const spot = freeSpot(state, d);
    assert.ok(spot, `no room for ${def}`);
    [o.x, o.z] = spot;
  }
  if (d.layer !== 'none') o.rot ??= 0;
  state.farm.objects[id] = o;
  resetGrid(state);                                      // a direct write: drop the cached tile index
  return id;
}

/** Put goods straight into the Barn (tests only). */
export function give(state, item, n) {
  state.farm.inventory[item] = (state.farm.inventory[item] ?? 0) + n;
}

/** Run every due system action like the server's scheduler (bounded passes). Returns the types run. */
export function runDue(state, now) {
  const ran = [];
  for (let pass = 0; pass < 8; pass++) {
    const due = dueSystemActions(state, now);
    if (due.length === 0) break;
    for (const d of due) {
      const r = sys(state, d.type, d.args, now);
      assert.ok(r.ok, `${d.type} due but rejected: ${r.code} ${r.err ? r.err.stack : ''}`);
      ran.push(d.type);
    }
  }
  assert.deepEqual(dueSystemActions(state, now), [], 'a due system action did not clear its condition');
  return ran;
}

let actSeq = 1000;
/**
 * Run a player action with server semantics AND server-observed facts (ctx.ext: online, avatar, recent,
 * togetherMin), which test/helpers.js run() does not pass. Checks the recorder like run().
 */
export function act(state, type, args, { pid = 'p1', cid = 'tstcid', seq = ++actSeq, now = T0, ext = {}, grace = 250 } = {}) {
  const before = plain(state);
  const r = runAction(state, { type, args }, makeCtx(state, { now, pid, cid, seq, ext, grace }));
  assertRecorded(type, before, state, r);
  return r;
}

/** Like act() but throws unless ok. */
export function actOk(state, type, args, o) {
  const r = act(state, type, args, o);
  if (!r.ok) throw new Error(`${type} ${JSON.stringify(args)} -> ${r.code}${r.err ? `: ${r.err.stack}` : ''}`);
  return r;
}

/**
 * Feed domain events straight into the reducer, as if an economy action had just emitted them (unit tests of
 * progress.js that do not depend on the economy's actions). Checks ops/undo round trip. Returns the Tx.
 * @param {object} state @param {Array<object>} events @param {{ pid?, now?, ext?, seq? }} [o]
 */
export function credit(state, events, { pid = 'p1', now = T0, ext = {}, seq = ++actSeq, cid = 'tstcid' } = {}) {
  const before = plain(state);
  const ctx = makeCtx(state, { now, pid, cid: pid === 'sys' ? 'sys' : cid, seq, ext, grace: 250 });
  const tx = new Tx(state);
  for (const ev of events) tx.emit({ by: pid, ...ev });
  processEvents(tx, ctx);
  const fwd = structuredClone(before);
  applyOps(fwd, JSON.parse(JSON.stringify(tx.ops)));
  assert.deepEqual(plain(fwd), plain(state), 'credit: state changed outside tx.ops');
  const back = plain(state);
  applyOps(back, tx.inverse());
  assert.deepEqual(plain(back), before, 'credit: undo does not restore the prior state');
  return tx;
}

/** Events of a result, by name. */
export const evs = (r, e) => (r.ok ? r.tx.events.filter((x) => x.e === e) : []);

/** Assert a state is valid. */
export const valid = (s) => assert.deepEqual(validateState(s), []);

/** Every plain object rebuilt with its keys reversed (arrays keep their order). */
export function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k]);
    return out;
  }
  return v;
}

/** Run an action on a state and on its key-reversed twin; both must decide and write the same. */
export function runTwin(state, type, args, ctx) {
  const twin = reverseKeys(plain(state));
  const a = act(state, type, args, { ...ctx, seq: ctx.seq ?? 1 });
  const b = runAction(twin, { type, args }, makeCtx(twin, { now: ctx.now ?? T0, pid: ctx.pid ?? 'p1', cid: ctx.cid ?? 'tstcid',
    seq: ctx.seq ?? 1, ext: ctx.ext ?? {}, grace: 250 }));
  assert.equal(a.ok, b.ok, `${type} ${JSON.stringify(args)}: ${a.code} vs ${b.code}`);
  if (a.ok) assert.deepEqual(a.tx.events, b.tx.events, `${type}: events differ on the key-reversed twin`);
  assert.deepEqual(plain(twin), plain(state), `${type}: values diverge on the key-reversed twin`);
  return a;
}

/**
 * Switch on the M1b goals systems (County Fair, River Barge, townsfolk board, the M1b collection sets, chains F-H,
 * the M1b ribbons, Almanac and challenge templates, the M1b townsfolk) whatever MILESTONE says, for this test
 * process only (shared/rules/coop.js forceLiveForTests). M1b goods and buildings stay as the build has them.
 */
export async function forceM1bGoals() {
  const C = await import('../../shared/content/index.js');
  const { forceLiveForTests } = await import('../../shared/rules/coop.js');
  const m1b = (d) => d && d.m === 'M1b';
  forceLiveForTests([
    C.FAIR, C.BARGE, C.TOWNSFOLK,
    ...[...C.CONTENT.collections.values()].filter(m1b),
    ...[...C.CONTENT.quests.values()].filter((q) => m1b(q) && ['F', 'G', 'H'].includes(q.chain)),
    ...[...C.CONTENT.ribbons.values()].filter(m1b),
    ...[...C.CONTENT.npcs.values()].filter(m1b),
    ...C.ALMANAC.templates.filter(m1b), ...C.COUPLE_CHALLENGE.templates.filter(m1b),
    // the reward decor these systems give (collection displays, Fair and Barge prizes, quest trophies)
    ...[...C.CONTENT.decor.values()].filter((d) => m1b(d) && d.shop === false),
  ]);
}

/**
 * Switch on the M2 goals systems (wave 3) on top of the M1b ones, whatever MILESTONE says, for this test process only:
 * the Fair NPC league and Platinum, the horse show and hamper features, the Seasonal Ribbon Track, perks, rested XP,
 * Legacy levels, the Friendly Duel, Grandma's visit, Equal Partners, the M2 ribbons, side chains and Restoration
 * projects, and the M2 reward decor. M2 goods and buildings stay as the build has them.
 */
export async function forceM2Goals() {
  await forceM1bGoals();
  const C = await import('../../shared/content/index.js');
  const { forceLiveForTests } = await import('../../shared/rules/coop.js');
  const m2 = (d) => d && d.m === 'M2';
  forceLiveForTests([
    C.FAIR.league, ...C.FAIR.medals.filter(m2), C.SEASONAL_TRACK, C.LEGACY, C.PERKS, C.RESTED, C.DUEL,
    C.GRANDMA_VISIT, C.COOP.equalPartners,
    ...['horse_show', 'hamper_double', 'legacy', 'perks', 'seasonal_track', 'fair_league'].map((id) => C.featureOf(id)),
    ...[...C.CONTENT.ribbons.values()].filter(m2),
    ...[...C.CONTENT.quests.values()].filter((q) => m2(q) && ['F', 'G', 'H'].includes(q.chain)),
    ...[...C.CONTENT.restoration.values()].filter(m2),
    ...[...C.CONTENT.decor.values()].filter((d) => m2(d) && d.shop === false),
  ].filter(Boolean));
}
