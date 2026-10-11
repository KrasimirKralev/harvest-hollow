// The owners' wish list of 2026-10-06 (wave 5), the rule numbers content owns (the new crops, spices, quail, bison and
// recipes live in the generated tables; the land parcels in parcels.js):
//   PEN_BABIES   two adults of one species in one home pair up (❤ on the home card) and a baby arrives in that pen
// Integer data only (basis points, ms). No imports beyond units.js.
import { min } from './units.js';

/**
 * Babies in the pen (owner wish list 1 #1, chosen over sending the couple to the Breeding Barn, which stays for the
 * rare golden coats at L28). From `unlock`, a home that holds two ADULTS of one species shows a ❤ button: pairing
 * them costs `qty` of the species' own baby food (`cost: 'bottle'` = `animalOf(species).bottle`: a Baby Bottle;
 * Chicken Feed for chicks, ducklings and quail chicks; Rabbit Greens for kits), cheap on purpose so it is fun. After
 * `max(minMs, babyMs x timeBp / 10000)` (about the species' own baby time) a BABY of that species appears in the same
 * home, named like any animal and grown like any baby. It needs a free place: a full home grows a room step as in
 * wave 4b (its price folded, the usual HOME_GROWTH steps), and a home that cannot grow keeps the pair waiting. One
 * pairing per home at a time (`perHome`), so the home's room and its growth price are what balance it (econ-sim
 * models it from `unlock`). `species` lists who can: every animal with babies (bee colonies come with their hive).
 */
export const PEN_BABIES = {
  unlock: 8,
  m: 'M1a',
  cost: 'bottle',
  qty: 1,
  timeBp: 10_000,
  minMs: min(30),
  perHome: 1,
  heart: '❤',
  species: ['chicken', 'cow', 'sheep', 'rabbit', 'quail', 'pig', 'bison', 'duck', 'goat', 'horse', 'alpaca'],
};
