// The Animal Nursery (GDD §3.4 "Nursery (L19)", M2; w3 ui-home lane): every baby on the farm gets a three-step care
// card (Feed, Play, Groom), one of its bottle item a step (a Baby Bottle; Chicken Feed for chicks and ducklings), at
// least ten minutes apart, by either of you. With the card full the couple picks its personality (Sleepy, Playful,
// Grumpy: the idle animation set) and a specialty (Bountiful: +5 % bonus-product chance; Tidy: +1 Compost Bin point a
// collection). Optional and purely positive: the care does not change how fast it grows (bottles do that), and a baby
// that grew up before its card was full can still finish it.
//
//   nurseryView(state, pid, now) -> plain data (tested in node)    nurseryPanel: the 'nursery' panel (args { id? })
//   babyNoun(species) -> 'calf'      careWords                       the words of the steps, personalities, specialties
//   animalSwitch(ctx, current)       the Nursery / Breeding Barn switch both panels show at their top
//
// Rules (rules-economy, shared/rules/actions/breeding.js): nurse {id}, nursePick {id, personality, specialty},
// nameAnimal {id, name}; nurseryOpen / nextCareStep / nextCareAt; animal fields nurse { n, at, by }, pers, spec, name.
import { NURSERY, BREEDING, animalOf, itemOf, isLive } from '../../../../shared/content/index.js';
import * as breedA from '../../../../shared/rules/actions/breeding.js';
import * as animalsA from '../../../../shared/rules/actions/animals.js';
import { sortedKeys } from '../../../../shared/rules/order.js';
import { levelOf, available } from './core.js';
import { h, fmt, fmtDuration, createKit, icon, svgIcon, playerMark, fill, hintable } from './kit.js';
import { careGlyph } from './home-art.js';

const NOUN = { chicken: 'chick', cow: 'calf', sheep: 'lamb', pig: 'piglet', duck: 'duckling', goat: 'kid', horse: 'foal',
  alpaca: 'cria' };
/** What a baby of a species is called ("a calf"); 'baby' for anything else. */
export const babyNoun = (species) => NOUN[species] ?? 'baby';

export const careWords = Object.freeze({
  steps: { feed: ['Feed', 'a warm bottle and a cuddle'], play: ['Play', 'a run about the pen'], groom: ['Groom', 'a brush until it shines'] },
  personalities: {
    sleepy: ['Sleepy', 'naps in the sun and yawns at everything'],
    playful: ['Playful', 'hops, chases and never sits still'],
    grumpy: ['Grumpy', 'stamps and huffs, secretly the sweetest'],
  },
  specialties: {
    bountiful: ['Bountiful', '+5 % chance of a bonus product'],
    tidy: ['Tidy', '+1 Compost Bin point a collection'],
  },
});

const isColony = (o) => (typeof animalsA.isColony === 'function' ? animalsA.isColony(o) : false);
const nextStep = (o) => (typeof breedA.nextCareStep === 'function' ? breedA.nextCareStep(o)
  : (o.nurse?.n ?? 0) < NURSERY.steps.length ? NURSERY.steps[o.nurse?.n ?? 0] : null);
const nextAt = (o) => (typeof breedA.nextCareAt === 'function' ? breedA.nextCareAt(o) : (o.nurse ? o.nurse.at + NURSERY.stepGapMs : 0));

/** An animal's name: rules-goals' farm.names (the name tag records who named it), or null. */
export const nameOf = (state, id) => state.farm.names?.[id]?.name ?? state.farm.objects[id]?.name ?? null;

/** True when the Nursery plays in this build and the farm reached its level (the rules' own test when present). */
export function nurseryIsOpen(state) {
  if (typeof breedA.nurseryOpen === 'function') return breedA.nurseryOpen(state);
  return isLive(NURSERY) && levelOf(state) >= NURSERY.unlock;
}

/**
 * Everything the Nursery draws. Pure. babies: animals whose card is open (a baby, or a card started and not finished)
 * in order: ready to finish, a step ready now, then waiting. alumni: animals with a picked specialty.
 */
export function nurseryView(state, pid, now) {
  const open = nurseryIsOpen(state);
  const babies = [];
  const alumni = [];
  for (const id of sortedKeys(state.farm.objects)) {
    const o = state.farm.objects[id];
    const def = animalOf(o.def);
    if (!def || o.home === undefined || isColony(o) || !def.bottle) continue;
    const n = o.nurse ? o.nurse.n : 0;
    const base = { id, species: o.def, speciesName: def.name, noun: babyNoun(o.def), name: nameOf(state, id), coat: o.coat ?? null,
      home: o.home };
    if (typeof o.spec === 'string') {
      alumni.push({ ...base, noun: now < (o.adultAt ?? 0) ? base.noun : def.name.toLowerCase(), personality: o.pers ?? null,
        specialty: o.spec, carers: o.nurse?.by ?? [] });
      continue;
    }
    const baby = now < (o.adultAt ?? 0);
    // grown up without a card: not in the Nursery (unless a Level-up Bloom grew it early: `cardBy` keeps the window)
    if (!baby && !o.nurse && !(Number.isSafeInteger(o.cardBy) && now < o.cardBy)) continue;
    const step = nextStep(o);
    const at = step ? nextAt(o) : 0;
    babies.push({
      ...base, baby, grownAt: o.adultAt ?? 0, n, of: NURSERY.steps.length,
      steps: NURSERY.steps.map((sid, i) => ({ id: sid, done: i < n })),
      next: step, nextAt: at, waiting: Boolean(step) && at > now, item: def.bottle,
      itemName: itemOf(def.bottle)?.name ?? def.bottle, have: available(state, def.bottle), carers: o.nurse?.by ?? [],
      pick: step === null,
    });
  }
  const rank = (b) => (b.pick ? 0 : !b.waiting ? 1 : 2);
  babies.sort((a, b) => rank(a) - rank(b) || (a.waiting && b.waiting ? a.nextAt - b.nextAt : 0) || (a.id < b.id ? -1 : 1));
  return {
    open, live: isLive(NURSERY), unlock: NURSERY.unlock, level: levelOf(state), babies, alumni: alumni.slice(-8).reverse(),
    ready: babies.filter((b) => b.pick || (!b.waiting && b.have > 0)).length,
    breedingOpen: typeof breedA.breedingOpen === 'function' ? breedA.breedingOpen(state) : false,
    breedingUnlock: BREEDING.unlock,
  };
}

/** The Nursery's dock badge: a count of babies with something to do now (a step and a bottle, or the last pick). */
export function nurseryBadge(state, pid, now) {
  const v = nurseryView(state, pid, now);
  return v.open && v.ready > 0 ? v.ready : null;
}

// ---- shared bits of the two animal panels --------------------------------------------------------------------------

/** The Nursery / Breeding Barn switch at the top of both panels (the other one opens in place). */
export function animalSwitch(ctx, current) {
  const st = ctx.store.state;
  const bOpen = typeof breedA.breedingOpen === 'function' ? breedA.breedingOpen(st) : false;
  const nOpen = nurseryIsOpen(st);
  const tab = (name, label, glyph, ok, why) => h(`button.br-switch-btn${current === name ? '.on' : ''}`, {
    type: 'button', 'aria-pressed': String(current === name), dataset: { key: `sw-${name}`, open: name },
    title: ok ? null : why, 'aria-disabled': ok ? null : 'true',
    on: { click: () => { if (ok && current !== name) ctx.open(name); } },
  }, careGlyph(glyph, 26), h('span', label), ok ? null : h('small', why));
  return h('nav.br-switch', { 'aria-label': 'Animal care' },
    tab('nursery', 'Nursery', 'bottle', nOpen, `Level ${NURSERY.unlock}`),
    tab('breeding', 'Breeding Barn', 'heart', bOpen, `Level ${BREEDING.unlock}`));
}

/** An animal's name, or "the calf" / "Unnamed calf" style words. */
export const animalName = (a, { cap = true } = {}) => a.name ?? `${cap ? 'Unnamed' : 'an unnamed'} ${a.noun}`;

/** A small inline "✎ Name it" editor bound to nameAnimal {id, name} (16 letters, the rules clean it). */
export function nameEditor(ctx, a, { label = 'Name it' } = {}) {
  const wrap = h('span.br-name-edit');
  const show = () => {
    const input = h('input.br-name-input', { type: 'text', maxLength: 16, value: a.name ?? '', placeholder: `Name the ${a.noun}`,
      'aria-label': `A name for the ${a.noun}`, dataset: { key: `name-${a.id}` },
      on: { keydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') hide();
      } } });
    const save = () => {
      const v = input.value.trim();
      if (v && v !== a.name) ctx.act('nameAnimal', { id: a.id, name: v });
      hide();
    };
    wrap.replaceChildren(input, h('button.pn-chipbtn', { type: 'button', on: { click: save } }, 'Save'));
    input.focus();
  };
  const hide = () => wrap.replaceChildren(h('button.pn-chipbtn.br-name-btn', { type: 'button', dataset: { key: `nameb-${a.id}` },
    title: a.name ? 'Rename' : `Give the ${a.noun} a name`, on: { click: show } }, '✎ ', a.name ? 'Rename' : label));
  hide();
  return wrap;
}

function carers(st, by, me) {
  if (!by || !by.length) return null;
  return h('span.nu-carers', { title: `Cared for by ${by.map((p) => (p === me ? 'you' : st.players[p]?.name ?? 'a farmer')).join(' and ')}` },
    ...by.map((p) => playerMark(p, st.players[p], { size: 18 })));
}

// ---- the panel ------------------------------------------------------------------------------------------------------

function careCard(ctx, kit, b, picks) {
  const st = ctx.store.state;
  const now = ctx.now();
  const [stepWord] = b.next ? careWords.steps[b.next] : ['Done'];
  const path = h('ol.nu-path', { 'aria-label': `Care card: ${b.n} of ${b.of} steps` },
    ...b.steps.map((s, i) => {
      const [w, sub] = careWords.steps[s.id];
      const isNext = !s.done && i === b.n;
      return h(`li.nu-step${s.done ? '.done' : ''}${isNext ? '.next' : ''}`, { title: `${w}: ${sub}` },
        h('span.nu-step-dot', s.done ? svgIcon('check', 22) : careGlyph(s.id, 30)), h('b', w));
    }));
  let act;
  if (b.pick) {
    const sel = picks.get(b.id) ?? { personality: null, specialty: null };
    const choose = (k, v) => { picks.set(b.id, { ...(picks.get(b.id) ?? sel), [k]: v }); renderPick(); };
    const box = h('div.nu-pick');
    const renderPick = () => {
      const cur = picks.get(b.id) ?? sel;
      const chips = (k, words) => h('div.nu-choices', { role: 'radiogroup', 'aria-label': k === 'personality' ? 'Personality' : 'Specialty' },
        ...Object.entries(words).map(([id, [w, sub]]) => h(`button.nu-choice${cur[k] === id ? '.on' : ''}`, {
          type: 'button', role: 'radio', 'aria-checked': String(cur[k] === id), dataset: { key: `${k}-${b.id}-${id}`, [k]: id },
          on: { click: () => choose(k, id) } }, h('b', w), h('small', sub))));
      fill(box,
        h('p.nu-pick-q', `All three steps done! What is ${b.name ?? `this ${b.noun}`} like?`),
        chips('personality', careWords.personalities),
        chips('specialty', careWords.specialties),
        kit.button({ label: 'Finish the card', glyph: 'star', cls: 'btn--sun', type: 'nursePick',
          args: () => {
            const c = picks.get(b.id) ?? {};
            return { id: b.id, personality: c.personality ?? 'playful', specialty: c.specialty ?? 'bountiful' };
          },
          gate: () => {
            const c = picks.get(b.id) ?? {};
            if (!c.personality || !c.specialty) return { code: 'NOT_READY', hint: { text: 'Pick a personality and a specialty' } };
            return null;
          },
          data: { pick: b.id }, after: (r) => { if (r && r.ok) picks.delete(b.id); } }));
      kit.refresh();
    };
    renderPick();
    act = box;
  } else {
    const btn = kit.button({
      label: `${stepWord} · 1 ${b.itemName}`, icon: b.item, cls: 'btn--go', type: 'nurse', args: { id: b.id },
      data: { nurse: b.id }, quiet: ['COOLDOWN'],
      hint: () => ({ missing: [{ item: b.item, n: 1 }], at: `in ${fmtDuration(Math.max(0, b.nextAt - ctx.now()))}` }),
    });
    const wait = b.waiting ? kit.timer(h('span.nu-wait'), { end: b.nextAt, prefix: `${stepWord} again in `, doneText: `${stepWord}: ready`,
      done: () => ctx.refreshNursery?.() }) : null;
    act = h('div.nu-act', btn, wait, hintable(h('small.nu-have', `${fmt(b.have)} ${b.itemName} in the barn`), b.item, { need: 1 }));
  }
  const grow = b.baby ? kit.timer(h('span.nu-grow'), { end: b.grownAt, prefix: 'grows up in ', doneText: 'grown up' }) : h('span.nu-grow', 'grown up');
  return h(`article.nu-card${b.pick ? '.pick' : ''}`, { dataset: { baby: b.id } },
    h('header.nu-head',
      h('div.nu-face', icon(b.species, { size: 64, alt: '' }), b.baby ? h('span.nu-baby-tag', 'baby') : null),
      h('div.nu-who', h('h4', animalName(b)), h('small', `${b.speciesName} ${b.noun}`, ' · ', grow),
        nameEditor(ctx, b)),
      carers(st, b.carers, ctx.store.pid)),
    path, act);
}

export const nurseryPanel = {
  title: 'Nursery',
  icon: 'baby_bottle',
  size: 'wide',
  topics: ['objects', 'inventory', 'overflow', 'xp', 'players'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const picks = new Map();
    const sig = () => {
      const v = nurseryView(ctx.store.state, ctx.store.pid, ctx.now());
      return [v.open, v.babies.map((b) => [b.id, b.n, b.waiting, b.have, b.name, b.pick, b.carers.join(), b.baby]),
        v.alumni.map((a) => [a.id, a.name, a.specialty])];
    };
    const update = kit.memo(body, sig, render);
    ctx.refreshNursery = () => update(true);
    ctx.every(5_000, () => update());
    function render() {
      const st = ctx.store.state;
      const v = nurseryView(st, ctx.store.pid, ctx.now());
      if (!v.open) {
        fill(body, animalSwitch(ctx, 'nursery'), h('div.br-locked', careGlyph('bottle', 64),
          h('p', v.live ? `The Nursery opens at level ${v.unlock}. Every baby gets a care card: Feed, Play and Groom.`
            : 'The Nursery opens with the next chapter of the valley.')));
        return;
      }
      const focus = ctx.args?.id;
      fill(body, animalSwitch(ctx, 'nursery'),
        h('p.pn-intro', `Each baby gets a care card: three steps, one ${itemOf('baby_bottle')?.name ?? 'Baby Bottle'} each (Chicken Feed for chicks and ducklings), at least ${Math.round(NURSERY.stepGapMs / 60_000)} minutes apart, by either of you. Then you pick who it is. It changes no timer: it is just for love.`),
        v.babies.length
          ? h('div.nu-grid', ...v.babies.map((b) => careCard(ctx, kit, b, picks)))
          : h('div.br-empty', careGlyph('bottle', 56),
            h('p', 'No babies on the farm right now. A baby from the Market or from the Breeding Barn gets its card here.'),
            h('div.br-empty-acts',
              h('button.btn.btn--sky.pn-sm', { type: 'button', on: { click: () => ctx.open('market', { tab: 'animals' }) } }, 'Buy a baby'),
              v.breedingOpen ? h('button.btn.btn--paper.pn-sm', { type: 'button', on: { click: () => ctx.open('breeding') } }, 'Breeding Barn') : null)),
        v.alumni.length ? h('section.nu-alumni', h('h3.pn-h', h('span', 'Raised in the Nursery')),
          h('ul', ...v.alumni.map((a) => h('li.nu-alum', icon(a.species, { size: 36, alt: '' }),
            h('div', h('b', animalName(a)), h('small', [careWords.personalities[a.personality]?.[0], careWords.specialties[a.specialty]?.[0]].filter(Boolean).join(' · '))),
            carers(st, a.carers, ctx.store.pid))))) : null);
      kit.refresh();
      if (focus) body.querySelector(`[data-baby="${CSS.escape(String(focus))}"]`)?.scrollIntoView?.({ block: 'nearest' });
    }
    update(true);
    return { update: () => { update(); kit.refresh(); } };
  },
};

