// A mod's look (docs/agent-notes/harness-contract.md §1.7): theme colours as CSS variables on :root, a sky preset mixed
// over the day-night sky, and the music it prefers. Client only; it never affects the rules or the content hash.
//   applyLook(look | null)         look = overlay.look ({ palette?, sky?, music? }); null puts the game's own back
//   SKY_PRESETS                    the presets: a colour and a strength (<= 50 %) per sky channel
//   skyFilter(s) -> s              the active preset applied to a skyAt() result (render-world calls it; see
//                                  docs/agent-notes/hh-mods.md for the one-line hook in render/daynight.js)
//   currentLook() -> look | null
import { PALETTE_VARS } from '../../../shared/mod/format.js';
import { hexRgb } from '../../../shared/mod/colour.js';

/** Per preset: channel -> [hex, strength 0..0.5] (mixed over the cycle's own colour, so day and night still read). */
export const SKY_PRESETS = Object.freeze({
  default: Object.freeze({}),
  golden: Object.freeze({ top: ['#F6C46B', 0.35], horizon: ['#FFD9A0', 0.45], fog: ['#F3D2A2', 0.3] }),
  pastel: Object.freeze({ top: ['#A9C8F5', 0.4], horizon: ['#F7D6EC', 0.45], fog: ['#EBDDF2', 0.3] }),
  cool: Object.freeze({ top: ['#5F8FD8', 0.35], horizon: ['#CDE4F2', 0.4], fog: ['#D3E3EE', 0.3] }),
  stormy: Object.freeze({ top: ['#6C7A8C', 0.45], horizon: ['#B4BCC6', 0.5], fog: ['#A9B2BD', 0.4] }),
});

let current = null;
let audioRef = null;

/** sRGB hex -> linear [r, g, b] (the renderer's sky colours are linear). */
function linearOf(hex) {
  const rgb = hexRgb(hex);
  return rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k)
  : a && typeof a === 'object' && 'r' in a ? { r: a.r + (b[0] - a.r) * k, g: a.g + (b[1] - a.g) * k, b: a.b + (b[2] - a.b) * k } : a);

/** The active sky preset over a skyAt() result (a new object; the input is not changed). */
export function skyFilter(s) {
  const p = current && current.sky ? SKY_PRESETS[current.sky] : null;
  if (!p || !s) return s;
  const out = { ...s };
  for (const [ch, [hex, k]] of Object.entries(p)) if (out[ch] !== undefined) out[ch] = mix(out[ch], linearOf(hex), Math.min(0.5, k));
  return out;
}

/** The audio module, handed in by main.js (its `prefer(ids)` method). */
export function setLookAudio(audio) { audioRef = audio; }

export function applyLook(look) {
  current = look && (look.palette || look.sky || look.music) ? look : null;
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root) {
    for (const [key, cssVar] of Object.entries(PALETTE_VARS)) {
      const v = current && current.palette ? current.palette[key] : undefined;
      if (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)) root.style.setProperty(cssVar, v);
      else root.style.removeProperty(cssVar);
    }
    if (current && current.sky && current.sky !== 'default') root.dataset.modSky = current.sky;
    else delete root.dataset.modSky;
  }
  try { audioRef?.prefer?.(current && current.music ? current.music.prefer : []); } catch { /* audio not ready */ }
  return current;
}

export const currentLook = () => current;
