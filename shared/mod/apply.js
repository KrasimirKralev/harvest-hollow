// applyMod / removeMod / suspended (contract §2.3): pure functions on the TABLES shape cloneTables() returns.
//
//   applyMod(tables, overlay) -> tables'   each family = base defs with `patch` entries replacing the same id in place,
//                                          then `defs`, then `graveyard` appended; `rules` untouched. Never deletes a
//                                          base def; an id that collides with a base def not in `patch` throws.
//   removeMod(tables, overlay, base?) -> tables'   the inverse (tests, tooling): drops defs and graveyard, puts the base
//                                          entries back where a patch replaced them (base: cloneTables() by default)
//   suspended(overlay) -> overlay          everything of the mod retired (retired: true) and the tuning patches, palette,
//                                          sky, music, letters and tips dropped; the home patches stay (a retired breed
//                                          already on the farm keeps living in its home) and so do the names, models
//                                          and icons (what the farm has still reads and renders right)
import { cloneTables } from '../content/index.js';
import { overlayHash } from './hash.js';

export const OVERLAY_FAMILIES = ['crops', 'trees', 'recipes', 'animals', 'decor', 'items'];
export const PATCH_FAMILIES = ['homes', 'crops', 'trees', 'recipes', 'animals'];

export function applyMod(tables, overlay) {
  if (!overlay) return tables;
  const out = { ...tables };
  const fams = new Set([...OVERLAY_FAMILIES, ...PATCH_FAMILIES]);
  for (const fam of fams) {
    const base = tables[fam] ?? [];
    const patches = new Map((overlay.patch?.[fam] ?? []).map((d) => [d.id, d]));
    const list = base.map((d) => (patches.has(d.id) ? patches.get(d.id) : d));
    const have = new Set(base.map((d) => d.id));
    for (const id of patches.keys()) if (!have.has(id)) throw new Error(`applyMod: patch of unknown ${fam}.${id}`);
    for (const d of [...(overlay.defs?.[fam] ?? []), ...(overlay.graveyard?.[fam] ?? [])]) {
      if (have.has(d.id)) throw new Error(`applyMod: ${fam}.${d.id} collides with a base def`);
      have.add(d.id);
      list.push(d);
    }
    out[fam] = list;
  }
  return out;
}

export function removeMod(tables, overlay, base = cloneTables()) {
  if (!overlay) return tables;
  const out = { ...tables };
  for (const fam of new Set([...OVERLAY_FAMILIES, ...PATCH_FAMILIES])) {
    const drop = new Set([...(overlay.defs?.[fam] ?? []), ...(overlay.graveyard?.[fam] ?? [])].map((d) => d.id));
    const orig = new Map((base[fam] ?? []).map((d) => [d.id, d]));
    const patched = new Set((overlay.patch?.[fam] ?? []).map((d) => d.id));
    out[fam] = (tables[fam] ?? []).filter((d) => !drop.has(d.id)).map((d) => (patched.has(d.id) && orig.has(d.id) ? orig.get(d.id) : d));
  }
  return out;
}

export function suspended(overlay) {
  if (!overlay) return null;
  const graveyard = {};
  for (const fam of OVERLAY_FAMILIES) {
    const retire = (d) => ({ ...d, retired: true });
    graveyard[fam] = [...(overlay.graveyard?.[fam] ?? []), ...(overlay.defs?.[fam] ?? []).map(retire)]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const s = {
    ...overlay,
    suspended: true,
    defs: Object.fromEntries(OVERLAY_FAMILIES.map((f) => [f, []])),
    patch: { homes: [...(overlay.patch?.homes ?? [])], crops: [], trees: [], recipes: [], animals: [] },
    graveyard,
    look: { models: { ...(overlay.look?.models ?? {}) }, icons: { ...(overlay.look?.icons ?? {}) } },
    text: { letters: [], tips: [] },
    hash: '',
  };
  s.hash = overlayHash(s);
  return s;
}
