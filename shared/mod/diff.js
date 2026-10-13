// What changed between two overlays (contract §2.1): the ready pop-up's list, the history and telemetry.
//   diffOverlays(prev, next) -> { added, changed, retired, revived }   each [{ family, id }] sorted by family, id
// Only content things (crops trees recipes animals decor) count, plus tuned base defs as `changed`; items follow their
// owners and are not listed on their own.
import { canonical } from './hash.js';

const FAMS = ['crops', 'trees', 'recipes', 'animals', 'decor'];
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
