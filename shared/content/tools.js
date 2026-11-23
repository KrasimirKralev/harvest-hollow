// Tools and brushes (GDD §3.7, §7.1). Tools are farm-wide (both players get them). `acts` lists what a click or a
// drag stroke with the tool does on each target kind; `brush` is the footprint a stroke paints per step
// ([w, d] tiles). Brush upgrades are bought once in the Market's Tools tab and replace the base brush of the tool
// named by `upgrades`. `key` is the default tray key (1-9; the tray shows only unlocked tools).

export const TOOLS = [
  { id: 'hand', name: 'Hand', m: 'M1a', unlock: 1, cost: 0, brush: [1, 1], key: 1,
    acts: ['harvest', 'plant', 'water', 'tend', 'collect', 'shake', 'clear', 'pet', 'uproot'],
    text: 'Does the obvious thing: harvest, plant your chosen seed, water, tend, collect, clear weeds, pet. '
      + 'Shift uproots.' },
  { id: 'seed_bag', name: 'Seed Bag', m: 'M1a', unlock: 1, cost: 0, brush: [1, 1], key: 2, acts: ['plant'],
    text: 'Plant the chosen crop; drag to paint a field.' },
  { id: 'sickle', name: 'Sickle', m: 'M1a', unlock: 1, cost: 0, brush: [1, 1], key: 3, acts: ['harvest'],
    text: 'Harvest ripe crops; drag across a field.' },
  { id: 'watering_can', name: 'Watering Can', m: 'M1a', unlock: 4, cost: 0, brush: [1, 1], key: 4, acts: ['water'],
    text: 'Water crops of 30 minutes or more and trees: they grow faster. Free, forever.' },
  { id: 'feed_scoop', name: 'Feed Scoop', m: 'M1a', unlock: 1, cost: 0, brush: [1, 1], key: 5, acts: ['tend'],
    text: 'Collect and re-feed animals in one stroke.' },
  { id: 'basket', name: 'Basket', m: 'M1a', unlock: 4, cost: 0, brush: [1, 1], key: 6, acts: ['shake', 'collect'],
    text: 'Harvest trees and collect finished goods from buildings.' },
  { id: 'compost_scoop', name: 'Compost Scoop', m: 'M1a', unlock: 8, cost: 0, brush: [1, 1], key: 7,
    acts: ['fertilize'], text: 'Spread Compost: +1 unit and a chance of a blue-ribbon harvest.' },
  { id: 'axe', name: 'Axe', m: 'M1a', unlock: 1, cost: 0, brush: [1, 1], key: 8, acts: ['chop'],
    text: 'Chop stumps, logs, boulders and Pine.' },
  { id: 'hammer', name: 'Hammer', m: 'M1a', unlock: 1, cost: 0, brush: [1, 1], key: 9,
    acts: ['place', 'move', 'rotate', 'store'], text: 'Build mode: place, move (timers keep running), rotate, store.' },
  // brush upgrades (prices deliberately small: they buy comfort, not income)
  { id: 'big_watering_can', name: 'Big Watering Can', m: 'M1a', unlock: 10, cost: 4000, brush: [3, 3],
    upgrades: 'watering_can', acts: ['water'], text: 'Waters a 3x3 patch per step.' },
  { id: 'wide_sickle', name: 'Wide Sickle', m: 'M1a', unlock: 12, cost: 6000, brush: [2, 2], upgrades: 'sickle',
    acts: ['harvest'], text: 'Harvests a 2x2 patch per step.' },
  { id: 'seed_spreader', name: 'Seed Spreader', m: 'M1b', unlock: 14, cost: 9000, brush: [2, 2], upgrades: 'seed_bag',
    acts: ['plant'], text: 'Plants a 2x2 patch per step.' },
  { id: 'grand_sickle', name: 'Grand Sickle', m: 'M2', unlock: 26, cost: 20_000, brush: [3, 3], upgrades: 'sickle',
    acts: ['harvest'], text: 'Harvests a 3x3 patch per step.' },
];
