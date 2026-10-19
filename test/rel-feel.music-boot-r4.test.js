// QA r4 (life-feel) L4-03 (ap#2): on the owners' save over the 85 KB/s self path, the first tap started a composed track
// 2.5 s later (unlock -> the director -> playTrack, preload 'auto'): a 0.8-1.6 MB stream over the same link while the
// models loaded, and every model landed at 124-142 s instead of 101 s (§8: ≤ 120 s). Now composed tracks wait for the
// boot's models: render/assets.js pending() at 0 for 1 s (of the context's clock) after the farm's first scene, or
// 120 s after that scene at the latest; a generative piece (0 bytes) plays meanwhile. Later loads (a pan) never hold
// the music again. The director runs here with a fake AudioContext and media elements (test/audio-director.test.js),
// and the real assets.js counter, held at 1 by a model request that has not arrived. The director runs on a real 250 ms
// interval while the test moves the context's clock: the waits leave it several ticks per step (a loaded machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS_JSON = fs.readFileSync(path.join(ROOT, 'public/assets/audio/music/tracks.json'), 'utf8');
const realTimeout = globalThis.setTimeout;
for (const k of ['setInterval', 'setTimeout']) {
  const orig = globalThis[k];
  globalThis[k] = (...a) => { const t = orig(...a); t?.unref?.(); return t; };
}
// the 120 s cap reads performance.now(): the test moves it on instead of waiting
let skew = 0;
const realNow = performance.now.bind(performance);
performance.now = () => realNow() + skew;

const plays = [];
class Param {
  constructor(v = 0) { this.value = v; }
  cancelScheduledValues() {}
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
}
const node = () => ({ setPeriodicWave() {}, connect: (x) => x, disconnect() {}, gain: new Param(1), threshold: new Param(), knee: new Param(),
  ratio: new Param(), attack: new Param(), release: new Param(), frequency: new Param(), Q: new Param(), pan: new Param(),
  playbackRate: new Param(1), detune: new Param(), start() {}, stop() {}, buffer: null, type: '' });
let ctx = null;
class FakeCtx {
  constructor() { this.t = 0; this.state = 'suspended'; this.sampleRate = 8000; this.destination = node(); }
  get currentTime() { return this.t; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createBuffer(ch, n) { return { numberOfChannels: ch, length: n, getChannelData: () => new Float32Array(n) }; }
  decodeAudioData() { return Promise.reject(new Error('no decode in node')); }
}
class FakeAudio extends EventTarget {
  constructor() { super(); Object.assign(this, { _src: '', paused: true, ended: false, error: null, preload: 'auto', currentTime: 0, readyState: 0 }); }
  setAttribute() {}
  canPlayType() { return 'probably'; }
  get src() { return this._src; }
  set src(v) { this._src = v; }
  play() {
    this.paused = false;
    if (!this._src.startsWith('data:')) plays.push(this._src.replace(/^.*\/music\//, '').replace(/\..*$/, ''));
    return new Promise((res) => realTimeout(() => { this.readyState = 4; res(); this.dispatchEvent(new Event('playing')); }, 2));
  }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
}
const win = new EventTarget();
win.AudioContext = class extends FakeCtx {
  constructor() {
    super();
    ctx = this;
    return new Proxy(this, { get: (t, k) => (k in t ? (typeof t[k] === 'function' ? t[k].bind(t) : t[k])
      : typeof k === 'string' && k.startsWith('create') ? () => node() : undefined) });
  }
};
win.matchMedia = () => ({ matches: false });
globalThis.window = win;
globalThis.Audio = FakeAudio;
globalThis.document = Object.assign(new EventTarget(), {
  hidden: false, querySelector: () => null, getElementById: () => null, createElement: () => new FakeAudio(),
});
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.fetch = async (u) => {
  if (u.includes('tracks.json')) return { ok: true, json: async () => JSON.parse(TRACKS_JSON) };
  if (u.includes('manifest.json')) return { ok: true, json: async () => ({ sounds: {} }) };
  return { ok: false, status: 404 };
};

const wait = (ms) => new Promise((r) => realTimeout(r, ms));
async function advance(s, realMs = 300) { ctx.t += s; await wait(realMs); }

const assets = await import('../public/js/render/assets.js');
/** A model request that has not arrived (pending() 1) until `release()`. */
function modelLoading() {
  let release = null;
  assets.resetAssetCache();
  assets.setFetcher(() => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ hash: 'h', files: {}, keys: {}, defs: {} }) }); }));
  assets.loadManifest('/assets/models/manifest.json');
  return () => release?.();
}

test('L4-03: no composed track streams while the boot\'s models load (a generative piece plays); the first follows once they are in', async () => {
  const { audio } = await import('../public/js/audio.js?boot');
  audio.init({ now: () => Date.UTC(2026, 9, 4, 11, 0) });        // late morning: the 'day' scene
  await wait(40);
  const arrive = modelLoading();
  assert.equal(assets.pending(), 1, 'a model is on its way');
  audio.setScene({ golden: false, rain: 0 });                    // the farm's first scene (game/feedback.js)
  audio.unlock();                                                // the first tap, at "playable"
  for (let i = 0; i < 12; i++) await advance(5, 160);            // a minute of the context's clock (the director ticks every 250 ms)
  assert.deepEqual(plays, [], `no music file asked for while a model loads (asked: ${plays.join(', ')})`);
  assert.equal(audio.info().music.mode, 'generative', 'a generative piece meanwhile (0 bytes)');
  arrive();                                                      // the last model lands
  await wait(30);
  assert.equal(assets.pending(), 0);
  for (let i = 0; i < 900 && !plays.length; i++) await advance(2, 30);
  assert.ok(plays.length >= 1, 'a composed track once the models are in (after the piece and its rest)');
  // a later load (a pan to the town) does not hold the music again
  const pan = modelLoading();
  const before = plays.length;
  audio.force('day');
  await advance(0.5);
  await advance(0.5);
  assert.ok(plays.length > before, 'the latch stays open');
  audio.force(null);
  pan();
});

test('L4-03: models that never finish hold the first composed track for 120 s from the farm\'s first scene at most', async () => {
  plays.length = 0;
  const { audio } = await import('../public/js/audio.js?cap');
  audio.init({ now: () => Date.UTC(2026, 9, 4, 11, 0) });
  await wait(40);
  modelLoading();                                                // never arrives
  audio.setScene({ golden: false, rain: 0 });
  audio.unlock();
  for (let i = 0; i < 8; i++) await advance(5, 160);
  assert.deepEqual(plays, [], 'held while the model loads');
  skew += 121_000;                                               // two minutes after the farm's first scene
  for (let i = 0; i < 900 && !plays.length; i++) await advance(2, 30);
  assert.ok(plays.length >= 1, 'after 120 s a composed track plays anyway');
});
