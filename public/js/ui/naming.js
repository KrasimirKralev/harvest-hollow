// The farm-naming moment (GDD §7.4 "0:05 Name your farm", §6.1 "the farm is named together; the name tag records who
// named it"): a card with Grandma's words, a carved gate sign that shows the name as it is typed, a few suggestions
// and "Carve it!". The rules action is rules-goals' nameFarm { name } (max 24). It opens by itself while the
// tutorial's start step is name_farm and the farm has no name yet; Settings > Farm > Rename opens it any time.
// The partner's screen closes its own card and says who carved what. ui-shell lane.
//
// Release 1.0 F3 (feel#8, life-feel lane): the carve is a moment for the one who carves it too. The camera glides to
// the farm's sign by the porch (the mailbox, else the farmhouse) for CARVE.focusMs, wood chips fly from it (fx
// `carved`, with the name in gold), three chisel taps and the mastery chime play (game/feedback.js), the HUD's
// farm-name plate pops, and BOTH screens get the "Carved on the gate" card.
//   signTile(state) -> { id, x, z } | null   where the carve plays (pure; tests)
import { ACTIONS } from '../../../shared/rules/index.js';
import { currentFarmStep } from '../../../shared/rules/actions/tutorial.js';
import { h, kv } from './dom.js';
import { grandmaPortrait, namingDue } from './tutorial.js';
import { t } from '../i18n/index.js';
import { motionStill } from './levelup.js';
import { stripBidi } from '../../../shared/net/protocol.js';

export const NAME_MAX = 24;
/** F3: how long the camera glides to the sign before the chips fly (the chisel taps start then too). */
export const CARVE = Object.freeze({ focusMs: 600 });

/** F3: the farm's sign for the carve: the mailbox by the porch, else the farmhouse (its middle tile). Pure. */
export function signTile(state) {
  const objs = state?.farm?.objects ?? {};
  for (const def of ['mailbox', 'farmhouse']) {
    const id = Object.keys(objs).sort().find((k) => objs[k].def === def && Number.isFinite(objs[k].x));
    if (!id) continue;
    const o = objs[id];
    const [w, d] = def === 'farmhouse' ? [4, 4] : [1, 1];
    return { id, x: o.x + w / 2, z: o.z + d / 2 };
  }
  return null;
}
/**
 * The name-idea words of the language in effect (catalog 'social.naming.first' / '.last', '|'-separated). A first word
 * may give its m/f/n/pl forms as 'Слънчев/Слънчева/Слънчево/Слънчеви' and a last word its gender as 'Ливада:f': the
 * adjective then agrees with the noun (Bulgarian); English words have neither.
 */
const GENDERS = { m: 0, f: 1, n: 2, pl: 3 };
function words() {
  const first = t('social.naming.first').split('|').map((w) => w.split('/'));
  const last = t('social.naming.last').split('|').map((w) => { const [word, g] = w.split(':'); return { word, g: GENDERS[g] ?? 0 }; });
  return { first, last };
}

/** Three different name ideas (UI only: the randomness never reaches the rules). */
export function suggestions(n = 3, rnd = Math.random) {
  const { first, last } = words();
  const out = new Set();
  while (out.size < n) {
    const a = first[Math.floor(rnd() * first.length)];
    const b = last[Math.floor(rnd() * last.length)];
    out.add(`${a[b.g] ?? a[0]} ${b.word}`);
  }
  return [...out];
}

/** Trim, squash spaces, cut to NAME_MAX. Pure. */
export function cleanName(s) {
  // the field shows what will be stored: no bidi controls (the server strips them too, QA r1 I-02)
  return stripBidi(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function createNaming(S) {
  const { store, ui } = S;
  const laterKey = () => `hh.naming.later.${store.pid}`;
  let openedAuto = false;

  ui.panels.register('naming', {
    get title() { return t('social.naming.title'); },
    size: 'card',
    modal: true,
    mount(body, ctx) {
      const current = store.state ? store.state.farm.name : '';
      const named = Boolean(store.state && store.state.farm.coop && store.state.farm.coop.named);
      const carved = h('div.carved', named ? current : '');
      const input = h('input.field', {
        type: 'text', maxlength: String(NAME_MAX), placeholder: t('social.naming.placeholder'), 'aria-label': t('settings.farm.name'),
        value: named ? current : '', autocomplete: 'off', spellcheck: 'false',
        // QA r2 S2-04 (oib#2): the field names its button, so the keyboard keeps Carve in view, not a suggestion chip
        dataset: { keepInView: 'carve' },
      });
      const go = h('button.btn', { type: 'button', dataset: { act: 'carve' } }, t('social.naming.carve'));
      const paint = () => {
        const v = cleanName(input.value);
        carved.textContent = v || t('social.naming.ourFarm');
        carved.classList.toggle('empty', !v);
        go.disabled = !v || (named && v === current);
      };
      input.addEventListener('input', paint);
      const chips = h('div.chips');
      const fill = () => {
        chips.replaceChildren(...suggestions(3).map((s) => h('button.chip', { type: 'button', on: { click: () => { input.value = s; paint(); input.focus(); } } }, s)),
          h('button.chip', { type: 'button', 'aria-label': t('social.naming.moreIdeas'), on: { click: fill } }, t('social.naming.more')));
      };
      fill();
      const submit = () => {
        const v = cleanName(input.value);
        if (!v) { input.focus(); return; }
        if (!ACTIONS.nameFarm) { ui.toast(t('social.naming.soon'), { kind: 'info' }); return; }
        const r = S.controller.do('nameFarm', { name: v });
        if (r && r.ok) { kv.set(laterKey(), false); ctx.close(); }
      };
      go.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const partner = Object.keys(store.state?.players ?? {}).find((p) => p !== store.pid);
      body.append(h('div.dlg',
        h('div', { style: 'display:flex;gap:12px;align-items:center;text-align:left' }, grandmaPortrait(64),
          h('p.body', { style: 'margin:0' }, named
            ? t('social.naming.rename')
            : partner ? t('social.naming.askWith', { name: store.state.players[partner].name }) : t('social.naming.ask'))),
        h('div.sign', carved), h('div', { style: 'height:22px' }),
        input, chips,
        h('div.acts', h('button.btn.btn--paper', { type: 'button', on: { click: () => { kv.set(laterKey(), true); ctx.close(); } } }, t('multi.invite.later')), go)));
      paint();
      setTimeout(() => input.focus({ preventScroll: true }), 60);
    },
  });

  function maybeOpen() {
    const st = store.state;
    if (!st || !st.farm.coop || !namingDue(st) || openedAuto || kv.get(laterKey(), false)) return;
    const cur = currentFarmStep(st);
    if (!cur || cur.step.id !== 'name_farm') return;
    if (ui.panels.top()) return;                       // never on top of something the player opened
    openedAuto = true;
    ui.panels.open('naming');
  }

  /** F3: my own carve: the glide to the sign, the chips and the name in gold there, the plate's pop, the card. */
  function carveMoment(farm) {
    const sign = signTile(store.state);
    if (sign) S.view?.focus?.(sign.x, sign.z);
    setTimeout(() => {
      if (sign) { try { S.view?.fx?.play?.({ e: 'carved', id: sign.id, text: farm }, { x: sign.x, z: sign.z }, { by: store.pid, local: true }); } catch { /* fx not ready */ } }
      const plate = document.getElementById('hud-farm-name');
      const still = motionStill();
      if (plate && !still && typeof plate.animate === 'function') {
        plate.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35) rotate(-12deg)', offset: 0.3 }, { transform: 'scale(.95) rotate(6deg)', offset: 0.6 },
          { transform: 'none' }], { duration: 600, easing: 'ease-out' });
      }
      ui.banner({ id: 'named', ribbon: t('social.naming.carved'), message: t('social.naming.named', { name: t('common.you'), farm }), ttl: 6000,
        actions: [{ label: t('social.naming.love'), kind: 'go', fn: () => {} }] });
    }, CARVE.focusMs);
  }

  // the partner carved it: close my card and say so; I carved it: the carve moment (F3)
  store.on('fx', ({ ev, by }) => {
    if (!ev || ev.e !== 'named' || ev.what !== 'farm') return;
    if (by && by !== store.pid) {
      if (ui.panels.isOpen('naming')) ui.panels.close('naming');
      const who = store.state?.players?.[by]?.name ?? t('common.partner');
      ui.banner({ id: 'named', ribbon: t('social.naming.carved'), message: t('social.naming.named', { name: who, farm: ev.text }), ttl: 7000,
        actions: [{ label: t('social.naming.love'), kind: 'go', fn: () => {} }, { label: t('social.naming.other'), kind: 'paper', fn: () => ui.panels.open('naming') }] });
    } else if (by === store.pid) carveMoment(ev.text);
  });
  for (const topic of ['tut', 'coop', 'name']) store.subscribe(topic, () => setTimeout(maybeOpen, 600));

  return {
    open() { ui.panels.open('naming'); },
    maybeOpen,
  };
}
