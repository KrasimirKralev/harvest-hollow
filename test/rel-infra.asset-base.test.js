// Release 1.0 step 0 (release-scope §3 item 3): public/js/net/asset-base.js, the identity implementation of option 2's
// asset base. Without <meta name="hh-assets"> every URL is unchanged; with one, root paths move under it and
// assetPath() takes them back. The infra lane owns this file and the module from here on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../public/js/net/asset-base.js';

/** A fresh instance of the module (its own URL) loaded while `document` carries this meta content (or none). */
async function loadWith(content) {
  const had = Object.hasOwn(globalThis, 'document');
  const before = globalThis.document;
  globalThis.document = {
    querySelector: (sel) => (sel === 'meta[name="hh-assets"]' && content !== null
      ? { getAttribute: (name) => (name === 'content' ? content : null) }
      : null),
  };
  try {
    return await import(`${MODULE}?meta=${encodeURIComponent(String(content))}`);
  } finally {
    if (had) globalThis.document = before;
    else delete globalThis.document;
  }
}

test('no document (node, a worker): the base is empty and every URL is unchanged', async () => {
  const { ASSET_BASE, assetUrl, assetPath } = await import(MODULE);
  assert.equal(ASSET_BASE, '');
  for (const u of ['/assets/x.png', '/css/feel.css', '/js/main.js?v=0123456789ab', 'assets/x', '//cdn/x', 'data:,x']) {
    assert.equal(assetUrl(u), u);
    assert.equal(assetPath(u), u);
  }
  assert.equal(assetUrl(undefined), undefined);
  assert.equal(assetPath(null), null);
});

test('a page without the meta keeps today\'s URLs: assetUrl(\'/assets/x\') is \'/assets/x\'', async () => {
  const { ASSET_BASE, assetUrl, assetPath } = await loadWith(null);
  assert.equal(ASSET_BASE, '');
  assert.equal(assetUrl('/assets/x'), '/assets/x');
  assert.equal(assetPath('/assets/x'), '/assets/x');
});

test('with the meta, root paths move under the base and assetPath() strips it again', async () => {
  const B = 'https://host.example/b/0123456789abcdef/public';
  const { ASSET_BASE, assetUrl, assetPath } = await loadWith(` ${B}/ `);
  assert.equal(ASSET_BASE, B, 'trimmed, no trailing slash');
  assert.equal(assetUrl('/assets/x'), `${B}/assets/x`);
  assert.equal(assetUrl('/css/feel.css?v=1'), `${B}/css/feel.css?v=1`);
  for (const u of ['//cdn.example/x', 'https://other.example/x', 'data:,x', 'assets/x', '']) {
    assert.equal(assetUrl(u), u, `not a root path: ${u}`);
  }
  for (const p of ['/assets/models/crops/wheat.glb', '/css/feel.css?v=1', '/js/net/asset-base.js']) {
    assert.equal(assetPath(assetUrl(p)), p, `round trip: ${p}`);
  }
  assert.equal(assetPath('/assets/x'), '/assets/x', 'a root path is already a path');
  assert.equal(assetPath(`${B}ity/x`), `${B}ity/x`, 'the base only matches on a path boundary');
  assert.equal(assetPath('https://other.example/assets/x'), 'https://other.example/assets/x');
});

test('an empty meta is no base', async () => {
  const { ASSET_BASE, assetUrl } = await loadWith('  ');
  assert.equal(ASSET_BASE, '');
  assert.equal(assetUrl('/assets/x'), '/assets/x');
});
