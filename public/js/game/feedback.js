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
//
// Release 1.0 (life-feel lane, rel-life-feel.md):
//   - M4: fxMeta adds `from`, the button a reward came from (ui-panels' window 'hh:act-from', within ACT_FROM_MS), so
//     its coins and loot fly from that button above the panel (render/fx.js); the quest jingle plays when its card is
//     really on screen (ui/toasts.js 'hh:card'), not under a panel that hides it; a pip on the panel's title ticks
//   - F1 (feel#5, #14): one sound per press: no generic click on a control with a sound of its own (`data-sfx="own"` or
//     OWN_SFX: dock, tools, seeds), no 'open' / 'tab' right after a generic click of the same press, a tool change
//     that plants in the same moment plays only the planting; no toast blip for a refusal, a lost race or a line that
//     came with a bonk; hover ticks on the dock and tool buttons only. The long jingles queue in audio.js (F1)
//   - F4 (feel#9): 'done' at 0.6 when an on-screen workshop's tray turns ready (scene(), every 2 s; at most once per
//     3 s, panned by screen x; crops stay silent)
//   - G11b (feel#12): view.on('ripened'): a gold burst and `find` at 0.25, at most once per field per 5 s
//   - F5 (feel#11): pulses for planting (every 3rd plot of a stroke), a bonk, coins, a reward (quest card, order)
//   - M5: Mabel's board puffs (fx `stallDone`) once the Orders panel closes after an order was filled
//   - feel#15: the 'open' blip when the seed popover opens at a plot
// QA r1 (life-feel): L-01 opening a surprise (the box on the farm or the gift sheet's "Open it") raises one card above
//   any open panel: who wrapped what, the giver's note in quotes, ♥ Thanks (giftCard); L-05 the opening has a soft reveal
//   sound; L-11 the Farm book's dock button ticks on hover and opens with 'open' like the other dock buttons
import { landRef } from '../ui/panels/w5-rules.js';
import { defOf, itemOf, COOP, SAFETY, CONTENT, FAIR, isLive, levelFromXp } from '../../../shared/content/index.js';
import { acornsToday } from '../../../shared/rules/economy.js';
import { SOFT, ERR } from '../../../shared/net/protocol.js';
import { goldenHourBp, comboActive } from '../../../shared/rules/coop.js';
import { EMOTE_VIEW } from './controller.js';
import { dropKeyHints } from './touch.js';
import { feedRows } from '../../../shared/rules/feed.js';
import { t, tn, list, N, name as cname } from '../i18n/index.js';
import { noteText, goalText } from '../ui/goal-text.js';
import { halvesOf, halfMsg } from '../../../shared/rules/goals.js';

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
  thump: 'bunny', nibble: 'bunny', sniff: 'bunny',
  // wave 5 (bison, quail): whatever call content gives them borrows the nearest sample (a deep low, a small cluck)
  grunt: 'moo', snort: 'moo', bellow: 'moo', low: 'moo', chirp: 'cluck', peep: 'cluck', coo: 'cluck', whistle: 'cluck' });
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
    // wave 5: a pair's event names its species
    const d = defOf(ev.animal || (o && o.def) || ev.species);
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
    // ---- wave 5 (the owners' wish list of 2026-10-05) ----------------------------------------------------------
    // list 1, wish 1: two animals paired in their pen (a soft heart chime and their own call); the baby arrives
    case 'paired': return [['thanks', { gain: 0.55 }], ...animalSound()];
    case 'pairCancelled': return [['close']];
    case 'penBorn': return [['hop'], ['find', { gain: 0.6 }], ...animalSound()];
    // list 2, wish 3: the dog told to stay home or to come along: its own woof (a cat's meow), softer for "stay"
    case 'petStay': return [[ev.kind === 'cat' ? 'meow' : 'woof', { gain: ev.stay === true ? 0.5 : 0.75 }]];
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
    // QA r1 L-05 (jde#8): a surprise unwrapped: a soft reveal (a box the farm shelved by itself after 48 h stays quiet)
    case 'giftOpened': return ev.auto ? [] : [['find', { gain: 0.7 }], ['thanks', { gain: 0.6, at: 0.25 }]];
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

/** QA r1 L-01: the reveal card comes this long after the box starts to open (its burst plays first when it is in view). */
export const GIFT_CARD_MS = 700;

/**
 * QA r1 L-01 (jde#1, coop#1, fe#3): the card for a surprise its recipient `me` just opened, or null (the giver, a box
 * the farm shelved by itself). "A surprise from {giver}!", "{giver} wrapped {item} for you", the giver's note in quotes
 * and "♥ Thanks", which calls `thank(i)` with the giver's "left a surprise" feed line (the rules' thank; no button once
 * that line was thanked). `over`: shown at once, above any open panel (ui/toasts.js). Words are functions (a language
 * switch while the card is up says them again). Pure.
 */
export function giftCard(ev, state, me, { thank = null } = {}) {
  if (!ev || ev.e !== 'giftOpened' || ev.auto || ev.to !== me || !state || !state.players) return null;
  const giver = Object.hasOwn(state.players, ev.from) ? state.players[ev.from].name : null;
  const who = () => giver ?? t('common.partner');
  const item = typeof ev.item === 'string' && ev.item ? ev.item : null;
  const known = Boolean(item && itemOf(item));
  const ref = () => (known ? N(item, 'items') : item ? item.replace(/_/g, ' ') : t('feed.something'));
  const note = typeof ev.note === 'string' && ev.note.trim() ? ev.note.trim() : null;
  const left = feedRows(state).find(([, r]) => r.k === 'surprise' && r.what === 'left' && r.by === ev.from && r.at === ev.at);
  const can = Boolean(left && !left[1].ty && typeof thank === 'function');
  return {
    id: `gift-open-${ev.id}`, kind: 'gift', over: true, ttl: 12_000,
    // (QA r2 L2-09: a short ribbon: the message under it names the giver, and a 16-letter name ran it to three lines)
    ribbon: () => t('cheer.gift.ribbon'),
    message: () => t('cheer.gift.wrapped', { name: who(), item: ref() }),
    // F2-02: a one-tap note ("#thanks") in this reader's language, a typed one as typed
    quote: note ? () => t('cheer.gift.quote', { note: noteText(note) }) : null,
    things: item ? [{ icon: item, name: () => (known ? cname(item, { family: 'items' }) : ref()) }] : [],
    actions: can ? [{ label: () => t('cheer.gift.thanks'), kind: 'go', fn: () => thank(left[0]) }] : [],
  };
}

/** M4: how long a pressed button stays the source of the reward it caused (ui-panels' 'hh:act-from' before its act). */
export const ACT_FROM_MS = 1500;
/** F1 (feel#14): controls whose press has a sound of its own (a tool's tab, a panel's open, a seed's planting). */
// (QA r1 L-11: the Farm book, the dock's fifth button, sounds like the other four: a hover tick, 'open' on its press)
export const OWN_SFX = '[data-sfx="own"], [data-dock], [data-farmbook], [data-tool], [data-tile], .dock-btn, .dock-mini, .m-menu-btn, .tool, .seed, .sp-seed, .ss-seed, .m-tile';
/** F1: hover ticks only here (moving across a 45-button HUD made the interface chatter). */
export const HOVER_SFX = '[data-dock], [data-farmbook], [data-tool], .dock-btn, .dock-mini, .m-menu-btn, .tool';
/** A sound of its own within this long after a generic click is the same press (one sound per press). */
export const SAME_PRESS_MS = 300;

/**
 * G11b (feel#12): a ripen sparkle at most once per field per `windowMs`: a ripe plot within `radius` tiles of one that
 * sparkled less than windowMs ago belongs to that field. Returns allow(pos { x, z } tiles, nowMs) -> boolean. Pure.
 */
export function createRipenThrottle({ windowMs = 5000, radius = 6 } = {}) {
  const shown = [];
  return (pos, now) => {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return false;
    for (let i = shown.length - 1; i >= 0; i--) if (now - shown[i].at >= windowMs) shown.splice(i, 1);
    if (shown.some((p) => Math.abs(p.x - pos.x) <= radius && Math.abs(p.z - pos.z) <= radius)) return false;
    shown.push({ x: pos.x, z: pos.z, at: now });
    return true;
  };
}

/** F4 (feel#9): how many finished items each workshop holds at `now` (queue items past their end + a composter's
 *  `ready`), by object id. Crops are not workshops (they stay silent). Pure. */
export function readyCounts(state, now) {
  const out = new Map();
  const objs = state && state.farm ? state.farm.objects : {};
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    if (!o || !Array.isArray(o.queue)) continue;
    let n = 0;
    for (const q of o.queue) if (Number.isFinite(q?.e) && q.e <= now) n++;
    out.set(id, n + (Number.isFinite(o.ready) ? o.ready : 0));
  }
  return out;
}
/** The workshops whose tray grew from `prev` to `next` (a first look counts nothing). Pure. */
export function turnedReady(prev, next) {
  const ids = [];
  for (const [id, n] of next) if (prev.has(id) && n > prev.get(id)) ids.push(id);
  return ids;
}
/** F4: the 'done' chime's own throttle (at most once per gapMs). Pure. */
export const DONE_GAP_MS = 3000;
/** F3: the chisel taps start when the camera's glide to the sign ends (ui/naming.js CARVE.focusMs). */
export const CARVE_MS = 600;

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
  // QA r2 F2-03: a big planting stroke (the plant action emits bigSpend with what = the crop, n = plots) is no purchase
  if (has('planted') && what && CONTENT.crops.has(what)) text = t('feat.later.headsUp', { who, n: big.n ?? 1, crop: N(what), price });
  else if (has('slotUpgraded')) text = def ? t('game.spend.slot', { who, thing: N(def.id), price }) : t('game.spend.slotAny', { who, price });
  else if (has('homeUpgraded')) text = def ? t('game.spend.home', { who, thing: N(def.id), price }) : t('game.spend.homeAny', { who, price });
  else if (has('barnUpgraded')) text = t('game.spend.barn', { who, price });
  else if (has('expanded')) {
    // wave 5: the land is a parcel (several old pieces) where the build sells parcels
    const land = landRef(what);
    text = land ? t('game.spend.landNamed', { who, land: N(what, land.family), price }) : t('game.spend.land', { who, price });
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
  // M4: the button the latest reward came from (ui-panels' kit buttons announce it right before they act)
  let actFrom = null;                                     // { el, at }
  globalThis.addEventListener?.('hh:act-from', (e) => { if (e?.detail?.from) actFrom = { el: e.detail.from, at: performance.now() }; });
  const fromNow = () => (actFrom && performance.now() - actFrom.at < ACT_FROM_MS && actFrom.el.isConnected !== false ? actFrom.el : null);
  // F1: the moment of the last generic click and of the last bonk (one sound per press / no blip on a bonk)
  let clickAt = -Infinity;
  let bonkAt = -Infinity;
  const bonk = (o) => { bonkAt = performance.now(); audio?.play('bonk', o); haptic('bonk'); };
  const haptic = (k) => { try { if (typeof controller.haptic === 'function') controller.haptic(k); } catch { /* none */ } };
  const productive = { me: -Infinity, partner: -Infinity };     // performance.now() of the last confirmed productive action
  const race = { timer: null, by: null, code: null, n: 0, ids: [] };
  let lastGolden = false;
  let goldenCardAt = -Infinity;               // L4-07: the Golden Hour banner says it

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
  let lastFx = null;
  store.on('fx', ({ ev, by, local }) => {
    lastFx = ev;
    queueMicrotask(() => { if (lastFx === ev) lastFx = null; });
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

  // ---- QA r3 F3-05 (features' patch): my half of a same-day Together task is done ("Your half is done ✓ · Mia sits
  // on a bench today"): once per task a farm day, on my own confirmed action (♥: no bench or rod icon exists)
  const halfSaid = new Set();
  store.on('delta', (d) => {
    if (d.cid !== store.cid || !store.state || !(d.ev || []).some((ev) => ev.e === 'seated' || ev.e === 'fishCast')) return;
    for (const { qid, half } of halvesOf(store.state, store.pid, store.now())) {
      const key = `${qid}:${half.kind}:${store.state.farm.coop?.days?.d}`;
      if (!half.mine || halfSaid.has(key)) continue;
      halfSaid.add(key);
      ui.toast(goalText(halfMsg(store.state, half)), { kind: 'love', ms: 6000 });
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
    if (ev.e === 'stored') {
      const text = t(`game.moved.stored${pin}`, { name: name(by), thing });
      // a finger has no B key (ui-shell QA r1 S-16)
      ui.toast(controller.input === 'touch' ? dropKeyHints(text) : text, { kind: 'info', icon: ev.def ?? m.def, ms: 6000 });
      return;
    }
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
        // (release 1.0 S6: personal titles stay quiet below farm level 5, like their cards in ui/levelup.js)
        if (ev.scope === 'player') { if (ev.pid === store.pid && levelFromXp(store.state?.farm?.xp ?? 0) >= 5) audio.play('mastery', { force: true }); break; }
        audio.duck(1.8);
        audio.play('levelup', { force: true });
        break;
      case 'mastery': audio.play('mastery', { force: true }); break;
      case 'fairCeremony': ceremony(ev); break;
      case 'achievement': audio.play('achievement', { force: true }); break;
      // M4: the quest jingle plays when its card is on screen ('hh:card' above), never under a panel that hides it
      case 'questDone': break;
      case 'duet': audio.play('duet', { force: true }); break;
      case 'together':
        if (ev.kind === 'highFive') {
          audio.play('clap', { force: true });
          if (view.avatars?.highFive && ev.a && ev.b) view.avatars.highFive(ev.a, ev.b);
        } else if (ev.kind === 'goldenHour') {
          goldenCardAt = performance.now();
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
    if (!lostRace) { bonk({ gain: 0.6 }); ui.toast(r.code, { by: r.by, type: r.type, args: r.args }); return; }
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

  controller.on('invalid', (e) => { if (!e || !e.race) bonk(); });   // a lost race is never an error
  // F1: a tool change plays its tab, unless it is the same press as a generic click, or a planting follows in the same
  // moment (a seed picked at a plot: the planting is that press's sound)
  let tabTimer = null;
  let plantedAt = -Infinity;
  controller.on('tool', () => {
    if (performance.now() - clickAt < SAME_PRESS_MS) return;
    clearTimeout(tabTimer);
    tabTimer = setTimeout(() => { tabTimer = null; if (performance.now() - plantedAt > 120) audio?.play('tab', { bus: 'ui' }); }, 0);
  });
  store.on('fx', ({ ev, local }) => { if (local && ev && ev.e === 'planted') { plantedAt = performance.now(); if (tabTimer) { clearTimeout(tabTimer); tabTimer = null; } } });

  // ---- haptics (mobile wave): a short pulse for my own harvests, collections and placements, a pattern for a farm
  // level-up (controller.haptic: touch players with haptics on; Android only, iOS has no vibration API) ------------
  const plantRun = { n: 0, at: -Infinity };
  store.on('fx', ({ ev, local }) => {
    if (!local || !ev || typeof controller.haptic !== 'function') return;
    if (HAPTIC_HARVEST.has(ev.e)) controller.haptic('harvest');
    else if (ev.e === 'placed') controller.haptic('place');
    else if (ev.e === 'planted') {
      // F5: a soft tick on every third plot of a stroke (a 30-plot stroke is a purr, not a buzz)
      const t = performance.now();
      plantRun.n = t - plantRun.at > STREAK_MS ? 1 : plantRun.n + 1;
      plantRun.at = t;
      if (plantRun.n % 3 === 1) controller.haptic('plant');
    } else if (ev.e === 'sold' && ev.coins > 0) controller.haptic('coins');
    else if (ev.e === 'orderFilled' || ev.e === 'folkFilled') controller.haptic('reward');
  });
  store.on('celebrate', ({ ev }) => {
    if (ev && ev.e === 'levelUp' && ev.scope !== 'player' && typeof controller.haptic === 'function') controller.haptic('levelUp');
  });

  // ---- UI sounds without coupling: any button press, panels opening/closing, toasts appearing ----------------
  const doc = typeof document !== 'undefined' ? document : null;
  doc?.addEventListener('pointerdown', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button, [role="button"], [role="tab"], summary');
    if (!b || b.disabled) return;
    // F1: a control with a sound of its own plays only that (the tool's tab, the panel's open, the seed's planting)
    if (b.closest(OWN_SFX)) return;
    clickAt = performance.now();
    audio?.play(b.getAttribute('role') === 'tab' ? 'tab' : 'click', { bus: 'ui' });
  }, true);
  let hoverAt = 0;
  doc?.addEventListener('pointerover', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button:not(:disabled), [role="button"]');
    const t = performance.now();
    // F1: hover ticks on the dock and the tools only
    if (b && b.closest(HOVER_SFX) && t - hoverAt > 90) { hoverAt = t; audio?.play('hover', { bus: 'ui' }); }
  }, true);
  if (ui?.panels?.on) {
    ui.panels.on('open', () => { if (performance.now() - clickAt >= SAME_PRESS_MS) audio?.play('open', { bus: 'ui' }); });
    ui.panels.on('close', (name) => {
      if (performance.now() - clickAt >= SAME_PRESS_MS) audio?.play('close', { bus: 'ui' });
      if (name === 'orders' || !ui.panels.top?.()) stall();
    });
  }
  // F1: a toast's blip, unless the line is a refusal or a lost race (their own sound, or none), or came with a bonk
  globalThis.addEventListener?.('hh:toast', (e) => {
    const d = e?.detail ?? {};
    if (d.code || d.race || performance.now() - bonkAt < 60) return;
    audio?.play('toast', { bus: 'ui' });
  });
  // M4: the quest jingle when its card is really on screen (a card held under a panel slides in when it closes)
  globalThis.addEventListener?.('hh:card', (e) => {
    if (e?.detail?.kind !== 'quest') return;
    audio?.duck(1.2);
    audio?.play('quest', { force: true });
    haptic('reward');
  });
  // M4: the reward pip on an open panel's title: a small tick now, the jingle comes with the card
  globalThis.addEventListener?.('hh:pip', () => audio?.play('xp', { gain: 0.6, bus: 'ui' }));
  // feel#15: the seed popover at an empty plot opens with the panels' blip
  // (the feedback layer starts before ui.init builds the popover: look for it once the HUD is up)
  const watchSeedPop = (tries = 0) => {
    const seedPop = doc?.querySelector?.('.seed-pop');
    if (!seedPop) { if (tries < 20 && doc) setTimeout(() => watchSeedPop(tries + 1), 500); return; }
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(() => { if (!seedPop.hidden) audio?.play('open', { bus: 'ui', gain: 0.8 }); })
      .observe(seedPop, { attributes: true, attributeFilter: ['hidden'] });
  };
  if (doc) setTimeout(watchSeedPop, 0);

  // ---- F3 (feel#8): my farm carved: three chisel taps as the chips fly, then the mastery chime ------------------------
  store.on('fx', ({ ev, by }) => {
    if (!ev || ev.e !== 'named' || ev.what !== 'farm' || by !== store.pid) return;
    setTimeout(() => {
      for (let i = 0; i < 3; i++) audio?.play('chop1', { rate: 1.6, gain: 0.8, at: i * 0.12 + 0.001, force: true });
      audio?.play('mastery', { force: true, gain: 0.9, at: 0.42 });
    }, CARVE_MS);
  });

  // ---- QA r1 L-01: my surprise opened, through either door (the box on the farm, the gift sheet's "Open it"): the card
  // with the giver's words, above whatever is open, a moment after the box starts to open; a reward pulse at once
  store.on('fx', ({ ev, by }) => {
    if (!ev || ev.e !== 'giftOpened' || ev.auto || ev.to !== store.pid || by !== store.pid) return;
    haptic('reward');
    setTimeout(() => {
      const spec = giftCard(ev, store.state, store.pid, { thank: (i) => controller.do?.('thank', { i }) });
      if (spec) ui?.banner?.(spec);
    }, GIFT_CARD_MS);
  });

  // ---- QA r2 L2-07 (coop#6): the partner left me a surprise on the porch while I am here: say so, with the way there --
  store.on('fx', ({ ev, by }) => {
    if (!ev || ev.e !== 'keepsake' || ev.shelf || !ev.id || ev.to !== store.pid || by === store.pid) return;
    const giver = store.state?.players?.[ev.by ?? by]?.name ?? t('common.partner');
    const box = () => store.state?.farm.objects?.[ev.id] ?? null;
    ui?.toast?.(() => t('cheer.gift.leftYou', { name: giver }), { kind: 'love', ms: 8000,
      action: { label: () => t('moments.showMe'), fn: () => { const o = box(); if (o) view?.focus?.(o.x + 0.5, o.z + 0.5); } } });
  });

  // ---- D4: the name tags (render/name-tags.js) follow what the pointer is on and the home card that is open ----------
  const say = (name, detail) => { try { globalThis.dispatchEvent?.(new CustomEvent(name, { detail })); } catch { /* no window */ } };
  let hoverSaid;
  controller.on('hover', (p) => {
    const id = p && typeof p.id === 'string' ? p.id : null;
    if (id !== hoverSaid) { hoverSaid = id; say('hh:world-hover', { id }); }
  });
  ui?.panels?.on?.('open', (name, args) => { if (name === 'animals') say('hh:home-card', { id: args?.id ?? null }); });
  ui?.panels?.on?.('close', (name) => { if (name === 'animals') say('hh:home-card', { id: null }); });

  // ---- M5: Mabel's board puffs once the Orders panel closes after an order was filled -------------------------------
  let stallPending = false;
  function stall() {
    if (!stallPending || ui?.panels?.top?.()) return;
    stallPending = false;
    const objs = store.state?.farm.objects ?? {};
    const id = Object.keys(objs).sort().find((k) => objs[k].def === 'order_board');
    if (!id) return;
    try { view.fx.play({ e: 'stallDone', id }, undefined, { by: store.pid, local: true }); } catch { /* fx not ready */ }
    const { pan, visible } = placeOf({ id });
    if (visible) audio?.play('crate', { gain: 0.5, pan });
  }
  store.on('fx', ({ ev, local }) => {
    if (!local || !ev || ev.e !== 'orderFilled') return;
    stallPending = true;
    if (!ui?.panels?.top?.()) setTimeout(stall, 400);
  });

  // ---- G11b: a plot turns ripe on screen (render-look's view.on('ripened')): a gold burst and a soft find ------------
  const ripen = createRipenThrottle();
  view.on?.('ripened', (r) => {
    if (!r || !r.pos || !ripen(r.pos, performance.now())) return;
    try { view.fx.play({ e: 'ripened', id: r.id, crop: r.crop }, r.pos, { by: null, local: true }); } catch { /* fx not ready */ }
    const w = (typeof window !== 'undefined' && window.innerWidth) || 1;
    const pan = r.screen && Number.isFinite(r.screen.x) ? Math.max(-0.8, Math.min(0.8, ((r.screen.x / w) * 2 - 1) * 0.8)) : 0;
    audio?.play('find', { gain: 0.25, pan });
  });

  // ---- the music scene: Golden Hour, rain, animals (cheap: every 2 s) ------------------------------------------
  // F4: a workshop's tray that turns ready while on screen rings 'done' (crops stay silent, GDD §7.2)
  let trays = new Map();
  let doneAt = -Infinity;
  function doneChime() {
    const next = readyCounts(store.state, store.now());
    const ids = turnedReady(trays, next);
    trays = next;
    if (!ids.length || performance.now() - doneAt < DONE_GAP_MS) return;
    for (const id of ids) {
      const { pan, visible } = placeOf({ id });
      if (!visible) continue;
      doneAt = performance.now();
      audio?.play('done', { gain: 0.6, pan });
      return;
    }
  }
  function scene() {
    if (!audio || !store.state) return;
    doneChime();
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
    // QA r4 L4-07: one voice for the start: the banner when it came (both screens), else this line (a reload)
    if (golden && !lastGolden) setTimeout(() => { if (performance.now() - goldenCardAt > 5000 && lastGolden) ui.toast(t('game.golden.start'), {}); }, 2500);
    lastGolden = golden;
  }
  const sceneTimer = setInterval(scene, 2000);
  sceneTimer?.unref?.();                                    // node tests: never keeps the process alive
  store.on('welcome', scene);
  // the arrival chime plays when the shell tells the partner arrived (window 'hh:peer', ui/index.js peerNews): a
  // welcome's first look, a reload or a server restart inside 10 s is no arrival (ui-shell QA r2 S2-02, jde#1: a restart
  // played "arrived" with its sound though nobody left)
  globalThis.addEventListener?.('hh:peer', (e) => {
    if (e?.detail?.online && e.detail.pid !== store.pid) audio?.play('arrive', { force: true });
  });

  return {
    /** MSG.PEER (main.js): the chime waits for the shell's word ('hh:peer' above). */
    peer() {},
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
    /** The meta main.js passes to view.fx.play. `ev` (additive): its named animal's name (D4); without it, the event
     *  this layer just heard (its 'fx' listener runs before main.js's, in the same task). */
    fxMeta(by, local, ev = lastFx) {
      const name = ev && ev.e === 'collected' && typeof ev.id === 'string' ? store.state?.farm?.names?.[ev.id]?.name ?? null : null;
      return { by, local, stroke: local && controller.stroke ? controller.stroke.count : 0, from: local ? fromNow() : null, ...(name ? { name } : {}) };
    },
    /** Stop the scene timer (tests). */
    dispose() { clearInterval(sceneTimer); clearTimeout(race.timer); },
  };
}
