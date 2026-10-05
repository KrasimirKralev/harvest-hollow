// The owners' wave-4 wish list (2026-10-04), the content half: Homestead upgrades (wish E), clearable wild weeds
// (wish F) and the character look catalog (wish 9). Hand-authored; the rules read these through index.js
// (shared/rules/upgrades.js, actions/weeds.js, actions/avatar.js keep fallbacks of the same shape).
import { min } from './units.js';

/**
 * Homestead upgrades (owner wish E): the Farmhouse, the Well, the Market Stand and the benches improve in three tiers.
 * Shape (shared/rules/upgrades.js): `{ [target]: { name, defs, tiers: [{ name, unlock, coins, items, bonus, text,
 * look }] } }`. Tiers are bought in order by either player; an object's `up` counts the tiers bought. `bonus` is the
 * WHOLE bonus at that tier (never added to the tiers below), so a card shows "now / next" without summing:
 *   well          waterBp      basis points of the base grow time added to every watering (crops and trees; the
 *                              GROWTH.timeFloorBp floor holds): 15 % becomes 17.5 / 20 / 22.5 %
 *   market_stand  demandUnits  more Market Demand units a day at the Demand price;
 *                 sellBp       added to every Market Stand sale (a small permanent edge, far below what orders pay)
 *   farmhouse     barnCap      more Barn capacity (the pantry and the cellar); restedBp: rested XP fills faster
 *   bench         goldenMs     a Golden Hour started on THIS bench lasts longer (per bench, not farm-wide)
 * `look` names the visible change for the renderer (cumulative: tier 3 shows the tier-1 and tier-2 changes too).
 *
 * Prices follow the rest of the economy (GDD §4.3): coins = nice(E(unlock) x hours), in the hours below, plus Planks
 * and Wooden Crates like the Barn upgrades (the Sawmill opens at L6, so a tier before L6 asks only coins). Every
 * first tier is open by L11, so the couple on the live farm (L11-12) can start on all four at once; the last tiers
 * spread to L21 so there is always a next one. Hours: farmhouse 0.6, well 0.3, Market Stand 0.4, bench 0.2.
 */
export const UPGRADES = {
  farmhouse: {
    name: 'Farmhouse', defs: ['farmhouse'],
    tiers: [
      { name: 'Porch Swing & Window Boxes', unlock: 6, coins: 7200, items: { planks: 3 },
        bonus: { barnCap: 30 }, look: 'porch_swing',
        text: 'A porch swing and flower boxes under the windows; the pantry holds 30 more goods' },
      { name: 'Glass Sunroom', unlock: 12, coins: 24_000, items: { planks: 6, wooden_crate: 1 },
        bonus: { barnCap: 60, restedBp: 2500 }, look: 'sunroom',
        text: 'A bright sunroom on the side wing: 60 more goods, rested XP fills 25 % faster' },
      { name: 'Weathervane & Lamp-lit Path', unlock: 18, coins: 58_000, items: { planks: 8, wooden_crate: 2 },
        bonus: { barnCap: 100, restedBp: 5000 }, look: 'weathervane',
        text: 'A copper rooster on the roof and lamps along the path: 100 more goods, rested XP 50 % faster' },
    ],
  },
  well: {
    name: 'Well', defs: ['well'],
    tiers: [
      { name: 'Stone Rim', unlock: 5, coins: 2800, items: {}, bonus: { waterBp: 250 }, look: 'stone_rim',
        text: 'A fresh stone rim: watering saves 2.5 % more time (crops 17.5 %, trees 22.5 %)' },
      { name: 'Crank & Bucket', unlock: 10, coins: 7500, items: { planks: 3 }, bonus: { waterBp: 500 },
        look: 'crank', text: 'A crank and a big bucket: watering saves 5 % more time (crops 20 %, trees 25 %)' },
      { name: 'Shingled Roof', unlock: 16, coins: 23_000, items: { planks: 6, wooden_crate: 1 },
        bonus: { waterBp: 750 }, look: 'roof',
        text: 'A little shingled roof: watering saves 7.5 % more time (crops 22.5 %, trees 27.5 %)' },
    ],
  },
  market_stand: {
    name: 'Market Stand', defs: ['market_stand'],
    tiers: [
      { name: 'Striped Awning', unlock: 11, coins: 13_000, items: { planks: 3 }, bonus: { demandUnits: 10 },
        look: 'awning', text: 'A striped awning draws a crowd: 10 more Market Demand units a day' },
      { name: 'Chalkboard & Scales', unlock: 15, coins: 28_000, items: { planks: 5, wooden_crate: 1 },
        bonus: { demandUnits: 20, sellBp: 100 }, look: 'chalkboard',
        text: '20 more Demand units a day, and everything sells for 1 % more' },
      { name: 'Flower Cart', unlock: 21, coins: 52_000, items: { planks: 7, wooden_crate: 2 },
        bonus: { demandUnits: 30, sellBp: 200 }, look: 'cart',
        text: '30 more Demand units a day, and everything sells for 2 % more' },
    ],
  },
  bench: {
    name: 'Bench', defs: ['sunset_bench', 'bench_swing'],
    tiers: [
      { name: 'Soft Cushions', unlock: 4, coins: 1000, items: {}, bonus: { goldenMs: min(5) }, look: 'cushions',
        text: 'Plump cushions: a Golden Hour started on this bench lasts 35 minutes' },
      { name: 'Flower Planters', unlock: 8, coins: 3200, items: { planks: 2 }, bonus: { goldenMs: min(10) },
        look: 'planters', text: 'Planters at each end: a Golden Hour here lasts 40 minutes' },
      { name: 'Lantern Arch', unlock: 14, coins: 11_000, items: { planks: 3, wooden_crate: 1 },
        bonus: { goldenMs: min(15) }, look: 'lantern_arch',
        text: 'An arch with a lantern that glows at night: a Golden Hour here lasts 45 minutes' },
    ],
  },
};

/**
 * Clearable wild weeds (owner wish F): the grass tufts with yellow flowers on the farm's own land are pulled with the
 * Hand, for good and for both players (shared/rules/actions/weeds.js). A tiny reward: `coins` for each of the first
 * `dailyCap` tiles of a farm day, no XP (they never regrow, so this can never become a farm); scenery outside the
 * farm's land stays.
 */
export const WEEDS = { unlock: 1, tool: 'hand', coins: 2, dailyCap: 20, m: 'M1a' };

const look = (id, name, hex) => (hex ? { id, name, hex } : { id, name });

/**
 * Character looks (owner wish 9): what the look editor offers, from the two existing avatar rigs. Ids are what
 * `players[pid].avatar` stores (rules: setAvatar); colours are '#RRGGBB' (any colour is valid, these are the swatches
 * the editor shows first). `defaults` is the look of a player who never changed it (the slot's rig and colours, so
 * nobody looks different after the update). Free: the Hearts shop still sells the special pieces.
 */
export const AVATAR_LOOKS = {
  m: 'M1a',
  bodies: [look('farmer_a', 'Build A'), look('farmer_b', 'Build B')],
  hair: [look('short', 'Short'), look('long', 'Long'), look('ponytail', 'Ponytail'), look('bun', 'Bun'),
    look('curly', 'Curly'), look('braid', 'Braid'), look('buzz', 'Buzz cut')],
  hats: [look('none', 'No hat'), look('straw_hat', 'Straw hat'), look('cap', 'Farm cap'), look('beanie', 'Beanie'),
    look('sun_bonnet', 'Sun bonnet'), look('cowboy_hat', 'Cowboy hat'), look('flower_crown', 'Flower crown')],
  hairColors: [look('black', 'Black', '#2A2420'), look('dark_brown', 'Dark brown', '#4A3022'),
    look('chestnut', 'Chestnut', '#7A4A2A'), look('auburn', 'Auburn', '#9A3E22'), look('blonde', 'Blonde', '#D9B26A'),
    look('strawberry', 'Strawberry blonde', '#D9875A'), look('silver', 'Silver', '#C9C6C2'),
    look('pink', 'Rose pink', '#E58AA8')],
  skinTones: [look('porcelain', 'Porcelain', '#F6DCC8'), look('fair', 'Fair', '#EFC9A8'),
    look('warm', 'Warm', '#DDAA82'), look('olive', 'Olive', '#C08E62'), look('tan', 'Tan', '#A06D45'),
    look('brown', 'Brown', '#7A4E30'), look('deep', 'Deep', '#563522')],
  outfitColors: [look('teal', 'Teal', '#2BB3A3'), look('coral', 'Coral', '#FF7A6B'), look('denim', 'Denim', '#3E6FA8'),
    look('sage', 'Sage', '#8DAA7A'), look('mustard', 'Mustard', '#E0B23A'), look('plum', 'Plum', '#7A4A7E'),
    look('barn_red', 'Barn red', '#B23A2E'), look('cream', 'Cream', '#F2E6CC'), look('charcoal', 'Charcoal', '#3A3A40'),
    look('sky', 'Sky', '#8CC8EA')],
  defaults: {
    p1: { body: 'farmer_a', hair: 'short', hairColor: '#4A3022', skin: '#EFC9A8', top: '#2BB3A3', bottom: '#3E6FA8',
      hat: 'straw_hat' },
    p2: { body: 'farmer_b', hair: 'long', hairColor: '#7A4A2A', skin: '#EFC9A8', top: '#FF7A6B', bottom: '#3E6FA8',
      hat: 'none' },
  },
};
