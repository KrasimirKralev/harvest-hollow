// The mode chip (M2): a small parchment banner at the top centre that says which special mode the input is in and
// how to leave it: picking a pair for the Breeding Barn ("Pick a second adult Cow", Cancel), being inside the
// farmhouse ("Grandma's Farmhouse", Leave), placing furniture ("Place the Armchair: R turns it", Cancel). One chip at a
// time; the newest mode wins. A polite live region, a real button (48 px on a phone), Esc does the same as the button
// (game/controller.js). Owned by the client lane; it styles itself on the ui's tokens and .btn / .paper.
//
//   createModeChip({ hud, input? }) -> chip
//     chip.show(key, { text, icon?, action?: { label, fn }, extra?: { label, fn }, tone? }) / chip.hide(key) / chip.key
//       action: the way out (Cancel, Leave: a paper button); extra: one more thing to do here (Furnish: a sky button)
//   ICONS                                 the chip's small glyphs ('heart', 'house', 'chair')

const CSS = `
/* under the HUD's top row (the portraits and the pills), centred; while it shows, toasts and notices step down below it.
   left + right + margin auto + max-content: centred without a transform, so it never shrinks to half the screen */
.mode-chip { position: absolute; left: 12px; right: 12px; margin: 0 auto; width: max-content;
  top: calc(var(--safe, 16px) + var(--sat, 0px) + 62px);
  display: flex; align-items: center; gap: 10px; max-width: min(620px, calc(100vw - 24px)); padding: 6px 8px 6px 14px;
  border-radius: var(--r-pill); font: 700 1rem/1.2 var(--font-ui); color: var(--ink-900); z-index: 5;
  box-shadow: inset 0 0 0 2px var(--paper-edge), 0 0 0 2.5px var(--wood-700), var(--drop);
  animation: mode-in var(--t-beat, 250ms) var(--ease-back, ease-out); }
.mode-chip[hidden] { display: none; }
.mode-chip.tone-love { box-shadow: inset 0 0 0 2px var(--paper-edge), 0 0 0 2.5px #C2483C, var(--drop); }
.mode-chip.tone-home { box-shadow: inset 0 0 0 2px var(--paper-edge), 0 0 0 2.5px var(--sun-900), var(--drop); }
.mode-chip .mc-ico { width: 26px; height: 26px; flex: none; }
.mode-chip .mc-text { flex: 1 1 auto; min-width: 0; }
.mode-chip .btn { flex: none; }
.mode-chip.touch { font-size: .9375rem; }
#hud:has(.mode-chip:not([hidden])) .toasts, #hud:has(.mode-chip:not([hidden])) .notice { margin-top: 56px; }
.mode-chip.touch .btn { min-height: 44px; padding-left: 18px; padding-right: 18px; }
@keyframes mode-in { from { opacity: 0; transform: translateY(-12px) scale(.94); } }
/* phones: under the Goal Tracker's chip (mobile.css puts it at 58 px), where the toasts go too */
@media (max-width: 600px), (max-height: 500px) {
  .mode-chip { top: calc(var(--sat, 0px) + 108px); padding: 4px 6px 4px 12px; gap: 8px; }
  .mode-chip .mc-text { font-size: .9375rem; line-height: 1.2; }
}
@media (prefers-reduced-motion: reduce) { .mode-chip { animation: none; } }
`;

/** Small glyphs (SVG, 26 x 26) in the game's palette. */
export const ICONS = Object.freeze({
  heart: '<svg class="mc-ico" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 22S3 15.5 3 9.2C3 6 5.4 4 8.1 4c2 0 3.7 1.1 4.9 2.9C14.2 5.1 15.9 4 17.9 4 20.6 4 23 6 23 9.2 23 15.5 13 22 13 22z" fill="#FF7A6B" stroke="#C2483C" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 8.2c-1 .3-1.6 1.1-1.7 2.2" stroke="#FFD0C8" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
  house: '<svg class="mc-ico" viewBox="0 0 26 26" aria-hidden="true"><path d="M3 12L13 4l10 8" fill="none" stroke="#8A5224" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11v11h14V11" fill="#F7D9A0" stroke="#8A5224" stroke-width="1.8" stroke-linejoin="round"/><rect x="11" y="15" width="4" height="7" fill="#B87533"/><rect x="16.5" y="13.5" width="2.5" height="2.5" fill="#FFD18A"/></svg>',
  chair: '<svg class="mc-ico" viewBox="0 0 26 26" aria-hidden="true"><path d="M7 4h12v9H7z" fill="#E8556E" stroke="#7E2620" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 13h16v4H5z" fill="#FF9B8F" stroke="#7E2620" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 17v5M19 17v5" stroke="#5A3215" stroke-width="2.2" stroke-linecap="round"/></svg>',
});

let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const el = document.createElement('style');
  el.id = 'hh-mode-chip-css';
  el.textContent = CSS;
  document.head.append(el);
}

export function createModeChip({ hud, input = () => 'mouse' }) {
  style();
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  const el = document.createElement('div');
  el.className = 'mode-chip paper';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const ico = document.createElement('span');
  ico.className = 'mc-icon-slot';
  ico.style.display = 'contents';
  const text = document.createElement('span');
  text.className = 'mc-text';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--small btn--paper';
  btn.hidden = true;
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'btn btn--small btn--sky';
  more.hidden = true;
  el.append(ico, text, more, btn);
  layer.append(el);
  hud.append(layer);
  let key = null;
  let fn = null;
  let fn2 = null;
  btn.addEventListener('click', () => { if (fn) fn(); });
  more.addEventListener('click', () => { if (fn2) fn2(); });

  return {
    get key() { return key; },
    el,
    show(k, { text: t, icon = null, action = null, extra = null, tone = '' } = {}) {
      key = k;
      fn = action ? action.fn : null;
      fn2 = extra ? extra.fn : null;
      more.hidden = !extra;
      if (extra && more.textContent !== extra.label) more.textContent = extra.label;
      el.className = `mode-chip paper${tone ? ` tone-${tone}` : ''}${input() === 'touch' ? ' touch' : ''}`;
      ico.innerHTML = icon && ICONS[icon] ? ICONS[icon] : '';
      if (text.textContent !== t) text.textContent = t;
      btn.hidden = !action;
      if (action) btn.textContent = action.label;
      el.hidden = false;
    },
    hide(k = key) {
      if (k !== key) return;
      key = null;
      fn = null;
      fn2 = null;
      el.hidden = true;
    },
  };
}
