// A tiny DOM for the ui-qa2 tests (no dependency): enough of Node / Element / document for the panels' h() trees to
// be built and read back (classes, data-*, attributes, text, simple selectors). Not a browser: no layout, no CSS.
// installDom() puts `document`, `Node`, `CSS` on globalThis for the calling test file only (node --test runs every
// file in its own process).

class FakeNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === globalThis.document?.body; }
  get children() { return this.childNodes.filter((c) => c instanceof FakeElement); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this._drop(); if (v !== '' && v !== null && v !== undefined) this._add(new FakeText(String(v))); }
  _drop() { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; }
  _wrap(c) { return c instanceof FakeNode ? c : new FakeText(String(c)); }
  _add(c, at = this.childNodes.length) {
    const n = this._wrap(c);
    if (n.parentNode) n.remove();
    n.parentNode = this;
    this.childNodes.splice(at, 0, n);
    return n;
  }
  append(...cs) { for (const c of cs) this._add(c); }
  appendChild(c) { return this._add(c); }
  prepend(...cs) { cs.reverse().forEach((c) => this._add(c, 0)); }
  replaceChildren(...cs) { this._drop(); this.append(...cs); }
  insertBefore(c, ref) { const i = ref ? this.childNodes.indexOf(ref) : -1; return this._add(c, i < 0 ? this.childNodes.length : i); }
  remove() { const p = this.parentNode; if (!p) return; p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; }
  after(...cs) { const p = this.parentNode; if (!p) return; let i = p.childNodes.indexOf(this) + 1; for (const c of cs) p._add(c, i++); }
  before(...cs) { const p = this.parentNode; if (!p) return; for (const c of cs) p._add(c, p.childNodes.indexOf(this)); }
  replaceWith(c) { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); this.remove(); p._add(c, i); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}

class FakeText extends FakeNode {
  constructor(t) { super(); this.data = t; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { for (const x of c) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) { const want = on === undefined ? !this.set.has(c) : Boolean(on); if (want) this.set.add(c); else this.set.delete(c); return want; }
  [Symbol.iterator]() { return this.set[Symbol.iterator](); }
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.classList = new ClassList(this);
    this.attrs = new Map();
    this.dataset = {};
    this.listeners = {};
    const vars = {};
    this.style = { setProperty: (k, v) => { vars[k] = String(v); }, getPropertyValue: (k) => vars[k] ?? '', cssText: '' };
    this.hidden = false;
    this.id = '';
  }
  get className() { return [...this.classList].join(' '); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) {
    if (k === 'class') return this.className;
    if (k.startsWith('data-')) return this.dataset[camel(k.slice(5))] ?? null;
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  dispatch(t, ev = {}) { for (const fn of this.listeners[t] || []) fn({ type: t, target: this, stopPropagation() {}, preventDefault() {}, ...ev }); }
  click() { this.dispatch('click'); }
  focus() {}
  blur() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  set innerHTML(v) { this._drop(); this._html = String(v); }
  get innerHTML() { return this._html ?? ''; }
  matches(sel) { return sel.split(',').some((s) => matchChain(this, s.trim().split(/\s+/))); }
  closest(sel) { for (let n = this; n instanceof FakeElement; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

/** One compound selector: tag, #id, .class, [attr], [attr="v"] (data-* through dataset), :not() is not supported. */
function matchOne(el, sel) {
  const re = /([a-z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*]?=)"?([^"\]]*)"?)?\]|(>)/gi;
  let m;
  let pos = 0;
  while ((m = re.exec(sel))) {
    if (m.index !== pos) return false;
    pos = re.lastIndex;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) {
      const v = el.getAttribute(m[4]);
      if (v === null) return false;
      if (m[5] === '=' && v !== m[6]) return false;
    }
  }
  return pos === sel.length && sel.length > 0;
}

function matchChain(el, parts) {
  if (!matchOne(el, parts.at(-1))) return false;
  if (parts.length === 1) return true;
  for (let p = el.parentNode; p instanceof FakeElement; p = p.parentNode) if (matchChain(p, parts.slice(0, -1))) return true;
  return false;
}

export function installDom() {
  const document = {
    createElement: (t) => new FakeElement(t),
    createElementNS: (_ns, t) => new FakeElement(t),
    createTextNode: (t) => new FakeText(t),
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  document.body = new FakeElement('body');
  document.getElementById = (id) => (document.body.id === id ? document.body : document.body.querySelector(`#${id}`));
  Object.assign(globalThis, { document, Node: FakeNode, CSS: { escape: (s) => String(s) } });
  return document;
}

/** Every text node's words under `el`, one string. */
export const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();
