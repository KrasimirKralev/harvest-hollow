// What changed between two overlays (contract §2.1): the ready pop-up's list, the history and telemetry. Pure.
//   diffOverlays(prev, next) -> { added, changed, retired, revived }   each [{ family, id }] sorted by family, id
//       Only content things (crops trees recipes animals decor) count, plus tuned base defs as `changed`; items follow
//       their owners and are not listed on their own (telemetry's ids).
//   sameEffect(prev, next) -> bool   next changes nothing the farm can see or play compared with prev (null: the game
//       as it is): the validator answers NO_CHANGE and the job ends `answered`, never with an empty candidate (H1)
//   changeRows(prev, next, { base, iconOf, bgName, musicTitle }) -> Change[]   the player's list (release 1.0, H3):
//       content things with their facts; one row per global speed knob ("All crops grow 20 % faster", folding the
//       per-def patches it causes); one row per crop tuned on its own ("1 h 30 m -> 45 m"); the sky and the music; a
//       letter by its title. Change = { op, family, id, name: { en, bg }, icon, numbers?, info?, ...kind fields }:
//         content   numbers { sell | cost, seed, xp, minutes, unlock, yield }, info { season, building, inputs, product }
//         tuning    { family: 'tuning', id: knob, knob, bp, was }                 bp 10000 = the normal speed again
//         per-crop  { family: 'crops', op: 'change', tuned: true, numbers: { from, minutes } }
//         look      { family: 'look', id: 'sky', sky } | { family: 'look', id: 'music', tracks: [{ id, title }] }
//         letter    { family: 'text', id, from, name: { en: title, bg: title } }
import { canonical } from './hash.js';
import { TUNING_KEYS, ID_RE } from './format.js';

const FAMS = ['crops', 'trees', 'recipes', 'animals', 'decor'];
const MIN = 60_000;
const strip = (d) => {
  const { mod: _m, ...rest } = d;
  return canonical(rest);
};
const index = (o, part) => new Map(FAMS.flatMap((f) => (o?.[part]?.[f] ?? []).map((d) => [`${f}:${d.id}`, d])));

export function diffOverlays(prev, next) {
  const pLive = index(prev, 'defs');
  const pDead = index(prev, 'graveyard');
  const nLive = index(next, 'defs');
  const nDead = index(next, 'graveyard');
  const added = [];
  const changed = [];
  const retired = [];
  const revived = [];
  const ref = (k) => ({ family: k.slice(0, k.indexOf(':')), id: k.slice(k.indexOf(':') + 1) });
  for (const [k, d] of nLive) {
    if (pLive.has(k)) { if (strip(pLive.get(k)) !== strip(d)) changed.push(ref(k)); } else if (pDead.has(k)) revived.push(ref(k));
    else added.push(ref(k));
  }
  for (const k of nDead.keys()) if (pLive.has(k)) retired.push(ref(k));
  // tuned base defs (patches other than the home lists a new breed joins)
  const pPatch = new Map(FAMS.flatMap((f) => (prev?.patch?.[f] ?? []).map((d) => [`${f}:${d.id}`, d])));
  const nPatch = new Map(FAMS.flatMap((f) => (next?.patch?.[f] ?? []).map((d) => [`${f}:${d.id}`, d])));
  for (const k of new Set([...pPatch.keys(), ...nPatch.keys()])) {
    const a = pPatch.get(k);
    const b = nPatch.get(k);
    if (!a || !b || canonical(a) !== canonical(b)) changed.push(ref(k));
  }
  const order = (x, y) => (x.family < y.family ? -1 : x.family > y.family ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return { added: added.sort(order), changed: changed.sort(order), retired: retired.sort(order), revived: revived.sort(order) };
}

/** What an overlay does to the farm, as one canonical string (title, numbers n and hashes left out). */
function effectOf(o) {
  const lists = (part) => Object.fromEntries(Object.entries(o?.[part] ?? {}).filter(([, l]) => Array.isArray(l) && l.length));
  const look = o?.look ?? {};
  return canonical({
    defs: lists('defs'), patch: lists('patch'), graveyard: lists('graveyard'), names: o?.names?.bg ?? {},
    sky: look.sky && look.sky !== 'default' ? look.sky : null, music: look.music?.prefer ?? [],
    models: look.models ?? {}, icons: look.icons ?? {},
    letters: (o?.text?.letters ?? []).map(({ n: _n, ...l }) => l),
  });
}

export function sameEffect(prev, next) {
  return effectOf(prev) === effectOf(next);
}

/** The knob each content family's time follows, and the time field it scales. */
const KNOB_OF = { crops: ['growTimeBp', 'growMs'], trees: ['treeCycleBp', 'cycleMs'], recipes: ['craftTimeBp', 'ms'], animals: ['animalCycleBp', 'cycleMs'] };
const tuningOf = (o) => (o?.tuning && typeof o.tuning === 'object' ? o.tuning : {});
const bpOf = (o, k) => (Number.isInteger(tuningOf(o)[k]) ? tuningOf(o)[k] : 10_000);
/** a and b differ only in `field` (a speed knob's doing). */
const onlyTime = (a, b, field) => {
  const { [field]: _x, mod: _m, ...ra } = a;
  const { [field]: _y, mod: _n, ...rb } = b;
  return canonical(ra) === canonical(rb);
};

/**
 * @param {object|null} prev   the farm's overlay now (null: the game as it is)
 * @param {object} next        the candidate
 * @param {{ base?: object, iconOf?: (id: string, mod: boolean) => string|null, bgName?: (id: string) => string|null,
 *   musicTitle?: (id: string) => string|null }} o   base: the game's tables (cloneTables()), for names and anchors
 */
export function changeRows(prev, next, { base = null, iconOf = () => null, bgName = () => null, musicTitle = () => null } = {}) {
  const nextDefs = Object.fromEntries([...FAMS, 'items'].map((f) => [f, new Map([
    ...(next?.graveyard?.[f] ?? []), ...(next?.defs?.[f] ?? []),
  ].map((d) => [d.id, d]))]));
  const baseMap = Object.fromEntries(['crops', 'trees', 'recipes', 'animals', 'decor', 'items', 'buildings']
    .map((f) => [f, new Map((base?.[f] ?? []).map((d) => [d.id, d]))]));
  const bgNames = next?.names?.bg ?? {};
  const isMod = (id) => ID_RE.test(String(id));
  const nameOf = (id) => {
    const d = nextDefs.items.get(id) ?? FAMS.map((f) => nextDefs[f].get(id)).find(Boolean)
      ?? baseMap.items.get(id) ?? FAMS.map((f) => baseMap[f].get(id)).find(Boolean) ?? baseMap.buildings.get(id);
    return { en: d?.name ?? id, bg: bgNames[id]?.name ?? bgName(id) ?? null };
  };
  const icon = (id) => iconOf(id, isMod(id)) ?? null;
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

  /** The facts of one content thing (numbers the client words, and what it needs or gives). */
  const factsOf = (family, x) => {
    if (!x) return { numbers: {}, info: {} };
    if (family === 'crops') {
      return { numbers: clean({ sell: x.sell, seed: x.seed, xp: x.xp, minutes: x.growMs ? Math.round(x.growMs / MIN) : undefined, unlock: x.unlock,
        yield: x.yield }), info: clean({ season: x.season }) };
    }
    if (family === 'trees') {
      const fruit = nextDefs.items.get(x.product) ?? baseMap.items.get(x.product);
      return { numbers: clean({ sell: fruit?.sell, xp: x.xp, minutes: x.cycleMs ? Math.round(x.cycleMs / MIN) : undefined, unlock: x.unlock,
        cost: x.cost }), info: clean({ product: x.product ? { id: x.product, name: nameOf(x.product) } : undefined }) };
    }
    if (family === 'recipes') {
      return { numbers: clean({ sell: x.sell, xp: x.xp, minutes: x.ms ? Math.round(x.ms / MIN) : undefined, unlock: x.unlock }),
        info: clean({ building: x.building ? { id: x.building, name: nameOf(x.building) } : undefined,
          inputs: Object.entries(x.inputs ?? {}).map(([id, n]) => ({ id, n, name: nameOf(id) })) }) };
    }
    if (family === 'animals') {
      const prod = nextDefs.items.get(x.product) ?? baseMap.items.get(x.product);
      return { numbers: clean({ sell: prod?.sell, xp: x.xp, minutes: x.cycleMs ? Math.round(x.cycleMs / MIN) : undefined, unlock: x.unlock }),
        info: clean({ product: x.product ? { id: x.product, name: nameOf(x.product) } : undefined }) };
    }
    if (family === 'decor') return { numbers: clean({ cost: x.cost, unlock: x.unlock }), info: {} };
    return { numbers: {}, info: {} };
  };

  const out = [];
  const contentRow = (op, family, id) => {
    const x = nextDefs[family].get(id);
    const { numbers, info } = factsOf(family, x);
    return { op, family, id, name: { en: x?.name ?? id, bg: bgNames[id]?.name ?? bgName(id) ?? null }, icon: icon(id),
      numbers, ...(Object.keys(info).length ? { info } : {}) };
  };
  const d = diffOverlays(prev, next);
  const knobChanged = (fam) => KNOB_OF[fam] && bpOf(prev, KNOB_OF[fam][0]) !== bpOf(next, KNOB_OF[fam][0]);
  for (const { family, id } of [...d.added, ...d.revived]) out.push(contentRow(d.added.some((x) => x.id === id) ? 'add' : 'revive', family, id));
  // a mod thing that changed: listed, unless a speed knob's change is all that happened to it (the knob's row says it)
  const pLive = index(prev, 'defs');
  for (const { family, id } of d.changed) {
    if (!isMod(id)) continue;                     // base defs: tuning, worded below
    const a = pLive.get(`${family}:${id}`);
    const b = nextDefs[family].get(id);
    if (a && b && knobChanged(family) && onlyTime(a, b, KNOB_OF[family][1])) continue;
    out.push(contentRow('change', family, id));
  }
  // the speed knobs: one row each
  for (const knob of TUNING_KEYS) {
    const was = bpOf(prev, knob);
    const bp = bpOf(next, knob);
    if (was !== bp) out.push({ op: 'change', family: 'tuning', id: knob, knob, bp, was, name: { en: knob, bg: null }, icon: null });
  }
  // a crop tuned on its own: from -> to (its time with the knobs of each side)
  const own = (o) => (tuningOf(o).crops && typeof tuningOf(o).crops === 'object' ? tuningOf(o).crops : {});
  const minutesIn = (o, id) => {
    const p = (o?.patch?.crops ?? []).find((c) => c.id === id) ?? (o?.defs?.crops ?? []).find((c) => c.id === id) ?? baseMap.crops.get(id);
    return p?.growMs ? Math.round(p.growMs / MIN) : null;
  };
  for (const id of [...new Set([...Object.keys(own(prev)), ...Object.keys(own(next))])].sort()) {
    const from = minutesIn(prev, id);
    const minutes = minutesIn(next, id);
    if (from === minutes) continue;
    const x = nextDefs.crops.get(id) ?? baseMap.crops.get(id);
    out.push({ op: 'change', family: 'crops', id, tuned: true, name: { en: x?.name ?? id, bg: bgNames[id]?.name ?? bgName(id) ?? null },
      icon: icon(id), numbers: clean({ from, minutes, unlock: x?.unlock }) });
  }
  // the sky and the music
  const skyOf = (o) => (o?.look?.sky && o.look.sky !== 'default' ? o.look.sky : 'default');
  if (skyOf(prev) !== skyOf(next)) out.push({ op: 'change', family: 'look', id: 'sky', sky: skyOf(next), name: { en: 'sky', bg: null }, icon: null });
  const musicOf = (o) => (Array.isArray(o?.look?.music?.prefer) ? o.look.music.prefer : []);
  if (canonical(musicOf(prev)) !== canonical(musicOf(next))) {
    out.push({ op: 'change', family: 'look', id: 'music', tracks: musicOf(next).map((id) => ({ id, title: musicTitle(id) ?? id })),
      name: { en: 'music', bg: null }, icon: null });
  }
  // a new letter, by its title
  const had = new Set((prev?.text?.letters ?? []).map((l) => l.id));
  for (const l of next?.text?.letters ?? []) {
    if (had.has(l.id)) continue;
    out.push({ op: 'add', family: 'text', id: l.id, from: l.from, name: { en: l.en?.title ?? l.id, bg: l.bg?.title ?? null }, icon: null });
  }
  for (const { family, id } of d.retired) out.push(contentRow('retire', family, id));
  return out;
}
