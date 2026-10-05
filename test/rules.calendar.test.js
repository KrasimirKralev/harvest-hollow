// The farm calendar (review-m0 #3): one farm zone in the state, so client, server and replay agree on "day".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dayIndex, weekIndex, seasonOf, isTimeZone } from '../shared/rules/calendar.js';
import { createFarm, validateState, SCHEMA, DEFAULT_TZ } from '../shared/rules/state.js';
import { migrate, backfill } from '../server/migrations.js';
import { loadConfig } from '../server/config.js';
import { ROOT, makeFarm } from './helpers.js';

test('the farm day of an instant depends only on the farm zone, not on who computes it', () => {
  const now = Date.UTC(2026, 9, 2, 22, 30);           // 01:30 on Oct 3 in Sofia, 22:30 Oct 2 UTC
  const s = createFarm(1, now, 'Europe/Sofia');
  assert.equal(s.meta.tz, 'Europe/Sofia');
  assert.equal(dayIndex(now, s.meta.tz), Math.floor(Date.UTC(2026, 9, 3) / 86_400_000));
  assert.equal(dayIndex(now, 'UTC'), Math.floor(Date.UTC(2026, 9, 2) / 86_400_000), 'a different zone is a different day');
  assert.equal(seasonOf(now, s.meta.tz), 'autumn');
  assert.equal(seasonOf(Date.UTC(2026, 11, 31, 23, 30), 'Europe/Sofia'), 'winter');
  assert.equal(seasonOf(Date.UTC(2026, 2, 1, 0, 0), 'Europe/Sofia'), 'spring');
  // DST: the day still flips at local midnight
  assert.equal(dayIndex(Date.UTC(2026, 2, 28, 21, 59), 'Europe/Sofia') + 1, dayIndex(Date.UTC(2026, 2, 28, 22, 1), 'Europe/Sofia'));
});

test('weeks start on Monday', () => {
  const mon = Math.floor(Date.UTC(2026, 8, 28) / 86_400_000);   // Monday 2026-09-28
  assert.equal(weekIndex(mon), weekIndex(mon + 6));
  assert.equal(weekIndex(mon) + 1, weekIndex(mon + 7));
  assert.equal(weekIndex(mon - 1) + 1, weekIndex(mon));
});

test('the zone is state: validated, defaulted, migrated, configured', () => {
  assert.equal(createFarm(1, 0).meta.tz, DEFAULT_TZ);
  assert.ok(isTimeZone('America/New_York'));
  assert.ok(!isTimeZone('Mars/Olympus') && !isTimeZone('') && !isTimeZone(undefined));
  const s = makeFarm();
  s.meta.tz = 'Mars/Olympus';
  assert.ok(validateState(s).some((p) => p.startsWith('meta.tz')));
  assert.throws(() => loadConfig({ HH_TZ: 'Mars/Olympus' }), /IANA/);
  assert.equal(loadConfig({ HH_TZ: 'Asia/Tokyo' }).tz, 'Asia/Tokyo');
  const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/save-v1.json'), 'utf8'));
  const m = migrate(v1);
  assert.equal(m.schema, SCHEMA);
  assert.equal(m.meta.tz, DEFAULT_TZ);
  assert.deepEqual(m.farm.rolls, {});
  m.meta.contentHash = makeFarm().meta.contentHash;
  backfill(m, { now: m.meta.createdAt });                // additive wave-1 fields come from a fresh farm (server)
  assert.deepEqual(validateState(m), [], 'a migrated v1 save is a valid current state');
});
