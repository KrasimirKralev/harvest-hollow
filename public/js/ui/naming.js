// The farm-naming moment (GDD §7.4 "0:05 Name your farm", §6.1 "the farm is named together; the name tag records who
// named it"): a card with Grandma's words, a carved gate sign that shows the name as it is typed, a few suggestions
// and "Carve it!". The rules action is rules-goals' nameFarm { name } (max 24). It opens by itself while the
// tutorial's start step is name_farm and the farm has no name yet; Settings > Farm > Rename opens it any time.
// The partner's screen closes its own card and says who carved what. ui-shell lane.
import { ACTIONS } from '../../../shared/rules/index.js';
import { currentFarmStep } from '../../../shared/rules/actions/tutorial.js';
import { h, kv } from './dom.js';
import { grandmaPortrait, namingDue } from './tutorial.js';
import { t } from '../i18n/index.js';

export const NAME_MAX = 24;
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
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
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
      });
      const go = h('button.btn', { type: 'button' }, t('social.naming.carve'));
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

  // the partner carved it: close my card and say so
  store.on('fx', ({ ev, by }) => {
    if (!ev || ev.e !== 'named' || ev.what !== 'farm') return;
    if (by && by !== store.pid) {
      if (ui.panels.isOpen('naming')) ui.panels.close('naming');
      const who = store.state?.players?.[by]?.name ?? t('common.partner');
      ui.banner({ id: 'named', ribbon: t('social.naming.carved'), message: t('social.naming.named', { name: who, farm: ev.text }), ttl: 7000,
        actions: [{ label: t('social.naming.love'), kind: 'go', fn: () => {} }, { label: t('social.naming.other'), kind: 'paper', fn: () => ui.panels.open('naming') }] });
    }
  });
  for (const topic of ['tut', 'coop', 'name']) store.subscribe(topic, () => setTimeout(maybeOpen, 600));

  return {
    open() { ui.panels.open('naming'); },
    maybeOpen,
  };
}
