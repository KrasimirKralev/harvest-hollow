# Harvest Hollow — FarmVille 2 Core Loop and Economy Research

Research for the designer of "Harvest Hollow", a FarmVille-2-inspired co-op farm for two players
sharing one farm on a LAN. This file covers the **core loop and the economy**: plowing, planting,
watering, fertilizer, harvesting, growth times, withering, mastery, seeds vs sale value, XP per
action, the level curve, expansion, the currencies, energy and paywalls, how goods flow, order
boards and storage. Progression systems, achievements and co-op design are covered in depth in the
sibling file `progression-goals-coop.md`. Assets go in `assets-catalog.md` and the tech stack in
`tech-architecture.md`.

Written 2026-10-02. Most numbers come from the wiki source pages, read through the MediaWiki API
(`https://<wiki>.fandom.com/api.php?action=parse&prop=wikitext`), because fandom returns HTTP 402 to
plain page fetches. Every number links to its human-readable page. Primary design statements come
from the GDC 2013 FarmVille 2 postmortem. I transcribed it locally from the archive.org recording,
and timestamps are given as `[mm:ss]`. A second transcript of the same talk is in
`sources/farmville2-gdc2013-postmortem-transcript.txt`.

Reference games, all compared to **FarmVille 2 (FV2, Facebook/web, Sept 2012, 3D)**:
- **FarmVille 1** (FV1, 2009, 2D): what FV2 fixed.
- **FarmVille 2: Country Escape** (CE, mobile, 2014): FV2 with no water cap, plus keys, storage and orders.
- **FarmVille 3** (FV3, mobile, 2021).
- **Hay Day** (Supercell): the genre's best-tuned economy.

---

## 0. The findings that matter most

1. **FV2's loop is a closed ecosystem anyone understands at a glance.** Water grows crops and
   trees. Crops are milled into feed. Feed makes animals produce goods and also "poop" fertilizer.
   Fertilizer goes back on crops for double yield and prized crops. Goods are crafted and then sold
   or used for orders. The design director called this intuitive on purpose ("teach your game in an
   instant") and deep on purpose (every node has stats) [41:14–44:21]
   ([GDC Vault](https://gdcvault.com/play/1018015/FarmVille-2-Postmortem-What-Grew),
   [archive.org recording](https://archive.org/details/GDC2013Bagwell)).
2. **FV2 planting runs plow → seed → water.** Plowing is free (FV1 charged 15 coins), a seed costs
   coins per plot, and growth only starts once the plot is watered with 1 water
   ([FV2 wiki — Seeds](https://farmville2.fandom.com/wiki/Seeds),
   [FV2 wiki — Plot](https://farmville2.fandom.com/wiki/Plot),
   [FV1 wiki — Plow](https://farmville.fandom.com/wiki/Plow)).
   Water regenerates at 1 per 3 minutes up to a small cap (starting cap 20). Wells give 10 more
   every 4 hours. So **water, not time, was FV2's real currency**, and reviewers' biggest complaint
   ([FV2 wiki — Water](https://farmville2.fandom.com/wiki/Water),
   [Dragonchasers](https://dragonchasers.com/2012/09/07/4697/),
   [Gamezebo](https://www.gamezebo.com/reviews/farmville-2-review/)).
3. **Crop economics: unfertilized margins are thin, and fertilizer is where the profit is.** A
   harvest yields 1 unit, or 2 when fertilized. Unfertilized profit runs from +2 coins (Tomato, 1 min)
   to +669 (Shallots, 24 h). Fertilizer roughly triples profit
   ([Seeds](https://farmville2.fandom.com/wiki/Seeds)). The main role of crops is to be **inputs**
   (feed and recipes), not cash.
4. **Animals are the coin engine and the main coin sink.** A 1,500-coin White Chicken eats 3 feed
   every 5 minutes, lays 1–2 eggs worth 60 coins each, and returns about 2,600 coins over the 35
   feedings before it becomes "prized"
   ([White Chicken](https://farmville2.fandom.com/wiki/White_Chicken)). Bigger animals cost
   9,500–85,000 coins ([Animals](https://farmville2.fandom.com/wiki/Animals)).
5. **Crafting multiplies value about 1.9–3× over the raw ingredients and gives the biggest XP per
   action.** Apple Pie uses about 426 coins of raw goods and sells for 1,300 with 34 XP. Crafting is
   metered by a separate "Power" energy: cap 30, regenerating 1 per 4 minutes
   ([Apple Pie](https://farmville2.fandom.com/wiki/Apple_Pie),
   [Power](https://farmville2.fandom.com/wiki/Power)).
6. **FV2 made withering generous rather than removing it.** Ripe crops survive about 3 days
   (FV1: about 2–2.5× grow time from planting). Trees never wither, animals never die, and a level-up
   ripens every watered crop
   ([Seeds](https://farmville2.fandom.com/wiki/Seeds),
   [Unwither](https://farmville2.fandom.com/wiki/Unwither),
   [FV1 wiki — Wither](https://farmville.fandom.com/wiki/Wither),
   [Engadget](https://www.engadget.com/2012-09-05-farmville-2-updates-zyngas-cow-clicker-but-not-too-much.html)).
7. **Progression has several tracks:**
   - XP levels (about one new item per level and a feature at milestones).
   - Per-item mastery (yellow → red → blue ribbons).
   - Exponentially priced land expansions, each needing a "proof of play" task.
   - Favor-bought farm upgrades (fields, groves, troughs, water tower).
   - Collections and quests.

   ([Levels 1–50](https://farmville2.fandom.com/wiki/Levels/1-50),
   [Expansion help](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/483-what-are-the-expansion-requirements-1688024717/),
   [Favor](https://farmville2.fandom.com/wiki/Favor))
8. **Players hated:**
   - Hard action caps (water, power, and FV3's 6 water per 6 h).
   - Friend-gating (baby bottles, building materials, "4 neighbours to build").
   - Premium-only items.
   - Random drops gating storage upgrades.
   - Tiny storage.
   - Orders asking for more than the farm can make.

   ([Dragonchasers](https://dragonchasers.com/2012/09/07/4697/),
   [millietilly](https://millietilly.wordpress.com/2016/02/26/farmville-2-country-escape-or-how-to-get-really-angry/),
   [The Why of Play — FV3](https://thewhyofplay.com/2021/11/22/farmville-3-evolution-or-revolution/))
9. **The "feel" was designed explicitly:**
   - Hover is like wind, so crops sway under the cursor.
   - Touch is electric.
   - Audio ties it together.
   - The board runs at a calm 60 BPM. 120 BPM is for pickups, and 240 BPM only for level-ups and
     quest completions.
   - A tended board looks "subdued and tidied", which tells the player it is fine to leave.

   [49:27–57:57]
10. **FV2's own designers dropped an idea: "everything levels up"** (tend one pumpkin into a prize).
    It made every click a decision, killed the urge to try new things, and was too subtle to read
    [21:24–24:48]. Players also rejected fantasy content (Halloween-costume animals). They wanted
    "the good life on the farm" [28:15–29:30].

---

## 1. The franchise at a glance

| | FV1 (2009, web 2D) | FV2 (2012, web 3D) | FV2: Country Escape (2014, mobile) | FV3 (2021, mobile) | Hay Day (2012, mobile) |
|---|---|---|---|---|---|
| Plowing | 15 coins + 1 XP per plot ([Plow](https://farmville.fandom.com/wiki/Plow)) | Free ([Seeds](https://farmville2.fandom.com/wiki/Seeds)) | n/a: fields are permanent buildings | n/a | Fields cost 1 coin once ([HD Crops](https://hayday.fandom.com/wiki/Crops)) |
| Seed | Coins per plot | Coins per plot | None: crops are "fields" that you water or pay coins to restart ([CE Crop](https://farmvillecountryescape.fandom.com/wiki/Crop)) | 1–18 coins ([FV3 Crops](https://fv3.fandom.com/wiki/Crops)) | **Replant your own harvest: 1 planted → 2 harvested** ([HD Wheat](https://hayday.fandom.com/wiki/Wheat)) |
| Action gate | None (withering pressure instead) | **Water** (cap ~20, 1 per 3 min) + kitchen **Power** (cap 30) | Water from well: 4 per tap, cap 30, effectively unlimited ([CE Water](https://farmvillecountryescape.fandom.com/wiki/Water)) | Water 6 per 6 h; watering doubles yield ([FV3 help](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/14488-how-does-the-water-well-work/)); farmhand energy | None: storage and timers only |
| Withering | 2–2.5× grow time from planting ([Wither](https://farmville.fandom.com/wiki/Wither)) | About 3 days after ripe; trees never | n/a | n/a | Crops sit in the field until harvested ([guide](https://www.farmgamehub.com/en/guides/hay-day/crops)) |
| Premium | Farm Cash | Farm Bucks (10 free at start, never again) ([Farm Bucks](https://farmville2.fandom.com/wiki/Farm_Bucks)) | Keys + Stamps ([Keys](https://farmvillecountryescape.fandom.com/wiki/Keys)) | Gems | Diamonds |
| Storage | — | No overall cap; per-item caps ([help](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/409-how-does-the-inventory-work-1688028527/)) | Barn 50 → 950, Silo 20 → 840 ([Storage](https://farmvillecountryescape.fandom.com/wiki/Storage)) | Barn + Silo, rare upgrade parts | Silo/Barn 50, +25 per upgrade ([HD Silo](https://hayday.fandom.com/wiki/Silo)) |
| Orders | — | Grocer daily orders → Big Harvest order board → co-op board | Marie's board (2 → 9 slots), Eddie, boat races | Order board with reward boxes, boat, visitors | Truck board (up to 9), boat, roadside shop |

FV2 had 8.5 M daily active users when the GDC talk was given, and Q4 bookings at twice target
[02:12–02:23]. FV2 kept getting new expansion regions into 2020, when its level cap reached 540
([Levels/History](https://farmville2.fandom.com/wiki/Levels/History)). FV1 shut down with Flash on
2020-12-31 ([TheGamer](https://www.thegamer.com/farmville-shutting-down/)).

---

## 2. The FV2 core loop

```
                 ┌──────────── wells / regen / neighbours ────────────┐
                 ▼                                                    │
   coins ──► SEED ──plant──► PLOT ──water(1)──► growing ──timer──► RIPE ──harvest──► crop item
                                  ▲      ▲                                              │
                      fertilizer ─┘      └─ fertilizer on growing crop                  │
                      (2× yield, 10% prized)                                            │
     ┌────────────────────────────┬──────────────────────┬───────────────┬────────────┤
     ▼                            ▼                      ▼               ▼            ▼
 MARKET STAND (coins)     FEED MILL (crop → feed)   KITCHEN (+Power)   ORDERS      QUEST/EXPANSION
                                  │                 recipes ×2-3 value  (coins +    requirements
                                  ▼                      │              Favors)
                     ANIMAL (adult) eats feed every 5 min–8 h
                                  │
             ┌────────────────────┼────────────────────────┐
             ▼                    ▼                        ▼
   goods (egg, milk, wool…)  fertilizer (random)    after N feedings → PRIZED
     → sell / craft            → back to crops        (18 h cycle, premium good)
```

In the designer's own words, from the postmortem [41:14–42:08]:
> "Water, which you have a limited supply of, is used to grow crops and trees. And then you can
> harvest them and feed those crops to your animals… Goat's going to give me milk… chickens give you
> eggs. And of course, when you feed your animals, they're going to poop, and they give you
> fertilizer back… And you can take the apples… and the milk… and some wheat… craft with it, and
> sell your crafts for money… Everybody knows that this is how life works."

**Where depth comes from** [42:41–44:21]. Every node carries numbers:
- Water: limited, raised by buying wells or visiting friends.
- Crops and trees: cost, time, XP, value.
- Animals: cost, hunger interval, feed amount, "how much do they poop", output, space.
- Crafts: XP and coins.
- Fertilizer: changes yield, with "a little bit of slot machine".

Players could optimise for XP, coins or prized crops. "They'll come because it's casual. They will
stay because it's deep" [59:19].

**Player motives the team found** in interviews [06:43–07:34]:
- Escape, in 10–15-minute breaks.
- Transformation: "creating something from nothing".
- Collaboration.

Their creative pillars at ship [27:28]: *your farm is alive*, *your farm is an ecosystem*, *you're
part of a living community*. Two pillars were cut:
- "Everything levels up", as noted above.
- "Your farm is unique": it added complexity, and players were already playing in different ways.

---

## 3. Step by step: plow, plant, water, fertilize, harvest

| Step | FV2 rule | Source |
|---|---|---|
| Plow | Free. A plot must be plowed before seeding. Withered plots can be plowed to clear them. | [Seeds](https://farmville2.fandom.com/wiki/Seeds) |
| Plant | Buy the seed (coins) from the Market, then click empty plots. **Click-and-drag "paints" planting, watering and harvesting across plots.** | [help: plant](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/122-how-do-i-plant-crops/), [help: harvest](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/116-how-do-i-harvest-crops/), [AllThingsD](https://allthingsd.com/20120905/farmville-sequel-gets-a-facelift-with-3-d-graphics-and-all-new-game-play/) |
| Water | "Once planted the seed will need water before it will start to grow." 1 water per crop, 2–6 per tree cycle. **+1 XP** per watering. | [Plot](https://farmville2.fandom.com/wiki/Plot), [Experience](https://farmville2.fandom.com/wiki/Experience) |
| Fertilize | Before planting or while growing. Doubles the crop's yield (1 → 2), gives a 10% chance of a prized crop, **+1 XP**. On trees: +1 product. | [Seeds](https://farmville2.fandom.com/wiki/Seeds), [Fertilizer](https://farmville2.fandom.com/wiki/Fertilizer) |
| Grow | Real-time timer, from 1 min (Tomato) to 24 h. Speed-Grow ("Instagrow") finishes it at once. **Levelling up ripens every watered crop and tree.** | [Speed-Grow](https://farmville2.fandom.com/wiki/Speed-Grow), [Levels](https://farmville2.fandom.com/wiki/Levels) |
| Harvest | Click. Items "pop up off the farm plot, and bounce around". Sweep the cursor over them, or they fly to the inventory by themselves after a moment. Crop XP is paid at harvest. | [help: harvest](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/116-how-do-i-harvest-crops/) |
| Wither | About 3 real days after ripe. Fix with Unwither, a neighbour, or a level-up. | [Seeds](https://farmville2.fandom.com/wiki/Seeds), [Unwither](https://farmville2.fandom.com/wiki/Unwither) |

**Plot count** was capped and raised by each land expansion. From level 25, plots could be merged
into a "Field" (5 crops + 1 bonus, rising to + 2 and + 3 bonus with upgrades), and from level 27
trees into a "Grove" (4
trees, less water, bonus fruit) ([Plot](https://farmville2.fandom.com/wiki/Plot),
[Field](https://farmville2.fandom.com/wiki/Field), [Grove](https://farmville2.fandom.com/wiki/Grove)).

**Neighbour and farmhand actions on your plots** ([Seeds](https://farmville2.fandom.com/wiki/Seeds),
[Neighbor](https://farmville2.fandom.com/wiki/Neighbor)):

| A visitor clicks on… | Result | Uses the owner's consumables? |
|---|---|---|
| An empty plot | It becomes fertilized | No |
| An unwatered seed | It is watered and starts growing | No |
| A growing crop | It is fertilized | No |
| A fertilized growing crop | It grows instantly | No |
| A ripe crop | It is harvested (the produce goes to the owner) | No |

- A visitor gets 5 actions per farm per 18 h. The visitor earns 1 XP, 50 coins and about a 25%
  chance of 1 water.
- A farmhand (a friend placed on a hay bale) works one 4-plot group: water it, instant-grow it,
  harvest it or unwither it. It can also add 5 Power to the kitchen.

---

## 4. Water: the resource that ran FV2

**Supply:**
- **Regen** is 1 water every 3 minutes up to the meter cap: "the speed of getting more coins and
  XP is rather determined by Water than the playing time"
  ([Water](https://farmville2.fandom.com/wiki/Water)).
- The **starting cap** is 20 ([Dragonchasers](https://dragonchasers.com/2012/09/07/4697/)). Water
  earned while the meter is full is lost ([help](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/847-why-am-i-not-getting-my-water-rewards-1688110556/)).
- **Wells** hold 10 water and take 4 h to refill once tapped. Prices
  ([Well](https://farmville2.fandom.com/wiki/Well)):
  - #1: free with the Family Well expansion.
  - #2: 14,000 coins (level 3).
  - #3: 50,000.
  - #4: 150,000.
  - #5: 300,000.
  - #6: free with an expansion.

  Each well also needed friend-sent materials and 2–4 neighbours to build.
- **Level-up** gives 10–30 water ([Levels 1–50](https://farmville2.fandom.com/wiki/Levels/1-50)).
- **Neighbour visits** give about a 25% chance of 1 water per 5-action visit. The co-op "Top Farmer
  of the Week" won 50 water.
- **Water Tower upgrade** (level 50, 800,000 coins + 540 Favor): +10 water per well harvest, then
  +5 per tier ([Water Tower](https://farmville2.fandom.com/wiki/Water_Tower)).
- **Farm Bucks:** 7 water for 3 FB, 12 for 5, 35 for 13 ([Water](https://farmville2.fandom.com/wiki/Water)).

**Demand:**
- 1 per crop.
- 2–6 per tree cycle (Apple 2, Lemon 3, Pine 6).
- Some recipes use water as an ingredient (Lemon Water, Dough, Apple Pie).
- A Grove of four identical trees saves 1 water per tree ([Grove](https://farmville2.fandom.com/wiki/Grove)).

**Consequence:**
- With water as the binding constraint, the right metric is **profit per water**, not profit per
  hour. FV2's value table follows that: profit per plot climbs with unlock level (Rice 66,
  Cabbage 385, Shallots 669), almost regardless of grow time.
- Reviewers called water the main frustration ("plants don't even start their production cycles
  until they are watered", [Gamezebo](https://www.gamezebo.com/reviews/farmville-2-review/)).
- Country Escape quietly removed it: 4 water per tap on the well, cap 30
  ([CE Water](https://farmvillecountryescape.fandom.com/wiki/Water)). One reviewer: "Water appears
  to be infinite too"
  ([PocketGamer](https://pocketgamer.com/articles/059185/farmville-2-country-escape)).
- FV3 brought the cap back, harder: a well gives 6 water per 6 h. Watering is optional there and
  doubles a plot's yield
  ([FV3 help](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/14488-how-does-the-water-well-work/)).
  An analyst called it "grindy and a session disruptor"
  ([The Why of Play](https://thewhyofplay.com/2021/11/22/farmville-3-evolution-or-revolution/)).

**Design reading.** Gamedeveloper's interview frames water as FV2's *replacement* for an energy
bar. Players gather water "for farming activities… a shift from arbitrary friction to strategic
resource planning", and "players can add more water wells"
([Gamedeveloper](https://www.gamedeveloper.com/design/does-zynga-really-need-a-i-farmville-2-i-you-bet)).
It is still an energy bar in a costume. The useful idea to keep is FV3's: **water as a yield
multiplier you may skip**, not a gate on planting.

---

## 5. Crops: the full FV2 table, with derived columns

All values from [FV2 wiki — Seeds](https://farmville2.fandom.com/wiki/Seeds) ("continuously
available seeds"). The raw table is also saved as `sources/fv2-seeds.csv`, ready for a balance
simulation. "Sell" is the Market Stand price for 1 harvested unit. An unfertilized plot
yields 1 unit and a fertilized plot yields 2. Derived columns were computed by me:
- *Profit* = sell − seed (unfertilized).
- *Fert. profit* = 2 × sell − seed.
- *Profit per water* = profit, since each plot costs 1 water.
- *Profit per plot-hour* = profit ÷ grow hours.

| Lvl | Crop | Seed | Sell | Profit | Fert. profit | Grow | Feed | XP | Profit/plot-h |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Tomato | 10 | 12 | 2 | 14 | 1 min | 1 | 1 | 120 |
| 2 | Wheat | 10 | 14 | 4 | 18 | 4 h | 2 | 2 | 1.0 |
| 3 | Blueberry | 15 | 17 | 2 | 19 | 2 min | 2 | 1 | 60 |
| 4 | Pumpkin | 15 | 20 | 5 | 25 | 8 h | 4 | 4 | 0.6 |
| 5 | Strawberry | 18 | 24 | 6 | 30 | 24 h | 10 | 13 | 0.25 |
| 6 | Onion | 22 | 30 | 8 | 38 | 12 h | 6 | 7 | 0.7 |
| 8 | Corn | 20 | 30 | 10 | 40 | 2 min | 2 | 2 | 300 |
| 10 | Sunflower | 25 | 47 | 22 | 69 | 24 h | 11 | 14 | 0.9 |
| 12 | Eggplant | 30 | 58 | 28 | 86 | 4 h | 4 | 4 | 7.0 |
| 14 | Radish | 28 | 35 | 7 | 42 | 2 min | 3 | 3 | 210 |
| 15 | Rice | 34 | 100 | 66 | 166 | 4 h | 5 | 5 | 16.5 |
| 15 | White Lily | 36 | 72 | 36 | 108 | 12 h | 3 | 3 | 3.0 |
| 16 | Broccoli | 45 | 87 | 42 | 129 | 8 h | 7 | 7 | 5.2 |
| 18 | Carrot | 60 | 118 | 58 | 176 | 24 h | 14 | 15 | 2.4 |
| 20 | Potato | 55 | 108 | 53 | 161 | 12 h | 10 | 10 | 4.4 |
| 22 | Ginger | 65 | 129 | 64 | 193 | 2 h | 7 | 6 | 32 |
| 24 | Blackberry | 75 | 98 | 23 | 121 | 2 min | 8 | **17** | 690 |
| 26 | Cucumber | 70 | 142 | 72 | 214 | 24 h | 15 | 17 | 3.0 |
| 28 | Spinach | 90 | 183 | 93 | 276 | 4 h | 10 | 7 | 23 |
| 30 | Sweet Potato | 100 | 206 | 106 | 312 | 4 h | 13 | 13 | 26.5 |
| 32 | Rye | 80 | 110 | 30 | 140 | 1 h | 8 | 8 | 30 |
| 34 | Red Pepper | 150 | 313 | 163 | 476 | 12 h | 19 | 12 | 13.6 |
| 36 | Squash | 145 | 313 | 168 | 481 | 2 h | 8 | 9 | 84 |
| 38 | Cabbage | 130 | 515 | **385** | 900 | 24 h | 16 | 19 | 16 |
| 40 | Lavender | 160 | 267 | 107 | 374 | 8 h | 11 | 11 | 13.4 |
| 42 | Barley | 175 | 278 | 103 | 381 | 2 h | 9 | 10 | 51.5 |
| 43 | Cattail | 60 | 133 | 73 | 206 | 16 h | 12 | 16 | 4.6 |
| 45 | Asparagus | 185 | 290 | 105 | 395 | 24 h | 18 | 21 | 4.4 |
| 50 | Soybean | 190 | 300 | 110 | 410 | 6 h | 12 | 12 | 18.3 |
| 50 | Watercress | 50 | 105 | 55 | 160 | 4 h | 6 | 7 | 13.8 |
| 55 | Raspberry | 130 | 310 | 180 | 490 | 18 h | 17 | 23 | 10 |
| 57 | Wild Rice | 40 | 94 | 54 | 148 | 8 h | 7 | 15 | 6.8 |
| 60 | Quinoa | 250 | 325 | 75 | 400 | 4 h | 14 | 14 | 18.8 |
| 63 | Oat | 40 | 96 | 56 | 152 | 8 h | 7 | 16 | 7.0 |
| 66 | Agave | 82 | 197 | 115 | 312 | 12 h | 12 | 19 | 9.6 |
| 69 | Cilantro | 90 | 218 | 128 | 346 | 18 h | 15 | 23 | 7.1 |
| 71 | Water Chestnut | 105 | 256 | 151 | 407 | 12 h | 15 | 20 | 12.6 |
| 72 | Mint | 150 | 368 | 218 | 586 | 2 h | 16 | 16 | 109 |
| 75 | Vanilla | 80 | 139 | 59 | 198 | 18 h | 5 | 25 | 3.3 |
| 78 | Pink Rose | 120 | 301 | 181 | 482 | 8 h | 15 | 19 | 22.6 |
| 81 | Tea Plant | 165 | 416 | 251 | 667 | 12 h | 21 | 22 | 20.9 |
| 83 | Green Bean | 170 | 432 | 262 | 694 | 16 h | 23 | 24 | 16.4 |
| 85 | Taro | 180 | 461 | 281 | 742 | 18 h | 24 | 27 | 15.6 |
| 88 | Azuki Bean | 200 | 517 | 317 | 834 | 4 h | 21 | 19 | 79 |
| 91 | Cassava | 190 | 495 | 305 | 800 | 2 h | 20 | 20 | 152 |
| 92 | Garlic | 215 | 562 | 347 | 909 | 8 h | 24 | 22 | 43 |
| 96 | Oregano | 270 | 716 | 446 | 1162 | 16 h | 33 | 27 | 28 |
| 98 | American Lotus | 275 | 733 | 458 | 1191 | 24 h | 36 | 31 | 19 |
| 99 | Chickpea | 230 | 443 | 213 | 656 | 1 h | 23 | 21 | 213 |
| 100 | Black Orchid | 300 | 805 | 505 | 1310 | 12 h | 34 | 26 | 42 |
| 100 | Yellow Bell Pepper | 290 | 778 | 488 | 1266 | 4 h | 30 | 22 | 122 |
| 102 | Zucchini | 320 | 865 | 545 | 1410 | 4 h | 33 | 22 | 136 |
| 105 | Bearded Iris | 325 | 885 | 560 | 1445 | 10 h | 36 | 27 | 56 |
| 113 | River Spinach | 335 | 935 | 600 | 1535 | 14 h | 38 | 30 | 43 |
| 116 | Aquatic Mint | 345 | 971 | 626 | 1597 | 8 h | 37 | 27 | 78 |
| 121 | Shallots | 360 | 1029 | 669 | 1698 | 24 h | 44 | 36 | 28 |

**Limited-time seeds** (about 28 of them: Daisy, Red Rose, Peanut, Habanero and others) were all
cheap at 15–80 coins, sold for about 1.4× seed, grew in 1–8 h, and gave 2–5 XP. They existed to
feed event recipes ([Seeds](https://farmville2.fandom.com/wiki/Seeds)). **Crop packets** bought
with Farm Bucks unlocked a premium crop for 1–2 weeks
([Farm Bucks](https://farmville2.fandom.com/wiki/Farm_Bucks)).

### 5.1 How growth time and value scale in FV2

- **Grow-time menu.** FV2 uses fixed buckets: 1 min, 2 min, 1 h, 2 h, 4 h, 6 h, 8 h, 10–18 h and
  24 h. New crops at higher levels re-use every bucket, so a level-90 crop can take 2 h.
- **Value scales with unlock level, not with time.** Profit per plot grows about 300× from level 1
  to level 121, while time stays in the same buckets. Because each plot costs 1 water, a new crop is
  mostly a better *water* converter.
- **XP scales sub-linearly with time** for early crops: 1 XP per 1–2 min, 2 per 4 h, 4 per 8 h,
  7 per 12 h, 13–14 per 24 h ([XP Gained](https://farmville2.fandom.com/wiki/XP_Gained)).
  Long crops pay more XP *per tending action* and short crops pay more XP *per hour of attention*.
  That is the right shape.
- **Feed value scales with time and level.** Strawberry gives 10 feed for 18 coins, the best feed
  per coin early. 2-min crops give 1–3 feed
  ([Feed](https://farmville2.fandom.com/wiki/Feed)).
- **The table is not coherent, and outliers become exploits:**
  - Blackberry pays 17 XP every 2 minutes, while Strawberry pays 13 XP per 24 h.
  - Cabbage profits 385 per water at level 38, but Lavender (level 40) profits only 107, and Quinoa
    (level 60) 75.
  - Corn and Radish are 2-minute crops with profit per plot-hour of 210–300, versus under 1 for most
    24 h crops.

  Players "were min-maxing it and making strategy guides really quickly" [27:44]. A designed
  economy should derive every value from one formula and test it (see §18).

### 5.2 How the other games scale crops

- **CE.** Crops are permanent "fields": Wheat gives 3 per 30 s, Apple Tree 1 per 10 s, Corn 2 per
  2 min, Carrot 3 per 4 min, Strawberry 3 per 1 h, Peach Tree 2 per 4 h, Lemon Tree 3 per 10 h.
  Each needs 1 water to restart, and you may own at most 6 of each crop type: the 3rd–6th cost
  5 / 10 / 50 / 75 keys ([CE Crop](https://farmvillecountryescape.fandom.com/wiki/Crop)).
- **Hay Day.** No seed purchase: "Each plot yields 2 plants (net gain of 1 plant)". Wheat takes
  2 min for 1 XP. Fields come as level rewards: 3 every other level until level 49
  ([HD Wheat](https://hayday.fandom.com/wiki/Wheat),
  [HD Experience](https://hayday.fandom.com/wiki/Experience)).
- **FV3.**

  | Crop | Unlock level | Seed (coins) | Grow time |
  |---|---|---|---|
  | Sunflower | 1 | free | 2 min |
  | Wheat | 3 | 1 | 5 min |
  | Soybean | 5 | 2 | 10 min |
  | Carrot | 7 | 3 | 15 min |
  | Corn | 12 | 5 | 1 h |
  | Tomato | 18 | 6 | 2 h |
  | Cotton | 27 | 8 | 4 h |
  | Rice | 36 | 9 | 6 h |
  | Chili | 38 | 10 | 8 h |
  | Pumpkin | 46 | 18 | 12 h |

  Time grows *with* level here ([FV3 Crops](https://fv3.fandom.com/wiki/Crops)).

---

## 6. Withering and spoiling

| Game | Rule | Source |
|---|---|---|
| FV1 | "All crops on FarmVille will wither in 2.5 times their growing time" from planting, at random times between 2× and 2.5×. A withered crop gives no coins and no XP. Unwither Ring: 250 Farm Cash for permanent immunity. Neighbours may unwither after 14 days away. | [FV1 Wither](https://farmville.fandom.com/wiki/Wither), [Unwither Ring](https://farmville.fandom.com/wiki/Unwither_Ring) |
| FV2 | About 3 real days after ripe. Unwither 2 for 3 FB. Neighbours unwither for free (5 per 18 h). A level-up revives. **Trees never wither.** Zynga: withering is "not a central theme"; "we made the timers for them a lot more generous". | [Seeds](https://farmville2.fandom.com/wiki/Seeds), [Unwither](https://farmville2.fandom.com/wiki/Unwither), [Engadget](https://www.engadget.com/2012-09-05-farmville-2-updates-zyngas-cow-clicker-but-not-too-much.html), [AllThingsD](https://allthingsd.com/20120905/farmville-sequel-gets-a-facelift-with-3-d-graphics-and-all-new-game-play/) |
| FV2 animals | "Animals don't suffer if untended" ([Gamedeveloper](https://www.gamedeveloper.com/design/does-zynga-really-need-a-i-farmville-2-i-you-bet)). "Your animals never die" [29:08]. | |
| Hay Day | Ripe crops wait in the field. If the silo is full "you cannot harvest — crops sit in the field". Trees and bushes die after several harvests and must be replaced. | [farmgamehub](https://www.farmgamehub.com/en/guides/hay-day/crops), [HD Crops](https://hayday.fandom.com/wiki/Crops) |

Why FV1's withering was dropped: Zynga's own chief designer described it as "a not-fun mechanic
that compels people to play out of a sense of shame"
([Soren Johnson, Designer Notes](http://www.designer-notes.com/fear-and-loathing-in-farmville/)).
(FV2's wiki also says "crops will wither when not harvested within ¼ of the growing time"; that
appears to be confused with other titles and conflicts with the 3-day rule. Treat the 3-day rule as
correct.)

---

## 7. Mastery, prized items and ribbons

**FV2 crop mastery** unlocks at level 7. Each crop has three ribbons, yellow → red → blue. Every
harvest of that crop adds mastery points.

Effects of mastery:
- More coins (formula quoted as "20 × weight"), more XP ("1 × weight") and more mastery per
  harvest.
- A higher chance of **prized crops**.
- A farm **mastery sign** that grows with each ribbon.

([Gamelytic mastery guide](https://gamelytic.com/farmville-2-crop-mastery-guide/),
[Yahoo/Joystiq](https://finance.yahoo.com/news/2012-09-06-farmville-2-crop-mastery.html))

Harvests needed per ribbon (yellow / red / blue):

| Crop | Yellow | Red | Blue |
|---|---|---|---|
| Tomato | 10 | 90 | 100 |
| Wheat | 11 | 109 | 180 |
| Blueberry | 12 | 118 | 270 |
| Pumpkin | 50 | 181 | 546 |
| Vanilla | 50 | 181 | 680 |
| Onion / Sunflower | 99 | 363 | — |
| Carrot / Potato / Broccoli | 198 (yellow) | — | — |

Fast crops (Radish, Rye) need 4,000+ harvests for blue
([Speed-Grow](https://farmville2.fandom.com/wiki/Speed-Grow)). Some guide figures are not
monotonic (Corn is listed as 750 / 2,750 / 1,115), so treat the table as approximate.

**Prized crops.**
- A fertilized crop has a 10% chance of being prized. The chance rises at each ribbon.
- A prized crop pays extra mastery points, coins and XP.
- Prized goods also scored County Fair points.

([Seeds](https://farmville2.fandom.com/wiki/Seeds),
[Prized Crop](https://farmville2.fandom.com/wiki/Prized_Crop))

**Animal mastery and prized animals.**
- An adult becomes **prized** after a set number of feedings: 35 for a White Chicken, 50–100 for
  others.
- A prized animal is fed every 18 h instead of every 5 min–8 h.
- It produces a premium good (Brown Egg, Goat Cheese, Swiss Cheese, Fine Saddle), gives much more
  XP per feed, gives no fertilizer, and sells for double.
- White Chicken animal-mastery ribbons need 68 / 213 / 515 feedings.
- Marie rewards each animal ribbon with 4 / 6 / 8 Super Feed.

([White Chicken](https://farmville2.fandom.com/wiki/White_Chicken),
[help: fertilizer](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/564-why-do-i-not-always-get-fertilizers-from-feeding-animals/),
[Super Feed](https://farmville2.fandom.com/wiki/Super_Feed))

**Other games:**
- **FV1:** level 1 / 2 / 3 mastery paid 25 XP + 500 coins / 75 XP + 1,500 / 250 XP + 5,000, plus a
  sign ([FV1 Crop Mastery](https://farmville.fandom.com/wiki/Crop_Mastery)).
- **CE "World Class Mastery":** star 1 gives +5% sell price, star 2 −10% grow time, star 3 a 15%
  chance of an extra unit ([CE Mastery](https://farmvillecountryescape.fandom.com/wiki/Mastery)).
  This is the cleanest perk ladder in the franchise.

**What FV2's designers learned** [21:24–24:48]. They first wanted every item to grow over time:
tend one pumpkin into a prized pumpkin, keep one tree for years. It failed:
- Players "never wanted to stop feeding that chicken… and in the end they said… I wish that I felt
  like I should be doing a wider variety of things".
- Every click on the pumpkin became a choice between harvesting it and tending it: "if everything
  you click on is a decision… it goes against that concept of relaxation".
- It was too subtle to see, and it caused "an art explosion" (10 states per item).

The fix kept prized items as a light layer. **Mastery belongs to the crop *type*, earned by
harvesting normally, never to one plot you must keep nursing.**

---

## 8. Trees

Trees are bought once with coins and placed on a 3×3 footprint, not on soil. Each cycle costs
water. They never wither. Visitors can harvest them for +1 product
([Trees](https://farmville2.fandom.com/wiki/Trees)).

| Tree | Cost | Water per cycle | Cycle | Products per harvest | Sell each | Feed each | XP per harvest |
|---|---|---|---|---|---|---|---|
| Lemon (lvl 2) | 260 | 3 | 12 h | 6 | 14–17 | 3 | 4 |
| Apple (lvl 3) | 320 | 2 | 4 h | 4 | 18 | 2 | 2 |
| Orange | 300 | 3 | 8 h | 5 | 18 | 3 | 3 |
| Olive (lvl 5) | 480 | 3 | 12 h | 6 | 29 | 5 | 5 |
| Fig | 400 | 3 | 12 h | ? | 25 | 4 | 5 |
| Peach | 620 | 3 | 2 h | 4 | 33 | 3 | 4 |
| Pear | 800 | 3 | 24 h | 6 | 41 | 4 | 10 |
| Pecan | 1,200 | ? | 12 h | 6 | 43 | 4 | 9 |
| Mango (lvl 20) | 1,800 | 3 | 2 h | 4 | 98 | 5 | 10 |
| Pine (wood) | 5,600 | 6 | 24 h | 6 | 98 | 0 | 34 |
| Banana | ? | 4 | 20 h | 6 | 163 | 9 | 18 |
| Cherry | ? | 4 | 8 h | 5 | 234 | 8 | 25 |
| Walnut | ? | 4 | 10 h | 5 | 255 | 9 | 29 |

Sources: individual tree pages, for example [Apple Tree](https://farmville2.fandom.com/wiki/Apple_Tree),
[Lemon Tree](https://farmville2.fandom.com/wiki/Lemon_Tree) and
[Pine Tree](https://farmville2.fandom.com/wiki/Pine_Tree). The Trees page also lists about 70 more
(nuts, maple sap, coffee, lychee, coconut, wood-only pines and willows).

**Yield variance.** The minimum yield is 2–4. A 5% "jackpot" gives up to 13 when the tree is
fertilized, in a grove, and harvested by a visitor. That is a deliberate small slot machine
([Trees, yield table](https://farmville2.fandom.com/wiki/Trees)).

**Grove** (level 27, 98,000 coins + 80 Favor):
- Holds 4 trees in a 4×4 footprint instead of 4 × 3×3.
- Uses 1 water less per tree.
- Grows +1 fruit when all 4 trees are the same species. Upgrades add +1 to +4 bonus fruit.
- The grove's cycle is the rounded-up mean of its trees' cycles. Mixing a 24 h Pine with a 2 h
  Apricot gives 13 h, a trick that let players speed up slow trees.

([Grove](https://farmville2.fandom.com/wiki/Grove))

Wood (Pine) feeds building materials, Lumber in the workshop.

---

## 9. Animals

**Lifecycle** ([help: raise animals](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/681-how-do-i-raise-my-animals/),
[help: care](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/132-how-do-i-take-care-of-my-animals-1688027470/),
[Baby Bottle](https://farmville2.fandom.com/wiki/Baby_Bottle)):

1. **Baby.** Bought for coins (an adult cost Farm Bucks). It needs 2–17 Baby Bottles at intervals,
   with a 15 s gap between bottles. Bottles came from friends or Farm Bucks (2 for 3 FB), and the
   inventory held at most 12. **This was the most-hated paywall**: "spamming your Facebook friends
   for gifts, or… purchasing them with real money… like Zynga was holding a gun to my head"
   ([Dragonchasers](https://dragonchasers.com/2012/09/07/4697/)).
2. **Adult.** When hungry it shows a feed thought-bubble. Feeding takes N feed and returns its good
   at a 100% rate, plus fertilizer by chance (each animal has a fixed fertilizer amount), plus XP.
3. **Prized** after X feedings. It eats every 18 h, makes a premium good and more XP, and gives no
   fertilizer. It can be sold for double or entered at the fair.

| Animal (unlock) | Cost (coins) | Bottles | Feed per meal | Interval | Output | XP (adult / prized) | Feedings to prized |
|---|---|---|---|---|---|---|---|
| White Chicken (3) | 1,500 | 2 | 3 | 5 min | Egg ×1–2 (60 each; 79% one, 21% two) | 2 / 15 | 35 |
| Rhode Island Red (6) | 6,000 | 3 | 6 | 5 min | 2 Egg + 1 fertilizer | 4 / 23 | 50 |
| Red Goat (1) | 3,000 | 2 | 4 | 15 min | Milk 85 / Cheese 200 | 2 / 45 | 40 |
| Saanen Goat (5) | 9,500 | 5 | 4–5 | 15 min | Milk / Cheese | 3 / 36 | 50 |
| White Sheep (6) | 9,000 | 3 | 4 | 8 h | Wool 90 + Milk | 3 / 35 | 50 |
| Cottontail Rabbit (8) | 4,000 | 2 | 4 | 1 h | Wool | 3 / 35 | 50 |
| Mustang Horse (10) | 14,000 | 9 | 6 | 6 h | Horseshoe 150 | 5 / 42 | 50 |
| Longhorn Cow (11) | 20,000 | 5 | 4 | 3 h | 1 Milk + 2 Cheese + 3 fertilizer | 4 / 60 | 50 |
| Jersey Cow (15) | 35,000 | 9 | 8 | 3 h | 2 Milk + 3 Cheese + 3 fertilizer | 7 / 105 | 65 |
| Swiss Cow (20) | 65,000 | 17 | 12 | 3–4 h | 3 Milk + 4 Cheese + 3 fertilizer | 10 / 150 | 100 |
| Devon Cow (33) | 85,000 | 15 | 20 | 3–4 h | 3 Milk + 2 Cheese + 1 fertilizer | 16 / 150 | 90 |

Sources: [Animals](https://farmville2.fandom.com/wiki/Animals),
[Chicken](https://farmville2.fandom.com/wiki/Chicken), [Cow](https://farmville2.fandom.com/wiki/Cow),
[White Chicken](https://farmville2.fandom.com/wiki/White_Chicken),
[Jersey Cow](https://farmville2.fandom.com/wiki/Jersey_Cow),
[Mustang Horse](https://farmville2.fandom.com/wiki/Mustang_Horse),
[XP Gained](https://farmville2.fandom.com/wiki/XP_Gained). Cheese sells for 200, Milk 85, Egg 60,
Wool 90 and Horseshoe 150 ([Milk](https://farmville2.fandom.com/wiki/Milk),
[Cheese](https://farmville2.fandom.com/wiki/Cheese)).

**Worked return on a White Chicken** ([White Chicken](https://farmville2.fandom.com/wiki/White_Chicken)):
- Over 35 adult feedings it lays eggs worth an average 2,601 coins and gives 70 XP.
- Its feed costs 189 coins and 10.5 water when made from Strawberries.
- Sold right after it becomes prized, its net gain is 1,112 coins, or about 106 coins per water.

Animals therefore turn cheap crops into expensive goods. That is the reason crops exist.

**Capacity and buildings:**
- **Animal cap:** 10 at start. Each Water Trough adds +5 (up to 6 of them: free, 5,000, 20,000,
  28,000 coins, 45 FB, free), and the Shady Trough adds +10. The maximum is 55
  ([help: animal limit](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/202-how-do-i-increase-my-animal-limit-1688028076/)).
- **Feed cap:** 25. Each Silo adds +25 (5 silos: free, 15,000, 25,000, 50,000, 75,000 coins), the
  Goat Shelter and Sheep Shack +35, the Prized Chicken Coop +50
  ([Feed](https://farmville2.fandom.com/wiki/Feed), [Silo](https://farmville2.fandom.com/wiki/Silo)).
- **Feed Mill:** turns crops into feed ([Feed Mill](https://farmville2.fandom.com/wiki/Feed_Mill)).
  Later it also made Super Feed (1 = 80 feed, 8 h cooldown), which counts as 3 instant feedings
  ([Super Feed](https://farmville2.fandom.com/wiki/Super_Feed)).
- **Troughs** (level 30+, coins + Favor): feed all chickens at once, +10–15% eggs, more feed
  capacity ([Trough](https://farmville2.fandom.com/wiki/Trough)).
- **Fertilizer Bin:** each feeding adds 1 point. At 40 points the bin gives 12 fertilizer and a 25%
  chance of a Speed-Grow ([Fertilizer Bin](https://farmville2.fandom.com/wiki/Fertilizer_Bin)).
- **Herd buildings with collections.** These reward keeping *several* animals of a kind:
  - Hen House: needs 3+ adult chickens. Every 24 h it gives 3–6 eggs, 10 XP and an Exotic Egg
    (65% uncommon, 25% rare, 10% ultra-rare). The set of 2 + 2 + 1 unlocks an exclusive chicken.
  - Spinning Wheel: sheep and rabbits.
  - Mud Wallow: needs 4+ pigs.

  ([Hen House](https://farmville2.fandom.com/wiki/Hen_House),
  [Spinning Wheel](https://farmville2.fandom.com/wiki/Spinning_Wheel),
  [Mud Wallow](https://farmville2.fandom.com/wiki/Mud_Wallow))

**Other games' lifecycles:**
- **FV3:** Baby → Adult (fast production) → Mature (normal speed; can breed) → Elder. An Elder is
  sold automatically for "Elder Animal Points" once its own baby grows up
  ([FV3 help: stages](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/20096-what-are-animal-stages/),
  [Elder points](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/18986-what-are-elder-animal-points/)).
  An analyst found this forced cycling cut output ("forced to sell 2 animals to keep one")
  ([The Why of Play](https://thewhyofplay.com/2021/11/22/farmville-3-evolution-or-revolution/)).
- **CE:** at most 4 of each animal type. The first costs coins, the others keys or stamps. Cycles
  are very short: a Cow gives 1 milk every 1 min for 3 wheat, a Chicken 3 eggs every 4 min for
  2 corn ([CE Animals](https://farmvillecountryescape.fandom.com/wiki/Animals)).

---

## 10. Crafting

**Buildings.** Kitchen (food), Workshop (goods), Crafting Kiln (pottery from pig mud, with an
"On Fire" meter that doubles XP). Each craft costs **Power**:
- Cap 30 (15 at launch per [Dragonchasers](https://dragonchasers.com/2012/09/07/4697/)).
- Regenerates 1 per 4 min.
- The Furnace gives +10 per 23 h, the Windmill upgrade +10 per harvest, Farm Bucks 2 for 3 FB.

([Power](https://farmville2.fandom.com/wiki/Power), [Kitchen](https://farmville2.fandom.com/wiki/Kitchen),
[help: kiln](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/1616-how-do-i-use-the-crafting-kiln/),
[Windmill](https://farmville2.fandom.com/wiki/Windmill))

**Two kinds of recipe** ([help: kitchen](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/415-how-do-i-use-the-crafting-kitchen/)):
- *Crafted goods* (intermediates such as Flour, Batter, Lemon Water) cannot be sold.
- *Finished products* (marked with a star) sell at the Market Stand.

Some ingredients (Salt, Sugar) came only from neighbours. Recipes unlock by level.

| Recipe (lvl) | Ingredients | Raw value* | Sells | Ratio | XP | Power |
|---|---|---|---|---|---|---|
| Flour (5) | 4 Wheat | 56 | (90, intermediate) | — | 2 | 1 |
| Batter (5) | 4 Wheat + 3 Egg | 236 | 290 | 1.2 | 6 | 2 |
| Apple Scone (3) | 6 Apple + 4 Wheat + 3 Egg | 344 | 640 | 1.9 | 13 | 3 |
| Strawberry Lemonade (6) | 5 Strawberry + 6 Lemon + 1 Water | ~205 | 630 | 3.1 | 13 | 3 |
| Pumpkin Pie (8) | 8 Pumpkin + 8 Wheat + 2 Milk | 442 | 860 | 1.9 | 26 | 5 |
| Peach Lemonade (11) | 6 Peach + 6 Lemon + 1 Water | ~290 | 1,030 | 3.6 | 15 | 3 |
| Apple Pie (15) | 8 Apple + 8 Wheat + 2 Milk + 1 Water | 426 | 1,300 | 3.1 | 34 | 7 |
| Cheddar Loaf (14) | 2 Cheese + 4 Wheat + 2 Water + 2 Salt | 456 + salt | 1,230 | 2.7 | 25 | 4 |
| Tomato Soup (6) | 8 Tomato + 6 Onion + 3 Water | 276 | 700 | 2.5 | 13 | 3 |

\*Raw value = the Market Stand price of the ingredients, computed by me. Recipe pages:
[Apple Pie](https://farmville2.fandom.com/wiki/Apple_Pie),
[Apple Scone](https://farmville2.fandom.com/wiki/Apple_Scone),
[Strawberry Lemonade](https://farmville2.fandom.com/wiki/Strawberry_Lemonade),
[Pumpkin Pie](https://farmville2.fandom.com/wiki/Pumpkin_Pie),
[Tomato Soup](https://farmville2.fandom.com/wiki/Tomato_Soup),
[Cheddar Loaf](https://farmville2.fandom.com/wiki/Cheddar_Loaf),
[Batter](https://farmville2.fandom.com/wiki/Batter), [Flour](https://farmville2.fandom.com/wiki/Flour).

**Rule of thumb:** a finished product sells for about **2–3.5× its raw inputs** and pays 2–5× the
XP of the raw harvests. Crafting is how "transformation" feels earned. The best recipes also mix
inputs from all three sources (crop + tree + animal), which pulls the whole ecosystem along.

**CE crafting** works differently: workshops run a timed queue, with no energy.
- Up to 6 of each workshop. The 2nd–6th cost 20 / 40 / 80 / 160 / 320 keys.
- Upgrades allow batch crafts. Batch sizes ×2 / ×3 / ×5 / ×10 take 1.75 / 2.5 / 4 / 7.75 × the
  time of one item, so batching is a time discount.

([CE Workshop](https://farmvillecountryescape.fandom.com/wiki/Workshop)) Hay Day uses the same
timed-machine model.

---

## 11. How goods flow

| Destination | What goes in | What comes out | Notes |
|---|---|---|---|
| **Market Stand** (sell) | Crops, tree goods, animal goods, finished recipes | Coins at a fixed price | Instant, no haggling. FV2 once refused sales above 5 M coins (later lifted) ([Market Stand](https://farmville2.fandom.com/wiki/Market_Stand), [help](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/133-how-do-i-use-the-market-stand/)) |
| **Feed Mill** | Crops, fruit, tree goods | Feed (capped) | The only feed source besides Farm Bucks |
| **Kitchen / Workshop / Kiln** | Raw goods + intermediates + water + neighbour-only items | Intermediates and finished products | Costs Power |
| **Animals** | Feed | Goods + fertilizer + XP | Fertilizer returns to crops and trees |
| **Grocer daily orders** (Cornelius) | Specific goods | Grocer points. A track of 8 rewards at 35 / 110 / 275 / 525 / 875 / 1,355 / 1,900 / 3,130 points: bench, 5 water, 5 fertilizer, 5 sugar, Baby Bottle, 10 Speed-Grow, fountain | New orders every 24 h ([Market Stand](https://farmville2.fandom.com/wiki/Market_Stand)) |
| **Big Harvest order board** (level 25+) | Crafted and collected goods | **Coins equal to market value plus Favors** (for example 3 Apple Pies → 3,900 coins + 1 Favor). Weekly goal of 15 orders → +100 Favor | Discarding an order means waiting hours. Speed it up with posted "Fliers" or FB ([help: Big Harvest](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/676-what-is-the-big-harvest/), [help: order board](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/677-how-do-i-use-the-order-board/)) |
| **Co-op order board** | Members' orders | Co-op win: +200 Favor and **all watered plants and trees grow at once**. Top farmer: 50 water and Hall of Fame | Members can "call for help" to have ingredients donated. Up to 35 orders per member per week ([help: co-op](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/612-how-do-i-use-the-co-op-feature/), [co-op goal](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/3044-what-is-the-new-co-op-goal/)) |
| **Quests** | "Harvest 16 wheat", "feed X", "craft Y" | XP, coins, unlocks | Optional ([Quest](https://farmville2.fandom.com/wiki/Quest)) |
| **Expansions** | "Sell 8 eggs", "craft 9 Peach Lemonades", "have 1 adult Swiss Cow" | Land and an unlock | See §15 |
| **Fair** | Prized goods | Fair points and medals | See `progression-goals-coop.md` §1.1 |

The order boards in the other games show the design space:
- **CE, Marie's board** ([CE Farm Order Board](https://farmvillecountryescape.fandom.com/wiki/Farm_Order_Board),
  [CE Market](https://farmvillecountryescape.fandom.com/wiki/Market),
  [Sales Bonus Meter](https://farmvillecountryescape.fandom.com/wiki/Sales_Bonus_Meter)):
  - Slots grow from 2 to a 3×3 grid of 9 by level 9.
  - Pays base market price plus XP.
  - From level 10 you may reject an order. A new one arrives in 10 min, or at once for 2 keys.
  - From level 15, filled orders charge a **Sales Bonus Meter**. Filling it in time opens a pick-a-crate
    bonus with 20 escalating tiers.
  - Other NPC buyers pay base price +10–15%.
- **Hay Day truck** ([Truck](https://hayday.fandom.com/wiki/Truck)):
  - 1 slot at first, 9 by level 32.
  - Orders ask only for things you can make at your level.
  - Orders with high coins pay less XP, and the reverse.
  - Discarding costs a 6–30 min wait.
  - Friends can help fill an order.
- **Hay Day boat:** 14–17 h to fill all crates. A newer option lets you pick easy / medium / hard
  destinations for more "nautical miles" ([Boat](https://hayday.fandom.com/wiki/Boat)).
- **FV3:**
  - Order-board coins fill a meter that opens **reward boxes** containing new animals.
  - Boat shipments pay ribbons. A partly filled boat can still ship for less.
  - Market visitors stay up to 5 days. If you decline them all, new ones come after 30 min.
  - Helping a friend's order pays you the order's coin value plus a help bonus.

  ([FV3 boat](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/16455-how-do-i-send-boat-shipments/),
  [visitors](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/17093-what-are-market-stand-visitors-1604570621/),
  [help friends](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/18315-how-can-i-help-my-friends-with-orders-on-their-orderboard/))
- **Player-to-player markets** (CE Farm Stand, Hay Day Roadside Shop): Hay Day caps prices at
  3.6× the default value ([Roadside Shop](https://hayday.fandom.com/wiki/Roadside_Shop)).

---

## 12. Storage limits

| Game | Rule | Source |
|---|---|---|
| FV2 web | No overall cap. Crafted goods, animals and decorations are unlimited. Per-item caps instead: Baby Bottles 12, Feed 25 (+ silos), the Water meter, Power 30 | [help: inventory](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/409-how-does-the-inventory-work-1688028527/), [help: item caps](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/405-how-many-items-can-i-store-in-my-inventory-1688028775/) |
| CE | Barn starts at 50 slots, +10 per upgrade to 950. Upgrades need Barn Nails, Padlocks and Shovels (random drops), or 8–9 keys each. Silo from level 19: 20 → 840, crops and animal goods only. Discarding opens at 90% full, for no coins | [CE Barn](https://farmvillecountryescape.fandom.com/wiki/Barn), [CE Silo](https://farmvillecountryescape.fandom.com/wiki/Silo) |
| Hay Day | Silo (crops) and Barn (goods) start at 50. +25 per upgrade to 1,000, then +50. Each upgrade needs one more of each of 3 parts than the last. A full silo blocks harvesting | [HD Silo](https://hayday.fandom.com/wiki/Silo), [HD Barn](https://hayday.fandom.com/wiki/Barn) |
| FV3 | Barn and Silo are prompted for upgrade when full. Upgrade items are "exceedingly rare" | [The Why of Play](https://thewhyofplay.com/2021/11/22/farmville-3-evolution-or-revolution/) |

Player view of storage friction: "the barn gets full and when you can't sell items, you have to
throw them away"; "To expand one's barn takes months or weeks of work. You have to have so and so
many nails, so and so many locks"
([millietilly](https://millietilly.wordpress.com/2016/02/26/farmville-2-country-escape-or-how-to-get-really-angry/)).
Storage caps are a monetisation lever. In a private game they should exist only as a gentle
planning constraint, if at all.

---

## 13. Currencies and resources

| Currency | Earned by | Spent on | Cap / regen |
|---|---|---|---|
| **Coins** | Market Stand sales, orders, quests, level-ups (100 → 12,400 per level), neighbour visits (50) | Seeds, trees, animals (1,500–85,000), wells and silos, expansions (175 → 179 M), upgrades, decorations | None (an old 5 M sell cap) ([Coins](https://farmville2.fandom.com/wiki/Coins)) |
| **XP** | Almost every action (§14) | Levels → unlocks | — |
| **Water** | Regen, wells, level-ups, neighbours, Farm Bucks | Crops, trees, some recipes | ~20 base cap; 1 per 3 min |
| **Feed** | Feed Mill (crops), Farm Bucks | Animals | 25 + 25 per silo |
| **Fertilizer** | Animal drops (chance), Fertilizer Bin (12 per 40 feedings), neighbours, grocer rewards, Farm Bucks | ×2 crop yield, +1 tree product, prized chance | — |
| **Power** | Regen, Furnace, Windmill, farmhands (+5), Farm Bucks | Crafting | 30; 1 per 4 min |
| **Fuel** | Regen (1 per 3 min), Fuel Pump | Crop Dryer, Crop Duster (from level 15) | ([Fuel](https://farmville2.fandom.com/wiki/Fuel)) |
| **Favor** | Order-board orders, weekly goal (+100), co-op win (+200), quests after the stand upgrade | Upgrades (Field, Grove, Trough, Windmill, Water Tower, Barn) and late expansions | ([Favor](https://farmville2.fandom.com/wiki/Favor)) |
| **Mastery points** | Harvesting a given crop (prized: more) | Ribbons → perks and signs | Per item |
| **Speed-Grow / Super Feed / Unwither / Baby Bottle** | Quests, bins, ribbons, friends, Farm Bucks | Skipping timers, animal growth | Per-item caps |
| **Farm Bucks** (premium) | Real money only. 10 at start, 20 for linking CE | Adult animals, skips, consumables, crop packets, premium decorations, skipping friend requirements, hiring builders (1–2 FB each), early expansions | ([Farm Bucks](https://farmville2.fandom.com/wiki/Farm_Bucks)) |
| CE **Keys** | Quests, achievements (75 of them), daily Hope Chest (every 22 h), Prize Wheel (1 spin a day), sales bonus, ribbons | Extra fields, workshops, upgrades, missing upgrade parts, skips | Cap 20,000 ([Keys](https://farmvillecountryescape.fandom.com/wiki/Keys), [Achievement](https://farmvillecountryescape.fandom.com/wiki/Achievement)) |
| CE **Stamps** | Eddie's orders, trading ribbons | Prized animals, geese, nets | ([Stamp](https://farmvillecountryescape.fandom.com/wiki/Stamp)) |

**Pattern.** FV2 has one soft currency (coins), one progress currency (XP), one *earned* premium-like
currency (Favor, from orders only), and several regenerating "meters" (water, feed, power, fuel).
**The meters are what make it feel like an energy game.** Favor is a good idea to keep: it is
earned by *doing orders*, so it rewards engagement rather than wallet, and it buys structural
upgrades that coins cannot.

---

## 14. XP per action

From [Experience](https://farmville2.fandom.com/wiki/Experience),
[XP Gained](https://farmville2.fandom.com/wiki/XP_Gained), [Seeds](https://farmville2.fandom.com/wiki/Seeds)
and the recipe and animal pages:

| Action | XP |
|---|---|
| Water a seed or a tree | +1 |
| Fertilize a seed or a tree | +1 |
| Harvest a crop | 1 (1–2 min crops) … 13–14 (24 h crops) … 36 (Shallots). See §5 |
| Harvest a tree | 2 (Apple, 4 h) · 4 (Lemon, 12 h) · 10 (Mango, 2 h) · 25 (Cherry, 8 h) · 34 (Pine, 24 h) · 37 (Grapefruit, 18 h) |
| Feed an adult animal | 2 (White Chicken) … 16 (Devon Cow) |
| Feed a prized animal | 15 (chicken) … 150 (Swiss / Devon Cow) |
| Craft a recipe | 2 (Flour) … 34 (Apple Pie); limited recipes up to 65 |
| Building collections (Hen House, Mud Wallow, Spinning Wheel) | +10 |
| 5 actions on a neighbour's farm | +1 XP + 50 coins (+ ~25% chance of 1 water) |
| A neighbour helps on your farm | +1–2 to you |
| **Buying a decoration** | About **1 XP per 110 coins** (minimum 5): 250c → 5, 2,500c → 21–27, 25,000c → 223, 45,000c → 397 |

The decoration rule is a nice coin → XP sink. It lets a player turn surplus coins into progress
and beauty at the same time.

---

## 15. Level curve, rewards and unlocks

**XP needed to go from the previous level to this one** (FV2, early 2013 values;
[Levels 1–50](https://farmville2.fandom.com/wiki/Levels/1-50),
[51–100](https://farmville2.fandom.com/wiki/Levels/51-100)):

| Lvl | XP | Reward | Main unlocks |
|---|---|---|---|
| 2 | 20 | 100 c + 30 water | Wheat; Kitchen / Well / Lemon Orchard expansions |
| 3 | 70–80 | 200 c + 30 w | Blueberry, Apple Tree, Apple Scone, White Chicken |
| 4 | 120–155 | 300 c + 30 w | Pumpkin, Pygmy Goat |
| 5 | 190 | 650 c + 20 w | Strawberry, Olive Tree, Saanen Goat, Flour, Batter |
| 6 | 465 | 750 c + 10 w | Onion, Pine, RIR Chicken, White Sheep, Tomato Paste, Broth |
| 7 | 1,150 | 850 c + 10 w | Orange, Butter, Orange Cupcake, **seasonal crops**, **crop mastery** |
| 8 | 2,000 | 950 c | Corn, Nubian Goat, rabbits, Pie Crust |
| 10 | 4,550 | 1,150 c | Sunflower, Mustang, Custard |
| 12 | 5,300 | 1,350 c | Eggplant, Arabian Horse |
| 15 | 6,600 | 1,900 c | Pear, Jersey Cow, Apple Pie (river and fuel open at 15) |
| 20 | 9,500 | 2,400 c + 15 w | Potato, Mango, Swiss Cow |
| 25 | 14,000 | 3,150 c | Nutmeg, **Field upgrade**, Big Harvest order board |
| 27 | 17,000 | 3,350 c + 20 w | Plum, Water Field, Animal Barn, **Grove** |
| 30 | 23,000 | 3,650 c | Sweet Potato, **Troughs** |
| 35 | 33,000 | 4,150 c + 20 w | Grapefruit, **Windmill** |
| 40 | 47,000 | 4,900 c + 25 w | Lavender |
| 50 | 68,000 | 5,900 c + 25 w | Soybean, **Water Tower** |
| 56 → 57 → 60 | 80,000 → 100,000 → 200,000 | 6,500–6,900 c | (a steep wall, later flattened) |
| 80 | 73,015 | 9,900 c | after Zynga "lowered all the XP required" in late 2014 |
| 100 | 121,890 | 12,400 c + 30 w + 1,500 Fp | Black Orchid; **Barn** daily gifts |

**What a level-up gives** ([Levels](https://farmville2.fandom.com/wiki/Levels),
[help: level up](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/134-how-do-i-level-up-1688028360/)):
- Coins and water.
- **Every watered crop and tree ripens at once.**
- Every adult and prized animal becomes hungry again.
- A pop-up of the new items.

That makes the level-up a burst of play, not just a number. Cadence: roughly 1 new crop, tree or
animal **plus** 1–5 recipes per level, and a structural feature every 5–10 levels.

**Level cap history.** 40 at launch (2012) → 60 → 80 → 100 (Jan 2014) → … → 540 (2020). It rose
about 20 levels a quarter, each step tied to a new expansion region
([Levels/History](https://farmville2.fandom.com/wiki/Levels/History)).

**Other curves for calibration:**
- **CE**, XP for the next level:

  | Level | XP | Level | XP | Level | XP |
  |---|---|---|---|---|---|
  | 1 | 5 | 8 | 200 | 18 | 3,000 |
  | 2 | 2 | 9 | 360 | 20 | 4,700 |
  | 3 | 18 | 10 | 520 | 25 | 9,300 |
  | 4 | 45 | 12 | 980 | 30 | 14,100 |
  | 5 | 45 | 15 | 1,800 | | |
  | 6 | 60 | | | | |
  | 7 | 100 | | | | |

  ([CE Levels 1–10](https://farmvillecountryescape.fandom.com/wiki/Levels_(1-10)),
  [11–20](https://farmvillecountryescape.fandom.com/wiki/Levels_(11-20)),
  [21–30](https://farmvillecountryescape.fandom.com/wiki/Levels_(21-30)))
- **Hay Day:** irregular up to level 50, then exactly linear,
  XP(L) = 157,000 + 11,000·(L − 50) for 50 ≤ L ≤ 500. Fields arrive every other level, and the XP bar
  has 1–5 intermediate reward thresholds per level from level 15
  ([HD Experience](https://hayday.fandom.com/wiki/Experience)).

**Lesson:** make the first 5 levels nearly instant (minutes), so the player is taught by unlocks.
Grow smoothly after that, and **avoid walls** like FV2's 56 → 60 jump, which Zynga later removed.

---

## 16. Farm expansion

FV2 land comes in named patches on a grid. Each patch needs:
- an adjacent unlocked patch;
- a player level;
- coins;
- a **proof-of-play task** (sell, harvest, craft, or own something);
- (for many patches) items gathered from friends.

Each patch **unlocks something specific**.
([help: expansion requirements](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/483-what-are-the-expansion-requirements-1688024717/),
[Expansion](https://farmville2.fandom.com/wiki/Expansion), [Expansion/C](https://farmville2.fandom.com/wiki/Expansion/C),
[/D](https://farmville2.fandom.com/wiki/Expansion/D), [/E](https://farmville2.fandom.com/wiki/Expansion/E))

| # | Patch | Level | Proof task | Coins | Unlocks |
|---|---|---|---|---|---|
| 3 | Feed Mill | 2 | — | 175 | Feed Mill, Lemon Tree |
| 4 | Family Well | 2 | Sell 8 Eggs, harvest 16 Wheat | 1,000 (wiki: 1,999) | Well |
| 5 | Farmstead Kitchen | 2 | Have 5 trees, sell 4 Milk | 2,000 | Kitchen |
| 6 | West Meadow | 5 | Craft 2 Apple Scones + 2 friend items | 20,000 | Cottontail Rabbit |
| 8 | Milk Meadow | 11 | Craft 9 Peach Lemonades + 7 friend items | 50,000 | Longhorn Cow, +1 trough |
| 9 | Old Silo | 15 | Craft 3 Apple Pies + 10 friend items | 125,000 | Silo (feed cap) |
| 11 | Mango Gardens | 20 | Own 1 adult Swiss Cow + 13 friend items | 300,000 | Mango trees |
| 12 | Golden Chicken Colony | 24 | Craft 5 Banana Cream Pies | 500,000 | Cochin chickens |
| 7 | Apricot Acres | 6+ | Sell 10 Saddles | 750,000 | Apricot Tree |
| 13 | Playground Patch | 34 | Craft 20 Cherry Cobblers | 2,000,000 | Tire swing |
| — | Storage Shack (E5) | 77 | Craft 8 Mac & Cheese, 250 Favor | 7,000,000 | +25 feed silo |
| — | Baltarac Valley (D6) | 129 | Craft 55 sweaters, 350 Favor | 18,000,000 | Patio firepit |
| — | Verdant Vistas (D10) | 296 | Craft 65 pasta, 1,150 Favor | 84,000,000 | — |

Prices rise about ×2–2.5 per ring of land, which is exponential, while income grows roughly
linearly with level and land. Reviewers disliked that land opened "only through leveling up, not
unlimited coin purchases"
([Gamezebo](https://www.gamezebo.com/reviews/farmville-2-review/)). The **proof task** is the good
part: each expansion is a mini-goal that pushes you to *use* the feature you just unlocked (eggs →
well, milk → kitchen, scones → meadow).

**Favor upgrades** sit beside land, each at a level, for coins + Favor:
- Field (level 25: 59,500 c + 65 F).
- Grove (27).
- Troughs (30).
- Windmill (35: 560,000 c + 270 F).
- Water Tower (50: 800,000 c + 540 F).
- Barn (100: daily gifts, 11.2 M c + 2,210 F).

([Field](https://farmville2.fandom.com/wiki/Field), [Grove](https://farmville2.fandom.com/wiki/Grove),
[Trough](https://farmville2.fandom.com/wiki/Trough), [Windmill](https://farmville2.fandom.com/wiki/Windmill),
[Water Tower](https://farmville2.fandom.com/wiki/Water_Tower), [Barn](https://farmville2.fandom.com/wiki/Barn))

---

## 17. Energy, paywalls, and why players hated them

**What each game used as a meter:**
- **FV1:** no energy, but withering guilt (shame), and Farm Cash for the Unwither Ring.
- **FV2:** water (crops and trees), Power (crafting), Fuel (machines). Baby Bottles and building
  materials were **friend- or Farm-Bucks-gated**. Every building needed 2–4 "neighbours to hire",
  or Farm Bucks per builder ([Farm Bucks](https://farmville2.fandom.com/wiki/Farm_Bucks),
  [Well](https://farmville2.fandom.com/wiki/Well),
  [help: kiln](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/1616-how-do-i-use-the-crafting-kiln/)).
- **CE:** no energy. Gated by **keys** (extra fields, workshops, upgrade parts) and storage.
- **FV3:** water 6 per 6 h, farmhand energy (cap 70), "animal energy" for exotic missions
  ([FV3 help](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/18018-if-i-have-more-farmhand-energy-than-the-limit-70-when-i-level-up-will-i-get-an-additional-70-farmhand-energy/)).

**Why players hated it** (direct sources):
- *Being stopped mid-session.* FV3: "a lot of energy/gating systems. Be it water, farmhand
  energy, animal energy, event limitations… grindy and a session disruptor very quickly"
  ([The Why of Play](https://thewhyofplay.com/2021/11/22/farmville-3-evolution-or-revolution/)).
  CastleVille-era players: "energy costs are usually insane"
  ([Tobold](http://tobolds.blogspot.com/2011/11/castleville.html)).
- *Paywalls in disguise.* FV2 baby bottles: get them by "spamming your Facebook friends… or by
  purchasing them with real money", "like Zynga was holding a gun to my head". The reviewer quit
  and said a $5–10 standalone version would have been better
  ([Dragonchasers](https://dragonchasers.com/2012/09/07/4697/)).
- *Begging friends.* "You can't even do that without constantly begging for stuff from your
  friends" ([Tobold](http://tobolds.blogspot.com/2011/11/castleville.html)); "too damn annoying and
  way too noisy" ([chasingdings](https://chasingdings.com/2011/11/22/how-castleville-lost-me/)).
- *Random drops gating progress.* "I sent farm hands in to grandmother's glen ten times, and never
  received any dough"; barn parts take "months or weeks"
  ([millietilly](https://millietilly.wordpress.com/2016/02/26/farmville-2-country-escape-or-how-to-get-really-angry/)).
- *Orders you cannot fill.* "I am on level 44 and one order can be for 6 peach yoghurts. The only
  problem is that I only have four peach trees" (same source).
- *Premium-locked slots.* CE keys: "you need them for everything. To buy more plots to cultivate,
  to add extra animals" (same source).
- *Deliberately worse design.* "Making the game worse can make it generate more revenue"
  ([Soren Johnson](http://www.designer-notes.com/fear-and-loathing-in-farmville/)).

**What FV2's own design director wanted instead** ([Gamedeveloper](https://www.gamedeveloper.com/design/does-zynga-really-need-a-i-farmville-2-i-you-bet)):
- "this should always remain something that feels like the best 10 minutes of your day".
- "we will not overwhelm you with tasks".
- Friends as farm helpers doing real work, not hollow gift-clicking.
- "never insult the player… casual players will surprise you" [46:14–48:41].

None of these meters is needed in a private, free game for two. Their *good* side effects can be
kept by other means (see §19):
- pacing (real-time growth already paces);
- a reason to come back (ripe crops, hungry animals);
- valuing planning (yield bonuses).

---

## 18. Designed feel: the parts of FV2 that made each click satisfying

These come from the postmortem and transfer directly to a Three.js client:
1. **"Treat your mouse hover like the wind"**: crops sway when the cursor passes over them
   [52:04–53:06].
2. **"Touch is electric"**: a click gets an immediate springy reaction. "If your game is a lot of
   fun to click on, it matters less why you're playing" [53:06–53:44].
3. **Audio ties it together**, even at low volume [52:19–52:33].
4. **Tempo:** the board is at 60 BPM (crops sway at 20–60 BPM). Pickups ("doobers") and the mailbox
   are at 120 BPM. 240 BPM, with particles in your face, is kept for level-ups and quest
   completions. The theme song is 60 BPM [56:58–57:57].
5. **Readable "done" state:** hungry animals have bubbles, ripe crops are bright and swaying. After
   tending, "the board looks very subdued and everything looks tidied up", and visible sprouts say
   "come back later". "You have to make it okay to leave" [49:27–50:47].
6. **One-handed play:** no complex 3D camera controls, because players hold coffee, a phone or a
   baby [39:06–40:59].
7. **GPU for frame rate, not for 3D:** "it wasn't 3D that we were excited about. It was actually GPU
   acceleration". **FV2's crops and trees were 2D**, while animals were 3D [33:00–33:45]. "80% of
   our revenue comes from players with 15 frames per second or better" [34:14]. There was a
   CPU-renderer fallback with fewer effects [36:10–36:30]. This is directly relevant to the owner's
   hot Vega iGPU: use instanced billboards and low-poly crops, and keep 3D for animals, buildings and
   terrain.
8. **Grounded fiction:** "please stay away from fantasy… they love the fact that their farm looks…
   like an actual farm". The game is about "the good life on the farm", "old-fashioned farming",
   animals that never die [28:15–29:30].

---

## 19. The 15 rules that make this loop satisfying

1. **Real-world causality, learnable in one look.** Water → crops → feed → animals → goods +
   manure → fertilizer → crops; goods → kitchen → sell or order. No invented currencies in the core
   loop. If a new player cannot predict what an item is for, the loop is too clever
   [41:14–46:04].
2. **Every core verb is tactile and quick.** Drag-paint to plow, plant, water, harvest and feed.
   Pickups pop, bounce and collect themselves. There is a hover response, a click response and
   sound on everything. One hand, no fiddly camera.
3. **Calm by default, exciting by exception.** The board is quiet (60 BPM). Pickups are perky.
   Fireworks are kept for level-ups, ribbons and big orders, so they keep their meaning.
4. **The board tells you what to do and when you are done.** Ripe and hungry things are loud.
   Tended things are quiet. Sprouts and timers say when to come back. Leaving must always feel fine.
5. **Several overlapping timer horizons.** There are minute-scale crops for active sessions, hour
   crops for the day, overnight crops, animal intervals (5 min → 8 h) and tree cycles (2–24 h). Any
   session has something ripe now and something to come back for.
6. **One harvest, several honest uses.** Sell it, mill it, craft it, deliver it, or feed it. The
   choice comes at *use*, not at every click; a click on a ripe plot simply harvests it. The
   designers removed "tend vs harvest" because every click had become a decision [22:55–23:19].
7. **Processing multiplies value.** Raw → intermediate → finished product should be worth about
   2–3.5× the raw inputs and pay much more XP than raw harvesting. The best recipes pull from crops,
   trees and animals together.
8. **Animals turn cheap crops into expensive goods and have a life arc.** Baby → adult → prized
   (premium good, trophy). The arc ends in a celebration (sell for double, ribbon, fair), not a
   loss, and it encourages variety rather than nursing one pet forever.
9. **Forgiveness.** Trees never wither, animals never die or suffer, and ripe crops wait (FV2 gave
   about 3 days; a private game can give forever). Missed time costs opportunity, never property.
10. **Mastery per item type, with real perks.** Ribbons from normal harvesting, with CE's perk
    ladder (+5% price / −10% time / +15% chance of an extra unit) and a visible sign on the farm.
    This keeps old crops worth growing at high levels.
11. **Something new nearly every level, and a party at each level-up.** Coins + a resource gift +
    an *instant ripen* of the farm. Structural features arrive every 5–10 levels. Early levels take
    minutes.
12. **Orders give direction without nagging.** A few slots, generated from what the farm can
    actually make. Discardable with a short cooldown. A weekly goal with a meta-reward (FV2's Favors,
    CE's bonus meter). "We will not overwhelm you with tasks."
13. **Expansions you *earn by using* the last unlock.** Coins + a short proof task ("sell 8 eggs,
    harvest 16 wheat") + a named piece of land that reveals a specific new thing. That gives
    visible transformation, "something from nothing".
14. **Coins always have a use, and the sinks scale with income.** Animals, land, upgrades, and
    decorations that convert coins to XP (FV2: about 1 XP per 110 coins) and to beauty. A rich
    player always has a next purchase.
15. **Depth for the optimiser, transparency for the relaxer.** Every node has readable stats (cost,
    time, XP, value, feed, fertilizer) and there are several valid goals (XP, coins, prized
    quality). There is a small sprinkle of luck (10% prized, 1–2 eggs, bonus fruit) on top of
    deterministic results, "a little bit of slot machine" but never for core progress. Helping
    another farmer is real work that pays both sides.

---

## 20. The 10 things to fix or avoid for a private 2-player game

1. **No hard action meters.** No water cap that stops planting, no kitchen Power, no Fuel, no
   farmhand energy. Real-time growth is the only pacing (same as the sibling file's
   recommendation). Keep water as an *optional yield multiplier* (FV3: watered plot = 2×) with a
   well that refills quickly, so tending is rewarded but never required.
2. **No friend-gating.** Baby bottles, building materials, "4 neighbours to build" and salt or sugar
   from friends become things the farm makes itself (a dairy for bottles, a workshop for planks).
   The partner can *speed* them up, but every gate is solo-completable when the partner is offline.
3. **No premium currency and no key-locked slots.** Every unlock comes from play. If there is a rare
   token (like Favor), it comes at predictable rates from orders and goals, never from random drops.
4. **No random drop gates on progression.** CE's barn nails and padlocks and foraging that "never
   received any dough" become deterministic recipes or a pity counter. Luck only flavours bonuses,
   collections and cosmetics.
5. **Storage is a planning tool, not a wall.** Start generous. Upgrade with ordinary coins and goods.
   Never destroy items silently. Warn before a harvest would overflow, and offer "sell surplus" or
   "send to partner". A full silo should never block a harvest the way it does in Hay Day.
6. **No withering and no guilt.** Ripe crops wait indefinitely (cosmetic over-ripeness at most). No
   punishing streaks. Animals never starve. FV1's withering was "a not-fun mechanic that compels
   people to play out of a sense of shame".
7. **One formula behind every number, plus automated balance tests.** FV2's table has dominant
   outliers: Blackberry pays 17 XP every 2 min, Cabbage (level 38) earns 3.6× the per-water profit
   of Lavender (level 40), and the level curve had a wall at 57–60. Generate values from a single model (§21) and
   assert monotonic trade-offs and "no dominant strategy" in `node:test`.
8. **Orders must be fillable.** Generate orders from the farm's current producers within a time
   budget (Hay Day only requests what you can make at your level). Scale quantities to *capacity*,
   not level ("6 peach yoghurts with 4 peach trees"). No 8-hour single crafts. Discarding costs
   minutes, not hours.
9. **No task overload and no notification spam.** At most about 3 active quests. Quiet,
   board-native signals instead of pop-ups. No timeline-style noise. The game should be just as
   good for a 10-minute check-in as for a 2-hour evening together.
10. **Design for two people on one board.** FV2's neighbour rule was that a helper's actions never
    spend the owner's consumables. Here the equivalent:
    - Neither player can drain a shared resource the other was counting on: reservations, and a
      ledger.
    - Both are credited for shared actions.
    - Simultaneous clicks on the same plot resolve on the authoritative server: one harvest, both
      see it, no double yield, no lost item.
    - No competitive "top farmer" scoreboard between partners.

    Ownership and catch-up are specified in `progression-goals-coop.md` §6–7.

---

## 21. Suggested starting economy model for Harvest Hollow (derived, not sourced)

These are my proposals, built from the patterns above, for the designer to tune with a simulation.

**Crop value from one formula.** For a crop with grow time `h` hours, unlock tier `t` (0, 1, 2…) and
base unit `B` (for example 10 coins):
- `seed = B · (1 + 0.6·t)`
- `profit_per_harvest = B · (1 + 0.6·t) · 1.4 · h^0.55`. This is the "per action" value, and it
  rises with time.
- So `profit_per_hour ∝ h^-0.45`. It falls with time: short crops reward an active session, long
  crops reward being away. For example, a 2-min crop earns about 19× more per hour than a 24 h crop,
  but only about 1/37 as much per planting.
- A useful check at tier 0: 20 plots of a 24 h crop left overnight earn about 161·B. One *active
  hour* of re-planting the same 20 plots with a 2-min crop (30 cycles) earns about 129·B. So one engaged hour
  is worth roughly one day of passive growth, and neither style dominates.
- `xp_per_harvest = round(1 + 2·h^0.6 + t)`. That gives 1 XP for a 2-min crop and 15 for a 24 h
  crop at tier 0, matching FV2's early crops, so XP also follows the per-action rule. No crop may
  exceed the curve, which removes Blackberry-style outliers.
- `feed_value ≈ 0.5 · sell / feed_price`, so milling is a fair alternative to selling, not a dominant
  one.
- Watering (optional) gives ×1.5–2 yield. Fertilizer gives +1 unit and a prized chance of 10% + 5% per
  mastery tier.

**Animals.**
- `cost ≈ 25–40 × (goods value per feeding)`, so an adult repays its price in about 25–40 feedings
  (FV2's White Chicken: 35 feedings).
- Prized after 30–100 feedings. Then: 1 premium good per 12–18 h, worth about 3× a normal good.
- Feed per meal ≈ 0.3–0.5 × goods value / feed price, so the animal is always the better use of
  feed than selling the crop.

**Recipes.** `sell = 2.2–3.0 × Σ ingredient sell values` (higher for more ingredient sources and
longer craft time). `xp ≈ 3–5 × Σ ingredient harvest XP`.

**Level curve.**
- Levels 1–5 within the first 30 minutes (XP 20 / 60 / 120 / 200 for levels 2–5).
- Then smooth geometric growth of about 10–12% per level up to level 30.
- Then linear increments, Hay Day-style: `+k` per level. No walls.
- Every level grants coins (about 30 min of mid-game income) and an *instant ripen* of watered
  crops.

**Expansions.** Coins ≈ 1.8× the previous patch's price, plus a proof task using the newest unlock,
plus no friend items. Each patch adds plot capacity *and* a named unlock.

**Sinks to keep coins meaningful.** Animals, expansions, upgrades, decorations (1 XP per 100 coins,
plus a beauty score), seeds. Run the numbers so a typical evening of play for two people
(about 1–2 h) buys one meaningful thing and leaves a visible saving goal.

---

## 22. Data caveats

- The FV2 wiki mixes eras. Values changed over 8 years: XP was lowered in late 2014, and mastery
  numbers were adjusted. The level table mixes per-level and pre-2014 values above level 56.
- Some guide numbers are clearly inconsistent: Corn mastery is given as 750 / 2,750 / 1,115, Lemon
  sells for 14 or 17 depending on the page, and Family Well is listed at 1,000 or 1,999 coins.
- The "¼ of grow time" withering phrase from a search snippet conflicts with the wiki's 3-day rule.
  The 3-day rule plus Zynga's "much more generous timers" statement is the more reliable pair.
- The Gamedeveloper interview and Engadget were read through a summariser. Quotes kept here
  are short and match multiple sources.
- The GDC quotes come from my local Whisper `base.en` transcript (it misspells "Zynga" and
  "FarmVille"; the meaning is unaffected).

---

## 23. Sources

**Primary (designers and publisher):**
- GDC 2013, "FarmVille 2 Postmortem: What Grew Wild & What Withered Away" (Wright Bagwell, Mike
  McCarthy): [GDC Vault](https://gdcvault.com/play/1018015/FarmVille-2-Postmortem-What-Grew),
  [archive.org audio](https://archive.org/details/GDC2013Bagwell); transcript in
  `sources/farmville2-gdc2013-postmortem-transcript.txt`.
- [Gamedeveloper — "Does Zynga really need a FarmVille 2? You bet"](https://www.gamedeveloper.com/design/does-zynga-really-need-a-i-farmville-2-i-you-bet)
- [Engadget launch coverage](https://www.engadget.com/2012-09-05-farmville-2-updates-zyngas-cow-clicker-but-not-too-much.html),
  [AllThingsD launch coverage](https://allthingsd.com/20120905/farmville-sequel-gets-a-facelift-with-3-d-graphics-and-all-new-game-play/)
- Zynga FV2 Help Center:
  [plant](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/122-how-do-i-plant-crops/),
  [harvest](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/116-how-do-i-harvest-crops/),
  [water](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/117-how-do-i-water-crops/),
  [plots](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/129-how-do-i-add-plots-1688026613/),
  [animals care](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/132-how-do-i-take-care-of-my-animals-1688027470/),
  [raise animals](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/681-how-do-i-raise-my-animals/),
  [animal limit](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/202-how-do-i-increase-my-animal-limit-1688028076/),
  [fertilizer drops](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/564-why-do-i-not-always-get-fertilizers-from-feeding-animals/),
  [inventory](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/409-how-does-the-inventory-work-1688028527/),
  [item caps](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/405-how-many-items-can-i-store-in-my-inventory-1688028775/),
  [market stand](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/133-how-do-i-use-the-market-stand/),
  [level up](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/134-how-do-i-level-up-1688028360/),
  [water rewards](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/847-why-am-i-not-getting-my-water-rewards-1688110556/),
  [Farm Bucks at level-up](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/565-do-i-get-farm-bucks-when-i-level-up-in-farmville-2/),
  [kitchen](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/415-how-do-i-use-the-crafting-kitchen/),
  [kiln](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/1616-how-do-i-use-the-crafting-kiln/),
  [Big Harvest](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/676-what-is-the-big-harvest/),
  [order board](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/677-how-do-i-use-the-order-board/),
  [co-op](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/612-how-do-i-use-the-co-op-feature/),
  [co-op goal](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/3044-what-is-the-new-co-op-goal/),
  [expansion requirements](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/483-what-are-the-expansion-requirements-1688024717/)
- Zynga FV3 Help Center:
  [water well](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/14488-how-does-the-water-well-work/),
  [animal stages](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/20096-what-are-animal-stages/),
  [elder points](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/18986-what-are-elder-animal-points/),
  [boat](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/16455-how-do-i-send-boat-shipments/),
  [visitors](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/17093-what-are-market-stand-visitors-1604570621/),
  [help friends' orders](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/18315-how-can-i-help-my-friends-with-orders-on-their-orderboard/),
  [daily login](https://zyngasupport.helpshift.com/hc/en/91-farmville-3/faq/18683-what-is-the-daily-login-rewards/)

**Wikis (read through the MediaWiki API):**
- FV2: [Seeds](https://farmville2.fandom.com/wiki/Seeds), [Water](https://farmville2.fandom.com/wiki/Water),
  [Well](https://farmville2.fandom.com/wiki/Well), [Fertilizer](https://farmville2.fandom.com/wiki/Fertilizer),
  [Fertilizer Bin](https://farmville2.fandom.com/wiki/Fertilizer_Bin), [Prized Crop](https://farmville2.fandom.com/wiki/Prized_Crop),
  [Unwither](https://farmville2.fandom.com/wiki/Unwither), [Speed-Grow](https://farmville2.fandom.com/wiki/Speed-Grow),
  [Plot](https://farmville2.fandom.com/wiki/Plot), [Field](https://farmville2.fandom.com/wiki/Field),
  [Grove](https://farmville2.fandom.com/wiki/Grove), [Trees](https://farmville2.fandom.com/wiki/Trees),
  [Animals](https://farmville2.fandom.com/wiki/Animals), [Chicken](https://farmville2.fandom.com/wiki/Chicken),
  [Cow](https://farmville2.fandom.com/wiki/Cow), [White Chicken](https://farmville2.fandom.com/wiki/White_Chicken),
  [Baby Bottle](https://farmville2.fandom.com/wiki/Baby_Bottle), [Super Feed](https://farmville2.fandom.com/wiki/Super_Feed),
  [Feed](https://farmville2.fandom.com/wiki/Feed), [Feed Mill](https://farmville2.fandom.com/wiki/Feed_Mill),
  [Silo](https://farmville2.fandom.com/wiki/Silo), [Trough](https://farmville2.fandom.com/wiki/Trough),
  [Hen House](https://farmville2.fandom.com/wiki/Hen_House), [Spinning Wheel](https://farmville2.fandom.com/wiki/Spinning_Wheel),
  [Mud Wallow](https://farmville2.fandom.com/wiki/Mud_Wallow), [Kitchen](https://farmville2.fandom.com/wiki/Kitchen),
  [Power](https://farmville2.fandom.com/wiki/Power), [Fuel](https://farmville2.fandom.com/wiki/Fuel),
  [Windmill](https://farmville2.fandom.com/wiki/Windmill), [Water Tower](https://farmville2.fandom.com/wiki/Water_Tower),
  [Barn](https://farmville2.fandom.com/wiki/Barn), [Market Stand](https://farmville2.fandom.com/wiki/Market_Stand),
  [Favor](https://farmville2.fandom.com/wiki/Favor), [Coins](https://farmville2.fandom.com/wiki/Coins),
  [Farm Bucks](https://farmville2.fandom.com/wiki/Farm_Bucks), [Experience](https://farmville2.fandom.com/wiki/Experience),
  [XP Gained](https://farmville2.fandom.com/wiki/XP_Gained), [Levels](https://farmville2.fandom.com/wiki/Levels),
  [Levels/1-50](https://farmville2.fandom.com/wiki/Levels/1-50), [Levels/51-100](https://farmville2.fandom.com/wiki/Levels/51-100),
  [Levels/History](https://farmville2.fandom.com/wiki/Levels/History), [Expansion](https://farmville2.fandom.com/wiki/Expansion),
  [Neighbor](https://farmville2.fandom.com/wiki/Neighbor), [Quest](https://farmville2.fandom.com/wiki/Quest),
  [Gourmet Farm](https://farmville2.fandom.com/wiki/Gourmet_Farm), and the recipe and tree pages linked inline.
- FV2: Country Escape: [Crop](https://farmvillecountryescape.fandom.com/wiki/Crop),
  [Water](https://farmvillecountryescape.fandom.com/wiki/Water), [Keys](https://farmvillecountryescape.fandom.com/wiki/Keys),
  [Coins](https://farmvillecountryescape.fandom.com/wiki/Coins), [Barn](https://farmvillecountryescape.fandom.com/wiki/Barn),
  [Silo](https://farmvillecountryescape.fandom.com/wiki/Silo), [Storage](https://farmvillecountryescape.fandom.com/wiki/Storage),
  [Workshop](https://farmvillecountryescape.fandom.com/wiki/Workshop), [Animals](https://farmvillecountryescape.fandom.com/wiki/Animals),
  [Mastery](https://farmvillecountryescape.fandom.com/wiki/Mastery), [Farm Order Board](https://farmvillecountryescape.fandom.com/wiki/Farm_Order_Board),
  [Market](https://farmvillecountryescape.fandom.com/wiki/Market), [Sales Bonus Meter](https://farmvillecountryescape.fandom.com/wiki/Sales_Bonus_Meter),
  [Co-Op](https://farmvillecountryescape.fandom.com/wiki/Co-Op), [Achievement](https://farmvillecountryescape.fandom.com/wiki/Achievement),
  [Stamp](https://farmvillecountryescape.fandom.com/wiki/Stamp), [Levels (1-10)](https://farmvillecountryescape.fandom.com/wiki/Levels_(1-10)).
- FV1: [Wither](https://farmville.fandom.com/wiki/Wither), [Plow](https://farmville.fandom.com/wiki/Plow),
  [Crop Mastery](https://farmville.fandom.com/wiki/Crop_Mastery), [Unwither Ring](https://farmville.fandom.com/wiki/Unwither_Ring).
- Hay Day: [Crops](https://hayday.fandom.com/wiki/Crops), [Wheat](https://hayday.fandom.com/wiki/Wheat),
  [Silo](https://hayday.fandom.com/wiki/Silo), [Barn](https://hayday.fandom.com/wiki/Barn),
  [Truck](https://hayday.fandom.com/wiki/Truck), [Boat](https://hayday.fandom.com/wiki/Boat),
  [Roadside Shop](https://hayday.fandom.com/wiki/Roadside_Shop), [Experience](https://hayday.fandom.com/wiki/Experience).
- FV3: [Crops](https://fv3.fandom.com/wiki/Crops).

**Reviews, analyses and player voices:**
- [Gamezebo FV2 review](https://www.gamezebo.com/reviews/farmville-2-review/)
- [Dragonchasers, "A quick visit to Farmville 2"](https://dragonchasers.com/2012/09/07/4697/)
- [PocketGamer, Country Escape review](https://pocketgamer.com/articles/059185/farmville-2-country-escape)
- [millietilly, "Country Escape or how to get really angry"](https://millietilly.wordpress.com/2016/02/26/farmville-2-country-escape-or-how-to-get-really-angry/)
- [The Why of Play, FarmVille 3 analysis](https://thewhyofplay.com/2021/11/22/farmville-3-evolution-or-revolution/)
- [Soren Johnson, "Fear and Loathing in FarmVille"](http://www.designer-notes.com/fear-and-loathing-in-farmville/)
- [Tobold on CastleVille](http://tobolds.blogspot.com/2011/11/castleville.html)
- [chasingdings, "How CastleVille lost me"](https://chasingdings.com/2011/11/22/how-castleville-lost-me/)
- [Gamelytic currencies](https://gamelytic.com/farmville-2-basic-money-and-currency-points-overview/)
- [Gamelytic crop mastery](https://gamelytic.com/farmville-2-crop-mastery-guide/)
- [farmgamehub Hay Day crops guide](https://www.farmgamehub.com/en/guides/hay-day/crops)
- [TheGamer on FV1 shutdown](https://www.thegamer.com/farmville-shutting-down/)
