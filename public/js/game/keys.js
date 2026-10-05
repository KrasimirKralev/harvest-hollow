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
//   keyLabel(code) -> 'Ctrl+Z' | 'W' | 'Space' | ...

/** action -> [label, default codes, owner]. 'ui' actions are handled by the ui-shell (panel hotkeys). */
const DEFS = [
  ['tool1', 'Tool 1 (Hand)', ['Digit1']], ['tool2', 'Tool 2 (Seed Bag)', ['Digit2']], ['tool3', 'Tool 3 (Sickle)', ['Digit3']],
  ['tool4', 'Tool 4 (Watering Can)', ['Digit4']], ['tool5', 'Tool 5 (Feed Scoop)', ['Digit5']], ['tool6', 'Tool 6 (Basket)', ['Digit6']],
  ['tool7', 'Tool 7 (Compost Scoop)', ['Digit7']], ['tool8', 'Tool 8 (Axe)', ['Digit8']], ['tool9', 'Tool 9 (Hammer)', ['Digit9']],
  ['hand', 'Hand', ['KeyH']],
  ['build', 'Build mode', ['KeyB']],
  ['rotate', 'Rotate the building', ['KeyR']],
  ['cancel', 'Cancel / close', ['Escape']],
  ['camLeft', 'Rotate camera left', ['KeyQ']],
  ['camRight', 'Rotate camera right', ['KeyE']],
  // wave 4 (wish H): the camera's tilt from the keyboard (the mouse: Settings > Right-drag: Rotate camera)
  ['tiltUp', 'Tilt the view toward the horizon', ['PageUp']],
  ['tiltDown', 'Tilt the view toward top-down', ['PageDown']],
  ['camReset', 'Reset the view\'s turn and tilt', ['Home']],
  ['panUp', 'Pan up', ['KeyW', 'ArrowUp']],
  ['panDown', 'Pan down', ['KeyS', 'ArrowDown']],
  ['panLeft', 'Pan left', ['KeyA', 'ArrowLeft']],
  ['panRight', 'Pan right', ['KeyD', 'ArrowRight']],
  ['zoomIn', 'Zoom in', ['Equal', 'NumpadAdd']],
  ['zoomOut', 'Zoom out', ['Minus', 'NumpadSubtract']],
  ['me', 'Centre on me', ['Space']],
  ['partner', 'Go to partner', ['KeyF']],
  ['ping', 'Ping at the cursor', ['KeyG']],
  ['emotes', 'Emote wheel', ['KeyT']],
  ['photo', 'Take a photo', ['KeyP']],
  ['ride', 'Ride a horse / get off', ['KeyV']],
  ['undo', 'Undo my last purchase / move (10 min)', ['Ctrl+KeyZ']],
  ['store', 'Put the held object away', ['Delete']],
  ['market', 'Market', ['KeyM'], 'ui'],
  ['barn', 'Barn', ['KeyI'], 'ui'],
  ['orders', 'Orders board', ['KeyO'], 'ui'],
  ['journal', 'Journal', ['KeyJ'], 'ui'],
  ['settings', 'Settings', ['Comma'], 'ui'],
  ['debug', 'Debug overlay', ['F3']],
];

const NAMES = { Space: 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Equal: '+',
  Minus: '-', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', Delete: 'Del', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab',
  Comma: ',', PageUp: 'Page Up', PageDown: 'Page Down', Home: 'Home' };

/** 'KeyW' -> 'W', 'Digit1' -> '1', 'Ctrl+KeyZ' -> 'Ctrl+Z'. */
export function keyLabel(code) {
  const ctrl = code.startsWith('Ctrl+');
  const c = ctrl ? code.slice(5) : code;
  const name = NAMES[c] ?? (c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : c.startsWith('Numpad') ? `Num ${c.slice(6)}` : c);
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
      return DEFS.map(([action, label, , owner = 'game']) => ({ action, label, keys: (map[action] || []).map(keyLabel), codes: [...(map[action] || [])], owner }));
    },
  };
}
