// QA round 2 (release 1.0), infra's items: docs/qa/release/qa-r2/fix-infra.md. Each test failed on the tree QA
// tested (5bbfbca) before its fix (I2-01's are in test/sync.race-spot.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, ERR, PROTOCOL_VERSION, cleanName, parseClientMessage } from '../shared/net/protocol.js';
import { testServer, join, wsClient } from './helpers.js';

// ---- I2-02: player text with nothing visible, a lone surrogate, or a stack of combining marks ----------------------

const ZWSP2 = '​​';                              // two zero-width spaces: the breaker's invisible farm name
const ZALGO = (base, n) => [...base].map((ch) => ch + '́̀̂̃̄̆̇̈'.repeat(4).slice(0, n)).join('');
/** True when `s` holds a UTF-16 surrogate without its partner. */
const lone = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
/** The longest run of combining marks in `s`. */
const markRun = (s) => Math.max(0, ...(s.match(/\p{M}+/gu) ?? []).map((r) => r.length));

test('I2-02: cleanName refuses a name with nothing visible (zero-width spaces, Hangul fillers, the braille blank)', () => {
  assert.equal(cleanName(ZWSP2), '', 'two zero-width spaces are no name: the claim is refused as empty');
  assert.equal(cleanName('​‌‍⁠﻿'), '');
  assert.equal(cleanName('ㅤㅤ'), '', 'two Hangul fillers draw nothing');
  assert.equal(cleanName('ᅟᅠﾠ⠀'), '');
  assert.equal(cleanName('́́'), '', 'combining marks with no letter under them');
  // what a reader can see stays
  assert.equal(cleanName('Mila'), 'Mila');
  assert.equal(cleanName('Деси ♥'), 'Деси ♥');
  assert.equal(cleanName('رضا'), 'رضا');
  assert.equal(cleanName('🌻'), '🌻');
  assert.equal(cleanName('👩‍🌾 Ann'), '👩‍🌾 Ann', 'a joiner inside an emoji sequence stays');
  assert.equal(cleanName('한글'), '한글', 'Hangul letters are letters');
});

test('I2-02: cleanName drops a lone surrogate and never cuts a pair in half at the length cap', () => {
  assert.equal(cleanName('\ud800 lone'), 'lone');
  assert.equal(cleanName('lo\udc00ne'), 'lone');
  assert.equal(cleanName('🌻🌻'), '🌻🌻', 'paired surrogates stay');
  const cut = cleanName(`${'a'.repeat(15)}🌻`);          // the 16-unit cap falls inside the sunflower
  assert.ok(!lone(cut), `no half pair at the cap: ${JSON.stringify(cut)}`);
  assert.equal(cut, 'a'.repeat(15));
});

test('I2-02: cleanName keeps at most two combining marks per letter (a stack of 25 smeared over the line above)', () => {
  const z = cleanName(ZALGO('Mia', 25));
  assert.equal(markRun(z), 2, JSON.stringify(z));
  assert.equal(z.normalize('NFD').replace(/\p{M}/gu, ''), 'Mia');
  assert.equal(cleanName('Ён'), 'Ён', 'a precomposed letter is untouched');
  assert.equal(cleanName('Éè'), 'Éè', 'one mark per letter stays');
  assert.equal(cleanName('ệ'), 'ệ', 'Vietnamese: two marks on one letter stay');
});

test('I2-02: a claim and a chat line: nothing visible is no frame; a lone surrogate goes; marks are capped', () => {
  const claim = (name) => parseClientMessage({ t: MSG.HELLO, proto: 1, cid: 'abcdef', claim: { slot: 'p1', name } });
  assert.equal(claim(ZWSP2), null, 'an invisible name is no name');
  assert.equal(claim('\ud800Ann').claim.name, 'Ann');
  const chat = (text) => parseClientMessage({ t: MSG.CHAT, text });
  assert.equal(chat(ZWSP2), null, 'an invisible chat line is dropped like an empty one');
  assert.equal(chat('ㅤ'), null);
  assert.equal(chat('\ud800 hi').text, 'hi');
  assert.equal(markRun(chat(ZALGO('hello', 20)).text), 2);
  const long = chat(`${'x'.repeat(199)}🌻`).text;        // the 200-unit cap falls inside the sunflower
  assert.ok(!lone(long), 'no half pair at the chat cap');
  assert.equal(chat('see you at the barn 🐄').text, 'see you at the barn 🐄');
});

test('I2-02: over a socket: an invisible claim is refused, an invisible farm name is refused, a zalgo chat line is capped', async () => {
  const srv = await testServer();
  try {
    const bad = await wsClient(srv.port);
    bad.send({ t: MSG.HELLO, proto: PROTOCOL_VERSION, cid: 'zzzzzz', claim: { slot: 'p2', name: ZWSP2 } });
    const got = await bad.next((m) => m.t === MSG.WELCOME || m.t === 'deny', 1000).catch(() => null);
    assert.notEqual(got?.t, MSG.WELCOME, 'no seat for a name nobody can see');
    assert.equal(srv.hh.engine.state.players.p2, undefined);
    bad.close();
    const a = await join(srv.port, 'p1', 'Ann');
    assert.equal(a.w.t, MSG.WELCOME);
    const b = await join(srv.port, 'p2', `${ZALGO('Bo', 25)}`, 'bbbbbb');
    assert.equal(b.w.t, MSG.WELCOME);
    assert.equal(markRun(srv.hh.engine.state.players.p2.name), 2, 'the stored name keeps two marks per letter');
    // the breaker's raw act: nameFarm with two zero-width spaces
    a.c.send({ t: MSG.ACT, seq: 1, type: 'nameFarm', args: { name: ZWSP2 } });
    const r = await a.c.next((m) => (m.t === MSG.REJ || m.t === MSG.DELTA) && (m.seq === 1));
    assert.equal(r.t, MSG.REJ);
    assert.equal(r.code, ERR.BAD_ARGS);
    assert.notEqual(srv.hh.engine.state.farm.name, ZWSP2);
    // a chat line stacked with marks reaches the partner with two per letter, a lone surrogate without it
    a.c.send({ t: MSG.CHAT, text: `${ZALGO('hey', 25)} \ud800!` });
    const line = await b.c.next((m) => m.t === MSG.CHAT);
    assert.equal(markRun(line.text), 2);
    assert.ok(!lone(line.text));
    a.c.close();
    b.c.close();
  } finally {
    await srv.close();
  }
});

test('I2-02: the landing\'s "farms on this device" list shows an invisible or half-surrogate name as no name', async () => {
  const F = await import('../public/js/net/farm.js');
  const m = new Map();
  const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  m.set('hh.farms', JSON.stringify([
    { id: 'aaaaaaaaaaaa', name: ZWSP2, lastOpen: 3 },
    { id: 'bbbbbbbbbbbb', name: '\ud800 Sunny Acres', lastOpen: 2 },
    { id: 'cccccccccccc', name: ZALGO('Hill', 25), lastOpen: 1 },
    { id: 'dddddddddddd', name: `${'a'.repeat(39)}🌻`, lastOpen: 0 },
  ]));
  const names = F.farmsOnDevice(st).map((f) => f.name);
  assert.equal(names[0], null, 'an invisible name reads as a farm with no name yet');
  assert.equal(names[1], 'Sunny Acres');
  assert.equal(markRun(names[2]), 2);
  assert.ok(!lone(names[3]), 'the 40-unit cut keeps no half pair');
});

// ---- I2-C1: the owners' cold self-path boot: the first view's files come first, alone, the home buildings first ----

const B = '/assets/models/buildings/';
const TR = '/assets/models/trees/';
const DE = '/assets/models/decor/';
const AV = '/assets/models/avatars/';
/** buildings: farmhouse 100, barn 300, bakery 200 (in view), silo 400 (out of view); trees: apple 300 in view, pine 100
 *  out of view, oak 600 unused; decor: lamp 10 in view, gnome 10 out of view, 30 more unused; animals: one 50 % used,
 *  none in view (a pack family); avatars: the farmer. */
const FV_IX = {
  'models-buildings': { dir: B, v: 'b1', files: { 'bakery.glb': [0, 200], 'barn.glb': [200, 300], 'farmhouse.glb': [500, 100], 'silo.glb': [600, 400] } },
  'models-trees': { dir: TR, v: 't1', files: { 'apple.glb': [0, 300], 'oak.glb': [300, 600], 'pine.glb': [900, 100] } },
  'models-decor': { dir: DE, v: 'd1', files: Object.fromEntries([['gnome.glb', [0, 10]], ['lamp.glb', [10, 10]],
    ...Array.from({ length: 30 }, (_, i) => [`x${i}.glb`, [20 + i * 10, 10]])]) },
  'models-animals': { dir: '/assets/models/animals/', v: 'a1', files: { 'cow.glb': [0, 500], 'hen.glb': [500, 500] } },
  'models-avatars': { dir: AV, v: 'v1', files: { 'farmer_a.glb': [0, 600], 'farmer_b.glb': [600, 600] } },
};
// what main.js names after the view's first setState: the farmhouse and the barn (lead 2), the farmer, then nearest
const FIRST = [`${B}farmhouse.glb`, `${B}barn.glb`, `${AV}farmer_b.glb`, `${TR}apple.glb`, `${B}bakery.glb`, `${DE}lamp.glb`];

/** A fetcher whose answers the test releases one by one. */
function gate() {
  const calls = [];
  const fetcher = (u) => new Promise((resolve) => calls.push({ u, ok: (n = 2000) => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(n) }) }));
  const settle = async () => { for (let i = 0; i < 20; i++) await null; };
  return { calls, fetcher, settle, urls: () => calls.map((c) => c.u.replace(/\?.*$/, '')) };
}

test('I2-C1: the first view comes first as files of their own: the home buildings first, then smallest first; no pack meanwhile', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const P = await import('../public/js/net/packs.js');
  P.resetPacks(FV_IX);
  const g = gate();
  P.setFirstView(['models-buildings', 'models-trees', 'models-decor', 'models-avatars']);
  // the render asks for every model of the farm in its own order inside setState; main.js names the files right after
  const want = [`${B}silo.glb`, `${TR}pine.glb`, `${DE}gnome.glb`, '/assets/models/animals/cow.glb', ...FIRST];
  const got = new Map(want.map((p) => [p, P.fromPack(p, g.fetcher, `${p}?v=m`)]));
  P.setFirstView(null, FIRST, 2);
  t.mock.timers.tick(P.COLLECT_MS);
  await g.settle();
  // three at a time: the farmhouse and the barn, and the smallest of the rest (the lamp, 10 bytes)
  assert.deepEqual(g.urls(), [`${B}farmhouse.glb`, `${B}barn.glb`, `${DE}lamp.glb`], 'the home buildings first, no pack');
  assert.ok(g.calls.every((c) => c.u.endsWith('?v=m')), 'each by its own versioned URL (cached immutable)');
  g.calls[0].ok();                                        // the farmhouse is in: the next smallest (the bakery, 200)
  await g.settle();
  assert.equal(g.urls().at(-1), `${B}bakery.glb`);
  g.calls[2].ok();                                        // the lamp: then the apple tree (300)
  await g.settle();
  assert.equal(g.urls().at(-1), `${TR}apple.glb`);
  g.calls[1].ok();                                        // the barn: the farmer (600) last
  await g.settle();
  assert.deepEqual(g.urls(), [`${B}farmhouse.glb`, `${B}barn.glb`, `${DE}lamp.glb`, `${B}bakery.glb`, `${TR}apple.glb`, `${AV}farmer_b.glb`]);
  const outside = new Map();
  for (const p of [`${B}silo.glb`, `${TR}pine.glb`, `${DE}gnome.glb`]) got.get(p).then((v) => outside.set(p, v));
  for (const c of g.calls.slice(3, -1)) c.ok();
  await g.settle();
  assert.equal(outside.size, 0, 'an out-of-view model waits while the first view comes');
  assert.equal(g.urls().length, FIRST.length, 'and no pack started (the animals are not in view: they wait too)');
  g.calls.at(-1).ok();
  await g.settle();
  // the first view is in: the rest of a family the first view split loads file by file (the caller fetches on null),
  // never the pack (it would bring the first view again and the unused oak); a family out of view keeps its pack
  assert.deepEqual([...outside.entries()].sort(), [[`${B}silo.glb`, null], [`${DE}gnome.glb`, null], [`${TR}pine.glb`, null]]);
  assert.deepEqual(g.urls().slice(FIRST.length), ['/assets/packs/models-animals.bin']);
  assert.equal((await got.get(`${B}farmhouse.glb`)).byteLength, 2000, 'a first-view member returns its own bytes');
  const stats = P.packStats();
  assert.deepEqual(stats.split.sort(), ['models-avatars', 'models-buildings', 'models-decor', 'models-trees']);
  assert.equal(stats.modes['models-buildings'], 'single', 'remembered for the next boot: its files are cached');
  assert.equal(stats.own.done, FIRST.length);
  P.resetPacks(null);
});

test('I2-C1: a family whose pack already started (a remembered first view) serves its first-view members from the pack', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const P = await import('../public/js/net/packs.js');
  P.resetPacks(FV_IX);
  const g = gate();
  await P.prefetchRemembered(g.fetcher, ['models-buildings']);
  P.setFirstView(['models-buildings'], FIRST, 2);
  const farm = P.fromPack(`${B}farmhouse.glb`, g.fetcher, `${B}farmhouse.glb?v=m`);
  t.mock.timers.tick(P.COLLECT_MS);
  await g.settle();
  assert.deepEqual(g.urls(), ['/assets/packs/models-buildings.bin'], 'the pack that was already coming, nothing twice');
  g.calls[0].ok(1000);
  assert.equal((await farm).byteLength, 100);
  P.resetPacks(null);
});

test('I2-C1: a first-view file that never answers holds the rest for FV_MAX_WAIT_MS at most', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const P = await import('../public/js/net/packs.js');
  P.resetPacks(FV_IX);
  const g = gate();
  P.setFirstView(['models-buildings'], [`${B}farmhouse.glb`], 1);
  P.fromPack(`${B}farmhouse.glb`, g.fetcher, `${B}farmhouse.glb?v=m`);
  let gnome = 'waiting';
  P.fromPack(`${DE}gnome.glb`, g.fetcher, `${DE}gnome.glb?v=m`).then((v) => { gnome = v; });
  t.mock.timers.tick(P.COLLECT_MS);
  await g.settle();
  assert.deepEqual(g.urls(), [`${B}farmhouse.glb`]);
  assert.equal(gnome, 'waiting');
  t.mock.timers.tick(P.FV_MAX_WAIT_MS);
  await g.settle();
  assert.equal(gnome, null, 'the wait is over: the caller fetches the gnome itself');
  P.resetPacks(null);
});

test('I2-C1: firstViewFiles: the home buildings, then `after`, then nearest; what `seen` shows, else within the radius', async () => {
  const { firstViewFiles } = await import('../shared/net/packs-plan.js');
  const state = { farm: { objects: {
    a: { def: 'lamp', x: 11, z: 10 },
    b: { def: 'barn', x: 18, z: 10 },
    c: { def: 'farmhouse', x: 4, z: 10 },
    d: { def: 'plot', x: 10, z: 11, crop: { def: 'wheat' } },
    e: { def: 'lamp', x: 10, z: 10 },
    f: { def: 'silo', x: 40, z: 40 },
    g: { def: 'mystery', x: 10, z: 10 },
    h: null,
  } } };
  const files = { lamp: 'decor/lamp.glb', barn: 'buildings/barn.glb', farmhouse: 'buildings/farmhouse.glb', plot: 'plots/plot.glb',
    wheat: 'crops/wheat.glb', silo: 'buildings/silo.glb' };
  const fileOf = (d) => { if (d === 'mystery') throw new Error('no model'); return files[d] ?? null; };
  const M = (f) => `/assets/models/${f}`;
  assert.deepEqual(firstViewFiles(state, { x: 10, z: 10 }, fileOf, { lead: ['farmhouse', 'barn'], after: [M('avatars/farmer_b.glb')] }), [
    M('buildings/farmhouse.glb'), M('buildings/barn.glb'),            // the lead, nearest first (6, 8)
    M('avatars/farmer_b.glb'),                                         // then the farmers
    M('decor/lamp.glb'),                                               // 0 (its nearer copy counts)
    M('crops/wheat.glb'), M('plots/plot.glb'),                         // 1, ties by path
  ], 'the silo is beyond the radius; a def whose model lookup throws is skipped');
  // with the view's answer instead of the radius: the far silo is on screen, the lamp at (11, 10) is not
  const seen = (o) => { if (o.def === 'plot') throw new Error('odd'); return o.def !== 'lamp' || o.x === 10; };
  assert.deepEqual(firstViewFiles(state, { x: 10, z: 10 }, fileOf, { seen }), [M('decor/lamp.glb'), M('buildings/farmhouse.glb'),
    M('buildings/barn.glb'), M('buildings/silo.glb')], 'a `seen` that throws counts as not seen');
  assert.deepEqual(firstViewFiles(null, { x: 0, z: 0 }, fileOf), []);
  assert.deepEqual(firstViewFiles(state, [], fileOf), []);
});
