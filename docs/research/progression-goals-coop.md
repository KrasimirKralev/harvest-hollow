# Harvest Hollow — Progression, Goals, Achievements and Co-op Research

Research for the designer of "Harvest Hollow", a FarmVille-2-inspired co-op farm for two players
(a couple) sharing ONE farm on a LAN. This file covers progression, goal systems, achievements and
co-op/social design. Economy numbers, asset sourcing and tech architecture live in the sibling
files (`assets-catalog.md`, `tech-architecture.md`, and whatever economy file exists). Where a
number below touches the economy it is a *pacing target*, not a price list — calibrate it with the
economy simulation.

Written 2026-10-02. Sources are cited inline; a full list is at the end. A few fandom wiki pages
returned HTTP 402 to the fetcher, so those facts come from search-result extracts of the same
pages. They are marked "(snippet)".

---

## 0. The ten findings that matter most

1. **Every action has to move several bars at once.** Hay Day gives XP for almost everything
   (selling, harvesting, crafting, boats, orders) ([Hay Day wiki — Experience](https://hayday.fandom.com/wiki/Experience) (snippet)).
   FarmVille 2 layers crop mastery, prized crops, County Fair points and quests on top of the same
   harvest click ([FV2 help — County Fair medals](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/669-what-are-the-different-county-fair-medals-1688113478/?p=all)).
   So one harvest should feed XP, coins, mastery, daily tasks, quests, achievements, collection
   drops and fair points.
2. **Nest goals at five horizons and never leave a slot empty.** The game should always show three
   goals: a "Now" goal (under a minute), a "Soon" goal (10–30 minutes) and a pinned "Big" goal
   (days or weeks). Section 3 gives the algorithm and its fallback chain.
3. **Shared progress must never be gated behind one player.** Animal Crossing: New Horizons was
   review-bombed because only the "resident representative" could advance the island; the other
   player is told to "ask their resident rep" ([Pixelkin](https://pixelkin.org/2020/04/20/opinion-animal-crossing-new-horizons-local-co-op-is-frustratingly-limited/),
   [Screen Rant](https://screenrant.com/animal-crossing-new-horizons-review-bombed-frustrating-multiplayer/)).
   In Harvest Hollow both players are equal co-owners, and the server, not either player, is the host.
4. **The farm must be playable when the partner is offline.** The top couple complaint about
   Stardew Valley and Farm Together is "my partner can't play our farm unless I'm online"
   ([Steam thread](https://steamcommunity.com/app/413150/discussions/0/1694920442945588786),
   [Farm Together discussion](https://steamcommunity.com/app/673950/discussions/0/3276824488725706263/)).
   Solo play is never blocked. Co-op adds bonuses, never gates.
5. **Use a shared treasury, but make it safe.** Stardew's shared money produces "it's hard to
   upgrade something when you're taking other people's cash"
   ([Steam thread](https://steamcommunity.com/app/413150/discussions/0/1735462352482826854)).
   The recommendation is one Farm Treasury plus Savings Jars, item reservations, a 10-minute undo
   window and a transparent ledger (section 6).
6. **Keep two XP tracks.** A shared Farm Level gates content. A personal Farmer Level gives
   identity, specialisation perks and catch-up. This copies Stardew's split: per-player skills,
   global bundles and museum ([Stardew wiki — Multiplayer](https://stardewvalleywiki.com/Multiplayer)).
   Add WoW-style rested XP so the partner who plays less keeps pace
   ([Icy Veins — Rested XP](https://www.icy-veins.com/wow/rested-xp-a-detailed-overview)).
7. **Two players should help each other the way FarmVille neighbours did.** Inside one couple,
   reproduce the old neighbour loop: feed/water/harvest help, revive wilted trees, fill help
   requests, gift, and big shared weekly orders. Hay Day's wilted-tree revive needs another player
   ([Hay Day wiki — Trees and Bushes](https://hayday.fandom.com/wiki/Trees_and_Bushes) (snippet)).
   FV2 co-op orders count twice toward the group goal
   ([FV2:CE help](https://zyngasupport.helpshift.com/hc/en/11-farmville-2-country-escape/faq/10441-introducing-the-co-op-help-and-order-goals/)).
   Every such mechanic also has a solo path that costs more time or coins.
8. **Prefer closely coupled co-op moments, but only in small doses.** Research on remote co-op
   found closely coupled patterns more enjoyable than loosely coupled ones, though they need more
   communication ([Beznosyk et al. 2012](https://www.semanticscholar.org/paper/The-influence-of-cooperative-game-design-patterns-Beznosyk-Quax/ae975535b05e857ab0f645765ee9516e0ca1c98b)).
   The base loop should be parallel play (loose). Sprinkle in moments that need tight coupling:
   duet recipes, giant crops, the sunset bench, high-fives.
9. **Long goals should be restoration projects, collections, mastery, a beauty rating and
   ribbons.** Stardew's Community Center bundles are the model long goal: themed item sets that
   unlock permanent upgrades such as the greenhouse and minecarts
   ([BisectHosting guide](https://www.bisecthosting.com/blog/stardew-valley-community-center-guide-bundles-unlock)).
   Animal Crossing's 1–5 star island rating makes decorating a real progression axis
   ([Island evaluation](https://animalcrossing.fandom.com/wiki/Island_evaluation) (snippet)).
10. **No loss mechanics, no punishing streaks, no FOMO.** Duolingo's forgiving "weekend amulet"
    made users 4% more likely to return a week later
    ([UX Magazine](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame)).
    The farm streak counts if either partner plays, and comes with freezes. Crops and animals never
    die. Event items return the next year.

---

## 1. Research digest — what each reference game does

### 1.1 FarmVille 2 (Facebook, 2012) — the primary reference

**Premise and loop.** You inherit an overgrown, abandoned farm and restore it
([Adweek](https://adweek.com/digital/farmville-2-review)). The core loop is crops → feed mill →
animals → products and fertilizer → kitchen crafting → sell or fill orders
([Gamezebo review](https://www.gamezebo.com/reviews/farmville-2-review/);
[farmingnotes](https://farmingnotes.wordpress.com/2012/09/07/farmville-2-while-it-has-cool-3d-technology-it-is-best-suited-for-new-farmville-players-part-1/)).
Animal "poop" becomes fertilizer, and fertilizer on crops can produce prized crops. That makes the
loop circular, which is the elegant part.

**Resources** ([Gamelytic currency overview](https://gamelytic.com/farmville-2-basic-money-and-currency-points-overview/)):

| Resource | How it is earned | How it is spent |
|---|---|---|
| Coins | Market stand sales | Seeds, animals, buildings, expansion |
| Farm Bucks | Premium currency | Not for us |
| Water | Well regen, friend requests, gifts (starting cap 20) | One per crop, more per tree, to start growth |
| Fertilizer | Animal drops | +1 yield, and a chance of a Prized Crop |
| Feed | Feed mill grinds crops | Feeding animals |
| Craft Power | Starts at 30 | Each recipe costs 1+ |

Water is an action limiter: crops and trees don't start growing until watered. Reviewers called it
the most frustrating part ([Gamezebo review](https://www.gamezebo.com/reviews/farmville-2-review/)).
**Lesson: do not copy a water or energy cap.** Let real-time growth be the only gate.

**Animals.** Every animal is bought as a baby and needs 2–17 milk bottles, often requested from
neighbours, before it becomes an adult
([FV2 help — raise animals](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/681-how-do-i-raise-my-animals/?p=all)).
Adults are fed on an interval. For example, a horse eats 8 feed every 6 hours. After a set number
of feedings (45 for the horse) the animal becomes a blue-ribbon **Prized Animal**: it produces a
rare good, its cycle lengthens, and the player gets a Super Feed reward
([FV2 wiki — Blue Roan Horse](https://farmville2.fandom.com/wiki/Blue_Roan_Horse) (snippet)).
**Lesson: animals have a life-arc goal (baby → adult → prized), and that is a ready-made per-animal
mastery track.**

**Crop Mastery** unlocks at level 7. Every crop has three ribbon tiers (yellow → red → blue), each
needing more harvests, for example Tomato 10/90/100 and Pumpkin 50/181/546. Higher mastery raises
coins, XP and the prized-crop chance
([Gamelytic mastery guide](https://gamelytic.com/farmville-2-crop-mastery-guide/)). In FarmVille 1
a fully mastered crop gave a mastery sign and bonus bushels
([FarmVille wiki — Crop Mastery](https://farmville.fandom.com/wiki/Crop_Mastery) (snippet)).

**Prized crops and the County Fair.** Fertilized crops and heirloom trees can yield Prize Goods.
Each prize good scores fair points, which unlock Bronze, Silver, Gold and Platinum medals with
sub-levels. The medal level also gives visitors better rewards
([FV2 help — medals](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/669-what-are-the-different-county-fair-medals-1688113478/?p=all)).
The fair ran weekly from level 20 against friends' farms
([Gamezebo news](https://www.gamezebo.com/news/farmville-2-introduces-weekly-county-fair-event/)).
A State Fair tier sat above it, with a "Double Time" reward of up to 48 h
([FV2 Junkie](http://fv2-junkie.blogspot.com/2015/09/county-fair-and-state-fair-how-to.html)).
**Lesson: a weekly fair that scores quality, not just volume, gives the week a shape.**

**Neighbours and farmhands.** Neighbours visiting your farm can feed animals and water, fertilize or
harvest crops without using your consumables
([FV2 wiki — Neighbors](https://farmville2.fandom.com/wiki/Neighbors) (snippet)).
A friend you hire as a farmhand does one of four jobs: harvest 4 crops, instant-grow 4 watered
crops, revive 4 withered crops, or add 5 kitchen power. You have 8 hours to assign the job
([Gamelytic farmhands](https://gamelytic.com/farm-hands-guide-for-farmville-2/)).
Expansions such as water troughs needed parts that only friends could send
([Gamezebo review](https://www.gamezebo.com/reviews/farmville-2-review/)).
**Lesson: "help on someone else's farm" was FV2's social heart.** With two players on one farm we
re-create it as partner help, and must never require outside neighbours.

**Quests.** Characters hand out multi-task quests from a quest book, rewarding XP, coins, keys or
unlocks. Cornelius the grocer gave daily challenges
([farmingnotes](https://farmingnotes.wordpress.com/2012/09/07/farmville-2-while-it-has-cool-3d-technology-it-is-best-suited-for-new-farmville-players-part-1/)).
There were main storyline quests, side quests, seasonal quests and multi-part series
([FV2 wiki — Quests](https://farmville2.fandom.com/wiki/Quests) (snippet)).

**Co-op (FV2 Facebook, later version).** Co-ops worked through a weekly Order Board. When the co-op
won the week, every member got 200 Favors and "all of your watered plants and trees instantly
grow". The top contributor got a Hall of Fame entry. The first member to donate to a "call for
help" got a free call
([FV2 help — Co-op feature](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/612-how-do-i-use-the-co-op-feature/)).

**FV2: Country Escape (mobile).** Marie's Order Board unlocks at level 25. Co-op orders count twice
toward the weekly co-op goal. Each member's contribution is capped at 60 points so no single member
dominates. The co-op reward escalates over a 5-week cycle, from 100 Timber up to 600 Timber plus an
upgraded farmhand
([FV2:CE help — Co-op Help and Order Goals](https://zyngasupport.helpshift.com/hc/en/11-farmville-2-country-escape/faq/10441-introducing-the-co-op-help-and-order-goals/);
[Marie's Order Board](https://farmvillecountryescape.fandom.com/wiki/Marie's_Order_Board) (snippet)).
The game has four event formats:
- Solo Collection, 5–7 days.
- Co-op Challenge, 7 days. The top tier needs at least 3 active members.
- Order Board Blitz.
- Seasonal Crafting, up to 14 days, with limited ingredients and multiple prize tiers.

([FarmVille Freak events guide](https://farmvillefreak.com/farmville-2-country-escape-events-guide/)).
The Halloween event, for example, ended with a farmhand who helps for 30 days
([Zynga blog](https://www.zynga.com/blog/zynga-scares-up-a-slate-of-halloween-treats/)).
Critics: "things take off very slowly … lack of storage space" pushes players toward purchases
([Common Sense Media](https://www.commonsensemedia.org/app-reviews/farmville-2-country-escape)).
**Lessons:** escalating weekly co-op rewards work. Per-person contribution caps stop one player
carrying the group. Storage friction is a monetisation trick to avoid.

**Ribbons (FarmVille achievements).** Each ribbon has tiered colours. Typical rewards were
Yellow 50 XP and 1,000 coins, up to Blue 1,000 XP and 10,000 coins. Examples:
- "Cream of the Crop": harvest crops, 10 / 1,000 / 5,000 / 25,000.
- "Knock on Wood": harvest trees, 20 / 250 / 1,500 / 5,000.
- "Zoologist": collect from animals, 15 / 500 / 1,000 / 5,000.
- "Good Samaritan": help friends, 20 / 150 / 500 / 2,500.
- "A Pretty Penny": spend coins.

([FarmVille wiki — Ribbons](https://farmville.fandom.com/wiki/Ribbons) (snippet)).
**Lesson: four tiers is one too many to read at a glance.** Use three (bronze/silver/gold) and keep
a fourth "Platinum" only for the fair.

### 1.2 Hay Day (Supercell)

- **XP on everything** drives frequent level-ups, and each level unlocks crops, animals or machines.
  The trap is that "a player who has relentlessly pursued XP at the expense of coin generation will
  find themselves unable to purchase newly unlocked buildings"
  ([Medium analysis](https://medium.com/@hoangvm11.mac/leveling-up-your-game-unlocking-monetization-through-analyzing-hay-day-gameplay-systems-with-4165f47da0dc) (snippet)).
  **Lesson:** a new unlock should be affordable at the moment it unlocks, which means a level-up
  reward chest with coins. The XP curve and the coin curve must be co-designed.
- After level 126 nothing new unlocks except fields
  ([Hay Day wiki — Experience](https://hayday.fandom.com/wiki/Experience) (snippet)).
  **Lesson:** no empty levels. Post-cap "Legacy" levels must still give something.
- **Truck order board.** Several orders at once. A deleted order is replaced after 30 minutes, which
  prevents order fishing
  ([SuperCheats — Delivery Truck](https://www.supercheats.com/hay-day/walkthrough/delivery-truck)).
- **Boat.** 3–5 item types split into crates. A player can ask for help on up to 3 crates (one
  public, two neighbourhood-only). Loading consecutive boats is itself an achievement ("Captain":
  2 / 6 / 12 in a row)
  ([Hay Day wiki — Boat](https://hayday.fandom.com/wiki/Boat) (snippet);
  [SuperCheats achievements](https://www.supercheats.com/hay-day/walkthrough/list-of-achievements) (snippet)).
- **Trees and bushes** give three harvests, then wilt. Another player must revive them, and the
  reviver gets XP. One final harvest follows, then the plant dies
  ([Hay Day wiki — Trees and Bushes](https://hayday.fandom.com/wiki/Trees_and_Bushes) (snippet)).
  **Lesson:** "only someone else can do this" is a strong social hook. For us it should be a bonus,
  with a solo fallback, and nothing should die permanently.
- **Weekly Neighbourhood Derby.** A board of 12 tasks worth 50–320 points each. Timed tasks pay
  more. There are five leagues, and milestone rewards are paid in horseshoes
  ([u7buy derby guide](https://www.u7buy.com/blog/hay-day-understanding-the-derby/);
  [Sportskeeda](https://www.sportskeeda.com/esports/5-tips-completing-hayday-s-derby-event)).
- **Achievements.** 103 of them, mostly in three tiers, paying XP and diamonds
  ([SuperCheats list](https://www.supercheats.com/hay-day/walkthrough/list-of-achievements) (snippet)).
- **Expansion** needs land deeds, mallets and marker stakes, all random drops
  ([Hay Day wiki — Expansion/Farm](https://hayday.fandom.com/wiki/Expansion/Farm) (snippet)).
  Players widely complain about the wait for random materials.
  **Lesson:** expansion inputs are deterministic, or random with a pity counter.
- **The Valley** (level 25) is a shared seasonal space, about 3 weeks per season, played with
  neighbours to earn tokens
  ([Hay Day wiki — Valley](https://hayday.fandom.com/wiki/Valley) (snippet)).

### 1.3 Township (Playrix)

Township is a farm plus a town. Its co-op (level 19) runs **Regattas**: team boat races scored from
task points. **Daily** tasks refresh every day and **Ongoing** tasks span the whole race
([Google Play editorial — Regattas](https://play.google.com/store/apps/editorial?id=mc_games_editorialevergreen_post_install_township_regattas_now_fcp&hl=en);
[Township wiki — Regatta](https://township.fandom.com/wiki/Regatta) (snippet)).
**Lesson:** a weekly board mixing daily and week-long tasks gives both a 1-day and a 1-week horizon
from one system.

### 1.4 Stardew Valley — co-op mode, studied closely

**What is shared** ([Stardew wiki — Multiplayer](https://stardewvalleywiki.com/Multiplayer)):
- Money, by default. A Town Ledger can split it into separate wallets at any time, and splitting
  divides current funds evenly.
- Farm land and buildings. Any player can buy and place buildings, but only the host can upgrade
  the farmhouse.
- Community Center bundles. The final unlock applies to all players, but only the player who
  completes a bundle can pick up its reward.
- Museum collection. Global, but each player receives their own rewards.
- Mine progress and the bridge repair. Global.
- Golden walnuts: one shared counter
  ([Golden Walnut](https://stardewvalleywiki.com/Golden_Walnut)).
- The perfection score. One shared score that takes the highest value any player has in each
  category ([Perfection](https://stardewvalleywiki.com/Perfection)).

**What is per-player:**
- Skills and XP ("whoever commits the action will be the one to gain the experience").
- Tool upgrades.
- NPC relationships and marriage (players can also marry each other).
- Recipes, quests, stardrops and mailboxes.
- Daily luck. It differs per player but is averaged in calculations.

**Quest cadence** ([Stardew wiki — Quests](https://stardewvalleywiki.com/Quests)):
- **Help Wanted** posts a daily quest with a 2-day window and no penalty for ignoring it. Delivery
  quests pay 3× the item's sell price. Every 3 completed quests earn a prize ticket.
- **Special Orders** post every Monday and last 7–28 days. Resources must be gathered after
  accepting.
- Achievements mark 10 and 40 quests completed.

**What players love.** Bundles give a long, readable goal with powerful, permanent rewards: the
greenhouse, minecarts. Some bundles let you choose 3 of 4 items, so you are never stuck on one rare
item ([BisectHosting](https://www.bisecthosting.com/blog/stardew-valley-community-center-guide-bundles-unlock)).

**What frustrates co-op players:**
1. **Shared money arguments.** "It's hard to upgrade something when you're taking other people's
   cash"; "if your friend is spending all your money, get better friends"
   ([Steam thread](https://steamcommunity.com/app/413150/discussions/0/1735462352482826854)).
   Separate wallets are the escape hatch, and many players use mods for it.
2. **The host must be online.** A girlfriend wanted to smelt ore for tool upgrades while her
   boyfriend (the host) was offline, and couldn't
   ([Steam thread](https://steamcommunity.com/app/413150/discussions/0/1694920442945588786)).
3. **Cutscenes don't pause the shared clock**, so players get forced to pass out
   ([Stardew forums](https://forums.stardewvalley.net/threads/stop-time-during-cutscenes-in-co-op.1429/)).
4. **Host privilege.** Ownership can't be transferred, and only the host upgrades the farmhouse
   ([Steam](https://steamcommunity.com/app/413150/discussions/0/2653115517062592636)).
5. **No item locks.** Because "you cannot lock your items away", the advice is to play only with
   people you trust ([Steam](https://steamcommunity.com/app/413150/discussions/0/2653115517062592636)).

**How couples split work.** The common pattern is natural specialisation: one farms and ranches,
the other mines, fishes or forages. A Four Corners layout with separate wallets even supports a
friendly competitive split
([Games Learning Society](https://www.gameslearningsociety.org/wiki/how-to-do-split-money-on-stardew-valley/)).
**Lesson: specialisation should emerge from incentives, not be forced.**

### 1.5 Animal Crossing: New Horizons

- **Nook Miles achievements** have 5 tiers. Fishing, for example, needs 10 / 100 / 500 / 2,000 /
  5,000 fish for 300 / 500 / 1,000 / 2,000 / 3,000 miles, and each tier grants a title fragment
  ([Nookipedia — Nook Miles](https://nookipedia.com/wiki/Nook_Miles);
  [iMore](https://www.imore.com/animal-crossing-new-horizons-nook-miles-guide)).
- **Nook Miles+** shows short daily tasks that refresh as soon as one is completed. The first five
  each day pay 2× (occasionally 5×), at 100–250 miles each
  ([Game8](https://game8.co/games/Animal-Crossing-New-Horizons/archives/285213)).
  **Lesson: a near-infinite list of micro-tasks with a "first N per day" bonus** guarantees a
  1-minute goal and caps grinding.
- **Island evaluation** is 1–5 stars, scored on development and scenery (5 stars needs 665 and 450
  points, with an 8×8 grid scoring scenery). Reaching 5 stars gives a reward and a weekly flower
  ([Island evaluation](https://animalcrossing.fandom.com/wiki/Island_evaluation) (snippet)).
  **Lesson: a beauty rating makes the decorator partner's play count as progression.**
- **Co-op failure.** Only the Leader can talk, craft and use the full inventory. The camera is tied
  to the Leader, and followers are teleported. Only the resident rep advances the story
  ([Pixelkin](https://pixelkin.org/2020/04/20/opinion-animal-crossing-new-horizons-local-co-op-is-frustratingly-limited/);
  [Washington Post](https://www.washingtonpost.com/video-games/reviews/local-co-op-animal-crossing-new-horizons-is-huge-disappointment/)).
  **This is the anti-pattern to avoid most of all.**

### 1.6 Farm Together / Farm Together 2

- **Permissions.** A co-owner can be given full rights so "it's as much their farm as mine". Money
  goes "to the farm, not the owner, nor the harvester". Guests earn character XP and build a
  bonus meter they take home
  ([Steam discussion](https://steamcommunity.com/app/673950/discussions/0/3276824488725706263/);
  [Farm Together wiki](https://farmtogether.fandom.com/wiki/Multiplayer) (snippet)).
- **Complaint.** Achievements focused on your own farm, which "breaks groups up". There was also a
  fear that "only one of us would really get the full experience, while the other is just filling
  a supporting role"
  ([Steam discussion](https://steamcommunity.com/app/673950/discussions/0/3211505894141845388/)).
  **Lesson: achievements must be farm-shared, or they pull the couple apart.**

### 1.7 It Takes Two and research on cooperative play

- Josef Fares: "the story itself doesn't only happen on the screen, it happens on the couch." He
  aims for mechanics where both players feel they collaborate, with lots of variety
  ([AV Club](https://www.avclub.com/josef-fares-it-takes-two-interview);
  [The Ringer](https://www.theringer.com/2021/04/22/video-games/josef-fares-it-takes-two-interview-co-op-gaming)).
- Rocha, Mascarenhas & Prada (2008) list co-op mechanic types: complementary roles, synergies
  between abilities, abilities usable only on the other player, shared goals and synergies between
  goals ([Semantic Scholar](https://www.semanticscholar.org/paper/Game-Mechanics-for-Cooperative-Games-Rocha-Mascarenhas/5a2a3e2945fd9f9928b42386631f88ec615764db)).
- El-Nasr et al. (CHI 2010) list co-op patterns: interacting with the same object, shared puzzles,
  shared characters, special challenges for separated players, automatic vocalisation and limited
  shared resources ([ResearchGate](https://www.researchgate.net/publication/221516170_Understanding_and_evaluating_cooperative_games)).
- Beznosyk et al. (2012): closely coupled patterns are more enjoyable remotely but need more
  communication
  ([Semantic Scholar](https://www.semanticscholar.org/paper/The-influence-of-cooperative-game-design-patterns-Beznosyk-Quax/ae975535b05e857ab0f645765ee9516e0ca1c98b)).
  For us, quick pings and emotes are mandatory, because they may sit in different rooms.
- On games for mixed-skill couples: no fail state, forgiving mechanics, a role that lets the more
  experienced partner carry, no time pressure, short sessions
  ([XDA](https://www.xda-developers.com/co-op-games-to-play-with-non-gamer-partner/);
  [Switchblade Gaming](https://www.switchbladegaming.com/co-op-games/best-couples-2026/)).

### 1.8 General design theory used below

- **Loops and arcs** (Daniel Cook). Loops are fractal, nested and repeating, and they build mastery.
  Arcs are one-time content such as story and cutscenes; arc-heavy games burn out into a "content
  treadmill" ([Lost Garden](https://lostgarden.com/2012/04/30/loops-and-arcs/)).
  **For us:** the farming loops carry the game. The story is a light arc that *teaches and unlocks
  loops*.
- **Goal-gradient and endowed progress.** Effort speeds up near the goal, and a head start
  increases persistence
  ([Yu-kai Chou](https://yukaichou.com/behavioral-analysis/goal-gradient-hypothesis-hull-kivetz-motivation-acceleration/);
  [Endowed progress](https://medium.com/@davidteodorescu/design-perfect-ux-tasks-the-endowed-progress-effect-7461ca20076c)).
  **For us:** surface near-complete goals first, and start new bars at a little above 0%.
- **Rested XP.** It accrues 5% of a level per 8 h, caps at 150% of a level, and doubles XP until
  used up ([Icy Veins](https://www.icy-veins.com/wow/rested-xp-a-detailed-overview)).
- **Forgiving streaks.** Duolingo's streak freezes and weekend amulet improved return rates
  ([UX Magazine](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame);
  [Yu-kai Chou streak design](https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/)).

---

## 2. Design principles distilled for Harvest Hollow

1. **One action feeds many bars.** A harvest pays XP (farm and personal), coins (when sold), mastery
   points, daily-task progress, quest progress, achievement counters, a collection-drop roll, and
   fair points if the crop is prized.
2. **Every unlock is usable on the turn it unlocks.** The level-up chest contains enough coins and
   the first seed pack or animal voucher for the new item. This avoids the Hay Day XP-vs-coins trap.
3. **No empty levels, no dead ends.** Every level grants something. Every goal the game shows is
   satisfiable from the current unlocks. Any random requirement has a pity counter.
4. **Growth time is the only gate.** No energy, no water cap, no paywall. FV2's water cap was its
   most criticised friction ([Gamezebo](https://www.gamezebo.com/reviews/farmville-2-review/)).
   Watering can stay as a *click* that starts growth, which is a good tactile verb, but never as a
   capped resource.
5. **No loss.** Crops never die. A ready crop can wait forever, at most showing a cosmetic "over-ripe"
   look. Animals never die. Trees wilt into a "needs tending" state that any helper or a cheap tonic
   fixes. FarmVille 1 withering was the most hated mechanic, and FV2 sold farmhands to undo it
   ([Gamelytic farmhands](https://gamelytic.com/farm-hands-guide-for-farmville-2/)).
6. **Co-op adds and never gates.** Every "better together" mechanic has a solo path costing more
   time or coins.
7. **Both players are equal owners.** No leader, no host privilege, no "ask your rep". The server
   (always-on Node process) is the host.
8. **Shared farm, personal identity.** Progress that changes the world is shared. Progress that
   expresses the self is personal: wardrobe, personal level, specialisation, personal titles.
9. **Transparency instead of locks.** A ledger, an activity feed and undo prevent "who spent the
   money?" fights better than permissions do. Light locks (savings jars, reservations) cover the
   two real pain points.
10. **No competition between partners by default.** They compete together against their own
    personal bests and against NPC farms. Friendly duels exist but are opt-in.
11. **Story waits for both.** Cutscene and chapter-reveal moments can be "watched together". The
    absent partner gets them on next login, and they can be replayed. This avoids Stardew's
    cutscene-clock problem and the ACNH rep problem.
12. **Respect short sessions.** A 5-minute visit must be worth it: harvest, replant, claim a daily
    task. A 2-hour session must never run out of things to do.

---

## 3. (a) Goal-system taxonomy — "there is ALWAYS a next goal"

### 3.1 The systems and their horizons

| # | System | Horizon | Shared or personal | Reference |
|---|---|---|---|---|
| G1 | **Micro-actions with juice**: plant, water, harvest, feed, collect, with pop, XP float and a sound | 1–10 s | actor | everything |
| G2 | **Growth timers**: crops 1 min–24 h, trees 2–24 h cycles, animals 10 min–8 h | 1 min–1 day | farm | FV2, Hay Day |
| G3 | **Ready-to-collect pings**, plus "next ready in 3:12" | 1 min | farm | Hay Day |
| G4 | **Land clearing**: weeds, rocks, stumps and junk on unexpanded land; each costs a little coin or tool time and drops XP and collectibles | 1–5 min | farm | FV2 "overgrown farm" premise |
| G5 | **Market Orders board**: 6–9 NPC orders, refill timer | 5–30 min | farm | Hay Day truck, FV2 Marie |
| G6 | **Story quests**: 1–3 active cards, 2–4 tasks each, with characters | 10 min–2 h per card | farm | FV2 quest book |
| G7 | **Farm Level** (shared XP), with a preview of the next 3 unlocks | 10 min early, ~1 day mid | farm | Hay Day, FV2 |
| G8 | **Personal Farmer Level** and specialisation perk points | ~30 min early, days later | personal | Stardew skills |
| G9 | **Mastery stars** per crop, tree, animal and recipe (3 stars, then gold) | 1 h–1 week per item | farm | FV2 crop mastery, prized animals |
| G10 | **Animal life arc**: baby → adult → prized (blue ribbon) | 1 day–2 weeks per animal | farm | FV2 animals |
| G11 | **Daily Almanac**: 4 personal micro-tasks plus 1 shared "together" task; first 5 completions per day pay double | 1–10 min each, 1 day overall | personal plus shared | Nook Miles+, Stardew Help Wanted |
| G12 | **Daily Gift calendar** (28-day loop, never resets) and **Farm Streak** with freezes | 1 day | farm | Duolingo, FV daily bonus |
| G13 | **Market Demand of the day**: one crop and one good sell for +50% | 1 day | farm | strategic variety |
| G14 | **County Fair** (weekly): prized goods → points → Bronze/Silver/Gold/Platinum medals; personal best and NPC league | 1 week | farm | FV2 County Fair, Hay Day Derby |
| G15 | **River Barge special orders** (weekly): 9 crates in 3 rows with help flags | 1 week | farm | Hay Day boat, Stardew Special Orders, FV2:CE co-op goals |
| G16 | **Seasonal Ribbon Track**: free 30-tier track per real season, fed by all activity | 1 month (~90 days) | farm | Hay Day Farm Pass (free version) |
| G17 | **Festivals** (real-calendar events, 7–14 days) with event crops and recipes, a prize ladder, and return yearly | 1–2 weeks | farm | FV2 seasonal crafting events |
| G18 | **Collections**: ~20 sets of 5 items, found from actions, with pity counters; complete a set for a reward and a display item | days–weeks | farm (finder credited) | FarmVille collections |
| G19 | **Restoration Ledger**: 6 restoration projects, each 4–6 bundles; each project unlocks a permanent feature | weeks–months | farm | Stardew Community Center |
| G20 | **Farm Beauty rating** (1–5 stars, plus "Showcase" levels beyond) | weeks | farm | ACNH island rating |
| G21 | **Achievements (Ribbons)**, bronze/silver/gold, and a Ribbon Wall | day → months | farm, personal or together | FV ribbons, Hay Day, Nook Miles |
| G22 | **Memory Book**: auto-captured couple milestones | ongoing | both | couple-specific |
| G23 | **Legacy Levels** after the level cap: every level gives a Legacy reward | endless | farm | anti-"Hay Day 126" |

### 3.2 Coverage matrix — what supplies a goal at each horizon

| Horizon | At least one ALWAYS available | Typical reward | UI surface |
|---|---|---|---|
| **1 minute** | G3 something ready; G1 plant an idle plot; G4 clear a debris tile; G11 an Almanac micro-task (they refresh on completion); G5 an order you can fill now; gift your partner | XP, coins, mastery tick, a collection roll | "Now" slot in the Goal Tracker; tile highlights |
| **10 minutes** | G2 a fast crop cycle; G6 the current quest task; G5 the best order; G7 progress to the next level (early game); a craft batch | quest reward, order coins, level-up | "Soon" slot |
| **1 hour** | G6 finish a quest card; G7 the next Farm Level (early to mid game); G9 a mastery star on a fast crop; G8 a personal level; a Fair medal sub-level | unlock, new item, star, perk point | Level bar with "next unlock" preview; mastery badge |
| **1 day** | G11 all daily tasks done (daily chest); G12 the daily gift and streak; G2 overnight crops and trees; G10 an animal feeding cycle; G13 the demand bonus; G7 a level (mid game) | daily chest, streak reward, prized goods | Daily panel, morning recap |
| **1 week** | G14 a Fair medal tier; G15 the barge complete; G9 a mastery on slow crops; G10 an animal becomes prized; G18 a collection set; G19 a bundle | trophy decor, big coin chest, perk, feature unlock | Weekly panel; Sunday "results" ceremony |
| **1 month and longer** | G16 the seasonal track; G17 a festival; G19 a Restoration project; G20 a beauty star; G21 gold ribbons; G23 Legacy | permanent feature, rare decor, title | Farm Journal: Projects, Ribbons, Album |

### 3.3 How the systems interlock

The loop runs: **produce → convert → fulfil → upgrade**.

- **Produce:**
  - Plant, water and harvest crops.
  - Tend trees.
  - Feed animals and collect from them.
- **Convert:**
  - The Feed Mill turns crops into feed.
  - Kitchen, Dairy, Loom and other buildings craft goods.
  - Fertilizer, which comes from animals, can make prized goods.
- **Fulfil:**
  - Sell at the Market Stand.
  - Fill orders on the Orders board.
  - Load the River Barge.
  - Hand in quest items.
  - Donate to Restoration bundles.
  - Enter prized goods at the County Fair.
- **Upgrade:**
  - Spend coins and XP on new crops, animals, trees and buildings.
  - Expand land: clear debris, buy plots.
  - Use Restoration features: Greenhouse, Mill wheel, Bridge and so on.
  - Earn personal perks.
  - Each upgrade brings bigger or faster production, which feeds back into Produce.

**Side meters** fill on every action without extra clicks:
- Mastery points per item (stars).
- Achievement counters (ribbons).
- Daily Almanac tasks.
- Story quest tasks.
- Collection drop rolls (with pity).
- County Fair points, for prized goods only.
- Seasonal Ribbon Track points.
- Hearts, for any help given to the partner.

**Key interlocks** (why the systems need each other):
- Animals need feed from crops. Fertilizer comes from animals. Prized goods need fertilizer.
  So all three verbs matter every day, not just "crops".
- Orders, the barge and quests ask for *crafted* goods. That pulls players into buildings and
  creates "set aside" planning, the medium-horizon thinking.
- Restoration bundles ask for *variety*: one of each tree fruit, a prized animal good, a festival
  crop. That pulls players across every system and is the long-horizon glue.
- Mastery raises the prized chance, prized goods feed the Fair, and Fair medals raise the
  visitor/barge reward multiplier. Quality forms a loop next to quantity.
- Personal specialisation perks apply to actions the player performs, so a natural division of
  labour appears ("you do the orchard, I do the barn") without being required.

### 3.4 The Goal Tracker (HUD) — the "never empty" algorithm

Show three slots at all times, top-left (FV2 put quests on the left —
[Gamezebo](https://www.gamezebo.com/reviews/farmville-2-review/)):

- **NOW**: actionable within about 1 minute, with no waiting.
- **SOON**: completable within about 15 minutes.
- **BIG**: a pinned long-term goal. The player chooses it, or the game picks the nearest to
  completion.

```
candidates = []
candidates += readyToCollect()          // crops/trees/animals/buildings ready — always top NOW
candidates += idlePlots()               // "Plant something: 6 empty plots"
candidates += fillableOrders()          // orders fully fillable from storage now
candidates += almanacTasks(player)      // personal daily tasks (refresh on completion)
candidates += helpRequests(partner)     // partner flagged a crate/order "need help" (+Hearts)
candidates += questTasks()              // story tasks; mark which are doable now
candidates += nearlyDone(threshold=0.8) // achievements/mastery/collections/bundles ≥80% (goal-gradient)
candidates += levelPreview()            // "Level 13 in 240 XP → unlocks Cherry Tree"
candidates += debrisTiles()             // clear-land micro-goals
score(c) = urgency(c)                  // ready items, expiring orders, festival end
         + proximity(c)                // 1 - remaining/total (goal-gradient)
         + horizonFit(c, slot)         // ETA matches slot
         + novelty(c)                  // prefer a system not shown in the last 10 min
         - partnerIsDoingIt(c)         // de-prioritise what the partner is actively doing
NOW  = best with eta<=60s ; SOON = best with eta<=15min ; BIG = pinned || best long-term
```

**NOW-slot fallback chain** (it can never be empty):
1. Collect what's ready.
2. Plant idle plots.
3. Fill an order.
4. Do an Almanac micro-task.
5. Clear debris.
6. Help your partner (their flagged requests).
7. Decorate (beauty points).
8. "Everything's growing — next ready in 2:41. Tip: Radish grows in 2 min."

The tip always names the fastest unlocked crop. This is the anti-idle guarantee.

**Rule G-VALID:** the quest, order and task generators may only ask for items that are unlocked
*and* producible from the current recipe graph. Validate at generation time. Re-validate on
server start, and swap any invalid entry for a valid one.

**Rule G-TIMERS:** at every Farm Level the unlocked set must contain at least one crop of each
length:
- ≤ 3 minutes (active play).
- 15–60 minutes (a coffee break).
- 4–8 hours (a work day).
- 10–16 hours (overnight).
- 24 hours or more (weekend or trip).

Whatever the session or absence length, there is a "right" crop. Hay Day's wheat (2 min) and FV2's
strawberries (24 h) are the two ends of this ladder
([Gamezebo](https://www.gamezebo.com/reviews/farmville-2-review/)).

### 3.5 Pacing targets (both players combined, about 1–2 h/day of play)

| Milestone | Target real time | What the players should feel |
|---|---|---|
| Farm Level 5 | 20–30 min | Tutorial done: crops, chickens, first tree, first order |
| Level 10 | end of first evening (~2 h) | Kitchen running, mastery unlocked, daily Almanac unlocked, first expansion |
| Level 15 | day 3 | County Fair open, River Barge open, 3 animal types, 2 tree types |
| Level 20 | end of week 1 | First Restoration project done (Greenhouse or Mill), first collection set |
| Level 30 | week 4 | Most production buildings, first prized animal, first gold mastery |
| Level 40 (content cap v1) | months 2–3 | Every crop, animal and tree unlocked; Restoration ~70%; 4-star beauty |
| Legacy levels | endless | ~1 Legacy level per 3–4 play days, each with a reward |

**XP curve shape.** Use `xpToNext(L) = round(base * L^1.6 + c)` (or a table) with Levels 1–10 short,
so early levels arrive about every 5–15 minutes. Then let it rise toward about one level per 1.5
play-days at L30 and about 4 play-days at L40. Legacy levels use a flat requirement equal to the L40
requirement. **Every level shows its reward before it is reached** (anticipation), and the level-up
modal lists what is new plus a "go there" button.

**Unlock cadence rule.** Levels 1–40 each unlock at least one *thing*: a crop, animal, tree,
building, recipe set, feature or plot. Rotate the categories so no category goes more than 3 levels
without something new. Suggested order (economy designer to finalise):

| Level band | Unlocks (proposal) |
|---|---|
| 1–5 | Wheat (2 min), Carrot, Strawberry (overnight); Chickens and Feed Mill; Apple tree; Market Stand; Orders board; first quest chain "Grandma's Letters" |
| 6–10 | Corn, Pumpkin; Cows and Dairy; Kitchen (bread, pie); **Crop Mastery (L7)**; Daily Almanac (L8); first land expansion; Collections album; Pets (dog/cat) |
| 11–15 | Cherry and Orange trees; Sheep and Loom; Beehive (honey); Fertilizer and prized goods; **County Fair (L14)**; **River Barge (L15)**; personal specialisation (L12) |
| 16–20 | Pigs, Ducks; Pear, Peach trees; Jam Kitchen; Restoration Ledger (L16); Farm Beauty rating (L18); Greenhouse project |
| 21–30 | Goats and Cheese; Lemon and Plum trees; Pond and fishing (optional loop); Bakery 2; Seasonal Ribbon Track; Horses (prestige animal); heirloom (prized) trees |
| 31–40 | Exotic trees (Maple → syrup, Olive → oil, Cocoa); Alpacas; Chocolatier; giant crops; Golden mastery tier; final Restoration projects |
| 40+ | Legacy levels (cosmetics, golden seed packs, statue variants, new decor sets) |

---

## 4. Concrete systems spec (progression and goals)

### 4.1 Farm Level and Personal Level

- **Farm XP** = the sum of all XP from both players. It gates content, land and buildings.
- **Personal XP** is the actor's own XP and drives the Personal Farmer Level, which gives:
  - 1 specialisation point per 2 levels.
  - Wardrobe unlocks.
  - Titles.
- **Crop XP is paid at harvest, not at planting.** It is split: the planter gets a 40% "grower
  share" and the harvester 60%. If the same person does both, they get 100%. Farm XP counts the
  harvest once. This removes "you stole my harvest" feelings and kills plant-and-delete XP farming.
- **Rested XP ("Missed you")** applies to personal XP only. It accrues 5% of a personal level per
  8 h offline, capped at 150% of a level, and doubles personal XP until used up (WoW model,
  [Icy Veins](https://www.icy-veins.com/wow/rested-xp-a-detailed-overview)). The partner who plays
  less keeps pace in personal level. Farm XP is unaffected, so the economy stays stable.

### 4.2 Mastery

- Per crop, tree fruit, animal product and recipe: ★1 / ★2 / ★3, then **Gold ★** (endgame).
- **Thresholds scale with the item's growth time**, so slow crops don't take forever:
  `harvestsNeeded(star) = k_star * clamp(60 / growMinutes, 0.25, 4) * baseCount`.
  - Fast crop example: 50 / 250 / 750 / 2,500 harvests.
  - Overnight crop example: 15 / 60 / 180 / 600.
- **Rewards per star:**
  - +5% sell price (cumulative).
  - +1 percentage point prized chance.
  - XP and a coin chest.
  - ★3 places a **Mastery Sign** decoration (FarmVille's mastery sign).
  - Gold ★ gives a gold-trim variant of the crop's sign and 2× collection-drop chance on that crop.

  (FV2: higher mastery raised coins, XP and prized chance —
  [Gamelytic](https://gamelytic.com/farmville-2-crop-mastery-guide/).)
- **Animals:** baby → adult (feedings or bottles) → **Prized** after N adult feedings (FV2 used 45
  for the horse). A prized animal makes a rare good, such as golden eggs or silk wool, and counts as
  that animal's ★3. Bottles come from the Feed Mill or the partner (a co-op mechanic), never from a
  shop paywall.

### 4.3 Quests and story

- **Story** ("Restore the Hollow"): a light arc of letters from Grandma Hazel (the farm's previous
  owner, as in FV2's inheritance premise) and townsfolk. Suggested original cast:
  - Mabel, the market keeper (orders).
  - Ollie, the carpenter (buildings and restoration).
  - Dr. Fern, the vet (animals).
  - Juniper, the orchard keeper (trees and bees).
  - Captain Reed (the River Barge).
  - Judge Pemberton (the County Fair).
- **Structure.** 1–3 active quest cards with 2–4 tasks each, mixing *do* tasks (harvest 20 carrots),
  *make* tasks (bake 3 pies) and *deliver* tasks (hand in 5 eggs). Each card has an XP, coin and
  often unlock reward. Chapters end with a "story beat" (a short vignette) that waits for both
  partners, or plays at the absent partner's next login and is replayable from the Journal.
- **Either partner can progress any task.** Credit is shared. Each task records who did it, for the
  Memory Book.
- **Side quests** come from the order system and townsfolk. Unlimited, light, no penalty.
- **Never** a quest that needs an item not yet unlocked (Rule G-VALID). **Never** a timed story
  quest. Timers only on optional orders and festival tasks.

### 4.4 Orders board (G5)

- 6 slots early, 9 later. Each order asks for 1–4 item types and pays coins and XP, roughly 1.3–1.8×
  raw sell value, more for crafted items.
- **Discarding an order** refills that slot after 20 minutes. That stops order-fishing (Hay Day uses
  30 minutes — [SuperCheats](https://www.supercheats.com/hay-day/walkthrough/delivery-truck)).
- A **"Need help" flag** (co-op): either partner can flag an order. If the *other* partner fills it,
  both get +1 Heart and the order pays +10% XP. Filling your own flagged order gives no bonus, which
  closes the exploit.
- At least 2 orders on the board are always fillable with items unlocked for 2+ levels (beginner
  safety).

### 4.5 Daily systems

- **Daily Almanac (G11).** 4 personal micro-tasks per player, refreshing when completed (Nook Miles+
  style), plus 1 shared "Together task" that progresses from both players' actions. The first 5
  completions per player per day pay double. After that, tasks pay the base amount and keep
  refreshing ([Game8](https://game8.co/games/Animal-Crossing-New-Horizons/archives/285213)).
  Each player gets 1 free reroll per day.
- **Daily Gift (G12)** is a 28-day "advent" calendar for the farm, not per player. Missing a day
  **pauses** it and never resets it. Day 7, 14, 21 and 28 gifts are special (decor). Either partner
  claims it, and both see it.
- **Farm Streak** counts consecutive days where *either* partner played 5+ minutes. It holds 2
  freezes, earning 1 per 7 streak days, maximum 3. A missed day auto-uses a freeze. Breaking the
  streak costs nothing except the counter; streak milestones are cosmetic. (Duolingo freezes and
  weekend amulet —
  [UX Magazine](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame).)
- **Market Demand (G13).** Each day one raw crop and one crafted good sell for +50%, chosen from
  unlocked items and never the same pair two days running.
- **Morning recap.** "While you were away" lists what grew, what the partner did, gifts and notes
  waiting, and story beats to watch.

### 4.6 Weekly systems

- **County Fair (G14)** runs Monday 00:00 → Sunday 20:00 local time, with a results ceremony
  Sunday evening.
  - Prized goods earn points (crop tier × mastery multiplier).
  - Medals have 3 sub-levels each: Bronze I–III / Silver I–III / Gold I–III / Platinum. FV2 had
    exactly these four medals, and the medal raised visitor rewards
    ([FV2 help](https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/669-what-are-the-different-county-fair-medals-1688113478/?p=all)).
  - Medal thresholds are set for **1.5 players**, so a solo week can still reach Silver or Gold.
  - **NPC league:** 5 NPC farms with seeded weekly scores near the couple's recent average form a
    5-league ladder like the Hay Day Derby. The couple competes *together* against NPCs, never
    against each other.
  - Rewards: medal chest, a ribbon trophy on the Fair Shelf, and a 48 h "Double Time" growth bonus
    for Platinum (FV2 State Fair —
    [FV2 Junkie](http://fv2-junkie.blogspot.com/2015/09/county-fair-and-state-fair-how-to.html)).
- **River Barge (G15).** Arrives Monday and leaves Sunday 20:00. 9 crates in 3 rows of 3; each crate
  is one item × quantity.
  - Every crate pays on fill, a completed row pays a row bonus, and all 9 pay the barge chest.
  - Up to 3 crates can carry a "Need help" flag: the other partner gets +Hearts and +XP for filling.
  - **Escalating weekly ladder:** completing barges in consecutive weeks raises the next chest tier
    (FV2:CE 5-week ladder, Hay Day "Captain"). A missed week drops one tier, not back to the start.
  - Unfinished crates are never a penalty.
- **Weekly Couple Challenge.** One shared goal, for example "Bake 40 pies together". It counts both
  players' actions. The reward is Hearts plus decor. Optionally a "both contributed ≥1" sticker,
  never a block.

### 4.7 Seasons and festivals

- **Seasons follow the real calendar** (Northern hemisphere: Oct = autumn). Each season has
  "in-season" crops that grow 15% faster and sell +10%, *not* a ban on off-season crops. Stardew's
  season-end crop death is too punishing for casual co-op.
- **Seasonal Ribbon Track (G16).** 30 free tiers per season, with points from all activity.
  Rewards: decor, outfits, golden seed packs, a season-exclusive animal skin. Unfinished points roll
  into coins when the season ends.
- **Festivals (G17)**, 7–14 days, data-driven from a yearly schedule:
  - Harvest Festival (Oct).
  - Winter Lights (Dec).
  - **Sweethearts' Fair (Feb, couple-themed)**.
  - Spring Bloom (Apr).
  - Summer Fair (Jul).
  - The farm's **Anniversary** (founding date).

  Each festival has an event crop or recipe, a 5–8 step prize ladder and an event decoration set.
  **Anti-FOMO:** every event item returns the next year, and missed decor appears in the catalogue
  at a coin price after the event ends.

### 4.8 Long-term systems

- **Restoration Ledger (G19).** 6 projects in a fixed order but with parallel bundles:
  1. Old Greenhouse — year-round in-season bonus for crops inside.
  2. Mill Wheel — Feed Mill ×2 speed.
  3. Stone Bridge — opens the far meadow expansion.
  4. Orchard Pond — fishing, ducks, irrigation +10% tree yield.
  5. Town Fair Grounds — the Fair's Platinum tier and the NPC league.
  6. Grandma's Farmhouse — the endgame home, interior decorating, Memory Book wall.

  Each bundle is a list such as "5 of 6": choice gives flexibility, as in Stardew
  ([BisectHosting](https://www.bisecthosting.com/blog/stardew-valley-community-center-guide-bundles-unlock)).
  **Either partner can donate any item, and the whole farm gets the unlock.** Each bundle shows
  donor avatars.
- **Collections (G18).** About 20 sets × 5 items: Butterflies, Lost Tools, Grandma's Recipe Cards,
  Seashells (pond), Feathers, Fossils (debris clearing) and so on.
  - Items drop from specific verbs, at 1–3% per eligible action.
  - **Pity counter:** a missing item is guaranteed after N eligible actions without a new item.
  - Duplicates convert to coins or trade in.
  - A completed set gives a reward and a display piece.
  - The album records who found each item.
- **Farm Beauty (G20).** Decor and building placement score, with variety bonuses, path bonuses and
  "themed zone" bonuses, for 1–5 stars. Five stars gives a weekly rare flower, as ACNH does. Beyond
  5 stars, "Showcase" points feed achievements. This makes the decorator's play first-class
  progression.
- **Legacy Levels (G23).** After L40, every level gives one Legacy reward from a rotating pool:
  cosmetics, golden seed packs (guaranteed prized), statue variants, new decor sets. No empty levels.

### 4.9 Memory Book (couple-specific)

Milestones are captured automatically with a canvas snapshot and a caption:
- First harvest together.
- First animal (with its name).
- Each 5th level.
- First prized animal.
- Each Restoration project.
- Each Platinum Fair.
- Festival wins.
- Anniversaries.

Players can add a manual snapshot plus caption from photo mode. It is shown in the farmhouse and in
the Journal. This costs little and is the most "couple" feature on the list.

---

## 5. (b) Achievements — "Ribbons" (64 entries, bronze / silver / gold)

**Calibration targets:** Bronze within week 1 (most), Silver around month 1, Gold around month 3 or
later, assuming a couple playing about 1–2 h/day. The numbers below are first-pass. Calibrate them
by simulating the economy so the targets hold. **Scope:**
- **F (Farm):** shared counter, unlocked for both at once.
- **P (Personal):** each player's own counter.
- **T (Together):** needs both players, either simultaneously or both contributing.

**Rewards:**
- Bronze: XP and a small coin chest, paid once into the treasury.
- Silver: a decoration (granted to the farm) plus a Ribbon Point.
- Gold: a unique golden trophy decor, a title for *both* (or for the earner if P), and 3 Ribbon
  Points.

Ribbon Points unlock the Ribbon Wall tiers, which are cosmetic: wall frames, a farm-gate arch, a
golden scarecrow.

**Counting rules (exploit-proof):**
- Count only goods *produced* (harvested, collected, crafted). Purchases and refunds never count.
- "Coins earned" means coins from sales, orders, barge and fairs. Refunds subtract.
- "Coins spent" means non-refundable spending only. Undo-window refunds subtract.
- Gifts count once per item instance, and at most 10 gifts per giver per day.
- Help counts only when the *other* player fills a flag.

### Crops
| # | Ribbon | Requirement | Bronze / Silver / Gold | Scope |
|---|---|---|---|---|
| 1 | Cream of the Crop | Harvest crop plots | 500 / 5,000 / 25,000 | F |
| 2 | Green Thumb | Plant crop plots (counted at harvest) | 500 / 5,000 / 25,000 | P |
| 3 | Rainbow Harvest | Harvest different crop types | 5 / 12 / all | F |
| 4 | Night Shift | Harvest overnight (8 h+) crops | 25 / 250 / 1,500 | F |
| 5 | Speed Farmer | Harvest 2-minute crops in one session | 50 / 200 / 500 | P |
| 6 | Prize Patch | Harvest prized crops | 10 / 150 / 1,000 | F |
| 7 | Giant Among Us | Harvest giant crops | 1 / 10 / 50 | F |
| 8 | In Season | Harvest in-season crops across seasons | 1 season / 4 seasons / 8 seasons | F |

### Trees
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 9 | Knock on Wood | Harvest trees | 50 / 500 / 2,500 | F |
| 10 | Orchardist | Own different tree types | 3 / 6 / all | F |
| 11 | Tender Branches | Revive wilted trees | 5 / 50 / 250 | P |
| 12 | Heirloom Keeper | Harvest prize fruit from heirloom trees | 5 / 75 / 400 | F |
| 13 | Busy Bees | Collect honey | 20 / 200 / 1,000 | F |

### Animals
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 14 | Zoologist | Collect animal products | 100 / 1,000 / 5,000 | F |
| 15 | Nursery | Raise babies to adulthood | 3 / 15 / 50 | F |
| 16 | Blue Ribbon | Raise prized animals | 1 / 5 / 15 | F |
| 17 | Full Barnyard | Own different animal species | 3 / 6 / all | F |
| 18 | Name Game | Name animals | 3 / 15 / 40 | P |
| 19 | Feeding Frenzy | Feed animals | 200 / 2,000 / 10,000 | P |
| 20 | Best Friends | Pet the farm pet on different days | 7 / 30 / 100 | P |

### Kitchen and crafting
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 21 | Home Cooking | Craft goods | 50 / 500 / 2,500 | F |
| 22 | Recipe Box | Learn different recipes | 10 / 25 / all | F |
| 23 | Master Chef | Recipes at ★3 mastery | 1 / 5 / 15 | F |
| 24 | Mill Runner | Grind feed | 100 / 1,000 / 5,000 | F |
| 25 | Artisan | Craft high-tier goods (3+ ingredients) | 10 / 100 / 500 | F |

### Economy and orders
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 26 | High Roller | Coins earned (lifetime, from sales and rewards) | 10k / 250k / 2.5M | F |
| 27 | Good Business | Market Orders completed | 25 / 250 / 1,000 | F |
| 28 | Captain's Friend | River Barges fully loaded | 1 / 8 / 30 | F |
| 29 | Full Steam | Consecutive full barges | 2 / 6 / 12 | F |
| 30 | Market Savvy | Sell Demand-of-the-day goods | 20 / 200 / 1,000 | F |
| 31 | Saver | Coins held in Savings Jars at once | 5k / 50k / 500k | F |
| 32 | Big Spender | Non-refundable coins spent | 10k / 250k / 2.5M | F |

### Building, land and beauty
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 33 | Clearing the Way | Debris tiles cleared | 25 / 150 / all | F |
| 34 | Room to Grow | Land expansions bought | 1 / 4 / all | F |
| 35 | Builder | Buildings constructed or upgraded | 3 / 12 / 30 | F |
| 36 | Picture Perfect | Farm Beauty stars | 2★ / 4★ / 5★ | F |
| 37 | Showcase | Beauty Showcase points beyond 5★ | 500 / 2,000 / 6,000 | F |
| 38 | Interior Designer | Farmhouse decor placed | 10 / 40 / 100 | F |

### Collections, Restoration, mastery
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 39 | Collector | Collection sets completed | 1 / 8 / 20 | F |
| 40 | Lucky Find | Collection items found | 10 / 50 / 100 | P |
| 41 | Restorer | Restoration bundles completed | 3 / 15 / all | F |
| 42 | Hollow Reborn | Restoration projects completed | 1 / 3 / 6 | F |
| 43 | Crop Master | Crops at ★3 | 1 / 6 / all | F |
| 44 | Golden Touch | Items at Gold ★ | 1 / 5 / 15 | F |

### Fair, seasons, events
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 45 | Fair Contender | Best County Fair medal | Bronze / Gold / Platinum | F |
| 46 | Fair Regular | Fair weeks with any medal | 4 / 15 / 40 | F |
| 47 | League Climber | Highest NPC league reached | 2 / 4 / 5 | F |
| 48 | Season Ticket | Seasonal Ribbon Track tiers completed (lifetime) | 30 / 90 / 240 | F |
| 49 | Festive | Festivals with the final prize claimed | 1 / 4 / 10 | F |
| 50 | Sweethearts | Sweethearts' Fair final prize claimed | 1 / 2 / 3 years | T |

### Habits (no-guilt versions)
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 51 | Almanac Reader | Daily Almanac tasks completed | 50 / 500 / 2,500 | P |
| 52 | Farm Streak | Best farm streak, freezes allowed | 7 / 30 / 100 days | F |
| 53 | Farmer's Calendar | Days played (lifetime, not consecutive) | 7 / 60 / 200 | P |
| 54 | Level Up | Farm Level reached | 10 / 25 / 40 | F |
| 55 | Seasoned Farmer | Personal Farmer Level reached | 10 / 25 / 40 | P |

### Together (co-op, needs both players)
| # | Ribbon | Requirement | B / S / G | Scope |
|---|---|---|---|---|
| 56 | Helping Hands | Partner help-flags filled for the other | 10 / 100 / 500 | T (each counts their own) |
| 57 | Love Letters | Gifts given to the partner | 10 / 75 / 300 | P |
| 58 | Duet | Duet recipes crafted (both at the station) | 3 / 30 / 150 | T |
| 59 | Teamwork | Giant crops or big stumps felled together | 3 / 25 / 100 | T |
| 60 | Golden Hour | Sunset Bench sessions together | 3 / 30 / 100 | T |
| 61 | High Five | Synchronised high-fives | 10 / 100 / 500 | T |
| 62 | Side by Side | Hours with both players online at once | 5 / 50 / 250 | T |
| 63 | Our Story | Memory Book pages filled | 10 / 40 / 100 | T |
| 64 | Equal Partners | Weeks where both contributed ≥1 crate to a full barge | 2 / 10 / 30 | T |

**Hidden "fun" ribbons** (single tier, revealed when earned):
- "Scarecrow's Day Off": place 10 scarecrows.
- "Pumpkin Royalty": harvest a prized pumpkin at the Harvest Festival.
- "Early Bird": harvest before 7:00.
- "Night Owls": both online after midnight.
- "Chicken Whisperer": name 12 chickens.
- "Thank You!": send 50 thank-you hearts in the activity feed.

**Display.** Ribbon Wall in the farmhouse, and a ribbon count on each player's name card. The
ribbon toast shows for both players with "Unlocked together!" when the scope is F or T.

---

## 6. (d) Shared vs personal ownership — recommendation and anti-frustration rules

### 6.1 The ownership table

| Thing | Recommendation | Why |
|---|---|---|
| **Farm land, buildings, crops, trees, animals** | **Shared** (one farm) | The premise. Equal co-owners with no host; avoids ACNH's rep gating and Stardew's host privilege |
| **Coins (wallet)** | **Shared Farm Treasury**, plus Savings Jars (6.2) | Everything coins buy is shared, so the money should be too. Separate wallets in Stardew cause coordination overhead and "whose barn is it" questions. Farm Together's co-owned farm puts money "to the farm" ([Steam](https://steamcommunity.com/app/673950/discussions/0/3276824488725706263/)). The documented shared-money pain (one person spends it all) is solved by jars, undo and a ledger rather than by splitting |
| **Personal spending money** | **Hearts**, a personal currency earned by helping the partner, gifting, daily tasks and Together achievements. Spent on personal cosmetics (outfits, avatar items, personal emotes, name-card frames) | Gives each partner a "my money" outlet that never competes with farm investment. Hearts can't buy farm production, so there's nothing to fight over |
| **Storage (barn, silo)** | **Shared**, with **reservations** (6.2) | One farm, one barn. Reservations protect saved ingredients |
| **Inventory "in hand"** | Minimal: a personal **Gift Box** (items wrapped for the partner) and a personal **Wardrobe** | A click-to-act game doesn't need a personal backpack. Fewer places for items to get lost |
| **Farm XP and Farm Level** | **Shared** (sum of both) | Content unlocks must be equal for both; a level gap would recreate ACNH's "ask your rep" problem |
| **Personal XP and Personal Level** | **Personal**, with rested XP | Identity, "my progress", specialisation perks. Rested XP keeps the lighter player near the heavier one |
| **Specialisation perks** | **Personal**, applying to *own actions* only; free respec once per week | Complementarity (Rocha et al.) without power gaps: perks don't change the partner's numbers |
| **Mastery** | **Shared** | It's the farm's knowledge of that crop. Both players' harvests count |
| **Achievements** | **Mostly shared** (F), some personal (P), some Together (T) | Farm Together's personal-farm achievements "broke groups up". Shared ribbons celebrate together; a few P ribbons let each partner have *their* trophies |
| **Quests and story** | **Shared** quest log; either can progress any task; story beats wait for or replay to the other | Stardew's per-player quests duplicate effort on one farm |
| **Daily Almanac tasks** | **Personal** (4 each) plus 1 **shared** | Each partner always has their own short agenda, even playing solo |
| **Daily gift, streak** | **Farm-wide**; streak counts if either plays | No guilt for the partner who skipped a day |
| **Collections** | **Shared album**, finder credited | Collecting together; "she found the golden feather!" |
| **Titles, wardrobe, avatar** | **Personal** | Self-expression |
| **Pets and named animals** | Shared animals; the name tag shows who named them | Ownership feelings without ownership rules |
| **Decor placement** | Shared, with an optional "pin" lock per item | Avoids "you moved my bench" fights |

### 6.2 Anti-frustration rules

Each rule is mapped to a documented frustration.

1. **Savings Jars** (fixes "partner spent the money we were saving").
   - Anyone can create a jar with a name, target and optional item link, such as "Barn upgrade
     — 12,000".
   - Coins moved into a jar are **excluded from the spendable balance**.
   - Taking coins out of a jar the *other* partner created needs their OK. If they are offline, a
     12-hour cooldown then auto-release with a notification.
   - Completing a jar's target offers a one-click buy.
   - Solo play is never blocked: the spendable balance is always usable.
2. **Big-purchase heads-up.** A single purchase over 30% of the spendable treasury, or over 10,000
   coins, triggers a confirm dialog. If the partner is online, they get a non-blocking toast
   ("Kris is buying a Dairy — 8,000"). No approval is required; this is about transparency, not
   permission.
3. **10-minute undo window.** Any purchase or placement can be refunded at 100% within 10 minutes
   (decor at 100% forever if unplaced). XP and achievement counters granted by the purchase are
   clawed back on refund. This fixes "I bought the wrong thing" and closes the buy-refund exploit.
4. **Treasury Ledger.** A complete, neutral log: "+1,240 Orders (Mia) · −3,000 Cherry Tree (Kris) ·
   +Jar 'Barn' 2,000 (Mia)". Neutral wording, no red "blame" colours. Weekly summary "Together we
   earned…".
5. **Item reservations** (fixes "you sold the eggs I was saving for the pie").
   - Mark N of an item in storage as reserved for a quest, order, bundle or recipe.
   - Reserved items can't be sold or used by the partner without a confirm that names the
     reserver.
   - Reservations auto-expire after 48 h.
6. **Harvest XP split** (40% planter / 60% harvester). It turns "you harvested my crops" into
   "you helped me". Harvesting a partner's ready crop also gives both players +1 Heart, at most once
   per batch.
7. **Pinned decor.** Pinned items need a confirm to move or sell, and the owner is notified with a
   one-click undo.
8. **Destructive actions** (sell an animal, demolish, sell all) need a double confirm and have the
   10-minute undo.
9. **Story beats wait.** "Watch together?" prompt; or the absent partner sees the beat on next
   login; replay from the Journal.
10. **No partner leaderboard.** Contribution split exists only on a Stats tab framed as "Together
    we…". Opt-in **Friendly Duel** weeks (for example "most pumpkins") award a cosmetic crown and
    are off by default.
11. **Rested XP plus a "While you were away" recap**, so the partner who plays less never feels
    behind or lost.
12. **No host.** The server runs independently of both players (for example a user service on the
    LAN machine). Either partner logs in alone at any time. This is the #1 couple complaint about
    Stardew and Farm Together.
13. **Simultaneous-action fairness.** The server is authoritative. If both click the same plot,
    first-in wins and the second gets a friendly "Teamwork! Mia got it" sparkle, never an error.
    Predicted client feedback is rolled back smoothly.
14. **Solo-path guarantee.** Every co-op mechanic in section 7 lists its solo fallback. The weekly
    Fair and barge thresholds are tuned for 1.5 players, so a solo week still reaches mid tiers.
15. **Vacation-safe.** Nothing decays while both are away: no withering, no animal death, no
    lost orders other than normal refresh. Event points are never lost (leftovers convert to coins).

---

## 7. (c) Co-op mechanics — better together, never blocked alone (20)

Format: **What it is → why it's better together → solo path → exploit guard.**

1. **Live shared farm presence.** Both avatars are visible in real time, with name tags,
   walk/act animations and a click-to-follow camera.
   - *Together:* you see each other working, which is the "story on the couch" effect.
   - *Solo:* not needed.
   - *Guard:* none needed.
2. **Pings and quick-chat.** Right-click a tile to ping ("Look here", "Ready!", "Need this",
   "Thanks!"), plus 8 emotes. Covers the communication need that close coupling creates
   ([Beznosyk et al.](https://www.semanticscholar.org/paper/The-influence-of-cooperative-game-design-patterns-Beznosyk-Quax/ae975535b05e857ab0f645765ee9516e0ca1c98b)).
   - *Solo:* pings persist as notes for the partner's next login.
3. **Help flags** on orders, barge crates and bundle slots. The *other* partner filling a flag earns
   +10% XP and +1 Heart each (Hay Day crate help, FV2 co-op calls).
   - *Solo:* fill it yourself, no bonus.
   - *Guard:* no bonus for self-fill.
4. **Tend-a-tree revive.** Trees wilt after N harvests. A partner's revive gives a **bonus final
   harvest** (+50% fruit) and resets the tree for a new cycle (Hay Day revive, softened: no death).
   - *Solo:* a craftable Tree Tonic (cheap, from honey and fertilizer) revives at normal yield.
   - *Guard:* the bonus only when the reviver ≠ the planter.
5. **Bottle-feeding babies.** Baby animals need bottles. A bottle from the partner counts double
   (FV2 neighbour bottles).
   - *Solo:* craft bottles at the Dairy.
   - *Guard:* the double counts once per baby per hour.
6. **Duet recipes.** Special Kitchen recipes (Wedding Cake, Festival Pie, Harvest Feast) need two
   players at the station pressing within 3 s. Faster, with a bonus prized chance.
   - *Solo:* a "slow-cook" mode at 2× time, with no prized bonus.
   - *Guard:* the server checks both sessions are active and distinct.
7. **Giant crops and big stumps.** Sometimes adjacent plots of a crop merge into a giant crop, and
   expansions hide big stumps. They need 6 chops; with 2 players chopping together each chop counts
   1.5 and a combo spark plays.
   - *Solo:* 6 chops by one player, just slower.
   - *Guard:* the 1.5 only with two distinct players within 2 s.
8. **Sunset Bench (Golden Hour).** Once per real day, both avatars sit on the farm bench together
   for 10 s. That triggers a farm-wide "Golden Hour": crops grow 10% faster for 30 minutes, and a
   Memory Book page is offered. A ritual moment with real gameplay value.
   - *Solo:* not available, but nothing requires it. This is the one purely together bonus.
   - *Guard:* once per day.
9. **High-five.** Avatars within 2 tiles, both press the high-five emote within 1.5 s: "Teamwork"
   spark, and the next 10 harvests each get +1 personal XP. 30-minute cooldown.
   - *Solo:* not needed.
   - *Guard:* cooldown.
10. **Daily gift to your partner.** Wrap one item a day. The gift arrives "made with love": worth
    1.5× sell value or +1 mastery tick, plus a Heart for the giver.
    - *Solo:* N/A, since gifting is an extra.
    - *Guard:* the bonus only on the first gift per giver per day, and only on items produced on the
      farm. Ping-ponging the same item gives nothing.
11. **Mailbox notes and the activity feed.** Leave a note ("Please feed the cows, love you"). The
    feed lists the partner's actions with a ♥ Thanks button that gives the partner a Heart.
    - *Solo:* this is the async channel itself.
    - *Guard:* hearts from thanks are capped at 10 per day.
12. **Specialisation synergy.** Four personal perk trees: Grower, Rancher, Orchardist, Artisan. Perks
    apply to your own actions. Taking *different* trees gives a farm-wide "Harmony" bonus of +5%
    order rewards while you both hold ≥3 points in different trees. Complementarity without
    obligation.
    - *Solo:* perks still work; the Harmony bonus needs no presence, only different trees.
    - *Guard:* respec once per week.
13. **Together task (daily) and Couple Challenge (weekly).** Shared counters fed by both players'
    actions, with Hearts and decor rewards.
    - *Solo:* still completable by one player, sized for 1.2 players.
14. **Barge "Equal Partners" bonus.** When both partners load at least one crate of a full barge,
    the chest gets +1 decor roll.
    - *Solo:* the full barge still pays everything else.
    - *Guard:* one crate is enough, by design.
15. **Shared Fair entry and NPC league.** The couple competes *as a team* against NPC farms, which
    turns competitive drive outward instead of between partners.
16. **Rested XP ("Missed you") and the Welcome Back pack.** The returning partner gets rested XP and
    a recap card, plus the partner's left gifts and notes. The absent partner never falls behind on
    content, because Farm Level is shared.
17. **Story beats together.** Chapter vignettes offer "Watch together", or are queued for the other
    partner. Shared arc moments without the Stardew cutscene clock problem.
18. **Memory Book and photo mode.** Auto and manual snapshots of both avatars, with captions.
    *Together pose* in photo mode: the two avatars hold hands or sit on the bench.
19. **Farm pets.** A dog and a cat that follow whoever last petted them. If *both* partners pet a
    pet in the same real day, it digs up a treasure (a collection item roll or seed pack) the next
    morning.
    - *Solo:* petting alone keeps the pet happy (a cosmetic heart animation) and earns Best Friends
      progress.
    - *Guard:* one treasure per pet per day.
20. **Opt-in Friendly Duel.** A week-long mini-competition from a list (most pumpkins, most pies,
    most orders). The winner gets a cosmetic crown on the name card for a week, and both get the
    participation decor. Off by default.

Also recommended:
- **Drop-in toast** ("Mia arrived at the farm 🌻" in the UI).
- **Assist camera** (jump to partner).
- **Pointer trails** so the partner sees what you're doing.
- **Matching outfits** in the Hearts shop.

---

## 8. Exploits and dead ends — audit checklist for the designer

**Exploits:**

| Risk | Rule |
|---|---|
| Buy-and-refund loops to farm XP or achievements | Undo refunds claw back XP and counters; "spent" counts only non-refundable spend |
| Plant-and-delete XP | No XP at planting; crop XP only at harvest (40/60 split) |
| Gift ping-pong | Gift bonus only for farm-produced items, first gift per giver per day; gift counters per item instance |
| Self-filling own help flags | Bonus only when the filler ≠ the flagger |
| Order fishing | Discarded slot refills after 20 min; 1 free reroll per day on Almanac tasks |
| Clock manipulation | Server time only. Rested XP, timers and dailies all computed server-side |
| Double-claiming shared rewards | Shared coin/XP rewards paid once to the treasury; cosmetics granted to both wardrobes |
| Fair points from bought goods | Prized goods only from harvest or collection; non-transferable, no buying |
| Collection RNG drought | Pity counter guarantees a missing item after N eligible actions |
| Market Demand arbitrage (store, then sell all on demand day) | Demand bonus applies to the first M units per day (for example 50) |
| Two players doubling income | Intended: daily tasks and Hearts scale per player. Farm throughput is bounded by plots and buildings (shared), so two players mostly add attention, not capacity. Balance for about 1.3× a solo player |

**Dead ends:**

| Risk | Rule |
|---|---|
| Broke with empty fields | The cheapest crop's seed costs ≤ 50% of its sale value. "Grandma's seed basket" gives free starter seeds whenever the spendable treasury is below that cost |
| Barn full | Harvest is never blocked. Overflow goes to a temporary "Overflow Crate" (sell or use only) with a gentle upgrade prompt. Barn upgrade inputs are deterministic, never random-only (Hay Day's random deeds frustration) |
| Feed deadlock (no feed, no crops) | Feed Mill accepts any crop; wheat seeds are always affordable (rule above) |
| Quest asks for a locked item | Rule G-VALID at generation and at boot |
| Event needs the partner | Every T-scope item is optional or has a solo path |
| Withering or death | None. Trees wilt into "tend me", fixable by the partner (bonus) or a Tree Tonic |
| Expansion blocked by a random material | Deterministic materials (coins plus crafted goods plus clearing debris), or random with pity |
| Partner deleted or moved decor | Pin plus 10-minute undo plus a notification |
| Story spoiled by the partner | Watch-together queue plus replay |

---

## 9. Data shapes (to make this implementable)

```js
// shared/progression/achievements.js
{ id: 'cream_of_the_crop', name: 'Cream of the Crop', scope: 'F', // 'F' | 'P' | 'T'
  stat: 'cropsHarvested', tiers: [500, 5000, 25000],
  rewards: [{ xp: 200, coins: 1000 }, { decor: 'ribbon_silver_crop', rp: 1 },
            { decor: 'trophy_gold_crop', title: 'Cream of the Crop', rp: 3 }],
  hidden: false }

// stats: farm-level counters + per-player counters; T stats keep {a, b} contributions
farm.stats = { cropsHarvested: 1234, ... };
player.stats = { almanacDone: 52, giftsGiven: 9, ... };

// goal tracker candidate
{ kind: 'order'|'quest'|'ready'|'almanac'|'help'|'nearlyDone'|'debris'|'level',
  label: 'Fill Mabel’s order: 3 Apple Pie', etaSec: 0, progress: 0.66, targetRef: {...} }

// savings jar
{ id, name: 'Barn upgrade', target: 12000, balance: 4000, createdBy: 'mia',
  link: { kind: 'building', id: 'barn_l2' }, releaseRequest: null|{ by, at } }

// reservation
{ itemId: 'egg', qty: 5, by: 'kris', purpose: { kind: 'recipe', id: 'custard' }, expiresAt }
```

---

## 10. Sources

**FarmVille / FarmVille 2:**
- https://farmville.fandom.com/wiki/Crop_Mastery (snippet)
- https://gamelytic.com/farmville-2-crop-mastery-guide/
- https://farmville.fandom.com/wiki/Ribbons (snippet)
- https://farmville2.fandom.com/wiki/Neighbors (snippet)
- https://farmville2.fandom.com/wiki/Quests (snippet)
- https://farmville2.fandom.com/wiki/Blue_Roan_Horse (snippet)
- https://farmville2.fandom.com/wiki/Prized_Crop (snippet)
- https://www.gamezebo.com/reviews/farmville-2-review/
- https://www.gamezebo.com/news/farmville-2-introduces-weekly-county-fair-event/
- https://farmingnotes.wordpress.com/2012/09/07/farmville-2-while-it-has-cool-3d-technology-it-is-best-suited-for-new-farmville-players-part-1/
- https://adweek.com/digital/farmville-2-review
- https://gamelytic.com/farm-hands-guide-for-farmville-2/
- https://gamelytic.com/farmville-2-basic-money-and-currency-points-overview/
- https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/669-what-are-the-different-county-fair-medals-1688113478/?p=all
- https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/664-what-is-the-county-fair/
- https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/612-how-do-i-use-the-co-op-feature/
- https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/681-how-do-i-raise-my-animals/?p=all
- https://zyngasupport.helpshift.com/hc/en/11-farmville-2-country-escape/faq/10441-introducing-the-co-op-help-and-order-goals/
- https://farmvillecountryescape.fandom.com/wiki/Marie's_Order_Board (snippet)
- https://farmvillefreak.com/farmville-2-country-escape-events-guide/
- https://www.zynga.com/blog/zynga-scares-up-a-slate-of-halloween-treats/
- http://fv2-junkie.blogspot.com/2015/09/county-fair-and-state-fair-how-to.html
- https://www.commonsensemedia.org/app-reviews/farmville-2-country-escape
- https://farmville.fandom.com/wiki/Special_Delivery_Box (snippet)

**Hay Day:**
- https://hayday.fandom.com/wiki/Experience (snippet)
- https://hayday.fandom.com/wiki/Trees_and_Bushes (snippet)
- https://hayday.fandom.com/wiki/Boat (snippet)
- https://hayday.fandom.com/wiki/Expansion/Farm (snippet)
- https://hayday.fandom.com/wiki/Valley (snippet)
- https://www.u7buy.com/blog/hay-day-understanding-the-derby/
- https://www.sportskeeda.com/esports/5-tips-completing-hayday-s-derby-event
- https://www.supercheats.com/hay-day/walkthrough/list-of-achievements (snippet)
- https://www.supercheats.com/hay-day/walkthrough/delivery-truck
- https://medium.com/@hoangvm11.mac/leveling-up-your-game-unlocking-monetization-through-analyzing-hay-day-gameplay-systems-with-4165f47da0dc (snippet)

**Township:**
- https://play.google.com/store/apps/editorial?id=mc_games_editorialevergreen_post_install_township_regattas_now_fcp&hl=en
- https://township.fandom.com/wiki/Regatta (snippet)

**Stardew Valley:**
- https://stardewvalleywiki.com/Multiplayer
- https://stardewvalleywiki.com/Quests
- https://stardewvalleywiki.com/Golden_Walnut
- https://stardewvalleywiki.com/Perfection
- https://steamcommunity.com/app/413150/discussions/0/1735462352482826854
- https://steamcommunity.com/app/413150/discussions/0/1694920442945588786
- https://steamcommunity.com/app/413150/discussions/0/2653115517062592636
- https://forums.stardewvalley.net/threads/stop-time-during-cutscenes-in-co-op.1429/
- https://www.gameslearningsociety.org/wiki/how-to-do-split-money-on-stardew-valley/
- https://www.bisecthosting.com/blog/stardew-valley-community-center-guide-bundles-unlock

**Animal Crossing: New Horizons:**
- https://nookipedia.com/wiki/Nook_Miles
- https://www.imore.com/animal-crossing-new-horizons-nook-miles-guide
- https://game8.co/games/Animal-Crossing-New-Horizons/archives/285213
- https://animalcrossing.fandom.com/wiki/Island_evaluation (snippet)
- https://pixelkin.org/2020/04/20/opinion-animal-crossing-new-horizons-local-co-op-is-frustratingly-limited/
- https://www.washingtonpost.com/video-games/reviews/local-co-op-animal-crossing-new-horizons-is-huge-disappointment/
- https://screenrant.com/animal-crossing-new-horizons-review-bombed-frustrating-multiplayer/

**Farm Together:**
- https://farmtogether.fandom.com/wiki/Multiplayer (snippet)
- https://steamcommunity.com/app/673950/discussions/0/3211505894141845388/
- https://steamcommunity.com/app/673950/discussions/0/3276824488725706263/
- https://steamcommunity.com/app/2418520/discussions/0/4368004047820792710

**Co-op design and theory:**
- https://www.avclub.com/josef-fares-it-takes-two-interview
- https://www.theringer.com/2021/04/22/video-games/josef-fares-it-takes-two-interview-co-op-gaming
- https://www.semanticscholar.org/paper/Game-Mechanics-for-Cooperative-Games-Rocha-Mascarenhas/5a2a3e2945fd9f9928b42386631f88ec615764db
- https://www.researchgate.net/publication/221516170_Understanding_and_evaluating_cooperative_games
- https://www.semanticscholar.org/paper/The-influence-of-cooperative-game-design-patterns-Beznosyk-Quax/ae975535b05e857ab0f645765ee9516e0ca1c98b
- https://www.xda-developers.com/co-op-games-to-play-with-non-gamer-partner/
- https://www.switchbladegaming.com/co-op-games/best-couples-2026/
- https://lostgarden.com/2012/04/30/loops-and-arcs/
- https://www.icy-veins.com/wow/rested-xp-a-detailed-overview
- https://yukaichou.com/behavioral-analysis/goal-gradient-hypothesis-hull-kivetz-motivation-acceleration/
- https://medium.com/@davidteodorescu/design-perfect-ux-tasks-the-endowed-progress-effect-7461ca20076c
- https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame
- https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/
