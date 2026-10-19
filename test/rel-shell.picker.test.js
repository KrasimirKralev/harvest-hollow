// Release 1.0, ui-shell: the seed picker. M12a (ux-phone#2): its rows put the crop planted last first, then the crops an
// open order asks for, then the newest unlocks down (the 2-coin Wheat no longer leads at level 21). D3 (features#F3,
// critique#35): each row says when the crop would be ready on the farm's clock, instead of how long it grows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm } from './helpers.js';
import { xpForLevel, cropOf } from '../shared/content/index.js';

const SEEDS = await import('../public/js/ui/seeds.js');

test('M12a: picker rows: last used, then wanted by an order, then level descending; locked ones last', () => {
  const s = makeFarm();
  s.farm.xp = xpForLevel(12);
  s.farm.orders = { n: 1, slots: { 0: { availableAt: 0, order: { n: 1, items: { carrot: 4 }, coins: 10, xp: 1 } } } };
  const rows = SEEDS.pickerRows(s, 'corn');
  const open = rows.filter((r) => r.open);
  assert.equal(open[0].id, 'corn', 'the crop planted last leads');
  assert.equal(open[1].id, 'carrot', 'then what an open order asks for');
  const rest = open.slice(2).map((r) => r.unlock);
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a), 'then the newest unlocks first');
  assert.ok(open.at(-1).unlock <= open[2].unlock);
  assert.ok(rows.slice(open.length).every((r) => !r.open), 'locked previews after every open crop');
});

test('D3: a seed row says when it is ready on the farm clock: today, tomorrow (EN and the farm zone)', () => {
  assert.equal(typeof SEEDS.readyText, 'function');
  const tz = 'Europe/Sofia';
  const at2040 = Date.UTC(2026, 9, 14, 17, 40);                 // 20:40 in Sofia (UTC+3 on 14 Oct)
  assert.equal(SEEDS.readyText(at2040, 60 * 60_000, tz), 'ready 21:40');
  assert.equal(SEEDS.readyText(at2040, 12 * 60 * 60_000, tz), 'ready tomorrow 08:40');
  assert.equal(SEEDS.readyText(at2040, cropOf('wheat').growMs, tz), 'ready 20:41');
});
