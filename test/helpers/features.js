// Test helpers for the features lane (release 1.0): the player actions it added, for the fuzzers
// (test/goals.fuzz.test.js picks them with the goals actions; test/invariants.test.js counts them as fuzzed).
/** Player actions added in release 1.0 (D1 Surprise gifts). */
export const REL_FUZZED = Object.freeze(['openGift']);

/** Random args for a release-1.0 action on state `s` (rnd: a seeded generator). */
export function relArgs(type, rnd, s) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  switch (type) {
    case 'openGift': return { id: pick(Object.keys(s.farm.gifts ?? {}).concat(['gift.p1.0', 'gift.p2.1'])) };
    default: throw new Error(`no args for ${type}`);
  }
}
