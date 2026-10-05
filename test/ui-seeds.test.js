// The easy seeds (live requests 2026-10-04): the seed picker's rows and where its card goes (public/js/ui/seeds.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm } from './helpers.js';
import { xpForLevel, live } from '../shared/content/index.js';
import { pickerRows, popPlacement } from '../public/js/ui/seeds.js';

test('the seed picker lists every seed this level plants, then at most two locked ones with their level', () => {
  const s = makeFarm();
  s.farm.xp = xpForLevel(5);
  const rows = pickerRows(s);
  const open = live('crops').filter((c) => c.unlock <= 5).map((c) => c.id);
  assert.deepEqual(rows.filter((r) => r.open).map((r) => r.id), open);
  const locked = rows.filter((r) => !r.open);
  assert.ok(locked.length <= 2 && locked.length >= 1);
  assert.ok(rows.findIndex((r) => !r.open) === open.length, 'locked ones come last');
  for (const r of rows) assert.ok(Number.isFinite(r.seed) && Number.isFinite(r.growMs), `${r.id} shows its price and grow time`);
});

test('the picker card sits above its plot with the tail on it, flips below near the top, stays on screen', () => {
  const view = { w: 1366, h: 768 };
  const size = { w: 452, h: 220 };
  const mid = popPlacement({ x: 683, y: 500 }, size, view);
  assert.equal(mid.below, false);
  assert.equal(mid.top, 500 - 18 - 220);
  assert.equal(mid.left, 683 - 226);
  assert.equal(mid.tail, 226, 'the tail points at the plot');
  const top = popPlacement({ x: 683, y: 150 }, size, view);
  assert.equal(top.below, true, 'no room above: below the plot');
  assert.equal(top.top, 150 + 18);
  const edge = popPlacement({ x: 20, y: 500 }, size, view);
  assert.equal(edge.left, 12, 'clamped inside the screen');
  assert.ok(edge.tail >= 18 && edge.tail <= 30, 'the tail still points at the plot');
  const right = popPlacement({ x: 1360, y: 500 }, size, view);
  assert.equal(right.left, 1366 - 12 - 452);
});

test('on a phone on its side the picker stands beside its plot, never on it (astra P1-2)', () => {
  const view = { w: 844, h: 390 };
  const size = { w: 330, h: 230 };
  const pt = { x: 446, y: 229 };
  const pos = popPlacement(pt, size, view);
  assert.equal(pos.side, 'right');
  assert.equal(pos.left, 446 + 18);
  assert.ok(pos.top >= 12 && pos.top + size.h <= 390 - 12, 'inside the screen');
  assert.equal(pos.tail, pt.y - pos.top, 'the tail points at the plot along the card edge');
  const covered = pt.x >= pos.left && pt.x <= pos.left + size.w && pt.y >= pos.top && pt.y <= pos.top + size.h;
  assert.equal(covered, false, 'the plot stays in view');
  const nearRight = popPlacement({ x: 700, y: 229 }, size, view);
  assert.equal(nearRight.side, 'left');
  assert.equal(nearRight.left, 700 - 18 - 330);
  // a desktop window keeps the card above its plot
  assert.equal(popPlacement({ x: 683, y: 500 }, { w: 452, h: 220 }, { w: 1366, h: 768 }).side, null);
});

test('a baby chicken is a yellow chick: its own icon on the Coop card and its own, readable size in the coop', async () => {
  const fs = await import('node:fs');
  const { babyIcon } = await import('../public/js/ui/panels/animals.js');
  const { babyScale } = await import('../public/js/render/animals-view.js');
  assert.equal(babyIcon('chicken'), 'chick');
  assert.equal(babyIcon('cow'), 'cow', 'other babies keep their species icon');
  const man = JSON.parse(fs.readFileSync(new URL('../public/assets/icons/manifest.json', import.meta.url), 'utf8'));
  assert.ok(man.ids.chick, 'the chick icon is in the icon manifest');
  for (const f of ['chick.png', '64/chick.png']) assert.ok(fs.existsSync(new URL(`../public/assets/icons/${f}`, import.meta.url)), f);
  assert.ok(babyScale('chicken') > 0.6, 'the chick model is chick-sized already: not shrunk to a speck');
  assert.equal(babyScale('cow'), 0.6);
});
