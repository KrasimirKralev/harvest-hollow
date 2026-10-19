# How the game works: the rules a change keeps (for Harvey)

A change must fit the game's economy and level path, so the farmers keep playing the game instead of skipping it. The
validator refuses what breaks these rules; this sheet says why. Fields and ladders: `docs/mod-guide.md`. Sources:
`shared/mod/econ.js`, `shared/mod/compile.js`, `server/mods/econ-guard.js`, `shared/content/levels.js`.

## Levels and unlocks
- One **farm level** for both farmers (farm XP is the sum of both). Levels 1 to 40 unlock the game's things (after 40
  come Legacy levels, rewards only); an unlock is the same for both. A level-up pays coins and Acorns and finishes
  everything growing. Each farmer's personal XP and level are their own; a mod never touches them.
- Your crop, tree or recipe unlocks at the `unlock` you write (1 to 40), a recipe at or after its workshop and every
  input (BAD_UNLOCK). A breed and a decoration arrive at their anchor's level.
- Pick an unlock at most the farm level (`"usable": true`) unless the player wants it later. A wish that fits only
  later (a llama like the alpaca, 33) is still built at that level, and the summary says "from level N".
- The game's own unlocks never move: "watermelons now" on a level-21 farm is a melon of your own at 21.

## Prices come from time
You choose *what* and *how long* (ladder steps only); the game's economy model, the same one that prices its own
crops, computes every price, seed and XP. You only pick `value`: `humble` (-10 %), `normal`, `rich` (+10 %).
- **Level bonus:** +1.5 % per unlock level above 1 (level 21: +30 %).
- **Crop:** the harvest's worth comes from its time; seed = 40 % of it, XP = 1/8 of it. Up to 60 minutes every crop
  earns the same per minute; after that **longer crops pay more per harvest and less per hour** (1440 minutes earns
  about a sixth per minute of 60): long crops are for when the farmers are away.
- **Tree:** 1.6 x a crop of its cycle. **Recipe:** its inputs' worth plus what the workshop adds for its time, at least
  15 % (ECON_BOUND: big inputs need a longer time). **Animal product:** the anchor's price x `value`.
- **Decoration:** `cost` half to double the anchor's; its beauty follows the cost.

## The guards
- **Never better than the game at its level:** a new crop, tree or recipe earns per minute at most 112 % of the game's
  best of its family at or below its `unlock` (OUT_OF_RANGE: a longer time or a humbler value). A new thing is a
  choice, never the obvious winner that makes the game's own pointless.
- **The crop day:** the farm's best 24 hours of crops pay at most 130 % of the game's coins and XP at the farm's level
  (ECON_GUARD). `fastestGrowMin` in `docs/catalog/crops.json` is that limit for each crop: never tune below it.
- Only the `tuning.json` knobs of the guide are tunable: never one animal, one workshop, a price or an unlock.

## New things, not copies
- **A breed** keeps its anchor's home, feed, timing, baby price, XP and level; only its name, coat and product are
  yours. **A decoration** is beauty only: some of the game's own help (the sprinkler waters, the scarecrow helps
  crops), a new one copies only the look. **Goods of a mod** sell and go into recipes; orders never ask for them.
- **Copying a look or an anchor is not a duplicate.** A new breed, crop or recipe under its own name is new (a llama
  like the alpaca, an Early Melon like the watermelon). A duplicate is a second copy of something the game has for the
  same use (pigs, the cherry pie): point to it (`docs/game-features.md`).

## Co-op and progress
- Shared: land, plots, crops, trees, animals, buildings, decorations, coins, Acorns, the barn, farm XP. Personal:
  personal XP, Hearts, look, pet. A change is for both farmers; there is no "only for me". Letters speak to both
  ("вие"), the summary to the one who asked ("ти"). One change runs at a time per farm.
- The farmers progress by farm XP (harvests, crafts, animal goods, orders, quests, daily goals) and coins (selling,
  orders). Orders, quests, the Journal, ribbons, collections, the Fair and the Barge are the game's; a mod cannot add,
  change or reward them.

## What would break the game (never, even when asked)
- Coins, XP, prices or rewards; anything past the guards above; moving the game's own unlocks earlier.
- Removing, renaming or replacing the game's own things (orders, quests and saves depend on them).
- Decorations with bonuses, recipes before their workshop or inputs, a breed in a new kind of home.
- A letter that asks for a delivery or promises a reward (the game cannot track or pay it); a change for one farmer.
