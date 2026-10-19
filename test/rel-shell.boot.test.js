// Release 1.0, ui-shell: S8 the boot (feel#3, #4; astra#1; perf-a11y#16; critique#6). The painting and the logo are
// asked for before the module preloads; a 32 x 18 copy of each painting is inline, under the painting, so the first
// frame is never a flat colour; a real progress line; the slot picker's wordmark waits (lazy); the curtain stays until
// the first view is drawn, capped at 6 s (25 s while the link brings under 200 KB/s), then a 500 ms cross-fade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('public/index.html');
const css = read('public/css/shell.css');

test('S8: the painting preloads come before any script, the boot painting and the logo at high priority', () => {
  const pre = [...html.matchAll(/<link rel="preload" as="image" href="([^"]+)"([^>]*)>/g)];
  assert.deepEqual(pre.map((m) => m[1]), ['/assets/art/welcome-couple.webp', '/assets/art/welcome-couple_960.webp', '/assets/art/logo.webp']);
  for (const m of pre) assert.match(m[2], /fetchpriority="high"/, m[1]);
  const firstScript = html.indexOf('<script');
  assert.ok(firstScript > 0 && pre.every((m) => m.index < firstScript), 'before the first script (the server adds the module preloads after them)');
});

// QA r1 S-12 (jde#12, fbp#11, ap#2, ap#9): the slot picker's welcome.webp was preloaded for every page and a returning
// farmer's page logged "preloaded but not used" all session (4 warnings in 20 s at triage, 57 of 60 in a soak)
test('S-12: welcome.webp is preloaded only for a page with no farmer\'s key stored (the slot picker will show)', () => {
  assert.doesNotMatch(html, /<link rel="preload" as="image" href="\/assets\/art\/welcome\.webp"/, 'no static preload of the picker painting');
  const i = html.indexOf("'/assets/art/welcome.webp')");
  assert.ok(i > 0, 'an inline script adds it');
  const script = html.slice(html.lastIndexOf('<script>', i), html.indexOf('</script>', i));
  assert.match(script, /localStorage\.getItem\(pre \+ 'tokens'\)/, 'it reads this farm\'s stored tokens');
  assert.match(script, /if \(known\) return;/, 'a known farmer: no preload');
  assert.match(script, /link\[rel="preload"\]\[href\*="\/assets\/art\/logo\.webp"\]/, 'option 2: beside the logo preload the server moved to the host');
  assert.ok(i < html.indexOf('<link rel="stylesheet"'), 'before the stylesheets (never blocked by them)');
});

test('S8: an inline LQIP (under 1 KB each) lies under the boot and slot-picker paintings', () => {
  for (const name of ['boot', 'slot']) {
    const m = new RegExp(`--lqip-${name}:url\\((data:image/webp;base64,[A-Za-z0-9+/=]+)\\)`).exec(html);
    assert.ok(m, `--lqip-${name} is inline in index.html`);
    assert.ok(m[1].length < 1024, `--lqip-${name} is ${m[1].length} B`);
  }
  assert.match(css, /#boot\.modal-layer \{ background: url\([^)]*welcome-couple[^)]*\)[^;]*var\(--lqip-boot/, 'the boot curtain: painting over its LQIP');
  assert.match(css, /#slot-picker\.modal-layer \{ background: url\([^)]*welcome[^)]*\)[^;]*var\(--lqip-slot/, 'the slot picker: painting over its LQIP');
});

test('S8: a real progress line (resources against the module preloads) and the slot picker\'s wordmark waits', () => {
  assert.match(html, /id="boot-prog"/);
  assert.match(html, /PerformanceObserver/);
  assert.match(html, /querySelectorAll\('link\[rel="modulepreload"\]'\)\.length/);
  assert.match(html, /<img class="slot-logo"[^>]*loading="lazy">/);
});

test('S8: the curtain waits for the first view, 6 s at most, 25 s while the link is under 200 KB/s; a 500 ms fade', async () => {
  const UI = await import('../public/js/ui/index.js');
  assert.equal(UI.CURTAIN.capMs, 6000);
  assert.equal(UI.CURTAIN.fadeMs, 500);
  assert.equal(UI.curtainCap(85_000), 25_000, 'the owners\' Funnel at 85 KB/s');
  assert.equal(UI.curtainCap(199_999), 25_000);
  assert.equal(UI.curtainCap(200_000), 6000);
  // the Funnel: 300 KB in the last 2 s is 150 KB/s, 350 KB in 10 s is 35 KB/s: slow either way
  const funnel = [[100, 50_000], [8_500, 100_000], [9_000, 100_000], [9_900, 100_000]];
  assert.equal(UI.throughput(funnel, 10_000), 150_000);
  assert.equal(UI.curtainCap(UI.throughput(funnel, 10_000)), 25_000);
  // option 2's host path (infra): a 2 MB pack ended at 3 s, the next one is still streaming at 6 s; nothing ended in the
  // last 2 s, but the link has brought 333 KB/s since navigation: not a dead link, the short cap
  const host = [[400, 300_000], [3_000, 1_700_000]];
  assert.equal(UI.throughput(host, 6_000), 2_000_000 / 6);
  assert.equal(UI.curtainCap(UI.throughput(host, 6_000)), 6000);
  assert.match(css, /#boot\.lifting/, 'the cross-fade');
  assert.match(css, /body\.hud-in/, 'the HUD comes in staggered');
});

// QA r1 S-24 (va#3, ap#9): the boot line parked at "99 %" and the 6 s cap lifted the curtain onto 14-24 tan
// placeholders at 700 KB/s; at 85 KB/s the 25 s cap covered a farm whose dock answered 9.5 s earlier.
test('S-24: the curtain lifts on the cap only with no placeholder in view; a slow link lifts once the doors answer', async () => {
  const UI = await import('../public/js/ui/index.js');
  assert.equal(typeof UI.liftReason, 'function', 'ui/index.js liftReason({ el, bps, p, p0, dock })');
  const fast = 700_000;
  assert.equal(UI.liftReason({ el: 3000, bps: fast, p: 0, p0: 20 }), null, 'before 6 s the view decides (view.ready)');
  assert.equal(UI.liftReason({ el: 6100, bps: fast, p: 14, p0: 38 }), null, 'placeholders in view at 6 s: wait (HEAD: lifted)');
  assert.equal(UI.liftReason({ el: 9000, bps: fast, p: 0, p0: 38 }), 'cap', 'none left: lift');
  assert.equal(UI.liftReason({ el: 25_000, bps: fast, p: 9, p0: 38 }), 'cap', '25 s is the last word');
  assert.equal(UI.liftReason({ el: 6100, bps: 85_000, p: 30, p0: 38 }), null, 'the Funnel: most of the view still boxes');
  assert.equal(UI.liftReason({ el: 9000, bps: 85_000, p: 8, p0: 38 }), 'home', 'the Funnel: the doors answer, most of it drawn');
  assert.equal(UI.liftReason({ el: 9000, bps: 85_000, p: 8, p0: 38, dock: false }), null, 'not before the doors answer');
});

// QA r2 I2-C1 (carried S-24; infra's patch): on the owners' save 24 of 82 boxes (all buildings and trees, the farmhouse
// and the barn among them) stayed for 50 s, so the share never fired and the 25 s cap lifted onto tan blocks
test('I2-C1: on a slow link the curtain lifts once the doors answer and the farmhouse and barn in view are drawn', async () => {
  const UI = await import('../public/js/ui/index.js');
  assert.equal(UI.liftReason({ el: 9000, bps: 85_000, p: 24, p0: 82, home: 0 }), 'home', 'the home drawn, other boxes settling');
  assert.equal(UI.liftReason({ el: 9000, bps: 85_000, p: 8, p0: 82, home: 2 }), null, 'the farmhouse still tan: wait, whatever the share');
  assert.equal(UI.liftReason({ el: 9000, bps: 85_000, p: 8, p0: 38, home: null }), 'home', 'neither in view: the share decides as before');
  assert.equal(UI.liftReason({ el: 9000, bps: 85_000, p: 24, p0: 82, home: 0, dock: false }), null, 'never before the doors answer');
  assert.equal(UI.liftReason({ el: 25_000, bps: 85_000, p: 24, p0: 82, home: 2 }), 'cap', '25 s is still the last word');
  assert.equal(UI.liftReason({ el: 6100, bps: 700_000, p: 3, p0: 38, home: 0 }), null, 'a quick link: the placeholders decide');
});

test('S-24: the line\'s share after the welcome moves on (models, else a slow creep) and never reads 99 %', async () => {
  const UI = await import('../public/js/ui/index.js');
  assert.equal(UI.bootShare({ el: 0, p: 38, p0: 38 }), 0.6, 'the files before the welcome were 60 %');
  assert.ok(UI.bootShare({ el: 1000, p: 19, p0: 38 }) >= 0.8, 'half the models drawn: 80 %');
  assert.ok(UI.bootShare({ el: 2000, p: 38, p0: 38 }) > UI.bootShare({ el: 0, p: 38, p0: 38 }), 'nothing drawn yet: it still moves in 2 s');
  assert.ok(UI.bootShare({ el: 60_000, p: null, p0: null }) <= 0.96, 'never 99 %');
  // index.html maps its files on the first 52 % and creeps on toward 60 % while the welcome is on its way (QA r2 S-22)
  assert.match(html, /var k = Math\.min\(0\.6, 0\.52 \* files \+/, 'index.html maps its files below 60 %');
});

// QA r1 S-28 (ap#8): the whole boot screen was one polite live region whose percentage changed ~98 times
test('S-28: only the boot words are a live region; the percentage and the bar are not read out', () => {
  assert.doesNotMatch(html, /id="boot" aria-live/, '#boot is no live region (HEAD: aria-live="polite")');
  assert.match(html, /<span id="boot-text" role="status" aria-live="polite">/);
  assert.match(html, /id="boot-pct" aria-hidden="true"/);
});

// QA r1 S-38 (br#8): a socket upgrade that hangs reported no status: "Waking up the farm… 99 %" for 45 s
test('S-38: the "not answering" line is armed when the page starts, and the percentage goes with it', () => {
  const src = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');
  assert.match(src, /if \(typeof document !== 'undefined' && document\.getElementById\?\.\('boot'\) && !document\.getElementById\('boot'\)\.hidden\) armAsleep\(\);/);
  assert.match(src, /classList\.add\('no-pct'\)/);
  assert.match(css, /\.boot-line\.no-pct \.boot-pct/);
});
