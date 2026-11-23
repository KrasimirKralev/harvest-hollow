// The tool tray (GDD §3.7, §7.1): the base tools from content (`shared/content/tools.js`, keys 1-9), what is
// unlocked at the farm level, the brush each tool paints with (the best owned upgrade: Big Watering Can 3x3,
// Wide Sickle 2x2), and the SVG data-URI cursors ("the cursor becomes the tool"). DOM-free except cursorFor(),
// which only builds a CSS string. Owned by the client-core lane.
//
//   TOOL_LIST                     [{ id, label, key, unlock, text, acts, brush }] base tools in tray order
//   toolUnlocked(state, id) -> boolean
//   brushOf(state, id) -> [w, d]  the base brush, or the largest owned upgrade's
//   ownsTool(state, id)           a bought upgrade (state.farm.tools: array or { id: truthy })
//   cursorFor(id) -> CSS cursor value
//   ALIASES                       old/short ids accepted by setTool ('seed' -> 'seed_bag', ...)
import { CONTENT, isLive, levelFromXp } from '../../../shared/content/index.js';

export const ALIASES = Object.freeze({
  seed: 'seed_bag', seeds: 'seed_bag', plot: 'hammer', build: 'hammer', water: 'watering_can', can: 'watering_can',
  feed: 'feed_scoop', scoop: 'feed_scoop', compost: 'compost_scoop',
});

export const TOOL_LIST = Object.freeze([...CONTENT.tools.values()]
  .filter((t) => !t.upgrades && isLive(t))
  .sort((a, b) => a.key - b.key)
  .map((t) => Object.freeze({ id: t.id, label: t.name, key: String(t.key), unlock: t.unlock, text: t.text, acts: t.acts, brush: t.brush })));

const level = (state) => (state ? levelFromXp(state.farm.xp) : 1);

export function toolUnlocked(state, id) {
  const t = CONTENT.tools.get(id);
  return Boolean(t && isLive(t) && level(state) >= t.unlock);
}

export function ownsTool(state, id) {
  const owned = state && state.farm && state.farm.tools;
  if (Array.isArray(owned)) return owned.includes(id);
  return Boolean(owned && typeof owned === 'object' && Object.hasOwn(owned, id) && owned[id]);
}

export function brushOf(state, id) {
  const base = CONTENT.tools.get(id);
  if (!base) return [1, 1];
  let best = base.brush;
  for (const t of CONTENT.tools.values()) {
    if (t.upgrades !== id || !isLive(t) || !ownsTool(state, t.id)) continue;
    if (t.brush[0] * t.brush[1] > best[0] * best[1]) best = t.brush;
  }
  return [...best];
}

// ---- cursors: 32 px SVG, dark outline, palette colours (GDD §8.2), hotspot at the working tip ----------------
const OUT = 'stroke="#3B2A1A" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';
const CURSORS = {
  hand: [11, 3, `<path d="M9 30c-3-4-6-9-6-12 0-2 3-3 4-1l3 4V5c0-2 3-2 3 0v9-11c0-2 3-2 3 0v11-9c0-2 3-2 3 0v10-6c0-2 3-2 3 0v13c0 6-3 9-8 9z" fill="#FFE1BD" ${OUT}/>`],
  seed_bag: [16, 28, `<path d="M9 9h14l2 4c3 5 3 13-1 16H8c-4-3-4-11-1-16z" fill="#E8C98A" ${OUT}/><path d="M11 9l2-4h6l2 4" fill="#D9A15B" ${OUT}/><circle cx="13" cy="20" r="1.6" fill="#7A4A2A"/><circle cx="18" cy="23" r="1.6" fill="#7A4A2A"/><circle cx="19" cy="17" r="1.6" fill="#7A4A2A"/>`],
  sickle: [27, 6, `<path d="M6 28l7-7" stroke="#8A5A35" stroke-width="5" stroke-linecap="round"/><path d="M6 28l7-7" ${OUT} fill="none"/><path d="M13 21C9 10 18 2 28 5c-7 1-12 6-11 13z" fill="#DDE6EE" ${OUT}/>`],
  watering_can: [4, 10, `<path d="M11 14h14v12a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2z" fill="#4AA8E8" ${OUT}/><path d="M11 17L4 10l2-2 7 6" fill="#4AA8E8" ${OUT}/><path d="M15 14c0-5 7-5 7 0" fill="none" ${OUT}/><circle cx="4" cy="8" r="1.4" fill="#6FD3E6"/>`],
  feed_scoop: [6, 22, `<path d="M4 16c0 8 14 10 18 2l-4-6z" fill="#C9D3DA" ${OUT}/><path d="M18 12l9-7" stroke="#8A5A35" stroke-width="4" stroke-linecap="round"/><circle cx="10" cy="18" r="1.4" fill="#E8B84A"/><circle cx="14" cy="19" r="1.4" fill="#E8B84A"/>`],
  basket: [16, 26, `<path d="M6 15h20l-3 13H9z" fill="#D9A15B" ${OUT}/><path d="M9 15c0-9 14-9 14 0" fill="none" ${OUT}/><path d="M8 20h16M9 24h14" stroke="#9B6A3E" stroke-width="1.2"/><circle cx="12" cy="13" r="2.6" fill="#E23B3B" ${OUT}/><circle cx="18" cy="12" r="2.6" fill="#E23B3B" ${OUT}/>`],
  compost_scoop: [6, 22, `<path d="M4 16c0 8 14 10 18 2l-4-6z" fill="#7A4A2A" ${OUT}/><path d="M18 12l9-7" stroke="#8A5A35" stroke-width="4" stroke-linecap="round"/><circle cx="11" cy="17" r="1.2" fill="#8FD05A"/>`],
  axe: [24, 6, `<path d="M7 29l14-16" stroke="#8A5A35" stroke-width="4.5" stroke-linecap="round"/><path d="M17 9c3-6 10-6 12-3l-6 10c-3-1-6-4-6-7z" fill="#C9D3DA" ${OUT}/>`],
  hammer: [20, 6, `<path d="M8 29l11-13" stroke="#8A5A35" stroke-width="4.5" stroke-linecap="round"/><path d="M13 9l6-5 9 8-4 4-3-2-3 3z" fill="#9AA6AE" ${OUT}/>`],
};
const cursorCache = new Map();

/** CSS cursor value for a tool: an SVG data URI with its hotspot, falling back to the system cursor. */
export function cursorFor(id) {
  if (cursorCache.has(id)) return cursorCache.get(id);
  const c = CURSORS[id];
  if (!c) return 'default';
  const [hx, hy, body] = c;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`;
  const css = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${id === 'hand' ? 'pointer' : 'crosshair'}`;
  cursorCache.set(id, css);
  return css;
}
