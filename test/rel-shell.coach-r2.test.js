// QA r2, ui-shell: the coach after the second tester round.
//   S2-01 (fbp#1, jde#3): at level 3 "Make Flour together" pointed at nothing: no Windmill on the farm, no arrow, and
//         the free Windmill hid in Market > Buildings (the build tray listed only storage).
//   S2-06 (fbp#2): "Make Chicken Feed from 3 Wheat" stayed word for word for the whole 5-minute job, with no time left.
//   S2-08 (fbp#4, jde#10): the arrow lay on Grandma's own card: her words at 360, her naming chip on the iPhone, her
//         "⋯" on a desktop; the edge arrow hid "кокошки".
//   S2-09 (fbp#5, jde#6): the arrow for "Строй" lay on "Семена" above it; the one for the Coop card on "Upgrade".
// The rects are the testers' measurements (fix-ui-shell.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFarm } from '../shared/rules/state.js';
import { xpForLevel } from '../shared/content/index.js';
import { T0 } from './helpers.js';

const TUT = await import('../public/js/ui/tutorial.js');
const TB = await import('../public/js/ui/toolbar.js');

const rect = (left, right, top, bottom) => ({ left, right, top, bottom, width: right - left, height: bottom - top });
const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function l3() {
  const s = createFarm(7, T0);
  s.farm.xp = xpForLevel(3);
  return s;
}

test('S2-01: at level 3 with no Windmill the flour step points at its free card in the build tray', () => {
  const s = l3();
  assert.ok(!Object.values(s.farm.objects).some((o) => o.def === 'mill'), 'a farm without a Windmill');
  const tgt = TUT.targetOf(s, { id: 'flour_together' }, T0);
  assert.ok(tgt && typeof tgt.ui === 'string', `a target (HEAD: ${JSON.stringify(tgt)})`);
  assert.match(tgt.ui, /\.build-card\[data-def="mill"\]/, 'the Windmill card first');
  assert.match(tgt.ui, /\[data-dock="build"\]/, 'then Build (desktop)');
  assert.match(tgt.ui, /\[data-slot="tool"\]/, 'then the phone\'s tool slot');
});

test('S2-01: the build tray offers the free Windmill at level 3, not before, and not once the farm has one', () => {
  assert.equal(typeof TB.freeToPlace, 'function', 'toolbar.js freeToPlace(state)');
  const s = l3();
  assert.ok(TB.freeToPlace(s).includes('mill'), `the Windmill: ${JSON.stringify(TB.freeToPlace(s))}`);
  const s2 = l3();
  s2.farm.xp = xpForLevel(2);
  assert.ok(!TB.freeToPlace(s2).includes('mill'), 'level 2: not yet');
  const s3 = l3();
  s3.farm.objects.millx = { def: 'mill', x: 40, z: 40, queue: [], slots: 2 };
  assert.ok(!TB.freeToPlace(s3).includes('mill'), 'one on the farm: no card');
  const s4 = l3();
  s4.farm.storage = { ...s4.farm.storage, mill: 1 };
  assert.ok(!TB.freeToPlace(s4).includes('mill'), 'one in storage: the storage card says it already');
  for (const id of TB.freeToPlace(l3())) assert.ok(!/scarecrow|arbor|statue|lantern|rocker|blossom/.test(id), `no Acorn decor: ${id}`);
  // the tray draws them after what waits in storage
  assert.match(fs.readFileSync(new URL('../public/js/ui/toolbar.js', import.meta.url), 'utf8'), /\[\.\.\.stored, \.\.\.freeToPlace\(st\)\]/);
});

test('S2-01: with the Windmill placed the flour step points at it', () => {
  const s = l3();
  s.farm.objects.mill1 = { def: 'mill', x: 40, z: 40, queue: [], slots: 2 };
  const tgt = TUT.targetOf(s, { id: 'flour_together' }, T0);
  assert.equal(tgt.id, 'mill1');
  assert.equal(tgt.ui, undefined);
});

test('S2-06: a make step with its job queued counts down to it; done, it says collect', () => {
  assert.equal(typeof TUT.makeEta, 'function', 'tutorial.js makeEta(state, step, now)');
  const s = l3();
  const step = { id: 'make_feed', task: { verb: 'make', ref: 'chicken_feed', qty: 1 } };
  s.farm.objects.fm1 = { def: 'feed_mill', x: 30, z: 30, slots: 3, queue: [] };
  assert.equal(TUT.makeEta(s, step, T0), null, 'nothing queued: the step\'s own words');
  s.farm.objects.fm1.queue = [{ r: 'chicken_feed', s: T0, e: T0 + 300_000, by: 'p1' }];
  assert.deepEqual(TUT.makeEta(s, step, T0 + 48_000), { ms: 252_000 }, '4:12 to go');
  assert.equal(TUT.clock(252_000), '4:12');
  assert.deepEqual(TUT.makeEta(s, step, T0 + 300_000), { ready: true }, 'done: collect it');
  // the flour step too, and only its own recipe
  const flour = { id: 'flour_together', task: { verb: 'make', ref: 'flour', qty: 3 } };
  assert.equal(TUT.makeEta(s, flour, T0), null, 'feed is no flour');
  // the card's ticking row and its words
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  assert.match(src, /tr\('dock\.coach\.makeIn', \{ d: clock\(made\.ms\) \}\)/);
});

test('S2-06: the words of the countdown in both languages', async () => {
  const en = (await import('../public/js/i18n/en/dock.js')).default;
  const bg = (await import('../public/js/i18n/bg/dock.js')).default;
  for (const k of ['dock.coach.makeIn', 'dock.coach.makeReady']) {
    assert.ok(en[k] && bg[k], k);
  }
  assert.match(en['dock.coach.makeIn'], /\{d\}/);
  assert.match(bg['dock.coach.makeIn'], /\{d\}/);
});

test('S2-09: Строй in the phone\'s tool pop-up: the rows open for the arrow, which lies between them on no tile', () => {
  assert.equal(typeof TUT.arrowWay, 'function', 'tutorial.js arrowWay(ways, obstacles, view)');
  // HEAD's pop-up (the tester's iPhone 13 rects): every way from Строй lies on a tile or on the bar
  const tight = { stroi: rect(103, 183, 646, 712), tiles: [rect(19, 99, 570, 636), rect(103, 183, 570, 636), rect(187, 267, 570, 636),
    rect(271, 351, 570, 636), rect(19, 99, 646, 712), rect(187, 267, 646, 712)], bar: rect(6, 384, 724, 810) };
  const tb = TUT.arrowBox(...TUT.arrowWay(TUT.sideWays(tight.stroi), [...tight.tiles, tight.bar], { w: 390, h: 844 }));
  assert.ok([...tight.tiles, tight.bar].some((o) => hit(tb, o)), 'no clean way in HEAD\'s rows');
  // QA r3 S3-07 (fbp#8) replaced r2's way (the rows opened a 96 px band for the arrow): while the coach points into the
  // pop-up (body.tut-fly) Строй leads it, the arrow comes from above with the room over the pop-up (--tut-room, grown by
  // tutorial.js until her card clears it), and the grid keeps its rows
  const mobile = fs.readFileSync(new URL('../public/css/mobile.css', import.meta.url), 'utf8');
  assert.doesNotMatch(mobile, /row-gap: 96px/, 'no band between the rows');
  assert.match(mobile, /body\.tut-fly \.tool-flyout\.tool-pop \[data-act="build"\] \{ order: -1; \}/);
  assert.match(mobile, /body\.tut-fly \.tool-flyout\.tool-pop \{ margin-top: var\(--tut-room, 0px\); \}/);
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  assert.match(src, /const inFly = Boolean\(touchMq\?\.matches && !landMq\?\.matches && uiEl\.closest\('#tools-flyout'\)\);/);
  assert.match(src, /\} else if \(inTray \|\| inFly\) \{/);
  const row1 = 646;
  const lead = { stroi: rect(19, 99, row1, row1 + 66), tiles: [rect(103, 183, row1, row1 + 66), rect(187, 267, row1, row1 + 66),
    rect(271, 351, row1, row1 + 66), rect(19, 99, row1 + 76, row1 + 142), rect(103, 183, row1 + 76, row1 + 142)], bar: rect(6, 384, 724, 810) };
  const way = TUT.sideWays(lead.stroi, ['above'])[0];
  const box = TUT.arrowBox(...way);
  for (const o of [...lead.tiles, lead.bar]) assert.ok(!hit(box, o), `the arrow ${JSON.stringify(box)} lies on ${JSON.stringify(o)}`);
  assert.equal(way[2], 0, 'from above (HEAD: 119-167 x 565-629 on Семена)');
});

test('S2-09: 360, level 4: Строй leads the pop-up of eight: from above, on no tile', () => {
  const row1 = 476;
  const stroi = rect(21, 98, row1, row1 + 66);
  const others = [rect(103, 180, row1, row1 + 66), rect(185, 262, row1, row1 + 66), rect(267, 344, row1, row1 + 66),
    rect(21, 98, row1 + 76, row1 + 142), rect(103, 180, row1 + 76, row1 + 142), rect(185, 262, row1 + 76, row1 + 142),
    rect(267, 344, row1 + 76, row1 + 142), rect(6, 354, 562 + 76, 640 + 76)];
  const box = TUT.arrowBox(...TUT.sideWays(stroi, ['above'])[0]);
  for (const o of others) assert.ok(!hit(box, o), `on a neighbour: ${JSON.stringify(box)} x ${JSON.stringify(o)}`);
  assert.ok(box.left >= 0 && box.right <= 360 && box.top >= 0, `on screen: ${JSON.stringify(box)}`);
});

test('S2-09: the desktop build tray: the arrow for the Coop card never lies on "Upgrade" beside it', () => {
  const coop = rect(637, 744, 556, 650);
  const upgrade = rect(512, 613, 556, 650);
  const mill = rect(752, 859, 556, 650);
  const coachCard = rect(120, 500, 585, 690);
  const box = TUT.arrowBox(...TUT.arrowWay(TUT.sideWays(coop), [coachCard, upgrade, mill], { w: 1366, h: 768 }));
  assert.ok(!hit(box, upgrade), `on Upgrade (HEAD 555-619 x 578-626): ${JSON.stringify(box)}`);
  assert.ok(!hit(box, mill), 'on the Feed Mill');
  assert.ok(box.bottom <= coop.top, 'from above, as the tray\'s cards have nothing above them');
});

test('S2-08: a desktop dock door: never on Grandma\'s card or her "⋯" (the card steps aside)', () => {
  const build = rect(926, 1006, 666, 752);
  const card = rect(372, 992, 584, 662);
  const more = rect(946, 978, 614, 646);
  const ways = [[build.left + build.width * 0.3, build.top + 8, -38], ...TUT.sideWays(build, ['above']), [build.right - build.width * 0.3, build.top + 8, 38]];
  const way = TUT.arrowWay(ways, [card], { w: 1366, h: 768 });
  const box = TUT.arrowBox(...way);
  // where she stands at 1366 every way meets her card: the chooser says so, and the shell docks her aside
  assert.ok(hit(box, card) || hit(box, more), 'her card is in every way here');
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  assert.match(src, /document\.body\.classList\.toggle\('coach-aside', !touchMq\?\.matches && Boolean\(uiEl\.closest\('#dock, \.dock-minis'\)\)\)/);
  const shell = fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8');
  assert.match(shell, /body\.coach-aside:not\(\.tray-open\) \.coach-slot \{ position: absolute; right: calc\(100% \+ 14px\);/);
  // docked aside (left of the toolbar of 3, 578 px at 1366) the first way is clear
  const aside = rect(184, 564, 600, 706);
  const box2 = TUT.arrowBox(...TUT.arrowWay(ways, [aside], { w: 1366, h: 768 }));
  assert.ok(!hit(box2, aside), 'clear of her docked card');
});

test('S2-08: the edge arrow stays above Grandma\'s card when she is low on the screen', () => {
  assert.equal(typeof TUT.edgeTip, 'function', 'tutorial.js edgeTip(s, W, H, m, card)');
  const card = rect(6, 354, 455, 560);
  const [x, y, deg] = TUT.edgeTip({ x: 300, y: 900 }, 360, 640, 70, card);
  const box = TUT.arrowBox(x, y, deg);
  assert.ok(!hit(box, card), `the edge arrow ${JSON.stringify(box)} on her card (HEAD 232-308 x 407-487)`);
  assert.ok(y < card.top, 'its tip above her card');
  // without a card the old edge: inside the screen by the margin
  const [, y2] = TUT.edgeTip({ x: 300, y: 900 }, 360, 640, 70, null);
  assert.ok(y2 <= 640 - 70 + 0.5 && y2 > card.top, 'no card: the bottom margin as before');
});

test('S2-08: the phone bar\'s arrow from above grows the room over the bar until her card clears it', () => {
  const src = fs.readFileSync(new URL('../public/js/ui/tutorial.js', import.meta.url), 'utf8');
  assert.match(src, /const inBar = touchMq\?\.matches && \(uiEl\.closest\('#toolbar'\) \|\| \(uiEl\.closest\('#dock'\) && !landMq\?\.matches\)/,
    'the bar\'s doors count as the bar (HEAD: the diagonal ways over her card)');
  assert.match(src, /document\.body\.style\.setProperty\('--tut-room', `\$\{room\}px`\)/);
  const mobile = fs.readFileSync(new URL('../public/css/mobile.css', import.meta.url), 'utf8');
  assert.match(mobile, /body\.tut-bar #toolbar \{ margin-top: var\(--tut-room, 66px\); \}/);
  // the iPhone's Orders step: the arrow from above the door and her naming chip (tester's rects)
  const door = rect(250, 298, 720, 786);
  const box = TUT.arrowBox(...TUT.sideWays(door, ['above'])[0]);
  const chip = rect(164, 309, 672, 706);
  assert.ok(hit(box, chip), 'at 66 px of room the chip is under the arrow: the room must grow by the overlap');
  const over = Math.ceil(chip.bottom - box.top + 6);
  assert.ok(over > 0 && over < 154, `a bounded growth: ${over}`);
});
