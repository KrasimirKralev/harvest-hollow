// Bulgarian content texts (descriptions, letters, tips...) by content family and id, mirroring the English tables'
// shape: { [family]: { [id]: { [field]: value } } }. Read through i18n/names.js ctext(family, id, field, english).
// Two lanes write content text, each in its own file: text-b.js (lane B: names-adjacent texts such as ribbons,
// collections, decor and npcs roles) and text-c.js (lane C: quests and letters, features cards, TUTORIAL, STORY_BEATS,
// GRANDMA_VISIT, npcs lines, COUPLE_CHALLENGE, ALMANAC, PLAYER_TEXT). This file only merges them (lane A).
import b from './text-b.js';
import c from './text-c.js';

function merge(a, z) {
  const out = { ...a };
  for (const [k, v] of Object.entries(z)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : v;
  }
  return out;
}

export default merge(b, c);
