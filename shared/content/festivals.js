// Festivals (GDD §5.10, M3; data only before then). Seven-to-ten-day events on a yearly schedule; every festival
// returns every year. Event crops and recipes are priced by the same formulas as everything else when M3 lands
// (the generator will derive them); here are the schedule, the themes and the prize ladders. Festival items are
// orderable only while their festival runs (ruling X7b). Tickets: 1 per festival order, 1-3 per festival recipe;
// leftover tickets convert to coins at the end. Sized so three evenings reach step 6 of 8 and four reach step 8.

const TICKETS = [5, 12, 20, 30, 42, 56, 72, 90];
const ladder = (prizes) => prizes.map((prize, i) => ({ step: i + 1, tickets: TICKETS[i], prize }));

export const FESTIVALS = [
  { id: 'sweethearts_fair', name: 'Sweethearts\' Fair', m: 'M3', start: [2, 7], days: 10,
    event: { crop: 'Heart Strawberry (1 h)', recipe: 'Sweetheart Cake counts double' },
    ladder: ladder(['50 Hearts', 'Heart bunting', 'Couple outfit (top)', 'Heart lantern', 'Couple outfit (bottom)',
      'Heart Arbor variant', 'Rose petal path', '10 Acorns']) },
  { id: 'spring_bloom', name: 'Spring Bloom', m: 'M3', start: [4, 10], days: 10,
    event: { crop: 'Tulips (2 h, flower, forage)', recipe: 'Flower Crown (Sewing, 1 h)' },
    ladder: ladder(['Tulip bed', 'Bunny topiary', 'Flower crown hat', 'Blossom swing', 'Tulip planter',
      'Pastel bunting', 'Bunny statue', '10 Acorns']) },
  { id: 'summer_fair', name: 'Summer Fair', m: 'M3', start: [7, 10], days: 10,
    event: { crop: 'Sweet Corn (20 min)', recipe: 'Corn on the Cob (Kitchen, 20 min)' },
    ladder: ladder(['Bunting', 'Ice-cream cart', 'Sun hat', 'Lemonade stand', 'Striped awning', 'Picnic set',
      'Carousel horse statue', '10 Acorns']) },
  { id: 'harvest_festival', name: 'Harvest Festival', m: 'M3', start: [10, 20], days: 10,
    event: { crop: 'Giant Pumpkin seeds (24 h, always giant-eligible)', recipe: 'Caramel Apples (Kitchen, 45 min)' },
    ladder: ladder(['Scarecrow family', 'Hay maze piece', 'Autumn scarf', 'Pumpkin pyramid', 'Autumn outfit',
      'Hay maze set', 'Harvest wagon', '10 Acorns']) },
  { id: 'winter_lights', name: 'Winter Lights', m: 'M3', start: [12, 15], days: 10,
    event: { crop: '', recipe: 'Gingerbread (Bakery, 1 h) and Mulled Juice (Juice Press, 30 min)' },
    ladder: ladder(['String lights', 'Snowman', 'Knitted hat', 'Sleigh', 'Holiday tree', 'Winter outfit', 'Ice rink',
      '10 Acorns']) },
  { id: 'farm_anniversary', name: 'Farm Anniversary', m: 'M3', start: null, days: 3,
    event: { crop: '', recipe: 'Anniversary Cake (duet)' },
    ladder: ladder(['Memory Book frame', 'Anniversary bunting', 'Grandma\'s letter', 'Photo booth',
      'Statue of the couple', 'Anniversary lanterns', 'Golden bench', '10 Acorns']) },
];
