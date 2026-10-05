// The economy fuzzer behind test/invariants.test.js (M1a content) and test/invariants.m1b.test.js (M1b content):
// random action sequences of BOTH players, each also run on a key-reversed twin, with the economy invariants after
// every accepted action, and the two-client prediction == server convergence through the real engine.
// Import it only after the content milestone hook is registered (the M1b file loads it with a dynamic import).
import assert from 'node:assert/strict';
import { ACTIONS, CELEBRATIONS, FX_EVENTS, runAction, makeCtx } from '../../shared/rules/index.js';
import { liveAt, recipesOf, defOf, live, levelFromXp, lookup, CONTENT, MILESTONE } from '../../shared/content/index.js';
import { validateState } from '../../shared/rules/state.js';
import { sortedKeys } from '../../shared/rules/order.js';
import { barnCap, stockOf, overflowOf } from '../../shared/rules/economy.js';
import { econDue } from '../../shared/rules/actions/expansions.js';
import { crateDue, cratesOn } from '../../shared/rules/actions/crates.js';
import { RELICS } from '../../shared/content/index.js';
import { FARM_MIN, FARM_MAX } from '../../shared/content/config.js';
import { mulberry32, plain, run, sys, T0, coopHarness } from '../helpers.js';
import { farmAt, give, ledgerBalanced, MIN, placeDef, must } from './rules.js';
import { canPlace, canFit, tilesOf, inLand } from '../../shared/rules/grid.js';
import { resetGrid } from '../../shared/rules/grid-cache.js';
import { ownCap, ownedCount } from '../../shared/rules/actions/decor.js';
import { openProject } from '../../shared/rules/actions/restoration.js';
import { dayOf } from '../../shared/rules/coop.js';
import { INTERIOR } from '../../shared/content/index.js';

const FIXED = () => INTERIOR?.fixed ?? [];

export { ACTIONS };

/** Every economy player action the generator knows (the registry test checks none is missing). */
export const ECON_FUZZED = new Set(['plant', 'water', 'compost', 'harvest', 'uproot', 'seedBasket', 'harvestTree',
  'chop', 'buyAnimal', 'tend', 'feed', 'collect', 'bottle', 'pet', 'upgradeHome', 'craft', 'duet', 'cancel', 'collectTray',
  'upgradeSlot', 'sell', 'sellSurplus', 'undoSurplus', 'storeBuy', 'upgradeBarn', 'keep', 'noFeed', 'wish', 'unwish',
  'wishDeposit', 'wishWithdraw', 'wishAnswer', 'place', 'move', 'moveBack', 'store', 'refund', 'sellObject', 'restore',
  'pinObject', 'hurry', 'buyGoldenSeeds', 'buyTool', 'openExpansion', 'expand',
  // wave 2 (M1b; pets are M2): Masterwork, the Restoration Ledger, Town Projects, pets
  'masterwork', 'donate', 'restoreFlag', 'townGive', 'townFund', 'adoptPet', 'feedPet', 'petPet',
  // wave 3 (M2): the Nursery, the Breeding Barn, the Fishing Dock, the farmhouse interior
  'nurse', 'nursePick', 'breed', 'breedCancel', 'breedCollect', 'cast', 'reel', 'furnish', 'furnishMove',
  'furnishStore', 'furnishRefund',
  // wave 4 (the owners' wish list): tray sales, upgrades, Fertilizer, weeds, looks, pet breeds
  'sellStored', 'upgradeObject', 'fertilize', 'clearWeed', 'setAvatar', 'petBreed',
  // wave 4b: balloon crates, the Acorn shop's relics, queue reorder
  'openCrate', 'buyRelic', 'waterAll', 'farmhand', 'turnTime', 'reorder', 'saveFor']);

/** The wave-4b actions (test/invariants.w4b.test.js accepts every one; elsewhere they stay out of the draw). */
export const W4B_FUZZED = Object.freeze(['openCrate', 'buyRelic', 'waterAll', 'farmhand', 'turnTime', 'reorder',
  'saveFor']);

/** The wave-4 actions (test/invariants.w4.test.js accepts every one of them; elsewhere some need their level). */
export const W4_FUZZED = Object.freeze(['sellStored', 'upgradeObject', 'fertilize', 'clearWeed', 'setAvatar',
  'petBreed']);

/** The wave-3 actions: refused before M2 (nothing of M2 is reachable). */
export const M2_FUZZED = Object.freeze(['nurse', 'nursePick', 'breed', 'breedCancel', 'breedCollect', 'cast', 'reel',
  'furnish', 'furnishMove', 'furnishStore', 'furnishRefund']);

/** The wave-2 actions: refused in an M1a build (nothing of M1b is reachable). */
export const M1B_FUZZED = Object.freeze(['masterwork', 'donate', 'restoreFlag', 'townGive', 'townFund', 'adoptPet',
  'feedPet', 'petPet']);

const PLACE_DEFS = ['plot', 'plot', 'plot', 'flower_bed', 'picket_fence', 'dirt_path', 'scarecrow', 'sprinkler',
  'heart_arbor', 'apple_tree', 'pine', 'cherry_tree', 'coop', 'cow_barn', 'pasture', 'feed_mill', 'mill', 'bakery',
  'sawmill', 'dairy', 'compost_bin', 'kitchen', 'juice_press', 'bird_bath',
  // M1b (refused while not live)
  'beehive', 'pig_pen', 'duck_pond', 'goat_yard', 'stable', 'sewing', 'pie_oven', 'chandlery', 'packing', 'fountain',
  'greenhouse_frame', 'rose_arch', 'wheelbarrow', 'orange_tree', 'peach_tree', 'greenhouse'];

/** Every plain object rebuilt with its keys in reverse order (arrays keep their order: it is replicated). */
export function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k]);
    return out;
  }
  return v;
}

function byKind(s) {
  const k = { plot: [], tree: [], animal: [], home: [], building: [], decor: [], debris: [], any: [] };
  for (const id of sortedKeys(s.farm.objects)) {
    const d = defOf(s.farm.objects[id].def);
    const kind = d.layer === 'none' ? 'animal' : d.kind;
    if (k[kind]) k[kind].push(id);
    k.any.push(id);
  }
  return k;
}

/** True when the build plays M1b content (the wave-2 actions and follow-ups join the mix). */
const WAVE2 = MILESTONE !== 'M1a';
/** True when the build plays M2 content (the wave-3 actions join the mix on an L28+ farm). */
const WAVE3 = MILESTONE === 'M2' || MILESTONE === 'M3';
const FURNITURE_IDS = ['armchair', 'sofa', 'footstool', 'side_table', 'rag_rug', 'braided_rug', 'cuckoo_clock',
  'oval_mirror', 'piano', 'fern_pot', 'hazel_portrait'];

/** Follow-ups that exercise the windows (undo, move back, trash, queue cancel, Wishlist requests, duets). */
const FOLLOW = { place: ['refund', 'move', 'sellObject', ...(WAVE2 ? ['masterwork'] : [])], move: ['moveBack'],
  sellObject: ['restore'], craft: ['craft', 'cancel'], wish: ['wishDeposit', 'unwish'], wishDeposit: ['wishWithdraw'],
  wishWithdraw: ['wishAnswer', 'wishWithdraw'], duet: ['duet'], buyAnimal: ['bottle', 'hurry'],
  plant: ['hurry', 'water'], sellSurplus: ['undoSurplus'],
  ...(WAVE2 ? { compost: ['plant'], donate: ['donate', 'restoreFlag'], townGive: ['townGive', 'townFund'], feedPet: ['petPet'] }
    : {}),
  ...(WAVE3 ? { breed: ['breedCancel', 'breedCollect', 'breedCollect'], cast: ['reel', 'cast'], nurse: ['nurse', 'nursePick'],
    furnish: ['furnishMove', 'furnishRefund', 'furnishStore', 'furnish'], furnishStore: ['furnish'],
    bottle: ['bottle', 'nurse'], buyAnimal: ['bottle', 'hurry', 'nurse', 'nurse'], nursePick: ['nurse'] } : {}) };

/** The plots of the 3 x 3 blocks the start farm laid out for giant crops (in row order), if any. */
const blocksOf = (s) => {
  const out = [];
  for (const id of sortedKeys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (o.def !== 'plot' || !id.startsWith('blk')) continue;
    const b = id.split('.')[0];
    (out.find((x) => x.b === b) ?? out[out.push({ b, ids: [] }) - 1]).ids.push(id);
  }
  return out.map((x) => x.ids);
};

/**
 * The wave-4 mix (test/invariants.w4.test.js turns it on): the wave-4 actions and their follow-ups join the draw. Off
 * by default, so the older fuzz files keep the sequences (and the acceptance counts) they were tuned on.
 */
let W4 = false;
export const enableW4 = (on = true) => { W4 = on; };
const FOLLOW_W4 = { place: ['refund', 'move', 'sellObject', 'upgradeObject'], store: ['sellStored', 'place'],
  sellStored: ['restore', 'sellStored'], upgradeObject: ['upgradeObject', 'sellObject', 'store'],
  clearWeed: ['clearWeed'], plant: ['fertilize', 'water', 'hurry'], fertilize: ['harvest', 'fertilize'],
  petBreed: ['petBreed', 'setAvatar'], setAvatar: ['setAvatar', 'petBreed'] };

/**
 * The wave-4b mix (test/invariants.w4b.test.js): crates (`_crate` runs when due), relics, queue reorder and per-item
 * finish. Off by default, like W4.
 */
let W4B = false;
export const enableW4b = (on = true) => { W4B = on; };
const FOLLOW_W4B = { buyRelic: ['waterAll', 'farmhand', 'turnTime', 'place', 'saveFor'], saveFor: ['buyRelic'],
  craft: ['craft', 'reorder', 'hurry'], reorder: ['reorder', 'hurry', 'cancel'], openCrate: ['openCrate'],
  buyAnimal: ['buyAnimal', 'upgradeHome'] };

/** One random economy action with plausible arguments drawn from the state. */
export function randomAction(rnd, s, recent = [], now = T0, last = null) {
  const pick0 = (list) => list[Math.floor(rnd() * list.length)];
  // half the time a follow-up on what the last action touched (undo, move back, cancel, the partner's duet press)
  const pick = (list) => {
    const hot = recent.filter((id) => list.includes(id));
    return hot.length && rnd() < 0.5 ? pick0(hot) : pick0(list);
  };
  const some = (list, n = 1 + Math.floor(rnd() * 4)) => {
    const out = [];
    for (let i = 0; i < n && list.length; i++) { const x = pick(list); if (!out.includes(x)) out.push(x); }
    return out;
  };
  const k = byKind(s);
  const level = levelFromXp(s.farm.xp);
  const items = [...new Set([...Object.keys(s.farm.inventory), ...Object.keys(s.farm.overflow), 'wheat', 'egg'])];
  const stroke = (list) => (list.length === 0 ? { id: 'none.1.0' }
    : rnd() < 0.5 ? { id: pick(list) } : { ids: some(list) });
  const tile = () => FARM_MIN + Math.floor(rnd() * (FARM_MAX - FARM_MIN));
  const big = rnd() < 0.7 ? { confirm: ['BIG_SPEND'] } : {};
  // the wave-2 actions join on an M1b farm (L16+: the Ledger, Masterwork, Town Projects); an L12 farm keeps the M1a mix
  const types = [...ECON_FUZZED].filter((t) => (!M1B_FUZZED.includes(t) || (WAVE2 && level >= 16))
    && (!M2_FUZZED.includes(t) || (WAVE3 && level >= 28)) && (W4 || !W4_FUZZED.includes(t))
    && (W4B || !W4B_FUZZED.includes(t)));
  const follows = { ...FOLLOW, ...(W4 ? FOLLOW_W4 : {}), ...(W4B ? FOLLOW_W4B : {}) };
  const follow = last && follows[last] && rnd() < 0.5 ? pick0(follows[last]) : null;
  // a Giant on the farm joins the common moves (it takes six chops to fell)
  const common = ['plant', 'harvest', 'tend', 'collectTray', 'craft', 'sell', 'place', 'water',
    ...(k.plot.some((id) => s.farm.objects[id].crop?.giant) ? ['chop', 'chop'] : [])];
  // the wave-4b mix leans on its own actions a little (they are 7 of ~80 types and want the right moment)
  const w4b = !W4B ? null : rnd() < 0.1 ? pick0(W4B_FUZZED)
    // a queue with two waiting items is the moment a player drags one: reorder gets its chance then
    : rnd() < 0.15 && k.building.some((id) => s.farm.objects[id].queue.filter((q) => q.s > now).length >= 2) ? 'reorder'
      : null;
  const type = follow ?? w4b ?? (rnd() < 0.3 ? pick0(common) : pick0(types));
  const blocks = blocksOf(s);
  switch (type) {
    case 'plant': {
      // sometimes a whole composted 3 x 3 block at once: a chance at a Giant
      if (blocks.length && rnd() < 0.3) return [type, { ids: pick0(blocks), crop: pick(['wheat', 'corn', 'pumpkin']) }];
      return [type, { ...stroke(k.plot), crop: pick(liveAt('crops', level)).id,
        ...(rnd() < 0.1 ? { golden: true } : {}) }];
    }
    case 'water': return [type, stroke([...k.plot, ...k.tree])];
    case 'compost':
      return [type, blocks.length && rnd() < 0.3 ? { ids: pick0(blocks) } : stroke([...k.plot, ...k.tree])];
    case 'harvest': return [type, stroke(k.plot)];
    case 'uproot': {
      // mostly a growing crop (an empty plot is the refusal case): the M1a farm's crop list grew in wave 4
      const growing = k.plot.filter((id) => s.farm.objects[id].crop && !s.farm.objects[id].crop.giant);
      return [type, stroke(growing.length && rnd() < 0.7 ? growing : k.plot)];
    }
    case 'harvestTree': return [type, stroke(k.tree)];
    case 'chop': {
      const giants = k.plot.filter((id) => s.farm.objects[id].crop?.giant);
      if (giants.length && rnd() < 0.5) return [type, rnd() < 0.5 ? { id: pick0(giants) } : { ids: some(giants) }];
      return [type, stroke([...k.tree, ...k.debris, ...giants])];
    }
    case 'seedBasket': case 'sellSurplus': case 'upgradeBarn': return [type, type === 'upgradeBarn' ? big : {}];
    case 'buyAnimal': {
      // mostly species the farm can buy at its level (a locked one now and then: LOCKED is checked too)
      const open = liveAt('animals', levelFromXp(s.farm.xp));
      return [type, { def: pick(rnd() < 0.8 && open.length ? open : live('animals')).id, adult: rnd() < 0.5, ...big }];
    }
    case 'tend': case 'feed': case 'collect': case 'pet':
      return [type, { ...stroke([...k.animal, ...k.home]), ...(rnd() < 0.5 ? { confirm: ['RESERVED'] } : {}) }];
    case 'bottle': {
      const babies = k.animal.filter((id) => s.farm.objects[id].adultAt > now);
      const id = babies.length ? pick(babies) : k.animal.length ? pick(k.animal) : 'none.1.0';
      return [type, { id, confirm: ['RESERVED'] }];
    }
    case 'upgradeHome': return [type, { id: k.home.length ? pick(k.home) : 'none.1.0', ...big }];
    case 'craft': {
      const b = k.building.length ? pick(k.building) : null;
      const rs = b ? recipesOf(s.farm.objects[b].def) : [];
      return [type, { id: b ?? 'none.1.0', recipe: rs.length ? pick(rs).id : 'bread' }];
    }
    case 'duet': {
      if (!WAVE2) {
        const bakeries = k.building.filter((id) => s.farm.objects[id].def === 'bakery');
        return [type, { id: bakeries.length ? pick(bakeries) : 'none.1.0', recipe: 'sweetheart_cake' }];
      }
      const cooks = k.building.filter((id) => ['bakery', 'kitchen'].includes(s.farm.objects[id].def));
      const id = cooks.length ? pick(cooks) : 'none.1.0';
      const duets = cooks.length ? recipesOf(s.farm.objects[id].def).filter((r) => r.duet) : [];
      return [type, { id, recipe: duets.length ? pick(duets).id : 'sweetheart_cake' }];
    }
    case 'cancel': {
      const busy = k.building.filter((id) => s.farm.objects[id].queue.some((q) => q.s > now));
      const id = busy.length ? pick(busy) : k.building.length ? pick(k.building) : 'none.1.0';
      const q = s.farm.objects[id]?.queue ?? [];
      // mostly a row still waiting its turn (a started one is the ALREADY_DONE case)
      const waiting = q.filter((x) => x.s > now).map((x) => x.k ?? 0);
      const ks = waiting.length && rnd() < 0.7 ? waiting : q.map((x) => x.k ?? 0);
      return [type, { id, k: ks.length && rnd() < 0.9 ? pick(ks) : Math.floor(rnd() * 20) }];
    }
    case 'collectTray': return [type, stroke(k.building)];
    case 'upgradeSlot': return [type, { id: k.building.length ? pick(k.building) : 'none.1.0', ...big }];
    case 'sell': {
      const item = pick(items);
      const qty = 1 + Math.floor(rnd() * 5);
      return [type, { item, qty, ...(rnd() < 0.5 ? { confirm: ['RESERVED'] } : {}) }];
    }
    case 'undoSurplus': return [type, {}];
    case 'storeBuy': return [type, { item: pick(['chicken_feed', 'livestock_feed']), qty: 1 + Math.floor(rnd() * 3) }];
    case 'keep': return [type, { item: pick(items), n: Math.floor(rnd() * 4) * 5 }];
    case 'noFeed': return [type, { item: pick(['wheat', 'corn', 'carrot', 'potato']), on: rnd() < 0.5 }];
    case 'wish': return [type, { def: pick(['flower_bed', 'kitchen', 'preserves', 'weaver', 'scarecrow']) }];
    case 'unwish': case 'wishWithdraw': case 'wishAnswer': case 'wishDeposit': {
      const ws = sortedKeys(s.farm.wishlist);
      const asked = ws.filter((w) => s.farm.wishlist[w].release);
      const funded = ws.filter((w) => s.farm.wishlist[w].coins > 0);
      const id = type === 'wishAnswer' && asked.length ? pick0(asked)
        : type === 'wishWithdraw' && funded.length ? pick0(funded) : ws.length ? pick0(ws) : 'none.1.0';
      if (type === 'wishDeposit') return [type, { id, coins: 1 + Math.floor(rnd() * 5000), ...big }];
      if (type === 'wishAnswer') return [type, { id, ok: rnd() < 0.5 }];
      return [type, { id }];
    }
    case 'place': {
      // mostly a spot where it fits (random tiles rarely fit a 3x3 building), sometimes any tile; the tray first
      const tray = sortedKeys(s.farm.storage).filter((d) => lookup('placeables', d));
      const defs = PLACE_DEFS.filter((d) => lookup('placeables', d));
      const def = tray.length && rnd() < 0.3 ? pick0(tray) : pick(defs);
      const rot = Math.floor(rnd() * 4);
      let [x, z] = [tile(), tile()];
      for (let i = 0; i < 40 && rnd() < 0.97 && canPlace(s, def, x, z, rot) !== null; i++) [x, z] = [tile(), tile()];
      return [type, { def, x, z, rot, ...big }];
    }
    case 'move': {
      const movable = [...k.plot, ...k.decor, ...k.tree, ...k.building, ...k.home,
        ...(WAVE2 ? k.any.filter((id) => defOf(s.farm.objects[id].def).greenhouse) : [])];
      const id = movable.length ? pick(movable) : pick(k.any);
      const o = s.farm.objects[id];
      const rot = Math.floor(rnd() * 4);
      let [x, z] = [tile(), tile()];
      for (let i = 0; i < 40 && canFit(s, o.def, x, z, rot, id) !== null; i++) [x, z] = [tile(), tile()];
      return [type, { id, x, z, rot, confirm: ['PINNED'] }];
    }
    case 'moveBack': {
      const moved = k.any.filter((id) => s.farm.objects[id].prev);
      return [type, { id: moved.length ? pick(moved) : pick(k.any) }];
    }
    case 'refund': {
      const fresh = k.any.filter((id) => s.farm.objects[id].rcpt && s.farm.objects[id].rcpt.until > now);
      return [type, { id: fresh.length ? pick(fresh) : pick(k.any), confirm: ['PINNED'] }];
    }
    case 'store': case 'sellObject': {
      const sellable = [...k.decor, ...k.plot, ...k.animal];
      return [type, { id: sellable.length && rnd() < 0.8 ? pick(sellable) : pick(k.any), confirm: ['PINNED'] }];
    }
    case 'restore': { const t = sortedKeys(s.farm.trash); return [type, { id: t.length ? pick0(t) : 'none.1.0' }]; }
    case 'pinObject': return [type, { id: k.decor.length ? pick(k.decor) : 'none.1.0', on: rnd() < 0.6 }];
    case 'hurry': {
      const timers = [...k.plot.filter((id) => s.farm.objects[id].crop), ...k.tree, ...k.animal, ...k.building];
      const id = timers.length ? pick(timers) : pick(k.any);
      // wave 4b: one queue item by its key (running, waiting, finished or gone)
      const q = W4B && rnd() < 0.5 ? s.farm.objects[id]?.queue : null;
      if (q && q.length) return [type, { id, k: rnd() < 0.9 ? pick0(q).k ?? 0 : 999, ...big }];
      return [type, { id, ...big }];
    }
    case 'buyGoldenSeeds': return [type, big];
    case 'buyTool': return [type, { tool: pick(['big_watering_can', 'wide_sickle']), ...big }];
    case 'openExpansion': case 'expand':
      return [type, { expansion: pick(['creekside', 'old_orchard', 'cow_hill', 'sunflower_rise']), ...big }];
    // ---- wave 2 ----
    case 'masterwork': return [type, { id: k.decor.length ? pick(k.decor) : 'none.1.0', ...big }];
    case 'donate': {
      const p = openProject(s) ?? CONTENT.restoration.get('greenhouse');
      const b = pick0(p.bundles);
      return [type, { project: p.id, bundle: b.id, slot: Math.floor(rnd() * b.slots.length),
        qty: 1 + Math.floor(rnd() * 40), ...big }];
    }
    case 'restoreFlag': {
      const p = openProject(s) ?? CONTENT.restoration.get('greenhouse');
      const b = pick0(p.bundles);
      return [type, { project: p.id, bundle: b.id, slot: Math.floor(rnd() * b.slots.length) }];
    }
    case 'townGive': {
      const cur = s.farm.town.cur;
      return [type, { item: cur ? pick0(cur.goods).item : 'bread', qty: 1 + Math.floor(rnd() * 10) }];
    }
    case 'townFund': return [type, { coins: 1 + Math.floor(rnd() * 200_000), ...big }];
    case 'adoptPet': return [type, { kind: pick0(['dog', 'cat']), name: pick0(['Rex', 'Mitzi', 'Bo']) }];
    case 'feedPet': case 'petPet':
      return [type, { owner: pick0(['p1', 'p2']), ...(rnd() < 0.5 ? { confirm: ['RESERVED'] } : {}) }];
    // ---- wave 3 (M2) ----
    case 'nurse': case 'nursePick': {
      // mostly babies and animals whose card is open (a random adult is the refusal case)
      const cared = k.animal.filter((id) => s.farm.objects[id].nurse || now < s.farm.objects[id].adultAt);
      const id = (cared.length && rnd() < 0.8 ? pick0(cared) : k.animal.length ? pick(k.animal) : 'none.1.0');
      if (type === 'nurse') return [type, { id, ...(rnd() < 0.3 ? { confirm: ['RESERVED'] } : {}) }];
      return [type, { id, personality: pick0(['sleepy', 'playful', 'grumpy']), specialty: pick0(['bountiful', 'tidy']) }];
    }
    case 'breed': {
      // two of one species most of the time (any two otherwise: the refusals are part of the test)
      const sp = k.animal.length ? s.farm.objects[pick0(k.animal)].def : null;
      const same = k.animal.filter((id) => s.farm.objects[id].def === sp);
      const pool = rnd() < 0.8 && same.length >= 2 ? same : k.animal;
      return [type, { a: pool.length ? pick0(pool) : 'none.1.0', b: pool.length ? pick0(pool) : 'none.1.1',
        ...(rnd() < 0.3 ? { confirm: ['RESERVED'] } : {}) }];
    }
    case 'breedCancel': return [type, {}];
    case 'breedCollect': return [type, rnd() < 0.5 ? { name: pick0(['Clover', 'Daisy', 'Bo']) } : {}];
    case 'cast': {
      const docks = k.decor.filter((id) => s.farm.objects[id].def === 'pond_dock');
      return [type, docks.length && rnd() < 0.4 ? { id: pick(docks) } : { pond: pick0(['willow_pond', 'goat_rocks']) }];
    }
    case 'reel': return [type, {}];
    case 'furnish': {
      const def = pick0(FURNITURE_IDS);
      const wall = lookup('furniture', def)?.layer === 'wall';
      return [type, wall ? { def, wall: pick0(['back', 'left']), at: Math.floor(rnd() * 12) }
        : { def, x: Math.floor(rnd() * 12), z: Math.floor(rnd() * 8), rot: Math.floor(rnd() * 2), ...big }];
    }
    case 'furnishMove': case 'furnishStore': case 'furnishRefund': {
      const items = sortedKeys(s.farm.interior?.items ?? {});
      const id = items.length ? pick(items) : 'none.1.0';
      if (type !== 'furnishMove') return [type, { id }];
      const def = lookup('furniture', s.farm.interior?.items?.[id]?.def ?? '');
      return [type, def?.layer === 'wall' ? { id, wall: pick0(['back', 'left']), at: Math.floor(rnd() * 12) }
        : { id, x: Math.floor(rnd() * 12), z: Math.floor(rnd() * 8), rot: Math.floor(rnd() * 2) }];
    }
    // ---- wave 4 ----
    case 'sellStored': {
      const tray = sortedKeys(s.farm.storage);
      return [type, { def: tray.length && rnd() < 0.85 ? pick0(tray) : pick0(['flower_bed', 'plot', 'scarecrow']) }];
    }
    case 'upgradeObject': {
      const up = k.any.filter((id) => ['farmhouse', 'well', 'market_stand', 'sunset_bench', 'bench_swing']
        .includes(s.farm.objects[id].def));
      return [type, { id: up.length && rnd() < 0.85 ? pick(up) : pick(k.any), confirm: ['BIG_SPEND', 'RESERVED'] }];
    }
    case 'fertilize': return [type, stroke(k.plot)];
    case 'clearWeed': {
      if (rnd() < 0.5) return [type, { x: tile(), z: tile() }];
      const cells = [];
      const n = 1 + Math.floor(rnd() * 6);
      const x0 = tile();
      const z0 = tile();
      for (let i = 0; i < n; i++) cells.push(Math.min(63, z0 + (i >> 1)) * 64 + Math.min(63, x0 + i));
      return [type, { cells: [...new Set(cells)] }];
    }
    case 'setAvatar': {
      const all = { body: pick0(['farmer_a', 'farmer_b']), hair: pick0(['short', 'bun', 'curly']), hat: pick0(['none', 'straw']),
        hairColor: pick0(['#4a3020', '#E8C070', '#B03A2E']), skin: pick0(['#F2D2B6', '#8D5524']), top: '#2BB3A3',
        bottom: pick0(['#3A5BA0', '#6B4E2E']) };
      const keys = Object.keys(all).filter(() => rnd() < 0.4);
      return [type, keys.length ? Object.fromEntries(keys.map((x) => [x, all[x]])) : { hair: 'short' }];
    }
    case 'petBreed': {
      // mostly a breed of one of the two pets (the actor is drawn later: half of these fit their own pet)
      const kinds = ['p1', 'p2'].map((p) => s.players[p]?.pet?.kind).filter(Boolean);
      const own = { dog: ['husky', 'shepherd', 'shiba'], cat: ['orange', 'black', 'white'] };
      const list = kinds.length && rnd() < 0.85 ? own[pick0(kinds)] ?? ['poodle'] : ['poodle', 'husky', 'white'];
      return [type, { breed: pick0(list) }];
    }
    // ---- wave 4b ----
    case 'openCrate': {
      const crates = cratesOn(s);
      return [type, { id: crates.length && rnd() < 0.9 ? pick0(crates) : pick(k.any) }];
    }
    case 'buyRelic': return [type, { relic: rnd() < 0.95 ? pick0(RELICS).id : 'nope', ...big }];
    case 'saveFor': return [type, rnd() < 0.2 ? {} : { relic: rnd() < 0.95 ? pick0(RELICS).id : 'nope' }];
    case 'waterAll': case 'farmhand': case 'turnTime': return [type, rnd() < 0.3 ? { confirm: ['RESERVED'] } : {}];
    case 'reorder': {
      const busy = k.building.filter((id) => s.farm.objects[id].queue.filter((q) => q.s > now).length >= 2);
      if (!busy.length && k.building.length && rnd() < 0.7) {
        // nothing to reorder yet: queue one more item where something already runs (the next draw may reorder)
        const running = k.building.filter((id) => s.farm.objects[id].queue.some((q) => q.e > now));
        const b = pick(running.length ? running : k.building);
        const rs = recipesOf(s.farm.objects[b].def);
        return ['craft', { id: b, recipe: rs.length ? pick0(rs).id : 'bread' }];
      }
      const id = busy.length ? pick(busy) : k.building.length ? pick(k.building) : 'none.1.0';
      const keys = (s.farm.objects[id]?.queue ?? []).filter((q) => q.s > now || rnd() < 0.1).map((q) => q.k ?? 0);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      if (rnd() < 0.5) keys.reverse();                    // a shuffle that changed nothing is the ALREADY_DONE case
      return [type, { id, keys: keys.length ? [...new Set(keys)] : [Math.floor(rnd() * 20)] }];
    }
    default: throw new Error(`no generator for ${type}`);
  }
}

/**
 * A rich start: level `level`, the live land, the M1a buildings and homes, animals, goods; with `m1b` also the new
 * homes and buildings, two 3 x 3 composted plot blocks (ids `blkN.*`) for giants, made goods for Town Projects.
 */
export function startFarm(seed, { level = 12, m1b = false, m2 = false } = {}) {
  const s = farmAt(level, { seed, coins: 400_000, acorns: 120 });
  s.farm.expansions = live('expansions').filter((e) => m1b || e.m === 'M1a').map((e) => e.id);
  resetGrid(s);
  const BIG = { confirm: ['BIG_SPEND'] };
  for (const def of ['coop', 'feed_mill', 'mill', 'bakery', 'dairy', 'cow_barn', 'apple_tree', 'pine', 'compost_bin']) {
    placeDef(s, def, BIG);
  }
  for (const a of ['chicken', 'chicken', 'cow']) must(s, 'buyAnimal', { def: a, adult: true, confirm: ['BIG_SPEND'] });
  if (m1b) {
    s.farm.barn = 3;                                       // room for the extra goods below (560)
    s.farm.wallet.coins = 2_000_000;
    for (const def of ['kitchen', 'beehive', 'pig_pen', 'duck_pond', 'goat_yard', 'sewing', 'pie_oven', 'fountain']) {
      if (lookup('placeables', def) && canPlace(s, def, 0, 0, 0) !== 'LOCKED') placeDef(s, def, BIG);
    }
    for (const a of ['pig', 'duck', 'goat']) {
      if (lookup('animals', a)) must(s, 'buyAnimal', { def: a, adult: true, ...BIG });
    }
    // two plot blocks for giant crops (laid straight into the state: setup only): blk1 composted and empty (a
    // planting stroke over it may roll a Giant), blk2 already a Pumpkin Giant ripening in 2 hours (chops, water,
    // Hurry, rain and the Bloom act on it)
    for (const [b, x0, z0] of [['blk1', 24, 42], ['blk2', 36, 42]]) {
      for (let dz = 0; dz < 3; dz++) {
        for (let dx = 0; dx < 3; dx++) {
          const id = `${b}.${dz}${dx}`;
          const giant = b === 'blk2';
          s.farm.objects[id] = { def: 'plot', x: x0 + dx, z: z0 + dz, rot: 0, placedAt: T0, by: 'sys', cycle: 0,
            // planted a growth time before it ripens (a watering's cut is a share of the growth time)
            crop: giant ? { def: 'pumpkin', plantedAt: T0 + 2 * 3_600_000 - CONTENT.crops.get('pumpkin').growMs,
              readyAt: T0 + 2 * 3_600_000, by: 'p1', cycle: 0, cut: 0,
              giant: 'blk2.00', ...(id === 'blk2.00' ? { hp: 60 } : {}) } : null, compost: true };
        }
      }
    }
    // made today, so Ollie posts a project at once from goods the farm can make now (wave-2 QA RC-02: only
    // makeable goods are asked for) and townGive is exercised from the first steps
    for (const g of ['bread', 'cheese', 'egg', 'apple', 'milk']) s.farm.made[g] = dayOf(s, T0);
    // every other farm starts with a pet, so feeding and petting happen too (adopting stays possible elsewhere)
    if (seed % 4 === 0 && lookup('decor', 'dog_house')) must(s, 'adoptPet', { kind: 'dog', name: 'Rex' });
    s.farm.wallet.coins = 400_000;
  }
  if (m2) {
    // the M2 systems within reach: room in the barns for bred babies, babies for the Nursery, a Fishing Dock, the
    // farmhouse room open (every Restoration project done), and the bottle items the cards and breedings use
    s.farm.wallet.coins = 4_000_000;
    s.farm.barn = 8;
    for (const def of ['pond_dock', 'paddock', 'pasture']) if (lookup('placeables', def)) placeDef(s, def, BIG);
    for (const id of sortedKeys(s.farm.objects)) {
      if (defOf(s.farm.objects[id].def)?.kind === 'home') s.farm.objects[id].up = 2;
    }
    for (const a of ['cow', 'cow', 'sheep', 'chicken', 'alpaca', 'alpaca']) {
      if (lookup('animals', a)) must(s, 'buyAnimal', { def: a, adult: a !== 'cow' && a !== 'sheep', ...BIG });
    }
    for (const p of live('restoration')) {
      s.farm.restore[p.id] = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, T0])), done: T0 };
    }
    for (const [i, f] of (lookup('furniture', 'duet_table') ? FIXED() : []).entries()) {
      s.farm.interior.items[`fx.${i}`] = { def: f.def, by: 'sys', placedAt: T0,
        ...(f.wall !== undefined ? { wall: f.wall, at: f.at } : { x: f.x, z: f.z, rot: 0 }) };
    }
    s.farm.wallet.coins = 900_000;
    // a player who never left has nothing to accrue (rules-goals' rested.js reads `at` as "accrued up to")
    for (const pid of sortedKeys(s.players)) if (s.players[pid].rested) s.players[pid].rested.at = T0;
  }
  if (seed % 2) s.farm.expansions = ['home'];            // odd seeds: the Homestead only, so land can be bought
  for (const id of sortedKeys(s.farm.objects)) {
    const o = s.farm.objects[id];
    const d = defOf(o.def);
    const out = d.layer !== 'none' && !tilesOf(d, o.x, o.z, o.rot).every(([x, z]) => inLand(s, x, z));
    if (out) delete s.farm.objects[id];
  }
  for (const id of sortedKeys(s.farm.objects)) {
    const o = s.farm.objects[id];
    if (typeof o.home === 'string' && !s.farm.objects[o.home]) delete s.farm.objects[id];
  }
  resetGrid(s);
  for (const [item, n] of [['wheat', 44], ['corn', 20], ['carrot', 20], ['egg', 20], ['milk', 10], ['flour', 10],
    ['planks', 12], ['wooden_crate', 4], ['compost', 10], ['chicken_feed', 20], ['livestock_feed', 10],
    ['strawberry', 10], ['butter', 6]]) give(s, item, n);
  if (m2) for (const [item, n] of [['baby_bottle', 12], ['chicken_feed', 10]]) give(s, item, n);
  if (m1b) {
    for (const [item, n] of [['pig_slop', 6], ['yarn', 4], ['apple', 10], ['cherry', 8], ['potato', 6], ['tomato', 9],
      ['compost', 18], ['bread', 6], ['cheese', 3], ['dog_biscuit', 3], ['cat_treat', 3]]) give(s, item, n);
  }
  return s;
}

/** Recursively: no NaN, no Infinity, no -0, nothing JSON would change. */
export function assertFinite(v, at = 'state') {
  if (typeof v === 'number') assert.ok(Number.isFinite(v) && !Object.is(v, -0), `${at} = ${v}`);
  else if (Array.isArray(v)) v.forEach((x, i) => assertFinite(x, `${at}.${i}`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertFinite(x, `${at}.${k}`);
}

/** Plots a fuzz farm starts with (a test fixture may start above the cap; it must never grow past both). */
const plotCapAtStart = new WeakMap();

export function economyInvariants(s, start, where) {
  const cap = barnCap(s);
  assert.ok(stockOf(s) <= cap, `${where}: the Barn holds ${stockOf(s)} > ${cap}`);
  if (overflowOf(s) > 0) assert.equal(stockOf(s), cap, `${where}: overflow below capacity`);
  assert.ok(ledgerBalanced(s, start), `${where}: coins not conserved by the ledger`);
  // RC-04: no path (buy, tray, restore from the trash) lifts the plots over the plot cap
  const plots = ownedCount(s, 'plot');
  assert.ok(plots <= Math.max(plotCapAtStart.get(s) ?? 0, ownCap(s, defOf('plot'))),
    `${where}: ${plots} plots over the cap ${ownCap(s, defOf('plot'))}`);
  // a Giant's nine plots share one ripeness and one anchor
  for (const id of sortedKeys(s.farm.objects)) {
    const c = s.farm.objects[id].crop;
    if (!c || c.giant === undefined) continue;
    const a = s.farm.objects[c.giant]?.crop;
    assert.ok(a && a.giant === c.giant && a.readyAt === c.readyAt, `${where}: giant plot ${id} out of step`);
  }
}

/**
 * The key-order / classified-events / round-trip / invariants fuzz. Returns the accepted action types (Map type ->
 * count). `goals` is the optional rules-goals mixer ({ goalsAction(rnd, state) }).
 */
export function fuzz({ seeds = [1, 2, 3, 4, 5, 6], steps = 150, start = startFarm, goals = null,
  roundTripEvery = 5 } = {}) {
  const allEvents = new Set([...FX_EVENTS, ...CELEBRATIONS]);
  const accepted = new Map();
  for (const seed of seeds) {
    const rnd = mulberry32(seed);
    const s = start(seed);
    plotCapAtStart.set(s, ownedCount(s, 'plot'));
    const startCoins = s.farm.wallet.coins + (s.farm.stats['coins.spent'] ?? 0) - (s.farm.stats['coins.earned'] ?? 0)
      - (s.farm.stats['coins.granted'] ?? 0) - (s.farm.stats['coins.refunded'] ?? 0);
    let now = T0;
    let seq = 0;
    let recent = [];
    let last = null;
    let twin = null;
    for (let i = 0; i < steps; i++) {
      const r0 = rnd();
      now += Math.floor(rnd() * (r0 < 0.1 ? 6 * 3_600_000 : r0 < 0.3 ? 2000 : 4 * MIN));   // some 2-second steps: duets
      // a persistent key-reversed twin: compared (and re-reversed) every 10th step, so a divergence still shows
      if (i % 10 === 0) {
        if (twin) assert.deepEqual(plain(twin), plain(s), `values diverge before step ${i}`);
        twin = reverseKeys(plain(s));
      }
      const due = [...econDue(s, now), ...(W4B && crateDue(s, now) ? [{ type: '_crate', args: {} }] : [])];
      for (const a of due) {
        const r = sys(s, a.type, a.args, now);
        assert.equal(r.ok, true, `${a.type} due but refused ${r.code} ${r.err?.stack ?? ''}`);
        accepted.set(a.type, (accepted.get(a.type) ?? 0) + 1);
        for (const ev of r.tx.events) assert.ok(allEvents.has(ev.e), `event '${ev.e}' is neither FX nor a celebration`);
        if (twin) sys(twin, a.type, a.args, now);
        economyInvariants(s, startCoins, `seed ${seed} step ${i} ${a.type}`);
      }
      const g = goals && rnd() < 0.25 ? goals.goalsAction(rnd, s) : null;
      const [type, args] = g ?? randomAction(rnd, s, recent, now, last);
      const pid = rnd() < 0.5 ? 'p1' : 'p2';
      const ctx = { now, pid, cid: 'fuzz01', seq: ++seq };
      // every 5th step also proves the ops / undo round trip (run(); the unit suites do it for every action)
      const a = i % roundTripEvery === 0 ? run(s, type, args, ctx)
        : runAction(s, { type, args }, makeCtx(s, { ...ctx, grace: 250 }));
      const b = runAction(twin, { type, args }, makeCtx(twin, { ...ctx, grace: 250 }));
      assert.equal(a.ok, b.ok, `${type} ${JSON.stringify(args)}`);
      assert.equal(a.code, b.code, `${type} ${JSON.stringify(args)}`);
      if (a.ok) {
        accepted.set(type, (accepted.get(type) ?? 0) + 1);
        assert.deepEqual(a.tx.events, b.tx.events, `${type} events`);
        for (const ev of a.tx.events) assert.ok(allEvents.has(ev.e), `event '${ev.e}' is neither FX nor a celebration`);
        for (const ev of a.tx.events) {
          if (ev.e === 'giantFormed' || ev.e === 'giantFelled') accepted.set(ev.e, (accepted.get(ev.e) ?? 0) + 1);
        }
        recent = a.tx.events.flatMap((ev) => [ev.id, ...(Array.isArray(ev.ids) ? ev.ids : [])]).filter(Boolean);
        last = type;
        economyInvariants(s, startCoins, `seed ${seed} step ${i} ${type}`);
      } else assert.notEqual(a.code, 'INTERNAL', `${type} ${JSON.stringify(args)} threw: ${a.err && a.err.stack}`);
    }
    assert.deepEqual(plain(twin), plain(s), `seed ${seed}: values diverge`);
    assertFinite(plain(s));
    assert.deepEqual(validateState(s), [], `seed ${seed}`);
  }
  return accepted;
}

/** Two clients act in random interleavings through the engine and SyncStores; all three states converge. */
export function converge({ seeds = [1, 2, 3, 4, 5, 6], steps = 80, start = startFarm } = {}) {
  for (const seed of seeds) {
    const rnd = mulberry32(seed * 7919);
    const h = coopHarness({ seed });
    // the same rich start on the server; both clients get it in a welcome
    const rich = start(seed);
    h.state.farm = structuredClone(rich.farm);
    h.state.farm.xp = rich.farm.xp;
    for (const c of [h.a, h.b]) c.store.reset(h.welcome(c));
    for (let i = 0; i < steps; i++) {
      h.clock.advance(Math.floor(rnd() * 3 * MIN));
      const c = rnd() < 0.5 ? h.a : h.b;
      const [type, args] = randomAction(rnd, c.store.state);
      c.store.act(type, args);
      // deliver a random amount of traffic in a random direction
      for (let k = Math.floor(rnd() * 3); k > 0; k--) {
        const d = rnd() < 0.5 ? h.a : h.b;
        const toServer = rnd() < 0.5;
        const n = 1 + Math.floor(rnd() * 3);
        if (toServer) h.deliverToServer(d, n); else h.deliverToClient(d, n);
      }
    }
    h.flush();
    assert.deepEqual(plain(h.a.store.state), plain(h.state), `seed ${seed}: client A diverged`);
    assert.deepEqual(plain(h.b.store.state), plain(h.state), `seed ${seed}: client B diverged`);
    assert.deepEqual(validateState(h.state), []);
  }
}
