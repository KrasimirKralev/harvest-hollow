# Harvest Hollow: co-op, fun and feasibility critique

Review of `docs/GDD.md` v1.0, `docs/research/tech-architecture.md` and `docs/research/assets-catalog.md`, written
2026-10-02. The reviewer's role: co-op and fun critic, plus a technical feasibility check. Section references point
into the GDD unless they name another file.

**Verdict.** The GDD is unusually rigorous. One value formula, inputs consumed at start, no withering, receipts,
soft confirms and a generated level table already remove most of the classic farm-game failures. What remains falls
into four groups:

1. A handful of real **exploits and logic bugs** that the "perfect logic" contract (§4.9) does not catch. The decor
   XP pump is infinite.
2. A **first 10 minutes** written for one player. Two players share one 12-plot field and one tutorial step.
3. **Co-op incentives that sometimes reward waiting for the partner** instead of playing.
4. An **M1 scope** that is two to three times too big to polish in the stated 2–3 weeks.

The visuals are achievable on the Vega iGPU, but only if batching and vertex colours are the default from the start
rather than a fallback.

Fixes are ranked. **P0** must be fixed in the GDD and `tools/economy-model.mjs` before the M0 contracts freeze. **P1**
must be fixed in the M1 design. **P2** is a scope or quality decision. **Add** marks a feature worth adding.

---

## 1. Ranked fix list (summary)

| Rank | ID | Sev | Area | Problem (one line) | Fix (one line) |
|---|---|---|---|---|---|
| 1 | X1 | P0 | Exploit | Buy decor → XP settles → refund unplaced decor at 100 %: infinite XP | Decor XP only for decor that stays placed; refund after settlement ≤ 50 %, or drop per-coin decor XP |
| 2 | X2 | P0 | Exploit | Discarding orders to fish for golden orders (Acorns), and Market Week counts cheap "simple" orders | Golden orders on a time schedule; Market Week and order goals weighted by order value |
| 3 | X3 | P0 | Logic | A Giant pumpkin/cabbage/watermelon yields **less** than the same 9 plots composted normally | Giant yield ≥ 1.5 × the composted normal yield, prize rolls kept |
| 4 | X4 | P0 | Dead goal | Restorer Gold needs 27 bundles, but only 24 exist; Clearing the Way Gold (400) needs debris that never respawns | Fix the tiers; add debris regrowth; add model check R11 |
| 5 | X5 | P0 | Exploit | Level-up Bloom can be timed with a staggered harvest; the GDD's claim that it "cannot be farmed" is false | Bloom skips processes started in the last 15 min, or cuts 25 % of remaining time (max 60 min) |
| 6 | X6 | P0 | Pacing wall | About 30 Planks are needed by L9–10 (end of evening one), but the Sawmill makes ≤ 4/h and wood per debris is unspecified | Specify wood yields; cut early plank costs or Planks to 10 min; simulate material supply |
| 7 | X7 | P0 | Contradictions | BIG_SPEND thresholds, festival orders, "tray never blocks", store refusal in overflow, watering vs "applied once at start", n-th tree pricing, giant RNG key | One-line rulings in §2.7 below |
| 8 | F1 | P1 | First 10 min | The shared tutorial step puts both players on the same 12 plots, and a late joiner skips all teaching | Two parallel tutorial tracks plus per-player first-use tips |
| 9 | F2 | P1 | First 10 min | Tutorial gates on coins the players don't have yet (Windmill 1,300 "refunded"; A6 asks the players to buy a 4,900 Apple Tree at L4) | Give these free up front |
| 10 | C1 | P1 | Griefing by accident | No way to undo planting: one wrong drag of 24-h Cabbage locks the field for a day | "Uproot" inside the 10-min undo window, seeds refunded |
| 11 | C2 | P1 | Perverse incentive | Partner bonuses (water 20 % vs 15 %, tree 25 % vs 20 %, bottle 50 % vs 30 %) reward leaving work for the partner | Anyone does the base action; the partner adds a stacking "tend" bonus |
| 12 | F3 | P1 | Onboarding | About 20 new systems in the first 96 minutes | Drip-feed: at most one new system per ~20 min of play |
| 13 | C3 | P1 | Contention | Personal Almanac tasks and P-ribbons on shared objects make partners race each other | Complementary task generation; shared credit while both are online |
| 14 | G1 | P1 | Goal gap | Quest desert: only 2 of 45 quests sit in L25–40, about 60 % of the play time | Chapters for L25–40 plus a repeatable weekly townsfolk board |
| 15 | G2 | P1 | Meaningless land | The plot cap tops out at 90; expansions 9–15 (110k–280k) buy space the farm cannot fill | Tie plot cap to parcels owned; raise the cap |
| 16 | C4 | P1 | Idle partner | At L1–6 one drag does all the work; the second player has nothing to do | Roles plus parallel early work (the barnyard on day one) |
| 17 | C5 | P1 | Availability | Her solo check-ins fail whenever his laptop sleeps | Decide now: an always-on host, or lid-close ignored on AC |
| 18 | G3 | P1 | Cadence | The vision says "a few evenings a week"; the calibration says 1.5–2 h every day | Pick one target; recalibrate the weekly sizes and daily pressure |
| 19 | C6 | P1 | Juice vs. collisions | The Together Combo rewards working side by side, which maximises "got there first" toasts | No toast for races while a combo is active |
| 20 | C7 | P1 | Absent partner | Unlock cards fire once, on whoever is online | Per-player "seen" flags and a "3 new things" tour |
| 21 | C8 | P1 | Click tax | Petting each animal every cycle, and the Old Coins drop per sell click | Pet with a drag brush or once a day; roll the coin drop per 100 coins sold |
| 22 | G4 | P1 | Stalls | Quest slots fill "oldest first"; a quest waiting on next-day apples blocks doable ones | Fill slots with doable quests first |
| 23 | P1 | P2 | Scope | M1 = L1–25 plus all 20 co-op mechanics plus every economy guard | M1a "Evening One" slice (L1–12), play it, then M1b |
| 24 | P2 | P2 | Simplify | Reservations, Jars, perks, Harmony, rested XP, 3–4 players, overlapping terms | "Keep N" locks, a Wishlist, cuts and renames (§6) |
| 25 | V1 | P2 | Perf | Realistic draw calls are 220–290 against a 120 target | BatchedMesh with vertex colours by default; animals instanced, ≤ 8 skinned |
| 26 | V2 | P2 | Look | Flat-shaded facets read as "low-poly indie", not FV2 | Creased normals, wrap lighting, painted ground, look-dev gate |
| 27 | G5 | P2 | Balance | Wheat stays the best crop per attention-hour forever, so new crops never feel like upgrades | Model revisit latency; tune the newest session crop to win |
| 28 | C9 | P2 | Gift | A gift from the shared barn to a shared barn is meaningless and only adds coins | A personal gift (bouquet, keepsake) for Hearts, with no coins |
| 29 | T1 | P2 | Docs | `tech-architecture.md` still states 7 superseded rules | Errata block at its top (§9) |
| 30 | A1–A5 | Add | Features | Farm naming, decor sets, a pet each, a two-seat fishing dock, a village that grows | §8 |

---

## 2. P0: exploits and logic bugs (fix in the GDD and model before code)

### 2.1 X1: the decor XP pump (infinite XP)

- **Evidence.** §3.8: "Buying decor grants **1 XP per 40 coins** (paid when the 10-minute undo window closes) …
  Stored decor refunds **100 % if never placed**, 50 % after." §4.3 repeats it: "decor 50 % (100 % if never
  placed)".
- **Exploit.** Buy 40,000 coins of decor into storage. Wait 10 minutes and +1,000 Farm XP settles. Sell it back at
  100 %. The net cost is 0. At L20 (14,000 XP to next) that is a free level per 14 cycles, and Legacy levels
  (10 Acorns each) become free. Even the placed route (50 % refund) converts coins to XP at 20 coins per XP, 2.5×
  cheaper than playing (8 coins per XP), which turns decor churn into the optimal late-game activity.
- **Fix (pick one).**
  - (a) Remove per-coin decor XP entirely; Farm Beauty stars already reward decorating.
  - (b) Grant decor XP only for decor still placed when the receipt settles, refund settled decor at ≤ 50 %, and
    claw nothing back. The cost is then 20 coins per XP, which still beats play. Also cap decor XP per day at
    E(L) × 0.25 h / 8.

  **(a) is recommended.** It is the simplest, and it removes a sink that competes with production.
- **Model check to add.** R12: for every purchasable object, `refund(after settle) + value granted at settle ≤
  price`, where XP is valued at 8 coins.

### 2.2 X2: order fishing (golden orders, Market Week, order-count goals)

- **Golden orders.** §5.2: "1 order in 10 (hash)", and a discarded slot refills in 15 min. Golden-ness rides on
  the order counter `n`, so discarding raises the golden rate linearly. Five slots give 20 orders an hour, which is
  about 2 Acorns an hour, against a design budget of about 5 Acorns a day (§4.1: 450–500 in three months). Acorns
  buy Hurry, Golden Seeds and luxury decor, so their scarcity is the point.
- **Market Week and order counts.** "15 / 30 / 45 orders filled" pays E × 0.5 h + E × 0.75 h + E × 1 h coins plus
  9 Acorns a week. The generator guarantees "simple orders" (one crop ≤ 30 min) whenever fewer than 2 slots are
  fillable. So: discard the hard orders → simple wheat orders appear → 45 near-free fills a week. The same counts
  feed *Good Business* (25/250/1000), Almanac "fill 1 order" and Couple Challenge "fill N orders".
- **Fix.**
  - Golden orders come from a **time schedule**: the first order generated after each 6-hour boundary is golden,
    independent of `n`.
  - Market Week, *Good Business* and challenge templates count **order value** (Σ 1.5 V of filled orders, as
    fractions of E(L) × 0.25 h), not order count.
  - A simple order counts 0.25.

### 2.3 X3: giant crops are a yield loss on the iconic crops

- **Evidence.** §6.2 #8 gives the giant's yield as `9 plots × yield × 1.5`. The same 9 plots composted normally
  yield `9 × (yield + 1)`, plus a 10 % prized roll each (+1).

| Crop yield | Giant | Normal composted (expected) | Giant vs normal |
|---|---|---|---|
| 1 (Pumpkin, Cabbage, Watermelon) | 13.5 | 18.9 | **−29 %** |
| 2 (Sunflower, Cotton, Lavender…) | 27 | 27.9 | −3 % |
| 3 (Corn, Potato, Tomato…) | 40.5 | 36.9 | +10 % |

  The giant pumpkin is the image of the feature, and it is the worst case. A player who takes the 20 % chance loses
  goods and spends 6 extra chops.
- **Fix.** `giant yield = round(2 × 9 × (yield + 1))`, plus the 9 prized rolls, plus +25 Fair points. Key the roll on
  `hash32(farmSeed, 'giant', blockMinCornerTileId, plantedAt)`. "Hash of the block" alone would make some field
  positions permanently lucky.
- **Model check.** R13: every bonus variant (giant, prized, premium, duet) is worth ≥ its base variant.

### 2.4 X4: unreachable ribbons and finite sources

- **Restorer Gold = 27 bundles**, but 6 projects × 4 bundles = 24. Gold can never be reached.
- **Clearing the Way Gold = 400 debris.** The finite debris totals 24 at the start plus 10–20 per expansion × 15,
  about 250–325. No respawn is specified anywhere. The Lost Tools collection also needs debris.
- **Fix.**
  - Restorer tiers 4 / 12 / 24.
  - Debris regrowth: one weed or rock on a random free unlocked tile per real hour, capped at 12 on the board. It is
    also a gentle 1-minute goal forever.
- **Model check.** R11: every achievement tier and every collection item is reachable from the content, with each
  finite source counted.

### 2.5 X5: Level-up Bloom can be timed

- **Evidence.** §3.1 rule 9 and §4.6: every running timer moves 60 min forward at level-up. The design says it
  "cannot be farmed".
- **Exploit (L8 → L9, 26 plots of Strawberry, 1 h, 37 XP fresh).** Harvest 19 plots (703 XP, just under 710),
  replant those 19, then harvest one more. The level-up blooms the 19 fresh plantings straight to ripe. Every level
  then yields one free full cycle of every ≤ 60-min process on the farm. From L1 to L15 levels come every 2–90
  minutes, so this compresses early pacing by an estimated 20–35 %. It also teaches meta-play ("plant before the
  bar fills").
- **Fix.** Bloom acts only on processes started ≥ 15 min before the level-up, **or** it cuts 25 % of the remaining
  time (max 60 min). The celebration ripple stays. Add the stagger policy to `balance-sim`.

### 2.6 X6: the plank wall on evening one

- **Plank demand by L9–10** (≈ 1.5 h in), about 30 Planks:
  - Barn upgrade 1: 4
  - Expansion 2: 4
  - Expansion 3: 6 + 1 Crate (2)
  - Barn upgrade 2: 6
  - A8: 4
  - E3, 2 Crates: 4
- **Supply.**
  - The Sawmill turns 2 Wood into 2 Planks in 30 min, one batch at a time: at most **4 Planks an hour** at L6.
  - The wild Pine from expansion 1 gives 4 Wood per 8 h.
  - The A8 Pine sapling takes **16 h** before its first wood.
  - Wood per debris piece is **not specified** (§2.3 only says "first Wood").
- **Effect.** Barn upgrades and expansions 2–3 stall on wood for 1–2 days. Meanwhile the 200-item barn (sized for
  two evenings without selling) fills up. This is not a dead end, but it is the first "nothing to do but wait" wall.
  It also contradicts §4.3's "Everything new is affordable on arrival".
- **Fix.**
  - Wood yields: weed 0, rock 0 (stone is cosmetic), log 3, stump 2, big stump 6, boulder 0.
  - Early plank costs: Barn 1 → 2, Barn 2 → 4, Expansion 2 → 2.
  - Planks recipe 10 min until L12.
  - Model check R14: for each level band, material supply in the band's target time ≥ the material costs gated in
    that band.

### 2.7 X7: rule contradictions (one-line rulings)

| # | Conflict | Ruling |
|---|---|---|
| a | BIG_SPEND: GDD §6.3 says "> 25 % and > 1,000 coins, or ≥ 10 Acorns"; tech §15.2 says "> 30 % or > 10,000" | GDD wins; add Acorns spent per player per day ≥ 10 (Hurry, §4.3 C8) |
| b | §5.2 says orders "never … festival items"; §5.10 says festival items are "orderable only during their festival" and tickets come from festival orders | Festival items are orderable only while their festival runs |
| c | §3.5 rule 2 says "the tray never blocks"; §3.6 says goods wait in trays at 2 × capacity | Trays hold goods at 2 × capacity; queueing stays allowed until the slots fill |
| d | §3.6 says "buying from the store is refused while in overflow" | Only **item** purchases (emergency feed, Golden Seeds). Overflow starts at 1 × capacity, a normal state, so blocking buildings, decor or expansions there would be a hidden hard stop |
| e | §4.8 says time effects are "applied once at the start", but watering and rain act later | Watering rewrites `readyAt = max(plantedAt + 0.5 × base, readyAt − k × base)`; the floor uses base time |
| f | §3.2 prices the n-th tree × 1.35^(n−1); do free trees (A6, expansions 1/2/12) count? | Free trees do not count toward n |
| g | §3.4 rule 7: a prized animal sells at "100 % of its current price" | "Current price" = the price of the n-th animal of the species, n = its own purchase index |
| h | §6.2 #8 giant roll "hash of the block" | Key it on the block plus `plantedAt` (§2.3) |
| i | Tutorial step 2:30 "Free Coop and Feed Mill drop in", but A3 asks to "place 1 coop" | The Coop arrives in the build tray at 0 coins; placing it completes the task |

---

## 3. The first 10 minutes (P1)

The solo script in §7.4 is good: a 1-minute wheat crop, L2 at about 1:45, a fly-to-barn harvest, a level every 2–3
minutes. The problems all come from there being **two** people.

### 3.1 F1: two players, one tutorial step, one 12-plot field

- Both see "Drag across the plots to plant Wheat" at 0:20. Both drag the same 12 plots. The first co-op moment is a
  burst of "Mia got there first" toasts and predictions rolling back.
- The steps are farm-scoped quest tasks. A partner who logs in at minute 3 sees those steps already done and **never
  learns** drag-paint, the Sickle or the Feed Scoop.
- **Fix: two parallel tracks from 0:20, auto-assigned by who acts first and swappable.**
  - Track **Fields** (A1, A2, A4): plant, harvest, sell, the first order.
  - Track **Barnyard** (A3 split out): clear the 8 weeds and 2 rocks, place the free Coop, make Chicken Feed, feed
    the hens.
  - Both tracks meet at A5 (Windmill) for a shared beat: "Make Flour together" as a mini duet, normal time, a heart
    burst.
  - A solo player gets both tracks one after the other.
- **Per-player first-use tips**, keyed by player and not by farm progress: the first time each player holds the
  Sickle, the Seed Bag or the Feed Scoop, or opens a building panel, a 3-second non-blocking hint shows.
- Add a 20-second **"Name your farm"** moment at 0:05 (§8 A1). It is the first co-op decision, it is low stakes,
  and it is emotional.

### 3.2 F2: tutorial coin gates

- **A5** "build 1 mill … cost refunded": the coins arrive only after building it. A tally at ~6:00:
  - Start 300, seeds −108, level-ups +720, quests A1–A4 +335, sales and the first order +88.
  - That is about **1,335 coins** against the Windmill's 1,300, or about 1,600 if B1 (3 orders) is already done.
    One Flower Bed (160) or an extra planting puts the players under the price, and the tutorial stalls in its 6th
    minute.
- **A6** "plant 1 apple_tree" at L4 (about 9 min, roughly 1,500 coins). The Apple Tree costs **4,900**, and the
  reward for the task is a free Apple Tree sapling. The order is reversed.
- **Fix.** The Windmill "repair" is a placement at 0 coins. A6 *gives* Grandma's sapling and asks the players to
  plant it plus 6 Strawberry.

### 3.3 F3: onboarding overload

- **What arrives by L10.** The unlock table hands out about 20 systems in the first 96 minutes: orders, help flags
  and pins, the daily gift and streak, Golden Hour, expansions, barn upgrades, the weekly Couple Challenge, mastery,
  babies, compost and prized crops, the Almanac, Savings Jars, pets, duets, collections and tools. On top come
  8 buildings and about 25 recipes. FV2 was fast early, but it taught one system at a time.
- **Who it hits.** The person who suffers here is the partner who is less of a gamer.
- **Fix: a drip rule.** A *content* unlock (a crop, a recipe) can arrive every level. A new *system* surfaces at most
  once per ~20 minutes of farm play time, queued if its level arrived sooner, and gets a 1-card explanation. Push
  these later:
  - the Almanac to L8 on day 2 or later;
  - the weekly Couple Challenge to the first Monday after L6;
  - Savings Jars to the first purchase over 50 % of the treasury;
  - collections to the first drop, which explains itself.

### 3.4 C7 / F4: celebration and unlock UX

- Level-ups land every 2–3 minutes early on, on both screens at once. If the unlock card is modal, it interrupts the
  partner's drag. **Make level-up cards non-modal**: a banner plus a "New!" tray badge, with "Show me" on demand.
- **The absent partner.** Story beats have per-player "seen" flags (§6.2 #19), but unlock cards do not. Add them to
  the recap: "While you were away: 3 new things unlocked (Cow, Dairy, Butter) — Show me".

---

## 4. Co-op friction (P1)

### 4.1 C1: no undo for planting

- **Where it comes from.**
  - §9 #10: "removing a planted plot is not possible".
  - §3.1: no uproot action exists.
  - The Smart Hand "plants the last-used seed on an empty plot", which may be yesterday evening's 24-h Cabbage.
- **What one bad drag costs.** A drag-paint of the wrong seed across 30 plots locks the field for up to 24 hours,
  and possibly the partner's whole evening loop. It is the single most likely accidental grief in the game.
- **Fix.** Add **Uproot** (Hand, or a drag with Shift):
  - within the 10-minute undo window, refund 100 % of the seed;
  - after it, 0 %;
  - no XP either way, because XP is paid only at harvest, so there is no exploit;
  - the toast names the player.

  The Smart Hand plants on an empty plot only if the last seed was chosen in this session by this player; otherwise it
  opens the seed tray.

### 4.2 C2: partner bonuses that reward waiting

| Mechanic | Self | Partner | Rational solo behaviour |
|---|---|---|---|
| Crop watering (§3.1 rule 3) | −15 % | −20 % | Leave her night crops dry so he can water them in the morning |
| Tree watering (§3.2 rule 4) | −20 % | −25 % | Don't water a tree you just harvested |
| Baby Bottle (§3.4 rule 3) | −30 % | −50 % | Never bottle your own babies |

These invert the intuitive play ("I tend what I planted") and make a solo session hesitant. That conflicts with
pillar P3, "never blocked".

**Fix: a stacking structure.** Anyone may do the base action at the full base effect (−15 % / −20 % / −30 %). One
**additional** "partner tend" by the other player adds −5 % / −5 % / −20 % on top, with the same caps. Nobody ever
gains by waiting, and the partner is still rewarded. Apply the same rule to help flags: self-fill gets the base
reward; the partner's fill adds +10 % XP and a Heart, as now.

### 4.3 C3: personal goals on shared objects

- **Which goals collide.** The Almanac (4 personal tasks: "harvest N corn", "collect N"…), *Fresh Picker*, *Gentle
  Hands* and *Lucky Find* all count only the actor.
- **What happens.** On a shared farm, the partner harvesting "your" corn erases your task progress, and couples
  learn to race. That breaks the co-op mood more than any mechanic helps it.
- **Fix.**
  - (a) Generate the two players' Almanac tasks to be **complementary**: different crops, buildings or animals,
    and never the same target object class.
  - (b) While both are online, an action by either player counts for both players' tasks of that type.
  - (c) P-ribbons stay personal but count only verbs that cannot be taken from the partner: plantings, petting,
    gifts, decor placed.

### 4.4 C4: the idle partner at L1–6

- **The arithmetic.**
  - 12 plots and 1–2-minute crops, so one sweep takes 3 seconds. A second player adds no output.
  - E(L) is plot-bound (§4.4), so the second player's whole contribution early on is attention, and there is little
    to attend to.
- **When it stops mattering.** Mid-game the work is the panel work: 14 buildings × 2–6 slots, orders, the barge. Two
  people raise utilisation there.
- **Fix.**
  - Start with 16 plots.
  - Bring the Coop and Feed Mill at L1, not L2. The barnyard is the second player's first job.
  - The Goal Tracker's NOW card should prefer **different domains** for the two players. It already subtracts
    "partner is doing it"; add "+score if a different domain than the partner's last 3 actions".
  - Let `balance-sim` report "second-player marginal output" per level band, and treat < 1.2× at L1–6 as a signal.

### 4.5 C6: collisions vs. combo

The Together Combo needs both players acting within 3 s on objects within 8 tiles, which is exactly when they race
for the same plots. **Fix.** While a combo is active, a lost race shows no toast. The lost plot's floater turns into
a small shared heart spark ("together!"), and the combo meter still counts the attempt.

### 4.6 C5: availability ("the farm is asleep")

- **The limit.** The server runs on the owner's laptop (tech §12). Her 10-minute check-in (§1.5) works only while
  that laptop is awake, on, and on the same LAN.
- **Why it matters.** This is the biggest real-world co-op risk, and it is not a design problem.
- **What to decide before M1.** Either an always-on box (any old laptop, mini-PC or NAS: the data dir is portable),
  or logind lid-close ignored on AC power.
- **Optional.** Tailscale is already on the owner's machine and would allow check-ins away from home with zero game
  code. The owner should decide whether that breaks the "LAN" requirement.

### 4.7 C8: click taxes and spam incentives

- **Petting** (§3.4 rule 6): a click per animal per cycle per player, for +10 % / +20 % bonus chance. With 60
  animals on 20-min to 6-h cycles, that is a click tax the GDD rejected for fast-crop watering. **Fix:** the Hand
  drag pets everything under the stroke; or petting lasts the whole day.
- **Old Coins** (§5.5): one roll "per sale action", which rewards selling 1 Wheat at a time, 40 times. **Fix:** one
  roll per 100 coins of sales (min 1 per sale).

### 4.8 Smaller co-op items

- **Hurry drains shared Acorns** (max 8 per use, below the 10-Acorn BIG_SPEND threshold). Count Acorn spending per
  player per day toward BIG_SPEND (ruling X7a).
- **Discarding an order the partner pinned** ("I'm on it") needs a soft confirm. It is display-only today.
- **Moving plots and buildings** has no undo; only decor has pins. Add a 10-minute "move back" to every move (reuse
  `pinnedMoved`).
- **Pets** (L10): one dog that "follows whoever fed it" invites a tug of war. **Each player adopts one pet** (dog or
  cat): personal identity, and no contest (§8 A3).
- **Tone.** "Grandma's **Last** Letter" (A11), "Grandma's Journal" and "Grandma's Rocking Chair: plays a memory
  line" all read as her death, against "nothing bad ever happens" (§8.1). Rename A11 "Grandma's Long Letter" and
  have Grandma **visit** at the Restoration 6 finale and the Farm Anniversary.
- **Personal level on the portrait** invites comparison (§6.3 "no partner leaderboard"). Show the title and perk
  icons, and keep the number on the Stats tab.

---

## 5. "Always a next goal": horizon audit

| Horizon | L1–10 (evening 1) | L11–20 (week 1) | L21–30 (weeks 2–4) | L31–40 (months 2–3) | After 40 |
|---|---|---|---|---|---|
| 1 min | yes | yes | yes | yes | yes |
| 10 min | yes | yes | yes (crafting) | yes | yes |
| 1 hour | yes (levels) | yes (levels, quests) | **weak**: a level every 3–6 h, quests nearly gone | **weak**: a level every 6.5–10.5 h, 1 quest | Legacy every 5–6 days |
| 1 day | **plank wall** (X6) | yes | yes | yes | yes |
| 1 week | yes (L6+ challenge) | yes (Fair, Barge from L14–15) | yes | yes | yes |
| 1 month+ | weak (none until L16) | Restoration | Restoration, track | Restoration 6 | Showcase, coats, Gold ★ |

### 5.1 G1: the quest desert from L25 to L40

- **The count.** 43 of the 45 quests sit at L1–25; only C7 (L25) and D6 (L30) are later.
- **Why it hurts.** L25–40 is about 90 of the 140 hours (§4.6). The hour horizon then rests on the Almanac and
  orders, which are repetitive, and the story stops.
- **Thin levels.** L29 (5.5 h of play) unlocks only "golden orders 1 in 7". L38 unlocks one decor.
- **Fix.**
  - Chapters I–K for L25–40: Restoration 4–6 story beats, Grandma's visit, the river village (§8 A5).
  - A **weekly townsfolk board** with 3 generated multi-step requests per week. It reuses the quest machinery and
    G-VALID.
  - Every level with only a "feature tweak" also gets a decor or outfit unlock.

### 5.2 G2: land you don't need

- **The cap.** The plot cap tops out at 90 plots (+12 in the Greenhouse) on 2,304 farmable tiles.
- **Estimated L40 use:**
  - plots 90;
  - about 39 trees × 4 = 156;
  - about 20 buildings × 8 = 160;
  - homes and hives ≈ 120;
  - Farmhouse and Barn 32;
  - decor about 200.

  That is about **760 tiles, a third of the land**. Expansions 9–15 cost 110k–280k coins for lawn.
- **Two more costs.**
  - FV2's visual appeal is fields of crops. A 10 × 9-tile field on a 96 m farm looks sparse.
  - The tech doc sized everything for 900 plots (tech §5.1, §10.12): ten times the GDD.
- **Fix.** Plot cap = `12 + 1.5 × (level − 1) + 6 × expansions owned`. That gives about 160 at L40 with all 15
  expansions, so land is production again, and fields look like FV2. Regenerate E(L) with the model; the rendering
  cost is small (§7).

### 5.3 G3: cadence

- **The mismatch.** §1.1 says "a few evenings a week"; §4.6 and §5.4 calibrate for "~1.5–2 h a day". At a realistic
  3 evenings × 1.5 h:
  - L20 moves from week 1 to week 3;
  - L40 moves from 2.5 to about 7 months;
  - the daily systems become pressure: the Almanac double pay "first 5 per day", the daily calendar, Golden Hour
    "once per real day".
- **Fix.** Ask the owner which cadence is real, and calibrate the model to it. Under "few evenings":
  - Golden Hour becomes once per *play session together* (max one per 8 h);
  - the Almanac double pay works per session, not per day;
  - weekly targets are sized for 4–6 engaged hours.

### 5.4 G4: quest slots stall

- **The rule.** "Up to 3 active (one per chain, oldest first)". A chain waiting on next-day apples (B2 at L6) holds
  a slot while doable chains wait.
- **Fix.** Fill slots with quests whose next task is doable within the SOON horizon first, and show stalled ones as
  "waiting for apples (ready tomorrow 08:40)".

### 5.5 G5: wheat stays the best crop per attention-hour

- **The table.** §3.1 shows Wheat at 300 net/plot-h; every later crop is lower (Oats 216, Tomato 188). The +1.5 %
  per level is too small to matter, so unlocking a crop never raises income per hour of play.
- **Why reality is better than the table.** With a realistic ~2-minute revisit latency (walking, panels, partner
  chat) the effective rates reorder:
  - Wheat 5 / 3 min = 100/h
  - Corn 34 / 12 min = 170/h
  - Oats 196/h
  - Tomato 176/h

  Mid-length crops already win.
- **Fix.** Put revisit latency into the formula and the sim (`effective = net / (grow + 2 min)`), and tune so the
  newest session crop of each band is the best per effective hour. New unlocks then feel like upgrades.

---

## 6. Scope: what to simplify for the first build (P2)

### 6.1 P1: M1 is too big

M1 is meant to be the "first playable", but it bundles a great deal into 2–3 weeks:

- **Content:** L1–25, 15 crops, 8 trees, 8 animals, 14 buildings, 76 recipes, 44 quests with story vignettes,
  62 ribbons, 8 collections.
- **Weekly and long goals:** Fair, Barge, Couple Challenge, Market Week, Restoration 1–3, Farm Beauty.
- **Co-op:** all 20 co-op mechanics.
- **Economy guards and the rest:** jars, reservations, pins, BIG_SPEND, undo and trash, ledger, perks, rested XP,
  day/night, rain, and the full SFX set.

The owner's first priority is "mechanics perfect". That favours a small set that is polished and play-tested, not a
large one.

**Proposal.**

- **M1a "Evening One" (≈ 2 weeks).** L1–12 and its content: 9 crops, Apple and Pine, chickens and cows, Feed Mill,
  Windmill, Bakery, Sawmill, Juice Press, Dairy, Kitchen, Compost Bin. Plus:
  - orders (value-weighted), quest chains A, B, C and E to L12;
  - the Goal Tracker, the recap and feed, notes and pings;
  - partner tend (C2), duet (Sweetheart Cake), Golden Hour, high-five;
  - undo and Uproot, BIG_SPEND toast, ledger, "Keep N" locks;
  - the locked look-dev, frame pacing, quality tiers.

  The couple plays it for real for a week, and tuning comes from that week.
- **M1b.** L13–25 content, the Fair, the Barge, Restoration 1–3, perks, Farm Beauty, giant crops.

### 6.2 P2: simplifications

| Current | Simpler | Why |
|---|---|---|
| Reservations: per player, purpose, 48 h expiry, reserver-named confirms (§6.3) | **"Keep N"** per item: one farm-wide number; selling, feeding or gifting below it soft-confirms | Solves "you sold my eggs" and feed protection with one rule and no expiry logic |
| Savings Jars: named jars, linked purchase, partner-approval release after 12 h | **Wishlist**: add a shop item, deposit coins, it buys itself when funded; withdrawing a partner's wishlist coins asks them | The same protection framed as a shared goal, the couple's favourite thing to plan |
| 4 perk trees + Harmony + weekly respec + personal level → perk points | Defer to M2; M1 keeps personal level as cosmetic titles | Perks add math, not feel; Harmony is invisible |
| Rested XP | Defer; the recap + gifts cover the "Welcome back" feeling | Personal XP is invisible in the economy |
| 3–4 players (§6.6) | Keep `players` generic; don't design, tune or test for > 2 in v1 | The owner asked for two |
| 20 co-op mechanics | Ship the **felt** ones first: presence, pings/notes, partner tend, duet, Golden Hour, high-five, giant chop, help flags, recap. Defer: petting-together, pets' treasure, Equal Partners rolls, Harmony, Friendly Duel | Micro-bonuses of +5 % nobody sees add rules without joy |
| Story vignettes (camera + bubbles) in M1 | Illustrated letter cards in M1; vignettes in M3 | The vignette system is a mini cutscene engine |
| Market Week + Couple Challenge + Fair + Barge (4 weekly meters) | Keep Fair, Barge and Couple Challenge; fold Market Week into the orders board's value meter | Fewer weekly checklists; Market Week is the exploit-prone one (X2) |
| Currencies and terms | Rename NPC "friendship hearts" → **Friendship**; the 40-min sky "golden hour" → **dusk**; unify *Prized / Premium / Prize Fruit* as **Blue-ribbon** (crop, fruit, good) | Hearts and Golden Hour each mean two different things today |

---

## 7. Visual and performance feasibility on the Vega iGPU

### 7.1 V1: draw calls, in a realistic count

An L25 farm at the mid zoom band, with the GDD's content and the catalog's assets as-is:

| Family | Naive (InstancedMesh per part) | With the fix |
|---|---|---|
| Crops: ~15 visible (crop, stage) combos × 1–4 materials | 40–60 | **1–2**: one `BatchedMesh`, colours baked to vertex colours (tech §10.8 already plans it) |
| Trees: 8 species × stages × 2–3 parts | 25–35 | **1–2**: the same batch path |
| Buildings, homes, farmhouse, barn (~26) | 26–60 (4–10 materials each) | **4–8**: palette + join, static ones in one BatchedMesh, animated blades separate |
| Decor (~20 types) | 20–40 | **2–4** |
| Animals: ~50 skinned (8 species, 1–3 materials each) | **50–100** | **8–15**: rigid InstancedMesh per species with vertex-shader bob/waddle/peck; ≤ 8 skinned near the camera or being tended (tech says ≤ 40, too many) |
| Avatars, fences, paths, ground, sky, water, badges, FX, blobs | 15–20 | 15–20 |
| **Total** | **≈ 220–290** | **≈ 40–60** against the 120 target |

**Make `BatchedMesh` + vertex colours the default from M0**, not the fallback (tech §10.3). The crop stage swap
becomes `setGeometryIdAt`, and the sway attribute is already designed for it.

### 7.2 Triangles and the rest of the frame

- **Triangles.**
  - Pumpkin (2.9k), Watermelon (2.6k), Tomato (1.5k) and Corn (958) stage-4 meshes × several plants per plot exceed
    the 300k budget at the far band.
  - **Fix:** `gltf-transform simplify --ratio 0.3–0.5` on stage 4 of the ground and bush archetypes, and 1 plant per
    plot for ground crops (the catalog already advises it).
  - With the G2 plot cap (~160), crops stay under about 120k triangles.
- **Rebase cost while both drag.** The server sends one `d` per action. Coalesce incoming deltas per animation frame:
  rewind once, apply all, replay pending once. Otherwise a 70-plot partner drag triggers 70 rewind/replay passes.
- **The partner's PC is unknown.** Run the M0 skeleton on her machine and record its tier before the look is locked.

### 7.3 V2: reaching the FV2 look with flat CC0 assets

- **The gap.** FV2 reads as soft, rounded and painterly. Flat-shaded Quaternius reads as faceted indie low-poly.
- **The cheap levers.** None needs post-processing:
  1. **Creased normals** at build time (`BufferGeometryUtils.toCreasedNormals(geo, 40°)`) on organic meshes:
     canopies, animals, crops, rocks. Keep flat only on architecture.
  2. **Wrap (half-Lambert) diffuse plus a warm rim term** in the Lambert shader via `onBeforeCompile`: soft
     shadow-side fill, with no extra pass.
  3. **A painted ground:** a canvas-generated grass texture with mowing stripes and colour noise, plus a
     vertex-colour AO footprint under every object (the GDD's "footprint AO texture").
  4. **Saturation +10–20 %** per material name (catalog §5), with toy scale on animals and avatars.
  5. **The look-dev gate.** A 16 × 16-tile hero scene screenshotted next to
     `sources/fv2-reference/fv2-farm-overview.jpg` and `fv2-ready-crop-sparkle-late-game.jpg`. The owner signs it off
     before any content work. M1 lists it; make it a hard gate with the reference pair attached.

### 7.4 Asset gaps the GDD does not cover yet

| Gap | Fix |
|---|---|
| **Sugarcane** has no mapping in the GDD (archetype `tall`) | QC `Bamboo_1…4` recoloured is a near-perfect sugarcane |
| **Goat** as a recoloured Deer will read as a deer (long legs, slender) | Shorten the leg bones by scale on the bind pose, or accept Gobkit `Goat` with a matched material pass |
| **Sheep and pig** have only Idle and Jump; chicken and duck are static | Use procedural rigid motion for all small livestock (consistent with V1). **Install Blender** (`apt install blender`): it unlocks vertexcat's animated `.blend` sources and quick hand rigs, the highest-leverage asset step |
| **13 trees from 2–3 meshes**: pear on an orange-tree mesh, olive and fig on CommonTree | Per-species shape parameters (canopy scale XYZ, trunk height, lean), plus fruit colour and size. Olive: silver-green canopy, squat. Pear: tall narrow. Peach: wide low |
| **About 10 production buildings from 3–4 house meshes** cannot be told apart at mid zoom | Signature prop + roof colour rule: a giant pie on the Pie Oven, a barrel on the Juice Press, a spool on the Weaver, jars on the Preserves Kitchen, plus a unique roof hue and the icon badge on hover |

---

## 8. Additions worth making (ranked)

| # | Feature | Why | Cost | When |
|---|---|---|---|---|
| A1 | **Name the farm + gate sign**: a joint 20-s naming at the start; the name is carved on the gate sign that already upgrades with the streak (§5.8), shown on the loading screen and Memory Book pages | The cheapest high-emotion co-op moment; `farm.name` already exists in tech §2.2 | tiny | M1a |
| A2 | **Decor sets with set bonuses**: 4–6-piece themed sets (Cottage Garden, Harvest Fair, Seaside, Winter Lights) whose completion gives +beauty, a cosmetic effect (butterflies, lanterns, a ribbon) and a ribbon. Cosmetic and beauty only, never production | Gives the decor sink direction and a collect-the-set goal at the week and month horizons; pure data | small | M1b |
| A3 | **One pet each**: each player adopts a dog or cat, names it, and it follows *them*; the daily treat and gift as now | Personal identity on a shared farm; removes the "follows whoever fed it" tug | small | M1b |
| A4 | **Two-seat fishing dock** (Willow Pond, L21, or the creek from L5): sit together, a calm 20-s timing cast, once per hour each. Catches are Pond Treasures (collection), a Fish item used only in pet treats and one Kitchen recipe (to pass R4), and a weekly "biggest fish" trophy | A relaxed *together* activity that is not about the economy; FV2 couples loved idle side-activities | medium | M2 |
| A5 | **The village grows across the river**: Barge loads and Restoration feed a visible village (houses light up, a market opens, a bridge, a festival stage) | A late-game sink for goods and coins with a visible, shared result; it fills the L25–40 desert (G1) | medium | M2 |
| A6 | **Photo booth poses** (exists as photo mode): add a framed "season postcard" auto-page every real season | Cheap; the Memory Book becomes their scrapbook | tiny | M3 |

Considered and rejected: a co-op "market rush" real-time minigame (it pressures the cosy tone), and partner
leaderboards of any kind.

---

## 9. T1: superseded rules still in `tech-architecture.md`

Build agents read both docs, and the tech doc states these rules as decisions. Add an errata block at the top of
`tech-architecture.md` before any lane starts:

| Tech says | GDD rule |
|---|---|
| `wallet.gems` (§2.2) | `acorns` |
| Watering is an optional **yield multiplier**; the `plant` example has `water` (§3.1 comment, §13, §16) | Optional **speed-up** on crops ≥ 30 min (§3.1, Appendix C) |
| Level-up **instant ripen** of watered crops (§15.6) | **Bloom** +60 min (and the X5 fix) |
| Tree wilting and `revive` (§15.7) | Trees never wilt |
| BIG_SPEND > 30 % or > 10,000 (§15.2) | > 25 % and > 1,000, or ≥ 10 Acorns |
| Late-game farm = 900 plots (§5.1, §10.12) | 90 plots now (about 160 with G2); the far-band card LOD can wait until M4 |
| `ctx.ext.together` = partner active within 120 s (§6.6) | Together Combo = both act within 3 s on objects within 8 tiles; *Side by Side* uses online hours |
| Example crop wheat 2 min, seed 5 (§8.1) | Wheat 1 min, seed 3 (generated table) |

---

## 10. Checks to add to `tools/economy-model.mjs` and the tests

| # | Rule | Catches |
|---|---|---|
| R11 | Every achievement tier and collection item is reachable, with finite sources counted | X4 |
| R12 | Refund + value granted at settle (XP at 8 coins) ≤ purchase price, for every object | X1 |
| R13 | Every bonus variant (giant, prized, premium, duet) ≥ its base variant in expected value | X3 |
| R14 | Per level band, material supply (wood, planks, crates) within the band's target time ≥ material costs gated in it | X6 |
| R15 | No reward is paid per *count* of an action whose cost the player controls (orders filled, sell clicks); rewards scale with value | X2, C8 |
| R16 | Every `hash32` roll key includes a per-object cycle or `plantedAt` | X7h |
| R17 | No co-op bonus is larger than the solo base when stacked as "base + partner extra" (no reason to wait) | C2 |
| sim | `balance-sim` adds: the Bloom stagger policy, revisit latency, second-player marginal output, plank supply, and "minutes with nothing to do" per band (target < 10 % after day 1) | X5, G5, C4, X6 |
