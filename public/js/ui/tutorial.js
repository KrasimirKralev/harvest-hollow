// The first evening (GDD §7.4): Grandma's coach bubble with the current step of this player's track (Fields or
// Barnyard), the shared start and together steps, a bouncing pointer into the 3D world (view.toScreen, an edge arrow
// when off-screen) or onto the HUD button to press, and the per-player first-use tips (5 s, non-blocking). The
// progress lives in the rules (rules-goals: players[pid].tut, farm.tut; actions tutDone, tutSkip, tutSwap,
// markSeen 'tip'); this module only shows it. ui-shell lane.
//
//   coachStep(state, pid) -> { step, list: 'start'|'track'|'together', track, have, need, waiting? } | null  (pure)
//   targetOf(state, step, pid) -> { tile?: {x, z}, id?, ui?: selector } | null                               (pure)
import { TUTORIAL, levelFromXp, CONTENT, defOf } from '../../../shared/content/index.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { currentStep, currentFarmStep } from '../../../shared/rules/actions/tutorial.js';
import { sortedKeys } from '../../../shared/rules/order.js';
import { footprint } from '../../../shared/rules/grid.js';
import { h, kv, touchPlayer, touchText } from './dom.js';
import { LAYOUT_Q } from './layout.js';
import { t as tr, lang, ctext } from '../i18n/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// track -> catalog key ('moments.track.*')
const TRACK_LABEL = { fields: 'fields', barnyard: 'barnyard', together: 'together', start: 'start', choose: 'choose' };
/** A guide step's words in the language in effect (TUTORIAL is content: lane C translates it, i18n/bg/text-c.js
 *  TUTORIAL['step.<id>'].text and TUTORIAL['firstUse.<id>'].text). */
const stepText = (step) => (step.id === 'choose' ? tr('moments.coach.choose') : ctext('TUTORIAL', `step.${step.id}`, 'text', step.text));

/**
 * Grandma's welcome and the farm naming belong to a NEW farm (GDD §7.4, minute 0:05): a farm the couple never named
 * that is still in its first evening. An old save or fixture whose players are re-joined (farm level 5 and up, never
 * named) skips them; Settings > Farm > Rename still names it any time (QA2 UI-14). Pure.
 */
export const NAMING_MAX_LEVEL = 5;
export function namingDue(state) {
  return Boolean(state && state.farm && !state.farm.coop?.named && levelFromXp(state.farm.xp) < NAMING_MAX_LEVEL);
}

/** The step the coach shows this player, in GDD order: start steps, then their track, then together steps. Pure. */
export function coachStep(state, pid) {
  const me = state.players[pid];
  if (!me || !state.farm.tut) return null;
  const level = levelFromXp(state.farm.xp);
  const open = (s) => !s.level || level >= s.level;
  const farm = currentFarmStep(state);
  if (me.tut && me.tut.skip && !me.tut.track) return null;          // "I know farming": no more coaching for me
  if (farm && farm.list === 'start' && namingDue(state)) {
    return { step: farm.step, list: 'start', track: 'start', have: 0, need: farm.step.task ? farm.step.task.qty : 1 };
  }
  const t = me.tut;
  const own = currentStep(state, pid);
  if (t && !t.skip && !t.track) {
    // not assigned yet: the first deed of either track picks it ("auto-assigned by who acts first")
    return { step: { id: 'choose', text: tr('moments.coach.choose'), task: null },
      list: 'track', track: 'choose', have: 0, need: 1 };
  }
  const together = farm && farm.list === 'together' ? farm.step : null;
  if (own && open(own)) return { step: own, list: 'track', track: t.track, have: t.n || 0, need: own.task ? own.task.qty : 1 };
  if (together && open(together)) {
    return { step: together, list: 'together', track: 'together', have: state.farm.tut.n || 0, need: together.task ? together.task.qty : 1 };
  }
  if (own) return { step: own, list: 'track', track: t.track, have: t.n || 0, need: own.task ? own.task.qty : 1, waiting: own.level };
  if (together && t && !t.skip) return { step: together, list: 'together', track: 'together', have: 0, need: 1, waiting: together.level };
  return null;
}

/** Centre tile (float) of an object's footprint. Pure. */
export function tileCentreOf(state, id) {
  const o = state.farm.objects[id];
  if (!o || !Number.isFinite(o.x)) return null;
  const d = defOf(o.def);
  const [w, dd] = d && d.size ? footprint(d, o.rot || 0) : [1, 1];
  return { x: o.x + (w - 1) / 2, z: o.z + (dd - 1) / 2 };
}

function findObj(state, pred) {
  const objs = state.farm.objects;
  for (const id of sortedKeys(objs)) {
    const o = objs[id];
    if (Number.isFinite(o.x) && pred(o, id)) return id;
  }
  return null;
}

/** Where the pointer goes for a step. Pure (UI selectors are strings). */
export function targetOf(state, step, now) {
  if (!step) return null;
  const at = (id) => (id ? { id, tile: tileCentreOf(state, id) } : null);
  switch (step.id) {
    case 'choose':
    case 'plant_wheat': return at(findObj(state, (o) => o.def === 'plot' && !o.crop)) || { ui: '[data-tool="seed"], [data-tool="seed_bag"]' };
    case 'harvest_wheat': return at(findObj(state, (o) => o.def === 'plot' && o.crop && o.crop.readyAt <= now))
      || at(findObj(state, (o) => o.def === 'plot' && o.crop));
    case 'sell_wheat': return { ui: '[data-dock="market"]', ...(at(findObj(state, (o) => o.def === 'market_stand')) || {}) };
    case 'first_order': return { ui: '[data-dock="orders"]', ...(at(findObj(state, (o) => o.def === 'order_board')) || {}) };
    case 'clear_weeds': return at(findObj(state, (o) => o.def === 'weed')) || at(findObj(state, (o) => CONTENT.debris.has(o.def)));
    case 'place_coop': return { ui: '.build-card[data-def="coop"], [data-dock="build"]' };
    case 'place_feed_mill': return { ui: '.build-card[data-def="feed_mill"], [data-dock="build"]' };
    case 'apple_tree': return { ui: '.build-card[data-def="apple_tree"], [data-dock="build"]' };
    case 'make_feed': return at(findObj(state, (o) => o.def === 'feed_mill'));
    case 'feed_hens': return at(findObj(state, (o) => o.def === 'coop'));
    case 'flour_together': return at(findObj(state, (o) => o.def === 'mill'));
    case 'say_hello': return { ui: '#social .social-btn' };
    case 'golden_hour': return at(findObj(state, (o) => o.def === 'sunset_bench'));
    default: return null;
  }
}

/** Grandma Hazel's portrait from her content style (inline SVG, GDD: NPC portraits are inline SVG). */
/** Grandma Hazel's painted portrait (art lane), the drawn SVG when it cannot load. */
export function grandmaPortrait(size = 60) {
  if (typeof document === 'undefined') return grandmaSvg(size);
  const img = document.createElement('img');
  img.className = 'grandma-art';
  img.src = `/assets/art/npc/${size <= 64 ? 'hazel_face' : 'hazel_128'}.webp`;
  img.width = size;
  img.height = size;
  img.alt = tr('moments.coach.grandma');
  img.decoding = 'async';
  img.draggable = false;
  img.style.cssText = 'border-radius:50%;object-fit:cover;flex:none;background:#F3E6CF;box-shadow:0 0 0 2px #FFF8E6,0 0 0 4px #8A5A2B';
  img.addEventListener('error', () => img.replaceWith(grandmaSvg(size)), { once: true });
  return img;
}

export function grandmaSvg(size = 60) {
  const p = CONTENT.npcs.get('hazel')?.portrait
    || { skin: '#F2D3B8', hair: '#E8E4DC', outfit: '#7E9C6B', accent: '#E9B44C' };
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('gran');
  const ink = '#3E2612';
  const parts = [
    ['circle', { cx: 32, cy: 32, r: 30, fill: '#FFF4D6', stroke: '#D9B677', 'stroke-width': 2.5 }],
    ['path', { d: 'M10 60c2-12 11-18 22-18s20 6 22 18z', fill: p.outfit, stroke: ink, 'stroke-width': 2 }],
    ['path', { d: 'M26 44l6 6 6-6', fill: 'none', stroke: p.accent, 'stroke-width': 3, 'stroke-linecap': 'round' }],
    ['circle', { cx: 32, cy: 10, r: 6.5, fill: p.hair, stroke: ink, 'stroke-width': 2 }],
    ['ellipse', { cx: 32, cy: 29, rx: 13.5, ry: 14.5, fill: p.skin, stroke: ink, 'stroke-width': 2 }],
    ['path', { d: 'M18.5 27c0-9 6-13.5 13.5-13.5S45.5 18 45.5 27c-3-4-8-6-13.5-6s-10.5 2-13.5 6z', fill: p.hair, stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' }],
    ['circle', { cx: 26.5, cy: 30, r: 4.6, fill: 'rgba(255,255,255,.35)', stroke: ink, 'stroke-width': 1.8 }],
    ['circle', { cx: 37.5, cy: 30, r: 4.6, fill: 'rgba(255,255,255,.35)', stroke: ink, 'stroke-width': 1.8 }],
    ['path', { d: 'M31 30h2', stroke: ink, 'stroke-width': 1.8 }],
    ['circle', { cx: 26.5, cy: 30.5, r: 1.4, fill: ink }],
    ['circle', { cx: 37.5, cy: 30.5, r: 1.4, fill: ink }],
    ['circle', { cx: 23, cy: 36.5, r: 2.6, fill: '#F49A9A', 'fill-opacity': '.6' }],
    ['circle', { cx: 41, cy: 36.5, r: 2.6, fill: '#F49A9A', 'fill-opacity': '.6' }],
    ['path', { d: 'M28 37.5c2.2 2.2 5.8 2.2 8 0', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

function arrowSvg(color = '#FFC83D') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 64');
  svg.classList.add('arrow');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M14 4h20v30h11L24 60 3 34h11z');
  path.setAttribute('fill', color);
  path.setAttribute('stroke', '#3E2612');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linejoin', 'round');
  const shine = document.createElementNS(SVG_NS, 'path');
  shine.setAttribute('d', 'M19 8v24');
  shine.setAttribute('stroke', '#fff');
  shine.setAttribute('stroke-opacity', '.6');
  shine.setAttribute('stroke-width', '3');
  shine.setAttribute('stroke-linecap', 'round');
  svg.append(path, shine);
  return svg;
}

export function createTutorial(S) {
  const { store, view, ui } = S;
  const touchMq = globalThis.matchMedia?.(LAYOUT_Q.touch) ?? null;
  const landMq = globalThis.matchMedia?.(LAYOUT_Q.land) ?? null;
  const layer = document.getElementById('pointers');
  const slot = document.getElementById('coach-slot');
  let coach = null;
  let coachKey = '';
  let pointer = null;          // { el, target, until? }
  let spot = null;             // the HUD element with .ui-spot
  let flashT = 0;
  let hint = null;
  let menuOpen = false;
  const hiddenKey = () => `hh.coach.hidden.${store.pid}`;
  // the first-use tip of a tool sits on the open tray (its header), not in a third box over the field (UI-07)
  const trayTip = h('div.tray-tip', { role: 'status', hidden: true });
  document.getElementById('seed-tray')?.before(trayTip);

  // ---- pointer ------------------------------------------------------------------------------------------------
  function setPointer(target) {
    if (spot) { spot.classList.remove('ui-spot'); spot = null; }
    if (!target) { if (pointer) { pointer.el.remove(); pointer = null; } document.body.classList.remove('tut-bar'); return; }
    if (!pointer) {
      const el = h('div.pointer', h('div.halo'));
      el.prepend(arrowSvg());
      layer.append(el);
      pointer = { el, target };
    }
    pointer.target = target;
    place();
  }
  function uiTarget(sel) {
    if (!sel) return null;
    let tucked = false;
    for (const s of sel.split(',')) {
      const el = document.querySelector(s.trim());
      if (el && el.getClientRects().length) return el;
      if (el && el.closest('#dock, .dock-minis, #social')) tucked = true;
    }
    // phones and tablets keep the dock and the together buttons in the farm menu: point at its button instead
    const menu = tucked ? document.getElementById('m-menu-btn') : null;
    return menu && menu.getClientRects().length ? menu : null;
  }
  function place() {
    if (!pointer) return;
    const t = pointer.target;
    const el = pointer.el;
    const uiEl = t.ui ? uiTarget(t.ui) : null;
    if (uiEl && (!t.tile || t.preferUi !== false)) {
      if (spot !== uiEl) { spot?.classList.remove('ui-spot'); spot = uiEl; spot.classList.add('ui-spot'); }
      const r = uiEl.getBoundingClientRect();
      pointer.ui = true;
      el.classList.add('ui');
      el.classList.remove('edge');
      // phones and tablets: a tool in the bottom bar gets the arrow from above, with room made for it over the bar
      // (body.tut-bar, css/mobile.css) so it never covers Grandma's words; the landscape column gets it from the right
      // the portrait Menu button sits at the bar's end, right of the "›" tools button: a side arrow at its left edge
      // touched "›" instead (final release PT-01), so it gets the arrow from above like a tool
      const inBar = touchMq?.matches && (uiEl.closest('#toolbar') || (uiEl.id === 'm-menu-btn' && !landMq?.matches));
      document.body.classList.toggle('tut-bar', Boolean(inBar) && !landMq?.matches);
      if (inBar && landMq?.matches) {
        el.style.transform = `translate3d(${Math.round(r.right + 4)}px, ${Math.round(r.top + r.height / 2)}px, 0) rotate(90deg)`;
      } else if (inBar) {
        el.style.transform = `translate3d(${Math.round(r.left + r.width / 2)}px, ${Math.round(r.top - 4)}px, 0)`;
      } else if (uiEl.closest('#dock, .dock-minis')) {
        // the dock's neighbours sit left of and above it: come in diagonally from the open farm, up-left
        el.style.transform = `translate3d(${Math.round(r.left + r.width * 0.3)}px, ${Math.round(r.top + 8)}px, 0) rotate(-38deg)`;
      } else if (r.top > innerHeight * 0.55 && r.left > 80) {
        el.style.transform = `translate3d(${Math.round(r.left - 6)}px, ${Math.round(r.top + r.height / 2)}px, 0) rotate(-90deg)`;
      } else {
        el.style.transform = `translate3d(${Math.round(r.left + r.width / 2)}px, ${Math.round(r.top - 4)}px, 0)`;
      }
      return;
    }
    pointer.ui = false;
    el.classList.remove('ui');
    document.body.classList.remove('tut-bar');
    if (!t.tile) { el.style.transform = 'translate3d(-999px,-999px,0)'; return; }
    const s = view.toScreen(t.tile.x, t.tile.z, 0.3);
    const m = 70;
    const W = innerWidth;
    const H = innerHeight;
    if (s.visible && s.x > m && s.x < W - m && s.y > m && s.y < H - m) {
      el.classList.remove('edge');
      el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
    } else {
      // off-screen: an arrow at the edge, turned toward the target
      const cx = W / 2;
      const cy = H / 2;
      const dx = s.x - cx;
      const dy = s.y - cy;
      const k = Math.min((W / 2 - m) / Math.max(1, Math.abs(dx)), (H / 2 - m) / Math.max(1, Math.abs(dy)));
      const ang = Math.atan2(dy, dx) * (180 / Math.PI) - 90;
      el.classList.add('edge');
      el.style.transform = `translate3d(${Math.round(cx + dx * k)}px, ${Math.round(cy + dy * k)}px, 0) rotate(${ang}deg)`;
    }
  }
  // per frame only for a farm tile (camera-bound, no layout read); a HUD target re-measures twice a second (qa2 CL-05:
  // uiTarget + getBoundingClientRect every frame forced a style pass of the whole HUD per frame of a drag stroke)
  view.onFrame(() => { if (pointer && !pointer.ui) place(); });
  setInterval(() => { if (pointer && pointer.ui) place(); }, 500);
  window.addEventListener('resize', place);

  // ---- coach ----------------------------------------------------------------------------------------------------
  function closeCoach() {
    if (coach) { coach.remove(); coach = null; coachKey = ''; }
    document.body.classList.remove('coach-on');
    setPointer(null);
  }

  function render() {
    const state = store.state;
    if (!state || !state.farm.tut) { closeCoach(); return; }
    if (kv.get(hiddenKey(), false)) { closeCoach(); return; }
    const c = coachStep(state, store.pid);
    if (!c) { closeCoach(); return; }
    const key = `${c.track}:${c.step.id}:${c.have}:${c.waiting || ''}:${lang()}`;
    if (key !== coachKey) {
      coachKey = key;
      menuOpen = false;
      const pct = Math.round((Math.min(c.have, c.need) / Math.max(1, c.need)) * 100);
      const acts = [];
      if (c.step.id === 'welcome' && ACTIONS.tutDone) {
        acts.push(h('button.btn.btn--small', { type: 'button', on: { click: () => S.controller.do('tutDone', { step: 'welcome' }) } }, tr('moments.coach.go')));
      } else if (c.step.id === 'name_farm') {
        acts.push(h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: () => ui.nameFarm() } }, tr('moments.coach.nameIt')));
      } else if (c.step.id === 'say_hello' && ACTIONS.tutDone) {
        acts.push(h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: () => S.social?.sendEmote('wave') } }, tr('moments.coach.wave')));
      }
      // the rarer choices live behind one "⋯" button with 36 px rows: four 21 px links 2 px apart made one stray
      // click end the guide for good (QA wave 1 UI-04)
      const more = coachChoices(state, c).map(([label, fn, cls]) => h(`button.coach-item${cls ? `.${cls}` : ''}`, {
        type: 'button', role: 'menuitem', on: { click: () => { setMenu(false); fn(); } } }, label));
      const menu = more.length ? h('div.coach-menu.paper', { role: 'menu', 'aria-label': tr('moments.coach.menu'), hidden: true }, ...more) : null;
      const moreBtn = menu ? h('button.coach-more', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': tr('moments.coach.more'),
        'data-tip': tr('moments.coach.moreTip'), on: { click: () => setMenu(!menuOpen) } }, h('span', { 'aria-hidden': 'true' }, '⋯')) : null;
      const said = touchText(stepText(c.step), touchPlayer(S.controller));      // a phone taps, and has no G key
      const text = c.waiting ? tr('moments.coach.waiting', { said, level: c.waiting }) : said;
      const next = h('section.coach.wood', { role: 'status', 'aria-live': 'polite', dataset: { step: c.step.id } },
        h('div.paper.coach-paper',
          grandmaPortrait(52),
          h('div.say',
            h('div.who', tr('moments.coach.grandma'), h(`span.track.${c.track}`, tr(`moments.track.${TRACK_LABEL[c.track] || 'choose'}`))),
            h('p.line', { title: text }, text),
            c.need > 1 || c.have > 0 ? h('div.prog', h('span.bar', h('i', { style: { width: `${pct}%` } })), `${Math.min(c.have, c.need)} / ${c.need}`) : null),
          h('div.acts', acts, moreBtn ? h('div.coach-more-wrap', moreBtn, menu) : null)));
      if (menu) {
        menu.addEventListener('keydown', (e) => {
          const items = [...menu.querySelectorAll('button')];
          const i = items.indexOf(document.activeElement);
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false); moreBtn.focus(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        });
      }
      if (coach) coach.replaceWith(next); else slot.prepend(next);
      coach = next;
      // phones: the activity feed steps aside while Grandma's card is up (css/mobile.css; a class, not a :has() that
      // every HUD change would re-check)
      document.body.classList.add('coach-on');
    }
    // while the player is already placing something, the arrow would only distract from the ghost
    const build = S.controller.tool && S.controller.tool.build;
    const t = c.step.task;
    const wants = t && (t.verb === 'place' || (t.verb === 'plant' && CONTENT.trees.has(t.ref))) ? t.ref : null;
    const placing = Boolean(build && wants && build.def === wants);
    setPointer(c.waiting || placing ? null : targetOf(state, c.step, store.now()));
    // the step's tool pulses in the tray until it is in hand ("Drag the Sickle across the ripe Wheat")
    for (const el of document.querySelectorAll('.tool.tool-hint')) el.classList.remove('tool-hint');
    if (!c.waiting && c.step.tool && S.controller.tool.id !== c.step.tool) {
      document.querySelector(`.tool[data-tool="${c.step.tool}"]`)?.classList.add('tool-hint');
    }
  }

  function setMenu(open) {
    const menu = coach && coach.querySelector('.coach-menu');
    const btn = coach && coach.querySelector('.coach-more');
    if (!menu || !btn) return;
    menuOpen = Boolean(open);
    menu.hidden = !menuOpen;
    btn.setAttribute('aria-expanded', String(menuOpen));
    if (menuOpen) menu.querySelector('button')?.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', (e) => { if (menuOpen && coach && !coach.querySelector('.coach-more-wrap')?.contains(e.target)) setMenu(false); }, true);

  /** The choices behind "⋯": [label, fn, cls?]. "I know farming" asks first; it ends the guide for this farmer. */
  function coachChoices(state, c) {
    const out = [];
    const me = state.players[store.pid];
    if (c.list === 'track' && c.track !== 'choose' && ACTIONS.tutSkip) {
      out.push([tr('moments.coach.skip'), () => S.controller.do('tutSkip', {})]);
      // GDD §7.4: the two tracks are "auto-assigned by who acts first and swappable"
      if (ACTIONS.tutSwap && (c.track === 'fields' || c.track === 'barnyard')) {
        out.push([c.track === 'fields' ? tr('moments.coach.swapAnimals') : tr('moments.coach.swapFields'), () => S.controller.do('tutSwap', {})]);
      }
    }
    out.push([tr('moments.coach.hide'), () => { kv.set(hiddenKey(), true); closeCoach(); }]);
    if (me && me.tut && !me.tut.skip && ACTIONS.tutSkip && c.list !== 'start') {
      out.push([tr('moments.coach.end'), async () => {
        const ok = await ui.confirm({ title: tr('moments.coach.endTitle'), lead: tr('moments.coach.endLead'),
          body: tr('moments.coach.endBody'), glyph: 'letter',
          ok: tr('moments.coach.endOk'), okKind: 'sun', cancel: tr('moments.coach.endKeep') });
        if (ok) S.controller.do('tutSkip', { all: 'yes' });
      }, 'danger']);
    }
    return out;
  }

  // ---- first-use tips (per player, keyed in the rules' seen flags; GDD §7.4) --------------------------------
  // a panel's first open shows its content tip (M1b's weekly / collection panels and the M2 panels were never wired)
  const TIP_FOR_PANEL = { building: 'building_panel', market: 'market_panel', fair: 'fair_panel', barge: 'barge_panel',
    restoration: 'restoration_panel', town: 'town_panel', townsfolk: 'townsfolk_panel', collections: 'collections_panel',
    perks: 'perks_panel', nursery: 'nursery_panel', breeding: 'breeding_panel', fishing: 'fishing', league: 'league_panel',
    seasonTrack: 'track_panel', duel: 'duel_panel', farmhouse: 'interior' };
  function firstUse(id) {
    const state = store.state;
    if (!state) return;
    const tip = TUTORIAL.firstUse.find((t) => t.id === id);
    if (!tip) return;
    const me = state.players[store.pid];
    const seenTips = me && me.seen ? me.seen.tips : kv.get(`hh.tips.${store.pid}`, {});
    if (seenTips && seenTips[id]) return;
    if (ACTIONS.markSeen && me && me.seen) S.controller.do('markSeen', { kind: 'tip', id });
    else kv.set(`hh.tips.${store.pid}`, { ...(seenTips || {}), [id]: 1 });
    if (hint) hint.remove();
    const ms = Math.max(5000, TUTORIAL.firstUseMs || 0);          // 5 s: long enough to read twice (UI-35)
    // a tool's tip goes on top of its open tray; a panel's tip into the coach column
    const trayOpen = !document.getElementById('seed-tray')?.hidden || !document.getElementById('build-tray')?.hidden;
    if (trayOpen && !TIP_PANELS.has(id)) {
      const words = ctext('TUTORIAL', `firstUse.${id}`, 'text', tip.text);
      trayTip.replaceChildren(h('b', tr('moments.coach.tip')), touchText(words, touchPlayer(S.controller)));
      trayTip.hidden = false;
      clearTimeout(trayTip._t);
      trayTip._t = setTimeout(() => { trayTip.hidden = true; }, ms);
      return;
    }
    hint = h('div.hint', { role: 'status' }, h('b', tr('moments.coach.tip')), touchText(ctext('TUTORIAL', `firstUse.${id}`, 'text', tip.text), touchPlayer(S.controller)));
    slot.append(hint);
    const mine = hint;
    setTimeout(() => { if (mine.isConnected) { mine.style.transition = 'opacity 300ms'; mine.style.opacity = '0'; setTimeout(() => mine.remove(), 320); } }, ms);
  }
  const TIP_PANELS = new Set(Object.values(TIP_FOR_PANEL));
  // the tray tip leaves with its tray
  for (const id of ['seed-tray', 'build-tray']) {
    const el = document.getElementById(id);
    if (el && typeof MutationObserver === 'function') new MutationObserver(() => {
      if (document.getElementById('seed-tray')?.hidden && document.getElementById('build-tray')?.hidden) trayTip.hidden = true;
    }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }
  ui.panels.on('open', (name) => { if (TIP_FOR_PANEL[name]) firstUse(TIP_FOR_PANEL[name]); });

  // ---- step done: a quick ✓ before the next step --------------------------------------------------------------
  store.on('fx', ({ ev }) => {
    if (!ev || ev.e !== 'tutorialStep' || !ev.done || ev.pid !== store.pid || !coach) return;
    coach.classList.add('done');
    setTimeout(() => coach && coach.classList.remove('done'), 700);
  });

  let raf = 0;
  const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  for (const t of ['players', 'tut', 'objects', 'xp', 'name']) store.subscribe(t, soon);
  S.controller.on('tool', soon);
  setInterval(soon, 4000);       // a crop ripening moves the harvest pointer without any delta

  return {
    render,
    firstUse,
    /** A pointer flash at a tile (Goal Tracker clicks). */
    flash(tile) {
      clearTimeout(flashT);
      if (coach && pointer) return;          // the coach's pointer has priority
      setPointer({ tile });
      flashT = setTimeout(() => { if (!coach) setPointer(null); else render(); }, 2600);
    },
    /** Client-only deeds the rules cannot see (the "say hello" step). */
    did(verb) {
      const cur = store.state && currentFarmStep(store.state);
      if (cur && cur.step.task && cur.step.task.verb === verb && ACTIONS.tutDone) S.controller.do('tutDone', { step: cur.step.id });
    },
    /** "Show the guide again" (Settings > Farm): un-hide the coach and, with the rules' tutRestart, start over. */
    restart() {
      kv.set(hiddenKey(), false);
      coachKey = '';
      const me = store.state && store.state.players[store.pid];
      if (ACTIONS.tutRestart) S.controller.do('tutRestart', {});
      else if (me && me.tut && me.tut.skip) ui.toast(tr('moments.coach.off'), { kind: 'info', ms: 5000 });
      render();
    },
    /** True while the coach is on screen (other teaching cards wait). */
    active: () => Boolean(coach),
  };
}
