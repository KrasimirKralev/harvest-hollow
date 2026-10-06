// Wave-4 flows the HUD starts (loaded on first use, so the boot stays as light as before): selling a placed or stored
// decor piece with its quote, a confirm and a 10-minute Undo (wish A), and turning a placed object where it stands when
// the controller has no rotate of its own (wish C). ui lane.
//
//   sellPlaced(S, id) / sellStored(S, def) -> Promise<result | null>    S = { store, controller, ui }
//   rotatePlaced(S, id) -> result | null
//   undoSale(S, trashId) -> result | null
import { defOf, SAFETY } from '../../../../shared/content/index.js';
import * as DE from '../../../../shared/rules/actions/decor.js';
import { footprint } from '../../../../shared/rules/grid.js';
import { probe, passes, simulate } from './core.js';
import { fmt } from '../dom.js';
import { actFor } from './w4-rules.js';
import { sellPlacedQuote, sellStoredQuote, newestTrash } from './w4-model.js';
import { t, tn, N, lang, list } from '../../i18n/index.js';

const UNDO_MIN = Math.round((SAFETY?.trashMs ?? 600_000) / 60_000);

/** "60 coins", "3 Acorns", "60 coins and 3 Acorns", "nothing". */
export function moneyText(q) {
  const parts = [];
  if (lang() !== 'en') {
    if (q?.coins > 0) parts.push(tn('common.coins', q.coins));
    if (q?.acorns > 0) parts.push(tn('common.acorns', q.acorns));
    return parts.length ? list(parts) : t('farm.sell.nothing');
  }
  if (q?.coins > 0) parts.push(`${fmt(q.coins)} coin${q.coins === 1 ? '' : 's'}`);
  if (q?.acorns > 0) parts.push(`${fmt(q.acorns)} Acorn${q.acorns === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' and ') : 'nothing';
}

/** What an action pays, from the rules' own run (simulate: run and roll back at once): the coins / Acorns its events
 * carry. The fallback quote when a rules helper is missing. */
export function simulatedGain(store, type, args) {
  const r = simulate(store, type, args);
  if (!r.ok) return null;
  let coins = 0;
  let acorns = 0;
  for (const e of r.events) {
    if (e.e === 'removed' || e.e === 'soldStored' || e.e === 'sold') { coins += Math.max(0, e.coins | 0); acorns += Math.max(0, e.acorns | 0); }
  }
  return { coins, acorns };
}

/** The "sold" toast with its Undo (the rules' `restore` takes it out of the 10-minute trash). */
function soldToast(S, text, icon, trashId) {
  const can = trashId && S.store.state?.farm?.trash?.[trashId];
  S.ui.toast(text, { kind: 'ok', icon, ms: 7000,
    action: can ? { label: t('market.barn.undo'), fn: () => undoSale(S, trashId) } : undefined });
}

export function undoSale(S, trashId) {
  const r = S.controller.do(actFor('restore'), { id: trashId });
  if (r?.ok) S.ui.toast(t('farm.sell.back'), { kind: 'ok' });
  return r;
}

/** Sell a placed decor piece: the quote, "are you sure?", the sale, then "Sold · Undo". */
export async function sellPlaced(S, id) {
  const st = S.store.state;
  const o = st?.farm?.objects?.[id];
  const def = o && defOf(o.def);
  if (!def) return null;
  const type = actFor('sellPlaced');
  const code = probe(S.store, type, { id });
  if (!passes(code)) { S.controller.do(type, { id }); return null; }       // the controller explains the refusal
  const q = sellPlacedQuote(st, id, S.store.now()) ?? { ...(simulatedGain(S.store, type, { id }) ?? { coins: 0, acorns: 0 }), undo: false };
  const item = N(o.def);
  const money = moneyText(q);
  const ok = await S.ui.confirm({
    title: fitTitle(t('farm.sell.title', { item }), t('farm.sell.titleShort')),
    lead: q.undo ? t('farm.sell.leadUndo', { item, money }) : q.coins || q.acorns
      ? t('farm.sell.lead', { item, money }) : t('farm.sell.gift', { item }),
    icon: o.def, cost: q.coins || q.acorns ? { coins: q.coins, acorns: q.acorns } : null,
    body: q.undo ? t('farm.sell.bodyUndo') : q.coins || q.acorns ? t('farm.sell.body') : t('farm.sell.bodyGift'),
    fine: q.undo ? null : t('farm.sell.fine', { n: UNDO_MIN }),
    ok: t('farm.sell.ok'), okKind: 'sun', cancel: t('farm.sell.keep'),
  });
  if (!ok) return null;
  const r = S.controller.do(type, { id });
  if (r?.ok) soldToast(S, q.coins || q.acorns ? t('farm.sell.sold', { item, money }) : t('farm.sell.gone', { item }), o.def, q.undo ? null : id);
  return r;
}

/**
 * A dialog title that fits: a phone's title ribbon holds about 16 letters ("Sell the Garden Lant…" was cut), so a long
 * one there says `short` and the lead names the piece.
 */
function fitTitle(long, short) {
  const narrow = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-width: 520px)').matches;
  return narrow && long.length > 16 ? short : long;
}

/** Sell one stored copy of `def` from the build tray. */
export async function sellStored(S, defId, { quiet = false } = {}) {
  const st = S.store.state;
  const def = defOf(defId);
  if (!def) return null;
  const type = actFor('sellStored');
  const code = probe(S.store, type, { def: defId });
  if (!passes(code)) { S.controller.do(type, { def: defId }); return null; }
  const q = sellStoredQuote(st, defId) ?? simulatedGain(S.store, type, { def: defId }) ?? { coins: 0, acorns: 0 };
  if (!quiet) {
    const ok = await S.ui.confirm({
      title: fitTitle(t('farm.sell.titleOne', { item: N(defId) }), t('farm.sell.titleOneShort')),
      lead: q.coins || q.acorns ? t('farm.sell.leadOne', { item: N(defId), money: moneyText(q) }) : t('farm.sell.gift', { item: N(defId) }),
      icon: defId, cost: q.coins || q.acorns ? q : null,
      body: q.coins || q.acorns ? t('farm.sell.body') : t('farm.sell.bodyTray'),
      fine: t('farm.sell.fineTray', { n: UNDO_MIN }), ok: t('farm.sell.ok'), okKind: 'sun', cancel: t('farm.sell.keep'),
    });
    if (!ok) return null;
  }
  const r = S.controller.do(type, { def: defId });
  if (r?.ok) soldToast(S, q.coins || q.acorns ? t('farm.sell.soldOne', { item: N(defId), money: moneyText(q) }) : t('farm.sell.goneTray', { item: N(defId) }), defId,
    newestTrash(S.store.state, S.store.pid, defId));
  return r;
}

/**
 * The next quarter turn of a placed object that fits, about its centre (the rules' rotateSpot when the build has it):
 * candidate spots in order, the first whose `move` check passes. Pure apart from `probeFn`.
 */
export function turnSpots(o, def) {
  const rot = o.rot ?? 0;
  const [w, d] = footprint(def, rot);
  const out = [];
  for (const k of [1, 2, 3]) {
    const r = (rot + k) % 4;
    const [w2, d2] = footprint(def, r);
    const cx = o.x + (w - w2) / 2;
    const cz = o.z + (d - d2) / 2;
    const xs = [...new Set([Math.floor(cx), Math.ceil(cx), o.x])];
    const zs = [...new Set([Math.floor(cz), Math.ceil(cz), o.z])];
    for (const x of xs) for (const z of zs) out.push({ x, z, rot: r });
  }
  return out;
}

export function rotatePlaced(S, id) {
  const st = S.store.state;
  const o = st?.farm?.objects?.[id];
  const def = o && defOf(o.def);
  if (!def || !Number.isFinite(o.x)) return null;
  let spot = null;
  if (typeof DE.rotateSpot === 'function') {
    const r = DE.rotateSpot(st, id, 1);
    if (r && !r.code) spot = { x: r.x, z: r.z, rot: r.rot };
  }
  if (!spot) spot = turnSpots(o, def).find((c) => passes(probe(S.store, 'move', { id, ...c }))) ?? null;
  if (!spot) { S.ui.toast(t('farm.sell.noTurn', { item: N(o.def) }), { kind: 'info', icon: o.def }); return null; }
  return S.controller.do('move', { id, ...spot });
}
