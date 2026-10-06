// The rules' messages on screen (i18n lane C). shared/rules/goals.js and actions/quests.js build every Goal Tracker
// card, task line and blocker as { key, params } (shared/rules/goal-text.js); this module says one in the language in
// effect: English exactly as the rules always wrote it (enText), Bulgarian through the catalog (i18n/bg/goals.js) with
// the content names in their Bulgarian forms.
//
//   goalText(msg) -> string     a message (or a plain string, passed through) as text
import { enText } from '../../../shared/rules/goal-text.js';
import { lang, t, fmtNum, fmtDec, list, ctext, N, Q, name, qty, nameEntry } from '../i18n/index.js';

/**
 * Bulgarian prepositions that grow before a like sound: "в" -> "във" before в / ф, "с" -> "със" before с / з ("във
 * вятърната мелница", "със захарна тръстика"). A template cannot know the name it will hold, so the sentence is fixed
 * once it is whole. English passes through.
 */
export function prep(s) {
  if (lang() !== 'bg' || typeof s !== 'string') return s;
  return s.replace(/(^|[\s(„])([вВ]) (?=[вфВФ])/g, '$1$2ъв ').replace(/(^|[\s(„])([сС]) (?=[сзСЗ])/g, '$1$2ъс ');
}

/** A wait in the cards' clock words, Bulgarian: "4:05", "2:15 ч", "23 ч 59 мин". */
export function mmssBg(v) {
  const s = Math.max(0, Math.ceil(v / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const m = Math.ceil(s / 60);
  if (m < 600) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} ч`;
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

/** One param for t(): content refs stay refs (so the template may ask {x:defObj}), the rest is a number or text. */
function param(v) {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (Object.hasOwn(v, '$int')) return v.$int;
  // a name the Bulgarian table does not have yet keeps the English the rules said (never an id)
  if (Object.hasOwn(v, '$name')) return nameEntry(v.$name, v.family) || v.en === undefined ? N(v.$name, v.family) : v.en;
  if (Object.hasOwn(v, '$qty')) return Q(v.$qty, v.n, v.family);
  // the bare noun as a count says it: "моркови", "пшеница" (one: "морков")
  if (Object.hasOwn(v, '$noun')) return name(v.$noun, { form: v.n === 1 ? 'lc' : 'pl', family: v.family });
  if (Object.hasOwn(v, '$mmss')) return mmssBg(v.$mmss);
  if (Object.hasOwn(v, '$p10')) return fmtDec(v.$p10 / 10, 1);
  if (Object.hasOwn(v, '$ctext')) return String(ctext(...v.$ctext) ?? '');
  if (Object.hasOwn(v, '$msg')) return goalText(v.$msg);
  if (Object.hasOwn(v, '$join')) {
    const items = v.$join.map((x) => asText(x));
    if (v.sep === 'plus') return items.join(' + ');
    if (v.sep === 'comma') return items.join(', ');
    return list(items, v.sep === 'or' ? 'or' : 'and');
  }
  return v;
}

/** A param as plain text (a list item: a quantity, a name inside a sentence, a nested message). */
function asText(v) {
  if (v && typeof v === 'object') {
    if (Object.hasOwn(v, '$qty')) return qty(v.$qty, v.n, { family: v.family });
    if (Object.hasOwn(v, '$name')) return name(v.$name, { form: 'lc', family: v.family });
  }
  const p = param(v);
  return typeof p === 'number' ? fmtNum(p) : String(p ?? '');
}

/** A rules message in the language in effect (a plain string passes through). */
export function goalText(m) {
  if (m === null || m === undefined) return '';
  if (typeof m === 'string') return m;
  if (lang() === 'en') return enText(m);
  const p = {};
  for (const [k, v] of Object.entries(m.params || {})) p[k] = param(v);
  const out = t(m.key, p);
  return out === m.key ? enText(m) : prep(out);
}
