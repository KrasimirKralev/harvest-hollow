// "Where to get it" hints (live requests 2026-10-04): ui/item-sources.js must name at least one way to come by EVERY
// live item on any farm, in words a player can act on (no "undefined", no NaN), with a "Show me" that names a real
// panel; and the bubble's placement (ui/item-hint.js placeHint) keeps it in the window and off the card's buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { live, isLive, CONTENT, classMembers } from '../shared/content/index.js';
import { itemSources, itemHint, haveLine } from '../public/js/ui/item-sources.js';
import { farmAt, give, placeDef, allLand, must, T0, MIN } from './helpers/rules.js';
import { storyFarm } from './helpers/ui-panels.js';

const PANELS = new Set(['market', 'building', 'tree', 'animals']);
const MARKET_TABS = new Set(['seeds', 'trees', 'animals', 'buildings', 'tools']);
const BAD = /undefined|NaN|null|\[object/;

/** Farms at the corners of M1b: nothing yet, a believable mid-game farm, and the end of the milestone. */
function farms() {
  const out = [['no state', null], ['level 1', farmAt(1)], ['level 12', farmAt(12)], ['level 25', farmAt(25)]];
  const story = storyFarm({ now: T0 + 3 * 3_600_000, level: 9 }).state;
  out.push(['story L9', story]);
  const built = farmAt(25, { coins: 50_000_000 });
  allLand(built);
  for (const def of ['sawmill', 'bakery', 'dairy', 'kitchen', 'compost_bin', 'apple_tree', 'pine', 'cow_barn']) {
    placeDef(built, def, { confirm: ['BIG_SPEND'] });
  }
  out.push(['level 25, built', built]);
  return out;
}

test('every live item has at least one way to get it, in plain words, on every kind of farm', () => {
  const items = live('items');
  assert.ok(items.length > 100, 'the M1b item list');
  for (const [label, st] of farms()) {
    for (const it of items) {
      const list = itemSources(it.id, st, { now: T0 });
      assert.ok(list.length >= 1, `${label}: ${it.id} has no source`);
      const keys = new Set();
      for (const s of list) {
        for (const f of ['title', 'text', 'note']) {
          assert.equal(typeof s[f], 'string', `${label}: ${it.id} ${s.key}.${f}`);
          assert.ok(s[f].length > 0, `${label}: ${it.id} ${s.key}.${f} is empty`);
          assert.ok(!BAD.test(s[f]), `${label}: ${it.id} ${s.key}.${f} = "${s[f]}"`);
        }
        assert.ok(['ready', 'build', 'locked', 'info'].includes(s.state), `${it.id}: state ${s.state}`);
        assert.ok(typeof s.icon === 'string' && s.icon, `${it.id}: an icon`);
        assert.ok(!keys.has(s.key), `${it.id}: ${s.key} twice`);
        keys.add(s.key);
        if (s.show) {
          assert.ok(PANELS.has(s.show.panel), `${it.id}: Show me opens ${s.show.panel}`);
          if (s.show.panel === 'market') assert.ok(MARKET_TABS.has(s.show.args.tab), `${it.id}: market tab ${s.show.args.tab}`);
          else assert.ok(st && Object.hasOwn(st.farm.objects, s.show.args.id), `${label}: ${it.id} shows a placed object`);
        }
      }
    }
  }
});

test('Planks: the Sawmill recipe, and how to get a Sawmill while there is none', () => {
  const low = itemSources('planks', farmAt(3))[0];
  assert.equal(low.kind, 'recipe');
  assert.equal(low.title, 'Sawmill');
  assert.equal(low.text, '1 Wood → 2 Planks · 10 min');
  assert.equal(low.state, 'locked');
  assert.equal(low.note, 'Build a Sawmill (Market → Buildings, level 6)');
  assert.deepEqual(low.show, { panel: 'market', args: { tab: 'buildings', focus: 'sawmill' } });
  const mid = itemSources('planks', farmAt(8))[0];
  assert.equal(mid.state, 'build');
  assert.equal(mid.note, 'Build a Sawmill (Market → Buildings, 6,000 coins)');
  const s = farmAt(8);
  allLand(s);
  const id = placeDef(s, 'sawmill', { confirm: ['BIG_SPEND'] });
  const got = itemSources('planks', s)[0];
  assert.equal(got.state, 'ready');
  assert.equal(got.note, 'You have a Sawmill');
  assert.deepEqual(got.show, { panel: 'building', args: { id, focus: 'planks' } });
});

test('Wood: Pine trees with the Axe, and the stumps and logs still lying about', () => {
  const s = farmAt(8);
  const list = itemSources('wood', s);
  assert.deepEqual(list.map((x) => x.kind), ['tree', 'debris']);
  assert.equal(list[0].title, 'Chop Pine trees with the Axe');
  assert.match(list[0].note, /^Buy a Pine tree \(Market → Trees, [\d,]+ coins\)$/);
  // M2 adds the Big Stump (4 Wood) of the new expansions
  const big = isLive(CONTENT.debris.get('big_stump'));
  assert.equal(list[1].title, big ? 'Chop stumps, fallen logs and big stumps with the Axe'
    : 'Chop stumps and fallen logs with the Axe');
  assert.equal(list[1].text, big ? '2-4 Wood each, cleared for good' : '2-3 Wood each, cleared for good');
  const stumps = Object.values(s.farm.objects).filter((o) => o.def === 'stump' || o.def === 'log').length;
  assert.equal(list[1].note, stumps ? `${stumps} on the farm now` : 'None left: new land brings more');
});

test('animal goods: who lays it, what they eat, the pen to open; a lucky find needs a blue ribbon', () => {
  const s = farmAt(12, { coins: 1_000_000 });
  allLand(s);
  const before = itemSources('milk', s)[0];
  assert.equal(before.title, 'Collect from Cows');
  assert.equal(before.text, 'Feed them Livestock Feed: 1 Milk every 1 h');
  assert.match(before.note, /^Build a Cow Barn \(Market → Animals, [\d,]+ coins\), then buy Cows$/);
  const barn = placeDef(s, 'cow_barn', { confirm: ['BIG_SPEND'] });
  must(s, 'buyAnimal', { def: 'cow', adult: true, home: barn, confirm: ['BIG_SPEND'] });
  const after = itemSources('milk', s)[0];
  assert.equal(after.state, 'ready');
  assert.equal(after.note, '1 on the farm');
  assert.deepEqual(after.show, { panel: 'animals', args: { id: barn } });
  const lucky = itemSources('cream_top_milk', s)[0];
  assert.equal(lucky.kind, 'premium');
  assert.equal(lucky.state, 'info');
  assert.equal(lucky.note, 'None of yours is blue-ribbon yet');
  assert.match(lucky.text, /blue-ribbon cow \(40 collections\) brings a Cream-Top Milk about 1 time in 10/);
  // honey: the bees come with their hive, nothing to feed
  const honey = itemSources('honey', farmAt(13))[0];
  assert.equal(honey.title, 'Collect from Beehives');
  assert.match(honey.note, /^Build a Beehive \(Market → Animals, [\d,]+ coins\)$/);
});

test('feed: the Feed Mill first, the General Store as the dear emergency; Compost from the bin and from Manure', () => {
  const feed = itemSources('chicken_feed', farmAt(5));
  assert.deepEqual(feed.map((x) => x.kind), ['feed', 'store']);
  assert.equal(feed[0].text, '3 of any grain → 6 Chicken Feed · 5 min');
  assert.deepEqual(feed[1].show, { panel: 'market', args: { tab: 'tools', focus: 'chicken_feed' } });
  assert.match(feed[1].text, /^6 Chicken Feed for 30 coins/);
  assert.equal(itemSources('pig_slop', farmAt(12))[1].state, 'locked', 'the store sells slop from level 17');
  const compost = itemSources('compost', farmAt(25));
  assert.deepEqual(compost.map((x) => x.kind), ['recipe', 'collector']);
  assert.equal(compost[1].text, '3 Compost for every 20 animal collections');
});

test('crops: seed price, yield and time; how many plots are planted and ripe right now', () => {
  const s = farmAt(4);
  const plots = Object.keys(s.farm.objects).filter((id) => s.farm.objects[id].def === 'plot').sort();
  must(s, 'plant', { id: plots[0], crop: 'strawberry' }, { now: T0 });
  must(s, 'plant', { id: plots[1], crop: 'strawberry' }, { now: T0 + 50 * MIN });
  const at = (now) => itemSources('strawberry', s, { now })[0];
  assert.equal(at(T0).title, 'Grow Strawberry');
  assert.equal(at(T0).text, 'Plant it on a plot (108 coins a seed): 3 Strawberries per plot in 1 h');
  assert.equal(at(T0 + 51 * MIN).note, '2 plots growing now');
  assert.equal(at(T0 + 61 * MIN).note, '1 plot growing, 1 ready to harvest');
  assert.deepEqual(at(T0).show, { panel: 'market', args: { tab: 'seeds', focus: 'strawberry' } });
  assert.equal(itemSources('oats', s)[0].note, 'Seeds unlock at level 13 (Market → Seeds)');
});

test('the bubble model: what the barn holds against what is needed, and a class lists its members', () => {
  const s = farmAt(12);
  give(s, 'planks', 1);
  const m = itemHint('planks', s, { need: 2 });
  assert.equal(m.name, 'Planks');
  assert.equal(m.have, 1);
  assert.equal(m.short, 1);
  assert.equal(haveLine(m), '1 / 2 in the barn · need 1 more');
  give(s, 'planks', 5);
  assert.equal(haveLine(itemHint('planks', s, { need: 2 })), '6 / 2 in the barn · enough');
  assert.equal(haveLine(itemHint('planks', s)), '6 in the barn');
  const g = itemHint('wheat', s, { cls: 'grain' });
  assert.deepEqual(g.cls.members.map((x) => x.id), classMembers('grain'));
  assert.equal(g.cls.words, 'any grain');
  assert.equal(itemHint('no_such_item', s), null);
  assert.deepEqual(itemSources('no_such_item', s), []);
  // every item id the content knows has a name (no raw ids in the bubble's title)
  for (const it of CONTENT.items.values()) assert.ok(it.name && !/_/.test(it.name), it.id);
});

// ---- the placement (pure) -------------------------------------------------------------------------------------
const { placeHint, anchorItem } = await import('../public/js/ui/item-hint.js');
const view = { width: 1366, height: 768 };
const size = { width: 300, height: 180 };
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('the bubble sits above the item, else below; never over the card\'s button; always inside the window', () => {
  const chip = rect(600, 400, 40, 40);
  const up = placeHint(chip, size, view);
  assert.equal(up.below, false);
  assert.equal(up.top, 400 - 10 - 180);
  assert.equal(up.left, 620 - 150);
  assert.equal(up.tail, 150);
  // no room above: below
  const top = placeHint(rect(600, 60, 40, 40), size, view);
  assert.equal(top.below, true);
  assert.equal(top.top, 110);
  // the card's "Make" button right above the chip: the bubble goes below rather than over it
  const button = rect(560, 300, 120, 44);
  const off = placeHint(chip, size, view, [button]);
  assert.equal(off.below, true);
  assert.ok(off.top >= chip.bottom);
  // buttons of its own card above AND below the chip: beside it, the pointer on the facing edge
  const side = placeHint(chip, size, view, [rect(600, 300, 40, 40), rect(600, 460, 40, 40)]);
  assert.equal(side.side, 'left');
  assert.equal(side.left, 600 - 10 - 300);
  assert.equal(side.tail, 420 - side.top);
  // another card's button over the first choice: a clear side wins; when every side covers something, the fewest
  const soft = placeHint(chip, size, view, [], [rect(600, 300, 40, 40)]);
  assert.equal(soft.side, 'below');
  const every = placeHint(chip, size, view, [], [rect(0, 0, 1366, 768)]);
  assert.equal(every.side, 'above', 'all equal: the first preference');
  // at the window's edges: clamped, the tail still points at the chip
  const edge = placeHint(rect(4, 400, 30, 30), size, view);
  assert.equal(edge.left, 8);
  assert.ok(edge.tail >= 16 && edge.tail <= 30, String(edge.tail));
  const right = placeHint(rect(1350, 400, 14, 30), size, view);
  assert.equal(right.left, 1366 - 300 - 8);
  // a phone: a tall bubble on a short screen stays inside it
  const phone = placeHint(rect(150, 300, 40, 40), { width: 340, height: 700 }, { width: 390, height: 664 });
  assert.ok(phone.top >= 8 && phone.left >= 8, JSON.stringify(phone));
});

test('anchors name a live item, a need, a shortfall or a class (and nothing else opens a bubble)', () => {
  assert.deepEqual(anchorItem({ dataset: { item: 'planks', need: '2' } }), { id: 'planks', need: 2, more: null, cls: null });
  assert.deepEqual(anchorItem({ dataset: { hintItem: 'wood', hintMore: '3' } }), { id: 'wood', need: null, more: 3, cls: null });
  assert.deepEqual(anchorItem({ dataset: { item: 'wheat', hintCls: 'grain' } }), { id: 'wheat', need: null, more: null, cls: 'grain' });
  assert.equal(anchorItem({ dataset: { item: 'not_an_item' } }), null);
  assert.equal(anchorItem({ dataset: {} }), null);
  assert.equal(anchorItem(null), null);
});
