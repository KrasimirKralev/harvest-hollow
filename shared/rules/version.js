// Version of the rules' OUTCOMES (review-m0 #10). Bump it in the same change as any rule whose result for
// the same (state, args, ctx) changes. It is hashed into CONTENT_HASH, so open tabs reload instead of predicting
// with old rules, and every journal line records the hash it was accepted under (server/engine.js), so a crash
// followed by a rules change cannot replay old lines with new rules silently. No imports: content/index.js
// imports this file, and the rules import content.
export const RULES_VERSION = 11;                  // 5: wave-2 QA rules-content fixes (RC-01 ... RC-20)
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
