// Pets (GDD §3.4 Pets, §6.2 #14; L10, M1b; integration wave 2): each farmer adopts ONE dog or cat and names it; it
// follows its farmer (render-life's avatars-view). One treat a day (Dog Biscuit / Cat Treat from the Kitchen) brings
// its owner a find the next morning; each farmer pets each pet once a day, and when both petted both pets they each
// dig up a second find. The state and the actions are rules-economy's (shared/rules/actions/pets.js:
// `players[pid].pet`, adoptPet { kind, name }, feedPet { owner }, petPet { owner }).
//
//   petsView(state, me, now) -> { open, unlock, level, kinds, pets: [{ pid, mine, name, owner, pet, fedToday, ... }] }
//   petsPanel                 the 'pets' panel spec (args {}); petsBadge(state, pid, now) -> '!' | null
import { PETS, itemOf, isLive, defOf } from '../../../../shared/content/index.js';
import { dayIndex } from '../../../../shared/rules/calendar.js';
import { sortedKeys } from '../../../../shared/rules/order.js';
import { h, svgIcon, fmt, createKit, fill, hintable } from './kit.js';
import { levelOf, available } from './core.js';
import { actFor, canAct, takesArg, breedsOf, breedOf, breedName } from './w4-rules.js';
import { petFace } from './pet-art.js';
import { t, lang, list, ctext, name as cname } from '../../i18n/index.js';

/** A pet kind's name ("Dog" / "Куче"; lane B: PETS['kind.<id>'].name). */
const kindName = (k) => ctext('PETS', `kind.${k.id}`, 'name', k.name);

const today = (state, now) => dayIndex(now, state.meta.tz);

/** Everything the panel draws, DOM-free (tests). */
export function petsView(state, me, now) {
  const level = levelOf(state);
  const open = isLive(PETS) && level >= PETS.unlock;
  const day = today(state, now);
  const homes = new Set(Object.values(state.farm.objects).map((o) => o.def));
  const pets = sortedKeys(state.players).sort((a, b) => (a === me ? -1 : b === me ? 1 : 0)).map((pid) => {
    const p = state.players[pid];
    const pet = p.pet ?? null;
    const kind = pet ? PETS.kinds.find((k) => k.id === pet.kind) : null;
    const treat = kind ? kind.treat : null;
    return {
      pid, mine: pid === me, owner: p.name, color: p.color, pet, kind,
      fedToday: Boolean(pet && pet.fed === day),
      pettedByMe: Boolean(pet && pet.pets && pet.pets.day === day && pet.pets.by.includes(me)),
      pettedBy: pet && pet.pets && pet.pets.day === day ? [...pet.pets.by] : [],
      treat, treats: treat ? available(state, treat) : 0, treatName: treat ? (itemOf(treat) ? cname(treat) : treat) : null,
      home: kind ? kind.home : null, homePlaced: Boolean(kind && homes.has(kind.home)),
      breed: pet ? breedOf(pet) : null, breedName: pet ? breedName(pet.kind, breedOf(pet)) : null,
    };
  });
  return { open, unlock: PETS.unlock, level, kinds: PETS.kinds, pets, live: isLive(PETS) };
}

/** The pets' badge: '!' while my pet is still to be adopted, or a pet waits for today's treat and the Barn has one. */
export function petsBadge(state, pid, now) {
  const v = petsView(state, pid, now);
  if (!v.open) return null;
  const mine = v.pets.find((p) => p.mine);
  if (mine && !mine.pet) return '!';
  return v.pets.some((p) => p.pet && !p.fedToday && p.treats > 0) ? '!' : null;
}

function adoptCard(ctx, kit) {
  let kind = PETS.kinds[0].id;
  let breed = breedsOf(kind)[0]?.id ?? null;
  const input = h('input.pc-pet-name', { type: 'text', maxLength: 16, placeholder: t('home.pets.namePh'), 'aria-label': t('home.pets.nameAria'),
    on: { input: () => kit.refresh(), keydown: (e) => e.stopPropagation() } });
  const choices = h('div.pc-pet-kinds', { role: 'radiogroup', 'aria-label': t('home.pets.kind') });
  const breeds = h('div.pc-breeds', { role: 'radiogroup', 'aria-label': t('home.pets.breed') });
  const drawChoices = () => choices.replaceChildren(...PETS.kinds.map((k) => h(`button.pc-pet-kind${k.id === kind ? '.on' : ''}`, {
    type: 'button', role: 'radio', 'aria-checked': String(k.id === kind),
    on: { click: () => { kind = k.id; breed = breedsOf(kind)[0]?.id ?? null; drawChoices(); drawBreeds(); kit.refresh(); } },
  }, petFace(k.id, k.id === kind ? breed : null, { size: 56 }), h('b', kindName(k)))));
  // the breed (wave 4, wish 6): three of each, changeable later on this page
  const drawBreeds = () => breeds.replaceChildren(...breedsOf(kind).map((b) => breedButton(kind, b, b.id === breed, () => {
    breed = b.id; drawChoices(); drawBreeds();
  })));
  drawChoices();
  drawBreeds();
  const withBreed = takesArg('adoptPet', 'breed');
  return h('article.pc-pet.pc-pet-adopt',
    h('h3', t('home.pets.adoptTitle')),
    h('p', t('home.pets.adoptText')),
    choices,
    withBreed ? h('div.pc-breed-pick', h('b.pc-breed-lbl', t('home.pets.breed')), breeds) : null,
    input,
    kit.button({ label: t('home.pets.adopt'), glyph: 'heart', cls: 'btn--sun', type: actFor('adoptPet'),
      args: () => ({ kind, name: String(input.value ?? '').trim() || kindName(PETS.kinds.find((k) => k.id === kind)), ...(withBreed && breed ? { breed } : {}) }) }));
}

/** One breed in a picker: its portrait and name (a radio). */
function breedButton(kind, b, on, pickIt) {
  return h(`button.pc-breed${on ? '.on' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String(on), dataset: { breed: b.id, key: `breed:${kind}:${b.id}` },
    on: { click: pickIt } }, petFace(kind, b.id, { size: 52 }), h('span', b.name));
}

function petCard(ctx, kit, p) {
  const st = ctx.store.state;
  if (!p.pet) {
    return h('article.pc-pet.pc-pet-none', { style: { '--who': p.color } },
      h('h3', t('home.pets.none', { name: p.owner })), h('p', t('home.pets.noneText')));
  }
  const by = p.pettedBy.map((x) => (x === ctx.store.pid ? t('home.fish.you') : st.players[x]?.name ?? t('home.breed.partner')));
  const lines = [
    p.fedToday ? t('home.pets.fed', { treat: p.treatName }) : t('home.pets.wants', { treat: p.treatName, n: p.treats }),
    p.pettedBy.length ? t('home.pets.pettedBy', { who: lang() === 'en' ? by.join(' and ') : list(by) }) : t('home.pets.notPetted'),
  ];
  if (!p.homePlaced && p.home) lines.push(t('home.pets.homeHint', { home: defOf(p.home) ? cname(p.home) : p.home }));
  else if (p.home) lines.push(t('home.pets.sleeps', { home: defOf(p.home) ? cname(p.home) : t('home.pets.homeWord') }));
  const change = p.mine && canAct('petBreed') && breedsOf(p.pet.kind).length > 1;
  const picker = change ? breedPicker(ctx, p) : null;
  return h(`article.pc-pet${p.mine ? '.mine' : ''}`, { style: { '--who': p.color }, dataset: { owner: p.pid } },
    h('div.pc-pet-head', h('span.pc-pet-face', petFace(p.pet.kind, p.breed, { size: 68, label: t('home.pets.face', { name: p.pet.name, breed: p.breedName }) })),
      h('div', h('h3', p.pet.name), h('small', t(p.mine ? 'home.pets.yours' : 'home.pets.theirs', { owner: p.owner,
        what: p.breedName ?? (p.kind ? (lang() === 'en' ? p.kind.name.toLowerCase() : kindName(p.kind)) : t('home.pets.petWord')) }))),
      change ? h('button.btn.btn--paper.pn-xs.pc-breed-toggle', { type: 'button', 'aria-expanded': 'false',
        on: { click: (e) => { const open = picker.hidden; picker.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open)); } } }, t('home.pets.change')) : null),
    picker,
    // the treat line names what it wants: hovering or holding it says where Dog Biscuits and Cat Treats come from
    h('ul.pc-pet-lines', ...lines.map((l, i) => (i === 0 && !p.fedToday && p.treat ? hintable(h('li', l), p.treat) : h('li', l)))),
    h('div.pc-pet-acts',
      kit.button({ label: t('home.pets.give', { treat: p.treatName }), icon: p.treat, cls: 'pn-sm', type: 'feedPet', args: { owner: p.pid },
        quiet: ['ALREADY_DONE'], hint: p.treat ? { missing: [{ item: p.treat, n: 1 }] } : {} }),
      kit.button({ label: p.pettedByMe ? t('home.pets.petted') : t('home.pets.pet'), glyph: 'heart', cls: 'pn-sm btn--paper', type: 'petPet',
        args: { owner: p.pid }, quiet: ['ALREADY_DONE'] })));
}

/** My pet's breed, changeable any time for free (wave 4, wish 6: rules petBreed { breed }). Folded until asked for. */
function breedPicker(ctx, p) {
  const box = h('div.pc-breeds.pc-breed-change', { role: 'radiogroup', 'aria-label': t('home.pets.breedOf', { name: p.pet.name }), hidden: true });
  box.append(...breedsOf(p.pet.kind).map((b) => breedButton(p.pet.kind, b, b.id === p.breed, () => {
    if (b.id === p.breed) return;
    const r = ctx.act(actFor('petBreed'), { breed: b.id });
    if (r?.ok) ctx.ui.toast(() => t('home.pets.nowBreed', { name: p.pet.name, breed: breedsOf(p.pet.kind).find((x) => x.id === b.id)?.name ?? b.name }), { kind: 'ok' });
  })));
  return box;
}

export const petsPanel = {
  title: () => t('home.pets.title'),
  icon: 'dog_house',
  size: 'wide',
  topics: ['players', 'inventory', 'overflow', 'objects', 'xp'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const sig = () => {
      const v = petsView(ctx.store.state, ctx.store.pid, ctx.now());
      return [v.open, v.pets.map((p) => [p.pid, p.pet?.name, p.fedToday, p.pettedBy.join(), p.treats, p.homePlaced, p.breed])];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(60_000, () => update());
    update(true);
    function render() {
      const v = petsView(ctx.store.state, ctx.store.pid, ctx.now());
      if (!v.open) {
        fill(body, h('div.pc-pet-locked', svgIcon('lock', 36),
          h('p', v.live ? t('home.pets.comeAt', { n: v.unlock }) : t('home.pets.soon'))));
        return;
      }
      const mine = v.pets.find((p) => p.mine);
      fill(body, h('div.pc-pets',
        mine && !mine.pet ? adoptCard(ctx, kit) : null,
        ...v.pets.filter((p) => !(p.mine && !p.pet)).map((p) => petCard(ctx, kit, p)),
        h('p.pc-pet-note', t('home.pets.note'))));
      kit.refresh();
    }
    return { update: () => { update(); kit.refresh(); } };
  },
};
