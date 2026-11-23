// Mnki and Swan, always together (from MNKISWAN Cozy World, where Swan walks beside Mnki everywhere): the two canon
// looks, which of the two a farmer is, and who walks beside them. Pure, shared by the renderer and the panels.
//
//   MNKI_LOOK / SWAN_LOOK          the canon looks (content AVATAR_LOOKS.defaults p1 / p2)
//   pairOf(look) -> 'mnki' | 'swan'   which of the two a look is (the hood, else the headband, else the build)
//   otherOf(who) -> 'swan' | 'mnki'
//   PAIR_LOOK[who], PAIR_NAME[who]
import { AVATAR_LOOKS } from '../../../shared/content/index.js';

const D = AVATAR_LOOKS?.defaults ?? {};
export const MNKI_LOOK = Object.freeze({ ...(D.p1 ?? { body: 'farmer_a', hat: 'monkey_band' }) });
export const SWAN_LOOK = Object.freeze({ ...(D.p2 ?? { body: 'farmer_b', hat: 'swan_hood' }) });
export const PAIR_LOOK = Object.freeze({ mnki: MNKI_LOOK, swan: SWAN_LOOK });
export const PAIR_NAME = Object.freeze({ mnki: 'Mnki', swan: 'Swan' });

/** Which of the two a look is: Swan's hood or Mnki's headband decide, else the build (farmer_b is Swan's). Pure. */
export function pairOf(look) {
  if (look && look.hat === 'swan_hood') return 'swan';
  if (look && look.hat === 'monkey_band') return 'mnki';
  return look && look.body === 'farmer_b' ? 'swan' : 'mnki';
}
export const otherOf = (who) => (who === 'swan' ? 'mnki' : 'swan');

/** A player's look as stored, else their slot's canon look (p1 Mnki, p2 Swan). Pure. */
export function lookOfSlot(player, pid) {
  const a = player && player.avatar;
  if (a && typeof a === 'object' && Object.keys(a).length) return a;
  return pid === 'p2' ? SWAN_LOOK : MNKI_LOOK;
}
