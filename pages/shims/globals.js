// Node globals the farm server touches, for the browser build (injected by esbuild before pages/local-server.js).
if (typeof globalThis.setImmediate !== 'function') {
  globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  globalThis.clearImmediate = (t) => clearTimeout(t);
}
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = { from: (s, enc) => {
    if (enc === 'hex') return Uint8Array.from(String(s).match(/../g) || [], (h) => parseInt(h, 16));
    return new TextEncoder().encode(String(s));
  } };
}
