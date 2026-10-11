// ui+client lane, wave 5 (the owners' wish list of 2026-10-05): babies in the pen (the ❤ card on a home, the partner's
// moments, the birth line), the dog's "Stay home" / "Come with me" (the pet panel, the pet's world card, the lines) and
// the fewer, bigger land parcels (the land cards, the atlas, the once-only word). Farms are built by the real rules;
// panels mount in the ui tests' tiny DOM; every new sentence is read in English AND Bulgarian.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { animalOf, defOf } from '../shared/content/index.js';
import { farmAt, put, give, actOk, act, runDue, T0, HOUR } from './helpers/rules-goals.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

let W;
let M;
let I;
before(async () => {
  W = await import('../public/js/ui/panels/w5-rules.js');
  I = await import('../public/js/i18n/index.js');
  M = {
    pair: await import('../public/js/ui/panels/pen-pair.js'),
    hub: await import('../public/js/ui/panels/w5.js'),
    animals: await import('../public/js/ui/panels/animals.js'),
    pets: await import('../public/js/ui/panels/pets.js'),
    model: await import('../public/js/ui/panels/model.js'),
    atlas: await import('../public/js/ui/panels/expansions-map.js'),
    feed: await import('../public/js/ui/feed.js'),
    hud: await import('../public/js/ui/hud.js'),
  };
});
after(() => I.__setForTest('en'));

const JUNK = /undefined|NaN|\[object|null\b|\{[a-z]+(:[a-z]+)?\}/;

function ctxOf(state, { pid = 'p1', now = T0 + HOUR, args = {} } = {}) {
  const acts = [];
  const toasts = [];
  const body = document.createElement('div');
  document.body.append(body);
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name: 'x', args, store, body, el: body, now: () => now, tab: null,
    ui: { panels: { open: () => true, has: () => true }, toast: (t, o) => toasts.push([t, o]) },
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    open() {}, close() {}, setTitle() {}, refreshTabs() {},
    controller: { input: 'mouse', do: (t, a) => { acts.push([t, a]); return { ok: true }; } },
  };
  return { ctx, body, acts, toasts, store };
}

/** A level-`lv` farm with a Cow Barn of `n` grown cows (and Baby Bottles in the Barn). */
function cowFarm(lv = 9, n = 3) {
  const s = farmAt(lv);
  const home = put(s, 'cow_barn');
  const cows = [];
  for (let i = 0; i < n; i++) cows.push(put(s, 'cow', { home, adultAt: T0 - HOUR }));
  give(s, animalOf('cow').bottle, 3);
  return { s, home, cows };
}
const byData = (root, k) => root.querySelectorAll(`[data-${k}]`);

// ---- L1.1 babies in the pen -----------------------------------------------------------------------------------------

test('pen ❤: the adapter sends the rules\' pair {home, a, b}; the view proposes the two lowest grown ids, its cost and time', () => {
  const { s, home, cows } = cowFarm();
  assert.equal(W.can5('pair'), true);
  const v = W.pairView(s, home, T0 + HOUR);
  assert.deepEqual(W.pairIntent(home, v), { type: 'pair', args: { home, a: cows[0], b: cows[1] } });
  assert.equal(v.open, true);
  assert.equal(v.why, null);
  assert.deepEqual(v.pick, [cows[0], cows[1]].sort());
  assert.deepEqual(v.cost, { item: animalOf('cow').bottle, qty: 1 });
  assert.ok(v.ms > 0, 'about the species\' baby time');
  assert.equal(v.code, null, 'the rules would take it');
  // the farmer picks the third cow: the newest pick replaces the older one
  assert.deepEqual(W.pairView(s, home, T0 + HOUR, [cows[1], cows[2]]).pick, [cows[1], cows[2]]);
  // below level 8: a quiet teaser; a beehive: never
  const low = cowFarm(7);
  assert.equal(W.pairView(low.s, low.home, T0 + HOUR).why, 'level');
  const bees = farmAt(12);
  const hive = put(bees, 'beehive');
  assert.equal(W.pairView(bees, hive, T0 + HOUR).why, 'colony');
});

test('pen ❤: the home card pairs, shows the pair expecting on both screens, and the birth reads well in both languages', () => {
  const { s, home, cows } = cowFarm();
  const { ctx, body, acts } = ctxOf(s, { args: { id: home } });
  const p = M.animals.animalsPanel.mount(body, ctx);
  void p;
  const go = byData(body, 'pairgo')[0];
  assert.ok(go, 'the ❤ button');
  assert.equal(byData(body, 'pairpick').length, 3, 'one chip per grown cow');
  assert.match(textOf(body), /Pair two grown Cows and a calf arrives here in about/);
  go.click();
  assert.deepEqual(acts.at(-1), ['pair', { home, a: cows[0], b: cows[1] }]);
  // the real rules: the pair expects; the card turns into the waiting card with the names and the time
  const now = T0 + HOUR;
  actOk(s, 'pair', { home }, { now, pid: 'p2' });
  const v = W.pairView(s, home, now + 1000);
  assert.ok(v.running && v.running.a === cows[0]);
  assert.deepEqual([W.pairOf(s, home).a, W.pairOf(s, home).b], [cows[0], cows[1]]);
  const c2 = ctxOf(s, { args: { id: home }, now: now + 1000 });
  M.animals.animalsPanel.mount(c2.body, c2.ctx);
  const txt = textOf(c2.body);
  assert.match(txt, /Cow 1 and Cow 2 are expecting a calf/);
  assert.match(txt, /Paired by /);
  assert.match(txt, /paired/, 'the ❤ tag on both parents');
  assert.match(M.pair.pairTipLine(s, home, now + 1000), /^❤ A calf in /);
  // the partner's toast line names both
  assert.match(M.hub.pairText(s, { e: 'paired', home, species: 'cow', a: cows[0], b: cows[1], by: 'p2' }, 'p1'), /paired Cow 1 and Cow 2 ❤ A calf is on its way/);
  assert.equal(M.hub.pairText(s, { e: 'paired', home, by: 'p1' }, 'p1'), null, 'my own ❤ shows in its panel');
  // the baby arrives by itself (system _pen), on both screens, with its feed line
  const due = s.farm.objects[home].pair.readyAt;
  const ran = runDue(s, due);
  assert.ok(ran.includes('_pen'));
  const born = Object.keys(s.farm.objects).find((id) => s.farm.objects[id].home === home && s.farm.objects[id].baby);
  assert.ok(born);
  assert.match(M.hub.bornText(s, { e: 'penBorn', id: born, species: 'cow', home }), /^A calf was born in the Cow Barn!\u00a0🍼$/);
  const row = M.feed.feedText({ k: 'pen', def: 'cow', id: born, by: 'p2', at: due }, s, 'p1');
  assert.match(row.text, /welcomed a newborn calf in the Cow Barn\u00a0🍼/);
  assert.doesNotMatch(row.text, JUNK);
});

test('pen ❤ in Bulgarian: the card, the toast, the birth and the feed line', async () => {
  const { s, home, cows } = cowFarm();
  await I.__loadForTest('bg');
  try {
    const { ctx, body } = ctxOf(s, { args: { id: home } });
    M.animals.animalsPanel.mount(body, ctx);
    const txt = textOf(body);
    assert.match(txt, /Сватосай двойка пораснали крави – и след около .+ тук ще се появи теленце\./);
    assert.match(txt, /Сватосай ги/);
    actOk(s, 'pair', { home }, { now: T0 + HOUR, pid: 'p2' });
    const name = s.players.p2.name;
    assert.equal(M.hub.pairText(s, { e: 'paired', home, species: 'cow', a: cows[0], b: cows[1], by: 'p2' }, 'p1'),
      `${name} сватоса Крава 1 и Крава 2 ❤ Теленце е на път`);
    assert.match(M.pair.pairTipLine(s, home, T0 + 2 * HOUR), /^❤ Теленце след /);
    assert.equal(M.hub.bornText(s, { e: 'penBorn', species: 'cow', home }), 'В краварника се роди теленце!\u00a0🍼');
    const row = M.feed.feedText({ k: 'pen', def: 'cow', id: cows[0], by: 'p1', at: T0 }, s, 'p1');
    assert.match(row.text, /посрещна новородено теленце в краварника\u00a0🍼/);
    for (const t of [txt, row.text]) assert.doesNotMatch(t, JUNK);
  } finally { I.__setForTest('en'); }
});

test('pen ❤: a full home grows a room step with the pairing (its price on the card and in `max`); new species\' baby words', () => {
  const { s, home } = cowFarm(9, 2);
  const cap = M.model.homeView(s, home, T0 + HOUR).cap;
  for (let i = 2; i < cap; i++) put(s, 'cow', { home, adultAt: T0 - HOUR });
  s.farm.wallet.coins = 5_000_000;
  const v = W.pairView(s, home, T0 + HOUR);
  assert.equal(v.full, true);
  assert.ok(v.room && v.room.code === null && v.room.coins > 0, JSON.stringify(v.room));
  assert.equal(v.code, null);
  assert.equal(W.pairIntent(home, v).args.max, v.room.coins, 'the price this farmer saw');
  const { ctx, body, acts } = ctxOf(s, { args: { id: home } });
  M.animals.animalsPanel.mount(body, ctx);
  assert.match(textOf(body), /Includes room for the baby: \+[\d,]+ coins/);
  body.querySelector('[data-pairgo]').click();
  assert.equal(acts.at(-1)[1].max, v.room.coins);
  actOk(s, 'pair', W.pairIntent(home, v).args, { now: T0 + HOUR, pid: 'p1' });
  assert.ok(s.farm.objects[home].pair, 'paired, the home grew');
  for (const sp of ['bison', 'quail', 'rabbit']) {
    if (!animalOf(sp)) continue;
    assert.doesNotMatch(I.t(`home.nursery.noun.${sp}`), /baby/, sp);
  }
});

test('pen ❤: a full home boxed in by a fence says what is in the way, once, and offers to move the home', async () => {
  const GR = await import('../shared/rules/grid.js');
  const s = farmAt(30);
  s.farm.wallet.coins = 5_000_000;
  for (const id of Object.keys(s.farm.objects)) if (['coop', 'chicken'].includes(s.farm.objects[id].def)) delete s.farm.objects[id];
  // grown to its old capacityMax: the next room step needs a bigger footprint (wave 4b)
  const cd = defOf('coop');
  const coop = put(s, 'coop', { x: 30, z: 30, up: (cd.capacityMax - cd.capacity) / cd.upgradeStep });
  for (let i = 0; i < 40 && GR.occupantsOf(s, coop).length < GR.capacityOf(s, coop); i++) put(s, 'chicken', { home: coop, adultAt: T0 - HOUR });
  give(s, animalOf('chicken').bottle, 2);
  const o = s.farm.objects[coop];
  const [w, d] = GR.sizeOf(o);
  for (let z = o.z - 1; z <= o.z + d; z++) for (let x = o.x - 1; x <= o.x + w; x++) {
    if (x >= o.x && x < o.x + w && z >= o.z && z < o.z + d) continue;
    put(s, 'picket_fence', { x, z });
  }
  const v = W.pairView(s, coop, T0 + HOUR);
  assert.equal(v.code, 'BLOCKED');
  const moved = [];
  const { ctx, body } = ctxOf(s, { args: { id: coop } });
  ctx.controller.move = (id) => moved.push(id);
  M.animals.animalsPanel.mount(body, ctx);
  const card = body.querySelector('[data-pair]');
  const words = textOf(card);
  assert.match(words, /No room for a baby: Picket Fences are in the way/);
  const why = card.querySelector('[data-pairgo]').parentNode.querySelector('.pn-why');
  assert.equal(why.hidden, true, 'the button does not say it a second time');
  card.querySelector('[data-pairmove]').click();
  assert.deepEqual(moved, [coop]);
});

// ---- L2.3 the dog stays home ----------------------------------------------------------------------------------------

test('dog: Stay home / Come with me in the pet panel and on its world card; both farmers read where it is', async () => {
  const s = farmAt(12);
  actOk(s, 'adoptPet', { kind: 'dog', name: 'Rex' }, { now: T0, pid: 'p1' });
  assert.deepEqual(W.stayIntent(true, 'p1', 'p1'), { type: 'petStay', args: { stay: true } });
  assert.deepEqual(W.stayIntent(true, 'p1', 'p2'), { type: 'petStay', args: { stay: true, owner: 'p1' } }, 'the partner may tell it too');
  // following: the card says so and offers "Stay home"
  let tip = M.hud.worldTip(s, { kind: 'pet', owner: 'p1', x: 30, z: 30 }, T0, 'p1');
  assert.equal(tip.title, 'Rex');
  assert.match(tip.lines.join(' | '), /Follows you about the farm/);
  const a = ctxOf(s, { now: T0 + 1000 });
  M.pets.petsPanel.mount(a.body, a.ctx);
  const stay = byData(a.body, 'stay').find((n) => n.dataset.stay === 'stay');
  assert.ok(stay, 'Stay home');
  stay.click();
  assert.deepEqual(a.acts.at(-1), ['petStay', { stay: true }]);
  // the rules: it stays (no Dog House: by the porch); both screens say so
  actOk(s, 'petStay', { stay: true }, { now: T0 + 2000, pid: 'p1' });
  assert.equal(W.stayOf(s.players.p1.pet), true);
  tip = M.hud.worldTip(s, { kind: 'pet', owner: 'p1', x: 30, z: 30 }, T0 + 3000, 'p2');
  assert.match(tip.lines.join(' | '), /Stays home by the farmhouse/);
  const b = ctxOf(s, { now: T0 + 3000 });
  M.pets.petsPanel.mount(b.body, b.ctx);
  assert.match(textOf(b.body), /Come with me/);
  assert.equal(M.hub.stayText(s, { e: 'petStay', pid: 'p1', stay: true, by: 'p1' }, 'p1'), 'Rex stays home\u00a0🏠');
  assert.match(M.hub.stayText(s, { e: 'petStay', pid: 'p1', stay: true, by: 'p1' }, 'p2'), /Rex stays home now\u00a0🏠$/);
  assert.match(M.hub.stayText(s, { e: 'petStay', pid: 'p1', stay: false, by: 'p2' }, 'p1'), /called Rex to come along/);
  // a Dog House placed: that is where it waits
  put(s, 'dog_house');
  assert.match(W.stayLine(s, 'p1'), /Stays home by its Dog House/);
  await I.__loadForTest('bg');
  try {
    assert.match(W.stayLine(s, 'p1'), /^Стои си вкъщи при кучешката колиба\u00a0🏠$/);
    assert.equal(M.hub.stayText(s, { e: 'petStay', pid: 'p1', stay: true, by: 'p1' }, 'p1'), 'Rex остава вкъщи\u00a0🏠');
    const c = ctxOf(s, { now: T0 + 4000 });
    M.pets.petsPanel.mount(c.body, c.ctx);
    assert.match(textOf(c.body), /Ела с мен/);
    assert.doesNotMatch(textOf(c.body), JUNK);
  } finally { I.__setForTest('en'); }
  assert.equal(act(s, 'petStay', { stay: true }, { now: T0 + 5000, pid: 'p1' }).code, 'ALREADY_DONE');
});

// ---- L2.4 fewer, bigger land parcels --------------------------------------------------------------------------------

test('land: the cards and the atlas sell parcels (several old pieces), each with its plot cap, room and pieces', () => {
  const s = farmAt(9);
  const units = W.landUnits();
  assert.equal(units[0].id, 'home');
  assert.ok(units.length >= 6 && units.length <= 10, `about 8 big parcels (${units.length})`);
  const cards = M.model.landCards(s, { now: T0 });
  const first = cards[0];
  assert.equal(first.k, 1);
  assert.equal(first.isNext, true);
  assert.equal(first.plots, 6 * first.pieces.length);
  assert.ok(first.area > 128, 'more room than an old small piece');
  assert.deepEqual(M.model.landCards(s, { now: T0 }).filter((c) => c.owned), []);
  // owning every piece of a parcel = owning the parcel
  s.farm.expansions = ['home', ...first.pieces];
  const v = M.atlas.atlasView(s, { now: T0, pid: 'p1' });
  assert.equal(v.parcels.find((p) => p.id === first.id).status, 'ours');
  assert.equal(v.bought, 1);
  assert.equal(v.plots.fromLand, first.plots);
  assert.ok(v.parcels.find((p) => p.id === first.id).pieceNames.length >= 2);
  // the expansion intent names the parcel
  assert.deepEqual(W.expandIntent(cards[1].id), { type: 'expand', args: { expansion: cards[1].id } });
  // a for-sale sign on an old piece opens its parcel
  assert.equal(W.unitOfPiece(first.pieces[0]), first.id);
  // the atlas paints the old pieces where they were and draws one outline round a parcel
  const vg = W.vignettesOf({ id: first.id, rects: first.rects, pieces: first.pieces }, (id) => first.pieces.includes(id));
  assert.deepEqual(vg.map((x) => x.id).sort(), [...first.pieces].sort());
  const d = W.outlinePath([[0, 0, 2, 1], [2, 0, 1, 2]]);
  assert.doesNotMatch(d, /M2 0V1/, 'no edge between the two halves');
  assert.match(d, /M0 0H3/);
});

test('land: the once-only word after the migration names the parcels the farm owns (EN + BG)', async () => {
  const s = farmAt(17);
  s.farm.expansions = ['home', 'creekside', 'old_orchard', 'cow_hill'];
  assert.equal(M.hub.landNotice(s, 'p1', null), null, 'no migration line: no word');
  // the rules' `_land` (the owners' save: four old pieces) leaves its feed line
  const plan = runDue(s, T0);
  assert.ok(plan.includes('_land'), plan.join());
  const n = M.hub.landNotice(s, 'p1', null);
  assert.ok(n);
  assert.match(n.message, /now comes in \d+ big parcels instead of many small ones\. Everything you owned is still yours: Creek Hill and Orchard Lane\./);
  assert.equal(M.hub.landNotice(s, 'p1', n.key), null, 'told once');
  const row = M.feed.feedText({ k: 'land', q: 1, by: 'sys', at: T0 }, s, 'p1');
  assert.match(row.text, /big parcels/);
  await I.__loadForTest('bg');
  try {
    const b = M.hub.landNotice(s, 'p1', null);
    assert.match(b.message, /^Земята на фермата вече е в \d+ големи парцела вместо в много малки\. Всичко ваше си остава ваше: .+ и .+\.$/);
    assert.doesNotMatch(b.message, JUNK);
    const cards = M.model.landCards(s, { now: T0 });
    void cards;
  } finally { I.__setForTest('en'); }
});
