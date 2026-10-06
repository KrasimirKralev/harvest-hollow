// What a visitor's browser loads (public/privacy.html: "no third party but the host"): every page's scripts,
// stylesheets, fonts, images and icons come from this site, no stylesheet imports or loads anything from elsewhere, and
// no client module calls another host. Links a person clicks (GitHub, the music's sources) are navigations, not loads.
// The multi e2e checks the same thing in a real browser (tools/e2e-multi.mjs: no request leaves the test host).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const PUBLIC = path.join(ROOT, 'public');
function walk(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p);
const local = (u) => u.startsWith('/') && !u.startsWith('//') || u.startsWith('data:') || u.startsWith('#') || !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u);

test('third parties: every page loads its scripts, styles, fonts, images and icons from this site only', () => {
  const pages = walk(PUBLIC, ['.html']);
  assert.ok(pages.some((p) => p.endsWith('landing.html')) && pages.some((p) => p.endsWith('index.html')), pages.map(rel).join());
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    for (const [tag, name] of html.matchAll(/<(script|link|img|source|iframe|video|audio|embed|object)\b[^>]*>/gi)) {
      for (const [, attr, url] of tag.matchAll(/\b(src|href|srcset|data-src|data-srcset|data-full|data-mid|poster)=["']([^"']*)["']/gi)) {
        for (const u of attr.toLowerCase().includes('srcset') ? url.split(',').map((x) => x.trim().split(/\s+/)[0]) : [url]) {
          assert.ok(local(u), `${rel(file)}: <${name} ${attr}="${u}"> loads from another host`);
        }
      }
    }
    assert.ok(!/@import\s+url\(\s*['"]?https?:/i.test(html), `${rel(file)}: an inline @import from another host`);
  }
});

test('third parties: no stylesheet imports or loads anything from another host (fonts are self-hosted)', () => {
  for (const file of walk(path.join(PUBLIC, 'css'), ['.css'])) {
    const css = fs.readFileSync(file, 'utf8');
    for (const [, u] of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) assert.ok(local(u), `${rel(file)}: url(${u})`);
    assert.ok(!/@import\b/i.test(css), `${rel(file)}: @import`);
  }
});

test('third parties: no client module calls another host (the star count comes from /api/stars)', () => {
  const HOSTS = /api\.github\.com|googleapis|gstatic|googletagmanager|google-analytics|doubleclick|facebook\.net|jsdelivr|unpkg|cdnjs|sentry|plausible|matomo|hotjar|cloudflareinsights/i;
  for (const file of walk(path.join(PUBLIC, 'js'), ['.js', '.mjs'])) {
    const js = fs.readFileSync(file, 'utf8');
    assert.ok(!HOSTS.test(js), `${rel(file)}: names a third-party host`);
    assert.ok(!/\bfetch\(\s*['"`](https?:)?\/\//.test(js), `${rel(file)}: fetch() of an absolute URL`);
    assert.ok(!/\bimport\(\s*['"`](https?:)?\/\//.test(js), `${rel(file)}: import() of an absolute URL`);
    assert.ok(!/\bnew\s+(WebSocket|EventSource)\(\s*['"`](wss?|https?):/.test(js), `${rel(file)}: a socket to a fixed host`);
    assert.ok(!/navigator\.sendBeacon/.test(js), `${rel(file)}: a beacon`);
  }
});

// ---- the privacy page itself (public/privacy.html at /privacy, multi mode) -------------------------------------------
const PAGE = fs.readFileSync(path.join(PUBLIC, 'privacy.html'), 'utf8');
const article = (lang) => {
  const m = new RegExp(`<article[^>]*\\bdata-lang="${lang}"[^>]*>([\\s\\S]*?)</article>`).exec(PAGE);
  assert.ok(m, `the ${lang} article`);
  return m[1];
};
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('privacy page: English and Bulgarian, each complete: every topic, the same sections, the same form', () => {
  const en = article('en');
  const bg = article('bg');
  assert.match(PAGE, /<article[^>]*\bid="en"[^>]*\blang="en"/);
  assert.match(PAGE, /<article[^>]*\bid="bg"[^>]*\blang="bg"/);
  const ids = (html, lang) => [...html.matchAll(/\bid="([a-z-]+)"/g)].map((m) => m[1]).filter((x) => x.startsWith(`${lang}-`)).map((x) => x.slice(lang.length + 1));
  assert.deepEqual(ids(bg, 'bg'), ids(en, 'en'), 'the two languages have the same sections and fields, in the same order');
  for (const id of ['title', 'short', 'who', 'what', 'long', 'ip', 'who-else', 'basis', 'rights', 'delete', 'request', 'text', 'contact']) {
    assert.ok(ids(en, 'en').includes(id), `section ${id}`);
  }
  for (const html of [en, bg]) {
    assert.equal((html.match(/<h1\b/g) || []).length, 1, 'one h1 per language');
    assert.deepEqual([...html.matchAll(/name="kind" value="(\w+)"/g)].map((m) => m[1]), ['idea', 'farm', 'copy', 'other']);
    assert.match(html, /<time datetime="2026-10-05">/);
    assert.match(html, /cpdp\.bg/);
    assert.match(html, /КЗЛД/);
    assert.match(html, /github\.com\/KrasimirKralev/);
    assert.match(html, /Railway/);
    assert.match(html, /#k=/, 'never send your key');
  }
  const e = words(en);
  for (const must of ['Rowena Kralev', 'Bulgaria', 'controller', 'hash', 'browser\'s family', 'Safari on iOS', 'only to reply',
    'no tracking cookies, no analytics and no ads', '7 days', '12 months', 'United States', 'travels to the US', 'legitimate interest',
    'consent', 'Access', 'Deletion', 'Objection', 'Commission for Personal Data Protection', 'Settings › Farm', 'Delete this farm now',
    'Keep my farm', 'every backup', 'cannot be undone', 'We are not lawyers', 'Memory Book', 'IP address', '203.0.113.0']) {
    assert.ok(e.includes(must), `EN says "${must}"`);
  }
  const b = words(bg);
  for (const must of ['Красимир Кралев', 'България', 'администраторът', 'хеш', 'Safari on iOS', 'само за да ти отговорим',
    'проследяващи бисквитки', '7 дни', '12 месеца', 'Съединените щати', 'САЩ', 'законен интерес', 'съгласие', 'Достъп', 'Изтриване',
    'Възражение', 'Комисията за защита на личните данни', 'Настройки › Ферма', 'необратимо', 'Не сме юристи', 'Книгата на спомените',
    'IP адрес', '203.0.113.0']) {
    assert.ok(b.includes(must), `BG says "${must}"`);
  }
  // the informal "ти" of the game's Bulgarian (docs/agent-briefs/i18n-glossary-bg.md), never the capitalised "Вие"
  assert.ok(!/(^|[^\p{L}])(Вие|Ваш\p{L}*|Ви)(?!\p{L})/u.test(b), 'no capitalised Вие');
  assert.ok(/(^|[^\p{L}])ти(?!\p{L})/u.test(b), 'the page says ти');
});

test('privacy page: every number it states is the code\'s own', async () => {
  const { multiConfig } = await import('../server/config.js');
  const { KEEP_MS, PRIVACY_LIMITS } = await import('../server/ideas.js');
  const { STARS_TTL_MS } = await import('../server/stars.js');
  const { LIMITS } = await import('../shared/net/protocol.js');
  const mc = multiConfig({});
  const e = words(article('en'));
  const b = words(article('bg'));
  assert.equal(mc.ttlDays, 7);
  assert.ok(e.includes(`nobody visits for ${mc.ttlDays} days`) && b.includes(`посещавал ${mc.ttlDays} дни`));
  assert.equal(KEEP_MS, 365 * 86_400_000);
  assert.ok(e.includes('12 months') && b.includes('12 месеца'));
  assert.equal(LIMITS.CHAT_KEPT, 50);
  assert.ok(e.includes('keeps the last 50') && b.includes('последните 50'));
  assert.equal(mc.createPerHour, 5);
  assert.ok(e.includes('at most 5 new farms an hour') && b.includes('най-много 5 нови ферми на час'));
  assert.equal(mc.backupDays, 3);
  assert.ok(e.includes('backups from the last three days') && b.includes('от последните три дни'));
  assert.equal(mc.idleMs, 10 * 60_000);
  assert.ok(e.includes('about ten minutes') && b.includes('около десет минути'));
  assert.equal(STARS_TTL_MS, 60 * 60_000);
  assert.ok(e.includes('at most once an hour') && b.includes('най-много веднъж на час'));
  // the form's limits are the server's
  assert.ok(PAGE.includes(`maxlength="${PRIVACY_LIMITS.textMax}"`) && PAGE.includes(`maxlength="${PRIVACY_LIMITS.contactMax}"`));
});

test('privacy page: the form checks exactly what the server checks; the language comes from ?lang= or the browser', async () => {
  const { pickLang, checkRequest, sendRequest, KINDS, LIMITS } = await import('../public/js/privacy.js');
  const { checkPrivacy, PRIVACY_KINDS, PRIVACY_LIMITS } = await import('../server/ideas.js');
  assert.deepEqual([...KINDS], [...PRIVACY_KINDS]);
  assert.deepEqual({ ...LIMITS }, { textMin: PRIVACY_LIMITS.textMin, textMax: PRIVACY_LIMITS.textMax, contactMax: PRIVACY_LIMITS.contactMax });
  const cases = [
    { kind: 'idea', text: 'Please delete my idea about ducks.' },
    { kind: 'farm', text: 'too short' },
    { kind: 'copy', text: '   ten chars?   ' },
    { kind: 'other', text: '0123456789' },
    { kind: 'other', text: 'x'.repeat(2000) },
    { kind: 'other', text: 'x'.repeat(2001) },
    { kind: 'everything', text: 'Please delete everything.' },
    { text: 'No kind given at all here.' },
    { kind: 'idea', text: 'With a contact of 120.', contact: 'c'.repeat(120) },
    { kind: 'idea', text: 'With a contact of 121.', contact: 'c'.repeat(121) },
  ];
  for (const c of cases) {
    const client = checkRequest(c);
    const server = checkPrivacy(c);
    assert.equal(client.ok, server.ok, JSON.stringify(c).slice(0, 60));
    if (!client.ok) assert.equal(client.field, server.field, JSON.stringify(c).slice(0, 60));
  }
  assert.equal(pickLang({ search: '?lang=bg', languages: ['en-US'] }), 'bg');
  assert.equal(pickLang({ search: '?lang=xx', languages: ['bg-BG', 'en'] }), 'bg');
  assert.equal(pickLang({ search: '', languages: ['de-DE', 'bg'] }), 'bg', 'the first of OUR languages in the browser\'s list');
  assert.equal(pickLang({ search: '', languages: ['en-GB', 'bg'] }), 'en');
  assert.equal(pickLang({ search: '', languages: ['fr'] }), 'en');
  assert.equal(pickLang({}), 'en');
  // the POST: same origin, outcomes told apart
  const calls = [];
  const fetcher = (status, body) => async (url, opts) => { calls.push({ url, opts }); return { ok: status < 300, status, json: async () => body }; };
  assert.deepEqual(await sendRequest(fetcher(201, { ok: true, id: '0123456789abcdef' }), { kind: 'idea', text: ' Delete my idea, please. ', contact: ' me@x ', lang: 'bg' }),
    { ok: true, id: '0123456789abcdef' });
  assert.equal(calls[0].url, '/api/privacy');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { kind: 'idea', text: 'Delete my idea, please.', contact: 'me@x', lang: 'bg' });
  assert.equal((await sendRequest(fetcher(429, { error: 'RATE' }), { kind: 'idea', text: 'x'.repeat(12) })).code, 'RATE');
  assert.equal((await sendRequest(fetcher(503, { error: 'FULL' }), { kind: 'idea', text: 'x'.repeat(12) })).code, 'FULL');
  assert.deepEqual(await sendRequest(fetcher(400, { error: 'BAD_ARGS', field: 'text' }), { kind: 'idea', text: 'x'.repeat(12) }), { ok: false, code: 'BAD', field: 'text' });
  assert.equal((await sendRequest(async () => { throw new Error('offline'); }, { kind: 'idea', text: 'x'.repeat(12) })).code, 'NET');
});

test('privacy page: served at /privacy in multi mode (versioned assets, no third party); single mode has no /privacy', async () => {
  const { loadConfig, multiConfig } = await import('../server/config.js');
  const { tmpDataDir, testServer } = await import('./helpers/server.js');
  const { startServer } = await import('../server/index.js');
  const dataDir = tmpDataDir('pvpage');
  const s = await startServer({ ...loadConfig({}), mode: 'multi', multi: multiConfig({ HH_STARS_URL: 'off' }), port: 0, host: '127.0.0.1', dataDir, quiet: true });
  try {
    for (const p of ['/privacy', '/privacy/']) {
      const r = await fetch(`http://127.0.0.1:${s.port}${p}`);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type'), /text\/html/);
      const html = await r.text();
      assert.match(html, /<title>Privacy · Harvest Hollow<\/title>/);
      assert.match(html, /src="\/js\/privacy\.js\?v=[0-9a-f]+"/, 'the script is versioned like every page\'s');
      assert.match(html, /href="\/css\/privacy\.css\?v=[0-9a-f]+"/);
      assert.equal(r.headers.get('referrer-policy'), 'same-origin');
    }
  } finally {
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  const single = await testServer();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${single.port}/privacy`)).status, 404, 'a self-hosted server links PRIVACY.md instead');
  } finally { await single.close(); }
});
