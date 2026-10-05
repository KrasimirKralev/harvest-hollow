// "An action applies in < 1 ms on a late-game state" (rules-economy brief). A full M1a farm at L12: every M1a
// expansion, the plot cap reached and planted, trees to their caps, homes full of animals, every building with a
// full queue, decor. Median and 90th-percentile wall time of runAction (rules + goals credit) per action type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAction, makeCtx } from '../shared/rules/index.js';
import { live, liveAt, plotCapOf, treeCapAt } from '../shared/content/index.js';
import { capacityOf } from '../shared/rules/grid.js';
import { buyPrice } from '../shared/rules/actions/decor.js';
import { T0, farmAt, give, placeDef, idsOf, allLand, HOUR, must } from './helpers/rules.js';

function lateGame() {
  const s = farmAt(12, { coins: 50_000_000, acorns: 500 });
  allLand(s);
  const big = { confirm: ['BIG_SPEND'] };
  for (const def of ['coop', 'feed_mill']) placeDef(s, def);
  for (const b of live('buildings')) if (buyPrice(s, b.id).code === null) placeDef(s, b.id, big);
  for (const h of live('homes')) if (buyPrice(s, h.id).code === null) placeDef(s, h.id, big);
  for (const t of liveAt('trees', 12)) for (let i = 0; i < treeCapAt(t, 12); i++) placeDef(s, t.id, big);
  while (idsOf(s, 'plot').length < plotCapOf(12, s.farm.expansions.length - 1)) placeDef(s, 'plot', big);
  for (let i = 0; i < 30; i++) placeDef(s, 'flower_bed', big);
  for (const home of [...idsOf(s, 'coop'), ...idsOf(s, 'cow_barn'), ...idsOf(s, 'pasture')]) {
    const species = live('animals').find((a) => a.homes.includes(s.farm.objects[home].def)).id;
    for (let i = 0; i < capacityOf(s, home); i++) must(s, 'buyAnimal', { def: species, adult: true, home, ...big });
  }
  for (const item of ['wheat', 'corn', 'egg', 'milk', 'flour', 'sugar', 'butter', 'strawberry', 'cream', 'carrot']) give(s, item, 15);
  s.farm.inventory.chicken_feed = 30;
  s.farm.inventory.livestock_feed = 30;
  const plots = idsOf(s, 'plot');
  must(s, 'plant', { ids: plots.slice(0, 60), crop: 'wheat' }, { now: T0 });
  return s;
}

test('every common action applies in well under 1 ms on a late-game farm', () => {
  const s = lateGame();
  assert.ok(Object.keys(s.farm.objects).length > 200, `${Object.keys(s.farm.objects).length} objects`);
  const plots = idsOf(s, 'plot');
  const hens = Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'chicken');
  const bakery = idsOf(s, 'bakery')[0];
  const now = T0 + 2 * HOUR;
  const cases = [
    ['harvest', (i) => ({ id: plots[i % 60] })],
    ['plant', (i) => ({ id: plots[i % 60], crop: 'wheat' })],
    ['tend', (i) => ({ id: hens[i % hens.length] })],
    ['sell', () => ({ item: 'egg', qty: 1 })],
    ['craft', () => ({ id: bakery, recipe: 'bread' })],
    ['place', (i) => ({ def: 'flower_bed', x: 8 + (i % 40), z: 8 + Math.floor(i / 40), rot: 0 })],
  ];
  const report = {};
  let seq = 0;
  for (const [type, args] of cases) {
    const times = [];
    for (let i = 0; i < 60; i++) {
      const ctx = makeCtx(s, { now: now + i, pid: i % 2 ? 'p1' : 'p2', cid: 'perf01', seq: ++seq, grace: 250 });
      const t0 = performance.now();
      runAction(s, { type, args: args(i) }, ctx);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    report[type] = { median: +times[30].toFixed(3), p90: +times[54].toFixed(3) };
  }
  console.log(`late-game action times (ms, ${Object.keys(s.farm.objects).length} objects): ${JSON.stringify(report)}`);
  for (const [type, r] of Object.entries(report)) assert.ok(r.median < 1, `${type}: median ${r.median} ms (${JSON.stringify(report)})`);
});
