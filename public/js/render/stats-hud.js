// The ?stats=1 readout (release 1.0, render-look G14; plan-astra 1.4): a small fixed corner line of the view's frames
// per second, quality tier (* = auto) and draw calls, updated twice a second, so the lead can read a real phone's
// numbers without a desktop inspector (G4 decides phone shadows on it). Loaded and created only with the parameter. A
// developer readout: it stays English and never takes input.
//
//   mountStatsHud({ search, doc, stats, setInterval }) -> element | null
//        search: location.search; stats(): view.stats(); doc and setInterval injectable for tests
//   clearTop(rect, obstacles, { gap, steps }) -> top    pure: QA r3 R3-03 (va#2)
// QA r3 R3-03 (va#2): on phones the top-right corner is the coin pill's (the readout covered its top and its coin, the
// lead's tool over the HUD it measures). The readout keeps its corner where it is free (desktop) and otherwise slides
// down past every HUD control it would cover (the coin pill, then the goal row under it), re-checked with each update,
// so every layout (iPhone 13, 360, a tablet) finds its own clear spot under the top HUD row.

/** True when the page's query asks for the readout (?stats=1 or &stats=1). Pure. */
export function wantsStats(search) {
  return /(?:^|[?&])stats=1(?:&|$)/.test(String(search || ''));
}

/** The HUD controls the readout must not cover (ui-shell's top row: pills, buttons, the goal row). */
const OBSTACLES = '#hud button, #hud .pill, #hud [role="button"], #tracker, .tracker-chip-wrap';

/**
 * The top (CSS px) at which a readout `rect` ({ left, top, right, bottom }) covers none of `obstacles` (same shape): its own
 * top when free, else just under the lowest control it meets, tried `steps` times (a control under that one). Pure.
 */
export function clearTop(rect, obstacles, { gap = 4, steps = 6 } = {}) {
  const h = rect.bottom - rect.top;
  let top = rect.top;
  for (let i = 0; i < steps; i++) {
    const hits = obstacles.filter((o) => rect.left < o.right && o.left < rect.right && top < o.bottom && o.top < top + h);
    if (!hits.length) return top;
    top = Math.max(...hits.map((o) => o.bottom)) + gap;
  }
  return top;
}

export function mountStatsHud({ search = typeof location !== 'undefined' ? location.search : '', doc = typeof document !== 'undefined' ? document : null,
  stats = () => ({}), setInterval: every = typeof setInterval === 'function' ? setInterval : null } = {}) {
  if (!wantsStats(search) || !doc || !every) return null;
  const el = doc.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-hh', 'stats');
  Object.assign(el.style, {
    position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 4px)', right: 'calc(env(safe-area-inset-right, 0px) + 4px)',
    zIndex: '9998', pointerEvents: 'none', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0, 0, 0, 0.62)',
    color: '#fff', font: '10px/1.3 ui-monospace, Menlo, Consolas, monospace', whiteSpace: 'pre', opacity: '0.85',
  });
  const corner = el.style.top;
  /** R3-03: back to the corner, then down past the HUD controls it would cover (one layout read, twice a second). */
  const place = () => {
    if (typeof el.getBoundingClientRect !== 'function' || typeof doc.querySelectorAll !== 'function') return;
    el.style.top = corner;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const obstacles = [];
    const half = (doc.defaultView?.innerHeight ?? globalThis.innerHeight ?? 2000) / 2;
    for (const o of doc.querySelectorAll(OBSTACLES)) {
      const b = o.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && b.top < half) obstacles.push(b);     // the top row only, never the phone bar
    }
    const top = clearTop(r, obstacles);
    if (top !== r.top) el.style.top = `${Math.round(top)}px`;
  };
  const tick = () => {
    let s = {};
    try { s = stats() || {}; } catch { /* the view is not up yet */ }
    el.textContent = `${s.fps ?? '-'} fps · ${s.tier ?? '-'}${s.tierMode === 'auto' ? '*' : ''} · ${s.calls ?? '-'} calls`; // i18n-ok: a developer readout
    try { place(); } catch { /* a page without layout (tests) */ }
  };
  if (doc.body && typeof doc.body.append === 'function') doc.body.append(el);
  tick();                                  // after append: the first placement measures the laid-out readout
  every(tick, 500);
  return el;
}
