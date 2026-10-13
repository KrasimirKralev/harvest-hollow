// What the agent may build from (contract §5.4 work/docs/catalog/*.json): the anchors and references of format 1 with
// their English and Bulgarian names, the ladders and the ids already in use on this farm. Built per job.
//   buildCatalog({ overlay, graveyard, bgNames, tracks }) -> { crops, trees, recipes, buildings, animals, decor, items,
//                                                              npcs, letterArt, music, ladders, idsInUse }
import { CONTENT, isLive, cloneTables } from '../../shared/content/index.js';
import { LADDERS, VALUE_BP, SEASONS, CROP_CLASSES, SKIES, LETTER_FROM, TUNING_BP, LIMITS } from '../../shared/mod/format.js';

const MIN = 60_000;

export function buildCatalog({ overlay = null, graveyard = {}, bgNames = {}, tracks = [] } = {}) {
  const T = cloneTables();
  const live = (fam) => (T[fam] ?? []).filter((d) => isLive(d));
  const bg = (id) => bgNames[id]?.name ?? null;
  const nm = (d) => ({ en: d.name, bg: bg(d.id) });
  const items = new Map(T.items.map((i) => [i.id, i]));
  const recipeBuildings = new Set(live('recipes').map((r) => r.building));
  const modName = (d) => ({ en: d.name, bg: overlay?.names?.bg?.[d.id]?.name ?? null });
  const mine = (fam) => (overlay?.defs?.[fam] ?? []).map((d) => ({ id: d.id, name: modName(d), mod: true, unlock: d.unlock }));
  return {
    crops: [...live('crops').map((c) => ({ id: c.id, name: nm(c), unlock: c.unlock, growMin: Math.round(c.growMs / MIN),
      yield: c.yield, season: c.season, classes: c.classes, hue: c.hue, archetype: c.archetype, sell: c.sell })), ...mine('crops')],
    trees: [...live('trees').filter((t) => t.tool === 'basket' && !t.relic && !t.rainbow && t.shop).map((t) => ({ id: t.id,
      name: nm(t), unlock: t.unlock, cycleHours: Math.round(t.cycleMs / 3_600_000), fruit: t.product, hue: t.hue, leaf: t.leaf })), ...mine('trees')],
    recipes: [...live('recipes').map((r) => ({ id: r.id, name: nm(r), building: r.building, unlock: r.unlock,
      minutes: Math.round(r.ms / MIN), inputs: r.inputs, sell: r.sell })), ...mine('recipes')],
    buildings: live('buildings').filter((b) => recipeBuildings.has(b.id)).map((b) => ({ id: b.id, name: nm(b), unlock: b.unlock })),
    animals: [...live('animals').filter((a) => a.shop === true && a.baby > 0 && a.id !== 'bee').map((a) => ({ id: a.id,
      name: nm(a), unlock: a.unlock, homes: a.homes, product: a.product })), ...mine('animals')],
    decor: [...live('decor').filter((d) => d.tier === 'coin' && d.shop === true).map((d) => ({ id: d.id, name: nm(d),
      unlock: d.unlock, cost: d.cost, costRange: [Math.ceil(d.cost / 20) * 10, d.cost * 2] })), ...mine('decor')],
    items: [...live('items').filter((i) => i.sellable && !['premium', 'feed', 'consumable'].includes(i.kind) && !i.relic)
      .map((i) => ({ id: i.id, name: nm(i), unlock: i.unlock, sell: i.sell, kind: i.kind })),
    ...(overlay?.defs?.items ?? []).map((i) => ({ id: i.id, name: modName(i), unlock: i.unlock, sell: i.sell, kind: i.kind, mod: true }))],
    npcs: [...CONTENT.npcs.values()].filter((n) => LETTER_FROM.includes(n.id)).map((n) => ({ id: n.id, name: nm(n), role: n.role })),
    letterArt: [...(T.rules.LETTER_ART ?? [])],
    music: tracks.map((t) => ({ id: t.id, moods: t.moods ?? [], title: t.title ?? null })),
    ladders: { cropMin: LADDERS.cropMin, recipeMin: LADDERS.recipeMin, treeHours: LADDERS.treeHours, value: Object.keys(VALUE_BP),
      seasons: SEASONS, classes: CROP_CLASSES, skies: SKIES, tuningBp: TUNING_BP, limits: LIMITS, items: items.size },
    idsInUse: Object.entries(graveyard).map(([id, g]) => ({ id, family: g.family,
      retired: !Object.values(overlay?.defs ?? {}).some((l) => l.some((d) => d.id === id)) })),
  };
}
