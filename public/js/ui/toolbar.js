// Tool tray + contextual seed picker (GDD §7.1 tool modes, §7.3 bottom-centre; visual-ux-juice §5.5). ui-shell lane.
//
// Tools come from controller.TOOLS (client-core owns the list and the keys); each maps to a content tool def for its
// icon, name, help text and unlock level (shared/content tools.js). Locked tools stay hidden until their level and
// then arrive with a "New!" badge (per player, this browser). The seed tray opens with the Seed Bag: live crops with
// seed cost, grow time, sell value, barn count and mastery stars; the next locked crops show their level.
// During a drag the chip reads "Planting Carrot × 14" (controller 'stroke' events).
//
//   createToolbar(S) -> { render(), openSeeds(bool), toolDef(id) }
import { CONTENT, live, levelFromXp, masteryStars, defOf, GROWTH } from '../../../shared/content/index.js';

const GROWTH_C = GROWTH.compost;
import * as UPG from '../../../shared/rules/upgrades.js';
import * as FARMING from '../../../shared/rules/actions/farming.js';
import { useIntent, relicIcon } from './panels/w4b-rules.js';
import { probe, reason } from './panels/core.js';
import { hasIcon } from '../render/icons.js';
import { ONCE_VERBS } from '../game/targets.js';
import { h, icon, svgIcon, fmt, fmtDuration, kv, touchPlayer } from './dom.js';

/** Wave 4 (wishes A, C, E): the Hammer hint's Sell, Rotate and Upgrade flows live in a module loaded on first use. */
const flows = () => import('./panels/w4-flows.js');

/** Controller tool id -> content tool id (M0 ids and the GDD names both map). */
export const TOOL_CONTENT = Object.freeze({
  hand: 'hand', seed: 'seed_bag', seeds: 'seed_bag', seed_bag: 'seed_bag', sickle: 'sickle', harvest: 'sickle',
  water: 'watering_can', can: 'watering_can', watering_can: 'watering_can', feed: 'feed_scoop', scoop: 'feed_scoop',
  feed_scoop: 'feed_scoop', tend: 'feed_scoop', basket: 'basket', compost: 'compost_scoop', compost_scoop: 'compost_scoop',
  axe: 'axe', chop: 'axe', hammer: 'hammer', build: 'hammer',
});

/**
 * The toolbar's one-word label of a tool: content's `short` when it has one, else these (two tools used to read
 * "Scoop" and the Watering Can "Can"; QA wave 1 UI-23). Pure.
 */
const SHORT = Object.freeze({ seed_bag: 'Seeds', watering_can: 'Water', feed_scoop: 'Feed', compost_scoop: 'Compost',
  big_watering_can: 'Water', wide_sickle: 'Sickle', basket: 'Basket' });
const STROKE_VERB = { plant: 'Planting', goldenPlant: 'Planting', harvest: 'Harvesting', water: 'Watering', tend: 'Tending',
  collect: 'Collecting', pet: 'Petting', fertilize: 'Fertilizing', shake: 'Picking', pick: 'Picking', clear: 'Clearing',
  compost: 'Composting', uproot: 'Uprooting', chop: 'Chopping', feed: 'Feeding', collectTray: 'Collecting',
  bottle: 'Bottle-feeding', nurse: 'Caring for', weed: 'Pulling weeds' };

/**
 * The "Planting Carrot × 14" chip of a drag stroke: { item, text, n }, or null when there is none to show. A one-press
 * action (a crate, a ride, a Giant's chop) has its own card or effect, so it gets no chip (wave-4b verifier: a crate
 * showed "nullPainting × 1").
 */
export function strokeChip(s) {
  if (!s || !s.count) return null;
  const verb = s.verb || s.kind;
  if (ONCE_VERBS.has(verb)) return null;
  const what = s.item ? (CONTENT.crops.get(s.item)?.name || CONTENT.items.get(s.item)?.name || CONTENT.animals.get(s.item)?.name || s.item) : '';
  return { item: s.item || null, text: `${STROKE_VERB[verb] ?? ''} ${what}`.trim(), n: s.count };
}

export function shortLabel(def, fallback = '') {
  if (!def) return fallback;
  if (typeof def.short === 'string' && def.short) return def.short;
  if (SHORT[def.id]) return SHORT[def.id];
  if (def.upgrades && SHORT[def.upgrades]) return SHORT[def.upgrades];
  const n = def.name || fallback;
  return n.length > 9 ? n.split(' ').at(-1) : n;
}

/** The content def of a controller tool, upgraded to the owned brush (Big Watering Can, Wide Sickle) when owned. */
export function toolDefFor(toolId, state) {
  const base = CONTENT.tools.get(TOOL_CONTENT[toolId] || toolId) || null;
  if (!base || !state) return base;
  const owned = state.farm.tools || {};
  let best = base;
  for (const t of CONTENT.tools.values()) {
    if (t.upgrades === base.id && owned[t.id] && (t.brush[0] * t.brush[1]) > (best.brush[0] * best.brush[1])) best = t;
  }
  return best;
}

/** The seed tray rows for a level (live crops + up to two upcoming ones as locked previews). Pure. */
export function seedRows(state) {
  const level = levelFromXp(state.farm.xp);
  const rows = [];
  let upcoming = 0;
  for (const c of live('crops')) {
    const open = level >= c.unlock;
    if (!open && upcoming >= 2) continue;
    if (!open) upcoming++;
    rows.push({
      id: c.id, name: c.name, open, unlock: c.unlock, seed: c.seed, sell: c.sell, growMs: c.growMs, xp: c.xp, yield: c.yield,
      stock: (state.farm.inventory[c.id] || 0) + (state.farm.overflow[c.id] || 0),
      stars: open ? masteryStars(c, (state.farm.mastery || {})[c.id] || 0, level) : 0,
    });
  }
  return rows;
}

/** "1m", "45m", "2h", "1h 30m": the seed tray's short grow time. Pure. */
export function shortTime(ms) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  return m % 60 ? `${hr}h ${m % 60}m` : `${hr}h`;
}

export function createToolbar(S) {
  const { store, controller, ui } = S;
  const bar = document.getElementById('toolbar');
  // qa2 CL-05: offsetWidth on every render forced a layout per predicted change of a drag stroke; the bar is measured
  // once, then whenever it changes size
  let sized = false;
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => sizeTrays()).observe(bar);
  else window.addEventListener('resize', () => sizeTrays());
  const tray = document.getElementById('seed-tray');
  const chip = document.getElementById('stroke-chip');
  const btray = document.getElementById('build-tray');
  let buildOpen = false;
  let seedsOpen = false;
  let lastLevel = 0;

  // ---- a bar wider than the screen (a phone's holds five of nine tools): a chevron says there is more and goes there;
  // at the far end it points back. The tool in hand always scrolls into view (mobile QA M-13, astra P1-3) ----------
  const more = h('button.tool-more', { type: 'button', hidden: true, on: { click: () => {
    const v = vertical();
    const back = more.dataset.dir === 'back';
    const step = v ? bar.clientHeight * 0.7 : bar.clientWidth * 0.6;
    bar.scrollBy(v ? { top: back ? -bar.scrollHeight : step, behavior: 'smooth' } : { left: back ? -bar.scrollWidth : step, behavior: 'smooth' });
  } } }, h('span', { 'aria-hidden': 'true' }, '›'));
  document.getElementById('tray-wrap')?.append(more);
  const vertical = () => bar.scrollHeight > bar.clientHeight + 2 && bar.scrollWidth <= bar.clientWidth + 2;
  function paintMore() {
    const v = vertical();
    const max = v ? bar.scrollHeight - bar.clientHeight : bar.scrollWidth - bar.clientWidth;
    if (max <= 2 || bar.offsetParent === null) { more.hidden = true; return; }
    const pos = v ? bar.scrollTop : bar.scrollLeft;
    const back = pos >= max - 4;
    more.hidden = false;
    more.dataset.dir = back ? 'back' : 'on';
    more.dataset.axis = v ? 'y' : 'x';
    more.setAttribute('aria-label', back ? 'Back to the first tools' : 'More tools');
  }
  bar.addEventListener('scroll', paintMore, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(paintMore).observe(bar);
  /** Scroll the bar so tool button `b` is clear of the menu button and the chevron. */
  function revealTool(b) {
    if (!b || !b.isConnected) return;
    const br = b.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    if (!br.width || !r.width) return;
    const pad = 40;
    if (vertical()) {
      const lo = r.top + 4;
      const hi = r.bottom - pad;
      if (br.top < lo) bar.scrollBy({ top: br.top - lo, behavior: 'smooth' });
      else if (br.bottom > hi) bar.scrollBy({ top: br.bottom - hi, behavior: 'smooth' });
      return;
    }
    if (bar.scrollWidth <= bar.clientWidth + 2) return;
    const menu = document.getElementById('m-menu-btn');
    const mr = menu && menu.offsetParent !== null ? menu.getBoundingClientRect() : null;
    const hi = (mr && mr.top < r.bottom && mr.left < r.right ? mr.left : r.right) - pad;
    const lo = r.left + pad;
    if (br.left < lo) bar.scrollBy({ left: br.left - lo, behavior: 'smooth' });
    else if (br.right > hi) bar.scrollBy({ left: br.right - hi, behavior: 'smooth' });
  }
  let revealed = null;

  const seenKey = () => `hh.seen.${store.pid}`;
  const seen = () => kv.get(seenKey(), null);
  function markSeen(kind, id) {
    const s = seen() || { tools: {}, crops: {} };
    s[kind] = s[kind] || {};
    if (s[kind][id]) return;
    s[kind][id] = 1;
    kv.set(seenKey(), s);
  }
  /** On the very first render everything visible counts as seen: "New!" is for what arrives later. */
  function seedSeen(state) {
    if (seen()) return;
    const level = levelFromXp(state.farm.xp);
    const s = { tools: {}, crops: {} };
    for (const t of controller.TOOLS) s.tools[t.id] = 1;
    for (const c of live('crops')) if (c.unlock <= level) s.crops[c.id] = 1;
    kv.set(seenKey(), s);
  }

  /** One tool button (built once per tool; render() only patches its state, so keyboard focus survives). */
  function toolButton(tool) {
    const b = h('button.tool', { type: 'button', dataset: { tool: tool.id }, on: { click: () => onTool(tool.id) } },
      h('span.ico'), h('span.name'), tool.key ? h('span.key', { 'aria-hidden': 'true' }, String(tool.key)) : null);
    return b;
  }
  const buttons = new Map();         // tool id -> button
  let shownIds = '';

  function render() {
    const state = store.state;
    if (!state) return;
    seedSeen(state);
    const level = levelFromXp(state.farm.xp);
    const t = controller.tool;
    const sn = seen() || { tools: {}, crops: {} };
    const visible = controller.TOOLS.filter((tool) => {
      const def = toolDefFor(tool.id, state);
      return !(def && def.unlock > level);
    });
    const ids = visible.map((x) => x.id).join(',');
    if (ids !== shownIds) {
      shownIds = ids;
      bar.replaceChildren(...visible.map((tool) => {
        if (!buttons.has(tool.id)) buttons.set(tool.id, toolButton(tool));
        return buttons.get(tool.id);
      }));
      requestAnimationFrame?.(paintMore);
    }
    for (const tool of visible) {
      const b = buttons.get(tool.id);
      const def = toolDefFor(tool.id, state);
      const name = def ? def.name : tool.label;
      const label = `${name}${tool.key ? ` (${tool.key})` : ''}`;
      b.setAttribute('aria-pressed', String(t.id === tool.id || (isSeedTool(t.id) && isSeedTool(tool.id))));
      b.setAttribute('aria-label', label);
      b.dataset.tip = `${label}${def && def.text ? `: ${def.text}` : ''}`;
      const ico = b.querySelector('.ico');
      // the Compost Scoop spreading Fertilizer says so (wave 4, wish 2): its picture and name are the Fertilizer's
      const fertOn = TOOL_CONTENT[tool.id] === 'compost_scoop' && t.id === tool.id && t.spread === 'fertilizer';
      const iconId = fertOn ? 'fertilizer' : def ? def.id : null;
      if (ico.dataset.id !== String(iconId)) {
        ico.dataset.id = String(iconId);
        ico.replaceChildren(iconId ? icon(iconId, { size: 44 }) : svgIcon(tool.id === 'hand' ? 'hand' : 'star', 44));
      }
      const nameEl = b.querySelector('.name');
      nameEl.textContent = isSeedTool(tool.id) ? (cropName(t.crop) || 'Seeds') : fertOn ? 'Fertilizer' : shortLabel(def, name);
      // a long name ("Fertilizer", "Strawberry") is set a size smaller so it fits a phone's tool button
      nameEl.classList.toggle('long', nameEl.textContent.length > 8);
      const isNew = !sn.tools?.[tool.id];
      const badge = b.querySelector('.badge');
      if (isNew && !badge) b.append(h('span.badge.badge--new', 'New'));
      else if (!isNew && badge) badge.remove();
    }
    if (seedsOpen) renderSeeds(); else tray.hidden = true;
    renderSpread();
    renderGolden();
    if (level !== lastLevel) lastLevel = level;
    const held = isSeedTool(t.id) ? visible.find((x) => isSeedTool(x.id))?.id : t.id;
    // layout reads only when the tool in hand or the set of tools changed: render runs during a drag stroke (CL-05)
    if (held !== revealed) { revealed = held; revealTool(buttons.get(held)); paintMore(); }
    if (!sized) { sized = true; sizeTrays(); }
  }

  /**
   * A tray is never wider than the toolbar under it (it scrolls, with its arrows): a 10-crop tray used to reach under
   * the docked coach and the dock at 1366 px and less (QA wave 1 UI-09). Logical px: the HUD is zoomed.
   */
  function sizeTrays() {
    const w = bar.offsetWidth;
    if (w > 0) document.getElementById('tray-wrap')?.style.setProperty('--bar-w', `${Math.max(360, w)}px`);
  }

  const cropName = (id) => CONTENT.crops.get(id)?.name ?? null;
  const isSeedTool = (id) => TOOL_CONTENT[id] === 'seed_bag';

  function onTool(id) {
    markSeen('tools', id);
    if (isSeedTool(id)) {
      // the Seed Bag button toggles its tray; picking a seed selects the tool
      if (isSeedTool(controller.tool.id)) { seedsOpen = !seedsOpen; render(); return; }
      seedsOpen = true;
    } else {
      seedsOpen = false;
    }
    controller.setTool(id);
    S.tutorial?.firstUse(TOOL_CONTENT[id] || id);
  }

  function renderSeeds() {
    const state = store.state;
    const rows = seedRows(state);
    const t = controller.tool;
    const sn = seen() || { crops: {} };
    tray.replaceChildren(arrow(-1));
    for (const r of rows) {
      const sel = (isSeedTool(t.id) || t.id === 'hand') && t.crop === r.id;
      const isNew = r.open && !sn.crops?.[r.id];
      const stars = h('span.stars', { 'aria-hidden': 'true' });
      for (let i = 0; i < 3; i++) stars.append(h(i < r.stars ? 'span' : 'span.off', '★'));
      const card = h('button.seed', {
        type: 'button', role: 'option', dataset: { crop: r.id }, 'aria-selected': String(sel), 'aria-disabled': r.open ? null : 'true',
        'aria-label': r.open
          ? `${r.name}: ${fmt(r.seed)} coins a plot, grows in ${fmtDuration(r.growMs)}, sells for ${fmt(r.sell)}, ${r.stars} mastery stars, ${fmt(r.stock)} in the barn`
          : `${r.name}: unlocks at farm level ${r.unlock}`,
        'data-tip': r.open
          ? `${r.name}: plant for ${fmt(r.seed)} coins a plot · ready in ${fmtDuration(r.growMs)} · harvest ${fmt(r.yield)} × ${fmt(r.sell)} coins · ${fmt(r.xp)} XP${r.stock ? ` · ${fmt(r.stock)} in the barn` : ''}`
          : `${r.name} unlocks at farm level ${r.unlock}`,
        on: { click: () => pickSeed(r) },
      },
      icon(r.id, { size: 46 }),
      h('span.nm', r.name),
      // "Plant 2 · 1m" and "Harvest 2 × 2": what a plot costs and what it gives, labelled (QA wave 1 UI-25)
      r.open
        ? [h('span.row', h('b', 'Plant'), icon('coins', { size: 16 }), fmt(r.seed), h('span.sep', '·'), shortTime(r.growMs)),
          h('span.row.give', h('b', 'Harvest'), `${fmt(r.yield)}×`, icon('coins', { size: 16 }), fmt(r.sell)), stars]
        : h('span.lockline', svgIcon('lock', 16), `Level ${r.unlock}`),
      isNew ? h('span.badge.badge--new', 'New') : null);
      tray.append(card);
    }
    tray.append(arrow(1));
    tray.hidden = false;
    requestAnimationFrame(cue);
  }

  // ---- Compost or Fertilizer (wave 4, wish 2): while the Compost Scoop is in hand and the farm makes Fertilizer, a
  // strip over the toolbar picks what it spreads (the controller's `spread` tool option, client lane)
  const spread = h('div.seed-strip.spread-strip', { role: 'toolbar', 'aria-label': 'What the scoop spreads', hidden: true });
  bar.before(spread);
  let spreadKey = '';
  function renderSpread() {
    const st = store.state;
    const t = controller.tool;
    const live = typeof FARMING.fertilizerLive === 'function' && st && FARMING.fertilizerLive(st);
    const show = Boolean(live) && TOOL_CONTENT[t.id] === 'compost_scoop' && Object.hasOwn(t, 'spread');
    if (!show) { spread.hidden = true; spreadKey = ''; return; }
    const F = FARMING.FERTILIZER;
    const n = (id) => (st.farm.inventory[id] || 0) + (st.farm.overflow[id] || 0);
    const cur = t.spread === 'fertilizer' ? 'fertilizer' : 'compost';
    const key = `${cur}|${n('compost')}|${n(F.item)}`;
    spread.hidden = false;
    if (key === spreadKey) return;
    spreadKey = key;
    const chipBtn = (id, label, tip) => h('button.ss-seed.spread-chip', {
      type: 'button', 'aria-pressed': String(cur === id), 'aria-label': `${label}, ${fmt(n(id === 'fertilizer' ? F.item : id))} in the barn`,
      dataset: { spread: id, tip }, on: { click: () => controller.setTool(t.id, { spread: id }) },
    }, icon(id === 'fertilizer' ? F.item : id, { size: 30 }), h('span.spread-n', fmt(n(id === 'fertilizer' ? F.item : id))));
    spread.replaceChildren(h('span.ss-label', { 'aria-hidden': 'true' }, 'Spread'),
      chipBtn('compost', 'Compost', `Compost: +${GROWTH_C.bonusUnits} at harvest and a blue-ribbon chance`),
      chipBtn('fertilizer', 'Fertilizer', `Fertilizer: ${Math.round(F.timeBp / 100)} % sooner and +${F.bonusUnits} at harvest`),
      h('span.spread-what', cur === 'fertilizer' ? 'Fertilizer' : 'Compost'));
  }
  store.subscribe('inventory', renderSpread);

  // ---- the Golden Watering Can (wave 4b, owner wish 2): while the Watering Can is in hand on a farm that owns it, one
  // button over the toolbar waters every growing crop and tree that wants it (the rules' waterAll, predicted)
  const golden = h('div.seed-strip.spread-strip.golden-strip', { role: 'toolbar', 'aria-label': 'Golden Watering Can', hidden: true });
  bar.before(golden);
  let goldenKey = '';
  function renderGolden() {
    const st = store.state;
    const it = useIntent('golden_can');
    const show = Boolean(st && it && st.farm.relics?.golden_can && TOOL_CONTENT[controller.tool.id] === 'watering_can');
    if (!show) { golden.hidden = true; goldenKey = ''; return; }
    golden.hidden = false;
    const code = probe(store, it.type, it.args);
    const key = String(code);
    if (key === goldenKey) return;
    goldenKey = key;
    const art = relicIcon('golden_can', hasIcon);
    const why = code === null ? '' : code === 'NOT_NEEDED' ? 'Everything is watered' : reason(code);
    const btn = h('button.btn.btn--small.btn--sky.golden-go', { type: 'button', disabled: code !== null, dataset: { relicUse: 'golden_can', tip: why || 'Waters every growing crop and tree that wants it' },
      on: { click: () => controller.do(it.type, it.args) } }, 'Water everything');
    golden.replaceChildren(...[icon(art.id, { size: 34, cls: art.gilded ? 'pn-gilded' : '' }), h('span.ss-label', 'Golden Can'), btn,
      why ? h('span.golden-why', why) : null].filter(Boolean));
  }
  store.subscribe('objects', () => { if (!golden.hidden) renderGolden(); });
  store.subscribe('relics', renderGolden);

  // ---- the seed tray's overflow cue (QA wave 1 UI-38): a fading arrow at each end that has more cards ----------
  function arrow(dir) {
    return h(`button.tray-arrow.${dir < 0 ? 'left' : 'right'}`, { type: 'button', tabindex: '-1', hidden: true,
      'aria-label': dir < 0 ? 'More seeds to the left' : 'More seeds to the right',
      on: { click: () => tray.scrollBy({ left: dir * Math.max(120, tray.clientWidth * 0.6), behavior: 'smooth' }) } },
    h('span', { 'aria-hidden': 'true' }, dir < 0 ? '‹' : '›'));
  }
  function cue() {
    const l = tray.querySelector('.tray-arrow.left');
    const r = tray.querySelector('.tray-arrow.right');
    if (!l || !r) return;
    const max = tray.scrollWidth - tray.clientWidth;
    l.hidden = tray.scrollLeft <= 4;
    r.hidden = tray.scrollLeft >= max - 4;
    tray.classList.toggle('scrolls', max > 4);
  }
  tray.addEventListener('scroll', cue, { passive: true });
  // a card that takes the keyboard focus scrolls itself into view: the last seed is reachable without a mouse
  tray.addEventListener('focusin', (e) => { if (e.target.classList?.contains('seed')) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });

  /** The tray state on <body> (layout: the coach docks beside the toolbar, the feed steps aside; UI-07, UI-09). */
  const wrap = document.getElementById('tray-wrap');
  function syncTrayState() {
    const open = !tray.hidden || !btray.hidden;
    document.body.classList.toggle('tray-open', open);
    if (!open || !wrap) return;
    const scale = (S.settings?.scale?.() ?? 100) / 100;
    const w = wrap.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    // logical px (the HUD is zoomed by --ui-scale): the toolbar's inset in the column, the room left of it
    wrap.style.setProperty('--tool-inset', `${Math.max(0, (w.width - b.width) / 2 / scale)}px`);
    wrap.style.setProperty('--coach-w', `${Math.max(200, Math.min(380, (b.left - 16 - 14) / scale))}px`);
  }
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => requestAnimationFrame(syncTrayState));
    for (const el of [tray, btray]) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('resize', () => requestAnimationFrame(() => { syncTrayState(); cue(); }));

  function pickSeed(r) {
    if (!r.open) { ui.toast(`${r.name} unlocks at farm level ${r.unlock}.`, { kind: 'info', icon: r.id }); return; }
    markSeen('crops', r.id);
    if (controller.tool.id === 'hand') {
      // the Smart Hand asked for a seed (an empty plot, no seed chosen): keep the Hand, remember the seed
      controller.setTool('hand', { crop: r.id });
      seedsOpen = false;
      render();
      return;
    }
    const seedTool = controller.TOOLS.find((x) => isSeedTool(x.id));
    controller.setTool(seedTool ? seedTool.id : 'seed', { crop: r.id });
    S.tutorial?.firstUse('seed_bag');
  }

  // ---- the build tray (GDD §7.1 build mode, §2.3 "Grandma's Coop from the build tray"): what waits in
  // farm.storage (free gifts, stored objects) with "Place", plus "Move & rotate" (the Hammer) and the shop
  function renderBuild() {
    const st = store.state;
    if (!st) return;
    const stored = Object.keys(st.farm.storage || {}).sort().filter((d) => (st.farm.storage[d] || 0) > 0 && defOf(d));
    const cards = stored.map((d) => {
      const def = defOf(d);
      const n = st.farm.storage[d];
      return h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: d },
        'aria-label': `Place ${def.name}${n > 1 ? `, ${n} waiting` : ''}. Free`, 'data-tip': `${def.name}: free, it waits in your tray. Click, then click the farm`,
        on: { click: () => placeStored(d) },
      }, icon(d, { size: 46 }), h('span.nm', def.name), h('span.row.free', n > 1 ? `Free · ×${n}` : 'Free · Place'));
    });
    // stored decor can be sold back from here (wish A): the list with what each piece fetches
    if (stored.some((d) => defOf(d)?.kind === 'decor') && ui.panels.has('decorSell')) {
      cards.push(h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: 'sell' }, 'aria-label': 'Sell stored decor',
        'data-tip': 'Sell decor waiting here for a share of its price (Undo for 10 minutes)',
        on: { click: () => { buildOpen = false; btray.hidden = true; S.hud?.renderDock(); ui.panels.open('decorSell'); } },
      }, icon('coins', { size: 46 }), h('span.nm', 'Sell'), h('span.row', 'stored decor')));
    }
    cards.push(h('button.seed.build-card', {
      type: 'button', role: 'menuitem', dataset: { def: 'move' }, 'aria-label': 'Move and rotate things (Hammer)',
      'data-tip': 'Pick up anything on the farm and put it somewhere nicer. Timers keep running',
      on: { click: () => { buildOpen = false; btray.hidden = true; controller.setTool('hammer'); } },
    }, icon('hammer', { size: 46 }), h('span.nm', 'Move'), h('span.row', 'and rotate')));
    // the farmhouse, Market Stand, Well and benches upgrade from here too (wave 4, wish E)
    if (ui.panels.has('upgrades')) {
      cards.push(h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: 'upgrades' }, 'aria-label': 'Upgrade the farmhouse, Market Stand, Well and benches',
        'data-tip': 'Upgrades: a new look for the farmhouse, the Market Stand, the Well and the benches, and a small bonus each',
        on: { click: () => { buildOpen = false; btray.hidden = true; S.hud?.renderDock(); ui.panels.open('upgrades'); } },
      }, icon('farmhouse', { size: 46 }), h('span.nm', 'Upgrade'), h('span.row', 'house, well…')));
    }
    if (ui.panels.has('market')) {
      cards.push(h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: 'shop' }, 'aria-label': 'Buy buildings and decor in the Market',
        on: { click: () => { buildOpen = false; btray.hidden = true; ui.panels.open('market', { tab: 'buildings' }); } },
      }, icon('market_stand', { size: 46 }), h('span.nm', 'Shop'), h('span.row', 'buildings, decor')));
    }
    btray.replaceChildren(...cards);
    btray.hidden = false;
  }
  function placeStored(defId) {
    buildOpen = false;
    btray.hidden = true;
    const ok = typeof controller.place === 'function' ? controller.place(defId) : controller.setTool('hammer', { def: defId });
    if (ok === false) ui.toast("That can't go on the farm right now.", { kind: 'info' });
    S.tutorial?.firstUse('hammer');
  }
  function openBuild(open = !buildOpen) {
    buildOpen = Boolean(open);
    if (buildOpen) { seedsOpen = false; tray.hidden = true; renderBuild(); btray.querySelector('button')?.focus({ preventScroll: true }); }
    else btray.hidden = true;
    S.hud?.renderDock();
  }
  store.subscribe('storage', () => { if (buildOpen) renderBuild(); });
  btray.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); openBuild(false); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cards = [...btray.querySelectorAll('.seed')];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    cards[(i + (e.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length].focus();
  });

  // keyboard inside the tray: arrows move between seed cards
  tray.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cards = [...tray.querySelectorAll('.seed')];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    cards[(i + (e.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length].focus();
  });

  // ---- "Planting Carrot × 14" ------------------------------------------------------------------------------
  let chipT = 0;
  controller.on('stroke', (s) => {
    const c = strokeChip(s);
    if (!c) { if (!s || !s.count || s.active === false || ONCE_VERBS.has(s.verb || s.kind)) chip.hidden = true; return; }
    chip.replaceChildren(...(c.item ? [icon(c.item, { size: 26 })] : []), c.text, h('span.n', `× ${fmt(c.n)}`));
    chip.hidden = false;
    clearTimeout(chipT);
    chipT = setTimeout(() => { chip.hidden = true; }, s.active === false ? 900 : 2500);
  });

  // ---- the Hammer over a placed object: what a click does, plus Pin and Move back (GDD §6.3, QA wave 1 CL-05) -----
  // The hint stays 1.5 s after the cursor leaves the object (and while the pointer is on the hint) so its buttons
  // can be reached; the world tooltip is hover-only.
  const hint = h('div.stroke-chip.hammer-hint', { role: 'status', hidden: true });
  chip.before(hint);
  let hintId = null;
  let hintMw = null;          // the controller's `build.masterwork`: this coin decor can take a Masterwork now
  let hintT = 0;
  let onHint = false;
  // hover intent: on the way from an object to its hint's buttons the pointer crosses other objects (the Barn's "Move
  // back" turned into "Feed Mill: click to move it" under the moving mouse); another object takes the hint over only
  // once the pointer rests on it
  let switchT = 0;
  let pending = null;
  const SWITCH_MS = 450;
  const dropSwitch = () => { clearTimeout(switchT); pending = null; };
  hint.addEventListener('pointerenter', () => { onHint = true; clearTimeout(hintT); dropSwitch(); });
  hint.addEventListener('pointerleave', () => { onHint = false; hideHintSoon(); });
  function hideHintSoon() {
    clearTimeout(hintT);
    hintT = setTimeout(() => { if (!onHint) { hint.hidden = true; hintId = null; shown(); } }, 1500);
  }
  // Ctrl+Z with the Hammer acts on the object this hint names while it shows ("Move back (Ctrl+Z)"), even when the
  // pointer has just left it or is crossing another object on its way to the hint's buttons
  const shown = () => controller.setHint?.(hint.hidden ? null : hintId);
  function renderHint() {
    const st = store.state;
    const o = st && hintId && Object.hasOwn(st.farm.objects, hintId) ? st.farm.objects[hintId] : null;
    const def = o && defOf(o.def);
    if (!def) { hint.hidden = true; hintId = null; shown(); return; }
    const btn = (label, fn, title) => h('button.hint-btn', { type: 'button', title, on: { click: (ev) => { ev.stopPropagation(); fn(); renderHint(); } } }, label);
    // a phone has no Del key: its ⟳ ✕ ✓ bar carries a "Put it away" button while the piece is held (mobile QA M-06)
    const touch = touchPlayer(controller);
    // only decor goes back into the tray; buildings, homes, trees, plots and the Homestead's landmarks just move
    const storable = def.kind === 'decor' && o.mw === undefined;
    const parts = [icon(o.def, { size: 26 }), h('span', touch ? `${def.name}: tap to move it`
      : `${def.name}: click to move it${storable ? ' · Del puts it away' : ''}`)];
    if (def.kind === 'decor' && typeof controller.pin === 'function') {
      const mine = o.pin === store.pid;
      const theirs = o.pin !== undefined && !mine;
      parts.push(theirs ? h('span.hint-pin', `Pinned by ${st.players[o.pin]?.name || 'your partner'}`)
        : btn(mine ? 'Unpin' : 'Pin', () => controller.pin(hintId, !mine), mine ? 'Take your pin out' : 'Pin it: moving it asks you first'));
    }
    // ↻ turns it a quarter where it stands (wish C): the client's controller.rotate(id) (also R over it), else the
    // rules' rotateSpot sent as a move
    if (canTurn(hintId, def)) {
      const id = hintId;
      parts.push(btn(touch ? '↻ Rotate' : '↻ Rotate (R)', () => turnObject(id), 'Turn it a quarter where it stands'));
    }
    if (typeof controller.canMoveBack === 'function' && controller.canMoveBack(hintId)) {
      const id = hintId;
      parts.push(btn(touch ? 'Move back' : 'Move back (Ctrl+Z)', () => controller.moveBack(id), 'Put it back where it stood'));
    }
    // the farmhouse, the Well, the Market Stand and the benches have upgrades (wish E): the tier and the way in
    const target = typeof UPG.upgradeTargetOf === 'function' ? UPG.upgradeTargetOf(o.def) : null;
    const tiers = target ? UPG.UPGRADES?.[target]?.tiers?.length ?? 0 : 0;
    if (tiers && ui.panels.has('upgrades')) {
      const id = hintId;
      const n = typeof UPG.tierOf === 'function' ? UPG.tierOf(o) : 0;
      parts.push(btn(n >= tiers ? `Upgrades ★${n}` : `Upgrade · ${n}/${tiers}`, () => ui.panels.open('upgrades', { id }),
        n >= tiers ? 'Every upgrade is done' : 'See its upgrades: a new look and a small bonus'));
    }
    // decor sells back for a share of its price (wish A), with a 10-minute Undo
    if (storable && ui.panels.has('decorSell')) {
      const id = hintId;
      parts.push(btn('Sell…', () => flows().then((m) => m.sellPlaced(S, id)).catch((err) => console.error('sell', err)),
        'Sell it back for a share of its price (Undo for 10 minutes)'));
    }
    // Masterwork (GDD §3.8): the workshop opens on this very piece
    if (hintMw && hintMw === hintId && S.ui?.panels?.has?.('decorsets')) {
      const id = hintId;
      parts.push(btn('Masterwork', () => S.ui.panels.open('decorsets', { tab: 'masterwork', id }),
        'Upgrade this piece: a stone or gilded border and more Farm Beauty'));
    }
    hint.replaceChildren(...parts);
    hint.hidden = false;
    shown();
  }
  // ---- while something is carried (bought, from the tray, or moved): what is in hand, ↻ Rotate and Cancel (wish C).
  // A touch player has the ⟳ ✕ ✓ bar under the ghost instead (game/touch-build.js)
  let carryKey = '';
  function carryOf(e) {
    if (!e || e.pickUp || !e.def || (!e.moveId && e.def === 'plot') || touchPlayer(controller)) return null;
    return { def: e.def, moveId: e.moveId ?? null, rot: e.rot ?? 0 };
  }
  function showCarry(c) {
    const key = `${c.def}|${c.moveId}`;
    if (key === carryKey && !hint.hidden) return;
    carryKey = key;
    clearTimeout(hintT);
    dropSwitch();
    hintId = null;
    shown();
    const name = defOf(c.def)?.name ?? 'it';
    const btn = (label, fn, title) => h('button.hint-btn', { type: 'button', title, on: { click: (ev) => { ev.stopPropagation(); fn(); } } }, label);
    hint.replaceChildren(icon(c.def, { size: 26 }), h('span', `${c.moveId ? 'Moving' : 'Placing'} the ${name}`),
      btn('↻ Rotate (R)', () => controller.rotate(), 'Turn it a quarter'),
      btn('Cancel (Esc)', () => controller.cancel?.(), c.moveId ? 'Leave it where it was' : 'Put it back'));
    hint.classList.add('carry');
    hint.hidden = false;
  }
  function hideCarry() {
    carryKey = '';
    hint.classList.remove('carry');
    hint.hidden = true;
  }
  /** The Hammer hint offers ↻ for anything that moves (debris and animals never do; the controller knows best). */
  function canTurn(id, def) {
    if (!def || def.movable === false || def.kind === 'debris' || def.layer === 'none') return false;
    if (typeof controller.canRotate === 'function') return Boolean(controller.canRotate(id));
    return true;
  }
  function turnObject(id) {
    if (typeof controller.rotateObject === 'function') return controller.rotateObject(id);
    if (typeof controller.canRotate === 'function') return controller.rotate(id);
    return flows().then((m) => m.rotatePlaced(S, id)).catch((err) => console.error('rotate', err));
  }

  controller.on('build', (e) => {
    const carry = carryOf(e);
    if (carry) { showCarry(carry); return; }
    if (carryKey) hideCarry();
    if (e && e.pickUp) {
      clearTimeout(hintT);
      const mw = e.masterwork ?? null;
      if (!hint.hidden && hintId && e.pickUp !== hintId) {
        if (pending?.id !== e.pickUp) {
          dropSwitch();
          pending = { id: e.pickUp, mw, over: controller.hover?.id ?? null };
          switchT = setTimeout(() => {
            // still resting on that object (not gone on to the hint or off the farm meanwhile)
            if (!pending || onHint || (controller.hover?.id ?? null) !== pending.over) { pending = null; return; }
            hintId = pending.id; hintMw = pending.mw; pending = null;
            renderHint();
          }, SWITCH_MS);
        }
        return;
      }
      dropSwitch();
      if (e.pickUp !== hintId || hint.hidden || mw !== hintMw) { hintId = e.pickUp; hintMw = mw; renderHint(); }
    } else if (hintId) { dropSwitch(); hideHintSoon(); }
  });
  store.on('change', (ch) => { if (hintId && !hint.hidden && (ch.ids.has(hintId) || ch.topics.has('*'))) renderHint(); });

  controller.on('tool', (t) => {
    if (!isSeedTool(t.id)) seedsOpen = false;
    if (t.id !== 'hammer') { hint.hidden = true; hintId = null; dropSwitch(); shown(); }
    render();
  });
  store.subscribe('xp', render);
  store.subscribe('tools', render);
  store.subscribe('mastery', () => { if (seedsOpen) renderSeeds(); });
  store.subscribe('inventory', () => { if (seedsOpen) renderSeeds(); });
  // a click on the farm closes the seed tray (the chosen seed stays)
  document.getElementById('world').addEventListener('pointerdown', () => {
    if (seedsOpen) { seedsOpen = false; tray.hidden = true; }
    if (buildOpen) { buildOpen = false; btray.hidden = true; S.hud?.renderDock(); }
  });

  return {
    render,
    openSeeds(open = true) { seedsOpen = Boolean(open); if (seedsOpen) { buildOpen = false; btray.hidden = true; } render(); },
    openBuild,
    get buildOpen() { return buildOpen; },
    toolDef: (id) => toolDefFor(id, store.state),
  };
}
