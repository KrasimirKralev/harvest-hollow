// The Animal Nursery (L19) and the Breeding Barn (L28) of GDD §3.4 (M2). Owned by rules-economy.
//
// Nursery: a BABY gets a three-step care card (Feed, Play, Groom), each step one of its bottle item (Baby Bottle;
// Chicken Feed for chicks and ducklings), at least NURSERY.stepGapMs apart, by either player. Once the card is full
// the couple picks a personality (the idle animation set) and a specialty: Bountiful (+5 % bonus-product chance) or
// Tidy (+1 Compost Bin point per collection). Optional and purely positive: the care steps do not touch the growth
// (Baby Bottles do that), a later step may come after the baby grew up, and nothing is lost by stopping.
//
// Breeding Barn: two adults of one species start a breeding (cost: 2 of the species' bottle item); after 2 x the
// species' baby time (a Golden Hour start counts) a baby is ready and either player brings it home and names it.
// Its coat (white 40 % / brown 30 % / spotted 25 % / golden 5 %) is rolled when it arrives, keyed on the species'
// breeding counter `farm.breed.n[species]` (replicated, bumped in the same tx), with pity: a golden coat at the
// latest on every BREEDING.goldenPity-th breeding since the last golden one. Parents lose only their 100 % undo; coats change
// nothing but the look (no power creep). One breeding at a time (the barn has one pen).
//
//   nurse {id}                               the next care step for baby `id` (feed, play, groom)
//   nursePick {id, personality, specialty}   after the third step, once
//   breed {a, b}                             start a breeding of two adults of one species
//   breedCancel {}                           before it is ready: the bottles come back
//   breedCollect {name?, home?}              bring the baby home (a home of its species with room) and name it: the
//                                            name goes where every animal name lives, rules-goals' farm.names
//                                            (actions/social.js nameAnimal renames it later)
//
// State: `farm.breed = { cur: null | { sp, a, b, at, readyAt, by, cost: { item, qty } }, n: { sp: count },
// pity: { sp: breedings since the last golden coat } }`; animal fields `nurse { n, at, by: [pids] }`, `pers`,
// `spec`, `coat`, `bcoat` (a bred coat under a season coat), `cardBy` (a baby the Level-up Bloom grew up may still
// start its card until then).
import { animalOf, featureOf, isLive, levelFromXp, NURSERY, BREEDING } from '../../content/index.js';
import { ERR, cleanName } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { objectOf, occupantsOf, capacityOf } from '../grid.js';
import { isReady } from '../time.js';
import { available, unkept, consume, intake, cutMs, useReceipts } from '../economy.js';
import { goldenHourBp } from '../coop.js';
import { isColony, homesWithRoom, specialtyOf, babyGrowMs } from './animals.js';

const isAnimalObj = (o) => Boolean(o) && Boolean(animalOf(o.def)) && o.home !== undefined;

/** True when `featureId` and its system table are part of this build and the farm has reached its level. */
function systemOpen(state, featureId, table) {
  const f = featureOf(featureId);
  return Boolean(f) && isLive(f) && isLive(table) && levelFromXp(state.farm.xp) >= Math.max(f.unlock, table.unlock);
}
/** The Nursery is open (feature `nursery`, L19, M2). */
export const nurseryOpen = (state) => systemOpen(state, 'nursery', NURSERY);
/** The Breeding Barn is open (feature `breeding`, L28, M2). */
export const breedingOpen = (state) => systemOpen(state, 'breeding', BREEDING);

/** Is `n` of `item` usable now: null, NO_ITEMS or (below Keep N, unconfirmed) RESERVED. */
function itemsCode(state, a, item, n) {
  if (available(state, item) < n) return ERR.NO_ITEMS;
  if (unkept(state, item) < n && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
  return null;
}

// ---- the Nursery --------------------------------------------------------------------------------------------------

/** The care step `o` gets next ('feed' | 'play' | 'groom'), or null when its card is full. */
export function nextCareStep(o) {
  const n = o && o.nurse ? o.nurse.n : 0;
  return n < NURSERY.steps.length ? NURSERY.steps[n] : null;
}

/** When the next care step of `o` is allowed (0 = now). */
export const nextCareAt = (o) => (o && o.nurse ? o.nurse.at + NURSERY.stepGapMs : 0);

/**
 * True while `o` may START a Nursery card: it is a baby, or a Level-up Bloom grew it up before its baby time was over
 * (`cardBy`, the moment it would have grown up: the Bloom never takes the Nursery away). A started card goes on.
 */
export const cardOpen = (o, now) => Boolean(o) && (now < o.adultAt || (Number.isSafeInteger(o.cardBy) && now < o.cardBy));

function nurseCode(state, a, ctx) {
  if (!nurseryOpen(state)) return ERR.LOCKED;
  const o = objectOf(state, a.id);
  if (!isAnimalObj(o)) return ERR.NOT_FOUND;
  if (isColony(o)) return ERR.BAD_ARGS;
  if (!o.nurse && !cardOpen(o, ctx.now)) return ERR.ALREADY_DONE;        // a card starts while it is a baby
  if (!nextCareStep(o)) return ERR.ALREADY_DONE;
  if (ctx.now < nextCareAt(o)) return ERR.COOLDOWN;
  return itemsCode(state, a, animalOf(o.def).bottle, NURSERY.bottlesPerStep);
}

export const nurse = {
  schema: { id: V.objId },
  check(state, a, ctx) { return nurseCode(state, a, ctx); },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    const def = animalOf(o.def);
    const step = nextCareStep(o);
    consume(tx, def.bottle, NURSERY.bottlesPerStep);
    const by = [...new Set([...(o.nurse ? o.nurse.by : []), ctx.pid])].sort();
    const n = (o.nurse ? o.nurse.n : 0) + 1;
    tx.set(['farm', 'objects', a.id, 'nurse'], { n, at: ctx.now, by });
    if (o.cardBy !== undefined) tx.del(['farm', 'objects', a.id, 'cardBy']);   // the card started: its window is done
    tx.del(['farm', 'objects', a.id, 'rcpt']);                              // a cared-for baby is no longer pristine
    tx.emit({ e: 'nursed', id: a.id, animal: o.def, step, n, of: NURSERY.steps.length, item: def.bottle, by: ctx.pid });
  },
};

export const nursePick = {
  schema: { id: V.objId, personality: V.oneOf(...NURSERY.personalities),
    specialty: V.oneOf(...NURSERY.specialties.map((x) => x.id)) },
  check(state, a) {
    if (!nurseryOpen(state)) return ERR.LOCKED;
    const o = objectOf(state, a.id);
    if (!isAnimalObj(o)) return ERR.NOT_FOUND;
    if (o.spec !== undefined) return ERR.ALREADY_DONE;
    return nextCareStep(o) === null ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    const o = tx.get(['farm', 'objects', a.id]);
    tx.set(['farm', 'objects', a.id, 'pers'], a.personality);
    tx.set(['farm', 'objects', a.id, 'spec'], a.specialty);
    tx.emit({ e: 'nurseDone', id: a.id, animal: o.def, personality: a.personality, specialty: a.specialty,
      carers: o.nurse.by, by: ctx.pid });
  },
};

/** The specialty row of animal `o` (actions/animals.js applies it at collection). */
export { specialtyOf };

// ---- the Breeding Barn --------------------------------------------------------------------------------------------

/** What a breeding of `species` costs: { item, qty } (2 Baby Bottles, or 2 Chicken Feed for poultry). */
export function breedCost(species) {
  const def = animalOf(species);
  const qty = def.bottle === 'baby_bottle' ? BREEDING.cost.bottles : BREEDING.cost.poultryFeed;
  return { item: def.bottle, qty };
}

/** How long a breeding of `species` takes if it starts at `now` (2 x the baby time; Golden Hour cuts it). */
export function breedMs(state, species, now) {
  return cutMs(animalOf(species).babyMs * BREEDING.timeMul, goldenHourBp(state, now));
}

/** The breeding running now, or null. */
export const breedingOf = (state) => state.farm.breed?.cur ?? null;

function breedCode(state, a, ctx) {
  if (!breedingOpen(state)) return ERR.LOCKED;
  if (a.a === a.b) return ERR.BAD_ARGS;
  const x = objectOf(state, a.a);
  const y = objectOf(state, a.b);
  if (!isAnimalObj(x) || !isAnimalObj(y)) return ERR.NOT_FOUND;
  if (x.def !== y.def || isColony(x)) return ERR.BAD_ARGS;             // two of one species; bees swarm, never breed
  if (ctx.now < x.adultAt || ctx.now < y.adultAt) return ERR.NOT_READY; // adults only
  if (breedingOf(state)) return ERR.OCCUPIED;
  if (homesWithRoom(state, animalOf(x.def)).length === 0) return ERR.CAP; // the baby needs a home with room
  const c = breedCost(x.def);
  return itemsCode(state, a, c.item, c.qty);
}

export const breed = {
  schema: { a: V.objId, b: V.objId },
  check(state, a, ctx) { return breedCode(state, a, ctx); },
  apply(tx, a, ctx) {
    const sp = tx.get(['farm', 'objects', a.a]).def;
    const cost = breedCost(sp);
    consume(tx, cost.item, cost.qty);
    const readyAt = ctx.now + breedMs(tx.state, sp, ctx.now);
    // parents keep their timers and cycles; their 100 % undo ends (a parent refunded in full mid-breeding made the
    // calf free, GDD §9 #9 / #40, RC-08)
    useReceipts(tx, [a.a, a.b]);
    tx.set(['farm', 'breed', 'cur'], { sp, a: a.a, b: a.b, at: ctx.now, readyAt, by: ctx.pid, cost });
    tx.emit({ e: 'breedStarted', species: sp, a: a.a, b: a.b, readyAt, by: ctx.pid });
  },
};

export const breedCancel = {
  schema: {},
  check(state, a, ctx) {
    const cur = breedingOf(state);
    if (!cur) return ERR.NOT_FOUND;
    return isReady(cur, ctx.now, ctx.grace) ? ERR.ALREADY_DONE : null;  // a ready baby is brought home, not undone
  },
  apply(tx, a, ctx) {
    const cur = tx.get(['farm', 'breed', 'cur']);
    intake(tx, cur.cost.item, cur.cost.qty);
    tx.set(['farm', 'breed', 'cur'], null);
    tx.emit({ e: 'breedCancelled', species: cur.sp, by: ctx.pid, item: cur.cost.item, qty: cur.cost.qty });
  },
};

/**
 * The coat the next bred baby of `species` gets (pure: the panel can only show it after the roll, but client and
 * server agree): { coat, golden } keyed on (farm seed, 'breed', species, its breeding count).
 */
export function coatRoll(state, ctx, species) {
  const n = state.farm.breed?.n?.[species] ?? 0;
  const since = state.farm.breed?.pity?.[species] ?? 0;
  const golden = BREEDING.coats.find((c) => c.id === 'golden');
  if (golden && since + 1 >= BREEDING.goldenPity) return { coat: golden.id, golden: true };
  let r = Math.floor(ctx.rng('breed', species, n) * 10_000);
  for (const c of BREEDING.coats) {
    if (r < c.bp) return { coat: c.id, golden: c.id === 'golden' };
    r -= c.bp;
  }
  const last = BREEDING.coats.at(-1);
  return { coat: last.id, golden: last.id === 'golden' };
}

function homeFor(state, a, sp) {
  if (a.home === undefined) {
    const homes = homesWithRoom(state, animalOf(sp));
    return homes.length ? { home: homes[0] } : { code: ERR.CAP };
  }
  const h = objectOf(state, a.home);
  if (!h || !animalOf(sp).homes.includes(h.def)) return { code: ERR.NOT_FOUND };
  return occupantsOf(state, a.home).length < capacityOf(state, a.home) ? { home: a.home } : { code: ERR.CAP };
}

export const breedCollect = {
  schema: { name: V.opt(V.text(16)), home: V.opt(V.objId) },
  check(state, a, ctx) {
    const cur = breedingOf(state);
    if (!cur) return ERR.NOT_FOUND;
    if (!isReady(cur, ctx.now, ctx.grace)) return ERR.NOT_READY;
    if (a.name !== undefined && !cleanName(a.name)) return ERR.BAD_ARGS;
    if (objectOf(state, ctx.newId(0))) return ERR.ID_TAKEN;
    return homeFor(state, a, cur.sp).code ?? null;
  },
  apply(tx, a, ctx) {
    const cur = tx.get(['farm', 'breed', 'cur']);
    const sp = cur.sp;
    const def = animalOf(sp);
    const { home } = homeFor(tx.state, a, sp);
    const { coat, golden } = coatRoll(tx.state, ctx, sp);
    const n = tx.state.farm.breed.n[sp] ?? 0;
    const since = tx.state.farm.breed.pity[sp] ?? 0;
    tx.set(['farm', 'breed', 'n', sp], n + 1);
    tx.set(['farm', 'breed', 'pity', sp], golden ? 0 : since + 1);
    tx.set(['farm', 'breed', 'cur'], null);
    const id = ctx.newId(0);
    const name = a.name !== undefined ? cleanName(a.name) : null;
    // a newborn: it grows like a bought baby (bottles, the Nursery); bred, so never counted as bought (free)
    const rec = { def: sp, home, placedAt: ctx.now, by: ctx.pid,
      adultAt: ctx.now + babyGrowMs(tx.state, def, ctx), fedAt: null, readyAt: null, cycle: 0,
      cut: 0, baby: true, free: true, coat };
    tx.set(['farm', 'objects', id], rec);
    if (name && tx.state.farm.names) {
      tx.set(['farm', 'names', id], { name, by: ctx.pid, at: ctx.now });
      tx.emit({ e: 'named', what: 'animal', id, species: sp, text: name, first: true, by: ctx.pid });
    }
    tx.del(['farm', 'objects', home, 'rcpt']);                    // a home with an animal is no longer pristine
    const ev = { e: 'bred', id, species: sp, coat, golden, home, parents: [cur.a, cur.b], by: ctx.pid };
    if (name) ev.name = name;
    tx.emit(ev);
  },
};

/** When the running breeding is ready (Infinity when none runs): for the scheduler-free panels and tests. */
export const breedReadyAt = (state) => breedingOf(state)?.readyAt ?? Infinity;
