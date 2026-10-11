// Babies in the pen (wave 5, owner wish L1-1; the owners chose it over the Breeding Barn, which stays for its rare
// golden coats). Owned by rules.
//
// From PEN.unlock (L8) two adults of one species living in the same home can be paired with the ❤ on the home card,
// for PEN.qty of the species' bottle item (a Baby Bottle; Chicken Feed for poultry). After the species' baby time
// (x PEN.timeBp; a Golden Hour start cuts it like a breeding) a baby appears in that home by itself (system `_pen`),
// on both screens, and grows like a bought baby (bottles, the Nursery); it is named with the usual `nameAnimal`.
// The baby needs a free place: pairing a full home grows it one room step with the pairing (wave 4b's growth, its
// price folded in like a purchase: `max` = the price seen, BIG_SPEND asks first; CAP when it is full grown, BLOCKED /
// OUT_OF_BOUNDS when something is in the way), and a baby due in a home that filled up meanwhile waits for room. One pairing per home at a time; no rolls (a
// plain coat: golden coats stay the Breeding Barn's); a pen baby is `free` (never counted as bought, so the shop's
// price curve does not move).
//
//   pair {home, a?, b?, max?}  start a pairing (a, b omitted: the first two adults of one species there, id order)
//   pairCancel {home}       before it is due: the bottle item comes back
//   _pen {}                 system: every due pairing whose home has room gets its baby
//
// State: the HOME object's `pair = { sp, a, b, at, readyAt, by, cost: { item, qty } }`. Old saves have none.
import * as C from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { objectOf, occupantsOf, capacityOf } from '../grid.js';
import { isReady } from '../time.js';
import { available, unkept, consume, intake, cutMs, useReceipts, levelOf, PRICE_SEEN, ERR_PRICE } from '../economy.js';
import { goldenHourBp } from '../coop.js';
import { isColony, babyGrowMs, homeGrowth, growHome } from './animals.js';
import { payCode, pay } from './decor.js';

const { animalOf, defOf } = C;

/** The tuning: content's PEN_BABIES when it exports one, else these defaults (owner: "from about level 8"). */
export const PEN = Object.freeze({ unlock: 8, timeBp: 10_000, qty: 1, minMs: 0, ...(C.PEN_BABIES ?? {}) });

/** True when species `sp` can have babies in the pen (content's PEN_BABIES.species when it lists them). */
const penSpecies = (sp) => !Array.isArray(PEN.species) || PEN.species.includes(sp);

const isHomeObj = (o) => Boolean(o) && defOf(o.def)?.kind === 'home';

/** True when the farm has reached the pen babies' level. */
export const penOpen = (state) => levelOf(state) >= PEN.unlock;

/** How long a pairing of `sp` started at `now` takes: max(minMs, the baby time x timeBp), less a Golden Hour start. */
export function pairMs(state, sp, now) {
  const def = animalOf(sp);
  const ms = Math.max(PEN.minMs ?? 0, Math.floor((def.babyMs * PEN.timeBp) / 10_000));
  return cutMs(ms, goldenHourBp(state, now));
}

/** What a pairing of `sp` costs: { item, qty } (the species' bottle item). */
export const pairCost = (sp) => ({ item: animalOf(sp).bottle, qty: PEN.qty });

/** The adults of home `homeId` that may be paired, by species in id order: [{ sp, adults: [ids] }]. */
function adultsOf(state, homeId, now) {
  const by = new Map();
  for (const id of occupantsOf(state, homeId)) {
    const o = state.farm.objects[id];
    const def = animalOf(o.def);
    if (!def || isColony(o) || !def.bottle || !penSpecies(o.def) || now < o.adultAt) continue;
    if (!by.has(o.def)) by.set(o.def, []);
    by.get(o.def).push(id);
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([sp, adults]) => ({ sp, adults }));
}

/** The two parents `a` names (or the first pair the home has): { a, b, sp } or { code }. */
function parentsOf(state, a, now) {
  const home = objectOf(state, a.home);
  if (!isHomeObj(home)) return { code: ERR.NOT_FOUND };
  if ((a.a === undefined) !== (a.b === undefined)) return { code: ERR.BAD_ARGS };
  if (a.a === undefined) {
    const g = adultsOf(state, a.home, now).find((x) => x.adults.length >= 2);
    if (g) return { a: g.adults[0], b: g.adults[1], sp: g.sp };
    // no two adults of one species: a baby among them says NOT_READY, else there is nobody to pair
    const babies = occupantsOf(state, a.home).some((id) => now < state.farm.objects[id].adultAt);
    return { code: babies ? ERR.NOT_READY : ERR.NOT_FOUND };
  }
  if (a.a === a.b) return { code: ERR.BAD_ARGS };
  const x = objectOf(state, a.a);
  const y = objectOf(state, a.b);
  if (!x || !y || x.home !== a.home || y.home !== a.home || !animalOf(x.def)) return { code: ERR.NOT_FOUND };
  if (x.def !== y.def || isColony(x) || !animalOf(x.def).bottle || !penSpecies(x.def)) return { code: ERR.BAD_ARGS };
  if (now < x.adultAt || now < y.adultAt) return { code: ERR.NOT_READY };
  return { a: a.a, b: a.b, sp: x.def };
}

/** True when home `homeId` has a free place for one more animal now. */
const hasRoom = (state, homeId) => occupantsOf(state, homeId).length < capacityOf(state, homeId);

/** The room step a pairing of a full home takes with it (homeGrowth), null when it has room, or { code }. */
function growPlan(state, homeId) {
  if (hasRoom(state, homeId)) return null;
  const g = homeGrowth(state, homeId);
  return g.code ? { code: g.code } : g;
}

function pairCode(state, a, ctx) {
  if (!penOpen(state)) return ERR.LOCKED;
  const p = parentsOf(state, a, ctx.now);
  if (p.code) return p.code;
  if (objectOf(state, a.home).pair) return ERR.OCCUPIED;
  const g = growPlan(state, a.home);
  if (g && g.code) return g.code;
  const c = pairCost(p.sp);
  if (available(state, c.item) < c.qty) return ERR.NO_ITEMS;
  if (unkept(state, c.item) < c.qty && !confirmed(a, ERR.RESERVED)) return ERR.RESERVED;
  if (!g) return null;
  // the partner grew the home first: the step now costs more than the price on this player's screen (RC-18)
  if (a.max !== undefined && g.coins > a.max && !confirmed(a, ERR_PRICE)) return ERR_PRICE;
  return payCode(state, a, ctx, { coins: g.coins, acorns: 0 });
}

export const pair = {
  schema: { home: V.objId, a: V.opt(V.objId), b: V.opt(V.objId), max: V.opt(PRICE_SEEN) },
  check(state, a, ctx) { return pairCode(state, a, ctx); },
  apply(tx, a, ctx) {
    const p = parentsOf(tx.state, a, ctx.now);
    const cost = pairCost(p.sp);
    const g = growPlan(tx.state, a.home);
    if (g) {
      // a full home grows one room step for the baby (wave 4b's growth), its price paid with the pairing
      const def = objectOf(tx.state, a.home).def;
      pay(tx, ctx, { coins: g.coins, acorns: 0 }, `upgrade:${def}`, def);
      growHome(tx, ctx, a.home, g);
    }
    consume(tx, cost.item, cost.qty);
    // the parents' 100 % undo ends: a parent refunded in full mid-pairing would make the baby free (as the barn)
    useReceipts(tx, [p.a, p.b, a.home]);
    const readyAt = ctx.now + pairMs(tx.state, p.sp, ctx.now);
    tx.set(['farm', 'objects', a.home, 'pair'], { sp: p.sp, a: p.a, b: p.b, at: ctx.now, readyAt, by: ctx.pid, cost });
    tx.emit({ e: 'paired', home: a.home, species: p.sp, a: p.a, b: p.b, readyAt, item: cost.item, qty: cost.qty,
      by: ctx.pid, ...(g ? { step: g.coins } : {}) });
  },
};

export const pairCancel = {
  schema: { home: V.objId },
  check(state, a, ctx) {
    const h = objectOf(state, a.home);
    if (!isHomeObj(h) || !h.pair) return ERR.NOT_FOUND;
    return isReady(h.pair, ctx.now, ctx.grace) ? ERR.ALREADY_DONE : null;   // a due baby arrives by itself
  },
  apply(tx, a, ctx) {
    const cur = tx.get(['farm', 'objects', a.home, 'pair']);
    intake(tx, cur.cost.item, cur.cost.qty);
    tx.del(['farm', 'objects', a.home, 'pair']);
    tx.emit({ e: 'pairCancelled', home: a.home, species: cur.sp, item: cur.cost.item, qty: cur.cost.qty, by: ctx.pid });
  },
};

/** Homes with a pairing (sorted ids). */
function pairedHomes(state) {
  const out = [];
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) if (objs[id].pair !== undefined) out.push(id);
  return out.sort();
}

/** Homes whose baby is due at `now` and have room for it (sorted ids). */
export function pensDue(state, now) {
  return pairedHomes(state).filter((id) => state.farm.objects[id].pair.readyAt <= now && hasRoom(state, id));
}

/** The earliest future moment a baby comes due (Infinity when none waits on time; a full home waits on room). */
export function penNextAt(state, now) {
  let t = Infinity;
  for (const id of pairedHomes(state)) {
    const r = state.farm.objects[id].pair.readyAt;
    if (r > now && r < t) t = r;
  }
  return t;
}

export const _pen = {
  schema: {},
  check(state, a, ctx) { return pensDue(state, ctx.now).length ? null : ERR.NOT_READY; },
  apply(tx, a, ctx) {
    let i = 0;
    for (const home of pensDue(tx.state, ctx.now)) {
      const cur = tx.get(['farm', 'objects', home, 'pair']);
      const def = animalOf(cur.sp);
      let id = ctx.newId(i++);
      while (objectOf(tx.state, id)) id = ctx.newId(i++);
      // a newborn grows like a bought baby; the pairing player's Rancher perk speeds it as if they had bought it
      tx.set(['farm', 'objects', id], { def: cur.sp, home, placedAt: ctx.now, by: cur.by,
        adultAt: ctx.now + babyGrowMs(tx.state, def, { now: ctx.now, pid: cur.by }), fedAt: null, readyAt: null,
        cycle: 0, cut: 0, baby: true, free: true });
      tx.del(['farm', 'objects', home, 'pair']);
      tx.emit({ e: 'penBorn', id, species: cur.sp, home, parents: [cur.a, cur.b], pid: cur.by, by: ctx.pid });
    }
  },
};

/**
 * The home card's ❤ line (pure): { open, code, pair, readyAt, waiting, species, pick, cost, ms, grow, coins }. code =
 * what `pair {home}` answers now (null = the ❤ works; RESERVED and BIG_SPEND count as confirmed); pair = the running
 * pairing or null; waiting = its baby is due but the home is full (grow it); species = the pairable adults by species;
 * pick = the two `pair {home}` takes; grow = the room step a full home takes with the pairing (homeGrowth, with code
 * and blockers when it cannot grow) or null, coins = its price (send it as `max`).
 */
export function penView(state, homeId, now) {
  const h = objectOf(state, homeId);
  const groups = isHomeObj(h) ? adultsOf(state, homeId, now) : [];
  const g = groups.find((x) => x.adults.length >= 2) ?? null;
  const cur = h?.pair ?? null;
  const sp = cur?.sp ?? g?.sp ?? null;
  // the room step a pairing would take now (homeGrowth: with its code and blockers when it cannot grow)
  const grow = g && !cur && isHomeObj(h) && !hasRoom(state, homeId) ? homeGrowth(state, homeId) : null;
  return {
    open: penOpen(state),
    code: pairCode(state, { home: homeId, confirm: [ERR.RESERVED, 'BIG_SPEND'] }, { now, grace: 0, pid: 'p1' }),
    pair: cur,
    readyAt: cur ? cur.readyAt : null,
    waiting: Boolean(cur) && cur.readyAt <= now && !hasRoom(state, homeId),
    species: groups,
    pick: g ? [g.adults[0], g.adults[1]] : null,
    cost: sp ? pairCost(sp) : null,
    ms: sp ? pairMs(state, sp, now) : 0,
    grow,
    coins: grow && !grow.code ? grow.coins : 0,
  };
}

/** The ui's first-candidate name for penView (docs/agent-notes/w5-ui-client.md). */
export const penPairPlan = penView;

/** Every home with a running pairing, for the Goal Tracker / panels: [{ home, sp, readyAt }] (sorted by home id). */
export const pairings = (state) => pairedHomes(state).map((home) => {
  const p = state.farm.objects[home].pair;
  return { home, sp: p.sp, readyAt: p.readyAt };
});
