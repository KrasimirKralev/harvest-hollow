// Polish after the wave-4b QA (2026-10-05): two ui defects the owners' QA found.
// 1. The workshop queue's ◀ ▶ (wave 4b reorder) covered a waiting card's icon and half its time on a phone. A layout
//    model of the card from the real CSS (panels.css: the card, its padding, the 48 px icon the panel draws, the ◀ ▶ row
//    and button sizes, on a touch screen and on a mouse desktop) says where each piece lands.
// 2. The Market's animal card for a full home that cannot grow only said "no room to grow". It now names what is in the
//    way (the rules' animalBuyPlan names the home, its homeGrowth the blockers, model.blockerText the words the Animals
//    panel uses too) and offers that home's panel, opened at its room step (Show me / Move the …).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom, textOf } from './ui-qa2-dom.js';
import * as C from '../shared/content/index.js';
import { farmAt, put, actOk, MONDAY, HOUR } from './helpers/rules-goals.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const read = (p) => fs.readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

// ---- a little CSS reader: the declarations of one selector at the top level or inside one @media block --------------
function blocks(css) {
  const out = [];
  let depth = 0; let start = 0; let prelude = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) { prelude = css.slice(start, i).trim(); start = i + 1; } depth++; }
    else if (css[i] === '}') { depth--; if (depth === 0) { out.push({ prelude, body: css.slice(start, i) }); start = i + 1; } }
  }
  return out;
}
function decl(css, selector, media = null) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const top = blocks(src);
  const scope = media === null ? top.filter((b) => !b.prelude.startsWith('@')) : top.filter((b) => b.prelude === `@media ${media}`).flatMap((b) => blocks(b.body));
  const out = {};
  for (const b of scope) {
    if (!b.prelude.split(',').map((s) => s.trim()).includes(selector)) continue;
    for (const d of b.body.split(';')) {
      const m = d.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/s);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}
const px = (v) => {
  const m = String(v ?? '').match(/^(-?[\d.]+)px$/);
  return m ? Number(m[1]) : null;
};

/** Where a waiting card's icon, time line and ◀ ▶ land (card px, from its top-left), for `media` (null: a mouse). */
function queueCard(css, media) {
  const card = decl(css, '.pn-slot');
  const W = px(card.width);
  const [pt, ph] = card.padding.split(/\s+/).map(px);
  const gap = px(card.gap);
  const ICON = 48;
  const icon = { l: (W - ICON) / 2, r: (W + ICON) / 2, t: pt, b: pt + ICON };
  const time = { l: ph, r: W - ph, t: icon.b + gap, b: icon.b + gap + 14 };
  const move = { ...decl(css, '.pn-slot-move'), ...(media ? decl(css, '.pn-slot-move', media) : {}) };
  const btn = { ...decl(css, '.pn-move-btn'), ...(media ? decl(css, '.pn-move-btn', media) : {}) };
  const size = [px(btn.width), px(btn.height)];
  if (move.position === 'absolute') {
    const top = px(move.top); const left = px(move.left); const right = px(move.right);
    const btns = [{ l: left, r: left + size[0] }, { l: W - right - size[0], r: W - right }].map((b) => ({ ...b, t: top, b: top + size[1] }));
    return { W, icon, time, size, btns, inFlow: false };
  }
  // in the card's column, after the price: below the icon and the time by construction; its width holds both buttons?
  const margin = (move.margin || '0').split(/\s+/).map((v) => px(v) ?? 0);
  const side = margin.length > 1 ? margin[1] : margin[0];
  return { W, icon, time, size, btns: [], inFlow: true, rowWidth: W - 2 * ph - 2 * side, position: move.position };
}
const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

test('queue (phone): a picked card\'s ◀ ▶ are 44 px and leave the icon, the time and the Acorn price fully visible', () => {
  const css = read('css/panels.css');
  const building = read('js/ui/panels/building.js');
  assert.match(building, /icon\(q\.item, \{ size: 48 \}\)/, 'the card draws a 48 px icon (the model assumes it)');
  const m = queueCard(css, '(hover: none)');
  assert.ok(m.size[0] >= 44 && m.size[1] >= 44, `finger-sized ◀ ▶ (${m.size})`);
  for (const [i, b] of m.btns.entries()) {
    assert.equal(overlap(b, m.icon), 0, `button ${i} covers ${overlap(b, m.icon)} px² of the icon`);
    assert.equal(overlap(b, m.time), 0, `button ${i} covers ${overlap(b, m.time)} px² of the time`);
  }
  if (m.inFlow) {
    // the row follows the Acorn price in the card (so it can never cover it) and holds both buttons side by side
    const at = (s) => building.indexOf(s);
    assert.ok(at("el.append(finishButton(q, name) ?? '');") > 0 && at("el.append(finishButton(q, name) ?? '');") < at('el.append(moveRow(q, order, name));'),
      'the ◀ ▶ row comes after the price');
    assert.ok(m.rowWidth >= 2 * m.size[0], `the row (${m.rowWidth} px) holds two ${m.size[0]} px buttons`);
  }
  assert.ok(m.inFlow || m.btns.length === 2);
});

test('queue (desktop): a hovered card\'s ◀ ▶ sit beside the icon, never over it or the time', () => {
  const m = queueCard(read('css/panels.css'), null);
  assert.equal(m.inFlow, false);
  for (const [i, b] of m.btns.entries()) {
    assert.equal(overlap(b, m.icon), 0, `button ${i} covers ${overlap(b, m.icon)} px² of the icon`);
    assert.equal(overlap(b, m.time), 0, `button ${i} covers the time`);
  }
  assert.ok(m.btns[0].r <= m.btns[1].l, 'the two buttons do not touch');
});

// ---- 2: the Market's card for a full home that cannot grow -----------------------------------------------------------

/** Level 30, a Chicken Coop full at its old maximum and fenced in all round (it cannot grow). */
async function boxedCoop() {
  const GR = await import('../shared/rules/grid.js');
  const s = farmAt(30);
  s.farm.wallet.coins = 5_000_000;
  for (const id of Object.keys(s.farm.objects)) if (['coop', 'chicken'].includes(s.farm.objects[id].def)) delete s.farm.objects[id];
  const def = C.defOf('coop');
  const coop = put(s, 'coop', { x: 30, z: 30, up: (def.capacityMax - def.capacity) / def.upgradeStep });
  for (let i = 0; i < 40 && GR.occupantsOf(s, coop).length < GR.capacityOf(s, coop); i++) {
    actOk(s, 'buyAnimal', { def: 'chicken', adult: true, home: coop, confirm: ['BIG_SPEND'] });
  }
  const o = s.farm.objects[coop];
  const [w, d] = GR.sizeOf(o);
  for (let z = o.z - 1; z <= o.z + d; z++) for (let x = o.x - 1; x <= o.x + w; x++) {
    if (x >= o.x && x < o.x + w && z >= o.z && z < o.z + d) continue;
    put(s, 'picket_fence', { x, z });
  }
  return { s, coop };
}

function ctxOf(state, { tab = null, args = {} } = {}) {
  const opened = [];
  const body = document.createElement('div');
  document.body.append(body);
  const now = MONDAY + HOUR;
  const store = { state, pid: 'p1', now: () => now, on: () => () => {}, act: () => ({ ok: true }) };
  const ctx = {
    name: 'market', args, store, body, el: body, now: () => now, tab,
    ui: { panels: { open: () => true, has: () => true }, toast() {} },
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: () => ({ ok: true }), open: (n, a) => { opened.push([n, a]); }, close() {}, setTitle() {}, refreshTabs() {},
    controller: { input: 'mouse', move() {}, setTool() {} },
  };
  return { ctx, body, opened };
}

test('market: a full home that cannot grow names what is in the way, once, and opens that home at its room step', async () => {
  const { s, coop } = await boxedCoop();
  const AN = await import('../shared/rules/actions/animals.js');
  const model = await import('../public/js/ui/panels/model.js');
  const plan = AN.animalBuyPlan(s, 'chicken', true);
  assert.equal(plan.code, 'BLOCKED');
  assert.equal(plan.blocked, coop, 'the rules name the home that cannot grow');
  const g = AN.homeGrowth(s, coop);
  assert.ok(g.blockers.length > 0);
  for (const adult of [false, true]) {
    const card = model.storeCards(s, 'animals').find((c) => c.kind === 'animal' && c.id === 'chicken' && c.adult === adult);
    assert.equal(card.code, 'CAP');
    assert.match(card.hint.text, /no room to grow: Picket Fence (is|are) in the way/);
    assert.deepEqual(card.blocked, { home: coop, name: 'Chicken Coop', why: model.blockerText(s, g.blockers) });
  }
  // the panel: the reason once under both rows, and a button to the Chicken Coop's own panel
  const { marketPanel } = await import('../public/js/ui/panels/market.js');
  const m = ctxOf(s, { tab: 'animals' });
  marketPanel.mount(m.body, m.ctx);
  const card = m.body.querySelector('[data-def="chicken"]');
  assert.ok(card, 'the Chicken card');
  const note = card.querySelector('.pn-card-room');
  assert.ok(note, 'the card says why and offers a way forward');
  assert.match(textOf(note), /The Chicken Coop is full and has no room to grow: Picket Fence (is|are) in the way\./);
  const go = note.querySelector('[data-gohome]');
  assert.equal(textOf(go).trim(), 'Make room');
  go.click();
  assert.deepEqual(m.opened, [['animals', { id: coop, focus: 'room' }]]);
  // the Animals panel says it with the same words (one implementation: model.blockerText)
  const { animalsPanel } = await import('../public/js/ui/panels/animals.js');
  const a = ctxOf(s, { args: { id: coop, focus: 'room' } });
  animalsPanel.mount(a.body, a.ctx);
  assert.ok(textOf(a.body.querySelector('.pn-room-why')).includes(model.blockerText(s, g.blockers)));
});
