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
import { t, liveRows, live, lang, setLang, LANGS, LANG_NAMES, fmtPct } from '../i18n/index.js';

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
// the key caps stay Latin in every language (glossary rule 9); only what they do is translated (liveRows: read at use)
export const KEYS = liveRows([
  ['1 – 9', 'settings.key.slots'], ['H', 'game.key.hand'], ['B', 'game.key.build'], ['R', 'settings.key.rotateGhost'],
  ['M', 'game.key.market'], ['I', 'game.key.barn'], ['O', 'game.key.orders'], ['J', 'game.key.journal'], [',', 'game.key.settings'],
  ['Q / E', 'settings.key.turn'], ['W A S D', 'settings.key.pan'], ['Wheel', 'settings.key.wheel'], ['Right-drag', 'settings.key.panShort'],
  ['Shift + click', 'settings.key.uproot'], ['G', 'game.key.ping'], ['T', 'game.key.emotes'], ['F', 'settings.key.partner'],
  ['Space', 'game.key.me'], ['P', 'game.key.photo'], ['Esc', 'settings.key.close'], ['F3', 'game.key.debug'],
]);

/** Input options the controller owns (game/controller.js `options`): Settings only shows and flips them. */
const CONTROLLER_KEYS = new Set(['haptics', 'keepAwake']);

/** What a finger does (mobile wave, the input lane's touch model), for the Controls tab on a phone or tablet. */
export const TOUCH_GESTURES = Object.freeze([
  ['settings.touch.tap', 'settings.touch.tapDo'], ['settings.touch.drag', 'settings.touch.dragDo'],
  ['settings.touch.two', 'settings.touch.twoDo'], ['settings.touch.tilt', 'settings.touch.tiltDo'],
  ['settings.touch.long', 'settings.touch.longDo'],
  ['settings.touch.double', 'settings.touch.doubleDo'],
].map(([g, what]) => {
  const row = [];
  Object.defineProperty(row, 0, { get: () => t(g), enumerable: true });
  Object.defineProperty(row, 1, { get: () => t(what), enumerable: true });
  return Object.freeze(row);
}));

/** Labels the Controls list shows instead of the keymap's own (what the key really does). */
const KEY_LABELS = live({ photo: 'game.key.photo' });

/** Where each track plays (tracks.json `moods`), for the Credits tab. */
export const MOOD_LABELS = live({ title: 'settings.mood.title', day: 'settings.mood.day', evening: 'settings.mood.evening',
  night: 'settings.mood.night', rain: 'settings.mood.rain', fair: 'settings.mood.fair' });
/** The plain-language licence names the Credits tab shows. */
const LICENCE_NAMES = live({ CC0: 'settings.licence.CC0' });

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
      .map((r) => [r.action === 'panUp' ? 'W A S D' : r.keys.join(' / '), r.action === 'panUp' ? t('settings.key.pan') : KEY_LABELS[r.action] ?? r.label]);
    if (!km.list().some((r) => r.action === 'settings')) rows.push([',', t('game.key.settings')]);
    return [...rows, [t('settings.cap.wheel'), t('settings.key.wheel')], ...dragKeys(), [t('settings.cap.shiftClick'), t('settings.key.uproot')]];
  };
  /** What the right mouse button does in the chosen camera mode (wish H), for the Controls list. */
  const dragKeys = () => (rightDragOf() === 'rotate'
    ? [[t('settings.cap.rightDrag'), t('settings.key.turnTilt')], [t('settings.cap.middleDrag'), t('settings.key.panShort')]]
    : [[t('settings.cap.rightDrag'), t('settings.key.panShort')]]);
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
  function slider(label, get, set, { min = 0, max = 100, step = 5, extra = null, text = null, id: sid = null } = {}) {
    // the id is from a stable name, never the (translated) label
    const id = `set-${sid ?? label.replace(/\W+/g, '-').toLowerCase()}`;
    const show = () => (text ? text() : fmtPct(get()));
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
    return slider(t('settings.size'), () => scale(), (v) => api.set({ uiScale: v }), {
      id: 'interface-size', min: UI_SCALE_MIN, max: uiScaleMax(W(), H()), step: 5,
      text: () => (cur.uiScaleSet ? fmtPct(scale()) : t('settings.sizeAuto', { pct: fmtPct(scale()) })),
      extra: ({ input, out, show }) => h('div.set-inline',
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { size: 'auto' }, on: { click: () => {
          api.set({ uiScaleSet: false }); input.value = String(scale()); out.textContent = show();
        } } }, t('settings.fit')),
        h('span.help', t('settings.sizeHelp', { n: uiScaleMax(W(), H()) }))),
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
    const rows = [h('h3', t('settings.touch')), h('ul.keys.gestures', TOUCH_GESTURES.map(([k, what]) => h('li', h('kbd', k), what)))];
    if (Object.hasOwn(opts, 'haptics')) rows.push(toggle(t('settings.vibration'), 'haptics', t('settings.vibrationHelp')));
    if (Object.hasOwn(opts, 'keepAwake')) {
      const can = dev?.wakeLock?.available;
      rows.push(toggle(t('settings.awake'), 'keepAwake', can ? t('settings.awakeHelp') : t('settings.awakeNo')));
    }
    if (dev?.fullscreen?.available) {
      rows.push(h('div.set-row', h('span.lbl', t('settings.fullscreen')), h('div',
        h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => dev.fullscreen.toggle()?.catch?.(() => {}) } },
          dev.fullscreen.active ? t('settings.fullscreenLeave') : t('settings.fullscreenPlay')))));
    }
    return rows;
  }

  /** The Credits tab: every music track with its artist, where it plays and its licence (linked to its source page). */
  function creditRows() {
    const status = h('p.help.credits-status', { role: 'status' }, t('settings.credits.loading'));
    const list = h('ul.credits-list', { 'aria-label': t('settings.credits.tracks') });
    const fill = (tracks) => {
      let now = null;
      try { now = audioOf()?.info?.().music?.track ?? null; } catch { now = null; }
      status.remove();
      list.replaceChildren(...tracks.map((tr) => h('li.credit', { dataset: { track: tr.id }, class: tr.id === now ? 'is-playing' : null },
        h('span.credit-title', tr.title),
        h('span.credit-by', t('settings.credits.by', { artist: tr.artist })),
        h('span.credit-meta', moodText(tr.moods)),
        h('span.credit-meta',
          h('a.credit-link', { href: tr.url, target: '_blank', rel: 'noopener noreferrer' }, LICENCE_NAMES[tr.licence] ?? tr.licence),
          tr.id === now ? h('span.credit-now', t('settings.credits.now')) : null))));
    };
    loadMusicList().then(fill, (err) => {
      console.warn('settings: the music list did not load', err);
      status.textContent = t('settings.credits.failed');
    });
    return [
      h('h3', t('settings.credits.music')),
      h('p.credits-lead', t('settings.credits.musicLead')),
      status,
      list,
      h('h3', t('settings.credits.sounds')),
      h('p.credits-lead', t('settings.credits.soundsLead')),
    ];
  }

  /** Language (i18n): the two languages in their own words; a tap switches the whole game at once (ui/index.js relocalize). */
  function langRow() {
    const row = h('div.set-row.set-lang', h('span.lbl', { id: 'set-lang' }, t('lang.label')));
    const group = h('div.seg', { role: 'group', 'aria-labelledby': 'set-lang' });
    for (const l of LANGS) {
      group.append(h('button', { type: 'button', lang: l, dataset: { v: l, lang: l }, 'aria-pressed': String(lang() === l),
        on: { click: () => { setLang(l); } } }, LANG_NAMES[l]));
    }
    row.append(group, h('span.help', t('lang.help')));
    return row;
  }

  S.ui.panels.register('settings', {
    get title() { return t('settings.title'); },
    size: 'wide',
    hotkey: ',',
    get tabs() {
      return [{ id: 'look', label: t('settings.tab.look') }, { id: 'access', label: t('settings.tab.access') }, { id: 'keys', label: t('settings.tab.keys') },
        { id: 'farm', label: t('settings.tab.farm') }, { id: 'credits', label: t('settings.tab.credits') }];
    },
    mount(body, ctx) {
      const grid = h('div.settings');
      if (ctx.tab === 'look') {
        grid.append(
          langRow(),
          h('h3', t('settings.graphics')),
          seg(t('settings.quality'), 'quality', [['auto', t('settings.q.auto')], ['high', t('settings.q.high')], ['medium', t('settings.q.medium')],
            ['low', t('settings.q.low')], ['eco', t('settings.q.eco')]], t('settings.qualityHelp')),
          seg(t('settings.day'), 'dayCycle', [['cycle', t('settings.day.cycle')], ['day', t('settings.day.always')], ['clock', t('settings.day.clock')]]),
          h('h3', t('settings.sound')),
          toggle(t('settings.mute'), 'muted'),
          slider(t('settings.vol.master'), () => volOf('master'), (v) => setVol('master', v), { id: 'master' }),
          slider(t('settings.vol.music'), () => volOf('music'), (v) => setVol('music', v), { id: 'music' }),
          slider(t('settings.vol.sfx'), () => volOf('sfx'), (v) => setVol('sfx', v), { id: 'effects' }),
          slider(t('settings.vol.ambience'), () => volOf('ambience'), (v) => setVol('ambience', v), { id: 'birds-and-crickets' }),
          slider(t('settings.vol.ui'), () => volOf('ui'), (v) => setVol('ui', v), { id: 'buttons' }),
        );
      } else if (ctx.tab === 'access') {
        grid.append(
          h('h3', t('settings.tab.access')),
          seg(t('settings.motion'), 'motion', [['full', t('settings.motion.full')], ['reduced', t('settings.motion.reduced')], ['still', t('settings.motion.still')]],
            t('settings.motionHelp')),
          sizeSlider(),
          toggle(t('settings.cb'), 'cbSafe', t('settings.cbHelp')),
          toggle(t('settings.captions'), 'captions', t('settings.captionsHelp')),
          toggle(t('settings.keyHints'), 'keyHints', t('settings.keyHintsHelp')),
        );
      } else if (ctx.tab === 'keys') {
        // a phone or tablet: the gestures and its own switches first (game/device.js, the input lane's options)
        if (touchFirst()) grid.append(...touchRows());
        const keys = h('ul.keys', keyList().map(([k, what]) => h('li', h('kbd', k), what)));
        const drag = seg(t('settings.cap.rightDrag'), 'rightDrag', [['pan', t('settings.key.panShort')], ['rotate', t('settings.rotateCam')]],
          t('settings.rightDragHelp'), rightDragOf);
        // the key list says what the right button does now
        drag.addEventListener('click', () => keys.replaceChildren(...keyList().map(([k, what]) => h('li', h('kbd', k), what))));
        // a phone without a mouse has no right button and no screen edge to scroll at
        const mouse = !touchFirst() || Boolean(globalThis.matchMedia?.('(any-pointer: fine)').matches);
        if (mouse) grid.append(h('h3', t('settings.mouse')), drag, toggle(t('settings.edge'), 'edgeScroll', t('settings.edgeHelp')));
        grid.append(h('h3', t('settings.keys')), keys);
      } else if (ctx.tab === 'credits') {
        grid.append(...creditRows());
      } else {
        const st = S.store.state;
        grid.append(
          h('h3', t('settings.farm.ours')),
          h('div.set-row', h('span.lbl', t('settings.farm.name')), h('div.set-inline',
            h('strong.set-farm-name', st ? st.farm.name : ''),
            h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: () => { ctx.close(); S.ui.nameFarm(); } } }, t('settings.farm.rename')))),
          h('div.set-row', h('span.lbl', t('settings.farm.guide')), h('div',
            h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { guide: 'again' }, on: { click: () => { ctx.close(); S.tutorial?.restart(); } } }, t('settings.farm.guideAgain'))),
          h('span.help', t('settings.farm.guideHelp'))),
          ...(S.ui.panels.has('avatar') ? [h('div.set-row', h('span.lbl', t('settings.farm.farmer')), h('div',
            h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { look: 'open' }, on: { click: () => { ctx.close(); S.ui.panels.open('avatar'); } } }, t('settings.farm.look'))),
          h('span.help', t('settings.farm.lookHelp')))] : []),
          // multi-farm mode: invite, the personal link and the retention line instead of "Switch farmer" (ui/invite.js)
          ...(S.invite ? S.invite.settingsRows(ctx) : [h('div.set-row', h('span.lbl', t('settings.farm.screen')), h('div',
            h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => S.ui.switchFarmer?.() } }, t('settings.farm.switch'))),
          h('span.help', t('settings.farm.switchHelp')))]),
        );
        if (S.ideas) grid.append(...S.ideas.settingsRows(ctx));
        // the privacy note, and (multi-farm mode) "Delete this farm now": ui/privacy.js
        if (S.privacy) grid.append(...S.privacy.settingsRows(ctx));
      }
      body.append(grid);
    },
  });

  return api;
}
