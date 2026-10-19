// Version of the rules' OUTCOMES (review-m0 #10). Bump it in the same change as any rule whose result for
// the same (state, args, ctx) changes. It is hashed into CONTENT_HASH, so open tabs reload instead of predicting
// with old rules, and every journal line records the hash it was accepted under (server/engine.js), so a crash
// followed by a rules change cannot replay old lines with new rules silently. No imports: content/index.js
// imports this file, and the rules import content.
export const RULES_VERSION = 15;                  // 5: wave-2 QA rules-content fixes (RC-01 ... RC-20)
                                                 // 6: owner rule 2026-10-04: a level-up finishes everything growing
                                                 // 7: wave 3 (M2): the M2 economy and goals rules
                                                 // 8: owner rule 2026-10-04: the landmarks move (Barn, farmhouse ...)
                                                 // 9: final release: breeding / fishing use receipts, season coats
                                                 //    kept, Hurry feed rows coalesce, the Bloom and the Nursery
                                                 // 10: wave 4 (owners' wish list): decor sells (gifts too, tray
                                                 //    copies), upgrades, Fertilizer, weeds, pet breeds, looks,
                                                 //    paid respec and perk refunds
                                                 // 11: wave 4b (owners' wish list of 2026-10-05): balloon crates, the
                                                 //    Acorn shop's relics, homes that grow, tree ages (+ fruit), queue
                                                 //    reorder and per-item finish
                                                 // 12: multi-farm keys: `_key` (a new key for a farmer, and their
                                                 //    way back with it; one feed line each)
                                                 // 13: wave 5 (owners' wish list): babies in the pen (`pair`,
                                                 //    `_pen`), the dog stays home (`petStay`), fewer bigger land
                                                 //    parcels (`_land` migration, plot cap in old-parcel units)
                                                 // 14: release 1.0 (features lane): surprise gifts on the porch
                                                 //    (`keepsake` + note -> a gift box, `openGift`, `_gift`,
                                                 //    farm.gifts, no Hearts), the Together chain counts the same farm
                                                 //    day (farm.coop.days), farm.coop.born, Ribbon Track from L16
                                                 // 15: release 1.0 (owner request 2026-10-19): the balloon crates'
                                                 //    rare power-ups (farm.powerups; a crate a farmer opens may hold
                                                 //    one: Rainbow Watering Can, Lucky Ladybugs, Busy-Bee Swarm,
                                                 //    Mabel's Golden Ticket, Shooting Star)
