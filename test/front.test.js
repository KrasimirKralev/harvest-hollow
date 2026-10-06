// The landing page (one screen since the v2 redesign), the ideas box and the GitHub star count (owner requests
// 2026-10-05), client side: the strings catalog (one place, in step with landing.html's fallback text), the form's checks
// against the server's, the POST's outcomes, the star count's source (the farm server, never api.github.com), that the
// device keeps none of it, and its silence, that nothing an idea carries is ever written as HTML, and the landing page as
// served (its first view small, the rest after the first paint). The game's side: test/ui-ideas.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import EN_FRONT from '../public/js/i18n/en/front.js';
import EN_MULTI from '../public/js/i18n/en/multi.js';
import { t as tx } from '../public/js/i18n/front.js';
import '../public/js/i18n/multi.js';
import { ago } from '../public/js/landing.js';
import { checkIdea, sendIdea, IDEA_LIMITS, CATEGORIES } from '../public/js/front/ideas.js';
import { starCount, shortCount, STARS_PATH } from '../public/js/front/stars.js';
import { checkIdea as serverCheck, IDEA_LIMITS as SERVER_LIMITS, CATEGORIES as SERVER_CATEGORIES } from '../server/ideas.js';

const html = fs.readFileSync(path.join(ROOT, 'public/landing.html'), 'utf8');
// the landing page's words: the 'front' area, its title and description the 'multi' area
const FRONT_TEXT = { ...EN_MULTI, ...EN_FRONT };
const squash = (s) => s.replace(/<[^>]+>/g, '').replace(/&rsaquo;/g, '›').replace(/\s+/g, ' ').trim();

test('front: every [data-i18n] key of landing.html is in the catalog, with the same English as its fallback text', () => {
  const keys = [...html.matchAll(/<(\w+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)];
  assert.ok(keys.length >= 18, `${keys.length} [data-i18n] elements`);
  for (const [, , key, inner] of keys) {
    assert.ok(Object.hasOwn(FRONT_TEXT, key), `missing catalog key ${key}`);
    assert.equal(squash(inner), tx(key), `landing.html fallback for ${key}`);
  }
  for (const [tag] of html.matchAll(/<[^>]*\bdata-i18n-attr="[^"]+"[^>]*>/g)) {
    const spec = /data-i18n-attr="([^"]+)"/.exec(tag)[1];
    for (const pair of spec.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      assert.ok(Object.hasOwn(FRONT_TEXT, key), `missing catalog key ${key}`);
      const v = new RegExp(`\\b${attr}="([^"]*)"`).exec(tag);
      assert.ok(v, `${attr} fallback on ${tag.slice(0, 60)}`);
      assert.equal(v[1], tx(key), `${attr} fallback for ${key}`);
    }
  }
});

test('front: tx fills params and picks plurals; an unknown key shows itself', () => {
  assert.equal(tx('front.ideas.count', { n: 12, max: 1000 }), '12 / 1,000');
  assert.equal(tx('front.star.count', { n: 1 }), '1 star');
  assert.equal(tx('front.star.count', { n: 1234 }), '1,234 stars');
  assert.equal(tx('front.box.count', { n: 2, total: 5 }), 'Picture 2 of 5');
  assert.equal(tx('front.nope'), 'front.nope');
  assert.equal(tx('front.start.rate', { n: 1 }), 'Lots of new farms were just started from this network. Try again in 1 minute.');
  assert.equal(tx('front.start.rate', { n: 12 }), 'Lots of new farms were just started from this network. Try again in 12 minutes.');
  assert.equal(tx('front.farms.forgetLabel', { name: 'Willow Creek' }), 'Forget Willow Creek on this device');
});

test('front: "last opened" reads naturally, from the catalog', () => {
  const now = 1_800_000_000_000;
  assert.equal(ago(now - 20_000, now), 'just now');
  assert.equal(ago(now - 60_000, now), '1 minute ago');
  assert.equal(ago(now - 5 * 60_000, now), '5 minutes ago');
  assert.equal(ago(now - 3_600_000, now), '1 hour ago');
  assert.equal(ago(now - 2 * 86_400_000 - 5, now), '2 days ago');
  assert.equal(ago(now + 60_000, now), 'just now', 'a clock a little ahead');
  assert.equal(ago(undefined, now).endsWith('days ago'), true, 'no time: long ago');
});

test('front: the form checks exactly what the server checks', () => {
  assert.deepEqual(IDEA_LIMITS, { textMin: SERVER_LIMITS.textMin, textMax: SERVER_LIMITS.textMax, nameMax: SERVER_LIMITS.nameMax, contactMax: SERVER_LIMITS.contactMax });
  assert.deepEqual(CATEGORIES.map(([c]) => c), [...SERVER_CATEGORIES]);
  const cases = [
    { category: 'content', text: 'A duck pond, please' },
    { category: 'content', text: 'too short' },
    { category: 'content', text: '   ten chars?   ' },
    { category: 'feature', text: '0123456789' },
    { category: 'feature', text: 'x'.repeat(1000) },
    { category: 'feature', text: 'x'.repeat(1001) },
    { category: 'nope', text: 'A duck pond, please' },
    { text: 'A duck pond, please' },
    { category: 'bug', text: 'It froze when I sold eggs', name: 'n'.repeat(40), contact: 'c'.repeat(120) },
    { category: 'bug', text: 'It froze when I sold eggs', name: 'n'.repeat(41) },
    { category: 'bug', text: 'It froze when I sold eggs', contact: 'c'.repeat(121) },
    { category: 'other', text: 'emoji 🌻🌻🌻🌻🌻' },
  ];
  for (const c of cases) {
    const body = { ...c };
    if (!body.name) delete body.name;
    if (!body.contact) delete body.contact;
    assert.equal(checkIdea(c).ok, serverCheck(body).ok, JSON.stringify(c).slice(0, 70));
  }
  assert.deepEqual(checkIdea({ category: 'content', text: 'Ducks!' }), { ok: false, field: 'text', code: 'short', n: 4 });
});

test('front: sendIdea maps every answer and never throws', async () => {
  const answer = (status, body, headers = {}) => async () => ({ ok: status < 300, status, headers: new Headers(headers), json: async () => body });
  const f = { category: 'content', text: 'A duck pond, please', name: '  Ana  ', contact: '' };
  let sent = null;
  const capture = async (url, opts) => { sent = { url, opts }; return answer(201, { ok: true, id: '0123456789abcdef' })(); };
  assert.deepEqual(await sendIdea(capture, { ...f, farm: 'abcdefghjkmn', lang: 'bg', website: '' }), { ok: true, id: '0123456789abcdef' });
  assert.equal(sent.url, '/api/ideas');
  assert.deepEqual(JSON.parse(sent.opts.body), { category: 'content', text: 'A duck pond, please', name: 'Ana', farm: 'abcdefghjkmn', lang: 'bg' });
  assert.deepEqual(await sendIdea(answer(429, { error: 'RATE', retryAfter: 120 }), f), { ok: false, code: 'RATE', retryAfter: 120 });
  assert.deepEqual(await sendIdea(answer(503, { error: 'FULL' }), f), { ok: false, code: 'FULL' });
  assert.deepEqual(await sendIdea(answer(400, { error: 'BAD_ARGS', field: 'text' }), f), { ok: false, code: 'BAD', field: 'text' });
  assert.deepEqual(await sendIdea(answer(500, null), f), { ok: false, code: 'NET' });
  assert.deepEqual(await sendIdea(async () => { throw new TypeError('offline'); }, f), { ok: false, code: 'NET' });
  // a honeypot value goes along (the server drops the idea quietly)
  await sendIdea(capture, { ...f, website: 'http://spam' });
  assert.equal(JSON.parse(sent.opts.body).website, 'http://spam');
});

test('front: the star count comes from this site\'s server, never from GitHub, and is silent when there is none', async () => {
  let calls = 0;
  const server = (body, ok = true) => async (url) => { calls++; assert.equal(url, STARS_PATH); return { ok, json: async () => body }; };
  assert.equal(STARS_PATH, '/api/stars', 'same origin: no third party sees the visitor');
  assert.equal(await starCount({ fetcher: server({ stars: 42 }) }), 42);
  assert.equal(calls, 1);
  assert.equal(await starCount({ fetcher: server({ stars: null }) }), null, 'the server has no number (GitHub refused)');
  assert.equal(await starCount({ fetcher: server({ error: 'not found' }, false) }), null, 'a single-farm server: no route');
  assert.equal(await starCount({ fetcher: server({ stargazers_count: 9 }) }), null, 'not the shape: GitHub\'s own answer is not read');
  assert.equal(await starCount({ fetcher: async () => { throw new Error('offline'); } }), null);
  assert.equal(await starCount({ fetcher: async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }) }), null);
  assert.equal(await starCount({ fetcher: server({ stars: -3 }) }), null);
  assert.equal(await starCount({ fetcher: server({ stars: '12' }) }), null);
  // the server asks GitHub at most once an hour (server/stars.js) and its answer is HTTP-cacheable: the device keeps
  // nothing of it (public/privacy.html lists what a device stores)
  const src = fs.readFileSync(path.join(ROOT, 'public/js/front/stars.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/sessionStorage|localStorage|indexedDB/.test(src), 'the star count is not stored on the device');
  assert.equal(shortCount(7), '7');
  assert.equal(shortCount(1234), '1.2k');
  assert.equal(shortCount(2000), '2k');
});

test('front: nothing an idea or the server sends is ever written as HTML in the new client code', () => {
  for (const f of ['public/js/landing.js', ...fs.readdirSync(path.join(ROOT, 'public/js/front')).map((n) => `public/js/front/${n}`)]) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|new DOMParser/.test(src), `${f} writes HTML`);
  }
});

test('front: the landing page as served: no game data, a small first view, the rest after the first paint', async () => {
  const { StaticFiles } = await import('../server/static.js');
  const s = new StaticFiles({ root: ROOT, log: { warn() {}, error() {}, info() {}, log() {} } });
  const landing = s.indexHtml('landing.html').body.toString();
  const game = s.indexHtml().body.toString();
  assert.ok(!landing.includes('id="hh-packs"'), 'no pack index on the landing page');
  assert.ok(game.includes('id="hh-packs"'), 'the game page keeps its pack index');
  assert.match(landing, /<meta name="hh-build" content="[0-9a-f]{16}">/);
  // the first view: one versioned stylesheet of its own, one font, the logo by srcset, the orb's still
  assert.match(landing, /href="\/css\/landing\.css\?v=[0-9a-f]+"/);
  assert.equal((landing.match(/<link[^>]+rel="stylesheet"/g) || []).length, 1, 'css/landing.css only: the game styles come with the sheets');
  assert.equal((landing.match(/<link[^>]+rel="preload"[^>]+as="font"/g) || []).length, 1, 'one font');
  assert.match(landing, /<img src="\/assets\/landing\/logo-wide_560\.webp\?v=[0-9a-f]+" srcset="[^"]*logo-wide_880\.webp 880w/);
  assert.match(landing, /<img class="ld-orb-still" src="\/assets\/landing\/farm-orbit\.webp\?v=[0-9a-f]+"/);
  // the video, the sheets and the screenshots never ride in the page: they come after the first paint, when asked
  assert.ok(!/<video|\.webm\b|\.mp4\b|shot-\d/.test(landing.replace(/<!--[\s\S]*?-->/g, '')), 'no video or screenshot in the first view');
  assert.ok(!/<link[^>]+(ideas|style|farm)\.css/.test(landing), 'the sheets\' styles come with the sheets');
  // the three actions, the 7-day promise, and where to go
  for (const id of ['ld-start', 'ld-star-btn', 'ld-repo', 'ld-ttl', 'ld-back-open', 'ld-ideas-open', 'ld-shots-open', 'ld-privacy', 'ld-host']) {
    assert.ok(landing.includes(`id="${id}"`), id);
  }
  assert.match(landing, /id="ld-privacy" href="\/privacy"/);
  assert.match(landing, /id="ld-host" href="https:\/\/github\.com\/[^"]+#quick-start"/);
  // no third party in the visitor's browser: GitHub is only ever a link
  for (const f of ['public/landing.html', 'public/js/landing.js', ...fs.readdirSync(path.join(ROOT, 'public/js/front')).map((n) => `public/js/front/${n}`)]) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('api.github.com'), `${f} names api.github.com`);
  }
});

test('front: the landing assets stay small (the first view and the lazy video)', () => {
  const kb = (f) => fs.statSync(path.join(ROOT, 'public/assets/landing', f)).size / 1024;
  assert.ok(kb('farm-orbit.webp') <= 40, `the orb's still: ${kb('farm-orbit.webp').toFixed(1)} KB`);
  assert.ok(kb('logo-wide_560.webp') <= 35 && kb('logo-wide_880.webp') <= 50, 'the logo');
  for (const f of ['farm-orbit.webm', 'farm-orbit.mp4']) assert.ok(kb(f) <= 1536, `${f}: ${kb(f).toFixed(0)} KB (at most 1.5 MB)`);
});
