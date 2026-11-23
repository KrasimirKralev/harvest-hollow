// Recording transaction (FROZEN CONTRACT, tech-architecture §3.2).
//
// Rules never write the state directly: every write goes through a Tx, which records
//   ops   - the forward delta, broadcast to every client (`d.ops`) and replayable with applyOps()
//   undo  - the exact inverse, used for atomic rollback (server) and for rewinding predictions (client)
//   events- domain events ({ e: 'harvested', ... }) for progress.processEvents() and for the FX/UI layers
//
// Op shape (JSON, sent over the wire):  { o: 's', p: path, v: value }  set (value is deep-cloned)
//                                       { o: 'd', p: path }            delete
// A path is an array of own-property keys from the state root, e.g. ['farm', 'objects', 'k3x9a.2.0', 'crop'].
// Ops are coarse and idempotent (always set/delete, never "increment"), so a duplicated op is harmless.
//
// Strict parents: a write whose parent does not exist throws. If parents were created implicitly, an undo
// would leave an empty {} behind and the state would no longer round-trip.
//
// Order inside set()/del() is "validate first, then book-keep, then write" (§3.5): anything that can throw
// happens before the undo entry is recorded, otherwise rollback() would itself throw.
//
// Arrays are written WHOLE (review-m0 #1). A write whose direct parent is an array throws: the undo of an
// append is a delete, and `delete arr[n]` leaves a hole and the old length, which JSON turns into `null`, so
// server, snapshot and clients would hold different arrays. Write `tx.set([...,'queue'], [...q, item])`.
// Bounded logs (feed, notes) use the ledger's ring-object pattern, not arrays.
//
// Values are plain JSON (review-m0 #5): set() and emit() throw on Map, Set, Date, class instances, undefined,
// NaN, +-Infinity, -0, BigInt, functions, symbols and sparse arrays. The wire, the snapshot and the journal
// carry the JSON form, so anything else would make the server's state differ from every copy of it.
// set(path, undefined) throws: use del(path).
//
// Objects returned by get() are LIVE and READ-ONLY to rules: writing through them bypasses the recorder (no op,
// no undo). test/helpers.js run()/must() check every action's ops and undo round trip to catch that.
import { touchGrid } from './grid-cache.js';

const isObj = (v) => v !== null && typeof v === 'object';

function parentOf(root, path) {
  if (!Array.isArray(path) || path.length === 0) throw new Error('tx: empty path');
  let o = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isObj(o) || !Object.hasOwn(o, path[i])) throw new Error(`tx: no parent for ${path.join('.')}`);
    o = o[path[i]];
  }
  if (!isObj(o)) throw new Error(`tx: parent of ${path.join('.')} is not an object`);
  if (Array.isArray(o)) throw new Error(`tx: ${path.join('.')} writes inside an array; set the whole array`);
  return o;
}

/**
 * Throw unless `v` survives a JSON round trip unchanged (plain objects, dense arrays, finite non -0 numbers,
 * strings, booleans, null).
 * @param {unknown} v
 * @param {string} at  where the value goes (for the message)
 */
export function assertJson(v, at) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (Number.isFinite(v) && !Object.is(v, -0)) return;
    throw new Error(`tx: non-JSON number ${String(v)} at ${at}`);
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new Error(`tx: sparse array at ${at}`);
      assertJson(v[i], `${at}.${i}`);
    }
    return;
  }
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error(`tx: non-plain object at ${at}`);
    for (const k of Object.keys(v)) assertJson(v[k], `${at}.${k}`);
    return;
  }
  throw new Error(`tx: non-JSON ${typeof v} at ${at}`);   // undefined, bigint, function, symbol
}

/**
 * Own-key read at a path; undefined when any step is missing (never follows the prototype chain).
 * @param {object} root
 * @param {Array<string|number>} path
 */
export function getAt(root, path) {
  let o = root;
  for (const k of path) {
    if (!isObj(o) || !Object.hasOwn(o, k)) return undefined;
    o = o[k];
  }
  return o;
}

/**
 * Apply ops in order (server deltas, undo lists, test replays). Values are cloned, so the ops array can be
 * applied again later without aliasing the state.
 * @param {object} root
 * @param {Array<{o:'s'|'d', p:Array<string|number>, v?:any}>} ops
 */
export function applyOps(root, ops) {
  for (const op of ops) {
    const p = parentOf(root, op.p);
    const key = op.p.at(-1);
    if (op.o === 's') p[key] = structuredClone(op.v);
    else if (op.o === 'd') delete p[key];
    else throw new Error(`tx: bad op ${op.o}`);
    touchGrid(root, op.p);
  }
}

export class Tx {
  /** @param {object} state the live state object; writes land on it immediately */
  constructor(state) {
    this.state = state;
    /** @type {Array<{o:'s'|'d', p:Array<string|number>, v?:any}>} */
    this.ops = [];
    /** @type {Array<{o:'s'|'d', p:Array<string|number>, v?:any}>} in write order; use inverse() to undo */
    this.undo = [];
    /** @type {Array<{e:string}>} */
    this.events = [];
  }

  /** Own-key read through the transaction (sees this transaction's own writes). */
  get(path) { return getAt(this.state, path); }

  /** Set a value (deep-cloned, so rules can never alias state). The parent must exist. */
  set(path, value) {
    const parent = parentOf(this.state, path);
    assertJson(value, path.join('.'));
    const v = structuredClone(value);
    const key = path.at(-1);
    const prev = Object.hasOwn(parent, key) ? parent[key] : undefined;
    const p = path.slice();
    this.undo.push(prev === undefined ? { o: 'd', p } : { o: 's', p, v: structuredClone(prev) });
    parent[key] = v;
    this.ops.push({ o: 's', p, v: structuredClone(v) });
    touchGrid(this.state, path);
  }

  /** Delete a key. Deleting a missing key is a no-op (records nothing). */
  del(path) {
    const prev = getAt(this.state, path);
    if (prev === undefined) return;
    const parent = parentOf(this.state, path);
    const p = path.slice();
    this.undo.push({ o: 's', p, v: structuredClone(prev) });
    delete parent[path.at(-1)];
    this.ops.push({ o: 'd', p });
    touchGrid(this.state, path);
  }

  /**
   * Add `n` to an integer counter, emitted as a `set`. Throws (so the action rejects atomically) when the
   * result is not a non-negative safe integer. `dropZero` deletes the key at 0 and is ONLY for sparse maps
   * (inventory, overflow, stats): if wallet.coins vanished at 0, `coins < cost` would compare undefined and
   * let a purchase through.
   */
  inc(path, n, { dropZero = false } = {}) {
    if (!Number.isSafeInteger(n)) throw new Error(`tx: bad increment ${path.join('.')} += ${n}`);
    const cur = this.get(path) ?? 0;
    if (!Number.isSafeInteger(cur)) throw new Error(`tx: ${path.join('.')} is not an integer`);
    const next = cur + n;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error(`tx: bad counter ${path.join('.')}=${next}`);
    if (next === 0 && dropZero) this.del(path); else this.set(path, next);
  }

  /** Record a domain event: plain JSON with a string `e`, cloned (broadcast in `d.ev` after later writes). */
  emit(ev) {
    if (!isObj(ev) || typeof ev.e !== 'string') throw new Error('tx: an event needs a string `e`');
    assertJson(ev, `event ${ev.e}`);
    this.events.push(structuredClone(ev));
  }

  /** The undo ops in the order they must be applied (newest write first). */
  inverse() { return this.undo.slice().reverse(); }

  /** Restore the exact prior state and forget everything recorded. */
  rollback() {
    applyOps(this.state, this.inverse());
    this.ops = [];
    this.undo = [];
    this.events = [];
  }
}
