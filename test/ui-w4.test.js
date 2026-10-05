// ui lane, wave 4 (the owners' wish list, 2026-10-04): the adapter to the new rules (w4-rules.js), the new panels
// (upgrades, selling stored decor, "Your look") and the wave-4 parts of the pets, perks, settings, tooltip and tracker,
// mounted in the ui tests' tiny DOM on farms built by the real rules. Every button sends exactly the action and args the
// rules take, and asks first where the owners asked for a guard (a perk, a sale).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { defOf, PETS, AVATAR_LOOKS } from '../shared/content/index.js';
import { ACTIONS } from '../shared/rules/index.js';
import { farmAt, put, give, actOk, MONDAY, HOUR, DAY } from './helpers/rules-goals.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

let W;
let P;
before(async () => {
  // the boot's adapter and the lazy panels' readers, as one namespace
  W = { ...await import('../public/js/ui/panels/w4-rules.js'), ...await import('../public/js/ui/panels/w4-model.js') };
  P = {
    upgrades: await import('../public/js/ui/panels/upgrades.js'),
    decor: await import('../public/js/ui/panels/decor-sell.js'),
    avatar: await import('../public/js/ui/panels/avatar.js'),
    pets: await import('../public/js/ui/panels/pets.js'),
    perks: await import('../public/js/ui/panels/perks.js'),
    flows: await import('../public/js/ui/panels/w4-flows.js'),
    hub: await import('../public/js/ui/panels/w4.js'),
    hud: await import('../public/js/ui/hud.js'),
    settings: await import('../public/js/ui/settings.js'),
  };
});

const JUNK = /undefined|NaN|\[object|null\b/;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A panel ctx over a plain state, recording what the panel sends and what it asks. */
function ctxOf(state, { pid = 'p1', now = MONDAY + HOUR, name = 'x', args = {}, answer = true } = {}) {
  const acts = [];
  const asked = [];
  const toasts = [];
  const opened = [];
  const body = document.createElement('div');
  document.body.append(body);              // connected, as in the game: the kit drops buttons that left the page
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ui = {
    panels: { open: (n, a) => { opened.push([n, a]); return true; }, has: () => true, isOpen: () => false, badge() {}, on: () => () => {} },
    confirm: (o) => { asked.push(o); return Promise.resolve(answer); },
    toast: (t, o) => { toasts.push([t, o]); },
  };
  const ctx = {
    name, args, store, body, el: body, now: () => now, tab: null, ui,
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    open: (n, a) => opened.push([n, a]), close: () => opened.push(['close']), setTitle() {}, refreshTabs() {},
    controller: { do: (t, a) => { acts.push([t, a]); return { ok: true }; } },
  };
  return { ctx, body, acts, asked, toasts, opened, store, ui };
}

function mount(spec, state, o = {}) {
  const r = ctxOf(state, o);
  spec.mount(r.body, r.ctx);
  const text = textOf(r.body);
  assert.ok(!JUNK.test(text), `junk in ${o.name}: ${text.match(/.{0,40}(undefined|NaN|\[object|null\b).{0,40}/)?.[0]}`);
  return { ...r, text };
}

const buttons = (el, label) => el.querySelectorAll('button').filter((b) => textOf(b).trim().startsWith(label));
const objOf = (s, def) => Object.keys(s.farm.objects).sort().find((k) => s.farm.objects[k].def === def);

// ---- the adapter -------------------------------------------------------------------------------------------------

test('w4-rules: every wave-4 action resolves to the name the rules registered', () => {
  for (const [key, want] of [['upgrade', 'upgradeObject'], ['sellStored', 'sellStored'], ['sellPlaced', 'sellObject'],
    ['perkRefund', 'perkRefund'], ['petBreed', 'petBreed'], ['setAvatar', 'setAvatar'], ['fertilize', 'fertilize'], ['restore', 'restore']]) {
    if (!ACTIONS[want]) continue;                       // a build without it: the adapter says so instead
    assert.equal(W.actFor(key), want, key);
    assert.equal(W.canAct(key), true, key);
  }
  assert.equal(W.takesArg('adoptPet', 'breed'), Boolean(ACTIONS.adoptPet?.schema?.breed));
});

test('w4-rules: upgrade tiers of the Well, owned / next / later, bonus lines in words', () => {
  const s = farmAt(30);
  const well = objOf(s, 'well');
  const v = W.upgradeInfo(s, well);
  assert.equal(v.target, 'well');
  assert.equal(v.tier, 0);
  assert.ok(v.max >= 2);
  assert.equal(v.next.n, 1);
  assert.ok(v.tiers.every((t) => t.name && t.coins > 0 && Array.isArray(t.lines)));
  assert.match(v.tiers[0].lines.map((l) => l.text).join(), /Watering saves/);
  s.farm.objects[well].up = 1;
  const v2 = W.upgradeInfo(s, well);
  assert.equal(v2.now.n, 1);
  assert.equal(v2.tiers[0].owned, true);
  assert.equal(v2.next.n, 2);
  assert.equal(W.upgradeInfo(s, objOf(s, 'barn')), null, 'the Barn has its own ladder');
  const list = W.upgradeList(s);
  assert.equal(list[0].target, 'farmhouse', 'the farmhouse first');
  assert.deepEqual(W.bonusLines({ barnCap: 30, restedBp: 2500 }).map((l) => l.text), ['+30 Barn space', 'Rested XP builds 25 % faster']);
  assert.deepEqual(W.bonusLines({ goldenMs: 10 * 60_000 }).map((l) => l.text), ['Golden Hour lasts 10 min longer here']);
});

test('w4-rules: the look catalog is content\'s, the default look is the slot\'s, colours go out upper-case', () => {
  if (AVATAR_LOOKS) {
    assert.deepEqual(W.LOOKS.hair.map((x) => x.id), AVATAR_LOOKS.hair.map((x) => x.id ?? x));
    assert.ok(W.LOOKS.hairColor.every((c) => /^#[0-9A-F]{6}$/.test(c.id)));
  }
  const s = farmAt(5);
  const a = W.lookOf(s, 'p1');
  const b = W.lookOf(s, 'p2');
  assert.equal(a.body, 'farmer_a');
  assert.equal(b.body, 'farmer_b');
  s.players.p1.avatar = { hat: 'cap', top: '#aabbcc' };
  assert.equal(W.lookOf(s, 'p1').hat, 'cap');
  assert.equal(W.lookOf(s, 'p1').top, '#AABBCC');
  assert.deepEqual(Object.keys(W.lookPatch(W.lookOf(s, 'p1'))).sort(), ['body', 'bottom', 'hair', 'hairColor', 'hat', 'skin', 'top']);
});

test('w4-rules: breeds come from content, a pet without one shows its kind\'s first', () => {
  for (const k of PETS.kinds) assert.ok(W.breedsOf(k.id).length >= 3, k.id);
  assert.equal(W.breedOf({ kind: 'dog' }), W.breedsOf('dog')[0].id);
  assert.equal(W.breedOf({ kind: 'cat', breed: 'black' }), 'black');
  assert.match(W.breedName('dog', 'shepherd'), /Shepherd/);
});

test('settings: right-drag pans or rotates the camera; the controller\'s option wins, the value is sanitised', () => {
  assert.equal(P.settings.sanitize({}).rightDrag, 'pan');
  assert.equal(P.settings.sanitize({ rightDrag: 'rotate' }).rightDrag, 'rotate');
  assert.equal(P.settings.sanitize({ rightDrag: 'spin' }).rightDrag, 'pan');
});

test('rotate fallback: the next quarter turn keeps a 2 x 1 bench about its centre', () => {
  const spots = P.flows.turnSpots({ x: 10, z: 10, rot: 0 }, { size: [2, 1] });
  assert.equal(spots[0].rot, 1);
  assert.ok(spots.some((p) => p.rot === 1 && p.x === 10 && p.z === 10));
  assert.ok(spots.some((p) => p.rot === 2 && p.x === 10 && p.z === 10), 'a half turn always fits where it stands');
});

// ---- panels --------------------------------------------------------------------------------------------------------

test('upgrades panel: the farmhouse first, a tier ladder, Upgrade sends upgradeObject on that object', () => {
  if (!ACTIONS.upgradeObject) return;
  const s = farmAt(30);
  give(s, 'planks', 40);
  give(s, 'wooden_crate', 10);
  s.farm.wallet.coins = 500_000;
  const well = objOf(s, 'well');
  const { body, text, acts } = mount(P.upgrades.upgradesPanel, s, { name: 'upgrades', args: { id: well } });
  assert.match(text, /Well/);
  assert.match(text, /Not upgraded yet/);
  assert.equal(body.querySelectorAll('.up-tier').length, W.upgradeInfo(s, well).max);
  assert.ok(body.querySelectorAll('.up-tab').length >= 3, 'farmhouse, stand and well to switch between');
  buttons(body, 'Upgrade ·')[0].click();
  assert.deepEqual(acts.at(-1), ['upgradeObject', { id: well }]);
  // a tier above the farm's level: locked with its level, no button
  const low = farmAt(5);
  const l = mount(P.upgrades.upgradesPanel, low, { name: 'upgrades', args: { target: 'farmhouse' } });
  assert.match(l.text, /Level \d+/);
});

test('sell stored decor: what each fetches, a confirm, then sellStored { def }; a gift says the shop pays nothing', async () => {
  if (!ACTIONS.sellStored) return;
  const s = farmAt(20);
  s.farm.storage.flower_bed = 2;
  s.farm.storagePaid.flower_bed = 2;
  s.farm.storage.bunting = 1;
  const { body, text, acts, asked } = mount(P.decor.decorSellPanel, s, { name: 'decorSell' });
  assert.match(text, /Flower Bed/);
  assert.match(text, /2 in the tray/);
  assert.match(text, /Sells for/);
  const row = body.querySelectorAll('.ds-row').find((r) => r.dataset.def === 'flower_bed');
  row.querySelector('button').click();
  await tick();
  await tick();
  assert.match(asked.at(-1).title, /Sell a Flower Bed\?/);
  assert.deepEqual(acts.at(-1), ['sellStored', { def: 'flower_bed' }]);
  const gift = W.sellStoredQuote(s, 'bunting');
  if (gift && !gift.coins && !gift.acorns) assert.match(text, /A gift: the shop pays nothing/);
});

test('sell placed decor: the rules\' resale share is quoted, Keep it sends nothing, Sell it sends sellObject', async () => {
  const s = farmAt(20);
  const id = put(s, 'flower_bed', { paid: { coins: 160, acorns: 0 } });
  assert.deepEqual(W.sellPlacedQuote(s, id, MONDAY), { coins: 80, acorns: 0, undo: false });
  const no = ctxOf(s, { answer: false });
  await P.flows.sellPlaced({ store: no.store, controller: no.ctx.controller, ui: no.ui }, id);
  assert.equal(no.acts.length, 0);
  assert.match(no.asked[0].lead, /80 coins/);
  const yes = ctxOf(s);
  await P.flows.sellPlaced({ store: yes.store, controller: yes.ctx.controller, ui: yes.ui }, id);
  assert.deepEqual(yes.acts.at(-1), ['sellObject', { id }]);
  assert.match(yes.toasts.at(-1)[0], /Sold the Flower Bed for 80 coins/);
});

test('your look: a pick changes only the preview; Save sends setAvatar with every field, upper-case colours', () => {
  if (!ACTIONS.setAvatar) return;
  const s = farmAt(5);
  const { body, acts } = mount(P.avatar.avatarPanel, s, { name: 'avatar' });
  const save = buttons(body, 'Save my look')[0];
  assert.equal(save.getAttribute('aria-disabled'), 'true', 'nothing to save yet');
  const hat = body.querySelectorAll('.av-opt').find((b) => b.dataset.v === W.LOOKS.hats.at(-1).id);
  hat.click();
  assert.equal(acts.length, 0, 'a pick only changes the preview');
  const pink = body.querySelectorAll('.av-opt').find((b) => b.dataset.v === W.LOOKS.hairColor.at(-1).id);
  pink.click();
  buttons(body, 'Save my look')[0].click();
  const [type, args] = acts.at(-1);
  assert.equal(type, 'setAvatar');
  assert.equal(args.hat, W.LOOKS.hats.at(-1).id);
  assert.equal(args.hairColor, W.LOOKS.hairColor.at(-1).id.toUpperCase());
  assert.equal(ACTIONS.setAvatar.check(s, args, { pid: 'p1', now: MONDAY }), null, 'the rules take it');
});

test('pets: the adoption takes a breed; my pet\'s breed changes from its card; both show a breed portrait', () => {
  const s = farmAt(12);
  const a = mount(P.pets.petsPanel, s, { name: 'pets' });
  assert.match(a.text, /Adopt your pet/);
  if (W.takesArg('adoptPet', 'breed')) {
    assert.match(a.text, /Husky/);
    a.body.querySelectorAll('.pc-breed').find((b) => b.dataset.breed === 'shiba').click();
    buttons(a.body, 'Adopt')[0].click();
    assert.equal(a.acts.at(-1)[0], 'adoptPet');
    assert.equal(a.acts.at(-1)[1].breed, 'shiba');
  }
  actOk(s, 'adoptPet', { kind: 'cat', name: 'Miso' }, { now: MONDAY });
  const b = mount(P.pets.petsPanel, s, { name: 'pets' });
  assert.ok(b.body.querySelector('.pc-pet-face'), 'a portrait');
  assert.match(b.text, /Orange Tabby|Orange/);
  if (ACTIONS.petBreed) {
    b.body.querySelectorAll('.pc-breed').find((x) => x.dataset.breed === 'black').click();
    assert.deepEqual(b.acts.at(-1), ['petBreed', { breed: 'black' }]);
  }
});

test('perks: past the free weekly reset a reset costs Acorns (asked first); the newest perk of a tree is refunded', async () => {
  if (!ACTIONS.perkRefund) return;
  const { forceM2Goals } = await import('./helpers/rules-goals.js');
  await forceM2Goals();
  const s = farmAt(33);
  s.players.p1.xp = s.farm.xp;
  s.farm.wallet.acorns = 50;
  actOk(s, 'perkPick', { tree: 'grower' }, { now: MONDAY });
  actOk(s, 'perkPick', { tree: 'grower' }, { now: MONDAY });
  actOk(s, 'perkRespec', {}, { now: MONDAY });                 // the free one of the week
  actOk(s, 'perkPick', { tree: 'grower' }, { now: MONDAY + HOUR });
  const now = MONDAY + 2 * HOUR;
  const { body, text, acts, asked } = mount(P.perks.perksPanel, s, { name: 'perks', now });
  assert.match(text, /Unlearn Green Thumb/);
  const price = W.perkPrices().respecAcorns();
  assert.match(text, new RegExp(`Reset now · ${price}`));
  buttons(body, 'Reset now')[0].click();
  await tick();
  assert.equal(asked.at(-1).cost.acorns, price);
  assert.deepEqual(acts.at(-1), ['perkRespec', { paid: true }]);
  buttons(body, 'Unlearn')[0].click();
  await tick();
  assert.match(asked.at(-1).title, /Unlearn Green Thumb\?/);
  assert.deepEqual(acts.at(-1), ['perkRefund', { tree: 'grower' }]);
  void DAY;
});

// ---- HUD bits ------------------------------------------------------------------------------------------------------

test('world tooltip: Fertilizer is named on a crop; an upgradable thing says its tier', () => {
  const s = farmAt(30);
  const id = put(s, 'plot', { crop: { def: 'wheat', plantedAt: MONDAY, readyAt: MONDAY + DAY, by: 'p1', cycle: 0, cut: 0, fert: 'p2' } });
  const t = P.hud.worldTip(s, { kind: 'object', id }, MONDAY + HOUR, 'p1');
  assert.ok(t.lines.some((l) => /^Fertilizer by Mia|^Fertilizer by /.test(l)), t.lines.join(' | '));
  const well = objOf(s, 'well');
  s.farm.objects[well].up = 1;
  const w = P.hud.worldTip(s, { kind: 'object', id: well }, MONDAY, 'p1');
  assert.ok(w.lines.some((l) => /^Upgrades ★1 of \d/.test(l)), w.lines.join(' | '));
});

test('the partner\'s sale and upgrade reach my screen as one short line', () => {
  const s = farmAt(10);
  assert.match(P.hub.partnerLine({ e: 'upgraded', def: 'well', name: 'Stone Rim', tier: 1 }, s, 'p2').text, /upgraded the Well: Stone Rim/);
  assert.match(P.hub.partnerLine({ e: 'removed', def: 'flower_bed', reason: 'sell', coins: 80 }, s, 'p2').text, /sold the Flower Bed \(80 coins\)/);
  assert.equal(P.hub.partnerLine({ e: 'removed', def: 'chicken', reason: 'sell' }, s, 'p2'), null, 'animals have their own lines');
  assert.equal(P.hub.partnerLine({ e: 'planted' }, s, 'p2'), null);
});

test('lazyPanel: a quiet wait, then the module mounts; closed before it loads, it never mounts', async () => {
  let mounted = 0;
  const spec = P.hub.lazyPanel({ title: 'T' }, () => Promise.resolve({ mount: (b) => { mounted++; b.append('ready'); return { update() {} }; } }));
  const r = ctxOf(farmAt(1), { name: 'lazy' });
  spec.mount(r.body, r.ctx);
  assert.match(textOf(r.body), /One moment/);
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(mounted, 1);
  assert.match(textOf(r.body), /ready/);
  const r2 = ctxOf(farmAt(1), { name: 'lazy' });
  const inst = spec.mount(r2.body, r2.ctx);
  inst.destroy();
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(mounted, 1);
  void defOf;
});
