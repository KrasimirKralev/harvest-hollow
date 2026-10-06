// English catalog, area 'shell' (lane A): ui/index.js (the loading screen, the farmer picker, the panel frame, the
// shell's own toasts and banners) and the static skeleton of index.html ([data-i18n] attributes).
export default {
  // the loading screen
  'shell.boot.waking': 'Waking up the farm…',
  'shell.boot.open': 'Opening the gate…',
  'shell.boot.retry': 'The farm is not answering yet. Trying again…',
  'shell.boot.asleep': 'The farm server seems to be asleep. Is it running? Still trying…',
  'shell.boot.mismatch': 'The farm server runs other game files. Restart it, then reload.',
  'shell.boot.failed': 'Harvest Hollow could not start (WebGL2 needed). Check the console.',
  'shell.noscript': 'Harvest Hollow needs JavaScript and WebGL2.',

  // the farmer picker
  'shell.slot.who': 'Who is playing on this screen?',
  'shell.slot.welcomeBack': 'Welcome back! Who is playing on this screen?',
  'shell.slot.pickOne': 'Pick one farmer for this screen. Your partner takes the other one on their own screen.',
  'shell.slot.invitedBy': '{host} invited you! Pick your name and colour to farm together.',
  'shell.slot.invited': 'You are invited! Pick your name and colour to farm together.',
  'shell.slot.newFarm': 'Your new farm is ready! Who is the first farmer?',
  'shell.slot.playing': 'Playing right now',
  'shell.slot.away': 'Away',
  'shell.slot.continue': 'Continue',
  'shell.slot.newDevice': 'Is this you on a new device? Open your personal farm link.',
  'shell.slot.pass': 'Farm passphrase',
  'shell.slot.reclaim': 'This is me on a new computer',
  'shell.slot.name': 'Your name',
  'shell.slot.nameFor': 'Name for farmer {n}',
  'shell.slot.play': 'Play',
  'shell.slot.needName': 'Type a name first.',
  'shell.slot.needPass': 'Type the farm passphrase too.',
  'shell.slot.colour': 'Colour',
  'shell.slot.colourTaken': '{name} has {colour}. Pick another colour.',
  'shell.slot.swatchTaken': '{name} has {colour}',
  'shell.slot.swatchTakenLabel': '{colour}: {name} has it',
  'shell.slot.lockout': 'Too many wrong passphrases. Wait a minute.',
  'shell.swatch.teal': 'Teal',
  'shell.swatch.coral': 'Coral',
  'shell.swatch.sunflower': 'Sunflower',
  'shell.swatch.sky': 'Sky',
  'shell.swatch.plum': 'Plum',
  'shell.swatch.leaf': 'Leaf',
  'shell.swatch.this': 'this colour',

  // the panel frame
  'shell.panel.broken': 'This page could not be drawn. The farm is fine; try again in a moment.',

  // the partner comes and goes (a feed line after the farmer's name, and a toast)
  'shell.peer.arrivedFeed': 'arrived on the farm 🌻',
  'shell.peer.leftFeed': 'left for now',
  'shell.peer.arrived': '{name} arrived 🌻',

  // photo mode
  'shell.photo.mode': 'Photo mode: press P or Esc to come back',
  'shell.photo.label': 'Your photo',
  'shell.photo.alt': 'A photo of the farm',
  'shell.photo.save': 'Press and hold the picture to save or share it.',

  // the partner asks for coins saved for a wish
  'shell.wish.ribbon': 'A wish question',
  'shell.wish.ask': '{name} would like to use the {n} coins you saved for the {thing}. With no answer it is released in {left}.',
  'shell.wish.askAny': '{name} would like to use the {n} coins you saved for a wish. With no answer it is released in {left}.',
  'shell.wish.yes': 'Yes, go ahead',
  'shell.wish.keep': 'Keep saving',

  // hearts toasts ("+2 ♥  {reason}")
  'shell.hearts.thanks': '{name} said thanks',
  'shell.hearts.team': 'Teamwork',
  'shell.hearts.tend': '{name} tended your crops',
  'shell.hearts.highFive': 'High five!',
  'shell.hearts.keepsake': 'A keepsake from {name}',
  'shell.highFiveWait': '{name} holds up a hand for a high five ✋ (T)',

  // index.html: the HUD skeleton's names for screen readers and its tips
  'shell.html.canvas': 'The farm. Click a plot to plant or harvest; Q and E rotate the view.',
  'shell.html.farm': 'Farm',
  'shell.html.levelCard': 'Farm level',
  'shell.html.levelSr': 'Farm level',
  'shell.html.xpBar': 'Farm XP',
  'shell.html.farmers': 'Farmers',
  'shell.html.goals': 'Goals',
  'shell.html.treasury': 'Treasury',
  'shell.html.coinsTip': 'Farm treasury (shared). Open the Market',
  'shell.html.acornsTip': 'Acorns (shared). Rare treats for special things',
  'shell.html.heartsTip': 'Your hearts (personal): earned by playing together',
  'shell.html.barnTip': 'The Barn (I)',
  'shell.html.coinsSr': ' coins',
  'shell.html.acornsSr': ' acorns',
  'shell.html.heartsSr': ' hearts',
  'shell.html.barnSr': ' items in the barn',
  'shell.html.view': 'View',
  'shell.html.together': 'Together',
  'shell.html.activity': 'Activity',
  'shell.html.seeds': 'Seeds',
  'shell.html.build': 'Build',
  'shell.html.tools': 'Tools',
  'shell.html.menus': 'Farm menus',
};
