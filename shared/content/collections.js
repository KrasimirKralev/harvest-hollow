// Collections (GDD §5.5, L10, M1b: 8 sets in M1b, the remaining 4 in M2). 12 sets x 5 items. Each eligible action
// rolls `dropBp` (x2 for Gold-mastered sources) for a missing item of the action's set; pity: after `pity` eligible
// actions without a new item of that set, the next eligible action drops one. Duplicates trade 3 -> 1 missing item.
// Completing a set: 5 Acorns, a display piece (decor) and a small permanent perk. `from` names the eligible actions.

export const COLLECTION_RULES = { unlock: 10, dropBp: 200, goldMul: 2, pity: 40, tradeIn: 3, acorns: 5,
  longCropMs: 14_400_000, oldCoinRollCoins: 100 };

/**
 * The closed vocabulary of a set's `from` tokens: `verb` or `verb:arg`. `arg` names a content def or class as noted;
 * `m` is the milestone whose system makes the verb happen at all (validateContent checks both against the set).
 *   craft[:<buildingId>]            collecting a crafted good (of that building)
 *   harvest:<itemClass>             harvesting a crop of the class ('flower')
 *   harvest:long                    harvesting a crop of >= COLLECTION_RULES.longCropMs
 *   harvest:flowering_tree          harvesting a tree with `flowering: true`
 *   collect:<animalId>              collecting from that animal (a pig's truffle dig, a hive's honey)
 *   clear[:<debrisId>]              clearing debris (of that kind)
 *   chop                            a chop with the Axe (stumps, logs, boulders, giant crops)
 *   enter:fair                      a County Fair entry
 *   sell                            a Market sale: a roll per COLLECTION_RULES.oldCoinRollCoins coins (min 1 a sale)
 *   coop                            a co-op deed: help fill, keepsake, high-five, Golden Hour
 *   fish                            a cast at the Fishing Dock
 */
export const COLLECTION_SOURCES = { craft: 'M1a', harvest: 'M1a', collect: 'M1a', clear: 'M1a', chop: 'M1a',
  enter: 'M1b', sell: 'M1a', coop: 'M1a', fish: 'M2' };

const set = (id, name, m, from, items, perk, perkText) => ({ id, name, m, from, items, perk, perkText,
  display: `${id}_display` });

export const COLLECTIONS = [
  set('recipe_cards', 'Grandma\'s Recipe Cards', 'M1b', ['craft'],
    [['recipe_bread', 'Bread card'], ['recipe_jam', 'Jam card'], ['recipe_pie', 'Pie card'], ['recipe_soup',
      'Soup card'],
      ['recipe_cake', 'Cake card']], { craftXpBp: 200 }, '+2 % craft XP'),
  set('butterflies', 'Garden Butterflies', 'M1b', ['harvest:flower', 'harvest:flowering_tree'],
    [['cabbage_white', 'Cabbage White'], ['peacock_butterfly', 'Peacock'], ['swallowtail', 'Swallowtail'],
      ['blue_morpho', 'Blue Morpho'], ['monarch', 'Monarch']], { beauty10: 200, cosmetic: 'butterflies' },
    'Butterflies around the farm, +20 beauty'),
  set('lost_tools', 'Lost Tools', 'M1b', ['clear', 'chop'],
    [['rusty_trowel', 'Rusty Trowel'], ['old_pitchfork', 'Old Pitchfork'], ['brass_oil_can', 'Brass Oil Can'],
      ['nail_tin', 'Horseshoe Nail Tin'], ['pocket_knife', 'Grandpa\'s Pocket Knife']], { chopsLess: 1, minChops: 3 },
    'Chopping needs 1 fewer chop (min 3)'),
  set('feathers', 'Feathers', 'M1b', ['collect:chicken', 'collect:duck'],
    [['speckled_feather', 'Speckled Feather'], ['barred_feather', 'Barred Feather'], ['copper_feather',
      'Copper Feather'],
      ['golden_feather_piece', 'Golden Feather'], ['peacock_feather', 'Peacock Feather']], { bonusEggBp: 200 },
    '+2 % bonus-egg chance'),
  set('heirloom_seeds', 'Heirloom Seeds', 'M1b', ['harvest:long'],
    [['purple_carrot_tin', 'Purple Carrot'], ['moon_melon_tin', 'Moon Melon'], ['blue_corn_tin', 'Blue Corn'],
      ['black_tomato_tin', 'Black Tomato'], ['striped_beet_tin', 'Striped Beet']], { seedBp: 300 }, 'Seeds -3 %'),
  set('pond_treasures', 'Pond Treasures', 'M2', ['collect:duck', 'fish'],
    [['sea_glass', 'Sea-glass'], ['snail_shell', 'Snail Shell'], ['old_bottle', 'Old Bottle'],
      ['frog_figurine', 'Frog Figurine'], ['silver_spoon', 'Silver Spoon']], { beauty10: 200, cosmetic: 'dock_fish' },
    '+20 beauty, dock fish animation'),
  set('fossils', 'Fossils & Arrowheads', 'M1b', ['clear:rock', 'clear:boulder', 'collect:pig'],
    [['ammonite', 'Ammonite'], ['trilobite', 'Trilobite'], ['arrowhead', 'Arrowhead'], ['shark_tooth', 'Shark Tooth'],
      ['fern_fossil', 'Fern Fossil']], { truffleBp: 500 }, '+5 % bonus-truffle chance'),
  set('honey_jars', 'Honey Jars', 'M1b', ['collect:bee'],
    [['clover_jar', 'Clover Honey'], ['blossom_jar', 'Apple-blossom Honey'], ['lavender_jar', 'Lavender Honey'],
      ['sunflower_jar', 'Sunflower Honey'], ['heather_jar',
        'Heather Honey']], { forageRadius: 1 }, 'Hive forage radius +1'),
  set('buttons', 'Buttons & Thimbles', 'M1b', ['craft:weaver', 'craft:sewing'],
    [['wooden_button', 'Wooden Button'], ['brass_button', 'Brass Button'], ['thimble', 'Thimble'],
      ['pincushion', 'Pincushion'], ['silver_needle', 'Silver Needle']], { sewingTimeBp: 300 }, 'Sewing -3 % time'),
  set('fair_rosettes', 'Fair Rosettes', 'M2', ['enter:fair'],
    [['yellow_rosette', 'Yellow Rosette'], ['red_rosette', 'Red Rosette'], ['blue_rosette', 'Blue Rosette'],
      ['purple_rosette', 'Purple Rosette'], ['rainbow_rosette',
        'Rainbow Rosette']], { fairPointsBp: 300 }, 'Fair points +3 %'),
  set('old_coins', 'Old Coins', 'M2', ['sell'],
    [['copper_penny', 'Copper Penny'], ['silver_sixpence', 'Silver Sixpence'], ['old_florin', 'Old Florin'],
      ['gold_sovereign', 'Gold Sovereign'], ['lucky_coin', 'Lucky Coin']], { demandUnits: 10 },
    'Market Demand cap 50 -> 60 units'),
  set('love_notes', 'Love Notes', 'M2', ['coop'],
    [['first_note', 'First Note'], ['pressed_flower', 'Pressed Flower'], ['ticket_stub', 'Ticket Stub'],
      ['polaroid', 'Polaroid'], ['ribbon_letter',
        'Ribbon-tied Letter']], { goldenHourMs: 300_000 }, 'Golden Hour +5 min'),
].map((s) => ({ ...s, items: s.items.map(([id, name]) => ({ id, name })) }));

/** Old Coins roll once per this many coins of Market sales (min 1 per sale; GDD §5.5 v2 C8). */
export const OLD_COIN_ROLL_COINS = COLLECTION_RULES.oldCoinRollCoins;
