// The farmhouse interior and Grandma's visit (GDD §5.9 Restoration 6 "Grandma's Farmhouse": interior decorating, the
// Memory Book wall, Grandma's duet table (+1 Kitchen slot) and Grandma's visit; §5.3 quest E10). M2, hand-authored.
// The interior is cosmetic: furniture gives no XP, no Farm Beauty and no production, so it can never be part of a
// refund or XP loop. It is a late-game coin sink for a couple who like to make a home.
import { h } from './units.js';

/**
 * The room: a floor grid of `grid` [w, d] tiles (1 tile = 1 m inside), x to the right, z away from the back wall.
 * Wall pieces hang on wall slots: the back wall (z = 0, slot i above floor tile x = i, the door in it) and the left
 * wall (x = 0, slot i beside floor tile z = i). Floor pieces (rugs) use the `floor` layer under the `object` layer,
 * like paths outside. `fixed` pieces arrive with the room and never move; `keepClear` floor rects stay free (the
 * door, the hearth, the duet table's bench). The room opens when Restoration project 6 is complete (`needsProject`).
 * Rules (rules-economy): buy from the catalog (coins, BIG_SPEND applies; `max` copies), place / move / store freely
 * (timers do not exist inside); a piece never placed is refunded in full inside SAFETY.undoMs, and furniture is
 * never sold, so nothing inside can mint coins.
 */
export const INTERIOR = {
  m: 'M2',
  needsProject: 'farmhouse',
  // wave 3: the room render-world built (render/interior-view.js ROOM 10 x 8 m, its built-in cells and spots)
  grid: [10, 8],
  walls: { back: 10, left: 8 },
  layers: ['floor', 'object'],
  fixed: [
    { def: 'fireplace', x: 4, z: 0 },
    { def: 'keepsake_shelf', x: 1, z: 0 },
    { def: 'ribbon_wall', wall: 'back', at: 6 },
    { def: 'memory_wall', wall: 'left', at: 1 },
    { def: 'farmhouse_window', wall: 'left', at: 4 },
    { def: 'duet_table', x: 1, z: 5, movable: true },
  ],
  // the chimney breast takes back-wall slots 4-5, the door back-wall slots 8-9 (and its floor cells)
  wallBlocked: { back: [4, 5, 8, 9], left: [] },
  // the door and the walk in, the hearth's rug spot, the bench seat at the duet table
  keepClear: [[8, 0, 2, 2], [4, 1, 2, 1], [2, 4, 1, 1]],
  door: { wall: 'back', at: 8, w: 2 },
  refund: 'undo',
};

const piece = (id, name, cat, layer, size, cost, extra = {}) => ({ id, name, m: 'M2', kind: 'furniture', cat, layer,
  size, cost, shop: true, max: 1, model: `furniture/${id}`, ...extra });
const fixed = (id, name, layer, size, text) => ({ id, name, m: 'M2', kind: 'furniture', cat: 'fixed', layer, size,
  cost: 0, shop: false, max: 1, fixed: true, model: `furniture/${id}`, text });

/**
 * The furniture catalog (CONTENT.furniture). `layer` 'object' | 'floor' | 'wall'; a wall piece's size is [slots, 1].
 * Prices are E(34) x hours, 2 significant digits (E(34) = 260,000 coins an hour of play), 0.008-0.15 h each: the
 * whole catalog is about 1.4 hours of income at the room's level, a sink that never competes with land or buildings.
 */
export const FURNITURE = [
  // the room's own pieces (arrive with it)
  fixed('memory_wall', 'Memory Book Wall', 'wall', [3, 1], 'Every page of your Memory Book, framed.'),
  fixed('ribbon_wall', 'Ribbon Wall', 'wall', [2, 1], 'Your ribbons and rosettes, all in one place.'),
  fixed('keepsake_shelf', 'Grandma\'s Keepsake Dresser', 'object', [2, 1], 'The keepsakes you gave each other.'),
  fixed('farmhouse_window', 'Garden Window', 'wall', [3, 1], 'It looks out over the fields.'),
  fixed('fireplace', 'Stone Hearth', 'object', [2, 1], 'Grandma\'s hearth, swept and lit again.'),
  fixed('duet_table', 'Grandma\'s Duet Table', 'object', [3, 2],
    'Room for two cooks: one more Farm Kitchen slot.'),
  // seating
  piece('armchair', 'Grandma\'s Armchair', 'seating', 'object', [1, 1], 7800),
  piece('sofa', 'Chesterfield Sofa', 'seating', 'object', [3, 1], 21_000, { seats: 2 }),
  piece('window_seat', 'Window Seat', 'seating', 'object', [2, 1], 13_000, { seats: 2 }),
  piece('footstool', 'Footstool', 'seating', 'object', [1, 1], 2600),
  piece('rocking_horse', 'Rocking Horse', 'seating', 'object', [1, 1], 5200),
  // tables
  piece('dining_table', 'Farmhouse Table', 'tables', 'object', [3, 2], 23_000),
  piece('side_table', 'Side Table', 'tables', 'object', [1, 1], 3900, { max: 2 }),
  piece('writing_desk', 'Writing Desk', 'tables', 'object', [2, 1], 13_000),
  piece('tea_trolley', 'Tea Trolley', 'tables', 'object', [1, 1], 6500),
  // comfort and storage
  piece('daybed', 'Quilted Daybed', 'comfort', 'object', [3, 2], 26_000),
  piece('hope_chest', 'Hope Chest', 'comfort', 'object', [2, 1], 10_000),
  piece('bookcase', 'Bookcase', 'comfort', 'object', [2, 1], 16_000),
  piece('dresser', 'Painted Dresser', 'comfort', 'object', [2, 1], 13_000),
  // kitchen corner
  piece('range_stove', 'Cast-iron Range', 'kitchen', 'object', [2, 1], 31_000),
  piece('kitchen_hutch', 'Kitchen Hutch', 'kitchen', 'object', [2, 1], 18_000),
  piece('butter_churn', 'Butter Churn', 'kitchen', 'object', [1, 1], 3900),
  // music
  piece('piano', 'Upright Piano', 'music', 'object', [2, 1], 39_000),
  piece('gramophone', 'Gramophone', 'music', 'object', [1, 1], 16_000),
  // lights and plants
  piece('floor_lamp', 'Floor Lamp', 'lights', 'object', [1, 1], 5200, { max: 2, glow: true }),
  piece('candle_stand', 'Candle Stand', 'lights', 'object', [1, 1], 3100, { max: 2, glow: true }),
  piece('fern_pot', 'Potted Fern', 'plants', 'object', [1, 1], 2100, { max: 2 }),
  piece('lemon_pot', 'Potted Lemon Tree', 'plants', 'object', [1, 1], 7800),
  piece('pet_bed', 'Pet Bed by the Fire', 'plants', 'object', [1, 1], 2600, { max: 2 }),
  // rugs (floor layer)
  piece('rag_rug', 'Rag Rug', 'rugs', 'floor', [2, 2], 3900),
  piece('braided_rug', 'Round Braided Rug', 'rugs', 'floor', [3, 3], 10_000),
  piece('hall_runner', 'Hall Runner', 'rugs', 'floor', [1, 3], 3100),
  // walls
  piece('valley_painting', 'Painting of the Hollow', 'walls', 'wall', [2, 1], 13_000),
  piece('cuckoo_clock', 'Cuckoo Clock', 'walls', 'wall', [1, 1], 7800),
  piece('quilt_hanging', 'Quilt Hanging', 'walls', 'wall', [2, 1], 10_000),
  piece('oval_mirror', 'Oval Mirror', 'walls', 'wall', [1, 1], 5200),
  piece('plate_rack', 'Plate Rack', 'walls', 'wall', [2, 1], 6500),
  piece('couple_photo', 'Photo of the Two of You', 'walls', 'wall', [1, 1], 2600),
  // rewards (never sold): Grandma's farewell gift and quest H7's frame
  { ...piece('hazel_portrait', 'Grandma\'s Portrait', 'walls', 'wall', [1, 1], 0), shop: false,
    source: 'grandma_visit', text: 'Grandma Hazel at twenty, laughing at whoever held the camera.' },
  { ...piece('memory_frame', 'Gilded Memory Frame', 'walls', 'wall', [2, 1], 0), shop: false, source: 'quest:h7',
    text: 'The view from Sunset Hill, in gold leaf.' },
];

/**
 * Grandma's visit (GDD §5.3: "at the end of the Farmhouse restoration Grandma comes to visit"; quest E10 at L38; the
 * story beat `grandma_visits`). When E10 completes, Grandma Hazel stays on the farm for `stayMs`: an NPC at the
 * farmhouse porch who strolls between `stops` (render-world stages her, `strollMs` per stop, deterministic from the
 * server clock so both screens agree). Clicking her shows one of the stop's lines (in order, then repeating). A
 * farmer who was away sees the visit card on their next login (`missedCard`) and her letter stays in the Journal.
 * On leaving she gives `gift` (a furniture piece for the room) and a Memory Book page is offered to both.
 */
export const GRANDMA_VISIT = {
  m: 'M2',
  quest: 'e10',
  beat: 'grandma_visits',
  stayMs: h(72),
  strollMs: h(1),
  stops: ['porch', 'field', 'orchard', 'barnyard', 'bench', 'parlour'],
  gift: { furniture: 'hazel_portrait' },
  memory: true,
  lines: {
    arrive: [
      'Well. Look what you two have done.',
      'Don\'t fuss, I can carry my own bag. Mostly. Oh, go on then.',
    ],
    porch: [
      'Your grandfather proposed on this step. He was so nervous he sat on the cat.',
      'I used to watch the sun go down from here. It looks better with the two of you in front of it.',
    ],
    field: [
      'Wheat in a minute! In my day we waited all summer and complained about it all winter.',
      'Neat rows. Somebody is a perfectionist, and somebody else is very patient with them.',
    ],
    orchard: [
      'My apple tree! Look at it. It was a twig when I planted it, and so was I, nearly.',
      'Juniper says the trees remember who watered them. They certainly remember you.',
    ],
    barnyard: [
      'Clover\'s great-great-granddaughter, I suppose? She has the same look. Utterly unimpressed.',
      'Every animal here has a name. That is how I know it is a real farm.',
    ],
    bench: [
      'Sit with me a minute. No, both of you. There is room if you squeeze.',
      'Golden Hour still works. I told him it was us, not the light. I was right.',
    ],
    parlour: [
      'You kept the hearth. And the table! I baked a thousand pies on that table.',
      'All your pages on one wall. Oh, look at that one. You both have flour in your hair.',
    ],
    leave: [
      'The taxi is here, and I have stayed far too long and not nearly long enough.',
      'Keep each other warm, keep the bench painted, and write to me. Both of you. Separately, so I hear both sides.',
    ],
  },
  letter: {
    greeting: 'My dears,', art: 'farmhouse', signoff: 'All my love, always, Grandma Hazel',
    body: [
      'Home again by the sea, and the house is far too quiet. I keep setting out two extra cups.',
      'I left you something for the parlour wall. Hang it somewhere it can see the two of you; I like to keep an '
        + 'eye on things.',
    ],
  },
  missedCard: 'Grandma Hazel came to visit while you were away. She left a letter, and she left the bench warm.',
};
