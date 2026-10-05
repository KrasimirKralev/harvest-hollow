// The M1b goals systems under random interleavings (forced live whatever MILESTONE says): two players over two
// farm weeks fill townsfolk requests, enter the Fair, load and flag barge crates, trade album duplicates, while the
// scheduler runs the weekly system actions. Every action decides the same on a key-reversed twin, every event is
// classified, the state stays valid, the ledger balances, and no week pays its ceremony or a barge row twice.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { CELEBRATIONS, FX_EVENTS } from '../shared/rules/index.js';
import { START } from '../shared/content/config.js';
import { validateState } from '../shared/rules/state.js';
import { dayOf } from '../shared/rules/coop.js';
import {
  farmAt, put, give, runDue, runTwin, mulberry32, forceM1bGoals, MONDAY, MIN, HOUR, DAY as DAY_MS,
} from './helpers/rules-goals.js';

before(forceM1bGoals);
const ALL = new Set([...FX_EVENTS, ...CELEBRATIONS]);
const GOODS = ['bread', 'sweetheart_cake', 'golden_egg', 'corn_bread', 'apple', 'pumpkin', 'wool', 'cheese', 'flour',
  'strawberry_jam', 'cookies', 'egg', 'butter', 'apple_juice', 'veggie_soup'];

function randomAction(rnd, s) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  switch (pick(['fairEnter', 'bargeLoad', 'bargeFlag', 'albumTrade', 'folkFill', 'folkGift', 'markSeen', 'memoryPage'])) {
    case 'memoryPage': return ['memoryPage', { k: pick(['photo', 'golden', 'duet', 'quest']), ref: 'h1' }];
    case 'fairEnter': return ['fairEnter', { item: pick(GOODS), qty: 1 + Math.floor(rnd() * 6),
      ...(rnd() < 0.3 ? { confirm: ['RESERVED'] } : {}) }];
    case 'bargeLoad': case 'bargeFlag': {
      const keys = Object.keys(s.farm.barge.crates);
      const i = keys.length && rnd() < 0.85 ? Number(pick(keys)) : Math.floor(rnd() * 9);
      // mostly the goods are there (a player loads what the Barn holds), sometimes not
      if (rnd() < 0.7 && s.farm.barge.crates[String(i)]) give(s, s.farm.barge.crates[String(i)].item, s.farm.barge.crates[String(i)].qty);
      return [pick(['bargeLoad', 'bargeLoad', 'bargeFlag']), { i }];
    }
    case 'albumTrade': return ['albumTrade', { set: pick(['feathers', 'feathers', 'lost_tools']),
      want: pick(['golden_feather_piece', 'peacock_feather', 'rusty_trowel', 'copper_feather']) }];
    case 'folkFill': {
      const i = Math.floor(rnd() * 3);
      const post = s.farm.folk.posts[String(i)];
      if (post && rnd() < 0.6) for (const [it, q] of Object.entries(post.items)) give(s, it, q);
      return [pick(['folkFill', 'folkFill', 'folkFlag']), { i, n: rnd() < 0.85 ? s.farm.folk.posts[String(i)]?.n ?? 0
        : Math.floor(rnd() * 30) }];
    }
    case 'folkGift': return ['folkGift', { npc: pick(['mabel', 'rosie', 'tom', 'lucia', 'pip']), item: pick(GOODS) }];
    default: return ['markSeen', { kind: 'fair', id: String(s.farm.fair.last?.w ?? 0) }];
  }
}

test('M1b goals actions decide the same on a key-reversed twin; weeks pay once; the state stays valid', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const rnd = mulberry32(seed * 7919);
    const s = farmAt(21 + Math.floor(rnd() * 5), { seed, now: MONDAY });
    for (let i = 0; i < 4; i++) put(s, 'apple_tree');
    const coop = put(s, 'coop');
    for (let i = 0; i < 3; i++) put(s, 'chicken', { home: coop });
    for (const b of ['bakery', 'kitchen', 'dairy', 'preserves', 'juice_press']) put(s, b);
    const day = dayOf(s, MONDAY);
    for (const item of GOODS) s.farm.made[item] = day;
    // an album with duplicates to trade (the doubled Gold rolls of M2 make them; here they are given)
    s.farm.album.sets.feathers = { r: 30, pity: 2, done: null, items: {
      speckled_feather: { by: 'p1', at: MONDAY, n: 4 }, barred_feather: { by: 'p2', at: MONDAY, n: 4 } } };
    let now = MONDAY;
    let seq = 0;
    const paid = { ceremonies: new Set(), rows: new Set() };
    for (let i = 0; i < 140; i++) {
      now += Math.floor(rnd() * 3 * HOUR) + MIN;
      for (const type of runDue(s, now)) void type;
      if (s.farm.fair.last) {
        const k = `${s.farm.fair.last.w}`;
        paid.ceremonies.add(k);
      }
      if (rnd() < 0.4) give(s, GOODS[Math.floor(rnd() * GOODS.length)], 1 + Math.floor(rnd() * 12));
      const [type, args] = randomAction(rnd, s);
      const pid = rnd() < 0.5 ? 'p1' : 'p2';
      const r = runTwin(s, type, args, { now, pid, cid: `fz${pid}m`, seq: ++seq });
      if (!r.ok) continue;
      for (const ev of r.tx.events) {
        assert.ok(ALL.has(ev.e), `event ${ev.e} is neither FX nor a celebration`);
        if (ev.e === 'bargeRow') {
          const k = `${ev.w}:${ev.row}`;
          assert.ok(!paid.rows.has(k), `barge row ${k} paid twice`);
          paid.rows.add(k);
        }
      }
    }
    assert.deepEqual(validateState(s), [], `seed ${seed}`);
    const st = s.farm.stats;
    const ledger = START.coins + (st['coins.earned'] ?? 0) + (st['coins.granted'] ?? 0) + (st['coins.refunded'] ?? 0)
      - (st['coins.spent'] ?? 0);
    assert.equal(s.farm.wallet.coins, ledger, `seed ${seed}: the ledger does not balance`);
    // each Fair week held at most one ceremony: medalWeeks never exceeds the weeks seen
    assert.ok((st.medalWeeks ?? 0) <= paid.ceremonies.size + 1);
    for (const n of Object.values(s.farm.folk.f)) assert.ok(n.v <= 10);
  }
});

test('the scheduler with the weekly systems: every due action clears its condition, the next due time is ahead', async () => {
  const { dueSystemActions, nextSystemDueAt } = await import('../shared/rules/system.js');
  for (let seed = 1; seed <= 4; seed++) {
    const rnd = mulberry32(seed * 104_729);
    const s = farmAt(14 + Math.floor(rnd() * 12), { seed, now: MONDAY });
    let now = MONDAY - Math.floor(rnd() * 7) * DAY_MS;
    for (let i = 0; i < 30; i++) {
      // jumps from minutes to two weeks (the server off over a weekend, a holiday)
      now += Math.floor(rnd() < 0.7 ? rnd() * 12 * HOUR : rnd() * 15 * DAY_MS) + MIN;
      runDue(s, now);
      assert.deepEqual(dueSystemActions(s, now), []);
      const next = nextSystemDueAt(s, now);
      assert.ok(next > now && next <= now + 8 * DAY_MS, `seed ${seed}: next due ${next - now} ms ahead`);
      if (s.farm.fair.cur?.open) assert.equal(s.farm.fair.cur.w, Math.floor((dayOf(s, now) + 3) / 7));
    }
    assert.deepEqual(validateState(s), []);
  }
});
