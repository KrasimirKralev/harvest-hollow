// Order-independent iteration over state maps (review-m0 #7). Object key order is NOT replicated: a rollback
// or a client rewind re-adds a deleted key at the end, while journal replay never sees the rejected action.
// Any rule whose outcome depends on which key comes first ("cheapest member first", "first ready building",
// "the 20 lowest stacks") must iterate in a canonical order. test/invariants.test.js runs every action on a
// state and on the same state with every map's keys reversed, and the results must be equal.

/** Own keys of a plain object, sorted by code unit (canonical, locale-free). */
export const sortedKeys = (o) => Object.keys(o).sort();

/** [key, value] pairs of a plain object in sortedKeys() order. */
export const sortedEntries = (o) => sortedKeys(o).map((k) => [k, o[k]]);

/**
 * Comparator: by `score(value)` ascending, ties broken by key. Use with sortedEntries():
 * entries.sort(byThenKey(([, v]) => v.price)).
 * @param {(entry: [string, any]) => number} score
 */
export const byThenKey = (score) => (a, b) => (score(a) - score(b)) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * `n` split over the keys of `weights` (positive integers) in proportion, largest remainder, ties and order by pid:
 * deterministic, sums to exactly `n`.
 */
export function shareOut(n, weights) {
  const ids = Object.keys(weights).filter((k) => weights[k] > 0).sort();
  const total = ids.reduce((t, k) => t + weights[k], 0);
  const out = {};
  if (total <= 0) return out;
  let left = n;
  const rest = ids.map((k) => {
    out[k] = Math.floor((n * weights[k]) / total);
    left -= out[k];
    return [k, (n * weights[k]) % total];
  }).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  for (let i = 0; left > 0; i = (i + 1) % rest.length, left--) out[rest[i][0]] += 1;
  return out;
}
