// Phone features of the page (mobile wave 2026-10-03): the screen wake lock while playing and the fullscreen toggle.
// Owned by the mobile input lane. main.js creates it after the controller and hangs it on `controller.device`, so the
// ui (settings, the HUD's fullscreen button) reaches it through the controller it already has.
//
//   createDevice({ win?, doc?, nav?, options?: () => { keepAwake }, idleMs?, now? }) -> device
//   device.touchFirst                 a phone or tablet (coarse pointer, no hover): the wake lock is for these only
//   device.standalone                 started from the home screen (display-mode standalone / iOS navigator.standalone)
//   device.wakeLock.available         the browser has the Screen Wake Lock API AND the page is a secure context: the
//                                     LAN page http://192.168.x.y:3300 is NOT one, so there it is false and skipped
//   device.wakeLock.active            held right now
//   device.wakeLock.sync()            re-evaluate after the keepAwake option changed
//   device.fullscreen.available       the Fullscreen API works here (not on iPhone Safari: Add to Home Screen instead)
//   device.fullscreen.active
//   device.fullscreen.toggle() -> Promise<bool>   call it from a click / tap handler (a user gesture); true = now on
//   device.on('fullscreen' | 'wakelock', fn) -> unsubscribe     fn(active: bool)
//
// Wake lock policy (battery-aware): only on a touch-first device, only while the page is visible, and only while the
// player touched it in the last `idleMs` (3 minutes): a phone left on the table with the farm open sleeps as usual.
// The browser drops the lock whenever the page is hidden; it is taken again on the next touch after coming back.

export const DEVICE = Object.freeze({ idleMs: 180_000 });

export function createDevice({
  win = globalThis.window, doc = globalThis.document, nav = globalThis.navigator, options = () => ({}),
  idleMs = DEVICE.idleMs, now = () => performance.now(),
} = {}) {
  const fns = { fullscreen: new Set(), wakelock: new Set() };
  const emit = (name, v) => { for (const fn of [...fns[name]]) { try { fn(v); } catch (err) { console.error(`device listener '${name}' failed`, err); } } };
  const mq = (q) => { try { return Boolean(win?.matchMedia?.(q).matches); } catch { return false; } };
  const touchFirst = mq('(hover: none) and (pointer: coarse)');
  const standalone = mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || nav?.standalone === true;
  if (doc?.documentElement?.dataset) doc.documentElement.dataset.display = standalone ? 'standalone' : 'browser';

  // ---- screen wake lock --------------------------------------------------------------------------------------
  const wakeOk = Boolean(win?.isSecureContext && nav?.wakeLock && typeof nav.wakeLock.request === 'function');
  let sentinel = null;
  let asking = false;
  let lastInput = -Infinity;
  let idleT = null;
  const wanted = () => wakeOk && touchFirst && options().keepAwake !== false && doc?.visibilityState === 'visible'
    && now() - lastInput < idleMs;

  async function acquire() {
    if (sentinel || asking || !wanted()) return;
    asking = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!wanted()) { s.release().catch(() => {}); return; }     // the player went idle or hid the page meanwhile
      sentinel = s;
      s.addEventListener?.('release', () => { if (sentinel === s) { sentinel = null; emit('wakelock', false); } });
      emit('wakelock', true);
    } catch (err) {
      // battery saver, a permissions policy, a page that was hidden in between: the screen sleeps as usual
      console.info('wake lock not granted:', err && err.name ? err.name : err);
    } finally { asking = false; }
  }
  function release() {
    const s = sentinel;
    sentinel = null;
    if (s) { s.release().catch(() => {}); emit('wakelock', false); }
  }
  function sync() { if (wanted()) acquire(); else release(); }
  function onInput() {
    if (!wakeOk || !touchFirst) return;
    lastInput = now();
    clearTimeout(idleT);
    idleT = setTimeout(sync, idleMs + 50);
    acquire();
  }
  if (wakeOk && touchFirst && win?.addEventListener) {
    for (const ev of ['pointerdown', 'keydown']) win.addEventListener(ev, onInput, { capture: true, passive: true });
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') sync(); else sentinel = null; });
  }

  // ---- fullscreen --------------------------------------------------------------------------------------------
  const el = doc?.documentElement;
  const fsOk = Boolean(doc && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
    && el && (typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'));
  const fsActive = () => Boolean(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));
  async function toggle() {
    if (!fsOk) return false;
    try {
      if (fsActive()) {
        await (typeof doc.exitFullscreen === 'function' ? doc.exitFullscreen() : doc.webkitExitFullscreen());
        return false;
      }
      // navigationUI 'hide': Android Chrome drops its bars too
      if (typeof el.requestFullscreen === 'function') await el.requestFullscreen({ navigationUI: 'hide' });
      else await el.webkitRequestFullscreen();
      return true;
    } catch (err) {
      console.info('fullscreen refused:', err && err.name ? err.name : err);
      return fsActive();
    }
  }
  if (fsOk) {
    const changed = () => emit('fullscreen', fsActive());
    doc.addEventListener('fullscreenchange', changed);
    doc.addEventListener('webkitfullscreenchange', changed);
  }

  return {
    touchFirst,
    standalone,
    wakeLock: {
      available: wakeOk,
      get active() { return Boolean(sentinel); },
      sync,
    },
    fullscreen: {
      available: fsOk,
      get active() { return fsActive(); },
      toggle,
    },
    on(name, fn) {
      const set = fns[name];
      if (!set) return () => {};
      set.add(fn);
      return () => set.delete(fn);
    },
  };
}
