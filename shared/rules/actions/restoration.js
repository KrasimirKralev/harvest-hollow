// The Restoration Ledger (GDD §5.9, L16; projects 1-3 in M1b): six projects in order, each with four bundles; a
// bundle is "any `need` of its slots" so no single item can block it. Either partner gives goods (or coins, for a
// coin slot) piece by piece; the Stone Bridge's Fair-prize slots fill from blue-ribbon goods the farm produces while
// the project is open. The whole farm gets the permanent reward. Owned by rules-economy.
//
//   donate {project, bundle, slot, qty}   give up to `qty` of the slot's item (or coins) to the OPEN project: as much
//                                          as the slot still needs and the Barn (treasury) holds. Goods under Keep N
//                                          need no confirm (a bundle is not a sale, §6.3); coins follow BIG_SPEND.
//   restoreFlag {project, bundle, slot}   toggle "Need help" on a slot (GDD §6.2 #3, feature `bundle_flags`, L23): the
//                                          caller's own flag; when the OTHER player's donation fills that slot (and
//                                          they gave more than half of it, RC-13) both get
//                                          a Heart and Helping Hands counts it (progress.js, `donated.helped`).
//
// State `farm.restore[projectId]` = { s: { bundleId: { slot: { n, by: { pid: n } } } }, b: { bundleId: at }, done?,
//   f?: { bundleId: { slot: pid } } } (f = the "Need help" flags; a flag leaves when its slot or bundle is full).
// When a bundle completes, its partly filled slots are given back (goods to the Barn, coins to the treasury), so a
// "4 of 5" choice never wastes what was put into the fifth. When every bundle is complete the project is done:
//   Old Greenhouse  a Greenhouse frame in the build tray (12 plots beyond the plot cap, always in season)
//   Mill Wheel      Feed Mill and Windmill recipes -20 % time (economy.recipeCutBp)
//   Stone Bridge    the Hollow Meadow: more land (grid.landRects), +6 plot cap, wildflowers as bee forage x3
//   Orchard Pond    irrigation: every tree cycle started from now -10 % (economy.treeCutBp; M2)
//   Town Fair Grounds  Fair Platinum, the top league, +1 entry per item a week (rules-goals reads projectDone; M2)
//   Grandma's Farmhouse  the farmhouse room opens (actions/interior.js) and every Farm Kitchen gets +1 slot (her
//                   duet table, crafting.grantRewardSlots); Grandma's visit is rules-goals' story (M2)
import { CONTENT, eHours, isLive, live, levelFromXp, featureOf } from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V, confirmed } from '../schema.js';
import { available, consume, intake, spend, refund, isBigSpend, projectDone, stash } from '../economy.js';
import { openInterior } from './interior.js';
import { grantRewardSlots } from './crafting.js';

/** The project open for donations now: the first live project not done, if its level is reached (else null). */
export function openProject(state) {
  const level = levelFromXp(state.farm.xp);
  for (const p of [...live('restoration')].sort((a, b) => a.n - b.n)) {
    if (projectDone(state, p.id)) continue;
    return level >= p.unlock ? p : null;
  }
  return null;
}

/** What one slot asks for: { kind: 'item' | 'coins' | 'special', item?, special?, need }. */
export function slotNeed(project, slot) {
  if (slot.item) return { kind: 'item', item: slot.item, need: slot.qty };
  if (slot.special) return { kind: 'special', special: slot.special, need: slot.qty };
  return { kind: 'coins', need: eHours(project.unlock, slot.coinsHoursBp) };
}

const recOf = (state, pid) => (Object.hasOwn(state.farm.restore, pid) ? state.farm.restore[pid] : null);

/** Units (coins) given to a slot so far. */
export function slotHave(state, projectId, bundleId, i) {
  const r = recOf(state, projectId);
  return r?.s?.[bundleId]?.[String(i)]?.n ?? 0;
}

/** True when bundle `bundleId` of a project is complete. */
export const bundleDone = (state, projectId, bundleId) => Boolean(recOf(state, projectId)?.b?.[bundleId] !== undefined);

/** Slots of a bundle that are full now. */
function fullSlots(state, project, bundle) {
  let n = 0;
  bundle.slots.forEach((slot, i) => {
    if (slotHave(state, project.id, bundle.id, i) >= slotNeed(project, slot).need) n++;
  });
  return n;
}

/**
 * The whole ledger for a panel (pure): every live project in order with its bundles, slots (need, have, who gave
 * what), whether it is open, done or still locked, and the reward. `level` = the level it opens at.
 */
export function ledgerOf(state) {
  const open = openProject(state);
  return [...live('restoration')].sort((a, b) => a.n - b.n).map((p) => ({
    id: p.id, name: p.name, n: p.n, level: p.unlock, text: p.text, reward: p.reward,
    status: projectDone(state, p.id) ? 'done' : open && open.id === p.id ? 'open' : 'locked',
    bundles: p.bundles.map((b) => ({
      id: b.id, name: b.name, need: b.need, done: bundleDone(state, p.id, b.id),
      slots: b.slots.map((slot, i) => ({ ...slotNeed(p, slot), have: slotHave(state, p.id, b.id, i),
        by: { ...(recOf(state, p.id)?.s?.[b.id]?.[String(i)]?.by ?? {}) },
        flag: flagOf(state, { project: p.id, bundle: b.id, slot: i }) })),
    })),
  }));
}

/** Make sure `farm.restore[projectId]` and its bundle map exist (one op each, only when missing). */
function ensure(tx, projectId, bundleId) {
  if (!recOf(tx.state, projectId)) tx.set(['farm', 'restore', projectId], { s: {}, b: {} });
  if (!tx.state.farm.restore[projectId].s[bundleId]) tx.set(['farm', 'restore', projectId, 's', bundleId], {});
}

/** Add `n` to a slot for `by` (n > 0). */
function addToSlot(tx, projectId, bundleId, i, n, by) {
  ensure(tx, projectId, bundleId);
  const cur = tx.state.farm.restore[projectId].s[bundleId][String(i)];
  const who = { ...(cur?.by ?? {}) };
  who[by] = (who[by] ?? 0) + n;
  tx.set(['farm', 'restore', projectId, 's', bundleId, String(i)], { n: (cur?.n ?? 0) + n, by: who });
}

/**
 * After a slot changed: complete the bundle when `need` slots are full (partial slots of it go back), and the
 * project when every bundle is complete (its reward applies). Emits bundleDone / projectDone.
 */
function settle(tx, ctx, project, bundle) {
  if (bundleDone(tx.state, project.id, bundle.id) || fullSlots(tx.state, project, bundle) < bundle.need) return;
  const back = [];
  bundle.slots.forEach((slot, i) => {
    const have = slotHave(tx.state, project.id, bundle.id, i);
    const s = slotNeed(project, slot);
    if (have === 0 || have >= s.need || s.kind === 'special') return;
    // partly given: return it all, so a "4 of 5" bundle never eats what went into the fifth slot
    if (s.kind === 'item') { intake(tx, s.item, have); back.push({ item: s.item, qty: have }); }
    else { refund(tx, ctx, have, `restore:${project.id}`); back.push({ coins: have }); }
    tx.del(['farm', 'restore', project.id, 's', bundle.id, String(i)]);
  });
  tx.set(['farm', 'restore', project.id, 'b', bundle.id], ctx.now);
  if (tx.state.farm.restore[project.id].f?.[bundle.id]) tx.del(['farm', 'restore', project.id, 'f', bundle.id]);
  tx.emit({ e: 'bundleDone', project: project.id, bundle: bundle.id, by: ctx.pid, back });
  if (project.bundles.every((b) => bundleDone(tx.state, project.id, b.id))) {
    tx.set(['farm', 'restore', project.id, 'done'], ctx.now);
    if (project.reward?.greenhouse) {
      const gh = greenhouseDef();
      if (gh) stash(tx, gh.id, 1);
    }
    // Grandma's Farmhouse (M2): the room opens with its fixed pieces; her duet table adds a Farm Kitchen slot
    if (project.reward?.interior) openInterior(tx, ctx);
    if (project.reward?.kitchenSlots) grantRewardSlots(tx, 'kitchen');
    tx.emit({ e: 'projectDone', project: project.id, by: ctx.pid, reward: project.text ?? '' });
  }
}

/** The bundle and slot an args object names in the open project, or { code }. */
function target(state, a) {
  const p = openProject(state);
  if (!p || p.id !== a.project) {
    return { code: projectDone(state, a.project) ? ERR.ALREADY_DONE : ERR.LOCKED };
  }
  const b = p.bundles.find((x) => x.id === a.bundle);
  const slot = b && b.slots[a.slot];
  if (!slot) return { code: ERR.BAD_ARGS };
  if (bundleDone(state, p.id, b.id)) return { code: ERR.ALREADY_DONE };
  const need = slotNeed(p, slot);
  if (need.kind === 'special') return { code: ERR.BAD_ARGS };           // filled by blue-ribbon harvests, not given
  const left = need.need - slotHave(state, p.id, b.id, a.slot);
  if (left <= 0) return { code: ERR.ALREADY_DONE };
  return { p, b, need, left };
}

/** How much `donate` gives now: min(asked, left, held); 0 = nothing to give. */
function amountOf(state, t, a) {
  const held = t.need.kind === 'item' ? available(state, t.need.item) : state.farm.wallet.coins;
  return Math.max(0, Math.min(a.qty, t.left, held));
}

export const donate = {
  schema: { project: V.content('restoration'), bundle: V.text(32), slot: V.int(0, 15), qty: V.int(1, 1_000_000_000) },
  check(state, a, ctx) {
    const t = target(state, a);
    if (t.code) return t.code;
    const n = amountOf(state, t, a);
    if (n <= 0) return t.need.kind === 'item' ? ERR.NO_ITEMS : ERR.NO_COINS;
    if (t.need.kind === 'coins' && isBigSpend(state, ctx.pid, ctx.now, n, 0) && !confirmed(a, ERR.BIG_SPEND)) {
      return ERR.BIG_SPEND;
    }
    return null;
  },
  apply(tx, a, ctx) {
    const t = target(tx.state, a);
    const n = amountOf(tx.state, t, a);
    if (t.need.kind === 'item') consume(tx, t.need.item, n);
    else {
      const big = isBigSpend(tx.state, ctx.pid, ctx.now, n, 0);
      spend(tx, ctx, n, `restore:${t.p.id}`);
      if (big) tx.emit({ e: 'bigSpend', by: ctx.pid, coins: n, acorns: 0, what: t.p.id });
    }
    addToSlot(tx, t.p.id, t.b.id, a.slot, n, ctx.pid);
    const ev = { e: 'donated', project: t.p.id, bundle: t.b.id, slot: a.slot, by: ctx.pid, qty: n };
    if (t.need.kind === 'item') ev.item = t.need.item; else ev.coins = n;
    if (n >= t.left) {
      // the slot is full: its flag comes down, and a partner's flag filled by me is a help (Hearts, Helping Hands)
      // only when I gave MORE than half of the slot in all: one token unit after a flag is no help, not even the
      // second of a two-unit slot (wave-2 QA RC-13; a slot fills once, so unflag / reflag can never repeat it)
      const flag = flagOf(tx.state, a);
      if (flag) {
        clearFlag(tx, a);
        const mine = tx.state.farm.restore[t.p.id].s[t.b.id][String(a.slot)].by[ctx.pid] ?? 0;
        if (flag !== ctx.pid && mine * 2 > t.need.need) ev.helped = flag;
      }
    }
    tx.emit(ev);
    settle(tx, ctx, t.p, t.b);
  },
};

/** The pid that flagged a slot "Need help", or null. */
export function flagOf(state, a) {
  const f = recOf(state, a.project)?.f?.[a.bundle]?.[String(a.slot)];
  return typeof f === 'string' ? f : null;
}

function clearFlag(tx, a) {
  const f = tx.state.farm.restore[a.project].f;
  const left = Object.keys(f[a.bundle]).filter((k) => k !== String(a.slot));
  if (left.length) tx.del(['farm', 'restore', a.project, 'f', a.bundle, String(a.slot)]);
  else if (Object.keys(f).length > 1) tx.del(['farm', 'restore', a.project, 'f', a.bundle]);
  else tx.del(['farm', 'restore', a.project, 'f']);
}

/** True when this farm may flag bundle slots (feature `bundle_flags`: its milestone and level). */
export function bundleFlagsOpen(state) {
  const feat = featureOf('bundle_flags');
  return Boolean(feat) && isLive(feat) && levelFromXp(state.farm.xp) >= feat.unlock;
}

export const restoreFlag = {
  schema: { project: V.content('restoration'), bundle: V.text(32), slot: V.int(0, 15) },
  check(state, a, ctx) {
    if (!bundleFlagsOpen(state)) return ERR.LOCKED;
    const t = target(state, a);
    if (t.code) return t.code;
    const flag = flagOf(state, a);
    return flag && flag !== ctx.pid ? ERR.OCCUPIED : null;
  },
  apply(tx, a, ctx) {
    const mine = flagOf(tx.state, a) === ctx.pid;
    if (mine) clearFlag(tx, a);
    else {
      const r = tx.state.farm.restore[a.project];
      if (!r) tx.set(['farm', 'restore', a.project], { s: {}, b: {} });
      if (!tx.state.farm.restore[a.project].f) tx.set(['farm', 'restore', a.project, 'f'], {});
      if (!tx.state.farm.restore[a.project].f[a.bundle]) tx.set(['farm', 'restore', a.project, 'f', a.bundle], {});
      tx.set(['farm', 'restore', a.project, 'f', a.bundle, String(a.slot)], ctx.pid);
    }
    tx.emit({ e: 'restoreFlagged', project: a.project, bundle: a.bundle, slot: a.slot, flag: mine ? null : ctx.pid,
      by: ctx.pid });
  },
};

/**
 * Count a produced blue-ribbon good toward the open project's Fair-prize slots (`special` = 'prized_crop' |
 * 'prized_animal_good' | 'prized_fruit'), credited to the actor. The first open slot of an incomplete bundle that
 * asks for it gets min(n, what it still needs). Called inside the producing action's transaction.
 */
export function restoreDeed(tx, ctx, special, n) {
  if (!tx.state.farm.restore || !(n > 0)) return;
  const p = openProject(tx.state);
  if (!p) return;
  for (const b of p.bundles) {
    if (bundleDone(tx.state, p.id, b.id)) continue;
    for (let i = 0; i < b.slots.length; i++) {
      const s = slotNeed(p, b.slots[i]);
      if (s.kind !== 'special' || s.special !== special) continue;
      const left = s.need - slotHave(tx.state, p.id, b.id, i);
      if (left <= 0) continue;
      const k = Math.min(n, left);
      addToSlot(tx, p.id, b.id, i, k, ctx.pid);
      tx.emit({ e: 'donated', project: p.id, bundle: b.id, slot: i, by: ctx.pid, qty: k, deed: true });
      settle(tx, ctx, p, b);
      return;
    }
  }
}

/** The Old Greenhouse frame: the live landmark def that carries `greenhouse` (content), or null. */
export const greenhouseDef = () => [...CONTENT.landmarks.values()].find((d) => d.greenhouse && isLive(d)) ?? null;
