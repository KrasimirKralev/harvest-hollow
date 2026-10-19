// QA r2 (life-feel) L2-02 .. L2-05: one floor / ceiling list for every toast (ui/toasts.js). Fake DOM, with the
// rectangles measured in the browser on the tested head (docs/agent-notes/rel-life-feel.md, QA r2:
// .scratch/r2-life-feel/probe.mjs). Each case raises a toast in one state and asserts that the control it used to cover
// is still clear of it (scope §9 risk 5):
//   L2-02 (jde#7, fbp#9) the coach card: an Undo line lifted above the toolbar landed on it (desktop 1366 and 1280,
//     iPhone 13); only what lay under the line's first place was counted.
//   L2-03 (va#1) the placement bar ("Placing the Bakery · Rotate · Cancel") and the planting chip, also when the chip
//     comes up while the line is already there.
//   L2-04 (coop#7) the bench chip's Join and the Golden Hour pill under the top column; a toast born under a resting
//     cursor was held by "hover" for 78 s.
//   L2-05 (hv#5, hv#6) Harvey's desktop side panel cut the end of the line; on a phone the line lay on an open sheet's
//     body (the partner's letter).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
const docListeners = {};
document.addEventListener = (type, fn) => { (docListeners[type] ||= []).push(fn); };
const fire = (type, ev) => { for (const fn of docListeners[type] || []) fn({ type, ...ev }); };
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
let phone = false;
globalThis.matchMedia = (q) => ({ matches: phone && /max-width: 600px|pointer: coarse/.test(q), addEventListener() {}, removeEventListener() {} });

const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

const box = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
/** Give an element a fixed rectangle [left, top, right, bottom] (and a client rect: it is laid out). */
function at(el, [l, t, r, b]) {
  el.getBoundingClientRect = () => box(l, t, r, b);
  el.getClientRects = () => [el.getBoundingClientRect()];
  return el;
}
const R = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const num = (v) => Number.parseFloat(v || 0) || 0;

/** The snack layer (#snacks, fixed at the bottom centre): its rectangle follows its style like the CSS would. */
function snackModel(el, nat) {
  const hgt = nat[3] - nat[1];
  el.getBoundingClientRect = () => {
    let top = nat[1];
    if (el.style.top) top = num(el.style.top);
    else if (el.classList.contains('top')) top = 92;
    else if (el.style.bottom) top = innerHeight - num(el.style.bottom) - hgt;
    return box(nat[0], top, nat[2], top + hgt);
  };
  el.getClientRects = () => [el.getBoundingClientRect()];
}
/** The top column (#toasts): top-anchored, centred; margin-top moves it down, left + max-width re-centre it. */
function columnModel(el, nat) {
  el.getBoundingClientRect = () => {
    if (!el.children.length) return box(0, 0, 0, 0);
    const w = Math.min(nat[2] - nat[0], el.style.maxWidth ? num(el.style.maxWidth) : Infinity);
    const cx = el.style.left ? num(el.style.left) : (nat[0] + nat[2]) / 2;
    const dy = num(el.style.marginTop);
    return box(cx - w / 2, nat[1] + dy, cx + w / 2, nat[3] + dy);
  };
  el.getClientRects = () => (el.children.length ? [el.getBoundingClientRect()] : []);
}

function setup({ w, hgt, panel = null }) {
  globalThis.innerWidth = w;
  globalThis.innerHeight = hgt;
  document.body.replaceChildren(h('canvas#world'), h('div#hud',
    h('header.hud-tl', h('div.buffs#hud-buffs')),
    h('aside#tracker'),
    h('div.tray-wrap#tray-wrap', h('div#coach-slot'), h('div.stroke-chip.hammer-hint', { hidden: true }), h('div.stroke-chip#stroke-chip', { hidden: true }), h('nav#toolbar')),
    h('nav.dock#dock'), h('div.toasts#toasts'), h('div.banners#banners')));
  const panels = { name: panel, top() { return this.name; }, on(ev, fn) { (this.l ||= {})[ev] = fn; return () => {}; } };
  const toasts = createToasts({ store: { state: null, pid: 'p1' }, ui: { panels } }, (c) => c);
  return { toasts, panels };
}
/** Raise an action toast whose layer is drawn at `nat` before any lift. */
function snack(toasts, nat, text = 'Order skipped: a new one comes in 15m') {
  const real = document.body.append.bind(document.body);
  document.body.append = (...els) => { for (const e of els) if (e && e.classList?.contains('snacks')) snackModel(e, nat); return real(...els); };
  // (QA r4 L4-01: the player's own line, as an Undo is; a line nobody's press raised waits while a sheet has no room)
  const el = toasts.toast(text, { kind: 'ok', action: { label: 'Undo', fn() {} }, ms: 8000 });
  document.body.append = real;
  return { el, layer: document.querySelector('.snacks') };
}

test('L2-02: an Undo line lifted above the toolbar never lands on the coach card (desktop 1366, 1280)', () => {
  for (const [w, hgt, coachR, barR, nat] of [
    [1366, 768, [490, 599, 876, 661], [579, 671, 787, 752], [478, 696, 888, 744]],
    [1280, 720, [447, 551, 833, 613], [536, 623, 744, 704], [435, 648, 845, 696]],
  ]) {
    phone = false;
    const { toasts } = setup({ w, hgt });
    document.getElementById('coach-slot').append(at(h('div.coach'), coachR));
    at(document.getElementById('toolbar'), barR);
    const { layer } = snack(toasts, nat);
    const r = R(layer);
    assert.ok(!hits(r, coachR), `${w}: the line ${r} clear of the coach card ${coachR}`);
    assert.ok(!hits(r, barR), `${w}: and of the toolbar`);
    assert.ok(r[1] >= 0, `${w}: on screen`);
  }
});

test('L2-02: on an iPhone 13 the balloon\'s "Show me" line stays off the coach card above the phone bar', () => {
  phone = true;
  const { toasts } = setup({ w: 390, hgt: 844 });
  const coachR = [36, 633, 354, 722];
  document.getElementById('coach-slot').append(at(h('div.coach'), coachR));
  at(document.getElementById('toolbar'), [0, 730, 390, 844]);
  const { layer } = snack(toasts, [12, 735, 378, 794], 'The balloon dropped a crate on the farm!');
  const r = R(layer);
  assert.ok(!hits(r, coachR), `the line ${r} clear of the coach card`);
  assert.ok(!hits(r, [0, 730, 390, 844]), 'and of the bar');
  phone = false;
});

test('L2-03: the placement bar (desktop) and the planting chip (desktop, iPhone) stay clear of an action toast', () => {
  phone = false;
  let { toasts } = setup({ w: 1366, hgt: 768 });
  at(document.getElementById('toolbar'), [579, 671, 787, 752]);
  const hint = document.querySelector('.hammer-hint');
  hint.hidden = false;
  at(hint, [474, 620, 892, 661]);
  let { layer } = snack(toasts, [445, 696, 921, 744], 'The balloon dropped a crate on the farm!');
  assert.ok(!hits(R(layer), [474, 620, 892, 661]), `desktop: the placement bar clear (line ${R(layer)})`);

  phone = true;
  ({ toasts } = setup({ w: 390, hgt: 844 }));
  at(document.getElementById('toolbar'), [0, 730, 390, 844]);
  const chip = document.getElementById('stroke-chip');
  chip.hidden = false;
  at(chip, [106, 692, 284, 722]);
  ({ layer } = snack(toasts, [12, 735, 378, 794], 'The balloon dropped a crate on the farm!'));
  assert.ok(!hits(R(layer), [106, 692, 284, 722]), `iPhone: the planting chip clear (line ${R(layer)})`);
  phone = false;
});

test('L2-03: a planting chip that comes up while the line is already there pushes the line up', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    phone = false;
    const { toasts } = setup({ w: 1366, hgt: 768 });
    at(document.getElementById('toolbar'), [579, 671, 787, 752]);
    const { layer } = snack(toasts, [445, 696, 921, 744], 'The balloon dropped a crate on the farm!');
    const chip = document.getElementById('stroke-chip');
    chip.hidden = false;
    at(chip, [594, 631, 772, 661]);
    mock.timers.tick(600);
    assert.ok(!hits(R(layer), [594, 631, 772, 661]), `the chip clear after it came up (line ${R(layer)})`);
  } finally { mock.timers.reset(); }
});

test('L2-04: the top column starts below the bench chip and the Golden Hour pill', () => {
  phone = false;
  const { toasts } = setup({ w: 1366, hgt: 768 });
  const chip = at(h('div.bench-chip', h('span.bc-t', 'Mia is on the bench'), at(h('button.bc-join', 'Join'), [544, 118, 600, 149])), [294, 112, 606, 155]);
  document.getElementById('hud').append(chip);
  document.getElementById('hud-buffs').append(at(h('span.buff.golden', 'Golden Hour 9:58'), [360, 88, 493, 120]));
  columnModel(document.getElementById('toasts'), [445, 100, 921, 147]);
  toasts.toast('Golden Hour! Everything you start now grows 10% faster.', { kind: 'love', ms: 3000 });
  const r = R(document.getElementById('toasts'));
  assert.ok(!hits(r, [544, 118, 600, 149]), `Join clear (column ${r})`);
  assert.ok(!hits(r, [360, 88, 493, 120]), 'the pill clear');
});

test('L2-04: a toast born under a resting cursor is not held; one the pointer moves onto is', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    phone = false;
    const { toasts } = setup({ w: 1366, hgt: 768 });
    fire('pointermove', { clientX: 572, clientY: 133, pointerType: 'mouse' });   // the cursor that just pressed Join
    const el = toasts.toast('Golden Hour! Everything you start now grows 10% faster.', { kind: 'love', ms: 3000 });
    el.dispatch('pointerenter', { clientX: 572, clientY: 133, pointerType: 'mouse' });
    el.dispatch('pointermove', { clientX: 572, clientY: 133, pointerType: 'mouse' });
    mock.timers.tick(3100);
    assert.ok(el.classList.contains('leaving'), 'it leaves on time');
    const el2 = toasts.toast('A second line', { kind: 'info', ms: 3000 });
    fire('pointermove', { clientX: 600, clientY: 120, pointerType: 'mouse' });
    el2.dispatch('pointermove', { clientX: 600, clientY: 120, pointerType: 'mouse' });
    mock.timers.tick(10_000);
    assert.ok(!el2.classList.contains('leaving'), 'the pointer came to it: held while it stays');
    el2.dispatch('pointerleave', { clientX: 800, clientY: 300, pointerType: 'mouse' });
    mock.timers.tick(1300);
    assert.ok(el2.classList.contains('leaving'), 'and it goes a moment after the pointer leaves');
  } finally { mock.timers.reset(); }
});

test('L2-05: next to Harvey\'s desktop side panel the column moves into the free width left of it', () => {
  phone = false;
  const { toasts } = setup({ w: 1366, hgt: 768, panel: 'helper' });
  at(document.getElementById('tracker'), [16, 104, 286, 400]);
  document.body.append(at(h('section#panel-helper', { 'aria-modal': 'false' }), [870, 76, 1290, 596]));
  columnModel(document.getElementById('toasts'), [403, 100, 963, 157]);
  const el = toasts.toast('Llama left the shop; what you have keeps working.', { ms: 3000 });
  assert.ok(!el.closest('#over-panels'), 'a side panel leaves the top centre free: the line stays in the HUD');
  const r = R(document.getElementById('toasts'));
  assert.ok(r[2] <= 870 - 8, `its end (${r[2]}) left of the panel (870)`);
  assert.ok(r[0] >= 286, `and clear of the left column (${r[0]})`);
});

test('L2-05: on a phone an action line never lies on the body of an open card or sheet that leaves room beside it', () => {
  phone = true;
  for (const [name, w, hgt, frameR, titleR, bodyR, nat] of [
    // the partner's letter (a card, 360 BG): room below it (over the dimmed bar, in a thumb's reach)
    ['letter', 360, 640, [26, 180, 334, 560], [26, 180, 334, 230], [26, 230, 334, 560], [12, 569, 348, 624]],
    // a half sheet on an iPhone 13 (the naming card): room above it
    ['naming', 390, 844, [0, 289, 390, 844], [0, 289, 390, 351], [8, 351, 382, 802], [12, 735, 378, 794]],
  ]) {
    const { toasts } = setup({ w, hgt, panel: name });
    at(document.getElementById('toolbar'), w > 360 ? [0, 730, 390, 844] : [0, 560, 360, 640]);
    const frame = at(h(`section#panel-${name}`, { 'aria-modal': 'true' }), frameR);
    frame.append(at(h('header.hh-panel-title'), titleR), at(h('div.hh-panel-body'), bodyR));
    document.body.append(frame);
    const { layer } = snack(toasts, nat, 'Desi\'s helper added a moon melon and a melon pie');
    const r = R(layer);
    assert.ok(!hits(r, bodyR), `${name}: the line ${r} off the body ${bodyR}`);
    assert.ok(r[1] >= 0 && r[3] <= innerHeight, `${name}: on screen (${r})`);
  }
  phone = false;
});

test('L2-05: a sheet as tall as the screen leaves only its title band (and its close button): the line keeps the bottom', () => {
  phone = true;
  const { toasts } = setup({ w: 360, hgt: 640, panel: 'barn' });
  at(document.getElementById('toolbar'), [0, 560, 360, 640]);
  const frame = at(h('section#panel-barn', { 'aria-modal': 'true' }), [0, 10, 360, 640]);
  const close = at(h('button.hh-panel-close'), [305, 22, 349, 66]);
  frame.append(at(h('header.hh-panel-title'), [110, 22, 250, 60]), close, at(h('div.hh-panel-body'), [8, 72, 352, 632]));
  document.body.append(frame);
  const { layer } = snack(toasts, [12, 569, 348, 624], 'Stopped keeping Wheat');
  const r = R(layer);
  assert.ok(!hits(r, [305, 22, 349, 66]), 'never on the close button');
  assert.ok(r[3] >= 600, `at the bottom, in a thumb's reach (${r})`);
  phone = false;
});

// L2-09 (fe#3): any card's ribbon that wraps to a third line on a narrow screen makes room under it (the card's words
// start below it), whatever its words (the reveal card's own ribbon is short now: rel-feel.feed-r2).
test('L2-09: a ribbon three lines tall pushes the card\'s words below it', () => {
  phone = true;
  const { toasts } = setup({ w: 360, hgt: 640 });
  const banners = document.getElementById('banners');
  const real = banners.prepend.bind(banners);
  banners.prepend = (el) => { const rib = el.querySelector('.ribbon'); if (rib) at(rib, [51, 94, 209, 159]); return real(el); };
  const { el } = toasts.banner({ kind: 'quest', ribbon: 'Set complete: a very long decor set name!', message: 'Words', ttl: 5000 });
  banners.prepend = real;
  assert.ok(num(el.style.paddingTop) >= 65 - 14 + 4, `the words start below the ribbon (padding-top ${el.style.paddingTop || 'unset'})`);
  phone = false;
});

// I2-01 (coop#10, wording for infra's tile targets): a lost race to the same tile (both farmers placed on one free tile
// at once) read as a plain refusal; once the refusal names the partner (`by`), BLOCKED says the race line too.
test('I2-01: BLOCKED from a tile the partner just took reads "Mia got there first ♥", like a plot or an order', () => {
  phone = false;
  globalThis.innerWidth = 1366;
  globalThis.innerHeight = 768;
  document.body.replaceChildren(h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')));
  const state = { players: { p1: { name: 'Rowan' }, p2: { name: 'Mia' } } };
  const toasts = createToasts({ store: { state, pid: 'p1' }, ui: { panels: { top: () => null, on() { return () => {}; } } } }, (c) => `err:${c}`);
  const el = toasts.toast('BLOCKED', { by: 'p2' });
  assert.match(el.dataset.text, /Mia got there first ♥/);
  const plain = toasts.toast('BLOCKED', {});
  assert.equal(plain.dataset.text, 'err:BLOCKED', 'with nobody to name it stays the refusal');
});

// L2-05 (second opinion, verified): on a full-height sheet the line keeps the bottom, but above the sheet's own sticky
// footer (its main button), never on it.
test('L2-05: on a full-height sheet the line stays above the sheet\'s sticky footer', () => {
  phone = true;
  const { toasts } = setup({ w: 390, hgt: 844, panel: 'gift' });
  at(document.getElementById('toolbar'), [0, 730, 390, 844]);
  const frame = at(h('section#panel-gift', { 'aria-modal': 'true' }), [0, 57, 390, 844]);
  const foot = at(h('div.rel-gift-foot'), [8, 740, 382, 802]);
  frame.append(at(h('header.hh-panel-title'), [110, 60, 280, 110]), at(h('div.hh-panel-body'), [8, 119, 382, 802]), foot);
  document.body.append(frame);
  const { layer } = snack(toasts, [12, 735, 378, 794], 'Stopped keeping Wheat');
  assert.ok(!hits(R(layer), [8, 740, 382, 802]), `the line ${R(layer)} off the footer`);
  phone = false;
});
