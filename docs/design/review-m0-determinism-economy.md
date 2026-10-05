# Review M0: determinism, Tx, rng, schema, ids, contracts vs GDD §3-§6

Adversarial review of the frozen M0 contracts before the seven lanes build on them. Scope: `shared/rules/**`,
`shared/content/index.js`, `shared/net/**`, plus the engine/sync code paths that exercise them. Reviewed at commit
`8bdd6f8` on 2026-10-02.

Every finding has a proof: a `node:test` file in `docs/design/review-m0-proofs/`. Each file asserts the **correct**
behaviour, so every test in it fails on M0 now. When a lane fixes a finding, it moves the matching test into its
own `test/*.test.js` as the regression test. These files sit outside `test/`, so `npm test` does not run them and
stays green: 92 pass, 0 fail, re-checked after writing them.

```
node --test docs/design/review-m0-proofs/*.proof.mjs     # today: tests 50, pass 0, fail 50
```

## Summary

| # | Sev | Finding | Where | Owner |
|---|---|---|---|---|
| 1 | **High** | Tx writes into arrays do not round-trip (holes, wrong `length`, `null` after a save) | `shared/rules/tx.js:80-102, 53-62` | rules |
| 2 | **High** | Rolls keyed on new object ids can be ground offline: the client picks `cid` and `seq` | `shared/rules/index.js:64-65`, `shared/net/ids.js:21`, `server/engine.js:63` | rules (+server) |
| 3 | **High** | No farm time zone exists in any contract, so "day", "week" and "season" cannot be computed the same everywhere | `shared/rules/index.js:60`, `state.js:36-58`, `system.js:43-49` | rules + lead |
| 4 | Medium | The exactly-once record resets to `lastSeq 0` (cid reuse by another pid, or the 24 h prune), so an applied action runs twice | `server/engine.js:42-51`, `server/sessions.js:105` | server |
| 5 | Medium | `Tx.set` and `Tx.emit` accept non-JSON values (Map, Set, Date, NaN, ±Infinity, -0, sparse arrays, BigInt); `emit` aliases state | `shared/rules/tx.js:80-90, 120` | rules |
| 6 | Medium | Writes through `tx.get()` or `check(state)` are unrecorded, and nothing (runAction, `must()`) detects them | `shared/rules/tx.js:77`, `test/helpers.js:63-72` | rules + lead |
| 7 | Medium | Object key order differs between live, replay and client after a rollback or rewind, so order-dependent rules diverge | `shared/rules/tx.js:126`, `public/js/net/sync.js:185` | rules (rule + helper) |
| 8 | Medium | Implementation-approximated float math (`**`, `Math.pow/exp/log`) is allowed in rules, and the GDD price formulas use it | `test/purity.test.js:21-31` | lead (purity) + content |
| 9 | Medium | The grid has only two layers: GDD animals-in-homes either crash `getGrid` or break the overlap invariant | `shared/rules/grid.js:50`, `state.js:99-112` | rules + content |
| 10 | Medium | Journal lines carry no grace or content/rules version; a line that fails replay silently drops every later action | `server/engine.js:105-107, 127-131`, `server/index.js:39-48` | server (+rules export) |
| 11 | Medium | Soft confirm only works if each purchase action declares `confirm` itself; `place` (a BIG_SPEND purchase) does not | `shared/rules/schema.js:82-100`, `actions/farming.js:30` | rules |
| 12 | Low | `regenValue` loses a unit when `now < at` (client clock a few ms behind) | `shared/rules/time.js:39, 45` | rules |
| 13 | Low | Content Maps are mutable by any importer | `shared/content/index.js:115-124` | content |
| 14 | Low | `place` sells `retired` defs | `shared/rules/actions/farming.js:31-39` | rules |
| 15 | Low | rng: a number key and a string key can hash the same | `shared/rules/rng.js:27-40` | rules |
| 16 | Low | `validateState` is permissive: unknown fields, duplicate expansions, bad ledger rows and player fields all pass | `shared/rules/state.js:74-134` | rules |
| 17 | Low | `ctx` and `ctx.ext` are mutable; `ext` is journaled by reference | `shared/rules/index.js:60-67`, `server/engine.js:66-78` | rules |
| 18 | Low | `makeCid` is biased (`byte % 36`: chars 0-3 are drawn 14 % more often) | `shared/net/ids.js:16` | server |
| 19 | Low | Level-up coin rewards count as `coins.earned` (GDD §5.4: only sales, orders, barge, Fair, quests) | `shared/rules/progress.js:26`, `economy.js:19` | rules (designer to confirm) |

**Counts: High 3, Medium 8, Low 8 (19 findings).**

Fix #1, #2, #3, #5, #9 and #11 **before** the lanes start. Each one decides a shape or rule that queues, animals,
daily systems and purchases are about to be written against. The others can land in the first rules-lane pass.

---

## 1. High: Tx writes into arrays do not round-trip

**Where:** `shared/rules/tx.js:80-90` (`set`), `:93-102` (`del`), `:53-62` (`applyOps`).

**What:** `parentOf` accepts an array as the parent, so `tx.set([..., 'queue', q.length], item)` (the natural
"push") and `tx.del([..., 'queue', 0])` are both legal. The undo of an append is `{o:'d'}`, which runs
`delete arr[n]`. That leaves `length` at n+1 and a hole in the array. Deleting an element also leaves a hole. JSON then
turns the hole into `null`, so the live server, its snapshot, the clients and the rebased client all hold different
arrays. A `q.at(-1).e` on the client then throws only there. GDD queues (§3.5 rules 1-3), order slots (§5.2, which grow
from 3 to 9), notes and the feed are all arrays in the planned shapes (tech §2.2-2.3). The lanes about to write them
will reach for exactly these writes.

**Proof:** `node --test docs/design/review-m0-proofs/01-tx-arrays.proof.mjs`
```
after rollback: length 2 JSON [{"r":"bread","s":1,"e":2},null]
after undo: [ 1, 2, <1 empty item> ] JSON {"a":[1,2,null]}
after del: [ <1 empty item>, { r: 'y' } ] JSON [null,{"r":"y"}]
✖ append to a queue array, then rollback, restores the exact array (length included)
✖ client rebase (undo ops) of an append restores the array
✖ deleting an array element does not leave a hole that JSON turns into null
```

**Fix (tx.js, internal; exported API unchanged):** refuse every write whose direct parent is an array. Arrays are
then always written whole, which is the coarse-op rule tech §3.2 already states ("whole `queue` array").
```js
function parentOf(root, path) {
  ...
  if (!isObj(o)) throw new Error(`tx: parent of ${path.join('.')} is not an object`);
  if (Array.isArray(o)) throw new Error(`tx: ${path.join('.')} writes inside an array; set the whole array`);
  return o;
}
```
`parentOf` is shared by `set`, `del` and `applyOps`, so all three are covered. Rules then write
`tx.set([...,'queue'], [...q, item])`. Bounded logs (`farm.feed`, notes) should use the ledger's ring-object pattern,
not arrays. Add `test/tx.test.js` cases "a write inside an array throws and records nothing". Document the rule in the
`tx.js` header, and add it to `common.md` "Decisions from M0".

**Resolution (fixed):** `tx.js` `parentOf` refuses any write whose parent is an array, which covers `set`, `del` and `applyOps`. Rule documented in the `tx.js` and `index.js` headers and in `common.md`. Regression test: `test/tx.test.js` "a write or delete inside an array throws and records nothing". The proof now throws at its in-array `set`, by design.

---

## 2. High: client-chosen ids make rolls on new objects grindable

**Where:** `shared/rules/index.js:64-65` (`newId`, `rng`), `shared/net/ids.js:21-23`,
`server/engine.js:63` (any `seq > lastSeq` is accepted), `shared/net/protocol.js:125` (the client picks `cid`).

**What:** `newId = cid.seq36.i`. The client chooses `cid` at `hello` (any `/^[a-z0-9]{5,8}$/`) and may jump `seq` to
any value above `lastSeq`. `farmSeed` is replicated in `welcome`, and the rules are shared code. So any roll keyed
on a new object's id can be computed offline and forced. The obvious way to write the GDD's chance mechanics with
`ctx.rng(..., ctx.newId(0))` is exactly that kind of roll: Breeding Barn coats (golden 5 %, §3.4), collection drops (2 %, §5.5) and
golden orders (§5.2, safe only while they are system-created). Tech §2.9 accepts that a roll can be *previewed*. It
did not consider that the key itself can be *chosen*.

**Proof:** `node --test docs/design/review-m0-proofs/02-rng-grinding.proof.mjs`
```
seq 1 -> accepted | seq 987654 -> accepted | lastSeq 987654
golden coat guaranteed with seq=29 after 29 offline tries (roll=0.0418)
```

**Fix:**
1. A contract rule, written in the `index.js` and `rng.js` headers: **rng keys come only from replicated state that
   the server orders**, such as an object's `cycle`, a farm counter or `farm.pity`. Never use `ctx.newId(i)`,
   `ctx.cid`, `ctx.seq`, `ctx.now` or any arg. For a roll on a brand-new object, key it on a farm counter bumped in
   the same tx: `const n = tx.get(['farm','rolls','coat']) ?? 0; tx.inc(['farm','rolls','coat'], 1); ctx.rng('coat', n)`.
   `farm.rolls` is a new sparse map (createFarm + validateState).
2. Enforce it in `makeCtx` (internal):
   ```js
   rng: (...keys) => {
     const mine = `${cid}.${seq.toString(36)}.`;
     for (const k of keys) {
       if (k === now || k === seq || (typeof k === 'string' && (k === cid || k.startsWith(mine)))) {
         throw new Error('rng: client-chosen key');
       }
     }
     return roll(seed, ...keys);
   },
   ```
3. Defence in depth (server lane): refuse `seq > lastSeq + LIMITS.MAX_PENDING + 1` with `BAD_ARGS`. Do not
   require strictly contiguous seqs: replay rebuilds `lastSeq` from accepted actions only, so legitimate gaps
   exist after a restart.

**Resolution (fixed: guard and contract; part 3 refuted):** `makeCtx().rng` throws on the cid and on any key starting with this action's `${cid}.${seq36}.`, and the rule is in the `rng.js` and `index.js` headers. New sparse counters `farm.rolls` (schema 2) give rolls on new objects a server-ordered key. Part 3 (a seq window) is refuted: the cid is chosen freely at hello, so a window does not stop grinding (a 5 % roll needs about 20 tries, inside any window). A window could also lock out a legitimate client whose seqs moved ahead through rejections that replay does not rebuild. Regression test: `test/rules.rng.test.js`. Proof test 1 (seq jumps) still fails by design; test 2 is offline arithmetic, and the guard now stops it from reaching a rule.

---

## 3. High: no farm time zone exists in the contracts

**Where:** `shared/rules/index.js:60-67` (ctx has no zone), `shared/rules/state.js:36-58` (meta has no zone),
`shared/rules/system.js:43-49` (`dueSystemActions(state, now)`, which tech §15.1 specifies as `(state, now, tz)`).
`server/config.js:19` reads `HH_TZ`, but the value never reaches `shared/`.

**What:** Several GDD rules depend on the local calendar: period counters (daily Hearts and thanks caps, first gift
per day, Market Demand's first 50 units per day), the daily gift calendar, the streak, the Almanac, Market Week,
Fair and barge weeks (§5.2, §5.6-5.8, §6.2), and the season used at planting (−10 % grow time, fixed into
`readyAt`, §3.1 rule 7). Client prediction, the server and journal replay must compute them identically. Today a rule
cannot know the farm's zone. A rules author falls back on the browser's zone (or UTC). The partner's client then
predicts a different day or season, and with Market Demand or caps, money changes.

**Proof:** `node --test docs/design/review-m0-proofs/04-no-timezone.proof.mjs`
```
dayIndex of one instant: { server_Sofia: 20729, client_UTC: 20728, client_NY: 20728 }
{ ctxKeys: [now, pid, cid, seq, ext, grace, newId, rng], metaKeys: [farmSeed, createdAt, version, contentHash],
  dueSystemActionsArity: 2, nextSystemDueAtArity: 2, sharedMentionsTimeZone: false }
```

**Fix (additive; no frozen signature changes):**
1. `state.meta.tz` (IANA name). `createFarm(farmSeed, now, tz = 'Europe/Sofia')`: an optional third parameter is
   additive, and the server passes `cfg.tz`. `validateState` checks that it is a string accepted by
   `Intl.DateTimeFormat`. Migration (server lane): set it on existing saves.
2. A new `shared/rules/calendar.js` (pure; `Intl` is not banned):
   ```js
   const fmt = new Map();
   function parts(now, tz) {
     let f = fmt.get(tz);
     if (!f) {
       f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' });
       fmt.set(tz, f);
     }
     return Object.fromEntries(f.formatToParts(now).map((p) => [p.type, Number(p.value)]));
   }
   export function dayIndex(now, tz) {
     const p = parts(now, tz);
     return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
   }
   export const weekIndex = (day) => Math.floor((day + 3) / 7);          // Monday-start (tech §4.5)
   export function seasonOf(now, tz) {
     return ['winter', 'spring', 'summer', 'autumn'][Math.floor((parts(now, tz).month % 12) / 3)];
   }
   ```
   Add `/\bDate\.UTC\s*\(/` to the allowed list explicitly. It is pure, and the purity test already only bans
   `Date.now`, `new Date(` and `Date()`.
3. `dueSystemActions` and `nextSystemDueAt` read `state.meta.tz`, so their signatures stay as they are. Rules call
   `dayIndex(ctx.now, state.meta.tz)`. Document this in the `index.js` header.

**Resolution (fixed):** `state.meta.tz` (IANA) is set from `HH_TZ` (validated in `server/config.js`, applied at boot) through `createFarm(seed, now, tz?)`, checked by `validateState`, and added to old saves by the 1 -> 2 migration. `shared/rules/calendar.js` provides `dayIndex`, `weekIndex` (Monday start) and `seasonOf`. `dueSystemActions` reads `state.meta.tz`, so its signature is unchanged. Regression tests: `test/rules.calendar.test.js`, including the migration of `test/fixtures/save-v1.json`. Proof test 1 asserts that three different zones agree on the day, which no contract can make true: the fix makes the farm's one zone the only input. Test 2 passes.

---

## 4. Medium: the exactly-once record can be reset, so an action runs twice

**Where:** `server/engine.js:44` (`c[cid].pid !== pid` → a fresh record with `lastSeq: 0`), `:50` (24 h prune),
`server/sessions.js:105` (`hello` calls `engine.client(m.cid, pid)` with the client-chosen cid).

**What:** A hello carrying p1's cid but authenticated as p2 replaces p1's dedupe record. A buggy client can do
this; so can a tool that reuses a fixed cid, or a deliberate attempt. A tab that sleeps more than 24 h loses its
record to the prune. In both cases `welcome.lastSeq` is 0, so `SyncStore.reset()` re-sends every pending action
whose ack was lost, and the server **runs them again**. That breaks the exactly-once rule (tech §3.7, §7 rule 7).

**Proof:** `node --test docs/design/review-m0-proofs/03-dedupe-reset.proof.mjs`
```
re-sent seq 9 -> ACCEPTED AGAIN | coins once 304 | now 320
lastSeq after prune + hello: 0
```

**Fix (server lane, plus one additive welcome field):**
1. `engine.client(cid, pid, now)`: if a record exists for a **different** pid, return `null`. `sessions.hello`
   then answers `deny BAD_HELLO`. Never overwrite a record.
2. `welcome.known` (boolean, additive) is true when the cid's record existed before this hello.
   `SyncStore.reset(w)`: if `!w.known && this.seq > 0`, drop `pending` instead of re-sending it, and emit a
   one-time "some recent actions may not have been saved" notice. The outcome is unknowable, and never applying
   twice is the safe side.
3. Raise `CID_TTL_MS` to 7 days. Records are about 50 bytes each.

**Resolution (fixed):** `Engine.client` never overwrites a record bound to another pid; it returns null. `sessions.hello` checks this before a claim runs and answers `deny BAD_HELLO`. `welcome.known` is false only for a cid with no record, and `SyncStore.reset` then drops pending actions (new event `lost`) instead of re-sending them. `CID_TTL_MS` is 7 days, and a connected cid is never pruned (also sync M1). Regression tests: `test/server.review.test.js` (re-binding, TTL, known flag) and `test/sync.test.js` ("a welcome for an unknown cid drops pending actions"). Proof 03 passes.

---

## 5. Medium: Tx accepts non-JSON values; emit aliases state

**Where:** `shared/rules/tx.js:80-90` (`set` only runs `structuredClone`, which keeps Map, Set, Date, NaN, -0,
holes and BigInt), `:120` (`emit` pushes the caller's object by reference).

**What:** The server keeps the value. The wire, the snapshot and the journal carry its JSON form, which is
different: `{}`, a string, `null`, `0`. A BigInt makes `JSON.stringify(state)` throw, so every later broadcast and
**every snapshot** fails, and the farm can no longer be saved. An event built from a live object changes after it
is emitted.

**Proof:** `node --test docs/design/review-m0-proofs/06-tx-non-json.proof.mjs`
```
map: server keeps Map(1) { 'egg' => 2 } | client receives {}
set: server keeps Set(1) { 'p1' } | client receives {}
date: server keeps 1970-01-01T00:00:00.000Z | client receives 1970-01-01T00:00:00.000Z   (a Date vs a string)
nan: server keeps NaN | client receives null
inf: server keeps Infinity | client receives null
negZero: server keeps -0 | client receives 0
sparse: server keeps [ 1, <1 empty item>, 3 ] | client receives [ 1, null, 3 ]
JSON.stringify(state) -> Do not know how to serialize a BigInt
event says crop = null
```

**Fix (tx.js, internal):** validate before bookkeeping, keeping the §3.5 order.
```js
function assertJson(v, at) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (Number.isFinite(v) && !Object.is(v, -0)) return;
    throw new Error(`tx: non-JSON number ${v} at ${at}`);
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new Error(`tx: sparse array at ${at}`);
      assertJson(v[i], `${at}.${i}`);
    }
    return;
  }
  if (typeof v === 'object') {
    const p = Object.getPrototypeOf(v);
    if (p !== Object.prototype && p !== null) throw new Error(`tx: non-plain object at ${at}`);
    for (const k of Object.keys(v)) assertJson(v[k], `${at}.${k}`);
    return;
  }
  throw new Error(`tx: non-JSON ${typeof v} at ${at}`);          // undefined, bigint, function, symbol
}
set(path, value) { const parent = parentOf(this.state, path); assertJson(value, path.join('.')); ... }
emit(ev) { assertJson(ev, `event ${ev && ev.e}`); this.events.push(structuredClone(ev)); }
```
`set(path, undefined)` then throws: use `del`.

**Resolution (fixed):** `assertJson` (exported from `tx.js`) runs in `set` and `emit` before any bookkeeping. `emit` stores a clone and needs a string `e`. Regression tests: `test/tx.test.js` (13 refused value kinds, emit clone). Proof 06: all 8 `set` cases and the emit case pass. The BigInt case now throws at `set` (the proof calls it outside a try), by design.

---

## 6. Medium: unrecorded writes through live references go unnoticed

**Where:** `shared/rules/tx.js:77` (`get` returns live objects), `check(state, ...)` receives the live state,
`test/helpers.js:63-72` (`run`/`must` only run the action).

**What:** `tx.get([...]).cycle += 1` changes the server's state without an op or an undo entry. Clients never see the
change, rollback cannot restore it, and a later journal replay or welcome makes it appear or vanish. Seven authors
writing dozens of actions will make this slip at least once. Today nothing would fail.

**Proof:** `node --test docs/design/review-m0-proofs/07-unrecorded-writes.proof.mjs`
```
server cycle 1 | client cycle 0
after rollback cycle 1 (was 0 )
✖ the shared test helpers verify every action round-trips (must() has no applyOps / inverse check)
```

**Fix:**
1. Lead, in `test/helpers.js` `run()`: for every `ok` result, check the round trip, so every lane's tests catch
   this for free:
   ```js
   export function run(state, type, args, o = {}) {
     const before = plain(state);
     const r = runAction(state, { type, args }, makeCtx(state, { ... }));
     if (r.ok) {
       const fwd = structuredClone(before);
       applyOps(fwd, JSON.parse(JSON.stringify(r.tx.ops)));
       assert.deepEqual(fwd, plain(state), `${type}: state changed outside tx.ops`);
       const back = structuredClone(state);
       applyOps(back, r.tx.inverse());
       assert.deepEqual(plain(back), before, `${type}: undo does not restore`);
     } else {
       assert.deepEqual(plain(state), before, `${type}: a rejected action changed state`);
     }
     return r;
   }
   ```
2. Add a rule to the `index.js` header: objects read from `state` or `tx.get` are read-only, and every change goes
   through `tx.set/del/inc`.

**Resolution (fixed: detection):** `test/helpers.js` `assertRecorded` runs inside `run()`, `must()` and `sys()`. Every accepted action must replay from its wire-format ops and undo exactly, and a rejected action must change nothing. The rule is in the `tx.js` and `index.js` headers. Refusing such writes at the source would need a proxy on every read on the hot path, so detection in every lane's tests was chosen instead. On its first run the check caught a real harness gap: a symbol-keyed grid cache left in comparisons. Regression test: `test/tx.test.js` "assertRecorded (run/must) fails an action that writes through a live reference". Proof test 1 still fails by design (a raw write is invisible to the Tx). Test 2 greps `must`'s source, but `must` now checks through `run`.

---

## 7. Medium: key order diverges between live, replay and client

**Where:** `shared/rules/tx.js:126` (`rollback` re-adds deleted keys at the end), `public/js/net/sync.js:185-201`
(rewind and replay do the same on the client). Journal replay never sees rejected actions.

**What:** After an INTERNAL rollback, or a client prediction that the server rejects, keys come back in a different
order. Values are equal, so the current tests pass. Any rule that lets iteration order decide breaks: feed-mill
"cheapest available member first" ties (§3.3), "Sell surplus: the 20 lowest-value stacks" (§3.6), "first ready
building", or the slot order inside `dueSystemActions`. Such a rule decides differently live, after a restart,
and on the client.

**Proof:** `node --test docs/design/review-m0-proofs/08-key-order.proof.mjs`
```
sell -> INTERNAL | live inventory keys [ 'carrot', 'wheat' ]
replayed inventory keys [ 'wheat', 'carrot' ]
an order-dependent rule ("first stack") picks carrot live and wheat after restart
server [ 'wheat', 'carrot' ] { wheat: 1, carrot: 3 } | client A [ 'carrot', 'wheat' ] { carrot: 3, wheat: 1 }
```

**Fix:** ordering cannot be made to round-trip cheaply, so make it irrelevant.
1. Contract rule in the `index.js` header: no decision may depend on `Object.keys/values/entries` or `for…in`
   order of a state map. Sort first: by key, or by a stored field with the key as tie-break.
2. Helper (rules lane, `shared/rules/order.js`):
   ```js
   export const sortedKeys = (o) => Object.keys(o).sort();
   export const sortedEntries = (o) => sortedKeys(o).map((k) => [k, o[k]]);
   ```
3. Fuzz guard (rules lane, `test/invariants.test.js`): run each action on `s` and on `reverseKeys(s)` (every plain
   object rebuilt with its keys reversed), and assert the results deep-equal. `assert.deepEqual` ignores key order,
   so it compares values only, and it catches any order-dependent rule.

**Resolution (mitigated; "make it round-trip" refuted as stated):** key order cannot be replicated cheaply, so it is made irrelevant. Rule 3 in the `index.js` header, `shared/rules/order.js` (`sortedKeys`, `sortedEntries`, `byThenKey`), and `test/invariants.test.js`, which runs 20 x 120 random actions each against a key-reversed twin and asserts the same outcome, events and values. Both proof tests still show the order difference, which is expected: no rule may depend on it.

---

## 8. Medium: implementation-approximated float math is allowed in rules

**Where:** `test/purity.test.js:21-31` (no ban), and the GDD formulas: tree price × 1.35^(n−1) (§3.2 rule 1),
animal price × 1.1^(n−1) (§3.4 rule 2), hive 2,300 × 1.1^(n−1), and percentages throughout.

**What:** ECMAScript lets `**`, `Math.pow`, `exp`, `log` and the trig functions return results that differ in the
last bit between engines. The partner may run Firefox or Safari while the server runs V8. Prices of whole coins
come from `Math.round/floor/ceil` of such floats. The proof shows how close to the edge they sit: two valid
evaluations of the same GDD formula already give different integer prices on V8 alone. A last-bit difference
between engines does the same, so the client predicts one price and the server charges another. Also,
`progress.js:39` uses `xp * 0.4` instead of the basis points that tech §2.1 rule 3 requires. It is exact today but
sets the wrong example.

**Proof:** `node --test docs/design/review-m0-proofs/09-float-pow.proof.mjs`
```
529 of 680 values differ in the last bits between p*g**k and repeated *g
ceil(6800 x 1.35^2): pow=12393.000000000002 loop=12393
ceil(1900 x 1.1^2): pow=2299.0000000000005 loop=2299
ceil(2300 x 1.1^2): pow=2783.0000000000005 loop=2783
✖ the purity scanner bans implementation-approximated Math in shared/
```

**Fix:**
1. Lead, `test/purity.test.js`: for files under `shared/rules/**` and `shared/content/**`, add the banned patterns
   `/\*\*|Math\.(pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|cbrt|hypot)\s*\(/`,
   `/\.(toLocaleString|localeCompare)\s*\(|Intl\.(Collator|NumberFormat)/`. `shared/net/interp.js` keeps its float
   math: it is cosmetic and never feeds a rule.
2. Content lane: n-th-copy prices become integer ladders in the content tables, generated offline
   (`prices: [4900, 6615, 8930, ...]`). Alternatively, use an integer basis-point step in `shared/rules/economy.js`:
   ```js
   export function grow(base, bp, n) {        // base x (1 + bp/10000)^(n-1), floored every step: integers only
     let p = base;
     for (let k = 1; k < n; k++) p = Math.floor((p * (10_000 + bp)) / 10_000);
     return p;
   }
   ```
3. `progress.js:39`: `Math.floor((xp * 4000) / 10_000)`.

**Resolution (fixed):** `test/purity.test.js` bans `**`, `Math.pow/exp/log*/trig/hypot/cbrt` and locale functions in `shared/rules` and `shared/content`. `economy.grow(base, bp, n)` gives integer n-th copy prices, and `progress.js` splits personal XP in basis points. Regression tests: purity scanner test, and `grow` in `test/rules.contracts.test.js`. Proof test 2 passes. Test 1 is an arithmetic fact about float evaluation and still "fails"; the content lane must use `grow()` or integer ladders.

---

## 9. Medium: the grid cannot express "animals live in their home"

**Where:** `shared/rules/grid.js:45-50` (`grid[def.layer]` exists only for `object` and `ground`),
`shared/rules/state.js:99-112` (overlap invariant per layer), `canPlace`.

**What:** GDD §3.4 rule 1 says animals live in their home building (capacity 6→12 and so on). Tech §2.3 draws an
animal as its own object "on its home tile". With the frozen grid, a third layer crashes `getGrid`. An animal on
the `object` layer inside its coop fails `validateState` (overlap) and `canPlace` (`BLOCKED`). The animals lane
will hit this on day one and has to invent a shape. Tending, feeding and the "tend every animal under the stroke"
input all key off this decision.

**Proof:** `node --test docs/design/review-m0-proofs/10-content-grid.proof.mjs`
```
getGrid with a third layer -> Cannot set properties of undefined (setting '1940')
validateState -> [ 'objects.zz.2.0 overlaps zz.1.0 at 31,27' ] | canPlace(hen in coop) -> BLOCKED
```

**Fix (a decision for lead + rules + content, before the lanes start):**
- Animals stay flat in `farm.objects`, so `objId`, `objectOf`, coarse ops and `lastToucher` all keep working. They
  carry `home: <homeObjId>`, and their content def has `layer: 'none'` and no `size`.
- `grid.js:47`: `if (!def || def.layer === 'none') continue;`. In `state.js`, skip the footprint and overlap checks
  for `layer: 'none'`, and instead check that `home` exists, that its def houses that species, and that the
  occupants are within capacity. `canPlace` is not used for animals. `buyAnimal {home, species}` checks capacity.
- The renderer derives animal positions from the home (deterministic wander, GDD §3.4 rule 10). Moving a home then
  needs no animal ops. Removing an occupied home is refused (`OCCUPIED`).
- `validateContent`: allow `layer: 'none'` only for `kind: 'animal'`.

**Resolution (fixed, the shape proposed here):** placeables with `layer: 'none'` (kind `animal` only, no `size`, `homes: [defId]`) live flat in `farm.objects` with `home: <objId>`. `getGrid` skips them and `canPlace` refuses them (`BAD_ARGS`). `validateState` checks the home exists, can house the species and is within `grid.capacityOf()` (extend this one function for upgrades); `grid.occupantsOf` is sorted. `content.placeableProblems()` validates such defs. Regression test: `test/rules.contracts.test.js` "animals live in their home". The proofs use `PLACEABLES.set`, which now throws (#13), and an invented third layer, so they fail by design.

---

## 10. Medium: replay is not tied to the code that wrote the journal

**Where:** `server/engine.js:107` (the journal line is `{v, now, pid, cid, seq, type, args, ext}`: no `grace`,
no hash), `:129` (replay hard-codes the *current* `SERVER_GRACE_MS`), `server/index.js:39-48` (on failure:
incident, `break`, and the server keeps serving). `CONTENT_HASH` (`shared/content/index.js:188`) covers tables
and config only, not rules code.

**What:** After a crash, a restart on newer code replays old lines with new rules. The first line that no longer
applies stops replay. Every later accepted action that the players saw is silently lost. The incident holds only
the failing line, and the next snapshot deletes the rest of the journal. Open tabs whose content hash still
matches keep predicting with the old rules.

**Proof:** `node --test docs/design/review-m0-proofs/11-replay-versioning.proof.mjs`
```
journal line: {"v":3,"now":1790000000000,"pid":"p1","cid":"aaaaaa","seq":1,"type":"plant","args":{...},"ext":{}}
live v6, booted v3, replayed 1/4, incidents: ...-replay-failed.json
live coins 302 | booted coins 297 | plot home.0.1 crop live true booted false
```

**Fix:**
1. Rules lane (additive): `export const RULES_VERSION = 1;` in `shared/rules/index.js`, bumped whenever a rule's
   outcome changes. Content lane: hash it into `CONTENT_HASH`, so open tabs reload.
2. Server lane: journal `grace` (like `ext`) and `h: CONTENT_HASH`. Replay with `line.grace`. At boot, if any line's
   `h` differs from the current hash, log it, copy the whole unreplayed journal into `incidents/`, and continue only
   with `HH_REPLAY_ANYWAY=1`. Otherwise refuse to start, with a message telling the owner to start the previous
   build once (it snapshots at boot). On a replay failure, also copy **all remaining lines** into the incident, not
   only the failing one.

**Resolution (fixed, one deviation):** `shared/rules/version.js` `RULES_VERSION` is hashed into `CONTENT_HASH`. Journal lines record `grace` and `h`, and replay uses `line.grace`. A line that fails to replay quarantines the snapshot and every journal file into `incidents/<ts>-replay/`, and the boot is refused unless `HH_REPLAY_ANYWAY=1` (sync H2). Deviation: a line whose `h` differs but that still replays is accepted with a warning. Refusing it would block every dev restart after a `kill -9` even when nothing is lost; the failure path is the one that loses data. Regression tests: `test/persist.test.js` (journaled grace decides replay; quarantine and refusal; anyway-boot). Proof test 1 passes. In test 2 the boot is now refused (`loadFarm` throws), by design.

---

## 11. Medium: the soft-confirm round trip depends on each action's own schema

**Where:** `shared/rules/schema.js:82-100` (extra keys reject), `shared/rules/actions/farming.js:30` (`place` has
no `confirm`). Tech §15.2.

**What:** BIG_SPEND covers *any purchase* (GDD §6.3): place, expand, animals, trees, slot and barn upgrades, jars.
The client's "Yes, buy it" resend carries `confirm: ['BIG_SPEND']`. Every purchase action whose author forgot
`confirm: V.opt(V.confirm)` refuses it with `BAD_ARGS`, so the player hits a dead end. The registry test cannot
catch this, because `check` returns soft codes dynamically. `check` can return only a bare code, so the client
must derive the dialog text itself (who reserved, how much).

**Proof:** `node --test docs/design/review-m0-proofs/12-soft-confirm.proof.mjs`
```
place + confirm -> BAD_ARGS
player actions without confirm: [ 'harvest', 'place', 'plant', 'sell' ]
```

**Fix (schema.js, additive behaviour, same signature):** make `confirm` an envelope argument that every action
accepts:
```js
export function parseArgs(schema, args) {
  ...
  for (const k of Object.keys(a)) if (!Object.hasOwn(schema, k) && k !== 'confirm') return null;
  ...
  if (!Object.hasOwn(schema, 'confirm') && a.confirm !== undefined) {
    const r = check('confirm', a.confirm);
    if (!r.ok) return null;
    out.confirm = r.v;
  }
  return out;
}
export const confirmed = (args, code) => Array.isArray(args.confirm) && args.confirm.includes(code);
```
Add to the `index.js` header: the dialog's details (reserver, amount) come from shared pure helpers over the
client's state, never from `rej`.

**Resolution (fixed):** `parseArgs` accepts `confirm` as an envelope argument for every action, `confirmed(args, code)` is exported, and rule 7 is in the `index.js` header. `assertSchema` also rejects `['int', lo, hi]` without both bounds (an observation below). Regression test: `test/rules.contracts.test.js` "confirm is an envelope argument". Proof test 1 passes. Test 2 looks for `confirm` in every schema, which the envelope makes unnecessary.

---

## 12. Low: `regenValue` goes backwards when `now < at`

**Where:** `shared/rules/time.js:39`, `:45`.

**What:** `Math.floor((now - r.at) / period)` is −1 for a client whose clock estimate is a few ms behind the server
that wrote `at`. The value shows one less, and a local check refuses a spend the server would accept.

**Proof:** `node --test docs/design/review-m0-proofs/05-regen-negative.proof.mjs`
```
stored 5, client sees 4
stored 1, local check sees 0 -> a 1-unit spend is refused locally (would pass on the server)
regenSpend(.., n=0) -> { amount: 0, at: 940000 }
```

**Fix:** use `const elapsed = Math.max(0, now - r.at);` in both functions, replacing `now - r.at`.

**Resolution (fixed):** `Math.max(0, now - r.at)` in `regenValue` and `regenSpend`. Regression test: `test/rules.contracts.test.js`. Proof 05 passes.

---

## 13. Low: content Maps are writable by any importer

**Where:** `shared/content/index.js:115-124`. `Object.freeze` on `CONTENT` does not freeze the Maps inside it.

**What:** A stray `CONTENT.crops.set(...)` or `PLACEABLES.delete(...)` in any lane (for example a renderer
"patching" a def) silently changes the rules on one side only.

**Proof:** `10-content-grid.proof.mjs` → `CONTENT.crops.set threw? false | wheat.sell is now 999`.

**Fix (content lane, internal):**
```js
const readOnly = (m) => {
  for (const k of ['set', 'delete', 'clear']) {
    Object.defineProperty(m, k, { value: () => { throw new TypeError('content is read-only'); } });
  }
  return Object.freeze(m);
};
const mapOf = (list) => readOnly(new Map(list.map((d) => [d.id, deepFreeze(d)])));
export const PLACEABLES = readOnly(new Map([...CONTENT.plots]));
```

**Resolution (fixed):** every content Map and `PLACEABLES` has throwing `set/delete/clear` and is frozen. Tests that need fixture defs call `Map.prototype.set.call` on purpose. Regression test: `test/rules.contracts.test.js`. Proof test 1 passes.

---

## 14. Low: `place` sells retired defs

**Where:** `shared/rules/actions/farming.js:31-39`. `plant` checks `retired`; `place` does not. Tech §2.1 rule 4
says "cannot be bought".

**Proof:** `10-content-grid.proof.mjs` → `place retired def -> ACCEPTED`.

**Fix:** in `place.check`, `if (def.retired) return ERR.LOCKED;`. Do **not** put this in `canPlace`: moving an
existing retired object must keep working. Every future buy action gets the same line. The registry test can
assert it by running each buy action against a retired fixture def.

**Resolution (fixed):** `place.check` returns `LOCKED` for a retired def (rule 8 in the `index.js` header). Regression test: `test/rules.contracts.test.js`. The proof inserts its fixture with `PLACEABLES.set`, which now throws (#13).

---

## 15. Low: rng number and string keys can collide

**Where:** `shared/rules/rng.js:27-40`. A number mixes `(lo, hi)`. A one-char string mixes
`(0x40000000|1, charCode)`. So `n = charCode·2³² + 0x40000001` hashes exactly like that string.

**Proof:** `13-low.proof.mjs` → `hash32(516469817345) = 132031134 | hash32('x') = 132031134`.

**Fix (do it now, while no roll is in use):** in the number branch, start with a type tag that a string length tag
can never equal: `h = mixInt(h, 0x20000000);` before the two halves. Pin the new values with a golden test
(`hash32(1, 'a', 2) === <value>`), so the hash can never change by accident later.

**Resolution (fixed):** numbers mix a `0x20000000` type tag first. Golden values are pinned in `test/rules.rng.test.js`, which also checks the collision. Proof test passes.

---

## 16. Low: `validateState` is permissive

**Where:** `shared/rules/state.js:74-134`.

**What:** It does not report unknown fields, duplicate expansions, ledger rows, `obj.by`, `crop.by` or
`crop.cycle`, player `color`, `joinedAt` or `lastSeenAt`, or `meta.contentHash` and `meta.createdAt`. The
state-shape protocol in `common.md` relies on `validateState` to catch drift from seven lanes, and as written it
catches none of these.

**Proof:** `13-low.proof.mjs` plants seven problems; `validateState problems: []`.

**Fix:** export `FARM_KEYS`, `PLAYER_KEYS` and `META_KEYS` (sets) from `state.js`, and report any key outside them,
so a lane adding a field must add it there plus to `createFarm`. Also check: `new Set(expansions).size ===
expansions.length`; each ledger row is `{at: count, by: string, n: safe int, reason: string}` under a key
`< LEDGER_MAX`; `by` ∈ `PLAYER_SLOTS ∪ {'sys'}`; `crop.cycle === obj.cycle`; `/^#[0-9a-fA-F]{6}$/` for colors;
`isCount` for timestamps; `/^[0-9a-f]{8}$/` for `contentHash`.

**Resolution (fixed):** `TOP_KEYS/META_KEYS/FARM_KEYS/PLAYER_KEYS` are exported, and unknown keys, duplicate expansions, ledger rows, actor fields, `crop.cycle`, colours, timestamps and `contentHash` are all checked. Regression test: `test/rules.contracts.test.js`. Proof test passes.

---

## 17. Low: `ctx` and `ext` are mutable

**Where:** `shared/rules/index.js:60-67`. `server/engine.js:66-78` journals the same `ext` object the rule
received.

**What:** A rule that scribbles on `ctx.ext` changes the journaled `ext`, and therefore replay.

**Proof:** `13-low.proof.mjs` → `frozen? ctx false ext false`.

**Fix:** `return Object.freeze({ now, pid, cid, seq, ext: Object.freeze({ ...ext }), grace, newId, rng });`. The
engine journals `ctx.ext`.

**Resolution (fixed):** `makeCtx` returns a frozen ctx with a frozen copy of `ext`. The engine journals `ctx.ext`. Regression test: `test/rules.rng.test.js`. Proof test passes.

---

## 18. Low: biased cids

**Where:** `shared/net/ids.js:16`, where `b[i] % 36` over bytes makes `0`-`3` 8/7 as likely as the rest.

**Proof:** `13-low.proof.mjs` → `most frequent char 4800, least 4200 (ratio 1.143)`.

**Fix:** use rejection sampling: `const b = randomBytes(16);` and take bytes `< 252`
(`252 = 7·36`) until there are 6 characters, drawing more if needed. Keep 6 characters.

**Resolution (fixed):** rejection sampling (bytes < 252), drawing again when needed. Regression test: `test/protocol.test.js` (each character exactly 7 of 252 first-byte values). The proof's cyclic byte stream is not uniform per call, because only 6 of each 16 drawn bytes are used, so its exact-equality assertion still fails.

---

## 19. Low: level-up coins count as "coins earned"

**Where:** `shared/rules/progress.js:26` calls `earn(...'level')`, which bumps `stats['coins.earned']`
(`economy.js:19`).

**What:** GDD §5.4 counts only sales, orders, barge, Fair and quests as earned. Level rewards then inflate *High
Roller* and any "earn N coins" quest or Almanac task.

**Proof:** `13-low.proof.mjs` → `farm xp 8 | coins.earned 290 without a single sale`.

**Fix:** add `grant(tx, ctx, n, reason)` to `economy.js`. It is `earn` that bumps `coins.granted` instead, and it
is used for level, achievement and chest rewards. Ledger invariant: `coins + Σjars == start + earned + granted +
refunded − spent`. The designer should confirm, because the GDD is being revised.

**Resolution (fixed; designer to confirm):** `economy.grant()` counts `coins.granted` and is used for level rewards. The ledger invariant is in the `economy.js` header. Regression test: `test/rules.contracts.test.js` (granted vs earned, and the ledger balances). Proof test passes.

---

## GDD §3-§6 against the frozen contracts

| GDD system | Contract pieces | Expressible today? |
|---|---|---|
| Crops: plant, water, compost, harvest, fresh window, mastery (§3.1) | objects, `readyAt` rewrite, events → `processEvents` | Yes. Season −10 % needs **#3**; prized rolls must key on `plot.cycle` (**#2**) |
| Trees: 2×2, saplings, cycles, groves, heirloom (§3.2) | objects, `getGrid` adjacency | Yes. n-th price needs **#8** |
| Feed mill classes, "cheapest member first" (§3.3) | queues, inventory | Needs **#1** (queue arrays) and **#7** (sorted tie-break) |
| Animals in homes, feed/collect, babies, prized, pets (§3.4) | objects + grid | **No: #9.** Coat and bonus rolls need **#2** |
| Production queues, trays, cancel, slot upgrades, duets (§3.5) | `queue` arrays, `farm.joint` | Needs **#1**; duets OK (joint pattern) |
| Barn capacity, overflow, `STORAGE_FULL` (§3.6) | `economy.intake` (M0 shortcut), overflow map | Yes (rules lane fills in `intake`) |
| Economy, prices, n-th copy pricing (§4.3) | content tables | Needs **#8** |
| Levels, perks, rested XP, mastery (§4.6-4.8) | `players[pid]`, `_return` | Yes. Rested XP must not use `regenValue` on the client until **#12** |
| Market rules, Market Demand per day (§4.10) | period counters | Needs **#3** |
| Orders board, generation, pins, help flags (§5.2) | `_orders` system action, `orders.slots` | Needs **#1** (slot array grows) and **#7** (sort candidates) |
| Quests, achievements F/P/T, counters (§5.3-5.4) | `processEvents`, stats | Yes. "Coins earned" needs **#19** |
| Collections with pity (§5.5) | `farm.pity`, rng | Needs **#2** (key on pity/counter, never a new id) |
| Fair, barge, NPC league, weekly (§5.6-5.7) | `_rollover`, period | Needs **#3** |
| Daily gift, streak, Almanac, Golden Hour (§5.8) | `_rollover`, period, bench | Needs **#3** |
| Seasons, festivals, weather (§5.10) | `weatherAt(farmSeed, hour)` | Weather OK (UTC hour index); seasons and festival dates need **#3** |
| Ownership shared vs personal (§6.1) | `farm.*` vs `players[pid].*` | Yes. Note: everything in `players[*]` is replicated to the partner (a wrapped gift's item is visible in devtools) |
| Reservations, pins, BIG_SPEND (§6.3) | soft codes | Needs **#11** |
| 10-minute undo, trash, ledger (§6.3) | receipts, `_settle` | Yes (pattern §15.3); `_settle` needs the hot-loop guard (below) |
| Joint actions: duet, chop, high-five, bench (§6.2) | `farm.joint`, `ctx.ext.near/online` | Yes. `ext` must be frozen (**#17**) |
| Activity feed, thanks cap (§6.4) | `farm.feed`, period | Feed must be a ring object, not an array (**#1**); caps need **#3** |
| 3-4 players (§6.6) | `PLAYER_SLOTS`, `SLOT_RE /^p[1-9]$/` | Yes (config) |

## Observations (no defect yet, worth one line in a lane brief)

- **Hot-loop guard** (tech §15.1) is not implemented. `Engine.system` logs a rejected system action and returns,
  `dueSystemActions` would return it again, and `Scheduler.arm()` would compute a delay of 0. It is harmless while
  `dueSystemActions` returns `[]`. The server lane must add the 60 s back-off with the first real system action.
- `rej.by` comes only from `args.id` (`engine.js:118-121`). For `sell {item}` (RESERVED) there is no `by`, so the
  client must take the reserver from its state (see #11).
- Rules must not read `state.meta.version`: the client holds the last confirmed `v`, while the server is mid-action.
  Add it to the header rules.
- `assertSchema` does not check `['int', lo, hi]` bounds. `V.int(5)` (a missing `hi`) silently rejects everything.
  Add `Number.isSafeInteger(lo) && Number.isSafeInteger(hi) && lo <= hi`.
- `newId` output must stay at 40 characters or fewer (`objId`). Any derived id such as `${parent}.${n}` can exceed it.
  Keep derived ids flat.
- rng quality is fine: a chi-square over 200,000 sequential cycles in 64 buckets gave 77.1 (df 63); the low bit
  came out at 0.4996; and adjacent seeds agreed on a coin flip 0.5001 of the time.

**Resolutions of the observations:** `assertSchema` now checks `int` and `text` bounds (fixed). The `meta.version` rule is rule 6 in the `index.js` header. The hot-loop guard stays open for the server lane, with the first real system action: `dueSystemActions` still returns `[]`. The 40-character `newId` limit stays a documentation note for lanes that derive ids.

**Re-check (2026-10-02, after the fixes):** `npm test` 148/148. The proofs give 21 of 40 green; each remaining red one is explained in its finding's Resolution (a superseded shape, a refuted assertion, or an arithmetic fact).
