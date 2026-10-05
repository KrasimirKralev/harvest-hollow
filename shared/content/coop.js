// Co-op numbers (GDD §6.2 mechanics, §6.3 conflict rules, §6.4 activity feed). Hand-authored. Every partner
// bonus is an extra on top of a base anyone gets (R17), so nobody gains by leaving work for the partner. All
// "the other player" checks compare player ids on the server (two tabs of one player are one pid, §9 #20).
// Percentages are basis points; durations are ms.
import { sec, min, h } from './units.js';

export const COOP = {
  /** #2 pings, emotes and notes. */
  pings: { perMs: sec(1), m: 'M1a' },
  emotes: { free: ['wave', 'heart', 'laugh', 'thumbs_up', 'come_here', 'cheer', 'high_five', 'dance'], m: 'M1a' },
  notes: { maxChars: 140, maxOpen: 30, m: 'M1a' },
  /** #3 help flags: anyone may fill a flagged order / crate / request / bundle slot for the normal reward; when the
   * OTHER player fills it, +10 % XP on it and +1 Heart each. Self-fill pays no bonus (§9 #19). */
  helpFlags: { xpBonusBp: 1000, hearts: 1, m: 'M1a' },
  /** #4 partner tend: watering by anyone (crops -15 %, trees -20 %) + once per cycle the OTHER player's -5 %;
   * +1 Heart per partner-tend stroke, at most 10 a day. */
  partnerTend: { bp: 500, heartsPerStroke: 1, heartsPerDay: 10, m: 'M1a' },
  /** #5 teamwork harvest: personal XP 40 % planter / 60 % harvester; +1 Heart each per stroke, at most 10 a day. */
  teamworkHarvest: { planterBp: 4000, heartsPerStroke: 1, heartsPerDay: 10, m: 'M1a' },
  /** #6 Together Combo: both players' productive actions within 3 s on objects within 8 tiles: +10 % XP each (at
   * most 300 such actions a day), the combo meter fills; no "got there first" toast while a combo is active. */
  combo: {
    windowMs: sec(3), radius: 8, xpBonusBp: 1000, maxPerDay: 300, m: 'M1a',
    meter: [{ at: 25, items: { compost: 1 } }, { at: 50, collectionRoll: true }, { at: 100, items: { compost: 3 },
      hearts: 1 }],
  },
  /** #7 duet recipes: both press "Cook together" within 3 s: normal time, +25 % XP, +1 Heart each, a Memory Book
   * offer. Alone the same recipe slow-cooks in 2 x time with normal XP. */
  duet: { windowMs: sec(3), xpBonusBp: 2500, soloTimeBp: 20_000, hearts: 1, m: 'M1a' },
  /** #8 giant crops (L20, M1b): a 3x3 block of one crop, all composted, planted within 1 minute: 20 % chance. */
  giant: { from: 20, block: 3, plantWindowMs: min(1), chanceBp: 2000, yieldMul: 2, hp: 60, fairPoints: 25, m: 'M1b' },
  /** #9 Golden Hour (L4): once per together session (>= 8 h after the last), both avatars seated on a two-seat
   * bench for 10 s: for 30 minutes everything STARTED takes 10 % less time; +1 Heart each, a Memory Book page. */
  goldenHour: { unlock: 4, seatMs: sec(10), durationMs: min(30), bp: 1000, sessionGapMs: h(8), hearts: 1, m: 'M1a' },
  /** #10 high-five: both press it within 1.5 s with avatars within 2 tiles: a Spark, +10 % personal XP for 10 min
   * to both; 30-min cooldown; +1 Heart each for the first 3 a day. */
  highFive: { windowMs: 1500, radius: 2, sparkMs: min(10), xpBonusBp: 1000, cooldownMs: min(30), heartsFirst: 3,
    m: 'M1a' },
  /** #11 keepsake gift: once a day per giver, a bouquet from a flower crop or a farm-produced good; leaves the Barn,
   * goes to the partner's keepsake shelf, +1 Heart each. No coins. */
  keepsake: { perDay: 1, hearts: 1, m: 'M1a' },
  /** #12 partner bottle (M2): anyone's bottle -30 % of the remaining baby time; the OTHER player's -20 % more,
   * once per baby per hour. */
  partnerBottle: { bp: 2000, everyMs: h(1), m: 'M2' },
  /** #13 petting together (GDD §3.4 rule 6; the drag itself is M1a): a pet lasts until the end of the real day,
   * +10 % bonus-product chance on every cycle that day, +20 % if both petted it. */
  petting: { soloBp: 1000, bothBp: 2000, m: 'M1a' },
  /** #16 barge "Equal Partners" (M2): when both players loaded at least one crate of a completed row, that row's
   * share of the Captain's chest gets `decorRolls` more decor roll(s). */
  equalPartners: { decorRolls: 1, m: 'M2' },
  /** #17-#19 unlock tours, welcome back, story beats: per-player seen flags. */
  tours: { maxPerTour: 3, m: 'M1a' },
  /** Thanks on activity-feed lines: +1 Heart to the actor, at most 10 received a day (§9 #21). */
  thanks: { hearts: 1, maxReceivedPerDay: 10, m: 'M1a' },
};

/** §6.3 conflict and anti-frustration rules. */
export const SAFETY = {
  /** BIG_SPEND (soft confirm + a toast for the partner): a purchase above 25 % of the spendable treasury AND above
   * 1,000 coins, or >= 10 Acorns in one purchase, or >= 10 Acorns by one player in one day (Hurry counts). */
  bigSpend: { shareBp: 2500, minCoins: 1000, acorns: 10, acornsPerPlayerDay: 10 },
  /** 10-minute undo on purchases and placements of pristine objects (100 % refund), trash and move back. */
  undoMs: min(10),
  trashMs: min(10),
  moveBackMs: min(10),
  /** Wishlist (L9): coins set aside buy the item when funded; withdrawing from the partner's wish auto-releases
   * after 12 h when they are offline. */
  wishlist: { unlock: 9, autoReleaseMs: h(12), maxWishes: 6, m: 'M1a' },
  /** Keep N: a farm-wide "keep at least N" per item with a soft confirm naming who set it (Wood keeps 20). */
  keep: { max: 9999, m: 'M1a' },
  /** "Mia got there first" toasts are coalesced per 500 ms (never while a Together Combo is active). */
  lostRaceToastMs: 500,
};

/** §6.4 activity feed: bottom-left lines, the Journal history and the per-player recap draw from the same ring. */
export const FEED = {
  visibleLines: 5,
  fadeMs: sec(8),
  historyMax: 60,
  bigPurchase: 1000,
  coalesceMs: sec(2),
};
