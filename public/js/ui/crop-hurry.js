// "Finish now" for growing crops (live requests 2026-10-04): the rules' own `hurry {id}` (shared/rules/actions/boosts.js:
// 1 Acorn per started hour, at most 8, from BOOSTS.hurry.unlock, BIG_SPEND like every Acorn spend) for one plot, and
// the field-level "Finish all growing <Crop>" that sends one hurry per plot. The models are PURE (tests); finishField
// is the one place that talks to the ui (the "are you sure?" card) and the controller (predicted actions).
//
//   plotHurry(state, id, now, pid) -> null | { id, crop, name, acorns, rest, code, unlock }
//        null when the plot has nothing left to grow; `code` is what the rules' check says right now (null = it
//        goes, BIG_SPEND = it goes after "are you sure?", LOCKED / NO_ACORNS = the button is off with a reason)
//   fieldHurry(state, crop, now, pid) -> { crop, name, ids, plots, acorns, code, big, short, unlock }
//        every plot of that crop still growing (a Giant's plots count once: one hurry finishes it), the Acorns
//        they cost together, and the batch's code (LOCKED, EMPTY, NO_ACORNS, BIG_SPEND or null)
//   hurryReason(code, { acorns?, short?, unlock? }) -> text   why a Finish button is off ("Need 2 more Acorns")
//   finishField(S, crop) -> Promise<{ ok, done, acorns, code? }>   ask once for the whole batch when it is big,
//        then one predicted hurry per plot (the socket paces them to the act bucket)
import { BOOSTS, SAFETY, cropOf, levelFromXp, pluralOf } from '../../../shared/content/index.js';
import { hurryTarget, hurryCost } from '../../../shared/rules/actions/boosts.js';
import { giantAnchorOf } from '../../../shared/rules/actions/giant.js';
import { isBigSpend, acornsToday } from '../../../shared/rules/economy.js';
import { sortedKeys } from '../../../shared/rules/order.js';
import { ERR } from '../../../shared/net/protocol.js';
import { probe } from './panels/core.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** What one hurry on plot `id` finishes now (a Giant's plot stands for its anchor), or null. */
function target(state, id, now) {
  const o = own(state?.farm?.objects, id);
  if (!o || o.def !== 'plot' || !o.crop) return null;
  const anchor = giantAnchorOf(state, id) ?? id;
  const t = hurryTarget(own(state.farm.objects, anchor), now);
  return t.code ? null : { anchor, rest: t.rest, crop: o.crop.def };
}

/** "Finish now" on one plot (see the header). */
export function plotHurry(state, id, now, pid) {
  const t = target(state, id, now);
  if (!t) return null;
  const code = probe({ state, pid, now: () => now }, 'hurry', { id });
  return { id, crop: t.crop, name: cropOf(t.crop)?.name ?? t.crop, acorns: hurryCost(t.rest), rest: t.rest, code,
    unlock: BOOSTS.hurry.unlock };
}

/** "Finish now" on a growing fruit tree (owner 2026-10-05): the same hurry, priced and checked by the rules. */
export function treeHurry(state, id, now, pid) {
  const o = own(state?.farm?.objects, id);
  const t = o ? hurryTarget(o, now) : null;
  if (!t || t.code || t.kind !== 'tree') return null;
  const code = probe({ state, pid, now: () => now }, 'hurry', { id });
  return { id, acorns: hurryCost(t.rest), rest: t.rest, code, unlock: BOOSTS.hurry.unlock };
}

/** "Finish all growing <Crop>" (see the header). */
export function fieldHurry(state, crop, now, pid) {
  const ids = [];
  const seen = new Set();
  let acorns = 0;
  for (const id of sortedKeys(state?.farm?.objects ?? {})) {
    const o = state.farm.objects[id];
    if (o.def !== 'plot' || !o.crop || o.crop.def !== crop) continue;
    const t = target(state, id, now);
    if (!t || seen.has(t.anchor)) continue;
    seen.add(t.anchor);
    ids.push(t.anchor);
    acorns += hurryCost(t.rest);
  }
  const wallet = state?.farm?.wallet?.acorns ?? 0;
  const level = levelFromXp(state?.farm?.xp ?? 0);
  const big = ids.length > 0 && isBigSpend(state, pid, now, 0, acorns);
  let code = null;
  if (level < BOOSTS.hurry.unlock) code = ERR.LOCKED;
  else if (!ids.length) code = ERR.EMPTY;
  else if (acorns > wallet) code = ERR.NO_ACORNS;
  else if (big) code = ERR.BIG_SPEND;
  return { crop, name: cropOf(crop)?.name ?? crop, ids, plots: ids.length, acorns, code, big,
    short: Math.max(0, acorns - wallet), unlock: BOOSTS.hurry.unlock };
}

/** Why a Finish button is off, in one short sentence ('' when it may be pressed). */
export function hurryReason(code, { acorns = 0, short, unlock = BOOSTS.hurry.unlock, wallet } = {}) {
  switch (code) {
    case null: case undefined: case ERR.BIG_SPEND: return '';
    case ERR.LOCKED: return `Finish now opens at level ${unlock}`;
    case ERR.NO_ACORNS: case ERR.NO_COINS: {
      const n = Number.isFinite(short) ? short : Math.max(1, acorns - (wallet ?? 0));
      return `Need ${fmt(n)} more Acorn${n === 1 ? '' : 's'}`;
    }
    case ERR.EMPTY: case ERR.ALREADY_DONE: return 'Nothing left growing';
    default: return "Can't right now";
  }
}

/** "6 Strawberry plots" */
export const plotsOf = (n, name) => `${fmt(n)} ${name} plot${n === 1 ? '' : 's'}`;

/** Why a batch asks first, as the Acorn heads-up of every other purchase words it (ui/dialogs.js softCopy). */
function bigBody(store, plan) {
  const B = SAFETY.bigSpend;
  const each = 'one per started hour on each plot';
  if (plan.acorns >= B.acorns) return `That is ${fmt(plan.acorns)} Acorns from the farm's shared stash: ${each}.`;
  let today = 0;
  try { today = acornsToday(store.state, store.pid, store.now()); } catch { today = 0; }
  const partner = Object.keys(store.state.players).filter((p) => p !== store.pid).map((p) => store.state.players[p].name)[0];
  return `That makes ${fmt(today + plan.acorns)} Acorns you spent today (${partner ?? 'your partner'} gets a heads-up from ${fmt(B.acornsPerPlayerDay)}): ${each}.`;
}

/**
 * Finish every growing plot of `crop`: one "are you sure?" for the whole batch when it is a big Acorn spend (the
 * rules' BIG_SPEND: >= 10 Acorns in one go, or 10 by one player in a day), then one predicted hurry per plot with
 * the confirmation the player gave. Plots planted while the card was open are not added to what was agreed.
 * @param {{ store, controller, ui }} S
 */
export async function finishField(S, crop) {
  const { store, controller, ui } = S;
  const plan = fieldHurry(store.state, crop, store.now(), store.pid);
  if (plan.code && plan.code !== ERR.BIG_SPEND) {
    ui.toast(hurryReason(plan.code, plan) || "Can't right now", { kind: 'info' });
    return { ok: false, done: 0, acorns: 0, code: plan.code };
  }
  let confirm = null;
  if (plan.big) {
    const ok = await ui.confirm({
      title: 'A big purchase', icon: crop,
      lead: `Finish ${plotsOf(plan.plots, plan.name)} now?`,
      body: bigBody(store, plan),
      cost: { acorns: plan.acorns },
      fine: 'Your partner gets a friendly heads-up.',
      ok: 'Finish them', okKind: 'sun',
    });
    if (!ok) return { ok: false, done: 0, acorns: 0, code: 'CANCELLED' };
    confirm = [ERR.BIG_SPEND];
  }
  // the card may have stood open a while: only what is still growing, and nothing the player did not agree to
  const agreed = new Set(plan.ids);
  const now = fieldHurry(store.state, crop, store.now(), store.pid);
  let done = 0;
  let acorns = 0;
  for (const id of now.ids) {
    if (!agreed.has(id)) continue;
    const before = store.state.farm.wallet.acorns;
    const r = controller.do('hurry', confirm ? { id, confirm } : { id });
    if (!r || !r.ok) break;
    done += 1;
    acorns += Math.max(0, before - store.state.farm.wallet.acorns);
  }
  if (done > 1) ui.toast(`${plotsOf(done, plan.name)} ready to harvest!`, { kind: 'ok', icon: crop });
  return { ok: done > 0, done, acorns };
}

/** "Finish all growing Strawberries (6 plots · 6 Acorns)": the button's spoken name (its face shows the acorn) */
export function fieldLabel(f) {
  return `Finish all growing ${pluralOf(f.name, 2)} (${fmt(f.plots)} plot${f.plots === 1 ? '' : 's'} · ${fmt(f.acorns)} Acorn${f.acorns === 1 ? '' : 's'})`;
}
