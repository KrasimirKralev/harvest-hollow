// English catalog, area 'privacy': the in-game privacy words: Settings > Farm's Privacy rows, "Delete this farm now" and
// its confirm (ui/privacy.js), and the "This farm was deleted" gate and every gate's privacy link (ui/farm-gate.js).
// The privacy page itself (public/privacy.html) carries both languages in the page.
export default {
  // ---- Settings > Farm (ui/privacy.js)
  'privacy.title': 'Privacy',
  'privacy.row': 'Your data',
  'privacy.link': 'Read the privacy note',
  'privacy.help.multi': 'What this site keeps about you, for how long, and how to ask for a copy or a deletion.',
  'privacy.help.single': 'This farm server keeps your farm on its own computer; nothing goes anywhere else.',
  'privacy.delete.row': 'Delete this farm',
  'privacy.delete.button': 'Delete this farm now…',
  'privacy.delete.help': 'Everything on it goes at once, for both farmers. This cannot be undone.',
  // ---- the confirm (ui/dialogs.js confirm: "Keep my farm" has the focus)
  'privacy.delete.confirm.title': 'Delete this farm?',
  'privacy.delete.confirm.lead': 'Everything on {farm} goes, for both farmers.',
  'privacy.delete.confirm.leadNoName': 'Everything on this farm goes, for both farmers.',
  'privacy.delete.confirm.body': 'The fields, the animals, the buildings, both farmers and all their progress, and every backup are deleted at once. Nobody can bring them back, not even us.',
  'privacy.delete.confirm.ok': 'Delete it for good',
  'privacy.delete.confirm.cancel': 'Keep my farm',
  'privacy.delete.confirm.fine': 'If your partner is playing, their screen will say the farm was deleted.',
  'privacy.delete.err.AUTH': 'This device cannot delete this farm. Open your personal farm link first.',
  'privacy.delete.err.RATE': 'Lots of farms were just deleted from this network. Try again a little later.',
  'privacy.delete.err.NET': 'The farm did not answer, so nothing was deleted. Try again in a moment.',
  // ---- the gate of a deleted farm, and every gate's privacy link (ui/farm-gate.js)
  'privacy.gate.deleted.title': 'This farm was deleted',
  'privacy.gate.deleted.lead': 'One of its farmers deleted it, with everything on it. Thank you for farming here! A new farm takes one tap.',
  'privacy.gate.link': 'Privacy',
  // ---- the privacy page's script (js/privacy.js; the page's own text is public/privacy.html, in both languages)
  'privacy.page.err.kind': 'Pick what you would like.',
  'privacy.page.err.short': 'A few more words, please: at least {min} characters.',
  'privacy.page.err.long': 'That is over {max} characters. Could you make it a little shorter?',
  'privacy.page.err.contact': 'A contact of up to {max} characters, please.',
  'privacy.page.sending': 'Sending…',
  'privacy.page.send': 'Send my request',
  'privacy.page.err.RATE': 'Lots of requests from this network just now. Please try again a little later.',
  'privacy.page.err.FULL': 'Too many requests today. Please try again tomorrow.',
  'privacy.page.err.BAD': 'Something in the form was not right. Please check it and try again.',
  'privacy.page.err.NET': 'The server did not answer. Your words are still here: try again in a moment.',
};
