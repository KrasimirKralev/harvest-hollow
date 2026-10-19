// English catalog, area 'cheer' (release 1.0, life-feel lane): rewards, cards and the feedback that lands over panels.
export default {
  // M10 (ux-first#18): a recap list's fold
  'cheer.recap.more': { one: 'and 1 more', other: 'and {n} more' },
  // QA r4 L4-05: the fold above the partner's newest lines (the older ones)
  'cheer.recap.earlier': { one: '1 earlier', other: '{n} earlier' },
  // D1 (features#F1): the welcome-back card
  'cheer.recap.surprises': 'A surprise for you',
  'cheer.recap.surprise': '{name} left you a surprise on the porch',
  'cheer.recap.thanks': '♥ Thanks for everything',
  'cheer.recap.thanked': 'Thanked ♥',
  // D1: the feed's surprise lines (ui/feed.js, row kind 'surprise')
  'cheer.feed.left': '{actor} left a surprise for {to}',
  'cheer.feed.leftYou': '{actor} left a surprise for you',
  'cheer.feed.opened': "{actor} opened {from}'s surprise: {item}",
  'cheer.feed.openedYours': '{actor} opened your surprise: {item}',
  'cheer.feed.shelved': "{from}'s surprise went to {to}'s shelf",
  'cheer.feed.shelvedYou': "{from}'s surprise went to your shelf",
  // QA r1 L-01: the recipient's lines quote the giver's note; L-07: the giver's own surprise, shelved by the farm
  'cheer.feed.openedNote': "{actor} opened {from}'s surprise: {item} · “{note}”",
  'cheer.feed.shelvedYouNote': "{from}'s surprise went to your shelf · “{note}”",
  'cheer.feed.shelvedMine': "Your surprise went to {to}'s shelf",
  // QA r1 L-01: the card that opens with the box (either door), above any open panel
  // QA r2 L2-09: the ribbon stays short (a 16-letter giver's name ran it to three lines at 360); the message names them
  'cheer.gift.ribbon': 'A surprise!',
  'cheer.gift.wrapped': '{name} wrapped {item} for you',
  'cheer.gift.quote': '“{note}”',
  'cheer.gift.thanks': '♥ Thanks',
  // D4 (features#F4): a named animal's gift, floated at it and once a day in the feed
  'cheer.named.float': '{name} +{n}',
  'cheer.named.gave': '{name} gave {q}',
  // QA r1 I-01: an order, a townsfolk request or a barge crate someone already handed in (no partner to name)
  'cheer.gone.delivered': 'Already delivered.',
  'cheer.gone.loaded': 'Already loaded.',
  // QA r2 L2-07 (coop#6): a surprise just left on the porch, on the recipient's screen (the feed line pans there too)
  'cheer.feed.leftYouPorch': '{actor} left a surprise for you by the porch',
  'cheer.gift.leftYou': '🎁 {name} left you a surprise by the porch',
  // QA r2 L2-06 (coop#4): one collect's named animals in one line
  'cheer.named.gaveMany': '{names} gave {q}',
  'cheer.named.two': '{a} and {b}',
  'cheer.named.more': { one: '{names} and 1 more', other: '{names} and {n} more' },
  // QA r2 S2-20 (fbp#11): the day's together task finished on a farm with one farmer names the deed, not "together"
  'cheer.task.solo.harvest_together': { one: 'Task of the day done: 1 crop harvested', other: 'Task of the day done: {n} crops harvested' },
  'cheer.task.solo.collect_together': { one: 'Task of the day done: 1 animal good collected', other: 'Task of the day done: {n} animal goods collected' },
  'cheer.task.solo.craft_together': { one: 'Task of the day done: 1 good crafted', other: 'Task of the day done: {n} goods crafted' },
  'cheer.task.solo.water_together': { one: 'Task of the day done: 1 crop watered', other: 'Task of the day done: {n} crops watered' },
  'cheer.task.solo.orders_together': { one: 'Task of the day done: 1 order filled', other: 'Task of the day done: {n} orders filled' },
  'cheer.task.solo.any': 'Task of the day done!',
};
