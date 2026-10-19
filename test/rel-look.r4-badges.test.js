// render-look, QA round 4: ui-shell's patch request X4-4 for S4-09 (breaker br#2, docs/qa/release/qa-r4/fix-ui-shell.md).
// A badge icon whose picture failed once (a link blip) stayed an empty bubble for the session and logged console.error:
// the Image stayed in the atlas's map and nothing asked again (it is never in the document, so ui-shell's page-wide
// retry cannot see it). Now the same URL is asked for again after the backoff (models.js retryDelay) and at once on a
// wake, with one console.warn per icon. A fake document (a canvas whose 2D context records drawImage) and a fake Image.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);

const drawn = [];
const ctx = new Proxy({}, {
  get: (o, k) => (k === 'drawImage' ? (img) => drawn.push(img.src) : k in o ? o[k] : () => {}),
  set: (o, k, v) => { o[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };
class FakeImage {
  constructor() { FakeImage.all.push(this); this.complete = false; this.naturalWidth = 0; this.onload = null; this.onerror = null; }
  set src(v) { this._src = v; this.sets = (this.sets || 0) + 1; }
  get src() { return this._src; }
  fail() { this.complete = true; this.onerror?.(new Event('error')); }
  load() { this.complete = true; this.naturalWidth = 128; this.onload?.(new Event('load')); }
}
FakeImage.all = [];
globalThis.Image = FakeImage;

const THREE = await import('three');
const M = await import('../public/js/render/models.js');
const { createBadges } = await import('../public/js/render/badges.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Requests made for one icon's URL (a new Image or the same one's src set again). */
const asks = (icon) => FakeImage.all.filter((im) => String(im.src).includes(icon)).reduce((a, im) => a + (im.sets || 0), 0);
const latest = (icon) => FakeImage.all.filter((im) => String(im.src).includes(icon)).at(-1);

async function captured(fn) {
  const logs = { error: [], warn: [] };
  const { error, warn } = console;
  console.error = (...a) => logs.error.push(a.join(' '));
  console.warn = (...a) => logs.warn.push(a.join(' '));
  try { await fn(); } finally { console.error = error; console.warn = warn; }
  return logs;
}

test('S4-09: a badge icon that failed once is asked for again and then drawn; one console.warn, no console.error', async () => {
  M.setRetryTiming({ firstMs: 10, maxMs: 40 });
  const badges = createBadges(new THREE.Group());
  const logs = await captured(async () => {
    badges.set('b1', { icon: 'orange_juice', style: 'ready', pos: new THREE.Vector3(1, 2, 3) });
    assert.equal(asks('orange_juice'), 1, 'the icon is asked for once');
    latest('orange_juice').fail();                         // the link blip
    await sleep(80);
    assert.ok(asks('orange_juice') >= 2, `asked for again after the wait (HEAD: never; ${asks('orange_juice')} asks)`);
    latest('orange_juice').fail();                         // still down
    await sleep(120);
    const n = asks('orange_juice');
    assert.ok(n >= 3, `and again (${n})`);
    latest('orange_juice').load();                         // the link is back
  });
  assert.ok(drawn.some((s) => /orange_juice/.test(s)), 'the bubble draws the icon once it arrives (HEAD: an empty bubble for the session)');
  assert.deepEqual(logs.error, [], `no console.error for a link blip (HEAD: "badge icon … failed to load"): ${logs.error}`);
  assert.equal(logs.warn.filter((l) => /orange_juice/.test(l)).length, 1, `one warning for the icon: ${logs.warn}`);
  M.setRetryTiming();
});

test('S4-09: after the tries run out the icon waits for the link: a wake (online) asks for it again at once', async () => {
  M.setRetryTiming({ firstMs: 5, maxMs: 10 });
  const badges = createBadges(new THREE.Group());
  await captured(async () => {
    badges.set('b2', { icon: 'toy_horse', style: 'ready', pos: new THREE.Vector3() });
    for (let i = 0; i < 12; i++) { latest('toy_horse').fail(); await sleep(25); }
    const before = asks('toy_horse');
    await sleep(80);
    assert.equal(asks('toy_horse'), before, `given up for now: no request storm for an icon that keeps failing (${before} asks)`);
    assert.ok(before >= 4 && before <= 10, `a bounded number of tries (${before})`);
    globalThis.dispatchEvent(new Event('online'));
    assert.equal(asks('toy_horse'), before + 1, 'a wake asks again at once');
    latest('toy_horse').load();
  });
  assert.ok(drawn.some((s) => /toy_horse/.test(s)), 'drawn after the wake');
  M.setRetryTiming();
});
