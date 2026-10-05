// The Market Stand, the General Store, storage and refunds (GDD §3.6, §4.3 "Selling and buying", §4.10, §9).
// Hand-authored rule numbers; percentages are basis points.

export const MARKET = {
  /** Market Demand of the day (L11): one raw and one crafted item (both unlocked for at least 1 level, never the
   * same pair two days running) sell for +50 % for the first 50 units a day (60 with the Old Coins set). */
  demand: { unlock: 11, m: 'M1a', bonusBp: 5000, unitsPerDay: 50, unitsWithOldCoins: 60, minAgeLevels: 1,
    picks: ['raw', 'crafted'] },
  /** The General Store never sells anything the Market buys (R5); it sells emergency feed (items.storePrice =
   * 2.5 x V) and Golden Seeds for Acorns. While the Barn is in overflow it refuses ITEM purchases only. */
  store: { feedMulBp: 25_000, refuseItemsInOverflow: true },
  /** Selling placed objects (§4.3): animals 50 % of the price paid (100 % if blue-ribbon), decor 50 % (100 %
   * inside the undo window or if never placed), plots 50 %. Destructive sales double-confirm and go to the trash. */
  refunds: { animalBp: 5000, prizedAnimalBp: 10_000, decorBp: 5000, plotBp: 5000, undoBp: 10_000,
    /** Owner wish A (2026-10-04): paid decor (coins or Acorns: an Acorn piece returns half its Acorns) sells for
     * `decorBp` of what was paid; decor that came free (the starter fence and paths, quest and expansion gifts) sells
     * for nothing (GDD §9 #51), so selling is never a loop. */
    giftDecorBp: 0 },
  /** The 2 x capacity soft cap (§3.6): intake waits in place at `overflowMulBp` of capacity. "Sell surplus" sells
   * the `surplusStacks` lowest-value stacks above `surplusKeep` units, with a preview and the 10-minute undo. */
  barn: { start: 200, overflowMulBp: 20_000, surplusStacks: 20, surplusKeep: 10 },
};
