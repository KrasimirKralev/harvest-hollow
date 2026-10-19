// render-look, QA round 4: infra's I4-01 patch for render/objects-view.js (docs/qa/release/qa-r4/fix-infra.md,
// "Cross-lane"). The night glow (G8) is imported at the first dusk; a fetch that failed (a blip) left it gone for the
// session with a console.error and no word to the page. Now it goes through net/lazy.js: a failed fetch raises
// 'hh:assets-failed' { name: 'night-glow' } (main.js offers the reload) and is only warned. No DOM, no WebGL: a module
// hook makes the import fail the way Chrome words it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
registerHooks({
  resolve(spec, ctx, next) {
    if (/night-glow\.js$/.test(spec)) throw new TypeError(`Failed to fetch dynamically imported module: http://localhost/js/render/${spec.replace(/^.*\//, '')}`);
    return next(spec, ctx);
  },
});

const THREE = await import('three');
const { createObjectsView } = await import('../public/js/render/objects-view.js');
const { LOOK } = await import('../public/js/render/models.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.UTC(2026, 9, 13, 18);

test('I4-01: a night glow that failed to load raises hh:assets-failed (the page can offer the reload), without a console.error', async () => {
  const events = [];
  globalThis.addEventListener('hh:assets-failed', (e) => events.push(e.detail));
  const logs = { error: [], warn: [] };
  const { error, warn } = console;
  console.error = (...a) => logs.error.push(a.map((x) => String(x?.message ?? x)).join(' '));
  console.warn = (...a) => logs.warn.push(a.map((x) => String(x?.message ?? x)).join(' '));
  try {
    const layers = Object.fromEntries(['ground', 'crops', 'objects', 'gridFx', 'fx'].map((n) => [n, new THREE.Group()]));
    const view = createObjectsView(layers, { now: () => NOW });
    view.setState({ meta: { farmSeed: 1, tz: 'Europe/Sofia', createdAt: NOW }, farm: { expansions: ['home'], objects: {} }, players: {} });
    LOOK.uGlow.value = 1;                                  // dusk: the windows light up, the halos are asked for
    view.update(0.016, NOW);
    for (let i = 0; i < 50 && !events.length && !logs.error.length; i++) await sleep(10);
    view.update(0.016, NOW + 16);                          // asked for once (the browser keeps the failed module)
    await sleep(30);
  } finally { console.error = error; console.warn = warn; LOOK.uGlow.value = 0; }
  assert.deepEqual(logs.error, [], `no console.error for a link failure (HEAD: "night glow unavailable"): ${logs.error}`);
  assert.equal(events.length, 1, `one hh:assets-failed (HEAD: none): ${JSON.stringify(events)}`);
  assert.equal(events[0].name, 'night-glow');
  assert.match(events[0].why, /night-glow\.js/);
});
