// Weekly systems of M1b/M2 (data only in the M1a build): the County Fair (GDD §5.6), the River Barge (§5.7) and the
// townsfolk board with Friendship (§5.3). Hand-authored rule numbers; percentages and E-hours in basis points.
import { h, min } from './units.js';
import { NPCS } from './npcs.js';

/**
 * County Fair (L14). Week: Monday 00:00 -> Sunday 20:00 (farm time zone), results ceremony Sunday 20:00.
 * Weekly target W = nice(E(level on Monday) x 0.18 / 100) points (wave-2 QA D2: the GDD's 0.3 gave the reference
 * couple Bronze nine weeks in ten; 0.18 meets its stated outcome, Silver+ ~9 weeks in 10, Gold about half). Points
 * carry one decimal (stored x10).
 * Medals are fractions of W; a medal pays 1.5 x the value of its threshold (fraction x W x 100 coins x 1.5).
 */
export const FAIR = {
  unlock: 14,
  m: 'M1b',
  targetHoursBp: 1600,
  pointValue: 100,
  payBp: 15_000,
  closeDay: 6,
  closeHour: 20,
  points: {
    prizedCropPerGross: 100,       // a blue-ribbon crop harvest = plot gross / 100
    prizedFruitBase: 3,            // a blue-ribbon fruit = 3 + V / 100
    prizedAnimalGoodMul: 2,        // a blue-ribbon animal good entered = 2 x V / 100
    entryDiv: 100,                 // a T3/T4/duet good entered = V / 100
    duetMul: 2,
    hamperMul: 2,
    hamperFrom: 32,
    maxEntriesPerItem: 10,
    horseShowMul: 2,
    horseShowFrom: 25,
  },
  medals: [
    { id: 'bronze1', name: 'Bronze I', atBp: 2000 },
    { id: 'bronze2', name: 'Bronze II', atBp: 3500 },
    { id: 'bronze3', name: 'Bronze III', atBp: 5000 },
    { id: 'silver1', name: 'Silver I', atBp: 6000, acorns: 2 },
    { id: 'silver2', name: 'Silver II', atBp: 7000, acorns: 2 },
    { id: 'silver3', name: 'Silver III', atBp: 8000, acorns: 2 },
    { id: 'gold1', name: 'Gold I', atBp: 9000, acorns: 4, trophy: true },
    { id: 'gold2', name: 'Gold II', atBp: 10_000, acorns: 4, trophy: true },
    { id: 'gold3', name: 'Gold III', atBp: 11_500, acorns: 4, trophy: true },
    { id: 'platinum', name: 'Platinum', atBp: 14_000, acorns: 6, banner: true, goldenHourMs: h(24),
      needsProject: 'fair_grounds', m: 'M2' },
  ],
  /**
   * NPC league (L27, M2): the couple (always together, never against each other) and five NPC farms. An NPC's week:
   * W x (npcMinBp + npcSpreadBp x hash01(farmSeed, week, npc)) / 10000, W frozen on Monday like the couple's target
   * (GDD §5.6). Ranked on Sunday at the ceremony: places 1-`promote` move up (the top league needs `topNeedsProject`
   * complete, Restoration 5), the last `demote` places move down, never below league 1. Each week pays the league's
   * number x `acornsPerTier` Acorns. A farm starts in league `start`. Every league meets the same county (the GDD
   * formula): at the reference couple's median week (about 1.0 x W) that is a top-two place about 3 weeks in 10 and a
   * last place about 1 in 70, so League 2 comes in the first month, 4 in about three months and 5 (behind the Fair
   * Grounds) later: the League Climber ribbon's Bronze / Silver / Gold (wave 3: a per-league NPC step was measured
   * on paper and dropped, it left League 4 out of the couple's reach).
   */
  league: {
    unlock: 27, m: 'M2', farms: ['Brambleton', 'Oakhurst', 'Mill Creek', 'Cobble Hill', 'Fennimore'], leagues: 5,
    npcMinBp: 6000, npcSpreadBp: 7000, promote: 2, demote: 1, acornsPerTier: 1, start: 1,
    topNeedsProject: 'fair_grounds',
    names: ['Hedgerow League', 'Meadow League', 'Orchard League', 'Valley League', 'County League'],
    npcs: [
      { id: 'brambleton', name: 'Brambleton', farmer: 'the Bramble sisters', hue: '#B5452E',
        motto: 'Jam first, questions later.' },
      { id: 'oakhurst', name: 'Oakhurst', farmer: 'old Mr Oakes', hue: '#6B7F3A',
        motto: 'Slow and steady wins the rosette.' },
      { id: 'mill_creek', name: 'Mill Creek', farmer: 'the Millers', hue: '#3E7FA8',
        motto: 'Up with the lark, done by dark.' },
      { id: 'cobble_hill', name: 'Cobble Hill', farmer: 'Farmer Cobb and his geese', hue: '#8C6A9E',
        motto: 'The geese are in charge.' },
      { id: 'fennimore', name: 'Fennimore', farmer: 'young Fenn', hue: '#D9A03A',
        motto: 'New to this, and loving it.' },
    ],
  },
  /** Horse show (L25, M2 feature `horse_show`): a blue-ribbon horse's Show Ribbon entered at the Fair tent counts
   * `points.horseShowMul` x (FAIR.points.horseShowFrom); the Stable Paddock expansion (L27) puts the show ring on the
   * farm (cosmetic: the horses trot it on Sunday afternoons). */
  horseShow: { unlock: 25, m: 'M2', item: 'show_ribbon', ring: 'stable_paddock' },
};

/**
 * River Barge (L15). Captain Reed docks Monday 06:00 and casts off Sunday 20:00. One row of 3 crates per 3 hours
 * played last week (1-3 rows). A crate is one item x quantity worth E x 0.08 h, capped by 30 minutes of one producer,
 * from goods the farm made in the last 14 days; never two crates sharing a direct input. (Wave-2 QA D2: crates sized
 * for three evenings a week; the old 2 h / 0.3 / 6 h left 0 full rows in 30 evenings on the real rules. Final pass,
 * 2026-10-04: 0.12 h / 1 h / a never-made good weighted x3 still gave 4-6 full rows in 10 weeks, one stubborn crate
 * of 12 Planks, 12 Bread or a T4 good nobody had made costing the week; 0.08 h / 30 min / x1 give 6-10 on the real
 * rules, seeds 1-7, 11, 23. Orders still ask for never-delivered goods 4x as often.)
 */
export const BARGE = {
  unlock: 15,
  m: 'M1b',
  dockDay: 0, dockHour: 6, castOffDay: 6, castOffHour: 20,
  cratesPerRow: 3, rowsMin: 1, rowsMax: 3, playMsPerRow: h(3),
  crateHoursBp: 800, producerCapMs: min(30), madeWithinMs: h(24 * 14),
  payBp: 16_000, xpShareBp: 2000, horseBp: 500, horseMaxBp: 2000,
  row: { coinsHoursBp: 2500, riverbankBp: 2500, acorns: 1, chestShareDiv: 3 },
  /** The Captain's chest of ladder tier t (1-5): (1 + t) Acorns, 3t Compost, a decor roll from tier 3. A week with
   * every offered row loaded raises t by 1, a week without lowers it by 1 (never below 1). */
  chest: { tiers: 5, acornsBase: 1, compostPerTier: 3, decorFrom: 3 },
  helpFlags: 3,
  /** A good the farm has never made (and can make now) is this many times as likely as a made one, at most one crate
   * a week (wave-2 QA RC-15: seven recipes were never asked for by anything; final pass: 3 -> 1, see above). */
  neverMadeMul: 1,
};

// Friendship gifts (GDD §5.3: "every 2 Friendship unlock a decor gift or a recipe-card variant"): at 2, 6 and 10 a
// free decor piece into the build tray (reward decor that already has a model; a copy, so two townsfolk may give the
// same thing), at 4 and 8 a recipe-card variant for the Journal (cosmetic, no economy): the townsperson's own take on
// one of the goods they like.
const gifts = (a, b, c) => [a, b, c];
const DECOR_GIFTS = {
  mabel: gifts('flower_cart', 'bunting', 'picnic_table'),
  ollie: gifts('picnic_table', 'bird_feeder', 'lucky_horseshoe'),
  fern: gifts('milk_churn', 'bird_feeder', 'lucky_horseshoe'),
  juniper: gifts('tulip_planter', 'sunflower_planter', 'flower_cart'),
  reed: gifts('bunting', 'lucky_horseshoe', 'snow_lantern'),
  pemberton: gifts('bunting', 'garden_gnome', 'sunflower_planter'),
  pip: gifts('bird_feeder', 'garden_gnome', 'flower_cart'),
  rosie: gifts('milk_churn', 'picnic_table', 'tulip_planter'),
  tom: gifts('snow_lantern', 'pumpkin_lanterns', 'garden_gnome'),
  lucia: gifts('tulip_planter', 'bird_feeder', 'sunflower_planter'),
};
const likesOf = (id) => NPCS.find((n) => n.id === id)?.likes ?? [];
const GIFTS = Object.fromEntries(Object.entries(DECOR_GIFTS).map(([id, [a, b, c]]) => [id, [{ decor: a },
  { card: likesOf(id)[0] }, { decor: b }, { card: likesOf(id)[1] }, { decor: c }]]));

/**
 * Townsfolk board (L21) and Friendship (GDD §5.3). `friendship.rewards[npcId]` lists what each step of
 * `rewardEvery` Friendship pays: `{ decor }` (a free copy into the build tray) or `{ card }` (a recipe-card variant:
 * `card` is the liked item it is about; the Journal shows "<name>'s <item> card"). Filled in from the NPC table.
 */
export const TOWNSFOLK = {
  unlock: 21,
  m: 'M1b',
  postsPerWeek: 3,
  goods: [2, 3],
  // a request is worth about two orders (wave-2 QA D2: E x 0.5 h of 4-hour goods was half an evening of the farm)
  valueHoursBp: 2500,
  maxMachineMs: h(2),
  payBp: 15_000,
  coinShareBp: 7000,
  friendship: { max: 10, goldenOrder: 1, request: 1, chainQuest: 2, giftPerDay: 1, rewardEvery: 2, rewards: GIFTS },
};
