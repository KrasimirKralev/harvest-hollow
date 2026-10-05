// The ui lane's ONE door to the wave-4 rules (the owners' wish list, 2026-10-04): selling decor (A), upgrades for the
// farmhouse, the Well, the Market Stand and the benches (E), perk confirm / Acorn respec / refund (G), pet breeds (6),
// the farmer's look (9) and Fertilizer (2). DOM-free and pure, so node tests drive it with a plain state. The boot loads
// this file (the pets and perks panels use it); the bigger readers of the new panels are in w4-model.js, loaded with them.
//
// The rules and content lanes built these at the same time as the panels: every action is sent under the first name of
// a candidate list the build registers (core.pick), every rules helper and content table is read through a namespace
// import (a helper or table that is not there yet reads as a default or "not in this build", never a broken page), and
// every button asks the action's own `check` first (kit.button -> core.probe). Rules lane contract:
// docs/agent-notes/w4-rules.md.
//
//   ACT / actFor(key) / canAct(key) / takesArg(key, arg)   the action names (rules: upgradeObject, sellStored,
//                                              perkRefund, petBreed, setAvatar, fertilize; existing: sellObject, restore,
//                                              perkRespec, adoptPet)
//   UPGRADE_TABLE / UPGRADE_TARGETS / upgradeTargetOf(defId) / tierOf(obj)
//   perkPrices() -> { respecAcorns(), refundAcorns(state, pid, tree) }
//   breedsOf(kind) / breedOf(pet) / breedName(kind, breed) / BREED_LOOK
import { pick } from './core.js';
import { ACTIONS } from '../../../../shared/rules/index.js';
import * as C from '../../../../shared/content/index.js';
import * as UP from '../../../../shared/rules/upgrades.js';
import * as PK from '../../../../shared/rules/actions/perks.js';
import * as PE from '../../../../shared/rules/actions/pets.js';
import { levelFromXp } from '../../../../shared/content/index.js';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isSafeInteger(v) ? v : d);
const fn = (mod, name) => (typeof mod?.[name] === 'function' ? mod[name] : null);

// ---- actions --------------------------------------------------------------------------------------------------------

/** The action names the panels send (the first one the build registers wins). */
export const ACT = Object.freeze({
  sellPlaced: ['sellObject', 'sellDecor'],
  sellStored: ['sellStored', 'sellStoredDecor', 'sellDecorStored'],
  restore: ['restore'],
  upgrade: ['upgradeObject', 'upgradeLandmark', 'upgrade'],
  perkPick: ['perkPick'],
  perkRespec: ['perkRespec'],
  perkRefund: ['perkRefund', 'perkUnlearn'],
  adoptPet: ['adoptPet'],
  petBreed: ['petBreed', 'setPetBreed', 'changePetBreed'],
  setAvatar: ['setAvatar', 'setLook', 'customize'],
  fertilize: ['fertilize'],
  move: ['move'],
});

/** The registered type for a key of ACT, else its first name (its probe answers "Not open yet"). */
export const actFor = (key) => pick(...ACT[key]) ?? ACT[key][0];
/** True when the build registers an action for this key. */
export const canAct = (key) => pick(...ACT[key]) !== null;
/** True when the registered action of `key` takes argument `arg` (a field older rules did not know: adoptPet's breed). */
export const takesArg = (key, arg) => {
  const t = pick(...ACT[key]);
  return Boolean(t && ACTIONS[t]?.schema && Object.hasOwn(ACTIONS[t].schema, arg));
};

export const levelOf = (state) => levelFromXp(state?.farm?.xp ?? 0);

// ---- E: upgrades ----------------------------------------------------------------------------------------------------

/** The upgrade table in play (rules' UPGRADES: content's targets over the rules' defaults), or {}. */
export const UPGRADE_TABLE = isObj(UP.UPGRADES) ? UP.UPGRADES : {};
/** Targets in the order the panel shows them: the farmhouse first, the bench last. */
const TARGET_ORDER = ['farmhouse', 'market_stand', 'well', 'bench'];
export const UPGRADE_TARGETS = Object.freeze([...Object.keys(UPGRADE_TABLE)].sort((a, b) => {
  const ia = TARGET_ORDER.indexOf(a);
  const ib = TARGET_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0);
}));

/** The upgrade target of a def id ('farmhouse' | 'well' | 'market_stand' | 'bench'), or null. */
export function upgradeTargetOf(defId) {
  const f = fn(UP, 'upgradeTargetOf');
  if (f) return f(defId) ?? null;
  for (const t of UPGRADE_TARGETS) if ((UPGRADE_TABLE[t].defs ?? [t]).includes(defId)) return t;
  return null;
}

/** Tiers bought for an object (rules: `obj.up`). */
export const tierOf = (o) => (fn(UP, 'tierOf') ? UP.tierOf(o) : (isObj(o) && Number.isSafeInteger(o.up) && o.up > 0 ? o.up : 0));

// ---- G: perks -------------------------------------------------------------------------------------------------------

/** Acorns a paid respec and a single-perk refund cost (the rules' numbers: RESPEC_ACORNS, refundOf; content's else). */
export function perkPrices() {
  const P = C.PERKS ?? {};
  return {
    respecAcorns: () => (Number.isSafeInteger(PK.RESPEC_ACORNS) ? PK.RESPEC_ACORNS : int(P.respecAcorns, 8)),
    refundAcorns: (state, pid, tree) => {
      if (fn(PK, 'refundOf')) return int(PK.refundOf(state, pid, tree)?.acorns);
      const n = int(PK.perksIn?.(state, pid, tree));
      return n > 0 ? int(P.refundAcornsPerPoint, 2) * int(P.costs?.[n - 1], 1) : 0;
    },
  };
}

// ---- 6: pet breeds --------------------------------------------------------------------------------------------------

/** The rules' default breeds (docs/agent-notes/w4-rules.md), used when content publishes none. */
export const DEFAULT_BREEDS = Object.freeze({
  dog: Object.freeze([{ id: 'shiba', name: 'Shiba Inu' }, { id: 'husky', name: 'Husky' }, { id: 'shepherd', name: 'German Shepherd' }]),
  cat: Object.freeze([{ id: 'orange', name: 'Orange Tabby' }, { id: 'black', name: 'Black Cat' }, { id: 'white', name: 'White Cat' }]),
});

export const prettyId = (id) => String(id ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The breeds of a pet kind: [{ id, name }] (rules' helper, content's list, the defaults). */
export function breedsOf(kind) {
  const f = fn(PE, 'petBreeds') ?? fn(PE, 'breedsOf');
  let list = f ? f(kind) : null;
  if (!Array.isArray(list) || !list.length) list = C.PETS?.kinds?.find((k) => k.id === kind)?.breeds ?? C.PETS?.breeds?.[kind];
  if (!Array.isArray(list) || !list.length) list = DEFAULT_BREEDS[kind] ?? [];
  return list.map((b) => (typeof b === 'string' ? { id: b, name: prettyId(b) } : { id: b.id, name: b.name ?? prettyId(b.id), ...b }));
}

/** A pet's breed id (absent = its kind's first breed). */
export const breedOf = (pet) => (pet && typeof pet.breed === 'string' && pet.breed ? pet.breed : breedsOf(pet?.kind)[0]?.id ?? null);

/** "Husky", "Orange Tabby". */
export const breedName = (kind, breed) => breedsOf(kind).find((b) => b.id === breed)?.name ?? prettyId(breed);

/** The colours of each breed's portrait (cosmetic; the panel draws a small SVG face). */
export const BREED_LOOK = Object.freeze({
  husky: { fur: '#8C939C', light: '#F4F3EF', ear: '#5E656E', eye: '#5DA9E9', nose: '#2A2526', mask: true },
  shepherd: { fur: '#C98A4B', light: '#E9C08D', ear: '#2B211C', eye: '#5A3A1E', nose: '#1F1A17', saddle: '#2B211C' },
  shiba: { fur: '#E08A3A', light: '#FBEBD3', ear: '#C46E24', eye: '#3B2618', nose: '#2A1D16', mask: true },
  orange: { fur: '#EE9A45', light: '#FCE4C4', ear: '#D07A2C', eye: '#7DB24A', nose: '#E07A7A', stripes: '#C9692A' },
  black: { fur: '#34302F', light: '#4A4442', ear: '#262221', eye: '#E8C33A', nose: '#5A4A4A' },
  white: { fur: '#F6F3EC', light: '#FFFFFF', ear: '#E9DCCF', eye: '#5DA9E9', nose: '#F0A0A8' },
});
