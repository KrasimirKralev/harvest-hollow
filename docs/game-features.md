# What the game already has, and where (for Harvey)

Before you build, check here: a wish for something the game already has gets a pointer, not a copy. When you answer in
Bulgarian, name each place by its Bulgarian name (in brackets below), exactly as the game shows it.

- **Seeds, fruit trees, animals, decorations**: the Market [Пазар] (its tabs Seeds [Семена], Trees [Дървета], Animals
  [Животни], Decor [Украса]), each from its level in `docs/catalog/*.json`. Pigs live in the Pig Pen [Кочина] (level 17);
  alpacas (the llama look) in the Paddock [Алпакарник] (level 33).
- **Recipes**: the workshops (Bakery [Пекарна], Kitchen [Селска кухня], Pie Oven [Пещ за пайове], Juice Press [Преса за
  сок], Preserves [Кухня за зимнина], Dairy [Мандра] …); `docs/catalog/recipes.json` lists every recipe with its workshop
  and level. Cherry Pie [Черешов пай] and Apple Pie [Ябълков пай] are already in the Pie Oven.
- **Orders, quests and goals**: the Orders board [Поръчки], the Journal [Дневник] and the townsfolk's letters come from
  the game; Harvey cannot add or change them.
- **Pets** (the farm dog and cat): the Farm book › Animals › Pets [Книжката на фермата › Животни › Любимци]. They cannot
  learn new tricks.
- **Your farmer's look** (hats, clothes, colours): the Farm book › You › Your look [Книжката на фермата › Ти › Твоят вид].
- **The farm's name**: Settings › Farm › Farm name › Rename [Настройки › Ферма › Име на фермата › Преименувай].
  **Land**: the Market's Land tab [Пазар › Земя]. **Buildings**: the Market's Buildings tab [Пазар › Сгради].
- **Music**: Settings › Look & sound [Настройки › Вид и звук]; a mod may prefer tracks (`look.json` `music.prefer`).
  **The sky**: a preset (`look.json` `sky`).
- **Harvey himself** (sign-in, sharing, the history of changes): Settings › Harvey [Настройки › Харви] and Harvey's own
  panel.
- **Weather, seasons, events, prices, coins and experience**: the game's own rules; never changed by a mod.
- **Faster crops, trees, workshops or animals for the whole farm**: `tuning.json` (`*Bp` knobs); one crop on its own:
  `crops.<id>.growMin` down to that crop's `fastestGrowMin` in `docs/catalog/crops.json`.
