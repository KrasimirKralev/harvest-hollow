// English catalog, area 'dock' (release 1.0, ui-shell lane): the dock, the Farm book, toolbar and phone bar.
export default {
  // Settings > Accessibility > Motion (M25): follow the device's reduced-motion setting until the player picks
  'dock.motion.system': 'Auto',
  // "Auto" is one short word so the four choices keep one row on a phone (QA r4 S4-14); this line says what it does
  'dock.motion.systemHelp': "Auto follows this device's reduced-motion setting.",
  // Grandma's coach (M1a): naming the farm is a chip after the first harvest, never the first step
  'dock.coach.name': 'Name your farm',
  'dock.coach.firstSeed': 'Click an empty plot, then pick Wheat.',
  // a coach step that waits for a farm level (QA r1 S-03): the deed that gets there
  'dock.coach.grow': 'Plant and harvest more to reach level {level} ({n} XP to go).',
  'dock.coach.ripeIn': 'ripe in {d}',
  'dock.coach.harvestSeeding': 'Drag across the ripe Wheat: the Hand harvests it, even with a seed in it.',
  // a make step whose job is queued (QA r2 S-06): when it is done, then where it waits
  'dock.coach.makeIn': 'ready in {d}, then collect it',
  'dock.coach.makeReady': 'ready: collect it',
  // the empty plot's card for the bare Hand: its drag asks which seed first (QA r2 S-07)
  'dock.tip.plantHere': 'Plant a seed here',
  // a hungry animal's card (QA r3 S3-13): its state, and when its feed is missing
  'dock.tip.hungry': 'Hungry',
  'dock.tip.hungryNoFeed': 'Hungry · no {feed} in the Barn',
  // the right edge (S1, S3): one quarter-turn button
  'dock.xp.pct': '{pct}',
  // the seeds (D3): when a crop planted now is ready, on the farm's clock
  'dock.seed.ready': 'ready {t}',
  'dock.seed.readyTomorrow': 'ready tomorrow {t}',
  'dock.seed.readyDays': 'ready in {n} days, {t}',
  // the hover card's "what a click does" line (S7) and the refusal at the object (S7, feel#7)
  'dock.verb.harvest': 'Click to harvest',
  'dock.verb.water': 'Click to water it',
  'dock.verb.tend': 'Click to feed and collect',
  'dock.verb.collect': 'Click to collect',
  'dock.verb.pet': 'Click to pet',
  'dock.verb.pick': 'Click to pick the fruit',
  'dock.verb.chop': 'Click to chop',
  'dock.verb.sit': 'Click to sit down',
  'dock.verb.stand': 'Click to stand up',
  'dock.verb.fish': 'Click to sit and fish',
  'dock.verb.ride': 'Click to ride',
  'dock.verb.open': 'Click to open it',
  'dock.verb.uproot': 'Click to pull it up',
  'dock.verb.spread': 'Click to spread it',
  'dock.verb.bottle': 'Click to give the bottle',
  'dock.verb.nurse': 'Click for the next care step',
  'dock.verb.weed': 'Click to pull it up',
  'dock.verb.clear': 'Click to clear it',
  'dock.verb.pickSeed': 'Click to choose a seed',
  'dock.verb.plant': 'Click to plant {crop}',
  'dock.verb.useHand': 'The Hand does this',
  'dock.why.readyIn': '{thing} · ready in {d}',
  'dock.why.full': '{thing} · not hungry yet',
  'dock.why.blocked': 'In the way: {thing}',
  // a tool with nothing to do on what was clicked says so there (QA r3 S3-09)
  'dock.why.toolHere': '{tool}: nothing to do here',
  // a surprise on the porch (D1)
  'dock.gift.forYou': 'For you! Click to open it',
  'dock.gift.waiting': 'For {name}: waiting on the porch',
  'dock.finish.fold': 'Finish now',
  // the picker's short form keeps its "ready" word: a bare "14:37" read as the time now on a phone (QA r3 S3-08)
  'dock.seed.clock': 'by {t}',
  'dock.seed.clockTomorrow': 'tomorrow {t}',
  'dock.seed.clockDays': 'in {n} days',
  'dock.seed.in': 'in {d}',
  'dock.edge.turn': 'Turn the view',
  // the folded numbers (S1, M30): the level card's hover
  'dock.stat.acorns': 'Acorns {n}',
  'dock.stat.hearts': 'Hearts {n}',
  'dock.stat.beauty': 'Beauty {n} ★ {stars}/{max}',
  // the Farm book (S1, S3): one name and the same groups on every device
  'dock.book.btn': 'Farm book',
  'dock.book.title': 'Farm book',
  'dock.book.tip': 'Farm book: this week, animals, the village and you',
  'dock.book.label': 'Farm book: this week, animals, the village and you',
  'dock.book.labelNeeds': 'Farm book (something needs you): this week, animals, the village and you',
  'dock.book.labelTodo': 'Farm book (something to do): this week, animals, the village and you',
  'dock.book.week': 'This week',
  'dock.book.animals': 'Animals',
  'dock.book.village': 'Village',
  'dock.book.you': 'You',
  'dock.book.together': 'Together',
  'dock.book.heartsLabel': 'Your hearts: {n}. Earned together',
  'dock.book.acorns': 'acorns',
  'dock.book.acornsLabel': 'The farm\'s acorns: {n}. Open the Acorn shop',
  'dock.book.beauty': 'beauty ★ {stars}/{max}',
  'dock.book.beautyLabel': 'Farm Beauty {n}, {stars} stars. Open Farm Beauty',
  // the toolbar of 3 (S2) and the phone's tool slot (S3)
  'dock.tools.slot': 'Tools',
  'dock.tools.label': 'Tools: Sickle, Water, Feed, Basket, Compost, Axe',
  'dock.tools.labelIn': 'Tools: {tool} in hand. Show the other tools',
  'dock.tools.tip': 'Tools: Sickle, Water, Feed, Basket, Compost, Axe (keys 3 to 8)',
  'dock.tools.curLabel': 'Tool in hand: {tool}. Show every tool',
  'dock.tools.popLabel': 'Every tool, and Build',
  'dock.build.left': 'More of the build tray to the left',
  'dock.build.right': 'More of the build tray to the right',
  // the touch ✓ of a bought piece says its price (QA r1 S-06)
  'dock.build.placeCost': 'Place · {coins}',
  'dock.build.placeCostLabel': 'Place it here for {coins} coins',
  // Together (S4) and the gift's door (M21)
  'dock.together.label': 'Together with {name}: ping, wave, talk, notes, a surprise',
  'dock.together.tip': 'Together with {name}',
  'dock.together.menu': 'Together',
  'dock.together.gift': 'Leave a surprise',
  'dock.together.giftShort': 'Surprise',
  'dock.together.giftTip': '🎁 Leave a surprise for {name}',
  // a surprise waiting for me (QA r3 S3-C2): the gift's door opens it, Together says so
  'dock.together.giftOpen': 'Open your surprise',
  'dock.together.giftOpenShort': 'Open it',
  'dock.together.labelGift': 'Together with {name}: a surprise is waiting for you',
  // the partner on a bench (D2)
  'dock.bench.waiting': '🌅 {name} is waiting on the bench',
  'dock.bench.join': 'Join',
  'dock.bench.joinLabel': 'Join {name} on the bench',
  // Undo during its ten minutes (S3)
  'dock.undo.thing': 'Undo: {thing}',
  'dock.undo.label': 'Undo my last purchase or move: {thing}',
};
