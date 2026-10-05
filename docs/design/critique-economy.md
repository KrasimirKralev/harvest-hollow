# Harvest Hollow — economy and progression critique

2026-10-02 · critic pass on `docs/GDD.md` v1.0 · simulator `tools/econ-sim.mjs`

**Verdict.** The content tables are internally consistent: every price follows the §4.3 formulas, and the simulator's
re-derivation matches `economy-model.mjs --json` value for value (R1). The economy built on them is not balanced yet.
For the GDD's own target couple, a farm reaches **L40 in about 35 hours of play (day 21), not about 140 hours**.
Coins stop mattering from about L25. One decor loop prints XP for free. The Feed Mill, the Sawmill and the order
quantity cap choke the production graph, and two weekly systems (River Barge, County Fair) are effectively dead.
With the fixes below applied, the same simulator lands on every GDD pacing target (L10 1.8 h, L20 16.4 h, L30 57 h,
L40 139 h, ±1 % over 5 seeds). Feed, storage, orders and barge become healthy, and unproduced items drop from
29–37 to 6–15. The one problem left is late-game coin surplus, which needs a new sink (fix H4).

## How to run

```
node tools/econ-sim.mjs                        # static analysis + 4 policies, GDD as written
node tools/econ-sim.mjs --variant=fixed --numbers   # same with every fix below + the new tables
node tools/econ-sim.mjs --variant=rulesOnly    # rule/formula fixes without the E / XP recalibration
node tools/econ-sim.mjs --md --policy=target --seed=3 --days=200 --sweep=1
```

Plain Node, no dependencies, ~1–4 s per run. The simulator loads the model's JSON, re-derives every number from the
§4.3/§4.4/§4.6 formulas (so a variant can change a formula), adds the GDD tables the model does not export (quests
§5.3, expansions §3.9, barn §3.6, tools §3.7), then plays the farm.

**Policies** (wall-clock sessions; offline growth between them):

| Policy | Schedule | Players |
|---|---|---|
| `casual` | Mon, Wed, Sat 20:00 × 60 min (the brief's "3 sessions a week") | 2 |
| `target` | every day: 10-min morning check-in (1 player) + 90 min together at 20:00 — the GDD's "1.5–2 h a day" | 2 |
| `heavy` | every day: 20 + 15 min (1 player) + 150 + 15 min together — 3.3 h a day | 2 |
| `solo` | every evening 60 min, partner absent | 1 |

**The greedy-but-sensible player.** The player sweeps the board every 3 minutes (`--sweep`), with an attention budget
of 30 s per player-minute. Each sweep it harvests, tends and pets every animal, shakes the trees and collects the
trays. Each empty plot gets the crop with the best *net per minute until somebody can next harvest it*: fast crops
during a session, the biggest crop that fits the gap before bed. A crop an order, a crate or a recipe chain is waiting
for goes first. Every queue is kept full with the best value-added recipe; orders, crates and downstream inputs come
first, and near the end of a session the best per-craft recipe wins. Orders and barge crates are filled when the stock
allows. Everything not needed is sold. Purchase order: plots, then buildings and homes in unlock order (saving for
them), then the first animals and the first tree of each species, then expansions and barn upgrades, then anything
that repays within 21 days. Feed takes the cheapest grain unless another recipe needs it (the Barn's "not for feed"
toggle). An order is discarded only if it is impossible or older than 3 sessions and a day.

**Not simulated.** Seasons (±10 %), weather, perks, pets, collections, giant crops, rested XP, decor buying (except
quest E5), Restoration bundles (E4/E6 complete 4 sessions after activation), Golden Seeds, Hurry, acorn spending.
The Fair player enters goods only when it pays (no forward planning). The land model is 1 tile per plot, 4 per tree,
footprints for buildings and homes, 15 % path overhead and 42 fixed tiles.

**Assumptions the GDD leaves open** (each needs a decision, see L3): starter stumps and logs give 1 Wood each.
Level-up coins in row L are paid on reaching L. Expansion debris = 15 pieces (90 XP, 450 coins, 4 Wood). Almanac
tasks complete at 6 per player-hour. Emergency feed is bought when the mill falls behind and the egg or milk is worth
more than 1.2 × the feed's price.

## Headline numbers (5 seeds, mean and range)

| Metric | GDD target | As written (`base`) | Rule fixes only (`rulesOnly`) | All fixes (`fixed`) |
|---|---|---|---|---|
| L10, target couple | 1.3–2.0 h (M1 acceptance) | 0.2 h (0.2–0.3) | 0.5 h | **1.8 h** (1.8–1.8) |
| L20, target couple | 11–19 h (M1 acceptance) | 3.2 h (2.1–3.5), day 2 | 3.6 h | **15.8 h** (15.2–16.7), day 10 |
| L30, target couple | ~55 h, ~week 4 | 11.2 h, day 7 | 12.4 h | **57.4 h** (56.7–58.3), day 35 |
| L40, target couple | ~140 h, ~2.5 months | 34.8 h (28–42), day 21 | 29.9 h | **139.2 h** (138.3–140.1), day 84 |
| L40, heavy couple | — | 41 h, day 13 | 37 h | 172 h, day 52 |
| L40, solo 1 h/day | — | 43 h, day 44 | 36 h | 178 h, day 179 |
| L30 / L40, casual 3 h/week | — | day 37 / day 103 | day 29 / day 85 | day 181 / > day 365 (L37 at day 365) |
| Adult animal-minutes hungry (no feed) | 0 | 12–39 % | — | 0–0.1 % |
| Play minutes with the barn in overflow | rare | 33–77 % | — | 0–3 % |
| Orders filled / discarded | most / few | 72–80 % / 17–26 % | — | 88–92 % / 8–11 % |
| Barge crates loaded (full barges) | couple: most weeks full | 9–56 % (0 full, all policies) | — | target 90 % (5/12), heavy 95 % (3/7), solo 81 % (4/24), casual 59 % (1/50) |
| Unlocked items never produced | 0 | 29–37 | — | 6–15 |
| Treasury first > 10 h of income | never (decor absorbs it) | day 9–14 | — | day 12–28 |

`rulesOnly` proves the point of fix C1: rule fixes alone do not move pacing. The level curve itself is mis-sized.

---

## Findings and fixes, ranked by severity

Each fix states its exact new numbers. "Sim" names the evidence. Every numeric fix is implemented in the `fixed`
variant (`FIX_D` / `FIX_RULES` in `tools/econ-sim.mjs`), so one run reproduces every claim.

### CRITICAL

#### C1 — Progression runs 4–6× faster than designed (priority 4 broken), and its rewards snowball

*Sim:* the target couple reaches L20 in 3.2 h, against an M1 acceptance band of 11–19 h, and L40 in 35 h instead of
140 h. The heavy couple is at L40 on **day 13**, before its first County Fair or River Barge completes. Measured per
level band, market + order + barge income runs at **0.8–3.5 × E(L)**. All coin faucets together run at
**2.0–9.7 × E(L)**, and XP at **1.2–11.8 × E/8**, the rate the curve is built on.

*Causes, in order of weight:*

1. **E(L) underestimates what a sensible couple produces.** §4.4 assumes 45 % plot use on the *average* session
   crop, one away-cycle on 60 % of plots spread over 2 h, two trees per species and one running slot per building at
   60 %. The sim's couple keeps 91–98 % of plots busy, buys 5–10 trees per species (land never binds, see M8) and keeps
   80 % of the buildings working.
2. **Faucets outside the budget.** The curve sizes XP to production alone, and three systems add to it:
   - **Almanac.** Tasks refresh without limit. Each pays E × 0.03 h, and the first 5 a day pay double. A 90-minute
     couple evening collects about 18 tasks = **0.84 E-hours of coins plus the matching XP**, an extra 56 % on that
     evening. Sim: 10–20 % of all XP and 11–19 % of all coins.
   - **Mastery.** The reward pool (★1 10 × V + 10 × XP, ★2 20×/20×, ★3 40 × XP) totals **767,340 XP, 73 % of the
     whole L1→40 curve**, plus 5.7 M coins. Long items pay out absurdly fast. One night of 50 Cabbage plots reaches ★1
     and ★2 (thresholds 10/50) for 37,950 coins and 4,740 XP at L12, where the next level needs 2,600 XP. Twelve
     Quilts give 70,180 coins (1.6 h of E at L20). Sim: 10–15 % of all XP.
   - **Quests** give 131,357 XP (12.6 % of the curve) on top of the production that completes them.
3. **The snowball.** Level-up coins (E × 0.15 per level), quest coins and the Bloom are sized "per level". When levels
   come every few minutes, the rewards pour in. Sim base, L6–10: 7 × E coins per hour.

*Fix (all four parts; the `fixed` variant):*

- **C1a — recalibrate E(L)** by a multiplier K(L), linear between the anchors
  **L1 1.0 · L5 1.3 · L10 1.6 · L15 1.8 · L20 2.0 · L30 2.2 · L40 2.4**. Prices and rewards follow it automatically:
  buildings, slots, homes, expansions, barn, quest coins, level-up coins, Almanac, Fair, Market Week. This is applied
  to the new formula values of fixes M2–M4 and H1. Long term, replace the hand-model E() with the simulator's measured
  value. §4.4 already demands ±25 %, and the base content fails it by up to 3.5×.
- **C1b — XP curve:** `xpToNext(L) = nice(E_new(L)/8 × targetMinutes(L)/60 × X(L))`, X linear between
  **L1 1.5 · L5 2.2 · L10 2.6 · L15 3.4 · L20 2.9 · L25 2.5 · L30 2.25 · L35 2.0 · L40 2.0**. The bump at L15 absorbs
  the quest and mastery burst of L11–15. Legacy levels stay "= the L39→40 requirement". The full table is in
  Appendix B ("New numbers"). Examples: E(10) 16,291 → 25,000, E(20) 43,398 → 82,000, E(39) 78,273 → 180,000;
  XP L10→11 1,200 → 4,700, L20→21 14,000 → 74,000, L39→40 (and Legacy) 100,000 → 470,000.
- **C1c — Almanac:** tasks still refresh, but **only the first 4 completions per player per day pay**, each
  **E × 0.02 h** coins plus the same / 8 XP, with no doubling. The Daily chest is unchanged.
- **C1d — Mastery rewards capped:** ★1 = min(10 × V, E × 0.10 h) coins and min(10 × XP, E × 0.10 h / 8) XP; ★2 =
  min(20 × V, E × 0.20 h) and min(20 × XP, E × 0.20 h / 8); ★3 = 1 Acorn + min(40 × XP, E × 0.20 h / 8). The capped
  pool is 483,544 XP, 10 % of the new 4.87 M curve.

*Result:* 5-seed means for the target couple are **L10 1.8 h · L20 15.8 h · L30 57.4 h · L40 139.2 h**. The casual
couple reaches L20 on day 41 and L30 on day 181; solo L40 lands on day 179 and heavy L40 on day 52. Pacing barely
depends on play style: 137–142 h to L40 whether the couple sweeps every 6 or every 1 minute.

#### C2 — Decor flip prints unlimited XP for free (exploit)

Decor pays 1 XP per 40 coins "when the 10-minute undo window closes" (§3.8, §6.3). Stored decor "refunds 100 % if
never placed" (§3.8; §4.3 "decor 50 % (100 % if never placed)"). The loop: buy decor, wait 10 minutes, take the XP,
store it unplaced, refund 100 %, repeat. Cycling 100,000 coins gives **15,000 XP per hour at zero cost**, 2.8× the
whole L20 production XP rate (5,425/h). Neither R5 nor §9 #9 covers it: they guard refund-before-XP, not
XP-then-refund.

*Fix:* decor XP is paid **on first placement of that object instance**, once. A decor object that has paid XP sells
or refunds at **50 %** whether placed or not; 100 % applies only inside the 10-minute undo window, before any XP is
paid. Add to R5: "no buy / place / store / sell sequence returns ≥ the coins it spent while having granted XP"
(fuzz test).

### HIGH

#### H1 — The Feed Mill cannot feed the barnyard (one item at a time)

At full housing, active play needs 41 Chicken Feed, 22 Livestock Feed and 2 Pig Slop per hour, which is
**148 mill-minutes per hour** (one mill = 60). §3.3's "3 slots, up to 6" adds queue length, not throughput (§3.5 rule
1). *Sim base:* the mill is busy 66–96 % of the time, **12–39 % of adult animal-minutes stand hungry**, the couple buys
emergency feed, and grain piles up for the starved mill. That pile is the main reason the barn sits in overflow
33–77 % of play time, with 12,000–39,000 units refused at 2× capacity.

*Fix:* every feed recipe yields **6** instead of 3. The values follow the formula; with M2's cheaper Wheat, Chicken
Feed V 7 → 2, Livestock Feed 9 → 3, Pig Slop 7 → 3 (Egg 61 → 56, Milk 102 → 96). Load drops to **74 mill-minutes per
hour**. *Sim fixed:* 0–0.1 % hungry, overflow 0–2.7 % of play time, 0 units refused. The second Feed Mill at L31 stays.

#### H2 — The order generator asks for impossible quantities and old junk

1. **The cap counts slots as parallel.** `cap_i = slots × floor(90/min)` (§5.2), but a building crafts one item at a
   time. Flour can be ordered ×108 while one Windmill makes 18 in 90 minutes; Bread 108 vs 18. Sim: orders for
   36–54 Flour or Bread hog the Windmill and Bakery for hours, which starves every pie and cake chain.
2. **The pool checks the building, not the chain.** For crafted goods, "producer exists" only means "building built".
   An order can ask for Pancakes on a farm with no cows. Sim: 1–2 % of orders were impossible when generated.
3. **Cheap old items hit their cap far below the budget.** 44 Carrots worth 462 coins sat on an L28 board, where an
   order should be worth about 15,000.
4. The "≥ 2 easy orders" guarantee turns **66–69 % of all orders into single-crop "simple" orders**, so the board
   stops spreading demand across the graph (the GDD's own "why it works").

*Fix:* cap_i for crafted goods = **out × max(1, floor(45/min))**. One order holds **≤ 90 machine-minutes** in total.
The pool needs the **full chain** to be producible (G-VALID). Items with **V × cap_i < 0.25 × budget/k** are skipped.
The in-stock weight rises 1.5 → **3**. *Sim fixed:* 88–92 % filled, 8–11 % discarded, 0 invalid. Simple orders are
still 44–50 %. Also proposed, not simulated: the guarantee becomes "≥ ⌈slots/4⌉ easy orders", and a simple order
draws from goods in stock, not only from crops ≤ 30 min.

#### H3 — River Barge is unfillable, and weekly quests jam the quest cards

Crates are E × 0.45 h each, capped by 48 h of *continuous* production. For example, 23 Honey Candles is 17 h of
Chandlery. *Sim base:* 5–11 crates loaded of 9–108 offered, and **0 full barges in every policy**. Quests F2 ("load a
full row") and F3 ("a full barge"), G1 and G3 never complete. They sit on 1–2 of the 3 quest-card slots for the rest
of the game: 189–227 play-minutes with all three cards blocked. Rule 5.3 ("never blocking") is broken.

*Fix:* crate value **E × 0.30 h**, quantity capped by **6 h of one producer** (a building one at a time, owned
animals or trees, plotCap/3 for crops). Crate items come only from goods the farm **made in the last 14 days**. The
offer is **one row per 2 h played last week (1–3 rows)**, and a "full barge" = all offered rows. Pay the Captain's
chest **per completed row (⅓ each)** so a casual week still earns its share. Weekly-dependent quests (F2, F3, G1, G3)
move to a **"This week" tab** that does not count against the 3 cards. *Sim fixed:* crates loaded rise to 90 %
(target), 95 % (heavy), 81 % (solo) and 59 % (casual). Full barges stay rare (5/12, 3/7, 4/24, 1/50) because one
stubborn crate blocks the whole barge, which is why the chest must pay per row. Quest-blocked minutes drop to 23–39
(only main-chain cards waiting on content).

#### H4 — Coins stop mattering in mid-game; "decor absorbs any surplus forever" is false

Every coin sink is finite: buildings, slots, homes, animals and homes at max capacity, expansions, barn, escalating
trees. Decor tops out at 8,900 coins, and beauty decays per copy (50 %, then 25 %). *Sim base:* the treasury passes
10 hours of income on day 9–14 (L26–39), and the run ends with 18–79 E-hours unspent. The fixed variant only moves the
problem: saturation at L18–25 (day 12–28), 175–223 E-hours unspent at L40. The target couple banks about
3.5 M coins a week at L32–35, ~23 hours of the new E(35) = 150,000. After that point no coin decision matters, which breaks priorities 1 and 5.

*Fix (new content; not simulated):*

- **Town Projects** (from L20, after Restoration 2). One active at a time; each costs **E(L) × 12 h coins** plus a
  goods bundle worth **E × 2 h**, builds in 3 days, and adds a permanent landmark in the decorative ring (chapel,
  bandstand, lighthouse, school, bridge, carousel…) plus **5 Acorns** and a Memory Book page. There are 24 authored
  projects, then repeatable "Festival Pavilion" tiers. At one per week (14 E-hours) this absorbs ~60 % of the late
  surplus.
- **Masterwork decor:** every coin decor can be upgraded twice, for **4×** and **16×** its price, raising beauty to
  **×1.5 / ×2.0** with a visual upgrade.
- **Grand decor:** 10 showcase pieces priced **nice(E(unlock) × 0.5 h) … nice(E × 4 h)**.
- Restoration coin bundles become E-based: Glass & Frames 20,000 → **E(16) × 0.5 h**.

Add a check: "the treasury stays < 10 E-hours for the target couple until L35".

#### H5 — Planks and Crates, not coins, gate expansions and the barn

Fifteen expansions plus ten barn upgrades need **368 Planks + 55 Crates = 478 Wood and 161 Sawmill-hours** in one
queue. *Sim base:* when an expansion was wanted, crates or planks were the blocker ~92 % of the time, and waits ran
13–39 play-hours *while the treasury held millions*. Barn upgrades lag behind, which feeds the overflow in H1.

*Fix:*
- **Planks: 1 Wood → 2 Planks in 20 min** (V 386 → 227).
- **Wooden Crate: 2 Planks → 1 in 30 min** (V 1,150 → 719).
- Requirements halved:
  - expansions 1–15 Planks **0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15**, Crates
    **0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3**;
  - barn 1–10 Planks **2, 3, 4, 5, 6, 7, 8, 9, 10, 11**, Crates **0, 0, 1, 1, 1, 1, 2, 2, 2, 2**.

  Total: 125 Wood, 58 Sawmill-hours.

*Sim fixed:* expansions become coin-limited saving goals of 2–7 play-hours (8–11 h for heavy), close to the GDD's
intent ("1–3.6 h of income").

### MEDIUM

#### M1 — The Windmill and Dairy single queues starve the T3/T4 tree

Butter costs 50 Dairy-minutes (Cream 20 + Butter 30). Pies, cakes, Popcorn, Truffle Pasta, the Wedding Cake and
Risotto all need it, and Flour and Sugar share one Windmill queue. The second Dairy only arrives at L36 (§3.5 rule 7).
*Fix:* second copies are allowed earlier: **Windmill from L16, Dairy from L18** (price 2×). Feed Mill L31 and Pie Oven
L33 stay. *Sim fixed:* idle building share 15–19 % (base 29–48 %), and most pies and cakes get made.

#### M2 — Wheat dominates every session for an attentive player

At SHORT_EXP 0.85, Wheat earns 300 coins per plot-hour against Strawberry's 162 (1.85×) and is the best session crop
at every level 1–40. *Sim:* a "grinder" who sweeps every minute (`--sweep=1`) plants **91 % Wheat**, so every newer
session crop is pointless for that player. A half-way fix (SHORT_EXP 0.95) still left the grinder at 76 % Wheat,
because 1-minute values round coarsely. *Fix:* **SHORT_EXP 0.85 → 1.0, CROP_R 8 → 4.33**, so value is proportional to
grow time up to an hour and a 60-minute crop keeps its exact GDD value (8·60^0.85 = 4.33·60). Plot-hour rates become
Wheat 120 · Carrot 150 · Corn 162 · Strawberry 162 · Tomato 170 · Sugarcane 173 · Oats 183: each newer crop is a small
upgrade (+1.5 %/level), and Wheat (V 4 → 2) becomes the cheap ingredient and tutorial crop. The grinder's Wheat share
drops to 31 %, which is just Flour and feed demand. Fast crops lose their per-hour premium; their value is immediacy,
orders and ingredients.

#### M3 — The fastest recipe wins in each building; 49 of 105 recipes are dominated for market crafting

The time value 16·√min pays 429 coins/h for a 5-min recipe and 62 coins/h for a 4-h one. The input markup then
favours recipes with expensive inputs. In the median building the best recipe earns 2.27× the worst per hour.
**49 recipes** lose both per hour and per craft to a same-building recipe unlocked no later (list in Appendix A).
The Baby Bottle (420/h) is the Dairy's best cash product. The Packing Table adds 5.5–13 k coins per building-hour,
because a 15-min recipe gets a 1.4 markup on 3–8 k of inputs. *Fix:*
- time value **10·min^0.8**;
- markups **T2 1.20 · T3 1.25 · T4 1.25 · Duet 1.35** (R3 minimum stays ≥ 1.26);
- the **Baby Bottle is not sellable** (like feed).

The spread falls to 1.64× and dominated recipes to 43; the Packing Table drops to 3.4–9.3 k coins per hour. Dominance is structural; what keeps those recipes alive is the
order board (H2) — fixed sim: 6–15 unproduced items instead of 29–37.

#### M4 — Compost is worth 3× more on the three single-yield crops

Compost gives "+1 unit", which is +167 % of net on Pumpkin, Cabbage and Watermelon against +55 % elsewhere. Compost
has V 108 but adds 1,265 on a Cabbage (11.7×), so one Horse cycle (6 Compost) is worth up to 7,590 coins against its
listed net of 228. *Fix:*
- yields **1 → 2** for Pumpkin, Cabbage and Watermelon, and the recipes that use them take **2**: Pumpkin Soup,
  Pumpkin Pie, Coleslaw, Sauerkraut, Watermelon Salad and Watermelon Juice. Their values stay about the same.

Compost becomes +83 % of net on yield-2 crops and +56 % on yield-3 crops; one Compost on a Cabbage adds 632 instead of
1,265. A Horse cycle is worth up to 3,792 coins instead of 7,590 — still the best Compost route (intended), no longer
33× its listed net.

#### M5 — The County Fair does not pay, so nobody enters

Entering a T3/T4 good costs 88–100 coins of goods per point, and the medals pay 67–100 coins per point (Silver I 67,
Gold I 74). Selling at the market is as good, and an order (1.5 × V) is better. *Sim base:* target, heavy and solo
enter **0 goods**, medals are Bronze from prized crops or nothing, and quest G3 (Silver) never completes. The GDD's
"a normal couple week reaches Gold" does not hold. *Fix:* medal coins **× 1.8**: Bronze 0.54 / 0.675 / 0.81 h,
Silver 1.08 / 1.35 / 1.62 h, Gold 1.8 / 2.25 / 2.7 h of E. Points = **V / 100 to one decimal**, which removes the
round-half-up quirk: a V-150 good scores 1.5, not 2. Entries then pay ~1.3× V, on par with orders. *Sim fixed:* the
casual couple, who keep stock, enter 939 goods worth 1.17 M for 3.01 M of medals. The sim player does not plan Fair
production, so the medal counts understate what a real couple would do.

#### M6 — Duet recipes are dead weight

No run made a **Harvest Feast**, and Wedding Cake and Sweetheart Cake appear only for quests. Orders never ask for
duet goods (§5.2), the chains are long, and solo play takes 2× time. The co-op showcase mechanic produces nothing
anyone wants. *Fix:* from L10, **golden orders may ask for one duet good** (1 in 3 golden orders), paying **2.0 × V**
plus the Acorn. Duet goods score **2× points** at the Fair. The +1 Heart each stays.

#### M7 — Starter debris skips the tutorial

The 24 starter debris pieces pay 144 XP and 720 coins (§2.3, §4.5), which reaches **L5 within the first minutes** (sim:
L5 at 0.0 h in every base run). The tutorial's one-unlock-per-level teaching (§7.4: L2 at 1:45, L3 at 6:00, L4 at 9:00)
collapses into five unlock cards at once. *Fix:* starter debris XP **weeds 1 · rocks 1 · stumps and logs 2 ·
boulders 5** = 40 XP, still 5 coins per XP. Expansion debris keeps the §4.5 values.

#### M8 — Land never binds, so trees dominate and animals are marginal (not simulated as a fix)

*Sim:* at L40 the farm uses 700–900 of 1,792 owned tiles. Seven or eight of the 15 expansions only add room for decor,
and §3.10's "land and level, not coins, are the real limit" holds for level only. With space free, the couple buys 5–10
trees per species, and **trees earn 30–40 % of all XP** for daily players (16 % for casual). Animals earn **3–6 %**; apart from the Egg (casual) no
animal good is ever a top seller. Alpaca, Goat and Horse homes are slow to pay back on a casual schedule. Proposed,
then re-run with the simulator:
- cap trees at **4 per species (one Grove) + 1 per 10 farm levels (max 8)**;
- tree price growth **1.35 → 1.45**;
- raise the animal time value **ANIMAL_K 12 → 18** (long-cycle products +35–50 %; baby prices follow, 10 collections).

### LOW

- **L1 — Partner-gift bonus is free treasury money.** The receiver gets +50 % V in coins, but the treasury is shared,
  so wrapping the best Quilt or Picnic Basket mints up to ~4.6 k coins per player per day. Cap it at
  **min(0.5 × V, E × 0.05 h)**.
- **L2 — The Baby Bottle and Compost are sellable** while feed is not. Make both non-sellable (consumables), so no
  utility item becomes a cash crop (see M3).
- **L3 — Spec gaps the simulator had to guess:**
  - Wood per starter stump or log.
  - Whether level-up row L is paid on reaching L or on leaving it.
  - "Current price" on prized-animal resale (define as the price paid for that animal; otherwise the n-th-animal
    escalation makes buy-low / sell-high loops possible).
  - Whether emergency feed may be bought when coins are below the seed reserve.
  - Whether the barge rule "no shared direct input" applies to raw goods.
  - Restoration coin bundles are not E-based.
  - The balance simulator is named `tools/balance-sim.mjs` in tech §8.2; this one is `tools/econ-sim.mjs`.
- **L4 — Level-up Bloom** (60 min per level) is harmless once C1 fixes pacing. In base pacing it fast-forwarded every
  timer by ~19 hours during the first 3 play-hours.

## What the simulator found *healthy*

- **R2, R3, R5, R10 hold:** no seed costs more than its plot returns, every recipe returns ≥ 1.2× its inputs, the Store
  never sells what the Market buys, and every animal's product beats its feed. There is no buy-low / sell-high loop
  through the Market or the Store.
- **R7 (a crop for every horizon) holds.** The planting mix depends on schedule exactly as designed: casual couples
  live on 24-h Cabbage, the target couple on 10–12-h Cotton and Pumpkin, heavy players use the 3–6-h band.
- **Orders never expiring plus the 15-minute refill** makes order fishing pointless. The Market Demand cap and the
  Fair entry cap hold.
- **Storage** is fine once H1 and H5 are fixed: peak 88–145 % of capacity, overflow ≤ 2.7 % of play time, nothing
  refused.
- **Acorns:** 347–448 earned by L40 with the fixes (GDD: 450–500 in 3 months). As written, 160–180, because L40
  arrives within days. Acorn sinks were not simulated.

---

## Appendix A — simulator output, GDD v1.0 as written (`node tools/econ-sim.mjs --md`)

### Static analysis (formula-level, no play)

**Crops — net coins per plot-hour if replanted the moment they ripen, and the value of one Compost (+1 unit)**

| Crop | Lvl | Grow | Net/plot-h | Net/planting | +1 unit (Compost) as % of net |
|---|---|---|---|---|---|
| wheat | 1 | 1 min | 300 | 5 | 80 % |
| carrot | 2 | 2 min | 240 | 8 | 88 % |
| corn | 3 | 10 min | 204 | 34 | 56 % |
| strawberry | 4 | 1.0 h | 162 | 162 | 56 % |
| potato | 5 | 4.0 h | 77 | 308 | 56 % |
| tomato | 6 | 30 min | 188 | 94 | 55 % |
| sugarcane | 8 | 45 min | 179 | 134 | 84 % |
| pumpkin | 9 | 12.0 h | 45 | 534 | 167 % |
| sunflower | 11 | 6.0 h | 67 | 401 | 83 % |
| cabbage | 12 | 24.0 h | 32 | 759 | 167 % |
| oats | 13 | 20 min | 216 | 72 | 56 % |
| blueberry | 14 | 3.0 h | 102 | 306 | 56 % |
| cotton | 16 | 10.0 h | 54 | 538 | 83 % |
| lavender | 18 | 2.0 h | 134 | 268 | 83 % |
| onion | 24 | 1.5 h | 168 | 252 | 56 % |
| watermelon | 27 | 16.0 h | 47 | 754 | 167 % |
| pepper | 31 | 5.0 h | 93 | 466 | 56 % |
| rice | 35 | 8.0 h | 75 | 599 | 56 % |

Best session crop (≤ 60 min) per plot-hour at every level: wheat; best/worst session crop per plot-hour = 1.85× (wheat vs strawberry).

**Recipes — value added per building-hour (a building crafts one item at a time)**

| Building | Best per hour | coins/h | Worst per hour | coins/h | Recipes |
|---|---|---|---|---|---|
| mill | flour | 456 | sugar | 282 | 4 |
| bakery | maple_pancakes | 874 | corn_bread | 286 | 12 |
| sawmill | bird_house | 529 | toy_horse | 281 | 4 |
| dairy | baby_bottle | 420 | goat_cheese | 185 | 7 |
| compost_bin | compost | 101 | compost | 101 | 1 |
| kitchen | watermelon_salad | 2,202 | truffle_pasta | 267 | 21 |
| preserves | fig_jam | 565 | sauerkraut | 173 | 10 |
| weaver | cotton_cloth | 383 | alpaca_yarn | 219 | 4 |
| sewing | cotton_tote | 952 | alpaca_shawl | 254 | 8 |
| pie_oven | fig_tart | 322 | walnut_honey_cake | 143 | 12 |
| juice_press | watermelon_juice | 1,056 | carrot_juice | 243 | 6 |
| chandlery | honey_candle | 480 | beeswax | 266 | 4 |
| packing | harvest_hamper | 13,212 | breakfast_hamper | 5,536 | 6 |
| oil_press | sunflower_oil | 324 | olive_oil | 263 | 3 |
| sugar_shack | maple_syrup | 241 | maple_syrup | 241 | 1 |
| chocolatier | chocolate_truffles | 876 | chocolate | 333 | 2 |

Dominated recipes (another recipe of the same building, unlocked no later, beats them per hour AND per craft): 49 of 105: cookies (by sweetheart_cake), blueberry_muffin (by sweetheart_cake), granola_bar (by sweetheart_cake), planks (by wooden_crate), goat_cheese (by ice_cream), omelette (by pumpkin_soup), veggie_soup (by pumpkin_soup), popcorn (by pumpkin_soup), dog_biscuit (by pumpkin_soup/cat_treat), cat_treat (by pumpkin_soup), roasted_seeds (by pumpkin_soup), potato_gratin (by coleslaw), truffle_pasta (by pumpkin_soup/coleslaw), french_onion_soup (by pumpkin_soup/coleslaw), stuffed_peppers (by coleslaw/watermelon_salad), risotto (by watermelon_salad/wedding_cake), custard (by pumpkin_soup/roasted_seeds), rice_pudding (by pumpkin_soup/coleslaw), wedding_cake (by harvest_feast), strawberry_jam (by cherry_jam), ketchup (by cherry_jam), blueberry_jam (by cherry_jam), peach_jam (by cherry_jam), lavender_dye (by cotton_cloth), alpaca_yarn (by cotton_cloth/lavender_dye), sweater (by cotton_tote/picnic_blanket), wool_pillow (by cotton_tote), alpaca_plush (by cotton_tote/quilt), alpaca_shawl (by cotton_tote/picnic_blanket), apple_pie (by pumpkin_pie/cherry_pie), cherry_pie (by pumpkin_pie), lemon_cake (by pumpkin_pie), blueberry_pie (by pumpkin_pie/cherry_pie), pear_tart (by pumpkin_pie/cherry_pie), lemon_meringue_pie (by pumpkin_pie/peach_cobbler), plum_cake (by pumpkin_pie), walnut_honey_cake (by pumpkin_pie/plum_cake), carrot_juice (by apple_juice), beeswax (by honey_candle), lavender_candle (by honey_candle), lavender_soap (by honey_candle), spa_basket (by picnic_basket), cozy_winter_gift (by picnic_basket/spa_basket), pizza (by sweetheart_cake), walnut_cookies (by sweetheart_cake), potato_chips (by watermelon_salad), maple_fudge (by watermelon_salad/harvest_feast), hot_cocoa (by watermelon_salad), gourmet_hamper (by harvest_hamper)

Wheat → Flour → Bread: 3 Wheat worth 12 coins (seed 4.5) become one Bread worth 103 (8.6×), in 10 machine-minutes.

Compost V = 108; one Compost on cabbage adds 1,265 (11.7×), watermelon adds 1,257 (11.6×), pumpkin adds 890 (8.2×), cotton adds 448 (4.1×). A horse cycle (2 Manure → 6 Compost) is worth up to 7,590 coins of extra crop, vs. its listed net 228.

Mastery reward pool (★1 + ★2 coins, ★1–★3 XP, all items): 5,698,140 coins and 767,340 XP. Largest: harvest_hamper 342,150 coins (★1 at 30, ★2 at 160); gourmet_hamper 319,470 coins (★1 at 30, ★2 at 160); picnic_basket 277,890 coins (★1 at 30, ★2 at 160); spa_basket 268,470 coins (★1 at 30, ★2 at 160); cozy_winter_gift 220,890 coins (★1 at 30, ★2 at 160); quilt 210,540 coins (★1 at 12, ★2 at 60)

Feed Mill at full housing during active play: 41 Chicken Feed, 22 Livestock Feed, 2 Pig Slop per hour = **148 mill-minutes per hour** (one mill = 60).

Order cap formula (slots × floor(90/min), GDD §5.2) vs. what one building can really make in 90 min: flour 108 vs 18, cornmeal 54 vs 9, sugar 24 vs 4, oat_flakes 54 vs 9, bread 108 vs 18, corn_bread 18 vs 3

County Fair: entering a T3/T4 good costs 88–100 coins of goods per point (cheapest / median); medals pay Bronze I 100, Silver I 67, Gold I 74, Gold III 87 coins per point. 

### Simulation — variant "base" (GDD v1.0 as written), seed 1, horizon 365 days
Port check (R1): the simulator's re-derivation equals economy-model.mjs --json for every crop, tree, animal, recipe, level and building.

- **casual** — Couple, 3 evenings a week × 60 min (Mon, Wed, Sat)
- **target** — Couple, GDD pacing target: 90 min together every evening + a 10-min morning check-in
- **heavy** — Heavy couple: morning 20 + lunch 15 + evening 150 + bedtime 15 min, daily (3.3 h)
- **solo** — Solo player, 60 min every evening (partner absent)

#### Time to reach each level (calendar days / hours of play)
| Lvl | casual: day / play h | target: day / play h | heavy: day / play h | solo: day / play h |
|---|---|---|---|---|
| 2 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 3 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 4 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 5 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 6 | 0.8 / 0.3 | 0.8 / 0.2 | 0.3 / 0.3 | 0.8 / 0.3 |
| 7 | 0.8 / 0.3 | 0.8 / 0.2 | 0.5 / 0.3 | 0.8 / 0.3 |
| 8 | 0.8 / 0.3 | 0.8 / 0.2 | 0.5 / 0.3 | 0.9 / 0.6 |
| 9 | 0.9 / 0.5 | 0.8 / 0.2 | 0.5 / 0.3 | 0.9 / 0.7 |
| 10 | 0.9 / 0.6 | 0.8 / 0.2 | 0.5 / 0.3 | 0.9 / 0.9 |
| 11 | 0.9 / 0.6 | 0.8 / 0.5 | 0.8 / 0.6 | 1.8 / 1.0 |
| 12 | 0.9 / 0.7 | 0.8 / 0.5 | 0.8 / 0.9 | 1.8 / 1.0 |
| 13 | 0.9 / 0.7 | 0.9 / 0.9 | 0.8 / 0.9 | 1.8 / 1.0 |
| 14 | 0.9 / 0.8 | 0.9 / 1.2 | 0.8 / 1.0 | 1.8 / 1.3 |
| 15 | 2.8 / 1.0 | 0.9 / 1.3 | 0.8 / 1.2 | 1.9 / 1.9 |
| 16 | 2.8 / 1.0 | 1.3 / 1.7 | 0.9 / 2.1 | 2.8 / 2.0 |
| 17 | 5.8 / 2.0 | 1.8 / 1.8 | 1.3 / 3.3 | 2.9 / 3.0 |
| 18 | 5.8 / 2.0 | 1.9 / 3.2 | 1.3 / 3.6 | 3.9 / 3.7 |
| 19 | 5.8 / 2.3 | 1.9 / 3.3 | 1.5 / 3.7 | 3.9 / 3.9 |
| 20 | 5.8 / 2.4 | 2.3 / 3.3 | 1.8 / 3.9 | 3.9 / 3.9 |
| 22 | 7.8 / 3.0 | 2.8 / 3.8 | 1.8 / 4.6 | 5.8 / 5.0 |
| 24 | 12.8 / 5.0 | 3.8 / 5.2 | 2.5 / 7.0 | 7.8 / 7.0 |
| 25 | 14.8 / 6.0 | 4.3 / 6.7 | 2.8 / 7.5 | 8.8 / 8.0 |
| 26 | 14.8 / 6.3 | 4.8 / 7.1 | 2.8 / 8.5 | 8.8 / 8.3 |
| 28 | 19.8 / 8.1 | 5.9 / 9.7 | 3.8 / 10.6 | 13.9 / 13.7 |
| 30 | 26.8 / 11.0 | 7.3 / 11.7 | 4.3 / 13.6 | 20.9 / 20.9 |
| 32 | 37.8 / 16.0 | 10.3 / 16.8 | 5.3 / 16.7 | 23.9 / 23.5 |
| 34 | 47.8 / 20.1 | 14.8 / 23.5 | 6.5 / 20.3 | 27.8 / 27.1 |
| 35 | 51.9 / 22.8 | 15.8 / 25.2 | 7.0 / 23.2 | 30.8 / 30.0 |
| 36 | 58.8 / 25.0 | 16.8 / 26.9 | 7.8 / 23.9 | 32.8 / 32.0 |
| 38 | 70.8 / 30.0 | 19.3 / 31.7 | 8.9 / 28.9 | 41.8 / 41.0 |
| 40 | 89.9 / 38.6 | 21.8 / 35.2 | 10.3 / 33.4 | 47.8 / 47.0 |

GDD claims (couple ~1.5–2 h/day): L10 at ~1.6 h, L15 ~6 h, L20 ~15 h, L30 ~55 h, L40 ~140 h; M1 acceptance: L10 in 1.3–2.0 h and L20 in 11–19 h of play.

#### Coins over time (treasury at the end of the day / level)
| Day | casual | target | heavy | solo |
|---|---|---|---|---|
| 1 | 9,242 (L14) | 9,517 (L15) | 15,701 (L16) | 2,104 (L10) |
| 2 | 9,242 (L14) | 72,316 (L19) | 8,941 (L23) | 8,692 (L15) |
| 3 | 8,437 (L16) | 11,990 (L22) | 27,021 (L26) | 21,946 (L17) |
| 7 | 133,490 (L21) | 34,577 (L29) | 23,553 (L35) | 3,918 (L23) |
| 14 | 432,576 (L24) | 856,058 (L33) | 1,417,148 (L40) | 574,054 (L28) |
| 21 | 1,092,099 (L28) | 3,267,051 (L39) | 1,417,148 (L40) | 1,047,496 (L30) |
| 30 | 2,036,375 (L31) | 3,827,230 (L40) | 1,417,148 (L40) | 2,480,578 (L34) |
| 45 | 2,944,104 (L33) | 3,827,230 (L40) | 1,417,148 (L40) | 4,983,929 (L39) |
| 60 | 4,009,230 (L36) | 3,827,230 (L40) | 1,417,148 (L40) | 5,516,675 (L40) |
| 90 | 6,231,131 (L40) | 3,827,230 (L40) | 1,417,148 (L40) | 5,516,675 (L40) |
| 120 | 6,231,131 (L40) | 3,827,230 (L40) | 1,417,148 (L40) | 5,516,675 (L40) |
| 180 | 6,231,131 (L40) | 3,827,230 (L40) | 1,417,148 (L40) | 5,516,675 (L40) |
| 240 | 6,231,131 (L40) | 3,827,230 (L40) | 1,417,148 (L40) | 5,516,675 (L40) |
| 300 | 6,231,131 (L40) | 3,827,230 (L40) | 1,417,148 (L40) | 5,516,675 (L40) |
| 365 | 6,231,131 (L40) | 3,827,230 (L40) | 1,417,148 (L40) | 5,516,675 (L40) |

#### Where the coins came from (whole run)
- **casual** (end L40, day 90, 39 h played): market 49 %, almanac 19 %, quests 9 %, barge 6 %, mastery 5 %, orders 4 %, market week 3 %, level-up 3 %, daily gift 1 %, gifts 1 %
  - XP from: harvest 36 %, almanac 20 %, trees 13 %, mastery 10 %, quests 9 %, crafting 5 %, animals 3 %, orders 2 %
  - spent on: seeds 1,110,135, expansion 566,100, building 328,400, tree 251,000, home 96,200, second 90,400, barn 77,700, slot 76,700, animal 63,420, tool 39,000
  - top market sales: cabbage 1,592,572, tomato 279,436, cotton 162,266, watermelon_juice 116,025, watermelon 101,377, coleslaw 101,317, apple 98,650, walnut 91,941
- **target** (end L40, day 22, 37 h played): market 56 %, almanac 14 %, quests 8 %, mastery 6 %, barge 5 %, orders 4 %, market week 3 %, level-up 3 %, daily gift 1 %, gifts 0 %
  - XP from: trees 28 %, harvest 24 %, mastery 15 %, almanac 14 %, quests 8 %, crafting 5 %, animals 4 %, orders 1 %
  - spent on: tree 2,333,400, seeds 789,254, expansion 726,100, slot 338,930, building 328,400, animal 151,150, homeupg 100,110, home 96,200, second 90,400, barn 77,700
  - top market sales: pumpkin 1,114,859, pear 229,673, oats 229,198, peach 223,544, lemon 214,781, orange 206,201, cherry 204,466, plum 199,558
- **heavy** (end L40, day 10, 34 h played): market 62 %, almanac 11 %, quests 9 %, mastery 7 %, orders 5 %, barge 3 %, level-up 3 %, gifts 0 %, daily gift 0 %, debris 0 %
  - XP from: trees 27 %, harvest 26 %, mastery 14 %, almanac 10 %, quests 9 %, crafting 6 %, animals 5 %, orders 2 %
  - spent on: tree 3,811,400, seeds 811,206, expansion 726,100, slot 519,630, building 328,400, barn 160,700, animal 152,210, homeupg 100,110, home 96,200, second 90,400
  - top market sales: cotton 757,814, plum 287,989, cherry 274,466, peach 262,674, apple 230,834, sugarcane 228,497, pepper 213,481, orange 176,342
- **solo** (end L40, day 48, 48 h played): market 61 %, almanac 11 %, quests 7 %, mastery 6 %, orders 4 %, barge 4 %, market week 3 %, level-up 3 %, daily gift 1 %, debris 0 %
  - XP from: harvest 32 %, trees 24 %, mastery 12 %, almanac 12 %, quests 8 %, crafting 5 %, animals 3 %, orders 2 %
  - spent on: seeds 1,120,542, tree 1,099,400, expansion 726,100, building 328,400, slot 181,800, barn 114,700, home 96,200, animal 93,440, second 90,400, tool 39,000
  - top market sales: cabbage 1,750,634, tomato 298,984, walnut 216,504, lemon 202,070, orange 189,041, pear 176,365, cherry 164,459, plum 162,803

#### Bottlenecks, storage, orders, barge, fair
| Metric | casual | target | heavy | solo |
|---|---|---|---|---|
| Idle plot share (active minutes) | 2 % | 6 % | 7 % | 6 % |
| Idle building share (active minutes) | 32 % | 46 % | 29 % | 48 % |
| Feed Mill busy (active minutes) | 87 % | 75 % | 96 % | 66 % |
| Adult animal-minutes standing hungry (active play) | 26.5 % | 39.0 % | 12.2 % | 36.8 % |
| Emergency feed bought (coins) | 7,905 | 20,905 | 32,440 | 15,020 |
| Attention-limited minutes | 3 % | 13 % | 14 % | 13 % |
| Max barn fill (stock / capacity) | 200 % | 200 % | 190 % | 200 % |
| Minutes in overflow | 76.9 % | 70.2 % | 32.5 % | 75.6 % |
| Units refused at 2× capacity | 12,659 | 27,872 | 0 | 39,483 |
| Orders generated / filled / discarded | 317 / 245 / 64 | 287 / 217 / 63 | 252 / 202 / 43 | 329 / 238 / 84 |
| Orders not producible at generation (G-VALID breach) | 2 (1 %) | 4 (1 %) | 4 (2 %) | 3 (1 %) |
| Orders fillable from stock at generation | 33 % | 28 % | 30 % | 27 % |
| "Simple" fallback orders | 68 % | 68 % | 69 % | 66 % |
| Order time-to-fill p50 / p90 (calendar) | 6 min / 48.1 h | 9 min / 12.0 h | 9 min / 8.6 h | 9 min / 23.8 h |
| Barge crates loaded / offered, full barges | 11 / 108, 0 of 12 | 8 / 27, 0 of 3 | 5 / 9, 0 of 1 | 7 / 54, 0 of 6 |
| Fair weeks, medals | 11: Bronze I ×1 | 2: Bronze II ×1 | 0: none | 5: none |
| Fair entries (goods value) / medal coins | 7 (13,034) / 20,573 | 0 (0) / 24,402 | 0 (0) / 0 | 0 (0) / 0 |
| Quest cards stuck at the end | F2, G3 | G1, F2 | G1, F2 | G1, F2 |
| Minutes with all 3 quest cards blocked | 189 | 203 | 207 | 227 |
| Expansions / barn upgrades bought | 10 / 6 | 11 / 6 | 11 / 8 | 11 / 7 |
| Acorns at the end | 160 | 167 | 165 | 178 |
| Treasury first > 10 h of E(L) (coins stop mattering) | day 14, L26, 7 h | day 12, L32, 22 h | day 9, L39, 33 h | day 14, L28, 15 h |
| Unspent treasury at the end, in hours of E(L) | 79 | 48 | 18 | 70 |

#### Longest waits between an unlock and being able to buy it (calendar / play)
- **casual**: expansion:10 1776.8 h cal / 32.8 h play; expansion:9 1511.2 h cal / 26.2 h play; expansion:8 1439.7 h cal / 25.7 h play; barn:6 1223.8 h cal / 21.8 h play; expansion:7 1176.0 h cal / 21.0 h play; expansion:6 1128.0 h cal / 20.1 h play
- **target**: barn:6 432.1 h cal / 30.1 h play; expansion:10 408.0 h cal / 28.3 h play; expansion:11 396.0 h cal / 26.8 h play; expansion:8 359.3 h cal / 24.3 h play; expansion:9 348.0 h cal / 24.8 h play; expansion:6 311.6 h cal / 21.3 h play
- **heavy**: expansion:11 168.0 h cal / 23.3 h play; expansion:9 167.8 h cal / 23.1 h play; expansion:10 151.3 h cal / 21.1 h play; barn:7 115.2 h cal / 16.5 h play; expansion:8 102.7 h cal / 13.7 h play; barn:8 101.2 h cal / 13.8 h play
- **solo**: barn:7 936.2 h cal / 39.2 h play; expansion:10 864.0 h cal / 36.0 h play; expansion:11 839.8 h cal / 34.8 h play; barn:6 696.1 h cal / 29.1 h play; expansion:9 552.2 h cal / 23.2 h play; expansion:8 552.0 h cal / 23.1 h play

#### Unlocked items never produced
- **casual** (29): carrot_muffin, granola_bar, olive_bread, potato_gratin, truffle_pasta, french_onion_soup, risotto, custard, rice_pudding, wedding_cake, orange_marmalade, sweater, quilt, alpaca_shawl, lemon_cake, blueberry_pie, lemon_meringue_pie, fig_tart, breakfast_hamper, picnic_basket, spa_basket, cozy_winter_gift, sweetheart_cake, toy_horse, harvest_feast, maple_fudge, chocolate_cake, harvest_hamper, gourmet_hamper
- **target** (37): pig_slop, cookies, baby_bottle, popcorn, truffle_pasta, stuffed_peppers, risotto, wedding_cake, strawberry_jam, ketchup, peach_jam, fig_jam, sweater, quilt, alpaca_shawl, apple_pie, cherry_pie, pear_tart, lemon_meringue_pie, plum_cake, fig_tart, lavender_soap, breakfast_hamper, picnic_basket, spa_basket, cozy_winter_gift, chocolate, chocolate_truffles, walnut_cookies, sweetheart_cake, toy_horse, harvest_feast, potato_chips, hot_cocoa, chocolate_cake, harvest_hamper, gourmet_hamper
- **heavy** (30): fig, ice_cream, truffle_pasta, stuffed_peppers, wedding_cake, strawberry_jam, fig_jam, quilt, alpaca_shawl, cherry_pie, lemon_cake, blueberry_pie, lemon_meringue_pie, plum_cake, fig_tart, breakfast_hamper, picnic_basket, spa_basket, cozy_winter_gift, chocolate, chocolate_truffles, maple_pancakes, sweetheart_cake, toy_horse, harvest_feast, maple_fudge, hot_cocoa, chocolate_cake, harvest_hamper, gourmet_hamper
- **solo** (33): pig_slop, oat_flakes, granola_bar, potato_gratin, truffle_pasta, french_onion_soup, stuffed_peppers, risotto, rice_pudding, wedding_cake, fig_jam, alpaca_yarn, picnic_blanket, sweater, quilt, alpaca_shawl, apple_pie, lemon_cake, blueberry_pie, pear_tart, lemon_meringue_pie, plum_cake, fig_tart, breakfast_hamper, picnic_basket, spa_basket, cozy_winter_gift, sweetheart_cake, toy_horse, harvest_feast, chocolate_cake, harvest_hamper, gourmet_hamper

## Appendix B — simulator output with every fix (`node tools/econ-sim.mjs --md --variant=fixed --numbers`)

### Static analysis (formula-level, no play)

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
| mill | oat_flakes | 462 | sugar | 393 | 4 |
| bakery | maple_pancakes | 864 | corn_bread | 382 | 12 |
| sawmill | wooden_crate | 530 | toy_horse | 335 | 4 |
| dairy | baby_bottle | 492 | goat_cheese | 299 | 7 |
| compost_bin | compost | 242 | compost | 242 | 1 |
| kitchen | watermelon_salad | 1,860 | truffle_pasta | 362 | 21 |
| preserves | fig_jam | 588 | sauerkraut | 280 | 10 |
| weaver | cotton_cloth | 519 | alpaca_yarn | 351 | 4 |
| sewing | cotton_tote | 907 | alpaca_shawl | 344 | 8 |
| pie_oven | fig_tart | 408 | walnut_honey_cake | 257 | 12 |
| juice_press | watermelon_juice | 932 | carrot_juice | 342 | 6 |
| chandlery | honey_candle | 564 | beeswax | 396 | 4 |
| packing | harvest_hamper | 9,304 | breakfast_hamper | 3,364 | 6 |
| oil_press | sunflower_oil | 466 | truffle_oil | 380 | 3 |
| sugar_shack | maple_syrup | 381 | maple_syrup | 381 | 1 |
| chocolatier | chocolate_truffles | 872 | chocolate | 479 | 2 |

Dominated recipes (another recipe of the same building, unlocked no later, beats them per hour AND per craft): 43 of 105: cookies (by sweetheart_cake), blueberry_muffin (by sweetheart_cake), granola_bar (by sweetheart_cake), planks (by wooden_crate), cream (by butter), omelette (by pumpkin_soup), veggie_soup (by pumpkin_soup), popcorn (by pumpkin_soup), dog_biscuit (by pumpkin_soup/cat_treat), cat_treat (by pumpkin_soup), roasted_seeds (by pumpkin_soup), truffle_pasta (by potato_gratin/harvest_feast), french_onion_soup (by potato_gratin/harvest_feast), stuffed_peppers (by potato_gratin/watermelon_salad), risotto (by wedding_cake/harvest_feast), custard (by pumpkin_soup/coleslaw), rice_pudding (by pumpkin_soup/watermelon_salad), wedding_cake (by harvest_feast), strawberry_jam (by cherry_jam), ketchup (by cherry_jam), blueberry_jam (by cherry_jam), peach_jam (by cherry_jam), lavender_dye (by cotton_cloth), alpaca_yarn (by cotton_cloth/lavender_dye), sweater (by cotton_tote/picnic_blanket), wool_pillow (by cotton_tote), alpaca_plush (by cotton_tote/quilt), alpaca_shawl (by picnic_blanket/quilt), cherry_pie (by apple_pie), pear_tart (by blueberry_pie/peach_cobbler), lemon_meringue_pie (by pumpkin_pie), plum_cake (by pumpkin_pie), carrot_juice (by apple_juice), beeswax (by honey_candle), lavender_soap (by honey_candle/lavender_candle), spa_basket (by picnic_basket), cozy_winter_gift (by picnic_basket/spa_basket), pizza (by sweetheart_cake), walnut_cookies (by sweetheart_cake), potato_chips (by watermelon_salad), maple_fudge (by harvest_feast), hot_cocoa (by watermelon_salad), gourmet_hamper (by harvest_hamper)

Wheat → Flour → Bread: 3 Wheat worth 6 coins (seed 3) become one Bread worth 90 (15.0×), in 10 machine-minutes.

Compost V = 200; one Compost on cabbage adds 632 (3.2×), watermelon adds 629 (3.1×), cotton adds 448 (2.2×), pumpkin adds 445 (2.2×). A horse cycle (2 Manure → 6 Compost) is worth up to 3,792 coins of extra crop, vs. its listed net 228.

Mastery reward pool (★1 + ★2 coins, ★1–★3 XP, all items): 2,430,060 coins and 483,544 XP. Largest: fig_jam 54,000 coins (★1 at 20, ★2 at 100); fig_tart 54,000 coins (★1 at 15, ★2 at 75); chocolate_truffles 48,000 coins (★1 at 20, ★2 at 110); hot_cocoa 48,000 coins (★1 at 30, ★2 at 150); chocolate_cake 48,000 coins (★1 at 14, ★2 at 70); gourmet_hamper 48,000 coins (★1 at 30, ★2 at 160)

Feed Mill at full housing during active play: 41 Chicken Feed, 22 Livestock Feed, 2 Pig Slop per hour = **74 mill-minutes per hour** (one mill = 60).

Order cap formula (slots × floor(90/min), GDD §5.2) vs. what one building can really make in 90 min: flour 108 vs 18, cornmeal 54 vs 9, sugar 24 vs 4, oat_flakes 54 vs 9, bread 108 vs 18, corn_bread 18 vs 3

County Fair: entering a T3/T4 good costs 90–100 coins of goods per point (cheapest / median); medals pay Bronze I 100, Silver I 67, Gold I 74, Gold III 87 coins per point. 

### New numbers produced by the fixed variant

| Lvl | E(L) old → new | XP to next old → new | Cumulative XP new | Level-up coins new |
|---|---|---|---|---|
| 1 | 1,944 → 780 | 8 → 5 | 0 | 120 |
| 2 | 2,858 → 2,000 | 18 → 20 | 5 | 300 |
| 3 | 3,288 → 2,700 | 35 → 50 | 25 | 410 |
| 4 | 4,940 → 5,100 | 70 → 150 | 75 | 770 |
| 5 | 7,651 → 8,900 | 160 → 410 | 225 | 1,300 |
| 6 | 10,948 → 14,000 | 270 → 800 | 635 | 2,100 |
| 7 | 11,918 → 16,000 | 370 → 1,200 | 1,435 | 2,400 |
| 8 | 12,357 → 17,000 | 460 → 1,600 | 2,635 | 2,600 |
| 9 | 15,488 → 23,000 | 710 → 2,700 | 4,235 | 3,500 |
| 10 | 16,291 → 25,000 | 1,200 → 4,700 | 6,935 | 3,800 |
| 11 | 19,133 → 30,000 | 1,800 → 7,800 | 11,635 | 4,500 |
| 12 | 22,977 → 37,000 | 2,600 → 12,000 | 19,435 | 5,600 |
| 13 | 26,191 → 44,000 | 3,500 → 18,000 | 31,435 | 6,600 |
| 14 | 27,421 → 47,000 | 4,300 → 24,000 | 49,435 | 7,100 |
| 15 | 30,887 → 54,000 | 5,800 → 34,000 | 73,435 | 8,100 |
| 16 | 32,252 → 58,000 | 6,700 → 40,000 | 107,435 | 8,700 |
| 17 | 34,666 → 64,000 | 7,900 → 47,000 | 147,435 | 9,600 |
| 18 | 35,357 → 66,000 | 8,800 → 51,000 | 194,435 | 9,900 |
| 19 | 38,599 → 74,000 | 10,000 → 60,000 | 245,435 | 11,000 |
| 20 | 43,398 → 82,000 | 14,000 → 74,000 | 305,435 | 12,000 |
| 21 | 44,277 → 84,000 | 16,000 → 84,000 | 379,435 | 13,000 |
| 22 | 45,259 → 87,000 | 18,000 → 94,000 | 463,435 | 13,000 |
| 23 | 52,308 → 100,000 | 23,000 → 120,000 | 557,435 | 15,000 |
| 24 | 53,094 → 100,000 | 25,000 → 120,000 | 677,435 | 15,000 |
| 25 | 54,141 → 110,000 | 28,000 → 140,000 | 797,435 | 17,000 |
| 26 | 56,813 → 110,000 | 32,000 → 150,000 | 937,435 | 17,000 |
| 27 | 57,691 → 120,000 | 35,000 → 170,000 | 1,087,435 | 18,000 |
| 28 | 58,544 → 120,000 | 38,000 → 180,000 | 1,257,435 | 18,000 |
| 29 | 59,352 → 120,000 | 41,000 → 190,000 | 1,437,435 | 18,000 |
| 30 | 62,631 → 130,000 | 47,000 → 220,000 | 1,627,435 | 20,000 |
| 31 | 63,389 → 130,000 | 52,000 → 230,000 | 1,847,435 | 20,000 |
| 32 | 64,157 → 130,000 | 56,000 → 240,000 | 2,077,435 | 20,000 |
| 33 | 65,073 → 140,000 | 61,000 → 280,000 | 2,317,435 | 21,000 |
| 34 | 68,577 → 150,000 | 69,000 → 310,000 | 2,597,435 | 23,000 |
| 35 | 69,388 → 150,000 | 74,000 → 320,000 | 2,907,435 | 23,000 |
| 36 | 72,392 → 160,000 | 81,000 → 360,000 | 3,227,435 | 24,000 |
| 37 | 73,853 → 160,000 | 88,000 → 380,000 | 3,587,435 | 24,000 |
| 38 | 74,629 → 170,000 | 93,000 → 430,000 | 3,967,435 | 26,000 |
| 39 | 78,273 → 180,000 | 100,000 → 470,000 | 4,397,435 | 27,000 |
| 40 | 79,049 → 180,000 | 0 → 0 | 4,867,435 | 27,000 |

| Crop | Yield | V | Seed | Net/plot-h |
|---|---|---|---|---|
| wheat | 2 | 4 → 2 | 3 → 2 | 300 → 120 |
| carrot | 2 | 7 → 4 | 6 → 3 | 240 → 150 |
| corn | 3 | 19 → 15 | 23 → 18 | 204 → 162 |
| strawberry | 3 | 90 | 108 | 162 → 162 |
| potato | 3 | 171 | 205 | 77 → 77 |
| tomato | 3 | 52 → 47 | 62 → 56 | 188 → 170 |
| sugarcane | 2 | 112 → 108 | 90 → 86 | 179 → 173 |
| pumpkin | 1 → 2 | 890 → 445 | 356 | 45 → 45 |
| sunflower | 2 | 334 → 335 | 267 → 268 | 67 → 67 |
| cabbage | 1 → 2 | 1,265 → 632 | 506 | 32 → 32 |
| oats | 3 | 40 → 34 | 48 → 41 | 216 → 183 |
| blueberry | 3 | 170 | 204 | 102 → 102 |
| cotton | 2 | 448 | 358 | 54 → 54 |
| lavender | 2 | 223 | 178 | 134 → 134 |
| onion | 3 | 140 | 168 | 168 → 168 |
| watermelon | 1 → 2 | 1,257 → 629 | 503 | 47 → 47 |
| pepper | 3 | 259 | 311 | 93 → 93 |
| rice | 3 | 333 | 400 | 75 → 75 |

| Feed / animal good | V old → new |
|---|---|
| chicken_feed | 7 → 2 |
| livestock_feed | 9 → 3 |
| pig_slop | 7 → 3 |
| egg | 61 → 56 |
| milk | 102 → 96 |
| wool | 204 → 192 |
| honey | 228 |
| truffle | 193 → 189 |
| duck_egg | 121 → 116 |
| goat_milk | 179 → 167 |
| manure | 123 → 117 |
| alpaca_fiber | 226 → 214 |

| Recipe | Building | Time | V old → new | Added/h old → new |
|---|---|---|---|---|
| flour | mill | 5 min | 50 → 43 | 456 → 444 |
| cornmeal | mill | 10 min | 96 → 99 | 348 → 414 |
| sugar | mill | 20 min | 206 → 239 | 282 → 393 |
| oat_flakes | mill | 10 min | 147 → 145 | 402 → 462 |
| bread | bakery | 5 min | 103 → 90 | 636 → 564 |
| corn_bread | bakery | 30 min | 300 → 346 | 286 → 382 |
| carrot_muffin | bakery | 20 min | 240 → 244 | 345 → 411 |
| pancakes | bakery | 30 min | 458 → 466 | 368 → 430 |
| cookies | bakery | 45 min | 535 → 633 | 291 → 393 |
| blueberry_muffin | bakery | 40 min | 710 → 740 | 389 → 452 |
| granola_bar | bakery | 40 min | 729 → 770 | 396 → 461 |
| olive_bread | bakery | 30 min | 976 → 966 | 636 → 630 |
| planks | sawmill | 20 min | 386 → 226 | 404 → 501 |
| wooden_crate | sawmill | 30 min | 1,150 → 717 | 504 → 530 |
| bird_house | sawmill | 1.0 h | 1,687 → 1,112 | 529 → 434 |
| cream | dairy | 20 min | 194 → 225 | 276 → 387 |
| butter | dairy | 30 min | 320 → 422 | 252 → 394 |
| baby_bottle | dairy | 10 min | 86 → 89 | 420 → 492 |
| cheese | dairy | 1.0 h | 537 → 625 | 231 → 337 |
| yogurt | dairy | 45 min | 367 → 443 | 233 → 343 |
| ice_cream | dairy | 1.0 h | 893 → 1,057 | 323 → 423 |
| goat_cheese | dairy | 1.5 h | 635 → 783 | 185 → 299 |
| compost | compost_bin | 2.0 h | 108 → 200 | 101 → 242 |
| omelette | kitchen | 20 min | 374 → 370 | 450 → 486 |
| veggie_soup | kitchen | 40 min | 421 → 474 | 276 → 372 |
| pumpkin_soup | kitchen | 45 min | 1,580 → 1,609 | 652 → 653 |
| popcorn | kitchen | 30 min | 571 → 717 | 426 → 530 |
| dog_biscuit | kitchen | 15 min | 350 → 331 | 548 → 544 |
| cat_treat | kitchen | 15 min | 406 → 439 | 604 → 632 |
| roasted_seeds | kitchen | 30 min | 989 | 642 → 638 |
| coleslaw | kitchen | 20 min | 1,798 → 1,700 | 1,557 → 1,284 |
| potato_gratin | kitchen | 1.0 h | 1,572 → 1,755 | 499 → 563 |
| truffle_pasta | kitchen | 1.5 h | 1,025 → 1,253 | 267 → 362 |
| french_onion_soup | kitchen | 1.0 h | 1,366 → 1,508 | 446 → 513 |
| watermelon_salad | kitchen | 20 min | 2,626 → 2,661 | 2,202 → 1,860 |
| stuffed_peppers | kitchen | 1.0 h | 1,618 → 1,752 | 511 → 562 |
| risotto | kitchen | 1.5 h | 1,802 → 1,962 | 415 → 457 |
| custard | kitchen | 45 min | 850 → 919 | 400 → 469 |
| rice_pudding | kitchen | 45 min | 1,422 → 1,461 | 597 → 613 |
| wedding_cake | kitchen | 2.0 h | 2,635 → 3,026 | 498 → 563 |
| strawberry_jam | preserves | 1.0 h | 767 → 901 | 291 → 392 |
| ketchup | preserves | 45 min | 596 → 685 | 312 → 407 |
| cherry_jam | preserves | 1.0 h | 1,269 → 1,366 | 421 → 485 |
| sauerkraut | preserves | 4.0 h | 1,965 → 2,387 | 173 → 280 |
| orange_marmalade | preserves | 1.3 h | 1,259 → 1,395 | 343 → 426 |
| blueberry_jam | preserves | 1.0 h | 1,091 → 1,201 | 375 → 452 |
| peach_jam | preserves | 1.0 h | 1,257 → 1,355 | 418 → 483 |
| plum_jam | preserves | 1.0 h | 1,475 → 1,557 | 474 → 523 |
| fig_jam | preserves | 1.0 h | 1,824 → 1,880 | 565 → 588 |
| pickled_peppers | preserves | 2.0 h | 1,413 → 1,607 | 248 → 345 |
| yarn | weaver | 30 min | 332 → 382 | 256 → 380 |
| cotton_cloth | weaver | 45 min | 1,183 → 1,285 | 383 → 519 |
| lavender_dye | weaver | 30 min | 623 → 687 | 354 → 482 |
| alpaca_yarn | weaver | 40 min | 372 → 448 | 219 → 351 |
| scarf | sewing | 1.0 h | 1,020 → 1,220 | 356 → 456 |
| cotton_tote | sewing | 1.0 h | 3,318 → 3,477 | 952 → 907 |
| picnic_blanket | sewing | 2.5 h | 3,838 → 4,241 | 456 → 516 |
| sweater | sewing | 2.0 h | 1,913 → 2,274 | 313 → 412 |
| wool_pillow | sewing | 1.5 h | 2,300 → 2,452 | 473 → 522 |
| quilt | sewing | 4.0 h | 7,018 → 7,434 | 546 → 532 |
| alpaca_plush | sewing | 1.5 h | 2,359 → 2,507 | 483 → 529 |
| alpaca_shawl | sewing | 3.0 h | 2,128 → 2,616 | 254 → 344 |
| apple_pie | pie_oven | 2.0 h | 1,331 → 1,649 | 238 → 349 |
| pumpkin_pie | pie_oven | 2.5 h | 1,809 → 2,068 | 246 → 342 |
| cherry_pie | pie_oven | 2.0 h | 1,388 → 1,616 | 245 → 346 |
| lemon_cake | pie_oven | 3.0 h | 1,570 → 2,052 | 189 → 307 |
| blueberry_pie | pie_oven | 2.0 h | 1,363 → 1,679 | 242 → 352 |
| peach_cobbler | pie_oven | 2.0 h | 1,529 → 1,833 | 263 → 368 |
| pear_tart | pie_oven | 2.0 h | 1,344 → 1,662 | 239 → 351 |
| lemon_meringue_pie | pie_oven | 2.5 h | 1,446 → 1,728 | 208 → 314 |
| plum_cake | pie_oven | 2.5 h | 1,697 → 1,967 | 234 → 334 |
| walnut_honey_cake | pie_oven | 4.0 h | 1,491 → 1,938 | 143 → 257 |
| fig_tart | pie_oven | 2.5 h | 2,542 → 2,899 | 322 → 408 |
| apple_juice | juice_press | 30 min | 744 → 759 | 516 → 546 |
| orange_juice | juice_press | 30 min | 930 → 932 | 612 → 616 |
| lemonade | juice_press | 30 min | 944 → 986 | 620 → 638 |
| carrot_juice | juice_press | 20 min | 109 → 130 | 243 → 342 |
| pear_nectar | juice_press | 30 min | 1,092 → 1,082 | 696 → 676 |
| watermelon_juice | juice_press | 30 min | 1,785 → 1,724 | 1,056 → 932 |
| beeswax | chandlery | 30 min | 361 → 426 | 266 → 396 |
| honey_candle | chandlery | 45 min | 1,082 → 1,275 | 480 → 564 |
| lavender_candle | chandlery | 1.0 h | 912 → 1,076 | 328 → 427 |
| lavender_soap | chandlery | 1.0 h | 968 → 1,031 | 343 → 418 |
| breakfast_hamper | packing | 15 min | 4,689 → 3,857 | 5,536 → 3,364 |
| picnic_basket | packing | 15 min | 9,263 → 8,411 | 10,764 → 7,008 |
| spa_basket | packing | 15 min | 8,949 → 7,964 | 10,404 → 6,652 |
| cozy_winter_gift | packing | 15 min | 7,363 → 7,002 | 8,592 → 5,880 |
| sunflower_oil | oil_press | 1.0 h | 1,326 → 1,471 | 324 → 466 |
| olive_oil | oil_press | 1.5 h | 1,611 → 1,825 | 263 → 406 |
| truffle_oil | oil_press | 3.0 h | 2,740 → 3,155 | 312 → 380 |
| maple_syrup | sugar_shack | 1.0 h | 825 → 965 | 241 → 381 |
| chocolate | chocolatier | 1.0 h | 1,377 → 1,550 | 333 → 479 |
| chocolate_truffles | chocolatier | 45 min | 2,228 → 2,429 | 876 → 872 |
| pizza | bakery | 1.0 h | 1,057 → 1,217 | 366 → 455 |
| walnut_cookies | bakery | 45 min | 1,000 → 1,155 | 452 → 532 |
| maple_pancakes | bakery | 30 min | 1,434 → 1,552 | 874 → 864 |
| sweetheart_cake | bakery | 1.0 h | 1,207 → 1,345 | 485 → 545 |
| toy_horse | sawmill | 2.0 h | 1,666 → 1,503 | 281 → 335 |
| harvest_feast | kitchen | 1.0 h | 3,202 → 3,598 | 1,150 → 1,129 |
| potato_chips | kitchen | 30 min | 2,339 → 2,418 | 1,342 → 1,210 |
| maple_fudge | kitchen | 1.0 h | 2,063 → 2,362 | 627 → 684 |
| hot_cocoa | kitchen | 20 min | 2,068 → 2,167 | 1,767 → 1,563 |
| chocolate_cake | pie_oven | 3.0 h | 2,738 → 3,296 | 290 → 390 |
| harvest_hamper | packing | 15 min | 11,405 → 11,280 | 13,212 → 9,304 |
| gourmet_hamper | packing | 15 min | 10,649 → 10,242 | 12,348 → 8,472 |

| Building | Cost old → new | Slot 1 old → new |
|---|---|---|
| feed_mill | 0 | 710 → 500 |
| mill | 1,300 → 1,100 | 820 → 680 |
| bakery | 3,800 → 4,500 | 1,900 → 2,200 |
| sawmill | 5,500 → 7,000 | 2,700 → 3,500 |
| dairy | 7,200 → 9,600 | 3,000 → 4,000 |
| compost_bin | 3,700 → 5,100 | 3,100 → 4,300 |
| kitchen | 9,300 → 14,000 | 3,900 → 5,800 |
| preserves | 11,000 → 18,000 | 4,800 → 7,500 |
| weaver | 14,000 → 22,000 | 5,700 → 9,300 |
| sewing | 16,000 → 28,000 | 6,900 → 12,000 |
| pie_oven | 22,000 → 38,000 | 7,700 → 14,000 |
| juice_press | 6,600 → 8,400 | 2,700 → 3,500 |
| chandlery | 23,000 → 41,000 | 8,100 → 15,000 |
| packing | 35,000 → 66,000 | 11,000 → 21,000 |
| oil_press | 50,000 → 100,000 | 16,000 → 33,000 |
| sugar_shack | 55,000 → 120,000 | 17,000 → 38,000 |
| chocolatier | 65,000 → 140,000 | 18,000 → 40,000 |

| Expansion | Lvl | Coins old → new |
|---|---|---|
| creekside | 5 | 6,100 → 7,100 |
| old_orchard | 7 | 12,000 → 16,000 |
| cow_hill | 9 | 19,000 → 28,000 |
| sunflower_rise | 11 | 27,000 → 42,000 |
| bee_glade | 13 | 42,000 → 70,000 |
| fair_lane | 15 | 56,000 → 97,000 |
| riverbank | 17 | 69,000 → 130,000 |
| pig_woods | 19 | 85,000 → 160,000 |
| willow_pond | 21 | 110,000 → 200,000 |
| goat_rocks | 24 | 140,000 → 260,000 |
| stable_paddock | 27 | 160,000 → 340,000 |
| walnut_grove | 30 | 190,000 → 390,000 |
| olive_terrace | 33 | 210,000 → 450,000 |
| maple_ridge | 36 | 250,000 → 540,000 |
| sunset_hill | 39 | 280,000 → 650,000 |

| Barn upgrade | Lvl | Coins old → new |
|---|---|---|
| 1 | 6 | 3,300 → 4,200 |
| 2 | 9 | 5,300 → 7,900 |
| 3 | 12 | 9,100 → 15,000 |
| 4 | 15 | 14,000 → 25,000 |
| 5 | 18 | 19,000 → 35,000 |
| 6 | 21 | 27,000 → 51,000 |
| 7 | 24 | 37,000 → 69,000 |
| 8 | 27 | 46,000 → 96,000 |
| 9 | 30 | 57,000 → 120,000 |
| 10 | 33 | 69,000 → 150,000 | 

### Simulation — variant "fixed" (GDD v1.0 + all proposed fixes (incl. E(L) and XP-curve recalibration)), seed 1, horizon 365 days
Port check (R1): the simulator's re-derivation equals economy-model.mjs --json for every crop, tree, animal, recipe, level and building.

- **casual** — Couple, 3 evenings a week × 60 min (Mon, Wed, Sat)
- **target** — Couple, GDD pacing target: 90 min together every evening + a 10-min morning check-in
- **heavy** — Heavy couple: morning 20 + lunch 15 + evening 150 + bedtime 15 min, daily (3.3 h)
- **solo** — Solo player, 60 min every evening (partner absent)

#### Time to reach each level (calendar days / hours of play)
| Lvl | casual: day / play h | target: day / play h | heavy: day / play h | solo: day / play h |
|---|---|---|---|---|
| 2 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 3 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 4 | 0.8 / 0.0 | 0.3 / 0.0 | 0.3 / 0.0 | 0.8 / 0.0 |
| 5 | 0.8 / 0.2 | 0.8 / 0.2 | 0.3 / 0.3 | 0.8 / 0.3 |
| 6 | 0.8 / 0.3 | 0.9 / 0.9 | 0.5 / 0.3 | 0.9 / 0.7 |
| 7 | 0.9 / 0.8 | 0.9 / 0.9 | 0.8 / 0.6 | 1.8 / 1.0 |
| 8 | 2.8 / 1.0 | 0.9 / 1.4 | 0.8 / 0.9 | 1.8 / 1.0 |
| 9 | 2.8 / 1.0 | 1.3 / 1.7 | 0.8 / 1.4 | 1.9 / 1.7 |
| 10 | 2.9 / 1.6 | 1.8 / 1.8 | 0.8 / 1.5 | 2.8 / 2.0 |
| 11 | 2.9 / 1.8 | 1.8 / 2.1 | 0.9 / 2.1 | 2.8 / 2.3 |
| 12 | 5.8 / 2.0 | 1.9 / 2.2 | 0.9 / 3.1 | 3.8 / 3.0 |
| 13 | 7.8 / 3.0 | 2.8 / 3.5 | 1.5 / 3.7 | 4.8 / 4.0 |
| 14 | 9.8 / 4.0 | 3.3 / 5.0 | 1.9 / 5.9 | 5.8 / 5.0 |
| 15 | 14.8 / 6.0 | 4.3 / 6.7 | 2.8 / 7.3 | 7.9 / 7.8 |
| 16 | 19.8 / 8.0 | 5.3 / 8.3 | 3.5 / 10.3 | 9.8 / 9.0 |
| 17 | 23.8 / 10.0 | 6.8 / 10.4 | 4.5 / 13.7 | 12.8 / 12.0 |
| 18 | 28.8 / 12.0 | 7.8 / 11.8 | 4.9 / 16.4 | 13.8 / 13.0 |
| 19 | 30.9 / 14.0 | 8.8 / 13.5 | 5.9 / 19.3 | 16.8 / 16.0 |
| 20 | 40.8 / 17.0 | 9.8 / 15.5 | 6.8 / 20.7 | 18.8 / 18.1 |
| 22 | 58.8 / 25.0 | 13.3 / 21.7 | 8.8 / 27.3 | 25.9 / 25.5 |
| 24 | 77.9 / 33.5 | 16.9 / 27.4 | 10.9 / 36.4 | 34.8 / 34.0 |
| 25 | 93.8 / 40.0 | 19.8 / 31.8 | 12.8 / 40.6 | 39.8 / 39.0 |
| 26 | 107.8 / 46.0 | 22.3 / 36.7 | 13.8 / 44.9 | 45.8 / 45.0 |
| 28 | 145.8 / 62.0 | 27.9 / 45.8 | 17.5 / 57.0 | 58.9 / 58.7 |
| 30 | 180.8 / 77.0 | 34.9 / 58.2 | 21.8 / 70.6 | 73.9 / 73.7 |
| 32 | 224.8 / 96.0 | 42.3 / 70.0 | 26.3 / 86.7 | 89.8 / 89.0 |
| 34 | 273.8 / 117.0 | 51.3 / 85.0 | 31.5 / 103.7 | 108.8 / 108.0 |
| 35 | 301.8 / 129.0 | 55.9 / 92.7 | 34.8 / 113.9 | 118.9 / 118.8 |
| 36 | 331.8 / 142.0 | 60.8 / 100.2 | 37.8 / 123.9 | 129.8 / 129.1 |
| 38 | — | 71.8 / 118.5 | 44.3 / 146.7 | 152.8 / 152.1 |
| 40 | — | 84.3 / 140.1 | 51.8 / 170.6 | 180.8 / 180.0 |

GDD claims (couple ~1.5–2 h/day): L10 at ~1.6 h, L15 ~6 h, L20 ~15 h, L30 ~55 h, L40 ~140 h; M1 acceptance: L10 in 1.3–2.0 h and L20 in 11–19 h of play.

#### Coins over time (treasury at the end of the day / level)
| Day | casual | target | heavy | solo |
|---|---|---|---|---|
| 1 | 6,825 (L7) | 4,979 (L8) | 47,256 (L12) | 3 (L6) |
| 2 | 6,825 (L7) | 11,258 (L12) | 10,111 (L14) | 5,671 (L9) |
| 3 | 3,101 (L11) | 1,485 (L13) | 12,338 (L15) | 6,763 (L11) |
| 7 | 36,356 (L12) | 13,076 (L17) | 52,113 (L20) | 17,096 (L14) |
| 14 | 141,817 (L14) | 845,264 (L22) | 2,055,096 (L26) | 208,790 (L18) |
| 21 | 216,373 (L16) | 3,168,521 (L25) | 6,837,638 (L29) | 1,193,169 (L20) |
| 30 | 725,695 (L18) | 6,891,446 (L28) | 12,740,924 (L33) | 2,722,721 (L23) |
| 45 | 1,609,617 (L20) | 13,896,027 (L32) | 25,284,871 (L38) | 5,364,254 (L25) |
| 60 | 2,248,950 (L22) | 21,264,438 (L35) | 31,773,293 (L40) | 8,145,080 (L28) |
| 90 | 4,357,440 (L24) | 35,717,908 (L40) | 31,773,293 (L40) | 15,480,704 (L32) |
| 120 | 6,793,574 (L26) | 35,717,908 (L40) | 31,773,293 (L40) | 22,855,113 (L35) |
| 180 | 11,286,250 (L29) | 35,717,908 (L40) | 31,773,293 (L40) | 39,907,408 (L39) |
| 240 | 16,471,761 (L32) | 35,717,908 (L40) | 31,773,293 (L40) | 40,199,622 (L40) |
| 300 | 21,533,277 (L34) | 35,717,908 (L40) | 31,773,293 (L40) | 40,199,622 (L40) |
| 365 | 27,996,862 (L37) | 35,717,908 (L40) | 31,773,293 (L40) | 40,199,622 (L40) |

#### Where the coins came from (whole run)
- **casual** (end L37, day 365, 157 h played): market 36 %, orders 20 %, market week 8 %, fair 8 %, almanac 8 %, barge 7 %, quests 5 %, mastery 3 %, daily gift 2 %, gifts 2 %
  - XP from: harvest 39 %, trees 16 %, almanac 10 %, crafting 9 %, orders 9 %, quests 6 %, mastery 5 %, animals 4 %
  - spent on: seeds 4,022,377, expansion 2,730,100, building 622,700, barn 573,100, tree 218,400, home 184,600, second 162,400, animal 60,790, tool 39,000, slot 14,280
  - top market sales: cabbage 2,792,761, sugarcane 949,892, cotton 568,086, watermelon_juice 477,979, walnut 472,395, egg 458,928, watermelon 375,340, apple 359,320
- **target** (end L40, day 84, 140 h played): market 53 %, orders 20 %, market week 7 %, barge 6 %, almanac 4 %, quests 4 %, mastery 3 %, level-up 1 %, daily gift 1 %, gifts 1 %
  - XP from: trees 40 %, harvest 22 %, crafting 10 %, orders 9 %, mastery 5 %, animals 4 %, almanac 4 %, quests 4 %
  - spent on: expansion 3,380,100, seeds 3,157,772, tree 2,328,000, building 622,700, barn 573,100, slot 407,280, home 184,600, second 162,400, animal 114,390, homeupg 48,400
  - top market sales: walnut 1,593,181, cotton 1,395,117, lemon 1,282,887, pear 1,168,756, pumpkin 1,140,791, plum 1,081,492, orange 1,080,862, cherry 1,069,048
- **heavy** (end L40, day 52, 173 h played): market 56 %, orders 22 %, barge 5 %, market week 4 %, quests 4 %, mastery 3 %, almanac 2 %, level-up 1 %, fair 1 %, gifts 1 %
  - XP from: trees 38 %, harvest 23 %, crafting 12 %, orders 9 %, animals 6 %, mastery 5 %, quests 4 %, almanac 3 %
  - spent on: tree 3,811,400, expansion 3,380,100, seeds 3,261,838, slot 624,980, building 622,700, barn 573,100, homeupg 190,400, home 184,600, second 162,400, animal 152,790
  - top market sales: peach 2,065,036, cherry 1,588,543, cotton 1,516,480, apple 1,394,115, plum 1,345,962, walnut 883,039, lemon 829,699, pepper 738,344
- **solo** (end L40, day 181, 181 h played): market 46 %, orders 22 %, market week 12 %, barge 8 %, almanac 4 %, quests 3 %, mastery 3 %, daily gift 2 %, level-up 1 %, fair 0 %
  - XP from: harvest 30 %, trees 30 %, orders 11 %, crafting 10 %, mastery 5 %, almanac 5 %, animals 4 %, quests 4 %
  - spent on: seeds 4,687,979, expansion 3,380,100, tree 1,086,900, building 622,700, barn 573,100, home 184,600, slot 179,980, second 162,400, animal 88,390, tool 39,000
  - top market sales: cabbage 3,560,878, walnut 1,342,609, sugarcane 1,288,721, watermelon_juice 945,011, lemon 860,237, pear 840,063, orange 785,912, wood 706,458

#### Bottlenecks, storage, orders, barge, fair
| Metric | casual | target | heavy | solo |
|---|---|---|---|---|
| Idle plot share (active minutes) | 4 % | 9 % | 8 % | 9 % |
| Idle building share (active minutes) | 15 % | 19 % | 18 % | 17 % |
| Feed Mill busy (active minutes) | 93 % | 92 % | 82 % | 94 % |
| Adult animal-minutes standing hungry (active play) | 0.0 % | 0.0 % | 0.0 % | 0.1 % |
| Emergency feed bought (coins) | 5,625 | 12,373 | 22,265 | 8,035 |
| Attention-limited minutes | 5 % | 16 % | 15 % | 16 % |
| Max barn fill (stock / capacity) | 88 % | 145 % | 144 % | 143 % |
| Minutes in overflow | 0.0 % | 2.7 % | 2.5 % | 1.5 % |
| Units refused at 2× capacity | 0 | 0 | 0 | 0 |
| Orders generated / filled / discarded | 1233 / 1085 / 141 | 1142 / 1023 / 115 | 1167 / 1069 / 89 | 1403 / 1255 / 142 |
| Orders not producible at generation (G-VALID breach) | 0 (0 %) | 0 (0 %) | 0 (0 %) | 0 (0 %) |
| Orders fillable from stock at generation | 17 % | 20 % | 17 % | 16 % |
| "Simple" fallback orders | 50 % | 44 % | 50 % | 44 % |
| Order time-to-fill p50 / p90 (calendar) | 33 min / 71.8 h | 30 min / 23.1 h | 1.2 h / 12.6 h | 48 min / 24.4 h |
| Barge crates loaded / offered, full barges | 178 / 300, 1 of 50 | 97 / 108, 5 of 12 | 60 / 63, 3 of 7 | 175 / 216, 4 of 24 |
| Fair weeks, medals | 50: Bronze I ×46 | 11: Bronze I ×6 | 6: Bronze II ×5, Bronze I ×1 | 24: Bronze I ×1 |
| Fair entries (goods value) / medal coins | 939 (1,166,420) / 3,013,200 | 0 (0) / 385,560 | 0 (0) / 487,350 | 0 (0) / 25,380 |
| Quest cards stuck at the end | G3 | G1 | G1 | G1 |
| Minutes with all 3 quest cards blocked | 31 | 23 | 33 | 39 |
| Expansions / barn upgrades bought | 14 / 10 | 15 / 10 | 15 / 10 | 15 / 10 |
| Acorns at the end | 347 | 376 | 350 | 448 |
| Treasury first > 10 h of E(L) (coins stop mattering) | day 28, L18, 13 h | day 14, L22, 25 h | day 12, L25, 43 h | day 18, L20, 19 h |
| Unspent treasury at the end, in hours of E(L) | 175 | 198 | 177 | 223 |

#### Longest waits between an unlock and being able to buy it (calendar / play)
- **casual**: barn:3 265.0 h cal / 6.0 h play; barn:4 168.5 h cal / 3.5 h play; expansion:5 168.0 h cal / 3.0 h play; expansion:4 167.7 h cal / 2.7 h play; barn:2 120.7 h cal / 2.6 h play; expansion:3 120.0 h cal / 2.0 h play
- **target**: expansion:5 96.3 h cal / 7.0 h play; expansion:6 72.0 h cal / 5.0 h play; barn:3 59.8 h cal / 4.6 h play; expansion:4 47.8 h cal / 3.1 h play; barn:2 36.1 h cal / 2.0 h play; expansion:3 36.0 h cal / 1.9 h play
- **heavy**: expansion:8 94.0 h cal / 11.4 h play; expansion:7 78.5 h cal / 10.3 h play; expansion:5 78.5 h cal / 10.3 h play; expansion:6 60.5 h cal / 9.5 h play; expansion:9 60.5 h cal / 9.5 h play; expansion:4 50.3 h cal / 7.7 h play
- **solo**: expansion:5 144.2 h cal / 6.2 h play; expansion:4 119.8 h cal / 4.8 h play; expansion:3 119.3 h cal / 4.3 h play; expansion:2 96.2 h cal / 4.2 h play; expansion:6 95.8 h cal / 3.9 h play; expansion:1 72.5 h cal / 3.5 h play

#### Unlocked items never produced
- **casual** (15): blueberry_muffin, ice_cream, veggie_soup, french_onion_soup, stuffed_peppers, risotto, rice_pudding, ketchup, blueberry_jam, quilt, alpaca_shawl, chocolate_truffles, harvest_feast, chocolate_cake, gourmet_hamper
- **target** (6): stuffed_peppers, risotto, wedding_cake, pickled_peppers, harvest_feast, gourmet_hamper
- **heavy** (6): stuffed_peppers, risotto, quilt, lemon_cake, harvest_feast, gourmet_hamper
- **solo** (13): blueberry_muffin, yogurt, ice_cream, veggie_soup, stuffed_peppers, risotto, rice_pudding, wedding_cake, blueberry_jam, quilt, alpaca_shawl, harvest_feast, gourmet_hamper

## Appendix C — 5-seed robustness (seeds 1–5, 400-day horizon; play hours mean (min–max), mean calendar day)

| Variant | Policy | L10 | L20 | L30 | L40 |
|---|---|---|---|---|---|
| base | casual | 0.6 h (0.5–0.7), day 1 | 2.6 h (2.3–3.3), day 6 | 15.9 h (11.0–22.1), day 37 | 44.3 h (38.6–54.0), day 103 |
| base | target | 0.2 h (0.2–0.3), day 1 | 3.2 h (2.1–3.5), day 2 | 11.2 h (10.2–11.7), day 7 | 34.8 h (28.3–41.8), day 21 |
| base | heavy | 0.4 h (0.3–0.6), day 1 | 4.0 h (3.7–4.2), day 2 | 13.7 h (13.6–13.9), day 5 | 41.0 h (33.4–70.0), day 13 |
| base | solo | 0.8 h (0.7–0.9), day 1 | 3.6 h (3.4–3.9), day 4 | 16.3 h (12.6–20.9), day 17 | 43.2 h (39.0–48.1), day 44 |
| rulesOnly | casual | 0.6 h (0.4–0.8), day 1 | 3.2 h (2.9–3.4), day 7 | 12.3 h (12.0–12.7), day 29 | 36.4 h (35.8–37.0), day 85 |
| rulesOnly | target | 0.5 h (0.4–0.8), day 1 | 3.6 h (3.2–4.0), day 2 | 12.4 h (11.8–13.3), day 8 | 29.9 h (28.5–30.6), day 18 |
| rulesOnly | heavy | 0.4 h (0.3–0.5), day 1 | 4.2 h (4.2–4.2), day 2 | 16.0 h (15.0–16.6), day 5 | 37.1 h (36.7–37.3), day 12 |
| rulesOnly | solo | 0.8 h (0.6–1.0), day 1 | 4.3 h (3.6–5.0), day 5 | 14.2 h (13.8–15.0), day 15 | 35.6 h (34.0–37.0), day 36 |
| fixed | casual | 1.6 h (1.3–1.8), day 3 | 17.4 h (16.6–18.0), day 41 | 77.2 h (76.0–78.0), day 181 | — |
| fixed | target | 1.8 h (1.8–1.8), day 2 | 15.8 h (15.2–16.7), day 10 | 57.4 h (56.7–58.3), day 35 | 139.2 h (138.3–140.1), day 84 |
| fixed | heavy | 1.6 h (1.4–2.1), day 1 | 21.4 h (20.6–23.3), day 7 | 71.2 h (70.6–72.6), day 22 | 171.8 h (170.6–173.5), day 52 |
| fixed | solo | 1.9 h (1.6–2.0), day 2 | 18.1 h (18.0–18.6), day 19 | 72.5 h (70.5–73.7), day 73 | 178.3 h (176.1–180.0), day 179 |
