// The first evening, played as two players through the UI (tools/shot.mjs script; the wave-1 integration check).
//
//   node tools/shot.mjs --port 3310 --clients 2 --size 1366x768 --script tools/play-evening.mjs \
//        --out docs/screens/wave1/evening.png
//
// Rowan (A) takes the Fields track, Mia (B) the Barnyard track, as GDD §7.4 scripts it: name the farm, drag-plant and
// drag-harvest Wheat, sell at the Market, fill Mabel's first order, clear weeds, place the free Coop and Feed Mill
// from the build tray, buy hens, make Chicken Feed, feed the hens, collect eggs, finish the first story cards, buy and
// place a building, then keep farming with dev time warps until the farm reaches level 5. Real mouse input where
// the input path matters (strokes, the build ghost, panel buttons); `window.__hh` only to read state and to find
// screen positions. Every step saves <out-dir>/<nn>-<name>-<A|B>.png. A step whose UI path fails is recorded and
// finished through the API (`fallbacks`), so a broken button never hides the steps after it.
import fs from 'node:fs';
import path from 'node:path';

const log = (...a) => console.error('[evening]', ...a);
export const report = { steps: [], fallbacks: [] };

export default async ({ pages, sleep, shot: rawShot, port }) => {
  const [A, B] = pages;
  let n = 0;
  const shot = async (name, ...ps) => {
    n++;
    for (const p of ps.length ? ps : [A, B]) await rawShot(`${String(n).padStart(2, '0')}-${name}-${p.tag}`, p);
  };
  const step = (name, ok, detail = '') => {
    report.steps.push({ name, ok: Boolean(ok), detail });
    log(ok ? 'ok  ' : 'FAIL', name, detail);
  };
  const fallback = (name, why) => { report.fallbacks.push({ name, why }); log('fallback', name, why); };

  // ---- helpers ------------------------------------------------------------------------------------------------
  // A page's state once it has caught up with the server (a loaded machine renders headless pages at a few frames a
  // second, and the per-frame inbox applies deltas on those frames): reading the partner's copy right after an action
  // must not race the delta.
  const serverV = async () => { try { return (await (await fetch(`http://localhost:${port}/api/status`)).json()).v; } catch { return 0; } };
  const st = async (p) => {
    const v = await serverV();
    await p.waitForFunction((x) => window.__hh.store.v >= x && window.__hh.pending === 0, { timeout: 8000, polling: 50 }, v).catch(() => {});
    return p.evaluate(() => JSON.parse(JSON.stringify(window.__hh.state)));
  };
  const waitFor = (p, fn, arg, timeout = 8000) => p.waitForFunction(fn, { timeout, polling: 50 }, arg);
  const idle = (p) => waitFor(p, () => window.__hh.pending === 0, null, 10000).catch(() => {});
  const level = (s) => s.farm.xpLevel ?? null;
  const objs = (s, pred) => Object.entries(s.farm.objects).filter(([, o]) => pred(o)).map(([id]) => id);
  const inv = (s, item) => (s.farm.inventory[item] ?? 0) + (s.farm.overflow?.[item] ?? 0);
  const screenOf = (p, x, z, y = 0.15) => p.evaluate(([a, b, c]) => window.__hh.view.toScreen(a, b, c), [x, z, y]);
  // The focus eases over 500 ms of wall time but the camera moves only on rendered frames: wait for a frame after
  // the ease, so a click computed from the camera lands where it was aimed (at ~1 fps a fixed sleep missed)
  const look = async (p, x, z, ms = 900) => {
    await p.evaluate(([a, b]) => new Promise((res) => {
      window.__hh.view.focus(a, b);
      const t0 = performance.now();
      let off = null;
      const done = () => { if (off) off(); res(); };
      off = window.__hh.view.onFrame(() => { if (performance.now() - t0 > 650) done(); });
      setTimeout(done, 15000);
    }), [x, z]);
    await sleep(Math.max(0, ms - 650));
  };
  /** Click the first visible button whose text matches `re` (inside `scope` when given). Returns its text or null. */
  const click = (p, re, scope = 'body') => p.evaluate(([src, flags, sc]) => {
    const rx = new RegExp(src, flags);
    const root = document.querySelector(sc) || document.body;
    const b = [...root.querySelectorAll('button, [role="button"], [role="tab"]')]
      .find((x) => x.offsetParent !== null && !x.disabled && x.getAttribute('aria-disabled') !== 'true' && rx.test(x.textContent.trim()));
    if (!b) return null;
    b.scrollIntoView({ block: 'nearest' });
    b.click();
    return b.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
  }, [re.source, re.flags, scope]);
  const buttons = (p, scope = 'body') => p.evaluate((sc) => [...(document.querySelector(sc) || document.body).querySelectorAll('button')]
    .filter((x) => x.offsetParent !== null).map((x) => `${x.disabled ? '(off) ' : ''}${x.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}`), scope);
  const panelOpen = (p, name) => p.evaluate((nm) => window.__hh.ui.panels.isOpen(nm), name);
  const closePanels = (p) => p.evaluate(() => window.__hh.ui.panels.closeAll());
  const syncClock = (p, target) => p.evaluate(async (t) => {
    for (let i = 0; i < 80 && window.__hh.serverNow() < t; i++) {
      window.__hh.net.ping();
      await new Promise((r) => setTimeout(r, 50));
    }
  }, target);
  /** Jump the server clock by `ms` and let both clients catch up. */
  const warp = async (ms) => {
    const target = await A.evaluate((x) => window.__hh.dev.warp(x), Math.max(1, Math.ceil(ms)));
    await Promise.all([syncClock(A, target - 50), syncClock(B, target - 50)]);
    await sleep(300);
    return target;
  };
  const warpTo = async (at) => {
    const now = await A.evaluate(() => window.__hh.serverNow());
    if (at > now) await warp(at - now + 400);
  };
  /** A real mouse stroke across tiles. */
  const stroke = async (p, tiles, y = 0.15) => {
    const pts = [];
    for (const [x, z] of tiles) pts.push(await screenOf(p, x + 0.5, z + 0.5, y));
    await p.mouse.move(pts[0].x, pts[0].y);
    await p.mouse.down();
    for (let i = 1; i < pts.length; i++) await p.mouse.move(pts[i].x, pts[i].y, { steps: 5 });
    await p.mouse.up();
  };
  const clickTile = async (p, x, z, y = 0.15) => {
    const c = await screenOf(p, x, z, y);
    await p.mouse.move(c.x - 3, c.y - 3);
    await p.mouse.move(c.x, c.y, { steps: 2 });
    await sleep(120);
    await p.mouse.click(c.x, c.y);
  };
  const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent.trim()));
  const freeSpot = (p, def, cx, cz) => p.evaluate(async ([d, x0, z0]) => {
    const g = await import('/shared/rules/grid.js');
    const s = window.__hh.state;
    for (let r = 0; r < 20; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (g.canPlace(s, d, x0 + dx, z0 + dz, 0) === null) return { x: x0 + dx, z: z0 + dz };
        }
      }
    }
    return null;
  }, [def, cx, cz]);
  /** Footprint centre (tiles, float) of an object. */
  const centre = (p, id) => p.evaluate(async (oid) => {
    const { defOf } = await import('/shared/content/index.js');
    const o = window.__hh.state.farm.objects[oid];
    const d = defOf(o.def);
    const [w, dd] = d.size ? (o.rot % 2 ? [d.size[1], d.size[0]] : d.size) : [1, 1];
    return { x: o.x + w / 2, z: o.z + dd / 2 };
  }, id);
  const levelOf = (p) => p.evaluate(async () => {
    const { levelFromXp } = await import('/shared/content/index.js');
    return levelFromXp(window.__hh.state.farm.xp);
  });
  const act = (p, type, args) => p.evaluate(([t, a]) => {
    const r = window.__hh.act(t, a);
    return { ok: Boolean(r && r.ok), code: r && r.code };
  }, [type, args]);
  /** Dismiss celebration overlays / banners so they never cover the next click. */
  const dismiss = async (p) => {
    for (let i = 0; i < 4; i++) {
      const t = await click(p, /^(Wonderful!?|Hooray!?|Yay!?|Continue|Nice!?|Lovely!?|Got it!?|Close)$/i, '#celebrate');
      if (!t) break;
      await sleep(250);
    }
  };

  // ---- 1. two farmers arrive ------------------------------------------------------------------------------------
  await Promise.all(pages.map((p) => waitFor(p, () => window.__hh.view.stats().fps > 0, null, 30000).catch(() => {})));
  await sleep(2500);
  const s0 = await st(A);
  step('both farmers joined; a fresh farm at level 1 with 16 plots and 300 coins',
    s0.players.p1 && s0.players.p2 && objs(s0, (o) => o.def === 'plot').length === 16 && s0.farm.wallet.coins === 300);
  await shot('arrive');

  // ---- 2. Grandma's welcome, then the farm is named together ------------------------------------------------------
  const go = await click(A, /^Let's go!?$/);
  step("A pressed Grandma's \"Let's go!\"", go);
  await sleep(1500);
  const naming = await A.evaluate(() => window.__hh.ui.panels.isOpen('naming'));
  if (!naming) await A.evaluate(() => window.__hh.ui.nameFarm());
  await sleep(500);
  await shot('naming', A);
  const typed = await A.evaluate(() => {
    const i = document.querySelector('input[aria-label="Farm name"]');
    if (!i) return false;
    i.value = 'Sunny Hollow';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  const carved = typed && await click(A, /^Carve it!?$/);
  if (!carved) {
    fallback('name the farm', 'no naming card');
    await act(A, 'nameFarm', { name: 'Sunny Hollow' });
  }
  await waitFor(B, () => window.__hh.state.farm.name === 'Sunny Hollow', null, 5000).catch(() => {});
  await sleep(1200);
  step('the farm is named on both screens', (await st(B)).farm.name === 'Sunny Hollow');
  await shot('named');
  await dismiss(B);
  await click(B, /^Love it$/);

  // ---- 3. A drag-plants Wheat with the Seed Bag (toolbar -> seed tray -> stroke); B plants the other half --------
  const plots = objs(s0, (o) => o.def === 'plot').map((id) => ({ id, ...s0.farm.objects[id] }))
    .sort((a, b) => a.z - b.z || a.x - b.x);
  const rows = [...new Set(plots.map((p) => p.z))].map((z) => plots.filter((p) => p.z === z));
  const midX = (plots[0].x + plots.at(-1).x) / 2 + 0.5;
  const midZ = (plots[0].z + plots.at(-1).z) / 2 + 0.5;
  await look(A, midX, midZ);
  await look(B, midX, midZ);
  await A.click('[data-tool="seed_bag"]').catch(() => {});
  await sleep(400);
  const seedTray = await A.evaluate(() => !document.getElementById('seed-tray').hidden);
  await shot('seed-tray', A);
  if (seedTray) await A.click('#seed-tray [data-crop="wheat"]');
  else { fallback('seed tray', 'the Seed Bag did not open the tray'); await A.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' })); }
  await sleep(200);
  for (const r of rows.slice(0, 2)) {
    await stroke(A, (r[0].x < r.at(-1).x ? r : [...r].reverse()).map((p) => [p.x, p.z]));
    await sleep(200);
  }
  await B.evaluate(() => window.__hh.controller.setTool('seed_bag', { crop: 'wheat' }));
  for (const r of rows.slice(2)) {
    await stroke(B, r.map((p) => [p.x, p.z]));
    await sleep(200);
  }
  await Promise.all([idle(A), idle(B)]);
  await sleep(600);
  let s = await st(A);
  const planted = plots.filter((p) => s.farm.objects[p.id].crop).length;
  step('16 plots planted by two drag strokes each', planted === 16, `${planted}/16, coins ${s.farm.wallet.coins}`);
  await shot('planted');

  // ---- 4. warp; A harvests with the Sickle (strokes), B with the Hand -------------------------------------------
  const readyAt = Math.max(...plots.map((p) => s.farm.objects[p.id].crop?.readyAt ?? 0));
  await warpTo(readyAt);
  await shot('ripe', A);
  await A.click('[data-tool="sickle"]').catch(() => A.evaluate(() => window.__hh.controller.setTool('sickle')));
  for (const r of rows.slice(0, 2)) { await stroke(A, r.map((p) => [p.x, p.z])); await sleep(200); }
  await B.evaluate(() => window.__hh.controller.setTool('hand'));
  for (const r of rows.slice(2)) { await stroke(B, r.map((p) => [p.x, p.z])); await sleep(200); }
  await Promise.all([idle(A), idle(B)]);
  await sleep(800);
  s = await st(A);
  step('every plot harvested; Wheat in the Barn', plots.every((p) => !s.farm.objects[p.id].crop), `wheat ${inv(s, 'wheat')}`);
  await shot('harvested');
  await dismiss(A); await dismiss(B);

  // ---- 5. A sells 10 Wheat at the Market (dock -> stack -> quantity -> Sell) --------------------------------------
  const sellUi = async (p, item, qty) => {
    await p.click('[data-dock="market"]').catch(() => {});
    await waitFor(p, () => window.__hh.ui.panels.isOpen('market'), null, 4000).catch(() => {});
    await sleep(500);
    await p.click(`.pn-stack[data-item="${item}"]`).catch(() => {});
    await sleep(200);
    await p.evaluate((q) => {
      const num = document.querySelector('.pn-slip .pn-num');
      if (!num) return;
      num.value = String(q);
      num.dispatchEvent(new Event('change', { bubbles: true }));
    }, qty);
    await sleep(200);
    return click(p, new RegExp(`^Sell ${qty}$`), '.pn-slip');
  };
  const coins5 = (await st(A)).farm.wallet.coins;
  const sold = await sellUi(A, 'wheat', 10);
  await sleep(400);
  await shot('market-sell', A);
  if (!sold) {
    fallback('sell in the Market', JSON.stringify(await buttons(A, '#panels')));
    await act(A, 'sell', { item: 'wheat', qty: 10 });
  }
  await idle(A);
  s = await st(B);
  step('A sold 10 Wheat in the Market; coins rose on both screens', s.farm.wallet.coins > coins5, `${coins5} -> ${s.farm.wallet.coins}`);
  await closePanels(A);

  // ---- 6. A fills Mabel's first order (O -> Deliver) ---------------------------------------------------------------
  // The board opens at level 2. Crop XP accrues in fractions since RC-13 (Wheat 0.5 a plot), so one field of Wheat may
  // stop just short: another quick round (through the store, the strokes were already played) reaches it.
  for (let round = 0; round < 3 && (await levelOf(A)) < 2; round++) {
    const ids = plots.map((p) => p.id);
    await act(A, 'plant', { ids, crop: 'wheat' });
    await idle(A);
    const due = await A.evaluate((list) => Math.max(...list.map((id) => window.__hh.state.farm.objects[id].crop?.readyAt ?? 0)), ids);
    await warpTo(due);
    await act(B, 'harvest', { ids });
    await Promise.all([idle(A), idle(B)]);
    await dismiss(A); await dismiss(B);
  }
  await A.click('[data-dock="orders"]').catch(() => {});
  await waitFor(A, () => window.__hh.ui.panels.isOpen('orders'), null, 4000).catch(() => {});
  await sleep(700);
  await shot('orders', A);
  const coins6 = (await st(A)).farm.wallet.coins;
  const filled = await A.evaluate(() => {
    const b = [...document.querySelectorAll('[data-fill]')].find((x) => !x.disabled && x.offsetParent);
    if (!b) return null;
    b.click();
    return b.dataset.fill;
  });
  if (filled === null) {
    fallback('fill an order', JSON.stringify(await buttons(A, '#panels')));
    const [slot, x] = Object.entries((await st(A)).farm.orders.slots).find(([, y]) => y.order) ?? [];
    // order actions name the order they saw (`n`, RC-07): a stale intent never fills a NEW order
    if (slot !== undefined) await act(A, 'orderFill', { slot: Number(slot), n: x.order.n });
  }
  await idle(A);
  await sleep(600);
  s = await st(B);
  step("A filled Mabel's first order; both screens paid", s.farm.wallet.coins > coins6, `${coins6} -> ${s.farm.wallet.coins}`);
  await shot('order-filled', A);
  await closePanels(A);
  await dismiss(A); await dismiss(B);

  // ---- 7. B: clear weeds by hand, place the free Coop and Feed Mill from the build tray ------------------------------
  s = await st(B);
  const weeds = objs(s, (o) => o.def === 'weed').map((id) => ({ id, ...s.farm.objects[id] }));
  await B.evaluate(() => window.__hh.controller.setTool('hand'));
  let cleared = 0;
  for (const w of weeds.slice(0, 3)) {
    await closePanels(B);
    await look(B, w.x + 0.5, w.z + 0.5, 700);
    // a weed is small: click a point whose pick IS the weed (a barn or a tree in front of it would open its panel)
    const at = await B.evaluate((ww) => {
      const c = document.getElementById('world').getBoundingClientRect();
      const p0 = window.__hh.view.toScreen(ww.x + 0.5, ww.z + 0.5, 0.1);
      for (let r = 0; r < 40; r += 3) {
        for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
          const x = p0.x + dx; const y = p0.y + dy;
          const k = window.__hh.view.pick({ x: ((x - c.left) / c.width) * 2 - 1, y: -((y - c.top) / c.height) * 2 + 1 });
          if (k && k.id === ww.id && document.elementFromPoint(x, y)?.id === 'world') return { x, y };
        }
      }
      return null;
    }, w);
    if (!at) continue;
    await B.mouse.move(at.x - 3, at.y - 3);
    await B.mouse.move(at.x, at.y, { steps: 2 });
    await sleep(120);
    await B.mouse.click(at.x, at.y);
    await sleep(500);
  }
  await idle(B);
  s = await st(B);
  cleared = weeds.slice(0, 3).filter((w) => !s.farm.objects[w.id]).length;
  step('B cleared weeds by clicking them with the Hand', cleared >= 1, `${cleared}/${Math.min(3, weeds.length)}`);
  await shot('weeds-cleared', B);

  const placeFromTray = async (p, def, near) => {
    await p.click('[data-dock="build"]').catch(() => {});
    await sleep(500);
    const opened = await p.evaluate((d) => Boolean(document.querySelector(`#build-tray .build-card[data-def="${d}"]`)), def);
    if (opened) await p.click(`#build-tray .build-card[data-def="${def}"]`);
    else { fallback(`build tray ${def}`, 'no card'); await p.evaluate((d) => window.__hh.controller.place(d), def); }
    const spot = await freeSpot(p, def, near.x, near.z);
    const { defOf } = await import('../shared/content/index.js');
    const [w, d] = defOf(def).size;
    await look(p, spot.x + w / 2, spot.z + d / 2, 800);
    await clickTile(p, spot.x + w / 2, spot.z + d / 2, 0);
    await sleep(500);
    await idle(p);
    return spot;
  };
  const yard = { x: plots[0].x - 6, z: plots[0].z + 2 };
  const coopSpot = await placeFromTray(B, 'coop', yard);
  await shot('coop-placed', B);
  await waitFor(A, () => Object.values(window.__hh.state.farm.objects).some((o) => o.def === 'coop'), null, 8000).catch(() => {});
  s = await st(A);
  const coopId = objs(s, (o) => o.def === 'coop')[0];
  step('B placed the free Coop from the build tray; A sees it', coopId, JSON.stringify(coopSpot));
  const millSpot = await placeFromTray(B, 'feed_mill', { x: yard.x, z: yard.z + 6 });
  // A's copy arrives with the next delta frame (a loaded machine renders ~1 fps headless): wait for it
  await waitFor(A, () => Object.values(window.__hh.state.farm.objects).some((o) => o.def === 'feed_mill'), null, 8000).catch(() => {});
  s = await st(A);
  const millId = objs(s, (o) => o.def === 'feed_mill')[0];
  step('B placed the free Feed Mill next to it', millId, JSON.stringify(millSpot));
  await B.evaluate(() => window.__hh.controller.setTool('hand'));
  await dismiss(A); await dismiss(B);

  // ---- 8. hens: the story card's two hens arrive in the Coop; B buys one more in the Coop panel ------------------------
  s = await st(B);
  let hens = objs(s, (o) => o.def === 'chicken');
  log('hens after the coop', hens.length);
  const cc = await centre(B, coopId);
  await look(B, cc.x, cc.z, 800);
  await clickTile(B, cc.x, cc.z, 0.6);
  await waitFor(B, () => window.__hh.ui.panels.isOpen('animals'), null, 4000).catch(() => {});
  await sleep(600);
  await shot('coop-panel', B);
  const coopPanel = await panelOpen(B, 'animals');
  step('a Hand click on the hungry Coop opens its panel (no feed yet)', coopPanel, `${hens.length} hens from Grandma's letter`);
  await closePanels(B);

  // ---- 9. B makes Chicken Feed in the Feed Mill panel; warp; collect the tray ------------------------------------------
  const mc = await centre(B, millId);
  await look(B, mc.x, mc.z, 800);
  await clickTile(B, mc.x, mc.z, 1.0);
  await waitFor(B, () => window.__hh.ui.panels.isOpen('building'), null, 4000).catch(() => {});
  await sleep(600);
  const made = await B.evaluate(() => {
    const b = document.querySelector('[data-craft="chicken_feed"]');
    if (!b || b.disabled) return false;
    b.click();
    return true;
  });
  await sleep(500);
  await shot('feed-mill', B);
  if (!made) {
    fallback('make Chicken Feed in the panel', JSON.stringify(await buttons(B, '#panels')));
    await act(B, 'craft', { id: millId, recipe: 'chicken_feed' });
  }
  await idle(B);
  s = await st(B);
  const q0 = s.farm.objects[millId].queue?.[0];
  step('Chicken Feed is cooking in the Feed Mill', q0, q0 ? `${q0.r} ready at +${Math.round((q0.e - q0.s) / 1000)} s` : '');
  if (q0) await warpTo(q0.e);
  await sleep(800);
  const collectedTray = await click(B, /^Collect \d+/, '#panels');
  if (!collectedTray) {
    fallback('collect the tray in the panel', JSON.stringify(await buttons(B, '#panels')));
    await act(B, 'collectTray', { id: millId });
  }
  await idle(B);
  await waitFor(A, () => (window.__hh.state.farm.inventory.chicken_feed ?? 0) > 0, null, 5000).catch(() => {});
  s = await st(A);
  step('Chicken Feed collected into the Barn', inv(s, 'chicken_feed') > 0, `feed ${inv(s, 'chicken_feed')}`);
  await shot('feed-collected', B);
  await closePanels(B);

  // ---- 10. B feeds the hens with the Feed Scoop (drag over the pen); warp; A collects eggs with the Hand --------------
  await B.click('[data-tool="feed_scoop"]').catch(() => B.evaluate(() => window.__hh.controller.setTool('feed_scoop')));
  await look(B, cc.x, cc.z, 700);
  await stroke(B, [[cc.x - 1, cc.z - 0.6], [cc.x - 0.5, cc.z - 0.5], [cc.x, cc.z - 0.5]], 0.4);
  await idle(B);
  await sleep(500);
  s = await st(A);
  const fed = objs(s, (o) => o.def === 'chicken' && Number.isFinite(o.readyAt));
  if (!fed.length) {
    fallback('feed with the scoop stroke', 'no hen fed');
    await act(B, 'tend', { id: coopId });
    s = await st(A);
  }
  const fedNow = objs(s, (o) => o.def === 'chicken' && Number.isFinite(o.readyAt));
  step('B fed the hens; A sees them eating', fedNow.length > 0, `${fedNow.length} fed`);
  await shot('hens-fed', B);
  const eggAt = Math.max(...fedNow.map((id) => s.farm.objects[id].readyAt));
  await warpTo(eggAt);
  await A.evaluate(() => window.__hh.controller.setTool('hand'));
  await look(A, cc.x, cc.z, 800);
  await shot('eggs-ready', A);
  const eggs0 = inv(s, 'egg');
  await clickTile(A, cc.x, cc.z, 0.5);
  await idle(A);
  await sleep(500);
  s = await st(B);
  if (inv(s, 'egg') <= eggs0) {
    fallback('collect eggs with the Hand', 'no egg');
    await act(A, 'collect', { id: coopId });
    s = await st(B);
  }
  step('A collected the eggs; B sees them in the Barn', inv(s, 'egg') > eggs0, `eggs ${inv(s, 'egg')}`);
  await shot('eggs-collected');
  await dismiss(A); await dismiss(B);

  // ---- 11. the Journal: story letters --------------------------------------------------------------------------------
  await A.click('[data-dock="journal"]').catch(() => {});
  await waitFor(A, () => window.__hh.ui.panels.isOpen('journal'), null, 4000).catch(() => {});
  await sleep(700);
  await shot('journal', A);
  s = await st(A);
  step('story cards completed so far', Object.keys(s.farm.quests.done || {}).length >= 1, Object.keys(s.farm.quests.done || {}).join(','));
  await closePanels(A);

  // ---- 12. keep farming to level 5 with time warps; buy and place the Bakery through the Market at level 4 --------------
  const { CONTENT: C, levelFromXp, liveAt } = await import('../shared/content/index.js');
  const plotIds = plots.map((p) => p.id);
  let bakeryDone = false;
  let lastLevel = await levelOf(A);
  const seen = new Set();
  for (let round = 0; round < 40 && lastLevel < 5; round++) {
    s = await st(A);
    const lv = levelFromXp(s.farm.xp);
    // the best quick crop: most XP per planting among the unlocked ones that grow within 30 minutes
    const crop = liveAt('crops', lv).filter((c) => c.growMs <= 30 * 60_000 && c.seed * 16 <= s.farm.wallet.coins)
      .sort((a, b) => b.xp - a.xp || a.growMs - b.growMs)[0] || C.crops.get('wheat');
    const empty = plotIds.filter((id) => !s.farm.objects[id].crop);
    if (empty.length) await act(A, 'plant', { ids: empty, crop: crop.id });
    // the hens: feed (makes Chicken Feed first when the Barn has none), collect
    s = await st(B);
    if (inv(s, 'chicken_feed') < 2 && !(s.farm.objects[millId].queue || []).length) await act(B, 'craft', { id: millId, recipe: 'chicken_feed' });
    await act(B, 'tend', { id: coopId });
    await Promise.all([idle(A), idle(B)]);
    s = await st(A);
    const due = [
      ...plotIds.map((id) => s.farm.objects[id].crop?.readyAt).filter(Number.isFinite),
      ...(s.farm.objects[millId].queue || []).map((q) => q.e),
    ];
    await warpTo(Math.max(...due, await A.evaluate(() => window.__hh.serverNow())));
    await act(B, 'harvest', { ids: plotIds.filter((id) => s.farm.objects[id].crop) });
    await act(B, 'collectTray', { id: millId });
    await act(A, 'tend', { id: coopId });
    await Promise.all([idle(A), idle(B)]);
    // Mabel's orders that the Barn can fill, story cards to hand in
    s = await st(A);
    for (const [slot, x] of Object.entries(s.farm.orders.slots)) {
      if (x.order && Object.entries(x.order.items).every(([it, q]) => inv(s, it) >= q)) await act(A, 'orderFill', { slot: Number(slot), n: x.order.n });
    }
    const deliverable = await A.evaluate(async () => {
      const q = await import('/shared/rules/actions/quests.js');
      const st0 = window.__hh.state;
      return Object.keys(st0.farm.quests.active || {}).filter((id) => q.questReady(st0, id, window.__hh.serverNow()));
    }).catch(() => []);
    for (const qid of deliverable) await act(A, 'questDeliver', { id: qid });
    await idle(A);
    s = await st(A);
    // keep the Barn below its cap: sell grain beyond what the orders and the feed need
    for (const it of ['wheat', 'carrot', 'corn', 'strawberry']) {
      const extra = inv(s, it) - 30;
      if (extra > 0) await act(A, 'sell', { item: it, qty: extra });
    }
    await Promise.all([idle(A), idle(B)]);
    const nowLevel = await levelOf(A);
    if (nowLevel > lastLevel) {
      await sleep(900);
      await shot(`level-${nowLevel}`);
      lastLevel = nowLevel;
      await sleep(2600);
      await dismiss(A); await dismiss(B);
    }
    if (!bakeryDone && nowLevel >= 4) {
      s = await st(A);
      if (s.farm.wallet.coins >= C.buildings.get('bakery').cost) {
        bakeryDone = true;
        await closePanels(A);
        await A.click('[data-dock="market"]').catch(() => {});
        await waitFor(A, () => window.__hh.ui.panels.isOpen('market'), null, 4000).catch(() => {});
        await sleep(400);
        await click(A, /^Buildings$/, '#panels');
        await sleep(600);
        await shot('market-buildings', A);
        const started = await A.evaluate(() => {
          const b = document.querySelector('[data-place="bakery"]');
          if (!b || b.disabled) return false;
          b.click();
          return true;
        });
        if (!started) { fallback('start the Bakery placement from the Market', JSON.stringify(await buttons(A, '#panels'))); await A.evaluate(() => window.__hh.controller.place('bakery')); }
        const spot = await freeSpot(A, 'bakery', plots[0].x + 8, plots[0].z - 6);
        await look(A, spot.x + 1.5, spot.z + 1.5, 800);
        const c0 = await screenOf(A, spot.x + 1.5, spot.z + 1.5, 0);
        await A.mouse.move(c0.x - 4, c0.y - 4);
        await A.mouse.move(c0.x, c0.y, { steps: 3 });
        await sleep(400);
        await shot('bakery-ghost', A);
        await A.mouse.click(c0.x, c0.y);
        await sleep(700);
        const asked = await A.evaluate(() => window.__hh.ui.panels.isOpen('confirm'));
        if (asked) { await shot('big-spend', A); await click(A, /buy it|yes/i); }
        await idle(A);
        await sleep(800);
        s = await st(B);
        const bakery = objs(s, (o) => o.def === 'bakery')[0];
        step('A bought the Bakery in the Market and placed it with the ghost; B sees it', bakery, asked ? 'via the BIG_SPEND card' : '');
        await shot('bakery-placed');
        await A.evaluate(() => window.__hh.controller.setTool('hand'));
      }
    }
    void seen;
  }
  // ---- 13. B buys another hen in the Coop panel (the treasury allows it now) ------------------------------------------
  await closePanels(B);
  await B.evaluate(() => window.__hh.controller.setTool('hand'));
  await look(B, cc.x, cc.z, 800);
  await B.evaluate((id) => window.__hh.ui.panels.open('animals', { id }), coopId);
  await sleep(700);
  const hensBefore = objs(await st(B), (o) => o.def === 'chicken').length;
  const buyHen = await B.evaluate(() => {
    const b = [...document.querySelectorAll('[data-buy="chicken"]')].find((x) => !x.disabled && x.offsetParent);
    if (!b) return false;
    b.click();
    return true;
  });
  await sleep(600);
  if (await panelOpen(B, 'confirm')) await click(B, /buy it|yes/i);
  await idle(B);
  await sleep(500);
  await shot('hen-bought', B);
  if (!buyHen) fallback('buy a hen in the Coop panel', JSON.stringify(await buttons(B, '#panels')));
  step('B bought a hen in the Coop panel', objs(await st(A), (o) => o.def === 'chicken').length > hensBefore);
  await closePanels(B);

  s = await st(A);
  step('the farm reached level 5 the same evening', levelFromXp(s.farm.xp) >= 5, `level ${levelFromXp(s.farm.xp)}, ${s.farm.xp} XP`);
  step('story cards done', Object.keys(s.farm.quests.done || {}).length >= 3, Object.keys(s.farm.quests.done || {}).join(','));

  // ---- 13. the end of the evening: both screens, the Barn, the Journal's ribbons ------------------------------------
  await closePanels(A); await closePanels(B);
  await dismiss(A); await dismiss(B);
  await look(A, midX - 3, midZ - 2, 1200);
  await look(B, midX - 3, midZ - 2, 1200);
  await shot('evening-end');
  await A.click('[data-dock="barn"]').catch(() => {});
  await sleep(900);
  await shot('barn', A);
  await closePanels(A);
  await B.click('[data-dock="journal"]').catch(() => {});
  await sleep(700);
  await click(B, /^Ribbons$/, '#panels');
  await sleep(700);
  await shot('ribbons', B);
  await closePanels(B);
  const [fa, fb] = [await st(A), await st(B)];
  step('both screens hold the same farm', JSON.stringify(fa) === JSON.stringify(fb), `v ${fa.meta.version}/${fb.meta.version}`);

  // ---- report -------------------------------------------------------------------------------------------------------
  fs.writeFileSync(path.join(path.dirname((await rawShot('zz-final-A', A))), 'report.json'), JSON.stringify(report, null, 2));
  log('report', JSON.stringify(report));
  void level; void buttons; void panelOpen; void closePanels; void toasts; void freeSpot; void centre; void levelOf; void clickTile;
};
