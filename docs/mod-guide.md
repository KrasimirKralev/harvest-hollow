# How to mod Harness Hollow (format 1)

You change one farm by writing JSON files under `mod/`. The game's own code is never touched. A validator checks
everything you write, then boots a copy of the farm with your mod and plays it: only a mod that passes reaches the
player. Prices, seed costs and XP are computed by the game from its economy model. You choose *what* and *how long*.

## Your workflow
1. Read `request.md` (the request, the game language, the farm level, any errors from the last round).
2. Look up what exists in `docs/catalog/*.json` (crops, trees, recipes, buildings, animals, decor, items, npcs,
   letterArt, music, ladders, idsInUse). Every new thing copies the look of an existing one ("like").
3. Write or edit files in `mod/`. Keep the files already there unless the request asks to change or remove them
   (deleting a file retires that thing: what the farm already has keeps working, nothing new can be bought).
4. Call `validate`. Fix every error (each has `file`, `path`, `code`, `hint`) and call it again until `ok` is true.
5. Call `preview` and check names, icons and numbers read well in both languages.
6. Write `summary.json`: `{ "en": "...", "bg": "..." }`, two short friendly sentences each.

If part of the request cannot be done in this format, build the part that can and say what could not in the summary.
Not possible: code, new 3D models or pictures, choosing prices or rewards, quests, events, weather odds, NPC lines,
changing other farms or players, anything outside `mod/`.

## Tools
| tool | what |
|---|---|
| `read_file { path }` | read a file under the job folder |
| `list_files { dir? }` | list files |
| `write_file { path, content }` | write `mod/...` or `summary.json` (<= 16 KB a file, 128 KB for `mod/`); empty content removes a mod file (retires it) |
| `edit_file { path, old, new }` | replace one exact occurrence |
| `validate {}` | schema, meaning, and a quick play test on a farm copy; returns `ok`, `errors`, `warnings`, `numbers` |
| `preview {}` | the list the player will see: what is added, changed or retired, with names and numbers |

## Files
```
mod/mod.json                    { "format": 1, "title": { "en": "Moonlight Harvest", "bg": "Лунна жътва" } }
mod/content/crops/<id>.json     a crop                  mod/content/trees/<id>.json    a fruit tree
mod/content/recipes/<id>.json   a recipe                mod/content/animals/<id>.json  an animal breed
mod/content/decor/<id>.json     a decoration            mod/tuning.json                speed knobs
mod/look.json                   colours, sky, music     mod/text/letters.json          letters (<= 3)
mod/text/tips.json              tips (<= 10)
```
The file name is `<id>.json`. No other files. At most 12 new things per request and 60 on a farm, 40 content files,
16 KB a file and 128 KB in all. The mod's `title` is at most 40 characters in each language.

## Ids
`x_` then lowercase letters, digits and `_`, at most 32 characters in all: `x_moon_melon`. Never reuse an id from
`idsInUse` for something else (reusing a retired id of the same family brings it back).

## Text (every content file has `text`)
English: `name` (2-24 characters, Title Case) and optional `desc` (<= 80). Bulgarian: natural, warm, never a word-
for-word translation, following `docs/glossary-bg.md`. Fields: `name` (sentence case), `g` (gender `m`, `f`, `n` or
`pl`), `pl` (plural), `def` (definite: "лунният пъпеш"), `plDef` ("лунните пъпеши"); masculine also `count` (the form
after a number: "3 лунни пъпеша") and `defObj` ("лунния пъпеш"); optional `unit: [one, other]` for mass nouns ("буркан",
"буркана"), `desc`. Plain text only: no `<>{}`, links, "XP", em dashes; Bulgarian uses „…“ quotes and " – ".
```json
"text": {
  "en": { "name": "Moon Melon", "desc": "A pale melon that glows at dusk" },
  "bg": { "name": "Лунен пъпеш", "g": "m", "pl": "лунни пъпеши", "count": "лунни пъпеша", "def": "лунният пъпеш",
          "defObj": "лунния пъпеш", "plDef": "лунните пъпеши", "desc": "Блед пъпеш, който свети привечер" }
}
```

## Common fields
- `like`: an existing thing of the same family whose look is copied (see "Anchors").
- `hue`: the new main colour `#RRGGBB` (not too dark or too close to grass green).
- `unlock`: the level it unlocks at, 1-40 (above the farm level means "coming later").
- `value`: `"humble"` (-10 %), `"normal"`, or `"rich"` (+10 %).

## Crops
```json
{ "id": "x_moon_melon", "like": "watermelon", "growMin": 90, "yield": 3, "unlock": 14, "value": "normal",
  "season": "summer", "classes": ["fruit"], "hue": "#BFE3FF", "waterable": true, "text": { ... } }
```
`growMin`: 1 2 5 10 15 20 30 45 60 90 120 180 240 360 480 720 960 1440. `yield`: 2 or 3. `season`: spring summer
autumn winter. `classes`: 1-2 of grain root veg fruit cane flower fibre bean spice. Longer crops pay more per harvest
and less per hour.

## Fruit trees
```json
{ "id": "x_star_plum_tree", "like": "plum_tree", "cycleHours": 6, "unlock": 15, "value": "normal",
  "hue": "#7A4CC2", "leaf": "#3F7D3A",
  "fruit": { "id": "x_star_plum", "text": { ... } }, "text": { ... } }
```
`cycleHours`: 3 4 6 8 10 12 16. Anchors: fruit trees picked with a basket (the catalog marks them).

## Recipes
```json
{ "id": "x_melon_pie", "like": "pumpkin_pie", "building": "pie_oven", "minutes": 45, "unlock": 15,
  "inputs": { "x_moon_melon": 2, "flour": 1 }, "value": "normal", "hue": "#F2C14E",
  "text": { "en": { "name": "Melon Pie" },
            "bg": { "name": "Пай с пъпеш", "g": "m", "pl": "пайове с пъпеш", "count": "пая с пъпеш",
                    "def": "паят с пъпеш", "defObj": "пая с пъпеш", "plDef": "пайовете с пъпеш" } } }
```
`like` is a recipe of the same `building`. `minutes`: 5 10 15 20 30 45 60 90 120 180 240. `inputs`: 1-4 items, 1-10
each, existing items or items of this mod; never premium, relic or crate items, never itself. `unlock` is at least the
building's and every input's. Big inputs need a longer time (the machine must add at least 15 % to their value).

## Animals (a new breed living in an existing home)
```json
{ "id": "x_moon_hen", "like": "chicken", "coat": "#E9E4FF", "value": "normal",
  "product": { "id": "x_moon_egg", "hue": "#CFC6FF", "text": { ... } }, "text": { ... } }
```
Everything else (home, prices, feed, timing) comes from `like`. Anchors: animals sold in the shop, not bees.

## Decorations
```json
{ "id": "x_moon_lantern", "like": "lantern", "cost": 600, "hue": "#9FD3E8",
  "text": { "en": { "name": "Moon Lantern", "desc": "A soft blue light for quiet evenings" },
            "bg": { "name": "Лунен фенер", "g": "m", "pl": "лунни фенери", "count": "лунни фенера",
                    "def": "лунният фенер", "defObj": "лунния фенер", "plDef": "лунните фенери",
                    "desc": "Мека синя светлина за тихите вечери" } } }
```
`like`: a coin decoration sold in the shop. `cost`: a multiple of 10 from half to double the anchor's. New
decorations are for beauty only (no bonuses).

## tuning.json (all optional)
```json
{ "growTimeBp": 9000, "treeCycleBp": 10000, "craftTimeBp": 10000, "animalCycleBp": 10000,
  "crops": { "wheat": { "growMin": 2 } } }
```
`*Bp` = basis points of the normal time, 8000-12500 (9000 = 10 % faster). `crops.<id>.growMin`: a crop ladder step
from half to double that crop's time. Nothing else is tunable.

## look.json (all optional; only how the game looks and sounds)
```json
{ "palette": { "grass": "#7CC243", "leaf": "#4C9A3E", "skyTop": "#4FA8EE", "skyHorizon": "#D6F1FF", "barn": "#C8473A" },
  "sky": "pastel", "music": { "prefer": ["<a track id from docs/catalog/music.json>"] } }
```
`sky`: default golden pastel cool stormy. `music.prefer`: 1-3 track ids.

## text/letters.json and text/tips.json
```json
[ { "id": "x_letter_melons", "from": "mabel", "art": "melon",
    "en": { "title": "Melons by moonlight", "body": "Dear both, I hear something pale and round is growing on your farm..." },
    "bg": { "title": "Пъпеши под луната", "body": "Мили мои, чух, че на фермата ви расте нещо бледо и кръгло..." } } ]
```
`from`: hazel or a townsperson from `docs/catalog/npcs.json` (mabel ollie fern juniper reed pemberton pip rosie tom
lucia); `art`: from `letterArt`; title <= 40, body <= 600
characters. Letters speak to both farmers ("вие" in Bulgarian). Tips: `[{ "id": "x_tip_moon", "en": "...",
"bg": "..." }]`, <= 140 characters, speaking to one player ("ти").

## Error codes you may see
Schema: BAD_JSON UNKNOWN_FILE UNKNOWN_FIELD MISSING_FIELD BAD_TYPE BAD_ID ID_TAKEN TOO_BIG TOO_MANY BAD_ENUM
NOT_LADDER BAD_HEX BAD_TEXT UNSUPPORTED. Meaning: BAD_ANCHOR UNKNOWN_REF BAD_UNLOCK OUT_OF_RANGE ECON_BOUND CYCLE
NAME_TAKEN LOW_CONTRAST BG_FORMS CONTENT_CHECK. Play test: BOOT_THROW ACTION_REJECTED STATE_INVALID ECON_GUARD
RETIRE_FAILED TIMEOUT OOM. Look: NO_MODEL ICON_FAILED NAME_TOO_LONG. The `hint` says what to change.

## Removing something
Remove its file (write it with empty content). It is retired, never deleted: what the farm already has (crops in the ground, animals, decorations,
goods in the barn) keeps working and can be harvested, collected and sold, but nothing new can be bought, planted or
crafted. Writing the same id again in the same family brings it back.
