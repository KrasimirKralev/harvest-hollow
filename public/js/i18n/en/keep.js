// English catalog, area 'keep': the "keep your key" work in multi-farm mode: the "Keep your farm safe" card
// (ui/keep.js), Settings > Farm's Farmers and a farmer's new key, the farmer picker of a new-key link (ui/index.js),
// the invite card of a full farm (ui/invite.js), the gates of a lost device (ui/farm-gate.js), the way back in
// (ui/link-open.js, also on the landing page) and the QR scanner (ui/qr-scan.js). Loaded on its own by i18n/keep.js.
export default {
  // ---- the "Keep your farm safe" card (ui/keep.js)
  'keep.title': 'Keep your farm safe',
  'keep.lead': 'This link is your key to the farm: it opens the farm as you on any phone or computer. There are no accounts, so keep it somewhere safe, like a note to yourself or a photo of its QR code.',
  'keep.why.partner': 'If you ever lose it, {name} can make you a new key in Settings.',
  'keep.why.alone': 'Right now you are the only farmer here, so nobody can make you a new key: this link and its QR code are your only way back.',
  'keep.private': 'Keep it private: whoever has it plays as you.',
  'keep.share': 'Share to myself',
  'keep.copy': 'Copy',
  'keep.qr.show': 'Show a QR code',
  'keep.qr.hide': 'Hide the QR code',
  'keep.qr.label': 'QR code of your personal farm link',
  'keep.qr.help': 'Scan it with your other phone\'s camera to open the farm there, or keep a photo of it.',
  'keep.saved': 'I saved it',
  'keep.later': 'Later',
  'keep.copied': 'Copied. Paste it somewhere only you can see.',
  'keep.copy.fail': 'Press and hold the link to copy it.',
  'keep.share.title': 'My Harvest Hollow farm',
  'keep.share.text': 'My personal link to my farm. Keep it private: it opens the farm as me.',
  'keep.thanks': 'Lovely. Your farm is safe.',
  'keep.nolink': 'Your personal link is not ready yet. Open this card again in a moment.',
  'keep.field': 'Your personal farm link',

  // ---- Settings > Farm
  'keep.set.label': 'Keep your farm safe',
  'keep.set.unsaved': 'Not saved yet',
  'keep.set.saved': 'Saved',
  'keep.set.open': 'Save my link',
  'keep.set.show': 'Show my link',
  'keep.set.help': 'Your personal link and its QR code: your way back to this farm on any device.',
  'keep.dot': 'Your personal farm link is not saved yet',
  'keep.farmers.title': 'Farmers',
  'keep.farmers.online': 'Playing right now',
  'keep.farmers.seen': 'Last here {ago}',
  'keep.farmers.rekey': 'Make a new key for {name}',
  'keep.farmers.rekey.help': 'Lost their phone, or gone for good? A new key signs their old devices out and gives you a one-time link to their farmer.',
  'keep.farmers.alone': 'Only you so far. When a friend joins, you can each make the other a new key if a phone is lost.',
  'keep.farmers.waiting': 'A new key is waiting until {date}.',
  'keep.farmers.waiting.show': 'Show the link',
  // when a farmer was last here ("Last here {ago}")
  'keep.ago.now': 'just now',
  'keep.ago.minute': { one: 'a minute ago', other: '{n} minutes ago' },
  'keep.ago.hour': { one: 'an hour ago', other: '{n} hours ago' },
  'keep.ago.day': { one: 'yesterday', other: '{n} days ago' },

  // ---- making a new key (the confirm, the link card, the refusals)
  'keep.rekey.confirm.title': 'Make a new key for {name}?',
  'keep.rekey.confirm.lead': 'Their old phones will be signed out.',
  'keep.rekey.confirm.body': 'You get a one-time link that opens the farm as {name}, with everything {name} has. Send it to {name}, or to whoever takes their place.',
  'keep.rekey.confirm.ok': 'Make a new key',
  'keep.rekey.confirm.cancel': 'Not now',
  'keep.newkey.title': 'A new key for {name}',
  'keep.newkey.lead': 'Send this link to {name}. It opens the farm as {name} on any phone, once, within {days} days.',
  'keep.newkey.rules': 'Their old devices are signed out. Making another new key turns this link off.',
  'keep.newkey.label': 'New key link for {name}',
  'keep.newkey.share.text': 'Here is your new key to our farm in Harvest Hollow.',
  'keep.newkey.qr.label': 'QR code of the new key link for {name}',
  'keep.newkey.gone': 'This link was used or has run out. Make a new key in Settings if it is still needed.',
  'keep.newkey.done': 'Done',
  'keep.rekey.err.RATE': 'Lots of new keys just now. Try again later.',
  'keep.rekey.err.AUTH': 'This device cannot make keys for this farm. Open your personal farm link first.',
  'keep.rekey.err.BAD': 'That farmer cannot get a new key.',
  'keep.rekey.err.NET': 'The farm did not answer. Try again in a moment.',

  // ---- the farmer picker when a new-key link was opened (ui/index.js showSlots)
  'keep.rejoin.sub': 'A new key for {name}! It opens the farm as {name}, with everything {name} has. Change the name if you like.',
  'keep.rejoin.name': 'Name for this farmer',
  'keep.rejoin.go': 'That\'s me',

  // ---- the invite card on a farm with two farmers (ui/invite.js)
  'keep.invite.full.rekey': 'Did {name} lose their way in? Make them a new key: their farmer and everything on the farm stay.',
  'keep.invite.full.waiting': '{name}\'s new key is waiting. Send them this link.',

  // ---- the gates (ui/farm-gate.js)
  'keep.gate.rekeyed.title': 'This farmer was given a new key',
  'keep.gate.rekeyed.lead': 'A partner made a new key for this farmer, so this device is signed out. Nothing on the farm is lost.',
  'keep.gate.rejoin.title': 'This new-key link no longer works',
  'keep.gate.rejoin.lead': 'A new-key link opens the farm once, within 7 days, and a newer one turns it off.',
  'keep.gate.home.title': 'Open your farm in this app',
  'keep.gate.home.lead': 'This home-screen app keeps its own storage, apart from your browser. Open your personal farm link here once: paste it or scan its QR code.',
  'keep.gate.home.where': 'You find it in your browser: Settings › Farm › Keep your farm safe.',
  // ---- the way back in (ui/link-open.js: the gates and the landing page)
  'keep.gate.back.title': 'Lost your way in?',
  'keep.gate.back.ask': 'Ask your partner for a new key for your farmer: in Settings › Farm › Farmers they tap “Make a new key” and send you the link. Your farmer and everything on the farm stay.',
  'keep.gate.back.paste': 'Paste your personal link',
  'keep.gate.back.open': 'Open',
  'keep.gate.back.scan': 'Scan my QR code',
  'keep.gate.back.photo': 'Use a photo of it',
  'keep.gate.back.bad': 'That does not look like a farm link. It starts with the address of this site.',
  'keep.gate.back.noqr': 'No QR code found in that picture. Try a sharper photo, or paste the link.',
  'keep.gate.back.notlink': 'That QR code is not a Harvest Hollow farm link.',

  // ---- the camera scanner (ui/qr-scan.js)
  'keep.scan.title': 'Scan your QR code',
  'keep.scan.help': 'Point the camera at the QR code of your personal farm link.',
  'keep.scan.looking': 'Looking for a QR code…',
  'keep.scan.cancel': 'Cancel',
  'keep.scan.nocam': 'The camera is not available here. Use a photo of the QR code, or paste the link.',
};
