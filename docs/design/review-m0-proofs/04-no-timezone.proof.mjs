// PROOF (RED on M0): the frozen contracts carry no farm time zone, so a "day" (period counters, daily gift,
// Almanac, thanks cap, Market Demand, streak) or a "season" (GDD §3.1 rule 7, fixed at planting) cannot be
// computed identically by the client (browser zone), the server (HH_TZ) and journal replay.
// Run: node --test docs/design/review-m0-proofs/04-no-timezone.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCtx } from '../../../shared/rules/index.js';
import { dueSystemActions, nextSystemDueAt } from '../../../shared/rules/system.js';
import { createFarm } from '../../../shared/rules/state.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** What a rules author would write: the local calendar day of `now` in zone `tz`. */
function dayIndex(now, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric',
    day: 'numeric' }).formatToParts(now).map((x) => [x.type, x.value]));
  return Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 86_400_000);
}

test('the same server instant is the same farm day for client, server and replay', () => {
  const now = Date.UTC(2026, 9, 2, 22, 30);   // 01:30 in Sofia (next day), 22:30 UTC, 18:30 New York
  const days = { server_Sofia: dayIndex(now, 'Europe/Sofia'), client_UTC: dayIndex(now, 'UTC'),
    client_NY: dayIndex(now, 'America/New_York') };
  console.log('dayIndex of one instant:', days);
  assert.equal(new Set(Object.values(days)).size, 1, 'the "day" depends on whose zone computes it');
});

test('a rule can learn the farm time zone from ctx, state or the system-action signature', () => {
  const s = createFarm(1, 0);
  const ctx = makeCtx(s, { now: 0, pid: 'p1', cid: 'abcdef', seq: 1 });
  const src = fs.readdirSync(path.join(ROOT, 'shared'), { recursive: true }).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'shared', f), 'utf8')).join('\n');
  const found = {
    ctxKeys: Object.keys(ctx),
    metaKeys: Object.keys(s.meta),
    dueSystemActionsArity: dueSystemActions.length,
    nextSystemDueAtArity: nextSystemDueAt.length,
    sharedMentionsTimeZone: /timeZone|HH_TZ|meta\.tz|ctx\.tz/.test(src),   // (grid.js uses 'tz' for a tile z)
  };
  console.log(found);
  assert.ok('tz' in ctx || 'tz' in s.meta || found.sharedMentionsTimeZone, 'no farm time zone anywhere in shared/');
});
