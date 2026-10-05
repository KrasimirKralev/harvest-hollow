// Leisure systems of M2 (data only before the M2 build): the Fishing Dock (GDD §6.2 mechanic 21) and the Friendly
// Duel (§6.2 "Also", §6.3 "One partner plays more"). Hand-authored. Neither ever pays an economy item: a fish is
// a story and a photo, a duel a crown for a week. Durations in ms, chances in basis points.
import { sec, h, d } from './units.js';

/**
 * The Fishing Dock (L21 with Willow Pond's own dock, or the Fishing Dock decor from L28). A farmer whose avatar stands
 * within `sitRadius` tiles of a spot (as the server sees it, like a bench) casts: a calm `castMs` timing cast with one
 * bite somewhere in `biteMs`; reeling on the bite is `grade` 2 (perfect, within `perfectMs` of it), 1 (good, within
 * `goodMs`) or 0 (the line came back anyway). Never punishing: grade 0 still lands a fish.
 * - Once per `cooldownMs` per player (a period counter per pid).
 * - The fish (species and size) rolls from `ctx.rng('fish', farm.rolls.fish)`: the species by `weightBp`, the size
 *   inside `cm` with the grade lifting the floor (`gradeFloorBp`: 0 / 35 / 60 % of the range). Cosmetic only.
 * - Each cast is one eligible `fish` action for the Pond Treasures set (COLLECTION_SOURCES.fish; the usual drop
 *   chance and pity of COLLECTION_RULES).
 * - The dock's trophy board keeps the biggest catch of each species (the record and who caught it); the week's
 *   biggest fish is offered as a Memory Book photo on Sunday (`weeklyPhoto`).
 * - Together: when the OTHER player casts at the same spot within `together.windowMs`, both get the "fishing
 *   together" deed (quest H6 `together:dock`) and, once a day per player, `together.hearts` Heart each. Casting alone
 *   works the same in every other way (R17: the base is for anyone).
 */
export const FISHING = {
  m: 'M2',
  unlock: 21,
  spots: { expansion: 'willow_pond', decor: 'pond_dock', decorFrom: 28 },
  sitRadius: 2,
  cooldownMs: h(1),
  castMs: sec(20),
  biteMs: [sec(5), sec(15)],
  perfectMs: 400,
  goodMs: 1200,
  gradeFloorBp: [0, 3500, 6000],
  together: { windowMs: sec(20), hearts: 1, heartsPerDay: 1 },
  weeklyPhoto: true,
  collectionSet: 'pond_treasures',
  // a pond's fish: roach and perch most days, a pike now and then, the golden carp once a season or so
  fish: [
    { id: 'roach', name: 'Roach', cm: [12, 30], weightBp: 2800, hue: '#9DA9B0' },
    { id: 'perch', name: 'Perch', cm: [15, 40], weightBp: 2400, hue: '#7E9A4A' },
    { id: 'bream', name: 'Bream', cm: [25, 55], weightBp: 1800, hue: '#B39B5E' },
    { id: 'tench', name: 'Tench', cm: [30, 60], weightBp: 1200, hue: '#5E7A3A' },
    { id: 'carp', name: 'Common Carp', cm: [35, 80], weightBp: 900, hue: '#B8873C' },
    { id: 'pike', name: 'Pike', cm: [50, 110], weightBp: 500, hue: '#6E8B4E' },
    { id: 'koi', name: 'Runaway Koi', cm: [30, 70], weightBp: 250, hue: '#F07A3A' },
    { id: 'golden_carp', name: 'Golden Carp', cm: [40, 90], weightBp: 100, hue: '#F2C230' },
    { id: 'old_boot', name: 'Grandpa\'s Old Boot', cm: [28, 28], weightBp: 50, hue: '#5A4030', joke: true },
  ],
  lines: {
    cast: ['The line settles. Ripples, then stillness.', 'A dragonfly lands on the float.',
      'Somewhere a frog clears its throat.'],
    record: 'A new record for the dock!',
    together: 'Two lines in the water. Nobody is in a hurry.',
    boot: 'Grandpa\'s old boot! So that is where it went.',
  },
};

/**
 * Friendly Duel (M2, opt-in, off by default): one partner invites, the other accepts; for the rest of the Fair week
 * (Monday 00:00 -> Sunday `closeHour`, farm time zone) each farmer's own score counts. The winner wears a crown on the
 * name card for `crownMs`; both get Hearts, and the pennant once. Nothing about a duel ever touches the farm's coins,
 * goods or XP, and the scores are credited so that helping still helps the partner:
 *   pumpkins  units harvested from Pumpkin plots YOU PLANTED (by anyone: harvesting your partner's pumpkins
 *             scores for them, so nobody gains by taking the partner's work)
 *   pies      Pie Oven goods you queued, counted when collected (by anyone)
 *   orders    orders you filled; a simple order counts a quarter (R15), stored x4
 * A tie crowns both. A duel nobody scored in ends quietly (no crown, no Hearts). At most one duel at a time;
 * an invitation lapses at the week's close or after `inviteMs`.
 */
export const DUEL = {
  m: 'M2',
  unlock: 29,
  closeDay: 6,
  closeHour: 20,
  inviteMs: h(24),
  kinds: [
    { id: 'pumpkins', name: 'Pumpkin Patch Duel', unlock: 9, text: 'Most Pumpkins from the plots you planted',
      count: 'harvest:pumpkin', credit: 'planter', scale: 1 },
    { id: 'pies', name: 'Pie Bake-off', unlock: 15, text: 'Most pies from the Pie Oven queues you started',
      count: 'craft:pie_oven', credit: 'queuer', scale: 1 },
    { id: 'orders', name: 'Order Rush', unlock: 2, text: 'Most orders filled (a quick simple order counts a quarter)',
      count: 'fill:order', credit: 'filler', scale: 4 },
  ],
  crown: { ms: d(7), title: 'Duel Champion' },
  rewards: { hearts: 2, firstDecor: 'duel_pennant' },
  lines: {
    invite: '{name} challenges you to a {duel}! Until Sunday evening. Just for fun.',
    accept: 'Game on! May the best farmer win (and share the pie).',
    win: '{name} wins the {duel}! The crown is theirs for a week.',
    tie: 'A dead heat! Two crowns this week.',
    over: 'The duel is over. Whoever won, the farm did well.',
  },
};
