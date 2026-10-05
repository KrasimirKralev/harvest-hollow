// Mabel's Order Board (GDD §5.2, §4.3, §9 #11-14). Hand-authored rule numbers; the generator in
// shared/rules (rules-goals) reads them. Percentages and fractions are basis points (1 = 0.01 %); "E-hours" are
// fractions of E(level) in basis points of an hour (10_000 = one hour of income), turned into coins by eHours().
import { min, h } from './units.js';

export const ORDERS = {
  unlock: 2,
  m: 'M1a',
  /** Board slots by farm level: [fromLevel, slots] (3 at L2 ... 9 at L35). */
  slots: [[2, 3], [5, 4], [9, 5], [14, 6], [20, 7], [28, 8], [35, 9]],
  /** A filled or discarded slot refills after this long; orders never expire (§9 #11). */
  refillMs: min(15),
  /** One free instant refill per farm per day; more cost Acorns (§5.2). */
  freeRefillsPerDay: 1,
  refillAcorns: 1,
  /** Pay = payBp/10000 x sum of V; coins share r chosen per order, XP = the rest / 8 (§5.2). */
  payBp: 15_000,
  coinShareBp: [5000, 6500, 8000, 9500],
  xpDiv: 8,
  /** Budget = E(L) x f, f uniform in [lo, hi] (basis points of an hour) per level band [fromLevel, lo, hi]. */
  // from L15 the weekly systems share the evening: a smaller order budget (wave-2 QA D2, measured on the real rules);
  // from L27 smaller still (final pass, 2026-10-04): the late board held 60-93-unit crop lines beside T4 goods and
  // jammed, and the real rules filled more, smaller orders: +10-20 % XP an evening at L30-39, both-idle 1-3 min lower
  budget: [[1, 600, 1500], [6, 1000, 2500], [15, 900, 2000], [27, 600, 1200]],
  /** k = 1 + floor(rand x min(maxTypes, 1 + floor(L / typesEvery))) item types per order (final pass: at most 3, the
   * 4th type from L36 made the late orders the ones nobody could fill). */
  maxTypes: 3,
  typesEvery: 12,
  /** Pool: orderable items with unlock <= L - poolLag whose full chain is producible now (G-VALID). */
  poolLag: 1,
  /** An item appears in at most this many open orders (townsfolk requests included, §9 #14). */
  maxOpenPerItem: 2,
  /** Items whose capacity cap makes them worth less than this share of their budget share are left out. */
  minCapShareBp: 2500,
  /**
   * Pick weight (§5.2) = 1 / (1 + times requested in the last `recentWindow` orders) x inStock (when >= 1 is in the
   * Barn) x crafted (crafted goods from level `craftedFrom`) x neverDelivered ("Mabel likes to try new things").
   */
  weights: { recentWindow: 5, inStockBp: 30_000, craftedBp: 13_000, craftedFrom: 8, neverDeliveredBp: 40_000 },
  /** Never two items in one order that share a direct input (the Hay Day boat rule). */
  noSharedInputs: true,
  /** Quantity caps: crops plotCap / 5 x yield; fruit mature trees x yield; animals adults x max(1, floor(90 / cycle
   * minutes)); crafted out x max(1, floor(45 / minutes)); one order holds at most 90 machine-minutes. */
  caps: { plotShareDiv: 5, animalMinutes: 90, craftMinutes: 45, orderMachineMinutes: 90 },
  /**
   * The first evenings (wave-1 QA RC-08): up to `level`, session crops (grow <= cropMin minutes) skip the value
   * filter and, while no open order asks for a crop, the next order is a crop order, so the board always holds one
   * normal crop order (qty = a third of the field at most); animal lines ask for ONE cycle of the adults owned.
   */
  early: { level: 4, cropMin: 30 },
  /**
   * The quick slot (wave-1 QA RC-19, GDD §5.2): board slot 0 at every level draws its budget from the first band
   * and holds at most `machineMinutes` of crafting, so one order is always a short, fillable income tap.
   * wave-2 RC-01: it refills on its own timer, `refillMs` (the other slots keep ORDERS.refillMs), and asks only for
   * goods the farm can have ready within `readyMinutes` (crops of at most that grow time, animal goods of at most
   * `readyMinutes` + 5 minute cycles or in stock, crafts of at most `machineMinutes`), so a couple waiting on a
   * corn field always has a small order to fill in the meantime.
   */
  quick: { slot: 0, machineMinutes: 20, refillMs: min(5), readyMinutes: 15 },
  /** T4 (premium crafted) goods appear in orders from this level; duet goods only in golden orders. */
  t4From: 22,
  /**
   * Safety net (§5.2): if no open order can be filled from stock, from crops <= sessionCropMin, or from one
   * <= 60-min building run with inputs in stock, the next order is "simple": one good in stock or one crop of at
   * most simpleCropMin, qty <= what is there / plotCap / 2. A simple order counts 1/4 toward order counts (R15).
   */
  safety: { sessionCropMin: 60, buildingRunMin: 60, simpleCropMin: 30, simpleWeightBp: 2500 },
  /** Golden orders: the first order generated after each 6-hour boundary of the farm's day (00, 06, 12, 18). */
  golden: { everyMs: h(6), acorns: 1, friendship: 1, duetFrom: 10, duetEvery: 3, duetPayBp: 20_000 },
  /** Gourmet orders (L37): one slot may hold a single T4 good at 1.7 x V. */
  gourmet: { from: 37, payBp: 17_000, m: 'M2' },
  /**
   * Mabel's weekly meter (L5): counts the VALUE of filled orders (sum of 1.5 V; simple orders 1/4) Monday to
   * Sunday, in E-hours of Monday's E. Chests at 0.75 / 1.5 / 2.5 E-hours pay E x 0.25 / 0.4 / 0.6 h in coins plus
   * 1 / 2 / 3 Acorns; the first also 5 Compost (from L8, when Compost exists).
   */
  meter: {
    unlock: 5,
    chests: [
      { atBp: 7500, coinsBp: 2500, acorns: 1, items: { compost: 5 } },
      { atBp: 15_000, coinsBp: 4000, acorns: 2, items: {} },
      { atBp: 25_000, coinsBp: 6000, acorns: 3, items: {} },
    ],
  },
  /** The scripted first order of the tutorial (GDD §7.4: "Mabel's first order, scripted: 8 Wheat"). */
  first: { items: { wheat: 8 }, coinShareBp: 8000, giver: 'mabel' },
  /** "Need help" flags and "I'm on it" pins (GDD §6.2 mechanic 3): see COOP.helpFlags. */
  pins: true,
};
