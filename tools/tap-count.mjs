// Tap count (release 1.0, ui-shell; M11, critique#20; from the ux-phone audit's plays.mjs): the common actions by real
// touch (CDP touch events) on a copy of the owners' save, on the iPhone 13 and the 360 x 640 phone, counting the taps
// from the farm view and whether any needed a scroll:
//   harvest   a Hand tap on a ripe plot                                  bar 1
//   plant     a Hand tap on an empty plot, a seed in the picker          bar 2 (and the next plot: 1)
//   animal    a Hand tap on a home whose animals are ready or hungry     bar 1
//   tray      a tap on a workshop with finished goods                    bar 1
//   craft     a tap on a workshop, Make on a recipe it can make now      bar 2, Make on the first screen (no scroll)
//   sell      the Market's door, then Sell (the first stack is chosen)   bar 2
//   sellAgain the same after a visit to another Market tab (QA r3 S3-15) bar 2
//   order     the Orders door, then Deliver of the first deliverable     bar 2, Deliver on the first screen (no scroll)
// A door is what the screen offers: a visible button on top ([data-dock=…], the coins pill), else the farm menu first
// (one more tap). Camera moves (view.focus) and closing a sheet are not counted: the bar counts taps from the farm view.
// The copy gets the goods of its first order (so one order is deliverable) and nothing else. Prints one JSON line; exits
// 1 when an action is over its bar or could not be done.
//
//   node tools/tap-count.mjs --port 4471 [--root <tree>] [--devices "iPhone 13,Small 360"] [--lang en|bg]
//        [--owners <save dir>] [--out <file.json>] [--shots <dir>] [--slow N]
// Without --lang the iPhone 13 runs in English and the 360 phone in Bulgarian (the audits' pairs); the default devices
// add "iPhone 13 landscape" (English).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SCREENS, sleep, parseArgs, startServer, farmDir, slotNames, reclaim, launch, openPage, loadFarm, settle } from './hud-audit.mjs';
import { KnownDevices } from 'puppeteer-core';

// a phone on its side too (QA r1 P-11: the first Make needed a scroll in landscape); the notch is on a long side
SCREENS['iPhone 13 landscape'] ??= { ...KnownDevices['iPhone 13 landscape'], safe: { top: 0, bottom: 21, left: 47, right: 47 } };

const BAR = { harvest: 1, plant: 2, animal: 1, tray: 1, craft: 2, sell: 2, sellAgain: 2, order: 2 };
const NO_SCROLL = new Set(['craft', 'order']);

/** Give the copy the goods of its first order, so a Deliver is there to press (the copy only). */
function stockFirstOrder(dataDir) {
  const f = path.join(dataDir, 'farm.json');
  const save = JSON.parse(fs.readFileSync(f, 'utf8'));
  const slots = save.state.farm.orders?.slots ?? {};
  const first = Object.keys(slots).sort((a, b) => Number(a) - Number(b)).map((k) => slots[k]).find((s) => s && s.order && s.order.items);
  if (!first) return null;
  const inv = save.state.farm.inventory;
  for (const [item, n] of Object.entries(first.order.items)) inv[item] = (inv[item] ?? 0) + n;
  fs.writeFileSync(f, JSON.stringify(save));
  return first.order.items;
}

/** Real touches through CDP: both halves sent at once with the phone's own timing (a busy page never makes it a hold). */
export async function tapAt(page, x, y) {
  const c = page.__cdp;
  const ts = Date.now() / 1000;
  await Promise.all([
    c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1 }], timestamp: ts }),
    c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts + 0.06 }),
  ]);
}

/**
 * Find a button: the first element matching one of `sels` (with `text` when given) that is visible; then where it is.
 * `inView`: its centre is inside the screen and its scroller without scrolling, and it is what a finger there reaches.
 */
export async function locate(page, sels, { text = null, enabled = true } = {}) {
  return page.evaluate(([list, tx, en]) => {
    const shown = (e) => {
      if (e.closest('[hidden]') || !e.getClientRects().length) return false;
      const cs = getComputedStyle(e);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    for (const s of list) {
      const el = [...document.querySelectorAll(s)].find((e) => shown(e) && (!tx || new RegExp(tx, 'i').test(`${e.textContent} ${e.getAttribute('aria-label') || ''}`))
        && (!en || (!e.disabled && e.getAttribute('aria-disabled') !== 'true')));
      if (!el) continue;
      for (const x of document.querySelectorAll('[data-tc]')) x.removeAttribute('data-tc');
      el.setAttribute('data-tc', '1');
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let inView = cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight;
      for (let p = el.parentElement; p && inView; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (cy < pr.top || cy > pr.bottom || cx < pr.left || cx > pr.right) inView = false;
        }
      }
      const top = document.elementFromPoint(cx, cy);
      return { sel: s, x: Math.round(cx), y: Math.round(cy), inView: inView && Boolean(top && (top === el || el.contains(top))),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) };
    }
    return null;
  }, [sels, text, enabled]);
}

/** Tap a located button; a target that needs a scroll first is scrolled to (and the scroll is counted by the caller). */
export async function press(page, at) {
  if (!at.inView) {
    await page.evaluate(() => document.querySelector('[data-tc]')?.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await sleep(500);
    const again = await page.evaluate(() => {
      const el = document.querySelector('[data-tc]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (!again) return false;
    at = { ...at, ...again };
  }
  await tapAt(page, at.x, at.y);
  return true;
}

/** Wait until the element marked for the last tap stops moving (sheets slide in). */
export async function settled(page, sels, opts, tries = 25) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const at = await locate(page, sels, opts);
    if (at && last && Math.abs(at.x - last.x) < 1 && Math.abs(at.y - last.y) < 1) return at;
    last = at;
    await sleep(200);
  }
  return last;
}

/** A door: the button on screen when there is one, else the farm menu then the button inside it. */
export async function door(page, sels, log) {
  let at = await locate(page, sels);
  if (at && at.inView) { await press(page, at); log.push(at.label || at.sel); return 1; }
  const menu = await locate(page, ['#m-menu-btn', '[data-farmbook]']);
  if (!menu) return 0;
  await press(page, menu);
  log.push(menu.label || 'menu');
  await sleep(900);
  at = await settled(page, sels, {});
  if (!at) return -1;
  if (!at.inView) log.push('scroll');
  await press(page, at);
  log.push(at.label || at.sel);
  return at.inView ? 2 : 102;              // 100: a scroll was needed
}

/** The screen point of a farm tile where a finger lands on the canvas, with the camera on it. */
export async function tileTap(page, x, z, w = 1, slow = 1) {
  await page.evaluate(([a, b]) => window.__hh.view.focus(a, b), [x + w / 2, z + w / 2]);
  await sleep(1500 * slow);
  return page.evaluate(([a, b, ww]) => {
    const cv = document.getElementById('world').getBoundingClientRect();
    const p0 = window.__hh.view.toScreen(a + ww / 2, b + ww / 2, 0.1);
    for (let r = 0; r < 70; r += 3) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const x = p0.x + dx; const y = p0.y + dy;
        if (x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4) continue;
        if (![[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]].every(([q, s]) => document.elementFromPoint(x + q, y + s)?.id === 'world')) continue;
        const p = window.__hh.view.pick({ x: ((x - cv.left) / cv.width) * 2 - 1, y: -((y - cv.top) / cv.height) * 2 + 1 });
        const o = p && p.id ? window.__hh.state.farm.objects[p.id] : null;
        // the finger must land on the target itself: an object in front of it (the Barn over a plot at this camera
        // angle) is a miss even when the ground tile under the ray is the plot's (the 01:35 run opened the Barn)
        // (an animal picked in its home counts as its home)
        const at0 = o && !Number.isFinite(o.x) && typeof o.home === 'string' ? window.__hh.state.farm.objects[o.home] : o;
        const hit = p && (p.id ? Boolean(at0 && at0.x === a && at0.z === b) : (p.x === a && p.z === b));
        if (hit) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  }, [x, z, w]);
}

/** Facts of the farm now: ripe / empty plots, homes with something to do, workshops with goods or a makeable recipe. */
function facts() {
  return (async () => {
    const T = await import('/js/game/targets.js');
    const { CONTENT } = await import('/shared/content/index.js');
    const h = window.__hh;
    const s = h.state;
    const now = h.serverNow();
    const out = { ripe: [], empty: [], homes: [], trays: [], crafts: [], tool: h.controller.tool.id };
    for (const id of Object.keys(s.farm.objects).sort()) {
      const o = s.farm.objects[id];
      if (!Number.isFinite(o.x)) continue;
      const t = T.describe(s, id, now, h.pid);
      if (!t) continue;
      if (t.kind === 'plot' && !t.giant) { if (t.ready) out.ripe.push({ id, x: o.x, z: o.z }); else if (t.empty) out.empty.push({ id, x: o.x, z: o.z }); }
      if (t.kind === 'home' && (t.anyReady || t.anyHungry)) out.homes.push({ id, x: o.x, z: o.z, w: t.def.size?.[0] ?? 1, before: JSON.stringify(t.occupants?.map((a) => s.farm.objects[a]) ?? []) });
      if (t.kind === 'building') {
        const w = t.def.size?.[0] ?? 1;
        if (t.trayReady) out.trays.push({ id, x: o.x, z: o.z, w, q: (o.queue || []).length });
        const rs = [...CONTENT.recipes.values()].filter((r) => r.building === o.def);
        const r = rs.find((r0) => T.canRun(h.store, 'craft', { id, recipe: r0.id }) === null);
        if (r) out.crafts.push({ id, x: o.x, z: o.z, w, recipe: r.id, q: (o.queue || []).length });
      }
    }
    return out;
  })();
}

/**
 * The Hand back in hand when something else is (a player does that with one tap of the Hand, or of the phone bar's tool
 * slot): returns the taps it took (0 when the Hand already is in hand).
 */
export async function handFirst(page) {
  if (await page.evaluate(() => window.__hh.controller.tool.id === 'hand')) return 0;
  const at = await locate(page, ['.tool[data-tool="hand"]', '[data-slot="tool"]']);
  if (!at) return 0;
  await press(page, at);
  await sleep(500);
  return 1;
}

async function run(page, { slow, shots, tag, files }) {
  const A = {};
  const shot = async (name) => { if (!shots) return; const f = path.join(shots, `${tag}-${name}.png`); await page.screenshot({ path: f }); files.push(f); };
  const closeAll = async () => { await page.evaluate(() => { window.__hh.ui.panels.closeAll(); window.__hh.ui.openSeeds?.(false); }); await sleep(600 * slow); };
  const state = () => page.evaluate(() => ({ coins: window.__hh.state.farm.wallet.coins, orders: JSON.stringify(window.__hh.state.farm.orders?.slots ?? null) }));
  let F = await page.evaluate(facts);
  // harvest
  if (F.ripe.length) {
    A.harvest = { ok: false, why: 'no ripe plot clear of the HUD' };
    for (const t of F.ripe.slice(0, 6)) {
      const at = await tileTap(page, t.x, t.z, 1, slow);
      if (!at) continue;
      await tapAt(page, at.x, at.y);
      await sleep(1500 * slow);
      const ok = await page.evaluate((id) => !window.__hh.state.farm.objects[id].crop, t.id);
      A.harvest = { taps: 1, ok };
      await shot('01-harvest');
      break;
    }
  } else A.harvest = { ok: false, why: 'no ripe plot on the farm' };
  await closeAll();
  // plant: a tap on an empty plot, a seed in the picker; then the next plot
  F = await page.evaluate(facts);
  if (F.empty.length) {
    const t = F.empty[0];
    const at = await tileTap(page, t.x, t.z, 1, slow);
    if (at) {
      await tapAt(page, at.x, at.y);
      await sleep(1200 * slow);
      const seed = await settled(page, ['.seed-pop:not([hidden]) .sp-seed:not(.locked):not(.poor)'], {});
      await shot('02-picker');
      if (seed) {
        await press(page, seed);
        await sleep(1500 * slow);
        const ok = await page.evaluate((id) => Boolean(window.__hh.state.farm.objects[id].crop), t.id);
        A.plant = { taps: seed.inView ? 2 : 102, ok, scroll: !seed.inView, tool: await page.evaluate(() => window.__hh.controller.tool.id) };
        const t2 = (await page.evaluate(facts)).empty[0];
        if (t2) {
          const at2 = await tileTap(page, t2.x, t2.z, 1, slow);
          if (at2) {
            await tapAt(page, at2.x, at2.y);
            await sleep(1500 * slow);
            const ok2 = await page.evaluate((id) => Boolean(window.__hh.state.farm.objects[id].crop), t2.id);
            const picker = await page.evaluate(() => Boolean(document.querySelector('.seed-pop:not([hidden])')));
            A.plantNext = { taps: ok2 ? 1 : picker ? 2 : null, ok: ok2, picker };
          }
        }
        await shot('03-planted');
      } else A.plant = { ok: false, why: 'the seed picker did not open' };
    } else A.plant = { ok: false, why: 'no empty plot clear of the HUD' };
  } else A.plant = { ok: false, why: 'no empty plot' };
  await closeAll();
  // animal: a tap on a home with something to do
  F = await page.evaluate(facts);
  if (F.homes.length) {
    let done = false;
    for (const t of F.homes.slice(0, 4)) {
      const at = await tileTap(page, t.x, t.z, t.w, slow);
      if (!at) continue;
      const hand = await handFirst(page);
      await tapAt(page, at.x, at.y);
      await sleep(1500 * slow);
      const after = await page.evaluate((id) => {
        const T = window.__hh;
        const o = T.state.farm.objects;
        return JSON.stringify(Object.keys(o).filter((k) => o[k].home === id).map((k) => o[k]));
      }, t.id);
      const opened = await page.evaluate(() => window.__hh.ui.panels.top());
      A.animal = { taps: 1 + hand, ok: after !== t.before, opened, handFirst: Boolean(hand) };
      done = true;
      await shot('04-animal');
      break;
    }
    if (!done) A.animal = { ok: false, why: 'no home clear of the HUD' };
  } else A.animal = { ok: false, why: 'no home with ready or hungry animals' };
  await closeAll();
  // tray: a workshop with finished goods
  F = await page.evaluate(facts);
  if (F.trays.length) {
    const t = F.trays[0];
    const at = await tileTap(page, t.x, t.z, t.w, slow);
    if (at) {
      const hand = await handFirst(page);
      await tapAt(page, at.x, at.y);
      await sleep(1500 * slow);
      const q = await page.evaluate((id) => (window.__hh.state.farm.objects[id].queue || []).length, t.id);
      A.tray = { taps: 1 + hand, ok: q < t.q, handFirst: Boolean(hand) };
    } else A.tray = { ok: false, why: 'no workshop clear of the HUD' };
  } else A.tray = { ok: false, why: 'no workshop with finished goods', skip: true };
  await closeAll();
  // craft: a tap on a workshop, Make
  F = await page.evaluate(facts);
  if (F.crafts.length) {
    let done = false;
    for (const t of F.crafts.slice(0, 4)) {
      const at = await tileTap(page, t.x, t.z, t.w, slow);
      if (!at) continue;
      const hand = await handFirst(page);
      await tapAt(page, at.x, at.y);
      await sleep(1800 * slow);
      const make = await settled(page, [`#panels .hh-panel:not([hidden]) [data-craft="${t.recipe}"]`, '#panels .hh-panel:not([hidden]) [data-craft]'], {});
      await shot('05-workshop');
      if (!make) continue;
      await press(page, make);
      await sleep(1500 * slow);
      const q = await page.evaluate((id) => (window.__hh.state.farm.objects[id].queue || []).length, t.id);
      A.craft = { taps: (make.inView ? 2 : 102) + hand, ok: q > t.q, scroll: !make.inView, makeY: make.y, handFirst: Boolean(hand) };
      done = true;
      break;
    }
    if (!done) A.craft = { ok: false, why: 'no workshop with a Make on screen' };
  } else A.craft = { ok: false, why: 'nothing can be made now' };
  await closeAll();
  // sell: the Market's door, Sell
  const sellOnce = async (name) => {
    const log = [];
    const c0 = (await state()).coins;
    const n = await door(page, ['[data-dock="market"]', '#hud-coins-pill'], log);
    await sleep(1500 * slow);
    let sell = await settled(page, ['#panels .hh-panel:not([hidden]) .pn-sell-btn'], {});
    let taps = n % 100;
    let scroll = n >= 100;
    if (!sell) {
      // no stack chosen yet: the first one
      const stack = await settled(page, ['#panels .hh-panel:not([hidden]) .pn-stack'], {});
      if (stack) { await press(page, stack); taps += 1; scroll ||= !stack.inView; await sleep(800 * slow); }
      sell = await settled(page, ['#panels .hh-panel:not([hidden]) .pn-sell-btn'], {});
    }
    await shot(name === 'sell' ? '06-market' : '06b-market-again');
    if (sell) {
      await press(page, sell);
      taps += 1;
      scroll ||= !sell.inView;
      await sleep(1500 * slow);
      const c1 = (await state()).coins;
      return { taps: taps + (scroll ? 100 : 0), ok: c1 > c0, scroll, path: log.join(' > ') };
    }
    return { ok: false, why: 'no Sell button', path: log.join(' > ') };
  };
  A.sell = await sellOnce('sell');
  await closeAll();
  // sell again after a visit to another Market tab (QA r3 S3-15, oib#1: every Market door then reopened on that tab with
  // Sell scrolled off the phone's strip): the visit is not counted, the door and Sell are
  {
    await page.evaluate(() => window.__hh.ui.panels.open('market'));
    await sleep(1200 * slow);
    const visited = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#panels .hh-panel:not([hidden]) .hh-tab:not([disabled])')];
      if (tabs.length < 2) return null;
      tabs.at(-1).click();
      return tabs.at(-1).dataset.tab ?? null;
    });
    await sleep(900 * slow);
    await closeAll();
    A.sellAgain = { ...(await sellOnce('sellAgain')), visited };
  }
  await closeAll();
  // order: the Orders door, Deliver
  {
    const log = [];
    const o0 = (await state()).orders;
    const n = await door(page, ['[data-dock="orders"]'], log);
    await sleep(1500 * slow);
    const del = await settled(page, ['#panels .hh-panel:not([hidden]) [data-fill]'], {});
    await shot('07-orders');
    if (del) {
      const scroll = n >= 100 || !del.inView;
      await press(page, del);
      await sleep(1500 * slow);
      const o1 = (await state()).orders;
      A.order = { taps: (n % 100) + 1 + (scroll ? 100 : 0), ok: o1 !== o0, scroll, deliverY: del.y, path: log.join(' > ') };
      await shot('08-delivered');
    } else A.order = { ok: false, why: 'no Deliver on the Orders sheet', path: log.join(' > ') };
  }
  await closeAll();
  return A;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || 4471);
  const root = path.resolve(args.root || ROOT);
  const slow = Math.max(1, Number(args.slow || 1));
  const devices = String(args.devices || 'iPhone 13,Small 360,iPhone 13 landscape').split(',').map((d) => d.trim());
  const owners = path.resolve(args.owners || path.join(ROOT, '.scratch/box-save-1013'));
  const shots = args.shots ? path.resolve(args.shots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-tap-count-'));
  const errors = [];
  const files = [];
  const runs = [];
  let browser = null;
  let srv = null;
  try {
    browser = await launch();
    for (const device of devices) {
      if (!SCREENS[device]) throw new Error(`unknown device "${device}"`);
      const lang = args.lang === 'bg' || args.lang === 'en' ? args.lang : device === 'Small 360' ? 'bg' : 'en';
      const dataDir = farmDir(tmp, 'owners', { saveDir: owners });
      const stocked = stockFirstOrder(dataDir);
      const names = slotNames(dataDir);
      srv = startServer({ port, dataDir, root });
      let page = null;
      try {
        await srv.ready();
        const token = await reclaim(port, 'p1', names.p1 || 'Farmer');
        page = await openPage(browser, { screen: device, lang, token, slot: 'p1', errors });
        await loadFarm(page, port, { slot: 'p1', slow });
        await settle(page, slow);
        const tag = `${device.replace(/\s+/g, '').toLowerCase()}-${lang}`;
        const actions = await run(page, { slow, shots, tag, files });
        runs.push({ device, lang, stocked: Boolean(stocked), actions });
      } catch (err) {
        errors.push(`${device}: ${err.stack || err.message}`);
      } finally {
        await page?.browserContext().close().catch(() => {});
        await srv.stop();
        srv = null;
      }
    }
  } catch (err) {
    errors.push(`fatal: ${err.stack || err.message}`);
  } finally {
    await browser?.close().catch(() => {});
    await srv?.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const fails = [];
  for (const r of runs) {
    for (const [k, bar] of Object.entries(BAR)) {
      const a = r.actions[k];
      if (!a || a.skip) continue;
      if (!a.ok) { fails.push(`${r.device}: ${k} not done (${a.why || 'no change'})`); continue; }
      if (a.taps % 100 > bar) fails.push(`${r.device}: ${k} took ${a.taps % 100} taps (bar ${bar})`);
      if (a.scroll && NO_SCROLL.has(k)) fails.push(`${r.device}: ${k} needed a scroll`);
    }
  }
  const out = { ok: fails.length === 0 && errors.length === 0, root: path.relative(ROOT, root) || '.', runs, fails, errors,
    files: files.map((f) => path.relative(ROOT, f)), load: fs.readFileSync('/proc/loadavg', 'utf8').trim() };
  if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  process.exitCode = out.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
