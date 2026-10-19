// life-feel test helpers (release 1.0): a DOM stand-in just big enough to run render/fx.js `createFx` under node --test
// (no browser): a 2D canvas whose context swallows every call, elements with style / animate / rects, an <img> whose
// load fails or succeeds on demand (three's ImageLoader sets `src` and listens for load / error), and a log of every
// image URL asked for. installFxDom() sets globalThis.document / innerWidth / innerHeight for the calling file only.

/** A minimal element: children, style, dataset, classList, attributes, animate(), rects (set `rect` to move it). */
export class StubEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = { cssText: '', setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.textContent = '';
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    this.anims = [];
    const cls = new Set();
    this.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on) => { const v = on ?? !cls.has(c); if (v) cls.add(c); else cls.delete(c); return v; }, contains: (c) => cls.has(c) };
  }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === globalThis.document?.body; }
  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) if (c && typeof c === 'object') this.appendChild(c); }
  prepend(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.unshift(c); }
  remove() { const p = this.parentNode; if (!p) return; p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  removeEventListener(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter((f) => f !== fn); }
  dispatch(ev) { for (const fn of this.listeners[ev] || []) fn({ type: ev, target: this }); }
  getBoundingClientRect() { const r = this.rect; return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }; }
  getClientRects() { return this.isConnected && this.rect.width > 0 ? [this.getBoundingClientRect()] : []; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  animate(frames, opts) {
    const a = { frames, opts, onfinish: null, cancel() {}, finish() { this.onfinish?.(); } };
    this.anims.push(a);
    return a;
  }
}

/**
 * Install the stand-in. `images` decides what an <img> does once its src is set: 'fail' (an error event, like a dropped
 * Funnel request) or 'ok'; it can be changed later through the returned object. Returns { body, loads, images, finish }.
 */
export function installFxDom({ images = 'fail', width = 1366, height = 768 } = {}) {
  const loads = [];
  const ctl = { images };
  const ctx2d = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (typeof k !== 'string') return undefined;
      if (!(k in t)) t[k] = () => {};
      return t[k];
    },
    set() { return true; },
  });
  const mk = (tag) => {
    const t = String(tag).toLowerCase();
    if (t === 'canvas') { const c = new StubEl('canvas'); c.width = 0; c.height = 0; c.getContext = () => ctx2d; return c; }
    if (t === 'img') {
      const img = new StubEl('img');
      let src = '';
      Object.defineProperty(img, 'src', {
        get: () => src,
        set: (v) => { src = v; loads.push(v); setTimeout(() => img.dispatch(ctl.images === 'ok' ? 'load' : 'error'), 0); },
      });
      img.width = 0; img.height = 0;
      return img;
    }
    return new StubEl(t);
  };
  const body = new StubEl('body');
  const byId = new Map();
  globalThis.document = {
    body,
    createElement: mk,
    createElementNS: (ns, tag) => mk(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text), parentNode: null, remove() {} }),
    getElementById: (id) => { const el = byId.get(id); return el && el.isConnected ? el : null; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  // an element appended with an id is found by getElementById (the fx layers are created that way)
  const append = StubEl.prototype.appendChild;
  StubEl.prototype.appendChild = function appendChild(c) { const r = append.call(this, c); if (c.id) byId.set(c.id, c); return r; };
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  return { body, loads, images: ctl, byId };
}

/** A THREE-free stand-in for the fx layer (a Group): createFx only adds and removes meshes. */
export const stubLayer = () => ({ children: [], add(...m) { this.children.push(...m); }, remove(m) { this.children = this.children.filter((x) => x !== m); } });

/** toScreenM for the tests: every world point is on screen, metres mapped 10 px apart from (100, 100). */
export const stubToScreen = (mx, mz) => ({ x: 100 + mx * 10, y: 100 + mz * 10, visible: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
