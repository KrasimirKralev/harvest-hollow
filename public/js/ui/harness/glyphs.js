// The helper's inline glyphs, drawn like the shell's (ui/dom.js GLYPHS: 48 viewBox, 2.5 ink outline, flat fill with one
// highlight). Their own set so the helper needs no edit of the shell's file.
//
//   glyph(name, size?) -> SVGElement   names: helper mic micOn speaker stop check cross wait sparkle down back speed sky
//                                      music letter
const SVG_NS = 'http://www.w3.org/2000/svg';
const INK = '#3E2612';

const GLYPHS = {
  // the helper: a seed-pouch wand with a star that grows things (no robot: the game's cozy register)
  helper: `<path d="M9 41l20-20" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
    <path d="M9 41l20-20" stroke="#B87533" stroke-width="4" stroke-linecap="round"/>
    <path d="M33 5l3.6 7.4 8 1.2-5.8 5.6 1.4 8-7.2-3.8-7.2 3.8 1.4-8-5.8-5.6 8-1.2z" fill="#FFC83D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M31 11l-2 4" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M12 12v6M9 15h6" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <path d="M12 12v6M9 15h6" stroke="#9B6BD6" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M40 33v5M37.5 35.5h5" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <path d="M40 33v5M37.5 35.5h5" stroke="#4AA8E8" stroke-width="2.5" stroke-linecap="round"/>`,
  sparkle: `<path d="M24 5c2 11 5 15 16 19-11 4-14 8-16 19-2-11-5-15-16-19 11-4 14-8 16-19z" fill="#FFC83D" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 12c-1 5-3 8-6 10" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.5" stroke-linecap="round"/>`,
  mic: `<rect x="17" y="5" width="14" height="24" rx="7" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5"/>
    <path d="M11 22a13 13 0 0 0 26 0M24 35v7M17 42h14" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  micOn: `<rect x="17" y="5" width="14" height="24" rx="7" fill="#E8554A" stroke="${INK}" stroke-width="2.5"/>
    <path d="M11 22a13 13 0 0 0 26 0M24 35v7M17 42h14" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M21 10v8" stroke="#fff" stroke-opacity=".6" stroke-width="2.5" stroke-linecap="round"/>`,
  speaker: `<path d="M7 19h7l10-9v28l-10-9H7z" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M30 18c3 3 3 9 0 12M35 13c6 6 6 16 0 22" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  stop: `<rect x="12" y="12" width="24" height="24" rx="5" fill="#E8554A" stroke="${INK}" stroke-width="2.5"/>`,
  check: `<path d="M10 25l9 9 19-20" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 25l9 9 19-20" fill="none" stroke="#9BE06A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: `<path d="M14 14l20 20M34 14L14 34" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
    <path d="M14 14l20 20M34 14L14 34" stroke="#FF9B8F" stroke-width="3.5" stroke-linecap="round"/>`,
  wait: `<circle cx="24" cy="24" r="16" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5"/>
    <path d="M24 14v10l7 5" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  down: `<path d="M13 19l11 11 11-11" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  back: `<path d="M14 18a13 13 0 1 1-2 13" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <path d="M6 13l6 7 8-4" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  // release 1.0 (H3): the change list's rows that are not a thing: a speed knob, the sky, the music, a letter
  speed: `<circle cx="24" cy="26" r="16" fill="#E2F4D2" stroke="${INK}" stroke-width="2.5"/>
    <path d="M24 26l8-8" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="26" r="3" fill="${INK}"/>
    <path d="M14 12l-4-4M34 12l4-4" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  sky: `<circle cx="18" cy="18" r="9" fill="#FFC83D" stroke="${INK}" stroke-width="2.5"/>
    <path d="M14 38h22a7 7 0 0 0 0-14 10 10 0 0 0-19 2 6 6 0 0 0-3 12z" fill="#fff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
  music: `<path d="M18 34V12l20-5v22" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="13" cy="34" rx="6" ry="5" fill="#9B6BD6" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="33" cy="29" rx="6" ry="5" fill="#9B6BD6" stroke="${INK}" stroke-width="2.5"/>`,
  letter: `<rect x="7" y="12" width="34" height="24" rx="3" fill="#FFF4D6" stroke="${INK}" stroke-width="2.5"/>
    <path d="M8 14l16 12 16-12" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="24" cy="27" r="3.5" fill="#E8554A" stroke="${INK}" stroke-width="1.5"/>`,
};

export function glyph(name, size = 24) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `glyph hx-g hx-g-${name}`);
  svg.innerHTML = GLYPHS[name] || GLYPHS.sparkle;
  return svg;
}

export const GLYPH_NAMES = Object.freeze(Object.keys(GLYPHS));
