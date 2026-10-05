// Pets (GDD §3.4 Pets, §6.2 #14; L10, M1b). Owned by rules-economy.
//
// Each player adopts ONE pet, a dog or a cat, and names it; it follows them. A pet takes one treat a day (Dog
// Biscuit / Cat Treat, crafted in the Kitchen): anyone may give it, from the shared Barn (Keep N asks first, like
// feeding). A pet fed on a farm day brings its owner's find the next morning (`_petFind`, at the farm-day change):
// one of a 5-planting seed packet of an unlocked crop, 3 Compost, or a collection roll (rules-goals rolls the album
// on `petFind` with `roll: true`). Petting: each player pets each pet once a day; when both players petted both
// pets on a day, each pet digs up a second find with that day's. Pets never punish neglect: an unfed pet just waits.
//
//   adoptPet {kind, name, breed?}   my pet (once; the name is the sanitised display name; wave 4: its breed)
//   petBreed {breed}        wave 4: change my pet's breed (Shiba Inu / husky / German shepherd; orange / black / white)
//   feedPet {owner}         one treat today for `owner`'s pet (RESERVED below the treat's Keep N)
//   petPet {owner}          pet `owner`'s pet (once per player per pet per day)
//   _petFind {}             system: the finds of every pet fed on an earlier day
//
// State: `players[pid].pet = null | { kind, name, at, fed: day | null, pets: { day, by: [pids] } | null,
// treasure: day | null, breed? }` (fed = the day of its last treat whose find is still to come; breed absent = the
// kind's first breed).
import { PETS, BOOSTS, isLive, levelFromXp, liveAt } from '../../content/index.js';
import { ERR, cleanName } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { sortedKeys } from '../order.js';
import { dayIndex } from '../calendar.js';
import { available, unkept, consume, intake, spend, spendAcorns } from '../economy.js';

/** True when pets are part of this build and the farm has reached their level. */
export const petsLive = (state) => isLive(PETS) && levelFromXp(state.farm.xp) >= PETS.unlock;
/** The kind row of a pet kind id ({ id, name, home, treat }), or null. */
export const petKind = (id) => PETS.kinds.find((k) => k.id === id) ?? null;
/** The pet of player `pid`, or null. */
export const petOf = (state, pid) => (Object.hasOwn(state.players, pid) ? state.players[pid].pet ?? null : null);
const today = (state, now) => dayIndex(now, state.meta.tz);

/**
 * The breeds of a pet kind (wave 4, owner wish 6): content's `PETS.kinds[i].breeds` ([{ id, name }]) when it lists
 * them, else three each. The first is the look of a pet adopted without a breed (older saves).
 */
const BREEDS_DEFAULT = Object.freeze({
  dog: [{ id: 'shiba', name: 'Shiba Inu' }, { id: 'husky', name: 'Husky' }, { id: 'shepherd', name: 'German Shepherd' }],
  cat: [{ id: 'orange', name: 'Orange Tabby' }, { id: 'black', name: 'Black Cat' }, { id: 'white', name: 'White Cat' }],
});
export const petBreeds = (kind) => petKind(kind)?.breeds ?? BREEDS_DEFAULT[kind] ?? [];
/** True when `breed` is one of the breeds of pet kind `kind`. */
export const breedOk = (kind, breed) => petBreeds(kind).some((b) => b.id === breed);
/** The breed a pet shows: its own, else its kind's first. */
export const breedOf = (pet) => (pet ? pet.breed ?? petBreeds(pet.kind)[0]?.id ?? null : null);

export const adoptPet = {
  schema: { kind: V.oneOf(...PETS.kinds.map((k) => k.id)), name: V.text(16), breed: V.opt(V.text(24)) },
  check(state, a, ctx) {
    if (!petsLive(state)) return ERR.LOCKED;
    if (petOf(state, ctx.pid)) return ERR.ALREADY_DONE;
    if (a.breed !== undefined && !breedOk(a.kind, a.breed)) return ERR.BAD_ARGS;
    return cleanName(a.name) ? null : ERR.BAD_ARGS;
  },
  apply(tx, a, ctx) {
    const name = cleanName(a.name);
    const pet = { kind: a.kind, name, at: ctx.now, fed: null, pets: null, treasure: null };
    if (a.breed !== undefined) pet.breed = a.breed;
    tx.set(['players', ctx.pid, 'pet'], pet);
    const ev = { e: 'petAdopted', pid: ctx.pid, kind: a.kind, name, by: ctx.pid };
    if (a.breed !== undefined) ev.breed = a.breed;
    tx.emit(ev);
  },
};

/** What changing a breed costs (content's PETS.breedChange; free by default). */
export const BREED_CHANGE = Object.freeze({ coins: PETS.breedChange?.coins ?? 0, acorns: PETS.breedChange?.acorns ?? 0 });

/** `petBreed {breed}` (wave 4, owner wish 6): change my pet's breed (its look only; any time, BREED_CHANGE). */
export const petBreed = {
  schema: { breed: V.text(24) },
  check(state, a, ctx) {
    const pet = petOf(state, ctx.pid);
    if (!pet) return ERR.NOT_FOUND;
    if (!breedOk(pet.kind, a.breed)) return ERR.BAD_ARGS;
    if (breedOf(pet) === a.breed && pet.breed !== undefined) return ERR.ALREADY_DONE;
    if (state.farm.wallet.coins < BREED_CHANGE.coins) return ERR.NO_COINS;
    return state.farm.wallet.acorns < BREED_CHANGE.acorns ? ERR.NO_ACORNS : null;
  },
  apply(tx, a, ctx) {
    const pet = petOf(tx.state, ctx.pid);
    if (BREED_CHANGE.coins > 0) spend(tx, ctx, BREED_CHANGE.coins, 'petBreed');
    if (BREED_CHANGE.acorns > 0) spendAcorns(tx, ctx, BREED_CHANGE.acorns, 'petBreed');
    tx.set(['players', ctx.pid, 'pet', 'breed'], a.breed);
    tx.emit({ e: 'petBreed', pid: ctx.pid, kind: pet.kind, breed: a.breed, by: ctx.pid });
  },
};

function feedCode(state, a, ctx) {
  const pet = petOf(state, a.owner);
  if (!pet) return ERR.NOT_FOUND;
  const day = today(state, ctx.now);
  if (pet.fed === day) return ERR.ALREADY_DONE;                  // one treat a day
  if (pet.fed !== null && pet.fed < day) return ERR.NOT_READY;   // this morning's find is on its way (`_petFind`)
  const treat = petKind(pet.kind).treat;
  if (available(state, treat) < 1) return ERR.NO_ITEMS;
  if (unkept(state, treat) < 1 && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
  return null;
}

export const feedPet = {
  schema: { owner: V.pid },
  check(state, a, ctx) {
    return petsLive(state) ? feedCode(state, a, ctx) : ERR.LOCKED;
  },
  apply(tx, a, ctx) {
    const pet = petOf(tx.state, a.owner);
    consume(tx, petKind(pet.kind).treat, 1);
    tx.set(['players', a.owner, 'pet', 'fed'], today(tx.state, ctx.now));
    tx.emit({ e: 'petFed', pid: a.owner, pet: pet.kind, by: ctx.pid });
  },
};

/** Players who own a pet (sorted). */
const owners = (state) => sortedKeys(state.players).filter((pid) => state.players[pid].pet);

export const petPet = {
  schema: { owner: V.pid },
  check(state, a, ctx) {
    if (!petsLive(state)) return ERR.LOCKED;
    const pet = petOf(state, a.owner);
    if (!pet) return ERR.NOT_FOUND;
    const day = today(state, ctx.now);
    return pet.pets && pet.pets.day === day && pet.pets.by.includes(ctx.pid) ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    const day = today(tx.state, ctx.now);
    const pet = petOf(tx.state, a.owner);
    const by = pet.pets && pet.pets.day === day ? [...pet.pets.by, ctx.pid].sort() : [ctx.pid];
    tx.set(['players', a.owner, 'pet', 'pets'], { day, by });
    tx.emit({ e: 'petPetted', pid: a.owner, pet: pet.kind, by: ctx.pid });
    // both players petted both pets today: each pet digs up a second find with today's (§3.4, §6.2 #14)
    const all = owners(tx.state);
    if (all.length < 2) return;
    const done = all.every((o) => {
      const p = tx.state.players[o].pet;
      return p.pets && p.pets.day === day && all.every((x) => p.pets.by.includes(x));
    });
    if (!done) return;
    for (const o of all) if (tx.state.players[o].pet.treasure !== day) tx.set(['players', o, 'pet', 'treasure'], day);
    tx.emit({ e: 'petTreasure', day, pids: all });
  },
};

/** Pets whose find is due at `now`: fed on an earlier farm day (sorted owner pids). */
export function petFindsDue(state, now) {
  const day = today(state, now);
  return owners(state).filter((pid) => {
    const p = state.players[pid].pet;
    return p.fed !== null && p.fed < day;
  });
}

/** The start of the next farm day after `now` when a pet's find is waiting for it (Infinity when none). */
export function nextPetFindAt(state, now) {
  const day = today(state, now);
  if (!owners(state).some((pid) => state.players[pid].pet.fed === day)) return Infinity;
  // the farm day changes at local midnight; step forward an hour at a time (DST-safe, at most 26 steps)
  let t = now - (now % 3_600_000) + 3_600_000;
  while (today(state, t) === day) t += 3_600_000;
  return t;
}

/** One find for `pid`'s pet, rolled on the farm's replicated pet counter. */
function find(tx, ctx, pid, pet, treasure) {
  const n = tx.state.farm.rolls.pet ?? 0;
  tx.inc(['farm', 'rolls', 'pet'], 1);
  const i = Math.floor(ctx.rng('petFind', n) * PETS.finds.length);
  const f = PETS.finds[i];
  const ev = { e: 'petFind', pid, pet: pet.kind, treasure };
  if (f.seedPacket) {
    const crops = liveAt('crops', levelFromXp(tx.state.farm.xp));
    const crop = crops[Math.floor(ctx.rng('petCrop', n) * crops.length)].id;
    const k = f.seedPacket * BOOSTS.seedPacket.plantings;
    tx.inc(['farm', 'seeds', crop], k, { dropZero: true });
    Object.assign(ev, { find: 'seeds', crop, n: k });
  } else if (f.items) {
    for (const item of sortedKeys(f.items)) intake(tx, item, f.items[item]);
    Object.assign(ev, { find: 'items', items: { ...f.items } });
  } else Object.assign(ev, { find: 'roll', roll: true });             // rules-goals rolls the album on it
  tx.emit(ev);
}

export const _petFind = {
  schema: {},
  check(state, a, ctx) {
    return petFindsDue(state, ctx.now).length ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    for (const pid of petFindsDue(tx.state, ctx.now)) {
      const pet = tx.state.players[pid].pet;
      const fedDay = pet.fed;
      find(tx, ctx, pid, pet, false);
      if (pet.treasure === fedDay) find(tx, ctx, pid, pet, true);
      tx.set(['players', pid, 'pet', 'fed'], null);
    }
  },
};
