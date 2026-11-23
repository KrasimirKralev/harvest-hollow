// Town Projects, the Hollow Village (GDD §5.9, L20; projects 1-4 in M1b): the late-game goods and coin sink. One
// project at a time: Ollie posts it (system), the couple gives a goods bundle worth about E x 2 h (three goods the
// farm made in the last 14 days: crafted goods, animal goods or fruit, never raw crops) piece by piece and funds
// E(L) x (10 + 0.5 (n - 1)) hours of coins; once everything is in, the village builds it the next day (system),
// which pays 5 Acorns, a souvenir decor (build tray) and a Memory Book page, and adds a landmark to the village ring.
// Nothing expires and nothing is reserved: goods leave the Barn only when given (§9 #50). Owned by rules-economy.
//
//   townGive {item, qty}    give up to `qty` of one of the posted goods (what it still needs, what the Barn holds)
//   townFund {coins}        put up to `coins` toward the project's coins (BIG_SPEND rules as any spend)
//   _townPost {}            system: post project n + 1 when the farm is at the level, none is open and it made at
//                           least three eligible goods in the last 14 days; the goods are rolled on farm.rolls.town
//   _townBuild {}           system: at `buildAt`, the project is built
//
// After the 24th project the Festival Pavilion repeats (M2): id 'festival_pavilion', tier n - 24 (pavilionTier).
//
// State `farm.town` = { n: built so far, cur: null | { id, n, at, lvl, goods: [{ item, qty, got, by: { pid: n } }],
// coins, paid, by: { pid: coins }, buildAt? } }.
import {
  CONTENT, TOWN_PROJECT_RULES, FESTIVAL_PAVILION, eHours, isLive, itemOf, defOf, levelFromXp,
} from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { available, consume, spend, isBigSpend, madeSinceDay, stash } from '../economy.js';
import { dayIndex } from '../calendar.js';
import { producers, canMake, producerUnits } from '../orders-board.js';

const R = TOWN_PROJECT_RULES;
/** Item kinds a Town Project asks for (GDD §5.9: crafted goods, animal goods or fruit; never raw crops). */
export const TOWN_KINDS = Object.freeze(['craft', 'animal', 'fruit']);

/**
 * The next project to post (n = built + 1), or null when none is live. After the last authored project (the 24th) the
 * Festival Pavilion repeats at the same formula (M2): project n is Pavilion tier n - FESTIVAL_PAVILION.after, with the
 * id TOWN_PROJECT_RULES.repeatable; its souvenir comes with the first tier only.
 */
export function nextTownProject(state) {
  const n = state.farm.town.n + 1;
  for (const p of CONTENT.townProjects.values()) if (p.n === n && isLive(p)) return p;
  return pavilionTier(n);
}

/** Festival Pavilion tier of project number `n` ({ id, n, tier, name, text, souvenir }), or null. */
export function pavilionTier(n) {
  const P = FESTIVAL_PAVILION;
  if (!P || !isLive(P) || !R.repeatable || n <= P.after) return null;
  // every authored project must be built first: the pavilion follows the last one, never a gap in a later milestone
  for (const p of CONTENT.townProjects.values()) if (!isLive(p)) return null;
  const tier = n - P.after;
  const row = P.tiers[Math.min(tier, P.tiers.length) - 1];
  const name = tier <= P.tiers.length ? row.name : `${row.name}, tier ${tier}`;
  return { id: R.repeatable, n, tier, name, text: row.text, souvenir: tier === 1 ? P.souvenir : null };
}

/**
 * Goods eligible for the next project at `now`: made in the last 14 farm days (today included), of a TOWN_KINDS
 * kind, live, and makeable NOW with the whole chain (a producer owned, inputs makeable: wave-2 QA RC-02, so a good
 * whose producer was sold is never asked for) (sorted ids).
 */
export function townCandidates(state, now) {
  const days = Math.floor(R.madeWithinMs / 86_400_000);
  const P = producers(state, now);
  const memo = new Map();
  return madeSinceDay(state, dayIndex(now, state.meta.tz) - days + 1).filter((id) => {
    const it = itemOf(id);
    return it && isLive(it) && TOWN_KINDS.includes(it.kind) && it.sellable !== false && canMake(state, P, id, memo);
  });
}

/** null when `_townPost` has work now, else why not. */
export function townPostCode(state, now) {
  if (!isLive(R) || levelFromXp(state.farm.xp) < R.unlock) return ERR.LOCKED;
  if (state.farm.town.cur !== null) return ERR.ALREADY_DONE;
  if (!nextTownProject(state)) return ERR.LOCKED;
  return townCandidates(state, now).length >= R.goods ? null : ERR.NOT_READY;
}

/** Coins the n-th project asks at level `lvl`: E(lvl) x (10 + 0.5 (n - 1)) hours. */
export const townCoins = (n, lvl) => eHours(lvl, R.coinsHoursBaseBp + R.coinsHoursStepBp * (n - 1));

/** Units of an item worth `value` coins (at least 1, rounded to the nearest unit). */
const unitsFor = (value, sell) => Math.max(1, Math.floor((value + Math.floor(sell / 2)) / sell));

export const _townPost = {
  schema: {},
  check(state, a, ctx) {
    return townPostCode(state, ctx.now);
  },
  apply(tx, a, ctx) {
    const p = nextTownProject(tx.state);
    const lvl = levelFromXp(tx.state.farm.xp);
    const pool = townCandidates(tx.state, ctx.now);
    const r = tx.state.farm.rolls.town ?? 0;
    tx.inc(['farm', 'rolls', 'town'], 1);                        // the roll key: a replicated counter (review-m0 #2)
    const per = Math.floor(eHours(lvl, R.goodsHoursBp) / R.goods);
    const P = producers(tx.state, ctx.now);
    const goods = [];
    for (let k = 0; k < R.goods; k++) {
      const i = Math.floor(ctx.rng('town', r, k) * pool.length);
      const item = pool.splice(i, 1)[0];
      // worth about a third of E x 2 h, but never more than R.producerCapMs of the producers the farm owns (RC-02:
      // 798 Milk was 798 producer-hours); snapshot at posting, at least 1
      // a duet good needs both farmers at the oven together: one is a project's share, never four (final release PC-05)
      const duet = CONTENT.recipes.get(item)?.duet === true;
      const qty = duet ? 1 : Math.max(1, Math.min(unitsFor(per, itemOf(item).sell), producerUnits(P, item, R.producerCapMs)));
      goods.push({ item, qty, got: 0, by: {} });
    }
    const coins = townCoins(p.n, lvl);
    tx.set(['farm', 'town', 'cur'], { id: p.id, n: p.n, at: ctx.now, lvl, goods, coins, paid: 0, by: {} });
    tx.emit({ e: 'townPosted', project: p.id, n: p.n, goods: goods.map((g) => ({ item: g.item, qty: g.qty })), coins });
  },
};

/** True when every good and every coin of the open project is in. */
const complete = (cur) => cur.paid >= cur.coins && cur.goods.every((g) => g.got >= g.qty);

/** Open the build once the last piece is in (`buildAt` = now + one day). */
function maybeReady(tx, ctx) {
  const cur = tx.get(['farm', 'town', 'cur']);
  if (cur.buildAt !== undefined || !complete(cur)) return;
  const buildAt = ctx.now + R.buildMs;
  tx.set(['farm', 'town', 'cur', 'buildAt'], buildAt);
  tx.emit({ e: 'townReady', project: cur.id, buildAt });
}

/** The open project still taking gifts, or { code }. */
function openCur(state) {
  const cur = state.farm.town.cur;
  if (!cur) return { code: isLive(R) && levelFromXp(state.farm.xp) >= R.unlock ? ERR.NOT_FOUND : ERR.LOCKED };
  if (cur.buildAt !== undefined) return { code: ERR.ALREADY_DONE };
  return { cur };
}

function giveAmount(state, cur, a) {
  const i = cur.goods.findIndex((g) => g.item === a.item);
  if (i < 0) return { code: ERR.BAD_ARGS };
  const left = cur.goods[i].qty - cur.goods[i].got;
  if (left <= 0) return { code: ERR.ALREADY_DONE };
  const n = Math.min(a.qty, left, available(state, a.item));
  return n > 0 ? { i, n } : { code: ERR.NO_ITEMS };
}

export const townGive = {
  schema: { item: V.content('items'), qty: V.int(1, 1_000_000) },
  check(state, a) {
    const o = openCur(state);
    return o.code ?? giveAmount(state, o.cur, a).code ?? null;
  },
  apply(tx, a, ctx) {
    const cur = tx.get(['farm', 'town', 'cur']);
    const { i, n } = giveAmount(tx.state, cur, a);
    consume(tx, a.item, n);
    const goods = cur.goods.map((g, k) => (k !== i ? g
      : { ...g, got: g.got + n, by: { ...g.by, [ctx.pid]: (g.by[ctx.pid] ?? 0) + n } }));
    tx.set(['farm', 'town', 'cur', 'goods'], goods);
    tx.emit({ e: 'townGiven', project: cur.id, item: a.item, qty: n, by: ctx.pid });
    maybeReady(tx, ctx);
  },
};

const fundAmount = (state, cur, a) => Math.min(a.coins, cur.coins - cur.paid, state.farm.wallet.coins);

export const townFund = {
  schema: { coins: V.int(1, 1_000_000_000_000) },
  check(state, a, ctx) {
    const o = openCur(state);
    if (o.code) return o.code;
    if (o.cur.paid >= o.cur.coins) return ERR.ALREADY_DONE;
    const n = fundAmount(state, o.cur, a);
    if (n <= 0) return ERR.NO_COINS;
    return isBigSpend(state, ctx.pid, ctx.now, n, 0) && !confirmed(a, ERR.BIG_SPEND) ? ERR.BIG_SPEND : null;
  },
  apply(tx, a, ctx) {
    const cur = tx.get(['farm', 'town', 'cur']);
    const n = fundAmount(tx.state, cur, a);
    const big = isBigSpend(tx.state, ctx.pid, ctx.now, n, 0);
    spend(tx, ctx, n, `town:${cur.id}`);
    if (big) tx.emit({ e: 'bigSpend', by: ctx.pid, coins: n, acorns: 0, what: cur.id });
    const by = { ...cur.by, [ctx.pid]: (cur.by[ctx.pid] ?? 0) + n };
    tx.set(['farm', 'town', 'cur', 'paid'], cur.paid + n);
    tx.set(['farm', 'town', 'cur', 'by'], by);
    tx.emit({ e: 'townFunded', project: cur.id, coins: n, by: ctx.pid });
    maybeReady(tx, ctx);
  },
};

/** When the open project is built (Infinity when none waits). */
export const townBuildAt = (state) => state.farm.town.cur?.buildAt ?? Infinity;

export const _townBuild = {
  schema: {},
  check(state, a, ctx) {
    return townBuildAt(state) <= ctx.now ? null : ERR.NOT_READY;
  },
  apply(tx, a, ctx) {
    const cur = tx.get(['farm', 'town', 'cur']);
    const p = CONTENT.townProjects.get(cur.id) ?? pavilionTier(cur.n);
    tx.set(['farm', 'town'], { n: cur.n, cur: null });
    tx.inc(['farm', 'wallet', 'acorns'], R.acorns);
    const souvenir = p && p.souvenir && defOf(p.souvenir) && isLive(defOf(p.souvenir)) ? p.souvenir : null;
    if (souvenir) stash(tx, souvenir, 1);
    const ev = { e: 'townBuilt', id: cur.id, project: cur.id, n: cur.n, souvenir, acorns: R.acorns, by: ctx.pid };
    if (p && p.tier) ev.tier = p.tier;
    tx.emit(ev);
  },
};
