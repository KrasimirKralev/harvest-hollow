// QA r2 I2-02 (br#7), infra's patch to features: a text of Hangul fillers or the braille blank draws nothing, like two
// zero-width spaces, so the rules refuse it as a farm name, a note or a gift note (the HUD's farm line went blank).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmAt, act, MONDAY } from './helpers/rules-goals.js';

test('I2-02: nameFarm refuses a name of Hangul fillers or the braille blank; real names stay', () => {
  const s = farmAt(5, { now: MONDAY });
  for (const name of ['ㅤㅤ', '⠀', 'ᅟᅠ', 'ﾠ', '​​']) {
    assert.equal(act(s, 'nameFarm', { name }).code, 'BAD_ARGS', JSON.stringify(name));
  }
  for (const name of ['Honeybee Acres', 'Пчелна ферма', '한글 농장', '🌻']) assert.equal(act(s, 'nameFarm', { name }).ok, true, name);
});
