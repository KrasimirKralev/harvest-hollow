// P takes a photo at once (there is no separate photo mode): the download starts and a toast says where it went
// (TRIAGE CL-06, ui-ux-28); the key is listed as "Take a photo".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coopHarness, eventTarget, fakeController } from './helpers/client.js';

test('P downloads the picture, toasts "Photo saved" and brings the HUD back; the key reads "Take a photo"', async () => {
  globalThis.window = eventTarget();
  const downloads = [];
  globalThis.document = { createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }), body: { append() {} } };
  const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  try {
    const h = coopHarness();
    const hud = [];
    const b = await fakeController(h.a, { view: { capture: async () => new Blob(['png']) }, ui: { hideHud: (on) => hud.push(on) } });
    globalThis.window.dispatch('keydown', { code: 'KeyP', key: 'p', target: {} });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(downloads.length, 1);
    assert.match(downloads[0], /^harvest-hollow-\d{8}-\d{4}\.png$/);
    assert.deepEqual(b.toasts.map(([text, o]) => [text, o.kind]), [['Photo saved to your downloads', 'ok']]);
    assert.deepEqual(hud, [true, false], 'the HUD hides for the capture and comes back');
    assert.equal(b.ctl.keys.list().find((k) => k.action === 'photo').label, 'Take a photo');
  } finally {
    URL.createObjectURL = urls.create;
    URL.revokeObjectURL = urls.revoke;
    delete globalThis.document;
  }
});
