// Domain events of the economy actions (CONTRACT between rules-economy and rules-goals).
//
// Every economy action records what happened with tx.emit({ e, ... }). The economy actions themselves only
// move goods, coins and timers; everything that is CREDIT for having done something (farm XP, personal XP,
// stats counters, mastery counts, quest/ribbon/order progress, the activity feed) is computed by rules-goals
// from these events in progress.processEvents(), inside the same transaction. So adding a goal never touches an
// action, and an action never needs to know which goals exist.
//
// Rules for every event below:
//   - `by` is the actor: 'p1' | 'p2' | 'sys'. Credit for 'sys' goes to the farm only.
//   - Every field is plain JSON (tx.emit enforces it). Quantities are positive integers.
//   - Item ids equal crop ids for crops; `item` always names an items.js id.
//   - XP values (`xp`) are what the CONTENT says the deed is worth (base XP, before any personal split); the
//     economy already applied the deed's own modifiers that the GDD ties to the deed (Freshness +10 %, duet
//     +25 %, recipe Gold +5 %). rules-goals decides who gets it (farm XP in full, personal split). Purchases,
//     planting, watering, feeding and petting never carry XP (GDD §4.5, §9 #9, #10, #41).
//   - These events are fx-class: the client predicts them for the actor's own actions (world feedback). The
//     confirmed-only celebrations stay in progress.CELEBRATIONS (rules-goals); the economy emits only
//     'duet' { id, building, recipe, a, b, by } from that set (the partner's press started a duet recipe) and
//     'bloomed' { level, ids, breed? } (the Level-up Bloom finished everything growing, inside the level-up).
//   - One action = one stroke: a drag (`ids`) emits one event per target, in stroke order.
//
// ECON_EVENTS is the registry: progress.FX_EVENTS includes every key (rules-goals imports it), and
// test/invariants.test.js fails on any emitted name in neither set. A new economy event joins HERE only.
//
// Field docs (value = list of fields; `?` = optional):

/** @type {Readonly<Record<string, string>>} event name -> field documentation */
export const ECON_EVENTS = Object.freeze({
  // ---- objects: placement, moves, sales (actions/decor.js) ---------------------------------------------------
  placed: 'id, def, kind, x, z, rot, by, coins, acorns, free?  '
    + '(bought, or free from the build tray; coins/acorns = price paid)',
  moved: 'id, def, x, z, rot, from: [x, z, rot], by  (timers kept; a 10-minute move back opens)',
  movedBack: 'id, def, x, z, rot, by',
  removed: 'id, def, kind, by, coins, acorns, reason  '
    + '(reason "undo": the receipt refund, 100 %; "sell": resale, the object waits in the trash)',
  restored: 'id, def, by  (taken back out of the trash; its coins were paid back)',
  stored: 'id, def, by  (decor went into the build tray)',
  pinned: 'id, pin, by  (pin = pid | null)',
  bigSpend: 'by, coins, acorns, what  (a confirmed BIG_SPEND purchase: the partner\'s heads-up toast)',

  // ---- crops (actions/farming.js) ---------------------------------------------------------------------------
  planted: 'id, crop, by, golden?, season?, packet?  (one per plot of a stroke; season: planted in season)',
  watered: 'id, kind: "crop" | "tree", by, tend, savedMs  '
    + '(tend: a partner tend after the OTHER player watered; savedMs = how much earlier it ripens)',
  composted: 'id, kind: "crop" | "tree", by',
  uprooted: 'id, crop, by, refund  (refund = seed coins back, 0 after the undo window)',
  harvested: 'id, crop, qty, by, planter, xp, fresh, ribbon, bonus, star  '
    + '(qty includes bonus units; xp has Fresh +10 %; star = mastery stars at harvest)',
  seedBasket: 'crop, n, by  (Grandma\'s seed basket: n free plantings)',

  // ---- trees and debris (actions/trees.js) --------------------------------------------------------------------
  picked: 'id, tree, item, qty, by, xp, ribbon, grove, bonus  (a fruit tree harvested; the next cycle started)',
  chopped: 'id, tree, item, qty, by, xp  (a ripe Pine chopped for Wood)',
  chopHit: 'id, def, hp, by  (a chop on debris that still stands; hp left)',
  cleared: 'id, def, by, xp, coins, origin, item?, qty?, team?, pair?  (debris gone: xp by origin, coins granted, '
    + 'Wood; team / pair [a, b]: felled together, a teamwork chop on the way)',
  regrown: 'ids  (system: weeds / rocks regrew)',
  rained: 'ids, hours  (system: rain watered these crops and trees)',

  // ---- animals (actions/animals.js) ----------------------------------------------------------------------------
  bought: 'id, def, kind: "animal", home, adult, by, coins, free?  (free: a quest gift)',
  fed: 'id, animal, feed, qty, by, free?  (free: the tender\'s Rancher perk, no feed used; qty 0)',
  collected: 'id, animal, item, qty, by, xp, ribbon, bonus, good?  '
    + '(ribbon: the animal is prized; good = its blue-ribbon good, +1)',
  bottled: 'id, animal, item, by, savedMs, partner?  (partner: the OTHER player bottled it within the hour, so this '
    + 'one cut 20 % more, M2)',
  petted: 'ids: [id], by, both: [id]  (both: petted by both players today)',
  prized: 'id, animal, by  (this collection earned the animal its blue ribbon)',
  grewUp: 'id, animal, by  (a baby bought young had its first meal as an adult)',
  homeUpgraded: 'id, def, level, capacity, by, coins',
  compostPoints: 'id, points, dropped  (the Compost Bin dropped `dropped` Compost into its tray)',

  // ---- buildings and crafting (actions/crafting.js) -----------------------------------------------------------
  queued: 'id, building, recipe, by, endsAt, slow?, duet?  (inputs consumed; slow: a duet recipe cooked alone)',
  duetPressed: 'id, building, recipe, by, until  (first "Cook together" press; the partner has until `until`)',
  cancelled: 'id, building, recipe, by  (inputs back in full)',
  crafted: 'id, building, recipe, item, qty, by, xp, double, first, maker, duet?  '
    + '(collected from the tray; compost bin: recipe "compost", xp 0)',
  slotUpgraded: 'id, def, slots, by, coins',

  // ---- market, storage, Wishlist (actions/market.js, storage.js) ------------------------------------------------
  sold: 'item, qty, coins, by, demand, surplus?  (demand = units sold at the Demand bonus)',
  purchased: 'item, qty, coins, acorns, by  (General Store goods; item "golden_seeds" for Golden Seeds)',
  overflowed: 'item, qty  (intake landed in the overflow pile)',
  barnUpgraded: 'n, capacity, by, coins',
  keepSet: 'item, n, by',
  noFeedSet: 'item, on, by',
  wishAdded: 'id, def, by',
  wishDeposit: 'id, def, coins, by',
  wishWithdrawn: 'id, def, coins, by  (by = who asked; coins went back to the treasury)',
  wishAsked: 'id, def, coins, by, owner, until  (a release request on the partner\'s wish)',
  wishDenied: 'id, def, coins, by, asker',
  wishBought: 'id, def, coins, by  (funded: the object is in the build tray; by = the wish owner)',
  wishRemoved: 'id, by, coins',

  // ---- boosts, tools, land (actions/boosts.js, expansions.js) ----------------------------------------------------
  hurried: 'id, def, kind, acorns, by, savedMs, k?  (k: one queue item finished, wave 4b)',
  surplusUndone: 'coins, rows [{item, qty}], by  (the last "Sell surplus" bought back inside its 10 minutes)',
  toolBought: 'tool, by, coins',
  expansionOpened: 'expansion, by  (proof tasks count from now)',
  expanded: 'expansion, by, coins, planks, crates',

  // ---- wave 2 (M1b) --------------------------------------------------------------------------------------------
  // giant crops (actions/giant.js; GDD §6.2 #8). The nine plots of a Giant keep their crops; `id` is the anchor plot
  // (the block's min corner), `ids` all nine in row order. Felling it emits nine `harvested` (giant: anchor id) first.
  giantFormed: 'id, ids, crop, by  (the last planting of a composted 3 x 3 block rolled a Giant)',
  giantFelled: 'id, ids, crop, qty, by, team, choppers, hits, pair?  (qty in all; team: both players chopped it; '
    + 'choppers: [pids]; hits: {pid: chops}, the share of the nine harvests and the Fair points; pair: [a, b] when '
    + 'felled together)',
  // a giant chop that leaves it standing is `chopHit` { id: anchor, def: crop, hp, by, giant: true }
  heirloom: 'id, tree, by  (this harvest made the tree an Heirloom: +1 fruit and a blue-ribbon chance for good)',
  // bees (actions/animals.js): a Beehive arrives with its colony, announced as `bought` { kind: 'animal', free: true }
  colonyCycle: 'id, home, forage, ms  (a colony started a cycle: forage objects counted, its length)',
  // Farm Beauty, decor sets, Masterwork (actions/beauty.js; GDD §3.8, §5.9)
  masterworked: 'id, def, level, by, coins',
  beautyStar: 'stars, from, score, acorns, by  (system: new stars paid; acorns in all)',
  decorSet: 'set, ids  (system: a decor set completed for the first time; ids = its pieces)',
  // the Restoration Ledger (actions/restoration.js)
  donated: 'project, bundle, slot, by, qty, item?, coins?, deed?, helped?  (deed: a blue-ribbon good counted for a '
    + 'Fair-prize slot; helped = the flag owner when the OTHER player filled a flagged slot)',
  restoreFlagged: 'project, bundle, slot, flag, by  (flag = pid | null: "Need help" on a bundle slot)',
  bundleDone: 'project, bundle, by, back: [{item, qty} | {coins}]  (back: partial slots of the bundle returned)',
  projectDone: 'project, by, reward  (the permanent reward applies from now; reward = its content description)',
  // Town Projects (actions/town.js)
  townPosted: 'project, n, goods: [{item, qty}], coins  (system: Ollie posts the next project)',
  townGiven: 'project, item, qty, by',
  townFunded: 'project, coins, by',
  townReady: 'project, buildAt  (everything is in: the village builds it by buildAt)',
  townBuilt: 'id, project, n, souvenir, acorns, by, tier?  (system; id = project; tier: a Festival Pavilion tier, M2)',
  // pets (actions/pets.js)
  petAdopted: 'pid, kind, name, by',
  petFed: 'pid, pet, by  (pid = the owner; pet = its kind; one treat a day)',
  petPetted: 'pid, pet, by',
  petTreasure: 'day, pids  (both players petted both pets today: each digs up a second find tomorrow)',
  petFind: 'pid, pet, treasure, find: "seeds" | "items" | "roll", crop?, n?, items?, roll?  (system; roll: true = '
    + 'rules-goals rolls the collections album for `pid`)',

  // ---- wave 3 (M2) --------------------------------------------------------------------------------------------
  // the Nursery and the Breeding Barn (actions/breeding.js)
  nursed: 'id, animal, step: "feed" | "play" | "groom", n, of, item, by  (one care step; n of `of` done)',
  nurseDone: 'id, animal, personality, specialty, carers: [pids], by  (the card is full and the couple picked)',
  breedStarted: 'species, a, b, readyAt, by  (two adults started a breeding)',
  breedCancelled: 'species, by, item, qty  (before it was ready: the bottle items came back)',
  bred: 'id, species, coat, golden, home, parents: [a, b], by, name?  (the baby came home; golden: a golden coat)',
  // the Fishing Dock (actions/fishing.js); catches are never items (v2 A4)
  fishCast: 'pid, spot, bite, by  (a line in the water; bite = when the float dips)',
  fishCaught: 'pid, spot, fish, cm, grade: 0 | 1 | 2, record, weekBest, by, joke?  (record: the dock\'s biggest of '
    + 'that species; weekBest: the week\'s biggest; rules-goals rolls the album `fish` source for `pid`)',
  fishTogether: 'spot, pids, hearts: [pids], by  (both lines in at one spot within the window: the together:dock '
    + 'deed; hearts = who got today\'s fishing-together Heart)',
  // the farmhouse interior (actions/interior.js)
  interiorOpened: 'items, by  (Grandma\'s Farmhouse is done: the room and its fixed pieces)',
  furnished: 'id, def, x?, z?, rot?, wall?, at?, by, coins, fromTray',
  furnishMoved: 'id, def, x?, z?, rot?, wall?, at?, from, by',
  furnishStored: 'id, def, by',
  furnishRefunded: 'id, def, coins, by  (the 10-minute undo of a purchase)',
  // reward slots (actions/crafting.js)
  slotGranted: 'id, def, slots  (a reward slot: Grandma\'s duet table gives every Farm Kitchen one more)',

  // ---- wave 4 (the owners' wish list, 2026-10-04) ---------------------------------------------------------------
  // a decor copy sold from the build tray (actions/decor.js sellStored); id = its trash key (restore {id} undoes it);
  // `restored` gains tray: true when such a copy went back into the tray
  soldStored: 'id, def, coins, acorns, by',
  // the next tier of the farmhouse, the Well, the Market Stand or a bench (actions/upgrades.js)
  upgraded: 'id, def, target, tier, name, coins, items, by',
  // Fertilizer spread on a growing crop (actions/farming.js): it ripens savedMs sooner and gives one more unit
  fertilized: 'id, crop, by, savedMs',
  // wild weeds pulled on the farm's land (actions/weeds.js); cells = z * WORLD_TILES + x, coins = the tiny reward
  weedsCleared: 'cells, coins, by',
  // a pet's breed changed (actions/pets.js petBreed); petAdopted gains `breed`
  petBreed: 'pid, kind, breed, by',
  // a player's look changed (actions/avatar.js); avatar = the whole look now
  avatarChanged: 'pid, avatar, by',

  // ---- wave 4b (the owners' wish list, 2026-10-05) --------------------------------------------------------------
  // the balloon dropped a crate on tile (x, z) (system `_crate`, actions/crates.js; by 'sys'): the parachute
  crateDropped: 'id, def, x, z, k, until',
  // a crate was opened (openCrate) or went to the Barn by itself (auto: true, by 'sys'): the loot card. extra = the
  // extra's kind ('acorns' | 'goldenSeeds' | 'fertilizer' | 'collection' | 'decor') with acorns? goldenSeeds?
  // item? qty? set? decor?; progress.js credits the XP and writes the feed line
  crateOpened: 'id, def, x, z, k, by, coins, xp, auto?, extra?, acorns?, goldenSeeds?, item?, qty?, set?, decor?',
  // an Acorn shop relic bought (actions/relics.js); def = the placed relic's def now waiting in the build tray
  relicBought: 'relic, acorns, by, def?',
  // a player picked the relic they save for (relic null = the tracker picks): their Goal Tracker card follows it
  savingFor: 'pid, relic, by',
  // the Golden Watering Can watered n crops and trees (each also has its own `watered`)
  wateredAll: 'n, by',
  // the Farmhand tended n animals (each also has its own `collected` / `fed`)
  farmhandDone: 'n, by',
  // the Time Turner finished every queue of the buildings `ids` (n items)
  timeTurned: 'ids, n, by',
  // a home took a room step (buyAnimal folded it into the purchase, or upgradeHome): capacity now, size [w, d] at
  // rot 0 (grid.sizeOf), grows = the footprint grew (its anchor is now x, z)
  homeGrew: 'id, def, capacity, size, grows, x, z, coins, by',
  // a tree reached its next age (actions/trees.js treeAgeOf): stage 'mature' | 'grand', years = harvests so far
  treeAged: 'id, tree, stage, years, by',
  // the waiting items of a production queue in a new order (actions/crafting.js reorder); keys = that order
  reordered: 'id, building, keys, by',
});

/** The event names, for progress.FX_EVENTS (rules-goals spreads this into its set). */
export const ECON_EVENT_NAMES = Object.freeze(Object.keys(ECON_EVENTS));
