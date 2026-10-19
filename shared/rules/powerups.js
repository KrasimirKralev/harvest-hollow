// The balloon crates' rare power-ups (release 1.0, owner request 2026-10-19; content CRATES.powerups; design and
// numbers: docs/agent-notes/crate-powerups.md). A leaf like relics.js: content imports only.
// farm.powerups = { kind: { at, until, by, n? } }: one entry per kind for the whole farm; `n` = uses left of a counted
// kind (the last use deletes it). A second one refreshes the entry (timed: +ms up to capMs from now; counted: +n up to
// maxN, until = now + ms). Effects: rainbow (farming.js plotCut: watered at planting, cropBp faster), ladybugs
// (harvestOf: bonusBp chance of +1), swarm (economy.js startCutBp: animals, trees), ticket (orders.js orderFill:
// +coinsBp granted, capped), star (crates.js _crate: a sure crate per use).
import { CRATES, levelFromXp, eHours, defOf } from '../content/index.js';

const BP = 10_000;
const PU = CRATES.powerups;
const KINDS = Object.freeze(PU.kinds.map((x) => x.id));

export const powerupOf = (id) => PU.kinds.find((x) => x.id === id) ?? null;

export const powerupIds = () => KINDS;

/** Power-up `id`'s entry while it works at `now`, else null. */
export function powerupOn(state, id, now) {
  const all = state.farm.powerups;
  const e = all && Object.hasOwn(all, id) ? all[id] : null;
  const row = powerupOf(id);
  if (!e || !(now < e.until) || !row) return null;
  if (e.n === undefined) return e;
  return e.n > 0 ? (row.maxN !== undefined && e.n > row.maxN ? { ...e, n: row.maxN } : e) : null;
}

/** [{ id, at, until, by, n? }] working at `now`, in content order (the HUD chip, the view). */
export function livePowerups(state, now) {
  const out = [];
  for (const id of KINDS) {
    const e = powerupOn(state, id, now);
    if (e) out.push({ id, ...e });
  }
  return out;
}

const valueOn = (state, id, key, now) => (powerupOn(state, id, now) ? powerupOf(id)[key] ?? 0 : 0);

export const rainbowBp = (state, now) => valueOn(state, 'rainbow', 'cropBp', now);

export const ladybugBp = (state, now) => valueOn(state, 'ladybugs', 'bonusBp', now);

export const swarmBp = (state, family, now) => (family === 'animals' || family === 'trees'
  ? valueOn(state, 'swarm', 'timeBp', now) : 0);

export function ticketBonus(state, coins, now) {
  const bp = valueOn(state, 'ticket', 'coinsBp', now);
  if (!(bp > 0) || !(coins > 0)) return 0;
  const cap = eHours(levelFromXp(state.farm.xp), powerupOf('ticket').capEBp);
  return Math.min(Math.floor((coins * bp) / BP), cap);
}

export const starOn = (state, now) => Boolean(powerupOn(state, 'star', now));

function hasLife(state) {
  for (const o of Object.values(state.farm.objects)) {
    const d = defOf(o.def);
    if (d && (d.kind === 'tree' || (d.layer === 'none' && d.kind === 'animal'))) return true;
  }
  return false;
}

/** The power-up pass `k`'s crate holds for opener ctx.pid, or null (own rng keys; never for 'sys'; no swarm without life). */
export function powerupPick(state, ctx, k) {
  if (ctx.pid === 'sys' || !Object.hasOwn(state.players, ctx.pid)) return null;
  if (Math.floor(ctx.rng('crate', k, 'powerup') * BP) >= PU.bp) return null;
  const pool = PU.kinds.filter((x) => x.id !== 'swarm' || hasLife(state));
  const total = pool.reduce((s, x) => s + x.w, 0);
  let roll = Math.floor(ctx.rng('crate', k, 'powerupKind') * total);
  for (const x of pool) {
    if (roll < x.w) return x.id;
    roll -= x.w;
  }
  return pool.at(-1).id;
}

/** Start or refresh power-up `id` found by ctx.pid; returns the entry written. */
export function grantPowerup(tx, ctx, id) {
  const row = powerupOf(id);
  const was = powerupOn(tx.state, id, ctx.now);
  const e = { at: ctx.now, until: 0, by: ctx.pid };
  if (row.n === undefined) {
    e.until = Math.min(Math.max(was ? was.until : ctx.now, ctx.now) + row.ms, ctx.now + row.capMs);
  } else {
    e.until = ctx.now + row.ms;
    e.n = Math.min((was ? was.n : 0) + row.n, row.maxN);
  }
  tx.set(['farm', 'powerups', id], e);
  return e;
}

/** Spend one use of counted power-up `id`. */
export function usePowerup(tx, id) {
  const e = tx.get(['farm', 'powerups', id]);
  if (!e || e.n === undefined) return;
  const n = Math.min(e.n, powerupOf(id)?.maxN ?? e.n);
  if (n <= 1) tx.del(['farm', 'powerups', id]);
  else tx.set(['farm', 'powerups', id, 'n'], n - 1);
}

/** validateState's check of farm.powerups: shape only, so a later retune never flags a save. */
export function powerupsOk(p, isActor) {
  if (p === undefined) return true;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  return Object.entries(p).every(([id, e]) => /^[a-z][a-z0-9_]*$/.test(id) && e !== null && typeof e === 'object'
    && !Array.isArray(e) && count(e.at) && count(e.until) && isActor(e.by)
    && Object.keys(e).length === (e.n === undefined ? 3 : 4) && (e.n === undefined || (count(e.n) && e.n >= 1)));
}
