// The words of the Goal Tracker cards, quest task lines and "waits for" blockers that the rules build (i18n lane C).
// The rules run on the server too, so they never pick a language: every card carries a message { key, params } and,
// for English (tests, logs, the old `text` field), the English sentence enText(msg) made from these templates. The
// client shows goalText(msg) (public/js/ui/goal-text.js): English through enText, Bulgarian through the catalog
// (public/js/i18n/bg/goals.js), whose 'goals.r.*' keys translate these templates. public/js/i18n/en/goals.js
// re-exports GOALS_RULES_EN, so the English catalog and the rules' English are one table.
//
// Params (plain JSON, so a card stays a plain object):
//   number            grouped like the game always did ("3,292")       int(n)          as typed, no grouping ("1200")
//   name(id, en)      a content name (English: en, else the content's)  qtyRef(id, n)   "12 Carrots" / "12 моркова"
//   noun(id, n)       the bare noun as a count says it ("Carrots")       ms(ms)          a wait, "4:05" / "2:15 h"
//   pts(p10)          Fair points in tenths ("25.8")                     ctextRef(...)   a content text field
//   join(items, sep)  'and' | 'or' | 'plus' | 'comma' lists              sub(msg)        a message inside a message
// English-only grammar params start with '_' ({_a}: "a" / "an"); Bulgarian leaves them out.
import { CONTENT, QUEST_VERBS, itemOf, recipeOf, pluralOf } from '../content/index.js';

/** The English templates ('goals.r.*'): the catalog of the rules' sentences. */
export const GOALS_RULES_EN = Object.freeze({
  // NOW fallback (never empty) and the level cards
  'goals.r.tip.next': 'Everything is growing — next ready in {t}.',
  'goals.r.tip.rest': 'Everything is growing — take a breath.',
  'goals.r.tip.nextTip': 'Everything is growing — next ready in {t}. Tip: {crop} grows in {g}.',
  'goals.r.tip.restTip': 'Everything is growing — take a breath. Tip: {crop} grows in {g}.',
  'goals.r.level.away': 'Level {level} is {xp} XP away',
  'goals.r.level.legacy': 'Legacy level {level}: {prize}',
  'goals.r.level.unlock': 'Level {level}: {thing}',
  'goals.r.level.chapter': 'Level {level}: {chapter}. More of the valley opens soon',
  'goals.r.chapter.M1a': 'Evening One is complete',
  'goals.r.chapter.M1b': 'The first two months are complete',
  'goals.r.chapter.M2': 'Every corner of the valley is open',
  // NOW
  'goals.r.barnFull': 'The Barn is full: sell or use some goods',
  'goals.r.collect': { one: 'Collect {n} ready thing', other: 'Collect {n} ready things' },
  'goals.r.giant': { one: 'Fell the Giant {crop}: {n} chop, quicker together', other: 'Fell the Giant {crop}: {n} chops, quicker together' },
  'goals.r.plant': { one: 'Plant {n} empty plot', other: 'Plant {n} empty plots' },
  'goals.r.order.golden': 'Fill a golden order',
  'goals.r.order.fill': 'Fill an order from the Barn',
  'goals.r.order.help': 'Your partner flagged an order: "Need help"',
  'goals.r.debris': 'Clear a weed or a rock',
  'goals.r.basket': "Grandma's seed basket: {n} free {crop} plantings",
  'goals.r.build': 'Build the {b} ({c}). You have {have}',
  'goals.r.slot': 'Add a slot to the {b} ({c}). You have {have}',
  'goals.r.land.task': '{land}: {task}',
  'goals.r.land.taskOr': '{land}: {task} or {alts}',
  'goals.r.land.needBuild': '{land} needs {q}: build the {b} ({c})',
  'goals.r.land.buy': 'Buy {land} ({c})',
  'goals.r.decor': 'Decorate: {d} ({c})',
  'goals.r.upgrade': 'Upgrade the {b}: {tier} ({cost})',
  'goals.r.cost.coins': '{n} coins',
  'goals.r.fertilize': { one: 'Spread Fertilizer on a growing crop: sooner and bigger harvests', other: 'Spread Fertilizer on {n} growing crops: sooner and bigger harvests' },
  'goals.r.crate': 'Open the crate the balloon dropped',
  'goals.r.farmhand': 'Send the Farmhand round the animals (once a day)',
  'goals.r.turner': 'Turn the Time Turner: every queue finishes now (once a day)',
  'goals.r.relic.buy': 'The {relic} is yours for {n} Acorns',
  'goals.r.relic.save': 'Saving for the {relic}: {have} / {n} Acorns',
  // SOON and BIG
  'goals.r.quest': '{title}: {task}',
  'goals.r.try': 'Try a new recipe: {r}',
  'goals.r.ribbon': '{name}: {text}',
  'goals.r.mastery': '{name}: star {n}',
  'goals.r.challenge': "This week's Couple Challenge",
  'goals.r.barge.load': 'Load a barge crate: {q} ({c})',
  'goals.r.barge.crate': 'Barge crate: {q}',
  'goals.r.barge.rows': { one: 'River Barge: {done} of {n} row loaded', other: 'River Barge: {done} of {n} rows loaded' },
  'goals.r.folk.hand': "Hand in {npc}'s request ({c})",
  'goals.r.folk.need': "{npc}'s request: {items}",
  'goals.r.fair.enter': 'Enter {item} at the Fair (+{p} points)',
  'goals.r.fair.medal': 'County Fair: {p} points to {medal}',
  'goals.r.album.trade': 'Trade 3 duplicates for a missing {set} piece',
  'goals.r.album.found': '{set}: {found} of {n} found',
  'goals.r.give': 'Give {q} to the {to}',
  'goals.r.town.big': '{project}: goods and coins for the village',
  'goals.r.restore': 'Restore the {project}',
  'goals.r.beauty': 'Farm Beauty: star {n} at {score}',
  'goals.r.pet.adopt': 'Adopt a dog or a cat of your own',
  'goals.r.pet.treat': 'Give {pet} a {treat}: a find tomorrow morning',
  'goals.r.perk': { one: '{n} perk point to spend: pick a perk', other: '{n} perk points to spend: pick a perk' },
  'goals.r.track.claim': 'Season Track tier {n}: claim {prize}',
  'goals.r.track.next': 'Season Track tier {n}: {xp} XP to {prize}',
  'goals.r.duel.invite': '{who} challenges you to {_a} {duel}',
  'goals.r.duel.invite.partner': 'Your partner challenges you to {_a} {duel}',
  'goals.r.duel.live': '{duel}: you {mine}, {them} {theirs}',
  'goals.r.duel.live.partner': '{duel}: you {mine}, your partner {theirs}',
  'goals.r.grandma.porch': 'Grandma Hazel is at the porch: say hello',
  'goals.r.grandma.field': 'Grandma Hazel is at the field: say hello',
  'goals.r.grandma.orchard': 'Grandma Hazel is at the orchard: say hello',
  'goals.r.grandma.barnyard': 'Grandma Hazel is at the barnyard: say hello',
  'goals.r.grandma.bench': 'Grandma Hazel is at the bench: say hello',
  'goals.r.grandma.parlour': 'Grandma Hazel is at the parlour: say hello',
  'goals.r.grandma.any': 'Grandma Hazel is at the {stop}: say hello',
  'goals.r.league.promo': '{league}: {p} points to a promotion place',
  'goals.r.league.hold': '{league}: in a promotion place, hold it until Sunday',
  'goals.r.breed.home': 'Bring the new baby {animal} home from the Breeding Barn',
  'goals.r.breed.upgrade': 'Make room for a baby {animal}: upgrade the {home}',
  'goals.r.breed.full': 'Make room for a baby {animal}: the {home} is full',
  'goals.r.nursery.choose': 'Choose who the {animal} is: the Nursery card is full',
  'goals.r.nursery.choose.named': 'Choose who {name} is: the Nursery card is full',
  'goals.r.nursery.feed': 'Feed the {animal}: {q}',
  'goals.r.nursery.feed.named': 'Feed {name}: {q}',
  'goals.r.nursery.play': 'Play with the {animal}: {q}',
  'goals.r.nursery.play.named': 'Play with {name}: {q}',
  'goals.r.nursery.groom': 'Groom the {animal}: {q}',
  'goals.r.nursery.groom.named': 'Groom {name}: {q}',
  'goals.r.nursery.look': 'Look after the {animal}: {q}',
  'goals.r.nursery.look.named': 'Look after {name}: {q}',
  'goals.r.fish.pond': 'Cast a line at {pond}: a fish an hour',
  'goals.r.fish.dock': 'Cast a line at the Fishing Dock: a fish an hour',
  // a content prize in words (Legacy levels, the Season Track)
  'goals.r.prize.acorns': { one: '{n} Acorn', other: '{n} Acorns' },
  'goals.r.prize.golden': { one: 'a Golden Seed Packet', other: '{n} Golden Seed Packets' },
  'goals.r.prize.packet': { one: 'a seed packet', other: '{n} seed packets' },
  'goals.r.prize.hearts': '{n} Hearts each',
  'goals.r.prize.coins': 'coins',
  'goals.r.prize.planter': 'a season planter',
  'goals.r.prize.decor': 'the {d}',
  'goals.r.prize.coat': "the season's animal coat",
  'goals.r.prize.gift': 'a gift',
  'goals.r.prize.list': '{list}',
  'goals.r.duel.friendly': 'Friendly Duel',
  // the Almanac's micro-tasks (the rules' own words; the Journal has its own)
  'goals.r.alm.harvest.item': 'Harvest {n} {item}{q:omit}',
  'goals.r.alm.plant.item': 'Plant {n} {item}',
  'goals.r.alm.water.all': 'Water {n} crops',
  'goals.r.alm.collect.item': 'Collect {n} {item}{q:omit}',
  'goals.r.alm.pet.animal': 'Pet {n} animals',
  'goals.r.alm.make.item': 'Make {n} {item}{q:omit}',
  'goals.r.alm.fill.order': 'Fill {n} order',
  'goals.r.alm.clear.debris': 'Clear {n} debris',
  'goals.r.alm.enter.fair': 'Enter {n} fair',
  'goals.r.alm.any': '{verb} {n} {what}',
  // quest tasks: "Harvest 6 Wheat" (task), "Harvest Wheat" (label, before "3/6"), "Harvest 12 more Wheat" (more)
  'goals.r.task.plant': 'Plant {q}{crop:omit}{n:omit}',
  'goals.r.task.plant.tree': 'Plant {q}',
  'goals.r.task.harvest': 'Harvest {q}',
  'goals.r.task.sell': 'Sell {q}',
  'goals.r.task.place': 'Place {q}',
  'goals.r.task.build': 'Build {q}',
  'goals.r.task.own': 'Own {q}',
  'goals.r.task.make': 'Make {q}',
  'goals.r.task.collect': 'Collect {q}',
  'goals.r.task.tend': 'Feed {q}',
  'goals.r.task.deliver': 'Deliver {q}',
  'goals.r.task.buy': 'Buy {q}',
  'goals.r.task.raise': 'Raise {q}',
  'goals.r.task.empty': 'Empty {q}{b:omit}{n:omit}',
  'goals.r.task.breed': 'Breed {q}',
  'goals.r.task.expand': 'Buy the land: {land}',
  'goals.r.task.any': '{verb} {n} {what}',
  'goals.r.task.harvest.prized': { one: 'Harvest {n} blue-ribbon crop', other: 'Harvest {n} blue-ribbon crops' },
  'goals.r.task.sell.demand': { one: 'Sell {n} Demand good', other: 'Sell {n} Demand goods' },
  'goals.r.task.place.forage': 'Place {n} bee forage',
  'goals.r.task.fill.order': { one: 'Fill {n} order', other: 'Fill {n} orders' },
  'goals.r.task.clear.debris': { one: 'Clear {n} piece of debris', other: 'Clear {n} pieces of debris' },
  'goals.r.task.upgrade.barn': { one: 'Upgrade the Barn', other: 'Upgrade {n} the Barn' },
  'goals.r.task.upgrade.slot': { one: 'Upgrade {n} building slot', other: 'Upgrade {n} building slots' },
  'goals.r.task.fertilize.plot': { one: 'Compost {n} plot', other: 'Compost {n} plots' },
  'goals.r.task.complete.bundle': { one: 'Complete {n} Restoration bundle', other: 'Complete {n} Restoration bundles' },
  'goals.r.task.complete.project': { one: 'Complete {n} Restoration project', other: 'Complete {n} Restoration projects' },
  'goals.r.task.complete.town_project': { one: 'Complete {n} Town Project', other: 'Complete {n} Town Projects' },
  'goals.r.task.reach.beauty_star': { one: 'Reach {n} Farm Beauty star', other: 'Reach {n} Farm Beauty stars' },
  'goals.r.task.load.crate': { one: 'Load {n} barge crate', other: 'Load {n} barge crates' },
  'goals.r.task.load.row': { one: 'Load {n} full barge row', other: 'Load {n} full barge rows' },
  'goals.r.task.enter.fair': { one: 'Enter {n} good at the Fair', other: 'Enter {n} goods at the Fair' },
  'goals.r.task.enter.hamper': { one: 'Enter {n} hamper at the Fair', other: 'Enter {n} hampers at the Fair' },
  'goals.r.task.reach.fair_silver': 'Win a Silver medal at the County Fair',
  'goals.r.task.reach.league': 'Reach League {n} at the County Fair',
  'goals.r.task.together.bench': 'Sit together for Golden Hour',
  'goals.r.task.together.duet': { one: 'Cook a duet together', other: 'Cook {n} duets together' },
  'goals.r.task.together.help_flag': "Fill {n} of your partner's help flags",
  'goals.r.task.together.giant': { one: 'Fell a giant crop together', other: 'Fell {n} giant crops together' },
  'goals.r.task.together.dock': 'Go fishing together on the dock',
  'goals.r.label.plant': 'Plant {what}',
  'goals.r.label.harvest': 'Harvest {what}',
  'goals.r.label.sell': 'Sell {what}',
  'goals.r.label.place': 'Place {what}',
  'goals.r.label.build': 'Build {what}',
  'goals.r.label.own': 'Own {what}',
  'goals.r.label.make': 'Make {what}',
  'goals.r.label.collect': 'Collect {what}',
  'goals.r.label.tend': 'Feed {what}',
  'goals.r.label.deliver': 'Deliver {what}',
  'goals.r.label.buy': 'Buy {what}',
  'goals.r.label.raise': 'Raise {what}',
  'goals.r.label.empty': 'Empty {what}',
  'goals.r.label.breed': 'Breed {what}',
  'goals.r.label.any': '{verb} {what}',
  'goals.r.label.harvest.prized': { one: 'Harvest blue-ribbon crop', other: 'Harvest blue-ribbon crops' },
  'goals.r.label.sell.demand': { one: 'Sell Demand good', other: 'Sell Demand goods' },
  'goals.r.label.place.forage': 'Place bee forage',
  'goals.r.label.fill.order': { one: 'Fill order', other: 'Fill orders' },
  'goals.r.label.clear.debris': { one: 'Clear piece of debris', other: 'Clear pieces of debris' },
  'goals.r.label.upgrade.barn': 'Upgrade the Barn',
  'goals.r.label.upgrade.slot': { one: 'Upgrade building slot', other: 'Upgrade building slots' },
  'goals.r.label.fertilize.plot': { one: 'Compost plot', other: 'Compost plots' },
  'goals.r.label.complete.bundle': { one: 'Complete Restoration bundle', other: 'Complete Restoration bundles' },
  'goals.r.label.complete.project': { one: 'Complete Restoration project', other: 'Complete Restoration projects' },
  'goals.r.label.complete.town_project': { one: 'Complete Town Project', other: 'Complete Town Projects' },
  'goals.r.label.reach.beauty_star': { one: 'Reach Farm Beauty star', other: 'Reach Farm Beauty stars' },
  'goals.r.label.load.crate': { one: 'Load barge crate', other: 'Load barge crates' },
  'goals.r.label.load.row': { one: 'Load full barge row', other: 'Load full barge rows' },
  'goals.r.label.enter.fair': { one: 'Enter good at the Fair', other: 'Enter goods at the Fair' },
  'goals.r.label.enter.hamper': { one: 'Enter hamper at the Fair', other: 'Enter hampers at the Fair' },
  'goals.r.more.plant': 'Plant {n} more {what}{q:omit}',
  'goals.r.more.harvest': 'Harvest {n} more {what}{q:omit}',
  'goals.r.more.sell': 'Sell {n} more {what}{q:omit}',
  'goals.r.more.place': 'Place {n} more {what}{q:omit}',
  'goals.r.more.build': 'Build {n} more {what}{q:omit}',
  'goals.r.more.own': 'Own {n} more {what}{q:omit}',
  'goals.r.more.make': 'Make {n} more {what}{q:omit}',
  'goals.r.more.collect': 'Collect {n} more {what}{q:omit}',
  'goals.r.more.tend': 'Feed {n} more {what}{q:omit}',
  'goals.r.more.deliver': 'Deliver {n} more {what}{q:omit}',
  'goals.r.more.buy': 'Buy {n} more {what}{q:omit}',
  'goals.r.more.raise': 'Raise {n} more {what}{q:omit}',
  'goals.r.more.fill': 'Fill {n} more {what}{q:omit}',
  'goals.r.more.any': '{verb} {n} more {what}{q:omit}',
  // what a waiting card waits for (actions/quests.js blockerOf): a phrase after "Quest title: "
  'goals.r.block.plantTree': 'plant {_a} {tree} first',
  'goals.r.block.bearFruit': 'wait for the {tree} to bear fruit',
  'goals.r.block.build': 'build the {b} first',
  'goals.r.block.buyAnimal': 'buy a {animal} first',
  'goals.r.block.growUp': 'wait for the {animal} to grow up',
  'goals.r.block.level': 'reach level {n} first',
  'goals.r.block.bargeIn': 'the barge docks in {t}',
  'goals.r.block.bargeLight': 'the barge sails light this week',
  'goals.r.block.fairIn': 'the Fair opens in {t}',
  'goals.r.block.raiseTwo': 'raise two grown {animals}{a:omit} first',
  'goals.r.block.proof': 'first {task:lc}',
});

// ---- messages and their params ----------------------------------------------------------------------------------

/** A message: the catalog key and its params. */
export const msg = (key, params = {}) => ({ key, params });
/** A count printed as typed (the rules never grouped these: "1200 XP away"). */
export const int = (n) => ({ $int: n });
/** A content name; `en` is the English the rules already say (else the content's own name). */
export const name = (id, en, family) => ({ $name: id, ...(en !== undefined ? { en } : {}), ...(family ? { family } : {}) });
/** "12 Carrots" / "12 моркова" (English prints the count as typed and the content's plural). */
export const qtyRef = (id, n, en, family) => ({ $qty: id, n, ...(en !== undefined ? { en } : {}), ...(family ? { family } : {}) });
/** The bare noun as a count of `n` says it: "Carrots" / "моркови". */
export const noun = (id, n, en, family) => ({ $noun: id, n, ...(en !== undefined ? { en } : {}), ...(family ? { family } : {}) });
/** A wait in the cards' clock words ("4:05", "2:15 h", "23 h 59 m"). */
export const ms = (v) => ({ $mmss: v });
/** Fair points in tenths: 258 -> "25.8". */
export const pts = (p10) => ({ $p10: p10 });
/** A content text field (a quest title, a ribbon text) by family / id / field, with its English. */
export const ctextRef = (family, id, field, en) => ({ $ctext: [family, id, field, en] });
/** A list: 'and' ("a and b and c" in English, as the rules always joined), 'or', 'plus' (" + "), 'comma'. */
export const join = (items, sep = 'and') => ({ $join: items, sep });
/** A message inside a message. */
export const sub = (m) => ({ $msg: m });

// ---- English ------------------------------------------------------------------------------------------------------

/** A content name in English (items first, then the placeables and land, then recipes). */
export function nameOf(ref) {
  const d = itemOf(ref) ?? CONTENT.buildings.get(ref) ?? CONTENT.homes.get(ref) ?? CONTENT.trees.get(ref)
    ?? CONTENT.animals.get(ref) ?? CONTENT.expansions.get(ref) ?? CONTENT.decor.get(ref) ?? recipeOf(ref);
  return d ? d.name : ref;
}

/** A wait for a card: "4:05" (m:ss) under an hour, "2:15 h" (h:mm) under 10 hours, then "23 h 59 m" (RC-26). */
export const mmss = (v) => {
  const s = Math.max(0, Math.ceil(v / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const m = Math.ceil(s / 60);
  if (m < 600) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
};

/** Grouped like the rules always wrote coins ("3,292"; integer math, no locale functions in shared/). */
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const SEP = { and: ' and ', or: ' or ', plus: ' + ', comma: ', ' };
const PH = /\{([A-Za-z_$][\w$]*)(?::([\w-]+))?\}/g;

/** A param's number value (a count may come as int(n)). */
export const numOf = (v) => (v && typeof v === 'object' && Object.hasOwn(v, '$int') ? v.$int : v);

/** One param in English. */
function enParam(v, form) {
  if (form === 'omit' || v === null || v === undefined) return '';
  let s;
  if (typeof v === 'number') s = Number.isInteger(v) ? group(v) : String(v);
  else if (typeof v !== 'object') s = String(v);
  else if (Object.hasOwn(v, '$int')) s = String(v.$int);
  else if (Object.hasOwn(v, '$qty')) s = `${v.n} ${pluralOf(v.en ?? nameOf(v.$qty), v.n)}`;
  else if (Object.hasOwn(v, '$noun')) s = pluralOf(v.en ?? nameOf(v.$noun), v.n);
  else if (Object.hasOwn(v, '$name')) s = v.en ?? nameOf(v.$name);
  else if (Object.hasOwn(v, '$mmss')) s = mmss(v.$mmss);
  else if (Object.hasOwn(v, '$p10')) s = `${Math.floor(v.$p10 / 10)}.${v.$p10 % 10}`;
  else if (Object.hasOwn(v, '$ctext')) s = String(v.$ctext[3] ?? '');
  else if (Object.hasOwn(v, '$join')) s = v.$join.map((x) => enParam(x)).join(SEP[v.sep] ?? SEP.and);
  else if (Object.hasOwn(v, '$msg')) s = enText(v.$msg);
  else s = String(v);
  if (form === 'lc') return s ? s[0].toLowerCase() + s.slice(1) : s;
  if (form === 'cap') return s ? s[0].toUpperCase() + s.slice(1) : s;
  return s;
}

/** A message in English: the sentence the rules always wrote. */
export function enText(m) {
  if (!m) return '';
  let v = GOALS_RULES_EN[m.key];
  if (v === undefined) return String(m.key);
  const p = m.params || {};
  if (v && typeof v === 'object') v = (numOf(p.n) === 1 ? v.one : v.other) ?? v.other;
  return v.replace(PH, (whole, k, form) => (Object.hasOwn(p, k) ? enParam(p[k], form) : whole));
}

/** A card's message and its English (the `text` every caller and test reads). */
export const said = (m) => ({ msg: m, text: enText(m) });

/**
 * A blocker { kind, ref, text } with its message riding along as a non-enumerable `msg`: the blocker's public shape
 * (what callers compare and store) stays as it was, the tracker still reads blocker.msg.
 */
export function blocked(kind, ref, m) {
  const b = { kind, ref, text: enText(m) };
  Object.defineProperty(b, 'msg', { value: m, enumerable: false });
  return b;
}

// ---- tasks, the Almanac and the duel in messages (goals.js and actions/quests.js) ----------------------------------

/** Special task refs: count words, not content ("Fill 3 orders"). [one, many] in English. */
export const SPECIAL_NAMES = Object.freeze({
  order: ['order', 'orders'], debris: ['piece of debris', 'pieces of debris'], plot: ['plot', 'plots'],
  barn: ['the Barn', 'the Barn'], slot: ['building slot', 'building slots'],
  demand: ['Demand good', 'Demand goods'], prized: ['blue-ribbon crop', 'blue-ribbon crops'],
  crate: ['barge crate', 'barge crates'], row: ['full barge row', 'full barge rows'],
  fair: ['good at the Fair', 'goods at the Fair'], hamper: ['hamper at the Fair', 'hampers at the Fair'],
  bundle: ['Restoration bundle', 'Restoration bundles'], project: ['Restoration project', 'Restoration projects'],
  town_project: ['Town Project', 'Town Projects'], beauty_star: ['Farm Beauty star', 'Farm Beauty stars'],
  forage: ['bee forage', 'bee forage'],
});
/** The specials that read better as their own sentence (count 1 / count n). */
const OWN_TEXT = new Set(['reach:fair_silver', 'reach:league', 'together:bench', 'together:duet', 'together:help_flag',
  'together:giant', 'together:dock']);
const has = (k) => Object.hasOwn(GOALS_RULES_EN, k);
const verbEn = (v) => QUEST_VERBS[v]?.text ?? v;

/** "Fill 3 orders", "Make 2 Bread", "Buy the land: Creekside Meadow". */
export function taskMsg(t) {
  const n = int(t.qty);
  if (OWN_TEXT.has(`${t.verb}:${t.ref}`)) return msg(`goals.r.task.${t.verb}.${t.ref}`, { n });
  if (t.verb === 'expand') return msg('goals.r.task.expand', { land: name(t.ref, nameOf(t.ref), 'expansions') });
  const special = SPECIAL_NAMES[t.ref];
  if (special) {
    const key = `goals.r.task.${t.verb}.${t.ref}`;
    return has(key) ? msg(key, { n }) : msg('goals.r.task.any', { verb: verbEn(t.verb), n, what: special[t.qty === 1 ? 0 : 1] });
  }
  const en = nameOf(t.ref);
  const q = qtyRef(t.ref, t.qty, en);
  if (t.verb === 'plant') return CONTENT.trees.has(t.ref) ? msg('goals.r.task.plant.tree', { q }) : msg('goals.r.task.plant', { q, crop: name(t.ref, en), n });
  if (t.verb === 'empty') return msg('goals.r.task.empty', { q, b: name(t.ref, en), n });
  const key = `goals.r.task.${t.verb}`;
  return has(key) ? msg(key, { q }) : msg('goals.r.task.any', { verb: verbEn(t.verb), n, what: pluralOf(en, t.qty) });
}

/** The task without its count, for a "have/need" line: "Fill orders", "Collect Egg", "Buy the land: Creekside". */
export function taskLabelMsg(t) {
  if (OWN_TEXT.has(`${t.verb}:${t.ref}`) || t.verb === 'expand') return taskMsg(t);
  const special = SPECIAL_NAMES[t.ref];
  if (special) {
    const key = `goals.r.label.${t.verb}.${t.ref}`;
    return has(key) ? msg(key, { n: int(t.qty) }) : msg('goals.r.label.any', { verb: verbEn(t.verb), what: special[t.qty === 1 ? 0 : 1] });
  }
  const key = `goals.r.label.${t.verb}`;
  const what = noun(t.ref, t.qty, nameOf(t.ref));
  return has(key) ? msg(key, { what }) : msg('goals.r.label.any', { verb: verbEn(t.verb), what });
}

/** "Harvest 12 more Wheat": what is left of a land proof task (the NOW land card and the e1 blocker). */
export function moreMsg(t) {
  const en = nameOf(t.ref);
  const params = { n: int(t.qty), what: noun(t.ref, t.qty, en), q: qtyRef(t.ref, t.qty, en) };
  const key = `goals.r.more.${t.verb}`;
  return has(key) ? msg(key, params) : msg('goals.r.more.any', { ...params, verb: verbEn(t.verb) });
}

/** An Almanac micro-task: "Harvest 12 Wheat", "Water 10 crops", "Pet 3 animals" (the rules' words, singular nouns). */
export function almanacMsg(t) {
  const kind = t.ref === '*' ? 'all' : ['animal', 'order', 'debris', 'fair'].includes(t.ref) ? t.ref : 'item';
  const key = `goals.r.alm.${t.verb}.${kind}`;
  const n = int(t.qty);
  if (has(key)) return msg(key, kind === 'item' ? { n, item: name(t.ref, nameOf(t.ref)), q: qtyRef(t.ref, t.qty, nameOf(t.ref)) } : { n });
  const what = t.ref === '*' ? 'crops' : t.ref === 'animal' ? 'animals' : t.ref === 'order' ? 'order' : nameOf(t.ref);
  return msg('goals.r.alm.any', { verb: `${t.verb[0].toUpperCase()}${t.verb.slice(1)}`, n, what });
}

/** A Friendly Duel kind's name (content DUEL, lane B's ctext path), "Friendly Duel" without one. */
export const duelRef = (k) => (k ? ctextRef('DUEL', `kind.${k.id}`, 'name', k.name) : sub(msg('goals.r.duel.friendly')));
