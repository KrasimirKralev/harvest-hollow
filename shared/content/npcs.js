// Characters (GDD §5.3). Hand-authored. `portrait` drives the inline-SVG portraits of the letter cards and order
// cards (colours as #RRGGBB, styles from a small closed set the UI draws). `likes` are the items a townsperson
// enjoys as a Friendship gift (GDD §5.3, L21). `lines` are short barks for golden orders, banners and the board.
// `from` is the farm level at which the character first speaks.

export const NPCS = [
  {
    id: 'hazel', name: 'Grandma Hazel', m: 'M1a', role: 'grandmother', from: 1, townsfolk: false,
    voice: 'warm, funny, a little nosy about the two of you',
    portrait: { skin: '#F2D3B8', hair: '#E8E4DC', hairStyle: 'bun', outfit: '#7E9C6B', accent: '#E9B44C',
      accessory: 'glasses' },
    likes: [],
    lines: [
      'The farm is yours now. Both of you. That was always the plan.',
      'Plant something silly once in a while. It keeps the soil cheerful.',
      'Two pairs of hands make light work and better pies.',
    ],
  },
  {
    id: 'journal', name: 'Grandma\'s Journal', m: 'M1b', role: 'journal', from: 4, townsfolk: false,
    voice: 'Grandma\'s handwriting in the margins, pressed flowers between the pages',
    portrait: { skin: '#E9D8B4', hair: '#B5654A', hairStyle: 'book', outfit: '#B5654A', accent: '#E9B44C',
      accessory: 'ribbon' },
    likes: [],
    lines: ['Some pages are meant to be read together.'],
  },
  {
    id: 'mabel', name: 'Mabel', m: 'M1a', role: 'market keeper', from: 2, townsfolk: true,
    voice: 'brisk, generous, knows everyone\'s business',
    portrait: { skin: '#C98E68', hair: '#5A3A2A', hairStyle: 'curls', outfit: '#D9534F', accent: '#F4E3C1',
      accessory: 'apron' },
    likes: ['strawberry_jam', 'cookies', 'apple_juice'],
    lines: [
      'Fresh off the field? I\'ll take the lot, dears.',
      'Half the village has been asking for this. Don\'t tell them I told you.',
      'A golden order, special delivery! Somebody in town is very hungry.',
    ],
  },
  {
    id: 'ollie', name: 'Ollie', m: 'M1a', role: 'carpenter', from: 5, townsfolk: true,
    voice: 'slow-talking craftsman, loves a good plank',
    portrait: { skin: '#E3B48F', hair: '#8C6A3E', hairStyle: 'beard', outfit: '#3E6E8E', accent: '#C99A5B',
      accessory: 'pencil' },
    likes: ['planks', 'wooden_crate', 'corn_bread'],
    lines: [
      'Now that... is a fine piece of timber.',
      'Measure twice, plant once. Or the other way round. Either way.',
      'Room to grow, that\'s what a farm needs.',
    ],
  },
  {
    id: 'fern', name: 'Dr. Fern', m: 'M1a', role: 'vet', from: 5, townsfolk: true,
    voice: 'calm, precise, secretly sentimental about calves',
    portrait: { skin: '#8D5B3E', hair: '#2B2B2B', hairStyle: 'short', outfit: '#5BA3A0', accent: '#FFFFFF',
      accessory: 'stethoscope' },
    likes: ['milk', 'cheese', 'omelette'],
    lines: [
      'Healthy, happy and very well fed. Textbook.',
      'A baby bottle now and then works wonders. For them and for you.',
      'I may have named that calf already. Don\'t tell anyone.',
    ],
  },
  {
    id: 'juniper', name: 'Juniper', m: 'M1a', role: 'orchard keeper', from: 4, townsfolk: true,
    voice: 'dreamy, speaks in seasons',
    portrait: { skin: '#F0C9A6', hair: '#C2562E', hairStyle: 'braid', outfit: '#6E8B3D', accent: '#F2C14E',
      accessory: 'flower' },
    likes: ['apple', 'cherry', 'cherry_jam'],
    lines: [
      'Trees remember who waters them.',
      'Blossom in spring, fruit in summer, pie in every season.',
      'Listen. The orchard is humming again.',
    ],
  },
  {
    id: 'reed', name: 'Captain Reed', m: 'M1b', role: 'barge captain', from: 15, townsfolk: true,
    voice: 'gruff, punctual, ends every sentence with a sailing term',
    portrait: { skin: '#D9A07A', hair: '#9A9A9A', hairStyle: 'cap', outfit: '#1F4E79', accent: '#E9E2D0',
      accessory: 'pipe' },
    likes: ['wool', 'potato', 'cheese'],
    lines: [
      'Crates by Sunday or we sail light, mateys. Anchors aweigh.',
      'Fine cargo. Fine cargo indeed, starboard.',
      'Tide waits for no farmer, nor do I, mostly. Fair winds.',
    ],
  },
  {
    id: 'pemberton', name: 'Judge Pemberton', m: 'M1b', role: 'County Fair judge', from: 14, townsfolk: true,
    voice: 'pompous, fair-minded, wears three rosettes',
    portrait: { skin: '#F1C9A5', hair: '#D8D8D8', hairStyle: 'side_part', outfit: '#6B3E75', accent: '#3E7BC4',
      accessory: 'rosettes' },
    likes: ['pumpkin', 'golden_egg', 'strawberry_jam'],
    lines: [
      'Hmm. Hmm! A most promising entry.',
      'The Fair rewards care, consistency and a very good pie.',
      'I have tasted four hundred jams this season. Yours I remember.',
    ],
  },
  {
    id: 'pip', name: 'Pip Hartley', m: 'M1b', role: 'village postman', from: 21, townsfolk: true,
    voice: 'cheerful, out of breath, always slightly late',
    portrait: { skin: '#F5D0B0', hair: '#E0A23B', hairStyle: 'messy', outfit: '#C0392B', accent: '#F4D03F',
      accessory: 'satchel' },
    likes: ['carrot_juice', 'popcorn', 'apple'],
    lines: [
      'Parcel for the farm! Sign here. Or don\'t, I trust you.',
      'Sorry I\'m late. There was a goose. There is always a goose.',
      'Three letters for the farm today. One smells of the seaside.',
    ],
  },
  {
    id: 'rosie', name: 'Rosie Bell', m: 'M1b', role: 'village baker', from: 21, townsfolk: true,
    voice: 'flour on her nose, opinions about yeast',
    portrait: { skin: '#E8B796', hair: '#8E3B2E', hairStyle: 'bob', outfit: '#F2A7B5', accent: '#FFFFFF',
      accessory: 'apron' },
    likes: ['flour', 'butter', 'egg'],
    lines: [
      'Good flour is half the bread. The other half is patience.',
      'Your butter is the talk of the bakery. Mostly I do the talking.',
      'Never trust a loaf that rises in a hurry.',
    ],
  },
  {
    id: 'tom', name: 'Old Tom', m: 'M1b', role: 'ferryman', from: 21, townsfolk: true,
    voice: 'few words, all of them kind',
    portrait: { skin: '#B9845F', hair: '#F0F0F0', hairStyle: 'beard', outfit: '#4F6D3A', accent: '#C9A86A',
      accessory: 'hat' },
    likes: ['veggie_soup', 'bread', 'honey'],
    lines: [
      'River\'s calm today. Good day for crossing.',
      'Your grandmother rode this ferry every Thursday. Sat on the left.',
      'Soup weather. Always soup weather, on the river.',
    ],
  },
  {
    id: 'lucia', name: 'Lucia Moreno', m: 'M1b', role: 'schoolteacher', from: 21, townsfolk: true,
    voice: 'bright, curious, collects pressed flowers',
    portrait: { skin: '#C68B63', hair: '#2E1E14', hairStyle: 'ponytail', outfit: '#3F7FBF', accent: '#F2C14E',
      accessory: 'book' },
    likes: ['sunflower', 'cookies', 'yarn'],
    lines: [
      'The children want to know what a sunflower thinks about all day.',
      'We are pressing flowers this week. Any spare petals are very welcome.',
      'Lesson of the day: everything grows faster with a friend.',
    ],
  },
];

/** Hair styles and accessories the UI portrait renderer must draw (a closed set, validated). */
export const PORTRAIT_STYLES = {
  hairStyle: ['bun', 'book', 'curls', 'beard', 'short', 'braid', 'cap', 'side_part', 'messy', 'bob', 'ponytail'],
  accessory: ['glasses', 'ribbon', 'apron', 'pencil', 'stethoscope', 'flower', 'pipe', 'rosettes', 'satchel', 'hat',
    'book'],
};
