// Release 1.0, M26 (critique#2; plan-astra 1.6): the owners' save with a journal of player actions recorded on the
// HEAD tree (fdafb9c) boots on this build: no BootRefused, every line replays, validateState is empty, and nothing is
// lost against the state HEAD itself replays to (coins, Acorns, land, objects, animals, quests done, stats, goods).
// The fixture is made by `.scratch/rb-features/record-journal.mjs` (a COPY of .scratch/box-save-1013 plus 1,663 player
// lines of 30 kinds: plant, harvest, feed, collect, craft, sell, orders, keepsake, help flag, sit, thanks, notes …,
// the server stopped before any snapshot) and lives in the lane's scratch, never in git (it is the owners' farm): the
// test says so and skips where the fixture is absent (a fresh clone). The integrator runs it on this machine.
// RED on fdafb9c's behaviour: a 1.0 rule change that refused one of these lines would stop the boot (BootRefused).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Persist } from '../server/persist.js';
import { loadFarm } from '../server/app.js';
import { validateState } from '../shared/rules/state.js';
import { CONTENT } from '../shared/content/index.js';
import { ROOT } from './helpers.js';

const FIXTURE = path.join(ROOT, '.scratch/rb-features/replay-fixture');
const quiet = { info() {}, warn() {}, error() {}, log() {} };
const have = fs.existsSync(path.join(FIXTURE, 'expected-head.json'));

/** What "nothing lost" compares: 1.0's state against HEAD's, as a list of problems (empty = nothing lost). */
export function lostAgainst(head, now) {
  const out = [];
  const f0 = head.farm;
  const f1 = now.farm;
  if (f1.wallet.coins < f0.wallet.coins) out.push(`coins ${f1.wallet.coins} < ${f0.wallet.coins}`);
  if (f1.wallet.acorns < f0.wallet.acorns) out.push(`acorns ${f1.wallet.acorns} < ${f0.wallet.acorns}`);
  if (f1.xp < f0.xp) out.push(`farm xp ${f1.xp} < ${f0.xp}`);
  for (const e of f0.expansions) if (!f1.expansions.includes(e)) out.push(`land ${e} lost`);
  for (const [id, o] of Object.entries(f0.objects)) {
    if (!Object.hasOwn(f1.objects, id)) out.push(`object ${id} (${o.def}) lost`);
    else if (f1.objects[id].def !== o.def) out.push(`object ${id}: ${o.def} -> ${f1.objects[id].def}`);
  }
  for (const id of Object.keys(f1.objects)) {
    if (!Object.hasOwn(f0.objects, id) && f1.objects[id].def !== 'gift_box') out.push(`object ${id} (${f1.objects[id].def}) appeared`);
  }
  for (const q of Object.keys(f0.quests.done)) if (!Object.hasOwn(f1.quests.done, q)) out.push(`quest ${q} no longer done`);
  for (const [k, v] of Object.entries(f0.stats)) if ((f1.stats[k] ?? 0) < v) out.push(`stat ${k} ${f1.stats[k] ?? 0} < ${v}`);
  // goods: in the Barn, or (1.0) wrapped in a box on the porch waiting for the partner
  const wrapped = {};
  for (const g of Object.values(f1.gifts ?? {})) wrapped[g.item] = (wrapped[g.item] ?? 0) + 1;
  const shelfOf = (s, pid) => Object.values(s.players[pid]?.shelf?.rows ?? {}).map((r) => r.item);
  for (const [item, n] of Object.entries(f0.inventory)) {
    if ((f1.inventory[item] ?? 0) < n) out.push(`goods ${item} ${f1.inventory[item] ?? 0} < ${n}`);
  }
  for (const pid of Object.keys(head.players)) {
    const p0 = head.players[pid];
    const p1 = now.players[pid];
    if (!p1) { out.push(`player ${pid} lost`); continue; }
    if (p1.xp < p0.xp) out.push(`${pid} xp ${p1.xp} < ${p0.xp}`);
    for (const [k, v] of Object.entries(p0.stats ?? {})) if ((p1.stats?.[k] ?? 0) < v) out.push(`${pid} stat ${k} ${p1.stats?.[k] ?? 0} < ${v}`);
    // a keepsake HEAD put on the shelf waits wrapped on the porch in 1.0 (it reaches the shelf when opened)
    const pool = [...shelfOf(now, pid)];
    for (const [id, g] of Object.entries(f1.gifts ?? {})) if (g.to === pid) pool.push(g.item) && void id;
    for (const item of shelfOf(head, pid)) {
      const i = pool.indexOf(item);
      if (i < 0) out.push(`${pid}'s keepsake ${item} lost`); else pool.splice(i, 1);
    }
    void wrapped;
  }
  return out;
}

test('M26: the owners\' save plus 1,663 player lines recorded on HEAD boots on 1.0, every line replays, nothing lost', { skip: !have && `no fixture at ${path.relative(ROOT, FIXTURE)} (run .scratch/rb-features/record-journal.mjs)` }, () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rf-replay-'));
  try {
    for (const f of ['farm.json', 'farm.journal.jsonl', 'farm.journal.archive.jsonl']) {
      if (fs.existsSync(path.join(FIXTURE, f))) fs.copyFileSync(path.join(FIXTURE, f), path.join(tmp, f));
    }
    const lines = fs.readFileSync(path.join(tmp, 'farm.journal.jsonl'), 'utf8').trim().split('\n').length;
    const persist = new Persist(tmp, { log: quiet });
    const { state, replayed } = loadFarm(persist, { tz: 'Europe/Sofia', log: quiet });       // throws BootRefused if a line fails
    assert.ok(replayed >= lines, `replayed ${replayed} of ${lines} lines`);
    assert.ok(lines - 1 >= 200, 'at least 200 player actions');
    assert.deepEqual(validateState(state), [], 'validateState empty');
    assert.equal(state.meta.degraded ?? false, false);
    const head = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected-head.json'), 'utf8')).state;
    assert.deepEqual(lostAgainst(head, state), [], 'nothing lost against HEAD\'s own replay');
    persist.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const SAVE = path.join(ROOT, '.scratch/box-save-1013');
const haveSave = fs.existsSync(path.join(SAVE, 'farm.json'));
const noSave = !haveSave && `no owners' save at ${path.relative(ROOT, SAVE)}`;

/** Boot a COPY of the owners' save on this build (the original is never touched). */
function bootSave() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rf-save-'));
  for (const f of ['farm.json', 'farm.journal.jsonl', 'farm.journal.archive.jsonl']) {
    if (fs.existsSync(path.join(SAVE, f))) fs.copyFileSync(path.join(SAVE, f), path.join(tmp, f));
  }
  const persist = new Persist(tmp, { log: quiet });
  const farm = loadFarm(persist, { tz: 'Europe/Sofia', log: quiet });
  return { ...farm, persist, done: () => { persist.close(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}

test('the owners\' save boots on 1.0: validateState empty, farm.gifts backfilled, a save from before 1.0 (no coop.born)', { skip: noSave }, () => {
  const b = bootSave();
  try {
    assert.deepEqual(validateState(b.state), []);
    assert.deepEqual(b.state.farm.gifts, {});
    assert.equal(b.state.farm.coop.born, undefined, 'its farmers get "New in 1.0"');
  } finally { b.done(); }
});

test('D5 on the owners\' save (L21): the Ribbon Track opens this season at need 16,000 on the next XP', { skip: noSave }, async () => {
  const { dueSystemActions } = await import('../shared/rules/system.js');
  const b = bootSave();
  try {
    const now = b.clock.now();
    const due = dueSystemActions(b.state, now).map((d) => d.type);
    assert.ok(due.includes('_track'), `due: ${due.join(', ')}`);
    b.engine.runDue();
    assert.match(b.state.farm.track.s, /^\d{4}-autumn$/);
    assert.equal(b.state.farm.track.need, 16_000);
  } finally { b.done(); }
});

test('D2 on the owners\' save: "Helping Hands" (h3, stuck since 5 Oct) completes in a scripted session that never overlaps', { skip: noSave }, () => {
  const b = bootSave();
  try {
    const s = b.state;
    assert.ok(s.farm.quests.active.h3, 'h3 is the active Together card');
    const coins0 = s.farm.wallet.coins;
    let T = b.clock.now();
    b.engine.clock = { now: () => T, observe() {} };
    b.engine.client('rfsav1', 'p1', T);
    b.engine.client('rfsav2', 'p2', T);
    const seq = { p1: 0, p2: 0 };
    const cid = { p1: 'rfsav1', p2: 'rfsav2' };
    const act = (pid, type, args) => b.engine.act({ pid, cid: cid[pid] }, { seq: ++seq[pid], type, args });
    const item = ['rose', 'lavender', 'sunflower', 'strawberry', 'wheat'].find((i) => (s.farm.inventory[i] ?? 0) > 4);
    // three days: one farmer wraps in the morning, the other opens it in the afternoon
    for (const [giver, opener] of [['p1', 'p2'], ['p2', 'p1'], ['p1', 'p2']]) {
      assert.equal(act(giver, 'keepsake', { item }), null, `${giver} wraps`);
      const id = Object.keys(s.farm.gifts).find((k) => s.farm.gifts[k].by === giver);
      T += 5 * 3_600_000;
      assert.equal(act(opener, 'openGift', { id }), null, `${opener} opens`);
      T += 19 * 3_600_000;
    }
    assert.ok(Object.hasOwn(s.farm.quests.done, 'h3'), 'h3 done');
    const q = CONTENT.quests.get('h3');
    assert.ok(s.farm.wallet.coins - coins0 >= q.coins, `the quest's own reward (${q.coins} coins) is paid, unchanged`);
    assert.deepEqual(validateState(s), []);
  } finally { b.done(); }
});

const LATE = path.join(ROOT, '.scratch/box-save-1013-late');
test('tonight\'s newer copy of the owners\' save boots on 1.0 too: validateState empty, nothing refused', { skip: !fs.existsSync(path.join(LATE, 'farm.json')) && 'no late save' }, () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rf-late-'));
  try {
    for (const f of ['farm.json', 'farm.journal.jsonl', 'farm.journal.archive.jsonl']) {
      if (fs.existsSync(path.join(LATE, f))) fs.copyFileSync(path.join(LATE, f), path.join(tmp, f));
    }
    const persist = new Persist(tmp, { log: quiet });
    const { state, engine } = loadFarm(persist, { tz: 'Europe/Sofia', log: quiet });
    engine.runDue();
    assert.deepEqual(validateState(state), []);
    persist.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
