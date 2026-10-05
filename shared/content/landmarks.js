// Landmarks and debris: placeable defs that exist on the farm but are never sold in the store (shop: false).
// Hand-authored (GDD §2.3 starting farm, §2.3 / §4.5 debris values).

/**
 * The structures of the Homestead (GDD §2.3: where they stand at minute zero). `panel` names the UI panel a click
 * opens. Owner change 2026-10-04: every one of them moves with the Hammer (and turns), like any building; they are
 * still never bought, stored or sold. `movable: false` (debris) means the Hammer cannot pick a def up. The river,
 * the jetty, the land features' docks and the village are scenery outside the farm board, not objects: they stay.
 */
export const LANDMARKS = [
  { id: 'farmhouse', name: 'Farmhouse', m: 'M1a', kind: 'landmark', layer: 'object', size: [4, 4], shop: false,
    movable: true, panel: 'journal', model: 'landmarks/farmhouse',
    text: 'Grandma Hazel\'s farmhouse. The Memory Book, the Ribbon Wall and the wardrobe live inside.' },
  { id: 'barn', name: 'Barn', m: 'M1a', kind: 'landmark', layer: 'object', size: [4, 4], shop: false, movable: true,
    panel: 'barn', model: 'landmarks/barn', text: 'Everything the farm makes is stored here. Its doors bump '
      + 'when goods fly in.' },
  { id: 'well', name: 'Well', m: 'M1a', kind: 'landmark', layer: 'object', size: [2, 2], shop: false, movable: true,
    panel: null, model: 'landmarks/well', text: 'The Watering Can is refilled here (and never runs dry).' },
  { id: 'mailbox', name: 'Mailbox', m: 'M1a', kind: 'landmark', layer: 'object', size: [1, 1], shop: false,
    movable: true, panel: 'letters', model: 'landmarks/mailbox', text: 'Grandma\'s letters and your partner\'s '
      + 'notes.' },
  { id: 'market_stand', name: 'Market Stand', m: 'M1a', kind: 'landmark', layer: 'object', size: [2, 2], shop: false,
    movable: true, panel: 'market', model: 'landmarks/market_stand',
    text: 'Sell anything, any amount, at once. Mabel\'s chalkboard shows the Market Demand.' },
  { id: 'order_board', name: 'Mabel\'s Order Board', m: 'M1a', kind: 'landmark', layer: 'object', size: [2, 1],
    shop: false, movable: true, panel: 'orders', unlock: 2, model: 'landmarks/order_board',
    text: 'Orders pay more than the market, and they never expire.' },
  // The restored Old Greenhouse (GDD §5.9 Restoration 1, M1b): a frame on the GROUND layer whose 12 plots (object
  // layer) sit inside it, beyond the plot cap and always in season. It arrives in the build tray when the project
  // is complete (rules: actions/restoration.js greenhouseDef()), so the couple chooses where it stands.
  { id: 'greenhouse', name: 'Old Greenhouse', m: 'M1b', kind: 'landmark', layer: 'ground', size: [6, 4], shop: false,
    movable: true, panel: null, greenhouse: { plots: 12 }, unlock: 16, model: 'landmarks/greenhouse',
    text: 'Twelve plots under glass: beyond the plot cap and always in season.' },
];

/**
 * Debris (GDD §2.3, §4.5). Weeds and rocks are cleared with one click of the Hand; stumps, logs, boulders and
 * big stumps are chopped with the Axe: each chop deals 10 damage (`hp` / 10 chops; 15 when the previous chop was
 * the OTHER player's within 2 s, for `teamwork` pieces: GDD §6.2 mechanic 8). XP depends on where the piece came
 * from (`xp.home` starter, `xp.expansion` new land, `xp.regrow` regrown); coins = DEBRIS_RULES.coinsPerXp per XP.
 * `wood` is paid on clearing. Regrowth (GDD §2.3, X4): one weed or rock per real hour on a free unlocked tile.
 */
export const DEBRIS = [
  { id: 'weed', name: 'Weeds', m: 'M1a', kind: 'debris', layer: 'object', size: [1, 1], shop: false, movable: false,
    tool: 'hand', hp: 10, teamwork: false, xp: { home: 1, expansion: 2, regrow: 1 }, wood: 0, regrows: true,
    model: 'debris/weed' },
  { id: 'rock', name: 'Rock', m: 'M1a', kind: 'debris', layer: 'object', size: [1, 1], shop: false, movable: false,
    tool: 'hand', hp: 10, teamwork: false, xp: { home: 1, expansion: 4, regrow: 1 }, wood: 0, regrows: true,
    model: 'debris/rock' },
  { id: 'stump', name: 'Stump', m: 'M1a', kind: 'debris', layer: 'object', size: [1, 1], shop: false, movable: false,
    tool: 'axe', hp: 40, teamwork: false, xp: { home: 2, expansion: 8, regrow: 0 }, wood: 2, regrows: false,
    model: 'debris/stump' },
  { id: 'log', name: 'Fallen Log', m: 'M1a', kind: 'debris', layer: 'object', size: [2, 1], shop: false,
    movable: false, tool: 'axe', hp: 40, teamwork: false, xp: { home: 2, expansion: 8, regrow: 0 }, wood: 3,
    regrows: false, model: 'debris/log' },
  { id: 'boulder', name: 'Boulder', m: 'M1a', kind: 'debris', layer: 'object', size: [2, 2], shop: false,
    movable: false, tool: 'axe', hp: 60, teamwork: true, xp: { home: 5, expansion: 20, regrow: 0 }, wood: 0,
    regrows: false, model: 'debris/boulder' },
  // ASSUMPTION (GDD §4.5 gives only its XP): a big stump yields twice a stump's Wood
  { id: 'big_stump', name: 'Big Stump', m: 'M2', kind: 'debris', layer: 'object', size: [2, 2], shop: false,
    movable: false, tool: 'axe', hp: 60, teamwork: true, xp: { home: 30, expansion: 30, regrow: 0 }, wood: 4,
    regrows: false, model: 'debris/big_stump' },
];

/** Debris economy constants (GDD §2.3, X4). */
export const DEBRIS_RULES = {
  coinsPerXp: 5,
  chopDamage: 10,
  teamworkChopDamage: 15,
  teamworkWindowMs: 2000,
  regrowEveryMs: 3_600_000,
  regrowMax: 12,
  regrowKinds: ['weed', 'rock'],
};
