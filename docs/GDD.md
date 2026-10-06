# Harvest Hollow — Game Design Document

Version 2.0, 2026-10-02. Lead design. Status: **approved for build** unless the owner overrides a decision.
Version 2 applies the economy critique (`docs/design/critique-economy.md`) and the co-op/fun critique
(`docs/design/critique-coop-fun.md`); every finding is accepted, modified or rejected in Appendix D, and the simulator
evidence is in Appendix E.

Owner changes since v2.0: **2026-10-04, a level-up finishes everything growing** (§3.1 rule 10, the Level-up Bloom;
`tools/econ-sim.mjs` models it since the final pacing pass of the same day, §4.6). **2026-10-04, the
Homestead's structures move**: the Farmhouse, Barn, Well, Mailbox, Market Stand, Mabel's Order Board and the Old
Greenhouse move and turn with the Hammer like any building (§2.3 gives only where they stand at minute zero; §7.1 build
mode, move back for 10 minutes); they are still never bought, stored or sold. Debris is cleared, not moved, and the
scenery outside the farm board (the river and jetty, the land features' docks, the village) stays where it is.
**2026-10-04, the owners' wish list (wave 4)**: new content Raspberry (L12), Roses (L13), Coffee Beans (L16), the
Pomegranate Tree (L14), Rabbits in a Rabbit Hutch with Rabbit Greens and Angora Wool (L14), each with recipe uses
(§3.1-§3.5 rows marked by their levels); **Fertilizer** (L10, Compost Bin: 2 Compost + 1 Egg; on a growing crop of
30 min or more: -25 % of its grow time and +2 units, stacks with Compost; `GROWTH.fertilizer`); **Homestead
upgrades**: three tiers each for the Farmhouse (Barn space, faster rested XP), the Well (watering +2.5/5/7.5 %), the
Market Stand (more Demand units, +1/2 % sales) and the benches (a longer Golden Hour), priced in hours of E at their
level plus Planks/Crates (`shared/content/upgrades.js`); selling decor (paid: 50 % of the coins or Acorns, gifts: nothing, 100 % in the undo
window); clearable wild weeds on owned land (2 coins for the first 20 a day, never regrow); perk respecs after the
free weekly one for 10 Acorns and the last perk of a tree refunded for 2 Acorns a point; three breeds per pet kind
(Shiba Inu, Husky, German Shepherd; Orange Tabby, Black, White: the first of each is the look of a pet adopted before,
so nobody's pet changes), chosen when adopting and changeable for free; pets sleep at their Dog House / Cat Basket
from late dusk to dawn (cosmetic); a free character look editor (a farmer who never opened it keeps the slot's rig,
farmer A with the straw hat); turning a placed building where it stands (↻ on the Hammer hint, R); the Barn's doors
swing open when it is clicked; a bird bath with visiting birds; night lights; a drizzle / downpour rain with puddles,
roof drips and a rainbow chance; the camera's "Right-drag: Rotate" option (tilt 30-85°, the floor rising to 44° when
zoomed far out to keep the draw cost flat); one drip-fed card for each (§7.4). The new defs are kept out of E(L)
(`economy-model.mjs` OWNER4), so no level threshold, price or quest reward of the live farm moved; Gold tiers that
mean "every one" follow the bigger families (Rainbow Harvest and Crop Master 21, Orchardist 14, Full Barnyard 10,
Recipe Box 117).
**2026-10-05, the owners' wish list (wave 4b)** (`shared/content/wishes4b.js`, RULES_VERSION 11): **balloon loot
crates**: the hot-air balloon that crosses every 10 minutes of server time drops a crate on a free tile of the farm on
35 % of its passes from L3 (never more than 2 unopened; an unopened crate goes to the Barn by itself after 4 hours;
a server that was down drops at most one); either player opens it with a click: always coins (2.5-5 % of an E-hour)
and XP (0.5-1 % of the level), plus at most one extra (Acorns, Golden Seeds, Fertilizer, a missing collection item or
a reward decor piece; 40 % none). **The Acorn shop's treasures**, one of each per farm, never sold: Lucky Clover (90
Acorns, L9: +5 points of blue-ribbon chance on every harvest), Golden Sprinkler (100, L10: waters crops and trees
within 3 tiles), Golden Watering Can (120, L8: one click waters everything growing), Rainbow Tree (140, L13: a random
fruit each harvest), Growth Totem (160, L14: crops within 3 tiles grow 20 % faster), Farmhand (200, L12: once a farm day
tends every animal, never touching kept feed), Time Turner (220, L16: once a farm day finishes every workshop queue),
Golden Barn (250, L15: the Barn holds 30 % more); the Goal Tracker shows "Saving for …" (the player's pick, else the
cheapest). **Animal homes grow**: buying an animal for a full home adds the next room step with it (its price folded
into the purchase) up to 24-30 animals (horses 16); past the old maximum the footprint grows one tile per side per tier
(a 3 x 3 coop becomes 4 x 4, then 5 x 5), around itself where it fits (the corner that keeps the house where it
stands first), else BLOCKED naming what is in the way; the Market sells into a full home at the same folded price, and
the feed line names the whole price; homes already upgraded keep their size, capacity and coins. **Trees age**: every harvest is a year; from 10 years +1 fruit,
from 30 +2 (the Heirloom's +1 stacks), and the tree grows. **Workshop queues**: the waiting items can be dragged into a
new order (the running item stays first, total time and inputs unchanged), and any item can be finished now for what
Hurry would cost when it runs (a waiting item: its whole time, 1 Acorn per started hour, at most 8). Each has a
drip-fed card (§7.4). None of it changes E(L) or the model (`tools/econ-sim.mjs --checks` 23/23).
**2026-10-05, a hosted mode for everyone** (owner: "a link so everyone can start with their own progress and it is
saved", "and a link so you can invite a second player to your farm"; `docs/agent-briefs/multi-farm.md`): with
`HH_MODE=multi` one public URL serves many private farms. Anyone starts a farm in one tap (no account) and is its
farmer 1, then gets the first-run flow of §7 unchanged; **Invite a friend** makes a one-time link that seats the second
farmer (§6 co-op, still two players per farm); a **personal farm link** opens the farm as that farmer on any device
(it replaces the passphrase there); a farm nobody visits for 7 days is deleted, which Settings and the landing page
say. The rules, the economy and E(L) are untouched: every farm is exactly the farm this document designs, and the LAN
game (`HH_MODE=single`, the default) is unchanged.
**2026-10-05, Bulgarian as a second language** (owner: "translate the game to Bulgarian as a second language, and the
loading screen to choose the language"; `docs/agent-briefs/i18n-bg.md`): every word a player reads (HUD, panels,
toasts, the feed and Journal, letters, Grandma Hazel's guides, ribbons, the album, the Goal Tracker, content names and
descriptions, the landing / invite / private-farm pages, the rules' errors) exists in English and Bulgarian. The
language is picked on the loading screen (and the farmer picker, the landing page and Settings), remembered per device,
and is per player: the two farmers may read different languages at the same time. English stays the source and the
default; numbers, dates and durations follow the language. Bulgarian wording follows the glossary
(`docs/agent-briefs/i18n-glossary-bg.md`) and its owner decisions: no gendered words about a player (titles are neutral
noun phrases), the County Fair is **Големият панаир**, the River Barge **Шлепът**, XP is **опит** everywhere. The
rules, the economy and the save are untouched.

Harvest Hollow is a FarmVille-2-style co-op farm for two people (up to four) who share one farm and play it together in
real time on their home LAN. This document is the single source of truth for mechanics, numbers, UX, art and
milestones. The research behind it is in `docs/research/` (six files); the architecture it assumes is
`docs/research/tech-architecture.md` (with the errata of Appendix F). Where this document and a research file disagree,
this document wins, and the reason is written next to the decision.

**Every number in the content and economy tables (§3, §4, §5.3) is generated by `tools/economy-model.mjs`.** That
script holds the formulas of §4.3, derives every price, value, XP amount, quest reward and level threshold from them,
and fails if any rule of the "perfect logic" contract (§4.9) is broken. Run `node tools/economy-model.mjs` (checks),
`node tools/economy-model.mjs --md` (tables) and `--json` (the seed for `shared/content/*.js`). Never hand-edit a
number in content: change the formula or the input row and regenerate.

**Every pacing and balance claim is proven by `tools/econ-sim.mjs`.** It re-derives the model, plays the farm minute
by minute for four play schedules, and runs the acceptance checks of §4.9 over 5 seeds × 4 schedules:
`node tools/econ-sim.mjs --checks --md` (exit 1 on any FAIL), `node tools/econ-sim.mjs --md` (full report),
`--autocal` (recalibrates the two calibration curves K and X of §4.4/§4.6 after any content change).

Conventions: 1 tile = 2 m (`TILE_M = 2`); times are real wall-clock time on the server; "E(L)" means the income of
farm level L in coins per hour of play of the reference couple (§4.4); "V" means the market value of one unit of an
item; ids in `backticks` are permanent content ids; "the reference couple" plays **3 evenings a week × 60 minutes
together** (the owner's brief, §1.5).

---

## Contents

1. Vision, pillars, core loop, session shape
2. World and farm layout
3. Content tables (crops, trees, animals, feeds, buildings and recipes, storage, tools and boosts, decorations,
   expansions, plots)
4. Economy (currencies, faucets and sinks, price formulas, income, level curve and unlocks, mastery, the contract)
5. Goal systems (orders, quests, achievements, collections, Fair, Barge, daily and weekly, long-term)
6. Co-op design
7. Moment-to-moment UX
8. Visual and audio direction
9. Edge cases and exploits
10. Milestone plan

Appendix A: data shapes · B: glossary · C: decisions that changed research proposals · D: critique log ·
E: simulator summary · F: errata for `tech-architecture.md`

---

## 1. Vision, pillars, core loop, session shape

### 1.1 Vision

*"Our little farm."* A lush, sunny, hand-made 3D farm that two people build together over months, a few evenings a
week. Every click feels good, every system makes sense the way a real farm makes sense, nothing is ever lost, and
there is always a next thing to look forward to — in a minute, in ten minutes, tonight, next evening and next week.
Playing at the same time is the best way to play; playing alone is never blocked.

### 1.2 Pillars

| # | Pillar | What it means in practice | What it rules out |
|---|---|---|---|
| P1 | **Fair and coherent** | One value formula prices every good (§4.3): a good is worth its inputs plus the time of the field, animal or machine that made it. Real-world causality: wheat → flour → bread; grain → feed → eggs. Every item has at least two uses. Automated checks prove no arbitrage, no dead ends, no dominated recipe or crop, no dead item. | Hand-tuned outliers (FV2's Blackberry), fantasy goods, "horseshoes from horses", random drops gating progress |
| P2 | **Lush and alive** | FV2's 3D look: saturated soft-lit diorama, crops sway at 60 BPM, ready things glow and dance, a tended farm looks calm. | Flat FV1 look, dark scenes, post-processing that costs the hot iGPU |
| P3 | **Together, never blocked** | Shared farm, shared level, shared treasury made safe; real bonuses for playing at the same time; every co-op bonus has a solo path, and no bonus ever rewards *waiting* for the partner (§6.2). | Host privilege, "ask your partner", partner leaderboards, any mechanic that needs both people to progress |
| P4 | **Always a next goal** | Goals at 1 min / 10 min / 1 evening / next evening / 1 week / 1 month+ horizons, surfaced by a never-empty Goal Tracker. | Empty levels, idle sessions, long walls |
| P5 | **Kind** | No energy, no real money, no ads, no withering, no animal death, no FOMO (events return yearly), no daily streak pressure (streaks are weekly and forgiving). Late harvests only lose a small Freshness XP bonus. | Shame mechanics, paywalls in disguise, loss of property |
| P6 | **Instant** | Every action applies in the same frame (optimistic, server-confirmed). Avatars walk cosmetically. | Waiting for a walk, waiting for a round trip |

### 1.3 The core loop

```
                    ┌──────────────── coins buy seeds, animals, buildings, land, decor, Town Projects ─────────────┐
                    ▼                                                                                            │
   SEEDS ──plant──► PLOTS ──grow (real time; water −15 % (−20 % with the partner); compost +1 unit)──► CROPS ──┐  │
                      ▲                                                          │                 │         │  │
                      │ compost (+1 unit, blue-ribbon chance)                     ▼                 ▼         │  │
                      │                                              FEED MILL: grain/roots → feed   MARKET STAND ─┤
   TREES ─cycle─► FRUIT ─────────────────────────────┐                        │                 (sell at V)     │
                                                     │                        ▼                                 │
                                                     │          ANIMALS eat feed → EGGS, MILK, WOOL, TRUFFLES…   │
                                                     │                │     every collection fills the Compost  │
                                                     │                │     Bin → COMPOST ─────────────────────►│(back to plots)
                                                     ▼                ▼                                          │
                                   PRODUCTION BUILDINGS (timed queues): Windmill, Bakery, Dairy, Kitchen,        │
                                   Preserves, Juice Press, Weaver, Sewing, Pie Oven, Chandlery, Packing Table…   │
                                                     │  value = inputs + machine time                            │
                                                     ▼                                                           │
   ORDERS (1.5 × V) · TOWNSFOLK BOARD (1.5 × V) · RIVER BARGE (1.6 × V) · COUNTY FAIR · QUESTS · RESTORATION ·    │
   TOWN PROJECTS (goods + coins → the village across the river) · MARKET ────────────────────────────────────────┘
                                                     │
                                                     ▼
                        XP → FARM LEVEL → new crops / trees / animals / buildings / recipes / land
```

One harvest moves many bars at once: coins (when sold), Farm XP and personal XP, crop mastery, Almanac tasks, quest
counters, achievement counters, a collection-drop roll, Fair points (if blue-ribbon) and the Seasonal Ribbon Track.

### 1.4 Nested goal horizons (the "always a next goal" guarantee)

| Horizon | Always available | Example |
|---|---|---|
| 1 minute | something ready to collect; an empty plot to plant; a fillable order; a debris tile (one regrows every hour); an Almanac micro-task; the partner's help flag | "Harvest 12 Wheat", "Feed 6 hens" |
| 10 minutes | a fast crop cycle (1–60 min crops); a craft that finishes; the current quest task; a new recipe to try ("Show me") | "Bake 2 Bread", "Corn ready in 7 min" |
| 1 evening | a quest card; a level (about one per evening until L19); a mastery star; Golden Hour together; a Fair entry; a townsfolk request | "Level 13 → Orange Tree" |
| next evening | what grew while away (long crops, trees, full animal pens, 2–4-h recipes); the daily gift; Market Demand | "Plant pumpkins before bed" |
| 1 week | Fair medal; River Barge rows; Couple Challenge; Mabel's weekly meter; three townsfolk requests; an expansion saving goal | "Gold at the Fair this Sunday" |
| 1 month + | the next 5-level chapter; Restoration projects; Town Projects (the village grows); Seasonal Ribbon Track; festivals; Farm Beauty stars; Grand decor; Legacy levels | "Finish the Old Greenhouse", "Light up the ferry landing" |

### 1.5 Session shape: the reference couple's 60-minute evening

The design cadence is the owner's brief: **two people, three evenings a week, about 60 minutes together** (the
"reference couple", the `casual` policy of the simulator). Every pacing number in this document is calibrated to it
(§4.4, §4.6); daily players simply progress faster (Appendix E). Nothing depends on a daily login: the farm keeps
growing while both are away, nothing withers, orders never expire, streaks are weekly.

| Minute | What happens | Systems |
|---|---|---|
| 0–2 | Both log in. **"While you were away" card**: what grew, what the partner did, gifts and notes waiting, new unlocks per player ("3 new things — Show me"), a story beat to watch. Login toast "Mia arrived 🌻" on the partner's screen. | recap, feed, daily gift |
| 2–10 | **The sweep**: everything that grew over two days is ripe and glowing. Drag-harvest the fields, tend animals (collect + auto-feed), collect finished goods from building trays, donate to a Restoration bundle or Town Project. The board goes from loud to calm. Combo meter fills when both sweep side by side. | harvest, tend, collect, Together Combo |
| 10–20 | **Set the engines**: plant session crops (10–60 min) on most plots, queue 30–90-min recipes, feed the Feed Mill. Check orders and the townsfolk board; pin "I'm on it" on the ones each partner takes. Try the recipe that unlocked last time. | planting, queues, orders, pins |
| 20–45 | **Active loop**: session crops cycle 1–3 times, orders get filled, a quest card completes, often a level-up until about L19. Decorating, expansions, Fair entries and barge crates fill the gaps. A duet recipe or a giant crop happens when both are near. | orders, quests, level, duets, giants |
| 45–55 | **Golden Hour**: the couple sits on a two-seat bench together (10 s). For 30 min everything started grows 10 % faster: a natural "last big push" for the long crops and recipes. Memory Book snapshot. | bench, buff, photo |
| 55–60 | **Plant for the away days**: long crops (8–24 h; Cabbage and Watermelon cover two days) on every plot, 2–4 h recipes queued in every slot, a note for the partner. The board ends calm and tidy: "it's fine to leave". | away crops, long recipes, notes |

**10-minute solo check-in** (optional, one partner): recap → sweep → replant with 4–12-h crops → re-queue → fill an
order → leave. Always worth it, never required: the first 4 Almanac tasks of the day pay (§5.8) and something is
always ripe.

**Long weekend session** (2–3 h): the evening shape plus an expansion, a Restoration bundle, barge rows, a Fair push
and the townsfolk board. Session crops and short recipes keep it from running out of things to do.

---

## 2. World and farm layout

### 2.1 Grid and units

| Item | Value |
|---|---|
| Tile | 2 × 2 m (`TILE_M = 2`). Rules use integer tiles; the renderer multiplies by 2. |
| World | 64 × 64 tiles (128 × 128 m). The outer 8-tile ring is decorative: forest wall, hills, river, road, lake, and across the river the **Hollow Village** that Town Projects build (§5.9). |
| Farmable land | 48 × 48 tiles maximum (tiles x, z ∈ [8, 56)), split into a 6 × 6 grid of **parcels** of 8 × 8 tiles. |
| Start ("Homestead") | 6 parcels, 24 × 16 tiles (x ∈ [16, 40), z ∈ [24, 40)) = 384 tiles. |
| Full v1 farm | all 36 parcels, 2,304 tiles, after 15 expansions (§3.9). Restoration project 3 adds the 2-parcel "Hollow Meadow" beyond the north-west edge. |
| Layers | `ground` (paths, soil decals) and `object` (plots, trees, animals' homes, buildings, decor, fences). One object per tile per layer. Animals live inside their home footprint; they cannot stand on plots. |
| Footprints | plot 1×1; fruit tree 2×2; buildings 2×2 to 4×4 (tables); homes 3×3 to 4×4; decor 1×1 to 4×4. |
| Rotation | 0–3 quarter turns (R key); odd rotations swap width and depth. |

### 2.2 Parcel map and expansion order

Numbers are expansion order (§3.9). H = Homestead. North is up (−z). The road enters at the lower-left, the river
runs along the south edge (barge jetty at parcel 7, the village beyond it), the decorative lake lies outside the
south-east corner.

```
         x: 8   16   24   32   40   48   56
            ┌────┬────┬────┬────┬────┬────┐
   z  8     │ 13 │ 13 │ 14 │ 14 │ 15 │ 15 │   ← Maple Ridge / Sunset Hill (gazebo overlook)
            ├────┼────┼────┼────┼────┼────┤
     16     │  9 │  4 │  4 │  5 │  5 │ 10 │
            ├────┼────┼────┼────┼────┼────┤
     24     │  9 │ H  │ H  │ H  │  1 │ 10 │
            ├────┼────┼────┼────┼────┼────┤
     32     │ 11 │ H  │ H  │ H  │  1 │ 12 │
            ├────┼────┼────┼────┼────┼────┤
     40     │ 11 │  2 │  2 │  3 │  3 │ 12 │
            ├────┼────┼────┼────┼────┼────┤
     48     │  6 │  6 │  7 │  7 │  8 │  8 │   ← Fairground Lane (road) · Riverbank (jetty) · Pig Woods
            └────┴────┴────┴────┴────┴────┘
                         river ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  lake (decor) ↘
                         Hollow Village (Town Projects, decorative ring)
```

Every expansion touches land owned before it, so buying in order always grows one connected farm. Locked parcels show
as slightly desaturated wild meadow with a wooden "For sale" signpost (FV2's "$" sign) that opens the expansion card.
**Each owned expansion raises the plot cap by 6** (§3.10), so land is production, not just room for decor.

### 2.3 The starting farm (Homestead)

Coordinates are tile offsets from the Homestead's north-west corner (x 16, z 24). These are the minute-zero spots:
since the owner's change of 2026-10-04 every structure below can be moved with the Hammer (the farmers' porch follows
the Farmhouse).

| Object | Footprint | Position | Notes |
|---|---|---|---|
| Farmhouse | 4×4 | (1, 1) | chimney smoke; Memory Book, Ribbon Wall and wardrobe inside (UI panels); mailbox at (5, 4) |
| Barn | 4×4 | (17, 1) | storage (200 items); doors bump when items fly in |
| Market Stand | 2×2 | (2, 12) | by the road; Mabel's chalkboard for Market Demand |
| Mabel's Order Board | 2×1 | (5, 13) | activates at L2 |
| 16 plots | 4×4 block | (8, 6)–(11, 9) | tilled and empty at start (v2: 16, so two people can plant side by side) |
| Chicken Coop and Feed Mill | 3×3 each | in the build tray | free at L1; placing the Coop is the Barnyard track's first task (§7.4) |
| Well | 2×2 | (13, 2) | decor; the Watering Can "refills" here (cosmetic) |
| Debris | 24 pieces | scattered | 8 weeds, 6 rocks, 4 stumps, 4 logs (2×1), 2 boulders (2×2) |
| Fence line | picket | around the plot block | decor |

**Starter debris** (v2, M7 + X6): weeds 1 XP, rocks 1 XP, stumps and logs 2 XP, boulders 5 XP = **40 XP and 200
coins** in all (5 coins per XP). Wood: **stump 2, log 3**, weeds/rocks/boulders 0 = **20 Wood**, enough for the first
barn upgrades, the first expansions and quest A8 (Wood keeps 20 by default, §3.9). **Debris regrowth** (v2, X4): one weed or rock regrows on a random
free unlocked tile per real hour, at most 12 waiting; each pays 1 XP and 5 coins. Expansion debris uses the §4.5
values (15 pieces: 6 weeds, 4 rocks, 3 stumps, 2 logs = 68 XP, 340 coins, 12 Wood). *Wave 3 (M2)*: the five M2
parcels (expansions 11–15) are old woodland, one of their stumps a **Big Stump** (§4.5 30 XP, 4 Wood, chopped faster
together, §6.2 mechanic 8): 90 XP, 450 coins, 14 Wood each.

Start values: **300 coins, 5 Acorns, 0 XP**, both avatars at the farmhouse porch, the farm name chosen together
(§7.4).

### 2.4 Terrain and zones

- **The board is flat** (y = 0 on all farmable land): picking and placement stay trivial and fast. Height lives in
  the decorative ring: gentle hills, the forest wall, the river bank, the hilltop of Sunset Hill (a raised decorative
  plinth inside parcel 15, still flat on top), the village across the river.
- **Ground masks** (vertex colours): lawn, wild meadow (locked land), worn path (from the footprint map, where
  avatars walk a lot), sand (river bank).
- **Zones** are emergent, not enforced. The design nudges them with bonuses that reward a tidy layout:
  - *Field zone*: plots near a Scarecrow (+5 % bonus-unit chance) and a hive (+5 % pollination).
  - *Orchard zone*: same-species 2×2 blocks of four trees form a **Grove** (+1 fruit each, §3.2) near a Bird Bath.
  - *Barnyard*: homes next to the Feed Mill (no rule, just short walks for the cosmetic avatar).
  - *Workshop row*: production buildings along a path (path beauty bonus).
  - *Garden*: decor clusters for Farm Beauty (variety, path and decor-set bonuses, §3.8, §5.9).

### 2.5 Decorations on the board

Decor is placeable on any free `object` tile; paths on `ground` tiles. Decor never blocks gameplay and can be moved
freely (keeps all timers) or stored (refund rules §3.8). Full list with costs, beauty and effects in §3.8.

---

## 3. Content tables

All tables in this section are generated by `tools/economy-model.mjs --md`. Columns that are derived (Sell, XP, prices,
thresholds) follow the formulas in §4.3; the checks in §4.9 hold for every row.

### 3.1 Crops (21)

| Id | Crop | Lvl | Grow | Seed | Yield | Sell/unit | Plot gross | Net/plot | Net/plot-h | XP | Mastery ★1/★2/★3/Gold | Ready hue | Model archetype |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `wheat` | Wheat | 1 | 1 min | 2 | 2 | 2 | 4 | 2 | 120 | 1 | 50 / 250 / 750 / 2500 | #E8B84A | tall |
| `carrot` | Carrot | 2 | 2 min | 3 | 2 | 4 | 8 | 5 | 150 | 1 | 50 / 250 / 750 / 2500 | #F08A2C | root |
| `corn` | Corn | 3 | 10 min | 18 | 3 | 15 | 45 | 27 | 162 | 6 | 35 / 190 / 560 / 1900 | #F2D04B | tall |
| `strawberry` | Strawberry | 4 | 1 h | 108 | 3 | 90 | 270 | 162 | 162 | 34 | 20 / 100 / 300 / 1000 | #E83A55 | bush |
| `potato` | Potato | 5 | 4 h | 205 | 3 | 171 | 513 | 308 | 77 | 64 | 12 / 60 / 180 / 620 | #C9A06A | root |
| `tomato` | Tomato | 6 | 30 min | 56 | 3 | 47 | 141 | 85 | 170 | 18 | 25 / 130 / 380 / 1300 | #E8463A | bush |
| `sugarcane` | Sugarcane | 8 | 45 min | 86 | 2 | 108 | 216 | 130 | 173 | 27 | 20 / 110 / 330 / 1100 | #9BD86A | tall |
| `pumpkin` | Pumpkin | 9 | 12 h | 356 | 2 | 445 | 890 | 534 | 45 | 111 | 10 / 50 / 150 / 500 | #F2852A | ground |
| `sunflower` | Sunflower | 11 | 6 h | 268 | 2 | 335 | 670 | 402 | 67 | 84 | 11 / 55 / 160 / 530 | #FFD21F | flower |
| `cabbage` | Cabbage | 12 | 24 h | 506 | 2 | 632 | 1,264 | 758 | 32 | 158 | 10 / 50 / 150 / 500 | #B7E36E | ground |
| `raspberry` | Raspberry | 12 | 2 h 30 min | 182 | 3 | 152 | 456 | 274 | 110 | 57 | 15 / 75 / 220 / 730 | #C7234A | bush |
| `oats` | Oats | 13 | 20 min | 41 | 3 | 34 | 102 | 61 | 183 | 13 | 30 / 150 / 440 / 1500 | #D8C27A | tall |
| `rose` | Roses | 13 | 1 h 30 min | 147 | 2 | 184 | 368 | 221 | 147 | 46 | 17 / 85 / 260 / 870 | #D6284B | flower |
| `blueberry` | Blueberry | 14 | 3 h | 204 | 3 | 170 | 510 | 306 | 102 | 64 | 14 / 70 / 200 / 680 | #4D5BD6 | bush |
| `cotton` | Cotton | 16 | 10 h | 358 | 2 | 448 | 896 | 538 | 54 | 112 | 10 / 50 / 150 / 500 | #FFFFFF | bush |
| `coffee` | Coffee Beans | 16 | 5 h | 263 | 3 | 219 | 657 | 394 | 79 | 82 | 11 / 55 / 170 / 570 | #A3262A | bush |
| `lavender` | Lavender | 18 | 2 h | 178 | 2 | 223 | 446 | 268 | 134 | 56 | 16 / 80 / 240 / 780 | #A98BE0 | flower |
| `onion` | Onion | 24 | 1 h 30 min | 168 | 3 | 140 | 420 | 252 | 168 | 53 | 17 / 85 / 260 / 870 | #E7C8A0 | root |
| `watermelon` | Watermelon | 27 | 16 h | 503 | 2 | 629 | 1,258 | 755 | 47 | 157 | 10 / 50 / 150 / 500 | #3E8E3A | ground |
| `pepper` | Bell Pepper | 31 | 5 h | 311 | 3 | 259 | 777 | 466 | 93 | 97 | 11 / 55 / 170 / 570 | #E03C2E | bush |
| `rice` | Rice | 35 | 8 h | 400 | 3 | 333 | 999 | 599 | 75 | 125 | 10 / 50 / 150 / 500 | #CFE59A | tall |

**Reading the table.** *Plot gross* = Yield × Sell. *Net/plot-h* is what one plot earns per hour if replanted the
moment it ripens. Up to an hour, value is proportional to grow time (v2: no attention premium), so the newest session
crop is always the best per plot-hour (Wheat → Carrot → Corn → Tomato → Sugarcane → Oats) by a small margin (+1.5 % per
unlock level) and Wheat becomes the cheap ingredient and tutorial crop. Long crops pay the most per planting, so they
win whenever you are away. *XP* is per plot harvested. Mastery counts plot harvests of that crop by either player.

**Rules (crops).**

1. **Plant**: pay the seed price from the treasury, the plot gets `{def, plantedAt, readyAt = plantedAt + growMs, by}`.
   There is no plowing step; a harvested plot returns to "tilled" instantly.
2. **Uproot** (v2, C1): the Hand (or a Shift-drag) removes a growing crop. Inside the 10-minute undo window the seed is
   refunded 100 %, after it 0 %. No XP either way (XP is paid only at harvest). The toast names the player. The Smart
   Hand plants on an empty plot only if *this player chose that seed in this session*; otherwise it opens the seed
   tray (no accidental field of yesterday's 24-h Cabbage).
3. **Grow**: real time from timestamps, also while both players are offline or the server is off.
4. **Water (optional, free, unlimited)** (v2, C2): crops with a grow time of **≥ 30 min** can be watered once per
   cycle by anyone: **−15 % of the base grow time**. Once per cycle the *other* player may add a **partner tend: a
   further −5 %**. Nobody ever gains by leaving work for the partner. Faster crops cannot be watered (no click tax on
   the fast loop). Sprinklers and rain water automatically (§3.7, §5.10). Watering rewrites
   `readyAt = max(plantedAt + 0.5 × base, readyAt − k × base)` (the 50 % floor uses the base time, ruling X7e).
5. **Compost (fertilizer)**: one Compost on a plot (before planting or while growing, not once ready) gives **+1 unit**
   at harvest and a **blue-ribbon chance** of 10 % (+2 points per mastery star ★1–★3, +5 more at Gold ★, +3 from the
   Grower perk; at most 24 %). A blue-ribbon harvest gives one more unit (so +2 total), sparkles blue, and scores Fair
   points (§5.6). With the v2 yields (no crop yields 1), one Compost adds 56–100 % of a planting's net.
6. **Harvest**: click or drag the Sickle. Produce pops, bounces, flies to the barn. XP is paid at harvest (never at
   planting), split 40 % planter / 60 % harvester for personal XP; Farm XP counts the full amount once.
7. **Freshness**: harvesting within the Fresh window — `clamp(25 % of grow time, 5 min, 2 h)` after ripening — pays
   **+10 % XP** ("Fresh!" tag). After it the crop simply waits, forever, at full yield. Nothing withers, ever.
8. **Seasons**: each crop is in season in one real-calendar season (table below). In season: **−10 % grow time** (fixed
   at planting) and **+10 % sell price**. Off-season crops are never banned.
9. **Mastery** (§4.8): ★1 +5 % sell price · ★2 −10 % grow time · ★3 15 % chance of +1 unit and a Mastery Sign decor ·
   Gold ★ (from L30) +5 points blue-ribbon chance and a gold sign.
10. **Level-up Bloom**: at every farm level-up **everything growing on the farm finishes at once**: every planted crop
    is ripe, every tree's current fruit is ripe (a sapling becomes a mature tree with its first fruit), every baby animal
    is grown up (it still wants its first meal) and every animal product on its way, honey included, waits to be
    collected. Production-building queues are **not** touched. Both screens see a sparkle wave over everything that
    finished and the card "New level! Everything on the farm is ready 🌾". In a multi-level jump the first level
    finishes the farm. *Changed by the owner 2026-10-04: a level-up finishes everything growing* (it replaces v2 X5's
    −25 % of the remaining time, at most 60 minutes, for processes started at least 15 minutes earlier; planting just
    before the bar fills is now part of the reward, on purpose).

| Season (Northern hemisphere) | In-season crops |
|---|---|
| Spring (Mar–May) | Carrot, Strawberry, Lavender, Onion, Roses |
| Summer (Jun–Aug) | Corn, Tomato, Sunflower, Blueberry, Watermelon, Bell Pepper, Raspberry |
| Autumn (Sep–Nov) | Potato, Pumpkin, Oats, Cotton, Rice |
| Winter (Dec–Feb) | Wheat, Sugarcane, Cabbage, Coffee Beans |

**Visual stages** (all crops; `visual-ux-juice.md` §3.6): 0 tilled · 1 seeded (0–10 % of grow time) · 2 sprout
(10–40 %) · 3 growing (40–100 %) · 4 ready (+8 % scale, saturated produce, golden sparkle, sway ×1.6). After the
Fresh window the sparkle turns from gold to white (still ready). Archetypes map to assets: `tall` = crossed cards
or Quaternius `Wheat/Corn/Rice` stages, Sugarcane = Quaternius `Bamboo_1…4` recoloured; `root` = leaf tufts with a
sliver of produce (`Carrot`, `Beet` recoloured for potato/onion), pulled with a 150 ms yank; `bush` =
`BushBerries`/`Tomato` stages recoloured; `ground` = `Pumpkin`/`Watermelon`/`Lettuce` (cabbage), one plant per plot,
stage 4 simplified to 30–50 % of its triangles; `flower` = `Flower` ×2.5 (sunflower) or recoloured clusters
(lavender). Cotton and sunflower are procedural where the catalog has gaps (`assets-catalog.md` §4).

### 3.2 Trees (14: 13 fruit/nut/sap + 1 timber)

| Id | Tree | Lvl | Price | Cycle | Sapling | Yield (mature) | Product | Sell/unit | Harvest value | XP | Payback (harvests) | Bee forage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `apple_tree` | Apple Tree | 4 | 4,900 | 4 h | 8 h | 5 | `apple` | 162 | 810 | 101 | 6.0 | yes |
| `pine` | Pine (woodlot) | 6 | 6,800 | 8 h | 16 h | 8 | `wood` | 142 | 1,136 | 142 | 6.0 | no |
| `cherry_tree` | Cherry Tree | 11 | 6,400 | 6 h | 12 h | 5 | `cherry` | 214 | 1,070 | 134 | 6.0 | yes |
| `orange_tree` | Orange Tree | 13 | 7,500 | 8 h | 16 h | 6 | `orange` | 208 | 1,248 | 156 | 6.0 | yes |
| `pomegranate_tree` | Pomegranate Tree | 14 | 8,800 | 11 h | 22 h | 5 | `pomegranate` | 292 | 1,460 | 183 | 6.0 | yes |
| `lemon_tree` | Lemon Tree | 15 | 7,700 | 8 h | 16 h | 6 | `lemon` | 214 | 1,284 | 161 | 6.0 | yes |
| `peach_tree` | Peach Tree | 17 | 5,100 | 3 h | 6 h | 4 | `peach` | 211 | 844 | 106 | 6.0 | yes |
| `pear_tree` | Pear Tree | 19 | 8,900 | 10 h | 20 h | 6 | `pear` | 248 | 1,488 | 186 | 6.0 | yes |
| `plum_tree` | Plum Tree | 23 | 8,000 | 7 h | 14 h | 5 | `plum` | 265 | 1,325 | 166 | 6.0 | yes |
| `walnut_tree` | Walnut Tree | 26 | 10,000 | 12 h | 24 h | 6 | `walnut` | 291 | 1,746 | 218 | 5.7 | no |
| `olive_tree` | Olive Tree | 30 | 11,000 | 12 h | 24 h | 6 | `olive` | 304 | 1,824 | 228 | 6.0 | yes |
| `maple_tree` | Maple Tree | 34 | 11,000 | 10 h | 20 h | 6 | `maple_sap` | 292 | 1,752 | 219 | 6.3 | no |
| `cocoa_tree` | Cocoa Tree | 36 | 13,000 | 16 h | 32 h | 6 | `cocoa` | 368 | 2,208 | 276 | 5.9 | yes |
| `fig_tree` | Fig Tree | 39 | 11,000 | 9 h | 18 h | 5 | `fig` | 351 | 1,755 | 219 | 6.3 | yes |

**Rules (trees).**

1. **Buy and place** a sapling (2×2 tiles, not on plots). Price of the n-th tree of one species = table price
   × **1.45^(n−1)** (v2, M8). Free trees (quest A6, expansions 1, 2 and 12) do not count toward n (ruling X7f).
2. **Tree cap per species** (v2, M8): **4 (one Grove) + 1 per 10 farm levels, at most 8**. Land, not money, used to be
   the only limit and the cheapest trees became a monoculture; the cap keeps fields, animals and every species
   relevant.
3. **Sapling**: grows for **2 cycles** with no fruit, then is **Mature** for good. Trees never wither, never die,
   never need replanting.
4. **Cycle**: a mature tree ripens every cycle. Click or drag the Basket to harvest: the tree shakes (spring, 600 ms),
   fruit drops and flies to the barn. The next cycle starts at harvest.
5. **Water**: once per cycle, anyone: **−20 % of the cycle**; the *other* player's partner tend adds **−5 %** more.
6. **Compost**: once per cycle, +1 fruit and a 10 % blue-ribbon fruit chance (Fair 3 points + V/100, sells at 4 × V).
7. **Grove**: four trees of the **same species** in an exact 2×2 block of trees (a 4×4-tile square) each give **+1
   fruit**. Derived at harvest from the grid; mixed blocks get nothing.
8. **Heirloom**: after **60 harvests** an individual tree becomes Heirloom permanently: gnarlier, larger mesh, **+1
   fruit**, and a **5 % blue-ribbon fruit** chance on every harvest (from L22 the ribbon fruit is visible on the tree).
9. **Pine (woodlot)** is chopped, not shaken: 8 Wood per 8 h (v2: 8, was 4, so Wood is cheap building stock); it
   re-grows from a stump automatically (no replant).
10. **Bees**: flowering trees (column *Bee forage*) count as forage for hives within 4 tiles.
11. **Mastery** per species: harvest thresholds from the same formula as crops (§4.8); ★1 +5 % sell, ★2 −10 % cycle,
    ★3 15 % chance of +1 fruit, Gold +5 points blue-ribbon fruit chance.

Asset mapping: Quaternius `Apple_1…4` (apple, and recoloured fruit for cherry, plum, peach), `Orange_1…4`
(orange, lemon, pear by recolour); walnut, olive, maple, cocoa, fig use `CommonTree`/`BirchTree` canopies with
instanced fruit; Pine uses `PineTree` (Ultimate Nature) plus `TreeStump`. Every species gets **shape parameters**
(canopy scale XYZ, trunk height, lean) so recolours read as different trees: olive silver-green and squat, pear tall
and narrow, peach wide and low.

### 3.3 Feed (Feed Mill)

| Id | Feed | Lvl | Inputs | Time | Out | Value/unit (upkeep, not sold) |
|---|---|---|---|---|---|---|
| `chicken_feed` | Chicken Feed | 1 | 3 grain | 5 min | 6 | 2 |
| `livestock_feed` | Livestock Feed | 7 | 2 grain + 1 root | 10 min | 6 | 3 |
| `rabbit_greens` | Rabbit Greens | 14 | 2 root + 1 veg | 10 min | 6 | 4 |
| `pig_slop` | Pig Slop | 17 | 2 produce | 10 min | 6 | 3 |

- Feed recipes take **ingredient classes**: *grain* = Wheat, Corn, Oats, Sunflower, Rice; *root* = Carrot, Potato,
  Onion; *produce* = any crop or fruit. The mill uses the **cheapest available member first** and skips items under a
  "Keep N" lock (§6.3) or toggled "not for feed" in the Barn panel. A missing crop never blocks feeding. A member
  worth more than **10 × the feed's V** is never used silently: when only such members are left (no grain, but
  Sunflowers), the mill asks first ("Use 3 Sunflowers (1,005 coins) for Chicken Feed?", soft confirm `RESERVED`;
  wave-1 QA RC-17).
- **One batch makes 6** (v2, H1: was 3). A full barnyard in active play needs about 74 mill-minutes per hour, so one
  Feed Mill keeps up; the second Feed Mill (L31) is for very large barnyards.
- Feed is **upkeep**: it cannot be sold at the Market (rules out feed arbitrage) and orders never ask for it. The
  General Store sells emergency feed at 2.5 × V.
- Feed Mill starts with 3 slots (it is the busiest machine), up to 6. It and the Chicken Coop arrive free at **L1**.

### 3.4 Animals (10 species)

| Id | Animal | Lvl | Home (cap start→max) | Baby price | Adult price | Baby grows | Eats | Cycle | Product | Sell | Net/collection | Net/h | XP | Blue ribbon after | Blue-ribbon good (10 % chance) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `chicken` | Chicken | 1 | Chicken Coop (6→12) | 800 | 1,300 | 30 min | 1 chicken_feed | 20 min | 1 `egg` | 82 | 80 | 240 | 10 | 60 | `golden_egg` (328) |
| `cow` | Cow | 7 | Cow Barn (4→8) | 1,400 | 2,200 | 2 h | 1 livestock_feed | 1 h | 1 `milk` | 142 | 139 | 139 | 18 | 40 | `cream_top_milk` (568) |
| `sheep` | Sheep | 12 | Sheep Pasture (4→8) | 2,800 | 4,500 | 6 h | 2 livestock_feed | 4 h | 1 `wool` | 285 | 279 | 70 | 36 | 25 | `silk_wool` (1140) |
| `bee` | Bee Colony | 13 | Beehive (1 colony per hive) | in hive price | — | — | flowers in range | 6 h | 1 `honey` | 342 | 342 | 57 | 43 | 25 | `royal_jelly` (1368) |
| `rabbit` | Rabbit | 14 | Rabbit Hutch (4→8) | 2,000 | 3,200 | 1 h 30 min | 1 rabbit_greens | 2 h | 1 `angora_wool` | 201 | 197 | 99 | 25 | 40 | `cloud_angora` (804) |
| `pig` | Pig | 17 | Pig Pen (4→8) | 2,800 | 4,500 | 4 h | 1 pig_slop | 4 h | 1 `truffle` | 282 | 279 | 70 | 35 | 25 | `black_truffle` (1128) |
| `duck` | Duck | 19 | Duck Pond (4→8) | 1,700 | 2,700 | 1 h | 1 chicken_feed | 1 h 30 min | 1 `duck_egg` | 173 | 171 | 114 | 22 | 40 | `golden_feather` (692) |
| `goat` | Goat | 22 | Goat Yard (4→8) | 2,400 | 3,800 | 4 h | 2 livestock_feed | 3 h | 1 `goat_milk` | 247 | 241 | 80 | 31 | 25 | `aged_goat_cheese` (988) |
| `horse` | Horse | 25 | Stable (2→4) | 3,400 | 5,400 | 8 h | 2 livestock_feed | 6 h | 2 `manure` | 174 | 342 | 57 | 44 | 20 | `show_ribbon` (696) |
| `alpaca` | Alpaca | 33 | Alpaca Paddock (4→8) | 3,100 | 5,000 | 6 h | 2 livestock_feed | 5 h | 1 `alpaca_fiber` | 318 | 312 | 62 | 40 | 25 | `royal_fiber` (1272) |

| Id | Housing | Lvl | Size (tiles) | Cost | Capacity upgrade (+2 animals; +1 hive slot for beehives) |
|---|---|---|---|---|---|
| `coop` | Chicken Coop | 1 | 3×3 | 0 | 440 |
| `cow_barn` | Cow Barn | 7 | 4×3 | 5,300 | 3,000 |
| `pasture` | Sheep Pasture | 12 | 4×4 | 14,000 | 8,000 |
| `beehive` | Beehive | 13 | 1×1 | 3,400 | each further hive 3,400 × 1.1^(n−1) |
| `hutch` | Rabbit Hutch | 14 | 3×2 | 20,000 | 11,000 |
| `pig_pen` | Pig Pen | 17 | 4×3 | 31,000 | 18,000 |
| `duck_pond` | Duck Pond | 19 | 4×4 | 39,000 | 22,000 |
| `goat_yard` | Goat Yard | 22 | 4×4 | 49,000 | 28,000 |
| `stable` | Stable | 25 | 4×3 | 59,000 | 34,000 |
| `paddock` | Alpaca Paddock | 33 | 4×4 | 88,000 | 50,000 |

**Rules (animals).**

1. **Homes first**: each species lives in its home building (table above); capacity starts at *cap start* and grows by
   +2 per upgrade to *cap max*. Bees are the exception: every **Beehive** is one colony; hives are placed
   individually (max 2 at L13, +1 every 3 levels, max 8); the n-th hive costs the table price × 1.1^(n−1).
2. **Buy** a baby (grows by itself in *Baby grows*) or an adult (1.6 × price, produces at once — the only "skip").
   The n-th animal of a species costs price × **1.1^(n−1)** (gifts are not counted). The **first bought hen** repays
   itself in 7 collections instead of 10: **560 / 900** coins (baby / adult), so it pays back within ~3 hours of tended
   play (wave-1 QA RC-28; the second costs 880, the curve from the table price). Every purchase carries the price the
   player saw: if the partner bought one first and the price rose, the game asks again (soft code `PRICE`, "Mia just
   bought one. The next hen is 880. Buy it?") instead of charging more than the screen said.
3. **Babies** grow on their own; a **Baby Bottle** (Dairy) given by anyone cuts **30 %** of the remaining time, at most
   **one bottle per baby per player per hour**, and never below **50 % of the whole growth** counted from the purchase
   (§4.8 floor; a bottle that would cut nothing is refused and uses nothing: a chick never matures before 15 min, a
   calf never before 60 min; wave-1 QA RC-03). Once per baby per hour the *other* player may add a partner bottle for
   **−20 %** more (v2, C2; M2). Chicks and ducklings take a
   Chicken Feed instead of a bottle. Babies never die and never need bottles to grow. Baby Bottles are a consumable:
   not sellable, not orderable (v2, L2).
4. **Cycle**: feeding starts the cycle (`readyAt = fedAt + cycle`); the product **waits on the animal** until someone
   collects it; the animal does not eat again until collected. Nothing overflows, nothing is lost.
5. **Tend = collect + re-feed in one click** (default; can be split in Settings). Drag the Feed Scoop over a pen to
   tend every ready or hungry animal under the stroke.
6. **Petting** (v2, C8): a Hand drag pets every animal under the stroke; a pet lasts **until the end of the real
   day**: +10 % chance of a bonus product on every cycle that day, **+20 % if both players petted it**. No permanent
   meter, so nothing decays, and no per-cycle click tax.
7. **Blue ribbon**: after *Prized after* collections an individual animal earns a blue ribbon (model +5 % scale,
   rosette). It **keeps producing at the normal cycle** and adds a **10 % chance of its blue-ribbon good** (4 × V, Fair
   points ×2, sellable, orderable on the barge). Selling a blue-ribbon animal returns 100 % of **the price paid for
   it** (its own purchase index n, ruling X7g) instead of 50 %.
8. **Compost Bin** (L8, collector): every animal collection adds 1 point; every 20 points drop **3 Compost** into the
   bin (holds up to 3 batches = 9 Compost waiting; points stop while full). Horses add Manure → Compost via the bin's
   recipe (3 Compost per Manure, 2 h). Compost is a consumable: not sellable, not orderable.
9. **Never punish**: animals never die, sicken, lose stats or run away. An unfed animal just waits.
10. **Wandering is cosmetic and deterministic** (`hash32(id, serverNow/6 s)` within 1.5 tiles of its spot), so both
    screens show the same cow at the same place with zero traffic.

**Nursery (L19)**: a baby placed in the Nursery gets a 3-step care card (Feed, Play, Groom), each step 1 Baby Bottle,
at least 10 min apart, either player. At the end the couple picks a **personality** (Sleepy / Playful / Grumpy — the
idle animation set) and a **specialty**: *Bountiful* (+5 % bonus-product chance) or *Tidy* (+1 Compost Bin point per
collection). Optional and purely positive.

**Breeding Barn (L28)**: pick two adults of one species; after 2 × the baby time a baby appears with a **coat variant**
(white 40 % / brown 30 % / spotted 25 % / golden 5 %, pity: golden guaranteed by the 20th breeding of a species). The
couple names it. Parents are untouched. Coats fill the "Coats" album pages; no stat differences (no power creep).
Cost: 2 Baby Bottles (or 2 Chicken Feed for poultry).

**Pets (L10)** (v2, A3): **each player adopts one pet** — a dog or a cat — names it, and it follows *them*. Each pet
takes one treat a day (Dog Biscuit / Cat Treat, crafted in the Kitchen). A fed pet brings its owner's **daily find**
the next morning (one of: 5-plant seed packet of a random unlocked crop · 3 Compost · a collection roll on a random
set), sits beside idle avatars, and greets the partner. If **both** players petted both pets that day, the pets dig up
a small shared treasure (a second find). Pets never punish neglect.

**Bees**: a hive's cycle is 6 h if at least **3 forage objects** (flower crops, flowering trees, flower decor) are within
4 tiles when the cycle starts; otherwise 12 h (fixed at start, shown on the hive). Crops and trees within 4 tiles of a
productive hive get **+5 % bonus-unit chance** (pollination, at most one hive effect per object).

**Horse**: produces Manure (2 per 6 h → 6 Compost). Utility: each adult Horse raises **River Barge crate payouts by
+5 %** (max +20 % with 4 horses; the horses pull the cart to the jetty) and enters the Fair horse show when it wears a
blue ribbon (blue-ribbon good: Show Ribbon). The avatar can ride a horse as a pure cosmetic (walk speed ×1.8).

Asset mapping (`assets-catalog.md` §3.4): Cow, Horse, Alpaca from Ultimate Animated Animals; Sheep, Pig from the Farm
Animal pack; Chicken, Duck from vertexcat; Goat = Gobkit `Goat` with a matched material pass (a recoloured Deer reads as
a deer); Dog = ShibaInu; Cat = Quaternius Vol.2 Cat; bees are instanced sprites around a procedural Langstroth hive.
All small livestock use **procedural rigid motion** (bob, waddle, peck, hop) on instanced meshes; at most 8 skinned
animals near the camera or being tended (§8.6).

### 3.5 Production buildings and recipes (17 buildings, 117 recipes + 4 feeds)

| Id | Building | Lvl | Size | Cost | Slots start→max | Slot upgrade cost (k = 1, 2, 3 …) |
|---|---|---|---|---|---|---|
| `feed_mill` | Feed Mill | 1 | 3×3 | 0 | 3→6 | 550 / 880 / 1400 |
| `mill` | Windmill | 3 | 3×3 | 0 | 2→6 | 830 / 1300 / 2100 / 3400 |
| `bakery` | Bakery | 4 | 3×3 | 2,600 | 2→6 | 1300 / 2100 / 3300 / 5300 |
| `sawmill` | Sawmill | 6 | 3×3 | 6,000 | 2→5 | 3000 / 4800 / 7700 |
| `dairy` | Dairy | 7 | 3×3 | 9,000 | 2→6 | 3800 / 6000 / 9600 / 15000 |
| `compost_bin` | Compost Bin | 8 | 2×2 | 4,800 | 1→3 | 4000 / 6400 |
| `kitchen` | Farm Kitchen | 9 | 3×3 | 14,000 | 2→6 | 6000 / 9600 / 15000 / 25000 |
| `preserves` | Preserves Kitchen | 11 | 3×3 | 19,000 | 2→6 | 8000 / 13000 / 20000 / 33000 |
| `weaver` | Weaver's Shed | 12 | 3×3 | 24,000 | 2→5 | 10000 / 16000 / 26000 |
| `sewing` | Sewing Table | 14 | 2×2 | 34,000 | 2→5 | 14000 / 23000 / 36000 |
| `pie_oven` | Pie Oven | 15 | 3×2 | 49,000 | 2→6 | 18000 / 28000 / 45000 / 72000 |
| `juice_press` | Juice Press | 6 | 2×2 | 7,200 | 2→6 | 3000 / 4800 / 7700 / 12000 |
| `chandlery` | Chandlery | 16 | 3×3 | 53,000 | 2→5 | 19000 / 30000 / 49000 |
| `packing` | Packing Table | 20 | 3×2 | 96,000 | 2→4 | 30000 / 48000 |
| `oil_press` | Oil Press | 30 | 3×3 | 180,000 | 2→5 | 55000 / 88000 / 140000 |
| `sugar_shack` | Sugar Shack | 34 | 3×3 | 210,000 | 2→4 | 65000 / 100000 |
| `chocolatier` | Chocolatier | 36 | 3×3 | 250,000 | 2→5 | 70000 / 110000 / 180000 |

**Rules (buildings).**

1. **Timed queue, no energy.** Each building crafts one item at a time; *slots* = queued + finished-uncollected items.
   Inputs are consumed **when the item enters the queue** (a started process can never fail later). Queue time
   starts at `max(now, end of the previous item)`.
2. **Finished goods wait in the building's tray** and are collected with one click (or by dragging the Basket over
   buildings). Collected goods go to the Barn or its overflow (§3.6); at 2 × capacity they stay in the tray until there
   is room, and queueing stays allowed until the slots fill (ruling X7c).
3. **Cancel** a queued item that has not started: full refund of inputs, later items re-time. A started item cannot
   be cancelled (its inputs are already in the pot). A cancel names the item by its own key, never by its place in
   the queue, so a stale or simultaneous cancel answers "already cancelled or collected" and never removes another
   item (wave-1 QA RC-06).
4. **Slot upgrades** cost coins only (column *Slot upgrade cost*) and apply at once.
5. **Building mastery** per recipe (§4.8): ★1 +5 % sell, ★2 −10 % time, ★3 10 % chance of double output, Gold +5 % XP.
6. **Duet recipes** (marked *Duet*) are made in a two-step joint action (§6.2 mechanic 7): both players press "Cook
   together" at the building within 3 s → normal time and +25 % XP. Alone, the same recipe "slow-cooks" in 2 × time
   with normal XP. Duets need nothing else; solo is never blocked. Duet goods are wanted by one golden order in three
   (2.0 × V, §5.2) and score double at the Fair.
7. **Second copies** (v2, M1): from **L16 a second Windmill**, from **L18 a second Dairy**, from L31 a second Feed Mill,
   from L33 a second Pie Oven (price × 2). Flour, Sugar, Cream and Butter feed most of the T3 tree; one queue each was
   the bottleneck. All other buildings are unique.
8. **Construction is instant** (no builder timers, no friend-gating): the building drops in with a squash and dust ring.
9. **Level-up Bloom** does not touch the queues: recipes keep their times. *Changed by the owner 2026-10-04: a level-up
   finishes everything growing* (crops, trees, animals: §3.1 rule 10); production buildings are left out on purpose
   (v2 X5 used to cut the running item by 25 % of its remaining time, at most 60 minutes).
10. **New recipe** cards appear on the building with a "Try it" ribbon until the farm has made that recipe once (the
    Recipe Box ribbon, §5.4, counts them).

**Recipe value** (v2, §4.3): every recipe's output is worth **its inputs plus the machine's time**
(`12 × minutes^0.8 × (1 + 1.5 % per unlock level)`), with no markup on inputs. Inside a building a shorter recipe always
earns more per hour and a longer one more per craft, so **no recipe dominates another** (§4.9 R18): short recipes are
for the evening, long ones for the days away, and orders decide which goods are wanted. Recipes with expensive inputs
take longer (hampers 1.5–4.5 h) so every recipe adds at least 15 % to its inputs (R3).

Recipe tables per building (Tier: T2 intermediate, T3 crafted good, T4 premium/hamper, Duet; the tier no longer
changes the value, only order and Fair rules; *× inputs* is the sell value of the output over the sell value of all
inputs):

#### Windmill (`mill`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `raspberry_tart` | Raspberry Tart | 15 | 1 flour + 3 raspberry + 1 butter | 1 h 40 min | 1 | 992 | 1,570 | 1.58 | 72 | T3 |
| `fertilizer` | Fertilizer | 10 | 2 compost + 1 egg | 30 min | 1 | 700 | 907 | 1.30 | 26 | T2 |
| `flour` | Flour | 3 | 3 wheat | 5 min | 1 | 6 | 51 | 8.50 | 6 | T2 |
| `cornmeal` | Cornmeal | 3 | 2 corn | 10 min | 1 | 30 | 108 | 3.60 | 10 | T2 |
| `sugar` | Sugar | 8 | 1 sugarcane | 20 min | 1 | 108 | 254 | 2.35 | 18 | T2 |
| `oat_flakes` | Oat Flakes | 13 | 2 oats | 10 min | 1 | 68 | 157 | 2.31 | 11 | T2 |

#### Bakery (`bakery`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `bread` | Bread | 4 | 1 flour | 5 min | 1 | 51 | 96 | 1.88 | 6 | T3 |
| `carrot_muffin` | Carrot Muffin | 4 | 1 flour + 2 carrot + 1 egg | 20 min | 1 | 141 | 279 | 1.98 | 17 | T3 |
| `corn_bread` | Corn Bread | 4 | 1 cornmeal + 1 egg | 30 min | 1 | 190 | 381 | 2.01 | 24 | T3 |
| `pancakes` | Pancakes | 8 | 1 flour + 2 egg + 1 milk | 30 min | 1 | 357 | 558 | 1.56 | 25 | T3 |
| `cookies` | Cookies | 10 | 1 flour + 1 egg + 1 sugar | 45 min | 1 | 387 | 673 | 1.74 | 36 | T3 |
| `sweetheart_cake` | Sweetheart Cake | 10 | 2 flour + 2 egg + 1 butter + 2 strawberry | 1 h duet / 2 h solo | 1 | 931 | 1,291 | 1.39 | 56 | Duet |
| `blueberry_muffin` | Blueberry Muffin | 14 | 1 flour + 1 egg + 2 blueberry | 40 min | 1 | 473 | 747 | 1.58 | 34 | T3 |
| `granola_bar` | Granola Bar | 15 | 1 oat_flakes + 1 honey + 1 strawberry | 40 min | 1 | 589 | 867 | 1.47 | 35 | T3 |
| `pizza` | Pizza | 20 | 1 flour + 2 tomato + 1 cheese | 1 h | 1 | 931 | 1,339 | 1.44 | 51 | T3 |
| `walnut_cookies` | Walnut Cookies | 26 | 1 flour + 1 walnut + 1 butter | 45 min | 1 | 827 | 1,174 | 1.42 | 43 | T3 |
| `olive_bread` | Olive Bread | 30 | 1 flour + 2 olive | 30 min | 1 | 659 | 921 | 1.40 | 33 | T3 |
| `maple_pancakes` | Maple Pancakes | 34 | 1 flour + 2 egg + 1 maple_syrup | 30 min | 1 | 1,274 | 1,547 | 1.21 | 34 | T3 |

#### Sawmill (`sawmill`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `planks` | Planks | 6 | 1 wood | 10 min | 2 | 142 | 112 | 1.58 | 10 | T2 |
| `wooden_crate` | Wooden Crate | 6 | 2 planks | 20 min | 1 | 224 | 366 | 1.63 | 18 | T3 |
| `bird_house` | Bird House | 9 | 3 planks | 1 h | 1 | 336 | 692 | 2.06 | 45 | T3 |
| `toy_horse` | Toy Horse | 12 | 2 planks + 1 yarn | 2 h | 1 | 721 | 1,365 | 1.89 | 81 | T3 |

#### Dairy (`dairy`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `baby_bottle` | Baby Bottle | 7 | 1 milk | 10 min | 2 | 142 | 112 | 1.58 | 10 | T2 |
| `cream` | Cream | 7 | 1 milk | 20 min | 1 | 142 | 286 | 2.01 | 18 | T2 |
| `butter` | Butter | 7 | 1 cream | 30 min | 1 | 286 | 485 | 1.70 | 25 | T2 |
| `yogurt` | Strawberry Yogurt | 7 | 1 milk + 1 strawberry | 45 min | 1 | 232 | 507 | 2.19 | 34 | T3 |
| `cheese` | Cheese | 10 | 3 milk | 1 h | 1 | 426 | 786 | 1.85 | 45 | T3 |
| `ice_cream` | Ice Cream | 18 | 1 cream + 1 sugar + 1 blueberry | 1 h | 1 | 710 | 1,108 | 1.56 | 50 | T3 |
| `goat_cheese` | Goat Cheese | 22 | 2 goat_milk | 1 h 30 min | 1 | 494 | 1,071 | 2.17 | 72 | T3 |

#### Compost Bin (`compost_bin`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `compost` | Compost | 25 | 1 manure | 2 h | 3 | 174 | 309 | 5.33 | 94 | T2 |

#### Farm Kitchen (`kitchen`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `omelette` | Omelette | 9 | 2 egg + 1 milk | 20 min | 1 | 306 | 454 | 1.48 | 19 | T3 |
| `veggie_soup` | Veggie Soup | 9 | 2 carrot + 1 potato + 1 tomato | 40 min | 1 | 226 | 483 | 2.14 | 32 | T3 |
| `pumpkin_soup` | Pumpkin Soup | 9 | 2 pumpkin + 1 cream + 1 carrot | 45 min | 1 | 1,180 | 1,462 | 1.24 | 35 | T3 |
| `dog_biscuit` | Dog Biscuit | 10 | 1 flour + 1 egg + 1 milk | 15 min | 1 | 275 | 394 | 1.43 | 15 | T3 |
| `cat_treat` | Cat Treat | 10 | 1 cream + 1 egg | 15 min | 1 | 368 | 487 | 1.32 | 15 | T3 |
| `popcorn` | Popcorn | 10 | 2 corn + 1 butter | 30 min | 1 | 515 | 722 | 1.40 | 26 | T3 |
| `roasted_seeds` | Roasted Sunflower Seeds | 11 | 2 sunflower | 30 min | 1 | 670 | 880 | 1.31 | 26 | T3 |
| `coleslaw` | Coleslaw | 12 | 2 cabbage + 2 carrot | 30 min | 1 | 1,272 | 1,484 | 1.17 | 27 | T3 |
| `potato_gratin` | Potato Gratin | 12 | 2 potato + 1 cheese + 1 cream | 1 h | 1 | 1,414 | 1,784 | 1.26 | 46 | T3 |
| `harvest_feast` | Harvest Feast | 15 | 1 veggie_soup + 1 corn_bread + 1 apple_pie | 1 h duet / 2 h solo | 1 | 2,555 | 2,939 | 1.15 | 60 | Duet |
| `farm_coffee` | Farmhouse Coffee | 16 | 2 coffee + 1 milk | 25 min | 1 | 580 | 773 | 1.33 | 24 | T3 |
| `truffle_pasta` | Truffle Pasta | 17 | 1 flour + 1 egg + 1 truffle + 1 butter | 1 h 30 min | 1 | 900 | 1,444 | 1.60 | 68 | T4 |
| `custard` | Custard | 19 | 2 duck_egg + 1 milk + 1 sugar | 45 min | 1 | 742 | 1,062 | 1.43 | 40 | T3 |
| `french_onion_soup` | French Onion Soup | 24 | 2 onion + 1 cheese + 1 bread | 1 h | 1 | 1,162 | 1,589 | 1.37 | 53 | T3 |
| `wedding_cake` | Wedding Cake | 25 | 3 flour + 4 egg + 2 butter + 2 sugar + 1 cream | 2 h duet / 4 h solo | 1 | 2,245 | 2,997 | 1.33 | 118 | Duet |
| `watermelon_salad` | Watermelon Salad | 27 | 2 watermelon + 1 goat_cheese | 45 min | 1 | 2,329 | 2,680 | 1.15 | 44 | T3 |
| `potato_chips` | Potato Chips | 30 | 2 potato + 1 sunflower_oil | 45 min | 1 | 1,803 | 2,165 | 1.20 | 45 | T3 |
| `stuffed_peppers` | Stuffed Peppers | 31 | 2 pepper + 1 tomato + 1 cheese | 1 h | 1 | 1,351 | 1,811 | 1.34 | 58 | T3 |
| `maple_fudge` | Maple Walnut Fudge | 34 | 1 maple_syrup + 1 walnut + 1 butter | 1 h | 1 | 1,835 | 2,310 | 1.26 | 59 | T3 |
| `rice_pudding` | Rice Pudding | 35 | 2 rice + 1 milk + 1 sugar | 45 min | 1 | 1,062 | 1,443 | 1.36 | 48 | T3 |
| `risotto` | Truffle Risotto | 35 | 2 rice + 1 truffle + 1 butter | 1 h 30 min | 1 | 1,433 | 2,096 | 1.46 | 83 | T4 |
| `hot_cocoa` | Hot Cocoa | 36 | 1 chocolate + 1 milk | 30 min | 1 | 1,758 | 2,036 | 1.16 | 35 | T3 |

#### Preserves Kitchen (`preserves`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `ketchup` | Ketchup | 11 | 3 tomato + 1 sugar | 45 min | 1 | 395 | 685 | 1.73 | 36 | T3 |
| `strawberry_jam` | Strawberry Jam | 11 | 3 strawberry + 1 sugar | 1 h | 1 | 524 | 889 | 1.70 | 46 | T3 |
| `cherry_jam` | Cherry Jam | 11 | 3 cherry + 1 sugar | 1 h | 1 | 896 | 1,261 | 1.41 | 46 | T3 |
| `raspberry_jam` | Raspberry Jam | 12 | 3 raspberry + 1 sugar | 1 h 10 min | 1 | 710 | 1,128 | 1.59 | 52 | T3 |
| `sauerkraut` | Sauerkraut | 12 | 2 cabbage + 1 carrot | 4 h | 1 | 1,268 | 2,389 | 1.88 | 140 | T3 |
| `orange_marmalade` | Orange Marmalade | 13 | 3 orange + 1 sugar | 1 h 15 min | 1 | 878 | 1,326 | 1.51 | 56 | T3 |
| `rose_jelly` | Rose Petal Jelly | 13 | 3 rose + 1 sugar | 1 h 30 min | 1 | 806 | 1,324 | 1.64 | 65 | T3 |
| `grenadine` | Grenadine Syrup | 14 | 2 pomegranate + 1 sugar | 50 min | 1 | 838 | 1,166 | 1.39 | 41 | T3 |
| `blueberry_jam` | Blueberry Jam | 14 | 3 blueberry + 1 sugar | 1 h | 1 | 764 | 1,143 | 1.50 | 47 | T3 |
| `peach_jam` | Peach Jam | 17 | 3 peach + 1 sugar | 1 h | 1 | 887 | 1,281 | 1.44 | 49 | T3 |
| `plum_jam` | Plum Jam | 23 | 3 plum + 1 sugar | 1 h | 1 | 1,049 | 1,471 | 1.40 | 53 | T3 |
| `pickled_peppers` | Pickled Peppers | 31 | 3 pepper + 1 onion | 2 h | 1 | 917 | 1,718 | 1.87 | 100 | T3 |
| `fig_jam` | Fig Jam | 39 | 3 fig + 1 sugar | 1 h | 1 | 1,307 | 1,805 | 1.38 | 62 | T3 |

#### Weaver's Shed (`weaver`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `yarn` | Yarn | 12 | 1 wool | 30 min | 1 | 285 | 497 | 1.74 | 27 | T2 |
| `angora_yarn` | Angora Yarn | 14 | 1 angora_wool | 35 min | 1 | 201 | 447 | 2.22 | 31 | T2 |
| `cotton_cloth` | Cotton Cloth | 16 | 2 cotton | 45 min | 1 | 896 | 1,205 | 1.34 | 39 | T2 |
| `lavender_dye` | Lavender Dye | 18 | 2 lavender | 30 min | 1 | 446 | 675 | 1.51 | 29 | T2 |
| `alpaca_yarn` | Alpaca Yarn | 33 | 1 alpaca_fiber | 40 min | 1 | 318 | 658 | 2.07 | 43 | T2 |

#### Sewing Table (`sewing`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `scarf` | Wool Scarf | 14 | 2 yarn | 1 h | 1 | 994 | 1,373 | 1.38 | 47 | T3 |
| `angora_mittens` | Angora Mittens | 14 | 2 angora_yarn | 1 h 15 min | 1 | 894 | 1,348 | 1.51 | 57 | T3 |
| `cotton_tote` | Cotton Tote | 16 | 2 cotton_cloth | 1 h | 1 | 2,410 | 2,799 | 1.16 | 49 | T3 |
| `wool_pillow` | Wool Pillow | 16 | 2 wool + 1 cotton_cloth | 1 h 30 min | 1 | 1,775 | 2,313 | 1.30 | 67 | T3 |
| `bunny_slippers` | Bunny Slippers | 16 | 2 angora_wool + 1 cotton_cloth | 1 h 40 min | 1 | 1,607 | 2,192 | 1.36 | 73 | T3 |
| `picnic_blanket` | Picnic Blanket | 17 | 2 cotton_cloth + 1 yarn | 2 h 30 min | 1 | 2,907 | 3,726 | 1.28 | 102 | T3 |
| `sweater` | Sweater | 18 | 2 yarn + 1 lavender_dye | 2 h | 1 | 1,669 | 2,363 | 1.42 | 87 | T3 |
| `quilt` | Quilt | 20 | 3 cotton_cloth + 2 yarn + 1 lavender_dye | 4 h | 1 | 5,284 | 6,521 | 1.23 | 155 | T4 |
| `alpaca_plush` | Alpaca Plush | 33 | 2 alpaca_fiber + 1 cotton_cloth | 1 h 30 min | 1 | 1,841 | 2,491 | 1.35 | 81 | T3 |
| `alpaca_shawl` | Alpaca Shawl | 33 | 2 alpaca_yarn + 1 lavender_dye | 3 h | 1 | 1,991 | 3,123 | 1.57 | 142 | T4 |

#### Pie Oven (`pie_oven`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `apple_pie` | Apple Pie | 15 | 1 flour + 3 apple + 1 butter | 2 h | 1 | 1,022 | 1,691 | 1.65 | 84 | T3 |
| `cherry_pie` | Cherry Pie | 15 | 1 flour + 3 cherry + 1 sugar | 2 h | 1 | 947 | 1,616 | 1.71 | 84 | T3 |
| `pumpkin_pie` | Pumpkin Pie | 15 | 1 flour + 2 pumpkin + 1 cream + 1 egg | 2 h 30 min | 1 | 1,309 | 2,109 | 1.61 | 100 | T3 |
| `lemon_cake` | Lemon Cake | 15 | 1 flour + 2 lemon + 1 butter + 1 sugar | 3 h | 1 | 1,218 | 2,143 | 1.76 | 116 | T3 |
| `blueberry_pie` | Blueberry Pie | 16 | 1 flour + 3 blueberry + 1 butter | 2 h | 1 | 1,046 | 1,723 | 1.65 | 85 | T3 |
| `coffee_cake` | Coffee Cake | 16 | 1 flour + 2 coffee + 1 egg + 1 sugar | 2 h 40 min | 1 | 825 | 1,677 | 2.03 | 107 | T3 |
| `peach_cobbler` | Peach Cobbler | 17 | 1 flour + 3 peach + 1 butter | 2 h | 1 | 1,169 | 1,854 | 1.59 | 86 | T3 |
| `pear_tart` | Pear Tart | 19 | 1 flour + 2 pear + 1 butter | 2 h | 1 | 1,032 | 1,734 | 1.68 | 88 | T3 |
| `lemon_meringue_pie` | Lemon Meringue Pie | 19 | 1 flour + 2 lemon + 2 duck_egg + 1 sugar | 2 h 30 min | 1 | 1,079 | 1,918 | 1.78 | 105 | T3 |
| `plum_cake` | Plum Cake | 23 | 1 flour + 3 plum + 1 egg + 1 sugar | 2 h 30 min | 1 | 1,182 | 2,061 | 1.74 | 110 | T3 |
| `walnut_honey_cake` | Walnut Honey Cake | 26 | 1 flour + 2 walnut + 1 honey + 1 egg | 4 h | 1 | 1,057 | 2,380 | 2.25 | 165 | T3 |
| `chocolate_cake` | Chocolate Cake | 36 | 1 flour + 1 chocolate + 2 egg + 1 butter | 3 h | 1 | 2,316 | 3,482 | 1.50 | 146 | T3 |
| `fig_tart` | Fig & Goat Cheese Tart | 39 | 1 flour + 3 fig + 1 goat_cheese | 2 h 30 min | 1 | 2,175 | 3,212 | 1.48 | 130 | T3 |

#### Juice Press (`juice_press`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `carrot_juice` | Carrot Juice | 6 | 4 carrot | 20 min | 1 | 16 | 158 | 9.88 | 18 | T3 |
| `apple_juice` | Apple Juice | 6 | 3 apple | 30 min | 1 | 486 | 682 | 1.40 | 25 | T3 |
| `orange_juice` | Orange Juice | 13 | 3 orange | 30 min | 1 | 624 | 839 | 1.34 | 27 | T3 |
| `pomegranate_juice` | Pomegranate Juice | 14 | 3 pomegranate | 35 min | 1 | 876 | 1,122 | 1.28 | 31 | T3 |
| `lemonade` | Lemonade | 15 | 2 lemon + 1 sugar | 30 min | 1 | 682 | 903 | 1.32 | 28 | T3 |
| `pear_nectar` | Pear Nectar | 19 | 3 pear | 30 min | 1 | 744 | 976 | 1.31 | 29 | T3 |
| `watermelon_juice` | Watermelon Juice | 27 | 2 watermelon | 30 min | 1 | 1,258 | 1,511 | 1.20 | 32 | T3 |

#### Chandlery (`chandlery`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `beeswax` | Beeswax | 16 | 1 honey | 30 min | 1 | 342 | 565 | 1.65 | 28 | T2 |
| `honey_candle` | Honey Candle | 16 | 2 beeswax | 45 min | 1 | 1,130 | 1,439 | 1.27 | 39 | T3 |
| `rose_candle` | Rose Candle | 16 | 1 beeswax + 2 rose | 50 min | 1 | 933 | 1,269 | 1.36 | 42 | T3 |
| `lavender_candle` | Lavender Candle | 18 | 1 beeswax + 1 lavender | 1 h | 1 | 788 | 1,186 | 1.51 | 50 | T3 |
| `lavender_soap` | Lavender Soap | 22 | 2 lavender + 1 goat_milk | 1 h | 1 | 693 | 1,110 | 1.60 | 52 | T3 |

#### Packing Table (`packing`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `breakfast_hamper` | Breakfast Hamper | 20 | 1 wooden_crate + 1 pancakes + 1 strawberry_jam + 1 orange_juice | 1 h 30 min | 1 | 2,652 | 3,216 | 1.21 | 71 | T4 |
| `picnic_basket` | Picnic Basket | 23 | 1 wooden_crate + 1 bread + 1 cheese + 1 lemonade + 1 picnic_blanket | 3 h | 1 | 5,877 | 6,894 | 1.17 | 127 | T4 |
| `spa_basket` | Spa Basket | 26 | 1 wooden_crate + 1 lavender_soap + 1 lavender_candle + 1 cotton_tote | 3 h | 1 | 5,461 | 6,512 | 1.19 | 131 | T4 |
| `cozy_winter_gift` | Cozy Winter Gift | 28 | 1 wooden_crate + 1 sweater + 1 honey_candle + 2 cookies | 3 h | 1 | 5,514 | 6,588 | 1.19 | 134 | T4 |
| `harvest_hamper` | Harvest Festival Hamper | 32 | 1 wooden_crate + 1 pumpkin_pie + 1 truffle_oil + 1 lavender_candle + 1 walnut_honey_cake | 4 h 30 min | 1 | 9,289 | 10,838 | 1.17 | 194 | T4 |
| `gourmet_hamper` | Gourmet Hamper | 37 | 1 wooden_crate + 1 chocolate_cake + 1 goat_cheese + 1 maple_fudge + 1 olive_bread | 4 h | 1 | 8,150 | 9,632 | 1.18 | 185 | T4 |

#### Oil Press (`oil_press`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `sunflower_oil` | Sunflower Oil | 30 | 3 sunflower | 1 h | 1 | 1,005 | 1,461 | 1.45 | 57 | T2 |
| `olive_oil` | Olive Oil | 30 | 4 olive | 1 h 30 min | 1 | 1,216 | 1,846 | 1.52 | 79 | T2 |
| `truffle_oil` | Truffle Oil | 32 | 1 truffle + 1 olive_oil | 3 h | 1 | 2,128 | 3,248 | 1.53 | 140 | T4 |

#### Sugar Shack (`sugar_shack`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `maple_syrup` | Maple Syrup | 34 | 2 maple_sap | 1 h | 1 | 584 | 1,059 | 1.81 | 59 | T2 |

#### Chocolatier (`chocolatier`)

| Id | Recipe | Lvl | Inputs | Time | Out | Input value | Sell/unit | × inputs | XP | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| `chocolate` | Chocolate | 36 | 2 cocoa + 1 sugar + 1 milk | 1 h | 1 | 1,132 | 1,616 | 1.43 | 61 | T2 |
| `chocolate_truffles` | Chocolate Truffles | 37 | 1 chocolate + 1 cream | 45 min | 1 | 1,902 | 2,290 | 1.20 | 49 | T3 |

### 3.6 Storage: Barn and overflow

| Upgrade | From lvl | Capacity after | Coins | Planks | Crates |
|---|---|---|---|---|---|
| Start | 1 | 200 | 0 | 0 | 0 |
| 1 | 6 | 320 | 3,600 | 2 | 0 |
| 2 | 9 | 440 | 8,300 | 3 | 0 |
| 3 | 12 | 560 | 16,000 | 4 | 1 |
| 4 | 15 | 680 | 32,000 | 5 | 1 |
| 5 | 18 | 800 | 50,000 | 6 | 1 |
| 6 | 21 | 920 | 78,000 | 7 | 1 |
| 7 | 24 | 1,040 | 120,000 | 8 | 2 |
| 8 | 27 | 1,160 | 160,000 | 9 | 2 |
| 9 | 30 | 1,280 | 200,000 | 10 | 2 |
| 10 | 33 | 1,400 | 260,000 | 11 | 2 |

- **One Barn for everything** (crops, fruit, animal goods, feed, compost, crafted goods, materials). One shared count
  is the clearest rule for two people; Hay Day's silo/barn split adds friction without adding decisions.
- **v2**: each upgrade adds **120** (was 100): plots now grow with land (+6 per expansion), so the Barn grows faster.
  Upgrades cost coins plus a few Planks and Crates (§3.9 rule).
- **Capacity is a soft cap.** Intake (harvest, collect, craft collect, gifts, rewards) always succeeds while the
  stock is below **2 × capacity**: items above capacity sit in the **Overflow pile** (visible crates stacked at the
  Barn door, orange Barn pill). Overflow items can be sold, used, delivered and fed like any other; consumption takes
  from overflow first, so it drains naturally.
- **At 2 × capacity** intake pauses safely: produce stays ripe on the plot, products wait on the animals, goods wait in
  trays. Nothing is destroyed. A banner offers "Sell surplus" (sells the 20 lowest-value stacks above 10 units, with a
  preview and a **10-minute undo**: either player buys the whole sale back at the same prices, the goods return and
  the coins stop counting as earned; a surplus sale is no "sell" deed, so a sell-and-undo loop never finishes a story
  card; wave-1 QA RC-25) and "Upgrade Barn". While in overflow the General Store refuses **item** purchases only
  (emergency feed, Golden Seeds: `STORAGE_FULL`); buildings, decor and land stay buyable (ruling X7d).
- Simulated: overflow 1–4 % of play time; intake paused for at most 8 units in ~150 hours of play (Appendix E).

### 3.7 Tools and boosts

| Tool / boost | From | What it does | Source / cost |
|---|---|---|---|
| Hand (smart) | L1 | Context action: harvest ripe, plant this player's chosen seed on empty, water growing, tend animals, collect trays, clear weeds, pet (drag pets all), uproot (Shift) | — |
| Seed Bag | L1 | Plant the selected crop; drag paints plots | seeds paid per plot |
| Sickle | L1 | Harvest; drag paints | — |
| Feed Scoop | L1 | Tend animals; drag paints a pen | uses feed |
| Axe | L1 | Chop stumps, logs, boulders, giant crops, Pine | — |
| Hammer | L1 | Build mode: place, move (keeps timers, 10-minute "move back"), rotate, store | — |
| Watering Can | L4 | Water (crops ≥ 30 min, trees); drag paints | free |
| Basket | L4 | Harvest trees, collect building trays; drag | — |
| Compost Scoop | L8 | Fertilize plots/trees; drag paints | uses Compost |
| Big Watering Can | L10 | Water brush 3×3 | 4,000 coins |
| Wide Sickle | L12 | Harvest brush 2×2 | 6,000 coins |
| Seed Spreader | L14 | Plant brush 2×2 | 9,000 coins |
| Grand Sickle | L26 | Harvest brush 3×3 | 20,000 coins |
| Sprinkler (decor) | L10 | Waters every crop planted within 2 tiles (5×5) at planting | decor table |
| Compost | L8 | +1 unit, blue-ribbon chance (§3.1) | Compost Bin; Manure route L25 |
| Golden Seed Packet | L8 | 5 golden seeds: a plot planted with one is guaranteed blue-ribbon | 12 Acorns |
| Seed packet | L10 | 5 free plantings of one crop | pet finds, daily gift, quests |
| Hurry | L5 | Finish one timer now (plot, tree, animal, the running item of one queue) | ceil(remaining min / 60) Acorns, max 8 |
| Golden Hour | L4 | 30 min: everything **started** during it takes 10 % less time | two-seat bench together, once per together session (§6.2) |
| Baby Bottle | L7 | −30 % remaining baby time (partner bottle −20 % more) | Dairy |

Tools are farm-wide (both players get them); brush upgrades are purchases in the Market's Tools tab (their prices are
deliberately small: they buy comfort, not income). The tool tray shows only unlocked tools; 1–9 select tray slots.

### 3.8 Decorations

| Id | Decoration | Lvl | Cost | Beauty | Size | Effect |
|---|---|---|---|---|---|---|
| `flower_bed` | Flower Bed | 1 | 160 | 4 | 1×1 | Counts as bee forage |
| `picket_fence` | Picket Fence (per tile) | 1 | 40 | 1 | 1×1 | Auto-joins; pens and gardens |
| `dirt_path` | Dirt Path (per tile) | 1 | 20 | 0.5 | 1×1 | Beauty path bonus: +10 % beauty to decor touching a path |
| `sunset_bench` | Sunset Bench | 4 | 270 | 6 | 2×1 | Golden Hour seat (§6.2) |
| `scarecrow` | Scarecrow | 3 | 350 | 8 | 1×1 | Crops within 3 tiles: +5 % chance of +1 unit (does not stack) |
| `hay_bales` | Hay Bale Stack | 5 | 230 | 5 | 1×1 | — |
| `wind_chime` | Porch Wind Chime | 6 | 290 | 6 | 1×1 | Chimes on hover (pure juice) |
| `wheelbarrow` | Flower Wheelbarrow | 7 | 500 | 10 | 1×1 | Counts as bee forage |
| `bird_bath` | Bird Bath | 8 | 610 | 12 | 1×1 | Trees within 3 tiles: +5 % chance of +1 fruit (does not stack) |
| `lantern` | Garden Lantern | 9 | 530 | 10 | 1×1 | Glows at night |
| `sprinkler` | Sprinkler | 10 | 220 | 4 | 1×1 | Waters every crop within 2 tiles at the moment it is planted |
| `dog_house` | Dog House | 10 | 650 | 12 | 2×2 | Home of the farm dog (pets, §3.4) |
| `cat_basket` | Cat Basket | 10 | 540 | 10 | 1×1 | Home of the farm cat |
| `rose_arch` | Rose Arch | 12 | 1,000 | 18 | 2×1 | Counts as bee forage; walkway |
| `stone_well` | Wishing Well | 14 | 1,200 | 20 | 2×2 | — |
| `windmill_toy` | Garden Windmill | 15 | 1,000 | 16 | 1×1 | Spins with the wind uniform |
| `beehive_skep` | Straw Skep | 16 | 900 | 14 | 1×1 | Counts as bee forage |
| `bench_swing` | Porch Swing | 18 | 1,600 | 24 | 2×1 | Two-seat: also a Sunset Bench |
| `fountain` | Stone Fountain | 20 | 2,800 | 40 | 2×2 | — |
| `topiary` | Topiary Bush | 22 | 1,600 | 22 | 1×1 | — |
| `greenhouse_frame` | Cold Frame | 24 | 1,500 | 20 | 2×1 | Crops within 2 tiles count as in-season (§3.1) |
| `gazebo` | Garden Gazebo | 26 | 4,800 | 60 | 3×3 | Two-seat: also a Sunset Bench |
| `pond_dock` | Fishing Dock | 28 | 2,500 | 30 | 2×2 | Collection spot: Pond Treasures |
| `statue_cow` | Cow Statue | 32 | 4,500 | 50 | 2×2 | — |
| `hot_air_balloon` | Hot-air Balloon Mooring | 38 | 8,900 | 90 | 3×3 | Photo-mode backdrop |
| `golden_scarecrow` | Golden Scarecrow | 10 | 25 Acorns | 30 | — | As Scarecrow, radius 4 |
| `heart_arbor` | Sweetheart Arbor | 8 | 30 Acorns | 35 | — | Two-seat Sunset Bench; +1 Heart each per Golden Hour |
| `cherry_blossom` | Cherry Blossom Tree | 12 | 30 Acorns | 40 | — | Bee forage x2; petals drift |
| `star_lanterns` | String of Star Lanterns | 15 | 15 Acorns | 25 | — | Night glow over a 3-tile line |
| `grandma_rocker` | Grandma's Rocking Chair | 20 | 20 Acorns | 30 | — | Story decor; plays a memory line |
| `golden_cow_statue` | Golden Cow Statue | 30 | 60 Acorns | 80 | — | Showcase piece |

| Id | Grand decor | Lvl | Cost | Beauty | Size | Effect |
|---|---|---|---|---|---|---|
| `grand_windmill` | Old Dutch Windmill | 20 | 60,000 | 80 | 3×3 | Sails turn with the wind |
| `flower_maze` | Flower Maze | 23 | 120,000 | 100 | 4×4 | Bee forage x3; the avatars can walk it |
| `koi_pond` | Koi Pond | 26 | 180,000 | 120 | 3×3 | Two-seat bench at the edge (Golden Hour seat) |
| `carousel` | Carousel | 29 | 290,000 | 150 | 4×4 | Turns at night with lights; Memory Book backdrop |
| `treehouse` | Treehouse | 31 | 410,000 | 170 | 3×3 | Two-seat lookout (Golden Hour seat) |
| `clock_tower` | Clock Tower | 33 | 550,000 | 190 | 2×2 | Chimes the hour |
| `orangery` | Glass Orangery | 35 | 700,000 | 210 | 4×3 | Lit from inside at night |
| `arbor_of_lights` | Great Arbor of Lights | 37 | 870,000 | 230 | 3×2 | Two-seat; fireflies all night |
| `bath_house` | Hot-Spring Bath House | 39 | 1,100,000 | 250 | 4×4 | Steam and lanterns; two seats |
| `golden_gate` | Golden Farm Gate | 40 | 1,300,000 | 300 | 3×1 | Shows the farm name in gold leaf |

- **Beauty** feeds the Farm Beauty rating (§5.9): the 2nd copy of a decor counts 50 %, the 3rd and later 25 %.
  Decor touching a path tile gets +10 % beauty. Buildings give 3 beauty each, trees 2.
- **Effects never stack** with themselves: a plot inside two Scarecrows' radius gets +5 %, not +10 %.
- **Decor gives no XP** (v2, X1/C2). Buying decor used to pay 1 XP per 40 coins; combined with a 100 % refund it was an
  infinite XP pump, and even without the refund it bought XP 2.5 × cheaper than farming. Decorating now progresses
  Farm Beauty (stars pay Acorns and order coins), decor sets and the Showcase ribbons instead.
- **Refunds**: 100 % inside the 10-minute undo window or if never placed; 50 % after placement. With no XP attached, no
  buy / place / store / sell sequence returns more than it cost (R12). **Any use ends the undo** (wave-2 QA RC-08): an
  object whose effect was used — a Scarecrow's or Bird Bath's chance at a harvest, a Sprinkler or Cold Frame at a
  planting, a hive's pollination or forage, a horse pulling a barge crate, a bench's Golden Hour, a grove's fourth
  tree — is no longer a 100 % refund; and an animal counts toward species ribbons only once its home is settled.
- **Decor sets** (A2, L18): themed 4–6-piece sets (Cottage Garden, Harvest Fair, Seaside, Winter Lights, Carousel at
  L29) whose completion within 6 tiles of each other gives +25 % beauty to the set, a cosmetic effect (butterflies,
  lanterns, bunting) and a ribbon. Cosmetic and beauty only, never production. Every piece can be had on demand
  (store decor or a story-quest reward, never only a seasonal gift), a piece belongs to one set only, and the M1b sets
  are completable by L25 (wave 2): Cottage Garden = Flower Bed, Picket Fence, Rose Arch, Bird Bath, Flower Wheelbarrow;
  Harvest Fair = Scarecrow, Hay Bale Stack, Porch Wind Chime, Garden Windmill, Straw Skep; Winter Lights = Garden
  Lantern, String of Star Lanterns, Topiary Bush, Porch Swing.
- **Masterwork** (v2, H4, L18): every coin decor can be upgraded twice, for **4 ×** and **16 ×** its price, to
  **1.5 × / 2.0 ×** beauty with a visual upgrade (stone instead of wood, gilded trim). An open-ended sink for a couple
  who love decorating.
- **Grand decor** (v2, H4): the ten showcase pieces above, priced in hours of income at their level (0.5–4 h of E).
- Acorn decor is the luxury tier (rare currency, §4.1). It is cosmetic plus the listed small effect.
- Achievement trophies, Mastery Signs, Fair ribbons, collection display pieces and Town Project souvenirs are free
  decor earned in play.

### 3.9 Land expansions (15)

| # | Id | Expansion | Lvl | Coins | Planks | Crates | Proof task | Reveals |
|---|---|---|---|---|---|---|---|---|
| 1 | `creekside` | Creekside Meadow | 5 | 7,400 | 0 | 0 | Harvest 30 Wheat and collect 10 Eggs | creek bank with reeds, 3 log debris (Wood), a wild Pine (free, mature) |
| 2 | `old_orchard` | Old Orchard | 7 | 15,000 | 2 | 0 | Own 2 Apple Trees and press 3 Apple Juice | 2 wild Apple Trees (free, mature), 4 stumps (Wood) |
| 3 | `cow_hill` | Cow Hill | 9 | 29,000 | 3 | 1 | Collect 10 Milk and churn 3 Butter | gentle hill with a dry-stone wall, wildflower patch (bee forage) |
| 4 | `sunflower_rise` | Sunflower Rise | 11 | 45,000 | 4 | 1 | Make 3 Strawberry Jam | old fence line, scarecrow (free decor), Grandma's seed box (collection item) |
| 5 | `bee_glade` | Bee Glade | 13 | 83,000 | 5 | 1 | Spin 4 Yarn and own 1 Sheep Pasture | clover glade (bee forage x2), wild hive (1 free Bee Colony) |
| 6 | `fair_lane` | Fairground Lane | 15 | 130,000 | 6 | 1 | Bake 2 Apple Pies and fill 10 orders | road to the County Fair grounds, ribbon shelf |
| 7 | `riverbank` | Riverbank | 17 | 180,000 | 7 | 1 | Make 3 Cotton Tote or Wool Pillow | River Barge jetty upgrade (row bonuses +25 %), willow trees |
| 8 | `pig_woods` | Pig Woods | 19 | 240,000 | 8 | 1 | Dig up 5 Truffles | oak edge, 2 truffle spots (pigs here dig +10 % faster) |
| 9 | `willow_pond` | Willow Pond | 21 | 310,000 | 9 | 2 | Collect 8 Duck Eggs | large pond with dock, fishing-spot decor, lily pads |
| 10 | `goat_rocks` | Goat Rocks | 24 | 440,000 | 10 | 2 | Make 3 Goat Cheese | rocky outcrop goats climb (idle animation), stone bench |
| 11 | `stable_paddock` | Stable Paddock | 27 | 560,000 | 11 | 2 | Pack 2 Picnic Baskets | riding track, horse-show ring for the Fair |
| 12 | `walnut_grove` | Walnut Grove | 30 | 660,000 | 12 | 2 | Harvest 30 Walnuts | old walnut trees (2 free), picnic clearing |
| 13 | `olive_terrace` | Olive Terrace | 33 | 800,000 | 13 | 2 | Press 4 Olive Oil | terraced slope, stone steps |
| 14 | `maple_ridge` | Maple Ridge | 36 | 950,000 | 14 | 2 | Boil 3 Maple Syrup | red-maple ridge with autumn colours all year, lookout |
| 15 | `sunset_hill` | Sunset Hill | 39 | 1,200,000 | 15 | 3 | Pack 2 Gourmet Hampers | the hilltop gazebo overlooking the farm (Golden Hour +10 min there) |

- Requirements: farm level, coins, Planks and Wooden Crates (from expansion 2), the **proof task** (counted from when
  the expansion card is first opened, either partner), and adjacency (guaranteed by the order).
- Prices are E(level) × (0.6 + 0.2 k) hours (k = expansion number), 0.8–3.6 hours of income at the gate: the simulated
  reference couple buys each one 4–6 evenings after it unlocks, while also building and stocking — a real saving goal.
  **Each expansion raises the plot cap by 6** and arrives with 15 debris pieces (§2.3) and one named feature.
- **Materials** (v2, H5 + X6): Planks are made 1 Wood → 2 Planks in **10 min**, Crates 2 Planks → 1 in **20 min**, and
  the plank/crate costs of expansions and barn upgrades were halved. In all, 15 expansions and 10 barn upgrades need
  about 125 Wood and 32 Sawmill-hours over the whole game, so materials pace nothing; coins and levels do (R14:
  simulated, coins are ready while Planks or Crates are missing in at most 2 % of play). **Wood is building stock**: it
  has a default **Keep 20** (§6.3, so the starter wood is not sold by accident), orders, the barge and projects never ask
  for it, and a Sawmill that has a backlog shows a "needs a slot" hint.
- Purchase is instant and celebrated (fence posts pop outward, the meadow colour floods in, both screens).

### 3.10 Plots

| Plot # | 17 | 20 | 30 | 40 | 60 | 80 | 100 | 120 | 140 | 164 |
|---|---|---|---|---|---|---|---|---|---|---|
| Price | 25 | 30 | 45 | 65 | 140 | 310 | 670 | 1,500 | 3,200 | 8,300 |

- **Plot cap** (v2, G2) = `16 + floor(1.5 × (level − 1)) + 6 × expansions owned`: 16 at L1, 28 at L5 with the first
  expansion, 92 at L20, **164 at L40** with all 15 expansions. Land is production again and late fields look like FV2.
- The 16 starter plots are free; each further plot costs the price above (`25 × 1.04^(n − 16)`, rounded).
- Plots can be moved (empty or growing; timers kept; 10-minute "move back") and removed (empty only; refund 50 %).

---

## 4. Economy

### 4.1 Currencies

| Currency | Scope | Earned by | Spent on | Notes |
|---|---|---|---|---|
| **Coins** | shared Farm Treasury | Market sales, orders, townsfolk requests, barge crates, Fair medals, quests, level-ups, debris, Almanac, daily gift, Mabel's weekly meter | seeds, plots, trees, animals, homes, buildings, slots, tools, decor, Masterwork, Grand decor, expansions, barn upgrades, Town Projects | No cap. A Wishlist (§6.3) sets coins aside. Every movement is in the ledger. |
| **Acorns** (rare) | shared | level-ups (2; 5 at every 5th level), achievements (F/T: 1 / 3 / 8), collection sets (5), mastery ★3 (1) and Gold (3), daily-gift days 7/14/21 (2) and 28 (5), Couple Challenge (3), golden orders (1), barge rows (1 + a third of the chest), Fair Silver/Gold (2/4), Mabel's weekly meter (1/2/3), Town Projects (5), quests A11, B4, B9, E8, E10, F3 | Acorn decor (15–60), Golden Seed Packet (12), Hurry (1 per started hour remaining, max 8), instant order refill (1) | Never bought with money (there is no money). Spending ≥ 10 Acorns in one purchase, or ≥ 10 by one player in one day, is BIG_SPEND (§6.3). Simulated: about 55–60 a month for the reference couple; 470–700 by L40 depending on the schedule. |
| **Hearts** | personal | helping the partner (§6.2), Together tasks, personal (P) achievements, thanks from the partner (≤ 10 a day), Golden Hour, keepsake gifts | wardrobe, outfit dyes, emotes, name-card frames, matching couple outfits (§4.11) | Cannot buy anything that produces. Nothing to argue about. |
| **Friendship** | shared, per townsperson | golden orders (+1), townsfolk requests (+1), chain quests (+2), one liked-item gift per townsperson per day (+1) | — (every 2 points unlock a decor gift or recipe-card variant) | v2 rename: was "friendship hearts", which clashed with Hearts. |
| **Farm XP** | shared | every productive action (§4.5) | — | Farm Level = f(Farm XP); gates all content. |
| **Personal XP** | personal | the actor's share of every action | — | Personal Level: titles (M1), perk points (M2). |
| Fair Points | shared, weekly | blue-ribbon harvests, blue-ribbon goods, Fair entries | medal tiers | Reset every Monday 00:00. |
| Festival Tickets | shared, per festival | festival orders and recipes | festival prize ladder | Unspent tickets convert to coins at the end. |
| Ribbon Points | shared | achievement tiers (1 / 2 / 5) | Ribbon Wall tiers (cosmetic) | Never spent; a score. |

There is no energy, no water meter, no crafting power, no premium currency and no real-money anything.

### 4.2 Faucets and sinks

Shares measured by the simulator for the reference couple over the whole game (Appendix E):

| Faucets (coins in) | Share | Sinks (coins out) | Character |
|---|---|---|---|
| Market sales of raw and crafted goods | 20 % | Seeds (40 % of every crop's gross) | running cost, scales with play |
| Quests (story chains, one-off) | 18 % | Plots, trees, animals (escalating per extra), homes | capital, one-off, escalating |
| Orders (1.5 × V) | 18 % | Buildings, slots, second copies, tools | capital, level-gated |
| Townsfolk board (1.5 × V) | 10 % | Expansions (0.8–3.6 h of income each), barn upgrades | big saving goals |
| Almanac | 8 % | **Town Projects** (10 h of income + goods each, from L20): 13 by L40, ~60 % of all coins spent | the late-game sink: the village grows |
| River Barge (1.6 × V) | 8 % | **Grand decor** (0.5–4 h each), **Masterwork** decor (4 × / 16 ×) | luxury sinks |
| County Fair medals | 7 % | Decor (coins → beauty, no XP) | open-ended, cheap |
| Mabel's weekly meter | 6 % | Fair entries, Restoration bundles, Town Project goods, keepsake gifts | goods sinks |
| Mastery, daily gift, level-ups, debris | 5 % | | |

Design intent: at every level the couple can afford the level's new unlock quickly (the level-up coins plus up to an
evening of play), the next expansion is a saving goal of a few evenings, and from L20 a Town Project always waits to
absorb surplus coins and goods. Check (Appendix E): from L20 the treasury holds more than 15 hours of income in at most
1 % of play time for any schedule.

### 4.3 Price formulas (the one model)

All constants live in `tools/economy-model.mjs` §1 and will move to `shared/content/config.js`.

**Crops.** For grow time *m* minutes and unlock level *L*:

```
gross(m, L) = R · m                               for m ≤ 60      R = 4.33 coins per minute    (v2: was 8 · m^0.85)
            = R · 60 · (m / 60)^0.45              for m > 60
            × (1 + 0.015 · (L − 1))                               newer crops +1.5 % per level
sell (V)    = round(gross / yield)
seed        = max(2, round(0.4 · V · yield))                       seed = 40 % of the plot's gross
xp          = max(1, round(V · yield / 8))
```

Why this shape: up to an hour, value is proportional to time, so a session crop's worth is its plot-time and each newer
session crop is a small upgrade (v1's attention premium made Wheat the best crop forever: a grinder planted 91 %
Wheat). Beyond an hour value grows with hours^0.45: an 8-hour crop pays 2.55 × a 1-hour crop per planting but 0.32 × per
hour. In a session, short crops win; for the days away, long crops win. Neither dominates (R18), and both are always
worth planting.

**Trees.** `harvest value = 1.6 · gross(cycle, L)`, `V = round(harvest / yield)`; price of the first tree of a species =
6 harvests; the n-th × 1.45^(n−1); at most 4 + floor(L / 10) per species (max 8).

**Feed.** `V = (Σ cheapest-class input values + 4 · √minutes) / outQty` — no markup; feed is upkeep. outQty = 6.

**Animal products.** `V = (feed value per cycle + 18 · √cycleMinutes) / outQty` (v2: 18, was 12, so long-cycle animals
earn their housing). Baby price = 10 collections of net value (`V·out − feed`), adult = 1.6 × baby, n-th of a species ×
1.1^(n−1). Blue-ribbon goods = 4 × V.

**Crafted goods** (v2, M3 taken further):

```
V(output) = ( Σ V(inputs) + 12 · minutes^0.8 · (1 + 0.015 · (L − 1)) ) / outQty
xp        = round((V·out − Σ V(inputs)) / 8)  (+25 % for duets)
```

A good is worth its inputs plus the value of the machine time; there is no tier markup. Consequences, all checked by
the model:

- **No dominated recipe** (R18): inside a building, for recipes unlocked at the same level or earlier, a shorter recipe
  earns more per hour and a longer recipe more per craft. v1 had 49 dominated recipes (the critique's fix still 43);
  v2 has 0.
- **R3**: every recipe adds ≥ 15 % to its inputs; recipes with expensive inputs are long (the six hampers 1.5–4.5 h,
  Watermelon Salad and Potato Chips 45 min). Lowest: Maple Pancakes 1.21 ×.
- Per building-hour the spread between a building's best and worst recipe is 1.1–1.8 × (v1: up to 8 ×); the Packing
  Table is no longer a 13,000-coins-an-hour money printer.

**Buildings, homes, expansions, barn, quests.** Priced in hours of E at their gate level: buildings 0.25–0.9 h (Feed Mill
and Windmill free), slot k = 0.25 h × 1.6^(k−1), homes 0.35 h (capacity upgrade 0.2 h), expansions (0.6 + 0.2 k) h,
barn upgrade n = 0.3 h × 1.15^(n−1) at its gate, quest coins = E(L) × quest minutes / 60 × 0.5 and quest XP = coins / 8,
Town Project n = E × (10 + 0.5 (n − 1)) h, Grand decor 0.5–4 h. Everything new is affordable within an evening or a few
of its arrival.

**Selling and buying.**

| Channel | Pays / costs | Rule |
|---|---|---|
| Market Stand | V × (1 + 5 % per mastery ★1) × (1.10 if in season) × (1.5 for the Demand item, first 50 units a day) | instant, any quantity, partial stacks |
| Orders | 1.5 × Σ V (coins + XP split); duet golden orders 2.0 × V; gourmet orders 1.7 × V | §5.2 |
| Townsfolk board | 1.5 × Σ V (80 % coins, 20 % XP) + 1 Friendship | §5.3 |
| River Barge | 1.6 × V per crate in coins + 20 % of that as XP/8; +5 % per adult horse (max +20 %) | §5.7 |
| County Fair | a medal pays 1.5 × the value of its point threshold (a point = 100 coins of goods) | §5.6 |
| General Store | seeds, saplings, animals, buildings, decor, tools; emergency feed at 2.5 × V | **never sells anything the Market buys** (no arbitrage) |
| Selling objects | animals 50 % of the price paid (100 % if blue-ribbon), decor 50 % (100 % within the undo window or never placed), plots 50 % | destructive: double confirm + 10-minute restore |
| Consumables | feed, Compost, Baby Bottles: not sellable, not orderable | no utility item becomes a cash crop |

### 4.4 Income per level (E) and its calibration

*E(L)* is the value the **reference couple** turns into coins (market, orders, townsfolk, barge) per hour of play at
farm level L — measured, not guessed. It is computed in two steps:

1. A hand model from the content (§4.3): plots × the average session-crop rate at 45 % utilisation, one away cycle on
   60 % of the plots, animals at 70 % collection, ~2 trees per species, one running slot per building at 60 %, × 1.2
   for orders. The plot cap counts the expansions unlocked by L.
2. × **K(L)**, a calibration curve fitted by `tools/econ-sim.mjs --autocal` so that the simulated reference couple's
   measured production income equals E (± 25 % per level band is the acceptance band; from L5 the fit lands within
   0.83–1.13; the first four levels — 45 minutes in which almost nothing is sold yet — keep K = 1).
   K anchors (level, K): (1, 1) (4, 1) (7, 1.05) (12, 1.3) (17, 1.85) (22, 2.44) (27, 2.75) (32, 2.98) (37, 3.18)
   (40, 3.26), linear between them. E never falls from one level to the next (R9).

| Lvl | Crops | Animals | Trees | Crafting | Total E (×1.2 orders premium) |
|---|---|---|---|---|---|
| 1 | 864 | 1,008 | 0 | 0 | 2,200 |
| 5 | 4,458 | 1,344 | 1,215 | 572 | 9,300 |
| 10 | 10,834 | 2,167 | 2,919 | 1,538 | 25,000 |
| 15 | 21,858 | 3,118 | 8,322 | 2,473 | 70,000 |
| 20 | 27,547 | 3,908 | 11,374 | 2,932 | 120,000 |
| 25 | 33,535 | 4,735 | 13,361 | 3,170 | 170,000 |
| 30 | 39,224 | 5,103 | 16,931 | 3,444 | 220,000 |
| 35 | 43,416 | 5,361 | 19,034 | 3,738 | 270,000 |
| 40 | 49,105 | 5,448 | 23,030 | 4,059 | 320,000 |

The table shows the hand model's parts before K and the final E. Measured production income ÷ E for the reference couple
per level band: L1–4 0.71, L5–9 0.96, L10–14 0.83, L15–19 1.13, L20–24 1.01, L25–29 1.02, L30–34 1.02, L35–39 1.00.

**Timers against income (consistency examples).**

- *L9, Farm Kitchen, 14,000 coins = 0.6 h of E.* An Omelette turns 306 coins of eggs and milk into 454 in 20 min and
  earns 227 more when it fills an order (1.5 × V). Soups and omelettes are exactly what Mabel's orders ask for from L10.
- *L15, Pie Oven, 49,000 = 0.7 h of E.* An Apple Pie adds its machine time to flour, apples and butter in 2 h; a slot of
  long pies runs through the days away, a slot of short juices or jams through the evening.
- *Crops vs. session length.* A 60-minute evening fits 1–3 cycles of 20–45-minute crops plus a few minutes of Wheat and
  Carrots for flour and feed; the two days away fit one Cabbage (24 h) or Watermelon (16 h) cycle, or two Pumpkin cycles
  if somebody checks in.
- *Animals vs. visits.* Hens (20 min) and cows (1 h) reward an active evening; sheep, pigs, goats (3–4 h) and horses
  (6 h) fill up while away; nothing is lost if a product waits on the animal for a week.

### 4.5 XP sources

| Action | XP | Notes |
|---|---|---|
| Harvest a plot | V × yield / 8, **exact** (accrued per farm in hundredths: Wheat pays 0.5 XP a plot; the table's `XP` column is the rounded display value) | +10 % Fresh on every crop; personal split 40 % planter / 60 % harvester (wave-1 QA RC-13: a rounded-up 1 XP made 1-minute Wheat the best XP crop per plot-minute) |
| Harvest a tree | tree table `XP` | |
| Collect an animal product | animal table `XP` | |
| Collect a crafted good | recipe table `XP` (value added / 8) | +25 % for duets |
| Fill an order | 1.5 × Σ V × (1 − r) / 8, r ∈ {0.5, 0.65, 0.8, 0.95} | §5.2 |
| Townsfolk request | 1.5 × Σ V × 0.2 / 8 | §5.3 |
| Barge crate | 0.2 × crate coins / 8 | §5.7 |
| Quests, mastery stars, Almanac | tables in §5 | mastery stars capped (§4.8); Almanac 4 paid tasks a day per player |
| Clear debris | starter: weeds/rocks 1, stumps/logs 2, boulders 5; expansion and later: weeds 2, rocks 4, stumps and logs 8, boulders 20, big stumps 30; regrown weeds/rocks 1 (and 5 coins per XP) | §2.3 |
| Buy decor, water, plant, feed, pet | 0 | XP is never paid for inputs or purchases — no plant-and-delete, decor-flip or click farming |

XP measured per play-hour is 1.1–2.4 × E/8 depending on the level band (harvest XP counts the gross, crafting counts
value added on top, quests add a one-off burst); the level curve uses that measured ratio X (§4.6), so the "1 XP ≈ 8
coins" rule of thumb is an order of magnitude, and the curve is fitted to real play instead.

### 4.6 Level curve to 40, with unlocks

```
xpToNext(L) = nice( E(L) / 8 × X(L) × targetMinutes(L) / 60 )     nice() = 2 significant digits; strictly increasing
targetMinutes (play of the reference couple from L to L+1):
   3, 6, 12, 24 (L1–4)  · 24, 26, 28, 28, 29 (L5–9)  · 30, 40, 45, 50, 55, 60, 70, 75, 85, 90 (L10–19)
   · 120 + 30·(L − 20) (L20–29)  · 420 + 20·(L − 30) (L30–39)
X(L) anchors (fitted XP per play-hour ÷ E/8): (1, 1.75) (4, 1.75) (7, 1.52) (8, 1.714) (9, 1.793) (10, 1.728)
   (11, 1.6875) (12, 1.85) (14, 1.922) (15, 3.429) (16, 3.158) (17, 2.876) (18, 2.706) (19, 2.521) (20, 2.067)
   (21, 1.723) (22, 1.981) (23, 1.676) (24, 1.365) (25, 2.09) (26, 1.87) (27, 1.67) (29, 1.6) (32, 1.5) (35, 1.37)
   (39, 1.2) (40, 1.2), linear between them (final pacing pass, 2026-10-04: see below)
Legacy levels (after 40): flat, equal to the L39 → 40 requirement, forever.
```

**Pacing (the owner's targets, proven by the simulator over 5 seeds and by the real rules, Appendix E)** for the
reference couple (3 evenings a week × 60 min together): **L5 in the first evening (~45 min of play)**, **L10 by the
third evening (~2.5 h)**, **L20 in about a month (~12 h, day ~29)**, **L30 after about 4 months** and **L40 after
about ten months** — L30+ is the long-term goal; Legacy levels follow about once a month. A couple who plays every evening
for 90 minutes reaches L10 on day 2, L20 on day ~8 and L40 in about 9 weeks; a solo player at 60 minutes a day L20 on
day ~15.

*Final pacing pass (2026-10-04).* The owner's Level-up Bloom (§3.1 rule 10) makes the first two weeks faster: on the
real rules (`tools/real-sim.mjs`, the in-process engine) the couple reached L15 after ~4.5 h instead of 6.7 h and L20
on day 19–26, while L20–24 took 4–5 evenings a level and L25–39 6–14 (L30 on day 145–154, L40 well past a year). The
X anchors were refitted: L1–14 keep their thresholds (a live farm never loses a level it reached; L9–L11 move by at
most 300 XP), L15–19 hold the time the Bloom saves earlier, L20–24 match the XP the real rules earn there (~30–35k an
evening), and L25–39 sit between econ-sim's couple (43–54k XP an hour) and the real-rules bots (32–45k an hour, without
the M2 systems), with no spike at L38–39 (Legacy levels 480,000 each, was 660,000). Measured: econ-sim casual L20 at
12.2 h (day 29), L30 at 47.2 h (day 110), L40 at 116.8 h (day 273); the real rules (Appendix E) L20 on day 26–28, L25 by
day 51–65, L30 and L40 as measured there.

| Lvl | XP to next | Cumulative XP at level | Target play to next | Income target E (coins/h) | XP/h | Plot cap | Level-up coins | Acorns |
|---|---|---|---|---|---|---|---|---|
| 1 | 25 | 0 | 3 min | 2,200 | 481 | 16 | 330 | 2 |
| 2 | 55 | 25 | 6 min | 2,400 | 525 | 17 | 360 | 2 |
| 3 | 140 | 80 | 12 min | 3,300 | 722 | 19 | 500 | 2 |
| 4 | 460 | 220 | 24 min | 5,200 | 1,138 | 20 | 780 | 2 |
| 5 | 780 | 680 | 24 min | 9,300 | 1,945 | 28 | 1,400 | 5 |
| 6 | 1,000 | 1,460 | 26 min | 12,000 | 2,395 | 29 | 1,800 | 2 |
| 7 | 1,300 | 2,460 | 28 min | 15,000 | 2,850 | 37 | 2,300 | 2 |
| 8 | 1,600 | 3,760 | 28 min | 16,000 | 3,428 | 38 | 2,400 | 2 |
| 9 | 2,600 | 5,360 | 29 min | 24,000 | 5,379 | 46 | 3,600 | 2 |
| 10 | 2,700 | 7,960 | 30 min | 25,000 | 5,400 | 47 | 3,800 | 5 |
| 11 | 4,500 | 10,660 | 40 min | 32,000 | 6,750 | 55 | 4,800 | 2 |
| 12 | 6,900 | 15,160 | 45 min | 40,000 | 9,250 | 56 | 6,000 | 2 |
| 13 | 10,000 | 22,060 | 50 min | 52,000 | 12,259 | 64 | 7,800 | 2 |
| 14 | 13,000 | 32,060 | 55 min | 57,000 | 13,694 | 65 | 8,600 | 2 |
| 15 | 30,000 | 45,060 | 1 h | 70,000 | 30,004 | 73 | 11,000 | 5 |
| 16 | 35,000 | 75,060 | 1 h 10 min | 76,000 | 30,001 | 74 | 11,000 | 2 |
| 17 | 40,000 | 110,060 | 1 h 15 min | 89,000 | 31,996 | 82 | 13,000 | 2 |
| 18 | 46,000 | 150,060 | 1 h 25 min | 96,000 | 32,472 | 83 | 14,000 | 2 |
| 19 | 52,000 | 196,060 | 1 h 30 min | 110,000 | 34,664 | 91 | 17,000 | 2 |
| 20 | 62,000 | 248,060 | 2 h | 120,000 | 31,005 | 92 | 18,000 | 5 |
| 21 | 70,000 | 310,060 | 2 h 30 min | 130,000 | 27,999 | 100 | 20,000 | 2 |
| 22 | 100,000 | 380,060 | 3 h | 140,000 | 34,668 | 101 | 21,000 | 2 |
| 23 | 110,000 | 480,060 | 3 h 30 min | 150,000 | 31,425 | 103 | 23,000 | 2 |
| 24 | 120,000 | 590,060 | 4 h | 170,000 | 29,006 | 110 | 26,000 | 2 |
| 25 | 200,000 | 710,060 | 4 h 30 min | 170,000 | 44,413 | 112 | 26,000 | 5 |
| 26 | 210,000 | 910,060 | 5 h | 180,000 | 42,075 | 113 | 27,000 | 2 |
| 27 | 230,000 | 1,120,060 | 5 h 30 min | 200,000 | 41,750 | 121 | 30,000 | 2 |
| 28 | 250,000 | 1,350,060 | 6 h | 200,000 | 40,875 | 122 | 30,000 | 2 |
| 29 | 270,000 | 1,600,060 | 6 h 30 min | 210,000 | 42,000 | 124 | 32,000 | 2 |
| 30 | 300,000 | 1,870,060 | 7 h | 220,000 | 43,083 | 131 | 33,000 | 5 |
| 31 | 320,000 | 2,170,060 | 7 h 20 min | 230,000 | 44,083 | 133 | 35,000 | 2 |
| 32 | 330,000 | 2,490,060 | 7 h 40 min | 230,000 | 43,125 | 134 | 35,000 | 2 |
| 33 | 360,000 | 2,820,060 | 8 h | 250,000 | 45,521 | 142 | 38,000 | 2 |
| 34 | 380,000 | 3,180,060 | 8 h 20 min | 260,000 | 45,933 | 143 | 39,000 | 2 |
| 35 | 400,000 | 3,560,060 | 8 h 40 min | 270,000 | 46,238 | 145 | 41,000 | 5 |
| 36 | 420,000 | 3,960,060 | 9 h | 280,000 | 46,463 | 152 | 42,000 | 2 |
| 37 | 430,000 | 4,380,060 | 9 h 20 min | 290,000 | 46,581 | 154 | 44,000 | 2 |
| 38 | 440,000 | 4,810,060 | 9 h 40 min | 290,000 | 45,041 | 155 | 44,000 | 2 |
| 39 | 480,000 | 5,250,060 | 10 h | 320,000 | 48,000 | 163 | 48,000 | 2 |
| 40 | Legacy: 480,000 each | 5,730,060 | — | 320,000 | 48,000 | 164 | 48,000 | 5 |

**Level-up rewards**: the coins in the table (0.15 h of E), the Acorns, **Level-up Bloom** (§3.1 rule 10: everything
growing on the farm finishes; changed by the owner 2026-10-04: a level-up finishes everything growing), the unlock
banner with a "Show me" button for each new thing (non-modal, §7.2), and the 240-BPM celebration on both screens.
Legacy levels give one reward from a rotating pool: 10 Acorns, a Golden Seed Packet, an outfit piece, a decor variant, a
statue variant. **A milestone build** pays the same way for a level whose unlocks have not shipped yet (M1a from L13):
odd levels 10 Acorns, even levels a Golden Seed Packet, so every level gives something (R8; wave-1 QA RC-14). Level-up coins are paid on reaching the level (ruling L3).

**What unlocks when** (generated; every level unlocks at least one thing and no content category waits more than 3
levels; new *systems* are surfaced at most one per ~20 minutes of play, §7.4):

| Lvl | Unlocks |
|---|---|
| 1 | crop Wheat; animal Chicken; building Feed Mill; decor Flower Bed; decor Picket Fence (per tile); decor Dirt Path (per tile); feature: Market Stand, Barn (200), free Chicken Coop and Feed Mill, two tutorial tracks (Fields, Barnyard), quest book, activity feed, pings, emotes, high-five, debris clearing, Uproot |
| 2 | crop Carrot; feature: Orders Board (3 slots), help flags and "I'm on it" pins |
| 3 | crop Corn; building Windmill; recipes Flour, Cornmeal; decor Scarecrow; feature: Daily Gift calendar, Daily Almanac (wave-2 RC-01: was L8) and Farm Weeks (weekly streak) |
| 4 | crop Strawberry; tree Apple Tree; building Bakery; recipes Bread, Corn Bread, Carrot Muffin; decor Sunset Bench; feature: Golden Hour (Sunset Bench) |
| 5 | crop Potato; decor Hay Bale Stack; expansion Creekside Meadow; feature: Land expansions (+6 plot cap each), 4th order slot |
| 6 | crop Tomato; tree Pine (woodlot); building Sawmill; building Juice Press; recipes Planks, Wooden Crate, Apple Juice, Carrot Juice; decor Porch Wind Chime; barn upgrade 1; feature: Barn upgrades, weekly Couple Challenge (from the first Monday after L6) |
| 7 | animal Cow; building Dairy; recipes Cream, Butter, Baby Bottle, Strawberry Yogurt; decor Flower Wheelbarrow; expansion Old Orchard; feature: Crop and animal mastery, baby animals |
| 8 | crop Sugarcane; building Compost Bin; recipes Sugar, Pancakes; decor Bird Bath; feature: Compost and blue-ribbon crops |
| 9 | crop Pumpkin; building Farm Kitchen; recipes Bird House, Omelette, Veggie Soup, Pumpkin Soup; decor Garden Lantern; expansion Cow Hill; barn upgrade 2; feature: 5th order slot, Wishlist |
| 10 | recipes Cookies, Cheese, Popcorn, Dog Biscuit, Cat Treat, Sweetheart Cake; decor Sprinkler; decor Dog House; decor Cat Basket; feature: Pets (one each), duet recipes, Collections album, Big Watering Can |
| 11 | crop Sunflower; tree Cherry Tree; building Preserves Kitchen; recipes Roasted Sunflower Seeds, Strawberry Jam, Ketchup, Cherry Jam; expansion Sunflower Rise; feature: Market Demand of the day |
| 12 | crop Cabbage; animal Sheep; building Weaver's Shed; recipes Coleslaw, Potato Gratin, Sauerkraut, Yarn, Toy Horse; decor Rose Arch; barn upgrade 3; feature: Specialisation perks (M2), rested XP (M2, wave 3), Wide Sickle (2×2) |
| 13 | crop Oats; tree Orange Tree; animal Bee Colony; recipes Oat Flakes, Orange Marmalade, Orange Juice; expansion Bee Glade; feature: Bee forage and pollination |
| 14 | crop Blueberry; building Sewing Table; recipes Blueberry Muffin, Blueberry Jam, Wool Scarf; decor Wishing Well; feature: County Fair (weekly), 6th order slot, Seed Spreader (2×2) |
| 15 | tree Lemon Tree; building Pie Oven; recipes Granola Bar, Apple Pie, Pumpkin Pie, Cherry Pie, Lemon Cake, Lemonade, Harvest Feast; decor Garden Windmill; expansion Fairground Lane; barn upgrade 4; feature: River Barge (weekly) |
| 16 | crop Cotton; building Chandlery; recipes Cotton Cloth, Cotton Tote, Wool Pillow, Blueberry Pie, Beeswax, Honey Candle; decor Straw Skep; feature: Restoration Ledger (6 projects), second Windmill allowed |
| 17 | tree Peach Tree; animal Pig; recipes Truffle Pasta, Peach Jam, Picnic Blanket, Peach Cobbler; expansion Riverbank; feature: Truffle hunting (pigs) |
| 18 | crop Lavender; recipes Ice Cream, Lavender Dye, Sweater, Lavender Candle; decor Porch Swing; barn upgrade 5; feature: Farm Beauty rating, decor sets, Masterwork decor, second Dairy allowed |
| 19 | tree Pear Tree; animal Duck; recipes Custard, Pear Tart, Lemon Meringue Pie, Pear Nectar; expansion Pig Woods; feature: Animal Nursery (personality and specialty), Restoration project 2 |
| 20 | building Packing Table; recipes Quilt, Breakfast Hamper, Pizza; decor Stone Fountain; grand decor Old Dutch Windmill; feature: Giant crops, 7th order slot, Town Projects (Hollow Village across the river) |
| 21 | expansion Willow Pond; barn upgrade 6; feature: Townsfolk Friendship and the weekly townsfolk board, the Fishing Dock at Willow Pond (M2) |
| 22 | animal Goat; recipes Goat Cheese, Lavender Soap; decor Topiary Bush; feature: Heirloom trees show their blue-ribbon fruit, Restoration project 3 |
| 23 | tree Plum Tree; recipes Plum Jam, Plum Cake, Picnic Basket; grand decor Flower Maze; feature: Help flags on Restoration bundle slots |
| 24 | crop Onion; recipes French Onion Soup; decor Cold Frame; expansion Goat Rocks; barn upgrade 7; feature: Seasonal Ribbon Track |
| 25 | animal Horse; recipes Compost, Wedding Cake; feature: Horse show at the Fair, Restoration project 4 |
| 26 | tree Walnut Tree; recipes Walnut Honey Cake, Spa Basket, Walnut Cookies; decor Garden Gazebo; grand decor Koi Pond; feature: Grand Sickle (3×3) |
| 27 | crop Watermelon; recipes Watermelon Salad, Watermelon Juice; expansion Stable Paddock; barn upgrade 8; feature: Fair NPC league |
| 28 | recipes Cozy Winter Gift; decor Fishing Dock; feature: Breeding Barn (coat variants), 8th order slot, Restoration project 5 |
| 29 | grand decor Carousel; feature: Carousel decor set, Friendly Duel (M2, wave 3: the GDD gave it no level) |
| 30 | tree Olive Tree; building Oil Press; recipes Olive Bread, Sunflower Oil, Olive Oil, Potato Chips; expansion Walnut Grove; barn upgrade 9; feature: Gold mastery tier |
| 31 | crop Bell Pepper; recipes Stuffed Peppers, Pickled Peppers; grand decor Treehouse; feature: Second Feed Mill allowed |
| 32 | recipes Truffle Oil, Harvest Festival Hamper; decor Cow Statue; feature: Hampers score double at the Fair |
| 33 | animal Alpaca; recipes Alpaca Yarn, Alpaca Plush, Alpaca Shawl; grand decor Clock Tower; expansion Olive Terrace; barn upgrade 10; feature: Second Pie Oven allowed |
| 34 | tree Maple Tree; building Sugar Shack; recipes Maple Syrup, Maple Pancakes, Maple Walnut Fudge; feature: Restoration project 6 (Grandma's Farmhouse) |
| 35 | crop Rice; recipes Truffle Risotto, Rice Pudding; grand decor Glass Orangery; feature: 9th order slot |
| 36 | tree Cocoa Tree; building Chocolatier; recipes Chocolate, Hot Cocoa, Chocolate Cake; expansion Maple Ridge |
| 37 | recipes Chocolate Truffles, Gourmet Hamper; grand decor Great Arbor of Lights; feature: Gourmet orders (one T4 good, 1.7 × V) |
| 38 | decor Hot-air Balloon Mooring; feature: Showcase beauty beyond 5 stars |
| 39 | tree Fig Tree; recipes Fig Jam, Fig & Goat Cheese Tart; grand decor Hot-Spring Bath House; expansion Sunset Hill; feature: Sunset Hill gazebo (Golden Hour +10 min) |
| 40 | grand decor Golden Farm Gate; feature: Legacy levels |

### 4.7 Personal level, perks and rested XP

- **Personal XP** is the acting player's share of every XP grant. **Personal level thresholds = 0.6 × the farm table**
  (each partner earns roughly half of the farm's XP, so both reach personal levels close to the farm level).
- M1 ships personal levels as **titles** only (shown on the name card; the number lives on the Stats tab, never on the
  portrait — no comparison).
- **Perks (M2)**: 1 point per 2 personal levels (max 20). Four trees of 5 perks costing 1, 1, 2, 2, 3 points (9 per
  tree), so a player can complete two trees. Perks apply **only to the owner's own actions** and never change the
  partner's numbers. Free respec once a week.

| Tree | Perk 1 (1) | Perk 2 (1) | Perk 3 (2) | Perk 4 (2) | Perk 5 (3) |
|---|---|---|---|---|---|
| **Grower** | +5 % crop XP | seeds −10 % | 5 % chance of +1 unit | watering −5 % extra | blue-ribbon chance +3 points |
| **Rancher** | +5 % animal XP | babies grow 15 % faster | 5 % chance of a double product | 10 % chance a tend uses no feed | blue ribbon after −20 % collections |
| **Orchardist** | +5 % tree XP | tree watering −5 % extra | 10 % chance of +1 fruit | trees cost −10 % | Heirloom after 45 harvests instead of 60 |
| **Artisan** | +5 % craft XP | own queued items −5 % time | 5 % chance of a double output | +5 % sell price on crafted goods you sell | duets: 10 % chance of a second output |

**Harmony is cut** (v2, P2): a +5 % order bonus for complementary perk trees was invisible and nobody would play for it.

**Welcome back (M2)**: rested XP is deferred. In M1 the returning partner gets the recap card, the per-player "new
things" tour, the partner's notes and keepsakes — the felt part of a welcome back. When rested XP ships: while a player
is offline it accrues at 5 % of their personal level requirement per 8 h, capped at 150 % of a level, and doubles their
personal XP gains until used; Farm XP is unaffected. *Wave 3*: it ships in M2 with the perks (feature `rested_xp`, L12;
content `RESTED`); the accrual is proportional and integer (no 8-hour steps), so logging out can never mint farm XP.

### 4.8 Mastery

One mastery track per crop, tree species, animal species and recipe, shared by the farm (both players' actions count).

```
thresholds(star) = nice( base[star] × clamp( (60 / minutes)^0.35, 0.5, 2.5 ) )
base = 20 / 100 / 300 / 1000 for ★1 / ★2 / ★3 / Gold        (counts: plot harvests, tree harvests, collections, crafts)
```

So a 1-minute crop needs 50 / 250 / 750 / 2,500 harvests and a 12–24-hour crop 10 / 50 / 150 / 500 (thresholds per crop
are in the crop table). Recipes use the same formula on their craft time; animals and trees on their cycle.

| Star | Crops | Trees | Animals | Recipes | Reward (v2, C1d: capped) |
|---|---|---|---|---|---|
| ★1 | +5 % sell price | +5 % sell | +5 % sell | +5 % sell | min(10 × V, E × 0.1 h) coins and min(10 × XP, E × 0.1 h / 8) XP |
| ★2 | −10 % grow time | −10 % cycle | −10 % cycle | −10 % time | min(20 × V, E × 0.2 h) coins and min(20 × XP, E × 0.2 h / 8) XP |
| ★3 | 15 % chance of +1 unit; Mastery Sign decor | 15 % +1 fruit; sign | 15 % double product; sign | 10 % double output; badge | 1 Acorn + min(40 × XP, E × 0.2 h / 8) XP |
| Gold (L30+) | +5 points blue-ribbon chance; gold sign | +5 points | +5 points premium chance | +5 % XP | 3 Acorns + gold sign |

The cap matters for long items: one night of 50 Cabbage plots used to reach ★1 and ★2 for 4,740 XP at a level needing
2,600; twelve Quilts paid 1.6 hours of income. Simulated, mastery is now 2–3 % of coins and 4 % of XP.

Mastery belongs to the item type, never to one plot or animal you must nurse (the FV2 "everything levels up"
lesson). Percent effects multiply with seasons and perks; time effects add (−10 % mastery, −10 % in season, −10 %
Golden Hour, −15/−20 % watering and −5 % partner tend) and are applied with a floor of 50 % of the base time.

### 4.9 The "perfect logic" contract (automated checks)

`tools/economy-model.mjs` asserts R1–R18 on the generated content (exit 1 on failure); `tools/econ-sim.mjs --checks`
proves the simulation part over 5 seeds × 4 schedules; `test/economy.test.js` must assert them again for
`shared/content/*.js`, and the rules marked *test* are code-level properties for the server's test suite.

| # | Rule | Check |
|---|---|---|
| R1 | One formula prices everything | values recomputed from the formulas equal the content tables; the simulator's port equals the model |
| R2 | Seeds never cost more than the plot returns | `seed < yield × V` for every crop |
| R3 | No value-losing step | every recipe output ≥ 1.15 × its input value |
| R4 | No dead ends | every raw good has ≥ 2 uses (recipes or feed; Manure → Compost is the single-use exception), and its first use unlocks within 3 levels of it |
| R5 | No arbitrage | the store never sells an item the Market buys; feed and consumables are not sellable; refunds and undo never create coins |
| R6 | Unlock order holds | every recipe input and building is unlocked at or before the recipe; every quest task references unlocked content |
| R7 | Always a session crop and an away crop | from L12 every horizon band (≤ 3 min, 10–60 min, 2–6 h, 8–16 h, ≥ 24 h) has an unlocked crop |
| R8 | Every level gives something | no empty level; no crop/tree/animal/building gap longer than 3 levels |
| R9 | Monotonic curve | XP to next level strictly increases; E never decreases |
| R10 | Positive animals | every animal's product is worth more than its feed |
| R11 | Reachable goals (v2, X4) | every achievement tier and collection item is reachable from the content, finite sources counted (Restorer Gold 24 = 6 × 4 bundles; Recipe Box Gold = 117 = all recipes; debris regrows) |
| R12 | No refund loop (v2, X1) | for every object, refund after settlement + value granted ≤ price (decor grants no XP) — *test* (fuzz) |
| R13 | Bonus ≥ base (v2, X3) | every bonus variant (giant, blue-ribbon, premium, duet) is worth at least its base variant in expected value |
| R14 | Materials never wall (v2, X6) | per level band, wood/plank/crate supply in the band's target time ≥ the material costs gated in it — *sim* |
| R15 | Reward value, not counts (v2, X2) | no repeatable reward is paid per *count* of an action whose cost the player controls (orders filled, sell clicks); weekly meters count value; simple orders count ¼ toward any order-count task |
| R16 | Fresh RNG keys (v2, X7h) | every `hash32` roll key includes a per-object cycle or `plantedAt` — *test* |
| R17 | No reason to wait (v2, C2) | every co-op bonus is "base for anyone + extra for the partner"; nobody gains by leaving work to the partner |
| R18 | No dominated item (v2) | no recipe is beaten per hour AND per craft by an earlier-or-same-level recipe of its building; no crop is beaten per plot-hour AND per planting by an earlier-or-same-level crop |
| SIM | Simulated health | pacing within the §4.6 bands; every unlocked item produced at least once; every story quest completed; overflow < 10 % of play; < 2 % hungry animal-minutes; 0 invalid orders and < 35 % simple orders; treasury > 15 E-hours < 10 % of play from L20; ≥ 50 % of barge crates loaded; the reference couple wins Silver+ at the Fair in ≥ 30 % of weeks (Appendix E) |

### 4.10 Market rules

- **Market Stand**: sell any stack, any quantity, instantly, at the price in the formula. The coin count rolls up, coins
  fly to the pill. No haggling, no player-set prices (Supercell's admitted mistake), no buyback.
- **Market Demand of the day** (L11): Mabel's chalkboard names one raw item and one crafted item (both unlocked ≥ 1
  level, not the same pair two days running) that sell for +50 %, for the first 50 units per day (period counter).
- **Golden orders** pay Acorns (§5.2); the Market never does.

### 4.11 Hearts shop (personal cosmetics)

M2 (wave 2: Hearts are earned from M1a; the shop that spends them ships with the wardrobe in M2). *Wave 3*: no lane
of the M2 build makes the wardrobe (outfits need avatar models), so the shop stays data; where M2 rewards name an
outfit piece (the Seasonal Ribbon Track, Legacy levels) they pay **Hearts** instead, which the shop will spend.

| Item | Hearts |
|---|---|
| Outfit pieces (12 hats, 12 tops, 10 bottoms, 8 boots; from the Quaternius modular outfits and recolours) | 10–40 each |
| Full outfits (Farmer, Worker, Casual, Adventurer, Medieval dress, Formal, Beach) | 60–120 |
| Matching couple outfit (two copies, one per player) | 2 × 50 |
| Outfit dyes (16 colours) | 8 |
| Emotes (beyond the free 8): dance, bow, twirl, blow-kiss, cheer, sleepy, laugh-hard, shrug | 15 each |
| Name-card frames and titles' colours | 20 |
| Tool skins (copper, painted, golden sickle) | 30–80 |
| Pet accessories (collars, bandanas, a little straw hat) | 10–25 |

---

## 5. Goal systems

### 5.1 The Goal Tracker (never empty)

Three cards, top-left, per player:

- **NOW** — doable within about a minute, no waiting.
- **SOON** — completable within about 15 minutes.
- **BIG** — pinned by the player, or the long goal closest to completion.

```
candidates = ready-to-collect · idle plots · orders fillable from stock · own Almanac tasks · partner help flags ·
             quest tasks (doable-now marked) · new recipes to try · goals ≥ 80 % done (achievements, mastery,
             collections, bundles, Town Project) · next-level preview · debris · expansion proof task
score = urgency (ready items, festival end) + proximity (1 − remaining/total) + horizon fit (ETA vs slot)
      + novelty (system not shown in the last 10 min) − partner-is-doing-it (their pin, or their last 3 actions)
      + different-domain bonus (v2, C4: fields / barnyard / workshop / orchard different from the partner's last 3 actions)
NOW fallback chain: Grandma's seed basket (a broke farm) → collect ready → plant idle plots (naming the crop that
                    fits the wait) → fill an order → build: the cheapest unlocked building or slot the farm can afford
                    ("Build the Bakery (2,600). You have 3,292") → the open land card's next proof task ("Creekside
                    Meadow: Harvest 12 more Wheat") → Almanac task → clear debris → partner's help flag → decorate
                    (the cheapest decor at ≤ 10 % of the treasury) → "Everything is growing — next ready in 2:41."
```

A story card that waits says what for ("Baby Steps: build the Dairy first", "Beyond the Fence: first harvest 12 more
Wheat"); waits read m:ss under an hour, h:mm under ten hours, then "23 h 59 m". Past the milestone's last unlock the
level card says "Evening One is complete. More of the valley opens soon" (wave-1 QA RC-09, RC-10, RC-14, RC-26). The
last line of the chain is always there, so the NOW card can never be empty (`goals(state, pid, now)` is a
pure shared function with a fuzz test, tech §9). The different-domain bonus gently splits the couple across the farm
(one sweeps the fields, the other the barnyard), which is also what keeps "got there first" races rare. Rule
**G-VALID**: no generator (orders, townsfolk, quests, barge, Almanac, challenges, bundles, Town Projects) may ask for an
item that is not unlocked and producible on the farm right now (full chain: Pancakes need cows, not just a Bakery) or
already in stock; they are validated at generation time and again on server boot.

### 5.2 Orders board (Mabel's Market) — L2

| Item | Rule |
|---|---|
| Slots | 3 at L2 · 4 at L5 · 5 at L9 · 6 at L14 · 7 at L20 · 8 at L28 · 9 at L35 |
| Timer | **No order ever expires.** A filled or discarded slot refills after **15 min** (shown as a countdown and "a new order is on its way"); the **quick slot** (board slot 0) refills after **5 min** (wave-2 RC-01). One free instant refill per day per farm; more cost 1 Acorn. |
| Content | 1–3 item types, never feed, consumables, blue-ribbon goods or festival items outside their festival; T4 goods from L22; duet goods only in golden orders, **at most one duet order open** and a duet good in at most 2 open orders like any item (wave-2 QA RC-05) |
| Pay | 1.5 × Σ V in coins and XP: coins = 1.5 Σ V · r, XP = 1.5 Σ V · (1 − r) / 8, with r ∈ {0.5, 0.65, 0.8, 0.95} chosen per order (coin-heavy and XP-heavy orders give a real choice) |
| Golden order (v2, X2) | **the first order generated after each 6-hour boundary** (00:00, 06:00, 12:00, 18:00 server time) is a named townsperson's request: same pay + **1 Acorn** + 1 Friendship. Discarding cannot fish for it. From L10, **one golden order in three asks for one duet good** and pays **2.0 × V** (v2, M6) |
| Gourmet order (L37) | One slot may hold a single T4 good (a hamper, truffle dish or quilt) that pays **1.7 × V** instead of 1.5 × |
| Partial delivery | Not allowed (the whole order at once), so goods are never stranded in half-done orders |
| Stale intents | Fill, discard, pin and flag name the order's own number: an intent for an order that was filled or discarded meanwhile answers "Mia got there first" and never touches the new order in that slot (wave-1 QA RC-07) |
| Co-op | "I'm on it" pin (partner's colour); discarding an order the partner pinned asks for a soft confirm (v2); "Need help" flag (§6.2 mechanic 3) |
| **Mabel's weekly meter** (v2, X2: replaces "Market Week") | counts the **value** of filled orders (Σ 1.5 V; simple orders count ¼) Monday–Sunday, in hours of Monday's E: chests at **0.75 h / 1.5 h / 2.5 h** pay **E × 0.25 h + 1 Acorn · E × 0.4 h + 2 Acorns · E × 0.6 h + 3 Acorns** (and 5 Compost in the first) |

**Generation** (system action `_orders` at the slot's `availableAt`; deterministic from `hash32(farmSeed, 'order',
slot, n)` and the farm state at that moment; materialised into the state, tech §4.5):

```
L       = farm level now
budget  = E(L) × f,  f ~ U[0.06, 0.15] for L ≤ 5 · U[0.10, 0.25] for L 6–14 · U[0.09, 0.20] for L 15–26
          · U[0.06, 0.12] for L ≥ 27
          (wave-2 QA D2: from L15 the Fair, the barge and the village share the evening; measured on the real rules.
          Final pass 2026-10-04: the late board held 60–93-unit crop lines beside T4 goods and jammed; smaller late
          orders gave the real rules +10–20 % XP an evening at L30–39 and 1–3 fewer both-idle minutes)
          board slot 0 is the QUICK slot at every level: f from the L ≤ 5 band, at most 20 machine-minutes
          (wave-1 QA RC-19: orders were 5 % of coin income against the model's 18–25 %); it refills on its own
          5-minute timer and asks only for goods ready within 15 minutes (crops ≤ 15 min, animal goods of ≤ 20-min
          cycles or in stock, crafts ≤ 20 machine-minutes): a couple waiting on a corn field always has a small order
          to fill (wave-2 RC-01)
pool    = orderable items with unlock ≤ L − 1 whose FULL CHAIN is producible on the farm now (G-VALID; fruit needs a
          tree that bears now, a sapling is no producer), minus items already in 2 open orders, minus items whose
          capacity cap leaves them worth < 25 % of their budget share (up to L4, session crops ≤ 30 min skip that
          filter, and while no open order asks for a crop the next one does: the first evenings always see one
          normal crop order; wave-1 QA RC-08, RC-12)
weight  = 1 / (1 + times requested in the last 5 orders) × 3 if ≥ 1 in stock × 1.3 if crafted and L ≥ 8
          × 4 if the farm has never delivered it ("Mabel likes to try new things": every good gets asked for)
k       = 1 + floor(rand × min(3, 1 + floor(L / 12)))             1–3 types, more types later (wave-2 QA D2: was L / 7;
          final pass: at most 3, the 4th type from L36 made the orders nobody could fill)
pick k items by weight; never two items that share a direct input (the Hay Day boat rule)
qty_i   = clamp( round(budget / k / V_i), 1, cap_i )
cap_i   = crops plotCap/5 × yield (wave-2 QA D2: was /3); fruit mature trees × yield; animals adults × max(1, floor(90 / cycle)) (up to L4:
          one cycle of the adults);
          crafted out × max(1, floor(45 / minutes))  (one building makes ONE item at a time, v2 H2)
limit   = one order holds at most 90 machine-minutes of crafting in total
safety net: if no open order can be filled from stock, from crops ≤ 60 min (or crops already growing in enough
          plots), or from one ≤ 60-min building run with inputs in stock, the next order is "simple": one good the farm
          has in stock (preferred) or one crop ≤ 30 min, qty ≤ what is there / plotCap ÷ 2
```

**Why it works**: orders are the main income tap (1.5 × V beats the market), they only ask for things the farm can
make *now* in quantities one building or a third of the field can make, they never expire, discarding costs 15
minutes, and they spread demand across the whole production graph — which, with the novelty weight, is what keeps every
crop and recipe relevant. Simulated: 0 invalid orders, 15–25 % simple orders, every unlocked good made.

### 5.3 Quests and story

**Premise**: Grandma Hazel has retired to the seaside and left her overgrown farm, Harvest Hollow, to the two of
you. Her letters (and later her journal) guide the first evenings; the townsfolk take over from there; at the end of the
Farmhouse restoration **Grandma comes to visit** (v2: nothing in the story implies her death — "nothing bad ever
happens"). The story is a light arc that teaches and unlocks loops (Daniel Cook's "loops and arcs"): the farming loops
carry the game.

| Character | Role | Voice |
|---|---|---|
| **Grandma Hazel** | letters and journal; chapter beats; visits at L38 | warm, funny, a little nosy about the two of you |
| **Mabel** | market keeper; orders, Market Demand, the weekly meter | brisk, generous, knows everyone's business |
| **Ollie** | carpenter; buildings, expansions, barn, Restoration, Town Projects | slow-talking craftsman, loves a good plank |
| **Dr. Fern** | vet; animals, nursery, breeding | calm, precise, secretly sentimental about calves |
| **Juniper** | orchard keeper; trees, bees, groves | dreamy, speaks in seasons |
| **Captain Reed** | River Barge | gruff, punctual, ends every sentence with a sailing term |
| **Judge Pemberton** | County Fair | pompous, fair-minded, wears three rosettes |

**Structure**

- **Story cards**: up to 3 active from chains A–E, 1–3 tasks each: *do* (harvest, collect), *make* (craft), *deliver*
  (hand in goods), *own/build* (buildings, animals, trees), *complete* (Restoration bundles, Town Projects). Tasks count
  from the moment the card is accepted; delivered goods are consumed. *Own/build/place/buy* read the farm's
  **settled** holdings (past the 10-minute undo window, §6.3), so an undone purchase never finishes a card; *raise*
  counts a baby of the species that grows up on the farm, never a bought adult (wave-1 QA RC-05, RC-23).
- **The first evening's graph** (§7.4, wave-1 QA RC-01): A4 follows A2 (Fields), A3 is the Barnyard track, and A5
  waits for both A3 and A4. Two tasks are credited once when their card opens with what the farm already did since
  the system arrived: A4's order (Mabel's scripted first order, often filled before A4 can open) and A5's Flour. A
  card that waits on something names it on the tracker ("Baby Steps: build the Dairy first").
- **Doable first** (v2, G4): free story slots are filled with the quests whose tasks can progress now; a card waiting on
  something slow shows it ("waiting for apples — ready Thursday 20:40") instead of blocking a slot.
- **"This week" tab** (v2, H3): chains F (Barge) and G (Fair) depend on the weekly calendar and live in their own tab,
  never counting against the 3 story cards. **Together tab**: chain H, the only Together tasks, optional.
- **Either partner can progress any task**; credit is shared; each task records who did it for the Memory Book. Simple
  orders count ¼ toward "fill N orders" tasks (R15).
- **Never timed, never blocking.** Quests reward but never gate content: every unlock comes from levels.
- **Story beats** end chapters (A11, B5, C7, D6, E7, E10, F3, G3, H4): in M1 an illustrated letter card; from M3 a
  10–20 s vignette (camera move + speech bubbles, no cutscene clock). "Watch together?" if both are online; otherwise
  queued for the absent partner's next login; replayable from the Journal.

**Quest list (64 quests in 8 chains; rewards generated: coins = E(L) × minutes / 60 × 0.5, XP = coins / 8).** v2 adds
B6–B9, C8–C9, D7–D9, E7–E10, G4–G5 and H5–H7 so that every 5 levels from L25 to L40 carry new chapters (G1: v1 had 2
quests above L25).

| # | Giver | Lvl | Quest | Tasks | Coins | XP | Extra reward |
|---|---|---|---|---|---|---|---|
| A1 | Grandma Hazel | 1 | Welcome Home | plant 6 wheat; harvest 6 wheat | 55 | 7 | — |
| A2 | Grandma Hazel | 1 | Market Morning | sell 10 wheat | 55 | 7 | — |
| A3 | Grandma Hazel | 1 | Feathered Friends | place 1 coop; make 1 chicken_feed; tend 2 chicken | 110 | 14 | 2 Chickens (free); the Barnyard tutorial track |
| A4 | Grandma Hazel | 2 | First Customer | fill 1 order | 80 | 10 | — |
| A5 | Grandma Hazel | 3 | The Old Windmill | place 1 mill; make 3 flour | 220 | 30 | Grandma's Windmill: placed at 0 coins; first Flour made together |
| A6 | Grandma Hazel | 4 | Grandma's Apple Tree | plant 1 apple_tree; plant 6 strawberry; collect 2 egg | 430 | 55 | Grandma's Apple Tree sapling and Grandpa's Sunset Bench, given when the quest starts (wave-2 RC-01: the Golden Hour step at L4 never waits on a purchase) |
| A7 | Grandma Hazel | 5 | Bread Like Grandma's | build 1 bakery; make 3 bread (wave-2 RC-01: was 2 bread + 1 corn_bread) | 1,200 | 150 | Recipe card 'Grandma's Bread' (collection item) |
| A8 | Grandma Hazel | 6 | Wood for Winter | clear 4 debris; make 4 planks | 2,000 | 250 | 1 Pine sapling (free) |
| A9 | Grandma Hazel | 7 | A Cow Named Clover | buy 1 cow; collect 3 milk; make 1 butter | 3,100 | 390 | The couple names the first cow |
| A10 | Grandma Hazel | 9 | Supper at the Farmhouse | build 1 kitchen; make 2 veggie_soup; make 1 omelette | 6,000 | 750 | — |
| A11 | Grandma Hazel | 10 | Grandma's Long Letter | make 1 sweetheart_cake | 9,400 | 1,200 | Story beat "Two Pairs of Hands"; 5 Acorns |
| B1 | Mabel | 3 | Open for Business | fill 3 order | 280 | 35 | — |
| B2 | Mabel | 6 | Juice Stand | build 1 juice_press; make 2 apple_juice; deliver 1 apple_juice | 3,000 | 380 | — |
| B3 | Mabel | 11 | Jam Session | build 1 preserves; make 3 strawberry_jam; sell 1 demand | 12,000 | 1,500 | Jam-jar shelf decor |
| B4 | Mabel | 14 | Busy Week | fill 15 order | 57,000 | 7,100 | 3 Acorns |
| B5 | Mabel | 20 | Breakfast in a Basket | build 1 packing; make 1 breakfast_hamper; deliver 1 breakfast_hamper | 120,000 | 15,000 | Mabel's Stall decor |
| B6 | Mabel | 27 | Watermelon Summer | make 2 watermelon_juice; make 1 watermelon_salad | 300,000 | 38,000 | Melon-stand awning decor |
| B7 | Mabel | 31 | Peppers and Pickles | make 2 pickled_peppers; make 1 stuffed_peppers | 350,000 | 44,000 | — |
| B8 | Mabel | 35 | Sunday Rice | make 2 rice_pudding; make 1 risotto | 540,000 | 68,000 | — |
| B9 | Mabel | 37 | The Gourmet Basket | make 1 gourmet_hamper; deliver 1 gourmet_hamper | 730,000 | 91,000 | Mabel's gold scale decor; 3 Acorns |
| C0 | Dr. Fern | 5 | Hen House Calls (wave-2 RC-01: the Barnyard partner's card in the L5 stretch) | collect 4 egg; make 2 chicken_feed | 700 | 90 | — |
| C1 | Dr. Fern | 7 | Baby Steps | make 2 baby_bottle; raise 1 cow | 3,800 | 480 | — |
| C2 | Dr. Fern | 8 | Good Soil | empty 2 compost_bin; fertilize 6 plot | 5,300 | 660 | 6 Compost |
| C3 | Dr. Fern | 12 | Shearing Day | build 1 pasture; buy 2 sheep; collect 4 wool | 20,000 | 2,500 | — |
| C4 | Dr. Fern | 17 | Truffle Trouble | build 1 pig_pen; make 6 pig_slop; collect 3 truffle | 67,000 | 8,400 | Pig mud-bath decor |
| C5 | Dr. Fern | 19 | Duck Pond Days | build 1 duck_pond; collect 5 duck_egg; make 1 custard | 83,000 | 10,000 | — |
| C6 | Dr. Fern | 22 | Mountain Goats | build 1 goat_yard; collect 4 goat_milk; make 1 goat_cheese | 110,000 | 14,000 | — |
| C7 | Dr. Fern | 25 | Horse Sense | build 1 stable; buy 1 horse; make 2 compost | 170,000 | 21,000 | Saddle-rack decor; the couple names the horse |
| C8 | Dr. Fern | 28 | New Coats | breed 1 cow | 300,000 | 38,000 | The couple names the calf |
| C9 | Dr. Fern | 33 | Alpaca Hill | build 1 paddock; buy 2 alpaca; make 1 alpaca_yarn | 500,000 | 63,000 | — |
| D1 | Juniper | 11 | Cherry on Top | plant 2 cherry_tree; make 1 cherry_jam | 16,000 | 2,000 | — |
| D2 | Juniper | 13 | The Buzz | place 1 beehive; place 3 forage; collect 2 honey | 39,000 | 4,900 | 1 Flower Wheelbarrow |
| D3 | Juniper | 15 | Pie Day | build 1 pie_oven; make 1 apple_pie; make 1 cherry_pie | 70,000 | 8,800 | — |
| D4 | Juniper | 17 | Peach Season | plant 2 peach_tree; make 1 peach_cobbler | 89,000 | 11,000 | — |
| D5 | Juniper | 23 | Plum Perfect | plant 2 plum_tree; make 2 plum_jam | 190,000 | 24,000 | — |
| D6 | Juniper | 30 | Liquid Gold | build 1 oil_press; make 2 olive_oil | 330,000 | 41,000 | Olive-jar decor |
| D7 | Juniper | 34 | Sweet Sap | plant 1 maple_tree; build 1 sugar_shack; make 2 maple_syrup | 520,000 | 65,000 | — |
| D8 | Juniper | 36 | Cocoa Dreams | plant 1 cocoa_tree; build 1 chocolatier; make 1 chocolate_cake | 700,000 | 88,000 | — |
| D9 | Juniper | 39 | Figs at Sunset | plant 1 fig_tree; make 1 fig_tart | 800,000 | 100,000 | Fig-crate decor |
| E1 | Ollie | 5 | Beyond the Fence | expand 1 creekside | 2,300 | 290 | — |
| E2 | Ollie | 6 | More Room | upgrade 1 barn | 3,000 | 380 | — |
| E3 | Ollie | 9 | Slots and Sawdust | upgrade 1 slot; make 2 wooden_crate | 9,000 | 1,100 | — |
| E4 | Ollie | 16 | The Old Greenhouse | complete 2 bundle | 76,000 | 9,500 | — |
| E5 | Ollie | 18 | Pretty as a Picture | reach 2 beauty_star | 72,000 | 9,000 | Rose Arch decor |
| E6 | Ollie | 22 | Bridge to the Meadow | complete 2 bundle; complete 1 project (wave-2 QA RC-11: the bundles show progress every evening) | 280,000 | 35,000 | — |
| E7 | Ollie | 23 | The Ferry Landing | complete 1 town_project | 300,000 | 38,000 | Story beat "Lights Across the River" |
| E8 | Ollie | 28 | A Village Wakes | complete 3 town_project | 500,000 | 63,000 | 3 Acorns |
| E9 | Ollie | 34 | Grandma's Farmhouse | complete 2 bundle | 650,000 | 81,000 | — |
| E10 | Ollie | 38 | Grandma Comes Home | complete 1 project | 870,000 | 110,000 | Story beat: Grandma visits; 5 Acorns |
| F1 | Captain Reed | 15 | The Barge Arrives | load 3 crate | 35,000 | 4,400 | — |
| F2 | Captain Reed | 17 | Full Row | load 1 row | 89,000 | 11,000 | Rope-coil decor |
| F3 | Captain Reed | 23 | Ship Shape | load 2 row | 380,000 | 48,000 | 3 Acorns |
| G1 | Judge Pemberton | 14 | Entry Form | enter 3 fair | 21,000 | 2,600 | — |
| G2 | Judge Pemberton | 16 | Blue Ribbon Crops | harvest 3 prized | 57,000 | 7,100 | — |
| G3 | Judge Pemberton | 20 | Silver Lining | reach 1 fair_silver | 300,000 | 38,000 | Silver rosette decor |
| G4 | Judge Pemberton | 27 | League Night | reach 2 league | 300,000 | 38,000 | — |
| G5 | Judge Pemberton | 32 | Hamper Show | enter 2 hamper | 350,000 | 44,000 | Hamper rosette decor |
| H1 | Grandma's Journal | 4 | Golden Hour | together 1 bench | 430 | 55 | 1 Heart each; Memory Book page |
| H2 | Grandma's Journal | 10 | Recipe for Two | together 1 duet | 13,000 | 1,600 | 2 Hearts each |
| H3 | Grandma's Journal | 12 | Helping Hands | together 3 help_flag | 20,000 | 2,500 | 2 Hearts each |
| H4 | Grandma's Journal | 20 | Giants of the Field | together 1 giant | 90,000 | 11,000 | Giant-pumpkin trophy decor |
| H5 | Grandma's Journal | 25 | A Cake for Two | together 1 duet | 170,000 | 21,000 | 2 Hearts each; Memory Book page |
| H6 | Grandma's Journal | 30 | Gone Fishing | together 1 dock | 220,000 | 28,000 | 2 Hearts each |
| H7 | Grandma's Journal | 39 | Golden Hour on the Hill | together 1 bench | 320,000 | 40,000 | Memory Book frame; 3 Hearts each |

**Townsfolk board (v2, G1; from L21)**: every Monday three townsfolk post a request on the board by the Market: 2–3 goods
worth about **E × 0.25 h** (about two orders; wave-2 QA D2: E × 0.5 h of 4-hour goods was half an evening of the
farm), generated by the order rules (G-VALID, novelty weight, no shared inputs, up to 2 machine-hours). Each pays like
an order (1.5 × V, **70 % coins / 30 % XP**: the weekly systems pay XP like orders do) plus 1 Friendship with that
townsperson; unfinished requests simply leave on Sunday night. **Once a week, a couple that hands in all three gets a
fresh board at once** (wave-2 QA RC-11: the L20–25 evenings ran out of village work). The board is the repeatable hour-horizon goal of the late game; the reference couple fills
about half of them, a daily couple all of them.

**Townsfolk Friendship** (L21): each townsperson has 10 Friendship, earned by their golden orders (+1), their board
requests (+1), chain quests (+2) and one liked-item gift per townsperson per day (+1; each likes 3 items, shown in the
Journal). Every 2 Friendship unlock a decor gift or a recipe-card variant: a free decor piece at 2, 6 and 10 and the
townsperson's recipe card for one of their liked goods at 4 and 8 (`TOWNSFOLK.friendship.rewards`).

### 5.4 Achievements ("Ribbons")

Scopes: **F** farm (shared counter, unlocked for both), **P** personal (each player's own counter; v2, C3: only for
verbs the partner cannot "take" — plantings, petting, gifts, naming, decor placed, personal tasks), **T** together
(needs both players' contributions; each player's part is shown). Calibration targets for the reference couple:
Bronze within the first month, Silver within 3–6 months, Gold after a year or more.

**Rewards**: F — Bronze 1 Acorn + 1 Ribbon Point · Silver 3 Acorns + silver rosette decor + 2 RP · Gold 8 Acorns +
gold trophy decor + farm title + 5 RP. P — Bronze 3 Hearts · Silver 8 Hearts + outfit piece · Gold 20 Hearts + personal
title. T — both players get the P reward and the farm gets the F reward once.

**Counting rules (exploit-proof)**: only goods *produced* count (harvested, collected, crafted), never bought or
refunded; "coins earned" means sales, orders, townsfolk, barge, Fair, quests (refunds go to `coins.refunded`, never
here); "spent" counts only settled (non-refundable) spending; gifts count once per item instance and at most 1 per giver
per day; help counts only when the other player fills a flag; order counts weigh simple orders ¼.

| # | Ribbon | Requirement | Bronze / Silver / Gold | Scope |
|---|---|---|---|---|
| 1 | Cream of the Crop | Harvest plots | 500 / 5,000 / 25,000 | F |
| 2 | Green Thumb | Your plantings harvested (by anyone) | 300 / 3,000 / 12,000 | P |
| 3 | Rainbow Harvest | Different crops harvested | 6 / 12 / 21 | F |
| 4 | Night Shift | Harvest crops of 8 h or longer | 25 / 250 / 1,500 | F |
| 5 | Fresh Picker | Fresh harvests (v2: farm, was personal) | 200 / 2,000 / 10,000 | F |
| 6 | Prize Patch | Blue-ribbon harvests | 10 / 150 / 1,000 | F |
| 7 | Giant Among Us | Giant crops felled | 1 / 10 / 50 | F |
| 8 | In Season | Seasons with 100+ in-season harvests | 1 / 4 / 8 | F |
| 9 | Knock on Wood | Tree harvests | 50 / 500 / 2,500 | F |
| 10 | Orchardist | Tree species owned | 3 / 7 / 14 | F |
| 11 | Grove Keeper | Same-species groves formed | 1 / 4 / 10 | F |
| 12 | Heirloom Keeper | Heirloom trees | 1 / 5 / 15 | F |
| 13 | Busy Bees | Honey collected | 20 / 200 / 1,000 | F |
| 14 | Zoologist | Animal collections | 100 / 1,000 / 5,000 | F |
| 15 | Nursery | Babies raised to adults | 3 / 15 / 50 | F |
| 16 | Blue Ribbon | Blue-ribbon animals | 1 / 5 / 15 | F |
| 17 | Full Barnyard | Animal species owned | 3 / 6 / 10 | F |
| 18 | Name Game | Animals you named | 3 / 15 / 40 | P |
| 19 | Gentle Hands | Animals you petted | 100 / 1,000 / 5,000 | P |
| 20 | Best Friends | Days your pet was fed | 7 / 30 / 100 | P |
| 21 | Home Cooking | Goods crafted | 50 / 500 / 2,500 | F |
| 22 | Recipe Box | Different recipes made | 10 / 50 / 117 (all) | F |
| 23 | Master Chef | Recipes at ★3 | 1 / 5 / 15 | F |
| 24 | Mill Runner | Feed made | 100 / 1,000 / 5,000 | F |
| 25 | Hamper Maker | T4 goods made | 5 / 50 / 250 | F |
| 26 | High Roller | Coins earned | 100,000 / 5,000,000 / 50,000,000 | F |
| 27 | Good Business | Orders filled (simple ¼) | 25 / 250 / 1,000 | F |
| 28 | Captain's Friend | Barge rows completed | 3 / 25 / 100 | F |
| 29 | Full Steam | Weeks in a row with a barge row | 2 / 6 / 12 | F |
| 30 | Market Savvy | Demand-of-the-day units sold | 20 / 200 / 1,000 | F |
| 31 | Wishful Thinking | Different things bought through the Wishlist (v2.1: a count of purchases was a 10-coin buy-and-sell loop) | 3 / 8 / 15 | F |
| 32 | Clearing the Way | Debris cleared (regrows) | 25 / 150 / 400 | F |
| 33 | Room to Grow | Expansions bought | 1 / 6 / 15 | F |
| 34 | Builder | Buildings built or slots added | 5 / 20 / 50 | F |
| 35 | Picture Perfect | Farm Beauty stars | 2 / 4 / 5 | F |
| 36 | Showcase | Beauty Showcase points | 500 / 2,000 / 6,000 | F |
| 37 | Collector | Collection sets completed | 1 / 6 / 12 | F |
| 38 | Album Pages | Collection items found (v2: farm, was "Lucky Find" personal) | 10 / 30 / 60 | F |
| 39 | Restorer | Restoration bundles completed | 4 / 12 / 24 (v2: was 27 of 24) | F |
| 40 | Hollow Reborn | Restoration projects completed | 1 / 3 / 6 | F |
| 41 | Crop Master | Crops at ★3 | 1 / 6 / 21 | F |
| 42 | Golden Touch | Items at Gold ★ | 1 / 5 / 15 | F |
| 43 | Fair Contender | Best County Fair medal | Bronze / Gold / Platinum | F |
| 44 | Fair Regular | Fair weeks with any medal | 4 / 15 / 40 | F |
| 45 | League Climber | Highest NPC league | 2 / 4 / 5 | F |
| 46 | Season Ticket | Seasonal Ribbon Track tiers (lifetime) | 30 / 90 / 240 | F |
| 47 | Festive | Festivals with the final prize claimed | 1 / 4 / 10 | F |
| 48 | Almanac Reader | Almanac tasks completed | 50 / 500 / 2,500 | P |
| 49 | Farm Weeks | Best weekly streak (v2: weeks with ≥ 2 play days, was daily) | 4 / 12 / 52 weeks | F |
| 50 | Farmer's Calendar | Days played (lifetime, not consecutive) | 7 / 60 / 200 | P |
| 51 | Level Up | Farm level | 10 / 25 / 40 | F |
| 52 | Seasoned Farmer | Personal level | 10 / 25 / 40 | P |
| 53 | Helping Hands | Partner's help flags you filled | 10 / 100 / 500 | T |
| 54 | Love Letters | Keepsakes you gave | 10 / 75 / 300 | P |
| 55 | Duet | Duet recipes cooked together | 3 / 30 / 150 | T |
| 56 | Teamwork | Giant crops, big stumps and boulders felled together | 3 / 25 / 100 | T |
| 57 | Golden Hour | Golden Hours together | 3 / 30 / 100 | T |
| 58 | High Five | High-fives | 10 / 100 / 500 | T |
| 59 | Side by Side | Hours with both players online | 5 / 50 / 250 | T |
| 60 | Our Story | Memory Book pages | 10 / 40 / 100 | T |
| 61 | Equal Partners | Weeks where both loaded a crate of a completed barge row | 2 / 10 / 30 | T |
| 62 | Combo Kings | Together Combo actions | 500 / 5,000 / 25,000 | T |
| 63 | Village Builders | Town Projects completed | 1 / 8 / 24 | F |

**Hidden ribbons** (single tier, revealed when earned; 3 Acorns each): *Scarecrow's Day Off* (place 10 scarecrows) ·
*Pumpkin Royalty* (a blue-ribbon pumpkin during the Harvest Festival) · *Early Bird* (harvest before 07:00) · *Night
Owls* (both online after midnight) · *Chicken Whisperer* (name 12 chickens) · *Thank You!* (50 thanks sent) · *Clean
Sweep* (harvest 50 plots in one drag).

Display: the Ribbon Wall in the farmhouse (tiers unlocked by Ribbon Points: 10 frames, 25 the farm-gate arch, 60 the
golden scarecrow, 120 the ribbon-bunting fence), a ribbon count on each name card, and a toast for both players
("Unlocked together!") for F and T ribbons. Every Gold tier is reachable (R11).

### 5.5 Collections (L10)

12 sets × 5 items. Each eligible action rolls **2 %** (×2 for Gold-mastered sources) for a missing item of the action's
set; **pity**: after 40 eligible actions without a new item of that set, the next eligible action drops one.
Duplicates (possible only on Gold-doubled rolls) trade 3 → 1 missing item of the same set at the Collector's table.
Completing a set: **5 Acorns**, a display piece (decor) and a small permanent perk. The album records who found
each item.

| Set | Found by | Items | Perk on completion |
|---|---|---|---|
| Grandma's Recipe Cards | crafting any recipe | Bread card, Jam card, Pie card, Soup card, Cake card | +2 % craft XP |
| Garden Butterflies | harvesting flower crops, flowering trees | Cabbage White, Peacock, Swallowtail, Blue Morpho, Monarch | Butterflies around the farm, +20 beauty |
| Lost Tools | clearing debris, chopping | Rusty Trowel, Old Pitchfork, Brass Oil Can, Horseshoe Nail Tin, Grandpa's Pocket Knife | Chopping needs 1 fewer chop (min 3) |
| Feathers | chickens and ducks | Speckled, Barred, Copper, Golden, Peacock Feather | +2 % bonus-egg chance |
| Heirloom Seeds | harvesting crops ≥ 4 h | Purple Carrot, Moon Melon, Blue Corn, Black Tomato, Striped Beet seed tins | Seeds −3 % |
| Pond Treasures | duck pond collects, Fishing Dock casts (§6.2 mechanic 21) | Sea-glass, Snail Shell, Old Bottle, Frog Figurine, Silver Spoon | +20 beauty, dock fish animation |
| Fossils & Arrowheads | rocks, boulders, truffle digs | Ammonite, Trilobite, Arrowhead, Shark Tooth, Fern Fossil | +5 % bonus-truffle chance |
| Honey Jars | beehive collects | Clover, Apple-blossom, Lavender, Sunflower, Heather Honey jar | Hive forage radius +1 |
| Buttons & Thimbles | Weaver's Shed and Sewing Table crafts | Wooden Button, Brass Button, Thimble, Pincushion, Silver Needle | Sewing −3 % time |
| Fair Rosettes | Fair entries | Yellow, Red, Blue, Purple, Rainbow Rosette | Fair points +3 % |
| Old Coins | Market Stand sales: **one roll per 100 coins sold** (min 1 per sale; v2, C8) | Copper Penny, Silver Sixpence, Old Florin, Gold Sovereign, Lucky Coin | Market Demand cap 50 → 60 units |
| Love Notes | co-op actions (help fills, keepsakes, high-fives, Golden Hour) | First Note, Pressed Flower, Ticket Stub, Polaroid, Ribbon-tied Letter | Golden Hour +5 min |

### 5.6 County Fair (weekly, L14)

- **Week**: Monday 00:00 → Sunday 20:00 (farm time zone); results ceremony Sunday 20:00 on both screens (queued for
  the absent partner).
- **Weekly target** (v2, wave-2 QA D2) `W = nice(E(L_monday) × 0.16 / 100)` points, frozen at Monday's farm level. The
  formula departs from the earlier 0.3 to meet the stated outcome below: measured on the real rules
  (`node tools/real-sim.mjs --checks`), 0.3 gave the reference couple Bronze nine weeks in ten.
- **Points** (v2: one decimal, no rounding quirk): blue-ribbon crop harvest = plot gross / 100; blue-ribbon fruit = 3 +
  V/100; blue-ribbon animal good entered = 2 × V / 100; **Fair entries** — at the Fair tent (panel), enter any T3/T4 or
  duet good: points = V / 100, **duet goods × 2**, hampers (T4) × 2 from L32, at most 10 entries of one item per week
  (variety beats spam). Entries consume the goods (a goods sink).
- **Medals** (fraction of W): Bronze I/II/III 0.20/0.35/0.50 · Silver I/II/III 0.60/0.70/0.80 · Gold I/II/III
  0.90/1.00/1.15 · Platinum 1.40 (Platinum requires Restoration project 5, Town Fair Grounds).
- **Rewards** (v2, M5 modified): a medal pays **1.5 × the value of its threshold** (fraction × W × 100 coins × 1.5) — the
  same rate as an order, so entering goods is as good as filling orders and better than the market, while the free
  points of blue-ribbon harvests sweeten it. Silver adds 2 Acorns, Gold 4 Acorns + trophy, Platinum 6 Acorns + champion
  banner + a **24 h Golden Hour** buff starting Monday.
- Simulated: the reference couple wins Silver or better in about 9 weeks of 10 and Gold in about half; daily players
  mostly Gold III.
- **NPC league** (L27): five NPC farms (Brambleton, Oakhurst, Mill Creek, Cobble Hill, Fennimore) with weekly scores
  `W × (0.6 + 0.7 × hash01(farmSeed, week, npc))`. Five leagues; top 2 promote, bottom 1 demotes; league tier × 1
  Acorn per week. The couple always competes **together** against NPCs, never against each other. *Wave 3*: the
  leagues are Hedgerow, Meadow, Orchard, Valley and County; a farm starts in the first; the County League needs
  Restoration 5. A Monte Carlo of the ladder for the reference couple (weekly points ~ N(0.92 W, 0.25 W)) reaches
  League 2 in a median 3 weeks, League 4 in 14 and League 5 in 27 (97 % of runs within two years): the League
  Climber ribbon's Bronze, Silver and Gold. A per-league NPC step was tried on paper and dropped (League 4 fell out
  of reach).
- **Horse show** (L25, M2 feature `horse_show`): a blue-ribbon horse's Show Ribbon entered counts double — only once
  the horse show exists (wave-2 QA RC-16).
- **Ceremonies missed**: each farmer keeps up to 4 unseen ceremonies and sees them oldest first (wave-2 QA RC-14).

### 5.7 River Barge (weekly, L15)

- Captain Reed docks Monday 06:00 and casts off Sunday 20:00. Tapping the empty jetty on Sunday night previews next
  week's goods.
- **Rows offered** (v2, H3; wave-2 QA D2): **one row of 3 crates per 3 hours played last week** (1–3 rows; the
  reference couple's 3 hours give 1). Each crate is one item × quantity worth **E × 0.08 h**, the quantity capped by
  **30 minutes of one producer** (a building one item at a time, the animals or trees owned, a third of the plots; the
  earlier 0.3 h / 6 h gave 0–1 full rows in 10 casual weeks on the real rules, 0.12 h / 1 hour 4–6; final pass
  2026-10-04: 0.08 h / 30 min give 6–10, seeds 1–7, 11, 23);
  items come from goods the farm **made in the last 14 days** (T2–T4, long-cycle crops, fruit, slow animal goods),
  plus at most one crate a week of a crafted good the farm **can make but has never made** (as likely as a made one:
  every recipe gets asked for, wave-2 QA RC-15; the earlier weight × 3 filled most stuck rows with T4 goods nobody had
  made yet, and orders still ask for never-delivered goods 4 ×); never two crates of items sharing a direct input; G-VALID applies. A load or flag
  names the manifest week and the item the player saw: a stale one from last week answers "not found" (RC-07).
- **Pay**: each crate on loading: 1.6 × V × qty coins (+5 % per adult horse, max +20 %) and XP = 0.2 × coins / 8. Each
  **completed row**: E × 0.25 h coins (+25 % after the Riverbank expansion) + 1 Acorn + **a third of the Captain's
  chest** of the current ladder tier t (1–5): (1 + t) Acorns, 3t Compost, a decor roll from tier 3. A week with every
  offered row loaded raises t by 1; a week without lowers it by 1 (never below 1).
- **Help flags** on up to 3 crates (§6.2 mechanic 3). **Equal Partners**: if both players loaded at least one crate of a
  completed row, that row's chest share gets +1 decor roll.
- Unloaded crates at cast-off simply leave; nothing is lost or penalised. Measured on the real rules: 6–10 full rows in
  10 weeks for the casual couple (`tools/real-sim.mjs`, final pass 2026-10-04).

### 5.8 Daily and weekly systems

| System | Unlock | Rule |
|---|---|---|
| **Daily Gift calendar** | L3 | A 28-day farm calendar claimed by either partner once per **play day**. Missing a day **pauses** it (never resets). Days 1–6, 8–13, 15–20, 22–27: coins E × 0.1 h, or 3 Compost (every 3rd day), or a seed packet (every 5th). Days 7/14/21: 2 Acorns; day 14 also a decor; day 28: 5 Acorns + a seasonal decor. |
| **Farm Weeks** (v2, G3) | L3 | The streak counts **weeks** in which the farm was played on at least 2 days (either partner, ≥ 5 minutes). One free "skip week" per 4 streak weeks, at most 2 held, used automatically. Breaking it costs only the counter. Milestones 4 / 12 / 52 / 104 weeks upgrade the farm-gate signpost (cosmetic). |
| **Daily Almanac** | L3 (wave-2 RC-01; was L8) | Per player: 4 personal micro-tasks (2–8 min each, from templates: harvest N of a crop, collect N, craft 1–3, fill 1 order, water N, pet 3 animals, clear 1 debris, enter 1 Fair good…) that **refresh when completed**, done **one at a time** (wave-2 QA RC-12: the live task is slot `done mod 4`, so the login sweep finishes at most one and the four spread across the evening). v2 (C1c): **only the first 4 completions per player per day pay**, each coins E × 0.02 h and XP E × 0.02 h / 8, no doubling; later ones count for the ribbon only. v2 (C3): the two players' tasks are **complementary** (different crops, buildings or animals, never the same target class), and while both are online an action by either counts for both players' tasks of that type. Finishing the day's first 4 opens a Daily chest: 3 Compost + a collection roll (a part whose system is not unlocked yet is left out; a chest left empty pays E × 0.1 h in coins). Plus 1 shared **Together task** (≈ 15 min of play for two, e.g. "Harvest 60 crops together") fed by both players' actions: 2 Hearts each + 1 Compost. One free reroll per player per day. |
| **Couple Challenge** | first Monday after L6 | A weekly goal sized to ~2 engaged hours of the reference couple (templates: harvest N, collect N, craft N different recipes, fill orders worth E × h, load N crates), counted by **value or production**, never by order count. G-VALID at roll time: "craft N different recipes" asks for min(8, recipes the farm can make now) and is skipped below 4; animal goods need 4 adult animals (wave-1 QA RC-16). Reward 3 Acorns + a decor piece + 5 Hearts to each contributor; an "Equal Partners" sticker if both gave ≥ 10 %. Sized to be finishable alone. |
| **Mabel's weekly meter** | L5 | §5.2. |
| **Townsfolk board** | L21 | §5.3. |
| **Market Demand** | L11 | §4.10. |
| **Morning recap** | L1 | "While you were away": what ripened, what the partner did (from the feed), keepsakes and notes waiting, **new unlocks this player has not seen** ("3 new things — Show me"), story beats to watch, the Fair and barge status. One card, dismissed with one click. |
| **Golden Hour** | L4 | Once per **together session** (at least 8 h after the last one; v2, G3: was once per real day) (§6.2 mechanic 9). |

### 5.9 Long-term systems

**Restoration Ledger (L16).** Six projects in order; each has 4 bundles; each bundle is "any N of M" slots so no
single item can block it (Stardew's choice rule). Either partner can donate any item, piece by piece; donor avatars show
on each slot; the whole farm gets the permanent reward. Coin slots are priced in hours of E at the project level (v2,
H4): Glass & Frames' coin slot = E(16) × 0.5 h.

| # | Project (from) | Bundles (any N of M) | Permanent reward |
|---|---|---|---|
| 1 | **Old Greenhouse** (L16) | Seedlings 5 of 7 (20 Wheat, 20 Carrot, 10 Corn, 6 Strawberry, 9 Tomato, 6 Potato, 2 Pumpkin) · Glass & Frames 3 of 3 (12 Planks, 2 Wooden Crates, E(16) × 0.5 h coins) · Orchard Gift 3 of 6 (10 Apple, 8 Cherry, 8 Orange, 8 Lemon, 4 Apple Juice, 2 Cherry Jam; wave-2 QA D2: the farm has no citrus when the bundle asks) · Kitchen Garden 3 of 5 (3 Veggie Soup, 2 Pumpkin Soup, 2 Coleslaw, 3 Ketchup, 2 Sauerkraut) | **Greenhouse** (6 × 4 tiles, 12 plots inside, beyond the plot cap): always in season (−10 % time, +10 % sell) |
| 2 | **Mill Wheel** (L19) | Grain 4 of 5 (30 Wheat, 20 Corn, 15 Oats, 6 Sunflower, 10 Sugarcane) · Bakehouse 3 of 5 (6 Bread, 3 Corn Bread, 3 Cookies, 2 Blueberry Muffins, 2 Granola Bars) · Millwright 2 of 2 (16 Planks, 4 Wooden Crates) · Dairy 3 of 4 (8 Milk, 4 Butter, 3 Cheese, 3 Yogurt) | Feed Mill and Windmill recipes **−20 % time** |
| 3 | **Stone Bridge** (L22) | Timber 2 of 2 (24 Planks, 6 Wooden Crates) · Woolly 3 of 4 (6 Wool, 6 Yarn, 2 Scarves, 1 Sweater) · Sweet 3 of 5 (3 Strawberry Jam, 3 Cherry Jam, 3 Marmalade, 3 Honey, 2 Ice Cream) · Fair Prizes 2 of 3 (3 blue-ribbon crops, 1 blue-ribbon animal good, 1 blue-ribbon fruit) | **Hollow Meadow**: 2 extra parcels beyond the north-west edge, a wildflower meadow (forage ×3), +6 plot cap |
| 4 | **Orchard Pond** (L25) | Fruit 4 of 6 (10 Apple, 10 Cherry, 10 Peach, 10 Pear, 10 Plum, 10 Lemon) · Pond 3 of 4 (10 Duck Eggs, 2 Custard, 2 Lemon Meringue Pies, 1 Golden Feather) · Press 3 of 4 (4 Apple Juice, 4 Orange Juice, 4 Lemonade, 3 Pear Nectar) · Candles 2 of 3 (3 Honey Candles, 3 Lavender Candles, 2 Lavender Soap) | Irrigation: all trees **−10 % cycle** |
| 5 | **Town Fair Grounds** (L28) | Pies 4 of 6 (2 each of Apple, Cherry, Pumpkin, Blueberry, Peach Cobbler, Plum Cake) · Textiles 3 of 4 (2 Sweaters, 2 Picnic Blankets, 1 Quilt, 2 Wool Pillows) · Hampers 2 of 3 (1 Breakfast Hamper, 1 Picnic Basket, 1 Spa Basket) · Livestock 3 of 4 (1 each: Golden Egg, Cream-Top Milk, Silk Wool, Black Truffle) | Fair **Platinum** tier, NPC league top league, +1 Fair entry per item per week |
| 6 | **Grandma's Farmhouse** (L34) | Comfort 3 of 4 (2 Quilts, 2 Alpaca Shawls, 3 Honey Candles, 2 Wool Pillows) · Larder 4 of 6 (2 Truffle Oil, 2 Maple Syrup, 2 Olive Oil, 3 Plum Jam, 2 Pickled Peppers, 2 Goat Cheese) · Sweets 3 of 4 (2 Maple Fudge, 2 Wedding Cakes, 3 Cookies, 2 Walnut Honey Cakes) · Woodwork 3 of 3 (30 Planks, 8 Wooden Crates, 2 Toy Horses) | Farmhouse **interior decorating**, the Memory Book wall, Grandma's duet table (+1 Kitchen slot), **Grandma's visit** (story beat, quest E10) |

**Town Projects — the Hollow Village (v2, H4 + A5; from L20).** Across the river lies a sleepy village. One project
at a time: Ollie posts it, the couple donates a **goods bundle worth about E × 2 h** (three goods the farm made in the
last 14 days **and can make now** — crafted goods, animal goods or fruit, never raw crops; each good at most **2 hours
of the producers the farm owns** (one cycle at least), snapshot at posting: wave-2 QA RC-02, 798 Milk was 798
producer-hours; final pass 2026-10-04: 4 hours let four Sweetheart Cakes or 72 Eggs hold the first project past L23 on
the real rules; donated piece by piece) and funds **E(L) × (10 +
0.5 (n − 1)) hours** of coins; the project is **built the next day**, adds a landmark to the decorative ring (ferry
landing, chapel, bandstand, school, lighthouse, carousel, bakery, mill pond bridge, library, flower market… 24
authored), **5 Acorns**, a souvenir decor and a Memory Book page, and lights up at night. After the 24th, repeatable
**Festival Pavilion** tiers continue at the same formula (wave 3: project n ≥ 25 is Pavilion tier n − 24, with 5
Acorns and a Memory Book page; the souvenir comes with the first tier; eight named tiers, the last repeats). This is the late-game coin and goods sink: simulated, the
reference couple completes 13 projects by L40 and its treasury never sits on more than 15 hours of income.

**Farm Beauty (L18).** Score = Σ decor beauty (2nd copy 50 %, later 25 %; +10 % touching a path; decor sets +25 %;
Masterwork × 1.5 / × 2) + 3 per building + 2 per tree. Stars: 1★ 50 · 2★ 150 · 3★ 400 · 4★ 900 · 5★ 1,800 · then
**Showcase points** (= score − 1,800) for ribbons. Each new star: 3 Acorns and **+1 % order coins** (max +5 %).
Recomputed on every placement (pure function).

**Seasonal Ribbon Track (L24).** One free 30-tier track per real season. Points = XP earned; each tier needs
`nice(1 × XP/h at the farm level when the season started)` (v2: ≈ 1 hour of play per tier, so the reference couple, who
plays ~39 hours a season, finishes in about 10 weeks; daily players finish early). Rewards: decor, outfit pieces, Golden
Seed Packets, Acorns (5 at tiers 10/20/30), a season-exclusive animal coat. Points left at season end convert to coins
(E × 0.05 h per unfinished tier's worth). *Wave 3* (`SEASONAL_TRACK.rewards`, one per tier): Hearts each (for the
outfit pieces, §4.11), Compost, seed packets, coins (1.4 E-hours over the whole track), the season's planter (tier 5),
a Season Pennant (15), the season's coat (25: blossom / sunkissed / russet / frost, worn by one animal the couple
picks), and the Season Ticket Trophy with the last 5 Acorns (30).

**Legacy levels (after 40).** Flat XP per level (the L39 → 40 requirement, ~10–13 hours of play); every Legacy level pays
10 Acorns or a Golden Seed Packet or a cosmetic from a rotating pool. No empty levels, ever. *Wave 3* (`LEGACY.pool`, in
turn from L41): 10 Acorns, a Golden Seed Packet, 10 Hearts each (the outfit piece, §4.11), 10 Acorns, a Legacy Statue
(the "statue variant": a bronze farmer whose plaque shows the level).

**The farmhouse interior (Restoration 6, wave 3).** When Grandma's Farmhouse is complete the couple can go inside: a
10 × 8-tile room (rugs on a floor layer under the furniture, pictures on 10 + 8 wall slots) with its own fixed pieces —
the Memory Book wall, the Ribbon Wall, the keepsake shelf, the garden window, the hearth and Grandma's duet table (the
+1 Kitchen slot). A catalog of 32 pieces (seating, tables, comfort, kitchen, music, lights and plants, rugs, walls)
costs E(34) × 0.008–0.15 h each, about 1.4 hours of income for the lot: a late-game coin sink that never competes with
land or buildings. Furniture is cosmetic (no XP, no beauty, no production) and never sold; a piece never placed is
refunded inside the 10-minute undo.

**Grandma's visit (E10, wave 3).** When the farmhouse project completes, Grandma Hazel arrives (the story beat
"Grandma Comes Home") and stays **three days**: she strolls between the porch, the field, the orchard, the barnyard,
the bench and the parlour, an hour at each (from the server clock, so both screens agree), with two lines of her own at
every stop. On leaving she gives her portrait for the parlour wall and a letter for the Journal; a farmer who missed
her gets a card that says so.

**Memory Book.** Auto-captured pages with a canvas snapshot (rendered then `toBlob` in the same task) and a caption:
first harvest together, the farm's name, each named animal and pet, every 5th level, first blue-ribbon animal, each
Restoration project, each Town Project, each Platinum Fair, festival finals, anniversaries of the farm, and a **season
postcard** auto-page every real season (A6). Manual pages from photo mode. Shown in the farmhouse and the Journal.

### 5.10 Seasons, festivals and weather

- **Seasons** follow the real calendar (§3.1 table): in-season crops; palette skins (spring blossoms, summer deep
  greens, autumn ochre grass and orange maples, winter snow on up-facing surfaces).
- **Festivals** (7–10 days, data-driven yearly schedule, all return every year; missed decor appears in the shop for
  coins after the event). Sized for the reference couple: **three evenings of a festival reach step 6 of 8, four or more
  reach step 8**:

| Festival | Dates | Event crop / recipe | Prize ladder (8 steps, Festival Tickets) |
|---|---|---|---|
| Sweethearts' Fair | Feb 7–16 | Heart Strawberry (event variant, 1 h) · Sweetheart Cake counts double | couple outfits, Heart Arbor variant, 10 Acorns |
| Spring Bloom | Apr 10–19 | Tulips (2 h, flower, forage) · Flower Crown (Sewing, 1 h) | tulip beds, bunny topiary |
| Summer Fair | Jul 10–19 | Sweet Corn (20 min) · Corn on the Cob (Kitchen, 20 min) | bunting, carousel horse statue |
| Harvest Festival | Oct 20–29 | Giant Pumpkin seeds (24 h, always giant-eligible) · Caramel Apples (Kitchen, 45 min) | scarecrow family, hay maze, autumn outfits |
| Winter Lights | Dec 15–24 | Gingerbread (Bakery, 1 h) · Mulled Juice (Juice Press, 30 min) | Kenney holiday kit decor, snowman, lights |
| Farm Anniversary | farm creation date, 3 days | Anniversary Cake (duet) | Memory Book frame, statue of the couple; Grandma's letter |

  Festival items are priced by the same formulas (§4.3) and are orderable only while their festival runs (ruling X7b).
  Tickets come from festival orders (1 per order) and festival recipes (1–3 each).
- **Weather** (pure function `weatherAt(farmSeed, hourIndex)`, shared by both players): sunny 70 %, cloudy 15 %, light
  rain 12 %, windy 3 % (snow replaces rain in winter, cosmetic). **Rain waters**: at the start of a rain hour every
  growing, unwatered crop of ≥ 30 min and every tree is watered (the base −15 %/−20 %), and anything planted during
  rain is watered at planting. The partner tend still adds its −5 %. Windy: sway ×1.6, no rule effect.
- **Day/night** is cosmetic (§8.4): no rule depends on time of day except the hidden *Early Bird* and *Night Owls*
  ribbons and the 6-hourly golden order.

---

## 6. Co-op design

### 6.1 Ownership

| Thing | Shared or personal | Rule |
|---|---|---|
| Land, plots, crops, trees, animals, buildings, decor | **shared** | Equal co-owners; no host, no leader, no "ask your partner". The always-on server is the host. |
| Coins (Farm Treasury), Acorns | **shared** | Made safe by the Wishlist, BIG_SPEND heads-up, 10-minute undo and the ledger (§6.3). |
| Barn inventory and overflow | **shared** | "Keep N" locks protect plans (§6.3). |
| Farm XP and Farm Level | **shared** (sum of both) | Content unlocks are always equal for both. |
| Personal XP, Personal Level, titles (perks M2) | **personal** | Identity; perks affect only your own actions. |
| Hearts, wardrobe, emotes, titles, name card, **your pet** | **personal** | Your own spending money that can never compete with the farm; one pet each (v2, A3). |
| Mastery, collections album, quests, Restoration, Town Projects | **shared**, actor credited | Both players' actions count; the album, bundles and projects show who did what. |
| Achievements | F shared · P personal (uncontested verbs only) · T together | §5.4 |
| Almanac | 4 personal, complementary tasks each + 1 shared Together task | §5.8 |
| Daily gift, Farm Weeks | farm-wide; a week counts if either plays | No guilt for the partner who skipped a day. |
| Story beats, unlock cards | shared progress, **per-player "seen" flags** (v2, C7) | Watch together or later; replayable; the recap lists unseen unlocks. |
| Named animals, the farm's name | shared, the name tag records who named them | The farm is named together at minute 0 (§7.4). |
| Decor placement | shared, with optional **pin** per item | §6.3 |
| Camera, settings, tool selection, chosen seed, UI layout | personal (localStorage / per-session) | |

### 6.2 Co-op mechanics (21), with exact numbers

Every mechanic says what it is, why together is better, the solo path, and the exploit guard. All bonuses that need
"the other player" compare the acting player id with the stored one on the server (`SELF_ONLY`), and all daily caps
are period counters (tech §4.5). **v2 rule R17: every partner bonus is an extra on top of a base that anyone gets**,
so no rational player ever leaves work for the partner (C2). The **M1** column marks the *felt* mechanics shipped in
M1a/M1b; the rest follow in M2 (P2).

| # | Mechanic | Rule and numbers | Solo path | Guard | M1 |
|---|---|---|---|---|---|
| 1 | **Live presence** | Both avatars, name tags, partner's cursor ring (their colour), the partner's "hand of wind" bends crops, the partner's build ghost; relayed at 15 Hz, interpolated 120 ms | — | presence never touches the economy | yes |
| 2 | **Pings, emotes, notes** | Ping (middle-click / G): bouncing marker + chime on both screens, off-screen arrow, 1 per s. 8 free emotes (wave, heart, laugh, thumbs-up, come-here, cheer, high-five, dance). Notes pinned to a tile persist for the offline partner. | notes are the async channel | rate limits; text is `textContent` only | yes |
| 3 | **Help flags** | Flag an order, barge crate, townsfolk request or bundle slot "Need help". Anyone may fill it for the normal reward; when the *other* player fills it: +10 % XP on it and **+1 Heart each** (a bundle slot counts only when the helper gave more than half of it: one token unit is no help, wave-2 QA RC-13) | fill it yourself (normal reward) | no bonus for self-fill | yes |
| 4 | **Partner tend** (v2) | Anyone waters at the full base (crops −15 %, trees −20 %); once per cycle the *other* player adds **−5 %** more. +1 Heart per partner-tend stroke (max 10 a day) | the base effect | bonus keyed on planter/last harvester ≠ tender | yes |
| 5 | **Teamwork harvest** | Harvesting a crop the partner planted: personal XP 40 % to the planter, 60 % to the harvester (both earn); +1 Heart each per stroke (max 10 a day) | you get 100 % of your own | at most once per planting stroke | yes |
| 6 | **Together Combo** | When both players do a productive action (harvest, tend, collect, craft-collect) within 3 s of each other on objects within 8 tiles: every such action gets **+10 % XP** and fills the combo meter. While a combo is active a lost race shows **no toast**: the lost plot's floater becomes a small shared heart spark ("together!") and the meter still counts it (v2, C6). Daily meter rewards: 25 → 1 Compost, 50 → a collection roll, 100 → 3 Compost + 1 Heart each. The XP bonus applies to at most 300 actions a day. | none needed | server time and object positions | yes |
| 7 | **Duet recipes** | Sweetheart Cake (L10), Harvest Feast (L15), Wedding Cake (L25), festival duets: both press "Cook together" at the building within **3 s** → normal time, +25 % XP, +1 Heart each, Memory Book offer. The Hearts, the Duet ribbon count and the together deed are paid when the cooked good is **collected**, once (a duet cancelled before it starts pays nothing; wave-1 QA RC-02). Duet goods: 1 golden order in 3 asks for one (2.0 × V), Fair × 2 points | "slow-cook" alone in 2 × time, normal XP | joint slot `{by, at}`; two distinct players; window on server time | yes |
| 8 | **Giant crops** (L20) | A 3 × 3 block of one crop, all composted and planted within one minute, has a **20 % chance** — keyed on the block's anchor plot and its harvest count; a roll stamps all nine plots, and a
block holding a plot already tried this cycle never rolls again (no re-rolls by moving plots, wave-2 QA RC-06) — to
ripen as one Giant: yield **2 × 9 × (yield + 1)** units (v2, X3: was 1.5 × 9 × yield, a loss for the iconic pumpkin) plus the 9 blue-ribbon rolls, +25 Fair points, a trophy-sized mesh. Felling it takes 60 hp: each chop 10, or **15 if the previous chop was by the other player within 2 s**. Felled
together, its nine harvests and its Fair points are shared by chop share (wave-2 QA RC-09). Big stumps and boulders on expansions use the same chop rule. | 6 chops alone | combo only with two distinct players; R13 | M1b |
| 9 | **Golden Hour** (L4) | Once per **together session** (≥ 8 h after the last; v2, G3), both avatars sit on a two-seat bench (Sunset Bench, Porch Swing, Gazebo, Sweetheart Arbor, Koi Pond, Treehouse, Arbor of Lights; a farmer sits only when their avatar stands within 3 tiles of it, as the server sees it, wave-1 QA RC-31) for **10 s**: for **30 min** (40 at the Sunset Hill gazebo, +5 with the Love Notes set) everything *started* — crops planted, animals fed, recipes queued — takes **10 % less time**. +1 Heart each, Memory Book page offered. | none — the one purely together bonus; nothing requires it | period counter | yes |
| 10 | **High-five** | Both press the high-five emote within **1.5 s** with avatars within 2 tiles: a "Spark" gives both **+10 % personal XP for 10 min**; 30-min cooldown; +1 Heart each for the first 3 a day | — | cooldown; server-observed `near` | yes |
| 11 | **Keepsake gift** (v2, C9) | Once a day each player wraps a keepsake for the partner: a bouquet from a flower crop or a farm-produced good. It goes to the partner's **keepsake shelf** in the farmhouse (and the Memory Book), leaves the Barn (a small goods sink), and gives **+1 Heart each**. No coins: a gift from a shared barn to a shared barn used to be pure minted money. | — | first gift per giver per day; only produced goods | yes |
| 12 | **Partner bottle** (v2) | Anyone's Baby Bottle cuts 30 % of the remaining growth; once per baby per hour the *other* player's bottle cuts **20 % more** | your bottles at 30 % | once per baby per hour | M2 |
| 13 | **Petting together** | A drag pets everything under the stroke; a pet lasts the real day: +10 % bonus-product chance, **+20 % if both petted** it | +10 % alone | once per player per animal per day | M2 |
| 14 | **Pets' treasure** | If both players petted both pets in a day, they dig up a second find next morning | each pet's normal find | once per day | M2 |
| 15 | **Together task** (daily) and **Couple Challenge** (weekly) | One shared counter fed by both. Together task: 2 Hearts each + 1 Compost. Couple Challenge: §5.8 | sized to be finishable alone | counters count produced goods and value, never order counts | M1b |
| 16 | **Barge "Equal Partners"** | Both loaded ≥ 1 crate of a completed row → +1 decor roll in that row's chest share | the barge pays everything else | — | M2 |
| 17 | **Unlock tours** (v2, C7) | Each player gets their own "3 new things — Show me" tour for unlocks that arrived while they were away | — | per-player seen flags | yes |
| 18 | **Welcome back** | The returning partner gets the recap card, the unlock tour, the partner's notes and keepsakes (rested XP in M2) | — | personal XP only | yes |
| 19 | **Story beats together** | "Watch together?" when both are online; otherwise queued and replayable | queued beat | per-player seen flags | yes |
| 20 | **Memory Book and photo mode** | Auto pages and manual snapshots; *Together pose* (hold hands, bench, high-five) when avatars are within 2 tiles | solo photos | — | yes |
| 21 | **Fishing dock for two** (v2, A4; Willow Pond L21 or Fishing Dock decor L28) | Both avatars sit on the dock: a calm 20-s timing cast, once per hour each. Catches are Pond Treasures (collection), cosmetic fish trophies for the dock and a weekly "biggest fish" photo — never an economy item. *Wave 3* (`FISHING`): the bite comes 5–15 s into the cast; reeling within 0.4 s of it is perfect, within 1.2 s good, later still lands a fish (a better grade lifts the size); nine species from Roach to the Golden Carp (and Grandpa's old boot); casting at the same spot within 20 s of the partner is "fishing together" (+1 Heart each, once a day) | casting alone works (no "biggest fish together" photo) | once per hour per player | M2 |

Also: drop-in toast ("Mia arrived 🌻"), **Go to partner** (F or click their portrait), pointer trails while dragging,
"I'm on it" pins on orders, matching outfits in the Hearts shop, and the *Friendly Duel* (M2, opt-in, off by default:
a week-long "most pumpkins / pies / orders" duel; the winner gets a cosmetic crown on the name card for a week, both get
the participation decor). *Wave 3* (`DUEL`, L29): a duel runs to the Fair week's close; pumpkins count for whoever
**planted** the plot, pies for whoever queued them, orders for the filler (simple ¼), so harvesting the partner's
pumpkins scores for the partner and nobody gains by taking work away; a tie crowns both; both get 2 Hearts, the
pennant once.

### 6.3 Conflict resolution and anti-frustration rules

| Problem it fixes | Rule |
|---|---|
| Both click the same thing | The server applies actions in arrival order: **first wins**. The loser's prediction rolls back smoothly; a soft toast "Mia got there first ♥" (coalesced per 500 ms, never an error sound, and **no toast at all while a Together Combo is active**, §6.2 #6); the loser's floating "+N" fades instead of flying to the barn. Drag strokes are per-object: you get the plots you reached first. The Goal Tracker's different-domain bonus keeps the two of you apart most of the time. |
| "You sold the eggs I was saving" | **"Keep N"** (v2, P2: replaces per-player reservations): one farm-wide number per item. Selling, feeding or wrapping below it asks a soft confirm that names who set it ("Rowan keeps 5 Eggs for Custard. Use anyway?"). The Feed Mill and keepsakes skip kept items automatically. Using them in a recipe, order, bundle or quest needs no confirm. No expiry logic. |
| "You spent the money we were saving" | **Wishlist** (v2, P2: replaces Savings Jars, L9): add any shop item, deposit coins, it **buys itself when funded** (with a celebration on both screens). Coins on the Wishlist are excluded from the spendable balance. Withdrawing coins from the partner's wish asks them; if they are offline it auto-releases after 12 h with a notification. |
| Surprise big purchases | **BIG_SPEND**: any purchase above 25 % of the spendable treasury (and above 1,000 coins), or ≥ 10 Acorns in one purchase **or by one player in one day** (Hurry counts, ruling X7a), shows a confirm and a non-blocking toast on the partner's screen ("Rowan is buying a Pie Oven — 49,000"). A **Wishlist deposit** of that size counts too: it locks the treasury just the same (wave-1 QA RC-24). Transparency, not permission. |
| "Mia bought the hen I was buying" | Purchases carry the price on the buyer's screen; when the n-th-copy price rose meanwhile, the game asks again with the new price (soft code `PRICE`) instead of charging more (wave-1 QA RC-18) |
| "I bought / planted the wrong thing" | **10-minute undo** on every purchase and placement while the object is pristine (plot with no crop, building with an empty queue, animal never fed, tree never harvested): 100 % refund. **Uproot** inside the window refunds seeds (§3.1). Purchases grant no XP, so refunds never claw back anything. |
| Destructive actions | Selling an animal, demolishing, "sell all": double confirm, the object goes to a 10-minute trash and can be restored by either player. |
| "You moved my building / plots" | Every move of a building, plot or pinned decor has a 10-minute **"move back"** (v2); a pinned decor also needs a confirm to move or store, and the pinner gets a toast with one-click "move it back". |
| "You threw away my order" | Discarding an order the partner pinned "I'm on it" asks a soft confirm (v2). |
| "Who spent what?" | **Treasury ledger**: every coin movement with who, why and when, neutral wording, a weekly "Together we earned…" summary. |
| "I missed the story / the new stuff" | Beats wait or replay; unlock cards have per-player seen flags and a tour (§6.2 #17, #19). |
| One partner plays more | Shared Farm Level; the recap; no partner leaderboard (contribution split exists only on a Stats tab framed "Together we…"); personal level numbers stay off the portraits; Friendly Duel is opt-in. |
| The partner is away for a week | Nothing decays: no withering, no animal loss, orders never expire, barge crates simply leave, townsfolk requests simply leave, Fair points are not lost, Farm Weeks has skip weeks (leftover festival tickets and track points convert to coins). |
| "Can she play when his laptop sleeps?" | **Decision required before M1 (v2, C5)**: the server runs on an always-on machine (an old laptop, mini-PC or NAS — the data directory is portable) **or** the owner's laptop is set to ignore lid-close on AC power. The client keeps predicting for 30 s, then shows "The farm is asleep (Rowan's laptop is off)". Nothing is lost. Optional: Tailscale (already on the owner's machine) allows check-ins away from home with zero game code — the owner decides whether that is still "LAN". |

### 6.4 Activity feed

- Bottom-left, last 5 lines, fading after 8 s; full history (60 notable events) in the Journal. Every line carries the
  actor's colour and a **♥ Thanks** button (gives the actor 1 Heart; max 10 received a day).
- Coalescing: "Mia harvested 24 Wheat" (one line per stroke), "Mia tended 12 animals", "Rowan baked 3 Bread".
- Always shown: level-ups, unlocks, purchases over 1,000 coins (a building slot reads "added a slot to the Bakery", not
  "bought"), every Acorn spend (Hurry included), expansions, Wishlist deposits, withdrawals, release requests and
  answers (each naming the wished thing), Keep N changes, achievements, quest completions, keepsakes, notes, Golden
  Hour, giant crops, barge rows, Fair medals, Town Projects (wave-1 QA RC-20).
- The same feed builds the "While you were away" card for the partner who was offline.

### 6.5 Solo play

Nothing in the game requires the partner. Every Together mechanic is a bonus on top of a base anyone gets (§6.2, R17).
Weekly targets (Fair, barge rows, Couple Challenge, Mabel's meter, the townsfolk board) are sized for the reference
couple's ~3 hours a week, so a solo player at 60 minutes an evening reaches Gold and loads most crates. Quests never
need both. Duets slow-cook. Golden Hour is the only bonus with no solo version, by design: it is the ritual. Simulated:
a solo player at 60 minutes a day reaches L20 on day ~15 and L40 on day ~125 (Appendix E).

### 6.6 Three or four players

The farm supports up to 4 player slots and the data model keeps `players` generic, but v1 is **designed, tuned and
tested for two** (v2, P2). Shared and personal rules are unchanged with more players; "the other player" in §6.2 means
*any* other player; joint actions need any two distinct players. Weekly targets would scale by × (1 + 0.25 × (active
players − 2)) where "active" = played ≥ 30 min that week, frozen at Monday — untested until someone asks for it.

---

## 7. Moment-to-moment UX

### 7.1 Input model

- **One-handed**: everything works with the mouse alone (FV2's one-handed rule); keys are shortcuts only.
- **Smart Hand** (default tool): click does the obvious thing for the target — harvest ripe, plant **this player's
  chosen seed of this session** on an empty plot (otherwise the seed tray opens), water a growing crop that can be
  watered, tend an animal, collect a building tray, open a building's queue, shake a ripe tree, clear a weed, pet (a drag
  pets everything under the stroke). Shift + Hand uproots (§3.1).
- **Drag-paint**: a left-drag that **starts on an actionable target** paints the action of the first target across
  every target of the same kind under the stroke (empty plots → plant, ripe plots → harvest, growing → water, animals →
  tend, trees → harvest). The path is rasterised over tiles each frame (no skipped plots); each object is acted on once
  per stroke. A left-drag that starts on empty ground pans; right- or middle-drag always pans.
- **Tool modes** (tray at the bottom, keys 1–9): Hand · Seed Bag (crop chosen in the tray, shows counts, grow time, sell
  value, mastery stars) · Sickle · Watering Can · Feed Scoop · Basket · Compost Scoop · Axe · Hammer (build/move). The
  cursor becomes the tool (SVG data-URI cursors). Brush size follows the owned upgrade (1×1, 2×2, 3×3).
- **Build mode** (B or Hammer): grid fades in, ghost follows the cursor snapped to tiles, green when valid; invalid is
  red **plus** a hatched footprint and a ✕ badge with the reason ("Blocked by Mia's Coop"). R rotates, click places,
  Esc cancels. Moving keeps every timer and offers "move back" for 10 minutes. The partner sees your ghost live.

| Key | Action | Key | Action |
|---|---|---|---|
| 1–9 | tool / seed slots | B | build mode |
| H | Hand | M | Market (sell / store) |
| Q / E | rotate camera 90° | I | Barn |
| WASD / arrows | pan | O | Orders board |
| wheel | zoom toward cursor | J | Journal (quests, ribbons, album, ledger, feed) |
| R | rotate ghost | G | ping at cursor |
| F | go to partner | T | emote wheel |
| Space | centre on my avatar | P | photo mode |
| Esc | close top panel / cancel | F3 | debug overlay (fps, draw calls, RTT, pending) |

### 7.2 Action catalogue (input → feedback)

All feedback starts in the same frame (prediction, tech §3). Celebrations (level-up, achievement, quest complete,
together sparkle) wait for the server's confirmation (5–20 ms on a LAN), so nothing celebratory is ever taken back.
**Level-up and unlock cards are non-modal** (v2, C7): a banner plus a "New!" badge on the tray or panel, with "Show me"
on demand — a level-up never interrupts the partner's drag.

| Action | Input | Feedback (animation · particles · sound) |
|---|---|---|
| Hover anything | move | crops bend away from the cursor (shader); 250 ms later a tooltip: name, stage, time left with a mini bar, who planted it |
| Plant | click / drag with seed | soil squash 0.92 → 1.04 → 1 (250 ms outBack), 6 dirt particles, seed tick, rising pentatonic pitch ladder while painting; coins pill ticks down |
| Uproot | Shift + click / drag | the plant pops out with a little spin, soil puff, coins tick back up (inside the undo window) |
| Water | click / drag with can | can tilt, droplet particles, soil darkens, "−15 %" floater ("−5 % ♥" for a partner tend); plink |
| Compost | click / drag with scoop | brown puff, soil gains sparkle flecks; soft thud |
| Crop grows a stage | — | staggered pop of the plants (0–400 ms delay each), 2–3 leaf particles; silent unless the camera is close |
| Crop ripens | — | +8 % scale, saturated produce, golden twinkle (per plot, random phase), sway ×1.6 |
| Harvest | click / drag sickle | plants pop up, produce mesh launches 1.2 m and bounces once, after 600 ms arcs into the Barn button (450 ms inCubic); "+N XP" star floats 48 px; pluck sound on the pitch ladder; every 10th plot of a stroke a sparkle burst; Fresh harvests add a green "Fresh!" tag |
| Blue-ribbon harvest | — | blue ribbon sparkle burst, ribbon chime, "+Fair pts" floater |
| Tend animal | click / drag scoop | feed icon flies in (250 ms), munch, eat 1.5 s, two-hop happy jig, 3 hearts; product pops out and flies to the barn |
| Pet | click / drag with hand | animal leans into the hand, heart particle, species sound (cluck, moo, baa, oink, quack, neigh) |
| Shake tree | click / drag basket | damped spring shake ±6° 600 ms, fruit drops and bounces, leaves flutter, fruit flies to barn |
| Queue a recipe | click recipe card in the building panel (or drag ingredients' card onto a slot) | ingredients fly from the barn button into the building, the slot card fills, building puffs steam at 60 BPM while working |
| Recipe done | — | item bubble over the building bobbing at 120 BPM, chime |
| Collect tray | click building / drag basket | items pop and fly to the barn, the building does a little hop |
| Sell | Market panel: pick stack, slider, "Sell" | coins (up to 8, staggered 40 ms) fly to the coin pill; pill bumps 1.15 (220 ms); number rolls over 400 ms; cash-register ding |
| Fill order | Orders panel "Deliver" | the truck at Mabel's stall loads crates and drives off down the road; coins and XP fly to the HUD; order card flips to "new order in 15:00" |
| Donate to a project | bundle / project panel "Give" | goods fly over the river on a little ferry; the project's lantern brightens a notch |
| Buy / place | build mode click | the object drops from 0.6 m, squashes on landing, dust ring, wood thunk |
| Clear debris | click (weeds, rocks) / Axe chops (stumps, logs, boulders) | per chop: object shakes, wood chips; final chop: poof, Wood flies to the barn, sometimes a collection item sparkles out |
| Level-up | — | 240 BPM: four confetti pulses 250 ms apart, light rays behind a big star, banner drops (300 ms outBack), fanfare (1.5 s arpeggio), Bloom ripple across the fields with a sparkle wave over every crop, tree and animal the Bloom just finished and the green "New level! Everything on the farm is ready 🌾" card (changed by the owner 2026-10-04: a level-up finishes everything growing), non-modal unlock banner; on both screens |
| Achievement | — | rosette slides in from the right edge and swings like a hanging ribbon (damped 2 s), ding; "Unlocked together!" for F/T |
| Golden Hour | both seated 10 s | the sky shifts to golden for 30 min, fireflies, a heart burst over the bench, soft swell in the music |
| Invalid action | any | object shakes ±4 px twice (200 ms), soft "bonk", tooltip says why; never a red flash |
| Partner's actions | — | their avatar plays the tool gesture facing the target; item-fly goes to *their* avatar; their sounds at −6 dB and only if on screen |

**Idle "tidy" state**: once everything is harvested, tended and queued, the board has no bubbles, no sparkles and low
sway — the calm signal that says "it's fine to leave".

### 7.3 HUD and panels

| Region | Content |
|---|---|
| Top-left | Farm level star + XP bar (hover: next 3 unlocks); both players' round portraits with online dot, colour ring and **title** (the personal level number lives on the Stats tab) |
| Left column | Goal Tracker (NOW / SOON / BIG), then up to 3 story cards with progress rings and a "This week" tab; new cards slide in with a 120 BPM "!" bounce until hovered |
| Top-right | Coins pill (click → Market), Acorns pill (→ Acorn shop), Hearts pill (→ wardrobe), Barn pill "187 / 320" (orange in overflow; click → Barn) |
| Right edge | zoom + / −, rotate left / right, photo mode, settings, sound |
| Bottom-centre | tool tray (contextual seed picker with counts, grow times, sell values; "painting: Carrot × 14" during a drag; "New!" badges) |
| Bottom-right | the three big buttons: **Build** (hammer), **Market** (stand), **Barn** (crate); plus Orders (board) and Journal (book) |
| Bottom-left | activity feed (5 lines), ping and emote buttons, notes button |
| In world | need bubbles over hungry animals and finished buildings, ready sparkles, timers on hover, partner cursor ring and ghost, "For sale" signposts, Mabel's chalkboard, the townsfolk board, barge at the jetty, Fair tent, the village across the river lighting up |

Panels (wood frame, parchment body, banner title, overhanging close button; `visual-ux-juice.md` §5): Market (Sell ·
Seeds · Trees · Animals · Buildings · Decor · Tools · Acorn shop) · Barn (all items, filters, Keep N, "not for feed"
toggle, overflow) · Building (queue slots, recipe cards with inputs-have/need counts, mastery stars, "Try it" ribbons,
cancel) · Orders (9-slot board, pins, help flags, discard, Mabel's weekly meter) · Townsfolk board · Journal (story,
This week, Together, story replays, ribbons, collections album, Memory Book, treasury ledger, activity history, stats) ·
Fair tent (entries, points, medal ladder, league) · Barge (rows of crates, flags, ladder) · Restoration Ledger · Town
Projects (the village map) · Almanac and calendar · Expansion card · Animal card (name, personality, blue-ribbon
progress, mastery) · Wardrobe (Hearts shop) · Settings (graphics tier, motion, day cycle, sound, UI scale, tend
auto-feed, edge scroll) · Wishlist · Notes.

### 7.4 Onboarding: the first evening

Taught by doing, one step at a time, with Grandma's letter as the voice. **Two parallel tracks from 0:20** (v2, F1),
auto-assigned by who acts first and swappable: **Fields** (A1, A2, A4: plant, harvest, sell, the first order) and
**Barnyard** (A3: clear the weeds and rocks, place the free Coop, make Chicken Feed, feed the hens; the eggs, 20 minutes
later, belong to A6, so no card of the first evening waits on a hen cycle). They meet at A5 for a shared beat: "Make Flour together" (a mini duet at normal time, a heart burst). A solo player gets both tracks one
after the other. Any step can be skipped ("I know farming"). **Per-player first-use tips**, keyed by player and not by
farm progress: the first time each player holds the Sickle, the Seed Bag or the Feed Scoop, or opens a building panel, a
3-second non-blocking hint shows — a partner who joins at minute 20 still learns everything.

| Time | Step | Taught |
|---|---|---|
| 0:00 | Slot picker: each player picks a name and colour; the farm fades in at golden light; Grandma's letter: "The farm is yours, both of you. First, let's give it a name." | presence, co-ownership |
| 0:05 | **Name your farm** (v2, A1): a 20-second joint naming; the name is carved on the gate sign, shown on the loading screen and every Memory Book page | the first co-op decision |
| 0:20 | Fields: "Drag across the plots to plant Wheat." · Barnyard: "Click the weeds — and place Grandma's Coop." | drag-paint planting, seed cost · debris, build mode |
| 1:30 | Fields: "Drag the sickle across the ripe Wheat." Produce flies to the barn · Barnyard: "Make Chicken Feed from 3 Wheat" (the Fields player's wheat) | harvest · buildings, queues, feed |
| ~3:00 | L2: banner (non-modal): Carrot and the Orders board · Barnyard: "Feed the hens — eggs in 20 min. Animals keep their eggs until you collect." | level-up, unlocks · animals, no loss |
| 5:00 | Mabel's first order (scripted: 8 Wheat): "Orders pay more than the market." | orders |
| ~9:00 | L3: Grandma's Windmill placed at 0 coins (v2, F2) → "Make Flour together" | crafting chain, the first together moment |
| 12:00 | "Sell 10 Wheat at the stand" — coins fly | market |
| 15:00 | Partner cue (if both online): "Ping your partner (G)" / "Wave (T)" | co-op comms |
| ~21:00 | L4: Strawberry, the Bakery, Grandma's Apple Tree sapling (given, not bought; v2, F2) — "Some things take hours. The farm keeps growing while you're away." | timers, offline growth |
| ~25:00 | Goal Tracker introduced; tutorial arrows retire; chapter A continues as normal story cards | goals |
| ~45:00 | L5: the first expansion appears as a saving goal; Golden Hour on the Sunset Bench (H1) before logging off | saving goals, the ritual |

**Drip-feed rule** (v2, F3): a *content* unlock (a crop, a recipe, a building) can arrive every level, but a new
*system* (orders, the daily gift, Golden Hour, expansions, barn upgrades, mastery, the Almanac, the Wishlist, pets,
duets, collections, the Couple Challenge…) is surfaced with its one-card explanation **at most once per ~20 minutes of
farm play**; systems that unlock sooner wait in a queue. The weekly Couple Challenge starts on the first Monday after
L6; the Wishlist card waits until the first purchase above 50 % of the treasury; collections explain themselves at the
first drop. With the v2 pacing (L10 at ~3 h) about 12 systems arrive over the first three evenings instead of 20 in 96
minutes.

### 7.5 Settings and accessibility

- `prefers-reduced-motion` and the in-game **Still** toggle: sway ×0.4 (Still: 0 and render-on-demand), no confetti
  bursts (one static sparkle), no camera nudges.
- Never colour alone: ready = sparkle + sway + colour; needs use distinct icons and bubble shapes; players have colour
  + name tag; invalid placement has hatching and ✕.
- Text ≥ 14 px; UI scale 80–130 %; focus-visible rings; panels keyboard-navigable; WCAG AA contrast on all UI tokens
  (`visual-ux-juice.md` §5.2 measured ratios).
- Important sounds have captions in the activity feed (level-up, partner joined, order delivered).
- Graphics: Auto / High / Medium / Low / Eco; day cycle: Cycle / Always day / Real clock; volumes per channel.

---

## 8. Visual and audio direction

### 8.1 Look

"The good life on an old-fashioned farm": bold, chunky, saturated, painterly-soft, grounded (no fantasy creatures, no
costumes, nothing bad ever happens). Quaternius flat-colour low-poly family as the base (`assets-catalog.md`), pushed
toward FarmVille 2 by lighting and palette: warm sun from the upper left, cool sky fill in shadow, soft contact
grounding, saturated material overrides (+10–20 %), toy-like chunky scale (animals and avatars +10–20 %).

**From faceted to soft (v2, V2)** — the cheap levers, none of them post-processing:

1. **Creased normals** at build time (`BufferGeometryUtils.toCreasedNormals(geo, 40°)`) on organic meshes: canopies,
   animals, crops, rocks. Flat shading stays only on architecture.
2. **Wrap (half-Lambert) diffuse plus a warm rim term** in the Lambert shader via `onBeforeCompile`: soft shadow-side
   fill with no extra pass.
3. **A painted ground**: a canvas-generated grass texture with mowing stripes and colour noise, plus a vertex-colour AO
   footprint under every object.
4. **Saturation +10–20 %** per material name (catalog §5), with toy scale on animals and avatars.
5. **The look-dev gate** (hard gate before any content work): a 16 × 16-tile hero scene screenshotted next to
   `sources/fv2-reference/fv2-farm-overview.jpg` and `fv2-ready-crop-sparkle-late-game.jpg`; the owner signs it off.

**Telling things apart**: each production building gets a **signature prop and a roof-colour rule** (a giant pie on the
Pie Oven, a barrel on the Juice Press, a spool on the Weaver, jars on the Preserves Kitchen, a cheese wheel on the
Dairy…) plus its icon badge on hover; each tree species gets shape parameters (§3.2). Install Blender
(`apt install blender`) for vertexcat's animated `.blend` sources and quick hand rigs — the highest-leverage asset step.

### 8.2 Palette tokens

| Token | Hex | Token | Hex |
|---|---|---|---|
| grass-lit | #7CC243 | leaf-dark | #2F6E3A |
| grass-var | #66B23A | leaf-mid | #4C9A3E |
| grass-meadow (locked land) | #4F9A33 | leaf-light | #8FD05A |
| soil-tilled | #7A4A2A | trunk | #8A5A35 |
| soil-rim | #9B6A3E | fence-wood | #D9A15B |
| soil-wet | #5A3420 | barn-red | #C8473A |
| dirt-path | #D8B98A | roof-brown | #7A4B3A |
| sand | #EED9A6 | trim-white | #FFF8EC |
| sandstone | #C99A62 | sky-top | #4FA8EE |
| water-shallow | #7DB9B5 (QA2 RD-10, muted) | sky-horizon | #D6F1FF |
| water-deep | #3A88A2 (QA2 RD-10, deeper) | sun-light | #FFF1D6 |
| hemi-sky / hemi-ground | #CFE8FF / #8C7A4B | night-moon | #8FA3D9 (minimum luminance kept) |

Crop ready hues are unique per crop (crop table, §3.1) so fields read as colour blocks at far zoom. Players: P1 teal
#2BB3A3 (dark #1F7A70), P2 coral #FF7A6B (dark #C2483C), P3 sun #FFC83D, P4 sky #4AA8E8. UI tokens (wood, parchment,
ink, action colours, coin, XP, ribbons) are `visual-ux-juice.md` §5.2 verbatim; fonts Baloo 2 (display) and Fredoka
(UI), vendored locally.

### 8.3 Camera

| Parameter | Value |
|---|---|
| Type | PerspectiveCamera, vertical FOV 30° |
| Yaw | 45° + k·90°; Q/E snap with a 400 ms inOutCubic tween |
| Pitch | eases with zoom: 54° at max distance → 36° at min (diorama close-ups show the horizon) |
| Distance | 18 m min · 55 m default · 90 m max; wheel ×1.12 per notch toward the cursor, exponential damping 12/s |
| Pan | drag on empty ground, right/middle drag, WASD/arrows; clamped to unlocked land + 6 m (the village across the river is always in view from the south edge) |
| Focus | double-click an object eases to it (500 ms); F jumps to the partner; Space to me |
| LOD bands | near < 35 m ≤ mid < 60 m ≤ far (10 % hysteresis), tech §10.12 |
| Photo mode | hides UI, renders at 2×, downloads PNG; optional Memory Book page |

### 8.4 Lighting, day/night, seasons, weather

- Sun `DirectionalLight(#FFF1D6, 2.8)` from the upper left; `HemisphereLight(#CFE8FF, #8C7A4B, 1.3)`; Neutral tone
  mapping; static shadow map refreshed only on change (shadow intensity 0.6); blob shadows for everything that moves;
  footprint AO texture for soft grounding; no post-processing.
- **Day/night is cosmetic, shared and slow**: a **40-minute cycle** derived from server time — 26 min day, 4 min
  **dusk** (v2 rename: "golden hour" now only means the buff), 6 min moonlit night, 4 min dawn. Night is
  blue-lavender, never dark: windows, lanterns and the village across the river glow, fireflies, crickets, an owl.
  Night (QA2 RD-05): a dimmer moon key (1.3) against a blue-lavender `#8A93BD` fill, exposure 1.36, the farm keeping
  >= 50 % of noon's light; warm window light `#FFD18A` with 2.2 m ground pools; never a teal wash.
  Personal setting: Cycle (default, shared sky) / Always day / Real clock. Golden Hour (the buff) tints the sky golden
  for its 30 minutes regardless of the cycle: the sun 20° lower (long shadows), a warm `#FFD7A0` key at 0.85 of noon
  against a cool `#A8B7CE` fill, greens kept green (QA2 RD-05). Dusk rose `#F0A48C`, dawn peach `#F3CDB4`.
- **Seasons**: one `uSeason` uniform from the real date; spring blossoms and light greens, summer deep greens and
  sunflowers, autumn: ~70 % of deciduous crowns turn ochre `#C49A45` / copper `#B86A39` / muted red `#A85C45`, the
  lawn drier and warmer with straw `#C9B26E` margins, orange maples with falling leaves (QA2 RD-05); winter snow on up-facing surfaces,
  frosted pines and animal breath puffs. Ultimate Nature's Autumn/Snow tree variants are swapped in per season.
- **Weather** (§5.10): rain = instanced streaks, darker wet ground, puddle ripples, rain loop, a rainbow arc after; windy
  = sway ×1.6, blowing leaves; cloudy = denser cloud shadows; snow in winter.
- **Tempo**: the board moves on a 60 BPM grid; attention (ready bubbles, mailbox) at 120 BPM; celebrations at 240 BPM.

### 8.5 Sound list

Music: 60 BPM acoustic (banjo, mandolin, fingerpicked guitar, upright bass, glockenspiel accents), major/mixolydian,
2–3-minute tracks with 30–60 s of silence between; 6 day tracks, 2 night tracks (piano + pad), 1 Golden Hour track, 1
per festival; 1.5 s level-up fanfare at 240 BPM. Default volumes: master 0.8, music 0.35, ambience 0.5, SFX 0.7, UI 0.6.
Ambience layers crossfade by time of day, weather and camera position (birds, wind in leaves, distant animals every
20–60 s, water lapping near the river/lake, crickets and owl at night, rain, faint village bells once a project is
built).

| Group | Sounds (70–150 ms each, ±4 % random pitch, stereo pan by screen x) |
|---|---|
| Farming | seed tick, soil squash, water plink, compost thud, pluck (pentatonic ladder C D E G A c d e g a …), root yank, uproot pop, tree shake rustle, fruit bounce, chop (×3 variants), debris poof, weed pull |
| Animals | cluck, rooster crow (dawn), moo, baa, oink, quack, neigh, bleat, alpaca hum, bee buzz loop, munch, happy jig hop, dog woof, cat purr/meow |
| Buildings | windmill creak loop, oven door, bubbling pot, butter churn, loom clack, sewing machine whirr, saw, juice squish, candle fizz, packing tape, done chime |
| Economy | coin drop (per coin), coin pill bump, cash-register ding, order truck honk and engine away, barge horn, crate thump, ferry bell, Acorn twinkle |
| Progress | XP tick, level-up fanfare, achievement ding + ribbon swing, quest complete flourish, mastery star chime, collection find sparkle, bundle complete, project lights-on swell, expansion fence pop |
| Co-op | partner arrived chime, ping chime (yours / theirs), emote pops (8), high-five clap, duet bell, Golden Hour swell, keepsake ribbon unwrap, note paper rustle, thanks heart, fishing-line plop |
| UI | panel open (paper slide), panel close, button press, tab, hover tick, invalid bonk, toast pop, tooltip pop |

Sources: CC0 packs listed in `assets-catalog.md`; UI blips synthesised with Web Audio (wow-arena's DSP kit approach).

### 8.6 Performance targets (v2, V1)

≤ 120 draw calls (alarm at 150), ≤ 300k visible triangles, ≤ 10 ms GPU at 1920×1200 on the Vega iGPU, 30 fps ambient
cap and 60 fps while interacting (+2 s tail), 10 fps when blurred, render-on-demand under "Still"; quality tiers
High/Medium/Low with auto-adjust.

**Batching is the default from M0, not a fallback**: one `BatchedMesh` with **vertex colours** for crops (the stage swap
is `setGeometryIdAt`; the sway attribute already fits), one for trees, static buildings and decor joined by palette;
animals as **rigid instanced meshes per species** with vertex-shader bob/waddle/peck and **at most 8 skinned** near the
camera or being tended. A realistic L25 farm drops from ~220–290 naive draw calls to ~40–60. Crops never cast
shadow-map shadows; ground crops show one plant per plot with stage 4 simplified to 30–50 % (`gltf-transform
simplify`), which keeps a 164-plot field under ~120k triangles. The client **coalesces incoming deltas per animation
frame** (rewind once, apply all, replay pending once), so a 70-plot partner drag costs one rebase, not 70. Run the M0
skeleton on the partner's PC and record its tier before the look is locked.

---

## 9. Edge cases and exploits

| # | Case | Rule that handles it |
|---|---|---|
| 1 | Both harvest the same plot at once | Server order: first wins; yield +N once; the second gets a soft toast (none during a combo, §6.3) |
| 2 | Both plant different seeds on one plot | First wins; the loser's seed cost is never charged (rebase restores coins) |
| 3 | Drag-harvest overlapping the partner's drag | Per-object resolution; one combined toast per 500 ms |
| 4 | Barn full on harvest | Goes to Overflow (up to 2 × capacity); at 2 × the produce stays ripe on the plot; nothing destroyed (§3.6) |
| 5 | Barn full on animal collect / tray collect | Same as 4: product waits on the animal / in the tray; queueing stays allowed until the slots fill |
| 6 | Store purchase while in overflow | Item purchases (emergency feed, Golden Seeds) refused (`STORAGE_FULL`) with a "Sell surplus" button; buildings, decor, land never refused; selling is always allowed |
| 7 | Selling below cost | Impossible by construction: seed < plot gross (R2), every recipe ≥ 1.15 × inputs (R3); the Market never pays less than the formula; selling an object returns 50 % (100 % within the undo window, never placed, or blue-ribbon) |
| 8 | Buy from store, sell at market | Store never sells anything the Market buys (R5); feed and consumables are not sellable |
| 9 | Buy-refund loops for XP or achievements | Purchases grant no XP (decor XP removed, R12); achievements, story state tasks ("own 2 Apple Trees", "build the Bakery") and land proof tasks count settled holdings only (past the 10-minute undo window; wave-1 QA RC-05); "Wishful Thinking" counts DIFFERENT things bought through the Wishlist (RC-15); restoring a sold plot from the trash re-checks the plot cap (RC-04); an animal with its product waiting cannot be sold ("Collect its Egg first", RC-22) |
| 10 | Plant-and-delete XP | No XP at planting; XP only at harvest; Uproot refunds seeds only inside the 10-minute window and pays nothing |
| 11 | Orders: offline expiry | Orders never expire; refills happen while offline (system action at `availableAt`), at most the slot count |
| 12 | Order fishing (Acorns, weekly meter) | Golden orders come from the 6-hour schedule, not the order counter; Mabel's meter, Couple Challenge and ribbons count order **value** (simple orders ¼); discards refill in 15 min (R15) |
| 13 | Impossible order | G-VALID with the full chain; quantities capped by one building's 45 minutes or a third of the field; a simple order only as a safety net |
| 14 | Same scarce item in many orders | An item appears in at most 2 open orders (townsfolk included); no two items in an order share a direct input |
| 15 | Partner sells kept items | Soft confirm naming who set Keep N; Feed Mill and keepsakes skip kept items |
| 16 | Partner sells the wheat my bread is baking from | Impossible: inputs are consumed when queued; the started process can't fail |
| 17 | Partner spends saved coins | Wishlist coins are not spendable; BIG_SPEND confirm + toast; ledger; 10-min undo |
| 18 | Gift ping-pong for value | Keepsakes give Hearts only and remove the good from the Barn; no coins (C9) |
| 19 | Self-filling a help flag | Normal reward, no partner bonus |
| 20 | Faking "together" alone in two tabs | Bonuses need two **distinct players**, not two connections; the same player in two tabs is one pid |
| 21 | Farming Hearts from thanks | Thanks hearts capped at 10 received per day; tending/teamwork hearts capped at 10 a day each |
| 22 | Combo XP farming | Combo bonus capped at 300 actions a day; needs two players' productive actions within 3 s |
| 23 | Level-up Bloom exploitation (X5) | **Superseded.** Changed by the owner 2026-10-04: a level-up finishes everything growing (§3.1 rule 10). Planting before the bar fills is an intended reward now; production queues stay out of it |
| 24 | Golden Hour stacking | Once per together session, ≥ 8 h apart; a buff affects only processes started inside its window, fixed at start; time reductions add with a 50 % floor of the base time |
| 25 | Market Demand arbitrage | +50 % only on the first 50 units a day (60 with the Old Coins set) |
| 26 | Fair entry spam of one cheap item | Max 10 entries of one item per week; points scale with V (one decimal, no rounding gain) |
| 27 | Collection RNG drought | Pity: guaranteed after 40 eligible actions per set |
| 28 | Breeding for golden coats | 5 % with pity at the 20th breeding; coats are cosmetic only |
| 29 | Clock manipulation | Server time only; the client clock is never trusted; the server clock never runs backwards (tech §4.1) |
| 30 | Server off for days | Timers are absolute; one `_rollover` catches up (Farm Weeks, Almanac reset, orders refill, debris regrowth capped at 12) — no burst of events |
| 31 | Broke with empty fields | "Grandma's seed basket": if coins < the cheapest seed and nothing is growing or sellable, 12 free Wheat plantings appear (once per day) |
| 32 | No feed and no grain | Feed classes accept any grain/root/produce; Wheat is always plantable; the store sells emergency feed at 2.5 × V |
| 33 | Animals with no feed for weeks | They wait; nothing decays; products already made wait on them |
| 34 | Quest asks for a locked item | G-VALID at generation and at boot; quest data is validated by the model (R6) |
| 35 | Expansion proof task impossible | Proof tasks only reference content unlocked at the expansion's level; progress counts from first opening the card |
| 36 | Duet pressed by one player twice | Refreshes the slot; never completes alone |
| 37 | Both press duet in the same instant | Joint slot: first press opens, second completes; zero rejections (tech §15.4) |
| 38 | Partner moves a building mid-queue | Move keeps id and timers; collection still works; "move back" for 10 minutes |
| 39 | Partner removes a building with goods in the tray | Not allowed: a building with a non-empty queue or tray cannot be stored or demolished |
| 40 | Refund an object the partner is using | Refund needs the object pristine (no crop, empty queue, never fed/harvested) |
| 41 | Watering spam | Once per crop cycle plus one partner tend; no XP for watering |
| 42 | Hurry abuse | Acorns are earned only; Hurry costs 1 per started hour (max 8 per object); ≥ 10 Acorns a day by one player is BIG_SPEND |
| 43 | Giant crop farming | Needs 9 composted plots (9 Compost) planted in one minute; 20 % chance keyed on the block **and `plantedAt`** (no permanently lucky field); value 2 × the composted plots (R13) |
| 44 | Overflow as infinite storage | Capped at 2 × capacity; then intake waits safely |
| 45 | Content change removes an item | Ids are permanent; retired items still work and are refunded at V on load if unplaceable (tech §5.4) |
| 46 | Prediction mismatch on random bonus | Stateless hash RNG keyed by (farm seed, object, cycle): client and server roll the same; no re-roll on reconnect (R16) |
| 47 | Two tabs of the same player | Two connection ids, one player; dedupe by (cid, seq) |
| 48 | Story beat while the partner is offline | Queued and replayable; never skipped |
| 49 | Wrong seed dragged over the field | Uproot inside 10 minutes refunds the seeds; the Smart Hand never plants a seed this player did not choose this session |
| 50 | Town Project goods held hostage | Goods are donated piece by piece and never reserved; a project never expires; one active at a time |
| 51 | Free trees inflating the next tree's price | Free trees do not count toward the n-th-tree price |
| 52 | Blue-ribbon animal resale loop | Resale returns the price paid for that animal (its own purchase index), never the current n-th price |

---

## 10. Milestone plan

The build follows `tech-architecture.md` §11 (Step 0 contracts, then parallel lanes) with the errata of Appendix F.
Content and balance come from `tools/economy-model.mjs --json`; every milestone ends with
`node tools/econ-sim.mjs --checks` green.

### M0 — Walking skeleton (lead, 1–2 days)

Contracts frozen (Tx, runAction, schema, protocol, content index), two crops and one plot def, plant/harvest with
coloured boxes in two browser tabs over the LAN, persistence (snapshot + journal), one E2E step green. **BatchedMesh +
vertex colours** wired from day one; the skeleton runs on the partner's PC and its quality tier is recorded. The server
host decision (§6.3, C5) is made.

### M1a — "Evening One" (≈ 2 weeks; v2, P1)

**A complete, polished slice the couple plays for real for a week, L1–12.** Acceptance: a couple plays from a fresh farm
to L10 in three 60-minute evenings and enjoys it; every system below works on both screens; `npm test`, the two-client
E2E and `econ-sim --checks` are green.

| Area | In M1a |
|---|---|
| Crops | Wheat, Carrot, Corn, Strawberry, Potato, Tomato, Sugarcane, Pumpkin, Sunflower, Cabbage (L1–12): stages, watering + partner tend, compost, blue-ribbon, Freshness, seasons, mastery ★1–★3, Uproot |
| Trees | Apple, Pine, Cherry; sapling → mature, groves, watering |
| Animals | Chicken, Cow, Sheep; babies, bottles, tending, petting by drag, blue ribbon + goods, Compost Bin, homes and capacity upgrades |
| Buildings | Feed Mill, Windmill, Bakery, Sawmill, Juice Press, Dairy, Compost Bin, Kitchen, Preserves, Weaver's Shed with their recipes to L12, slots, trays, cancel, recipe mastery, "Try it" ribbons, Sweetheart Cake duet |
| Economy | Market (sell, Demand), store, Barn + overflow + upgrades 1–3, plots and the plot cap, expansions 1–4, decor to L12 + Acorn decor, tools and brushes, Hurry, Golden Seeds |
| Progression | farm levels to 12 with the generated tables, Level-up Bloom (every level-up; since the owner's change of 2026-10-04 it finishes everything growing), non-modal unlock banners, per-player unlock tours, personal titles; levels past 12 pay a Legacy-pool item (§4.6) |
| Not in M1a | the pet goods and pet homes (Dog Biscuit, Cat Treat, Dog House, Cat Basket) wait for the pets in M1b (wave-1 QA RC-30) |
| Goals | Goal Tracker; orders board (generator, pins, flags, golden schedule, Mabel's weekly meter); quest chains A–E to L12 as illustrated letter cards; the ribbons that apply; Daily Gift, Farm Weeks, Almanac + Together task; Couple Challenge |
| Co-op | the felt mechanics of §6.2 (M1 column); Keep N, Wishlist, pins, BIG_SPEND, undo/trash/move back, ledger, activity feed, recap, notes, pings, emotes, Golden Hour, high-five, farm naming, two tutorial tracks |
| Look and feel | the look-dev gate passed first; creased normals, wrap lighting, painted ground; instanced crops with sway and cursor wind (both cursors); day/night cycle; rain; juice recipes of §7.2; core SFX and 3 music tracks |
| Tech | tech §9 test suites for the slice; quality tiers; frame pacing; delta coalescing; LAN URL banner; systemd unit |

### M1b — First two months (target +2 weeks)

L13–25 content (the remaining crops, trees and animals to L25, Sewing, Pie Oven, Chandlery, Packing Table and their
recipes, Harvest Feast and Wedding Cake duets), the County Fair (no league), the River Barge with rows and ladder,
Restoration projects 1–3, Farm Beauty, decor sets and Masterwork, giant crops, collections (8 sets), Town Projects 1–4
and the townsfolk board, quest chains to L25, every ribbon to L25. Tuning from the M1a week feeds the K/X calibration
(`--autocal`) before M1b content is generated.

### M2 — Full v1 content (target +2 weeks)

L26–40 content (Watermelon, Bell Pepper, Rice; Walnut, Olive, Maple, Cocoa, Fig; Alpaca; Oil Press, Sugar Shack,
Chocolatier; the remaining recipes and hampers), expansions 5–15, barn upgrades 4–10, Gold mastery, Restoration projects
4–6 with the farmhouse interior and Grandma's visit, Town Projects 5–24 and the Festival Pavilion, Grand decor, Fair NPC
league and Platinum, horse show, breeding barn and coats, nursery, Seasonal Ribbon Track, the 4 remaining collection
sets, Legacy levels, perks, rested XP, the deferred co-op mechanics (§6.2), the fishing dock, Friendly Duel.

### M3 — Seasons and events (target +1–2 weeks)

Season skins (palette, Autumn/Snow tree variants), the six festivals with event crops, recipes and prize ladders, story
vignettes, the full music set (day/night/Golden Hour/festival), weather polish (rainbow, wind), Memory Book upload and
wall, season postcards.

### M4 — Polish and tuning (ongoing)

Balance passes from the simulator and real play data (E(L) within ±25 %, re-run `--autocal` after any content change),
animation polish (proper animal rigs where the catalog has gaps), accessibility audit, performance passes on the Vega
iGPU, optional HTTPS for desktop notifications, 3–4-player testing if ever wanted.

---

## Appendix A — content data shapes (for `shared/content/*.js`)

```js
// crops.js
{ id: 'wheat', name: 'Wheat', unlock: 1, growMs: min(1), yield: 2, sell: 2, seed: 2, xp: 1,
  classes: ['grain'], season: 'winter', hue: '#E8B84A', archetype: 'tall', model: 'crops/wheat',
  stages: [0, 0.1, 0.4, 1], mastery: [50, 250, 750, 2500] }
// trees.js
{ id: 'apple_tree', name: 'Apple Tree', unlock: 4, price: 4900, priceGrowth: 1.45, capBase: 4, capPer10Levels: 1,
  capMax: 8, cycleMs: h(4), yield: 5, product: 'apple', saplingCycles: 2, heirloomAt: 60, flowering: true,
  size: [2, 2], model: 'trees/apple', shape: { canopy: [1, 1, 1], trunk: 1, lean: 0 } }
// animals.js
{ id: 'chicken', name: 'Chicken', unlock: 1, home: 'coop', baby: 800, adult: 1300, priceGrowth: 1.1,
  babyMs: min(30), feed: 'chicken_feed', feedQty: 1, cycleMs: min(20), product: 'egg', out: 1,
  prizedAt: 60, premium: 'golden_egg', premiumChance: 0.10 }
// buildings.js
{ id: 'bakery', name: 'Bakery', unlock: 4, cost: 2600, size: [3, 3], slots: [2, 6],
  slotCosts: [1300, 2100, 3300, 5300], secondCopyAt: null }
// recipes.js
{ id: 'bread', name: 'Bread', building: 'bakery', unlock: 4, ms: min(5), out: 1, inputs: { flour: 1 },
  tier: 'T3', duet: false }
// items.js (derived): { id, name, kind, sell, giftable, orderable, sellable, keepDefault }
// levels.js: [{ level, xpToNext, coins, acorns, plotCapBase, unlocks: [...] }]   plotCap = plotCapBase + 6 × expansions
// quests.js, achievements.js, expansions.js, decor.js, grandDecor.js, townProjects.js: as in §5.3, §5.4, §3.9, §3.8, §5.9
// config.js: the §4.3 constants (CROP_R 4.33, SHORT_EXP 1, LONG_EXP 0.45, CROP_LVL 0.015, SEED_SHARE 0.4, TREE_MULT 1.6,
//   TREE_GROWTH 1.45, FEED_K 4, ANIMAL_K 18, CRAFT_K 12, CRAFT_EXP 0.8, CRAFT_LVL 0.015, MIN_ADD 0.15, XP_DIV 8),
//   the K and X calibration anchors, targetMinutes, FAIR_W 0.3, FAIR_PAY 1.5, the weekly meter table
```

Item flags: `sellable` false for feed, Compost and Baby Bottles; `orderable` false for feed, Compost, Baby Bottles,
Wood, blue-ribbon goods (barge and Fair only) and duet goods (golden orders only); `giftable` true for every produced
good; `keepDefault` 20 for Wood, 0 otherwise.

## Appendix B — glossary

| Term | Meaning |
|---|---|
| Reference couple | two players, 3 evenings a week × 60 min together; every pacing number is calibrated to them (`casual` policy) |
| E(L) | income of farm level L in coins per hour of play of the reference couple, measured by the simulator (§4.4) |
| K(L), X(L) | the two calibration curves: E = hand model × K; XP per play-hour = E/8 × X (§4.4, §4.6) |
| V | market value of one unit (§4.3) |
| Gross | yield × V of one plot harvest |
| Tend | collect an animal's product and re-feed it in one click |
| Partner tend | the extra −5 % (crops, trees) or −20 % (baby bottle) a second player adds on top of anyone's base action |
| Blue ribbon | the prized state (crop harvest, fruit, animal) that scores Fair points; a blue-ribbon animal sometimes makes a blue-ribbon good (4 × V). v2 rename of "prized / premium / Prize Fruit" |
| Bloom | the level-up effect: everything growing on the farm (crops, trees, saplings, baby animals, animal products) finishes at once; production queues are not touched (changed by the owner 2026-10-04: a level-up finishes everything growing) |
| Golden Hour | the 30-min "everything started is 10 % faster" buff from a two-seat bench, once per together session |
| Dusk | the 4-minute golden part of the cosmetic day/night cycle (v2 rename) |
| Friendship | per-townsperson relationship points (v2 rename of "friendship hearts") |
| Keep N | a farm-wide "keep at least N of this item" lock with a soft confirm (replaces reservations) |
| Wishlist | a shop item with coins set aside that buys itself when funded (replaces Savings Jars) |
| Town Project | a goods + coins project that builds a landmark in the Hollow Village across the river (§5.9) |
| G-VALID | generators may only ask for unlocked items whose full chain is producible now, or that are in stock |
| Simple order | the safety-net order (one good in stock or one fast crop); counts ¼ toward order counts and the weekly meter |
| Soft confirm | KEEP / PINNED / BIG_SPEND: allowed after a confirm, never forbidden |

## Appendix C — decisions that differ from research proposals

| Topic | Research proposal | Decision | Why |
|---|---|---|---|
| Watering | optional yield multiplier (core-loop §20) or optional speed-up | optional **speed-up** on crops ≥ 30 min only (−15 % anyone, −5 % more by the partner) | a yield multiplier that is free is a click tax on every crop; limiting it to longer crops keeps the fast loop clean; the partner part is an extra, never a reason to wait |
| Storage | harvest never blocked, unlimited overflow (tech §2.5) | overflow up to 2 × capacity, then intake waits safely in place | an unlimited overflow makes capacity meaningless; waiting in place destroys nothing and keeps barn upgrades a real goal |
| Level-up ripen | FV2 "ripen everything" (core-loop §21) | **Bloom**: everything growing finishes (crops, trees, saplings, baby animals, animal products), production queues excepted | changed by the owner 2026-10-04: a level-up finishes everything growing (it replaced v2's bounded −25 % / max 60 min cut) |
| Prized animals | slow to an 18-h cycle (FV2) | keep the normal cycle + 10 % blue-ribbon goods | no dead-end collectibles (crafting doc A7) |
| Trees wilting | partner revives wilted trees (progression §7.4) | trees never wilt; the partner bonus is a partner tend on watering | "no loss" pillar; the helping gesture is kept as a bonus |
| Affection | 0–5 permanent meter (crafting doc A5) | daily petting bonus (+10 % / +20 % together) | a permanent meter either decays (a loss mechanic) or saturates (meaningless) |
| Town Trust / Favor | orders-only expansion currency (crafting §5.3) | dropped; expansions use coins + materials + proof task | fewer currencies; proof tasks already tie land to play |
| Storage split | silo + barn (Hay Day) | one Barn | one shared count is clearer for two people |
| Crafting markup | ~1.2–1.6 per step (Hay Day) vs 2–3.5 (FV2) | **no markup**: inputs + machine time (12 × min^0.8), ≥ 1.15 × inputs | a markup on inputs makes the most expensive short recipe dominate its building; time-only value cannot be dominated |
| Session cadence | daily play, 1.5–2 h (progression research) | 3 evenings × 60 min a week (the owner's brief) | weekly streaks, per-session Golden Hour, weekly sizes for ~3 hours |
| Plot count | 900 plots late game (tech §5.1) | 16 → 164 plots (6 per expansion) | dense FV2-like fields that the Vega iGPU can batch; land is production |

## Appendix D — critique log (v1 → v2)

Every finding of `docs/design/critique-economy.md` (economy, ids C/H/M/L) and `docs/design/critique-coop-fun.md`
(co-op and fun, ids X/F/C/G/P/V/A/T and checks R11–R17) with the decision. **Accepted** = applied as proposed;
**Modified** = the problem is fixed, differently, with the reason; **Rejected** = not applied, with the reason.

### D.1 Economy critique

| Id | Finding | Decision | Where / reason |
|---|---|---|---|
| C1a | E(L) underestimates production 1–3.5 × | **Modified** | E is now *measured*: the hand model × a K curve fitted by `econ-sim --autocal` to the **reference couple** (3 × 60 min a week, the owner's brief), not to the GDD v1's 1.5–2 h-a-day couple; E made non-decreasing; the first 4 levels keep K = 1 because almost nothing is sold in the first 45 minutes and the fit there oscillates (§4.4). |
| C1b | XP curve 4–6 × too fast | **Modified** | The curve keeps its shape (E/8 × minutes × X) but the targets are the owner's: L5 in the first evening, L10 in week 1, L20 in about a month, L30+ long-term; X is fitted by the simulator over 5 seeds (§4.6). The critique's anchors aimed at the old daily targets. |
| C1c | Almanac prints coins and XP | Accepted | First 4 completions per player per day pay E × 0.02 h, no doubling (§5.8). |
| C1d | Mastery rewards 73 % of the curve | Accepted | Caps of 0.1 / 0.2 / 0.2 h of E (§4.8). |
| C2 | Decor flip prints unlimited XP | **Modified** | Fixed by the stronger co-op proposal X1(a): decor gives **no XP at all**. The economy proposal (XP on first placement, 50 % refund) still bought XP at 20 coins each — 2.5 × cheaper than farming — and kept a coin → XP converter that competes with production. |
| H1 | Feed Mill throughput | Accepted | Feed batches make 6 (§3.3). Simulated hunger ≤ 0.3 %. |
| H2 | Order generator: impossible quantities, junk, simple orders | Accepted, one part **modified** | Cap by one building's 45 min, ≤ 90 machine-minutes, full chain, value floor, stock weight 3 (§5.2). The un-simulated "≥ ⌈slots/4⌉ easy orders" guarantee was tried and **rejected**: every filled easy order regenerated as a simple one (50–80 % simple orders). Instead the safety net fires only when *no* open order is easy, "easy" includes growing crops and one-run recipes, and simple orders draw from stock (15–25 % simple). Added a novelty weight so every good gets asked for. |
| H3 | River Barge unfillable; weekly quests block cards | Accepted, extended | Crates E × 0.3 h, 6-h producer cap, made in the last 14 days, rows by last week's play, chest paid per row, "This week" tab (§5.7, §5.3). Quest F3 now asks for 2 completed rows (one stubborn crate kept full barges rare even after the fix). |
| H4 | Coins stop mattering mid-game | Accepted, **modified** | Town Projects (merged with A5's village), Masterwork, Grand decor, E-based Restoration coin slots. Changes after simulation: a project builds in 1 day (not 3) and takes goods piece by piece and never raw crops (the all-at-once bundle of three crop stacks stalled for weeks); cost E × (10 + 0.5 n) h. The proposed check "treasury < 10 E-hours until L35" is **modified** to "> 15 E-hours < 10 % of play from L20": a single Town Project is itself a 10-hour saving goal, so the 10-hour line flags saving, not surplus. Result: ≤ 1 %. |
| H5 | Planks and Crates gate expansions | Accepted, **extended** | 1 Wood → 2 Planks, halved costs (§3.9). The simulator's new R14 check still found the Sawmill walling expansions 3–20 % of the time, so Planks take **10 min**, Crates **20 min**, Pine yields **8** Wood, Wood is never ordered and keeps 20 by default (the sim sold the starter wood at minute 1). Now ≤ 2 %. |
| M1 | Windmill/Dairy single queues | Accepted | Second Windmill L16, second Dairy L18 (§3.5). |
| M2 | Wheat dominates every session | Accepted | SHORT_EXP 1.0, CROP_R 4.33 (§4.3). |
| M3 | Fastest recipe wins; 49 dominated recipes | **Modified (stronger)** | The proposed 10 · m^0.8 + lower markups still left 43 dominated recipes. v2 removes the input markup: value = inputs + 12 · m^0.8 · (1 + 1.5 %/level) → **0 dominated** by construction (R18). R3 lowered from 1.2 to **1.15** (time-only value would otherwise force 6–8-hour hampers) and ten big-input recipes were lengthened. Baby Bottle non-sellable: accepted. |
| M4 | Compost 3 × better on yield-1 crops | Accepted | Pumpkin, Cabbage, Watermelon yield 2; recipes take 2 (§3.1, §3.5). |
| M5 | The Fair does not pay | **Modified** | Points V/100 with one decimal: accepted. Instead of medals × 1.8 on the old target, a medal now pays **1.5 × the value of its threshold** and W = E × 0.3 / 100 is sized to the reference couple's week: with × 1.8 on W = E × 1.5 / 100 the reference couple still won only Bronze (46 of 50 weeks in the critique's own run). Now Silver+ in ~9 weeks of 10 at an order-like rate (§5.6). |
| M6 | Duet recipes are dead weight | Accepted | 1 golden order in 3 asks for a duet good at 2.0 × V; duet goods × 2 at the Fair. |
| M7 | Starter debris skips the tutorial | Accepted | 40 XP in all (§2.3). |
| M8 | Land never binds; trees dominate | Accepted and simulated | Tree cap 4 + 1 per 10 levels (max 8), growth 1.45, ANIMAL_K 18 (§3.2, §4.3), together with G2's plot cap. Tree XP share fell from 30–40 % to 9–21 %. |
| L1 | Partner gift mints coins | **Superseded** | By C9: keepsakes give Hearts and no coins at all. |
| L2 | Baby Bottle and Compost sellable | Accepted | Consumables (§4.3). |
| L3 | Spec gaps | Accepted, each ruled | Wood: stump 2, log 3 (§2.3). Level-up coins paid on reaching the level (§4.6). Blue-ribbon resale = the price paid (§3.4). Emergency feed may be bought at any balance — it is the player's choice and never automatic. The barge's "no shared direct input" rule applies to crafted goods (raw goods have no inputs). Restoration coin slots are E-based (§5.9). The balance simulator is `tools/econ-sim.mjs` (Appendix F). |
| L4 | Bloom fast-forwards 19 h early on | **Superseded** | By X5's rule (§3.1 rule 10), itself replaced by the owner 2026-10-04: a level-up finishes everything growing. |

### D.2 Co-op, fun and feasibility critique

| Id | Finding | Decision | Where / reason |
|---|---|---|---|
| X1 | Decor XP pump | Accepted (option a) | No decor XP (§3.8); R12. |
| X2 | Order fishing for golden orders and Market Week | Accepted | Golden orders on the 6-hour schedule; weekly meter, challenges and ribbons by value; simple orders ¼ (§5.2, R15). |
| X3 | Giant crops lose yield | Accepted | 2 × 9 × (yield + 1), keyed with `plantedAt` (§6.2 #8, R13). |
| X4 | Unreachable ribbons, finite debris | Accepted | Restorer 4/12/24, debris regrowth, R11 in the model. Lucky Find became the farm-wide Album Pages (also C3). |
| X5 | Bloom can be timed | Accepted (both proposals combined); **superseded** | −25 % of the remaining time, max 60 min, only for processes started ≥ 15 min earlier. Changed by the owner 2026-10-04: a level-up finishes everything growing (§3.1 rule 10). |
| X6 | Plank wall on evening one | Accepted, one part **rejected** | Wood yields and cheaper early costs: accepted (merged with H5). "Planks take 10 min until L12" **rejected as a special case**: Planks take 10 min always (H5), so no level-dependent recipe time breaks the one formula. |
| X7a | BIG_SPEND thresholds | Accepted | GDD wins; ≥ 10 Acorns by one player in a day counts (§6.3). |
| X7b | Festival items in orders | Accepted | Orderable only during their festival (§5.10). |
| X7c | "Tray never blocks" | Accepted | Trays hold goods at 2 × capacity; queueing allowed until slots fill (§3.5). |
| X7d | Store refusal in overflow | Accepted | Item purchases only (§3.6). |
| X7e | Watering vs "applied at start" | Accepted | `readyAt = max(plantedAt + 0.5 × base, readyAt − k × base)` (§3.1). |
| X7f | Free trees and n-th price | Accepted | Free trees do not count (§3.2). |
| X7g | Prized resale price | Accepted | The price paid (its own purchase index) (§3.4). |
| X7h | Giant RNG key | Accepted | Block + `plantedAt` (§6.2 #8, R16). |
| X7i | Coop "place" vs free drop | Accepted | The Coop arrives in the build tray at 0 coins; placing it completes the task (§2.3). |
| F1 | Two players, one tutorial step | Accepted | Two tracks, per-player first-use tips, farm naming (§7.4). |
| F2 | Tutorial coin gates | Accepted | Windmill placed at 0 coins; A6 gives the sapling (§5.3). |
| F3 | 20 systems in 96 minutes | Accepted | Drip rule (≤ 1 system per ~20 min); the slower v2 pacing spreads them over three evenings (§7.4). |
| C1 | No undo for planting | Accepted | Uproot, Smart Hand seed rule (§3.1). |
| C2 | Partner bonuses reward waiting | Accepted | Base for anyone + partner extra (§6.2, R17). |
| C3 | Personal goals on shared objects | Accepted (a, b, c) | Complementary Almanac tasks, shared credit while both online, P ribbons only for uncontested verbs (§5.4, §5.8). |
| C4 | The idle partner at L1–6 | Accepted, metric deferred | 16 plots, Coop and Feed Mill at L1, Goal Tracker domain bonus. The "second-player marginal output" simulator metric is deferred to M4 (the simulator models attention per player but not who does what). |
| C5 | The farm sleeps with the laptop | Accepted | A pre-M1 owner decision (§6.3). |
| C6 | Combo vs collision toasts | Accepted | No race toast during a combo (§6.2 #6). |
| C7 | Unlock cards for the absent partner | Accepted | Per-player seen flags, tours, non-modal banners (§6.2 #17, §7.2). |
| C8 | Click taxes (petting, Old Coins) | Accepted | Drag petting lasting the day; one coin roll per 100 coins (§3.4, §5.5). |
| G1 | Quest desert L25–40 | Accepted | 18 new quests (63 in all), the townsfolk board, Grand decor on thin levels (§5.3). |
| G2 | Land you don't need | Accepted | Plot cap + 6 per expansion (§3.10); E recalibrated. |
| G3 | Cadence mismatch | Accepted | The owner's brief: 3 evenings × 60 min; calibrations, Golden Hour per session, weekly streaks, weekly sizes (§1.5). |
| G4 | Quest slots stall | Accepted | Doable first; waiting cards say what they wait for (§5.3). |
| G5 | Wheat best per attention-hour | Accepted | Via M2; the simulator plants by revisit time (sweeps every 3 min, next presence). |
| P1 | M1 too big | Accepted | M1a "Evening One" (L1–12) then M1b (§10). |
| P2 | Simplifications | Accepted | Keep N, Wishlist, perks and rested XP to M2, Harmony cut, 2 players tuned, felt mechanics first, letter cards, Market Week folded into Mabel's value meter, renames (Friendship, dusk, blue ribbon). |
| V1 | Draw calls 220–290 | Accepted | BatchedMesh + vertex colours from M0, rigid instanced animals, ≤ 8 skinned (§8.6). |
| V2 | Faceted, not FV2 | Accepted | Creased normals, wrap lighting, painted ground, look-dev gate (§8.1). |
| Assets | Sugarcane, goat, small livestock, trees, buildings | Accepted | Bamboo for sugarcane, Gobkit goat, procedural motion + Blender, tree shape parameters, building signature props (§3.1, §3.2, §3.4, §8.1). |
| A1 | Name the farm | Accepted | §7.4. |
| A2 | Decor sets | Accepted | §3.8. |
| A3 | One pet each | Accepted | §3.4. |
| A4 | Two-seat fishing dock | **Modified** | Accepted as a together activity (§6.2 #21) but **without a Fish item**: catches are collection items and cosmetic trophies. A new raw good would need two economy uses (R4) and new recipes, and would turn a calm activity into a production chore. |
| A5 | The village grows across the river | Accepted, merged | It *is* the Town Projects sink (H4, §5.9). |
| A6 | Season postcards | Accepted | §5.9 Memory Book. |
| T1 | Superseded rules in the tech doc | Accepted | Errata in Appendix F, to be copied to the top of `tech-architecture.md` before any lane starts. |
| R11–R17 | New model checks | Accepted | R11, R13, R18 and R9 (E) implemented in `economy-model.mjs`; R14 in the simulator; R12 and R16 are server tests; R15 and R17 are design rules checked in review (§4.9). |
| sim | Simulator additions | Accepted, partly | Bloom stagger handled by the rule itself; revisit latency (sweeps); plank supply (R14); second-player output deferred (C4). |

### D.3 Things the simulator found that neither critique did

- **Non-sellable recipes were the Dairy's "best" product**: once Baby Bottles became unsellable the greedy player filled
  the Barn with 1,000 of them — rule: a building never queues a consumable nobody needs (and the UI shows "nobody needs
  this" on such a recipe card).
- **Wood windfall**: 20 starter Wood sold at minute 1 was a 5,700-coin windfall and then a plank wall; hence Pine × 8,
  cheaper Wood and the default Keep 20.
- **Making Wood unsellable was tried and rejected**: unsellable Wood from Pines flooded the Barn (87 % of play in
  overflow) — a capital good whose output has no outlet becomes a trap.
- **Town Project bundles of raw crops stalled** for weeks (long crops are rarely in stock all at once): bundles are
  donated piece by piece and use crafted goods, animal goods and fruit.
- **Quests that need two items stalled** when other recipes ate their inputs: quest recipes and "Try it" recipes keep
  their inputs aside (the Keep N rule applied automatically to the active quest's recipe).

## Appendix E — simulator summary (`node tools/econ-sim.mjs`, GDD v2 as written)

**Wave-2 QA (D1, RC-03): the pacing gate for L1–25 is `node tools/real-sim.mjs --checks`**, the reference couple
playing the REAL rules (in-process engine, Mon / Wed / Sat 60 minutes, seeds 7 / 11 / 23, 32 evenings): econ-sim models
M1b with its own simplified numbers and passed 23/23 while the rules missed L22–L25, the Fair, the barge and the Town
Projects. Its checks: L20 on day 24–38, L22 by 42, L24 by 58, L25 by 72; Fair Silver+ in ≥ 70 % of weeks; ≥ 1 full
barge row per 2 weeks; ≥ 1 Town Project by L23; every land proof counted by a rule and land opening past Fairground
Lane; treasury above 15 E-h in < 10 % of play; reported (gating with `--strict`): L20–25 both-idle ≤ 20 min and the
longest level/quest gap ≤ 40 min in 2 of 3 evenings, first evening both-idle ≤ 18 and gap ≤ 10, evenings 1–4 ≤ 75.
**econ-sim remains the model for L26–40** (and the price contract R1–R18); its M1b numbers below are the model's.

**What it is.** A plain-Node simulator (no dependencies, ~4 s per run, ~18 s for the 5-seed acceptance) that loads
`economy-model.mjs --json`, re-derives every formula, and plays the farm minute by minute with a greedy-but-sensible
couple: sweeps every 3 minutes with an attention budget of 30 s per player-minute; harvests, tends, shakes and collects;
plants the best crop for the time until somebody can next harvest it (needed crops first); keeps every queue full
(orders, crates, quests, construction and one never-made recipe per building first, otherwise the best value per minute
for the time until the next visit); fills orders, townsfolk requests and crates; enters the Fair in the last session of
the week when it pays; buys plots, buildings and homes in unlock order, the first animals and trees, expansions, barn
upgrades, anything that repays within 21 days or unblocks a bottleneck, then Town Projects and Grand decor. Not
simulated: seasons, weather, perks, pets, collections, giant crops, Restoration bundles (counted as 4 sessions), decor
beyond quest E5, Hurry, Acorn spending.

| Policy | Schedule | Players |
|---|---|---|
| `casual` (the reference couple) | Mon, Wed, Sat 20:00 × 60 min | 2 |
| `target` | every day: 10-min morning check-in (1 player) + 90 min together at 20:00 | 2 |
| `heavy` | every day: 20 + 15 min (1 player) + 150 + 15 min together — 3.3 h a day | 2 |
| `solo` | every evening 60 min, partner absent | 1 |

#### Acceptance checks (5 seeds × 4 policies; `node tools/econ-sim.mjs --checks --md`, exit 0)

Re-run after the wave-1 QA fixes (2026-10-03): crop XP exact in hundredths (RC-13), the first evening's quest graph
(RC-01), board slot 0 as the quick slot (RC-19), the first bought hen at 560 (RC-28); the simulated couple now counts
quest-gift animals outside the n-th-copy price like the game, and makes the one missing Crate before more Planks when
it alone stands between them and a purchase they can pay. Re-run after the wave-2 content changes (2026-10-03, RC-01):
the Daily Almanac from L3 (was L8), the quick order slot refilling in 5 minutes, the new first-evening card C0 and A7's
three loaves; casual L10 moved from 3.0 h to 2.6 h of play, still inside the 2.4-3.6 h window.
Re-run after the final pacing pass (2026-10-04): the simulator models the owner's Level-up Bloom (a level-up finishes
every crop, tree and animal timer; it modelled v2 X5's −25 % / 60-minute cut before) and the refitted X anchors (§4.6).
Because econ-sim's couple earns far more XP at L15–24 than the real rules (the calibration below: XP ÷ (E/8) 2.6–3.5
against the bots' 1.4–2.4), its L20–24 take 7 h where the real rules take ~15; the real-rules gate at the top of this
appendix is the authority for L1–25.

**Real rules, final pass (2026-10-04).** `node tools/real-sim.mjs --checks`: all gating checks pass on seeds 7 / 11 /
23 and on seeds 1–6 (L20 on day 26–28, L22 by 33–37, L24 by 47–56, L25 by 51–65, barge 6–10 full rows in 10 weeks,
the first Town Project by L21–L23, both-idle 10.6–19.3 minutes an evening at L20–25). Played on to L40 (170 evenings,
seeds 7 / 11 / 23), with the gate's bot and with the same bot doing four things a couple does and it does not (make the
next land's proof goods, buy the trees a goal's fruit needs, keep the next land's price in the till, clear an order card
unfillable for four days):

| Real rules, 170 evenings | before the pass | after |
|---|---|---|
| gate's bot: L20 / L25 / L30 / L35 (day) | 19–26 / 68–70 / 145–154 / 261–282 | 26–28 / 51–65 / 133–147 / 240–271 |
| gate's bot: XP an evening L25–29 / L30–34 | 31–35k / 33–37k | 32–33k / 31–37k |
| couple-like bot: L30 (day, h) / L40 (day, h) | 142–149, 61–64 h / not by day 370 (L39 at 150–157 h) | 131–145, 56–62 h / 322–355, 138–153 h |
| couple-like bot: evenings a level L25–29 / L30–34 / L35–39 | 6.6–7.0 / 8.6–9.4 / 12–14 | 7.0–7.2 / 7.4–8.8 / 8.0–9.2 |
| couple-like bot: both-idle mean L25–29 / L30–34 / L35–39 | 15.8–20.3 / 15.9–23.2 / 15.4–20.3 | 13.4–21.3 / 14.5–20.1 / 14.3–19.0 |

The gate's bot still stalls past L35 (both-idle 24–29): it never makes a land's proof goods (Stable Paddock's two Picnic
Baskets, Walnut Grove's walnuts), never raises help flags, makes compost, breeds, fishes or races the league (quest chains
C, G and H wait on those), and never clears an order card; a couple does all of these. Both-idle in the late game is the
rhythm of the quick crops (a harvest-and-replant every 8–10 minutes, 3–5 quiet minutes between), not a lack of goals: the
M2 pastimes the bots do not play (an hourly cast at the dock, Nursery care, the duel) fill exactly those minutes.

| Check | Result | Detail |
|---|---|---|
| Model contract R1–R18 (economy-model.mjs) | PASS | all checks passed |
| R1 port: simulator = model | PASS | every price, level, expansion, barn and quest matches |
| No dominated recipe (per building) | PASS | 0 of 105 |
| No dominated crop | PASS | 0 of 18 |
| No single best session crop | PASS | best per plot-hour changes 5 times: wheat → carrot → corn → tomato → sugarcane → oats |
| Pacing L5 (reference couple) | PASS | 0.7 h of play (target 0.4–1), day 0.9 (target 0–1) |
| Pacing L10 (reference couple) | PASS | 2.5 h of play (target 2.4–3.6), day 5.9 (target 4–9) |
| Pacing L20 (reference couple) | PASS | 12.2 h of play (target 10.5–16), day 29.2 (target 24–38) |
| Pacing L30 (reference couple) | PASS | 47.2 h of play (target 45–70), day 110.4 (target 100–170) |
| Pacing L40 (reference couple) | PASS | 116.8 h of play (target 110–180), day 273.2 (target 240–420) |
| No dead item (casual, 5 seeds) | PASS | every unlocked item was produced |
| No dead item (target, 5 seeds) | PASS | every unlocked item was produced |
| No dead item (heavy, 5 seeds) | PASS | every unlocked item was produced |
| No dead item (solo, 5 seeds) | PASS | every unlocked item was produced |
| Story quests all completable | PASS | every story quest completed by L40 in every run |
| Weekly quests (This week tab) completable | PASS | open at L40 in some run: g1 |
| Storage: overflow < 10 % of play; intake paused at 2× capacity < 0.1 % of units | PASS | worst 4.4 % of play in overflow; worst 0 units waited in place (0.000 %) |
| R14 materials never wall: coins ready but Planks/Crates missing < 2 % of play | PASS | worst 1.8 % of play |
| Animals fed: < 2 % hungry adult-minutes | PASS | worst 0.4 % |
| Orders valid (G-VALID) and mostly varied | PASS | 0 invalid; simple fallback orders at most 29 % |
| Coins keep mattering: treasury > 15 E-hours < 10 % of play from L20 | PASS | worst 1 % |
| River Barge fillable: >= 50 % of crates loaded | PASS | lowest 62 % of offered crates loaded |
| County Fair reachable: reference couple Silver+ in >= 30 % of weeks | PASS | 95 % of weeks |

#### Pacing robustness (5 seeds; play hours mean (min–max), mean calendar day)

| Policy | L5 | L10 | L20 | L30 | L40 |
|---|---|---|---|---|---|
| casual | 0.7 h (0.7–0.7), day 1 | 2.5 h (2.0–2.6), day 6 | 12.2 h (12.0–13.0), day 29 | 47.2 h (46.0–48.0), day 110 | 116.8 h (114.0–118.0), day 273 |
| target | 1.0 h (1.0–1.0), day 1 | 3.0 h (2.7–3.2), day 2 | 13.1 h (12.2–13.5), day 8 | 42.1 h (41.7–43.5), day 26 | 101.0 h (98.5–103.2), day 61 |
| heavy | 0.5 h (0.3–0.6), day 1 | 2.9 h (2.5–3.1), day 1 | 15.1 h (13.9–16.7), day 5 | 54.0 h (53.1–56.4), day 16 | 128.7 h (127.0–130.8), day 39 |
| solo | 0.9 h (0.8–0.9), day 1 | 3.0 h (3.0–3.0), day 4 | 14.2 h (13.8–15.0), day 15 | 49.6 h (49.0–50.0), day 50 | 124.6 h (123.0–126.0), day 125 |

#### Calibration (reference couple): measured production income ÷ E and XP ÷ (E/8) per level band

| Level band | Hours of play in the band | Production income ÷ E | XP ÷ (E/8) |
|---|---|---|---|
| L1–4 | 0.7 | 0.66 | 1.93 |
| L5–9 | 2.0 | 1.11 | 1.47 |
| L10–14 | 2.5 | 1.13 | 2.66 |
| L15–19 | 7.3 | 1.28 | 2.57 |
| L20–24 | 7.3 | 1.22 | 3.50 |
| L25–29 | 28.4 | 1.05 | 1.69 |
| L30–34 | 34.6 | 0.96 | 1.65 |
| L35–39 | 36.8 | 1.11 | 1.64 |

#### Time to reach each level, seed 1 (calendar days / hours of play)
| Lvl | casual: day / play h | target: day / play h | heavy: day / play h | solo: day / play h |
|---|---|---|---|---|
| 2 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 3 | 0.8 / 0.1 | 0.3 / 0.1 | 0.3 / 0.1 | 0.8 / 0.1 |
| 4 | 0.8 / 0.3 | 0.8 / 0.2 | 0.3 / 0.3 | 0.8 / 0.3 |
| 5 | 0.9 / 0.7 | 0.9 / 1.0 | 0.5 / 0.5 | 0.9 / 0.8 |
| 6 | 2.8 / 1.0 | 0.9 / 1.2 | 0.8 / 0.6 | 1.8 / 1.0 |
| 7 | 2.8 / 1.0 | 1.3 / 1.7 | 0.8 / 0.9 | 1.9 / 1.8 |
| 8 | 2.9 / 1.7 | 1.3 / 1.7 | 0.8 / 1.4 | 2.8 / 2.0 |
| 9 | 5.8 / 2.0 | 1.9 / 2.5 | 0.9 / 2.3 | 2.8 / 2.0 |
| 10 | 5.9 / 2.6 | 1.9 / 3.2 | 0.9 / 3.1 | 3.8 / 3.0 |
| 11 | 5.9 / 2.9 | 2.3 / 3.3 | 1.0 / 3.3 | 3.9 / 4.0 |
| 12 | 7.8 / 3.0 | 2.8 / 3.5 | 1.5 / 3.7 | 4.8 / 4.0 |
| 13 | 7.9 / 4.0 | 2.9 / 3.9 | 1.8 / 4.2 | 5.8 / 5.0 |
| 14 | 9.9 / 4.6 | 3.3 / 5.0 | 2.3 / 6.7 | 6.9 / 6.8 |
| 15 | 12.8 / 5.0 | 3.9 / 6.2 | 2.8 / 7.3 | 7.9 / 7.8 |
| 16 | 16.8 / 7.0 | 4.9 / 7.6 | 3.3 / 10.0 | 9.8 / 9.0 |
| 17 | 19.9 / 8.5 | 5.8 / 8.5 | 3.9 / 12.2 | 10.8 / 10.3 |
| 18 | 21.8 / 9.0 | 6.8 / 10.2 | 4.3 / 13.3 | 11.9 / 11.7 |
| 19 | 26.8 / 11.0 | 7.3 / 11.7 | 4.8 / 13.9 | 12.8 / 12.2 |
| 20 | 28.8 / 12.0 | 8.3 / 13.3 | 5.3 / 16.7 | 14.8 / 14.0 |
| 22 | 33.8 / 14.0 | 9.8 / 15.6 | 6.3 / 20.1 | 17.9 / 17.7 |
| 24 | 42.8 / 18.0 | 12.3 / 20.0 | 7.9 / 25.4 | 21.8 / 21.0 |
| 25 | 44.8 / 19.0 | 13.9 / 23.0 | 8.8 / 27.3 | 22.9 / 22.6 |
| 26 | 54.9 / 24.0 | 15.8 / 25.2 | 9.9 / 33.1 | 27.8 / 27.0 |
| 28 | 79.8 / 34.0 | 20.3 / 33.4 | 13.5 / 43.7 | 37.8 / 37.0 |
| 30 | 107.8 / 46.0 | 25.8 / 41.8 | 16.8 / 54.0 | 48.9 / 49.0 |
| 32 | 140.8 / 60.0 | 31.8 / 51.8 | 20.8 / 67.3 | 63.9 / 63.9 |
| 34 | 173.9 / 74.6 | 39.8 / 65.3 | 25.8 / 85.0 | 78.8 / 78.0 |
| 35 | 184.8 / 79.0 | 42.8 / 70.2 | 27.8 / 90.6 | 84.8 / 84.0 |
| 36 | 203.8 / 87.0 | 46.3 / 76.7 | 29.9 / 99.8 | 93.8 / 93.0 |
| 38 | 233.8 / 100.0 | 54.3 / 90.0 | 34.5 / 113.8 | 108.8 / 108.0 |
| 40 | 266.8 / 114.0 | 61.3 / 101.7 | 38.8 / 127.5 | 123.8 / 123.0 |

GDD v2 pacing targets for the reference couple (casual: 3 evenings × 60 min a week): L5 in the first evening (~45 min), L10 at the end of week 1 (~3 h), L20 in about a month (~13 h), L30 after 4–5 months (~56 h), L40 after about a year (~140 h).

#### Coins over time (treasury at the end of the day / level)
| Day | casual | target | heavy | solo |
|---|---|---|---|---|
| 1 | 51 (L5) | 3,116 (L6) | 24,415 (L11) | 46 (L5) |
| 2 | 51 (L5) | 12 (L10) | 7,051 (L13) | 3,549 (L7) |
| 3 | 37 (L8) | 28,368 (L13) | 36,472 (L15) | 3,708 (L9) |
| 7 | 349 (L11) | 20,707 (L18) | 140,486 (L22) | 21,375 (L14) |
| 14 | 19,076 (L15) | 478,485 (L25) | 1,563,828 (L28) | 1,125 (L19) |
| 21 | 10,448 (L17) | 728,611 (L28) | 2,587,019 (L32) | 158,357 (L23) |
| 30 | 249,947 (L21) | 849,591 (L31) | 396,279 (L36) | 891,906 (L26) |
| 45 | 1,472,783 (L25) | 838,612 (L35) | 4,091,074 (L40) | 1,757,025 (L29) |
| 60 | 1,618,637 (L26) | 3,558,553 (L39) | 4,091,074 (L40) | 151,422 (L31) |
| 90 | 1,663,767 (L29) | 2,920,266 (L40) | 4,091,074 (L40) | 557,747 (L35) |
| 120 | 1,829,924 (L30) | 2,920,266 (L40) | 4,091,074 (L40) | 2,829,275 (L39) |
| 180 | 509,659 (L34) | 2,920,266 (L40) | 4,091,074 (L40) | 4,708,563 (L40) |
| 240 | 2,887,885 (L38) | 2,920,266 (L40) | 4,091,074 (L40) | 4,708,563 (L40) |
| 300 | 2,558,257 (L40) | 2,920,266 (L40) | 4,091,074 (L40) | 4,708,563 (L40) |
| 365 | 2,558,257 (L40) | 2,920,266 (L40) | 4,091,074 (L40) | 4,708,563 (L40) |

#### Where the coins came from (whole run)
- **casual** (end L40, day 295, 127 h played): market 19 %, quests 19 %, orders 17 %, barge 9 %, townsfolk 8 %, almanac 8 %, fair 6 %, weekly meter 6 %, mastery 2 %, daily gift 2 %
  - XP from: harvest 34 %, quests 22 %, almanac 9 %, trees 9 %, orders 8 %, crafting 6 %, mastery 4 %, animals 3 %
  - spent on: town project 34,300,000, seeds 6,333,525, expansion 5,649,400, grand decor 5,580,000, slot 1,405,460, building 958,600, barn 927,900, home 285,300, second 281,000, tree 252,100
  - top market sales: cabbage 960,561, cotton 689,942, watermelon 519,114, egg 499,767, pumpkin 433,753, wood 424,118, walnut 374,211, lemon 327,939
- **target** (end L40, day 67, 112 h played): market 32 %, orders 22 %, quests 20 %, barge 6 %, townsfolk 4 %, almanac 4 %, weekly meter 4 %, mastery 3 %, fair 2 %, level-up 1 %
  - XP from: harvest 25 %, trees 22 %, quests 22 %, orders 9 %, crafting 6 %, almanac 5 %, mastery 5 %, animals 4 %
  - spent on: town project 31,600,000, expansion 5,649,400, grand decor 5,580,000, seeds 4,742,669, tree 1,972,100, slot 1,264,460, building 958,600, barn 927,900, home 285,300, second 284,000
  - top market sales: wood 978,082, cotton 939,534, walnut 907,425, peach 760,581, lemon 758,148, cherry 748,428, pumpkin 691,997, orange 634,956
- **heavy** (end L40, day 42, 140 h played): market 41 %, orders 23 %, quests 19 %, barge 3 %, almanac 3 %, mastery 3 %, townsfolk 2 %, weekly meter 2 %, level-up 2 %, fair 1 %
  - XP from: harvest 30 %, quests 21 %, trees 19 %, orders 10 %, crafting 7 %, animals 5 %, mastery 5 %, almanac 3 %
  - spent on: town project 24,700,000, expansion 5,649,400, seeds 5,608,781, grand decor 5,580,000, tree 2,969,400, slot 1,363,860, building 958,600, barn 927,900, homeupg 293,320, home 285,300
  - top market sales: cotton 2,132,995, peach 1,190,388, sugarcane 941,522, pepper 921,988, cherry 808,369, sunflower 744,303, apple 729,397, wood 673,854
- **solo** (end L40, day 136, 136 h played): market 27 %, orders 20 %, quests 17 %, barge 8 %, weekly meter 8 %, townsfolk 7 %, almanac 4 %, fair 3 %, mastery 2 %, daily gift 2 %
  - XP from: harvest 31 %, quests 21 %, trees 15 %, orders 10 %, crafting 7 %, almanac 5 %, mastery 5 %, animals 4 %
  - spent on: town project 34,800,000, seeds 6,341,231, expansion 5,649,400, grand decor 5,580,000, slot 1,439,860, building 958,600, barn 927,900, tree 825,100, home 285,300, second 274,000
  - top market sales: cabbage 2,234,278, walnut 671,432, sugarcane 658,962, wood 649,693, cherry 614,046, lemon 604,550, cotton 557,099, orange 549,947

#### Bottlenecks, storage, orders, barge, fair
| Metric | casual | target | heavy | solo |
|---|---|---|---|---|
| Idle plot share (active minutes) | 5 % | 12 % | 9 % | 13 % |
| Idle building share (active minutes) | 17 % | 22 % | 20 % | 20 % |
| Feed Mill busy (active minutes) | 95 % | 88 % | 85 % | 93 % |
| Adult animal-minutes standing hungry (active play) | 0.0 % | 0.1 % | 0.3 % | 0.0 % |
| Emergency feed bought (coins) | 1,575 | 11,085 | 20,725 | 4,493 |
| Attention-limited minutes | 8 % | 17 % | 17 % | 22 % |
| Max barn fill (stock / capacity) | 131 % | 155 % | 146 % | 164 % |
| Minutes in overflow | 0.9 % | 2.8 % | 2.3 % | 3.7 % |
| Units refused at 2× capacity | 0 | 0 | 0 | 0 |
| Orders generated / filled / discarded | 716 / 541 / 166 | 754 / 656 / 96 | 796 / 703 / 85 | 825 / 679 / 138 |
| Orders not producible at generation (G-VALID breach) | 0 (0 %) | 0 (0 %) | 0 (0 %) | 0 (0 %) |
| Orders fillable from stock at generation | 28 % | 32 % | 32 % | 27 % |
| "Simple" fallback orders | 25 % | 17 % | 28 % | 22 % |
| Order time-to-fill p50 / p90 (calendar) | 47.8 h / 119.8 h | 11.0 h / 23.8 h | 4.8 h / 17.1 h | 23.8 h / 47.8 h |
| Barge crates loaded / offered, full barges | 167 / 246, 5 of 41 | 81 / 81, 8 of 9 | 45 / 45, 5 of 5 | 137 / 162, 3 of 18 |
| Fair weeks, medals | 40: Silver III ×9, Silver I ×1, Gold III ×13, Gold I ×5, Gold II ×3, Bronze I ×1, Silver II ×6, Bronze III ×1, Bronze II ×1 | 8: Gold III ×8 | 5: Gold III ×3, Gold II ×1, Silver III ×1 | 18: Gold III ×13, Silver II ×3, Gold II ×2 |
| Fair entries (goods value) / medal coins | 1617 (1,930,016) / 3,769,200 | 194 (244,252) / 903,900 | 0 (0) / 520,875 | 806 (788,782) / 1,915,725 |
| Quest cards stuck at the end | none | none | g1 | none |
| Minutes with a story card waiting on content not yet producible | 606 | 917 | 1,127 | 624 |
| Expansions / barn upgrades bought | 15 / 10 | 15 / 10 | 15 / 10 | 15 / 10 |
| Acorns at the end | 622 | 499 | 414 | 635 |
| Treasury first above 10 E-hours (usually saving for a Town Project) | day 63, L26, 28 h | day 22, L29, 38 h | day 20, L32, 70 h | day 37, L28, 38 h |
| Unspent treasury when L40 is reached, in hours of E(L) | 10 | 11 | 10 | 11 |
| Play time from L20 with more than 15 E-hours in the treasury | 1 % | 0 % | 0 % | 0 % |
| Town Projects completed / Grand decor bought | 12 / 10 | 11 / 10 | 9 / 10 | 12 / 10 |
| Townsfolk requests filled / offered | 46 / 114 | 24 / 24 | 15 / 15 | 42 / 51 |
| Golden orders filled (of which duet goods) | 90 (20) | 89 (17) | 96 (20) | 110 (23) |
| Largest overflow stacks (mean units while in overflow) | tomato 131, pumpkin 113, cotton 103 | wood 90, onion 84, cotton 82 | blueberry 116, strawberry 87, wood 81 | cotton 102, potato 85, wood 75 |

#### Longest waits between an unlock and being able to buy it (calendar / play)
- **casual**: expansion:4 335.1 h cal / 5.2 h play; expansion:5 335.0 h cal / 5.0 h play; expansion:2 288.0 h cal / 5.0 h play; expansion:3 264.1 h cal / 5.0 h play; barn:3 216.1 h cal / 4.0 h play; expansion:6 216.1 h cal / 4.0 h play
- **target**: expansion:5 83.7 h cal / 6.2 h play; expansion:4 72.0 h cal / 5.0 h play; expansion:1 71.3 h cal / 4.3 h play; expansion:6 71.0 h cal / 4.0 h play; expansion:2 60.0 h cal / 3.5 h play; expansion:3 59.5 h cal / 4.3 h play
- **heavy**: expansion:6 72.3 h cal / 10.3 h play; expansion:7 70.4 h cal / 8.4 h play; expansion:5 60.3 h cal / 9.2 h play; expansion:3 58.9 h cal / 7.8 h play; expansion:4 56.6 h cal / 6.8 h play; expansion:8 51.8 h cal / 9.2 h play
- **solo**: expansion:3 144.1 h cal / 6.1 h play; expansion:5 144.1 h cal / 6.0 h play; expansion:2 143.3 h cal / 5.3 h play; expansion:4 143.2 h cal / 5.2 h play; expansion:1 143.2 h cal / 5.2 h play; barn:2 120.3 h cal / 5.3 h play

#### Unlocked items never produced
- **casual** (0): none
- **target** (0): none
- **heavy** (0): none
- **solo** (0): none
(simulated in 24.2 s)

#### Static analysis (no play)

**Crops — net coins per plot-hour if replanted the moment they ripen, and the value of one Compost (+1 unit)**

| Crop | Lvl | Grow | Net/plot-h | Net/planting | +1 unit (Compost) as % of net |
|---|---|---|---|---|---|
| wheat | 1 | 1 min | 120 | 2 | 100 % |
| carrot | 2 | 2 min | 150 | 5 | 80 % |
| corn | 3 | 10 min | 162 | 27 | 56 % |
| strawberry | 4 | 1.0 h | 162 | 162 | 56 % |
| potato | 5 | 4.0 h | 77 | 308 | 56 % |
| tomato | 6 | 30 min | 170 | 85 | 55 % |
| sugarcane | 8 | 45 min | 173 | 130 | 83 % |
| pumpkin | 9 | 12.0 h | 45 | 534 | 83 % |
| sunflower | 11 | 6.0 h | 67 | 402 | 83 % |
| cabbage | 12 | 24.0 h | 32 | 758 | 83 % |
| oats | 13 | 20 min | 183 | 61 | 56 % |
| blueberry | 14 | 3.0 h | 102 | 306 | 56 % |
| cotton | 16 | 10.0 h | 54 | 538 | 83 % |
| lavender | 18 | 2.0 h | 134 | 268 | 83 % |
| onion | 24 | 1.5 h | 168 | 252 | 56 % |
| watermelon | 27 | 16.0 h | 47 | 755 | 83 % |
| pepper | 31 | 5.0 h | 93 | 466 | 56 % |
| rice | 35 | 8.0 h | 75 | 599 | 56 % |

Best session crop (≤ 60 min) per plot-hour at every level: wheat, carrot, corn, tomato, sugarcane, oats; best/worst session crop per plot-hour = 1.52× (oats vs wheat).

**Recipes — value added per building-hour (a building crafts one item at a time)**

| Building | Best per hour | coins/h | Worst per hour | coins/h | Recipes |
|---|---|---|---|---|---|
| mill | flour | 540 | sugar | 438 | 4 |
| bakery | maple_pancakes | 546 | sweetheart_cake | 360 | 12 |
| sawmill | planks | 492 | toy_horse | 322 | 4 |
| dairy | baby_bottle | 492 | cheese | 360 | 7 |
| compost_bin | compost | 377 | compost | 377 | 1 |
| kitchen | hot_cocoa | 556 | truffle_pasta | 363 | 21 |
| preserves | fig_jam | 498 | sauerkraut | 280 | 10 |
| weaver | alpaca_yarn | 510 | cotton_cloth | 412 | 4 |
| sewing | alpaca_plush | 433 | quilt | 309 | 8 |
| pie_oven | fig_tart | 415 | lemon_cake | 308 | 12 |
| juice_press | watermelon_juice | 506 | apple_juice | 392 | 6 |
| chandlery | beeswax | 446 | lavender_candle | 398 | 4 |
| packing | breakfast_hamper | 376 | picnic_basket | 339 | 6 |
| oil_press | sunflower_oil | 456 | truffle_oil | 373 | 3 |
| sugar_shack | maple_syrup | 475 | maple_syrup | 475 | 1 |
| chocolatier | chocolate_truffles | 517 | chocolate | 484 | 2 |

Dominated recipes (another recipe of the same building, unlocked no later, beats them per hour AND per craft): 0 of 105

Dominated crops (another crop unlocked no later beats them per plot-hour AND per planting): 0 of 18

Wheat → Flour → Bread: 3 Wheat worth 6 coins (seed 3) become one Bread worth 96 (16.0×), in 10 machine-minutes.

Compost V = 309; one Compost on cabbage adds 632 (2.0×), watermelon adds 629 (2.0×), cotton adds 448 (1.4×), pumpkin adds 445 (1.4×). A horse cycle (2 Manure → 6 Compost) is worth up to 3,792 coins of extra crop, vs. its listed net 342.

Mastery reward pool (★1 + ★2 coins, ★1–★3 XP, all items): 3,266,670 coins and 543,445 XP. Largest: fig_tart 96,000 coins (★1 at 15, ★2 at 75); gourmet_hamper 87,000 coins (★1 at 12, ★2 at 60); chocolate_cake 84,000 coins (★1 at 14, ★2 at 70); alpaca_shawl 75,000 coins (★1 at 14, ★2 at 70); alpaca_plush 74,730 coins (★1 at 17, ★2 at 85); maple_fudge 69,300 coins (★1 at 20, ★2 at 100)

Feed Mill at full housing during active play: 41 Chicken Feed, 22 Livestock Feed, 2 Pig Slop per hour = **74 mill-minutes per hour** (one mill = 60).

County Fair: a point is 100 coins of entered goods (V / 100, one decimal); the weekly target W = E × 0.3 / 100 points; a medal pays 1.5 × the value of its threshold, so blue-ribbon crops (free points) and entries both pay like an order.

## Appendix F — errata for `tech-architecture.md` (copy to its top before any lane starts)

| Tech says | GDD v2 rule |
|---|---|
| `wallet.gems` (§2.2) | `acorns` |
| Watering is an optional **yield multiplier**; the `plant` example has `water` (§3.1 comment, §13, §16) | Optional **speed-up** on crops ≥ 30 min: −15 % anyone + −5 % partner tend (§3.1) |
| Level-up **instant ripen** of watered crops (§15.6) | **Bloom**: everything growing finishes (crops, trees, animals; not production queues). Changed by the owner 2026-10-04: a level-up finishes everything growing |
| Tree wilting and `revive` (§15.7) | Trees never wilt |
| BIG_SPEND > 30 % or > 10,000 (§15.2) | > 25 % and > 1,000 coins, or ≥ 10 Acorns in one purchase or by one player in a day |
| Late-game farm = 900 plots (§5.1, §10.12) | 16 → 164 plots (+6 per expansion); the far-band card LOD can wait until M4 |
| `ctx.ext.together` = partner active within 120 s (§6.6) | Together Combo = both act within 3 s on objects within 8 tiles; *Side by Side* uses online hours; Golden Hour = once per together session |
| Example crop wheat 2 min, seed 5 (§8.1) | Wheat 1 min, seed 2, V 2 (generated table) |
| Reservations per player with 48-h expiry | Keep N (farm-wide, no expiry) |
| Savings Jars | Wishlist |
| InstancedMesh per part, BatchedMesh as fallback (§10.3) | BatchedMesh + vertex colours by default; rigid instanced animals; ≤ 8 skinned |
| One rebase per incoming delta | Coalesce deltas per animation frame: rewind once, apply all, replay once |
| `tools/balance-sim.mjs` (§8.2) | `tools/econ-sim.mjs` (`--checks` is the CI gate) |
