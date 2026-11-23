// The one-time land migration (wave 5, owner wish L2-4: "fewer, bigger expansions"). Owned by rules.
//
//   _land {}   system: a farm that owns a parcel only in part (it bought the old pieces one by one) gets the rest of
//              that parcel's pieces for free (shared/rules/land.js landPlan: land only grows, coins never move), with
//              the free objects that come with them (wild trees, decor, the wild hive) where they fit, never their
//              debris; an old piece's open land card becomes its parcel's card (start time kept, counts mapped by
//              content's proofFrom). Due at once: the server's boot catch-up runs it before any client connects.
import { ERR } from '../../net/protocol.js';
import { landPlan } from '../land.js';
import { landArrivals } from './expansions.js';

export const _land = {
  schema: {},
  check(state) { return landPlan(state) ? null : ERR.NOT_READY; },
  apply(tx, a, ctx) {
    const p = landPlan(tx.state);
    tx.set(['farm', 'expansions'], p.to);
    for (const id of p.drop) tx.del(['farm', 'proofs', id]);
    for (const id of Object.keys(p.cards).sort()) tx.set(['farm', 'proofs', id], p.cards[id]);
    const objects = landArrivals(tx, ctx, p.added, { debris: false });
    tx.emit({ e: 'landRedrawn', from: p.from, to: p.to, added: p.added, objects, by: ctx.pid });
  },
};
