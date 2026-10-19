// Release 1.0 M4 (life-feel; feel#1, ux-first#4, ux-phone#12): rewards and refusals raised while a panel is open are
// seen. ui/toasts.js under the small fake DOM: a toast the open panel would cover goes to #over-panels (above #panels);
// a card raised under an open panel is held (its timer does not run out unseen) and slides in when the panel closes,
// with a reward pip on the panel's title meanwhile; an urgent card shows above the panel at once; on a phone a notice
// waits for the open sheet. The browser half (topmost element at the centre, the coin flight over the Market) is
// .scratch/rb-life-feel/layers.mjs (notes: rel-life-feel.md).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

const document = installDom();
document.querySelector = (s) => document.body.querySelector(s);
document.querySelectorAll = (s) => document.body.querySelectorAll(s);
// the window events the toasts send to the sound layer
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;
let phone = false;
globalThis.matchMedia = (q) => ({ matches: phone && /max-width: 600px/.test(q), addEventListener() {}, removeEventListener() {} });

const { h } = await import('../public/js/ui/dom.js');
const { createToasts } = await import('../public/js/ui/toasts.js');

/** The panel registry as far as the toasts use it: top() and the 'open' / 'close' events. */
function registry() {
  const fns = [];
  const opens = [];
  return {
    name: null,
    top() { return this.name; },
    on(ev, fn) { if (ev === 'close') fns.push(fn); if (ev === 'open') opens.push(fn); return () => {}; },
    open(name, { modal = true } = {}) {
      this.name = name;
      const title = h('header.hh-panel-title');
      title.getBoundingClientRect = () => ({ left: 500, right: 860, top: 40, bottom: 90, width: 360, height: 50 });
      document.body.append(h(`section#panel-${name}`, { 'aria-modal': String(modal) }, title));
      for (const fn of opens) fn(name);
    },
    close() {
      const name = this.name;
      document.getElementById(`panel-${name}`)?.remove();
      this.name = null;
      for (const fn of fns) fn(name);
    },
  };
}

function setup() {
  document.body.replaceChildren(h('div#hud', h('div.toasts#toasts'), h('div.banners#banners')));
  const panels = registry();
  const S = { store: { state: null, pid: 'p1' }, ui: { panels } };
  const toasts = createToasts(S, (code) => `text of ${code}`);
  return { toasts, panels };
}
const inside = (el, sel) => Boolean(el && el.closest(sel));

test('M4: a toast raised over a modal panel shows above the panels (#over-panels); with none open, in the HUD', () => {
  const { toasts, panels } = setup();
  const a = toasts.toast('Plain line');
  assert.ok(inside(a, '#toasts'), 'no panel: the HUD\'s toasts');
  panels.open('market');
  const b = toasts.toast('NOT_ENOUGH');
  assert.ok(inside(b, '#over-panels'), 'the refusal over the Market is in #over-panels, not under the panel');
  assert.ok(!inside(b, '#hud'));
});

test('M4: a toast already showing when a panel opens over it moves above the panels (it would sit under the scrim)', () => {
  const { toasts, panels } = setup();
  const a = toasts.toast('Plain line');
  assert.ok(inside(a, '#toasts'));
  panels.open('naming');
  assert.ok(inside(a, '#over-panels'), 'the line raised before the naming sheet opened is above it now');
  assert.equal(a.textContent.includes('Plain line'), true);
});

test('M4: a quest card raised under an open panel waits, pips on the title, and slides in on close with its whole time', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { toasts, panels } = setup();
    const heard = [];
    const onCard = (e) => heard.push(e.detail);
    globalThis.addEventListener('hh:card', onCard);
    panels.open('market');
    toasts.banner({ id: 'quest-q1', kind: 'quest', ribbon: 'Quest complete!', message: 'Market Morning',
      things: [{ icon: 'coins', name: '+55 coins' }], ttl: 8000 });
    assert.equal(document.querySelectorAll('#banners .unlock-banner').length, 0, 'not drawn under the panel');
    const pip = document.querySelector('#over-panels .reward-pip');
    assert.ok(pip, 'a reward pip on the panel title');
    assert.match(pip.textContent, /✓ Quest complete! · \+55 coins/);
    assert.equal(heard.length, 0, 'no card is on screen yet (the quest jingle waits for it)');
    mock.timers.tick(20_000);                         // the player stays in the Market for 20 s
    panels.close();
    const card = document.querySelector('#banners .unlock-banner');
    assert.ok(card, 'the card slides in as the panel closes');
    assert.deepEqual(heard.map((x) => x.kind), ['quest']);
    mock.timers.tick(3000);
    assert.ok(card.isConnected && !card.classList.contains('leaving'), 'still up 3 s after the close (M4 >= 3 s)');
    globalThis.removeEventListener('hh:card', onCard);
  } finally { mock.timers.reset(); }
});

test('M4: an urgent card (the Duet invite) shows above an open panel at once', () => {
  const { toasts, panels } = setup();
  panels.open('market');
  const r = toasts.banner({ id: 'duet-ask-1', kind: 'duet', urgent: true, ring: 3000, ttl: 3300, ribbon: 'Bake together?', message: 'now' });
  assert.ok(inside(r.el, '#over-panels'), 'the invite is above the panel');
});

test('ux-phone#12: on a phone a notice waits for the open sheet; on a desktop it goes above a modal panel', () => {
  const { toasts, panels } = setup();
  panels.open('market');
  const d = toasts.notice('Save the photo?');
  assert.ok(inside(d, '#over-panels'), 'desktop: above the modal panel');
  d.remove();
  phone = true;
  try {
    const n = toasts.notice('Keep the photo?');
    assert.equal(n, null, 'held while the sheet is open');
    assert.equal(document.querySelectorAll('.notice').length, 0);
    panels.close();
    assert.equal(document.querySelectorAll('.notice').length, 1, 'shown once the sheet closed');
  } finally { phone = false; }
});
