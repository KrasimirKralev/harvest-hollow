// Example mods that validate (contract §8.2 "the guide's example files validate"): the moonlight mod of
// docs/mod-guide.md, used by the guide test, the mods lane's tests, the mock provider and the helper's e2e.
// Each example is a files map { path: parsedJson } (a function: callers may change their copy).

const moonMelonText = () => ({
  en: { name: 'Moon Melon', desc: 'A pale melon that glows at dusk' },
  bg: { name: 'Лунен пъпеш', g: 'm', pl: 'лунни пъпеши', count: 'лунни пъпеша', def: 'лунният пъпеш',
    defObj: 'лунния пъпеш', plDef: 'лунните пъпеши', desc: 'Блед пъпеш, който свети привечер' },
});

/** The moonlight mod: a crop, a recipe made from it and a letter (the mock provider's default script). */
export const moonlight = () => ({
  'mod.json': { format: 1, title: { en: 'Moonlight Harvest', bg: 'Лунна жътва' } },
  'content/crops/x_moon_melon.json': { id: 'x_moon_melon', like: 'watermelon', growMin: 90, yield: 3, unlock: 14,
    value: 'normal', season: 'summer', classes: ['fruit'], hue: '#BFE3FF', waterable: true, text: moonMelonText() },
  'content/recipes/x_melon_pie.json': { id: 'x_melon_pie', like: 'pumpkin_pie', building: 'pie_oven', minutes: 45,
    unlock: 15, inputs: { x_moon_melon: 2, flour: 1 }, value: 'normal', hue: '#F2C14E',
    text: { en: { name: 'Melon Pie' },
      bg: { name: 'Пай с пъпеш', g: 'm', pl: 'пайове с пъпеш', count: 'пая с пъпеш', def: 'паят с пъпеш',
        defObj: 'пая с пъпеш', plDef: 'пайовете с пъпеш' } } },
  'text/letters.json': [{ id: 'x_letter_melons', from: 'mabel', art: 'melon',
    en: { title: 'Melons by moonlight', body: 'Dear both, I hear something pale and round is growing on your farm. Bring me one when it ripens!' },
    bg: { title: 'Пъпеши под луната', body: 'Мили мои, чух, че на фермата ви расте нещо бледо и кръгло. Донесете ми един, когато узрее!' } }],
});

/** Every family once (the guide's examples): crop, tree, recipe, animal, decor, tuning, look and a tip. */
export const everything = () => ({
  ...moonlight(),
  'content/trees/x_star_plum_tree.json': { id: 'x_star_plum_tree', like: 'plum_tree', cycleHours: 6, unlock: 15,
    value: 'normal', hue: '#7A4CC2', leaf: '#3F7D3A',
    fruit: { id: 'x_star_plum', text: {
      en: { name: 'Star Plum', desc: 'A purple plum with a star inside' },
      bg: { name: 'Звездна слива', g: 'f', pl: 'звездни сливи', def: 'звездната слива', plDef: 'звездните сливи',
        desc: 'Лилава слива със звезда отвътре' } } },
    text: {
      en: { name: 'Star Plum Tree' },
      bg: { name: 'Звездна слива (дърво)', short: 'Звездна слива', g: 'f', pl: 'звездни сливи', def: 'звездната слива',
        plDef: 'звездните сливи' } } },
  'content/animals/x_moon_hen.json': { id: 'x_moon_hen', like: 'chicken', coat: '#E9E4FF', value: 'normal',
    product: { id: 'x_moon_egg', hue: '#CFC6FF', text: {
      en: { name: 'Moon Egg', desc: 'A pearly egg, cool to the touch' },
      bg: { name: 'Лунно яйце', g: 'n', pl: 'лунни яйца', def: 'лунното яйце', plDef: 'лунните яйца',
        desc: 'Седефено яйце, хладно на допир' } } },
    text: {
      en: { name: 'Moon Hen' },
      bg: { name: 'Лунна кокошка', g: 'f', pl: 'лунни кокошки', def: 'лунната кокошка', plDef: 'лунните кокошки' } } },
  'content/decor/x_moon_lantern.json': { id: 'x_moon_lantern', like: 'lantern', cost: 600, hue: '#9FD3E8',
    text: {
      en: { name: 'Moon Lantern', desc: 'A soft blue light for quiet evenings' },
      bg: { name: 'Лунен фенер', g: 'm', pl: 'лунни фенери', count: 'лунни фенера', def: 'лунният фенер',
        defObj: 'лунния фенер', plDef: 'лунните фенери', desc: 'Мека синя светлина за тихите вечери' } } },
  'tuning.json': { growTimeBp: 9000 },
  'look.json': { sky: 'pastel' },
  'text/tips.json': [{ id: 'x_tip_moon', en: 'Moon Melons like a long summer night.', bg: 'Лунните пъпеши обичат дългите летни нощи.' }],
});
