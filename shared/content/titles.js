// Personal titles (GDD §4.7: M1 ships personal levels as titles only, shown on the name card; the number lives on
// the Stats tab, never on the portrait). A player's title is the last row whose `level` <= their personal level
// (personal level thresholds = LEVELS[i].personalXp, 0.6 x the farm table). Ribbon Gold tiers add titles of their
// own (ribbons.js `title`), which a player may pick instead.

export const TITLES = [
  { level: 1, title: 'Greenhorn', m: 'M1a' },
  { level: 2, title: 'Seed Sower', m: 'M1a' },
  { level: 3, title: 'Weed Puller', m: 'M1a' },
  { level: 4, title: 'Field Hand', m: 'M1a' },
  { level: 6, title: 'Barn Buddy', m: 'M1a' },
  { level: 8, title: 'Homesteader', m: 'M1a' },
  { level: 10, title: 'Harvest Hand', m: 'M1a' },
  { level: 12, title: 'Grower', m: 'M1a' },
  { level: 15, title: 'Orchard Keeper', m: 'M1a' },
  { level: 18, title: 'Master Gardener', m: 'M1a' },
  { level: 20, title: 'Pride of the Hollow', m: 'M1a' },
  { level: 25, title: 'Harvest Hero', m: 'M1a' },
  { level: 30, title: 'Grand Farmer', m: 'M1a' },
  { level: 35, title: 'Sage of the Soil', m: 'M1a' },
  { level: 40, title: 'Living Legend', m: 'M1a' },
];
