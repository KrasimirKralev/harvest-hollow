// Two-client co-op E2E (tech §9.1; the wave's gate). Starts its own HH_DEV server on --port (default 3309) with a
// temp data dir holding a FIXTURE farm (level 5, coins, grain and exactly the goods of its first generated order,
// built with the real rules), opens two headless Chrome contexts (separate localStorage = separate players) and
// drives them like players: real mouse strokes and clicks where the input path matters, window.__hh where it does
// not. Steps:
//    1. A claims p1, B claims p2 (B over the LAN IP: not a secure context); each sees the other; presence
//    2. A drag-paints Wheat across four plots with the Seed Bag (one action per frame); B sees all four at once
//    3. time warp; B drag-harvests them with the Sickle; both barns rise once per plot
//    4. race: both harvest the same ripe plot at once -> exactly one harvest, both converge, one friendly toast
//    5. A places the free Coop from the build tray with a real click (ghost -> place); A buys a Chicken
//    6. B places the Feed Mill and queues Chicken Feed; warp; A collects the tray by clicking the mill (Hand)
//    7. B feeds the hen with the Feed Scoop on the Coop; warp; A collects the egg with the Hand
//    8. A fills Mabel's order; coins rise on both screens
//    9. BIG_SPEND: A buys a Bakery: the "are you sure?" card, yes; B gets the heads-up toast
//   10. A pings (G) and waves; B receives both
//   10b. Golden Hour from the UI: A places a Sunset Bench; both click it with the Hand (real clicks), each farmer
//       walks over and sits; after seatMs Golden Hour starts on both screens (CL-01: the second farmer used to "stand")
//   10c. the Barn moves (owner 2026-10-04): A picks it up with the Hammer (real clicks), the ghost follows, a click puts it
//       down; predicted at once, B sees it; B's "Move back" from her Hammer hint (a real click) puts it back
//   11. server restart mid-session while B keeps playing: both reconnect, B's offline actions land, all converge;
//       B sees A where she stands, not at the porch (A re-sends her pose on the welcome)
//   12. a forced resync converges; the audio engine runs (every sample, music); latency (input -> first frame) from
//       both clients; screenshots; no errors
//   13. M1b co-op flows (wave 2), on the same two players' farm moved to level 18 and restarted on a Wednesday noon
//       (the Fair open, the barge docked): a Fair entry by EACH player; A's next eligible deed finds a collection item
//       (the set's pity is due: a Fair entry, a Market sale or clearing debris, whichever feeds a live set) and BOTH
//       albums show who found it; a barge row loaded together (A two crates, B the third) pays the row on both
//       screens; a Restoration bundle funded together (A gives some slots, B the rest) completes on both screens.
//       Each goes through its panel's own button when the ui lanes have registered the panel (else controller.do,
//       listed as skipped with the reason). Skipped, with the reason, while the build's milestone has no M1b.
//   14. M2 co-op flows (wave 3), on the same farm moved to level 32 (the NPC league, the Breeding Barn, Friendly Duel)
//       with the farmhouse room open, a Fishing Dock and two grown cows, restarted on a Wednesday noon:
//       a Friendly Duel (A invites, B answers the invitation's own notice, both see it run, A scores);
//       breeding together (A picks the pair on the farm: two Hand clicks on the cow barn in matchmaker mode; when the
//       baby is ready B brings it home from the "ready" notice, named; both screens hold the newborn and its coat);
//       fishing together (both cast at the dock within 20 s: a Heart each; A hooks the bite with Space);
//       the interior (A walks into the farmhouse with a Hand click, places a rug with a real click on the room's floor;
//       B sees it in the state and inside the room, where both stand by the fire);
//       a league week roll (time to Sunday 20:00: the Fair ceremony carries the league result on both screens, and
//       the duel ends with the same result on both). Skipped, with the reason, while the build's milestone has no M2.
// `--only m2` runs step 1 and then step 14 alone (a quick check of the M2 co-op flows).
// Prints one JSON line { ok, steps, skipped, latencies, errors, files } and exits non-zero on any failure. A step
// whose action this build does not register is SKIPPED with the reason (listed), never silently passed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createFarm, validateState } from '../shared/rules/state.js';
import { runAction, makeCtx, ACTIONS } from '../shared/rules/index.js';
import { cropOf, defOf, xpForLevel, SAFETY, COOP, CONTENT, MILESTONE, isLive, itemOf, COLLECTION_RULES, DUEL, BREEDING, INTERIOR,
  FISHING, FAIR, featureOf, furnitureOf } from '../shared/content/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const port = Number(args.port || 3309);   // lanes pass their own port (docs/agent-briefs/common.md)
const ONLY_M2 = args.only === 'm2';       // --only m2: step 1 (the claims), then the M2 co-op flows of step 14
if (port === 3000 || port === 3300) throw new Error('ports 3000 and 3300 are reserved for the real services');
const screens = path.resolve(args.screens || path.join(ROOT, 'docs', 'screens'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-e2e-'));
const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
const TZ = 'Europe/Sofia';
const WHEAT = cropOf('wheat');
const FIXTURE_LEVEL = 5;
const FIXTURE_COINS = 8000;

const steps = [];
const skipped = [];
const latencies = {};
const errors = [];
const files = [];
let server = null;
let serverLog = '';

// ---- the fixture farm ---------------------------------------------------------------------------------------
/** A mid-game farm built with the real rules: level 5, coins, grain, the system actions due at that level run
 * (orders board ...), and the goods of the first open order added to the Barn so step 8 can fill it. */
async function writeFixture(dir) {
  const now = Date.now();
  const s = createFarm(4242, now, TZ);
  s.farm.xp = xpForLevel(FIXTURE_LEVEL);
  s.farm.wallet.coins = FIXTURE_COINS;
  for (const [item, n] of [['wheat', 40], ['corn', 12], ['carrot', 12]]) s.farm.inventory[item] = (s.farm.inventory[item] ?? 0) + n;
  let dueOf = null;
  try { ({ dueSystemActions: dueOf } = await import('../shared/rules/system.js')); } catch { dueOf = null; }
  let v = s.meta.version;
  for (let pass = 0; dueOf && pass < 8; pass++) {
    const due = dueOf(s, now);
    if (!due.length) break;
    for (const a of due) {
      const r = runAction(s, a, makeCtx(s, { now, pid: 'sys', cid: 'sys', seq: v + 1, grace: 250 }));
      if (r.ok) { v += 1; s.meta.version = v; }
    }
  }
  let order = null;
  const slots = s.farm.orders && s.farm.orders.slots ? s.farm.orders.slots : {};
  for (const k of Object.keys(slots).sort((a, b) => a - b)) {
    if (slots[k] && slots[k].order) { order = { slot: Number(k), ...slots[k].order }; break; }
  }
  if (order) for (const [item, n] of Object.entries(order.items)) s.farm.inventory[item] = (s.farm.inventory[item] ?? 0) + n;
  const problems = validateState(s, { now });
  if (problems.length) throw new Error(`fixture farm is invalid: ${problems.slice(0, 5).join('; ')}`);
  fs.writeFileSync(path.join(dir, 'farm.json'), JSON.stringify({ schema: s.schema, savedAt: now, version: s.meta.version, state: s, server: {} }));
  return { order };
}

function startServer() {
  serverLog = '';
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HH_DATA_DIR: dataDir, HH_DEV: '1', HH_TZ: TZ }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  return (async () => {
    for (let i = 0; i < 100 && !serverLog.includes('running at') && server.exitCode === null; i++) await sleep(100);
    if (!serverLog.includes('running at')) throw new Error(`server did not start: ${serverLog.slice(-1200)}`);
  })();
}

async function stopServer() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  s.kill('SIGTERM');
  await new Promise((r) => s.once('exit', r));
}

function check(name, cond, detail = '') {
  steps.push({ name, ok: Boolean(cond), ...(detail ? { detail } : {}) });
  if (!cond) throw new Error(`step failed: ${name}${detail ? ` (${detail})` : ''}`);
}
function skip(name, why) { skipped.push({ name, why }); }
const has = (...types) => types.every((t) => Boolean(ACTIONS[t]));

const st = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__hh.state)));
// Waits are upper bounds, never delays: a step passes the moment its condition holds. They are generous because two
// SwiftShader pages on a laptop with other agents' Chrome running (load > 10) took 4-6 s for what takes 50 ms alone
// (integration-qa1 "What remains" #6); --slow N (or HH_E2E_SLOW) multiplies every one of them, and the two functional
// latency gates below (presence, a stroke reaching the partner): on a loaded machine they are not measurements.
const SLOW = Math.max(1, Number(args.slow || process.env.HH_E2E_SLOW || 1));
const waitFor = (page, fn, arg, timeout = 10_000) => page.waitForFunction(fn, { timeout: timeout * SLOW, polling: 20 }, arg);
const serverStatus = async () => (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
const inv = (s, item) => (s.farm.inventory[item] ?? 0) + (s.farm.overflow?.[item] ?? 0);

/**
 * Both pages back on the restarted server, ready, nothing pending, and still so a moment later: a page may reload once
 * after a restart (a build reload: another agent's files changed while the server was down), so the wait runs twice.
 */
async function reconnected(pages, ms = 40_000) {
  for (let round = 0; round < 2; round++) {
    await Promise.all(pages.map((p) => waitFor(p, () => window.__hh?.net?.status === 'open' && window.__hh?.store?.ready
      && window.__hh?.pending === 0 && Boolean(window.__hh?.controller), null, ms)));
    if (round === 0) await sleep(1500 * SLOW);
  }
}

/** Ping until this client's estimate of the server clock has caught up with a warp. */
async function syncClock(page, target) {
  await page.evaluate(async (t) => {
    for (let i = 0; i < 80 && window.__hh.serverNow() < t; i++) {
      window.__hh.net.ping();
      await new Promise((r) => setTimeout(r, 50));
    }
  }, target);
}
/** Warp the server by `ms` (from A) and let both clocks catch up. */
async function warp(A, B, ms) {
  const target = await A.evaluate((x) => window.__hh.dev.warp(x), ms);
  await syncClock(B, target - 100);
  return target;
}
/** CSS px of a tile centre (y metres above the ground). */
const screenOf = (page, x, z, y = 0.15) => page.evaluate(([a, b, c]) => window.__hh.view.toScreen(a, b, c), [x, z, y]);
/**
 * CSS px of a point over the canvas whose pick IS tile (tx, tz) (an object on it or the bare tile): the ground is
 * not flat everywhere (world places sit on pads, the land rolls), so the projection of y = 0 can land a tile off.
 * Falls back to the projection when no such point is found.
 */
const tileAt = (page, tx, tz) => page.evaluate(([a, b]) => {
  const c = document.getElementById('world').getBoundingClientRect();
  const p0 = window.__hh.view.toScreen(a + 0.5, b + 0.5, 0.15);
  for (let r = 0; r < 60; r += 2) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      const x = p0.x + dx; const y = p0.y + dy;
      const el = document.elementFromPoint(x, y);
      if (!el || el.id !== 'world') continue;                   // a card, a bubble or the HUD takes that click
      const p = window.__hh.view.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 });
      if (p && p.x === a && p.z === b) return { x, y };
    }
  }
  return { x: p0.x, y: p0.y };
}, [tx, tz]);
/**
 * Move the mouse over tile (tx, tz) until the controller's hover IS that tile (the camera may still be easing on a
 * loaded machine: the tile's screen point is found again on every try). True when it got there.
 */
async function hoverTile(page, tx, tz, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const c = await tileAt(page, tx, tz);
    await page.mouse.move(c.x - 4, c.y - 4);
    await page.mouse.move(c.x, c.y, { steps: 2 });
    await sleep(200 * SLOW);
    const h = await page.evaluate(() => window.__hh.controller.hover);
    if (h && h.x === tx && h.z === tz) return true;
    await sleep(300 * SLOW);
  }
  return false;
}

/** Ease the camera to a tile and wait for it to settle: the tile's screen point stops moving (on a loaded machine
 * the easing takes many frames longer than the 900 ms it takes alone, and a stroke drawn meanwhile misses its plots). */
async function look(page, x, z, ms = 900) {
  await page.evaluate(([a, b]) => window.__hh.view.focus(a, b), [x, z]);
  await sleep(Math.min(ms, 400));
  // settled: the camera's eased target reached the tile (or stopped moving for a second: the pan bounds clamp it)
  let last = null;
  let still = 0;
  for (let i = 0; i < 80 * SLOW; i++) {
    const c = await page.evaluate(() => window.__hh.view.camera.get()).catch(() => null);
    if (!c || !Number.isFinite(c.tx)) { await sleep(ms); return; }
    if (Math.abs(c.tx - x) < 0.3 && Math.abs(c.tz - z) < 0.3) break;
    still = last && Math.abs(c.tx - last.tx) < 0.01 && Math.abs(c.tz - last.tz) < 0.01 ? still + 1 : 0;
    if (still >= 4) break;
    last = c;
    await sleep(250);
  }
  await sleep(150);
}
/** A free spot for def near (cx, cz), visible on screen, by the shared rules' canPlace. */
const freeSpot = (page, def, cx, cz) => page.evaluate(async ([d, x0, z0]) => {
  const g = await import('/shared/rules/grid.js');
  const s = window.__hh.state;
  for (let r = 0; r < 18; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = x0 + dx; const z = z0 + dz;
        if (g.canPlace(s, d, x, z, 0) === null) return { x, z };
      }
    }
  }
  return null;
}, [def, cx, cz]);
/** The newest object of a def by a player, or null. */
const newest = (s, def, by) => Object.entries(s.farm.objects).filter(([, o]) => o.def === def && (!by || o.by === by))
  .sort((a, b) => (b[1].placedAt ?? 0) - (a[1].placedAt ?? 0))[0]?.[0] ?? null;
/** Every toast the page has shown so far (a log: on a loaded machine a toast can expire before a check reads the DOM). */
const toasts = (page) => page.evaluate(() => window.__e2eToasts.slice());
/**
 * A real click on object `id`: close any card or panel over the field, then scan around the object's projected point
 * at height y for a screen point whose pick IS that object (a card, the HUD or a neighbour can sit on the projected
 * centre on a busy screen), and click there. Returns false when no such point is on screen.
 */
async function clickObject(page, id, y = 0.6) {
  await page.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); }).catch(() => {});
  await sleep(150);
  // the pointer must really be over the object before the click: on a loaded machine the camera can still be easing
  // between finding the point and pressing (the click then landed on the land for sale next to the farm)
  for (let tries = 0; tries < 5; tries++) {
    const at = await objectPoint(page, id, y);
    if (!at) return false;
    await page.mouse.move(at.x - 3, at.y - 3);
    await page.mouse.move(at.x, at.y, { steps: 2 });
    await sleep(200 * SLOW);
    const over = await page.evaluate((oid) => {
      const h = window.__hh.controller.hover;
      const objs = window.__hh.state.farm.objects;
      return Boolean(h && (h.id === oid || (h.id && objs[h.id]?.home === oid)));
    }, id);
    if (over || tries === 4) {
      await page.mouse.click(at.x, at.y);
      return true;
    }
    await sleep(400 * SLOW);
  }
  return false;
}
/** A screen point whose pick IS object `id` (scanned round its projected point at height y), or null. */
async function objectPoint(page, id, y) {
  return page.evaluate(([oid, h]) => {
    const c = document.getElementById('world').getBoundingClientRect();
    const objs = window.__hh.state.farm.objects;
    const o = objs[oid];
    if (!o) return null;
    // a home's animals are pickable too (render-life): a pick on one of them is a pick on the home for a click
    const ok = new Set([oid, ...Object.keys(objs).filter((k) => objs[k].home === oid)]);
    const p0 = window.__hh.view.toScreen(o.x + 0.5, o.z + 0.5, h);
    const hit = (x, yy) => {
      const el = document.elementFromPoint(x, yy);
      if (!el || el.id !== 'world') return false;              // a card, a ready bubble or the HUD takes that click
      const p = window.__hh.view.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((yy - c.top) / c.height) * 2 + 1 });
      return Boolean(p && ok.has(p.id));
    };
    for (let r = 0; r < 90; r += 3) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        if (hit(p0.x + dx, p0.y + dy)) return { x: p0.x + dx, y: p0.y + dy };
      }
    }
    return null;
  }, [id, y]);
}

// ---- 13. M1b co-op flows (wave 2) ----------------------------------------------------------------------------------
const DAY_MS = 86_400_000;
/** Ms from `t` to the next `weekday` (0 Sun .. 6 Sat) at `hour`:00 in the farm's zone (5-minute steps). */
function untilLocal(t, weekday, hour) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (let ms = 5 * 60_000; ms < 8 * DAY_MS; ms += 5 * 60_000) {
    const parts = Object.fromEntries(f.formatToParts(t + ms).map((x) => [x.type, x.value]));
    if (days[parts.weekday] === weekday && Number(parts.hour) === hour && Number(parts.minute) < 5) return ms;
  }
  return 0;
}
/** Run every due system action on `s` at `now` (the boot catch-up the server would do), as writeFixture does. */
async function runDue(s, now) {
  const { dueSystemActions } = await import('../shared/rules/system.js');
  for (let pass = 0; pass < 12; pass++) {
    const due = dueSystemActions(s, now);
    if (!due.length) return;
    for (const a of due) {
      const r = runAction(s, a, makeCtx(s, { now, pid: 'sys', cid: 'sys', seq: s.meta.version + 1, grace: 250 }));
      if (r.ok) s.meta.version += 1;
    }
  }
}
/** A check against the rules alone (node side): null when `pid` may do it on `s` at `now`. */
function dry(s, pid, now, type, args) {
  const def = ACTIONS[type];
  if (!def) return 'UNKNOWN_ACTION';
  try { return def.check(s, args, makeCtx(s, { now, pid, cid: `${pid}dry00`, seq: 1, ext: {}, grace: 0 })) || null; } catch (e) { return `INTERNAL ${e.message}`; }
}
/**
 * Press the first enabled button of the panel element matching `sel` (the real UI path), or fall back to the API.
 * @returns {Promise<'ui' | 'api' | null>} how it was done (null: neither worked)
 */
const panelWhy = {};
/** A screenshot of a flow's result: its panel when the ui has it, else the farm with every card closed. */
async function shotM1b(page, name, panel, args) {
  await page.evaluate(([n, a]) => {
    const P = window.__hh.ui.panels;
    P?.closeAll?.();
    if (P?.has?.(n)) P.open(n, a);
  }, [panel, args]).catch(() => {});
  await sleep(700);
  const f = path.join(screens, name);
  await page.screenshot({ path: f });
  files.push(f);
}
async function press(page, panel, panelArgs, sel, type, args, done) {
  const opened = await page.evaluate(([n, a]) => {
    const P = window.__hh.ui.panels;
    if (!P || !P.has?.(n)) return false;
    P.closeAll?.();
    P.open(n, a);
    return true;
  }, [panel, panelArgs]);
  if (opened) {
    await sleep(500);
    const clicked = await page.evaluate((q) => {
      const el = document.querySelector(q);
      if (!el) return false;
      el.scrollIntoView({ block: 'nearest' });
      const usable = [...el.querySelectorAll('button')].filter((x) => x.offsetParent !== null && !x.disabled && x.getAttribute('aria-disabled') !== 'true'
        && !x.dataset.flag && !/help|flag|keep/i.test(x.textContent));
      // the action button itself ("Enter", "Load", "Give"), not a help flag or a quantity chip
      const b = usable.find((x) => /enter|load|give|donate|add/i.test(x.textContent)) ?? usable[0];
      if (!b) return false;
      b.click();
      return true;
    }, sel);
    if (clicked && await waitFor(page, done.fn, done.arg, 6000).then(() => true, () => false)) return 'ui';
    panelWhy[panel] = clicked ? `the ${panel} panel's button did not ${type}` : `the ${panel} panel has no enabled button at ${sel}`;
  } else panelWhy[panel] = `the ${panel} panel is not registered yet (ui lanes)`;
  const r = await page.evaluate(([t, a]) => {
    // a crate is named by its manifest week and item too (qa2 RC-07: a stale index must never load another crate)
    const b = window.__hh.state.farm.barge;
    const c = b?.crates?.[String(a.i)];
    const args = (t === 'bargeLoad' || t === 'bargeFlag') && c && Number.isSafeInteger(b.w) ? { ...a, w: b.w, item: c.item } : a;
    return window.__hh.controller.do(t, args);
  }, [type, args]);
  if (!r.ok) return null;
  return await waitFor(page, done.fn, done.arg, 8000).then(() => 'api', () => null);
}

async function m1bFlows(A, B) {
  const liveFair = isLive(CONTENT.features.get('county_fair')) && Boolean(ACTIONS.fairEnter);
  const liveBarge = isLive(CONTENT.features.get('barge')) && Boolean(ACTIONS.bargeLoad);
  const liveRest = [...CONTENT.restoration.values()].some((p) => isLive(p)) && Boolean(ACTIONS.donate);
  if (!liveFair && !liveBarge && !liveRest) {
    for (const n of ['M1b: Fair entries by both', 'M1b: a collection find in both albums', 'M1b: a barge row loaded together',
      'M1b: a Restoration bundle funded together']) skip(n, `the build's milestone is ${MILESTONE}: no M1b system is live yet`);
    return;
  }
  // ---- the mid-game farm: level 18, a Wednesday noon, the goods each flow needs (built with the real rules) ----------
  fs.mkdirSync(screens, { recursive: true });
  const before = await serverStatus();
  await stopServer();
  const file = path.join(dataDir, 'farm.json');
  const save = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = save.state;
  const target = before.serverNow + untilLocal(before.serverNow, 3, 12);
  s.farm.xp = Math.max(s.farm.xp, xpForLevel(18));
  s.farm.wallet.coins = Math.max(s.farm.wallet.coins, 400_000);
  const give = (item, n) => { s.farm.inventory[item] = (s.farm.inventory[item] ?? 0) + n; };
  // the barge asks only for goods the farm made in the last 14 days (GDD §5.7): long crops the plots grow
  const { dayOf } = await import('../shared/rules/coop.js');
  if (s.farm.made) for (const c of ['potato', 'pumpkin', 'sunflower', 'cabbage']) if (cropOf(c) && isLive(cropOf(c))) s.farm.made[c] = dayOf(s, target);
  // a collection is due a find (its pity counter is full): the set the Fair entries feed, else Old Coins (a Market
  // sale rolls it), so the next eligible deed of A finds an item and both albums must show it
  const liveSets = [...CONTENT.collections.values()].filter((c) => isLive(c));
  const fairSet = liveSets.find((c) => c.from.includes('enter:fair')) ?? liveSets.find((c) => c.from.includes('sell'))
    ?? liveSets.find((c) => c.from.includes('clear')) ?? null;
  const findBy = fairSet ? ['enter:fair', 'sell', 'clear'].find((k) => fairSet.from.includes(k)) : null;
  if (fairSet && s.farm.album) s.farm.album.sets[fairSet.id] = { r: 0, pity: COLLECTION_RULES.pity, items: {}, done: null };
  await runDue(s, target);
  // Fair goods: two different eligible goods (T3 / T4 / duet), one per player
  const fairItems = [];
  if (liveFair && s.farm.fair?.cur) {
    for (const it of CONTENT.items.values()) {
      if (fairItems.length >= 2 || !isLive(it) || it.kind !== 'craft') continue;
      give(it.id, 6);
      if (dry(s, 'p1', target, 'fairEnter', { item: it.id, qty: 1 }) === null) fairItems.push(it.id);
      else { s.farm.inventory[it.id] -= 6; if (!s.farm.inventory[it.id]) delete s.farm.inventory[it.id]; }
    }
  }
  // barge row 0: its three crates' goods
  const row = liveBarge && s.farm.barge?.docked && s.farm.barge.rows > 0 ? [0, 1, 2].map((i) => s.farm.barge.crates[String(i)]) : null;
  if (row) for (const c of row) give(c.item, c.qty);
  // Restoration: the open project's first bundle that `need` item slots can finish
  let rest = null;
  if (liveRest) {
    const R = await import('../shared/rules/actions/restoration.js');
    const p = R.openProject(s);
    const bundle = p && p.bundles.find((b) => b.slots.filter((x) => x.item).length >= (b.need ?? b.slots.length));
    if (bundle) {
      const slots = bundle.slots.map((x, i) => [i, x]).filter(([, x]) => x.item).slice(0, bundle.need ?? bundle.slots.length);
      for (const [, x] of slots) give(x.item, x.qty);
      rest = { project: p.id, bundle: bundle.id, slots };
    }
  }
  const problems = validateState(s, { now: target });
  save.state = s;
  save.version = s.meta.version;
  save.server.clock = { ...(save.server.clock || {}), lastNow: Math.max(save.server.clock?.lastNow ?? 0, target), devOffset: target - Date.now() };
  fs.writeFileSync(file, JSON.stringify(save));
  // the journal was folded into the snapshot at the shutdown; anything left would replay over the edited state
  for (const f of fs.readdirSync(dataDir)) if (/journal/.test(f) && !/archive/.test(f)) fs.writeFileSync(path.join(dataDir, f), '');
  check('M1b: the mid-game save (level 18, Wednesday noon) is valid', problems.length === 0, problems.slice(0, 4).join('; '));
  await startServer();
  await reconnected([A, B]);
  await Promise.all([A, B].map((p) => syncClock(p, target)));
  await waitFor(A, (x) => window.__hh.state.farm.xp >= x, xpForLevel(18), 20_000).catch(() => {});
  const stNow = await st(A);
  const st2 = await serverStatus().catch(() => ({}));
  check('M1b: both screens hold the level-18 farm', stNow.farm.xp >= xpForLevel(18),
    JSON.stringify({ xpA: stNow.farm.xp, want: xpForLevel(18), v: stNow.meta.version, server: { v: st2.v, serverNow: st2.serverNow }, saved: save.version }));
  // the restart's refused reconnects are expected (as in step 11)
  for (let i = errors.length - 1; i >= 0; i--) if (/ERR_CONNECTION_REFUSED/.test(errors[i])) errors.splice(i, 1);

  // ---- a Fair entry by each player (the Fair panel's Enter buttons) ------------------------------------------------------
  if (liveFair && fairItems.length) {
    const [ia, ib] = [fairItems[0], fairItems[1] ?? fairItems[0]];
    const entered = (item, n) => ({ fn: ([i, k]) => (window.__hh.state.farm.fair?.cur?.ent?.[i] ?? 0) >= k, arg: [item, n] });
    const how = [];
    how.push(await press(A, 'fair', { item: ia }, `[data-item="${ia}"]`, 'fairEnter', { item: ia, qty: 1 }, entered(ia, 1)));
    const k = ib === ia ? 2 : 1;
    how.push(await press(B, 'fair', { item: ib }, `[data-item="${ib}"]`, 'fairEnter', { item: ib, qty: 1 }, entered(ib, k)));
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    await waitFor(A, (q) => (window.__hh.state.farm.fair?.cur?.ent?.[q[0]] ?? 0) >= q[1], [ib, k]).catch(() => {});
    const [fa, fb] = [await st(A), await st(B)];
    const by = fa.farm.fair.cur.by ?? {};
    check('M1b: a Fair entry by each player, both screens agree', how.every(Boolean) && (by.p1 ?? 0) > 0 && (by.p2 ?? 0) > 0
      && JSON.stringify(fa.farm.fair) === JSON.stringify(fb.farm.fair), `via ${how.join('/')}; points by ${JSON.stringify(by)}`);
    if (how.includes('api')) skip('M1b: Fair entries through the panel', `${panelWhy.fair}; entered through controller.do`);
    await shotM1b(A, 'e2e-m1b-fair-A.png', 'fair', { item: ia });
    // ---- the collection find: A's next eligible deed rolls the due set; both albums show who found it -------------------
    if (fairSet) {
      if (findBy === 'sell') {
        const r = await A.evaluate(() => window.__hh.controller.do('sell', { item: 'wheat', qty: 2 }));
        check('M1b: A sells at the Market (a roll of Old Coins)', r.ok, r.code ?? '');
      } else if (findBy === 'clear') {
        // A clears a weed by hand (Lost Tools: clearing debris), chopping until it is gone
        const weed = await A.evaluate(async () => {
          const { defOf } = await import('/shared/content/index.js');
          const s2 = window.__hh.state;
          return Object.keys(s2.farm.objects).sort().find((k) => defOf(s2.farm.objects[k].def)?.kind === 'debris' && defOf(s2.farm.objects[k].def)?.tool === 'hand')
            ?? Object.keys(s2.farm.objects).sort().find((k) => defOf(s2.farm.objects[k].def)?.kind === 'debris') ?? null;
        });
        let gone = false;
        for (let k = 0; weed && k < 12 && !gone; k++) {
          await A.evaluate((id) => window.__hh.controller.do('chop', { id }), weed);
          await waitFor(A, () => window.__hh.pending === 0).catch(() => {});
          gone = await A.evaluate((id) => !window.__hh.state.farm.objects[id], weed);
          if (!gone) await sleep(2100);                    // the next chop is a new swing
        }
        check('M1b: A clears debris (a roll of Lost Tools)', gone, String(weed));
      }
      await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
      await waitFor(B, (id) => Object.keys(window.__hh.state.farm.album?.sets?.[id]?.items ?? {}).length > 0, fairSet.id).catch(() => {});
      const fa2 = await st(A);
      const got = fa2.farm.album?.sets?.[fairSet.id]?.items ?? {};
      const found = Object.entries(got).find(([, v]) => v && v.by);
      check(`M1b: ${{ sell: 'a Market sale', clear: 'clearing debris', 'enter:fair': 'a Fair entry' }[findBy]} found a collection item (${fairSet.name})`,
        Boolean(found), JSON.stringify(got));
      const shown = [];
      for (const [tag, p] of [['A', A], ['B', B]]) {
        const ok = await p.evaluate(([set, item]) => {
          const P = window.__hh.ui.panels;
          if (!P?.has?.('collections')) return 'no panel';
          P.closeAll?.();
          P.open('collections', { set });
          return new Promise((res) => setTimeout(() => {
            const el = document.querySelector(`figure.pc-sticker.found[data-item="${item}"], [data-item="${item}"].found`);
            res(el ? 'shown' : 'missing');
          }, 700));
        }, [fairSet.id, found?.[0]]);
        shown.push(`${tag}:${ok}`);
        await p.screenshot({ path: path.join(screens, `e2e-m1b-album-${tag}.png`) }); files.push(path.join(screens, `e2e-m1b-album-${tag}.png`));
      }
      const fb2 = await st(B);
      check('M1b: both albums show the find', shown.every((x) => /shown|no panel/.test(x))
        && JSON.stringify(fb2.farm.album?.sets?.[fairSet.id]) === JSON.stringify(fa2.farm.album?.sets?.[fairSet.id]),
      `${shown.join(' ')}; found by ${found?.[1]?.by}`);
      if (shown.some((x) => /no panel/.test(x))) skip('M1b: the album panel', 'ui-collect has not registered `collections` yet; the state was checked instead');
    } else skip('M1b: a collection find', 'no live collection set is fed by Fair entries, Market sales or clearing debris');
  } else skip('M1b: Fair entries by both', liveFair ? 'no Fair week open or no eligible good in this build' : 'the Fair is not live');

  // ---- a barge row loaded together: A two crates, B the third -----------------------------------------------------------
  if (row) {
    const loaded = (i) => ({ fn: (k) => Boolean(window.__hh.state.farm.barge?.crates?.[k]?.by), arg: String(i) });
    const how = [];
    how.push(await press(A, 'barge', { i: 0 }, '[data-crate="0"]', 'bargeLoad', { i: 0 }, loaded(0)));
    how.push(await press(A, 'barge', { i: 1 }, '[data-crate="1"]', 'bargeLoad', { i: 1 }, loaded(1)));
    await waitFor(B, () => Boolean(window.__hh.state.farm.barge?.crates?.['1']?.by));
    how.push(await press(B, 'barge', { i: 2 }, '[data-crate="2"]', 'bargeLoad', { i: 2 }, loaded(2)));
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    await waitFor(A, () => Boolean(window.__hh.state.farm.barge?.paid?.['0']), null, 8000).catch(() => {});
    const [ba, bb] = [await st(A), await st(B)];
    const crates = [0, 1, 2].map((i) => ba.farm.barge.crates[String(i)].by);
    check('M1b: a barge row loaded together pays the row on both screens', how.every(Boolean) && Boolean(ba.farm.barge.paid?.['0'])
      && JSON.stringify(ba.farm.barge) === JSON.stringify(bb.farm.barge), `crates by ${crates.join(',')} via ${how.join('/')}`);
    if (how.includes('api')) skip('M1b: barge crates through the panel', `${panelWhy.barge}; loaded through controller.do`);
    await shotM1b(B, 'e2e-m1b-barge-B.png', 'barge', {});
  } else skip('M1b: a barge row loaded together', liveBarge ? 'the barge did not dock with a row (nothing made in 14 days fits)' : 'the barge is not live');

  // ---- a Restoration bundle funded together: A the first slots, B the rest ---------------------------------------------
  if (rest) {
    const half = Math.ceil(rest.slots.length / 2);
    const how = [];
    const gaveTo = (i, q) => ({ fn: ([pj, bd, k, n]) => (window.__hh.state.farm.restore?.[pj]?.s?.[bd]?.[k]?.n ?? 0) >= n
      || window.__hh.state.farm.restore?.[pj]?.b?.[bd] !== undefined, arg: [rest.project, rest.bundle, String(i), q] });
    for (const [k, [i, x]] of rest.slots.entries()) {
      const page = k < half ? A : B;
      if (k === half) await waitFor(B, (q) => (window.__hh.state.farm.restore?.[q[0]]?.s?.[q[1]]?.[q[2]]?.n ?? 0) > 0, [rest.project, rest.bundle, String(rest.slots[half - 1][0])]).catch(() => {});
      how.push(await press(page, 'restoration', { id: rest.project }, `[data-bundle="${rest.bundle}"] [data-slot="${i}"]`, 'donate',
        { project: rest.project, bundle: rest.bundle, slot: i, qty: x.qty }, gaveTo(i, x.qty)));
    }
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    await waitFor(B, (q) => window.__hh.state.farm.restore?.[q[0]]?.b?.[q[1]] !== undefined, [rest.project, rest.bundle], 8000).catch(() => {});
    const [ra, rb] = [await st(A), await st(B)];
    check('M1b: a Restoration bundle funded together completes on both screens', how.every(Boolean)
      && ra.farm.restore?.[rest.project]?.b?.[rest.bundle] !== undefined && JSON.stringify(ra.farm.restore) === JSON.stringify(rb.farm.restore),
    `${rest.project}/${rest.bundle}: ${rest.slots.length} slots, A ${half}, B ${rest.slots.length - half}, via ${how.join('/')}; `
      + `A ${JSON.stringify(ra.farm.restore?.[rest.project])} B ${JSON.stringify(rb.farm.restore?.[rest.project])}`);
    if (how.includes('api')) skip('M1b: Restoration gifts through the panel', `${panelWhy.restoration}; given through controller.do`);
    await shotM1b(A, 'e2e-m1b-restoration-A.png', 'restoration', { id: rest.project });
  } else skip('M1b: a Restoration bundle funded together', liveRest ? 'no open project with an item bundle' : 'Restoration is not live');
  for (const p of [A, B]) await p.evaluate(() => window.__hh.ui.panels?.closeAll?.()).catch(() => {});
}

// ---- 14. M2 co-op flows (wave 3) -------------------------------------------------------------------------------------
/** Click the first visible enabled button in `root` whose label matches `re` (the real UI path); false when none. */
const clickButton = (page, rootSel, re) => page.evaluate(([sel, src]) => {
  const rx = new RegExp(src, 'i');
  const root = sel ? document.querySelector(sel) : document;
  if (!root) return false;
  const b = [...root.querySelectorAll('button')].find((x) => x.offsetParent !== null && !x.disabled && rx.test(x.textContent.trim()));
  if (b) b.click();
  return Boolean(b);
}, [rootSel, re.source]);

/** A screen point over the room's floor (view.interior.pick answers a floor cell inside the room), or null. */
const roomFloorAt = (page, want = null) => page.evaluate((w) => {
  const vi = window.__hh.view.interior;
  if (!vi || !vi.active) return null;
  const c = document.getElementById('world').getBoundingClientRect();
  for (let r = 0; r < 260; r += 12) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      const x = c.left + c.width / 2 + dx; const y = c.top + c.height * 0.58 + dy;
      const el = document.elementFromPoint(x, y);
      if (!el || el.id !== 'world') continue;
      const p = vi.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 });
      if (p && p.kind === 'floor' && p.inside !== false && (!w || (p.x === w.x && p.z === w.z))) return { x, y, cell: [p.x, p.z] };
    }
  }
  return null;
}, want);

async function m2Flows(A, B) {
  const has2 = (t) => Boolean(ACTIONS[t]);
  const live = {
    duel: Boolean(DUEL) && isLive(DUEL) && has2('duelInvite'),
    breed: Boolean(BREEDING) && isLive(BREEDING) && isLive(featureOf('breeding')) && has2('breed'),
    fish: Boolean(FISHING) && isLive(FISHING) && has2('cast'),
    room: Boolean(INTERIOR) && isLive(INTERIOR) && has2('furnish'),
    league: Boolean(FAIR?.league) && isLive(featureOf('fair_league')) && has2('fairEnter'),
  };
  const names = { duel: 'M2: a Friendly Duel', breed: 'M2: breeding together', fish: 'M2: fishing together',
    room: 'M2: furniture in the farmhouse seen by the partner', league: 'M2: a league week roll on both screens' };
  if (!Object.values(live).some(Boolean)) {
    for (const n of Object.values(names)) skip(n, `the build's milestone is ${MILESTONE}: no M2 system is live yet`);
    return;
  }
  for (const [k, on] of Object.entries(live)) if (!on) skip(names[k], `${k} is not live in this build`);
  fs.mkdirSync(screens, { recursive: true });
  // ---- the late-game farm: level 32, a Wednesday noon, built with the real rules --------------------------------------
  const before = await serverStatus();
  await stopServer();
  const file = path.join(dataDir, 'farm.json');
  const save = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = save.state;
  const target = before.serverNow + untilLocal(before.serverNow, 3, 12);
  s.farm.xp = Math.max(s.farm.xp, xpForLevel(32));
  s.farm.wallet.coins = Math.max(s.farm.wallet.coins, 3_000_000);
  for (const e of [...CONTENT.expansions.values()].filter((x) => x.k > 0 && x.unlock <= 32 && isLive(x))) {
    if (!s.farm.expansions.includes(e.id)) s.farm.expansions.push(e.id);
  }
  const { resetGrid } = await import('../shared/rules/grid-cache.js');
  const { canPlace } = await import('../shared/rules/grid.js');
  resetGrid(s);
  const notes = [];
  let seqN = 0;
  const run = (pid, type, args, now = target - 3_600_000) => {
    const r = runAction(s, { type, args }, makeCtx(s, { now, pid, cid: `${pid}m2fix`, seq: ++seqN, grace: 250 }));
    if (!r.ok) notes.push(`${type} ${r.code}`);
    return r;
  };
  const near = (def, x0, z0) => {
    for (let r = 0; r < 30; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (canPlace(s, def, x0 + dx, z0 + dz, 0) === null) return { x: x0 + dx, z: z0 + dz };
    }
    return null;
  };
  const placeAt = (pid, def, x0, z0) => {
    const at = near(def, x0, z0);
    if (!at) { notes.push(`no spot for ${def}`); return null; }
    const r = run(pid, 'place', { def, x: at.x, z: at.z, rot: 0, confirm: ['BIG_SPEND'] });
    return r.ok ? r.tx.events.find((e) => e.e === 'placed')?.id ?? null : null;
  };
  let barnId = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'cow_barn') ?? null;
  if (live.breed) {
    if (!barnId) barnId = placeAt('p1', 'cow_barn', 30, 40);
    if (barnId) {
      run('p1', 'upgradeHome', { id: barnId, confirm: ['BIG_SPEND'] });
      const adults = Object.keys(s.farm.objects).filter((k) => s.farm.objects[k].def === 'cow').length;
      for (let i = adults; i < 2; i++) run('p1', 'buyAnimal', { def: 'cow', adult: true, confirm: ['BIG_SPEND'] }, target - 7_200_000);
    }
    s.farm.inventory.baby_bottle = (s.farm.inventory.baby_bottle ?? 0) + 6;
  }
  const dockId = live.fish ? placeAt('p2', FISHING.spots.decor, 34, 30) : null;
  if (live.room) {
    s.farm.restore[INTERIOR.needsProject] = { done: target - 7_200_000, b: {}, s: {} };
    const { openInterior } = await import('../shared/rules/actions/interior.js');
    const { Tx } = await import('../shared/rules/tx.js');
    openInterior(new Tx(s), makeCtx(s, { now: target - 7_200_000, pid: 'sys', cid: 'sys', seq: s.meta.version + 1 }));
  }
  await runDue(s, target);
  const problems = validateState(s, { now: target });
  save.state = s;
  save.version = s.meta.version;
  save.server.clock = { ...(save.server.clock || {}), lastNow: Math.max(save.server.clock?.lastNow ?? 0, target), devOffset: target - Date.now() };
  fs.writeFileSync(file, JSON.stringify(save));
  for (const f of fs.readdirSync(dataDir)) if (/journal/.test(f) && !/archive/.test(f)) fs.writeFileSync(path.join(dataDir, f), '');
  check('M2: the late-game save (level 32, Wednesday noon) is valid', problems.length === 0, [...problems.slice(0, 4), ...notes].join('; '));
  await startServer();
  await reconnected([A, B]);
  await Promise.all([A, B].map((p) => syncClock(p, target)));
  await waitFor(A, (x) => window.__hh.state.farm.xp >= x, xpForLevel(32), 20_000).catch(() => {});
  for (let i = errors.length - 1; i >= 0; i--) if (/ERR_CONNECTION_REFUSED/.test(errors[i])) errors.splice(i, 1);
  for (const p of [A, B]) await p.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); document.querySelector('.notice button:last-child')?.click(); });

  // ---- 14a. a Friendly Duel: A invites, B answers the invitation's own notice ---------------------------------------
  if (live.duel) {
    const kind = 'orders';
    let how = 'api';
    if (await A.evaluate(() => Boolean(window.__hh.ui.panels?.has?.('duel')))) {
      await A.evaluate(() => window.__hh.ui.panels.open('duel', {}));
      await sleep(600);
      if (await clickButton(A, '.hh-panel', /invite|challenge/)) how = 'ui';
    }
    if (how === 'api') {
      const r = await A.evaluate((k) => window.__hh.controller.do('duelInvite', { kind: k }), kind);
      check('M2: A invites to a duel', r.ok, r.code ?? '');
    }
    await waitFor(A, () => window.__hh.state.farm.duel?.cur && !window.__hh.state.farm.duel.cur.ok, null, 8000);
    // B: the notice says who challenges her; its button answers (or opens the duel panel, whose Accept answers)
    const notice = await waitFor(B, () => [...document.querySelectorAll('.notice')].some((n) => /challenges you/i.test(n.textContent)), null, 12_000)
      .then(() => true, () => false);
    check('M2: B gets the duel invitation as a notice', notice, JSON.stringify(await toasts(B)));
    await clickButton(B, '.notice', /duel|see/);
    await sleep(500);
    if (!(await B.evaluate(() => window.__hh.state.farm.duel?.cur?.ok))) {
      if (!(await clickButton(B, '.hh-panel', /accept|game on|yes/))) await B.evaluate(() => window.__hh.controller.do('duelAccept', {}));
    }
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.state.farm.duel?.cur?.ok === true, null, 10_000)));
    const [da, db] = [await st(A), await st(B)];
    check('M2: the duel runs on both screens', JSON.stringify(da.farm.duel) === JSON.stringify(db.farm.duel), `${how}; ${JSON.stringify(da.farm.duel?.cur)}`);
    // A scores: an order filled (the Order Rush counts the filler's orders)
    const slots = da.farm.orders?.slots ?? {};
    const k = Object.keys(slots).find((x) => slots[x]?.order);
    if (k) {
      // only when the Barn holds the order's goods (the save's own; nothing is conjured on the client)
      const o = slots[k].order;
      const missing = Object.entries(o.items).filter(([i, n]) => (da.farm.inventory[i] ?? 0) < n);
      if (!missing.length) await A.evaluate(([slot, n]) => window.__hh.controller.do('orderFill', { slot, n }), [Number(k), o.n]);
    }
    await shotM1b(B, 'e2e-m2-duel-B.png', 'duel', {});
  }

  // ---- 14b. breeding together: A picks the pair on the farm, B brings the baby home --------------------------------
  if (live.breed && barnId) {
    await A.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); window.__hh.controller.setTool('hand'); });
    const barn = (await st(A)).farm.objects[barnId];
    await look(A, barn.x + 2, barn.z + 1.5);
    await A.evaluate(() => window.__hh.controller.pairing.start());
    const c1 = await clickObject(A, barnId, 0.6);
    await sleep(300);
    const first = await A.evaluate(() => window.__hh.controller.pairing.first);
    const c2 = await clickObject(A, barnId, 0.6);
    const started = await waitFor(A, () => Boolean(window.__hh.state.farm.breed?.cur), null, 8000).then(() => true, () => false);
    check('M2: A paired two cows on the farm (two Hand clicks on the barn in matchmaker mode)', c1 && c2 && first && started,
      JSON.stringify({ c1, c2, first, toasts: (await toasts(A)).slice(-3) }));
    if (!started) await A.evaluate(() => window.__hh.controller.pairing.cancel());
    await waitFor(B, () => Boolean(window.__hh.state.farm.breed?.cur), null, 8000).catch(() => {});
    const cur = (await st(B)).farm.breed?.cur;
    if (cur) {
      await warp(A, B, cur.readyAt - (await A.evaluate(() => window.__hh.serverNow())) + 1500);
      // the "ready" notice (game/m2-moments.js, on its 4-second check) and its button
      const ready = await waitFor(B, () => [...document.querySelectorAll('.notice')].some((n) => /baby .* is ready/i.test(n.textContent)), null, 15_000)
        .then(() => true, () => false);
      check('M2: B is told the baby is ready', ready);
      await clickButton(B, '.notice', /bring it home/);
      await sleep(600);
      if (await B.evaluate(() => Boolean(window.__hh.state.farm.breed?.cur))) {
        // the breeding panel opened: name it and bring it home there; else straight through the rules
        await B.evaluate(() => { const i = document.querySelector('.hh-panel input[type="text"]'); if (i) { i.value = 'Clover'; i.dispatchEvent(new Event('input', { bubbles: true })); } });
        if (!(await clickButton(B, '.hh-panel', /bring|home|collect|welcome/))) await B.evaluate(() => window.__hh.controller.do('breedCollect', { name: 'Clover' }));
      }
      await Promise.all([A, B].map((p) => waitFor(p, () => !window.__hh.state.farm.breed?.cur, null, 10_000)));
      const [ba, bb] = [await st(A), await st(B)];
      const baby = Object.entries(ba.farm.objects).find(([, o]) => o.def === 'cow' && o.coat && o.placedAt >= cur.readyAt - 5000);
      check('M2: the newborn and its coat are on both screens', Boolean(baby) && JSON.stringify(bb.farm.objects[baby[0]]) === JSON.stringify(baby[1]),
        baby ? `${baby[0]} ${baby[1].coat} by ${baby[1].by}` : 'no newborn');
      await shotM1b(B, 'e2e-m2-breeding-B.png', 'breeding', {});
    } else check('M2: the breeding reached B', false);
  }

  // ---- 14c. fishing together: both cast at the dock within 20 s --------------------------------------------------------
  if (live.fish && dockId) {
    const dock = (await st(A)).farm.objects[dockId];
    for (const p of [A, B]) { await p.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); window.__hh.controller.setTool('hand'); }); await look(p, dock.x + 1, dock.z + 1); }
    const hearts0 = (await st(A)).players.p1.hearts;
    // both farmers stroll down to the dock first (a hop next to it), so the two casts go in within the 20-second
    // together window even on a loaded machine; then each sits down and casts
    for (const [p, dz] of [[A, 2.6], [B, 3.2]]) {
      await p.evaluate(([x, z]) => { window.__hh.avatar.place(x, z); window.__hh.avatar.flush?.(); }, [dock.x + 0.8, dock.z + dz]);
    }
    await sleep(1500);
    await Promise.all([A, B].map((p) => p.evaluate((id) => window.__hh.controller.fishing.start(id), dockId)));
    await Promise.all([A, B].map((p) => waitFor(p, () => ['cast', 'wait', 'bite'].includes(window.__hh.controller.fishing.phase), null, 30_000)));
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    // both lines confirmed on A's screen (a cast the server first refused TOO_FAR, its relayed pose a step behind the
    // walk, is tried again 1.5 s later by the client)
    await waitFor(A, () => Boolean(window.__hh.state.players.p1.fish?.cast && window.__hh.state.players.p2.fish?.cast), null, 15_000).catch(() => {});
    const fa = await st(A);
    check('M2: both cast at the dock together (a Heart each, once a day)', fa.players.p1.fish?.cast && fa.players.p2.fish?.cast
      && fa.players.p1.hearts > hearts0, JSON.stringify({ p1: fa.players.p1.fish, p2: fa.players.p2.fish, hearts: [hearts0, fa.players.p1.hearts] }));
    // A waits for the bite on the rules' clock and hooks it with Space
    const bite = fa.players.p1.fish.cast.bite;
    await warp(A, B, Math.max(0, bite - (await A.evaluate(() => window.__hh.serverNow())) + 120));
    const biting = await waitFor(A, () => window.__hh.controller.fishing.phase === 'bite', null, 6000).then(() => true, () => false);
    await A.keyboard.press('Space');
    await waitFor(B, () => (window.__hh.state.farm.fishing?.n ?? 0) >= 1, null, 10_000).catch(() => {});
    const fb = await st(B);
    check('M2: A hooked the bite; the catch is on B\'s screen', (fb.farm.fishing?.n ?? 0) >= 1, `${biting ? 'bite seen' : 'bite missed (late reel)'}; ${JSON.stringify(fb.farm.fishing?.records)}`);
    await shotM1b(B, 'e2e-m2-fishing-B.png', 'fishing', {});
    for (const p of [A, B]) await p.evaluate(() => window.__hh.controller.fishing.stop());
  }

  // ---- 14d. the farmhouse room: A places a rug with a real click inside, B sees it ------------------------------------
  if (live.room) {
    const fhId = await A.evaluate(() => Object.keys(window.__hh.state.farm.objects).find((k) => window.__hh.state.farm.objects[k].def === 'farmhouse'));
    const fh = (await st(A)).farm.objects[fhId];
    await A.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); window.__hh.controller.setTool('hand'); });
    await look(A, fh.x + 2, fh.z + 2);
    const clicked = await clickObject(A, fhId, 1.2);
    const inside = await waitFor(A, () => window.__hh.controller.interior.inside, null, 20_000).then(() => true, () => false);
    check('M2: a Hand click on the farmhouse takes A inside', clicked && inside, JSON.stringify(await A.evaluate(() => ({ mode: window.__hh.controller.mode, vi: Boolean(window.__hh.view.interior?.active) }))));
    await sleep(1200);
    const rug = 'rag_rug';
    await A.evaluate((d) => window.__hh.controller.interior.place(d), rug);
    const at = await roomFloorAt(A);
    let how = 'api';
    if (at) {
      await A.mouse.move(at.x - 4, at.y);
      await A.mouse.move(at.x, at.y, { steps: 2 });
      await sleep(200);
      await A.mouse.click(at.x, at.y);
      how = 'click';
    }
    let placed = await waitFor(B, (d) => Object.values(window.__hh.state.farm.interior?.items ?? {}).some((it) => it.def === d), rug, 8000).then(() => true, () => false);
    if (!placed) {
      // a click that landed on a taken cell: the rules' own check says why; place it through the API so the partner check still runs
      const r = await A.evaluate((d) => window.__hh.controller.do('furnish', { def: d, x: 7, z: 5, rot: 0 }), rug);
      how = `api (${r.code ?? 'ok'})`;
      placed = await waitFor(B, (d) => Object.values(window.__hh.state.farm.interior?.items ?? {}).some((it) => it.def === d), rug, 8000).then(() => true, () => false);
    }
    check('M2: A placed a rug inside; it is on B\'s screen', placed, `${how}${at ? ` at cell ${at.cell}` : ''}`);
    await shotM1b(A, 'e2e-m2-room-A.png', 'none', {});
    const bIn = await B.evaluate((id) => { window.__hh.ui.panels?.closeAll?.(); window.__hh.controller.setTool('hand'); return id; }, fhId);
    await look(B, fh.x + 2, fh.z + 2);
    await clickObject(B, bIn, 1.2);
    await waitFor(B, () => window.__hh.controller.interior.inside, null, 20_000).catch(() => {});
    await sleep(1500);
    await shotM1b(B, 'e2e-m2-room-B.png', 'none', {});
    for (const p of [A, B]) await p.evaluate(() => window.__hh.controller.interior.leave());
  }

  // ---- 14e. a league week roll (and the duel's close): Sunday 20:00 on both screens -----------------------------------
  if (live.league || live.duel) {
    const now0 = await A.evaluate(() => window.__hh.serverNow());
    await warp(A, B, untilLocal(now0, 0, 20) + 90_000);
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    if (live.league) {
      await waitFor(B, () => Boolean(window.__hh.state.farm.fair?.last?.lg), null, 15_000).catch(() => {});
      const [la, lb] = [await st(A), await st(B)];
      check('M2: the league week rolled on both screens', Boolean(la.farm.fair?.last?.lg) && JSON.stringify(la.farm.fair.last) === JSON.stringify(lb.farm.fair.last),
        JSON.stringify(la.farm.fair?.last?.lg ?? la.farm.fair?.last ?? null));
      await shotM1b(A, 'e2e-m2-league-A.png', 'league', {});
    }
    if (live.duel) {
      await waitFor(B, () => Boolean(window.__hh.state.farm.duel?.last), null, 15_000).catch(() => {});
      const [ea, eb] = [await st(A), await st(B)];
      check('M2: the duel ended with the same result on both screens', Boolean(ea.farm.duel?.last) && JSON.stringify(ea.farm.duel) === JSON.stringify(eb.farm.duel),
        JSON.stringify(ea.farm.duel?.last));
    }
  }
  for (const p of [A, B]) await p.evaluate(() => window.__hh.ui.panels?.closeAll?.()).catch(() => {});
}

let browser;
const failPages = [];
try {
  const { order } = await writeFixture(dataDir);
  await startServer();
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/google/chrome/chrome', headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const open = async (tag, host, slot, name) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    // every toast the page shows, from its first paint, and again after a reload (a build reload: another lane's files
    // changed while the server was down for a restart step; the restarted server then runs other files)
    await page.evaluateOnNewDocument(() => {
      window.__e2eToasts = [];
      const hook = () => {
        const root = document.getElementById('toasts');
        if (!root) { setTimeout(hook, 200); return; }
        new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) window.__e2eToasts.push(n.textContent); })
          .observe(root, { childList: true });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
    });
    // low tier: two WebGL pages share one CPU under SwiftShader (headless has no GPU); the rules do not care
    await page.goto(`http://${host}:${port}/?slot=${slot}&name=${name}&quality=low`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => window.__hh && window.__hh.pid && window.__hh.state && window.__hh.controller, null, 40000);
    return page;
  };

  // 1. claim both slots; B over the LAN address (the partner's real path: not a secure context) ---------------
  const A = await open('A', 'localhost', 'p1', 'Rowan');
  const B = await open('B', lanIp || 'localhost', 'p2', 'Mia');
  failPages.push(['A', A], ['B', B]);
  check('A is p1, B is p2', (await A.evaluate(() => window.__hh.pid)) === 'p1' && (await B.evaluate(() => window.__hh.pid)) === 'p2');
  check('B page is not a secure context when on the LAN IP', !lanIp || (await B.evaluate(() => window.isSecureContext)) === false,
    lanIp ? `LAN ${lanIp}` : 'no LAN interface; localhost only');
  await waitFor(A, () => [...document.querySelectorAll('[data-pid="p2"]')].some((el) => el.classList.contains('online') || el.dataset.online === 'true')
    || window.__hh.view.partner.pose('p2') !== null, null, 15_000).catch(() => {});
  // let both pages finish their first asset loads before timing anything
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.view.stats().fps > 0, null, 20000).catch(() => {})));
  await sleep(1500);
  const t0 = Date.now();
  await A.evaluate(() => { window.__hh.avatar.place(21.5, 31.5); window.__hh.avatar.setCursor({ x: 26.2, z: 31.4 }); });
  await waitFor(B, () => {
    const p = window.__hh.view.partner.pose('p1');
    return p && Math.abs(p.x - 21.5) < 0.1 && Math.abs(p.z - 31.5) < 0.1;
  }, null, 15_000);
  latencies.presenceMs = Date.now() - t0;
  // A functional gate: under SwiftShader two WebGL pages share the CPU, so this number is not a measurement
  // (tech §9.1); the 15 Hz relay + 120 ms interpolation make it ~150-250 ms on real GPUs.
  check("B sees A's avatar move (presence)", latencies.presenceMs < 5000 * SLOW, `${latencies.presenceMs} ms`);

  // --only m2: straight from the claims to the M2 co-op flows (step 14), then the error check (a quick run for the M2
  // systems; the full run does every step)
  if (ONLY_M2) {
    await m2Flows(A, B);
    check('no console or page errors', errors.length === 0, errors.join(' | '));
    console.log(JSON.stringify({ ok: true, only: 'm2', steps: steps.length, done: steps.map((x) => x.name), skipped, latencies, errors, files }));
  } else {

  // 2. A drag-paints wheat with the Seed Bag across four plots (a real mouse stroke) ---------------------------
  const s0 = await st(A);
  const plots = Object.keys(s0.farm.objects).filter((id) => s0.farm.objects[id].def === 'plot' && !s0.farm.objects[id].crop)
    .sort((a, b) => (s0.farm.objects[a].z - s0.farm.objects[b].z) || (s0.farm.objects[a].x - s0.farm.objects[b].x));
  const row = plots.filter((id) => s0.farm.objects[id].z === s0.farm.objects[plots[0]].z).slice(0, 4);
  check('the fixture has a row of four empty plots', row.length === 4, String(row.length));
  const P = (id) => s0.farm.objects[id];
  await look(A, P(row[1]).x + 1, P(row[1]).z + 0.5);
  await A.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  const coins0 = s0.farm.wallet.coins;
  const seq0 = await A.evaluate(() => window.__hh.store.seq);
  const pts = [];
  for (const id of row) pts.push(await tileAt(A, P(id).x, P(id).z));
  await A.mouse.move(pts[0].x, pts[0].y);
  await A.mouse.down();
  for (let i = 1; i < pts.length; i++) await A.mouse.move(pts[i].x, pts[i].y, { steps: 4 });
  const predicted = await A.evaluate((ids) => ids.filter((id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat').length, row);
  await A.mouse.up();
  check('the stroke planted all four plots on A at once (predicted)', predicted === 4, `${predicted}/4`);
  const sent = (await A.evaluate(() => window.__hh.store.seq)) - seq0;
  check('the stroke went out as at most one action per frame', sent >= 1 && sent <= 4, `${sent} action(s)`);
  const tPlant = Date.now();
  await waitFor(B, (ids) => ids.every((id) => window.__hh.state.farm.objects[id].crop?.def === 'wheat'), row);
  latencies.strokeToPartnerMs = Date.now() - tPlant;
  check('B sees the whole stroke', latencies.strokeToPartnerMs < 1500 * SLOW, `${latencies.strokeToPartnerMs} ms`);
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
  const [sA, sB] = [await st(A), await st(B)];
  check('coins dropped by four seeds on both screens', sA.farm.wallet.coins === coins0 - 4 * WHEAT.seed && sB.farm.wallet.coins === coins0 - 4 * WHEAT.seed,
    `${sA.farm.wallet.coins}/${sB.farm.wallet.coins} from ${coins0}`);

  // 3. warp; B drag-harvests the row with the Sickle --------------------------------------------------------------
  const readyAt = Math.max(...row.map((id) => sB.farm.objects[id].crop.readyAt));
  const nowA = await A.evaluate(() => window.__hh.serverNow());
  await warp(A, B, readyAt - nowA + 400);
  await look(B, P(row[1]).x + 1, P(row[1]).z + 0.5);
  await B.evaluate(() => window.__hh.controller.setTool('sickle'));
  const wheat0 = inv(sB, 'wheat');
  const bpts = [];
  for (const id of row) bpts.push(await tileAt(B, P(id).x, P(id).z));
  await B.mouse.move(bpts[3].x, bpts[3].y);
  await B.mouse.down();
  for (let i = 2; i >= 0; i--) await B.mouse.move(bpts[i].x, bpts[i].y, { steps: 4 });
  await B.mouse.up();
  await waitFor(A, (ids) => ids.every((id) => window.__hh.state.farm.objects[id].crop === null), row);
  const h3 = await st(A);
  check('B harvested the row with one stroke; A sees it', inv(h3, 'wheat') >= wheat0 + 4 * WHEAT.yield, `${inv(h3, 'wheat')} vs ${wheat0} + ${4 * WHEAT.yield}`);
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
  // GDD §6.2 #5 teamwork harvest: the planter gets floor(40 %) of the stroke's XP, the harvester the rest (the
  // stroke's XP is the rules' own number: crop XP accrues in fractions since RC-13, so it is read, not computed)
  const gain = h3.farm.xp - sB.farm.xp;
  const toPlanter = Math.floor((gain * COOP.teamworkHarvest.planterBp) / 10_000);
  const [gA, gB] = [h3.players.p1.xp - sA.players.p1.xp, h3.players.p2.xp - sB.players.p2.xp];
  check("teamwork harvest: personal XP split between B (harvester) and A (planter)",
    gain > 0 && gA === toPlanter && gB === gain - toPlanter,
    `farm +${gain}: A +${gA} (want ${toPlanter}), B +${gB} (want ${gain - toPlanter})`);

  // 4. race: both harvest the same ripe plot in the same instant -----------------------------------------------------
  await sleep(3300);                       // outside the Together Combo window: the race must show its toast
  const racePlot = plots[4];
  await A.evaluate((id) => window.__hh.act('plant', { id, crop: 'wheat' }), racePlot);
  await waitFor(B, (id) => window.__hh.state.farm.objects[id].crop !== null, racePlot);
  const r2 = (await st(B)).farm.objects[racePlot].crop.readyAt;
  await warp(A, B, r2 - (await A.evaluate(() => window.__hh.serverNow())) + 400);
  await syncClock(A, r2 + 100);
  const before4 = inv(await st(A), 'wheat');
  const [ra, rb] = await Promise.all([
    A.evaluate((id) => window.__hh.act('harvest', { id }).ok, racePlot),
    B.evaluate((id) => window.__hh.act('harvest', { id }).ok, racePlot),
  ]);
  check('both predicted the harvest', ra && rb);
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
  await sleep(800);                        // lost-race toasts are coalesced per 500 ms
  const [fa, fb, srv] = [await st(A), await st(B), await serverStatus()];
  check('race: barn +yield exactly once', inv(fa, 'wheat') === before4 + WHEAT.yield && inv(fb, 'wheat') === before4 + WHEAT.yield, `A ${inv(fa, 'wheat')} B ${inv(fb, 'wheat')}`);
  check('race: both clients converged with the server', JSON.stringify(fa) === JSON.stringify(fb) && fa.meta.version === srv.v);
  const tt = [...await toasts(A), ...await toasts(B)];
  check('race: the loser got one friendly toast', tt.filter((t) => /got (there|to \d+ of these) first/.test(t)).length === 1, JSON.stringify(tt));

  // 5. A places the free Coop from the build tray (ghost + real click) and buys a hen ---------------------------
  let coopId = null;
  if (has('place', 'buyAnimal')) {
    const spot = await freeSpot(A, 'coop', P(row[0]).x - 6, P(row[0]).z + 6);
    check('a free spot for the Coop', Boolean(spot));
    await look(A, spot.x + 1.5, spot.z + 1.5);
    check('build mode starts for the Coop', await A.evaluate(() => window.__hh.controller.place('coop')));
    // the ghost must stand on the spot before the click (a camera still easing on a loaded machine moved it: the click
    // then landed on the land for sale next to the farm and opened its card)
    check('the Coop\'s ghost stands on its spot before the click', await hoverTile(A, spot.x + 1, spot.z + 1));
    const c = await tileAt(A, spot.x + 1, spot.z + 1);
    await A.mouse.click(c.x, c.y);
    await waitFor(B, () => Object.values(window.__hh.state.farm.objects).some((o) => o.def === 'coop'));
    const s5 = await st(A);
    coopId = newest(s5, 'coop', 'p1');
    check('the Coop came out of the build tray for free, B sees it', coopId && !(s5.farm.storage?.coop > 0) && s5.farm.wallet.coins === fa.farm.wallet.coins,
      `${coopId} coins ${s5.farm.wallet.coins}`);
    const buy = await A.evaluate((home) => window.__hh.controller.do('buyAnimal', { def: 'chicken', adult: true, home }), coopId);
    check('A bought a hen into the Coop', buy.ok, buy.code ?? '');
    await waitFor(B, (home) => Object.values(window.__hh.state.farm.objects).some((o) => o.def === 'chicken' && o.home === home), coopId);
  } else skip('coop + hen', 'place / buyAnimal not registered');

  // 6. B places the Feed Mill, queues Chicken Feed; A collects the tray with the Hand (real click) ----------------
  let millId = null;
  if (has('place', 'craft', 'collectTray')) {
    const spot = await freeSpot(B, 'feed_mill', P(row[3]).x + 6, P(row[3]).z + 6);
    const pr = await B.evaluate((s) => window.__hh.controller.do('place', { def: 'feed_mill', x: s.x, z: s.z, rot: 0 }), spot);
    check('B placed the Feed Mill from the build tray', pr.ok, pr.code ?? '');
    await waitFor(A, () => Object.values(window.__hh.state.farm.objects).some((o) => o.def === 'feed_mill'));
    millId = newest(await st(B), 'feed_mill', 'p2');
    const q = await B.evaluate((id) => window.__hh.controller.do('craft', { id, recipe: 'chicken_feed' }), millId);
    check('B queued Chicken Feed (grain consumed at once)', q.ok, q.code ?? '');
    await waitFor(A, (id) => (window.__hh.state.farm.objects[id].queue || []).length === 1, millId);
    const item = (await st(A)).farm.objects[millId].queue[0];
    await warp(A, B, item.e - (await A.evaluate(() => window.__hh.serverNow())) + 400);
    await A.evaluate(() => window.__hh.controller.setTool('hand'));
    const m = (await st(A)).farm.objects[millId];
    await look(A, m.x + 1, m.z + 1);
    const feed0 = inv(await st(A), 'chicken_feed');
    check('the Feed Mill can be clicked on screen', await clickObject(A, millId, 1.2));
    const got = await waitFor(B, (n) => (window.__hh.state.farm.inventory.chicken_feed ?? 0) > n, feed0).then(() => true, () => false);
    // a failure says what the Hand saw on the mill (the tray's state, the verb, the dry run)
    const why = got ? '' : JSON.stringify(await A.evaluate(async (id) => {
      const T = await import('/js/game/targets.js');
      const h = window.__hh;
      const t = T.describe(h.state, id, h.serverNow(), h.pid);
      return { trayReady: t?.trayReady, verbs: t ? T.verbsFor('hand', t) : null, r: t ? T.resolve(h.store, 'collectTray', t, {}) : null,
        queue: h.state.farm.objects[id]?.queue, now: h.serverNow(), tool: h.controller.tool.id, pending: h.pending };
    }, millId));
    check('A collected the tray with one Hand click; B sees the feed', got, why);
  } else skip('feed mill', 'place / craft / collectTray not registered');

  // 7. B feeds the hen with the Feed Scoop; warp; A collects the egg with the Hand ---------------------------------
  if (coopId && has('tend')) {
    const co = (await st(B)).farm.objects[coopId];
    await look(B, co.x + 1.5, co.z + 1.5);
    await B.evaluate(() => window.__hh.controller.setTool('feed_scoop'));
    check('the Coop can be clicked on screen (B)', await clickObject(B, coopId, 0.6));
    await waitFor(A, (home) => Object.values(window.__hh.state.farm.objects).some((o) => o.home === home && Number.isFinite(o.readyAt)), coopId);
    check('B fed the hen with the Feed Scoop; A sees her eating', true);
    const hen = Object.values((await st(A)).farm.objects).find((o) => o.home === coopId);
    await warp(A, B, hen.readyAt - (await A.evaluate(() => window.__hh.serverNow())) + 400);
    await A.evaluate(() => window.__hh.controller.setTool('hand'));
    await look(A, co.x + 1.5, co.z + 1.5);
    const egg0 = inv(await st(A), 'egg');
    check('the Coop can be clicked on screen (A)', await clickObject(A, coopId, 0.6));
    await waitFor(B, (n) => (window.__hh.state.farm.inventory.egg ?? 0) + (window.__hh.state.farm.overflow?.egg ?? 0) > n, egg0);
    check('A collected the egg with the Hand; B sees it in the Barn', true);
  } else skip('feed + collect', coopId ? 'tend not registered' : 'no coop');

  // 8. A fills Mabel's order --------------------------------------------------------------------------------------------
  if (order && has('orderFill')) {
    const c8 = (await st(A)).farm.wallet.coins;
    // the order's `n` (RC-07: order actions name the order the player saw)
    const r8 = await A.evaluate(([slot, n]) => window.__hh.controller.do('orderFill', { slot, n }), [order.slot, order.n]);
    check("A filled Mabel's order", r8.ok, r8.code ?? '');
    await waitFor(B, (c) => window.__hh.state.farm.wallet.coins >= c, c8 + order.coins);
    check('the order paid on both screens', (await st(B)).farm.wallet.coins >= c8 + order.coins);
  } else skip("Mabel's order", order ? 'orderFill not registered' : 'the fixture board has no order');

  // 9. BIG_SPEND: A buys a Bakery; the card asks; B gets the heads-up ----------------------------------------------------
  if (has('place') && defOf('bakery')) {
    const s9 = await st(A);
    const spot = await freeSpot(A, 'bakery', P(row[0]).x + 2, P(row[0]).z - 7);
    const dry = await A.evaluate((s) => window.__hh.act('place', { def: 'bakery', x: s.x, z: s.z, rot: 0 }), spot);
    const share = defOf('bakery').cost * 10_000 > s9.farm.wallet.coins * SAFETY.bigSpend.shareBp;
    check('a Bakery is a BIG_SPEND at this treasury', dry.code === 'BIG_SPEND' || !share, `${dry.code} coins ${s9.farm.wallet.coins}`);
    await look(A, spot.x + 1.5, spot.z + 1.5);
    await A.evaluate(() => window.__hh.controller.place('bakery'));
    const bs = await tileAt(A, spot.x + 1, spot.z + 1);
    await A.mouse.move(bs.x - 3, bs.y - 3);
    await A.mouse.move(bs.x, bs.y, { steps: 2 });
    await sleep(120);
    await A.mouse.click(bs.x, bs.y);
    const card = await waitFor(A, () => window.__hh.ui.panels?.isOpen?.('confirm'), null, 6000).then(() => true, () => false);
    if (card) {
      await sleep(250);
      const clicked = await A.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /buy it|yes/i.test(x.textContent.trim()) && x.offsetParent);
        if (b) b.click();
        return Boolean(b);
      });
      check('the "are you sure?" card asked, and yes buys it', clicked);
    } else {
      skip('BIG_SPEND card', 'the ui did not open a confirm panel; confirmed through the API instead');
      await A.evaluate((s) => window.__hh.controller.do('place', { def: 'bakery', x: s.x, z: s.z, rot: 0, confirm: ['BIG_SPEND'] }), spot);
    }
    await waitFor(B, () => Object.values(window.__hh.state.farm.objects).some((o) => o.def === 'bakery'));
    await waitFor(B, () => window.__e2eToasts.some((t) => /is buying/.test(t)), null, 8000)
      .then(() => check('B got the heads-up toast ("Rowan is buying a Bakery")', true), async () => check('B got the heads-up toast', false, JSON.stringify(await toasts(B))));
    await sleep(400);
    const heads = (await toasts(B)).filter((t) => /is buying/.test(t));
    check('exactly one heads-up for the purchase (CL-02)', heads.length === 1, JSON.stringify(heads));
  } else skip('BIG_SPEND', 'place not registered');

  // 10. ping (G over the farm) and an emote reach the partner -------------------------------------------------------------
  await look(A, P(row[1]).x, P(row[1]).z);
  check('after the confirmed purchase A is back on the Hand', (await A.evaluate(() => window.__hh.controller.tool)).build === null);
  // the cursor must be over the field itself (a card or the HUD over that spot would make G arm a ping instead)
  await A.evaluate(() => window.__hh.ui.panels?.closeAll?.());
  const mid = await A.evaluate(([x0, z0]) => {
    const p0 = window.__hh.view.toScreen(x0, z0, 0.1);
    for (let r = 0; r < 200; r += 8) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
        const el = document.elementFromPoint(p0.x + dx, p0.y + dy);
        if (el && el.id === 'world') return { x: p0.x + dx, y: p0.y + dy };
      }
    }
    return p0;
  }, [P(row[1]).x, P(row[1]).z]);
  await A.mouse.move(mid.x - 4, mid.y);
  await A.mouse.move(mid.x, mid.y, { steps: 2 });
  await sleep(250);
  await A.keyboard.press('KeyG');
  await waitFor(B, () => window.__hh.social.some((s) => s.t === 'mark' && s.pid === 'p1'), null, 8000);
  check('A pinged with G; B received the ping', true);
  await sleep(1100);
  await A.evaluate(() => window.__hh.controller.emote('wave'));
  await waitFor(B, () => window.__hh.social.some((s) => s.t === 'emote' && s.pid === 'p1' && s.id === 'wave'), null, 8000);
  check('A waved; B received the emote', true);

  // 10b. Golden Hour from the UI: both farmers sit on the bench with a Hand click --------------------------------------
  if (has('sit', 'place') && defOf('sunset_bench')) {
    const spot = await freeSpot(A, 'sunset_bench', P(row[0]).x + 1, P(row[0]).z + 4);
    check('a free spot for the Sunset Bench', Boolean(spot));
    const pb = await A.evaluate((s) => window.__hh.controller.do('place', { def: 'sunset_bench', x: s.x, z: s.z, rot: 0 }), spot);
    check('A placed a Sunset Bench', pb.ok, pb.code ?? '');
    await waitFor(B, () => Object.values(window.__hh.state.farm.objects).some((o) => o.def === 'sunset_bench'));
    const bench = newest(await st(A), 'sunset_bench', 'p1');
    /** A real Hand click on the bench: scan around its projected centre for a point whose pick IS the bench. */
    const clickBench = async (page) => {
      await page.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); window.__hh.controller.setTool('hand'); });
      await look(page, spot.x + 1, spot.z + 0.5);
      // a real Hand click on the bench, once the pointer is over it (clickObject checks the controller's hover first)
      check('the bench can be picked on screen', await clickObject(page, bench, 0.35));
    };
    const toastLog = toasts;
    await clickBench(A);
    await waitFor(A, (b) => window.__hh.state.farm.coop.bench.p1?.id === b, bench, 15_000)
      .then(() => check('A walked over and sat on the bench', true), () => check('A sat on the bench', false));
    await clickBench(B);
    await waitFor(B, (b) => window.__hh.state.farm.coop.bench.p2?.id === b, bench, 15_000)
      .then(() => check('B sat down NEXT to A (the second seat)', true), async () => check('B sat down next to A', false, JSON.stringify(await toastLog(B))));
    check('nobody was told "Already done"', ![...await toastLog(A), ...await toastLog(B)].some((t) => /already done/i.test(t)));
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    await warp(A, B, COOP.goldenHour.seatMs + 1500);
    await Promise.all([A, B].map((p) => waitFor(p, () => {
      const g = window.__hh.state.farm.coop.golden;
      return g && g.until > window.__hh.serverNow();
    }, null, 15_000)));
    check('Golden Hour started on both screens', true);
    // back to work: the Hand anywhere else stands each farmer up (the restart step plants with the store)
    for (const p of [A, B]) await p.evaluate(() => window.__hh.act('stand', {}));
  } else skip('Golden Hour', 'sit / place not registered');

  // 10c. the Barn moves (owner request 2026-10-04): A picks it up with the Hammer (a real click on the Barn), the ghost
  // follows the mouse, a click puts it down on a free spot; the move is predicted at once, B sees it; B puts it back
  // with "Move back" from her own Hammer hint (a real click); every landmark keeps its goods and both screens converge
  if (has('move', 'moveBack')) {
    await Promise.all([A, B].map((p) => p.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); })));
    const barn = await A.evaluate(() => Object.keys(window.__hh.state.farm.objects).find((k) => window.__hh.state.farm.objects[k].def === 'barn'));
    const s10 = await st(A);
    const b0 = s10.farm.objects[barn];
    await A.evaluate(() => window.__hh.controller.setTool('hammer'));
    await look(A, b0.x + 2, b0.z + 4);
    check('the Hammer picks the Barn up with a real click (it used to say "That spot isn\'t free")', await clickObject(A, barn, 1.2)
      && await waitFor(A, (id) => window.__hh.controller.tool.build?.moveId === id, barn, 4000).then(() => true, () => false));
    // a free spot for the Barn whose footprint is on screen and clear of the HUD
    const to = await A.evaluate(async ([id, x0, z0]) => {
      const g = await import('/shared/rules/grid.js');
      const h = window.__hh;
      const onWorld = (x, z) => { const p = h.view.toScreen(x, z, 0); const el = p && document.elementFromPoint(p.x, p.y); return Boolean(el && el.id === 'world'); };
      for (let r = 5; r < 16; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = x0 + dx; const z = z0 + dz;
            if (g.canFit(h.state, 'barn', x, z, 0, id) !== null) continue;
            if ([[0, 0], [4, 0], [0, 4], [4, 4], [2, 2]].every(([a, b]) => onWorld(x + a, z + b))) return { x, z };
          }
        }
      }
      return null;
    }, [barn, b0.x, b0.z]);
    check('a free spot for the Barn on screen', Boolean(to), JSON.stringify(to));
    // the ghost is centred on the hovered tile: a 4 x 4 footprint's min corner is one tile up-left of it
    check('the Barn\'s ghost follows the mouse to the spot', await hoverTile(A, to.x + 1, to.z + 1));
    const ghost = await A.evaluate(() => window.__hh.view.ghost?.tile ?? null);
    const c = await tileAt(A, to.x + 1, to.z + 1);
    await A.mouse.click(c.x, c.y);
    const pred = await A.evaluate((id) => ({ o: window.__hh.state.farm.objects[id], pending: window.__hh.pending }), barn);
    check('the move is predicted at once on A', pred.o.x === to.x && pred.o.z === to.z, `${JSON.stringify(pred)} ghost ${JSON.stringify(ghost)}`);
    await waitFor(B, ([id, x, z]) => window.__hh.state.farm.objects[id]?.x === x && window.__hh.state.farm.objects[id]?.z === z, [barn, to.x, to.z]);
    check('B sees the Barn at its new spot', true);
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    const [ma, mb] = [await st(A), await st(B)];
    check('the Barn kept its goods; both screens agree', JSON.stringify(ma) === JSON.stringify(mb)
      && JSON.stringify(ma.farm.inventory) === JSON.stringify(s10.farm.inventory), `v ${ma.meta.version}/${mb.meta.version}`);
    fs.mkdirSync(screens, { recursive: true });
    for (const [p, tag] of [[A, 'A'], [B, 'B']]) {
      const f = path.join(screens, `e2e-barn-moved-${tag}.png`);
      await look(p, to.x + 2, to.z + 2);
      await p.screenshot({ path: f });
      files.push(f);
    }
    // B: the Hammer over the moved Barn offers "Move back" (anyone's move, 10 minutes); a real click on it
    await B.evaluate(() => window.__hh.controller.setTool('hammer'));
    await look(B, to.x + 2, to.z + 4);
    const bp = await objectPoint(B, barn, 1.2);
    check('the moved Barn is on B\'s screen', Boolean(bp));
    await B.mouse.move(bp.x - 3, bp.y - 3);
    await B.mouse.move(bp.x, bp.y, { steps: 2 });
    const backBtn = await waitFor(B, () => [...document.querySelectorAll('.hammer-hint button')].some((x) => /move back/i.test(x.textContent) && x.offsetParent), null, 6000)
      .then(() => B.evaluate(() => { const r = [...document.querySelectorAll('.hammer-hint button')].find((x) => /move back/i.test(x.textContent)).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }), () => null);
    check('B\'s Hammer hint offers "Move back"', Boolean(backBtn));
    // one quick flick onto the button: under SwiftShader (2-3 fps) a slow sweep across the Feed Mill can outlast the
    // hint's hover-intent wait and hand the hint to the mill (a real 60 fps mouse does not)
    await B.mouse.move(backBtn.x, backBtn.y);
    await B.mouse.click(backBtn.x, backBtn.y);
    await waitFor(A, ([id, x, z]) => window.__hh.state.farm.objects[id]?.x === x && window.__hh.state.farm.objects[id]?.z === z && !window.__hh.state.farm.objects[id].prev, [barn, b0.x, b0.z]);
    await Promise.all([A, B].map((p) => waitFor(p, () => window.__hh.pending === 0)));
    const [ra2, rb2, srv2] = [await st(A), await st(B), await serverStatus()];
    check('B\'s Move back put the Barn where it stood; both converge with the server', JSON.stringify(ra2) === JSON.stringify(rb2) && ra2.meta.version === srv2.v);
    for (const p of [A, B]) await p.evaluate(() => { window.__hh.controller.cancel?.(); window.__hh.controller.setTool('hand'); });
  } else skip('the Barn moves', 'move / moveBack not registered');

  // 10d. wave 4 (owner wishes C and H): A rests the Hammer on the Market Stand and presses R: it turns where it stands
  // (predicted), B sees it turned. Then "Right-drag: Rotate camera": a real right-drag turns and tilts A's view, Home
  // puts it back
  if (has('move')) {
    await Promise.all([A, B].map((p) => p.evaluate(() => { window.__hh.ui.panels?.closeAll?.(); })));
    const stand = await A.evaluate(() => Object.keys(window.__hh.state.farm.objects).find((k) => window.__hh.state.farm.objects[k].def === 'market_stand'));
    const o0 = (await st(A)).farm.objects[stand];
    await A.evaluate(() => window.__hh.controller.setTool('hammer'));
    await look(A, o0.x + 1, o0.z + 2);
    const sp = await objectPoint(A, stand, 0.8);
    check('w4: the Market Stand is on A\'s screen', Boolean(sp));
    if (sp) {
      await A.mouse.move(sp.x - 3, sp.y - 3);
      await A.mouse.move(sp.x, sp.y, { steps: 2 });
      await waitFor(A, (id) => window.__hh.controller.hover?.id === id || window.__hh.controller.hover?.kind === 'object', stand, 4000).catch(() => {});
      await A.keyboard.press('KeyR');
      const rot = ((o0.rot ?? 0) + 1) % 4;
      check('w4: R turns the Market Stand where it stands (predicted on A)', await waitFor(A, ([id, r]) => (window.__hh.state.farm.objects[id].rot ?? 0) === r, [stand, rot], 4000).then(() => true, () => false));
      check('w4: B sees it turned', await waitFor(B, ([id, r]) => (window.__hh.state.farm.objects[id].rot ?? 0) === r, [stand, rot], 8000).then(() => true, () => false));
      const o1 = (await st(A)).farm.objects[stand];
      check('w4: it kept its place', Math.abs(o1.x - o0.x) <= 1 && Math.abs(o1.z - o0.z) <= 1, JSON.stringify([o0, o1]));
    }
    await A.evaluate(() => { window.__hh.controller.cancel?.(); window.__hh.controller.setTool('hand'); });
    const orbit = await A.evaluate(() => typeof window.__hh.view.camera.orbit === 'function');
    if (orbit) {
      await A.evaluate(() => window.__hh.controller.setOption('rightDrag', 'rotate'));
      const c0 = await A.evaluate(() => window.__hh.view.camera.get());
      const vw = A.viewport();
      const [mx, my] = [Math.round(vw.width / 2), Math.round(vw.height / 2)];
      await A.mouse.move(mx, my);
      await A.mouse.down({ button: 'right' });
      for (let i = 1; i <= 10; i++) await A.mouse.move(mx + i * 10, my + i * 8);
      await A.mouse.up({ button: 'right' });
      const turned = await waitFor(A, ([y, p]) => { const c = window.__hh.view.camera.get(); return Math.abs(c.yaw - y) > 0.1 && c.pitch > p + 0.05; }, [c0.yaw, c0.pitch], 6000)
        .then(() => true, () => false);
      check('w4: "Rotate camera": a right-drag turns and tilts the view', turned, JSON.stringify(await A.evaluate(() => window.__hh.view.camera.get())));
      await A.keyboard.press('Home');
      check('w4: Home resets the tilt', await waitFor(A, () => window.__hh.view.camera.get().tilted === false, null, 4000).then(() => true, () => false));
      await A.evaluate(() => window.__hh.controller.setOption('rightDrag', 'pan'));
    } else skip('w4: Rotate camera', 'this build\'s camera has no orbit (render-world wave 4)');
  } else skip('w4: rotate in place', 'move not registered');

  // 11. server restart mid-session while B keeps playing ------------------------------------------------------------------
  const errorsBefore = errors.length;
  await stopServer();
  await sleep(300);
  const offPlots = plots.slice(5, 7);
  const offline = await B.evaluate((ids) => ids.map((id) => window.__hh.act('plant', { id, crop: 'wheat' }).ok), offPlots);
  check('B keeps predicting while the server is down', offline.every(Boolean) && (await B.evaluate(() => window.__hh.pending)) >= 2);
  await startServer();
  await reconnected([A, B]);
  const expected = (e) => /WebSocket connection to .* failed: .*ERR_CONNECTION_REFUSED/.test(e) || /ERR_CONNECTION_REFUSED/.test(e);
  const during = errors.splice(errorsBefore);
  errors.push(...during.filter((e) => !expected(e)));
  await sleep(300);
  const [ra2, rb2, srv2] = [await st(A), await st(B), await serverStatus()];
  check("restart: B's offline plantings landed on the server", offPlots.every((id) => ra2.farm.objects[id].crop?.def === 'wheat'));
  check('restart: both converged', JSON.stringify(ra2) === JSON.stringify(rb2) && ra2.meta.version === srv2.v, `v ${ra2.meta.version}/${rb2.meta.version}/${srv2.v}`);
  // the restarted server forgot every pose (it puts a joining player at the porch); A's client re-sends where she
  // stands although she never moves again (CL-03, coop-robust-06)
  const aPose = await A.evaluate(() => ({ x: window.__hh.avatar.pose.x, z: window.__hh.avatar.pose.z }));
  const seenOk = await waitFor(B, (q) => {
    const p = window.__hh.view.partner.pose('p1');
    return p && Math.hypot(p.x - q.x, p.z - q.z) < 1;
  }, aPose, 15_000).then(() => true, () => false);
  check('restart: B sees A where she stands, not at the porch', seenOk,
    JSON.stringify({ a: aPose, seenByB: await B.evaluate(() => window.__hh.view.partner.pose('p1')) }));

  // 12. a forced resync converges ----------------------------------------------------------------------------------------
  await B.evaluate(() => window.__hh.store.requestResync('e2e'));
  await waitFor(B, () => window.__hh.store.ready, null, 15_000);
  check('resync: B is ready again and equals A', JSON.stringify(await st(B)) === JSON.stringify(await st(A)));

  // 13. M1b co-op flows -----------------------------------------------------------------------------------------------
  await m1bFlows(A, B);

  // 14. M2 co-op flows -----------------------------------------------------------------------------------------------
  await m2Flows(A, B);

  // audio: every sample decoded, the context running after the first gesture, the generative music playing
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/audio/manifest.json'), 'utf8'));
  // a page that made a build reload at a restart decodes its ~100 samples again: give it the time a loaded machine needs
  await waitFor(A, (n) => window.__hh.audio.info().loaded >= n, Object.keys(manifest.sounds).length, 30_000).catch(() => {});
  const au = await A.evaluate(() => window.__hh.audio.info());
  check('audio: every sound decoded, the context runs, music has started', au.loaded === Object.keys(manifest.sounds).length
    && au.state === 'running' && au.unlocked && au.music.piece >= 1, JSON.stringify({ loaded: au.loaded, state: au.state, music: au.music }));
  // the composed music (owner request 2026-10-04): the director has its track list and has played a track; one playing
  // now really advances (a started-but-stuck stream would count as a piece without a sound)
  check('music: the composed tracks play (not the generative fallback)', au.music.mode === 'tracks' && au.music.tracks >= 6
    && au.music.last !== null, JSON.stringify(au.music));
  if (au.music.track) {
    await sleep(1500);
    const later = await A.evaluate(() => window.__hh.audio.info().music);
    check('music: the playing track advances', later.track !== au.music.track || later.position > au.music.position,
      `${au.music.track} ${au.music.position} -> ${later.track} ${later.position}`);
  }

  // latency: input -> first rendered frame after the predicted change (SwiftShader frames are slow; see the report)
  latencies.inputToFrameA = await A.evaluate(() => window.__hh.latency());
  latencies.inputToFrameB = await B.evaluate(() => window.__hh.latency());
  latencies.actMs = await A.evaluate(async () => {
    const s = window.__hh.state;
    const id = Object.keys(s.farm.objects).find((k) => s.farm.objects[k].def === 'plot' && !s.farm.objects[k].crop);
    const t = performance.now();
    window.__hh.act('plant', { id, crop: 'wheat' });
    return +(performance.now() - t).toFixed(3);
  });

  // screenshots ------------------------------------------------------------------------------------------------------------
  fs.mkdirSync(screens, { recursive: true });
  await look(A, P(row[1]).x, P(row[1]).z + 3, 600);
  await look(B, P(row[1]).x, P(row[1]).z + 3, 600);
  for (const [tag, p] of [['A', A], ['B', B]]) {
    const f = path.join(screens, `e2e-${tag}.png`);
    await p.screenshot({ path: f });
    files.push(f);
  }
  check('no console or page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify({ ok: true, steps: steps.length, skipped, latencies, errors, files }));
  }
} catch (e) {
  // what both screens showed when the step failed (e2e-FAIL-A/B.png next to the other screenshots)
  for (const [tag, p] of failPages) {
    const f = path.join(screens, `e2e-FAIL-${tag}.png`);
    try { fs.mkdirSync(screens, { recursive: true }); await p.screenshot({ path: f }); files.push(f); } catch { /* the page is gone */ }
  }
  console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), steps, skipped, latencies, errors, files, serverLog: serverLog.slice(-1500) }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
