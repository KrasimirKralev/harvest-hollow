// The destination ring of a click-to-walk (live requests 2026-10-04): a ring in my colour lies on the ground where my
// farmer is going, drawn in the DOM overlay with the ground's own perspective (an affine map of a unit circle from
// view.toScreen), and pops away when the farmer arrives, or when another walk (an action elsewhere) replaces it.
// Owned by the client-core lane.
//
//   createWalkMarker({ view, avatar, overlay, color? }) -> { show(x, z), hide(), setColor(css) }
//   groundMatrix(toScreen, x, z, r) -> [a, b, c, d, e, f] | null   CSS matrix() of a circle of radius r tiles around
//                                    (x, z) on the ground, for a 100 x 100 px element centred on the overlay origin (pure)

/** The CSS matrix that lays a 100 px circle (centred on its own origin) on the ground at (x, z), radius r tiles. */
export function groundMatrix(toScreen, x, z, r) {
  const o = toScreen(x, z, 0.02);
  const ex = toScreen(x + r, z, 0.02);
  const ez = toScreen(x, z + r, 0.02);
  if (!o || !ex || !ez || o.visible === false) return null;
  const k = 1 / 50;                                   // the element's radius is 50 px
  return [(ex.x - o.x) * k, (ex.y - o.y) * k, (ez.x - o.x) * k, (ez.y - o.y) * k, o.x, o.y];
}

export function createWalkMarker({ view, avatar, overlay, color = '#2BB3A3' }) {
  const el = document.createElement('div');
  el.className = 'walk-marker';
  el.hidden = true;
  el.innerHTML = '<i class="wm-ring"></i><i class="wm-dot"></i>';
  el.style.setProperty('--pc', color);
  overlay.append(el);
  let at = null;            // { x, z } of the walk the ring stands for
  let leaving = 0;
  let lastT = '';

  function place() {
    const m = groundMatrix((x, z, y) => view.toScreen(x, z, y), at.x, at.z, 0.42);
    if (!m) { el.style.visibility = 'hidden'; return; }
    const t = `matrix(${m.map((v) => +v.toFixed(3)).join(',')})`;
    if (t !== lastT) { el.style.transform = t; lastT = t; }
    el.style.visibility = 'visible';
  }

  function hide(pop = true) {
    if (!at) return;
    at = null;
    if (!pop) { el.hidden = true; return; }
    el.classList.add('done');
    clearTimeout(leaving);
    leaving = setTimeout(() => { if (!at) el.hidden = true; el.classList.remove('done'); }, 320);
  }

  view.onFrame(() => {
    if (!at) return;
    const d = avatar.destination;
    // arrived, or another walk took over (a click on a plot walks the farmer there instead)
    if (!d || Math.hypot(d.x - at.x, d.z - at.z) > 0.01) { hide(Boolean(!d)); return; }
    place();
  });

  return {
    show(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      clearTimeout(leaving);
      at = { x, z };
      lastT = '';
      el.classList.remove('done');
      // restart the drop-in animation on every new walk
      el.hidden = true;
      void el.offsetWidth;
      el.hidden = false;
      place();
    },
    hide: () => hide(false),
    setColor(css) { if (typeof css === 'string') el.style.setProperty('--pc', css); },
    get target() { return at ? { ...at } : null; },
  };
}
