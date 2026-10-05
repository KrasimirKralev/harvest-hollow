// public/js/net/packs.js (qa2 SV-03, the server fixer's client half; applied by the client fixer): model families and
// the Ogg sounds in one request each, with the single file as the fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packOf, fromPack, resetPacks } from '../public/js/net/packs.js';

const IX = { 'models-crops': { dir: '/assets/models/crops/', v: 'abc123', files: { 'corn.glb': [0, 3], 'wheat.glb': [3, 2] } },
  audio: { dir: '/assets/audio/', v: 'def456', files: { 'pop.ogg': [0, 4] } } };
const res = (bytes, ok = true) => ({ ok, arrayBuffer: async () => new Uint8Array(bytes).buffer });

test('packOf finds the member and its offsets; anything else is not packed', () => {
  resetPacks(IX);
  assert.deepEqual(packOf('/assets/models/crops/wheat.glb?v=x').at, [3, 2]);
  assert.equal(packOf('/assets/models/crops/oats.glb'), null, 'a file the index does not know: fetched alone');
  assert.equal(packOf('/assets/audio/pop.wav'), null, 'the WAV fallback is never packed');
  assert.equal(packOf('/assets/models/crops/constructor'), null, 'no prototype keys');
  resetPacks(null);
  assert.equal(packOf('/assets/models/crops/wheat.glb'), null, 'no index on the page (tests, tools)');
});

test('fromPack: one fetch per pack, each member sliced into its own buffer; a failed pack falls back (null)', async () => {
  resetPacks(IX);
  const urls = [];
  const fetcher = async (u) => { urls.push(u); return u.includes('models-crops') ? res([1, 1, 1, 2, 2]) : res([], false); };
  const [corn, wheat] = await Promise.all([fromPack('/assets/models/crops/corn.glb', fetcher), fromPack('/assets/models/crops/wheat.glb', fetcher)]);
  assert.deepEqual([...new Uint8Array(corn)], [1, 1, 1]);
  assert.deepEqual([...new Uint8Array(wheat)], [2, 2]);
  assert.notEqual(corn, wheat);
  assert.deepEqual(urls, ['/assets/packs/models-crops.bin?v=abc123'], 'one request for the family, versioned');
  assert.equal(await fromPack('/assets/audio/pop.ogg', fetcher), null, '404 (an older pack): the caller fetches the file');
  assert.equal(await fromPack('/assets/audio/pop.ogg', async () => { throw new Error('offline'); }), null, 'remembered: no retry storm');
  resetPacks(IX);
  assert.equal(await fromPack('/assets/models/crops/wheat.glb', async () => res([1])), null, 'a short body never yields a torn model');
});

test('fromPack lets a loaded pack go after a quiet while (members are copies); a later member fetches it again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { RELEASE_MS } = await import('../public/js/net/packs.js');
  resetPacks(IX);
  const urls = [];
  const fetcher = async (u) => { urls.push(u); return res([1, 1, 1, 2, 2]); };
  await fromPack('/assets/models/crops/corn.glb', fetcher);
  t.mock.timers.tick(RELEASE_MS - 1);
  await fromPack('/assets/models/crops/wheat.glb', fetcher);
  assert.equal(urls.length, 1, 'still held while members are being read');
  t.mock.timers.tick(RELEASE_MS + 1);
  assert.deepEqual([...new Uint8Array(await fromPack('/assets/models/crops/wheat.glb', fetcher))], [2, 2]);
  assert.equal(urls.length, 2, 'released, then fetched again (the browser cache answers)');
  resetPacks(null);
});
