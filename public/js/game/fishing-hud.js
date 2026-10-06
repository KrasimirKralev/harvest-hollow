// The fishing cast on screen (GDD §6.2 #21, M2): a bobber on the water where my line lands (decorative, in the 3D
// overlay) and a small parchment card above it with what to do now (in the HUD: real buttons, a polite live region).
// The card follows the bobber, clamped inside the screen clear of the HUD's edges; on a phone its buttons are 48 px
// thumbs. Click, tap or Space anywhere hooks a biting fish (game/controller.js routes the press to fishing.press()).
// Owned by the client lane; it styles itself (one <style> it injects once, built on the ui's tokens and .btn/.paper).
//
//   createFishingHud({ fishing, view, hud, overlay, now, pid?, input?, motion? }) -> { el, card, destroy() }
//     When the view draws my farmer fishing (render-life: view.avatars.isFishing(pid), its own float and line), the DOM
//     bobber stays hidden and the card floats over my farmer's head (view.avatars.screenPosOf) instead
//     now(): the server clock (the hourly cast's wait); input(): 'mouse' | 'touch' | 'pen' (the words: "click" or
//     "tap"); motion(): 'full' | 'reduced' (no bobbing)
//   phaseText(phase, { c, input, wait, why, line }) -> { title, sub }   the card's words (pure, tested)
//   catchTitle(fishCaught) -> "A 42 cm Perch!"   starsOf(grade) -> 1..3   fmtWait(ms) -> 'in 42 min'
import { FISHING } from '../../../shared/content/index.js';
import { t, ctext, onLang } from '../i18n/index.js';

/** A wait as a friendly phrase ("in 42 min", "in 1 h 5 min"), rounded up to the minute. */
export function fmtWait(ms) {
  if (!Number.isFinite(ms) || ms <= 30_000) return t('game.fish.wait.moment');
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return t('game.fish.wait.m', { m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('game.fish.wait.hm', { h, m: r }) : t('game.fish.wait.h', { h });
}
/** A fish's name in the language in effect (FISHING.fish; lane B translates it in i18n/bg/text-b.js). */
const fishName = (f) => ctext('FISHING', `fish.${f.id}`, 'name', f.name);
const fishLine = (k, en) => ctext('FISHING', 'lines', k, FISHING?.lines?.[k] ?? en);

const CSS = `
.fh-bobber { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 3; }
.fh-bobber[hidden] { display: none; }
.fh-bobber .fh-float { position: absolute; left: -11px; top: -30px; width: 22px; height: 34px; transform-origin: 50% 85%;
  filter: drop-shadow(0 2px 2px rgba(30, 40, 50, .35)); }
.fh-bobber .fh-ring { position: absolute; left: -22px; top: -9px; width: 44px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, .8); opacity: 0; }
.fh-bobber .fh-bang { position: absolute; left: -12px; top: -66px; width: 24px; height: 28px; border-radius: 12px;
  font: 800 1.25rem/28px var(--font-display); color: var(--ink-900); text-align: center; background: var(--sun-300);
  box-shadow: 0 0 0 3px #fff, 0 4px 10px rgba(0, 0, 0, .3); opacity: 0; transform: scale(.3); }
.fh-bobber.is-wait .fh-float { animation: fh-bob 1.9s ease-in-out infinite; }
.fh-bobber.is-wait .fh-ring, .fh-bobber.is-bite .fh-ring { animation: fh-ring 2.2s ease-out infinite; }
.fh-bobber.is-wait .fh-ring + .fh-ring { animation-delay: 1.1s; }
.fh-bobber.is-bite .fh-float { animation: fh-dip .42s ease-in-out infinite; }
.fh-bobber.is-bite .fh-ring { animation-duration: .8s; }
.fh-bobber.is-late .fh-float { animation: fh-dip .95s ease-in-out infinite; }
.fh-bobber.is-late .fh-ring { animation: fh-ring 1.4s ease-out infinite; }
.fh-bobber.is-bite .fh-bang { opacity: 1; transform: scale(1); transition: transform .25s var(--ease-back), opacity .15s; }
.fh-bobber.is-reel .fh-float { animation: fh-reel .5s ease-in-out infinite; }
.fh-bobber.is-cast .fh-float { animation: fh-land .9s var(--ease-out) both; }
.fh-bobber.is-done .fh-float, .fh-bobber.is-gone .fh-float { animation: fh-up .7s var(--ease-in) both; }
.fh-bobber.is-done .fh-ring { animation: fh-ring .9s ease-out 2; border-color: #fff; }
@keyframes fh-bob { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(3px) rotate(3deg); } }
@keyframes fh-dip { 0%, 100% { transform: translateY(0); } 45% { transform: translateY(11px) scaleY(.82); } }
@keyframes fh-reel { 0%, 100% { transform: translateX(-3px) rotate(-12deg); } 50% { transform: translateX(3px) rotate(12deg); } }
@keyframes fh-land { 0% { transform: translateY(-90px) scale(.6); opacity: 0; } 70% { transform: translateY(4px) scale(1); opacity: 1; }
  100% { transform: translateY(0); } }
@keyframes fh-up { to { transform: translateY(-40px) scale(.7); opacity: 0; } }
@keyframes fh-ring { 0% { transform: scale(.35); opacity: .9; } 100% { transform: scale(1.7); opacity: 0; } }
.fh-card { position: absolute; left: 0; top: 0; min-width: 210px; max-width: min(300px, calc(100vw - 24px));
  padding: 10px 14px 12px; border-radius: var(--r-m); box-shadow: var(--drop), inset 0 0 0 2px var(--paper-edge);
  font: 500 .9375rem/1.3 var(--font-ui); color: var(--ink-900); text-align: center; z-index: 4;
  transition: opacity var(--t-beat) var(--ease-out); }
.fh-card[hidden] { display: none; }
.fh-card::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -9px; width: 18px; height: 18px; margin-left: -9px;
  background: var(--paper-100); transform: rotate(45deg); box-shadow: 2px 2px 0 0 var(--paper-edge); }
.fh-card.below::after { bottom: auto; top: -9px; box-shadow: -2px -2px 0 0 var(--paper-edge); }
.fh-title { font: 800 1.125rem/1.15 var(--font-display); color: var(--ink-900); display: flex; gap: 6px; align-items: center; justify-content: center; }
.fh-title .fh-ico { width: 22px; height: 22px; flex: none; }
.fh-sub { margin-top: 2px; color: var(--ink-500); font-size: .875rem; }
.fh-meter { position: relative; height: 10px; margin: 8px 2px 2px; border-radius: var(--r-pill); background: var(--paper-300);
  box-shadow: inset 0 1px 2px rgba(62, 38, 18, .35); overflow: hidden; }
.fh-meter[hidden] { display: none; }
.fh-meter i { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: inherit; background: linear-gradient(90deg, var(--sky-300), var(--sky-500)); }
.fh-card.is-bite .fh-meter i { background: linear-gradient(90deg, var(--sun-500), var(--stop-500)); }
.fh-acts { display: flex; gap: 8px; justify-content: center; margin-top: 9px; flex-wrap: wrap; }
.fh-acts:empty { display: none; }
.fh-card .btn { min-height: 40px; }
.fh-card .fh-hook { font-size: 1.25rem; padding: 12px 28px 14px; animation: fh-pulse .55s ease-in-out infinite alternate; }
@keyframes fh-pulse { from { transform: scale(1); } to { transform: scale(1.08); } }
.fh-card.is-done .fh-title { color: var(--go-900); }
.fh-stars { display: inline-flex; gap: 2px; margin-left: 2px; }
.fh-stars b { width: 14px; height: 14px; clip-path: polygon(50% 0, 62% 35%, 100% 38%, 70% 60%, 80% 100%, 50% 77%, 20% 100%, 30% 60%, 0 38%, 38% 35%);
  background: var(--paper-300); }
.fh-stars b.on { background: var(--sun-500); }
.fh-card.touch .btn { min-height: 48px; padding-left: 20px; padding-right: 20px; }
.fh-card.touch .fh-hook { min-height: 56px; min-width: 160px; }
@media (prefers-reduced-motion: reduce) {
  .fh-bobber *, .fh-card .fh-hook { animation: none !important; }
}
.motion-reduced .fh-bobber *, .motion-reduced .fh-card .fh-hook { animation: none !important; }
`;

let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const el = document.createElement('style');
  el.id = 'hh-fishing-css';
  el.textContent = CSS;
  document.head.append(el);
}

/** The red-and-white float (SVG, 22 x 34). */
const FLOAT_SVG = '<svg class="fh-float" viewBox="0 0 22 34" aria-hidden="true">'
  + '<path d="M11 1v8" stroke="#3E2612" stroke-width="2" stroke-linecap="round"/>'
  + '<path d="M2 18a9 9 0 0 1 18 0z" fill="#E8554A" stroke="#7E2620" stroke-width="1.6"/>'
  + '<path d="M2 18a9 9 0 0 0 18 0z" fill="#FFFBEE" stroke="#7E2620" stroke-width="1.6"/>'
  + '<ellipse cx="8" cy="13" rx="2.4" ry="1.6" fill="#FF9B8F"/>'
  + '<path d="M11 27v5" stroke="#3E2612" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_SVG = '<svg class="fh-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c4-6 12-6 15 0-3 6-11 6-15 0z" fill="#4AA8E8" stroke="#1C5283" stroke-width="1.5"/>'
  + '<path d="M18 12l4-3v6z" fill="#4AA8E8" stroke="#1C5283" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="11" r="1.2" fill="#1C5283"/></svg>';

/** 1..3 stars for the rules' reel grade (0 the line came back anyway, 1 good, 2 perfect). */
export const starsOf = (grade) => (grade >= 2 ? 3 : grade === 1 ? 2 : 1);

/** "A 42 cm Perch!" for the rules' `fishCaught` event (content FISHING.fish names the species). */
export function catchTitle(c) {
  if (!c || !c.fish) return t('game.fish.catch');
  const f = FISHING?.fish?.find((x) => x.id === c.fish);
  const name = f ? fishName(f) : String(c.fish).replace(/_/g, ' ');
  if (c.joke || f?.joke) return t('game.fish.joke', { name });
  return Number.isFinite(c.cm) ? t('game.fish.caughtCm', { cm: c.cm, name }) : t('game.fish.caught', { name });
}

/**
 * The card's words for a phase (pure). input: 'touch' says "tap"; wait: ms until the hourly cast is back (seated);
 * c: the rules' fishCaught event (done); line: a calm line for the wait (content FISHING.lines.cast).
 * @returns {{ title: string, sub: string }}
 */
export function phaseText(phase, { c = null, input = 'mouse', wait = null, why = null, line = null } = {}) {
  const press = input === 'touch' ? t('game.fish.pressTouch') : t('game.fish.press');
  switch (phase) {
    case 'cast': return { title: t('game.fish.casting'), sub: t('game.fish.castingSub') };
    case 'wait': return { title: t('game.fish.waiting'), sub: line ?? t('game.fish.waitingSub', { press }) };
    case 'bite': return { title: t('game.fish.bite'), sub: press };
    case 'late': return { title: t('game.fish.late'), sub: t('game.fish.lateSub') };
    case 'reel': return { title: t('game.fish.reeling'), sub: t('game.fish.reelingSub') };
    case 'done': {
      const sub = c?.joke ? fishLine('boot', t('game.fish.boot')) : c?.record ? fishLine('record', t('game.fish.record'))
        : c?.weekBest ? t('game.fish.weekBest') : c?.grade === 2 ? t('game.fish.perfect') : t('game.fish.logbook');
      return { title: catchTitle(c), sub };
    }
    case 'seated':
      if (Number.isFinite(wait) && wait > 0) return { title: t('game.fish.resting'), sub: t('game.fish.nextCast', { when: fmtWait(wait) }) };
      if (why) return { title: t('game.fish.onDock'), sub: t('game.fish.notBiting') };
      return { title: t('game.fish.onDock'), sub: t('game.fish.oneCast') };
    default: return { title: '', sub: '' };
  }
}

export function createFishingHud({ fishing, view, hud, overlay, now = () => Date.now(), pid = () => null, input = () => 'mouse',
  motion = () => 'full' }) {
  style();
  const bob = document.createElement('div');
  bob.className = 'fh-bobber';
  bob.hidden = true;
  bob.innerHTML = `<i class="fh-ring"></i><i class="fh-ring"></i>${FLOAT_SVG}<b class="fh-bang">!</b>`;
  overlay.append(bob);

  const layer = document.createElement('div');
  layer.className = 'fh-layer';
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  const card = document.createElement('div');
  card.className = 'fh-card paper';
  card.hidden = true;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', t('game.fish.label'));
  card.innerHTML = `<div class="fh-title" aria-live="polite">${ICON_SVG}<span></span><span class="fh-stars" hidden></span></div>`
    + '<div class="fh-sub"></div><div class="fh-meter" hidden><i></i></div><div class="fh-acts"></div>';
  layer.append(card);
  hud.append(layer);
  const titleEl = card.querySelector('.fh-title span');
  const starsEl = card.querySelector('.fh-stars');
  const subEl = card.querySelector('.fh-sub');
  const meter = card.querySelector('.fh-meter');
  const bar = meter.querySelector('i');
  const acts = card.querySelector('.fh-acts');

  let phase = 'idle';
  let at = null;
  let caught = null;
  let why = null;
  let line = null;
  let hintText = null;
  let hintUntil = 0;
  let lastKey = '';
  let lastPos = '';
  let waitUntil = null;
  let size = { w: 240, h: 110 };

  const button = (label, cls, fn, aria) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn--small ${cls}`;
    b.textContent = label;
    if (aria) b.setAttribute('aria-label', aria);
    // pointerdown, not click: a fish bites for 1.8 s, and a phone's click comes 300 ms after the finger
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    b.addEventListener('click', (e) => { if (e.detail === 0) fn(); });          // keyboard Enter / Space on the button
    return b;
  };

  function paintActions() {
    acts.replaceChildren();
    if (phase === 'bite') acts.append(button(t('game.fish.hook'), 'btn--sun fh-hook', () => fishing.press()));
    else if (phase === 'late') acts.append(button(t('game.fish.reel'), 'btn--sky', () => fishing.press()));
    else if (phase === 'seated' && !waitUntil && !why) acts.append(button(t('game.fish.cast'), 'btn--sky', () => fishing.again(), t('game.fish.castLabel')));
    if (!['bite', 'cast', 'reel', 'late'].includes(phase)) acts.append(button(t('game.fish.stop'), 'btn--paper', () => fishing.stop('hud')));
  }

  function paint() {
    const hinted = hintText && performance.now() < hintUntil;
    // whole minutes only: the card is re-painted when its words change, not every frame
    const wait = waitUntil ? Math.max(0, Math.ceil((waitUntil - now()) / 60_000) * 60_000) : null;
    const t = phaseText(phase, { c: caught, input: input(), wait, why, line });
    const key = `${phase}|${hinted ? hintText : ''}|${t.title}|${t.sub}|${input()}`;
    if (key === lastKey) return;
    lastKey = key;
    card.className = `fh-card paper is-${phase}${input() === 'touch' ? ' touch' : ''}${motion() === 'reduced' ? ' motion-reduced' : ''}`;
    titleEl.textContent = t.title;
    subEl.textContent = hinted ? hintText : t.sub;
    starsEl.hidden = phase !== 'done' || !caught || caught.joke === true;
    if (!starsEl.hidden) starsEl.innerHTML = [1, 2, 3].map((k) => `<b class="${k <= starsOf(caught.grade) ? 'on' : ''}"></b>`).join('');
    meter.hidden = !['bite', 'reel'].includes(phase);
    bob.className = `fh-bobber is-${phase}${motion() === 'reduced' ? ' motion-reduced' : ''}`;
    paintActions();
    // measured once per change of words (never per frame: a forced layout each frame is what qa2 CL-05 removed)
    size = { w: card.offsetWidth || 240, h: card.offsetHeight || 110 };
    lastPos = '';
  }

  /** Place the bobber on its water point and the card above it (below it when the bobber is near the top). */
  function place() {
    if (!at || !at.water) return;
    // the view's own float and line (render-life) when it draws my farmer fishing: then the card sits over my head
    const me = pid();
    const av = view.avatars;
    const own = Boolean(me && av && typeof av.isFishing === 'function' && av.isFishing(me));
    const head = own && typeof av.screenPosOf === 'function' ? av.screenPosOf(me) : null;
    const w = view.toScreen(at.water.x, at.water.z, 0.05);
    const p = head ? { x: head.x, y: head.y + 40, visible: true } : w;
    if (!w || w.visible === false) { bob.style.visibility = 'hidden'; } else bob.style.visibility = 'visible';
    bob.hidden = own || ['seated', 'idle'].includes(phase);
    if (!p) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // the camera went elsewhere (the farmer and the float are off screen): no card pinned over the HUD's corner; it
    // comes back when the dock is in view again (the fishing mode itself goes on)
    const away = p.visible === false || p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60;
    card.style.visibility = away ? 'hidden' : '';
    if (away) { lastPos = ''; return; }
    const cw = size.w;
    const ch = size.h;
    const touch = input() === 'touch';
    const top = touch ? 96 : 80;
    const bottom = touch ? 180 : 150;
    let x = p.x - cw / 2;
    let y = p.y - 64 - ch;
    let below = false;
    if (y < top) { y = p.y + 30; below = true; }
    x = Math.max(12, Math.min(W - cw - 12, x));
    y = Math.max(top, Math.min(H - bottom - ch, y));
    const tail = Math.max(18, Math.min(cw - 18, p.x - x));
    const k = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(x)},${Math.round(y)},${below}`;
    if (k === lastPos) return;
    lastPos = k;
    if (w) bob.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`;
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    card.style.setProperty('--tail', `${Math.round(tail)}px`);
    card.classList.toggle('below', below);
  }

  const offs = [
    fishing.on('phase', (e) => {
      phase = e.phase;
      at = e.at ?? at;
      caught = e.catch ?? null;
      if (phase === 'idle') { at = null; card.hidden = true; bob.hidden = true; lastKey = ''; return; }
      if (phase === 'cast') {
        const lines = ctext('FISHING', 'lines', 'cast', FISHING?.lines?.cast ?? []);
        line = lines.length ? lines[Math.floor(Math.random() * lines.length)] : null;
      }
      if (phase === 'seated') {
        const next = fishing.nextAt?.();
        waitUntil = Number.isFinite(next) ? next : null;
        const c = waitUntil ? null : fishing.code?.();
        why = c && c !== 'COOLDOWN' && c !== 'TOO_FAR' ? c : null;
      } else { waitUntil = null; why = null; }
      card.hidden = false;
      lastPos = '';
      paint();
      place();
    }),
    fishing.on('hint', ({ text }) => { hintText = text; hintUntil = performance.now() + 2400; lastKey = ''; paint(); }),
    onLang(() => { card.setAttribute('aria-label', t('game.fish.label')); lastKey = ''; if (phase !== 'idle') { paint(); paintActions(); } }),
  ];
  const offFrame = view.onFrame?.(() => {
    if (phase === 'idle') return;
    const v = fishing.view?.();
    if (v && !meter.hidden) bar.style.width = `${Math.round((phase === 'bite' ? 1 - v.k : v.k) * 100)}%`;
    paint();
    place();
  });

  return {
    el: bob,
    card,
    destroy() {
      for (const off of offs) off?.();
      if (typeof offFrame === 'function') offFrame();
      bob.remove();
      layer.remove();
    },
  };
}
