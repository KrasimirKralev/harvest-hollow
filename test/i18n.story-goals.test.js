// i18n lane C (story, goals and feed): the rules' cards say the same English through their messages, every card,
// task, blocker, feed line and Journal line reads as Bulgarian with no English template left, and the Bulgarian
// content texts (letters, tips, ribbons, the album) cover the content and follow the glossary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../public/js/i18n/index.js';
import EN_FEED from '../public/js/i18n/en/feed.js';
import BG_FEED from '../public/js/i18n/bg/feed.js';
import TEXT_C from '../public/js/i18n/bg/text-c.js';
import { CONTENT, QUEST_VERBS, TUTORIAL, STORY_BEATS, GRANDMA_VISIT, COUPLE_CHALLENGE, ALMANAC, RIBBON_WALL, isLive }
  from '../shared/content/index.js';
import { goals, taskText } from '../shared/rules/goals.js';
import { enText, taskMsg, taskLabelMsg, moreMsg, almanacMsg, GOALS_RULES_EN } from '../shared/rules/goal-text.js';
import { goalText } from '../public/js/ui/goal-text.js';
import { feedText } from '../public/js/ui/feed.js';
import * as G from '../public/js/ui/panels/goals-model.js';
import { itemSources } from '../public/js/ui/item-sources.js';
import { farmAt, put, give, runDue, credit, mulberry32, T0, MIN, HOUR } from './helpers/rules-goals.js';

/** No template left, no English slipping through, no broken number. */
function bgClean(s, where) {
  assert.equal(typeof s, 'string', where);
  assert.doesNotMatch(s, /\{[A-Za-z_$]|undefined|NaN|\[object|goals\.|feed\./, `${where}: ${s}`);
  assert.doesNotMatch(s, /\b(?:the|and|of|your|XP)\b/, `${where}: English left: ${s}`);
}

/** A spread of farms (the goals fuzz test's recipe): cards of many kinds. */
function farms(count = 40) {
  const out = [];
  for (let seed = 1; seed <= count; seed++) {
    const rnd = mulberry32(seed);
    const s = farmAt(1 + Math.floor(rnd() * 30), { seed });
    const now = T0 + Math.floor(rnd() * 10 * HOUR);
    runDue(s, now);
    for (const b of CONTENT.buildings.values()) if (isLive(b) && rnd() < 0.3 && b.unlock <= 20) put(s, b.id);
    for (const it of CONTENT.items.values()) if (isLive(it) && rnd() < 0.1) give(s, it.id, 1 + Math.floor(rnd() * 9));
    for (const id of Object.keys(s.farm.objects)) {
      const o = s.farm.objects[id];
      if (o.def === 'plot' && rnd() < 0.7) o.crop = { def: 'wheat', plantedAt: now - MIN, readyAt: now + Math.floor((rnd() - 0.5) * HOUR), by: 'p1', cycle: 0 };
    }
    if (rnd() < 0.5) credit(s, [{ e: 'cleared', id: 'x', def: 'weed', xp: Math.floor(rnd() * 30000), coins: 0 }], { now });
    out.push([s, now]);
  }
  return out;
}

test('the rules: every card\'s message says exactly its English text (the old `text` field)', () => {
  let n = 0;
  for (const [s, now] of farms()) {
    for (const pid of ['p1', 'p2']) {
      const g = goals(s, pid, now, { all: true });
      for (const c of g.all ?? []) {
        assert.ok(c.msg && c.msg.key, JSON.stringify(c));
        assert.equal(enText(c.msg), c.text);
        n++;
      }
    }
  }
  assert.ok(n > 200, `cards seen: ${n}`);
  // every quest task, its label and the land's "more" line
  for (const q of CONTENT.quests.values()) {
    for (const t of q.tasks) {
      assert.equal(enText(taskMsg(t)), taskText(t));
      assert.ok(Object.hasOwn(GOALS_RULES_EN, taskMsg(t).key), `${q.id}: ${taskMsg(t).key}`);
      assert.ok(Object.hasOwn(GOALS_RULES_EN, taskLabelMsg(t).key), `${q.id}: ${taskLabelMsg(t).key}`);
    }
  }
});

test('Bulgarian: goal cards, quest tasks, labels, land lines and the Almanac read as Bulgarian', async () => {
  await I.__loadForTest('bg');
  try {
    const seen = new Set();
    for (const [s, now] of farms()) {
      for (const pid of ['p1', 'p2']) {
        const g = goals(s, pid, now, { all: true });
        for (const c of g.all ?? []) {
          seen.add(c.msg.key);
          // a player's own words (a pet's name) and English-only content may stay; the frame must be Bulgarian
          if (c.kind === 'pet') continue;
          bgClean(goalText(c.msg), c.msg.key);
        }
      }
    }
    assert.ok(seen.size > 12, [...seen].join(' '));
    for (const q of CONTENT.quests.values()) {
      for (const t of q.tasks) {
        bgClean(goalText(taskMsg(t)), `${q.id} task`);
        bgClean(goalText(taskLabelMsg(t)), `${q.id} label`);
      }
    }
    for (const e of CONTENT.expansions.values()) {
      for (const p of e.proof ?? []) bgClean(goalText(moreMsg({ ...p, ref: Array.isArray(p.ref) ? p.ref[0] : p.ref })), `${e.id} more`);
    }
    for (const t of [{ verb: 'harvest', ref: 'wheat', qty: 12 }, { verb: 'plant', ref: 'carrot', qty: 8 }, { verb: 'water', ref: '*', qty: 5 },
      { verb: 'pet', ref: 'animal', qty: 3 }, { verb: 'fill', ref: 'order', qty: 1 }, { verb: 'clear', ref: 'debris', qty: 1 },
      { verb: 'enter', ref: 'fair', qty: 1 }, { verb: 'make', ref: 'flour', qty: 2 }, { verb: 'collect', ref: 'egg', qty: 4 }]) {
      bgClean(goalText(almanacMsg(t)), `almanac ${t.verb}`);
      bgClean(G.almanacLine(t), `journal almanac ${t.verb}`);
    }
    assert.equal(goalText(taskMsg({ verb: 'harvest', ref: 'carrot', qty: 12 })), 'Прибери 12 моркова');
    assert.equal(goalText(taskMsg({ verb: 'fill', ref: 'order', qty: 3 })), 'Изпълни 3 поръчки');
    assert.equal(goalText(taskMsg({ verb: 'upgrade', ref: 'barn', qty: 1 })), 'Подобри хамбара');
  } finally {
    I.__setForTest('en');
  }
});

test('the feed: every line starts with its actor in both languages, and reads as Bulgarian', async () => {
  for (const cat of [EN_FEED, BG_FEED]) {
    for (const [k, v] of Object.entries(cat)) {
      const all = typeof v === 'string' ? [v] : Object.values(v).flatMap((x) => (typeof x === 'string' ? [x] : Object.values(x)));
      for (const s of all) if (s.includes('{actor}')) assert.ok(s.startsWith('{actor} '), `${k}: the actor leads: ${s}`);
    }
  }
  const [s] = farms(1)[0];
  const set = [...CONTENT.collections.values()][0];
  const proj = [...CONTENT.restoration.values()][0];
  const town = [...CONTENT.townProjects.values()][0];
  const rows = [
    { k: 'harvest', item: 'carrot', q: 24 }, { k: 'tree', item: 'apple', q: 5 }, { k: 'collect', item: 'egg', q: 3 }, { k: 'tend', q: 1 },
    { k: 'water', q: 4 }, { k: 'craft', item: 'flour', q: 2 }, { k: 'sell', item: 'wheat', q: 10, c: 20 }, { k: 'order', c: 90, g: true },
    { k: 'level', level: 3 }, { k: 'buy', def: 'bakery', c: 1500 }, { k: 'buy', what: 'slot', def: 'bakery', c: 900 },
    { k: 'buy', what: 'hurry', def: 'plot', q: 4, a: 6 }, { k: 'expand', def: 'creekside' }, { k: 'ribbon', id: 'cream_of_the_crop', t: 1 },
    { k: 'quest', id: 'a1' }, { k: 'keepsake', item: 'egg', to: 'p1' }, { k: 'note' }, { k: 'golden' }, { k: 'hf', a: 'p1', b: 'p2' },
    { k: 'gift', day: 3 }, { k: 'chest', what: 'meter' }, { k: 'name', what: 'farm', text: 'Слънчева ливада' },
    { k: 'wish', def: 'bakery', what: 'deposit', c: 50 }, { k: 'wish', def: 'bakery', what: 'bought' }, { k: 'weed', q: 3 },
    { k: 'crate', c: 1240, a: 2, item: 'egg', q: 3 }, { k: 'crate', c: 300, auto: 1, by: 'sys' }, { k: 'relic', def: 'farmhand', q: 6 },
    { k: 'keep', item: 'egg', q: 6 }, { k: 'keep', item: 'egg', q: 0 },
    { k: 'fair', item: 'apple_pie', q: 2, p: 45 }, { k: 'fair', medal: 'bronze1', c: 1200, lg: 2, mv: 1, by: 'sys' },
    { k: 'barge', item: 'egg', q: 6, c: 300 }, { k: 'barge', row: 2, c: 900, a: 2 }, { k: 'album', set: set.id, item: set.items[0].id },
    { k: 'album', set: set.id, done: 1 }, { k: 'giant', crop: 'pumpkin', q: 57 }, { k: 'restore', project: proj.id, done: 1 },
    { k: 'town', id: town.id, by: 'sys' }, { k: 'track', s: '2026-autumn', t: 12, c: 3400 }, { k: 'duel', what: 'start' },
    { k: 'grandma', what: 'left' },
  ];
  await I.__loadForTest('bg');
  try {
    for (const r of rows) {
      const t = feedText({ at: T0, by: 'p2', ...r }, s, 'p1');
      bgClean(t.text, r.k);
      bgClean(G.feedText({ at: T0, by: 'p2', ...r }), `journal ${r.k}`);
    }
    assert.equal(feedText({ at: T0, by: 'p2', k: 'harvest', item: 'carrot', q: 12 }, s, 'p1').text, 'прибра 12 моркова');
    assert.equal(feedText({ at: T0, by: 'p1', k: 'sell', item: 'egg', q: 5, c: 60 }, s, 'p1').actor, 'Ти');
    assert.equal(feedText({ at: T0, by: 'p2', k: 'hf', a: 'p1', b: 'p2' }, s, 'p1').text, 'си дадохте пет!');
    for (const id of ['egg', 'wheat', 'wood', 'milk']) for (const src of itemSources(id, s, { now: T0 })) {
      for (const f of ['title', 'text', 'note']) if (src[f]) assert.doesNotMatch(src[f], /\{[A-Za-z_$]|undefined|goals\./, `${id} ${f}: ${src[f]}`);
    }
  } finally {
    I.__setForTest('en');
  }
});

/** Every string of a nested value. */
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

test('the content texts: real ids, every letter and card covered, the glossary\'s punctuation', () => {
  const T = TEXT_C;
  for (const q of CONTENT.quests.values()) {
    const b = T.quests[q.id];
    assert.ok(b && b.title && (b.done || !q.done), `quest ${q.id}`);
    if (q.letter) {
      assert.ok(b.letter?.greeting && b.letter?.signoff, `quest ${q.id} letter`);
      assert.equal(b.letter.body.length, q.letter.body.length, `quest ${q.id}: every paragraph`);
    }
  }
  for (const f of CONTENT.features.values()) {
    if (!f.card) continue;
    const b = T.features[f.id]?.card;
    assert.ok(b && b.title && b.text, `feature ${f.id}`);
    if (f.card.touchText) assert.ok(b.touchText, `feature ${f.id} touchText`);
  }
  // one source per field (lead decision): ribbon and album names live in bg/names.js (pieces in text-b finds), the
  // ribbon titles and texts and the set perks here
  for (const r of CONTENT.ribbons.values()) {
    assert.ok(T.ribbons[r.id]?.text, `ribbon ${r.id}`);
    assert.equal(T.ribbons[r.id].name, undefined, `ribbon ${r.id}: its name belongs to bg/names.js`);
    if (r.title) assert.ok(T.ribbons[r.id].title, `ribbon ${r.id} title`);
  }
  for (const c of CONTENT.collections.values()) {
    assert.ok(T.collections[c.id]?.perkText, `album ${c.id}`);
    assert.equal(T.collections[c.id].name ?? T.collections[c.id].items, undefined, `album ${c.id}: names belong to bg/names.js and text-b finds`);
  }
  for (const list of ['start', 'fields', 'barnyard', 'together']) {
    for (const st of TUTORIAL[list] ?? []) assert.ok(T.TUTORIAL[`step.${st.id}`]?.text, `tutorial ${st.id}`);
  }
  for (const f of TUTORIAL.firstUse ?? []) assert.ok(T.TUTORIAL[`firstUse.${f.id}`]?.text, `first use ${f.id}`);
  for (const b of STORY_BEATS) assert.ok(T.STORY_BEATS[b.id]?.title && T.STORY_BEATS[b.id]?.text, `beat ${b.id}`);
  for (const [stop, lines] of Object.entries(GRANDMA_VISIT.lines)) assert.equal(T.GRANDMA_VISIT.lines[stop]?.length, lines.length, `grandma ${stop}`);
  for (const n of CONTENT.npcs.values()) if (n.lines) assert.equal(T.npcs[n.id]?.lines?.length, n.lines.length, `npc ${n.id}`);
  for (const c of COUPLE_CHALLENGE.templates) assert.ok(T.COUPLE_CHALLENGE[c.id]?.text, `challenge ${c.id}`);
  for (const c of ALMANAC.together.templates) assert.ok(T.ALMANAC[`together.${c.id}`]?.text, `together ${c.id}`);
  for (const w of RIBBON_WALL) assert.ok(T.RIBBON_WALL[w.unlock]?.name, `wall ${w.unlock}`);
  for (const e of CONTENT.expansions.values()) if (e.proofText) assert.ok(T.expansions[e.id]?.proofText, `land ${e.id}`);
  for (const fam of ['quests', 'features', 'ribbons', 'collections', 'npcs', 'expansions']) {
    for (const id of Object.keys(T[fam])) assert.ok(CONTENT[fam].has(id), `${fam}.${id} is a content id`);
  }
  for (const s of strings(T)) {
    assert.doesNotMatch(s, /—|"|\bXP\b|\bLv\b/, `glossary punctuation and words: ${s}`);
    assert.doesNotMatch(s, /\((?:а|а)\)|\/ка\b/, `no gender hacks: ${s}`);
  }
  // a placeholder in a template stays a placeholder
  for (const c of COUPLE_CHALLENGE.templates) {
    for (const p of ['{coins}', '{n}']) assert.equal(T.COUPLE_CHALLENGE[c.id].text.includes(p), c.text.includes(p), `${c.id} ${p}`);
  }
  assert.ok(QUEST_VERBS.plant);
});
