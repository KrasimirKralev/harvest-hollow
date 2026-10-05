// Action argument schemas (FROZEN CONTRACT, tech-architecture §7 rule 2). No dependency, pure.
//
// A schema maps each argument name to a validator spec:
//   'objId'                   object id: /^[a-z0-9.]{1,40}$/ (prototype names like __proto__ cannot match)
//   'tile'                    integer tile coordinate in [0, WORLD_TILES)
//   'rot'                     integer quarter turns 0..3
//   'qty'                     integer 1..9999
//   'pid'                     a player slot id ('p1', 'p2')
//   ['content', kind]         an OWN key of CONTENT[kind] (or of PLACEABLES for kind 'placeables')
//   ['int', min, max]         integer in [min, max]
//   ['text', max]             string, control chars stripped, trimmed, 1..max chars
//   ['enum', ...values]       one of the listed strings
//   'confirm'                 array of at most 3 distinct soft codes (RESERVED, PINNED, BIG_SPEND)
//   'bool'                    true or false
//   ['list', spec, max]       array of 1..max DISTINCT values, each valid for `spec` (drag strokes: object ids;
//                             wave 1, additive). Order is kept: batch actions apply targets in stroke order.
//   { opt: spec }             optional argument: may be absent, validated by `spec` when present
//
// parseArgs() returns a NEW plain object holding only schema keys, or null when any argument is missing,
// mistyped or EXTRA (unknown keys reject the action). Rules receive only parsed args.
//
// `confirm` is an ENVELOPE argument (review-m0 #11): every action accepts an optional `args.confirm` (the
// 'confirm' validator) without declaring it, so the client's "Yes, buy it" resend (tech §15.2) never dead-ends
// in BAD_ARGS. Read it with confirmed(args, code). A schema may still declare `confirm` itself (same rule).
import { lookup } from '../content/index.js';
import { WORLD_TILES, PLAYER_SLOTS } from '../content/config.js';
import { SOFT } from '../net/protocol.js';

const OBJ_ID_RE = /^[a-z0-9.]{1,40}$/;

/** Helpers to build specs readably: V.int(0, 9), V.opt('confirm'), V.content('crops'). */
export const V = Object.freeze({
  objId: 'objId', tile: 'tile', rot: 'rot', qty: 'qty', pid: 'pid', confirm: 'confirm', bool: 'bool',
  content: (kind) => ['content', kind],
  list: (spec, max) => ['list', spec, max],
  int: (lo, hi) => ['int', lo, hi],
  text: (max) => ['text', max],
  oneOf: (...values) => ['enum', ...values],
  opt: (spec) => ({ opt: spec }),
});

const isInt = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;

/**
 * Validate one value. Returns { ok: true, v } or { ok: false }.
 * @param {any} spec
 * @param {unknown} val
 */
export function check(spec, val) {
  const bad = { ok: false };
  if (typeof spec === 'string') {
    switch (spec) {
      case 'objId': return typeof val === 'string' && OBJ_ID_RE.test(val) ? { ok: true, v: val } : bad;
      case 'tile': return isInt(val, 0, WORLD_TILES - 1) ? { ok: true, v: val } : bad;
      case 'rot': return isInt(val, 0, 3) ? { ok: true, v: val } : bad;
      case 'qty': return isInt(val, 1, 9999) ? { ok: true, v: val } : bad;
      case 'pid': return typeof val === 'string' && PLAYER_SLOTS.includes(val) ? { ok: true, v: val } : bad;
      case 'bool': return typeof val === 'boolean' ? { ok: true, v: val } : bad;
      case 'confirm': {
        if (!Array.isArray(val) || val.length < 1 || val.length > 3) return bad;
        if (!val.every((c) => typeof c === 'string' && SOFT.has(c)) || new Set(val).size !== val.length) return bad;
        return { ok: true, v: val.slice() };
      }
      default: throw new Error(`schema: unknown validator ${spec}`);
    }
  }
  if (Array.isArray(spec)) {
    const [kind, a, b] = spec;
    switch (kind) {
      case 'content': return typeof val === 'string' && lookup(a, val) !== undefined ? { ok: true, v: val } : bad;
      case 'int': return isInt(val, a, b) ? { ok: true, v: val } : bad;
      case 'text': {
        if (typeof val !== 'string') return bad;
        // eslint-disable-next-line no-control-regex
        const s = val.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
        return s.length >= 1 && s.length <= a ? { ok: true, v: s } : bad;
      }
      case 'enum': return typeof val === 'string' && spec.slice(1).includes(val) ? { ok: true, v: val } : bad;
      case 'list': {
        if (!Array.isArray(val) || val.length < 1 || val.length > b) return bad;
        const out = [];
        for (let i = 0; i < val.length; i++) {
          if (!(i in val)) return bad;
          const r = check(a, val[i]);
          if (!r.ok) return bad;
          out.push(r.v);
        }
        if (new Set(out.map((v) => JSON.stringify(v))).size !== out.length) return bad;   // distinct targets
        return { ok: true, v: out };
      }
      default: throw new Error(`schema: unknown validator ${kind}`);
    }
  }
  throw new Error('schema: bad spec');
}

/**
 * Parse action arguments against a schema.
 * @param {Record<string, any>} schema
 * @param {unknown} args
 * @returns {Record<string, any> | null}
 */
export function parseArgs(schema, args) {
  const a = args === undefined ? {} : args;
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return null;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.prototype && proto !== null) return null;
  for (const k of Object.keys(a)) if (!Object.hasOwn(schema, k) && k !== 'confirm') return null;   // extra keys reject
  const out = {};
  for (const [k, spec] of Object.entries(schema)) {
    const optional = spec !== null && typeof spec === 'object' && !Array.isArray(spec) && 'opt' in spec;
    if (!Object.hasOwn(a, k) || a[k] === undefined) {
      if (optional) continue;
      return null;
    }
    const r = check(optional ? spec.opt : spec, a[k]);
    if (!r.ok) return null;
    out[k] = r.v;
  }
  if (!Object.hasOwn(schema, 'confirm') && Object.hasOwn(a, 'confirm') && a.confirm !== undefined) {
    const r = check('confirm', a.confirm);
    if (!r.ok) return null;
    out.confirm = r.v;
  }
  return out;
}

/** True when the player already confirmed soft code `code` (RESERVED, PINNED, BIG_SPEND) for this action. */
export const confirmed = (args, code) => Boolean(args) && Array.isArray(args.confirm) && args.confirm.includes(code);

/** Throws when a schema uses an unknown validator; the registry test runs it over every action. */
export function assertSchema(schema) {
  if (!schema || typeof schema !== 'object') throw new Error('schema: not an object');
  for (const spec of Object.values(schema)) {
    const s = spec !== null && typeof spec === 'object' && !Array.isArray(spec) && 'opt' in spec ? spec.opt : spec;
    if (typeof s === 'string') check(s, undefined);
    else if (Array.isArray(s)) {
      if (!['content', 'int', 'text', 'enum', 'list'].includes(s[0])) {
        throw new Error(`schema: unknown validator ${s[0]}`);
      }
      if (s[0] === 'list') {
        if (!(Number.isSafeInteger(s[2]) && s[2] > 0)) throw new Error(`schema: bad list max ${s[2]}`);
        assertSchema({ item: s[1] });
        continue;
      }
      // V.int(5) (a missing hi) would silently reject everything
      if (s[0] === 'int' && !(Number.isSafeInteger(s[1]) && Number.isSafeInteger(s[2]) && s[1] <= s[2])) {
        throw new Error(`schema: bad int bounds ${s[1]}..${s[2]}`);
      }
      if (s[0] === 'text' && !(Number.isSafeInteger(s[1]) && s[1] > 0)) throw new Error(`schema: bad text max ${s[1]}`);
    } else throw new Error('schema: bad spec');
  }
}
