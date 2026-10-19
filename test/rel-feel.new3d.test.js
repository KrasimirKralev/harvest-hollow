// Release 1.0 (life-feel): the 3D of the new features. D1 (features#F1): render/gift-view.js draws each waiting surprise
// as four instances of the existing dynamic batch (no draw call of its own), the ribbon in the giver's colour; it pops
// in, hops now and then, and opens with petals and confetti (no Hearts: scope M30), then leaves. D4 (features#F4):
// render/name-tags.js puts a tag over NAMED animals only, in the namer's colour with a dark outline, at most 24, in a
// #name-tags layer under the HUD (z 8), on a desktop in the near band or on hover, on a phone with the home card open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFxDom, StubEl } from './helpers/life-feel.js';

const dom = installFxDom();
// a desktop: a fine pointer and the desktop layout; a phone: neither (the touch layout query matches)
// (live, like a browser's MediaQueryList: name-tags.js keeps the list and reads `matches` each frame)
globalThis.matchMedia = (q) => ({ get matches() { return /hover: hover/.test(q) ? desktop : /max-width: 1180px/.test(q) ? !desktop : false; } });
let desktop = true;
const THREE = await import('three');
const { createGiftView, giftsOf, GIFT, GIFT_KEYS } = await import('../public/js/render/gift-view.js');
const { createNameTags, tagWanted, pickTags, NAME_TAGS, readableOnOutline, contrastRatio } = await import('../public/js/render/name-tags.js');
const { makeFarm, T0 } = await import('./helpers.js');

/** The dynamic batch as gift-view uses it: add / remove / setMatrix / setColor / setVisible / define. */
function fakeDyn() {
  const live = new Map();
  let n = 0;
  return {
    live,
    define() {},
    add(key, m, color) { const h = n++; live.set(h, { key, color: color ? `#${color.getHexString()}` : null, visible: true, m: m.clone() }); return h; },
    remove(h) { live.delete(h); },
    setMatrix(h, m) { const r = live.get(h); if (r) r.m = m.clone(); },
    setColor(h, c) { const r = live.get(h); if (r) r.color = `#${c.getHexString()}`; },
    setVisible(h, v) { const r = live.get(h); if (r) r.visible = v; },
  };
}
function fakeFx() {
  const log = [];
  return { log, burst: (kind) => log.push(['burst', kind]), ring: () => log.push(['ring']), float: (p, text) => log.push(['float', text]),
    twinkle: (k, pos) => log.push(['twinkle', k, Boolean(pos)]), pop: () => log.push(['pop']), fly: () => log.push(['fly']) };
}
function farmWithGift() {
  const s = makeFarm();
  s.players.p2.color = '#FF7A6B';
  s.farm.gifts = { 'gift.p2.1': { by: 'p2', to: 'p1', item: 'rose', at: T0 } };
  s.farm.objects['gift.p2.1'] = { def: 'gift_box', x: 20, z: 30, rot: 0, placedAt: T0, by: 'p2' };
  return s;
}

test('D1: a waiting surprise is four instances of the dynamic batch, the ribbon in the giver\'s colour', () => {
  const s = farmWithGift();
  assert.deepEqual(giftsOf(s).map((g) => [g.id, g.by, g.color]), [['gift.p2.1', 'p2', '#FF7A6B']]);
  const dyn = fakeDyn();
  const gifts = createGiftView({ dyn, fx: fakeFx() });
  gifts.setState(s, T0);
  assert.equal(dyn.live.size, 4, 'body, band, lid, bow: no draw call of their own, just batch instances');
  const byKey = Object.fromEntries([...dyn.live.values()].map((r) => [r.key.replace(/^hh:/, ''), r.color]));
  assert.deepEqual(Object.keys(byKey).sort(), [...GIFT_KEYS].sort());
  assert.equal(byKey['prop:gift_box:band'], '#ff7a6b');
  assert.equal(byKey['prop:gift_box:bow'], '#ff7a6b');
  assert.equal(byKey['prop:gift_box'], '#ffffff', 'the paper keeps its own colours');
  gifts.update(0.016, T0);
  const pr = gifts.proxies();
  assert.equal(pr.length, 1);
  assert.ok(pr[0].gift && pr[0].box.containsPoint(new THREE.Vector3(41, 0.3, 61)), 'a pick box round the tile (20, 30)');
});

test('D1: opening shakes, bursts petals and confetti (no hearts), floats the gift, then the box leaves the batch', () => {
  const s = farmWithGift();
  const dyn = fakeDyn();
  const fx = fakeFx();
  const gifts = createGiftView({ dyn, fx });
  gifts.setState(s, T0);
  const pos = gifts.onEvent({ e: 'giftOpened', id: 'gift.p2.1', item: 'rose', from: 'p2', to: 'p1', x: 20, z: 30 }, { by: 'p1', local: true });
  assert.ok(pos && Math.abs(pos.x - 41) < 1e-9 && Math.abs(pos.z - 61) < 1e-9, 'its place for the rest of the feedback');
  delete s.farm.objects['gift.p2.1'];
  delete s.farm.gifts['gift.p2.1'];
  gifts.sync([], new Set(['objects']), s, T0);
  let t = 0;
  while (t < GIFT.gone + 0.2) { gifts.update(0.05, T0); t += 0.05; }
  const kinds = fx.log.filter(([k]) => k === 'burst').map(([, kind]) => kind);
  assert.ok(kinds.includes('petal') && kinds.includes('confetti'), `bursts: ${kinds}`);
  assert.ok(!kinds.includes('heart'), 'nothing is paid in Hearts: no hearts fly');
  assert.ok(fx.log.some(([k, text]) => k === 'float' && /Rose/.test(text)), 'the gift\'s name floats up');
  assert.equal(dyn.live.size, 0, 'the box left the batch');
});

test('D1: a new box pops in (keepsake) and a shelved one just poofs', () => {
  const s = makeFarm();
  const dyn = fakeDyn();
  const fx = fakeFx();
  const gifts = createGiftView({ dyn, fx });
  gifts.setState(s, T0);
  const g = farmWithGift();
  gifts.sync(['gift.p2.1'], new Set(['objects']), g, T0);
  gifts.onEvent({ e: 'keepsake', id: 'gift.p2.1', item: 'rose', to: 'p1', by: 'p2', x: 20, z: 30 }, {});
  assert.equal(gifts.update(0.05, T0), 2, 'the pop asks for the feedback frame rate');
  gifts.onEvent({ e: 'giftOpened', id: 'gift.p2.1', item: 'rose', auto: true, x: 20, z: 30 }, {});
  fx.log.length = 0;
  for (let i = 0; i < 20; i++) gifts.update(0.05, T0);
  assert.ok(!fx.log.some(([k, kind]) => k === 'burst' && kind === 'confetti'), 'a shelved box makes no party');
});

test('D4: when a tag shows (desktop near band or hover; a phone only for an open home card or a long press)', () => {
  assert.equal(tagWanted({ desktop: true, dist: 30, id: 'a' }), true);
  assert.equal(tagWanted({ desktop: true, dist: 50, id: 'a' }), false);
  assert.equal(tagWanted({ desktop: true, dist: 50, id: 'a', home: 'h', hoverId: 'h' }), true, 'hover on its home');
  assert.equal(tagWanted({ desktop: false, dist: 20, id: 'a', home: 'h' }), false, 'a phone never shows them all');
  assert.equal(tagWanted({ desktop: false, dist: 80, id: 'a', home: 'h', openHome: 'h' }), true, 'its home card is open');
  assert.equal(tagWanted({ desktop: false, dist: 80, id: 'a', hoverId: 'a' }), true, 'a long press on it');
  const many = Array.from({ length: 40 }, (_, i) => ({ sx: i * 30, sy: 300 }));
  assert.equal(pickTags(many, NAME_TAGS.max, 600, 300).length, 24);
  assert.equal(NAME_TAGS.max, 24);
});

test('D4: tags over named animals only, in the namer\'s colour with a dark outline, at most 24, under the HUD', () => {
  desktop = true;
  const s = makeFarm();
  s.players.p2.color = '#FF7A6B';
  s.farm.names = {};
  const list = [];
  for (let i = 0; i < 30; i++) {
    const id = `cow.${i}`;
    s.farm.objects[id] = { def: 'cow', home: 'barn1' };
    if (i < 26) s.farm.names[id] = { name: `Cow ${i}`, by: 'p2', at: T0 };
    // a grid 120 x 30 px apart on screen: tags that do not touch (QA r1 L-12 stacks or leaves out the ones that do)
    list.push({ id, home: 'barn1', x: 10 + (i % 6) * 12, z: 10 + Math.floor(i / 6) * 3, y: 1.6 });
  }
  const tags = createNameTags({ toScreenM: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) });
  tags.setNames(s);
  assert.equal(tags.stats().named, 26);
  assert.equal(tags.frame(list, { dist: 60 }), 0, 'a desktop out of the near band: none');
  const n = tags.frame(list, { dist: 25 });
  assert.equal(n, 24, 'at most 24 at once (26 named, 4 not)');
  const layer = globalThis.document.getElementById('name-tags');
  assert.ok(layer, '#name-tags');
  assert.match(layer.style.cssText, /z-index:8/, 'under the HUD (z 10)');
  const shown = layer.children.filter((c) => c.style.visibility === 'visible');
  assert.equal(shown.length, 24);
  assert.ok(shown.every((c) => /^Cow ([0-9]|1[0-9]|2[0-5])$/.test(c.textContent)), 'only named animals');
  assert.ok(shown.every((c) => c.style.color === '#FF7A6B'), 'the namer\'s colour');
  assert.match(layer.style.cssText, /text-shadow:[^;]*#2A170A/, 'a dark outline like the HUD words (on the layer, inherited)');
  assert.ok(tags.stats().ms >= 0);
  desktop = false;
  assert.equal(tags.frame(list, { dist: 25 }), 0, 'a phone in the near band shows none by itself');
  globalThis.dispatchEvent?.(new CustomEvent('hh:home-card', { detail: { id: 'barn1' } }));
  tags.open('barn1');
  assert.equal(tags.frame(list, { dist: 80 }), 24, 'the home card open: its named animals (24 at most)');
});

test('D4: a desktop browser that reports no fine pointer (headless, remote) still counts as a desktop by its layout', () => {
  const s = makeFarm();
  s.farm.names = { 'cow.a': { name: 'Rada Petrova', by: 'p1', at: T0 } };
  s.farm.objects['cow.a'] = { def: 'cow', home: 'barn1' };
  const keep = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: /hover: hover/.test(q) ? false : /max-width: 1180px/.test(q) ? false : false });
  try {
    const tags = createNameTags({ toScreenM: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) });
    tags.setNames(s);
    assert.equal(tags.frame([{ id: 'cow.a', home: 'barn1', x: 10, z: 10, y: 1.6 }], { dist: 20 }), 1, 'the near band shows the tag');
  } finally { globalThis.matchMedia = keep; }
});

test('D4: on a phone a home\'s tags stay 6 s after its card closes (the card is a sheet over the farm)', async () => {
  desktop = false;
  const s = makeFarm();
  s.farm.names = { 'cow.a': { name: 'Rada Petrova', by: 'p1', at: T0 } };
  s.farm.objects['cow.a'] = { def: 'cow', home: 'barn1' };
  const tags = createNameTags({ toScreenM: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) });
  tags.setNames(s);
  const list = [{ id: 'cow.a', home: 'barn1', x: 10, z: 10, y: 1.6 }];
  tags.open('barn1');
  assert.equal(tags.frame(list, { dist: 80 }), 1);
  tags.open(null);
  assert.equal(tags.frame(list, { dist: 80 }), 1, 'still there right after the card closed');
  assert.equal(NAME_TAGS.lingerMs, 6000);
});

test('D4 cost: a tag that did not move by a whole pixel is not written again; the media queries are made once', () => {
  desktop = true;
  const keep = globalThis.matchMedia;
  let asked = 0;
  globalThis.matchMedia = (q) => { asked++; return keep(q); };
  try {
    const s = makeFarm();
    s.farm.names = {};
    const list = [];
    for (let i = 0; i < 24; i++) {
      s.farm.objects[`cow.w${i}`] = { def: 'cow', home: 'barn1' };
      s.farm.names[`cow.w${i}`] = { name: `Cow ${i}`, by: 'p1', at: T0 };
      list.push({ id: `cow.w${i}`, home: 'barn1', x: (i % 6) * 12 + 1, z: 10 + Math.floor(i / 6) * 3, y: 1.6 });
    }
    const tags = createNameTags({ toScreenM: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) });
    tags.setNames(s);
    assert.equal(tags.frame(list, { dist: 20 }), 24);
    const layer = globalThis.document.getElementById('name-tags');
    let writes = 0;
    for (const el of layer.children) {
      el.style = new Proxy(el.style, { set(t, k, v) { if (k === 'transform') writes++; t[k] = v; return true; } });
    }
    const iw = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');
    let sizeReads = 0;
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, get() { sizeReads++; return 1366; } });
    try { for (let f = 0; f < 10; f++) tags.frame(list, { dist: 20 }); } finally { Object.defineProperty(globalThis, 'innerWidth', iw); }
    assert.equal(writes, 0, 'nothing moved: no transform written');
    assert.equal(sizeReads, 0, 'no innerWidth read per frame (a forced-layout read; the size comes from resize)');
    list[3].x += 0.02;                         // 0.2 px: the same whole pixel
    tags.frame(list, { dist: 20 });
    assert.equal(writes, 0, 'under a pixel: still nothing written');
    list[3].x += 1;                            // 10 px
    tags.frame(list, { dist: 20 });
    assert.equal(writes, 1, 'one tag moved: one write');
    assert.ok(asked <= 2, `matchMedia asked ${asked} times for 13 frames (once per query, then read live)`);
  } finally { globalThis.matchMedia = keep; }
});

test('D4 cost: the tags inherit their look (font, outline) from the layer; each tag only carries its place and colour', () => {
  desktop = true;
  const s = makeFarm();
  s.farm.names = { 'cow.i': { name: 'Rada Petrova', by: 'p1', at: T0 } };
  s.farm.objects['cow.i'] = { def: 'cow', home: 'barn1' };
  const tags = createNameTags({ toScreenM: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) });
  tags.setNames(s);
  assert.equal(tags.frame([{ id: 'cow.i', home: 'barn1', x: 10, z: 10, y: 1.6 }], { dist: 20 }), 1);
  const layer = globalThis.document.getElementById('name-tags');
  assert.match(layer.style.cssText, /text-shadow:[^;]*#2A170A/, 'the outline once, on the layer');
  assert.match(layer.style.cssText, /font:800/);
  const el = layer.children.find((c) => c.textContent === 'Rada Petrova');
  assert.ok(el);
  assert.doesNotMatch(el.style.cssText, /text-shadow|font:/, 'a tag restyles only what moves');
});

test('D4 cost: idle() tells the caller to gather nothing while no tag can show, and hides the shown ones', () => {
  desktop = true;
  const s = makeFarm();
  s.farm.names = { 'cow.j': { name: 'Mila Dobreva', by: 'p1', at: T0 } };
  s.farm.objects['cow.j'] = { def: 'cow', home: 'barn1' };
  const tags = createNameTags({ toScreenM: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) });
  assert.equal(tags.idle(20), true, 'no named animal yet');
  tags.setNames(s);
  assert.equal(tags.idle(60), true, 'a desktop out of the near band');
  assert.equal(tags.idle(20), false, 'the near band');
  // a reused list: only the first n records are live this frame
  const list = [{ id: 'cow.j', home: 'barn1', x: 10, z: 10, y: 1.6 }, { id: 'cow.j', home: 'barn1', x: 30, z: 10, y: 1.6 }];
  assert.equal(tags.frame(list, { dist: 20, n: 1 }), 1);
  const layer = globalThis.document.getElementById('name-tags');
  // (the layer is shared with the earlier tests' tag sets: count this one's tag)
  const visible = () => layer.children.filter((c) => c.style.visibility === 'visible' && c.textContent === 'Mila Dobreva').length;
  assert.equal(visible(), 1);
  assert.equal(tags.idle(60), true, 'zoomed out');
  assert.equal(visible(), 0, 'idle hid the tag');
  tags.hover('barn1');
  assert.equal(tags.idle(60), false, 'hovering its home');
  tags.hover(null);
});

test('D4 / P9: the namer\'s colour reads at 4.5:1 or more on the dark outline (lightened only as far as needed)', () => {
  const OUT = '#2A170A';
  assert.equal(readableOnOutline('#2BB3A3'), '#2BB3A3', 'teal reads as it is');
  assert.equal(readableOnOutline('#FF7A6B'), '#FF7A6B', 'coral reads as it is');
  const plum = readableOnOutline('#9B6BD6');               // the slot picker's plum: 4.46:1 as it is
  assert.ok(contrastRatio('#9B6BD6', OUT) < 4.5);
  assert.ok(contrastRatio(plum, OUT) >= 4.5, `plum ${plum}`);
  assert.notEqual(plum, '#FFFFFF', 'still plum, a little lighter');
  const navy = readableOnOutline('#1A2A6C');               // any #RRGGBB is a valid farmer colour
  assert.ok(contrastRatio(navy, OUT) >= 4.5, `navy ${navy}`);
  const s = makeFarm();
  s.players.p2.color = '#9B6BD6';
  s.farm.names = { 'cow.p': { name: 'Plum Named', by: 'p2', at: T0 } };
  s.farm.objects['cow.p'] = { def: 'cow', home: 'barn1' };
  desktop = true;
  const tags = createNameTags({ toScreenM: (x, z) => ({ x: x * 10, y: z * 10, visible: true }) });
  tags.setNames(s);
  tags.frame([{ id: 'cow.p', home: 'barn1', x: 10, z: 10, y: 1.6 }], { dist: 20 });
  const el = globalThis.document.getElementById('name-tags').children.find((c) => c.textContent === 'Plum Named');
  assert.equal(el.style.color, plum, 'the tag wears the readable plum');
});

test('D4: a tag at the screen\'s edge stays whole on the screen (iPhone shot: "Petrova" was cut at the left edge)', () => {
  desktop = true;
  const s = makeFarm();
  s.farm.names = { 'cow.e': { name: 'Tajna Petrova', by: 'p1', at: T0 }, 'cow.f': { name: 'Edge Right', by: 'p1', at: T0 } };
  s.farm.objects['cow.e'] = { def: 'cow', home: 'barn1' };
  s.farm.objects['cow.f'] = { def: 'cow', home: 'barn1' };
  const tags = createNameTags({ toScreenM: (x, z) => ({ x, y: z, visible: true }) });
  tags.setNames(s);
  tags.frame([{ id: 'cow.e', home: 'barn1', x: 3, z: 300, y: 1.6 }, { id: 'cow.f', home: 'barn1', x: 1360, z: 300, y: 1.6 }], { dist: 20 });
  const els = globalThis.document.getElementById('name-tags').children;
  const xOf = (name) => Number(/translate3d\((-?\d+)px/.exec(els.find((c) => c.textContent === name).style.transform)[1]);
  // the tag is centred on x (translate -50%): half its width must fit on each side (15 px bold: ~9.6 px a letter)
  assert.ok(xOf('Tajna Petrova') >= 13 * 4.8, `left edge: centre at ${xOf('Tajna Petrova')}`);
  assert.ok(xOf('Edge Right') <= 1366 - 10 * 4.8, `right edge: centre at ${xOf('Edge Right')}`);
});
