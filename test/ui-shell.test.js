// ui-shell: the DOM-free logic behind the HUD, tracker, tutorial, recap, feed, dialogs and settings. The DOM parts
// are verified with tools/shot.mjs screenshots; everything that decides WHAT the shell shows is tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFarm, must, run, T0 } from './helpers.js';
import { ERR } from '../shared/net/protocol.js';
import { ACTIONS } from '../shared/rules/index.js';
import { cropOf, CONTENT, xpForLevel, live } from '../shared/content/index.js';
import { ERR_TEXT, errText } from '../public/js/ui/index.js';
import { fmtDuration, fmtShort, plural } from '../public/js/ui/dom.js';
import { sanitize, DEFAULTS } from '../public/js/ui/settings.js';
import { cleanName, suggestions, NAME_MAX } from '../public/js/ui/naming.js';
import { softCopy, dryCost, partnerHeadsUp } from '../public/js/ui/dialogs.js';
import { feedText } from '../public/js/ui/feed.js';
import { localGoals, cardsFromGoals, storyCards } from '../public/js/ui/tracker.js';
import { goals } from '../shared/rules/goals.js';
import { coachStep, targetOf, tileCentreOf } from '../public/js/ui/tutorial.js';
import { seedRows, toolDefFor, TOOL_CONTENT } from '../public/js/ui/toolbar.js';
import { unlocksFor, showMeTarget } from '../public/js/ui/levelup.js';
import { nextUnlocks, barnStatus, worldTip, titleOf } from '../public/js/ui/hud.js';
import { ripenedNow, buildRecap, RECAP_MIN_MS } from '../public/js/ui/recap.js';
import { EMOTE_INFO } from '../public/js/ui/social.js';
import { EMOTES } from '../shared/net/protocol.js';
import { kindOf } from '../public/js/ui/toasts.js';

const plots = (s) => Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot').sort();
const noJunk = (t) => assert.ok(t && !/undefined|null|NaN|\[object/.test(t), `bad text: ${t}`);

test('every ERR code has a friendly sentence; refusals never read as alarms', () => {
  for (const code of Object.keys(ERR)) {
    assert.ok(ERR_TEXT[code], `missing ERR_TEXT for ${code}`);
    noJunk(ERR_TEXT[code]);
    assert.ok(!/error|invalid|failed/i.test(ERR_TEXT[code]), `${code} reads like an alarm: ${ERR_TEXT[code]}`);
  }
  assert.equal(errText('Plain words'), 'Plain words');
  assert.equal(errText(ERR.NO_COINS), ERR_TEXT.NO_COINS);
  assert.equal(kindOf(ERR.OFFLINE), 'warn');
  assert.equal(kindOf(ERR.NO_COINS), 'info');
});

test('formatting: durations, short numbers, plurals', () => {
  assert.equal(fmtDuration(0), '0s');
  assert.equal(fmtDuration(-500), '0s');
  assert.equal(fmtDuration(59_001), '1m 00s');
  assert.equal(fmtDuration(60_000), '1m 00s');
  assert.equal(fmtDuration(3_600_000), '1h 00m');
  assert.equal(fmtDuration(49 * 3_600_000), '2d 1h');
  assert.equal(fmtShort(9_999), '9,999');
  assert.equal(fmtShort(12_345), '12.3k');
  assert.equal(fmtShort(250_000), '250k');
  assert.equal(fmtShort(1_500_000), '1.5M');
  assert.equal(plural(1, 'plot'), '1 plot');
  assert.equal(plural(2, 'plot'), '2 plots');
});

test('settings: defaults, clamps and unknown values never reach the game', () => {
  assert.deepEqual(sanitize(null), { ...DEFAULTS, volume: { ...DEFAULTS.volume } });
  const s = sanitize({ quality: 'ultra', motion: 'still', uiScale: 999, volume: { music: -5, sfx: 33.4, bogus: 1 }, muted: 'yes', cbSafe: true });
  assert.equal(s.quality, DEFAULTS.quality);
  assert.equal(s.motion, 'still');
  assert.equal(s.uiScale, 140, 'the Interface size tops out at 140 % (1920 x 1080)');
  assert.equal(s.volume.music, 0);
  assert.equal(s.volume.sfx, 33);
  assert.equal(s.volume.bogus, undefined);
  assert.equal(s.muted, false);
  assert.equal(s.cbSafe, true);
  assert.equal(sanitize({ uiScale: 87 }).uiScale, 85, 'UI scale snaps to 5 %');
  assert.equal(sanitize({ uiScale: 10 }).uiScale, 80);
});

test('farm naming: cleaned names pass the rules action; suggestions are distinct', () => {
  assert.equal(cleanName('  Sunny    Acres  '), 'Sunny Acres');
  assert.equal(cleanName('x'.repeat(40)).length, NAME_MAX);
  const s = makeFarm();
  for (const name of [cleanName('  Two   Hearts Farm '), cleanName('Ü'.repeat(30))]) {
    must(s, 'nameFarm', { name });
    assert.equal(s.farm.name, name);
  }
  let n = 0;
  const rnd = () => ((n = (n * 7 + 3) % 97) / 97);
  const ideas = suggestions(3, rnd);
  assert.equal(new Set(ideas).size, 3);
  for (const i of ideas) assert.ok(i.length <= NAME_MAX);
});

test('soft confirm copy names the keeper and the price; dryCost prices without touching the state', () => {
  const s = makeFarm();
  const before = JSON.stringify(s);
  const id = plots(s)[0];
  const cost = dryCost(s, 'plant', { id, crop: 'wheat' }, 'p1', T0);
  assert.deepEqual(cost, { coins: cropOf('wheat').seed, acorns: 0 });
  assert.equal(JSON.stringify(s), before, 'the dry run worked on a clone');
  assert.equal(dryCost(s, 'plant', { id: 'nope', crop: 'wheat' }, 'p1', T0), null);
  const big = softCopy(ERR.BIG_SPEND, { state: s, pid: 'p1', args: { def: 'bakery' }, cost: { coins: 150, acorns: 0 } });
  assert.equal(big.lead, 'Buy Bakery?');
  assert.match(big.body, /% of the farm treasury/);
  s.farm.keep = { egg: { n: 5, by: 'p2' } };
  const kept = softCopy(ERR.RESERVED, { state: s, pid: 'p1', args: { item: 'egg' } });
  assert.match(kept.lead, /^Mia keeps 5 Egg/);
  for (const c of [big, kept, softCopy(ERR.PINNED, { state: s, pid: 'p1', args: {} })]) { noJunk(c.lead); noJunk(c.body); noJunk(c.ok); }
});

test('feed lines: every documented ring kind reads as a sentence', () => {
  const s = makeFarm();
  const rows = [
    { k: 'harvest', item: 'wheat', q: 24, p: 24 }, { k: 'tree', item: 'apple', q: 5 }, { k: 'collect', item: 'egg', q: 3 },
    { k: 'tend', q: 1 }, { k: 'water', q: 4 }, { k: 'craft', item: 'flour', q: 2 }, { k: 'sell', item: 'wheat', q: 10, c: 20 },
    { k: 'order', c: 90, x: 6, g: true }, { k: 'level', level: 3 }, { k: 'buy', def: 'bakery', c: 1500, a: 0 }, { k: 'expand', def: 'creekside' },
    { k: 'ribbon', id: 'cream_of_the_crop', t: 1 }, { k: 'quest', id: 'a1' }, { k: 'keepsake', item: 'egg', to: 'p1' }, { k: 'note', x: 1, z: 2 },
    { k: 'golden' }, { k: 'hf', a: 'p1', b: 'p2' }, { k: 'gift', day: 3 }, { k: 'chest', what: 'meter', i: 0 },
    { k: 'name', what: 'farm', text: 'Sunny Acres' }, { k: 'wish', def: 'bakery', n: 1 }, { k: 'keep', item: 'egg', n: 5 }, { k: 'mystery' },
  ];
  for (const r of rows) {
    const t = feedText({ at: T0, by: 'p2', ...r }, s, 'p1');
    noJunk(`${t.actor} ${t.text}`);
  }
  assert.equal(feedText({ at: T0, by: 'p2', k: 'harvest', item: 'wheat', q: 24 }, s, 'p1').text, 'harvested 24 Wheat');
  assert.equal(feedText({ at: T0, by: 'p1', k: 'tend', q: 1 }, s, 'p1').actor, 'You');
  assert.equal(feedText({ at: T0, by: 'p2', k: 'keepsake', item: 'egg', to: 'p1' }, s, 'p1').text, 'wrapped a keepsake for You');
});

test('feed lines: the M1b rows (Fair, Barge, townsfolk, album, giants, Restoration, Town Projects) read as sentences', () => {
  const s = makeFarm();
  const set = [...CONTENT.collections.values()][0];
  const proj = [...CONTENT.restoration.values()][0];
  const town = [...CONTENT.townProjects.values()][0];
  const npc = [...CONTENT.npcs.values()].find((n) => n.townsfolk) ?? [...CONTENT.npcs.values()][0];
  const rows = [
    { k: 'fair', item: 'apple_pie', q: 2, p: 45 }, { k: 'fair', medal: 'bronze1', p: 900, c: 1200, by: 'sys' },
    { k: 'fair', medal: null, p: 10, c: 0, by: 'sys' }, { k: 'barge', item: 'cheese', q: 6, c: 300 },
    { k: 'barge', row: 2, c: 900, a: 2 }, { k: 'folk', npc: npc.id, c: 250 }, { k: 'album', set: set.id, item: set.items[0].id },
    { k: 'album', set: set.id, done: 1 }, { k: 'giant', crop: 'pumpkin', q: 57 },
    { k: 'restore', project: proj.id, bundle: proj.bundles[0].id }, { k: 'restore', project: proj.id, done: 1 },
    { k: 'town', id: town.id, by: 'sys' },
  ];
  for (const r of rows) {
    const t = feedText({ at: T0, by: 'p2', ...r }, s, 'p1');
    noJunk(`${t.actor ?? ''} ${t.text}`);
    assert.doesNotMatch(t.text, /did something/, r.k);
  }
  assert.equal(feedText({ at: T0, by: 'p2', k: 'fair', item: 'apple_pie', q: 2, p: 45 }, s, 'p1').text,
    'entered 2 Apple Pies at the Fair (+4.5 points)');
  assert.equal(feedText({ at: T0, by: 'p2', k: 'giant', crop: 'pumpkin', q: 57 }, s, 'p1').text,
    'felled a Giant Pumpkin! (57 Pumpkins)');
  assert.equal(feedText({ at: T0, by: 'sys', k: 'town', id: town.id }, s, 'p1').actor, null, 'the village speaks for itself');
});

test('Goal Tracker: NOW is never empty and follows the GDD fallback chain', () => {
  const s = makeFarm();
  const ids = plots(s);
  let g = localGoals(s, 'p1', T0);
  assert.equal(g[0].slot, 'now');
  assert.match(g[0].title, /^Plant 16 empty plots$/);
  for (const id of ids) must(s, 'plant', { id, crop: 'wheat' });
  g = localGoals(s, 'p1', T0 + 1000);
  assert.ok(['Tidy up the yard', 'Everything is growing'].includes(g[0].title), g[0].title);
  const ripe = T0 + cropOf('wheat').growMs + 1;
  g = localGoals(s, 'p1', ripe);
  assert.equal(g[0].title, `Harvest ${ids.length} ripe plots`);
  assert.ok(g[0].target.tile, 'NOW points at a tile');
  for (const c of g) { noJunk(c.title); noJunk(c.sub); }
  assert.ok(g.some((c) => c.slot === 'soon') && g.some((c) => c.slot === 'big'));
});

test('Goal Tracker: rules-goals cards get icons, short titles and targets', () => {
  const s = makeFarm();
  const res = goals(s, 'p1', T0);
  const cards = cardsFromGoals(res, s, 'p1', T0);
  assert.ok(cards.length >= 2 && cards[0].slot === 'now');
  for (const c of cards) {
    noJunk(c.title);
    if (c.sub) noJunk(c.sub);
    assert.ok(c.icon || c.glyph, `${c.kind} has art`);
    assert.ok(c.title.length <= 40, `short title: ${c.title}`);
  }
  // the "everything is growing" text splits into a title and a capitalised sub line
  for (const id of plots(s)) must(s, 'plant', { id, crop: 'wheat' });
  const all = cardsFromGoals(goals(s, 'p1', T0 + 1000), s, 'p1', T0 + 1000);
  const tip = all.find((c) => c.kind === 'tip');
  if (tip) { assert.equal(tip.title, 'Everything is growing'); assert.match(tip.sub, /^[A-Z]/); }
});

test('story cards show the first unfinished task with its progress', () => {
  const s = makeFarm();
  const cards = storyCards(s, T0);
  assert.ok(cards.length >= 1);
  const a1 = cards.find((c) => c.id === 'a1');
  assert.ok(a1, 'chain A starts with a1');
  assert.equal(a1.sub, 'Plant Wheat 0/6');
  for (const id of plots(s).slice(0, 6)) must(s, 'plant', { id, crop: 'wheat' });
  const after = storyCards(s, T0).find((c) => c.id === 'a1');
  assert.equal(after.sub, 'Harvest Wheat 0/6');
  assert.ok(after.progress > 0 && after.progress < 1);
});

test('tutorial coach: welcome, name, then the first deed picks the track', () => {
  const s = makeFarm();
  let c = coachStep(s, 'p1');
  assert.equal(c.step.id, 'welcome');
  must(s, 'tutDone', { step: 'welcome' });
  c = coachStep(s, 'p1');
  assert.equal(c.step.id, 'name_farm');
  must(s, 'nameFarm', { name: 'Sunny Acres' });
  c = coachStep(s, 'p1');
  assert.equal(c.step.id, 'choose', 'no track yet: both first steps are offered');
  const t = targetOf(s, c.step, T0);
  assert.ok(t && t.tile, 'the pointer goes to an empty plot');
  must(s, 'plant', { id: plots(s)[0], crop: 'wheat' });
  c = coachStep(s, 'p1');
  assert.equal(c.track, 'fields');
  assert.equal(c.step.id, 'plant_wheat');
  assert.equal(c.have, 1);
  assert.equal(c.need, 6);
  assert.equal(coachStep(s, 'p2').track, 'barnyard', 'the partner gets the other track');
  const bt = targetOf(s, coachStep(s, 'p2').step, T0);
  assert.ok(bt && (bt.tile || bt.ui));
  const centre = tileCentreOf(s, 'home.1.1');
  const barn = s.farm.objects['home.1.1'];
  assert.ok(centre.x >= barn.x && centre.z >= barn.z);
  must(s, 'tutSkip', { all: 'yes' }, { pid: 'p1' });
  assert.equal(coachStep(s, 'p1'), null, '"I know farming" ends the coach for that player only');
  assert.ok(coachStep(s, 'p2'));
  const fresh = makeFarm();
  must(fresh, 'tutSkip', { all: 'yes' }, { pid: 'p2' });
  assert.equal(coachStep(fresh, 'p2'), null, 'a skip before the welcome also silences the start steps');
  assert.equal(coachStep(fresh, 'p1').step.id, 'welcome');
});

test('seed tray: live crops, the next two locked previews, prices from content', () => {
  const s = makeFarm();
  const rows = seedRows(s);
  assert.equal(rows[0].id, 'wheat');
  assert.equal(rows[0].open, true);
  assert.equal(rows[0].seed, cropOf('wheat').seed);
  assert.equal(rows.filter((r) => !r.open).length, 2);
  const liveIds = new Set(live('crops').map((c) => c.id));
  for (const r of rows) assert.ok(liveIds.has(r.id), `${r.id} is live content`);
  const last = Math.max(...live('crops').map((c) => c.unlock ?? 1));
  s.farm.xp = xpForLevel(last);
  assert.ok(seedRows(s).every((r) => r.open), `every crop of the build is open at its last level (L${last})`);
});

test('tools: controller ids map to content tools; owned brushes upgrade the icon', () => {
  const s = makeFarm();
  for (const id of ['hand', 'seed', 'seed_bag', 'sickle', 'watering_can', 'feed_scoop', 'basket', 'compost_scoop', 'axe', 'hammer']) {
    assert.ok(toolDefFor(id, s), `${id} -> ${TOOL_CONTENT[id]}`);
  }
  assert.equal(toolDefFor('seed', s).id, 'seed_bag');
  s.farm.tools = { big_watering_can: 1 };
  assert.equal(toolDefFor('watering_can', s).id, 'big_watering_can');
});

test('level-up: unlock lists, "Show me" targets and the star hover', () => {
  const u2 = unlocksFor(2);
  assert.ok(u2.things.some((t) => t.id === 'carrot'));
  assert.ok(u2.systems.some((x) => x.id === 'orders'));
  for (const t of unlocksFor(4).things) noJunk(t.name);
  assert.deepEqual(showMeTarget({ family: 'crops', id: 'carrot' }), { panel: 'market', args: { tab: 'seeds', focus: 'carrot' } });
  const next = nextUnlocks(1, 3);
  assert.equal(next.length, 3);
  assert.ok(next.every((n) => n.level >= 2 && n.name));
});

test('barn pill: soft cap modes (GDD §3.6)', () => {
  const s = makeFarm();
  assert.equal(barnStatus(s).mode, 'ok');
  s.farm.inventory = { wheat: 190 };
  assert.equal(barnStatus(s).mode, 'near');
  s.farm.inventory = { wheat: 200 };
  s.farm.overflow = { wheat: 5 };
  assert.equal(barnStatus(s).mode, 'overflow');
  s.farm.overflow = { wheat: 200 };
  assert.equal(barnStatus(s).mode, 'full');
  assert.equal(barnStatus(s).total, 400);
});

test('world tooltip: crop name, time left, mini bar and planter', () => {
  const s = makeFarm();
  const id = plots(s)[0];
  assert.equal(worldTip(s, { kind: 'object', id }, T0).title, 'Empty plot');
  must(s, 'plant', { id, crop: 'wheat' }, { pid: 'p2' });
  const half = T0 + cropOf('wheat').growMs / 2;
  const t = worldTip(s, { kind: 'object', id }, half);
  assert.equal(t.title, 'Wheat');
  assert.equal(t.by, 'p2');
  assert.ok(t.bar > 0.4 && t.bar < 0.6);
  assert.match(t.lines[0], /^Ready in 30s$/);
  assert.equal(worldTip(s, { kind: 'object', id }, T0 + cropOf('wheat').growMs).ready, true);
  assert.equal(worldTip(s, { kind: 'tile', x: 1, z: 1 }, T0), null);
  assert.equal(titleOf(s.players.p1), 'Greenhorn');
});

test('recap: ripened counts, the partner\'s lines and new unlocks since the last visit', () => {
  const s = makeFarm();
  s.players.p2.lastSeenAt = T0;
  const later = T0 + RECAP_MIN_MS * 3;
  for (const id of plots(s)) must(s, 'plant', { id, crop: 'wheat' }, { pid: 'p1', now: T0 + 1000 });
  const ripe = T0 + 1000 + cropOf('wheat').growMs;
  for (const id of plots(s).slice(0, 8)) must(s, 'harvest', { id }, { pid: 'p1', now: ripe });
  const r = ripenedNow(s, later);
  assert.equal(r.crops, 8);
  const rc = buildRecap(s, 'p2', later);
  const names = rc.sections.map((x) => x.name);
  assert.ok(names.includes('ripened'));
  assert.ok(names.includes('partnerDid'));
  const lines = rc.sections.find((x) => x.name === 'partnerDid').items;
  assert.ok(lines.every((l) => l.by !== 'p2'), 'only what the partner did');
  for (const l of lines) noJunk(feedText(l, s, 'p2').text);
  s.farm.xp = xpForLevel(3);
  const withUnlocks = buildRecap(s, 'p2', later);
  assert.ok(withUnlocks.sections.some((x) => x.name === 'newUnlocks'), 'levels the player has not toured');
});

test('emote wheel covers every protocol emote; render-life gets a bubble kind', () => {
  for (const id of EMOTES) assert.ok(EMOTE_INFO[id], `emote ${id}`);
  assert.equal(EMOTE_INFO.high_five[2], null, 'the high five is a gesture, not a bubble');
});

test('rules actions the shell calls exist with the arguments it sends', () => {
  const s = makeFarm();
  for (const type of ['nameFarm', 'tutDone', 'tutSkip', 'tutSwap', 'markSeen', 'thank', 'highFive']) assert.ok(ACTIONS[type], type);
  assert.equal(run(s, 'markSeen', { kind: 'tip', id: 'sickle' }).ok, true);
  assert.equal(run(s, 'markSeen', { kind: 'tip', id: 'sickle' }).code, ERR.ALREADY_DONE);
  assert.ok(CONTENT.features.size > 0);
});

test('BIG_SPEND heads-up for the partner: only big purchases, with the real name and price', () => {
  const s = makeFarm();
  s.farm.wallet.coins = 2000;                      // what is left AFTER a 4,000-coin Bakery: 6,000 before
  assert.equal(partnerHeadsUp({ e: 'placed', def: 'bakery', coins: 4000 }, s, 'Rowan'), 'Rowan is buying Bakery — 4,000 coins');
  assert.equal(partnerHeadsUp({ e: 'placed', def: 'bakery', coins: 900 }, s, 'Rowan'), null, 'at most 1,000 coins is never big');
  s.farm.wallet.coins = 100_000;
  assert.equal(partnerHeadsUp({ e: 'placed', def: 'bakery', coins: 4000 }, s, 'Rowan'), null, 'under 25 % of the treasury');
  assert.match(partnerHeadsUp({ e: 'hurried', acorns: 10 }, s, 'Mia'), /10 acorns$/);
  assert.match(partnerHeadsUp({ e: 'expanded', expansion: 'creekside', coins: 90_000 }, s, 'Mia'), /Creekside Meadow/);
});
