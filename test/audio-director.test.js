// The music director's state machine (public/js/audio.js), driven in node with a fake AudioContext and fake media
// elements (its own process: node --test runs every file apart, so the fake window / document / Audio stay here).
// The pure helpers are in test/audio-music.test.js; this file checks what the running director does:
//   - a borrowed track (the title tune just played, the Fair's one dance played) is kept, never thrown away at once for
//     the track that just played (review 2026-10-04: title-menu -> day-river (0.3 s) -> title-menu)
//   - a pause the director did not ask for (media keys, headphones out) ends the piece; the next one follows the rest
//   - a server restart at a track boundary is a network failure: retried within minutes, not banned for 10, and the
//     tries are spaced out instead of burning through the list
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS_JSON = fs.readFileSync(path.join(ROOT, 'public/assets/audio/music/tracks.json'), 'utf8');

// the director's timers must not keep the test process alive (the test's own waits use the real setTimeout)
const realTimeout = globalThis.setTimeout;
for (const k of ['setInterval', 'setTimeout']) {
  const orig = globalThis[k];
  globalThis[k] = (...a) => { const t = orig(...a); t?.unref?.(); return t; };
}

const server = { down: false };
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
const els = [];
class FakeAudio extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { _src: '', _tok: 0, paused: true, ended: false, error: null, preload: 'auto', currentTime: 0, readyState: 0 });
    els.push(this);
  }
  setAttribute() {}
  canPlayType() { return 'probably'; }
  get src() { return this._src; }
  set src(v) { Object.assign(this, { _src: v, error: null, paused: true, ended: false, readyState: 0 }); this._tok++; }
  play() {
    const tok = ++this._tok;
    this.paused = false;
    const music = !this._src.startsWith('data:');
    if (music) plays.push(this._src.replace(/^.*\/music\//, '').replace(/\..*$/, ''));
    return new Promise((res, rej) => setTimeout(() => {
      if (tok !== this._tok) { rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
      if (music && server.down) {
        // a source that never arrives: Chrome's code 4 (no metadata), the 'error' event, a rejected play()
        this.error = { code: 4 };
        this.paused = true;
        this.dispatchEvent(new Event('error'));
        rej(Object.assign(new Error('no supported sources'), { name: 'NotSupportedError' }));
        return;
      }
      this.readyState = 4;
      res();
      this.dispatchEvent(new Event('playing'));
    }, 2));
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  /** the track plays to its end: 'pause' then 'ended', as a browser fires them */
  finish() { this.ended = true; this.paused = true; this.dispatchEvent(new Event('pause')); this.dispatchEvent(new Event('ended')); }
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
/** Move the context clock on by `s` seconds and let the director's 250 ms tick run. */
async function advance(s, realMs = 300) { ctx.t += s; await wait(realMs); }
/** The element of the track the director plays now (a deck it let go pauses a moment later, on a real timer). */
const playing = () => els.find((e) => !e.paused && e._src.includes(`/music/${audio.info().music.track}.`));
const noRepeats = (list) => list.every((x, i) => i === 0 || x !== list[i - 1]);

const { audio } = await import('../public/js/audio.js');
audio.init({ now: () => Date.UTC(2026, 9, 4, 11, 0) });          // late morning: the 'day' scene
await wait(30);

test('a borrowed track plays on: the title tune and the Fair\'s one dance are never followed by themselves', async () => {
  audio.setScene({ title: true });
  audio.unlock();
  await advance(3);
  await advance(0.5);
  assert.equal(audio.info().music.track, 'title-menu');
  playing().finish();
  await advance(61);                                           // the 30-60 s rest
  await advance(0.3);
  const borrowed = audio.info().music;
  assert.notEqual(borrowed.track, 'title-menu', 'the title tune does not play twice in a row');
  assert.ok(borrowed.track, 'a track from the day borrowed for the title screen');
  for (let i = 0; i < 6; i++) await advance(0.5);              // well past the 4 s cross-fade
  assert.equal(audio.info().music.track, borrowed.track, 'the borrowed track is kept');
  // two ceremonies in a row: the second wants the Fair again, its only track just played
  audio.setScene({ title: false });
  audio.festive();
  await advance(3);
  await advance(0.3);
  assert.equal(audio.info().music.track, 'fair-minstrel');
  audio.festive();
  await advance(3);
  for (let i = 0; i < 6; i++) await advance(0.5);
  assert.notEqual(audio.info().music.track, 'fair-minstrel', 'not the dance twice in a row');
  assert.ok(noRepeats(plays), `no track twice in a row: ${plays.join(' > ')}`);
  assert.ok(plays.length <= 5, `no stream churn: ${plays.join(' > ')}`);
  audio.setScene({ title: null });
});

test('a pause the director did not ask for (media keys, headphones out) ends the piece; the next follows the rest', async () => {
  audio.force('day');
  await advance(0.5);
  await advance(0.5);
  const was = audio.info().music.track;
  assert.ok(was);
  playing().pause();                                           // the phone's media controls
  await advance(0.5);
  const m = audio.info().music;
  assert.equal(m.track, null, 'the director let the paused deck go');
  assert.ok(m.restIn > 0 && m.restIn <= 60, `a rest follows (${m.restIn} s)`);
  await advance(61);
  await advance(0.5);
  const next = audio.info().music;
  assert.ok(next.track && next.track !== was, `the next piece plays (${next.track})`);
  audio.force(null);
});

test('a server restart at a track boundary: network failures, spaced tries, retried within minutes', async () => {
  audio.force('day');
  await advance(0.5);
  await advance(0.5);
  server.down = true;
  const before = plays.length;
  playing().finish();
  await advance(61);
  for (let i = 0; i < 24; i++) await advance(0.25, 280);       // 6 s with the server down
  // each try is one track in both formats (a source that never arrived may be a format the browser lacks)
  const tried = new Set(plays.slice(before));
  assert.ok(tried.size >= 1 && tried.size <= 3, `a few spaced tries, not the whole list at once (${[...tried].join(', ')})`);
  const failed = audio.info().music.failed;
  assert.ok(failed.length >= 1, 'the failed track is skipped for now');
  // the ban is the network one: two minutes later every failed track may play again
  server.down = false;
  await advance(125);
  assert.deepEqual(audio.info().music.failed, [], 'nothing banned for 10 minutes');
});
