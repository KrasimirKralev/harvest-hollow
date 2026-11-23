// The mod compiler (contract §1.4-1.8, §2.2): turns a farm's mod files into the overlay, the ONE frozen JSON the server
// and every browser install. Stage 2 of the validation ("semantic") is this compile plus its problems; the game's own
// validateContent() then runs on applyMod(base.tables, overlay) (server/mods/validate.js).
//
//   compileMod(base, files, opts) -> { ok, overlay?, problems, warnings, numbers }
//     base   { tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION }
//     files  { path: parsedJson } (stage 1 passed)
//     opts   { n: the version this overlay becomes, prevOverlay: the farm's active overlay (its defs and graveyard are
//              every id ever applied on the farm), tracks: [music track ids] | null, bgNames: Set of base Bulgarian
//              names (lowercase) | null, groundHex: the ground colour LOW_CONTRAST compares with }
//
// Numbers never come from the agent: econ.js computes them. Every compiled def has `m` = the milestone of its unlock
// level (or later, when a building or an input is later): validateContent requires it, and every milestone up to
// MILESTONE is live. A thing applied before and missing from `files` is RETIRED (contract §1.2): its compiled def stays
// with retired: true (rules rule 8: every purchase, planting and craft of it answers LOCKED), so what the farm has keeps
// working and nothing new can be bought. `shop` keeps its compiled value (contract: shop: false) because
// validateContent ties it to the prices (docs/agent-notes/hh-mods.md); a shop list hides `retired` defs.
import { isLive, MILESTONE, MILESTONES } from '../content/index.js';
import { FORMAT, LIMITS, VALUE_BP, parseContentPath, ID_RE } from './format.js';
import { stripRemoved } from './removed.js';
import { cropNumbers, treeNumbers, recipeNumbers, productSell, bounds, cropPerMin, treePerMin, recipePerMin } from './econ.js';
import { overlayHash, modHash } from './hash.js';
import { luminance, hueOf } from './colour.js';

export const FAMILIES = ['crops', 'trees', 'recipes', 'animals', 'decor'];
const OUT_FAMILIES = [...FAMILIES, 'items'];
const RANK = Object.fromEntries(MILESTONES.map((m, i) => [m, i]));
const levelMilestone = (L) => (L <= 12 ? 'M1a' : L <= 25 ? 'M1b' : 'M2');
const latest = (...ms) => ms.filter((m) => Object.hasOwn(RANK, m)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'M1a');
const RAW_KINDS = new Set(['crop', 'fruit', 'animal', 'material']);
const MIN = 60_000;
/** Ground colour a new hue must stand out from (style.css --grass-lit) and the UI text colour (--wood-900). */
export const GROUND_HEX = '#7CC243';
export const TEXT_HEX = '#5A3215';

const BG_ARTICLES = { m: ['ът', 'ят'], f: ['та'], n: ['то'], pl: ['те'] };

function problem(code, file, path, message, hint, stage = 'semantic') {
  const p = { stage, code, file, path, message };
  if (hint) p.hint = hint;
  return p;
}

const byId = (list) => new Map((list ?? []).map((d) => [d.id, d]));
const freezeDeep = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freezeDeep(v);
  }
  return o;
};

/** The Bulgarian names-table entry of a mod text block (+ desc). */
function bgEntry(bg) {
  const e = { name: bg.name, g: bg.g, pl: bg.pl, def: bg.def, plDef: bg.plDef };
  e.count = bg.count ?? bg.pl;
  e.defObj = bg.defObj ?? bg.def;
  for (const k of ['short', 'lc', 'unit', 'desc']) if (bg[k] !== undefined) e[k] = bg[k];
  return e;
}

/** Every def an overlay holds (defs + graveyard), by family then id. */
export function overlayDefs(overlay) {
  const out = Object.fromEntries(OUT_FAMILIES.map((f) => [f, new Map()]));
  if (!overlay) return out;
  for (const part of ['graveyard', 'defs']) {
    for (const f of OUT_FAMILIES) for (const d of overlay[part]?.[f] ?? []) out[f].set(d.id, d);
  }
  return out;
}

/**
 * @returns {{ ok: boolean, overlay?: object, problems: object[], warnings: object[], numbers: object }}
 */
export function compileMod(base, given, { n = 1, prevOverlay = null, tracks = null, bgNames = null, groundHex = GROUND_HEX } = {}) {
  const T = base.tables;
  const problems = [];
  const warnings = [];
  const numbers = {};
  // release 1.0 (M24): a version stored before 1.0 may use a knob the format no longer takes (the schema refuses it in
  // a new mod); it is ignored, so the owners' mod keeps compiling on every later build
  const { files, removed } = stripRemoved(given);
  for (const r of removed) {
    warnings.push(problem('IGNORED', r.file, r.path, `${r.file}${r.path ? ` ${r.path}` : ''} is no longer part of the format: ignored`, r.hint));
  }
  const B = Object.fromEntries(['crops', 'trees', 'recipes', 'animals', 'decor', 'items', 'buildings', 'homes', 'feeds']
    .map((f) => [f, byId(T[f])]));
  const prev = overlayDefs(prevOverlay);
  const prevNames = prevOverlay?.names?.bg ?? {};
  const prevLook = prevOverlay?.look ?? {};
  const isMod = (id) => typeof id === 'string' && ID_RE.test(id);
  const baseLive = (fam, id) => {
    const d = B[fam].get(id);
    return d && isLive(d) && !isMod(id) ? d : null;
  };

  // ---- gather the content files (sorted: the overlay must not depend on the order the agent wrote them)
  const content = [];
  for (const p of Object.keys(files).sort()) {
    const cp = parseContentPath(p);
    if (cp) content.push({ file: p, family: cp.family, spec: files[p] });
  }
  const out = Object.fromEntries(OUT_FAMILIES.map((f) => [f, []]));
  const names = {};
  const models = {};
  const icons = {};
  const modItems = new Map();           // id -> compiled item (for recipe inputs)
  const enNames = new Map();            // lowercase English name -> owner (base and mod)
  for (const f of ['crops', 'trees', 'recipes', 'animals', 'decor', 'items', 'buildings', 'homes', 'feeds']) {
    for (const d of T[f] ?? []) if (typeof d.name === 'string') enNames.set(d.name.toLowerCase(), d.id);
  }
  const bgSeen = new Map();
  const addedBy = (id) => prev.crops.get(id)?.mod?.n ?? prev.trees.get(id)?.mod?.n ?? prev.recipes.get(id)?.mod?.n
    ?? prev.animals.get(id)?.mod?.n ?? prev.decor.get(id)?.mod?.n ?? prev.items.get(id)?.mod?.n ?? n;

  const nameCheck = (file, path, id, text) => {
    const en = text?.en?.name;
    const bg = text?.bg?.name;
    if (typeof en === 'string') {
      const k = en.toLowerCase();
      const owner = enNames.get(k);
      if (owner !== undefined && owner !== id && !prev.items.has(owner)) {
        problems.push(problem('NAME_TAKEN', file, `${path}.en.name`, `"${en}" is already the name of ${owner}`, 'pick another English name'));
      } else enNames.set(k, id);
    }
    if (typeof bg === 'string') {
      const k = bg.toLowerCase();
      if ((bgNames && bgNames.has(k)) || (bgSeen.has(k) && bgSeen.get(k) !== id)) {
        problems.push(problem('NAME_TAKEN', file, `${path}.bg.name`, `"${bg}" is already a Bulgarian name in the game`, 'pick another Bulgarian name'));
      } else bgSeen.set(k, id);
    }
    const g = text?.bg?.g;
    const ends = BG_ARTICLES[g];
    if (ends && typeof text.bg.def === 'string' && !text.bg.def.split(' ').some((w) => ends.some((e) => w.endsWith(e)))) {
      warnings.push(problem('BG_FORMS', file, `${path}.bg.def`, `"${text.bg.def}" does not look like the definite form of a ${g} noun (${ends.join(' / ')})`));
    }
    if (typeof text?.bg?.plDef === 'string' && !text.bg.plDef.split(' ').some((w) => w.endsWith('те'))) {
      warnings.push(problem('BG_FORMS', file, `${path}.bg.plDef`, `"${text.bg.plDef}" does not end in -те`));
    }
  };
  const ground = hueOf(groundHex);
  const hueCheck = (file, path, hex) => {
    if (typeof hex !== 'string') return;
    const h = hueOf(hex);
    const dh = h && ground ? Math.min(Math.abs(h.h - ground.h), 360 - Math.abs(h.h - ground.h)) : 180;
    if (/^#(000000|FFFFFF)$/i.test(hex)) {
      problems.push(problem('LOW_CONTRAST', file, path, 'pure black or white does not read on the farm', 'pick a real colour'));
    } else if (Math.abs(luminance(hex) - luminance(groundHex)) < 0.06 && (dh < 40 || h.s < 0.15)) {
      problems.push(problem('LOW_CONTRAST', file, path, `${hex} is too close to the grass colour`, 'pick a lighter, darker or warmer colour'));
    }
  };
  const named = (id, text) => {
    names[id] = bgEntry(text.bg);
    return text.en.name;
  };
  const itemOf = (id) => modItems.get(id) ?? B.items.get(id);

  // ---- 1. crops, trees, animals, decor (no dependencies between mod things)
  const recipesTodo = [];
  for (const { file, family, spec: s } of content) {
    const mod = { n: addedBy(s.id) };
    if (family === 'recipes') { recipesTodo.push({ file, s }); continue; }
    nameCheck(file, 'text', s.id, s.text);
    if (family === 'crops') {
      const a = baseLive('crops', s.like);
      if (!a) { problems.push(problem('BAD_ANCHOR', file, 'like', `"${s.like}" is not a crop of the game`, 'like: a crop from docs/catalog/crops.json')); continue; }
      hueCheck(file, 'hue', s.hue);
      const num = cropNumbers({ growMin: s.growMin, yield: s.yield, unlock: s.unlock, value: s.value ?? 'normal' });
      const m = levelMilestone(s.unlock);
      const def = { id: s.id, name: named(s.id, s.text), m, unlock: s.unlock, growMs: num.growMs, yield: s.yield,
        sell: num.sell, seed: num.seed, xp: num.xp, classes: [...s.classes], season: s.season, hue: s.hue,
        archetype: a.archetype, model: a.model, xp100: num.xp100, stages: [...a.stages], mastery: [...a.mastery],
        freshMs: a.freshMs, waterable: s.waterable ?? a.waterable, mod };
      if (s.text.en.desc) def.text = s.text.en.desc;
      const live = (T.crops ?? []).filter((c) => isLive(c) && !isMod(c.id));
      const bd = bounds('crops', s.unlock, cropPerMin(def), live, cropPerMin);
      if (!bd.ok) {
        problems.push(problem('OUT_OF_RANGE', file, 'growMin', `pays ${(bd.ratioBp / 100).toFixed(0)} % of the best crop up to level ${s.unlock} per minute (at most 112 %)`,
          'choose a longer growMin or a humbler value'));
      }
      out.crops.push(def);
      const item = { id: s.id, name: def.name, m, kind: 'crop', unlock: s.unlock, source: s.id, sell: num.sell,
        classes: [...s.classes, 'produce'], sellable: true, orderable: false, giftable: true, keepDefault: 0, mod };
      out.items.push(item);
      modItems.set(s.id, item);
      models[s.id] = { key: `crop:${a.id}`, from: a.hue, to: s.hue, kind: 'recolor' };
      icons[s.id] = { like: a.id, from: a.hue, to: s.hue };
      numbers[s.id] = { sell: num.sell, seed: num.seed, xp: num.xp, growMin: s.growMin, unlock: s.unlock };
    } else if (family === 'trees') {
      const a = baseLive('trees', s.like);
      if (!a || a.tool !== 'basket' || a.relic || a.rainbow || a.shop !== true) {
        problems.push(problem('BAD_ANCHOR', file, 'like', `"${s.like}" is not a fruit tree you can copy`, 'like: a fruit tree picked with a basket (docs/catalog/trees.json)'));
        continue;
      }
      const fruitA = B.items.get(a.product);
      hueCheck(file, 'hue', s.hue);
      nameCheck(file, 'fruit.text', s.fruit.id, s.fruit.text);
      const num = treeNumbers({ cycleHours: s.cycleHours, unlock: s.unlock, value: s.value ?? 'normal' }, a);
      const m = levelMilestone(s.unlock);
      const def = { id: s.id, name: named(s.id, s.text), m, kind: a.kind, layer: a.layer, size: [...a.size],
        unlock: s.unlock, shop: true, cost: a.cost, growthBp: a.growthBp, cap: { ...a.cap }, cycleMs: num.cycleMs,
        yield: a.yield, product: s.fruit.id, xp: num.xp, saplingCycles: a.saplingCycles, heirloomAt: a.heirloomAt,
        flowering: a.flowering, tool: a.tool, mastery: [...a.mastery], model: a.model, shape: structuredClone(a.shape),
        hue: s.hue, leaf: s.leaf ?? a.leaf, mod };
      if (s.text.en.desc) def.text = s.text.en.desc;
      const fruit = { id: s.fruit.id, name: named(s.fruit.id, s.fruit.text), m, kind: 'fruit', unlock: s.unlock,
        source: s.id, sell: num.sell, classes: [...(fruitA?.classes ?? ['produce'])], sellable: true, orderable: false,
        giftable: true, keepDefault: 0, mod };
      const live = (T.trees ?? []).filter((t) => isLive(t) && !isMod(t.id) && t.tool === 'basket' && !t.relic);
      const items = (id) => (id === fruit.id ? fruit : B.items.get(id));
      const bd = bounds('trees', s.unlock, treePerMin(def, items), live, (t) => treePerMin(t, items));
      if (!bd.ok) problems.push(problem('OUT_OF_RANGE', file, 'cycleHours', 'pays more per hour than the game\'s trees allow', 'choose longer cycleHours or a humbler value'));
      out.trees.push(def);
      out.items.push(fruit);
      modItems.set(fruit.id, fruit);
      models[s.id] = { key: `tree:${a.id}`, from: a.hue, to: s.hue, kind: 'recolor', leaf: s.leaf ? { from: a.leaf, to: s.leaf } : undefined };
      if (!s.leaf) delete models[s.id].leaf;
      icons[s.id] = { like: a.id, from: a.hue, to: s.hue };
      icons[fruit.id] = { like: a.product, from: a.hue, to: s.hue };
      numbers[s.id] = { sell: num.sell, xp: num.xp, minutes: s.cycleHours * 60, unlock: s.unlock };
    } else if (family === 'animals') {
      const a = baseLive('animals', s.like);
      if (!a || a.shop !== true || !(a.baby > 0) || a.id === 'bee') {
        problems.push(problem('BAD_ANCHOR', file, 'like', `"${s.like}" is not an animal you can copy`, 'like: an animal sold in the shop (not bees)'));
        continue;
      }
      const prodA = B.items.get(a.product);
      nameCheck(file, 'product.text', s.product.id, s.product.text);
      const { first: _first, ...rest } = structuredClone(a);
      const def = { ...rest, id: s.id, name: named(s.id, s.text), product: s.product.id, mod };
      if (s.text.en.desc) def.text = s.text.en.desc;
      const sell = productSell(prodA.sell, s.value ?? 'normal');
      const prod = { id: s.product.id, name: named(s.product.id, s.product.text), m: latest(a.m, prodA.m), kind: 'animal',
        unlock: prodA.unlock, source: s.id, sell, classes: [...(prodA.classes ?? [])], sellable: true, orderable: false,
        giftable: true, keepDefault: 0, mod };
      out.animals.push(def);
      out.items.push(prod);
      modItems.set(prod.id, prod);
      models[s.id] = { key: `animal:${a.id}`, from: null, to: s.coat, kind: 'tint' };
      icons[s.id] = { like: a.id, from: null, to: s.coat, kind: 'tint' };
      icons[prod.id] = { like: a.product, from: null, to: s.product.hue ?? s.coat };
      numbers[s.id] = { sell, xp: a.xp, minutes: Math.round(a.cycleMs / MIN), unlock: a.unlock };
    } else if (family === 'decor') {
      const a = baseLive('decor', s.like);
      if (!a || a.tier !== 'coin' || a.shop !== true) {
        problems.push(problem('BAD_ANCHOR', file, 'like', `"${s.like}" is not a coin decoration of the shop`, 'like: a decoration from docs/catalog/decor.json'));
        continue;
      }
      hueCheck(file, 'hue', s.hue);
      if (s.cost * 2 < a.cost || s.cost > a.cost * 2) {
        problems.push(problem('OUT_OF_RANGE', file, 'cost', `cost must be ${Math.ceil(a.cost / 20) * 10}-${a.cost * 2}`, `half to double ${a.name}'s ${a.cost}`));
      }
      const beauty10 = Math.min(a.beauty10 * 2, Math.round((a.beauty10 * s.cost) / a.cost));
      const def = { id: s.id, name: named(s.id, s.text), m: a.m, kind: a.kind, layer: a.layer, size: [...a.size],
        unlock: a.unlock, tier: 'coin', shop: true, cost: s.cost, acorns: 0, beauty10, perTile: Boolean(a.perTile),
        effect: a.effect?.cosmetic ? { cosmetic: a.effect.cosmetic } : {}, text: s.text.en.desc ?? '', model: a.model, mod };
      out.decor.push(def);
      models[s.id] = { key: `decor:${a.id}`, from: null, to: s.hue, kind: 'recolor' };
      icons[s.id] = { like: a.id, from: null, to: s.hue };
      numbers[s.id] = { cost: s.cost, beauty: beauty10, unlock: a.unlock };
    }
  }

  // ---- 2. recipes, in dependency order (a mod recipe may use another's output); a cycle is refused
  const recipeIds = new Set(recipesTodo.map((r) => r.s.id));
  const done = new Set();
  let pending = recipesTodo.slice();
  while (pending.length) {
    const ready = pending.filter((r) => Object.keys(r.s.inputs).every((i) => !recipeIds.has(i) || i === r.s.id || done.has(i)));
    if (!ready.length) {
      for (const r of pending) problems.push(problem('CYCLE', r.file, 'inputs', 'recipes use each other in a circle', 'make one of them from base items only'));
      break;
    }
    for (const r of ready) { compileRecipe(r); done.add(r.s.id); }
    pending = pending.filter((r) => !ready.includes(r));
  }

  function compileRecipe({ file, s }) {
    const mod = { n: addedBy(s.id) };
    nameCheck(file, 'text', s.id, s.text);
    const a = baseLive('recipes', s.like);
    const b = baseLive('buildings', s.building);
    if (!b || !(T.recipes ?? []).some((r) => r.building === b.id && isLive(r))) {
      problems.push(problem('UNKNOWN_REF', file, 'building', `"${s.building}" is not a building with recipes`, 'building: from docs/catalog/buildings.json'));
      return;
    }
    if (!a || a.building !== s.building) {
      problems.push(problem('BAD_ANCHOR', file, 'like', `"${s.like}" is not a recipe of ${b.name}`, 'like: a recipe of the same building'));
      return;
    }
    hueCheck(file, 'hue', s.hue);
    const relics = new Set((T.rules?.RELICS ?? []).map((r) => r.id));
    const crateItems = new Set((T.rules?.CRATES?.extras ?? []).map((x) => x.item).filter(Boolean));
    let ok = true;
    let maxUnlock = b.unlock;
    let ms = latest(levelMilestone(s.unlock), b.m);
    let raw = true;
    for (const id of Object.keys(s.inputs)) {
      const it = itemOf(id);
      const retired = prev.items.get(id) && !modItems.has(id);
      if (id === s.id) { problems.push(problem('CYCLE', file, `inputs.${id}`, 'a recipe cannot use itself')); ok = false; continue; }
      if (!it || retired || (!isMod(id) && !isLive(it))) {
        problems.push(problem('UNKNOWN_REF', file, `inputs.${id}`, `"${id}" is not an item of the game or of this mod`, 'inputs: items from docs/catalog/items.json'));
        ok = false;
        continue;
      }
      if (!it.sellable || it.kind === 'premium' || it.kind === 'feed' || it.kind === 'consumable' || relics.has(id) || crateItems.has(id) || it.relic) {
        problems.push(problem('UNKNOWN_REF', file, `inputs.${id}`, `"${id}" cannot go into a recipe`, 'no premium, relic, crate, feed or consumable items'));
        ok = false;
        continue;
      }
      maxUnlock = Math.max(maxUnlock, it.unlock);
      ms = latest(ms, it.m);
      if (!RAW_KINDS.has(it.kind)) raw = false;
    }
    if (!ok) return;
    if (s.unlock < maxUnlock) {
      problems.push(problem('BAD_UNLOCK', file, 'unlock', `unlock must be at least ${maxUnlock} (its building and every input)`, `unlock: ${maxUnlock} or more`));
      return;
    }
    const num = recipeNumbers({ minutes: s.minutes, unlock: s.unlock, value: s.value ?? 'normal', inputs: s.inputs }, itemOf);
    if (!num.ok) {
      problems.push(problem('ECON_BOUND', file, 'minutes', `the machine adds ${num.add} to inputs worth ${num.inValue}; it must add at least ${num.need}`,
        'choose a longer time for such big inputs'));
      return;
    }
    const aItem = B.items.get(a.id);
    const def = { id: s.id, name: named(s.id, s.text), m: ms, building: s.building, unlock: s.unlock, ms: num.ms, out: 1,
      inputs: { ...s.inputs }, tier: raw ? 'T2' : 'T3', duet: false, sell: num.sell, xp: num.xp, mastery: [...a.mastery], mod };
    if (s.text.en.desc) def.text = s.text.en.desc;
    const live = (T.recipes ?? []).filter((r) => isLive(r) && !isMod(r.id));
    const bd = bounds('recipes', s.unlock, recipePerMin(def, itemOf), live, (r) => recipePerMin(r, itemOf));
    if (!bd.ok) problems.push(problem('OUT_OF_RANGE', file, 'minutes', 'adds more value per minute than the game\'s recipes allow', 'choose a longer time or a humbler value'));
    const item = { id: s.id, name: def.name, m: ms, kind: 'craft', tier: def.tier, unlock: s.unlock, source: s.id,
      sell: num.sell, sellable: true, orderable: false, giftable: true, keepDefault: 0, classes: [...(aItem?.classes ?? [])], mod };
    out.recipes.push(def);
    out.items.push(item);
    modItems.set(s.id, item);
    icons[s.id] = { like: a.id, from: null, to: s.hue };
    numbers[s.id] = { sell: num.sell, xp: num.xp, minutes: s.minutes, unlock: s.unlock };
  }

  // ---- 3. retire what was applied before and is gone now; a graveyard id back in its own family is revived
  const liveIds = new Set(OUT_FAMILIES.flatMap((f) => out[f].map((d) => d.id)));
  const graveyard = Object.fromEntries(OUT_FAMILIES.map((f) => [f, []]));
  for (const f of OUT_FAMILIES) {
    for (const [id, d] of prev[f]) {
      if (liveIds.has(id)) continue;
      // retired: true is what every purchase checks (rules rule 8: LOCKED); `shop` stays as compiled, because the game's
      // own content check ties it to the price fields (coin decor is sold, a breed with a baby price is sold)
      graveyard[f].push({ ...d, retired: true });
      if (prevNames[id]) names[id] = prevNames[id];
      if (prevLook.models?.[id]) models[id] = prevLook.models[id];
      if (prevLook.icons?.[id]) icons[id] = prevLook.icons[id];
    }
  }

  // ---- 4. limits: new things per job, live things per farm
  const fresh = FAMILIES.reduce((sum, f) => sum + out[f].filter((d) => !prev[f].has(d.id)).length, 0);
  if (fresh > LIMITS.newPerJob) problems.push(problem('TOO_MANY', '', '', `${fresh} new things; one request may add ${LIMITS.newPerJob}`, 'split it into several requests'));
  const liveCount = FAMILIES.reduce((s, f) => s + out[f].length, 0);
  if (liveCount > LIMITS.liveDefs) problems.push(problem('TOO_MANY', '', '', `${liveCount} things on the farm; at most ${LIMITS.liveDefs}`));

  // ---- 5. patches: animal homes (live and retired breeds), tuning
  const patch = { homes: [], crops: [], trees: [], recipes: [], animals: [] };
  const homeAdds = new Map();
  for (const a of [...out.animals, ...graveyard.animals]) {
    for (const h of a.homes ?? []) {
      if (!homeAdds.has(h)) homeAdds.set(h, []);
      homeAdds.get(h).push(a.id);
    }
  }
  for (const [h, ids] of [...homeAdds].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const home = B.homes.get(h);
    if (home) patch.homes.push({ ...structuredClone(home), species: [...(home.species ?? []), ...ids.sort()] });
  }
  const tuning = files['tuning.json'];
  if (tuning) applyTuning(tuning);

  function applyTuning(t) {
    const scale = (ms, bp) => Math.max(1000, Math.round((ms * bp) / 10_000 / 1000) * 1000);
    const perCrop = t.crops ?? {};
    for (const [id, c] of Object.entries(perCrop)) {
      const own = out.crops.find((d) => d.id === id) ?? baseLive('crops', id);
      if (!own) { problems.push(problem('UNKNOWN_REF', 'tuning.json', `crops.${id}`, `"${id}" is not a crop of this farm`)); continue; }
      const cur = own.growMs / MIN;
      if (c.growMin * 2 < cur || c.growMin > cur * 2) {
        problems.push(problem('OUT_OF_RANGE', 'tuning.json', `crops.${id}.growMin`, `must stay within half and double ${cur} minutes`));
      }
    }
    const crop = (d) => {
      if (Object.hasOwn(perCrop, d.id)) return { ...d, growMs: perCrop[d.id].growMin * MIN };
      return t.growTimeBp ? { ...d, growMs: scale(d.growMs, t.growTimeBp) } : d;
    };
    const tunedBase = (fam, list, fn) => {
      for (const d of list) {
        const nd = fn(d);
        if (nd !== d) patch[fam].push(nd);
      }
    };
    out.crops = out.crops.map(crop);
    tunedBase('crops', (T.crops ?? []).filter((d) => isLive(d)), crop);
    if (t.treeCycleBp) {
      const tree = (d) => (d.tool === 'basket' ? { ...d, cycleMs: scale(d.cycleMs, t.treeCycleBp) } : d);
      out.trees = out.trees.map(tree);
      tunedBase('trees', (T.trees ?? []).filter((d) => isLive(d)), tree);
    }
    if (t.craftTimeBp) {
      const rec = (d) => ({ ...d, ms: scale(d.ms, t.craftTimeBp) });
      out.recipes = out.recipes.map(rec);
      tunedBase('recipes', (T.recipes ?? []).filter((d) => isLive(d)), rec);
    }
    if (t.animalCycleBp) {
      const an = (d) => (d.shop === true ? { ...d, cycleMs: scale(d.cycleMs, t.animalCycleBp) } : d);
      out.animals = out.animals.map(an);
      tunedBase('animals', (T.animals ?? []).filter((d) => isLive(d)), an);
    }
  }

  // ---- 6. look and text
  const look = { models, icons };
  const lk = files['look.json'];
  if (lk) {
    if (lk.sky) look.sky = lk.sky;
    if (lk.music) {
      for (const id of lk.music.prefer) {
        if (tracks && !tracks.includes(id)) problems.push(problem('UNKNOWN_REF', 'look.json', 'music.prefer', `"${id}" is not a music track`, 'use ids from docs/catalog/music.json'));
      }
      look.music = { prefer: [...lk.music.prefer] };
    }
  }
  const art = new Set(T.rules?.LETTER_ART ?? []);
  const letters = (files['text/letters.json'] ?? []).map((l, i) => {
    if (!art.has(l.art)) problems.push(problem('UNKNOWN_REF', 'text/letters.json', `${i}.art`, `"${l.art}" is not letter art`, 'art: from docs/catalog/letterArt.json'));
    return { id: l.id, from: l.from, art: l.art, en: { ...l.en }, bg: { ...l.bg }, n: prevOverlay?.text?.letters?.find((x) => x.id === l.id)?.n ?? n };
  });
  // tips (release 1.0: never shown, removed from the format) stay an empty list: the overlay's shape is unchanged
  const tips = [];
  const textIds = new Set();
  for (const x of letters) {
    if (textIds.has(x.id) || liveIds.has(x.id)) problems.push(problem('NAME_TAKEN', x.id.startsWith('x_') ? 'text' : '', 'id', `"${x.id}" is used twice`));
    textIds.add(x.id);
  }

  if (problems.length) return { ok: false, problems, warnings, numbers };
  const sort = (list) => list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of OUT_FAMILIES) { sort(out[f]); sort(graveyard[f]); }
  for (const f of Object.keys(patch)) sort(patch[f]);
  const mj = files['mod.json'] ?? { title: { en: 'My changes', bg: 'Моите промени' } };
  const overlay = {
    format: FORMAT, n, hash: '', base: base.hash, rules: base.rules, modHash: modHash(given),
    title: { en: mj.title.en, bg: mj.title.bg },
    defs: out, patch, graveyard, names: { bg: names }, look, text: { letters, tips },
    // the speed knobs as written (release 1.0, H3: the change list says "All crops grow 20 % faster", one row)
    tuning: tuningOf(files['tuning.json']),
  };
  overlay.hash = overlayHash(overlay);
  return { ok: true, overlay: freezeDeep(overlay), problems, warnings, numbers };
}

/** The knobs of a tuning.json as plain data ({} when none). */
function tuningOf(t) {
  if (!t || typeof t !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === 'crops' && v && typeof v === 'object') out.crops = Object.fromEntries(Object.entries(v).map(([id, c]) => [id, c.growMin]));
    else if (Number.isInteger(v)) out[k] = v;
  }
  return out;
}

/** Value names the guide documents (kept here so the compiler and the guide test share them). */
export const VALUES = Object.keys(VALUE_BP);
export { MILESTONE };
