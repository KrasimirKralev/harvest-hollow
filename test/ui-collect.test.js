// ui-collect: the M1b long-term panels' view models (public/js/ui/panels/{collections,restoration,beauty,decor-sets,
// ribbon-wall,animals-m1b}.js) on farms the rules accept (validateState). Every number a panel shows must be the
// rules' own number: the tests compare the views with the rules' helpers, so a rule change can never leave a panel
// saying something else. They pass in the M1a build and after the content lane's flip to M1b.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFarm, T0 } from './helpers.js';
import {
  CONTENT, COLLECTION_RULES, FARM_BEAUTY, MASTERWORK, RIBBON_WALL, RIBBON_REWARDS, xpForLevel, eHours, defOf, isLive,
} from '../shared/content/index.js';
import { canPlace } from '../shared/rules/grid.js';
import { resetGrid } from '../shared/rules/grid-cache.js';
import { validateState } from '../shared/rules/state.js';
import { ACTIONS } from '../shared/rules/index.js';
import { Tx } from '../shared/rules/tx.js';
import { parseArgs } from '../shared/rules/schema.js';
import { forceLiveForTests } from '../shared/rules/coop.js';
import * as albumA from '../shared/rules/actions/album.js';
import * as restoreA from '../shared/rules/actions/restoration.js';
import * as beautyA from '../shared/rules/actions/beauty.js';
import * as animalsA from '../shared/rules/actions/animals.js';
import { ribbonPoints } from '../shared/rules/actions/ribbons.js';
import { FARM_MIN, FARM_MAX } from '../shared/content/config.js';
import { albumView, findText, stickerArt, FOUND_BY, setState,
  COLLECT_PANELS } from '../public/js/ui/panels/collections.js';
import { ledgerView, restoreText } from '../public/js/ui/panels/restoration.js';
import { beautyView } from '../public/js/ui/panels/beauty.js';
import { setsView, masterworkView, mwGroups, setOfDecor } from '../public/js/ui/panels/decor-sets.js';
import { wallView } from '../public/js/ui/panels/ribbon-wall.js';
import { homeExtras, forageNear, horseBonus, giantText, featureTarget,
  unlocksOfLevel } from '../public/js/ui/panels/animals-m1b.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = T0 + 3 * HOUR;

/** A joined farm at `level` with every expansion's land (M1a and M1b), for big M1b footprints. */
function farm(level = 25) {
  const s = makeFarm();
  s.farm.xp = xpForLevel(level);
  s.farm.wallet.coins = 2_000_000;
  const more = [...CONTENT.expansions.values()].filter((e) => (e.k ?? 0) > 0 && (e.k ?? 0) <= 6).map((e) => e.id);
  s.farm.expansions = [...new Set([...s.farm.expansions, ...more])];
  resetGrid(s);
  return s;
}

let seq = 0;
/** Put an object straight into the state (any milestone's def: validateState knows them all), near `near`. */
function put(s, def, near, extra = {}) {
  const [x0, z0] = near ?? [FARM_MIN, FARM_MIN];
  for (let r = 0; r < 40; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = x0 + dx;
        const z = z0 + dz;
        if (x < FARM_MIN || z < FARM_MIN || x >= FARM_MAX || z >= FARM_MAX || canPlace(s, def, x, z,
          0) !== null) continue;
        const id = `t${(++seq).toString(36)}`;
        s.farm.objects[id] = { def, x, z, rot: 0, placedAt: T0, by: 'p1', ...extra };
        resetGrid(s);
        return id;
      }
    }
  }
  throw new Error(`no spot for ${def}`);
}

/** An animal living in `home` (fed at `fedAt`, ready `cycleMs` later). */
function animal(s, def, home, { fedAt = T0, adultAt = T0, by = 'p1', free } = {}) {
  const id = `a${(++seq).toString(36)}`;
  const d = defOf(def);
  s.farm.objects[id] = { def, home, placedAt: T0, by, adultAt, fedAt,
    readyAt: fedAt === null ? null : fedAt + d.cycleMs, cycle: 0, cut: 0,
    ...(free ? { free: true } : {}) };
  return id;
}

const COLLECTIONS_SOURCE = fs.readFileSync(new URL('../public/js/ui/panels/collections.js', import.meta.url), 'utf8');
const valid = (s) => assert.deepEqual(validateState(s), [], 'the fixture farm is a state the rules accept');

// ---- the album ------------------------------------------------------------------------------------------------------

test('album: every playing set with the rules\' finds, spares, pity and completion; nothing invented', () => {
  const sets = [...CONTENT.collections.values()].filter((c) => c.m === 'M1b');
  forceLiveForTests(sets);
  try {
    const s = farm(12);
    s.farm.album.sets.butterflies = { r: 50, pity: 31,
      items: { cabbage_white: { by: 'p2', at: T0, n: 3 }, monarch: { by: 'p1', at: T0 + MIN, n: 1 },
        peacock_butterfly: { by: 'p1', at: T0, n: 2 } }, done: null };
    s.farm.album.sets.lost_tools = { r: 90, pity: 0,
      items: Object.fromEntries(collectionOfSet('lost_tools').items.map((i) => [i.id, { by: 'p2', at: T0, n: 1 }])),
        done: T0 + HOUR };
    valid(s);
    const v = albumView(s, 'p1');
    assert.equal(v.sets.length, albumA.liveSets().length);
    assert.equal(v.open, albumA.albumUnlocked(s));
    for (const set of v.sets) {
      const def = CONTENT.collections.get(set.id);
      assert.equal(set.total, def.items.length);
      assert.equal(set.found, def.items.length - albumA.missingOf(s, def).length, `${set.id} found`);
      assert.equal(set.spares, albumA.dupesOf(s, def), `${set.id} spares`);
      assert.equal(set.canTrade, set.spares >= COLLECTION_RULES.tradeIn && set.missing.length > 0);
      assert.ok(set.pityLeft >= 1 && set.pityLeft <= COLLECTION_RULES.pity + 1);
      assert.ok(FOUND_BY[set.id], `${set.id} says how its items are found`);
      assert.doesNotMatch(`${set.how} ${set.noun} ${set.perkText} ${set.displayName}`, /undefined|null|_/);
    }
    const b = v.sets.find((x) => x.id === 'butterflies');
    assert.equal(b.found, 3);
    assert.equal(b.spares, 3, 'two extra Cabbage Whites and one extra Peacock');
    assert.equal(b.canTrade, true);
    assert.equal(b.pityLeft, COLLECTION_RULES.pity - 31 + 1, 'the roll after `pity` misses is the certain one');
    assert.deepEqual(b.items.find((i) => i.id === 'cabbage_white'),
      { id: 'cabbage_white', name: 'Cabbage White', found: true, by: 'p2', at: T0, dup: 2 });
    assert.equal(b.mine, 2, 'Rowan found two of them');
    const t = v.sets.find((x) => x.id === 'lost_tools');
    assert.equal(t.done, true);
    assert.equal(t.found, 5);
    assert.equal(v.setsDone, 1);
    // the trade the panel offers is exactly what the rules accept
    const args = { set: 'butterflies', want: b.missing[0] };
    assert.ok(parseArgs(ACTIONS.albumTrade.schema, args), 'the trade args parse');
    assert.equal(ACTIONS.albumTrade.check(s, parseArgs(ACTIONS.albumTrade.schema, args), {}), null);
  } finally { forceLiveForTests(sets, false); }
});

const collectionOfSet = (id) => CONTENT.collections.get(id);

test('album: "certain within N" is exactly when the rules\' pity hands out the next find', () => {
  const sets = [...CONTENT.collections.values()].filter((c) => c.m === 'M1b');
  forceLiveForTests(sets);
  try {
    for (const start of [0, 12, 39, 40]) {
      const s = farm(12);
      s.farm.album.sets.feathers = { r: start, pity: start, items: { speckled_feather: { by: 'p1', at: T0, n: 1 } }, done: null };
      const promised = albumView(s, 'p1').sets.find((x) => x.id === 'feathers').pityLeft;
      // roll with the rules until a new feather turns up; the dice never favour us (no lucky 2 % roll)
      let rolls = 0;
      while (Object.keys(s.farm.album.sets.feathers.items).length === 1 && rolls < 100) {
        const tx = new Tx(s);
        albumA.albumRoll(tx, { now: T0, pid: 'p1', rng: () => 0.999 }, null, ['collect:chicken'], 'p1');
        rolls++;
      }
      assert.equal(rolls, promised, `pity ${start}: the find comes on roll ${rolls}, the album promised ${promised}`);
    }
  } finally { forceLiveForTests(sets, false); }
});

test('album: find banners name the finder, the set and its count; a completing find leaves it to the set banner',
  () => {
  const sets = [...CONTENT.collections.values()].filter((c) => c.m === 'M1b');
  forceLiveForTests(sets);
  try {
    const s = farm(12);
    s.farm.album.sets.feathers = { r: 5, pity: 0,
      items: { speckled_feather: { by: 'p2', at: T0, n: 1 }, barred_feather: { by: 'p1', at: T0, n: 2 } }, done: null };
    const t = findText(s,
      { e: 'albumFind', set: 'feathers', item: 'barred_feather', dup: false, how: 'roll', by: 'p2' }, 'p1');
    assert.equal(t.title, 'Album find!');
    assert.match(t.text, /^Mia found the Barred Feather\. Feathers: 2 of 5\.$/);
    assert.match(findText(s,
      { e: 'albumFind', set: 'feathers', item: 'barred_feather', dup: true, how: 'roll', by: 'p1' }, 'p1').text,
        /^You found another Barred Feather/);
    assert.match(findText(s,
      { e: 'albumFind', set: 'feathers', item: 'barred_feather', dup: false, how: 'trade', by: 'p1' }, 'p1').text,
        /traded 3 spares/);
    s.farm.album.sets.feathers.done = T0 + MIN;
    assert.equal(findText(s,
      { e: 'albumFind', set: 'feathers', item: 'barred_feather', dup: false, how: 'roll', by: 'p1' }, 'p1'), null);
    assert.equal(findText(s, { e: 'albumFind', set: 'nope', item: 'x', by: 'p1' }, 'p1'), null);
    assert.deepEqual(setState(s, 'nope'), { items: {}, pity: 0, done: null });
  } finally { forceLiveForTests(sets, false); }
});

test('album: every item of every M1b set has its own drawn sticker (never the blank medallion)', () => {
  for (const set of CONTENT.collections.values()) {
    if (set.m !== 'M1b') continue;
    for (const it of set.items) assert.ok(COLLECTIONS_SOURCE.includes(`  ${it.id}: (`),
      `${set.id}.${it.id} has a sticker drawing`);
  }
  assert.equal(typeof stickerArt, 'function');
});

// ---- the Restoration Ledger ---------------------------------------------------------------------------------------------

test('ledger: slots, donors and bundles come from the rules (slotNeed / slotHave / bundleDone); a done bundle\'s rest is "not needed"', () => {
  const projects = [...CONTENT.restoration.values()].filter((p) => p.m === 'M1b').sort((a, b) => a.n - b.n);
  const s = farm(20);
  s.farm.inventory.wheat = 12;
  s.farm.restore = {
    greenhouse: { s: { glass: { 0: { n: 12, by: { p1: 7, p2: 5 } }, 1: { n: 2, by: { p2: 2 } },
      2: { n: eHours(16, 5000), by: { p1: eHours(16, 5000) } } },
      seedlings: { 0: { n: 9, by: { p1: 9 } } } }, b: { glass: T0 + MIN } },
  };
  valid(s);
  const v = ledgerView(s, 'p1', { projects });
  assert.deepEqual(v.projects.map((p) => p.id), projects.map((p) => p.id));
  const gh = v.projects[0];
  for (const [bi, b] of gh.bundles.entries()) {
    const def = projects[0].bundles[bi];
    assert.equal(b.done, restoreA.bundleDone(s, 'greenhouse', def.id));
    b.slots.forEach((sl, i) => {
      const need = restoreA.slotNeed(projects[0], def.slots[i]);
      assert.equal(sl.qty, need.need, `${def.id}.${i} need`);
      assert.equal(sl.kind, need.kind);
      assert.equal(sl.n, restoreA.slotHave(s, 'greenhouse', def.id, i));
    });
  }
  const glass = gh.bundles.find((b) => b.id === 'glass');
  assert.equal(glass.done, true);
  assert.equal(glass.slots[2].kind, 'coins');
  assert.equal(glass.slots[2].qty, eHours(16, 5000), 'the coin slot is E(16) x 0.5 h (GDD §5.9)');
  assert.deepEqual(glass.slots[0].by, { p1: 7, p2: 5 }, 'who gave what');
  const seed = gh.bundles.find((b) => b.id === 'seedlings');
  assert.equal(seed.slots[0].n, 9);
  assert.equal(seed.slots[0].have, 12, 'what the Barn holds for the slot');
  assert.equal(seed.toGo, seed.need, 'no slot of Seedlings is full yet');
  assert.ok(seed.nextSlots.includes(0), 'the slot closest to full is suggested first');
  assert.equal(gh.stage, 1);
  assert.deepEqual(gh.donors, { p1: 16, p2: 7 }, 'goods given (coins are not counted as pieces)');
  // the open project is the rules' openProject (null in a build where restoration does not play)
  const open = restoreA.openProject(s);
  assert.equal(gh.open, Boolean(open && open.id === 'greenhouse'));
  if (!gh.open) assert.match(gh.lockReason, /Opens|Not open/);
  const mill = v.projects[1];
  assert.equal(mill.open, false);
  assert.match(mill.lockReason, /Opens when the Old Greenhouse is restored|Opens at level|Not open yet/);
  // the donate action takes exactly the args the panel sends
  assert.deepEqual(Object.keys(ACTIONS.donate.schema).sort(), ['bundle', 'project', 'qty', 'slot']);
});

test('ledger: banners for a bundle and a project read the rules\' event fields', () => {
  const s = farm(20);
  s.farm.restore = { greenhouse: { s: {}, b: { glass: T0 } } };
  const t = restoreText(s,
    { e: 'bundleDone', project: 'greenhouse', bundle: 'glass', by: 'p2',
      back: [{ item: 'wheat', qty: 12 }, { coins: 300 }] }, 'p1');
  assert.equal(t.ribbon, 'Bundle done!');
  assert.match(t.message,
    /^Mia finished Glass & Frames for the Old Greenhouse: 1 of 4 bundles\. 12 Wheat and 300 coins went back to the barn\.$/);
  s.farm.restore.greenhouse.b = Object.fromEntries(CONTENT.restoration.get('greenhouse').bundles.map((b) => [b.id,
    T0]));
  assert.equal(restoreText(s, { e: 'bundleDone', project: 'greenhouse', bundle: 'glass', by: 'p2', back: [] }, 'p1'),
    null, 'the last bundle: the project banner follows');
  assert.equal(restoreText(s, { e: 'projectDone', project: 'greenhouse', by: 'p1' }, 'p1').ribbon, 'Restored!');
});

// ---- Farm Beauty ---------------------------------------------------------------------------------------------------------

test('beauty: the panel shows the rules\' beautyOf (score, stars, next) and when a fresh piece settles', () => {
  const s = farm(20);
  for (const d of ['fountain', 'stone_well', 'rose_arch', 'flower_bed', 'flower_bed', 'flower_bed']) put(s, d,
    [30, 30]);
  put(s, 'bench_swing', [36, 36], { rcpt: { coins: 1600, acorns: 0, until: NOW + 6 * MIN } });
  valid(s);
  const v = beautyView(s, NOW);
  const b = beautyA.beautyOf(s, NOW);
  assert.equal(v.score, b.score);
  assert.equal(v.stars, b.stars);
  assert.equal(v.next, b.next);
  assert.deepEqual(v.parts, b.parts);
  assert.equal(v.settledStars, beautyA.beautyOf(s, NOW, { settledOnly: true }).stars);
  assert.equal(v.open, beautyA.beautyLive(s));
  assert.equal(v.orderBonusPct, v.open ? beautyA.beautyOrderBp(s, NOW) / 100 : 0);
  if (v.settledStars < v.stars) assert.equal(v.settleIn, 6 * MIN, 'the porch swing settles in 6 minutes');
  assert.ok(v.pct >= 0 && v.pct <= 1 && v.track >= 0 && v.track <= 1);
  // the prettiest pieces are the rules' per-piece values (tenths), most beautiful first
  const top = Object.entries(b.byId).sort(([, x], [, y]) => y - x)[0];
  assert.equal(v.top[0].value, top[1] / 10);
  for (const i of v.ideas) assert.doesNotMatch(i.text, /undefined|NaN|null/);
  assert.equal(v.thresholds.join(), FARM_BEAUTY.stars.join());
});

// ---- decor sets and Masterwork -----------------------------------------------------------------------------------------

test('sets: a group the rules count complete is "complete"; all pieces placed apart is "spread"; one dot per piece',
  () => {
  const sets = [...CONTENT.decorSets.values()].filter((x) => x.m === 'M1b');
  const s = farm(20);
  const cottage = CONTENT.decorSets.get('cottage_garden');
  for (const d of cottage.pieces) put(s, d, [24, 24]);
  const fair = CONTENT.decorSets.get('harvest_fair');
  fair.pieces.forEach((d, i) => put(s, d, [10 + i * 9, 50]));
  valid(s);
  const v = setsView(s, NOW, { sets });
  const groups = beautyA.beautyOf(s, NOW).groups;
  const c = v.sets.find((x) => x.id === 'cottage_garden');
  assert.equal(c.complete, groups.some((g) => g.set === 'cottage_garden'));
  if (isLive(cottage)) assert.equal(c.status, 'complete');
  assert.equal(c.pieces.length, cottage.pieces.length);
  for (const p of c.pieces) assert.ok(p.dot, `${p.def} has a dot on the plan`);
  const f = v.sets.find((x) => x.id === 'harvest_fair');
  assert.equal(f.status, isLive(fair) ? 'spread' : 'started', 'every piece placed, too far apart (once sets count)');
  assert.equal(f.complete, false);
  // a piece that is not on the farm says how to get it
  const w = v.sets.find((x) => x.id === 'winter_lights');
  for (const p of w.pieces) assert.doesNotMatch(p.source.text, /undefined|null/);
  assert.deepEqual(setOfDecor('rose_arch').map((x) => x.id),
    [...CONTENT.decorSets.values()].filter((x) => isLive(x) && x.pieces.includes('rose_arch')).map((x) => x.id));
});

test('masterwork: prices and levels are the rules\' masterworkPrice; copies group by kind, upgraded first', () => {
  const s = farm(20);
  const a = put(s, 'fountain', [30, 30], { mw: 1 });
  const b = put(s, 'flower_bed', [34, 34]);
  const c = put(s, 'flower_bed', [36, 34], { mw: 2 });
  put(s, 'golden_scarecrow', [40, 40]);
  valid(s);
  const v = masterworkView(s);
  for (const id of [a, b, c]) assert.ok(v.rows.some((r) => r.id === id), `${id} is listed`);
  for (const r of v.rows) assert.ok(defOf(r.def).tier === 'coin' && defOf(r.def).cost > 0, `${r.def}: coin decor only`);
  assert.ok(!v.rows.some((r) => r.def === 'golden_scarecrow'), 'Acorn decor has no Masterwork');
  for (const r of v.rows) {
    const p = beautyA.masterworkPrice(s, s.farm.objects[r.id]);
    if (r.mw < MASTERWORK.priceMul.length) {
      assert.equal(r.next.level, r.mw + 1);
      if (!p.code) assert.equal(r.next.coins, p.coins);
      else assert.equal(r.next.coins, defOf(r.def).cost * MASTERWORK.priceMul[r.mw]);
    } else assert.equal(r.next, null);
  }
  const fountain = v.rows.find((r) => r.id === a);
  assert.equal(fountain.beauty, (defOf('fountain').beauty10 * MASTERWORK.beautyBp[0]) / 100_000);
  const g = mwGroups(v.rows);
  assert.equal(g[0].def, 'fountain', 'the most beautiful kind first');
  const beds = g.find((x) => x.def === 'flower_bed');
  assert.deepEqual(beds.copies.map((r) => r.id).slice(0, 2), [c, b], 'Grand Masterwork copy first');
  assert.deepEqual(g.map((x) => x.best), g.map((x) => x.best).slice().sort((x, y) => y - x), 'kinds by beauty');
  assert.ok(parseArgs(ACTIONS.masterwork.schema, { id: a, max: fountain.next.coins }), 'the upgrade args parse');
});

// ---- the Ribbon Wall ---------------------------------------------------------------------------------------------------

test('wall: Ribbon Points are the rules\', tiers open at 10 / 25 / 60 / 120, rosettes pinned until the frames', () => {
  const s = makeFarm();
  s.farm.ribbons = { cream_of_the_crop: { t: 1, at: T0 }, rainbow_harvest: { t: 2, at: T0 } };
  s.players.p1.ribbons = { green_thumb: { t: 1, at: T0 } };
  valid(s);
  let v = wallView(s, 'p1');
  assert.equal(v.points, ribbonPoints(s));
  assert.equal(v.points, RIBBON_REWARDS.F[0].points + RIBBON_REWARDS.F[0].points + RIBBON_REWARDS.F[1].points);
  assert.equal(v.framed, false, 'pinned before the frames tier');
  assert.equal(v.next.points, RIBBON_WALL[0].points);
  assert.equal(v.toNext, RIBBON_WALL[0].points - v.points);
  assert.deepEqual(v.shared.map((f) => f.id), ['rainbow_harvest', 'cream_of_the_crop'], 'higher tiers first');
  assert.deepEqual(v.personal.find((p) => p.pid === 'p1').frames.map((f) => f.id), ['green_thumb']);
  assert.equal(v.personal.find((p) => p.pid === 'p2').frames.length, 0);
  assert.ok(v.track > 0 && v.track < 1 / RIBBON_WALL.length);
  for (const c of v.closest) assert.ok(c.value < c.need, 'a tier already reached is never "closest next"');
  // enough points for every tier
  s.farm.ribbons = Object.fromEntries([...CONTENT.ribbons.values()].filter((r) => r.scope !== 'P' && !r.hidden && isLive(r)).slice(0, 30)
    .map((r) => [r.id, { t: r.tiers.length, at: T0 }]));
  v = wallView(s, 'p1');
  assert.ok(v.points >= RIBBON_WALL.at(-1).points);
  assert.deepEqual(v.tiers.map((t) => t.open), RIBBON_WALL.map(() => true));
  assert.equal(v.track, 1);
  assert.equal(v.next, null);
});

// ---- the M1b animals --------------------------------------------------------------------------------------------------

test('animals: hive forage, colony cycle and pollination are the rules\'; the horse bonus is horseBargeBp', () => {
  const s = farm(25);
  const hive = put(s, 'beehive', [20, 40]);
  animal(s, 'bee', hive, { free: true });
  for (let i = 0; i < 2; i++) put(s, 'flower_bed', [21, 41]);
  valid(s);
  let f = forageNear(s, hive);
  assert.equal(f.n, animalsA.forageNear(s, hive));
  assert.equal(f.fast, f.n >= f.need);
  assert.equal(f.cycleMs, animalsA.colonyCycleMs(s, hive, defOf('bee')));
  assert.equal(f.sources.reduce((n, x) => n + x.n, 0) >= f.n - 3 * 0, true);
  put(s, 'wheelbarrow', [21, 41]);
  f = forageNear(s, hive);
  assert.equal(f.n, animalsA.forageNear(s, hive));
  const x = homeExtras(s, hive, NOW);
  assert.equal(x.kind, 'bee');
  assert.ok(x.hiveCap >= 2 && x.hives === 1);
  const stable = put(s, 'stable', [30, 50]);
  animal(s, 'horse', stable);
  animal(s, 'horse', stable, { adultAt: NOW + HOUR, fedAt: null });
  valid(s);
  const hb = horseBonus(s, NOW);
  assert.equal(hb.pct, animalsA.horseBargeBp(s, NOW) / 100);
  assert.equal(hb.adults, 1, 'a foal does not pull the cart');
  const pen = put(s, 'pig_pen', [44, 30]);
  animal(s, 'pig', pen);
  const px = homeExtras(s, pen, NOW);
  assert.equal(px.kind, 'pig');
  assert.equal(px.feed, 'pig_slop');
  assert.equal(homeExtras(s, Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'coop') ?? 'none', NOW),
    null, 'M1a homes keep their own panel');
});

test('giants and unlocks: banner texts from the rules\' events; "Show me" targets are registered panels', () => {
  const s = farm(20);
  const formed = giantText(s, { e: 'giantFormed', id: 'p', ids: [], crop: 'pumpkin', by: 'p2' }, 'p1');
  assert.equal(formed.ribbon, 'A giant crop!');
  assert.match(formed.message,
    /^Mia's planting finished a composted 3×3 block of Pumpkins, and it grew into one Giant Pumpkin\./);
  const felled = giantText(s, { e: 'giantFelled', id: 'p', crop: 'pumpkin', qty: 162, by: 'p1', team: true }, 'p1');
  assert.equal(felled.ribbon, 'Felled together!');
  assert.match(felled.message, /162 Pumpkins for the barn/);
  assert.match(giantText(s, { e: 'giantFelled', crop: 'wheat', qty: 90, by: 'p1', team: false }, 'p1').message,
    /^You brought the giant Wheat down: 90 Wheat/);
  for (const id of ['collections', 'restoration', 'farm_beauty', 'decor_sets', 'masterwork']) {
    const t = featureTarget(id);
    assert.ok(t && (Object.hasOwn(COLLECT_PANELS, t.panel)), `${id} opens a ui-collect panel`);
  }
  // the Mill Wheel is announced at L19 only when the Old Greenhouse is already restored (the rules' openProject)
  const s19 = farm(19);
  assert.ok(!unlocksOfLevel(19, s19).some((u) => u.id === 'restore-mill_wheel'), 'not while the Greenhouse is unfinished');
  for (let level = 1; level <= 40; level++) {
    for (const u of unlocksOfLevel(level)) {
      assert.doesNotMatch(`${u.title} ${u.text}`, /undefined|null/);
      if (u.target) assert.ok(Object.hasOwn(COLLECT_PANELS, u.target.panel));
    }
  }
});
