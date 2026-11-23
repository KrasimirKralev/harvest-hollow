// Keyboard shortcuts (GDD §7.1 table), rebindable and documented in one place. Keys are PHYSICAL keys
// (KeyboardEvent.code: 'KeyW', 'Digit1', 'Space'), so WASD, Q/E and 1-9 work under any layout (a Bulgarian or
// German layout must not move them). The mouse alone does everything; keys are shortcuts only. DOM-free apart
// from reading an event. Owned by the client-core lane.
//
//   const keys = createKeymap(storage?)        storage: { get(): object|null, set(v) } (localStorage 'hh.keys')
//   keys.actionOf(event) -> action | null      the action bound to this key press (modifiers: 'Ctrl+' prefix)
//   keys.bind(action, code) / keys.reset()     rebinding (a code bound elsewhere is moved, never duplicated)
//   keys.list() -> [{ action, label, keys: ['W', 'Up'], owner: 'game' | 'ui' }]   for the settings keybind list
//   codeOf(event) -> 'Ctrl+KeyZ' | 'KeyW' | ...
//   keyLabel(code) -> 'Ctrl+Z' | 'W' | 'Space' | ...   (key caps stay Latin in every language: i18n glossary rule 9)
import { t } from '../i18n/index.js';

/** action -> [label key (i18n catalog 'game.key.<action>'), default codes, owner]. 'ui' actions are handled by the ui-shell (panel hotkeys). */
const DEFS = [
  ['tool1', 'game.key.tool1', ['Digit1']], ['tool2', 'game.key.tool2', ['Digit2']], ['tool3', 'game.key.tool3', ['Digit3']],
  ['tool4', 'game.key.tool4', ['Digit4']], ['tool5', 'game.key.tool5', ['Digit5']], ['tool6', 'game.key.tool6', ['Digit6']],
  ['tool7', 'game.key.tool7', ['Digit7']], ['tool8', 'game.key.tool8', ['Digit8']], ['tool9', 'game.key.tool9', ['Digit9']],
  ['hand', 'game.key.hand', ['KeyH']],
  ['build', 'game.key.build', ['KeyB']],
  ['rotate', 'game.key.rotate', ['KeyR']],
  ['cancel', 'game.key.cancel', ['Escape']],
  ['camLeft', 'game.key.camLeft', ['KeyQ']],
  ['camRight', 'game.key.camRight', ['KeyE']],
  // wave 4 (wish H): the camera's tilt from the keyboard (the mouse: Settings > Right-drag: Rotate camera)
  ['tiltUp', 'game.key.tiltUp', ['PageUp']],
  ['tiltDown', 'game.key.tiltDown', ['PageDown']],
  ['camReset', 'game.key.camReset', ['Home']],
  ['panUp', 'game.key.panUp', ['KeyW', 'ArrowUp']],
  ['panDown', 'game.key.panDown', ['KeyS', 'ArrowDown']],
  ['panLeft', 'game.key.panLeft', ['KeyA', 'ArrowLeft']],
  ['panRight', 'game.key.panRight', ['KeyD', 'ArrowRight']],
  ['zoomIn', 'game.key.zoomIn', ['Equal', 'NumpadAdd']],
  ['zoomOut', 'game.key.zoomOut', ['Minus', 'NumpadSubtract']],
  ['me', 'game.key.me', ['Space']],
  ['partner', 'game.key.partner', ['KeyF']],
  ['ping', 'game.key.ping', ['KeyG']],
  ['emotes', 'game.key.emotes', ['KeyT']],
  ['photo', 'game.key.photo', ['KeyP']],
  ['ride', 'game.key.ride', ['KeyV']],
  ['undo', 'game.key.undo', ['Ctrl+KeyZ']],
  ['store', 'game.key.store', ['Delete']],
  ['market', 'game.key.market', ['KeyM'], 'ui'],
  ['barn', 'game.key.barn', ['KeyI'], 'ui'],
  ['orders', 'game.key.orders', ['KeyO'], 'ui'],
  ['journal', 'game.key.journal', ['KeyJ'], 'ui'],
  ['settings', 'game.key.settings', ['Comma'], 'ui'],
  ['debug', 'game.key.debug', ['F3']],
];

const NAMES = { Space: 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Equal: '+',
  Minus: '-', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', Delete: 'Del', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab',
  Comma: ',', PageUp: 'Page Up', PageDown: 'Page Down', Home: 'Home' }; // i18n-ok: key caps stay Latin

/** 'KeyW' -> 'W', 'Digit1' -> '1', 'Ctrl+KeyZ' -> 'Ctrl+Z'. */
export function keyLabel(code) {
  const ctrl = code.startsWith('Ctrl+');
  const c = ctrl ? code.slice(5) : code;
  const name = NAMES[c] ?? (c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c.startsWith('Numpad') ? `Num ${c.slice(6)}` : c); // i18n-ok: key caps stay Latin
  return ctrl ? `Ctrl+${name}` : name;
}

/** The binding code of a key event ('Ctrl+' for Ctrl or Cmd). Shift and Alt are free modifiers (Shift+Hand uproots). */
export function codeOf(e) {
  const code = e.code || '';
  return (e.ctrlKey || e.metaKey) && !/^(Control|Meta)/.test(code) ? `Ctrl+${code}` : code;
}

export const DEFAULT_KEYS = Object.freeze(Object.fromEntries(DEFS.map(([a, , k]) => [a, Object.freeze([...k])])));

export function createKeymap(storage = { get: () => null, set: () => {} }) {
  let map = {};
  const load = () => {
    map = Object.fromEntries(DEFS.map(([a, , k]) => [a, [...k]]));
    let saved = null;
    try { saved = storage.get(); } catch { saved = null; }
    if (saved && typeof saved === 'object') {
      for (const [a, codes] of Object.entries(saved)) {
        if (Object.hasOwn(map, a) && Array.isArray(codes) && codes.every((c) => typeof c === 'string' && c.length < 32)) map[a] = codes.slice(0, 3);
      }
    }
  };
  load();
  const index = () => {
    const idx = new Map();
    for (const [a, codes] of Object.entries(map)) for (const c of codes) if (!idx.has(c)) idx.set(c, a);
    return idx;
  };
  let byCode = index();
  return {
    actionOf(e) { return byCode.get(codeOf(e)) ?? null; },
    codesOf(action) { return [...(map[action] || [])]; },
    bind(action, code) {
      if (!Object.hasOwn(map, action) || typeof code !== 'string' || !code) return false;
      for (const a of Object.keys(map)) map[a] = map[a].filter((c) => c !== code);   // a key does one thing
      map[action] = [code, ...map[action]].slice(0, 3);
      byCode = index();
      try { storage.set(map); } catch { /* private mode: lasts this page only */ }
      return true;
    },
    reset() {
      try { storage.set(null); } catch { /* ignore */ }
      load();
      byCode = index();
    },
    list() {
      return DEFS.map(([action, label, , owner = 'game']) => ({ action, label: t(label), keys: (map[action] || []).map(keyLabel), codes: [...(map[action] || [])], owner }));
    },
  };
}
