// Random interleavings of every goals action (and the system actions they cause) by two players: every action
// decides the same on a key-reversed twin of the state (review-m0 #7), every event is classified FX or celebration,
// ops/undo round-trip (act() checks), the state stays valid, Hearts / Acorns / coins never go negative, and the
// ledger balances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELEBRATIONS, FX_EVENTS } from '../shared/rules/index.js';
import { CONTENT, isLive, TUTORIAL } from '../shared/content/index.js';
import { START } from '../shared/content/config.js';
import { validateState } from '../shared/rules/state.js';
import { feedRows } from '../shared/rules/feed.js';
import { farmAt, put, give, runDue, runTwin, mulberry32, GOALS_PLAYER_ACTIONS, T0, MIN } from './helpers/rules-goals.js';

const ALL = new Set([...FX_EVENTS, ...CELEBRATIONS]);

function randomGoalsAction(rnd, s, bench, hen) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const slot = () => Math.floor(rnd() * 6);
  const type = pick(GOALS_PLAYER_ACTIONS);
  switch (type) {
    case 'orderRush':
      return [type, { slot: slot() }];
    case 'orderFill': case 'orderDiscard': case 'orderPin': case 'orderFlag': {
      const k = slot();
      // mostly the order on screen, sometimes a stale number (RC-07: answered NOT_FOUND, never another order)
      const n = rnd() < 0.8 ? s.farm.orders?.slots?.[String(k)]?.order?.n ?? 0 : Math.floor(rnd() * 40);
      return [type, rnd() < 0.3 ? { slot: k, n, confirm: ['PINNED'] } : { slot: k, n }];
    }
    case 'questDeliver': return [type, { id: pick(['b2', 'a1', 'a5']) }];
    case 'titlePick': return [type, rnd() < 0.5 ? {} : { ribbon: 'cream_of_the_crop' }];
    case 'claimGift': return [type, {}];
    case 'almanacReroll': return [type, { slot: Math.floor(rnd() * 4) }];
    case 'noteAdd': return [type, { x: 20 + Math.floor(rnd() * 10), z: 20, text: `note ${Math.floor(rnd() * 99)}` }];
    case 'noteDel': return [type, { id: pick(Object.keys(s.farm.notes).concat(['zz.1.0'])) }];
    case 'nameFarm': return [type, { name: pick(['Hollow', 'Sunny', 'Acres']) }];
    case 'nameAnimal': return [type, { id: hen, name: pick(['Clover', 'Daisy']) }];
    case 'markSeen': return [type, pick([{ kind: 'level', level: 1 + Math.floor(rnd() * 6) }, { kind: 'card', id: 'orders' },
      { kind: 'tip', id: 'sickle' }, { kind: 'beat', id: 'two_pairs' }])];
    case 'sit': return [type, { id: bench }];
    case 'stand': return [type, {}];
    case 'highFive': return [type, {}];
    case 'keepsake': return [type, rnd() < 0.5 ? { item: 'wheat' } : { item: 'egg', confirm: ['RESERVED'] }];
    case 'thank': {
      const rows = feedRows(s).map(([i]) => i);
      return [type, { i: rows.length ? pick(rows) : 0 }];
    }
    case 'tutDone': return [type, { step: pick(['welcome', 'say_hello', 'name_farm']) }];
    case 'tutSkip': return [type, rnd() < 0.2 ? { all: 'yes' } : {}];
    case 'tutSwap': return [type, {}];
    case 'tutRestart': return [type, {}];
    case 'fairEnter': return [type, { item: pick(['bread', 'sweetheart_cake', 'golden_egg', 'wheat', 'corn_bread']),
      qty: 1 + Math.floor(rnd() * 4), ...(rnd() < 0.3 ? { confirm: ['RESERVED'] } : {}) }];
    case 'bargeLoad': case 'bargeFlag': return [type, { i: Math.floor(rnd() * 9) }];
    case 'albumTrade': return [type, { set: pick(['feathers', 'recipe_cards', 'nope']), want: pick(['speckled_feather',
      'recipe_jam', 'x']) }];
    case 'folkFill': case 'folkFlag': {
      const i = Math.floor(rnd() * 3);
      const n = rnd() < 0.8 ? s.farm.folk?.posts?.[String(i)]?.n ?? 0 : Math.floor(rnd() * 20);
      return [type, { i, n }];
    }
    case 'folkGift': return [type, { npc: pick(['mabel', 'rosie', 'tom', 'hazel']), item: pick(['strawberry_jam',
      'flour', 'egg', 'bread', 'cookies']), ...(rnd() < 0.3 ? { confirm: ['RESERVED'] } : {}) }];
    case 'memoryPage': return [type, { k: pick(['photo', 'golden', 'duet']), ...(rnd() < 0.5 ? { text: 'us' } : {}) }];
    // M2 (wave 3)
    case 'perkPick': return [type, { tree: pick(['grower', 'rancher', 'orchardist', 'artisan']) }];
    case 'perkRespec': return [type, rnd() < 0.5 ? { paid: true, confirm: ['BIG_SPEND'] } : {}];
    case 'perkRefund': return [type, { tree: pick(['grower', 'rancher', 'orchardist', 'artisan']),
      ...(rnd() < 0.5 ? { confirm: ['BIG_SPEND'] } : {}) }];
    case 'trackClaim': return [type, { tier: 1 + Math.floor(rnd() * 32) }];
    case 'coatWear': return [type, { id: hen, coat: pick(['russet', 'frost', 'blossom', 'nope']) }];
    case 'duelInvite': return [type, { kind: pick(['pumpkins', 'pies', 'orders']) }];
    case 'duelAccept': case 'duelDecline': case 'duelCancel': return [type, {}];
    default: throw new Error(`fuzzer has no args for ${type}`);
  }
}

test('every goals action decides the same whatever the key order; the state stays valid and balanced', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rnd = mulberry32(seed);
    const s = farmAt(2 + Math.floor(rnd() * 9), { seed });
    const bench = put(s, 'sunset_bench');
    const coop = put(s, 'coop');
    const hen = put(s, 'chicken', { home: coop });
    let now = T0;
    let seq = 0;
    runDue(s, now);
    for (let i = 0; i < 150; i++) {
      now += Math.floor(rnd() * 6 * MIN);
      runDue(s, now);
      if (rnd() < 0.15) give(s, ['wheat', 'egg', 'carrot', 'corn'][Math.floor(rnd() * 4)], 1 + Math.floor(rnd() * 10));
      const [type, args] = randomGoalsAction(rnd, s, bench, hen);
      const pid = rnd() < 0.5 ? 'p1' : 'p2';
      const other = pid === 'p1' ? 'p2' : 'p1';
      const ext = rnd() < 0.5 ? { online: ['p1', 'p2'], avatar: { [other]: Math.floor(rnd() * 40) } } : {};
      const r = runTwin(s, type, args, { now, pid, cid: `fz${pid}x`, seq: ++seq, ext });
      if (r.ok) for (const ev of r.tx.events) assert.ok(ALL.has(ev.e), `event ${ev.e} is neither FX nor a celebration`);
    }
    assert.deepEqual(validateState(s), [], `seed ${seed}`);
    for (const pid of ['p1', 'p2']) assert.ok(s.players[pid].hearts >= 0);
    const st = s.farm.stats;
    const ledger = START.coins + (st['coins.earned'] ?? 0) + (st['coins.granted'] ?? 0) + (st['coins.refunded'] ?? 0)
      - (st['coins.spent'] ?? 0);
    const held = Object.values(s.farm.wishlist ?? {}).reduce((n, w) => n + (w.coins ?? 0), 0);
    assert.equal(s.farm.wallet.coins + held, ledger, `seed ${seed}: the ledger does not balance`);
  }
});

test('the fuzzer covers every goals player action', () => {
  const rnd = mulberry32(1);
  const s = farmAt(4);
  for (const type of GOALS_PLAYER_ACTIONS) assert.equal(randomGoalsAction(() => GOALS_PLAYER_ACTIONS.indexOf(type) / GOALS_PLAYER_ACTIONS.length + 1e-9, s, 'b', 'h')[0], type);
  assert.ok(rnd && CONTENT && isLive && TUTORIAL);
});
