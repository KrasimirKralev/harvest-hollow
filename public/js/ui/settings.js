// Settings (GDD §7.5, §6.1 "camera, settings ... personal (localStorage)"): graphics tier, day cycle, motion, UI
// scale, volumes per channel + mute, colour-blind safe, captions, edge scroll, keybind list, and the Credits tab (the
// music's artists and licences, read from public/assets/audio/music/tracks.json: the same list the music director in
// audio.js plays from, so the credits cannot disagree with what plays). Per browser, never game state. Registered as
// the 'settings' panel (size 'wide', key ','). ui-shell lane.
//
//   ui.settings.get() -> Settings          a frozen copy (edgeScroll is the controller's live option)
//   ui.settings.set(patch)                 merge, persist, apply, notify
//   ui.settings.on(fn(settings, patch)) -> off
//   ui.settings.scale() -> percent         the Interface size in effect (automatic, or the player's choice capped to
//                                          what fits this window)
// Applied here: --ui-scale, body.motion-reduced / .motion-still / .cb-safe, view.setQuality / setMotion /
// setDayCycle, audio.setDayMode, controller.setOption('edgeScroll'). Volumes and mute belong to client-core's
// audio.js (it persists them in 'hh.audio'): the Sound section reads audio.volumes() and writes
// audio.setVolume(channel, 0..1) / audio.setMuted(bool); `volume` here is only the fallback before audio exists.
import { h, kv } from './dom.js';

const KEY = 'hh.settings';
const prefersReduced = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const QUALITIES = ['auto', 'high', 'medium', 'low', 'eco'];

export const DEFAULTS = Object.freeze({
  quality: 'auto',            // 'auto' | 'high' | 'medium' | 'low' | 'eco'
  dayCycle: 'cycle',          // 'cycle' | 'day' | 'clock'
  motion: 'full',             // 'full' | 'reduced' | 'still'
  uiScale: 100,               // 80..140 %: the player's choice, used only when uiScaleSet
  uiScaleSet: false,          // false: the size follows the window (uiScaleAuto)
  muted: false,
  volume: Object.freeze({ master: 80, music: 35, sfx: 70, ambience: 50, ui: 60 }),
  cbSafe: false,
  captions: true,
  edgeScroll: false,
  keyHints: true,
  rightDrag: 'pan',           // 'pan' | 'rotate' (wave 4, wish H): the controller's own option wins when it has one
});

/** Merge a stored object over the defaults, dropping anything out of range (pure; tests). */
export function sanitize(raw) {
  const s = { ...DEFAULTS, volume: { ...DEFAULTS.volume } };
  if (!raw || typeof raw !== 'object') return s;
  const pick = (k, allowed) => { if (allowed.includes(raw[k])) s[k] = raw[k]; };
  pick('quality', QUALITIES);
  pick('dayCycle', ['cycle', 'day', 'clock']);
  pick('motion', ['full', 'reduced', 'still']);
  pick('rightDrag', ['pan', 'rotate']);
  if (Number.isFinite(raw.uiScale)) s.uiScale = Math.min(UI_SCALE_TOP, Math.max(UI_SCALE_MIN, Math.round(raw.uiScale / 5) * 5));
  for (const k of ['muted', 'cbSafe', 'captions', 'edgeScroll', 'keyHints', 'uiScaleSet']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  if (raw.volume && typeof raw.volume === 'object') {
    for (const k of Object.keys(DEFAULTS.volume)) {
      const v = raw.volume[k];
      if (Number.isFinite(v)) s.volume[k] = Math.min(100, Math.max(0, Math.round(v)));
    }
  }
  return s;
}

// ---- Interface size (GDD §7.5; QA wave 1 UI-01 / UI-17) ------------------------------------------------------------
// The HUD is laid out for 1366 x 768 at 100 %. A bigger size only fits a bigger window: the slider stops at what
// fits (never below 100 %, the size every layout is checked at), and without a choice the size follows the window
// (a 1080p screen gets 135 %, not the 1366 px pixel sizes on a big monitor).
export const UI_SCALE_MIN = 80;
export const UI_SCALE_TOP = 140;
const AUTO_TOP = 135;

/** The largest Interface size that fits a w x h window, in 5 % steps (100 % at 1366 x 768, 140 % at 1920 x 1080). Pure. */
export function uiScaleMax(w, h) {
  const fit = Math.floor(Math.min(w / 1366, h / 768) * 20) * 5;
  return Math.max(100, Math.min(UI_SCALE_TOP, Number.isFinite(fit) ? fit : 100));
}

/** The automatic size for a window: as big as fits, at most 135 %, never under 100 %. Pure. */
export const uiScaleAuto = (w, h) => Math.min(AUTO_TOP, uiScaleMax(w, h));

/** The Interface size in effect (percent): the player's choice capped to the window, else automatic. Pure. */
export function uiScaleOf(s, w, h) {
  if (!s || !s.uiScaleSet) return uiScaleAuto(w, h);
  return Math.max(UI_SCALE_MIN, Math.min(uiScaleMax(w, h), s.uiScale));
}

/** Every key the game answers to (GDD §7.1), for the Controls section. */
export const KEYS = Object.freeze([
  ['1 – 9', 'Tools and seed slots'], ['H', 'Hand'], ['B', 'Build mode'], ['R', 'Rotate the ghost'],
  ['M', 'Market'], ['I', 'Barn'], ['O', 'Orders board'], ['J', 'Journal'], [',', 'Settings'],
  ['Q / E', 'Turn the view'], ['W A S D', 'Pan the view'], ['Wheel', 'Zoom to the cursor'], ['Right-drag', 'Pan'],
  ['Shift + click', 'Uproot a crop'], ['G', 'Ping at the cursor'], ['T', 'Emote wheel'], ['F', 'Go to your partner'],
  ['Space', 'Centre on me'], ['P', 'Take a photo'], ['Esc', 'Close / cancel'], ['F3', 'Debug overlay'],
]);

/** Input options the controller owns (game/controller.js `options`): Settings only shows and flips them. */
const CONTROLLER_KEYS = new Set(['haptics', 'keepAwake']);

/** What a finger does (mobile wave, the input lane's touch model), for the Controls tab on a phone or tablet. */
export const TOUCH_GESTURES = Object.freeze([
  ['Tap', 'Use the tool in hand'], ['Drag', 'Paint with a farming tool; with the Hand, move the view'],
  ['Two fingers', 'Move the view; pinch to zoom; twist to turn'], ['Two fingers up / down', 'Tilt the view'],
  ['Long press', 'What is this?'],
  ['Double tap', 'Look closer'],
]);

/** Labels the Controls list shows instead of the keymap's own (what the key really does). */
const KEY_LABELS = Object.freeze({ photo: 'Take a photo' });

/** Where each track plays (tracks.json `moods`), for the Credits tab. */
export const MOOD_LABELS = Object.freeze({ title: 'Title screen', day: 'Day', evening: 'Evening and Golden Hour',
  night: 'Night', rain: 'Rain', fair: 'County Fair' });
/** The plain-language licence names the Credits tab shows. */
const LICENCE_NAMES = Object.freeze({ CC0: 'Public domain (CC0)' });

/** "Day · Evening and Golden Hour" for a track's moods. Pure (tests). */
export const moodText = (moods) => (Array.isArray(moods) ? moods : []).map((m) => MOOD_LABELS[m]).filter(Boolean).join(' · ');

let musicList = null;
/** tracks.json, fetched once per page (a failed fetch is tried again the next time the tab opens). */
function loadMusicList() {
  if (!musicList) {
    const v = globalThis.document?.querySelector?.('meta[name="hh-build"]')?.content;
    musicList = fetch(`/assets/audio/music/tracks.json${v ? `?v=${encodeURIComponent(v)}` : ''}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => (Array.isArray(j?.tracks) ? j.tracks : []))
      .catch((err) => { musicList = null; throw err; });
  }
  return musicList;
}

export function createSettings(S) {
  /** The controller's live (rebindable) keymap when it has one, else the GDD defaults. */
  const keyList = () => {
    const km = S.controller && S.controller.keys;
    if (!km || typeof km.list !== 'function') return KEYS;
    const rows = km.list().filter((r) => r.keys && r.keys.length && !/^pan(Down|Left|Right)$/.test(r.action))
      .map((r) => [r.action === 'panUp' ? 'W A S D' : r.keys.join(' / '), r.action === 'panUp' ? 'Pan the view' : KEY_LABELS[r.action] ?? r.label]);
    if (!km.list().some((r) => r.action === 'settings')) rows.push([',', 'Settings']);
    return [...rows, ['Wheel', 'Zoom to the cursor'], ...dragKeys(), ['Shift + click', 'Uproot a crop']];
  };
  /** What the right mouse button does in the chosen camera mode (wish H), for the Controls list. */
  const dragKeys = () => (rightDragOf() === 'rotate'
    ? [['Right-drag', 'Turn (sideways) and tilt (up / down) the view'], ['Middle-drag / Shift + right-drag', 'Pan']]
    : [['Right-drag', 'Pan']]);
  let cur = sanitize(kv.get(KEY));
  if (!kv.get(KEY) && prefersReduced()) cur.motion = 'reduced';
  const subs = new Set();
  // ?quality=low|medium|high|eco|auto picks the graphics tier for this visit (README); a choice made in Settings
  // during the visit wins from then on
  let urlQuality = null;
  try { const q = new URLSearchParams(globalThis.location?.search ?? '').get('quality'); urlQuality = QUALITIES.includes(q) ? q : null; } catch { urlQuality = null; }

  const ctl = () => (S.controller && typeof S.controller.setOption === 'function' ? S.controller : null);
  /** Edge scrolling lives in the controller (it persists 'hh.input'); Settings only shows and flips it. */
  const edgeOf = () => { const c = ctl(); return c && c.options ? Boolean(c.options.edgeScroll) : cur.edgeScroll; };
  /** Right-drag pans or turns the camera (wish H): the controller's `rightDrag` option when it has one (client lane,
   * persisted in 'hh.input'), else this browser's setting, announced on settings.on for whoever reads it. */
  const rightDragOf = () => {
    const o = ctl()?.options;
    if (o && Object.hasOwn(o, 'rightDrag')) return o.rightDrag === 'rotate' || o.rightDrag === true ? 'rotate' : 'pan';
    return cur.rightDrag;
  };
  const scale = () => uiScaleOf(cur, globalThis.innerWidth || 1366, globalThis.innerHeight || 768);

  function apply() {
    document.documentElement.style.setProperty('--ui-scale', String(scale() / 100));
    document.body.classList.toggle('motion-reduced', cur.motion !== 'full');
    document.body.classList.toggle('motion-still', cur.motion === 'still');
    document.body.classList.toggle('cb-safe', cur.cbSafe);
    document.body.classList.toggle('no-key-hints', !cur.keyHints);
    const v = S.view;
    if (v) {
      // 'eco' goes through as itself: the view runs the low tier at 20 / 30 fps for it (render/index.js setQuality)
      try { v.setQuality?.(urlQuality ?? cur.quality); } catch (err) { console.warn('view.setQuality', err); }
      try { v.setMotion?.(cur.motion); } catch (err) { console.warn('view.setMotion', err); }
      try { v.setDayCycle?.(cur.dayCycle === 'clock' ? 'real' : cur.dayCycle); } catch (err) { console.warn('view.setDayCycle', err); }
    }
    const audio = audioOf();
    if (audio) {
      try { audio.setDayMode?.(cur.dayCycle === 'clock' ? 'real' : cur.dayCycle); } catch { /* audio lane owns it */ }
    }
  }
  const audioOf = () => {
    const a = globalThis.__hh && globalThis.__hh.audio;
    return a && typeof a.setVolume === 'function' ? a : null;
  };
  /** 0..100 for a channel: the audio engine's own value when it exists. */
  function volOf(ch) {
    const a = audioOf();
    if (a) { const v = a.volumes()[ch]; if (Number.isFinite(v)) return Math.round(v * 100); }
    return cur.volume[ch] ?? 0;
  }
  function setVol(ch, v) {
    const a = audioOf();
    if (a) a.setVolume(ch, v / 100);
    api.set({ volume: { [ch]: v } });
  }
  const isMuted = () => { const a = audioOf(); return a ? Boolean(a.muted) : cur.muted; };

  // the window decides how big the interface may be: re-clamp (and re-fit the automatic size) on every resize
  let resizeT = 0;
  globalThis.addEventListener?.('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const before = document.documentElement.style.getPropertyValue('--ui-scale');
      apply();
      if (document.documentElement.style.getPropertyValue('--ui-scale') !== before) {
        const snap = api.get();
        for (const fn of [...subs]) { try { fn(snap, { uiScale: snap.uiScale }); } catch (err) { console.error('settings listener failed', err); } }
      }
    }, 120);
  });

  const api = {
    get: () => Object.freeze({ ...cur, muted: isMuted(), edgeScroll: edgeOf(), rightDrag: rightDragOf(), uiScaleNow: scale(), volume: Object.freeze({ ...cur.volume }) }),
    set(patch) {
      if (Object.hasOwn(patch, 'muted')) { const a = audioOf(); if (a) a.setMuted(Boolean(patch.muted)); }
      if (Object.hasOwn(patch, 'edgeScroll')) ctl()?.setOption('edgeScroll', Boolean(patch.edgeScroll));
      if (Object.hasOwn(patch, 'rightDrag') && Object.hasOwn(ctl()?.options ?? {}, 'rightDrag')) ctl().setOption('rightDrag', patch.rightDrag === 'rotate' ? 'rotate' : 'pan');
      for (const k of CONTROLLER_KEYS) if (Object.hasOwn(patch, k)) ctl()?.setOption(k, Boolean(patch[k]));
      if (Object.hasOwn(patch, 'quality')) urlQuality = null;
      // picking a size is a choice (it no longer follows the window); { uiScaleSet: false } goes back to automatic
      const chose = Object.hasOwn(patch, 'uiScale') && !Object.hasOwn(patch, 'uiScaleSet') ? { uiScaleSet: true } : {};
      const next = sanitize({ ...cur, ...patch, ...chose, volume: { ...cur.volume, ...(patch.volume || {}) } });
      cur = next;
      kv.set(KEY, cur);
      apply();
      const snap = api.get();
      for (const fn of [...subs]) { try { fn(snap, patch); } catch (err) { console.error('settings listener failed', err); } }
    },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    apply,
    /** The Interface size in effect, in percent. */
    scale,
  };

  // ---- the panel ----------------------------------------------------------------------------------------------
  function seg(label, key, options, help, get = () => cur[key]) {
    const row = h('div.set-row', h('span.lbl', { id: `set-${key}` }, label));
    const group = h('div.seg', { role: 'group', 'aria-labelledby': `set-${key}` });
    const paint = () => { for (const b of group.children) b.setAttribute('aria-pressed', String(get() === b.dataset.v)); };
    for (const [v, text] of options) {
      group.append(h('button', { type: 'button', dataset: { v }, on: { click: () => { api.set({ [key]: v }); paint(); } } }, text));
    }
    paint();
    row.append(group);
    if (help) row.append(h('span.help', help));
    return row;
  }
  function slider(label, get, set, { min = 0, max = 100, step = 5, unit = '%', extra = null, text = null } = {}) {
    const id = `set-${label.replace(/\W+/g, '-').toLowerCase()}`;
    const show = () => (text ? text() : `${get()}${unit}`);
    const out = h('output', { for: id }, show());
    const input = h('input', { type: 'range', id, min, max, step, value: get(),
      on: { input: (e) => { set(Number(e.target.value)); out.textContent = show(); } } });
    const row = h('div.set-row', h('label', { for: id }, label), h('div.slider', input, out));
    if (extra) row.append(extra({ input, out, show }));
    return row;
  }
  /** Interface size: 80 % up to what fits this window, plus "Fit this screen" (the automatic size). */
  function sizeSlider() {
    const W = () => globalThis.innerWidth || 1366;
    const H = () => globalThis.innerHeight || 768;
    return slider('Interface size', () => scale(), (v) => api.set({ uiScale: v }), {
      min: UI_SCALE_MIN, max: uiScaleMax(W(), H()), step: 5,
      text: () => `${scale()}%${cur.uiScaleSet ? '' : ' (auto)'}`,
      extra: ({ input, out, show }) => h('div.set-inline',
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { size: 'auto' }, on: { click: () => {
          api.set({ uiScaleSet: false }); input.value = String(scale()); out.textContent = show();
        } } }, 'Fit this screen'),
        h('span.help', `Up to ${uiScaleMax(W(), H())} % fits this window; the size follows the window until you pick one.`)),
    });
  }
  /** A switch. `live` keys are read from and written to their owner (sound: audio.js, edge scroll, vibration and the
   * screen wake lock: the controller's input options). */
  function toggle(label, key, help) {
    const val = () => (key === 'muted' ? isMuted() : key === 'edgeScroll' ? edgeOf()
      : CONTROLLER_KEYS.has(key) ? ctl()?.options?.[key] !== false : cur[key]);
    const b = h('button.toggle', { type: 'button', role: 'switch', 'aria-checked': String(val()),
      on: { click: () => { api.set({ [key]: !val() }); b.setAttribute('aria-checked', String(val())); } } },
    h('span', label, help ? h('span.help', help) : null), h('span.sw', { 'aria-hidden': 'true' }));
    return h('div.set-row', b);
  }

  /** A phone or tablet (coarse pointer, no hover; game/device.js decides when it is there). */
  const touchFirst = () => Boolean(S.controller?.device?.touchFirst
    ?? globalThis.matchMedia?.('(hover: none) and (pointer: coarse)').matches);
  function touchRows() {
    const dev = S.controller?.device;
    const opts = ctl()?.options || {};
    const rows = [h('h3', 'Touch'), h('ul.keys.gestures', TOUCH_GESTURES.map(([k, what]) => h('li', h('kbd', k), what)))];
    if (Object.hasOwn(opts, 'haptics')) rows.push(toggle('Vibration', 'haptics', 'A short buzz on a harvest and a level-up (Android; iPhones have none).'));
    if (Object.hasOwn(opts, 'keepAwake')) {
      const can = dev?.wakeLock?.available;
      rows.push(toggle('Keep the screen on', 'keepAwake', can ? 'While you play; after three minutes without a touch the screen may sleep.'
        : 'This browser cannot keep the screen on for a page on the home network.'));
    }
    if (dev?.fullscreen?.available) {
      rows.push(h('div.set-row', h('span.lbl', 'Full screen'), h('div',
        h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => dev.fullscreen.toggle()?.catch?.(() => {}) } },
          dev.fullscreen.active ? 'Leave full screen' : 'Play full screen'))));
    }
    return rows;
  }

  /** The Credits tab: every music track with its artist, where it plays and its licence (linked to its source page). */
  function creditRows() {
    const status = h('p.help.credits-status', { role: 'status' }, 'Loading the music list…');
    const list = h('ul.credits-list', { 'aria-label': 'Music tracks' });
    const fill = (tracks) => {
      let now = null;
      try { now = audioOf()?.info?.().music?.track ?? null; } catch { now = null; }
      status.remove();
      list.replaceChildren(...tracks.map((t) => h('li.credit', { dataset: { track: t.id }, class: t.id === now ? 'is-playing' : null },
        h('span.credit-title', t.title),
        h('span.credit-by', `by ${t.artist}`),
        h('span.credit-meta', moodText(t.moods)),
        h('span.credit-meta',
          h('a.credit-link', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, LICENCE_NAMES[t.licence] ?? t.licence),
          t.id === now ? h('span.credit-now', 'Playing now') : null))));
    };
    loadMusicList().then(fill, (err) => {
      console.warn('settings: the music list did not load', err);
      status.textContent = 'The music list could not be loaded just now. Open this tab again in a moment.';
    });
    return [
      h('h3', 'Music'),
      h('p.credits-lead', 'The music is real, composed acoustic and folk music, shared by its artists with everyone. Thank you!'),
      status,
      list,
      h('h3', 'Sounds'),
      h('p.credits-lead', 'The sound effects are synthesised for Harvest Hollow (no recordings), and the stand-in music that plays when a track cannot load is composed note by note in your browser.'),
    ];
  }

  S.ui.panels.register('settings', {
    title: 'Settings',
    size: 'wide',
    hotkey: ',',
    tabs: [{ id: 'look', label: 'Look & sound' }, { id: 'access', label: 'Comfort' }, { id: 'keys', label: 'Controls' }, { id: 'farm', label: 'Farm' },
      { id: 'credits', label: 'Credits' }],
    mount(body, ctx) {
      const grid = h('div.settings');
      if (ctx.tab === 'look') {
        grid.append(
          h('h3', 'Graphics'),
          seg('Quality', 'quality', [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['eco', 'Eco']],
            'Auto keeps the farm smooth on this computer. Eco saves battery: fewer frames while nothing moves.'),
          seg('Day and night', 'dayCycle', [['cycle', 'Cycle'], ['day', 'Always day'], ['clock', 'Real clock']]),
          h('h3', 'Sound'),
          toggle('Mute everything', 'muted'),
          slider('Master', () => volOf('master'), (v) => setVol('master', v)),
          slider('Music', () => volOf('music'), (v) => setVol('music', v)),
          slider('Effects', () => volOf('sfx'), (v) => setVol('sfx', v)),
          slider('Birds and crickets', () => volOf('ambience'), (v) => setVol('ambience', v)),
          slider('Buttons', () => volOf('ui'), (v) => setVol('ui', v)),
        );
      } else if (ctx.tab === 'access') {
        grid.append(
          h('h3', 'Comfort'),
          seg('Motion', 'motion', [['full', 'Full'], ['reduced', 'Reduced'], ['still', 'Still']],
            'Reduced: no confetti bursts, gentler sway. Still: nothing moves unless you act.'),
          sizeSlider(),
          toggle('Colour-blind friendly', 'cbSafe', 'Adds ✓ and ✕ marks to ingredients and ready orders, a dashed ring around a farmer who is away and a sign on the connection chip.'),
          toggle('Sound captions', 'captions', 'Important sounds also appear in the activity feed.'),
          toggle('Show key hints', 'keyHints', 'Little number badges on the tools.'),
        );
      } else if (ctx.tab === 'keys') {
        // a phone or tablet: the gestures and its own switches first (game/device.js, the input lane's options)
        if (touchFirst()) grid.append(...touchRows());
        const keys = h('ul.keys', keyList().map(([k, what]) => h('li', h('kbd', k), what)));
        const drag = seg('Right-drag', 'rightDrag', [['pan', 'Pan'], ['rotate', 'Rotate camera']],
          'Rotate camera: drag sideways to turn the farm, up and down to tilt from low to almost straight down. Middle-drag or Shift + right-drag still pans. Remembered on this device.',
          rightDragOf);
        // the key list says what the right button does now
        drag.addEventListener('click', () => keys.replaceChildren(...keyList().map(([k, what]) => h('li', h('kbd', k), what))));
        // a phone without a mouse has no right button and no screen edge to scroll at
        const mouse = !touchFirst() || Boolean(globalThis.matchMedia?.('(any-pointer: fine)').matches);
        if (mouse) grid.append(h('h3', 'Mouse'), drag, toggle('Edge scrolling', 'edgeScroll', 'Pan when the mouse touches the screen edge.'));
        grid.append(h('h3', 'Keys'), keys);
      } else if (ctx.tab === 'credits') {
        grid.append(...creditRows());
      } else {
        const st = S.store.state;
        grid.append(
          h('h3', 'Our farm'),
          h('div.set-row', h('span.lbl', 'Farm name'), h('div.set-inline',
            h('strong.set-farm-name', st ? st.farm.name : ''),
            h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: () => { ctx.close(); S.ui.nameFarm(); } } }, 'Rename'))),
          h('div.set-row', h('span.lbl', 'First-evening guide'), h('div',
            h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { guide: 'again' }, on: { click: () => { ctx.close(); S.tutorial?.restart(); } } }, 'Show the guide again')),
          h('span.help', 'Grandma walks you through the first steps again. Nothing on the farm changes.')),
          ...(S.ui.panels.has('avatar') ? [h('div.set-row', h('span.lbl', 'Your farmer'), h('div',
            h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { look: 'open' }, on: { click: () => { ctx.close(); S.ui.panels.open('avatar'); } } }, 'Change your look')),
          h('span.help', 'Hair, clothes, skin tone and a hat. Saved with the farm: your partner sees it too.'))] : []),
          // multi-farm mode: invite, the personal link and the retention line instead of "Switch farmer" (ui/invite.js)
          ...(S.invite ? S.invite.settingsRows(ctx) : [h('div.set-row', h('span.lbl', 'This screen'), h('div',
            h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => S.ui.switchFarmer?.() } }, 'Switch farmer')),
          h('span.help', 'Pick the other farmer on this computer (two tabs can be both of you).'))]),
        );
      }
      body.append(grid);
    },
  });

  return api;
}
