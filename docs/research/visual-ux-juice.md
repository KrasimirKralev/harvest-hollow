# Harvest Hollow — Visual design, UX and "juice" research + Three.js implementation guide

Task: visual-ux-juice. Written 2026-10-02 for the designer who builds the full game from these files.
Siblings: `assets-catalog.md` (CC0 assets, sounds), `tech-architecture.md` (server/netcode/stack).
This file owns: how the game LOOKS, how every action FEELS, the HUD/UI style, and how to render it fast on an
integrated AMD GPU.

Local evidence gathered for this file (keep, the designer should look at them):

- `docs/research/sources/farmville2-gdc2013-postmortem-transcript.txt` — machine transcript (local Parakeet ASR,
  minor word errors) of the GDC 2013 talk *"FarmVille 2 Postmortem: What Grew Wild & What Withered Away"* by
  Wright Bagwell (design director) and Mike McCarthy (creative director). Audio: https://archive.org/details/GDC2013Bagwell,
  session page: https://gdcvault.com/play/1018015/FarmVille-2-Postmortem-What-Grew . Timestamps below are `[mm:ss]` in that file.
- `docs/research/sources/fv2-reference/*.jpg` — 8 FarmVille 2 screenshots pulled from the FarmVille 2 fandom wiki
  (https://farmville2.fandom.com) for look reference: HUD, modal, crafting panel, water pins and growth stages, sparkle
  on ready fields, winter season skin, the early farm framed by forest and lake. Private reference only.

---

## 0. The decisions in one screen (read this first)

1. **Art direction = "the good life on an old-fashioned farm"**: bold, chunky, saturated, painterly-soft, grounded.
   No fantasy creatures/costumes — FV2 players explicitly rejected fantasy (GDC [28:20]–[29:35]).
2. **Camera = fixed-angle 3D diorama**: perspective, FOV 30°, yaw 45°, pitch eases 54° (far) → 36° (near) with zoom,
   mouse-wheel zoom, drag-pan, optional 90° rotation snaps (Q/E). Everything playable one-handed with the mouse
   (FV2 "one-handed principle", GDC [39:10]–[40:50]).
3. **The board itself is the status display**: ready things are bright, colorful and sway harder; finished/empty board
   looks calm and tidy, which tells you "it's fine to leave now" (GDC [49:35]–[50:25]).
4. **"Hover is the wind, touch is electric"**: crops bend away from BOTH players' cursors (two uniforms in the wind
   shader — a free co-op presence effect); every click gets a squash-pop + particles + sound inside one frame (GDC [52:05]).
5. **Tempo rule from FV2**: idle board animates on a 60 BPM grid (1000 ms beat), attention-grabbers on 120 BPM
   (500 ms), celebrations (level up, quest done) on 240 BPM (250 ms) (GDC [56:40]–[57:55]). All durations below snap to it.
6. **Harvest loop feel** (FV2 + Hay Day): click or drag-"paint" across plots → plant squash-pops → produce pops up and
   bounces → flies in an arc into the barn button → counter rolls up, "+XP" star floats. Drag-harvest plays a rising
   pentatonic pitch ladder.
7. **Renderer**: WebGLRenderer (three r186), MSAA on, NO post-processing, `NeutralToneMapping`, sRGB output, one
   directional sun + one hemisphere light, `MeshLambertMaterial` everywhere, static shadow map updated only when the
   world changes, blob shadows for anything that moves, a "footprint AO" texture for soft grounding.
8. **Instancing everywhere**: crops, grass tufts, fences, trees, fruit, rocks, particles, blob shadows. Target ≤150 draw
   calls, ≤300k triangles, ≤10 ms GPU at 1920×1200 on the Vega iGPU, 30 fps idle-throttle to keep the laptop cool.
9. **Crops are cheap cards where it helps**: FV2 itself rendered ALL crops and trees as 2D in a 3D world for performance
   (GDC [33:20]). Use crossed alpha-tested quads for tall/leafy crops, low-poly meshes for round produce.
10. **UI = HTML/CSS overlay** in a cartoon wood + parchment style (pure CSS gradients + inline SVG), fonts
    **Baloo 2** (titles) + **Fredoka** (UI/numbers), honey-wood frames, cream parchment, 3D "lip" pill buttons.
11. **Co-op presence is visual**: each player has a color (teal / coral), a ground cursor ring, an avatar with a name tag,
    emotes and pings; partner actions are visible and audible (quieter).
12. **Day/night is cosmetic, slow and never dark**: 40-minute sky cycle (or "always day" / "real clock" options); seasons
    as a palette/snow skin (FV2 shipped a winter snow skin); rain as an optional weather layer.

---

## 1. What FarmVille 2 actually looked and felt like (evidence)

### 1.1 Art direction

- "The FV2 universe is set in the 50's Americana; all the assets have a bold, colorful and chunky art style" — concept
  artist Anna Parmentier, http://annaparmentier.com/video-games/2015/10/farmville2/ . Her notes also say much of the
  board is *planar* elements and that 3D artists cut textures directly from the painted concept — i.e. painted textures
  carry most of the look, not lighting.
- Principal artist Tony Trujillo: the goal was to move the franchise "to a more sophisticated, 3D painterly feel"; he
  produced style guides for eyes, wood, vegetables and icons — http://www.tonytrujilloart.com/farmville2-1 .
- Pipeline: Autodesk 3ds Max + the Flare3D plug-in for Flash 11 / Stage3D — https://www.awn.com/news/zynga-taps-autodesk-farmville-2 ,
  https://gamesbeat.com/farmville-2-zynga/ .
- **Grounded, not fantasy.** After launch, Halloween-costumed animals flopped: "please stay away from fantasy, they love
  the fact that their farm looks and feels like an actual farm … the game was really about the good life on the farm …
  your animals never die, you're not using chemicals … everything's handcrafted … something your grandparents might
  have done as children on a farm" (GDC [28:20]–[29:35]).
- What the screenshots show (see `sources/fv2-reference/fv2-farm-overview.jpg`): saturated olive-to-lime grass with
  painted variation, chocolate soil plots with lighter raised rims, chunky honey-colored post-and-rail fences, a red barn
  with white trim, white clapboard farmhouse, lollipop fruit trees whose fruit is visible as colored dots (orange, red,
  plum-purple, pink blossom), crops grouped in big single-color blocks (orange pumpkins, yellow sunflowers, golden wheat,
  red tomatoes, purple berries). Soft, mostly baked lighting from the upper left; contact shadows under trees; no outlines.
- **Board framing** (`fv2-early-farm-forest-lake.jpg`): the farm sits in a clearing ringed by a dense pine/round-tree
  forest with sandstone boulders, a dirt road enters from the lower left, a lake with a wooden dock sits lower right.
  Interviews add hills, a town in the distance and people floating by in hot-air balloons on the loading screen
  (TechCrunch https://techcrunch.com/2012/09/05/zynga-finally-debuts-farmville-2-promises-to-keep-working-on-the-original-too ,
  GDC [31:15]–[31:40]). The forest frame hides the world edge at every zoom.
- **Seasons**: a winter skin puts snow on ground, rocks and pines (`fv2-winter-season-zoomed.jpg`).
- Measured from the screenshots (median pixel colors, JPEG so approximate): lawn #528221, meadow #436414, dirt road
  #B99D74, lake #478CBE, sandstone #B78B53, sunflower #E7C213, wheat #AF7D22, cherry blossom #CA74AB, plum tree
  #8C547F, bottom-bar cream #FDF1C9, button tan #E0C993. FV2's greens are darker/olive; we go brighter and warmer
  (section 3.2) because we render in real time with tone mapping and want the "lush" read.

### 1.2 Camera

- Fixed isometric-looking camera, no rotation; zoom in/out buttons and full-screen buttons on the right edge
  (`fv2-hud-full.jpg`). Zooming in also made the Flash game faster (fewer objects drawn).
- The team deliberately refused 3D camera controls: "requiring two hands to play your game is probably enough to
  actually turn most busy people away" (GDC [40:25]–[40:50]). The **one-handed principle**: the game must be fully
  playable with one hand on the mouse (GDC [39:10]).
- They had a "full farm photo" option for sharing (WWGDB, https://www.wwgdb.com/games/farmville_2).

### 1.3 Crops, trees and readiness

- **FV2 crops and trees are 2D**: "all of our crops are 2D, all of our trees are 2D. Going 3D can be heavier to develop …
  we wanted that GPU acceleration" (GDC [33:20]–[33:45]). Only animals, characters and buildings were true 3D.
- Growth reads as stages: tilled soil → sprouts → half-grown → full with colored produce (`fv2-water-pins-growth-stages.jpg`).
- Harvest: "crops will pop up off the farm plot, and bounce around near where they were planted"; collect by sweeping the
  mouse over them, or wait and they "automatically go to your Inventory"; plant/water/harvest can be painted by
  click-dragging across plots — https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/116-how-do-i-harvest-crops/ .
  GamesBeat: mouse-drag to "paint" seeds across plots; wheat and corn sway in the breeze; wind chimes animate and chime
  on hover; goats eat grass to clear land — https://gamesbeat.com/farmville-2-zynga/ .
- Readiness and "come back later": "you can look at your board really quickly and see that my animals are hungry, and I
  have a bunch of bright, colorful crops swaying in the breeze that need to be harvested. And after you feed your animals
  and harvest your crops, the board looks very subdued and everything looks tidied up … when you see those little sprouts
  growing out of the ground, you have to wait" (GDC [49:35]–[50:25]).
- Needs are shown with **blue teardrop map-pins** over plots/trees that need water and **white thought-cloud bubbles**
  with an icon over hungry animals (`fv2-water-pins-growth-stages.jpg`, `fv2-hud-full.jpg`).
- Fertilized plots in FarmVille show a **sparkle** animation and visibly larger crops
  (https://farmville.fandom.com/wiki/Crop_Fertilizer); late-game FV2 fields glitter with yellow sparkles
  (`fv2-ready-crop-sparkle-late-game.jpg`).
- Lesson from a failed pillar, **"everything levels up"** (bigger pumpkins, a tree that grows with your tenure): it made
  players stick to one item instead of exploring, turned every click into a decision, and the growth was too subtle to
  notice while multiplying art states ("an art explosion") (GDC [21:15]–[24:35]). Visual consequence for us: if anything
  grows over time, make it **few, big, discrete** steps, never subtle continuous growth.

### 1.4 Animals and avatar

- 3D was chosen *for the animals*: "animals that move as sprites are not very convincing … we would need simple animal
  AI. FarmVille didn't have any AI" (GDC [19:35]–[20:25]); "things moving, animals running through the flowers, ducks
  splashing in the water" ([18:45]).
- Animals grow "from babies to adults" (GamesBeat); prized ("Blue Ribbon") animals are a little larger
  (https://gamelytic.com/farmville-2-prized-animal-guide/); "they do this little jig after you feed them", and their eyes
  bulge comically when picked up; "your character will sprint around your farm carrying out your orders while efficiently
  jumping over fences"; kites and wind chimes sway; "catchy, upbeat country music" (WWGDB).
- Original FarmVille made the avatar walk to every plot before acting, which became "rather time consuming" as farms
  grew — https://www.supercheats.com/guides/farmville/your-farmer . FV2 kept the avatar but made it sprint. **We go
  further: the action happens instantly; the avatar is cosmetic and catches up** (section 3.9).

### 1.5 Interaction principles ("bringing the board to life", GDC [50:50]–[53:45])

- "Make the virtual feel real … treat your mouse hover like the wind … when you touch something you want it to be
  electric, it just springs to life. And don't forget about audio … even at a low level it gives you that additional
  feedback." "If your game is a lot of fun to click on, it matters less why you're playing."
- "Establish a game rhythm": the board's general temperature is **60 BPM** ("crops sway, and things generally hit on
  that kind of slow rhythm"); to grab attention for a moment (things to sweep, the mailbox) **120 BPM**; reserve **240 BPM**,
  "a really hectic, ecstatic pace", for level-up and quest completion, "you'll see it in particle effects". The FV2 theme
  song is 60 BPM (GDC [55:50]–[57:55]).
- Frame rate is a feature: "we all love those creamy frame rates"; 80 % of FarmVille revenue came from players at
  15 fps or better; FV2 shipped a software-render fallback that "turns off a few bells and whistles" (GDC [33:45]–[36:15]).
  For us: quality tiers + auto-downgrade (section 4.2).
- Creative pillars that shipped: *your farm is alive*, *your farm is an ecosystem*, *you're part of a living community*
  (GDC [27:30]). Player motivations found in research: relax, create and nurture, be with friends (GDC [10:00]).

### 1.6 HUD and panels (from the screenshots)

`fv2-hud-full.jpg`:

| Region | FV2 content | Style |
|---|---|---|
| Top-left | Coins pill, Farm Bucks pill, level star (purple star with level number) + XP count with purple fill | Cream rounded pills, big icon overlapping the pill's left end, small square "+" at the right end |
| Top-right | 4 production resources (feed, water drop, fertilizer, fuel), each a pill with "+" | Same pill style |
| Left column | Round quest-giver portraits with a small item badge, a "11 days left" speech label | Parchment ring portraits |
| Right edge | Small square buttons: full screen, sound, zoom in, zoom out | Beige rounded squares |
| Bottom bar | Friends strip (social), bottom-right 3 big buttons: tools/move, market (cornucopia), storage/gift | Cream/gold panel |
| In world | White thought clouds over animals, blue teardrop pins over plots, "$" wooden signposts on land for sale, teal outline for expansion area | |

`fv2-modal-popup.jpg`, `fv2-crafting-panel.jpg`: dark-brown wooden frame around cream parchment, title in heavy
rounded type (yellow-white fill, dark-brown outline), subtitle white with shadow, item cards slightly rotated like pinned
paper, green call-to-action pill with white outlined text, square close button overhanging the top-right corner, orange
progress bar with "4/10" label, event panels shaped like the building they belong to (diegetic frames).

FarmVille 2's water was "energy": 1 water every 3 minutes (https://farmville2.fandom.com/wiki/Water ; Gamezebo's review
counts it as the main gripe, https://www.gamezebo.com/reviews/farmville-2-review/). The owner wants no energy paywall —
mechanics doc decides, but visually **never show a blocking energy meter**.

---

## 2. Lessons from the modern cozy games ("juice" catalogue)

### 2.1 Hay Day (Supercell)

- Art: a "1950s-esque" style with "funny and quirky humour", deliberately not generic cute; a world where "nothing bad ever
  really happens" (bacon comes from "a bespoke pig sauna"); touch controls for simple actions were the moment "the pieces
  came together" — http://www.pocketgamer.biz/interview/79024/supercell-looking-back-10-years-of-hay-day-part-one/ .
- Harvest: tap the field, a **sickle** appears, sweep it across all ready fields; same sweep gesture for feeding and
  collecting — https://www.supercheats.com/hay-day/walkthrough/harvesting ; feed is an icon you drag over each chicken.
- Production buildings show a queue of slots with per-job timers — https://hayday.fandom.com/wiki/Production_Buildings .
- XP = blue stars filling a bar at the top; tapping the level star previews the next unlocks — https://hayday.fandom.com/wiki/Experience .
- Panels (local screenshot study): honey-yellow outer frame, cream inner card, title on a wooden plank banner in white
  outlined condensed type, round red close button and round green "?" overhanging the corners, fat pill buttons with a
  darker "lip" underneath, requirement counters "60/133" where the missing part is red-orange and the met part white.
  Sampled colors: cream #FEF8DE, honey #F1B844, plank tan #D8B983, button yellow #F2DA7E with lip #EAB951, close red
  #D74C4E, green #79C34E, shortfall red-orange #DD6F4A.
- Ten-year lesson: social features (the Derby) kept players longer than ever more content; polish over novelty —
  https://mobilegamer.biz/what-supercells-hay-day-team-learned-from-ten-years-of-updates/ .

### 2.2 Township (Playrix)

- HUD (local screenshot study): top-left blue level star + XP bar and population; top-right coins and cash with green "+"
  buttons; bottom-right a big primary "build" (hard hat) button with transport buttons beside it; bottom-left friends
  and "move/edit"; event widgets stacked on the right edge; "$" markers over buildings with income ready.
- Uses tool icons instead of text: sickle to harvest, milking device on a cow (Playrix usability review,
  https://medium.com/@aarthi.design/playrixs-township-6418f4ce319d — summary via search, page is paywalled).

### 2.3 Stardew Valley

- Crop growth = discrete sprite stages, one per day — https://stardewvalleywiki.com/Crops .
- The base game's ready signal is subtle (the produce appears, a green "+" on hover); players complain and the most
  popular mods add **harvest bubbles** above ready crops — https://steamcommunity.com/app/413150/discussions/0/4509877893257846983/ ,
  https://www.nexusmods.com/stardewvalley/mods/17761 . Lesson: readiness must be loud at a glance.
- Day = 6am–2am, 0.7 real s per game minute (~14 real minutes per day); dusk falls 6–8 pm depending on season; it gets
  dark gradually, lamps light up, the music changes — https://stardewvalleywiki.com/Day_Cycle .
- Rain waters all outdoor crops — https://hardcoregamer.com/stardew-valley/all-weather-guide/ .
- Music: banjo, marimba, electric piano, call-and-response, swing, major/mixolydian, instruments drop out to "float" —
  https://www.haakondavidsen.com/post/tutorial-how-to-write-stardew-valley-music .

### 2.4 Animal Crossing: New Horizons

- Rounded type (FOT-Rodin; Seurat for dialogue/UI) chosen to feel gentle, soft corners everywhere, pale mint dialogue
  bubbles that wobble — https://fontsinuse.com/uses/51354/animal-crossing-new-horizons ,
  https://codepen.io/andymerskin/pen/NWqQydM (a CSS/JS recreation of the wobbly bubble — good reference for our tooltips).
- Hourly music synced to the real clock; cozy games build refuge through sonic consistency and routine —
  https://stars.library.ucf.edu/tpms/2026/saturday/7/ . Real-clock time also locks people out of content when they can
  only play at fixed hours — the reason we default to a game-time cycle (section 3.10).

### 2.5 Townscaper, Islanders, Tiny Glade (diorama "juice")

- They turn simple clicks into lovely structures; the reward is the world reacting — https://www.pixelatedplaygrounds.com/bookclub/2024/10/21/townscaper-and-tiny-glade .
- Townscaper outlines are enlarged back-face hulls (cheap, no engine support needed) — https://news.ycombinator.com/item?id=29074015 .
  We use that only for the selected object (section 4.14).
- Islanders: crisp low-poly, flat colors/gradients, relaxing sound — https://handwiki.org/wiki/Software:Islanders_(video_game) .
- Tiny Glade: real-time GI, ray marching, GPU-driven rendering (https://www.youtube.com/watch?v=jusWW2pPnA0 ,
  https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games) — **not
  affordable on a Vega iGPU in WebGL**. Take the art lessons only: warm low sun, fluffy tree canopies, soft contact
  shading, things that pop into place with a bounce.

### 2.6 General juice references

- *Juice It or Lose It* (Jonasson & Purho, 2012): a grey Breakout made joyful only by tweening, squash-and-stretch,
  particles, sound — https://www.gdcvault.com/play/1016487/juice-it-or-lose .
- *The Art of Screenshake* (Nijman, 2013): ~30 feel tricks in gameplay/visual/screen categories —
  http://notebook.maryrosecook.com/Theartofscreenshake,JanWillemNijman.html . Screen shake is for action games; **we use
  none** except a 2 px nudge on level-up (and none with reduced motion).
- Web game-feel numbers (https://valdemird.com/blog/game-feel-on-the-web/): squash ~420 ms with
  `cubic-bezier(0.22,1,0.36,1)`, overshoot spring `cubic-bezier(0.34,1.56,0.64,1)`, keyframes 0.88 → (1.05, 0.92) →
  (0.99, 1.02) → 1 anchored at the bottom; particle bursts of ~14 spread evenly with jitter; synth blips 70–120 ms,
  12 ms attack, ±4 % pitch variation; streaks escalate and **decay after 1600 ms** of inactivity; everything respects
  `prefers-reduced-motion`.

---

## 3. Harvest Hollow visual direction (our decisions)

### 3.1 Visual pillars

1. **Alive** — something gently moves everywhere at 60 BPM (crops, grass tufts, water, smoke, butterflies).
2. **Readable** — from the farthest zoom you can tell what needs you: ready = bright + sparkle + stronger sway; need =
   bubble icon; done = calm.
3. **Electric to touch** — every hover answers (bend, highlight), every click answers within one frame.
4. **Grounded wholesome farm** — real crops, real animals, handmade wood, no fantasy, no dark/cruel imagery.
5. **Two of us** — you can always see where your partner is, what they hover, and celebrate together.

### 3.2 World palette (albedo tokens, sRGB hex; tune in the look-dev scene)

| Token | Hex | Use |
|---|---|---|
| grass-lit | #7CC243 | main lawn |
| grass-var | #66B23A | noise variation / mowed stripes |
| grass-meadow | #4F9A33 | wild meadow outside fences |
| grass-shade | #3F7F2C | under forest edge |
| soil-tilled | #7A4A2A | plot surface |
| soil-rim | #9B6A3E | raised plot rim, furrow tops |
| soil-wet | #5A3420 | watered plot (if watering exists) |
| dirt-path | #D8B98A | road and worn paths |
| sand | #EED9A6 | lake beach |
| sandstone | #C99A62 | boulders (FV2 #B78B53, lightened) |
| stone-grey | #A7A39A | well, walls |
| water-shallow | #6FD3E6 | lake edge |
| water-deep | #2E8FC9 | lake middle |
| foam | #FFFFFF | shoreline foam |
| leaf-dark | #2F6E3A | pines, forest wall |
| leaf-mid | #4C9A3E | round trees |
| leaf-light | #8FD05A | canopy highlights, spring |
| trunk | #8A5A35 | trunks, branches |
| fence-wood | #D9A15B | fences, crates (shade #A8713A) |
| barn-red | #C8473A | barn, accents |
| roof-brown | #7A4B3A | shingles |
| trim-white | #FFF8EC | trims, farmhouse |
| sky-top | #4FA8EE | sky dome zenith |
| sky-horizon | #D6F1FF | horizon, fog color by day |
| sun-light | #FFF1D6 | directional light color |
| hemi-sky | #CFE8FF | hemisphere sky color |
| hemi-ground | #8C7A4B | hemisphere ground bounce |

**Crop ready colors must be unique hues** so fields read as color blocks from far zoom (FV2 did exactly this):
wheat #E8B84A, corn #F2D04B + green, carrot #F08A2C, tomato #E8463A, pumpkin #F2852A (larger, round), strawberry
#E83A55, blueberry #4D5BD6, eggplant #7B4BB0, sunflower #FFD21F + brown center, cabbage #9BD86A, potato #C9A06A
(leaves #5DA544 with white flowers), lavender #A98BE0, cotton #FFFFFF, watermelon #3E8E3A stripes.
Avoid two ready crops sharing a hue in the same unlock tier.

### 3.3 Lighting (starting values, three r186, physically based light units)

- Sun: `DirectionalLight(#FFF1D6, 2.8)` from screen upper-left and slightly toward the camera (classic illustration
  light, matches FV2): with the camera at yaw 45° (camera on the +X+Z side looking at the origin), sun offset from the
  target = `(-50, 70, 20)`.
- Fill: `HemisphereLight(sky #CFE8FF, ground #8C7A4B, 1.3)`. Because shadows only block the sun, shaded areas take the
  blue-ish sky fill and read cool against warm sunlit areas — free "painterly" color temperature contrast.
- Shadows: soft and light: `shadow.intensity = 0.6`, `shadow.radius = 3` (section 4.8).
- Exposure 1.0 with `NeutralToneMapping`.
- Optional "wrap" lighting (half-Lambert) for a softer terminator on round objects: inject
  `dotNL = dotNL * 0.5 + 0.5` style softening via `onBeforeCompile` on the `lights_lambert_pars_fragment` only if the look-dev
  scene shows harsh dark sides; FV2's painted textures carried the shading, ours need the hemisphere light to.

### 3.4 Camera spec

| Parameter | Value | Why |
|---|---|---|
| Type | PerspectiveCamera, vertical FOV 30° | low FOV ≈ iso look but keeps depth cues and lets the tilt show sky when zoomed in |
| Yaw | 45° default; Q/E (and two corner buttons) snap ±90° with 400 ms `inOutCubic` | 3D buildings occlude; FV2 had no rotation (their GDC rule) — we keep rotation optional and one-click |
| Pitch | eased with zoom: 54° at max distance → 36° at min | far = map-like overview, near = cozy diorama with horizon |
| Distance | min 18, default 55, max 90 (world units = meters) | at FOV 30 and 16:10 the visible ground width ≈ 0.86 × distance → ~15 m (animal faces) to ~77 m (whole farm) |
| Zoom input | wheel: distance *= 1.12 per notch, exponential damping `x += (goal - x) * (1 - exp(-12 dt))` | smooth, frame-rate independent |
| Pan | left-drag starting on empty ground, right-drag or middle-drag anywhere, WASD/arrow keys, edge-scroll OFF by default | drag starting on a plot = paint, so the two never conflict |
| Bounds | clamp target to farm rect + 6 m; the forest frame + fog hides the world edge | never see the void |
| Focus | double-click on an object eases the target there (500 ms `outCubic`) | |
| Photo mode | button hides UI, renders at 2× resolution, downloads PNG via `canvas.toBlob` | FV2 had "full farm photo"; couples love screenshots |

### 3.5 The board (terrain and framing)

- Flat, rectangular playable clearing (keeps picking and placement trivial: y = 0 everywhere on the farm). Everything
  outside is decorative: gentle hills, the forest wall (instanced pines + round trees + sandstone boulders), a dirt road
  entering from the lower left, a lake lower right with a dock, ducks and lily pads, a distant village silhouette and a
  windmill on a far hill, an occasional hot-air balloon drifting across the sky (FV2 loading-screen nod).
- Locked expansion land: overgrown meadow with a wooden "For sale" signpost (FV2 used "$" signs), slightly desaturated
  (`saturate 0.75` via a ground mask) so the unlocked farm pops.
- Ground detail: vertex colors (lawn/meadow/path masks) × a small tiling grass-detail texture; 1.5–3k instanced grass
  tufts and flower clumps around edges, fences and trees (never on plots or paths); clover patches; cloud shadows sliding
  over the ground (section 4.7).

### 3.6 Crops: stages and archetypes

Every crop has **5 visual states** (plus 1 optional):

| State | Look | Motion |
|---|---|---|
| 0 Tilled | raised soil mound with 2–3 furrows, rim lighter | none |
| 1 Seeded | darker soil, tiny seed specks / mini dimples | none; a dust puff when planted |
| 2 Sprout | 2-leaf sprouts, 15 % height | sway amp 0.3 |
| 3 Growing | foliage at 55 % height, no produce, crop silhouette recognizable | sway amp 0.7 |
| 4 Ready | full size, saturated produce visible, +8 % scale, emissive lift 0.08, golden sparkle twinkles | sway amp 1.6 (the "swaying in the breeze" call to action) |
| 5 Wilted (only if the mechanics doc keeps withering) | drooped, desaturated to #8C7A55, no sparkle | sway amp 0.2 |

- Stage change animation (makes waiting feel alive): when a plot advances, each plant pops in a staggered ripple
  (random 0–400 ms delay per plant) — scale 0.82 → 1.06 → 1.0 over 300 ms (`outBack`), 2–3 leaf particles, no sound
  unless the camera is close (avoid a cacophony of 40 plots).
- 4–9 plants per plot in a jittered grid (seeded by plot id, stable across reloads and between both players).
- Archetypes (assets can be CC0 meshes or our own cards):
  - **Tall grass** (wheat, rice, corn, oats): 2–3 crossed alpha-tested quads, strong sway.
  - **Bushy** (tomato, strawberry, blueberry, eggplant, cotton, lavender): low leafy mesh/cards + instanced produce spheres.
  - **Ground fruit** (pumpkin, watermelon, cabbage): low-poly mesh, big readable silhouettes, minimal sway (stiffness 3).
  - **Root** (carrot, potato, onion, beet): leaf tufts only, produce shown by a sliver of colored top; on harvest the
    root is pulled out with a 150 ms upward yank and a dirt puff (very satisfying).
  - **Flower** (sunflower, tulip, lavender): tall stem + head that slowly turns toward the sun direction (vertex shader).

### 3.7 Trees, animals, buildings, life

- **Fruit trees** (apple red #E23B3B, orange #F59A23, peach #F7A989, lemon #F5D63B, plum #8C4FA6, cherry blossom
  #F4B6CF → cherries #C81E3C): lollipop canopies (fluffy-tree technique, section 4.5), stages: sapling → young →
  blossom (white/pink petals drifting) → green fruit → ripe fruit + sparkles. Harvest: tree shakes (damped spring
  rotation ±6°, 600 ms), fruit drops with a bounce, leaves flutter down. Decorative trees: pine, oak, birch, maple
  (autumn red), willow by the lake.
- **Animals**: chicken, cow, sheep, pig, goat, duck, horse, rabbit. Babies at 0.6 scale with a bigger head ratio.
  Simple wandering AI in their pen (walk 0.6 m/s, idle 2–6 s: graze, look around, sit, scratch, sleep at night).
  Hungry: white thought cloud with the feed icon. Fed: eat animation 1.5 s → happy hop "jig" (two 250 ms hops) +
  3 heart particles. Product ready: item bubble (egg, milk pail, wool) bobbing at 120 BPM. Picked up/moved: legs dangle,
  eyes widen (FV2 joke).
- **Buildings**: farmhouse (chimney smoke, windows glow at night), barn (storage; doors bump when items fly in),
  silo, coop, stable, kitchen/workshop (crafting; steam puffs while working), roadside market stand (FV2), well,
  windmill (blades rotate), beehive (bees), mailbox (flag up + wiggle at 120 BPM when something arrives).
- **Ambient life that reacts to the cursor**: birds on fences fly off when a cursor comes within 2 m and land again
  later; butterflies over flowers; bees around hives/flowers; ducks on the lake; a fish jump + ripple every ~40 s;
  wind chimes on the porch chime on hover (FV2); laundry line flaps.

### 3.8 Action feedback recipes (exact, snap to the 60/120/240 BPM grid)

Principle: **the action resolves on the client in the same frame** (optimistic), the server confirms (LAN, ~1–5 ms);
if the server rejects (partner got there first), revert gently with a partner-colored "poof" and a friendly toast
("Mila got it!") — never an error sound.

| Action | Sequence |
|---|---|
| Hover a plot/object | 0 ms: cursor-push bend (shader), hover outline/emissive +0.06; after 250 ms: tooltip (name, stage, time left + mini bar) |
| Plant (click or paint) | soil squash 0.92 → 1.04 → 1 (250 ms `outBack`), 6 dirt particles, seed "tick" sound, pitch ladder while painting |
| Harvest a plot | plants pop up (scale y 1.25, 120 ms) then vanish; produce icon (3D mini mesh) launches upward 1.2 m with random XZ spread, bounces once (FV2), after 600 ms auto-flies along an arc into the barn HUD button (450 ms `inCubic`); "+N XP" blue star floats up 48 px over 900 ms; pluck sound + pitch ladder |
| Drag-harvest a field | each plot in path triggers the harvest sequence; sound steps up a major pentatonic scale (C D E G A c d e g a …), streak decays after 1600 ms; every 10th plot adds a small sparkle burst |
| Feed animal | feed icon flies to the animal (250 ms), munch sound, eat 1.5 s, jig + hearts |
| Collect product | product pops out with a bounce, flies to barn; animal does a happy idle |
| Shake tree | spring shake 600 ms, fruit drop bounce, leaves, fruit fly to barn |
| Craft start / done | building puffs steam/smoke while working (60 BPM puffs); done = item bubble + 120 BPM bob + a chime |
| Coins earned | coin icons (up to 8, staggered 40 ms) fly to the coin pill; pill bumps (scale 1.15, 220 ms `outBack`); number rolls over 400 ms |
| Level up (farm) | 240 BPM: 4 pulses of confetti at 250 ms, radial light rays behind a big star, banner drops from the top (300 ms `outBack`), fanfare; both players see it |
| Achievement | ribbon rosette slides in from the right edge, swings like a hanging ribbon (damped 2 s), "ding"; goes onto the Ribbon Wall in the farmhouse |
| Placement (build mode) | grid lines fade in on the ground (250 ms), ghost follows the cursor with 20/s damping, green/red tint; place = drop from 0.6 m with squash on landing, dust ring, wood "thunk" |
| Invalid action | object shakes ±4 px twice (200 ms), soft "bonk", tooltip says why — no red flashing |

Idle "tidy" state: after everything is harvested and fed, the board has no bubbles, no sparkles, low sway — the calm
signal FV2 used to say "come back later".

### 3.9 Avatars and co-op presence

- Two avatars, one per player, distinct outfits and a **player color**: P1 teal #2BB3A3 (dark #1F7A70), P2 coral
  #FF7A6B (dark #C2483C). Name tags (DOM) above heads, colored.
- The avatar is **cosmetic and never blocks actions**: on each action it runs (4.5 m/s) toward the latest action area,
  vaults fences with a 300 ms hop (FV2), and plays the tool animation (hoe, watering can, sickle, basket) when within
  1.5 m; if actions arrive faster than it can run, it plays the tool animation at the nearest point and moves on.
- Each player's cursor projects a soft ground ring in their color (radius 0.6 m, 120 BPM pulse when idle on an item);
  the partner's ring and their hover-bend are visible to you. The hovered tile already travels in the presence message
  (`mv` with `cx, cz`, tech-architecture.md §6/§10); feed its center to `uCursorB` and ease it (~8/s) so it glides.
- **Ping** (middle-click or G): bouncing marker in your color at that spot + chime on both screens; if off-screen for
  the partner, an edge arrow points to it.
- **Emotes** (wheel on hold-T or a bottom-left button): wave, heart, laugh, thumbs up, "come here" — a speech bubble with
  the icon above the avatar for 2 s, avatar plays a matching pose.
- **Together moments**: farm level-up and shared goals celebrate on both screens; when both players act within 3 s on
  the same field, a small "high five" icon pops between them (pure feel, no reward unless the mechanics doc adds one).
- Partner activity log (bottom-left, last 5 lines, fades after 8 s): "Mila harvested 12 corn".
- Partner sounds play at −6 dB and only when the event is on your screen.

### 3.10 Day/night, weather, seasons

- **Day/night is cosmetic and slow.** Players complain when cycles are fast and when nights are not distinct
  (https://www.resetera.com/threads/dev-psa-day-night-cycle-in-your-game-please-consider-clock-speed-options.90481/);
  real-clock time locks evening players into permanent night. Default: a **40-minute cycle** — 26 min day, 4 min golden
  hour, 6 min moonlit night, 4 min dawn. Setting: *Cycle / Always day / Real clock*. Night is blue-lavender moonlight,
  never black: minimum scene luminance keeps every crop readable; windows and lanterns glow (emissive + additive sprite,
  no real point lights), fireflies over the meadow, crickets. Both players share the server's sky time.
- **No gameplay depends on time of day** unless the mechanics doc says so (fairness: nobody is punished for playing late).
- **Weather** (optional layer, server-driven, shared): sunny (default), light rain (instanced streaks, ground darkens,
  puddle ripples, softer light, rain ambience, rainbow arc afterwards), windy (sway ×1.6, leaves blowing), snow in
  winter. If the mechanics doc has watering, rain = free watering (Stardew precedent).
- **Seasons** (palette skin; whether they affect crops is the mechanics doc's call): spring (light greens, blossoms),
  summer (deep greens, sunflowers), autumn (grass #B5B347, maples orange/red, falling leaves), winter (snow on up-facing
  surfaces, frosted pines, breath puffs on animals). Implemented as one global `uSeason` uniform in the shared shader
  chunk (section 4.3).

### 3.11 Sound and music direction

- Music: 60 BPM (FV2's theme tempo), acoustic and warm — banjo, mandolin, fingerpicked acoustic guitar, upright bass,
  marimba/glockenspiel accents, light shaker; major or mixolydian; simple I–IV–V or ii–V–I harmony; melody passed
  between instruments (call-and-response) — https://www.orchestraltools.com/tips-for-cozy-game-music (60–100 BPM, fretted
  strings, restraint), Stardew tutorial above. 2–3 minute tracks with 30–60 s of silence between them so it never nags.
  Night: piano + soft pad. Level-up fanfare: short (1.5 s) 240 BPM arpeggio.
- Ambience layers crossfaded by time of day/weather: birds, wind in leaves (scaled by wind), distant cow/rooster
  (randomized every 20–60 s), water lapping near the lake (by camera distance), crickets and an owl at night, rain loop.
- SFX rules: every interaction has a sound (FV2: audio is what makes touch feel real); 70–150 ms, ±4 % random pitch;
  pentatonic pitch ladder on painted actions; stereo pan by screen x (`StereoPannerNode`); duck music −6 dB during
  fanfares. Default volumes: master 0.8, music 0.35, ambience 0.5, sfx 0.7, UI 0.6.
- Sources: see `assets-catalog.md`; small UI blips can be synthesized at runtime with Web Audio (wow-arena already
  renders WAVs with a DSP kit in `~/wow-arena/tools/make-sfx.js`).

---

## 4. Three.js implementation guide (integrated AMD GPU)

Target machine: a thin mid-range laptop (Ryzen 5 7530U class: a
Vega 7 "Barcelo" iGPU sharing RAM and a thin chassis that thermally throttles). The second player's PC is unknown, so
quality is tiered and auto-adjusting. Three.js current release is **0.186.1** (npm, checked 2026-10-02); wow-arena uses
0.170 — use 0.186 for the new project (vendored under `/vendor/three/`, import map, no bundler, same as wow-arena).

### 4.1 Renderer setup

```js
import * as THREE from 'three';

export function createRenderer(canvas, tier) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier.msaa,              // MSAA on the default framebuffer; we use no composer, so it stays valid
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;   // default since r152, stated for clarity
  renderer.toneMapping = THREE.NeutralToneMapping;    // keeps authored hue/saturation; only compresses highlights
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;       // r186: PCFSoftShadowMap is deprecated; PCF = 5 Vogel-disk
                                                      // hardware-filtered taps, softness via light.shadow.radius
  renderer.shadowMap.autoUpdate = false;              // static casters: set needsUpdate = true when the world changes
  return renderer;
}
```

- **Tone mapping choice**: ACES "skews bright orange toward yellow-white and cannot reach saturated yellows, greens and
  blues"; AgX keeps hues but is "less saturated than ACES out of the box"; Khronos PBR Neutral keeps base color hue and
  saturation and only rolls off highlights (https://discourse.threejs.org/t/tone-mapping-overview/75204 ,
  https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products).
  Our palette is hand-picked and full of oranges (carrots, pumpkins, oranges) — Neutral shows what we picked. A/B it
  against ACES (exposure 1.1) in the look-dev scene with puppeteer screenshots before locking.
- Color management: albedo textures `colorSpace = SRGBColorSpace` (GLTFLoader does this), data textures (noise, masks,
  footprint map) stay `NoColorSpace`; `new THREE.Color('#7CC243')` is converted to linear automatically.
- Verified in the r186 sources: `PCFSoftShadowMap` is marked `@deprecated since r186. Use PCFShadowMap instead`
  (https://unpkg.com/three@0.186.1/src/constants.js), PCF samples 5 Vogel-disk taps rotated by interleaved gradient noise
  with `shadowRadius`, and `LightShadow.intensity` (default 1) fades shadows
  (https://unpkg.com/three@0.186.1/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js).
- Use `renderer.setAnimationLoop(frame)`; read `renderer.info.render.calls/triangles` in a debug overlay (F3).
- **Compile-tested on the owner's laptop (2026-10-02)**: the renderer setup and every shader snippet in 4.3 (sway +
  pop), 4.6 (sky), 4.7 (ground extras), 4.9 (water) and 4.10 (particles) were rendered headless with three 0.186.1 in
  Chrome (ANGLE/Vulkan, `AMD Radeon Graphics (RADV RENOIR) 0x15E7`): zero shader errors, 7 draw calls, and
  `WEBGL_multi_draw` is available, so the `BatchedMesh` path works on this GPU. Harness:
  `docs/research/sources/shader-smoke-test/` (`node run.mjs`; it imports puppeteer-core from `~/wow-arena/node_modules`
  and three from unpkg), screenshot `smoke-shot.png`.

### 4.2 Quality tiers, auto-adjust, thermal policy

| Knob | high | medium | low |
|---|---|---|---|
| pixelRatio cap | 1.25 | 1.0 | 0.85 |
| MSAA (`antialias`) | on | on | off (boot-time only, like wow-arena) |
| Sun shadow map | 2048, radius 3 | 1024, radius 2 | off (blob shadows + footprint AO only) |
| Grass/flower tufts | 3000 | 1500 | 400 |
| Particle cap | 1500 | 800 | 300 |
| Cloud shadows, water glints | on | on | off |
| Wind flutter octave | on | on | off (single sine) |
| Ambient critters (birds, butterflies) | all | half | few |

- Auto-tier like `~/wow-arena/public/js/scene.js`: exponential average of frame time (~2 s); drop a tier after 3 s above
  18 ms; climb after 10 s below 11 ms; remember the settled tier in `localStorage` (wrapped in try/catch) so MSAA can be
  chosen at boot.
- **Thermal/idle policy** (the laptop runs hot): render at full rate while there is input, tweens, particles or a camera
  move; after 45 s without any of those, render every other frame (30 fps) — the 60 BPM ambience still looks smooth;
  any input restores 60 instantly. Cap at 60 fps even on high-refresh screens (time accumulator). The browser already
  stops `requestAnimationFrame` on hidden tabs.
- wow-arena lessons carried over: Lambert instead of Standard (the PBR BRDF is pure cost for flat-colored stylized art),
  share/dedupe materials by content, at most a tiny pool of point lights (each light costs every lit fragment even at
  intensity 0), freeze static matrices (`matrixAutoUpdate = false`).

### 4.3 Materials and the shared shader chunk

Use `MeshLambertMaterial` for everything lit (vertex colors and/or an atlas map), `MeshBasicMaterial` for unlit helpers.
Extend with `onBeforeCompile` (https://threejsresources.com/guides/grass recommends extending built-in materials this
way to keep lighting, fog and shadows). One shared uniform object drives every animated material:

```js
// world-uniforms.js — one object, shared by reference into every patched material
export const WORLD = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWind: { value: 0.07 },                                // meters of tip sway at amp 1
  uCursorA: { value: new THREE.Vector4(0, 0, 0, 0) },    // xyz ground point, w = 0..1 presence (local player)
  uCursorB: { value: new THREE.Vector4(0, 0, 0, 0) },    // partner's cursor, interpolated from the network
  uSeason: { value: 1 },                                 // 0 spring, 1 summer, 2 autumn, 3 winter (fractional = blend)
  uWet: { value: 0 },                                    // rain darkening 0..1
};
```

Wind + cursor push, for `InstancedMesh` and `BatchedMesh` (in r186 `batchingMatrix` is defined by
`#include <batching_vertex>` before `#include <begin_vertex>`, and `instanceMatrix` is applied in `project_vertex`):

```js
const SWAY_PARS = /* glsl */`
uniform float uTime; uniform vec2 uWindDir; uniform float uWind;
uniform vec4 uCursorA; uniform vec4 uCursorB;
uniform float uSwayHeight; uniform float uStiffness;
#ifdef USE_INSTANCING
  attribute float aSwayAmp;   // 0.3 sprout ... 1.6 ready; 0 for static instances
  attribute float aPopStart;  // uTime when the last pop started (GPU-evaluated squash, no CPU per frame)
#endif
vec2 cursorPush(vec4 c, vec2 rootXZ) {
  vec2 d = rootXZ - c.xz;
  float r = length(d) + 1e-4;
  float k = c.w * (1.0 - smoothstep(0.0, 2.2, r)); // 2.2 m "hand of wind"
  return (d / r) * k * 0.35;                       // bend away from the hand
}
`;

const SWAY_MAIN = /* glsl */`
#include <begin_vertex>
vec3 swayW = vec3(0.0);
{
  mat4 inst = mat4(1.0);
  float amp = 1.0;
  #ifdef USE_INSTANCING
    inst = instanceMatrix; amp = aSwayAmp;
    float a = uTime - aPopStart;                     // squash-and-stretch pop, 300 ms, volume preserving
    if (a >= 0.0 && a < 0.3) {
      float k = sin(a / 0.3 * 3.14159) * (1.0 - a / 0.3);
      float sy = 1.0 + 0.25 * k;
      transformed.y *= sy; transformed.xz *= inversesqrt(sy);
    }
  #endif
  #ifdef USE_BATCHING
    inst = batchingMatrix;
  #endif
  vec3 rootW = (modelMatrix * inst * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float h = clamp(position.y / uSwayHeight, 0.0, 1.0);
  float bend = h * h;                                // roots stay planted
  float ph = dot(rootW.xz, vec2(0.21, 0.17));        // neighbours sway together (wave across the field)
  float slow = sin(uTime * 3.14159 + ph);            // 2 s period = 2 beats at 60 BPM
  float flutter = 0.25 * sin(uTime * 6.28318 + ph * 3.1); // 1 s period micro-flutter
  vec2 s = uWindDir * (slow + flutter) * uWind * amp / uStiffness;
  s += cursorPush(uCursorA, rootW.xz) + cursorPush(uCursorB, rootW.xz);
  swayW = vec3(s.x, -0.5 * dot(s, s), s.y) * bend;   // tiny drop keeps blade length plausible
}
`;

export function addSway(material, { swayHeight = 1.0, stiffness = 1.0 } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WORLD);
    shader.uniforms.uSwayHeight = { value: swayHeight };
    shader.uniforms.uStiffness = { value: stiffness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_PARS}`)
      .replace('#include <begin_vertex>', SWAY_MAIN)
      // apply the world-space offset after the stock projection (no per-vertex matrix inverse)
      .replace('#include <project_vertex>', `#include <project_vertex>
        mvPosition.xyz += (viewMatrix * vec4(swayW, 0.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => `sway-${swayHeight}-${stiffness}`;
  return material;
}
```

Notes:
- `aSwayAmp`/`aPopStart` are `InstancedBufferAttribute`s (1 float each) that EVERY instanced geometry using `addSway`
  must carry (a missing attribute reads as 0 = no sway); initialise `aPopStart` to -10; on a pop or stage
  change write one float and call `attr.addUpdateRange(i, 1); attr.needsUpdate = true;` — zero per-frame CPU for the
  whole field.
- Shadows deliberately do not sway (the shadow map is static, section 4.8); crops do not cast shadow-map shadows at all.
- Season/wet/footprint/cloud code goes in a second fragment chunk on the ground and foliage materials (4.7).
- For two-sided cards (crossed quads) use `side: DoubleSide`, `alphaTest: 0.5` and **`alphaToCoverage: true`** with MSAA
  for soft cut-out edges at no extra pass.

### 4.4 Draw-call strategy

| Object family | Technique | Draw calls |
|---|---|---|
| Ground (farm + border hills) | 1 mesh, vertex colors + detail map | 1 |
| Plot soil mounds | 1 InstancedMesh | 1 |
| Crops | 1 InstancedMesh per (crop, stage) actually present, atlas texture; or one `BatchedMesh` holding every stage geometry (needs `WEBGL_multi_draw` — check `renderer.extensions.has('WEBGL_multi_draw')` at boot, fall back to InstancedMesh) | ~10–30 / 1–2 |
| Fruit on trees, produce on bushes | 1 InstancedMesh per fruit type (spheres/lowpoly) | ~6 |
| Trees: trunks + canopies | InstancedMesh per species part | ~10 |
| Forest wall | merged static mesh or 3 InstancedMeshes | 3 |
| Fences | InstancedMesh: post + rail pieces | 2 |
| Grass/flower tufts | 1–2 InstancedMeshes with sway | 2 |
| Rocks, crates, hay, props | InstancedMesh per kind or merged static | ~10 |
| Buildings | GLB each (a few materials each, merged by content) | ~20–40 |
| Animals + avatars | skinned GLBs (one per individual; ≤40 animals) | ~40–60 |
| Blob shadows | 1 InstancedMesh | 1 |
| Need bubbles / sparkles / particles | 2 particle pools + 1 bubble InstancedMesh (or DOM) | 3 |
| Water, sky, clouds | 3 | 3 |

Budget references: ~100 draw calls on mobile, several hundred on desktop; "the real cost is CPU-side submission"
(https://www.utsubo.com/blog/threejs-best-practices-100-tips , https://threejsroadmap.com/blog/draw-calls-the-silent-killer);
BatchedMesh merges different geometries sharing a material into one call
(https://bersus.io/insights/creative-dev/threejs-optimizing-instancing-and-batching/).
Animals are the most expensive item (skinning + one call each): cap visible skinned meshes, update `AnimationMixer`s of
off-screen animals at 10 Hz, and freeze far-away animals to their idle pose when zoomed fully out.

### 4.5 Fluffy tree canopies (cheap)

Technique: leaf cards whose normals are transferred from an enclosing sphere so the canopy shades like one soft ball
(https://douges.dev/blog/threejs-trees-1 ; the Blender/Unreal "Ghibli tree" normal-transfer workflow,
https://www.blendernation.com/2020/08/20/creating-ghibli-trees-in-3d/). Implementation:
- Canopy = 40–80 quads scattered on/inside an icosphere; at build time set each vertex normal to
  `normalize(vertex - canopyCenter)`; alpha-tested leaf-cluster texture, `alphaToCoverage`.
- In the vertex shader push each card's corners out along the camera's right/up axes by `(uv * 2 - 1) * cardSize` (the
  douges.dev "not-quite-billboard"), so the canopy stays fluffy from every rotation.
- Add the sway chunk with a large `uSwayHeight` and stiffness 3 (canopies breathe, they do not whip).
- Instance per species; fruit is a separate instanced sphere set placed on the sphere surface (visible count grows with
  the fruit stage).
- Cheaper fallback (low tier): 2–3 overlapping low-poly blobs with flat-ish Lambert shading and vertex-color AO darker
  at the bottom.

### 4.6 Sky dome

The camera mostly looks down at the board; the sky shows when zoomed in (low pitch), in photos and at the horizon.

```js
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(400, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#4FA8EE') },
      uHorizon: { value: new THREE.Color('#D6F1FF') },
      uBelow: { value: new THREE.Color('#BFD9A8') },
      uSunDir: { value: new THREE.Vector3(-0.55, 0.75, 0.25).normalize() },
      uSunColor: { value: new THREE.Color('#FFF4D6') },
      uExp: { value: 0.55 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;            // pin to the far plane
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBelow;
      uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uExp;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(uHorizon, uTop, pow(max(d.y, 0.0), uExp));
        col = mix(col, uBelow, smoothstep(0.0, -0.2, d.y));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(s, 800.0) * 3.0 + pow(s, 16.0) * 0.25);   // disc + soft halo
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
sky.frustumCulled = false;   // follow the camera position every frame: sky.position.copy(camera.position)
```

Same idea as the three.js hemisphere-light example (top/bottom colors + exponent,
https://threejs.org/examples/#webgl_lights_hemisphere) and the mobile-friendly gradient sky in
https://github.com/Nugget8/Three.js-Ocean-Scene . `scene.fog = new THREE.Fog(horizon, 90, 260)` with the same horizon
color gives aerial perspective to the hills and hides the world edge. Clouds: 8–12 soft billboard puffs (one
InstancedMesh, `depthWrite: false`) drifting at 0.5 m/s.

### 4.7 Ground shader extras: footprint AO, paths, cloud shadows, seasons, wetness

Ground = Lambert with `vertexColors` + a tiling detail map. Inject into the fragment shader after
`#include <map_fragment>` (add a `vWorldPos` varying in the vertex shader):

```glsl
// uniforms: uFootprint (sampler2D, RG8, covers the farm), uFarmMin (vec2), uFarmSize (vec2),
//           uCloud (sampler2D noise), uCloudAmount, uPathColor, uSnowColor, uSeason, uWet, uTime
vec2 fpUV = (vWorldPos.xz - uFarmMin) / uFarmSize;
vec2 fp = texture2D(uFootprint, fpUV).rg;
diffuseColor.rgb *= 1.0 - 0.35 * fp.r;                          // soft contact AO under every placed object
diffuseColor.rgb = mix(diffuseColor.rgb, uPathColor, fp.g);     // worn paths where players walk a lot
float cloud = texture2D(uCloud, vWorldPos.xz * 0.008 + uTime * vec2(0.004, 0.002)).r;
diffuseColor.rgb *= mix(1.0, 0.82, smoothstep(0.55, 0.75, cloud) * uCloudAmount); // drifting cloud shadows
float snow = smoothstep(2.5, 3.0, uSeason) * (1.0 - smoothstep(3.6, 4.0, uSeason));
diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, snow * 0.85);
diffuseColor.rgb *= 1.0 - 0.25 * uWet;                           // rain darkening
```

- **Footprint AO map**: a 256×256 RG `DataTexture` (0.5 m per texel over a 128 m farm). When an object is placed, stamp a
  soft Gaussian ellipse (object footprint + 1 m) into R; when removed, re-stamp from the occupancy list. Paths: add to G
  along avatar walks (slow accumulate, slow decay). One upload per change. It grounds every building, tree and
  fence without SSAO — the cheapest "ambient occlusion" there is.
- Foliage materials get the same season ramp (canopy color via instance color × season tint; snow on up-facing normals
  `smoothstep(0.6, 0.9, normal.y)` in winter).

### 4.8 Shadows

- One sun shadow, **static casters only** (buildings, trees, fences, rocks): fit the orthographic shadow camera to the
  farm rect (e.g. ±45 m) — or, as tech-architecture.md §10.9 specifies, to the visible ground footprint snapped to
  shadow texels and refit when a camera move ends (sharper on big farms) — `mapSize` per tier, `bias = -0.0004`, `normalBias = 0.03`, `radius` 2–3,
  `intensity = 0.6` (soft cartoon shadows, sky fill shows through).
- `renderer.shadowMap.autoUpdate = false`; set `renderer.shadowMap.needsUpdate = true` when something static is placed,
  moved or removed, and when the sun direction changes. During the day cycle move the sun in 0.5° steps (every ~3 s)
  and re-render the shadow map only on those steps — shadows cost ~0 ms on all other frames.
- Everything that moves (animals, avatars, dropped produce, tools) uses **blob shadows**: one InstancedMesh of
  ground-aligned quads with a radial-gradient texture (rgba(0,0,0,0.45) → 0), `transparent`, `depthWrite: false`,
  `polygonOffset` (factor −1), scaled by body size and shrunk (×0.8) and faded while hopping. The three.js manual
  describes this fake-shadow technique as the standard cheap alternative (https://threejs.org/manual/#en/shadows).
- Crops never cast shadows; the soil mound's vertex colors are darker in the center to suggest occlusion.
- Low tier: shadow map off, blob shadows for trees too, footprint AO does the rest.

### 4.9 Water (opaque, no depth pre-pass)

The terrain is static, so bake "depth" (0 at shore → 1 deep) and "shore distance" into vertex attributes of the lake
mesh at build time instead of reading the depth buffer every frame (the forum's foam shader reads depth,
https://discourse.threejs.org/t/unlit-water-shader-with-foam/11641 — we do not need to). Opaque = no sorting, no
transparency overdraw.

```glsl
// vertex: vDepth = aDepth; vWorld = (modelMatrix * vec4(position,1.0)).xyz;
//         gentle bob: transformed.y += sin(uTime * 1.5708 + position.x * 0.4) * 0.03;  (4 s period, 60 BPM grid)
uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam;
varying float vDepth; varying vec3 vWorld;
void main() {
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, vDepth));
  float lip = 1.0 - smoothstep(0.0, 0.06, vDepth);                       // solid foam lip at the shore
  float rings = step(0.93, sin(vDepth * 22.0 - uTime * 1.6)) * (1.0 - smoothstep(0.0, 0.3, vDepth));
  vec2 q = vWorld.xz * 0.9 + vec2(uTime * 0.15, uTime * 0.11);
  float glint = smoothstep(0.86, 0.97, sin(q.x * 3.1) * sin(q.y * 2.3 + 1.7) * sin((q.x + q.y) * 1.3));
  col = mix(col, uFoam, max(lip, rings) * 0.85) + glint * 0.35;          // sparkles = "alive"
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
```

Life on the lake: lily pads (instanced), ducks (wander on a spline), fish jump splash particles + an expanding ripple
ring (one reusable quad), the dock, reeds swaying with the shared wind chunk.

### 4.10 Particles (pooled, GPU-evaluated)

One `InstancedBufferGeometry` quad per pool, `instanceCount = POOL` (e.g. 1024), ring-buffer allocation, `frustumCulled = false`.
Per-instance attributes: `aStart (vec3)`, `aVel (vec3)`, `aBirth (float)`, `aLife (float)`, `aColor (vec3)`,
`aSize (vec2 start,end)`, `aFrame (float, 4×4 atlas index)`, `aSpin (float)`, `aGrav (float)`. The CPU only writes on
spawn (`addUpdateRange` for that slot); the vertex shader computes everything:

```glsl
float age = uTime - aBirth;
float t = age / aLife;
if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // dead: clipped away
vec3 p = aStart + aVel * age + vec3(0.0, -4.9 * aGrav, 0.0) * age * age;
vec4 mv = modelViewMatrix * vec4(p, 1.0);
float size = mix(aSize.x, aSize.y, t);
float c = cos(aSpin * age), s = sin(aSpin * age);
mv.xy += mat2(c, -s, s, c) * position.xy * size;                              // camera-facing quad
gl_Position = projectionMatrix * mv;
vUv = (position.xy + 0.5 + vec2(mod(aFrame, 4.0), floor(aFrame / 4.0))) / 4.0;
vAlpha = 1.0 - smoothstep(0.7, 1.0, t);
vColor = aColor;
```

Two pools: **alpha** (dust, leaves, petals, confetti, hearts, feathers) and **additive** (sparkles, glints, fireflies,
star bursts); both `depthWrite: false`. Atlas (one 512² texture): 4-point sparkle star, round glow, leaf, petal, dust
puff, heart, confetti square, water droplet, feather, coin, music note, snowflake, smoke puff. Spawn helpers:
`burst(kind, pos, count)` with counts tied to the tempo tier (interaction 6–14, celebration 40–80).
Ready-crop sparkles are a separate tiny instanced set: one twinkle per ready plot, each with a random phase, scale
pulsing on a 1 s cycle (60 BPM) — never all in sync.

### 4.11 Tweens and easing (no dependency)

A 40-line module beats a library for this; GSAP is free now (https://gsap.com/blog/3-13/) but unnecessary.
Formulas from https://easings.net:

```js
export const EASE = {
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inCubic: (t) => t ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

const active = new Set();
let clock = 0;
export function tween({ duration, ease = EASE.outCubic, delay = 0, onUpdate, onDone }) {
  const tw = { start: clock + delay, duration, ease, onUpdate, onDone };
  active.add(tw);
  return () => active.delete(tw);                       // cancel handle
}
export function updateTweens(seconds) {                 // call once per frame from the render loop
  clock = seconds;
  for (const tw of active) {
    const k = (clock - tw.start) / tw.duration;
    if (k < 0) continue;
    const e = tw.ease(Math.min(k, 1));
    tw.onUpdate(e);
    if (k >= 1) { active.delete(tw); tw.onDone?.(); }
  }
}
export const isAnimating = () => active.size > 0;      // feeds the idle-throttle
```

Damped spring (tree shake, ribbon swing, camera nudge): `x'' = -k x - c x'` with k = 120, c = 9, integrated in fixed
1/120 s steps. Standard durations: 120 ms micro (hover), 250 ms beat (pop, button press, bump), 500 ms (panel move,
attention bob), 1000 ms (ambient loops), 2000/4000 ms (sway, breathing, water).

### 4.12 Picking (analytic, no instanced raycasts)

Raycasting thousands of instances is O(n) per move. The farm is flat and grid-based:
1. `raycaster.ray.intersectPlane(groundPlane, hit)` → cell `(floor(hit.x / CELL), floor(hit.z / CELL))` → occupancy map
   → plot/object id.
2. Before that, test the ray against the bounding boxes of tall things only (buildings, trees, animals: a few hundred
   `Box3`/spheres, cheap) and prefer the nearest hit.
3. Drag-paint: sample the cursor path every frame and rasterize the segment between the last and current cell
   (Bresenham) so fast swipes never skip plots.

### 4.13 Screen-space UI overlays (HTML on top of the canvas)

- One `#world-ui` layer above the canvas, `pointer-events: none` (children that must be clickable opt back in). HTML is
  cheaper and sharper than sprites for text; update positions with `transform: translate3d()` only, never `top/left`,
  and keep the live count small (https://threejsresources.com/guides/ui-hud).
- Pools: 24 floating-text nodes, 16 fly-to-HUD icons, ~40 need bubbles (or render bubbles as an instanced quad set
  in WebGL when more than ~40 are visible — at far zoom aggregate per field: one bubble with "×12").

```js
const v = new THREE.Vector3();
export function place(el, worldPos, camera, w, h) {
  v.copy(worldPos).project(camera);
  const onScreen = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
  el.style.transform = `translate3d(${((v.x + 1) * 0.5 * w) | 0}px, ${((1 - v.y) * 0.5 * h) | 0}px, 0) translate(-50%, -100%)`;
  el.style.visibility = onScreen ? 'visible' : 'hidden';
}
```

- Floating "+XP"/"+coins": inner span animated with the Web Animations API (`el.animate([...], { duration: 900, easing:
  'cubic-bezier(.22,1,.36,1)' })`: rise 48 px, scale 0.6 → 1.15 → 1 in the first 250 ms, fade over the last 30 %).
  WAAPI restarts cleanly without the `offsetWidth` reflow hack.
- Fly-to-HUD arc: two nested elements — the outer animates X with `ease-in`, the inner animates Y with `ease-out`;
  combined they trace a curve. Target = `getBoundingClientRect()` center of the HUD button, read once per flight.
  On arrival: button bump + counter roll + tick sound (https://github.com/khalilo-cs/-/pull/3 describes the same
  poof → fly → bump-synced-with-counter pattern).
- Tooltips follow their object each frame while visible; at most one open.

### 4.14 Post-processing and outlines: decisions

- **No post-processing by default.** Every full-screen pass at 1920×1200 on Vega 7 costs real milliseconds (bloom = a
  mip chain of passes; SSAO far more), and a composer forces either losing MSAA or a multisampled render target.
  Fake the "glow" with additive sparkle sprites and emissive lifts; do the vignette as a CSS `radial-gradient` overlay
  div (compositor cost only); grading is the palette + Neutral tone mapping.
- If a future "ultra" tier wants bloom: `WebGLRenderTarget({ samples: 4 })` + a half-resolution threshold bloom + an
  `OutputPass`, only when the high tier holds < 9 ms.
- **No global outlines** (FV2 and Hay Day have none; painterly-soft reads better). Outline only the selected/held object
  with an inverted hull (back faces, scaled 1.03, flat dark color, 1 extra draw), and highlight hover with a small
  emissive lift. Placement ghosts: translucent green/red tint.

### 4.15 Budgets (Vega 7 iGPU, 1920×1200, pixel ratio 1.0)

| Metric | Target | Hard ceiling |
|---|---|---|
| GPU frame time | ≤ 10 ms | 14 ms (then auto-downgrade) |
| CPU frame time (JS + submit) | ≤ 4 ms | 6 ms |
| Draw calls | ≤ 150 | 250 |
| Triangles visible | ≤ 300k | 500k |
| Skinned meshes animating | ≤ 40 | 60 |
| Shadow-map renders | only on change / sun step | — |
| Full-screen passes | 0 | 1 (ultra only) |
| Live particles | ≤ 1500 (2 calls) | — |
| DOM nodes moved per frame | ≤ 40 | 80 |
| Texture memory | ≤ 128 MB | 192 MB |
| Lights | 1 directional + 1 hemisphere | + 2 point lights at night (prefer zero) |

Verification: an F3 overlay with `renderer.info`, fps, tier; a puppeteer-core look-dev script that loads fixed scenes
(day, golden hour, night, rain, winter; zoom min/default/max) and saves screenshots for side-by-side review against
`sources/fv2-reference/` (the same `tools/shot.mjs` approach as wow-arena; its notes warn that a backgrounded window is
throttled to 1 fps, so measure fps headless with `--use-angle=vulkan` or on the real screen).

---

## 5. HTML/CSS UI style spec (cartoon wood + parchment, pure CSS + inline SVG)

### 5.1 Fonts (Google Fonts)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&family=Fredoka:wght@400..700&display=swap" rel="stylesheet">
```

- **Baloo 2** 800 (and 600): titles, banners, level number, big celebration text — bouncy, heavy, reads like Hay Day /
  FV2 banner type. Weights 400–800 exist (https://fontsource.org/fonts/baloo-2).
- **Fredoka** 400–700 (variable weight 300–700, width 75–125): all UI text, numbers, buttons, tooltips
  (https://fonts.google.com/specimen/Fredoka). Rounded like Animal Crossing's Rodin.
- LAN play may have no internet: vendor the two WOFF2 files into `public/fonts/` with `@font-face` (`font-display: swap`)
  and treat Google Fonts as optional. Fallback stack `system-ui, sans-serif`.
- Numbers: `font-variant-numeric: tabular-nums` (harmless if unsupported) and fixed `min-width` on counters so rolling
  numbers do not jitter.
- Sizes (desktop, 1rem = 16px at UI scale 100 %): HUD numbers 1.25rem/700; buttons 1.125rem/700; body 1rem/500;
  small labels 0.875rem/600 (minimum); panel titles 1.75–2.25rem Baloo 800; level-up banner 3rem Baloo 800.
- UI scale setting 80–130 % via `html { font-size: calc(16px * var(--ui-scale)) }`, all UI sized in rem.

### 5.2 Color tokens

```css
:root {
  /* type */
  --font-display: 'Baloo 2', 'Fredoka', system-ui, sans-serif;
  --font-ui: 'Fredoka', system-ui, sans-serif;

  /* honey wood */
  --wood-50: #F7D9A0;  --wood-100: #EDBE72;  --wood-300: #D99A4A;
  --wood-500: #B87533; --wood-700: #8A5224;  --wood-900: #5A3215;

  /* parchment */
  --paper-50: #FFFBEE; --paper-100: #FFF4D6; --paper-200: #F8E6B8;
  --paper-300: #EFD49A; --paper-edge: #D9B677;

  /* ink */
  --ink-900: #3E2612; --ink-700: #5C3B1E; --ink-500: #8A6440; --ink-inverse: #FFFFFF;

  /* action colors: 300 highlight, 500 face, 700 body, 900 lip/outline */
  --go-300: #9BE06A;   --go-500: #5DBB3F;   --go-700: #3F8F2A;   --go-900: #2A6A1C;
  --sun-300: #FFE58A;  --sun-500: #FFC83D;  --sun-700: #E39A1E;  --sun-900: #A86A10;
  --stop-300: #FF9B8F; --stop-500: #E8554A; --stop-700: #B83A30; --stop-900: #7E2620;
  --sky-300: #9ED8FF;  --sky-500: #4AA8E8;  --sky-700: #2B78B5;  --sky-900: #1C5283;

  /* currencies and progress */
  --coin: #FFC83D; --coin-shade: #D9931F;
  --xp: #4AA8E8;   --xp-shade: #2B78B5;   --xp-track: #2B4A66;
  --ribbon-gold: #F5C542; --ribbon-red: #E8556E; --ribbon-blue: #4A7FE8;   /* FV2-style mastery ribbons */

  /* players */
  --p1: #2BB3A3; --p1-dark: #1F7A70;
  --p2: #FF7A6B; --p2-dark: #C2483C;

  /* shape and depth */
  --r-s: 8px; --r-m: 14px; --r-l: 22px; --r-pill: 999px;
  --drop: 0 6px 14px rgba(62, 38, 18, .28);
  --lip: 4px;

  /* motion (60/120/240 BPM grid) */
  --t-micro: 120ms; --t-beat: 250ms; --t-half: 500ms; --t-full: 1000ms;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-back: cubic-bezier(.34, 1.56, .64, 1);
  --ease-inout: cubic-bezier(.65, 0, .35, 1);
}
```

Measured WCAG contrast (computed with the WCAG 2 relative-luminance formula): ink-900 on paper-100 **12.9:1**, on
paper-200 11.4:1; ink-700 on paper-100 9.1:1; ink-500 on paper-100 4.8:1 (secondary text only); white on go-900 6.6:1,
on go-700 4.1:1, on go-500 only 2.4:1 → **button labels are white with a go-900 outline** and ≥ 18px/700; ink-900 on
sun-500 9.1:1 (yellow buttons use dark ink); white on stop-700 5.7:1; white on sky-700 4.7:1; white on wood-900 11.0:1;
ink-900 on wood-100 8.2:1; player tags: white on p1-dark 5.2:1, ink-900 on p2 5.5:1.

### 5.3 Components

```css
/* outlined display text (multi-shadow is more reliable than -webkit-text-stroke for thick outlines) */
.outlined {
  --o: var(--wood-900);
  color: #fff;
  text-shadow:
    -2px -2px 0 var(--o), 0 -2px 0 var(--o), 2px -2px 0 var(--o),
    -2px 0 0 var(--o), 2px 0 0 var(--o),
    -2px 2px 0 var(--o), 0 2px 0 var(--o), 2px 2px 0 var(--o),
    0 4px 0 var(--o);
}

/* honey-wood frame (planks + grain + bevel) */
.wood {
  position: relative;
  border-radius: var(--r-l);
  padding: 14px;
  background:
    repeating-linear-gradient(180deg, transparent 0 44px, rgba(90, 50, 21, .28) 44px 46px),   /* plank seams */
    repeating-linear-gradient(90deg, rgba(90, 50, 21, .08) 0 2px, transparent 2px 19px),      /* grain */
    repeating-linear-gradient(90deg, rgba(255, 255, 255, .07) 0 1px, transparent 1px 37px),
    linear-gradient(180deg, var(--wood-100), var(--wood-300) 55%, var(--wood-500));
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, .45),
    inset 0 -3px 0 rgba(90, 50, 21, .35),
    0 0 0 3px var(--wood-900),
    var(--drop);
}
/* nail heads in the corners */
.wood::after {
  content: ''; position: absolute; inset: 8px; pointer-events: none; border-radius: inherit;
  background:
    radial-gradient(circle at 4px 4px, #6B4A2A 0 3px, transparent 4px) top left / 9px 9px no-repeat,
    radial-gradient(circle at 4px 4px, #6B4A2A 0 3px, transparent 4px) top right / 9px 9px no-repeat,
    radial-gradient(circle at 4px 4px, #6B4A2A 0 3px, transparent 4px) bottom left / 9px 9px no-repeat,
    radial-gradient(circle at 4px 4px, #6B4A2A 0 3px, transparent 4px) bottom right / 9px 9px no-repeat;
}

/* parchment card */
.paper {
  position: relative;
  color: var(--ink-900);
  border-radius: var(--r-m);
  background: radial-gradient(120% 90% at 50% 40%,
    var(--paper-50) 0%, var(--paper-100) 55%, var(--paper-200) 85%, var(--paper-300) 100%);
  box-shadow: inset 0 0 0 2px var(--paper-edge), inset 0 0 24px rgba(160, 110, 40, .22);
}
/* paper fibre noise: SVG feTurbulence as a data URI, multiplied at 10 % */
.paper::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  opacity: .10; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .45 0 0 0 0 .30 0 0 0 0 .12 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* 3D pill button with a lip */
.btn {
  --top: var(--go-300); --face: var(--go-500); --body: var(--go-700); --lipc: var(--go-900);
  --o: var(--go-900);
  font: 700 1.125rem/1 var(--font-ui);
  color: #fff;
  padding: 10px 22px 12px;
  border: 0;
  border-radius: var(--r-pill);
  background: linear-gradient(180deg, var(--top) 0%, var(--face) 42%, var(--body) 100%);
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, .55),
    inset 0 -2px 0 rgba(0, 0, 0, .12),
    0 var(--lip) 0 var(--lipc),
    0 calc(var(--lip) + 3px) 8px rgba(0, 0, 0, .25);
  text-shadow: -1.5px -1.5px 0 var(--o), 1.5px -1.5px 0 var(--o), -1.5px 1.5px 0 var(--o),
               1.5px 1.5px 0 var(--o), 0 2.5px 0 var(--o);
  cursor: pointer;
  transition: transform var(--t-micro) var(--ease-out), box-shadow var(--t-micro) var(--ease-out),
              filter var(--t-micro);
}
.btn:hover { transform: translateY(-1px); filter: brightness(1.06) saturate(1.05); }
.btn:active {
  transform: translateY(3px);
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, .4), 0 1px 0 var(--lipc), 0 2px 4px rgba(0, 0, 0, .25);
}
.btn:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.btn:disabled { filter: grayscale(.85) brightness(.95); cursor: not-allowed; transform: none; }
.btn--sun  { --top: var(--sun-300);  --face: var(--sun-500);  --body: var(--sun-700);  --lipc: var(--sun-900);
             color: var(--ink-900); text-shadow: 0 1px 0 rgba(255, 255, 255, .6); }
.btn--stop { --top: var(--stop-300); --face: var(--stop-500); --body: var(--stop-700); --lipc: var(--stop-900); --o: var(--stop-900); }
.btn--sky  { --top: var(--sky-300);  --face: var(--sky-500);  --body: var(--sky-700);  --lipc: var(--sky-900);  --o: var(--sky-900); }
.btn--round { width: 52px; height: 52px; padding: 0; display: grid; place-items: center; }   /* close, help, side buttons */

/* HUD currency pill: big icon overlaps the left end */
.pill {
  position: relative; display: inline-flex; align-items: center; gap: 8px;
  height: 40px; min-width: 132px; padding: 0 6px 0 48px;
  border-radius: var(--r-pill);
  background: linear-gradient(180deg, var(--paper-50), var(--paper-200));
  box-shadow: inset 0 0 0 2px var(--paper-edge), 0 3px 0 rgba(62, 38, 18, .35);
  font: 700 1.25rem/1 var(--font-ui); color: var(--ink-900);
  font-variant-numeric: tabular-nums;
}
.pill > .icon { position: absolute; left: -8px; top: 50%; width: 50px; height: 50px; transform: translateY(-50%);
                filter: drop-shadow(0 2px 0 rgba(62, 38, 18, .4)); }
.pill > .more { margin-left: auto; }                       /* small square go-button: opens the related panel */
.pill.bump { animation: bump var(--t-beat) var(--ease-back); }
@keyframes bump { 0% { transform: scale(1); } 40% { transform: scale(1.15); } 100% { transform: scale(1); } }

/* XP bar next to the level star */
.xp { position: relative; width: 200px; height: 22px; border-radius: var(--r-pill); overflow: hidden;
      background: var(--xp-track); box-shadow: inset 0 2px 4px rgba(0, 0, 0, .4), 0 0 0 2px var(--paper-edge); }
.xp > .fill { position: absolute; inset: 0; transform-origin: left; transform: scaleX(var(--p, 0));
              background: linear-gradient(180deg, #8FD3FF, var(--xp) 60%, var(--xp-shade));
              transition: transform 600ms var(--ease-out); }
.xp > .fill::after { content: ''; position: absolute; inset: 3px 6px auto; height: 5px; border-radius: 9px;
                     background: rgba(255, 255, 255, .45); }          /* gloss */

/* counter badge */
.badge { min-width: 22px; height: 22px; padding: 0 6px; border-radius: var(--r-pill);
         background: var(--stop-500); color: #fff; font: 700 .8125rem/22px var(--font-ui);
         box-shadow: 0 0 0 2px #fff, 0 2px 0 var(--stop-900); }

/* modal: wood frame, parchment body, banner title, overhanging close */
.modal { position: relative; width: min(760px, 92vw); padding: 56px 18px 18px; }   /* add class "wood" */
.modal > .title { position: absolute; left: 50%; top: -18px; transform: translateX(-50%);
                  padding: 8px 34px 12px; border-radius: var(--r-m);
                  font: 800 2rem/1 var(--font-display); }                           /* + .wood .outlined */
.modal > .close { position: absolute; right: -14px; top: -14px; }                   /* .btn.btn--stop.btn--round */
.modal-enter { animation: modal-in 300ms var(--ease-back) both; }
@keyframes modal-in { from { opacity: 0; transform: scale(.85) translateY(12px); } to { opacity: 1; transform: none; } }

/* tooltip bubble with tail (wobbly AC-style optional) */
.tip { position: absolute; padding: 8px 12px; border-radius: var(--r-m); background: var(--paper-50);
       color: var(--ink-900); font: 600 .9375rem/1.25 var(--font-ui); box-shadow: 0 0 0 2px var(--paper-edge), var(--drop); }
.tip::after { content: ''; position: absolute; left: 50%; bottom: -9px; width: 16px; height: 16px;
              transform: translateX(-50%) rotate(45deg); background: inherit;
              box-shadow: 2px 2px 0 var(--paper-edge); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}
```

Performance notes for the CSS: gradients and the SVG noise rasterize once and are cached; never animate elements that
carry `mix-blend-mode` or SVG filters (animate a child instead); animate only `transform` and `opacity`. If panel count
grows, pre-render the noise tile to a PNG at build time.

### 5.4 Inline SVG icon rules

- 48×48 viewBox, 2.5px outline in `--ink-900`, `stroke-linejoin: round`, `stroke-linecap: round`.
- Flat base fill + one highlight shape (white at 35 %) + one shade shape (black at 15 %); no gradients inside icons
  (keeps them crisp at 24–64 px). Same light direction as the world: highlight upper-left.
- Items in the world bubbles reuse the same SVGs (rasterized once to a canvas atlas for the WebGL bubble set).
- Example (coin):

```html
<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
  <ellipse cx="24" cy="27" rx="18" ry="16" fill="#D9931F" stroke="#3E2612" stroke-width="2.5"/>
  <ellipse cx="24" cy="23" rx="18" ry="16" fill="#FFC83D" stroke="#3E2612" stroke-width="2.5"/>
  <ellipse cx="24" cy="23" rx="11" ry="9.5" fill="none" stroke="#D9931F" stroke-width="2.5"/>
  <path d="M13 17c3-5 9-7 14-6" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
</svg>
```

- Custom tool cursors (seed bag, sickle, watering can, hand, hammer) as 32 px SVG data-URI cursors with a hotspot:
  `cursor: url("data:image/svg+xml,…") 6 4, pointer;` — FV2/Hay Day both show the tool as the pointer.

### 5.5 Layout (desktop 16:10, safe margin 16 px)

```
+------------------------------------------------------------------------------------------+
| [*12]==XP======   [P1 face][P2 face]          (toast slides here)      [coin 12 340][>]  |
|  level star + bar   co-op portraits                                     [ribbons 18][>]  |
|                                                                         [barn 87/150]     |
| [quest card]                                                                    [ + ]    |
| [quest card]                     3D FARM VIEW                                    [ - ]    |
| [quest card]                                                                 [rotL][rotR] |
| [ ... more ]                                                                    [photo]   |
|                                                                                 [settings]|
|                                                                                           |
| [activity log, fades]          [ contextual tool tray: seeds / tools ]   [Build][Market][Barn] |
| [emote][ping]                                                                             |
+------------------------------------------------------------------------------------------+
```

- Top-left: farm level star (Baloo 800 number inside a blue star) + XP bar; both players' round portraits with an
  online dot and their color ring.
- Top-right: currency pills (coins; achievement ribbons or other earned tokens per the mechanics doc; barn capacity).
  The small button on a pill opens the related panel (coins → market's sell tab) — **no real-money anything**.
- Left column: up to 3 goal/quest cards (portrait or item icon in a parchment ring, short title, progress ring); new
  ones slide in with a 120 BPM "!" bounce until hovered.
- Right edge: zoom +/−, rotate left/right, photo mode, settings (Hay Day/FV2 style small round/square buttons).
- Bottom-right: the three big primary buttons — Build/Decorate (hammer), Market (cornucopia/stand), Barn (storage) —
  the bottom-right big-button convention shared by FV2, Hay Day and Township.
- Bottom-center: a contextual tray only when needed (seed picker with counts and grow times when an empty plot is
  clicked; "painting: Carrot ×14" indicator during drag).
- Bottom-left: co-op corner — activity log, emote and ping buttons.
- Keyboard: 1–9 pick tray items, B build, M market, I barn, G ping, T emotes, Q/E rotate, F focus, P photo,
  Esc closes the top panel. Everything also clickable (one-handed rule).

### 5.6 UI motion spec

| Event | Animation |
|---|---|
| Panel open | backdrop fade 200 ms; panel scale 0.85 → 1 + rise 12 px, 300 ms `--ease-back` |
| Panel close | 150 ms fade/scale to 0.95, `ease-in` |
| Button press | translateY 3 px, lip collapses, 120 ms |
| Counter change | pill bump 250 ms; number rolls over 400 ms (`outCubic`) |
| Toast | slide down 250 ms `--ease-back`, stays 3 s, slide up 200 ms |
| New quest | slide from left 300 ms, "!" bob 500 ms period until hovered |
| Achievement ribbon | slide from right 300 ms, damped swing 2 s, auto-dismiss 5 s |
| Level up | 240 BPM sequence (section 3.8), banner 2.5 s total |
| Tooltip | appear after 250 ms hover, 120 ms fade/scale from 0.95 |

### 5.7 Accessibility

- `prefers-reduced-motion`: no confetti bursts (one static sparkle instead), sway amplitude ×0.4, no camera nudges,
  CSS animations collapse (rule above). Also an in-game toggle.
- Never color alone: needs use distinct icons and bubble shapes; ready crops add sparkles and sway, not just color;
  player identity uses color + name tag.
- Focus-visible rings on every control; all panels keyboard navigable; text ≥ 14 px; UI scale setting.
- Sounds have captions in the activity log for important events (level up, partner joined).

---

## 6. Hand-offs and open questions for the designer

- Mechanics doc decides: whether crops wither (visual state 5 is ready if so), whether watering exists (rain hook),
  whether seasons affect crops, what the earned non-coin token is (ribbons fit the county-fair theme and FV2's
  Yellow/Red/Blue mastery ribbons, https://gamelytic.com/farmville-2-crop-mastery-guide/), farm level shared or per player.
- Tech doc decides: world unit/grid cell size (this file assumes meters and a flat farm at y = 0), cursor/ping relay
  rate, server-owned sky time and weather, asset pipeline (GLB, atlases, optional KTX2).
- **Reconcile with tech-architecture.md** (written in parallel; it already agrees on r186 WebGLRenderer, Neutral tone
  mapping, PCFShadowMap, static shadow cache + blob shadows, analytic tile picking, 1 tile = 1 world unit):
  - Camera: tech §10.10 says FOV 32°, fixed pitch 55°, distance 12–60 tiles, Q/E 250 ms, wheel zooms toward the cursor.
    This file's 3.4 numbers are visual targets; keep tech's ranges and add the **tilt-zoom** (pitch eases from 55° at
    max distance to ~38° at min) — it is what makes the close-up feel like a diorama. Zoom-toward-cursor is good, keep it.
  - Left-drag: tech pans on left-drag; this file reserves a left-drag that STARTS on an actionable tile for
    paint-planting/harvesting (FV2 and Hay Day's signature gesture) and pans only when it starts on empty ground,
    plus right/middle-drag always pans. Adopt this split.
- Assets doc supplies: CC0 crop/animal/building models and sound packs that match the palette above; anything that does
  not match gets re-tinted via vertex colors/instance colors rather than rejected.
- Build a **look-dev scene first** (one field of each crop archetype at every stage, a tree of each type, two animals,
  the barn, the lake edge, both avatars) and lock lighting, tone mapping and palette from puppeteer screenshots before
  mass-producing content.

## 7. Sources

Primary (FarmVille 2):
- GDC 2013, Bagwell & McCarthy, FarmVille 2 postmortem — https://archive.org/details/GDC2013Bagwell ,
  https://gdcvault.com/play/1018015/FarmVille-2-Postmortem-What-Grew ; local transcript in `sources/`.
- https://gamesbeat.com/farmville-2-zynga/
- https://techcrunch.com/2012/09/05/zynga-finally-debuts-farmville-2-promises-to-keep-working-on-the-original-too
- https://abcnews.com/Technology/farmvile-zynga-launches-3d-online-game/story?id=17161188
- https://www.gamezebo.com/reviews/farmville-2-review/
- https://www.wwgdb.com/games/farmville_2
- https://zyngasupport.helpshift.com/hc/en/10-farmville-2/faq/116-how-do-i-harvest-crops/
- https://zyngasupport.helpshift.com/hc/en/10-farmville-2/section/22-getting-started/
- http://annaparmentier.com/video-games/2015/10/farmville2/
- http://www.tonytrujilloart.com/farmville2-1
- https://www.awn.com/news/zynga-taps-autodesk-farmville-2
- https://farmville2.fandom.com/wiki/Water , https://farmville.fandom.com/wiki/Crop_Fertilizer , https://gamelytic.com/farmville-2-prized-animal-guide/
- https://www.supercheats.com/guides/farmville/your-farmer
- Screenshots: FarmVille 2 fandom wiki file pages (Untitled.png, Farmville.png, Royals_Farms.png, Capture.jpg, I_wissh.jpg,
  Craftingcornermenu.png, 223.png, Two_Prized_Chicken_Coop.png).

Cozy games and juice:
- http://www.pocketgamer.biz/interview/79024/supercell-looking-back-10-years-of-hay-day-part-one/
- https://mobilegamer.biz/what-supercells-hay-day-team-learned-from-ten-years-of-updates/
- https://www.supercheats.com/hay-day/walkthrough/harvesting , https://hayday.fandom.com/wiki/Experience , https://hayday.fandom.com/wiki/Production_Buildings
- https://medium.com/@aarthi.design/playrixs-township-6418f4ce319d
- https://stardewvalleywiki.com/Crops , https://stardewvalleywiki.com/Day_Cycle , https://hardcoregamer.com/stardew-valley/all-weather-guide/
- https://steamcommunity.com/app/413150/discussions/0/4509877893257846983/ , https://www.nexusmods.com/stardewvalley/mods/17761
- https://www.haakondavidsen.com/post/tutorial-how-to-write-stardew-valley-music , https://www.orchestraltools.com/tips-for-cozy-game-music
- https://fontsinuse.com/uses/51354/animal-crossing-new-horizons , https://codepen.io/andymerskin/pen/NWqQydM , https://stars.library.ucf.edu/tpms/2026/saturday/7/
- https://www.pixelatedplaygrounds.com/bookclub/2024/10/21/townscaper-and-tiny-glade , https://news.ycombinator.com/item?id=29074015
- https://www.youtube.com/watch?v=jusWW2pPnA0 , https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games
- https://handwiki.org/wiki/Software:Islanders_(video_game)
- https://www.gdcvault.com/play/1016487/juice-it-or-lose , http://notebook.maryrosecook.com/Theartofscreenshake,JanWillemNijman.html
- https://valdemird.com/blog/game-feel-on-the-web/
- https://www.resetera.com/threads/dev-psa-day-night-cycle-in-your-game-please-consider-clock-speed-options.90481/
- https://github.com/khalilo-cs/-/pull/3

Three.js and web:
- https://unpkg.com/three@0.186.1/src/constants.js , https://unpkg.com/three@0.186.1/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js ,
  https://unpkg.com/three@0.186.1/src/renderers/shaders/ShaderLib/meshlambert.glsl.js (chunk order verified for the sway injection)
- https://discourse.threejs.org/t/tone-mapping-overview/75204
- https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products
- https://www.utsubo.com/blog/threejs-best-practices-100-tips , https://threejsroadmap.com/blog/draw-calls-the-silent-killer ,
  https://bersus.io/insights/creative-dev/threejs-optimizing-instancing-and-batching/
- https://threejsresources.com/guides/grass , https://threejsresources.com/guides/ui-hud
- https://douges.dev/blog/threejs-trees-1 , https://www.blendernation.com/2020/08/20/creating-ghibli-trees-in-3d/
- https://discourse.threejs.org/t/unlit-water-shader-with-foam/11641
- https://threejs.org/examples/#webgl_lights_hemisphere , https://github.com/Nugget8/Three.js-Ocean-Scene
- https://threejs.org/manual/#en/shadows
- https://gsap.com/blog/3-13/ , https://easings.net
- https://fonts.google.com/specimen/Fredoka , https://fontsource.org/fonts/baloo-2
- https://css-tricks.com/creating-patterns-with-svg-filters/ , https://css-tricks.com/grainy-gradients/
- Local: `~/wow-arena/public/js/scene.js` (quality tiers, Lambert conversion, light pool, shadow cadence).
