// English catalog, area 'feat' (release 1.0, features lane): the 1.0 features, new tracker and drip cards.
// The rules' own sentences ('feat.r.*') live next to the rules (shared/rules/goal-text.js FEAT_RULES_EN: they run on
// the server too) and are re-exported here, so the English is one table (the same pattern as en/goals.js).
import { FEAT_RULES_EN } from '../../../../shared/rules/goal-text.js';
import { FEATURES } from '../../../../shared/content/features.js';

/** The 1.0 drip cards' words (content FEATURES with `card.key`): the English lives with the content, one source. */
const CARDS = Object.fromEntries(FEATURES.filter((f) => f.card && f.card.key).flatMap((f) => [
  [`${f.card.key}.title`, f.card.title], [`${f.card.key}.text`, f.card.text],
  ...(f.card.touchText ? [[`${f.card.key}.touchText`, f.card.touchText]] : [])]));

export default {
  ...FEAT_RULES_EN,
  ...CARDS,
  // ---- the Goal Tracker (ui/tracker.js) ----
  'feat.tr.hand': 'Click or drag with the Hand',
  'feat.tr.handTouch': 'Tap or drag with the Hand',
  'feat.tr.handAxe': 'Chop it with the Axe',
  'feat.tr.coach': 'Grandma: {text}',
  'feat.tr.goldenSub': 'You are both here',
  'feat.tr.brushSub': 'Show me in the Market',
  // QA r4 F4-04: the phone chip's count ("+4" read as a reward); F4-C1: the partner did their half while I was away
  'feat.tr.chipMore': '{n} more',
  'feat.tr.half.bench': '{name} sat on a bench today: sit on one before midnight for {title}',
  'feat.tr.half.dock': '{name} cast a line today: cast one before midnight for {title}',
  // ---- Plant for later's "are you sure?" (QA r2 F2-03: a planting has no Undo chip; its crops come back by an uproot
  // inside the refund window) and the partner's heads-up for a big planting (life-feel's bigSpendLine) ----
  'feat.later.ok': 'Plant them',
  'feat.later.bigFine': 'Your partner gets a friendly heads-up. Changed your mind? Crops pulled up within 10 minutes give every seed back.',
  'feat.later.headsUp': '{who} is planting {n} plots with {crop:pl} — {price}',
  // ---- the gift sheet (ui/panels/gift.js, D1) ----
  'feat.gift.title': 'Leave a surprise',
  'feat.gift.pick': 'Pick a gift',
  'feat.gift.noteLabel': 'Add a note',
  'feat.gift.own': 'Or write your own (optional)',
  'feat.gift.send': 'Wrap it for {name}',
  'feat.gift.pickFirst': 'Pick something first',
  'feat.gift.nothing': 'The Barn has nothing to wrap yet',
  'feat.gift.tile': '{item} · {n} in the Barn',
  'feat.gift.forMe': '{name} left you a surprise on the porch!',
  'feat.gift.open': 'Open it',
  'feat.gift.show': 'Show me',
  'feat.gift.solo': 'Surprises are for two: once your partner joins, you can leave them one.',
  'feat.gift.waiting': 'For {name}: waiting on the porch',
  // QA r1 F-08: the sheet closes after a send with this line; the waiting card says what you wrapped
  'feat.gift.sent': 'Wrapped for {name}. It waits on the porch.',
  'feat.gift.what': '{item}',
  'feat.gift.whatNote': '{item} · with your note',
  'feat.gift.today': 'You wrapped a surprise today. Tomorrow you can leave {name} another one.',
  // QA r3 F3-03: a box from an earlier day still waits and today's wrap is free (the rules shelve the older box)
  'feat.gift.again': 'Your {item} moves to {name}\'s shelf when you wrap a new one.',
  'feat.gift.againAny': 'Your surprise moves to {name}\'s shelf when you wrap a new one.',
  'feat.gift.lead': 'Once a day, wrap something for {name}. It waits on the porch until they open it.',
  'feat.gift.leadTouch': 'Once a day, wrap something for {name}. It waits on the porch until they open it.',
  'feat.gift.partner': 'your partner',
  'feat.gift.note.thanks': 'Thank you ♥',
  'feat.gift.note.thinking': 'Thinking of you',
  'feat.gift.note.because': 'Just because',
  // ---- the balloon crates' rare power-ups (owner request 2026-10-19; ui/powerups.js, panels/w4b.js, feed.js) ----
  'feat.pu.rainbow': 'Rainbow Watering Can',
  'feat.pu.ladybugs': 'Lucky Ladybugs',
  'feat.pu.swarm': 'Busy-Bee Swarm',
  'feat.pu.ticket': 'Mabel\'s Golden Ticket',
  'feat.pu.star': 'Shooting Star',
  'feat.pu.a.rainbow': 'a Rainbow Watering Can',
  'feat.pu.a.ladybugs': 'Lucky Ladybugs',
  'feat.pu.a.swarm': 'a Busy-Bee Swarm',
  'feat.pu.a.ticket': 'Mabel\'s Golden Ticket',
  'feat.pu.a.star': 'a Shooting Star',
  'feat.pu.short.rainbow': 'Rainbow',
  'feat.pu.short.ladybugs': 'Ladybugs',
  'feat.pu.short.swarm': 'Bees',
  'feat.pu.short.ticket': 'Ticket',
  'feat.pu.short.star': 'Star',
  'feat.pu.do.rainbow': 'For {min} min, every new crop is watered by magic and grows faster',
  'feat.pu.do.ladybugs': 'For {min} min, every crop harvested has a 1 in 4 chance of one more',
  'feat.pu.do.swarm': 'For {min} min, animals fed and fruit trees picked are ready 25% sooner',
  'feat.pu.do.ticket': { one: 'The next order either of you fills pays 50% more coins', other: 'The next {n} orders either of you fill pay 50% more coins' },
  'feat.pu.do.star': { one: 'The next balloon is sure to drop a crate', other: 'The next {n} balloons each drop a crate' },
  'feat.pu.ribbon': 'A rare find!',
  'feat.pu.card': '{name}: {what}',
  'feat.pu.found': '{name} found {pu} in a balloon crate! {what}',
  'feat.pu.chip': '{name} {clock}',
  'feat.pu.chipN': '{name} ×{n} · {clock}',
  'feat.pu.hours': '{n} h',
  'feat.pu.ticketPaid': { one: 'Mabel\'s Golden Ticket: +{n} coin', other: 'Mabel\'s Golden Ticket: +{n} coins' },
  'feat.pu.order': '{actor} filled an order: +{n} coins, +{tk} with Mabel\'s Golden Ticket',
  'feat.pu.order.golden': '{actor} filled a golden order: +{n} coins, +{tk} with Mabel\'s Golden Ticket',
};
