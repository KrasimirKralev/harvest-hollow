// The farm-naming moment (GDD §7.4 "0:05 Name your farm", §6.1 "the farm is named together; the name tag records who
// named it"): a card with Grandma's words, a carved gate sign that shows the name as it is typed, a few suggestions
// and "Carve it!". The rules action is rules-goals' nameFarm { name } (max 24). It opens by itself while the
// tutorial's start step is name_farm and the farm has no name yet; Settings > Farm > Rename opens it any time.
// The partner's screen closes its own card and says who carved what. ui-shell lane.
import { ACTIONS } from '../../../shared/rules/index.js';
import { currentFarmStep } from '../../../shared/rules/actions/tutorial.js';
import { h, kv } from './dom.js';
import { grandmaPortrait, namingDue } from './tutorial.js';

export const NAME_MAX = 24;
const FIRST = ['Sunny', 'Honeybee', 'Willow', 'Clover', 'Maple', 'Bluebell', 'Golden', 'Two Hearts', 'Buttercup',
  'Hazel', 'Puddle', 'Apple Blossom', 'Little', 'Moonlit', 'Dandelion', 'Cosy', 'Bramble', 'Sweetpea'];
const LAST = ['Hollow', 'Acres', 'Meadow', 'Farm', 'Fields', 'Patch', 'Orchard', 'Homestead', 'Valley', 'Corner', 'Hill', 'Nook'];

/** Three different name ideas (UI only: the randomness never reaches the rules). */
export function suggestions(n = 3, rnd = Math.random) {
  const out = new Set();
  while (out.size < n) out.add(`${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`);
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
    title: 'Name your farm',
    size: 'card',
    modal: true,
    mount(body, ctx) {
      const current = store.state ? store.state.farm.name : '';
      const named = Boolean(store.state && store.state.farm.coop && store.state.farm.coop.named);
      const carved = h('div.carved', named ? current : '');
      const input = h('input.field', {
        type: 'text', maxlength: String(NAME_MAX), placeholder: 'Our farm is called…', 'aria-label': 'Farm name',
        value: named ? current : '', autocomplete: 'off', spellcheck: 'false',
      });
      const go = h('button.btn', { type: 'button' }, 'Carve it!');
      const paint = () => {
        const v = cleanName(input.value);
        carved.textContent = v || 'Our farm';
        carved.classList.toggle('empty', !v);
        go.disabled = !v || (named && v === current);
      };
      input.addEventListener('input', paint);
      const chips = h('div.chips');
      const fill = () => {
        chips.replaceChildren(...suggestions(3).map((s) => h('button.chip', { type: 'button', on: { click: () => { input.value = s; paint(); input.focus(); } } }, s)),
          h('button.chip', { type: 'button', 'aria-label': 'More ideas', on: { click: fill } }, '↻ More'));
      };
      fill();
      const submit = () => {
        const v = cleanName(input.value);
        if (!v) { input.focus(); return; }
        if (!ACTIONS.nameFarm) { ui.toast('Naming the farm arrives with the next update.', { kind: 'info' }); return; }
        const r = S.controller.do('nameFarm', { name: v });
        if (r && r.ok) { kv.set(laterKey(), false); ctx.close(); }
      };
      go.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const partner = Object.keys(store.state?.players ?? {}).find((p) => p !== store.pid);
      const together = partner ? ` with ${store.state.players[partner].name}` : '';
      body.append(h('div.dlg',
        h('div', { style: 'display:flex;gap:12px;align-items:center;text-align:left' }, grandmaPortrait(64),
          h('p.body', { style: 'margin:0' }, named
            ? 'A new name? The old sign comes down and the new one goes up on the gate.'
            : `Every good farm needs a name. Pick one${together}: I will carve it on the gate sign.`)),
        h('div.sign', carved), h('div', { style: 'height:22px' }),
        input, chips,
        h('div.acts', h('button.btn.btn--paper', { type: 'button', on: { click: () => { kv.set(laterKey(), true); ctx.close(); } } }, 'Later'), go)));
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
      const who = store.state?.players?.[by]?.name ?? 'Your partner';
      ui.banner({ id: 'named', ribbon: 'Carved on the gate', message: `${who} named the farm "${ev.text}" ♥`, ttl: 7000,
        actions: [{ label: 'Love it', kind: 'go', fn: () => {} }, { label: 'Suggest another', kind: 'paper', fn: () => ui.panels.open('naming') }] });
    }
  });
  for (const t of ['tut', 'coop', 'name']) store.subscribe(t, () => setTimeout(maybeOpen, 600));

  return {
    open() { ui.panels.open('naming'); },
    maybeOpen,
  };
}
