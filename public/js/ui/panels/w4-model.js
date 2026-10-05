// The wave-4 panels' readers (ui lane), loaded with the panels that need them (upgrades, selling decor, "Your look"), so
// the boot carries only w4-rules.js. Pure and DOM-free (tests drive them with a plain state).
//
//   upgradeInfo(state, id) / upgradeList(state) / upgradeReady(state) / bonusLines(bonus)     wish E
//   sellPlacedQuote(state, id, now) / sellStoredQuote(state, def) / storedDecor(state) / newestTrash(state, by, def)  wish A
//   LOOKS / lookOf(state, pid) / lookPatch(look)                                               wish 9
import * as C from '../../../../shared/content/index.js';
import * as DE from '../../../../shared/rules/actions/decor.js';
import { defOf } from '../../../../shared/content/index.js';
import { UPGRADE_TABLE, UPGRADE_TARGETS, upgradeTargetOf, tierOf, levelOf, prettyId } from './w4-rules.js';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isSafeInteger(v) ? v : d);
const fn = (mod, name) => (typeof mod?.[name] === 'function' ? mod[name] : null);
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);

// ---- E: upgrades ----------------------------------------------------------------------------------------------------

const MIN = 60_000;
const pct = (bp) => {
  const v = bp / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} %`;
};

/** One short line per bonus key ("+40 Barn space", "Watering saves 5 % more time"). Pure. */
export function bonusLines(bonus) {
  if (!isObj(bonus)) return [];
  const out = [];
  const b = (k) => int(bonus[k]);
  if (b('barnCap') > 0) out.push({ key: 'barnCap', glyph: 'barn', text: `+${b('barnCap')} Barn space` });
  if (b('restedBp') > 0) out.push({ key: 'restedBp', glyph: 'sun', text: `Rested XP builds ${pct(b('restedBp'))} faster` });
  if (b('waterBp') > 0) out.push({ key: 'waterBp', glyph: 'sprout', text: `Watering saves ${pct(b('waterBp'))} more time` });
  if (b('demandUnits') > 0) out.push({ key: 'demandUnits', glyph: 'market', text: `+${b('demandUnits')} Market Demand a day` });
  if (b('sellBp') > 0) out.push({ key: 'sellBp', glyph: 'coin', text: `Sales pay ${pct(b('sellBp'))} more` });
  if (b('goldenMs') > 0) out.push({ key: 'goldenMs', glyph: 'heart', text: `Golden Hour lasts ${Math.round(b('goldenMs') / MIN)} min longer here` });
  return out;
}

/** The objects of a target on the farm, sorted by id (never key order). */
function objectsOfTarget(state, target) {
  const defs = new Set(UPGRADE_TABLE[target]?.defs ?? [target]);
  const out = [];
  for (const id of Object.keys(state.farm.objects).sort()) {
    const o = state.farm.objects[id];
    if (o && defs.has(o.def) && Number.isFinite(o.x)) out.push(id);
  }
  return out;
}

/**
 * Everything the upgrade card of object `id` draws (pure): its target, tiers (owned / next / later, each with its
 * level, coins, Acorns, items, bonus lines and text), the bonus now and next. Null when `id` cannot be upgraded.
 */
export function upgradeInfo(state, id) {
  const o = own(state?.farm?.objects, id);
  if (!isObj(o)) return null;
  const target = upgradeTargetOf(o.def);
  const table = target ? UPGRADE_TABLE[target] : null;
  if (!table || !Array.isArray(table.tiers) || !table.tiers.length) return null;
  const level = levelOf(state);
  const tier = tierOf(o);
  const tiers = table.tiers.map((t, i) => {
    const n = i + 1;
    const items = Object.entries(isObj(t.items) ? t.items : {}).filter(([, q]) => int(q) > 0)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([item, q]) => ({ item, n: q, have: availableOf(state, item) }));
    return {
      n, name: t.name ?? `Tier ${n}`, unlock: int(t.unlock, 1), coins: int(t.coins), acorns: int(t.acorns), items,
      bonus: isObj(t.bonus) ? { ...t.bonus } : {}, lines: bonusLines(t.bonus), text: typeof t.text === 'string' ? t.text : '',
      owned: n <= tier, next: n === tier + 1, open: level >= int(t.unlock, 1),
    };
  });
  const now = tier ? tiers[tier - 1] : null;
  const next = tiers[tier] ?? null;
  const def = defOf(o.def);
  return {
    id, def: o.def, defName: def?.name ?? o.def, target, name: table.name ?? def?.name ?? target, tier, max: tiers.length,
    tiers, now, next, perObject: target === 'bench', level,
  };
}

/** Every upgradable thing on the farm, in panel order: the farm-wide targets once (their first copy), every bench. */
export function upgradeList(state) {
  const out = [];
  for (const t of UPGRADE_TARGETS) {
    const ids = objectsOfTarget(state, t);
    const pickIds = t === 'bench' ? ids : ids.slice(0, 1);
    for (const id of pickIds) { const v = upgradeInfo(state, id); if (v) out.push(v); }
  }
  return out;
}

/** The cheapest next tier the farm could buy now (open, not owned): the tracker's and the badge's hint. */
export function upgradeReady(state) {
  const coins = state.farm.wallet?.coins ?? 0;
  let best = null;
  for (const v of upgradeList(state)) {
    const nx = v.next;
    if (!nx || !nx.open || nx.coins > coins || nx.items.some((x) => x.have < x.n)) continue;
    if (!best || nx.coins < best.next.coins) best = v;
  }
  return best;
}

const availableOf = (state, item) => int(own(state.farm.inventory, item)) + int(own(state.farm.overflow, item));

// ---- A: selling decor -----------------------------------------------------------------------------------------------

/** Coins / Acorns selling placed object `id` returns now (the rules' resaleOf), or null when it does not sell. */
export function sellPlacedQuote(state, id, now) {
  const o = own(state?.farm?.objects, id);
  if (!isObj(o)) return null;
  const f = fn(DE, 'resaleOf');
  const r = f ? f(o, now) : null;
  if (!r) return null;
  return { coins: int(r.coins), acorns: int(r.acorns), undo: Boolean(r.undo) };
}

/** Coins / Acorns one stored copy of `def` sells for (rules' sellStoredValue), or null when unknown. */
export function sellStoredQuote(state, def) {
  const f = fn(DE, 'sellStoredValue');
  if (!f) return null;
  try {
    const r = f(state, def);
    if (Number.isSafeInteger(r)) return { coins: r, acorns: 0 };
    return isObj(r) ? { coins: int(r.coins), acorns: int(r.acorns) } : null;
  } catch { return null; }
}

/** The decor waiting in the build tray: [{ def, name, n }] by name. */
export function storedDecor(state) {
  const s = state?.farm?.storage ?? {};
  return Object.keys(s).filter((d) => int(s[d]) > 0 && defOf(d)?.kind === 'decor')
    .map((d) => ({ def: d, name: defOf(d).name ?? d, n: s[d] }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** True when a placed object is decor the rules would consider selling at all (the hint shows "Sell"). */
export function sellableDecor(state, id) {
  const o = own(state?.farm?.objects, id);
  const def = o && defOf(o.def);
  return Boolean(def && def.kind === 'decor' && o.mw === undefined);
}

/** The trash row (10-minute undo) a sale just made, newest first: the id the Undo button restores. */
export function newestTrash(state, by, def) {
  const t = state?.farm?.trash ?? {};
  let best = null;
  for (const id of Object.keys(t).sort()) {
    const r = t[id];
    if (!isObj(r) || r.by !== by) continue;
    const d = r.obj?.def ?? r.tray ?? null;
    if (def && d !== def) continue;
    if (!best || int(r.until) > int(best.r.until)) best = { id, r };
  }
  return best ? best.id : null;
}

// ---- 9: the farmer's look -------------------------------------------------------------------------------------------

const opt = (list, names = {}) => list.map((x) => (typeof x === 'string' ? { id: x, name: names[x] ?? prettyId(x) } : { ...x, name: x.name ?? names[x.id] ?? prettyId(x.id) }));
const HEX = /^#[0-9a-f]{6}$/i;
/** Colour swatches as { id: '#RRGGBB', name } (content gives { id, name, hex }; plain '#rrggbb' strings work too). */
const colours = (list) => list.map((x) => {
  const hex = typeof x === 'string' ? x : x?.hex;
  return HEX.test(hex ?? '') ? { id: hex.toUpperCase(), name: typeof x === 'string' ? hex.toUpperCase() : x.name ?? hex } : null;
}).filter(Boolean);

/** The look catalog: content's AVATAR_LOOKS (what the rules accept and the rig draws), else these. */
export const LOOKS = (() => {
  const L = isObj(C.AVATAR_LOOKS) ? C.AVATAR_LOOKS : {};
  const list = (k, d) => (Array.isArray(L[k]) && L[k].length ? L[k] : d);
  return Object.freeze({
    bodies: opt(list('bodies', ['farmer_a', 'farmer_b']), { farmer_a: 'Build A', farmer_b: 'Build B' }),
    hair: opt(list('hair', ['short', 'long', 'ponytail', 'bun', 'curly', 'braid', 'buzz'])),
    hats: opt(list('hats', ['none', 'straw_hat', 'cap', 'beanie', 'sun_bonnet', 'cowboy_hat', 'flower_crown']),
      { none: 'No hat', straw_hat: 'Straw hat', cap: 'Farm cap', sun_bonnet: 'Sun bonnet', cowboy_hat: 'Cowboy hat', flower_crown: 'Flower crown' }),
    hairColor: colours(list('hairColors', ['#2A2420', '#4A3022', '#7A4A2A', '#9A3E22', '#D9B26A', '#D9875A', '#C9C6C2', '#E58AA8'])),
    skin: colours(list('skinTones', ['#F6DCC8', '#EFC9A8', '#DDAA82', '#C08E62', '#A06D45', '#7A4E30', '#563522'])),
    top: colours(list('outfitColors', ['#2BB3A3', '#FF7A6B', '#3E6FA8', '#8DAA7A', '#E0B23A', '#7A4A7E', '#B23A2E', '#F2E6CC', '#3A3A40', '#8CC8EA'])),
    bottom: colours(list('outfitColors', ['#3E6FA8', '#2BB3A3', '#FF7A6B', '#8DAA7A', '#E0B23A', '#7A4A7E', '#B23A2E', '#F2E6CC', '#3A3A40', '#8CC8EA'])),
    defaults: isObj(L.defaults) ? L.defaults : {},
  });
})();

/** The look of a slot whose player never chose one (content's defaults: the slot's rig and colours). */
function defaultLook(pid) {
  const d = isObj(LOOKS.defaults[pid]) ? LOOKS.defaults[pid] : null;
  return {
    body: d?.body ?? (pid === 'p2' ? 'farmer_b' : 'farmer_a'), hair: d?.hair ?? (pid === 'p2' ? 'long' : 'short'),
    hairColor: d?.hairColor ?? LOOKS.hairColor[1]?.id ?? '#4A3022', skin: d?.skin ?? LOOKS.skin[1]?.id ?? '#EFC9A8',
    top: d?.top ?? LOOKS.top[0]?.id ?? '#2BB3A3', bottom: d?.bottom ?? LOOKS.bottom[0]?.id ?? '#3E6FA8', hat: d?.hat ?? 'none',
  };
}

const LOOK_KEYS = Object.freeze(['body', 'hair', 'hairColor', 'skin', 'top', 'bottom', 'hat']);
const COLOUR_KEYS = new Set(['hairColor', 'skin', 'top', 'bottom']);

/** A player's look: their saved avatar over the slot's default (colours upper-case, as the rules store them). */
export function lookOf(state, pid) {
  const p = own(state?.players, pid);
  const a = isObj(p?.avatar) ? p.avatar : {};
  const out = defaultLook(pid);
  for (const k of LOOK_KEYS) if (typeof a[k] === 'string' && a[k]) out[k] = a[k];
  for (const k of COLOUR_KEYS) if (typeof out[k] === 'string') out[k] = out[k].toUpperCase();
  return out;
}

/** The setAvatar args for a look: the seven fields, ids as they are and colours '#RRGGBB'. */
export function lookPatch(look) {
  const out = {};
  for (const k of LOOK_KEYS) {
    const v = look?.[k];
    if (typeof v !== 'string' || !v) continue;
    out[k] = COLOUR_KEYS.has(k) ? v.toUpperCase() : v;
  }
  return out;
}
