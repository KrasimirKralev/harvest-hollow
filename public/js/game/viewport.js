// The phone's viewport (mobile wave 2026-10-03): orientation changes, and the visual viewport the iOS keyboard
// shrinks. Owned by the mobile input lane; main.js starts it at boot (the slot picker's name field opens a keyboard
// before the farm is up).
//
//   createViewport({ win?, doc? }) -> { state() -> { width, height, keyboard, portrait }, on(fn) -> off, stop() }
//
// What it does:
//   - publishes the visible area for the layout: CSS custom properties on <html> `--vvw` / `--vvh` (the visual
//     viewport, px) and `--kb` (how much of the layout viewport the on-screen keyboard covers, px), plus
//     `data-keyboard="open"` while a keyboard is up and `data-orient="portrait" | "landscape"`
//   - iOS leaves the page scrolled by the keyboard's height after it closes (the game is one fixed screen): it
//     scrolls back to the top once the keyboard is gone and no text field has the focus
//   - an orientation change fires one more `resize` once the browser has settled the new size (iOS reports the old
//     size at `orientationchange`, and the renderer and the controller's cached canvas rect read it on `resize`)

const KEYBOARD_PX = 120;            // a visual viewport this much shorter than the layout viewport: a keyboard is up

export function createViewport({ win = globalThis.window, doc = globalThis.document } = {}) {
  const vv = win?.visualViewport ?? null;
  const root = doc?.documentElement;
  const fns = new Set();
  let last = '';
  let settleT = null;

  function state() {
    const ih = win.innerHeight;
    const iw = win.innerWidth;
    const height = vv ? vv.height : ih;
    const width = vv ? vv.width : iw;
    // the keyboard covers the bottom of the layout viewport (the visual viewport may also be scrolled within it)
    const keyboard = vv ? Math.max(0, Math.round(ih - (vv.height + vv.offsetTop))) : 0;
    return { width: Math.round(width), height: Math.round(height), keyboard, portrait: ih >= iw };
  }

  const typing = () => {
    const el = doc.activeElement;
    return Boolean(el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable));
  };

  function apply() {
    const s = state();
    const key = `${s.width}x${s.height}k${s.keyboard}${s.portrait ? 'p' : 'l'}`;
    if (key === last) return;
    last = key;
    if (root) {
      root.style.setProperty('--vvw', `${s.width}px`);
      root.style.setProperty('--vvh', `${s.height}px`);
      root.style.setProperty('--kb', `${s.keyboard}px`);
      root.dataset.orient = s.portrait ? 'portrait' : 'landscape';
      if (s.keyboard >= KEYBOARD_PX) root.dataset.keyboard = 'open';
      else delete root.dataset.keyboard;
    }
    // the keyboard went away and left the page scrolled (iOS): back to the top, the HUD and the canvas are fixed
    if (s.keyboard < KEYBOARD_PX && !typing() && (win.scrollY || win.pageYOffset)) win.scrollTo(0, 0);
    for (const fn of [...fns]) { try { fn(s); } catch (err) { console.error('viewport listener failed', err); } }
  }

  const onOrient = () => {
    clearTimeout(settleT);
    settleT = setTimeout(() => {
      apply();
      try { win.dispatchEvent(new Event('resize')); } catch { /* an old browser without the Event constructor */ }
    }, 260);
  };
  // a text field closed without a resize (an external keyboard, iOS's "Done"): scroll back once the focus is gone
  const onFocusOut = () => setTimeout(() => { if (!typing() && (win.scrollY || win.pageYOffset)) win.scrollTo(0, 0); }, 120);

  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  win.addEventListener('resize', apply);
  win.addEventListener('orientationchange', onOrient);
  win.screen?.orientation?.addEventListener?.('change', onOrient);
  doc.addEventListener('focusout', onFocusOut);
  apply();

  return {
    state,
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
    stop() {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      win.removeEventListener('resize', apply);
      win.removeEventListener('orientationchange', onOrient);
      win.screen?.orientation?.removeEventListener?.('change', onOrient);
      doc.removeEventListener('focusout', onFocusOut);
      clearTimeout(settleT);
    },
  };
}
