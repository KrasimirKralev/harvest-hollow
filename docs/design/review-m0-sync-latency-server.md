# Review M0: sync, latency, server, persistence and the client facades

Adversarial review of the M0 walking skeleton and its frozen contracts, before seven lanes build on them.
Scope: `public/js/net/**`, `public/js/game/**`, `server/**`, persistence, `shared/net/**`, and the facades
`public/js/render/index.js` and `public/js/ui/index.js`, against `docs/research/tech-architecture.md` (§3-§7) and
GDD §7. Commit reviewed: `8bdd6f8` plus the working tree of 2026-10-02 22:10. No production code was changed.

## How to reproduce

Every finding has a proof. Each `*.proof.mjs` file asserts the **correct** behaviour, so it fails today. When
it passes, the finding is fixed. The proofs live outside `test/`, so `npm test` stays green (92/92).

```
node --test docs/design/review-m0-sync-proofs/*.proof.mjs    # today: tests 21, pass 0, fail 21 (content-reload-loop is a plain script)
node docs/design/review-m0-sync-proofs/sync-fuzz.check.mjs    # green: the rebase core is sound (see "Verified sound")
node docs/design/review-m0-sync-proofs/rebase-cost.check.mjs  # green: cost per confirmed delta vs pending count
```

The servers use temp data dirs on the real disk (`test/.tmp-data/`). `auth-crash` spawns servers on port **3302**.
`content-reload-loop` uses port **3303**, a throwaway copy of the repo and headless Chrome. Nothing touches 3000 or 3300.

Overlap with `review-m0-determinism-economy.md`, written in parallel. Its #4 (dedupe record reset) covers the
offline half of M1 here. Its #10 (replay not tied to code) has the same root as H2. H2 adds the persist-side
deletion mechanism and triggers that do not involve code changes. Fix each pair once.

## Summary

| # | Sev | Finding | Lane(s) | Contract? |
|---|---|---|---|---|
| H1 | High | A slot claimed < 30 s before a crash is locked out for good (token hash not journaled) | server | no |
| H2 | High | One unreplayable journal line makes the boot snapshot delete every later accepted action | server | no |
| H3 | High | A rate-limited `resync` is dropped silently; the client freezes until reload | server, client-core | no |
| H4 | High | Editing `shared/content` on a running server: endless reload loop, and a first claim burns the slot | client-core | no |
| M1 | Medium | The 24 h cid prune hits **connected** tabs: every act `NOT_JOINED`, `resync` throws | server | no |
| M2 | Medium | Drag-paint (GDD §7.1, 3x3 brush) is rolled back by `RATE` and then disconnected as abuse | client-core, server | LIMITS values |
| M3 | Medium | A partner walking at constant speed renders stalls and 2x lurches (relay stamping + rest repeat) | server, client-core | **yes** (`pr` row) |
| M4 | Medium | `mv` cannot express a hop (poof) or the partner's tool; the poof becomes a 5 s sprint | server, client-core, render | **yes** (`mv`, `pr`) |
| M5 | Medium | The partner's build ghost freezes on a stale tile (latest state dropped, never re-sent) | client-core, server | no |
| M6 | Medium | A failed journal append half-commits: state changed, `v` bumped, no `d`, no `rej`, journal hole | server | no |
| M7 | Medium | A dev time warp freezes the production clock (and all presence) for the warped duration | server, lead | no |
| M8 | Medium | Confirmed-only celebrations rely on a client-side name list; missed ones never replay | rules, client-core | additive |
| M9 | Medium | The facades cover M0, not GDD §7: about 12 additive methods must be agreed before the lanes diverge | lead, render-world, ui, client-core | additive |
| L1 | Low | ClockSync keeps a stale min-RTT sample about 80 s after a suspend (timers off by the suspend length) | server (shared/net), client-core | no |
| L2 | Low | A rejected prediction whose `rej` was lost in a disconnect vanishes without a `reject` event | server, client-core | additive |
| L3 | Low | The 30 s offline input cap (tech §3.7) is not implemented (`MAX_OFFLINE_MS` is unused) | client-core | no |

**Counts: 4 High, 9 Medium, 3 Low (16).** M3 and M4 change frozen wire shapes. Bundle them into **one**
`PROTOCOL_VERSION` bump by the lead, before the render-life and client-core lanes build avatars on the current shapes.

---

## H1. High: a freshly claimed slot is locked out after a crash

**Where:** `server/sessions.js:94-97`. `_join` is journaled through `engine.system()`, then the token hash goes
only into the in-memory `server.auth`, which reaches disk only with the next snapshot (every 30 s or at shutdown).
`server/engine.js:127-136`: replay restores the player and `lastSeq`, but never `auth`.

**What:** If the server is killed (`kill -9`, OOM, power) between a claim and the next snapshot, replay recreates
`players.p1` without a token hash. The browser's saved token now gets `BAD_TOKEN`. The client deletes it and
re-claims, which gets `SLOT_TAKEN` because the player exists. The only way back is hand-editing `data/farm.json`.
The first evening is exactly when a crash is most likely, and the README promises "kill -9 loses nothing".
The SIGKILL test in `test/persist.test.js:95` checks the version but never resumes the token.

**Proof:** `node --test docs/design/review-m0-sync-proofs/auth-crash.proof.mjs`
```
OBSERVED resume=deny/BAD_TOKEN reclaim=deny/SLOT_TAKEN players=p1 auth=[] plantedSurvived=true
```

**Fix (server lane):** journal the auth change with the `_join` line, as a server-only field that is never broadcast.
```js
// engine.js
system(type, args, ext = {}, srv = null) { ... this.commit(r.tx, { now, pid: 'sys', cid: 'sys', seq, type, args, ext, srv }); }
commit(tx, { now, pid, cid, seq, type, args, ext, srv }) {
  const line = { v, now, pid, cid, seq, type, args, ext };
  if (srv) line.srv = srv;                    // server-private: journaled, never in the `d` broadcast
  ...
  if (srv && srv.auth) Object.assign(this.server.auth, srv.auth);
}
replay(line) { ...; if (line.srv && line.srv.auth) Object.assign(this.server.auth, line.srv.auth); }
// sessions.js hello(): create the token BEFORE the system action
token = crypto.randomBytes(32).toString('hex');
const r = this.engine.system('_join', args, {}, { auth: { [slot]: { tokenHash: sha256(token) } } });
```
Extend the SIGKILL test so it resumes with `w.token` after the kill. The client half of the same lockout (the
token dropped by a reload) is H4(b).

**Resolution (fixed):** `Engine.system(type, args, ext, srv)` journals server-private `srv` with the line, and it is never put in a `d` broadcast. `sessions.hello` creates the token before `_join` and passes `{ auth: { [slot]: { tokenHash } } }`. `commit` and `replay` apply `srv.auth`. Regression test: the SIGKILL test in `test/persist.test.js` now resumes the token after the kill. The proof was not run, because it is bound to port 3302 (another lane's port); the in-process test covers the same path.

---

## H2. High: one unreplayable journal line deletes every later accepted action

**Where:** `server/index.js:39-48`. On a failure, replay stops (correct) and files only the failing line as an
incident. Then `server/index.js:85` runs the boot snapshot. `server/persist.js:155-161` renames the **whole**
journal to `farm.journal.upto-<lastGoodV>.jsonl`, and `persist.js:176-179` deletes it as "redundant" once the
snapshot is written.

**What:** Every acknowledged action after the failing line is gone from disk. The players already saw those
actions confirmed. The server keeps serving the older state, and new actions reuse the lost `v` numbers.

These triggers do not need a code change (see determinism #10 for the code-change triggers):
- a content edit between a crash and the restart: unlock level, seed price or `growMs` (seven lanes edit content all day);
- a journal **gap**: the failed append in M6, or a torn line in the middle of the journal;
- a migration bug;
- a fallback to a backup (`persist.js:60`). The journal then starts above the backup's version, `journal gap` fires
  on the first line, and the gap path deletes the whole journal.

**Proof:** `node --test docs/design/review-m0-sync-proofs/replay-failure.proof.mjs`. The journal holds v3..v6,
and v4 is a carrot plant that is `LOCKED` under the "new" content.
```
persist: replay stopped: journal v4 (plant) failed on replay: LOCKED
OBSERVED booted at v3 (journal had up to v6); files now: backups, farm.journal.jsonl, farm.json, incidents;
         incidents: 1790968979401-replay-failed.json; lines v5/v6 still on disk: []
```

**Fix (server lane):**
1. Add `Persist.quarantine(tag, info)`: make `incidents/<ts>-<tag>/`, **copy** `farm.json` and every
   `farm.journal*.jsonl` into it, and write `info.json` with the error, the failing line, `replayed` and the
   remaining count.
2. In `loadFarm`, on a replay failure, call `persist.quarantine('replay', …)` **before** anything can snapshot.
   Then refuse to start unless `HH_REPLAY_ANYWAY=1`:
   ```js
   } catch (err) {
     persist.quarantine('replay', { error: err.message, line, at: engine.v, remaining: lines.length - replayed });
     if (!allowPartialReplay) throw new Error(`journal replay stopped at v${engine.v}; journals copied to incidents/. `
       + 'Start the previous build once, or set HH_REPLAY_ANYWAY=1 to continue without the remaining lines.');
     break;
   }
   ```
   systemd then shows a failed unit instead of a farm that quietly lost an evening.
3. Defence in depth in `snapshotOnce`: only delete an `upto-N` file that **this process** cut (track
   `this.cuts`), never a file inherited from `load()`.
4. Determinism #10 adds `h: CONTENT_HASH` and `grace` to every journal line. Ship both fixes together.

**Resolution (fixed):** `Persist.quarantine(tag, info)` copies `farm.json` and every journal file into `incidents/<ts>-replay/` with `info.json`, before anything can snapshot. `loadFarm` then refuses to boot unless `HH_REPLAY_ANYWAY=1` (documented in README). `snapshotOnce` deletes only journal cuts this process made, or inherited ones after `adoptInherited()` (a complete replay). Regression tests: `test/persist.test.js` (quarantine and refusal, anyway-boot, inherited cut kept). With the proof's own trigger the boot is now refused (`testServer` throws) with every line kept, so the proof fails by design.

---

## H3. High: a dropped `resync` freezes the client until a reload

**Where:** `server/router.js:62-63`. Over the `resync` bucket (0.2/s, burst 2) the frame is dropped and counted as
abuse, with no answer. `public/js/net/sync.js:155-158`: `requestResync()` returns early while `resyncing` is set,
so it never asks again. `sync.js:112`: `ready` stays false, so `act()` answers `NOT_JOINED` and
`onServer` ignores every delta (`sync.js:177`). No timer anywhere clears the flag.

**What:** The trigger is any repeating divergence: resync, then a welcome, then the next delta throws, then
another resync. The third request within about 10 s is dropped. Divergence bugs are exactly what seven parallel
lanes will produce in the next weeks. The client then shows "Connecting to the farm..." with a healthy socket,
and nothing recovers it: the heartbeat keeps the socket alive, so no reconnect ever happens.

**Proof:** `node --test docs/design/review-m0-sync-proofs/resync-freeze.proof.mjs`
```
OBSERVED 3 resync requests -> 2 welcome(s)
OBSERVED ready=false v=2 serverV=4 act=NOT_JOINED framesSent=0
```

**Fix:**
- Server lane (`router.js`): never drop a resync. Defer it instead:
  ```js
  case MSG.RESYNC:
    if (take('resync')) return hh.sessions.welcome(conn);
    conn.resyncTimer ??= setTimeout(() => { conn.resyncTimer = null; hh.sessions.welcome(conn); }, 5000);
    return undefined;                                   // clear conn.resyncTimer in sessions.close()
  ```
- Client-core lane (`main.js`): add a watchdog. If no welcome arrives within 3 s of a `resync` event, call
  `socket.drop()`. The reconnect's hello always gets a welcome and is not limited by the resync bucket.
  ```js
  let resyncT = null;
  store.on('resync', () => { clearTimeout(resyncT); resyncT = setTimeout(() => { if (store.resyncing) socket.drop(); }, 3000); });
  store.on('welcome', () => clearTimeout(resyncT));
  ```
- Log every resync with its cause (the `sync:` error) on both sides, so divergence bugs surface instead of
  being papered over.

**Resolution (fixed):** the router never drops `resync`. Over budget it defers the welcome until a token is back (5 s), and `welcome()` clears the timer. `SyncStore.requestResync(cause)` repeats the request when the previous one is older than `RESYNC_RETRY_MS` (3 s), checked on every incoming delta and `act()`. `main.js` drops the socket if no welcome arrives within 5 s (the reconnect's hello is always answered), and every resync is logged with its cause. Regression tests: `test/server.review.test.js` (3 requests give 3 welcomes, nobody disconnected) and `test/sync.test.js` (lost answer, repeat, converge). The proof's server test waits only 400 ms for the deferred answer, and its client test lets no time pass, so both still fail by design.

---

## H4. High: editing `shared/content` on a running server loops every reload and can burn a slot

**Where:** `public/js/main.js:59-61`. The `contentHash` check runs `location.reload()` **before** the token from
that same welcome is saved. The server computes `CONTENT_HASH` once at import, while `server/http.js:16`
serves `shared/` from disk with no cache, so a reloaded page always computes the new hash.

**What:**
- (a) A farmer with a saved token reloads forever, about 6 times a second, until someone restarts the server.
- (b) A farmer claiming a slot for the first time while the hashes differ gets the slot claimed on the server.
  The token is then thrown away by the reload. After that the slot is "taken", with no "Continue" button.
  That is the same permanent lockout as H1.

Seven lanes will edit `shared/content` while their servers and `tools/shot.mjs` runs are up. In production
the designer can trigger it by editing a value with `npm start` running.

**Proof:** `node docs/design/review-m0-sync-proofs/content-reload-loop.proof.mjs` (a repo copy on port 3303 and
headless Chrome; the edit is `START.coins` from 300 to 301 in the copy)
```
OBSERVED {"p1LoadsIn8s":48,"p2":{"pid":null,"pickerShown":true,"tokens":null},"serverSlots":["p1:claimed","p2:claimed"]}
```

**Fix (client-core lane, `main.js`):**
```js
function onWelcome(w) {
  if (w.token) { ident.tokens[w.pid] = w.token; saveTokens(); }   // identity first, whatever happens next
  if (w.contentHash !== CONTENT_HASH) {
    if (storage.get(sessionStorage, 'hh.reloadedFor') !== w.contentHash) {
      storage.set(sessionStorage, 'hh.reloadedFor', w.contentHash);
      location.reload();
      return;
    }
    ui.setConnection('mismatch');   // additive ui state: "The farm server runs other content. Restart it, then reload."
    return;
  }
  ...
```
Lead: add one line to `common.md`: "after editing `shared/**`, restart your lane server (`npm run dev` does it)".

**Resolution (fixed):** `main.js` stores the welcome's token and slot first, then asks `public/js/net/content-gate.js` `contentGate()`: reload at most once per server hash (`sessionStorage['hh.reloadedFor']`), otherwise `ui.setConnection('mismatch')`. The restart rule is in `common.md` and README. Regression test: `test/sync.test.js` (gate decisions, and the token saved before the gate). The proof was run as a copy on port 3301: `{"p1LoadsIn8s":2,"p2":{"pid":null,"tokens":"{\"p2\":...}"}}` (was 48 loads and no token). p2 keeps its token, so after the server restart it resumes instead of being locked out.

---

## M1. Medium: the cid prune removes the dedupe record of a connected tab

**Where:** `server/engine.js:49-51` prunes on `seenAt` alone, and the heartbeat runs it every 15 s
(`sessions.js:151`). Only an act refreshes `seenAt` (`engine.js:70`). Neither `hello` nor `close` refreshes it
(`engine.js:44` keeps the old record).

**What:**
- (a) A tab that stays connected but sends no action for 24 h loses its record while connected. Examples: the
  partner played and I only watched, or a laptop left awake over a weekend. From then on every act gets
  `rej NOT_JOINED`. A `resync` throws `TypeError` inside the router, because `sessions.js:119` reads
  `server.clients[cid].lastSeq`. The router swallows the error and sends no answer, so the client is stuck as in
  H3 until a reload.
- (b) A client that comes back after more than 24 h with unacknowledged actions gets `welcome.lastSeq = 0` and
  re-sends them, so they run twice. Determinism #4 has the same finding and a fix that covers this half.

**Proof:** `node --test docs/design/review-m0-sync-proofs/prune-live-cid.proof.mjs`
```
router error (frame dropped): TypeError: Cannot read properties of undefined (reading 'lastSeq')
OBSERVED act -> rej/NOT_JOINED; resync -> nothing (router logged a TypeError)
OBSERVED one click on "Sell 1" sold 2 wheat
```

**Fix (server lane):**
```js
// engine.js
client(cid, pid, now) { ...; c[cid].seenAt = now; return c[cid]; }          // hello and close refresh it
pruneClients(now, live = new Set()) {
  for (const [cid, c] of Object.entries(this.server.clients)) if (!live.has(cid) && now - c.seenAt > CID_TTL_MS) delete this.server.clients[cid];
}
// sessions.js heartbeat
this.engine.pruneClients(this.clock.now(), new Set([...this.conns].map((c) => c.cid)));
// sessions.js welcome(): never index the record directly
lastSeq: this.engine.client(conn.cid, conn.pid, this.clock.now()).lastSeq,
// sessions.js close(): this.engine.client(conn.cid, pid, this.clock.now()) before `_seen`
```
For (b), use the `welcome.known` flag and the 7-day TTL from determinism #4.

**Resolution (fixed):** `Engine.client` refreshes `seenAt` on every hello, close and act. `pruneClients(now, live)` skips connected cids (the heartbeat passes them), and the TTL is 7 days. `welcome()` gets the record through `engine.client` and never indexes it directly. Half (b) is covered by `welcome.known` (determinism #4). Regression test: `test/server.review.test.js` "the dedupe record outlives a day and is never pruned while its tab is connected". Proof: both tests pass.

---

## M2. Medium: drag-paint is throttled into rollbacks and then disconnected

**Where:**
- `public/js/net/socket.js:70-80`: acts are coalesced per microtask (tech §3.7 says per frame), and nothing
  paces them.
- `shared/net/protocol.js:80`: act bucket 40/s, burst 120.
- `server/router.js:40`: every `RATE` rejection also calls `abuse()`, and `ABUSE_MAX = 300` per 10 s
  (`router.js:6`) closes the socket with 1008. The close is logged once per extra frame.

**What:** GDD §7.1 drag-paint rasterises every plot under the stroke, and brush sizes reach 3x3. A 3x3 stroke at
10 tiles/s produces 90 acts/s. Above the bucket, every act gets `RATE`, and the crop the player just saw planted
or harvested pops back. After about 8 s of such a stroke, the player is disconnected as an abuser. Late-game
fields (GDD up to about 900 plots) make long strokes normal.

**Proof:** `node --test docs/design/review-m0-sync-proofs/drag-rate.proof.mjs` (9 acts every 100 ms for 10 s)
```
closing abusive connection 1 (p1)          (logged 3 times)
OBSERVED sent 756 acts: 301 RATE rejections (= rolled-back predictions); socket closed=true code=1008
```

**Fix:**
1. Server lane (`protocol.js` LIMITS values; the shape is unchanged): act bucket `[120, 360]`. `runAction` costs
   microseconds, so this is still a real limit for a LAN game. `MAX_PENDING: 300`.
2. Server lane (`router.js`): a well-formed act over budget is pressure, not abuse. Count abuse only for
   malformed or unparseable frames, or once per `acts` frame, never per act. Close the socket once
   (`if (conn.closing) return; conn.closing = true;`).
3. Client-core lane (`socket.js`): keep a send-side token bucket that mirrors `LIMITS.BUCKETS.act` with a 10 %
   margin. Hold excess acts in `this.batch` and flush them on a timer. Predictions stay instant; only the wire
   is paced. The server then never answers `RATE` to a correct client.
4. Measured cost of a long queue (`rebase-cost.check.mjs`, Node): each confirmed delta costs 0.20 ms at 10
   pending and 0.64 ms at 100 pending, because the store rewinds and replays every pending action. That is fine
   per frame, but it grows with the queue, so pace near the server budget rather than queueing hundreds.

**Resolution (fixed):** `LIMITS` act bucket `[120, 360]` and `MAX_PENDING` 300. A well-formed act over budget gets `rej RATE` but never counts as abuse, and an abusive socket is closed once (`conn.closing`). `socket.js` paces sends to 90 % of the bucket, holding the excess in the batch, so predictions stay instant. Regression test: `test/server.review.test.js` (3 s at 90 acts/s: 0 RATE; a 1,500-act flood: RATE, not closed). Proof passes: 900 acts, 0 RATE, not closed.

---

## M3. Medium: a partner walking at constant speed stutters

**Where:**
- `server/presence.js:87`: every row is stamped with the **flush** time, not the time its pose was received.
- `presence.js:81-82`: the "rest repeat" fires whenever one 66.7 ms flush window saw no `mv`.
- `public/js/game/avatar.js:37`: `mv` is gated by frames (at most every 66.7 ms), so it goes out every 4-5
  frames at 60 fps and every 2-3 frames at 30 fps. That beats against the server's 15 Hz flush.

**What:** When a flush window misses an `mv` mid-walk, the server repeats the old pose with a new `ts`, and the
receiver renders a stop. Then the next sample arrives one interval "late" with twice the distance, and the
receiver renders a 2x lurch. This happens every time the partner walks. It is the most visible co-op signal,
and the owner's priorities name "nice co-op" and "low latency".

**Proof:** `node --test docs/design/review-m0-sync-proofs/presence-stutter.proof.mjs`. It drives the real
`Presence` and `PresenceBuffer` with the real `avatar.js` send rule over a 4 s walk at 3 tiles/s, rendered at
60 Hz, with ±1 ms frame jitter and 2 ms latency.
```
OBSERVED fps=60: {"frames":204,"stalled":28,"rushed":0,"repeats":7,"min":"0.00","max":"3.90"}
OBSERVED fps=30: {"frames":204,"stalled":44,"rushed":53,"repeats":12,"min":"0.00","max":"4.68"}
```
`stalled` counts frames below half the walk speed and `rushed` counts frames above 1.5x. A longer
interpolation delay does not help (160 ms: 25 stalled at 60 fps).

**Fix (CONTRACT, bundle with M4).** A scratch experiment with the same simulation brought both cases to
**0 stalled / 0 rushed**:
1. `pr` rows gain a per-row timestamp: `[pid, x, z, f, a, cx, cz, ts]`. `ts` is the server time at which the row's
   pose became true: the `mv` receipt, or the clamp-advance step. `view.partner.update(rows, ts)` keeps its
   signature, and render uses `row[7] ?? ts`.
2. The rest repeat fires only after more than 200 ms without an `mv` (`now - e.ts > 200`), not after one empty
   flush window.
3. `avatar.js`: send on a fixed 15 Hz accumulator (`acc += dt; if (acc >= 1 / 15) { acc -= 1 / 15; send(); }`),
   not on "frames since the last send".

**Resolution (fixed, contract):** `pr` rows carry their own time `rts` (receipt or catch-up step). The rest repeat fires only after `REST_MS` (150 ms) without an `mv`, stamped when it is sent. `avatar.js` sends on a fixed 15 Hz accumulator. `PresenceBuffer` never extrapolates an idle sample (`a` 0), so a stopped partner does not overshoot. Regression test: `test/presence.test.js` (the same simulation with the new sender: 0 repeats, 0 stalled, 0 rushed at 30, 60 and 144 fps over 3 seeds, and the walk stops exactly). The proof still simulates the old send rule and batch stamping, so it fails by design.

---

## M4. Medium: the presence wire shape cannot carry a hop or the partner's tool

**Where:** `public/js/game/avatar.js:21` teleports ("poof", tech §6.5) when the target is more than 12 tiles
away. `server/presence.js:35-60` clamps every jump to 1.5x walking speed. `shared/net/protocol.js:161-171`:
`mv` is `{x, z, f, a, cx?, cz?}`, and unknown keys are stripped.

**What:**
- (a) A poof across the farm reaches the partner as a sprint of about 5 s at 1.5x speed.
- (b) Tech §6.3 calls for a partner cursor ring "with a tiny name tag and tool icon". GDD §7.2 says "their
  avatar plays the tool gesture". The tool cannot travel on the wire, and no lane can add it without a CONTRACT
  change, because `parseClientMessage` drops it.

**Proof:** `node --test docs/design/review-m0-sync-proofs/presence-contract.proof.mjs`
```
OBSERVED the partner sees the avatar run for 4884 ms (75 pr frames) instead of a poof
OBSERVED parsed mv = {"t":"mv","x":1,"z":1,"f":0,"a":0,"cx":2,"cz":2}
```

**Fix (CONTRACT, one `PROTOCOL_VERSION` bump together with M3; the lead applies all sides):**
- `mv` gains `hop?: true` and `tool?: /^[a-z_]{1,16}$/`.
- The server accepts a hop to any in-bounds point with its own bucket `hop: [1, 2]`. It sets `e.x/e.z` to the
  claim immediately, clears `claim`, and tags the row.
- `pr` rows become `[pid, x, z, f, a, cx, cz, ts, tool, hop]`, with `hop` as 0/1 so the receiver plays the
  poof FX instead of interpolating.
- `avatar.js` sends `hop: true` from `walkTo` and `place`, and sends the tool from `controller.tool`.

**Resolution (fixed, contract, `PROTOCOL_VERSION` 2 together with M3):** `mv` takes `hop?: true` (own bucket `hop: [1, 2]`; over it the hop degrades to a clamped walk) and `tool?`. Rows are `[pid, x, z, f, a, cx, cz, rts, tool, hop]`. `avatar.js` sends `hop` from `walkTo` (far) and `place`, and the tool comes from `controller.on('tool')`. The receiver clears its buffer on a hop. Regression tests: `test/presence.test.js` (hop lands in one tick, flag sent once, tool kept; parse rules). Proof (b) passes. Proof (a) sends no hop flag, so it still sees the clamped walk, by design.

---

## M5. Medium: the partner's build ghost freezes on a stale tile

**Where:** `public/js/game/controller.js:46-58` sends `ghost` on every hovered-tile change. Nothing throttles it:
`LIMITS.GHOST_HZ` exists but is unused. The client dedupes on the last **sent** value. `server/router.js:52-53`
drops frames over the bucket (12/s, burst 12) silently.

**What:** A sweep across the field leaves the partner's ghost where the bucket ran dry, not under the builder's
cursor. Tech §3.6 relies on the live ghost to prevent `BLOCKED` races ("the tint turns red before you click"),
and a wrong ghost causes them instead.

**Proof:** `node --test docs/design/review-m0-sync-proofs/ghost-drop.proof.mjs` (30 tile changes in about 0.5 s)
```
OBSERVED builder stopped at x=39; partner received 17/30 ghost frames, last x=36
```

**Fix:**
- Client-core lane: throttle `sendGhost` to `LIMITS.GHOST_HZ` with a **trailing edge**. Keep `pendingGhost` and
  always send the latest value within 100 ms of the last change. Do the same in `avatar.js` for the final cursor
  position.
- Server lane: latest-wins state relays must never drop the newest frame. Over budget, store `conn.ghostLatest`
  and relay it from the next `Presence.flush()` tick, instead of returning. Apply the same rule to `mv`.

**Resolution (fixed):** `controller.js` throttles `ghost` to `GHOST_HZ` with a trailing edge. The router keeps the latest over-budget `ghost` and `mv` and relays it when a token is back. Regression test: `test/server.review.test.js` (final ghost at x=39). Proof passes: 18 of 30 frames, last x=39.

---

## M6. Medium: a failed journal append half-commits the action

**Where:** `server/engine.js:105-114`. `runAction` has already mutated the state when `commit()` bumps `v` and
calls `journal.append()`. If the append throws (ENOSPC, EIO), the exception leaves through the router's
catch-all (`router.js:69`).

**What:**
- The state is changed and `v` is bumped, but the action has no `d`, no `rej` and no journal line.
- The sender's prediction stays pending, and the partner sees a `v` gap (a forced resync).
- The journal now has a hole, so a later crash replay stops there, and H2 then deletes everything after it.
- `fs.writeSync` can also write part of a line on ENOSPC. The next append then lands on the same line, which
  makes the next good line unreadable too.

**Proof:** `node --test docs/design/review-m0-sync-proofs/append-failure.proof.mjs` (`persist.append` throws once)
```
router error (frame dropped): Error: ENOSPC: no space left on device, write
OBSERVED sender got NO answer; server applied it=true; v 2 -> 4; partner's next delta v=4 (gap from v2);
         crash-replay now stops at v2 of 4
```

**Fix (server lane):**
```js
// engine.js
commit(tx, meta) {
  const v = this.state.meta.version + 1;
  if (this.journal) {
    try { this.journal.append({ v, ...meta }); } catch (err) {
      tx.rollback();                                           // nothing half-applied
      this.log.error(`journal append failed (${err.code || err.message}); action rolled back`);
      this.degraded = true;                                    // surface in /api/status and a HUD pill
      return false;
    }
  }
  this.state.meta.version = v;
  ...
  return true;
}
// act():    if (!this.commit(...)) return { t: MSG.REJ, seq, code: ERR.INTERNAL };
// system(): if (!this.commit(...)) return { ok: false, code: ERR.INTERNAL };
// persist.js append(): remember the size before the write; on a short write or a throw, ftruncateSync(fd, size)
// and rethrow, so the journal never keeps a torn line in the middle.
```

**Resolution (fixed):** `Engine.commit` appends first. On failure it rolls the Tx back, sets `degraded` (reported by `/api/status`) and returns false; `act` answers `rej INTERNAL` and `system` returns `{ ok: false }`. `Persist.append` truncates back to the previous size on a throw or a short write. Regression tests: `test/server.review.test.js` (atomic reject, no `v` gap) and `test/persist.test.js` (no torn line). Proof passes.

---

## M7. Medium: a dev time warp freezes the production clock

**Where:**
- `server/clock.js:13`: a non-dev boot zeroes `devOffset` but keeps the warped `lastNow`, and `clock.js:24-29`
  then freezes game time until the wall clock catches up.
- `package.json:13`: `npm run dev` and `npm start` share `./data` by default.
- `server/http.js:32`: a warp of up to 400 days is accepted.
- `server/presence.js:87` and the pong `s` use the same frozen clock, so presence freezes too.
  `PresenceBuffer.push` drops every sample whose `ts` does not increase.

**What:** The designer warps 4 h on `npm run dev` to test a crop, then starts the real service. For 4 h nothing
grows, every timer shows the same value, and the partner's avatar does not move. A wall clock stepped back
(manual change, an RTC that resyncs after resume) does the same thing for its duration.

**Proof:** `node --test docs/design/review-m0-sync-proofs/warp-freeze.proof.mjs`
```
OBSERVED game time advanced 0 ms during 600000 ms of real time
OBSERVED 10 walking steps relayed, partner buffer kept 1 sample(s) at x=21.8
```

**Fix:**
- Server lane, `clock.js`: when not in dev mode and the save has `devOffset != 0`, **keep** the offset (log it in
  yellow, and refuse further warps) so game time continues smoothly from the saved timestamps. Do not zero it.
  The existing test `ServerClock ignores a persisted dev offset when not in dev mode` must flip.
- Lead (`package.json`): `"dev": "HH_DEV=1 HH_DATA_DIR=./data-dev node --watch server/index.js"`, plus
  `data-dev/` in `.gitignore`.
- Server lane (optional): stamp `pr.ts` and `pong.s` from a monotonic relay clock
  (`bootWall + performance.now() - bootPerf`), so a wall step back never freezes avatars.

**Resolution (fixed; part 2 refuted):** a production boot keeps the saved offset, logs it and refuses new warps. A backward wall step longer than `STEP_MS` (5 s) is absorbed into the offset, so game time never freezes for more than 5 s. `npm run dev` uses `./data-dev`, which is gitignored. Regression tests: `test/clock.test.js` (offset kept, a 10 min run after a warp, absorbed step); the old "ignores a persisted dev offset" test was flipped. Proof test 1 passes. Test 2 (presence on a clock frozen for minutes) is refuted: such a freeze can no longer happen beyond 5 s, and a separate presence clock would disagree with the pong-based client estimate the receiver interpolates on.

---

## M8. Medium: confirmed-only celebrations rely on a client-side name list

**Where:** `public/js/net/sync.js:36` defines `CELEBRATIONS = {levelUp, achievement, questDone, duet, together}`.
The rules lane emits the events (`shared/rules/progress.js:28` emits only `levelUp` today), but no module in
`shared/` exports or promises that vocabulary. `sync.js:135` predicts **every** other event as `fx`.

**What:**
- (a) GDD §5.4 calls achievements "Ribbons". If the rules lane emits `{ e: 'ribbon' }` or `'questComplete'`, the
  celebration is predicted and can be taken back by a rejection, which tech §0 #15 forbids. Nothing catches the
  mismatch.
- (b) A level-up or ribbon whose delta was lost in a disconnect never plays on that screen, and GDD §7.2 says
  "on both screens". The welcome is authoritative but has no catch-up.

**Proof:** `node --test docs/design/review-m0-sync-proofs/celebration-contract.proof.mjs`
```
OBSERVED celebration exports in shared/rules: []
OBSERVED B level=2, celebrations on B: []
```

**Fix:**
- Rules lane (additive): export `CELEBRATIONS` from `shared/rules/progress.js` as the one closed list, and add an
  invariant test. It fuzzes every action and asserts that each emitted `ev.e` is in `FX_EVENTS ∪ CELEBRATIONS`,
  so a new event must be classified.
- Client-core lane: `sync.js` imports `CELEBRATIONS` from rules and stops defining its own.
- Client-core lane, for (b): in `reset(w)`, when a previous state exists (a reconnect or resync, not the first
  welcome), compare `levelFromXp` and the ribbon and quest-done sets of the old and new state, and emit
  `celebrate` for each one gained. The welcome is authoritative, so this stays confirmed-only.

**Resolution (fixed):** `shared/rules/progress.js` exports the closed `CELEBRATIONS` and `FX_EVENTS` (re-exported from `index.js`), and `sync.js` imports them. `test/invariants.test.js` fails on any unclassified event. `SyncStore` tracks the last confirmed farm level and celebrates level-ups missed during a disconnect from the welcome (`ev.catchUp`), exactly once. Ribbon and quest catch-up are added by the lanes that create those events, using the same pattern. Regression tests: `test/sync.test.js` (lost level-up celebrates once on both screens; the shared set). Proof: both tests pass.

---

## M9. Medium: the facades cover M0, not the GDD §7 UX

The frozen facades let each lane work alone today, but GDD §7.1-7.3 needs about a dozen more entry points. The
contract protocol allows them as **additive** methods. The risk is coordination: the controller (client-core)
needs view methods that render-world owns, and ui needs controller events that client-core owns. Each lane will
otherwise invent its own name or work around the gap, for example by reaching into `R`. Evidence:
`grep -nE "highlight|hover|tooltip|setQuality|capture|brush" public/js/render/index.js public/js/ui/index.js`
finds nothing, and `controller.on` supports only `'tool'` (`controller.js:168`).

| GDD §7 feature | Missing entry point (proposed additive signature) | Owner |
|---|---|---|
| Drag-paint brush preview (1x1 / 2x2 / 3x3), "painting: Carrot × 14" | `view.highlight(tiles: Array<[x,z]>, style)`; `controller.on('stroke', fn({kind, count, item}))` | render-world, client-core |
| Hover tooltip after 250 ms (name, stage, time left, planter) | `controller.on('hover', fn(pick))`; `ui.tooltip(pick | null)` | client-core, ui |
| Build mode: grid fades in | `view.grid(visible: boolean)` | render-world |
| Invalid placement "Blocked by Mia's Coop" | `canPlace` returns only a code. Add `placeBlocker(state, def, x, z, rot) -> objId | null` in `grid.js`; `view.ghost.update(tile, valid, reason, blockerId?)` | rules, render-world |
| Move mode (moving keeps timers) | `view.objects.hidden(id, bool)` while its ghost moves; `canPlace(..., ignoreId)` already exists | render-world |
| Wheel zooms toward the cursor | `view.camera.zoom(factor, ndc?)` (optional anchor) | render-world |
| Partner cursor ring with the tool icon | wire field: M4 | server, render-life |
| "Mia harvested 12 of these" (coalesced rejections) | `ui.toast(code, { by, count })` | ui |
| Settings: graphics tier, Still / reduced motion, day cycle | `view.setQuality(q)`, `view.setMotion('full' | 'reduced' | 'still')`, `view.setDayCycle(mode)` | render-world |
| Photo mode (P) | `view.capture() -> Promise<Blob>`, `ui.hideHud(bool)` | render-world, ui |
| Content mismatch / degraded server (H4, M6) | `ui.setConnection('mismatch' | 'degraded')` | ui |
| Party feedback from partner actions | `store.on('fx')` already carries `by`. `main.js:115` drops `local` and `by` from the payload, so pass `view.fx.play(ev, undefined, { by, local })` | client-core, render-world |

**Fix (lead):** before the lanes start, add these as **no-op stubs with JSDoc** to `render/index.js`,
`ui/index.js` and `controller.js`, so every lane can call them on day one and the owners fill them in.

**Resolution (fixed, additive stubs):** `view.highlight`, `view.grid`, `view.objects.hidden`, `view.setQuality/setMotion/setDayCycle`, `view.capture()` (works now), `view.ghost.update(..., blockerId?)`, `view.camera.zoom(factor, ndc?)`, `view.fx.play(ev, pos, { by, local })` (main.js passes them); `ui.tooltip`, `ui.hideHud`, `ui.notice`, `ui.setConnection('mismatch'|'degraded')`; `controller.on('hover'|'stroke')`, with hover firing on tile change. JSDoc in each facade header, and the list is in `common.md`. `grid.placeBlocker` is left to the rules lane, as the table says.

---

## L1. Low: ClockSync keeps a stale offset after a suspend

**Where:** `shared/net/clock.js:27-35` picks the minimum-RTT sample of the last 8 regardless of its age.
`public/js/net/socket.js:43` resets samples only on a reconnect, and `socket.js:30-32` only pings once when the
page becomes visible.

**What:** After an OS suspend that the socket survives (shorter than the 30-45 s heartbeat),
`performance.now()` has not advanced. Chrome's monotonic clock excludes suspend on Linux and macOS
(w3c/hr-time#115). The old low-RTT samples keep the stale offset for up to 8 more pings, about 80 s. Timers,
ripeness and the local `NOT_READY` check are off by the suspend length.

**Proof:** `node --test docs/design/review-m0-sync-proofs/clock-stale.proof.mjs`
```
OBSERVED estimate error after each of 4 post-resume pings (ms): 20000, 20000, 20000, 20000
```

**Fix (server lane owns `shared/net/clock.js`; client-core owns `socket.js`).** The change below was verified in
scratch: the proof then reads `20000, 0, 0, 0`, and all 5 existing `test/clock.test.js` cases still pass.
```js
add(c0, s, c1) {
  const rtt = Math.max(0, c1 - c0);
  const sample = { rtt, offset: s - (c0 + c1) / 2 };
  const prev = this.samples.at(-1);
  // Two consecutive samples that agree with each other but not with the estimate: the clock base moved
  // (suspend, server step). Forget the older samples instead of trusting their lower RTT.
  if (prev && this.offset !== null && Math.abs(sample.offset - this.offset) > JUMP_MS
    && Math.abs(sample.offset - prev.offset) <= (sample.rtt + prev.rtt) / 2 + 5) this.samples = [prev];
  this.samples.push(sample);
  ...
```
`socket.js`: on `visibilitychange` to visible, call `clock.reset()` and `startPings()` (a 5-ping burst) instead
of a single ping.

**Resolution (fixed):** the proposed `ClockSync.add` rule. `socket.js` resets the samples and runs a 5-ping burst when the page becomes visible. Regression test: `test/clock.test.js` (adopted within two samples). Proof passes: 20000, 0, 0, 0.

---

## L2. Low: a lost rejection disappears silently on reconnect

**Where:** `server/engine.js:69` advances `lastSeq` on rejections too. `public/js/net/sync.js:146-148` drops
every pending action with `seq <= welcome.lastSeq` as "already applied".

**What:** A harvest that lost the race, with its `rej` lost in a Wi-Fi drop, vanishes after the reconnect. The
player saw "+2" fly to the barn, then gets no toast and no "Mia got there first". The state is correct; only the
feedback is lost.

**Proof:** `node --test docs/design/review-m0-sync-proofs/silent-reject.proof.mjs`
```
OBSERVED B pending=0, reject events=0
```

**Fix (additive welcome field):**
- Server lane: keep the last 32 rejections per cid in memory: `c.rejects.push({ seq, code, by })`. Send them as
  `welcome.rejected`.
- Client-core lane: in `reset(w)`, emit `reject` (`local: false`) for each dropped pending action whose seq is
  in `w.rejected`.

Do **not** stop advancing `lastSeq` on rejection instead. The re-sent action would then be answered by an `ack`,
which the client also drops silently.

**Resolution (fixed):** the engine keeps the last 32 rejections per cid in memory (`rejectedOf`, sent as `welcome.rejected`). `SyncStore.reset` emits `reject` (`local: false`) for a settled pending action found there. `lastSeq` still advances on rejection. Regression tests: `test/server.review.test.js` and `test/sync.test.js`. Proof passes.

---

## L3. Low: the offline input cap is not implemented

**Where:** `shared/net/protocol.js:67` defines `MAX_OFFLINE_MS`, but nothing reads it. `SyncStore` has no notion
of the connection: `socket.raw()` drops frames, and `act()` keeps predicting.

**What:** A disconnected farmer can plant and sell for minutes, up to 100 pending actions. On reconnect each one
is re-decided at the server's current time: crops shown ripe offline turn unripe again, and a burst of toasts
follows. Tech §3.7 says input blocks after 30 s.

**Proof:** `node --test docs/design/review-m0-sync-proofs/offline-cap.proof.mjs`
```
OBSERVED act after 5 min offline -> ok=true code=-; pending=2
```

**Fix (client-core lane):**
- Add `store.setOnline(bool)`, called from `Socket.setStatus`. While offline for more than `MAX_OFFLINE_MS`,
  `act()` returns `{ ok: false, code: ERR.OFFLINE }` and the UI shows the "Reconnecting…" banner as blocking.
- Add `ERR.OFFLINE` to `protocol.js` (an additive change by the server lane).

**Resolution (fixed):** `ERR.OFFLINE`; `store.setOnline()` is wired from `Socket.onStatus`. `act()` returns `OFFLINE` after `MAX_OFFLINE_MS` offline, or while the oldest pending action has gone unanswered that long, which also covers a socket that silently drops frames. UI text has been added. Regression test: `test/sync.test.js`. Proof passes.

---

## Verified sound (with evidence)

- **Rebase under reordering, duplicate delivery, reconnect, resync and rejection rollback.**
  `sync-fuzz.check.mjs` runs 2000 random two-client runs with partial deliveries, socket drops (a random prefix
  of in-flight frames survives), reconnect welcomes, resyncs, clock jumps and ±400 ms client clock skew. Result:
  `fuzz runs 2000, failures 0`. In every run both clients deep-equal the server, `pending` drains, and no
  `(cid, seq)` is applied twice. The undo-log rebase, the `v <= this.v` duplicate guard, the gap-triggered
  resync, and `reset()`'s `seq > lastSeq` re-send are correct when the server answers.
- **Ordering of `resync` against batched acts.** `socket.send()` sends `resync` at once while acts wait for a
  microtask, so a resync can overtake acts from the same task. The server then answers the late re-send with
  `ack`, and the store converges. Dedupe makes it harmless.
- **Snapshot cut.** The stringify and journal rotation happen in one synchronous block. Lines accepted during
  the async write land in the new journal, and the torn last line is skipped (tested in `test/persist.test.js`).
- **Back-pressure.** `send()` never checks `ws.bufferedAmount`. A peer that stops reading is terminated by the
  heartbeat within 30-45 s, and the worst-case buffer in that window is a few MB (two welcomes and 15 Hz
  presence). This is acceptable for a two-player LAN; no finding.
- **Presence relay rate.** The server flushes at 15 Hz and sends only changed rows. A row costs about 60 bytes,
  and the client ignores its own rows (`avatars-view.js:80`). The defects are in timing (M3), not rate.
- **Clock sync.** The welcome seed plus a 5-ping burst gives a correct estimate within about 1 s of joining.
  Min-RTT selection with jump-or-slew is sound for jitter (`test/clock.test.js`). L1 is the only gap.
- **Rebase cost.** `rebase-cost.check.mjs` measures 0.20 ms per confirmed delta at 10 pending and 0.64 ms at 100
  pending (Node). This is quadratic in the queue length, so M2's pacing must keep the queue short.

**Re-check (2026-10-02, after the fixes):** `npm test` 148/148; `npm run test:e2e -- --port 3301` ok (19 steps, no page errors); `sync-fuzz.check.mjs` 2000 runs, 0 failures. Of the runnable proofs (all except `auth-crash` on port 3302 and `content-reload-loop` on port 3303, which was run as a copy on 3301), 12 of 19 tests are green. Each red one is explained in its finding's Resolution.
