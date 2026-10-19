// Release 1.0 (life-feel): render/fx.js under a DOM stand-in. M15 (perf-a11y#6): an item icon that failed to load once
// is asked for again on a later pop, not a white dot for the whole session (the probe-once class). M5 (feel#2): every
// reward event has a visual — order, folk and quest deliveries fly their coins and XP even with no world position, a
// claim's loot pops from its button, a purchase sends one coin from the pill to the bought card — and every event of
// progress.FX_EVENTS has a recipe or is on the reviewed silent list below. M4 (feel#1): flights start at the button that
// caused them (`meta.from`) and fly in their own layer above the panels (#fx-top, z 60).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFxDom, StubEl, stubLayer, stubToScreen, sleep } from './helpers/life-feel.js';

const dom = installFxDom({ images: 'fail' });
const THREE = await import('three');
const { createFx } = await import('../public/js/render/fx.js');
const { FX_EVENTS } = await import('../shared/rules/index.js');

const at = (x = 10, z = 10) => new THREE.Vector3(x, 0, z);
const overlay = () => { const o = new StubEl('div'); dom.body.appendChild(o); return o; };
/** The HUD pills the flights aim at (ui-shell's #hud-coins-pill and friends), on screen in the stand-in. */
const pill = (x) => { const el = new StubEl('div'); el.rect = { left: x, top: 20, width: 90, height: 40 }; dom.body.appendChild(el); return el; };
const PILLS = { coins: pill(800), acorns: pill(940), barn: pill(1220), xp: pill(40) };
const make = () => { const fx = createFx(stubLayer(), overlay(), stubToScreen, { iconRetryMs: 0 }); fx.setTargets(PILLS); return fx; };

/** Flight layers' busy children: the DOM nodes a flight moved off-screen park at -999 px. */
function flightsIn(fx) { return fx.stats().flights; }

test('M15: an icon that failed to load is requested again on the next pop (no session-long white dot)', async () => {
  dom.images.images = 'fail';
  const fx = make();
  const before = dom.loads.filter((u) => u.includes('/icons/') && u.includes('blueberry')).length;
  fx.pop('blueberry', at());
  await sleep(20);                                  // the failed load settles
  fx.update(0.016);
  fx.pop('blueberry', at());
  await sleep(20);
  const after = dom.loads.filter((u) => u.includes('/icons/') && u.includes('blueberry')).length;
  assert.equal(after - before, 2, `the icon was asked for ${after - before} time(s); a failure must not be cached`);
});

test('M15: a loaded icon is kept (one request for many pops)', async () => {
  dom.images.images = 'ok';
  const fx = make();
  fx.pop('raspberry', at());
  await sleep(20);
  for (let i = 0; i < 4; i++) fx.pop('raspberry', at());
  await sleep(20);
  assert.equal(dom.loads.filter((u) => u.includes('raspberry')).length, 1);
  dom.images.images = 'fail';
});

test('M5: an order, a folk order and a quest delivery fly their rewards with no world position', () => {
  for (const ev of [{ e: 'orderFilled', slot: 0, coins: 40, xp: 6, acorns: 0 }, { e: 'folkFilled', i: 0, coins: 30, xp: 4, items: { wheat: 2 } },
    { e: 'questDelivered', id: 'q1', items: { wheat: 4 } }]) {
    const fx = make();
    fx.play(ev, null, { by: 'p1', local: true });
    assert.ok(flightsIn(fx) > 0, `${ev.e}: nothing flew (feel#2: an order is filled with no visual reward)`);
  }
});

test('M5: a claim\'s loot pops from its button; a purchase sends one coin from the pill to the bought card', () => {
  for (const ev of [{ e: 'seedBasket', crop: 'wheat', n: 6 }, { e: 'meterChest', i: 0, coins: 50, acorns: 1, items: { egg: 2 } },
    { e: 'almanacChest', items: { flour: 1 }, coins: 20 }, { e: 'trackClaimed', tier: 3, reward: { coins: 100 } },
    { e: 'gift', day: 3, coins: 40, acorns: 0, items: { wheat: 3 } }]) {
    const fx = make();
    fx.play(ev, null, { by: 'p1', local: true });
    assert.ok(flightsIn(fx) > 0, `${ev.e}: no loot flew`);
  }
  for (const ev of [{ e: 'purchased', item: 'wheat', qty: 1, coins: 5 }, { e: 'toolBought', tool: 'wide_sickle', coins: 900 },
    { e: 'wishBought', id: 'w1', def: 'well', coins: 300 }]) {
    const fx = make();
    fx.play(ev, null, { by: 'p1', local: true });
    assert.ok(flightsIn(fx) > 0, `${ev.e}: no coin left the purse`);
  }
});

test('M5: an upgrade with a place raises dust and confetti there', () => {
  for (const e of ['homeUpgraded', 'slotUpgraded', 'barnUpgraded']) {
    const fx = make();
    fx.play({ e, id: 'b1', coins: 100 }, at(), { by: 'p1', local: true });
    fx.update(0.016);
    assert.ok(fx.stats().particles > 0, `${e}: no particles`);
  }
});

test('M4: a flight starts at the button that caused it and flies in #fx-top above the panels', () => {
  const fx = make();
  const btn = new StubEl('button');
  btn.rect = { left: 600, top: 420, width: 120, height: 40 };
  dom.body.appendChild(btn);
  fx.play({ e: 'sold', item: 'wheat', qty: 26, coins: 52 }, null, { by: 'p1', local: true, from: btn });
  const layer = globalThis.document.getElementById('fx-top');
  assert.ok(layer, 'a #fx-top layer exists');
  const fl = layer.children.find((c) => c.anims.length && c.anims[0].frames?.[0]?.transform?.includes('translate3d(660px'));
  assert.ok(fl, 'the first coin starts at the Sell button\'s centre x (660)');
});

// Reviewed (life-feel, release 1.0): events that are bookkeeping, or whose feedback lives elsewhere (a panel, a toast,
// a celebration, the sky, avatars-view, crates-view, gift-view), so fx draws nothing for them on purpose.
const SILENT = new Map(Object.entries({
  pinned: 'a panel chip', bigSpend: 'the partner\'s toast (feedback.js)',
  regrown: 'the crop model swaps', rained: 'the weather', compostPoints: 'the compost meter', overflowed: 'the Barn toast',
  keepSet: 'a Barn switch', noFeedSet: 'a panel switch', wishAdded: 'a panel list', wishDeposit: 'the panel\'s meter',
  wishWithdrawn: 'the panel\'s meter', wishAsked: 'a panel line', wishDenied: 'a panel line', wishRemoved: 'a panel list',
  surplusUndone: 'the Undo toast', expansionOpened: 'the panel opens',
  restoreFlagged: 'a flag chip', townPosted: 'the board panel', breedCancelled: 'a panel line', furnishStored: 'the room panel', furnishRefunded: 'the room panel',
  slotGranted: 'the toast (feedback.js)', savingFor: 'a panel line',
  reordered: 'the queue panel', pairCancelled: 'the pen panel', petStay: 'avatars-view: the pet sits or follows',
  landRedrawn: 'the ground redraws', orderNew: 'the board panel', orderGone: 'the board panel', orderPinned: 'a chip',
  orderFlagged: 'a chip', orderRushed: 'the board panel', questStarted: 'the letter in the Journal', hearts: 'the You page',
  almanacRerolled: 'the panel', challengeStarted: 'the toast', weekRolled: 'the recap', noted: 'the notes panel',
  unnoted: 'the notes panel', thanked: 'the feed line', keepsake: 'gift-view: the box appears on the porch',
  giftOpened: 'gift-view: the box opens', named: 'naming.js: the carve moment', seated: 'avatars-view',
  stood: 'avatars-view', highFiveWait: 'avatars-view', tutorialStep: 'the coach card', seen: 'bookkeeping',
  titled: 'the rosette (levelup.js)', bargeFlagged: 'a chip', folkPosted: 'the board panel', folkFlagged: 'a chip',
  folkGifted: 'the toast', perkRefunded: 'the perks panel', rested: 'the XP bar', trackOpened: 'the track panel',
  trackClosed: 'the track panel',
  movedBack: 'the dust of `moved` plays', restored: 'the dust of `moved` plays', cancelled: 'the queue panel',
  duetPressed: 'the heart marker over the building (index.js)', paired: 'the pen panel shows the pair; hearts in its card',
  penBorn: 'the pen panel (the baby walks in, animals-view)', almanacDone: 'the celebration card',
}));

test('M5: every event of progress.FX_EVENTS has a recipe or is on the reviewed silent list', () => {
  const fx = make();
  const known = new Set(fx.recipes());
  const missing = [...FX_EVENTS].filter((e) => !known.has(e) && !SILENT.has(e));
  assert.deepEqual(missing, [], `no recipe and not reviewed as silent: ${missing.join(', ')}`);
  // and nothing on the silent list secretly has a recipe (the list stays honest)
  const both = [...SILENT.keys()].filter((e) => known.has(e));
  assert.deepEqual(both, [], `on the silent list but drawn: ${both.join(', ')}`);
});

test('S7 (feel#7): a refusal\'s reason floats at the object as ink on a paper slip for 1.4 s', () => {
  const fx = make();
  const ov = overlay();
  const fx2 = createFx(stubLayer(), ov, stubToScreen, { iconRetryMs: 0 });
  fx2.float(at(), 'Wheat · ready in 42 s', { kind: 'why', color: '#3E2612' });
  // (QA r4 L4-02: the slip floats in #fx-top, above the coach's arrow; a plain floater stays in the overlay)
  const outer = globalThis.document.getElementById('fx-top').children.at(-1);
  const inner = outer?.children[0];
  assert.ok(inner, 'a floater');
  assert.match(inner.className, /floater--paper/, 'the paper look');
  assert.equal(inner.style.color, '#3E2612', 'ink');
  assert.equal(inner.style.textShadow, 'none', 'no cartoon outline on paper');
  assert.equal(inner.anims.at(-1)?.opts?.duration, 1400, '1.4 s');
  // a plain floater keeps its outlined look
  fx2.float(at(), '+3 Wheat', {});
  const plain = ov.children.at(-1).children[0];
  assert.doesNotMatch(plain.className, /paper/);
  void fx;
});

test('G11b: the twinkle shader carries the same glint scale as glintScale()', async () => {
  const { shaders, GLINT } = await import('../public/js/render/fx.js');
  make();
  assert.match(shaders.twinkle, new RegExp(`smoothstep\\(${GLINT.from.toFixed(1)}, ${GLINT.to.toFixed(1)}, -mv\\.z\\)`));
  assert.ok(shaders.twinkle.includes(GLINT.far.toFixed(4)));
});
