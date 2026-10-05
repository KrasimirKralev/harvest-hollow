// ui-home (wave 3, M2): the farm atlas, the Barn's upgrade ladder, the Grand decor showroom, the farmhouse (room,
// Restoration 4-6, Grandma's visit), the Nursery, the Breeding Barn and the Fishing Dock. Every view model is driven by
// the REAL rules on a real farm under the M2 milestone (the rules-economy test hook), so what a panel shows is what
// the rules do; the panels are also mounted in the tiny test DOM so a render can never throw or print junk.
process.env.HH_TEST_MILESTONE = 'M2';
const { m2 } = await import('./helpers/rules-economy-m2.js');
const M = await m2();
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const { installDom, textOf } = await import('./ui-qa2-dom.js');
installDom();
globalThis.CSS = globalThis.CSS ?? { escape: (x) => String(x) };
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? ((f) => setTimeout(f, 0));

const { content, decor, restoration } = M;
const { farmAt, give, placeDef, must, run, evs, T0, HOUR, MIN } = M.rulesHelpers;
const { resetGrid } = M.gridCache;
const { validateState } = M.state;
const { CONTENT, BREEDING, NURSERY, FISHING, INTERIOR, GRANDMA_VISIT, FARM_BEAUTY } = content;

const atlas = await import('../public/js/ui/panels/expansions-map.js');
const barnL = await import('../public/js/ui/panels/barn-upgrades.js');
const grand = await import('../public/js/ui/panels/grand-decor.js');
const nurs = await import('../public/js/ui/panels/nursery.js');
const breed = await import('../public/js/ui/panels/breeding.js');
const fish = await import('../public/js/ui/panels/fishing.js');
const house = await import('../public/js/ui/panels/farmhouse.js');
const home = await import('../public/js/ui/panels/home.js');
const art = await import('../public/js/ui/panels/home-art.js');

const BIG = { confirm: ['BIG_SPEND', 'RESERVED'] };
const noJunk = (t) => assert.ok(typeof t === 'string' && !/undefined|NaN|\[object|null(?![a-z])/i.test(t), `junk in: ${t.slice(0, 200)}`);

function farm(level, o = {}) {
  const s = farmAt(level, { coins: 50_000_000, acorns: 200, ...o });
  s.players.p1.name = 'Rowan';
  s.players.p2.name = 'Mia';
  return s;
}
const allLand = (s, upTo = Infinity) => {
  s.farm.expansions = content.live('expansions').filter((e) => e.k <= upTo).map((e) => e.id);
  resetGrid(s);
};
const done = (s, id, at = T0 - HOUR) => {
  const p = CONTENT.restoration.get(id);
  s.farm.restore[id] = { s: {}, b: Object.fromEntries(p.bundles.map((b) => [b.id, at])), done: at };
};

/** A panel ctx on a plain state (no network): act runs the real rules on the state. */
function ctxOf(s, { pid = 'p1', now = T0, name = 'x', tab = null, args = {} } = {}) {
  const acts = [];
  const store = { state: s, pid, now: () => now, on: () => () => {},
    act: (type, a) => { acts.push({ type, args: a }); return run(s, type, { ...a }, { pid, now }); } };
  return {
    name, tab, args, store, now: () => now, every: () => () => {}, on: () => () => {}, open: () => true, close: () => {},
    setTab: () => {}, controller: {}, acts,
    ui: { toast: () => {}, panels: { has: () => true, badge: () => {} } },
    act: (type, a) => { acts.push({ type, args: a }); return run(s, type, { ...a, ...BIG }, { pid, now }); },
  };
}
function mount(spec, s, o) {
  const body = document.createElement('div');
  document.body.append(body);
  const ctx = ctxOf(s, o);
  const inst = spec.mount(body, ctx);
  inst?.update?.({ topics: new Set(['*']) });
  const text = textOf(body);
  noJunk(text);
  return { body, ctx, inst, text };
}

// ---- the farm atlas ------------------------------------------------------------------------------------------------

test('atlas: every parcel has a status, the next one is for sale, and the plot cap equals the rules\' own cap', () => {
  const s = farm(33);
  allLand(s, 12);
  let v = atlas.atlasView(s, { now: T0, pid: 'p1' });
  assert.equal(v.total, 15);
  assert.equal(v.bought, 12);
  assert.equal(v.parcels.find((p) => p.id === 'home').status, 'home');
  assert.equal(v.parcels.find((p) => p.k === 12).status, 'ours');
  assert.equal(v.parcels.find((p) => p.k === 13).status, 'sale', 'Olive Terrace opens at 33');
  assert.equal(v.parcels.find((p) => p.k === 14).status, 'later');
  assert.equal(v.next.id, 'olive_terrace');
  assert.equal(v.plots.cap, decor.ownCap(s, content.defOf('plot')), 'the cap the rules enforce');
  assert.equal(v.plots.fromLand, 12 * 6);
  // the Hollow Meadow follows the Stone Bridge: +6 on the cap the rules count too
  assert.equal(v.parcels.find((p) => p.id === 'hollow_meadow').status, 'meadow-later');
  done(s, 'stone_bridge');
  resetGrid(s);
  v = atlas.atlasView(s, { now: T0, pid: 'p1' });
  assert.equal(v.parcels.find((p) => p.id === 'hollow_meadow').status, 'meadow-ours');
  assert.equal(v.plots.fromMeadow, 6);
  assert.equal(v.plots.cap, decor.ownCap(s, content.defOf('plot')));
  assert.equal(v.plots.base + v.plots.fromLevels + v.plots.fromLand + v.plots.fromMeadow, v.plots.cap);
  // below the next parcel's level it is 'soon', never for sale
  const low = farm(32);
  allLand(low, 12);
  const w = atlas.atlasView(low, { now: T0, pid: 'p1' });
  assert.equal(w.parcels.find((p) => p.k === 13).status, 'soon');
  assert.equal(w.upcoming.id, 'olive_terrace');
  assert.equal(atlas.featureText({ goldenHourBonusMs: 600_000 }), 'Golden Hour lasts 10 min longer up here');
  assert.equal(atlas.featureText(null), null);
});

test('atlas panel: renders, opens the next card\'s proof, and buying goes through the rules', () => {
  const s = farm(33);
  allLand(s, 12);
  const { text, ctx } = mount(atlas.landmapPanel, s, { name: 'landmap' });
  assert.match(text, /Olive Terrace/);
  assert.match(text, /12 of 15/);
  assert.ok(ctx.acts.some((a) => a.type === 'openExpansion' && a.args.expansion === 'olive_terrace'), 'showing the card starts its proof');
});

// ---- the Barn's upgrade ladder -------------------------------------------------------------------------------------

test('barn ladder: rung statuses, the next upgrade, and the materials the rest still need', () => {
  const s = farm(33);
  s.farm.barn = 7;
  give(s, 'planks', 12);
  give(s, 'wooden_crate', 1);
  const v = barnL.barnLadderView(s);
  assert.equal(v.rungs.length, 11);
  assert.equal(v.rungs[0].status, 'done');
  assert.equal(v.rungs[7].status, 'done');
  assert.equal(v.rungs[8].status, 'next');
  assert.equal(v.rungs[9].status, 'later');
  assert.equal(v.next.n, 8);
  const rest = CONTENT.barn.filter((r) => r.n > 7);
  assert.equal(v.need.planks, rest.reduce((t, r) => t + r.planks, 0));
  assert.equal(v.need.crates, rest.reduce((t, r) => t + r.crates, 0));
  assert.equal(v.have.planks, 12);
  // the rungs' capacities are the rules' capacities
  for (const r of v.rungs.slice(1)) assert.equal(r.capacity, content.barnCapacity(r.n));
  // the panel's Upgrade button is the rules' upgradeBarn: missing crates first
  const { body } = mount(barnL.barnUpgradesPanel, s, { name: 'barnUpgrades' });
  const btn = body.querySelector('[data-upgrade="barn"]');
  assert.ok(btn && btn.getAttribute('aria-disabled') === 'true', 'one crate short');
  give(s, 'wooden_crate', 4);
  must(s, 'upgradeBarn', {});
  assert.equal(barnL.barnLadderView(s).rungs[8].status, 'done');
  const low = farm(26);
  low.farm.barn = 7;
  assert.equal(barnL.barnLadderView(low).rungs[8].status, 'wait', 'upgrade 8 opens at 27');
});

// ---- the Grand decor showroom --------------------------------------------------------------------------------------

test('grand decor: ten pieces by level, locks, the second copy\'s beauty and the star it would reach', () => {
  const s = farm(26);
  allLand(s);
  const v = grand.grandView(s, { now: T0, pid: 'p1' });
  assert.equal(v.pieces.length, 10);
  assert.deepEqual(v.pieces.map((p) => p.unlock), [...v.pieces.map((p) => p.unlock)].sort((a, b) => a - b));
  assert.equal(v.pieces.find((p) => p.id === 'koi_pond').code, null, 'open at 26');
  assert.equal(v.pieces.find((p) => p.id === 'carousel').code, 'LOCKED');
  const first = v.pieces.find((p) => p.id === 'grand_windmill');
  assert.equal(first.gain, content.decorOf('grand_windmill').beauty10 / 10);
  assert.equal(first.after.score, v.beauty.score + first.gain);
  assert.equal(first.after.stars, M.beauty.starsFor(first.after.score));
  // a placed copy: the next one counts half (GDD §3.8), and the preview says so
  placeDef(s, 'grand_windmill', BIG);
  const w = grand.grandView(s, { now: T0, pid: 'p1' });
  const again = w.pieces.find((p) => p.id === 'grand_windmill');
  assert.equal(again.placed, 1);
  assert.equal(again.gain, Math.floor((content.decorOf('grand_windmill').beauty10 * FARM_BEAUTY.copyBp[1]) / 100_000));
  assert.ok(w.beauty.score > v.beauty.score, 'the placed windmill counts');
  assert.ok(grand.hoursOf(60_000, 20) > 0);
  const { text } = mount(grand.grandDecorPanel, s, { name: 'grandDecor' });
  assert.match(text, /Old Dutch Windmill/);
  assert.match(text, /On the farm/);
});

// ---- the Nursery ---------------------------------------------------------------------------------------------------

function barnyard(level, { adults = 2, babies = 1, species = 'cow', home = 'cow_barn' } = {}) {
  const s = farm(level);
  allLand(s);
  placeDef(s, home, BIG);
  const a = [];
  const b = [];
  for (let i = 0; i < adults; i++) a.push(...evs(must(s, 'buyAnimal', { def: species, adult: true, ...BIG }), 'bought').map((e) => e.id));
  for (let i = 0; i < babies; i++) b.push(...evs(must(s, 'buyAnimal', { def: species, ...BIG }), 'bought').map((e) => e.id));
  give(s, 'baby_bottle', 10);
  return { s, a, b };
}

test('nursery: a baby\'s card, the ten-minute gap, the pick, and the alumni follow the rules', () => {
  const { s, b } = barnyard(30);
  const calf = b[0];
  let v = nurs.nurseryView(s, 'p1', T0);
  assert.equal(v.open, true);
  assert.deepEqual(v.babies.map((x) => x.id), [calf]);
  assert.equal(v.babies[0].next, 'feed');
  assert.equal(v.babies[0].noun, 'calf');
  must(s, 'nurse', { id: calf }, { now: T0 + MIN });
  v = nurs.nurseryView(s, 'p1', T0 + 2 * MIN);
  assert.equal(v.babies[0].n, 1);
  assert.equal(v.babies[0].waiting, true, 'ten minutes before the next step');
  assert.equal(v.babies[0].nextAt, T0 + MIN + NURSERY.stepGapMs);
  assert.equal(run(s, 'nurse', { id: calf }, { now: T0 + 2 * MIN }).code, 'COOLDOWN', 'the panel and the rules agree');
  must(s, 'nurse', { id: calf }, { pid: 'p2', now: T0 + 12 * MIN });
  must(s, 'nurse', { id: calf }, { now: T0 + 23 * MIN });
  v = nurs.nurseryView(s, 'p1', T0 + 24 * MIN);
  assert.equal(v.babies[0].pick, true);
  assert.deepEqual(v.babies[0].carers, ['p1', 'p2']);
  assert.equal(nurs.nurseryBadge(s, 'p1', T0 + 24 * MIN), 1, 'a pick to make');
  const { text } = mount(nurs.nurseryPanel, s, { name: 'nursery', now: T0 + 24 * MIN });
  assert.match(text, /What is .* like\?/);
  must(s, 'nursePick', { id: calf, personality: 'sleepy', specialty: 'tidy' }, { now: T0 + 25 * MIN });
  v = nurs.nurseryView(s, 'p1', T0 + 26 * MIN);
  assert.equal(v.babies.length, 0);
  assert.equal(v.alumni[0].id, calf);
  assert.equal(v.alumni[0].specialty, 'tidy');
  // names live in rules-goals' farm.names
  must(s, 'nameAnimal', { id: calf, name: 'Pudding' }, { now: T0 + 27 * MIN });
  assert.equal(nurs.nurseryView(s, 'p1', T0 + 28 * MIN).alumni[0].name, 'Pudding');
  // closed below its level
  assert.equal(nurs.nurseryView(farm(18), 'p1', T0).open, false);
});

// ---- the Breeding Barn ---------------------------------------------------------------------------------------------

test('breeding: the default pair, the golden countdown, the pen, the cancel and the arrival follow the rules', () => {
  const { s, a } = barnyard(30, { adults: 3, babies: 0 });
  let v = breed.breedingView(s, 'p1', T0);
  assert.equal(v.open, true);
  assert.equal(v.sp.id, 'cow');
  assert.deepEqual([v.a, v.b], [a[0], a[1]], 'the first two adults');
  assert.equal(v.sp.goldenIn, BREEDING.goldenPity, 'no breeding yet: golden by the 20th');
  assert.equal(v.odds.reduce((t, c) => t + c.bp, 0), 10_000);
  // a picked pair is kept; a parent that is not an adult of the species is dropped
  v = breed.breedingView(s, 'p1', T0, { species: 'cow', a: a[2], b: 'nope' });
  assert.deepEqual([v.a, v.b], [a[2], null]);
  must(s, 'breed', { a: a[0], b: a[1] }, { now: T0 + MIN });
  v = breed.breedingView(s, 'p1', T0 + 2 * MIN);
  assert.equal(v.cur.species, 'cow');
  assert.equal(v.cur.ready, false);
  assert.equal(v.cur.readyAt, T0 + MIN + M.breeding.breedMs(s, 'cow', T0 + MIN));
  let r = mount(breed.breedingPanel, s, { name: 'breeding', now: T0 + 2 * MIN });
  assert.match(r.text, /A calf on the way/);
  assert.match(r.text, /Ready in/);
  // cancel gives the bottles back (the panel's confirm button sends breedCancel)
  const bottles = s.farm.inventory.baby_bottle;
  must(s, 'breedCancel', {}, { now: T0 + 3 * MIN });
  assert.equal(s.farm.inventory.baby_bottle, bottles + 2);
  must(s, 'breed', { a: a[0], b: a[2] }, { now: T0 + 4 * MIN });
  const ready = s.farm.breed.cur.readyAt + 1;
  assert.equal(breed.breedingBadge(s, 'p1', ready), '!');
  r = mount(breed.breedingPanel, s, { name: 'breeding', now: ready });
  assert.match(r.text, /Bring it home/);
  const got = must(s, 'breedCollect', { name: 'Daisy' }, { now: ready });
  const born = evs(got, 'bred')[0];
  v = breed.breedingView(s, 'p1', ready + 1);
  assert.equal(v.cur, null);
  assert.equal(v.sp.bred, 1);
  assert.equal(v.sp.goldenIn, born.golden ? BREEDING.goldenPity : BREEDING.goldenPity - 1);
  assert.ok(v.sp.coats.find((c) => c.id === born.coat).found, 'the new coat shows on the farm');
  assert.equal(nurs.nurseryView(s, 'p1', ready + 1).babies[0].name, 'Daisy', 'named on arrival, in the Nursery');
  assert.equal(breed.breedingView(farm(27), 'p1', T0).open, false);
});

// ---- the Fishing Dock ------------------------------------------------------------------------------------------------

test('fishing: the spot, the hourly rest, the line in the water, the records and the week\'s biggest', () => {
  const s = farm(30);
  allLand(s);
  let v = fish.fishingView(s, 'p1', T0);
  assert.equal(v.live, true);
  assert.deepEqual(v.spots.map((x) => x.name), ['Willow Pond']);
  assert.equal(v.me.ready, true);
  assert.equal(fish.fishingBadge(s, 'p1', T0), '!');
  must(s, 'cast', { pond: 'willow_pond' }, { now: T0 });
  v = fish.fishingView(s, 'p1', T0 + 1000);
  assert.equal(v.me.line.spot, 'willow_pond');
  const bite = s.players.p1.fish.cast.bite;
  const caught = evs(must(s, 'reel', {}, { now: bite }), 'fishCaught')[0];
  v = fish.fishingView(s, 'p1', bite + 1000);
  assert.equal(v.me.line, null);
  assert.equal(v.me.ready, false);
  assert.equal(v.me.nextAt, bite + FISHING.cooldownMs);
  assert.equal(v.total, 1);
  assert.equal(v.board.find((x) => x.id === caught.fish).record.cm, caught.cm);
  assert.equal(v.best.fish, caught.fish);
  assert.equal(run(s, 'cast', { pond: 'willow_pond' }, { now: bite + 2000 }).code, 'COOLDOWN', 'the board and the rules agree');
  const { text } = mount(fish.fishingPanel, s, { name: 'fishing', now: bite + 2000 });
  assert.match(text, /Your next cast in/);
  assert.match(text, /trophy board/);
  assert.equal(fish.spotOfKey('willow_pond').pond, 'willow_pond');
  assert.equal(fish.fishingView(farm(20), 'p1', T0).live, false);
});

// ---- the farmhouse ---------------------------------------------------------------------------------------------------

/** The first spot of the room where `def` fits now (the rules' own furnishCode), scanning rows then walls. */
function freeSpot(s, def, ignore = null) {
  const [gw, gd] = INTERIOR.grid;
  if (def.layer === 'wall') {
    for (const wall of ['back', 'left']) for (let at = 0; at < INTERIOR.walls[wall]; at++) {
      if (M.interior.furnishCode(s, def, { wall, at }, ignore) === null) return { wall, at };
    }
    return null;
  }
  for (let z = 0; z < gd; z++) for (let x = 0; x < gw; x++) {
    if (M.interior.furnishCode(s, def, { x, z, rot: 0 }, ignore) === null) return { x, z, rot: 0 };
  }
  return null;
}

function openRoom(level = 36) {
  const s = farm(level);
  allLand(s);
  for (const p of CONTENT.restoration.values()) done(s, p.id);
  INTERIOR.fixed.forEach((f, i) => {
    s.farm.interior.items[`fx.${i}`] = { def: f.def, by: 'sys', placedAt: T0 - HOUR, ...(f.wall !== undefined ? { wall: f.wall, at: f.at } : { x: f.x, z: f.z, rot: f.rot ?? 0 }) };
  });
  return s;
}

test('farmhouse room: locked before Restoration 6, then the catalog, the ghost and the moves are the rules\' own', () => {
  const locked = farm(36);
  let v = house.roomView(locked, 'p1', T0);
  assert.equal(v.open, false);
  assert.equal(v.items.length, INTERIOR.fixed.length, 'a preview of the room\'s own pieces');
  assert.ok(v.catalog.every((c) => c.code === 'LOCKED'));
  const s = openRoom();
  v = house.roomView(s, 'p1', T0);
  assert.equal(v.open, true);
  const sofa = content.furnitureOf('sofa');
  // the ghost asks the rules: a free spot is fine, the door's keep-clear tiles are not, a wall piece needs a wall
  const spot = freeSpot(s, sofa);
  assert.ok(spot, 'the room has room for a sofa');
  assert.equal(house.spotCode(s, sofa, spot), null);
  const [kx, kz] = INTERIOR.keepClear[0];
  assert.equal(house.spotCode(s, sofa, { x: kx, z: kz, rot: 0 }), 'BLOCKED', 'the door\'s keep-clear tiles');
  assert.equal(house.spotCode(s, sofa, { x: INTERIOR.grid[0] - 1, z: INTERIOR.grid[1] - 1, rot: 0 }), 'OUT_OF_BOUNDS');
  must(s, 'furnish', { def: 'sofa', ...spot, ...BIG }, { now: T0 });
  v = house.roomView(s, 'p1', T0 + MIN);
  const placed = v.items.find((i) => i.def.id === 'sofa');
  assert.ok(placed.refundUntil > T0, 'ten minutes to undo the purchase');
  assert.equal(v.catalog.find((c) => c.id === 'sofa').code, 'CAP', 'one sofa (max 1)');
  assert.equal(house.spotCode(s, sofa, spot), 'OCCUPIED');
  assert.equal(house.spotCode(s, sofa, spot, placed.id), null, 'a piece never blocks itself');
  must(s, 'furnishStore', { id: placed.id }, { now: T0 + 2 * MIN });
  v = house.roomView(s, 'p1', T0 + 3 * MIN);
  assert.equal(v.tray.find((c) => c.id === 'sofa').fromTray, true);
  // fixed pieces never leave; the duet table may move
  const fixed = v.items.filter((i) => i.fixed);
  assert.ok(fixed.some((i) => i.def.id === 'duet_table' && i.movable));
  assert.ok(fixed.filter((i) => i.def.id !== 'duet_table').every((i) => !i.movable));
  const { text } = mount(house.farmhousePanel, s, { name: 'farmhouse', tab: 'room', args: { tab: 'room' } });
  assert.match(text, /The catalog/);
  assert.match(text, /In your room's tray/);
});

test('farmhouse: Restoration 4-6 rows, Grandma before, during and after her visit', () => {
  const s = farm(36);
  allLand(s);
  for (const id of ['greenhouse', 'mill_wheel', 'stone_bridge', 'orchard_pond']) done(s, id);
  const rows = house.restoreView(s, 'p1');
  assert.deepEqual(rows.map((p) => p.id), ['orchard_pond', 'fair_grounds', 'farmhouse']);
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[1].status, 'open');
  assert.equal(rows[2].status, 'locked');
  let v = house.visitView(s, 'p1', T0);
  assert.equal(v.phase, 'coming');
  s.farm.grandma = { at: T0, until: T0 + GRANDMA_VISIT.stayMs, met: { p2: 1 }, left: false, gift: null };
  v = house.visitView(s, 'p1', T0 + 90 * MIN);
  assert.equal(v.phase, 'here');
  assert.equal(v.stop, GRANDMA_VISIT.stops[1], 'one stop every strollMs');
  assert.ok(GRANDMA_VISIT.lines[v.stop].includes(v.line));
  assert.equal(v.metMe, false);
  assert.equal(house.farmhouseBadge(s, 'p1', T0 + 90 * MIN), '!');
  assert.equal(house.defaultTab(house.farmhouseView(s, 'p1', T0 + 90 * MIN)), 'grandma');
  let r = mount(house.farmhousePanel, s, { name: 'farmhouse', tab: 'grandma', args: { tab: 'grandma' }, now: T0 + 90 * MIN });
  assert.match(r.text, /Grandma is on the farm, by the fields/);
  s.farm.grandma = { ...s.farm.grandma, left: true };
  s.farm.interior.tray.hazel_portrait = 1;
  v = house.visitView(s, 'p1', T0 + GRANDMA_VISIT.stayMs + HOUR);
  assert.equal(v.phase, 'gone');
  assert.equal(v.missed, true, 'p1 never met her');
  assert.equal(v.gift.inTray, true);
  r = mount(house.farmhousePanel, s, { name: 'farmhouse', tab: 'grandma', args: { tab: 'grandma' }, now: T0 + GRANDMA_VISIT.stayMs + HOUR });
  assert.match(r.text, /My dears/);
  assert.match(r.text, /Hang it in the room/);
  r = mount(house.farmhousePanel, s, { name: 'farmhouse', tab: 'restore', args: { tab: 'restore' } });
  assert.match(r.text, /Orchard Pond/);
  assert.match(r.text, /Give in the Ledger/);
});

// ---- the hub, the art, the stylesheet ----------------------------------------------------------------------------------

test('hub: the minis show only while their systems are open; badges are the panels\' own', () => {
  const young = farm(18);
  assert.deepEqual(home.homeDocks(young, T0), { farmhouse: false, nursery: false, breeding: false, fishing: false });
  const s = farm(30);
  allLand(s);
  const d = home.homeDocks(s, T0);
  assert.deepEqual(d, { farmhouse: true, nursery: false, breeding: true, fishing: true });
  assert.equal(home.homeDocks(farm(24), T0).nursery, true, 'the Nursery mini until the Breeding Barn takes over');
  const b = home.homeBadges(s, 'p1', T0);
  assert.equal(b.fishing.v, '!');
  assert.equal(b.farmhouse.v, null);
  // registering is idempotent and never replaces another lane's panel
  const names = new Set(['nursery']);
  const reg = [];
  const ui = { panels: { has: (n) => names.has(n), register: (n) => { reg.push(n); names.add(n); return () => names.delete(n); }, badge: () => {} } };
  const off = home.default(ui, { store: null });
  assert.equal(home.default(ui, { store: null }), off);
  assert.deepEqual(reg.sort(), ['barnUpgrades', 'breeding', 'farmhouse', 'fishing', 'grandDecor', 'landmap']);
  off();
});

test('art: every piece, coat, fish and scene draws without a stray text node; the barn grows a part an upgrade', () => {
  for (const d of CONTENT.furniture.values()) {
    const svg = art.furnitureArt(d, { px: 64 });
    assert.ok(svg.children.length > 0, d.id);
    noJunk(svg.textContent);
  }
  for (let n = 0; n <= 10; n++) {
    const svg = art.barnArt(n, { capacity: content.barnCapacity(n) });
    assert.equal(svg.querySelectorAll('.ha-part').length, n, `upgrade ${n}`);
    assert.equal(svg.textContent, content.barnCapacity(n).toLocaleString('en-US'));
  }
  for (const c of [...BREEDING.coats.map((x) => x.id)]) { noJunk(art.coatSwatch(c).textContent); assert.equal(art.coatSwatch(c, { found: false }).textContent, '?'); }
  for (const f of FISHING.fish) noJunk(art.fishArt(f.id, f.hue).textContent);
  for (const id of ['orchard_pond', 'fair_grounds', 'farmhouse']) {
    assert.ok(art.homeScene(id, new Set()));
    assert.equal(art.homeScene(id, new Set(CONTENT.restoration.get(id).bundles.map((b) => b.id))).textContent, '');
  }
  assert.equal(art.homeScene('greenhouse', new Set()), null);
  noJunk(art.pondScene({ seats: [{ color: '#2BB3A3', mark: 'K', line: true }] }).textContent);
});

test('panels-home.css: no text under 13 px (map labels are in map units), and every phone rule sits in the phone query', () => {
  const css = fs.readFileSync(new URL('../public/css/panels-home.css', import.meta.url), 'utf8');
  const size = /font:\s*(?:\d{3}\s+)?(?:italic\s+)?([\d.]+)(rem|px)|font-size:\s*([\d.]+)(rem|px)/g;
  const small = [];
  css.split('\n').forEach((line, i) => {
    if (/\.ha-(tag|label|sign-text)/.test(line)) return;          // SVG text in tile units (1 tile = 2 m), not CSS px
    for (const m of line.matchAll(size)) {
      const px = Number(m[1] ?? m[3]) * ((m[2] ?? m[4]) === 'rem' ? 16 : 1);
      if (px < 13) small.push(`panels-home.css:${i + 1} ${px}px`);
    }
  });
  assert.deepEqual(small, []);
  assert.ok(css.includes('@media (max-width: 600px), (max-height: 500px) {'), 'the phone query of layout.js');
});

test('a fixture farm with every M2 home system validates (the shapes the panels read are the rules\' own)', () => {
  const s = openRoom(38);
  for (const id of ['braided_rug', 'valley_painting', 'armchair']) {
    const def = content.furnitureOf(id);
    must(s, 'furnish', { def: id, ...freeSpot(s, def), ...BIG }, { now: T0 });
  }
  assert.deepEqual(validateState(s), []);
  void restoration;
});

test('banners: the partner\'s new baby, a record fish, Grandma\'s coming and going and the room opening', () => {
  const s = farm(38);
  let b = home.homeBannerOf(s, { e: 'bred', id: 'x1', species: 'cow', coat: 'golden', golden: true, by: 'p2', name: 'Daisy' }, 'p1');
  assert.equal(b.message, 'Mia brought home Daisy, a golden calf.');
  assert.deepEqual(b.panel, ['nursery', { id: 'x1' }]);
  assert.equal(home.homeBannerOf(s, { e: 'bred', id: 'x1', species: 'cow', coat: 'white', by: 'p1' }, 'p1'), null, 'my own baby: the panel shows it');
  b = home.homeBannerOf(s, { e: 'fishCaught', fish: 'pike', cm: 96, record: true, by: 'p2' }, 'p1');
  assert.match(b.message, /Mia landed a 96 cm Pike/);
  assert.equal(home.homeBannerOf(s, { e: 'fishCaught', fish: 'pike', cm: 50, record: false, by: 'p2' }, 'p1'), null);
  assert.equal(home.homeBannerOf(s, { e: 'fishCaught', fish: 'old_boot', cm: 28, record: true, joke: true, by: 'p2' }, 'p1'), null);
  assert.deepEqual(home.homeBannerOf(s, { e: 'grandmaArrived', until: T0, by: 'p1' }, 'p1').panel, ['farmhouse', { tab: 'grandma' }]);
  assert.equal(home.homeBannerOf(s, { e: 'interiorOpened', items: [], by: 'p2' }, 'p1').panel[1].tab, 'room');
  assert.equal(home.homeBannerOf(s, { e: 'harvested', by: 'p2' }, 'p1'), null);
});

test('farmhouse: the Goal Tracker\'s { grandma: true } opens the Grandma tab', () => {
  const s = farm(38);
  s.farm.grandma = { at: T0, until: T0 + GRANDMA_VISIT.stayMs, met: {}, left: false, gift: null };
  const r = mount(house.farmhousePanel, s, { name: 'farmhouse', tab: 'room', args: { grandma: true }, now: T0 + MIN });
  assert.match(r.text, /Grandma is on the farm/);
});
