// Server-observed facts in ctx.ext (lane brief item 5, GDD Appendix F, tech §15.5): who is online, avatar
// distances, the partner's recent actions near this one, together minutes. Journaled, replayed as journaled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Together, positionsOf, WINDOW_MS, nearTo } from '../server/together.js';
import { START } from '../shared/content/config.js';
import { makeFarm, T0 } from './helpers.js';
import { testServer, join, readJournal, sleep, plain } from './helpers/server.js';

const objId = (s) => Object.keys(s.farm.objects).find((id) => s.farm.objects[id].def === 'plot');

test('positionsOf reads target tiles from id, ids, x/z and tiles, before the action applies; never throws', () => {
  const s = makeFarm();
  const id = objId(s);
  const o = s.farm.objects[id];
  assert.deepEqual(positionsOf(s, { id }), [[o.x, o.z]]);
  assert.deepEqual(positionsOf(s, { ids: [id, 'nope', 3] }), [[o.x, o.z]]);
  assert.deepEqual(positionsOf(s, { def: 'plot', x: 30, z: 31, rot: 0 }), [[30, 31]]);
  assert.deepEqual(positionsOf(s, { tiles: [[1, 2], 'x', [3]] }), [[1, 2]]);
  // an animal (layer 'none') is where its home is
  s.farm.objects['a.1.0'] = { def: 'chicken', home: id, placedAt: T0, by: 'p1' };
  assert.deepEqual(positionsOf(s, { id: 'a.1.0' }), [[o.x, o.z]]);
  for (const bad of [null, undefined, 5, 'x', { id: '__proto__' }, { x: 1.5, z: 2 }, { ids: 'nope' }]) assert.deepEqual(positionsOf(s, bad), []);
});

test('Together: online, avatar distances in tenths, partner actions by type within the window', () => {
  let online = ['p2', 'p1'];
  const poses = new Map([['p1', { x: 10, z: 10 }], ['p2', { x: 13, z: 14 }]]);
  const t = new Together({ online: () => online, poses: () => poses });
  const s = makeFarm();
  const ids = Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot');
  const [a, b] = ids.map((id) => s.farm.objects[id]);
  // p2 acted on plot b, then on a far tile
  const f2 = t.player('p2', { type: 'harvest', args: { id: ids[1] } }, s, T0);
  t.committed('p2', { type: 'harvest', args: { id: ids[1] } }, f2, T0);
  const far = t.player('p2', { type: 'harvest', args: { x: 60, z: 60 } }, s, T0 + 100);
  t.committed('p2', { type: 'harvest', args: { x: 60, z: 60 } }, far, T0 + 100);
  const f1 = t.player('p1', { type: 'harvest', args: { id: ids[0] } }, s, T0 + 2000);
  const d2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  assert.deepEqual(plain(f1.ext), { online: ['p1', 'p2'], avatar: { p2: 50 }, near: nearTo(s, { id: ids[0] }, poses.get('p1')),
    recent: { p2: { harvest: d2 } } },
    'the NEAREST of the partner\'s actions in the window counts, not just the latest');
  assert.ok(Object.isFrozen(f1.ext) && Object.isFrozen(f1.ext.recent.p2), 'deep-frozen (journaled input)');
  const late = t.player('p1', { type: 'harvest', args: { id: ids[0] } }, s, T0 + 100 + WINDOW_MS + 1);
  assert.equal(late.ext.recent, undefined, 'outside the window');
  const own = t.player('p2', { type: 'harvest', args: { id: ids[0] } }, s, T0 + 200);
  assert.equal(own.ext.recent, undefined, 'never your own actions (two tabs of one player are one pid)');
  const noPos = t.player('p1', { type: 'sell', args: { item: 'wheat', qty: 1 } }, s, T0 + 300);
  assert.equal(noPos.ext.recent, undefined, 'an action without a position pairs with nothing');
  online = ['p1'];
  poses.delete('p2');
  assert.deepEqual(plain(t.player('p1', { type: 'sell', args: {} }, s, T0 + 400).ext), { online: ['p1'] });
});

test('together minutes: counted only while two players are online, handed out once, kept on a reject', () => {
  const t = new Together();
  t.setOnline(['p1'], T0);
  t.setOnline(['p1', 'p2'], T0 + 1000);
  t.setOnline(['p1', 'p2', 'p2'], T0 + 2000);
  const s = makeFarm();
  const x = t.player('p1', { type: 'sell', args: {} }, s, T0 + 1000 + 150_000);
  assert.equal(x.ext.togetherMin, 2);
  // the action was rejected: nothing committed, the minutes stay
  assert.equal(t.player('p1', { type: 'sell', args: {} }, s, T0 + 1000 + 150_000).ext.togetherMin, 2);
  t.committed('p1', { type: 'sell', args: {} }, x, T0 + 1000 + 150_000);
  const y = t.player('p2', { type: 'sell', args: {} }, s, T0 + 1000 + 150_000);
  assert.equal(y.ext.togetherMin, undefined, 'each minute once');
  t.setOnline(['p2'], T0 + 1000 + 190_000);               // 30 s left over + 40 s more, then p1 leaves
  t.setOnline(['p1', 'p2'], T0 + 10_000_000);              // hours apart: not together
  const z = t.player('p2', { type: 'sell', args: {} }, s, T0 + 10_000_000 + 20_000);
  assert.equal(z.ext.togetherMin, 1, '30 s + 40 s + 20 s = 90 s: one whole minute, 30 s kept');
});

test('server: the journal line carries the ext the rule saw, and replay reproduces the state', async () => {
  const s1 = await testServer({ keep: true });
  const { dataDir } = s1;
  try {
    const a = await join(s1.port, 'p1', 'Rowan');
    const b = await join(s1.port, 'p2', 'Mia');
    b.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.1', crop: 'wheat' } });
    await a.c.next((m) => m.t === 'd' && m.by === 'p2');
    a.c.send({ t: 'act', seq: 1, type: 'plant', args: { id: 'home.0.0', crop: 'wheat' } });
    await a.c.next((m) => m.t === 'd' && m.by === 'p1' && m.seq === 1);
    const lines = readJournal(dataDir);
    const mine = lines.find((l) => l.pid === 'p1' && l.type === 'plant');
    const o0 = s1.hh.engine.state.farm.objects['home.0.0'];
    const o1 = s1.hh.engine.state.farm.objects['home.0.1'];
    const spawn = START.spawn;
    assert.deepEqual(mine.ext.online, ['p1', 'p2']);
    assert.equal(mine.ext.recent.p2.plant, (o0.x - o1.x) ** 2 + (o0.z - o1.z) ** 2);
    assert.equal(mine.ext.avatar.p2, Math.round(Math.hypot(spawn.p2.x - spawn.p1.x, spawn.p2.z - spawn.p1.z) * 10));
    const seen = lines.find((l) => l.type === '_join' && l.args.pid === 'p2');
    assert.ok(seen, 'joins are journaled');
    const before = plain(s1.hh.engine.state);
    a.c.close();
    b.c.close();
    await sleep(30);
    const after = plain(s1.hh.engine.state);
    await s1.close();
    const s2 = await testServer({ dataDir });
    try {
      assert.deepEqual(plain(s2.hh.engine.state).farm, after.farm, 'replayed exactly');
      assert.equal(before.farm.objects['home.0.0'].crop.def, 'wheat');
    } finally {
      await s2.close();
    }
  } finally {
    await s1.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
