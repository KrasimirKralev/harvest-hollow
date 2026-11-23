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
    en: { title: 'Melons by moonlight', body: 'Dear both, I hear something pale and round is growing on your farm. I hope it glows for you on summer nights!' },
    bg: { title: 'Пъпеши под луната', body: 'Мили мои, чух, че на фермата ви расте нещо бледо и кръгло. Дано ви свети в летните нощи!' } }],
});

/** Every family once (the guide's examples): crop, tree, recipe, animal, decor, tuning and look (release 1.0: no tips,
 *  no palette; format.js REMOVED). */
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
  'look.json': { sky: 'golden' },
});

// ---- release 1.0 (critique#37, harvey "features worth adding" 2, H5): the one chip row under Harvey's box. Each example
// is a wish that always works, with the mod a helper builds for it at a farm level and the lowest level it is usable at
// (an animal or a decoration arrives at its anchor's level; a recipe at its inputs'). The row shows at most three, the
// first ones usable at the farm's level; test/rel-harvey.chips.test.js runs each one's mod through the full validator at
// levels 5 and 21. The words are the catalog's `harness.chip.<id>`.

const title = (en, bg) => ({ format: 1, title: { en, bg } });

/** [{ id, minLevel, files(level) }] in the order the row offers them. */
export const CHIPS = Object.freeze([
  { id: 'ex1', minLevel: 1, files: (level) => ({
    'mod.json': title('Blue Pumpkins', 'Сини тикви'),
    'content/crops/x_blue_pumpkin.json': { id: 'x_blue_pumpkin', like: 'pumpkin', growMin: 720, yield: 2, unlock: Math.max(1, Math.min(level, 9)),
      value: 'normal', season: 'autumn', classes: ['veg'], hue: '#5B8FD9', waterable: true,
      text: { en: { name: 'Blue Pumpkin', desc: 'A pumpkin as blue as an autumn sky' },
        bg: { name: 'Синя тиква', g: 'f', pl: 'сини тикви', def: 'синята тиква', plDef: 'сините тикви', desc: 'Тиква, синя като есенното небе' } } },
  }) },
  { id: 'ex2', minLevel: 10, files: () => ({
    'mod.json': title('Banitsa', 'Баница'),
    'content/recipes/x_banitsa.json': { id: 'x_banitsa', like: 'mini_quiche', building: 'bakery', minutes: 60, unlock: 10,
      inputs: { flour: 2, egg: 2, cheese: 1 }, value: 'normal', hue: '#E8B85C',
      text: { en: { name: 'Banitsa', desc: 'Flaky pastry with egg and cheese' },
        bg: { name: 'Баница', g: 'f', pl: 'баници', def: 'баницата', plDef: 'баниците', desc: 'Хрупкави кори с яйца и сирене' } } },
  }) },
  { id: 'ex3', minLevel: 1, files: () => ({
    'mod.json': title('Pink Fence', 'Розова ограда'),
    'content/decor/x_pink_fence.json': { id: 'x_pink_fence', like: 'picket_fence', cost: 40, hue: '#F2A0C4',
      text: { en: { name: 'Pink Fence', desc: 'A picket fence the colour of candyfloss' },
        bg: { name: 'Розова ограда', g: 'f', pl: 'розови огради', def: 'розовата ограда', plDef: 'розовите огради', desc: 'Дървена ограда в цвят на захарен памук' } } },
  }) },
  { id: 'ex4', minLevel: 1, files: () => ({ 'mod.json': title('Quicker Crops', 'По‑бързи посеви'), 'tuning.json': { growTimeBp: 8000 } }) },
  { id: 'ex5', minLevel: 1, files: () => ({
    'mod.json': title('Lavender Bed', 'Лавандулова леха'),
    'content/decor/x_lavender_bed.json': { id: 'x_lavender_bed', like: 'flower_bed', cost: 160, hue: '#9C7BD0',
      text: { en: { name: 'Lavender Bed', desc: 'A bed of lavender that smells of summer' },
        bg: { name: 'Лавандулова леха', g: 'f', pl: 'лавандулови лехи', def: 'лавандуловата леха', plDef: 'лавандуловите лехи', desc: 'Леха с лавандула, която ухае на лято' } } },
  }) },
  { id: 'ex6', minLevel: 1, files: () => ({ 'mod.json': title('Golden Sky', 'Златно небе'), 'look.json': { sky: 'golden' } }) },
]);

/** The chip ids the row shows at a farm level: the first `max` usable there. */
export function chipsAt(level, max = 3) {
  const L = Number.isInteger(level) && level > 0 ? level : 1;
  return CHIPS.filter((c) => c.minLevel <= L).slice(0, max).map((c) => c.id);
}
