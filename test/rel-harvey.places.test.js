// QA r1 H-11 (hv#12): Harvey's scripted honesty answers point the farmer to places in the game. Two Bulgarian ones said
// "в Тефтера на фермата" ("Тефтерът" is the Ledger, home.js); the Farm book is "Книжката на фермата". Every place a
// fixture names must exist in that language's catalogs, and docs/game-features.md gives the agent the Bulgarian names.
// The check: each side of every "A › B" path in a fixture's summary is a string of the game's catalogs (EN or BG), and
// no Bulgarian answer names the Ledger as a place for pets or looks.
// RED on 7f67efe: hs-02 and hs-09 say "Тефтера на фермата"; game-features.md has no Bulgarian name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const FIX = path.join(ROOT, 'server', 'agent', 'providers', 'mock-fixtures');
const norm = (s) => String(s).toLocaleLowerCase().replace(/[„“"'.,;:!?()]/g, '').replace(/\s+/g, ' ').trim();

async function catalogValues(lang) {
  const dir = path.join(ROOT, 'public', 'js', 'i18n', lang);
  const out = new Set();
  const add = (v) => {
    if (typeof v === 'string') out.add(norm(v));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) add(x);
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const m = await import(path.join(dir, f));
    add(m.default ?? m);
  }
  return out;
}

/** The sides of every "A › B" in `text` that are not catalog strings (each side: the longest run of 1-4 words that is). */
function strangePlaces(text, values) {
  const bad = [];
  const parts = String(text).split('›');
  for (let i = 0; i < parts.length - 1; i++) {
    const left = parts[i].replace(/^[\s\S]*[,:;(]/, '').trim().split(/\s+/);
    const right = parts[i + 1].trim().replace(/[.,;:!?)][\s\S]*$/, '').split(/\s+/);
    const okL = [1, 2, 3, 4].some((n) => values.has(norm(left.slice(-n).join(' '))));
    const okR = [1, 2, 3, 4].some((n) => values.has(norm(right.slice(0, n).join(' '))));
    if (!okL) bad.push(`"${left.slice(-3).join(' ')}" ›`);
    if (!okR) bad.push(`› "${right.slice(0, 3).join(' ')}"`);
  }
  return bad;
}

test('H-11: every place a fixture names exists in the catalogs of its language; no "Тефтер" for the Farm book', async () => {
  const values = { en: await catalogValues('en'), bg: await catalogValues('bg') };
  assert.ok(values.bg.has(norm('Книжката на фермата')) && values.en.has(norm('Farm book')));
  const bad = [];
  let paths = 0;
  for (const f of fs.readdirSync(FIX).filter((x) => x.endsWith('.json'))) {
    const fx = JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
    for (const lang of ['en', 'bg']) {
      const text = fx.summary?.[lang];
      if (typeof text !== 'string') continue;
      paths += (text.match(/›/g) ?? []).length;
      for (const b of strangePlaces(text, values[lang])) bad.push(`${f} ${lang}: ${b}`);
      if (lang === 'bg' && /Тефтер/.test(text)) bad.push(`${f} bg: "Тефтер…" is the Ledger, not the Farm book`);
      if (lang === 'bg' && /книжка/i.test(text) && !/Книжката на фермата/.test(text)) bad.push(`${f} bg: the Farm book is "Книжката на фермата"`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(paths >= 2, 'the pets and the look answers name their path');
});

test('H-11: docs/game-features.md gives the agent the Bulgarian names of the places it points to', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'game-features.md'), 'utf8');
  for (const bg of ['Книжката на фермата › Животни › Любимци', 'Книжката на фермата › Ти › Твоят вид', 'Пазар', 'Кочина', 'Настройки › Вид и звук']) {
    assert.ok(doc.includes(bg), bg);
  }
  assert.doesNotMatch(doc, /Тефтер/);
});
