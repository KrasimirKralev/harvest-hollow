# Harvest Hollow: CC0 3D asset catalog

Researched, downloaded and verified on 2026-10-02. Everything lives in `assets-src/` (staging only; nothing is converted yet).

The staging folder is 362 MB. It holds 27 packs and 1,674 model files. Each pack folder keeps its original zip (or the original
Drive files when the author ships no zip) and its licence file. A machine-readable inventory of every model is in
`assets-src/inventory.json`. It records the format, triangle count, bounding box, animation clips, materials and textures of each model.
Rendered contact sheets for visual checking are in `docs/research/assets-img/`.

## 0. Summary

1. **The primary art family is Quaternius's flat-colour low-poly "Ultimate" series**, all CC0. No other free source covers a farm
   game this completely in one style: 18 plant types with 4 growth stages plus harvested and regrowing states, apple and orange trees
   that grow from sapling to fruiting and back to bare, 13 farm buildings, 10 medieval-village buildings and 34 props, 150
   nature models with autumn, snow and dead variants, 12 animals with 12–13 skeletal clips (including `Eating`), and animated
   human characters, including a ready-made `Farmer`. The look is flat material colours and no textures. That keeps rendering
   cheap on the Vega iGPU, and every part can be recoloured by material name.
2. **To look like FarmVille 2, use lighting, not textures.** FarmVille 2 is "bold, colorful and chunky", set in a 50's Americana
   world, on an isometric 3D board with many planar (card) assets
   ([Anna Parmentier, FV2 artist](http://annaparmentier.com/video-games/2015/10/farmville2/)). It was built in 3ds Max for
   Flash with Flare3D ([AWN](https://www.awn.com/news/zynga-taps-autodesk-farmville-2)). The flat Quaternius set gets there
   with a warm hemisphere light, a soft-shadowed sun, saturated material overrides and a painted ground texture. Section 5 has
   the details.
3. **Kenney is the secondary family, used for icons, tools, vehicles, seasonal items and VFX.** The Food Kit supplies product
   icons (milk carton, cheese, honey, pie, cake, strawberry and more). The Survival Kit supplies farm tools in base and upgraded
   versions. The Car Kit supplies a tractor and a delivery truck. The Holiday Kit covers winter events and the Particle Pack
   covers VFX sprites. Kenney items are mostly rendered to 2D icons, or are small enough that the style difference does not
   show.
4. **Real gaps:** there is no CC0 chicken, duck or goat with a skeleton that matches the style, and the Quaternius pig and sheep
   have only `Idle` and `Jump`. Section 3.4 sets out the plan: procedural motion for small animals, and a recoloured `Deer` rig
   with horns for the goat. The cartoon alternatives (Quaternius *Ultimate Monsters* chicken, Gobkit duck and goat) are
   downloaded in case the art direction goes cartoon.
5. **Pipeline:** FBX2glTF converted all 487 FBX files in the staging folder with 0 failures. It sets
   `metallicFactor 0.4`, which renders dark, so every converted material needs `metalness 0`. Then run
   `gltf-transform optimize` (meshopt, palette, join) for size and draw calls. Section 6 has the details.

## 1. How the assets were verified

- **Licence:** every pack folder holds the author's own licence file, and all say CC0 1.0. Three sources ship no licence file:
  vertexcat (licence on its itch page) and the two old Quaternius OpenGameArt zips (licence on the OGA page). For these a
  `LICENSE-SOURCE.txt` records the source URL and the licence exactly as the page shows it. **No CC-BY asset is used**, so no
  attribution line is needed. Crediting Quaternius and Kenney in an About screen is still a good courtesy.
- **Source:** every file came from the author's own channel: the quaternius.com pack page and its linked Google Drive folder,
  the author's itch.io page, kenney.nl, or the author's OpenGameArt upload. poly.pizza was used only to search. It mirrors
  Quaternius models as GLB, but it labels 16 Quaternius models "CC-BY 3.0" ([poly.pizza/u/Quaternius](https://poly.pizza/u/Quaternius)).
  Taking each file from the author's own page avoids that ambiguity.
- **Inventory:** `tools/inspect-models.mjs` parses every glTF/GLB, converts every FBX with FBX2glTF (which also proves the file
  converts), and counts OBJ faces. It records the following for each model:
  - triangle count
  - world-space bounding box at rest or bind pose
  - animation clip names and durations
  - joint count
  - material names
  - textures
- **Visual check:** `tools/contact-sheet.mjs` renders labelled thumbnails with headless Chrome and three.js. All candidate packs
  were rendered side by side before choosing:

| sheet | what it shows |
|---|---|
| `assets-img/01-crops-growth-stages.png` | 10 crops × 5 states, apple and orange trees, harvested states |
| `assets-img/02-farm-buildings-and-village.png` | farm buildings, medieval houses and mills, props |
| `assets-img/03-animals-and-avatars.png` | Ultimate Animated Animals, Farm Animal Pack, vertexcat, cartoon options, the 12 avatar outfits |
| `assets-img/04-small-animal-candidates.png` | every chicken, duck, goat and pet option found |
| `assets-img/05-nature-style-comparison.png` | Ultimate Nature (flat) vs Stylized Nature MegaKit (textured) vs Kenney Nature Kit |
| `assets-img/06-products-tools-props.png` | Kenney food and tools, Quaternius food and tools |
| `assets-img/07-kenney-extras-and-megakit-accents.png` | town kit, holiday kit, market, tractor and truck, MegaKit flowers and paths |
| `assets-img/08-cute-alternatives.png` | Ultimate Monsters animals, Gobkit, Kenney mini characters, Kenney cube pets (rejected) |

## 2. Packs downloaded

Size is the size on disk in `assets-src/`, including the original zip. Role: **P** = primary art family, **S** = secondary
(icons, tools, special items), **A** = alternative or accent, **R** = reference or optional.

| folder | source (licence) | contents | formats | size | role |
|---|---|---|---|---|---|
| `quaternius-ultimate-crops` | [quaternius.com/packs/ultimatecrops.html](https://quaternius.com/packs/ultimatecrops.html) → [Drive](https://drive.google.com/drive/folders/1uhbi-NWp7pwqOGtraBZurbphyxAvoABZ) (CC0, `License.txt`) | 102 models: 18 plant types (incl. Apple, Orange and Palm trees) × stages `_1`…`_4`, plus `_Crop` (the harvested item) for 17 of them and `_Harvested` (plant after a regrowing harvest) for 11, plus `Coconut_Half` | FBX + OBJ/MTL | 8.1 MB | **P** |
| `quaternius-farm-buildings` | [farmbuildings.html](https://quaternius.com/packs/farmbuildings.html) → [Drive](https://drive.google.com/drive/folders/1gdZ39vcLML_ULU5sHirkKQ-gEkk458Ak) (CC0) | 13: Barn, BigBarn, SmallBarn, OpenBarn, ChickenCoop, Silo, Silo_House, Windmill, TowerWindmill, WaterTower, Well, Fence, Fence2 | FBX + OBJ | 3.2 MB | **P** |
| `quaternius-medieval-village` | [medievalvillage.html](https://quaternius.com/packs/medievalvillage.html) → [Drive](https://drive.google.com/drive/folders/18T92VcNldHG0ugWo1u0hSJGDLua-n7o5) (CC0) | 10 buildings (House_1–4, Inn, Mill, Sawmill, Stable, Blacksmith, Bell_Tower) + 34 props (MarketStand_1/2, Cart, Hay, Barrel, Crate, Bags, Well, Gazebo, Bench, Cauldron, paths, fences…) | FBX | 3.0 MB | **P** |
| `quaternius-ultimate-nature` | [ultimatenature.html](https://quaternius.com/packs/ultimatenature.html) → [Drive](https://drive.google.com/drive/folders/1-Kl0L_Jg8awbh0S5T-z3zxh4mVlnxTpa) (CC0) | 150: Common/Birch/Pine/Willow/Palm trees, each in normal, Autumn, Snow, Dead and Dead_Snow; bushes, BushBerries, rocks (plain, moss, snow), flowers, grass, plants, stumps, logs, lilypad, corn, wheat, cactus | FBX | 6.6 MB | **P** |
| `quaternius-ultimate-animated-animals` | [ultimateanimatedanimals.html](https://quaternius.com/packs/ultimateanimatedanimals.html) → [Drive](https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk) (CC0) | 12 skinned animals: Cow, Bull, Horse, Horse_White, Donkey, Alpaca, Deer, Stag, ShibaInu, Husky, Fox, Wolf, 12–13 clips each | glTF (embedded buffers) | 54 MB | **P** |
| `quaternius-farm-animals` | [farmanimal.html](https://quaternius.com/packs/farmanimal.html) → [Drive](https://drive.google.com/drive/folders/1is1ax2V0mIEDS7BbbzBV_x2Pabya1dVJ) (CC0) | 7 skinned: Cow (Holstein), Horse, Pig, Sheep, Llama, Pug, Zebra | FBX | 9.0 MB | **P** (pig, sheep) |
| `quaternius-ultimate-modular-men` | [ultimatemodularcharacters.html](https://quaternius.com/packs/ultimatemodularcharacters.html) → [Drive](https://drive.google.com/drive/folders/1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX) (CC0) | 6 kept: **Farmer**, Worker, Casual_2, Casual_Hoodie, Adventurer, Beach (24 clips each) | glTF | 19 MB | **P** (avatar him) |
| `quaternius-ultimate-modular-women` | [ultimatemodularwomen.html](https://quaternius.com/packs/ultimatemodularwomen.html) → [Drive](https://drive.google.com/drive/folders/1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf) (CC0) | 6 kept: **Casual**, Medieval, Worker, Adventurer, Formal, Witch (24 clips each) | glTF | 19 MB | **P** (avatar her) |
| `quaternius-ultimate-food` | [ultimatefood.html](https://quaternius.com/packs/ultimatefood.html) → [Drive](https://drive.google.com/drive/folders/1zMfN7q9VU80M7mLAbBBJyY2OdoXslbl1) (CC0) | 103 food and kitchen items (Bread, Egg_Whole, Croissant, Jar_Large, Pancakes_Stack, Pepper, Eggplant, Turnip, CookingPot…) | FBX | 4.1 MB | S |
| `quaternius-survival` | [survival.html](https://quaternius.com/packs/survival.html) → [Drive](https://drive.google.com/drive/folders/1NKfC95GMWWJquy6rRzwFVkVDoZ_QP7K_) (CC0) | 53 (Shovel, Axe, Pot, Pan, WoodLog, Backpack, Tent, Bonfire… plus guns, which are not used) | FBX | 1.8 MB | S |
| `quaternius-ultimate-monsters` | [ultimatemonsters.html](https://quaternius.com/packs/ultimatemonsters.html) → [Drive](https://drive.google.com/drive/folders/18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C) (CC0) | 7 selected: Chicken, Cat, Dog, Pigeon, Birb (9 clips), Bunny, Frog (14 clips), + atlas | glTF + 1 PNG atlas | 4.0 MB | A (cartoon) |
| `quaternius-animal-pack-vol2` | [OGA: animated-animales-low-poly](https://opengameart.org/content/animated-animales-low-poly) (CC0 on page) | Cat, Dog (Idle, Walking), Eagle, Wolf, Piranha | FBX | 4.6 MB | R |
| `quaternius-animals-pack-2016` | [OGA: 5-low-poly-animals](https://opengameart.org/content/5-low-poly-animals) (CC0 on page) | Chick, bird, Fish, Red Fox, Whale (2016, one action each) | FBX | 1.6 MB | R |
| `quaternius-stylized-nature-megakit` | [stylizednaturemegakit.html](https://quaternius.com/packs/stylizednaturemegakit.html) → [itch, free Standard](https://quaternius.itch.io/stylized-nature-megakit) (CC0, `License_Standard.txt`) | Zip holds 68 of the 116 models in glTF, FBX and OBJ. **Extracted: only the 48 accent pieces**: flowers, grass, clover, fern, bushes, mushrooms, pebbles, stepping-stone paths, rocks. The trees stay in the zip. | glTF + PNG | 150 MB (zip 104) | A (accents) |
| `quaternius-universal-animation-library` | [universalanimationlibrary.html](https://quaternius.com/packs/universalanimationlibrary.html) → [itch, free Standard](https://quaternius.itch.io/universal-animation-library) (CC0) | 43 humanoid clips on a universal rig (Interact, PickUp_Table, Fixing_Kneeling, Push_Loop, Sitting_*, Dance_Loop, Walk/Jog/Sprint…) | GLB (+RM root-motion copy) | 31 MB | R |
| `kenney-food-kit` | [kenney.nl/assets/food-kit](https://kenney.nl/assets/food-kit) (CC0) | 200 food items | GLB (FBX/OBJ in zip) | 9.1 MB | **S** (icons) |
| `kenney-survival-kit` | [survival-kit](https://kenney.nl/assets/survival-kit) (CC0) | 80: tool-hoe, -shovel, -axe, -hammer, -pickaxe (+`-upgraded`), bucket, barrel, chest, workbench, resource-wood/-planks/-stone, signpost… | GLB | 4.0 MB | **S** |
| `kenney-fantasy-town-kit` | [fantasy-town-kit](https://kenney.nl/assets/fantasy-town-kit) (CC0) | 167 modular town pieces: walls and roofs, windmill + `blade`, watermill + `wheel`, stalls, cart, fences, hedges, fountain, lantern, banners, roads | GLB | 8.0 MB | S |
| `kenney-nature-kit` | [nature-kit](https://kenney.nl/assets/nature-kit) (CC0) | 329: terrain tiles (paths, rivers, cliffs), crops_dirtRow tiles, crop stages, fences, trees in 3 seasons, flowers, logs, bridges | GLB | 22 MB | A (needs a colour fix, §6) |
| `kenney-holiday-kit` | [holiday-kit](https://kenney.nl/assets/holiday-kit) (CC0) | 99: snowman, decorated trees, presents, lights, wreaths, sled, reindeer, gingerbread, log cabin pieces | GLB | 9.0 MB | S (winter event) |
| `kenney-mini-market` | [mini-market](https://kenney.nl/assets/mini-market) (CC0) | 20: display-fruit, display-bread, shopping-basket, cash-register, shelves | GLB | 2.5 MB | S |
| `kenney-car-kit` | [car-kit](https://kenney.nl/assets/car-kit) (CC0) | 50: **tractor**, tractor-shovel, truck, truck-flat, delivery + separate wheels | GLB | 11 MB | S |
| `kenney-mini-characters` | [mini-characters](https://kenney.nl/assets/mini-characters) (CC0) | 12 chibi characters, 32 clips (idle, walk, sprint, pick-up, interact-left/right, sit, emote-yes/no, holding-*) | GLB + colormap | 5.9 MB | A (avatars, cartoon) |
| `kenney-particle-pack` | [particle-pack](https://kenney.nl/assets/particle-pack) (CC0) | 81 transparent PNG sprites: star, spark, smoke, circle, magic, light, dirt, flare | PNG | 20 MB | S (VFX) |
| `gobkit-animal-pack-a` | [gobkit.itch.io/gobkit-free-animal-pack](https://gobkit.itch.io/gobkit-free-animal-pack) (CC0, `LICENSE.txt`) | 10 incl. **Duck**, Corgi | GLB, 1 baked track | 1.0 MB | A |
| `gobkit-animal-pack-b` | [gobkit-free-animal-pack-vol-2](https://gobkit.itch.io/gobkit-free-animal-pack-vol-2) (CC0) | 10 incl. **Goat**, Boar, Bee, Owl | GLB, 1 baked track | 1.6 MB | A |
| `vertexcat-farm-animals` | [vertexcat.itch.io/farm-animals-set](https://vertexcat.itch.io/farm-animals-set) (CC0 on page) | ChickenBrown, DuckWhite, Pig, SheepWhite, CowBlW, 536–896 tris, **static** (the FBX files have no skeleton) | FBX | 0.3 MB | **P** (chicken, duck, static) |

Quaternius states that all its packs are CC0 ([quaternius.com/license.html](https://quaternius.com/license.html)), and every
`License.txt` repeats "CC0 1.0 Universal". Each Kenney pack's `License.txt` says "Creative Commons Zero, CC0". Each Gobkit
`LICENSE.txt` says "CC0 1.0 Universal (Public Domain Dedication)".

## 3. Game need → best files

All paths are relative to `assets-src/`. *QC* = `quaternius-ultimate-crops/FBX/`, *FB* = `quaternius-farm-buildings/FBX/`,
*MV* = `quaternius-medieval-village/{Buildings,Props}/FBX/`, *UN* = `quaternius-ultimate-nature/FBX/`,
*UAA* = `quaternius-ultimate-animated-animals/glTF/`, *KF/KS/KT/KN/KH/KM/KC* = Kenney food, survival, town, nature, holiday,
market and car (`Models/GLB format/`, Kenney Nature uses `Models/GLTF format/`).

### 3.1 Crops (one plant model per stage; tris given for stage 4)

Ultimate Crops gives every crop `_1` (sprout) → `_2` → `_3` → `_4` (ripe), plus `_Crop`, the loose harvested item, which
works for drop animations and icons. Regrowing crops also have `_Harvested`, the plant once picked, which regrows to `_4`.
The plants are about 0.4–2 m tall. A 2 × 2 m plot should hold 1–4 instanced plants with random yaw and scale.

| crop | growth stages | harvested item / icon | notes |
|---|---|---|---|
| Wheat | QC `Wheat_1…4` (102 t) | QC `Wheat_Crop` (sheaf) | Tiny meshes: instance 6–9 per plot. Also UN `Wheat`, KN `crops_wheatStageA/B` |
| Corn | QC `Corn_1…4` (958 t) | QC `Corn_Crop`, KF `corn` | `Corn_Harvested` (stalk) exists |
| Carrot | QC `Carrot_1…4` (514 t) | QC `Carrot_Crop`, KF `carrot` | |
| Tomato (regrows) | QC `Tomato_1…4` (1.5k t) | QC `Tomato_Crop`, KF `tomato` | `Tomato_Harvested` = picked plant |
| Pumpkin | QC `Pumpkin_1…4` (2.9k t) | QC `Pumpkin_Crop`, KF `pumpkin` | Heaviest crop: use 1 per plot, or simplify |
| Strawberry (regrows) | QC `BushBerries_1…4` (891 t), recolour material `Berry` | KF `strawberry` | `BushBerries_Harvested`; also blueberry and raspberry by recolour |
| Watermelon | QC `Watermelon_1…4` (2.6k t) | QC `Watermelon_Crop`, KF `watermelon` | |
| Lettuce | QC `Lettuce_1…4` (1.4k t) | QC `Lettuce_Crop` | |
| Cabbage | QC `Lettuce_1…4` with a lighter blue-green `DarkGreen` | KF `cabbage` | |
| Beetroot | QC `Beet_1…4` (480 t) | QC `Beet_Crop`, KF `beet` | |
| Radish / turnip / onion | QC `Beet_*` or `Carrot_*` leaf stages, recoloured | KF `radish`, `onion`; Quaternius food `Turnip` | |
| Rice | QC `Rice_1…4` (1.9k t) | QC `Rice_Crop` | |
| Peppers / eggplant (regrow) | QC `Tomato_*`, recolour fruit material `Red` | Quaternius food `Pepper_Red/Green`, `Eggplant`; KF `paprika`, `eggplant` | |
| Mushrooms | QC `Mushroom_1…4` (1.8k t) | QC `Mushroom_Crop`, KF `mushroom` | Good "shade crop" under trees |
| Flowers (bouquets) | QC `Flower_1…4` (230 t; petals material `Cyan`) | QC `Flowers_Crop` | Recolour to make tulips, lavender and so on |
| Sunflower | **Gap:** QC `Flower_*` scaled ×2.5 with yellow petals and a brown centre, or procedural | — | §4 |
| Potato | **Gap:** leaf stages from QC `Beet_*` or `Lettuce_*` recoloured | procedural tuber | §4 |
| Bamboo, cactus, palm (exotic tier) | QC `Bamboo_1…4`, `Cactus_1…4`, `PalmTree_1…4` | `_Crop` of each, QC `Coconut_Half` | Late-game crops |
| Grapes (vineyard) | **Gap:** procedural trellis with grape clusters | KF `grapes` | |
| Cotton / flax (for a loom) | **Gap:** procedural, or QC `Flower_*` recoloured white | — | |
| Tilled soil | **Gap:** procedural plot mesh; or KN `crops_dirtRow`, `crops_dirtSingle` (colour fix) | — | Plot states: grass → plowed → seeded → watered (darker) |

### 3.2 Trees (fruit trees and wood)

| need | files | notes |
|---|---|---|
| Apple tree (grows, fruits, regrows) | QC `Apple_1…4` (sapling → fruiting, 1.6k t), `Apple_Harvested` (no fruit), `Apple_Crop` | Fruit is its own material (`DarkRed`), so tinting it gives cherry, plum and peach trees |
| Orange tree | QC `Orange_1…4`, `Orange_Harvested`, `Orange_Crop` | Fruit material `Orange`: tint yellow for lemon, light green for pear |
| Coconut palm | QC `PalmTree_1…4`, `PalmTree_Harvested`, `Coconut_Half` | |
| Decorative and wood trees | UN `CommonTree_1…5`, `BirchTree_1…5`, `PineTree_1…5`, `Willow_1…5`, `PalmTree_1…4` (1.7–2.9k t) | Each comes in `_Autumn_`, `_Snow_`, `_Dead_` and `_Dead_Snow_` variants. **This gives a seasons system for free.** |
| Chopped and wood items | UN `TreeStump`(`_Moss`,`_Snow`), `WoodLog`(`_Moss`,`_Snow`); KS `resource-wood`, `resource-planks`; KN `log_stack` | |
| Fruit icons | KF `apple`, `cherries`, `pear`, `lemon`, `orange`, `coconut-half`, `banana`, `pineapple` | |

### 3.3 Nature and terrain decoration

| need | files |
|---|---|
| Bushes, wild berries (foraging) | UN `Bush_1/2`, `BushBerries_1/2`, `Bush_Snow_1/2`; MegaKit `Bush_Common`, `Bush_Common_Flowers` |
| Flowers and grass tufts | UN `Flowers`, `Grass`, `Grass_2`, `Grass_Short`, `Plant_1…5`. MegaKit `Flower_3/4_Group/Single`, `Clover_1/2`, `Fern_1`, `Grass_Common_*`, `Grass_Wispy_*` are textured accents: use sparingly near paths and the house. |
| Rocks | UN `Rock_1…7`, `Rock_Moss_1…7`, `Rock_Snow_1…7` (70–300 t); MegaKit `Rock_Medium_1…3` |
| Paths | MegaKit `RockPath_Round/Square_*` and `Pebble_*` (stepping stones); MV `Path_Straight`, `Path_Square`; KN `ground_path*` and `path_*`; KT `road*` |
| Pond and water edge | UN `Lilypad`; KN `ground_river*`, `bridge_wood*`, `lily_large/small`; the water surface is procedural |
| Mushrooms (forage) | MegaKit `Mushroom_Common`, `Mushroom_Laetiporus`; KN `mushroom_red*`, `mushroom_tan*` |

### 3.4 Animals

Quaternius animals face **+Z**, are Y-up, and come at roughly 3–5× real size: scale by target height (§6.3). The UAA clips are
`Attack_Headbutt, Attack_Kick, Death, Eating, Gallop, Gallop_Jump, Idle, Idle_2, Idle_Headlow, Idle_HitReact1/2, Jump_toIdle, Walk`.
Dogs, foxes and wolves have `Attack` in place of the headbutt and kick clips, and `Idle_2_HeadLow`.

| animal | best file | clips used in game | alternatives / notes |
|---|---|---|---|
| Cow (milk) | UAA `Cow.gltf` (2.4k t, brown) | Idle, Idle_2, Eating (6 s), Walk, Idle_Headlow | Materials `Main`/`Main_Light`/`Muzzle` allow breed recolours. A black-and-white Holstein exists as `quaternius-farm-animals/FBX/Cow.fbx` (Idle, Walk, WalkSlow, Run, Jump, Death). |
| Horse | UAA `Horse.gltf`, `Horse_White.gltf` | Idle, Walk, Gallop, Eating | |
| Donkey | UAA `Donkey.gltf` | full set | Cute helper animal |
| Alpaca (premium wool) | UAA `Alpaca.gltf` | full set | Llama also in `quaternius-farm-animals` (Idle and Jump only) |
| Bull (breeding, prize) | UAA `Bull.gltf` | full set | |
| Sheep (wool) | `quaternius-farm-animals/FBX/Sheep.fbx` (610 t) | **Idle and Jump only** | Move by hopping with the `Jump` clip, or with a procedural bob over `Idle`. Alpaca is the fully animated wool animal. vertexcat `SheepWhite` is static. |
| Pig (truffles) | `quaternius-farm-animals/FBX/Pig.fbx` (562 t) | **Idle and Jump only** | Same hop approach. Gobkit `Boar` (cartoon). vertexcat `Pig` (static). |
| Chicken (eggs) | `vertexcat-farm-animals/ChickenBrown.fbx` (536 t, **static**, matches the style) | procedural peck, waddle and flap (§4) | Cartoon: `quaternius-ultimate-monsters/Blob/glTF/Chicken.gltf` (Idle, Walk, Bite_Front = peck, Dance, Yes, No, Jump, HitRecieve, Death) |
| Duck (feathers, eggs) | `vertexcat-farm-animals/DuckWhite.fbx` (672 t, static) | procedural | Gobkit `Duck.glb` (cartoon; one 120-frame track: idle 0–29, attack 30–59, dead 60–89, walk 90–119) |
| Goat (goat milk, cheese) | **No style-matched CC0 goat.** Recommended: UAA `Deer.gltf`, recolour `Main` to cream and `Main_Light` to white, and parent two small horn cones and a beard to the `Head` bone | the full UAA set incl. Eating | Gobkit `Goat.glb` (cartoon, 396 t) |
| Farm dog | UAA `ShibaInu.gltf` / `Husky.gltf` (12 clips) | Idle, Walk, Gallop, Eating | Quaternius Vol.2 `Dog.fbx` (Idle and Walking, untextured white) |
| Farm cat | Quaternius Vol.2 `Cat.fbx` (Idle and Walking, needs colouring), or UM `Cat.gltf` (cartoon) | | |
| Ambient birds, bees | UM `Pigeon`, `Birb` (cartoon); Gobkit `Bee`, `Owl`; or procedural | | |
| Wild visitors (optional) | UAA `Deer`, `Stag`, `Fox` | | |

### 3.5 Player avatars (2 players)

| | recommended | why | options |
|---|---|---|---|
| Him | `quaternius-ultimate-modular-men/Individual Characters/glTF/Farmer.gltf` (5.5k t, 1.86 m, 62 joints) | Straw hat, overalls, in style. 24 clips: `Idle, Idle_Neutral, Walk, Run, Run_Back/Left/Right, Interact (1.27 s), Wave, Roll, HitRecieve, Death` + weapon clips (unused). | Casual_2, Casual_Hoodie, Adventurer, Beach, Worker as **unlockable outfits** |
| Her | `quaternius-ultimate-modular-women/Individual Characters/glTF/Casual.gltf` (6.4k t, 1.85 m) | Same rig and clip set as the men, so one animation controller drives both | Medieval (dress, a farm-girl look), Formal, Adventurer, Witch (Halloween event), Worker |

- **Farm actions:** play `Interact` for plant, water, harvest, feed and collect, with a Kenney tool parented to the right-hand
  bone. Tools: KS `tool-hoe`, `tool-shovel`, `tool-axe`, `tool-hammer`, `tool-pickaxe`, `bucket`, each with an `-upgraded`
  variant that serves as a tool-upgrade visual. Use `Wave` to greet the partner.
- **Cartoon alternative:** Kenney Mini Characters are chibi, 0.77 m tall and about 750 tris, with 32 clips including
  `pick-up` and `interact-left/right`. They are cuter but clash with the realistic proportions of the animals.
- **Richer actions later:** Universal Animation Library clips (`PickUp_Table`, `Fixing_Kneeling`, `Push_Loop`, `Sitting_*`,
  `Dance_Loop`) can be retargeted onto the Quaternius rig with `SkeletonUtils.retargetClip`. That needs a bone-name map.

### 3.6 Buildings and production

| building (game role) | files | notes |
|---|---|---|
| Farmhouse (home, level-up visual) | MV `House_1`, `House_2` (teal roof), `House_3/4`, `Inn` (large) | For levels, swap House_4 → House_1 → House_2 → Inn, or tint the `RoofTiles` material. KT walls and roofs allow a custom modular house. |
| Barn (storage cap, upgrade path) | FB `SmallBarn` → `Barn` → `BigBarn` | **Ready-made 3-step upgrade.** Materials `DarkRed/LightRed/White/RoofBlack` can be tinted. |
| Chicken coop | FB `ChickenCoop` | |
| Cow shed, dairy | FB `OpenBarn` | |
| Stable | MV `Stable` | |
| Silo (feed storage) | FB `Silo`, `Silo_House` | |
| Mill (wheat → flour) | MV `Mill` (blades are a separate node, `Mill_Blades`); FB `Windmill`, `TowerWindmill` (separate `*_Blades` nodes) | Spin the blades node procedurally |
| Water | FB `Well`, `WaterTower`; MV `Well`; KT `watermill` + `wheel` | |
| Sawmill (logs → planks) | MV `Sawmill` + `Sawmill_saw` | |
| Workshop / tool smith | MV `Blacksmith`; KS `workbench`, `workbench-anvil`, `workbench-grind` | |
| Kitchen / bakery / jam house | MV `House_3`, `Inn` + KT `chimney` + smoke sprites; MV `Cauldron`; Quaternius food `CookingPot*` | Distinguish them with signboards made from KT `banner-*` |
| Market stall (sell goods) | MV `MarketStand_1/2`; KT `stall`, `stall-green`, `stall-red`, `stall-bench`; KM `display-fruit`, `display-bread`, `cash-register` | |
| Order board / deliveries | KS `signpost`; KC `truck`, `delivery`, `truck-flat` | The truck drives off with orders |
| Tractor (multi-plot harvest perk) | KC `tractor` (2.0k t), `tractor-shovel`, separate `wheel-tractor-*` | |
| Beehive, greenhouse, pens, troughs | **Gap → procedural** (§4); fences from FB `Fence/Fence2`, MV `Fence`, KT `fence*`, KN `fence_*` | |
| Village and decor | MV `Gazebo`, `Bench_1/2`, `Bell_Tower`, `Bonfire(_Lit)`; KT `fountain-*`, `lantern`, `hedge*`, `banner-*`, `planks`; KN `bridge_*`, `sign` | |

### 3.7 Products and goods (mostly as 2D icons rendered from 3D)

| item | file | | item | file |
|---|---|---|---|---|
| Milk | KF `carton` (or `carton-small`) | | Egg | KF `egg`, Quaternius food `Egg_Whole` |
| Cheese | KF `cheese`, `cheese-cut` | | Butter | **gap**: KF `cheese-cut` tinted pale yellow |
| Wool | **gap**: procedural fluffy ball | | Honey | KF `honey` |
| Bread | KF `loaf`, `loaf-round`, `bread`, Quaternius food `Bread` | | Flour | MV `Bags`, `Bag`, `Bag_Open` (sacks) |
| Pie | KF `pie` | | Cake / muffin / cupcake | KF `cake`, `muffin`, `cupcake`, `cookie` |
| Jam | Quaternius food `Jar_Large` (tint lid and fill) | | Juice | KF `soda-bottle`, `glass` (tinted) |
| Pancakes / waffle | KF `pancakes`, `waffle` | | Soup / stew / salad | KF `bowl-soup`, `pot-stew`, `salad` |
| Wood / planks / stone | KS `resource-wood`, `resource-planks`, `resource-stone` | | Hay bale | **gap**: procedural, or MV `Package_1` tinted straw (MV `Hay` is a small sheaf) |
| Crate / barrel / chest | MV `Crate`, `Barrel`; KS `chest`, `barrel`, `box-large` | | Coins, gems, XP star, seed packet | **gap**: procedural or sprite (§4) |

### 3.8 Seasonal and events, VFX

- **Winter:** KH `snowman`, `tree-decorated(-snow)`, `present-*`, `lights-*`, `wreath*`, `sled`, `reindeer`, `gingerbread-*`,
  `candy-cane-*`. UN `*_Snow_*` trees, rocks and bushes.
- **Autumn and Halloween:** UN `*_Autumn_*` trees, QC pumpkins, Women `Witch` outfit, KN `tree_*_fall`.
- **VFX sprites** (`kenney-particle-pack/PNG (Transparent)/`):

| sprite | use |
|---|---|
| `star_01…07`, `spark_*` | harvest sparkle, level-up |
| `smoke_01…10` | chimney, dust puff |
| `circle_*`, `light_*` | selection ring, glow |
| `dirt_*` | plowing |
| `magic_*` | fertiliser, boost |

## 4. Gaps that must be procedural (Three.js-generated)

Each gap is cheap to build and needs no download:

| gap | how to build it |
|---|---|
| Ground and terrain | Large plane with a painted grass texture (canvas-generated noise in 2–3 greens) plus vertex-colour variation; farm-zone border; soft hills at the edge. |
| Plot / tilled soil | Rounded box with furrow ridges (or a normal-mapped canvas texture), in 4 states: grass, plowed, seeded, watered (darker and wetter). Withered-crop tint if FarmVille-style withering is used; the design doc may choose not to wither, since this is a cosy co-op game. |
| Water | Pond and stream plane with an animated normal or scrolling texture, fresnel, and shoreline foam via depth or a distance texture. |
| Sky | Gradient sky dome, billboard clouds, day/night colour ramp for the sun and hemisphere light. |
| Small-animal motion (chicken, duck, also sheep and pig when walking) | Rigid-body motion: sinusoidal bob plus body roll for a waddle, a quick pitch-down for pecking, short hops, random-wander state machine. A 3–4 bone hand-made skeleton is optional. |
| Goat | UAA `Deer` + tint + two `ConeGeometry` horns and a beard parented to the `Head` bone. |
| Sunflower | `Flower_4` (petal material `Cyan` → yellow, `DarkGreen2` stem) scaled up, or a cylinder stem, two leaf planes and a disc with petal cards. |
| Potato | Leafy stages from `Beet`/`Lettuce` recoloured; the tuber icon is a lumpy brown icosahedron. |
| Grapevine | Posts and wire with clusters of instanced spheres. |
| Cotton | Small bushes with white puff spheres. |
| Lavender | `Flower_*` recoloured purple, clustered. |
| Beehive | Stacked boxes plus a roof (a Langstroth hive) and instanced bee sprites orbiting it. |
| Greenhouse | Transparent box with a frame. |
| Animal pens, feeding trough, water trough | Fence pieces plus box geometry. |
| Scarecrow | Crossed posts, a hay-coloured body and a hat; or the `Farmer` mesh posed statically. |
| Watering can, seed bag, basket | Watering can: cylinder, spout and handle. Seed bag: tinted MV `Bag`. Basket: KM `shopping-basket` or a lathe. |
| Coins, gems, XP stars | Gold coin cylinder, octahedron gem, extruded star shape for drops and the HUD. |
| Wool ball | Clustered spheres. |
| Floating text and progress rings | Sprites and canvas textures for the crop timer ring above a plot. |
| Partner presence | Name tag and coloured ring under each avatar, cursor ping, emote bubbles (sprite sheet). |
| Icons | Render every product, crop and building to a 128 px sprite atlas at build time with the `tools/contact-sheet.mjs` approach, so the HUD needs no separate 2D art. |

## 5. Art direction: why this family, and how it reaches FarmVille 2

The candidates differ in look and fit:

| candidate | look | fit for this game |
|---|---|---|
| Quaternius flat "Ultimate" series | Solid material colours; clean, chunky silhouettes | The only family that covers crops with stages, fruit trees, farm buildings, animals and farmer avatars together |
| Quaternius Stylized Nature MegaKit | Ghibli-style painted textures with alpha-cut leaves | Lush. But the free tier has no crops, buildings or animals, its trees are 7–17 units tall with 2K bark and normal textures and alpha overdraw (expensive on the Vega iGPU), and next to flat crops it looks like a different game |
| Kenney | Very simple flat shapes plus a palette texture | Bright and readable at icon size; too plain for hero 3D objects next to Quaternius |

Recommendations to make the flat family read as FarmVille 2 ("bold, colorful and chunky"):

1. **Material override at load:** set `metalness 0`, `roughness ≈ 0.85` and `flatShading` as authored. Boost saturation about
   10–20 % (HSL tweak per material name). The FBX-converted colours are muted, and the lettuce and tomato read almost brown
   without the boost.
2. **Lighting:** a warm key sun with soft PCF shadows (a 2048 shadow map limited to the visible farm), a sky/ground hemisphere
   light, and an `ACESFilmic` or `AgX` tone map. Optional: a cheap screen-space AO or a baked contact shadow blob under
   animals and buildings.
3. **Camera:** a fixed-pitch isometric-like perspective (about 45–55°), like FarmVille 2's isometric board. Zoom and rotate in
   90° steps.
4. **Chunky scale:** scale avatars and animals up 10–20 % relative to buildings, for toy-like readability.
5. **Optional stylised touches:** a subtle outline (inverted-hull) on interactive objects when hovered, and gentle wind sway on
   crops and trees in the vertex shader.
6. **Keep MegaKit to ground accents:** flower clumps, clover, stepping stones and mushrooms near paths, where textured detail
   adds lushness without clashing.

## 6. Technical notes for the pipeline

### 6.1 Formats and conversion (all tested on this machine)

| source | tool | verdict |
|---|---|---|
| FBX (Quaternius old packs, vertexcat, Quaternius food, survival, nature) | `npm i fbx2gltf` (bundles the FBX2glTF 0.9.7 Linux binary): `FBX2glTF --binary -i in.fbx -o out` | **Works on all FBX files here (0 failures).** Skinned FBX keep their clips, named `Armature\|Walk`; strip the prefix. **Gotcha:** every material gets `metallicFactor 0.4` and renders dark: force `metalness 0`. |
| OBJ + MTL (crops and farm buildings ship OBJ too) | `npx obj2gltf -i in.obj -o out.glb` | Works; materials come out with `metallic 0`. Fine for static props (same tris and colours as the FBX). |
| glTF with embedded base64 (UAA, modular characters, Ultimate Monsters) | `npx @gltf-transform/cli copy in.gltf out.glb` | Works: UM `Chicken.gltf` went from 213 KB to 135 KB, with no base64 decode at load. |
| Any GLB | `npx @gltf-transform/cli optimize in out.glb --compress meshopt --simplify false` | Works. UAA `Cow.gltf` went from 3.11 MB to 445 KB with all 13 clips intact. The client must register `MeshoptDecoder` (`three/examples/jsm/libs/meshopt_decoder.module.js`) on the GLTFLoader. **Always pass `--simplify false`** (the default simplify can damage hand-made low-poly meshes). |
| Draw calls | `--palette true` (merges flat-colour materials into a small palette texture) and `--join true` | Quaternius models have 1–10 materials each: crops 1–4, buildings 4–10, each one a draw call per instance. Palette + join reduces a building to about 1 call. **Do not palette or join models that need runtime tinting** (crops with fruit recolour, barns that change colour by level): recolour first, then optimize each variant. |

The recommended build step is `tools/build-assets.mjs`, not written yet. It would:

1. Convert FBX with FBX2glTF.
2. Fix the materials (metalness 0, optional per-asset tint and saturation table).
3. Normalise scale and pivot to the target sizes in 6.3, with the pivot at the base centre.
4. Run `gltf-transform` optimize (meshopt; palette and join for static props; webp for textures).
5. Write `public/assets/<category>/<id>.glb` and a manifest.

### 6.2 Axes and orientation

| asset group | up axis | forward | notes |
|---|---|---|---|
| All glTF/GLB, and FBX after FBX2glTF | Y | — | |
| Quaternius animals and characters | Y | +Z | Head bone at +Z |
| Kenney characters | Y | +Z | |
| Static props | Y | — | The pivot sits at the base (y = 0) for all Farm Buildings, Kenney Food, Survival and Market, about 80 % of Medieval Village and Ultimate Nature, and 35–40 % of Quaternius Food and Survival (loose items are centred). Kenney Nature tiles all sit at y = −0.05, a consistent tile thickness. **Crops:** Carrot and Beet stages put the root below y = 0 on purpose, so the pivot is the soil line: keep it. The `_Crop` items are centred. Normalise every pivot except crop plants at build time. |
| Gobkit GLBs | Y | — | Carry stray empty nodes of the other animals in the pack. Pack A (Duck, Corgi…) comes at about 350–700 units, pack B (Goat, Boar…) at about 3–7 units. |

### 6.3 Scale normalisation (file units vs. suggested in-game size, 1 unit = 1 m)

Scale each asset to a target height or length at build time; don't trust per-pack units. Suggested targets:

| asset | native size (x × y × z) | target | factor |
|---|---|---|---|
| UAA Cow | 2.3 × 4.6 × 8.1 | 1.5 m tall | ≈ 0.33 |
| UAA Horse | 1.4 × 4.9 × 5.7 | 1.7 m | ≈ 0.35 |
| UAA ShibaInu | 1.1 × 3.1 × 4.2 | 0.6 m | ≈ 0.2 |
| Farm Animal Sheep / Pig | 2.2 × 4.4 × 5.9 / 3.3 × 4.6 × 9.8 | 1.0 / 0.8 m tall | ≈ 0.23 / 0.17 |
| vertexcat Chicken / Duck | 0.5 × 0.7 × 0.6 / 0.4 × 0.6 × 0.65 | 0.45 m | ≈ 0.65 |
| Men / Women avatars | 1.68 × 1.86 × 0.4 | 1.8 m (scale up ×1.1 for chunkiness) | 1.0–1.1 |
| QC crops `_4` | 0.1–2 m tall | as authored ×0.8–1.0; trees ×1.3 | |
| FB Barn | 7.7 × 6.0 × 8.2 | as is (≈ 8 m) | 1.0 |
| MV House_1 | 2.1 × 3.4 × 2.7 | ≈ 7 m tall | ≈ 2.1 |
| MV props (Barrel 0.16 tall, Cart 0.8, MarketStand 1.05) | — | 0.9 m, 1.6 m, 2.6 m | ≈ 5.5, 2.0, 2.5 |
| UN CommonTree_1 | 1.9 × 2.5 × 2.8 | 5 m | ≈ 2 |
| KS tools | ~0.25 tall | 0.9 m | ≈ 3.5 |
| KC tractor | 1.3 × 1.6 × 2.2 | 2.6 m long | ≈ 1.2 |
| Kenney Nature and Town tiles | 1 × 1 | one grid cell | |

### 6.4 Pack-specific gotchas

- **Kenney Nature Kit GLBs** use `metallicFactor 1` and store **sRGB values as linear** `baseColorFactor` (for example leaves
  `0.16, 0.79, 0.67`). As shipped they render mint and beige (see sheet 05). Fix: metalness 0, and convert each colour with
  `color.convertSRGBToLinear()`. The other Kenney kits use `Textures/colormap.png` and render correctly. Their GLBs reference
  the PNG externally, so keep `Textures/` next to them.
- **Gobkit** packs every clip into one 120-frame track at 24 fps. Cut it with
  `THREE.AnimationUtils.subclip(clip, 'walk', 90, 119, 24)`. The colour is baked into the shared `Texture001.png` atlas.
  The material is a plain FBX-exported Lambert (no `KHR_materials_unlit`), so it lights like everything else.
- **Farm Animal Pack** (`quaternius-farm-animals`): only Cow, Horse and Zebra have `Walk`, `WalkSlow` and `Run`. Pig, Sheep,
  Llama and Pug have only `Idle` and `Jump`. This was confirmed in the FBX itself, not just in the conversion. The same files
  are on itch and Drive (byte-identical).
- **vertexcat** FBX files hold only an empty `Take 001` and no armature. The animated versions live in their `.blend` upload,
  which needs Blender (not installed; `apt install blender` would unlock it and the `.blend` sources of every pack).
- **Ultimate Monsters** glTF reference a 9 KB `Atlas_Monsters.png` colour atlas next to the file.
- **Universal Animation Library** uses its own humanoid rig, different from the Quaternius modular characters. Retargeting needs
  a bone map. Not needed for v1.
- **Triangle budget** for the Vega iGPU (shares the CPU's 15 W budget and runs hot): crops are 100–2.9k tris each, animals
  2–2.5k, avatars 5–6k, buildings 1–8k. Plan on instancing (`InstancedMesh` per crop stage), 1–4 plants per plot, about
  30 animals, and frustum culling. With that the whole farm stays well under 1.5 M triangles and about 300 draw calls. For
  pumpkin and watermelon fields, make an LOD with `gltf-transform simplify --ratio 0.5` (checked visually).

## 7. Evaluated and not used (and why)

| source | verdict |
|---|---|
| Kenney Cube Pets (cow, pig, chick…) | Blocky cube style, clashes; downloaded, rendered (sheet 08), then deleted. |
| Quaternius *Universal Base Characters* ([itch](https://quaternius.itch.io/universal-base-characters), Standard free, 122 MB) | Higher-quality base humans with 20 hairstyles, retargetable with UAL. Not downloaded (budget); the modular Farmer already fits. Revisit if avatars need customisation. |
| Quaternius *Fantasy Props MegaKit* (143 MB free tier) and *Medieval Village MegaKit* (153 MB) | Textured style that clashes with the flat family; over budget. The older flat Medieval Village Pack covers the same needs. |
| Quaternius *Stylized Tree Pack* and *Ultimate Stylized Nature* (textured) | Same textured-vs-flat clash; Ultimate Nature covers trees with seasons. |
| KayKit (Kay Lousberg, CC0, [GitHub org](https://github.com/KayKit-Game-Assets)) | No farm, crop or animal pack exists. Restaurant Bits, Medieval Hexagon, Furniture Bits, Forest Nature and Resource Bits overlap Kenney and Quaternius coverage in a third style. |
| OpenGameArt CDmir *Chicken (animated)* / *Rooster* | CC0 but Blender-only (`.blend` 11–13 MB, textured, realistic). Not usable without Blender, and off-style. |
| OpenGameArt *Sheep (rigged, textured and animated)* by p0ss | **CC-BY-SA 3.0**: rejected by the CC0-only rule. |
| poly.pizza mirrors | Convenient GLBs, but 16 Quaternius entries are labelled CC-BY 3.0 there. Use the author's pages instead (done). |
| Gobkit / Ultimate Monsters cartoon animals | Kept as alternatives (see 3.4). They suit a "cute cartoon" direction but clash with the realistic proportions of the UAA livestock. |

## 8. Tools written (in `tools/`)

| tool | use |
|---|---|
| `inspect-models.mjs` | `node tools/inspect-models.mjs <dir> --fbx2gltf <FBX2glTF> --tmp <dir> --json out.json` writes the per-model inventory. |
| `contact-sheet.mjs` | `node tools/contact-sheet.mjs list.json out.png --cols 8 --cell 200` renders thumbnails in headless Chrome (needs `three` in `node_modules` and puppeteer-core, by default from `~/wow-arena/node_modules`). It forces metalness 0 the way the game will. |
| `gdrive-folder.mjs` | `node tools/gdrive-folder.mjs <folderId> <outDir\|-> --skip=Blends,OBJ` recursively lists or downloads a public Google Drive folder (the Quaternius download path). |
| `itch-download.mjs` | `node tools/itch-download.mjs <itchPageUrl> <outDir\|-> [regex]` downloads free or pay-what-you-want itch.io files without an account. |

The FBX2glTF binary used: `npm i fbx2gltf` → `node_modules/fbx2gltf/bin/Linux/FBX2glTF` (glibc build, runs on Ubuntu 26.04).

## Appendix A: full per-pack model inventory

The appendix is generated from `assets-src/inventory.json`. Sizes are world-space bounding boxes in file units (Y up) at rest
or bind pose; "t" = triangles. For packs that ship each model as both FBX and OBJ, only the FBX row is listed.
