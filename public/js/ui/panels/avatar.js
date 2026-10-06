// "Your look" (owner wish 9, 2026-10-04), ui lane: the farmer's figure, hair style and colour, skin tone, top and
// trouser colours and hat, saved per player in the game state (rules: setAvatar, players[pid].avatar) so the partner
// sees it at once; the 3D farmer is the render lane's rig. A paper-doll preview follows every pick before it is saved.
// Opened from my farmer chip (the ✎), Settings > Farm and the HUD's More menu. Loaded on first open (w4.js lazyPanel).
//
//   lookSvg(look, { size?, part? }) -> <svg>     the paper doll (pure DOM; part 'head' draws a head-and-hat thumbnail)
//   avatarPanel.mount(body, ctx)
import { h, svgIcon, createKit, fill } from './kit.js';
import { actFor } from './w4-rules.js';
import { LOOKS, lookOf, lookPatch } from './w4-model.js';
import { t } from '../../i18n/index.js';

const NS = 'http://www.w3.org/2000/svg';
const HEX = /^#[0-9a-f]{6}$/i;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  for (const k of kids) if (k) e.append(k);
  return e;
}

/** A colour a shade darker / lighter (#rrggbb; t -1..1). Pure. */
export function shade(hex, t) {
  if (!HEX.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
const col = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d);

// ---- the paper doll (viewBox 0 0 160 220: head at (80, 74) r 40, a chibi cut like the rig) ----------------------------

/** Older and shorter names of the same pieces (the editor's first catalog). */
const ALIAS = { straw: 'straw_hat', sunhat: 'sun_bonnet', cowboy: 'cowboy_hat', flower: 'flower_crown', bald: 'buzz' };
const idOf = (v) => ALIAS[v] ?? v;

function hairBack(style, c) {
  const d = shade(c, -0.18);
  switch (idOf(style)) {
    case 'braid': return el('g', { fill: d }, ...[[112, 96], [116, 110], [118, 124], [118, 138]].map(([x, y], i) => el('ellipse', { cx: x, cy: y, rx: 8 - i, ry: 8 })),
      el('rect', { x: 112, y: 144, width: 10, height: 6, rx: 2, fill: '#E8556E' }));
    case 'long': return el('path', { d: 'M38 70 Q36 128 54 134 L106 134 Q124 128 122 70 Z', fill: d });
    case 'ponytail': return el('path', { d: 'M114 58 Q140 70 132 112 Q128 124 120 118 Q126 92 108 72 Z', fill: d });
    case 'bun': return el('circle', { cx: 80, cy: 28, r: 15, fill: d });
    case 'curly': return el('g', { fill: d }, ...[[44, 92], [116, 92], [42, 74], [118, 74]].map(([x, y]) => el('circle', { cx: x, cy: y, r: 11 })));
    default: return null;
  }
}

function hairFront(style, c) {
  const hi = shade(c, 0.22);
  switch (idOf(style)) {
    case 'buzz': return el('path', { d: 'M42 66 Q40 34 80 34 Q120 34 118 66 Q112 50 80 48 Q48 50 42 66 Z', fill: c, opacity: 0.9 });
    case 'tousled': return el('g', {},
      el('path', { d: 'M40 74 Q38 34 80 32 Q122 34 120 74 L112 60 L104 70 L96 56 L86 68 L78 54 L68 68 L60 56 L52 70 L46 60 Z', fill: c }),
      el('path', { d: 'M62 40 Q78 34 96 40', stroke: hi, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }));
    case 'curly': return el('g', { fill: c }, ...[[50, 52], [64, 40], [80, 36], [96, 40], [110, 52], [44, 66], [116, 66], [58, 54], [102, 54]]
      .map(([x, y]) => el('circle', { cx: x, cy: y, r: 12 })));
    case 'long': case 'ponytail': case 'bun': case 'braid': return el('g', {},
      el('path', { d: 'M40 76 Q38 32 80 32 Q122 32 120 76 Q112 56 92 52 Q86 62 70 60 Q52 58 40 76 Z', fill: c }),
      el('path', { d: 'M58 42 Q74 35 92 39', stroke: hi, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }));
    default: return el('g', {},                                   // short
      el('path', { d: 'M40 72 Q38 32 80 32 Q122 32 120 72 Q116 58 104 56 Q100 64 84 60 Q70 58 60 62 Q48 60 40 72 Z', fill: c }),
      el('path', { d: 'M58 42 Q74 35 92 39', stroke: hi, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }));
  }
}

function hat(style, top) {
  switch (idOf(style)) {
    case 'straw_hat': return el('g', {},
      el('ellipse', { cx: 80, cy: 44, rx: 58, ry: 12, fill: '#E3B95A' }),
      el('path', { d: 'M50 44 Q52 14 80 14 Q108 14 110 44 Z', fill: '#EFCB6E' }),
      el('rect', { x: 51, y: 34, width: 58, height: 8, rx: 3, fill: '#C8473A' }),
      el('path', { d: 'M30 44 Q80 52 130 44', stroke: '#C99B3E', 'stroke-width': 2, fill: 'none' }));
    case 'cap': return el('g', {},
      el('path', { d: 'M44 50 Q44 18 80 18 Q116 18 116 50 Z', fill: shade(top, -0.1) }),
      el('path', { d: 'M78 48 Q112 44 128 54 Q108 58 78 54 Z', fill: shade(top, -0.3) }),
      el('circle', { cx: 80, cy: 19, r: 4, fill: shade(top, 0.3) }));
    case 'beanie': return el('g', {},
      el('path', { d: 'M42 54 Q42 16 80 16 Q118 16 118 54 Z', fill: '#4A90C8' }),
      el('rect', { x: 40, y: 46, width: 80, height: 13, rx: 6, fill: '#3A74A6' }),
      el('circle', { cx: 80, cy: 13, r: 9, fill: '#F2F0EA' }));
    case 'sun_bonnet': return el('g', {},
      el('path', { d: 'M16 50 Q80 30 144 50 Q120 60 80 56 Q40 60 16 50 Z', fill: '#F3E3C3' }),
      el('path', { d: 'M52 46 Q54 18 80 18 Q106 18 108 46 Z', fill: '#F7ECD3' }),
      el('rect', { x: 53, y: 37, width: 54, height: 7, rx: 3, fill: '#E8556E' }),
      el('circle', { cx: 104, cy: 38, r: 6, fill: '#FF9BB0' }), el('circle', { cx: 104, cy: 38, r: 2.5, fill: '#FFE58A' }));
    case 'cowboy_hat': return el('g', {},
      el('path', { d: 'M18 40 Q34 54 80 52 Q126 54 142 40 Q136 58 80 60 Q24 58 18 40 Z', fill: '#8A5224' }),
      el('path', { d: 'M52 50 Q50 16 66 14 Q80 22 94 14 Q110 16 108 50 Z', fill: '#A8682E' }),
      el('rect', { x: 52, y: 40, width: 56, height: 6, rx: 2, fill: '#5A3215' }));
    case 'flower_crown': return el('g', {}, ...[[46, 46, '#FF9BB0'], [60, 36, '#FFE58A'], [80, 32, '#9ED8FF'], [100, 36, '#FF9BB0'], [114, 46, '#FFE58A']]
      .flatMap(([x, y, c]) => [el('circle', { cx: x, cy: y, r: 8, fill: c }), el('circle', { cx: x, cy: y, r: 3, fill: '#E39A1E' })]),
    el('path', { d: 'M50 50 Q80 38 110 50', stroke: '#5DBB3F', 'stroke-width': 3, fill: 'none' }));
    default: return null;
  }
}

function face(skin) {
  const cheek = shade(skin, -0.12);
  return el('g', {},
    el('circle', { cx: 80, cy: 74, r: 40, fill: skin }),
    el('ellipse', { cx: 40, cy: 78, rx: 6, ry: 9, fill: skin }), el('ellipse', { cx: 120, cy: 78, rx: 6, ry: 9, fill: skin }),
    el('ellipse', { cx: 66, cy: 80, rx: 4.5, ry: 6, fill: '#3E2612' }), el('ellipse', { cx: 94, cy: 80, rx: 4.5, ry: 6, fill: '#3E2612' }),
    el('circle', { cx: 67.5, cy: 78, r: 1.6, fill: '#FFF' }), el('circle', { cx: 95.5, cy: 78, r: 1.6, fill: '#FFF' }),
    el('ellipse', { cx: 56, cy: 92, rx: 7, ry: 4, fill: '#FF9B8F', opacity: 0.55 }), el('ellipse', { cx: 104, cy: 92, rx: 7, ry: 4, fill: '#FF9B8F', opacity: 0.55 }),
    el('path', { d: 'M72 96 Q80 103 88 96', stroke: shade(cheek, -0.45), 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }));
}

const SKIN = LOOKS.skin[1]?.id ?? '#EFC9A8';
const TOP = LOOKS.top[0]?.id ?? '#2BB3A3';
const BOTTOM = LOOKS.bottom[0]?.id ?? '#3E6FA8';
const HAIR = LOOKS.hairColor[1]?.id ?? '#4A3022';

function body(look) {
  const skin = col(look.skin, SKIN);
  const top = col(look.top, TOP);
  const bottom = col(look.bottom, BOTTOM);
  const dress = look.body === 'farmer_b';
  return el('g', {},
    el('ellipse', { cx: 80, cy: 206, rx: 44, ry: 8, fill: 'rgba(62,38,18,.18)' }),
    // legs and boots
    el('rect', { x: 62, y: 172, width: 15, height: 26, rx: 6, fill: dress ? skin : bottom }),
    el('rect', { x: 83, y: 172, width: 15, height: 26, rx: 6, fill: dress ? skin : bottom }),
    el('rect', { x: 58, y: 192, width: 22, height: 11, rx: 5, fill: '#5A3215' }),
    el('rect', { x: 80, y: 192, width: 22, height: 11, rx: 5, fill: '#5A3215' }),
    // arms (sleeves) and hands
    el('path', { d: 'M54 118 Q40 130 42 156', stroke: top, 'stroke-width': 13, fill: 'none', 'stroke-linecap': 'round' }),
    el('path', { d: 'M106 118 Q120 130 118 156', stroke: top, 'stroke-width': 13, fill: 'none', 'stroke-linecap': 'round' }),
    el('circle', { cx: 42, cy: 160, r: 7.5, fill: skin }), el('circle', { cx: 118, cy: 160, r: 7.5, fill: skin }),
    // the shirt, then the overalls / the dungaree dress in the trouser colour
    el('path', { d: 'M52 122 Q54 108 80 106 Q106 108 108 122 L106 168 L54 168 Z', fill: top }),
    dress
      ? el('path', { d: 'M60 132 L100 132 L112 180 Q80 188 48 180 Z', fill: bottom })
      : el('path', { d: 'M60 132 L100 132 L102 176 L58 176 Z', fill: bottom }),
    el('rect', { x: 64, y: 136, width: 32, height: 18, rx: 4, fill: shade(bottom, 0.12) }),
    el('path', { d: 'M62 133 L58 110 M98 133 L102 110', stroke: bottom, 'stroke-width': 6, 'stroke-linecap': 'round' }),
    el('circle', { cx: 63, cy: 134, r: 2.6, fill: '#FFE58A' }), el('circle', { cx: 97, cy: 134, r: 2.6, fill: '#FFE58A' }),
    el('rect', { x: 73, y: 100, width: 14, height: 9, rx: 3, fill: skin }));
}

/** The paper doll for a look: the whole farmer, or `part: 'head'` (a thumbnail for hair and hat choices). */
export function lookSvg(look, { size = 160, part = 'all', label = null } = {}) {
  const hairC = col(look.hairColor, HAIR);
  const skin = col(look.skin, SKIN);
  const top = col(look.top, TOP);
  const head = part === 'head';
  const svg = el('svg', { viewBox: head ? '10 0 140 128' : '0 0 160 220', width: size, height: head ? Math.round(size * 128 / 140) : Math.round(size * 220 / 160),
    role: label ? 'img' : null, 'aria-label': label, 'aria-hidden': label ? null : 'true', class: 'av-doll' });
  // a part a look does not have (no hat, hair with no back) is null: append() would print it as the text "null"
  for (const part of [head ? null : body(look), hairBack(look.hair, hairC), face(skin), hairFront(look.hair, hairC), hat(look.hat, top)]) {
    if (part) svg.append(part);
  }
  return svg;
}

// ---- the panel --------------------------------------------------------------------------------------------------------

// labels are getters: they follow the language (i18n)
const GROUPS = [
  { key: 'body', get label() { return t('home.avatar.body'); }, kind: 'figure' },
  { key: 'hair', get label() { return t('home.avatar.hair'); }, kind: 'head' },
  { key: 'hairColor', get label() { return t('home.avatar.hairColor'); }, kind: 'swatch' },
  { key: 'skin', get label() { return t('home.avatar.skin'); }, kind: 'swatch' },
  { key: 'top', get label() { return t('home.avatar.top'); }, kind: 'swatch' },
  { key: 'bottom', get label() { return t('home.avatar.bottom'); }, kind: 'swatch' },
  { key: 'hat', get label() { return t('home.avatar.hat'); }, kind: 'head' },
];
const OPTIONS = { body: LOOKS.bodies, hair: LOOKS.hair, hat: LOOKS.hats, hairColor: LOOKS.hairColor, skin: LOOKS.skin, top: LOOKS.top, bottom: LOOKS.bottom };

const same = (a, b) => JSON.stringify(lookPatch(a)) === JSON.stringify(lookPatch(b));

export const avatarPanel = {
  mount(body, ctx) {
    const kit = createKit(ctx);
    const saved = () => lookOf(ctx.store.state, ctx.store.pid);
    let draft = { ...saved() };
    const preview = h('div.av-preview');
    const status = h('p.av-status', { role: 'status' });

    function paintPreview() {
      const me = ctx.store.state.players[ctx.store.pid];
      preview.replaceChildren(lookSvg(draft, { size: 168, label: me?.name ? t('home.avatar.doll', { name: me.name }) : t('home.avatar.dollYou') }));
      preview.style.setProperty('--who', me?.color ?? '#2BB3A3');
      const dirty = !same(draft, saved());
      status.textContent = dirty ? t('home.avatar.unsaved') : t('home.avatar.seen');
      status.classList.toggle('dirty', dirty);
      kit.refresh();
    }

    function option(g, o) {
      const { id, name } = o;
      const on = String(draft[g.key]).toLowerCase() === String(id).toLowerCase();
      const thumb = g.kind === 'figure' ? lookSvg({ ...draft, body: id }, { size: 46 })
        // a hair style is seen without the hat over it
        : g.kind === 'head' ? lookSvg({ ...draft, ...(g.key === 'hair' ? { hat: 'none' } : {}), [g.key]: id }, { size: 52, part: 'head' })
          : h('span.av-swatch-dot', { style: { background: id } });
      return h(`button.av-opt.av-${g.kind}`, {
        type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': name, title: name, tabindex: on ? '0' : '-1',
        dataset: { key: `av:${g.key}:${id}`, v: id },
        on: { click: () => { draft = { ...draft, [g.key]: id }; renderGroups(); paintPreview(); } },
      }, thumb, g.kind === 'swatch' ? null : h('span.av-opt-name', name));
    }

    const groupsEl = h('div.av-groups');
    function renderGroups() {
      const a = document.activeElement;
      const key = a && groupsEl.contains(a) ? a.dataset.key : null;
      groupsEl.replaceChildren(...GROUPS.map((g) => h('fieldset.av-group', h('legend', g.label),
        h(`div.av-opts.av-${g.kind}s`, { role: 'radiogroup', 'aria-label': g.label, on: { keydown: (e) => arrows(e) } },
          ...OPTIONS[g.key].map((o) => option(g, o))))));
      if (key) groupsEl.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    }
    // arrow keys move along a group and choose (a radio group)
    function arrows(e) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const opts = [...e.currentTarget.querySelectorAll('.av-opt')];
      const i = opts.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = opts[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + opts.length) % opts.length];
      next.click();
      groupsEl.querySelector(`[data-key="${CSS.escape(next.dataset.key)}"]`)?.focus({ preventScroll: true });
    }

    const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
    const save = kit.button({ label: t('home.avatar.save'), glyph: 'check', cls: 'btn--sun av-save', key: 'av:save', type: actFor('setAvatar'), quiet: ['ALREADY_DONE'],
      args: () => lookPatch(draft), gate: () => (same(draft, saved()) ? { code: 'ALREADY_DONE', hint: { done: t('home.avatar.saved') } } : null),
      after: (r) => { if (r?.ok) ctx.ui.toast(t('home.avatar.toast'), { kind: 'ok' }); paintPreview(); } });
    const reset = h('button.btn.btn--paper.pn-sm', { type: 'button', on: { click: () => { draft = { ...saved() }; renderGroups(); paintPreview(); } } }, t('home.avatar.reset'));
    const dice = h('button.btn.btn--paper.pn-sm', { type: 'button', 'aria-label': t('home.avatar.diceAria'),
      on: { click: () => {
        draft = { ...draft, hair: pickRandom(LOOKS.hair).id, hairColor: pickRandom(LOOKS.hairColor).id, top: pickRandom(LOOKS.top).id,
          bottom: pickRandom(LOOKS.bottom).id, hat: pickRandom(LOOKS.hats).id };
        renderGroups(); paintPreview();
      } } }, svgIcon('star', 18), t('home.avatar.dice'));

    fill(body, h('div.av-wrap',
      h('div.av-left', preview, status, h('div.av-acts', save, h('div.av-acts-row', reset, dice)),
        h('p.av-note', t('home.avatar.note'))),
      groupsEl));
    renderGroups();
    paintPreview();
    return {
      update() {
        // the saved look changed (this or another tab, the partner's screen): keep the draft unless it was clean
        if (same(draft, saved())) return;
        paintPreview();
      },
    };
  },
};
