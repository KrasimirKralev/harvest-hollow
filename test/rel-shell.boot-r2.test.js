// QA r2, ui-shell: the boot page's own scripts.
//   S2-17 (ap#7): the tools' fresh-farm URL (?slot=p1&name=…) has no stored key, so the inline guard preloaded the
//         farmer picker's painting, which never showed: "preloaded but not used" every ~30 s in every e2e run. A slot
//         and a name in the address claim at once: no picker, no preload. (The e2e gates now fail on console warnings.)
//   S2-22 (va#6): the boot line stood at "60 %" for 3.7 s while the welcome was on its way, then the curtain lifted
//         with "69 %" on it. It creeps on toward 60 % meanwhile, and runs full while the painting fades.
// The two inline scripts of public/index.html run here in a VM with a fake page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const guard = scripts.find((s) => /welcome\.webp/.test(s));
const line = scripts.find((s) => /boot-pct/.test(s));

function el(id) {
  return { id, textContent: '', style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener() {} };
}

test('S2-17: a ?slot= and name= address preloads no farmer-picker painting; a page with no key still does', () => {
  assert.ok(guard, 'the guard script');
  const run = (search, tokens = null) => {
    const added = [];
    const ctx = {
      location: { pathname: '/', search, hash: '' },
      localStorage: { getItem: (k) => (k === 'hh.tokens' ? tokens : null) },
      document: { querySelector: () => ({ getAttribute: () => '/assets/art/logo.webp' }), createElement: () => ({}), head: { appendChild: (l) => added.push(l) } },
      JSON,
      Object,
    };
    vm.runInNewContext(guard, ctx);
    return added.map((l) => l.href);
  };
  assert.deepEqual(run('?slot=p1&name=Ana&quality=low'), [], 'the tools\' URL claims at once: no preload (HEAD: welcome.webp, never used)');
  assert.deepEqual(run('', JSON.stringify({ p1: 'tok' })), [], 'a returning farmer');
  assert.deepEqual(run(''), ['/assets/art/welcome.webp'], 'a first visit still preloads the picker\'s painting');
  assert.deepEqual(run('?slot=p1'), ['/assets/art/welcome.webp'], 'a slot alone shows the picker (the name is asked)');
});

test('S2-22: while the welcome is on its way the inline line creeps on toward 60 %, never past it', () => {
  assert.ok(line, 'the boot line script');
  let now = 0;
  const timers = [];
  let observe = null;
  const pct = el('boot-pct');
  const bar = el('boot-prog');
  const text = el('boot-text');
  const win = {};
  const ctx = {
    window: win,
    navigator: { languages: ['bg'] },
    localStorage: { getItem: () => 'bg', setItem() {} },
    document: {
      documentElement: {},
      querySelectorAll: (q) => (q === 'link[rel="modulepreload"]' ? Array.from({ length: 6 }) : []),
      querySelector: () => null,
      getElementById: (id) => ({ 'boot-pct': pct, 'boot-prog': bar, 'boot-text': text })[id] ?? null,
    },
    performance: { now: () => now },
    PerformanceObserver: class { constructor(fn) { observe = fn; } observe() {} },
    setInterval: (fn, ms) => { timers.push(fn); return timers.length; },
    clearInterval() {},
    CustomEvent: class {},
    Math, String, Number,
  };
  ctx.window = Object.assign(win, { PerformanceObserver: ctx.PerformanceObserver, dispatchEvent() {} });
  vm.runInNewContext(line, ctx);
  const tick = (ms) => { now += ms; for (const fn of timers) fn(); };
  const read = () => parseFloat(pct.textContent);
  // the page's 10 files arrive (6 module preloads + 4) by 4.5 s
  for (let i = 0; i < 10; i++) { now += 450; observe({ getEntries: () => [{}] }); }
  const atFiles = read();
  assert.ok(atFiles >= 50 && atFiles <= 53, `the files are the first 52 %: ${atFiles}`);
  tick(2000);
  const later = read();
  assert.ok(later > atFiles, `it moves on while the welcome is on its way (HEAD: stood at 60 % for 3.7 s): ${atFiles} -> ${later}`);
  for (let i = 0; i < 60; i++) tick(500);
  assert.equal(read(), 60, 'and stops at 60 %: the first view\'s models are the rest');
  win.__hhBootTaken = true;
  pct.textContent = ' 72 %';
  tick(500);
  assert.equal(read(), 72, 'once the farm\'s code takes the line, the inline one is quiet');
});

test('S2-22: the farm\'s line picks up where the inline one stopped and runs full while the painting fades', () => {
  const src = fs.readFileSync(new URL('../public/js/ui/index.js', import.meta.url), 'utf8');
  assert.match(src, /let shown = Math\.max\(0, Math\.min\(0\.6, \(parseFloat\(pct\?\.textContent \?\? ''\) \|\| 0\) \/ 100\)\);/, 'never a step back');
  assert.match(src, /lineAt\(1\);\s*\n\s*b\.classList\.add\('lifting'\);/, 'full at the lift (HEAD: "69 %" on the fading painting)');
});
