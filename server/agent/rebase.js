// QA r1 H-03: a job whose farm moved while it was ready ("Rebuild on top" after a STALE apply, or "Ask for changes"
// after a partner's change or undo) rebuilds on the farm as it is now. Its work folder's mod/ was seeded from the old
// version; carrying those files over would bring back whatever the partner undid since. merge3 keeps only this job's
// own changes on top of the new version. Pure.
//
//   merge3(base, ours, theirs) -> merged      base: the old version's files, ours: the job's mod/, theirs: the new
//                                             version's files ({ path: parsedJson }; a missing path is undefined)
//   Rules, at every depth: what the job left as it was takes the farm's value now; what the farm left as it was keeps
//   the job's; objects merge key by key; arrays (letters) drop what the job dropped and add what the job added to the
//   farm's list; a value both changed keeps the job's (the wish being built). `undefined` = absent (a file, a key).
import { canonical } from '../../shared/mod/hash.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => (a === undefined || b === undefined ? a === b : canonical(a) === canonical(b));

export function merge3(base, ours, theirs) {
  if (same(ours, base)) return theirs;
  if (same(theirs, base) || same(ours, theirs)) return ours;
  if (isObj(ours) && isObj(theirs) && (base === undefined || isObj(base))) {
    const b = base ?? {};
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(b)])) {
      const v = merge3(b[k], ours[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(ours) && Array.isArray(theirs) && (base === undefined || Array.isArray(base))) {
    const key = (x) => canonical(x);
    const inBase = new Set((base ?? []).map(key));
    const inOurs = new Set(ours.map(key));
    const dropped = new Set([...inBase].filter((k) => !inOurs.has(k)));
    const out = theirs.filter((x) => !dropped.has(key(x)));
    const have = new Set(out.map(key));
    for (const x of ours) if (!inBase.has(key(x)) && !have.has(key(x))) { out.push(x); have.add(key(x)); }
    return out;
  }
  return ours;
}
