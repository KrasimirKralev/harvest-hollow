// Player text hygiene (names, farm names, chat lines): what the server keeps or relays must not blank, mirror or smear
// the other farmer's screen. A leaf module with no imports: shared/net/protocol.js re-exports it, and the landing page
// (public/js/net/farm.js, its "farms on this device" list) uses it without loading the protocol.

/**
 * The invisible bidi controls (LRM, RLM, ALM, the embeddings, overrides and isolates): one RLO at the start of a name
 * mirrored the partner's whole "Hello again, …" line (QA r1 I-02). Right-to-left letters are not controls and stay.
 */
const BIDI_CONTROLS = /[‎‏؜‪-‮⁦-⁩]/g;
/** `s` without the bidi controls (any player text the server keeps or relays). */
export const stripBidi = (s) => s.replace(BIDI_CONTROLS, '');

// QA r2 I2-02 (br#7): three more ways a partner could blank or smear the other farmer's screen on the public host.
/** A UTF-16 surrogate without its partner (drawn as "�"): a high one not followed by a low one, or a lone low one. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
/** The combining marks after the first two on one letter (25 per letter drew a name over the feed line above it). */
const MARK_STACK = /(\p{M}{2})\p{M}+/gu;
/** A ZWJ, ZWNJ, ZWSP... between two marks stacks them on one letter (QA r3 I3-C1); an emoji's own joiner stays. */
const JOINED_MARKS = /(?<=\p{M})\p{Cf}+(?=\p{M})/gu;
/** At most two combining marks per letter: run it after every strip (QA r3 I3-C1). */
export const capMarks = (s) => s.replace(JOINED_MARKS, '').replace(MARK_STACK, '$1');
/** Something a reader can see: a letter, digit, symbol or punctuation mark... */
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
/** ...that is not one of the blank "letters" (the Hangul fillers, the braille blank), which draw nothing at all. */
const BLANK_LOOKING = /[ᅟᅠㅤﾠ⠀]/g;

/** True when `s` holds at least one character a reader can see (two zero-width spaces blanked a farm name). */
export const hasVisible = (s) => typeof s === 'string' && VISIBLE.test(s.replace(BLANK_LOOKING, ''));

// QA r4 L4-09: a cut inside one emoji drew half of it (half a family, a thumb without its tone, half a flag)
const CONTINUES = /^[\u{200D}\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\u{20E3}]/u;
const OPEN_TAIL = /(?:\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*\u{200D})*\p{Extended_Pictographic}?[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*\u{200D}?$/u;
const RI_TAIL = /\p{Regional_Indicator}+$/u;

/** `s` cut to `max` UTF-16 units, ending on a whole surrogate pair, a whole emoji picture and a whole flag. Pure. */
function cutWhole(s, max) {
  if (s.length <= max) return s;
  const hi = s.charCodeAt(max - 1);
  const cut = hi >= 0xd800 && hi <= 0xdbff ? max - 1 : max;
  let out = s.slice(0, cut);
  const next = s.slice(cut);
  if (CONTINUES.test(next) || out.endsWith('‍')) out = out.replace(OPEN_TAIL, '');
  const ri = RI_TAIL.exec(out);
  if (ri && /^\p{Regional_Indicator}/u.test(next) && [...ri[0]].length % 2) out = out.slice(0, -2);
  return out;
}

/**
 * Player text as the server keeps or relays it, cut to `max` UTF-16 units: no bidi controls, no lone surrogates, at
 * most two combining marks per letter, trimmed; '' when nothing visible is left. `ctrl` is what a C0 control or DEL
 * becomes (a name drops it, a chat line makes it a space). The cut never leaves half a surrogate pair, half an emoji
 * picture or half a flag. Input only:
 * a stored text is never rewritten.
 * @param {unknown} s @param {number} max @param {string} [ctrl]
 * @returns {string}
 */
export function cleanText(s, max, ctrl = '') {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = stripBidi(s.replace(/[\u0000-\u001f\u007f]/g, ctrl)).replace(LONE_SURROGATE, '');
  const out = cutWhole(capMarks(stripped).trim(), max).trim();
  return hasVisible(out) ? out : '';
}
