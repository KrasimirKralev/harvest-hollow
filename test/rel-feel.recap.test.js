// Release 1.0 (life-feel): the welcome-back card. M10 (ux-first#18): every list shows at most 4 lines plus "and N more",
// and "Let's farm!" sits in a sticky footer (it was below the fold on the owners' save at 1366 x 768). D1 (features#F1):
// a first section for a surprise on the porch with Show me, and "Thanks for everything" thanks every partner line of
// "While you were away" through the rules' `thank`. Built in the small fake DOM (the fit in a real browser is in the
// notes: docs/qa/release/build/life-feel/recap-*.png).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';

const document = installDom();
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { makeFarm, T0 } = await import('./helpers.js');
const { createRecap, thankable, RECAP_LINES } = await import('../public/js/ui/recap.js');

/** A farm where p1 was away 3 h while p2 did 9 things, and left a surprise on the porch. */
function awayFarm() {
  const s = makeFarm();
  const away = T0 + 60_000;
  s.players.p1.lastSeenAt = away;
  s.farm.feed = { n: 0, rows: {} };
  for (let i = 0; i < 9; i++) {
    s.farm.feed.rows[String(i)] = { at: away + (i + 1) * 60_000, by: 'p2', k: 'harvest', item: 'wheat', n: 3 + i };
    s.farm.feed.n = i + 1;
  }
  s.farm.feed.rows['2'].ty = 'p1';                       // one of them was thanked already
  s.farm.gifts = { 'gift.p2.1': { by: 'p2', to: 'p1', item: 'rose', at: away + 30 * 60_000 } };
  s.farm.objects['gift.p2.1'] = { def: 'gift_box', x: 20, z: 30, rot: 0, placedAt: away + 30 * 60_000, by: 'p2' };
  return { s, now: away + 3 * 3600_000 };
}

function mount(s, now) {
  const calls = [];
  const focus = [];
  let spec = null;
  const S = {
    store: { state: s, pid: 'p1', now: () => now },
    ui: { panels: { register(name, sp) { spec = sp; }, top: () => null, has: () => false, open() {} } },
    controller: { do: (type, args) => calls.push([type, args]) },
    view: { focus: (x, z) => focus.push([x, z]) },
  };
  const r = createRecap(S);
  void r;
  const body = document.createElement('div');
  document.body.append(body);
  let closed = false;
  spec.mount(body, { close: () => { closed = true; } });
  return { body, calls, focus, closed: () => closed };
}

test('M10: every list shows at most 4 lines and a fold for the rest; the buttons sit in a sticky footer', () => {
  const { s, now } = awayFarm();
  const { body } = mount(s, now);
  for (const ul of body.querySelectorAll('ul')) {
    const lines = ul.children.filter((c) => !c.classList.contains('recap-more'));
    assert.ok(lines.length <= RECAP_LINES, `${lines.length} lines: ${textOf(ul).slice(0, 80)}`);
  }
  const more = body.querySelector('.recap-more');
  assert.ok(more, 'the fold line');
  // (QA r4 L4-05: the partner's fold sits above the newest four and names the older ones: "4 earlier", not "and 4 more")
  assert.match(textOf(more), /^4 earlier$/, '8 partner lines (the rules\' cap) = "4 earlier" + 4 shown');
  const foot = body.querySelector('.recap-foot');
  assert.ok(foot, 'a footer for the buttons');
  assert.match(textOf(foot), /Let's farm!/);
});

test('D1: a surprise on the porch comes first, and Show me closes the card and pans to the box', () => {
  const { s, now } = awayFarm();
  const { body, focus, closed } = mount(s, now);
  const first = body.querySelector('section');
  assert.ok(first.classList.contains('recap-surprise'), 'the first section is the surprise');
  assert.match(textOf(first), /left you a surprise on the porch/);
  first.querySelector('button').click();
  assert.equal(closed(), true);
  assert.deepEqual(focus, [[20.5, 30.5]]);
});

test('D1: Thanks for everything thanks each partner line not thanked yet, once', () => {
  const { s, now } = awayFarm();
  const { body, calls } = mount(s, now);
  const btn = body.querySelector('.recap-thanks');
  assert.ok(btn, 'the thanks button');
  btn.click();
  const thanked = calls.filter(([type]) => type === 'thank').map(([, a]) => a.i);
  assert.deepEqual(thanked.sort((a, b) => a - b), [0, 1, 3, 4, 5, 6, 7, 8], 'every partner line of the section minus the one thanked already');
  assert.equal(btn.disabled, true);
  assert.deepEqual(thankable(s, 'p1', [{ i: 1, by: 'p1' }, { i: 2, by: 'p2', ty: 'p1' }, { i: 3, by: 'ghost' }]), []);
});
