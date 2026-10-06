// Multi-farm hosted mode must leave the single farm exactly as it was (docs/agent-briefs/multi-farm.md): a page at /
// (no /f/<id>) keeps every storage key, API path and the socket URL it always used, shows no invite UI and no
// different slot-picker line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './ui-qa2-dom.js';

globalThis.location = { pathname: '/', origin: 'http://192.168.1.20:3300', protocol: 'http:', host: '192.168.1.20:3300', search: '?slot=p1', hash: '' };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
installDom();

test('single mode: keys, API paths and the socket URL are the ones the page always used', async () => {
  const { farm } = await import('../public/js/net/farm.js');
  assert.equal(farm.multi, false);
  assert.equal(farm.id, null);
  for (const k of ['hh.tokens', 'hh.slot', 'hh.unsaved', 'hh.reloadedFor', 'hh.camera', 'hh.tips.p1', 'hh.settings', 'hh.key']) assert.equal(farm.key(k), k);
  assert.equal(farm.api('/api/status'), '/api/status');
  assert.equal(farm.api('/api/dev/warp'), '/api/dev/warp');
  // exactly the old main.js expression
  const old = (loc) => `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
  for (const loc of [location, { protocol: 'https:', host: 'farm.example' }]) assert.equal(farm.wsUrl(loc), old(loc));
  const { kv } = await import('../public/js/ui/dom.js');
  kv.set('hh.tips.p1', { seen: true });
  assert.deepEqual([...store.keys()], ['hh.tips.p1']);
});

test('single mode: no invite UI, and the slot picker keeps its words', async () => {
  const { createInviteUi } = await import('../public/js/ui/invite.js');
  const registered = [];
  assert.equal(createInviteUi({ store: { on() {} }, ui: { panels: { register: (n) => registered.push(n) } } }), null);
  assert.deepEqual(registered, []);
  const { multiSub } = await import('../public/js/ui/index.js');
  // multiSub is only used with opts.multi; its lines are for the hosted farms
  assert.equal(multiSub([{ pid: 'p1', claimed: true, name: 'Rowan' }, { pid: 'p2', claimed: false }], { invited: true }),
    'Rowan invited you! Pick your name and colour to farm together.');
  assert.equal(multiSub([{ pid: 'p1', claimed: false }], { creator: true }), 'Your new farm is ready! Who is the first farmer?');
});

test('single mode: Settings > Farm links the repo\'s PRIVACY.md (this server keeps the farm itself) and offers no "Delete this farm"', async () => {
  const { createPrivacyUi } = await import('../public/js/ui/privacy.js');
  const { PRIVACY_MD_URL } = await import('../public/js/front/links.js');
  const p = createPrivacyUi({ store: { state: null }, ui: { confirm: async () => true } });
  assert.equal(p.multi, false);
  const box = document.createElement('div');
  box.append(...p.settingsRows({ close() {} }));
  const link = box.querySelector('a[data-privacy="open"]');
  assert.equal(link.getAttribute('href'), PRIVACY_MD_URL);
  assert.match(PRIVACY_MD_URL, /^https:\/\/github\.com\/KrasimirKralev\/harvest-hollow\/blob\/main\/PRIVACY\.md$/);
  assert.equal(box.querySelector('[data-farm-delete="open"]'), null);
  assert.equal(await p.deleteFlow(), false, 'nothing to delete on a self-hosted farm');
});
