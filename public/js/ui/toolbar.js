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
import { h, icon, svgIcon, fmt, fmtDuration, kv, touchPlayer, touchText, fitLabel } from './dom.js';
import { t as tr, tn, lang, onLang, N, name as cname, nameEntry, ctext } from '../i18n/index.js';
import { LAYOUT_Q } from './layout.js';
import { lazyImport } from '../net/lazy.js';

/** A tool button's label longer than this many letters is set a size smaller (the 1366 BG shots: "Пшеница" spilled). */
const LONG_NAME = 6;

/** Wave 4 (wishes A, C, E): the Hammer hint's Sell, Rotate and Upgrade flows live in a module loaded on first use. */
const flows = () => lazyImport('w4-flows', () => import('./panels/w4-flows.js'));

/** A red placement ghost's words (S7): its blocker, else the spot's reason (QA r4 S4-06, S4-12: land not ours). Pure. */
export function placeWhy(e) {
  if (!e || e.valid !== false || e.pickUp) return '';
  return e.blockerDef && defOf(e.blockerDef) ? tr('dock.why.blocked', { thing: N(e.blockerDef) }) : e.code ? reason(e.code) : '';
}

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
// values are catalog keys ('toolbar.short.*', 'toolbar.verb.*'), read when the label is drawn
const SHORT = Object.freeze({ seed_bag: 'seeds', watering_can: 'water', feed_scoop: 'feed', compost_scoop: 'compost',
  big_watering_can: 'water', wide_sickle: 'sickle', basket: 'basket' });
const STROKE_VERB = { plant: 'plant', goldenPlant: 'plant', harvest: 'harvest', water: 'water', tend: 'tend',
  collect: 'collect', pet: 'pet', fertilize: 'fertilize', shake: 'pick', pick: 'pick', clear: 'clear',
  compost: 'compost', uproot: 'uproot', chop: 'chop', feed: 'feed', collectTray: 'collect',
  bottle: 'bottle', nurse: 'nurse', weed: 'weed' };

/**
 * The "Planting Carrot × 14" chip of a drag stroke: { item, text, n }, or null when there is none to show. A one-press
 * action (a crate, a ride, a Giant's chop) has its own card or effect, so it gets no chip (wave-4b verifier: a crate
 * showed "nullPainting × 1").
 */
export function strokeChip(s) {
  if (!s || !s.count) return null;
  const verb = s.verb || s.kind;
  if (ONCE_VERBS.has(verb)) return null;
  const fam = !s.item ? null : CONTENT.crops.get(s.item) ? 'crops' : CONTENT.items.get(s.item) ? 'items' : CONTENT.animals.get(s.item) ? 'animals' : null;
  const vb = STROKE_VERB[verb] ? tr(`toolbar.verb.${STROKE_VERB[verb]}`) : '';
  // "Planting Carrot" / "Засаждане: морков"
  const text = !s.item ? vb : !vb ? (fam ? cname(s.item, { family: fam }) : s.item)
    : tr('toolbar.stroke', { verb: vb, what: fam ? N(s.item, fam) : s.item });
  return { item: s.item || null, text: text.trim(), n: s.count };
}

export function shortLabel(def, fallback = '') {
  if (!def) return fallback;
  // the content names table carries every tool's Bulgarian toolbar word (`short`, at most 8 letters)
  const e = lang() !== 'en' ? nameEntry(def.id, 'tools') : null;
  if (e) return e.short ?? e.name;
  if (typeof def.short === 'string' && def.short) return def.short;
  if (SHORT[def.id]) return tr(`toolbar.short.${SHORT[def.id]}`);
  if (def.upgrades && SHORT[def.upgrades]) return tr(`toolbar.short.${SHORT[def.upgrades]}`);
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
    if (c.retired) continue;                 // a helper's crop taken back: not for sale (Harness Hollow)
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

/**
 * The free buildings this level can place that the farm has none of yet, not waiting in storage (QA r2 S-01, fbp#1,
 * jde#3): Grandma's Windmill comes at level 3 as a free shop building, and the coach's "Make Flour together" pointed
 * at nothing while it hid in Market > Buildings. The build tray offers them as "Free · Place" cards like the Coop.
 * Pure.
 */
export function freeToPlace(state) {
  if (!state?.farm) return [];
  const level = levelFromXp(state.farm.xp);
  const objs = Object.values(state.farm.objects ?? {});
  const out = [];
  for (const fam of [CONTENT.homes, CONTENT.buildings]) {
    for (const d of fam?.values?.() ?? []) {
      if (!d.shop || d.retired || d.cost !== 0 || (d.acorns ?? 0) > 0 || (d.unlock ?? 1) > level) continue;
      if ((state.farm.storage?.[d.id] ?? 0) > 0 || objs.some((o) => o.def === d.id)) continue;
      out.push(d.id);
    }
  }
  return out.sort();
}

/** "1m", "45m", "2h", "1h 30m" (Bulgarian "1 мин", "2 ч 30 мин"): the seed tray's short grow time. Pure. */
export function shortTime(ms) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return tr('toolbar.time.m', { m });
  const hr = Math.floor(m / 60);
  return m % 60 ? tr('toolbar.time.hm', { h: hr, m: m % 60 }) : tr('toolbar.time.h', { h: hr });
}

export function createToolbar(S) {
  const { store, controller, ui } = S;
  const bar = document.getElementById('toolbar');
  // qa2 CL-05: offsetWidth on every render forced a layout per predicted change of a drag stroke; the bar is measured
  // once, then whenever it changes size
  let sized = false;
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { sizeTrays(); refit(); }).observe(bar);
  else window.addEventListener('resize', () => sizeTrays());
  /** The bar changed size, or the fonts arrived: the phone's shrunk names are measured again (QA r1 S-07). */
  function refit() {
    for (const n of document.querySelectorAll('#toolbar .tool .name, #tools-flyout .tool .name')) {
      delete n.dataset.fit;
      if (isPhone()) fitLabel(n); else n.style.fontSize = '';
    }
  }
  document.fonts?.ready?.then?.(() => refit());
  const tray = document.getElementById('seed-tray');
  const chip = document.getElementById('stroke-chip');
  const btray = document.getElementById('build-tray');
  let buildOpen = false;
  let seedsOpen = false;
  let lastLevel = 0;

  // ---- the toolbar of 3 (release 1.0 S2, ux-first#5, #13): [Hand] [Seeds ▸] [Tools ▸]; the Sickle, Water, Feed, Basket,
  // Compost and Axe live in the Tools flyout (keys 3-8 unchanged), the Hammer left the bar (key 9 and the build tray's
  // Move card pick it up). A phone (S3) keeps ONE slot: the tool in hand; a tap pops up every tool and Build.
  // Flyouts open and close by keyboard: Enter / Space on the slot, arrows inside, Escape back to the slot (P9).
  const phoneMq = globalThis.matchMedia?.(LAYOUT_Q.phone) ?? null;
  const isPhone = () => Boolean(phoneMq?.matches);
  const GROUP = new Set(['sickle', 'watering_can', 'feed_scoop', 'basket', 'compost_scoop', 'axe']);
  let toolsFly = false;            // the Tools flyout (desktop)
  let popOpen = false;             // the phone's tool pop-up
  let seedFly = false;             // the crop strip above the Seeds slot (seeds.js shows it while this is true)
  let lastGroupTool = 'sickle';
  // a group of toggle buttons (aria-pressed), not a menu: a menuitem may not be pressed (axe, P9 audit)
  const fly = h('div.tool-flyout#tools-flyout', { role: 'group', hidden: true });
  bar.before(fly);
  const flyCaret = h('i.fly-caret', { 'aria-hidden': 'true' });
  /** The tool flyout's caret points at the slot it opened from. */
  function caretAt(slot) {
    if (!slot || !slot.isConnected) return;
    const s0 = slot.getBoundingClientRect();
    const f = fly.getBoundingClientRect();
    const scale = (S.settings?.scale?.() ?? 100) / 100;
    if (f.width) fly.style.setProperty('--caret-x', `${Math.round((s0.left + s0.width / 2 - f.left) / scale)}px`);
  }
  function closeFlyouts({ focus = false } = {}) {
    const was = toolsFly || popOpen;
    toolsFly = false;
    popOpen = false;
    fly.hidden = true;
    fly.replaceChildren();
    for (const b of bar.querySelectorAll('[data-slot]')) b.setAttribute('aria-expanded', 'false');
    if (was && focus) bar.querySelector('[data-slot="tools"], [data-slot="tool"]')?.focus({ preventScroll: true });
    syncSoon();
  }
  function setSeedFly(open) {
    if (seedFly === Boolean(open)) return;
    seedFly = Boolean(open);
    bar.querySelector('[data-tool="seed_bag"]')?.setAttribute('aria-expanded', String(seedFly));
    S.seeds?.renderStrip?.();
    // the strip sits before the bar in the page: it takes the focus, so Tab and the arrows work inside it (P9 audit)
    if (seedFly) {
      const strip = document.querySelector('#tray-wrap > .seed-strip:not(.spread-strip)');
      (strip?.querySelector('[aria-pressed="true"]') ?? strip?.querySelector('button'))?.focus({ preventScroll: true });
    }
    syncSoon();
  }
  // Escape closes an open flyout, pop-up or crop strip wherever the focus is (P9 audit: from the slot it did nothing);
  // it stops there, so the same key does not also put the tool in hand away (the controller's Escape)
  document.addEventListener('keydown', (e) => {
    // (the full seed tray, opened by the picker's "⋯" or ui.openSeeds, closes the same way: the integrator's P9 run;
    // the build tray too, wherever the focus is: a double click on Build left the focus on Build, QA r2 S-11, br#5)
    if (e.key !== 'Escape' || e.defaultPrevented || !(toolsFly || popOpen || seedFly || seedsOpen || buildOpen)) return;
    if (typeof ui?.panels?.top === 'function' && ui.panels.top()) return;
    e.preventDefault();
    e.stopPropagation();
    if (buildOpen) {
      openBuild(false);
      const door = document.querySelector('[data-dock="build"]');
      if (door?.getClientRects?.().length) door.focus({ preventScroll: true });
      return;
    }
    const strip = seedFly || seedsOpen;
    if (seedsOpen) { seedsOpen = false; tray.hidden = true; }
    closeFlyouts({ focus: !strip });
    setSeedFly(false);
    if (strip) bar.querySelector('[data-tool="seed_bag"]')?.focus({ preventScroll: true });
  }, true);
  // a panel coming up puts away whatever was open over the toolbar (QA r2 S-11, oib#3: the phone's tool pop-up stayed
  // open under the Market sheet and covered 240 px of the farm after its ✕; the build tray stayed under every panel)
  ui?.panels?.on?.('open', () => {
    if (toolsFly || popOpen) closeFlyouts();
    if (seedFly) setSeedFly(false);
    if (seedsOpen) { seedsOpen = false; tray.hidden = true; }
    if (buildOpen) openBuild(false);
  });
  // a press anywhere else on the HUD puts the flyouts away as well (QA r3 S3-19, oib#5: the phone's tool pop-up stayed
  // open behind the Goal Tracker's opened list, which is no panel, and a HUD tap is no farm tap); a press on the bar
  // itself is the slots' own business (a slot toggles its flyout on its click)
  document.addEventListener('pointerdown', (e) => {
    if (!(toolsFly || popOpen || seedFly)) return;
    const el = e.target;
    if (!el?.closest?.('#hud') || el.closest('#toolbar, #tools-flyout, .seed-strip, .hs-pair')) return;
    if (toolsFly || popOpen) closeFlyouts();
    if (seedFly) setSeedFly(false);
  }, true);
  // the Goal Tracker's list opened by the keyboard (Enter on the NOW chip: no press) says so with a window event
  // (features' ui/tracker.js `tracker-open`, S3-19): the flyouts go then too
  globalThis.addEventListener?.('tracker-open', () => {
    if (toolsFly || popOpen) closeFlyouts();
    if (seedFly) setSeedFly(false);
  });
  fly.addEventListener('keydown', (e) => {
    const items = [...fly.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFlyouts({ focus: true }); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });
  const syncSoon = () => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => syncTrayState()) : null);

  // (HEAD's sideways scroller of nine tools on phones is gone with the one-slot bar; the chevron stays, never shown)
  const more = h('button.tool-more', { type: 'button', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  document.getElementById('tray-wrap')?.append(more);
  function paintMore() { more.hidden = true; }

  const seenKey = () => `hh.seen.${store.pid}`;
  const seen = () => kv.get(seenKey(), null);
  function markSeen(kind, id) {
    const s0 = seen() || { tools: {}, crops: {} };
    s0[kind] = s0[kind] || {};
    if (s0[kind][id]) return;
    s0[kind][id] = 1;
    kv.set(seenKey(), s0);
  }
  /** On the very first render everything visible counts as seen: "New!" is for what arrives later. */
  function seedSeen(state) {
    if (seen()) return;
    const level = levelFromXp(state.farm.xp);
    const s0 = { tools: {}, crops: {} };
    for (const t of controller.TOOLS) s0.tools[t.id] = 1;
    for (const c of live('crops')) if (c.unlock <= level) s0.crops[c.id] = 1;
    kv.set(seenKey(), s0);
  }

  /** One tool button (built once per tool; render() only patches its state, so keyboard focus survives). */
  function toolButton(tool) {
    return h('button.tool', { type: 'button', dataset: { tool: tool.id }, on: { click: () => onTool(tool.id) } },
      h('span.ico'), h('span.name'), tool.key ? h('span.key', { 'aria-hidden': 'true' }, String(tool.key)) : null);
  }
  const buttons = new Map();         // tool id -> button
  const chev = (dir = 'up') => h('span.chev', { 'aria-hidden': 'true' }, dir === 'up' ? '▴' : '▸');
  // the Tools slot (desktop) and the phone's current-tool slot: a button of their own, never a tool's button
  const toolsSlot = h('button.tool.tool-slot', { type: 'button', dataset: { slot: 'tools' }, 'aria-expanded': 'false',
    'aria-controls': 'tools-flyout', on: { click: () => toggleTools() } }, h('span.ico'), h('span.name'), chev());
  const curSlot = h('button.tool.tool-slot.tool-cur', { type: 'button', dataset: { slot: 'tool' }, 'aria-expanded': 'false',
    'aria-controls': 'tools-flyout', on: { click: () => togglePop() } }, h('span.ico'), h('span.name'), chev());
  // Build in the phone's pop-up (the phone bar has no Build button: S3)
  const buildItem = h('button.tool.tool-build', { type: 'button', dataset: { act: 'build' },
    on: { click: () => { closeFlyouts(); openBuild(true); } } }, h('span.ico', icon('hammer', { size: 44 })), h('span.name'));
  let shownIds = '';

  /** Paint a tool's look into a button: its icon, its short word, pressed, the New badge. */
  function paintTool(b, tool, state, t, sn) {
    const def = toolDefFor(tool.id, state);
    const name = def ? cname(def.id, { family: 'tools' }) : tool.label;
    const touch = touchPlayer(controller);
    const label = `${name}${tool.key && !touch ? ` (${tool.key})` : ''}`;
    b.setAttribute('aria-pressed', String(t.id === tool.id || (isSeedTool(t.id) && isSeedTool(tool.id))));
    b.setAttribute('aria-label', label);
    const desc = def && def.text ? ctext('tools', def.id, 'desc', def.text) : '';
    b.dataset.tip = `${label}${desc ? `: ${desc}` : ''}`;
    // a finger has no number keys and no Shift: its tip leaves the key out and says the touch words of the text
    b.dataset.tipTouch = `${name}${desc ? `: ${touchText(desc, true)}` : ''}`;
    const ico = b.querySelector('.ico');
    // the Compost Scoop spreading Fertilizer says so (wave 4, wish 2): its picture and name are the Fertilizer's
    const fertOn = TOOL_CONTENT[tool.id] === 'compost_scoop' && t.id === tool.id && t.spread === 'fertilizer';
    // the Hand armed with a seed (release 1.0 M2): the seed rides on its picture
    const armed = tool.id === 'hand' && t.id === 'hand' && t.seeding && t.crop;
    const iconId = fertOn ? 'fertilizer' : def ? def.id : null;
    const key = `${iconId}|${armed ? t.crop : ''}`;
    if (ico.dataset.id !== key) {
      ico.dataset.id = key;
      ico.replaceChildren(iconId ? icon(iconId, { size: 44 }) : svgIcon(tool.id === 'hand' ? 'hand' : 'star', 44),
        armed ? h('span.crop-on', icon(t.crop, { size: 26 })) : '');
    }
    const nameEl = b.querySelector('.name');
    nameEl.textContent = isSeedTool(tool.id) ? (isSeedTool(t.id) ? cropName(t.crop) || tr('toolbar.short.seeds') : tr('toolbar.short.seeds'))
      : armed ? cropName(t.crop) || shortLabel(def, name) : fertOn ? tr('toolbar.fertilizer') : shortLabel(def, name);
    // a long name ("Fertilizer", "Strawberry", "Пшеница" in bold on the Hand) is set a size smaller so it fits the button
    nameEl.classList.toggle('long', nameEl.textContent.length > LONG_NAME);
    // on a phone the slot is narrower: a name still too long shrinks to what it holds (QA r1 S-07; measured once per text)
    if (isPhone()) fitLabel(nameEl);
    b.classList.toggle('armed', Boolean(armed));
    const isNew = !sn.tools?.[tool.id];
    const badge = b.querySelector('.badge');
    if (isNew && !badge) b.append(h('span.badge.badge--new', tr('toolbar.new')));
    else if (!isNew && badge) badge.remove();
  }

  function render() {
    const state = store.state;
    if (!state) return;
    seedSeen(state);
    const level = levelFromXp(state.farm.xp);
    const t = controller.tool;
    const sn = seen() || { tools: {}, crops: {} };
    // a language switch re-labels every button (the key below changes with the language)
    if (shownLang !== lang()) { shownLang = lang(); for (const b of buttons.values()) b.querySelector('.badge')?.remove(); }
    const visible = controller.TOOLS.filter((tool) => {
      const def = toolDefFor(tool.id, state);
      return !(def && def.unlock > level);
    });
    for (const tool of visible) if (!buttons.has(tool.id)) buttons.set(tool.id, toolButton(tool));
    if (GROUP.has(t.id)) lastGroupTool = t.id;
    const phone = isPhone();
    const group = visible.filter((x) => GROUP.has(x.id));
    const ids = `${phone ? 'p' : 'd'}|${visible.map((x) => x.id).join(',')}`;
    if (ids !== shownIds) {
      shownIds = ids;
      closeFlyouts();
      if (phone) bar.replaceChildren(curSlot);
      else bar.replaceChildren(...['hand', 'seed_bag'].map((id) => buttons.get(id)).filter(Boolean), ...(group.length ? [toolsSlot] : []));
    }
    for (const tool of visible) paintTool(buttons.get(tool.id), tool, state, t, sn);
    for (const b of buttons.values()) if (b.dataset.tool === 'seed_bag') b.setAttribute('aria-expanded', String(seedFly));
    if (!phone) {
      // the Tools slot shows the tool in hand from its group, else the last one used (a Sickle on a new farm)
      const inHand = GROUP.has(t.id);
      const showId = group.some((x) => x.id === lastGroupTool) ? lastGroupTool : group[0]?.id;
      const tool = group.find((x) => x.id === showId);
      if (tool) {
        const def = toolDefFor(tool.id, state);
        const ico = toolsSlot.querySelector('.ico');
        if (ico.dataset.id !== def?.id) { ico.dataset.id = def?.id ?? ''; ico.replaceChildren(icon(def?.id ?? tool.id, { size: 44 })); }
        const slotName = toolsSlot.querySelector('.name');
        slotName.textContent = inHand ? shortLabel(def, tool.label) : tr('dock.tools.slot');
        slotName.classList.toggle('long', slotName.textContent.length > LONG_NAME);
        toolsSlot.setAttribute('aria-pressed', String(inHand));
        toolsSlot.setAttribute('aria-label', inHand ? tr('dock.tools.labelIn', { tool: cname(def.id, { family: 'tools' }) }) : tr('dock.tools.label'));
        toolsSlot.dataset.tip = tr('dock.tools.tip');
        toolsSlot.classList.toggle('has-new', group.some((x) => !sn.tools?.[x.id]));
      }
    } else {
      // the phone's one slot: the tool in hand (the Hammer counts as Build)
      const cur = visible.find((x) => x.id === t.id || (isSeedTool(t.id) && isSeedTool(x.id))) || visible[0];
      if (cur) {
        const ico = curSlot.querySelector('.ico');
        const proxy = buttons.get(cur.id);
        paintTool(proxy, cur, state, t, sn);
        ico.replaceChildren(...[...proxy.querySelector('.ico').childNodes].map((n) => n.cloneNode(true)));
        curSlot.querySelector('.name').textContent = proxy.querySelector('.name').textContent;
        curSlot.querySelector('.name').classList.toggle('long', proxy.querySelector('.name').classList.contains('long'));
        fitLabel(curSlot.querySelector('.name'));
        curSlot.setAttribute('aria-label', tr('dock.tools.curLabel', { tool: proxy.getAttribute('aria-label') }));
        curSlot.setAttribute('aria-pressed', 'true');
      }
    }
    if (toolsFly || popOpen) renderFly();
    if (seedsOpen) renderSeeds(); else tray.hidden = true;
    renderSpread();
    renderGolden();
    if (level !== lastLevel) lastLevel = level;
    if (!sized) { sized = true; sizeTrays(); }
  }

  /** The flyout's buttons: the group's tools (desktop), or every tool and Build (phone). */
  function renderFly() {
    const state = store.state;
    const t = controller.tool;
    const sn = seen() || { tools: {}, crops: {} };
    const level = levelFromXp(state.farm.xp);
    const visible = controller.TOOLS.filter((tool) => { const def = toolDefFor(tool.id, state); return !(def && def.unlock > level); });
    const list = popOpen ? visible.filter((x) => x.id !== 'hammer') : visible.filter((x) => GROUP.has(x.id));
    for (const tool of list) {
      const b = buttons.get(tool.id);
      paintTool(b, tool, state, t, sn);
      b.removeAttribute('role');   // a toggle button (aria-pressed) in a group, not a menu item (P9 audit)
    }
    buildItem.querySelector('.name').textContent = tr('hud.dock.build');
    buildItem.setAttribute('aria-label', tr('hud.dock.build'));
    fly.classList.toggle('tool-pop', popOpen);
    fly.setAttribute('aria-label', popOpen ? tr('dock.tools.popLabel') : tr('dock.tools.label'));
    fly.replaceChildren(...list.map((x) => buttons.get(x.id)), ...(popOpen ? [buildItem] : []), flyCaret);
    fly.hidden = false;
  }
  function toggleTools(open = !toolsFly) {
    if (!open) { closeFlyouts(); return; }
    setSeedFly(false);
    toolsFly = true;
    popOpen = false;
    toolsSlot.setAttribute('aria-expanded', 'true');
    renderFly();
    caretAt(toolsSlot);
    fly.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }) ?? fly.querySelector('button')?.focus({ preventScroll: true });
    syncSoon();
  }
  function togglePop(open = !popOpen) {
    if (!open) { closeFlyouts(); return; }
    setSeedFly(false);
    if (buildOpen) openBuild(false);
    popOpen = true;
    toolsFly = false;
    curSlot.setAttribute('aria-expanded', 'true');
    renderFly();
    caretAt(curSlot);
    // the pop-up sits before the bar in the page: Tab from the slot would never reach it (P9 audit), so it takes the focus
    fly.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }) ?? fly.querySelector('button')?.focus({ preventScroll: true });
    syncSoon();
  }
  phoneMq?.addEventListener?.('change', () => { shownIds = ''; closeFlyouts(); render(); });
  /** The element a pointer should show for a tool now (the tool's own button, or the slot that holds it). */
  function slotOf(id) {
    const b = buttons.get(id) || [...buttons.values()].find((x) => TOOL_CONTENT[x.dataset.tool] === TOOL_CONTENT[id]);
    if (b && b.isConnected && b.getClientRects().length) return b;
    if (isPhone()) return curSlot;
    return GROUP.has(TOOL_CONTENT[id] ?? id) ? toolsSlot : b ?? null;
  }

  /**
   * A tray is never wider than the toolbar under it (it scrolls, with its arrows): a 10-crop tray used to reach under
   * the docked coach and the dock at 1366 px and less (QA wave 1 UI-09). Logical px: the HUD is zoomed.
   */
  function sizeTrays() {
    const w = bar.offsetWidth;
    if (w > 0) document.getElementById('tray-wrap')?.style.setProperty('--bar-w', `${Math.max(360, w)}px`);
  }

  // the seed's toolbar word: its short form ("Тръстика" for "Захарна тръстика")
  const cropName = (id) => (CONTENT.crops.get(id) ? cname(id, { form: 'short', family: 'crops' }) : null);
  let shownLang = lang();
  const isSeedTool = (id) => TOOL_CONTENT[id] === 'seed_bag';

  function onTool(id) {
    markSeen('tools', id);
    // a pick in the Tools flyout (or the phone's pop-up) gives the focus back to its slot: it fell to <body> and the next
    // Tab started over at the Hand (QA r2 S-14, ap#1)
    closeFlyouts({ focus: true });
    if (isSeedTool(id)) {
      // the Seeds slot opens its crop strip; with the Seed Bag in hand a second press puts the strip away
      if (isSeedTool(controller.tool.id)) { setSeedFly(!seedFly); render(); return; }
      controller.setTool(id);
      setSeedFly(true);
    } else {
      setSeedFly(false);
      seedsOpen = false;
      // the armed Hand pressed again puts its seed away: the next empty plot asks which seed
      controller.setTool(id);
    }
    S.tutorial?.firstUse(TOOL_CONTENT[id] || id);
  }

  function renderSeeds() {
    const state = store.state;
    const now = store.now?.() ?? Date.now();
    // the price this farmer pays (mastery, perks), the one `plant` charges, not the base table's (QA r1 F-02)
    const rows = seedRows(state).map((r) => (r.open ? { ...r, seed: FARMING.plantPreview(state, r.id, null, store.pid, now).price } : r));
    const t = controller.tool;
    const sn = seen() || { crops: {} };
    tray.replaceChildren(arrow(-1));
    for (const r of rows) {
      const sel = (isSeedTool(t.id) || t.id === 'hand') && t.crop === r.id;
      const isNew = r.open && !sn.crops?.[r.id];
      const stars = h('span.stars', { 'aria-hidden': 'true' });
      for (let i = 0; i < 3; i++) stars.append(h(i < r.stars ? 'span' : 'span.off', '★'));
      const card = h('button.seed', {
        type: 'button', dataset: { crop: r.id }, 'aria-pressed': String(sel), 'aria-disabled': r.open ? null : 'true',
        'aria-label': r.open
          ? tr('toolbar.seed.label', { name: N(r.id, 'crops'), seed: r.seed, d: fmtDuration(r.growMs, { trim: true }), sell: r.sell, stars: r.stars, stock: r.stock })
          : tr('toolbar.seed.lockedLabel', { name: N(r.id, 'crops'), level: r.unlock }),
        'data-tip': r.open
          ? tr(r.stock ? 'toolbar.seed.tipStock' : 'toolbar.seed.tip', { name: N(r.id, 'crops'), seed: r.seed, d: fmtDuration(r.growMs, { trim: true }), yield: r.yield,
            sell: r.sell, xp: r.xp, stock: r.stock })
          : tr('toolbar.seed.locked', { name: N(r.id, 'crops'), level: r.unlock }),
        on: { click: () => pickSeed(r) },
      },
      icon(r.id, { size: 46 }),
      // how many the barn holds already (owner 2026-10-11: "show when planting how much we have in the barn"); none: no
      // badge (a bare "0" read as "0 seeds", release 1.0 M28)
      r.open && r.stock ? h('span.stock', { 'aria-hidden': 'true', title: tr('toolbar.seed.inBarn', { n: r.stock }) },
        icon('barn', { size: 16 }), fmt(r.stock)) : null,
      h('span.nm', cname(r.id, { family: 'crops' })),
      // "Plant 2 · 1m" and "Harvest 2 × 2": what a plot costs and what it gives, labelled (QA wave 1 UI-25)
      r.open
        ? [h('span.row', h('b', tr('toolbar.seed.plant')), icon('coins', { size: 16 }), fmt(r.seed), h('span.sep', '·'), shortTime(r.growMs)),
          h('span.row.give', h('b', tr('toolbar.seed.harvest')), `${fmt(r.yield)}×`, icon('coins', { size: 16 }), fmt(r.sell)), stars]
        : h('span.lockline', svgIcon('lock', 16), tr('common.level', { n: r.unlock })),
      isNew ? h('span.badge.badge--new', tr('toolbar.new')) : null);
      tray.append(card);
    }
    tray.append(arrow(1));
    tray.hidden = false;
    requestAnimationFrame(cue);
  }

  // ---- Compost or Fertilizer (wave 4, wish 2): while the Compost Scoop is in hand and the farm makes Fertilizer, a
  // strip over the toolbar picks what it spreads (the controller's `spread` tool option, client lane)
  const spread = h('div.seed-strip.spread-strip', { role: 'toolbar', 'aria-label': tr('toolbar.spread.label'), hidden: true });
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
    const key = `${cur}|${n('compost')}|${n(F.item)}|${lang()}`;
    spread.hidden = false;
    if (key === spreadKey) return;
    spreadKey = key;
    const chipBtn = (id, label, tip) => h('button.ss-seed.spread-chip', {
      type: 'button', 'aria-pressed': String(cur === id), 'aria-label': tr('toolbar.spread.chip', { label, n: n(id === 'fertilizer' ? F.item : id) }),
      dataset: { spread: id, tip }, on: { click: () => controller.setTool(t.id, { spread: id }) },
    }, icon(id === 'fertilizer' ? F.item : id, { size: 30 }), h('span.spread-n', fmt(n(id === 'fertilizer' ? F.item : id))));
    spread.setAttribute('aria-label', tr('toolbar.spread.label'));
    spread.replaceChildren(h('span.ss-label', { 'aria-hidden': 'true' }, tr('toolbar.spread.spread')),
      chipBtn('compost', tr('toolbar.compost'), tr('toolbar.spread.compostTip', { units: GROWTH_C.bonusUnits })),
      chipBtn('fertilizer', tr('toolbar.fertilizer'), tr('toolbar.spread.fertTip', { pct: Math.round(F.timeBp / 100), units: F.bonusUnits })),
      h('span.spread-what', cur === 'fertilizer' ? tr('toolbar.fertilizer') : tr('toolbar.compost')));
  }
  store.subscribe('inventory', renderSpread);

  // ---- the Golden Watering Can (wave 4b, owner wish 2): while the Watering Can is in hand on a farm that owns it, one
  // button over the toolbar waters every growing crop and tree that wants it (the rules' waterAll, predicted)
  const golden = h('div.seed-strip.spread-strip.golden-strip', { role: 'toolbar', 'aria-label': tr('toolbar.golden.label'), hidden: true });
  bar.before(golden);
  let goldenKey = '';
  function renderGolden() {
    const st = store.state;
    const it = useIntent('golden_can');
    const show = Boolean(st && it && st.farm.relics?.golden_can && TOOL_CONTENT[controller.tool.id] === 'watering_can');
    if (!show) { golden.hidden = true; goldenKey = ''; return; }
    golden.hidden = false;
    const code = probe(store, it.type, it.args);
    const key = `${code}|${lang()}`;
    if (key === goldenKey) return;
    goldenKey = key;
    golden.setAttribute('aria-label', tr('toolbar.golden.label'));
    const art = relicIcon('golden_can', hasIcon);
    const why = code === null ? '' : code === 'NOT_NEEDED' ? tr('toolbar.golden.allWatered') : reason(code);
    const btn = h('button.btn.btn--small.btn--sky.golden-go', { type: 'button', disabled: code !== null, dataset: { relicUse: 'golden_can', tip: why || tr('toolbar.golden.tip') },
      on: { click: () => controller.do(it.type, it.args) } }, tr('toolbar.golden.go'));
    golden.replaceChildren(...[icon(art.id, { size: 34, cls: art.gilded ? 'pn-gilded' : '' }), h('span.ss-label', tr('toolbar.golden.short')), btn,
      why ? h('span.golden-why', why) : null].filter(Boolean));
  }
  store.subscribe('objects', () => { if (!golden.hidden) renderGolden(); });
  store.subscribe('relics', renderGolden);

  // ---- the seed tray's overflow cue (QA wave 1 UI-38): a fading arrow at each end that has more cards ----------
  /** A scroll arrow for any tray (the build tray's are always there: release 1.0 S2). */
  function arrowOn(el, dir) {
    return h(`button.tray-arrow.always.${dir < 0 ? 'left' : 'right'}`, { type: 'button', tabindex: '-1',
      'aria-label': dir < 0 ? tr('dock.build.left') : tr('dock.build.right'),
      on: { click: () => el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' }) } },
    h('span', { 'aria-hidden': 'true' }, dir < 0 ? '‹' : '›'));
  }
  function cueOn(el) {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('scrolls', max > 4);
    const l = el.querySelector('.tray-arrow.left');
    const r = el.querySelector('.tray-arrow.right');
    if (l) l.toggleAttribute('aria-disabled', el.scrollLeft <= 4);
    if (r) r.toggleAttribute('aria-disabled', el.scrollLeft >= max - 4);
  }
  btray.addEventListener('scroll', () => cueOn(btray), { passive: true });
  function arrow(dir) {
    return h(`button.tray-arrow.${dir < 0 ? 'left' : 'right'}`, { type: 'button', tabindex: '-1', hidden: true,
      'aria-label': dir < 0 ? tr('toolbar.seedsLeft') : tr('toolbar.seedsRight'),
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
    // any tray or flyout over the toolbar: the coach docks left of it (M1a, ux-first#12)
    const strip = document.querySelector('#tray-wrap > .seed-strip:not(.spread-strip)');
    const open = !tray.hidden || !btray.hidden || !fly.hidden || Boolean(strip && !strip.hidden);
    document.body.classList.toggle('tray-open', open);
    if (!open || !wrap) return;
    const scale = (S.settings?.scale?.() ?? 100) / 100;
    const w = wrap.getBoundingClientRect();
    // the coach docks left of everything open over the toolbar: a build or seed tray (360 px) is wider than the toolbar
    // of 3 and sat on the card's right half at 1366 x 768 (QA r1 S-09); logical px (the HUD is zoomed by --ui-scale)
    const shown = [bar, tray, btray, fly, strip].filter((e) => e && !e.hidden && e.getClientRects().length);
    const left = Math.min(...shown.map((e) => e.getBoundingClientRect().left));
    wrap.style.setProperty('--tool-inset', `${Math.max(0, (left - w.left) / scale)}px`);
    wrap.style.setProperty('--coach-w', `${Math.max(200, Math.min(380, (left - 16 - 14) / scale))}px`);
  }
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => requestAnimationFrame(syncTrayState));
    for (const el of [tray, btray, fly]) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('resize', () => requestAnimationFrame(() => { syncTrayState(); cue(); }));

  function pickSeed(r) {
    if (!r.open) { ui.toast(tr('toolbar.seed.lockedToast', { name: N(r.id, 'crops'), level: r.unlock }), { kind: 'info', icon: r.id }); return; }
    markSeen('crops', r.id);
    if (controller.tool.id === 'hand') {
      // the Smart Hand asked for a seed (an empty plot, no seed chosen): keep the Hand, armed with the seed (M2)
      controller.setTool('hand', { crop: r.id, plant: true });
      seedsOpen = false;
      render();
      return;
    }
    const seedTool = controller.TOOLS.find((x) => isSeedTool(x.id));
    controller.setTool(seedTool ? seedTool.id : 'seed', { crop: r.id });
    seedsOpen = false;
    setSeedFly(false);
    S.tutorial?.firstUse('seed_bag');
  }

  // ---- the build tray (GDD §7.1 build mode, §2.3 "Grandma's Coop from the build tray"): what waits in
  // farm.storage (free gifts, stored objects) with "Place", plus "Move & rotate" (the Hammer) and the shop
  function renderBuild() {
    const st = store.state;
    if (!st) return;
    const stored = Object.keys(st.farm.storage || {}).sort().filter((d) => (st.farm.storage[d] || 0) > 0 && defOf(d));
    const tools = [];
    // Shop, Move and Upgrade first (release 1.0 S2, ux-first#13: the Shop card was the 23rd of 23 on the owners' farm),
    // then what waits in storage, then selling stored decor back
    if (ui.panels.has('market')) {
      tools.push(h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: 'shop' }, 'aria-label': tr('toolbar.build.shopLabel'),
        on: { click: () => { buildOpen = false; btray.hidden = true; ui.panels.open('market', { tab: 'buildings' }); } },
      }, icon('market_stand', { size: 46 }), h('span.nm', tr('toolbar.build.shop')), h('span.row', tr('toolbar.build.shopSub'))));
    }
    tools.push(h('button.seed.build-card', {
      type: 'button', role: 'menuitem', dataset: { def: 'move' }, 'aria-label': tr('toolbar.build.moveLabel'),
      'data-tip': tr('toolbar.build.moveTip'),
      on: { click: () => { buildOpen = false; btray.hidden = true; controller.setTool('hammer'); } },
    }, icon('hammer', { size: 46 }), h('span.nm', tr('toolbar.build.move')), h('span.row', tr('toolbar.build.moveSub'))));
    // the farmhouse, Market Stand, Well and benches upgrade from here too (wave 4, wish E)
    if (ui.panels.has('upgrades')) {
      tools.push(h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: 'upgrades' }, 'aria-label': tr('toolbar.build.upLabel'),
        'data-tip': tr('toolbar.build.upTip'),
        on: { click: () => { buildOpen = false; btray.hidden = true; S.hud?.renderDock(); ui.panels.open('upgrades'); } },
      }, icon('farmhouse', { size: 46 }), h('span.nm', tr('toolbar.build.up')), h('span.row', tr('toolbar.build.upSub'))));
    }
    // what waits in storage, then a free building this level brought that the farm has none of (the Windmill, S-01)
    const cards = [...stored, ...freeToPlace(st)].map((d) => {
      const n = st.farm.storage?.[d] ?? 0;
      return h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: d },
        'aria-label': tr(n > 1 ? 'toolbar.build.placeN' : 'toolbar.build.place', { thing: N(d), n }), 'data-tip': tr('toolbar.build.tip', { thing: N(d) }),
        on: { click: () => placeStored(d) },
      }, icon(d, { size: 46 }), h('span.nm', cname(d)), h('span.row.free', n > 1 ? tr('toolbar.build.freeN', { n }) : tr('toolbar.build.free')));
    });
    // stored decor can be sold back from here (wish A): the list with what each piece fetches
    if (stored.some((d) => defOf(d)?.kind === 'decor') && ui.panels.has('decorSell')) {
      cards.push(h('button.seed.build-card', {
        type: 'button', role: 'menuitem', dataset: { def: 'sell' }, 'aria-label': tr('toolbar.build.sellLabel'),
        'data-tip': tr('toolbar.build.sellTip'),
        on: { click: () => { buildOpen = false; btray.hidden = true; S.hud?.renderDock(); ui.panels.open('decorSell'); } },
      }, icon('coins', { size: 46 }), h('span.nm', tr('toolbar.build.sell')), h('span.row', tr('toolbar.build.sellSub'))));
    }
    // the scroll arrows always show on a strip wider than the screen (they grey out at an end)
    btray.replaceChildren(arrowOn(btray, -1), ...tools, ...(cards.length ? [h('span.tray-sep', { 'aria-hidden': 'true' })] : []), ...cards, arrowOn(btray, 1));
    btray.hidden = false;
    requestAnimationFrame?.(() => cueOn(btray));
  }
  function placeStored(defId) {
    buildOpen = false;
    btray.hidden = true;
    const ok = typeof controller.place === 'function' ? controller.place(defId) : controller.setTool('hammer', { def: defId });
    if (ok === false) ui.toast(tr('toolbar.build.cannot'), { kind: 'info' });
    S.tutorial?.firstUse('hammer');
  }
  function openBuild(open = !buildOpen) {
    buildOpen = Boolean(open);
    if (buildOpen) {
      seedsOpen = false;
      tray.hidden = true;
      closeFlyouts();
      setSeedFly(false);
      renderBuild();
      btray.querySelector('.build-card')?.focus({ preventScroll: true });
    }
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
    const parts = [icon(o.def, { size: 26 }), h('span', touch ? tr('toolbar.hint.tap', { thing: N(o.def) })
      : tr(storable ? 'toolbar.hint.clickDel' : 'toolbar.hint.click', { thing: N(o.def) }))];
    if (def.kind === 'decor' && typeof controller.pin === 'function') {
      const mine = o.pin === store.pid;
      const theirs = o.pin !== undefined && !mine;
      parts.push(theirs ? h('span.hint-pin', tr('toolbar.hint.pinnedBy', { name: st.players[o.pin]?.name || tr('hud.tip.yourPartner') }))
        : btn(mine ? tr('toolbar.hint.unpin') : tr('toolbar.hint.pin'), () => controller.pin(hintId, !mine), mine ? tr('toolbar.hint.unpinTip') : tr('toolbar.hint.pinTip')));
    }
    // ↻ turns it a quarter where it stands (wish C): the client's controller.rotate(id) (also R over it), else the
    // rules' rotateSpot sent as a move
    if (canTurn(hintId, def)) {
      const id = hintId;
      parts.push(btn(touch ? tr('toolbar.hint.rotate') : tr('toolbar.hint.rotateKey'), () => turnObject(id), tr('toolbar.hint.rotateTip')));
    }
    if (typeof controller.canMoveBack === 'function' && controller.canMoveBack(hintId)) {
      const id = hintId;
      parts.push(btn(touch ? tr('toolbar.hint.back') : tr('toolbar.hint.backKey'), () => controller.moveBack(id), tr('toolbar.hint.backTip')));
    }
    // the farmhouse, the Well, the Market Stand and the benches have upgrades (wish E): the tier and the way in
    const target = typeof UPG.upgradeTargetOf === 'function' ? UPG.upgradeTargetOf(o.def) : null;
    const tiers = target ? UPG.UPGRADES?.[target]?.tiers?.length ?? 0 : 0;
    if (tiers && ui.panels.has('upgrades')) {
      const id = hintId;
      const n = typeof UPG.tierOf === 'function' ? UPG.tierOf(o) : 0;
      parts.push(btn(n >= tiers ? tr('toolbar.hint.upDone', { n }) : tr('toolbar.hint.up', { n, of: tiers }), () => ui.panels.open('upgrades', { id }),
        n >= tiers ? tr('toolbar.hint.upDoneTip') : tr('toolbar.hint.upTip')));
    }
    // decor sells back for a share of its price (wish A), with a 10-minute Undo
    if (storable && ui.panels.has('decorSell')) {
      const id = hintId;
      parts.push(btn(tr('toolbar.hint.sell'), () => flows().then((m) => m.sellPlaced(S, id)).catch((err) => console.error('sell', err)),
        tr('toolbar.hint.sellTip')));
    }
    // Masterwork (GDD §3.8): the workshop opens on this very piece
    if (hintMw && hintMw === hintId && S.ui?.panels?.has?.('decorsets')) {
      const id = hintId;
      parts.push(btn(tr('toolbar.hint.masterwork'), () => S.ui.panels.open('decorsets', { tab: 'masterwork', id }),
        tr('toolbar.hint.masterworkTip')));
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
  // the ghost's reason, beside what is carried (release 1.0 S7, ux-first#15): "In the way: the Well"
  const carryWhy = h('span.carry-why', { role: 'status' });
  function paintWhy(e) {
    carryWhy.textContent = placeWhy(e);
    carryWhy.hidden = !carryWhy.textContent;
  }
  function showCarry(c, e = null) {
    const key = `${c.def}|${c.moveId}`;
    paintWhy(e);
    if (key === carryKey && !hint.hidden) return;
    carryKey = key;
    clearTimeout(hintT);
    dropSwitch();
    hintId = null;
    shown();
    const thing = defOf(c.def) ? N(c.def) : tr('toolbar.carry.it');
    const btn = (label, fn, title) => h('button.hint-btn', { type: 'button', title, on: { click: (ev) => { ev.stopPropagation(); fn(); } } }, label);
    hint.replaceChildren(icon(c.def, { size: 26 }), h('span', tr(c.moveId ? 'toolbar.carry.moving' : 'toolbar.carry.placing', { thing })), carryWhy,
      btn(tr('toolbar.hint.rotateKey'), () => controller.rotate(), tr('toolbar.carry.rotateTip')),
      btn(tr('toolbar.carry.cancel'), () => controller.cancel?.(), c.moveId ? tr('game.build.leave') : tr('toolbar.carry.putBack')));
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
    if (carry) { showCarry(carry, e); return; }
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

  let heldTool = controller.tool.id;
  controller.on('tool', (t) => {
    if (!isSeedTool(t.id)) { seedsOpen = false; setSeedFly(false); }
    // the Seed Bag taken up (2, the pop-up): its crop strip opens over the slot
    else if (!isSeedTool(heldTool)) setSeedFly(true);
    heldTool = t.id;
    if (toolsFly || popOpen) closeFlyouts();
    if (t.id !== 'hammer') { hint.hidden = true; hintId = null; dropSwitch(); shown(); }
    render();
  });
  store.subscribe('xp', render);
  store.subscribe('tools', render);
  // a language switch: the open trays and the hint re-draw (render() itself runs from ui/index.js relocalize)
  onLang(() => {
    if (seedsOpen) renderSeeds();
    if (buildOpen) renderBuild();
    if (hintId && !hint.hidden) renderHint();
    carryKey = '';
    paintMore();
  });
  store.subscribe('mastery', () => { if (seedsOpen) renderSeeds(); });
  store.subscribe('inventory', () => { if (seedsOpen) renderSeeds(); });
  // a click on the farm closes the seed tray (the chosen seed stays)
  document.getElementById('world').addEventListener('pointerdown', () => {
    if (seedsOpen) { seedsOpen = false; tray.hidden = true; }
    if (toolsFly || popOpen) closeFlyouts();
    if (seedFly) setSeedFly(false);
    if (buildOpen) { buildOpen = false; btray.hidden = true; S.hud?.renderDock(); }
  });

  return {
    render,
    openSeeds(open = true) { seedsOpen = Boolean(open); if (seedsOpen) { buildOpen = false; btray.hidden = true; } render(); },
    openBuild,
    get buildOpen() { return buildOpen; },
    /** The crop strip over the Seeds slot is open (seeds.js shows it then). */
    get seedFly() { return seedFly; },
    setSeedFly,
    closeFlyouts,
    slotOf,
    toolDef: (id) => toolDefFor(id, store.state),
  };
}
