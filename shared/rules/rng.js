// Stateless hash RNG (FROZEN CONTRACT, tech-architecture §2.9). A roll is a pure function of
// (farmSeed, ...keys), so the client's prediction equals the server's result, journal replay needs no RNG
// state, and reconnecting cannot re-roll (keys include a per-object cycle counter).
// Math.random is banned in shared/ (test/purity.test.js greps for it).
//
// KEY RULE (review-m0 #2): keys come ONLY from replicated state that the server orders: an object's `cycle`,
// a farm counter (`farm.rolls.<name>`, bumped in the same tx), `farm.pity`, ids of objects that already exist.
// Never ctx.newId(i), ctx.cid, ctx.seq, ctx.now or an action argument: the client chooses cid and seq, and the
// farm seed is replicated, so a roll keyed on them can be computed offline and forced. makeCtx().rng refuses
// the string keys it can recognise (cid, and ids this action creates).
//
// The hash values are pinned by a golden test (test/rules.rng.test.js): changing them re-rolls every farm.

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function mixInt(h, k) {                       // murmur3 32-bit block mix
  k = Math.imul(k, C1);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, C2);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function fmix(h) {                            // murmur3 finalizer: full avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function mixKey(h, key) {
  if (typeof key === 'number') {
    if (!Number.isSafeInteger(key)) throw new Error(`rng: keys must be safe integers or strings, got ${key}`);
    // A type tag first: a string's length tag has bit 30 set and is at most 0x40000000 + 2^30, so a number
    // can never hash like a string (review-m0 #15). Then both 32-bit halves, so large values do not collide.
    h = mixInt(h, 0x20000000);
    h = mixInt(h, key | 0);
    return mixInt(h, Math.floor(key / 4294967296) | 0);
  }
  if (typeof key === 'string') {
    h = mixInt(h, key.length | 0x40000000);   // length tag: ('ab','c') != ('a','bc')
    for (let i = 0; i < key.length; i++) h = mixInt(h, key.charCodeAt(i));
    return h;
  }
  throw new Error(`rng: bad key type ${typeof key}`);
}

/**
 * 32-bit unsigned hash of an ordered list of integer/string keys.
 * @param {...(number|string)} keys
 * @returns {number} in [0, 2^32)
 */
export function hash32(...keys) {
  let h = 0x9747b28c;
  for (const k of keys) h = mixKey(h, k);
  return fmix(h ^ keys.length);
}

/** Uniform float in [0, 1) for (seed, ...keys). */
export function roll(seed, ...keys) {
  return hash32(seed, ...keys) / 4294967296;
}

/** Integer in [lo, hi] (inclusive) for (seed, ...keys). */
export function rollInt(seed, lo, hi, ...keys) {
  return lo + Math.floor(roll(seed, ...keys) * (hi - lo + 1));
}

/** Pick one element of a non-empty array. */
export function pick(seed, list, ...keys) {
  return list[Math.floor(roll(seed, ...keys) * list.length)];
}
