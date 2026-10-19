// QA r3 (docs/qa/release/qa-r3/fix-harvey.md), the server half:
//   H3-05 (hv#4) after undoing a paused mod, History's top button read "Bring back Sweet Autumn Fair" and its press was
//         refused DAMAGED: the bring-back target was the pause itself (`undoTarget` stopped at the undo's parent). A pause
//         is looked through for the bring-back target too, and "Bring back" is offered only when that version reads and
//         compiles; otherwise "Undo the last change" goes back to the game's own content (what the pause had), and the
//         undo's push carries what came back ("Caramel Apples is in the shop again") with its Bulgarian number.
//   H3-07 (hv#6) the change list's sell price equals the Market's on a farm with an upgraded Market Stand.
// RED on a328923: see docs/qa/release/qa-r3/fix-harvey.md (each item's RED line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, testServer, writeSave } from './helpers/server.js';
import { ModStore } from '../server/mods/store.js';
import { recipeOf, cloneTables, CONTENT_HASH } from '../shared/content/index.js';
import { RULES_VERSION } from '../shared/rules/version.js';
import { compileMod } from '../shared/mod/compile.js';
import { installOverlay } from '../shared/mod/install.js';
import { changeRows as serverRows } from '../shared/mod/diff.js';
import { unitPrice } from '../shared/rules/economy.js';
import { upgradeBonus } from '../shared/rules/upgrades.js';
import { MOCK_FILES } from '../server/agent/providers/mock.js';
import { changeRows as clientRows } from '../public/js/ui/harness/model.js';

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'rel-harvey', 'owners-mod', 'mods');
const SAVE = path.join(ROOT, '.scratch', 'box-save-1013', 'farm.json');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

const pushesOf = (s) => {
  const pushes = [];
  const broadcast = s.hh.sessions.broadcast.bind(s.hh.sessions);
  s.hh.sessions.broadcast = (msg) => { if (msg && msg.t === 'hx') pushes.push(msg); return broadcast(msg); };
  return pushes;
};

// ---- H3-05 -----------------------------------------------------------------------------------------------------------
test('H3-05: after undoing a paused mod whose file is damaged, History offers no "Bring back"; the undo goes to the game\'s own content', { timeout: 60_000 }, async () => {
  // the repro: the M24 mod, version 2's recipe file torn; the boot pauses it (version 3)
  const { dir, tokens } = writeSave({ level: 21 });
  copyDir(FIXTURE, path.join(dir, 'harness', 'mods'));
  const f = path.join(dir, 'harness', 'mods', 'versions', '2', 'files', 'content', 'recipes', 'x_caramel_apples.json');
  fs.writeFileSync(f, fs.readFileSync(f).subarray(0, 40));
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    assert.equal(mods.active('local').kind, 'suspend', 'the boot paused the damaged mod');
    const pushes = pushesOf(s);
    // "Undo the last change" on the pause: back to version 1 (Caramel Apples comes back)
    const a = await mods.undo('local', { by: 'p1' });
    assert.equal(a.kind, 'undo');
    assert.ok(recipeOf('x_caramel_apples') && !recipeOf('x_caramel_apples').retired, 'Caramel Apples is in the shop again');
    const undone = pushes.filter((m) => m.e === 'undone').at(-1);
    assert.deepEqual(undone.back.map((x) => x.id), ['x_caramel_apples'], 'the push names what came back');
    assert.equal(undone.back[0].g, 'pl', 'with its Bulgarian number (a plural noun: "отново се продават")');
    // History: version 2 (below the pause) does not read, so nothing can be brought back
    const hist = mods.history('local');
    assert.equal(hist.undo.revive, false, `no "Bring back" for a change that cannot come back: ${JSON.stringify(hist.undo)}`);
    assert.equal(hist.undo.to, 0, 'undoing the undo goes back to what the pause had: the game\'s own content');
    // and that undo works (never DAMAGED)
    const res = await fetch(`http://127.0.0.1:${s.port}/api/harness/undo`, { method: 'POST',
      headers: { Authorization: `Bearer ${tokens.p1}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.equal(recipeOf('x_caramel_apples')?.retired, true, 'Caramel Apples left again, as under the pause');
    // and History's next offer brings back what that undo took away (version 4 reads and compiles)
    const h2 = mods.history('local');
    assert.equal(h2.undo.revive, true);
  } finally {
    await s.close();
  }
});

test('H3-05: a pause below an undo is looked through: "Bring back" targets the farmer\'s own change when it still works', { timeout: 60_000 }, async () => {
  // v1 apply, v2 apply, v3 a pause of v2 (its files are fine: say a game update it did not fit then), v4 undo back to v1
  const { dir } = writeSave({ level: 21 });
  const hdir = path.join(dir, 'harness');
  copyDir(FIXTURE, path.join(hdir, 'mods'));
  const st = new ModStore(hdir);
  const m2 = st.meta(2);
  fs.cpSync(st.vdir(2), st.vdir(3), { recursive: true });
  fs.writeFileSync(path.join(st.vdir(3), 'meta.json'), JSON.stringify({ ...m2, n: 3, kind: 'suspend', parent: 2, by: null, prompt: null, prompts: null, reason: 'CONTENT_CHECK' }));
  st.commit(3, { by: null, kind: 'suspend', at: m2.at + 1000 });
  fs.cpSync(st.vdir(1), st.vdir(4), { recursive: true });
  fs.writeFileSync(path.join(st.vdir(4), 'meta.json'), JSON.stringify({ ...st.meta(1), n: 4, kind: 'undo', parent: 3, undoTo: 1, by: 'p1', prompt: null, title: { en: 'Sweet Autumn' } }));
  st.commit(4, { by: 'p1', kind: 'undo', at: m2.at + 2000 });
  const s = await testServer({ dataDir: dir });
  try {
    const mods = s.hh.harness.ctx.mods;
    const hist = mods.history('local');
    assert.equal(hist.undo.revive, true, JSON.stringify(hist.undo));
    assert.equal(hist.undo.to, 2, 'the farmer\'s own change below the pause, never the pause');
    const pushes = pushesOf(s);
    const out = await mods.undo('local', { by: 'p1' });
    assert.equal(out.kind, 'revive', 'brought back, and said so');
    const p = pushes.filter((m) => m.e === 'undone').at(-1);
    assert.equal(p.revive, true);
    assert.equal(p.to, 2);
  } finally {
    await s.close();
  }
});

// ---- H3-07 -----------------------------------------------------------------------------------------------------------
const base = { tables: cloneTables(), hash: CONTENT_HASH, rules: RULES_VERSION };
const NOW = Date.UTC(2026, 9, 14, 10, 0);          // autumn in Sofia: the Moon Melon (summer) is out of season

/** The mock provider's default change (the Moon Melon of the tester's run), as mod files. */
const FILES = { 'mod.json': MOCK_FILES['mod/mod.json'], 'content/crops/x_moon_melon.json': MOCK_FILES.crop };

function sellFactFor(state) {
  const c = compileMod(base, FILES, { n: 1, prevOverlay: null, tracks: null });
  assert.equal(c.ok, true, JSON.stringify(c.problems));
  const rows = serverRows(null, c.overlay, { base: base.tables });
  const melon = rows.filter((r) => r.id === 'x_moon_melon');
  const fact = clientRows(melon, 'en', { level: 21, sellBp: upgradeBonus(state, 'sellBp') })[0].facts.find((x) => x.key === 'harness.fact.sell');
  installOverlay(c.overlay);
  try {
    return { shown: fact.n, market: unitPrice(state, 'x_moon_melon', NOW), base: melon[0].numbers.sell };
  } finally {
    installOverlay(null);
  }
}

test('H3-07: the change list\'s sell price equals the Market\'s unit price on a farm with an upgraded Market Stand', () => {
  const { dir } = writeSave({ level: 21, now: NOW, edit: (state) => {
    const id = Object.keys(state.farm.objects).find((k) => state.farm.objects[k].def === 'market_stand');
    state.farm.objects[id].up = 2;          // Chalkboard & Scales: everything sells for 1 % more
  } });
  const { state } = JSON.parse(fs.readFileSync(path.join(dir, 'farm.json'), 'utf8'));
  assert.equal(upgradeBonus(state, 'sellBp'), 100);
  const r = sellFactFor(state);
  assert.ok(r.market > r.base, `the stand adds to the price (${r.base} → ${r.market})`);
  assert.equal(r.shown, r.market, `the sheet says ${r.shown}, the Market ${r.market}`);
});

test('H3-07: on the owners\' save (a read-only copy, when this machine has it) the row equals unitPrice', { skip: !fs.existsSync(SAVE) }, () => {
  const { state } = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
  const r = sellFactFor(state);
  assert.equal(r.shown, r.market, `the sheet says ${r.shown}, the Market ${r.market}`);
});
