# Harvest Hollow: technical architecture

Research and decisions for a low-latency, real-time, two-player co-op farm game in the browser on a LAN.
Written 2026-10-02 for the designer and the 4-6 build agents. Every decision below is final unless the designer
has a gameplay reason to change it, and each one says why.

**Second pass (same day):** reconciled with the five sibling research docs (`fv2-core-loop.md`,
`fv2-animals-trees-crafting.md`, `progression-goals-coop.md`, `visual-ux-juice.md`, `assets-catalog.md`).
New: §10.12 (LOD and culling), §12.1 (LAN, secure context, Local Network Access), §14 (one list of gotchas),
§15 (the patterns behind the designed co-op mechanics, validated by a second prototype), §16 (every conflict
between the docs and its resolution). Persistence numbers were re-measured on the real disk, and the E2E offline
step was corrected after a measurement (§9.1).

Measured on this machine: Node v24.21.0, Google Chrome 154. Latest npm versions: three 0.186.1, ws 8.22.0,
express 5.2.1, puppeteer-core 25.12.0. The proven local pattern is `~/wow-arena`: Express + ws authoritative
server, `shared/` rules, no-bundler Three.js client via an import map, `tools/shot.mjs`, and `node --test`. Read
`~/wow-arena/README.md` and `~/wow-arena/docs/agent-notes/perf-notes.md` before starting. The second file holds
real frame-cost measurements from this laptop's Vega iGPU.

---

## 0. Summary: the decisions

| # | Topic | Decision | Why (short) |
|---|---|---|---|
| 1 | Authority | **One Node process owns the whole farm in memory.** It is single-threaded, so it applies every action strictly in order. | Two players can never race inside the server, so no locks are needed. This is the "memory image" pattern ([Fowler](https://martinfowler.com/bliki/MemoryImage.html)). |
| 2 | Rules | **Pure shared rules.** Every action is `{schema, check(state,args,ctx), apply(tx,args,ctx)}` in `shared/rules/`. The client runs it to predict; the server runs the same code to decide. | You get zero-latency feel without a second implementation that could drift ([Gambetta](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html), [Replicache](https://doc.replicache.dev/concepts/how-it-works)). |
| 3 | Deltas | **Rules write only through a recording transaction (`Tx`).** It yields `ops` (the delta to broadcast) plus an exact `undo` list. | The server gets atomic rollback for free, the client can rebase without cloning, and a test can prove the delta reproduces the state. |
| 4 | Client sync | **Undo-log rebase:** rewind pending actions, apply the server ops, replay the pending actions. | Prototyped twice: 300 plus 500 random two-client interleavings all converged (§3.5, §15.8). `structuredClone` of a late-game state costs **3.2 ms idle and 11.3 ms under load**, so cloning per message is ruled out. |
| 5 | Time | **Timers are absolute server epoch ms (`readyAt`). Nothing ever ticks.** The server clock never runs backwards. The client estimates the server clock with min-RTT ping samples ([Cristian](https://en.wikipedia.org/wiki/Cristian%27s_algorithm)). | Offline progress comes free, the server idles at about 0% CPU, and the client's clock is never trusted. |
| 6 | Randomness | **Stateless hash RNG** keyed by `(farmSeed, objectId, cycle)` ([Squirrel noise RNG, GDC 2017](https://www.gdcvault.com/play/1024365/Math-for-Game-Programmers-Noise)). | Client and server compute the same roll, so loot is predicted exactly. Replay is deterministic and reconnecting cannot re-roll. |
| 7 | Persistence | **Atomic JSON snapshot plus an append-only action journal (JSONL) and rotating backups.** Not `node:sqlite`. | Measured on the real ext4-on-LUKS disk: a 353 KB late-game state stringifies in 1.3-2.9 ms and saves durably in 2.6-11 ms (idle vs loaded machine). A journal append costs under 0.01 ms. `node:sqlite` is only a release candidate in Node 24 ("Stability: 1.2", RC since v24.15.0, synchronous API only, [docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)). |
| 8 | Presence | **Avatar position is client-owned and cosmetic.** The server clamps it and relays at 15 Hz. Remotes render 120 ms in the past with interpolation. | Presence never touches the economy, so there is nothing to reconcile ([Gambetta interpolation](https://www.gabrielgambetta.com/entity-interpolation.html)). |
| 9 | Transport | **ws over the same HTTP port, JSON text frames, `perMessageDeflate` off, `maxPayload` 64 KiB.** | ws already disables Nagle (`node_modules/ws/lib/websocket.js:248`). Deflate costs CPU and memory (ws README). LAN bandwidth is free. |
| 10 | Anti-exploit | **Clients send only intents** (type + ids + tile coords). The server computes every price, quantity and time. Arguments are schema-checked, content lookups are own-key only, there are token-bucket rate limits, and `(cid,seq)` dedupe. | A private game, but "no exploits" also means "no accidental exploits from bugs". |
| 11 | Content | **Frozen data tables in `shared/content/*.js`**, validated at import and hashed. A balance simulator drives the real rules engine. | Balance is checked by numbers, not feel. One source of truth serves server, client, tests and the simulator. |
| 12 | Renderer | **Three.js r186 `WebGLRenderer` (WebGL2), not WebGPU.** | Chrome on Linux ships WebGPU by default only on Intel Gen12+ and some NVIDIA setups. AMD needs flags ([cinevva](https://app.cinevva.com/guides/webgl-webgpu-not-supported-fix)). WebGPU is also secure-context only ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)), and the partner's `http://192.168.x.y:3300` page is not a secure context. |
| 13 | Rendering cost | **Demand-driven frame pacing:** 60 fps while interacting (plus a 2 s tail), 30 fps for the always-on ambient sway, 10 fps when the window is blurred, 0 when the tab is hidden. True render-on-demand (0 fps when nothing changes) under `prefers-reduced-motion` or the *Still* setting. Static shadow map re-rendered only on change. Instancing for crops, fences and decor. | The laptop throttles thermally (63 to 33 fps over 4 minutes in wow-arena's measurements). Its frame was CPU-bound on render submit: 9.3 ms of a 16.6 ms frame at 162 draw calls. |
| 14 | Picking | **Analytic ray-plane intersection gives the tile** ([`Ray.intersectPlane`](https://threejs.org/docs/pages/Ray.html)). Tall objects are found with an AABB proxy test. | Picking cost is constant, with no mesh raycasts over thousands of instances. |
| 15 | Feedback policy | **World changes and counters are predicted (instant). Celebrations wait for confirmation** (level-up, achievement, quest complete). | Nothing celebratory can ever be "taken back". On a LAN the confirmation arrives within 5-20 ms anyway. |
| 16 | Server-initiated change | **System actions** (`_rollover`, `_settle`, `_orders`, `_bench`, …) go through the same `runAction`, journal and broadcast as player actions. One timer fires at `nextSystemDueAt(state)`, a pure shared function; due ones also run lazily before every player action. | Nothing changes state outside the pipeline, so replay stays exact. Clients never predict system actions; the rebase absorbs them (prototyped, §15.8). |
| 17 | Co-op guard rails | **Soft-confirm codes** (`RESERVED`, `PINNED`, `BIG_SPEND`): `check` refuses unless `args.confirm` names the code; the client asks the player and resends. **Joint actions** (duet recipes, high-fives, two-person chopping) are a state slot `{by, at}` that a *different* player completes within a window measured on server time. | Reservations, pinned decor and two-person moments all become ordinary validated, journaled actions with no new protocol. Simultaneous duet presses give one success and zero rejections (prototyped). |
| 18 | Undo window | **Purchases carry a receipt** `{coins, xp, until}`. Refund is allowed until `until`. The XP is granted only when the receipt settles (system action `_settle`). | A refund never has to claw back XP, so a level can never be lost or re-earned. That closes the buy-refund XP exploit by construction. |
| 19 | Daily and weekly counters | **Period counters** `{p: periodIndex, n}` read as 0 when `p` is not the current period. | "First 50 units per day", "10 thanks-hearts per day", "1 gift per day" need no reset job at all. |
| 20 | Units and network | **Metres in the world, integer tiles in the rules (`TILE_M = 2`).** Plain HTTP on the LAN, same-origin WebSocket, no secure-context API required; optional mkcert TLS. | Matches the asset and visual docs. Same-origin traffic on a private address avoids Chrome's Local Network Access prompt, and nothing breaks on the partner's non-secure `http://192.168…` page (§12.1). |

Port **3300** (3000 is taken by `wow-arena.service`). Data lives in `data/` (gitignored).

---

## 1. Context: what FarmVille 2 implies for the tech

- **FarmVille 2 is 3D models shown through a fixed isometric-style camera.** It was Zynga's first Flash Player 11
  Stage3D game, built with 3ds Max and the Flare3D engine ([Adobe Flash Player blog, FarmVille 2 tag](http://blogs.adobe.com/flashplayer/tag/farmville-2),
  [AWN](https://www.awn.com/news/zynga-taps-autodesk-farmville-2)). That means a perspective camera with a fixed
  pitch, low FOV and 90° yaw steps, plus soft warm lighting and animated 3D animals.
  A free-orbit camera is not what FV2 does.
- **Many independent timers, some with regenerating resources.** FV2 water regenerates at "1 Water every 3
  minutes". Wells give 10 water on a 4-hour regeneration ([FV2 wiki: Water](https://farmville2.fandom.com/wiki/Water)).
  Water "is needed to get the timer of your various crops and trees started"
  ([gamelytic](https://gamelytic.com/farmville-2-basic-money-and-currency-points-overview/)).
  Crops range from 1 minute (tomato) to 4 hours (wheat). Animals eat feed made in the feed mill and produce eggs,
  milk and cotton. Crafting chains are multi-step (flour, then batter, then scones)
  ([Gamezebo walkthrough](https://www.gamezebo.com/walkthroughs/farmville-2-walkthrough/)). Feed storage is capped at 25
  and buildings raise the cap ([FV2 wiki: Feed](https://farmville2.fandom.com/wiki/Feed)).
  The state model below therefore has generic **timed processes**, **regenerating resources** and
  **capped storages**, not crop-specific code.
- **FarmVille 1 crops wither** at 2.5x the growth time ([Wikipedia](https://en.wikipedia.org/wiki/FarmVille)).
  The sibling docs settle it: **no withering, no animal death, nothing decays while both players are away**
  (`fv2-core-loop.md` §20 rule 6, `progression-goals-coop.md` §6.2 rule 15). The time model would have supported
  it (`witherAt` derived from `readyAt`), so nothing in the architecture depends on that choice. "Over-ripe" can
  still be a purely cosmetic stage derived from `now - readyAt`.
- **FV2 needed a high frame rate on purpose.** "80% of our revenue comes from players with 15 frames per second or
  better", and FV2 shipped a software-rendering fallback that "turn[s] off a few bells and whistles"
  ([GDC 2013 postmortem](https://gdcvault.com/play/1018015/FarmVille-2-Postmortem-What-Grew), 34:10 and 36:15;
  transcript in `docs/research/sources/`). That is the case for quality tiers with a real low tier (§10.11).
- **The FV1 backend checked footprint collisions server-side.** "If a user places a house on their Farm, the
  backend needs to check that no other object in that user's farm occupies an overlapping space"
  ([HighScalability](https://highscalability.com/how-farmville-scales-to-harvest-75-million-players-a-month/)).
  Here the same check (`canPlace`) runs on both sides.
- **Co-op precedent: Stardew Valley.** "Money can be shared between all players or split individually", "All
  players share the same farmland", and "Each player has their own energy bar, their own Skills"
  ([Stardew wiki: Multiplayer](https://stardewvalleywiki.com/Multiplayer)). Its known co-op bugs are attribution
  desyncs on shared containers: items shipped by a farmhand "not giving gold" or not showing on the end-of-day screen
  ([forum](https://forums.stardewvalley.net/threads/bug-multiplayer-items-shipped-via-bin-not-giving-gold.7308/)).
  The lesson: the credit for an action and the action itself must travel in **one** authoritative delta.

---

## 2. State model

### 2.1 Principles (enforced by tests)

1. **Store facts, derive everything else.** Store `plantedAt` and `readyAt`. Never store `stage`, `isReady`,
   `level` (derive it from `xp`), storage caps (derive them from buildings) or "water now" (derive it from
   `{amount, at}`). Derived values cannot go stale or contradict each other.
2. **Absolute integer timestamps** (epoch ms, server clock), never durations-remaining.
3. **Integers only for money and items.** Multipliers are basis points (`fertBonusBp: 5000` = +50%), applied as
   `Math.floor(base * (10000 + bp) / 10000)` once, at the end. `Number.isSafeInteger` guards every write.
4. **Stable string ids** for content (`'wheat'`) and objects (`'k3x9a.17.0'`). Never array indexes. Content ids
   are never renamed. A removed def is marked `retired: true` (it still renders and works, but cannot be bought).
5. **One aggregate.** The whole farm is one plain JSON object. No class instances or Maps in it, so
   `JSON.stringify`, `structuredClone` and the ops all work unchanged.
6. **Consume inputs when a process starts, never when it completes.** Seeds are paid at plant, feed at feed time,
   ingredients at craft start. A started process can then never fail later. This one rule removes a whole family
   of co-op dead ends ("Mia sold the wheat my bakery needed").

### 2.2 Shape

```js
{
  schema: 1,                                  // persistence schema, see §5.5
  meta: { farmSeed: 2654435761, createdAt, version: 18234, contentHash: 'a91f…' },
  farm: {
    name: 'Harvest Hollow',
    xp: 18450,                                // level = levelFromXp(xp), derived (if level is shared; §2.7)
    wallet: { coins: 4210, gems: 12 },        // gems: earned only (achievements, quests); no real money
    inventory: { wheat: 42, egg: 7, flour: 3 },  // id -> integer count (barn + silo); sparse, see §2.5
    overflow: { egg: 4 },                      // above capacity: never blocks intake, drains first (§2.5)
    jars: { 'k3x9a.2.0': { name: 'Barn upgrade', target: 12000, coins: 4000, by: 'p2', release: null } },  // §15.7
    res: { 'p1:egg': { item: 'egg', qty: 5, by: 'p1', purpose: 'custard', until: 1759584600000 } },  // §15.2
    ledger: [ /* ring buffer (max 500): { at, by, n, reason } for every coin movement, §15.7 */ ],
    buffs: { goldenHour: { from: 1759411000000, until: 1759412800000 } },  // windows, never rates (§15.6)
    joint: { 'oven.k3x9a.9.0': { by: 'p1', at: 1759411820000 } },          // pending two-player actions (§15.4)
    pity: { feathers: 6 },                     // collection pity counters (§2.9)
    resources: { water: { amount: 18, at: 1759411820000 } },  // regenerating, see §2.4 (only if water exists)
    expansions: ['home', 'east_meadow'],      // unlocked land rects come from content
    objects: { /* id -> Obj, see §2.3 */ },
    orders: { slots: [ { n: 17, availableAt: 1759412300000, order: null,   // null = refilling; filled by `_orders`
                         pin: null /* "I'm on it": pid */, flag: null /* help flag: pid */ } ] },   // §4.5, §15
    quests: { active: { q_first_bread: { progress: { craft_bread: 1 } } }, done: { q_tutorial_1: 1759400000000 } },
    achievements: { harvest_100_wheat: { at: 1759400000000, by: 'p2' } },
    stats: { 'harvest.wheat': 140, 'coins.earned': 25110, 'coins.spent': 20900 },  // flat counters
    mastery: { wheat: 140 },                  // per-crop harvest count -> stars, derived
    daily: { day: 20363, seed: 91822, claimed: {} },  // lazy rollover, see §4.5
    notes: [ { id: 'k3x9a.40.0', by: 'p1', at: 1759400000000, text: 'Corn is for the pie!', x: 12, z: 4 } ],
    feed: [ /* ring buffer (max 60) of notable events for "while you were away" */ ],
  },
  players: {
    p1: { name: 'Rowan', color: '#e8a33d', avatar: { body: 'farmer_a', hat: 'straw' },
          xp: 9100, hearts: 37, rested: { amount: 120, at: 1759411000000 },   // rested XP uses the regen shape
          stats: { 'harvest.wheat': 80 }, achievements: {}, almanac: { day: 20363, tasks: [] },
          giftBox: [], seen: { story_ch1: 1759400000000 }, lastSeenAt: 1759411000000, settings: {} },
    p2: { /* same shape */ },
  },
}
```

That object is the **replicated game state**. The server sends it in `welcome`, changes it only through `Tx`, and
every client holds a copy. Server-private bookkeeping is **not** in it. It is mutated outside transactions, so in
the replicated state it would silently diverge from the clients' copies, and it holds secrets. It lives in a
sidecar that is saved in the same snapshot file but never sent:

```js
server: {
  clock: { lastNow: 1759412000000 },                                      // monotonic guard, §4.1
  clients: { k3x9a: { pid: 'p1', lastSeq: 77, seenAt: 1759411000000 } }, // dedupe, §3.7; pruned after 24 h
  auth: { p1: { tokenHash: 'sha256…' }, p2: { tokenHash: 'sha256…' } },   // §7, rule 8
}
```

### 2.3 Placeable objects, footprints, the grid

Every placed thing is an entry in `farm.objects`. `def` points into the content tables. Shapes by kind:

```js
// plot (soil), 1x1
{ def: 'plot', x: 10, z: 4, rot: 0, placedAt, by: 'p1',
  crop: { def: 'wheat', plantedAt, readyAt, by: 'p2', water: 1, fertBp: 0, cycle: 0 } | null }
// tree (repeat harvest)
{ def: 'apple_tree', x, z, rot: 0, placedAt, by, cycle: 12, startedAt, readyAt: null | t }
// animal (lives on its home tile; wandering is cosmetic and deterministic, see §10.6)
{ def: 'chicken', x, z, rot, placedAt, by, bornAt, fedAt: null | t, readyAt: null | t, cycle: 30 }
// production building (sequential queue, inputs consumed at enqueue)
{ def: 'bakery', x, z, rot: 1, placedAt, by, builtAt /* construction readyAt */,
  queue: [ { r: 'bread', s: 1759412000000, e: 1759412900000, by: 'p1' } ] }
// decor / fence / path tile
{ def: 'fence_wood', x, z, rot: 0, placedAt, by }
```

- **Footprint.** Content gives `size: [w, d]` in tiles. `rot ∈ {0,1,2,3}` is quarter turns (an integer, never
  degrees), and odd `rot` swaps w and d. `(x, z)` is the **min-corner tile**. World units are **metres**, the
  convention of `assets-catalog.md` §6.3 and `visual-ux-juice.md` §3.4. One tile is **`TILE_M = 2`** metres
  (`content/config.js`): a plot of 2 x 2 m holds the 4-9 jittered plants of `visual-ux-juice.md` §3.6, the 8 m
  barn is 4 x 4 tiles, a cow fits one tile, and the visual doc's 128 m clearing is 64 x 64 tiles. Rules only ever
  see integer tiles. Only the renderer multiplies by `TILE_M`.
- **Layers.** Each def has `layer: 'ground' | 'object'`. Paths and soil decals sit on `ground`. Plots, trees,
  animals, buildings and fences sit on `object`. Two objects may share a tile only if their layers differ.
  Animals cannot stand on plots.
- **The grid index is derived and never persisted.** `getGrid(state)` builds an `Int32Array(W*H)` per layer
  (tile to object slot) and caches it on the state under a `Symbol` key. `JSON.stringify` and `structuredClone`
  both skip Symbol keys, so the cache never leaks into saves or deltas. The cache is invalidated by a version
  counter (also Symbol-keyed). `touchGrid(state, path)` bumps that counter whenever a write adds or removes
  `farm.objects[id]` or changes its `x`/`z`/`rot`/`def`. Rebuilding for 2,600 objects costs well under a
  millisecond. Placement edits are rare, so per-op incremental maintenance is not worth its complexity.
- `canPlace(state, defId, x, z, rot, ignoreId?)` checks: content exists and is unlocked, every footprint tile is in
  the unlocked land (union of expansion rects) and free on its layer, and the cost is affordable. The
  **placement ghost** (§10.7) and the server both call it.
- **Moving** keeps the id and all timers (`move {id, x, z, rot}`). Removing returns nothing. If "store" or "sell
  object" exists, the content table says what it refunds.

### 2.4 Timers: one model for everything that waits

All waiting is one of three shapes. Each has pure helpers in `shared/rules/time.js`, all taking `now`:

1. **One-shot process:** `{startedAt, readyAt}` (crop growth, animal production, tree cycle, construction).
   - `progress(o, now) = clamp01((now - startedAt) / (readyAt - startedAt))`
   - `stage(def, o, now)` = index into `def.stages` by progress. This is visual only and derived.
   - `isReady(o, now, grace = 0) = now + grace >= readyAt`
   - Speed-ups (if the design has any) **rewrite `readyAt`**. They never introduce a rate.
2. **Sequential queue:** buildings. Enqueue sets `s = max(now, last.e)` and `e = s + recipe.time`, with inputs
   consumed now. Collect takes every item with `e <= now` in order. Queue length is capped by `def.slots`.
3. **Regenerating resource:** water, or anything FV2-like.
   ```js
   // { amount, at }: `amount` was exact at time `at`; +1 every `period` ms up to `cap`.
   export function regenValue(r, cap, period, now) {
     if (r.amount >= cap) return r.amount;                  // over-cap from gifts is allowed, no regen
     return Math.min(cap, r.amount + Math.floor((now - r.at) / period));
   }
   export function regenSpend(r, cap, period, now, n) {     // caller already checked value >= n
     const v = regenValue(r, cap, period, now);
     // keep the partial progress towards the next unit, unless we were full (no banking while full)
     const at = v >= cap ? now : r.at + Math.floor((now - r.at) / period) * period;
     return { amount: v - n, at };
   }
   ```
   Tests must cover: spend at cap, spend just below cap, gifts above cap, and `now` exactly on a period boundary.

`nextVisualChangeAt(def, o, now)` returns the next stage boundary or `readyAt`. The renderer uses it to schedule
updates instead of polling every crop every frame (§10.5).

### 2.5 Wallet, inventory, storage

- `wallet` holds integer currencies, and its keys always exist, even at 0. `inventory` and `stats` are sparse maps
  where a missing key means 0. Their writes use `tx.inc(path, n, { dropZero: true })`, so a count that reaches 0
  disappears. This keeps the snapshot small and the shape canonical. Never use `dropZero` on wallet fields (§3.2).
- Capacity is **derived**: `capacityOf(state, 'barn')` sums `def.storage.barn` over built buildings plus a base.
  **A full barn never blocks a harvest or a collection** (`fv2-core-loop.md` §20 rule 5,
  `fv2-animals-trees-crafting.md` §6.8 E6, `progression-goals-coop.md` §8). Rules that *take in* goods
  (harvest, collect, craft collect, gift receive) always succeed. Whatever exceeds capacity goes to
  `farm.overflow` (an item map with the same shape as `inventory`). Overflow items can be sold or used but are
  never counted as free space, and the UI shows a gentle upgrade prompt. `STORAGE_FULL` exists only for
  *optional* intake, such as buying from the store. Selling is always allowed. A full barn is therefore never a
  dead end, and nothing is ever destroyed silently.
- `available(state, item)` = `inventory[item] + overflow[item]`, and consumption takes from overflow first, so
  overflow drains naturally.
- Every coin movement goes through `economy.earn(tx, n, reason)` / `economy.spend(tx, n, reason)`, which also bump
  `stats['coins.earned' | 'coins.spent']` and append to `farm.ledger`. The **ledger invariant**
  `wallet.coins + Σ jars.coins == start + earned + refunded - spent` is then a one-line test over any random play
  session. A refund bumps `coins.refunded`, never `coins.earned`, so it cannot feed an "earn N coins" goal. Moving
  coins into or out of a Savings Jar is neither earning nor spending (§15.7).

### 2.6 Progression: XP, levels, quests, achievements

The rules emit domain events through `tx.emit({e: 'harvested', crop, qty, by, id})`. After `apply`, the same
transaction runs `progress.processEvents(tx, ctx)`, a deterministic reducer that:

1. bumps `stats` counters (farm-level and `players[by].stats`),
2. adds XP from content (`def.xp`), and emits `levelUp` events when `levelFromXp` crosses a boundary, granting the
   level rewards from `levels.js` in the same `tx`,
3. checks achievements whose `stat` counter was touched (`{id, stat: 'cropsHarvested', tiers: [500, 5000, 25000],
   scope: 'F' | 'P' | 'T'}`; the scope letters and record shape are `progression-goals-coop.md` §5 and §9), writes
   `achievements[id] = {at, by, tier}` and emits `achievement`. One event bumps both an aggregate counter
   (`cropsHarvested`) and a per-item counter (`harvest.wheat`), so content can target either. A `T` (Together)
   achievement reads the per-player counters and needs a contribution from each player,
4. advances quest objectives with the same counter mechanism, so quests are just "counter deltas since accepted".

The loop repeats until no new events appear. It is bounded at 8 passes; a test asserts that it converges. The
action, its consequences and the credit all land in **one** tx, hence one delta and one journal line. That
removes the Stardew-style attribution desync by construction.

### 2.7 Shared vs per-player (follows `progression-goals-coop.md` §6.1)

| Shared (`farm.*`) | Per player (`players[pid].*`) |
|---|---|
| land, objects, barn inventory and overflow, the **Farm Treasury** (`wallet.coins`) and its Savings Jars, expansions, **Farm XP and level** (both players' XP summed), mastery, quest log, order board, F and T achievements, notes, feed, ledger, collections album, buffs | name, color, avatar and wardrobe, **Hearts** (personal currency for cosmetics), **personal XP and level** with rested XP, perk tree, P achievements, personal stats, 4 daily Almanac tasks, gift box, story-beat "seen" flags, settings, presence |

Stardew offers the money split as an option. The progression doc chooses a **shared treasury made safe** by Savings
Jars, reservations, a 10-minute undo window and a ledger (§15 implements each). The architecture keeps the
switch cheap anyway: scoped helpers `wallet(state, ctx)` and `stats(state, ctx, scope)` make a later move to
split money a single migration.

### 2.8 Object ids (created optimistically, collision-free)

The client must reference an object it just created (place a coop, then feed the chicken in it) before the server
answers. Ids are therefore **derived from the action envelope**, Figma-style ("assigning every client a unique
client ID and including that client ID as part of newly-created object IDs",
[Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)):

`newId(i) = \`${cid}.${seq.toString(36)}.${i}\``

`cid` is a random 5-8 char base-36 id per page load, made with `crypto.getRandomValues`. Do **not** use
`crypto.randomUUID`: it exists only in secure contexts
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)), and the girlfriend's browser at
`http://192.168.x.y:3300` is not a secure context. `seq` comes from the envelope and `i` is the n-th object created
by this action. Client and server compute the identical id, so the client never sends ids for new objects. The
server rejects an action whose new id already exists (`ID_TAKEN`). Collisions are practically impossible, but
this closes the door.

### 2.9 Randomness: stateless, keyed, predictable

`shared/rules/rng.js` exports `hash32(...keys)`, a Squirrel3- or murmur3-style integer hash over the seed and keys
([Eiserloh, "Noise-Based RNG", GDC 2017](https://www.gdcvault.com/play/1024365/Math-for-Game-Programmers-Noise)).
The talk lists unordered access, record and playback, and "network loss tolerance" as benefits. Usage:
`roll(ctx, 'bonus', obj.id, obj.crop.cycle) -> [0,1)`. Properties:

- client prediction equals the server result, so a bonus drop appears instantly and is never rolled back,
- journal replay is deterministic without storing RNG state,
- reconnecting or reloading cannot re-roll anything, because the key includes the per-object cycle counter,
- `Math.random` is **banned in `shared/`** (a test greps for it),
- **luck never gates progression** (`fv2-core-loop.md` §20 rule 4). Every drop that matters (collection
  pieces, collector sets) carries a pity counter `farm.pity[key]`: +1 on each miss, reset on a hit, and a forced
  hit at `def.pityAt`. The counter is ordinary state, so prediction and replay still match,
- a roll is computable in advance by anyone reading `shared/`. For two players on a private farm that is
  harmless, and it is the price of instant, never-rolled-back drops.

---

## 3. Action protocol, prediction, reconciliation

### 3.1 The action contract (`shared/rules/index.js`)

```js
// One entry per action type. ACTIONS is a null-prototype frozen object: ACTIONS['constructor'] is undefined.
export const ACTIONS = Object.freeze(Object.assign(Object.create(null), {
  plant: {
    schema: { id: 'objId', crop: ['content', 'crops'] },
    check(state, a, ctx) {                       // pure; returns null or an ERR code; no writes
      const plot = objectOf(state, a.id);
      if (!plot || defOf(plot).kind !== 'plot') return ERR.NOT_FOUND;
      if (plot.crop) return ERR.OCCUPIED;
      const crop = CONTENT.crops.get(a.crop);
      if (!isUnlocked(state, crop)) return ERR.LOCKED;
      if (state.farm.wallet.coins < crop.seedCost) return ERR.NO_COINS;
      // no water gate: watering is an optional yield multiplier, a separate `water` action (fv2-core-loop §20.1)
      return null;
    },
    apply(tx, a, ctx) {                          // assumes check passed; writes ONLY via tx
      const crop = CONTENT.crops.get(a.crop);
      economy.spend(tx, crop.seedCost, 'seed');
      // growth time is fixed HERE, once: buffs active at planting shorten it (§15.6); nothing rescales it later
      const growMs = applyGrowBuffs(tx.state, crop.growMs, ctx.now);
      tx.set(['farm', 'objects', a.id, 'crop'], {
        def: a.crop, plantedAt: ctx.now, readyAt: ctx.now + growMs, by: ctx.pid, watered: false, fertBp: 0, cycle: 0,
      });
      tx.emit({ e: 'planted', id: a.id, crop: a.crop, by: ctx.pid });
    },
  },
  // harvest, water, fertilize, feed, collect, craftStart, craftCollect, place, move, sell, expand, …
}));

// ctx = { now, pid, cid, seq, ext: { together }, newId(i) }   (CONTENT is imported, not passed)
export function runAction(state, act, ctx) {
  const def = ACTIONS[act.type];
  if (!def || (act.type.startsWith('_') && ctx.pid !== 'sys')) return { ok: false, code: ERR.UNKNOWN_ACTION };
  const args = parseArgs(def.schema, act.args);           // returns null on any mismatch or extra key
  if (!args) return { ok: false, code: ERR.BAD_ARGS };
  const code = def.check(state, args, ctx);
  if (code) return { ok: false, code };
  const tx = new Tx(state);
  try {
    def.apply(tx, args, ctx);
    processEvents(tx, ctx);                               // stats, xp, levels, achievements, quests (§2.6)
  } catch (err) {
    tx.rollback();                                        // the state is exactly as before: no half-applied action
    return { ok: false, code: ERR.INTERNAL, err };
  }
  return { ok: true, tx };
}
```

**Read before you delete.** While prototyping, a harvest rule read `o.crop.def` after `tx.del(...crop)` and
threw. `tx.rollback()` turned that into a clean `INTERNAL` reject instead of a half-applied harvest. Tests must
assert `ok === true` on happy paths, and the client logs `INTERNAL` loudly in dev.

### 3.2 The recording transaction (`shared/rules/tx.js`)

This is the reference implementation, validated by the prototype in §3.5. Paths are arrays of own-property keys.
Strict mode: a write whose parent does not exist throws. If parents were created implicitly, an undo would leave an
empty `{}` behind and the state would no longer round-trip.

```js
const isObj = (v) => v !== null && typeof v === 'object';
function parentOf(root, path) {
  let o = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isObj(o) || !Object.hasOwn(o, path[i])) throw new Error(`tx: no parent for ${path.join('.')}`);
    o = o[path[i]];
  }
  return o;
}
export function getAt(root, path) {
  let o = root;
  for (const k of path) { if (!isObj(o) || !Object.hasOwn(o, k)) return undefined; o = o[k]; }
  return o;
}
export function applyOps(root, ops) {                       // used by client (server deltas, undo) and tests
  for (const op of ops) {
    const p = parentOf(root, op.p);
    if (op.o === 's') p[op.p.at(-1)] = structuredClone(op.v); else delete p[op.p.at(-1)];
  }
}
export class Tx {
  constructor(state) { this.state = state; this.ops = []; this.undo = []; this.events = []; }
  get(path) { return getAt(this.state, path); }
  set(path, value) {
    // Everything that can throw (missing parent, uncloneable value) happens BEFORE any bookkeeping;
    // otherwise the undo log would hold an entry for a write that never happened and rollback would throw.
    const parent = parentOf(this.state, path);
    const v = structuredClone(value);                      // rules can never alias state
    const key = path.at(-1);
    const prev = Object.hasOwn(parent, key) ? parent[key] : undefined;
    this.undo.push(prev === undefined ? { o: 'd', p: path } : { o: 's', p: path, v: structuredClone(prev) });
    parent[key] = v;
    this.ops.push({ o: 's', p: path, v: structuredClone(v) });
  }
  del(path) {
    const prev = getAt(this.state, path);
    if (prev === undefined) return;
    this.undo.push({ o: 's', p: path, v: structuredClone(prev) });
    delete parentOf(this.state, path)[path.at(-1)];
    this.ops.push({ o: 'd', p: path });
  }
  // Emitted as a `set`, so ops stay idempotent. `dropZero` is for sparse maps (inventory, stats), where a
  // missing key means 0. NEVER use it for fields that must exist: if `wallet.coins` vanished at 0, a later
  // `coins < cost` check would compare `undefined < cost` (false) and let a purchase through.
  inc(path, n, { dropZero = false } = {}) {
    const next = (this.get(path) ?? 0) + n;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error(`tx: bad counter ${path.join('.')}=${next}`);
    if (next === 0 && dropZero) this.del(path); else this.set(path, next);
  }
  emit(ev) { this.events.push(ev); }
  inverse() { return this.undo.slice().reverse(); }
  rollback() { applyOps(this.state, this.inverse()); this.ops = []; this.undo = []; this.events = []; }
}
```

Both `Tx.set`/`Tx.del` and `applyOps` also call `touchGrid(state, path)`, which bumps the grid cache version
(§2.3). The client's grid then stays correct whether a change came from its own prediction, a server delta or an
undo.

The ops are **coarse** (whole `crop` object, whole `queue` array) and always `set`/`del`, never "increment". A
duplicated or replayed op is therefore harmless.

### 3.3 Server pipeline (`server/engine.js`)

```js
onAction(conn, { seq, type, args }) {
  if (!conn.buckets.act.take()) return conn.send({ t: 'rej', seq, code: ERR.RATE });
  if (!Number.isSafeInteger(seq) || seq < 1) return;                        // garbage: drop silently
  const c = server.clients[conn.cid];                                       // server-private sidecar (§2.2)
  if (seq <= c.lastSeq) return conn.send({ t: 'ack', seq, v: state.meta.version }); // duplicate after reconnect
  scheduler.runDue();                            // due system actions first (§15.1), journaled like any action
  const now = clock.now();
  const ctx = { now, pid: conn.pid, cid: conn.cid, seq, ext: { together: presence.together(conn.pid, now) },
                newId: (i) => `${conn.cid}.${seq.toString(36)}.${i}` };
  const r = runAction(state, { type, args }, ctx);
  c.lastSeq = seq; c.seenAt = now;                // advanced even on reject, so a re-sent reject is not re-run
  if (!r.ok) {
    if (r.code === ERR.INTERNAL) log.error('rule threw', type, args, r.err);
    return conn.send({ t: 'rej', seq, code: r.code, by: lastToucher(args, now, conn.pid) });  // "Mia got there first"
  }
  const v = ++state.meta.version;
  journal.append({ v, now, pid: conn.pid, cid: conn.cid, seq, type, args, ext: ctx.ext });  // before broadcast
  if (config.dev) assertInvariants(state);        // validateState after every action in dev (§9)
  broadcast({ t: 'd', v, by: conn.pid, cid: conn.cid, seq, now, ops: r.tx.ops, ev: r.tx.events });
  persist.markDirty();
}
```

- The server is the **third actor**. Midnight rollover, order-board refills, receipt settlement and similar
  changes run as system actions (`pid: 'sys', cid: 'sys'`, `seq` = the new `v`, so `newId` gives
  `sys.<v>.<i>`) through the **same** `runAction`, journal and broadcast. Nothing changes state outside this
  pipeline. `runAction` refuses any `_`-prefixed type unless `ctx.pid === 'sys'`. §15.1 has the scheduler.
- Every rule input that does not come from the state lives in `ctx.ext` (today only `together`, §6.6) and is
  journaled, so replay stays deterministic.
- `lastToucher` comes from an in-memory map `objectId -> {pid, at}`, filled from accepted actions' `args.id` and
  never persisted. It only makes rejection toasts friendly.

### 3.4 Client sync store (`public/js/net/sync.js`): undo-log rebase

The client keeps **one** state object: the predicted view. Each pending action carries its `undo` ops. On every
server message it rewinds the pending actions, applies the authoritative change and replays them. That is
Replicache's "rewinds … applies the patch … replays any pending mutations on top"
([Replicache](https://doc.replicache.dev/concepts/how-it-works)), without the cost of cloning.

```js
act(type, args) {                                          // called by the input layer
  const now = clock.serverNow();
  const seq = ++this.seq;
  const ctx = this.ctx(now, seq);
  const r = runAction(this.state, { type, args }, ctx);
  if (!r.ok) return r;                                     // not sent: show the reason locally (no round trip)
  this.pending.push({ seq, type, args, now, undo: r.tx.inverse() });
  this.socket.send({ t: 'act', seq, type, args });        // `now` is NOT sent: the server uses its own clock
  this.emitChange(r.tx.ops, r.tx.events, 'local');
  return r;
}
onServer(msg) {                                            // 'd' (delta) or 'rej'
  // safety net, checked BEFORE touching state; TCP keeps order, so a gap means a bug → full resync
  if (msg.t === 'd' && msg.v !== this.v + 1) return this.requestResync();
  const touched = [];
  for (const p of this.pending.slice().reverse()) {        // back to confirmed
    applyOps(this.state, p.undo);
    touched.push(p.undo);                                  // a doomed action's object must re-sync too
  }
  if (msg.t === 'd') {
    applyOps(this.state, msg.ops); this.v = msg.v;
    touched.push(msg.ops);
    if (msg.cid === this.cid) this.pending = this.pending.filter((p) => p.seq > msg.seq);
  } else {
    this.pending = this.pending.filter((p) => p.seq !== msg.seq);
    this.toast(msg);                                       // friendly text from code + `by`
  }
  for (const p of this.pending) {                          // replay with the ORIGINAL predicted `now`
    const r = runAction(this.state, p, this.ctx(p.now, p.seq));
    p.undo = r.ok ? r.tx.inverse() : [];                   // a doomed action is skipped; its 'rej' will follow
    if (r.ok) touched.push(r.tx.ops);
  }
  this.emitChange(touched.flat(), msg.ev, msg.t === 'd' ? 'server' : 'reject');
}
```

- **Change notification.** `emitChange` maps op paths to **object ids** (`['farm','objects',id,…]`) and
  **topics** (`wallet`, `inventory`, `quests`, `achievements`, `players`, `expansions`, `notes`). Views re-read
  only those ids from the state. They never diff the whole farm.
- **Cost.** Proportional to the paths touched by pending actions (usually 0-3 actions), not to farm size.
  `structuredClone` of a 2,600-object, 350 KB state measured **11.3 ms** on this laptop: too much per message,
  which is why the store does not clone.
- The input layer calls the same `check` before sending. Rejections therefore only come from **true races** with
  the partner, plus clock-edge cases (§4.3).

### 3.5 Validated by prototype

A throwaway prototype (scratchpad, not in the repo) used exactly the `Tx`, `runAction` and rebase shown above, with
one server and two clients, and random action, delivery and server-processing interleavings:

- *Both partners harvest the same ripe plot in the same instant.* Both clients predict the harvest. The server
  applies A's, then rejects B's with `EMPTY`. After delivery: **both clients deep-equal the server**, wheat is +2
  once, XP went to A only, and B shows one toast.
- *300 random interleavings* (plant and harvest on 2 plots by 2 clients, random latency and order): every run
  converged, `pending` drained, coins never went negative, and replaying the broadcast ops on a fresh copy
  reproduced the server state exactly.
- The §3.2 `Tx` code was **extracted from this document** and re-run against the same simulation. A strict-parent
  failure and an uncloneable value both throw, and `rollback()` still restores the exact prior state. An earlier
  draft recorded the undo entry *before* the parent check, which made rollback throw. Agents must keep the
  "validate first, then book-keep, then write" order and its test (`tx.test.js`).

### 3.6 Conflict cases and the graceful outcome

| Race | Server result | What each player sees |
|---|---|---|
| Both harvest the same plot | first wins, second gets `EMPTY` (`by` = partner) | The crop vanishes on both screens with no flicker, because the rebase lands on the same "harvested" state. Barn +N once (shared inventory). The loser gets a soft toast: "Mia got there first" plus a heart, and their floating "+2" fades instead of flying to the barn. |
| Both plant different seeds on the same plot | first wins | The loser's predicted crop turns into the winner's crop. Their seed cost was never charged on the server, and the rebase restores the counter. Toast. |
| Placing over the partner's fresh placement | `BLOCKED` | Rare in practice: the partner's **ghost and cursor are visible live** (§6.3), so the tint turns red before you click. |
| Partner sells the wheat my bakery is already baking with | cannot happen | Inputs are consumed at enqueue (§2.1 rule 6), so a started process never fails. If both click in the same instant (her `sell`, my `craftStart`), the second one gets `NO_ITEMS` plus a toast. Later attempts fail the local check before sending and say why. |
| Feeding an animal the partner just fed | `NOT_HUNGRY` | Same as the harvest race. |
| Collecting from a building the partner moved | works | Move keeps id and timers. If the partner *removed* it: `NOT_FOUND`, plus a toast. |
| Drag-harvest across 30 plots while the partner harvests half of them | each action is independent | You get credit for the plots you reached first. One combined toast ("Mia harvested 12 of these") rather than 12 toasts: coalesce `rej` toasts per 500 ms. |
| Both press a duet station in the same instant | first press opens the joint slot, second completes it | **No rejection at all.** Each client first predicts "waiting for partner", and the rebase turns it into the completed duet. The celebration plays on both screens from the confirmed event (prototyped, §15.8). |
| I refund a bench while the partner sits on it / plants next to it | refund needs the object pristine (`NOT_REFUNDABLE` otherwise) | Refund is a normal action; whoever is second gets a soft toast. The 10-minute window is measured on server time. |
| She sells eggs I reserved for custard | `RESERVED` (soft) | Her client already knows the reservation from the replicated state, so the confirm dialog ("Rowan saved 5 eggs for Custard. Sell anyway?") appears *before* sending. A race (I reserve while she sells) gets the same dialog via `rej RESERVED`. |
| Order slot: both deliver the last crate | first wins | The second gets `ALREADY_DONE`. The goods were not consumed on the server, and the rebase restores the counter. |

**Feedback policy.** Predicted, so instant: object appearance, timers, counters, floating "+N", item-fly
animation, sounds. **Confirmed-only:** level-up fanfare, achievement popups, quest-complete banners and the
"together bonus" sparkle. The client defers these until the matching event arrives in a `d` message. On a LAN that
delay is not perceptible, and a false celebration is impossible.

### 3.7 Batching, ordering, dedupe, reconnect

- **Batching.** The socket coalesces all `act` messages produced within one animation frame into one frame:
  `{t:'acts', list:[…]}`. The server iterates them in order, each fully independent. Drag-tools stay cheap.
- **Ordering.** A single WebSocket (TCP) delivers in order. The server processes in arrival order, and `v`
  increments once per accepted action.
- **Exactly-once.** The dedupe key is `(cid, seq)`. `server.clients[cid].lastSeq` is saved in the snapshot. On
  journal replay it is rebuilt as `max(seq)` per `cid`, so it survives a server restart. A `cid` not seen for 24 h
  is pruned.
- **Two tabs, same player:** two `cid`s, so no seq clash. Both act as the same `pid`.
- **Reconnect** (laptop sleep, server restart, Wi-Fi blip). The socket retries with backoff (250 ms, 500 ms, 1 s,
  2 s, then every 2 s) and shows a "Reconnecting…" pill. On `welcome` it receives the **full state** (§3.8):
  - drop pending with `seq <= lastSeq` (already applied; their effects are in the snapshot),
  - replay the rest locally on the fresh state and re-send them in order.

  This is Figma's flow: "downloads a fresh copy of the document, reapplies any offline edits on top of this latest
  state" ([Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)). While disconnected the
  client keeps predicting, capped at 100 pending actions or 30 s. After that it blocks input with a banner.
- **Content mismatch.** `welcome.contentHash !== CONTENT_HASH`: the page reloads (the server was updated).

### 3.8 Message table (`shared/net/protocol.js`)

Client to server:

| `t` | Fields | Notes |
|---|---|---|
| `hello` | `proto, cid, token?, claim?: {slot, name, color}` | First frame. Without a valid token: the slot picker. |
| `act` / `acts` | `seq, type, args` / `list` | Game intents |
| `ping` | `c` (client `performance.now()`) | Clock sync (§4.2) |
| `mv` | `x, z, f, a, cx?, cz?` | Presence: position, facing, anim, cursor ground point (floats rounded to 0.05; the hovered tile is `floor`; they also drive the partner's "hand of wind" uniform, §6.3) |
| `ghost` | `def, x, z, rot` or `null` | Build-mode ghost shared with the partner |
| `emote` / `mark` / `chat` | `id` / `x, z, kind` / `text` | Social; rate-limited |
| `resync` | none | Ask for a full state (should never be needed) |

Server to client:

| `t` | Fields | Notes |
|---|---|---|
| `welcome` | `pid, token?, state, v, serverNow, lastSeq, contentHash, peers` | Full state. 50-350 KB, about 10 ms on a LAN. |
| `d` | `v, by, cid, seq, now, ops, ev` | Every accepted action, to **all** clients including the sender (that doubles as the ack) |
| `rej` | `seq, code, by?` | To the sender only |
| `ack` | `seq, v` | Duplicate seq after a reconnect |
| `pong` | `c, s` | `s` = server `now` |
| `pr` | `ts, list: [[pid, x, z, f, a, cx, cz], …]` | Presence batch at 15 Hz, changed entries only |
| `peer` | `pid, online, name, color` | Join and leave |
| `emote` / `mark` / `chat` / `ghost` | relayed with `pid`, `ts` | |

Error codes (single enum, friendly text in the UI): `BAD_ARGS UNKNOWN_ACTION RATE NOT_FOUND EMPTY OCCUPIED
NOT_READY NOT_HUNGRY NO_COINS NO_ITEMS STORAGE_FULL LOCKED BLOCKED OUT_OF_BOUNDS QUEUE_FULL ALREADY_DONE
NOT_REFUNDABLE COOLDOWN SELF_ONLY ID_TAKEN INTERNAL`, plus the **soft** codes `RESERVED PINNED BIG_SPEND`, which
the client answers with a confirm dialog and a resend carrying `args.confirm` (§15.2).

Outside the socket there is one HTTP upload route, `POST /api/photos` (Memory Book, §15.7). It takes WebP or PNG
up to 2 MB, requires the player token in a header, and is rate-limited to 1 every 5 s. The state stores only
`{id, by, at, caption}`.

---

## 4. Time

### 4.1 The server clock (`server/clock.js`)

```js
now() {
  const t = Date.now() + this.devOffset;                 // devOffset only when HH_DEV=1 (time warp for testing)
  const last = server.clock.lastNow;                     // sidecar (§2.2), persisted with the snapshot
  if (t < last) {                                        // wall clock jumped back (NTP, manual change)
    if (last - t > 5000) log.warn('clock went back', last - t, 'ms; freezing game time');
    return last;                                         // game time never runs backwards
  }
  server.clock.lastNow = t;
  return t;
}
```

- Epoch ms, so **time keeps running while the server is off**. Crops grow overnight even with the laptop shut,
  which is FarmVille's whole premise. A forward clock jump is accepted, because the server is the authority.
- **Dev time warp:** `POST /api/dev/warp {ms}` adds to `devOffset`. It exists only when `HH_DEV=1`, is bound to
  loopback only, and is never in the systemd unit. The E2E and the designer use it to test 4-hour crops. Tests
  inject a fake clock object, or use `mock.timers.enable({ apis: ['Date'] })` from `node:test`
  ([docs](https://nodejs.org/docs/latest-v24.x/api/test.html)). A warp
  must end with `scheduler.runDue(); scheduler.arm()` (§15.1), or system actions that came due during the jump
  would wait for the next player action.

### 4.2 Client clock estimate (`shared/net/clock.js`, pure and testable)

This is NTP/Cristian-style: keep the sample with the smallest round trip, because its error is bounded by
±(RTT - RTT_min)/2 ([Cristian's algorithm](https://en.wikipedia.org/wiki/Cristian%27s_algorithm)).

```js
export class ClockSync {
  constructor() { this.samples = []; this.offset = null; }
  // c0: performance.now() at send, s: server epoch at receive, c1: performance.now() at pong
  add(c0, s, c1) {
    const rtt = c1 - c0;
    this.samples.push({ rtt, offset: s - (c0 + c1) / 2 });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    if (this.offset === null || Math.abs(best.offset - this.offset) > 250) this.offset = best.offset;  // jump
    else this.offset += (best.offset - this.offset) * 0.2;                                             // slew
  }
  serverNow(perfNow) { return perfNow + this.offset; }
}
```

- Ping 5 times at 200 ms intervals right after `welcome`, then every 10 s. Base it on `performance.now()`
  (monotonic), never on `Date.now()`, because the client's wall clock may be wrong or jump.
- `welcome.serverNow` seeds a coarse offset before the first pong, so the first frame already shows correct timers.

### 4.3 Readiness at the edge

The client shows "ready" when `serverNow() >= readyAt`. Its estimate can be a few ms ahead of the server, so the
server's readiness checks accept **`READY_GRACE_MS = 250`** (`isReady(o, now, grace)`). A harvest sent the instant
the timer hits zero then never bounces. The "advantage" is at most 250 ms per cycle of a minutes-to-hours timer,
which is meaningless. Grace is a shared constant in `content/config.js`, so replay stays deterministic. The client
predicts with grace 0, so it never sends early.

### 4.4 Offline progress and "while you were away"

Everything is computed from absolute times, so offline progress needs **no code at all**. "Gained =
f(now - savedAt)", as idle games do it ([GeekExtreme](https://www.geekextreme.com/idle-games-offline-progression-math/)).
On `welcome`, the client builds the "while you were away" card from:

- objects whose `readyAt` falls in `(players[me].lastSeenAt, now]` ("23 crops are ready, 6 chickens have eggs"),
- `farm.feed` entries since `lastSeenAt` written by the **partner** ("Mia planted 18 corn, crafted 4 pies, unlocked
  *Green Thumb*"). For a couple who play at different times, this is the main co-op glue when only one is online.

### 4.5 Day rollover and other "server-initiated" changes

- `dayIndex(now, tz)` uses `Intl.DateTimeFormat` with `HH_TZ` (default `Europe/Sofia`).
- **Lazy plus scheduled.** Before any player action, and before building `welcome`, the engine checks
  `dayIndex(now) !== state.farm.daily.day`. If so, it runs the system action `_rollover` (new daily seed, daily
  quests, order refresh), journaled and broadcast like any action. The scheduler's timer (§15.1) also fires at the
  next local midnight, so online players see it live.
- **Order board and visitors: deterministic generation, materialized once.** Each slot has `availableAt` and a
  counter `n`. When `now >= availableAt`, the system action `_orders` generates the order **into the state**
  (`slot.order = {...}`) from `hash32(farmSeed, 'order', slot, n)` and the farm's producers *at that moment*.
  An earlier draft computed the order at view time instead. That is wrong once generation depends on the state,
  which the sibling docs require: orders are built "from the farm's current producers" and "scaled to capacity"
  (`fv2-core-loop.md` §20 rule 8, `fv2-animals-trees-crafting.md` §5.3, E8, E13). A view-time order would change
  under the players' feet whenever the farm changed, and the two clients could disagree. Until the delta arrives,
  the client shows the slot as "a new order is on its way".
- **Weekly.** `weekIndex = Math.floor((dayIndex + 3) / 7)` gives Monday-start weeks (day 0, 1970-01-01, was a
  Thursday). `_rollover` also runs the weekly reset when the week index changes.
- **Period counters** remove most resets. A capped-per-period counter is stored as `{p, n}` where `p` is a day or
  week index. `periodCount(c, p) = c && c.p === p ? c.n : 0`, and `periodInc(tx, path, p, k)` writes
  `{p, n: periodCount + k}`. "Market demand bonus on the first 50 units per day", "at most 10 thanks-hearts per
  day", "first gift per giver per day" and "1 free reroll per day" all use it. None of them needs `_rollover`.

### 4.6 Background tabs

`requestAnimationFrame` stops in hidden tabs, which saves heat. Hidden-page timers are throttled to once per
second, and after 5 minutes hidden, chained timers are checked once per **minute**
([Chrome 88 throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)). So:

- **Liveness is checked by server-side ws ping frames** (every 15 s; terminate after 2 missed). The browser
  answers protocol pings natively, unaffected by JS throttling. This is the ws README's "detect and close broken
  connections" pattern (`node_modules/ws/README.md`).
- The client does not rely on its own `setInterval` for anything correctness-related. A presence heartbeat that
  arrives late only makes the partner's avatar idle.
- On `visibilitychange` to visible: one immediate `ping`, then `store.emitChange(all)` to refresh timers and badges.

---

## 5. Persistence

### 5.1 Decision: JSON snapshot plus action journal (a "memory image")

> "you can just keep the application state in main memory … Should the process crash, you can rebuild it from the
> events (and snapshots)." ([Fowler, Memory Image](https://martinfowler.com/bliki/MemoryImage.html))

Measured on this laptop's ext4-on-LUKS disk, with a synthetic **late-game** farm (2,620 objects: 900 plots,
120 trees, 60 animals, 40 queued buildings, 1,500 fences; 353 KB of JSON):

| Operation | Busy machine (first pass) | Idle machine (re-measured, real disk) |
|---|---|---|
| `JSON.stringify(state)` | 2.9 ms | 1.3 ms |
| `JSON.parse` | 4.3 ms | 1.8 ms |
| `structuredClone(state)` | 11.3 ms | 3.2 ms |
| write tmp + `fsync` + `rename` + dir `fsync` | 11.2 ms | 2.6 ms (run async: off the event loop except the stringify) |
| journal append (`writeSync`, page cache) | 0.01 ms | < 0.01 ms |
| `fdatasync` of the journal | 2.4 ms | 0.45 ms (async, batched once per second) |

The spread is the laptop's thermal and load state (other agents were building in parallel during the first pass),
which is itself a reason to keep per-message work tiny. Benchmark gotcha: the scratchpad (`/tmp`) is **tmpfs**,
where `fsync` is a no-op (0.00 ms measured). Durability numbers must come from a directory on the real disk, so
the persistence test writes into `test/.tmp-data/`, not `/tmp`.

| | JSON snapshot + journal (**chosen**) | `node:sqlite` |
|---|---|---|
| Status in Node 24.21 | stable `fs` | **Stability 1.2, release candidate** (RC since v24.15.0; unflagged but experimental since v22.13.0/v23.4.0, [docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)). It loads without a warning on 24.21 (checked). The API is synchronous only; just `sqlite.backup()` is async. |
| Fit to the access pattern | Whole aggregate in memory; disk is only for durability | Relational tables add a mapping layer, or you store a JSON blob in SQLite (then why bother) |
| Durability | Journal line per action: survives a process crash at 0 loss, a power cut at ≤ 1 s loss | WAL + `synchronous=NORMAL`: similar |
| Migrations | Plain JS functions over plain objects | SQL migrations plus JS mapping |
| Debuggability | `jq data/farm.json`; journal is a readable audit log; replay reproduces bugs | sqlite3 CLI |
| Backups | File copy (gzip) | `sqlite.backup()` |
| Event loop | Async writes; only stringify is synchronous (3 ms) | `DatabaseSync` is synchronous |

Switch to SQLite only if the game ever holds many farms, or the state grows past roughly 10 MB. The journal design
moves over unchanged (`journal(v INTEGER PRIMARY KEY, json TEXT)`).

### 5.2 Files (`HH_DATA_DIR`, default `./data`)

```
data/
  farm.json                    { schema, savedAt, version, state, server }  - latest snapshot (server = private sidecar)
  farm.journal.jsonl           one line per accepted action with v > snapshot.version
  farm.journal.upto-<V>.jsonl  exists only while (or if) a snapshot write is in flight / failed (§5.3)
  backups/farm-2026-10-02T21-00.json.gz   hourly (keep 48) + daily (keep 30)
  backups/farm.pre-migrate-v2.json        written before every migration
  incidents/                   state copies + logs when an invariant check fails
```

### 5.3 Write path

- **Journal.** `fs.writeSync(fd, JSON.stringify(line) + '\n')` **before** broadcasting each accepted action. This
  is synchronous, so it is ordered. A 1 s interval runs `fs.fdatasync(fd, cb)` if anything was written.
- **Snapshot** every 30 s if dirty, on `SIGINT`/`SIGTERM` (systemd stop), and after a migration:
  1. **Synchronously, in one go** (no `await` in between, so it is a consistent cut):
     `json = JSON.stringify({ schema, savedAt: now, version: V, state, server })`. Then `fdatasyncSync` and close
     the journal, rename `farm.journal.jsonl` to `farm.journal.upto-V.jsonl`, and open a fresh
     `farm.journal.jsonl`. Actions accepted while the asynchronous write below is still running (`v > V`) land in
     the **new** journal. If the journal were rotated after the write instead, those lines would be lost.
  2. Asynchronously: write `farm.json.tmp`, `filehandle.sync()`, `rename` over `farm.json`, then open the
     directory and `fsync` it. `rename(2)` replaces atomically: "there is no point at which another process
     attempting to access newpath will find it missing" ([man7](https://man7.org/linux/man-pages/man2/rename.2.html)).
     The directory fsync is what makes the rename durable, a step popular libraries skip
     ([write-file-atomic #64](https://github.com/npm/write-file-atomic/issues/64)).
  3. On success, delete `farm.journal.upto-V.jsonl`. On failure, keep it and log. Load replays every
     `farm.journal*.jsonl`, sorted and deduplicated by `v`, skipping `v <= snapshot.version`. A crash at any step
     therefore loses nothing.
- **Shutdown.** Stop accepting actions, final snapshot, `fdatasync`, exit 0. A second signal forces exit.
- Serialize writes: one `saving` promise at a time, and a dirty flag set during a save triggers another save.

### 5.4 Load and recovery

1. Read `farm.json`. On a parse error, rename it to `incidents/farm.corrupt-<ts>.json`, fall back to the newest
   backup, and log in red.
2. **Migrate** (§5.5).
3. `validateState(state)`: non-negative safe integers, objects in bounds, no layer overlaps, every `def` known (an
   unknown or retired def is refunded per `content.refund` and logged, never a crash), queue order, timestamps
   ≤ now + max duration.
4. **Replay** journal lines with `v > snapshot.version` (from all `farm.journal*.jsonl`, sorted by `v`) through
   `runAction`, using the **journaled** `now`, `pid`, `cid`, `seq` and `ext`. Also restore
   `server.clients[cid].lastSeq` and `server.clock.lastNow` from those lines. Rules are deterministic in those
   inputs, so the result is identical. If a line fails, stop replaying, keep the state, copy the journal to
   `incidents/` and log it. This should be impossible.
5. Snapshot immediately, so the journal starts empty.

There is no farm yet on first start: `createFarm(seed = crypto random, now)` from `shared/rules/state.js`.

### 5.5 Schema version and migrations

`server/migrations.js` exports an ordered array `[(s) => s /* 0→1 */, (s) => {…; return s;} /* 1→2 */]`. Load
runs `while (s.schema < CURRENT) s = migrations[s.schema](s), s.schema++`, after writing the pre-migrate backup.
Each migration has a fixture test: `test/fixtures/save-v1.json` must load at the current version and pass
`validateState`. The `meta.contentHash` changing is **not** a schema change. Content edits never need migrations
unless they remove or rename ids, which is forbidden (use `retired`).

---

## 6. Presence: avatars, cursors, pings, emotes, chat

### 6.1 Model

Presence is **not game state**. It is never persisted, journaled or predicted. Each client owns its avatar
position (click-to-walk with A* over the walkable grid, or WASD). The server only sanity-checks:

- finite numbers, inside farm bounds plus 1 tile,
- speed ≤ 1.5x `AVATAR_SPEED` over the time since the last accepted `mv`. Otherwise it clamps toward the claimed
  point, which handles teleports from bugs gracefully,
- rate ≤ 20 `mv` per second (token bucket).

It stamps `ts = clock.now()` on receipt (never trusting client time), stores `presence[pid]`, and at **15 Hz**
broadcasts `pr` with changed entries only. With two players this is about 15 x 60 bytes per second. When nobody
moves, nothing is sent.

### 6.2 Interpolation (`shared/net/interp.js`)

- Each remote avatar keeps a buffer of `(ts, x, z, f, a)`. Render time = `serverNow() - 120 ms`. Interpolate
  linearly between the bracketing samples. Facing uses the shortest arc.
- Past the newest sample: extrapolate with the last velocity for up to 150 ms, then hold.
- Why 120 ms: render "in the past" with enough buffer to always have two samples
  ([Gambetta](https://www.gabrielgambetta.com/entity-interpolation.html)). Source defaults to a 100 ms lerp "so that
  even if one snapshot is lost, there are always two valid snapshots"
  ([Valve](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)). Gaffer's numbers (350 ms at
  10 pps, 150 ms at 30 pps, [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)) are
  for lossy UDP. TCP on a LAN has no app-level loss, only occasional delay spikes, so 2 x 66 ms at 15 Hz minus a
  little is enough.
- The local avatar renders at its true position immediately.

### 6.3 Making co-op legible (cheap, high value)

- **Partner cursor.** The cursor's ground point (`cx, cz` floats, sent in `mv` at up to 15 Hz and only while it
  moves) draws as a soft ring in the partner's color with a tiny name tag and tool icon. It also feeds the
  `uCursorB` uniform, so crops bend away from the partner's hand exactly as from your own (`visual-ux-juice.md`
  §0.4 and §4.3; the interpolated point is used, never the raw packets). Like Figma's cursors, it prevents most
  conflicts before they happen. When the partner's pointer leaves the canvas, `cx` is omitted and the uniform's
  `w` eases to 0.
- **Partner ghost.** In build mode, `ghost {def, x, z, rot}` at ≤ 10 Hz shows the partner's placement preview
  semi-transparent in their color.
- **Action gestures.** Every `d` message carries `by`, and its events carry the target object. The partner's
  avatar plays the "work" gesture facing that target, and the item-fly effect goes from the target to *their*
  avatar. You see your partner harvesting even though actions are instant.
- **Map marks** (`mark {x, z, kind: 'look' | 'help' | 'heart'}`): a ring plus a sound on both screens, an
  off-screen arrow at the screen edge, at most 1 per second.
- **Emotes** (wave, heart, cheer, dance): an avatar animation plus a bubble.
- **Chat:** at most 200 chars, 2/s burst 5, rendered with `textContent` only. The last 50 lines stay in memory for
  late joiners. **Persistent notes** ("Corn is for the pie!") are a *game action* (`postNote`) stored in
  `farm.notes`, pinned to a tile, so an offline partner finds them later.
- **"Go to partner"** (key F, or a click on their portrait) eases the camera to their avatar.

### 6.4 Online and offline

A `peer` message fires on join and leave. The HUD portrait greys out when the partner is offline.
`players[pid].lastSeenAt` is updated on disconnect through a tiny system write: a normal journaled `_seen` action.

### 6.5 Avatar movement vs instant actions

Actions **commit instantly** and never wait for the avatar to walk there. That is the latency priority. The avatar
cosmetically jogs toward the work area (path via A*). If the target is more than about 12 tiles away, it does a
short "poof" hop. FV2 makes the farmer walk to each task first. Here that is a style option the designer can turn
on per tool, but it is never a gate on the state change.

### 6.6 Presence-dependent rules (e.g. a "together bonus")

If the design rewards playing at the same time, the server computes `ctx.ext.together` from **server-observed**
presence (the partner sent an `act` or `mv` within the last 120 s). It is journaled with the action, so replay
matches. The client predicts it from its own presence view. A mismatch is corrected by the normal rebase, and its
sparkle is confirmed-only.

---

## 7. Anti-exploit and robustness

This is a private two-player game, but "no exploits" also means no accidental exploits from bugs. Rules:

1. **Intents only.** `act` carries ids, tile coordinates, content ids and quantities to *sell*. The server derives
   every price, yield, time and reward from content plus state. The client never sends `now`, prices, item deltas
   or timestamps.
2. **Schema-validate every argument** (`shared/rules/schema.js`, about 60 lines, no dependency). Validators:
   `objId` (`/^[a-z0-9.]{1,40}$/`), `['content', kind]` (own key of that content Map), `int(min, max)`, `tile`
   (integer within farm max), `rot` (0..3), `qty` (1..9,999), `text(max)`. **Unknown extra keys reject** the action.
3. **Own-key lookups only.** Content lives in `Map`s, and state lookups use `Object.hasOwn`. wow-arena's hostile
   tests caught `cls: 'constructor'` resolving to an inherited property (`~/wow-arena/test/hostile.test.js`).
   Ids like `__proto__` and `constructor` fail the `objId` regex anyway.
4. **Numbers.** `Number.isSafeInteger` on every counter write (`Tx.inc` throws, and the action rejects atomically).
   Floats from presence are clamped, then rounded to 0.01. wow-arena hit `1e308` turning into `Infinity`, then into
   `null` in JSON for every viewer.
5. **The message router never throws.** `JSON.parse` sits in try/catch, non-object frames are dropped, and the
   whole handler is wrapped (pattern: `~/wow-arena/server/protocol.js`).
6. **Limits.** ws `maxPayload: 64 * 1024` (the default is 100 MiB); at most 8 connections; per-connection token
   buckets: `act` 40/s burst 120 (drag-harvest), `mv` 20/s, `ghost` 12/s, `chat` 2/s burst 5, `mark`/`emote` 1/s
   ([token bucket](https://en.wikipedia.org/wiki/Token_bucket)). Over the limit: `rej RATE` for actions, a silent
   drop for presence. 10 s of sustained abuse closes the socket.
7. **Exactly-once:** `(cid, seq)` dedupe (§3.7). **Atomicity:** `Tx.rollback` on throw. **Serialization:** a
   single-threaded engine with no `await` inside `runAction`.
8. **Identity.** Two player slots. The first `hello` with `claim` takes a free slot and gets a random token
   (stored in `localStorage['hh.token']`; the server keeps only a SHA-256 hash, in the private `server.auth`
   sidecar, never in the replicated state). A later `hello` with that token
   resumes the slot. Optional `HH_PASSPHRASE` for claiming. On a home LAN that is enough. The `Origin` header must
   match the `Host`.
9. **Dev endpoints** (`/api/dev/*`: warp, give, reset, drop) exist only with `HH_DEV=1`, are bound to `127.0.0.1`, and
   are **never in the systemd unit**.
10. **Economy invariants are tests, not hopes** (§8.3): no buy/sell arbitrage, no recipe cycle that creates coins
    without time, no reachable soft-lock.
11. **System actions are server-only.** `runAction` rejects any `_`-prefixed type unless `ctx.pid === 'sys'`, and the
    schema of `act` cannot carry `pid`. The second prototype asserts it.
12. **Bonuses that need the partner check identity, not intent.** Help-flag, revive, gift and harvest-split bonuses
    compare `ctx.pid` with the stored `by` (`SELF_ONLY`), and joint actions require two distinct pids. The
    progression doc's exploit table (§8) is implemented by these comparisons plus period counters.

---

## 8. Content tables and the balance simulator

### 8.1 Format (`shared/content/*.js`)

Plain arrays of frozen objects, one file per family. `index.js` builds `Map`s, validates and hashes them.
`fv2-animals-trees-crafting.md` §6.1 R10 says `shared/data/*.json`. The intent (data, not code, validated by a
test) is the same. JS modules win on three counts: comments next to tuned numbers, unit helpers (`min(3)`), and
one import path for both server and browser with no JSON-module import attributes and no `fetch` at boot.

```js
// shared/content/crops.js
import { min, h } from './units.js';                    // min(3) = 180000
export const CROPS = [
  { id: 'wheat', name: 'Wheat', unlock: 1, seedCost: 5, growMs: min(2), water: 1, yield: 2, sell: 6, xp: 2,
    model: 'crops/wheat', stages: [0, 0.25, 0.6, 1], feed: 1, tags: ['grain'] },
  { id: 'corn', name: 'Corn', unlock: 3, seedCost: 20, growMs: h(1), water: 1, yield: 3, sell: 14, xp: 6,
    model: 'crops/corn', stages: [0, 0.3, 0.7, 1], feed: 3 },
];
```

`index.js` exports `CONTENT = { crops: Map, trees: Map, animals: Map, buildings: Map, recipes: Map, items: Map,
decor: Map, expansions: Map, levels: [], quests: Map, achievements: Map, orders: [] }`, plus `CONTENT_HASH` (FNV-1a
over a canonical sorted-key JSON of everything) and `validateContent()`. Validation checks:

- unique ids across families that share the item namespace; every reference resolves (recipe inputs and outputs,
  animal feed, unlock levels ≤ max level, model files, icons),
- positive safe integers; `stages` increasing in [0, 1]; footprints ≥ 1; `unlock` ordering is sane,
- `id` matches `/^[a-z][a-z0-9_]{0,31}$/`.

It runs in a test and at server start (exit with a clear error). Content is data only: no functions, no
`Math.random`, no `Date`.

### 8.2 Balance simulator (`tools/balance-sim.mjs`)

It imports the real `shared/rules` and a server-less `Engine`. Virtual time is event-driven: jump to
`min(next readyAt, next session start)`, so 30 simulated days run in seconds. Seeded.

- **Player policies:** `diligent` (checks every 10 min while awake), `casual` (3 sessions per day of 15 min),
  `weekend` (1 long session per day), and `couple` (two casual players with offset schedules acting on the same
  farm). That last one is the real target. Policies are greedy: harvest everything, replant the best
  coins-per-minute crop they can afford for their next return, feed, collect, queue the most valuable affordable
  recipe, fulfil orders, expand when affordable.
- **Output** (markdown to `docs/balance/report.md`, plus CSV): level per day, coins and gems over time,
  time-to-unlock for every def, % of session time with "nothing to do", storage-full events, quest completion
  times, and the coins-per-hour curve per crop at each level.
- **Assertions** (`test/balance.test.js`, fast settings): pacing bands set by the designer (for example
  "level 2 within 5 minutes, level 5 within the first session, every def reachable by day 30 for `couple`, never
  more than 40% idle in a 15 min session after day 1").

### 8.3 Exploit and dead-end proofs (tests over content)

- For every item, `sell < cost to obtain` (seed, buy price, or input value).
- **No coin pump:** build a graph from items through recipes to items. For every cycle, `Σ sell(outputs) ≤
  Σ cost(inputs)`, ignoring time. Report the best coins-per-minute route (that is tuning info, not an error).
- **No soft-lock:** from fuzzed reachable states (random play, then spend everything, sell nothing),
  `canProgress(state)` must be true. Either something is growing or producing, or a sellable item exists, or
  coins ≥ cheapest seed, or the free fallback exists. Suggestion for the design: a **free starter seed** that is
  always plantable at 0 coins.
- `xp` per action > 0 for every core loop, and the level table is strictly increasing.

---

## 9. Testing strategy

`npm test` runs `node --test "test/**/*.test.js"` (glob support and `--test-concurrency` are built in,
[docs](https://nodejs.org/docs/latest-v24.x/api/test.html)). Target: under 20 s, all green before any agent
finishes.

| Suite | What it proves |
|---|---|
| `tx.test.js` | `apply → undo` restores deep-equal state; `applyOps(clone(before), ops)` equals after; strict parents; `inc` guards |
| `rules.<family>.test.js` | per action: happy path (`ok`), **every** `check` code, timer boundaries (`readyAt-1`, `readyAt`, `+grace`), integer edges, unknown and prototype ids |
| `registry.test.js` | every `ACTIONS` key has a schema, a check, an apply and at least one test mentioning it |
| `purity.test.js` | `shared/**` contains no `Math.random`, `Date.now`, `performance.now`, `new Date(`, `node:` import or DOM access (only `shared/net/clock.js` may take timestamps, as parameters) |
| `invariants.test.js` | 10,000 random actions from 2 players with random time jumps: never negative, no overlaps, ledger balanced, `validateState` holds, and **ops replay equals state** (catches rules that mutate without `tx`) |
| `sync.test.js` | in-process server plus 2 `SyncStore`s with injectable latency and reordering (like wow-arena's `netcode.test.js`): convergence, pending drains, the simultaneous-harvest case, reconnect with pending resend, doomed actions |
| `clock.test.js` | `ClockSync` with asymmetric and jittery RTTs; the server clock monotonic guard |
| `persist.test.js` | snapshot round trip; **crash test**: spawn the server, send N actions, `SIGKILL`, restart, state at version N; corrupt snapshot falls back to a backup; journal replay; fixture migrations |
| `protocol.test.js` | hostile frames (copy the wow-arena `hostile.test.js` approach): garbage JSON, wrong types, huge numbers, prototype keys, actions before `hello`, rate limits; the server never throws |
| `presence.test.js` | speed clamp, bounds, interpolation buffer edges |
| `system.test.js` | `dueSystemActions`/`nextSystemDueAt` at every boundary (midnight in `HH_TZ` across a DST change, order `availableAt`, receipt `until`, bench `since + 10 s`); a 3-day downtime catches up in one `_rollover`; a player sending any `_`-prefixed type gets `UNKNOWN_ACTION`; the scheduler delay never exceeds `MAX_DELAY` |
| `coop.test.js` | the §15.8 prototype as a suite: simultaneous duet presses (one success, no reject), solo double press, lapsed window, chop combos, receipts (refund window, pristine rule, XP only on `_settle`), soft codes with and without `confirm`, reservation expiry, the jar ledger invariant |
| `period.test.js`, `goals.test.js` | period counters roll over without a reset action; `goals(state, pid, now)` returns Now, Soon and Big for fuzzed reachable states (progression §3.4) |
| `content.test.js`, `economy.test.js`, `balance.test.js` | §8 |

### 9.1 Headless two-client E2E (`tools/e2e-coop.mjs`, `npm run test:e2e`)

This is modelled on `~/wow-arena/tools/shot.mjs`. It starts its own server on a free port with a temp data dir
and `HH_DEV=1`, and launches Chrome via puppeteer-core (`/opt/google/chrome/chrome`). It opens **two browser
contexts**, which "won't share cookies/cache with other browser contexts"
([Puppeteer](https://pptr.dev/api/puppeteer.browser.createbrowsercontext)), so each holds its own `hh.token`. It
drives them through a test hook, `window.__hh = { store, act, state, pending, net, view, dev: { warp } }`:

1. A claims slot 1, B claims slot 2. Each sees the other's avatar within 300 ms.
2. A plants. B's state contains the crop within 100 ms.
3. `dev.warp(growMs)`. Both see "ready" badges.
4. **Race:** `Promise.all([A.act('harvest'), B.act('harvest')])`. Exactly one `harvested` event on the server,
   barn +yield once, B's toast, both states deep-equal the server.
5. **Stall and drop are different tests.** Measured here (Chrome 154, puppeteer-core): `page.setOfflineMode(true)`
   does **not** close an open WebSocket. Messages in both directions are held (`readyState` stays 1, no `close`
   event) and are all delivered once offline mode ends. Older reports describe the opposite DevTools behaviour
   ([google-chrome-developer-tools thread](https://groups.google.com/g/google-chrome-developer-tools/c/Hq5k822cgxo)),
   so do not rely on either without re-checking. Hence:
   - *stall* (a Wi-Fi hiccup): `setOfflineMode(true)`, B acts 3 times (predicted locally, pending = 3),
     `setOfflineMode(false)`; the held frames arrive in order and states converge;
   - *drop* (laptop sleep, server restart): the dev route `POST /api/dev/drop {pid}` calls `ws.terminate()` on
     B's socket; B acts 3 times while reconnecting, the `welcome` path re-sends them, and states converge.
6. A builds; B sees the ghost while A is still placing.
7. Server restart mid-session: both reconnect, states are intact.
8. **Duet:** A and B press the same station within 1 s. One `duet` event; both screens show the celebration;
   neither shows a toast.
9. Screenshots of both views (`docs/screens/e2e-A.png`, `-B.png`). `console` and `pageerror` lists must be empty.

It prints one JSON line `{ok, errors, latencies, files}`. It also measures **click-to-pixel latency**
(`performance.mark` at input and at the render that shows the change). Target ≤ 1 frame locally.

**Run step 2 a second time against the machine's LAN IP** (`os.networkInterfaces()`), not `localhost`.
`localhost` is a secure context and the LAN IP is not. That is the path the second player actually uses, and it
catches secure-context-only APIs.

Visual checks use `tools/shot.mjs`, as in wow-arena. Default headless runs use SwiftShader, so their `fps` is **not
a measurement** (wow-arena perf notes). For real GPU numbers use
`--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist --disable-gpu-vsync --disable-frame-rate-limit`.
That reports this laptop's `RADV RENOIR` Vega. Compare A/B pairs interleaved, because the machine thermally
throttles.

---

## 10. Rendering architecture

### 10.1 Renderer and budgets

- three **0.186** via the import map: `"three": "/vendor/three/build/three.module.js"`,
  `"three/addons/": "/vendor/three/examples/jsm/"`. Serve the whole `node_modules/three/build` directory, because
  `three.module.js` imports `./three.core.js`.
- `WebGLRenderer({ antialias: tier !== 'low', powerPreference: 'high-performance', stencil: false })` (the
  setup code is in `visual-ux-juice.md` §4.1; `high-performance` changes nothing on the owner's iGPU-only laptop and
  picks the discrete GPU if the partner's PC has one), `outputColorSpace = SRGBColorSpace`,
  `toneMapping = NeutralToneMapping` (keeps the saturated FV2 palette; `AgXToneMapping` is the alternative),
  exposure about 1.0. `shadowMap.type = PCFShadowMap`. **`PCFSoftShadowMap` is removed as of r186**: the
  renderer warns "PCFSoftShadowMap has been removed. Using PCFShadowMap instead." (`src/renderers/webgl/WebGLShadowMap.js`).
- Use `THREE.Timer` with `timer.connect(document)`, not `Clock`. `Clock` has been deprecated since r183, and `Timer`
  uses the Page Visibility API to avoid huge deltas after a hidden tab ([docs](https://threejs.org/docs/pages/Timer.html)).
- **Budgets** for the Vega iGPU at 1920x1200, `high`: **≤ 120 draw calls target, 150 alarm** (wow-arena spent
  9.3 ms of a 16.6 ms frame in `renderer.render()` submit at 162 calls), ≤ 300k visible triangles, one
  shadow-casting light, no per-frame allocations, DOM HUD writes only on change. The rest of the budget table
  (GPU ms, particles, texture memory, DOM nodes per frame) is `visual-ux-juice.md` §4.15. Where its draw-call
  numbers (150 target, 250 ceiling) differ, the measured submit cost above wins (§16).
  The debug overlay (F3) shows fps, `renderer.info.render.calls`, triangles, RTT, clock offset, pending count and
  `v`.
- **Materials.** `MeshLambertMaterial` by default, deduped by content. In wow-arena, Lambert instead of Standard
  measured +2.9% fps with identical-looking flat-shaded CC0 art. Use `MeshStandardMaterial` only for the few
  hero surfaces where it is visibly better (water, if not a custom shader).

### 10.2 Scene graph layers

```
scene
├─ sky        gradient dome (vertex colors) + distant hill ring + fog (linear, horizon-matched)
├─ terrain    base grass mesh (1 draw); locked expansions as a darker overlay with "for sale" signposts
├─ ground     instanced ground-layer tiles: soil, paths, flowerbeds (1 InstancedMesh per tile type)
├─ gridFx     grid lines + footprint highlight (build mode only)
├─ crops      InstancedModel per (crop, stage) part; see 10.3
├─ objects    trees, buildings, fences, decor: InstancedModel per def (fences auto-pick straight/corner/T variants)
├─ animals    SkinnedMesh clones + AnimationMixer (≤ 40); beyond that, instanced static + vertex-shader bob
├─ avatars    2 SkinnedMesh + nameplates (DOM)
├─ badges     instanced camera-facing quads from one icon atlas ("ready", "hungry", "needs water")
├─ fx         pooled particles (Points), sparkles, rings; item-fly and floating text are DOM (cheap and crisp)
└─ ui3d       hover outline, partner cursor and ghost, own ghost, marks
```

Lights: `HemisphereLight` (sky `#cfe8ff`, ground `#8a7550`) plus a warm `DirectionalLight` sun (`#fff0d0`, about
50° elevation) with shadows, plus a small ambient. No point lights in the world. Glows are emissive materials.

### 10.3 Instancing

An `InstancedModel` abstraction (`render/instancing.js`) wraps a **prepared model**: a list of
`{geometry, material}` parts with baked transforms (§10.8). It drives one `InstancedMesh` per part in lockstep,
with `add(key, matrix, color?) → slot`, `move(slot, matrix)`, `remove(slot)` (swap with the last and fix the
moved key's slot) and `count`.

- `InstancedMesh` has **no resize** in r186. Allocate capacity (for example 256), draw only `mesh.count` of them,
  and when full rebuild at 2x (rare). `BatchedMesh` *can* grow (`setInstanceCount`, `setGeometrySize`; r186
  source checked).
- **Stale culling sphere (r186 gotcha).** `InstancedMesh.boundingSphere` starts `null`, and the frustum test
  computes it once on first use (`if (object.boundingSphere === null) object.computeBoundingSphere()`,
  `src/math/Frustum.js`). It is never recomputed after that. An instance added or moved outside the old sphere
  then vanishes whenever the original instances leave the screen. After any `add` or `move` that grows the
  extent, `InstancedModel` sets `mesh.boundingSphere = null` (recomputed lazily on the next frame).
- After writes, set `instanceMatrix.needsUpdate = true` once per frame, not per write.
- `instanceColor` gives per-instance tint: wet vs dry soil, fertilized glow, partner-colored outline.
- **Crops:** one `InstancedModel` per `(crop, stage)`. A stage change is `remove` from one and `add` to the next.
  Typically 10-30 active combinations, so 10-30 draw calls plus the shadow pass.
- **If crops blow the draw-call budget:** move them to a **`BatchedMesh`**. It renders many geometries with one
  material in a single multi-draw call, supports `addInstance`, `setGeometryIdAt` (a stage change becomes one
  call), `setColorAt` and `perObjectFrustumCulled` ([docs](https://threejs.org/docs/pages/BatchedMesh.html); r186
  source verified). Its precondition is that all crop geometries share one material and the same attribute set,
  which the asset-prep step must guarantee (palette texture or vertex colors).
- Frustum culling for an `InstancedMesh` uses one bounding sphere over all instances
  ([docs](https://threejs.org/docs/pages/InstancedMesh.html)), so a big farm should chunk decor into 16x16-tile
  groups. Not needed below about 64x64 tiles at the planned zoom range.

### 10.4 Frame pacing: render on demand with an ambient cap

Continuous 60 fps for an idle farm is how the laptop overheats. Rendering on demand is the standard Three.js
answer ("rendering continuously is a waste of the device's power",
[threejsfundamentals](https://github.com/gfxfundamentals/threejsfundamentals/blob/master/threejs/lessons/threejs-rendering-on-demand.md)).
A farm still needs some life. The visual design makes the board permanently alive: wind sway on a 60 BPM grid,
the cursor's "hand of wind", water, animals (`visual-ux-juice.md` §0.3-0.5). So with the default settings the
board never reaches "nothing to draw". The levers are the **rate** of ambient frames and a **true idle** mode for
players who turn motion off:

```js
let interactiveUntil = 0, nextAt = 0;
renderer.setAnimationLoop((t) => {
  timer.update(t);
  const dt = timer.getDelta();
  // 2 = interactive: input this frame, camera tween, drag-paint, own avatar walking, tweens or particles alive
  // 1 = ambient: wind sway, water, animals, partner moving
  // 0 = static: only when motion is reduced (prefers-reduced-motion or the "Still" setting) and nothing moves
  const want = Math.max(input.consume(), camera.update(dt), tweens.want(), fx.update(dt), avatars.update(dt),
                        animals.update(dt), ambient.want());
  if (want === 2) interactiveUntil = t + 2000;             // short tail so a finishing ease never drops frames
  const mode = t < interactiveUntil ? 2 : want;
  if (!dirty && mode === 0) return;
  const fps = mode === 2 ? 60 : document.hasFocus() ? quality.ambientFps : 10;
  if (t < nextAt - 1) return;                              // time-aligned cap: also holds 120/144 Hz screens at 60
  nextAt = Math.max(nextAt + 1000 / fps, t);               // re-sync after a stall instead of bursting
  dirty = false;
  WORLD.uTime.value = t / 1000;                            // the shared sway/water/particle clock
  objectsView.flushScheduled(clock.serverNow());           // stage changes and badges that came due (10.5)
  renderer.render(scene, camera3);
});
```

- `quality.ambientFps`: high 30, medium 24, low 15. "Eco" in settings forces 20. "Still" (and
  `matchMedia('(prefers-reduced-motion: reduce)')`) sets sway amplitude to 0, so the loop renders only on change.
  That honours the OS accessibility setting and is also the coolest mode
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)).
- The interactive tail is **2 s after the last interactive cause**. `visual-ux-juice.md` §4.2 proposes 45 s. The
  shorter tail is enough because every tween, particle burst and camera move reports itself through `want`
  while it runs, so 60 fps lasts exactly as long as something needs it. 45 s of 60 fps after every click would
  roughly double GPU time in a normal tending session for no visible gain (§16).
- A hidden tab stops rAF entirely. A blurred window (playing something else) gets 10 fps.
- `dirty` is set by store changes, pointer hover changes, resize and asset loads.

### 10.5 Time-driven visuals without polling

`objectsView` keeps a **min-heap of `(at, objectId)`** from `nextVisualChangeAt` (§2.4). Each rendered frame pops
only due entries, re-syncs those objects (stage mesh, badge) and pushes their next time. A store `change` for an
id re-syncs it and re-schedules it. There is no per-frame loop over 900 crops. Countdown text in tooltips reads
`readyAt - serverNow()` only for the hovered object.

### 10.6 Animals and avatars

- Animal wandering is **cosmetic and deterministic**: a position within a 1.5-tile radius of home, chosen by
  `hash32(objId, floor(serverNow / 6000))` with eased walks between those points. Both players see the cow at the
  same spot with zero network traffic ("the brown cow next to the barn" means the same cow on both screens).
- Mixer updates are throttled: off-screen ones skipped, far ones every 3rd frame. Clips are cached per model.
- Avatars: CC0 rigged farmer models (see `assets-catalog.md`), merged body parts per wow-arena's `mergeBodyParts`
  trick, `frustumCulled = false` on skinned meshes. wow-arena measured culling characters as costing more than it
  saved.

### 10.7 Picking and the placement ghost

```js
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pick(ndc) {
  raycaster.setFromCamera(ndc, camera3);
  // 1) tall things first: AABB proxies of objects taller than ~0.6 tiles near the ray's ground hit
  const hitObj = proxies.nearestHit(raycaster.ray);              // Box3 tests on a few dozen candidates
  if (hitObj) return { kind: 'object', id: hitObj.id };
  // 2) the tile under the cursor, analytically
  if (!raycaster.ray.intersectPlane(ground, tmpV)) return null;
  const x = Math.floor(tmpV.x / TILE_M), z = Math.floor(tmpV.z / TILE_M);   // metres -> integer tiles
  const id = tileOwner(store.state, x, z);                       // grid lookup, object layer, then ground layer
  return id ? { kind: 'object', id, x, z } : { kind: 'tile', x, z };
}
```

- Pick on `pointermove`, coalesced to one per frame. Re-pick only if the pointer moved by at least 1 px or the
  camera moved.
- **Ghost** (`render/ghost.js`): the prepared model with a shared transparent material (opacity 0.55,
  `depthWrite: false`), plus footprint tiles in the `gridFx` layer. Tint is green `#58d66a` when valid and red
  `#e5534b` when not. Validity is `canPlace(store.state, def, x, z, rot)`, the **same function the server runs**,
  recomputed only when the hovered tile, rotation (R key) or state changes. The ghost snaps to tiles and shows the
  cost and the reason when invalid ("Blocked by Mia's coop").
- Left-click acts. A left-drag that **starts on a valid target** with a paint tool (seed, water, harvest, feed)
  paints; a left-drag that starts on empty ground, or any right- or middle-drag, pans (`visual-ux-juice.md` §3.4:
  "drag starting on a plot = paint, so the two never conflict"). Tools (hand, seed, water, harvest, feed, build,
  move) define what a click or drag on a target means. The tool layer calls `store.act` per target, batched per frame (§3.7).
- **Drag-paint never skips a plot.** With a paint tool active, the pointer path between the last and the current
  frame is rasterized over the grid (Bresenham over tile coordinates, `visual-ux-juice.md` §4.12), and every
  newly crossed tile is acted on once per stroke (a `Set` of visited tiles).
- **The ghost is not colour-only.** The invalid state also shows a hatched footprint and a ✕ badge, so red/green
  colour blindness cannot hide it ([WCAG 1.4.1, use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).

### 10.8 Assets: loading, preparing, caching

- `render/assets.js`: one `GLTFLoader`, a `Map<url, Promise<Prepared>>` cache, and `LoadingManager` progress for
  the splash.
- `prepare(gltf)`: bake node transforms; merge sub-meshes that share a material; convert to Lambert (dedupe by
  color, map and vertexColors); normalize scale so the model fits `def.size` x `TILE_M` x `def.fill` (default 0.9);
  put the origin at footprint-center bottom; compute the AABB (for picking proxies) and keep animation clips.
- **What loads when.** The manifest is derived from content (`def.model`). At boot, preload models for everything
  on the farm plus everything unlocked in the shop. Lazy-load the rest when the shop opens, showing a colored
  footprint box until ready.
- **HTTP caching.** `/assets/*` gets `Cache-Control: max-age=604800, immutable`, and URLs carry
  `?v=${CONTENT_HASH}`. `/vendor/three` is immutable too. HTML and JS are served with `maxAge: 0` plus ETag (as in
  wow-arena).
- **Offline asset prep** (`tools/build-assets.mjs`, dev-only; the five-step pipeline in `assets-catalog.md` §6.1):
  FBX2glTF conversion, material fixes, scale and pivot normalisation, then glTF Transform `optimize` with
  **meshopt and `--simplify false`**, palette and join for static props, WebP for textures
  ([gltf-transform CLI](https://gltf-transform.dev/cli)). The first pass of this doc said "no meshopt"; the
  assets research measured it (the cow went from 3.11 MB to 445 KB with all 13 clips intact), so meshopt is on.
  The cost is one vendored file (`three/examples/jsm/libs/meshopt_decoder.module.js`) and
  `loader.setMeshoptDecoder(MeshoptDecoder)`. The partner's first load over Wi-Fi is the beneficiary.
- **Material fixes live in one table** applied by `prepare()`. Converting everything to Lambert also removes the
  FBX2glTF `metallicFactor 0.4` darkening. Kenney Nature colours stored as sRGB-in-linear need
  `convertSRGBToLinear()`. Crops destined for one shared material (the `BatchedMesh` path) get their flat
  material colours **baked into vertex colours** at build time, so all crop stages share one
  `MeshLambertMaterial({ vertexColors: true })` with no texture. `instanceColor`/`setColorAt` tinting still
  multiplies on top.
- **Sway data travels with the geometry, not the instance.** The visual doc's sway amplitude depends on the stage
  (0.3 sprout, 0.7 growing, 1.6 ready, `visual-ux-juice.md` §3.6). Bake it as a per-vertex `aSwayAmp` attribute
  into each stage geometry, rather than only as an `InstancedBufferAttribute`. That works identically for
  `InstancedMesh` and `BatchedMesh`. `BatchedMesh` has no custom per-instance attributes, and every geometry in
  it must share one attribute set. The per-instance `aPopStart` exists only on the `InstancedMesh` path. In the
  `BatchedMesh` path a pop is a 300 ms CPU tween of that one instance's matrix, since only a handful pop at once.

### 10.9 Shadows: static cache

- Animals and avatars get **blob shadows** (an instanced soft decal), so the real shadow map holds only static
  geometry. Then `renderer.shadowMap.autoUpdate = false`, and `renderer.shadowMap.needsUpdate = true` only when a
  static object or the sun direction changes, or the shadow frustum moves. Crops cast no shadow-map shadows
  (`visual-ux-juice.md` §4.8), so crop stage changes do not count. r186 has the same pair of flags per light
  (`light.shadow.autoUpdate`, `src/lights/LightShadow.js`). `WebGLShadowMap.render` checks the renderer flag
  first, then each light's, and resets both `needsUpdate` flags after rendering. With one shadow-casting light
  the renderer-level switch is the simpler one, and it matches the visual doc
  ([forum](https://discourse.threejs.org/t/renderer-shadowmap-autoupdate-false/50401)).
  wow-arena measured the shadow *pass* at 1.9 ms per frame, which this saves on almost every frame.
- Fit the shadow camera to the camera's visible ground footprint and snap it to shadow-texel units (no shimmer
  while panning). Refit on camera-move end, not during the move. Maps: 2048 on high, 1536 on medium, blob-only on
  low.

### 10.10 Camera

The camera values are `visual-ux-juice.md` §3.4: `PerspectiveCamera`, FOV 30°, yaw 45° plus k·90° (Q/E rotates
with a 400 ms `inOutCubic` tween), and pitch easing from 54° (far) to 36° (near) with zoom. Distance is 18 m
minimum, 55 m default and 90 m maximum (9 / 27 / 45 tiles). Wheel zooms toward the cursor. Pan with a left-drag
that starts on empty ground, a right- or middle-drag anywhere, or WASD and the arrow keys, with damping, clamped
to the unlocked land plus 6 m. Store the target, distance and yaw per player in `localStorage` (try/catch).
Technical consequences:
picking is unaffected (ray-plane), the shadow frustum is refit when a zoom or pan *ends* (§10.9), and the LOD band
(§10.12) is chosen from the camera distance.

### 10.11 Quality tiers

The tiers are `high | medium | low | auto`, as in wow-arena. The knob values are the table in
`visual-ux-juice.md` §4.2 (pixel-ratio cap 1.25 / 1.0 / 0.85, MSAA on / on / off, shadow map 2048 / 1024 / blob
only, tuft and particle caps), plus this doc's ambient fps (30 / 24 / 15) and animal mixer rate. `auto` uses
that doc's ladder: an exponential average of frame time over about 2 s, down a tier after 3 s above 18 ms, up a
tier after 10 s below 11 ms. The settled tier goes to `localStorage`, so MSAA, which can only be chosen when the
WebGL context is created, is right on the next boot.

### 10.12 LOD and culling

`THREE.LOD` switches per *object*, so it cannot drive an `InstancedMesh` or `BatchedMesh`, which hold hundreds of
plants each. With a fixed-pitch camera the screen size of everything depends on one number, the camera distance.
LOD is therefore **one global zoom band** (`near` < 35 m ≤ `mid` < 60 m ≤ `far`, over the 18-90 m camera range,
with 10% hysteresis so a resting zoom never flickers), owned by `render/lod.js`. A band change is rare, and the
work it triggers is a one-off batch rather than per-frame.

**Why crops need it: the triangle arithmetic.** A late-game farm has about 900 plots. The visual doc's 4-9 plants
per plot make 3,600-8,100 plant instances, and the Quaternius stage-4 crop meshes are 100-2,900 triangles each
(`assets-catalog.md` §6.4). Even at the low end that is 0.4-0.8 M triangles for crops alone at `far`, where the
whole farm is visible, against a visible budget of about 300k (`visual-ux-juice.md` §4.15). The budget per plot
at `mid` (about 300 plots on screen) is roughly 1,000 triangles. That means about 110-250 per plant, which is
what the visual doc's crossed cards (2-3 quads, 4-6 triangles) and `gltf-transform simplify --ratio 0.5` (assets
doc) deliver. At `far`, one card cluster per plot replaces the individual plants. The asset-prep step must
report triangles per stage so this stays checkable, and `tools/content-report.mjs` should fail any crop stage
over its triangle cap.

| Family | near | mid | far |
|---|---|---|---|
| Crops | full stage meshes | same | low stage geometry (crossed card from the same atlas). `BatchedMesh`: one `setGeometryIdAt` per instance at the band change. Instanced: swap the set. |
| Grass and flower tufts | tier cap | 60% | 25%. Instances are stored in random order, so lowering `mesh.count` thins them uniformly. |
| Animals (skinned) | mixer every frame | every 2nd frame | idle pose frozen, mixer at 10 Hz (`visual-ux-juice.md` §4.4) |
| Ready and need badges | one per object | one per object | aggregated per field ("×12", `visual-ux-juice.md` §4.13) |
| Fruit on trees | instanced fruit | instanced fruit | canopy tint only |
| Nameplates (DOM) | name + tool | name | partner portrait arrow at the screen edge only |

Culling:

- **Static instanced sets** (fences, decor, tufts, rocks) are chunked into 16x16-tile `InstancedMesh`es once the
  farm passes about 64x64 tiles. Each chunk then has its own bounding sphere, and three.js culls whole chunks for
  free. Mind the stale-sphere rule (§10.3).
- **`BatchedMesh`** iterates every instance on every render while `perObjectFrustumCulled` or `sortObjects` is
  true. It skips that loop entirely only when both are false and visibility did not change (r186
  `BatchedMesh.onBeforeRender`). For opaque crops set `sortObjects = false` (sorting only helps transparency and
  early-z). Enable `perObjectFrustumCulled` in the `near` band, where most of the farm is off-screen, and disable
  it in `mid`/`far`, where almost everything is visible and the loop is pure overhead.
- **Skinned meshes** stay `frustumCulled = false` (wow-arena measured culling characters as slower, §10.6). The
  animal view does its own cheap sphere-in-frustum test only to **skip mixer updates** for off-screen animals.
- **Sky, particles and blob shadows**: `frustumCulled = false` (one draw each; the culling test would always pass).
- **DOM overlays**: hidden with `visibility` when their anchor projects off-screen, and never moved with
  `top`/`left` (`visual-ux-juice.md` §4.13).

---

## 11. Directory layout, modules and agent ownership

```
harvest-hollow/
  package.json          type: module; deps: express, ws, three; dev: puppeteer-core, @gltf-transform/cli, fbx2gltf
                        scripts: start, dev (node --watch), test, test:e2e, sim, shot
  .nvmrc                24
  .gitignore            node_modules/ data/ docs/screens/ test/.tmp-data/ `assets-src/*` and
                        `!assets-src/inventory.json` (371 MB of downloaded packs stay local; the built GLBs in
                        public/assets/ are what ships, and the inventory lets anyone re-download the packs)
  README.md             run, play, LAN URL, controls, layout
  shared/               pure ES modules; no DOM, no node:*, no clock reads, no Math.random
    content/            (= the "shared/data/*.json" of fv2-animals-trees-crafting §6.1 R10; JS modules, see §8.1)
      index.js          Maps, validateContent(), CONTENT_HASH, kind lookups
      units.js          sec/min/h/d helpers
      config.js         TILE_M, READY_GRACE_MS, UNDO_MS, DUET_MS, caps, presence rates, rate limits, start values
      crops.js trees.js animals.js buildings.js recipes.js items.js decor.js
      expansions.js levels.js quests.js achievements.js orders.js
    rules/
      index.js          ACTIONS registry + runAction()           (contract)
      tx.js             Tx, applyOps, getAt                       (contract)
      schema.js         parseArgs + validators                    (contract)
      state.js          createFarm(), validateState(), canProgress()
      grid.js           footprint(), tilesOf(), getGrid(), canPlace(), inBounds(), tileOwner()
      time.js           progress/stage/isReady/regen*/queue*/nextVisualChangeAt
      rng.js            hash32(), roll(), pick()
      economy.js        earn/spend (ledger + stats), sellValue(), capacityOf(), available(), intake() with overflow
      progress.js       processEvents(): stats, xp→level (farm + personal, rested), achievements, quests, rewards
      period.js         dayIndex(), weekIndex(), periodCount(), periodInc()
      system.js         system actions (_rollover _orders _settle _bench _seen …) + nextSystemDueAt(state)
      orders.js         deterministic order generation from state + hash (called only by _orders)
      buffs.js          activeBuffs(), applyGrowBuffs(): windows fixed at start time (§15.6)
      actions/          farming.js trees.js animals.js building.js crafting.js market.js quests.js social.js
                        coop.js (joint actions, gifts, help flags, pins, pets, bench) treasury.js (jars,
                        reservations, refunds)
    net/
      protocol.js       MSG, ERR, LIMITS, PROTOCOL_VERSION             (contract)
      clock.js          ClockSync (pure)
      interp.js         PresenceBuffer (pure)
      ids.js            makeCid(randomBytes), newId(cid, seq, i)
  server/
    index.js            boot: config → persist.load → http + ws → timers → signals
    config.js           PORT=3300, HH_DATA_DIR, HH_DEV, HH_TZ, HH_PASSPHRASE
    http.js             express app: static, /shared, /vendor/three, /api/status, dev routes (HH_DEV)
    clock.js            ServerClock (monotonic, dev offset)
    engine.js           Engine: state, runPlayerAction, runSystemAction, dedupe, broadcast hook
    router.js           handleMessage(ctx, conn, raw), never throws
    sessions.js         hello/claim/tokens, welcome, peers, ws heartbeat
    presence.js         mv/ghost/emote/mark/chat validation + 15 Hz relay, together()
    persist.js          snapshot/journal/backups/recovery
    migrations.js
    ratelimit.js        TokenBucket
    scheduler.js        one system-action timer at nextSystemDueAt (capped, §15.1), autosave, fdatasync,
                        backup rotation
    photos.js           POST /api/photos → data/photos/<id>.webp (size + rate limit, token check)
    tls.js              optional HTTPS when HH_TLS_CERT/HH_TLS_KEY are set (§12.1)
  public/
    index.html          import map, canvas, HUD skeleton (semantic, ARIA)
    css/style.css
    js/
      main.js           boot sequence, loop wiring, window.__hh test hook
      audio.js
      net/socket.js     reconnecting ws, per-frame batching, ping loop
      net/sync.js       SyncStore (undo-log rebase), change topics, confirmed-only events
      game/controller.js  input → tool → local check → store.act; rejection toasts
      game/tools.js     hand/seed/water/harvest/feed/build/move tool definitions
      render/renderer.js  WebGLRenderer, quality tiers, frame pacing, F3 overlay
      render/scene.js     layers, lights, sky, fog, shadow cache
      render/camera.js    iso camera controller
      render/assets.js    loader + prepare + cache
      render/instancing.js InstancedModel (BatchedMesh path optional)
      render/ground.js    terrain, expansions, ground tiles, grid fx
      render/objects-view.js crops/trees/buildings/decor sync + visual scheduler
      render/animals-view.js
      render/avatars-view.js  self + partner, gestures, nameplates, partner cursor
      render/badges.js
      render/fx.js        particles, rings, DOM item-fly + floating text
      render/ghost.js
      render/picking.js
      render/lod.js       zoom band + hysteresis, band-change batches (§10.12)
      render/world-uniforms.js  WORLD uniforms + addSway() (visual-ux-juice §4.3)
      render/tweens.js    EASE + tween() + want() (visual-ux-juice §4.11)
      ui/hud.js shop.js inventory.js orders.js quests.js achievements.js chat.js notes.js
         toasts.js away.js settings.js slot-picker.js confirm.js (soft-confirm codes) goals.js
         (Now/Soon/Big tracker) treasury.js (jars, ledger) photo.js
    assets/models/ textures/ icons/ audio/
  tools/
    shot.mjs  e2e-coop.mjs  balance-sim.mjs  content-report.mjs  build-assets.mjs
    (existing from the assets task: contact-sheet.mjs  inspect-models.mjs  itch-download.mjs  gdrive-folder.mjs)
  test/
    helpers.js (fake clock, makeFarm, run, two-client harness) + suites from §9 + fixtures/
  data/                 runtime saves (gitignored)
  docs/research/  docs/design/  docs/agent-notes/<agent>.md  docs/balance/
```

### 11.1 Step 0 (lead, sequential, before any parallel work): freeze the contracts

1. `package.json`, `.nvmrc`, the server skeleton serving an empty page with the import map.
2. `shared/rules/tx.js` (§3.2), `shared/rules/index.js` (registry, `runAction`, ctx shape),
   `shared/rules/schema.js`, `shared/net/protocol.js` (messages, `ERR`, `LIMITS`).
3. `shared/content/index.js` with **two crops and one plot def**, plus `shared/rules/state.js`
   `createFarm`/`validateState`.
4. A **walking skeleton** end to end: plant and harvest one crop with colored boxes, two browser tabs, persistence
   on, one E2E step green. Every later agent extends a working game instead of integrating at the end.
5. `test/helpers.js` and the purity, registry and tx tests.

### 11.2 Parallel lanes (6 agents; each owns files exclusively)

| Agent | Owns | Delivers | Depends on |
|---|---|---|---|
| **Rules** | `shared/rules/**` except the frozen contract files (it may extend them with lead review), `test/rules.*`, `test/invariants.test.js` | every action family, progress, daily, grid, time, rng, economy | contracts |
| **Content and balance** | `shared/content/**` (except `index.js` API), `tools/balance-sim.mjs`, `tools/content-report.mjs`, `test/content*`, `test/economy*`, `test/balance*`, `docs/balance/` | all crops, trees, animals, buildings, recipes, levels, quests, achievements; pacing report | the rules API (can stub against the skeleton's two crops) |
| **Server** | `server/**`, `test/persist*`, `test/protocol*`, `test/presence*`, `test/clock*` | engine, sessions, presence relay, persistence, rate limits, systemd unit, dev routes | contracts |
| **Client core and UI** | `public/index.html`, `public/css/**`, `public/js/main.js`, `public/js/net/**`, `public/js/game/**`, `public/js/ui/**`, `public/js/audio.js`, `test/sync.test.js` | SyncStore, socket, tools, HUD, shop, quests, chat, notes, toasts, away card, settings | contracts; render API (`view.sync(ids)`, `pick()`) |
| **Renderer** | `public/js/render/**`, `public/assets/**`, `tools/build-assets.mjs` (input: `assets-src/`) | scene, camera, instancing, picking, ghost, animals, avatars, badges, FX, frame pacing, quality tiers | contracts; `assets-catalog.md` |
| **QA** | `tools/shot.mjs`, `tools/e2e-coop.mjs`, `docs/agent-notes/qa.md` | E2E (§9.1), screenshot sets, latency and fps measurements, bug reports *by file and line* to owners | everything; starts on the skeleton |

**With 4 agents:** merge Content into Rules, and QA into Server.
**Cross-lane rule** (proven in wow-arena's `docs/agent-briefs/common.md`): edit only owned files. A needed change
elsewhere goes into `docs/agent-notes/<you>.md` as file, line, exact patch and why, and the lead applies it.
Each agent uses its own port (3301-3306) and never touches 3000 (wow-arena) or 3300 (the real game service).

### 11.3 Render ↔ client API (freeze in step 0 as JSDoc in `render/index.js`)

```js
view.init(canvas, { quality }) → Promise
view.setState(state)                       // after welcome; builds everything
view.sync(ids, topics)                     // after each store change; re-reads only these ids
view.pick(ndc) → { kind, id?, x, z } | null
view.ghost.show(defId, rot) / view.ghost.hide() / view.ghost.update(tile, valid, reason)
view.partner.update(presenceList, serverNow)   // positions, cursors, ghosts
view.fx.play(event, worldPos)              // harvested, planted, levelUp, …
view.focus(x, z) / view.camera.rotate(±1)
view.invalidate()
```

---

## 12. Running it

- `npm start` on `PORT=3300`. On boot, print `http://localhost:3300` and every LAN URL from
  `os.networkInterfaces()` (`http://192.168.x.y:3300`) in big letters. That LAN URL is what the second player opens.
- A **systemd user unit** `harvest-hollow.service`, like `~/.config/systemd/user/wow-arena.service`
  (`Restart=on-failure`). `systemctl --user stop` sends SIGTERM, which triggers the final snapshot (§5.3).
  Lingering is already on for this user (`loginctl show-user "$USER" -p Linger` → `yes`, checked), so the service
  starts at boot without a login.
- **"No host" has one physical limit.** The progression doc's rule 12 ("either partner logs in alone at any time")
  holds only while the laptop that runs the server is awake. When it sleeps, the partner's tab shows the
  *Reconnecting…* pill and keeps predicting for up to 30 s (§3.7), then blocks input with a clear banner ("The farm
  is asleep: Rowan's laptop is off"). Nothing is lost. If the couple want true independence, the options are
  keeping the laptop awake on AC power (logind `HandleLidSwitchExternalPower=ignore`, an owner decision) or moving
  the service to any always-on machine. The data directory is portable, because the whole farm is `farm.json`
  plus the journal.
- **Firewall.** ufw is on and already opens 3000 to the LAN for wow-arena. Port 3300 needs the same LAN-only rule.
  This is a privileged change, so leave it to the owner or the lead.
- Bind `0.0.0.0` for the game. Dev routes go on a separate listener bound to `127.0.0.1` only.
- Express 5 is the current major (5.2.1). Watch for its path-syntax changes if any wildcard route is added
  (`/*splat` instead of `*`). Static serving is unchanged.

### 12.1 The LAN: addresses, secure context, Local Network Access, optional TLS

- **The partner's page is not a secure context.** `http://localhost` counts as secure, `http://192.168.x.y` does
  not. Restricted to secure contexts ([MDN list](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts/features_restricted_to_secure_contexts)):
  Notifications, the async Clipboard API, Service Workers and the Cache API, `crypto.randomUUID` and
  `crypto.subtle`, Web Locks, `navigator.storage.persist`, Screen Wake Lock, Badging, Web Share, and WebGPU
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)). Still available: WebGL2, Web Audio,
  `crypto.getRandomValues`, Pointer Lock, Fullscreen, Gamepad, `localStorage`, WebSocket. **Rule: the game
  never requires a secure-context API.** Each optional nicety feature-detects `window.isSecureContext` and
  degrades: a "crops ready" desktop notification falls back to a tab-title counter ("(3) Harvest Hollow") and a
  favicon dot.
- **Chrome's Local Network Access does not apply.** Since Chrome 142 (fetch) and 147 (WebSocket), Chrome asks
  permission for requests *from a public origin* to a private or loopback address
  ([Chrome blog](https://developer.chrome.com/blog/local-network-access),
  [blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/4gx2y5jPGbU)). Our page and our socket share
  one private origin, so no prompt appears. Two rules keep it that way: never load anything from a public CDN
  (vendor three.js, fonts and icons locally), and never point the page at a different local host or port. The
  blog says the scope may later grow to "all cross-origin requests going to destinations on the local network",
  which same-origin traffic still avoids.
- **A stable address.** Print the `.local` mDNS name (`http://farmhouse-pc.local:3300`) next to the IPs at boot,
  and ask the owner to reserve the laptop's DHCP lease on the router, so the partner's bookmark never breaks.
  ufw already allows mDNS from the LAN.
- **Optional HTTPS** (off by default) for the secure-context extras: `mkcert -install`, then
  `mkcert farmhouse-pc.local 192.168.x.y localhost`, and copy the root CA (`mkcert -CAROOT`) to the partner's PC
  and import it there ([web.dev](https://web.dev/articles/how-to-use-local-https),
  [mkcert guide](https://computingforgeeks.com/creating-locally-trusted-ssl-certificates-using-mkcert/)).
  `server/tls.js` switches to `https.createServer` when `HH_TLS_CERT`/`HH_TLS_KEY` are set; ws runs over it as
  `wss:` unchanged. The key file stays outside the repo with mode 0600.

---

## 13. Open design questions this architecture deliberately leaves to the designer

Settled by the sibling docs (the architecture follows them): shared treasury plus personal Hearts, shared farm
level plus personal level (§2.7); **no withering** (§1); water as an **optional yield multiplier**, never a gate
(`fv2-core-loop.md` §20.1); orders built from the farm's producers (§4.5); a full barn never blocks intake
(§2.5); day/night as a slow, cosmetic 40-minute cycle with *Cycle / Always day / Real clock* options
(`visual-ux-juice.md` §3.10).

Still open, and supported either way:

- avatar walk-then-act vs instant (§6.5),
- sky time per player (cosmetic, each player's setting) or forced shared. Recommendation: derive the cycle from
  `serverNow`, so two players on *Cycle* always see the same sky, and let *Always day* and *Real clock* stay
  personal. Move the sun in discrete steps (0.5° every few seconds) so the static shadow cache holds,
- whether weather has a gameplay effect ("rain waters the crops"). If so, weather must be a pure function
  `weatherAt(farmSeed, now)` in `shared/` (a hash per hour block), so client and server agree with no state and
  replay stays deterministic,
- whether seasons change crops or only the palette (`uSeason` is then `seasonAt(now)`, also pure),
- free fallback seed (§8.3; the sibling docs recommend "Grandma's seed basket" and the "Neighbour's sack").

---

## 14. Gotchas found while researching (one list for every agent)

| Area | Gotcha | Where |
|---|---|---|
| three r186 | `InstancedMesh.boundingSphere` is computed once and never refreshed; new far instances get culled | §10.3 |
| three r186 | `PCFSoftShadowMap` is removed (falls back to PCF with a warning); `Clock` is deprecated, use `Timer` | §10.1 |
| three r186 | `InstancedMesh` cannot grow; `BatchedMesh` can (`setInstanceCount`) | §10.3 |
| three r186 | `BatchedMesh` loops over all instances every render unless `sortObjects` and `perObjectFrustumCulled` are both false | §10.12 |
| three | `canvas.toBlob` after the frame was presented gives a blank image; call `renderer.render()` immediately before `toBlob` in the same task instead of paying for `preserveDrawingBuffer: true` ([three.js manual](https://threejs.org/manual/en/tips.html)) | §15.7 photos |
| three | `antialias` (MSAA) can only be chosen when the WebGL context is created | §10.11 |
| Browser | `crypto.randomUUID` and every other secure-context API are missing on the partner's `http://192.168…` page | §2.8, §12.1 |
| Browser | `page.setOfflineMode(true)` stalls an open WebSocket instead of closing it (measured) | §9.1 |
| Browser | hidden tabs: rAF stops, timers run at most once per second, and after 5 minutes at most once per minute | §4.6 |
| Node/browser | `setTimeout` with a delay over 2,147,483,647 ms fires after **1 ms** in Node ([docs](https://nodejs.org/docs/latest-v24.x/api/timers.html)) and immediately in browsers ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)); cap every scheduler delay | §15.1 |
| Node | the scratchpad `/tmp` is tmpfs, where `fsync` costs 0 ms; measure durability on the real disk | §5.1 |
| Node | `structuredClone` of the whole state costs 3-11 ms; never clone per message | §3.4 |
| JS | `JSON.stringify` and `structuredClone` skip Symbol keys, which is why derived caches live under Symbols | §2.3 |
| JS | `'constructor'` and `'__proto__'` resolve on plain objects; use `Map`, `Object.hasOwn` and null-prototype registries | §7 |
| ws | `maxPayload` defaults to 100 MiB; set 64 KiB | §7 |
| Express 5 | wildcard routes need named splats (`/*splat`) | §12 |
| Design/tech | an order computed at view time from live state drifts; materialize it with a system action | §4.5 |
| Design/tech | refunding a purchase that already granted XP can un-level a player; defer purchase XP to settlement | §15.3 |

---

## 15. Patterns behind the designed co-op mechanics

`progression-goals-coop.md` §6-7 and `fv2-animals-trees-crafting.md` §2-7 specify about 40 mechanics. Six
reusable patterns cover all of them. Each fits the existing pipeline (`runAction`, `Tx`, journal, broadcast,
rebase) without a new protocol message.

### 15.1 System actions and the scheduler

```js
// shared/rules/system.js: pure, so the server knows WHEN, tests check WHAT, and replay reproduces both
export function dueSystemActions(state, now, tz) {          // fixed order, so the result is deterministic
  const due = [];
  if (dayIndex(now, tz) !== state.farm.daily.day) due.push({ type: '_rollover', args: {} });
  if (state.farm.orders.slots.some((s) => !s.order && s.availableAt <= now)) due.push({ type: '_orders', args: {} });
  if (anyReceiptDue(state, now)) due.push({ type: '_settle', args: {} });        // receipts and trash
  if (anyJarReleaseDue(state, now)) due.push({ type: '_jarRelease', args: {} });
  if (benchDue(state, now)) due.push({ type: '_bench', args: {} });
  return due;
}
export function nextSystemDueAt(state, now, tz) {           // the earliest future moment the list above grows
  return Math.min(nextMidnight(now, tz), nextOrderAt(state), nextReceiptAt(state), nextJarReleaseAt(state),
                  nextBenchAt(state));
}
```

```js
// server/scheduler.js
const MAX_DELAY = 60 * 60 * 1000;                           // re-check hourly, far from the 2^31-1 ms overflow (§14)
function runDue() {
  const now = clock.now();
  for (const a of dueSystemActions(state, now, cfg.tz)) engine.commitSystem(a, now);  // runAction, journal, broadcast
}
function arm() {
  clearTimeout(timer);
  const now = clock.now();
  const delay = Math.min(Math.max(nextSystemDueAt(state, now, cfg.tz) - now, 0), MAX_DELAY);
  timer = setTimeout(() => { runDue(); arm(); }, delay);
}
```

- `runDue()` also runs **before every player action** and before building `welcome`. A late timer (event-loop
  stall, laptop suspend) can therefore never let a player act on stale state. `arm()` runs after every committed
  action and at boot.
- **Catching up after downtime is one action, not many.** If the server was off for three days, `_rollover` runs
  once with `missed = today - daily.day - 1` (streak freezes, Almanac reset), `_orders` fills every empty slot,
  and `_settle` folds every expired receipt. There is no loop over missed days and no burst of 72 hourly events.
- A system action's `seq` is the new `v`, so the ids it creates are `sys.<v>.<i>`. Any server-observed fact it
  reads goes into `ctx.ext` and is journaled.
- Two system actions are triggered by **connection events** rather than time: `_seen {pid}` when a player's last
  socket closes (it updates `lastSeenAt` and stands the avatar up from the bench), and `_return {pid}` on a
  `hello` after an absence (rested XP, "while you were away"). They go through the same pipeline.
- **Guard against a hot loop.** If a due system action is ever rejected (a bug), `dueSystemActions` keeps
  returning it and `arm()` computes a delay of 0, so the server would spin at 100% CPU on a laptop that already
  runs hot. `runDue` therefore logs the rejection, writes an incident, and enforces a minimum delay of 60 s for
  that type until the next successful commit. `system.test.js` asserts that every type returned by
  `dueSystemActions` passes its own `check` on fuzzed states.
- Clients never run system actions. A client's prediction of a player action can briefly differ (the server ran
  `_settle` first), and the rebase absorbs it (prototyped, §15.8). Clients show countdowns to `availableAt` and
  `until`, so nothing arrives as a surprise.

### 15.2 Soft-confirm codes

Some rules protect a partner's plans without forbidding anything: item reservations, pinned decor and big
purchases (`progression-goals-coop.md` §6.2 rules 1, 2, 5 and 7). `check` returns a **soft** code, which passes
only if `args.confirm` names it:

```js
// inside sell.check
if (a.qty > available(state, a.item)) return ERR.NO_ITEMS;
const free = available(state, a.item) - reservedByOthers(state, a.item, ctx.pid, ctx.now);
if (a.qty > free && !confirmed(a, 'RESERVED')) return soft(ERR.RESERVED, reserverOf(state, a.item, ctx.pid, ctx.now));
```

- `confirm` is an optional schema field holding at most three soft codes. Unknown codes are rejected like any
  extra key.
- The client runs the same `check` before sending, so the dialog normally appears **before** any network traffic
  ("Rowan saved 5 eggs for Custard. Sell anyway?"). If the partner reserves in the same instant, the server's
  `rej RESERVED` opens the same dialog. "Yes" resends with `confirm: ['RESERVED']`.
- Expiry is derived: a reservation counts only while `until > now`. The next tx that touches the item prunes
  expired entries, so no timer is involved.
- Using reserved items **for the purpose they were reserved for** (that recipe, that order) needs no confirm. It
  also reduces the reservation.
- `BIG_SPEND` (over 30% of the spendable treasury, or over 10,000 coins) also emits `bigSpend`, which shows the
  partner a non-blocking toast. `PINNED` emits `pinnedMoved` to the pinner with a one-click "move it back": a
  normal `move` action, with the old coordinates carried in the event.

### 15.3 Receipts: the 10-minute undo window

```js
// buy: place a building, tree, animal or decor
tx.set(['farm', 'objects', id], { def, x, z, rot, placedAt: now, by: pid,
  rcpt: { coins: price, xp: def.buyXp, until: now + UNDO_MS } });     // UNDO_MS = 600_000
// refund.check:  obj.rcpt && now < obj.rcpt.until && pristine(obj), otherwise NOT_REFUNDABLE
// refund.apply:  economy.earn(tx, rcpt.coins, 'refund'); tx.del(['farm', 'objects', id])
// _settle (system): for every rcpt with until <= now: tx.del(rcpt), grant rcpt.xp, bump 'spend.settled', 'built.*'
```

- **No XP, no `spend.settled` and no "built" counter until settlement.** That is exactly the progression doc's
  exploit rule ("spent counts only non-refundable spend", §8): goals and achievements about spending read
  `spend.settled`. The ledger stat `coins.spent` moves at purchase time, and a refund adds `coins.refunded`, so
  the ledger invariant (§2.5) holds at every instant. A refund never has to claw anything back. A
  level can therefore never be lost, and level-up rewards (coins, unlocks, instant ripen) can never be farmed by
  buy-refund loops.
- `pristine(obj)` is defined per kind: a plot with no crop, a building with an empty queue, an animal never fed,
  a tree never harvested. Anything else gets `NOT_REFUNDABLE`. Moving an object does not void its receipt.
- Destructive actions (sell an animal, demolish) are the mirror image. The object moves to
  `farm.trash[id] = {obj, until}` and the coins are paid. `restore` within 10 minutes reverses both, and
  `_settle` purges expired trash.
- Either partner may refund, since the farm is shared. The other partner gets a toast.

### 15.4 Joint actions: two different players within a window

```js
// duetPress {station}   (the same shape serves giant-crop chopping, high-fives and the bench)
const key = `duet.${a.station}`;
const j = tx.get(['farm', 'joint', key]);
if (j && j.by !== ctx.pid && ctx.now - j.at <= DUET_MS) {     // the partner pressed within 3 s, server time
  tx.del(['farm', 'joint', key]);
  consumeInputs(tx, recipe); enqueueOutput(tx, a.station, recipe, { duet: true });
  tx.emit({ e: 'duet', station: a.station, a: j.by, b: ctx.pid });
} else {
  tx.set(['farm', 'joint', key], { by: ctx.pid, at: ctx.now });  // first press, or the old slot lapsed
}
```

- The window is measured on **server** time for both presses. That is fair whatever each client's clock says,
  and replay is exact.
- **Simultaneous presses never fail.** Both clients predict "waiting for partner". The server applies A's press,
  then B's press completes the duet. B's rebase replays B's own press on top of A's slot and shows the
  completion. A sees it when B's delta arrives. The prototype recorded zero rejections.
- The same player pressing twice only refreshes the slot. A lapsed slot costs nothing, because inputs are
  consumed only on completion, the moment the process starts (§2.1 rule 6).
- Variants:
  - **two-person chopping** (giant crops, big stumps): `obj.hp` is in integer tenths (6 chops = 60). A chop is
    worth 10, or 15 when the previous chop (`obj.lastChop = {by, at}`) was by the other player within 2 s;
  - **high-five**: one joint slot for the farm, a 1.5 s window, plus `ctx.ext.near` (§15.5) and a 30-minute
    `COOLDOWN`;
  - **sunset bench**: `sit` and `stand` actions maintain `farm.bench.sit = {p1: at, p2: at}`. Once both are
    seated, `since = max(at)`. The system action `_bench` at `since + 10 s` grants Golden Hour if both are still
    seated. `_seen` (disconnect) stands that player up. A period counter limits it to once per day.
- UX: the first presser sees a 3 s ring ("waiting for Mia…"). The partner sees the station pulse, plus an
  off-screen arrow. There is no failure state, only the ring fading.

### 15.5 Presence facts in rules (`ctx.ext`)

Positions are client-owned and cosmetic (§6.1), so no rule may read them from the state. When a rule depends on
presence, the server computes the fact from *its* view of presence at the moment it processes the action and puts
it in `ctx.ext`, which is journaled with the action:

| Fact | Definition (server-observed) | Used by |
|---|---|---|
| `online` | pids with an open socket | duet recipes, story "watch together" |
| `near` | the two avatars' last clamped positions are within 2 tiles | high-five |
| `together` | the partner sent an `act` or `mv` within the last 120 s | an optional together bonus (§6.6) |

The client predicts with its own presence view, and the rebase fixes any mismatch. Rules with real economic weight
should key on *actions* (presses, sits) rather than positions, because positions are the one input a client
controls freely.

### 15.6 Buffs and instant ripening: windows, never rates

- A buff is a window, `farm.buffs[name] = {from, until}`. It affects processes **started** inside it, and the
  effect is fixed at the start. `applyGrowBuffs(state, growMs, now)` shortens the growth of a crop planted during
  Golden Hour by 10%, and that crop's `readyAt` never changes afterwards. Changing the *rate* of running timers
  would mean either rewriting every `readyAt` when the buff starts and ends (two large deltas, piecewise timers)
  or integrating rates inside every `progress()` call. Both break "`readyAt` is a fact" (§2.1).
- **Instant ripen on level-up** (`fv2-core-loop.md` §21) is a one-off rewrite inside the level-up's tx:
  `readyAt = min(readyAt, now)` for every watered, growing crop. With 900 plots that is about 60 KB of ops, once
  per level. It is predicted like any other effect. The ripple visual is confirmed-only (§3.6).
- An expired buff is just a window in the past, and `_rollover` prunes it.

### 15.7 Every designed mechanic, mapped

| Mechanic (source) | State | Actions | Pattern and guard |
|---|---|---|---|
| Savings Jars (prog §6.2.1) | `farm.jars[id] {name, target, coins, by, release}` | `jarCreate`, `jarDeposit`, `jarWithdraw` | Own jar: instant. Partner's jar: `release = {by, at}`, then `_jarRelease` at `at + 12 h` unless the owner answers `jarApprove`/`jarDeny` first (§15.1). Ledger invariant: `wallet.coins + Σ jars.coins == start + earned + refunded - spent` (§2.5). |
| Big-purchase heads-up (6.2.2) | — | any `buy` | soft `BIG_SPEND` (§15.2) |
| 10-minute undo; destructive double confirm (6.2.3, 6.2.8) | `obj.rcpt`, `farm.trash` | `refund`, `restore` | receipts (§15.3) |
| Treasury ledger (6.2.4) | `farm.ledger` ring (500) + weekly period sums | (inside `economy.earn/spend`) | every coin movement carries `reason` and `by` |
| Item reservations (6.2.5) | `farm.res` | `reserve`, `unreserve` | soft `RESERVED`, derived 48 h expiry |
| Harvest XP split 40/60 (6.2.6) | `crop.by`, `crop.batch` | `harvest` | `processEvents`: personal XP `floor(0.4 × x)` to the planter, the rest to the harvester. +1 Heart each when planter ≠ harvester, at most once per planting stroke (`crop.batch` = seq of the stroke's first `plant`). |
| Pinned decor (6.2.7) | `obj.pin = pid` | `pin`, `unpin` | soft `PINNED` + `pinnedMoved` event with undo |
| Story beats wait (6.2.9) | `players[pid].seen` | `markSeen` | per-player flags; "watch together" reads `ctx.ext.online` |
| Rested XP (6.2.11, 7.16) | `players[pid].rested {amount, at}` | `_return {pid}` (system, on `hello`) | accrual `min(cap, rate × (now - lastSeenAt))`, computed once per return and journaled. Personal XP gains are doubled while `amount > 0`, consuming it. |
| Help flags (7.3, crafting §7) | `slot.flag = pid` | `flag`, `fill` | bonus only when `ctx.pid !== flag` |
| Tend-a-tree revive (7.4) | `tree.harvests`; wilted is derived (`harvests >= def.wiltAfter`) | `revive` | +50% final harvest only when reviver ≠ planter; Tree Tonic is the solo path |
| Bottle-feeding babies (7.5) | `animal.feeds`, a period counter per animal per hour | `bottle` | double count once per baby per hour (§4.5) |
| Duet recipes (7.6) | `farm.joint` | `duetPress` | joint action (§15.4); the slow-cook solo version is a normal `craftStart` |
| Giant crops and stumps (7.7) | `obj.hp`, `obj.lastChop` | `chop` | joint combo window (§15.4). Merging into a giant crop is an adjacency check over `getGrid` plus a `hash32` roll at the triggering harvest. |
| Sunset Bench / Golden Hour (7.8) | `farm.bench`, `farm.buffs.goldenHour` | `sit`, `stand`, `_bench` | joint + scheduler + buff window (§15.4-15.6) |
| High-five (7.9) | `farm.joint.hf`, `players[pid].hfAt` | `highFive` | joint 1.5 s + `ctx.ext.near` + `COOLDOWN` 30 min |
| Daily gift (7.10) | `players[to].giftBox` | `gift`, `openGift` | period counter per giver per day; content flag `giftable` (farm-produced goods only) |
| Notes, feed, thanks (7.11) | `farm.notes`, `farm.feed` | `postNote`, `thank` | thanks-hearts capped at 10 per day (period counter) |
| Specialisation perks (7.12) | `players[pid].perks`, a weekly respec counter | `perkPick`, `respec` | perks apply only when `ctx.pid` is the owner; the Harmony bonus is derived from both perk sets |
| Together task, Couple Challenge (7.13) | farm stats with per-player contributions | — | counters in `processEvents`, T-scope checks |
| Barge "Equal Partners" (7.14) | `barge.crates[i].by` | `loadCrate` | bonus when both pids appear among the loaders |
| Fair and NPC league (7.15) | `farm.fair {week, points}` | `fairEnter` | weekly period; NPC scores are `hash32(farmSeed, week, npc)` |
| Memory Book and photo mode (7.18, visual §3.4) | `farm.photos [{id, by, at, caption}]` | `addPhoto` (after `POST /api/photos`) | render, then `toBlob` in the same task (§14) |
| Pets (7.19) | `pet.lastPettedBy`, `pet.petted {p1: day, p2: day}` | `pet` | `_rollover` grants the treasure if both petted the day before |
| Friendly Duel (7.20) | `farm.duel {week, kind, optIn}` | `duelOptIn` | weekly period; off by default |
| Streak with freezes (prog §0.10, §4.5) | `farm.daily.streak {n, freezes}` | — | `_rollover` with `missed` days; either partner's action marks the day active |
| Goal Tracker, "never empty" (prog §3.4) | none (derived) | — | pure `goals(state, pid, now)` in `shared/`, unit-tested to always return Now, Soon and Big |
| Collections with pity (prog §8, crafting §0.10) | `farm.pity[set]`, `building.points` | `collectCollector` | `hash32` roll; a forced drop at the pity threshold |
| Queue cancel refund (crafting E9) | `building.queue` | `craftCancel` | only items with `s > now`; later items are re-timed with `s = max(now, prev.e)` |
| Finished goods wait at the machine (crafting §0.7) | queue items with `e <= now` | `craftCollect` | `def.slots` counts waiting **and** finished-uncollected items (as in Hay Day) |
| "I'm on it" order pins (crafting §7) | `slot.pin = pid` | `pinOrder` | display only; never blocks the partner |
| Groves (crafting §0.5) | none (derived) | `harvest` | +1 fruit when the tree is part of a same-species 2 × 2 block, from `getGrid` at harvest time |
| Prized animals (crafting §0.11) | `animal.feeds` | `feed` | `prized` is derived (`feeds >= def.prizedAt`); the production cycle is unchanged |
| Market demand (prog §8) | `farm.demand[item] {p, n}` | `sell` | bonus for the first M units per day (period counter) |

### 15.8 Validated by a second prototype

A second throwaway prototype (scratchpad, not in the repo) reused the §3.2 `Tx` unchanged. It added `buy` and
`refund` with receipts; `_settle` as a server-only system action that runs lazily before player actions;
`reserve` and `sell` with the `RESERVED` soft code and an automatic confirm-and-resend; and `duet` as a joint
action. Results:

- *Both partners press the duet station in the same instant:* one cake, zero rejections, both clients deep-equal
  the server, and each counted exactly one confirmed celebration.
- *One player pressing twice* never completes a duet.
- *Refund* inside the window restores the coins and removes the object. XP arrives only through `_settle` after
  the window. A player sending `_settle` gets `UNKNOWN_ACTION`.
- **500 random interleavings** of seven action kinds from two clients, with random latency, delivery order and
  time jumps past the undo window. Every run converged with `pending` drained, coins never went negative, both
  clients saw the same confirmed celebrations, and **journal replay == ops replay == server state**. That last
  equality is what makes §5.4 recovery trustworthy with system actions in the journal.

None of these patterns needs a protocol change: `act`, `d` and `rej` carry all of them.

---

## 16. Cross-doc reconciliation

Where the research docs disagreed, this is the resolution. Each row points to the section that now holds it.

| Topic | Sibling doc says | First pass of this doc said | Resolution |
|---|---|---|---|
| Full barn | never blocks a harvest (core-loop §20.5, crafting E6, progression §8) | `STORAGE_FULL` on intake | `farm.overflow` (§2.5) |
| Withering | none (core-loop §20.6, progression §6.2.15) | the design's choice | none; "over-ripe" is cosmetic only (§1) |
| Water | an optional yield multiplier, never a gate (core-loop §20.1) | the `plant` example gated on water | a separate `water` action; example fixed (§3.1) |
| Orders | built from current producers, sized to capacity (core-loop §20.8, crafting §5.3) | computed at view time | materialized by `_orders` (§4.5) |
| Content files | `shared/data/*.json` (crafting R10) | `shared/content/*.js` | JS modules, with the same validation intent (§8.1) |
| Achievement scope | `F`/`P`/`T` (progression §5, §9) | `farm`/`player` | `F`/`P`/`T` (§2.6) |
| Ownership | shared treasury + Hearts, two XP tracks (progression §6.1) | shared wallet, a personal XP badge | progression's table (§2.7) |
| World units | metres (assets §6.3, visual §3.4) | 1 tile = 1 unit | metres, `TILE_M = 2` (§2.3) |
| Camera | FOV 30°, pitch 54°→36° with zoom, distance 18-90 m (visual §3.4) | FOV 32°, fixed pitch 55°, 12-60 tiles | the visual doc's values (§10.10) |
| `powerPreference` | `high-performance` (visual §4.1) | `default` | `high-performance` (§10.1) |
| Quality tiers | pixel ratio 1.25 / 1.0 / 0.85, ladder 18 ms / 11 ms (visual §4.2) | 1.5 / 1.25 / 1.0, 20 ms | the visual doc's values (§10.11) |
| Draw calls | ≤ 150 target, 250 ceiling (visual §4.15); "about 300" for the whole farm before batching (assets §6.4) | ≤ 120 | **≤ 120 target, 150 alarm**, from wow-arena's measured 9.3 ms submit at 162 calls (§10.1). The far band must meet it through LOD (§10.12). |
| Idle throttle | 60 fps for 45 s after input, then 30 (visual §4.2) | 60 fps while interacting | explicit `want()` plus a 2 s tail (§10.4) |
| Crop triangles | 4-9 plants per plot (visual §3.6); stage meshes of 100-2,900 triangles (assets §6.4) | not budgeted | cards or simplified stages, one card cluster per plot in the far band, and a per-stage triangle cap in the content report (§10.12) |
| meshopt | on, measured 7× smaller (assets §6.1) | off | on, with `--simplify false` (§10.8) |
| Per-instance sway | `aSwayAmp`/`aPopStart` as instanced attributes (visual §4.3) | `BatchedMesh` as the crop fallback | `aSwayAmp` baked per vertex into stage geometries; `aPopStart` only on the instanced path (§10.8) |
| Partner cursor | a continuous ground point for the wind uniform (visual §0.4) | integer tile | floats rounded to 0.05 (§3.8, §6.3) |
| Shadow refresh switch | `renderer.shadowMap.autoUpdate = false` (visual §4.1, §4.8) | `light.shadow.autoUpdate = false` | both exist in r186. Use the renderer-level switch, as the visual doc does (§10.9) |
| Day/night | a 40-minute cosmetic cycle with options (visual §3.10) | real local time | the visual doc's cycle, derived from `serverNow` (§13) |
| Photo mode | download via `toBlob` (visual §3.4) | — | the same capture, plus an optional Memory Book upload (§15.7) |
| Drag gesture | a drag that starts on a plot paints, one on empty ground pans (visual §3.4) | any drag over 6 px pans | the visual doc's rule (§10.7) |
| "No host" | either partner can play alone at any time (progression §6.2.12) | not addressed | true while the server laptop is awake; sleep behaviour and options in §12 |

---

## 17. Sources

- Gabriel Gambetta, Client-Side Prediction and Server Reconciliation: https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html
- Gabriel Gambetta, Entity Interpolation: https://www.gabrielgambetta.com/entity-interpolation.html
- Figma, How Figma's multiplayer technology works: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- Replicache, How Replicache Works: https://doc.replicache.dev/concepts/how-it-works
- Valve, Source Multiplayer Networking: https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- Glenn Fiedler, Snapshot Interpolation: https://gafferongames.com/post/snapshot_interpolation/ and State Synchronization: https://gafferongames.com/post/state_synchronization/
- Martin Fowler, Memory Image: https://martinfowler.com/bliki/MemoryImage.html and Event Sourcing: https://martinfowler.com/eaaDev/EventSourcing.html
- Cristian's algorithm: https://en.wikipedia.org/wiki/Cristian%27s_algorithm
- Squirrel Eiserloh, Noise-Based RNG (GDC 2017): https://www.gdcvault.com/play/1024365/Math-for-Game-Programmers-Noise
- Node.js 24 `node:sqlite`: https://nodejs.org/docs/latest-v24.x/api/sqlite.html and `node:test`: https://nodejs.org/docs/latest-v24.x/api/test.html
- rename(2): https://man7.org/linux/man-pages/man2/rename.2.html; write-file-atomic issue #64: https://github.com/npm/write-file-atomic/issues/64
- ws docs: https://github.com/websockets/ws/blob/master/doc/ws.md (plus the local `node_modules/ws/README.md` and `lib/websocket.js:248`)
- Chrome timer throttling: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- MDN, `crypto.randomUUID` (secure contexts only): https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
- three.js docs: InstancedMesh https://threejs.org/docs/pages/InstancedMesh.html, BatchedMesh https://threejs.org/docs/pages/BatchedMesh.html, Ray https://threejs.org/docs/pages/Ray.html, Timer https://threejs.org/docs/pages/Timer.html; render on demand https://github.com/gfxfundamentals/threejsfundamentals/blob/master/threejs/lessons/threejs-rendering-on-demand.md; shadow autoUpdate https://discourse.threejs.org/t/renderer-shadowmap-autoupdate-false/50401; r186 source verified locally (`LightShadow.autoUpdate`, `BatchedMesh.addInstance/setGeometryIdAt`, `PCFSoftShadowMap` removed, `Clock` deprecated r183)
- WebGPU on Linux status: https://app.cinevva.com/guides/webgl-webgpu-not-supported-fix
- glTF Transform CLI: https://gltf-transform.dev/cli
- Puppeteer createBrowserContext: https://pptr.dev/api/puppeteer.browser.createbrowsercontext
- Token bucket: https://en.wikipedia.org/wiki/Token_bucket
- Idle-game offline progress: https://www.geekextreme.com/idle-games-offline-progression-math/
- FarmVille scaling (HighScalability): https://highscalability.com/how-farmville-scales-to-harvest-75-million-players-a-month/
- FarmVille (Wikipedia): https://en.wikipedia.org/wiki/FarmVille
- FarmVille 2 tech: http://blogs.adobe.com/flashplayer/tag/farmville-2, https://www.awn.com/news/zynga-taps-autodesk-farmville-2
- FarmVille 2 mechanics: https://farmville2.fandom.com/wiki/Water, https://farmville2.fandom.com/wiki/Feed, https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/117-how-do-i-water-crops/, https://www.gamezebo.com/walkthroughs/farmville-2-walkthrough/, https://gamelytic.com/farmville-2-basic-money-and-currency-points-overview/
- Stardew Valley multiplayer: https://stardewvalleywiki.com/Multiplayer; shipping-bin attribution bug: https://forums.stardewvalley.net/threads/bug-multiplayer-items-shipped-via-bin-not-giving-gold.7308/
- Chrome, Local Network Access: https://developer.chrome.com/blog/local-network-access ; LNA for WebSockets (blink-dev): https://groups.google.com/a/chromium.org/g/blink-dev/c/4gx2y5jPGbU
- MDN, features restricted to secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts/features_restricted_to_secure_contexts ; WebGPU (secure context only): https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- Local HTTPS with mkcert: https://web.dev/articles/how-to-use-local-https , https://computingforgeeks.com/creating-locally-trusted-ssl-certificates-using-mkcert/
- Timer overflow: MDN `setTimeout` https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout ; Node timers https://nodejs.org/docs/latest-v24.x/api/timers.html
- MDN `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion ; WCAG 1.4.1 Use of Color: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- three.js manual, screenshots of the canvas: https://threejs.org/manual/en/tips.html ; r186 source checked locally for this pass: `src/math/Frustum.js` (lazy, never-refreshed `boundingSphere`), `src/objects/BatchedMesh.js` (`onBeforeRender` loop, `setInstanceCount`), `src/renderers/webgl/WebGLShadowMap.js` (renderer and per-light update flags)
- Puppeteer `setOfflineMode`: https://pptr.dev/api/puppeteer.page.setofflinemode ; WebSockets and DevTools offline emulation: https://groups.google.com/g/google-chrome-developer-tools/c/Hq5k822cgxo (measured here instead: Chrome 154 holds, then delivers, frames on an open socket)
- FarmVille 2 GDC 2013 postmortem: https://gdcvault.com/play/1018015/FarmVille-2-Postmortem-What-Grew , recording https://archive.org/details/GDC2013Bagwell , local transcript `docs/research/sources/farmville2-gdc2013-postmortem-transcript.txt`
- Sibling research (reconciled in §16): `docs/research/fv2-core-loop.md`, `fv2-animals-trees-crafting.md`, `progression-goals-coop.md`, `visual-ux-juice.md`, `assets-catalog.md`
- Local precedent: `~/wow-arena` (`README.md`, `server/index.js`, `server/protocol.js`, `shared/netsync.js`, `tools/shot.mjs`, `test/hostile.test.js`, `docs/agent-notes/perf-notes.md`, `docs/agent-briefs/common.md`)
