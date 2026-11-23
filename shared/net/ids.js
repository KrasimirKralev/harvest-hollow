// Ids (FROZEN CONTRACT, tech-architecture §2.8). Object ids are derived from the action envelope, so the
// client and the server compute the same id for an object the client just created, before any answer.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A random client id (6 base-36 chars) per page load. The caller injects the randomness:
 * browser `(n) => crypto.getRandomValues(new Uint8Array(n))` (NOT crypto.randomUUID: the partner's
 * http://192.168.x.y page is not a secure context), Node `crypto.randomBytes`.
 * Never 'sys' (reserved for system actions): it is 3 chars and cids are 6.
 * @param {(n: number) => Uint8Array} randomBytes
 */
export function makeCid(randomBytes) {
  // Rejection sampling: bytes >= 252 (= 7 x 36) are skipped, so every character is equally likely
  // (`byte % 36` alone draws 0-3 8/7 as often; review-m0 #18).
  let s = '';
  while (s.length < 6) {
    const b = randomBytes(16);
    for (let i = 0; i < b.length && s.length < 6; i++) if (b[i] < 252) s += ALPHABET[b[i] % 36];
  }
  return s;
}

/** Id of the i-th object created by action (cid, seq). */
export function newId(cid, seq, i) {
  return `${cid}.${seq.toString(36)}.${i}`;
}
