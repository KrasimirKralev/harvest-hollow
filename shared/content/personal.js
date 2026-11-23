// Personal and animal-life systems of M1b/M2 (data only in the M1a build): the Hearts shop (GDD §4.11), perks
// (§4.7, M2), rested XP (§4.7, M2), pets (§3.4, L10), the Nursery (L19) and the Breeding Barn (L28). Hand-authored.
import { h } from './units.js';

const pieces = (slot, names, lo, hi) => names.map((name, i) => ({
  id: `${slot}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, '')}`, slot, name,
  hearts: lo + Math.round(((hi - lo) * i) / Math.max(1, names.length - 1)),
}));

/** Hearts shop (personal cosmetics; Hearts can never buy anything that produces). M2: no M1b lane builds it. */
export const HEARTS_SHOP = {
  m: 'M2',
  items: [
    ...pieces('hat', ['Straw Hat', 'Sun Bonnet', 'Flat Cap', 'Bucket Hat', 'Beanie', 'Cowboy Hat', 'Flower Crown',
      'Bandana', 'Wide Brim', 'Beret', 'Earmuffs', 'Top Hat'], 10, 40),
    ...pieces('top', ['Plaid Shirt', 'Denim Jacket', 'Knit Sweater', 'Overalls Bib', 'Rain Coat', 'Striped Tee',
      'Linen Blouse', 'Hoodie', 'Waistcoat', 'Cardigan', 'Apron Dress', 'Puffer Vest'], 10, 40),
    ...pieces('bottom', ['Work Jeans', 'Cord Trousers', 'Cargo Shorts', 'Skirt', 'Dungarees', 'Culottes', 'Joggers',
      'Kilt', 'Riding Breeches', 'Sunday Slacks'], 10, 35),
    ...pieces('boots', ['Wellies', 'Work Boots', 'Sneakers', 'Clogs', 'Sandals', 'Riding Boots', 'Moccasins',
      'Snow Boots'], 10, 30),
  ],
  outfits: [
    { id: 'outfit_farmer', name: 'Farmer', hearts: 60 }, { id: 'outfit_worker', name: 'Worker', hearts: 70 },
    { id: 'outfit_casual', name: 'Casual', hearts: 80 }, { id: 'outfit_adventurer', name: 'Adventurer', hearts: 90 },
    { id: 'outfit_medieval', name: 'Medieval Dress', hearts: 100 }, { id: 'outfit_formal', name: 'Formal',
      hearts: 110 },
    { id: 'outfit_beach', name: 'Beach', hearts: 120 },
  ],
  coupleOutfit: { hearts: 50, copies: 2 },
  dyes: { count: 16, hearts: 8 },
  emotes: [['dance', 15], ['bow', 15], ['twirl', 15], ['blow_kiss', 15], ['cheer', 15], ['sleepy', 15],
    ['laugh_hard', 15], ['shrug', 15]].map(([id, hearts]) => ({ id, hearts })),
  frames: { hearts: 20 },
  toolSkins: [{ id: 'copper_sickle', hearts: 30 }, { id: 'painted_can', hearts: 50 }, { id: 'golden_sickle',
    hearts: 80 }],
  petAccessories: [{ id: 'collar', hearts: 10 }, { id: 'bandana', hearts: 15 }, { id: 'straw_hat_pet', hearts: 25 }],
};

/** Perks (M2): 1 point per 2 personal levels (max 20); four trees of five perks costing 1, 1, 2, 2, 3. Perks apply
 * only to the owner's own actions. Free respec once a week. Owner wish G (2026-10-04): a learn is confirmed first
 * (UI); once this week's free respec is used, a full respec costs `respecAcorns`; taking back the LAST perk of one
 * tree costs `refundAcornsPerPoint` x its points (2 to 6 Acorns), its points come back at once. */
export const PERKS = {
  m: 'M2', pointsEvery: 2, maxPoints: 20, costs: [1, 1, 2, 2, 3], respecMs: 604_800_000, respecAcorns: 10,
  refundAcornsPerPoint: 2,
  trees: {
    grower: [{ cropXpBp: 500 }, { seedBp: 1000 }, { bonusUnitBp: 500 }, { waterBp: 500 }, { ribbonBp: 300 }],
    rancher: [{ animalXpBp: 500 }, { babyBp: 1500 }, { doubleBp: 500 }, { freeFeedBp: 1000 }, { prizedSoonerBp: 2000 }],
    orchardist: [{ treeXpBp: 500 }, { treeWaterBp: 500 }, { bonusFruitBp: 1000 }, { treeCostBp: 1000 },
      { heirloomAt: 45 }],
    artisan: [{ craftXpBp: 500 }, { queueTimeBp: 500 }, { doubleBp: 500 }, { craftSellBp: 500 },
      { duetSecondBp: 1000 }],
  },
};

/**
 * Rested XP (GDD §4.7 "Welcome back", M2): while a player is offline (from their `lastSeenAt` to their next join) a
 * personal pool fills with `accrueBp` of their CURRENT personal level's requirement (personalXp(L+1) - personalXp(L))
 * per `perMs` of absence, integer and proportional (floor(req x bp x away / (10000 x perMs))), capped at `capBp`
 * of one requirement. Until the pool is used up every personal XP gain of that player is doubled (`bonusMul` 2: the
 * extra part, min(pool, gain), comes out of the pool). Farm XP is never touched, so the farm level, unlocks and the
 * partner's numbers stay exactly as they were (no co-op cost, no exploit: logging out cannot mint farm XP).
 */
export const RESTED = { m: 'M2', unlock: 12, bp: 500, perMs: h(8), capBp: 15_000, bonusMul: 2 };

/**
 * Pets (L10, M1b): one each, a dog or a cat; one treat a day brings the owner a find the next morning.
 * Owner wish 6 (2026-10-04): three breeds a kind, chosen when adopting and changeable for free in the pet panel
 * (`pet.breed`; a pet without one shows its kind's FIRST breed, so older saves keep a look: the Shiba Inu and the
 * orange tabby are the pre-wave-4 models). `coat` / `accent` /
 * `eyes` are the renderer's and the panel's swatches. Owner wish 4: pets sleep at night: from `sleep.from` the dog
 * walks to its Dog House and the cat to its Basket (or to the farmhouse porch without one) and sleep with a 💤 bubble
 * until `sleep.to` of the shared day/night cycle (cosmetic, render only: no rule reads it).
 */
export const PETS = {
  unlock: 10, m: 'M1b',
  kinds: [{ id: 'dog', name: 'Dog', home: 'dog_house', treat: 'dog_biscuit', breeds: [
    { id: 'shiba', name: 'Shiba Inu', coat: '#D9873A', accent: '#FFF3E0', eyes: '#2A1A10' },
    { id: 'husky', name: 'Husky', coat: '#5E6670', accent: '#F4F6F8', eyes: '#7FC4FF' },
    { id: 'shepherd', name: 'German Shepherd', coat: '#8A5A2B', accent: '#2A2018', eyes: '#4A2E1A' },
  ] }, { id: 'cat', name: 'Cat', home: 'cat_basket', treat: 'cat_treat', breeds: [
    { id: 'orange', name: 'Orange Tabby', coat: '#E8892E', accent: '#FFE2B8', eyes: '#7BB04A' },
    { id: 'black', name: 'Black Cat', coat: '#26222A', accent: '#3A3440', eyes: '#F5D33A' },
    { id: 'white', name: 'White Cat', coat: '#F4F1EC', accent: '#F6C9CF', eyes: '#7FB8E8' },
  ] }],
  breedChange: { coins: 0, acorns: 0 },
  sleep: { from: 'dusk', to: 'dawn', bubble: '💤' },
  finds: [{ seedPacket: 1 }, { items: { compost: 3 } }, { collectionRoll: true }],
  bothPettedBonusFind: true,
};

/** Animal Nursery (L19, M2): a 3-step care card, each step 1 Baby Bottle, at least 10 minutes apart. */
export const NURSERY = {
  unlock: 19, m: 'M2', steps: ['feed', 'play', 'groom'], stepGapMs: 600_000, bottlesPerStep: 1,
  personalities: ['sleepy', 'playful', 'grumpy'],
  specialties: [{ id: 'bountiful', bonusBp: 500 }, { id: 'tidy', compostPoints: 1 }],
};

/** Breeding Barn (L28, M2): 2 adults of a species; a baby after 2 x the baby time with a coat variant. */
export const BREEDING = {
  unlock: 28, m: 'M2', timeMul: 2, cost: { bottles: 2, poultryFeed: 2 },
  coats: [{ id: 'white', bp: 4000 }, { id: 'brown', bp: 3000 }, { id: 'spotted', bp: 2500 }, { id: 'golden', bp: 500 }],
  goldenPity: 20,
  /** The Seasonal Ribbon Track's season-exclusive coats (SEASONAL_TRACK.rewards `{ coat: 'season' }`): never rolled
   * by breeding, only given by the track; the couple puts it on one animal of their choice (cosmetic). */
  seasonCoats: [{ id: 'blossom', season: 'spring', hue: '#F4B6C8' }, { id: 'sunkissed', season: 'summer',
    hue: '#F2C46B' }, { id: 'russet', season: 'autumn', hue: '#B5562E' }, { id: 'frost', season: 'winter',
    hue: '#DDE8F2' }],
  /** Species that can be bred (bees live in colonies, so no Breeding Barn pairs for them). */
  species: ['chicken', 'cow', 'sheep', 'pig', 'duck', 'goat', 'horse', 'alpaca'],
};
