// Feedback glue (GDD §7.2 action catalogue, §6.3 conflict rules): store / controller / presence events -> sounds,
// friendly race toasts and the partner's heads-ups. Owned by the client-core lane.
//
//   const fb = createFeedback({ store, controller, view, audio, ui })
//   fb.peer(pid, online)          a partner joined / left (arrival chime)
//   fb.partnerPing(pid, x, z, { visual })   a relayed `mark`: the partner's ping chime (+ the marker and edge arrow
//                                 when visual: the ui-shell's social corner draws them when it is wired)
//   fb.partnerEmote(pid, id, { visual })    a relayed `emote` (sound; + the bubble when visual)
//   fb.fxMeta(by, local) -> { by, local, stroke }   the meta main.js passes to view.fx.play
//
// Rules implemented here (all cosmetic, nothing touches state):
//   - every domain event has a sound; the partner's are -6 dB and play only when the object is on screen; stereo
//     pan follows the screen x (GDD §8.5)
//   - painting climbs a pentatonic pitch ladder (C D E G A c d e ...); a streak decays after 1.6 s (§7.2)
//   - a lost race ("Mia got there first ♥") is coalesced per 500 ms with a count, never with an error sound, and
//     shows NO toast while a Together Combo is active (both of us productive within 3 s): a small heart spark plays
//     on the plot instead (§6.3, §6.2 #6)
//   - a soft refusal from the server (RESERVED / PINNED / BIG_SPEND race) goes to ui.toast(code, { type, args }),
//     which asks and re-sends with confirm (§15.2)
//   - the partner's big purchase shows ONE heads-up toast ("Rowan is buying a Bakery — 2,600 coins"), §6.3 BIG_SPEND,
//     driven by the rules' own verdict (the `bigSpend` event of that action, which also covers "10 Acorns by one
//     player in one day" for a Hurry), never by a client re-implementation of the threshold (coop-robust-09)
//   - music scene: Golden Hour (rules coop.goldenHourBp), rain (view.stats().weather), the animals on the farm
//   - the partner moves or stores MY things (pinned by me, or a building / decor / home / tree I placed; not plots):
//     a notice with a one-click "Move it back" (GDD §6.3 "You moved my building", TRIAGE CL-05)
import { defOf, itemOf, COOP, SAFETY, CONTENT, FAIR, isLive } from '../../../shared/content/index.js';
import { acornsToday } from '../../../shared/rules/economy.js';
import { SOFT, ERR } from '../../../shared/net/protocol.js';
import { goldenHourBp, comboActive } from '../../../shared/rules/coop.js';
import { EMOTE_VIEW } from './controller.js';
import { t, tn, list, N } from '../i18n/index.js';

const LADDER = new Set(['planted', 'harvested', 'picked', 'collected', 'crafted']);
const PRODUCTIVE = new Set(['harvested', 'picked', 'collected', 'crafted', 'fed', 'chopped', 'cleared']);
/** Own events that buzz a touch player's phone once (throttled in game/haptics.js). */
const HAPTIC_HARVEST = new Set(['harvested', 'picked', 'collected', 'giantFelled']);
const STREAK_MS = 1600;
const RACE_MS = SAFETY?.lostRaceToastMs ?? 500;
const COMBO_MS = COOP?.combo?.windowMs ?? 3000;
const CHOPS = ['chop1', 'chop2', 'chop3'];
/** A species' `sound` (content animals.js) -> its sample (GDD §8.5 Animals; the alpaca's hum came with M2). */
export const SPECIES_SOUND = Object.freeze({ cluck: 'cluck', moo: 'moo', baa: 'baa', oink: 'oink', quack: 'quack', bleat: 'bleat',
  neigh: 'neigh', buzz: 'buzz', hum: 'hum',
  // wave 4 (wish 3): the rabbit's hind-foot thump and its sniff and nibble (content animals.js `sound: 'thump'`)
  thump: 'bunny', nibble: 'bunny', sniff: 'bunny' });
/** The Nursery's care steps (GDD §3.4): feed with the bottle, play with a squeaky toy, groom with a brush. */
export const STEP_SOUND = Object.freeze({ feed: [['water', { gain: 0.5 }], ['hop', { gain: 0.6 }]], play: [['squeak', { gain: 0.8 }]],
  groom: [['brush', { gain: 0.9 }]] });
/** What a species' collection sounds like besides the pop: a pig digs up its truffle, a duck splashes, bees hum. */
const COLLECT_SOUND = Object.freeze({ pig: [['dig', { gain: 0.8 }]], duck: [['splash', { gain: 0.6 }]], bee: [] });
/** A recipe starting in one of the M1b buildings (GDD §8.5 Buildings); every other building bubbles ('craft'). */
export const BUILDING_SOUND = Object.freeze({ sewing: 'sew', pie_oven: 'oven', chandlery: 'fizz', packing: 'tape' });
/** Decor that is a bird bath (render-life's birds land on it; wave 4, wish 10): a splash and a chirp now and then. */
const BIRDBATH = /bird_?bath/;

/**
 * How hard it rains for the sound (wave 4, wish 12): render-world's view.stats().rainStrength (the smoothed level times
 * a drizzle's or a downpour's strength) or .rain when the view reports them, else from the weather's kind. Pure.
 */
export function rainLevel(stats) {
  if (!stats) return 0;
  // render-world's rain x its strength (a drizzle 0.45, a downpour 1, gusting), else the plain level
  if (Number.isFinite(stats.rainStrength)) return Math.max(0, Math.min(1, stats.rainStrength));
  if (Number.isFinite(stats.rain)) return Math.max(0, Math.min(1, stats.rain));
  const k = typeof stats.weather === 'string' ? stats.weather : stats.weather?.kind;
  return k === 'drizzle' || k === 'shower' ? 0.3 : k === 'rain' ? 0.7 : k === 'downpour' || k === 'storm' ? 1 : 0;
}

/** Sound(s) for one domain event: [name, opts?][] (the ladder is handled separately). Exported for the tests. */
export function soundsOf(ev, state) {
  const animalSound = () => {
    const o = ev.id && state.farm.objects[ev.id];
    const d = defOf(ev.animal || (o && o.def));
    return d && SPECIES_SOUND[d.sound] ? [[SPECIES_SOUND[d.sound], { gain: 0.8 }]] : [];
  };
  switch (ev.e) {
    case 'planted': return [['plant', { gain: 0.7 }]];
    case 'harvested': return ev.ribbon ? [['pop'], ['mastery', { gain: 0.6 }]] : [['pop', { gain: 0.8 }]];
    case 'watered': return [['water']];
    case 'composted': return [['compost']];
    case 'uprooted': return [['uproot']];
    case 'picked': return [['shake']];
    case 'chopped': return [[CHOPS[Math.floor(Math.random() * 3)]]];
    case 'cleared': return [[ev.def === 'weed' ? 'weed' : 'poof']];
    case 'bought': return [['build', { gain: 0.6 }], ...animalSound()];
    case 'fed': return [['munch', { gain: 0.8 }], ...animalSound()];
    case 'collected': {
      const species = ev.animal || (ev.id && state.farm.objects[ev.id]?.def);
      const extra = COLLECT_SOUND[species];
      return [...(extra ?? [['pop', { gain: 0.7 }]]), ...animalSound()];
    }
    // a partner bottle (M2, §6.2 #12): the second bottle of the hour sparkles together
    case 'bottled': return [['water', { gain: 0.6 }], ['hop', { gain: 0.6 }], ...(ev.partner ? [['together', { gain: 0.5 }]] : [])];
    case 'petted': return [...animalSound(), ['thanks', { gain: 0.4 }]];
    case 'prized': return [['achievement', { gain: 0.8 }]];
    case 'homeUpgraded': case 'slotUpgraded': case 'barnUpgraded': return [['build'], ['register', { gain: 0.5 }]];
    case 'queued': return [[BUILDING_SOUND[ev.building] ?? 'craft']];
    case 'cancelled': return [['close']];
    case 'crafted': return [['pop'], ['hop', { gain: 0.6 }]];
    case 'duetJoined': return [['duet']];
    case 'sold': return [['register', { gain: 0.55 }]];
    case 'purchased': case 'wishBought': case 'toolBought': return [['register', { gain: 0.7 }]];
    case 'wishDeposit': case 'wishWithdrawn': return [['coin']];
    case 'placed': return [['build']];
    case 'moved': case 'movedBack': case 'restored': return [['build', { gain: 0.55, rate: 1.12 }]];
    // a placed decor sold back (wave 4, wish A: sellObject's `removed` carries the coins) rings the till too
    case 'removed': case 'trashed': return ev.coins > 0 || ev.acorns > 0 ? [['poof'], ['register', { gain: 0.45 }]] : [['poof']];
    case 'stored': return [['close']];
    case 'keepSet': return [['click', { bus: 'ui' }]];
    case 'hurried': return [['acorn']];
    case 'expanded': return [['expand']];
    case 'bloomed': return [['together', { gain: 0.7 }]];
    case 'chopHit': return [[CHOPS[Math.floor(Math.random() * 3)], { gain: 0.8 }]];
    // ---- M1b (wave 2): giant crops, the Fair, the barge, collections, Restoration and Town Projects, beauty --------
    // (several names per moment: the rules lanes' final names and render-life's aliases both play)
    case 'giantFormed': case 'giant': return [['mastery', { gain: 0.7 }], ['find', { gain: 0.5 }]];
    case 'giantChopped': case 'giantChop': case 'giantHit':
      return [[CHOPS[Math.floor(Math.random() * 3)], { gain: 0.9, rate: 0.8 }],
        ...(ev.combo ? [['together', { gain: 0.5 }]] : [])];
    case 'giantFelled': case 'giantHarvested': return [['giant_fall'], ['pop', { gain: 0.6 }]];
    case 'fairEntered': case 'entered': return [['crate', { gain: 0.55 }], ['xp', { gain: 0.5 }]];
    case 'fairMedal': case 'medal': return [['achievement', { gain: 0.8 }]];
    case 'bargeDocked': case 'bargeArrived': case 'bargeCastOff': case 'bargeDeparted': case 'castOff':
      return [['barge_horn', { gain: 0.8 }]];
    case 'bargeLoaded': case 'crateLoaded': return [['crate']];
    case 'bargeRow': case 'rowDone': return [['bundle', { gain: 0.8 }], ['acorn', { gain: 0.6 }]];
    case 'bargeFlagged': case 'flagged': case 'restoreFlagged': case 'folkFlagged': return [['click', { bus: 'ui', gain: 0.6 }]];
    case 'albumFind': case 'found': case 'collectionFound': return [['find']];
    case 'albumTraded': case 'traded': return [['find', { gain: 0.7 }], ['coin', { gain: 0.5 }]];
    case 'albumSet': case 'collectionDone': return [['find'], ['achievement', { gain: 0.7 }]];
    case 'donated': return [['ferry_bell', { gain: 0.6 }]];
    case 'bundleDone': return [['bundle']];
    case 'projectDone': case 'restored': case 'restorationDone': case 'townBuilt': case 'townProjectDone':
      return [['lights_on']];
    case 'townGiven': case 'townFunded': return [['ferry_bell', { gain: 0.6 }]];
    case 'townReady': return [['bundle', { gain: 0.7 }]];
    case 'heirloom': return [['mastery', { gain: 0.7 }]];
    case 'masterwork': case 'masterworked': return [['build', { gain: 0.6 }], ['mastery', { gain: 0.7 }]];
    case 'beautyStar': return [['achievement', { gain: 0.7 }]];
    case 'decorSet': case 'setDone': return [['together', { gain: 0.6 }]];
    // pets (GDD §3.4 Pets): a woof or a meow for every moment with them
    case 'petAdopted': case 'petPetted':
      return [[ev.kind === 'cat' || ev.pet === 'cat' ? 'meow' : 'woof', { gain: 0.8 }], ['thanks', { gain: 0.35 }]];
    case 'petFed': return [['munch', { gain: 0.6 }], [ev.pet === 'cat' ? 'meow' : 'woof', { gain: 0.6 }]];
    case 'petFind': return [['find', { gain: 0.8 }]];
    case 'friendship': case 'befriended': return [['thanks', { gain: 0.6 }], ['mastery', { gain: 0.45 }]];
    // ---- M2 (wave 3): the Fishing Dock, the Nursery and the Breeding Barn, the farmhouse, Friendly Duel, perks, the
    // Seasonal Ribbon Track, Grandma's visit (the cast's own plop, bite and reel are game/fishing.js's: they follow the
    // rules' bite on the clock, not an event)
    case 'fishCast': return [['cast', { gain: 0.75 }]];
    case 'fishCaught':
      return [['fish_splash', { gain: 0.7 }], ...(ev.record || ev.weekBest ? [['achievement', { gain: 0.6 }]] : ev.grade === 2 ? [['mastery', { gain: 0.5 }]] : [])];
    case 'fishTogether': return [['together', { gain: 0.6 }], ['thanks', { gain: 0.4 }]];
    case 'nursed': return [...(STEP_SOUND[ev.step] ?? [['hop']]), ...animalSound()];
    case 'nurseDone': return [['mastery', { gain: 0.6 }], ...animalSound()];
    case 'breedStarted': return [['thanks', { gain: 0.55 }], ...animalSound()];
    case 'breedCancelled': return [['close']];
    case 'bred': return [['hop'], ['find', { gain: 0.6 }], ...animalSound(), ...(ev.golden ? [['mastery', { gain: 0.8 }]] : [])];
    case 'animalNamed': return [['note', { gain: 0.6 }]];
    // ---- wave 4 (the owners' wish list) ------------------------------------------------------------------------
    // A: a copy sold from the build tray (the placed one is `removed` above)
    case 'soldStored': case 'decorSold': return [['register', { gain: 0.5 }], ['coin', { gain: 0.45 }]];
    // E: the farmhouse, the Well, the Market Stand or a bench reaches its next tier: hammering, then the lights
    case 'upgraded': return [['build'], ['lights_on', { gain: 0.55 }], ['register', { gain: 0.35 }]];
    // 2: Fertilizer spread on a growing crop: the scoop's earthy thud, a little brighter, and a sparkle
    case 'fertilized': return [['compost', { gain: 0.7, rate: 1.15 }], ['xp', { gain: 0.35 }]];
    // F: wild weeds pulled with the Hand: the pull, the poof, a coin while the day's tiny reward lasts
    case 'weedsCleared': return [['weed', { gain: 0.85 }], ['poof', { gain: 0.4 }], ...(ev.coins > 0 ? [['coin', { gain: 0.3 }]] : [])];
    // 6: a pet's breed chosen: its own woof or meow
    case 'petBreed': return [[ev.kind === 'cat' ? 'meow' : 'woof', { gain: 0.7 }], ['thanks', { gain: 0.35 }]];
    // 9: a new look: a fabric swish (the paper rustle, pitched up) and a sparkle
    case 'avatarChanged': return [['note', { gain: 0.6, rate: 1.3 }], ['emote', { gain: 0.5 }]];
    // G: a perk given back for Acorns
    case 'perkRefunded': return [['tab', { bus: 'ui' }], ['acorn', { gain: 0.6 }]];
    // ---- wave 4b (owner wishes 2026-10-05) ---------------------------------------------------------------------
    // 1: a balloon crate: it lands (a soft "look!" chime); opened: a shake, the lid, the pop of the loot, a small fanfare
    //    and the coins (render's open animation runs the same ~0.9 s); one left alone goes quietly to the Barn
    case 'crateDropped': return [['find', { gain: 0.4, rate: 1.1 }]];
    case 'crateOpened': return ev.auto ? [['close', { gain: 0.5 }]]
      : [['shake', { gain: 0.6 }], ['crate', { gain: 0.6, at: 0.3 }], ['pop', { gain: 0.75, at: 0.42 }],
        ['fanfare', { gain: 0.5, at: 0.5 }], ['coin', { gain: 0.45, at: 0.75 }]];
    // 5: a queue put in a new order (a page turn), one item finished by its own price (the Hurry's Acorn)
    case 'reordered': case 'queueReordered': return [['tab', { bus: 'ui', gain: 0.7 }]];
    // 2: an Acorn treasure: the till and a small fanfare; the Golden Can's wave of water; the Farmhand's round; the
    //    Time Turner (the workshops' bell, the Acorn chime)
    case 'relicBought': return [['register', { gain: 0.6 }], ['fanfare', { gain: 0.5, at: 0.18 }]];
    case 'savingFor': return [['tab', { bus: 'ui', gain: 0.6 }]];
    // 4: a tree enters a new age (render's leaves and sparkle)
    case 'treeAged': return [['mastery', { gain: 0.6 }]];
    case 'wateredAll': return [['water'], ['water', { gain: 0.7, rate: 1.12, at: 0.16 }], ['water', { gain: 0.5, rate: 0.9, at: 0.32 }]];
    case 'farmhandDone': return [['munch', { gain: 0.7 }], ['pop', { gain: 0.6, at: 0.2 }], ['thanks', { gain: 0.4, at: 0.35 }]];
    case 'timeTurned': return [['craft', { gain: 0.7 }], ['acorn', { gain: 0.6, at: 0.15 }], ['pop', { gain: 0.6, at: 0.3 }]];
    // 3: a home grew a room step with its flock (a bigger footprint: the hammer twice)
    case 'homeGrew': return ev.grows ? [['build'], ['build', { gain: 0.6, rate: 1.1, at: 0.22 }], ['register', { gain: 0.4 }]]
      : [['build'], ['register', { gain: 0.4 }]];
    case 'furnished': return [['furnish']];
    case 'furnishMoved': return [['furnish', { gain: 0.6, rate: 1.1 }]];
    case 'furnishStored': return [['close']];
    case 'furnishRefunded': return [['coin']];
    case 'interiorOpened': return [['door', { gain: 0.7 }], ['lights_on', { gain: 0.8 }]];
    case 'duelInvited': return [['note', { gain: 0.7 }]];
    case 'duelAccepted': return [['duel_start']];
    case 'duelDeclined': case 'duelCancelled': case 'duelLapsed': return [['close', { gain: 0.7 }]];
    case 'duelEnded': return ev.scored ? [['duel_win']] : [];
    case 'perkPicked': return [['perk']];
    // a respec: the free weekly one jingles coins back into points, a paid one (wave 4) twinkles its Acorns
    case 'perksReset': return [['tab', { bus: 'ui' }], ev.acorns > 0 ? ['acorn', { gain: 0.6 }] : ['coin', { gain: 0.5 }]];
    case 'trackTier': return [['achievement', { gain: 0.7 }]];
    case 'trackClaimed': return [['acorn']];
    case 'trackClosed': return [['register', { gain: 0.6 }]];
    case 'coatWorn': return [['find', { gain: 0.6 }]];
    case 'grandmaArrived': return [['door'], ['arrive', { gain: 0.8 }]];
    case 'grandmaLeft': return [['door', { gain: 0.6 }], ['thanks', { gain: 0.5 }]];
    case 'folkFilled': return [['order', { gain: 0.7 }]];
    case 'folkGifted': return [['thanks', { gain: 0.6 }]];
    case 'fairPoints': return [['xp', { gain: 0.5 }]];
    case 'petTreasure': return [['find'], ['together', { gain: 0.6 }]];
    case 'grewUp': return [['hop'], ...animalSound()];
    case 'duetPressed': return [['emote', { gain: 0.7 }]];
    case 'seated': return [['thanks', { gain: 0.35 }]];
    case 'orderFilled': return [['order']];
    case 'orderRushed': case 'orderNew': return [['toast', { bus: 'ui', gain: 0.6 }]];
    case 'orderPinned': case 'orderFlagged': case 'pinned': case 'noFeedSet': return [['click', { bus: 'ui', gain: 0.6 }]];
    case 'orderGone': return [['close', { bus: 'ui' }]];
    case 'questDelivered': return [['order', { gain: 0.6 }]];
    case 'noted': case 'unnoted': return [['note']];
    case 'thanked': case 'keepsake': return [['thanks']];
    case 'gift': case 'almanacChest': case 'meterChest': case 'seedBasket': return [['acorn']];
    case 'almanacDone': return [['mastery', { gain: 0.7 }]];
    case 'almanacRerolled': return [['tab', { bus: 'ui' }]];
    case 'wishAdded': case 'wishAsked': case 'wishRemoved': case 'wishDenied': return [['click', { bus: 'ui', gain: 0.6 }]];
    case 'expansionOpened': return [['open', { bus: 'ui', gain: 0.7 }]];
    case 'compostPoints': return [['compost', { gain: 0.6 }]];
    // quiet on purpose: shown elsewhere (the ui, the sky, a celebration) or pure bookkeeping
    case 'joined': case 'bigSpend': case 'overflowed': case 'rained': case 'regrown': case 'stood': case 'highFiveWait':
    case 'hearts': case 'tutorialStep': case 'seen': case 'named': case 'titled': case 'questStarted': case 'weekRolled':
    case 'challengeStarted': case 'colonyCycle': case 'fairOpened': case 'fairCeremony': case 'townPosted':
    case 'rested': case 'trackOpened':
      return [];
    default: return [];
  }
}

const article = (name) => (/^[aeiou]/i.test(name) ? 'an' : 'a');

/**
 * Did the Fair week of this ceremony have a horse show (M2, GDD §5.6: a blue-ribbon horse's Show Ribbon entered, the
 * feature `horse_show` live)? Then the ceremony's fanfare is followed by the post-horn call. Pure; reads defensively:
 * the event's own `show`, else the closed week's entries (farm.fair.cur stays until the next week opens).
 */
export function horseShowRan(state, ev) {
  if (ev && typeof ev.show === 'boolean') return ev.show;
  const hs = CONTENT.features?.get?.('horse_show');
  if (!hs || !isLive(hs) || !state) return false;
  const item = FAIR?.horseShow?.item ?? 'show_ribbon';
  const cur = state.farm?.fair?.cur;
  return Boolean(cur && (!Number.isSafeInteger(ev?.w) || cur.w === ev.w) && (cur.ent?.[item] ?? 0) > 0);
}

/** How many Town Projects stand in the village now (the bells ring once one does). Pure; reads the state defensively. */
export function villageBuilt(state, now) {
  const town = state && state.farm && state.farm.town;
  if (!town || typeof town !== 'object') return 0;
  if (Number.isSafeInteger(town.n)) return town.n;                // rules-economy: farm.town.n = built so far
  const built = town.built;
  if (!built || typeof built !== 'object') return 0;
  return Object.values(built).filter((at) => (Number.isFinite(at) ? at <= now : Boolean(at))).length;
}

/**
 * The partner's heads-up for one action whose events include the rules' `bigSpend` verdict (GDD §6.3: transparency,
 * not permission), or null. Pure (tests). The companion event of the same action says what kind of spend it was.
 * @param {object[]} events the action's events (a delta's `ev`) @param {object} state the state after it
 * @param {string} by the spender @param {number} now
 * @returns {{ text: string, icon: string } | null}
 */
export function bigSpendLine(events, state, by, now) {
  const big = events.find((ev) => ev && ev.e === 'bigSpend');
  if (!big) return null;
  const who = Object.hasOwn(state.players, by) ? state.players[by].name : t('common.partner');
  const coins = Number.isSafeInteger(big.coins) ? big.coins : 0;
  const acorns = Number.isSafeInteger(big.acorns) ? big.acorns : 0;
  const price = priceText(coins, acorns);
  const what = typeof big.what === 'string' ? big.what : null;
  const def = what ? defOf(what) : null;
  const known = Boolean(def || (what && (itemOf(what) || CONTENT.tools.get(what))) || what === 'golden_seeds');
  const icon = known ? what : acorns && !coins ? 'acorns' : 'coins';
  const has = (e) => events.some((ev) => ev && ev.e === e);
  // a treasure (wave 4b) has its own partner line with the name and the price ("Rowan bought the Golden Watering Can"):
  // a second, vaguer "is buying something big" after it would only repeat it
  if (has('relicBought')) return null;
  // the day's Acorn rule (X7a): a small spend that tips the spender over 10 Acorns today says so
  const today = acorns ? acornsToday(state, by, now) : 0;
  const daily = acorns > 0 && acorns < SAFETY.bigSpend.acorns && today >= acorns ? tn('game.spend.daily', today) : '';
  if (has('hurried')) {
    const h = events.find((ev) => ev && ev.e === 'hurried');
    return { text: t('game.spend.hurry', { who, price, daily }), icon: 'hurry',
      hurry: { who, coins, acorns, plot: h.kind === 'plot' || h.def === 'plot' } };
  }
  let text;
  if (has('slotUpgraded')) text = def ? t('game.spend.slot', { who, thing: N(def.id), price }) : t('game.spend.slotAny', { who, price });
  else if (has('homeUpgraded')) text = def ? t('game.spend.home', { who, thing: N(def.id), price }) : t('game.spend.homeAny', { who, price });
  else if (has('barnUpgraded')) text = t('game.spend.barn', { who, price });
  else if (has('expanded')) {
    text = CONTENT.expansions?.get(what)?.name ? t('game.spend.landNamed', { who, land: N(what, 'expansions'), price }) : t('game.spend.land', { who, price });
  } else {
    const tool = what ? CONTENT.tools.get(what) : null;
    const item = what && !def && !tool ? itemOf(what) : null;
    const name = def ? def.name : tool ? tool.name : item ? item.name : null;
    if (what === 'golden_seeds') text = t('game.spend.goldenSeeds', { who, price, daily });
    else if (!name) text = t('game.spend.big', { who, price, daily });
    // English says "a Bakery" / "an Apple Tree" ({_a}); Bulgarian has no article
    else if (def || tool) text = t('game.spend.thingA', { who, _a: article(name), thing: N(what), price, daily });
    else text = t('game.spend.thing', { who, thing: N(what), price, daily });
  }
  return { text, icon };
}

/**
 * One heads-up for a burst of the partner's Hurries ("Finish all growing Pumpkins" sends one per plot): the summed
 * price and how many were finished, instead of one line per plot each with a different "(N Acorns today)". Pure.
 * @param {{ who: string, n: number, coins: number, acorns: number, plot: boolean, first: string }} b
 */
export function hurryBurstLine(b) {
  if (b.n <= 1) return b.first;
  return tn(b.plot ? 'game.spend.burstCrops' : 'game.spend.burstThings', b.n, { who: b.who, price: priceText(b.coins, b.acorns) });
}

/** "2,600 coins and 12 Acorns" / "2600 монети и 12 жълъда" (a heads-up's price). */
function priceText(coins, acorns) {
  return list([coins ? tn('game.spend.coins', coins) : null, acorns ? tn('game.spend.acorns', acorns) : null]);
}

/** How long a burst of the partner's Hurries is gathered into one heads-up. */
export const HURRY_BURST_MS = 1500;

export function createFeedback({ store, controller, view, audio, ui }) {
  // -Infinity, never 0: performance.now() is small right after a page load, and 0 would read as "just now"
  const streak = { me: { n: 0, at: -Infinity }, partner: { n: 0, at: -Infinity } };
  const productive = { me: -Infinity, partner: -Infinity };     // performance.now() of the last confirmed productive action
  const race = { timer: null, by: null, code: null, n: 0, ids: [] };
  let lastGolden = false;

  const name = (pid) => (store.state && Object.hasOwn(store.state.players, pid) ? store.state.players[pid].name : t('common.partner'));
  const isMe = (by) => by === store.pid;

  /** Tile centre of an event's object (an animal: its home), or null. */
  function tileOf(ev) {
    const objs = store.state?.farm.objects;
    let o = ev && typeof ev.id === 'string' && objs && Object.hasOwn(objs, ev.id) ? objs[ev.id] : null;
    if (o && !Number.isFinite(o.x) && o.home && Object.hasOwn(objs, o.home)) o = objs[o.home];
    if (o && Number.isFinite(o.x)) {
      const d = defOf(o.def);
      const [w, dd] = d?.size ?? [1, 1];
      return { x: o.x + w / 2, z: o.z + dd / 2 };
    }
    if (ev && Array.isArray(ev.ids) && ev.ids.length) return tileOf({ id: ev.ids[0] });
    if (ev && Number.isFinite(ev.x) && Number.isFinite(ev.z)) return { x: ev.x + 0.5, z: ev.z + 0.5 };
    return null;
  }

  /** { pan, visible } for an event position. */
  function placeOf(ev) {
    const t = tileOf(ev);
    if (!t || typeof view.toScreen !== 'function') return { pan: 0, visible: true };
    const s = view.toScreen(t.x, t.z, 0);
    const w = (typeof window !== 'undefined' && window.innerWidth) || 1;
    return { pan: Math.max(-0.8, Math.min(0.8, ((s.x / w) * 2 - 1) * 0.8)), visible: s.visible };
  }

  function playEvent(ev, by, local) {
    if (!audio) return;
    const partner = !local && !isMe(by) && by !== 'sys';
    const { pan, visible } = placeOf(ev);
    if (partner && !visible) return;                       // the partner's sounds only when on screen (§7.2)
    const who = partner ? 'partner' : 'me';
    if (LADDER.has(ev.e) && by !== 'sys') {
      const s = streak[who];
      const t = performance.now();
      s.n = t - s.at > STREAK_MS ? 0 : s.n + 1;
      s.at = t;
      // A batch (a partner's 70-plot stroke arriving in one frame, a 3x3 brush) plays as a quick run, not a chord:
      // each note 55 ms after the previous one, and a run longer than 0.7 s is cut short.
      const delay = Math.max(0, (s.next ?? 0) - t);
      if (delay > 700) return;
      s.next = t + delay + 55;
      audio.ladder(s.n, { pan, partner, gain: ev.e === 'planted' ? 0.55 : 0.9, at: delay / 1000 });
      if (ev.e === 'planted') { if (!delay) audio.play('plant', { pan, partner, gain: 0.6 }); return; }
      if (delay) return;
      // the "+N XP" star floats up a beat later: a soft XP tick with it (own actions only)
      if (!partner && Number(ev.xp) > 0) audio.play('xp', { pan, gain: 0.45, at: 0.22 });
    }
    for (const [snd, o = {}] of soundsOf(ev, store.state)) audio.play(snd, { pan, partner, ...o });
    if ((ev.e === 'sold' || ev.e === 'orderFilled') && Number.isFinite(ev.coins) && ev.coins > 0) {
      audio.coins(Math.min(8, Math.max(1, Math.round(Math.log2(ev.coins + 1)))), { pan, partner });
    }
  }

  // the partner's Hurries arrive one action per plot: gather a burst into one line (it waits HURRY_BURST_MS)
  const bursts = new Map();                               // spender -> { who, n, coins, acorns, plot, first, timer }
  function hurryBurst(by, line) {
    const b = bursts.get(by) ?? { who: line.hurry.who, n: 0, coins: 0, acorns: 0, plot: true, first: line.text, timer: null };
    b.n += 1;
    b.coins += line.hurry.coins;
    b.acorns += line.hurry.acorns;
    b.plot = b.plot && line.hurry.plot;
    clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      bursts.delete(by);
      ui.toast(hurryBurstLine(b), { kind: 'info', icon: 'hurry', ms: 5000 });
    }, HURRY_BURST_MS);
    bursts.set(by, b);
  }

  // ---- store events ----------------------------------------------------------------------------------------
  store.on('fx', ({ ev, by, local }) => {
    // the Together Combo counts ACCEPTED actions (server-side), so a prediction never marks me productive: a lost
    // race would otherwise always look like a combo and swallow its toast
    if (!local && PRODUCTIVE.has(ev.e) && !isMe(by) && by !== 'sys') productive.partner = performance.now();
    queueSound(ev, by, local);
    if (!local) movedMine(ev, by);
  });
  // One action's events arrive in one task: a relic's sweep (wave 4b: the Golden Can's `wateredAll`, the Farmhand's
  // `farmhandDone`, the Time Turner's `timeTurned`) follows one event per crop / animal / item; its own sound stands for
  // all of them (render plays them as one wave too), never a run of 80 waterings
  // (only those per-item kinds wait for the end of the task; every other sound plays at once)
  const HEAD_OF = { wateredAll: ['watered'], farmhandDone: ['collected', 'fed', 'petted'], timeTurned: ['crafted'] };
  const SWEPT = new Set(Object.values(HEAD_OF).flat());
  let soundBatch = null;
  let heads = new Set();
  function queueSound(ev, by, local) {
    const head = HEAD_OF[ev.e];
    if (head || SWEPT.has(ev.e)) { if (!soundBatch) { soundBatch = []; queueMicrotask(flushSounds); } }
    if (head) for (const k of head) heads.add(k);
    if (!SWEPT.has(ev.e)) { playEvent(ev, by, local); return; }
    soundBatch.push([ev, by, local]);
  }
  function flushSounds() {
    const batch = soundBatch;
    const quiet = heads;
    soundBatch = null;
    heads = new Set();
    for (const [ev, by, local] of batch) if (!quiet.has(ev.e)) playEvent(ev, by, local);
  }
  store.on('delta', (d) => {
    if (d.cid === store.cid && (d.ev || []).some((ev) => PRODUCTIVE.has(ev.e))) productive.me = performance.now();
    // the partner's BIG_SPEND: one heads-up per action, from the server's verdict (confirmed deltas only)
    if (d.by && d.by !== store.pid && d.by !== 'sys' && store.state && Object.hasOwn(store.state.players, d.by)) {
      const line = bigSpendLine(d.ev || [], store.state, d.by, store.now());
      if (line && line.hurry) hurryBurst(d.by, line);
      else if (line) ui.toast(line.text, { kind: 'info', icon: line.icon, ms: 5000 });
    }
  });

  // ---- Grandma's Farmhouse restored (M2): every Farm Kitchen gets a reward slot (`slotGranted`, one per Kitchen)
  let slotToastAt = -Infinity;
  store.on('fx', ({ ev, local }) => {
    if (local || !ev || ev.e !== 'slotGranted' || performance.now() - slotToastAt < 2000) return;
    slotToastAt = performance.now();
    ui.toast(t('game.duetSlot'), { kind: 'info', icon: 'kitchen', ms: 6000 });
  });

  // ---- "Mia moved your Bird Bath": my placed or pinned things, remembered so a stored one can still be named --------
  const mine = new Map();                                 // objId -> { def, pin, by } (pin or by is me)
  const remember = (id) => {
    const o = store.state && Object.hasOwn(store.state.farm.objects, id) ? store.state.farm.objects[id] : null;
    if (!o) return;                                       // gone: keep the old entry for the 'stored' line
    // a plot is part of the shared field (rearranging plots must not spam the planter); pins are decor-only
    const plot = defOf(o.def)?.kind === 'plot';
    if (o.pin === store.pid || (o.by === store.pid && !plot)) mine.set(id, { def: o.def, pin: o.pin ?? null, by: o.by });
    else mine.delete(id);
  };
  store.on('change', (ch) => {
    if (!store.state) return;
    if (ch.topics.has('*')) { mine.clear(); for (const id of Object.keys(store.state.farm.objects)) remember(id); return; }
    for (const id of ch.ids) remember(id);
  });
  if (store.state) for (const id of Object.keys(store.state.farm.objects)) remember(id);
  function movedMine(ev, by) {
    if (!['moved', 'stored'].includes(ev.e) || !by || by === store.pid || by === 'sys' || typeof ev.id !== 'string') return;
    const m = mine.get(ev.id);
    if (ev.e === 'stored') mine.delete(ev.id);
    if (!m) return;
    const d = defOf(ev.def ?? m.def);
    const thing = d ? N(d.id) : t('game.moved.thing');
    const pin = m.pin === store.pid ? 'Pinned' : '';
    if (ev.e === 'stored') { ui.toast(t(`game.moved.stored${pin}`, { name: name(by), thing }), { kind: 'info', icon: ev.def ?? m.def, ms: 6000 }); return; }
    const back = typeof controller.moveBack === 'function' && (controller.canMoveBack?.(ev.id) ?? true);
    if (back && typeof ui.notice === 'function') {
      ui.notice(t(`game.moved.moved${pin}`, { name: name(by), thing }), { action: { label: t('game.moved.back'), fn: () => controller.moveBack(ev.id) }, ms: 15000 });
    } else ui.toast(t(`game.moved.moved${pin}`, { name: name(by), thing }), { kind: 'info', icon: ev.def ?? m.def, ms: 5000 });
  }

  store.on('celebrate', ({ ev }) => {
    if (!audio) return;
    switch (ev.e) {
      case 'levelUp':
        // a PERSONAL level (a new title) is a small chime for its owner only; the farm level is the big fanfare
        if (ev.scope === 'player') { if (ev.pid === store.pid) audio.play('mastery', { force: true }); break; }
        audio.duck(1.8);
        audio.play('levelup', { force: true });
        break;
      case 'mastery': audio.play('mastery', { force: true }); break;
      case 'fairCeremony': ceremony(ev); break;
      case 'achievement': audio.play('achievement', { force: true }); break;
      case 'questDone': audio.duck(1.2); audio.play('quest', { force: true }); break;
      case 'duet': audio.play('duet', { force: true }); break;
      case 'together':
        if (ev.kind === 'highFive') {
          audio.play('clap', { force: true });
          if (view.avatars?.highFive && ev.a && ev.b) view.avatars.highFive(ev.a, ev.b);
        } else if (ev.kind === 'goldenHour') {
          audio.duck(2.5);
          scene();                               // the music turns golden now (audio.setScene plays the swell once)
        } else if (ev.kind === 'task' || ev.kind === 'challenge') audio.play('quest', { force: true });
        else audio.play('together', { force: true });
        break;
      default: {
        // the M1b celebrations (bargeRow, albumFind, albumSet, friendship ...) have their own sounds; others ding
        const list = soundsOf(ev, store.state);
        if (list.length) for (const [snd, o = {}] of list) audio.play(snd, { ...o, force: true });
        else audio.play('achievement', { gain: 0.7 });
      }
    }
  });

  // ---- the County Fair ceremony (GDD §5.6): a fanfare and the festive music, once per Fair week -------------------
  // It reaches a player either live (the confirmed `_fair` delta, Sunday 20:00) or later, when the ui opens the queued
  // ceremony card for a partner who was away; whichever comes first plays, the other is the same week and stays quiet.
  let ceremonyWeek = null;
  function ceremony(ev) {
    const w = ev && Number.isSafeInteger(ev.w) ? ev.w : 'now';
    if (ceremonyWeek === w) return;
    ceremonyWeek = w;
    audio?.festive?.({ show: horseShowRan(store.state, ev) });
  }
  store.on('fx', ({ ev, local }) => { if (!local && ev && ev.e === 'fairCeremony') ceremony(ev); });
  // the Festival Pavilion (M2, after Town Project 24): each new tier opens with a little festival across the river, the
  // fanfare and the festive music piece, once per tier (the lanterns' swell is the townBuilt event's own sound)
  let pavilionN = null;
  store.on('fx', ({ ev, local }) => {
    if (local || !ev || ev.e !== 'townBuilt' || !Number.isSafeInteger(ev.tier) || pavilionN === ev.n) return;
    pavilionN = ev.n;
    audio?.festive?.();
  });
  ui?.panels?.on?.('open', (name, args) => { if (name === 'fairCeremony') ceremony(args && args.ev ? args.ev : args); });

  /** Lost races: one toast per 500 ms per partner, or a heart spark while a combo is active. */
  function flushRace() {
    const r = { ...race };
    race.timer = null; race.n = 0; race.ids = []; race.by = null; race.code = null;
    if (!r.n) return;
    if (r.n === 1) ui.toast(r.code, { by: r.by });
    else ui.toast(tn('game.raceMany', r.n, { name: name(r.by) }), { by: r.by, count: r.n });
  }

  store.on('reject', (r) => {
    if (r.local) return;                                    // local refusals are the controller's (shake + reason)
    if (SOFT.has(r.code)) { ui.toast(r.code, { type: r.type, args: r.args, by: r.by }); return; }
    const lostRace = r.by && !isMe(r.by) && [ERR.EMPTY, ERR.OCCUPIED, ERR.NOT_READY, ERR.NOT_FOUND, ERR.NOT_HUNGRY, ERR.ALREADY_DONE, ERR.BLOCKED].includes(r.code);
    // type + args let the ui word a refusal per action ("Already cancelled or collected" for a stale cancel, RC-06)
    if (!lostRace) { ui.toast(r.code, { by: r.by, type: r.type, args: r.args }); audio?.play('bonk', { gain: 0.6 }); return; }
    const t = performance.now();
    // the rules' combo meter is authoritative (server-observed: both productive within 3 s AND within 8 tiles);
    // the confirmed-actions check covers a server that does not track it
    const combo = comboActive(store.state, store.now()) || (t - productive.me < COMBO_MS && t - productive.partner < COMBO_MS);
    // a stroke's merged frame names its targets in `ids` (store.release): the spark goes on the first one
    const id = r.args && typeof r.args.id === 'string' ? r.args.id : r.args && Array.isArray(r.args.ids) ? r.args.ids[0] ?? null : null;
    if (combo) {                                            // GDD §6.2 #6: no toast while a combo is active
      if (id) view.fx.play({ e: 'heartSpark', id }, undefined, { by: r.by, local: false });
      audio?.play('thanks', { gain: 0.35 });
      return;
    }
    if (race.by && race.by !== r.by) flushRace();
    race.by = r.by;
    race.code = r.code;
    race.n++;
    if (id) race.ids.push(id);
    if (!race.timer) race.timer = setTimeout(flushRace, RACE_MS);
  });

  controller.on('invalid', (e) => { if (!e || !e.race) audio?.play('bonk'); });   // a lost race is never an error
  controller.on('tool', () => audio?.play('tab', { bus: 'ui' }));

  // ---- haptics (mobile wave): a short pulse for my own harvests, collections and placements, a pattern for a farm
  // level-up (controller.haptic: touch players with haptics on; Android only, iOS has no vibration API) ------------
  store.on('fx', ({ ev, local }) => {
    if (!local || !ev || typeof controller.haptic !== 'function') return;
    if (HAPTIC_HARVEST.has(ev.e)) controller.haptic('harvest');
    else if (ev.e === 'placed') controller.haptic('place');
  });
  store.on('celebrate', ({ ev }) => {
    if (ev && ev.e === 'levelUp' && ev.scope !== 'player' && typeof controller.haptic === 'function') controller.haptic('levelUp');
  });

  // ---- UI sounds without coupling: any button press, panels opening/closing, toasts appearing ----------------
  const doc = typeof document !== 'undefined' ? document : null;
  doc?.addEventListener('pointerdown', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button, [role="button"], [role="tab"], summary');
    if (b && !b.disabled) audio?.play(b.getAttribute('role') === 'tab' ? 'tab' : 'click', { bus: 'ui' });
  }, true);
  let hoverAt = 0;
  doc?.addEventListener('pointerover', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button:not(:disabled), [role="button"]');
    const t = performance.now();
    if (b && t - hoverAt > 90) { hoverAt = t; audio?.play('hover', { bus: 'ui' }); }
  }, true);
  if (ui?.panels?.on) {
    ui.panels.on('open', () => audio?.play('open', { bus: 'ui' }));
    ui.panels.on('close', () => audio?.play('close', { bus: 'ui' }));
  }
  const toasts = doc?.getElementById('toasts');
  if (toasts && typeof MutationObserver === 'function') {
    new MutationObserver((list) => {
      if (list.some((m) => m.addedNodes.length)) audio?.play('toast', { bus: 'ui' });
    }).observe(toasts, { childList: true });
  }

  // ---- the music scene: Golden Hour, rain, animals (cheap: every 2 s) ------------------------------------------
  function scene() {
    if (!audio || !store.state) return;
    const golden = goldenHourBp(store.state, store.now()) > 0;
    const st = typeof view.stats === 'function' ? view.stats() : null;
    const species = new Set();
    let water = 0;
    let birdbath = 0;
    for (const o of Object.values(store.state.farm.objects)) {
      const d = defOf(o.def);
      if (d && d.kind === 'animal') species.add(d.id);
      if (d && !birdbath && BIRDBATH.test(d.id) && Number.isFinite(o.x) && typeof view.toScreen === 'function'
        && view.toScreen(o.x + 0.5, o.z + 0.5, 0).visible) birdbath = 1;
      // water lapping when a pond is on screen (the river: the view says how near it is, when it can)
      if (d && d.id === 'duck_pond' && Number.isFinite(o.x) && typeof view.toScreen === 'function') {
        const [w, dd] = d.size ?? [4, 4];
        if (view.toScreen(o.x + w / 2, o.z + dd / 2, 0).visible) water = Math.max(water, 0.7);
      }
    }
    if (typeof view.waterNear === 'function') water = Math.max(water, Number(view.waterNear()) || 0);
    audio.setScene({ golden, rain: rainLevel(st), wet: Number.isFinite(st?.wet) ? st.wet : 0, birdbath, animals: [...species],
      createdAt: store.state.meta?.createdAt, water, village: villageBuilt(store.state, store.now()) });
    if (golden && !lastGolden) ui.toast(t('game.golden.start'), {});
    lastGolden = golden;
  }
  const sceneTimer = setInterval(scene, 2000);
  sceneTimer?.unref?.();                                    // node tests: never keeps the process alive
  store.on('welcome', scene);

  return {
    peer(pid, online) {
      if (online && pid !== store.pid) audio?.play('arrive', { force: true });
    },
    partnerPing(pid, x, z, { visual = true } = {}) {
      if (visual && view.avatars?.ping) view.avatars.ping(pid, x, z);
      audio?.play('ping_partner', { force: true });
    },
    partnerEmote(pid, id, { visual = true } = {}) {
      if (visual && view.avatars) {
        if (id === 'high_five' && view.avatars.highFive) view.avatars.highFive(pid);
        else if (view.avatars.emote) view.avatars.emote(pid, EMOTE_VIEW[id] ?? 'wave');
      }
      audio?.play(id === 'high_five' ? 'clap' : 'emote', { partner: true });
    },
    fxMeta(by, local) {
      return { by, local, stroke: local && controller.stroke ? controller.stroke.count : 0 };
    },
    /** Stop the scene timer (tests). */
    dispose() { clearInterval(sceneTimer); clearTimeout(race.timer); },
  };
}
