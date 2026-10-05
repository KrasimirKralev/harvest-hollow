// Backups, the journal archive, recovery without farm.json, migrations and backfill (lane brief item 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Persist, backupsToKeep } from '../server/persist.js';
import { loadFarm, BootRefused } from '../server/index.js';
import { migrate, migrations, backfill, CURRENT } from '../server/migrations.js';
import { createFarm, createPlayer, validateState, SCHEMA } from '../shared/rules/state.js';
import { ROOT, tmpDataDir, plain, quiet, recorder, T0 } from './helpers/server.js';

/** Boot an in-process farm on `dir` with the journal on (no network). */
export function boot(dir, o = {}) {
  const persist = new Persist(dir, { log: quiet });
  const r = loadFarm(persist, { log: quiet, tz: 'Europe/Sofia', ...o });
  r.engine.journal = persist;
  persist.openJournal();
  const save = () => persist.snapshot(() => ({ state: r.engine.state, server: r.engine.server, version: r.engine.v }));
  return { persist, ...r, save };
}

/** Join p1 and plant n empty plots; returns the plot ids used. */
function play(f, n, { cid = 'cidaaa' } = {}) {
  if (!Object.hasOwn(f.engine.state.players, 'p1')) {
    assert.ok(f.engine.system('_join', { pid: 'p1', name: 'Rowan' }, {}, { auth: { p1: { tokenHash: 'x'.repeat(64) } } }).ok);
  }
  f.engine.client(cid, 'p1', f.clock.now());
  const rec = f.engine.server.clients[cid];
  const empty = Object.keys(f.engine.state.farm.objects).filter((id) => {
    const o = f.engine.state.farm.objects[id];
    return o.def === 'plot' && o.crop === null;
  }).sort().slice(0, n);
  for (const id of empty) {
    const r = f.engine.act({ pid: 'p1', cid }, { seq: rec.lastSeq + 1, type: 'plant', args: { id, crop: 'wheat' } });
    assert.equal(r, null, `plant ${id}: ${r && r.code}`);
  }
  return empty;
}

const snapshotOf = (f) => ({ v: f.engine.v, state: plain(f.engine.state), server: plain(f.engine.server) });

test('backupsToKeep: the newest per hour for 24 hours, the newest per day for 14 days', () => {
  const names = [];
  for (let d = 1; d <= 20; d++) {
    for (const h of ['03', '09', '15', '21']) for (const m of ['05', '40']) names.push(`farm-2026-09-${String(d).padStart(2, '0')}T${h}-${m}.json.gz`);
  }
  names.push('farm.pre-migrate-v1.json', 'junk.txt');
  const keep = backupsToKeep(names);
  const kept = [...keep].sort();
  assert.ok(!keep.has('farm.pre-migrate-v1.json') && !keep.has('junk.txt'), 'only rotating backups are considered');
  const hourly = kept.filter((n) => n >= 'farm-2026-09-15');
  assert.equal(hourly.length, 24, '24 hour buckets (6 days x 4) = the newest of each hour');
  assert.ok(hourly.every((n) => n.endsWith('-40.json.gz')), 'the newest within each hour');
  const days = new Set(kept.map((n) => n.slice(5, 15)));
  assert.equal(days.size, 14);
  assert.ok(!keep.has('farm-2026-09-06T21-40.json.gz') && keep.has('farm-2026-09-07T21-40.json.gz'));
  assert.equal(kept.length, 24 + 8, '14 days: 6 overlap the hourly ones');
});

test('a lost or corrupt farm.json recovers EXACTLY from the newest backup + the journal archive + the journal', async () => {
  const dir = tmpDataDir('archive');
  try {
    const f = boot(dir);
    play(f, 2);
    await f.save();                                    // snapshot S1 + backup B1 (first of this process)
    play(f, 2);
    await f.save();                                    // snapshot S2: the cut moves to the archive
    play(f, 2);                                        // live journal only
    const ref = snapshotOf(f);
    f.persist.close();                                 // "crash": no final snapshot
    assert.ok(fs.statSync(path.join(dir, 'farm.journal.archive.jsonl')).size > 0, 'S1..S2 lines archived');
    const lost = `${dir}-lost`;
    fs.cpSync(dir, lost, { recursive: true });
    fs.rmSync(path.join(lost, 'farm.json'));
    fs.writeFileSync(path.join(dir, 'farm.json'), '{"torn":');
    for (const d of [dir, lost]) {
      const g = boot(d);
      assert.equal(g.source, 'backup');
      assert.equal(g.engine.v, ref.v, `${path.basename(d)}: every acknowledged action is back`);
      assert.deepEqual(plain(g.engine.state), ref.state);
      assert.equal(g.engine.server.clients.cidaaa.lastSeq, ref.server.clients.cidaaa.lastSeq);
      g.persist.close();
    }
    fs.rmSync(lost, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a backup empties the archive it covers; the archive never grows past one backup period', async () => {
  const dir = tmpDataDir('archive-trim');
  try {
    const f = boot(dir);
    play(f, 1);
    await f.save();
    play(f, 1);
    await f.save();
    const arch = path.join(dir, 'farm.journal.archive.jsonl');
    assert.ok(fs.statSync(arch).size > 0);
    f.persist.lastBackupAt = 0;                        // an hour later
    play(f, 1);
    await f.save();
    assert.equal(fs.statSync(arch).size, 0);
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.endsWith('.gz')).length >= 1, true);
    f.persist.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('journal lines with no snapshot and no backup refuse the boot; HH_REPLAY_ANYWAY starts a new farm', async () => {
  const dir = tmpDataDir('orphan');
  try {
    const f = boot(dir);
    play(f, 2);
    f.persist.close();
    fs.rmSync(path.join(dir, 'farm.json'), { force: true });
    fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true });
    assert.throws(() => boot(dir), BootRefused);
    const inc = fs.readdirSync(path.join(dir, 'incidents')).filter((n) => n.endsWith('-no-snapshot'));
    assert.equal(inc.length, 1);
    assert.ok(fs.existsSync(path.join(dir, 'incidents', inc[0], 'farm.journal.jsonl')), 'the lines are kept for a human');
    const g = boot(dir, { replayAnyway: true });
    assert.equal(g.engine.v, 0, 'a new farm');
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('journal')).sort(), ['farm.journal.jsonl']);
    assert.equal(fs.statSync(path.join(dir, 'farm.journal.jsonl')).size, 0, 'the orphan lines cannot replay later');
    g.persist.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('after an HH_REPLAY_ANYWAY boot the dropped lines never replay on top of newer actions (regression)', async () => {
  const dir = tmpDataDir('anyway');
  try {
    const f = boot(dir);
    play(f, 1);
    await f.save();
    play(f, 3);
    f.persist.close();
    // A crash mid-snapshot leaves the three lines in an inherited cut file, and the second one no longer replays
    // (its plot is taken in the snapshot).
    const snap = JSON.parse(fs.readFileSync(path.join(dir, 'farm.json'), 'utf8'));
    const live = path.join(dir, 'farm.journal.jsonl');
    const lines = fs.readFileSync(live, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    fs.renameSync(live, path.join(dir, `farm.journal.upto-${snap.version}.jsonl`));
    const target = snap.state.farm.objects[lines[1].args.id];
    target.crop = { def: 'wheat', plantedAt: T0, readyAt: T0 + 1, by: 'p1', cycle: target.cycle };
    fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify(snap));
    assert.throws(() => boot(dir), BootRefused);
    const g = boot(dir, { replayAnyway: true });
    assert.equal(g.engine.v, snap.version + 1, 'stopped after the first line');
    await g.save();
    play(g, 1, { cid: 'cidbbb' });                     // ONE newer action: v = snapshot + 2, where a dropped line was
    const ref = snapshotOf(g);
    g.persist.close();
    const h = boot(dir);                               // a normal boot: no refusal, no stale line replayed after it
    assert.equal(h.engine.v, ref.v);
    assert.deepEqual(plain(h.engine.state), ref.state);
    h.persist.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an older save is copied to backups/farm.pre-migrate-v<N>.json, migrated and valid (fixture save-v1)', () => {
  const dir = tmpDataDir('migrate');
  try {
    const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/save-v1.json'), 'utf8'));
    const raw = { schema: 1, savedAt: T0, version: v1.meta.version, state: v1, server: { clock: { lastNow: 0 }, clients: {}, auth: {} } };
    fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify(raw));
    const f = boot(dir);
    const copy = path.join(dir, 'backups', 'farm.pre-migrate-v1.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(copy, 'utf8')), raw, 'kept exactly as loaded');
    assert.equal(f.engine.state.schema, SCHEMA);
    assert.deepEqual(validateState(f.engine.state, { now: f.clock.now() }), []);
    f.persist.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate: refuses a newer save, tolerates a missing step (additive fields), rejects a save without a schema', () => {
  const s = createFarm(1, T0);
  assert.throws(() => migrate({ ...structuredClone(s), schema: CURRENT + 1 }), /newer than this server/);
  assert.throws(() => migrate({ ...structuredClone(s), schema: 'x' }), /no valid schema/);
  const rec = recorder();
  const saved = migrations[CURRENT - 1];
  migrations[CURRENT - 1] = undefined;               // a lane bumped SCHEMA for additive fields only
  try {
    const m = migrate({ ...structuredClone(s), schema: CURRENT - 1 }, { log: rec.log });
    assert.equal(m.schema, CURRENT);
    assert.match(rec.lines[0][1], new RegExp(`no explicit migration from schema ${CURRENT - 1}`));
  } finally {
    migrations[CURRENT - 1] = saved;
  }
});

test('backfill: adds fields a newer build put in createFarm/createPlayer, never overwrites, never re-adds objects', () => {
  const s = createFarm(7, T0);
  s.players.p1 = { ...createPlayer('Rowan', '#123456', T0), xp: 5, hearts: 2 };
  const fresh = structuredClone(s);
  delete s.farm.rolls;
  delete s.players.p1.hearts;
  s.farm.name = 'Our Hollow';
  const removed = Object.keys(s.farm.objects)[0];
  delete s.farm.objects[removed];
  const filled = backfill(s, { now: T0 + 1000, tz: 'Europe/Sofia' });
  assert.deepEqual(filled.sort(), ['farm.rolls', 'players.p1.hearts']);
  assert.deepEqual(s.farm.rolls, fresh.farm.rolls);
  assert.equal(s.players.p1.hearts, 0, 'a fresh player\'s value');
  assert.equal(s.farm.name, 'Our Hollow', 'existing fields are kept');
  assert.equal(Object.hasOwn(s.farm.objects, removed), false, 'a removed starter plot stays removed');
  assert.deepEqual(backfill(s, { now: T0 + 2000 }), [], 'idempotent');
});

test('backfillStarter: an M0 save gets the starter farm once, never over its own objects, never twice', async () => {
  const { backfillStarter } = await import('../server/migrations.js');
  const { START } = await import('../shared/content/config.js');
  const s = createFarm(7, T0);
  s.players.p1 = createPlayer('Rowan', '#123456', T0);
  // an M0 farm: 8 starter plots, nothing else
  for (const id of Object.keys(s.farm.objects)) {
    if (!/^home\.0\.[0-7]$/.test(id)) delete s.farm.objects[id];
  }
  const added = backfillStarter(s, { now: T0 + 5 });
  assert.ok(added.includes(START.objects.find((o) => o.def === 'farmhouse').id), 'the farmhouse arrives');
  assert.ok(added.some((id) => /^home\.0\./.test(id)), 'missing starter plots arrive up to the cap');
  assert.deepEqual(validateState(s), []);
  const weed = added.find((id) => s.farm.objects[id].def === 'weed');
  if (weed) delete s.farm.objects[weed];               // the couple clears a weed: it never grows back at a boot
  assert.deepEqual(backfillStarter(s, { now: T0 + 6 }), []);
});
